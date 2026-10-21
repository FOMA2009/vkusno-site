const { db, tx } = require('../db');
const fs = require('fs');
const path = require('path');
const { slugify } = require('../lib/util');
const menu = require('./menu');
const pages = require('./pages');

function uniqueSlug(table, base) {
  let slug = base, n = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE slug = ?`).get(slug)) slug = `${base}-${n++}`;
  return slug;
}

function seedMenu() {
  tx(() => {
    const insCat = db.prepare('INSERT INTO categories(slug,name,description,sort) VALUES(?,?,?,?)');
    const insProd = db.prepare(`INSERT INTO products(category_id,slug,name,description,weight_label,price_kop,is_popular,is_active,sort,image)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const insVar = db.prepare('INSERT INTO product_variants(product_id,name,price_kop,weight_label,sort) VALUES(?,?,?,?,?)');
    const insOpt = db.prepare('INSERT INTO product_options(product_id,name,price_kop,sort) VALUES(?,?,?,?)');
    menu.forEach((c, ci) => {
      const cid = Number(insCat.run(c.slug, c.name, c.description || '', ci).lastInsertRowid);
      c.items.forEach(([name, rub, o = {}], pi) => {
        const slug = uniqueSlug('products', slugify(name));
        const pid = Number(insProd.run(cid, slug, name, o.desc || '', o.weight || '', rub * 100, o.popular ? 1 : 0, o.hidden ? 0 : 1, pi,
          fs.existsSync(path.join(__dirname, '..', '..', 'public', 'menu', slug + '.webp')) ? `/menu/${slug}.webp` : '').lastInsertRowid);
        (o.per100 || []).forEach((g, i) => insVar.run(pid, `${g} г`, Math.round(rub * 100 * g / 100), `${g} г`, i));
        (o.variants || []).forEach(([vn, vp], i) => insVar.run(pid, vn, vp * 100, '', i));
        (o.options || []).forEach(([on, op], i) => insOpt.run(pid, on, op * 100, i));
      });
    });
  });
}

function seedPages() {
  const ins = db.prepare('INSERT OR IGNORE INTO pages(slug,title,body) VALUES(?,?,?)');
  for (const p of pages) ins.run(p.slug, p.title, p.body.trim());
}

function seedPromotions() {
  if (db.prepare('SELECT COUNT(*) n FROM promotions').get().n) return;
  const ins = db.prepare('INSERT INTO promotions(title,text,sort) VALUES(?,?,?)');
  ins.run('Бесплатная доставка рядом с нами', 'Доставим бесплатно по Автозаводскому району и в радиусе 5 км от ресторана — при заказе от 1 500 ₽.', 0);
  ins.run('Бесплатная доставка по всему городу', 'При заказе от 3 000 ₽ доставка по Нижнему Новгороду бесплатная.', 1);
}

function seedAll() {
  if (!db.prepare('SELECT COUNT(*) n FROM categories').get().n) seedMenu();
  seedPages();
  seedPromotions();
}

module.exports = { seedAll };
