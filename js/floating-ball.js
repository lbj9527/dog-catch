/**
 * Dog-Catch 悬浮球组件
 * 实现悬浮球的创建、交互和动画效果
 */

class DogCatchFloatingBall {
  constructor() {
    this.ball = null;
    this.contextMenu = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.position = DOG_CATCH_CONSTANTS.DEFAULTS.BALL_POSITION;
    this.isVisible = true;

    this.init();
  }
  
  /**
   * 初始化悬浮球
   */
  async init() {
    // 加载保存的位置
    await this.loadPosition();
    
    // 创建悬浮球元素
    this.createBall();
    
    // 绑定事件
    this.bindEvents();
    
    // 设置初始状态
    this.setIdleState();
    
    console.log('Dog-Catch 悬浮球初始化完成');
  }
  
  /**
   * 创建悬浮球元素
   */
  createBall() {
    // 检查是否已存在
    const existingBall = DOMUtils.find(`.${DOG_CATCH_CONSTANTS.CLASSES.FLOATING_BALL}`);
    if (existingBall) {
      existingBall.remove();
    }
    
    // 创建悬浮球
    this.ball = DOMUtils.createElement('div', {
      className: DOG_CATCH_CONSTANTS.CLASSES.FLOATING_BALL,
      attributes: {
        'data-dog-catch': 'floating-ball',
        'title': 'Dog-Catch - 点击打开媒体检测面板'
      }
    });
    
    // 设置位置
    this.updatePosition();
    
    // 添加到页面
    document.body.appendChild(this.ball);
  }
  
  /**
   * 绑定事件
   */
  bindEvents() {
    if (!this.ball) return;

    // 点击事件
    this.ball.addEventListener('click', this.handleClick.bind(this));

    // 右键菜单事件
    this.ball.addEventListener('contextmenu', this.handleContextMenu.bind(this));

    // 鼠标事件
    this.ball.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.ball.addEventListener('mouseenter', this.handleMouseEnter.bind(this));
    this.ball.addEventListener('mouseleave', this.handleMouseLeave.bind(this));

    // 全局鼠标事件（用于拖拽）
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // 全局点击事件（用于关闭右键菜单）
    document.addEventListener('click', this.handleDocumentClick.bind(this));

    // 触摸事件（移动端支持）
    this.ball.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    document.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
    document.addEventListener('touchend', this.handleTouchEnd.bind(this));

    // 窗口大小变化事件
    window.addEventListener('resize', debounce(this.handleResize.bind(this), 250));
  }
  
  /**
   * 处理点击事件
   */
  handleClick(event) {
    event.preventDefault();
    event.stopPropagation();

    // 如果正在拖拽，不触发点击
    if (this.isDragging) return;

    // 添加点击动画
    this.addPulseAnimation();
    this.addRippleAnimation();

    // 触发侧边栏显示并隐藏悬浮球
    this.toggleSidebar();
    this.hide();
  }

  /**
   * 处理右键菜单事件
   */
  handleContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    // 如果正在拖拽，不显示菜单
    if (this.isDragging) return;

