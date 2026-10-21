const { db } = require('../db');

// Каталог для витрины: только видимые блюда активных категорий.
function getCatalog({ all = false } = {}) {
  const cats = db.prepare(`SELECT * FROM categories ${all ? '' : 'WHERE is_active = 1'} ORDER BY sort, id`).all();
  const prods = db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE is_active = 1'} ORDER BY sort, id`).all();
  const vars = db.prepare('SELECT * FROM product_variants ORDER BY sort, id').all();
  const opts = db.prepare('SELECT * FROM product_options ORDER BY sort, id').all();
  const byId = new Map();
  for (const p of prods) byId.set(p.id, { ...p, variants: [], options: [] });
  for (const v of vars) byId.get(v.product_id)?.variants.push(v);
  for (const o of opts) byId.get(o.product_id)?.options.push(o);
  const catMap = new Map(cats.map(c => [c.id, { ...c, products: [] }]));
  for (const p of byId.values()) {
    const c = catMap.get(p.category_id); if (!c) continue;
    p.available = !!p.in_stock && (!p.variants.length || p.variants.some(v => v.in_stock));
    if (p.variants.length) {
      const prices = p.variants.filter(v => v.in_stock || all).map(v => v.price_kop);
      p.price_from = prices.length ? Math.min(...prices) : p.price_kop;
      p.has_range = new Set(p.variants.map(v => v.price_kop)).size > 1;
      p.per100 = p.variants[0].name === '100 г';
    } else { p.price_from = p.price_kop; p.has_range = false; p.per100 = false; }
    c.products.push(p);
  }
  return { categories: [...catMap.values()], products: [...byId.values()] };
}

// Минимальные данные для клиентского JS (добавление в корзину)
function clientMap(products) {
  const m = {};
  for (const p of products) {
    m[p.id] = {
      n: p.name, i: p.image, p: p.price_kop, a: p.available ? 1 : 0, s: p.slug,
      v: p.variants.filter(v => v.in_stock).map(v => ({ id: v.id, n: v.name, p: v.price_kop })),
      o: p.options.map(o => ({ id: o.id, n: o.name, p: o.price_kop })),
    };
  }
  return m;
}

module.exports = { getCatalog, clientMap };
