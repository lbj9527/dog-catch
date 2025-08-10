// Dog-Catch Service Worker
// 基于 cat-catch 的成熟架构，严格移植核心功能

// 导入初始化模块、工具函数和数据管理器
importScripts('js/init.js');
importScripts('js/utils.js');
importScripts('js/data-manager.js');

// ==================== Service Worker 生命周期管理 ====================
// 严格移植 cat-catch 的心跳保活机制

// Service Worker 5分钟后会强制终止扩展
// https://bugs.chromium.org/p/chromium/issues/detail?id=1271154
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/70003493#70003493
chrome.webNavigation.onBeforeNavigate.addListener(function () { return; });
chrome.webNavigation.onHistoryStateUpdated.addListener(function () { return; });

// 心跳保活机制 - 防止 Service Worker 被强制终止
chrome.runtime.onConnect.addListener(function (port) {
    if (port.name === "HeartBeat") {
        port.onDisconnect.addListener(function () {
            // Content Script 断开连接时的处理
        });
        port.onMessage.addListener(function (message) {
            // 心跳消息处理
            port.postMessage({ type: "HeartBeat", status: "OK" });
        });
    }
});

// 定时器保活 - 每30秒检查一次状态
setInterval(() => {
    // 保持 Service Worker 活跃
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].id) {
            G.tabId = tabs[0].id;
        }
    });
}, 30000);

// 注意：全局变量和初始化逻辑已在 init.js 中定义

// 初始化数据管理器 - 严格按照 cat-catch 的数据管理机制
const dataManager = new DataManager();

// 从存储中恢复数据
dataManager.restoreFromStorage();

// 设置扩展图标数字 - 严格移植 cat-catch 的实时更新机制
function SetIcon(options = {}) {
    const { tabId, number } = options;
    let count = 0;

    if (tabId && number !== undefined) {
        count = number;
    } else {
        const allData = dataManager.getAllData();
        if (tabId && allData[tabId]) {
            count = allData[tabId].length;
        } else {
            // 计算所有标签的资源总数
            for (let key in allData) {
                if (Array.isArray(allData[key])) {
                    count += allData[key].length;
                }
            }
        }
    }

    const text = count > 999 ? "999+" : count.toString();
    const options_icon = tabId ? { tabId: tabId, text: text } : { text: text };

    chrome.action.setBadgeText(options_icon);
    chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
}

