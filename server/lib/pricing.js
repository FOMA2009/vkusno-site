const { db, settings } = require('../db');
const { rub } = require('./util');

const MAX_QTY = 50;
const MAX_LINES = 40;

function loadProducts(ids) {
  if (!ids.length) return new Map();
  const ph = ids.map(() => '?').join(',');
  const prods = db.prepare(`SELECT p.*, c.is_active AS cat_active, c.name AS cat_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id IN (${ph})`).all(...ids);
  const vars = db.prepare(`SELECT * FROM product_variants WHERE product_id IN (${ph}) ORDER BY sort, id`).all(...ids);
  const opts = db.prepare(`SELECT * FROM product_options WHERE product_id IN (${ph}) ORDER BY sort, id`).all(...ids);
  const m = new Map();
  for (const p of prods) m.set(p.id, { ...p, variants: [], options: [] });
  for (const v of vars) m.get(v.product_id).variants.push(v);
  for (const o of opts) m.get(o.product_id).options.push(o);
  return m;
}

// ── Позиции корзины: цены берутся ТОЛЬКО из базы ──────────────
function priceLines(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems.slice(0, MAX_LINES) : [];
  const clean = items.map(i => ({
    product_id: Number.parseInt(i?.product_id, 10),
    variant_id: i?.variant_id ? Number.parseInt(i.variant_id, 10) : null,
    option_ids: Array.isArray(i?.option_ids) ? [...new Set(i.option_ids.map(n => Number.parseInt(n, 10)).filter(Number.isInteger))].sort((a, b) => a - b) : [],
    qty: Math.max(0, Math.min(MAX_QTY, Number.parseInt(i?.qty, 10) || 0)),
    ref: String(i?.ref ?? '').slice(0, 80),
  })).filter(i => Number.isInteger(i.product_id) && i.qty > 0);
  const products = loadProducts([...new Set(clean.map(i => i.product_id))]);

  return clean.map(i => {
    const p = products.get(i.product_id);
    const line = { ref: i.ref, product_id: i.product_id, variant_id: i.variant_id, option_ids: i.option_ids, qty: i.qty, issue: null };
    if (!p) return { ...line, name: 'Позиция удалена из меню', variant_name: '', options: [], unit_kop: 0, line_kop: 0, image: '', issue: 'gone' };
    line.name = p.name; line.slug = p.slug; line.image = p.image; line.category_id = p.category_id;
    line.variant_name = ''; line.options = [];
    let unit = p.price_kop;
    if (!p.is_active || !p.cat_active || !p.in_stock) line.issue = 'unavailable';
    if (p.variants.length) {
      const v = p.variants.find(x => x.id === i.variant_id);
      if (!v) { line.issue = line.issue || 'variant_required'; line.variant_id = null; }
      else {
        unit = v.price_kop; line.variant_name = v.name;
        if (!v.in_stock) line.issue = 'unavailable';
      }
    } else line.variant_id = null;
    for (const oid of i.option_ids) {
      const o = p.options.find(x => x.id === oid);
      if (!o) { line.issue = line.issue || 'bad_option'; continue; }
      line.options.push({ id: o.id, name: o.name, price_kop: o.price_kop });
      unit += o.price_kop;
    }
    if (p.price_kop <= 0 && !p.variants.length) line.issue = 'unavailable'; // цена не задана
    line.unit_kop = unit;
    line.line_kop = unit * i.qty;
    return line;
  });
}

// ── Промокод: проверка и расчёт скидки на сервере ─────────────
function evalPromo(codeRaw, lines, subtotal, now = new Date()) {
  const code = String(codeRaw || '').trim();
  if (!code) return null;
  const res = { code, status: 'not_found', discount_kop: 0, message: 'Такого промокода не существует' };
  const p = db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code);
  if (!p) return res;
  res.code = p.code;
  const fail = (status, message) => ({ ...res, status, message });
  if (!p.is_active) return fail('inactive', 'Промокод не активен');
  if (p.starts_at && now < new Date(p.starts_at)) return fail('not_started', 'Срок действия промокода ещё не начался');
  if (p.expires_at && now > new Date(p.expires_at)) return fail('expired', 'Срок действия промокода истёк');
  if (p.max_uses != null && p.used_count >= p.max_uses) return fail('exhausted', 'Лимит использований промокода исчерпан');
  if (subtotal < p.min_order_kop) return fail('min_order', `Промокод действует при заказе от ${rub(p.min_order_kop)}`);
  const cats = JSON.parse(p.category_ids || '[]'), prods = JSON.parse(p.product_ids || '[]');
  const restricted = cats.length || prods.length;
  const eligible = lines.filter(l => !l.issue && (!restricted || prods.includes(l.product_id) || cats.includes(l.category_id)))
    .reduce((s, l) => s + l.line_kop, 0);
  if (eligible <= 0) return fail('not_applicable', 'Промокод не подходит к блюдам в корзине');
  const raw = p.type === 'percent' ? Math.floor(eligible * Math.min(p.value, 100) / 100) : p.value;
  const discount = Math.min(raw, eligible);
  return { code: p.code, id: p.id, status: 'applied', discount_kop: discount, message: `Промокод применён: −${rub(discount)}` };
}

