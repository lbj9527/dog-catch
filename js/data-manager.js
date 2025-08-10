// Dog-Catch 数据管理器
// 严格移植 cat-catch 的数据层功能，按照 README 中的技术规范实现

/**
 * 数据管理器类 - 严格按照 cat-catch 的数据管理机制
 */
class DataManager {
    constructor() {
        // 初始化缓存数据结构
        this.cacheData = { init: true };
        this.urlMap = new Map();  // URL去重映射 - 按标签页分组
        this.debounce = undefined;
        this.debounceCount = 0;
        this.debounceTime = 0;
        
        // 性能保护配置
        this.maxLength = 9999;      // 最大记录数限制
        this.cleanupThreshold = 500; // 清理阈值
        this.debounceDelay = 2000;   // 防抖延迟
        this.heavyLoadDelay = 5000;  // 重负载延迟
        this.heavyLoadThreshold = 100; // 重负载阈值
    }
    
    /**
     * 添加媒体资源 - 接收已过滤的资源数据
     */
    addMedia(data, isRegex = false) {
        // 检查初始化状态
        if (!this.isReady()) {
            setTimeout(() => this.addMedia(data, isRegex), 233);
            return false;
        }

        // 确保有检测时间
        if (!data.getTime) {
            data.getTime = Date.now();
        }

        // 处理 tabId
        data.tabId = data.tabId == -1 ? G.tabId : data.tabId;

        // 初始化标签页缓存
        this.cacheData[data.tabId] ??= [];
        this.cacheData[G.tabId] ??= [];

        // 性能保护 - 最大记录数限制
        if (this.cacheData[data.tabId].length > this.maxLength) {
            this.cacheData[data.tabId] = [];
            this.saveToStorage();
            return false;
        }

        // URL指纹去重 - 严格按照 cat-catch 的去重机制
        if (G.checkDuplicates && this.cacheData[data.tabId].length <= this.cleanupThreshold) {
            const tabFingerprints = this.urlMap.get(data.tabId) || new Set();
            if (tabFingerprints.has(data.url)) {
                return false; // 找到重复，直接返回
            }
            tabFingerprints.add(data.url);
            this.urlMap.set(data.tabId, tabFingerprints);

            // 性能保护 - 超过500条记录时自动清空去重缓存
            if (tabFingerprints.size >= this.cleanupThreshold) {
                tabFingerprints.clear();
            }
        }

        // 获取页面上下文信息
        this.enrichResourceData(data);
        return true;
    }
    
