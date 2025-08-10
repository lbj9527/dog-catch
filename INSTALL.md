# Dog-Catch 安装指南

## 🚀 快速安装

### 第一步：生成图标文件

由于Git无法直接包含PNG图标文件，您需要先生成图标：

1. **使用简单图标生成器（推荐）**：
   - 在浏览器中打开 `create-simple-icons.html`
   - 页面会自动下载4个图标文件：`icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
   - 将下载的文件放入项目的 `icons/` 目录中

2. **或使用高级图标生成器**：
   - 在浏览器中打开 `generate-icons.html`
   - 点击"下载所有图标"按钮
   - 将下载的文件放入项目的 `icons/` 目录中

### 第二步：加载Chrome扩展

1. 打开Chrome浏览器
2. 在地址栏输入 `chrome://extensions/`
3. 在右上角启用"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `dog-catch` 项目目录
6. 扩展加载成功后，您会在浏览器工具栏看到Dog-Catch图标

### 第三步：验证安装

1. 点击浏览器工具栏中的Dog-Catch图标
2. 应该会弹出扩展界面，显示：
   - 标题栏：Dog-Catch 🐾
   - 工具栏：搜索框、深度搜索按钮、刷新按钮
   - 筛选器：全部、视频、音频、图片、文档
   - 内容区域：显示"正在检测媒体资源..."或模拟数据
   - 统计信息：资源数量、总大小、最后更新时间

## 📁 项目结构

```
dog-catch/
├── manifest.json              # Chrome扩展配置文件
├── popup.html                 # 主界面HTML
├── create-simple-icons.html   # 简单图标生成器
├── generate-icons.html        # 高级图标生成器
├── INSTALL.md                 # 本安装指南
├── README.md                  # 项目文档
├── css/
│   ├── base.css              # 基础样式
│   └── components.css        # 组件样式
├── js/
│   ├── background.js         # Service Worker后台服务
│   ├── content-script.js     # Content Script注入脚本
│   └── popup.js              # 主界面逻辑
└── icons/                    # 图标目录（需要手动生成）
    ├── icon-16.png          # 16x16图标
    ├── icon-32.png          # 32x32图标
    ├── icon-48.png          # 48x48图标
    ├── icon-128.png         # 128x128图标
    └── icon.svg             # SVG源文件
```

## 🔧 故障排除

### 问题1：图标加载错误
**错误信息**: `Could not load icon 'icons/icon-16.png' specified in 'icons'.`

**解决方案**:
1. 确保已按照第一步生成了所有图标文件
2. 检查 `icons/` 目录中是否包含所有4个PNG文件
3. 重新加载扩展

### 问题2：manifest.json加载失败
**错误信息**: `Could not load manifest.`

**解决方案**:
1. 检查manifest.json文件格式是否正确
2. 确保所有引用的文件都存在
3. 检查Chrome版本是否支持Manifest V3（需要Chrome 88+）

### 问题3：扩展功能不工作
**解决方案**:
1. 打开Chrome开发者工具（F12）
2. 查看Console标签页是否有错误信息
3. 检查扩展是否有必要的权限
4. 尝试重新加载扩展

## 📝 开发状态

当前版本：v0.1.0-dev

已完成功能：
- ✅ 基础架构设计
- ✅ 界面层开发
- ✅ Service Worker后台服务
- ✅ Content Script注入框架
- ✅ 主界面和组件

待开发功能：
- ⏳ 自动嗅探功能
- ⏳ 深度搜索功能
- ⏳ Video.js媒体预览
- ⏳ 完整的资源检测逻辑

## 🆘 获取帮助

如果您在安装过程中遇到问题，请：
1. 检查Chrome版本（需要88+）
2. 确保开发者模式已启用
3. 按照本指南重新操作
4. 查看Chrome扩展管理页面的错误信息
