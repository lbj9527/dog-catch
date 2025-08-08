/**
 * Dog-Catch 后台脚本 (Service Worker)
 * 处理扩展的后台逻辑和事件
 * 基于 cat-catch 核心技术移植
 */

// 全局变量 - 移植自 cat-catch
var G = {};
G.initSyncComplete = false;
G.initLocalComplete = false;
// 缓存数据
var cacheData = { init: true };
G.blackList = new Set();    // 正则屏蔽资源列表
G.blockUrlSet = new Set();    // 屏蔽网址列表
G.requestHeaders = new Map();   // 临时储存请求头
G.urlMap = new Map();   // url查重map
G.deepSearchTemporarilyClose = null; // 深度搜索临时变量

// 初始化当前tabId
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].id) {
        G.tabId = tabs[0].id;
    } else {
        G.tabId = -1;
    }
});

// 正则预编译 - 移植自 cat-catch
const reFilename = /filename="?([^"]+)"?/;

// 所有设置变量 默认值 - 移植自 cat-catch
G.OptionLists = {
    Ext: [
        { "ext": "flv", "size": 0, "state": true },
        { "ext": "hlv", "size": 0, "state": true },
        { "ext": "f4v", "size": 0, "state": true },
        { "ext": "mp4", "size": 0, "state": true },
        { "ext": "mp3", "size": 0, "state": true },
        { "ext": "wma", "size": 0, "state": true },
        { "ext": "wav", "size": 0, "state": true },
        { "ext": "m4a", "size": 0, "state": true },
        { "ext": "ts", "size": 0, "state": false },
        { "ext": "webm", "size": 0, "state": true },
        { "ext": "ogg", "size": 0, "state": true },
        { "ext": "ogv", "size": 0, "state": true },
        { "ext": "acc", "size": 0, "state": true },
        { "ext": "mov", "size": 0, "state": true },
        { "ext": "mkv", "size": 0, "state": true },
        { "ext": "m4s", "size": 0, "state": true },
        { "ext": "aac", "size": 0, "state": true },
        { "ext": "3gp", "size": 0, "state": true },
        { "ext": "avi", "size": 0, "state": true },
        { "ext": "wmv", "size": 0, "state": true },
        { "ext": "asf", "size": 0, "state": true },
        { "ext": "rm", "size": 0, "state": true },
        { "ext": "rmvb", "size": 0, "state": true },
        { "ext": "m3u8", "size": 0, "state": true },
        { "ext": "m3u", "size": 0, "state": true },
        { "ext": "mpd", "size": 0, "state": true }
    ],
    Type: [
        { "type": "video/*", "size": 0, "state": true },
        { "type": "audio/*", "size": 0, "state": true },
        { "type": "application/vnd.apple.mpegurl", "size": 0, "state": true },
        { "type": "application/x-mpegurl", "size": 0, "state": true },
        { "type": "application/dash+xml", "size": 0, "state": true },
        { "type": "application/octet-stream", "size": 0, "state": false }
    ],
    Regex: [],
    blockUrl: [],
    enable: true,
    checkDuplicates: true,
    maxLength: 9999,
    autoClearMode: 0,
    send2local: false,  // 发送到本地应用的开关
    blockUrlWhite: false  // 屏蔽网址白名单模式
};

// 本地储存的配置 - 移植自 cat-catch
G.LocalVar = {
    featMobileTabId: [],
    featAutoDownTabId: [],
    mediaControl: { tabid: 0, index: -1 },
    previewShowTitle: false,
    previewDeleteDuplicateFilenames: false,
};

// 脚本列表 - 移植自 cat-catch
G.scriptList = new Map();
// 注意：这里简化了脚本列表，实际的 cat-catch 有更多脚本
G.scriptList.set("search.js", {
    key: "search",
    refresh: true,
    allFrames: true,
    world: "MAIN",
    name: "深度搜索",
    off: "关闭搜索",
    i18n: false,
    tabId: new Set()
});

