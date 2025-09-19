import re
import json
import os
import time
from playwright.sync_api import Playwright, sync_playwright, expect
from playwright_stealth.stealth import stealth_sync
from urllib.parse import urljoin, urlparse, quote_plus

# 全局搜索关键字配置：直接修改此处值即可
SEARCH_KEYWORD = "nima-027"


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


# 已移除密码登录流程，脚本仅支持通过 ./session.json 的 Cookie 登录

# 解析搜索结果列表，提取 标题、链接、发布时间、用户名、所属专区，并打印
def scrape_search_results(root, max_items=20):
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

        def first_text(loc):
            try:
                if loc.count() > 0:
                    return loc.first.inner_text().strip()
            except Exception:
                pass
            return ""

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
        }
    )
    
    page = context.new_page()
    
    # 应用stealth模式隐藏自动化特征
    stealth_sync(page)
    
    # 拦截网络请求，阻止404资源影响页面加载状态
    def handle_route(route):
        request = route.request
        # 如果是图片、字体、CSS等静态资源，直接放行但不影响页面加载状态
        if any(resource_type in request.url.lower() for resource_type in ['.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.woff', '.woff2', '.ttf']):
            # 对于可能404的静态资源，使用continue但不等待响应
            route.continue_()
        else:
            # 对于其他请求正常处理
            route.continue_()
    
    # 注册路由拦截器
    page.route("**/*", handle_route)
    
    # 拦截并处理所有HTTP错误响应，进行详细分析
    def handle_response(response):
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
    
    # 处理请求失败的情况
    def handle_request_failed(request):
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
                    perform_search(page, SEARCH_KEYWORD)
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
            perform_search(page, SEARCH_KEYWORD)
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


with sync_playwright() as playwright:
    run(playwright)
