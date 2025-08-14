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
const { SocksProxyAgent } = require('socks-proxy-agent');
const assToVtt = require('ass-to-vtt');
const { Readable } = require('stream');

// 新增：为上游请求启用 Keep-Alive，以减少频繁建连的开销
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 15000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 128, keepAliveMsecs: 15000 });

// 可选：SOCKS 代理（优先使用此代理覆盖默认 agent）
// 设置环境变量 SOCKS_PROXY=socks5://127.0.0.1:7890 即可启用
const SOCKS_PROXY_URL = process.env.SOCKS_PROXY || process.env.ALL_PROXY;
let socksAgent = null;
if (SOCKS_PROXY_URL) {
    try {
        socksAgent = new SocksProxyAgent(SOCKS_PROXY_URL);
        // 提升并发/复用
        socksAgent.keepAlive = true;
        socksAgent.maxSockets = 128;
    } catch (e) {
        console.warn('SOCKS proxy init failed:', e.message);
    }
}

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
        const videoId = (req.params.video_id || '').toLowerCase();
        const ext = path.extname(file.originalname);
        cb(null, `${videoId}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.srt', '.vtt', '.ass', '.ssa'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传 .srt、.vtt、.ass、.ssa 格式的字幕文件'));
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

    // 统一的“仅发送一次”守护
    let responded = false;
    const safeStatus = (code) => {
        if (responded || res.headersSent) return false;
        res.status(code);
        return true;
    };
    const safeSet = (key, val) => {
        if (responded || res.headersSent) return;
        res.set(key, val);
    };
    const safeJson = (code, payload) => {
        if (responded || res.headersSent) return;
        responded = true;
        res.status(code).json(payload);
    };
    const safeSend = (payload) => {
        if (responded || res.headersSent) return;
        responded = true;
        res.send(payload);
    };

    // 处理可能的“嵌套代理”：url=http://<self>/api/hls?url=<real>
    let rawUrl = url;
    try {
        const maybeLocal = new URL(rawUrl);
        const selfHost = req.get('host');
        if (maybeLocal.host === selfHost && maybeLocal.pathname === '/api/hls') {
            const inner = new URLSearchParams(maybeLocal.search).get('url');
            if (inner) rawUrl = inner;
        }
    } catch { /* ignore */ }

    let targetUrl;
    try {
        targetUrl = new URL(rawUrl);
    } catch (error) {
        return safeJson(400, { error: '无效的URL参数' });
    }

    const isHttps = targetUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    // 判断是否为playlist（基于扩展名，后续也会基于content-type兜底判断）
    const isPlaylistByExt = /\.(m3u8|m3u)(?:$|\?)/i.test(targetUrl.pathname);

    // 组装请求头
    // 对playlist强制identity避免压缩，便于服务端改写
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0 Safari/537.36',
        'Referer': 'https://missav.live/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
    };

    if (isPlaylistByExt) {
        headers['Accept-Encoding'] = 'identity';
    } else {
        // 分片/密钥等二进制资源转发时，透传 Range 以支持断点/分段请求
        if (req.headers['range']) {
            headers['Range'] = req.headers['range'];
        }
    }

    const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method || 'GET',
        headers,
        agent: socksAgent ? socksAgent : (isHttps ? httpsAgent : httpAgent)
    };

    const proxyReq = requestModule.request(options, (proxyRes) => {
        // 统一设置CORS
        safeSet('Access-Control-Allow-Origin', '*');
        safeSet('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        safeSet('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
        safeSet('Cache-Control', proxyRes.headers['cache-control'] || 'no-cache');

        const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
        const isPlaylistByHeader = contentType.includes('application/vnd.apple.mpegurl') ||
                                   contentType.includes('application/x-mpegurl') ||
                                   contentType.includes('audio/mpegurl');

        const shouldRewrite = isPlaylistByExt || isPlaylistByHeader;

        if (!shouldRewrite) {
            // 非playlist：二进制流式转发，尽可能透传相关头
            if (proxyRes.headers['content-type']) safeSet('Content-Type', proxyRes.headers['content-type']);
            if (proxyRes.headers['content-length']) safeSet('Content-Length', proxyRes.headers['content-length']);
            if (proxyRes.headers['content-encoding']) safeSet('Content-Encoding', proxyRes.headers['content-encoding']);
            if (proxyRes.headers['accept-ranges']) safeSet('Accept-Ranges', proxyRes.headers['accept-ranges']);
            if (proxyRes.headers['etag']) safeSet('ETag', proxyRes.headers['etag']);
            if (proxyRes.headers['last-modified']) safeSet('Last-Modified', proxyRes.headers['last-modified']);

            if (safeStatus(proxyRes.statusCode || 200)) {
                responded = true; // piping 将开始输出
            }
            proxyRes.pipe(res);
            return;
        }

        // playlist：读取文本，改写所有URI后返回
        safeSet('Content-Type', 'application/vnd.apple.mpegurl');
        safeStatus(proxyRes.statusCode || 200);

        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
            try {
                // 强制按utf-8解析文本m3u8
                const raw = Buffer.concat(chunks).toString('utf8');
                const rewritten = rewriteM3U8(raw, targetUrl, `${req.protocol}://${req.get('host')}`);
                safeSend(rewritten);
            } catch (e) {
                console.error('改写m3u8失败:', e);
                safeSend(Buffer.concat(chunks));
            }
        });
    });

    proxyReq.on('error', (error) => {
        console.error('代理请求错误:', error);
        safeJson(502, { error: '代理请求失败' });
    });

    proxyReq.setTimeout(30000, () => {
        proxyReq.destroy();
        safeJson(408, { error: '请求超时' });
    });

    proxyReq.end();
});