// FFmpeg 配置 - 移植自 cat-catch
G.ffmpegConfig = {
    tab: 0,
    cacheData: [],
    version: 1,
    url: "https://ffmpeg.bmmmd.com/"
};

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Dog-Catch 扩展已安装/更新:', details.reason);

  if (details.reason === 'install') {
    // 首次安装
    handleFirstInstall();
  } else if (details.reason === 'update') {
    // 更新
    handleUpdate(details.previousVersion);
  }
});

// 扩展启动时的初始化
chrome.runtime.onStartup.addListener(() => {
  console.log('Dog-Catch 扩展启动');
  initializeExtension();
});

// 网络监听器 - 移植自 cat-catch
// onBeforeSendHeaders 获取请求头
chrome.webRequest.onBeforeSendHeaders.addListener(
    function (data) {
        G.requestHeaders.set(data.requestId, data.requestHeaders);
    }, { urls: ["<all_urls>"] }, ["requestHeaders"]
);

// onResponseStarted 浏览器接收到第一个字节触发，保证有更多信息判断资源类型
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            data.allRequestHeaders = G.requestHeaders.get(data.requestId);
            if (data.allRequestHeaders) {
                G.requestHeaders.delete(data.requestId);
            }
            findMedia(data);
        } catch (e) { console.log(e, data); }
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]
);

// 删除失败的requestHeadersData
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        G.requestHeaders.delete(data.requestId);
        G.blackList.delete(data.requestId);
    }, { urls: ["<all_urls>"] }
);

// 核心资源检测函数 - 移植自 cat-catch
function findMedia(data, isRegex = false, filter = false, timer = false) {
    if (timer) { return; }
    // Service Worker被强行杀死之后重新自我唤醒，等待全局变量初始化完成。
    if (!G || !G.initSyncComplete || !G.initLocalComplete || G.tabId == undefined || cacheData.init) {
        setTimeout(() => {
            findMedia(data, isRegex, filter, true);
        }, 233);
        return;
    }
    // 检查 是否启用 是否在当前标签是否在屏蔽列表中
    const blockUrlFlag = data.tabId && data.tabId > 0 && G.blockUrlSet.has(data.tabId);
    if (!G.enable || (G.blockUrlWhite ? !blockUrlFlag : blockUrlFlag)) {
        return;
    }

    data.getTime = Date.now();

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

    //正则匹配
    if (isRegex && !filter) {
        for (let key in G.Regex) {
            if (!G.Regex[key].state) { continue; }
            G.Regex[key].regex.lastIndex = 0;
            let result = G.Regex[key].regex.exec(data.url);
            if (result == null) { continue; }
            if (G.Regex[key].blackList) {
                G.blackList.add(data.requestId);
                return;
            }
            data.extraExt = G.Regex[key].ext ? G.Regex[key].ext : undefined;
            if (result.length == 1) {
                findMedia(data, true, true);
                return;
            }
            result.shift();
            result = result.map(str => decodeURIComponent(str));
            if (!result[0].startsWith('https://') && !result[0].startsWith('http://')) {
                result[0] = urlParsing.protocol + "//" + urlParsing.host;
            }
            data.url = result.join("");
            findMedia(data, true, true);
            return;
        }
        return;
    }



    // 非正则匹配
    if (!isRegex) {
        // 获取头部信息
        data.header = getResponseHeadersValue(data);
        //检查后缀
        if (!filter && ext != undefined) {
            filter = CheckExtension(ext, data.header?.size);
            if (filter == "break") { return; }
        }
        //检查类型
        if (!filter && data.header?.type != undefined) {
            filter = CheckType(data.header.type, data.header?.size);
            if (filter == "break") { return; }
        }
        //查找附件
        if (!filter && data.header?.attachment != undefined) {
            const res = data.header.attachment.match(reFilename);
            if (res && res[1]) {
                [name, ext] = fileNameParse(decodeURIComponent(res[1]));
                filter = CheckExtension(ext, 0);
                if (filter == "break") { return; }
            }
        }
        //放过类型为media的资源
        if (data.type == "media") {
            filter = true;
        }
    }

    if (!filter) { return; }

    // 谜之原因 获取得资源 tabId可能为 -1 firefox中则正常
    // 检查是 -1 使用当前激活标签得tabID
    data.tabId = data.tabId == -1 ? G.tabId : data.tabId;

    cacheData[data.tabId] ??= [];
    cacheData[G.tabId] ??= [];

    // 缓存数据大于9999条 清空缓存 避免内存占用过多
    if (cacheData[data.tabId].length > G.maxLength) {
        cacheData[data.tabId] = [];
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        return;
    }

    // 查重 避免CPU占用 大于500 强制关闭查重
    if (G.checkDuplicates && cacheData[data.tabId].length <= 500) {
        const tabFingerprints = G.urlMap.get(data.tabId) || new Set();
        if (tabFingerprints.has(data.url)) {
            return; // 找到重复，直接返回
        }
        tabFingerprints.add(data.url);
        G.urlMap.set(data.tabId, tabFingerprints);
        if (tabFingerprints.size >= 500) {
            tabFingerprints.clear();
        }
    }

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
        // 屏蔽资源
        if (!isRegex && G.blackList.has(data.requestId)) {
            G.blackList.delete(data.requestId);
            return;
        }

        cacheData[data.tabId].unshift(info);
        save(data.tabId);
    });
}

