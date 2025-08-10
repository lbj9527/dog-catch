// Dog-Catch 初始化文件
// 严格移植 cat-catch 的初始化逻辑和兼容性处理

// 兼容性处理 - 低版本chrome manifest v3协议 会有 getMessage 函数不存在的bug
if (chrome.i18n.getMessage === undefined) {
    chrome.i18n.getMessage = (key) => key;
}

// 兼容性处理 - 部分修改版chrome 不存在 chrome.downloads API
if (!chrome.downloads) {
    chrome.downloads = {
        download: function (options, callback) {
            let a = document.createElement('a');
            a.href = options.url;
            a.download = options.filename;
            a.click();
            delete a;
            callback && callback();
        },
        onChanged: { addListener: function () { } },
        showDefaultFolder: function () { },
        show: function () { },
    }
}

// 兼容性处理 - 114版本以下没有chrome.sidePanel
if (!chrome.sidePanel) {
    chrome.sidePanel = {
        setOptions: function (options) { },
        setPanelBehavior: function (options) { },
    }
}

// 简写翻译函数
const i18n = new Proxy(chrome.i18n.getMessage, {
    get: function (target, key) {
        return chrome.i18n.getMessage(key) || key;
    }
});

// 全局变量定义 - 严格按照 cat-catch 的数据模型
var G = {};
G.initSyncComplete = false;
G.initLocalComplete = false;

// 缓存数据 - 按照 README 中的数据层规范
var cacheData = { init: true };
G.requestHeaders = new Map();   // 临时储存请求头
G.urlMap = new Map();           // url查重map
G.deepSearchTemporarilyClose = null; // 深度搜索临时变量

// 严格移植 cat-catch 的关键全局变量
G.blackList = new Set();        // 正则屏蔽资源列表
G.blockUrlSet = new Set();      // 屏蔽网址列表
G.blockUrlWhite = false;        // 屏蔽网址白名单模式
G.isFirefox = navigator.userAgent.toLowerCase().includes('firefox'); // 浏览器检测
G.Regex = new Map();            // 正则匹配配置

// 初始化正则匹配规则 - 严格移植 cat-catch 的正则规则
function initRegexRules() {
    // 基础媒体文件正则
    G.Regex.set("media", {
        state: true,
        regex: /\.(mp4|webm|flv|avi|mkv|mov|wmv|3gp|mp3|wav|aac|ogg|m4a|flac)(\?[^?\s]*)?$/i
    });

    // M3U8 流媒体正则
    G.Regex.set("m3u8", {
        state: true,
        regex: /\.m3u8(\?[^?\s]*)?$/i
    });

    // MPD 流媒体正则
    G.Regex.set("mpd", {
        state: true,
        regex: /\.mpd(\?[^?\s]*)?$/i
    });

    // TS 分片正则
    G.Regex.set("ts", {
        state: true,
        regex: /\.ts(\?[^?\s]*)?$/i
    });
}

// 初始化当前tabId
chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (tabs[0] && tabs[0].id) {
        G.tabId = tabs[0].id;
    } else {
        G.tabId = -1;
    }
});

// 浏览器版本检测
G.isFirefox = (typeof browser == "object");
G.version = navigator.userAgent.match(/(Chrome|Firefox)\/([\d]+)/);
G.version = G.version && G.version[2] ? parseInt(G.version[2]) : 88;

// 手机浏览器检测
G.isMobile = /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);

// 默认配置 - 严格按照 cat-catch 的配置结构
G.SyncVar = {
    enable: true,
    maxLength: G.isMobile ? 999 : 9999,
    autoClearMode: 0,
    deepSearch: false,
    checkDuplicates: true,
    downActive: !G.isMobile,
    
    // 扩展名配置 - 按照 README 中的默认扩展名
    Ext: [
        { ext: "mp4", size: 1024 * 1024, state: true },
        { ext: "m3u8", size: 0, state: true },
        { ext: "mpd", size: 0, state: true },
        { ext: "webm", size: 1024 * 1024, state: true },
        { ext: "flv", size: 1024 * 1024, state: true },
        { ext: "mp3", size: 1024 * 1024, state: true },
        { ext: "aac", size: 1024 * 1024, state: true }
    ],
    
    // MIME类型配置
    Type: [
        { type: "video/mp4", size: 1024 * 1024, state: true },
        { type: "video/webm", size: 1024 * 1024, state: true },
        { type: "video/x-flv", size: 1024 * 1024, state: true },
        { type: "audio/mpeg", size: 1024 * 1024, state: true },
        { type: "audio/aac", size: 1024 * 1024, state: true },
        { type: "application/vnd.apple.mpegurl", size: 0, state: true },
        { type: "application/dash+xml", size: 0, state: true }
    ],
    
    // 正则匹配配置 - 简化版，暂时为空
    Regex: []
};

