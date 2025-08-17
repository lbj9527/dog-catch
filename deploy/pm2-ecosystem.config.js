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
        JWT_SECRET: 'PLEASE_SET_A_SECURE_SECRET',
        CORS_ORIGINS: 'https://player.sub-dog.top,https://admin.sub-dog.top'
      },
      out_file: '/var/log/pm2/dog-catch-backend-out.log',
      error_file: '/var/log/pm2/dog-catch-backend-error.log',
      max_memory_restart: '300M',
      watch: false
    }
  ]
};