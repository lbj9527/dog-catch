// Dog-Catch 轻量级 UI 组件系统
// 根据 README.md 第105-109行要求实现

class DogCatchUIComponents {
    constructor() {
        this.icons = this.initIconSystem();
        this.animations = this.initAnimationSystem();
        this.components = new Map();
        
        this.init();
    }
    
    init() {
        // 注入轻量级 CSS 框架
        this.injectLightweightCSS();
        
        // 初始化组件注册表
        this.registerComponents();
    }
    
    // 轻量级图标系统 - 基于 Feather Icons 风格
    initIconSystem() {
        return {
            // 媒体相关图标
            play: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 19,12 5,21"></polygon></svg>`,
            pause: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`,
            stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`,
            volume: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
            volumeOff: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
            
            // 操作相关图标
            download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
            copy: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
            search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>`,
            settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m11-7h-6m-6 0H1m17-4a4 4 0 0 1-8 0 4 4 0 0 1 8 0zM7 17a4 4 0 0 1-8 0 4 4 0 0 1 8 0z"></path></svg>`,
            
            // 界面控制图标
            minimize: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
            maximize: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>`,
            close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
            pin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5m-8-5h16l-1-7h-14z"></path></svg>`,
            
            // 状态指示图标
            loading: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`,
            success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"></polyline></svg>`,
            error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
            warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
            
            // 文件类型图标
            video: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23,7 16,12 23,17"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`,
            audio: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`,
            image: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21,15 16,10 5,21"></polyline></svg>`,
            document: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2Z"></path><polyline points="14,2 14,8 20,8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10,9 9,9 8,9"></polyline></svg>`
        };
    }
    
