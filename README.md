# M3U8视频播放器 + 字幕管理系统

一个为 missav.live 等站点定制的视频播放器与字幕管理系统。包含静态播放器、后端 API（Express + SQLite）与管理员后台（Vue3 + Element Plus）。

## 🎯 项目特性

- 智能嗅探（油猴脚本）跳转至自建播放器
- 多清晰度播放（支持 Master Playlist）
- 自动字幕加载（编号变体管理、去重存储、ASS/SSA→VTT 转码、统一 UTF-8）
- 管理后台：上传/更新/批量删除/预览/统计/导出
- 用户系统（邮箱验证码注册/登录/重置、登录校验）
- 字幕访问鉴权与健壮性：
  - 前端启动先校验 token；401 自动登出与禁用字幕
  - 退出/注销立即移除字幕轨道（无需刷新）
  - 支持 sessionStorage “记住我”策略（优先读 sessionStorage，回落 localStorage）
- 前端播放器 UI 优化：
  - 移除“复制链接”按钮
  - 统一使用非阻塞 Toast 提示（无确认按钮）

## 📁 项目结构

```
dog-catch/
├── userscript/                      # 油猴脚本
│   └── dog-catch-mobile.user.js
├── frontend/
│   └── public/                      # 播放器静态站点
│       ├── index.html               # 播放器页面（已移除复制按钮与消息条）
│       ├── styles.css
│       ├── player.js                # 播放器逻辑（鉴权、字幕、Toast）
│       ├── config.js                # 前端配置（API_BASE_URL 等）
│       └── serve.json
├── backend/
│   ├── src/server.js                # Express 服务（字幕与用户 API、HLS 代理）
│   ├── uploads/                     # 字幕存储目录
│   └── database/                    # SQLite 数据
├── admin/                           # 管理后台（Vue3 + Vite）
│   ├── src/
│   │   ├── views/                   # Dashboard、Login、UserManagement
│   │   ├── components/              # UploadDialog/BatchUpload/Preview
│   │   ├── router/
│   │   └── utils/                   # api.js、userAdminApi.js
│   └── vite.config.js
├── subtitlescript/                  # 字幕下载脚本
│   ├── download-subtitle.py         # 主下载脚本（支持单次和批量下载）
│   ├── csv_utils.py                 # CSV数据处理模块
│   ├── batch_downloader.py          # 批量下载编排模块
│   ├── requirements.txt             # Python依赖
│   └── output/                      # 下载输出目录
├── start-backend.bat                # 启动后端（Windows）
├── start-frontend.bat               # 启动播放器静态站点（Windows）
├── start-admin.bat                  # 启动管理后台（Windows）
└── README.md
```

## 🚀 快速开始

### 1) 安装依赖

```bash
# 后端
cd backend && npm install

# 管理后台
cd ../admin && npm install
```

### 2) 配置环境变量（重要）

后端（建议在 PowerShell 设置临时变量，或持久化 setx）：

```powershell
# 生成随机密钥并设置（示例）
$bytes = New-Object byte[] 48; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $secret=[Convert]::ToBase64String($bytes)
$env:JWT_SECRET = $secret

# 可选：SMTP（发送邮箱验证码）
$env:SMTP_HOST = 'smtp.example.com'
$env:SMTP_PORT = '465'
$env:SMTP_SECURE = 'true'
$env:SMTP_USER = 'no-reply@example.com'
$env:SMTP_PASS = 'your-smtp-pass'
$env:SMTP_FROM = 'Subtitle Dog <no-reply@example.com>'
```

注意：更换 JWT_SECRET 会使旧 token 全部失效，需要重新登录。

### 3) 启动服务

- 后端（开发）
```bash
cd backend
npm run dev
# 或 npm start
```
默认地址：`http://localhost:8000`

- 播放器（静态站点）
```bash
cd frontend/public
# 推荐固定 serve 版本并禁用更新检查，减少噪声：
set NO_UPDATE_NOTIFIER=1 && npx --yes serve@14.2.0 . -p 3000 --no-clipboard
```
默认地址：`http://localhost:3000`

