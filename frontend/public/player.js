// 播放器主逻辑
class VideoPlayer {
    constructor() {
        this.player = null;
        this.currentVideoUrl = '';
        this.currentVideoId = '';
        this.qualities = [];
        this.subtitleUrl = '';
        
        this.init();
    }
    
    // 初始化播放器
    init() {
        // 解析URL参数
        const params = this.parseUrlParams();
        if (!params.src) {
            this.showMessage('缺少视频源参数', 'error');
            return;
        }
        
        this.currentVideoUrl = params.src;
        this.currentVideoId = params.video || '';
        
        // 设置页面标题
        const title = params.title || '视频播放';
        document.getElementById('title').textContent = title;
        document.title = title;
        
        // 设置按钮事件
        this.setupControls();
        
        // 初始化Video.js播放器
        this.initVideoJs();
        
        // 处理视频源
        if (params.type === 'hls' || this.currentVideoUrl.includes('.m3u8')) {
            this.handleHLSVideo();
        } else {
            this.handleMP4Video();
        }
        
        // 加载字幕
        if (this.currentVideoId) {
            this.loadSubtitle();
        }
    }
    
    // 解析URL参数
    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        return {
            src: urlParams.get('src'),
            type: urlParams.get('type'),
            title: urlParams.get('title'),
            referer: urlParams.get('referer'),
            video: urlParams.get('video')
        };
    }
    
    // 设置控制按钮
    setupControls() {
        // 复制链接
        document.getElementById('copyLink').onclick = () => {
            this.copyToClipboard(this.currentVideoUrl);
        };
        
        // 字幕开关
        const subtitleBtn = document.getElementById('subtitleToggle');
        subtitleBtn.disabled = true; // 初始禁用，等字幕加载成功后启用
        subtitleBtn.textContent = '显示字幕';
        subtitleBtn.onclick = () => {
            if (subtitleBtn.disabled) return;
            this.toggleSubtitle();
        };
        
        // 清晰度选择
        document.getElementById('qualitySelect').onchange = (e) => {
            if (e.target.value) {
                this.switchQuality(e.target.value);
            }
        };
        
        // 设置fallback链接
        document.getElementById('fallbackLink').href = this.currentVideoUrl;
    }
    
    // 初始化Video.js播放器
    initVideoJs() {
        this.player = videojs('videoPlayer', {
            controls: true,
            fluid: true,
            responsive: true,
            playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
            html5: {
                vhs: {
                    overrideNative: true,
                    // 调优以提升seek恢复速度
                    // 目标缓冲时长（秒），缩短到更快达成可播放状态
                    targetDuration: 10,
                    // 增加并发请求，有助于更快抓取初始化段/关键帧附近分片
                    bandwidth: 1e7,
                    // 允许更激进地切换清晰度以尽快恢复播放
                    enableLowInitialPlaylist: true,
                    fastQualityChange: true,
                    // 降低初始缓冲需求
                    playbackRateSwitching: true
                },
                nativeAudioTracks: false,
                nativeVideoTracks: false
            }
        });
        
        // 播放器事件监听
        this.setupPlayerEvents();
    }
    
    // 设置播放器事件
    setupPlayerEvents() {
        this.player.on('loadstart', () => {
            this.showMessage('正在加载视频...', 'loading');
        });
        
        this.player.on('canplay', () => {
            this.showMessage('视频加载完成', 'success');
            setTimeout(() => this.clearMessage(), 2000);
        });
        
        this.player.on('error', () => {
            const error = this.player.error();
            let errorMsg = '播放失败';
            
            if (error) {
                switch(error.code) {
                    case 1:
                        errorMsg = '视频加载被中止';
                        break;
                    case 2:
                        errorMsg = '网络错误，请检查网络连接';
                        break;
                    case 3:
                        errorMsg = '视频解码错误';
                        break;
                    case 4:
                        errorMsg = '视频格式不支持或源不可用';
                        break;
                    default:
                        errorMsg = '播放失败，可能为跨域或防盗链限制';
                }
            }
            
            this.showMessage(errorMsg, 'error');
        });
        
        // 播放器就绪后尝试自动播放
        this.player.ready(() => {
            this.player.play().catch(() => {
                this.showMessage('请点击播放按钮开始播放', 'info');
            });
        });
    }
    
    // 处理HLS视频
    async handleHLSVideo() {
        try {
            // 通过代理检查是否为master playlist
            const proxyUrl = `http://localhost:8000/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
            const response = await fetch(proxyUrl);
            const content = await response.text();
            
            if (this.isMasterPlaylist(content)) {
                // 解析清晰度选项
                this.qualities = this.parseQualities(content);
                this.showQualitySelector();
                
                // 默认选择中等清晰度
                const defaultQuality = this.selectDefaultQuality();
                this.playVideo(defaultQuality.url, 'hls');
            } else {
                // 直接播放，也通过代理
                const proxyUrl = `http://localhost:8000/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
                this.playVideo(proxyUrl, 'hls');
            }
        } catch (error) {
            console.error('HLS处理错误:', error);
            // 尝试通过代理直接播放
            const proxyUrl = `http://localhost:8000/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
            this.playVideo(proxyUrl, 'hls');
        }
    }
    
    // 处理MP4视频
    handleMP4Video() {
        this.playVideo(this.currentVideoUrl, 'mp4');
    }
    
    // 播放视频
    playVideo(url, type) {
        const source = {
            src: url,
            type: type === 'hls' ? 'application/x-mpegURL' : 'video/mp4'
        };
        
        this.player.src(source);
        this.currentVideoUrl = url;

        // 源切换后，确保字幕轨道被重新附加
        this.player.one('loadedmetadata', () => {
            this.addSubtitleTrack();
        });
    }
    
    // 检查是否为master playlist
    isMasterPlaylist(content) {
        return content.includes('#EXT-X-STREAM-INF');
    }
    
    // 解析清晰度选项
    parseQualities(content) {
        const qualities = [];
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                const nextLine = lines[i + 1]?.trim();
                if (nextLine && !nextLine.startsWith('#')) {
                    const resolution = this.extractResolution(line);
                    const bandwidth = this.extractBandwidth(line);
                    
                    const originalUrl = new URL(nextLine, this.currentVideoUrl).href;
                    const proxyUrl = `http://localhost:8000/api/hls?url=${encodeURIComponent(originalUrl)}`;
                    
                    qualities.push({
                        resolution: resolution || `${Math.round(bandwidth / 1000)}k`,
                        url: proxyUrl,
                        bandwidth: bandwidth
                    });
                }
            }
        }
        
        // 按带宽排序
        return qualities.sort((a, b) => b.bandwidth - a.bandwidth);
    }
    
    // 提取分辨率
    extractResolution(line) {
        const match = line.match(/RESOLUTION=(\d+x\d+)/);
        if (match) {
            const [width, height] = match[1].split('x');
            return `${height}p`;
        }
        return null;
    }
    
    // 提取带宽
    extractBandwidth(line) {
        const match = line.match(/BANDWIDTH=(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
    
    // 显示清晰度选择器
    showQualitySelector() {
        const select = document.getElementById('qualitySelect');
        // 不再显示占位项“选择清晰度”，而是直接展示并选中默认清晰度
        select.innerHTML = '';

        const defaultQuality = this.selectDefaultQuality();
        const defaultUrl = defaultQuality ? defaultQuality.url : '';
        
        this.qualities.forEach(quality => {
            const option = document.createElement('option');
            option.value = quality.url;
            option.textContent = quality.resolution;
            if (quality.url === defaultUrl) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (defaultUrl) {
            // 确保下拉框当前显示为默认清晰度
            select.value = defaultUrl;
        }
        
        select.style.display = 'inline-block';
    }
    
    // 选择默认清晰度（中等）
    selectDefaultQuality() {
        if (this.qualities.length === 0) return null;
        
        // 选择中等清晰度：如果有多个选项，选择中间的；如果只有一个，选择它
        const middleIndex = Math.floor(this.qualities.length / 2);
        return this.qualities[middleIndex];
    }
    
    // 切换清晰度
    switchQuality(url) {
        const currentTime = this.player.currentTime();
        const wasPlaying = !this.player.paused();
        
        this.playVideo(url, 'hls');
        
        // 恢复播放位置
        this.player.one('canplay', () => {
            this.player.currentTime(currentTime);
            if (wasPlaying) {
                this.player.play();
            }
            // 清晰度切换后再次确保字幕附加并显示
            this.addSubtitleTrack();
        });
        
        this.showMessage('正在切换清晰度...', 'info');
    }
    
    // 加载字幕
    async loadSubtitle() {
        if (!this.currentVideoId) return;
        
        try {
            // 这里需要替换为实际的API地址
            const response = await fetch(`http://localhost:8000/api/subtitle/${this.currentVideoId}`);
            
            if (response.ok) {
                const subtitleText = await response.text();
                
                // 转换SRT为WebVTT（如果需要）
                const vttContent = this.convertSRTtoVTT(subtitleText);
                
                // 创建blob URL
                const blob = new Blob([vttContent], { type: 'text/vtt' });
                this.subtitleUrl = URL.createObjectURL(blob);

                // 确保字幕轨道被附加（并在后续源切换中保持）
                this.addSubtitleTrack();
                // 启用按钮并设置文案为“隐藏字幕”（默认显示状态）
                const subtitleBtn = document.getElementById('subtitleToggle');
                subtitleBtn.disabled = false;
                subtitleBtn.textContent = '隐藏字幕';

                this.showMessage('字幕加载成功', 'success');
                setTimeout(() => this.clearMessage(), 2000);
            }
        } catch (error) {
            console.error('字幕加载失败:', error);
            // 不显示错误，因为字幕是可选的
        }
    }

    // 确保字幕轨道已附加并处于显示状态
    addSubtitleTrack() {
        if (!this.player || !this.subtitleUrl) return;

        // 如果已经存在指向相同 src 的字幕轨道，则直接显示
        const tracks = this.player.textTracks();
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind === 'subtitles') {
                // 无法直接读取 remote track 的 src，这里通过标签名匹配并统一开启显示
                track.mode = 'showing';
            }
        }

        // 为避免重复添加：检查是否已有一个标签为“中文字幕”的轨道处于可用状态
        let hasChineseSubtitle = false;
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind === 'subtitles' && (track.label === '中文字幕' || track.srclang === 'zh-CN')) {
                hasChineseSubtitle = true;
                track.mode = 'showing';
            }
        }
        if (hasChineseSubtitle) return;

        // 添加远程字幕轨道
        this.player.addRemoteTextTrack({
            src: this.subtitleUrl,
            kind: 'subtitles',
            srclang: 'zh-CN',
            label: '中文字幕',
            default: true
        }, false);

        // 确保显示
        const newlyAdded = this.player.textTracks();
        for (let i = 0; i < newlyAdded.length; i++) {
            const track = newlyAdded[i];
            if (track.kind === 'subtitles') {
                track.mode = 'showing';
            }
        }
    }
    
    // 转换SRT为WebVTT格式
    convertSRTtoVTT(srtContent) {
        if (srtContent.startsWith('WEBVTT')) {
            return srtContent; // 已经是VTT格式
        }
        
        let vtt = 'WEBVTT\n\n';
        
        // 简单的SRT到VTT转换
        const lines = srtContent.split('\n');
        let inSubtitle = false;
        
        for (let line of lines) {
            line = line.trim();
            
            if (/^\d+$/.test(line)) {
                // 字幕序号，跳过
                continue;
            } else if (/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(line)) {
                // 时间轴，转换逗号为点
                vtt += line.replace(/,/g, '.') + '\n';
                inSubtitle = true;
            } else if (line === '' && inSubtitle) {
                // 空行，结束当前字幕
                vtt += '\n';
                inSubtitle = false;
            } else if (line !== '' && inSubtitle) {
                // 字幕文本
                vtt += line + '\n';
            }
        }
        
        return vtt;
    }
    
    // 切换字幕显示
    toggleSubtitle() {
        const textTracks = this.player.textTracks();
        
        for (let i = 0; i < textTracks.length; i++) {
            const track = textTracks[i];
            if (track.kind === 'subtitles') {
                track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
                const isShowing = track.mode === 'showing';
                
                document.getElementById('subtitleToggle').textContent = 
                    isShowing ? '隐藏字幕' : '显示字幕';
                
                this.showMessage(isShowing ? '字幕已显示' : '字幕已隐藏', 'info');
                setTimeout(() => this.clearMessage(), 1500);
                return;
            }
        }
        
        // 无字幕可用：禁用按钮并保持“显示字幕”文案
        const subtitleBtn = document.getElementById('subtitleToggle');
        subtitleBtn.disabled = true;
        subtitleBtn.textContent = '显示字幕';
    }
    
    // 复制到剪贴板
    async copyToClipboard(text) {
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(text);
            } else {
                // 兼容旧浏览器
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            
            this.showMessage('链接已复制到剪贴板', 'success');
            setTimeout(() => this.clearMessage(), 2000);
        } catch (error) {
            this.showMessage('复制失败，请手动复制', 'error');
        }
    }
    
    // 显示消息
    showMessage(message, type = 'info') {
        const messageEl = document.getElementById('message');
        messageEl.textContent = message;
        messageEl.className = type;
    }
    
    // 清除消息
    clearMessage() {
        const messageEl = document.getElementById('message');
        messageEl.textContent = '';
        messageEl.className = '';
    }
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    new VideoPlayer();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.videoPlayerInstance?.subtitleUrl) {
        URL.revokeObjectURL(window.videoPlayerInstance.subtitleUrl);
    }
}); 