    this.showContextMenu(event);
  }

  /**
   * 处理文档点击事件
   */
  handleDocumentClick(event) {
    // 如果点击的不是悬浮球或右键菜单，则隐藏右键菜单
    if (this.contextMenu &&
        !this.ball.contains(event.target) &&
        !this.contextMenu.contains(event.target)) {
      this.hideContextMenu();
    }
  }
  
  /**
   * 处理鼠标按下事件
   */
  handleMouseDown(event) {
    event.preventDefault();
    
    this.isDragging = true;
    this.dragOffset = {
      x: event.clientX - this.ball.offsetLeft,
      y: event.clientY - this.ball.offsetTop
    };
    
    DOMUtils.addClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DRAGGING);
    document.body.style.userSelect = 'none';
  }
  
  /**
   * 处理鼠标移动事件
   */
  handleMouseMove(event) {
    if (!this.isDragging) return;
    
    event.preventDefault();
    
    const x = event.clientX - this.dragOffset.x;
    const y = event.clientY - this.dragOffset.y;
    
    this.setPosition(x, y);
  }
  
  /**
   * 处理鼠标释放事件
   */
  handleMouseUp(event) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    DOMUtils.removeClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DRAGGING);
    document.body.style.userSelect = '';
    
    // 磁性吸附到边缘
    this.snapToEdge();
    
    // 保存位置
    this.savePosition();
  }
  
  /**
   * 处理鼠标进入事件
   */
  handleMouseEnter() {
    if (this.isDragging) return;
    this.removeIdleState();
  }
  
  /**
   * 处理鼠标离开事件
   */
  handleMouseLeave() {
    if (this.isDragging) return;
    this.setIdleState();
  }
  
  /**
   * 处理触摸开始事件
   */
  handleTouchStart(event) {
    event.preventDefault();
    
    const touch = event.touches[0];
    this.isDragging = true;
    this.dragOffset = {
      x: touch.clientX - this.ball.offsetLeft,
      y: touch.clientY - this.ball.offsetTop
    };
    
    DOMUtils.addClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DRAGGING);
  }
  
  /**
   * 处理触摸移动事件
   */
  handleTouchMove(event) {
    if (!this.isDragging) return;
    
    event.preventDefault();
    
    const touch = event.touches[0];
    const x = touch.clientX - this.dragOffset.x;
    const y = touch.clientY - this.dragOffset.y;
    
    this.setPosition(x, y);
  }
  
  /**
   * 处理触摸结束事件
   */
  handleTouchEnd(event) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    DOMUtils.removeClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DRAGGING);
    
    // 磁性吸附到边缘
    this.snapToEdge();
    
    // 保存位置
    this.savePosition();
  }
  
  /**
   * 处理窗口大小变化
   */
  handleResize() {
    // 重新计算位置，确保悬浮球在可视区域内
    this.constrainPosition();
    this.updatePosition();
    this.savePosition();
  }
  
  /**
   * 设置位置
   */
  setPosition(x, y) {
    this.position = { x, y };
    this.constrainPosition();
    this.updatePosition();
  }
  
  /**
   * 约束位置在可视区域内
   */
  constrainPosition() {
    const ballSize = 56;
    const margin = 10;
    
    const maxX = window.innerWidth - ballSize - margin;
    const maxY = window.innerHeight - ballSize - margin;
    
    if (typeof this.position.x === 'number') {
      this.position.x = Math.max(margin, Math.min(this.position.x, maxX));
    }
    
    if (typeof this.position.y === 'number') {
      this.position.y = Math.max(margin, Math.min(this.position.y, maxY));
    }
  }
  
  /**
   * 更新位置样式
   */
  updatePosition() {
    if (!this.ball) return;
    
    if (typeof this.position.x === 'number') {
      this.ball.style.left = `${this.position.x}px`;
      this.ball.style.right = 'auto';
    } else {
      this.ball.style.right = this.position.x;
      this.ball.style.left = 'auto';
    }
    
    if (typeof this.position.y === 'number') {
      this.ball.style.top = `${this.position.y}px`;
      this.ball.style.bottom = 'auto';
      this.ball.style.transform = 'none';
    } else {
      this.ball.style.top = this.position.y;
      this.ball.style.bottom = 'auto';
      this.ball.style.transform = 'translateY(-50%)';
    }
  }
  
  /**
   * 磁性吸附到边缘
   */
  snapToEdge() {
    const ballRect = this.ball.getBoundingClientRect();
    const centerX = ballRect.left + ballRect.width / 2;
    const windowWidth = window.innerWidth;
    
    // 吸附到左边或右边
    if (centerX < windowWidth / 2) {
      // 吸附到左边
      this.position.x = 20;
    } else {
      // 吸附到右边
      this.position.x = '20px';
    }
    
    this.updatePosition();
  }
  
  /**
   * 加载保存的位置
   */
  async loadPosition() {
    const savedPosition = await StorageUtils.get(
      DOG_CATCH_CONSTANTS.STORAGE_KEYS.POSITION,
      DOG_CATCH_CONSTANTS.DEFAULTS.BALL_POSITION
    );
    
    this.position = savedPosition;
  }
  
  /**
   * 保存位置
   */
  async savePosition() {
    await StorageUtils.set(DOG_CATCH_CONSTANTS.STORAGE_KEYS.POSITION, this.position);
  }
  
  /**
   * 设置空闲状态
   */
  setIdleState() {
    if (!this.ball) return;
    DOMUtils.addClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.IDLE);
  }
  
  /**
   * 移除空闲状态
   */
  removeIdleState() {
    if (!this.ball) return;
    DOMUtils.removeClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.IDLE);
  }
  
  /**
   * 添加脉冲动画
   */
  addPulseAnimation() {
    AnimationUtils.addTemporaryClass(
      this.ball,
      DOG_CATCH_CONSTANTS.ANIMATIONS.PULSE,
      600
    );
  }
  
  /**
   * 添加涟漪动画
   */
  addRippleAnimation() {
    AnimationUtils.addTemporaryClass(
      this.ball,
      DOG_CATCH_CONSTANTS.ANIMATIONS.RIPPLE,
      600
    );
  }
  
  /**
   * 设置检测状态
   */
  setDetectingState() {
    if (!this.ball) return;
    DOMUtils.addClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DETECTING);
  }
  
  /**
   * 移除检测状态
   */
  removeDetectingState() {
    if (!this.ball) return;
    DOMUtils.removeClass(this.ball, DOG_CATCH_CONSTANTS.ANIMATIONS.DETECTING);
  }
  
  /**
   * 显示发现资源动画
   */
  showFoundResourceAnimation() {
    AnimationUtils.addTemporaryClass(
      this.ball,
      DOG_CATCH_CONSTANTS.ANIMATIONS.FOUND_RESOURCE,
      1000
    );
  }
  
  /**
   * 显示新资源动画
   */
  showNewResourceAnimation() {
    AnimationUtils.addTemporaryClass(
      this.ball,
      DOG_CATCH_CONSTANTS.ANIMATIONS.NEW_RESOURCE,
      2400
    );
  }
  
  /**
   * 切换侧边栏显示
   */
  toggleSidebar() {
    // 这里会调用侧边栏的显示/隐藏方法
    if (window.dogCatchSidebar) {
      window.dogCatchSidebar.toggle();
    }
  }

  /**
   * 显示右键菜单
   */
  showContextMenu(event) {
    // 隐藏已存在的菜单
    this.hideContextMenu();

    // 创建右键菜单
    this.contextMenu = DOMUtils.createElement('div', {
      className: 'dog-catch-context-menu',
      innerHTML: `
        <div class="dog-catch-context-menu-item" data-action="close-extension">
          <span class="icon">🚫</span>
          <span class="text">关闭插件</span>
        </div>
        <div class="dog-catch-context-menu-item" data-action="settings">
          <span class="icon">⚙️</span>
          <span class="text">设置</span>
        </div>
      `
    });

    // 添加菜单样式
    this.contextMenu.style.cssText = `
      position: fixed;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      padding: 8px 0;
      min-width: 140px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: #333;
    `;

    // 计算菜单位置
    const ballRect = this.ball.getBoundingClientRect();
    let menuX = ballRect.right + 10;
    let menuY = ballRect.top;

    // 确保菜单不超出屏幕边界
    if (menuX + 140 > window.innerWidth) {
      menuX = ballRect.left - 150;
    }
    if (menuY + 80 > window.innerHeight) {
      menuY = window.innerHeight - 80;
    }

    this.contextMenu.style.left = `${menuX}px`;
    this.contextMenu.style.top = `${menuY}px`;

    // 添加菜单项样式
    const menuItems = this.contextMenu.querySelectorAll('.dog-catch-context-menu-item');
    menuItems.forEach(item => {
      item.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 16px;
        cursor: pointer;
        transition: background-color 0.2s ease;
      `;

      const icon = item.querySelector('.icon');
      const text = item.querySelector('.text');

      if (icon) {
        icon.style.cssText = `
          margin-right: 8px;
          font-size: 16px;
        `;
      }

      if (text) {
        text.style.cssText = `
          flex: 1;
        `;
      }

      // 悬停效果
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      });

      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });

      // 点击事件
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleContextMenuClick(item.dataset.action);
      });
    });

    // 添加到页面
    document.body.appendChild(this.contextMenu);

    // 添加显示动画
    this.contextMenu.style.opacity = '0';
    this.contextMenu.style.transform = 'scale(0.9)';

    requestAnimationFrame(() => {
      this.contextMenu.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      this.contextMenu.style.opacity = '1';
      this.contextMenu.style.transform = 'scale(1)';
    });
  }

  /**
   * 隐藏右键菜单
   */
  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.opacity = '0';
      this.contextMenu.style.transform = 'scale(0.9)';

      setTimeout(() => {
        if (this.contextMenu) {
          this.contextMenu.remove();
          this.contextMenu = null;
        }
      }, 200);
    }
  }

  /**
   * 处理右键菜单点击
   */
  handleContextMenuClick(action) {
    this.hideContextMenu();

    switch (action) {
      case 'close-extension':
        this.closeExtension();
        break;
      case 'settings':
        this.openSettings();
        break;
    }
  }

  /**
   * 关闭插件
   */
  closeExtension() {
    // 隐藏所有组件
    this.hide();
    if (window.dogCatchSidebar) {
      window.dogCatchSidebar.hide();
    }

    // 发送消息给background script关闭插件
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        action: 'closeExtension'
      }).catch(() => {
        // 忽略错误，可能是在开发环境
      });
    }

    // 销毁组件
    setTimeout(() => {
      this.destroy();
      if (window.dogCatchSidebar) {
        window.dogCatchSidebar.destroy();
      }
    }, 300);
  }

  /**
   * 打开设置
   */
  openSettings() {
    // 这里可以实现设置功能
    console.log('打开设置面板');
    // 暂时显示一个提示
    this.showNotification('设置功能即将推出');
  }

  /**
   * 显示通知
   */
  showNotification(message) {
    const notification = DOMUtils.createElement('div', {
      className: 'dog-catch-notification',
      textContent: message
    });

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 20px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 999999;
      opacity: 0;
      transform: translateY(-10px);
      transition: all 0.3s ease;
    `;

    document.body.appendChild(notification);

    requestAnimationFrame(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateY(-10px)';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  
  /**
   * 显示悬浮球
   */
  show() {
    if (this.ball) {
      this.ball.style.display = 'flex';
      this.isVisible = true;
    }
  }
  
  /**
   * 隐藏悬浮球
   */
  hide() {
    if (this.ball) {
      this.ball.style.display = 'none';
      this.isVisible = false;
    }
  }
  
  /**
   * 销毁悬浮球
   */
  destroy() {
    // 隐藏右键菜单
    this.hideContextMenu();

    // 移除悬浮球
    if (this.ball) {
      this.ball.remove();
      this.ball = null;
    }
  }
}

// 创建全局实例
window.dogCatchFloatingBall = null;
