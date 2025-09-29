// 统一社交面板模块（桌面/移动端共用一套 DOM，不同展示方式）
export class SocialPanel {
  constructor(options = {}) {
    this.stageSelector = options.stageSelector || '.stage';
    this.playerBoxSelector = options.playerBoxSelector || '.player-box';
    this.buttonsContainerSelector = options.buttonsContainerSelector || '.like-controls';
    this.onClose = options.onClose || (() => {});
    this.getIsMobile = options.getIsMobile || (() => false);

    this.el = null;
    this.headerEl = null;
    this.titleEl = null;
    this.closeBtn = null;
    this.contentEl = null;
    // 新增：增高按钮与状态
    this.expandBtn = null;
    this._expanded = false;

    this._animTimer = null;
  }

  ensureCreated() {
    if (this.el) return this.el;

    const panel = document.createElement('div');
    panel.className = 'social-panel';
    panel.setAttribute('aria-hidden', 'true');

    const header = document.createElement('div');
    header.className = 'social-panel-header';

    const title = document.createElement('h3');
    title.className = 'social-panel-title';
    title.id = 'socialPanelTitle';
    title.textContent = '';

    // 中间评论数显示
    const commentsCount = document.createElement('span');
    commentsCount.className = 'social-panel-comments-count';
    commentsCount.id = 'socialPanelCommentsCount';
    commentsCount.textContent = '';
    commentsCount.style.display = 'none'; // 默认隐藏，有评论时显示

    // 右侧操作区容器
    const actions = document.createElement('div');
    actions.className = 'social-panel-actions';

    // 新增：增高/还原按钮（图标与关闭按钮并列，位于其左侧）
    const expandBtn = document.createElement('button');
    expandBtn.className = 'social-panel-expand';
    expandBtn.setAttribute('aria-label', '增高社交面板');
    // 改为“扩展四角”图标（与参考图一致），颜色继承 currentColor
    expandBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M9 4H5a1 1 0 0 0-1 1v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 15v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M15 20h4a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M20 9V5a1 1 0 0 0-1-1h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'social-panel-close';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    closeBtn.addEventListener('click', () => this.onClose());

    const content = document.createElement('div');
    content.className = 'social-panel-content';

    // 组装结构：标题在左，评论数在中间，右侧 actions 中包含 增高 与 关闭
    header.appendChild(title);
    header.appendChild(commentsCount);
    actions.appendChild(expandBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);

    panel.appendChild(header);
    panel.appendChild(content);

    this.el = panel;
    this.headerEl = header;
    this.titleEl = title;
    this.commentsCountEl = commentsCount;
    this.closeBtn = closeBtn;
    this.contentEl = content;
    this.expandBtn = expandBtn;

    // 绑定增高按钮逻辑
    this.expandBtn.addEventListener('click', () => {
      this._setExpanded(!this._expanded);
    });

    // 默认挂到舞台底部，不显示，由 syncLayout 控制真正位置
    const stage = document.querySelector(this.stageSelector);
    if (stage) stage.appendChild(panel);

    // 新增：窗口尺寸变化时，折叠态动态更新高度，使输入条贴住视口底部
    this._onViewportChange = () => {
      const isMobile = typeof this.getIsMobile === 'function' ? !!this.getIsMobile() : window.innerWidth <= 880;
      if (!isMobile) return;
      const s = document.querySelector(this.stageSelector);
      const inSocial = s && s.classList.contains('social-mode');
      if (!inSocial) return;
      // 仅在折叠态更新
      if (this.el && this.el.classList.contains('mobile-inline') && !this._expanded) {
        this._updateMobileInlineHeight();
      }
    };
    window.addEventListener('resize', this._onViewportChange, { passive: true });
    window.addEventListener('orientationchange', this._onViewportChange, { passive: true });

    return panel;
  }

  getElement() {
    return this.el || this.ensureCreated();
  }

  // 判断面板是否可见
  isVisible() {
    const el = this.getElement();
    if (!el) return false;
    
    // 优先使用 aria-hidden 属性判断
    if (el.getAttribute('aria-hidden') === 'false') {
      return true;
    }
    
    // 兼容动画类名判断
    if (el.classList.contains('animate-in') || el.classList.contains('is-open')) {
      return true;
    }
    
    return false;
  }

  setContent(titleText = '', html = '') {
    const el = this.getElement();
    if (!el) return;
    if (this.titleEl) this.titleEl.textContent = titleText;
    if (this.contentEl) this.contentEl.innerHTML = html;
  }

