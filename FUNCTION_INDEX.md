# Dog-Catch 函数索引

本文档记录了 Dog-Catch 项目中所有的函数，按模块分类。

## 📋 目录

- [background.js - 后台脚本](#backgroundjs---后台脚本)
- [js/deep-search.js - 深度搜索脚本](#jsdeep-searchjs---深度搜索脚本)
- [js/sidebar.js - 侧边栏组件](#jssidebarjs---侧边栏组件)
- [js/utils.js - 工具函数库](#jsutilsjs---工具函数库)
- [js/floating-ball.js - 悬浮球组件](#jsfloating-balljs---悬浮球组件)
- [content.js - 内容脚本](#contentjs---内容脚本)

---

## background.js - 后台脚本

### 核心资源检测函数

- **`findMedia(data, isRegex, filter, timer)`** - 核心媒体资源检测函数
- **`CheckExtension(ext, size)`** - 检查文件扩展名和大小
- **`CheckType(dataType, dataSize)`** - 检查MIME类型和大小
- **`getResponseHeadersValue(data)`** - 获取响应头信息
- **`getRequestHeaders(data)`** - 获取请求头信息
- **`getResourceType(ext, mimeType)`** - 根据扩展名和MIME类型确定资源类型

### 数据管理函数

- **`save(tabId)`** - 保存数据到存储
- **`SetIcon(options)`** - 设置扩展图标
- **`isSpecialPage(url)`** - 检查是否为特殊页面
- **`fileNameParse(pathname)`** - 解析文件名和扩展名

### 消息处理函数

- **`handleCatCatchMessage(Message, sender, sendResponse)`** - 处理cat-catch风格的消息
- **`handleDetectResources(tab, sendResponse)`** - 检测资源并返回结果
- **`handleGetSettings(sendResponse)`** - 获取设置
- **`handleUpdateSettings(settings, sendResponse)`** - 更新设置

### 初始化函数

- **`initializeGlobalVariables()`** - 初始化全局变量
- **`handleFirstInstall()`** - 处理首次安装
- **`handleUpdate(previousVersion)`** - 处理更新
- **`initializeExtension()`** - 初始化扩展

---

## js/deep-search.js - 深度搜索脚本

### 核心搜索函数

- **`findMedia(data, depth)`** - 在数据中查找媒体资源
- **`postData(data)`** - 发送数据到background脚本
- **`toUrl(text, ext)`** - 转换为URL并发送数据

### 辅助检测函数

- **`isUrl(str)`** - 检查是否为有效URL
- **`getExtension(url)`** - 获取文件扩展名
- **`isJSON(str)`** - 检查是否为JSON
- **`getDataM3U8(dataUrl)`** - 从Data URL中提取M3U8内容

### URL处理函数

- **`extractBaseUrl(url)`** - 提取基础URL
- **`getBaseUrl(url)`** - 获取基础URL
- **`addBaseUrl(baseUrl, content)`** - 添加基础URL到相对路径
- **`isFullM3u8(text)`** - 检查是否为完整的M3U8
- **`TsProtocol(text)`** - 处理TS协议

### 特殊处理函数

- **`ArrayToBase64(data)`** - 数组转Base64
- **`vimeo(originalUrl, json)`** - 处理Vimeo视频

---

## js/sidebar.js - 侧边栏组件

### 核心组件函数

- **`DogCatchSidebar()`** - 侧边栏构造函数
- **`init()`** - 初始化侧边栏
- **`createSidebar()`** - 创建侧边栏DOM结构
- **`show()`** - 显示侧边栏
- **`hide()`** - 隐藏侧边栏
- **`toggle()`** - 切换侧边栏显示状态

### 资源管理函数

- **`refreshResources()`** - 刷新资源列表
- **`addResource(resource)`** - 添加资源
- **`mapResourceType(type)`** - 映射资源类型到常量
- **`clearResources()`** - 清空资源列表
- **`addMockResources()`** - 添加模拟资源（测试用）

### UI渲染函数

- **`renderResources()`** - 渲染资源列表
- **`createResourceCard(resource)`** - 创建资源卡片
- **`setLoading(isLoading)`** - 设置加载状态
- **`updateResourceCount()`** - 更新资源计数

### 事件处理函数

- **`bindEvents()`** - 绑定事件监听器
- **`handleResourceClick(resource)`** - 处理资源点击事件
- **`handleCloseClick()`** - 处理关闭按钮点击
- **`dispatchEvent(eventName, detail)`** - 派发自定义事件

### 数据持久化函数

- **`loadResources()`** - 加载保存的资源
- **`saveResources()`** - 保存资源到本地存储
- **`destroy()`** - 销毁侧边栏

---

## js/utils.js - 工具函数库

### DOM操作函数

- **`DOMUtils.createElement(tag, className, attributes)`** - 创建DOM元素
- **`DOMUtils.addClass(element, className)`** - 添加CSS类
- **`DOMUtils.removeClass(element, className)`** - 移除CSS类
- **`DOMUtils.toggleClass(element, className)`** - 切换CSS类
- **`DOMUtils.hasClass(element, className)`** - 检查是否有CSS类

### 动画工具函数

- **`AnimationUtils.fadeIn(element, duration, callback)`** - 淡入动画
- **`AnimationUtils.fadeOut(element, duration, callback)`** - 淡出动画
- **`AnimationUtils.slideIn(element, direction, duration, callback)`** - 滑入动画
- **`AnimationUtils.slideOut(element, direction, duration, callback)`** - 滑出动画

### 存储工具函数

- **`StorageUtils.get(key, defaultValue)`** - 获取存储数据
- **`StorageUtils.set(key, value)`** - 设置存储数据
- **`StorageUtils.remove(key)`** - 删除存储数据
- **`StorageUtils.clear()`** - 清空存储

### 格式化工具函数

- **`FormatUtils.formatFileSize(bytes)`** - 格式化文件大小
- **`FormatUtils.formatDuration(seconds)`** - 格式化时长
- **`FormatUtils.formatTimestamp(timestamp)`** - 格式化时间戳
- **`FormatUtils.getResourceIcon(type)`** - 获取资源类型图标

### 通用工具函数

- **`throttle(func, limit)`** - 节流函数
- **`debounce(func, delay)`** - 防抖函数
- **`generateId(prefix)`** - 生成唯一ID
- **`isValidUrl(url)`** - 验证URL有效性

---

## js/floating-ball.js - 悬浮球组件

### 核心组件函数

- **`DogCatchFloatingBall()`** - 悬浮球构造函数
- **`init()`** - 初始化悬浮球
- **`createBall()`** - 创建悬浮球DOM结构
- **`show()`** - 显示悬浮球
- **`hide()`** - 隐藏悬浮球

### 位置管理函数

- **`loadPosition()`** - 加载保存的位置
- **`savePosition()`** - 保存当前位置
- **`setPosition(x, y)`** - 设置悬浮球位置
- **`snapToEdge()`** - 磁性吸附到边缘

### 拖拽功能函数

- **`bindDragEvents()`** - 绑定拖拽事件
- **`handleDragStart(event)`** - 处理拖拽开始
- **`handleDragMove(event)`** - 处理拖拽移动
- **`handleDragEnd(event)`** - 处理拖拽结束

### 动画效果函数

- **`setIdleState()`** - 设置空闲状态动画
- **`removeIdleState()`** - 移除空闲状态动画
- **`showFoundResourceAnimation()`** - 显示发现资源动画
- **`showNewResourceAnimation()`** - 显示新资源动画

### 事件处理函数

- **`bindEvents()`** - 绑定事件监听器
- **`handleClick(event)`** - 处理点击事件
- **`handleMouseEnter()`** - 处理鼠标进入事件
- **`handleMouseLeave()`** - 处理鼠标离开事件
- **`destroy()`** - 销毁悬浮球

---

## content.js - 内容脚本

### 初始化函数

- **`initDogCatch()`** - 初始化Dog-Catch
- **`waitForUtils()`** - 等待工具函数加载
- **`injectDeepSearchScript()`** - 注入深度搜索脚本

### 事件处理函数

- **`bindGlobalEvents()`** - 绑定全局事件
- **`handleSidebarShow(event)`** - 处理侧边栏显示事件
- **`handleSidebarHide(event)`** - 处理侧边栏隐藏事件
- **`handleNewResource(event)`** - 处理新资源事件

### 页面监听函数

- **`observePageChanges()`** - 观察页面变化
- **`handleDOMChanges(mutations)`** - 处理DOM变化
- **`handleUrlChange()`** - 处理URL变化

### 工具函数

- **`throttle(func, limit)`** - 节流函数（简化版）
- **`cleanup()`** - 清理函数

---

## 📊 统计信息

- **总函数数量**: 80+
- **模块数量**: 6
- **核心功能模块**: 3 (background.js, deep-search.js, sidebar.js)
- **工具模块**: 2 (utils.js, floating-ball.js)
- **入口模块**: 1 (content.js)

---

## 🔄 更新记录

- **2025-08-08**: 创建函数索引，记录阶段2完成后的所有函数
- **版本**: v1.1.0
- **阶段**: 阶段2完成 - 核心技术移植与资源检测
