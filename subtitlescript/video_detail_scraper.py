#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MissAV 视频详情抓取脚本

用法示例:
python video_detail_scraper.py --url "https://missav.live/cn/umso-612"
python video_detail_scraper.py --batch --limit 50  # 批量处理未抓取的视频
python video_detail_scraper.py --batch  # 批量处理所有未抓取的视频
python video_detail_scraper.py --url "..." --no-save  # 仅测试不保存
python video_detail_scraper.py --update-subtitle-status  # 更新所有视频的字幕存在状态


功能:
- 输入: 视频详情页面URL 或 批量处理模式
- 处理: 抓取视频的详情描述和元数据信息
- 输出: 控制台打印详情信息，并保存到数据库

注意事项:
- 需要先使用gensession.txt中的命令生成session_videoID.json
- 使用Playwright进行网页抓取，支持反爬机制
- 支持断点续抓，避免重复抓取已处理的视频
"""

import argparse
import json
import os
import re
import time
import requests
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import signal
import sys

from playwright.sync_api import Playwright, sync_playwright, Page, BrowserContext
from playwright_stealth.stealth import stealth_sync
from bs4 import BeautifulSoup

# 导入数据库管理器
from database_manager import DatabaseManager

# 配置管理
BACKEND_CONFIG = {
    'local': 'http://localhost:8000',  # 修正端口为8000
    'production': 'https://api.sub-dog.top'  # 线上后端API地址
}

# 当前环境配置（可通过环境变量或配置文件设置）
CURRENT_ENV = os.getenv('BACKEND_ENV', 'production')
BACKEND_BASE_URL = BACKEND_CONFIG.get(CURRENT_ENV, BACKEND_CONFIG['production'])

# 打印当前使用的后端配置
print(f"🔧 当前环境: {CURRENT_ENV}")
print(f"🌐 后端API地址: {BACKEND_BASE_URL}")


# 全局变量用于控制程序退出
_shutdown_event = threading.Event()
_executor = None

def signal_handler(signum, frame):
    """信号处理函数，用于优雅退出"""
    print(f"\n🛑 接收到中断信号 ({signum})，正在优雅退出...")
    _shutdown_event.set()
    
    # 如果有正在运行的线程池，尝试关闭
    global _executor
    if _executor:
        print("⏳ 正在关闭线程池...")
        try:
            # 取消所有未开始的任务
            _executor.shutdown(wait=False)
            print("✅ 线程池已关闭")
        except Exception as e:
            print(f"⚠️ 关闭线程池时出现异常: {e}")
    
    print("👋 程序即将退出...")
    # 不要立即调用sys.exit，让主程序自然结束

# 注册信号处理器
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
if hasattr(signal, 'SIGTERM'):
    signal.signal(signal.SIGTERM, signal_handler)  # 终止信号


# 全局会话对象和锁
_session_lock = threading.Lock()
_global_session = None

def get_global_session():
    """获取全局会话对象，避免重复创建"""
    global _global_session
    with _session_lock:
        if _global_session is None:
            _global_session = requests.Session()
            
            # 禁用urllib3的SSL警告
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            # 如果是生产环境，配置SOCKS5代理
            if CURRENT_ENV == 'production':
                proxies = {
                    'http': 'socks5://127.0.0.1:7890',
                    'https': 'socks5://127.0.0.1:7890'
                }
                _global_session.proxies.update(proxies)
                _global_session.trust_env = False
                print(f"🔗 使用SOCKS5代理: 127.0.0.1:7890")
            else:
                _global_session.trust_env = False
                _global_session.proxies = {}
                
            # 设置通用请求头
            _global_session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            
        return _global_session


def check_subtitle_exists(video_id: str) -> bool:
    """
    通过HTTP API检查字幕文件是否存在
    
    Args:
        video_id: 视频ID
        
    Returns:
        bool: 字幕是否存在
    """
    try:
        # 构建API URL
        api_url = f"{BACKEND_BASE_URL}/api/subtitles/exists/{video_id}"
        
        # 使用全局会话
        session = get_global_session()
        
        # 发送GET请求
        response = session.get(
            api_url, 
            timeout=30,
            verify=False
        )
        
        if response.status_code == 200:
            data = response.json()
            return data.get('exists', False)
        else:
            print(f"检查字幕存在性失败，状态码: {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"检查字幕存在性时网络请求失败: {e}")
        return False
    except Exception as e:
        print(f"检查字幕存在性时发生错误: {e}")
        return False


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


def extract_video_id_from_url(url: str) -> Optional[str]:
    """从URL中提取视频ID"""
    try:
        # 解析URL路径
        parsed = urlparse(url)
        path = parsed.path.strip('/')
        
        # 提取最后一个路径段作为视频ID
        # 例如: https://missav.live/cn/sone-891 -> sone-891
        if '/' in path:
            video_id = path.split('/')[-1]
        else:
            video_id = path
            
        # 处理包含后缀的视频ID（如 uncensored-leak, chinese-subtitle 等）
        # 移除常见的后缀，保留基础视频ID
        suffixes_to_remove = [
            '-uncensored-leak',
            '-chinese-subtitle', 
            '-leak',
            '-uncensored'
        ]
        
        for suffix in suffixes_to_remove:
            if video_id.lower().endswith(suffix):
                video_id = video_id[:-len(suffix)]
                break
        
        # 验证视频ID格式（基本验证）
        if video_id and len(video_id) > 2:
            return video_id.upper()  # 统一转为大写
        
        return None
    except Exception as e:
        print(f"提取视频ID失败: {e}")
        return None


def save_video_details_to_db(video_id: str, metadata: Dict, cover_url: str, description: str, video_url: str = None):
    """将视频详情保存到数据库"""
    try:
        db_manager = DatabaseManager("./database/actresses.db")
        
        # 如果提供了video_url，优先按URL查找记录；否则按video_id查找
        if video_url:
            records = db_manager.find_videos_by_url(video_url)
        else:
            records = db_manager.find_videos_by_id(video_id)
        
        if not records:
            if video_url:
                print(f"警告: 数据库中未找到URL为 {video_url} 的记录")
            else:
                print(f"警告: 数据库中未找到视频ID为 {video_id} 的记录")
            return False
        
        # 检查字幕是否存在
        subtitle_exists = check_subtitle_exists(video_id)
        
        # 准备详情数据
        details = {
            'release_date': metadata.get('release_date', ''),
            'cover_url': cover_url,
            'description': description,
            'actresses': metadata.get('actresses', []),
            'actors': metadata.get('actors', []),
            'genres': metadata.get('genres', []),
            'series': metadata.get('series', ''),
            'maker': metadata.get('maker', ''),
            'director': metadata.get('director', ''),
            'subtitle_downloaded': 1 if subtitle_exists else 0
        }
        
        # 更新所有匹配的记录
        updated_count = 0
        for record in records:
            # 检查是否已经抓取过
            if record.get('detail_scraped'):
                print(f"记录 {record['id']} 已经抓取过详情，跳过")
                continue
                
            db_manager.update_video_details(record['id'], details)
            updated_count += 1
            subtitle_status = "有字幕" if subtitle_exists else "无字幕"
            print(f"已更新记录 {record['id']}: {record['actress_name']} - {record['video_title']} ({subtitle_status})")
        
        print(f"成功更新 {updated_count} 条记录")
        return updated_count > 0
        
    except Exception as e:
        print(f"保存到数据库失败: {e}")
        return False


def scrape_single_video(url: str, timeout: int = 30, save_to_db: bool = True) -> bool:
    """抓取单个视频的详情"""
    print(f"开始抓取视频详情: {url}")
    
    # 提取视频ID
    video_id = extract_video_id_from_url(url)
    if not video_id:
        print("无法从URL中提取视频ID")
        return False
    
    print(f"提取到视频ID: {video_id}")
    
    with sync_playwright() as playwright:
        page, context = setup_playwright_page(playwright)
        
        try:
            # 访问页面并获取内容
            print(f"正在访问: {url}")
            response = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            
            if response and response.status != 200:
                print(f"页面访问失败，状态码: {response.status}")
                return False
            
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
            
            # 抓取视频详情
            description = extract_video_description(soup)
            metadata = extract_video_metadata(soup)
            cover_url = extract_cover_url(soup)
            
            # 打印详情信息
            print_video_details(video_id, description, metadata, cover_url)
            
            # 保存到数据库
            if save_to_db:
                success = save_video_details_to_db(video_id, metadata, cover_url, description, url)
                return success
            
            return True
            
        except Exception as e:
            print(f"抓取失败: {e}")
            return False
        
        finally:
            context.close()


def scrape_batch_videos(limit: int = 100) -> Dict[str, int]:
    """批量抓取未处理的视频详情"""
    try:
        db_manager = DatabaseManager("./database/actresses.db")
        
        # 获取统计信息
        stats = db_manager.get_video_details_stats()
        print(f"数据库统计: 总计 {stats['total']} 条记录，已抓取 {stats['scraped']} 条，未抓取 {stats['unscraped']} 条")
        
        if stats['unscraped'] == 0:
            print("所有视频详情已抓取完成")
            return {'total': 0, 'success': 0, 'failed': 0}
        
        # 获取未抓取的视频记录
        unscraped_videos = db_manager.get_unscraped_videos(limit)
        print(f"本次将处理 {len(unscraped_videos)} 条记录")
        
        success_count = 0
        failed_count = 0
        
        with sync_playwright() as playwright:
            page, context = setup_playwright_page(playwright)
            
            try:
                for i, video in enumerate(unscraped_videos, 1):
                    print(f"\n[{i}/{len(unscraped_videos)}] 处理视频: {video['video_id']}")
                    
                    try:
                        # 构建视频URL（假设使用missav.live域名）
                        video_url = f"https://missav.live/cn/{video['video_id'].lower()}"
                        
                        # 访问页面并获取内容
                        response = page.goto(video_url, wait_until="domcontentloaded", timeout=30000)
                        
                        if response and response.status != 200:
                            print(f"页面访问失败，状态码: {response.status}")
                            failed_count += 1
                            continue
                        
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
                        
                        # 抓取详情
                        description = extract_video_description(soup)
                        metadata = extract_video_metadata(soup)
                        cover_url = extract_cover_url(soup)
                        
                        # 检查字幕是否存在
                        subtitle_exists = check_subtitle_exists(video['video_id'])
                        
                        # 准备详情数据
                        details = {
                            'release_date': metadata.get('release_date', ''),
                            'cover_url': cover_url,
                            'description': description,
                            'actresses': metadata.get('actresses', []),
                            'actors': metadata.get('actors', []),
                            'genres': metadata.get('genres', []),
                            'series': metadata.get('series', ''),
                            'maker': metadata.get('maker', ''),
                            'director': metadata.get('director', ''),
                            'subtitle_downloaded': 1 if subtitle_exists else 0
                        }
                        
                        # 更新数据库
                        db_manager.update_video_details(video['id'], details)
                        success_count += 1
                        subtitle_status = "有字幕" if subtitle_exists else "无字幕"
                        print(f"✓ 成功处理: {video['actress_name']} - {video['video_title']} ({subtitle_status})")
                        
                        # 添加延迟避免过于频繁的请求
                        time.sleep(2)
                        
                    except Exception as e:
                        failed_count += 1
                        print(f"✗ 处理失败: {video['video_id']} - {e}")
                        continue
                        
            finally:
                context.close()
        
        result = {
            'total': len(unscraped_videos),
            'success': success_count,
            'failed': failed_count
        }
        
        print(f"\n批量处理完成: 总计 {result['total']} 条，成功 {result['success']} 条，失败 {result['failed']} 条")
        return result
        
    except Exception as e:
        print(f"批量处理失败: {e}")
        return {'total': 0, 'success': 0, 'failed': 0}


def print_video_details(video_id: str, description: str, metadata: Dict, cover_url: str):
    """打印视频详情信息"""
    print("\n" + "="*60)
    print("视频详情抓取结果")
    print("="*60)
    
    print(f"\n【视频ID】")
    print(video_id)
    
    print(f"\n【标题】")
    print(metadata["title"])
    
    print(f"\n【发布日期】")
    print(metadata["release_date"])
    
    print(f"\n【时长】")
    print(metadata.get("duration", "未知"))
    
    print(f"\n【封面图片】")
    print(cover_url)
    
    print(f"\n【描述】")
    print(description)
    
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


def process_single_video(video_data, index, total_videos):
    """
    处理单个视频的字幕状态检查
    
    Args:
        video_data: 包含视频信息的元组 (video, db_manager)
        index: 当前视频索引
        total_videos: 总视频数量
        
    Returns:
        dict: 处理结果
    """
    # 检查是否需要退出
    if _shutdown_event.is_set():
        return {'index': index, 'video_id': 'SHUTDOWN', 'success': False, 'error': 'Program shutdown'}
    
    video, db_manager = video_data
    video_id = video.get('video_id')
    video_title = video.get('video_title', 'Unknown')
    
    result = {
        'index': index,
        'video_id': video_id,
        'success': False,
        'subtitle_exists': False,
        'error': None
    }
    
    if not video_id:
        result['error'] = f"视频ID为空 - {video_title}"
        return result
    
    try:
        # 检查字幕是否存在
        subtitle_exists = check_subtitle_exists(video_id)
        
        # 再次检查是否需要退出
        if _shutdown_event.is_set():
            return {'index': index, 'video_id': 'SHUTDOWN', 'success': False, 'error': 'Program shutdown'}
        
        # 更新数据库中的字幕状态（添加重试机制）
        max_retries = 3
        success = False
        last_error = None
        
        for attempt in range(max_retries):
            try:
                success = db_manager.update_subtitle_status(video_id, subtitle_exists)
                if success:
                    break
                else:
                    last_error = f"数据库更新失败 - 没有找到匹配的记录或更新失败"
                    if attempt < max_retries - 1:
                        import time
                        time.sleep(0.1)  # 短暂等待后重试
            except Exception as db_error:
                last_error = f"数据库操作异常: {str(db_error)}"
                if attempt < max_retries - 1:
                    import time
                    time.sleep(0.1)  # 短暂等待后重试
                else:
                    # 最后一次尝试失败，记录详细错误
                    import traceback
                    last_error = f"数据库操作异常 (尝试{max_retries}次后失败): {str(db_error)}\n{traceback.format_exc()}"
        
        if success:
            result['success'] = True
            result['subtitle_exists'] = subtitle_exists
        else:
            result['error'] = last_error or "数据库更新失败"
            
    except Exception as e:
        import traceback
        result['error'] = f"处理异常: {str(e)}\n{traceback.format_exc()}"
    
    return result


def update_all_subtitle_status():
    """
    更新所有视频的字幕存在状态（多线程版本）
    遍历数据库中的所有视频记录，并发检查字幕是否存在并更新状态
    """
    global _executor
    
    print("开始更新所有视频的字幕存在状态...")
    
    # 初始化数据库管理器
    db_manager = DatabaseManager()
    
    # 获取所有视频记录
    all_videos = db_manager.get_all_videos()
    
    if not all_videos:
        print("数据库中没有找到视频记录")
        return
    
    total_videos = len(all_videos)
    print(f"找到 {total_videos} 个视频记录，开始检查字幕状态...")
    
    # 统计变量
    updated_count = 0
    error_count = 0
    subtitle_exists_count = 0
    subtitle_not_exists_count = 0
    
    # 准备数据：每个任务包含视频信息和数据库管理器
    video_data_list = [(video, db_manager) for video in all_videos]
    
    # 使用线程池并发处理
    max_workers = min(10, total_videos)  # 最多10个线程
    print(f"🚀 使用 {max_workers} 个线程并发处理...")
    print("💡 按 Ctrl+C 可随时中断程序")
    
    try:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            _executor = executor  # 保存执行器引用
            
            # 提交所有任务
            future_to_index = {
                executor.submit(process_single_video, video_data_list[i], i+1, total_videos): i+1 
                for i in range(total_videos)
            }
            
            # 处理完成的任务
            for future in as_completed(future_to_index):
                # 检查是否需要退出
                if _shutdown_event.is_set():
                    print("🛑 检测到退出信号，停止处理...")
                    break
                    
                index = future_to_index[future]
                
                try:
                    result = future.result(timeout=1)  # 添加超时避免阻塞
                    
                    # 跳过因程序关闭产生的结果
                    if result.get('video_id') == 'SHUTDOWN':
                        continue
                    
                    if result['success']:
                        status_text = "存在" if result['subtitle_exists'] else "不存在"
                        print(f"[{result['index']}/{total_videos}] 更新成功：{result['video_id']} - 字幕{status_text}")
                        updated_count += 1
                        
                        # 统计字幕存在情况
                        if result['subtitle_exists']:
                            subtitle_exists_count += 1
                        else:
                            subtitle_not_exists_count += 1
                    else:
                        print(f"[{result['index']}/{total_videos}] 更新失败：{result['video_id']} - {result['error']}")
                        error_count += 1
                        
                except Exception as e:
                    print(f"[{index}/{total_videos}] 处理异常：{e}")
                    error_count += 1
                
                # 每处理100个视频显示一次进度
                processed = updated_count + error_count
                if processed % 100 == 0:
                    print(f"📊 进度：已处理 {processed}/{total_videos} 个视频，成功更新 {updated_count} 个，失败 {error_count} 个")
    
    except KeyboardInterrupt:
        print("\n🛑 用户中断程序")
        _shutdown_event.set()  # 确保设置退出标志
    except Exception as e:
        print(f"\n❌ 程序执行出错：{e}")
    finally:
        # 确保线程池被正确关闭
        if _executor:
            try:
                print("🔄 正在等待线程池完全关闭...")
                _executor.shutdown(wait=True)  # ThreadPoolExecutor.shutdown()不支持timeout参数
                print("✅ 线程池已完全关闭")
            except Exception as e:
                print(f"⚠️ 关闭线程池时出现异常: {e}")
            finally:
                _executor = None  # 清除执行器引用
    
    if not _shutdown_event.is_set():
        print(f"\n✅ 字幕状态更新完成！")
        print(f"总计：{total_videos} 个视频")
        print(f"成功更新：{updated_count} 个")
        print(f"失败：{error_count} 个")
        print(f"字幕存在：{subtitle_exists_count} 个")
        print(f"字幕不存在：{subtitle_not_exists_count} 个")
    else:
        print(f"\n⚠️ 程序被中断，部分处理完成")
        print(f"已处理：{updated_count + error_count} 个视频")
        print(f"成功更新：{updated_count} 个")
        print(f"失败：{error_count} 个")


def main():
    """主函数"""
    # 注册信号处理器
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    parser = argparse.ArgumentParser(description="MissAV 视频详情抓取脚本")
    parser.add_argument("--url", help="视频详情页面URL")
    parser.add_argument("--batch", action="store_true", help="批量处理模式")
    parser.add_argument("--limit", type=int, default=100, help="批量处理时的记录数限制")
    parser.add_argument("--timeout", type=int, default=30, help="页面加载超时时间（秒）")
    parser.add_argument("--no-save", action="store_true", help="不保存到数据库，仅打印结果")
    parser.add_argument("--update-subtitle-status", action="store_true", help="更新所有视频的字幕存在状态")
    
    args = parser.parse_args()
    
    # 验证参数
    if not args.batch and not args.url and not args.update_subtitle_status:
        parser.error("必须指定 --url、使用 --batch 模式或使用 --update-subtitle-status")
    
    if sum([bool(args.batch), bool(args.url), bool(args.update_subtitle_status)]) > 1:
        parser.error("--batch、--url 和 --update-subtitle-status 不能同时使用")
    
    try:
        if args.update_subtitle_status:
            # 字幕状态更新模式
            print("启动字幕状态更新模式...")
            update_all_subtitle_status()
        elif args.batch:
            # 批量处理模式
            print("启动批量处理模式...")
            scrape_batch_videos(args.limit)
        else:
            # 单个URL处理模式
            scrape_single_video(args.url, args.timeout, not args.no_save)
            
    except KeyboardInterrupt:
        print("\n用户中断操作")
    except Exception as e:
        print(f"程序执行失败: {e}")


if __name__ == "__main__":
    main()