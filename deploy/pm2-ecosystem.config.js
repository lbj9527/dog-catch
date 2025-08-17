module.exports = {
  apps: [
    {
      name: 'dog-catch-backend',
      script: 'src/server.js',
      cwd: '/opt/dog-catch/backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 8000,
        JWT_SECRET: process.env.JWT_SECRET || 'CHANGE_ME',
        CORS_ORIGINS: 'https://player.sub-dog.top,https://admin.sub-dog.top',
        // ===== Required runtime configs (read from environment; placeholders as fallback) =====
        // Redis (Upstash)
        REDIS_URL: process.env.REDIS_URL || 'CHANGE_ME',
        // Captcha (hCaptcha)
        CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER || 'hcaptcha',
        CAPTCHA_SITE_KEY: process.env.CAPTCHA_SITE_KEY || 'CHANGE_ME',
        CAPTCHA_SECRET_KEY: process.env.CAPTCHA_SECRET_KEY || 'CHANGE_ME',
        // SMTP for email verification
        SMTP_HOST: process.env.SMTP_HOST || 'CHANGE_ME',
        SMTP_PORT: process.env.SMTP_PORT || 'CHANGE_ME',
        SMTP_SECURE: process.env.SMTP_SECURE || 'CHANGE_ME',
        SMTP_USER: process.env.SMTP_USER || 'CHANGE_ME',
        SMTP_PASS: process.env.SMTP_PASS || 'CHANGE_ME',
        SMTP_FROM: process.env.SMTP_FROM || 'CHANGE_ME',
        // Email rate limiting knobs (non-sensitive defaults)
        EMAIL_CODE_MIN_INTERVAL_SEC: process.env.EMAIL_CODE_MIN_INTERVAL_SEC || 30,
        EMAIL_CODE_IP_MIN_INTERVAL_SEC: process.env.EMAIL_CODE_IP_MIN_INTERVAL_SEC || 5
      },
      out_file: '/var/log/pm2/dog-catch-backend-out.log',
      error_file: '/var/log/pm2/dog-catch-backend-error.log',
      max_memory_restart: '300M',
      watch: false
    }
  ]
};