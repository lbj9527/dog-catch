@echo off
setlocal
echo 启动后端服务...
echo ================================

REM 切换到项目根目录下的 backend 目录（/d 允许切换盘符）
cd /d "%~dp0backend"

REM 启动开发模式（nodemon 自动重启）
npm run dev

endlocal

