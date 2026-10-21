// Проверка плавности прокрутки каталога на телефоне: измеряет «рывки» кадров при быстрой прокрутке.
const { launch } = require('./browser');
(async () => {
  const { browser, close } = await launch();
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto((process.argv[2] || 'http://localhost:3000') + '/menu', { waitUntil: 'networkidle0' });
  const r = await p.evaluate(async () => {
    const frames = []; let last = performance.now(), jumps = 0, prevY = scrollY, back = 0;
    await new Promise(res => {
      let y = 0; const H = document.documentElement.scrollHeight - innerHeight;
      const tick = t => { frames.push(t - last); last = t; y += 40; const before = scrollY; scrollTo(0, y); if (scrollY < before - 1) back++; if (y < Math.min(H, 20000)) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    frames.sort((a, b) => a - b);
    return { n: frames.length, p50: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * .95)], max: frames[frames.length - 1], backJumps: back, active: document.querySelector('.chips a.on')?.textContent };
  });
  console.log(JSON.stringify(r), errs.length ? errs : 'без ошибок JS');
  await close();
})();