/**
 * 重写m3u8内容中的所有URI为当前代理地址
 * 处理：
 *  - 非注释行（分片、子清单）
 *  - #EXT-X-KEY / #EXT-X-MEDIA 等ATTR-LIST中的 URI="..."
 */
function rewriteM3U8(content, baseUrl, proxyOrigin) {
    const lines = content.split(/\r?\n/);
    const out = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();

        if (trimmed.length === 0) {
            out.push(line);
            continue;
        }

        if (trimmed.startsWith('#')) {
            // 统一改写所有包含 URI="..." 的ATTR-LIST（覆盖 KEY/MEDIA/MAP/PART/PRELOAD-HINT/I-FRAME-STREAM-INF 等）
            if (/^#EXT-X-/.test(trimmed) && /URI="[^"]+"/i.test(trimmed)) {
                line = line.replace(/URI="([^"]+)"/gi, (m, g1) => {
                    try {
                        const abs = new URL(g1, baseUrl).href;
                        const proxied = `${proxyOrigin}/api/hls?url=${encodeURIComponent(abs)}`;
                        return `URI="${proxied}"`;
                    } catch {
                        return m;
                    }
                });
            }
            out.push(line);
            continue;
        }

        // 非注释：资源URI（分片或子清单）
        try {
            const absolute = new URL(trimmed, baseUrl).href;
            const proxied = `${proxyOrigin}/api/hls?url=${encodeURIComponent(absolute)}`;
            out.push(proxied);
        } catch {
            // 保底：无法解析则原样输出
            out.push(line);
        }
    }

    return out.join('\n');
}

