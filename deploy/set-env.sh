#!/bin/bash
# Bash script: Set environment variables for Dog Catch backend
# WARNING: This file contains secrets. Do NOT commit this file to Git.
# Usage: source ./deploy/set-env.sh

# --- Upstash Redis ---
export REDIS_URL="rediss://default:AWmSAAIncDEyNDkxYTJkMmIzMmU0ZmU4OWZjOTFlYzQ5NzlkZWEwNnAxMjcwMjY@summary-guinea-27026.upstash.io:6379/0"

# --- hCaptcha ---
export CAPTCHA_SITE_KEY="492e9548-748a-44ca-8c32-28961402fe44"
export CAPTCHA_SECRET_KEY="ES_593b0e3494e640719de0e3d8644e5483"

# --- SMTP (Gmail App Password) ---
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="465"
export SMTP_SECURE="true"
export SMTP_USER="wangcong95278@gmail.com"
export SMTP_PASS="wbmgkhtcajihyuhe"
export SMTP_FROM="Subtitle Dog <wangcong95278@gmail.com>"

# --- JWT Secret (auto-generate if not set or weak) ---
if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 16 ]; then
  export JWT_SECRET=$(openssl rand -base64 32)
  echo "Generated a strong JWT_SECRET for this session."
fi

echo "Environment variables have been set for the current shell session."
echo "REDIS_URL: set"
echo "CAPTCHA_SITE_KEY/SECRET_KEY: set"  
echo "SMTP: set"
echo "JWT_SECRET: set"

# Tips:
# - Start or restart backend with PM2 after setting envs:
#   pm2 start /opt/dog-catch/deploy/pm2-ecosystem.config.js --update-env
# - To persist env vars system-wide, add to ~/.bashrc or /etc/environment:
#   echo 'export REDIS_URL="rediss://default:AWmSAAI...@summary-guinea-27026.upstash.io:6379/0"' >> ~/.bashrc
#   echo 'export CAPTCHA_SITE_KEY="492e9548-748a-44ca-8c32-28961402fe44"' >> ~/.bashrc
#   echo 'export CAPTCHA_SECRET_KEY="ES_593b0e3494e640719de0e3d8644e5483"' >> ~/.bashrc
#   # etc...
#   source ~/.bashrc