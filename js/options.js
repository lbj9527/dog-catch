// Dog-Catch 设置页面
// 基于 cat-catch 的设置管理机制

class DogCatchOptions {
    constructor() {
        this.elements = {};
        this.config = {};
        
        this.initializeElements();
        this.loadSettings();
        this.bindEvents();
    }
    
    initializeElements() {
        // 基础设置
        this.elements.enable = document.getElementById('enable');
        this.elements.deepSearch = document.getElementById('deepSearch');
        this.elements.checkDuplicates = document.getElementById('checkDuplicates');
        
        // 文件类型设置
        this.elements.extMp4 = document.getElementById('ext-mp4');
        this.elements.extM3u8 = document.getElementById('ext-m3u8');
        this.elements.extMpd = document.getElementById('ext-mpd');
        this.elements.extWebm = document.getElementById('ext-webm');
        this.elements.extFlv = document.getElementById('ext-flv');
        this.elements.extMp3 = document.getElementById('ext-mp3');
        this.elements.extAac = document.getElementById('ext-aac');
        
        // 按钮和状态
        this.elements.saveBtn = document.getElementById('saveBtn');
        this.elements.status = document.getElementById('status');
    }
    
    async loadSettings() {
        try {
            // 从存储中加载设置
            const syncData = await chrome.storage.sync.get([
                'enable', 'deepSearch', 'checkDuplicates', 'Ext'
            ]);
            
            // 基础设置
            this.elements.enable.checked = syncData.enable !== false;
            this.elements.deepSearch.checked = syncData.deepSearch === true;
            this.elements.checkDuplicates.checked = syncData.checkDuplicates !== false;
            
            // 文件类型设置
            if (syncData.Ext && Array.isArray(syncData.Ext)) {
                const extMap = new Map(syncData.Ext.map(item => [item.ext, item.state]));
                
                this.elements.extMp4.checked = extMap.get('mp4') !== false;
                this.elements.extM3u8.checked = extMap.get('m3u8') !== false;
                this.elements.extMpd.checked = extMap.get('mpd') !== false;
                this.elements.extWebm.checked = extMap.get('webm') !== false;
                this.elements.extFlv.checked = extMap.get('flv') !== false;
                this.elements.extMp3.checked = extMap.get('mp3') !== false;
                this.elements.extAac.checked = extMap.get('aac') !== false;
            }
            
        } catch (error) {
            console.error('加载设置失败:', error);
            this.showStatus('加载设置失败', 'error');
        }
    }
    
    bindEvents() {
        this.elements.saveBtn.addEventListener('click', () => {
            this.saveSettings();
        });
        
        // 监听设置变化
        Object.values(this.elements).forEach(element => {
            if (element.type === 'checkbox') {
                element.addEventListener('change', () => {
                    this.markUnsaved();
                });
            }
        });
    }
    
    async saveSettings() {
        try {
            this.elements.saveBtn.disabled = true;
            this.elements.saveBtn.textContent = '保存中...';
            
            // 构建扩展名配置
            const Ext = [
                { ext: "mp4", size: 1024 * 1024, state: this.elements.extMp4.checked },
                { ext: "m3u8", size: 0, state: this.elements.extM3u8.checked },
                { ext: "mpd", size: 0, state: this.elements.extMpd.checked },
                { ext: "webm", size: 1024 * 1024, state: this.elements.extWebm.checked },
                { ext: "flv", size: 1024 * 1024, state: this.elements.extFlv.checked },
                { ext: "mp3", size: 1024 * 1024, state: this.elements.extMp3.checked },
                { ext: "aac", size: 1024 * 1024, state: this.elements.extAac.checked }
            ];
            
            // 构建 MIME 类型配置
            const Type = [
                { type: "video/mp4", size: 1024 * 1024, state: this.elements.extMp4.checked },
                { type: "video/webm", size: 1024 * 1024, state: this.elements.extWebm.checked },
                { type: "video/x-flv", size: 1024 * 1024, state: this.elements.extFlv.checked },
                { type: "audio/mpeg", size: 1024 * 1024, state: this.elements.extMp3.checked },
                { type: "audio/aac", size: 1024 * 1024, state: this.elements.extAac.checked },
                { type: "application/vnd.apple.mpegurl", size: 0, state: this.elements.extM3u8.checked },
                { type: "application/dash+xml", size: 0, state: this.elements.extMpd.checked }
            ];
            
            // 保存到存储
            await chrome.storage.sync.set({
                enable: this.elements.enable.checked,
                deepSearch: this.elements.deepSearch.checked,
                checkDuplicates: this.elements.checkDuplicates.checked,
                Ext: Ext,
                Type: Type
            });
            
            this.showStatus('设置已保存', 'success');
            
        } catch (error) {
            console.error('保存设置失败:', error);
            this.showStatus('保存设置失败', 'error');
        } finally {
            this.elements.saveBtn.disabled = false;
            this.elements.saveBtn.textContent = '保存设置';
        }
    }
    
    showStatus(message, type) {
        this.elements.status.textContent = message;
        this.elements.status.className = `status ${type}`;
        this.elements.status.style.display = 'block';
        
        setTimeout(() => {
            this.elements.status.style.display = 'none';
        }, 3000);
    }
    
    markUnsaved() {
        if (this.elements.saveBtn.textContent === '保存设置') {
            this.elements.saveBtn.textContent = '保存设置 *';
        }
    }
}

// 初始化设置页面
document.addEventListener('DOMContentLoaded', () => {
    new DogCatchOptions();
});
