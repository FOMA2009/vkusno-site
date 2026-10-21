const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { DATA_DIR } = require('./config');

const db = new DatabaseSync(process.env.DB_FILE || path.join(DATA_DIR, 'shop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','manager','customer')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  weight_label TEXT NOT NULL DEFAULT '',
  price_kop INTEGER NOT NULL DEFAULT 0 CHECK (price_kop >= 0),
  is_popular INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  in_stock INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id, sort);
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_kop INTEGER NOT NULL CHECK (price_kop >= 0),
  weight_label TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  in_stock INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE TABLE IF NOT EXISTS product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_kop INTEGER NOT NULL DEFAULT 0 CHECK (price_kop >= 0),
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_options_product ON product_options(product_id);
CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_order_kop INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  category_ids TEXT NOT NULL DEFAULT '[]',
  product_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'new',
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery','pickup')),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  address_lat REAL,
  address_lon REAL,
  apartment TEXT NOT NULL DEFAULT '',
  entrance TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  intercom TEXT NOT NULL DEFAULT '',
  courier_comment TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  desired_time TEXT NOT NULL DEFAULT '',
  subtotal_kop INTEGER NOT NULL,
  discount_kop INTEGER NOT NULL DEFAULT 0,
  delivery_fee_kop INTEGER NOT NULL DEFAULT 0,
  total_kop INTEGER NOT NULL,
  promo_code TEXT NOT NULL DEFAULT '',
  delivery_zone TEXT NOT NULL DEFAULT '',
  distance_km REAL,
  payment_method TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  consent_pd_at TEXT NOT NULL,
  consent_email INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  variant_name TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  unit_price_kop INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_total_kop INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_kop INTEGER NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS geocache (
  q TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

// Миграции (безопасны для повторного запуска)
if (!db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'scope'").get()) {
  db.exec("ALTER TABLE users ADD COLUMN scope TEXT NOT NULL DEFAULT ''"); // '' — права по роли; 'prices' — только цены
}
db.exec(`CREATE TABLE IF NOT EXISTS price_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  what TEXT NOT NULL,
  old_kop INTEGER NOT NULL,
  new_kop INTEGER NOT NULL,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);

// ── Транзакции ────────────────────────────────────────────────
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* уже откатано */ } throw e; }
}

// ── Настройки ─────────────────────────────────────────────────
// Все параметры заведения хранятся здесь и редактируются в админке.
const DEFAULT_SETTINGS = {
  'site.name': "В'кусно",
  'site.tagline': 'Шаурма, шашлык и роллы с доставкой по Нижнему Новгороду',
  'site.description': 'Шаурма, шашлык, люля-кебаб, суши и роллы. Доставка по Нижнему Новгороду и самовывоз.',
  'site.logo': '/img/logo-512.webp',
  'contact.phone': '+7 (831) 424-77-72', // взято со страницы организации в Яндекс.Картах — проверьте
  'contact.email': '',
  'contact.address': 'Россия, Нижний Новгород, улица Пермякова, 32А',
  'contact.lat': 56.270027,   // координаты организации со страницы Яндекс.Карт
  'contact.lon': 43.878164,
  'contact.map_url': 'https://yandex.ru/maps/org/v_kusno/126128588630', // ссылка на организацию в Яндекс.Картах
  'contact.reviews_url': 'https://yandex.ru/maps/org/v_kusno/126128588630/reviews/?add-review=true', // «Оставить отзыв» на Яндекс.Картах
  'contact.social': [],       // [{title,url}] — заполняет владелец
  'hours.schedule': [         // 0 = воскресенье … 6 = суббота; close < open => закрытие после полуночи
    { day: 0, open: '10:00', close: '22:00' },
    { day: 1, open: '10:00', close: '22:00' },
    { day: 2, open: '10:00', close: '22:00' },
    { day: 3, open: '10:00', close: '22:00' },
    { day: 4, open: '10:00', close: '22:00' },
    { day: 5, open: '10:00', close: '02:00' },
    { day: 6, open: '10:00', close: '02:00' },
  ],
  'orders.accepting': true,          // временное закрытие приёма заказов
  'orders.closed_message': 'Приём заказов временно приостановлен. Попробуйте позже.',
  'orders.min_lead_minutes': 45,     // минимальное время до предзаказа
  'delivery.enabled': true,          // временное отключение доставки
  'delivery.min_order_kop': 150000,
  'delivery.fee_kop': 19900,
  'delivery.free_threshold_kop': 300000,
  'delivery.free_radius_km': 5,
  'delivery.free_districts': ['autozavodsky'], // идентификаторы районов из delivery.districts
  'delivery.districts': [{ id: 'autozavodsky', name: 'Автозаводский район', source: 'file:autozavodsky.geojson' }],
  'delivery.city': 'Нижний Новгород',
  'mail.enabled': false,
  'mail.from': '',
  'mail.admin_to': '',
  'mail.notify_status_change': true,
  'payments.online_enabled': false,   // онлайн-оплата выключена до отдельной настройки
  'payments.provider': '',
  'payments.methods': [{ code: 'on_receipt', title: 'Оплата при получении', enabled: true }],
  'seo.og_image': '/img/og.jpg',
};

const settingsCache = new Map();
const settings = {
  get(key) {
    if (settingsCache.has(key)) return settingsCache.get(key);
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const v = row ? JSON.parse(row.value) : DEFAULT_SETTINGS[key];
    settingsCache.set(key, v);
    return v;
  },
  set(key, value) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error('Неизвестная настройка: ' + key);
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
    settingsCache.set(key, value);
  },
  all() { const o = {}; for (const k of Object.keys(DEFAULT_SETTINGS)) o[k] = this.get(k); return o; },
  defaults: DEFAULT_SETTINGS,
};

module.exports = { db, tx, settings };
