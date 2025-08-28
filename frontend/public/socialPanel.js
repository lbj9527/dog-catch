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

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    panel.appendChild(content);

    this.el = panel;
    this.headerEl = header;
    this.titleEl = title;
    this.closeBtn = closeBtn;
    this.contentEl = content;

    // 默认挂到舞台底部，不显示，由 syncLayout 控制真正位置
    const stage = document.querySelector(this.stageSelector);
    if (stage) stage.appendChild(panel);

    return panel;
  }

  getElement() {
    return this.el || this.ensureCreated();
  }

  setContent(titleText = '', html = '') {
    const el = this.getElement();
    if (!el) return;
    if (this.titleEl) this.titleEl.textContent = titleText;
    if (this.contentEl) this.contentEl.innerHTML = html;
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
      });
    }
  }

  hide(state = { isMobile: this.getIsMobile(), isSocialMode: false }) {
    const stage = document.querySelector(this.stageSelector);
    const el = this.getElement();
    if (!el || !stage) return;

    // 清理之前的延迟
    if (this._animTimer) { clearTimeout(this._animTimer); this._animTimer = null; }

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
}