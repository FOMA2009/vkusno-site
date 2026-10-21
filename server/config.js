const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* .env необязателен */ }

const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Секрет для подписи сессий и токенов адреса. Берётся из окружения,
// иначе генерируется один раз и сохраняется на сервере (не в репозитории).
function loadSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 24) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

module.exports = {
  ROOT,
  DATA_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  UPLOAD_DIR: path.resolve(ROOT, process.env.UPLOAD_DIR || path.join('public', 'uploads')), // на хостинге — на постоянном диске
  PORT: Number(process.env.PORT || 3000),
  SITE_URL: (process.env.SITE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  ADMIN_PATH: '/' + (process.env.ADMIN_PATH || 'staff').replace(/^\/|\/$/g, ''),
  IS_PROD: process.env.NODE_ENV === 'production',
  SECRET: loadSecret(),
  TZ: 'Europe/Moscow',
  // Серверные секреты — только из окружения
  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  YANDEX_GEOCODER_KEY: process.env.YANDEX_GEOCODER_KEY || '',
  YANDEX_SUGGEST_KEY: process.env.YANDEX_SUGGEST_KEY || '',
};
