// Запуск установленного Edge/Chrome с отладочным портом и подключение puppeteer-core.
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const os = require('os'), path = require('path');
const EXE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
async function launch() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = path.join(os.tmpdir(), 'vk-edge-' + Date.now());
  const proc = spawn(EXE, ['--headless=old', '--disable-gpu', '--no-sandbox', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 50 && !browser; i++) {
    try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); }
    catch { await new Promise(r => setTimeout(r, 300)); }
  }
  if (!browser) { proc.kill(); throw new Error('Не удалось подключиться к браузеру'); }
  const close = async () => { try { await browser.close(); } catch { /* */ } try { proc.kill(); } catch { /* */ } };
  return { browser, close };
}
module.exports = { launch };
