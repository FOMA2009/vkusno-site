// Проверка плавной прокрутки: клик по якорю должен менять scrollY постепенно, а не мгновенно.
const { launch } = require('./browser');
(async () => {
  const { browser, close } = await launch(); const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto((process.argv[2] || 'http://localhost:3000') + '/menu', { waitUntil: 'networkidle0' });
  const ys = await p.evaluate(async () => {
    const out = []; const a = [...document.querySelectorAll('.chips a[href^="#cat-"]')].find(x => x.textContent.includes('Закуски'));
    a.click(); for (let i = 0; i < 14; i++) { await new Promise(r => setTimeout(r, 60)); out.push(Math.round(scrollY)); } return out;
  });
  const steps = new Set(ys).size;
  console.log('scrollY по кадрам:', ys.join(' → '), '\nплавно:', steps > 4 && ys[0] < ys[ys.length - 1] ? 'да' : 'НЕТ', '| адрес:', await p.evaluate(() => location.hash));
  await close();
})();
