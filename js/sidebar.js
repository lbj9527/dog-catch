/**
 * Dog-Catch 侧边栏组件
 * 实现侧边栏的创建、显示隐藏和资源列表管理
 */

class DogCatchSidebar {
  constructor() {
    this.sidebar = null;
    this.isVisible = false;
    this.resources = [];
    this.isLoading = false;
    
    this.init();
  }
  
  /**
   * 初始化侧边栏
   */
  async init() {
    // 创建侧边栏元素
    this.createSidebar();
    
    // 绑定事件
    this.bindEvents();
    
    // 加载资源数据
    await this.loadResources();
    
    console.log('Dog-Catch 侧边栏初始化完成');
  }
  
  /**
   * 创建侧边栏元素
   */
  createSidebar() {
    // 检查是否已存在
    const existingSidebar = DOMUtils.find(`.${DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR}`);
    if (existingSidebar) {
      existingSidebar.remove();
    }
    
    // 创建侧边栏容器
    this.sidebar = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR,
      attributes: {
        'data-dog-catch': 'sidebar'
      }
    });
    
    // 创建头部
    const header = this.createHeader();
    this.sidebar.appendChild(header);
    
    // 创建内容区域
    const content = this.createContent();
    this.sidebar.appendChild(content);
    
    // 添加到页面
    document.body.appendChild(this.sidebar);
  }
  
  /**
   * 创建头部
   */
  createHeader() {
    const header = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR_HEADER
    });
    
    // 标题
    const title = DOMUtils.createElement('h2', {
      className: 'dog-catch-sidebar-title',
      textContent: 'Dog-Catch'
    });
    
    // 关闭按钮
    const closeBtn = DOMUtils.createElement('button', {
      className: 'dog-catch-sidebar-close',
      attributes: {
        'title': '关闭面板'
      },
      events: {
        click: () => this.hide()
      }
    });
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    return header;
  }
  
  /**
   * 创建内容区域
   */
  createContent() {
    const content = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR_CONTENT
    });
    
    // 创建资源列表容器
    const resourceList = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-list'
    });
    
    content.appendChild(resourceList);
    
    return content;
  }
  
  /**
   * 绑定事件
   */
  bindEvents() {
    if (!this.sidebar) return;
    
    // 点击侧边栏外部关闭
    document.addEventListener('click', (event) => {
      if (this.isVisible && !this.sidebar.contains(event.target) && 
          !event.target.closest(`.${DOG_CATCH_CONSTANTS.CLASSES.FLOATING_BALL}`)) {
        this.hide();
      }
    });
    
    // ESC 键关闭
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
    
    // 阻止侧边栏内部点击事件冒泡
    this.sidebar.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }
  
  /**
   * 显示侧边栏
   */
  show() {
    if (!this.sidebar || this.isVisible) return;
    
    this.isVisible = true;
    DOMUtils.addClass(this.sidebar, DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR_SHOW);
    
    // 刷新资源列表
    this.refreshResources();
    
    // 触发显示事件
    this.dispatchEvent('show');
  }
  
  /**
   * 隐藏侧边栏
   */
  hide() {
    if (!this.sidebar || !this.isVisible) return;
    
    this.isVisible = false;
    DOMUtils.removeClass(this.sidebar, DOG_CATCH_CONSTANTS.CLASSES.SIDEBAR_SHOW);
    
    // 触发隐藏事件
    this.dispatchEvent('hide');
  }
  
  /**
   * 切换显示状态
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  /**
   * 加载资源数据
   */
  async loadResources() {
    const savedResources = await StorageUtils.get(
      DOG_CATCH_CONSTANTS.STORAGE_KEYS.RESOURCES,
      []
    );
    
    this.resources = savedResources;
    this.renderResources();
  }
  
  /**
   * 保存资源数据
   */
  async saveResources() {
    await StorageUtils.set(DOG_CATCH_CONSTANTS.STORAGE_KEYS.RESOURCES, this.resources);
  }
  
  /**
   * 刷新资源列表
   */
  async refreshResources() {
    this.setLoading(true);
    
    // 这里将来会调用资源检测逻辑
    // 目前显示模拟数据
    setTimeout(() => {
      this.addMockResources();
      this.setLoading(false);
    }, 1000);
  }
  
  /**
   * 添加模拟资源（用于测试）
   */
  addMockResources() {
    const mockResources = [
      {
        id: '1',
        type: DOG_CATCH_CONSTANTS.RESOURCE_TYPES.VIDEO,
        title: 'sample_video.mp4',
        url: 'https://example.com/video.mp4',
        size: 15728640, // 15MB
        duration: 120, // 2分钟
        timestamp: Date.now()
      },
      {
        id: '2',
        type: DOG_CATCH_CONSTANTS.RESOURCE_TYPES.AUDIO,
        title: 'background_music.mp3',
        url: 'https://example.com/audio.mp3',
        size: 5242880, // 5MB
        duration: 180, // 3分钟
        timestamp: Date.now() - 60000
      },
      {
        id: '3',
        type: DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE,
        title: 'hero_image.jpg',
        url: 'https://example.com/image.jpg',
        size: 2097152, // 2MB
        timestamp: Date.now() - 120000
      }
    ];
    
    // 合并新资源，避免重复
    mockResources.forEach(resource => {
      if (!this.resources.find(r => r.id === resource.id)) {
        this.resources.unshift(resource);
      }
    });
    
    this.renderResources();
    this.saveResources();
  }
  
  /**
   * 渲染资源列表
   */
  renderResources() {
    const resourceList = DOMUtils.find('.dog-catch-resource-list', this.sidebar);
    if (!resourceList) return;
    
    // 清空现有内容
    resourceList.innerHTML = '';
    
    if (this.isLoading) {
      this.renderLoading(resourceList);
      return;
    }
    
    if (this.resources.length === 0) {
      this.renderEmptyState(resourceList);
      return;
    }
    
    // 渲染资源卡片
    this.resources.forEach((resource, index) => {
      const card = this.createResourceCard(resource, index);
      resourceList.appendChild(card);
    });
  }
  
  /**
   * 渲染加载状态
   */
  renderLoading(container) {
    const loading = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.LOADING,
      innerHTML: `
        <div class="dog-catch-loading-spinner"></div>
        <div style="margin-top: 12px; color: #666;">正在检测媒体资源...</div>
      `
    });
    
    container.appendChild(loading);
  }
  
  /**
   * 渲染空状态
   */
  renderEmptyState(container) {
    const emptyState = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.EMPTY_STATE,
      innerHTML: `
        <div class="dog-catch-empty-state-icon">🔍</div>
        <div class="dog-catch-empty-state-text">暂未检测到媒体资源</div>
        <div class="dog-catch-empty-state-hint">浏览包含视频、音频或图片的网页试试</div>
      `
    });
    
    container.appendChild(emptyState);
  }
  
  /**
   * 创建资源卡片
   */
  createResourceCard(resource, index) {
    const card = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.RESOURCE_CARD,
      styles: {
        animationDelay: `${Math.min(index * 50, 250)}ms`
      }
    });
    
    // 资源头部
    const header = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-header'
    });
    
    // 资源图标
    const icon = DOMUtils.createElement('div', {
      className: `dog-catch-resource-icon ${resource.type}`,
      textContent: this.getResourceTypeIcon(resource.type)
    });
    
    // 资源标题
    const title = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-title',
      textContent: FormatUtils.truncateText(resource.title, 30),
      attributes: {
        title: resource.title
      }
    });
    
    header.appendChild(icon);
    header.appendChild(title);
    
    // 资源信息
    const info = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-info'
    });
    
    if (resource.size) {
      const size = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-size',
        textContent: `📊 ${FormatUtils.formatFileSize(resource.size)}`
      });
      info.appendChild(size);
    }
    
    if (resource.duration) {
      const duration = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-duration',
        textContent: `⏱️ ${FormatUtils.formatDuration(resource.duration)}`
      });
      info.appendChild(duration);
    }
    
    card.appendChild(header);
    card.appendChild(info);
    
    // 绑定点击事件
    card.addEventListener('click', () => {
      this.handleResourceClick(resource);
    });
    
    return card;
  }
  
  /**
   * 获取资源类型图标
   */
  getResourceTypeIcon(type) {
    const icons = {
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.VIDEO]: '🎬',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.AUDIO]: '🎵',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE]: '🖼️'
    };
    
    return icons[type] || '📄';
  }
  
  /**
   * 处理资源点击事件
   */
  handleResourceClick(resource) {
    console.log('点击资源:', resource);
    
    // 这里将来会实现媒体预览功能
    // 目前只是打开新标签页
    if (resource.url) {
      window.open(resource.url, '_blank');
    }
  }
  
  /**
   * 设置加载状态
   */
  setLoading(loading) {
    this.isLoading = loading;
    this.renderResources();
  }
  
  /**
   * 添加资源
   */
  addResource(resource) {
    // 检查是否已存在
    if (this.resources.find(r => r.url === resource.url)) {
      return;
    }
    
    // 添加到列表开头
    this.resources.unshift({
      id: Date.now().toString(),
      timestamp: Date.now(),
      ...resource
    });
    
    // 限制资源数量
    if (this.resources.length > 100) {
      this.resources = this.resources.slice(0, 100);
    }
    
    // 重新渲染
    this.renderResources();
    this.saveResources();
    
    // 触发新资源事件
    this.dispatchEvent('newResource', { resource });
  }
  
  /**
   * 清空资源列表
   */
  clearResources() {
    this.resources = [];
    this.renderResources();
    this.saveResources();
  }
  
  /**
   * 派发自定义事件
   */
  dispatchEvent(eventName, detail = {}) {
    const event = new CustomEvent(`dogCatch:${eventName}`, {
      detail: { sidebar: this, ...detail }
    });
    document.dispatchEvent(event);
  }
  
  /**
   * 销毁侧边栏
   */
  destroy() {
    if (this.sidebar) {
      this.sidebar.remove();
      this.sidebar = null;
    }
    this.isVisible = false;
  }
}

// 创建全局实例
window.dogCatchSidebar = null;