// 辅助函数 - 移植自 cat-catch

/**
 * 保存数据到存储
 */
let debounce = undefined;
let debounceTime = 0;
let debounceCount = 0;

function save(tabId) {
    clearTimeout(debounce);
    debounceTime = Date.now();
    debounceCount = 0;
    (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData }, function () {
        chrome.runtime.lastError && console.log(chrome.runtime.lastError);
    });
    cacheData[tabId] && SetIcon({ number: cacheData[tabId].length, tabId: tabId });
}

/**
 * 设置扩展图标
 */
function SetIcon(options = {}) {
    const { number, tabId } = options;
    if (number && number > 0) {
        chrome.action.setBadgeText({ text: number.toString(), tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#FF0000", tabId: tabId });
    } else {
        chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
}

/**
 * 检查是否为特殊页面
 */
function isSpecialPage(url) {
    if (!url) return false;
    return url.startsWith("chrome://") ||
           url.startsWith("chrome-extension://") ||
           url.startsWith("moz-extension://") ||
           url.startsWith("edge://") ||
           url.startsWith("about:");
}

/**
 * 判断url是否在屏蔽网址中 - 移植自 cat-catch
 * @param {String} url
 * @returns {Boolean}
 */
function isLockUrl(url) {
    if (!G.blockUrl || !G.blockUrl.length) return false;
    for (let key in G.blockUrl) {
        if (!G.blockUrl[key].state) { continue; }
        G.blockUrl[key].url.lastIndex = 0;
        if (G.blockUrl[key].url.test(url)) {
            return true;
        }
    }
    return false;
}

/**
 * 发送数据到本地 - 移植自 cat-catch
 * @param {String} action
 * @param {*} data
 * @param {Number} tabId
 */
function send2local(action, data, tabId) {
    // 这里可以实现发送数据到本地应用的逻辑
    // 目前只是记录日志
    console.log('发送数据到本地:', action, data, tabId);
}

/**
 * 清理冗余数据 - 移植自 cat-catch
 */
function clearRedundant() {
    // 清理过期的缓存数据
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时

    for (let tabId in cacheData) {
        if (tabId === 'init') continue;

        if (cacheData[tabId] && Array.isArray(cacheData[tabId])) {
            cacheData[tabId] = cacheData[tabId].filter(item => {
                return item.getTime && (now - item.getTime) < maxAge;
            });

            // 如果数组为空，删除该标签的数据
            if (cacheData[tabId].length === 0) {
                delete cacheData[tabId];
            }
        }
    }

    // 保存清理后的数据
    (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
    console.log('清理冗余数据完成');
}

/**
 * 获取文件名及扩展名
 * @param {String} pathname
 * @returns {Array}
 */
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}

/**
 * 检查扩展名和大小
 * @param {String} ext
 * @param {Number} size
 * @returns {Boolean|String}
 */
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) { return false; }
    if (!Ext.state) { return "break"; }
    if (Ext.size != 0 && size != undefined && size <= Ext.size * 1024) { return "break"; }
    return true;
}

/**
 * 检查类型和大小
 * @param {String} dataType
 * @param {Number} dataSize
 * @returns {Boolean|String}
 */
function CheckType(dataType, dataSize) {
    const typeInfo = G.Type.get(dataType.split("/")[0] + "/*") || G.Type.get(dataType);
    if (!typeInfo) { return false; }
    if (!typeInfo.state) { return "break"; }
    if (typeInfo.size != 0 && dataSize != undefined && dataSize <= typeInfo.size * 1024) { return "break"; }
    return true;
}

/**
 * 获取响应头信息
 * @param {Object} data
 * @returns {Object}
 */
function getResponseHeadersValue(data) {
    const header = {};
    if (data.responseHeaders == undefined || data.responseHeaders.length == 0) { return header; }
    for (let item of data.responseHeaders) {
        item.name = item.name.toLowerCase();
        if (item.name == "content-length") {
            header.size ??= parseInt(item.value);
        } else if (item.name == "content-type") {
            header.type = item.value.split(";")[0].toLowerCase();
        } else if (item.name == "content-disposition") {
            header.attachment = item.value;
        } else if (item.name == "content-range") {
            let size = item.value.split('/')[1];
            if (size !== '*') {
                header.size = parseInt(size);
            }
        }
    }
    return header;
}

/**
 * 获取请求头
 * @param {Object} data
 * @returns {Object|Boolean}
 */
function getRequestHeaders(data) {
    if (data.allRequestHeaders == undefined || data.allRequestHeaders.length == 0) { return false; }
    const header = {};
    for (let item of data.allRequestHeaders) {
        item.name = item.name.toLowerCase();
        if (item.name == "referer") {
            header.referer = item.value;
        } else if (item.name == "origin") {
            header.origin = item.value;
        } else if (item.name == "cookie") {
            header.cookie = item.value;
        } else if (item.name == "authorization") {
            header.authorization = item.value;
        }
    }
    if (Object.keys(header).length) {
        return header;
    }
    return false;
}

// 标签页事件监听器 - 移植自 cat-catch

/**
 * 监听 切换标签
 * 更新全局变量 G.tabId 为当前标签
 */
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({ number: cacheData[G.tabId].length, tabId: G.tabId });
        return;
    }
    SetIcon({ tabId: G.tabId });
});

