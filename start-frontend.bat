@echo off
setlocal
echo 启动前端播放器...
echo ================================

REM 切换到项目根目录下的 frontend\public 目录
cd /d "%~dp0frontend\public"

REM 使用 serve 启动静态服务器，自动确认并关闭剪贴板复制
npx --yes serve . -p 3000 --no-clipboard  --debug

endlocal

