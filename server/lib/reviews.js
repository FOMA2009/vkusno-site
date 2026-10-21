const fs = require('fs');
const path = require('path');

// Снимок отзывов Яндекс.Карт (обновляется скриптом scripts/fetch-reviews.js)
const FILE = path.join(__dirname, '..', '..', 'scripts', 'data', 'yandex-reviews.json');
let cache = null, mtime = 0;
function load() {
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (!cache || m !== mtime) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); mtime = m;
      // на сайте — только положительные отзывы (4–5 звёзд); все отзывы доступны на Яндекс.Картах
      cache.reviews = cache.reviews.filter(r => r.rating >= 4);
    }
    return cache;
  } catch { return null; }
}
module.exports = { load };
