import re
import json
import os
import time
import sys
from playwright.sync_api import Playwright, sync_playwright, expect
from playwright_stealth.stealth import stealth_sync
from urllib.parse import urljoin, urlparse, quote_plus

# 全局搜索关键字配置：直接修改此处值即可
#特殊番号FC2PPV-4620098
SEARCH_KEYWORD = "HMN-733"


# 工具函数
def first_text(loc):
    """获取定位器的第一个元素的文本内容"""
    try:
        if loc.count() > 0:
            return loc.first.inner_text().strip()
    except Exception:
        pass
    return ""


def norm(s):
    """标准化字符串，去除特殊字符并转为小写"""
    if not s:
        return ""
    s = re.sub(r"[\[\]【】（）()\s<>]", "", str(s))
    return s.lower()


def text_of(el):
    """获取元素的文本内容"""
    try:
        t = el.inner_text().strip()
        return t if t else (el.text_content() or "").strip()
    except Exception:
        try:
            return (el.text_content() or "").strip()
        except Exception:
            return ""


def still_exists_check(hit_frame, sel, kind, exts2):
    """
    检查购买后原命中元素是否还存在
    
    Args:
        hit_frame: 命中的frame对象
        sel: 选择器字符串
        kind: 元素类型 ('buy', 'attachpay_file', 'direct_attachment', 'buy_topic')
        exts2: 文件扩展名列表
        
    Returns:
        bool: 元素是否仍然存在
    """
    frs = [hit_frame]
    try:
        frs += getattr(hit_frame, 'frames', []) or []
    except Exception:
        pass
    for fr2 in frs:
        l2 = fr2.locator(sel)
        c2 = l2.count()
        if c2 == 0:
            continue
        for j in range(min(c2, 10)):
            try:
                tj = text_of(l2.nth(j))
            except Exception:
                tj = ""
            lj = (tj or '').lower().strip()
            if kind == 'buy':
                if (tj or '').strip() == '购买':
                    return True
            elif kind == 'attachpay_file':
                if (tj or '').strip() != '购买' and any(lj.endswith(ext) for ext in exts2):
                    return True
            elif kind == 'direct_attachment':
                if any(lj.endswith(ext) for ext in exts2):
                    return True
            else:
                if '购买主题' in (tj or ''):
                    return True
    return False


def handle_route(route):
    """
    处理网络路由请求，对静态资源进行优化处理
    
    Args:
        route: Playwright的路由对象
    """
    request = route.request
    # 如果是图片、字体、CSS等静态资源，直接放行但不影响页面加载状态
    if any(resource_type in request.url.lower() for resource_type in ['.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.woff', '.woff2', '.ttf']):
        # 对于可能404的静态资源，使用continue但不等待响应
        route.continue_()
    else:
        # 对于其他请求正常处理
        route.continue_()


