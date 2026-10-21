const crypto = require('crypto');
const { TZ } = require('../config');

const RU = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
function slugify(s) {
  return String(s).toLowerCase().replace(/[а-яё]/g, c => RU[c] ?? '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// Деньги хранятся в копейках (целые числа), чтобы не накапливать ошибки округления.
function rub(kop) {
  const v = kop / 100;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2);
  const [i, f] = s.split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + f : '') + ' ₽';
}

const b64u = b => Buffer.from(b).toString('base64url');
function sign(secret, payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(secret, token) {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

// ── Время по Москве ──────────────────────────────────────────
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function mskParts(date = new Date()) {
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  const h = Number(o.hour) % 24;
  return { day: WD[o.weekday], minutes: h * 60 + Number(o.minute), ymd: `${o.year}-${o.month}-${o.day}` };
}
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// Открыто ли в момент date. Окно с close <= open переходит на следующие сутки.
function isOpenAt(schedule, date = new Date()) {
  const { day, minutes } = mskParts(date);
  for (const s of schedule) {
    const o = toMin(s.open), c = toMin(s.close);
    if (s.day === day) {
      if (c > o ? (minutes >= o && minutes < c) : minutes >= o) return true;
    }
    if (c <= o && s.day === (day + 6) % 7 && minutes < c) return true; // «хвост» вчерашней смены
  }
  return false;
}

// Следующий момент открытия (для сообщения «откроемся …»)
function nextOpening(schedule, from = new Date()) {
  for (let m = 1; m <= 8 * 24 * 60; m += 15) {
    const d = new Date(from.getTime() + m * 60000);
    if (isOpenAt(schedule, d) && !isOpenAt(schedule, new Date(d.getTime() - 15 * 60000))) return d;
  }
  return null;
}

const DAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
function describeSchedule(schedule) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];
  for (const d of order) {
    const s = schedule.find(x => x.day === d); if (!s) continue;
    const key = s.open + '–' + s.close;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(d); else groups.push({ key, days: [d], s });
  }
  return groups.map(g => {
    const days = g.days.length > 1 ? `${DAY_SHORT[g.days[0]]}–${DAY_SHORT[g.days[g.days.length - 1]]}` : DAY_SHORT[g.days[0]];
    const next = g.s.close < g.s.open ? ' (до ' + g.s.close + ' следующего дня)' : '';
    return { days, text: `${g.s.open}–${g.s.close}${next}` };
  });
}

const STATUS_LABELS = {
  new: 'Новый', confirmed: 'Подтверждён', cooking: 'Готовится', ready: 'Готов к выдаче',
  on_courier: 'Передан курьеру', done: 'Выполнен', cancelled: 'Отменён',
};
const STATUS_FLOW = {
  delivery: ['new', 'confirmed', 'cooking', 'on_courier', 'done', 'cancelled'],
  pickup: ['new', 'confirmed', 'cooking', 'ready', 'done', 'cancelled'],
};

module.exports = { slugify, esc, rub, sign, verify, mskParts, isOpenAt, nextOpening, describeSchedule, DAY_NAMES, STATUS_LABELS, STATUS_FLOW };
