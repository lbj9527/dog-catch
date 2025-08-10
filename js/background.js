/**
 * Dog-Catch Background Service Worker
 * 基于 cat-catch 的成熟架构移植
 */

// Service Worker 心跳保活机制
// 防止 Service Worker 被强制终止
chrome.webNavigation.onBeforeNavigate.addListener(function () { return; });
chrome.webNavigation.onHistoryStateUpdated.addListener(function () { return; });
chrome.runtime.onConnect.addListener(function (Port) {
    if (chrome.runtime.lastError || Port.name !== "HeartBeat") return;
    Port.postMessage("HeartBeat");
    Port.onMessage.addListener(function (message, Port) { return; });
    const interval = setInterval(function () {
        clearInterval(interval);
        Port.disconnect();
    }, 250000); // 250秒定时器
    Port.onDisconnect.addListener(function () {
        interval && clearInterval(interval);
    });
});

// 全局变量初始化
var G = {};
G.initSyncComplete = false;
G.initLocalComplete = false;
G.enable = true;
G.tabId = -1;

// 缓存数据
var cacheData = { init: true };
G.blackList = new Set();        // 正则屏蔽资源列表
G.blockUrlSet = new Set();      // 屏蔽网址列表
G.requestHeaders = new Map();   // 临时储存请求头
G.urlMap = new Map();          // url查重map

// 防抖机制
let debounce = undefined;
let debounceCount = 0;
let debounceTime = 0;

// 初始化当前tabId
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].id) {
        G.tabId = tabs[0].id;
    } else {
        G.tabId = -1;
    }
});

// 定时任务处理
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === "save") {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        return;
    }
});

// webRequest 监听体系 - onSendHeaders
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        try {
            // 存储请求头到 G.requestHeaders Map
            G.requestHeaders.set(data.requestId, data.requestHeaders);
            // TODO: 进行正则匹配检测
        } catch (e) { 
            console.log(e, data); 
        }
    }, 
    { urls: ["<all_urls>"] }, 
    ["requestHeaders"]
);

// webRequest 监听体系 - onResponseStarted
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            // 关联请求头数据
            data.allRequestHeaders = G.requestHeaders.get(data.requestId);
            if (data.allRequestHeaders) {
                G.requestHeaders.delete(data.requestId);
            }
            // TODO: 进行完整的资源类型判断
            findMedia(data);
        } catch (e) { 
            console.log(e, data); 
        }
    }, 
    { urls: ["<all_urls>"] }, 
    ["responseHeaders"]
);

// webRequest 监听体系 - onErrorOccurred
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        // 清理失败请求的缓存数据，防止内存泄漏
        G.requestHeaders.delete(data.requestId);
        G.blackList.delete(data.requestId);
    }, 
    { urls: ["<all_urls>"] }
);

// 媒体资源检测函数（基础框架）
function findMedia(data, isRegex = false, filter = false, timer = false) {
    if (timer) { return; }
    
    // Service Worker重启后等待全局变量初始化完成
    if (!G || !G.initSyncComplete || !G.initLocalComplete || G.tabId == undefined || cacheData.init) {
        setTimeout(() => {
            findMedia(data, isRegex, filter, true);
        }, 233); // 233ms 延迟重试机制
        return;
    }
    
    // 检查是否启用
    if (!G.enable) {
        return;
    }
    
    // TODO: 实现完整的媒体资源检测逻辑
    console.log('Media detection placeholder:', data.url);
}

// 特殊页面过滤
function isSpecialPage(url) {
    if (!url || url == "null") { return true; }
    return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:"));
}

// 图标更新函数
function SetIcon(obj) {
    if (obj?.number == 0 || obj?.number == undefined) {
        chrome.action.setBadgeText({ 
            text: "", 
            tabId: obj?.tabId ?? G.tabId 
        }, function () { 
            if (chrome.runtime.lastError) { return; } 
        });
    } else {
        obj.number = obj.number > 999 ? "999+" : obj.number.toString();
        chrome.action.setBadgeText({ 
            text: obj.number, 
            tabId: obj.tabId 
        }, function () { 
            if (chrome.runtime.lastError) { return; } 
        });
    }
}

// 监听标签切换
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({ number: cacheData[G.tabId].length, tabId: G.tabId });
        return;
    }
    SetIcon({ tabId: G.tabId });
});

// 监听标签页面更新
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (isSpecialPage(tab.url) || tabId <= 0 || !G.initSyncComplete) { return; }
    
    // TODO: 实现自动清理逻辑
});

// 消息监听
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }
    
    // 获取所有数据
    if (message.action === "getAllData") {
        sendResponse(cacheData);
        return true;
    }
    
    // 清除图标
    if (message.action === "clearIcon") {
        SetIcon({ tabId: message.tabId });
        sendResponse("ok");
        return true;
    }
    
    return true;
});

// 初始化配置
function InitOptions() {
    // 初始化存储数据
    (chrome.storage.session ?? chrome.storage.local).get({ MediaData: {} }, function (items) {
        if (items.MediaData.init) {
            cacheData = {};
            return;
        }
        cacheData = items.MediaData;
    });
    
    // 设置初始化完成标志
    G.initSyncComplete = true;
    G.initLocalComplete = true;
}

// 启动初始化
InitOptions();

console.log('Dog-Catch Background Service Worker initialized');