- 管理后台（开发）
```bash
cd admin
npm run dev
```
默认地址：`http://localhost:3001`

## 📥 字幕下载脚本

字幕下载脚本位于 `subtitlescript/` 目录，支持单次下载和批量下载功能。

### 安装依赖

```bash
cd subtitlescript
pip install -r requirements.txt
```

### 使用方法

#### 1. 单次下载
```bash
python download-subtitle.py
```
运行后会启动浏览器，手动搜索并下载字幕。

#### 2. 从CSV文件批量下载
```bash
python download-subtitle.py --csv <CSV文件路径> [选项]
```
示例：
```bash
# 基本用法
python download-subtitle.py --csv test_videos.csv

# 指定视频类型筛选
python download-subtitle.py --csv test_videos.csv --type "SSIS"

# 设置下载间隔和最大数量
python download-subtitle.py --csv test_videos.csv --interval 3.0 --max 10

# 组合使用
python download-subtitle.py --csv test_videos.csv --type "SSIS" --interval 1.5 --max 5
```

#### 3. 从视频编号列表批量下载
```bash
python download-subtitle.py --codes <编号列表> [选项]
```
示例：
```bash
# 基本用法
python download-subtitle.py --codes "SSIS-001,MIDV-002,STARS-003"

# 设置下载间隔
python download-subtitle.py --codes "SSIS-001,SSIS-002" --interval 1.5

# 设置最大下载数量
python download-subtitle.py --codes "SSIS-001,MIDV-002,STARS-003" --max 2

# 组合使用
python download-subtitle.py --codes "SSIS-001,SSIS-002,SSIS-003" --interval 2.5 --max 3
```

### 参数说明

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `--csv` | 字符串 | CSV文件路径，用于批量下载 | - |
| `--codes` | 字符串 | 逗号分隔的视频编号列表 | - |
| `--type` | 字符串 | 视频类型筛选（仅CSV模式有效） | - |
| `--max` | 整数 | 最大下载数量限制 | 无限制 |
| `--interval` | 浮点数 | 下载间隔时间（秒） | 2.0 |
| `-h, --help` | - | 显示帮助信息 | - |

### CSV文件格式要求
- 必须包含 `video_title` 和 `video_type` 列
- `video_title` 列包含视频标题或编号
- `video_type` 列包含视频类型（用于筛选）

### 注意事项
- `--csv` 和 `--codes` 参数互斥，不能同时使用
- `--type` 参数仅在使用 `--csv` 时有效
- 下载间隔建议设置为1.0秒以上，避免请求过于频繁
- 使用 `--help` 可查看完整的帮助信息和使用示例

## ⚙️ 配置说明

### 前端播放器（`frontend/public/config.js`）

```js
window.PLAYER_CONFIG = {
  API_BASE_URL: 'http://localhost:8000',
  SUBTITLE_NEED_LOGIN: true,      // 需要登录才能加载字幕
  ALLOW_PLAY_WITHOUT_LOGIN: true  // 视频本身不强制登录
}
```

URL 参数：`src`（视频源）、`type`（hls/mp4/auto）、`title`、`referer`、`video`（视频编号，用于字幕匹配）。

### 后端（`backend/src/server.js`）

- 端口：`PORT`（默认 8000）
- JWT：`JWT_SECRET`（生产务必设置强随机值）
- 邮件：`SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS/SMTP_FROM`（可选）
- 静态：`/uploads` 提供字幕文件

数据库（SQLite）：
- `subtitles`：`video_id` 唯一、`content_hash` 去重、`base_video_id` + `variant` 变体管理、`original_filename`
- `admins`：默认创建 `admin/admin123`（上线前请修改）
- `users`：用户系统（邮箱注册/登录）
- `email_verification_codes`：验证码记录与限频

鉴权：
- 管理端：`/api/auth/login` → Bearer（admin）
- 用户端：邮箱+密码登录；启动时 `GET /api/user/verify` 校验；后端会校验用户存在与 `active` 状态

## 🔌 API 摘要（常用）

