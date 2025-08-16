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
const chardet = require('chardet');
const iconv = require('iconv-lite');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const crypto = require('crypto');
const Redis = require('ioredis');
const { RateLimiterRedis } = require('rate-limiter-flexible');

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

// 启动时强校验 JWT_SECRET
if (!process.env.JWT_SECRET || JWT_SECRET === 'your-secret-key-change-in-production' || String(JWT_SECRET).length < 16) {
    console.error('FATAL: JWT_SECRET 未设置或过弱。请设置强随机 JWT_SECRET 后重启。');
    process.exit(1);
}

// 水印密钥与参数（与 JWT_SECRET 区分）
const SUB_WM_SECRET = process.env.SUB_WM_SECRET || JWT_SECRET;
const SUB_WATERMARK = String(process.env.SUB_WATERMARK || 'on') === 'on';
const SUB_WM_DENSITY = String(process.env.SUB_WM_DENSITY || 'med'); // low|med|high

// 限流参数（令牌桶/窗口阈值）
const RATE = {
    SUBTITLE_USER_5MIN: Number(process.env.SUBTITLE_RATE_USER_5MIN || 20),
    SUBTITLE_BURST_USER: Number(process.env.SUBTITLE_BURST_USER || 40),
    SUBTITLE_IP_1H: Number(process.env.SUBTITLE_RATE_IP_1H || 2000),
    SUBTITLE_BURST_IP_10MIN: Number(process.env.SUBTITLE_BURST_IP_10MIN || 400),
    VARIANTS_USER_5MIN: Number(process.env.VARIANTS_RATE_USER_5MIN || 10),
    VARIANTS_BURST_USER: Number(process.env.VARIANTS_BURST_USER || 20),
    VARIANTS_IP_1H: Number(process.env.VARIANTS_RATE_IP_1H || 1000),
    VARIANTS_BURST_IP_10MIN: Number(process.env.VARIANTS_BURST_IP_10MIN || 200),
    SCAN_UNIQUE_VIDEO_10MIN: Number(process.env.SCAN_UNIQUE_VIDEO_10MIN || 40),
    SCAN_UNIQUE_BASE_10MIN: Number(process.env.SCAN_UNIQUE_BASE_10MIN || 30),
    SCAN_PENALTY_WINDOW_MIN: Number(process.env.SCAN_PENALTY_WINDOW_MIN || 30)
};

// Redis 连接
const REDIS_URL = process.env.REDIS_URL || '';
let redis = null;
if (REDIS_URL) {
    redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 3 });
    redis.on('error', (e) => console.warn('Redis error:', e && e.message));
    redis.connect().catch(e => console.warn('Redis connect failed:', e && e.message));
}

// 标记/查询"需要验证码"
async function markCaptchaRequired(kind, id, minutes = 5) {
    try {
        if (!redis) return;
        await redis.set(`captcha:req:${kind}:${id}`, '1', 'EX', minutes*60);
    } catch {}
}
async function isCaptchaRequired(kind, id) {
    try {
        if (!redis) return false;
        const v = await redis.get(`captcha:req:${kind}:${id}`);
        return v === '1';
    } catch { return false; }
}

// Rate Limiter 工具：返回一个函数 (key) => Promise<boolean>
function makeLimiter({ keyPrefix, points, durationSec }){
    if (!redis) {
        const mem = new Map();
        return async (key) => {
            const now = Date.now();
            let rec = mem.get(key);
            if (!rec || now - rec.start > durationSec*1000) { rec = { start: now, count: 0 }; mem.set(key, rec); }
            rec.count += 1;
            return rec.count <= points;
        };
    }
    const limiter = new RateLimiterRedis({
        storeClient: redis,
        keyPrefix,
        points,
        duration: durationSec
    });
    return async (key) => {
        try { await limiter.consume(key, 1); return true; } catch { return false; }
    };
}

// 扫描阈值存储（Redis Set）
async function addScan(userId, kind, member, windowSec, threshold){
    if (!redis) return 0;
    const now = Math.floor(Date.now()/1000);
    const zKey = `scan:${userId}:${kind}`; // kind=video|base
    await redis.zadd(zKey, now, member);
    await redis.zremrangebyscore(zKey, 0, now - windowSec);
    await redis.expire(zKey, windowSec + 60);
    const cnt = await redis.zcard(zKey);
    if (threshold && cnt >= threshold) {
        await penalize(String(userId), RATE.SCAN_PENALTY_WINDOW_MIN);
    }
    return cnt;
}
async function isPenalized(id){
    if (!redis) return false;
    const until = await redis.get(`penalty:${id}`);
    return until && Number(until) > Date.now();
}
async function penalize(id, minutes){
    if (!redis) return;
    const until = Date.now() + minutes*60*1000;
    await redis.set(`penalty:${id}`, String(until), 'PX', minutes*60*1000);
}

