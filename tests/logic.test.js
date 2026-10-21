// Тесты бизнес-логики на изолированной базе в памяти: node --test tests/
process.env.DB_FILE = ':memory:';
process.env.DATA_DIR = require('os').tmpdir();
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, settings } = require('../server/db');
const { seedAll } = require('../server/seed');
seedAll();
const { quote } = require('../server/lib/pricing');
const geo = require('../server/lib/geo');
const orders = require('../server/lib/orders');
const cfg = require('../server/config');
const { sign } = require('../server/lib/util');

const R = n => n * 100; // рубли → копейки
// Тестовые блюда с точными ценами
const cat = Number(db.prepare("INSERT INTO categories(slug,name) VALUES('t','Тест')").run().lastInsertRowid);
const mk = (name, rub, extra = {}) => Number(db.prepare('INSERT INTO products(category_id,slug,name,price_kop,in_stock,is_active) VALUES(?,?,?,?,?,?)')
  .run(cat, 't-' + name, name, R(rub), extra.in_stock ?? 1, extra.is_active ?? 1).lastInsertRowid);
const P = { p1200: mk('a1200', 1200), p1500: mk('a1500', 1500), p2950: mk('a2950', 2950), p3000: mk('a3000', 3000), p3100: mk('a3100', 3100), p100: mk('a100', 100), off: mk('off', 500, { in_stock: 0 }), hidden: mk('hid', 500, { is_active: 0 }) };
const items = (id, qty = 1) => [{ product_id: id, qty }];
const G = {
  district: { free: true, free_reason: 'district', district: 'Автозаводский район', distance_km: 2, label: 'Адрес А' },
  radius: { free: true, free_reason: 'radius', district: null, distance_km: 4.2, label: 'Адрес Б' },
  far: { free: false, free_reason: null, district: null, distance_km: 11, label: 'Адрес В' },
};
const q = (id, geoObj, opt = {}) => quote({ items: items(id, opt.qty || 1), fulfillment: opt.ful || 'delivery', geo: geoObj, promo_code: opt.promo });

test('A. Автозаводский район: бесплатно при минимальной сумме и выше', () => {
  for (const id of [P.p1500, P.p2950, P.p3000]) { const r = q(id, G.district); assert.equal(r.delivery.fee_kop, 0); assert.equal(r.delivery.available, true); assert.equal(r.total_kop, r.subtotal_kop); }
  assert.equal(q(P.p1500, G.district).delivery.indicator.message, 'Отличные новости! На ваш адрес доставка бесплатная');
});
test('B. Радиус 5 км: бесплатно, индикатор 3000 не показывается', () => {
  const r = q(P.p1500, G.radius);
  assert.equal(r.delivery.fee_kop, 0); assert.equal(r.delivery.indicator.type, 'free_zone'); assert.equal(r.delivery.indicator.progress, undefined);
});
test('Минимальная сумма 1500 ₽ блокирует доставку и показывает остаток', () => {
  const r = q(P.p1200, G.district);
  assert.equal(r.delivery.available, false); assert.equal(r.delivery.blocked_reason, 'below_min'); assert.equal(r.delivery.remaining_min_kop, R(300));
  assert.match(r.delivery.indicator.min_message, /минимальная сумма заказа 1\s500\s₽/); assert.equal(r.can_checkout, false);
});
test('C. Вне зоны: 1200 ₽ → тариф 199 ₽, оформление заблокировано, сообщение про 1 800 ₽', () => {
  const r = q(P.p1200, G.far);
  assert.equal(r.delivery.fee_kop, R(199)); assert.equal(r.delivery.available, false);
  assert.equal(r.delivery.indicator.message, 'Добавьте ещё на 1 800 ₽ — и доставка будет бесплатной!');
  assert.match(r.delivery.indicator.min_message, /пока недоступна/);
});
test('C. Вне зоны: 1500–2999 ₽ → 199 ₽ и доступно; 2500 → «осталось 500»', () => {
  const r1 = q(P.p1500, G.far); assert.equal(r1.delivery.fee_kop, R(199)); assert.equal(r1.delivery.available, true); assert.equal(r1.total_kop, R(1699));
  const r2 = quote({ items: [{ product_id: P.p1500, qty: 1 }, { product_id: P.p100, qty: 10 }], fulfillment: 'delivery', geo: G.far }); // 2500
  assert.equal(r2.subtotal_kop, R(2500)); assert.equal(r2.delivery.indicator.message, 'До бесплатной доставки осталось 500 ₽');
});
test('Вне зоны: 2950 ₽ → «Ещё 50 ₽», прогресс < 100', () => {
  const r = q(P.p2950, G.far);
  assert.equal(r.delivery.indicator.message, 'Ещё 50 ₽ — и доставка за наш счёт!'); assert.equal(r.delivery.indicator.remaining_free_kop, R(50)); assert.ok(r.delivery.indicator.progress < 100);
});
test('Вне зоны: 3000 ₽ → доставка бесплатна; ниже порога платная возвращается', () => {
  const r = q(P.p3000, G.far); assert.equal(r.delivery.fee_kop, 0); assert.equal(r.delivery.indicator.message, 'Поздравляем! Вы получили бесплатную доставку'); assert.equal(r.delivery.indicator.progress, 100);
  const back = q(P.p2950, G.far); assert.equal(back.delivery.fee_kop, R(199)); // «удалили блюдо»
  const lower = q(P.p1200, G.far); assert.equal(lower.delivery.available, false);
});
test('Самовывоз: любая сумма, доставка 0, индикатор скрыт', () => {
  const r = q(P.p100, G.far, { ful: 'pickup' });
  assert.equal(r.delivery.fee_kop, 0); assert.equal(r.delivery.available, true); assert.equal(r.can_checkout, true);
  assert.equal(r.delivery.indicator.message, 'Самовывоз — без стоимости доставки'); assert.equal(r.total_kop, R(100));
});
test('Без адреса: просьба указать адрес, оформление доставки недоступно', () => {
  const r = q(P.p3000, null);
  assert.equal(r.delivery.indicator.message, 'Укажите адрес, чтобы рассчитать стоимость доставки'); assert.equal(r.can_checkout, false);
});
test('Временное отключение доставки', () => {
  settings.set('delivery.enabled', false);
  try { const r = q(P.p3000, G.district); assert.equal(r.can_checkout, false); assert.equal(r.delivery.blocked_reason, 'delivery_disabled'); assert.equal(q(P.p3000, null, { ful: 'pickup' }).can_checkout, true); }
  finally { settings.set('delivery.enabled', true); }
});

