// Фиксирует текущие цены из базы в server/seed/prices.json — они применяются при первом запуске на новой базе
// (например, на сервере). Запуск: node scripts/export-prices.js
const fs = require('fs');
const path = require('path');
const { db } = require('../server/db');

const out = {};
for (const p of db.prepare('SELECT id, slug, price_kop FROM products ORDER BY id').all()) {
  out[p.slug] = {
    price_kop: p.price_kop,
    variants: Object.fromEntries(db.prepare('SELECT name, price_kop FROM product_variants WHERE product_id = ?').all(p.id).map(v => [v.name, v.price_kop])),
    options: Object.fromEntries(db.prepare('SELECT name, price_kop FROM product_options WHERE product_id = ?').all(p.id).map(o => [o.name, o.price_kop])),
  };
}
fs.writeFileSync(path.join(__dirname, '..', 'server', 'seed', 'prices.json'), JSON.stringify(out, null, 1));
console.log('Цены сохранены в server/seed/prices.json:', Object.keys(out).length, 'блюд');
