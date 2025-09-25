#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MissAV 演员页面视频ID抓取脚本 (Playwright版本)

用法示例:
python videoID-spider-playwright.py --actress-url "https://missav.live/actresses/七海蒂娜" --concurrency 3 --delay 2.0 --retries 3 --max-pages 10

功能:
- 输入: 演员页面URL
- 处理: 自动分页抓取该演员的所有视频
- 输出: CSV文件，包含视频标题、URL、类型、ID等信息

注意事项:
- 需要先使用gensession.txt中的命令生成session_videoID.json
- 使用Playwright进行网页抓取，支持反爬机制
- 自动处理分页和重试机制
"""

import argparse
import csv
import json
import os
import random
import re
import time
from typing import List, Tuple, Optional, Dict, Any
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode, unquote

from playwright.sync_api import Playwright, sync_playwright, Page, BrowserContext
from playwright_stealth.stealth import stealth_sync
from bs4 import BeautifulSoup
from datetime import datetime
from pathlib import Path


class ProgressManager:
    """进度管理器，负责保存和恢复抓取进度"""
    
    def __init__(self, progress_file: str = "./progress.json"):
        self.progress_file = progress_file
        self.progress = self._load_progress()
    
    def _load_progress(self) -> Dict[str, Any]:
        """加载进度文件"""
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"加载进度文件失败: {e}")
        
        # 返回默认进度结构
        return {
            "start_time": datetime.now().isoformat(),
            "last_update": datetime.now().isoformat(),
            "total_actresses": 0,
            "completed_actresses": 0,
            "current_actress": None,
            "actresses_status": {},
            "statistics": {
                "total_videos": 0,
                "total_pages": 0,
                "errors": []
            }
        }
    
    def save_progress(self):
        """保存进度到文件"""
        self.progress["last_update"] = datetime.now().isoformat()
        try:
            with open(self.progress_file, 'w', encoding='utf-8') as f:
                json.dump(self.progress, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存进度文件失败: {e}")
    
    def set_total_actresses(self, total: int):
        """设置总演员数"""
        self.progress["total_actresses"] = total
        self.save_progress()
    
    def start_actress(self, actress_name: str, actress_url: str):
        """开始处理演员"""
        self.progress["current_actress"] = actress_name
        if actress_name not in self.progress["actresses_status"]:
            self.progress["actresses_status"][actress_name] = {
                "url": actress_url,
                "status": "processing",
                "start_time": datetime.now().isoformat(),
                "total_pages": 0,
                "completed_pages": 0,
                "total_videos": 0,
                "last_page": 0,
                "errors": []
            }
        self.save_progress()
    
    def update_actress_pages(self, actress_name: str, total_pages: int):
        """更新演员总页数"""
        if actress_name in self.progress["actresses_status"]:
            self.progress["actresses_status"][actress_name]["total_pages"] = total_pages
            self.save_progress()
    
    def complete_page(self, actress_name: str, page_no: int, video_count: int):
        """完成一页的处理"""
        if actress_name in self.progress["actresses_status"]:
            status = self.progress["actresses_status"][actress_name]
            status["completed_pages"] = max(status["completed_pages"], page_no)
            status["last_page"] = page_no
            status["total_videos"] += video_count
            self.progress["statistics"]["total_videos"] += video_count
            self.progress["statistics"]["total_pages"] += 1
            self.save_progress()
    
    def complete_actress(self, actress_name: str):
        """完成演员处理"""
        if actress_name in self.progress["actresses_status"]:
            self.progress["actresses_status"][actress_name]["status"] = "completed"
            self.progress["actresses_status"][actress_name]["end_time"] = datetime.now().isoformat()
            self.progress["completed_actresses"] += 1
            self.progress["current_actress"] = None
            self.save_progress()
    
    def add_error(self, actress_name: str, error_msg: str):
        """添加错误记录"""
        if actress_name in self.progress["actresses_status"]:
            self.progress["actresses_status"][actress_name]["errors"].append({
                "time": datetime.now().isoformat(),
                "error": error_msg
            })
        self.progress["statistics"]["errors"].append({
            "time": datetime.now().isoformat(),
            "actress": actress_name,
            "error": error_msg
        })
        self.save_progress()
    
    def is_actress_completed(self, actress_name: str) -> bool:
        """检查演员是否已完成"""
        return (actress_name in self.progress["actresses_status"] and 
                self.progress["actresses_status"][actress_name]["status"] == "completed")
    
    def get_actress_resume_info(self, actress_name: str) -> Tuple[int, int]:
        """获取演员的恢复信息 (last_page, total_videos)"""
        if actress_name in self.progress["actresses_status"]:
            status = self.progress["actresses_status"][actress_name]
            # 如果演员状态是processing，说明之前中断了，需要从下一页开始
            if status.get("status") == "processing":
                return status.get("last_page", 0) + 1, status.get("total_videos", 0)
            else:
                return status.get("last_page", 0), status.get("total_videos", 0)
        return 1, 0
    
    def print_progress(self):
        """打印当前进度"""
        print(f"\n{'='*60}")
        print("抓取进度统计:")
        print(f"总演员数: {self.progress['total_actresses']}")
        print(f"已完成: {self.progress['completed_actresses']}")
        print(f"当前处理: {self.progress.get('current_actress', '无')}")
        print(f"总视频数: {self.progress['statistics']['total_videos']}")
        print(f"总页数: {self.progress['statistics']['total_pages']}")
        print(f"错误数: {len(self.progress['statistics']['errors'])}")
        print(f"{'='*60}\n")


class IncrementalCSVWriter:
    """增量CSV写入器，支持每N个视频写入一次"""
    
    def __init__(self, output_path: str, batch_size: int = 10):
        self.output_path = output_path
        self.batch_size = batch_size
        self.buffer = []
        self.total_written = 0
        self.headers = [
            "video_title",
            "video_url", 
            "video_type",
            "video_id",
            "id_pattern_type",
            "page_no",
        ]
        self._ensure_file_exists()
    
    def _ensure_file_exists(self):
        """确保CSV文件存在并有表头"""
        ensure_output_dir(self.output_path)
        if not os.path.exists(self.output_path):
            with open(self.output_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=self.headers)
                writer.writeheader()
    
    def add_row(self, row: Dict[str, Any]):
        """添加一行数据到缓冲区"""
        self.buffer.append(row)
        if len(self.buffer) >= self.batch_size:
            self.flush()
    
    def flush(self):
        """将缓冲区数据写入文件"""
        if not self.buffer:
            return
        
        try:
            with open(self.output_path, "a", newline="", encoding="utf-8-sig") as f:
                writer = csv.DictWriter(f, fieldnames=self.headers)
                for row in self.buffer:
                    writer.writerow(row)
            
            self.total_written += len(self.buffer)
            print(f"已写入 {len(self.buffer)} 条记录到 {os.path.basename(self.output_path)} (总计: {self.total_written})")
            self.buffer.clear()
        except Exception as e:
            print(f"写入CSV文件失败: {e}")
    
    def close(self):
        """关闭写入器，确保所有数据都被写入"""
        self.flush()


def load_session_if_exists(session_file: str = "./session_videoID.json") -> Optional[Dict[str, Any]]:
    """加载已保存的session状态"""
    if os.path.exists(session_file):
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"加载session文件失败: {e}")
    return None


def check_login_status(page: Page) -> bool:
    """检查页面是否已登录"""
    try:
        # 检查是否存在登录相关的元素
        login_indicators = [
            'a[href*="login"]',
            'a[href*="register"]', 
            '.login-form',
            '#login-form'
        ]
        
        for selector in login_indicators:
            if page.locator(selector).count() > 0:
                return False
        
        # 检查是否存在用户相关的元素
        user_indicators = [
            'a[href*="profile"]',
            'a[href*="user"]',
            '.user-menu',
            '.logout'
        ]
        
        for selector in user_indicators:
            if page.locator(selector).count() > 0:
                return True
                
        return True  # 默认认为已登录
    except Exception:
        return False


def setup_playwright_page(playwright: Playwright, session_file: str = "./session_videoID.json") -> Tuple[Page, BrowserContext]:
    """设置Playwright页面和浏览器上下文"""
    # 启动浏览器
    try:
        browser = playwright.chromium.launch(
            headless=False,
            channel="msedge",
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ]
        )
    except Exception as e:
        print(f"Edge浏览器启动失败，回退到Chromium: {e}")
        browser = playwright.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ]
        )
    
    # 加载session状态
    session_state = load_session_if_exists(session_file)
    if not session_state:
        print(f"未发现 {session_file}，请先使用 Playwright codegen 登录并保存会话")
        print(f"示例：python -m playwright codegen --channel=msedge --save-storage={session_file} https://missav.live/")
        browser.close()
        raise RuntimeError("Session文件不存在")
    
    # 创建浏览器上下文，不立即加载storage_state
    try:
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            extra_http_headers={
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
            },
            accept_downloads=True
        )
        
        # 手动添加cookies
        if 'cookies' in session_state:
            context.add_cookies(session_state['cookies'])
            
    except Exception as e:
        print(f"创建浏览器上下文失败: {e}")
        # 如果手动添加cookies失败，尝试使用storage_state
        try:
            context = browser.new_context(
                storage_state=session_state,
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                viewport={'width': 1920, 'height': 1080},
                extra_http_headers={
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
                },
                accept_downloads=True
            )
        except Exception as e2:
            print(f"使用storage_state创建上下文也失败: {e2}")
            browser.close()
            raise RuntimeError(f"无法创建浏览器上下文: {e2}")
    
    page = context.new_page()
    stealth_sync(page)
    
    # 添加反检测脚本
    page.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        Object.defineProperty(navigator, 'languages', {
            get: () => ['zh-CN', 'zh', 'en'],
        });
        
        window.chrome = {
            runtime: {},
        };
    """)
    
    return page, context