def handle_response(response):
    """
    处理HTTP响应，分析和记录错误状态
    
    Args:
        response: Playwright的响应对象
    """
    # 只处理4xx和5xx错误状态码
    if response.status >= 400:
        # 分析资源类型
        url = response.url
        resource_type = "未知资源"
        impact_level = "⚠️  影响"
        
        # 根据URL判断资源类型
        if any(ext in url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico']):
            resource_type = "图片资源"
            impact_level = "⚠️  影响: 通常不影响核心功能"
        elif any(ext in url.lower() for ext in ['.css']):
            resource_type = "样式表"
            impact_level = "⚠️  影响: 可能影响页面样式"
        elif any(ext in url.lower() for ext in ['.js']):
            resource_type = "JavaScript脚本"
            impact_level = "⚠️  影响: 可能影响页面功能"
        elif any(ext in url.lower() for ext in ['.woff', '.woff2', '.ttf', '.otf']):
            resource_type = "字体文件"
            impact_level = "⚠️  影响: 可能影响文字显示"
        elif 'api' in url.lower() or 'ajax' in url.lower():
            resource_type = "API接口"
            impact_level = "⚠️  影响: 可能影响数据加载"
        
        # 根据状态码提供说明
        status_description = {
            400: "请求格式错误",
            401: "未授权访问",
            403: "访问被禁止", 
            404: "请求的资源未找到",
            500: "服务器内部错误",
            502: "网关错误",
            503: "服务不可用"
        }.get(response.status, f"HTTP错误 {response.status}")
        
        # 只打印非图片资源的错误，减少干扰
        if resource_type != "图片资源":
            print(f"🚨 HTTP错误 [{response.status}] - {status_description}")
            print(f"   📄 资源类型: {resource_type}")
            print(f"   🔗 URL: {url}")
            print(f"   💡 说明: {status_description}")
            print(f"   {impact_level}")
            print("-" * 80)


def handle_request_failed(request):
    """
    处理请求失败的情况
    
    Args:
        request: Playwright的请求对象
    """
    # 只处理非图片资源的失败
    if not any(ext in request.url.lower() for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico']):
        failure_reason = request.failure or "未知原因"
        
        # 分析失败原因
        reason_description = {
            "net::ERR_NETWORK_CHANGED": "网络环境发生变化",
            "net::ERR_CONNECTION_REFUSED": "连接被拒绝",
            "net::ERR_TIMED_OUT": "请求超时",
            "net::ERR_NAME_NOT_RESOLVED": "域名解析失败",
            "net::ERR_INTERNET_DISCONNECTED": "网络连接断开",
            "net::ERR_CONNECTION_RESET": "连接被重置",
            "net::ERR_SSL_PROTOCOL_ERROR": "SSL协议错误"
        }.get(failure_reason, failure_reason)
        
        print(f"❌ 请求失败")
        print(f"   🔗 URL: {request.url}")
        print(f"   💥 失败原因: {reason_description}")
        print(f"   📝 详细信息: {failure_reason}")
        print("-" * 80)


def scan_in_root(r):
        # 短暂等待潜在的异步渲染
        try:
            r.wait_for_timeout(200)
        except Exception:
            pass

        # 优先级 1：购买主题（misc/pay）
        try:
            sel1 = "a.viewpay[title='购买主题'], a.y.viewpay[title='购买主题'], a[href*='mod=misc'][href*='action=pay']"
            loc1 = r.locator(sel1)
            c1 = loc1.count()
            for i in range(c1):
                el = loc1.nth(i)
                txt = text_of(el)
                # 更稳妥：如果不是购买主题，也允许文本包含“购买主题”
                if '购买主题' in (txt or '购买主题'):
                    return txt
        except Exception:
            pass

        # 优先级 2：购买（attachpay 的购买按钮）
        try:
            sel2 = "a[href*='mod=misc'][href*='action=attachpay']"
            loc2 = r.locator(sel2)
            c2 = loc2.count()
            for i in range(c2):
                el = loc2.nth(i)
                txt = text_of(el)
                if txt.strip() == '购买':
                    return txt
        except Exception:
            pass

        # 常见文件后缀
        exts = ['.zip', '.rar', '.7z', '.ass', '.srt', '.ssa', '.vtt', '.lrc', '.sub']

        # 优先级 3：付费附件项（attachpay 的文件名按钮，排除“购买”字样）
        try:
            sel3 = "a[href*='mod=misc'][href*='action=attachpay']"
            loc3 = r.locator(sel3)
            c3 = loc3.count()
            for i in range(c3):
                el = loc3.nth(i)
                txt = text_of(el)
                low = txt.lower()
                if txt and txt.strip() != '购买' and any(low.endswith(ext) for ext in exts):
                    return txt
        except Exception:
            pass

        # 优先级 4：直链附件（mod=attachment&aid=...）
        try:
            sel4 = "a[href*='mod=attachment'][href*='aid=']"
            loc4 = r.locator(sel4)
            c4 = loc4.count()
            for i in range(c4):
                el = loc4.nth(i)
                txt = text_of(el)
                low = txt.lower()
                if txt and any(low.endswith(ext) for ext in exts):
                    return txt
        except Exception:
            pass
        return None
        
def load_session_if_exists():
    """加载已保存的session状态"""
    session_file = "./session.json"
    if os.path.exists(session_file):
        try:
            with open(session_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"加载session文件失败: {e}")
    return None


def check_login_status(page):
    """检查是否已经登录"""
    try:
        # 检查页面是否包含登录用户信息，比如用户名或退出链接
        page.wait_for_selector("a[href*='logout']", timeout=3000)
        print("检测到退出链接，已登录")
        return True
    except:
        try:
            # 或者检查是否存在用户相关的元素
            page.wait_for_selector(".vwmy", timeout=3000)
            print("检测到用户相关元素，已登录")
            return True
        except:
            try:
                # 检查是否存在用户名显示
                page.wait_for_selector("strong a[href*='space-uid']", timeout=3000)
                print("检测到用户名链接，已登录")
                return True
            except:
                try:
                    # 检查登录表单是否存在，如果存在说明未登录
                    page.wait_for_selector("#ls_username", timeout=3000)
                    print("检测到登录表单，未登录")
                    return False
                except:
                    print("无法确定登录状态，假设未登录")
                    return False

# 解析搜索结果列表，提取 标题、链接、发布时间、用户名、所属专区，并打印
def scrape_search_results(root, max_items=30):
    # root 可以是 Page 或 Frame
    results = []
    # 优先尝试当前 root；若未命中，则在所有 frame 中寻找结果容器
    try:
        root.wait_for_selector("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']", timeout=8000)
    except Exception:
        # 在 frame 中寻找
        try:
            for fr in root.frames if hasattr(root, 'frames') else []:
                try:
                    fr.wait_for_selector("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']", timeout=3000)
                    root = fr
                    break
                except Exception:
                    continue
        except Exception:
            pass
    # 再次检测一次
    try:
        root.wait_for_selector("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']", timeout=4000)
    except Exception:
        print(f"未检测到搜索结果标题元素，可能无结果或页面结构变更。当前URL: {getattr(root, 'url', '')}")
        return results

    try:
        titles = root.locator("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']")
        total = titles.count()
        count = min(total, max_items)
        parsed = urlparse(getattr(root, 'url', '') or (root.page.url if hasattr(root, 'page') else ''))
        base = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else "https://37ub.w7zvq.net"

        for i in range(count):
            t = titles.nth(i)
            try:
                title = t.inner_text().strip()
            except Exception:
                title = ""
            try:
                href = t.get_attribute("href") or ""
            except Exception:
                href = ""
            link = urljoin(base, href) if href else ""

            cont = t.locator("xpath=ancestor::tbody[starts-with(@id,'normalthread_')][1]")
            if cont.count() == 0:
                cont = t.locator("xpath=ancestor::tr[1]")
            if cont.count() == 0:
                cont = t.locator("xpath=ancestor::li[1]")
            if cont.count() == 0:
                cont = t.locator("xpath=ancestor::div[1]")

            author = ""
            for sel in [
                "xpath=.//p//a[contains(@href,'mod=space') and contains(@href,'uid=')]",
                "xpath=.//a[contains(@href,'mod=space') and contains(@href,'uid=')]",
                "xpath=.//a[contains(@href,'space-uid')]",
                "xpath=.//td[contains(@class,'by')]//cite//a",
                "xpath=.//cite/a",
            ]:
                author = first_text(cont.locator(sel))
                if author:
                    break
            if not author:
                for sel in [
                    "xpath=ancestor::tr[1]//p//a[contains(@href,'mod=space') and contains(@href,'uid=')]",
                    "xpath=ancestor::li[1]//p//a[contains(@href,'mod=space') and contains(@href,'uid=')]",
                    "xpath=ancestor::div[1]//p//a[contains(@href,'mod=space') and contains(@href,'uid=')]",
                ]:
                    author = first_text(t.locator(sel))
                    if author:
                        break

            pub_time = ""
            for sel in [
                "xpath=.//td[contains(@class,'by')]//em//span",
                "xpath=.//em[contains(@class,'xg1')]//span",
                "xpath=.//p[contains(@class,'xg1')]//span",
                "xpath=.//em//span",
            ]:
                pub_time = first_text(cont.locator(sel))
                if pub_time:
                    break
            if not pub_time:
                try:
                    block_text = cont.first.inner_text()
                    m = re.search(r"(20\d{2}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?)", block_text)
                    if m:
                        pub_time = m.group(1)
                except Exception:
                    pass

            section = ""
            for sel in [
                "xpath=.//a[contains(@class,'xi1') and contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                "xpath=.//p//a[contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                "xpath=.//a[contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                "xpath=.//td[contains(@class,'forum')]//a",
                "xpath=.//a[contains(@href,'forum-') and contains(@href,'.html')]",
                "xpath=.//a[contains(@href,'/forum-')]",
            ]:
                section = first_text(cont.locator(sel))
                if section:
                    break
            if not section:
                for sel in [
                    "xpath=ancestor::tr[1]//p//a[contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                    "xpath=ancestor::li[1]//p//a[contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                    "xpath=ancestor::div[1]//p//a[contains(@href,'mod=forumdisplay') and contains(@href,'fid=')]",
                ]:
                    section = first_text(t.locator(sel))
                    if section:
                        break

            results.append({
                "title": title,
                "link": link,
                "time": pub_time,
                "user": author,
                "section": section,
            })

        print(f"当前URL: {getattr(root, 'url', '')}")
        print(f"匹配到结果条目数量: {total}, 实际提取: {len(results)}")
        if results:
            for idx, item in enumerate(results, 1):
                print(f"[{idx}] 标题: {item['title']}")
                print(f"    链接: {item['link']}")
                print(f"    发布时间: {item['time']}")
                print(f"    用户名: {item['user']}")
                print(f"    所属专区: {item['section']}")
        else:
            print("未抓取到任何结果")
    except Exception as e:
        print(f"解析搜索结果时出错: {e}")
    return results


def perform_search(page, keyword=SEARCH_KEYWORD):
     """登录成功后执行站内搜索"""
     try:
        # 等待并聚焦搜索输入框
        page.wait_for_selector("#scbar_txt", state="visible", timeout=10000)
        input_el = page.locator("#scbar_txt")
        input_el.click()
        try:
            input_el.fill("")
        except Exception:
            pass
        input_el.fill(keyword)

        # 点击搜索按钮
        page.wait_for_selector("#scbar_btn", state="attached", timeout=5000)
        pages_before = len(page.context.pages)
        page.click("#scbar_btn")

        # 如果点击后新开了标签页，则切换到新页作为目标页
        target_page = page
        try:
            new_page = page.context.wait_for_event("page", timeout=5000)
            if new_page and len(page.context.pages) > pages_before:
                target_page = new_page
        except Exception:
            pass

        # 等待跳转到搜索结果页
        try:
            target_page.wait_for_url("**/search.php**", timeout=15000)
        except Exception:
            pass

        # 处理可能出现的年龄警告页
        try:
            if target_page.locator("text=警告").first.is_visible():
                for txt in ["我已年满", "进入", "继续", "同意", "I Agree", "Enter", "继续访问"]:
                    try:
                        btn = target_page.locator(f"button:has-text('{txt}'), a:has-text('{txt}')").first
                        if btn.count() > 0:
                            btn.click(timeout=3000)
                            break
                    except Exception:
                        continue
        except Exception:
            pass

        # 等待搜索结果加载或网络空闲
        try:
            target_page.wait_for_load_state("domcontentloaded", timeout=10000)
        except Exception:
            pass
        try:
            target_page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        # 等待结果标题元素出现
        found = True
        try:
            target_page.wait_for_selector("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']", timeout=8000)
        except Exception:
            found = False

        # 若仍未找到，直接构造搜索结果URL进行跳转作为兜底
        if not found:
            parsed = urlparse(target_page.url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            fallback = f"{base}/search.php?mod=forum&searchsubmit=yes&kw={quote_plus(keyword)}"
            try:
                target_page.goto(fallback, wait_until="domcontentloaded", timeout=15000)
                try:
                    target_page.wait_for_selector("a.xst, a[href*='viewthread']", timeout=8000)
                    found = True
                except Exception:
                    pass
            except Exception as e:
                print(f"跳转 fallback 搜索URL失败: {e}")

        # 解析并打印搜索结果
        scrape_search_results(target_page)
        print(f"搜索操作已完成：{keyword}")
     except Exception as e:
         print(f"搜索操作失败: {e}")


def choose_best_result(results):
    priorities = [
        ("自译字幕区", ["自译", "自译字幕"]),
        ("自提字幕区", ["自提", "自提字幕"]),
        ("新作区", ["新作"]),
        ("字幕分享区", ["字幕分享"]),
    ]
    
    # 按优先级顺序查找，确保严格按照优先级选择
    for official, keys in priorities:
        # 收集当前优先级的所有匹配结果
        matching_results = []
        for item in results:
            section = norm(item.get("section", ""))
            if any(k in section for k in keys):
                matching_results.append(item)
        
        # 如果找到匹配结果，返回第一个（保持原有的选择逻辑）
        if matching_results:
            print(f"🎯 找到 {len(matching_results)} 个 '{official}' 的匹配结果，选择第一个")
            return matching_results[0], official
    
    return None, None

# === 统一下载调度入口与分区实现（A/B/D占位，C复用现有新作区逻辑） ===

def get_zone_code(section):
    s = (section or "").strip()
    if s == "自译字幕区":
        return "A"
    if s == "自提字幕区":
        return "B"
    if s == "新作区":
        return "C"
    if s == "字幕分享区":
        return "D"
    return "UNKNOWN"


def download_zone_a(page_or_frame, keyword, save_root=None, options=None):
    """
    Zone A（自译字幕区）下载逻辑：
    1. 检查购买主题按钮是否存在
    2. 如果存在，执行购买流程（点击按钮→处理弹窗→提交表单）
    3. 等待页面刷新
    4. 点击下载链接并接管下载
    5. 下载成功后提取解压密码并写入txt文件
    """
    import os
    
    print("🔍 Zone A（自译字幕区）- 开始下载流程...")
    
    try:
        # 1. 获取页面和框架上下文
        if hasattr(page_or_frame, 'page'):
            current_page = page_or_frame.page
            current_frame = page_or_frame
        else:
            current_page = page_or_frame
            current_frame = current_page.main_frame
        
        # 2. 计算保存目录
        if save_root is None:
            save_root = os.path.join(os.path.dirname(__file__), "output", "downloads", keyword)
        os.makedirs(save_root, exist_ok=True)
        
        # 3. 检查购买主题按钮是否存在
        purchase_button_selector = "div.locked a.viewpay[title='购买主题']"
        
        if not still_exists_check(current_frame, purchase_button_selector, "购买按钮", []):
            print("ℹ️ 购买主题按钮不存在，主题已购买")
            # 直接进入下载流程
            return _zone_a_download_file(current_frame, current_page, keyword, save_root)
        
        print("🛒 发现购买主题按钮，开始购买流程...")
        
        # 4. 执行购买流程
        success = _zone_a_handle_purchase(current_frame, current_page)
        if not success:
            return {"success": False, "zone": "A", "message": "purchase_failed", "payload": None}
        
        # 5. 等待页面刷新
        print("⏳ 等待页面刷新...")
        try:
            current_page.wait_for_load_state('networkidle', timeout=10000)
        except Exception:
            current_frame.wait_for_timeout(2000)
        
        # 6. 执行下载流程
        return _zone_a_download_file(current_frame, current_page, keyword, save_root)
        
    except Exception as e:
        print(f"❌ Zone A 下载流程失败: {e}")
        return {"success": False, "zone": "A", "message": f"download_error: {e}", "payload": None}


def _zone_a_handle_purchase(current_frame, current_page):
    """处理A区购买流程"""
    try:
        # 1. 点击购买主题按钮
        purchase_button = current_frame.locator("div.locked a.viewpay[title='购买主题']")
        purchase_button.click(timeout=5000)
        print("✅ 已点击购买主题按钮")
        
        # 2. 等待弹窗出现并处理
        current_frame.wait_for_timeout(1000)  # 等待弹窗加载
        
        # 3. 在弹窗中点击提交按钮
        submit_button = current_frame.locator("form#payform button[name='paysubmit']")
        submit_button.click(timeout=5000)
        print("✅ 已点击提交按钮")
        
        return True
        
    except Exception as e:
        print(f"❌ 购买流程失败: {e}")
        return False


def _zone_a_download_file(current_frame, current_page, keyword, save_root):
    """处理A区文件下载"""
    try:
        # 1. 查找下载链接（参考D区的附件选择器）
        download_selectors = [
            "dl.tattl dd p.attnm a",                         # 优先匹配压缩包链接
            "a[href*='mod=attachment'][id^='aid']",
            "dl.tattl a[id^='aid']",
            "a[href*='forum.php'][href*='mod=attachment']",
            "ignore_js_op a[href*='mod=misc'][href*='action=attachpay']",  # ignore_js_op内的付费附件
            "a[href*='mod=misc'][href*='action=attachpay']",               # 付费附件链接（attachpay）
            "span[id^='attach_'] a[href*='attachpay']",                    # span包装的附件链接
            "ignore_js_op span a",                                         # ignore_js_op内span中的链接
            "div.blockcode a",                                             # blockcode中的链接
        ]
        
        download_link = None
        target_filename = None
        
        for selector in download_selectors:
            try:
                elements = current_frame.locator(selector)
                count = elements.count()
                
                if count > 0:
                    print(f"🔍 找到 {count} 个潜在下载链接 (选择器: {selector})")
                    
                    for i in range(count):
                        element = elements.nth(i)
                        try:
                            link_text = element.text_content() or ""
                            link_href = element.get_attribute('href') or ""
                            
                            #print(f"🔍 检查链接[{i}]: 文本='{link_text}', href='{link_href}'")
                            
                            # 排除图片文件
                            if any(link_text.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif']):
                                #print(f"⏭️ 跳过图片文件: {link_text}")
                                continue
                            
                            # 优先选择压缩文件
                            if any(link_text.lower().endswith(ext) for ext in ['.zip', '.rar', '.7z', '.7zip']):
                                download_link = element
                                target_filename = link_text
                                #print(f"✅ 找到压缩文件链接: {link_text}")
                                break
                            
                            # 如果包含关键词，也考虑
                            if keyword.lower() in link_text.lower() and link_href:
                                download_link = element
                                target_filename = link_text
                                #print(f"✅ 找到包含关键词的链接: {link_text}")
                                break
                                
                        except Exception as e:
                            print(f"⚠️ 检查链接时出错: {e}")
                            continue
                    
                    if download_link:
                        break
                        
            except Exception as e:
                print(f"⚠️ 选择器 {selector} 查找失败: {e}")
                continue
        
        if not download_link:
            print("❌ 未找到下载链接")
            # 尝试只提取密码
            contexts_for_extraction = [current_frame, current_page]
            extracted_password = extract_and_write_password(
                contexts_for_extraction, 
                downloaded_path=None,
                timeout_ms=8000, 
                verbose=True
            )
            
            if extracted_password:
                print(f"ℹ️ 虽然未找到下载链接，但成功提取了密码: {extracted_password}")
                return {
                    "success": True, 
                    "zone": "A", 
                    "message": "password_only", 
                    "payload": {"password": extracted_password}
                }
            else:
                return {"success": False, "zone": "A", "message": "download_link_not_found", "payload": None}
        
        # 2. 预提取解压密码
        contexts_for_extraction = [current_frame, current_page]
        extracted_password = extract_and_write_password(
            contexts_for_extraction, 
            downloaded_path=None,  # 先不写入文件
            timeout_ms=8000, 
            verbose=True
        )
        
        # 3. 执行下载
        print(f"🚀 开始下载文件: {target_filename}")
        with current_page.expect_download(timeout=30000) as download_info:
            download_link.click(timeout=5000)
        
        download = download_info.value
        
        # 4. 保存文件
        if not target_filename:
            target_filename = download.suggested_filename
        
        # 确保文件名有正确的扩展名
        if not any(target_filename.lower().endswith(ext) for ext in ['.zip', '.rar', '.7z', '.7zip']):
            target_filename += '.zip'  # 默认添加.zip扩展名
        
        save_path = os.path.join(save_root, target_filename)
        download.save_as(save_path)
        
        print(f"✅ 文件下载成功: {save_path}")
        
        # 5. 写入密码文件
        if extracted_password:
            password_file = os.path.splitext(save_path)[0] + '.txt'
            with open(password_file, 'w', encoding='utf-8') as f:
                f.write(extracted_password)
            print(f"✅ 密码已写入: {password_file}")
        
        return {
            "success": True, 
            "zone": "A", 
            "message": "download_completed", 
            "payload": {"file_path": save_path, "password": extracted_password}
        }
        
    except Exception as e:
        print(f"❌ 文件下载失败: {e}")
        return {"success": False, "zone": "A", "message": f"download_error: {e}", "payload": None}


def download_zone_b(page_or_frame, keyword, save_root=None, options=None):
    """
    Zone B（自提字幕区）下载逻辑：
    1. 查找并筛选下载链接（过滤ed2k文件）
    2. 点击下载链接，检测是否已购买
    3. 如果已购买，直接下载并提示退出
    4. 如果未购买，处理购买确认对话框
    5. 购买完成后再次点击下载链接
    6. 下载成功后提取解压密码并写入txt文件
    """
    import os
    
    print("🔍 Zone B（自提字幕区）- 开始下载流程...")
    
    try:
        # 1. 获取页面和框架上下文
        if hasattr(page_or_frame, 'page'):
            current_page = page_or_frame.page
            current_frame = page_or_frame
        else:
            current_page = page_or_frame
            current_frame = current_page.main_frame
        
        # 2. 计算保存目录
        if save_root is None:
            save_root = os.path.join(os.path.dirname(__file__), "output", "downloads", keyword)
        os.makedirs(save_root, exist_ok=True)
        
        # 3. 查找并筛选下载链接
        download_link, target_filename = _zone_b_find_download_link(current_frame, keyword)
        if not download_link:
            return {"success": False, "zone": "B", "message": "download_link_not_found", "payload": None}
        
        # 4. 预提取解压密码
        contexts_for_extraction = [current_frame, current_page]
        extracted_password = extract_and_write_password(
            contexts_for_extraction, 
            downloaded_path=None,  # 先不写入文件
            timeout_ms=8000, 
            verbose=True
        )
        
        # 5. 保存链接标识信息，用于购买后重新定位
        link_href = download_link.get_attribute('href')
        link_text = target_filename
        print(f"🚀 首次点击下载链接: {target_filename}")
        print(f"🔗 链接标识: href={link_href}")
        
        # 同时监听下载事件和可能的购买对话框
        download_started = False
        try:
            # 尝试监听立即下载（已购买情况）
            with current_page.expect_download(timeout=5000) as download_info:
                download_link.click(timeout=3000)
            
            # 如果到这里说明立即开始下载，附件已购买
            download = download_info.value
            download_started = True
            print("✅ 附件已购买，立即开始下载")
            
        except Exception:
            # 没有立即下载，可能需要购买
            print("🛒 检测到需要购买，查找购买确认对话框...")
            
            # 处理购买流程
            success = _zone_b_handle_purchase(current_frame, current_page)
            if not success:
                return {"success": False, "zone": "B", "message": "purchase_failed", "payload": None}
            
            # 购买完成后重新定位同一个下载链接
            print("🔄 购买完成，重新定位下载链接...")
            print(f"🔍 查找链接: 文本='{link_text}'")
            
            # 重新查找具有相同文本内容的下载链接
            # 注意：购买后href会完全改变，只能通过文本内容定位
            new_download_link = None
            try:
                # 方案1：通过文本内容查找（购买后href已变，不能用href匹配）
                print("🔍 通过文本内容重新定位链接...")
                
                # 查找所有包含目标文件名的链接
                elements = current_frame.locator("a").all()
                
                for element in elements:
                    try:
                        element_text = element.text_content() or ""
                        element_href = element.get_attribute('href') or ""
                        
                        # 匹配文本内容
                        if element_text.strip() == link_text.strip():
                            # 确保不是购买按钮（购买按钮文本是"购买"）
                            if element_text.strip() != '购买':
                                new_download_link = element
                                print(f"✅ 重新定位到下载链接: {element_text}")
                                print(f"🔗 新链接href: {element_href[:100]}...")
                                break
                    except Exception as e:
                        continue
                
                if not new_download_link:
                    # 备用方案：使用更宽松的文本匹配
                    print("🔄 使用备用方案：宽松文本匹配...")
                    base_filename = link_text.replace('.rar', '').replace('.zip', '').strip()
                    
                    for element in elements:
                        try:
                            element_text = element.text_content() or ""
                            if base_filename in element_text and element_text.strip() != '购买':
                                new_download_link = element
                                print(f"✅ 备用方案成功定位到链接: {element_text}")
                                break
                        except Exception as e:
                            continue
                
                if not new_download_link:
                    print("❌ 无法重新定位下载链接")
                    return {"success": False, "zone": "B", "message": "relink_failed", "payload": None}
                
            except Exception as e:
                print(f"❌ 重新定位链接时出错: {e}")
                return {"success": False, "zone": "B", "message": f"relink_error: {e}", "payload": None}
            
            # 点击重新定位的下载链接
            print("🔄 点击重新定位的下载链接...")
            with current_page.expect_download(timeout=30000) as download_info:
                new_download_link.click(timeout=5000)
            
            download = download_info.value
            download_started = True
        
        if not download_started:
            return {"success": False, "zone": "B", "message": "download_not_started", "payload": None}
        
        # 6. 保存文件
        if not target_filename:
            target_filename = download.suggested_filename
        
        # 确保文件名有正确的扩展名
        if not any(target_filename.lower().endswith(ext) for ext in ['.zip', '.rar', '.7z', '.7zip']):
            target_filename += '.zip'  # 默认添加.zip扩展名
        
        save_path = os.path.join(save_root, target_filename)
        download.save_as(save_path)
        
        print(f"✅ 文件下载成功: {save_path}")
        
        # 7. 写入密码文件
        if extracted_password:
            password_file = os.path.splitext(save_path)[0] + '.txt'
            with open(password_file, 'w', encoding='utf-8') as f:
                f.write(extracted_password)
            print(f"✅ 密码已写入: {password_file}")
        
        return {
            "success": True, 
            "zone": "B", 
            "message": "download_completed", 
            "payload": {"file_path": save_path, "password": extracted_password}
        }
        
    except Exception as e:
        print(f"❌ Zone B 下载流程失败: {e}")
        return {"success": False, "zone": "B", "message": f"download_error: {e}", "payload": None}


def _zone_b_find_download_link(current_frame, keyword):
    """查找并筛选B区下载链接"""
    try:
        # B区特有的attachpay链接选择器
        attachpay_selector = "a[href*='action=attachpay']"
        
        elements = current_frame.locator(attachpay_selector)
        count = elements.count()
        
        if count == 0:
            print("❌ 未找到attachpay下载链接")
            return None, None
        
        print(f"🔍 找到 {count} 个attachpay链接")
        
        # 筛选符合条件的链接
        valid_links = []
        
        for i in range(count):
            element = elements.nth(i)
            try:
                link_text = element.text_content() or ""
                link_href = element.get_attribute('href') or ""
                
                print(f"🔍 检查链接[{i}]: 文本='{link_text}', href='{link_href}'")
                
                # 过滤掉包含ed2k的文件（大小写不敏感）
                if 'ed2k' in link_text.lower():
                    print(f"⏭️ 跳过ed2k文件: {link_text}")
                    continue
                
                #排除"购买"文本的链接
                if link_text.strip() == '购买':
                    print(f"⏭️ 跳过购买按钮链接: {link_text}")
                    continue
                
                # 排除图片文件
                if any(link_text.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif']):
                    print(f"⏭️ 跳过图片文件: {link_text}")
                    continue
                
                # 添加到有效链接列表
                valid_links.append((element, link_text))
                print(f"✅ 有效链接: {link_text}")
                
            except Exception as e:
                print(f"⚠️ 检查链接时出错: {e}")
                continue
        
        if not valid_links:
            print("❌ 未找到有效的下载链接")
            return None, None
        
        # 选择第一个有效链接
        selected_element, selected_filename = valid_links[0]
        print(f"🎯 选择下载链接: {selected_filename}")
        
        return selected_element, selected_filename
        
    except Exception as e:
        print(f"❌ 查找下载链接失败: {e}")
        return None, None


def _zone_b_handle_purchase(current_frame, current_page):
    """处理B区购买确认对话框"""
    try:
        # 等待购买确认对话框出现
        current_frame.wait_for_timeout(2000)
        
        # 查找购买按钮的多种可能选择器
        purchase_selectors = [
            "button:has-text('购买附件')",
        ]
        
        purchase_button = None
        for selector in purchase_selectors:
            try:
                button = current_frame.locator(selector)
                if button.count() > 0:
                    purchase_button = button.first
                    print(f"✅ 找到购买按钮: {selector}")
                    break
            except Exception:
                continue
        
        if not purchase_button:
            print("❌ 未找到购买按钮")
            return False
        
        # 点击购买按钮
        purchase_button.click(timeout=5000)
        print("✅ 已点击购买按钮")
        
        # 等待页面刷新
        print("⏳ 等待页面刷新...")
        try:
            current_page.wait_for_load_state('networkidle', timeout=15000)
        except Exception:
            current_frame.wait_for_timeout(3000)
        
        return True
        
    except Exception as e:
        print(f"❌ 购买流程失败: {e}")
        return False


def download_zone_c(page_or_frame, keyword, save_root=None, options=None):
    # 复用现有新作区逻辑（包含购买+下载）
    try:
        find_and_print_priority_element(page_or_frame, section="新作区", do_purchase=True)
        return {"success": True, "zone": "C", "message": "zone_c_flow_completed", "payload": None}
    except Exception as e:
        print(f"❌ Zone C 执行失败: {e}")
        return {"success": False, "zone": "C", "message": str(e), "payload": None}


def download_zone_d(page_or_frame, keyword, save_root=None, options=None, verbose=True):
    """
    D区（字幕分享区）下载逻辑：
    1. 预提取解压密码（不写入）
    2. 点击附件链接，捕获新页面弹出和下载
    3. 下载成功后写入预提取的密码
    """
    import os
    
    # 1) 计算保存目录
    if save_root is None:
        save_root = os.path.join(os.path.dirname(__file__), "output", "downloads", keyword)
    os.makedirs(save_root, exist_ok=True)
    
    # 2) 获取页面和上下文
    try:
        if hasattr(page_or_frame, 'page'):
            click_page = page_or_frame.page
            current_frame = page_or_frame
        else:
            click_page = page_or_frame
            current_frame = click_page.main_frame
        
        ctx = click_page.context
    except Exception as e:
        print(f"❌ 获取页面上下文失败: {e}")
        return {"success": False, "zone": "D", "message": f"context_error: {e}", "payload": None}
    
    # 3) 扫描附件链接
    attachment_selectors = [
        "dl.tattl dd p.attnm a",                         # 优先匹配压缩包链接
        "a[href*='mod=attachment'][id^='aid']",
        "dl.tattl a[id^='aid']",
        "a[href*='forum.php'][href*='mod=attachment']",
        # 新增：支持ignore_js_op格式的附件链接
        "ignore_js_op a[href*='mod=misc'][href*='action=attachpay']",  # ignore_js_op内的付费附件
        "a[href*='mod=misc'][href*='action=attachpay']",               # 付费附件链接（attachpay）
        "span[id^='attach_'] a[href*='attachpay']",                    # span包装的附件链接
        "ignore_js_op span a",                                         # ignore_js_op内span中的链接
    ]
    
    target_link = None
    target_filename = None
    
    for selector in attachment_selectors:
        try:
            links = current_frame.locator(selector)
            count = links.count()
            if count > 0:
                print(f"🔍 找到 {count} 个附件链接")
                # 优先选择包含关键词且非图片的链接
                for i in range(count):
                    link = links.nth(i)
                    try:
                        link_text = link.text_content() or ""
                        link_href = link.get_attribute('href') or ""
                        
                        if verbose:
                            print(f"🔍 检查链接[{i}]: 文本='{link_text}', href='{link_href}'")
                        
                        # 排除图片文件
                        if any(link_text.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif']):
                            if verbose:
                                print(f"⏭️ 跳过图片文件: {link_text}")
                            continue
                        
                        # 优先选择包含关键词的链接
                        if keyword.upper() in link_text.upper():
                            target_link = link
                            target_filename = link_text.strip()
                            print(f"✅ 选中包含关键词的附件: {target_filename}")
                            break
                        
                        # 对于attachpay链接，也检查是否包含压缩包后缀
                        if 'attachpay' in link_href and any(link_text.lower().endswith(ext) for ext in ['.rar', '.zip', '.7z']):
                            target_link = link
                            target_filename = link_text.strip()
                            print(f"✅ 选中付费压缩包附件: {target_filename}")
                            break
                            
                    except Exception as e:
                        if verbose:
                            print(f"⚠️ 处理链接[{i}]时出错: {e}")
                        continue
                
                # 如果没有找到包含关键词的，选择第一个非图片文件
                if target_link is None:
                    for i in range(count):
                        link = links.nth(i)
                        try:
                            link_text = link.text_content() or f"{keyword}.zip"
                            link_href = link.get_attribute('href') or ""
                            
                            # 排除图片文件
                            if any(link_text.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif']):
                                continue
                            
                            # 优先选择压缩包文件
                            if any(link_text.lower().endswith(ext) for ext in ['.rar', '.zip', '.7z']):
                                target_link = link
                                target_filename = link_text.strip()
                                print(f"✅ 选中第一个压缩包附件: {target_filename}")
                                break
                            
                            # 或者选择attachpay链接
                            if 'attachpay' in link_href:
                                target_link = link
                                target_filename = link_text.strip()
                                print(f"✅ 选中第一个付费附件: {target_filename}")
                                break
                                
                        except Exception as e:
                            if verbose:
                                print(f"⚠️ 处理备选链接[{i}]时出错: {e}")
                            continue
                
                # 兜底：如果还没找到，选择第一个
                if target_link is None:
                    target_link = links.first
                    try:
                        target_filename = target_link.text_content() or f"{keyword}.zip"
                    except Exception:
                        target_filename = f"{keyword}.zip"
                    print(f"✅ 兜底选择第一个附件: {target_filename}")
                break
        except Exception as e:
            if verbose:
                print(f"⚠️ 使用选择器 '{selector}' 时出错: {e}")
            continue
    
    if target_link is None:
        print("❌ 未找到附件链接")
        return {"success": False, "zone": "D", "message": "no_attachment_found", "payload": None}
    
    # 4) 预提取解压密码（不写入）
    pre_pwd = None
    try:
        contexts_for_pre = [current_frame, click_page, getattr(click_page, 'main_frame', None)]
        contexts_for_pre = [ctx for ctx in contexts_for_pre if ctx is not None]
        # 去重
        seen = set()
        unique_contexts = []
        for ctx_item in contexts_for_pre:
            if id(ctx_item) not in seen:
                seen.add(id(ctx_item))
                unique_contexts.append(ctx_item)
        
        pre_pwd = extract_and_write_password(unique_contexts, downloaded_path=None, timeout_ms=5000, verbose=True)
        if pre_pwd:
            print("🔎 预提取解压密码：成功（不写入）")
        else:
            print("🔎 预提取解压密码：未找到（继续下载）")
    except Exception as e:
        print(f"🔎 预提取解压密码：异常（{e}），继续下载")
        pre_pwd = None
    
    # 5) 点击附件并等待下载（D区会跳转新页面下载）
    try:
        # 滚动到元素可见
        target_link.scroll_into_view_if_needed(timeout=3000)
        
        # D区特殊处理：点击后会跳转新页面，需要在新页面监听下载
        try:
            # 同时监听新页面弹出和下载事件
            with click_page.expect_popup(timeout=10000) as popup_info:
                target_link.click(timeout=5000)
            
            # 获取新页面
            new_page = popup_info.value
            print("🪟 捕获到新页面，等待自动下载...")
            
            # 在新页面上监听下载事件
            with new_page.expect_download(timeout=30000) as download_info:
                # 等待新页面加载并自动触发下载
                new_page.wait_for_load_state('domcontentloaded', timeout=10000)
            
            # 获取下载对象
            download = download_info.value
            print("✅ 成功捕获新页面下载")
            
        except Exception as e:
            # 如果没有新页面弹出，回退到原页面监听
            print(f"ℹ️ 未检测到新页面弹出，回退到原页面监听: {e}")
            with click_page.expect_download(timeout=30000) as download_info:
                target_link.click(timeout=5000)
            download = download_info.value
            print("✅ 成功捕获原页面下载")
        
        # 6) 保存下载文件
        # 确保文件名有正确的扩展名
        if not any(target_filename.lower().endswith(ext) for ext in ['.zip', '.rar', '.7z', '.7zip']):
            if '.' not in target_filename:
                target_filename += '.zip'
        
        save_path = os.path.join(save_root, target_filename)
        download.save_as(save_path)
        print(f"✅ 下载完成: {save_path}")
        
        # 7) 成功后写入密码
        if pre_pwd:
            try:
                txt_path = os.path.splitext(save_path)[0] + ".txt"
                with open(txt_path, 'w', encoding='utf-8') as f:
                    f.write(pre_pwd)
                print(f"📝 使用预提取密码写入: {txt_path}")
            except Exception as e:
                print(f"⚠️ 写入密码文件失败: {e}")
        else:
            print("ℹ️ 未预提取到密码，跳过写入")
        
        return {"success": True, "zone": "D", "message": "download_completed", "payload": {"save_path": save_path, "filename": target_filename}}
        
    except Exception as e:
        print(f"❌ 下载失败: {e}")
        return {"success": False, "zone": "D", "message": f"download_failed: {e}", "payload": None}


def download_handler(section, page_or_frame, keyword, save_root=None, options=None):
    if page_or_frame is None:
        return {"success": False, "zone": None, "message": "invalid_page_or_frame", "payload": None}
    zone = get_zone_code(section)
    try:
        if zone == "A":
            return download_zone_a(page_or_frame, keyword, save_root, options)
        elif zone == "B":
            return download_zone_b(page_or_frame, keyword, save_root, options)
        elif zone == "C":
            return download_zone_c(page_or_frame, keyword, save_root, options)
        elif zone == "D":
            return download_zone_d(page_or_frame, keyword, save_root, options)
        else:
            print(f"ℹ️ 未识别的专区: {section}")
            return {"success": False, "zone": zone, "message": "unknown_section", "payload": None}
    except Exception as e:
        print(f"⚠️ 下载处理异常: {e}")
        return {"success": False, "zone": zone, "message": str(e), "payload": None}


def find_and_print_priority_element(root, section=None, do_purchase=False, search_keyword=None):
    """
    在帖子页按优先级查找元素并执行购买流程
    
    Args:
        root: 页面或框架对象
        section: 专区名称
        do_purchase: 是否执行购买流程
        search_keyword: 搜索关键词，如果为None则使用全局SEARCH_KEYWORD
    """
    # 支持显式传递search_keyword参数，批量模式下取消对全局变量的依赖
    keyword = search_keyword if search_keyword is not None else SEARCH_KEYWORD
    
    # 先在当前 root 扫描
    print("🔎 在帖子页按优先级查找元素: 购买主题 > 购买 > 附件付费链接文本 > 直链附件文本")
    print(f"🔍 使用关键词: {keyword}")
    
    # 新作区且允许购买时，尝试执行购买流程（仅在新作区生效）
    if do_purchase and (section or "").strip() == "新作区":
      # 未命中则在所有 frame 中扫描
        frames = getattr(root, 'frames', []) or []
        for fr in frames:
            # try:
            found = scan_in_root(fr)
            if found:
                print(f"📌 命中元素文本: {found}")
                # 新作区且允许购买时，尝试执行购买流程（仅在新作区生效）
                if do_purchase and (section or "").strip() == "新作区":
                    try:
                        print(f"🖱️ 正在尝试购买: {found}")
                        seldefs = [
                            ('buy_topic', "a.viewpay[title='购买主题'], a.y.viewpay[title='购买主题'], a[href*='mod=misc'][href*='action=pay']"),
                            ('buy', "a[href*='mod=misc'][href*='action=attachpay']"),
                            ('attachpay_file', "a[href*='mod=misc'][href*='action=attachpay']"),
                            ('direct_attachment', "a[href*='mod=attachment'][href*='aid=']"),
                        ]
                        exts2 = ['.zip', '.rar', '.7z', '.ass', '.srt', '.ssa', '.vtt', '.lrc', '.sub']
                        frames_to_scan = [fr]
                        frames_to_scan += (getattr(fr, 'frames', []) or [])
                        kind = sel = None
                        idx = -1
                        hit_frame = None
                        for frx in frames_to_scan:
                            for k, s in seldefs:
                                locx = frx.locator(s)
                                cx = locx.count()
                                for i in range(cx):
                                    el = locx.nth(i)
                                    try:
                                        txt = text_of(el)
                                    except Exception:
                                        txt = ""
                                    low = (txt or "").lower().strip()
                                    if (txt or "").strip() == (found or "").strip():
                                        if k == 'buy':
                                            if (txt or '').strip() == '购买':
                                                kind, sel, idx, hit_frame = 'buy', s, i, frx
                                                break
                                        elif k == 'attachpay_file':
                                            if (txt or '').strip() != '购买' and any(low.endswith(ext) for ext in exts2):
                                                kind, sel, idx, hit_frame = 'attachpay_file', s, i, frx
                                                break
                                        elif k == 'direct_attachment':
                                            if any(low.endswith(ext) for ext in exts2):
                                                kind, sel, idx, hit_frame = 'direct_attachment', s, i, frx
                                                break
                                        else:
                                            kind, sel, idx, hit_frame = 'buy_topic', s, i, frx
                                            break
                                if kind:
                                    break
                            if kind:
                                break
                        if not kind:
                            print("ℹ️ 未能重新定位命中元素，跳过购买流程")
                        else:
                            target = hit_frame.locator(sel).nth(idx)
                            target.scroll_into_view_if_needed(timeout=2000)
                            
                            try:
                                target.click(timeout=5000, force=True)
                            except Exception as e:
                                print(f"⚠️ 点击命中元素失败: {e}")
                            modal_sel = "#fctrl_attachpay, em#return_attachpay[fwin='attachpay'], div.f_c >> #fctrl_attachpay"
                            modal_found = False
                            try:
                                hit_frame.wait_for_selector(modal_sel, timeout=5000)
                                modal_found = True
                                print("🪟 购买窗口已出现")
                            except Exception:
                                print("ℹ️ 未检测到购买窗口，继续验证是否已购买/刷新")
                            if modal_found:
                                btn_selectors = [
                                    "button[name='paysubmit'][value='true']",
                                    ".o.pns button:has-text('购买附件')",
                                    "button.pn.pnc:has-text('购买附件')",
                                ]
                                btn_clicked = False
                                for bs in btn_selectors:
                                    bl = hit_frame.locator(bs)
                                    if bl.count() > 0:
                                        try:
                                            bl.first.click(timeout=5000, force=True)
                                            btn_clicked = True
                                            break
                                        except Exception:
                                            continue
                                if btn_clicked:
                                    print("🛒 已点击购买附件，等待页面刷新…")
                                    try:
                                        (hit_frame.page if hasattr(hit_frame, 'page') else fr.page).wait_for_load_state('networkidle', timeout=10000)
                                    except Exception:
                                        hit_frame.wait_for_timeout(1500)
                            exists = still_exists_check(hit_frame, sel, kind, exts2)
                            if not exists:
                                print("✅ 已执行购买，并成功")
                                # 购买成功后，尝试查找直链下载并保存到指定目录
                                try:
                                    success, save_path, msg = try_download_after_purchase(hit_frame, fr, keyword, skip_password_extraction=False)
                                    if success and save_path:
                                        print(f"✅ 新作区下载完成: {save_path}")
                                    else:
                                        print(f"⚠️ 新作区下载失败: {msg}")
                                except Exception as e:
                                    print(f"⚠️ 下载处理异常: {e}")
                            else:
                                print("⚠️ 购买未完成或页面未刷新")
                    except Exception as e:
                        print(f"❌ 购买流程失败: {e}")
                return
            else:
              # 兜底：未找到任何匹配元素
              print("此附件已购买")
              try:
                  sys.exit(0)
              except SystemExit:
                  raise

        return


def open_result_link(target_page, result, official_section, keyword=None):
    """
    打开搜索结果链接并执行下载流程
    
    Args:
        target_page: 目标页面对象
        result: 搜索结果字典
        official_section: 官方专区名称
        keyword: 搜索关键词，如果为None则使用全局SEARCH_KEYWORD
    """
    # 支持显式传递keyword参数，批量模式下取消对全局变量的依赖
    search_keyword = keyword if keyword is not None else SEARCH_KEYWORD
    
    try:
        title = result.get("title", "")
        link = result.get("link", "")
        print(f"✅ 已选择结果: [{official_section}] {title}")
        print(f"🔍 使用关键词: {search_keyword}")
        print(f"➡️ 正在进入: {link}")
        target_page.goto(link, wait_until="domcontentloaded", timeout=20000)
        try:
            target_page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        print("🎉 进入成功")
        # 统一通过下载调度入口，根据专区路由执行下载流程
        try:
            result_obj = download_handler(official_section, target_page, search_keyword, save_root=None, options=None)
            ok = bool(result_obj.get("success"))
            zone = result_obj.get("zone")
            msg = result_obj.get("message")
            if ok:
                print(f"✅ 下载流程完成: zone={zone} msg={msg}")
            else:
                print(f"ℹ️ 下载流程未完成: zone={zone} msg={msg}")
        except Exception as e:
            print(f"⚠️ 下载流程异常: {e}")
        return True
    except Exception as e:
        print(f"❌ 进入失败: {e}")
        return False


def do_prioritized_open(page, keyword=SEARCH_KEYWORD):
    # 执行站内搜索
    perform_search(page, keyword)

    # 选择承载搜索结果的页面（可能新开标签页）
    target_page = page
    try:
        for p in page.context.pages:
            try:
                if "search.php" in (p.url or ""):
                    target_page = p
                    break
            except Exception:
                continue
    except Exception:
        pass

    # 确保搜索结果元素已出现
    try:
        target_page.wait_for_selector("a.xst, a[href*='viewthread'], th > a[href*='thread'], h3 a, .pbw a[href*='thread']", timeout=8000)
    except Exception:
        pass

    results = scrape_search_results(target_page)

    print("🎯 根据优先级选择专区: 自译字幕区 > 自提字幕区 > 新作区 > 字幕分享区")
    if not results:
        print("❌ 未找到符合优先级的搜索结果，退出")
        return False

    chosen, official = choose_best_result(results)
    if not chosen:
        print("❌ 未找到符合优先级的搜索结果，退出")
        return False

    return open_result_link(target_page, chosen, official)


def run(playwright: Playwright) -> None:
    # 启动浏览器 - 使用真实Chrome浏览器而非Chromium
    try:
        # 尝试使用系统安装的Chrome浏览器
        browser = playwright.chromium.launch(
            headless=False,
            channel="msedge",  # 使用真实edge浏览器
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--disable-extensions-except",
                "--disable-plugins-discovery",
                "--disable-default-apps",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-field-trial-config",
                "--disable-back-forward-cache",
                "--disable-ipc-flooding-protection",
                "--disable-hang-monitor",
                "--disable-prompt-on-repost",
                "--disable-sync",
                "--disable-component-extensions-with-background-pages",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-client-side-phishing-detection",
                "--disable-datasaver-prompt",
                "--disable-domain-reliability",
                "--disable-features=TranslateUI",
                "--disable-features=BlinkGenPropertyTrees",
                "--disable-features=Translate",
                "--disable-features=ImprovedCookieControls",
                "--disable-features=LazyFrameLoading",
                "--disable-features=GlobalMediaControls",
                "--disable-features=DestroyProfileOnBrowserClose",
                "--disable-features=MediaRouter",
                "--disable-features=DialMediaRouteProvider",
                "--disable-features=AcceptCHFrame",
                "--disable-features=AutoExpandDetailsElement",
                "--disable-features=CertificateTransparencyComponentUpdater",
                "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync",
                "--disable-features=Prerender2",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ]
        )
        print("✅ 使用真实Chrome浏览器启动成功")
    except Exception as e:
        print(f"⚠️ Chrome浏览器启动失败，回退到Chromium: {e}")
        # 回退到Chromium
        browser = playwright.chromium.launch(
            headless=False,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--disable-extensions-except",
                "--disable-plugins-discovery",
                "--disable-default-apps",
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ]
        )
    
    # 尝试加载已保存的session
    session_state = load_session_if_exists()

    # 仅允许使用当前目录下的 session.json 进行 Cookie 登录；不存在则提示并退出
    if not session_state:
        print("未发现 ./session.json，请先使用 Playwright codegen 登录并保存会话到 ./session.json 后重试。")
        print("示例：python -m playwright codegen --channel=msedge --save-storage=./session.json https://37ub.w7zvq.net/forum.php")
        browser.close()
        return

    print("发现已保存的session，使用 Cookie 登录...")
    context = browser.new_context(
        storage_state=session_state,
        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport={'width': 1920, 'height': 1080},
        extra_http_headers={
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
        },
        accept_downloads=True
    )
    
    page = context.new_page()
    
    # 应用stealth模式隐藏自动化特征
    stealth_sync(page)
    
    # 注册路由拦截器
    page.route("**/*", handle_route)
    
    # 注册事件监听器
    page.on("response", handle_response)
    page.on("requestfailed", handle_request_failed)
    
    # 添加JavaScript代码来隐藏自动化特征和反开发者工具检测
    page.add_init_script("""
        // 删除webdriver属性
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        // 修改plugins长度
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        // 修改languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['zh-CN', 'zh', 'en'],
        });
        
        // 覆盖chrome对象
        window.chrome = {
            runtime: {},
        };
        
        // 覆盖permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
        
        // 高级反调试检测绕过 - 基于最新技术
        
        // 1. 阻止DevTools检测的多种方法
        let devtools = { open: false };
        
        // 覆盖console对象的所有方法
        const noop = () => {};
        ['assert', 'clear', 'count', 'debug', 'dir', 'dirxml', 'error', 'exception', 'group', 'groupCollapsed', 'groupEnd', 'info', 'log', 'markTimeline', 'profile', 'profileEnd', 'table', 'time', 'timeEnd', 'timeline', 'timelineEnd', 'timeStamp', 'trace', 'warn'].forEach(method => {
            window.console[method] = noop;
        });
        
        // 2. 阻止常见的调试检测方法
        Object.defineProperty(window, 'outerHeight', {
            get: () => window.innerHeight,
            configurable: false
        });
        
        Object.defineProperty(window, 'outerWidth', {
            get: () => window.innerWidth,
            configurable: false
        });
        
        // 3. 阻止通过异常堆栈检测调试器
        const originalError = window.Error;
        window.Error = function(...args) {
            const error = new originalError(...args);
            // 清空堆栈信息
            error.stack = '';
            return error;
        };
        
        // 4. 阻止通过性能API检测调试器
        if (window.performance && window.performance.now) {
            const originalNow = window.performance.now;
            let lastTime = originalNow.call(window.performance);
            window.performance.now = function() {
                const currentTime = originalNow.call(window.performance);
                // 确保时间差不会太大（避免断点检测）
                if (currentTime - lastTime > 100) {
                    lastTime += Math.random() * 20 + 10; // 10-30ms的随机增量
                } else {
                    lastTime = currentTime;
                }
                return lastTime;
            };
        }
        
        // 5. 阻止通过requestAnimationFrame检测调试器
        const originalRAF = window.requestAnimationFrame;
        window.requestAnimationFrame = function(callback) {
            return originalRAF.call(window, function(timestamp) {
                // 确保回调正常执行，不被调试器影响
                try {
                    callback(timestamp);
                } catch (e) {
                    // 忽略回调中的错误
                }
            });
        };
        
        // 6. 阻止通过setInterval/setTimeout检测调试器
        const originalSetInterval = window.setInterval;
        const originalSetTimeout = window.setTimeout;
        
        window.setInterval = function(callback, delay) {
            return originalSetInterval.call(window, function() {
                try {
                    callback();
                } catch (e) {
                    // 忽略定时器回调中的错误
                }
            }, delay);
        };
        
        window.setTimeout = function(callback, delay) {
            return originalSetTimeout.call(window, function() {
                try {
                    callback();
                } catch (e) {
                    // 忽略定时器回调中的错误
                }
            }, delay);
        };
        
        // 7. 阻止通过toString检测调试器
        const originalToString = Function.prototype.toString;
        Function.prototype.toString = function() {
            if (this === window.console.log || 
                this === window.console.clear || 
                this === window.console.dir ||
                this === window.console.debug) {
                return 'function () { [native code] }';
            }
            return originalToString.call(this);
        };
        
        // 8. 阻止通过RegExp检测调试器
        const originalRegExpTest = RegExp.prototype.test;
        RegExp.prototype.test = function(str) {
            // 如果正则表达式用于检测调试器相关内容，返回false
            if (this.source.includes('devtools') || 
                this.source.includes('console') || 
                this.source.includes('debugger')) {
                return false;
            }
            return originalRegExpTest.call(this, str);
        };
        
        // 9. 阻止通过document.hasFocus检测调试器
        if (document.hasFocus) {
            document.hasFocus = function() {
                return true; // 始终返回true，表示页面有焦点
            };
        }
        
        // 10. 阻止通过visibilitychange事件检测调试器
        Object.defineProperty(document, 'hidden', {
            get: () => false,
            configurable: false
        });
        
        Object.defineProperty(document, 'visibilityState', {
            get: () => 'visible',
            configurable: false
        });
        
        // 11. 阻止通过blur/focus事件检测调试器
        ['blur', 'focus', 'focusin', 'focusout'].forEach(eventType => {
            window.addEventListener(eventType, function(e) {
                e.stopImmediatePropagation();
            }, true);
        });
        
        // 12. 最终的兜底方案 - 阻止所有可能的调试检测
        const originalAddEventListener = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            // 阻止监听可能用于调试检测的事件
            if (['resize', 'beforeunload', 'unload', 'pagehide'].includes(type)) {
                return; // 不注册这些事件监听器
            }
            return originalAddEventListener.call(this, type, listener, options);
        };
        
        // 处理图片加载错误，避免影响页面加载状态
        document.addEventListener('DOMContentLoaded', function() {
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                img.onerror = function() {
                    console.log('图片加载失败，使用占位符:', this.src);
                    this.style.display = 'none'; // 隐藏失败的图片
                    this.removeAttribute('src'); // 移除失败的src
                };
            });
            
            // 监听新添加的图片
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && node.tagName === 'IMG') {
                            node.onerror = function() {
                                console.log('新图片加载失败:', this.src);
                                this.style.display = 'none';
                                this.removeAttribute('src');
                            };
                        }
                    });
                });
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
        
        // 强制设置页面加载完成状态
        Object.defineProperty(document, 'readyState', {
            get: function() { return 'complete'; },
            configurable: true
        });
        
        // 阻止redi脚本重复加载检测和其他错误
        window.addEventListener('error', function(e) {
            if (e.message && (e.message.includes('redi') || e.message.includes('404') || e.message.includes('Failed to load'))) {
                e.stopPropagation();
                e.preventDefault();
                return false;
            }
        });
        
        // 覆盖XMLHttpRequest和fetch来处理404错误
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new originalXHR();
            const originalSend = xhr.send;
            xhr.send = function(...args) {
                xhr.addEventListener('error', function() {
                    console.log('XHR请求失败，但不影响页面状态');
                });
                return originalSend.apply(this, args);
            };
            return xhr;
        };
        
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            return originalFetch.apply(this, args).catch(error => {
                console.log('Fetch请求失败，但不影响页面状态:', error);
                return Promise.resolve(new Response('', { status: 200 }));
            });
        };
    """)
    
    
    
    # 访问网站
    try:
        print("正在访问网站...")
        # 使用 domcontentloaded 等待策略，不等待所有资源加载完成
        page.goto("https://37ub.w7zvq.net/forum.php", 
                 wait_until="domcontentloaded", 
                 timeout=30000)
        print("网站访问成功")
        
        # 快速检测是否已登录（例如 Edge 记住密码后自动登录）
        try:
            if check_login_status(page):
                print("检测到已登录（浏览器自动登录），跳过登录流程")
                try:
                    context.storage_state(path="./session.json")
                    print("已保存session状态")
                except Exception as e:
                    print(f"保存session失败: {e}")
                # 结束流程前执行搜索
                try:
                    do_prioritized_open(page, SEARCH_KEYWORD)
                except Exception:
                    pass
                # 结束流程
                try:
                    page.wait_for_load_state("networkidle", timeout=5000)
                except Exception:
                    pass
                time.sleep(5)
                page.close()
                context.close()
                browser.close()
                return
        except Exception:
            pass
        
        # 等待页面稳定，但不强制等待所有资源
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except:
            print("部分资源仍在加载中，但页面已可用")
            
    except Exception as e:
        print(f"访问网站失败: {e}")
        print("尝试访问备用地址或检查网络连接")
        browser.close()
        return
    
    # 仅使用 Cookie 登录，不做密码登录回退
    if check_login_status(page):
        print("Cookie 登录成功")
        # 执行搜索
        try:
            do_prioritized_open(page, SEARCH_KEYWORD)
        except Exception:
            pass
    else:
        print("Cookie 登录失败或未登录。请更新 ./session.json 后重试。")
        browser.close()
        return
    
    # 等待页面加载完成后再进行后续操作（如有）
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    time.sleep(5)
    page.close()

    # 保持会话文件为最新（若站点刷新了 cookie）
    try:
        context.storage_state(path="./session.json")
    except Exception:
        pass
    context.close()
    browser.close()


# 新增：从页面/Frame提取压缩包解压密码并写入与下载文件同名的txt
def extract_and_write_password(contexts, downloaded_path, timeout_ms=5000, verbose=True):
    import os
    try:
        # 允许在未提供 downloaded_path 的情况下也进行提取，不做早退
        # if not downloaded_path:
        #     return None
        # 构建候选上下文列表并去重、过滤空值
        uniq = []
        seen = set()
        for c in contexts or []:
            if c is None:
                continue
            try:
                cid = id(c)
            except Exception:
                continue
            if cid in seen:
                continue
            seen.add(cid)
            uniq.append(c)

        password = None
        for ctx in uniq:
            try:
                # 方法1: 原有的 blockcode 方法
                try:
                    blockcode_sel = "div.blockcode"
                    loc = None
                    try:
                        loc = ctx.locator(blockcode_sel)
                    except Exception:
                        loc = None
                    
                    cnt = 0
                    try:
                        cnt = loc.count() if loc else 0
                    except Exception:
                        cnt = 0

                    if verbose:
                        print(f"🔍 回退方法：找到 {cnt} 个 div.blockcode 元素")

                    # 遍历所有 blockcode 元素，获取 innerText
                    for i in range(cnt):
                        try:
                            blockcode_element = loc.nth(i)
                            inner_text = blockcode_element.inner_text().strip()
                            
                            if verbose:
                                print(f"📄 blockcode[{i}] innerText: {inner_text}")
                            
                            if inner_text:
                                # 简单过滤：排除明显的链接
                                lines = inner_text.split('\n')
                                for line in lines:
                                    line = line.strip()
                                    if not line:
                                        continue
                                    
                                    # 排除磁力链接和HTTP链接
                                    line_lower = line.lower()
                                    if line_lower.startswith("magnet:") or "magnet:?" in line_lower:
                                        continue
                                    if line_lower.startswith("http://") or line_lower.startswith("https://"):
                                        continue
                                    if line_lower.startswith("pikpak://"):
                                        continue
                                    
                                    # 排除"复制代码"等无关文本
                                    if "复制代码" in line or "点击" in line or "回复" in line:
                                        continue
                                    
                                    # 找到潜在的密码
                                    password = line
                                    if verbose:
                                        print(f"✅ 从 blockcode[{i}] 提取到密码: {password}")
                                    break
                            
                            if password:
                                break
                                
                        except Exception as e:
                            if verbose:
                                print(f"⚠️ 处理 blockcode[{i}] 时出错: {e}")
                            continue

                            
                except Exception as e:
                    if verbose:
                        print(f"⚠️ blockcode 方法时出错: {e}")

                # 方法2: 回退到查找【解压密码】标签后的内容
                if not password:
                    # 尝试多种XPath选择器，包括更宽泛的搜索
                    xpath_selectors = [
                        "xpath=//*[contains(text(),'解压密码')]",
                        "xpath=//*[contains(text(),'【解压密码】')]",
                        "xpath=//td[contains(@class,'t_f')]//*[contains(text(),'解压密码')]",
                        "xpath=//td[starts-with(@id,'postmessage_')]//*[contains(text(),'解压密码')]",
                        "xpath=//div[contains(text(),'解压密码')]",
                        "xpath=//*[contains(text(),'密码')]",  # 更宽泛的搜索
                        "xpath=//*[contains(text(),'www.98T.la')]"  # 直接搜索链接文本
                    ]
                    
                    password_elements = None
                    password_count = 0
                    used_xpath = ""
                    
                    for xpath in xpath_selectors:
                        try:
                            elements = ctx.locator(xpath)
                            count = elements.count()
                            if verbose:
                                print(f"🔍 XPath: {xpath} - 找到 {count} 个元素")
                            if count > 0:
                                password_elements = elements
                                password_count = count
                                used_xpath = xpath
                                # 输出找到的元素内容用于调试
                                if verbose:
                                    for i in range(min(count, 3)):  # 最多显示前3个
                                        try:
                                            element_text = elements.nth(i).text_content()
                                            print(f"  元素[{i}]文本: {element_text}")
                                        except Exception:
                                            pass
                                break
                        except Exception as e:
                            if verbose:
                                print(f"⚠️ XPath {xpath} 执行失败: {e}")
                    
                    if verbose:
                        print(f"🔍 最终使用XPath: {used_xpath}, 找到 {password_count} 个包含目标文本的元素")
                    
                    for i in range(password_count):
                        try:
                            # 获取包含"解压密码"的整行文本
                            password_element = password_elements.nth(i)
                            # 获取父元素或包含完整密码信息的元素
                            parent_element = password_element.locator("xpath=..")
                            full_text = parent_element.inner_text().strip()
                            
                            if verbose:
                                print(f"📄 解压密码行[{i}] 完整文本: {full_text}")
                            
                            # 从文本中提取密码
                            import re
                            
                            # 首先尝试直接从inner_text()获取纯文本密码（适用于font标签格式）
                            element_inner_text = password_element.inner_text().strip()
                            if verbose:
                                print(f"📄 元素inner_text: {element_inner_text}")
                            
                            # 匹配【解压密码】：后面的内容，支持多种格式
                            password_patterns = [
                                r'【解压密码】[：:]\s*(.+?)(?:\s*【|$)',  # 原有格式
                                r'【解压密码】[：:]\s*(.+)',  # 更宽泛的匹配
                                r'解压密码[：:]\s*(.+?)(?:\s*【|$)',  # 无括号格式
                                r'解压密码[：:]\s*(.+)'  # 无括号宽泛格式
                            ]
                            
                            password_text = None
                            for pattern in password_patterns:
                                match = re.search(pattern, element_inner_text)
                                if match:
                                    password_text = match.group(1).strip()
                                    if verbose:
                                        print(f"✅ 使用模式 '{pattern}' 提取到: {password_text}")
                                    break
                            
                            # 如果inner_text没有匹配到，尝试从full_text匹配
                            if not password_text:
                                for pattern in password_patterns:
                                    match = re.search(pattern, full_text)
                                    if match:
                                        password_text = match.group(1).strip()
                                        if verbose:
                                            print(f"✅ 从完整文本使用模式 '{pattern}' 提取到: {password_text}")
                                        break
                            
                            if password_text:
                                # 如果包含HTML链接，需要提取链接文本和后续内容
                                if '<a ' in password_text and '</a>' in password_text:
                                    # 使用Playwright获取实际显示的文本内容
                                    try:
                                        # 查找包含链接的具体元素
                                        link_xpath = f"xpath=//td[contains(@class,'t_f') and starts-with(@id,'postmessage_')]//*[contains(text(),'解压密码')]/following-sibling::*[1]//a | //td[contains(@class,'t_f') and starts-with(@id,'postmessage_')]//*[contains(text(),'解压密码')]/parent::*/following-sibling::*[1]//a"
                                        link_elements = ctx.locator(link_xpath)
                                        if link_elements.count() > 0:
                                            link_text = link_elements.first.inner_text().strip()
                                            
                                            if verbose:
                                                print(f"🔗 找到链接文本: {link_text}")
                                            
                                            # 检查链接文本是否已经包含完整密码（包含@符号）
                                            if '@' in link_text:
                                                # 链接文本本身就是完整密码，如: www.98T.la@ak6fgd3s9k
                                                password = link_text
                                                if verbose:
                                                    print(f"✅ 从链接文本直接提取到完整密码: {password}")
                                            else:
                                                # 链接文本不完整，需要查找后续的@符号内容
                                                following_text = ""
                                                try:
                                                    # 获取链接元素的父元素文本
                                                    link_parent = link_elements.first.locator("xpath=..")
                                                    parent_text = link_parent.inner_text().strip()
                                                    
                                                    if verbose:
                                                        print(f"🔗 链接父元素文本: {parent_text}")
                                                    
                                                    # 提取@符号后的内容
                                                    at_match = re.search(rf'{re.escape(link_text)}(@\w+)', parent_text)
                                                    if at_match:
                                                        following_text = at_match.group(1)
                                                        if verbose:
                                                            print(f"🔗 找到@后缀: {following_text}")
                                                except Exception as e:
                                                    if verbose:
                                                        print(f"⚠️ 获取@后缀时出错: {e}")
                                                
                                                password = link_text + following_text
                                                if verbose:
                                                    print(f"✅ 组合链接文本和后缀得到密码: {password}")
                                            
                                            break
                                    except Exception as e:
                                        if verbose:
                                            print(f"⚠️ 处理解压密码链接时出错: {e}")
                                else:
                                    # 纯文本密码，直接使用
                                    password = password_text
                                    if verbose:
                                        print(f"✅ 从解压密码文本提取到密码: {password}")
                                    break
                            else:
                                if verbose:
                                    print(f"⚠️ 未能从元素[{i}]中提取到密码文本")
                        except Exception as e:
                            if verbose:
                                print(f"⚠️ 处理解压密码元素[{i}]时出错: {e}")
                            continue
                   
            except Exception:
                continue
            if password:
                break

        if password:
            if downloaded_path:
                base, _ = os.path.splitext(downloaded_path)
                txt_path = base + ".txt"
                try:
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(password)
                    if verbose:
                        print(f"📝 已写入解压密码: {txt_path}")
                except Exception as e:
                    if verbose:
                        print(f"⚠️ 写入解压密码文件失败: {e}")
            else:
                if verbose:
                    print(f"✅ 已提取解压密码（未提供保存路径，跳过自动写入）: {password}")
            return password
        else:
            if verbose:
                print("ℹ️ 未找到解压密码元素（.blockcode/...），跳过写入。")
            return None
    except Exception as e:
        if verbose:
            print(f"⚠️ 提取解压密码时发生异常: {e}")
        return None


def try_download_after_purchase(hit_frame, parent_context, search_keyword, save_root=None, candidate_domains=None, candidate_selectors=None, timeout_download_ms=20000, click_timeout_ms=8000, skip_password_extraction=False, verbose=True):
    import os
    # 1) 计算保存目录
    if save_root is None:
        save_root = os.path.join(os.path.dirname(__file__), "output", "downloads", search_keyword)
    os.makedirs(save_root, exist_ok=True)

    # 2) 解析 click_page（确保具备 expect_download）
    click_page = None
    try:
        click_page = getattr(hit_frame, 'page', None) or getattr(parent_context, 'page', None)
    except Exception:
        click_page = None
    if click_page is None:
        click_page = parent_context
    try:
        if not hasattr(click_page, "expect_download") and hasattr(click_page, "page"):
            click_page = click_page.page
    except Exception:
        pass

    # 3) 汇总需要扫描的 frames
    frames_to_check = []
    frames_to_check.append(hit_frame)
    frames_to_check += (getattr(hit_frame, 'frames', []) or [])
    try:
        frames_to_check.append(parent_context)
    except Exception:
        pass
    # 去重
    unique_frames = []
    seen_ids = set()
    for f in frames_to_check:
        try:
            fid = id(f)
            if fid not in seen_ids:
                unique_frames.append(f)
                seen_ids.add(fid)
        except Exception:
            pass
    frames_to_check = unique_frames

    # 4) 构建候选选择器
    if candidate_domains is None:
        candidate_domains = ["tu.ymawv.la"]
    if candidate_selectors is None:
        candidates = []
        for domain in candidate_domains:
            candidates.append(f"a[href*='{domain}'][href*='{search_keyword}'][href$='.rar']")
            candidates.append(f"a[href*='{domain}'][href*='{search_keyword}'][href*='.rar?']")
            candidates.append(f"a[href*='{domain}'][href$='.rar']")
            candidates.append(f"a[href*='{domain}'][href*='.rar?']")
        candidates.append("a[href*='mod=attachment'][href*='aid=']")
    else:
        candidates = candidate_selectors

    # 5) 遍历点击并等待下载
    last_error = None
    for frx in frames_to_check:
        for selx in candidates:
            try:
                loc = frx.locator(selx)
                cnt = 0
                try:
                    cnt = loc.count()
                except Exception:
                    cnt = 0
                if cnt > 0:
                    try:
                        with click_page.expect_download(timeout=timeout_download_ms) as di:
                            loc.first.click(timeout=click_timeout_ms, force=True)
                        download = di.value
                        try:
                            fn = download.suggested_filename
                        except Exception:
                            fn = f"{search_keyword}.rar"
                        save_path = os.path.join(save_root, fn)
                        download.save_as(save_path)
                        if verbose:
                            print(f"✅ 下载完成: {save_path}")
                        # 新增：下载成功后提取页面解压密码并写入同名txt（可通过参数跳过）
                        if not skip_password_extraction:
                            try:
                                contexts_for_pwd = [
                                    frx,
                                    hit_frame,
                                    parent_context,
                                    getattr(parent_context, "main_frame", None),
                                    click_page,
                                ]
                                # 过滤空值并去重
                                contexts_for_pwd = [ctx for ctx in contexts_for_pwd if ctx is not None]
                                seen = set()
                                unique_contexts = []
                                for ctx in contexts_for_pwd:
                                    if id(ctx) not in seen:
                                        seen.add(id(ctx))
                                        unique_contexts.append(ctx)
                                
                                # 提取密码并写入文件
                                extracted_pwd = extract_and_write_password(unique_contexts, save_path, timeout_ms=5000, verbose=verbose)
                                if extracted_pwd:
                                    print(f"📝 下载成功后提取并写入密码: {extracted_pwd}")
                                else:
                                    print("ℹ️ 下载成功但未找到解压密码")
                            except Exception as e:
                                # 不影响下载流程
                                print(f"⚠️ 密码提取失败: {e}")
                                pass
                        return True, save_path, "下载完成"
                    except Exception as e:
                        last_error = str(e)
                        continue
            except Exception as e:
                last_error = str(e)
                continue

    # 6) 兜底：未触发下载
    if verbose:
        if last_error:
            print(f"⚠️ 未找到直链下载链接，或点击未触发下载：{last_error}")
        else:
            print("⚠️ 未找到直链下载链接，或点击未触发下载")
    return False, None, last_error or "未找到直链下载链接，或点击未触发下载"

# 批量下载功能入口
def batch_download_from_csv(csv_file_path, video_type_filter=None, max_downloads=None, delay=2.0):
    """
    从CSV文件批量下载字幕
    
    Args:
        csv_file_path: CSV文件路径
        video_type_filter: 视频类型筛选条件，如"无码"、"有码"等
        max_downloads: 最大下载数量限制
        delay: 下载间隔时间（秒）
    
    Returns:
        dict: 下载统计结果
    """
    try:
        # 导入批量下载模块
        from csv_utils import get_video_codes_from_csv
        from batch_downloader import create_batch_downloader
        
        print(f"🚀 开始批量下载任务")
        print(f"📁 CSV文件: {csv_file_path}")
        print(f"🎯 视频类型筛选: {video_type_filter or '全部'}")
        print(f"📊 最大下载数: {max_downloads or '无限制'}")
        print(f"⏱️ 下载间隔: {delay}秒")
        print("-" * 60)
        
        # 从CSV提取视频编号
        video_codes = get_video_codes_from_csv(csv_file_path, video_type_filter)
        
        if not video_codes:
            print("❌ 未从CSV文件中提取到任何视频编号")
            return {"success": False, "message": "无有效视频编号"}
        
        print(f"✅ 成功提取 {len(video_codes)} 个视频编号")
        for i, code in enumerate(video_codes[:10], 1):  # 显示前10个
            print(f"   {i}. {code}")
        if len(video_codes) > 10:
            print(f"   ... 还有 {len(video_codes) - 10} 个")
        print("-" * 60)
        
        # 定义单次下载函数
        def single_download(keyword: str):
            """执行单次下载流程"""
            print(f"🔍 开始下载: {keyword}")
            with sync_playwright() as playwright:
                # 临时修改全局关键词
                global SEARCH_KEYWORD
                original_keyword = SEARCH_KEYWORD
                SEARCH_KEYWORD = keyword
                try:
                    run(playwright)
                finally:
                    # 恢复原始关键词
                    SEARCH_KEYWORD = original_keyword
        
        # 创建批量下载器
        downloader = create_batch_downloader(single_download, delay=delay)
        
        # 执行批量下载
        stats = downloader.download_from_codes(video_codes, max_downloads=max_downloads)
        
        print("=" * 60)
        print("📊 批量下载完成统计:")
        print(f"   ✅ 成功: {stats['success']}")
        print(f"   ❌ 失败: {stats['failed']}")
        print(f"   ⏭️ 跳过: {stats['skipped']}")
        print(f"   📈 总计: {stats['total']}")
        print("=" * 60)
        
        return stats
        
    except ImportError as e:
        print(f"❌ 导入批量下载模块失败: {e}")
        print("请确保 csv_utils.py 和 batch_downloader.py 文件存在")
        return {"success": False, "message": f"模块导入失败: {e}"}
    except Exception as e:
        print(f"❌ 批量下载过程中发生错误: {e}")
        return {"success": False, "message": f"下载失败: {e}"}


def batch_download_from_codes(video_codes, max_downloads=None, delay=2.0):
    """
    从视频编号列表批量下载字幕
    
    Args:
        video_codes: 视频编号列表
        max_downloads: 最大下载数量限制
        delay: 下载间隔时间（秒）
    
    Returns:
        dict: 下载统计结果
    """
    try:
        # 导入批量下载模块
        from batch_downloader import create_batch_downloader
        
        print(f"🚀 开始批量下载任务")
        print(f"📊 视频编号数量: {len(video_codes)}")
        print(f"📊 最大下载数: {max_downloads or '无限制'}")
        print(f"⏱️ 下载间隔: {delay}秒")
        print("-" * 60)
        
        # 显示编号列表
        for i, code in enumerate(video_codes[:10], 1):  # 显示前10个
            print(f"   {i}. {code}")
        if len(video_codes) > 10:
            print(f"   ... 还有 {len(video_codes) - 10} 个")
        print("-" * 60)
        
        # 定义单次下载函数
        def single_download(keyword: str):
            """执行单次下载流程"""
            print(f"🔍 开始下载: {keyword}")
            with sync_playwright() as playwright:
                # 临时修改全局关键词
                global SEARCH_KEYWORD
                original_keyword = SEARCH_KEYWORD
                SEARCH_KEYWORD = keyword
                try:
                    run(playwright)
                finally:
                    # 恢复原始关键词
                    SEARCH_KEYWORD = original_keyword
        
        # 创建批量下载器
        downloader = create_batch_downloader(single_download, delay=delay)
        
        # 执行批量下载
        stats = downloader.download_from_codes(video_codes, max_downloads=max_downloads)
        
        print("=" * 60)
        print("📊 批量下载完成统计:")
        print(f"   ✅ 成功: {stats['success']}")
        print(f"   ❌ 失败: {stats['failed']}")
        print(f"   ⏭️ 跳过: {stats['skipped']}")
        print(f"   📈 总计: {stats['total']}")
        print("=" * 60)
        
        return stats
        
    except ImportError as e:
        print(f"❌ 导入批量下载模块失败: {e}")
        print("请确保 batch_downloader.py 文件存在")
        return {"success": False, "message": f"模块导入失败: {e}"}
    except Exception as e:
        print(f"❌ 批量下载过程中发生错误: {e}")
        return {"success": False, "message": f"下载失败: {e}"}


if __name__ == "__main__":
    # 检查是否为批量下载模式
    if len(sys.argv) > 1:
        if sys.argv[1] == "batch-csv" and len(sys.argv) >= 3:
            # 批量下载模式：从CSV文件
            csv_file = sys.argv[2]
            video_type = sys.argv[3] if len(sys.argv) > 3 else None
            max_downloads = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else None
            delay = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
            
            batch_download_from_csv(csv_file, video_type, max_downloads, delay)
        elif sys.argv[1] == "batch-codes" and len(sys.argv) >= 3:
            # 批量下载模式：从编号列表
            codes = sys.argv[2].split(',')
            max_downloads = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else None
            delay = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
            
            batch_download_from_codes(codes, max_downloads, delay)
        else:
            print("用法:")
            print("  单次下载: python download-subtitle.py")
            print("  CSV批量下载: python download-subtitle.py batch-csv <csv文件路径> [视频类型] [最大下载数] [间隔秒数]")
            print("  编号批量下载: python download-subtitle.py batch-codes <编号1,编号2,编号3> [最大下载数] [间隔秒数]")
            print("")
            print("示例:")
            print("  python download-subtitle.py batch-csv videos.csv 无码 10 3.0")
            print("  python download-subtitle.py batch-codes SSIS-001,SSIS-002,SSIS-003 5 2.0")
    else:
        # 单次下载模式
        with sync_playwright() as playwright:
            run(playwright)