// hCaptcha 校验（无全局 fetch 依赖）
async function verifyHCaptcha(token, remoteip){
    return new Promise((resolve) => {
        try {
            const provider = String(process.env.CAPTCHA_PROVIDER || 'hcaptcha');
            if (provider !== 'hcaptcha') return resolve(false);
            const secret = process.env.CAPTCHA_SECRET_KEY;
            if (!secret) return resolve(false);
            const body = new URLSearchParams({ secret, response: token });
            if (remoteip) body.append('remoteip', remoteip);
            const data = body.toString();
            const opts = {
                hostname: 'hcaptcha.com',
                port: 443,
                path: '/siteverify',
                method: 'POST',
                headers: { 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) }
            };
            const req = https.request(opts, (resp) => {
                const chunks = [];
                resp.on('data', d => chunks.push(d));
                resp.on('end', () => {
                    try {
                        const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        resolve(!!j.success);
                    } catch { resolve(false); }
                });
            });
            req.on('error', () => resolve(false));
            req.write(data);
            req.end();
        } catch { resolve(false); }
    });
}

async function requireCaptchaIfFlagged(req, res, next){
    const explicit = String(process.env.CAPTCHA_REQUIRED || '0') === '1' || req.headers['x-require-captcha'] === '1';
    // 识别主体：优先 email（登录/注册）、其次 userId（已登录）、否则 IP
    const ip = req.ip || req.connection?.remoteAddress || '';
    const email = (req.body && req.body.email && String(req.body.email).toLowerCase()) || '';
    const userId = (req.user && req.user.id) ? String(req.user.id) : '';
    const flagged = explicit || (email && await isCaptchaRequired('email', email)) || (userId && await isCaptchaRequired('user', userId)) || (ip && await isCaptchaRequired('ip', ip));
    if (!flagged) return next();
    const token = req.body && (req.body.captchaToken || req.headers['x-captcha-token']);
    if (!token) return res.status(403).json({ error: '需要验证码', requireCaptcha: true });
    const ok = await verifyHCaptcha(token, ip);
    if (!ok) return res.status(403).json({ error: '验证码校验失败', requireCaptcha: true });
    return next();
}

// 两类接口限流器
const allowSubtitleUser = makeLimiter({ keyPrefix: 'rl:sub:u', points: RATE.SUBTITLE_BURST_USER, durationSec: 5*60 });
const allowSubtitleIp10m = makeLimiter({ keyPrefix: 'rl:sub:ip10', points: RATE.SUBTITLE_BURST_IP_10MIN, durationSec: 10*60 });
const allowSubtitleIp1h = makeLimiter({ keyPrefix: 'rl:sub:ip60', points: RATE.SUBTITLE_IP_1H, durationSec: 60*60 });

const allowVariantsUser = makeLimiter({ keyPrefix: 'rl:var:u', points: RATE.VARIANTS_BURST_USER, durationSec: 5*60 });
const allowVariantsIp10m = makeLimiter({ keyPrefix: 'rl:var:ip10', points: RATE.VARIANTS_BURST_IP_10MIN, durationSec: 10*60 });
const allowVariantsIp1h = makeLimiter({ keyPrefix: 'rl:var:ip60', points: RATE.VARIANTS_IP_1H, durationSec: 60*60 });

const allowLoginUser10m = makeLimiter({ keyPrefix: 'rl:login:u', points: 5, durationSec: 10*60 });
const allowLoginIp10m = makeLimiter({ keyPrefix: 'rl:login:ip', points: 30, durationSec: 10*60 });
const allowEmailIp1h = makeLimiter({ keyPrefix: 'rl:ecode:ip', points: 20, durationSec: 60*60 });

// 新增：本地内存级验证码发送最小间隔限制（同步，避免未 await 时失效）
const EMAIL_CODE_MIN_INTERVAL_SEC = Number(process.env.EMAIL_CODE_MIN_INTERVAL_SEC || 30); // 同邮箱最小重试间隔
const EMAIL_CODE_IP_MIN_INTERVAL_SEC = Number(process.env.EMAIL_CODE_IP_MIN_INTERVAL_SEC || 5); // 同 IP 最小重试间隔
const _lastEmailCodeByEmail = new Map(); // email(lower) -> timestamp(ms)
const _lastEmailCodeByIp = new Map();    // ip -> timestamp(ms)

async function checkEmailCodeLimits(emailLower, ip) {
    try {
        const now = Date.now();
        const eKey = String(emailLower || '').toLowerCase();
        const iKey = String(ip || '');

        // 优先使用 Redis：基于 NX+EX 的最小间隔闸
        if (redis) {
            const rkEmail = `ecode:last:email:${eKey}`;
            const rkIp = `ecode:last:ip:${iKey}`;
            const [setE, setI] = await Promise.all([
                redis.set(rkEmail, '1', 'EX', EMAIL_CODE_MIN_INTERVAL_SEC, 'NX'),
                redis.set(rkIp, '1', 'EX', EMAIL_CODE_IP_MIN_INTERVAL_SEC, 'NX')
            ]);
            return !!setE && !!setI;
        }

        // 回退：内存间隔
        const lastE = _lastEmailCodeByEmail.get(eKey) || 0;
        const lastI = _lastEmailCodeByIp.get(iKey) || 0;
        if (now - lastE < EMAIL_CODE_MIN_INTERVAL_SEC * 1000) return false;
        if (now - lastI < EMAIL_CODE_IP_MIN_INTERVAL_SEC * 1000) return false;
        _lastEmailCodeByEmail.set(eKey, now);
        _lastEmailCodeByIp.set(iKey, now);
        return true;
    } catch {
        // 兜底：出错时不阻断
        return true;
    }
}

