require('dotenv').config();
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

// 信任反向代理，确保能正确获取客户端协议（HTTPS）
app.set('trust proxy', true);

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

// 简化限流系统配置
const SIMPLE_RATE_LIMITS = {
    LOGIN_IP_PER_MIN: Number(process.env.RL_LOGIN_IP_PER_MIN || 20),
    LOGIN_ACCOUNT_PER_MIN: Number(process.env.RL_LOGIN_ACCOUNT_PER_MIN || 5),
    EMAIL_CODE_EMAIL_COOLDOWN_SEC: Number(process.env.RL_EMAIL_CODE_EMAIL_COOLDOWN_SEC || 30),
    EMAIL_CODE_EMAIL_PER_10MIN: Number(process.env.RL_EMAIL_CODE_EMAIL_PER_10MIN || 5),
    EMAIL_CODE_EMAIL_PER_HOUR: Number(process.env.RL_EMAIL_CODE_EMAIL_PER_HOUR || 10),
    EMAIL_CODE_IP_PER_HOUR: Number(process.env.RL_EMAIL_CODE_IP_PER_HOUR || 20),
    REGISTER_IP_PER_10MIN: Number(process.env.RL_REGISTER_IP_PER_10MIN || 5),
    REGISTER_IP_PER_HOUR: Number(process.env.RL_REGISTER_IP_PER_HOUR || 20),
    REGISTER_EMAIL_PER_HOUR: Number(process.env.RL_REGISTER_EMAIL_PER_HOUR || 3)
};

// 固定窗口计数器
async function fixedWindowLimiter(scopeKey, windowSec, limit) {
    try {
        if (!redis) {
            // 内存回退
            const memoryCounters = fixedWindowLimiter._memoryCounters = fixedWindowLimiter._memoryCounters || new Map();
            const now = Math.floor(Date.now() / 1000);
            const windowStart = Math.floor(now / windowSec) * windowSec;
            const key = `${scopeKey}:${windowStart}`;
            const current = memoryCounters.get(key) || 0;
            if (current >= limit) {
                return { allowed: false, remaining: 0, resetTime: (windowStart + windowSec) * 1000 };
            }
            memoryCounters.set(key, current + 1);
            // 清理过期的计数器
            for (const [k] of memoryCounters) {
                const keyWindowStart = parseInt(k.split(':').pop());
                if (keyWindowStart < windowStart - windowSec) {
                    memoryCounters.delete(k);
                }
            }
            return { allowed: true, remaining: limit - current - 1, resetTime: (windowStart + windowSec) * 1000 };
        }
        
        const now = Math.floor(Date.now() / 1000);
        const windowStart = Math.floor(now / windowSec) * windowSec;
        const key = `rl:fw:${scopeKey}:${windowStart}`;
        
        const current = await redis.incr(key);
        if (current === 1) {
            await redis.expire(key, windowSec);
        }
        
        const allowed = current <= limit;
        const remaining = Math.max(0, limit - current);
        const resetTime = (windowStart + windowSec) * 1000;
        
        return { allowed, remaining, resetTime };
    } catch (error) {
        console.warn('fixedWindowLimiter error:', error.message);
        return { allowed: true, remaining: 999, resetTime: Date.now() + windowSec * 1000 };
    }
}

// 单键冷却（硬冷却）
async function singleKeyCooldown(scopeKey, windowSec) {
    try {
        if (!redis) {
            // 内存回退
            const memoryCooldowns = singleKeyCooldown._memoryCooldowns = singleKeyCooldown._memoryCooldowns || new Map();
            const now = Date.now();
            const lastTime = memoryCooldowns.get(scopeKey) || 0;
            if (now - lastTime < windowSec * 1000) {
                return { allowed: false, retryAfter: Math.ceil((lastTime + windowSec * 1000 - now) / 1000) };
            }
            memoryCooldowns.set(scopeKey, now);
            return { allowed: true, retryAfter: 0 };
        }
        
        const key = `rl:cd:${scopeKey}`;
        const result = await redis.set(key, '1', 'EX', windowSec, 'NX');
        
        if (result === 'OK') {
            return { allowed: true, retryAfter: 0 };
        } else {
            const ttl = await redis.ttl(key);
            return { allowed: false, retryAfter: Math.max(1, ttl) };
        }
    } catch (error) {
        console.warn('singleKeyCooldown error:', error.message);
        return { allowed: true, retryAfter: 0 };
    }
}