// ── Промокоды ────────────────────────────────────────────────
const promo = (o = {}) => { const d = { code: 'T' + Math.random().toString(36).slice(2, 8).toUpperCase(), type: 'percent', value: 10, min: 0, active: 1, exp: null, start: null, max: null, cats: '[]', prods: '[]', ...o };
  db.prepare('INSERT INTO promo_codes(code,type,value,min_order_kop,is_active,expires_at,starts_at,max_uses,category_ids,product_ids) VALUES(?,?,?,?,?,?,?,?,?,?)').run(d.code, d.type, d.value, d.min, d.active, d.exp, d.start, d.max, d.cats, d.prods); return d.code; };
test('Промокод: процент и рубли пересчитывают итог', () => {
  const r = q(P.p2950, G.district, { promo: promo({ value: 10 }) }); assert.equal(r.discount_kop, R(295)); assert.equal(r.after_discount_kop, R(2655));
  const r2 = q(P.p2950, G.district, { promo: promo({ type: 'fixed', value: R(250) }) }); assert.equal(r2.discount_kop, R(250)); assert.equal(r2.total_kop, R(2700));
});
test('Порог 3000 считается ПОСЛЕ скидки', () => {
  const r = q(P.p3100, G.far, { promo: promo({ value: 10 }) }); // 3100 − 310 = 2790 → платная
  assert.equal(r.after_discount_kop, R(2790)); assert.equal(r.delivery.fee_kop, R(199));
  const r2 = q(P.p3100, G.far, { promo: promo({ type: 'fixed', value: R(50) }) }); assert.equal(r2.delivery.fee_kop, 0); // 3050 ≥ 3000
});
test('Минимум 1500 ₽ считается после скидки', () => {
  const r = q(P.p1500, G.district, { promo: promo({ value: 10 }) }); assert.equal(r.delivery.available, false);
});
test('Некорректные промокоды отклоняются', () => {
  assert.equal(q(P.p2950, G.district, { promo: 'NOPE123' }).promo.status, 'not_found');
  assert.equal(q(P.p2950, G.district, { promo: promo({ exp: '2000-01-01T00:00:00Z' }) }).promo.status, 'expired');
  assert.equal(q(P.p2950, G.district, { promo: promo({ start: '2099-01-01T00:00:00Z' }) }).promo.status, 'not_started');
  assert.equal(q(P.p2950, G.district, { promo: promo({ active: 0 }) }).promo.status, 'inactive');
  assert.equal(q(P.p2950, G.district, { promo: promo({ min: R(5000) }) }).promo.status, 'min_order');
  const used = promo({ max: 1 }); db.prepare('UPDATE promo_codes SET used_count = 1 WHERE code = ?').run(used);
  assert.equal(q(P.p2950, G.district, { promo: used }).promo.status, 'exhausted');
  assert.equal(q(P.p2950, G.district, { promo: promo({ prods: JSON.stringify([P.p100]) }) }).promo.status, 'not_applicable');
  assert.equal(q(P.p2950, G.district, { promo: promo({ value: 10 }) }).discount_kop, R(295));
  assert.equal(q(P.p2950, G.district, { promo: 'NOPE123' }).discount_kop, 0);
});
test('Промокод ограничен категорией/блюдом — скидка только на подходящее', () => {
  const code = promo({ value: 50, prods: JSON.stringify([P.p100]) });
  const r = quote({ items: [{ product_id: P.p100, qty: 2 }, { product_id: P.p1500, qty: 1 }], fulfillment: 'pickup', promo_code: code });
  assert.equal(r.discount_kop, R(100)); // 50% только от 200 ₽
});

