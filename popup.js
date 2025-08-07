/**
 * Dog-Catch 弹出窗口脚本
 * 处理弹出窗口的交互逻辑
 */

class DogCatchPopup {
  constructor() {
    this.currentTab = null;
    this.settings = null;
    this.resources = [];
    
    this.init();
  }
  
  /**
   * 初始化弹出窗口
   */
  async init() {
    try {
      this.showLoading(true);
      
      // 获取当前标签页
      await this.getCurrentTab();
      
      // 加载设置和数据
      await this.loadData();
      
      // 绑定事件
      this.bindEvents();
      
      // 更新界面
      this.updateUI();
      
      this.showLoading(false);
    } catch (error) {
      console.error('初始化弹出窗口失败:', error);
      this.showError('初始化失败: ' + error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * 获取当前标签页
   */
  async getCurrentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    this.currentTab = tabs[0];
  }
  
  /**
   * 加载数据
   */
  async loadData() {
    // 加载设置
    const settingsResult = await chrome.storage.local.get('dog-catch-settings');
    this.settings = settingsResult['dog-catch-settings'] || {
      enabled: true,
      autoDetect: true,
      showNotifications: true
    };
    
    // 加载资源
    const resourcesResult = await chrome.storage.local.get('dog-catch-resources');
    this.resources = resourcesResult['dog-catch-resources'] || [];
  }
  
  /**
   * 绑定事件
   */
  bindEvents() {
    // 扩展开关
    const extensionToggle = document.getElementById('extensionToggle');
    extensionToggle.addEventListener('click', this.handleToggleExtension.bind(this));
    
    // 打开侧边栏
    const openSidebar = document.getElementById('openSidebar');
    openSidebar.addEventListener('click', this.handleOpenSidebar.bind(this));
    
    // 刷新资源
    const refreshResources = document.getElementById('refreshResources');
    refreshResources.addEventListener('click', this.handleRefreshResources.bind(this));
    
    // 清空资源
    const clearResources = document.getElementById('clearResources');
    clearResources.addEventListener('click', this.handleClearResources.bind(this));
    
    // 设置选项
    const openSettings = document.getElementById('openSettings');
    openSettings.addEventListener('click', this.handleOpenSettings.bind(this));
  }
  
  /**
   * 更新界面
   */
  updateUI() {
    // 更新扩展状态开关
    const extensionToggle = document.getElementById('extensionToggle');
    if (this.settings.enabled) {
      extensionToggle.classList.add('active');
    } else {
      extensionToggle.classList.remove('active');
    }
    
    // 更新资源数量
    const resourceCount = document.getElementById('resourceCount');
    resourceCount.textContent = this.resources.length;
    
    // 更新当前页面
    const currentPage = document.getElementById('currentPage');
    if (this.currentTab && this.currentTab.url) {
      try {
        const url = new URL(this.currentTab.url);
        currentPage.textContent = url.hostname;
      } catch (error) {
        currentPage.textContent = '未知页面';
      }
    } else {
      currentPage.textContent = '未知页面';
    }
  }
  
  /**
   * 处理扩展开关切换
   */
  async handleToggleExtension() {
    try {
      this.showLoading(true);
      
      // 发送消息到后台脚本
      const response = await chrome.runtime.sendMessage({
        type: 'TOGGLE_EXTENSION'
      });
      
      if (response.success) {
        this.settings.enabled = response.enabled;
        this.updateUI();
        
        // 显示状态提示
        this.showMessage(response.enabled ? '扩展已启用' : '扩展已禁用');
      } else {
        throw new Error(response.error || '切换失败');
      }
      
      this.showLoading(false);
    } catch (error) {
      console.error('切换扩展状态失败:', error);
      this.showError('切换失败: ' + error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * 处理打开侧边栏
   */
  async handleOpenSidebar() {
    try {
      if (!this.currentTab) {
        throw new Error('无法获取当前标签页');
      }
      
      // 发送消息到内容脚本
      await chrome.tabs.sendMessage(this.currentTab.id, {
        type: 'OPEN_SIDEBAR'
      });
      
      // 关闭弹出窗口
      window.close();
    } catch (error) {
      console.error('打开侧边栏失败:', error);
      this.showError('打开侧边栏失败，请刷新页面后重试');
    }
  }
  
  /**
   * 处理刷新资源
   */
  async handleRefreshResources() {
    try {
      this.showLoading(true);
      
      if (!this.currentTab) {
        throw new Error('无法获取当前标签页');
      }
      
      // 发送消息到后台脚本
      const response = await chrome.runtime.sendMessage({
        type: 'DETECT_RESOURCES'
      });
      
      if (response.success) {
        // 发送消息到内容脚本刷新侧边栏
        chrome.tabs.sendMessage(this.currentTab.id, {
          type: 'REFRESH_RESOURCES',
          resources: response.resources
        }).catch(error => {
          console.log('发送刷新消息失败:', error);
        });
        
        this.showMessage('资源检测完成');
      } else {
        throw new Error(response.error || '检测失败');
      }
      
      this.showLoading(false);
    } catch (error) {
      console.error('刷新资源失败:', error);
      this.showError('刷新失败: ' + error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * 处理清空资源
   */
  async handleClearResources() {
    try {
      if (!confirm('确定要清空所有检测到的资源吗？')) {
        return;
      }
      
      this.showLoading(true);
      
      // 清空存储中的资源
      await chrome.storage.local.set({ 'dog-catch-resources': [] });
      
      // 发送消息到内容脚本
      if (this.currentTab) {
        chrome.tabs.sendMessage(this.currentTab.id, {
          type: 'CLEAR_RESOURCES'
        }).catch(error => {
          console.log('发送清空消息失败:', error);
        });
      }
      
      // 更新本地数据
      this.resources = [];
      this.updateUI();
      
      this.showMessage('资源已清空');
      this.showLoading(false);
    } catch (error) {
      console.error('清空资源失败:', error);
      this.showError('清空失败: ' + error.message);
      this.showLoading(false);
    }
  }
  
  /**
   * 处理打开设置
   */
  handleOpenSettings() {
    // 这里将来可以打开设置页面
    // chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    this.showMessage('设置功能即将推出');
  }
  
  /**
   * 显示加载状态
   */
  showLoading(show) {
    const loading = document.getElementById('loading');
    const mainContent = document.getElementById('mainContent');
    
    if (show) {
      loading.style.display = 'block';
      mainContent.style.display = 'none';
    } else {
      loading.style.display = 'none';
      mainContent.style.display = 'block';
    }
  }
  
  /**
   * 显示错误信息
   */
  showError(message) {
    const errorElement = document.getElementById('errorMessage');
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // 3秒后自动隐藏
    setTimeout(() => {
      errorElement.style.display = 'none';
    }, 3000);
  }
  
  /**
   * 显示提示信息
   */
  showMessage(message) {
    // 简单的提示实现，可以后续优化
    const errorElement = document.getElementById('errorMessage');
    errorElement.style.background = 'rgba(0, 255, 0, 0.2)';
    errorElement.style.borderColor = 'rgba(0, 255, 0, 0.3)';
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    
    // 2秒后自动隐藏
    setTimeout(() => {
      errorElement.style.display = 'none';
      errorElement.style.background = 'rgba(255, 0, 0, 0.2)';
      errorElement.style.borderColor = 'rgba(255, 0, 0, 0.3)';
    }, 2000);
  }
}

// 当 DOM 加载完成时初始化
document.addEventListener('DOMContentLoaded', () => {
  new DogCatchPopup();
});
