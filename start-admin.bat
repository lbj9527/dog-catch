@echo off
setlocal
echo 启动管理后台...
echo ================================

REM 切换到项目根目录下的 admin 目录
cd /d "%~dp0admin"

REM 启动 Vite 开发服务器并固定端口为 3001（通过 -- 传参给 vite）
npm run dev -- --port 3001

endlocal

