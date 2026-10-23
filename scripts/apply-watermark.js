// Накладывает водяной знак на все фото меню: assets/menu-originals/*.webp → public/menu/*.webp
// Оригиналы не изменяются, поэтому команду можно безопасно запускать повторно: node scripts/apply-watermark.js
const fs = require('fs');
const path = require('path');
const { apply, PAD_SLUGS } = require('../server/lib/watermark');
const { db } = require('../server/db');

(async () => {
  const dir = path.join(__dirname, '..', 'assets', 'menu-originals');
  const out = path.join(__dirname, '..', 'public', 'menu');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.webp'));
  for (const f of files) await apply(path.join(dir, f), path.join(out, f), { pad: PAD_SLUGS.has(f.replace(/\.webp$/, '')) });
  db.prepare("UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE image LIKE '/menu/%'").run(); // сброс кэша фото
  console.log('Водяной знак нанесён на фото:', files.length);
})();