// 本地储存的配置
G.LocalVar = {
    previewShowTitle: false,
    previewDeleteDuplicateFilenames: false
};

// 脚本列表 - 按照 cat-catch 的脚本管理模式
G.scriptList = new Map();
G.scriptList.set("search.js", { 
    key: "search", 
    refresh: true, 
    allFrames: true, 
    world: "MAIN", 
    name: "深度搜索", 
    off: "关闭搜索", 
    tabId: new Set() 
});

// 正则预编译 - 按照 cat-catch 的正则表达式
const reFilename = /filename="?([^"]+)"?/;
const reStringModify = /[<>:"\/\\|?*~]/g;
const reFilterFileName = /[<>:"|?*~]/g;

// 防抖变量
let debounce = undefined;
let debounceCount = 0;
let debounceTime = 0;

// 特殊页面过滤函数 - 按照 README 中的错误处理规范
function isSpecialPage(url) {
    if (!url) return true;
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('moz-extension://') || 
           url.startsWith('edge://') || 
           url.startsWith('about:');
}

// 注意：工具函数已移至 utils.js 中统一管理

// 心跳保活机制 - 防止 Service Worker 被强制终止
chrome.runtime.onConnect.addListener(function (Port) {
    if (chrome.runtime.lastError || Port.name !== "HeartBeat") return;
    Port.postMessage("HeartBeat");
    Port.onMessage.addListener(function (message, Port) { return; });
    const interval = setInterval(function () {
        clearInterval(interval);
        Port.disconnect();
    }, 250000);
    Port.onDisconnect.addListener(function () {
        interval && clearInterval(interval);
    });
});

// 初始化配置函数
function InitOptions() {
    // 注意：数据恢复逻辑已移至 DataManager 类中处理

    // 初始化正则匹配规则
    initRegexRules();
    
    // 读取sync配置数据 交给全局变量G
    chrome.storage.sync.get(G.SyncVar, function (items) {
        if (chrome.runtime.lastError) {
            items = G.SyncVar;
        }
        
        // 确保有默认值
        for (let key in G.SyncVar) {
            if (items[key] === undefined || items[key] === null) {
                items[key] = G.SyncVar[key];
            }
        }
        
        // Ext的Array转为Map类型
        G.Ext = new Map(items.Ext.map(item => [item.ext, item]));
        // Type的Array转为Map类型
        G.Type = new Map(items.Type.map(item => [item.type, { size: item.size, state: item.state }]));
        
        G = { ...items, ...G };
        
        // 设置扩展图标状态
        chrome.action.setIcon({ path: G.enable ? "/img/icon.png" : "/img/icon-disable.png" });
        G.initSyncComplete = true;
    });
    
    // 读取local配置数据 交给全局变量G
    (chrome.storage.session ?? chrome.storage.local).get(G.LocalVar, function (items) {
        G = { ...items, ...G };
        G.initLocalComplete = true;
    });
}

// 监听配置变化，新值给全局变量
chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (changes.MediaData) {
        if (changes.MediaData.newValue?.init) { 
            cacheData = {}; 
        }
        return;
    }
    
    for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
        newValue ??= G.SyncVar[key];
        if (key == "Ext") {
            G.Ext = new Map(newValue.map(item => [item.ext, item]));
            continue;
        }
        if (key == "Type") {
            G.Type = new Map(newValue.map(item => [item.type, { size: item.size, state: item.state }]));
            continue;
        }
        G[key] = newValue;
    }
});

// 执行初始化
InitOptions();

console.log("Dog-Catch init.js loaded");