    // CSS3 原生动画系统
    initAnimationSystem() {
        return {
            // 淡入淡出
            fadeIn: 'dog-catch-fade-in 0.3s ease-out',
            fadeOut: 'dog-catch-fade-out 0.3s ease-out',
            
            // 滑动动画
            slideInRight: 'dog-catch-slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            slideOutRight: 'dog-catch-slide-out-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            slideInUp: 'dog-catch-slide-in-up 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            slideOutDown: 'dog-catch-slide-out-down 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            
            // 缩放动画
            scaleIn: 'dog-catch-scale-in 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            scaleOut: 'dog-catch-scale-out 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            
            // 旋转动画
            spin: 'dog-catch-spin 1s linear infinite',
            
            // 弹跳动画
            bounce: 'dog-catch-bounce 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            
            // 脉冲动画
            pulse: 'dog-catch-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        };
    }
    
    // 注入轻量级 CSS 框架
    injectLightweightCSS() {
        if (document.getElementById('dog-catch-ui-framework')) return;
        
        const style = document.createElement('style');
        style.id = 'dog-catch-ui-framework';
        style.textContent = this.getLightweightCSS();
        document.head.appendChild(style);
    }
    
    getLightweightCSS() {
        return `
            /* Dog-Catch 轻量级 UI 框架 */
            
            /* CSS3 动画定义 */
            @keyframes dog-catch-fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            
            @keyframes dog-catch-fade-out {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            
            @keyframes dog-catch-slide-in-right {
                from { 
                    opacity: 0; 
                    transform: translateX(100%); 
                }
                to { 
                    opacity: 1; 
                    transform: translateX(0); 
                }
            }
            
            @keyframes dog-catch-slide-out-right {
                from { 
                    opacity: 1; 
                    transform: translateX(0); 
                }
                to { 
                    opacity: 0; 
                    transform: translateX(100%); 
                }
            }
            
            @keyframes dog-catch-slide-in-up {
                from { 
                    opacity: 0; 
                    transform: translateY(100%); 
                }
                to { 
                    opacity: 1; 
                    transform: translateY(0); 
                }
            }
            
            @keyframes dog-catch-slide-out-down {
                from { 
                    opacity: 1; 
                    transform: translateY(0); 
                }
                to { 
                    opacity: 0; 
                    transform: translateY(100%); 
                }
            }
            
            @keyframes dog-catch-scale-in {
                from { 
                    opacity: 0; 
                    transform: scale(0.8); 
                }
                to { 
                    opacity: 1; 
                    transform: scale(1); 
                }
            }
            
            @keyframes dog-catch-scale-out {
                from { 
                    opacity: 1; 
                    transform: scale(1); 
                }
                to { 
                    opacity: 0; 
                    transform: scale(0.8); 
                }
            }
            
            @keyframes dog-catch-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            @keyframes dog-catch-bounce {
                0%, 20%, 53%, 80%, 100% {
                    animation-timing-function: cubic-bezier(0.215, 0.610, 0.355, 1.000);
                    transform: translate3d(0,0,0);
                }
                40%, 43% {
                    animation-timing-function: cubic-bezier(0.755, 0.050, 0.855, 0.060);
                    transform: translate3d(0, -30px, 0);
                }
                70% {
                    animation-timing-function: cubic-bezier(0.755, 0.050, 0.855, 0.060);
                    transform: translate3d(0, -15px, 0);
                }
                90% {
                    transform: translate3d(0,-4px,0);
                }
            }
            
            @keyframes dog-catch-pulse {
                0%, 100% {
                    opacity: 1;
                }
                50% {
                    opacity: .5;
                }
            }
            
            /* 轻量级组件样式 */
            .dog-catch-component {
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                           "Helvetica Neue", Arial, "Noto Sans", sans-serif;
            }
            
            .dog-catch-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                padding: 8px 16px;
                border: 1px solid transparent;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                line-height: 1.5;
                text-decoration: none;
                cursor: pointer;
                transition: all 0.2s ease;
                user-select: none;
                white-space: nowrap;
            }
            
            .dog-catch-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            .dog-catch-btn:active {
                transform: translateY(0);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            }
            
            .dog-catch-btn-primary {
                background: linear-gradient(135deg, #2196F3, #1976D2);
                color: white;
                border-color: #1976D2;
            }
            
            .dog-catch-btn-secondary {
                background: #f8f9fa;
                color: #495057;
                border-color: #dee2e6;
            }
            
            .dog-catch-btn-success {
                background: linear-gradient(135deg, #4CAF50, #388E3C);
                color: white;
                border-color: #388E3C;
            }
            
            .dog-catch-btn-danger {
                background: linear-gradient(135deg, #f44336, #d32f2f);
                color: white;
                border-color: #d32f2f;
            }
            
            .dog-catch-card {
                background: white;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 16px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                transition: all 0.2s ease;
            }
            
            .dog-catch-card:hover {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                transform: translateY(-2px);
            }
            
            .dog-catch-loading {
                display: inline-block;
                animation: ${this.animations.spin};
            }
            
            .dog-catch-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
            }
            
            .dog-catch-icon svg {
                width: 100%;
                height: 100%;
            }
        `;
    }
    
    // 注册可复用组件
    registerComponents() {
        // 按钮组件
        this.components.set('button', this.createButtonComponent.bind(this));
        
        // 卡片组件
        this.components.set('card', this.createCardComponent.bind(this));
        
        // 加载指示器组件
        this.components.set('loading', this.createLoadingComponent.bind(this));
        
        // 图标组件
        this.components.set('icon', this.createIconComponent.bind(this));
        
        // 通知组件
        this.components.set('notification', this.createNotificationComponent.bind(this));
    }
    
    // 创建按钮组件
    createButtonComponent(options = {}) {
        const {
            type = 'primary',
            size = 'medium',
            icon = null,
            text = '',
            onClick = null,
            disabled = false,
            loading = false
        } = options;
        
        const button = document.createElement('button');
        button.className = `dog-catch-component dog-catch-btn dog-catch-btn-${type}`;
        
        if (loading) {
            button.innerHTML = `
                <span class="dog-catch-icon dog-catch-loading">
                    ${this.icons.loading}
                </span>
                <span>加载中...</span>
            `;
            button.disabled = true;
        } else {
            button.innerHTML = `
                ${icon ? `<span class="dog-catch-icon">${this.icons[icon] || icon}</span>` : ''}
                ${text ? `<span>${text}</span>` : ''}
            `;
        }
        
        if (disabled) {
            button.disabled = true;
        }
        
        if (onClick) {
            button.addEventListener('click', onClick);
        }
        
        return button;
    }
    
    // 创建卡片组件
    createCardComponent(options = {}) {
        const { content = '', className = '' } = options;
        
        const card = document.createElement('div');
        card.className = `dog-catch-component dog-catch-card ${className}`;
        card.innerHTML = content;
        
        return card;
    }
    
    // 创建加载指示器组件
    createLoadingComponent(options = {}) {
        const { text = '加载中...', size = 'medium' } = options;
        
        const loading = document.createElement('div');
        loading.className = 'dog-catch-component';
        loading.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="dog-catch-icon dog-catch-loading">
                    ${this.icons.loading}
                </span>
                <span>${text}</span>
            </div>
        `;
        
        return loading;
    }
    
    // 创建图标组件
    createIconComponent(iconName, options = {}) {
        const { size = 16, color = 'currentColor' } = options;
        
        const icon = document.createElement('span');
        icon.className = 'dog-catch-component dog-catch-icon';
        icon.style.color = color;
        icon.innerHTML = this.icons[iconName] || iconName;
        
        return icon;
    }
    
    // 创建通知组件
    createNotificationComponent(options = {}) {
        const {
            type = 'info',
            title = '',
            message = '',
            duration = 3000,
            closable = true
        } = options;
        
        const notification = document.createElement('div');
        notification.className = `dog-catch-component dog-catch-notification dog-catch-notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 2147483647;
            max-width: 400px;
            animation: ${this.animations.slideInRight};
        `;
        
        const iconMap = {
            success: this.icons.success,
            error: this.icons.error,
            warning: this.icons.warning,
            info: this.icons.settings
        };
        
        notification.innerHTML = `
            <div style="display: flex; gap: 12px;">
                <span class="dog-catch-icon" style="color: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : type === 'warning' ? '#FF9800' : '#2196F3'};">
                    ${iconMap[type]}
                </span>
                <div style="flex: 1;">
                    ${title ? `<div style="font-weight: 600; margin-bottom: 4px;">${title}</div>` : ''}
                    <div>${message}</div>
                </div>
                ${closable ? `
                    <button style="background: none; border: none; cursor: pointer; padding: 0; color: #999;">
                        ${this.icons.close}
                    </button>
                ` : ''}
            </div>
        `;
        
        // 自动关闭
        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = this.animations.slideOutRight;
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, duration);
        }
        
        // 手动关闭
        if (closable) {
            const closeBtn = notification.querySelector('button');
            closeBtn.addEventListener('click', () => {
                notification.style.animation = this.animations.slideOutRight;
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            });
        }
        
        return notification;
    }
    
    // 获取图标
    getIcon(name) {
        return this.icons[name] || '';
    }
    
    // 获取动画
    getAnimation(name) {
        return this.animations[name] || '';
    }
    
    // 创建组件
    createComponent(type, options = {}) {
        const componentFactory = this.components.get(type);
        if (componentFactory) {
            return componentFactory(options);
        }
        throw new Error(`Unknown component type: ${type}`);
    }
}

// 全局实例
if (typeof window !== 'undefined' && !window.dogCatchUI) {
    window.dogCatchUI = new DogCatchUIComponents();
}
