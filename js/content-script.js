/**
 * Dog-Catch Content Script
 * 页面内容操作和资源注入
 */

// 避免重复注入
if (typeof window.dogCatchContentScriptLoaded === 'undefined') {
    window.dogCatchContentScriptLoaded = true;

    // 心跳保活连接
    const port = chrome.runtime.connect({ name: "HeartBeat" });
    port.onMessage.addListener(function (message) {
        // 心跳响应
    });

    // 监听来自页面的消息
    window.addEventListener("message", function (event) {
        // 只接受来自同一窗口的消息
        if (event.source !== window) return;

        // 处理深度搜索发现的资源
        if (event.data.action === "dogCatchAddMedia") {
            chrome.runtime.sendMessage({
                action: "addMedia",
                data: event.data
            });
        }

        // 处理深度搜索发现的密钥
        if (event.data.action === "dogCatchAddKey") {
            chrome.runtime.sendMessage({
                action: "addKey",
                data: event.data
            });
        }
    });

    // 注入深度搜索脚本的函数
    function injectSearchScript() {
        // 检查是否已经注入
        if (document.querySelector('#dog-catch-search-script')) {
            return;
        }

        // 创建脚本元素
        const script = document.createElement('script');
        script.id = 'dog-catch-search-script';
        script.src = chrome.runtime.getURL('js/search.js');
        script.onload = function() {
            this.remove();
        };
        
        // 注入到页面
        (document.head || document.documentElement).appendChild(script);
    }

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (message.action === "injectSearchScript") {
            injectSearchScript();
            sendResponse("ok");
        }
        
        if (message.action === "getPageInfo") {
            sendResponse({
                title: document.title,
                url: window.location.href
            });
        }
        
        return true;
    });

    console.log('Dog-Catch Content Script loaded');
}