// 核心数据处理函数 - 严格移植 cat-catch 的完整 findMedia 逻辑
function findMedia(data, isRegex = false, filter = false, timer = false) {
    if (timer) { return; }

    // Service Worker被强行杀死之后重新自我唤醒，等待全局变量初始化完成
    if (!G || !G.initSyncComplete || !G.initLocalComplete || G.tabId == undefined || cacheData.init) {
        setTimeout(() => {
            findMedia(data, isRegex, filter, true);
        }, 233);
        return;
    }

    // 检查是否启用扩展和屏蔽列表 - 严格移植 cat-catch 的检查逻辑
    const blockUrlFlag = data.tabId && data.tabId > 0 && G.blockUrlSet.has(data.tabId);
    if (!G.enable || (G.blockUrlWhite ? !blockUrlFlag : blockUrlFlag)) {
        return;
    }

    data.getTime = Date.now();

    // 检查黑名单 - 严格移植 cat-catch 的黑名单机制
    if (!isRegex && G.blackList.has(data.requestId)) {
        G.blackList.delete(data.requestId);
        return;
    }

    // 屏蔽特殊页面发起的资源
    if (data.initiator != "null" &&
        data.initiator != undefined &&
        isSpecialPage(data.initiator)) { return; }
    if (G.isFirefox &&
        data.originUrl &&
        isSpecialPage(data.originUrl)) { return; }
    // 屏蔽特殊页面的资源
    if (isSpecialPage(data.url)) { return; }

    const urlParsing = new URL(data.url);
    let [name, ext] = fileNameParse(urlParsing.pathname);

    // 严格移植 cat-catch 的正则匹配处理逻辑
    if (isRegex) {
        // 正则匹配检测 - 严格移植 cat-catch 的正则匹配逻辑
        filter = false;

        for (let [key, regexConfig] of G.Regex) {
            if (!regexConfig.state) { continue; }

            if (regexConfig.regex.test(data.url)) {
                filter = true;
                data.extraExt = key === "media" ? ext : key;
                break;
            }
        }

        if (!filter) { return; }

        // 正则匹配成功，构建资源信息
        const resourceData = {
            url: data.url,
            name: name || getUrlFileName(data.url),
            ext: data.extraExt || ext,
            size: 0, // 正则匹配阶段无法获取大小
            type: data.extraExt === "m3u8" ? "application/vnd.apple.mpegurl" :
                  data.extraExt === "mpd" ? "application/dash+xml" : "",
            tabId: data.tabId == -1 ? G.tabId : data.tabId,
            requestId: data.requestId || Date.now().toString(),
            getTime: data.getTime,
            initiator: data.initiator,
            isRegex: true,
            extraExt: data.extraExt
        };

        // 获取请求头信息
        const requestHeaders = getRequestHeaders(data);
        if (requestHeaders) {
            resourceData.requestHeaders = requestHeaders;
            resourceData.referer = requestHeaders.referer;
            resourceData.origin = requestHeaders.origin;
        }

        // 使用数据管理器添加媒体资源
        dataManager.addMedia(resourceData, true);
        return;
    }

    // 非正则匹配的完整资源检测逻辑 - 严格移植 cat-catch 的实现
    filter = false; // 重置过滤标志

    // 获取头部信息
    data.header = getResponseHeadersValue(data);

    // 检查后缀
    if (!filter && ext != undefined) {
        filter = CheckExtension(ext, data.header?.size);
        if (filter == "break") { return; }
    }

    // 检查类型
    if (!filter && data.header?.type != undefined) {
        filter = CheckType(data.header.type, data.header?.size);
        if (filter == "break") { return; }
    }

    // 查找附件 - Content-Disposition 头处理
    if (!filter && data.header?.attachment != undefined) {
        const reFilename = /filename="?([^"]+)"?/;
        const res = data.header.attachment.match(reFilename);
        if (res && res[1]) {
            [name, ext] = fileNameParse(decodeURIComponent(res[1]));
            filter = CheckExtension(ext, 0);
            if (filter == "break") { return; }
        }
    }

    // 放过类型为media的资源
    if (data.type == "media") {
        filter = true;
    }

    if (!filter) { return; }

    // 严格移植 cat-catch 的资源信息构建逻辑
    chrome.tabs.get(data.tabId, async function (webInfo) {
        if (chrome.runtime.lastError) { return; }

        data.requestHeaders = getRequestHeaders(data);
        // requestHeaders 中cookie 单独列出来
        if (data.requestHeaders?.cookie) {
            data.cookie = data.requestHeaders.cookie;
            data.requestHeaders.cookie = undefined;
        }

        const info = {
            name: name,
            url: data.url,
            size: data.header?.size,
            ext: ext,
            type: data.mime ?? data.header?.type,
            tabId: data.tabId,
            isRegex: isRegex,
            requestId: data.requestId ?? Date.now().toString(),
            initiator: data.initiator,
            requestHeaders: data.requestHeaders,
            cookie: data.cookie,
            getTime: data.getTime
        };

        // 不存在扩展使用类型
        if (info.ext === undefined && info.type !== undefined) {
            info.ext = info.type.split("/")[1];
        }
        // 正则匹配的备注扩展
        if (data.extraExt) {
            info.ext = data.extraExt;
        }
        // 不存在 initiator 和 referer 使用web url代替initiator
        if (info.initiator == undefined || info.initiator == "null") {
            info.initiator = info.requestHeaders?.referer ?? webInfo?.url;
        }
        // 装载页面信息
        info.title = webInfo?.title ?? "NULL";
        info.favIconUrl = webInfo?.favIconUrl;
        info.webUrl = webInfo?.url;

        // 屏蔽资源 - 再次检查黑名单
        if (!isRegex && G.blackList.has(data.requestId)) {
            G.blackList.delete(data.requestId);
            return;
        }

        // 使用数据管理器添加媒体资源
        dataManager.addMedia(info, isRegex);
    });
}

// 脚本注入函数 - 严格移植 cat-catch 的脚本注入机制
async function injectSearchScript(tabId) {
    try {
        // 检查 Chrome 版本是否支持 scripting API
        if (G.version < 102) {
            console.log("Chrome version < 102, scripting API not supported");
            return;
        }

        // 注入深度搜索脚本到页面主世界
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['search-script/search.js'],
            world: 'MAIN'
        });

        console.log(`Search script injected into tab ${tabId}`);

        // 记录已注入的标签页
        if (!G.scriptList) {
            G.scriptList = new Map();
        }
        if (!G.scriptList.has("search.js")) {
            G.scriptList.set("search.js", { tabId: new Set() });
        }
        G.scriptList.get("search.js").tabId.add(tabId);

    } catch (error) {
        console.error("Failed to inject search script:", error);
    }
}

