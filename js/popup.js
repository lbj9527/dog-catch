/**
 * Dog-Catch Popup 界面逻辑
 * 主界面交互和数据展示
 */

class DogCatchPopup {
    constructor() {
        this.resources = [];
        this.filteredResources = [];
        this.currentFilter = 'all';

        this.initElements();
        this.bindEvents();
        this.loadData();
    }

    initElements() {
        // 获取DOM元素
        this.contentArea = document.getElementById('contentArea');
        this.loadingState = document.getElementById('loadingState');
        this.emptyState = document.getElementById('emptyState');
        this.resourceList = document.getElementById('resourceList');
        this.deepSearchBtn = document.getElementById('deepSearchBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.filterBtns = document.querySelectorAll('.dog-catch-filter-btn');
        this.totalCount = document.getElementById('totalCount');
        this.totalSize = document.getElementById('totalSize');
        this.lastUpdate = document.getElementById('lastUpdate');
        this.previewModal = document.getElementById('previewModal');
        this.previewTitle = document.getElementById('previewTitle');
        this.previewBody = document.getElementById('previewBody');
        this.closePreviewBtn = document.getElementById('closePreviewBtn');
    }

    bindEvents() {
        // 深度搜索
        this.deepSearchBtn.addEventListener('click', () => {
            this.performDeepSearch();
        });

        // 刷新
        this.refreshBtn.addEventListener('click', () => {
            this.loadData();
        });

        // 筛选器
        this.filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setFilter(e.target.dataset.type);
            });
        });

        // 预览模态框
        this.closePreviewBtn.addEventListener('click', () => {
            this.closePreview();
        });

        this.previewModal.addEventListener('click', (e) => {
            if (e.target === this.previewModal) {
                this.closePreview();
            }
        });
    }

    async loadData() {
        this.showLoading();
        
        try {
            // 从background获取数据
            const response = await chrome.runtime.sendMessage({ action: 'getAllData' });
            
            if (response && typeof response === 'object') {
                this.processData(response);
            } else {
                this.resources = [];
            }
            
            this.filterResources();
            this.updateStats();
            this.updateLastUpdate();
            
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showEmpty();
        }
    }

    processData(data) {
        this.resources = [];
        
        // 处理来自background的数据
        for (const tabId in data) {
            if (data[tabId] && Array.isArray(data[tabId])) {
                this.resources.push(...data[tabId]);
            }
        }
        
        // 模拟数据（用于界面测试）
        if (this.resources.length === 0) {
            this.resources = this.generateMockData();
        }
    }

    generateMockData() {
        return [
            {
                name: 'sample_video.mp4',
                url: 'https://example.com/video.mp4',
                size: 15728640, // 15MB
                ext: 'mp4',
                type: 'video/mp4',
                getTime: Date.now() - 60000
            },
            {
                name: 'audio_track.mp3',
                url: 'https://example.com/audio.mp3',
                size: 5242880, // 5MB
                ext: 'mp3',
                type: 'audio/mpeg',
                getTime: Date.now() - 120000
            },
            {
                name: 'playlist.m3u8',
                url: 'https://example.com/playlist.m3u8',
                size: 1024,
                ext: 'm3u8',
                type: 'application/vnd.apple.mpegurl',
                getTime: Date.now() - 30000
            }
        ];
    }

    filterResources() {
        this.filteredResources = this.resources.filter(resource => {
            // 类型筛选
            return this.currentFilter === 'all' || this.getResourceType(resource) === this.currentFilter;
        });

        this.renderResources();
    }

    getResourceType(resource) {
        if (resource.type) {
            if (resource.type.startsWith('video/')) return 'video';
            if (resource.type.startsWith('audio/')) return 'audio';
            if (resource.type.startsWith('image/')) return 'image';
        }
        
        if (resource.ext) {
            const videoExts = ['mp4', 'webm', 'avi', 'mov', 'wmv', 'flv', 'm3u8', 'mpd'];
            const audioExts = ['mp3', 'wav', 'aac', 'ogg', 'm4a'];
            const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
            
            if (videoExts.includes(resource.ext.toLowerCase())) return 'video';
            if (audioExts.includes(resource.ext.toLowerCase())) return 'audio';
            if (imageExts.includes(resource.ext.toLowerCase())) return 'image';
        }
        
        return 'document';
    }

    renderResources() {
        if (this.filteredResources.length === 0) {
            this.showEmpty();
            return;
        }

        this.showResourceList();
        
        this.resourceList.innerHTML = this.filteredResources.map(resource => 
            this.createResourceItem(resource)
        ).join('');

        // 绑定资源项事件
        this.bindResourceEvents();
    }

    createResourceItem(resource) {
        const type = this.getResourceType(resource);
        const size = this.formatSize(resource.size || 0);
        const time = this.formatTime(resource.getTime);
        const typeIcon = this.getTypeIcon(type);

        return `
            <div class="dog-catch-resource-item" data-url="${resource.url}">
                <div class="dog-catch-resource-icon ${type}">
                    ${typeIcon}
                </div>
                <div class="dog-catch-resource-info">
                    <div class="dog-catch-resource-name" title="${resource.name}">
                        ${resource.name}
                    </div>
                    <div class="dog-catch-resource-meta">
                        <span class="dog-catch-resource-size">${size}</span>
                        <span class="dog-catch-resource-type">${resource.ext || type}</span>
                        <span>${time}</span>
                    </div>
                </div>
                <div class="dog-catch-resource-actions">
                    <button class="dog-catch-action-btn preview-btn" title="预览">
                        👁️
                    </button>
                    <button class="dog-catch-action-btn download-btn" title="下载">
                        💾
                    </button>
                    <button class="dog-catch-action-btn copy-btn" title="复制链接">
                        📋
                    </button>
                </div>
            </div>
        `;
    }

    bindResourceEvents() {
        // 预览按钮
        document.querySelectorAll('.preview-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.dog-catch-resource-item');
                const url = item.dataset.url;
                this.showPreview(url);
            });
        });

        // 下载按钮
        document.querySelectorAll('.download-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.dog-catch-resource-item');
                const url = item.dataset.url;
                this.downloadResource(url);
            });
        });

        // 复制按钮
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = e.target.closest('.dog-catch-resource-item');
                const url = item.dataset.url;
                this.copyToClipboard(url);
            });
        });
    }

    getTypeIcon(type) {
        const icons = {
            video: '🎬',
            audio: '🎵',
            image: '🖼️',
            document: '📄'
        };
        return icons[type] || '📄';
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    formatTime(timestamp) {
        if (!timestamp) return '--';
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}小时前`;
        
        const days = Math.floor(hours / 24);
        return `${days}天前`;
    }

    setFilter(type) {
        this.currentFilter = type;
        
        // 更新按钮状态
        this.filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        this.filterResources();
    }



    showPreview(url) {
        this.previewTitle.textContent = '媒体预览';
        this.previewBody.innerHTML = `
            <video controls style="width: 100%; max-height: 400px;">
                <source src="${url}">
                您的浏览器不支持视频播放。
            </video>
        `;
        this.previewModal.classList.add('show');
    }

    closePreview() {
        this.previewModal.classList.remove('show');
    }

    downloadResource(url) {
        chrome.downloads.download({ url: url });
    }

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showNotification('链接已复制到剪贴板', 'success');
        } catch (error) {
            console.error('复制失败:', error);
        }
    }

    showNotification(message, type = 'info') {
        // TODO: 实现通知功能
        console.log(`${type}: ${message}`);
    }

    updateStats() {
        this.totalCount.textContent = this.resources.length;
        
        const totalBytes = this.resources.reduce((sum, resource) => sum + (resource.size || 0), 0);
        this.totalSize.textContent = this.formatSize(totalBytes);
    }

    updateLastUpdate() {
        this.lastUpdate.textContent = new Date().toLocaleTimeString();
    }

    showLoading() {
        this.loadingState.style.display = 'block';
        this.emptyState.style.display = 'none';
        this.resourceList.style.display = 'none';
    }

    showEmpty() {
        this.loadingState.style.display = 'none';
        this.emptyState.style.display = 'block';
        this.resourceList.style.display = 'none';
    }

    showResourceList() {
        this.loadingState.style.display = 'none';
        this.emptyState.style.display = 'none';
        this.resourceList.style.display = 'block';
    }

    async performDeepSearch() {
        this.deepSearchBtn.disabled = true;
        this.deepSearchBtn.innerHTML = '<div class="dog-catch-spinner"></div> 搜索中...';

        try {
            // 发送深度搜索请求
            await chrome.runtime.sendMessage({ action: 'performDeepSearch' });

            // 等待一段时间后重新加载数据
            setTimeout(() => {
                this.loadData();
            }, 2000);

        } catch (error) {
            console.error('深度搜索失败:', error);
        } finally {
            this.deepSearchBtn.disabled = false;
            this.deepSearchBtn.innerHTML = '深度搜索';
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new DogCatchPopup();
});
