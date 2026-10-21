const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { IS_PROD } = require('../config');

const COOKIE = 'vk_sid';
const SESSION_DAYS = 14;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const hashPassword = pw => bcrypt.hash(pw, 12);
const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Пароль должен быть не короче 10 символов';
  if (pw.length > 200) return 'Слишком длинный пароль';
  if (!/[A-Za-zА-Яа-я]/.test(pw) || !/\d/.test(pw)) return 'Пароль должен содержать буквы и цифры';
  return null;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(sha(token), userId, csrf, exp);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${IS_PROD ? '; Secure' : ''}`);
  return csrf;
}
function destroySession(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Загружает пользователя сессии (если есть) в req.user / req.csrf
function attachUser(req, _res, next) {
  req.user = null;
  const t = parseCookies(req)[COOKIE];
  if (t) {
    const row = db.prepare(`SELECT s.csrf, s.expires_at, u.id, u.email, u.name, u.phone, u.role, u.scope, u.is_active
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha(t));
    if (row && row.expires_at > Date.now() && row.is_active) {
      req.user = { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, scope: row.scope };
      req.csrf = row.csrf;
    }
  }
  next();
}

// Защита от CSRF: проверка Origin + токен для запросов с сессией.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'forbidden_origin' }); }
    catch { return res.status(403).json({ error: 'forbidden_origin' }); }
  }
  if (req.user && req.headers['x-csrf-token'] !== req.csrf) return res.status(403).json({ error: 'bad_csrf' });
  next();
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};

// Простейший лимитер в памяти (достаточно для одного процесса)
function rateLimit({ windowMs, max, key = req => req.ip, message = 'Слишком много запросов, попробуйте позже' }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req), now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.n > max) return res.status(429).json({ error: 'rate_limited', message });
    next();
  };
}

module.exports = { hashPassword, checkPassword, validatePassword, createSession, destroySession, attachUser, csrfGuard, requireRole, rateLimit };