// ── Защита от подмены и недоступные блюда ────────────────────
test('Цена из клиента игнорируется; недоступные и скрытые блюда нельзя заказать', () => {
  const r = quote({ items: [{ product_id: P.p100, qty: 1, price_kop: 1, unit_kop: 1, discount_kop: 99999, delivery_fee_kop: 0 }], fulfillment: 'pickup', discount_kop: 9999, total_kop: 1 });
  assert.equal(r.total_kop, R(100));
  assert.equal(q(P.off, G.district).can_checkout, false); assert.equal(q(P.off, G.district).lines[0].issue, 'unavailable');
  assert.equal(q(P.hidden, G.district).lines[0].issue, 'unavailable');
  assert.equal(quote({ items: [{ product_id: 99999, qty: 1 }], fulfillment: 'pickup' }).can_checkout, false);
});
test('Блюдо с вариантами требует выбора варианта; цена берётся из варианта', () => {
  const p = db.prepare("SELECT id FROM products WHERE slug = 'shashlyk-iz-svinoy-shei'").get();
  const vars = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort').all(p.id);
  assert.equal(quote({ items: [{ product_id: p.id, qty: 1 }], fulfillment: 'pickup' }).lines[0].issue, 'variant_required');
  const r = quote({ items: [{ product_id: p.id, variant_id: vars[1].id, qty: 2 }], fulfillment: 'pickup' }); // 200 г × 2
  assert.equal(r.lines[0].unit_kop, vars[1].price_kop); assert.equal(r.total_kop, vars[1].price_kop * 2);
});
test('Добавки увеличивают цену', () => {
  const p = db.prepare("SELECT id FROM products WHERE slug = 'shaurma-s-kuricey'").get();
  const opts = db.prepare('SELECT * FROM product_options WHERE product_id = ?').all(p.id);
  const cheese = opts.find(o => o.name === 'Сыр');
  const base = db.prepare('SELECT price_kop FROM products WHERE id = ?').get(p.id).price_kop;
  assert.equal(quote({ items: [{ product_id: p.id, option_ids: [cheese.id], qty: 1 }], fulfillment: 'pickup' }).total_kop, base + cheese.price_kop);
});

