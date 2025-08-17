# PowerShell script: Set environment variables for Dog Catch backend
# WARNING: This file contains secrets. Do NOT commit this file to Git.
# Run in PowerShell:  .\deploy\set-env.ps1

# --- Upstash Redis ---
$env:REDIS_URL = "rediss://default:AWmSAAIncDEyNDkxYTJkMmIzMmU0ZmU4OWZjOTFlYzQ5NzlkZWEwNnAxMjcwMjY@summary-guinea-27026.upstash.io:6379/0"

# --- hCaptcha ---
$env:CAPTCHA_SITE_KEY = "492e9548-748a-44ca-8c32-28961402fe44"
$env:CAPTCHA_SECRET_KEY = "ES_593b0e3494e640719de0e3d8644e5483"

# --- SMTP (Gmail App Password) ---
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_PORT = "465"
$env:SMTP_SECURE = "true"
$env:SMTP_USER = "dogcatch@gmail.com"
$env:SMTP_PASS = "wbmgkhtcajihyuhe"
$env:SMTP_FROM = "Subtitle Dog Backend <dogcatch@gmail.com>"

# --- JWT Secret (auto-generate if not set or weak) ---
if (-not $env:JWT_SECRET -or $env:JWT_SECRET.Length -lt 16) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env:JWT_SECRET = [Convert]::ToBase64String($bytes)
  Write-Host "Generated a strong JWT_SECRET for this session."
}

Write-Host "Environment variables have been set for the current PowerShell session."
Write-Host "REDIS_URL: set"
Write-Host "CAPTCHA_SITE_KEY/SECRET_KEY: set"
Write-Host "SMTP: set"
Write-Host "JWT_SECRET: set"

# Tips:
# - Start or restart backend with PM2 after setting envs:
#   pm2 start "d:\pythonproject\chrome-extent\dog-catch\deploy\pm2-ecosystem.config.js" --update-env
#   (On Linux server, use: pm2 start /opt/dog-catch/pm2-ecosystem.config.js --update-env)
# - To persist env vars system-wide, consider setting them outside of this repo (not recommended to store secrets in Git):
#   [Environment]::SetEnvironmentVariable("REDIS_URL", $env:REDIS_URL, "User")
#   [Environment]::SetEnvironmentVariable("CAPTCHA_SITE_KEY", $env:CAPTCHA_SITE_KEY, "User")
#   [Environment]::SetEnvironmentVariable("CAPTCHA_SECRET_KEY", $env:CAPTCHA_SECRET_KEY, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_HOST", $env:SMTP_HOST, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_PORT", $env:SMTP_PORT, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_SECURE", $env:SMTP_SECURE, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_USER", $env:SMTP_USER, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_PASS", $env:SMTP_PASS, "User")
#   [Environment]::SetEnvironmentVariable("SMTP_FROM", $env:SMTP_FROM, "User")
#   [Environment]::SetEnvironmentVariable("JWT_SECRET", $env:JWT_SECRET, "User")