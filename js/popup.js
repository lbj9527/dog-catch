// Dog-Catch Popup JavaScript
// 基于 MVC 架构的 View 层实现

class DogCatchPopup {
    constructor() {
        this.resources = [];
        this.currentFilter = 'all';
        this.isEnabled = true;
        
        this.initializeElements();
        this.bindEvents();
        this.loadData();
    }
    
    initializeElements() {
        // 获取DOM元素
        this.elements = {
            resourceCount: document.getElementById('resourceCount'),
            resourceList: document.getElementById('resourceList'),
            emptyState: document.getElementById('emptyState'),
            typeFilter: document.getElementById('typeFilter'),
            deepSearchBtn: document.getElementById('deepSearchBtn'),
            floatingUIBtn: document.getElementById('floatingUIBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            enableBtn: document.getElementById('enableBtn'),
            enableIcon: document.getElementById('enableIcon'),
            clearBtn: document.getElementById('clearBtn'),
            statusText: document.getElementById('statusText'),
            resourceCardTemplate: document.getElementById('resourceCardTemplate')
        };
    }
    
    bindEvents() {
        // 筛选器事件
        this.elements.typeFilter.addEventListener('change', (e) => {
            this.currentFilter = e.target.value;
            this.renderResources();
            this.updateFilterOptions();
        });

        // 初始化筛选选项
        this.updateFilterOptions();
        
        // 深度搜索按钮
        this.elements.deepSearchBtn.addEventListener('click', () => {
            this.triggerDeepSearch();
        });

        // 浮动界面按钮
        this.elements.floatingUIBtn.addEventListener('click', () => {
            this.toggleFloatingUI();
        });

        // 设置按钮
        this.elements.settingsBtn.addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
        
        // 启用/禁用按钮
        this.elements.enableBtn.addEventListener('click', () => {
            this.toggleEnable();
        });
        
        // 清空按钮
        this.elements.clearBtn.addEventListener('click', () => {
            this.clearResources();
        });
    }
    
    async loadData() {
        try {
            this.updateStatus('加载中...');
            
            // 获取当前标签ID
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTabId = tab.id;
            
            // 从后台脚本获取数据
            const response = await chrome.runtime.sendMessage({
                Message: "getAllData",
                tabId: this.currentTabId
            });
            
            if (response && response !== "error") {
                this.processData(response);
            } else {
                this.resources = [];
            }
            
            this.renderResources();
            this.updateStatus('就绪');
            
        } catch (error) {
            console.error('加载数据失败:', error);
            this.updateStatus('加载失败');
        }
    }
    
    processData(data) {
        this.resources = [];
        
        // 处理当前标签的数据
        if (data[this.currentTabId] && Array.isArray(data[this.currentTabId])) {
            this.resources = data[this.currentTabId].map(item => ({
                ...item,
                type: this.getResourceType(item),
                formattedSize: this.formatFileSize(item.size),
                formattedTime: this.formatTime(item.getTime)
            }));
        }
        
        // 按时间排序（最新的在前）
        this.resources.sort((a, b) => b.getTime - a.getTime);
    }
    
    getResourceType(resource) {
        return getResourceType(resource);
    }

    formatFileSize(bytes) {
        return formatFileSize(bytes);
    }

    formatTime(timestamp) {
        return formatTime(timestamp);
    }
    
    renderResources() {
        const filteredResources = this.getFilteredResources();

        // 更新计数
        this.elements.resourceCount.textContent = filteredResources.length;

        // 清空列表
        this.elements.resourceList.innerHTML = '';

        if (filteredResources.length === 0) {
            this.elements.resourceList.appendChild(this.elements.emptyState);
            return;
        }

        // 渲染资源卡片
        filteredResources.forEach(resource => {
            const card = this.createResourceCard(resource);
            this.elements.resourceList.appendChild(card);
        });
    }

    getFilteredResources() {
        if (this.currentFilter === 'all') {
            return this.resources;
        }

        return this.resources.filter(resource => {
            const resourceCategory = this.getResourceCategory(resource);
            return resourceCategory === this.currentFilter;
        });
    }

    getResourceCategory(resource) {
        const ext = resource.ext?.toLowerCase();
        const type = resource.type?.toLowerCase();
        const url = resource.url?.toLowerCase();

        // 视频类型
        const videoExts = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', '3gp'];
        const videoTypes = ['video/'];

        if (videoExts.includes(ext) || videoTypes.some(t => type?.includes(t))) {
            return 'video';
        }

        // 音频类型
        const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma'];
        const audioTypes = ['audio/'];

        if (audioExts.includes(ext) || audioTypes.some(t => type?.includes(t))) {
            return 'audio';
        }

        // 流媒体类型
        if (ext === 'm3u8' || url?.includes('.m3u8') || type?.includes('mpegurl')) {
            return 'stream';
        }

        if (ext === 'mpd' || url?.includes('.mpd') || type?.includes('dash')) {
            return 'stream';
        }

        if (ext === 'ts' || url?.includes('.ts')) {
            return 'stream';
        }

        // 图片类型
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
        const imageTypes = ['image/'];

        if (imageExts.includes(ext) || imageTypes.some(t => type?.includes(t))) {
            return 'image';
        }

        // 文档类型
        const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf'];
        const docTypes = ['application/pdf', 'text/'];

        if (docExts.includes(ext) || docTypes.some(t => type?.includes(t))) {
            return 'document';
        }

        return 'other';
    }

    updateFilterOptions() {
        const categories = {};

        // 统计各类型资源数量
        this.resources.forEach(resource => {
            const category = this.getResourceCategory(resource);
            categories[category] = (categories[category] || 0) + 1;
        });

        // 更新筛选选项
        const filterSelect = this.elements.filterSelect;
        const currentValue = filterSelect.value;

        filterSelect.innerHTML = `
            <option value="all">全部 (${this.resources.length})</option>
            ${categories.video ? `<option value="video">视频 (${categories.video})</option>` : ''}
            ${categories.audio ? `<option value="audio">音频 (${categories.audio})</option>` : ''}
            ${categories.stream ? `<option value="stream">流媒体 (${categories.stream})</option>` : ''}
            ${categories.image ? `<option value="image">图片 (${categories.image})</option>` : ''}
            ${categories.document ? `<option value="document">文档 (${categories.document})</option>` : ''}
            ${categories.other ? `<option value="other">其他 (${categories.other})</option>` : ''}
        `;

        // 恢复之前的选择
        if (currentValue && [...filterSelect.options].some(opt => opt.value === currentValue)) {
            filterSelect.value = currentValue;
        }
    }
    
    createResourceCard(resource) {
        const template = this.elements.resourceCardTemplate.content.cloneNode(true);
        const card = template.querySelector('.resource-card');
        
        // 设置数据
        card.dataset.requestId = resource.requestId;
        card.querySelector('.resource-name').textContent = resource.name || '未知文件';
        card.querySelector('.resource-name').title = resource.name || resource.url;
        card.querySelector('.resource-size').textContent = resource.formattedSize;
        card.querySelector('.resource-type').textContent = resource.ext?.toUpperCase() || 'Unknown';
        card.querySelector('.resource-time').textContent = resource.formattedTime;
        card.querySelector('.resource-url').textContent = resource.url;
        card.querySelector('.resource-url').title = resource.url;
        
        // 绑定按钮事件
        this.bindCardEvents(card, resource);
        
        return card;
    }
    
    bindCardEvents(card, resource) {
        const previewBtn = card.querySelector('.btn-preview');
        const playBtn = card.querySelector('.btn-play');
        const copyBtn = card.querySelector('.btn-copy');
        const previewWindow = card.querySelector('.preview-window');
        const previewClose = card.querySelector('.preview-close');
        
        // 简单预览
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showSimplePreview(card, resource);
        });
        
