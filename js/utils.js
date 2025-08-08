/**
 * Dog-Catch 工具函数库
 * 提供通用的工具函数和常量定义
 */

// 常量定义
const DOG_CATCH_CONSTANTS = {
  // CSS 类名
  CLASSES: {
    FLOATING_BALL: 'dog-catch-floating-ball',
    SIDEBAR: 'dog-catch-sidebar',
    SIDEBAR_SHOW: 'show',
    SIDEBAR_HEADER: 'dog-catch-sidebar-header',
    SIDEBAR_CONTENT: 'dog-catch-sidebar-content',
    RESOURCE_CARD: 'dog-catch-resource-card',
    LOADING: 'dog-catch-loading',
    EMPTY_STATE: 'dog-catch-empty-state'
  },
  
  // 动画状态
  ANIMATIONS: {
    IDLE: 'idle',
    PULSE: 'pulse',
    RIPPLE: 'ripple',
    DRAGGING: 'dragging',
    DETECTING: 'detecting',
    FOUND_RESOURCE: 'found-resource',
    NEW_RESOURCE: 'new-resource'
  },
  
  // 资源类型
  RESOURCE_TYPES: {
    VIDEO: 'video',
    AUDIO: 'audio',
    IMAGE: 'image',
    STREAM: 'stream',
    UNKNOWN: 'unknown'
  },
  
  // 存储键名
  STORAGE_KEYS: {
    POSITION: 'dog-catch-ball-position',
    SETTINGS: 'dog-catch-settings',
    RESOURCES: 'dog-catch-resources'
  },
  
  // 默认配置
  DEFAULTS: {
    BALL_POSITION: { x: 20, y: '50%' },
    SIDEBAR_WIDTH: 360,
    ANIMATION_DURATION: 300
  }
};

/**
 * DOM 工具函数
 */
const DOMUtils = {
  /**
   * 创建元素
   * @param {string} tag - 标签名
   * @param {Object} options - 选项
   * @returns {HTMLElement}
   */
  createElement(tag, options = {}) {
    const element = document.createElement(tag);
    
    if (options.className) {
      element.className = options.className;
    }
    
    if (options.id) {
      element.id = options.id;
    }
    
    if (options.innerHTML) {
      element.innerHTML = options.innerHTML;
    }
    
    if (options.textContent) {
      element.textContent = options.textContent;
    }
    
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([key, value]) => {
        element.setAttribute(key, value);
      });
    }
    
    if (options.styles) {
      Object.assign(element.style, options.styles);
    }
    
    if (options.events) {
      Object.entries(options.events).forEach(([event, handler]) => {
        element.addEventListener(event, handler);
      });
    }
    
    return element;
  },
  
  /**
   * 查找元素
   * @param {string} selector - 选择器
   * @param {Element} parent - 父元素
   * @returns {Element|null}
   */
  find(selector, parent = document) {
    return parent.querySelector(selector);
  },
  
  /**
   * 查找所有元素
   * @param {string} selector - 选择器
   * @param {Element} parent - 父元素
   * @returns {NodeList}
   */
  findAll(selector, parent = document) {
    return parent.querySelectorAll(selector);
  },
  
  /**
   * 添加类名
   * @param {Element} element - 元素
   * @param {string} className - 类名
   */
  addClass(element, className) {
    if (element && className) {
      element.classList.add(className);
    }
  },
  
  /**
   * 移除类名
   * @param {Element} element - 元素
   * @param {string} className - 类名
   */
  removeClass(element, className) {
    if (element && className) {
      element.classList.remove(className);
    }
  },
  
  /**
   * 切换类名
   * @param {Element} element - 元素
   * @param {string} className - 类名
   */
  toggleClass(element, className) {
    if (element && className) {
      element.classList.toggle(className);
    }
  },
  
  /**
   * 检查是否包含类名
   * @param {Element} element - 元素
   * @param {string} className - 类名
   * @returns {boolean}
   */
  hasClass(element, className) {
    return element && className && element.classList.contains(className);
  }
};

/**
 * 动画工具函数
 */
const AnimationUtils = {
  /**
   * 添加动画类并在完成后移除
   * @param {Element} element - 元素
   * @param {string} animationClass - 动画类名
   * @param {number} duration - 持续时间（毫秒）
   */
  addTemporaryClass(element, animationClass, duration = 1000) {
    if (!element || !animationClass) return;
    
    DOMUtils.addClass(element, animationClass);
    
    setTimeout(() => {
      DOMUtils.removeClass(element, animationClass);
    }, duration);
  },
  
  /**
   * 平滑滚动到元素
   * @param {Element} element - 目标元素
   * @param {Object} options - 选项
   */
  scrollToElement(element, options = {}) {
    if (!element) return;
    
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
      ...options
    });
  }
};

/**
 * 存储工具函数
 */
const StorageUtils = {
  /**
   * 获取存储数据
   * @param {string} key - 键名
   * @param {*} defaultValue - 默认值
   * @returns {Promise<*>}
   */
  async get(key, defaultValue = null) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get(key);
        return result[key] !== undefined ? result[key] : defaultValue;
      } else {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
      }
    } catch (error) {
      console.error('Storage get error:', error);
      return defaultValue;
    }
  },
  
  /**
   * 设置存储数据
   * @param {string} key - 键名
   * @param {*} value - 值
   * @returns {Promise<boolean>}
   */
  async set(key, value) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [key]: value });
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
      return true;
    } catch (error) {
      console.error('Storage set error:', error);
      return false;
    }
  },
  
  /**
   * 删除存储数据
   * @param {string} key - 键名
   * @returns {Promise<boolean>}
   */
  async remove(key) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.remove(key);
      } else {
        localStorage.removeItem(key);
      }
      return true;
    } catch (error) {
      console.error('Storage remove error:', error);
      return false;
    }
  }
};

/**
 * 格式化工具函数
 */
const FormatUtils = {
  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string}
   */
  formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '未知';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  },
  
  /**
   * 格式化时长
   * @param {number} seconds - 秒数
   * @returns {string}
   */
  formatDuration(seconds) {
    if (!seconds || seconds === 0) return '未知';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  },
  
  /**
   * 截断文本
   * @param {string} text - 文本
   * @param {number} maxLength - 最大长度
   * @returns {string}
   */
  truncateText(text, maxLength = 50) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  },

  /**
   * 格式化相对时间
   * @param {number} timestamp - 时间戳
   * @returns {string}
   */
  formatRelativeTime(timestamp) {
    if (!timestamp) return '未知';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
      return '刚刚';
    } else if (minutes < 60) {
      return `${minutes}分钟前`;
    } else if (hours < 24) {
      return `${hours}小时前`;
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return new Date(timestamp).toLocaleDateString();
    }
  }
};

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间
 * @returns {Function}
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 节流函数
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 限制时间
 * @returns {Function}
 */
function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 导出到全局作用域
window.DOG_CATCH_CONSTANTS = DOG_CATCH_CONSTANTS;
window.DOMUtils = DOMUtils;
window.AnimationUtils = AnimationUtils;
window.StorageUtils = StorageUtils;
window.FormatUtils = FormatUtils;
window.debounce = debounce;
window.throttle = throttle;
