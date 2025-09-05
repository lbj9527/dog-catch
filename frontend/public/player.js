// 播放器主逻辑
import { SocialPanel } from './socialPanel.js';

const API_BASE_URL = new URLSearchParams(location.search).get('api') || (window.PLAYER_CONFIG && window.PLAYER_CONFIG.API_BASE_URL) || 'https://api.sub-dog.top';
const REQUIRE_SUBTITLE_LOGIN = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.SUBTITLE_NEED_LOGIN) !== false;
const ALLOW_PLAY_WITHOUT_LOGIN = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.ALLOW_PLAY_WITHOUT_LOGIN) !== false;
const CAPTCHA_SITE_KEY = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.CAPTCHA_SITE_KEY) || '10000000-ffff-ffff-ffff-000000000001';
const ENABLE_CAPTCHA = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.CAPTCHA_ENABLED) === true;

// 图片上传数量限制常量
const MAX_IMAGES = 5;
class VideoPlayer {
    constructor() {
        this.player = null;
        this.currentVideoUrl = '';
        this.currentVideoId = '';
        this.qualities = [];
        this.subtitleUrl = '';
        this.subtitleVariants = [];
        this.currentSubtitleId = '';
        this.userToken = (sessionStorage.getItem('user_token') || localStorage.getItem('user_token') || '');
        this.hcaptchaWidgetId = null;
        
        // 点赞相关属性
        this.currentLikeStatus = { isLiked: false, likesCount: 0 };
        this.likeDebounceTimer = null;
        
        // 心愿单相关状态
        this.wl = {
            list: [],
            cursor: null,
            limit: 10,
            loading: false,
            hasMore: true
        };
        
        // 社交模式相关状态
        this.socialState = {
            isMobile: false,
            isSocialMode: false,
            activeFeature: null, // 'subtitle-comment' | 'user-plaza' | 'realtime-chat'
            isDrawerMode: false
        };
        
        // 回复模式状态管理
        this.replyingToCommentId = null;
        this.replyingToUser = null;
        
        // 楼中楼回复状态管理
        this.repliesCache = new Map(); // key: commentId, value: {items: [], page, totalPages, total}
        
        // 通知系统相关状态
        this.notificationState = {
            unreadCount: 0,
            isPolling: false,
            pollInterval: null,
            notifications: [],
            currentPage: 1,
            hasMore: true,
            loading: false
        };
        this.repliesExpanded = new Set(); // 已展开的评论ID集合
        
        // 新增：社交面板实例
        this.socialPanel = new SocialPanel({
            onClose: () => this.closeSocialMode(),
            getIsMobile: () => this.socialState.isMobile,
            stageSelector: '.stage',
            playerBoxSelector: '.player-box',
            buttonsContainerSelector: '.like-controls'
        });
        
        this.init();
    }

    // XSS 防护：转义 HTML 特殊字符
    escapeHtml(text) {
        if (typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 打开Lightbox预览
    openLightbox(currentUrl, allUrls, currentIndex) {
        // 创建Lightbox容器
        const lightbox = document.createElement('div');
        lightbox.className = 'lightbox-overlay';
        lightbox.innerHTML = `
            <div class="lightbox-container">
                <button class="lightbox-close">&times;</button>
                <button class="lightbox-prev" ${allUrls.length <= 1 ? 'style="display:none"' : ''}>&lt;</button>
                <img class="lightbox-image" src="${currentUrl}" alt="预览图片" />
                <button class="lightbox-next" ${allUrls.length <= 1 ? 'style="display:none"' : ''}>&gt;</button>
                <div class="lightbox-counter" ${allUrls.length <= 1 ? 'style="display:none"' : ''}>${currentIndex + 1} / ${allUrls.length}</div>
            </div>
        `;
        
        document.body.appendChild(lightbox);
        
        let currentIdx = currentIndex;
        const img = lightbox.querySelector('.lightbox-image');
        const counter = lightbox.querySelector('.lightbox-counter');
        
        // 更新图片和计数器
        const updateImage = (index) => {
            img.src = allUrls[index];
            if (counter) counter.textContent = `${index + 1} / ${allUrls.length}`;
            currentIdx = index;
        };
        
        // 关闭Lightbox
        const closeLightbox = () => {
            document.body.removeChild(lightbox);
        };
        
        // 事件监听
        lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
        
        if (allUrls.length > 1) {
            lightbox.querySelector('.lightbox-prev').addEventListener('click', () => {
                const newIndex = currentIdx > 0 ? currentIdx - 1 : allUrls.length - 1;
                updateImage(newIndex);
            });
            
            lightbox.querySelector('.lightbox-next').addEventListener('click', () => {
                const newIndex = currentIdx < allUrls.length - 1 ? currentIdx + 1 : 0;
                updateImage(newIndex);
            });
        }
        
        // 键盘事件
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                closeLightbox();
                document.removeEventListener('keydown', handleKeydown);
            } else if (allUrls.length > 1) {
                if (e.key === 'ArrowLeft') {
                    const newIndex = currentIdx > 0 ? currentIdx - 1 : allUrls.length - 1;
                    updateImage(newIndex);
                } else if (e.key === 'ArrowRight') {
                    const newIndex = currentIdx < allUrls.length - 1 ? currentIdx + 1 : 0;
                    updateImage(newIndex);
                }
            }
        };
        
        document.addEventListener('keydown', handleKeydown);
    }

    async updateUserEmail() {
        const userEmailDisplay = document.getElementById('userEmailDisplay');
        if (userEmailDisplay) {
            try {
                const email = await this.getUserEmailFromAPI();
                userEmailDisplay.textContent = email || 'user@example.com';
            } catch (error) {
                console.error('获取用户邮箱失败:', error);
                userEmailDisplay.textContent = 'user@example.com';
            }
        }
    }

    async getUserEmailFromAPI() {
        try {
            if (!this.userToken) return null;
            
            const response = await fetch(`${API_BASE_URL}/api/user/verify`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                return data.user?.email;
            } else {
                console.error('获取用户信息失败:', response.status);
                return null;
            }
        } catch (error) {
            console.error('API请求失败:', error);
            return null;
        }
    }
    
    // 初始化 hCaptcha（invisible）
    initCaptcha() {
        try {
            if (!ENABLE_CAPTCHA) return;
            if (!window.hcaptcha) return;
            const container = document.getElementById('hcap') || (() => { const d=document.createElement('div'); d.id='hcap'; d.style.display='none'; document.body.appendChild(d); return d; })();
            if (this.hcaptchaWidgetId === null) {
                this.hcaptchaWidgetId = window.hcaptcha.render(container, { sitekey: CAPTCHA_SITE_KEY, size: 'invisible' });
            }
        } catch {}
    }

    async getCaptchaTokenIfAvailable() {
        try {
            if (!ENABLE_CAPTCHA) return '';
            if (!window.hcaptcha) return '';
            if (this.hcaptchaWidgetId === null) this.initCaptcha();
            if (typeof window.hcaptcha.execute !== 'function') return '';
            await window.hcaptcha.execute(this.hcaptchaWidgetId);
            const token = window.hcaptcha.getResponse(this.hcaptchaWidgetId) || '';
            try { window.hcaptcha.reset(this.hcaptchaWidgetId); } catch {}
            return token;
        } catch { return ''; }
    }

    // 处理429限流响应的统一方法
    handleRateLimitResponse(response, responseData, buttonElement, errorElement) {
        if (response.status !== 429) return false;
        
        const retryAfter = parseInt(response.headers.get('Retry-After')) || 
                          (responseData && responseData.retry_after) || 30;
        const scope = responseData && responseData.scope || 'request';
        
        // 显示限流错误信息
        const message = responseData && responseData.error || 
                       `请求过于频繁，请等待 ${retryAfter} 秒后重试`;
        if (errorElement) errorElement.textContent = message;
        this.showMessage(message, 'error');
        
        // 禁用按钮并开始倒计时
        if (buttonElement) {
            this.startRateLimitCountdown(buttonElement, retryAfter);
        }
        
        return true;
    }
    
    // 限流倒计时功能
    startRateLimitCountdown(buttonElement, seconds) {
        if (!buttonElement) return;
        
        const originalText = buttonElement.textContent;
        buttonElement.disabled = true;
        
        let remaining = seconds;
        const updateButton = () => {
            if (remaining > 0) {
                buttonElement.textContent = `请等待 ${remaining} 秒`;
                remaining--;
                setTimeout(updateButton, 1000);
            } else {
                buttonElement.textContent = originalText;
                buttonElement.disabled = false;
            }
        };
        
        updateButton();
    }
    
    // 初始化播放器
    async init() {
        // 解析URL参数
        const params = this.parseUrlParams();
        if (!params.src) {
            this.showMessage('缺少视频源参数', 'error');
            return;
        }
        
        this.currentVideoUrl = params.src;
        this.currentVideoId = params.video || '';
        
        // 设置页面标题
        const title = params.title || 'Subtitle Dog';
        document.getElementById('title').textContent = title;
        document.title = title;
        
        // 设置按钮事件
        this.setupControls();
        this.setupAuthUi();
        // 初始化社交模式
        this.initSocialMode();
        // 初始化 hCaptcha（懒加载执行）
        this.initCaptcha();
        // 先校验 token，确保 UI 与权限同步
        await this.verifyTokenAndSyncUI();
        await this.refreshAuthUi();
        
        // 初始化Video.js播放器
        this.initVideoJs();
        
        // 处理视频源（播放不需要登录）
        if (params.type === 'hls' || this.currentVideoUrl.includes('.m3u8')) {
            this.handleHLSVideo();
        } else {
            this.handleMP4Video();
        }
        
        // 加载字幕（仅登录后尝试）
        if (this.currentVideoId) {
            if (!REQUIRE_SUBTITLE_LOGIN || this.isLoggedIn()) {
                this.loadSubtitleVariants();
            } else {
                this.disableSubtitleUi('登录后可用');
            }
        }
        
        // 初始化自适应播放器尺寸
        this.initAdaptivePlayerSize();
    }
    
    isLoggedIn() { return !!this.userToken; }
    
