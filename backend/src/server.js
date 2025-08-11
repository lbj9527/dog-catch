const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// 数据库初始化
const db = new sqlite3.Database('./database/subtitles.db');

// 初始化数据库表
db.serialize(() => {
    // 字幕表
    db.run(`CREATE TABLE IF NOT EXISTS subtitles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        video_id TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // 管理员表
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // 创建默认管理员账号 (用户名: admin, 密码: admin123)
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)`, 
        ['admin', defaultPassword]);
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（用于提供字幕文件）
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 文件上传配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './uploads/');
    },
    filename: (req, file, cb) => {
        const videoId = req.params.video_id;
        const ext = path.extname(file.originalname);
        cb(null, `${videoId}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.srt', '.vtt'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传 .srt 和 .vtt 格式的字幕文件'));
        }
    },
    limits: {
        fileSize: 1024 * 1024 // 1MB 限制
    }
});

// JWT 验证中间件
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: '需要访问令牌' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '无效的访问令牌' });
        }
        req.user = user;
        next();
    });
};

// 路由

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// HLS代理接口 - 解决CORS和防盗链问题
app.get('/api/hls', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: '缺少url参数' });
    }
    
    try {
        const targetUrl = new URL(url);
        const isHttps = targetUrl.protocol === 'https:';
        const requestModule = isHttps ? https : http;
        
        // 设置请求选项，包含必要的headers
        const options = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: targetUrl.pathname + targetUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://missav.live/',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site'
            }
        };
        
        const proxyReq = requestModule.request(options, (proxyRes) => {
            // 设置CORS头
            res.set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Content-Type': proxyRes.headers['content-type'] || 'application/vnd.apple.mpegurl',
                'Cache-Control': 'no-cache'
            });
            
            // 设置状态码
            res.status(proxyRes.statusCode);
            
            // 管道传输响应数据
            proxyRes.pipe(res);
        });
        
        proxyReq.on('error', (error) => {
            console.error('代理请求错误:', error);
            res.status(500).json({ error: '代理请求失败' });
        });
        
        proxyReq.setTimeout(30000, () => {
            proxyReq.destroy();
            res.status(408).json({ error: '请求超时' });
        });
        
        proxyReq.end();
        
    } catch (error) {
        console.error('HLS代理错误:', error);
        res.status(400).json({ error: '无效的URL参数' });
    }
});

// 用户认证
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    db.get('SELECT * FROM admins WHERE username = ?', [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            message: '登录成功',
            token: token,
            user: {
                id: user.id,
                username: user.username
            }
        });
    });
});

// 验证token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        valid: true, 
        user: {
            id: req.user.id,
            username: req.user.username
        }
    });
});

// 获取字幕文件 (公开接口)
app.get('/api/subtitle/:video_id', (req, res) => {
    const videoId = req.params.video_id;
    
    db.get('SELECT * FROM subtitles WHERE video_id = ?', [videoId], async (err, subtitle) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!subtitle) {
            return res.status(404).json({ error: '字幕文件不存在' });
        }
        
        try {
            const filePath = path.join(__dirname, '../uploads', path.basename(subtitle.file_path));
            const content = await fs.readFile(filePath, 'utf-8');
            
            // 设置正确的内容类型
            const ext = path.extname(subtitle.filename).toLowerCase();
            const contentType = ext === '.vtt' ? 'text/vtt' : 'text/plain';
            
            res.set('Content-Type', contentType);
            res.send(content);
        } catch (error) {
            res.status(500).json({ error: '读取字幕文件失败' });
        }
    });
});

// 上传字幕文件 (需要认证)
app.post('/api/subtitle/:video_id', authenticateToken, upload.single('subtitle'), (req, res) => {
    const videoId = req.params.video_id;
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '请选择字幕文件' });
    }
    
    const insertOrUpdate = `INSERT OR REPLACE INTO subtitles 
        (video_id, filename, file_path, file_size, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    
    db.run(insertOrUpdate, [
        videoId,
        file.originalname,
        file.filename,
        file.size
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: '数据库保存失败' });
        }
        
        res.json({
            message: '字幕文件上传成功',
            subtitle: {
                video_id: videoId,
                filename: file.originalname,
                size: file.size
            }
        });
    });
});

// 更新字幕文件 (需要认证)
app.put('/api/subtitle/:video_id', authenticateToken, upload.single('subtitle'), (req, res) => {
    const videoId = req.params.video_id;
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '请选择字幕文件' });
    }
    
    // 先检查是否存在
    db.get('SELECT * FROM subtitles WHERE video_id = ?', [videoId], (err, existing) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!existing) {
            return res.status(404).json({ error: '字幕文件不存在，请先上传' });
        }
        
        // 更新记录
        db.run(`UPDATE subtitles SET 
            filename = ?, file_path = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE video_id = ?`, 
            [file.originalname, file.filename, file.size, videoId], 
            function(err) {
                if (err) {
                    return res.status(500).json({ error: '数据库更新失败' });
                }
                
                res.json({
                    message: '字幕文件更新成功',
                    subtitle: {
                        video_id: videoId,
                        filename: file.originalname,
                        size: file.size
                    }
                });
            }
        );
    });
});

// 删除字幕文件 (需要认证)
app.delete('/api/subtitle/:video_id', authenticateToken, (req, res) => {
    const videoId = req.params.video_id;
    
    // 先获取文件信息
    db.get('SELECT * FROM subtitles WHERE video_id = ?', [videoId], async (err, subtitle) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!subtitle) {
            return res.status(404).json({ error: '字幕文件不存在' });
        }
        
        try {
            // 删除物理文件
            const filePath = path.join(__dirname, '../uploads', path.basename(subtitle.file_path));
            await fs.unlink(filePath);
        } catch (error) {
            console.error('删除文件失败:', error);
            // 继续删除数据库记录
        }
        
        // 删除数据库记录
        db.run('DELETE FROM subtitles WHERE video_id = ?', [videoId], function(err) {
            if (err) {
                return res.status(500).json({ error: '数据库删除失败' });
            }
            
            res.json({ message: '字幕文件删除成功' });
        });
    });
});

// 获取所有字幕列表 (需要认证)
app.get('/api/subtitles', authenticateToken, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM subtitles';
    let countQuery = 'SELECT COUNT(*) as total FROM subtitles';
    let params = [];
    
    if (search) {
        query += ' WHERE video_id LIKE ?';
        countQuery += ' WHERE video_id LIKE ?';
        params.push(`%${search}%`);
    }
    
    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    // 获取总数
    db.get(countQuery, search ? [`%${search}%`] : [], (err, countResult) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        // 获取数据
        db.all(query, params, (err, subtitles) => {
            if (err) {
                return res.status(500).json({ error: '数据库错误' });
            }
            
            res.json({
                data: subtitles,
                pagination: {
                    page: page,
                    limit: limit,
                    total: countResult.total,
                    totalPages: Math.ceil(countResult.total / limit)
                }
            });
        });
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件大小超过限制（最大1MB）' });
        }
    }
    
    res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 404 处理
app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 后端服务器启动成功`);
    console.log(`📡 服务地址: http://localhost:${PORT}`);
    console.log(`🔑 默认管理员账号: admin / admin123`);
    console.log(`📁 字幕文件存储: ./uploads/`);
    console.log(`💾 数据库文件: ./database/subtitles.db`);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    db.close((err) => {
        if (err) {
            console.error('关闭数据库连接失败:', err);
        } else {
            console.log('数据库连接已关闭');
        }
        process.exit(0);
    });
}); 