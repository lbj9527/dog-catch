@echo off
setlocal
echo 启动管理后台...
echo ================================

REM 切换到项目根目录下的 admin 目录
cd /d "%~dp0admin"

REM 从 .env.development 读取端口（VITE_DEV_PORT）或使用默认 3001
REM 说明：Vite 会自动读取 .env.*，端口由 vite.config.js 中的环境变量决定
npm run dev

endlocal