// 统一限流中间件
function createRateLimit(rules) {
    return async (req, res, next) => {
        try {
            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const email = req.body?.email ? String(req.body.email).toLowerCase() : null;
            const account = email; // 可以扩展为用户名或其他标识
            
            const checks = [];
            let retryAfter = 0;
            let scope = 'unknown';
            
            for (const rule of rules) {
                let key;
                switch (rule.key) {
                    case 'ip': key = `ip:${ip}`; break;
                    case 'email': key = email ? `email:${email}` : null; break;
                    case 'account': key = account ? `account:${account}` : null; break;
                    default: continue;
                }
                
                if (!key) continue;
                
                if (rule.type === 'cooldown') {
                    const result = await singleKeyCooldown(key, rule.window);
                    if (!result.allowed) {
                        retryAfter = Math.max(retryAfter, result.retryAfter);
                        scope = rule.key;
                    }
                    checks.push({ rule, result });
                } else {
                    const result = await fixedWindowLimiter(key, rule.window, rule.limit);
                    if (!result.allowed) {
                        retryAfter = Math.max(retryAfter, Math.ceil((result.resetTime - Date.now()) / 1000));
                        scope = rule.key;
                    }
                    checks.push({ rule, result });
                }
            }
            
            // 如果任何检查失败，返回429
            if (retryAfter > 0) {
                res.set('Retry-After', retryAfter.toString());
                return res.status(429).json({
                    code: 'RATE_LIMITED',
                    scope: scope,
                    retry_after: retryAfter,
                    error: `请求过于频繁，请等待 ${retryAfter} 秒后重试`
                });
            }
            
            next();
        } catch (error) {
            console.warn('Rate limit middleware error:', error.message);
            next(); // 出错时不阻断请求
        }
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

// 新的简化限流中间件
const loginRateLimit = createRateLimit([
    { key: 'ip', type: 'window', window: 60, limit: SIMPLE_RATE_LIMITS.LOGIN_IP_PER_MIN },
    { key: 'account', type: 'window', window: 60, limit: SIMPLE_RATE_LIMITS.LOGIN_ACCOUNT_PER_MIN }
]);

const emailCodeRateLimit = createRateLimit([
    { key: 'email', type: 'cooldown', window: SIMPLE_RATE_LIMITS.EMAIL_CODE_EMAIL_COOLDOWN_SEC },
    { key: 'email', type: 'window', window: 600, limit: SIMPLE_RATE_LIMITS.EMAIL_CODE_EMAIL_PER_10MIN },
    { key: 'email', type: 'window', window: 3600, limit: SIMPLE_RATE_LIMITS.EMAIL_CODE_EMAIL_PER_HOUR },
    { key: 'ip', type: 'window', window: 3600, limit: SIMPLE_RATE_LIMITS.EMAIL_CODE_IP_PER_HOUR }
]);

const registerRateLimit = createRateLimit([
    { key: 'ip', type: 'window', window: 600, limit: SIMPLE_RATE_LIMITS.REGISTER_IP_PER_10MIN },
    { key: 'ip', type: 'window', window: 3600, limit: SIMPLE_RATE_LIMITS.REGISTER_IP_PER_HOUR },
    { key: 'email', type: 'window', window: 3600, limit: SIMPLE_RATE_LIMITS.REGISTER_EMAIL_PER_HOUR }
]);

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
// 邮件发送功能已移除，改为控制台打印验证码

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

// 统一清理用户相关数据的函数（方案A：显式事务 + 精确回填计数）
async function deleteUserDataCascade(userId) {
    return new Promise((resolve, reject) => {
        // 开始显式事务
        db.run('BEGIN IMMEDIATE', (err) => {
            if (err) {
                console.error('开始事务失败:', err);
                return reject(err);
            }
            
            // 在事务中执行所有操作
            (async () => {
                try {
                    // 1. 查询用户点赞过的所有字幕 video_id（去重）
                    const userSubtitleLikes = await getAllAsync(
                        'SELECT DISTINCT video_id FROM subtitle_likes WHERE user_id = ?', 
                        [userId]
                    );
                    
                    // 2. 查询用户点赞过的所有评论 comment_id（去重）
                    const userCommentLikes = await getAllAsync(
                        'SELECT DISTINCT comment_id FROM comment_likes WHERE user_id = ?', 
                        [userId]
                    );
                    
                    // 3. 查询用户发出的回复评论的父评论 id（去重）
                    const affectedParentComments = await getAllAsync(
                        'SELECT DISTINCT parent_id FROM subtitle_comments WHERE user_id = ? AND parent_id IS NOT NULL', 
                        [userId]
                    );
                    
                    // 4. 删除用户的字幕点赞记录
                    await runAsync('DELETE FROM subtitle_likes WHERE user_id = ?', [userId]);
                    
                    // 5. 删除用户的评论点赞记录
                    await runAsync('DELETE FROM comment_likes WHERE user_id = ?', [userId]);
                    
                    // 6. 删除用户的所有评论（包括顶级评论和回复）
                    await runAsync('DELETE FROM subtitle_comments WHERE user_id = ?', [userId]);
                    
                    // 7. 删除用户的心愿单记录
                    await runAsync('DELETE FROM wishlists WHERE user_id = ?', [userId]);
                    
                    // 8. 精确回填字幕点赞数（使用大小写不敏感匹配）
                    for (const like of userSubtitleLikes) {
                        const actualCount = await getAsync(
                            'SELECT COUNT(1) as count FROM subtitle_likes WHERE lower(video_id) = lower(?)',
                            [like.video_id]
                        );
                        await runAsync(
                            'UPDATE subtitles SET likes_count = ? WHERE lower(video_id) = lower(?)',
                            [actualCount.count || 0, like.video_id]
                        );
                    }
                    
                    // 9. 精确回填评论点赞数
                    for (const like of userCommentLikes) {
                        const actualCount = await getAsync(
                            'SELECT COUNT(1) as count FROM comment_likes WHERE comment_id = ?',
                            [like.comment_id]
                        );
                        await runAsync(
                            'UPDATE subtitle_comments SET likes_count = ? WHERE id = ?',
                            [actualCount.count || 0, like.comment_id]
                        );
                    }
                    
                    // 10. 精确回填父评论的回复数
                    for (const parent of affectedParentComments) {
                        const actualCount = await getAsync(
                            'SELECT COUNT(1) as count FROM subtitle_comments WHERE parent_id = ?',
                            [parent.parent_id]
                        );
                        await runAsync(
                            'UPDATE subtitle_comments SET replies_count = ? WHERE id = ?',
                            [actualCount.count || 0, parent.parent_id]
                        );
                    }
                    
                    // 11. 获取用户邮箱用于清理验证码
                    const user = await getAsync('SELECT email FROM users WHERE id = ?', [userId]);
                    
                    // 12. 删除用户主记录
                    await runAsync('DELETE FROM users WHERE id = ?', [userId]);
                    
                    // 13. 清理邮箱验证码记录
                    if (user && user.email) {
                        try {
                            await runAsync('DELETE FROM email_verification_codes WHERE email = ?', [user.email]);
                        } catch (e) {
                            console.warn('清理邮箱验证码失败:', e.message);
                        }
                    }
                    
                    // 提交事务
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                            console.error('提交事务失败:', commitErr);
                            return reject(commitErr);
                        }
                        resolve();
                    });
                    
                } catch (error) {
                    console.error('删除用户数据失败:', error);
                    // 回滚事务
                    db.run('ROLLBACK', (rollbackErr) => {
                        if (rollbackErr) {
                            console.error('回滚事务失败:', rollbackErr);
                        }
                        reject(error);
                    });
                }
            })();
        });
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
    // SQLite 基础设置
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA busy_timeout=5000');

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
    
    // 新增：为 subtitles 表补充 likes_count 列
    db.run('ALTER TABLE subtitles ADD COLUMN likes_count INTEGER DEFAULT 0', () => {});
    
    // 新增：字幕点赞表
    db.run(`CREATE TABLE IF NOT EXISTS subtitle_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    
    // 为 subtitle_likes 表创建唯一索引，确保一个用户对一个字幕版本只能点赞一次
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitle_likes_user_video ON subtitle_likes(user_id, video_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_likes_video ON subtitle_likes(video_id)', () => {});
    
    // 新增：心愿单表
    db.run(`CREATE TABLE IF NOT EXISTS wishlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        base_video_id TEXT NOT NULL,
        note TEXT,
        status TEXT NOT NULL DEFAULT '未更新',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK (status IN ('未更新','已更新')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlists_user_base ON wishlists(user_id, base_video_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_wishlists_user ON wishlists(user_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_wishlists_base ON wishlists(base_video_id)', () => {});
    
    // 新增：字幕评论表
    db.run(`CREATE TABLE IF NOT EXISTS subtitle_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp REAL NOT NULL,
        parent_id INTEGER NULL,
        likes_count INTEGER DEFAULT 0,
        replies_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'approved',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES subtitle_comments(id) ON DELETE CASCADE,
        CHECK (status IN ('pending', 'approved', 'rejected', 'deleted'))
    )`);
    
    // 为 subtitle_comments 表创建索引
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_comments_video ON subtitle_comments(video_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_comments_timestamp ON subtitle_comments(timestamp)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_comments_user ON subtitle_comments(user_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_comments_parent ON subtitle_comments(parent_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_subtitle_comments_created ON subtitle_comments(created_at DESC)', () => {});
    
    // 新增：评论点赞表
    db.run(`CREATE TABLE IF NOT EXISTS comment_likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        comment_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (comment_id) REFERENCES subtitle_comments(id) ON DELETE CASCADE
    )`);
    
    // 为 comment_likes 表创建唯一索引，确保一个用户对一个评论只能点赞一次
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_likes_user_comment ON comment_likes(user_id, comment_id)', () => {});
    db.run('CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id)', () => {});
    
    // 创建默认管理员账号 (用户名: admin, 密码: admin123)
    const defaultPassword = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO admins (username, password_hash) VALUES (?, ?)`, 
        ['admin', defaultPassword]);
});

// 中间件
// 安全响应头
app.use(helmet());
// CORS 白名单（默认放行本地开发域名和生产环境）
const defaultCors = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://player.sub-dog.top',
    'https://api.sub-dog.top'
];
const corsList = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = new Set((corsList.length ? corsList : defaultCors));
app.use(cors({
    origin(origin, cb) {
        if (!origin) return cb(null, true); // 允许无 Origin（如本地文件、某些应用内 WebView）
        if (allowedOrigins.has(origin)) return cb(null, true);
        // 允许 *.sub-dog.top 通配（手动判断）
        try {
            const url = new URL(origin);
            const host = url.hostname;
            if (host.endsWith('.sub-dog.top') || host === 'sub-dog.top') {
                return cb(null, true);
            }
        } catch {}
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET','HEAD','PUT','PATCH','POST','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Range','x-captcha-token','x-require-captcha'],
    exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（用于提供字幕文件）
// 为 /uploads 路由设置跨源资源策略，允许跨源嵌入
app.use('/uploads', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static(path.join(__dirname, '../uploads')));

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
app.post('/api/user/email-code', requireCaptchaIfFlagged, emailCodeRateLimit, async (req, res) => {
    try {
        const { email, purpose } = req.body || {};
        if (!email || !purpose || !['register','login','reset'].includes(purpose)) {
            return res.status(400).json({ error: '参数错误' });
        }
        
        const code = Math.floor(100000 + Math.random()*900000).toString();
        const expiresAt = new Date(Date.now()+5*60000).toISOString();
        await runAsync(`INSERT INTO email_verification_codes (email, code, purpose, expires_at, request_ip) VALUES (?,?,?,?,?)`, 
            [email, code, purpose, expiresAt, req.ip || '']);
        
        console.log(`[EmailCode] purpose=${purpose} email=${email} code=${code}`);
        return res.json({ message:'验证码已发送' });
    } catch (e) { 
        console.error(e); 
        return res.status(500).json({ error: '发送验证码失败' }); 
    }
});

async function consumeValidCode(email, purpose, code) {
    const row = await getAsync(`SELECT * FROM email_verification_codes WHERE email=? AND purpose=? AND code=? AND consumed_at IS NULL AND DATETIME(expires_at) > DATETIME('now') ORDER BY created_at DESC`, [email, purpose, code]);
    if (!row) return false;
    await runAsync(`UPDATE email_verification_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
    return true;
}

// 用户注册（返回token，但前端不自动登录）
app.post('/api/user/register', requireCaptchaIfFlagged, registerRateLimit, async (req, res) => {
    try {
        const { username, email, password, code } = req.body || {};
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
app.post('/api/user/login/password', requireCaptchaIfFlagged, loginRateLimit, async (req, res) => {
    try {
        const { email, password } = req.body || {};
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
app.get('/api/user/verify', authenticateUserToken, async (req, res) => {
    try {
        const user = await getAsync('SELECT id, username, email FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }
        res.json({ valid: true, user: { id: user.id, username: user.username, email: user.email } });
    } catch (error) {
        console.error('获取用户信息失败:', error);
        res.status(500).json({ error: '获取用户信息失败' });
    }
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
        await deleteUserDataCascade(userId);
        return res.json({ message: '账号已注销' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '注销失败' });
    }
});

// 图片上传配置
const imageStorage = multer.memoryStorage();
const imageUpload = multer({
    storage: imageStorage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传 jpg、png、gif、webp 格式的图片'));
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB 限制
    }
});

// 图片上传接口
app.post('/api/upload/image', authenticateToken, imageUpload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请选择要上传的图片' });
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        
        // 创建目录结构
        const uploadDir = path.join(__dirname, '../uploads/images', year.toString(), month);
        await fs.mkdir(uploadDir, { recursive: true });
        
        // 生成唯一文件名
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
        const filePath = path.join(uploadDir, filename);
        
        // 保存文件
        await fs.writeFile(filePath, req.file.buffer);
        
        // 构造完整的绝对URL
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const imageUrl = `${baseUrl}/uploads/images/${year}/${month}/${filename}`;
        res.json({ 
            message: '图片上传成功', 
            url: imageUrl,
            filename: filename
        });
        
    } catch (error) {
        console.error('图片上传失败:', error);
        if (error.message.includes('只允许上传')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: '图片上传失败' });
    }
 });
 
 // 用户搜索接口
 app.get('/api/users/search', authenticateToken, async (req, res) => {
     try {
         const { username } = req.query;
         
         if (!username || typeof username !== 'string') {
             return res.status(400).json({ error: '请提供用户名搜索参数' });
         }
         
         const searchTerm = username.trim();
         if (searchTerm.length === 0) {
             return res.json({ users: [] });
         }
         
         // 搜索用户名包含关键词的用户，限制返回数量
        const users = await getAllAsync(
            `SELECT id, username FROM users 
             WHERE username LIKE ? 
             ORDER BY username 
             LIMIT 20`,
            [`%${searchTerm}%`]
        );
         
         res.json({ users });
         
     } catch (error) {
         console.error('用户搜索失败:', error);
         res.status(500).json({ error: '用户搜索失败' });
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
                // 计算代理源，优先 X-Forwarded-Proto/Host，避免HTTPS场景被降级为http
                const fProtoHdr = (req.headers['x-forwarded-proto'] || '').toString();
                const forwardedProto = fProtoHdr.split(',')[0].trim().toLowerCase();
                const fHostHdr = (req.headers['x-forwarded-host'] || '').toString();
                const forwardedHost = fHostHdr.split(',')[0].trim();
                const host = forwardedHost || req.get('host');
                const scheme = forwardedProto
                    ? (forwardedProto === 'https' ? 'https' : 'http')
                    : (req.secure ? 'https' : (req.protocol === 'https' ? 'https' : 'http'));
                const proxyOrigin = `${scheme}://${host}`;

                const rewritten = rewriteM3U8(raw, targetUrl, proxyOrigin);
                safeSet('Cache-Control', 'no-store');
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

    // 当前代理主机名，用于识别并解包已经被代理过的URL，避免二次包裹
    let proxyHost = '';
    try { proxyHost = new URL(proxyOrigin).host; } catch { proxyHost = ''; }

    // 递归解包已代理的URL，确保获得原始URL
    function recursivelyUnwrapProxiedUrl(url) {
        let current = url;
        let maxDepth = 10; // 防止无限循环
        
        while (maxDepth-- > 0) {
            try {
                const u = new URL(current);
                // 检查是否为我们的代理URL
                if (u.pathname === '/api/hls' && u.searchParams.has('url')) {
                    // 如果有proxyHost限制，检查host匹配；否则只要路径和参数匹配就解包
                    if (!proxyHost || u.host === proxyHost) {
                        const innerUrl = decodeURIComponent(u.searchParams.get('url') || '');
                        if (innerUrl && innerUrl !== current) {
                            current = innerUrl;
                            continue; // 继续解包
                        }
                    }
                }
                break; // 不是代理URL或无法再解包，退出循环
            } catch {
                break; // URL解析失败，退出循环
            }
        }
        
        return current;
    }

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
                        // 递归解包嵌套代理URL
                        const target = recursivelyUnwrapProxiedUrl(g1);
                        const abs = new URL(target, baseUrl).href;
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
            // 递归解包嵌套代理URL
            const target = recursivelyUnwrapProxiedUrl(trimmed);
            const absolute = new URL(target, baseUrl).href;
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

// 批量上传字幕文件 (管理员权限)
app.post('/api/admin/subtitles/batch-upload', authenticateAdminToken, upload.array('files', 50), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: '请选择要上传的字幕文件' });
        }

        if (files.length > 50) {
            return res.status(400).json({ error: '单次最多上传50个文件' });
        }

        const results = {
            success: [],
            failed: [],
            skipped: []
        };

        // 文件名校验正则：视频编号.扩展名格式
        const filenameRegex = /^([A-Za-z0-9\-_]+)\.(srt|vtt|ass|ssa)$/i;
        
        for (const file of files) {
            const originalName = file.originalname;
            const match = originalName.match(filenameRegex);
            
            if (!match) {
                results.failed.push({
                    filename: originalName,
                    error: '文件名格式不正确，应为：视频编号.扩展名'
                });
                continue;
            }

            const baseVideoId = extractBaseVideoId(match[1].toUpperCase());
            const extension = match[2].toLowerCase();
            
            try {
                // 读取文件并检测编码，统一解码为 UTF-8 文本（multer 使用 diskStorage，此处需从 file.path 读取）
                const fileBuffer = await fs.readFile(file.path);
                let content = await detectAndDecodeToUtf8(fileBuffer);
                
                // 统一转换为 VTT
                if (extension === 'ass' || extension === 'ssa') {
                    content = await convertAssToVttString(content);
                } else if (extension === 'srt') {
                    content = convertSrtToVttString(content);
                } // .vtt 直接使用
                
                // 计算内容哈希（标准化后）
                const contentHash = computeContentHash(content);
                
                // 检查是否已存在相同内容的字幕
                const existingSubtitle = await getAsync(
                    'SELECT video_id, base_video_id, variant FROM subtitles WHERE content_hash = ?',
                    [contentHash]
                );
                
                if (existingSubtitle) {
                    results.skipped.push({
                        filename: originalName,
                        reason: `内容重复，已存在相同字幕：${existingSubtitle.video_id}`,
                        existing_video_id: existingSubtitle.video_id
                    });
                    continue;
                }
                
                // 分配变体编号（使用 allocateVariantForBase 返回的 finalVideoId，统一连字符分隔）
                const { finalVideoId, variant } = await allocateVariantForBase(baseVideoId);
                const videoId = finalVideoId;
                
                // 生成文件名
                const filename = `${videoId}.vtt`;
                const filePath = path.join(__dirname, '../uploads', filename);
                
                // 保存文件
                await fs.writeFile(filePath, content, 'utf8');
                
                // 插入数据库记录
                await runAsync(
                    `INSERT INTO subtitles (
                        video_id, base_video_id, variant, filename, file_path, file_size, 
                        content_hash, original_filename, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                    [
                        videoId,
                        baseVideoId, 
                        variant,
                        filename,
                        filePath,
                        Buffer.byteLength(content, 'utf8'),
                        contentHash,
                        originalName
                    ]
                );
                
                // 更新心愿单状态
                await runAsync(
                    `UPDATE wishlists SET status = '已更新', updated_at = datetime('now') 
                     WHERE lower(video_id) = lower(?) AND status != '已更新'`,
                    [baseVideoId]
                );
                
                results.success.push({
                    filename: originalName,
                    video_id: videoId,
                    base_video_id: baseVideoId,
                    variant: variant,
                    file_size: Buffer.byteLength(content, 'utf8')
                });
                
            } catch (error) {
                console.error(`处理文件 ${originalName} 失败:`, error);
                results.failed.push({
                    filename: originalName,
                    error: error.message || '处理文件时发生错误'
                });
            }
        }
        
        // 记录操作日志
        console.log(`管理员批量上传字幕 - 成功: ${results.success.length}, 失败: ${results.failed.length}, 跳过: ${results.skipped.length}`);
        
        res.json({
            message: '批量上传完成',
            summary: {
                total: files.length,
                success: results.success.length,
                failed: results.failed.length,
                skipped: results.skipped.length
            },
            results: results
        });
        
    } catch (error) {
        console.error('批量上传字幕失败:', error);
        res.status(500).json({ error: '批量上传失败' });
    }
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
            'SELECT video_id, base_video_id, variant, filename, file_size, updated_at, likes_count FROM subtitles WHERE lower(base_video_id) = lower(?) ORDER BY COALESCE(variant,1) ASC, updated_at DESC',
            [baseId]
        );
        res.json({ base: extractBaseVideoId(baseId), variants: rows });
    } catch (e) {
        res.status(500).json({ error: '获取字幕变体失败' });
    }
});

// 获取字幕点赞状态（匿名可访问）
app.get('/api/subtitles/like-status/:video_id', authenticateAnyToken, async (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase().trim();
    if (!videoId) {
        return res.status(400).json({ error: '视频ID不能为空' });
    }

    try {
        // 获取字幕的点赞总数
        const subtitle = await getAsync(
            'SELECT likes_count FROM subtitles WHERE lower(video_id) = lower(?)',
            [videoId]
        );
        
        if (!subtitle) {
            return res.status(404).json({ error: '字幕不存在' });
        }

        const likesCount = subtitle.likes_count || 0;
        let isLiked = false;

        // 如果用户已登录，检查是否已点赞
        if (req.user && req.user.id) {
            const userLike = await getAsync(
                'SELECT id FROM subtitle_likes WHERE user_id = ? AND lower(video_id) = lower(?)',
                [req.user.id, videoId]
            );
            isLiked = !!userLike;
        }

        res.json({
            video_id: videoId,
            likes_count: likesCount,
            is_liked: isLiked,
            is_logged_in: !!(req.user && req.user.id)
        });
    } catch (err) {
        console.error('获取点赞状态失败:', err);
        res.status(500).json({ error: '获取点赞状态失败' });
    }
});

// 切换字幕点赞状态（需要登录）
app.post('/api/subtitles/like-toggle/:video_id', authenticateUserToken, async (req, res) => {
    const videoId = (req.params.video_id || '').toLowerCase().trim();
    if (!videoId) {
        return res.status(400).json({ error: '视频ID不能为空' });
    }

    const userId = req.user.id;

    try {
        // 检查字幕是否存在
        const subtitle = await getAsync(
            'SELECT id, likes_count FROM subtitles WHERE lower(video_id) = lower(?)',
            [videoId]
        );
        
        if (!subtitle) {
            return res.status(404).json({ error: '字幕不存在' });
        }

        // 检查用户是否已点赞
        const existingLike = await getAsync(
            'SELECT id FROM subtitle_likes WHERE user_id = ? AND lower(video_id) = lower(?)',
            [userId, videoId]
        );

        let isLiked = false;
        let likesCount = subtitle.likes_count || 0;

        if (existingLike) {
            // 取消点赞
            await runAsync(
                'DELETE FROM subtitle_likes WHERE user_id = ? AND lower(video_id) = lower(?)',
                [userId, videoId]
            );
            likesCount = Math.max(0, likesCount - 1);
            isLiked = false;
        } else {
            // 添加点赞
            await runAsync(
                'INSERT INTO subtitle_likes (user_id, video_id, created_at) VALUES (?, ?, datetime("now"))',
                [userId, videoId]
            );
            likesCount = likesCount + 1;
            isLiked = true;
        }

        // 更新字幕表的点赞计数
        await runAsync(
            'UPDATE subtitles SET likes_count = ? WHERE lower(video_id) = lower(?)',
            [likesCount, videoId]
        );

        res.json({
            video_id: videoId,
            likes_count: likesCount,
            is_liked: isLiked,
            action: isLiked ? 'liked' : 'unliked'
        });
    } catch (err) {
        console.error('切换点赞状态失败:', err);
        res.status(500).json({ error: '切换点赞状态失败' });
    }
});

// 心愿单 API（用户端）
app.get('/api/user/wishlists', authenticateUserToken, async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const cursor = parseInt(req.query.cursor) || 0;
        const params = [userId];
        let sql = `SELECT id, user_id, video_id, base_video_id, note, status, created_at, updated_at FROM wishlists WHERE user_id = ?`;
        if (cursor > 0) { sql += ' AND id < ?'; params.push(cursor); }
        sql += ' ORDER BY id DESC LIMIT ?'; params.push(limit);
        const list = await getAllAsync(sql, params);
        const nextCursor = list.length === limit ? list[list.length - 1].id : null;
        return res.json({ data: list, page: { cursor: cursor || null, limit, next_cursor: nextCursor } });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '获取心愿单失败' });
    }
});

app.post('/api/user/wishlists', authenticateUserToken, async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const { video_id, note } = req.body || {};
        const idRaw = String(video_id || '').toUpperCase().trim();
        const m = idRaw.match(/^([A-Z]+-\d{2,5})(?:-(\d+))?$/);
        if (!m) return res.status(400).json({ error: 'video_id 格式不合法' });
        const baseId = m[1];
        const videoId = idRaw;
        if (typeof note !== 'undefined' && typeof note !== 'string') return res.status(400).json({ error: 'note 格式不合法' });
        const noteTrim = (note || '').trim();
        if (noteTrim.length > 200) return res.status(400).json({ error: '备注过长（最多200字符）' });
        const rl = await fixedWindowLimiter(`wl:add:u:${userId}`, 60, 30);
        if (!rl.allowed) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
        const exists = await getAsync('SELECT id FROM wishlists WHERE user_id = ? AND base_video_id = ?', [userId, baseId]);
        if (exists) return res.status(409).json({ error: '该视频已在心愿单中' });
        await runAsync('INSERT INTO wishlists (user_id, video_id, base_video_id, note, status) VALUES (?,?,?,?,?)', [userId, videoId, baseId, noteTrim || null, '未更新']);
        const row = await getAsync('SELECT id, user_id, video_id, base_video_id, note, status, created_at, updated_at FROM wishlists WHERE id = last_insert_rowid()');
        return res.json({ message: '已添加到心愿单', item: row });
    } catch (e) {
        if (String(e && e.message).includes('UNIQUE')) {
            return res.status(409).json({ error: '该视频已在心愿单中' });
        }
        console.error(e);
        return res.status(500).json({ error: '添加失败' });
    }
});

app.delete('/api/user/wishlists/:id', authenticateUserToken, async (req, res) => {
    try {
        const userId = Number(req.user.id);
        const id = parseInt(req.params.id);
        if (!id) return res.status(400).json({ error: '参数错误' });
        const rl = await fixedWindowLimiter(`wl:del:u:${userId}`, 60, 30);
        if (!rl.allowed) return res.status(429).json({ error: '操作过于频繁，请稍后再试' });
        const row = await getAsync('SELECT id FROM wishlists WHERE id = ? AND user_id = ?', [id, userId]);
        if (!row) return res.status(404).json({ error: '记录不存在' });
        await runAsync('DELETE FROM wishlists WHERE id = ?', [id]);
        return res.json({ message: '删除成功（不会影响后台字幕文件）' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '删除失败' });
    }
});

// 心愿单 API（管理端）
app.get('/api/admin/wishlists', authenticateAdminToken, async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const page = parseInt(req.query.page) || 0;
        const cursor = parseInt(req.query.cursor) || 0;
        const search = (req.query.search || '').trim();
        
        // 页码分页模式
        if (page > 0) {
            const offset = (page - 1) * limit;
            const params = [];
            let sql = `SELECT w.id, w.user_id, u.username, u.email, w.video_id, w.base_video_id, w.note, w.status, w.created_at, w.updated_at FROM wishlists w LEFT JOIN users u ON w.user_id = u.id`;
            let countSql = `SELECT COUNT(1) as total FROM wishlists w LEFT JOIN users u ON w.user_id = u.id`;
            
            const conditions = [];
            if (search && search.length <= 50) {
                conditions.push('(u.username LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE)');
                const searchPattern = `%${search}%`;
                params.push(searchPattern, searchPattern);
            }
            
            if (conditions.length > 0) {
                const whereClause = ' WHERE ' + conditions.join(' AND ');
                sql += whereClause;
                countSql += whereClause;
            }
            
            sql += ' ORDER BY w.id DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);
            
            const [list, countResult] = await Promise.all([
                getAllAsync(sql, params),
                getAsync(countSql, search && search.length <= 50 ? [search, search] : [])
            ]);
            
            const total = countResult ? countResult.total : 0;
            return res.json({ 
                data: list, 
                pagination: { page, limit, total } 
            });
        }
        
        // 原有cursor分页模式（向后兼容）
        const params = [];
        let sql = `SELECT w.id, w.user_id, u.username, u.email, w.video_id, w.base_video_id, w.note, w.status, w.created_at, w.updated_at FROM wishlists w LEFT JOIN users u ON w.user_id = u.id`;
        
        const conditions = [];
        if (cursor > 0) {
            conditions.push('w.id < ?');
            params.push(cursor);
        }
        if (search && search.length <= 50) {
            conditions.push('(u.username LIKE ? COLLATE NOCASE OR u.email LIKE ? COLLATE NOCASE)');
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }
        
        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        
        sql += ' ORDER BY w.id DESC LIMIT ?';
        params.push(limit);
        
        const list = await getAllAsync(sql, params);
        const nextCursor = list.length === limit ? list[list.length - 1].id : null;
        return res.json({ data: list, page: { cursor: cursor || null, limit, next_cursor: nextCursor } });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '获取心愿单列表失败' });
    }
});

app.get('/api/admin/wishlists/export/unupdated', authenticateAdminToken, async (req, res) => {
    try {
        const rows = await getAllAsync(
            `SELECT u.username, u.email, w.video_id, w.status
             FROM wishlists w
             LEFT JOIN users u ON w.user_id = u.id
             WHERE w.status = ?
             ORDER BY w.id DESC`,
            ['未更新']
        );

        const data = rows.map(r => ({
            username: r.username || '',
            email: r.email || '',
            videoId: r.video_id,
            status: r.status
        }));

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const filename = `wishlist-unupdated-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const encoded = encodeURIComponent(filename);
        res.setHeader('Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);
        res.send(JSON.stringify({ data }, null, 2));
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '导出失败' });
    }
});

app.patch('/api/admin/wishlists/:id', authenticateAdminToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body || {};
        if (!id) return res.status(400).json({ error: '参数错误' });
        if (!['未更新','已更新'].includes(String(status || ''))) return res.status(400).json({ error: 'status 取值错误' });
        const row = await getAsync('SELECT id FROM wishlists WHERE id = ?', [id]);
        if (!row) return res.status(404).json({ error: '记录不存在' });
        await runAsync('UPDATE wishlists SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
        const updated = await getAsync('SELECT id, user_id, video_id, base_video_id, note, status, created_at, updated_at FROM wishlists WHERE id = ?', [id]);
        return res.json({ message: '更新成功', item: updated });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: '更新失败' });
    }
});

// 字幕评论相关API
// 获取指定视频的评论列表
app.get('/api/subtitles/:videoId/comments', async (req, res) => {
    try {
        const { videoId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = (page - 1) * limit;
        const sortBy = req.query.sort === 'oldest' ? 'ASC' : 'DESC'; // 默认最新
        
        if (!videoId) {
            return res.status(400).json({ error: '视频ID不能为空' });
        }
        
        // 获取评论总数
        const countResult = await getAsync(
            'SELECT COUNT(*) as total FROM subtitle_comments WHERE video_id = ? AND status = "approved"',
            [videoId]
        );
        const total = countResult ? countResult.total : 0;
        
        // 获取评论列表（只获取顶级评论，回复通过单独接口获取）
        const comments = await getAllAsync(`
            SELECT 
                sc.id,
                sc.user_id,
                u.username,
                sc.content,
                sc.timestamp,
                sc.parent_id as parent_comment_id,
                sc.likes_count,
                sc.replies_count,
                sc.created_at,
                sc.updated_at
            FROM subtitle_comments sc
            LEFT JOIN users u ON sc.user_id = u.id
            WHERE sc.video_id = ? AND sc.status = "approved" AND sc.parent_id IS NULL
            ORDER BY sc.created_at ${sortBy}
            LIMIT ? OFFSET ?
        `, [videoId, limit, offset]);
        
        // 格式化返回数据
        const formattedComments = comments.map(comment => ({
            id: comment.id,
            userId: comment.user_id,
            username: comment.username || '未知用户',
            content: comment.content,
            timestampSeconds: comment.timestamp,
            parentCommentId: comment.parent_comment_id,
            likesCount: comment.likes_count || 0,
            repliesCount: comment.replies_count || 0,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at
        }));
        
        res.json({
            data: formattedComments,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('获取评论列表失败:', error);
        res.status(500).json({ error: '获取评论列表失败' });
    }
});

// 获取指定评论的回复列表
app.get('/api/comments/:commentId/replies', async (req, res) => {
    try {
        const { commentId } = req.params;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
        const offset = (page - 1) * limit;
        
        if (!commentId) {
            return res.status(400).json({ error: '评论ID不能为空' });
        }
        
        // 获取回复总数
        const countResult = await getAsync(
            'SELECT COUNT(*) as total FROM subtitle_comments WHERE parent_id = ? AND status = "approved"',
            [commentId]
        );
        const total = countResult ? countResult.total : 0;
        
        // 获取回复列表
        const replies = await getAllAsync(`
            SELECT 
                sc.id,
                sc.user_id,
                u.username,
                sc.content,
                sc.timestamp,
                sc.parent_id as parent_comment_id,
                sc.likes_count,
                sc.created_at,
                sc.updated_at
            FROM subtitle_comments sc
            LEFT JOIN users u ON sc.user_id = u.id
            WHERE sc.parent_id = ? AND sc.status = "approved"
            ORDER BY sc.created_at ASC
            LIMIT ? OFFSET ?
        `, [commentId, limit, offset]);
        
        // 格式化返回数据
        const formattedReplies = replies.map(reply => ({
            id: reply.id,
            userId: reply.user_id,
            username: reply.username || '未知用户',
            content: reply.content,
            timestampSeconds: reply.timestamp,
            parentCommentId: reply.parent_comment_id,
            likesCount: reply.likes_count || 0,
            createdAt: reply.created_at,
            updatedAt: reply.updated_at
        }));
        
        res.json({
            data: formattedReplies,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('获取回复列表失败:', error);
        res.status(500).json({ error: '获取回复列表失败' });
    }
});

// 发表评论
app.post('/api/subtitles/:videoId/comments', authenticateUserToken, async (req, res) => {
    try {
        const { videoId } = req.params;
        const { content, timestampSeconds, parentCommentId } = req.body;
        const userId = req.user.id;
        
        if (!videoId) {
            return res.status(400).json({ error: '视频ID不能为空' });
        }
        
        if (!content || content.trim().length === 0) {
            return res.status(400).json({ error: '评论内容不能为空' });
        }
        
        if (content.trim().length > 500) {
            return res.status(400).json({ error: '评论内容不能超过500字符' });
        }
        
        // 验证时间戳：允许 0，空串/未传视为 null；兼容前端 body.timestamp 或 body.timestampSeconds
        const tsRaw = (timestampSeconds !== undefined && timestampSeconds !== null && timestampSeconds !== '') 
            ? timestampSeconds 
            : req.body.timestamp;
        let timestamp = (tsRaw !== undefined && tsRaw !== null && tsRaw !== '') ? parseFloat(tsRaw) : null;
        if (timestamp !== null && (isNaN(timestamp) || timestamp < 0)) {
            return res.status(400).json({ error: '时间戳格式不正确' });
        }
        
        // 如果是回复，验证父评论存在；未提供时间戳则继承父评论的时间戳
        if (parentCommentId) {
            const parentComment = await getAsync(
                'SELECT id, timestamp FROM subtitle_comments WHERE id = ? AND video_id = ? AND status = "approved"',
                [parentCommentId, videoId]
            );
            if (!parentComment) {
                return res.status(400).json({ error: '父评论不存在' });
            }
            if (timestamp === null) {
                timestamp = parentComment.timestamp;
            }
        }
        
        // 顶级评论未提供时间戳时默认 0 秒
        if (!parentCommentId && timestamp === null) {
            timestamp = 0;
        }
        
        // 插入评论
        const result = await runAsync(`
            INSERT INTO subtitle_comments (
                user_id, video_id, content, timestamp, parent_id, status
            ) VALUES (?, ?, ?, ?, ?, "approved")
        `, [userId, videoId, content.trim(), timestamp, parentCommentId || null]);
        
        // 如果是回复，更新父评论的回复数
        if (parentCommentId) {
            await runAsync(
                'UPDATE subtitle_comments SET replies_count = replies_count + 1 WHERE id = ?',
                [parentCommentId]
            );
        }
        
        // 获取刚插入的评论详情
        const newComment = await getAsync(`
            SELECT 
                sc.id,
                sc.user_id,
                u.username,
                sc.content,
                sc.timestamp,
                sc.parent_id as parent_comment_id,
                sc.likes_count,
                sc.replies_count,
                sc.created_at,
                sc.updated_at
            FROM subtitle_comments sc
            LEFT JOIN users u ON sc.user_id = u.id
            WHERE sc.id = ?
        `, [result.lastID]);
        
        res.status(201).json({
            message: '评论发表成功',
            data: {
                id: newComment.id,
                userId: newComment.user_id,
                username: newComment.username,
                content: newComment.content,
                timestampSeconds: newComment.timestamp,
                parentCommentId: newComment.parent_comment_id,
                likesCount: newComment.likes_count || 0,
                repliesCount: newComment.replies_count || 0,
                createdAt: newComment.created_at,
                updatedAt: newComment.updated_at
            }
        });
    } catch (error) {
        console.error('发表评论失败:', error);
        res.status(500).json({ error: '发表评论失败' });
    }
});

// 点赞/取消点赞评论
app.post('/api/comments/:commentId/like', authenticateUserToken, async (req, res) => {
    try {
        const { commentId } = req.params;
        const userId = req.user.id;
        
        if (!commentId) {
            return res.status(400).json({ error: '评论ID不能为空' });
        }
        
        // 验证评论是否存在
        const comment = await getAsync(
            'SELECT id FROM subtitle_comments WHERE id = ? AND status = "approved"',
            [commentId]
        );
        if (!comment) {
            return res.status(404).json({ error: '评论不存在' });
        }
        
        // 检查是否已经点赞
        const existingLike = await getAsync(
            'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?',
            [userId, commentId]
        );
        
        if (existingLike) {
            // 取消点赞
            await runAsync('DELETE FROM comment_likes WHERE id = ?', [existingLike.id]);
            await runAsync(
                'UPDATE subtitle_comments SET likes_count = likes_count - 1 WHERE id = ?',
                [commentId]
            );
            
            res.json({ message: '取消点赞成功', liked: false });
        } else {
            // 添加点赞
            await runAsync(
                'INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)',
                [userId, commentId]
            );
            await runAsync(
                'UPDATE subtitle_comments SET likes_count = likes_count + 1 WHERE id = ?',
                [commentId]
            );
            
            res.json({ message: '点赞成功', liked: true });
        }
    } catch (error) {
        console.error('点赞操作失败:', error);
        res.status(500).json({ error: '点赞操作失败' });
    }
});

// 获取用户对评论的点赞状态
app.get('/api/comments/:commentId/like-status', authenticateUserToken, async (req, res) => {
    try {
        const { commentId } = req.params;
        const userId = req.user.id;
        
        if (!commentId) {
            return res.status(400).json({ error: '评论ID不能为空' });
        }
        
        const like = await getAsync(
            'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?',
            [userId, commentId]
        );
        
        res.json({ liked: !!like });
    } catch (error) {
        console.error('获取点赞状态失败:', error);
        res.status(500).json({ error: '获取点赞状态失败' });
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
        await deleteUserDataCascade(id);
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
        } else {            console.log('数据库连接已关闭');
        }
        process.exit(0);
    });
});