// 清理冗余数据函数 - 使用数据管理器
function clearRedundant() {
    dataManager.clearRedundant();

    // 清理脚本列表
    if (G.scriptList) {
        chrome.tabs.query({}, function (tabs) {
            const allTabId = new Set(tabs.map(tab => tab.id));
            G.scriptList.forEach(function (scriptList) {
                scriptList.tabId.forEach(function (tabId) {
                    if (!allTabId.has(tabId)) {
                        scriptList.tabId.delete(tabId);
                    }
                });
            });
        });
    }
}

// 消息通信机制 - 严格移植 cat-catch 的消息处理逻辑
chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }
    if (!G.initLocalComplete || !G.initSyncComplete) {
        sendResponse("error");
        return true;
    }

    // 默认使用当前标签
    Message.tabId = Message.tabId ?? G.tabId;

    // 从缓存中保存数据到本地
    if (Message.Message == "pushData") {
        dataManager.saveToStorage();
        sendResponse("ok");
        return true;
    }

    // 获取所有数据
    if (Message.Message == "getAllData") {
        sendResponse(dataManager.getAllData());
        return true;
    }

    // 设置扩展图标数字
    if (Message.Message == "ClearIcon") {
        Message.type ? SetIcon({ tabId: Message.tabId }) : SetIcon();
        sendResponse("ok");
        return true;
    }

    // 启用/禁用扩展
    if (Message.Message == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({ enable: G.enable });
        chrome.action.setIcon({ path: G.enable ? "/img/icon.png" : "/img/icon-disable.png" });
        sendResponse(G.enable);
        return true;
    }

    // 获取指定的数据
    if (Message.Message == "getData" && Message.requestId) {
        if (!Array.isArray(Message.requestId)) {
            Message.requestId = [Message.requestId];
        }
        const response = [];
        const allData = dataManager.getAllData();
        if (Message.requestId.length) {
            for (let item in allData) {
                for (let data of allData[item]) {
                    if (Message.requestId.includes(data.requestId)) {
                        response.push(data);
                    }
                }
            }
        }
        sendResponse(response.length ? response : "error");
        return true;
    }

    // 清理数据
    if (Message.Message == "clearData") {
        // 当前标签
        if (Message.type) {
            dataManager.clearTabData(Message.tabId);
            clearRedundant();
            sendResponse("OK");
            return true;
        }
        // 其他标签
        dataManager.clearOtherTabsData(Message.tabId);
        clearRedundant();
        sendResponse("OK");
        return true;
    }

    // 清理冗余数据
    if (Message.Message == "clearRedundant") {
        clearRedundant();
        sendResponse("OK");
        return true;
    }

    // 手动注入深度搜索脚本
    if (Message.Message == "script") {
        if (Message.script == "search.js") {
            injectSearchScript(Message.tabId);
            sendResponse("ok");
            return true;
        }
        sendResponse("error");
        return true;
    }

    // 触发深度搜索
    if (Message.Message == "triggerDeepSearch") {
        injectSearchScript(Message.tabId);
        sendResponse("ok");
        return true;
    }

    // 浮动界面控制
    if (Message.Message == "toggleFloatingUI") {
        chrome.tabs.sendMessage(Message.tabId, { action: "toggleFloatingUI" }, function(response) {
            sendResponse(response || { success: false });
        });
        return true;
    }

    if (Message.Message == "showFloatingUI") {
        chrome.tabs.sendMessage(Message.tabId, { action: "showFloatingUI" }, function(response) {
            sendResponse(response || { success: false });
        });
        return true;
    }

    if (Message.Message == "hideFloatingUI") {
        chrome.tabs.sendMessage(Message.tabId, { action: "hideFloatingUI" }, function(response) {
            sendResponse(response || { success: false });
        });
        return true;
    }

    // 从 content-script 或 search-script 传来的媒体url
    if (Message.Message == "addMedia") {
        chrome.tabs.query({}, function (tabs) {
            for (let item of tabs) {
                if (item.url == Message.href) {
                    findMedia({
                        url: Message.url,
                        tabId: item.id,
                        extraExt: Message.extraExt,
                        mime: Message.mime,
                        requestId: Message.requestId,
                        requestHeaders: Message.requestHeaders,
                        type: "media" // 标记为深度搜索发现的媒体
                    }, true, true);
                    return true;
                }
            }
            findMedia({
                url: Message.url,
                tabId: -1,
                extraExt: Message.extraExt,
                mime: Message.mime,
                requestId: Message.requestId,
                initiator: Message.href,
                requestHeaders: Message.requestHeaders,
                type: "media" // 标记为深度搜索发现的媒体
            }, true, true);
        });
        sendResponse("ok");
        return true;
    }

    // 从深度搜索脚本传来的加密密钥
    if (Message.Message == "addKey") {
        // 将密钥信息存储到专门的密钥缓存中
        // 这里暂时只记录日志，完整的密钥管理将在后续版本实现
        console.log("Encryption key detected:", {
            key: Message.key,
            ext: Message.ext,
            href: Message.href
        });
        sendResponse("ok");
        return true;
    }

    // Heart Beat - 心跳保活
    if (Message.Message == "HeartBeat") {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs[0] && tabs[0].id) {
                G.tabId = tabs[0].id;
            }
        });
        sendResponse("HeartBeat OK");
        return true;
    }

    return false;
});