    /**
     * 丰富资源数据 - 添加页面上下文信息
     */
    enrichResourceData(data) {
        chrome.tabs.get(data.tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
                // 如果获取标签信息失败，使用基础信息
                this.processAndStore(data);
                return;
            }
            
            // 添加页面上下文信息 - 按照 README 中的资源信息构建规范
            const enrichedData = {
                ...data,
                title: tab.title || '',
                webUrl: tab.url || '',
                favIconUrl: tab.favIconUrl || ''
            };
            
            this.processAndStore(enrichedData);
        });
    }
    
    /**
     * 处理并存储资源数据
     */
    processAndStore(data) {
        // 存储到缓存
        this.cacheData[data.tabId] ??= [];
        this.cacheData[data.tabId].push(data);
        
        // 智能防抖存储 - 严格按照 cat-catch 的防抖逻辑
        this.smartSave(data.tabId);
    }
    
    /**
     * 智能防抖存储 - 严格移植 cat-catch 的防抖机制
     */
    smartSave(tabId) {
        // 当前标签媒体数量大于100 开启防抖 等待5秒储存 或 积累10个资源储存一次
        if (this.cacheData[tabId].length >= this.heavyLoadThreshold && this.debounceCount <= 10) {
            this.debounceCount++;
            clearTimeout(this.debounce);
            this.debounce = setTimeout(() => this.save(tabId), this.heavyLoadDelay);
            return;
        }
        
        // 时间间隔小于500毫秒 等待2秒储存
        if (Date.now() - this.debounceTime <= 500) {
            clearTimeout(this.debounce);
            this.debounceTime = Date.now();
            this.debounce = setTimeout(() => this.save(tabId), this.debounceDelay);
            return;
        }
        
        // 立即存储
        this.save(tabId);
    }
    
    /**
     * 保存数据到存储 - Session Storage 优先，Local Storage 降级
     */
    save(tabId) {
        clearTimeout(this.debounce);
        this.debounceTime = Date.now();
        this.debounceCount = 0;
        
        // Session Storage 优先，Local Storage 降级
        this.saveToStorage();
        
        // 更新图标数字
        if (this.cacheData[tabId]) {
            SetIcon({ number: this.cacheData[tabId].length, tabId: tabId });
        }
    }
    
    /**
     * 保存到存储
     */
    saveToStorage() {
        (chrome.storage.session ?? chrome.storage.local).set({ MediaData: this.cacheData }, (result) => {
            if (chrome.runtime.lastError) {
                console.error('Storage save failed:', chrome.runtime.lastError);
            }
        });
    }
    
    /**
     * 获取所有数据
     */
    getAllData() {
        return this.cacheData;
    }
    
    /**
     * 获取指定标签的数据
     */
    getTabData(tabId) {
        return this.cacheData[tabId] || [];
    }
    
    /**
     * 清理指定标签的数据
     */
    clearTabData(tabId) {
        delete this.cacheData[tabId];
        this.saveToStorage();
        
        // 清理对应的URL映射
        this.urlMap.delete(tabId);
        
        // 更新图标
        SetIcon({ tabId: tabId });
    }
    
    /**
     * 清理其他标签的数据
     */
    clearOtherTabsData(currentTabId) {
        for (let tabId in this.cacheData) {
            if (tabId != currentTabId && tabId !== 'init') {
                delete this.cacheData[tabId];
            }
        }
        this.saveToStorage();
        this.cleanupUrlMap();
    }
    
    /**
     * 清理冗余数据 - 严格移植 cat-catch 的清理机制
     */
    clearRedundant() {
        chrome.tabs.query({}, (tabs) => {
            const allTabId = new Set(tabs.map(tab => tab.id));
            
            if (!this.cacheData.init) {
                // 清理缓存数据
                let cacheDataFlag = false;
                for (let key in this.cacheData) {
                    if (!allTabId.has(Number(key))) {
                        cacheDataFlag = true;
                        delete this.cacheData[key];
                    }
                }
                if (cacheDataFlag) {
                    this.saveToStorage();
                }
            }
            
            // 清理URL映射
            this.urlMap.forEach((_, key) => {
                if (!allTabId.has(key)) {
                    this.urlMap.delete(key);
                }
            });
        });
    }
    
    /**
     * 清理URL映射
     */
    cleanupUrlMap() {
        // 只保留当前存在的标签页的映射
        const existingTabIds = new Set(Object.keys(this.cacheData).map(id => parseInt(id)).filter(id => !isNaN(id)));
        
        this.urlMap.forEach((_, tabId) => {
            if (!existingTabIds.has(tabId)) {
                this.urlMap.delete(tabId);
            }
        });
    }
    
    /**
     * 检查是否准备就绪
     */
    isReady() {
        return G && G.initSyncComplete && G.initLocalComplete && G.tabId !== undefined;
    }
    
    /**
     * 从存储中恢复数据
     */
    restoreFromStorage() {
        (chrome.storage.session ?? chrome.storage.local).get({ MediaData: {} }, (items) => {
            if (items.MediaData.init) {
                this.cacheData = {};
                return;
            }
            this.cacheData = items.MediaData;
        });
    }
    
    /**
     * 获取统计信息
     */
    getStats() {
        let totalCount = 0;
        let tabCount = 0;
        
        for (let tabId in this.cacheData) {
            if (Array.isArray(this.cacheData[tabId])) {
                totalCount += this.cacheData[tabId].length;
                tabCount++;
            }
        }
        
        return {
            totalCount,
            tabCount,
            urlMapSize: this.urlMap.size
        };
    }
}

// 导出数据管理器（在浏览器环境中）
if (typeof window !== 'undefined') {
    window.DataManager = DataManager;
}
