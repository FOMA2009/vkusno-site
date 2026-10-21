const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { db, tx, settings } = require('../db');
const auth = require('../lib/auth');
const orders = require('../lib/orders');
const mail = require('../lib/mail');
const payments = require('../lib/payments');
const { slugify, STATUS_FLOW, STATUS_LABELS } = require('../lib/util');
const { UPLOAD_DIR, SMTP, YANDEX_GEOCODER_KEY } = require('../config');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const staff = auth.requireRole('admin', 'manager');
const adminOnly = auth.requireRole('admin');
const bad = (res, message, status = 422) => res.status(status).json({ message });

const int = (v, d = 0, min = -1e12, max = 1e12) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const flag = v => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;

// ── Вход персонала ───────────────────────────────────────────
router.post('/login', auth.rateLimit({ windowMs: 15 * 60_000, max: 8, key: req => req.ip + '|' + String(req.body?.email || '').toLowerCase() }), wrap(async (req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE email = ? AND role IN ('admin','manager')").get(str(req.body?.email, 120));
  const ok = u && u.is_active && await auth.checkPassword(String(req.body?.password || ''), u.password_hash);
  if (!ok) return bad(res, 'Неверный email или пароль', 401);
  const csrf = auth.createSession(res, u.id);
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, scope: u.scope }, csrf });
}));
router.post('/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });
router.get('/me', (req, res) => {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) return res.status(401).json({ error: 'auth_required' });
  res.json({ user: req.user, csrf: req.csrf, status_labels: STATUS_LABELS, status_flow: STATUS_FLOW });
});

router.use(staff);

// Сотрудник с ограниченным доступом «только цены» не может обращаться ни к чему, кроме /prices
router.use((req, res, next) => {
  if (req.user.scope === 'prices' && !(req.path === '/prices' || req.path.startsWith('/prices/'))) return res.status(403).json({ error: 'forbidden', message: 'Нет доступа' });
  next();
});
const priceEditor = (req, res, next) => (req.user.role === 'admin' || (req.user.role === 'manager' && req.user.scope === 'prices')) ? next() : res.status(403).json({ error: 'forbidden' });

