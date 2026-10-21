const crypto = require('crypto');
const { db, tx, settings } = require('../db');
const { quote } = require('./pricing');
const geo = require('./geo');
const mail = require('./mail');
const payments = require('./payments');
const { isOpenAt, nextOpening, STATUS_LABELS, STATUS_FLOW, rub } = require('./util');

class OrderError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.status = extra.status || 422; this.extra = extra; }
}

// Гео-часть расчёта: адрес принимается только по подписанному токену из /api/address/search
function resolveGeo(token, fulfillment) {
  if (fulfillment === 'pickup') return { geo: null, geoState: null };
  if (!token) return { geo: null, geoState: 'no_address' };
  const g = geo.resolveToken(token);
  return g ? { geo: g, geoState: null } : { geo: null, geoState: 'bad_address' };
}

function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') return '+7' + d;
  return null;
}

// «2025-01-31T19:30» по Москве (UTC+3, без перехода на летнее время) → Date
function parseMsk(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5]);
  return Number.isFinite(t) ? new Date(t) : null;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function validateContact(b, fulfillment) {
  const errors = {};
  const name = clip(b.name, 80);
  if (name.length < 2) errors.name = 'Укажите имя';
  const phone = normalizePhone(b.phone);
  if (!phone) errors.phone = 'Укажите телефон в формате +7 900 000-00-00';
  const email = clip(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Проверьте адрес электронной почты';
  if (b.consent_pd !== true) errors.consent_pd = 'Необходимо согласие на обработку персональных данных';
  return { errors, name, phone, email };
}

function checkTime(desired) {
  const sched = settings.get('hours.schedule');
  if (!settings.get('orders.accepting')) throw new OrderError('closed', settings.get('orders.closed_message'));
  const now = new Date();
  if (!desired) {
    if (!isOpenAt(sched, now)) {
      const n = nextOpening(sched, now);
      throw new OrderError('closed', 'Сейчас мы не принимаем заказы. ' + (n ? 'Откроемся ' + n.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'long', hour: '2-digit', minute: '2-digit' }) + ' (МСК). ' : '') + 'Вы можете оформить предзаказ на время работы.', { field: 'desired_time' });
    }
    return '';
  }
  const d = parseMsk(desired);
  const lead = settings.get('orders.min_lead_minutes') * 60000;
  if (!d || d.getTime() < now.getTime() + lead - 60000) throw new OrderError('bad_time', `Выберите время не ранее чем через ${settings.get('orders.min_lead_minutes')} минут`, { field: 'desired_time' });
  if (d.getTime() > now.getTime() + 3 * 864e5) throw new OrderError('bad_time', 'Предзаказ возможен не более чем на 3 дня вперёд', { field: 'desired_time' });
  if (!isOpenAt(sched, d)) throw new OrderError('bad_time', 'На выбранное время мы не работаем', { field: 'desired_time' });
  return desired.replace('T', ' ');
}

function publicOrder(o) { return { number: o.number, token: o.public_token, total_kop: o.total_kop, status: o.status }; }

