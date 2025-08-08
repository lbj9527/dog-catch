/**
 * Dog-Catch 内容脚本
 * 负责在网页中注入悬浮球和侧边栏组件
 */

(function() {
  'use strict';
  
  // 防止重复注入
  if (window.dogCatchInjected) {
    return;
  }
  window.dogCatchInjected = true;
  
  // 等待 DOM 加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDogCatch);
  } else {
    initDogCatch();
  }
  
  /**
   * 初始化 Dog-Catch
   */
  function initDogCatch() {
    // 检查是否在框架页面中
    if (window.self !== window.top) {
      return;
    }
    
    // 检查是否在扩展页面中
    if (window.location.protocol === 'chrome-extension:' || 
        window.location.protocol === 'moz-extension:') {
      return;
    }
    
    // 等待工具函数加载
    waitForUtils().then(() => {
      console.log('Dog-Catch 开始初始化...');
      
      // 创建悬浮球实例
      if (!window.dogCatchFloatingBall) {
        window.dogCatchFloatingBall = new DogCatchFloatingBall();
      }
      
      // 创建侧边栏实例
      if (!window.dogCatchSidebar) {
        window.dogCatchSidebar = new DogCatchSidebar();
      }
      
      // 绑定全局事件
      bindGlobalEvents();
      
      console.log('Dog-Catch 初始化完成');
    }).catch(error => {
      console.error('Dog-Catch 初始化失败:', error);
    });
  }
  
  /**
   * 等待工具函数加载
   */
  function waitForUtils() {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5秒超时
      
      const checkUtils = () => {
        attempts++;
        
        if (window.DOG_CATCH_CONSTANTS && 
            window.DOMUtils && 
            window.AnimationUtils && 
            window.StorageUtils && 
            window.FormatUtils) {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('工具函数加载超时'));
        } else {
          setTimeout(checkUtils, 100);
        }
      };
      
      checkUtils();
    });
  }
  
  /**
   * 绑定全局事件
   */
  function bindGlobalEvents() {
    // 监听侧边栏事件
    document.addEventListener('dogCatch:show', handleSidebarShow);
    document.addEventListener('dogCatch:hide', handleSidebarHide);
    document.addEventListener('dogCatch:newResource', handleNewResource);
    
    // 监听页面变化
    observePageChanges();
    
    // 监听网络请求（将来用于资源检测）
    // 这里预留接口，后续阶段会实现
    
    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);
  }
  
  /**
   * 处理侧边栏显示事件
   */
  function handleSidebarShow(event) {
    console.log('侧边栏显示');
    
    // 停止悬浮球的空闲动画
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.removeIdleState();
    }
  }
  
  /**
   * 处理侧边栏隐藏事件
   */
  function handleSidebarHide(event) {
    console.log('侧边栏隐藏');
    
    // 恢复悬浮球的空闲动画
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.setIdleState();
    }
  }
  
  /**
   * 处理新资源事件
   */
  function handleNewResource(event) {
    console.log('发现新资源:', event.detail.resource);
    
    // 显示悬浮球新资源动画
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.showNewResourceAnimation();
    }
  }
  
  /**
   * 观察页面变化
   */
  function observePageChanges() {
    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(throttle(handleDOMChanges, 1000));
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
    
    // 监听 URL 变化（SPA 应用）
    let currentUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        handleUrlChange();
      }
    });
    
    urlObserver.observe(document, {
      subtree: true,
      childList: true
    });
    
    // 监听 popstate 事件
    window.addEventListener('popstate', handleUrlChange);
  }
  
  /**
   * 处理 DOM 变化
   */
  function handleDOMChanges(mutations) {
    // 这里将来会实现媒体元素检测逻辑
    // 目前只是记录日志
    console.log('DOM 发生变化，检测新的媒体资源...');
    
    // 检查是否有新的媒体元素
    const mediaElements = document.querySelectorAll('video, audio, img[src*=".jpg"], img[src*=".png"], img[src*=".gif"]');
    
    if (mediaElements.length > 0) {
      console.log(`发现 ${mediaElements.length} 个媒体元素`);
      
      // 显示悬浮球检测动画
      if (window.dogCatchFloatingBall) {
        window.dogCatchFloatingBall.showFoundResourceAnimation();
      }
    }
  }
  
  /**
   * 处理 URL 变化
   */
  function handleUrlChange() {
    console.log('URL 变化，重新检测资源...');
    
    // 清空之前的资源（可选）
    // if (window.dogCatchSidebar) {
    //   window.dogCatchSidebar.clearResources();
    // }
    
    // 重新检测资源
    setTimeout(() => {
      if (window.dogCatchSidebar) {
        window.dogCatchSidebar.refreshResources();
      }
    }, 1000);
  }
  
  /**
   * 节流函数（简化版，如果 utils.js 未加载）
   */
  function throttle(func, limit) {
    if (window.throttle) {
      return window.throttle(func, limit);
    }
    
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  /**
   * 清理函数
   */
  function cleanup() {
    console.log('Dog-Catch 清理资源...');
    
    // 销毁组件
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.destroy();
      window.dogCatchFloatingBall = null;
    }
    
    if (window.dogCatchSidebar) {
      window.dogCatchSidebar.destroy();
      window.dogCatchSidebar = null;
    }
    
    // 移除事件监听
    document.removeEventListener('dogCatch:show', handleSidebarShow);
    document.removeEventListener('dogCatch:hide', handleSidebarHide);
    document.removeEventListener('dogCatch:newResource', handleNewResource);
    window.removeEventListener('popstate', handleUrlChange);
    window.removeEventListener('beforeunload', cleanup);
  }
  
  /**
   * 监听来自background script的消息
   */
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('内容脚本收到消息:', message);

      switch (message.type) {
        case 'TOGGLE_SIDEBAR':
        case 'OPEN_SIDEBAR':
          // 检查悬浮球是否已经显示（使用 DOM 检测更可靠）
          const floatingBallElement = document.querySelector('.dog-catch-floating-ball');
          const isFloatingBallVisible = floatingBallElement &&
            window.getComputedStyle(floatingBallElement).display !== 'none' &&
            window.getComputedStyle(floatingBallElement).visibility !== 'hidden';

          if (isFloatingBallVisible) {
            console.log('悬浮球已显示，插件已激活，忽略扩展图标点击');
            sendResponse({ success: true, message: 'Plugin already active, floating ball visible' });
          } else if (window.dogCatchSidebar) {
            // 悬浮球未显示，说明插件未激活，打开侧边栏
            console.log('悬浮球未显示，打开侧边栏激活插件');
            window.dogCatchSidebar.show();
            sendResponse({ success: true });
          } else {
            console.warn('侧边栏组件未初始化');
            sendResponse({ success: false, error: 'Sidebar not initialized' });
          }
          break;

        case 'CLOSE_SIDEBAR':
          if (window.dogCatchSidebar) {
            window.dogCatchSidebar.hide();
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Sidebar not initialized' });
          }
          break;

        case 'EXTENSION_CLOSED':
          console.log('收到扩展关闭消息');
          cleanup();
          sendResponse({ success: true });
          break;

        case 'EXTENSION_TOGGLED':
          console.log('扩展状态切换:', message.enabled);
          if (!message.enabled) {
            cleanup();
          } else {
            // 重新初始化
            setTimeout(initDogCatch, 100);
          }
          sendResponse({ success: true });
          break;

        case 'SETTINGS_UPDATED':
          console.log('设置已更新:', message.settings);
          // 这里可以处理设置更新
          sendResponse({ success: true });
          break;

        default:
          console.log('未知消息类型:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }

      return true; // 保持消息通道开放以支持异步响应
    });
  }

  // 导出清理函数供外部调用
  window.dogCatchCleanup = cleanup;

})();