// ── Геозона ──────────────────────────────────────────────────
test('Зоны по координатам: район, радиус, вне зоны; расчёт без подтверждённых границ не даёт бесплатную доставку', () => {
  const rLat = settings.get('contact.lat'), rLon = settings.get('contact.lon');
  const own = geo.classifyPoint(rLat, rLon); assert.equal(own.free, true); assert.ok(own.distance_km < 0.01);
  const far = geo.classifyPoint(56.2965, 43.9361 + 0.2); assert.equal(far.free, false); // ~ далеко на восток
  const dz = geo.classifyPoint(56.2380, 43.4600); assert.equal(dz.free, false); assert.equal(dz.district, null); // Дзержинск
  // точка в радиусе 5 км, но вне Автозаводского района
  let found = null;
  for (let dlat = -0.045; dlat <= 0.045 && !found; dlat += 0.003) for (let dlon = -0.08; dlon <= 0.08 && !found; dlon += 0.004) {
    const c = geo.classifyPoint(rLat + dlat, rLon + dlon); if (c.distance_km <= 4.8 && !c.district) found = c;
  }
  assert.ok(found, 'есть точка в радиусе 5 км вне района'); assert.equal(found.free, true); assert.equal(found.free_reason, 'radius');
});
test('Токен адреса нельзя подделать (координаты подписаны сервером)', () => {
  const good = sign(cfg.SECRET, { l: 'Тест', lat: 56.27, lon: 43.87, exp: Date.now() + 1e5 });
  assert.ok(geo.resolveToken(good));
  const [body, mac] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ l: 'Тест', lat: 56.27, lon: 43.87, exp: Date.now() + 1e5 })).toString('base64url') + '.' + mac;
  assert.equal(geo.resolveToken(forged), null); assert.equal(geo.resolveToken('abc'), null);
  assert.equal(geo.resolveToken(sign(cfg.SECRET, { l: 'x', lat: 1, lon: 1, exp: Date.now() - 1 })), null);
  assert.equal(geo.resolveToken(sign('другой-секрет', { l: 'x', lat: 56.27, lon: 43.87, exp: Date.now() + 1e5 })), null);
});