// 邮件发送器
let mailTransporter = null;
try {
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: String(process.env.SMTP_SECURE || 'true') === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
} catch (e) {
    console.warn('Init mail transporter failed:', e && e.message);
}

// 数据库初始化
const db = new sqlite3.Database('./database/subtitles.db');

async function detectAndDecodeToUtf8(buffer) {
    try {
        const detected = chardet.detect(buffer) || 'UTF-8';
        const enc = (Array.isArray(detected) ? detected[0] : detected) || 'UTF-8';
        if (/utf-8/i.test(enc)) {
            return buffer.toString('utf8');
        }
        if (iconv.encodingExists(enc)) {
            return iconv.decode(buffer, enc);
        }
        return buffer.toString('utf8');
    } catch {
        return buffer.toString('utf8');
    }
}

function normalizeTextForHash(input) {
    if (typeof input !== 'string') return '';
    return input
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(l => l.replace(/\s+$/, ''))
        .join('\n');
}
function computeContentHash(text) {
    const normalized = normalizeTextForHash(text);
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// 新增：SRT→VTT 简易转换
function convertSrtToVttString(srt) {
    if (!srt || /\bWEBVTT\b/.test(srt)) return srt;
    const lines = String(srt).replace(/\r\n?/g, '\n').split('\n');
    const out = ['WEBVTT', ''];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        if (/^\d+$/.test(line)) continue; // 跳过编号
        const time = line.match(/^(\d{2}:\d{2}:\d{2}),(\d{3})\s+--\>\s+(\d{2}:\d{2}:\d{2}),(\d{3})/);
        if (time) {
            out.push(`${time[1]}.${time[2]} --> ${time[3]}.${time[4]}`);
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
}

// 新增：在 VTT 中注入水印（NOTE + 零宽字符）
function injectVttWatermark(vttText, context) {
    if (!SUB_WATERMARK) return vttText;
    try {
        const { userId, videoId } = context || {};
        const ts = Math.floor(Date.now()/1000);
        const sig = crypto.createHmac('sha256', SUB_WM_SECRET).update(`${userId}|${videoId}|${ts}`).digest('base64url').slice(0, 16);
        const lines = String(vttText || '').replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let insertedHeader = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!insertedHeader && /\bWEBVTT\b/.test(line)) {
                out.push(line);
                out.push(`NOTE uid=${computeContentHash(String(userId||'' )).slice(0,8)} vid=${String(videoId||'').slice(0,24)} ts=${ts} sig=${sig}`);
                insertedHeader = true;
                continue;
            }
            out.push(line);
        }
        // 选择性在对白行尾注入零宽字符
        const seed = crypto.createHmac('sha256', SUB_WM_SECRET).update(`${userId}|${videoId}|${ts}`).digest();
        let rng = 0;
        function rand(){
            // 简单 LCG 基于 seed 字节
            rng = (rng + seed[rng % seed.length] + 1) % 0x7fffffff;
            return rng / 0x7fffffff;
        }
        const densityMap = { low: 20, med: 12, high: 6 };
        const every = densityMap[SUB_WM_DENSITY] || 12;
        for (let i = 0, seen = 0; i < out.length; i++) {
            const l = out[i];
            if (!l || l.startsWith('WEBVTT') || l.startsWith('NOTE') || l.startsWith('#') || /-->/.test(l)) continue;
            // 仅对白文本行
            seen += 1;
            if (seen % every === 0 && rand() > 0.3) {
                const mark = rand() > 0.5 ? '\u200B' : '\u200C'; // ZWSP 或 ZWNJ
                out[i] = l + mark;
            }
        }
        return out.join('\n');
    } catch {
        return vttText;
    }
}

// 用户/管理员鉴权中间件
function verifyJwtFromHeader(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return { error: '需要访问令牌' };
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return { payload };
    } catch (e) {
        return { error: '无效的访问令牌' };
    }
}

function authenticateAdminToken(req, res, next) {
    const { payload, error } = verifyJwtFromHeader(req);
    if (error) return res.status(401).json({ error });
    if (payload && payload.role === 'admin') { req.user = payload; return next(); }
    return res.status(403).json({ error: '没有管理员权限' });
}

function authenticateUserToken(req, res, next) {
    const { payload, error } = verifyJwtFromHeader(req);
    if (error) return res.status(401).json({ error });
    if (payload && payload.role === 'user') {
        getAsync('SELECT id, status, COALESCE(token_version,0) as token_version FROM users WHERE id = ?', [payload.id])
            .then(row => {
                if (!row) return res.status(401).json({ error: '用户不存在或已被删除' });
                if (String(row.status || '').toLowerCase() !== 'active') {
                    return res.status(403).json({ error: '用户状态不可用' });
                }
                // 校验 token 版本号
                if (typeof payload.tv !== 'undefined' && Number(payload.tv) !== Number(row.token_version || 0)) {
                    return res.status(401).json({ error: '令牌已失效，请重新登录' });
                }
                req.user = payload;
                return next();
            })
            .catch(err => {
                console.error('鉴权查询用户失败:', err);
                return res.status(500).json({ error: '鉴权失败' });
            });
        return;
    }
    return res.status(403).json({ error: '没有用户权限' });
}