function createOrder(body, user) {
  body = body || {};
  const key = clip(body.idempotency_key, 80);
  if (key.length < 16) throw new OrderError('bad_request', 'Некорректный запрос оформления', { status: 400 });

  // Повторная отправка (двойной клик, повтор после сетевой ошибки) возвращает уже созданный заказ
  const dup = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
  if (dup) return { ...publicOrder(dup), duplicate: true };

  const fulfillment = body.fulfillment === 'pickup' ? 'pickup' : 'delivery';
  const { errors, name, phone, email } = validateContact(body, fulfillment);
  const { geo: g, geoState } = resolveGeo(body.address_token, fulfillment);
  if (fulfillment === 'delivery' && !g) errors.address = geoState === 'bad_address' ? 'Адрес устарел — выберите его из подсказок заново' : 'Укажите адрес доставки и выберите его из списка';
  const methods = payments.enabledMethods();
  let paymentMethod = clip(body.payment_method, 40);
  if (methods.length) { if (!methods.some(m => m.code === paymentMethod)) errors.payment_method = 'Выберите способ оплаты'; }
  else paymentMethod = '';
  if (Object.keys(errors).length) throw new OrderError('validation', 'Проверьте заполнение формы', { errors });

  const desired = checkTime(clip(body.desired_time, 16));

  let result;
  try {
    result = tx(() => {
      // Цены, скидка и доставка пересчитываются на сервере в момент оформления
      const q = quote({ items: body.items, promo_code: body.promo_code, fulfillment, geo: g, geoState });
      if (!q.lines.length) throw new OrderError('empty_cart', 'Корзина пуста');
      if (q.has_issues) throw new OrderError('unavailable', 'Некоторые блюда недоступны. Обновите корзину.', { quote: q });
      if (q.promo && q.promo.status !== 'applied') throw new OrderError('promo', q.promo.message, { quote: q });
      if (fulfillment === 'delivery' && !q.delivery.available) {
        throw new OrderError('delivery_unavailable', q.delivery.blocked_reason === 'below_min'
          ? `Минимальная сумма заказа для доставки — ${rub(q.delivery.min_order_kop)}` : 'Доставка недоступна', { quote: q });
      }
      // Клиент видел итоговую сумму — если она изменилась, просим подтвердить заново
      if (Number.isInteger(body.expected_total_kop) && body.expected_total_kop !== q.total_kop) {
        throw new OrderError('price_changed', 'Стоимость заказа изменилась. Проверьте итоговую сумму.', { quote: q, status: 409 });
      }
      const ins = db.prepare(`INSERT INTO orders(number,public_token,idempotency_key,user_id,status,fulfillment,customer_name,phone,email,
        address,address_lat,address_lon,apartment,entrance,floor,intercom,courier_comment,comment,desired_time,
        subtotal_kop,discount_kop,delivery_fee_kop,total_kop,promo_code,delivery_zone,distance_km,payment_method,payment_status,consent_pd_at,consent_email)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const token = crypto.randomBytes(12).toString('hex');
      const r = ins.run('tmp-' + token, token, key, user?.id ?? null, 'new', fulfillment, name, phone, email,
        fulfillment === 'delivery' ? g.label : '', fulfillment === 'delivery' ? g.lat : null, fulfillment === 'delivery' ? g.lon : null,
        clip(body.apartment, 20), clip(body.entrance, 20), clip(body.floor, 20), clip(body.intercom, 30),
        clip(body.courier_comment, 300), clip(body.comment, 500), desired,
        q.subtotal_kop, q.discount_kop, q.delivery.fee_kop, q.total_kop, q.promo?.status === 'applied' ? q.promo.code : '',
        fulfillment === 'delivery' ? (g.free ? g.free_reason : 'paid') : 'pickup', fulfillment === 'delivery' ? g.distance_km : null,
        paymentMethod, 'unpaid', new Date().toISOString(), body.consent_email === true && email ? 1 : 0);
      const id = Number(r.lastInsertRowid);
      const number = 'VK-' + (1000 + id);
      db.prepare('UPDATE orders SET number = ? WHERE id = ?').run(number, id);
      const insItem = db.prepare('INSERT INTO order_items(order_id,product_id,name,variant_name,options_json,unit_price_kop,qty,line_total_kop) VALUES(?,?,?,?,?,?,?,?)');
      for (const l of q.lines) insItem.run(id, l.product_id, l.name, l.variant_name, JSON.stringify(l.options), l.unit_kop, l.qty, l.line_kop);
      db.prepare('INSERT INTO order_status_history(order_id,status,note) VALUES(?,?,?)').run(id, 'new', 'Заказ создан на сайте');
      if (q.promo?.status === 'applied') {
        const u = db.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)').run(q.promo.id);
        if (!Number(u.changes)) throw new OrderError('promo', 'Лимит использований промокода исчерпан', { quote: q });
      }
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    });
  } catch (e) {
    if (e instanceof OrderError) throw e;
    // гонка двух одинаковых запросов: уникальный индекс idempotency_key
    const again = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(key);
    if (again) return { ...publicOrder(again), duplicate: true };
    throw e;
  }

  notifyNewOrder(result.id).catch(e => console.error('notify error', e.message));
  return publicOrder(result);
}

async function notifyNewOrder(orderId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const adminTo = settings.get('mail.admin_to') || settings.get('contact.email');
  if (adminTo) await mail.sendMail({ to: adminTo, ...mail.adminOrderEmail(o, items) });
  if (o.email && o.consent_email) await mail.sendMail({ to: o.email, ...mail.customerOrderEmail(o, items) });
}

function changeStatus(orderId, status, note, userId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o) throw new OrderError('not_found', 'Заказ не найден', { status: 404 });
  if (!STATUS_FLOW[o.fulfillment].includes(status)) throw new OrderError('bad_status', 'Этот статус недоступен для данного способа получения', { status: 400 });
  if (o.status === status) return o;
  tx(() => {
    db.prepare("UPDATE orders SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, orderId);
    db.prepare('INSERT INTO order_status_history(order_id,status,note,user_id) VALUES(?,?,?,?)').run(orderId, status, clip(note, 300), userId ?? null);
  });
  const upd = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (settings.get('mail.notify_status_change') && upd.email && upd.consent_email) {
    mail.sendMail({ to: upd.email, ...mail.statusEmail(upd) }).catch(() => {});
  }
  return upd;
}

module.exports = { OrderError, createOrder, changeStatus, resolveGeo, STATUS_LABELS };