// ── Цены (доступно администратору и сотруднику «только цены») ──
router.get('/prices', priceEditor, (req, res) => {
  const prods = db.prepare('SELECT p.id, p.name, p.price_kop, p.is_active, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id ORDER BY c.sort, p.sort, p.id').all();
  const vars = db.prepare('SELECT id, product_id, name, price_kop FROM product_variants ORDER BY sort, id').all();
  const opts = db.prepare('SELECT id, product_id, name, price_kop FROM product_options ORDER BY sort, id').all();
  res.json({ products: prods.map(p => ({ ...p, variants: vars.filter(v => v.product_id === p.id), options: opts.filter(o => o.product_id === p.id) })) });
});
router.put('/prices/:id', priceEditor, (req, res) => {
  const id = int(req.params.id), b = req.body || {};
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return bad(res, 'Блюдо не найдено', 404);
  const kop = v => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 1e8 ? n : null; };
  const vars = db.prepare('SELECT * FROM product_variants WHERE product_id = ?').all(id);
  const opts = db.prepare('SELECT * FROM product_options WHERE product_id = ?').all(id);
  const changes = [];
  if (b.price_kop !== undefined) { const n = kop(b.price_kop); if (n === null) return bad(res, 'Некорректная цена'); if (n !== p.price_kop) changes.push({ t: 'products', id, what: 'цена', old: p.price_kop, nw: n }); }
  for (const [list, rows, table, label] of [[b.variants, vars, 'product_variants', 'вариант'], [b.options, opts, 'product_options', 'добавка']]) {
    for (const x of Array.isArray(list) ? list : []) {
      const row = rows.find(r => r.id === int(x.id)); if (!row) return bad(res, 'Вариант не найден');
      const n = kop(x.price_kop); if (n === null) return bad(res, 'Некорректная цена');
      if (n !== row.price_kop) changes.push({ t: table, id: row.id, what: `${label}: ${row.name}`, old: row.price_kop, nw: n });
    }
  }
  // Видимое блюдо без цены на сайте недопустимо
  const after = (t, rid, cur) => changes.find(c => c.t === t && c.id === rid)?.nw ?? cur;
  if (p.is_active) {
    const hasVar = vars.length > 0;
    const ok = hasVar ? vars.some(v => after('product_variants', v.id, v.price_kop) > 0) : after('products', id, p.price_kop) > 0;
    if (!ok) return bad(res, 'У видимого блюда цена не может быть нулевой');
  }
  tx(() => {
    for (const c of changes) {
      db.prepare(`UPDATE ${c.t} SET price_kop = ? WHERE id = ?`).run(c.nw, c.id);
      db.prepare('INSERT INTO price_log(product_id,product_name,what,old_kop,new_kop,user_id) VALUES(?,?,?,?,?,?)').run(id, p.name, c.what, c.old, c.nw, req.user.id);
    }
    if (changes.length) db.prepare("UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  });
  res.json({ ok: true, changed: changes.length });
});
router.get('/price-log', adminOnly, (req, res) => res.json({ log: db.prepare('SELECT l.*, u.email AS by_email FROM price_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100').all() }));

// ── Заказы ───────────────────────────────────────────────────
router.get('/orders', (req, res) => {
  const where = [], args = [];
  if (req.query.status) { where.push('status = ?'); args.push(String(req.query.status)); }
  if (req.query.fulfillment) { where.push('fulfillment = ?'); args.push(String(req.query.fulfillment)); }
  if (req.query.q) {
    const q = '%' + String(req.query.q).trim().slice(0, 60) + '%';
    where.push('(number LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR address LIKE ? OR email LIKE ?)'); args.push(q, q, q, q, q);
  }
  if (req.query.from) { where.push('created_at >= ?'); args.push(String(req.query.from)); }
  if (req.query.to) { where.push('created_at <= ?'); args.push(String(req.query.to) + 'T23:59:59.999Z'); }
  const sortCol = { created: 'created_at', total: 'total_kop', status: 'status' }[req.query.sort] || 'created_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const page = int(req.query.page, 1, 1, 10000), per = 30;
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM orders ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT id, number, status, fulfillment, customer_name, phone, address, total_kop, payment_status, created_at FROM orders ${w} ORDER BY ${sortCol} ${dir}, id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  res.json({ orders: rows, total: Number(total), page, per });
});

router.get('/orders/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(int(req.params.id));
  if (!o) return bad(res, 'Заказ не найден', 404);
  res.json({
    order: o,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id).map(i => ({ ...i, options: JSON.parse(i.options_json) })),
    history: db.prepare('SELECT h.*, u.email AS by_email FROM order_status_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.order_id = ? ORDER BY h.id').all(o.id),
    allowed_statuses: STATUS_FLOW[o.fulfillment],
  });
});

router.post('/orders/:id/status', (req, res) => {
  try {
    const o = orders.changeStatus(int(req.params.id), String(req.body?.status), str(req.body?.note, 300), req.user.id);
    res.json({ ok: true, status: o.status });
  } catch (e) { if (e instanceof orders.OrderError) return bad(res, e.message, e.status); throw e; }
});

