// Dog-Catch 数据模型定义
// 严格按照 cat-catch 的数据结构，定义 Model 层接口规范

/**
 * 资源数据模型 - 基于 cat-catch 的成熟数据结构
 * 按照 README 中"资源信息构建"的规范实现
 */
class MediaResource {
    constructor(data = {}) {
        // 基础信息 - README 中定义的核心字段
        this.name = data.name || '';           // 文件名
        this.url = data.url || '';             // 资源URL
        this.size = data.size || 0;            // 文件大小（字节）
        this.ext = data.ext || '';             // 文件扩展名
        this.type = data.type || '';           // MIME类型
        this.tabId = data.tabId || -1;         // 标签页ID
        this.requestId = data.requestId || ''; // 请求ID
        this.getTime = data.getTime || Date.now(); // 检测时间
        
        // 页面信息 - README 中定义的页面上下文
        this.title = data.title || '';         // 页面标题
        this.webUrl = data.webUrl || '';       // 页面URL
        this.favIconUrl = data.favIconUrl || ''; // 页面图标
        
        // 请求上下文 - 用于下载和播放
        this.referer = data.referer || '';     // 引用页面
        this.origin = data.origin || '';       // 来源域名
        this.initiator = data.initiator || ''; // 请求发起者
        
        // 扩展字段
        this.mime = data.mime || '';           // 完整MIME类型
        this.extraExt = data.extraExt || '';   // 正则匹配的扩展名
        this.isRegex = data.isRegex || false;  // 是否来自正则匹配
        
        // 请求头信息
        this.requestHeaders = data.requestHeaders || {};
    }
    
    /**
     * 验证资源数据的完整性
     */
    isValid() {
        return !!(this.url && (this.ext || this.mime));
    }
    
    /**
     * 获取资源类型分类
     */
    getCategory() {
        const ext = this.ext.toLowerCase();
        const mime = this.mime.toLowerCase();
        
        if (ext === 'm3u8' || ext === 'mpd' || mime.includes('mpegurl') || mime.includes('dash')) {
            return 'stream';
        }
        if (ext === 'mp4' || ext === 'webm' || ext === 'flv' || mime.startsWith('video/')) {
            return 'video';
        }
        if (ext === 'mp3' || ext === 'aac' || ext === 'wav' || mime.startsWith('audio/')) {
            return 'audio';
        }
        return 'unknown';
    }
    
    /**
     * 格式化文件大小
     */
    getFormattedSize() {
        if (!this.size || this.size === 0) return '未知';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(this.size) / Math.log(1024));
        return Math.round(this.size / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    /**
     * 格式化检测时间
     */
    getFormattedTime() {
        const date = new Date(this.getTime);
        return date.toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
    }
    
    /**
     * 转换为JSON对象
     */
    toJSON() {
        return {
            name: this.name,
            url: this.url,
            size: this.size,
            ext: this.ext,
            type: this.type,
            tabId: this.tabId,
            requestId: this.requestId,
            getTime: this.getTime,
            title: this.title,
            webUrl: this.webUrl,
            favIconUrl: this.favIconUrl,
            referer: this.referer,
            origin: this.origin,
            initiator: this.initiator,
            mime: this.mime,
            extraExt: this.extraExt,
            isRegex: this.isRegex,
            requestHeaders: this.requestHeaders
        };
    }
}

/**
 * 加密密钥数据模型 - 用于深度搜索发现的密钥
 */
class EncryptionKey {
    constructor(data = {}) {
        this.key = data.key || '';             // 密钥内容
        this.type = data.type || '';           // 密钥类型 (16字节、32字节、Base64等)
        this.format = data.format || '';       // 密钥格式 (Array、ArrayBuffer、String等)
        this.url = data.url || '';             // 关联的媒体URL
        this.tabId = data.tabId || -1;         // 标签页ID
        this.getTime = data.getTime || Date.now(); // 发现时间
        this.source = data.source || '';       // 发现来源 (XMLHttpRequest、fetch等)
    }
    
    isValid() {
        return !!(this.key && this.type);
    }
    
