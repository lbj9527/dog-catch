/**
 * Dog-Catch 悬浮球组件
 * 实现悬浮球的创建、交互和动画效果
 */

class DogCatchFloatingBall {
  constructor() {
    this.ball = null;
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
    
    // 鼠标事件
    this.ball.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.ball.addEventListener('mouseenter', this.handleMouseEnter.bind(this));
    this.ball.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
    
    // 全局鼠标事件（用于拖拽）
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
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
    
    // 触发侧边栏显示
    this.toggleSidebar();
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
    if (this.ball) {
      this.ball.remove();
      this.ball = null;
    }
  }
}

// 创建全局实例
window.dogCatchFloatingBall = null;