/**
 * 监听 标签关闭 清理数据
 */
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    chrome.alarms.get("nowClear", function (alarm) {
        !alarm && chrome.alarms.create("nowClear", { when: Date.now() + 1000 });
    });
    if (G.initSyncComplete) {
        G.blockUrlSet.has(tabId) && G.blockUrlSet.delete(tabId);
    }
});

/**
 * 监听 标签页面更新
 */
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (isSpecialPage(tab.url) || tabId <= 0 || !G.initSyncComplete) { return; }
    if (changeInfo.status && changeInfo.status == "loading" && G.autoClearMode == 2) {
        G.urlMap.delete(tabId);
        chrome.alarms.get("save", function (alarm) {
            if (!alarm) {
                delete cacheData[tabId];
                SetIcon({ tabId: tabId });
                chrome.alarms.create("save", { when: Date.now() + 1000 });
            }
        });
    }
    // 检查当前标签是否在屏蔽列表中 - 移植自 cat-catch
    if (changeInfo.url && tabId > 0 && G.blockUrl && G.blockUrl.length) {
        G.blockUrlSet.delete(tabId);
        if (isLockUrl(changeInfo.url)) {
            G.blockUrlSet.add(tabId);
        }
    }
});

// 启动时初始化
initializeGlobalVariables();

/**
 * 处理首次安装
 */
