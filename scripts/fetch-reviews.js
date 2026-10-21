// Снимок отзывов со страницы организации на Яндекс.Картах → scripts/data/yandex-reviews.json
// Запуск: node scripts/fetch-reviews.js   (можно по расписанию, например раз в сутки)
// Тексты отзывов не изменяются. Если Яндекс сменит разметку или покажет капчу, скрипт сохранит прежний снимок.
const fs = require('fs');
const path = require('path');
const URL_ = process.env.REVIEWS_SOURCE || 'https://yandex.ru/maps/org/v_kusno/126128588630/reviews/';
const OUT = path.join(__dirname, 'data', 'yandex-reviews.json');

// Вырезает JSON-значение, начиная с позиции открывающей скобки (учитывает строки и экранирование)
function sliceJson(text, start) {
  const open = text[start], close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === open) depth++; else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('JSON не закрыт');
}

(async () => {
  const r = await fetch(URL_, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36', 'Accept-Language': 'ru' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const html = await r.text();
  if (/showcaptcha/i.test(html)) throw new Error('Яндекс показал капчу — повторите позже');
  const a = html.indexOf('"reviewResults":{"reviews":[');
  if (a < 0) throw new Error('Блок отзывов не найден (изменилась разметка?)');
  const arr = JSON.parse(sliceJson(html, html.indexOf('[', a)));
  const rd = JSON.parse(sliceJson(html, html.indexOf('{', html.indexOf('"ratingData":'))));
  const reviews = arr.filter(x => x.text && x.text.trim()).map(x => ({
    id: x.reviewId, author: x.author?.name || 'Гость', level: x.author?.professionLevel || '', rating: x.rating,
    text: x.text.trim(), date: x.updatedTime, reply: x.businessComment ? { text: x.businessComment.text, date: x.businessComment.updatedTime } : null,
  })).sort((p, q) => new Date(q.date) - new Date(p.date));
  if (!reviews.length) throw new Error('Отзывов не найдено — снимок не обновлён');
  fs.writeFileSync(OUT, JSON.stringify({ source: URL_.replace(/reviews\/$/, ''), fetched_at: new Date().toISOString(), rating: rd.ratingValue, rating_count: rd.ratingCount, review_count: rd.reviewCount, reviews }, null, 1));
  console.log(`Сохранено отзывов: ${reviews.length} из ${rd.reviewCount}; рейтинг ${rd.ratingValue} (${rd.ratingCount} оценок)`);
})().catch(e => { console.error('Не удалось обновить отзывы:', e.message); process.exit(1); });