    toJSON() {
        return {
            key: this.key,
            type: this.type,
            format: this.format,
            url: this.url,
            tabId: this.tabId,
            getTime: this.getTime,
            source: this.source
        };
    }
}

/**
 * 配置数据模型 - 扩展设置
 */
class ExtensionConfig {
    constructor() {
        // 基础配置
        this.enable = true;
        this.maxLength = 9999;
        this.autoClearMode = 0;
        this.deepSearch = false;
        
        // 扩展名配置 - 按照 cat-catch 的格式
        this.Ext = [
            { ext: "mp4", size: 1024 * 1024, state: true },
            { ext: "m3u8", size: 0, state: true },
            { ext: "mpd", size: 0, state: true },
            { ext: "webm", size: 1024 * 1024, state: true },
            { ext: "flv", size: 1024 * 1024, state: true },
            { ext: "mp3", size: 1024 * 1024, state: true },
            { ext: "aac", size: 1024 * 1024, state: true }
        ];
        
        // MIME类型配置
        this.Type = [
            { type: "video/mp4", size: 1024 * 1024, state: true },
            { type: "video/webm", size: 1024 * 1024, state: true },
            { type: "video/x-flv", size: 1024 * 1024, state: true },
            { type: "audio/mpeg", size: 1024 * 1024, state: true },
            { type: "audio/aac", size: 1024 * 1024, state: true },
            { type: "application/vnd.apple.mpegurl", size: 0, state: true },
            { type: "application/dash+xml", size: 0, state: true }
        ];
    }
}

/**
 * 缓存数据管理器 - 按照 README 中的缓存机制规范
 */
class CacheManager {
    constructor() {
        this.data = { init: true };
        this.urlMap = new Map();  // URL去重映射
        this.maxSize = 9999;      // 最大缓存数量
        this.cleanupThreshold = 500; // 清理阈值
    }
    
    /**
     * 添加资源到缓存
     */
    addResource(resource) {
        if (!(resource instanceof MediaResource) || !resource.isValid()) {
            return false;
        }
        
        const tabId = resource.tabId;
        if (!this.data[tabId]) {
            this.data[tabId] = [];
        }
        
        // 检查是否已存在（去重）
        const key = `${tabId}-${resource.url}`;
        if (this.urlMap.has(key)) {
            return false;
        }
        
        // 添加到缓存
        this.data[tabId].push(resource.toJSON());
        this.urlMap.set(key, true);
        
        // 检查是否需要清理
        if (this.data[tabId].length > this.cleanupThreshold) {
            this.cleanup(tabId);
        }
        
        return true;
    }
    
    /**
     * 获取指定标签的资源
     */
    getResources(tabId) {
        return this.data[tabId] || [];
    }
    
    /**
     * 获取所有资源
     */
    getAllResources() {
        return this.data;
    }
    
    /**
     * 清理指定标签的缓存
     */
    cleanup(tabId) {
        if (this.data[tabId]) {
            // 保留最新的资源
            this.data[tabId] = this.data[tabId]
                .sort((a, b) => b.getTime - a.getTime)
                .slice(0, this.maxSize);
            
            // 重建URL映射
            this.rebuildUrlMap();
        }
    }
    
    /**
     * 清空指定标签的缓存
     */
    clear(tabId) {
        if (tabId) {
            delete this.data[tabId];
            // 清理对应的URL映射
            for (let [key] of this.urlMap) {
                if (key.startsWith(`${tabId}-`)) {
                    this.urlMap.delete(key);
                }
            }
        } else {
            this.data = { init: true };
            this.urlMap.clear();
        }
    }
    
    /**
     * 重建URL映射
     */
    rebuildUrlMap() {
        this.urlMap.clear();
        for (let tabId in this.data) {
            if (Array.isArray(this.data[tabId])) {
                this.data[tabId].forEach(resource => {
                    const key = `${tabId}-${resource.url}`;
                    this.urlMap.set(key, true);
                });
            }
        }
    }
}

// 导出模型类（在浏览器环境中）
if (typeof window !== 'undefined') {
    window.MediaResource = MediaResource;
    window.EncryptionKey = EncryptionKey;
    window.ExtensionConfig = ExtensionConfig;
    window.CacheManager = CacheManager;
}
