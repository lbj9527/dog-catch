// Dog-Catch 工具函数
// 严格移植 cat-catch 的核心工具函数，按照 README 中的技术规范实现

/**
 * 获取文件名及扩展名 - 严格移植 cat-catch 的实现
 * @param {String} pathname 
 * @returns {Array} [fileName, ext]
 */
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}

/**
 * 获取响应头信息 - 严格移植 cat-catch 的实现
 * @param {Object} data webRequest 数据
 * @returns {Object} 解析后的响应头信息
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
 * 获取请求头信息 - 严格移植 cat-catch 的实现
 * @param {Object} data webRequest 数据
 * @returns {Object|Boolean} 解析后的请求头信息
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

/**
 * 检查扩展名和大小 - 严格移植 cat-catch 的实现
 * @param {String} ext 扩展名
 * @param {Number} size 文件大小（字节）
 * @returns {Boolean|String} true=通过, false=不匹配, "break"=被屏蔽
 */
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) { return false; }
    if (!Ext.state) { return "break"; }
    if (Ext.size != 0 && size != undefined && size <= Ext.size * 1024) { return "break"; }
    return true;
}

/**
 * 检查MIME类型和大小 - 严格移植 cat-catch 的实现
 * @param {String} dataType MIME类型
 * @param {Number} dataSize 文件大小（字节）
 * @returns {Boolean|String} true=通过, false=不匹配, "break"=被屏蔽
 */
function CheckType(dataType, dataSize) {
    const typeInfo = G.Type.get(dataType.split("/")[0] + "/*") || G.Type.get(dataType);
    if (!typeInfo) { return false; }
    if (!typeInfo.state) { return "break"; }
    if (typeInfo.size != 0 && dataSize != undefined && dataSize <= typeInfo.size * 1024) { return "break"; }
    return true;
}

/**
 * 特殊页面过滤 - 严格移植 cat-catch 的实现
 * @param {String} url 
 * @returns {Boolean}
 */
function isSpecialPage(url) {
    if (!url) return true;
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('moz-extension://') || 
           url.startsWith('edge://') || 
           url.startsWith('about:');
}

/**
 * 字符串修剪 - 移除特殊字符
 * @param {String} str 
 * @returns {String}
 */
function stringModify(str) {
    if (!str) return "untitled";
    
    return str.replace(/['\\:\*\?"<\/>\|~]/g, function (m) {
        return {
            "'": '&#39;',
            '\\': '&#92;',
            '/': '&#47;',
            ':': '&#58;',
            '*': '&#42;',
            '?': '&#63;',
            '"': '&quot;',
            '<': '&lt;',
            '>': '&gt;',
            '|': '&#124;',
            '~': '_'
        }[m];
    });
}

/**
 * 从URL中获取文件名
 * @param {String} url 
 * @returns {String}
 */
function getUrlFileName(url) {
    try {
        let pathname = new URL(url).pathname;
        let filename = pathname.split("/").pop();
        return filename ? filename : "NULL";
    } catch (e) {
        return "NULL";
    }
}

/**
 * 判断是否为媒体扩展名
 * @param {String} ext 
 * @returns {Boolean}
 */
function isMediaExt(ext) {
    return ['ogg', 'ogv', 'mp4', 'webm', 'mp3', 'wav', 'm4a', '3gp', 'mpeg', 'mov', 'm4s', 'aac', 'flv', 'm3u8', 'mpd'].includes(ext);
}

/**
 * 判断是否为图片格式
 * @param {Object} data 
 * @returns {Boolean}
 */
function isPicture(data) {
    return (data.type?.startsWith("image/") ||
        data.ext == "jpg" ||
        data.ext == "png" ||
        data.ext == "jpeg" ||
        data.ext == "bmp" ||
        data.ext == "gif" ||
        data.ext == "webp" ||
        data.ext == "svg"
    );
}

/**
 * 判断是否为媒体资源
 * @param {Object} data 
 * @returns {Boolean}
 */
function isMedia(data) {
    return isMediaExt(data.ext) || data.type?.startsWith("video/") || data.type?.startsWith("audio/");
}

/**
 * 判断是否为M3U8资源
 * @param {Object} data 
 * @returns {Boolean}
 */
function isM3U8(data) {
    return data.ext === 'm3u8' || data.type?.includes('mpegurl') || data.url?.includes('.m3u8');
}

/**
 * 判断是否为MPD资源
 * @param {Object} data 
 * @returns {Boolean}
 */
function isMPD(data) {
    return data.ext === 'mpd' || data.type?.includes('dash') || data.url?.includes('.mpd');
}

/**
 * 判断是否可播放
 * @param {Object} data 
 * @returns {Boolean}
 */
function isPlayable(data) {
    const typeArray = ['video/ogg', 'video/mp4', 'video/webm', 'audio/ogg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'video/3gp', 'video/mpeg', 'video/mov'];
    return isMediaExt(data.ext) || typeArray.includes(data.type) || isM3U8(data) || isMPD(data);
}

/**
 * 格式化文件大小
 * @param {Number} bytes 
 * @returns {String}
 */
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '未知';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 格式化时间
 * @param {Number} timestamp 
 * @returns {String}
 */
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
}

/**
 * 获取资源类型分类
 * @param {Object} resource 
 * @returns {String}
 */
function getResourceType(resource) {
    const ext = resource.ext?.toLowerCase();
    const mime = resource.type?.toLowerCase();
    
    if (ext === 'm3u8' || ext === 'mpd' || mime?.includes('mpegurl') || mime?.includes('dash')) {
        return 'stream';
    }
    if (ext === 'mp4' || ext === 'webm' || ext === 'flv' || mime?.startsWith('video/')) {
        return 'video';
    }
    if (ext === 'mp3' || ext === 'aac' || ext === 'wav' || mime?.startsWith('audio/')) {
        return 'audio';
    }
    return 'unknown';
}

// 导出函数（在浏览器环境中）
if (typeof window !== 'undefined') {
    window.fileNameParse = fileNameParse;
    window.getResponseHeadersValue = getResponseHeadersValue;
    window.getRequestHeaders = getRequestHeaders;
    window.CheckExtension = CheckExtension;
    window.CheckType = CheckType;
    window.isSpecialPage = isSpecialPage;
    window.stringModify = stringModify;
    window.getUrlFileName = getUrlFileName;
    window.isMediaExt = isMediaExt;
    window.isPicture = isPicture;
    window.isMedia = isMedia;
    window.isM3U8 = isM3U8;
    window.isMPD = isMPD;
    window.isPlayable = isPlayable;
    window.formatFileSize = formatFileSize;
    window.formatTime = formatTime;
    window.getResourceType = getResourceType;
}
