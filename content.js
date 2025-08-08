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

      // 注入深度搜索脚本
      injectDeepSearchScript();

      console.log('Dog-Catch 初始化完成');
    }).catch(error => {
      console.error('Dog-Catch 初始化失败:', error);
    });
  }
  
  /**
   * 注入深度搜索脚本
   */
  function injectDeepSearchScript() {
    try {
      // 创建script元素
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('js/deep-search.js');
      script.onload = function() {
        console.log('Dog-Catch 深度搜索脚本已注入');
        this.remove(); // 注入后移除script标签
      };
      script.onerror = function() {
        console.error('Dog-Catch 深度搜索脚本注入失败');
        this.remove();
      };

      // 注入到页面
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.error('注入深度搜索脚本失败:', error);
    }
  }

  /**
   * 时间格式化函数 - 移植自 cat-catch
   */
  function secToTime(sec) {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    return `${hours.toString().padStart(2, '0')}-${minutes.toString().padStart(2, '0')}-${seconds.toString().padStart(2, '0')}`;
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

    // 监听来自深度搜索脚本的消息
    window.addEventListener('message', handleWindowMessage);

    // 监听页面变化
    observePageChanges();

    // 页面卸载时清理
    window.addEventListener('beforeunload', cleanup);
  }

  /**
   * 处理来自深度搜索脚本的消息
   */
  function handleWindowMessage(event) {
    // 只处理来自同源的消息
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data;
    if (!data || !data.action) {
      return;
    }

    // 处理深度搜索发现的媒体资源
    if (data.action === 'dogCatchAddMedia') {
      if (!data.url) return;

      try {
        chrome.runtime.sendMessage({
          Message: "addMedia",
          url: data.url,
          href: data.href || window.location.href,
          extraExt: data.ext,
          mime: data.mime,
          requestId: data.requestId,
          requestHeaders: data.requestHeaders || { referer: data.referer }
        });
      } catch (e) {
        console.error('转发深度搜索消息失败:', e);
      }
    }

    // 处理深度搜索发现的加密密钥 - 移植自 cat-catch
    if (data.action === 'dogCatchAddKey' || data.action === 'catCatchAddKey') {
      if (!data.key) return;

      try {
        let key = data.key;
        if (key instanceof ArrayBuffer || key instanceof Array) {
          key = ArrayToBase64(key);
        }
        if (!key || window._dogCatchKeys?.includes(key)) { return; }

        // 初始化密钥数组
        if (!window._dogCatchKeys) {
          window._dogCatchKeys = [];
        }
        window._dogCatchKeys.push(key);

        // 发送到 background
        chrome.runtime.sendMessage({
          Message: "send2local",
          action: "addKey",
          data: key,
        });

        chrome.runtime.sendMessage({
          Message: "popupAddKey",
          data: key,
          url: data.url,
        });
      } catch (e) {
        console.error('转发深度搜索密钥失败:', e);
      }
    }

    // 处理 FFmpeg 相关消息 - 移植自 cat-catch
    if (data.action === 'catCatchFFmpeg') {
      if (!data.use || !data.files || !Array.isArray(data.files) || data.files.length === 0) {
        return;
      }

      data.title = data.title || document.title || new Date().getTime().toString();
      data.title = data.title.replaceAll('"', "").replaceAll("'", "").replaceAll(" ", "");

      let messageData = {
        Message: data.action,
        action: data.use,
        files: data.files,
        url: data.href || window.location.href,
      };
      messageData = { ...data, ...messageData };

      try {
        chrome.runtime.sendMessage(messageData);
      } catch (e) {
        console.error('转发 FFmpeg 消息失败:', e);
      }
    }

    // 处理其他 cat-catch 消息
    if (data.action === 'catCatchFFmpegResult') {
      if (!data.state || !data.tabId) { return; }
      try {
        chrome.runtime.sendMessage({ Message: "catCatchFFmpegResult", ...data });
      } catch (e) {
        console.error('转发 FFmpeg 结果失败:', e);
      }
    }

    if (data.action === 'catCatchToBackground') {
      delete data.action;
      try {
        chrome.runtime.sendMessage(data);
      } catch (e) {
        console.error('转发到 background 失败:', e);
      }
    }
  }

  /**
   * 数组转Base64 - 移植自 cat-catch
   */
  function ArrayToBase64(data) {
    try {
      let bytes = new Uint8Array(data);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    } catch (e) {
      return false;
    }
  }

  /**
   * 处理侧边栏显示事件
   */
  function handleSidebarShow() {
    console.log('侧边栏显示');

    // 停止悬浮球的空闲动画
    if (window.dogCatchFloatingBall) {
      window.dogCatchFloatingBall.removeIdleState();
    }
  }
  
  /**
   * 处理侧边栏隐藏事件
   */
  function handleSidebarHide() {
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
  function handleDOMChanges() {
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
          // 处理来自 cat-catch 的消息格式
          if (message.Message) {
            handleCatCatchMessage(message, sender, sendResponse);
            return true;
          }
          console.log('未知消息类型:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }

      return true; // 保持消息通道开放以支持异步响应
    });
  }

  // 导出清理函数供外部调用
  window.dogCatchCleanup = cleanup;

  // ========== 以下是从 cat-catch 的 js/content-script.js 移植的功能 ==========

  var _videoObj = [];
  var _videoSrc = [];
  var _dogCatchKeys = [];

  /**
   * 处理来自 cat-catch 的消息格式
   */
  function handleCatCatchMessage(Message, _sender, sendResponse) {
    if (chrome.runtime.lastError) { return; }

    // 安全检查
    if (!Message || typeof Message !== 'object') {
      sendResponse({ error: 'Invalid message format' });
      return false;
    }

    // 获取页面视频对象 - 移植自 cat-catch
    if (Message.Message == "getVideoState") {
      let videoObj = [];
      let videoSrc = [];
      document.querySelectorAll("video, audio").forEach(function (video) {
        if (video.currentSrc != "" && video.currentSrc != undefined) {
          videoObj.push(video);
          videoSrc.push(video.currentSrc);
        }
      });

      // 检查是否有新的视频
      if (videoObj.length > 0) {
        if (videoObj.length !== _videoObj.length || videoSrc.toString() !== _videoSrc.toString()) {
          _videoSrc = videoSrc;
          _videoObj = videoObj;
        }
        Message.index = Message.index == -1 ? 0 : Message.index;
        const video = videoObj[Message.index];
        const timePCT = video.currentTime / video.duration * 100;
        sendResponse({
          time: timePCT,
          currentTime: video.currentTime,
          duration: video.duration,
          volume: video.volume,
          count: _videoObj.length,
          src: _videoSrc,
          paused: video.paused,
          loop: video.loop,
          speed: video.playbackRate,
          muted: video.muted,
          type: video.tagName.toLowerCase()
        });
        return true;
      }
      sendResponse({ count: 0 });
      return true;
    }

    // 检查视频对象和索引的有效性
    const isValidVideoIndex = (index) => {
      return _videoObj && Array.isArray(_videoObj) &&
             typeof index === 'number' &&
             index >= 0 && index < _videoObj.length &&
             _videoObj[index];
    };

    // 速度控制 - 移植自 cat-catch
    if (Message.Message == "speed") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      _videoObj[Message.index].playbackRate = Message.speed;
      return true;
    }

    // 音量控制 - 移植自 cat-catch
    if (Message.Message == "volume") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      _videoObj[Message.index].volume = Message.volume;
      return true;
    }

    // 播放/暂停控制 - 移植自 cat-catch
    if (Message.Message == "play") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      if (Message.play) {
        _videoObj[Message.index].play();
      } else {
        _videoObj[Message.index].pause();
      }
      return true;
    }

    // 时间跳转 - 移植自 cat-catch
    if (Message.Message == "currentTime") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      _videoObj[Message.index].currentTime = Message.currentTime;
      return true;
    }

    // 循环控制 - 移植自 cat-catch
    if (Message.Message == "loop") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      _videoObj[Message.index].loop = Message.loop;
      return true;
    }

    // 静音控制 - 移植自 cat-catch
    if (Message.Message == "muted") {
      if (!isValidVideoIndex(Message.index)) {
        sendResponse({ error: 'Invalid video index' });
        return false;
      }
      _videoObj[Message.index].muted = Message.muted;
      return true;
    }

    // 截图视频图片 - 移植自 cat-catch
    if (Message.Message == "screenshot") {
      try {
        const video = _videoObj[Message.index];
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/jpeg");
        link.download = `${location.hostname}-${secToTime(video.currentTime)}.jpg`;
        link.click();
        // 清理DOM元素
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (link.parentNode) link.parentNode.removeChild(link);
        sendResponse("ok");
        return true;
      } catch (e) {
        console.log(e);
        return true;
      }
    }

    // 获取密钥 - 移植自 cat-catch
    if (Message.Message == "getKey") {
      sendResponse(_dogCatchKeys);
      return true;
    }

    // FFmpeg 处理 - 移植自 cat-catch
    if (Message.Message == "ffmpeg") {
      if (!Message.files) {
        window.postMessage(Message);
        sendResponse("ok");
        return true;
      }
      Message.quantity ??= Message.files.length;
      for (let item of Message.files) {
        const data = { ...Message, ...item };
        data.type = item.type ?? "video";
        if (data.data instanceof Blob) {
          window.postMessage(data);
        } else {
          fetch(data.data)
            .then(response => response.blob())
            .then(blob => {
              data.data = blob;
              window.postMessage(data);
            });
        }
      }
      sendResponse("ok");
      return true;
    }

    // 获取页面内容 - 移植自 cat-catch
    if (Message.Message == "getPage") {
      if (Message.find) {
        const DOM = document.querySelector(Message.find);
        DOM ? sendResponse(DOM.innerHTML) : sendResponse("");
        return true;
      }
      sendResponse(document.documentElement.outerHTML);
      return true;
    }

    return false;
  }

})();
