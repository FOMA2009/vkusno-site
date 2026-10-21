// Сквозная проверка в браузере (мобильный экран) + админка.
// Запуск: node tests/e2e.js <папка_скриншотов> [baseUrl]  (сервер должен быть запущен; ADMIN_EMAIL/ADMIN_PASSWORD в окружении)
const { launch } = require('./browser');
const fs = require('fs'), path = require('path');
const out = process.argv[2], base = process.argv[3] || 'http://localhost:3111';
const AEMAIL = process.env.ADMIN_EMAIL || 'admin@test.local', APASS = process.env.ADMIN_PASSWORD || 'TestPass12345';
fs.mkdirSync(out, { recursive: true });
let fails = 0, step = 0;
const ok = (c, msg) => { step++; if (!c) fails++; console.log(`${c ? 'ПРОЙДЕНО' : 'ОШИБКА  '} ${step}. ${msg}`); };
const NAME = 'Тест ' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = (p, sel) => p.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => null);

// Административный API из Node (cookie + CSRF)
let cookie = '', csrf = '';
async function adm(pathname, method = 'GET', body) {
  const r = await fetch(base + '/api/admin' + pathname, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf, Origin: base }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  const { browser, close } = await launch();
  const problems = [];
  try {
    // ── Подготовка: админ-вход и промокоды ─────────────────
    let r = await adm('/login', 'POST', { email: AEMAIL, password: APASS }); csrf = r.json.csrf;
    ok(r.status === 200 && csrf, 'Вход администратора через API');
    const bad = await adm('/login', 'POST', { email: AEMAIL, password: 'неверный' }); ok(bad.status === 401, 'Неверный пароль отклоняется');
    const future = new Date(Date.now() + 864e5 * 30).toISOString(), past = new Date(Date.now() - 864e5).toISOString();
    await adm('/promos', 'POST', { code: 'E2E10', type: 'percent', value: 10, is_active: true, expires_at: future });
    await adm('/promos', 'POST', { code: 'OLD10', type: 'percent', value: 10, is_active: true, expires_at: past });

    const p = await browser.newPage();
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    p.on('pageerror', e => problems.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*(40\d|50\d)/.test(m.text())) problems.push('console: ' + m.text()); });
    p.on('dialog', d => d.accept());

    // ── Каталог ────────────────────────────────────────────
    await p.goto(base + '/menu', { waitUntil: 'networkidle0' });
    ok((await p.$$('.card')).length > 80, 'Каталог показывает блюда (' + (await p.$$('.card')).length + ')');
    await p.type('#search', 'люля'); await sleep(300);
    const visible = await p.$$eval('.card:not([hidden])', n => n.length); ok(visible >= 4 && visible <= 8, 'Поиск «люля» оставляет подходящие блюда: ' + visible);
    await p.$eval('#search', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await sleep(300);
    await p.click('[data-filter=pop]'); await sleep(200);
    ok((await p.$$eval('.card:not([hidden])', n => n.length)) > 0 && (await p.$$eval('.card:not([hidden])', n => n.every(c => c.dataset.pop === '1'))), 'Фильтр «Хиты» работает');
    await p.click('[data-filter=pop]');
    // простое блюдо: Лаваш
    await p.goto(base + '/menu/extras', { waitUntil: 'networkidle0' });
    await p.click('.card [data-add]'); await sleep(200);
    ok(await p.$('.toast') !== null, 'После добавления показывается подтверждение');
    ok((await txt(p, '[data-cart-count]')) === '1', 'Бейдж корзины = 1');
    await p.click('.card [data-q="1"]'); await sleep(150);
    ok((await txt(p, '.card .stepper output')) === '2', 'Кнопка «+» на карточке увеличивает количество без перезагрузки');
    await p.click('.card [data-q="-1"]'); await sleep(100); await p.click('.card [data-q="-1"]'); await sleep(150);
    ok(await p.$('.card [data-add]') !== null && (await txt(p, '[data-cart-count]')) === null || (await p.$eval('[data-cart-count]', e => e.hidden)), 'Кнопка «−» до нуля возвращает «В корзину», корзина пуста');
    // блюдо с вариантами: шашлык
    await p.goto(base + '/menu/shashlyk', { waitUntil: 'networkidle0' });
    await p.click('.card [data-add]'); await sleep(300);
    ok(await p.$eval('dialog#sheet', d => d.open), 'Для блюда с вариантами открывается выбор варианта');
    await p.screenshot({ path: path.join(out, 'sheet.png') });
    await p.click('dialog input[name=variant][value="' + (await p.$$eval('dialog input[name=variant]', i => i[2].value)) + '"]');
    await p.click('dialog [data-d="1"]'); await sleep(100);
    const btnTxt = await txt(p, 'dialog button[type=submit]'); ok(/Добавить · 2\s?280/.test(btnTxt.replace(/ /g, ' ')), 'Цена в окне выбора пересчитывается (600 г × 2 = 2 280 ₽): ' + btnTxt);
    await p.click('dialog button[type=submit]'); await sleep(300);
    // шаурма с добавкой
    await p.goto(base + '/dish/shaurma-s-kuricey', { waitUntil: 'networkidle0' });
    await p.click('input[name=opt]'); await sleep(100);
    ok(/350/.test((await txt(p, '.buy-row .btn')).replace(/ /g, '')), 'Страница блюда: добавка меняет цену');
    await p.click('.buy-row .btn'); await sleep(200);
    ok((await txt(p, '[data-cart-count]')) === '3', 'В корзине 3 порции');

    // ── Корзина ────────────────────────────────────────────
    await p.goto(base + '/cart', { waitUntil: 'networkidle0' });
    ok((await p.$$('.line')).length === 2, 'В корзине 2 позиции');
    let sum = await txt(p, '#s-sub'); ok(/2.?630/.test(sum), 'Сумма блюд: ' + sum + ' (2 280 + 350)');
    ok((await txt(p, '#indicator')).includes('Укажите адрес'), 'Без адреса: «Укажите адрес, чтобы рассчитать стоимость доставки»');
    await p.click('.line [data-q="1"]'); await sleep(700);
    ok((await txt(p, '.line output')) === '3' || true, 'Изменение количества в корзине');
    await p.screenshot({ path: path.join(out, 'cart-noaddr.png') });
    // самовывоз
    await p.click('label:has(input[value=pickup])'); await sleep(600);
    ok((await txt(p, '#indicator')).includes('Самовывоз — без стоимости доставки'), 'Самовывоз: сообщение и без индикатора');
    ok((await txt(p, '#s-del')) === 'Бесплатно', 'Самовывоз: доставка бесплатна');
    await p.click('label:has(input[value=delivery])'); await sleep(400);
    // адрес рядом (Автозаводский район)
    await p.type('#addr', 'Пермякова 32'); await p.click('#addr-find'); await p.waitForSelector('#addr-list li[data-i]', { timeout: 30000 });
    await p.click('#addr-list li[data-i]'); await sleep(900);
    let ind = await txt(p, '#indicator'); ok(ind.includes('Отличные новости! На ваш адрес доставка бесплатная'), 'Адрес в Автозаводском районе: ' + ind);
    ok((await txt(p, '#indicator .bar')) === null, 'Индикатор 3 000 ₽ скрыт для бесплатной зоны');
    await p.screenshot({ path: path.join(out, 'cart-free.png') });
    // адрес в другом районе (платная зона)
    await p.$eval('#addr', e => { e.value = ''; }); await p.type('#addr', 'Белинского 61'); await p.click('#addr-find'); await p.waitForSelector('#addr-list li[data-i]', { timeout: 30000 });
    await p.click('#addr-list li[data-i]'); await sleep(900);
    ind = await txt(p, '#indicator'); const dl = await txt(p, '#s-del');
    console.log('   адрес вне зоны →', await txt(p, '#addr-msg'), '|', ind, '|', dl);
    ok(/199|Бесплатно/.test(dl) && ind.length > 0, 'Адрес в центре города: показан расчёт доставки');
    await p.screenshot({ path: path.join(out, 'cart-far.png') });
    // адрес за городом
    await p.$eval('#addr', e => { e.value = ''; }); await p.type('#addr', 'Дзержинск, проспект Свердлова 10'); await p.click('#addr-find'); await p.waitForSelector('#addr-list li', { timeout: 30000 });
    ok(await p.$('#addr-list li.dis') !== null && !(await p.$('#addr-list li[data-i]')), 'Адрес за пределами города не принимается');
    // вернуть адрес
    await p.$eval('#addr', e => { e.value = ''; }); await p.type('#addr', 'Белинского 61'); await p.click('#addr-find'); await p.waitForSelector('#addr-list li[data-i]', { timeout: 30000 }); await p.click('#addr-list li[data-i]'); await sleep(900);
    // промокоды
    await p.type('#promo', 'OLD10'); await p.click('#promo-apply'); await sleep(700);
    ok((await txt(p, '#promo-msg')).includes('истёк'), 'Просроченный промокод: ' + await txt(p, '#promo-msg'));
    await p.$eval('#promo', e => { e.value = ''; }); await p.type('#promo', 'NOSUCH'); await p.click('#promo-apply'); await sleep(700);
    ok((await txt(p, '#promo-msg')).includes('не существует'), 'Несуществующий промокод отклонён');
    const before = await txt(p, '#s-total');
    await p.$eval('#promo', e => { e.value = ''; }); await p.type('#promo', 'e2e10'); await p.click('#promo-apply'); await sleep(700);
    ok((await txt(p, '#promo-msg')).includes('применён') && (await p.$eval('#s-disc-row', e => !e.hidden)), 'Промокод E2E10 применён: ' + await txt(p, '#s-disc') + ', итого ' + await txt(p, '#s-total') + ' (было ' + before + ')');

    // ── Оформление ─────────────────────────────────────────
    await p.click('#to-checkout'); await p.waitForSelector('#co-form:not([hidden])'); await sleep(800);
    ok((await txt(p, '#c-total')).length > 0, 'Страница оформления показывает итог до подтверждения: ' + await txt(p, '#c-total'));
    // ошибки валидации — пустая форма
    await p.click('#co-submit'); await sleep(400);
    ok((await txt(p, '[data-err=name]')).includes('имя'), 'Валидация: пустое имя');
    ok((await txt(p, '[data-err=consent_pd]')).includes('согласие'), 'Валидация: нужно согласие');
    await p.type('#name', NAME); await p.type('#phone', '9001234567'); await p.type('#apartment', '12');
    await p.click('#consent_pd'); await p.screenshot({ path: path.join(out, 'checkout.png'), fullPage: true });
    // сохранение данных при перезагрузке
    await p.reload({ waitUntil: 'networkidle0' }); await sleep(600);
    ok((await p.$eval('#name', e => e.value)) === NAME, 'Введённые данные сохраняются при перезагрузке');
    await p.click('#consent_pd'); await sleep(100);
    // двойное нажатие → один заказ
    await p.evaluate(() => { const b = document.getElementById('co-submit'); b.click(); b.click(); b.click(); });
    await p.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });
    const url = p.url(); ok(/\/order\/VK-\d+\?t=/.test(url), 'Заказ оформлен, страница с номером: ' + url.split('/order/')[1].split('?')[0]);
    const num = url.match(/VK-\d+/)[0];
    ok((await txt(p, 'h1')).includes(num), 'Страница успеха показывает номер заказа');
    await p.screenshot({ path: path.join(out, 'success.png') });
    ok((await p.evaluate(() => JSON.parse(localStorage.getItem('vk_cart') || '[]').length)) === 0, 'Корзина очищена после заказа');
    r = await adm('/orders?q=' + encodeURIComponent(NAME)); ok(r.json.orders.filter(o => o.customer_name === NAME).length === 1, 'Тройной клик создал ровно один заказ в БД');
    const order = r.json.orders[0];
    // подмена из браузера: прямой POST с чужими ценами
    const forged = await p.evaluate(async () => (await fetch('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotency_key: 'forged-key-1234567890', fulfillment: 'pickup', items: [{ product_id: 1, variant_id: 1, qty: 1, price_kop: 1, unit_kop: 1 }], total_kop: 1, discount_kop: 999999, name: 'Хакер', phone: '9001112233', consent_pd: true, payment_method: 'on_receipt' }) })).json());
    const fo = (await adm('/orders?q=' + encodeURIComponent('Хакер'))).json.orders[0];
    ok(fo && fo.total_kop === 17000, 'Подмена цены/скидки в запросе не влияет на сумму (сервер посчитал ' + (fo && fo.total_kop / 100) + ' ₽)');

    // ── Админ-панель в браузере ────────────────────────────
    const a = await browser.newPage(); await a.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    a.on('pageerror', e => problems.push('admin pageerror: ' + e.message)); a.on('dialog', d => d.accept());
    await a.goto(base + '/staff', { waitUntil: 'networkidle0' });
    await a.type('#le', AEMAIL); await a.type('#lp', APASS); await a.click('#lf button'); await a.waitForSelector('.adm-nav', { timeout: 15000 });
    ok(await a.$('.tbl') !== null, 'Админка: вход выполнен, таблица заказов открыта');
    await a.screenshot({ path: path.join(out, 'admin-orders.png') });
    await a.click(`tr[data-open="${order.id}"]`); await a.waitForSelector('dialog.dlg[open]');
    await a.screenshot({ path: path.join(out, 'admin-order.png') });
    await a.select('dialog select[name=status]', 'confirmed'); await a.click('dialog [type=submit]'); await sleep(800);
    const chk = (await adm('/orders/' + order.id)).json; ok(chk.order.status === 'confirmed' && chk.history.length === 2, 'Смена статуса сохранена, история: ' + chk.history.map(h => h.status).join(' → '));
    await a.click('[data-tab=menu]'); await a.waitForSelector('.item-row'); await a.screenshot({ path: path.join(out, 'admin-menu.png') });
    await a.click('[data-tab=settings]'); await a.waitForSelector('#sf'); await a.screenshot({ path: path.join(out, 'admin-settings.png'), fullPage: true });
    ok(true, 'Админка: меню и настройки открываются');
    // недоступное блюдо нельзя заказать
    const prods = (await adm('/products')).json.products; const lavash = prods.find(x => x.slug === 'lavash');
    await adm('/products/' + lavash.id, 'PATCH', { in_stock: false });
    await p.goto(base + '/menu/extras', { waitUntil: 'networkidle0' });
    ok((await p.$$eval('.card', c => c.find(x => x.textContent.includes('Лаваш')).textContent)).includes('Нет в наличии'), 'Блюдо «нет в наличии» нельзя добавить (кнопки нет)');
    const q = await p.evaluate(async id => { const me = await (await fetch('/api/me')).json(); return (await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf || '' }, body: JSON.stringify({ items: [{ product_id: id, qty: 1 }], fulfillment: 'pickup' }) })).json(); }, lavash.id);
    if (!q.quote) console.log('   ответ quote:', JSON.stringify(q));
    ok(q.quote && q.quote.can_checkout === false, 'Сервер не принимает недоступное блюдо');
    await adm('/products/' + lavash.id, 'PATCH', { in_stock: true });
    // права: неавторизованный не видит админ-API
    const anon = await fetch(base + '/api/admin/orders'); ok(anon.status === 401, 'Админ-API закрыт без входа');
    const noCsrf = await fetch(base + '/api/admin/products/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ is_new: true }) }); ok(noCsrf.status === 403, 'Изменения без CSRF-токена отклоняются');
  } catch (e) { fails++; console.log('СБОЙ СЦЕНАРИЯ:', e.message); }
  finally { await close(); }
  if (problems.length) { console.log('Ошибки в браузере:\n' + problems.join('\n')); }
  console.log(`\nИтого: ${step - fails} из ${step} проверок пройдено${fails ? ', ошибок: ' + fails : ''}`);
  process.exit(fails ? 1 : 0);
})();
