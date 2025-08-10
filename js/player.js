// Dog-Catch Video.js 媒体播放器
// 严格按照 README.md 中的技术规范实现

class DogCatchPlayer {
    constructor() {
        this.player = null;
        this.mediaUrl = '';
        this.mediaTitle = '';
        this.mediaType = '';
        this.subtitleTracks = [];
        
        this.init();
    }
    
    init() {
        // 从 URL 参数获取媒体信息
        this.parseUrlParams();
        
        // 初始化 Video.js 播放器
        this.initPlayer();
        
        // 绑定控制按钮事件
        this.bindEvents();
        
        // 设置键盘快捷键
        this.setupKeyboardShortcuts();
        
        // 设置自动隐藏控制栏
        this.setupAutoHideControls();
    }
    
    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.mediaUrl = urlParams.get('url') || '';
        this.mediaTitle = urlParams.get('title') || 'Dog-Catch 媒体播放器';
        this.mediaType = urlParams.get('type') || '';
        
        // 设置页面标题
        document.title = this.mediaTitle;
        document.getElementById('player-title').textContent = this.mediaTitle;
        
        if (!this.mediaUrl) {
            this.showError('缺少媒体地址', '请提供有效的媒体资源 URL');
            return;
        }
    }
    
    initPlayer() {
        try {
            // Video.js 播放器配置 - 严格按照 README.md 的技术规范
            const playerOptions = {
                // 基础配置
                fluid: true,
                responsive: true,
                playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4], // 播放速度控制
                
                // HLS 和 DASH 支持配置
                html5: {
                    hls: {
                        enableLowInitialPlaylist: true,
                        smoothQualityChange: true,
                        overrideNative: true
                    },
                    dash: {
                        setLimitBitrateByPortal: true
                    }
                },
                
                // 字幕系统配置
                textTrackSettings: true,
                
                // 完整播放控制
                controls: true,
                preload: 'auto',
                
                // 全屏支持
                fullscreen: {
                    options: {
                        navigationUI: 'hide'
                    }
                },
                
                // 错误处理
                errorDisplay: false, // 使用自定义错误处理
                
                // 缓冲管理
                liveui: true,
                
                // 移动端适配
                techOrder: ['html5'],
                
                // 无障碍支持
                language: 'zh-CN',
                languages: {
                    'zh-CN': {
                        'Play': '播放',
                        'Pause': '暂停',
                        'Mute': '静音',
                        'Unmute': '取消静音',
                        'Fullscreen': '全屏',
                        'Exit Fullscreen': '退出全屏',
                        'Picture-in-Picture': '画中画'
                    }
                }
            };
            
            // 初始化播放器
            this.player = videojs('dog-catch-player', playerOptions);
            
            // 设置媒体源
            this.setMediaSource();
            
            // 绑定播放器事件
            this.bindPlayerEvents();
            
            // 隐藏加载提示
            this.hideLoading();
            
        } catch (error) {
            console.error('播放器初始化失败:', error);
            this.showError('播放器初始化失败', error.message);
        }
    }
    
    setMediaSource() {
        if (!this.mediaUrl) return;
        
        try {
            // 根据媒体类型设置不同的源配置
            const sourceConfig = this.getSourceConfig();
            
            // 设置媒体源
            this.player.src(sourceConfig);
            
            console.log('媒体源已设置:', sourceConfig);
            
        } catch (error) {
            console.error('设置媒体源失败:', error);
            this.showError('媒体源设置失败', error.message);
        }
    }
    
    getSourceConfig() {
        const url = this.mediaUrl;
        const type = this.mediaType;
        
        // HLS 流媒体支持
        if (url.includes('.m3u8') || type.includes('mpegurl')) {
            return {
                src: url,
                type: 'application/x-mpegURL'
            };
        }
        
        // DASH 流媒体支持
        if (url.includes('.mpd') || type.includes('dash')) {
            return {
                src: url,
                type: 'application/dash+xml'
            };
        }
        
        // 传统格式支持
        if (url.includes('.mp4') || type.includes('mp4')) {
            return {
                src: url,
                type: 'video/mp4'
            };
        }
        
        if (url.includes('.webm') || type.includes('webm')) {
            return {
                src: url,
                type: 'video/webm'
            };
        }
        
        // 音频格式支持
        if (url.includes('.mp3') || type.includes('mpeg')) {
            return {
                src: url,
                type: 'audio/mpeg'
            };
        }
        
        if (url.includes('.aac') || type.includes('aac')) {
            return {
                src: url,
                type: 'audio/aac'
            };
        }
        
        // 默认配置
        return {
            src: url,
            type: type || 'video/mp4'
        };
    }
    
    bindPlayerEvents() {
        if (!this.player) return;
        
        // 播放器就绪事件
        this.player.ready(() => {
            console.log('播放器已就绪');
        });
        
        // 加载开始事件
        this.player.on('loadstart', () => {
            console.log('开始加载媒体');
        });
        
        // 可以播放事件
        this.player.on('canplay', () => {
            console.log('媒体可以播放');
            this.hideLoading();
        });
        
        // 播放事件
        this.player.on('play', () => {
            console.log('开始播放');
        });
        
        // 暂停事件
        this.player.on('pause', () => {
            console.log('播放暂停');
        });
        
        // 结束事件
        this.player.on('ended', () => {
            console.log('播放结束');
        });
        
        // 错误处理事件
        this.player.on('error', (error) => {
            console.error('播放器错误:', error);
            const playerError = this.player.error();
            if (playerError) {
                this.showError('播放错误', this.getErrorMessage(playerError));
            }
        });
        
        // 缓冲事件
        this.player.on('waiting', () => {
            console.log('缓冲中...');
        });
        
        // 进度更新事件
        this.player.on('timeupdate', () => {
            // 可以在这里添加进度相关的逻辑
        });
        
        // 音量变化事件
        this.player.on('volumechange', () => {
            console.log('音量变化:', this.player.volume());
        });
        
        // 全屏变化事件
        this.player.on('fullscreenchange', () => {
            console.log('全屏状态变化:', this.player.isFullscreen());
        });
    }
    
    bindEvents() {
        // 关闭按钮
        document.getElementById('close-btn').addEventListener('click', () => {
            this.closePlayer();
        });
        
        // 画中画按钮
        document.getElementById('pip-btn').addEventListener('click', () => {
            this.togglePictureInPicture();
        });
        
        // 下载按钮
        document.getElementById('download-btn').addEventListener('click', () => {
            this.downloadMedia();
        });
        
        // 设置按钮
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.showSettings();
        });
    }
    
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (!this.player) return;
            
            // 阻止默认行为
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                return;
            }
            
            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    this.seekBackward();
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    this.seekForward();
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    this.volumeUp();
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    this.volumeDown();
                    break;
                case 'KeyF':
                    event.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'KeyM':
                    event.preventDefault();
                    this.toggleMute();
                    break;
                case 'Escape':
                    if (this.player.isFullscreen()) {
                        this.player.exitFullscreen();
                    } else {
                        this.closePlayer();
                    }
                    break;
            }
        });
    }
    
    setupAutoHideControls() {
        let hideTimeout;
        const header = document.getElementById('player-header');
        
        const showControls = () => {
            header.classList.remove('hidden');
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(() => {
                if (this.player && this.player.paused()) return;
                header.classList.add('hidden');
            }, 3000);
        };
        
        const hideControls = () => {
            if (this.player && this.player.paused()) return;
            header.classList.add('hidden');
        };
        
        // 鼠标移动显示控制栏
        document.addEventListener('mousemove', showControls);
        document.addEventListener('mouseenter', showControls);
        
        // 播放时自动隐藏
        if (this.player) {
            this.player.on('play', () => {
                hideTimeout = setTimeout(hideControls, 3000);
            });
            
            this.player.on('pause', showControls);
        }
    }
    
    // 播放控制方法
    togglePlayPause() {
        if (this.player.paused()) {
            this.player.play();
        } else {
            this.player.pause();
        }
    }
    
    seekBackward() {
        const currentTime = this.player.currentTime();
        this.player.currentTime(Math.max(0, currentTime - 10));
    }
    
    seekForward() {
        const currentTime = this.player.currentTime();
        const duration = this.player.duration();
        this.player.currentTime(Math.min(duration, currentTime + 10));
    }
    
    volumeUp() {
        const currentVolume = this.player.volume();
        this.player.volume(Math.min(1, currentVolume + 0.1));
    }
    
    volumeDown() {
        const currentVolume = this.player.volume();
        this.player.volume(Math.max(0, currentVolume - 0.1));
    }
    
    toggleMute() {
        this.player.muted(!this.player.muted());
    }
    
    toggleFullscreen() {
        if (this.player.isFullscreen()) {
            this.player.exitFullscreen();
        } else {
            this.player.requestFullscreen();
        }
    }
    
    togglePictureInPicture() {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
            const videoElement = this.player.el().querySelector('video');
            if (videoElement) {
                videoElement.requestPictureInPicture().catch(error => {
                    console.error('画中画模式失败:', error);
                });
            }
        }
    }
    
    downloadMedia() {
        if (this.mediaUrl) {
            const link = document.createElement('a');
            link.href = this.mediaUrl;
            link.download = this.mediaTitle || 'media';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
    
    showSettings() {
        // 这里可以实现设置面板
        alert('设置功能将在后续版本中实现');
    }
    
    closePlayer() {
        if (this.player) {
            this.player.dispose();
        }
        window.close();
    }
    
    showError(title, message) {
        const errorElement = document.getElementById('error-message');
        const errorDetails = document.getElementById('error-details');
        
        errorElement.querySelector('.error-title').textContent = title;
        errorDetails.textContent = message;
        errorElement.style.display = 'block';
        
        this.hideLoading();
    }
    
    hideLoading() {
        const loadingElement = document.getElementById('loading-message');
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }
    
    getErrorMessage(error) {
        const errorMessages = {
            1: '媒体资源获取被中止',
            2: '网络错误导致媒体下载失败',
            3: '媒体解码失败',
            4: '不支持的媒体格式'
        };
        
        return errorMessages[error.code] || `未知错误 (代码: ${error.code})`;
    }
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    new DogCatchPlayer();
});