async function handleFirstInstall() {
  console.log('Dog-Catch 首次安装，初始化默认设置...');

  // 设置默认配置 - 包含 cat-catch 的配置
  const defaultSettings = {
    enabled: true,
    ballPosition: { x: '20px', y: '50%' },
    autoDetect: true,
    showNotifications: true,
    theme: 'auto'
  };

  try {
    // 保存 Dog-Catch 的设置
    await chrome.storage.local.set({
      'dog-catch-settings': defaultSettings,
      'dog-catch-resources': [],
      'dog-catch-ball-position': defaultSettings.ballPosition,
      'MediaData': {}
    });

    // 保存 cat-catch 的配置到 sync storage
    await chrome.storage.sync.set(G.OptionLists);

    console.log('默认设置已保存');

    // 初始化全局变量
    initializeGlobalVariables();
  } catch (error) {
    console.error('保存默认设置失败:', error);
  }
}

/**
 * 处理更新
 */
async function handleUpdate(previousVersion) {
  console.log(`Dog-Catch 从版本 ${previousVersion} 更新到当前版本`);
  
  // 这里可以处理版本迁移逻辑
  // 例如：数据格式变更、新功能介绍等
}

/**
 * 初始化全局变量 - 移植自 cat-catch
 */
function initializeGlobalVariables() {
    // 读取sync配置数据 交给全局变量G
    chrome.storage.sync.get(G.OptionLists, function (items) {
        if (chrome.runtime.lastError) {
            items = G.OptionLists;
        }
        // 确保有默认值
        for (let key in G.OptionLists) {
            if (items[key] === undefined || items[key] === null) {
                items[key] = G.OptionLists[key];
            }
        }
        // Ext的Array转为Map类型
        items.Ext = new Map(items.Ext.map(item => [item.ext, item]));
        // Type的Array转为Map类型
        items.Type = new Map(items.Type.map(item => [item.type, { size: item.size, state: item.state }]));
        // 预编译正则匹配
        items.Regex = items.Regex.map(item => {
            let reg = undefined;
            try { reg = new RegExp(item.regex, item.type) } catch (e) { item.state = false; }
            return { regex: reg, ext: item.ext, blackList: item.blackList, state: item.state }
        });

        G = { ...items, ...G };
        G.initSyncComplete = true;
        console.log('同步配置初始化完成');
    });

    // 读取本地数据
    (chrome.storage.session ?? chrome.storage.local).get({ MediaData: {}, ...G.LocalVar }, function (items) {
        if (items.MediaData.init) {
            cacheData = {};
        } else {
            cacheData = items.MediaData;
        }

        // 初始化本地变量 - 移植自 cat-catch
        items.featMobileTabId = new Set(items.featMobileTabId || []);
        items.featAutoDownTabId = new Set(items.featAutoDownTabId || []);
        G = { ...items, ...G };

        G.initLocalComplete = true;
        console.log('本地数据初始化完成');
    });
}

/**
 * 初始化扩展
 */
async function initializeExtension() {
  console.log('初始化 Dog-Catch 扩展...');

  // 检查设置
  try {
    const settings = await chrome.storage.local.get('dog-catch-settings');
    if (!settings['dog-catch-settings']) {
      await handleFirstInstall();
    } else {
      // 初始化全局变量
      initializeGlobalVariables();
    }
  } catch (error) {
    console.error('初始化扩展失败:', error);
  }
}

/**
 * 处理来自内容脚本的消息 - 支持 cat-catch 和 dog-catch 消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message, '来自:', sender.tab?.url);

  // 处理 cat-catch 风格的消息
  if (message.Message) {
    return handleCatCatchMessage(message, sender, sendResponse);
  }

  // 处理 dog-catch 风格的消息
  switch (message.type) {
    case 'GET_SETTINGS':
      handleGetSettings(sendResponse);
      return true; // 异步响应

    case 'UPDATE_SETTINGS':
      handleUpdateSettings(message.settings, sendResponse);
      return true;

    case 'DETECT_RESOURCES':
      handleDetectResources(sender.tab, sendResponse);
      return true;

    case 'RESOURCE_FOUND':
      handleResourceFound(message.resource, sender.tab);
      break;

    case 'TOGGLE_EXTENSION':
      handleToggleExtension(sender.tab, sendResponse);
      return true;

    case 'closeExtension':
      handleCloseExtension(sender.tab, sendResponse);
      return true;

    default:
      console.warn('未知消息类型:', message.type || message.action);
  }
});

/**
 * 处理 cat-catch 风格的消息
 */