def sleep_delay(delay: float):
    """延时函数"""
    try:
        time.sleep(max(0.0, float(delay)))
    except Exception:
        time.sleep(1.0)


def get_page_content(page: Page, url: str, timeout: int, delay: float, retries: int, referer: Optional[str] = None) -> str:
    """使用Playwright获取页面内容"""
    last_err = None
    
    for attempt in range(retries + 1):
        # 基础限速 + 抖动 + 轻度退避
        jitter = random.uniform(0.15, 0.45)
        backoff = min(2.0, 0.4 * attempt)
        sleep_delay(max(0.0, float(delay) + jitter + backoff))
        
        try:
            # 设置Referer
            if referer:
                page.set_extra_http_headers({"Referer": referer})
            
            # 导航到页面
            response = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            
            if response and (response.status == 403 or 500 <= response.status < 600):
                last_err = RuntimeError(f"HTTP {response.status}")
                continue
            
            # 等待页面加载
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except:
                pass  # 忽略网络空闲超时
            
            return page.content()
            
        except Exception as e:
            last_err = e
            print(f"尝试 {attempt + 1}/{retries + 1} 失败: {e}")
    
    raise last_err if last_err else RuntimeError("Unknown error")


def normalize_video_id(text: str) -> Tuple[str, str]:
    """从文本中提取并标准化视频ID"""
    if not text:
        return "", ""
    
    # 常见的视频ID模式
    patterns = [
        # FC2-PPV 系列
        (r'\bFC2[-\s]*PPV[-\s]*(\d+)\b', "FC2-PPV", lambda m: f"FC2-PPV-{m.group(1)}"),
        # 标准番号格式 (字母-数字)
        (r'\b([A-Z]{2,10})[-\s]*(\d{3,6})\b', "STANDARD", lambda m: f"{m.group(1)}-{m.group(2).zfill(3)}"),
        # 纯数字ID
        (r'\b(\d{6,10})\b', "NUMERIC", lambda m: m.group(1)),
    ]
    
    text_upper = text.upper()
    
    for pattern, pattern_type, formatter in patterns:
        match = re.search(pattern, text_upper)
        if match:
            try:
                return formatter(match), pattern_type
            except:
                continue
    
    return "", ""


