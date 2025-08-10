// Dog-Catch 事件驱动系统
// 根据 README.md 第114行要求实现事件驱动机制

class DogCatchEventSystem {
    constructor() {
        this.listeners = new Map();
        this.components = new Map();
        this.globalState = new Map();
        
        this.init();
    }
    
    init() {
        // 初始化全局事件监听
        this.setupGlobalListeners();
        
        // 初始化组件生命周期管理
        this.setupComponentLifecycle();
    }
    
    // 事件监听器管理
    on(eventName, callback, options = {}) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        
        const listener = {
            callback,
            once: options.once || false,
            priority: options.priority || 0,
            id: this.generateId()
        };
        
        this.listeners.get(eventName).push(listener);
        
        // 按优先级排序
        this.listeners.get(eventName).sort((a, b) => b.priority - a.priority);
        
        return listener.id;
    }
    
    // 移除事件监听器
    off(eventName, listenerId) {
        if (!this.listeners.has(eventName)) return;
        
        const listeners = this.listeners.get(eventName);
        const index = listeners.findIndex(l => l.id === listenerId);
        
        if (index !== -1) {
            listeners.splice(index, 1);
        }
        
        if (listeners.length === 0) {
            this.listeners.delete(eventName);
        }
    }
    
    // 触发事件
    emit(eventName, data = {}, options = {}) {
        if (!this.listeners.has(eventName)) return;
        
        const event = {
            name: eventName,
            data,
            timestamp: Date.now(),
            preventDefault: false,
            stopPropagation: false
        };
        
        const listeners = this.listeners.get(eventName);
        const listenersToRemove = [];
        
        for (const listener of listeners) {
            try {
                listener.callback(event);
                
                if (listener.once) {
                    listenersToRemove.push(listener.id);
                }
                
                if (event.stopPropagation) {
                    break;
                }
            } catch (error) {
                console.error(`Error in event listener for ${eventName}:`, error);
            }
        }
        
        // 移除一次性监听器
        listenersToRemove.forEach(id => this.off(eventName, id));
        
        return !event.preventDefault;
    }
    
    // 组件注册
    registerComponent(name, componentClass) {
        this.components.set(name, componentClass);
        
        // 触发组件注册事件
        this.emit('component:registered', { name, componentClass });
    }
    
    // 创建组件实例
    createComponent(name, options = {}) {
        const ComponentClass = this.components.get(name);
        if (!ComponentClass) {
            throw new Error(`Component ${name} not found`);
        }
        
        const instance = new ComponentClass(options);
        instance._eventSystem = this;
        instance._componentName = name;
        instance._instanceId = this.generateId();
        
        // 触发组件创建事件
        this.emit('component:created', { name, instance, options });
        
        return instance;
    }
    
    // 全局状态管理
    setState(key, value) {
        const oldValue = this.globalState.get(key);
        this.globalState.set(key, value);
        
        // 触发状态变化事件
        this.emit('state:changed', { key, value, oldValue });
        this.emit(`state:${key}:changed`, { value, oldValue });
    }
    
    getState(key, defaultValue = null) {
        return this.globalState.get(key) || defaultValue;
    }
    
    // 组件间通信
    broadcast(eventName, data = {}) {
        // 广播到所有组件
        this.emit('component:broadcast', { eventName, data });
        this.emit(`broadcast:${eventName}`, data);
    }
    
    // 设置全局监听器
    setupGlobalListeners() {
        // 监听页面卸载
        window.addEventListener('beforeunload', () => {
            this.emit('app:beforeunload');
        });
        
        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            this.emit('app:visibilitychange', { 
                hidden: document.hidden 
            });
        });
        
        // 监听网络状态变化
        window.addEventListener('online', () => {
            this.emit('app:online');
        });
        
        window.addEventListener('offline', () => {
            this.emit('app:offline');
        });
        
        // 监听窗口大小变化
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.emit('app:resize', {
                    width: window.innerWidth,
                    height: window.innerHeight
                });
            }, 100);
        });
    }
    
    // 组件生命周期管理
    setupComponentLifecycle() {
        // 监听组件创建
        this.on('component:created', (event) => {
            const { instance } = event.data;
            
            // 自动绑定生命周期方法
            if (typeof instance.onMount === 'function') {
                setTimeout(() => instance.onMount(), 0);
            }
        });
        
        // 监听组件销毁
        this.on('component:destroy', (event) => {
            const { instance } = event.data;
            
            if (typeof instance.onDestroy === 'function') {
                instance.onDestroy();
            }
        });
    }
    
    // 生成唯一ID
    generateId() {
        return `dc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // 调试方法
    debug() {
        return {
            listeners: Array.from(this.listeners.entries()).map(([event, listeners]) => ({
                event,
                count: listeners.length
            })),
            components: Array.from(this.components.keys()),
            state: Array.from(this.globalState.entries())
        };
    }
}

// 基础组件类
class DogCatchComponent {
    constructor(options = {}) {
        this.options = options;
        this.element = null;
        this.children = new Map();
        this.state = new Map();
        this.mounted = false;
        
        this.init();
    }
    
    init() {
        // 子类实现
    }
    
    // 生命周期方法
    onMount() {
        this.mounted = true;
        this.emit('mount');
    }
    
    onDestroy() {
        this.mounted = false;
        this.emit('destroy');
        
        // 清理子组件
        this.children.forEach(child => {
            if (typeof child.destroy === 'function') {
                child.destroy();
            }
        });
        this.children.clear();
        
        // 移除DOM元素
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
    
    // 状态管理
    setState(key, value) {
        const oldValue = this.state.get(key);
        this.state.set(key, value);
        
        this.emit('state:changed', { key, value, oldValue });
        this.onStateChange(key, value, oldValue);
    }
    
    getState(key, defaultValue = null) {
        return this.state.get(key) || defaultValue;
    }
    
    onStateChange(key, value, oldValue) {
        // 子类实现
    }
    
    // 事件系统
    emit(eventName, data = {}) {
        if (this._eventSystem) {
            this._eventSystem.emit(`component:${this._componentName}:${eventName}`, {
                instance: this,
                ...data
            });
        }
    }
    
    on(eventName, callback, options = {}) {
        if (this._eventSystem) {
            return this._eventSystem.on(`component:${this._componentName}:${eventName}`, callback, options);
        }
    }
    
    off(eventName, listenerId) {
        if (this._eventSystem) {
            this._eventSystem.off(`component:${this._componentName}:${eventName}`, listenerId);
        }
    }
    
    // 子组件管理
    addChild(name, component) {
        this.children.set(name, component);
        component.parent = this;
    }
    
    removeChild(name) {
        const child = this.children.get(name);
        if (child) {
            if (typeof child.destroy === 'function') {
                child.destroy();
            }
            this.children.delete(name);
        }
    }
    
    getChild(name) {
        return this.children.get(name);
    }
    
    // DOM 操作
    createElement(tagName, options = {}) {
        const element = document.createElement(tagName);
        
        if (options.className) {
            element.className = options.className;
        }
        
        if (options.innerHTML) {
            element.innerHTML = options.innerHTML;
        }
        
        if (options.style) {
            Object.assign(element.style, options.style);
        }
        
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });
        }
        
        return element;
    }
    
    // 渲染方法
    render() {
        // 子类实现
        return null;
    }
    
    // 挂载到DOM
    mount(container) {
        if (!this.element) {
            this.element = this.render();
        }
        
        if (this.element && container) {
            container.appendChild(this.element);
            this.onMount();
        }
    }
    
    // 从DOM卸载
    unmount() {
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.onDestroy();
    }
    
    // 销毁组件
    destroy() {
        this.unmount();
    }
}

// 全局实例
if (typeof window !== 'undefined' && !window.dogCatchEvents) {
    window.dogCatchEvents = new DogCatchEventSystem();
    window.DogCatchComponent = DogCatchComponent;
}