// ── Оформление заказа ────────────────────────────────────────
const tokenFor = (lat, lon, label = 'Нижний Новгород, тестовая, 1') => sign(cfg.SECRET, { l: label, lat, lon, exp: Date.now() + 1e5 });
const base = (o = {}) => ({ idempotency_key: 'k-' + Math.random().toString(36).slice(2) + '0000000000', fulfillment: 'pickup', items: items(P.p100, 2), name: 'Иван', phone: '8 (900) 123-45-67', email: '', consent_pd: true, payment_method: 'on_receipt', ...o });
test('Заказ: сохраняются цены на момент покупки, номер, история, телефон нормализуется', () => {
  const r = orders.createOrder(base({ payment_method: 'on_receipt' }), null);
  assert.match(r.number, /^VK-\d+$/); assert.ok(r.token);
  const o = db.prepare('SELECT * FROM orders WHERE number = ?').get(r.number); assert.equal(o.phone, '+79001234567'); assert.equal(o.total_kop, R(200)); assert.equal(o.status, 'new');
  db.prepare('UPDATE products SET price_kop = ? WHERE id = ?').run(R(999), P.p100); // цена меню изменилась
  assert.equal(db.prepare('SELECT unit_price_kop FROM order_items WHERE order_id = ?').get(o.id).unit_price_kop, R(100)); // заказ не изменился
  db.prepare('UPDATE products SET price_kop = ? WHERE id = ?').run(R(100), P.p100);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_status_history WHERE order_id = ?').get(o.id).n, 1);
});
test('Двойное нажатие: тот же ключ возвращает тот же заказ без дубля', () => {
  const b = base(); const a = orders.createOrder(b, null), c = orders.createOrder(b, null);
  assert.equal(a.number, c.number); assert.equal(c.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders WHERE idempotency_key = ?').get(b.idempotency_key).n, 1);
});
test('Валидация: имя, телефон, согласие; доставка требует подтверждённый адрес', () => {
  assert.throws(() => orders.createOrder(base({ name: '', phone: '123', consent_pd: false }), null), e => e.code === 'validation' && !!e.extra.errors.name && !!e.extra.errors.phone && !!e.extra.errors.consent_pd);
  assert.throws(() => orders.createOrder(base({ fulfillment: 'delivery', items: items(P.p3000) }), null), e => !!e.extra.errors?.address);
  assert.throws(() => orders.createOrder(base({ fulfillment: 'delivery', items: items(P.p3000), address_token: 'поддельный.токен' }), null), e => !!e.extra.errors?.address);
});
test('Доставка: сумма и тариф пересчитываются сервером, подмена игнорируется', () => {
  const lat = 56.2965, lon = 44.2; // вне зоны
  const far = geo.classifyPoint(lat, lon); assert.equal(far.free, false);
  const ok = orders.createOrder(base({ fulfillment: 'delivery', items: items(P.p1500), address_token: tokenFor(lat, lon), total_kop: 1, delivery_fee_kop: 0, discount_kop: 99999 }), null);
  const o = db.prepare('SELECT * FROM orders WHERE number = ?').get(ok.number); assert.equal(o.delivery_fee_kop, R(199)); assert.equal(o.total_kop, R(1699)); assert.equal(o.delivery_zone, 'paid');
  assert.throws(() => orders.createOrder(base({ fulfillment: 'delivery', items: items(P.p1200), address_token: tokenFor(lat, lon) }), null), e => e.code === 'delivery_unavailable');
  const own = orders.createOrder(base({ fulfillment: 'delivery', items: items(P.p1500), address_token: tokenFor(settings.get('contact.lat'), settings.get('contact.lon')) }), null);
  assert.equal(db.prepare('SELECT delivery_fee_kop f, delivery_zone z FROM orders WHERE number = ?').get(own.number).f, 0);
});
test('Заказ отклоняется, если сумма изменилась (клиент видел другую итоговую)', () => {
  assert.throws(() => orders.createOrder(base({ expected_total_kop: R(1) }), null), e => e.code === 'price_changed' && e.status === 409);
});
test('Недоступное блюдо и пустая корзина не оформляются', () => {
  assert.throws(() => orders.createOrder(base({ items: items(P.off) }), null), e => e.code === 'unavailable');
  assert.throws(() => orders.createOrder(base({ items: [] }), null), e => e.code === 'empty_cart');
});
test('Промокод при заказе увеличивает счётчик и уважает лимит', () => {
  const code = promo({ max: 1, value: 10 });
  const r = orders.createOrder(base({ promo_code: code, items: items(P.p1500) }), null);
  assert.equal(db.prepare('SELECT discount_kop d FROM orders WHERE number = ?').get(r.number).d, R(150));
  assert.equal(db.prepare('SELECT used_count u FROM promo_codes WHERE code = ?').get(code).u, 1);
  assert.throws(() => orders.createOrder(base({ promo_code: code, items: items(P.p1500) }), null), e => e.code === 'promo');
});
test('Закрыт приём заказов — заказ не создаётся', () => {
  settings.set('orders.accepting', false);
  try { assert.throws(() => orders.createOrder(base(), null), e => e.code === 'closed'); } finally { settings.set('orders.accepting', true); }
});
test('Статусы зависят от способа получения, история сохраняется', () => {
  const r = orders.createOrder(base(), null); const id = db.prepare('SELECT id FROM orders WHERE number = ?').get(r.number).id;
  assert.throws(() => orders.changeStatus(id, 'on_courier', '', null), e => e.code === 'bad_status'); // самовывоз без курьера
  orders.changeStatus(id, 'ready', 'Собран', null); assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(id).status, 'ready');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM order_status_history WHERE order_id = ?').get(id).n, 2);
});
test('Онлайн-оплата выключена по умолчанию', () => {
  const pay = require('../server/lib/payments');
  assert.equal(pay.onlineAvailable(), false); assert.equal(settings.get('payments.online_enabled'), false);
  assert.equal(pay.handleWebhook('any', {}).status, 501);
});
test('Начальные настройки доставки соответствуют ТЗ', () => {
  assert.equal(settings.get('delivery.fee_kop'), 19900); assert.equal(settings.get('delivery.free_threshold_kop'), 300000);
  assert.equal(settings.get('delivery.min_order_kop'), 150000); assert.equal(settings.get('delivery.free_radius_km'), 5);
  assert.deepEqual(settings.get('delivery.free_districts'), ['autozavodsky']);
});

test('Закреплённые цены применены; у видимых блюд и вариантов нет нулевых цен', () => {
  const prices = require('../server/seed/prices.json');
  const p = db.prepare("SELECT price_kop FROM products WHERE slug = 'shaurma-s-kuricey'").get();
  assert.equal(p.price_kop, prices['shaurma-s-kuricey'].price_kop);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_active = 1 AND p.slug NOT LIKE 't-%' AND v.price_kop <= 0`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM products p WHERE p.is_active = 1 AND p.slug NOT LIKE 't-%' AND p.price_kop <= 0 AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`).get().n, 0);
  // порции шашлыка пропорциональны цене за 100 г
  const v = db.prepare("SELECT name, price_kop FROM product_variants WHERE product_id = (SELECT id FROM products WHERE slug = 'shashlyk-iz-svinoy-shei') ORDER BY sort").all();
  assert.equal(v[1].price_kop, v[0].price_kop * 2); assert.equal(v[3].price_kop, v[0].price_kop * 5);
});