- 用户
  - `POST /api/user/email-code`（purpose: register/reset）
  - `POST /api/user/register`
  - `POST /api/user/login/password`
  - `POST /api/user/password/reset-confirm`
  - `GET /api/user/verify`（用户登录校验）
  - `POST /api/user/exist`（账号存在性检查）
  - `DELETE /api/user/me`（自助注销）

- 字幕（用户或管理员登录可见）
  - `GET /api/subtitle/:video_id`（返回 UTF-8 文本；若源为 ASS/SSA，上传时已转 VTT）
  - `GET /api/subtitles/variants/:base_video_id`（获取基础编号下的字幕变体）

- 管理字幕（管理员）
  - `GET /api/subtitles?page&limit&search`
  - `POST /api/subtitle/:video_id`（上传，ASS/SSA→VTT，去重）
  - `PUT /api/subtitle/:video_id`（更新，去重）
  - `DELETE /api/subtitle/:video_id`（删除）
  - `DELETE /api/subtitles`（批量删除）
  - `GET /api/subtitles/stats`（统计）

- 管理用户（管理员）
  - `GET /api/admin/users/stats`
  - `GET /api/admin/users?page&limit&search`
  - `DELETE /api/admin/users/:id`

- 其他
  - `GET /health`（健康检查）
  - `GET /api/hls?url=...`（HLS 代理；本项目不对 m3u8/分片做保护）

## 🖥️ 前端播放器行为要点

- 启动即校验用户 token；失败自动登出，禁用字幕 UI，提示 Toast
- 成功登录后：
  - 拉取字幕变体，填充并启用选择框
  - 拉取字幕文本后启用“字幕开关”按钮
- 退出登录/注销账号：
  - 立即移除所有字幕轨道、撤销 Blob URL、清空状态，无需刷新页面
- 提示改为非阻塞 Toast（右上角自动消失，无确认按钮）
- 已移除“复制链接”按钮与页面消息条

## 🔐 字幕保护范围（项目边界）

- 仅保护“字幕加载”和“防止大量爬取字幕文件”
- 不保护 m3u8/视频流代理

建议（后续可选）：
- 对 `GET /api/subtitle/:video_id`、`GET /api/subtitles/variants/:base` 增加用户/IP 限流
- 服务端统一返回 VTT 并注入轻量水印（不可见字符/NOTE 注释）以便追责

## 🧰 常见问题（Troubleshooting）

- 前端静态站点启动出现
  - `WARN Checking for updates failed / ERROR Cannot read properties of undefined (reading 'code')`
    - 来源于 `serve` 的更新检查，使用 `set NO_UPDATE_NOTIFIER=1` 并固定版本 `serve@14.2.0`

- 拖动进度条后不加载
  - 强制刷新缓存（Ctrl+F5）；确保 Toast 容器不拦截事件（已设置 pointer-events:none）
  - 检查 Network 是否有分片/playlist 请求，若通过 `/api/hls`，留意上游 `ECONNRESET/ETIMEDOUT`

- 如何查看/清理 token
  - Console: `localStorage.getItem('user_token')` / `sessionStorage.getItem('user_token')`
  - 清理：`localStorage.removeItem('user_token'); sessionStorage.removeItem('user_token')`

- 后端日志 `代理请求错误: read ECONNRESET`
  - 上游断开或网络抖动；与本项目字幕保护无关

## 📦 近期变更（Changelog）

- 前端播放器
  - 启动校验 token；401 自动登出
  - 退出/注销即时移除字幕轨道与状态
  - 启用字幕选择下拉（构建后自动解禁）
  - 移除“复制链接”按钮；消息改 Toast（无确认按钮）

- 后端
  - 用户鉴权增加“用户存在且 active”校验
  - 保持 HLS 代理现状（不纳入保护范围）

## 🛡️ 生产建议

- 必须设置强随机 `JWT_SECRET`
- 上线前修改默认管理员密码
- 数据库与 `uploads/` 做备份与权限控制
- 仅在可信环境开放 CORS（如需要）

## 📄 许可证

MIT