const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const { db } = require('./db');
const { seedAll } = require('./seed');
const auth = require('./lib/auth');
const pages = require('./routes/pages');
const api = require('./routes/api');
const admin = require('./routes/admin');

seedAll();
// Просроченные сессии
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.use(compression());

// Заголовки безопасности. Скрипты — только свои; встроенных обработчиков и inline-стилей в разметке нет.
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https://avatars.mds.yandex.net; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (cfg.IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.get('/healthz', (req, res) => { db.prepare('SELECT 1').get(); res.type('text').send('ok'); });

app.use('/uploads', express.static(cfg.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(cfg.PUBLIC_DIR, { maxAge: '7d', index: false, redirect: false, // redirect:false — папка public/menu с фото не должна перехватывать страницу /menu
   setHeaders: (res, p) => { if (/\.(html?)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));

app.use(express.json({ limit: '300kb' }));

// API: сессия + защита от CSRF
app.use('/api', auth.attachUser, auth.csrfGuard, (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api/admin', admin);
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Админ-панель (адрес задаётся ADMIN_PATH, на сайте не публикуется и закрыта от индексации)
const adminDir = path.join(cfg.ROOT, 'admin');
app.use(cfg.ADMIN_PATH, (req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  next();
}, express.static(adminDir, { index: false, etag: false }));
app.get(cfg.ADMIN_PATH, (req, res) => res.type('html').send(fs.readFileSync(path.join(adminDir, 'index.html'), 'utf8').replace(/__ADMIN_PATH__/g, cfg.ADMIN_PATH)));

app.use(pages);
app.use((req, res) => pages.notFound(res));

// Ошибки
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) return res.status(400).json({ error: 'bad_request', message: 'Некорректный запрос' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Файл слишком большой (до 10 МБ)' });
  console.error(err);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'server_error', message: 'Внутренняя ошибка сервера' });
  res.status(500).type('html').send('<!doctype html><meta charset="utf-8"><body style="background:#0b0b0b;color:#fff;font-family:sans-serif;padding:2rem"><h1>Что-то пошло не так</h1><p>Попробуйте обновить страницу чуть позже.</p>');
});

// Первый администратор на хостинге без доступа к консоли: задайте ADMIN_BOOTSTRAP_EMAIL и ADMIN_BOOTSTRAP_PASSWORD.
// Срабатывает только пока в базе нет ни одного администратора. После входа удалите эти переменные.
(async () => {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL, pw = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !pw || db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return;
  const err = auth.validatePassword(pw);
  if (err || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return console.error('ADMIN_BOOTSTRAP: некорректные данные —', err || 'email');
  db.prepare("INSERT INTO users(email,password_hash,name,role) VALUES(?,?,?,'admin')").run(email.toLowerCase(), await auth.hashPassword(pw), 'Администратор');
  console.log('Создан первый администратор:', email);
})();

if (require.main === module) {
  app.listen(cfg.PORT, () => console.log(`Сайт: ${cfg.SITE_URL}   Админ-панель: ${cfg.SITE_URL}${cfg.ADMIN_PATH}`));
}
module.exports = app;
