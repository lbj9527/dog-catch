/**
 * Dog-Catch 后台脚本 (Service Worker)
 * 处理扩展的后台逻辑和事件
 */

// 扩展安装时的初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Dog-Catch 扩展已安装/更新:', details.reason);
  
  if (details.reason === 'install') {
    // 首次安装
    handleFirstInstall();
  } else if (details.reason === 'update') {
    // 更新
    handleUpdate(details.previousVersion);
  }
});

// 扩展启动时的初始化
chrome.runtime.onStartup.addListener(() => {
  console.log('Dog-Catch 扩展启动');
  initializeExtension();
});

/**
 * 处理首次安装
 */
async function handleFirstInstall() {
  console.log('Dog-Catch 首次安装，初始化默认设置...');
  
  // 设置默认配置
  const defaultSettings = {
    enabled: true,
    ballPosition: { x: '20px', y: '50%' },
    autoDetect: true,
    showNotifications: true,
    theme: 'auto'
  };
  
  try {
    await chrome.storage.local.set({
      'dog-catch-settings': defaultSettings,
      'dog-catch-resources': [],
      'dog-catch-ball-position': defaultSettings.ballPosition
    });
    
    console.log('默认设置已保存');
  } catch (error) {
    console.error('保存默认设置失败:', error);
  }
  
  // 可选：打开欢迎页面
  // chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
}

/**
 * 处理更新
 */
async function handleUpdate(previousVersion) {
  console.log(`Dog-Catch 从版本 ${previousVersion} 更新到当前版本`);
  
  // 这里可以处理版本迁移逻辑
  // 例如：数据格式变更、新功能介绍等
}

/**
 * 初始化扩展
 */
async function initializeExtension() {
  console.log('初始化 Dog-Catch 扩展...');
  
  // 检查设置
  try {
    const settings = await chrome.storage.local.get('dog-catch-settings');
    if (!settings['dog-catch-settings']) {
      await handleFirstInstall();
    }
  } catch (error) {
    console.error('初始化扩展失败:', error);
  }
}

/**
 * 处理来自内容脚本的消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message, '来自:', sender.tab?.url);
  
  switch (message.type) {
    case 'GET_SETTINGS':
      handleGetSettings(sendResponse);
      return true; // 异步响应
      
    case 'UPDATE_SETTINGS':
      handleUpdateSettings(message.settings, sendResponse);
      return true;
      
    case 'DETECT_RESOURCES':
      handleDetectResources(sender.tab, sendResponse);
      return true;
      
    case 'RESOURCE_FOUND':
      handleResourceFound(message.resource, sender.tab);
      break;
      
    case 'TOGGLE_EXTENSION':
      handleToggleExtension(sender.tab, sendResponse);
      return true;

    case 'closeExtension':
      handleCloseExtension(sender.tab, sendResponse);
      return true;

    default:
      console.warn('未知消息类型:', message.type || message.action);
  }
});

/**
 * 获取设置
 */
async function handleGetSettings(sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    sendResponse({ success: true, settings: result['dog-catch-settings'] });
  } catch (error) {
    console.error('获取设置失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 更新设置
 */
async function handleUpdateSettings(settings, sendResponse) {
  try {
    await chrome.storage.local.set({ 'dog-catch-settings': settings });
    sendResponse({ success: true });
    
    // 通知所有标签页设置已更新
    notifyAllTabs('SETTINGS_UPDATED', { settings });
  } catch (error) {
    console.error('更新设置失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 检测资源
 */
async function handleDetectResources(tab, sendResponse) {
  try {
    // 这里将来会实现资源检测逻辑
    // 目前返回模拟数据
    const mockResources = [
      {
        id: Date.now().toString(),
        type: 'video',
        title: 'detected_video.mp4',
        url: 'https://example.com/video.mp4',
        size: 10485760,
        duration: 90,
        timestamp: Date.now()
      }
    ];
    
    sendResponse({ success: true, resources: mockResources });
  } catch (error) {
    console.error('检测资源失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 处理发现的资源
 */
async function handleResourceFound(resource, tab) {
  console.log('发现新资源:', resource, '在标签页:', tab.url);
  
  try {
    // 保存资源到存储
    const result = await chrome.storage.local.get('dog-catch-resources');
    const resources = result['dog-catch-resources'] || [];
    
    // 检查是否已存在
    if (!resources.find(r => r.url === resource.url)) {
      resources.unshift({
        ...resource,
        id: Date.now().toString(),
        timestamp: Date.now(),
        tabId: tab.id,
        tabUrl: tab.url
      });
      
      // 限制资源数量
      if (resources.length > 1000) {
        resources.splice(1000);
      }
      
      await chrome.storage.local.set({ 'dog-catch-resources': resources });
      
      // 通知内容脚本
      chrome.tabs.sendMessage(tab.id, {
        type: 'RESOURCE_ADDED',
        resource: resource
      }).catch(error => {
        console.log('发送消息到内容脚本失败:', error);
      });
    }
  } catch (error) {
    console.error('处理发现的资源失败:', error);
  }
}

/**
 * 切换扩展启用状态
 */
async function handleToggleExtension(tab, sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    const settings = result['dog-catch-settings'] || {};

    settings.enabled = !settings.enabled;

    await chrome.storage.local.set({ 'dog-catch-settings': settings });

    // 通知内容脚本
    chrome.tabs.sendMessage(tab.id, {
      type: 'EXTENSION_TOGGLED',
      enabled: settings.enabled
    }).catch(error => {
      console.log('发送消息到内容脚本失败:', error);
    });

    sendResponse({ success: true, enabled: settings.enabled });
  } catch (error) {
    console.error('切换扩展状态失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 关闭扩展
 */
async function handleCloseExtension(tab, sendResponse) {
  try {
    const result = await chrome.storage.local.get('dog-catch-settings');
    const settings = result['dog-catch-settings'] || {};

    // 设置扩展为禁用状态
    settings.enabled = false;

    await chrome.storage.local.set({ 'dog-catch-settings': settings });

    // 通知内容脚本关闭扩展
    chrome.tabs.sendMessage(tab.id, {
      type: 'EXTENSION_CLOSED'
    }).catch(error => {
      console.log('发送消息到内容脚本失败:', error);
    });

    console.log('Dog-Catch 扩展已关闭');

    if (sendResponse) {
      sendResponse({ success: true });
    }
  } catch (error) {
    console.error('关闭扩展失败:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

/**
 * 通知所有标签页
 */
async function notifyAllTabs(type, data) {
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: type,
        ...data
      }).catch(error => {
        // 忽略无法发送消息的标签页（如扩展页面、新标签页等）
      });
    }
  } catch (error) {
    console.error('通知所有标签页失败:', error);
  }
}

/**
 * 处理标签页更新事件
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当标签页完成加载时
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('标签页加载完成:', tab.url);
    
    // 这里可以触发资源检测
    // 目前只是记录日志
  }
});

/**
 * 处理标签页激活事件
 */
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('切换到标签页:', activeInfo.tabId);
  
  // 这里可以更新扩展状态
});

/**
 * 处理网络请求（预留接口）
 */
// chrome.webRequest.onBeforeRequest.addListener(
//   (details) => {
//     // 这里将来会实现网络请求监听逻辑
//     // 用于检测媒体资源
//   },
//   { urls: ["<all_urls>"] },
//   ["requestBody"]
// );

console.log('Dog-Catch 后台脚本已加载');
