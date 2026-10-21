// Переводит блюда с ценой за 100 г на порции от 400 г: 400/500/600/800/1000 г, цена = цена за 100 г × вес / 100.
// Цена за 100 г берётся из текущего варианта «100 г» (или, если его уже нет, из варианта 400 г / 4).
// Запуск: node scripts/migrate-weights.js   (безопасно запускать повторно)
const { db, tx } = require('../server/db');
const WEIGHTS = [400, 500, 600, 800, 1000];
let n = 0;
tx(() => {
  for (const p of db.prepare('SELECT id, name FROM products').all()) {
    const vs = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort, id').all(p.id);
    if (!vs.length || !vs.every(v => /^\d+ г$/.test(v.name))) continue;
    const g = v => parseInt(v.name, 10);
    const ref = vs.find(v => g(v) === 100) || vs[0];
    const per100 = Math.round(ref.price_kop * 100 / g(ref));
    const keepStock = vs.every(v => v.in_stock) ? 1 : 0;
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(p.id);
    WEIGHTS.forEach((w, i) => db.prepare('INSERT INTO product_variants(product_id,name,price_kop,weight_label,sort,in_stock) VALUES(?,?,?,?,?,?)')
      .run(p.id, `${w} г`, Math.round(per100 * w / 100), `${w} г`, i, keepStock));
    db.prepare('UPDATE products SET price_kop = ? WHERE id = ?').run(per100, p.id);
    n++;
  }
  db.prepare("UPDATE categories SET description = 'Цена указана за 100 г. Минимальный заказ — 400 г.' WHERE slug IN ('shashlyk','grilled-vegetables')").run();
});
console.log('Блюд переведено на порции от 400 г:', n);
