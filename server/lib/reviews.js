const fs = require('fs');
const path = require('path');

// Снимок отзывов Яндекс.Карт (обновляется скриптом scripts/fetch-reviews.js)
const FILE = path.join(__dirname, '..', '..', 'scripts', 'data', 'yandex-reviews.json');
let cache = null, mtime = 0;
function load() {
  try {
    const m = fs.statSync(FILE).mtimeMs;
    if (!cache || m !== mtime) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); mtime = m; }
    return cache;
  } catch { return null; }
}
module.exports = { load };
