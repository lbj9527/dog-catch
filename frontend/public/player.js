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
        
        // 新标签页打开
        document.getElementById('openOriginal').onclick = () => {
            window.open(this.currentVideoUrl, '_blank');
        };
        
        // 字幕开关
        document.getElementById('subtitleToggle').onclick = () => {
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
                    overrideNative: true
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
            // 检查是否为master playlist
            const response = await fetch(this.currentVideoUrl);
            const content = await response.text();
            
            if (this.isMasterPlaylist(content)) {
                // 解析清晰度选项
                this.qualities = this.parseQualities(content);
                this.showQualitySelector();
                
                // 默认选择中等清晰度
                const defaultQuality = this.selectDefaultQuality();
                this.playVideo(defaultQuality.url, 'hls');
            } else {
                // 直接播放
                this.playVideo(this.currentVideoUrl, 'hls');
            }
        } catch (error) {
            console.error('HLS处理错误:', error);
            // 尝试直接播放
            this.playVideo(this.currentVideoUrl, 'hls');
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
                    
                    qualities.push({
                        resolution: resolution || `${Math.round(bandwidth / 1000)}k`,
                        url: new URL(nextLine, this.currentVideoUrl).href,
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
        select.innerHTML = '<option value="">选择清晰度</option>';
        
        this.qualities.forEach(quality => {
            const option = document.createElement('option');
            option.value = quality.url;
            option.textContent = quality.resolution;
            select.appendChild(option);
        });
        
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
                
                // 添加字幕轨道
                this.player.addRemoteTextTrack({
                    src: this.subtitleUrl,
                    kind: 'subtitles',
                    srclang: 'zh-CN',
                    label: '中文字幕',
                    default: true
                }, false);
                
                this.showMessage('字幕加载成功', 'success');
                setTimeout(() => this.clearMessage(), 2000);
            }
        } catch (error) {
            console.error('字幕加载失败:', error);
            // 不显示错误，因为字幕是可选的
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
        
        this.showMessage('未找到字幕文件', 'info');
        setTimeout(() => this.clearMessage(), 1500);
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