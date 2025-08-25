class VideoPlayer {
    constructor() {
        this.qualities = [];
        this.userToken = '';
        this.currentLikeStatus = { isLiked: false, likesCount: 0 };
        this.currentSubtitleId = '';
        this.currentVideoId = '';
        this.currentVideoUrl = '';
        this.subtitleUrl = '';
        this.wl = {
            list: [],
            cursor: null,
            limit: 10,
            loading: false,
            hasMore: true
        };
        // 社交模式UI状态
        this.uiState = {
            isSocialMode: false,
            activeFeature: null, // 'subcomment', 'userplaza', 'realtimechat'
            isMobile: false
        };
    }

    async refreshAuthUi() {
        const loginBtn = document.getElementById('loginBtn');
        const userAvatar = document.getElementById('userAvatar');
        const subtitleSelectEl = document.getElementById('subtitleSelect');
        const subtitleBtn = document.getElementById('subtitleToggle');
        const logged = this.isLoggedIn();
        loginBtn.style.display = logged ? 'none' : '';
        if (userAvatar) userAvatar.style.display = logged ? '' : 'none';
        
        // 控制心愿单入口显示
        const menuWishlist = document.getElementById('menuWishlist');
        if (menuWishlist) {
            menuWishlist.style.display = logged ? '' : 'none';
        }
        
        if (!logged && REQUIRE_SUBTITLE_LOGIN) {
            this.disableSubtitleUi('登录后可用');
        }
        // 如果已登录，更新用户邮箱显示
        if (logged) {
            await this.updateUserEmail();
        }
    }

    disableSubtitleUi(tip) {
        const subtitleSelectEl = document.getElementById('subtitleSelect');
        const subtitleBtn = document.getElementById('subtitleToggle');
        if (subtitleSelectEl) {
            subtitleSelectEl.style.display = 'inline-block';
            subtitleSelectEl.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = tip || '登录后可用';
            subtitleSelectEl.appendChild(opt);
            subtitleSelectEl.disabled = true;
        }
        if (subtitleBtn) {
            subtitleBtn.disabled = true;
            subtitleBtn.textContent = '显示字幕';
        }
        this.removeAllSubtitleTracks(tip);
    }

    doLogout() {
        try { sessionStorage.removeItem('user_token'); } catch {}
        localStorage.removeItem('user_token');
        this.userToken = '';
        // Reset like state and UI on logout
        this.currentLikeStatus = { isLiked: false, likesCount: 0 };
        this.updateLikeUI();
        
        // 重置心愿单状态
        this.wl = {
            list: [],
            cursor: null,
            limit: 10,
            loading: false,
            hasMore: true
        };
        
        this.removeAllSubtitleTracks('登录后可用');
        this.disableSubtitleUi('登录后可用');
        this.refreshAuthUi();
        this.showMessage('已退出登录');
    }

    // 初始化Video.js播放器
    initVideoJs() {
        // 若同 id 的实例已存在（脚本重复注入或热更），先销毁旧实例
        try {
            const old = (window.videojs && window.videojs.players && window.videojs.players['videoPlayer']) || null;
            if (old && typeof old.dispose === 'function') {
                old.dispose();
            }
            if (this.player && typeof this.player.dispose === 'function') {
                this.player.dispose();
            }
        } catch {}

        const el = document.getElementById('videoPlayer');
        if (!el) { console.error('video element not found'); return; }
        this.player = videojs(el, {
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
                nativeAudioTracks: true,
                nativeVideoTracks: true
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
            // 通过代理检查是否为master playlist（播放无需登录）
            const proxyUrl = `${API_BASE_URL}/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
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
                const proxyUrl = `${API_BASE_URL}/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
                this.playVideo(proxyUrl, 'hls');
            }
        } catch (error) {
            console.error('HLS处理错误:', error);
            // 尝试通过代理直接播放
            const proxyUrl = `${API_BASE_URL}/api/hls?url=${encodeURIComponent(this.currentVideoUrl)}`;
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
                    const proxyUrl = `${API_BASE_URL}/api/hls?url=${encodeURIComponent(originalUrl)}`;
                    
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
        
        // 选择中间清晰度：如果有多个选项，选择中间的；如果只有一个，选择它
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
    
    // 加载字幕变体
    async loadSubtitleVariants() {
        try {
            const baseId = this.extractBaseId(this.currentVideoId);
            const headers = this.isLoggedIn() ? { Authorization: `Bearer ${this.userToken}` } : undefined;
            const resp = await fetch(`${API_BASE_URL}/api/subtitles/variants/${encodeURIComponent(baseId)}`, { headers });
            if (resp.status === 401) {
                this.doLogout();
                this.showMessage('登录已过期，请重新登录', 'error');
                return;
            }
            if (!resp.ok) {
                // 回退为按当前 videoId 加载单一字幕
                await this.loadSubtitleByVideoId(this.currentVideoId);
                return;
            }
            const data = await resp.json();
            this.subtitleVariants = Array.isArray(data.variants) ? data.variants : [];
            
            if (this.subtitleVariants.length === 0) {
                await this.loadSubtitleByVideoId(this.currentVideoId);
                return;
            }
            
            // 选择默认字幕：最近更新项
            const defaultVariant = this.subtitleVariants.reduce((best, cur) => {
                const bu = new Date(best.updated_at || 0).getTime();
                const cu = new Date(cur.updated_at || 0).getTime();
                return cu > bu ? cur : best;
            }, this.subtitleVariants[0]);
            await this.loadSubtitleByVideoId(defaultVariant.video_id);
            this.buildSubtitleSelector(defaultVariant.video_id);
        } catch (e) {
            console.error(e);
            await this.loadSubtitleByVideoId(this.currentVideoId);
        }
    }

    extractBaseId(videoId) {
        const id = String(videoId || '').toUpperCase().trim();
        const m = id.match(/^([A-Z]+-\d{2,5})(?:-(\d+))?$/);
        if (m) return m[1];
        const m2 = id.match(/([A-Z]+-\d{2,5})/);
        return m2 ? m2[1] : id;
    }

    buildSubtitleSelector(activeVideoId) {
        const select = document.getElementById('subtitleSelect');
        if (!select) return;
        select.innerHTML = '';
        this.subtitleVariants.forEach(v => {
            const option = document.createElement('option');
            option.value = v.video_id;
            // 名称：使用后端提供的 video_id（默认版=base；其他=base-n）
            const name = v && v.video_id ? String(v.video_id) : ((Number(v.variant) || 1) === 1 ? this.extractBaseId(this.currentVideoId) : `${this.extractBaseId(this.currentVideoId)}-${v.variant}`);
            const count = Number(v && v.likes_count != null ? v.likes_count : 0);
            option.textContent = `${name}  ❤ ${count}`;
            if (v.video_id === activeVideoId) option.selected = true;
            select.appendChild(option);
        });
        select.style.display = 'inline-block';
        select.disabled = false;
    }

    // 在点赞后局部刷新下拉框中对应项的点赞数显示
    updateSubtitleOptionLikeCount(videoId, newCount) {
        const select = document.getElementById('subtitleSelect');
        if (!select) return;
        const options = Array.from(select.options);
        const idx = options.findIndex(opt => String(opt.value).toUpperCase() === String(videoId).toUpperCase());
        if (idx >= 0) {
            const v = this.subtitleVariants.find(x => String(x.video_id).toUpperCase() === String(videoId).toUpperCase());
            if (v) v.likes_count = Number(newCount) || 0;
            // 重新生成该项的显示文本
            const name = v && v.video_id ? String(v.video_id) : this.extractBaseId(this.currentVideoId);
            const count = Number(v && v.likes_count != null ? v.likes_count : 0);
            options[idx].textContent = `${name}  ❤ ${count}`;
        }
    }

    async switchSubtitleVariant(videoId) {
        if (!videoId) return;
        const currentTime = this.player ? this.player.currentTime() : 0;
        const wasPlaying = this.player && !this.player.paused();
        await this.loadSubtitleByVideoId(videoId);
        // 恢复播放位置与状态（确保无缝）
        this.player.one('canplay', () => {
            this.player.currentTime(currentTime);
            if (wasPlaying) this.player.play();
        });
    }

    // 按 videoId 加载并附加字幕
    async loadSubtitleByVideoId(videoId) {
        try {
            const headers = this.isLoggedIn() ? { Authorization: `Bearer ${this.userToken}` } : undefined;
            const response = await fetch(`${API_BASE_URL}/api/subtitle/${encodeURIComponent(videoId)}`, { headers });
            if (response.status === 401) {
                this.doLogout();
                this.showMessage('登录已过期，请重新登录', 'error');
                return;
            }
            if (response.ok) {
                const subtitleText = await response.text();
                const vttContent = this.convertSRTtoVTT(subtitleText);
                const blob = new Blob([vttContent], { type: 'text/vtt' });
                if (this.subtitleUrl) URL.revokeObjectURL(this.subtitleUrl);
                this.subtitleUrl = URL.createObjectURL(blob);
                this.currentSubtitleId = videoId;
                this.addSubtitleTrack();
                // 启用开关按钮
                const subtitleBtn = document.getElementById('subtitleToggle');
                subtitleBtn.disabled = false;
                subtitleBtn.textContent = '隐藏字幕';
                // 防抖更新点赞状态
                this.debouncedFetchLikeStatus();
                // 更新心愿单当前视频输入框
                this.updateWishlistCurrentInput();
            }
        } catch (e) {
            console.error('加载字幕失败', e);
        }
    }

    // 确保字幕轨道已附加并处于显示状态
    addSubtitleTrack() {
        if (!this.player || !this.subtitleUrl) return;

        // 先移除所有已有字幕轨道，避免重复和旧源残留
        try {
            const existing = Array.from(this.player.textTracks());
            existing.forEach(t => {
                if (t.kind === 'subtitles') {
                    try { this.player.removeRemoteTextTrack(t); } catch {}
                }
            });
        } catch {}

        // 添加新的字幕轨道
        this.player.addRemoteTextTrack({
            src: this.subtitleUrl,
            kind: 'subtitles',
            srclang: 'zh-CN',
            label: '中文字幕',
            default: true
        }, false);

        // 显示字幕
        try {
            const tracks = this.player.textTracks();
            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i];
                if (track.kind === 'subtitles') {
                    track.mode = 'showing';
                }
            }
        } catch {}
    }

    // 新增：移除所有字幕轨道并重置相关状态与UI
    removeAllSubtitleTracks(tip) {
        try {
            if (this.player && this.player.textTracks) {
                const tracks = Array.from(this.player.textTracks());
                tracks.forEach(t => {
                    if (t.kind === 'subtitles') {
                        try { t.mode = 'disabled'; } catch {}
                        try { this.player.removeRemoteTextTrack(t); } catch {}
                    }
                });
            }
        } catch {}
        try {
            if (this.subtitleUrl) {
                URL.revokeObjectURL(this.subtitleUrl);
                this.subtitleUrl = '';
            }
        } catch {}
        this.currentSubtitleId = '';
        this.subtitleVariants = [];
        // 重置UI
        const subtitleBtn = document.getElementById('subtitleToggle');
        if (subtitleBtn) { subtitleBtn.disabled = true; subtitleBtn.textContent = '显示字幕'; }
        const select = document.getElementById('subtitleSelect');
        if (select) {
            select.style.display = 'inline-block';
            select.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = tip || '登录后可用';
            select.appendChild(opt);
            select.disabled = true;
        }
    }

    // 释放资源，防止重复实例与内存泄漏
    destroy() {
        try {
            if (this.subtitleUrl) {
                URL.revokeObjectURL(this.subtitleUrl);
                this.subtitleUrl = '';
            }
        } catch {}
        try {
            if (this.player && typeof this.player.dispose === 'function') {
                this.player.dispose();
                this.player = null;
            }
        } catch {}
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
    
    // 复制到剪贴板（按钮已移除，可整体删除或保留备用）
    async copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                this.showMessage('链接已复制到剪贴板', 'success');
                return;
            }
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showMessage('链接已复制到剪贴板', 'success');
        } catch (error) {
            this.showMessage('复制失败，请手动复制', 'error');
        }
    }
    
    // 显示消息（改为非阻塞Toast，无需确认按钮）
    showMessage(message, type = 'info') {
        if (type === 'loading') return; // 避免频繁弹出
        this.showToast(message, type, 2000);
    }
    
    // 清除消息（不再使用 DOM 区域）
    clearMessage() { /* noop */ }

    // 创建或获取 Toast 容器
    ensureToastContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.bottom = '16px';
            container.style.right = '16px';
            container.style.zIndex = '9999';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '10px';
            container.style.pointerEvents = 'none';
            document.body.appendChild(container);
        }
        return container;
    }

    // 显示一个自动消失的 Toast
    showToast(message, type = 'info', duration = 2000) {
        const container = this.ensureToastContainer();
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.pointerEvents = 'none';
        toast.style.padding = '10px 14px';
        toast.style.borderRadius = '6px';
        toast.style.fontSize = '14px';
        toast.style.color = '#fff';
        toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';

        // 颜色方案
        let bg = 'rgba(0,0,0,0.8)';
        if (type === 'success') bg = 'rgba(16, 185, 129, 0.95)';
        else if (type === 'error') bg = 'rgba(239, 68, 68, 0.95)';
        else if (type === 'info') bg = 'rgba(59, 130, 246, 0.95)';
        toast.style.background = bg;

        container.appendChild(toast);
        // 进入动画
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        // 自动移除
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
            setTimeout(() => {
                try { container.removeChild(toast); } catch {}
            }, 300);
        }, Math.max(1000, duration));
    }
    
    // 设置点赞按钮
    setupLikeButton() {
        const likeBtn = document.getElementById('likeButton');
        const likeCount = document.getElementById('likeCount');
        
        if (!likeBtn || !likeCount) return;
        
        // 绑定点击事件
        likeBtn.addEventListener('click', () => {
            this.toggleLike();
        });
        
        // 初始化点赞状态
        this.fetchLikeStatus();
    }
    
    // 获取点赞状态
    async fetchLikeStatus(silent = true) {
        const activeId = this.currentSubtitleId || this.currentVideoId;
        if (!activeId) return;

        const likeBtn = document.getElementById('likeButton');
        try {
            const base = (API_BASE_URL || (window.PLAYER_CONFIG?.API_BASE_URL || '')).replace(/\/$/, '');
            const headers = this.userToken ? { Authorization: `Bearer ${this.userToken}` } : {};
            const response = await fetch(`${base}/api/subtitles/like-status/${activeId}`, { headers });
            if (response.ok) {
                const data = await response.json();
                this.currentLikeStatus = {
                    isLiked: !!(data.is_liked ?? data.isLiked ?? false),
                    likesCount: Number(data.likes_count ?? data.likesCount ?? 0)
                };
                // 确保展示点赞数
                const likeCountEl = document.getElementById('likeCount');
                if (likeCountEl) likeCountEl.style.display = 'inline';
                this.updateLikeUI();
                // 同步更新下拉框对应项的点赞数
                this.updateSubtitleOptionLikeCount(activeId, this.currentLikeStatus.likesCount);
                // 只有在非静默模式下才显示成功提示
                if (!silent) {
                    this.showMessage(this.currentLikeStatus.isLiked ? window.PLAYER_CONFIG.I18N.like.likeSuccess : window.PLAYER_CONFIG.I18N.like.unlikeSuccess, 'success');
                }
            } else if (response.status === 401) {
                this.showMessage(window.PLAYER_CONFIG.I18N.like.loginExpired, 'error');
            } else {
                this.showMessage(window.PLAYER_CONFIG.I18N.like.operationFailed, 'error');
            }
        } catch (error) {
            console.error('点赞操作失败:', error);
            this.showMessage(window.PLAYER_CONFIG.I18N.like.networkError, 'error');
        } finally {
            if (likeBtn) likeBtn.disabled = false;
        }
    }
    
    // 切换点赞状态
    async toggleLike() {
        const activeId = this.currentSubtitleId || this.currentVideoId;
        if (!activeId) {
            this.showMessage(window.PLAYER_CONFIG.I18N.like.selectVideoFirst, 'error');
            return;
        }
        
        if (!this.userToken) {
            this.showMessage(window.PLAYER_CONFIG.I18N.like.loginRequired, 'error');
            const loginModal = document.getElementById('loginModal');
            if (loginModal) loginModal.style.display = 'flex';
            return;
        }
        
        const likeBtn = document.getElementById('likeButton');
        if (likeBtn) likeBtn.disabled = true;
        
        try {
            const base = (API_BASE_URL || (window.PLAYER_CONFIG?.API_BASE_URL || '')).replace(/\/$/, '');
            const url = `${base}/api/subtitles/like-toggle/${activeId}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentLikeStatus = {
                    isLiked: !!(data.is_liked ?? data.liked ?? false),
                    likesCount: Number(data.likes_count ?? data.likesCount ?? 0)
                };
                // 已登录操作成功，确保展示点赞数
                const likeCountEl = document.getElementById('likeCount');
                if (likeCountEl) likeCountEl.style.display = 'inline';
                this.updateLikeUI();
                // 同步更新下拉框对应项的点赞数
                this.updateSubtitleOptionLikeCount(activeId, this.currentLikeStatus.likesCount);
                this.showMessage(this.currentLikeStatus.isLiked ? window.PLAYER_CONFIG.I18N.like.likeSuccess : window.PLAYER_CONFIG.I18N.like.unlikeSuccess, 'success');
            } else if (response.status === 401) {
                this.showMessage(window.PLAYER_CONFIG.I18N.like.loginExpired, 'error');
            } else {
                this.showMessage(window.PLAYER_CONFIG.I18N.like.operationFailed, 'error');
            }
        } catch (error) {
            console.error('点赞操作失败:', error);
            this.showMessage(window.PLAYER_CONFIG.I18N.like.networkError, 'error');
        } finally {
            if (likeBtn) likeBtn.disabled = false;
        }
    }
    
    // 更新点赞UI
    updateLikeUI() {
        const likeBtn = document.getElementById('likeButton');
        const likeCount = document.getElementById('likeCount');
        const likeSvg = likeBtn?.querySelector('svg');
        
        if (!likeBtn || !likeCount || !likeSvg) return;
        
        // 确保展示点赞数
        likeCount.style.display = 'inline';
        
        // 更新点赞数量（千分位/缩写）
        likeCount.textContent = this.formatLikeCount(this.currentLikeStatus.likesCount);
        
        // 更新点赞状态样式
        if (this.currentLikeStatus.isLiked) {
            likeBtn.classList.add('liked');
            likeSvg.style.fill = '#ff6b6b';
            likeSvg.style.stroke = '#ff6b6b';
        } else {
            likeBtn.classList.remove('liked');
            likeSvg.style.fill = 'none';
            likeSvg.style.stroke = '#666';
        }
    }
    
    // 数字格式化：< 1000 使用千分位；>=1000 使用缩写 1.2k
    formatLikeCount(n) {
        const num = Number(n) || 0;
        if (num >= 1000) {
            const val = (num / 1000).toFixed(1).replace(/\.0$/, '');
            return `${val}k`;
        }
        try { return num.toLocaleString('zh-CN'); } catch { return String(num); }
    }
    
    // 防抖更新点赞状态（字幕切换时调用）
    debouncedFetchLikeStatus() {
        if (this.likeDebounceTimer) {
            clearTimeout(this.likeDebounceTimer);
        }
        
        this.likeDebounceTimer = setTimeout(() => {
            this.fetchLikeStatus();
        }, 300);
    }
    
    // 获取当前激活的视频 ID
    getActiveVideoId() {
        return this.currentSubtitleId || this.currentVideoId || '';
    }
    
    // 更新心愿单当前视频输入框
    updateWishlistCurrentInput() {
        const wlCurrentVideo = document.getElementById('wlCurrentVideo');
        if (wlCurrentVideo) {
            const videoId = this.getActiveVideoId();
            wlCurrentVideo.placeholder = videoId || '无当前视频';
            // 不预填值，保持可编辑
        }
    }
    
    // 渲染心愿单列表
    wlRenderList() {
        const wlList = document.getElementById('wlList');
        if (!wlList) return;
        
        // 修复 UX 问题：加载中时不显示"暂无心愿单"
        if (this.wl.list.length === 0 && !this.wl.loading) {
            wlList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">暂无心愿单</div>';
        } else if (this.wl.loading && this.wl.list.length === 0) {
            wlList.innerHTML = '<div style="text-align:center;color:#666;padding:20px;">加载中...</div>';
        } else {
            // 修复 XSS 风险：转义用户输入 + 显示状态徽标
            wlList.innerHTML = this.wl.list.map(item => {
                const status = (item.status || '').trim();
                const isUpdated = status === '已更新';
                const badgeColor = isUpdated ? '#2e7d32' : '#999';
                const badgeText = status || '未更新';
                return `
                 <div class="wl-item" data-id="${item.id}" style="position:relative;border:1px solid #ddd;margin:8px 0;padding:12px;border-radius:4px;">
                     <div style="font-weight:bold;margin-bottom:4px;">${this.escapeHtml(item.video_id || item.base_video_id)}</div>
                     ${item.note ? `<div style="color:#666;margin-bottom:8px;">${this.escapeHtml(item.note)}</div>` : ''}
                     <div style="font-size:12px;color:#999;">
                         ${new Date(item.created_at).toLocaleString()}
                         <button onclick="window.videoPlayerInstance.wlDelete(${item.id})" style="float:right;background:#ff4444;color:white;border:none;padding:2px 8px;border-radius:3px;cursor:pointer;">删除</button>
                     </div>
                     <span class="wl-status-badge" style="position:absolute;top:8px;right:8px;font-size:12px;color:${badgeColor};">${badgeText}</span>
                 </div>`;
            }).join('');
        }
        
        // 更新心愿单计数文案
        this.updateWishlistCountText();
    }
    
    // 更新心愿单计数文案
    updateWishlistCountText() {
        const countElement = document.getElementById('wlCountText');
        if (!countElement) return;
        
        const count = this.wl.list.length;
        if (count > 0) {
            countElement.textContent = `已有${count}条记录`;
            countElement.style.display = 'block';
        } else {
            countElement.style.display = 'none';
        }
    }
    
    // 加载心愿单列表（一次性加载所有记录）
    async wlLoadList(reset = false) {
        if (this.wl.loading) return;
        if (!this.isLoggedIn()) {
            this.showMessage('请先登录', 'error');
            return;
        }
        
        if (reset) {
            this.wl.list = [];
            this.wl.cursor = null;
            this.wl.hasMore = true;
        }
        
        this.wl.loading = true;
        this.wlRenderList();
        
        try {
            // 循环加载所有分页数据
            let allItems = reset ? [] : [...this.wl.list];
            let currentCursor = reset ? null : this.wl.cursor;
            
            do {
                const params = new URLSearchParams({ limit: this.wl.limit });
                if (currentCursor) params.append('cursor', currentCursor);
                
                const response = await fetch(`${API_BASE_URL}/api/user/wishlists?${params}`, {
                    headers: { Authorization: `Bearer ${this.userToken}` }
                });
                
                if (response.status === 401) {
                    this.doLogout();
                    this.showMessage('登录已过期，请重新登录', 'error');
                    return;
                }
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || '加载失败');
                }
                
                const data = await response.json();
                allItems = [...allItems, ...data.data];
                currentCursor = data.page?.next_cursor || null;
                
            } while (currentCursor);
            
            // 更新状态
            this.wl.list = allItems;
            this.wl.cursor = null;
            this.wl.hasMore = false;
            
        } catch (error) {
            console.error('加载心愿单失败:', error);
            this.showMessage(error.message || '加载心愿单失败', 'error');
        } finally {
            this.wl.loading = false;
            this.wlRenderList();
        }
    }
    
    // 添加到心愿单
    async wlAdd() {
        if (!this.isLoggedIn()) {
            this.showMessage('请先登录', 'error');
            return;
        }
        
        // 检查心愿单数量限制（最多10条）
        if (this.wl.list.length >= 10) {
            this.showMessage('心愿单最多只能添加10条记录', 'error');
            return;
        }
        
        const wlNoteInput = document.getElementById('wlNoteInput');
        const wlError = document.getElementById('wlError');
        const wlAddBtn = document.getElementById('wlAddBtn');
        const wlCurrentVideo = document.getElementById('wlCurrentVideo');
        
        let inputVal = (wlCurrentVideo && wlCurrentVideo.value ? wlCurrentVideo.value.trim() : '');
        const placeholderVal = (wlCurrentVideo && wlCurrentVideo.placeholder ? wlCurrentVideo.placeholder.trim() : '');
        let videoId = inputVal || placeholderVal;
        
        if (!videoId || videoId === '无当前视频') {
            if (wlError) wlError.textContent = '无当前视频';
            return;
        }
        
        // 统一为大写，避免大小写导致的重复或校验问题
        videoId = String(videoId).toUpperCase();
        
        const note = wlNoteInput ? wlNoteInput.value.trim() : '';
        if (note.length > 200) {
            if (wlError) wlError.textContent = '备注不能超过200字符';
            return;
        }
        
        if (wlError) wlError.textContent = '';
        this.setButtonLoading(wlAddBtn, true, '添加中...');
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/user/wishlists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.userToken}`
                },
                body: JSON.stringify({ video_id: videoId, note })
            });
            
            if (response.status === 401) {
                this.doLogout();
                this.showMessage('登录已过期，请重新登录', 'error');
                return;
            }
            
            const responseData = await response.json();
            
            if (!response.ok) {
                // 检查是否为429限流响应
                if (this.handleRateLimitResponse(response, responseData, wlAddBtn, wlError)) {
                    return;
                }
                throw new Error(responseData.error || '添加失败');
            }
            
            this.showMessage('已添加到心愿单');
            if (wlNoteInput) wlNoteInput.value = '';
            if (wlCurrentVideo) wlCurrentVideo.value = '';
            // 重新加载列表
            this.wlLoadList(true);
            
        } catch (error) {
            console.error('添加心愿单失败:', error);
            const message = error.message || '添加失败';
            if (wlError) wlError.textContent = message;
            this.showMessage(message, 'error');
        } finally {
            this.setButtonLoading(wlAddBtn, false, '添加到心愿单');
        }
    }
    
    // 启动心愿单状态轮询
    wlStartPolling() {
        this.wlStopPolling(); // 先停止现有轮询
        this._wlPollingInFlight = false;
        this._wlPollRetryCount = 0;
        this._wlScheduleNextPoll();
    }
    
    // 停止心愿单状态轮询
    wlStopPolling() {
        if (this._wlPollTimer) {
            clearTimeout(this._wlPollTimer);
            this._wlPollTimer = null;
        }
        this._wlPollingInFlight = false;
    }
    
    // 安排下一次轮询
    _wlScheduleNextPoll() {
        if (this._wlPollTimer) return; // 防止重复安排
        
        // 根据重试次数调整间隔：正常10s，出错后退避到30s
        const interval = this._wlPollRetryCount > 0 ? 30000 : 10000;
        
        this._wlPollTimer = setTimeout(() => {
            this._wlPollTimer = null;
            this._wlPollStatusUpdate();
        }, interval);
    }
    
    // 轻量级状态更新（不重绘整个列表）
    async _wlPollStatusUpdate() {
        // 检查弹窗是否仍然打开
        const wishlistModal = document.getElementById('wishlistModal');
        if (!wishlistModal || wishlistModal.style.display === 'none') {
            this.wlStopPolling();
            return;
        }
        
        // 防止并发请求
        if (this._wlPollingInFlight) {
            this._wlScheduleNextPoll();
            return;
        }
        
        // 如果列表为空，直接安排下次轮询
        if (!this.wl.list || this.wl.list.length === 0) {
            this._wlScheduleNextPoll();
            return;
        }
        
        if (!this.isLoggedIn()) {
            this.wlStopPolling();
            return;
        }
        
        this._wlPollingInFlight = true;
        
        try {
            const params = new URLSearchParams({ 
                limit: Math.max(this.wl.list.length, 20) // 至少获取当前已显示的数量
            });
            
            const response = await fetch(`${API_BASE_URL}/api/user/wishlists?${params}`, {
                headers: { Authorization: `Bearer ${this.userToken}` }
            });
            
            if (response.status === 401) {
                this.doLogout();
                this.wlStopPolling();
                return;
            }
            
            if (!response.ok) {
                if (response.status === 429) {
                    // 遇到限流，增加重试计数并退避
                    this._wlPollRetryCount = Math.min(this._wlPollRetryCount + 1, 3);
                } else {
                    throw new Error('Network error');
                }
                this._wlScheduleNextPoll();
                return;
            }
            
            const data = await response.json();
            
            // 重置重试计数
            this._wlPollRetryCount = 0;
            
            // 构建新数据的 Map
            const newDataMap = new Map();
            (data.data || []).forEach(item => {
                newDataMap.set(item.id, item);
            });
            
            // 原地更新状态
            this.wl.list.forEach((item, index) => {
                const newItem = newDataMap.get(item.id);
                if (newItem && newItem.status !== item.status) {
                    // 更新内存中的数据
                    this.wl.list[index].status = newItem.status;
                    this.wl.list[index].updated_at = newItem.updated_at;
                    
                    // 原地更新 DOM
                    const itemElement = document.querySelector(`[data-id="${item.id}"] .wl-status-badge`);
                    if (itemElement) {
                        const status = (newItem.status || '').trim();
                        const isUpdated = status === '已更新';
                        const badgeColor = isUpdated ? '#2e7d32' : '#999';
                        const badgeText = status || '未更新';
                        
                        itemElement.style.color = badgeColor;
                        itemElement.textContent = badgeText;
                    }
                }
            });
            
        } catch (error) {
            console.error('轮询心愿单状态失败:', error);
            this._wlPollRetryCount = Math.min(this._wlPollRetryCount + 1, 3);
        } finally {
            this._wlPollingInFlight = false;
            this._wlScheduleNextPoll();
        }
    }
    
    // 删除心愿单项
    async wlDelete(id) {
        if (!this.isLoggedIn()) {
            this.showMessage('请先登录', 'error');
            return;
        }
        
        if (!confirm('确定要删除这个心愿单项吗？')) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/user/wishlists/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${this.userToken}` }
            });
            
            if (response.status === 401) {
                this.doLogout();
                this.showMessage('登录已过期，请重新登录', 'error');
                return;
            }
            
            const responseData = await response.json();
            
            if (!response.ok) {
                // 修复：为删除操作添加 429 限流错误处理
                if (response.status === 429 && responseData.retry_after) {
                    this.showMessage(`操作过于频繁，请 ${responseData.retry_after} 秒后重试`, 'error');
                    return;
                }
                throw new Error(responseData.error || '删除失败');
            }
            
            this.showMessage('已删除');
            // 重新加载列表
            this.wlLoadList(true);
            
        } catch (error) {
            console.error('删除心愿单失败:', error);
            this.showMessage(error.message || '删除失败', 'error');
        }
    }

    // 社交模式相关方法
    setupSocialMode() {
        // 绑定社交功能按钮事件
        const btnSubComment = document.getElementById('btnSubComment');
        const btnUserPlaza = document.getElementById('btnUserPlaza');
        const btnRealtimeChat = document.getElementById('btnRealtimeChat');
        const closeSocialBtn = document.getElementById('closeSocialBtn');
        const socialMask = document.getElementById('socialMask');

        if (btnSubComment) {
            btnSubComment.addEventListener('click', () => this.toggleSocialFeature('subcomment'));
        }
        if (btnUserPlaza) {
            btnUserPlaza.addEventListener('click', () => this.toggleSocialFeature('userplaza'));
        }
        if (btnRealtimeChat) {
            btnRealtimeChat.addEventListener('click', () => this.toggleSocialFeature('realtimechat'));
        }
        if (closeSocialBtn) {
            closeSocialBtn.addEventListener('click', () => this.closeSocialMode());
        }
        if (socialMask) {
            socialMask.addEventListener('click', () => this.closeSocialMode());
        }

        // ESC键关闭社交模式
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.uiState.isSocialMode) {
                this.closeSocialMode();
            }
        });

        // 窗口大小变化监听
        window.addEventListener('resize', () => {
            this.checkMobileMode();
        });

        // 初始化移动端检测
        this.checkMobileMode();
    }

    checkMobileMode() {
        this.uiState.isMobile = window.innerWidth <= 1024;
    }

    toggleSocialFeature(feature) {
        if (this.uiState.isMobile) {
            this.toggleMobileInlineArea(feature);
        } else {
            this.toggleDesktopSocialMode(feature);
        }
    }

    toggleDesktopSocialMode(feature) {
        const stage = document.querySelector('.stage');
        const socialPanel = document.getElementById('socialPanel');
        const socialMask = document.getElementById('socialMask');
        
        if (this.uiState.isSocialMode && this.uiState.activeFeature === feature) {
            // 关闭当前功能
            this.closeSocialMode();
        } else {
            // 开启或切换功能
            this.uiState.isSocialMode = true;
            this.uiState.activeFeature = feature;
            
            // 检查是否为drawer模式（<1280px）
            const isDrawerMode = window.innerWidth < 1280;
            
            if (isDrawerMode) {
                stage.classList.add('social-drawer-mode');
                socialMask.classList.add('active');
            } else {
                stage.classList.add('social-side-mode');
            }
            
            socialPanel.classList.add('active');
            this.loadSocialContent(feature);
            this.updateSocialButtonsState();
        }
    }

    toggleMobileInlineArea(feature) {
        const mobileInlineArea = document.getElementById('mobileInlineArea');
        
        if (this.uiState.activeFeature === feature && mobileInlineArea.classList.contains('active')) {
            // 关闭当前功能
            this.closeMobileInlineArea();
        } else {
            // 开启或切换功能
            this.uiState.activeFeature = feature;
            mobileInlineArea.classList.add('active');
            this.loadMobileInlineContent(feature);
            this.updateSocialButtonsState();
        }
    }

    closeSocialMode() {
        const stage = document.querySelector('.stage');
        const socialPanel = document.getElementById('socialPanel');
        const socialMask = document.getElementById('socialMask');
        
        this.uiState.isSocialMode = false;
        this.uiState.activeFeature = null;
        
        stage.classList.remove('social-side-mode', 'social-drawer-mode');
        socialPanel.classList.remove('active');
        socialMask.classList.remove('active');
        
        this.updateSocialButtonsState();
    }

    closeMobileInlineArea() {
        const mobileInlineArea = document.getElementById('mobileInlineArea');
        
        this.uiState.activeFeature = null;
        mobileInlineArea.classList.remove('active');
        
        this.updateSocialButtonsState();
    }

    updateSocialButtonsState() {
        const buttons = {
            'subcomment': document.getElementById('btnSubComment'),
            'userplaza': document.getElementById('btnUserPlaza'),
            'realtimechat': document.getElementById('btnRealtimeChat')
        };
        
        Object.keys(buttons).forEach(key => {
            const btn = buttons[key];
            if (btn) {
                if (this.uiState.activeFeature === key) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
    }

    loadSocialContent(feature) {
        const contentArea = document.querySelector('.social-panel-content');
        if (!contentArea) return;
        
        const contentMap = {
            'subcomment': '<div class="placeholder-content"><h3>字幕评论</h3><p>这里将显示字幕相关的评论和讨论内容...</p></div>',
            'userplaza': '<div class="placeholder-content"><h3>用户广场</h3><p>这里将显示用户交流和社区内容...</p></div>',
            'realtimechat': '<div class="placeholder-content"><h3>实时聊天</h3><p>这里将显示实时聊天功能...</p></div>'
        };
        
        contentArea.innerHTML = contentMap[feature] || '';
    }

    loadMobileInlineContent(feature) {
        const contentArea = document.querySelector('.mobile-content-area');
        if (!contentArea) return;
        
        const contentMap = {
            'subcomment': '<div class="mobile-placeholder-content"><h4>字幕评论</h4><p>移动端字幕评论功能...</p></div>',
            'userplaza': '<div class="mobile-placeholder-content"><h4>用户广场</h4><p>移动端用户广场功能...</p></div>',
            'realtimechat': '<div class="mobile-placeholder-content"><h4>实时聊天</h4><p>移动端实时聊天功能...</p></div>'
        };
        
        contentArea.innerHTML = contentMap[feature] || '';
    }
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    // 单例守卫：若已存在实例则先销毁
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
    }
    window.videoPlayerInstance = new VideoPlayer();
    // 初始化社交模式功能
    window.videoPlayerInstance.setupSocialMode();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
        window.videoPlayerInstance = null;
    }
});