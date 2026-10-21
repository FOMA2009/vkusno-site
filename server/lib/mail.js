const nodemailer = require('nodemailer');
const { db, settings } = require('../db');
const { SMTP } = require('../config');
const { esc, rub, STATUS_LABELS } = require('./util');

// Почта считается настроенной только если включена в настройках, заданы SMTP-учётные данные
// в переменных окружения и адрес отправителя. Иначе письма не отправляются и это видно в журнале.
function status() {
  const missing = [];
  if (!SMTP.host) missing.push('SMTP_HOST');
  if (!SMTP.user) missing.push('SMTP_USER');
  if (!SMTP.pass) missing.push('SMTP_PASS');
  if (!settings.get('mail.from')) missing.push('адрес отправителя');
  return { enabled: !!settings.get('mail.enabled'), configured: missing.length === 0, missing };
}

let transporter;
function getTransport() {
  if (!transporter) transporter = nodemailer.createTransport({
    host: SMTP.host, port: SMTP.port, secure: SMTP.secure,
    auth: { user: SMTP.user, pass: SMTP.pass }, connectionTimeout: 10000, socketTimeout: 15000,
  });
  return transporter;
}
const log = (to, subject, st, error = '') =>
  db.prepare('INSERT INTO email_log(to_addr,subject,status,error) VALUES(?,?,?,?)').run(to, subject, st, String(error).slice(0, 500));

async function sendMail({ to, subject, html, text }) {
  const s = status();
  if (!to) return { sent: false, reason: 'no_recipient' };
  if (!s.enabled) { log(to, subject, 'skipped', 'Почта выключена в настройках'); return { sent: false, reason: 'disabled' }; }
  if (!s.configured) { log(to, subject, 'skipped', 'Не настроено: ' + s.missing.join(', ')); return { sent: false, reason: 'not_configured' }; }
  try {
    await getTransport().sendMail({ from: settings.get('mail.from'), to, subject, html, text });
    log(to, subject, 'sent');
    return { sent: true };
  } catch (e) {
    log(to, subject, 'error', e.message);
    return { sent: false, reason: 'error', error: e.message };
  }
}

// ── Шаблоны писем ────────────────────────────────────────────
function dt(iso) {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }) + ' (МСК)';
}
function itemsTable(items) {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px">${items.map(i => {
    const opts = JSON.parse(i.options_json || '[]').map(o => o.name).join(', ');
    return `<tr><td style="padding:6px 0;border-bottom:1px solid #ddd">${esc(i.name)}${i.variant_name ? ` — ${esc(i.variant_name)}` : ''}${opts ? `<br><small>+ ${esc(opts)}</small>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #ddd;white-space:nowrap">${i.qty} × ${rub(i.unit_price_kop)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap">${rub(i.line_total_kop)}</td></tr>`;
  }).join('')}</table>`;
}
function totals(o) {
  return `<p style="font-size:14px;line-height:1.7">Сумма блюд: ${rub(o.subtotal_kop)}<br>
    Скидка${o.promo_code ? ` (${esc(o.promo_code)})` : ''}: −${rub(o.discount_kop)}<br>
    Доставка: ${o.fulfillment === 'pickup' ? 'самовывоз' : o.delivery_fee_kop ? rub(o.delivery_fee_kop) : 'бесплатно'}<br>
    <b style="font-size:16px">Итого: ${rub(o.total_kop)}</b></p>`;
}
const how = o => o.fulfillment === 'pickup'
  ? `Самовывоз: ${esc(settings.get('contact.address'))}`
  : `Доставка: ${esc(o.address)}${o.apartment ? `, кв. ${esc(o.apartment)}` : ''}${o.entrance ? `, подъезд ${esc(o.entrance)}` : ''}${o.floor ? `, этаж ${esc(o.floor)}` : ''}${o.intercom ? `, домофон ${esc(o.intercom)}` : ''}`;

function adminOrderEmail(o, items) {
  const subject = `Новый заказ ${o.number} — ${rub(o.total_kop)}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2>Новый заказ ${esc(o.number)}</h2>
    <p style="font-size:14px;line-height:1.7">Дата и время: ${dt(o.created_at)}<br>Статус: ${STATUS_LABELS[o.status]}<br>
    Клиент: ${esc(o.customer_name)}<br>Телефон: ${esc(o.phone)}<br>Email: ${esc(o.email) || '—'}<br>
    ${how(o)}<br>${o.desired_time ? `Желаемое время: ${esc(o.desired_time)}<br>` : ''}
    Оплата: ${esc(o.payment_method) || 'не выбрана'} (${esc(o.payment_status)})</p>
    ${itemsTable(items)}<p>Позиций: ${items.length}, порций: ${items.reduce((s, i) => s + i.qty, 0)}</p>${totals(o)}
    ${o.courier_comment ? `<p>Комментарий курьеру: ${esc(o.courier_comment)}</p>` : ''}${o.comment ? `<p>Комментарий к заказу: ${esc(o.comment)}</p>` : ''}</div>`;
  return { subject, html, text: html.replace(/<[^>]+>/g, ' ') };
}
function customerOrderEmail(o, items) {
  const subject = `Ваш заказ ${o.number} принят — ${settings.get('site.name')}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><h2>Спасибо за заказ!</h2>
    <p>Номер заказа: <b>${esc(o.number)}</b>. Мы свяжемся с вами для подтверждения.</p>
    <p style="font-size:14px">${how(o)}</p>${itemsTable(items)}${totals(o)}
    <p style="color:#666;font-size:12px">Это подтверждение заказа, а не кассовый чек. Вопросы: ${esc(settings.get('contact.phone'))}</p></div>`;
  return { subject, html, text: html.replace(/<[^>]+>/g, ' ') };
}
function statusEmail(o) {
  const subject = `Заказ ${o.number}: ${STATUS_LABELS[o.status]}`;
  const html = `<div style="font-family:Arial,sans-serif"><p>Статус вашего заказа <b>${esc(o.number)}</b> изменён: <b>${STATUS_LABELS[o.status]}</b>.</p></div>`;
  return { subject, html, text: html.replace(/<[^>]+>/g, ' ') };
}

module.exports = { sendMail, status, adminOrderEmail, customerOrderEmail, statusEmail };