function authenticateAnyToken(req, res, next) {
    const { payload, error } = verifyJwtFromHeader(req);
    if (error) return res.status(401).json({ error });
    if (payload && (payload.role === 'user' || payload.role === 'admin')) {
        if (payload.role === 'admin') { req.user = payload; return next(); }
        getAsync('SELECT id, status, COALESCE(token_version,0) as token_version FROM users WHERE id = ?', [payload.id])
            .then(row => {
                if (!row) return res.status(401).json({ error: '用户不存在或已被删除' });
                if (String(row.status || '').toLowerCase() !== 'active') {
                    return res.status(403).json({ error: '用户状态不可用' });
                }
                if (typeof payload.tv !== 'undefined' && Number(payload.tv) !== Number(row.token_version || 0)) {
                    return res.status(401).json({ error: '令牌已失效，请重新登录' });
                }
                req.user = payload; return next();
            })
            .catch(err => { console.error('鉴权查询用户失败:', err); return res.status(500).json({ error: '鉴权失败' }); });
        return;
    }
    return res.status(403).json({ error: '无权限' });
}

function extractBaseVideoId(videoId) {
    const id = String(videoId || '').toUpperCase().trim();
    const m = id.match(/^([A-Z]+-\d{2,5})(?:-(\d+))?$/);
    if (m) return m[1];
    const m2 = id.match(/([A-Z]+-\d{2,5})/);
    return m2 ? m2[1] : id;
}

function getAllAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}
function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}
function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err){ if (err) reject(err); else resolve(this); });
    });
}

async function allocateVariantForBase(baseVideoId) {
    const rows = await getAllAsync('SELECT video_id, variant FROM subtitles WHERE lower(base_video_id) = lower(?)', [baseVideoId]);
    const used = new Set();
    for (const r of rows) {
        const v = Number(r.variant) || 1;
        used.add(v);
    }
    let variant = 1;
    while (used.has(variant)) variant += 1;
    const finalVideoId = variant === 1 ? baseVideoId : `${baseVideoId}-${variant}`;
    return { finalVideoId, variant };
}

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

    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        last_login_at DATETIME,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 邮箱验证码表
    db.run(`CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        purpose TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME,
        request_ip TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_verification_codes(email)');
    db.run('CREATE INDEX IF NOT EXISTS idx_email_codes_purpose ON email_verification_codes(purpose)');
    
    // 模式演进：为 subtitles 表补充新列（若存在则忽略错误）
    db.run('ALTER TABLE subtitles ADD COLUMN content_hash TEXT', () => {});
    db.run('ALTER TABLE subtitles ADD COLUMN base_video_id TEXT', () => {});
    db.run('ALTER TABLE subtitles ADD COLUMN variant INTEGER', () => {});
    db.run('ALTER TABLE subtitles ADD COLUMN original_filename TEXT', () => {});
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitles_content_hash ON subtitles(content_hash)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitles_base ON subtitles(base_video_id)', () => {});

    // 新增：为 users 表补充 token_version 列
    db.run('ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0', () => {});
    
    // 创建默认管理员账号 (用户名: admin, 密码: admin123)
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)`, 
        ['admin', defaultPassword]);
});