function handleCatCatchMessage(Message, sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }
    if (!G.initLocalComplete || !G.initSyncComplete) {
        sendResponse("error");
        return true;
    }
    // 以下检查是否有 tabId 不存在使用当前标签
    Message.tabId = Message.tabId ?? G.tabId;

    // 获取所有数据
    if (Message.Message == "getAllData") {
        sendResponse(cacheData);
        return true;
    }

    // 提供 tabId 获取该标签数据
    if (Message.Message == "getData") {
        sendResponse(cacheData[Message.tabId]);
        return true;
    }

    // 启用/禁用扩展
    if (Message.Message == "enable") {
        G.enable = !G.enable;
        chrome.storage.sync.set({ enable: G.enable });
        chrome.action.setIcon({ path: G.enable ? "/icons/icon48.png" : "/icons/icon48.png" });
        sendResponse(G.enable);
        return true;
    }

    // 从 content-script 或 catch-script 传来的媒体url
    if (Message.Message == "addMedia") {
        chrome.tabs.query({}, function (tabs) {
            for (let item of tabs) {
                if (item.url == Message.href) {
                    findMedia({ url: Message.url, tabId: item.id, extraExt: Message.extraExt, mime: Message.mime, requestId: Message.requestId, requestHeaders: Message.requestHeaders }, true, true);
                    return true;
                }
            }
            findMedia({ url: Message.url, tabId: -1, extraExt: Message.extraExt, mime: Message.mime, requestId: Message.requestId, initiator: Message.href, requestHeaders: Message.requestHeaders }, true, true);
        });
        sendResponse("ok");
        return true;
    }

    // 发送数据到本地 - 移植自 cat-catch
    if (Message.Message == "send2local" && G.send2local) {
        try {
            send2local(Message.action, Message.data, Message.tabId);
        } catch (e) {
            console.log(e);
        }
        sendResponse("ok");
        return true;
    }

    // 弹窗添加密钥 - 移植自 cat-catch
    if (Message.Message == "popupAddKey") {
        // 这里可以添加密钥到弹窗显示
        console.log('添加密钥到弹窗:', Message.data);
        sendResponse("ok");
        return true;
    }

    // 清理冗余数据 - 移植自 cat-catch
    if (Message.Message == "clearRedundant") {
        clearRedundant();
        sendResponse("OK");
        return true;
    }

    // 从缓存中保存数据到本地 - 移植自 cat-catch
    if (Message.Message == "pushData") {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: cacheData });
        sendResponse("ok");
        return true;
    }

    // 设置扩展图标数字 - 移植自 cat-catch
    if (Message.Message == "ClearIcon") {
        Message.type ? SetIcon({ tabId: Message.tabId }) : SetIcon();
        sendResponse("ok");
        return true;
    }

    // 获取各按钮状态 - 移植自 cat-catch
    if (Message.Message == "getButtonState") {
        let state = {
            MobileUserAgent: G.featMobileTabId?.has(Message.tabId) || false,
            AutoDown: G.featAutoDownTabId?.has(Message.tabId) || false,
            enable: G.enable,
        }
        if (G.scriptList) {
            G.scriptList.forEach(function (item, key) {
                state[item.key] = item.tabId.has(Message.tabId);
            });
        }
        sendResponse(state);
        return true;
    }

    // 脚本注入 - 移植自 cat-catch
    if (Message.Message == "script") {
        if (!G.scriptList || !G.scriptList.has(Message.script)) {
            sendResponse("error");
            return true;
        }
        const script = G.scriptList.get(Message.script);
        const scriptTabid = script.tabId;
        const refresh = script.refresh && scriptTabid.has(Message.tabId);
        scriptTabid.has(Message.tabId) ? scriptTabid.delete(Message.tabId) : scriptTabid.add(Message.tabId);
        if (refresh) {
            chrome.tabs.reload(Message.tabId, { bypassCache: true });
        } else {
            const files = [`catch-script/${Message.script}`];
            script.i18n && files.unshift("catch-script/i18n.js");
            chrome.scripting.executeScript({
                target: { tabId: Message.tabId, allFrames: script.allFrames },
                files: files,
                injectImmediately: true,
                world: script.world
            });
        }
        sendResponse("ok");
        return true;
    }

    // 脚本注入 脚本申请多语言文件 - 移植自 cat-catch
    if (Message.Message == "scriptI18n") {
        chrome.scripting.executeScript({
            target: { tabId: Message.tabId, allFrames: true },
            files: ["catch-script/i18n.js"],
            injectImmediately: true,
            world: "MAIN"
        });
        sendResponse("ok");
        return true;
    }

    // 模拟手机操作 - 移植自 cat-catch
    if (Message.Message == "mobileUserAgent") {
        // 这里可以实现模拟手机 User-Agent 的逻辑
        console.log('模拟手机操作:', Message.tabId);
        sendResponse("ok");
        return true;
    }

    // FFmpeg 网页通信 - 移植自 cat-catch
    if (Message.Message == "catCatchFFmpeg") {
        const data = { ...Message, Message: "ffmpeg", tabId: Message.tabId ?? sender.tab.id, version: G.ffmpegConfig?.version || 1 };
        // 这里可以实现 FFmpeg 处理逻辑
        console.log('FFmpeg 处理:', data);
        sendResponse("ok");
        return true;
    }

    return false;
}

