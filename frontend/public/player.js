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
        
        this.init();
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
    }
    
    isLoggedIn() { return !!this.userToken; }

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
            const label = (Number(v.variant) || 1) === 1 ? '字幕(默认)' : `字幕(版本${v.variant})`;
            option.textContent = label;
            if (v.video_id === activeVideoId) option.selected = true;
            select.appendChild(option);
        });
        select.style.display = 'inline-block';
        select.disabled = false;
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
    async fetchLikeStatus() {
        if (!this.currentVideoId) return;
        
        try {
            const base = (API_BASE_URL || (window.PLAYER_CONFIG?.API_BASE_URL || '')).replace(/\/$/, '');
            const headers = this.userToken ? { Authorization: `Bearer ${this.userToken}` } : {};
            const response = await fetch(`${base}/api/subtitles/like-status/${this.currentVideoId}`, { headers });
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
            } else if (response.status === 401) {
                // 未授权则重置状态但不报错
                this.currentLikeStatus = { isLiked: false, likesCount: Number(this.currentLikeStatus.likesCount || 0) };
                this.updateLikeUI();
            }
        } catch (error) {
            console.error('获取点赞状态失败:', error);
        }
    }
    
    // 切换点赞状态
    async toggleLike() {
        if (!this.currentVideoId) {
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
            const url = `${base}/api/subtitles/like-toggle/${this.currentVideoId}`;
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
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    // 单例守卫：若已存在实例则先销毁
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
    }
    window.videoPlayerInstance = new VideoPlayer();
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', () => {
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.destroy === 'function') {
        try { window.videoPlayerInstance.destroy(); } catch {}
        window.videoPlayerInstance = null;
    }
});