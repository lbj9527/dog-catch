# 前端配置文件说明

## 文件结构

- `config.js` - 原始配置文件（保持不变，用作备用）
- `config.production.js` - 生产环境配置（API_BASE_URL: 'https://api.sub-dog.top'）
- `config.local.js` - 本地开发配置（API_BASE_URL: 'http://localhost:8000'）

## 使用方法

### 本地开发

#### 方法一：使用一键启动脚本（推荐）

直接运行本地开发脚本，会自动使用 `config.local.js` 配置：
```powershell
.\local-deploy\dev.ps1 start-all
# 或者只启动前端
.\local-deploy\dev.ps1 start-frontend
```

脚本会自动：
- 检查 `config.local.js` 是否存在
- 自动复制 `config.local.js` 为 `config.js`
- 启动开发服务器

#### 方法二：手动切换配置

1. 将 `config.local.js` 重命名为 `config.js`（或直接修改 `config.js` 为本地配置）
2. 启动本地开发服务器

### 生产部署

部署脚本 `deploy/redeploy.sh` 会自动：
1. 使用 `config.production.js` 作为生产环境的 `config.js`
2. 复制到 `frontend-dist/config.js`

### 快速切换配置

```bash
# 切换到本地开发配置
cp frontend/public/config.local.js frontend/public/config.js

# 切换到生产配置（用于本地测试生产配置）
cp frontend/public/config.production.js frontend/public/config.js
```

## 注意事项

- 不要直接修改 `config.production.js` 和 `config.local.js`，除非需要更改对应环境的配置
- 部署时无需手动修改配置，脚本会自动处理
- 如果需要添加新的配置项，请同时更新两个环境配置文件