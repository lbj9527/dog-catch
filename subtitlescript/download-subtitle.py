import re
import json
import os
from playwright.sync_api import Playwright, sync_playwright, expect
from playwright_stealth.stealth import Stealth


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


def perform_login(page):
    """执行密码登录流程"""
    print("开始密码登录...")
    page.locator("#ls_username").click()
    page.locator("#ls_username").fill("萨芬不否")
    page.get_by_role("textbox", name="密码").click()
    page.get_by_role("textbox", name="密码").fill("Lbj95278.xyz")
    page.get_by_role("button", name="登录").click()
    
    # 等待登录后的页面加载，并检查是否需要安全验证
    try:
        # 等待安全问题选择框出现
        page.wait_for_selector("#loginquestionid_LsN0t", timeout=10000)
        page.locator("#loginquestionid_LsN0t").select_option("1")
        
        # 等待答案输入框出现
        page.wait_for_selector("#loginanswer_LsN0t", timeout=5000)
        page.locator("#loginanswer_LsN0t").click()
        page.locator("#loginanswer_LsN0t").fill("HRY")
        page.locator("button[name=\"loginsubmit\"]").click()
    except Exception as e:
        print(f"安全验证步骤可能不需要或页面结构已变化: {e}")
        # 如果没有安全验证，继续执行后续步骤


def run(playwright: Playwright) -> None:
    # 启动浏览器 - 使用真实Chrome浏览器而非Chromium
    try:
        # 尝试使用系统安装的Chrome浏览器
        browser = playwright.chromium.launch(
            headless=False,
            channel="chrome",  # 使用真实Chrome浏览器
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
    
    if session_state:
        print("发现已保存的session，尝试使用cookie登录...")
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
    else:
        print("未发现session文件，将使用密码登录...")
        context = browser.new_context(
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
    stealth = Stealth()
    stealth.apply_stealth_sync(page)
    
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
    
    # 检查是否已经登录
    if not check_login_status(page):
        print("Cookie登录失败或未登录，开始密码登录...")
        perform_login(page)
        
        # 等待登录完成
        page.wait_for_load_state("networkidle")
        
        # 再次检查登录状态
        if not check_login_status(page):
            print("登录失败，请检查用户名密码")
            browser.close()
            return
        else:
            print("密码登录成功")
            # 保存新的session状态
            try:
                context.storage_state(path="./session.json")
                print("已保存新的session状态")
            except Exception as e:
                print(f"保存session失败: {e}")
    else:
        print("Cookie登录成功")
    
    # 等待页面加载完成后再进行后续操作
    page.wait_for_load_state("networkidle")
    page.close()

    # ---------------------
    context.storage_state(path="./session.json")
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
