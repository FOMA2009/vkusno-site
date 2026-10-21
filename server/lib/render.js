const fs = require('fs');
const path = require('path');
const { settings } = require('../db');
const { SITE_URL, PUBLIC_DIR } = require('../config');
const { esc, rub, isOpenAt, nextOpening, describeSchedule } = require('./util');

const ver = f => { try { return Math.floor(fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs / 1000); } catch { return 0; } };

const ICONS = {
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  menu: '<path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  star: '<path fill="currentColor" stroke="none" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  store: '<path d="m2 7 1.5-4h17L22 7"/><path d="M2 7v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V7"/><path d="M4 21V10.5"/><path d="M20 21V10.5"/><path d="M4 21h16"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
const sprite = `<svg class="sprite" width="0" height="0" aria-hidden="true"><defs>${Object.entries(ICONS).map(([k, v]) =>
  `<symbol id="i-${k}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${v}</symbol>`).join('')}</defs></svg>`;

function siteInfo() {
  const s = settings.all();
  const phone = s['contact.phone'];
  const sched = s['hours.schedule'];
  const open = s['orders.accepting'] && isOpenAt(sched);
  return {
    name: s['site.name'], tagline: s['site.tagline'], desc: s['site.description'], phone,
    phoneRaw: String(phone).replace(/[^\d+]/g, ''), address: s['contact.address'], email: s['contact.email'],
    lat: s['contact.lat'], lon: s['contact.lon'], mapUrl: s['contact.map_url'] || '', social: s['contact.social'] || [],
    schedule: sched, hours: describeSchedule(sched), open, accepting: s['orders.accepting'],
    min: s['delivery.min_order_kop'], fee: s['delivery.fee_kop'], threshold: s['delivery.free_threshold_kop'], radius: s['delivery.free_radius_km'],
    deliveryEnabled: s['delivery.enabled'], reviewsUrl: s['contact.reviews_url'] || s['contact.map_url'] || '',
  };
}

function openBadge(si) {
  if (!si.accepting) return `<span class="status status-off">Приём заказов приостановлен</span>`;
  if (si.open) return `<span class="status status-on">Сейчас открыто</span>`;
  const n = nextOpening(si.schedule);
  const t = n ? n.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return `<span class="status status-off">Сейчас закрыто${t ? ` · откроемся ${esc(t)}` : ''}</span>`;
}

function hoursHtml(si) {
  return `<ul class="hours">${si.hours.map(h => `<li><span>${esc(h.days)}</span><span>${esc(h.text)}</span></li>`).join('')}</ul>`;
}

function layout({ title, description, path: urlPath = '/', body, page = '', image, jsonld, noindex = false, bare = false }) {
  const si = siteInfo();
  const fullTitle = title ? `${title} — ${si.name}` : `${si.name} — ${si.tagline}`;
  const desc = description || si.desc;
  const canon = SITE_URL + urlPath;
  const og = image ? (image.startsWith('http') ? image : SITE_URL + image) : SITE_URL + (settings.get('seo.og_image') || '/img/og.jpg');
  const nav = [['/menu', 'Меню'], ['/#promos', 'Акции'], ['/reviews', 'Отзывы'], ['/delivery', 'Доставка'], ['/about', 'О нас'], ['/contacts', 'Контакты']];
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0B0B0B">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${esc(canon)}">`}
<meta property="og:type" content="website"><meta property="og:locale" content="ru_RU">
<meta property="og:site_name" content="${esc(si.name)}"><meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(og)}">
<link rel="icon" type="image/png" href="/img/icon-192.png"><link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="stylesheet" href="/css/site.css?v=${ver('css/site.css')}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body data-page="${esc(page)}">
${sprite}
<a class="skip" href="#main">К основному содержимому</a>
${bare ? '' : `<header class="hdr">
  <div class="wrap hdr-in">
    <a class="logo" href="/" aria-label="${esc(si.name)} — на главную"><img src="/img/logo-wordmark.webp" alt="${esc(si.name)}" width="146" height="40"></a>
    <nav class="nav" aria-label="Основная навигация">${nav.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</nav>
    <div class="hdr-act">
      <a class="hdr-phone" href="tel:${esc(si.phoneRaw)}">${icon('phone')}<span>${esc(si.phone)}</span></a>
      <a class="icon-btn" href="/menu#search" data-focus-search aria-label="Поиск по меню">${icon('search')}</a>
      <a class="icon-btn hide-m" href="/account" aria-label="Личный кабинет">${icon('user')}</a>
      <a class="cart-btn" href="/cart" aria-label="Корзина">${icon('bag')}<span class="cart-btn-t">Корзина</span><span class="badge" data-cart-count hidden>0</span></a>
      <button class="icon-btn burger" type="button" aria-label="Открыть меню" aria-expanded="false" aria-controls="drawer" data-drawer-open>${icon('menu')}</button>
    </div>
  </div>
</header>
<div class="drawer" id="drawer" hidden>
  <div class="drawer-bg" data-drawer-close></div>
  <div class="drawer-panel" role="dialog" aria-modal="true" aria-label="Меню сайта">
    <button class="icon-btn drawer-x" type="button" data-drawer-close aria-label="Закрыть меню">${icon('x')}</button>
    <nav aria-label="Мобильная навигация">${nav.concat([['/account', 'Личный кабинет']]).map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</nav>
    <a class="btn btn-primary btn-block" href="tel:${esc(si.phoneRaw)}">${icon('phone')} ${esc(si.phone)}</a>
    <p class="muted small">${esc(si.address)}</p>
  </div>
</div>`}
<main id="main">${body}</main>
${bare ? '' : `<footer class="ftr">
  <div class="wrap ftr-grid">
    <div>
      <img src="/img/logo-wordmark.webp" alt="${esc(si.name)}" width="146" height="40" loading="lazy">
      <p class="muted">${esc(si.tagline)}</p>
    </div>
    <div><h2 class="ftr-h">Разделы</h2><ul class="ftr-list"><li><a href="/menu">Меню</a></li><li><a href="/delivery">Доставка и самовывоз</a></li><li><a href="/reviews">Отзывы</a></li><li><a href="/about">О заведении</a></li><li><a href="/contacts">Контакты</a></li></ul></div>
    <div><h2 class="ftr-h">Документы</h2><ul class="ftr-list"><li><a href="/privacy">Политика конфиденциальности</a></li><li><a href="/personal-data">Обработка персональных данных</a></li><li><a href="/terms">Условия оформления заказов</a></li></ul></div>
    <div><h2 class="ftr-h">Контакты</h2><ul class="ftr-list"><li><a href="tel:${esc(si.phoneRaw)}">${esc(si.phone)}</a></li><li>${esc(si.address)}</li>${si.email ? `<li><a href="mailto:${esc(si.email)}">${esc(si.email)}</a></li>` : ''}</ul></div>
  </div>
  <div class="wrap ftr-bot"><span>© ${new Date().getFullYear()} ${esc(si.name)}</span><span>Цены в рублях. Время работы — московское.</span></div>
</footer>
<nav class="bnav" aria-label="Быстрая навигация">
  <a href="/menu" data-nav="menu">${icon('utensils')}<span>Меню</span></a>
  <a href="/menu#search" data-focus-search>${icon('search')}<span>Поиск</span></a>
  <a href="/cart" data-nav="cart" class="bnav-cart">${icon('bag')}<span>Корзина</span><span class="badge" data-cart-count hidden>0</span></a>
  <a href="/account" data-nav="account">${icon('user')}<span>Профиль</span></a>
</nav>
<div class="toasts" id="toasts" aria-live="polite" aria-atomic="false"></div>`}
<script src="/js/app.js?v=${ver('js/app.js')}" defer></script>
</body>
</html>`;
}

// ── Карточка блюда ───────────────────────────────────────────
function priceHtml(p) {
  if (p.per100) return `<span class="price">${rub(p.price_per100)} <small>/ 100 г</small></span>`; // цена за 100 г
  const from = p.has_range ? '<small>от </small>' : '';
  return `<span class="price">${from}${rub(p.price_from)}</span>`;
}
function dishImage(p, cls = 'card-img', size = '') {
  if (p.image) return `<div class="${cls}"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async" ${size}></div>`;
  return `<div class="${cls} ph" role="img" aria-label="${esc(p.name)}: фото пока нет"><img src="/img/mark.webp" alt="" loading="lazy" width="96" height="75"></div>`;
}
function card(p) {
  const needsChoice = p.variants.length > 0 || p.options.length > 0;
  const badges = [p.is_popular ? '<span class="tag tag-hot">Хит</span>' : '', p.is_new ? '<span class="tag tag-new">Новинка</span>' : ''].join('');
  return `<article class="card${p.available ? '' : ' is-off'}" data-id="${p.id}" data-name="${esc((p.name + ' ' + p.description).toLowerCase())}" data-pop="${p.is_popular}" data-new="${p.is_new}" data-price="${p.price_from}">
  <a class="card-link" href="/dish/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${dishImage(p, 'card-img', 'width="480" height="360"')}</a>
  <div class="card-badges">${badges}</div>
  <div class="card-body">
    <h3 class="card-title"><a href="/dish/${esc(p.slug)}">${esc(p.name)}</a></h3>
    ${p.description ? `<p class="card-desc">${esc(p.description)}</p>` : ''}
    ${p.per100 ? `<p class="card-w card-min">Заказ от ${p.min_grams} г</p>` : p.weight_label ? `<p class="card-w">${esc(p.weight_label)}</p>` : ''}
    <div class="card-foot">
      ${priceHtml(p)}
      <div class="card-act" data-act="${p.id}">${p.available
        ? `<button class="btn btn-primary btn-sm" type="button" data-add="${p.id}" ${needsChoice ? 'data-choose="1"' : ''}>${needsChoice ? 'Выбрать' : 'В корзину'}</button>`
        : '<span class="soldout">Нет в наличии</span>'}</div>
    </div>
  </div>
</article>`;
}

const stars = (n, cls = '') => `<span class="stars ${cls}" role="img" aria-label="Оценка ${n} из 5">${[1, 2, 3, 4, 5].map(i => icon('star', i <= n ? 'on' : 'off')).join('')}</span>`;

module.exports = { stars, layout, card, icon, siteInfo, openBadge, hoursHtml, priceHtml, dishImage, esc, rub };