// ── Меню: категории ──────────────────────────────────────────
const uniqueSlug = (table, base, selfId = 0) => {
  let s = base || 'item', n = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`).get(s, selfId)) s = `${base}-${n++}`;
  return s;
};

router.get('/categories', adminOnly, (req, res) => res.json({
  categories: db.prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products FROM categories c ORDER BY sort, id').all(),
}));
router.post('/categories', adminOnly, (req, res) => {
  const name = str(req.body?.name, 80); if (!name) return bad(res, 'Введите название категории');
  const id = req.body?.id ? int(req.body.id) : 0;
  const slug = uniqueSlug('categories', slugify(str(req.body?.slug, 80) || name), id);
  if (id) db.prepare('UPDATE categories SET name=?, slug=?, description=?, sort=?, is_active=? WHERE id=?')
    .run(name, slug, str(req.body.description, 300), int(req.body.sort), flag(req.body.is_active), id);
  else db.prepare('INSERT INTO categories(name,slug,description,sort,is_active) VALUES(?,?,?,?,?)')
    .run(name, slug, str(req.body?.description, 300), int(req.body?.sort, 999), req.body?.is_active === false ? 0 : 1);
  res.json({ ok: true });
});
router.post('/categories/reorder', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => int(n)) : [];
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE categories SET sort = ? WHERE id = ?').run(i, id)));
  res.json({ ok: true });
});
router.delete('/categories/:id', adminOnly, (req, res) => {
  const id = int(req.params.id);
  if (db.prepare('SELECT COUNT(*) n FROM products WHERE category_id = ?').get(id).n > 0) return bad(res, 'В категории есть блюда. Сначала перенесите или удалите их (либо скройте категорию).', 409);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Меню: блюда ──────────────────────────────────────────────
router.get('/products', adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id ORDER BY c.sort, p.sort, p.id`).all();
  res.json({ products: rows });
});
router.get('/products/:id', adminOnly, (req, res) => {
  const id = int(req.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return bad(res, 'Блюдо не найдено', 404);
  res.json({ product: p,
    variants: db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort, id').all(id),
    options: db.prepare('SELECT * FROM product_options WHERE product_id = ? ORDER BY sort, id').all(id) });
});

router.post('/products', adminOnly, (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 120); if (!name) return bad(res, 'Введите название блюда');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(int(b.category_id))) return bad(res, 'Выберите категорию');
  const variants = (Array.isArray(b.variants) ? b.variants : []).slice(0, 30).map(v => ({ id: v.id ? int(v.id) : 0, name: str(v.name, 80), price_kop: int(v.price_kop, 0, 0, 1e9), weight_label: str(v.weight_label, 40), in_stock: v.in_stock === false || v.in_stock === 0 ? 0 : 1 })).filter(v => v.name);
  const options = (Array.isArray(b.options) ? b.options : []).slice(0, 30).map(o => ({ id: o.id ? int(o.id) : 0, name: str(o.name, 80), price_kop: int(o.price_kop, 0, 0, 1e9) })).filter(o => o.name);
  const price = int(b.price_kop, 0, 0, 1e9);
  const active = flag(b.is_active);
  if (active && !variants.length && price <= 0) return bad(res, 'Для видимого блюда укажите цену (или варианты с ценой)');
  if (active && variants.length && variants.every(v => v.price_kop <= 0)) return bad(res, 'Укажите цену хотя бы у одного варианта');
  const image = b.image && /^\/(uploads|menu)\/[\w.-]+\.webp$/.test(b.image) ? b.image : '';
  const id = b.id ? int(b.id) : 0;
  const slug = uniqueSlug('products', slugify(str(b.slug, 100) || name), id);
  const outId = tx(() => {
    let pid = id;
    if (id) {
      db.prepare(`UPDATE products SET category_id=?, slug=?, name=?, description=?, image=?, weight_label=?, price_kop=?, is_popular=?, is_new=?, is_active=?, in_stock=?, sort=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
        .run(int(b.category_id), slug, name, str(b.description, 600), image, str(b.weight_label, 60), price, flag(b.is_popular), flag(b.is_new), active, b.in_stock === false || b.in_stock === 0 ? 0 : 1, int(b.sort, 0), id);
    } else {
      pid = Number(db.prepare(`INSERT INTO products(category_id,slug,name,description,image,weight_label,price_kop,is_popular,is_new,is_active,in_stock,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(int(b.category_id), slug, name, str(b.description, 600), image, str(b.weight_label, 60), price, flag(b.is_popular), flag(b.is_new), active, b.in_stock === false || b.in_stock === 0 ? 0 : 1, int(b.sort, 9999)).lastInsertRowid);
    }
    // варианты и опции: обновляем по id, чтобы не ломать корзины клиентов
    syncChildren('product_variants', pid, variants, ['name', 'price_kop', 'weight_label', 'in_stock']);
    syncChildren('product_options', pid, options, ['name', 'price_kop']);
    return pid;
  });
  res.json({ ok: true, id: outId });
});
function syncChildren(table, pid, rows, cols) {
  const keep = rows.filter(r => r.id).map(r => r.id);
  const existing = db.prepare(`SELECT id FROM ${table} WHERE product_id = ?`).all(pid).map(r => r.id);
  for (const id of existing) if (!keep.includes(id)) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  rows.forEach((r, i) => {
    if (r.id && existing.includes(r.id)) db.prepare(`UPDATE ${table} SET ${cols.map(c => c + '=?').join(',')}, sort=? WHERE id=? AND product_id=?`).run(...cols.map(c => r[c]), i, r.id, pid);
    else db.prepare(`INSERT INTO ${table}(product_id,${cols.join(',')},sort) VALUES(?,${cols.map(() => '?').join(',')},?)`).run(pid, ...cols.map(c => r[c]), i);
  });
}
router.patch('/products/:id', adminOnly, (req, res) => { // быстрые переключатели из списка
  const id = int(req.params.id), b = req.body || {};
  const allowed = { is_active: flag, in_stock: flag, is_popular: flag, is_new: flag };
  for (const [k, fn] of Object.entries(allowed)) if (k in b) {
    if (k === 'is_active' && fn(b[k])) {
      const p = db.prepare('SELECT price_kop FROM products WHERE id = ?').get(id);
      const hasVar = db.prepare('SELECT COUNT(*) n FROM product_variants WHERE product_id = ? AND price_kop > 0').get(id).n > 0;
      if (p && p.price_kop <= 0 && !hasVar) return bad(res, 'Сначала задайте цену блюда');
    }
    db.prepare(`UPDATE products SET ${k} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(fn(b[k]), id);
  }
  res.json({ ok: true });
});
router.post('/products/reorder', adminOnly, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(n => int(n)) : [];
  tx(() => ids.forEach((id, i) => db.prepare('UPDATE products SET sort = ? WHERE id = ?').run(i, id)));
  res.json({ ok: true });
});
router.delete('/products/:id', adminOnly, (req, res) => { db.prepare('DELETE FROM products WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); });

// ── Загрузка фото ────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)) });
router.post('/upload', adminOnly, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return bad(res, 'Загрузите изображение JPG, PNG или WebP до 10 МБ');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const name = crypto.randomBytes(10).toString('hex') + '.webp';
  try {
    await sharp(req.file.buffer).rotate().resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(UPLOAD_DIR, name));
  } catch { return bad(res, 'Не удалось обработать изображение — файл повреждён или не является картинкой'); }
  res.json({ ok: true, url: '/uploads/' + name });
}));

// ── Промокоды ────────────────────────────────────────────────
const promoRow = r => ({ ...r, category_ids: JSON.parse(r.category_ids), product_ids: JSON.parse(r.product_ids) });
router.get('/promos', adminOnly, (req, res) => res.json({ promos: db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all().map(promoRow) }));
router.post('/promos', adminOnly, (req, res) => {
  const b = req.body || {};
  const code = str(b.code, 40).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-ZА-ЯЁ0-9_-]{3,40}$/.test(code)) return bad(res, 'Код: 3–40 символов — буквы, цифры, «-» или «_»');
  const type = b.type === 'fixed' ? 'fixed' : 'percent';
  const value = int(b.value, 0, 0, type === 'percent' ? 100 : 1e9);
  if (value <= 0) return bad(res, type === 'percent' ? 'Скидка: от 1 до 100 %' : 'Введите сумму скидки');
  const date = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
  const ids = a => (Array.isArray(a) ? a : []).map(n => int(n)).filter(n => n > 0);
  const vals = [code, str(b.description, 200), type, value, int(b.min_order_kop, 0, 0, 1e9), date(b.starts_at), date(b.expires_at),
    b.max_uses === '' || b.max_uses == null ? null : int(b.max_uses, 0, 0, 1e9), flag(b.is_active), JSON.stringify(ids(b.category_ids)), JSON.stringify(ids(b.product_ids))];
  try {
    if (b.id) db.prepare('UPDATE promo_codes SET code=?,description=?,type=?,value=?,min_order_kop=?,starts_at=?,expires_at=?,max_uses=?,is_active=?,category_ids=?,product_ids=? WHERE id=?').run(...vals, int(b.id));
    else db.prepare('INSERT INTO promo_codes(code,description,type,value,min_order_kop,starts_at,expires_at,max_uses,is_active,category_ids,product_ids) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...vals);
  } catch (e) { if (/UNIQUE/.test(e.message)) return bad(res, 'Такой промокод уже есть', 409); throw e; }
  res.json({ ok: true });
});
router.delete('/promos/:id', adminOnly, (req, res) => { db.prepare('DELETE FROM promo_codes WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); });

// ── Акции на главной ─────────────────────────────────────────
router.get('/promotions', adminOnly, (req, res) => res.json({ promotions: db.prepare('SELECT * FROM promotions ORDER BY sort, id').all() }));
router.post('/promotions', adminOnly, (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 100); if (!title) return bad(res, 'Введите заголовок акции');
  const link = str(b.link, 200); if (link && !/^(\/|https?:\/\/)/.test(link)) return bad(res, 'Ссылка должна начинаться с / или https://');
  const image = b.image && /^\/(uploads|menu)\/[\w.-]+\.webp$/.test(b.image) ? b.image : '';
  const v = [title, str(b.text, 400), image, link, flag(b.is_active), int(b.sort, 0)];
  if (b.id) db.prepare('UPDATE promotions SET title=?,text=?,image=?,link=?,is_active=?,sort=? WHERE id=?').run(...v, int(b.id));
  else db.prepare('INSERT INTO promotions(title,text,image,link,is_active,sort) VALUES(?,?,?,?,?,?)').run(...v);
  res.json({ ok: true });
});
router.delete('/promotions/:id', adminOnly, (req, res) => { db.prepare('DELETE FROM promotions WHERE id = ?').run(int(req.params.id)); res.json({ ok: true }); });

// ── Информационные страницы ──────────────────────────────────
router.get('/pages', adminOnly, (req, res) => res.json({ pages: db.prepare('SELECT * FROM pages ORDER BY slug').all() }));
router.put('/pages/:slug', adminOnly, (req, res) => {
  const t = str(req.body?.title, 150); if (!t) return bad(res, 'Введите заголовок');
  const r = db.prepare("UPDATE pages SET title = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = ?").run(t, String(req.body?.body ?? '').slice(0, 60000), req.params.slug);
  if (!Number(r.changes)) return bad(res, 'Страница не найдена', 404);
  res.json({ ok: true });
});

// ── Настройки ────────────────────────────────────────────────
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const SETTING_RULES = {
  'site.name': v => str(v, 80) || null, 'site.tagline': v => str(v, 200), 'site.description': v => str(v, 300),
  'contact.phone': v => str(v, 30), 'contact.email': v => { v = str(v, 120); return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null; },
  'contact.address': v => str(v, 200) || null, 'contact.map_url': v => { v = str(v, 300); return !v || /^https:\/\//.test(v) ? v : null; },
  'contact.reviews_url': v => { v = str(v, 300); return !v || /^https:\/\//.test(v) ? v : null; },
  'contact.lat': v => { const n = Number(v); return n >= 40 && n <= 70 ? n : null; }, 'contact.lon': v => { const n = Number(v); return n >= 20 && n <= 60 ? n : null; },
  'contact.social': v => Array.isArray(v) ? v.slice(0, 10).map(x => ({ title: str(x?.title, 40), url: str(x?.url, 200) })).filter(x => x.title && /^https:\/\//.test(x.url)) : null,
  'hours.schedule': v => Array.isArray(v) && v.length <= 7 && v.every(s => Number.isInteger(s.day) && s.day >= 0 && s.day <= 6 && timeRe.test(s.open) && timeRe.test(s.close) && s.open !== s.close)
    ? v.map(s => ({ day: s.day, open: s.open, close: s.close })) : null,
  'orders.accepting': flag, 'orders.closed_message': v => str(v, 300), 'orders.min_lead_minutes': v => int(v, 45, 0, 1440),
  'delivery.enabled': flag,
  'delivery.min_order_kop': v => int(v, -1, 0, 1e8) >= 0 ? int(v, 0, 0, 1e8) : null,
  'delivery.fee_kop': v => int(v, -1, 0, 1e8) >= 0 ? int(v, 0, 0, 1e8) : null,
  'delivery.free_threshold_kop': v => int(v, -1, 0, 1e9) >= 0 ? int(v, 0, 0, 1e9) : null,
  'delivery.free_radius_km': v => { const n = Number(v); return n >= 0 && n <= 100 ? n : null; },
  'delivery.free_districts': v => { const ids = (settings.get('delivery.districts') || []).map(d => d.id); return Array.isArray(v) ? v.filter(x => ids.includes(x)) : null; },
  'mail.enabled': flag, 'mail.from': v => str(v, 160), 'mail.admin_to': v => str(v, 160), 'mail.notify_status_change': flag,
  'payments.methods': v => Array.isArray(v) ? v.slice(0, 8).map(m => ({ code: /^[a-z0-9_-]{1,30}$/.test(String(m?.code || '')) ? m.code : slugify(str(m?.title, 30)), title: str(m?.title, 60), enabled: !!m?.enabled })).filter(m => m.title && m.code) : null,
  'payments.provider': v => { v = str(v, 40); return !v || payments.providers[v] ? v : null; },
  'payments.online_enabled': v => { if (!flag(v)) return 0; return payments.providers[settings.get('payments.provider')] ? 1 : null; },
};
const BOOL_KEYS = new Set(['orders.accepting', 'delivery.enabled', 'mail.enabled', 'mail.notify_status_change', 'payments.online_enabled']);
router.get('/settings', adminOnly, (req, res) => {
  const all = settings.all();
  res.json({
    settings: Object.fromEntries(Object.keys(SETTING_RULES).concat(['delivery.districts']).map(k => [k, all[k]])),
    env: { smtp_configured: !!(SMTP.host && SMTP.user && SMTP.pass), geocoder: YANDEX_GEOCODER_KEY ? 'yandex' : 'osm-nominatim', providers: Object.keys(payments.providers) },
    mail: mail.status(),
  });
});
router.put('/settings', adminOnly, (req, res) => {
  const incoming = req.body?.settings || {}, errors = [], clean = {};
  for (const [k, v] of Object.entries(incoming)) {
    const rule = SETTING_RULES[k]; if (!rule) continue;
    const out = rule(v);
    if (out === null || out === undefined) errors.push(k); else clean[k] = BOOL_KEYS.has(k) ? !!out : out;
  }
  if (errors.length) return res.status(422).json({ message: 'Проверьте значения полей: ' + errors.join(', '), fields: errors });
  tx(() => { for (const [k, v] of Object.entries(clean)) settings.set(k, v); });
  res.json({ ok: true });
});

// Район доставки: добавить по GeoJSON (Polygon/MultiPolygon)
router.post('/districts', adminOnly, (req, res) => {
  const name = str(req.body?.name, 80);
  let g; try { g = typeof req.body?.geojson === 'string' ? JSON.parse(req.body.geojson) : req.body?.geojson; } catch { return bad(res, 'GeoJSON не разобран'); }
  const geom = g?.geometry || g;
  if (!name || !geom || !['Polygon', 'MultiPolygon'].includes(geom.type) || JSON.stringify(geom).length > 400000) return bad(res, 'Нужны название и GeoJSON с типом Polygon или MultiPolygon');
  const list = settings.get('delivery.districts') || [];
  const id = slugify(name) + '-' + crypto.randomBytes(2).toString('hex');
  settings.set('delivery.districts', [...list, { id, name, geojson: geom }]);
  res.json({ ok: true, id });
});
router.delete('/districts/:id', adminOnly, (req, res) => {
  if (req.params.id === 'autozavodsky') return bad(res, 'Базовый район нельзя удалить — снимите галочку «бесплатная доставка»', 409);
  settings.set('delivery.districts', (settings.get('delivery.districts') || []).filter(d => d.id !== req.params.id));
  settings.set('delivery.free_districts', (settings.get('delivery.free_districts') || []).filter(d => d !== req.params.id));
  res.json({ ok: true });
});

// ── Почта: тест и журнал ─────────────────────────────────────
router.post('/mail/test', adminOnly, wrap(async (req, res) => {
  const to = str(req.body?.to, 160) || settings.get('mail.admin_to');
  if (!to) return bad(res, 'Укажите адрес получателя');
  const r = await mail.sendMail({ to, subject: `Проверка почты — ${settings.get('site.name')}`, html: '<p>Тестовое письмо: почтовые уведомления сайта настроены.</p>', text: 'Тестовое письмо: почтовые уведомления сайта настроены.' });
  if (r.sent) return res.json({ ok: true, message: 'Письмо отправлено — проверьте ящик' });
  const why = { disabled: 'Почта выключена в настройках', not_configured: 'Не заданы SMTP-параметры: ' + mail.status().missing.join(', '), error: r.error, no_recipient: 'Нет адреса получателя' }[r.reason];
  res.status(422).json({ message: 'Письмо НЕ отправлено. ' + why });
}));
router.get('/mail/log', adminOnly, (req, res) => res.json({ log: db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 50').all() }));

// ── Сотрудники ───────────────────────────────────────────────
router.get('/users', adminOnly, (req, res) => res.json({ users: db.prepare("SELECT id,email,name,role,scope,is_active,created_at FROM users WHERE role IN ('admin','manager') ORDER BY id").all() }));
router.post('/users', adminOnly, wrap(async (req, res) => {
  const email = str(req.body?.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad(res, 'Проверьте email');
  const pwErr = auth.validatePassword(req.body?.password); if (pwErr) return bad(res, pwErr);
  const role = req.body?.role === 'admin' ? 'admin' : 'manager';
  const scope = role === 'manager' && req.body?.scope === 'prices' ? 'prices' : '';
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'Такой email уже есть', 409);
  db.prepare('INSERT INTO users(email,password_hash,name,role,scope) VALUES(?,?,?,?,?)').run(email, await auth.hashPassword(req.body.password), str(req.body?.name, 80), role, scope);
  res.json({ ok: true });
}));
router.patch('/users/:id', adminOnly, wrap(async (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id && 'is_active' in (req.body || {}) && !flag(req.body.is_active)) return bad(res, 'Нельзя отключить самого себя', 409);
  if ('is_active' in (req.body || {})) {
    db.prepare("UPDATE users SET is_active = ? WHERE id = ? AND role IN ('admin','manager')").run(flag(req.body.is_active), id);
    if (!flag(req.body.is_active)) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (req.body?.password) {
    const e = auth.validatePassword(req.body.password); if (e) return bad(res, e);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND role IN ('admin','manager')").run(await auth.hashPassword(req.body.password), id);
    if (id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  res.json({ ok: true });
}));

module.exports = router;
