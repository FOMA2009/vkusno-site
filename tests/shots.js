// Скриншоты и проверка горизонтальной прокрутки/ошибок консоли: node tests/shots.js <outDir> [baseUrl]
const { launch } = require('./browser');
const fs = require('fs'), path = require('path');
const out = process.argv[2], base = process.argv[3] || 'http://localhost:3111';
const widths = (process.env.WIDTHS || '320,375,390,430,768,1024,1440').split(',').map(Number);
const pages = (process.env.PAGES || '/,/menu,/dish/shaurma-s-kuricey,/cart,/checkout').split(',');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const { browser: b, close } = await launch();
  const problems = [];
  for (const w of widths) {
    const p = await b.newPage();
    await p.setViewport({ width: w, height: w < 700 ? 800 : 900, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
    p.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`[${w}] console ${m.type()}: ${m.text()}`); });
    p.on('pageerror', e => problems.push(`[${w}] pageerror: ${e.message}`));
    for (const u of pages) {
      await p.goto(base + u, { waitUntil: 'networkidle0' });
      if (u === '/cart' || u === '/checkout') { // с товарами в корзине
        await p.evaluate(() => localStorage.setItem('vk_cart', JSON.stringify([{ k: '1:0:', p: 1, v: 0, o: [], q: 1 }])));
        await p.goto(base + u, { waitUntil: 'networkidle0' });
      }
      const over = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (over.sw > over.iw + 1) problems.push(`[${w}] ${u}: горизонтальная прокрутка ${over.sw} > ${over.iw}`);
      await p.screenshot({ path: path.join(out, `${w}${u.replace(/\W+/g, '_')}.png`), fullPage: false });
    }
    await p.close();
  }
  await close();
  console.log(problems.length ? problems.join('\n') : 'Проблем не найдено');
})();
