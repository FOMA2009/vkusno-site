// Импорт фото блюд из меню организации на Яндекс.Картах (scripts/data/yandex-menu.json).
// Берутся только фото (и вес, если он не задан); цены остаются из меню владельца.
// Запуск: node scripts/import-photos.js
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { db } = require('../server/db');
const watermark = require('../server/lib/watermark');
const src = require('./data/yandex-menu.json');

const norm = s => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[«»"'()]/g, '').replace(/\s+/g, ' ').trim();
// Наши названия → названия в Яндексе (там формулировки отличаются)
const ALIAS = {
  'Шаурма Жюльен': 'Жюльен в лаваше', 'Мини шаурма': 'Мини-шаурма со свининой', 'Шаурма Ики-бир': 'Ики-бир со свининой в лаваше',
  'Люля-кебаб из баранины': 'Люля-кебаб с бараниной', 'Люля-кебаб из говядины': 'Люля-кебаб с говядиной', 'Люля-кебаб из свинины': 'Люля-кебаб со свининой', 'Люля-кебаб из курицы': 'Люля-кебаб с курицей',
  'Шашлык из куриных крылышек': 'Шашлык из куриных крыльев', 'Шашлык из куриного филе': 'Шашлык из филе куриной грудки',
  'Шампиньоны на мангале': 'Шампиньоны',
  'Мисо суп с лососем': 'Мисо С лососем', 'Мисо суп с креветкой': 'Мисо С креветкой', 'Мисо суп с угрём': 'Мисо С угрём',
  'Темпура креветка': 'Темпура Креветка', 'Темпура лосось': 'Темпура Лосось', 'Темпура кальмар': 'Темпура Кальмар',
  'Гренки чесночные': 'Гренки чесночные (8 шт.)', 'Нагетсы куриные': 'Наггетсы куриные (6 шт.)',
  'Суши «Сакэ» (лосось)': 'Суши Сяке', 'Суши «Унаги» (угорь)': 'Суши Унаги', 'Суши «Эби» (креветка)': 'Суши Эби', 'Суши «Магуро» (тунец)': 'Суши Магуро',
  'Филадельфия': 'Ролл Филадельфия', 'Филадельфия с огурцом': 'Ролл Филадельфия с огурцом', 'Филадельфия Мини': 'Ролл Филадельфия мини',
  'Филадельфия VIP': 'Ролл Филадельфия с угрём VIP', 'Филадельфия с авокадо': 'Ролл Филадельфия с авокадо', 'Филадельфия с креветкой': 'Ролл Филадельфия с креветкой',
  'Филадельфия Де-люкс': 'Ролл Филадельфия Де-люкс', 'Ролл «Дракон»': 'Ролл Дракон', 'Ролл «Канада»': 'Ролл Канада',
  'Калифорния Лайт': 'Ролл Калифорния лайт', 'Калифорния с креветкой': 'Ролл Калифорния с креветкой', 'Калифорния с угрём': 'Ролл Калифорния с угрём', 'Калифорния с лососем': 'Ролл Калифорния с лососем',
  'Тёплый ролл «Вирджиния»': 'Горячий ролл Вирджиния', 'Тёплый ролл «Камчатка»': 'Горячий ролл Камчатка', 'Тёплый ролл «Норвегия»': 'Горячий ролл Норвегия',
  'Тёплый ролл «Цезарь»': 'Горячий ролл Цезарь', 'Тёплый ролл «Филадельфия»': 'Горячий ролл Филадельфия',
  'Лаваш': 'Шашлычный лаваш',
};
const byTitle = new Map();
for (const i of src) if (i.photo && !byTitle.has(norm(i.title))) byTitle.set(norm(i.title), i); // у шашлыков несколько записей — берём первую

(async () => {
  const prods = db.prepare('SELECT id, slug, name, image, weight_label FROM products').all();
  let ok = 0; const miss = [];
  for (const p of prods) {
    const hit = byTitle.get(norm(ALIAS[p.name] || p.name));
    if (!hit) { if (!p.image) miss.push(p.name); continue; }
    const file = path.join(__dirname, '..', 'public', 'menu', p.slug + '.webp');
    const orig = path.join(__dirname, '..', 'assets', 'menu-originals', p.slug + '.webp'); // оригинал без знака
    try {
      const r = await fetch(hit.photo.replace('{size}', 'orig'), { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await sharp(Buffer.from(await r.arrayBuffer())).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toFile(orig);
      await watermark.apply(orig, file, { pad: watermark.PAD_SLUGS.has(p.slug) });
      db.prepare("UPDATE products SET image = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run('/menu/' + p.slug + '.webp', p.id);
      ok++;
    } catch (e) { miss.push(p.name + ' (ошибка загрузки: ' + e.message + ')'); }
  }
  console.log(`Фото добавлено: ${ok}\nБез фото: ${miss.length}\n- ${miss.join('\n- ')}`);
})();