def extract_actress_name(soup: BeautifulSoup) -> str:
    """从页面中提取演员名称"""
    # og:title 优先
    og = soup.find("meta", attrs={"property": "og:title"})
    if og and og.get("content"):
        return og["content"].strip()
    
    # title 次之
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    
    # h1/h2 兜底
    for tag in soup.select("h1, h2"):
        txt = tag.get_text(strip=True)
        if txt:
            return txt
    
    return ""


def extract_video_items(soup: BeautifulSoup, base_url: str) -> List[Tuple[str, str]]:
    """从演员页中提取视频条目"""
    items = []
    seen = set()

    # 优先：a 标签文本包含番号
    for a in soup.find_all("a"):
        txt = a.get_text(" ", strip=True)
        if not txt:
            continue
        
        vid, _ = normalize_video_id(txt)
        if not vid:
            continue
        
        href = a.get("href") or ""
        abs_url = urljoin(base_url, href) if href else ""
        if not abs_url:
            continue
        
        path = (urlparse(abs_url).path or "").lower()
        
        # 显式忽略非作品链接
        if "/actresses/ranking" in path:
            continue
        
        # 仅接受与番号对应的作品详情URL
        slug = vid.lower()
        candidates = {slug}
        
        # FC2 两种常见形式互相兼容
        if slug.startswith("fc2-ppv-"):
            candidates.add(slug.replace("fc2-ppv-", "fc2-"))
        if slug.startswith("fc2-") and not slug.startswith("fc2-ppv-"):
            candidates.add(slug.replace("fc2-", "fc2-ppv-"))
        
        # 匹配基本形式或后缀扩展形式
        if not any(c in path for c in candidates) and not any((c + "-") in path for c in candidates):
            continue
        
        key = abs_url or (txt + "|" + base_url)
        if key in seen:
            continue
        
        seen.add(key)
        items.append((txt, abs_url))

    # 次选：img alt 属性包含番号
    for img in soup.find_all("img"):
        alt = img.get("alt", "").strip()
        if not alt:
            continue
        
        vid, _ = normalize_video_id(alt)
        if not vid:
            continue
        
        # 查找包含此图片的链接
        parent_a = img.find_parent("a")
        if not parent_a:
            continue
        
        href = parent_a.get("href") or ""
        abs_url = urljoin(base_url, href) if href else ""
        if not abs_url:
            continue
        
        key = abs_url or (alt + "|" + base_url)
        if key in seen:
            continue
        
        seen.add(key)
        items.append((alt, abs_url))

    return items


