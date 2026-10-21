// Оптимизация брендовых изображений владельца: node scripts/build-images.js <logo.png> <hero.png>
const sharp = require('sharp');
const path = require('path');
const out = f => path.join(__dirname, '..', 'public', 'img', f);
const [logo, hero] = process.argv.slice(2);
(async () => {
  const L = sharp(logo);
  await L.clone().resize(512, 512).webp({ quality: 86 }).toFile(out('logo-512.webp'));
  // Горизонтальный логотип-надпись для шапки (обрезка области с названием)
  await L.clone().extract({ left: 110, top: 1015, width: 1830, height: 475 }).resize({ height: 160 }).webp({ quality: 88 }).toFile(out('logo-wordmark.webp'));
  // Знак (пламя + ножи) для заглушек и иконок
  await L.clone().extract({ left: 520, top: 270, width: 1070, height: 760 }).resize({ height: 256 }).webp({ quality: 88 }).toFile(out('mark.webp'));
  await L.clone().extract({ left: 520, top: 270, width: 1070, height: 760 }).resize(192, 192, { fit: 'contain', background: '#0B0B0B' }).png().toFile(out('icon-192.png'));
  await L.clone().extract({ left: 520, top: 270, width: 1070, height: 760 }).resize(180, 180, { fit: 'contain', background: '#0B0B0B' }).png().toFile(out('apple-touch-icon.png'));
  await L.clone().resize(630, 630).extend({ left: 285, right: 285, background: '#000' }).jpeg({ quality: 85 }).toFile(out('og.jpg'));
  const H = sharp(hero);
  const meta = await H.metadata();
  await H.clone().resize(1920).webp({ quality: 80 }).toFile(out('hero-1920.webp'));
  await H.clone().resize(1100).webp({ quality: 78 }).toFile(out('hero-1100.webp'));
  await H.clone().extract({ left: 0, top: 0, width: Math.round(meta.width * 0.38), height: meta.height }).resize({ height: 640 }).webp({ quality: 80 }).toFile(out('hero-m.webp'));
  console.log('ok', meta.width, meta.height);
})();
