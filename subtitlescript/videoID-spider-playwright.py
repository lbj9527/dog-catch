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


def main():
    parser = argparse.ArgumentParser(description="MissAV 演员页面视频ID抓取脚本 (Playwright版本)")
    parser.add_argument("--actress-url", required=True, help="演员页面URL")
    parser.add_argument("--concurrency", type=int, default=3, help="并发数 (默认: 3)")
    parser.add_argument("--delay", type=float, default=2.0, help="请求间隔秒数 (默认: 2.0)")
    parser.add_argument("--retries", type=int, default=3, help="重试次数 (默认: 3)")
    parser.add_argument("--timeout", type=int, default=30, help="请求超时秒数 (默认: 30)")
    parser.add_argument("--max-pages", type=int, default=50, help="最大抓取页数 (默认: 50)")
    
    args = parser.parse_args()
    
    print("MissAV 演员页面视频ID抓取脚本 (Playwright版本)")
    print(f"演员URL: {args.actress_url}")
    print(f"并发数: {args.concurrency}")
    print(f"延时: {args.delay}s")
    print(f"重试: {args.retries}次")
    print(f"超时: {args.timeout}s")
    print(f"最大页数: {args.max_pages}")
    print("-" * 50)
    
    try:
        crawl_actress_playwright(
            args.actress_url,
            args.concurrency,
            args.delay,
            args.retries,
            args.timeout,
            args.max_pages
        )
    except Exception as e:
        print(f"抓取失败: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())