// ── Доставка: правила A / B / C и минимальная сумма ───────────
function deliveryRules(after, fulfillment, geo, geoState) {
  const min = settings.get('delivery.min_order_kop');
  const fee = settings.get('delivery.fee_kop');
  const freeFrom = settings.get('delivery.free_threshold_kop');
  const d = { fee_kop: 0, available: true, blocked_reason: null, zone: null, min_order_kop: min, free_threshold_kop: freeFrom, indicator: null };

  if (fulfillment === 'pickup') {
    d.indicator = { type: 'pickup', message: 'Самовывоз — без стоимости доставки' };
    return d;
  }
  if (!settings.get('delivery.enabled')) {
    return { ...d, available: false, blocked_reason: 'delivery_disabled', indicator: { type: 'disabled', message: 'Доставка временно недоступна. Вы можете выбрать самовывоз.' } };
  }
  if (!geo) {
    d.available = false;
    d.blocked_reason = geoState || 'no_address';
    d.indicator = { type: 'no_address', message: 'Укажите адрес, чтобы рассчитать стоимость доставки' };
    return d;
  }
  d.zone = { free: geo.free, reason: geo.free_reason, district: geo.district, distance_km: geo.distance_km, address: geo.label };
  const belowMin = after < min;
  if (belowMin) { d.available = false; d.blocked_reason = 'below_min'; d.remaining_min_kop = min - after; }

  if (geo.free) {
    d.fee_kop = 0;
    d.indicator = { type: 'free_zone', message: 'Отличные новости! На ваш адрес доставка бесплатная' };
  } else {
    d.fee_kop = after >= freeFrom ? 0 : fee; // при after < min показываем тариф, но оформление заблокировано
    const left = Math.max(0, freeFrom - after);
    const progress = Math.min(100, Math.round((after / freeFrom) * 1000) / 10);
    let message;
    if (after >= freeFrom) message = 'Поздравляем! Вы получили бесплатную доставку';
    else if (left <= 10000) message = `Ещё ${rub(left)} — и доставка за наш счёт!`;
    else if (belowMin) message = `Добавьте ещё на ${rub(left)} — и доставка будет бесплатной!`;
    else message = `До бесплатной доставки осталось ${rub(left)}`;
    d.indicator = { type: after >= freeFrom ? 'free_reached' : belowMin ? 'below_min' : 'progress', message, remaining_free_kop: left, progress };
  }
  if (belowMin) d.indicator.min_message = `Доставка пока недоступна: минимальная сумма заказа ${rub(min)}. Добавьте ещё на ${rub(min - after)}.`;
  return d;
}

// Единая точка расчёта: используется и корзиной (/api/quote), и оформлением заказа.
function quote({ items, promo_code, fulfillment, geo, geoState }) {
  fulfillment = fulfillment === 'pickup' ? 'pickup' : 'delivery';
  const lines = priceLines(items);
  const valid = lines.filter(l => !l.issue);
  const subtotal = valid.reduce((s, l) => s + l.line_kop, 0);
  const promo = evalPromo(promo_code, valid, subtotal);
  const discount = promo?.status === 'applied' ? promo.discount_kop : 0;
  const after = subtotal - discount;
  const delivery = deliveryRules(after, fulfillment, geo, geoState);
  const total = after + (delivery.available || delivery.blocked_reason === 'below_min' ? delivery.fee_kop : 0);
  const blocking = lines.filter(l => l.issue);
  return {
    fulfillment, lines, subtotal_kop: subtotal, discount_kop: discount, after_discount_kop: after,
    promo, delivery, total_kop: total,
    has_issues: blocking.length > 0,
    can_checkout: lines.length > 0 && blocking.length === 0 && (fulfillment === 'pickup' || delivery.available),
  };
}

module.exports = { quote, priceLines, MAX_QTY };