def detect_pagination_style_and_max_pages(soup: BeautifulSoup, actress_url: str, max_pages: int) -> List[str]:
    """检测分页样式并生成分页URL列表"""
    numbers = []
    style = None
    
    # 查找分页链接
    for a in soup.find_all("a"):
        href = a.get("href", "")
        if not href:
            continue
        
        # 检查是否为分页链接
        if re.search(r'/page/\d+', href):
            style = "path"
            match = re.search(r'/page/(\d+)', href)
            if match:
                numbers.append(int(match.group(1)))
        elif "page=" in href:
            style = "query"
            parsed = urlparse(href)
            query_params = parse_qs(parsed.query)
            if "page" in query_params:
                try:
                    numbers.append(int(query_params["page"][0]))
                except (ValueError, IndexError):
                    pass
    
    # 如果没有检测到分页样式，默认使用query风格
    if style is None:
        style = "query"
    
    max_num = max(numbers) if numbers else 1
    max_num = min(max_num, max_pages)
    
    # 生成完整分页URL列表
    urls = []
    if style == "path":
        # /.../page/N 风格
        base = urlparse(actress_url)
        base_path = base.path.rstrip("/")
        for i in range(1, max_num + 1):
            if i == 1:
                urls.append(actress_url)
            else:
                new_path = f"{base_path}/page/{i}"
                urls.append(urlunparse((base.scheme, base.netloc, new_path, "", "", "")))
    else:
        # 默认和 MissAV 一致：?page=N 风格
        parsed = urlparse(actress_url)
        base_q = parse_qs(parsed.query)
        base_q.pop("page", None)
        # page=1 使用原始 URL，其余使用 ?page=i
        urls.append(urlunparse(parsed._replace(query=urlencode(base_q, doseq=True))))
        for i in range(2, max_num + 1):
            q = {**base_q, "page": [i]}
            urls.append(urlunparse(parsed._replace(query=urlencode(q, doseq=True))))
    
    return urls