    // 自适应播放器尺寸相关方法
    initAdaptivePlayerSize() {
        // 初始测量和设置
        this.updatePlayerSize();
        
        // 监听窗口大小变化
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                this.updatePlayerSize();
            }, 100); // 防抖100ms
        });
    }
    
    updatePlayerSize() {
        const playerBox = document.querySelector('.player-box');
        const likeControls = document.querySelector('.like-controls');
        const stage = document.querySelector('.stage');
        
        if (!playerBox) return;
        
        // 测量播放器顶部距离
        const playerRect = playerBox.getBoundingClientRect();
        const minTopReserve = 60;
        const topReserve = Math.max(playerRect.top, minTopReserve);
        
        // 测量点赞按钮高度
        let likeHeight = 40;
        if (likeControls) {
            const likeRect = likeControls.getBoundingClientRect();
            likeHeight = likeRect.height || 40;
        }
        
        const viewportHeight = window.innerHeight;
        const isDesktopParallel = !!stage && stage.classList.contains('parallel-mode') && window.innerWidth >= 1025;
        
        if (isDesktopParallel) {
            // 并排模式：高度主导策略
            // 1. 计算可用高度（为点赞按钮预留空间）
            const likeAreaHeight = likeHeight + 20; // 点赞区 + 间距
            const availableHeight = viewportHeight - topReserve - likeAreaHeight - 20; // 额外20px缓冲
            const minPlayerHeight = 200;
            
            // 2. 播放器高度：尽可能占满可用高度
            const targetHeight = Math.max(minPlayerHeight, availableHeight);
            
            // 3. 按16:9推导宽度
            const targetWidth = targetHeight * (16 / 9);
            
            // 4. 检查宽度是否超出左侧可用空间
            const stageWidth = stage.getBoundingClientRect().width;
            const maxLeftWidth = stageWidth - 600 - 16; // 减去右侧面板宽度和间距
            
            let finalHeight, finalWidth;
            if (targetWidth <= maxLeftWidth) {
                // 宽度未超限，使用高度主导的结果
                finalHeight = targetHeight;
                finalWidth = targetWidth;
            } else {
                // 宽度超限，改为宽度主导
                finalWidth = maxLeftWidth;
                finalHeight = finalWidth * (9 / 16);
            }
            
            // 5. 设置CSS变量
            playerBox.style.setProperty('--player-reserve-top', `${topReserve}px`);
            playerBox.style.setProperty('--player-reserve-bottom', `${likeAreaHeight}px`);
            playerBox.style.setProperty('--player-max-h', `${finalHeight}px`);
            
            // 6. 如果采用了宽度主导，需要额外设置宽度约束
            if (targetWidth > maxLeftWidth) {
                playerBox.style.setProperty('--player-max-w', `${finalWidth}px`);
            } else {
                playerBox.style.removeProperty('--player-max-w');
            }
            
        } else {
            // 非并排模式：保持原有逻辑
            let bottomReserve = 60;
            if (likeControls) {
                const likeRect = likeControls.getBoundingClientRect();
                const likeHeight = likeRect.height || 40;
                bottomReserve = Math.max(likeHeight + 20, 60);
            }
            
            const availableHeight = viewportHeight - topReserve - bottomReserve;
            const minPlayerHeight = 200;
            
            if (availableHeight < minPlayerHeight) {
                bottomReserve = Math.max(viewportHeight - topReserve - minPlayerHeight, 40);
            }
            
            playerBox.style.setProperty('--player-reserve-top', `${topReserve}px`);
            playerBox.style.setProperty('--player-reserve-bottom', `${bottomReserve}px`);
            playerBox.style.removeProperty('--player-max-w'); // 清除宽度约束
            playerBox.style.removeProperty('--player-max-h'); // 清除高度约束，避免并排模式残留
            
            // 检查点赞按钮可见性
            if (likeControls) {
                setTimeout(() => {
                    const updatedLikeRect = likeControls.getBoundingClientRect();
                    const isLikeVisible = updatedLikeRect.bottom <= viewportHeight && updatedLikeRect.top >= 0;
                    
                    if (!isLikeVisible && updatedLikeRect.bottom > viewportHeight) {
                        const overflow = updatedLikeRect.bottom - viewportHeight;
                        const newBottomReserve = bottomReserve + overflow + 10;
                        playerBox.style.setProperty('--player-reserve-bottom', `${newBottomReserve}px`);
                    }
                }, 50);
            }
        }
    }

    async accountExists(identifier) {
        try {
            const token = await this.getCaptchaTokenIfAvailable();
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['x-captcha-token'] = token;
            const r = await fetch(`${API_BASE_URL}/api/user/exist`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ identifier, captchaToken: token })
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || '检查失败');
            return !!j.exists;
        } catch (e) {
            return false;
        }
    }

    // 新增：运行时校验当前 token 是否有效
    async verifyTokenAndSyncUI() {
        if (!this.isLoggedIn()) return;
        try {
            const r = await fetch(`${API_BASE_URL}/api/user/verify`, { headers: { Authorization: `Bearer ${this.userToken}` } });
            if (!r.ok) throw new Error('unauthorized');
        } catch (_) {
            this.doLogout();
            this.showMessage('登录已过期，请重新登录', 'error');
        }
    }

    // 按钮加载状态管理
    setButtonLoading(buttonEl, on, text = '请稍后…') {
        if (!buttonEl) return;
        if (on) {
            if (!buttonEl.dataset.originalText) buttonEl.dataset.originalText = buttonEl.textContent || '';
            buttonEl.textContent = text;
            buttonEl.disabled = true;
            buttonEl.classList.add('btn-loading');
        } else {
            buttonEl.disabled = false;
            buttonEl.classList.remove('btn-loading');
            const orig = buttonEl.dataset.originalText;
            if (typeof orig !== 'undefined') { 
                buttonEl.textContent = orig; 
                delete buttonEl.dataset.originalText; 
            }
        }
    }

    // 表单加载状态管理（同时控制按钮和输入框）
    setFormLoading(formSelector, on, buttonText = '请稍后…') {
        const form = document.querySelector(formSelector);
        if (!form) return;
        
        const inputs = form.querySelectorAll('input[type="email"], input[type="password"], input[type="text"]');
        const buttons = form.querySelectorAll('button');
        
        inputs.forEach(input => {
            input.disabled = on;
        });
        
        buttons.forEach(button => {
            this.setButtonLoading(button, on, buttonText);
        });
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
        // 复制链接（已移除按钮，无需绑定）
        
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
        
        // 字幕选择（样式与清晰度一致）
        const subtitleSelectEl = document.getElementById('subtitleSelect');
        if (subtitleSelectEl) {
            subtitleSelectEl.onchange = (e) => {
                const videoId = e.target.value;
                if (videoId) {
                    this.switchSubtitleVariant(videoId);
                }
            };
        }
        
        // 点赞按钮
        this.setupLikeButton();
        
        // 设置fallback链接
        document.getElementById('fallbackLink').href = this.currentVideoUrl;
    }

    setupAuthUi() {
        const loginBtn = document.getElementById('loginBtn');
        const userAvatar = document.getElementById('userAvatar');
        const userMenu = document.getElementById('userMenu');
        const menuLogout = document.getElementById('menuLogout');
        const menuDeleteAccount = document.getElementById('menuDeleteAccount');
        const menuSettings = document.getElementById('menuSettings');
        const settingsModal = document.getElementById('settingsModal');
        const settingsClose = document.getElementById('settingsClose');
        
        // 心愿单相关元素
        const menuWishlist = document.getElementById('menuWishlist');
        const wishlistModal = document.getElementById('wishlistModal');
        const wishlistClose = document.getElementById('wishlistClose');
        const wlAddBtn = document.getElementById('wlAddBtn');
        const wlLoadMoreBtn = document.getElementById('wlLoadMoreBtn');
        const wlNoteInput = document.getElementById('wlNoteInput');
        const wlCurrentVideo = document.getElementById('wlCurrentVideo');
        const wlError = document.getElementById('wlError');
        const wlList = document.getElementById('wlList');

        // whoModal 已移除

        const loginModal = document.getElementById('loginModal');
        const loginClose = document.getElementById('loginClose');
        const loginPassword = document.getElementById('loginPassword');
        const loginEmail = document.getElementById('loginEmail');
        const btnDoLogin = document.getElementById('btnDoLogin');
        const gotoRegister = document.getElementById('gotoRegister');
        const gotoReset = document.getElementById('gotoReset');
        const loginError = document.getElementById('loginError');

        const regModal = document.getElementById('registerModal');
        const regClose = document.getElementById('regClose');
        const regUsername = document.getElementById('regUsername');
        const regEmail = document.getElementById('regEmail');
        const regPassword = document.getElementById('regPassword');
        const regCode = document.getElementById('regCode');
        const btnSendRegCode = document.getElementById('btnSendRegCode');
        const gotoLogin = document.getElementById('gotoLogin');
        const gotoLogin2 = document.getElementById('gotoLogin2');
        const btnStartRegister = document.getElementById('btnStartRegister');
        const btnConfirmRegister = document.getElementById('btnConfirmRegister');
        const regError = document.getElementById('regError');
        const regCodeRow = document.getElementById('regCodeRow');
        const regStep1Buttons = document.getElementById('regStep1Buttons');
        const regStep2Buttons = document.getElementById('regStep2Buttons');

        // 主按钮：直接打开登录
        loginBtn.onclick = () => { if (!this.isLoggedIn()) { loginModal.style.display='flex'; if (loginError) loginError.textContent=''; } };
        
        // 用户头像点击事件
        if (userAvatar) {
            userAvatar.onclick = (e) => {
                e.stopPropagation();
                if (userMenu) {
                    userMenu.style.display = userMenu.style.display === 'none' || !userMenu.style.display ? 'block' : 'none';
                }
            };
        }
        
        // 用户菜单项点击事件
        if (menuLogout) {
            menuLogout.onclick = async () => {
                if (userMenu) userMenu.style.display = 'none';
                this.doLogout();
                await this.refreshAuthUi();
            };
        }
        
        if (menuDeleteAccount) {
            menuDeleteAccount.onclick = async () => {
                if (userMenu) userMenu.style.display = 'none';
                if (!this.isLoggedIn()) return;
                if (!confirm('确定要注销当前账号吗？此操作不可恢复')) return;
                try {
                    const r = await fetch(`${API_BASE_URL}/api/user/me`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${this.userToken}` } });
                    const j = await r.json();
                    if (!r.ok) throw new Error(j.error || '注销失败');
                    this.doLogout();
                    this.showMessage('账号已注销');
                } catch (e) { this.showMessage(e.message || '注销失败', 'error'); }
            };
        }
        
        // 设置菜单项点击事件
        if (menuSettings) {
            menuSettings.onclick = () => {
                if (userMenu) userMenu.style.display = 'none';
                if (settingsModal) settingsModal.style.display = 'flex';
            };
        }
        
        // 设置弹窗关闭事件
        if (settingsClose) {
            settingsClose.onclick = () => {
                if (settingsModal) settingsModal.style.display = 'none';
            };
        }
        
        // 点击设置弹窗外部关闭
        if (settingsModal) {
            settingsModal.onclick = (e) => {
                if (e.target === settingsModal) {
                    settingsModal.style.display = 'none';
                }
            };
        }
        

        
        // 心愿单菜单项点击事件
        if (menuWishlist) {
            menuWishlist.onclick = () => {
                if (userMenu) userMenu.style.display = 'none';
                if (wishlistModal) {
                    // 修复：打开弹窗时清理输入框和错误提示
                    const wlNoteInput = document.getElementById('wlNoteInput');
                    const wlError = document.getElementById('wlError');
                    const wlCurrentVideo = document.getElementById('wlCurrentVideo');
                    if (wlNoteInput) wlNoteInput.value = '';
                    if (wlError) wlError.textContent = '';
                    if (wlCurrentVideo) wlCurrentVideo.value = '';
                    
                    wishlistModal.style.display = 'flex';
                    document.body.classList.add('modal-open');
                    this.updateWishlistCurrentInput();
                    this.wlLoadList(true);
                    
                    // 启动轻量级轮询以同步后台状态更新
                     this.wlStartPolling();
                }
            };
        }
        
        // 心愿单弹窗关闭事件
        if (wishlistClose) {
            wishlistClose.onclick = () => {
                if (wishlistModal) {
                    wishlistModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                }
                this.wlStopPolling();
            };
        }
        
        // 点击心愿单弹窗外部关闭
        if (wishlistModal) {
            wishlistModal.onclick = (e) => {
                if (e.target === wishlistModal) {
                    wishlistModal.style.display = 'none';
                    document.body.classList.remove('modal-open');
                    this.wlStopPolling();
                }
            };
        }
        
        // 心愿单弹窗关闭按钮
        if (wishlistClose) {
            wishlistClose.onclick = () => {
                wishlistModal.style.display = 'none';
                document.body.classList.remove('modal-open');
                this.wlStopPolling();
            };
        }
        
        // 添加到心愿单按钮事件
        if (wlAddBtn) {
            wlAddBtn.onclick = () => this.wlAdd();
        }
        
        // 加载更多按钮事件
        if (wlLoadMoreBtn) {
            wlLoadMoreBtn.onclick = () => this.wlLoadList(false);
        }
        
        // 通知铃铛点击事件
        const notificationBell = document.getElementById('notificationBell');
        if (notificationBell) {
            notificationBell.onclick = (e) => {
                e.stopPropagation();
                this.showNotificationPanel();
            };
        }
        
        // 通知面板相关事件
        this.setupNotificationEvents();
        
        // 点击页面其他地方关闭用户菜单
        document.addEventListener('click', (e) => {
            if (userMenu && !userAvatar.contains(e.target) && !userMenu.contains(e.target)) {
                userMenu.style.display = 'none';
            }
        });

        // who 流程已移除

        // 登录弹窗
        loginClose.onclick = () => { loginModal.style.display='none'; if (loginError) loginError.textContent=''; };
        btnDoLogin.onclick = async () => {
            // 立即开启加载状态：禁用按钮与输入框，按钮显示请稍后
            this.setFormLoading('#loginModal .form', true, '请稍后…');
            
            try {
                const email = (loginEmail.value || '').trim();
                const password = loginPassword.value;
                const remember = !!document.getElementById('loginRemember')?.checked;
                
                // 前端校验（在加载状态开启后）
                if (!email || !password) {
                    throw new Error('请输入邮箱和密码');
                }
                
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/login/password`, { method:'POST', headers, body: JSON.stringify({ email, password, captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnDoLogin, loginError)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '登录失败');
                }
                this.userToken = j.token || '';
                if (this.userToken) {
                    if (remember) {
                        localStorage.setItem('user_token', this.userToken);
                        try { sessionStorage.removeItem('user_token'); } catch {}
                    } else {
                        try { sessionStorage.setItem('user_token', this.userToken); } catch {}
                        localStorage.removeItem('user_token');
                    }
                }
                this.showMessage('登录成功');
                loginModal.style.display='none';
                if (loginError) loginError.textContent='';
                await this.refreshAuthUi();
                // 登录成功后：刷新社交按钮状态并重新拉取点赞状态
                if (typeof this.updateSocialButtonsState === 'function') {
                    this.updateSocialButtonsState();
                }
                if (typeof this.debouncedFetchLikeStatus === 'function') {
                    this.debouncedFetchLikeStatus();
                } else if (typeof this.fetchLikeStatus === 'function') {
                    this.fetchLikeStatus(true);
                }
                if (this.currentVideoId) this.loadSubtitleVariants();
            } catch (e) {
                const msg = e && e.message ? e.message : '登录失败';
                if (loginError) loginError.textContent = msg;
                this.showMessage(msg, 'error');
            } finally {
                // 恢复表单状态
                this.setFormLoading('#loginModal .form', false);
            }
        };
        gotoRegister.onclick = () => { loginModal.style.display='none'; if (loginError) loginError.textContent=''; regModal.style.display='flex'; };
        if (gotoReset) gotoReset.onclick = () => {
            if (loginError) loginError.textContent='';
            loginModal.style.display='none';
            const resetModal = document.getElementById('resetModal');
            const resetCodeRow = document.getElementById('resetCodeRow');
            const resetPwdRow = document.getElementById('resetPwdRow');
            const resetSubmitRow = document.getElementById('resetSubmitRow');
            // 直接展示完整步骤：验证码、新密码与提交
            if (resetCodeRow) resetCodeRow.style.display='';
            if (resetPwdRow) resetPwdRow.style.display='';
            if (resetSubmitRow) resetSubmitRow.style.display='';
            resetModal.style.display='flex';
        };

        // 注册弹窗
        regClose.onclick = () => { regModal.style.display='none'; };
        btnSendRegCode.onclick = async () => {
            const email = (regEmail.value || '').trim();
            if (!email) return this.showMessage('请输入邮箱', 'error');
            try {
                const exists = await this.accountExists(email);
                if (exists) {
                    this.showMessage('该邮箱已注册，请直接登录', 'error');
                    return;
                }
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/email-code`, { method:'POST', headers, body: JSON.stringify({ email, purpose:'register', captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnSendRegCode, null)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '发送失败');
                }
                this.showMessage('验证码已发送');
                // 点击“重新发送”后立即进入倒计时
                if (typeof startCountdown === 'function') startCountdown(btnSendRegCode, 60);
            } catch (e) { this.showMessage(e.message || '发送失败', 'error'); }
        };
        // 注册 Step1：请求验证码并显示 Step2
        btnStartRegister.onclick = async () => {
            if (regError) regError.textContent = '';
            const username = (regUsername.value || '').trim();
            const email = (regEmail.value || '').trim();
            const password = regPassword.value;
            if (!username || !email || !password) { if (regError) regError.textContent = '请完整填写昵称、邮箱与密码'; return; }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (regError) regError.textContent = '邮箱格式不正确'; return; }
            if (password.length < 6) { if (regError) regError.textContent = '密码长度至少6位'; return; }
            try {
                // 串行查重（避免并发执行 invisible hCaptcha 导致 token 冲突）
                const emailExists = await this.accountExists(email);
                if (emailExists) { if (regError) regError.textContent = '该邮箱已注册，请直接登录'; return; }
                const usernameExists = await this.accountExists(username);
                if (usernameExists) { if (regError) regError.textContent = '该昵称已被占用，请更换'; return; }

                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/email-code`, { method:'POST', headers, body: JSON.stringify({ email, purpose:'register', captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnStartRegister, regError)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '验证码发送失败');
                }
                this.showMessage('验证码已发送');
                // 与点击“获取验证码”一致：自动开始倒计时（本地实现，避免依赖稍后定义的函数表达式）
                if (btnSendRegCode) {
                    const i18n = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.I18N) || {};
                    const renderSent = typeof i18n.sentWithCountdown === 'function' ? i18n.sentWithCountdown : (s)=>`已发送(${s}s)`;
                    const renderResend = i18n.resendAfter || '重新发送';
                    let remain = 60;
                    btnSendRegCode.disabled = true;
                    btnSendRegCode.textContent = renderSent(remain);
                    const t = setInterval(() => {
                        remain -= 1;
                        if (remain <= 0) {
                            clearInterval(t);
                            btnSendRegCode.disabled = false;
                            btnSendRegCode.textContent = renderResend;
                            return;
                        }
                        btnSendRegCode.textContent = renderSent(remain);
                    }, 1000);
                }
                // 显示 Step2
                regCodeRow.style.display = '';
                regStep1Buttons.style.display = 'none';
                regStep2Buttons.style.display = '';
            } catch (e) {
                if (regError) regError.textContent = e && e.message ? e.message : '验证码发送失败';
            }
        };

        // 注册 Step2：提交注册
        btnConfirmRegister.onclick = async () => {
            if (regError) regError.textContent = '';
            const username = (regUsername.value || '').trim();
            const email = (regEmail.value || '').trim();
            const password = regPassword.value;
            const code = (regCode.value || '').trim();
            if (!username || !email || !password || !code) { if (regError) regError.textContent = '请填写完整信息与验证码'; return; }
            try {
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/register`, { method:'POST', headers, body: JSON.stringify({ username, email, password, code, captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnConfirmRegister, regError)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '注册失败');
                }
                this.showMessage('注册成功，请登录');
                regModal.style.display='none';
                // 打开登录并预填邮箱
                loginModal.style.display = 'flex';
                if (loginError) loginError.textContent = '';
                loginEmail.value = email;
                try { loginPassword.value = ''; } catch {}
            } catch (e) {
                if (regError) regError.textContent = e && e.message ? e.message : '注册失败';
            }
        };
        gotoLogin.onclick = () => { regModal.style.display='none'; loginModal.style.display='flex'; if (loginError) loginError.textContent=''; };
        if (gotoLogin2) gotoLogin2.onclick = () => { regModal.style.display='none'; loginModal.style.display='flex'; if (loginError) loginError.textContent=''; };

        // 忘记密码弹窗绑定
        const resetModal = document.getElementById('resetModal');
        const resetClose = document.getElementById('resetClose');
        const resetEmail = document.getElementById('resetEmail');
        const resetCodeRow = document.getElementById('resetCodeRow');
        const resetPwdRow = document.getElementById('resetPwdRow');
        const resetSubmitRow = document.getElementById('resetSubmitRow');
        const resetNextRow = document.getElementById('resetNextRow');
        const btnResetNext = document.getElementById('btnResetNext');
        const btnSendResetCode = document.getElementById('btnSendResetCode');
        const btnConfirmReset = document.getElementById('btnConfirmReset');
        const resetError = document.getElementById('resetError');
        const resetGotoLogin = document.getElementById('resetGotoLogin');

        if (resetClose) resetClose.onclick = () => { 
            resetModal.style.display='none'; 
            if (resetError) resetError.textContent=''; 
            // 返回登录弹窗
            loginModal.style.display='flex';
            if (loginError) loginError.textContent='';
        };
        if (resetGotoLogin) resetGotoLogin.onclick = () => { resetModal.style.display='none'; loginModal.style.display='flex'; if (loginError) loginError.textContent=''; };
        // 兼容：若仍存在“确定”按钮（旧缓存），点击后与直接进入第二步逻辑一致
        if (btnResetNext) btnResetNext.onclick = async () => {
            if (resetError) resetError.textContent = '';
            const email = (resetEmail.value || '').trim();
            if (!email) { if (resetError) resetError.textContent = '请输入邮箱'; return; }
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { if (resetError) resetError.textContent = '邮箱格式不正确'; return; }
            // 开启加载态
            const setButtonLoading = (buttonEl, on, text='请稍后…') => {
                if (!buttonEl) return;
                if (on) {
                    if (!buttonEl.dataset.originalText) buttonEl.dataset.originalText = buttonEl.textContent || '';
                    buttonEl.textContent = text;
                    buttonEl.disabled = true;
                    buttonEl.classList.add('btn-loading');
                } else {
                    buttonEl.disabled = false;
                    buttonEl.classList.remove('btn-loading');
                    const orig = buttonEl.dataset.originalText;
                    if (typeof orig !== 'undefined') { buttonEl.textContent = orig; delete buttonEl.dataset.originalText; }
                }
            };
            setButtonLoading(btnResetNext, true);
            try {
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/email-code`, { method:'POST', headers, body: JSON.stringify({ email, purpose:'reset', captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnResetNext, resetError)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '发送验证码失败');
                }
                this.showMessage('验证码已发送');
                // 展示第二步输入区域
                if (resetCodeRow) resetCodeRow.style.display='';
                if (resetPwdRow) resetPwdRow.style.display='';
                if (resetSubmitRow) resetSubmitRow.style.display='';
                if (resetNextRow) resetNextRow.style.display='none';
                // 若存在“获取验证码”按钮，则启动倒计时（用于重发）
                if (btnSendResetCode) {
                    startCountdown(btnSendResetCode, 60);
                }
            } catch (e) {
                if (resetError) resetError.textContent = e && e.message ? e.message : '发送验证码失败';
                // 失败恢复按钮
                setButtonLoading(btnResetNext, false);
            }
        };

        // 通用倒计时函数
        const startCountdown = (buttonEl, seconds = 60) => {
            const i18n = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.I18N) || {};
            const renderSent = typeof i18n.sentWithCountdown === 'function' ? i18n.sentWithCountdown : (s)=>`已发送(${s}s)`;
            const renderResend = i18n.resendAfter || '重新发送';
            let remain = seconds;
            buttonEl.disabled = true;
            buttonEl.textContent = renderSent(remain);
            const t = setInterval(() => {
                remain -= 1;
                if (remain <= 0) {
                    clearInterval(t);
                    buttonEl.disabled = false;
                    buttonEl.textContent = renderResend;
                    return;
                }
                buttonEl.textContent = renderSent(remain);
            }, 1000);
        };

        if (btnSendRegCode) btnSendRegCode.addEventListener('click', () => startCountdown(btnSendRegCode, 60));

        if (btnSendResetCode) btnSendResetCode.onclick = async () => {
            if (resetError) resetError.textContent = '';
            const email = (resetEmail.value || '').trim();
            if (!email) { if (resetError) resetError.textContent = '请输入邮箱'; return; }
            try {
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/email-code`, { method:'POST', headers, body: JSON.stringify({ email, purpose:'reset', captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) {
                    // 检查是否为429限流响应
                    if (this.handleRateLimitResponse(r, j, btnSendResetCode, resetError)) {
                        return; // 已处理限流响应，直接返回
                    }
                    throw new Error(j.error || '发送验证码失败');
                }
                this.showMessage('验证码已发送');
                resetCodeRow.style.display='';
                resetPwdRow.style.display='';
                resetSubmitRow.style.display='';
                startCountdown(btnSendResetCode, 60);
            } catch (e) {
                if (resetError) resetError.textContent = e && e.message ? e.message : '发送验证码失败';
            }
        };

        if (btnConfirmReset) btnConfirmReset.onclick = async () => {
            if (resetError) resetError.textContent = '';
            const email = (resetEmail.value || '').trim();
            const code = (document.getElementById('resetCode').value || '').trim();
            const newPassword = (document.getElementById('resetPassword').value || '');
            if (!email || !code || !newPassword) { if (resetError) resetError.textContent = '请完整填写邮箱、验证码与新密码'; return; }
            if (newPassword.length < 6) { if (resetError) resetError.textContent = '新密码至少6位'; return; }
            // 表单级加载态：在发起请求前启用，禁用表单并将按钮文案替换为“请稍后…”
            this.setFormLoading('#resetModal .form', true, '请稍后…');
            try {
                const token = await this.getCaptchaTokenIfAvailable();
                const headers = { 'Content-Type':'application/json' };
                if (token) headers['x-captcha-token'] = token;
                const r = await fetch(`${API_BASE_URL}/api/user/password/reset-confirm`, { method:'POST', headers, body: JSON.stringify({ email, code, new_password: newPassword, captchaToken: token }) });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || '重置失败');
                this.showMessage('密码已重置，请登录');
                resetModal.style.display='none';
                loginModal.style.display='flex';
                loginEmail.value = email;
                try { loginPassword.value = ''; } catch {}
            } catch (e) {
                if (resetError) resetError.textContent = e && e.message ? e.message : '重置失败';
            } finally {
                // 无论成功失败，恢复表单状态
                this.setFormLoading('#resetModal .form', false);
            }
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
        
        // 控制通知相关UI显示
        const notificationBell = document.getElementById('notificationBell');
        if (notificationBell) {
            notificationBell.style.display = logged ? '' : 'none';
        }
        
        // 如果用户已登录，启动通知轮询
        if (logged) {
            this.startNotificationPolling();
        } else {
            this.stopNotificationPolling();
        }
        
        if (!logged && REQUIRE_SUBTITLE_LOGIN) {
            this.disableSubtitleUi('登录后可用');
        }
        // 如果已登录，更新用户邮箱显示
        if (logged) {
            await this.updateUserEmail();
        }
        // 刷新社交按钮禁用/激活状态，确保登录/退出后无需刷新即可生效
        if (typeof this.updateSocialButtonsState === 'function') {
            this.updateSocialButtonsState();
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
        
        // 关闭社交面板（如果已打开）
        if (this.socialState && this.socialState.isSocialMode) {
            this.closeSocialMode();
        }
        
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
    
    // ===== 社交模式相关方法 =====
    
    // 初始化社交模式
    initSocialMode() {
        this.updateSocialState();
        this.setupSocialEventListeners();
        this.updateSocialButtonsState();
        
        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            this.updateSocialState();
            this.updateSocialLayout();
        });
        
        // 监听ESC键
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.socialState.isSocialMode) {
                this.closeSocialMode();
            }
        });
        
        // 初始化可访问性属性
        this.currentFocusTrap = null;
        this.updateAccessibilityAttributes();
    }
    
    // 更新社交状态
    updateSocialState() {
        // 基于设备特征检测移动设备，而非仅依赖窗口宽度/UA
        const uaRaw = navigator.userAgent;
        const userAgent = uaRaw.toLowerCase();
        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
        const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
        const hasTouchSupport = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isModernMobile = (navigator.userAgentData && navigator.userAgentData.mobile) === true;

        // iPadOS 在“请求桌面站点”时 UA 伪装为 macOS，但可通过 maxTouchPoints 识别
        const iPadOSDesktopUA = /mac os/i.test(uaRaw) && (navigator.maxTouchPoints || 0) > 1;
        // 视口兜底：窄视口一律按移动端处理，避免 UA/指针特征误判
        const isSmallViewport = window.matchMedia('(max-width: 880px)').matches;

        // 排除桌面操作系统（排除 iPadOS 桌面 UA 伪装）
        const isDesktopOS = /windows|mac os|linux/i.test(userAgent) && !/mobile/i.test(userAgent) && !iPadOSDesktopUA;

        // 综合判断：满足任一移动特征，或窄视口，且不属于真实桌面 OS
        this.socialState.isMobile = (isMobileUA || isModernMobile || (hasCoarsePointer && hasTouchSupport) || iPadOSDesktopUA || isSmallViewport) && !isDesktopOS;

        // 桌面端始终禁用抽屉模式，统一为并排模式
        this.socialState.isDrawerMode = false;
    }
    
    // 设置社交事件监听器
    setupSocialEventListeners() {
        // 获取社交入口按钮
        const btnSubComment = document.getElementById('btnSubComment');
        const btnUserPlaza = document.getElementById('btnUserPlaza');
        const btnRealtimeChat = document.getElementById('btnRealtimeChat');
        
        // 绑定入口按钮事件
        if (btnSubComment) {
            btnSubComment.addEventListener('click', () => {
                this.toggleSocialFeature('subtitle-comment');
            });
        }
        
        if (btnUserPlaza) {
            btnUserPlaza.addEventListener('click', () => {
                this.toggleSocialFeature('user-plaza');
            });
        }
        
        if (btnRealtimeChat) {
            btnRealtimeChat.addEventListener('click', () => {
                this.toggleSocialFeature('realtime-chat');
            });
        }
    }
    
    // 切换社交功能（移动端也显示面板，但无动画）
    toggleSocialFeature(feature) {
        // 每次操作前刷新设备状态，确保最新布局判定
        this.updateSocialState();
        // 检查登录状态
        if (!this.isLoggedIn()) {
            this.showMessage('请先登录后使用社交功能', 'warning');
            return;
        }
        
        // 如果当前功能已激活，则关闭
        if (this.socialState.activeFeature === feature && this.socialState.isSocialMode) {
            this.closeSocialMode();
            return;
        }
        
        // 激活新功能
        this.socialState.activeFeature = feature;
        this.socialState.isSocialMode = true;
        
        this.updateSocialLayout();
        this.updateSocialButtonsState();
        this.updateAccessibilityAttributes();
        this.loadSocialContent(feature);
        this.socialPanel.show({
            isMobile: this.socialState.isMobile,
            isSocialMode: this.socialState.isSocialMode
        });
    }
    
    // 关闭社交模式
    closeSocialMode() {
        this.socialState.isSocialMode = false;
        this.socialState.activeFeature = null;
        
        // 使用 SocialPanel 控制隐藏与动画
        this.socialPanel.hide({
            isMobile: this.socialState.isMobile,
            isSocialMode: this.socialState.isSocialMode
        });
        
        // 更新按钮状态与可访问性
        this.updateSocialButtonsState();
        this.updateAccessibilityAttributes();
    }
    
    // 更新社交布局（交由 SocialPanel 统一处理）
    updateSocialLayout() {
        const state = {
            isMobile: this.socialState.isMobile,
            isSocialMode: this.socialState.isSocialMode
        };
        this.socialPanel.syncLayout(state);

        // 布局变化后，下一帧重新计算播放器尺寸（双RAF确保布局稳定）
        if (this._rafUpdateSize1) { cancelAnimationFrame(this._rafUpdateSize1); this._rafUpdateSize1 = null; }
        if (this._rafUpdateSize2) { cancelAnimationFrame(this._rafUpdateSize2); this._rafUpdateSize2 = null; }
        this._rafUpdateSize1 = requestAnimationFrame(() => {
            this._rafUpdateSize1 = null;
            this._rafUpdateSize2 = requestAnimationFrame(() => {
                this._rafUpdateSize2 = null;
                this.updatePlayerSize();
            });
        });
    }
    
    // 包装播放器到列容器中
    wrapPlayerInColumn() {
        const stage = document.querySelector('.stage');
        const playerBox = document.querySelector('.player-box');
        
        if (!stage || !playerBox) return;
        
        // 检查是否已经包装
        if (stage.querySelector('.player-column')) return;
        
        // 创建播放器列容器
        const playerColumn = document.createElement('div');
        playerColumn.className = 'player-column';
        
        // 将播放器移动到列容器中
        playerBox.parentNode.insertBefore(playerColumn, playerBox);
        playerColumn.appendChild(playerBox);
    }
    
    // 移除播放器列容器
    unwrapPlayerColumn() {
        const stage = document.querySelector('.stage');
        const playerColumn = stage?.querySelector('.player-column');
        const playerBox = document.querySelector('.player-box');
        
        if (!playerColumn || !playerBox) return;
        
        // 将播放器移回原位置
        stage.insertBefore(playerBox, playerColumn);
        playerColumn.remove();
    }
    
    // 更新社交按钮状态
    updateSocialButtonsState() {
        const buttons = {
            'btnSubComment': 'subtitle-comment',
            'btnUserPlaza': 'user-plaza',
            'btnRealtimeChat': 'realtime-chat'
        };
        
        const isLoggedIn = this.isLoggedIn();
        
        Object.entries(buttons).forEach(([btnId, feature]) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            
            // 设置禁用状态
            btn.disabled = !isLoggedIn;
            
            // 设置激活状态
            if (this.socialState.activeFeature === feature && this.socialState.isSocialMode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
            
            // 设置ARIA属性
            btn.setAttribute('aria-pressed', 
                this.socialState.activeFeature === feature && this.socialState.isSocialMode ? 'true' : 'false'
            );
        });
    }
    
    // 加载社交内容（桌面/移动端共用）
    loadSocialContent(feature) {
        let title = '';
        let content = '';
        let panelType = '';
        
        switch (feature) {
            case 'subtitle-comment':
                title = '字幕评论';
                content = this.getSubtitleCommentContent();
                panelType = 'subtitle';
                break;
            case 'user-plaza':
                title = '用户广场';
                content = this.getUserPlazaContent();
                panelType = 'plaza';
                break;
            case 'realtime-chat':
                title = '实时聊天';
                content = this.getRealtimeChatContent();
                panelType = 'chat';
                break;
        }
        
        // 统一通过 SocialPanel 设置内容
        this.socialPanel.setContent(title, content);
        
        // 设置面板类型，控制评论数显示
        this.socialPanel.setPanelType(panelType);
        
        // 如果是字幕评论功能且用户已登录，初始化评论功能
        if (feature === 'subtitle-comment' && this.isLoggedIn()) {
            // 使用 setTimeout 确保 DOM 已渲染
            setTimeout(() => {
                this.initSubtitleComments();
            }, 100);
        }
    }
    
    // 获取字幕评论内容
    getSubtitleCommentContent() {
        // 检查用户是否已登录
        if (!this.isLoggedIn()) {
            return `
                <div class="comment-login-required">
                    <div class="login-icon">🔒</div>
                    <h3>需要登录</h3>
                    <p>请先登录后再查看和发表评论</p>
                    <button class="login-btn" onclick="window.location.href='/login.html'">立即登录</button>
                </div>
            `;
        }

        return `
            <div class="subtitle-comments">
                <!-- 评论列表区域 -->
                <div class="comments-container">
                    <div id="commentsList" class="comments-list">
                        <div class="loading-comments">
                            <div class="loading-spinner"></div>
                            <span>加载评论中...</span>
                        </div>
                    </div>
                    <div id="loadMoreComments" class="load-more" style="display: none;">
                        <button class="load-more-btn">加载更多评论</button>
                    </div>
                </div>

                <!-- 底部发表评论区域 -->
                <div class="comment-compose">
                    <div class="compose-input-wrapper">
                        <div class="input-container">
                            <!-- 回复提示条 -->
                            <div id="replyHint" class="reply-hint" style="display: none;">
                                <span class="reply-prefix">回复 </span>
                                <span class="reply-username">@用户名</span>
                                <button class="reply-cancel-btn" type="button">取消</button>
                            </div>
                            <textarea 
                                id="commentInput" 
                                placeholder="善语结善缘，恶言伤人心" 
                                maxlength="500"
                                rows="1"></textarea>
                            <!-- 专用的图片预览容器 -->
                            <div id="composeImagePreview" class="comment-images compose-preview" style="display: none;"></div>
                            <div class="input-actions">
                                <div class="input-tools">
                                    <button class="tool-btn emoji-btn" title="表情">😊</button>
                                    <button class="tool-btn mention-btn" title="@某人">@</button>
                                    <button class="tool-btn image-btn" title="图片">📷</button>
                                </div>
                                <div class="submit-area">
                                    <span class="char-count">0/500</span>
                                    <button id="submitComment" class="submit-btn" disabled>发表</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // 获取用户广场内容
    getUserPlazaContent() {
        return `
            <div class="social-placeholder">
                <div class="placeholder-icon">👥</div>
                <h3>用户广场</h3>
                <p>与其他用户交流互动，分享观影心得。</p>
                <div class="placeholder-features">
                    <div class="feature-item">👤 用户动态</div>
                    <div class="feature-item">⭐ 推荐内容</div>
                    <div class="feature-item">🎯 话题讨论</div>
                </div>
                <p class="placeholder-note">功能开发中，敬请期待...</p>
            </div>
        `;
    }
    
    // 获取实时聊天内容
    getRealtimeChatContent() {
        return `
            <div class="social-placeholder">
                <div class="placeholder-icon">💭</div>
                <h3>实时聊天</h3>
                <p>与正在观看的用户实时交流讨论。</p>
                <div class="placeholder-features">
                    <div class="feature-item">⚡ 实时消息</div>
                    <div class="feature-item">🎬 同步观影</div>
                    <div class="feature-item">🎉 表情互动</div>
                </div>
                <p class="placeholder-note">功能开发中，敬请期待...</p>
            </div>
        `;
    }
    
    // 获取当前用户名
    getCurrentUsername() {
        try {
            if (this.userToken) {
                const payload = JSON.parse(atob(this.userToken.split('.')[1]));
                return payload.email || payload.username || '用户';
            }
        } catch (e) {
            console.warn('解析用户token失败:', e);
        }
        return '用户';
    }

    // 生成用户头像（用户名首字母+随机背景色）
    generateUserAvatar(username) {
        if (!username) return 'U';
        
        // 获取用户名首字母
        const firstChar = username.charAt(0).toUpperCase();
        
        // 基于用户名生成固定的背景色
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
        ];
        
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colorIndex = Math.abs(hash) % colors.length;
        const backgroundColor = colors[colorIndex];
        
        return `<span class="avatar-text" style="background-color: ${backgroundColor}">${firstChar}</span>`;
    }

    // 初始化字幕评论功能
    initSubtitleComments() {
        // 绑定发表评论相关事件
        this.bindCommentEvents();
        // 加载评论列表
        this.loadComments();
    }

    // 绑定评论相关事件
    bindCommentEvents() {
        const commentInput = document.getElementById('commentInput');
        const submitBtn = document.getElementById('submitComment');
        const emojiBtn = document.querySelector('.emoji-btn');
        const mentionBtn = document.querySelector('.mention-btn');
        const imageBtn = document.querySelector('.image-btn');
        
        if (commentInput && submitBtn) {
            // 输入框字符计数
            commentInput.addEventListener('input', (e) => {
                const length = e.target.value.length;
                const charCount = document.querySelector('.char-count');
                if (charCount) {
                    charCount.textContent = `${length}/500`;
                }
                
                // 控制提交按钮状态
                submitBtn.disabled = length === 0 || length > 500;
            });
            
            // 提交评论
            submitBtn.addEventListener('click', () => {
                this.submitComment();
            });
            
            // 回车提交（Ctrl+Enter）
            commentInput.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault();
                    this.submitComment();
                }
            });
        }
        
        // 表情按钮事件
        if (emojiBtn) {
            emojiBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation(); // 防止事件冒泡触发handleOutsideClick
            this.showEmojiPicker(e.currentTarget);
        });
        }
        
        // @用户按钮事件
        if (mentionBtn) {
            mentionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.showUserSearchModal();
            });
        }
        
        // 图片按钮事件
        if (imageBtn) {
            imageBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.triggerImageUpload();
            });
        }
        

        
        // 缩略图点击事件（使用事件委托）
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('comment-image-thumbnail')) {
                e.preventDefault();
                const url = e.target.dataset.url;
                const index = parseInt(e.target.dataset.index);
                const allUrls = JSON.parse(e.target.dataset.allUrls);
                this.openLightbox(url, allUrls, index);
                return;
            }
            
            // 回复按钮点击事件（使用事件委托）
            if (e.target.classList.contains('comment-reply-btn')) {
                e.preventDefault();
                const commentId = e.target.dataset.commentId;
                const username = e.target.dataset.username;
                if (commentId && username) {
                    this.enterReplyMode(commentId, username);
                }
                return;
            }
            
            // 取消回复按钮点击事件
            if (e.target.classList.contains('reply-cancel-btn')) {
                e.preventDefault();
                this.exitReplyMode();
                return;
            }
            
            // 回复展开/收起按钮点击事件
            if (e.target.classList.contains('replies-toggle-btn')) {
                e.preventDefault();
                const commentId = e.target.dataset.commentId;
                if (commentId) {
                    this.toggleReplies(commentId);
                }
                return;
            }
            
            // 加载更多回复按钮点击事件
            if (e.target.classList.contains('load-more-replies-btn')) {
                e.preventDefault();
                const commentId = e.target.dataset.commentId;
                if (commentId) {
                    this.loadMoreReplies(commentId);
                }
                return;
            }
            
            // 点击外部关闭浮层
            this.handleOutsideClick(e);
        });
    }

    // 加载评论列表
    async loadComments(page = 1) {
        if (!this.currentVideoId) {
            console.warn('当前视频ID为空，无法加载评论');
            return;
        }
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/subtitles/${this.currentVideoId}/comments?page=${page}&sort=newest`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const raw = await response.json();
            
            // 兼容多种返回结构: {comments: []} 或 {data: [], pagination: {...}}
            if (!raw || (!Array.isArray(raw.comments) && !Array.isArray(raw.data))) {
                console.warn('评论数据格式不正确:', raw);
                this.renderComments([], page === 1);
                if (page === 1) {
                    this.updateCommentsCount(0);
                }
                // 隐藏加载更多按钮
                const loadMoreBtn = document.getElementById('loadMoreComments');
                if (loadMoreBtn) {
                    loadMoreBtn.style.display = 'none';
                    loadMoreBtn.onclick = null;
                }
                return;
            }
            
            const commentsArr = Array.isArray(raw.comments) ? raw.comments : raw.data;
            this.renderComments(commentsArr, page === 1);
            
            // 更新评论数统计
            if (page === 1) {
                const total = (typeof raw.total === 'number') ? raw.total
                             : (typeof raw.count === 'number') ? raw.count
                             : (raw.pagination && typeof raw.pagination.total === 'number') ? raw.pagination.total
                             : commentsArr.length;
                this.updateCommentsCount(total);
            }
            
            // 更新加载更多按钮
            const loadMoreBtn = document.getElementById('loadMoreComments');
            if (loadMoreBtn) {
                const hasMore = (typeof raw.hasMore === 'boolean') ? raw.hasMore
                               : (raw.pagination && typeof raw.pagination.has_more === 'boolean') ? raw.pagination.has_more
                               : (raw.pagination && typeof raw.pagination.page === 'number' && typeof raw.pagination.total_pages === 'number'
                                   ? raw.pagination.page < raw.pagination.total_pages
                                   : false);
                loadMoreBtn.style.display = hasMore ? 'block' : 'none';
                loadMoreBtn.onclick = hasMore ? (() => this.loadComments(page + 1)) : null;
            }
            
        } catch (error) {
            console.error('加载评论失败:', error);
            this.showCommentError('加载评论失败，请稍后重试');
        }
    }

    // 渲染评论列表
    renderComments(comments, replace = true) {
        const commentsList = document.getElementById('commentsList');
        if (!commentsList) return;
        
        if (replace) {
            commentsList.innerHTML = '';
        }
        
        // 验证comments参数
        if (!Array.isArray(comments)) {
            console.warn('renderComments: comments参数不是数组', comments);
            if (replace) {
                commentsList.innerHTML = `
                    <div class="no-comments">
                        <div class="no-comments-icon">💭</div>
                        <p>还没有评论，来发表第一条评论吧！</p>
                    </div>
                `;
            }
            return;
        }
        
        if (comments.length === 0) {
            if (replace) {
                commentsList.innerHTML = `
                    <div class="no-comments">
                        <div class="no-comments-icon">💭</div>
                        <p>还没有评论，来发表第一条评论吧！</p>
                    </div>
                `;
            }
            return;
        }
        
        comments.forEach(comment => {
            if (comment) {
                const commentEl = this.createCommentElement(comment);
                if (commentEl) {
                    commentsList.appendChild(commentEl);
                }
            }
        });
    }

    // 创建评论元素
    createCommentElement(comment) {
        // 验证comment对象
        if (!comment || typeof comment !== 'object') {
            console.warn('createCommentElement: comment参数无效', comment);
            return null;
        }
        
        // 提供默认值
        const username = comment.username || '匿名用户';
        const content = comment.content || '';
        const created_at = comment.createdAt || comment.created_at || new Date().toISOString();
        const likes_count = comment.likesCount || comment.likes_count || 0;
        const user_liked = comment.userLiked || comment.user_liked || false;
        const id = comment.id || 'unknown';
        const replies = Array.isArray(comment.replies) ? comment.replies : [];
        const imageUrls = Array.isArray(comment.imageUrls) ? comment.imageUrls : [];
        const repliesCount = Number(comment.repliesCount ?? comment.replies_count ?? (Array.isArray(comment.replies) ? comment.replies.length : 0)) || 0;
        
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.dataset.commentId = id;
        
        const timeAgo = this.formatTimeAgo(created_at);
        const avatar = this.generateUserAvatar(username);
        
        // 格式化地理位置显示
        const locationDisplay = comment.locationDisplay;
        const timestampText = locationDisplay ? `${timeAgo} · ${locationDisplay}` : timeAgo;
        
        // 生成图片HTML（缩略图形式）
        let imagesHtml = '';
        if (imageUrls.length > 0) {
            const imageElements = imageUrls.map((url, index) => 
                `<img src="${this.escapeHtml(url)}" alt="评论图片" class="comment-image-thumbnail" data-url="${this.escapeHtml(url)}" data-index="${index}" data-all-urls='${JSON.stringify(imageUrls.map(u => this.escapeHtml(u)))}' />`
            ).join('');
            imagesHtml = `<div class="comment-images">${imageElements}</div>`;
        }
        
        div.innerHTML = `
            <div class="comment-header">
                <div class="user-avatar" data-username="${username}">${avatar}</div>
                <div class="comment-meta">
                    <span class="username">${username}</span>
                </div>
            </div>
            <div class="comment-content">${this.escapeHtml(content)}</div>
            ${imagesHtml}
            <div class="comment-actions">
                <div class="comment-actions-left">
                    <span class="timestamp">${timestampText}</span>
                    <button class="comment-reply-btn" data-comment-id="${id}" data-username="${username}">回复</button>
                    ${repliesCount > 0 ? `<button class="replies-toggle-btn" data-comment-id="${id}" data-count="${repliesCount}">查看 ${repliesCount} 条回复</button>` : ''}
                </div>
                <div class="comment-actions-right">
                    <button class="like-btn ${user_liked ? 'liked' : ''}" data-comment-id="${id}">
                        <span class="like-icon">${user_liked ? '❤️' : '🤍'}</span>
                        <span class="like-count">${likes_count}</span>
                    </button>
                </div>
            </div>
            <div class="replies-section" id="replies-${id}" data-loaded="false" data-page="0" style="display:none"></div>
        `;
        
        // 绑定点赞事件
        const likeBtn = div.querySelector('.like-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', () => {
                this.toggleCommentLike(id);
            });
        }
        
        return div;
    }

    // 渲染回复
    renderReplies(replies) {
        if (!Array.isArray(replies) || replies.length === 0) return '';
        
        const repliesHtml = replies.map(reply => {
            // 验证reply对象并提供默认值
            if (!reply || typeof reply !== 'object') {
                console.warn('renderReplies: reply对象无效', reply);
                return '';
            }
            
            const username = reply.username || '匿名用户';
            const content = reply.content || '';
            const created_at = reply.created_at || new Date().toISOString();
            const likes_count = reply.likes_count || 0;
            const user_liked = reply.user_liked || false;
            const id = reply.id || 'unknown';
            const imageUrls = Array.isArray(reply.imageUrls) ? reply.imageUrls : [];
            
            const avatar = this.generateUserAvatar(username);
            const timeAgo = this.formatTimeAgo(created_at);
            
            // 格式化地理位置显示
            const locationDisplay = reply.locationDisplay;
            const timestampText = locationDisplay ? `${timeAgo} · ${locationDisplay}` : timeAgo;
            
            // 生成回复图片HTML（缩略图形式）
            let replyImagesHtml = '';
            if (imageUrls.length > 0) {
                const imageElements = imageUrls.map((url, index) => 
                    `<img src="${this.escapeHtml(url)}" alt="回复图片" class="comment-image-thumbnail" data-url="${this.escapeHtml(url)}" data-index="${index}" data-all-urls='${JSON.stringify(imageUrls.map(u => this.escapeHtml(u)))}' />`
                ).join('');
                replyImagesHtml = `<div class="comment-images">${imageElements}</div>`;
            }
            
            return `
                <div class="reply-item" data-comment-id="${id}">
                    <div class="comment-header">
                        <div class="user-avatar small" data-username="${username}">${avatar}</div>
                        <div class="comment-meta">
                            <span class="username">${username}</span>
                        </div>
                    </div>
                    <div class="comment-content">${this.escapeHtml(content)}</div>
                    ${replyImagesHtml}
                    <div class="comment-actions">
                        <div class="comment-actions-left">
                            <span class="timestamp">${timestampText}</span>
                        </div>
                        <div class="comment-actions-right">
                            <button class="like-btn ${user_liked ? 'liked' : ''}" data-comment-id="${id}">
                                <span class="like-icon">${user_liked ? '❤️' : '🤍'}</span>
                                <span class="like-count">${likes_count}</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).filter(html => html !== '').join('');
        
        return `<div class="replies-section">${repliesHtml}</div>`;
    }

    // 提交评论
    async submitComment() {
        const commentInput = document.getElementById('commentInput');
        const submitBtn = document.getElementById('submitComment');
        
        if (!commentInput || !submitBtn) return;
        
        const content = commentInput.value.trim();
        if (!content) return;
        
        if (!this.currentVideoId) {
            this.showCommentError('当前视频ID为空，无法发表评论');
            return;
        }
        
        // 收集上传的图片URL（仅从专用预览容器）
        const imageUrls = [];
        const previewContainer = document.getElementById('composeImagePreview');
        if (previewContainer) {
            const imageInputs = previewContainer.querySelectorAll('input[name="image_url"]');
            imageInputs.forEach(input => {
                if (input.value && input.value.trim()) {
                    imageUrls.push(input.value.trim());
                }
            });
        }
        
        // 限制图片数量为最多5张，并给出用户提示
        if (imageUrls.length > MAX_IMAGES) {
            this.showCommentError(`最多只能上传${MAX_IMAGES}张图片，已自动保留前${MAX_IMAGES}张图片`);
            imageUrls.splice(MAX_IMAGES); // 只保留前MAX_IMAGES张图片
        }
        
        // 禁用提交按钮
        submitBtn.disabled = true;
        submitBtn.textContent = '发表中...';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/subtitles/${this.currentVideoId}/comments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.userToken}`
                },
                body: JSON.stringify({
                    content: content,
                    timestamp: this.player ? Math.floor(this.player.currentTime) : 0,
                    imageUrls: imageUrls,
                    parentCommentId: this.replyingToCommentId || null
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }
            
            const responseData = await response.json();
            
            // 清空输入框和图片
            commentInput.value = '';
            const charCount = document.querySelector('.char-count');
            if (charCount) {
                charCount.textContent = '0/500';
            }
            
            // 清空预览容器中的图片
            if (previewContainer) {
                previewContainer.innerHTML = '';
                previewContainer.style.display = 'none';
            }
            
            // 处理回复或顶级评论
            if (this.replyingToCommentId) {
                // 回复模式：即时插入新回复
                await this.handleNewReply(this.replyingToCommentId, responseData.data);
                this.exitReplyMode();
            } else {
                // 顶级评论：重新加载评论列表
                await this.loadComments();
            }
            
            // 显示成功提示
            this.showCommentSuccess('评论发表成功！');
            
        } catch (error) {
            console.error('发表评论失败:', error);
            this.showCommentError(error.message || '发表评论失败，请稍后重试');
        } finally {
            // 恢复提交按钮
            submitBtn.disabled = false;
            submitBtn.textContent = '发表评论';
        }
    }

    // 更新评论数统计
    updateCommentsCount(count) {
        // 更新社交面板顶部工具栏中的评论数显示
        const socialPanelCommentsCount = document.getElementById('socialPanelCommentsCount');
        if (socialPanelCommentsCount) {
            if (count > 0) {
                socialPanelCommentsCount.textContent = `共有${count}条评论`;
                socialPanelCommentsCount.style.display = 'inline';
            } else {
                socialPanelCommentsCount.style.display = 'none';
            }
        }
    }

    // 切换评论点赞状态
    async toggleCommentLike(commentId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/comments/${commentId}/like`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // 更新UI
            const commentEl = document.querySelector(`[data-comment-id="${commentId}"]`);
            if (commentEl) {
                const likeBtn = commentEl.querySelector('.like-btn');
                const likeIcon = commentEl.querySelector('.like-icon');
                const likeCount = commentEl.querySelector('.like-count');
                
                if (likeBtn && likeIcon && likeCount) {
                    if (data.liked) {
                        likeBtn.classList.add('liked');
                        likeIcon.textContent = '❤️';
                    } else {
                        likeBtn.classList.remove('liked');
                        likeIcon.textContent = '🤍';
                    }
                    likeCount.textContent = data.likes_count || 0;
                }
            }
            
        } catch (error) {
            console.error('点赞操作失败:', error);
            this.showCommentError('点赞操作失败，请稍后重试');
        }
    }



    // 显示评论错误信息
    showCommentError(message) {
        // 可以使用现有的toast系统或创建临时提示
        console.error('评论错误:', message);
        // 这里可以集成现有的提示系统
    }

    // 显示评论成功信息
    showCommentSuccess(message) {
        console.log('评论成功:', message);
        // 这里可以集成现有的提示系统
    }

    // 格式化时间
    formatTimeAgo(timestamp) {
        // 处理空值情况
        if (!timestamp) {
            return '刚刚';
        }
        
        const now = new Date();
        let time;
        
        if (typeof timestamp === 'string') {
            // 处理 SQLite 格式: '2025-09-03 13:14:12' (UTC时间)
            if (!timestamp.includes('T') && !timestamp.includes('Z')) {
                // 将空格替换为T，并添加Z表示UTC时间
                const isoString = timestamp.replace(' ', 'T') + 'Z';
                time = new Date(isoString);
            } else {
                time = new Date(timestamp);
            }
        } else {
            time = new Date(timestamp);
        }
        
        // 检查解析结果是否有效
        if (isNaN(time.getTime())) {
            return '刚刚';
        }
        
        const diff = now - time;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 30) return `${days}天前`;
        
        return time.toLocaleDateString('zh-CN');
    }

    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // ===== 表情、@用户、图片上传功能 =====
    

    
    // 显示用户搜索弹窗
    showUserSearchModal() {
        // 移除已存在的搜索弹窗
        const existingModal = document.querySelector('.user-search-modal');
        if (existingModal) {
            existingModal.remove();
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'user-search-modal';
        modal.innerHTML = `
            <div class="user-search-content">
                <div class="user-search-header">
                    <h3>@用户</h3>
                    <button class="close-btn">&times;</button>
                </div>
                <div class="user-search-body">
                    <input type="text" class="user-search-input" placeholder="输入用户名搜索..." autocomplete="off">
                    <div class="user-search-results"></div>
                </div>
            </div>
        `;
        
        // 优先挂载到社交面板内，如果不可用则挂载到document.body
        const socialPanelElement = this.socialPanel && this.socialPanel.getElement ? this.socialPanel.getElement() : null;
        const parentElement = socialPanelElement || document.body;
        parentElement.appendChild(modal);
        
        const searchInput = modal.querySelector('.user-search-input');
        const resultsContainer = modal.querySelector('.user-search-results');
        const closeBtn = modal.querySelector('.close-btn');
        
        // 关闭弹窗
        const closeModal = () => {
            modal.remove();
        };
        
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // 搜索用户
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            clearTimeout(searchTimeout);
            
            if (query.length < 2) {
                resultsContainer.innerHTML = '';
                return;
            }
            
            searchTimeout = setTimeout(async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/users/search?username=${encodeURIComponent(query)}`, {
                        headers: {
                            'Authorization': `Bearer ${this.userToken}`
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    const data = await response.json();
                    const users = Array.isArray(data.users) ? data.users : [];
                    
                    if (users.length === 0) {
                        resultsContainer.innerHTML = '<div class="no-users">未找到匹配的用户</div>';
                        return;
                    }
                    
                    resultsContainer.innerHTML = users.map(user => `
                        <div class="user-item" data-username="${user.username || user.email}">
                            <div class="user-avatar">${this.generateUserAvatar(user.username || user.email)}</div>
                            <div class="user-info">
                                <div class="username">${user.username || user.email}</div>
                            </div>
                        </div>
                    `).join('');
                    
                    // 绑定用户选择事件
                    resultsContainer.addEventListener('click', (e) => {
                        const userItem = e.target.closest('.user-item');
                        if (userItem) {
                            const username = userItem.dataset.username;
                            this.insertTextAtCursor(`@${username} `);
                            closeModal();
                        }
                    });
                    
                } catch (error) {
                    console.error('搜索用户失败:', error);
                    resultsContainer.innerHTML = '<div class="search-error">搜索失败，请稍后重试</div>';
                }
            }, 300);
        });
        
        // 键盘导航支持
        let selectedIndex = -1;
        searchInput.addEventListener('keydown', (e) => {
            const userItems = resultsContainer.querySelectorAll('.user-item');
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, userItems.length - 1);
                this.updateUserSelection(userItems, selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                this.updateUserSelection(userItems, selectedIndex);
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                const selectedUser = userItems[selectedIndex];
                if (selectedUser) {
                    const username = selectedUser.dataset.username;
                    this.insertTextAtCursor(`@${username} `);
                    closeModal();
                }
            } else if (e.key === 'Escape') {
                closeModal();
            }
        });
        
        // 聚焦搜索框
        searchInput.focus();
    }
    
    // 更新用户选择状态
    updateUserSelection(userItems, selectedIndex) {
        userItems.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }
    
    // 触发图片上传
    triggerImageUpload() {
        // 创建隐藏的文件输入框
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true; // 启用多选
        fileInput.accept = 'image/jpeg,image/jpg,image/png,image/gif,image/webp';
        fileInput.style.display = 'none';
        
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files); // 获取所有选中文件
            if (files.length > 0) {
                // 检查当前已有图片数量
                const currentImages = document.querySelectorAll('#composeImagePreview .image-thumbnail').length;
                const remainingSlots = MAX_IMAGES - currentImages;
                
                if (files.length > remainingSlots) {
                    this.showCommentError(`最多只能上传${MAX_IMAGES}张图片，当前还可以上传${remainingSlots}张`);
                    files.splice(remainingSlots); // 只处理允许的数量
                }
                
                // 批量处理文件
                files.forEach(file => {
                    this.handleImageUpload(file);
                });
            }
        });
        
        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }
    
    // 处理图片上传
    async handleImageUpload(file) {
        // 检查图片数量限制
        const currentImages = document.querySelectorAll('#composeImagePreview .image-thumbnail').length;
        if (currentImages >= MAX_IMAGES) {
            this.showCommentError(`最多只能上传${MAX_IMAGES}张图片`);
            return;
        }
        
        // 验证文件
        const validation = this.validateImageFile(file);
        if (!validation.valid) {
            this.showCommentError(validation.message);
            return;
        }
        
        try {
            // 显示上传进度
            this.showUploadProgress();
            
            // 上传图片
            const imageUrl = await this.uploadImage(file);
            
            // 创建图片缩略图
            this.createImageThumbnail(imageUrl, file.name);
            
            // 隐藏上传进度
            this.hideUploadProgress();
            
        } catch (error) {
            console.error('图片上传失败:', error);
            this.showCommentError('图片上传失败，请稍后重试');
            this.hideUploadProgress();
        }
    }
    
    // 验证图片文件
    validateImageFile(file) {
        const maxSize = 5 * 1024 * 1024; // 5MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        
        if (!allowedTypes.includes(file.type)) {
            return {
                valid: false,
                message: '只支持 JPG、PNG、GIF、WebP 格式的图片'
            };
        }
        
        if (file.size > maxSize) {
            return {
                valid: false,
                message: '图片大小不能超过 5MB'
            };
        }
        
        return { valid: true };
    }
    
    // 上传图片到服务器
    async uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        
        const response = await fetch(`${API_BASE_URL}/api/upload/image`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.userToken}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        return data.url;
    }
    
    // 创建图片缩略图
    createImageThumbnail(imageUrl, fileName) {
        // 使用专用的预览容器
        let imageContainer = document.getElementById('composeImagePreview');
        if (!imageContainer) {
            // 兜底：如果容器不存在，在 commentInput 后创建
            const commentInput = document.getElementById('commentInput');
            if (!commentInput) return;
            
            imageContainer = document.createElement('div');
            imageContainer.id = 'composeImagePreview';
            imageContainer.className = 'comment-images compose-preview';
            commentInput.parentNode.insertBefore(imageContainer, commentInput.nextSibling);
        }
        
        // 显示容器（交由 CSS 控制为 flex 布局）
        imageContainer.style.display = '';
        
        const thumbnail = document.createElement('div');
        thumbnail.className = 'image-thumbnail';
        thumbnail.innerHTML = `
            <img src="${imageUrl}" alt="${fileName}" onclick="window.videoPlayerInstance.showImagePreview('${imageUrl}')">
            <button class="remove-image" onclick="this.parentElement.remove(); window.videoPlayerInstance.checkPreviewContainerVisibility()">&times;</button>
            <input type="hidden" name="image_url" value="${imageUrl}">
        `;
        
        imageContainer.appendChild(thumbnail);
    }
    
    // 检查预览容器可见性（当删除图片后调用）
    checkPreviewContainerVisibility() {
        const previewContainer = document.getElementById('composeImagePreview');
        if (previewContainer) {
            const thumbnails = previewContainer.querySelectorAll('.image-thumbnail');
            if (thumbnails.length === 0) {
                previewContainer.style.display = 'none';
            }
        }
    }
    
    // 显示表情选择器
    showEmojiPicker(anchorEl = null) {
        // 检查是否已存在表情选择器，如果存在则移除
        const existingPicker = document.querySelector('.emoji-picker');
        if (existingPicker) {
            existingPicker.remove();
        }
        
        // 常用表情列表
        const emojiList = [
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
            '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
            '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
            '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
            '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
            '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
            '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
            '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
            '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈',
            '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
            '👆', '🖕', '👇', '☝️', '👋', '🤚', '🖐️', '✋', '🖖', '👏',
            '🙌', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶',
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
            '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️'
        ];
        
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.innerHTML = `
            <div class="emoji-picker-header">选择表情</div>
            <div class="emoji-grid">
                ${emojiList.map(emoji => `<button class="emoji-item" data-emoji="${emoji}">${emoji}</button>`).join('')}
            </div>
        `;
        
        // 使用传入的锚点元素或回退到查找按钮
        const targetBtn = anchorEl || document.querySelector('.emoji-btn');
        if (!targetBtn) return;
        
        // 先插入到 body 再测量尺寸
        picker.style.position = 'fixed';
        picker.style.visibility = 'hidden';
        picker.style.zIndex = '10000';
        document.body.appendChild(picker);
        
        // 定位表情面板到按钮上方
        this.positionEmojiPicker(targetBtn, picker);
        
        // 显示面板
        picker.style.visibility = 'visible';
        
        // 绑定表情选择事件
        picker.addEventListener('click', (e) => {
            e.stopPropagation(); // 防止触发外部点击关闭
            const emojiItem = e.target.closest('.emoji-item');
            if (emojiItem) {
                const emoji = emojiItem.dataset.emoji;
                this.insertTextAtCursor(emoji);
                picker.remove();
                this.removeEmojiPickerListeners();
            }
        });
        
        // 绑定窗口变化事件
        this.emojiPickerResizeHandler = () => {
            if (document.body.contains(picker)) {
                this.positionEmojiPicker(targetBtn, picker);
            }
        };
        
        window.addEventListener('resize', this.emojiPickerResizeHandler);
        window.addEventListener('orientationchange', this.emojiPickerResizeHandler);
    }
    
    // 定位表情面板
    positionEmojiPicker(anchorEl, pickerEl) {
        const anchorRect = anchorEl.getBoundingClientRect();
        const pickerRect = pickerEl.getBoundingClientRect();
        const gap = 8;
        
        // 计算上方位置
        let top = anchorRect.top - pickerRect.height - gap;
        
        // 如果上方空间不足，钳制到顶部并设置最大高度
        if (top < gap) {
            const availableHeight = anchorRect.top - gap * 2;
            if (availableHeight > 100) {
                pickerEl.style.maxHeight = `${availableHeight}px`;
                pickerEl.style.overflowY = 'auto';
            }
            top = gap;
        }
        
        // 计算水平居中位置
        let left = anchorRect.left + anchorRect.width / 2 - pickerRect.width / 2;
        
        // 水平边界钳制
        const minLeft = gap;
        const maxLeft = window.innerWidth - pickerRect.width - gap;
        left = Math.max(minLeft, Math.min(left, maxLeft));
        
        pickerEl.style.top = `${top}px`;
        pickerEl.style.left = `${left}px`;
    }
    
    // 移除表情面板相关监听器
    removeEmojiPickerListeners() {
        if (this.emojiPickerResizeHandler) {
            window.removeEventListener('resize', this.emojiPickerResizeHandler);
            window.removeEventListener('orientationchange', this.emojiPickerResizeHandler);
            this.emojiPickerResizeHandler = null;
        }
    }
    
    // 显示用户搜索模态框
    showUserSearchModal() {
        // 移除已存在的模态框
        const existingModal = document.querySelector('.user-search-modal');
        if (existingModal) {
            existingModal.remove();
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'user-search-modal';
        modal.innerHTML = `
            <div class="user-search-content">
                <div class="user-search-header">
                    <h3>搜索用户</h3>
                    <button class="close-search">&times;</button>
                </div>
                <div class="user-search-body">
                    <input type="text" class="user-search-input" placeholder="输入用户名搜索..." autocomplete="off">
                    <div class="user-list"></div>
                </div>
            </div>
        `;
        
        // 优先挂载到社交面板内，如果不可用则挂载到document.body
        const socialPanelElement = this.socialPanel && this.socialPanel.getElement ? this.socialPanel.getElement() : null;
        const parentElement = socialPanelElement || document.body;
        parentElement.appendChild(modal);
        
        const searchInput = modal.querySelector('.user-search-input');
        const userList = modal.querySelector('.user-list');
        const closeBtn = modal.querySelector('.close-search');
        
        // 关闭模态框
        const closeModal = () => {
            modal.remove();
        };
        
        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // 搜索用户
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            
            clearTimeout(searchTimeout);
            
            if (query.length < 2) {
                userList.innerHTML = '<div class="search-hint">请输入至少2个字符</div>';
                return;
            }
            
            searchTimeout = setTimeout(async () => {
                try {
                    userList.innerHTML = '<div class="search-loading">搜索中...</div>';
                    
                    const response = await fetch(`${API_BASE_URL}/api/users/search?username=${encodeURIComponent(query)}`, {
                        headers: {
                            'Authorization': `Bearer ${this.userToken}`
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    
                    const data = await response.json();
                    const users = data.users || [];
                    
                    if (users.length === 0) {
                        userList.innerHTML = '<div class="no-users">未找到相关用户</div>';
                        return;
                    }
                    
                    const resultsContainer = document.createElement('div');
                    resultsContainer.className = 'search-results';
                    
                    users.forEach(user => {
                        const userItem = document.createElement('div');
                        userItem.className = 'user-item';
                        userItem.dataset.username = user.username;
                        userItem.innerHTML = `
                            <div class="user-avatar small">${this.generateUserAvatar(user.username)}</div>
                            <div class="user-info">
                                <div class="username">${user.username}</div>
                                <div class="user-stats">评论 ${user.comment_count || 0} 条</div>
                            </div>
                        `;
                        resultsContainer.appendChild(userItem);
                    });
                    
                    userList.innerHTML = '';
                    userList.appendChild(resultsContainer);
                    
                    // 绑定用户选择事件
                    resultsContainer.addEventListener('click', (e) => {
                        const userItem = e.target.closest('.user-item');
                        if (userItem) {
                            const username = userItem.dataset.username;
                            this.insertTextAtCursor(`@${username} `);
                            closeModal();
                        }
                    });
                    
                } catch (error) {
                    console.error('搜索用户失败:', error);
                    userList.innerHTML = '<div class="search-error">搜索失败，请稍后重试</div>';
                }
            }, 300);
        });
        
        // 聚焦搜索框
        searchInput.focus();
    }
    

    


    // 显示图片预览
    showImagePreview(imageUrl) {
        const modal = document.createElement('div');
        modal.className = 'image-preview-modal';
        modal.innerHTML = `
            <div class="image-preview-content">
                <button class="close-preview">&times;</button>
                <img src="${imageUrl}" alt="图片预览">
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closePreview = () => {
            modal.remove();
        };
        
        modal.querySelector('.close-preview').addEventListener('click', closePreview);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePreview();
        });
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closePreview();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    }
    
    // 显示上传进度
    showUploadProgress() {
        const imageBtn = document.querySelector('.image-btn');
        if (imageBtn) {
            imageBtn.innerHTML = '⏳';
            imageBtn.disabled = true;
        }
    }
    
    // 隐藏上传进度
    hideUploadProgress() {
        const imageBtn = document.querySelector('.image-btn');
        if (imageBtn) {
            imageBtn.innerHTML = '📷';
            imageBtn.disabled = false;
        }
    }
    
    // 在光标位置插入文本
    insertTextAtCursor(text) {
        const commentInput = document.getElementById('commentInput');
        if (!commentInput) return;
        
        const start = commentInput.selectionStart;
        const end = commentInput.selectionEnd;
        const value = commentInput.value;
        
        commentInput.value = value.substring(0, start) + text + value.substring(end);
        commentInput.selectionStart = commentInput.selectionEnd = start + text.length;
        
        // 触发input事件更新字符计数
        commentInput.dispatchEvent(new Event('input'));
        commentInput.focus();
    }
    
    // 处理外部点击事件
    handleOutsideClick(e) {
        // 关闭表情选择器
        const emojiPicker = document.querySelector('.emoji-picker');
        if (emojiPicker && !emojiPicker.contains(e.target) && !e.target.closest('.emoji-btn')) {
            emojiPicker.remove();
            this.removeEmojiPickerListeners();
        }
    }
    
    // ===== 可访问性支持方法 =====
    
    // 设置焦点陷阱
    setupFocusTrap(container) {
        if (!container) return;
        
        const focusableElements = container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        
        // 监听Tab键
        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return;
            
            if (e.shiftKey) {
                // Shift + Tab
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                // Tab
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        };
        
        container.addEventListener('keydown', handleTabKey);
        
        // 设置初始焦点
        firstElement.focus();
        
        // 返回清理函数
        return () => {
            container.removeEventListener('keydown', handleTabKey);
        };
    }
    
    // 移除焦点陷阱
    removeFocusTrap() {
        if (this.currentFocusTrap) {
            this.currentFocusTrap();
            this.currentFocusTrap = null;
        }
    }
    
    // ===== 回复模式相关方法 =====
    
    // 进入回复模式
    enterReplyMode(commentId, username) {
        this.replyingToCommentId = commentId;
        this.replyingToUser = username;
        
        // 显示回复提示条
        const replyHint = document.querySelector('.reply-hint');
        const replyUsername = document.querySelector('.reply-username');
        
        if (replyHint && replyUsername) {
            replyUsername.textContent = username;
            replyHint.style.display = 'flex';
        }
        
        // 聚焦到输入框
        const commentInput = document.getElementById('commentInput');
        if (commentInput) {
            commentInput.focus();
            commentInput.placeholder = `回复 @${username}...`;
        }
    }
    
    // 退出回复模式
    exitReplyMode() {
        this.replyingToCommentId = null;
        this.replyingToUser = null;
        
        // 隐藏回复提示条
        const replyHint = document.querySelector('.reply-hint');
        if (replyHint) {
            replyHint.style.display = 'none';
        }
        
        // 恢复输入框默认状态
        const commentInput = document.getElementById('commentInput');
        if (commentInput) {
            commentInput.placeholder = '发表评论...';
        }
    }
    
    // 获取指定评论的回复列表
    async fetchReplies(commentId, page = 1) {
        try {
            const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/comments/${encodeURIComponent(commentId)}/replies?page=${page}&limit=10`, {
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
            }
            
            const data = await response.json();
            
            return {
                items: data.data || [],
                page: data.pagination?.page || page,
                totalPages: data.pagination?.totalPages || 1,
                total: data.pagination?.total || 0,
                hasMore: page < (data.pagination?.totalPages || 1)
            };
        } catch (error) {
            console.error('获取回复失败:', error);
            return {
                items: [],
                page: 1,
                totalPages: 1,
                total: 0,
                hasMore: false
            };
        }
    }
    
    // 切换回复展开/收起状态
    async toggleReplies(commentId) {
        const isExpanded = this.repliesExpanded.has(commentId);
        
        if (isExpanded) {
            // 收起回复
            this.repliesExpanded.delete(commentId);
            const repliesSection = document.querySelector(`[data-comment-id="${commentId}"] .replies-section`);
            if (repliesSection) {
                repliesSection.innerHTML = '';
                repliesSection.style.display = 'none';
            }
            
            // 获取真实的回复总数
            let totalReplies = 0;
            const cached = this.repliesCache.get(commentId);
            if (cached && cached.total) {
                totalReplies = cached.total;
            } else {
                // 回退到按钮的data-count属性
                const toggleBtn = document.querySelector(`[data-comment-id="${commentId}"] .replies-toggle-btn`);
                if (toggleBtn && toggleBtn.dataset.count) {
                    totalReplies = parseInt(toggleBtn.dataset.count, 10) || 0;
                }
            }
            
            this.updateRepliesToggleUi(commentId, false, totalReplies);
        } else {
            // 展开回复
            this.repliesExpanded.add(commentId);
            await this.loadRepliesForComment(commentId, 1);
        }
    }
    
    // 为指定评论加载回复
    async loadRepliesForComment(commentId, page = 1) {
        const repliesData = await this.fetchReplies(commentId, page);
        
        // 更新缓存
        if (page === 1) {
            this.repliesCache.set(commentId, repliesData);
        } else {
            const cached = this.repliesCache.get(commentId) || { items: [] };
            cached.items = [...cached.items, ...repliesData.items];
            cached.page = repliesData.page;
            cached.totalPages = repliesData.totalPages;
            cached.total = repliesData.total;
            cached.hasMore = repliesData.hasMore;
            this.repliesCache.set(commentId, cached);
        }
        
        // 渲染回复
        this.paintReplies(commentId);
        
        // 更新切换按钮UI
        const cached = this.repliesCache.get(commentId);
        this.updateRepliesToggleUi(commentId, true, cached.total);
    }
    
    // 加载更多回复
    async loadMoreReplies(commentId) {
        const cached = this.repliesCache.get(commentId);
        if (!cached || !cached.hasMore) return;
        
        const nextPage = cached.page + 1;
        await this.loadRepliesForComment(commentId, nextPage);
    }
    
    // 渲染回复列表
    paintReplies(commentId) {
        const cached = this.repliesCache.get(commentId);
        if (!cached || !cached.items.length) return;
        
        const repliesSection = document.querySelector(`[data-comment-id="${commentId}"] .replies-section`);
        if (!repliesSection) return;
        
        let html = '<div class="replies-container">';
        
        // 渲染回复项
        cached.items.forEach(reply => {
            html += this.renderReplyItem(reply);
        });
        
        // 添加"加载更多"按钮
        if (cached.hasMore) {
            html += `
                <div class="load-more-replies">
                    <button class="load-more-replies-btn" data-comment-id="${commentId}">
                        加载更多回复 (${cached.total - cached.items.length})
                    </button>
                </div>
            `;
        }
        
        html += '</div>';
        repliesSection.innerHTML = html;
        repliesSection.style.display = 'block';
    }
    
    // 渲染单个回复项
    renderReplyItem(reply) {
        // 确保时间字段有默认值，避免 Invalid Date
        const timestamp = reply.createdAt ?? reply.created_at ?? new Date().toISOString();
        const timeAgo = this.formatTimeAgo(timestamp);
        return `
            <div class="reply-item" data-reply-id="${reply.id}">
                <div class="reply-content">
                    <div class="reply-header">
                        <span class="reply-author">${this.escapeHtml(reply.username)}</span>
                        <span class="reply-time">${timeAgo}</span>
                    </div>
                    <div class="reply-text">${this.escapeHtml(reply.content)}</div>
                </div>
            </div>
        `;
    }
    
    // 更新回复切换按钮UI
    updateRepliesToggleUi(commentId, isExpanded, totalReplies) {
        let toggleBtn = document.querySelector(`[data-comment-id="${commentId}"] .replies-toggle-btn`);
        
        // 如果按钮不存在且有回复，则创建按钮
        if (!toggleBtn && totalReplies > 0) {
            const commentActionsLeft = document.querySelector(`[data-comment-id="${commentId}"] .comment-actions-left`);
            if (commentActionsLeft) {
                toggleBtn = document.createElement('button');
                toggleBtn.className = 'replies-toggle-btn';
                toggleBtn.setAttribute('data-comment-id', commentId);
                toggleBtn.setAttribute('data-count', String(totalReplies));
                
                // 插入到回复按钮之后
                const replyBtn = commentActionsLeft.querySelector('.comment-reply-btn');
                if (replyBtn && replyBtn.nextSibling) {
                    commentActionsLeft.insertBefore(toggleBtn, replyBtn.nextSibling);
                } else {
                    commentActionsLeft.appendChild(toggleBtn);
                }
            }
        }
        
        if (!toggleBtn) return;
        
        if (totalReplies === 0) {
            toggleBtn.hidden = true;
            return;
        }
        
        // 让CSS接管显示与布局，避免内联display覆盖inline-flex
        toggleBtn.hidden = false;
        toggleBtn.style.removeProperty('display');
        toggleBtn.textContent = isExpanded 
            ? `收起回复 (${totalReplies})` 
            : `查看 ${totalReplies} 条回复`;
        toggleBtn.setAttribute('data-expanded', isExpanded.toString());
        
        // 回填data-count属性，确保数据一致性
        toggleBtn.dataset.count = String(totalReplies);
    }
    
    // 处理新回复的即时插入
    async handleNewReply(parentCommentId, newReplyData) {
        // 确保回复区域已展开
        if (!this.repliesExpanded.has(parentCommentId)) {
            this.repliesExpanded.add(parentCommentId);
        }
        
        // 标准化新回复数据的时间字段，避免 Invalid Date
        if (!newReplyData.createdAt && !newReplyData.created_at) {
            newReplyData.createdAt = new Date().toISOString();
        } else if (!newReplyData.createdAt && newReplyData.created_at) {
            newReplyData.createdAt = newReplyData.created_at;
        }
        
        // 更新缓存中的回复数据
        let cached = this.repliesCache.get(parentCommentId);
        if (!cached) {
            // 如果没有缓存，创建新的缓存项
            cached = {
                items: [],
                page: 1,
                totalPages: 1,
                total: 0,
                hasMore: false
            };
        }
        
        // 将新回复添加到缓存的开头（最新回复在前）
        cached.items.unshift(newReplyData);
        cached.total += 1;
        this.repliesCache.set(parentCommentId, cached);
        
        // 重新渲染回复列表
        this.paintReplies(parentCommentId);
        
        // 更新父评论的回复数显示
        const parentComment = document.querySelector(`[data-comment-id="${parentCommentId}"]`);
        if (parentComment) {
            // 更新回复数显示
            const repliesCountSpan = parentComment.querySelector('.replies-count');
            if (repliesCountSpan) {
                const currentCount = parseInt(repliesCountSpan.textContent) || 0;
                repliesCountSpan.textContent = currentCount + 1;
            }
            
            // 更新切换按钮UI
            this.updateRepliesToggleUi(parentCommentId, true, cached.total);
        }
    }
    
    // 更新可访问性属性
    updateAccessibilityAttributes() {
        const panelEl = this.socialPanel && this.socialPanel.getElement ? this.socialPanel.getElement() : null;
        
        if (this.socialState.isSocialMode) {
            if (panelEl) {
                panelEl.setAttribute('aria-hidden', 'false');
                panelEl.setAttribute('role', 'dialog');
                panelEl.setAttribute('aria-modal', 'true');
                const titleId = (this.socialPanel && this.socialPanel.titleEl && this.socialPanel.titleEl.id) ? this.socialPanel.titleEl.id : '';
                panelEl.setAttribute('aria-labelledby', titleId);
                
                // 设置焦点陷阱
                this.currentFocusTrap = this.setupFocusTrap(panelEl);
            }
        } else {
            if (panelEl) {
                panelEl.setAttribute('aria-hidden', 'true');
                panelEl.removeAttribute('role');
                panelEl.removeAttribute('aria-modal');
                panelEl.removeAttribute('aria-labelledby');
            }
            // 移除焦点陷阱
            this.removeFocusTrap();
        }
    }
    
    // ==================== 通知隐藏列表工具方法 ====================
    
    // 获取用户作用域的存储键
    getUserScopedStorageKey() {
        try {
            if (this.userToken) {
                const payload = JSON.parse(atob(this.userToken.split('.')[1]));
                const userId = payload.id || payload.userId || payload.email || 'anonymous';
                return `dc_hidden_notifications_v1:${userId}`;
            }
        } catch (e) {
            console.warn('解析用户token失败，使用匿名存储:', e);
        }
        return 'dc_hidden_notifications_v1:anonymous';
    }
    
    // 从localStorage读取隐藏列表
    loadHiddenSet() {
        try {
            const key = this.getUserScopedStorageKey();
            const stored = localStorage.getItem(key);
            if (stored) {
                const hiddenArray = JSON.parse(stored);
                return new Set(hiddenArray);
            }
        } catch (e) {
            console.warn('读取隐藏列表失败:', e);
        }
        return new Set();
    }
    
    // 保存隐藏列表到localStorage
    saveHiddenSet(hiddenSet) {
        try {
            const key = this.getUserScopedStorageKey();
            const hiddenArray = Array.from(hiddenSet);
            localStorage.setItem(key, JSON.stringify(hiddenArray));
        } catch (e) {
            console.warn('保存隐藏列表失败:', e);
        }
    }
    
    // 检查通知是否已隐藏
    isHidden(id) {
        const hiddenSet = this.loadHiddenSet();
        return hiddenSet.has(String(id));
    }
    
    // 添加单个通知到隐藏列表
    addHidden(id) {
        const hiddenSet = this.loadHiddenSet();
        hiddenSet.add(String(id));
        this.saveHiddenSet(hiddenSet);
    }
    
    // 批量添加通知到隐藏列表
    addHiddenBatch(ids) {
        const hiddenSet = this.loadHiddenSet();
        ids.forEach(id => hiddenSet.add(String(id)));
        this.saveHiddenSet(hiddenSet);
    }

    // ==================== 通知系统相关方法 ====================
    
    setupNotificationEvents() {
        const closeBtn = document.getElementById('closeNotificationPanel');
        const overlay = document.getElementById('notificationOverlay');
        const markAllReadBtn = document.getElementById('markAllReadBtn');
        const deleteAllBtn = document.getElementById('deleteAllBtn');
        
        if (closeBtn) {
            closeBtn.onclick = () => this.hideNotificationPanel();
        }
        
        if (overlay) {
            overlay.onclick = () => this.hideNotificationPanel();
        }
        
        if (markAllReadBtn) {
            markAllReadBtn.onclick = () => this.markAllNotificationsRead();
        }
        
        if (deleteAllBtn) {
            deleteAllBtn.onclick = () => this.handleDeleteAllNotifications();
        }
        
        // ESC键关闭面板
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('notificationPanel');
                if (panel && panel.style.display !== 'none') {
                    this.hideNotificationPanel();
                }
            }
        });
    }
    
    async showNotificationPanel() {
        const panel = document.getElementById('notificationPanel');
        const overlay = document.getElementById('notificationOverlay');
        
        if (!panel || !overlay) return;
        
        // 显示面板和遮罩
        overlay.style.display = 'block';
        panel.style.display = 'flex';
        document.body.classList.add('modal-open');
        
        // 加载通知列表
        await this.loadNotifications(true);
    }
    
    hideNotificationPanel() {
        const panel = document.getElementById('notificationPanel');
        const overlay = document.getElementById('notificationOverlay');
        
        if (panel) panel.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
    
    async loadNotifications(reset = false, retryCount = 0) {
        if (!this.isLoggedIn()) return;
        
        if (reset) {
            this.notificationState.currentPage = 1;
            this.notificationState.notifications = [];
            this.notificationState.hasMore = true;
        }
        
        if (this.notificationState.loading || !this.notificationState.hasMore) return;
        
        const maxRetries = 2;
        const timeout = 8000; // 8秒超时
        
        this.notificationState.loading = true;
        this.showNotificationLoading();
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(`${API_BASE_URL}/api/notifications?page=${this.notificationState.currentPage}&limit=20`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('认证失败，停止通知轮询');
                    this.stopNotificationPolling();
                    return;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (reset) {
                this.notificationState.notifications = data.notifications || [];
            } else {
                this.notificationState.notifications.push(...(data.notifications || []));
            }
            
            this.notificationState.hasMore = data.hasMore || false;
            this.notificationState.currentPage++;
            
            this.renderNotifications();
            
        } catch (error) {
            console.error('加载通知失败:', error);
            
            if (error.name === 'AbortError') {
                console.warn('通知加载请求超时');
            }
            
            if (retryCount < maxRetries) {
                const delay = (retryCount + 1) * 1000; // 1秒、2秒递增延迟
                console.log(`${delay/1000}秒后重试加载通知 (${retryCount + 1}/${maxRetries})`);
                
                setTimeout(() => {
                    this.loadNotifications(reset, retryCount + 1);
                }, delay);
                return; // 不执行finally块，保持loading状态
            } else {
                this.showNotificationError('加载通知失败，请稍后重试');
            }
        } finally {
            this.notificationState.loading = false;
            this.hideNotificationLoading();
        }
    }
    
    renderNotifications() {
        const listEl = document.getElementById('notificationList');
        const emptyEl = document.getElementById('notificationEmpty');
        
        if (!listEl || !emptyEl) return;
        
        // 过滤已隐藏的通知
        const visibleNotifications = this.notificationState.notifications.filter(notification => {
            return !this.isHidden(notification.id);
        });
        
        if (visibleNotifications.length === 0) {
            listEl.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        
        emptyEl.style.display = 'none';
        
        const html = visibleNotifications.map(notification => {
            const isUnread = !notification.isRead;
            const typeClass = notification.type === 'mention' ? 'mention' : 'system';
            const typeText = notification.type === 'mention' ? '@提及' : '系统通知';
            
            return `
                <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${notification.id}" data-link="${notification.linkUrl || ''}">
                    <div class="notification-title">${this.escapeHtml(notification.title)}</div>
                    <div class="notification-content-text">${this.escapeHtml(notification.content)}</div>
                    <div class="notification-meta">
                        <div class="meta-left">
                            <span class="notification-time">${this.formatTimeAgo(notification.createdAt)}</span>
                            <span class="notification-type ${typeClass}">${typeText}</span>
                        </div>
                        <button class="notification-delete" title="删除此消息" aria-label="删除此消息">删除</button>
                    </div>
                </div>
            `;
        }).join('');
        
        listEl.innerHTML = html;
        
        // 绑定点击事件
        listEl.querySelectorAll('.notification-item').forEach(item => {
            // 绑定通知项点击事件（排除删除按钮）
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.notification-delete')) {
                    this.handleNotificationClick(item);
                }
            });
            
            // 绑定删除按钮点击事件
            const deleteBtn = item.querySelector('.notification-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleNotificationDelete(item.dataset.id);
                });
            }
        });
    }
    
    // 处理单个通知删除
    handleNotificationDelete(notificationId) {
        try {
            // 添加到隐藏列表
            this.addHidden(notificationId);
            
            // 重新渲染通知列表
            this.renderNotifications();
            
            // 更新未读计数（如果删除的是未读通知）
            const deletedNotification = this.notificationState.notifications.find(n => n.id == notificationId);
            if (deletedNotification && !deletedNotification.isRead) {
                this.notificationState.unreadCount = Math.max(0, this.notificationState.unreadCount - 1);
                this.updateNotificationBadge();
            }
            
            console.log('通知已隐藏:', notificationId);
        } catch (error) {
            console.error('删除通知失败:', error);
        }
    }
    
    // 处理全部删除
    handleDeleteAllNotifications() {
        try {
            // 获取当前可见的通知ID列表
            const visibleNotifications = this.notificationState.notifications.filter(notification => {
                return !this.isHidden(notification.id);
            });
            
            if (visibleNotifications.length === 0) {
                return;
            }
            
            // 批量添加到隐藏列表
            const visibleIds = visibleNotifications.map(n => n.id);
            this.addHiddenBatch(visibleIds);
            
            // 重新渲染通知列表
            this.renderNotifications();
            
            // 更新未读计数（减去被删除的未读通知数量）
            const deletedUnreadCount = visibleNotifications.filter(n => !n.isRead).length;
            this.notificationState.unreadCount = Math.max(0, this.notificationState.unreadCount - deletedUnreadCount);
            this.updateNotificationBadge();
            
            console.log('已隐藏所有可见通知:', visibleIds.length, '条');
        } catch (error) {
            console.error('批量删除通知失败:', error);
        }
    }

    async handleNotificationClick(item) {
        const notificationId = item.dataset.id;
        const linkUrl = item.dataset.link;
        
        // 标记为已读
        if (item.classList.contains('unread')) {
            await this.markNotificationRead(notificationId);
            item.classList.remove('unread');
            
            // 更新内存中的通知状态
            const notification = this.notificationState.notifications.find(n => n.id == notificationId);
            if (notification) {
                notification.isRead = true;
            }
            
            // 更新未读数
            this.notificationState.unreadCount = Math.max(0, this.notificationState.unreadCount - 1);
            this.updateNotificationBadge();
        }
        
        // 如果有链接，跳转到对应页面
        if (linkUrl && linkUrl.trim()) {
            this.hideNotificationPanel();
            
            // 如果是当前页面的锚点链接，直接滚动
            if (linkUrl.startsWith('#')) {
                const targetEl = document.querySelector(linkUrl);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                // 否则跳转到新页面
                window.open(linkUrl, '_blank');
            }
        }
    }
    
    async markNotificationRead(notificationId) {
        if (!this.isLoggedIn()) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/notifications/${notificationId}/read`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('标记通知已读失败:', error);
            this.showToast('标记已读失败，请重试', 'error');
        }
    }
    
    async markAllNotificationsRead() {
        if (!this.isLoggedIn()) return;
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/notifications/read-all`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            
            // 更新UI
            this.notificationState.unreadCount = 0;
            this.updateNotificationBadge();
            
            // 更新内存中所有通知状态
            this.notificationState.notifications.forEach(notification => {
                notification.isRead = true;
            });
            
            // 移除所有未读标记
            const unreadItems = document.querySelectorAll('.notification-item.unread');
            unreadItems.forEach(item => item.classList.remove('unread'));
            
            this.showToast('所有通知已标记为已读', 'success');
            
        } catch (error) {
            console.error('标记所有通知已读失败:', error);
            this.showToast('操作失败，请重试', 'error');
        }
    }
    
    async fetchUnreadCount(retryCount = 0) {
        if (!this.isLoggedIn()) return;
        
        const maxRetries = 3;
        const timeout = 5000; // 5秒超时
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            
            const response = await fetch(`${API_BASE_URL}/api/notifications/unread-count?_t=${Date.now()}`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                },
                cache: 'no-store',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                // 优先读取 unreadCount，其次读取 count，确保兼容性
                const count = data.unreadCount !== undefined ? data.unreadCount : (data.count || 0);
                // 确保是数字类型
                this.notificationState.unreadCount = typeof count === 'number' ? count : parseInt(count) || 0;
                this.updateNotificationBadge();
                // 重置重试计数
                this.notificationRetryCount = 0;
            } else if (response.status === 401) {
                // 认证失败，停止轮询
                console.warn('认证失败，停止通知轮询');
                this.stopNotificationPolling();
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('获取未读通知数失败:', error);
            
            // 如果是认证错误或达到最大重试次数，不再重试
            if (error.name === 'AbortError') {
                console.warn('请求超时');
            }
            
            if (retryCount < maxRetries) {
                // 指数退避重试：1秒、2秒、4秒
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`${delay/1000}秒后重试 (${retryCount + 1}/${maxRetries})`);
                
                setTimeout(() => {
                    this.fetchUnreadCount(retryCount + 1);
                }, delay);
            } else {
                console.error('达到最大重试次数，停止重试');
            }
        }
    }
    
    updateNotificationBadge() {
        const badge = document.getElementById('notificationBadge');
        if (!badge) return;
        
        const count = this.notificationState.unreadCount;
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count.toString();
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
    
    // 防抖函数，避免频繁请求
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    startNotificationPolling() {
        if (this.notificationState.isPolling) return;
        
        this.notificationState.isPolling = true;
        
        // 创建防抖的获取函数，避免重复请求
        if (!this.debouncedFetchUnreadCount) {
            this.debouncedFetchUnreadCount = this.debounce(this.fetchUnreadCount.bind(this), 1000);
        }
        
        // 立即获取一次未读数
        this.fetchUnreadCount();
        
        // 每10秒轮询一次，使用防抖优化
        this.notificationState.pollInterval = setInterval(() => {
            this.debouncedFetchUnreadCount();
        }, 10000);
    }
    
    stopNotificationPolling() {
        if (!this.notificationState.isPolling) return;
        
        this.notificationState.isPolling = false;
        
        if (this.notificationState.pollInterval) {
            clearInterval(this.notificationState.pollInterval);
            this.notificationState.pollInterval = null;
        }
        
        // 清空未读数
        this.notificationState.unreadCount = 0;
        this.updateNotificationBadge();
    }
    
    showNotificationLoading() {
        const loadingEl = document.getElementById('notificationLoading');
        if (loadingEl) loadingEl.style.display = 'block';
    }
    
    hideNotificationLoading() {
        const loadingEl = document.getElementById('notificationLoading');
        if (loadingEl) loadingEl.style.display = 'none';
    }
    
    showNotificationError(message) {
        const listEl = document.getElementById('notificationList');
        if (listEl) {
            listEl.innerHTML = `<div class="notification-empty"><p>${message}</p></div>`;
        }
    }
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    // 单例守卫：若已存在实例则先销毁
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
    }

    // 动态测量头部高度并写入 CSS 变量 --app-header
    const headerEl = document.querySelector('.header');
    const updateAppHeaderVar = () => {
        const h = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 0; // 含边框，向上取整避免 1px 截断
        document.documentElement.style.setProperty('--app-header', `${h}px`);
    };
    updateAppHeaderVar();
    
    // 监听头部高度变化：响应式换行、控件显示/隐藏、窗口缩放
    if (window.ResizeObserver && headerEl) {
        const ro = new ResizeObserver(() => updateAppHeaderVar());
        ro.observe(headerEl);
    }
    window.addEventListener('resize', updateAppHeaderVar);

    window.videoPlayerInstance = new VideoPlayer();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
        window.videoPlayerInstance = null;
    }
});