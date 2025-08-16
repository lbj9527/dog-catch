@echo off
setlocal
echo 启动管理后台...
echo ================================

REM 设置后端 API 地址（Vite 会读取以 VITE_ 开头的环境变量）
if "%VITE_API_BASE_URL%"=="" set "VITE_API_BASE_URL=http://localhost:8000"
echo 使用的 VITE_API_BASE_URL=%VITE_API_BASE_URL%

REM 切换到项目根目录下的 admin 目录
cd /d "%~dp0admin"

REM 启动开发服务器并指定端口 3001（与 CORS 配置一致）
npm run dev -- --port 3001

endlocal