/**
 * 获取设置
 */
async function handleGetSettings(sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    sendResponse({ success: true, settings: result['dog-catch-settings'] });
  } catch (error) {
    console.error('获取设置失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 更新设置
 */
async function handleUpdateSettings(settings, sendResponse) {
  try {
    await chrome.storage.local.set({ 'dog-catch-settings': settings });
    sendResponse({ success: true });
    
    // 通知所有标签页设置已更新
    notifyAllTabs('SETTINGS_UPDATED', { settings });
  } catch (error) {
    console.error('更新设置失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 检测资源 - 返回当前标签页的检测到的资源
 */
async function handleDetectResources(tab, sendResponse) {
  try {
    const tabId = tab.id;
    const resources = cacheData[tabId] || [];

    // 转换为 dog-catch 格式
    const dogCatchResources = resources.map(item => ({
      id: item.requestId,
      type: getResourceType(item.ext, item.type),
      title: item.name || 'Unknown',
      url: item.url,
      size: item.size || 0,
      ext: item.ext,
      mimeType: item.type,
      timestamp: item.getTime || Date.now(),
      tabId: item.tabId,
      initiator: item.initiator
    }));

    sendResponse({ success: true, resources: dogCatchResources });
  } catch (error) {
    console.error('检测资源失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 根据扩展名和MIME类型确定资源类型
 */
function getResourceType(ext, mimeType) {
  if (!ext && !mimeType) return 'unknown';

  // 视频格式
  const videoExts = ['mp4', 'webm', 'avi', 'mov', 'flv', 'mkv', '3gp', 'wmv', 'asf', 'rm', 'rmvb', 'm4v'];
  const videoMimes = ['video/'];

  // 音频格式
  const audioExts = ['mp3', 'aac', 'wav', 'ogg', 'm4a', 'wma', 'flac'];
  const audioMimes = ['audio/'];

  // 流媒体格式
  const streamExts = ['m3u8', 'm3u', 'mpd'];
  const streamMimes = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/dash+xml'];

  if (ext && videoExts.includes(ext.toLowerCase())) return 'video';
  if (ext && audioExts.includes(ext.toLowerCase())) return 'audio';
  if (ext && streamExts.includes(ext.toLowerCase())) return 'stream';

  if (mimeType) {
    if (videoMimes.some(mime => mimeType.startsWith(mime))) return 'video';
    if (audioMimes.some(mime => mimeType.startsWith(mime))) return 'audio';
    if (streamMimes.includes(mimeType)) return 'stream';
  }

  return 'unknown';
}

/**
 * 处理发现的资源
 */
async function handleResourceFound(resource, tab) {
  console.log('发现新资源:', resource, '在标签页:', tab.url);
  
  try {
    // 保存资源到存储
    const result = await chrome.storage.local.get('dog-catch-resources');
    const resources = result['dog-catch-resources'] || [];
    
    // 检查是否已存在
    if (!resources.find(r => r.url === resource.url)) {
      resources.unshift({
        ...resource,
        id: Date.now().toString(),
        timestamp: Date.now(),
        tabId: tab.id,
        tabUrl: tab.url
      });
      
      // 限制资源数量
      if (resources.length > 1000) {
        resources.splice(1000);
      }
      
      await chrome.storage.local.set({ 'dog-catch-resources': resources });
      
      // 通知内容脚本
      chrome.tabs.sendMessage(tab.id, {
        type: 'RESOURCE_ADDED',
        resource: resource
      }).catch(error => {
        console.log('发送消息到内容脚本失败:', error);
      });
    }
  } catch (error) {
    console.error('处理发现的资源失败:', error);
  }
}

/**
 * 切换扩展启用状态
 */
async function handleToggleExtension(tab, sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    const settings = result['dog-catch-settings'] || {};

    settings.enabled = !settings.enabled;

    await chrome.storage.local.set({ 'dog-catch-settings': settings });

    // 通知内容脚本
    chrome.tabs.sendMessage(tab.id, {
      type: 'EXTENSION_TOGGLED',
      enabled: settings.enabled
    }).catch(error => {
      console.log('发送消息到内容脚本失败:', error);
    });

    sendResponse({ success: true, enabled: settings.enabled });
  } catch (error) {
    console.error('切换扩展状态失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 关闭扩展
 */
async function handleCloseExtension(tab, sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    const settings = result['dog-catch-settings'] || {};

    // 设置扩展为禁用状态
    settings.enabled = false;

    await chrome.storage.local.set({ 'dog-catch-settings': settings });

    // 通知内容脚本关闭扩展
    chrome.tabs.sendMessage(tab.id, {
      type: 'EXTENSION_CLOSED'
    }).catch(error => {
      console.log('发送消息到内容脚本失败:', error);
    });

    console.log('Dog-Catch 扩展已关闭');

    if (sendResponse) {
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('关闭扩展失败:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

/**
 * 通知所有标签页
 */
async function notifyAllTabs(type, data) {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: type,
        ...data
      }).catch(error => {
        // 忽略无法发送消息的标签页（如扩展页面、新标签页等）
      });
    }
  } catch (error) {
    console.error('通知所有标签页失败:', error);
  }
}

/**
 * 处理标签页更新事件
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当标签页完成加载时
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('标签页加载完成:', tab.url);
    
    // 这里可以触发资源检测
    // 目前只是记录日志
  }
});

/**
 * 处理标签页激活事件
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('切换到标签页:', activeInfo.tabId);

  // 这里可以更新扩展状态
});

/**
 * 处理扩展图标点击事件
 */
chrome.action.onClicked.addListener(async (tab) => {
  console.log('扩展图标被点击，标签页:', tab.url);

  try {
    // 发送消息到内容脚本，检查插件状态并决定是否打开侧边栏
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_SIDEBAR'
    });

    if (response && response.message) {
      console.log('扩展图标点击处理结果:', response.message);
    }
  } catch (error) {
    console.error('处理扩展图标点击失败:', error);

    // 如果内容脚本未加载，尝试重新注入
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['js/utils.js', 'js/floating-ball.js', 'js/sidebar.js', 'content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['css/floating-ball.css', 'css/sidebar.css']
      });

      // 重新尝试发送消息
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'TOGGLE_SIDEBAR'
          });
        } catch (retryError) {
          console.error('重试打开侧边栏失败:', retryError);
        }
      }, 500);
    } catch (injectError) {
      console.error('注入脚本失败:', injectError);
    }
  }
});

/**
 * 处理网络请求（预留接口）
 */
// chrome.webRequest.onBeforeRequest.addListener(
//   (details) => {
//     // 这里将来会实现网络请求监听逻辑
//     // 用于检测媒体资源
//   },
//   { urls: ["<all_urls>"] },
//   ["requestBody"]
// );

console.log('Dog-Catch 后台脚本已加载');
