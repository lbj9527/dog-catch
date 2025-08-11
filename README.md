# M3U8视频播放器 + 字幕管理系统

一个专为 missav.live 网站设计的视频播放器系统，支持自动字幕加载和管理。

## 🎯 项目特性

- **智能资源嗅探**：油猴脚本自动检测页面中的视频资源
- **多清晰度播放**：支持 Master Playlist 解析和清晰度选择
- **自动字幕加载**：根据视频编号自动加载对应字幕
- **字幕管理后台**：完整的字幕文件管理系统
- **响应式设计**：适配PC和移动端设备

## 📁 项目结构

```
project-root/
├── userscript/                 # 油猴脚本
│   └── dog-catch-mobile.user.js    # 修改后的嗅探脚本
├── frontend/                   # 前端播放器
│   └── public/                 # 静态文件
│       ├── index.html          # 播放器页面
│       ├── styles.css          # 样式文件
│       └── player.js           # 播放器逻辑
├── backend/                    # 后端API服务
│   ├── src/
│   │   └── server.js           # Express服务器
│   ├── package.json            # 依赖配置
│   ├── uploads/                # 字幕文件存储
│   └── database/               # SQLite数据库
├── admin/                      # 后台管理系统
│   ├── src/
│   │   ├── components/         # Vue组件
│   │   ├── views/              # 页面组件
│   │   ├── router/             # 路由配置
│   │   └── utils/              # 工具函数
│   ├── package.json            # 前端依赖
│   └── vite.config.js          # Vite配置
└── docs/                       # 项目文档
    └── 项目需求文档.md          # 详细需求文档
```

## 🚀 快速开始

### 1. 安装依赖

```bash
# 后端依赖
cd backend
npm install

# 管理后台依赖
cd ../admin  
npm install
```

### 2. 启动后端服务

```bash
cd backend
npm run dev
# 或
npm start
```

服务启动后访问：
- API地址：http://localhost:8000
- 健康检查：http://localhost:8000/health
- 默认管理员账号：`admin` / `admin123`

### 3. 部署前端播放器

前端是纯静态文件，可以：

**本地测试：**
```bash
cd frontend/public
# 使用任何HTTP服务器，例如：
python -m http.server 3000
# 或
npx serve . -p 3000
```

**生产部署：**
- 上传到静态托管服务（Vercel、Netlify等）
- 或部署到CDN

### 4. 启动后台管理系统

```bash
cd admin
npm install
npm run dev
```

管理系统启动后访问：
- 管理后台：http://localhost:3001
- 默认账号：`admin` / `admin123`

### 5. 安装油猴脚本

1. 确保浏览器已安装 Tampermonkey 扩展
2. 打开 `userscript/dog-catch-mobile.user.js`
3. 修改第65行的域名为你的实际域名：
   ```javascript
   const url = `https://your-domain.com/player?${...}`;
   ```
4. 在 Tampermonkey 中创建新脚本，粘贴代码并保存

## ⚙️ 配置说明

### 后端配置

在 `backend/src/server.js` 中可以配置：

```javascript
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
```

环境变量：
- `PORT`：服务端口号
- `JWT_SECRET`：JWT密钥（生产环境必须修改）

### 前端配置

在 `frontend/public/player.js` 中修改API地址：

```javascript
// 第264行附近，修改为实际的API地址
const response = await fetch(`https://api.your-domain.com/api/subtitle/${this.currentVideoId}`);
```

## 🎛️ 后台管理系统功能

### 主要功能
- **字幕管理**：查看所有视频的字幕状态，支持分页和搜索
- **文件上传**：单个字幕文件上传，支持 .srt 和 .vtt 格式
- **批量上传**：同时上传多个字幕文件，自动识别视频编号
- **字幕预览**：在线预览字幕内容，支持格式化显示
- **数据统计**：显示总视频数、已有字幕数、缺失字幕数和完成度
- **数据导出**：导出字幕列表为 CSV 格式

### 操作说明
1. **登录系统**：使用默认账号 `admin` / `admin123` 登录
2. **查看列表**：主界面显示所有视频的字幕状态
3. **上传字幕**：点击"上传字幕"按钮，输入视频编号并选择文件
4. **批量上传**：点击"批量上传"，选择多个字幕文件自动批量处理
5. **更新字幕**：对已有字幕点击"更新"按钮替换文件
6. **预览字幕**：点击"预览"按钮查看字幕内容
7. **搜索筛选**：使用搜索框快速找到特定视频编号

## 📡 API接口

### 公开接口
- `GET /api/subtitle/:video_id` - 获取字幕文件

### 认证接口
- `POST /api/auth/login` - 管理员登录
- `GET /api/auth/verify` - 验证token

### 管理接口（需要认证）
- `GET /api/subtitles` - 获取字幕列表
- `POST /api/subtitle/:video_id` - 上传字幕
- `PUT /api/subtitle/:video_id` - 更新字幕
- `DELETE /api/subtitle/:video_id` - 删除字幕

## 🔧 开发说明

### 当前开发进度

✅ **已完成：**
- [x] 油猴脚本修改（跳转到自建播放器）
- [x] 前端播放器（Video.js + 清晰度选择 + 字幕显示）
- [x] 后端API服务（字幕管理 + 用户认证）
- [x] 后台管理界面（Vue.js + Element Plus）
- [x] 批量字幕管理功能
- [x] 搜索和筛选功能
- [x] 项目基础结构

📋 **待开发：**
- [ ] 生产环境部署配置
- [ ] 性能优化和错误处理
- [ ] 更多字幕格式支持

### Git 配置

项目已配置完整的 `.gitignore` 和 `.gitattributes` 文件：

- **`.gitignore`**: 忽略 `node_modules`、构建输出、数据库文件、上传文件等
- **`.gitattributes`**: 统一行尾符，正确识别文件类型
- **目录保持**: 使用 `.gitkeep` 文件保持重要的空目录结构

### 本地开发

1. **后端开发**：
   ```bash
   cd backend
   npm run dev  # 使用nodemon自动重启
   ```

2. **前端开发**：
   - 直接修改 `frontend/public/` 下的文件
   - 使用本地HTTP服务器测试

3. **后台管理开发**：
   ```bash
   cd admin
   npm run dev  # 使用Vite热重载
   ```

4. **调试脚本**：
   - 修改油猴脚本中的域名指向本地服务
   - 在浏览器控制台查看日志

## 🌐 部署建议

### 生产环境

1. **前端**：部署到 Vercel/Netlify
2. **后端**：部署到 Railway/Heroku/VPS
3. **域名**：配置自定义域名和HTTPS证书

### 环境变量

生产环境需要设置的环境变量：
```bash
PORT=8000
JWT_SECRET=your-super-secret-key-here
NODE_ENV=production
```

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

MIT License

## 🆘 问题反馈

如有问题，请创建 Issue 或联系开发者。

---

**注意**：
- 生产环境使用前请修改默认的管理员密码和JWT密钥
- 确保字幕文件存储目录有适当的读写权限
- 建议定期备份数据库文件 