// 中间件
// 安全响应头
app.use(helmet());
// CORS 白名单（默认放行本地开发域名）
const defaultCors = ['http://localhost:3000', 'http://localhost:3001'];
const corsList = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = new Set((corsList.length ? corsList : defaultCors));
app.use(cors({
    origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOrigins.has(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET','HEAD','PUT','PATCH','POST','DELETE'],
    allowedHeaders: ['Content-Type','Authorization','Range'],
}));
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
        try {
            const ext = (path.extname(file.originalname || '') || '.srt').toLowerCase();
            const unique = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
            cb(null, `${unique}${ext}`);
        } catch (e) {
            cb(null, `tmp_${Date.now()}.srt`);
        }
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

// 可靠移动文件（重命名失败时退化为复制+删除）
async function moveFileSafe(src, dest) {
    try {
        await fs.rename(src, dest);
        return;
    } catch (e) {
        try {
            const data = await fs.readFile(src);
            await fs.writeFile(dest, data);
            try { await fs.unlink(src); } catch {}
            return;
        } catch (e2) {
            throw e2;
        }
    }
}

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

// 用户邮件验证码（开发环境可返回dev_code）
app.post('/api/user/email-code', requireCaptchaIfFlagged, async (req, res) => {
    try {
        const DEV_RETURN_CODE = false; // 开发环境也走真实邮箱
        const { email, purpose } = req.body || {};
        if (!email || !purpose || !['register','login','reset'].includes(purpose)) return res.status(400).json({ error: '参数错误' });
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const passMinInterval = await checkEmailCodeLimits(String(email).toLowerCase(), ip);
        if (!passMinInterval) { await markCaptchaRequired('email', String(email).toLowerCase()); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁，请稍后再试', requireCaptcha: true }); }
        const now = new Date();
        const recent = await getAllAsync(`SELECT created_at FROM email_verification_codes WHERE email = ? AND purpose = ? AND DATETIME(created_at) > DATETIME(?,'-1 hour') ORDER BY created_at DESC`, [email, purpose, now.toISOString()]);
        if (recent.length > 0) {
            const last = new Date(recent[0].created_at);
            if ((now - last) < 60000) { await markCaptchaRequired('email', String(email).toLowerCase()); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁，请稍后再试', requireCaptcha: true }); }
            if (recent.length >= 5) { await markCaptchaRequired('email', String(email).toLowerCase()); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求次数过多，请稍后再试', requireCaptcha: true }); }
        }
        const code = Math.floor(100000 + Math.random()*900000).toString();
        const expiresAt = new Date(Date.now()+5*60000).toISOString();
        await runAsync(`INSERT INTO email_verification_codes (email, code, purpose, expires_at, request_ip) VALUES (?,?,?,?,?)`, [email, code, purpose, expiresAt, req.ip || '']);
        console.log(`[EmailCode] purpose=${purpose} email=${email} code=${code}`);
        try {
            if (!mailTransporter) throw new Error('mail transporter not configured');
            const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
            await mailTransporter.sendMail({
                from,
                to: email,
                subject: `[Subtitle Dog] ${purpose==='register'?'注册':'找回密码'} 验证码`,
                text: `您的验证码为：${code}（5分钟内有效）。如果非本人操作请忽略本邮件。`,
                html: `<p>您的验证码为：<b style="font-size:18px;">${code}</b></p><p>5分钟内有效。如非本人操作请忽略。</p>`
            });
        } catch (e) {
            console.error('发送邮件失败:', e && e.message);
        }
        return res.json({ message:'验证码已发送' });
    } catch (e) { console.error(e); return res.status(500).json({ error: '发送验证码失败' }); }
});

async function consumeValidCode(email, purpose, code) {
    const row = await getAsync(`SELECT * FROM email_verification_codes WHERE email=? AND purpose=? AND code=? AND consumed_at IS NULL AND DATETIME(expires_at) > DATETIME('now') ORDER BY created_at DESC`, [email, purpose, code]);
    if (!row) return false;
    await runAsync(`UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
    return true;
}

// 用户注册（返回token，但前端不自动登录）
app.post('/api/user/register', requireCaptchaIfFlagged, async (req, res) => {
    try {
        const { username, email, password, code } = req.body || {};
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        if (!rlIpLogin10m(ip)) { await markCaptchaRequired('ip', ip); if (email) await markCaptchaRequired('email', String(email).toLowerCase()); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        if (!username || !email || !password || !code) return res.status(400).json({ error: '缺少必要参数' });
        const u = await getAsync('SELECT id FROM users WHERE lower(username)=lower(?)', [username]);
        if (u) return res.status(409).json({ error: '用户名已被占用' });
        const e = await getAsync('SELECT id FROM users WHERE lower(email)=lower(?)', [email]);
        if (e) return res.status(409).json({ error: '邮箱已被占用' });
        const ok = await consumeValidCode(email, 'register', code);
        if (!ok) return res.status(400).json({ error: '验证码无效或已过期' });
        const hash = bcrypt.hashSync(password, 10);
        await runAsync('INSERT INTO users (username, email, password_hash, last_login_at, token_version) VALUES (?,?,?, CURRENT_TIMESTAMP, 0)', [username, email, hash]);
        const user = await getAsync('SELECT id, username, email, COALESCE(token_version,0) as token_version FROM users WHERE username=?', [username]);
        const token = jwt.sign({ id: user.id, username: user.username, role: 'user', tv: Number(user.token_version||0) }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ message:'注册成功', token, user });
    } catch (e) { console.error(e); return res.status(500).json({ error: '注册失败' }); }
});

// 邮箱 + 密码登录
app.post('/api/user/login/password', requireCaptchaIfFlagged, async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        const userKey = String(email || '').toLowerCase();
        if (!rlIpLogin10m(ip)) { await markCaptchaRequired('ip', ip); if (email) await markCaptchaRequired('email', String(email).toLowerCase()); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        if (!rlUserLogin10m(userKey)) { await markCaptchaRequired('email', userKey); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        if (!email || !password) return res.status(400).json({ error: '缺少必要参数' });
        const user = await getAsync('SELECT * FROM users WHERE lower(email)=lower(?)', [email]);
        if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '邮箱或密码错误' });
        await runAsync('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        const token = jwt.sign({ id: user.id, username: user.username, role: 'user', tv: Number(user.token_version||0) }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ message:'登录成功', token, user: { id:user.id, username:user.username, email:user.email } });
    } catch (e) { console.error(e); return res.status(500).json({ error: '登录失败' }); }
});

// 找回密码：确认重置
app.post('/api/user/password/reset-confirm', requireCaptchaIfFlagged, async (req, res) => {
    try {
        const { email, code, new_password } = req.body || {};
        if (!email || !code || !new_password) return res.status(400).json({ error: '缺少必要参数' });
        if (String(new_password).length < 6) return res.status(400).json({ error: '新密码至少6位' });
        const ok = await getAsync(`SELECT id FROM users WHERE lower(email)=lower(?)`, [email]);
        if (!ok) return res.status(404).json({ error: '账号不存在' });
        const valid = await getAsync(`SELECT id FROM email_verification_codes WHERE email=? AND purpose='reset' AND code=? AND consumed_at IS NULL AND DATETIME(expires_at) > DATETIME('now') ORDER BY created_at DESC`, [email, code]);
        if (!valid) return res.status(400).json({ error: '验证码无效或已过期' });
        const hash = bcrypt.hashSync(new_password, 10);
        await runAsync('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version,0) + 1 WHERE lower(email) = lower(?)', [hash, email]);
        await runAsync('UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [valid.id]);
        return res.json({ message: '密码已重置' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '重置失败' });
    }
});

// 用户 token 校验
app.get('/api/user/verify', authenticateUserToken, (req, res) => {
    res.json({ valid: true, user: { id: req.user.id, username: req.user.username } });
});

// 新增：账号存在性检查（identifier 可为用户名或邮箱）
app.post('/api/user/exist', requireCaptchaIfFlagged, async (req, res) => {
    try {
        const { identifier } = req.body || {};
        if (!identifier || typeof identifier !== 'string') {
            return res.status(400).json({ error: '参数错误' });
        }
        const val = identifier.trim();
        let exists = false;
        let type = '';
        if (/@/.test(val)) {
            const row = await getAsync('SELECT id FROM users WHERE lower(email)=lower(?)', [val]);
            exists = !!row; type = 'email';
        } else {
            const row = await getAsync('SELECT id FROM users WHERE lower(username)=lower(?)', [val]);
            exists = !!row; type = 'username';
        }
        return res.json({ exists, type });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '检查失败' });
    }
});

// 新增：用户自助注销（删除账号）
app.delete('/api/user/me', authenticateUserToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const u = await getAsync('SELECT email FROM users WHERE id = ?', [userId]);
        await runAsync('DELETE FROM users WHERE id = ?', [userId]);
        if (u && u.email) {
            try { await runAsync('DELETE FROM email_verification_codes WHERE email = ?', [u.email]); } catch {}
        }
        return res.json({ message: '账号已注销' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '注销失败' });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// HLS代理接口 - 现状保持（不纳入字幕保护范围）
app.get('/api/hls', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: '缺少url参数' });
    }

    // 统一的"仅发送一次"守护
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

    // 处理可能的"嵌套代理"：url=http://<self>/api/hls?url=<real>
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

// 统一 no-store 帮助函数
function setNoStore(res){ try { res.set('Cache-Control','no-store'); } catch {} }

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
            { id: user.id, username: user.username, role: 'admin' },
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

// 验证token（管理员）
app.get('/api/auth/verify', authenticateAdminToken, (req, res) => {
    res.json({ 
        valid: true, 
        user: {
            id: req.user.id,
            username: req.user.username
        }
    });
});

// 获取字幕文件（登录可见：用户或管理员）
app.get('/api/subtitle/:video_id', authenticateAnyToken, async (req, res) => {
    const videoId = req.params.video_id;
    setNoStore(res);
    
    db.get('SELECT * FROM subtitles WHERE lower(video_id) = lower(?)', [videoId], async (err, subtitle) => {
        if (err) {
            return res.status(500).json({ error: '数据库错误' });
        }
        
        if (!subtitle) {
            return res.status(404).json({ error: '字幕文件不存在' });
        }
        
        // 限流与扫描（用户+IP）
        const userId = req.user && req.user.id ? String(req.user.id) : '';
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        // 用户 5 分钟突发桶
        if (!allowSubtitleUser(userId)) { await markCaptchaRequired('user', userId); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        // IP 突发 + 1小时桶
        if (!allowSubtitleIp10m(ip) || !allowSubtitleIp1h(ip)) { await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        // 扫描阈值与降配（10 分钟窗口 + 阈值）
        await addScan(userId, 'video', videoId.toUpperCase(), 10*60, RATE.SCAN_UNIQUE_VIDEO_10MIN);
        if (await isPenalized(userId)) {
            // 简单降配：再次消耗一次用户桶，若失败则限流
            if (!allowSubtitleUser(userId)) { await markCaptchaRequired('user', userId); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        }
        
        try {
            const filePath = path.join(__dirname, '../uploads', path.basename(subtitle.file_path));
            const raw = await fs.readFile(filePath);
            let textUtf8 = '';
            const enc = chardet.detect(raw) || 'UTF-8';
            textUtf8 = /utf-8/i.test(enc) ? raw.toString('utf8') : iconv.decode(raw, enc);

            // 统一转为 VTT
            const ext = path.extname(subtitle.filename).toLowerCase();
            let vtt = '';
            if (ext === '.vtt') {
                vtt = textUtf8.startsWith('WEBVTT') ? textUtf8 : `WEBVTT\n\n${textUtf8}`;
            } else {
                vtt = convertSrtToVttString(textUtf8);
            }
            // 注入水印
            vtt = injectVttWatermark(vtt, { userId, videoId });
            res.set('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(vtt);
        } catch (error) {
            return res.status(500).json({ error: '读取字幕文件失败' });
        }
    });
});

// 上传字幕文件 (需要认证)
app.post('/api/subtitle/:video_id', authenticateAdminToken, upload.single('subtitle'), async (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase();
    const file = req.file;
    
    if (!file) {
        return res.status(400).json({ error: '请选择字幕文件' });
    }

    // 处理编码与转码：ASS/SSA 转 VTT，其它字幕统一存为 UTF-8
    // 现上传阶段生成的是临时名，把它解析/转码到目标文件名之前，先保留原始路径
    const uploadsDir = path.join(__dirname, '../uploads');
    const tempInputPath = path.join(uploadsDir, file.filename);
    let saveFilename = file.filename; // 将被置为最终文件名
    let saveSize = file.size;
    try {
        const originalExt = path.extname(file.originalname).toLowerCase();
        if (originalExt === '.ass' || originalExt === '.ssa') {
            const rawBuf = await fs.readFile(tempInputPath);
            const rawText = await detectAndDecodeToUtf8(rawBuf);
            const vtt = await convertAssToVttString(rawText);
            const outputFilename = `${videoId}.vtt`;
            const outputPath = path.join(uploadsDir, outputFilename);
            await fs.writeFile(outputPath, vtt, 'utf-8');
            // 删除原始文件
            try { await fs.unlink(tempInputPath); } catch {}
            const stat = await fs.stat(outputPath);
            saveFilename = outputFilename;
            saveSize = stat.size;
        } else {
            // 对 .srt/.vtt：仅在非 UTF-8 时转为 UTF-8 保存
            const rawBuf = await fs.readFile(tempInputPath);
            const detected = chardet.detect(rawBuf) || 'UTF-8';
            const enc = (Array.isArray(detected) ? detected[0] : detected) || 'UTF-8';
            if (!/utf-8/i.test(enc)) {
                const decoded = iconv.encodingExists(enc) ? iconv.decode(rawBuf, enc) : rawBuf.toString('utf8');
                await fs.writeFile(tempInputPath, decoded, 'utf-8');
            }
            const stat = await fs.stat(tempInputPath);
            saveSize = stat.size;
        }
    } catch (e) {
        return res.status(500).json({ error: '字幕转码失败（ASS/SSA→VTT）' });
    }
    
    // 计算内容哈希并去重
    const filePathFinal = path.join(__dirname, '../uploads', saveFilename);
    let fileTextForHash = '';
    try {
        const buf = await fs.readFile(filePathFinal);
        const enc = chardet.detect(buf) || 'UTF-8';
        fileTextForHash = /utf-8/i.test(enc) ? buf.toString('utf8') : iconv.decode(buf, enc);
    } catch (e) {}
    const contentHash = computeContentHash(fileTextForHash);

    // 冲突：若内容哈希已存在则拒绝（并清理已落盘文件）
    const dup = await getAsync('SELECT video_id FROM subtitles WHERE content_hash = ?', [contentHash]);
    if (dup) {
        try { await fs.unlink(filePathFinal); } catch {}
        return res.status(409).json({ error: '内容重复，已存在字幕', exists_video_id: dup.video_id });
    }

    // 分配基础编号与变体
    const baseVideoId = extractBaseVideoId(videoId.toUpperCase());
    const { finalVideoId, variant } = await allocateVariantForBase(baseVideoId);

    // 文件名与编号对齐：重命名为 finalVideoId + 原扩展名
    const extOut = path.extname(saveFilename).toLowerCase();
    const desiredName = `${finalVideoId}${extOut}`;
    const desiredPath = path.join(uploadsDir, desiredName);

    try {
        // 若当前还是临时名（ASS/SSA 已写入目标名时 saveFilename 已变更），移动到最终名
        if (path.basename(filePathFinal) !== desiredName) {
            await moveFileSafe(filePathFinal, desiredPath);
        }
        const stat = await fs.stat(desiredPath);
        saveFilename = desiredName;
        saveSize = stat.size;
    } catch (e) {
        // 文件未能写入最终路径，视为失败，确保不落数据库
        try { await fs.unlink(filePathFinal); } catch {}
        return res.status(500).json({ error: '保存字幕文件失败' });
    }

    const originalFilename = file.originalname || saveFilename;

    const insertOrUpdate = `INSERT OR REPLACE INTO subtitles 
        (video_id, base_video_id, variant, filename, file_path, file_size, original_filename, content_hash, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;
    
    db.run(insertOrUpdate, [
        finalVideoId,
        baseVideoId,
        variant,
        saveFilename,
        saveFilename,
        saveSize,
        originalFilename,
        contentHash
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: '数据库保存失败' });
        }
        
                        res.json({
                    message: '字幕文件上传成功',
                    subtitle: {
                        video_id: finalVideoId,
                        base_video_id: baseVideoId,
                        variant: variant,
                        filename: saveFilename,
                        size: saveSize,
                        content_hash: contentHash,
                        original_filename: originalFilename
                    }
                });
    });
});

// 更新字幕文件 (需要认证)
app.put('/api/subtitle/:video_id', authenticateAdminToken, upload.single('subtitle'), async (req, res) => {
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
        
        // 处理编码与转码：ASS/SSA 转 VTT，其它字幕统一存为 UTF-8
        const uploadsDir = path.join(__dirname, '../uploads');
        const tempInputPath = path.join(uploadsDir, file.filename);
        let saveFilename = file.filename;
        let saveSize = file.size;
        try {
            const originalExt = path.extname(file.originalname).toLowerCase();
            if (originalExt === '.ass' || originalExt === '.ssa') {
                const rawBuf = await fs.readFile(tempInputPath);
                const rawText = await detectAndDecodeToUtf8(rawBuf);
                const vtt = await convertAssToVttString(rawText);
                const outputFilename = `${videoId}.vtt`;
                const outputPath = path.join(uploadsDir, outputFilename);
                await fs.writeFile(outputPath, vtt, 'utf-8');
                try { await fs.unlink(tempInputPath); } catch {}
                const stat = await fs.stat(outputPath);
                saveFilename = outputFilename;
                saveSize = stat.size;
            } else {
                // 对 .srt/.vtt：仅在非 UTF-8 时转为 UTF-8 保存
                const rawBuf = await fs.readFile(tempInputPath);
                const detected = chardet.detect(rawBuf) || 'UTF-8';
                const enc = (Array.isArray(detected) ? detected[0] : detected) || 'UTF-8';
                if (!/utf-8/i.test(enc)) {
                    const decoded = iconv.encodingExists(enc) ? iconv.decode(rawBuf, enc) : rawBuf.toString('utf8');
                    await fs.writeFile(tempInputPath, decoded, 'utf-8');
                }
                const stat = await fs.stat(tempInputPath);
                saveSize = stat.size;
            }
        } catch (e) {
            return res.status(500).json({ error: '字幕转码失败（ASS/SSA→VTT）' });
        }
        
        // 计算内容哈希并去重
        const filePathFinal = path.join(__dirname, '../uploads', saveFilename);
        let fileTextForHash = '';
        try {
            const buf = await fs.readFile(filePathFinal);
            const enc = chardet.detect(buf) || 'UTF-8';
            fileTextForHash = /utf-8/i.test(enc) ? buf.toString('utf8') : iconv.decode(buf, enc);
        } catch (e) {}
        const contentHash = computeContentHash(fileTextForHash);
        const dup = await getAsync('SELECT video_id FROM subtitles WHERE content_hash = ? AND lower(video_id) <> lower(?)', [contentHash, videoId]);
        if (dup) {
            try { await fs.unlink(filePathFinal); } catch {}
            return res.status(409).json({ error: '内容重复，已存在字幕', exists_video_id: dup.video_id });
        }

        const originalFilename = file.originalname || saveFilename;

        // 更新记录
        db.run(`UPDATE subtitles SET 
            filename = ?, file_path = ?, file_size = ?, content_hash = ?, original_filename = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE lower(video_id) = lower(?)`, 
            [saveFilename, saveFilename, saveSize, contentHash, originalFilename, videoId], 
            function(err) {
                if (err) {
                    return res.status(500).json({ error: '数据库更新失败' });
                }
                
                res.json({
                    message: '字幕文件更新成功',
                    subtitle: {
                        video_id: videoId,
                        filename: saveFilename,
                        size: saveSize,
                        content_hash: contentHash,
                        original_filename: originalFilename
                    }
                });
            }
        );
    });
});

