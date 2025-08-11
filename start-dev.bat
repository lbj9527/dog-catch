@echo off
echo 启动 M3U8 视频播放器开发环境
echo ================================

echo.
echo [1/3] 启动后端服务...
start "后端服务" cmd /k "cd backend && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/3] 启动前端播放器...
start "前端播放器" cmd /k "cd frontend/public && python -m http.server 3000"

timeout /t 3 /nobreak >nul

echo [3/3] 启动管理后台...
start "管理后台" cmd /k "cd admin && npm run dev"

echo.
echo 开发环境启动完成！
echo ================================
echo 后端API: http://localhost:8000
echo 前端播放器: http://localhost:3000
echo 管理后台: http://localhost:3001
echo ================================
echo 按任意键退出...
pause >nul 