def ensure_output_dir(path: str):
    """确保输出目录存在"""
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)


def write_csv(rows: List[Dict[str, Any]], output_path: str):
    """写入CSV文件"""
    ensure_output_dir(output_path)
    headers = [
        "video_title",
        "video_url", 
        "video_type",
        "video_id",
        "id_pattern_type",
        "page_no",
    ]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def derive_actor_name_from_url(url: str) -> str:
    """从URL推导演员名"""
    try:
        path = urlparse(url).path or ""
        if path.endswith("/"):
            path = path[:-1]
        last = path.rsplit("/", 1)[-1] if path else ""
        name = unquote(last).strip()
        return name or "unknown"
    except Exception:
        return "unknown"


def sanitize_filename(name: str, max_len: int = 80) -> str:
    """清理文件名"""
    invalid = r'<>:"/\\|?*'
    trans = str.maketrans({ch: "_" for ch in invalid})
    s = name.translate(trans)
    s = s.rstrip(" .")
    if len(s) > max_len:
        s = s[:max_len].rstrip(" .")
    return s or "unknown"


def save_debug_html(content: str, actress_name: str, page_no: int, retry_count: int = 0):
    """保存调试用的HTML文件"""
    debug_dir = f"output/_html_debug/{actress_name}"
    ensure_output_dir(debug_dir + "/dummy.txt")
    
    suffix = f"-retry{retry_count}" if retry_count > 0 else ""
    filename = f"{page_no:03d}{suffix}.html"
    filepath = os.path.join(debug_dir, filename)
    
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[DEBUG] 已保存HTML调试文件: {filepath}")
    except Exception as e:
        print(f"[WARN] 保存HTML调试文件失败: {e}")


def crawl_actress_playwright(actress_url: str, concurrency: int, delay: float, retries: int, timeout: int, max_pages: int):
    """使用Playwright抓取演员页面"""
    with sync_playwright() as playwright:
        page, context = setup_playwright_page(playwright)
        
        try:
            # 访问首页进行预热
            try:
                sleep_delay(delay)
                page.goto("https://missav.live/", wait_until="domcontentloaded", timeout=timeout * 1000)
                print("网站预热成功")
            except Exception as e:
                print(f"[WARN] 网站预热失败: {e}")
            
            # 检查登录状态
            if not check_login_status(page):
                print("未检测到登录状态，请检查session文件")
                return
            
            print("登录状态验证成功")
            
            # 如果是dm18路径，进行额外预热
            if "/dm18/" in actress_url:
                try:
                    sleep_delay(delay)
                    page.goto("https://missav.live/dm18/", wait_until="domcontentloaded", timeout=timeout * 1000)
                    print("dm18路径预热成功")
                except Exception as e:
                    print(f"[WARN] dm18预热失败: {e}")
            
            # 获取第一页内容
            print(f"正在访问演员页面: {actress_url}")
            content = get_page_content(page, actress_url, timeout, delay, retries)
            soup = BeautifulSoup(content, "html.parser")
            
            # 提取演员名称 - 优先从URL提取，回退到页面内容
            actress_name = derive_actor_name_from_url(actress_url)
            if not actress_name:
                actress_name = extract_actress_name(soup)
            actress_name = sanitize_filename(actress_name)
            
            print(f"演员名称: {actress_name}")
            
            # 保存调试HTML
            save_debug_html(content, actress_name, 1)
            
            # 检测分页并生成URL列表
            page_urls = detect_pagination_style_and_max_pages(soup, actress_url, max_pages)
            print(f"检测到 {len(page_urls)} 个分页")
            
            all_rows = []
            
            # 处理每一页
            for page_no, page_url in enumerate(page_urls, 1):
                print(f"正在处理第 {page_no}/{len(page_urls)} 页: {page_url}")
                
                # 如果不是第一页，需要重新获取内容
                if page_no > 1:
                    try:
                        content = get_page_content(page, page_url, timeout, delay, retries)
                        soup = BeautifulSoup(content, "html.parser")
                        save_debug_html(content, actress_name, page_no)
                    except Exception as e:
                        print(f"获取第 {page_no} 页失败: {e}")
                        continue
                
                # 提取视频条目
                items = extract_video_items(soup, page_url)
                print(f"第 {page_no} 页找到 {len(items)} 个视频")
                
                # 转换为CSV行
                for title, url in items:
                    video_id, pattern_type = normalize_video_id(title)
                    
                    # 确定视频类型 - 与videoID-spider.py保持一致
                    video_type = "普通"
                    if url and "uncensored-leak" in url:
                        video_type = "无码破解"
                    elif url and "chinese-subtitle" in url:
                        video_type = "中文字幕"
                    
                    row = {
                        "video_title": title,
                        "video_url": url,
                        "video_type": video_type,
                        "video_id": video_id,
                        "id_pattern_type": pattern_type,
                        "page_no": page_no,
                    }
                    all_rows.append(row)
            
            # 输出结果
            output_path = f"output/actor_{actress_name}.csv"
            write_csv(all_rows, output_path)
            
            print(f"\n抓取完成!")
            print(f"总共找到 {len(all_rows)} 个视频")
            print(f"结果已保存到: {output_path}")
            
            # 保存更新后的session
            try:
                context.storage_state(path="./session_videoID.json")
                print("Session状态已更新")
            except Exception as e:
                print(f"保存session失败: {e}")
        
        finally:
            page.close()
            context.close()