// 监听标签页面更新 - 严格移植 cat-catch 的标签页管理
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (isSpecialPage(tab.url) || tabId <= 0 || !G.initSyncComplete) { return; }

    if (changeInfo.status && changeInfo.status == "loading" && G.autoClearMode == 2) {
        chrome.alarms.get("save", function (alarm) {
            if (!alarm) {
                dataManager.clearTabData(tabId);
                chrome.alarms.create("save", { when: Date.now() + 1000 });
            }
        });
    }
});

// 监听 frame 正在载入 - 严格移植 cat-catch 的导航监听
chrome.webNavigation.onCommitted.addListener(function (details) {
    if (isSpecialPage(details.url) || details.tabId <= 0 || !G.initSyncComplete) { return; }

    // 刷新清理角标数
    if (details.frameId == 0 && (!['auto_subframe', 'manual_subframe', 'form_submit'].includes(details.transitionType)) && G.autoClearMode == 1) {
        dataManager.clearTabData(details.tabId);
    }

    // chrome内核版本 102 以下不支持 chrome.scripting.executeScript API
    if (G.version < 102) { return; }

    // 深度搜索脚本注入 - 严格移植 cat-catch 的脚本注入机制
    if (G.deepSearch && G.deepSearchTemporarilyClose != details.tabId) {
        injectSearchScript(details.tabId);
        G.deepSearchTemporarilyClose = null;
    }
});

// 监听标签关闭 - 清理数据
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    chrome.alarms.get("nowClear", function (alarm) {
        !alarm && chrome.alarms.create("nowClear", { when: Date.now() + 1000 });
    });
});

// 清理冗余数据的定时任务
chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name == "save") {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
    }
    if (alarm.name == "nowClear") {
        clearRedundant();
    }
});

// ==================== webRequest 监听体系 ====================
// 严格移植 cat-catch 的 webRequest 监听器实现

// onSendHeaders - 保存请求头并进行正则匹配检测
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        if (G && G.initSyncComplete && !G.enable) { return; }
        if (data.requestHeaders) {
            G.requestHeaders.set(data.requestId, data.requestHeaders);
            data.allRequestHeaders = data.requestHeaders;
        }
        try {
            findMedia(data, true); // 正则匹配检测
        } catch (e) {
            console.log(e);
        }
    },
    { urls: ["<all_urls>"] },
    ['requestHeaders', chrome.webRequest.OnSendHeadersOptions?.EXTRA_HEADERS].filter(Boolean)
);

// onResponseStarted - 获取响应头，关联请求头数据，进行完整的资源类型判断
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            data.allRequestHeaders = G.requestHeaders.get(data.requestId);
            if (data.allRequestHeaders) {
                G.requestHeaders.delete(data.requestId);
            }
            findMedia(data); // 完整的资源检测
        } catch (e) {
            console.log(e, data);
        }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
);

// onErrorOccurred - 清理失败请求的缓存数据，防止内存泄漏
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        G.requestHeaders.delete(data.requestId);
        G.blackList.delete(data.requestId);
    },
    { urls: ["<all_urls>"] }
);

console.log("Dog-Catch Service Worker webRequest listeners initialized");
console.log("Dog-Catch Service Worker data layer initialized");