  // 新增：通知播放器更新尺寸
  _notifyPlayerSizeUpdate() {
    // 双RAF确保DOM布局稳定后再更新播放器尺寸
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 找到 VideoPlayer 实例并调用 updatePlayerSize
        if (window.videoPlayerInstance && typeof window.videoPlayerInstance.updatePlayerSize === 'function') {
          window.videoPlayerInstance.updatePlayerSize();
        }
      });
    });
  }

  // 新增：折叠态（mobile-inline 非 is-expanded）动态计算面板高度，使底部贴住视口
  _updateMobileInlineHeight() {
    const el = this.getElement();
    if (!el || !el.classList.contains('mobile-inline') || this._expanded) return;
    const playerBox = document.querySelector(this.playerBoxSelector);
    if (!playerBox) return;
    const boxRect = playerBox.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    // 目标高度 = 视口底部到 playerBox 底边的距离，限制在 [320, 720]
    const target = Math.max(320, Math.min(720, Math.round(vh - boxRect.bottom)));
    el.style.height = `${target}px`;
  }

  // 新增：设置是否增高（满屏高、隐藏视频）
  _setExpanded(expanded) {
    this._expanded = !!expanded;
    const el = this.getElement();
    const playerBox = document.querySelector(this.playerBoxSelector);
    if (!el || !playerBox) return;

    if (this._expanded) {
      el.classList.add('is-expanded');
      playerBox.classList.add('is-panel-expanded');
      document.body.classList.add('modal-open');
      this.expandBtn.setAttribute('aria-label', '还原社交面板');
      this.expandBtn.classList.add('active');
      // 维持“扩展四角”图标样式
      this.expandBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M9 4H5a1 1 0 0 0-1 1v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 15v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M15 20h4a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 9V5a1 1 0 0 0-1-1h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      // 展开态使用 CSS 控制高度，移除内联高度
      el.style.height = '';
    } else {
      el.classList.remove('is-expanded');
      playerBox.classList.remove('is-panel-expanded');
      document.body.classList.remove('modal-open');
      this.expandBtn.setAttribute('aria-label', '增高社交面板');
      this.expandBtn.classList.remove('active');
      // 保持“扩展四角”图标样式
      this.expandBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M9 4H5a1 1 0 0 0-1 1v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 15v4a1 1 0 0 0 1 1h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M15 20h4a1 1 0 0 0 1-1v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M20 9V5a1 1 0 0 0-1-1h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      // 折叠态：根据视口动态更新高度
      this._updateMobileInlineHeight();
    }
  }

  // 内部：切换移动端社交模式时顶部 header 的显示隐藏
  _setMobileHeaderHidden(hidden) {
    const pageHeader = document.querySelector('.header');
    if (!pageHeader) return;
    if (hidden) {
      pageHeader.classList.add('hidden-on-mobile-social');
    } else {
      pageHeader.classList.remove('hidden-on-mobile-social');
    }
    // 同步更新 --app-header 变量，避免桌面端粘性布局误差（即便在移动端通常不使用）
    const h = hidden ? 0 : Math.ceil(pageHeader.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--app-header', `${h}px`);
  }

  show(state = { isMobile: this.getIsMobile(), isSocialMode: true }) {
    const el = this.getElement();
    if (!el) return;
    this.syncLayout(state);

    // 显示并设置可访问性
    el.setAttribute('aria-hidden', 'false');

    // 每次打开默认还原未增高
    this._setExpanded(false);

    if (!state.isMobile) {
      // 桌面端入场动画
      el.classList.remove('slide-out');
      if (!el.classList.contains('animate-in')) {
        // 以微小延迟确保布局完成后再触发动画
        requestAnimationFrame(() => {
          el.classList.add('animate-in');
        });
      }
    } else {
      // 移动端：使用轻量级滑入淡入动画
      el.classList.remove('animate-in', 'slide-out');
      // 确保初始状态为关闭（translateY/opacity 初始值由 CSS 提供）
      el.classList.remove('is-open');
      // 读取一次布局以确保过渡生效
      void el.offsetWidth;
      // 下一帧添加打开类，触发过渡
      requestAnimationFrame(() => {
        el.classList.add('is-open');
        // 打开后根据视口动态设高，保证输入条贴底
        this._updateMobileInlineHeight();
      });
    }
  }

  hide(state = { isMobile: this.getIsMobile(), isSocialMode: false }) {
    const stage = document.querySelector(this.stageSelector);
    const el = this.getElement();
    if (!el || !stage) return;

    // 清理之前的延迟
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

    // 关闭时强制还原增高状态
    this._setExpanded(false);

    if (!state.isMobile) {
      // 桌面端：使用退出动画
      el.classList.remove('animate-in');
      el.classList.add('slide-out');
      this._animTimer = setTimeout(() => {
        this._animTimer = null;
        el.classList.remove('slide-out');
        stage.classList.remove('social-mode', 'parallel-mode');
        el.setAttribute('aria-hidden', 'true');
        // 关闭后还原播放器布局
        this._unwrapPlayerColumn(stage);
        // 确保恢复顶部 header
        stage.classList.remove('is-mobile-active');
        this._setMobileHeaderHidden(false);
        // 通知播放器更新尺寸
        this._notifyPlayerSizeUpdate();
      }, 300);
    } else {
      // 移动端：滑出淡出动画后再隐藏
      el.classList.remove('is-open');
      this._animTimer = setTimeout(() => {
          this._animTimer = null;
          el.classList.remove('mobile-inline');
          stage.classList.remove('social-mode');
          stage.classList.remove('is-mobile-active');
          el.setAttribute('aria-hidden', 'true');
          // 兜底还原（一般移动端不会包裹）
          this._unwrapPlayerColumn(stage);
          // 恢复顶部 header
          this._setMobileHeaderHidden(false);
          // 清理内联高度
          el.style.height = '';
          // 通知播放器更新尺寸
          this._notifyPlayerSizeUpdate();
        }, 220); // 与 CSS 过渡时间对齐
    }
  }

  syncLayout(state = { isMobile: this.getIsMobile(), isSocialMode: false }) {
    const stage = document.querySelector(this.stageSelector);
    if (!stage) return;
    const el = this.getElement();

    // 根据状态添加/移除舞台类
    if (state.isSocialMode) {
      stage.classList.add('social-mode');
      if (!state.isMobile) {
        stage.classList.add('parallel-mode');
      } else {
        stage.classList.remove('parallel-mode');
      }
    } else {
      stage.classList.remove('social-mode', 'parallel-mode');
      // 非社交模式时还原播放器布局
      this._unwrapPlayerColumn(stage);
    }

    // 新增：移动端社交模式时将舞台顶到页面顶部并隐藏 header
    if (state.isSocialMode && state.isMobile) {
      stage.classList.add('is-mobile-active');
      this._setMobileHeaderHidden(true);
    } else {
      stage.classList.remove('is-mobile-active');
      this._setMobileHeaderHidden(false);
    }

    // 根据设备挂载到不同位置
    if (state.isSocialMode) {
      if (state.isMobile) {
        this._mountMobile(stage, el);
        // 挂载后计算一次高度，保证折叠态贴底
        this._updateMobileInlineHeight();
      } else {
        this._mountDesktop(stage, el);
      }
    }
  }

  _unwrapPlayerColumn(stage) {
    const playerBox = document.querySelector(this.playerBoxSelector);
    if (!playerBox) return;
    const playerColumn = stage.querySelector('.player-column');
    if (playerColumn) {
      stage.insertBefore(playerBox, playerColumn);
      playerColumn.remove();
    }
  }

  _mountDesktop(stage, el) {
    // 确保播放器被包裹到 .player-column
    const playerBox = document.querySelector(this.playerBoxSelector);
    if (!playerBox) return;

    let playerColumn = stage.querySelector('.player-column');
    if (!playerColumn) {
      playerColumn = document.createElement('div');
      playerColumn.className = 'player-column';
      playerBox.parentNode.insertBefore(playerColumn, playerBox);
      playerColumn.appendChild(playerBox);
    }

    // 确保面板位于 player-column 之后
    if (el.parentElement !== stage) {
      stage.appendChild(el);
    }
    if (playerColumn && el.previousElementSibling !== playerColumn) {
      stage.insertBefore(el, playerColumn.nextSibling);
    }

    // 桌面端样式类
    el.classList.remove('mobile-inline');
  }

  _mountMobile(stage, el) {
    // 移动端：挂载到播放器容器下方（而非按钮容器），以便在隐藏按钮行时保持面板位置
    const playerBox = document.querySelector(this.playerBoxSelector);
    if (!playerBox) {
      // 兜底：如果没有播放器容器，仍作为 stage 的子元素显示
      if (el.parentElement !== stage) stage.appendChild(el);
    } else {
      if (el.parentElement !== playerBox) {
        playerBox.appendChild(el);
      }
    }

    // 移动端样式类
    el.classList.add('mobile-inline');
  }

  // 设置面板类型，控制评论数显示
  setPanelType(type) {
    if (!this.el || !this.commentsCountEl) return;
    
    // 移除所有面板类型标记
    this.el.classList.remove('social-panel--subtitle', 'social-panel--plaza', 'social-panel--chat');
    
    // 添加新的面板类型标记
    switch (type) {
      case 'subtitle':
        this.el.classList.add('social-panel--subtitle');
        this.commentsCountEl.style.display = 'inline'; // 显示评论数
        break;
      case 'plaza':
        this.el.classList.add('social-panel--plaza');
        this.commentsCountEl.style.display = 'none'; // 隐藏评论数
        break;
      case 'chat':
        this.el.classList.add('social-panel--chat');
        this.commentsCountEl.style.display = 'none'; // 隐藏评论数
        break;
      default:
        // 默认情况下隐藏评论数
        this.commentsCountEl.style.display = 'none';
    }
  }

  // 定位到指定评论
  focusComment(commentId) {
    if (!commentId) return false;
    
    // 仅查找顶层父评论元素，不处理回复ID
    // 统一定位策略：无论是顶层评论@还是回复@，都定位到父评论
    const commentElement = document.querySelector(`.comments-list [data-comment-id="${commentId}"]`);
    if (!commentElement) {
      console.warn(`父评论ID ${commentId} 未找到，注意：此方法仅支持父评论ID定位`);
      return false;
    }
    
    // 滚动到评论位置
    commentElement.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
    
    // 高亮显示评论
    commentElement.classList.add('comment-highlighted');
    
    // 3秒后移除高亮
    setTimeout(() => {
      commentElement.classList.remove('comment-highlighted');
    }, 3000);
    
    return true;
  }

  // 更新观看数UI
  async updateViewerCount() {
    const viewerCountBtn = document.getElementById('viewerCountButton');
    const viewerCountEl = document.getElementById('viewerCount');
    
    console.log('[观看人数] 开始更新观看人数', {
      viewerCountBtn: !!viewerCountBtn,
      viewerCountEl: !!viewerCountEl
    });
    
    if (!viewerCountBtn || !viewerCountEl) return;
    
    try {
      // 获取当前视频ID
      const videoId = this.getCurrentVideoId();
      console.log('[观看人数] 获取到视频ID:', videoId);
      
      if (!videoId) return;
      
      // 统一API基址解析逻辑，与player.js保持一致
      const urlParams = new URLSearchParams(window.location.search);
      const apiBase = urlParams.get('api') || 
                     (window.PLAYER_CONFIG && window.PLAYER_CONFIG.API_BASE_URL) || 
                     'https://api.sub-dog.top';
      const baseUrl = apiBase.replace(/\/$/, ''); // 去除结尾斜杠
      
      const token = sessionStorage.getItem('user_token') || localStorage.getItem('user_token') || '';
      const url = `${baseUrl}/api/subtitles/viewers-count/${videoId}`;
      
      console.log('[观看人数] 发送API请求', {
        url: url,
        hasToken: !!token,
        apiBase: apiBase
      });
      
      // 获取观看数
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('[观看人数] API响应状态:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        const count = Number(data.viewers_count || 0);
        
        console.log('[观看人数] 获取成功', {
          rawData: data,
          count: count,
          formattedCount: this.formatViewerCount(count)
        });
        
        // 更新观看数显示
        viewerCountEl.textContent = this.formatViewerCount(count);
        
        // 显示观看数按钮
        viewerCountBtn.style.display = 'flex';
      } else {
        console.error('[观看人数] API请求失败:', response.status);
      }
    } catch (error) {
      console.error('[观看人数] 获取观看数失败:', error.message, error);
    }
  }
  
  // 格式化观看数显示
  formatViewerCount(n) {
    const num = Number(n) || 0;
    if (num >= 1000) {
      const val = (num / 1000).toFixed(1).replace(/\.0$/, '');
      return `${val}k`;
    }
    try { 
      return num.toLocaleString('zh-CN'); 
    } catch { 
      return String(num); 
    }
  }
  
  // 获取当前视频ID
  getCurrentVideoId() {
    console.log('[视频ID] 开始获取视频ID');
    
    // 优先从全局VideoPlayer实例获取激活的视频ID（支持字幕变体切换）
    if (window.videoPlayerInstance && typeof window.videoPlayerInstance.getActiveVideoId === 'function') {
      const activeId = window.videoPlayerInstance.getActiveVideoId();
      console.log('[视频ID] 从 getActiveVideoId 获取:', activeId);
      if (activeId) return activeId;
    }
    
    // 备用方案：直接访问currentSubtitleId或currentVideoId
    if (window.videoPlayerInstance) {
      if (window.videoPlayerInstance.currentSubtitleId) {
        console.log('[视频ID] 从 currentSubtitleId 获取:', window.videoPlayerInstance.currentSubtitleId);
        return window.videoPlayerInstance.currentSubtitleId;
      }
      if (window.videoPlayerInstance.currentVideoId) {
        console.log('[视频ID] 从 currentVideoId 获取:', window.videoPlayerInstance.currentVideoId);
        return window.videoPlayerInstance.currentVideoId;
      }
    }
    
    // 最后备用方案：从URL参数获取
    const urlParams = new URLSearchParams(window.location.search);
    const urlVideoId = urlParams.get('video_id') || urlParams.get('videoId');
    console.log('[视频ID] 从URL参数获取:', urlVideoId);
    
    if (!urlVideoId) {
      console.log('[视频ID] 未找到视频ID');
    }
    
    return urlVideoId;
  }
}