#!/bin/bash
# 一键重新部署脚本 - Dog Catch 项目
# 用于修改前后端代码后，快速重新上线
# 使用方法：在服务器上执行 bash /opt/dog-catch/deploy/redeploy.sh

set -e  # 遇到错误立即退出

PROJECT_ROOT="/opt/dog-catch"
DEPLOY_DIR="$PROJECT_ROOT/deploy"

echo "=========================================="
echo "  Dog Catch 项目一键重新部署"
echo "  开始时间: $(date)"
echo "=========================================="

# 1. 检查项目目录
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ 错误: 项目目录 $PROJECT_ROOT 不存在"
    exit 1
fi

cd "$PROJECT_ROOT"

# 2. 拉取最新代码
echo "📥 拉取最新代码..."
git fetch origin
git reset --hard origin/main
echo "✅ 代码更新完成"

# 3. 后端依赖更新与检查
echo "🔧 检查后端依赖..."
cd "$PROJECT_ROOT/backend"
if [ -f package-lock.json ]; then
    npm ci --production
else
    npm install --production
fi
# 修复安全漏洞
echo "🔒 修复后端安全漏洞..."
npm audit fix
echo "✅ 后端依赖更新完成"

# 4. 管理后台构建
echo "🏗️  构建管理后台..."
cd "$PROJECT_ROOT/admin"
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi
# 修复安全漏洞
echo "🔒 修复管理后台安全漏洞..."
npm audit fix --force
npm run build
echo "✅ 管理后台构建完成"

# 5. 构建前台并同步静态文件
echo "🏗️  构建前台播放器..."
cd "$PROJECT_ROOT/frontend"
if [ -f package-lock.json ]; then
    npm ci
else
    npm install
fi
# 修复安全漏洞
echo "🔒 修复前端安全漏洞..."
npm audit fix --force
npm run build

echo "📁 同步前台构建产物..."
sudo rsync -av --delete "$PROJECT_ROOT/frontend/dist/" "$PROJECT_ROOT/frontend-dist/"

# 使用生产环境配置文件（必须在rsync之后执行，避免被--delete删除）
echo "🔧 配置生产环境配置文件..."
if [ -f "$PROJECT_ROOT/frontend/public/config.production.js" ]; then
    echo "✅ 使用 config.production.js 作为生产配置"
    sudo cp -f "$PROJECT_ROOT/frontend/public/config.production.js" "$PROJECT_ROOT/frontend-dist/config.js"
else
    echo "⚠️  警告: 生产配置文件 config.production.js 不存在，使用默认 config.js"
    if [ -f "$PROJECT_ROOT/frontend/public/config.js" ]; then
        sudo cp -f "$PROJECT_ROOT/frontend/public/config.js" "$PROJECT_ROOT/frontend-dist/config.js"
    fi
fi
# 管理后台 (admin/dist -> admin-dist)
sudo rsync -av --delete "$PROJECT_ROOT/admin/dist/" "$PROJECT_ROOT/admin-dist/"
echo "✅ 静态文件同步完成"

# 6. 加载环境变量
echo "🔑 加载环境变量..."
if [ -f "$DEPLOY_DIR/set-env.sh" ]; then
    source "$DEPLOY_DIR/set-env.sh"
    echo "✅ 环境变量加载完成"
else
    echo "⚠️  警告: 环境变量文件 $DEPLOY_DIR/set-env.sh 不存在"
    echo "   请确保已手动设置所需的环境变量"
fi

# 7. 更新 PM2 配置
echo "⚙️  更新 PM2 配置..."
sudo cp -f "$DEPLOY_DIR/pm2-ecosystem.config.js" "$PROJECT_ROOT/pm2-ecosystem.config.js"

# 8. 重启后端服务
echo "🔄 重启后端服务..."
if pm2 describe dog-catch-backend > /dev/null 2>&1; then
    # 服务已存在，重启并更新环境变量
    pm2 restart dog-catch-backend --update-env
    echo "✅ 后端服务重启完成"
else
    # 服务不存在，首次启动
    pm2 start "$PROJECT_ROOT/pm2-ecosystem.config.js"
    echo "✅ 后端服务启动完成"
fi

# 9. 保存 PM2 配置
pm2 save
echo "✅ PM2 配置已保存"

# 10. 更新 Nginx 配置（如有变化）
echo "🌐 检查 Nginx 配置..."
if ! cmp -s "$DEPLOY_DIR/nginx-sites.conf" "/etc/nginx/sites-available/sub-dog.top" 2>/dev/null; then
    echo "📝 更新 Nginx 配置..."
    sudo cp -f "$DEPLOY_DIR/nginx-sites.conf" "/etc/nginx/sites-available/sub-dog.top"
    sudo ln -sf "/etc/nginx/sites-available/sub-dog.top" "/etc/nginx/sites-enabled/sub-dog.top"
    
    # 测试配置并重载
    if sudo nginx -t; then
        sudo systemctl reload nginx
        echo "✅ Nginx 配置更新并重载完成"
    else
        echo "❌ Nginx 配置测试失败，请检查配置文件"
        exit 1
    fi
else
    echo "✅ Nginx 配置无变化，跳过更新"
fi

# 11. 服务状态检查
echo "🔍 检查服务状态..."
echo "PM2 进程状态:"
pm2 status
echo ""
echo "Nginx 状态:"
sudo systemctl status nginx --no-pager -l

# 12. 健康检查
echo "🏥 执行健康检查..."
sleep 3  # 等待服务启动

# 检查后端 API
if curl -s -o /dev/null -w "%{http_code}" https://api.sub-dog.top/health | grep -q "200"; then
    echo "✅ 后端 API 健康检查通过"
else
    echo "⚠️  后端 API 健康检查失败，请查看日志: pm2 logs dog-catch-backend"
fi

# 检查前台
if curl -s -o /dev/null -w "%{http_code}" https://player.sub-dog.top | grep -q "200"; then
    echo "✅ 前台站点健康检查通过"
else
    echo "⚠️  前台站点健康检查失败"
fi

# 检查管理后台
if curl -s -o /dev/null -w "%{http_code}" https://admin.sub-dog.top | grep -q "200"; then
    echo "✅ 管理后台健康检查通过"
else
    echo "⚠️  管理后台健康检查失败"
fi

echo ""
echo "=========================================="
echo "  🎉 部署完成!"
echo "  完成时间: $(date)"
echo "=========================================="
echo ""
echo "📋 快速检查命令:"
echo "   查看后端日志: pm2 logs dog-catch-backend"
echo "   查看 PM2 状态: pm2 status"
echo "   查看 Nginx 错误: sudo tail -f /var/log/nginx/error.log"
echo ""
echo "🌐 访问地址:"
echo "   前台播放器: https://player.sub-dog.top"
echo "   管理后台:   https://admin.sub-dog.top"
echo "   API 接口:   https://api.sub-dog.top"
echo ""