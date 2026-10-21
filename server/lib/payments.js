// Модуль оплаты. На первом этапе онлайн-оплата ВЫКЛЮЧЕНА: фиктивных платежей нет.
// Чтобы подключить провайдера (ЮKassa, CloudPayments, Т-Банк и т.п.):
//   1. реализуйте объект провайдера с методами create(order) и verifyWebhook(req) и зарегистрируйте его ниже;
//   2. задайте секреты провайдера в переменных окружения (не в коде и не в браузере);
//   3. в админке: Настройки → Оплата → выберите провайдера и включите онлайн-оплату.
// Подтверждение оплаты принимается ТОЛЬКО через серверный webhook с проверкой подписи.
const { db, settings } = require('../db');

const providers = {
  // example: { title: 'Провайдер', create: async (order) => ({ externalId, redirectUrl }), verifyWebhook: (req) => ({ orderNumber, externalId, status }) }
};

const PAYMENT_STATUSES = ['unpaid', 'pending', 'paid', 'failed', 'refunded'];

function onlineAvailable() {
  const p = settings.get('payments.provider');
  return !!settings.get('payments.online_enabled') && !!p && !!providers[p];
}

function enabledMethods() {
  return (settings.get('payments.methods') || []).filter(m => m.enabled);
}

async function startOnlinePayment(order) {
  if (!onlineAvailable()) throw new Error('Онлайн-оплата не подключена');
  const prov = providers[settings.get('payments.provider')];
  const r = await prov.create(order);
  db.prepare('INSERT INTO payments(order_id,provider,status,amount_kop,external_id) VALUES(?,?,?,?,?)')
    .run(order.id, settings.get('payments.provider'), 'pending', order.total_kop, r.externalId || '');
  db.prepare("UPDATE orders SET payment_status = 'pending' WHERE id = ?").run(order.id);
  return r;
}

// Обработчик webhook. Без зарегистрированного провайдера всегда отвечает отказом.
function handleWebhook(providerCode, req) {
  const prov = providers[providerCode];
  if (!prov || !onlineAvailable()) return { ok: false, status: 501, error: 'provider_not_configured' };
  let evt;
  try { evt = prov.verifyWebhook(req); } catch { return { ok: false, status: 400, error: 'bad_signature' }; }
  if (!evt || !PAYMENT_STATUSES.includes(evt.status)) return { ok: false, status: 400, error: 'bad_event' };
  const order = db.prepare('SELECT id FROM orders WHERE number = ?').get(evt.orderNumber);
  if (!order) return { ok: false, status: 404, error: 'order_not_found' };
  db.prepare('UPDATE payments SET status = ? WHERE order_id = ? AND external_id = ?').run(evt.status, order.id, evt.externalId || '');
  db.prepare('UPDATE orders SET payment_status = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?').run(evt.status, order.id);
  return { ok: true, status: 200 };
}

module.exports = { providers, PAYMENT_STATUSES, onlineAvailable, enabledMethods, startOnlinePayment, handleWebhook };
