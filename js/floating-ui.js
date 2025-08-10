// Dog-Catch 浮动界面控制器
// 实现插件操作控制：打开、关闭、固定、浮动、最小化

class DogCatchFloatingUI {
    constructor() {
        this.isVisible = false;
        this.isMinimized = false;
        this.isFixed = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.container = null;
        this.iframe = null;
        
        this.init();
    }
    
    init() {
        // 监听来自 background script 的消息
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'toggleFloatingUI':
                    this.toggle();
                    sendResponse({ success: true });
                    break;
                case 'showFloatingUI':
                    this.show();
                    sendResponse({ success: true });
                    break;
                case 'hideFloatingUI':
                    this.hide();
                    sendResponse({ success: true });
                    break;
            }
        });
        
        // 监听键盘快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+D 切换浮动界面
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                this.toggle();
            }
        });
    }
    
    createFloatingContainer() {
        if (this.container) return;

        // 创建 Shadow DOM 隔离的浮动容器
        this.container = document.createElement('div');
        this.container.id = 'dog-catch-floating-ui';

        // 创建 Shadow DOM 以实现样式隔离
        this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

        // 创建样式隔离的内容
        this.shadowRoot.innerHTML = `
            <style>
                ${this.getIsolatedStyles()}
            </style>
            <div class="dog-catch-wrapper">
                <div class="dog-catch-header">
                    <div class="dog-catch-title">
                        <span class="dog-catch-icon">🐾</span>
                        <span class="dog-catch-text">Dog-Catch</span>
                    </div>
                    <div class="dog-catch-controls">
                        <button class="dog-catch-btn dog-catch-minimize" title="最小化">−</button>
                        <button class="dog-catch-btn dog-catch-pin" title="固定/取消固定">📌</button>
                        <button class="dog-catch-btn dog-catch-close" title="关闭">×</button>
                    </div>
                </div>
                <div class="dog-catch-content">
                    <iframe src="${chrome.runtime.getURL('popup.html')}" frameborder="0"></iframe>
                </div>
            </div>
        `;

        // 绑定事件
        this.bindEvents();

        // 添加到页面
        document.body.appendChild(this.container);

        // 设置初始位置
        this.setInitialPosition();
    }
    
    getIsolatedStyles() {
        // Shadow DOM 隔离样式 - 完全独立于页面样式
        return `
            /* CSS 作用域隔离 - 使用系统字体栈确保一致性 */
            :host {
                /* 字体回退策略 - 确保跨站点一致性 */
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                           "Helvetica Neue", Arial, "Noto Sans", sans-serif,
                           "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol",
                           "Noto Color Emoji";
                font-size: 14px;
                line-height: 1.5;
                color: #333;
                box-sizing: border-box;

                /* 重置所有可能的继承样式 */
                all: initial;

                /* 确保容器定位 */
                position: fixed;
                top: 0;
                left: 0;
                z-index: 2147483647;
                pointer-events: none;
            }

            .dog-catch-wrapper {
                /* 完全隔离的容器样式 */
                position: fixed;
                top: 20px;
                right: 20px;
                width: 400px;
                height: 600px;
                background: #ffffff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(0, 0, 0, 0.1);
                overflow: hidden;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                pointer-events: auto;

                /* 重置所有可能的继承属性 */
                margin: 0;
                padding: 0;
                border-collapse: separate;
                border-spacing: 0;
                caption-side: top;
                empty-cells: show;
                table-layout: auto;
                text-align: left;
                text-decoration: none;
                text-indent: 0;
                text-transform: none;
                vertical-align: baseline;
                white-space: normal;
                word-spacing: normal;
                letter-spacing: normal;

                /* 确保字体渲染一致性 */
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
            }
            
            #dog-catch-floating-ui.minimized {
                height: 50px;
                width: 200px;
            }
            
            #dog-catch-floating-ui.fixed {
                position: fixed !important;
            }
            
            #dog-catch-floating-ui.dragging {
                transition: none;
                cursor: grabbing;
            }
            
            .dog-catch-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: linear-gradient(135deg, #2196F3, #1976D2);
                color: white;
                cursor: grab;
                user-select: none;
                border-radius: 12px 12px 0 0;
            }
            
            .dog-catch-header:active {
                cursor: grabbing;
            }
            
            .dog-catch-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                font-size: 16px;
            }
            
            .dog-catch-icon {
                font-size: 18px;
            }
            
            .dog-catch-controls {
                display: flex;
                gap: 4px;
            }
            
            .dog-catch-btn {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.2);
                color: white;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                font-weight: bold;
                transition: all 0.2s ease;
            }
            
            .dog-catch-btn:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: scale(1.1);
            }
            
            .dog-catch-close:hover {
                background: #f44336;
            }
            
            .dog-catch-pin.pinned {
                background: rgba(255, 193, 7, 0.8);
                color: #333;
            }
            
            .dog-catch-content {
                height: calc(100% - 50px);
                overflow: hidden;
            }
            
            .dog-catch-content iframe {
                width: 100%;
                height: 100%;
                border: none;
                background: white;
            }
            
            #dog-catch-floating-ui.minimized .dog-catch-content {
                display: none;
            }
            
            /* 移动端适配 */
            @media (max-width: 768px) {
                #dog-catch-floating-ui {
                    width: calc(100vw - 20px);
                    height: calc(100vh - 40px);
                    top: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                }
                
                #dog-catch-floating-ui.minimized {
                    width: 180px;
                    height: 45px;
                    left: auto;
                }
                
                .dog-catch-header {
                    padding: 10px 12px;
                }
                
                .dog-catch-title {
                    font-size: 14px;
                }
                
                .dog-catch-btn {
                    width: 24px;
                    height: 24px;
                    font-size: 12px;
                }
            }
            
            /* 动画效果 */
            @keyframes dogCatchSlideIn {
                from {
                    opacity: 0;
                    transform: translateX(100%) scale(0.8);
                }
                to {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }
            }
            
            @keyframes dogCatchSlideOut {
                from {
                    opacity: 1;
                    transform: translateX(0) scale(1);
                }
                to {
                    opacity: 0;
                    transform: translateX(100%) scale(0.8);
                }
            }
            
            #dog-catch-floating-ui.show {
                animation: dogCatchSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            #dog-catch-floating-ui.hide {
                animation: dogCatchSlideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
        `;
        
        document.head.appendChild(styles);
    }
    
    bindEvents() {
        const header = this.container.querySelector('.dog-catch-header');
        const minimizeBtn = this.container.querySelector('.dog-catch-minimize');
        const pinBtn = this.container.querySelector('.dog-catch-pin');
        const closeBtn = this.container.querySelector('.dog-catch-close');
        
        // 拖拽功能
        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('dog-catch-btn')) return;
            
            this.isDragging = true;
            this.container.classList.add('dragging');
            
            const rect = this.container.getBoundingClientRect();
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            document.addEventListener('mousemove', this.handleDrag);
            document.addEventListener('mouseup', this.handleDragEnd);
        });
        
        // 最小化按钮
        minimizeBtn.addEventListener('click', () => {
            this.toggleMinimize();
        });
        
        // 固定按钮
        pinBtn.addEventListener('click', () => {
            this.togglePin();
        });
        
        // 关闭按钮
        closeBtn.addEventListener('click', () => {
            this.hide();
        });
        
        // 双击标题栏最小化/恢复
        header.addEventListener('dblclick', () => {
            this.toggleMinimize();
        });
    }
    
    handleDrag = (e) => {
        if (!this.isDragging || this.isFixed) return;
        
        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;
        
        // 限制在视窗内
        const maxX = window.innerWidth - this.container.offsetWidth;
        const maxY = window.innerHeight - this.container.offsetHeight;
        
        const constrainedX = Math.max(0, Math.min(x, maxX));
        const constrainedY = Math.max(0, Math.min(y, maxY));
        
        this.container.style.left = constrainedX + 'px';
        this.container.style.top = constrainedY + 'px';
        this.container.style.right = 'auto';
        this.container.style.bottom = 'auto';
    }
    
    handleDragEnd = () => {
        this.isDragging = false;
        this.container.classList.remove('dragging');
        
        document.removeEventListener('mousemove', this.handleDrag);
        document.removeEventListener('mouseup', this.handleDragEnd);
        
        // 保存位置
        this.savePosition();
    }
    
    toggleMinimize() {
        this.isMinimized = !this.isMinimized;
        this.container.classList.toggle('minimized', this.isMinimized);
        
        const minimizeBtn = this.container.querySelector('.dog-catch-minimize');
        minimizeBtn.textContent = this.isMinimized ? '+' : '−';
        minimizeBtn.title = this.isMinimized ? '恢复' : '最小化';
    }
    
    togglePin() {
        this.isFixed = !this.isFixed;
        this.container.classList.toggle('fixed', this.isFixed);
        
        const pinBtn = this.container.querySelector('.dog-catch-pin');
        pinBtn.classList.toggle('pinned', this.isFixed);
        pinBtn.title = this.isFixed ? '取消固定' : '固定';
    }
    
    setInitialPosition() {
        // 从存储中恢复位置
        const savedPosition = localStorage.getItem('dog-catch-position');
        if (savedPosition) {
            const { top, left, right, bottom } = JSON.parse(savedPosition);
            if (left !== undefined) {
                this.container.style.left = left + 'px';
                this.container.style.right = 'auto';
            }
            if (top !== undefined) {
                this.container.style.top = top + 'px';
                this.container.style.bottom = 'auto';
            }
        }
    }
    
    savePosition() {
        const rect = this.container.getBoundingClientRect();
        const position = {
            top: rect.top,
            left: rect.left,
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom
        };
        localStorage.setItem('dog-catch-position', JSON.stringify(position));
    }
    
    show() {
        if (this.isVisible) return;
        
        this.createFloatingContainer();
        this.isVisible = true;
        this.container.classList.add('show');
        this.container.classList.remove('hide');
        
        // 通知 background script
        chrome.runtime.sendMessage({ action: 'floatingUIShown' });
    }
    
    hide() {
        if (!this.isVisible) return;
        
        this.isVisible = false;
        this.container.classList.add('hide');
        this.container.classList.remove('show');
        
        setTimeout(() => {
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
                this.container = null;
            }
        }, 300);
        
        // 通知 background script
        chrome.runtime.sendMessage({ action: 'floatingUIHidden' });
    }
    
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
}

// 初始化浮动界面
if (typeof window !== 'undefined' && !window.dogCatchFloatingUI) {
    window.dogCatchFloatingUI = new DogCatchFloatingUI();
}
