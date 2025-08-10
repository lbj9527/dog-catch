// Dog-Catch 加载反馈和错误处理系统
// 根据 README.md 第129-130行要求实现

class DogCatchFeedbackSystem {
    constructor() {
        this.loadingStates = new Map();
        this.errorHandlers = new Map();
        this.notifications = new Map();
        this.retryQueue = new Map();
        
        this.init();
    }
    
    init() {
        // 初始化全局错误处理
        this.setupGlobalErrorHandling();
        
        // 初始化加载状态管理
        this.setupLoadingStateManagement();
        
        // 初始化通知系统
        this.setupNotificationSystem();
    }
    
    // 加载状态管理
    showLoading(key, options = {}) {
        const {
            message = '加载中...',
            progress = null,
            cancellable = false,
            timeout = 30000
        } = options;
        
        const loadingState = {
            key,
            message,
            progress,
            cancellable,
            startTime: Date.now(),
            timeout,
            element: null,
            timeoutId: null
        };
        
        // 创建加载界面
        loadingState.element = this.createLoadingElement(loadingState);
        
        // 设置超时处理
        if (timeout > 0) {
            loadingState.timeoutId = setTimeout(() => {
                this.handleLoadingTimeout(key);
            }, timeout);
        }
        
        this.loadingStates.set(key, loadingState);
        
        // 触发加载开始事件
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('loading:start', { key, options });
        }
        
