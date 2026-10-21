const express = require('express');
const { db, settings } = require('../db');
const auth = require('../lib/auth');
const geo = require('../lib/geo');
const { quote } = require('../lib/pricing');
const orders = require('../lib/orders');
const payments = require('../lib/payments');
const { isOpenAt, nextOpening } = require('../lib/util');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function storeState() {
  const open = isOpenAt(settings.get('hours.schedule'));
  const accepting = !!settings.get('orders.accepting');
  const n = !open ? nextOpening(settings.get('hours.schedule')) : null;
  return { open, accepting, next_open: n ? n.toISOString() : null, message: accepting ? '' : settings.get('orders.closed_message') };
}

// ── Расчёт корзины (клиенту доверяется только состав и выбор) ─
router.post('/quote', auth.rateLimit({ windowMs: 60_000, max: 300 }), (req, res) => {
  const b = req.body || {};
  const fulfillment = b.fulfillment === 'pickup' ? 'pickup' : 'delivery';
  const { geo: g, geoState } = orders.resolveGeo(b.address_token, fulfillment);
  const q = quote({ items: b.items, promo_code: b.promo_code, fulfillment, geo: g, geoState });
  res.json({ quote: q, store: storeState(), payment_methods: payments.enabledMethods().map(m => ({ code: m.code, title: m.title })) });
});

// ── Поиск адреса (геокодирование на сервере) ──────────────────
router.post('/address/search', auth.rateLimit({ windowMs: 60_000, max: 30 }), wrap(async (req, res) => {
  try {
    const r = await geo.search(req.body?.q);
    res.json(r);
  } catch {
    // Геокодер недоступен: ни в коем случае не выдаём адрес и не назначаем бесплатную доставку
    res.status(503).json({ error: 'geocoder_unavailable', message: 'Не удалось проверить адрес. Попробуйте ещё раз или выберите самовывоз.' });
  }
}));

// ── Оформление заказа ─────────────────────────────────────────
router.post('/order', auth.rateLimit({ windowMs: 10 * 60_000, max: 20 }), wrap(async (req, res) => {
  try {
    const r = orders.createOrder(req.body, req.user);
    res.status(r.duplicate ? 200 : 201).json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof orders.OrderError) {
      return res.status(e.status).json({ ok: false, error: e.code, message: e.message, ...e.extra.errors && { errors: e.extra.errors }, field: e.extra.field, quote: e.extra.quote });
    }
    console.error('order failed', e);
    res.status(500).json({ ok: false, error: 'server_error', message: 'Не удалось сохранить заказ. Ничего не списано — попробуйте ещё раз.' });
  }
}));

// ── Клиентские аккаунты ───────────────────────────────────────
const clipS = (v, n) => String(v ?? '').trim().slice(0, n);
const userView = u => ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role });

router.get('/me', (req, res) => res.json({ user: req.user ? userView(req.user) : null, csrf: req.user ? req.csrf : null }));

router.post('/auth/register', auth.rateLimit({ windowMs: 60 * 60_000, max: 10 }), wrap(async (req, res) => {
  const email = clipS(req.body?.email, 120).toLowerCase();
  const pwErr = auth.validatePassword(req.body?.password);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(422).json({ message: 'Проверьте адрес электронной почты' });
  if (pwErr) return res.status(422).json({ message: pwErr });
  if (req.body?.consent_pd !== true) return res.status(422).json({ message: 'Необходимо согласие на обработку персональных данных' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ message: 'Этот email уже зарегистрирован' });
  const hash = await auth.hashPassword(req.body.password);
  const r = db.prepare("INSERT INTO users(email,password_hash,name,phone,role) VALUES(?,?,?,?,'customer')")
    .run(email, hash, clipS(req.body.name, 80), clipS(req.body.phone, 25));
  const csrf = auth.createSession(res, Number(r.lastInsertRowid));
  res.status(201).json({ user: userView({ id: Number(r.lastInsertRowid), email, name: clipS(req.body.name, 80), phone: clipS(req.body.phone, 25), role: 'customer' }), csrf });
}));

router.post('/auth/login', auth.rateLimit({ windowMs: 15 * 60_000, max: 10, key: req => req.ip + '|' + String(req.body?.email || '').toLowerCase() }), wrap(async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(clipS(req.body?.email, 120));
  const ok = u && u.is_active && await auth.checkPassword(String(req.body?.password || ''), u.password_hash);
  if (!ok) return res.status(401).json({ message: 'Неверный email или пароль' });
  const csrf = auth.createSession(res, u.id);
  res.json({ user: userView(u), csrf });
}));

router.post('/auth/logout', (req, res) => { auth.destroySession(req, res); res.json({ ok: true }); });

router.get('/me/orders', auth.requireRole('customer', 'manager', 'admin'), (req, res) => {
  const rows = db.prepare('SELECT number, public_token, status, fulfillment, total_kop, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ orders: rows });
});

router.put('/me', auth.requireRole('customer', 'manager', 'admin'), (req, res) => {
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(clipS(req.body?.name, 80), clipS(req.body?.phone, 25), req.user.id);
  res.json({ ok: true });
});

// ── Webhook платёжного провайдера (до подключения всегда 501) ──
router.post('/payments/webhook/:provider', (req, res) => {
  const r = payments.handleWebhook(req.params.provider, req);
  res.status(r.status).json(r.ok ? { ok: true } : { error: r.error });
});

module.exports = router;
