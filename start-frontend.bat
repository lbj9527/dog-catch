@echo off
setlocal
chcp 65001 >nul
echo 启动前端播放器...
echo ================================

REM 配置后端 API 基地址（供播放器使用）
if "%API_BASE_URL%"=="" set "API_BASE_URL=http://localhost:8000"
echo 使用的 API_BASE_URL=%API_BASE_URL%

REM 可选：配置 hCaptcha 站点 key（仅前端使用）
if "%CAPTCHA_SITE_KEY%"=="" set "CAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001"
echo 使用的 CAPTCHA_SITE_KEY=%CAPTCHA_SITE_KEY%

REM 切换到项目根目录下的 frontend\public 目录
cd /d "%~dp0frontend\public"

REM 直接使用 config.js 中的静态配置，不再动态注入

REM 使用 serve 启动静态服务器，自动确认并关闭剪贴板复制
set NO_UPDATE_NOTIFIER=1
npx --yes serve@14.2.0 . -p 3000 --no-clipboard

endlocal