        // 详细预览（Video.js播放器）
        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openDetailedPreview(resource);
        });
        
        // 复制链接
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyToClipboard(resource.url);
        });
        
        // 关闭预览
        previewClose.addEventListener('click', (e) => {
            e.stopPropagation();
            previewWindow.style.display = 'none';
        });
    }
    
    showSimplePreview(card, resource) {
        const previewWindow = card.querySelector('.preview-window');
        const videoPlayer = card.querySelector('video.preview-player');
        const audioPlayer = card.querySelector('audio.preview-player');

        // 隐藏所有播放器
        videoPlayer.style.display = 'none';
        audioPlayer.style.display = 'none';

        // 根据资源类型和扩展名判断播放器类型
        const isVideo = this.isVideoResource(resource);
        const isAudio = this.isAudioResource(resource);

        if (isVideo) {
            // 视频资源使用 video 元素
            videoPlayer.src = resource.url;
            videoPlayer.style.display = 'block';

            // 设置视频属性
            videoPlayer.controls = true;
            videoPlayer.preload = 'metadata';
            videoPlayer.muted = true; // 自动播放需要静音

            // 错误处理
            videoPlayer.onerror = () => {
                this.showPreviewError(card, '视频加载失败');
            };

        } else if (isAudio) {
            // 音频资源使用 audio 元素
            audioPlayer.src = resource.url;
            audioPlayer.style.display = 'block';

            // 设置音频属性
            audioPlayer.controls = true;
            audioPlayer.preload = 'metadata';

            // 错误处理
            audioPlayer.onerror = () => {
                this.showPreviewError(card, '音频加载失败');
            };
        }

        previewWindow.style.display = 'block';
    }

    isVideoResource(resource) {
        const videoExts = ['mp4', 'webm', 'ogg', 'avi', 'mov', 'wmv', 'flv', 'mkv', '3gp'];
        const videoTypes = ['video/', 'application/x-mpegurl', 'application/dash+xml'];

        const ext = resource.ext?.toLowerCase();
        const type = resource.type?.toLowerCase();
        const url = resource.url?.toLowerCase();

        return videoExts.includes(ext) ||
               videoTypes.some(t => type?.includes(t)) ||
               url?.includes('.m3u8') ||
               url?.includes('.mpd');
    }

    isAudioResource(resource) {
        const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma'];
        const audioTypes = ['audio/'];

        const ext = resource.ext?.toLowerCase();
        const type = resource.type?.toLowerCase();

        return audioExts.includes(ext) ||
               audioTypes.some(t => type?.includes(t));
    }

    showPreviewError(card, message) {
        const previewWindow = card.querySelector('.preview-window');
        const previewContent = previewWindow.querySelector('.preview-content');

        previewContent.innerHTML = `
            <div class="player-error">
                <div>⚠️ ${message}</div>
                <div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">
                    请尝试使用详细预览或直接下载
                </div>
            </div>
        `;
    }
    
    openDetailedPreview(resource) {
        // 在新标签页中打开 Video.js 播放器
        const playerUrl = chrome.runtime.getURL('player.html') + 
                         '?url=' + encodeURIComponent(resource.url) +
                         '&name=' + encodeURIComponent(resource.name || '未知文件') +
                         '&type=' + encodeURIComponent(resource.type);
        
        chrome.tabs.create({ url: playerUrl });
    }
    
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.updateStatus('链接已复制', 2000);
        } catch (error) {
            console.error('复制失败:', error);
            this.updateStatus('复制失败', 2000);
        }
    }
    
    async triggerDeepSearch() {
        try {
            // 使用新的加载反馈系统
            window.dogCatchFeedback.showLoading('deepSearch', {
                message: '正在进行深度搜索...',
                cancellable: true,
                timeout: 30000
            });

            this.elements.deepSearchBtn.disabled = true;

            // 触发深度搜索
            const response = await chrome.runtime.sendMessage({
                Message: "triggerDeepSearch",
                tabId: this.currentTabId
            });

            window.dogCatchFeedback.hideLoading('deepSearch');

            if (response === "ok") {
                window.dogCatchFeedback.showSuccess('深度搜索完成');
                // 重新加载数据
                setTimeout(() => this.loadData(), 1000);
            } else {
                window.dogCatchFeedback.showError('深度搜索失败', '请重试或检查网络连接', {
                    retry: () => this.triggerDeepSearch()
                });
            }

        } catch (error) {
            console.error('深度搜索失败:', error);
            window.dogCatchFeedback.hideLoading('deepSearch');
            window.dogCatchFeedback.showError('深度搜索失败', error.message || '未知错误', {
                details: error.stack,
                retry: () => this.triggerDeepSearch()
            });
        } finally {
            this.elements.deepSearchBtn.disabled = false;
        }
    }

    async toggleFloatingUI() {
        try {
            // 使用新的加载反馈系统
            window.dogCatchFeedback.showLoading('floatingUI', {
                message: '正在打开浮动界面...',
                timeout: 10000
            });

            this.elements.floatingUIBtn.disabled = true;

            // 切换浮动界面
            const response = await chrome.runtime.sendMessage({
                Message: "toggleFloatingUI",
                tabId: this.currentTabId
            });

            window.dogCatchFeedback.hideLoading('floatingUI');

            if (response && response.success) {
                window.dogCatchFeedback.showSuccess('浮动界面已打开');
                // 关闭当前弹窗
                setTimeout(() => window.close(), 1000);
            } else {
                window.dogCatchFeedback.showError('浮动界面打开失败', '请重试或检查权限设置', {
                    retry: () => this.toggleFloatingUI()
                });
            }

        } catch (error) {
            console.error('浮动界面切换失败:', error);
            window.dogCatchFeedback.hideLoading('floatingUI');
            window.dogCatchFeedback.showError('浮动界面切换失败', error.message || '未知错误', {
                details: error.stack,
                retry: () => this.toggleFloatingUI()
            });
        } finally {
            this.elements.floatingUIBtn.disabled = false;
        }
    }
    
    async toggleEnable() {
        try {
            const response = await chrome.runtime.sendMessage({
                Message: "enable"
            });
            
            this.isEnabled = response;
            this.elements.enableIcon.textContent = this.isEnabled ? '🟢' : '🔴';
            this.updateStatus(this.isEnabled ? '已启用' : '已禁用', 2000);
            
        } catch (error) {
            console.error('切换状态失败:', error);
        }
    }
    
    async clearResources() {
        try {
            await chrome.runtime.sendMessage({
                Message: "ClearIcon",
                tabId: this.currentTabId,
                type: true
            });
            
            this.resources = [];
            this.renderResources();
            this.updateStatus('已清空', 2000);
            
        } catch (error) {
            console.error('清空失败:', error);
        }
    }
    
    updateStatus(text, duration = 0) {
        this.elements.statusText.textContent = text;
        
        if (duration > 0) {
            setTimeout(() => {
                this.elements.statusText.textContent = '就绪';
            }, duration);
        }
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    new DogCatchPopup();
});