async function convertAssToVttString(assText) {
    return new Promise((resolve, reject) => {
        const input = Readable.from([assText]);
        const transformer = assToVtt();
        const chunks = [];
        transformer.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        transformer.on('error', reject);
        transformer.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        input.pipe(transformer);
    });
}

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
    
    db.get('SELECT * FROM subtitles WHERE lower(video_id) = lower(?)', [videoId], async (err, subtitle) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!subtitle) {
            // 已禁用：目录直读回退逻辑（用于验证数据库工作是否正常）
            /*
            try {
                const lowerId = (videoId || '').toLowerCase();
                const uploadsDir = path.join(__dirname, '../uploads');
                const candidates = [`${lowerId}.vtt`, `${lowerId}.srt`];
                for (const fileName of candidates) {
                    try {
                        const filePath = path.join(uploadsDir, fileName);
                        const stat = await fs.stat(filePath);
                        const content = await fs.readFile(filePath, 'utf-8');
                        const ext = path.extname(fileName).toLowerCase();
                        const contentType = ext === '.vtt' ? 'text/vtt' : 'text/plain';

                        db.run(
                            `INSERT OR REPLACE INTO subtitles (video_id, filename, file_path, file_size, updated_at)
                             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                            [lowerId, fileName, fileName, stat.size],
                            (err2) => { if (err2) console.error('回填字幕记录失败:', err2); }
                        );

                        res.set('Content-Type', contentType);
                        return res.send(content);
                    } catch {}
                }
            } catch {}
            */
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
app.post('/api/subtitle/:video_id', authenticateToken, upload.single('subtitle'), async (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase();
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '请选择字幕文件' });
    }

    // 处理 .ass/.ssa → .vtt 转码
    let saveFilename = file.filename; // 物理文件名
    let saveSize = file.size;
    try {
        const originalExt = path.extname(file.originalname).toLowerCase();
        if (originalExt === '.ass' || originalExt === '.ssa') {
            const inputPath = path.join(__dirname, '../uploads', file.filename);
            const raw = await fs.readFile(inputPath, 'utf-8');
            const vtt = await convertAssToVttString(raw);
            const outputFilename = `${videoId}.vtt`;
            const outputPath = path.join(__dirname, '../uploads', outputFilename);
            await fs.writeFile(outputPath, vtt, 'utf-8');
            // 删除原始文件
            try { await fs.unlink(inputPath); } catch {}
            const stat = await fs.stat(outputPath);
            saveFilename = outputFilename;
            saveSize = stat.size;
        }
    } catch (e) {
        return res.status(500).json({ error: '字幕转码失败（ASS/SSA→VTT）' });
    }
    
    const insertOrUpdate = `INSERT OR REPLACE INTO subtitles 
        (video_id, filename, file_path, file_size, updated_at) 
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    
    db.run(insertOrUpdate, [
        videoId,
        saveFilename, // 展示与类型判断使用统一的.vtt或原始扩展
        saveFilename,
        saveSize
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: '数据库保存失败' });
        }
        
        res.json({
            message: '字幕文件上传成功',
            subtitle: {
                video_id: videoId,
                filename: saveFilename,
                size: saveSize
            }
        });
    });
});

// 更新字幕文件 (需要认证)
app.put('/api/subtitle/:video_id', authenticateToken, upload.single('subtitle'), async (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase();
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '请选择字幕文件' });
    }
    
    // 先检查是否存在
    db.get('SELECT * FROM subtitles WHERE lower(video_id) = lower(?)', [videoId], async (err, existing) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!existing) {
            return res.status(404).json({ error: '字幕文件不存在，请先上传' });
        }
        
        // 处理 .ass/.ssa → .vtt 转码
        let saveFilename = file.filename;
        let saveSize = file.size;
        try {
            const originalExt = path.extname(file.originalname).toLowerCase();
            if (originalExt === '.ass' || originalExt === '.ssa') {
                const inputPath = path.join(__dirname, '../uploads', file.filename);
                const raw = await fs.readFile(inputPath, 'utf-8');
                const vtt = await convertAssToVttString(raw);
                const outputFilename = `${videoId}.vtt`;
                const outputPath = path.join(__dirname, '../uploads', outputFilename);
                await fs.writeFile(outputPath, vtt, 'utf-8');
                try { await fs.unlink(inputPath); } catch {}
                const stat = await fs.stat(outputPath);
                saveFilename = outputFilename;
                saveSize = stat.size;
            }
        } catch (e) {
            return res.status(500).json({ error: '字幕转码失败（ASS/SSA→VTT）' });
        }
        
        // 更新记录
        db.run(`UPDATE subtitles SET 
            filename = ?, file_path = ?, file_size = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE lower(video_id) = lower(?)`, 
            [saveFilename, saveFilename, saveSize, videoId], 
            function(err) {
                if (err) {
                    return res.status(500).json({ error: '数据库更新失败' });
                }
                
                res.json({
                    message: '字幕文件更新成功',
                    subtitle: {
                        video_id: videoId,
                        filename: saveFilename,
                        size: saveSize
                    }
                });
            }
        );
    });
});

// 删除字幕文件 (需要认证)
app.delete('/api/subtitle/:video_id', authenticateToken, (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase();
    
    // 先获取文件信息
    db.get('SELECT * FROM subtitles WHERE lower(video_id) = lower(?)', [videoId], async (err, subtitle) => {
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
        db.run('DELETE FROM subtitles WHERE lower(video_id) = lower(?)', [videoId], function(err) {
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

// 批量删除字幕文件 (需要认证)
app.delete('/api/subtitles', authenticateToken, async (req, res) => {
    const videoIds = req.body && req.body.video_ids;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: '请提供要删除的字幕文件的video_id列表' });
    }
    if (videoIds.length > 200) {
        return res.status(400).json({ error: '单次最多允许删除200条' });
    }

    const normalizedIds = Array.from(new Set(videoIds.map(id => String(id || '').toLowerCase().trim()))).filter(Boolean);

    const failed = {};
    let deleted = 0;

    const selectById = (vid) => new Promise((resolve, reject) => {
        db.get('SELECT * FROM subtitles WHERE lower(video_id) = lower(?)', [vid], (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });

    const deleteById = (vid) => new Promise((resolve, reject) => {
        db.run('DELETE FROM subtitles WHERE lower(video_id) = lower(?)', [vid], function(err) {
            if (err) return reject(err);
            resolve(this && this.changes > 0);
        });
    });

    for (const vid of normalizedIds) {
        try {
            const row = await selectById(vid);
            if (!row) {
                failed[vid] = '字幕文件不存在';
                continue;
            }

            try {
                const filePath = path.join(__dirname, '../uploads', path.basename(row.file_path));
                await fs.unlink(filePath);
            } catch (e) {
                if (!e || e.code !== 'ENOENT') {
                    failed[vid] = '删除物理文件失败';
                }
            }

            const ok = await deleteById(vid);
            if (ok) {
                deleted += 1;
            } else {
                failed[vid] = failed[vid] || '删除数据库记录失败';
            }
        } catch (e) {
            failed[vid] = e && e.message ? e.message : '删除失败';
        }
    }

    return res.json({ deleted, failed });
});

// 获取字幕文件统计 (需要认证)
app.get('/api/subtitles/stats', authenticateToken, async (req, res) => {
    const search = (req.query.search || '').trim();
    try {
        const where = search ? ' WHERE video_id LIKE ?' : '';
        const params = search ? [`%${search}%`] : [];

        const row = await new Promise((resolve, reject) => {
            db.get(
                `SELECT 
                    COUNT(*) AS total,
                    SUM(CASE WHEN filename IS NOT NULL AND filename <> '' THEN 1 ELSE 0 END) AS hasSubtitle
                 FROM subtitles${where}`,
                params,
                (err, r) => {
                    if (err) return reject(err);
                    resolve(r || { total: 0, hasSubtitle: 0 });
                }
            );
        });

        const total = row.total || 0;
        const hasSubtitle = row.hasSubtitle || 0;
        const missing = Math.max(0, total - hasSubtitle);
        const completion = total > 0 ? Math.round((hasSubtitle / total) * 100) : 0;

        res.json({ total, hasSubtitle, missing, completion });
    } catch (err) {
        console.error('获取字幕文件统计失败:', err);
        res.status(500).json({ error: '获取字幕文件统计失败' });
    }
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