def crawl_all_actresses_with_resume(concurrency: int = 1, delay: float = 1.0, retries: int = 3, timeout: int = 30, max_actress_pages: int = 999, actresses_max_pages: int = 50):
    """
    批量抓取所有演员页面，支持断点续传和增量写入
    """
    # 初始化进度管理器
    progress_manager = ProgressManager()
    progress_manager.print_progress()
    
    with sync_playwright() as playwright:
        page, context = setup_playwright_page(playwright)
        
        try:
            # 网站预热
            print("正在预热网站...")
            page.goto("https://missav.live/cn", timeout=timeout * 1000)
            time.sleep(delay)
            
            # 检查登录状态
            if not check_login_status(page):
                print("警告: 未检测到登录状态，可能影响抓取效果")
            else:
                print("登录状态验证成功")
            
            # 获取所有演员详情页URL
            print("正在获取演员列表...")
            actresses_urls = get_all_actresses_urls(page, timeout, delay, retries, max_list_pages=actresses_max_pages, resume=True, progress_manager=progress_manager)
            print(f"获取到 {len(actresses_urls)} 个演员详情页")
            
            # 设置总演员数
            progress_manager.set_total_actresses(len(actresses_urls))
            
            # 遍历每个演员
            for actress_url in actresses_urls:
                actress_name = derive_actor_name_from_url(actress_url)
                
                # 检查是否已完成
                if progress_manager.is_actress_completed(actress_name):
                    print(f"演员 {actress_name} 已完成，跳过")
                    continue
                
                print(f"\n开始处理演员: {actress_name}")
                print(f"演员页面: {actress_url}")
                
                # 开始处理演员
                progress_manager.start_actress(actress_name, actress_url)
                
                # 准备CSV写入器
                output_path = f"./output/actor_{sanitize_filename(actress_name)}.csv"
                csv_writer = IncrementalCSVWriter(output_path, batch_size=10)
                
                try:
                    # 获取演员的恢复信息
                    start_page, existing_videos = progress_manager.get_actress_resume_info(actress_name)
                    
                    if start_page > 1:
                        print(f"从第 {start_page} 页继续抓取 (已有 {existing_videos} 个视频)")
                    
                    # 访问演员页面
                    content = get_page_content(page, actress_url, timeout, delay, retries)
                    soup = BeautifulSoup(content, "html.parser")
                    save_debug_html(content, actress_name, 1)
                    
                    # 检测总页数
                    page_urls = detect_pagination_style_and_max_pages(soup, actress_url, max_actress_pages)
                    total_pages = len(page_urls)
                    print(f"检测到 {total_pages} 个分页")
                    progress_manager.update_actress_pages(actress_name, total_pages)
                    
                    # 遍历所有页面
                    for page_no, page_url in enumerate(page_urls, 1):
                        if page_no < start_page:
                            continue
                            
                        print(f"正在处理第 {page_no}/{total_pages} 页...")
                        
                        # 如果不是第一页，需要重新获取内容
                        if page_no > 1:
                            try:
                                content = get_page_content(page, page_url, timeout, delay, retries)
                                soup = BeautifulSoup(content, "html.parser")
                                save_debug_html(content, actress_name, page_no)
                            except Exception as e:
                                error_msg = f"获取第 {page_no} 页失败: {e}"
                                print(error_msg)
                                progress_manager.add_error(actress_name, error_msg)
                                continue
                        
                        # 提取视频条目
                        items = extract_video_items(soup, page_url)
                        print(f"第 {page_no} 页找到 {len(items)} 个视频")
                        
                        # 处理每个视频
                        for title, url in items:
                            video_id, pattern_type = normalize_video_id(title)
                            
                            # 确定视频类型
                            video_type = "普通"
                            if url and "uncensored-leak" in url:
                                video_type = "无码破解"
                            elif url and "chinese-subtitle" in url:
                                video_type = "中文字幕"
                          
                            row = {
                                "video_title": title,
                                "video_url": url,
                                "video_type": video_type,
                                "video_id": video_id,
                                "id_pattern_type": pattern_type,
                                "page_no": page_no,
                            }
                            
                            # 增量写入CSV
                            csv_writer.add_row(row)
                        
                        # 在每页结束后强制刷新，确保缓冲区内容全部落盘，避免中断造成漏写
                        csv_writer.flush()
                        
                        # 完成页面处理
                        progress_manager.complete_page(actress_name, page_no, len(items))
                        
                        # 显示当前进度
                        current_videos = progress_manager.progress["actresses_status"][actress_name]["total_videos"]
                        print(f"演员 {actress_name}: 第 {page_no}/{total_pages} 页完成，当前共 {current_videos} 个视频")
                        
                        # 页面间延时
                        if page_no < total_pages:
                            time.sleep(delay)
                
                    # 确保所有数据都写入
                    csv_writer.close()
                    
                    # 完成演员处理
                    progress_manager.complete_actress(actress_name)
                    
                    total_videos = progress_manager.progress["actresses_status"][actress_name]["total_videos"]
                    print(f"演员 {actress_name} 抓取完成! 总共找到 {total_videos} 个视频")
                    print(f"结果已保存到: {output_path}")
                    
                except KeyboardInterrupt:
                    # 捕获用户中断，先将缓冲区写入磁盘再退出，避免漏写
                    print(f"\n用户中断，正在保存已抓取的数据...")
                    try:
                        csv_writer.close()
                    except Exception as close_error:
                        print(f"关闭CSV写入器时出错: {close_error}")
                    raise  # 重新抛出KeyboardInterrupt
                except Exception as e:
                    error_msg = f"处理演员 {actress_url} 时出错: {e}"
                    print(error_msg)
                    progress_manager.add_error(actress_name, error_msg)
                    csv_writer.close()  # 确保关闭写入器
                    continue
                
                # 演员间延时
                time.sleep(delay)
                
                # 每处理完一个演员显示总体进度
                progress_manager.print_progress()
            
            print(f"\n{'='*60}")
            print("所有演员抓取完成!")
            progress_manager.print_progress()
            print(f"{'='*60}")
            
            # 保存更新后的session
            try:
                context.storage_state(path="./session_videoID.json")
                print("Session状态已更新")
            except Exception as e:
                print(f"保存session失败: {e}")
        
        finally:
            page.close()
            context.close()



