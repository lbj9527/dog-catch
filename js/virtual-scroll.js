/**
 * 虚拟滚动组件
 * 用于优化大量数据的渲染性能
 */
class VirtualScroll {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      itemHeight: options.itemHeight || 160, // 每个项目的高度（增加到160px以适应完整的资源卡片）
      bufferSize: options.bufferSize || 5,   // 缓冲区大小
      threshold: options.threshold || 50,    // 启用虚拟滚动的最小项目数
      ...options
    };
    
    this.data = [];
    this.visibleItems = [];
    this.startIndex = 0;
    this.endIndex = 0;
    this.scrollTop = 0;
    this.containerHeight = 0;
    this.totalHeight = 0;
    
    this.init();
  }

  /**
   * 初始化虚拟滚动
   */
  init() {
    this.setupContainer();
    this.bindEvents();
    this.updateDimensions();
  }

  /**
   * 设置容器
   */
  setupContainer() {
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';
    
    // 创建滚动内容容器
    this.scrollContent = document.createElement('div');
    this.scrollContent.className = 'virtual-scroll-content';
    this.scrollContent.style.position = 'relative';
    
    // 创建可见项目容器
    this.viewport = document.createElement('div');
    this.viewport.className = 'virtual-scroll-viewport';
    this.viewport.style.position = 'absolute';
    this.viewport.style.top = '0';
    this.viewport.style.left = '0';
    this.viewport.style.right = '0';
    
    this.scrollContent.appendChild(this.viewport);
    this.container.appendChild(this.scrollContent);
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    this.container.addEventListener('scroll', this.handleScroll.bind(this));
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  /**
   * 处理滚动事件
   */
  handleScroll() {
    this.scrollTop = this.container.scrollTop;
    this.updateVisibleItems();
  }

  /**
   * 处理窗口大小变化
   */
  handleResize() {
    this.updateDimensions();
    this.updateVisibleItems();
  }

  /**
   * 更新尺寸
   */
  updateDimensions() {
    this.containerHeight = this.container.clientHeight;
    this.totalHeight = this.data.length * this.options.itemHeight;
    this.scrollContent.style.height = `${this.totalHeight}px`;
  }

  /**
   * 设置数据 - 始终使用虚拟滚动
   */
  setData(data) {
    console.log('虚拟滚动 setData 被调用，数据长度:', data.length);
    this.data = data;

    // 清除容器中的骨架屏内容
    if (this.container) {
      console.log('清除容器中的骨架屏内容');
      this.container.innerHTML = '';

      // 重新创建 viewport
      this.viewport = document.createElement('div');
      this.viewport.style.position = 'relative';
      this.container.appendChild(this.viewport);
    }

    // 始终使用虚拟滚动，移除threshold限制
    this.updateDimensions();
    this.updateVisibleItems();

    console.log('虚拟滚动渲染完成');
  }

  /**
   * 普通渲染（数据量较小时）
   */
  renderAll() {
    this.viewport.innerHTML = '';
    this.viewport.style.transform = 'translateY(0)';
    this.scrollContent.style.height = 'auto';
    
    this.data.forEach((item, index) => {
      const element = this.options.renderItem(item, index);
      this.viewport.appendChild(element);
    });
  }

  /**
   * 更新可见项目
   */
  updateVisibleItems() {
    if (this.data.length === 0) {
      this.viewport.innerHTML = '';
      return;
    }

    const visibleStart = Math.floor(this.scrollTop / this.options.itemHeight);
    const visibleEnd = Math.min(
      visibleStart + Math.ceil(this.containerHeight / this.options.itemHeight),
      this.data.length - 1
    );

    // 添加缓冲区
    this.startIndex = Math.max(0, visibleStart - this.options.bufferSize);
    this.endIndex = Math.min(this.data.length - 1, visibleEnd + this.options.bufferSize);

    this.renderVisibleItems();
  }

  /**
   * 渲染可见项目
   */
  renderVisibleItems() {
    this.viewport.innerHTML = '';
    
    // 设置偏移量
    const offsetY = this.startIndex * this.options.itemHeight;
    this.viewport.style.transform = `translateY(${offsetY}px)`;
    
    // 渲染可见项目
    for (let i = this.startIndex; i <= this.endIndex; i++) {
      const item = this.data[i];
      if (item) {
        const element = this.options.renderItem(item, i);
        element.style.position = 'relative';
        element.style.height = `${this.options.itemHeight}px`;
        this.viewport.appendChild(element);
      }
    }
  }

  /**
   * 滚动到指定项目
   */
  scrollToItem(index) {
    const targetScrollTop = index * this.options.itemHeight;
    this.container.scrollTop = targetScrollTop;
  }

  /**
   * 滚动到顶部
   */
  scrollToTop() {
    this.container.scrollTop = 0;
  }

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    this.container.scrollTop = this.totalHeight;
  }

  /**
   * 获取当前可见项目的索引范围
   */
  getVisibleRange() {
    return {
      start: this.startIndex,
      end: this.endIndex
    };
  }

  /**
   * 刷新
   */
  refresh() {
    this.updateDimensions();
    this.updateVisibleItems();
  }

  /**
   * 销毁
   */
  destroy() {
    this.container.removeEventListener('scroll', this.handleScroll.bind(this));
    window.removeEventListener('resize', this.handleResize.bind(this));
    
    if (this.scrollContent && this.scrollContent.parentNode) {
      this.scrollContent.parentNode.removeChild(this.scrollContent);
    }
  }

  /**
   * 添加项目
   */
  addItem(item, index = -1) {
    if (index === -1) {
      this.data.push(item);
    } else {
      this.data.splice(index, 0, item);
    }
    
    this.setData(this.data);
  }

  /**
   * 移除项目
   */
  removeItem(index) {
    if (index >= 0 && index < this.data.length) {
      this.data.splice(index, 1);
      this.setData(this.data);
    }
  }

  /**
   * 更新项目
   */
  updateItem(index, item) {
    if (index >= 0 && index < this.data.length) {
      this.data[index] = item;
      this.updateVisibleItems();
    }
  }

  /**
   * 清空数据
   */
  clear() {
    this.data = [];
    this.viewport.innerHTML = '';
    this.scrollContent.style.height = '0px';
  }
}

// 导出虚拟滚动组件
window.VirtualScroll = VirtualScroll;
