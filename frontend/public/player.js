// 播放器主逻辑
const API_BASE_URL = new URLSearchParams(location.search).get('api') || (window.PLAYER_CONFIG && window.PLAYER_CONFIG.API_BASE_URL) || 'https://api.sub-dog.top';
const REQUIRE_SUBTITLE_LOGIN = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.SUBTITLE_NEED_LOGIN) !== false;
const ALLOW_PLAY_WITHOUT_LOGIN = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.ALLOW_PLAY_WITHOUT_LOGIN) !== false;
const CAPTCHA_SITE_KEY = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.CAPTCHA_SITE_KEY) || '10000000-ffff-ffff-ffff-000000000001';
const ENABLE_CAPTCHA = (window.PLAYER_CONFIG && window.PLAYER_CONFIG.CAPTCHA_ENABLED) === true;
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
        
        this.init();
    }

    // XSS 防护：转义 HTML 特殊字符
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
        const topReserve = Math.max(playerRect.top, 60);
        
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
        const windowWidth = window.innerWidth;
        this.socialState.isMobile = windowWidth <= 800;
        // 桌面端始终禁用抽屉模式，统一为并排模式
        this.socialState.isDrawerMode = false;
    }
    
    // 设置社交事件监听器
    setupSocialEventListeners() {
        // 获取社交入口按钮
        const btnSubComment = document.getElementById('btnSubComment');
        const btnUserPlaza = document.getElementById('btnUserPlaza');
        const btnRealtimeChat = document.getElementById('btnRealtimeChat');
        
        // 获取关闭按钮
        const socialPanelClose = document.querySelector('.social-panel-close');
        
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
        
        // 绑定关闭按钮事件
        if (socialPanelClose) {
            socialPanelClose.addEventListener('click', () => {
                this.closeSocialMode();
            });
        }
    }
    
    // 切换社交功能
    toggleSocialFeature(feature) {
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
    }
    
    // 关闭社交模式
    closeSocialMode() {
        this.socialState.isSocialMode = false;
        this.socialState.activeFeature = null;
        
        this.updateSocialLayout();
        this.updateSocialButtonsState();
        this.updateAccessibilityAttributes();
    }
    
    // 更新社交布局
    updateSocialLayout() {
        const stage = document.querySelector('.stage');
        const mobileInlinePanel = document.getElementById('mobileInlinePanel');
        const playerBox = document.querySelector('.player-box');
        
        if (!stage) return;
        
        // 依据视口状态切换类名，避免桌面端被移动端样式覆盖
        if (mobileInlinePanel) {
            if (this.socialState.isMobile) {
                mobileInlinePanel.classList.add('mobile-inline-panel');
            } else {
                mobileInlinePanel.classList.remove('mobile-inline-panel');
                mobileInlinePanel.classList.remove('slide-up');
                mobileInlinePanel.classList.remove('slide-down');
            }
        }
        
        if (this.socialState.isSocialMode) {
            if (this.socialState.isMobile) {
                // 移动端：显示内联面板
                stage.classList.remove('social-mode', 'parallel-mode');
                if (mobileInlinePanel) {
                    mobileInlinePanel.classList.add('active');
                    // 确保面板位于播放器容器内
                    if (playerBox && !playerBox.contains(mobileInlinePanel)) {
                        playerBox.appendChild(mobileInlinePanel);
                    }
                    // 清理桌面并排动画状态并取消任何待执行的入场动画
                    mobileInlinePanel.classList.remove('animate-in', 'slide-out');
                    if (this._socialAnimateInRaf1) { cancelAnimationFrame(this._socialAnimateInRaf1); this._socialAnimateInRaf1 = null; }
                    if (this._socialAnimateInRaf2) { cancelAnimationFrame(this._socialAnimateInRaf2); this._socialAnimateInRaf2 = null; }
                }
                // 移动端不需要列包装
                this.unwrapPlayerColumn();
            } else {
                // 桌面端：并排显示右侧面板
                stage.classList.add('social-mode', 'parallel-mode');
                
                // 添加播放器列容器
                this.wrapPlayerInColumn();
                
                if (mobileInlinePanel) {
                    mobileInlinePanel.classList.remove('active');
                    // 确保面板成为 .stage 的直接子项，且位于 .player-column 之后
                    if (mobileInlinePanel.parentElement !== stage) {
                        stage.appendChild(mobileInlinePanel);
                    }
                    const playerColumn = stage.querySelector('.player-column');
                    if (playerColumn && mobileInlinePanel.previousElementSibling !== playerColumn) {
                        stage.insertBefore(mobileInlinePanel, playerColumn.nextSibling);
                    }
                    // 清理可能残留的退出动画类
                    mobileInlinePanel.classList.remove('slide-out');
                    // 取消尚未执行的入场动画调度
                    if (this._socialAnimateInRaf1) { cancelAnimationFrame(this._socialAnimateInRaf1); this._socialAnimateInRaf1 = null; }
                    if (this._socialAnimateInRaf2) { cancelAnimationFrame(this._socialAnimateInRaf2); this._socialAnimateInRaf2 = null; }
                    // 错峰触发入场动画：等待两帧，确保布局稳定后再添加 animate-in
                    if (!mobileInlinePanel.classList.contains('animate-in')) {
                        this._socialAnimateInRaf1 = requestAnimationFrame(() => {
                            this._socialAnimateInRaf1 = null;
                            this._socialAnimateInRaf2 = requestAnimationFrame(() => {
                                this._socialAnimateInRaf2 = null;
                                const stillDesktopParallel = stage.classList.contains('parallel-mode') && !this.socialState.isMobile && this.socialState.isSocialMode;
                                if (stillDesktopParallel && mobileInlinePanel.parentElement === stage) {
                                    mobileInlinePanel.classList.add('animate-in');
                                }
                            });
                        });
                    }
                }
            }
        } else {
            // 关闭社交模式
            stage.classList.remove('social-mode', 'parallel-mode');
            
            if (mobileInlinePanel) {
                mobileInlinePanel.classList.remove('active');
                // 默认回归到播放器容器内
                if (playerBox && !playerBox.contains(mobileInlinePanel)) {
                    playerBox.appendChild(mobileInlinePanel);
                }
                // 清理动画状态并取消调度
                mobileInlinePanel.classList.remove('animate-in', 'slide-out');
                if (this._socialAnimateInRaf1) { cancelAnimationFrame(this._socialAnimateInRaf1); this._socialAnimateInRaf1 = null; }
                if (this._socialAnimateInRaf2) { cancelAnimationFrame(this._socialAnimateInRaf2); this._socialAnimateInRaf2 = null; }
            }
            
            // 移除播放器列容器
            this.unwrapPlayerColumn();
        }
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
    
    // 加载社交内容
    loadSocialContent(feature) {
        const mobileInlinePanelTitle = document.querySelector('#mobileInlinePanel .social-panel-title');
        const mobileInlinePanelContent = document.querySelector('#mobileInlinePanel .social-panel-content');
        
        let title = '';
        let content = '';
        
        switch (feature) {
            case 'subtitle-comment':
                title = '字幕评论';
                content = this.getSubtitleCommentContent();
                break;
            case 'user-plaza':
                title = '用户广场';
                content = this.getUserPlazaContent();
                break;
            case 'realtime-chat':
                title = '实时聊天';
                content = this.getRealtimeChatContent();
                break;
        }
        
        // 统一更新唯一的社交面板（mobileInlinePanel）
        if (mobileInlinePanelTitle) mobileInlinePanelTitle.textContent = title;
        if (mobileInlinePanelContent) mobileInlinePanelContent.innerHTML = content;
    }
    
    // 获取字幕评论内容
    getSubtitleCommentContent() {
        return `
            <div class="social-placeholder">
                <div class="placeholder-icon">💬</div>
                <h3>字幕评论</h3>
                <p>在这里可以查看和发表字幕相关的评论讨论。</p>
                <div class="placeholder-features">
                    <div class="feature-item">📝 发表评论</div>
                    <div class="feature-item">👍 点赞互动</div>
                    <div class="feature-item">🔗 分享讨论</div>
                </div>
                <p class="placeholder-note">功能开发中，敬请期待...</p>
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
    
    // 检查是否已登录
    isLoggedIn() {
        return !!this.userToken;
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
    
    // 更新可访问性属性
    updateAccessibilityAttributes() {
        const mobileInlinePanel = document.getElementById('mobileInlinePanel');
        
        if (this.socialState.isSocialMode) {
            // 统一使用 mobileInlinePanel 作为活动面板
            const activePanel = mobileInlinePanel;
            if (activePanel) {
                activePanel.setAttribute('aria-hidden', 'false');
                activePanel.setAttribute('role', 'dialog');
                activePanel.setAttribute('aria-modal', 'true');
                activePanel.setAttribute('aria-labelledby', activePanel.querySelector('.social-panel-title')?.id || '');
            }
            
            // 设置焦点陷阱
            if (activePanel) {
                this.currentFocusTrap = this.setupFocusTrap(activePanel);
            }
        } else {
            // 隐藏面板
            if (mobileInlinePanel) {
                mobileInlinePanel.setAttribute('aria-hidden', 'true');
                mobileInlinePanel.removeAttribute('role');
                mobileInlinePanel.removeAttribute('aria-modal');
                mobileInlinePanel.removeAttribute('aria-labelledby');
            }
            
            // 移除焦点陷阱
            this.removeFocusTrap();
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