@echo off
setlocal
chcp 65001 >nul
echo Starting backend...
echo ================================

REM ================================
REM Backend required environment variables
set "PORT=8000"
set "JWT_SECRET=ZgeykNcLIT_fgoM2oGwDq2sA569igUYqKwJYLx1Uw3_d0oAlUSVLM3kHJ5iGkdQT"
set "REDIS_URL=rediss://default:AWmSAAIncDEyNDkxYTJkMmIzMmU0ZmU4OWZjOTFlYzQ5NzlkZWEwNnAxMjcwMjY@summary-guinea-27026.upstash.io:6379/0"
set "CORS_ORIGINS=http://localhost:3000,http://localhost:3001"

REM CAPTCHA settings (use test pair for development)
set "CAPTCHA_PROVIDER=hcaptcha"
set "CAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001"
set "CAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000"
REM Optional: force CAPTCHA for all auth flows during testing (0/1)
set "CAPTCHA_REQUIRED=0"

REM Subtitle watermark settings
set "SUB_WATERMARK=on"
set "SUB_WM_DENSITY=med"
set "SUB_WM_SECRET=%JWT_SECRET%"
echo PORT=%PORT%
echo CORS_ORIGINS=%CORS_ORIGINS%

REM ================================
REM SOCKS5 proxy for this process (change port if needed)
set "SOCKS_PROXY=socks5://127.0.0.1:7890"
set "ALL_PROXY=%SOCKS_PROXY%"
set "NO_PROXY=localhost,127.0.0.1,::1"
echo SOCKS_PROXY=%SOCKS_PROXY%

REM ================================
REM SMTP settings for real email sending (edit accordingly)
REM Example for common SMTP providers. Keep quotes to avoid special char issues.
set "SMTP_HOST=smtp.gmail.com"
set "SMTP_PORT=465"
set "SMTP_SECURE=true"
set "SMTP_USER=wangcong95278@gmail.com"
set "SMTP_PASS=wbmgkhtcajihyuhe"
set "SMTP_FROM=Subtitle Dog <wangcong95278@gmail.com>"
echo SMTP configured for %SMTP_HOST%:%SMTP_PORT%

REM Change directory to backend
cd /d "%~dp0backend"

REM Start dev server (nodemon)
npm run dev

endlocal