// 删除字幕文件 (需要认证)
app.delete('/api/subtitle/:video_id', authenticateAdminToken, (req, res) => {
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
app.get('/api/subtitles', authenticateAdminToken, (req, res) => {
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
app.delete('/api/subtitles', authenticateAdminToken, async (req, res) => {
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
app.get('/api/subtitles/stats', authenticateAdminToken, async (req, res) => {
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

// 获取某基础视频编号下的所有字幕变体（登录可见：用户或管理员）
app.get('/api/subtitles/variants/:base_video_id', authenticateAnyToken, async (req, res) => {
    setNoStore(res);
    const baseId = (req.params.base_video_id || '').toUpperCase();
    try {
        // 限流与扫描（用户+IP）
        const userId = req.user && req.user.id ? String(req.user.id) : '';
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        if (!allowVariantsUser(userId)) { await markCaptchaRequired('user', userId); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        if (!allowVariantsIp10m(ip) || !allowVariantsIp1h(ip)) { await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        await addScan(userId, 'base', baseId, 10*60, RATE.SCAN_UNIQUE_BASE_10MIN);
        if (await isPenalized(userId)) {
            if (!allowVariantsUser(userId)) { await markCaptchaRequired('user', userId); await markCaptchaRequired('ip', ip); return res.status(429).json({ error: '请求过于频繁', requireCaptcha: true }); }
        }

        const rows = await getAllAsync(
            'SELECT video_id, base_video_id, variant, filename, file_size, updated_at FROM subtitles WHERE lower(base_video_id) = lower(?) ORDER BY COALESCE(variant,1) ASC, updated_at DESC',
            [baseId]
        );
        res.json({ base: extractBaseVideoId(baseId), variants: rows });
    } catch (e) {
        res.status(500).json({ error: '获取字幕变体失败' });
    }
});

// 管理员用户管理
app.get('/api/admin/users/stats', authenticateAdminToken, async (req, res) => {
    try {
        const row = await getAsync('SELECT COUNT(*) AS total FROM users', []);
        res.json({ total: row?.total || 0 });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '获取用户统计失败' });
    }
});

app.get('/api/admin/users', authenticateAdminToken, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = (req.query.search || '').trim();
        const offset = (page - 1) * limit;
        const where = search ? 'WHERE username LIKE ? OR email LIKE ?' : '';
        const params = search ? [`%${search}%`, `%${search}%`] : [];
        const count = await getAsync(`SELECT COUNT(*) AS total FROM users ${where}`, params);
        const list = await getAllAsync(`SELECT id, username, email, created_at, last_login_at, status FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        res.json({ data: list, pagination: { page, limit, total: count?.total || 0, totalPages: Math.ceil((count?.total||0)/limit) } });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

app.delete('/api/admin/users/:id', authenticateAdminToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ error: '参数错误' });
        await runAsync('DELETE FROM users WHERE id = ?', [id]);
        res.json({ message: '删除成功' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: '删除用户失败' });
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