        return loadingState;
    }
    
    updateLoading(key, options = {}) {
        const loadingState = this.loadingStates.get(key);
        if (!loadingState) return;
        
        const { message, progress } = options;
        
        if (message) {
            loadingState.message = message;
        }
        
        if (progress !== undefined) {
            loadingState.progress = progress;
        }
        
        // 更新界面
        this.updateLoadingElement(loadingState);
        
        // 触发加载更新事件
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('loading:update', { key, options });
        }
    }
    
    hideLoading(key) {
        const loadingState = this.loadingStates.get(key);
        if (!loadingState) return;
        
        // 清除超时
        if (loadingState.timeoutId) {
            clearTimeout(loadingState.timeoutId);
        }
        
        // 移除界面
        if (loadingState.element && loadingState.element.parentNode) {
            loadingState.element.style.animation = 'dog-catch-fade-out 0.3s ease-out';
            setTimeout(() => {
                if (loadingState.element.parentNode) {
                    loadingState.element.parentNode.removeChild(loadingState.element);
                }
            }, 300);
        }
        
        this.loadingStates.delete(key);
        
        // 触发加载结束事件
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('loading:end', { key });
        }
    }
    
    // 创建加载界面元素
    createLoadingElement(loadingState) {
        const overlay = document.createElement('div');
        overlay.className = 'dog-catch-loading-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483647;
            animation: dog-catch-fade-in 0.3s ease-out;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        
        const content = document.createElement('div');
        content.className = 'dog-catch-loading-content';
        content.style.cssText = `
            background: white;
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            text-align: center;
            min-width: 200px;
            max-width: 400px;
        `;
        
        content.innerHTML = `
            <div class="dog-catch-loading-spinner" style="
                width: 40px;
                height: 40px;
                border: 4px solid #f3f3f3;
                border-top: 4px solid #2196F3;
                border-radius: 50%;
                animation: dog-catch-spin 1s linear infinite;
                margin: 0 auto 16px;
            "></div>
            <div class="dog-catch-loading-message" style="
                font-size: 16px;
                color: #333;
                margin-bottom: 8px;
            ">${loadingState.message}</div>
            ${loadingState.progress !== null ? `
                <div class="dog-catch-loading-progress" style="
                    width: 100%;
                    height: 4px;
                    background: #f0f0f0;
                    border-radius: 2px;
                    overflow: hidden;
                    margin-bottom: 16px;
                ">
                    <div style="
                        width: ${loadingState.progress}%;
                        height: 100%;
                        background: #2196F3;
                        transition: width 0.3s ease;
                    "></div>
                </div>
            ` : ''}
            ${loadingState.cancellable ? `
                <button class="dog-catch-loading-cancel" style="
                    background: #f44336;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                ">取消</button>
            ` : ''}
        `;
        
        // 绑定取消事件
        if (loadingState.cancellable) {
            const cancelBtn = content.querySelector('.dog-catch-loading-cancel');
            cancelBtn.addEventListener('click', () => {
                this.cancelLoading(loadingState.key);
            });
        }
        
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        
        return overlay;
    }
    
    // 更新加载界面
    updateLoadingElement(loadingState) {
        if (!loadingState.element) return;
        
        const messageEl = loadingState.element.querySelector('.dog-catch-loading-message');
        if (messageEl) {
            messageEl.textContent = loadingState.message;
        }
        
        if (loadingState.progress !== null) {
            const progressEl = loadingState.element.querySelector('.dog-catch-loading-progress div');
            if (progressEl) {
                progressEl.style.width = `${loadingState.progress}%`;
            }
        }
    }
    
    // 处理加载超时
    handleLoadingTimeout(key) {
        const loadingState = this.loadingStates.get(key);
        if (!loadingState) return;
        
        this.hideLoading(key);
        this.showError('加载超时', '操作超时，请重试', {
            key: `timeout_${key}`,
            retry: () => {
                if (window.dogCatchEvents) {
                    window.dogCatchEvents.emit('loading:retry', { key });
                }
            }
        });
    }
    
    // 取消加载
    cancelLoading(key) {
        this.hideLoading(key);
        
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('loading:cancel', { key });
        }
    }
    
    // 错误处理
    showError(title, message, options = {}) {
        const {
            key = `error_${Date.now()}`,
            type = 'error',
            duration = 0, // 0 表示不自动关闭
            retry = null,
            details = null
        } = options;
        
        const errorNotification = this.createErrorNotification({
            key,
            title,
            message,
            type,
            duration,
            retry,
            details
        });
        
        this.notifications.set(key, errorNotification);
        
        // 触发错误事件
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('error:show', { key, title, message, options });
        }
        
        return errorNotification;
    }
    
    // 创建错误通知
    createErrorNotification(options) {
        const { key, title, message, type, duration, retry, details } = options;
        
        const notification = document.createElement('div');
        notification.className = 'dog-catch-error-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            border: 1px solid ${type === 'error' ? '#f44336' : type === 'warning' ? '#FF9800' : '#2196F3'};
            border-left: 4px solid ${type === 'error' ? '#f44336' : type === 'warning' ? '#FF9800' : '#2196F3'};
            border-radius: 8px;
            padding: 16px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 2147483647;
            max-width: 400px;
            animation: dog-catch-slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;
        
        const iconMap = {
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️',
            success: '✅'
        };
        
        notification.innerHTML = `
            <div style="display: flex; gap: 12px;">
                <span style="font-size: 18px;">${iconMap[type] || iconMap.info}</span>
                <div style="flex: 1;">
                    <div style="font-weight: 600; margin-bottom: 4px; color: #333;">${title}</div>
                    <div style="color: #666; line-height: 1.4;">${message}</div>
                    ${details ? `
                        <details style="margin-top: 8px;">
                            <summary style="cursor: pointer; color: #2196F3;">查看详情</summary>
                            <pre style="
                                background: #f5f5f5;
                                padding: 8px;
                                border-radius: 4px;
                                font-size: 12px;
                                margin-top: 8px;
                                white-space: pre-wrap;
                                word-break: break-word;
                            ">${details}</pre>
                        </details>
                    ` : ''}
                    ${retry ? `
                        <div style="margin-top: 12px;">
                            <button class="dog-catch-retry-btn" style="
                                background: #2196F3;
                                color: white;
                                border: none;
                                padding: 6px 12px;
                                border-radius: 4px;
                                cursor: pointer;
                                font-size: 12px;
                                margin-right: 8px;
                            ">重试</button>
                        </div>
                    ` : ''}
                </div>
                <button class="dog-catch-close-btn" style="
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    color: #999;
                    font-size: 18px;
                    line-height: 1;
                ">×</button>
            </div>
        `;
        
        // 绑定事件
        const closeBtn = notification.querySelector('.dog-catch-close-btn');
        closeBtn.addEventListener('click', () => {
            this.hideError(key);
        });
        
        if (retry) {
            const retryBtn = notification.querySelector('.dog-catch-retry-btn');
            retryBtn.addEventListener('click', () => {
                this.hideError(key);
                retry();
            });
        }
        
        document.body.appendChild(notification);
        
        // 自动关闭
        if (duration > 0) {
            setTimeout(() => {
                this.hideError(key);
            }, duration);
        }
        
        return notification;
    }
    
    // 隐藏错误通知
    hideError(key) {
        const notification = this.notifications.get(key);
        if (!notification) return;
        
        notification.style.animation = 'dog-catch-slide-out-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
        
        this.notifications.delete(key);
        
        // 触发错误隐藏事件
        if (window.dogCatchEvents) {
            window.dogCatchEvents.emit('error:hide', { key });
        }
    }
    
    // 成功提示
    showSuccess(message, options = {}) {
        const { duration = 3000 } = options;
        
        return this.showError('成功', message, {
            type: 'success',
            duration,
            ...options
        });
    }
    
    // 警告提示
    showWarning(message, options = {}) {
        const { duration = 5000 } = options;
        
        return this.showError('警告', message, {
            type: 'warning',
            duration,
            ...options
        });
    }
    
    // 信息提示
    showInfo(message, options = {}) {
        const { duration = 3000 } = options;
        
        return this.showError('提示', message, {
            type: 'info',
            duration,
            ...options
        });
    }
    
    // 设置全局错误处理
    setupGlobalErrorHandling() {
        // 捕获未处理的 Promise 错误
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.showError('系统错误', '发生了未处理的错误', {
                details: event.reason?.stack || event.reason?.toString() || '未知错误',
                key: `unhandled_${Date.now()}`
            });
        });
        
        // 捕获 JavaScript 错误
        window.addEventListener('error', (event) => {
            console.error('JavaScript error:', event.error);
            this.showError('脚本错误', event.message || '发生了脚本错误', {
                details: `${event.filename}:${event.lineno}:${event.colno}\n${event.error?.stack || ''}`,
                key: `js_error_${Date.now()}`
            });
        });
    }
    
    // 设置加载状态管理
    setupLoadingStateManagement() {
        // 监听页面卸载，清理所有加载状态
        window.addEventListener('beforeunload', () => {
            this.loadingStates.forEach((_, key) => {
                this.hideLoading(key);
            });
        });
    }
    
    // 设置通知系统
    setupNotificationSystem() {
        // 监听页面可见性变化，暂停/恢复通知
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // 页面隐藏时暂停自动关闭
                this.notifications.forEach(notification => {
                    if (notification._autoCloseTimeout) {
                        clearTimeout(notification._autoCloseTimeout);
                    }
                });
            }
        });
    }
    
    // 清理所有通知
    clearAll() {
        this.loadingStates.forEach((_, key) => {
            this.hideLoading(key);
        });
        
        this.notifications.forEach((_, key) => {
            this.hideError(key);
        });
    }
    
    // 获取当前状态
    getStatus() {
        return {
            loadingCount: this.loadingStates.size,
            notificationCount: this.notifications.size,
            loadingKeys: Array.from(this.loadingStates.keys()),
            notificationKeys: Array.from(this.notifications.keys())
        };
    }
}

// 全局实例
if (typeof window !== 'undefined' && !window.dogCatchFeedback) {
    window.dogCatchFeedback = new DogCatchFeedbackSystem();
}