def get_all_actresses_urls(page: Page, timeout: int, delay: float, retries: int, max_list_pages: int = 50, resume: bool = True, progress_key: str = "actress_list", progress_manager: Optional[ProgressManager] = None) -> List[str]:
    """获取所有演员的详情页URL（支持翻页 + 列表断点续抓）"""
    base_list_url = "https://missav.live/cn/actresses"
    
    # 读取已保存的列表抓取进度
    if progress_manager is None:
        progress_manager = ProgressManager()
    
    saved_last_page = 0
    saved_urls: List[str] = []
    if resume:
        try:
            saved = progress_manager.progress.get(progress_key, {}) or {}
            saved_last_page = int(saved.get("last_page", 0) or 0)
            saved_urls = list(saved.get("urls", []) or [])
        except Exception:
            # 容错：进度损坏时忽略，重新开始
            saved_last_page = 0
            saved_urls = []
    
    actress_urls: List[str] = list(saved_urls)
    seen = set(saved_urls)
    current_page = saved_last_page + 1 if (resume and saved_last_page >= 1) else 1
    
    while current_page <= max_list_pages:
        try:
            list_url = base_list_url if current_page == 1 else f"{base_list_url}?page={current_page}"
            print(f"正在获取演员列表第 {current_page} 页: {list_url}")
            
            content = get_page_content(page, list_url, timeout, delay, retries)
            soup = BeautifulSoup(content, "html.parser")
            
            page_new = 0
            for a in soup.find_all("a", href=True):
                href = a.get("href", "")
                if not href:
                    continue
                # 仅保留符合 /dm 且 /actresses/ 的详情页，且排除排行榜
                if "/dm" in href and "/actresses/" in href and "/actresses/ranking" not in href:
                    abs_url = urljoin(base_list_url, href)
                    if abs_url not in seen:
                        seen.add(abs_url)
                        actress_urls.append(abs_url)
                        page_new += 1
            print(f"第 {current_page} 页新增 {page_new} 个演员，总计 {len(actress_urls)}")
            
            # 按页持久化列表抓取进度（即便中途失败也能从当前页续抓）
            if resume:
                try:
                    progress_manager.progress[progress_key] = {
                        "last_page": current_page,
                        "urls": actress_urls,
                    }
                    progress_manager.save_progress()
                except Exception as e:
                    print(f"保存演员列表抓取进度失败: {e}")
            
            # 若本页没有新增演员，则停止翻页
            if page_new == 0:
                print(f"第 {current_page} 页无新增演员，停止翻页")
                break
            
            current_page += 1
            time.sleep(delay)
        except Exception as e:
            print(f"获取演员列表第 {current_page} 页失败: {e}")
            # 第一页失败则直接返回；后续页失败视作到达末尾
            if current_page == 1:
                return actress_urls
            else:
                break
    
    print(f"总共找到 {len(actress_urls)} 个演员详情页 (抓取到第 {current_page - 1} 页)")
    return actress_urls


def main():
    # 设置默认参数，不再解析命令行参数
    concurrency = 1
    delay = 1.0
    retries = 3
    timeout = 30
    max_actress_pages = 6  # 每个演员的最大作品页数（测试用）
    actresses_max_pages = 10  # 演员列表最大页数（测试用）
    
    print("MissAV 演员页面视频ID批量抓取脚本 (Playwright版本)")
    print(f"并发数: {concurrency}")
    print(f"延时: {delay}s")
    print(f"重试: {retries}次")
    print(f"超时: {timeout}s")
    print(f"每个演员最大页数: {max_actress_pages}")
    print(f"演员列表最大页数: {actresses_max_pages}")
    print(f"支持断点续传和增量写入 (每10个视频写入一次)")
    print("-" * 50)
    
    try:
        # 使用支持断点续传的函数
        crawl_all_actresses_with_resume(concurrency, delay, retries, timeout, max_actress_pages, actresses_max_pages)
    except Exception as e:
        print(f"抓取失败: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())