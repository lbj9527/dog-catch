#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MissAV 视频详情抓取脚本

用法示例:
python video_detail_scraper.py --url "https://missav.live/cn/umso-612"

功能:
- 输入: 视频详情页面URL
- 处理: 抓取视频的详情描述和元数据信息
- 输出: 控制台打印详情信息

注意事项:
- 需要先使用gensession.txt中的命令生成session_videoID.json
- 使用Playwright进行网页抓取，支持反爬机制
"""

import argparse
import json
import os
import time
from typing import Dict, List, Optional
from urllib.parse import urljoin

from playwright.sync_api import Playwright, sync_playwright, Page, BrowserContext
from playwright_stealth.stealth import stealth_sync
from bs4 import BeautifulSoup


def load_session_if_exists(session_file: str = "./session_videoID.json") -> Optional[Dict]:
    """加载已保存的session状态"""
    if os.path.exists(session_file):
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"加载session文件失败: {e}")
    return None


def setup_playwright_page(playwright: Playwright, session_file: str = "./session_videoID.json") -> tuple[Page, BrowserContext]:
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
    
    # 创建浏览器上下文
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


def extract_video_description(soup: BeautifulSoup) -> str:
    """提取视频详情描述"""
    # 查找包含 line-clamp-2 类的 div 元素
    desc_div = soup.find("div", class_=lambda x: x and "line-clamp-2" in x)
    if desc_div:
        return desc_div.get_text(strip=True)
    return ""


def extract_cover_url(soup: BeautifulSoup) -> str:
    """提取视频封面URL - 优化版本"""
    # 优化：直接查找最常见的情况 - video标签的data-poster属性
    video_tag = soup.find("video", {"data-poster": True})
    if video_tag:
        poster_url = video_tag.get("data-poster")
        if poster_url and poster_url.strip():
            return poster_url.strip()
    
    # 备用方案1: 查找video标签的poster属性
    video_tag = soup.find("video", poster=True)
    if video_tag:
        poster_url = video_tag.get("poster")
        if poster_url and poster_url.strip():
            return poster_url.strip()
    
    # 备用方案2: 查找包含 plyr__poster 类的 div 元素
    poster_div = soup.find("div", class_="plyr__poster")
    if poster_div:
        style = poster_div.get("style", "")
        if "background-image" in style:
            import re
            # 从 style 属性中提取 URL
            match = re.search(r'url\(&quot;([^&]+)&quot;\)', style)
            if match:
                return match.group(1)
            match = re.search(r'url\(["\']([^"\']+)["\']\)', style)
            if match:
                return match.group(1)
    
    return ""


def extract_video_metadata(soup: BeautifulSoup) -> Dict[str, any]:
    """提取视频元数据信息"""
    metadata = {
        "release_date": "",
        "video_id": "",
        "title": "",
        "actresses": [],
        "actors": [],
        "genres": [],
        "series": "",
        "maker": "",
        "director": "",
        "label": ""
    }
    
    # 查找包含元数据的 div.space-y-2
    metadata_div = soup.find("div", class_="space-y-2")
    if not metadata_div:
        return metadata
    
    # 提取各个字段
    for div in metadata_div.find_all("div", class_="text-secondary"):
        text = div.get_text(strip=True)
        
        if text.startswith("发行日期:"):
            time_elem = div.find("time")
            if time_elem:
                metadata["release_date"] = time_elem.get("datetime", "").split("T")[0]
        
        elif text.startswith("番号:"):
            span = div.find("span", class_="font-medium")
            if span:
                metadata["video_id"] = span.get_text(strip=True)
        
        elif text.startswith("标题:"):
            span = div.find("span", class_="font-medium")
            if span:
                metadata["title"] = span.get_text(strip=True)
        
        elif text.startswith("女优:"):
            actresses = []
            for a in div.find_all("a", class_="text-nord13"):
                actresses.append(a.get_text(strip=True))
            metadata["actresses"] = actresses
        
        elif text.startswith("男优:"):
            actors = []
            for a in div.find_all("a", class_="text-nord13"):
                actors.append(a.get_text(strip=True))
            metadata["actors"] = actors
        
        elif text.startswith("类型:"):
            genres = []
            for a in div.find_all("a", class_="text-nord13"):
                genres.append(a.get_text(strip=True))
            metadata["genres"] = genres
        
        elif text.startswith("系列:"):
            a = div.find("a", class_="text-nord13")
            if a:
                metadata["series"] = a.get_text(strip=True)
        
        elif text.startswith("发行商:"):
            a = div.find("a", class_="text-nord13")
            if a:
                metadata["maker"] = a.get_text(strip=True)
        
        elif text.startswith("导演:"):
            a = div.find("a", class_="text-nord13")
            if a:
                metadata["director"] = a.get_text(strip=True)
        
        elif text.startswith("标籤:"):
            a = div.find("a", class_="text-nord13")
            if a:
                metadata["label"] = a.get_text(strip=True)
    
    return metadata


def scrape_video_detail(url: str, timeout: int = 30):
    """抓取视频详情信息"""
    with sync_playwright() as playwright:
        page, context = setup_playwright_page(playwright)
        
        try:
            print(f"正在访问: {url}")
            
            # 访问页面
            response = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            
            if response and response.status != 200:
                print(f"页面访问失败，状态码: {response.status}")
                return
            
            # 优化：使用domcontentloaded替代networkidle，减少等待时间
            page.wait_for_load_state('domcontentloaded', timeout=5000)
            
            # 优化：直接尝试查找video元素，减少不必要的等待
            try:
                page.wait_for_selector('video', timeout=2000)
            except:
                pass  # 如果没有video元素也继续执行
            
            # 获取页面内容
            content = page.content()
            soup = BeautifulSoup(content, 'html.parser')
            
            # 提取详情描述
            description = extract_video_description(soup)
            
            # 提取封面URL
            cover_url = extract_cover_url(soup)
            
            # 提取元数据
            metadata = extract_video_metadata(soup)
            
            # 打印结果
            print("\n" + "="*60)
            print("视频详情信息")
            print("="*60)
            
            print(f"\n【详情描述】")
            print(description)
            
            print(f"\n【封面URL】")
            print(cover_url)
            
            print(f"\n【发行时间】")
            print(metadata["release_date"])
            
            print(f"\n【女优】")
            for actress in metadata["actresses"]:
                print(f"  - {actress}")
            
            print(f"\n【男优】")
            for actor in metadata["actors"]:
                print(f"  - {actor}")
            
            print(f"\n【类型】")
            for genre in metadata["genres"]:
                print(f"  - {genre}")
            
            print(f"\n【系列】")
            print(metadata["series"])
            
            print(f"\n【发行商】")
            print(metadata["maker"])
            
            print(f"\n【导演】")
            print(metadata["director"])
            
            print("\n" + "="*60)
            
        except Exception as e:
            print(f"抓取失败: {e}")
        
        finally:
            context.close()


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="MissAV 视频详情抓取脚本")
    parser.add_argument("--url", required=True, help="视频详情页面URL")
    parser.add_argument("--timeout", type=int, default=30, help="页面加载超时时间（秒）")
    
    args = parser.parse_args()
    
    scrape_video_detail(args.url, args.timeout)


if __name__ == "__main__":
    main()