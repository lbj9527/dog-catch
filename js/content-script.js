// Dog-Catch Content Script
// 基于 cat-catch 的成熟架构，严格移植消息通信机制

// 心跳保活连接 - 防止 Service Worker 被终止
const port = chrome.runtime.connect({ name: "HeartBeat" });
port.onMessage.addListener(function (message) {
    // 心跳响应
});

// 监听来自页面的消息 - 深度搜索脚本通信
window.addEventListener("message", (event) => {
    if (!event.data || !event.data.action) { return; }
    
    // 处理深度搜索发现的媒体资源 - 保持与 cat-catch 一致的消息格式
    if (event.data.action == "catCatchAddMedia") {
        if (!event.data.url) { return; }
        chrome.runtime.sendMessage({
            Message: "addMedia",
            url: event.data.url,
            href: event.data.href ?? event.source.location.href,
            extraExt: event.data.ext,
            mime: event.data.mime,
            requestHeaders: { referer: event.data.referer },
            requestId: event.data.requestId
        });
    }
    
    // 处理深度搜索发现的加密密钥 - 保持与 cat-catch 一致的消息格式
    if (event.data.action == "catCatchAddKey") {
        if (!event.data.key) { return; }
        chrome.runtime.sendMessage({
            Message: "addKey",
            key: event.data.key,
            href: event.data.href ?? event.source.location.href,
            ext: event.data.ext
        });
    }
});

// 监听来自后台脚本的消息
chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    // 脚本注入请求处理
    if (Message.Message == "injectScript") {
        try {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(Message.scriptPath);
            script.onload = function() {
                this.remove();
                sendResponse("ok");
            };
            script.onerror = function() {
                this.remove();
                sendResponse("error");
            };
            (document.head || document.documentElement).appendChild(script);
        } catch (error) {
            sendResponse("error");
        }
        return true;
    }
    
    // 获取页面信息
    if (Message.Message == "getPageInfo") {
        sendResponse({
            title: document.title,
            url: window.location.href,
            favicon: getFavicon()
        });
        return true;
    }
    
    return false;
});

// 获取页面图标
function getFavicon() {
    const favicon = document.querySelector('link[rel="icon"]') || 
                   document.querySelector('link[rel="shortcut icon"]') ||
                   document.querySelector('link[rel="apple-touch-icon"]');
    return favicon ? favicon.href : null;
}

// 页面加载完成后的初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function initialize() {
    // 通知后台脚本页面已准备就绪
    chrome.runtime.sendMessage({
        Message: "pageReady",
        url: window.location.href,
        title: document.title
    });
}

console.log("Dog-Catch Content Script loaded");
