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
    this.searchQuery = '';
    this.activeFilter = 'all';
    this.virtualScroll = null;
    this.useVirtualScroll = true; // 是否使用虚拟滚动
    this.performanceMetrics = {
      renderTime: 0,
      lastRenderStart: 0,
      totalResources: 0
    };

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

    // 创建搜索和过滤区域
    const filterSection = this.createFilterSection();
    content.appendChild(filterSection);

    // 创建统计信息面板
    const statsPanel = this.createStatsPanel();
    content.appendChild(statsPanel);

    // 创建资源列表容器
    const resourceList = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-list'
    });

    content.appendChild(resourceList);

    // 初始化虚拟滚动
    this.initVirtualScroll(resourceList);

    return content;
  }

  /**
   * 创建搜索和过滤区域
   */
  createFilterSection() {
    const filterSection = DOMUtils.createElement('div', {
      className: 'dog-catch-filter-section'
    });

    // 搜索框
    const searchContainer = DOMUtils.createElement('div', {
      className: 'dog-catch-search-container'
    });

    const searchInput = DOMUtils.createElement('input', {
      className: 'dog-catch-search-input',
      attributes: {
        type: 'text',
        placeholder: '搜索资源...'
      },
      events: {
        input: (e) => this.handleSearch(e.target.value)
      }
    });

    const searchIcon = DOMUtils.createElement('div', {
      className: 'dog-catch-search-icon',
      textContent: '🔍'
    });

    searchContainer.appendChild(searchIcon);
    searchContainer.appendChild(searchInput);

    // 类型过滤器
    const typeFilters = DOMUtils.createElement('div', {
      className: 'dog-catch-type-filters'
    });

    const filterTypes = [
      { type: 'all', label: '全部', icon: '📁' },
      { type: 'video', label: '视频', icon: '🎬' },
      { type: 'audio', label: '音频', icon: '🎵' },
      { type: 'image', label: '图片', icon: '🖼️' },
      { type: 'stream', label: '流媒体', icon: '📡' }
    ];

    filterTypes.forEach(filter => {
      const filterBtn = DOMUtils.createElement('button', {
        className: `dog-catch-filter-btn ${filter.type === 'all' ? 'active' : ''}`,
        attributes: {
          'data-type': filter.type
        },
        innerHTML: `${filter.icon} ${filter.label}`,
        events: {
          click: () => this.handleTypeFilter(filter.type)
        }
      });
      typeFilters.appendChild(filterBtn);
    });

    // 性能设置按钮
    const performanceBtn = DOMUtils.createElement('button', {
      className: 'dog-catch-performance-btn',
      innerHTML: '⚙️ 性能',
      events: {
        click: () => this.togglePerformanceSettings()
      }
    });

    const controlsRow = DOMUtils.createElement('div', {
      className: 'dog-catch-controls-row'
    });

    controlsRow.appendChild(typeFilters);
    controlsRow.appendChild(performanceBtn);

    filterSection.appendChild(searchContainer);
    filterSection.appendChild(controlsRow);

    return filterSection;
  }

  /**
   * 初始化虚拟滚动
   */
  initVirtualScroll(container) {
    if (!this.useVirtualScroll || !window.VirtualScroll) {
      return;
    }

    this.virtualScroll = new VirtualScroll(container, {
      itemHeight: 140, // 资源卡片高度
      bufferSize: 3,   // 缓冲区大小
      threshold: 20,   // 启用虚拟滚动的最小项目数
      renderItem: (resource, index) => {
        return this.createResourceCard(resource, index);
      }
    });
  }

  /**
   * 创建统计信息面板
   */
  createStatsPanel() {
    const statsPanel = DOMUtils.createElement('div', {
      className: 'dog-catch-stats-panel'
    });

    const statsContent = DOMUtils.createElement('div', {
      className: 'dog-catch-stats-content'
    });

    statsPanel.appendChild(statsContent);
    return statsPanel;
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

    // 显示悬浮球
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.show();
    }

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

    try {
      // 从 background 脚本获取检测到的资源
      const response = await chrome.runtime.sendMessage({
        type: 'DETECT_RESOURCES'
      });

      if (response && response.success) {
        // 清空现有资源
        this.resources = [];

        // 添加检测到的资源
        response.resources.forEach(resource => {
          this.addResource(resource);
        });

        console.log(`刷新完成，共检测到 ${response.resources.length} 个资源`);
      } else {
        console.warn('获取资源失败:', response?.error);
        // 如果获取失败，显示模拟数据
        this.addMockResources();
      }
    } catch (error) {
      console.error('刷新资源列表失败:', error);
      // 出错时显示模拟数据
      this.addMockResources();
    } finally {
      this.setLoading(false);
    }
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
    if (this.isLoading) {
      const resourceList = DOMUtils.find('.dog-catch-resource-list', this.sidebar);
      if (resourceList) {
        resourceList.innerHTML = '';
        this.renderLoading(resourceList);
      }
      return;
    }

    // 使用过滤渲染
    this.renderFilteredResources();
  }
  
  /**
   * 渲染加载状态
   */
  renderLoading(container) {
    // 创建骨架屏卡片
    const skeletonCards = Array.from({ length: 3 }, (_, index) => {
      const card = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-card dog-catch-skeleton-card',
        styles: {
          animationDelay: `${index * 100}ms`
        }
      });

      card.innerHTML = `
        <div class="dog-catch-resource-header">
          <div class="dog-catch-resource-icon-container">
            <div class="dog-catch-resource-icon dog-catch-skeleton" style="border-radius: 8px;"></div>
            <div class="dog-catch-resource-type-label dog-catch-skeleton" style="height: 10px; width: 30px; border-radius: 4px;"></div>
          </div>
          <div class="dog-catch-resource-title-container">
            <div class="dog-catch-resource-title dog-catch-skeleton" style="height: 14px; width: 80%; border-radius: 4px; margin-bottom: 4px;"></div>
            <div class="dog-catch-resource-url dog-catch-skeleton" style="height: 11px; width: 60%; border-radius: 4px;"></div>
          </div>
        </div>
        <div class="dog-catch-resource-details">
          <div class="dog-catch-resource-primary-info">
            <div class="dog-catch-skeleton" style="height: 12px; width: 60px; border-radius: 4px;"></div>
            <div class="dog-catch-skeleton" style="height: 12px; width: 50px; border-radius: 4px;"></div>
          </div>
          <div class="dog-catch-resource-secondary-info">
            <div class="dog-catch-skeleton" style="height: 11px; width: 40px; border-radius: 4px;"></div>
            <div class="dog-catch-skeleton" style="height: 11px; width: 70px; border-radius: 4px;"></div>
          </div>
        </div>
        <div class="dog-catch-resource-actions">
          <div class="dog-catch-skeleton" style="height: 28px; width: 48%; border-radius: 6px;"></div>
          <div class="dog-catch-skeleton" style="height: 28px; width: 48%; border-radius: 6px;"></div>
        </div>
      `;

      return card;
    });

    // 添加骨架屏卡片
    skeletonCards.forEach(card => container.appendChild(card));

    // 添加加载提示
    const loadingText = DOMUtils.createElement('div', {
      className: 'dog-catch-loading-text',
      innerHTML: `
        <div class="dog-catch-loading-spinner"></div>
        正在检测媒体资源...
      `
    });

    container.appendChild(loadingText);
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
      className: `${DOG_CATCH_CONSTANTS.CLASSES.RESOURCE_CARD} ${resource.type}`,
      attributes: {
        'data-resource-type': resource.type,
        'data-resource-id': resource.id
      },
      styles: {
        animationDelay: `${Math.min(index * 50, 250)}ms`
      }
    });

    // 资源头部
    const header = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-header'
    });

    // 资源图标和类型标识
    const iconContainer = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-icon-container'
    });

    const icon = DOMUtils.createElement('div', {
      className: `dog-catch-resource-icon ${resource.type}`,
      textContent: this.getResourceTypeIcon(resource.type)
    });

    const typeLabel = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-type-label',
      textContent: this.getResourceTypeLabel(resource.type)
    });

    iconContainer.appendChild(icon);
    iconContainer.appendChild(typeLabel);

    // 资源标题和URL
    const titleContainer = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-title-container'
    });

    const title = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-title',
      textContent: FormatUtils.truncateText(resource.title, 25),
      attributes: {
        title: resource.title
      }
    });

    const url = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-url',
      textContent: FormatUtils.truncateText(resource.url, 35),
      attributes: {
        title: resource.url
      }
    });

    titleContainer.appendChild(title);
    titleContainer.appendChild(url);

    header.appendChild(iconContainer);
    header.appendChild(titleContainer);

    // 资源详细信息
    const details = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-details'
    });

    // 第一行：大小和时长
    const primaryInfo = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-primary-info'
    });

    if (resource.size) {
      const size = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-size',
        innerHTML: `<span class="icon">📊</span>${FormatUtils.formatFileSize(resource.size)}`
      });
      primaryInfo.appendChild(size);
    }

    if (resource.duration) {
      const duration = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-duration',
        innerHTML: `<span class="icon">⏱️</span>${FormatUtils.formatDuration(resource.duration)}`
      });
      primaryInfo.appendChild(duration);
    }

    // 第二行：扩展名和检测时间
    const secondaryInfo = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-secondary-info'
    });

    if (resource.ext) {
      const ext = DOMUtils.createElement('div', {
        className: 'dog-catch-resource-ext',
        innerHTML: `<span class="icon">📄</span>${resource.ext.toUpperCase()}`
      });
      secondaryInfo.appendChild(ext);
    }

    const timestamp = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-timestamp',
      innerHTML: `<span class="icon">🕒</span>${FormatUtils.formatRelativeTime(resource.timestamp)}`
    });
    secondaryInfo.appendChild(timestamp);

    details.appendChild(primaryInfo);
    details.appendChild(secondaryInfo);

    // 操作按钮
    const actions = DOMUtils.createElement('div', {
      className: 'dog-catch-resource-actions'
    });

    const previewBtn = DOMUtils.createElement('button', {
      className: 'dog-catch-action-btn preview',
      innerHTML: '👁️ 预览',
      events: {
        click: (e) => {
          e.stopPropagation();
          this.handleResourcePreview(resource);
        }
      }
    });

    const downloadBtn = DOMUtils.createElement('button', {
      className: 'dog-catch-action-btn download',
      innerHTML: '⬇️ 下载',
      events: {
        click: (e) => {
          e.stopPropagation();
          this.handleResourceDownload(resource);
        }
      }
    });

    actions.appendChild(previewBtn);
    actions.appendChild(downloadBtn);

    card.appendChild(header);
    card.appendChild(details);
    card.appendChild(actions);

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
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE]: '🖼️',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.STREAM]: '📡',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.UNKNOWN]: '📄'
    };

    return icons[type] || '📄';
  }

  /**
   * 获取资源类型标签
   */
  getResourceTypeLabel(type) {
    const labels = {
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.VIDEO]: '视频',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.AUDIO]: '音频',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE]: '图片',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.STREAM]: '流媒体',
      [DOG_CATCH_CONSTANTS.RESOURCE_TYPES.UNKNOWN]: '未知'
    };

    return labels[type] || '未知';
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
   * 处理资源预览
   */
  handleResourcePreview(resource) {
    console.log('预览资源:', resource);

    // 这里将来会实现内嵌预览功能
    // 目前只是在新标签页打开
    if (resource.url) {
      window.open(resource.url, '_blank');
    }
  }

  /**
   * 处理资源下载
   */
  handleResourceDownload(resource) {
    console.log('下载资源:', resource);

    // 创建下载链接
    const link = document.createElement('a');
    link.href = resource.url;
    link.download = resource.title || 'download';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * 处理搜索
   */
  handleSearch(query) {
    this.searchQuery = query.toLowerCase();
    this.renderFilteredResources();
  }

  /**
   * 处理类型过滤
   */
  handleTypeFilter(type) {
    // 更新过滤器按钮状态
    const filterBtns = this.sidebar.querySelectorAll('.dog-catch-filter-btn');
    filterBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });

    this.activeFilter = type;
    this.renderFilteredResources();
  }

  /**
   * 渲染过滤后的资源
   */
  renderFilteredResources() {
    // 开始性能监控
    this.performanceMetrics.lastRenderStart = performance.now();

    let filteredResources = [...this.resources];

    // 应用类型过滤
    if (this.activeFilter && this.activeFilter !== 'all') {
      filteredResources = filteredResources.filter(resource =>
        resource.type === this.activeFilter
      );
    }

    // 应用搜索过滤
    if (this.searchQuery) {
      filteredResources = filteredResources.filter(resource =>
        resource.title.toLowerCase().includes(this.searchQuery) ||
        resource.url.toLowerCase().includes(this.searchQuery) ||
        (resource.ext && resource.ext.toLowerCase().includes(this.searchQuery))
      );
    }

    // 渲染过滤后的资源
    const resourceList = DOMUtils.find('.dog-catch-resource-list', this.sidebar);
    if (!resourceList) return;

    // 使用动画过滤
    this.animateFilterTransition(resourceList, filteredResources);

    // 更新统计信息
    this.updateStatsPanel(filteredResources);

    // 结束性能监控
    this.performanceMetrics.renderTime = performance.now() - this.performanceMetrics.lastRenderStart;
    this.performanceMetrics.totalResources = filteredResources.length;

    // 如果渲染时间过长，考虑启用虚拟滚动
    if (this.performanceMetrics.renderTime > 100 && !this.useVirtualScroll) {
      console.log('检测到渲染性能问题，建议启用虚拟滚动');
      this.useVirtualScroll = true;
    }
  }

  /**
   * 动画过滤转换
   */
  animateFilterTransition(container, newResources) {
    const existingCards = container.querySelectorAll('.dog-catch-resource-card');

    // 如果没有现有卡片，直接渲染
    if (existingCards.length === 0) {
      this.renderResourceCards(container, newResources);
      return;
    }

    // 标记要移除的卡片
    existingCards.forEach(card => {
      const resourceId = card.dataset.resourceId;
      const stillExists = newResources.some(resource => resource.id === resourceId);

      if (!stillExists) {
        card.classList.add('filtering-out');
      }
    });

    // 等待移除动画完成后重新渲染
    setTimeout(() => {
      this.renderResourceCards(container, newResources);
    }, 300);
  }

  /**
   * 渲染资源卡片
   */
  renderResourceCards(container, resources) {
    // 如果使用虚拟滚动
    if (this.virtualScroll && this.useVirtualScroll) {
      this.virtualScroll.setData(resources);
      return;
    }

    // 普通渲染
    container.innerHTML = '';

    if (resources.length === 0) {
      this.renderEmptyState(container);
      return;
    }

    resources.forEach((resource, index) => {
      const card = this.createResourceCard(resource, index);
      card.classList.add('filtering-in');
      container.appendChild(card);

      // 移除动画类
      setTimeout(() => {
        card.classList.remove('filtering-in');
      }, 300);
    });
  }

  /**
   * 更新统计信息面板
   */
  updateStatsPanel(resources = this.resources) {
    const statsContent = this.sidebar.querySelector('.dog-catch-stats-content');
    if (!statsContent) return;

    // 计算统计信息
    const stats = this.calculateStats(resources);

    statsContent.innerHTML = `
      <div class="dog-catch-stats-item">
        <span class="icon">📊</span>
        <span class="label">总数量</span>
        <span class="value">${stats.total}</span>
      </div>
      <div class="dog-catch-stats-item">
        <span class="icon">💾</span>
        <span class="label">总大小</span>
        <span class="value">${FormatUtils.formatFileSize(stats.totalSize)}</span>
      </div>
      <div class="dog-catch-stats-item">
        <span class="icon">🎬</span>
        <span class="label">视频</span>
        <span class="value">${stats.video}</span>
      </div>
      <div class="dog-catch-stats-item">
        <span class="icon">🎵</span>
        <span class="label">音频</span>
        <span class="value">${stats.audio}</span>
      </div>
      <div class="dog-catch-stats-item">
        <span class="icon">🖼️</span>
        <span class="label">图片</span>
        <span class="value">${stats.image}</span>
      </div>
      ${this.renderPerformanceStats()}
    `;
  }

  /**
   * 计算统计信息
   */
  calculateStats(resources) {
    const stats = {
      total: resources.length,
      totalSize: 0,
      video: 0,
      audio: 0,
      image: 0,
      stream: 0,
      unknown: 0
    };

    resources.forEach(resource => {
      if (resource.size) {
        stats.totalSize += resource.size;
      }

      switch (resource.type) {
        case DOG_CATCH_CONSTANTS.RESOURCE_TYPES.VIDEO:
          stats.video++;
          break;
        case DOG_CATCH_CONSTANTS.RESOURCE_TYPES.AUDIO:
          stats.audio++;
          break;
        case DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE:
          stats.image++;
          break;
        case DOG_CATCH_CONSTANTS.RESOURCE_TYPES.STREAM:
          stats.stream++;
          break;
        default:
          stats.unknown++;
      }
    });

    return stats;
  }

  /**
   * 渲染性能统计
   */
  renderPerformanceStats() {
    const renderTime = this.performanceMetrics.renderTime;
    const isVirtualScrollEnabled = this.useVirtualScroll && this.virtualScroll;

    // 只在开发模式或性能有问题时显示
    if (renderTime < 50 && !isVirtualScrollEnabled) {
      return '';
    }

    const performanceColor = renderTime < 50 ? '#27ae60' : renderTime < 100 ? '#f39c12' : '#e74c3c';

    return `
      <div class="dog-catch-stats-item performance">
        <span class="icon">⚡</span>
        <span class="label">渲染</span>
        <span class="value" style="color: ${performanceColor}">${renderTime.toFixed(1)}ms</span>
      </div>
      ${isVirtualScrollEnabled ? `
        <div class="dog-catch-stats-item">
          <span class="icon">🚀</span>
          <span class="label">虚拟滚动</span>
          <span class="value" style="color: #667eea">已启用</span>
        </div>
      ` : ''}
    `;
  }

  /**
   * 切换性能设置
   */
  togglePerformanceSettings() {
    const currentVirtualScroll = this.useVirtualScroll;
    this.useVirtualScroll = !currentVirtualScroll;

    // 重新初始化虚拟滚动
    const resourceList = DOMUtils.find('.dog-catch-resource-list', this.sidebar);
    if (resourceList) {
      if (this.virtualScroll) {
        this.virtualScroll.destroy();
        this.virtualScroll = null;
      }

      if (this.useVirtualScroll) {
        this.initVirtualScroll(resourceList);
      }

      // 重新渲染
      this.renderFilteredResources();
    }

    // 显示提示
    const message = this.useVirtualScroll ? '虚拟滚动已启用' : '虚拟滚动已禁用';
    console.log(message);

    // 这里可以添加一个临时提示框
    this.showTemporaryMessage(message);
  }

  /**
   * 显示临时消息
   */
  showTemporaryMessage(message) {
    const messageEl = DOMUtils.createElement('div', {
      className: 'dog-catch-temp-message',
      textContent: message,
      styles: {
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: 'rgba(102, 126, 234, 0.9)',
        color: 'white',
        padding: '8px 16px',
        borderRadius: '6px',
        fontSize: '14px',
        zIndex: '10001',
        opacity: '0',
        transform: 'translateY(-10px)',
        transition: 'all 0.3s ease'
      }
    });

    document.body.appendChild(messageEl);

    // 显示动画
    setTimeout(() => {
      messageEl.style.opacity = '1';
      messageEl.style.transform = 'translateY(0)';
    }, 10);

    // 3秒后移除
    setTimeout(() => {
      messageEl.style.opacity = '0';
      messageEl.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.parentNode.removeChild(messageEl);
        }
      }, 300);
    }, 3000);
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

    // 标准化资源格式
    const standardizedResource = {
      id: resource.id || `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: this.mapResourceType(resource.type),
      title: resource.title || resource.name || 'Unknown',
      url: resource.url,
      size: resource.size || 0,
      ext: resource.ext,
      mimeType: resource.mimeType || resource.type,
      duration: resource.duration,
      timestamp: resource.timestamp || Date.now(),
      tabId: resource.tabId,
      initiator: resource.initiator,
      isNew: true // 标记为新资源
    };

    // 添加到列表开头
    this.resources.unshift(standardizedResource);

    // 限制资源数量
    if (this.resources.length > 100) {
      this.resources = this.resources.slice(0, 100);
    }

    // 重新渲染
    this.renderResources();
    this.saveResources();

    // 为新资源添加高亮动画
    setTimeout(() => {
      const newCard = this.sidebar.querySelector(`[data-resource-id="${standardizedResource.id}"]`);
      if (newCard) {
        newCard.classList.add('new-resource');
        // 2秒后移除新资源标记
        setTimeout(() => {
          newCard.classList.remove('new-resource');
          standardizedResource.isNew = false;
        }, 2000);
      }
    }, 100);

    // 触发新资源事件
    this.dispatchEvent('newResource', { resource: standardizedResource });
  }

  /**
   * 映射资源类型到常量
   */
  mapResourceType(type) {
    if (!type) return DOG_CATCH_CONSTANTS.RESOURCE_TYPES.UNKNOWN;

    const typeMap = {
      'video': DOG_CATCH_CONSTANTS.RESOURCE_TYPES.VIDEO,
      'audio': DOG_CATCH_CONSTANTS.RESOURCE_TYPES.AUDIO,
      'image': DOG_CATCH_CONSTANTS.RESOURCE_TYPES.IMAGE,
      'stream': DOG_CATCH_CONSTANTS.RESOURCE_TYPES.STREAM,
      'unknown': DOG_CATCH_CONSTANTS.RESOURCE_TYPES.UNKNOWN
    };

    return typeMap[type.toLowerCase()] || DOG_CATCH_CONSTANTS.RESOURCE_TYPES.UNKNOWN;
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
