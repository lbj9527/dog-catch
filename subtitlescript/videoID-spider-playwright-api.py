#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MissAV 演员页面视频ID抓取脚本 (Playwright版本)

用法示例:
python videoID-spider-playwright.py --actress-url "https://missav.live/actresses/七海蒂娜" --concurrency 3 --delay 2.0 --retries 3 --max-pages 10

功能:
- 输入: 演员页面URL
- 处理: 自动分页抓取该演员的所有视频
- 输出: 数据库存储，包含视频标题、URL、类型、ID等信息

注意事项:
- 需要先使用gensession.txt中的命令生成session_videoID.json
- 使用Playwright进行网页抓取，支持反爬机制
- 自动处理分页和重试机制
"""

import argparse
import json
import os
import random
import re
import sqlite3
import time
from typing import List, Tuple, Optional, Dict, Any
from urllib.parse import urljoin, urlparse, urlunparse, parse_qs, urlencode, unquote

from playwright.sync_api import Playwright, sync_playwright, Page, BrowserContext
from playwright_stealth.stealth import stealth_sync
from bs4 import BeautifulSoup
from datetime import datetime
from pathlib import Path


class ProgressManager:
    """进度管理器，使用数据库存储进度信息"""
    
    def __init__(self, db_path: str = "./database/actresses.db"):
        from database_manager import DatabaseManager
        self.db_manager = DatabaseManager(db_path)
        # 初始化抓取会话
        self.session_id = self.db_manager.init_crawl_session()
    
    def set_total_actresses(self, total: int):
        """设置总演员数"""
        self.db_manager.update_crawl_progress(total_actresses=total)
    
    def start_actress(self, actress_name: str, actress_url: str):
        """开始处理演员"""
        self.db_manager.start_actress(actress_name, actress_url)
    
    def update_actress_pages(self, actress_name: str, total_pages: int):
        """更新演员总页数"""
        self.db_manager.update_actress_pages(actress_name, total_pages)
    
    def complete_page(self, actress_name: str, page_no: int, position_in_page: int = None):
        """完成页面处理，支持作品级别的进度记录"""
        self.db_manager.complete_page(actress_name, page_no, position_in_page)
    
    def complete_actress(self, actress_name: str):
        """完成演员处理"""
        self.db_manager.complete_actress(actress_name)
    
    def add_error(self, actress_name: str, error_msg: str):
        """添加错误记录"""
        self.db_manager.add_actress_error(actress_name, error_msg)
    
    def is_actress_completed(self, actress_name: str) -> bool:
        """检查演员是否已完成"""
        return self.db_manager.is_actress_completed(actress_name)
    
    def get_actress_resume_info(self, actress_name: str) -> Tuple[int, int]:
        """获取演员的恢复信息 (last_page, total_videos)"""
        return self.db_manager.get_actress_resume_info(actress_name)
    
    def print_progress(self):
        """打印当前进度"""
        self.db_manager.print_progress()


class DatabaseWriter:
    """数据库写入器，用于将数据存储到数据库"""
    
    def __init__(self, actress_name: str, db_path: str = "./database/actresses.db", batch_size: int = 10):
        from database_manager import DatabaseManager
        self.actress_name = actress_name
        self.db_manager = DatabaseManager(db_path)
        self.batch_size = batch_size
        self.buffer = []
        self.total_written = 0
        
        # 确保演员表存在
        self.db_manager.create_actress_table(actress_name)
    
    def add_row(self, row: Dict[str, Any]):
        """添加一行数据到缓冲区"""
        self.buffer.append(row)
        if len(self.buffer) >= self.batch_size:
            self.flush()
    
    def flush(self):
        """将缓冲区数据写入数据库"""
        if not self.buffer:
            return
        
        try:
            self.db_manager.insert_videos(self.actress_name, self.buffer)
            self.total_written += len(self.buffer)
            print(f"已写入 {len(self.buffer)} 条记录到数据库 (演员: {self.actress_name}, 总计: {self.total_written})")
            self.buffer.clear()
        except Exception as e:
            print(f"写入数据库失败: {e}")
    
    def close(self):
        """关闭写入器，确保所有数据都被写入"""
        self.flush()


def ensure_output_dir(path: str):
    """确保输出目录存在"""
    d = os.path.dirname(os.path.abspath(path))
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)


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
                
                # 转换为数据行
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
            
            print(f"\n抓取完成!")
            print(f"总共找到 {len(all_rows)} 个视频")
            print("结果已保存到数据库")
            
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
                
                # 准备数据库写入器
                db_writer = DatabaseWriter(actress_name, batch_size=10)
                
                try:
                    # 获取演员的恢复信息（作品级别）
                    last_page, last_position, existing_videos = progress_manager.db_manager.get_actress_last_video_info(actress_name)
                    
                    if last_page > 1 or last_position > 0:
                        # 检查是否需要显示断点恢复信息
                        if last_position == 12:  # 假设每页12个作品，页面已完成
                            print(f"从第 {last_page + 1} 页开始继续抓取 (已有 {existing_videos} 个视频)")
                        else:
                            print(f"从第 {last_page} 页第 {last_position + 1} 个作品继续抓取 (已有 {existing_videos} 个视频)")
                    
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
                        # 跳过已完成的页面
                        # 如果当前页面小于last_page，直接跳过
                        # 如果当前页面等于last_page，需要检查该页面是否已完全处理完成
                        if page_no < last_page:
                            continue
                        elif page_no == last_page:
                            # 检查该页面是否已完全处理完成
                            # 如果last_position_in_page等于该页面的作品总数，说明该页面已完成，跳过
                            # 否则需要继续处理该页面的剩余作品
                            # 这里我们先获取页面内容来确定作品数量
                            if last_position > 0:
                                # 获取页面内容检查作品数量
                                temp_content = get_page_content(page, page_url, timeout, delay, retries)
                                temp_soup = BeautifulSoup(temp_content, "html.parser")
                                temp_items = extract_video_items(temp_soup, page_url)
                                
                                # 如果last_position等于或大于页面作品数，说明该页面已完成
                                if last_position >= len(temp_items):
                                    print(f"第 {page_no} 页已完成 ({last_position}/{len(temp_items)} 个作品)，跳过")
                                    continue
                                else:
                                    print(f"第 {page_no} 页部分完成 ({last_position}/{len(temp_items)} 个作品)，继续处理")
                            # 如果last_position为0，说明该页面还没开始处理
                            
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
                        for position, (title, url) in enumerate(items):
                            # 如果是当前恢复页面，跳过已处理的作品
                            if page_no == last_page and position < last_position:
                                continue
                            
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
                            
                            # 增量写入数据库
                            db_writer.add_row(row)
                            
                            # 作品级进度更新：每保存一个作品后立即更新进度
                            # position是从0开始的，所以当前位置是position+1
                            progress_manager.complete_page(actress_name, page_no, position + 1)
                            
                            # 强制刷新，确保进度立即保存到数据库
                            db_writer.flush()
                        
                        # 页面完全处理完成后，确保进度正确记录为页面完成状态
                        # 这里传入页面的总作品数，确保记录页面已完成
                        progress_manager.complete_page(actress_name, page_no, len(items))
                        
                        # 在每页结束后强制刷新，确保缓冲区内容全部落盘，避免中断造成漏写
                        db_writer.flush()
                        
                        # 显示当前进度 - 使用累计计数而不是数据库查询
                        # 避免因为complete_page中的total_videos更新导致的计数混乱
                        cumulative_videos = (page_no - 1) * 12 + len(items)  # 假设每页12个视频
                        print(f"演员 {actress_name}: 第 {page_no}/{total_pages} 页完成，本页 {len(items)} 个视频")
                        
                        # 页面间延时
                        if page_no < total_pages:
                            time.sleep(delay)
                
                    # 确保所有数据都写入
                    db_writer.close()
                    
                    # 完成演员处理
                    progress_manager.complete_actress(actress_name)
                    
                    total_videos = progress_manager.db_manager.get_actress_video_count(actress_name)
                    print(f"演员 {actress_name} 抓取完成! 总共找到 {total_videos} 个视频")
                    print(f"结果已保存到数据库")
                    
                except KeyboardInterrupt:
                    # 捕获用户中断，先将缓冲区写入磁盘再退出，避免漏写
                    print(f"\n用户中断，正在保存已抓取的数据...")
                    try:
                        db_writer.close()
                    except Exception as close_error:
                        print(f"关闭数据库写入器时出错: {close_error}")
                    raise  # 重新抛出KeyboardInterrupt
                except Exception as e:
                    error_msg = f"处理演员 {actress_url} 时出错: {e}"
                    print(error_msg)
                    progress_manager.add_error(actress_name, error_msg)
                    db_writer.close()  # 确保关闭写入器
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
            # 从数据库获取演员列表抓取进度
            saved_last_page, total_count = progress_manager.db_manager.get_actress_list_progress()
            print(f"从数据库加载演员列表抓取进度: 最后页数={saved_last_page}, 总数={total_count}")
            
            # 从数据库获取已保存的演员URL
            saved_urls = progress_manager.db_manager.get_all_actress_urls()
            print(f"从数据库加载已保存的演员URL数量: {len(saved_urls)}")
        except Exception as e:
            # 容错：进度损坏时忽略，重新开始
            print(f"加载演员列表抓取进度失败: {e}")
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
            
            # 增量保存：每页抓取完成后立即保存新增的演员URL
            if page_new > 0 and progress_manager:
                try:
                    # 获取本页新增的URL（最后page_new个）
                    new_urls_this_page = actress_urls[-page_new:]
                    progress_manager.db_manager.save_actress_urls(new_urls_this_page, current_page)
                    print(f"✓ 已增量保存第 {current_page} 页的 {page_new} 个演员URL")
                except Exception as e:
                    print(f"✗ 增量保存演员URL失败: {e}")
            
            # 按页持久化列表抓取进度（即便中途失败也能从当前页续抓）
            if resume:
                try:
                    # 使用数据库存储演员列表抓取进度
                    progress_manager.db_manager.update_crawl_progress(
                        total_actresses=len(actress_urls)
                    )
                    # 保存演员列表抓取进度
                    progress_manager.db_manager.update_actress_list_progress(
                        current_page, len(actress_urls)
                    )
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
    
    # 备用保存：确保所有URL都已保存（防止增量保存过程中有遗漏）
    if actress_urls and progress_manager:
        try:
            # 检查数据库中已保存的URL数量
            saved_urls = progress_manager.db_manager.get_all_actress_urls()
            if len(saved_urls) < len(actress_urls):
                # 如果数据库中的URL数量少于当前获取的数量，进行补充保存
                missing_count = len(actress_urls) - len(saved_urls)
                print(f"检测到 {missing_count} 个URL未保存，进行补充保存...")
                progress_manager.db_manager.save_actress_urls(actress_urls, current_page - 1)
                print(f"✓ 备用保存完成，总计 {len(actress_urls)} 个演员URL")
            else:
                print(f"✓ 所有 {len(actress_urls)} 个演员URL已通过增量保存完成")
        except Exception as e:
            print(f"✗ 备用保存演员URL失败: {e}")
    
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