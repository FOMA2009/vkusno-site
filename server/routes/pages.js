const express = require('express');
const { db, settings } = require('../db');
const { SITE_URL } = require('../config');
const { getCatalog, clientMap } = require('../lib/catalog');
const reviewsData = require('../lib/reviews');
const { stars, layout, card, icon, siteInfo, openBadge, hoursHtml, priceHtml, dishImage, esc, rub } = require('../lib/render');
const { STATUS_LABELS } = require('../lib/util');
const payments = require('../lib/payments');

const router = express.Router();
const fmtDate = iso => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' });
const score = n => String(Number(n).toFixed(1)).replace('.', ',');
const initials = name => (String(name).trim()[0] || '?').toUpperCase();
const reviewCard = r => `<article class="rv">
  <div class="rv-top"><span class="rv-ava" aria-hidden="true">${esc(initials(r.author))}</span><div><p class="rv-name">${esc(r.author)}</p>${r.level ? `<p class="rv-lvl">${esc(r.level)}</p>` : ''}</div>${stars(r.rating, 'rv-stars')}</div>
  <p class="rv-text">${esc(r.text)}</p>
  <p class="rv-date">${fmtDate(r.date)}</p>
  ${r.reply ? `<div class="rv-reply"><p class="rv-reply-h">${icon('flame')} Ответ заведения</p><p>${esc(r.reply.text)}</p></div>` : ''}
</article>`;
const send = (res, html, status = 200) => res.status(status).type('html').send(html);
const jsonScript = (id, data) => `<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function notFound(res) {
  send(res, layout({ title: 'Страница не найдена', noindex: true, body: `<section class="wrap narrow center page-pad">
    <h1>Страница не найдена</h1><p class="muted">Возможно, блюдо убрали из меню или ссылка устарела.</p>
    <p><a class="btn btn-primary" href="/menu">Перейти в меню</a></p></section>` }), 404);
}
router.notFound = notFound;

// ── Главная ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const si = siteInfo();
  const { categories, products } = getCatalog();
  const popular = products.filter(p => p.is_popular && p.available).slice(0, 8);
  const promos = db.prepare('SELECT * FROM promotions WHERE is_active = 1 ORDER BY sort, id').all();
  const catTiles = categories.filter(c => c.products.length).map(c =>
    `<a class="tile" href="/menu#cat-${esc(c.slug)}"><span class="tile-name">${esc(c.name)}</span><span class="tile-n">${c.products.length} поз.</span>${icon('chev')}</a>`).join('');

  const body = `
<section class="hero">
  <picture class="hero-pic">
    <source media="(max-width: 700px)" srcset="/img/hero-m.webp">
    <source media="(max-width: 1200px)" srcset="/img/hero-1100.webp">
    <img src="/img/hero-1920.webp" alt="Роллы, суши и шашлык на углях" width="1920" height="1080" fetchpriority="high">
  </picture>
  <div class="wrap hero-in">
    <div class="hero-text">
      ${openBadge(si)}
      <h1>Шашлык и роллы с доставкой по Нижнему Новгороду</h1>
      <p class="lead">Готовим на заказ. Бесплатная доставка рядом с рестораном и от ${rub(si.threshold)} по всему городу. Самовывоз — на любую сумму.</p>
      <div class="btn-row"><a class="btn btn-primary btn-lg" href="/menu">Смотреть меню</a><a class="btn btn-ghost btn-lg" href="/delivery">Условия доставки</a></div>
    </div>
  </div>
</section>

<section class="wrap sec" aria-labelledby="h-cats">
  <h2 id="h-cats">Категории меню</h2>
  <div class="tiles">${catTiles}</div>
</section>

${popular.length ? `<section class="wrap sec" aria-labelledby="h-pop">
  <div class="sec-head"><h2 id="h-pop">Популярные блюда</h2><a class="link-more" href="/menu">Всё меню ${icon('chev')}</a></div>
  <div class="grid">${popular.map(card).join('')}</div>
</section>` : ''}

<section class="wrap sec" aria-labelledby="h-adv">
  <h2 id="h-adv">Почему заказывают у нас</h2>
  <div class="adv">
    <div class="adv-i">${icon('truck')}<h3>Доставка по всему городу</h3><p>Привозим по Нижнему Новгороду. Бесплатно — по Автозаводскому району и в радиусе ${si.radius} км.</p></div>
    <div class="adv-i">${icon('tag')}<h3>Понятные условия</h3><p>Минимальная сумма доставки — ${rub(si.min)}. От ${rub(si.threshold)} доставка бесплатная в любую точку города.</p></div>
    <div class="adv-i">${icon('store')}<h3>Самовывоз без ограничений</h3><p>Заберите заказ сами на любую сумму — доставка не нужна и ничего не стоит.</p></div>
    <div class="adv-i">${icon('flame')}<h3>Шашлык, шаурма и роллы</h3><p>Гриль, шаурма, суши, роллы, сеты и лапша — в одном заказе.</p></div>
  </div>
</section>

${promos.length ? `<section class="wrap sec" id="promos" aria-labelledby="h-promo">
  <h2 id="h-promo">Акции и условия</h2>
  <div class="promos">${promos.map(p => `<article class="promo">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ''}<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>${p.link ? `<a class="link-more" href="${esc(p.link)}">Подробнее ${icon('chev')}</a>` : ''}</article>`).join('')}</div>
</section>` : ''}

${(() => {
  const rv = reviewsData.load(); if (!rv) return '';
  const pick = rv.reviews.filter(r => r.rating === 5 && r.text.length >= 50 && r.text.length <= 300).slice(0, 3);
  return `<section class="wrap sec" aria-labelledby="h-rev">
  <div class="sec-head"><h2 id="h-rev">Гости о нас</h2><a class="link-more" href="/reviews">Все отзывы ${icon('chev')}</a></div>
  <div class="rv-sum"><span class="rv-big sm">${score(rv.rating)}</span><div>${stars(Math.round(rv.rating), 'lg')}<p class="muted small">${rv.rating_count} оценок на Яндекс.Картах</p></div>
    ${si.reviewsUrl ? `<a class="btn btn-ghost" href="${esc(si.reviewsUrl)}" target="_blank" rel="noopener noreferrer">${icon('pin')} Оставить отзыв</a>` : ''}</div>
  <div class="rv-wall rv-wall-3">${pick.map(reviewCard).join('')}</div></section>`;
})()}

<section class="wrap sec" aria-labelledby="h-del">
  <h2 id="h-del">Доставка</h2>
  <div class="panel">
    <table class="rules">
      <thead><tr><th>Адрес</th><th>Сумма заказа</th><th>Доставка</th></tr></thead>
      <tbody>
        <tr><td>Автозаводский район</td><td>от ${rub(si.min)}</td><td class="ok">Бесплатно</td></tr>
        <tr><td>В радиусе ${si.radius} км от ресторана</td><td>от ${rub(si.min)}</td><td class="ok">Бесплатно</td></tr>
        <tr><td>Остальной город</td><td>${rub(si.min)} – ${rub(si.threshold - 1)}</td><td>${rub(si.fee)}</td></tr>
        <tr><td>Остальной город</td><td>от ${rub(si.threshold)}</td><td class="ok">Бесплатно</td></tr>
        <tr><td>Самовывоз</td><td>любая</td><td class="ok">Бесплатно</td></tr>
      </tbody>
    </table>
    <p class="muted small">Сумма считается после скидок и промокодов. Время работы — по Москве.</p>
  </div>
</section>

<section class="wrap sec" aria-labelledby="h-con">
  <h2 id="h-con">Контакты</h2>
  <div class="panel contact-grid">
    <div><p>${icon('pin')} ${esc(si.address)}</p><p>${icon('phone')} <a href="tel:${esc(si.phoneRaw)}">${esc(si.phone)}</a></p>${si.email ? `<p><a href="mailto:${esc(si.email)}">${esc(si.email)}</a></p>` : ''}
      ${si.mapUrl ? `<p><a class="btn btn-ghost" href="${esc(si.mapUrl)}" target="_blank" rel="noopener">Открыть на Яндекс.Картах</a></p>` : ''}</div>
    <div><h3 class="h-sm">${icon('clock')} Часы работы</h3>${hoursHtml(si)}</div>
  </div>
</section>`;

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: si.name, url: SITE_URL, image: SITE_URL + '/img/og.jpg',
    telephone: si.phone, hasMenu: SITE_URL + '/menu',
    address: { '@type': 'PostalAddress', streetAddress: 'улица Пермякова, 32А', addressLocality: 'Нижний Новгород', addressCountry: 'RU' },
    geo: { '@type': 'GeoCoordinates', latitude: si.lat, longitude: si.lon },
    openingHoursSpecification: si.schedule.map(s => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.day], opens: s.open, closes: s.close })),
  };
  send(res, layout({ title: '', path: '/', page: 'home', body: body + jsonScript('menu-data', clientMap(products)), jsonld,
    description: 'Шаурма, шашлык, люля-кебаб, суши и роллы с доставкой по Нижнему Новгороду. Бесплатная доставка по Автозаводскому району и в радиусе 5 км, самовывоз.' }));
});

// ── Каталог ──────────────────────────────────────────────────
function menuPage(req, res, only) {
  const { categories, products } = getCatalog();
  const cats = categories.filter(c => c.products.length);
  const shown = only ? cats.filter(c => c.slug === only) : cats;
  if (only && !shown.length) return notFound(res);
  const cur = only ? shown[0] : null;
  const chips = `<a class="chip${cur ? '' : ' on'}" href="/menu">Все</a>` + cats.map(c =>
    `<a class="chip${cur && cur.slug === c.slug ? ' on' : ''}" href="${only ? '/menu/' + esc(c.slug) : '#cat-' + esc(c.slug)}">${esc(c.name)}</a>`).join('');
  const body = `
<div class="wrap page-pad-sm">
  <h1>${cur ? esc(cur.name) : 'Меню'}</h1>
  ${cur && cur.description ? `<p class="muted">${esc(cur.description)}</p>` : ''}
</div>
<div class="catbar"><div class="wrap">
  <nav class="chips" aria-label="Категории меню">${chips}</nav>
</div></div>
<div class="wrap">
  <form class="tools" role="search" onsubmit="return false">
    <label class="srch"><span class="sr">Поиск блюда</span>${icon('search')}<input id="search" type="search" placeholder="Найти блюдо" autocomplete="off" enterkeyhint="search"></label>
    <div class="filters" role="group" aria-label="Фильтры">
      <button type="button" class="chip" data-filter="pop" aria-pressed="false">Хиты</button>
      <button type="button" class="chip" data-filter="new" aria-pressed="false">Новинки</button>
      <label class="sel"><span class="sr">Сортировка</span><select id="sort"><option value="">По умолчанию</option><option value="asc">Сначала дешевле</option><option value="desc">Сначала дороже</option></select></label>
    </div>
  </form>
  <p id="nores" class="muted center" hidden>Ничего не найдено. Измените запрос или сбросьте фильтры.</p>
  ${shown.map(c => `<section class="cat" id="cat-${esc(c.slug)}" aria-labelledby="h-${esc(c.slug)}" data-cat>
    ${cur ? '' : `<h2 id="h-${esc(c.slug)}">${esc(c.name)}</h2>`}${!cur && c.description ? `<p class="muted cat-d">${esc(c.description)}</p>` : ''}
    <div class="grid">${c.products.map(card).join('')}</div></section>`).join('')}
</div>${jsonScript('menu-data', clientMap(products))}`;
  send(res, layout({ title: cur ? cur.name : 'Меню', path: cur ? '/menu/' + cur.slug : '/menu', page: 'menu', body,
    description: cur ? `${cur.name} с доставкой по Нижнему Новгороду. ${cur.description || ''}`.trim() : 'Меню: шашлык, люля-кебаб, шаурма, роллы, суши, сеты, лапша. Заказ с доставкой по Нижнему Новгороду и самовывозом.' }));
}
router.get('/menu', (req, res) => menuPage(req, res, null));
router.get('/menu/:slug', (req, res) => menuPage(req, res, req.params.slug));

// ── Карточка блюда ───────────────────────────────────────────
router.get('/dish/:slug', (req, res) => {
  const { products, categories } = getCatalog();
  const p = products.find(x => x.slug === req.params.slug);
  if (!p) return notFound(res);
  const cat = categories.find(c => c.id === p.category_id);
  const related = (cat?.products || []).filter(x => x.id !== p.id && x.available).slice(0, 4);
  const body = `
<div class="wrap page-pad-sm">
  <nav class="crumbs" aria-label="Навигация"><a href="/menu">Меню</a> ${icon('chev')} <a href="/menu/${esc(cat.slug)}">${esc(cat.name)}</a></nav>
  <div class="dish" data-dish="${p.id}">
    ${dishImage(p, 'dish-img')}
    <div class="dish-info">
      <div class="card-badges inline">${p.is_popular ? '<span class="tag tag-hot">Хит</span>' : ''}${p.is_new ? '<span class="tag tag-new">Новинка</span>' : ''}</div>
      <h1>${esc(p.name)}</h1>
      ${p.description ? `<p class="lead-sm">${esc(p.description)}</p>` : ''}
      ${p.per100 ? `<p class="weight-note">Цена указана за 100 г. <strong>Минимальный заказ — ${p.min_grams} г.</strong></p>` : p.weight_label ? `<p class="muted">${esc(p.weight_label)}</p>` : ''}
      ${p.available ? `<div id="dish-form" class="dish-form"></div>` : '<p class="soldout big">Нет в наличии</p>'}
    </div>
  </div>
  ${related.length ? `<section class="sec-sm" aria-labelledby="h-rel"><h2 id="h-rel">Из этой категории</h2><div class="grid">${related.map(card).join('')}</div></section>` : ''}
</div>${jsonScript('menu-data', clientMap(products))}`;
  const jsonld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description || p.name,
    ...(p.image ? { image: SITE_URL + p.image } : {}),
    offers: { '@type': 'Offer', priceCurrency: 'RUB', price: (p.price_from / 100).toFixed(2), availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } };
  send(res, layout({ title: p.name, path: '/dish/' + p.slug, page: 'dish', body, jsonld, image: p.image || undefined,
    description: `${p.name} — ${p.per100 ? rub(p.price_per100) + ' за 100 г, заказ от ' + p.min_grams + ' г' : rub(p.price_from)}. ${p.description || ''} Доставка по Нижнему Новгороду.`.trim() }));
});

// ── Отзывы (снимок Яндекс.Карт) ───────────────────────────────
router.get('/reviews', (req, res) => {
  const si = siteInfo(), rv = reviewsData.load();
  const leave = si.reviewsUrl ? `<a class="btn btn-primary btn-lg" href="${esc(si.reviewsUrl)}" target="_blank" rel="noopener noreferrer">${icon('star')} Оставить отзыв на Яндекс.Картах</a>` : '';
  const all = si.mapUrl ? `<a class="btn btn-ghost btn-lg" href="${esc(si.mapUrl.replace(/\/?$/, '/') + 'reviews/')}" target="_blank" rel="noopener noreferrer">Все отзывы на Яндекс.Картах ${icon('ext')}</a>` : '';
  const body = rv ? `
<section class="rv-hero">
  <div class="wrap rv-hero-in">
    <div class="rv-hero-l"><p class="eyebrow">Отзывы гостей</p><h1>Что говорят о нас гости</h1>
      <p class="lead">Избранные отзывы наших гостей с Яндекс.Карт. Тексты — без правок.</p>
      <div class="btn-row">${leave}${all}</div></div>
    <div class="rv-score" aria-label="Рейтинг на Яндекс.Картах">
      <span class="rv-big">${score(rv.rating)}</span>${stars(Math.round(rv.rating), 'lg')}
      <p>${rv.rating_count} оценок · ${rv.review_count} отзывов</p><p class="muted small">Яндекс.Карты</p>
    </div>
  </div>
</section>
<section class="wrap sec" aria-label="Отзывы">
  <div class="rv-wall">${rv.reviews.map(reviewCard).join('')}</div>
  <p class="muted small center rv-note">Показаны избранные отзывы (4–5 звёзд) с Яндекс.Карт, тексты авторов без изменений, по состоянию на ${fmtDate(rv.fetched_at)}. Все отзывы — на Яндекс.Картах.</p>
</section>
<section class="wrap sec">
  <div class="panel rv-cta">
    <h2>Были у нас или заказывали?</h2><p class="lead-sm">Ваш отзыв помогает другим выбрать и помогает нам становиться лучше.</p>
    <ol class="rv-steps"><li><span>1</span>Нажмите кнопку ниже — откроется наша карточка на Яндекс.Картах</li><li><span>2</span>Поставьте оценку от 1 до 5 звёзд</li><li><span>3</span>Напишите пару слов о блюдах и доставке и нажмите «Опубликовать»</li></ol>
    <p>${leave}</p><p class="muted small">Для отзыва нужен аккаунт Яндекса. Мы не получаем ваших данных.</p>
  </div>
</section>` : `<section class="wrap narrow page-pad center"><h1>Отзывы</h1><p class="muted">Отзывы скоро появятся.</p><p>${leave}</p></section>`;
  send(res, layout({ title: 'Отзывы гостей', path: '/reviews', page: 'reviews', body, description: `Отзывы о ${si.name} на Яндекс.Картах: рейтинг ${rv ? score(rv.rating) : ''}. Оставьте свой отзыв.` }));
});

// ── Корзина ──────────────────────────────────────────────────
router.get('/cart', (req, res) => {
  const body = `
<div class="wrap page-pad-sm">
  <h1>Корзина</h1>
  <noscript><p class="alert">Для работы корзины включите JavaScript в браузере.</p></noscript>
  <div id="cart-empty" class="panel center" hidden><p class="lead-sm">В корзине пока пусто</p><p><a class="btn btn-primary" href="/menu">Перейти в меню</a></p></div>
  <div id="cart-root" class="cart-grid" hidden>
    <section class="cart-main" aria-label="Состав заказа"><ul id="cart-lines" class="lines"></ul></section>
    <aside class="cart-side">
      <div class="panel">
        <fieldset class="seg" aria-label="Способ получения"><legend class="sr">Способ получения</legend>
          <label><input type="radio" name="ful" value="delivery" checked><span>${icon('truck')} Доставка</span></label>
          <label><input type="radio" name="ful" value="pickup"><span>${icon('store')} Самовывоз</span></label>
        </fieldset>
        <div id="addr-box">
          <label class="lbl" for="addr">Адрес доставки</label>
          <div class="addr-row"><input id="addr" type="text" inputmode="text" autocomplete="street-address" placeholder="Улица и номер дома, например: Белинского 61" role="combobox" aria-expanded="false" aria-controls="addr-list" aria-autocomplete="list" maxlength="200">
          <button class="btn btn-ghost" type="button" id="addr-find">Найти</button></div>
          <ul id="addr-list" class="sugg" role="listbox" hidden></ul>
          <p id="addr-msg" class="hint" role="status"></p>
        </div>
        <div id="pickup-box" hidden><p class="hint">${icon('pin')} Самовывоз: ${esc(settings.get('contact.address'))}</p></div>
      </div>
      <div id="indicator" class="panel ind" aria-live="polite"></div>
      <div class="panel">
        <label class="lbl" for="promo">Промокод</label>
        <div class="addr-row"><input id="promo" type="text" autocomplete="off" autocapitalize="characters" placeholder="Введите промокод" maxlength="40"><button class="btn btn-ghost" id="promo-apply" type="button">Применить</button></div>
        <p id="promo-msg" class="hint" role="status"></p>
      </div>
      <div class="panel sum">
        <dl>
          <div><dt>Сумма блюд</dt><dd id="s-sub">—</dd></div>
          <div id="s-disc-row" hidden><dt>Скидка <span id="s-promo" class="muted"></span></dt><dd id="s-disc" class="ok">—</dd></div>
          <div><dt>Доставка</dt><dd id="s-del">—</dd></div>
          <div class="total"><dt>Итого</dt><dd id="s-total">—</dd></div>
        </dl>
        <p id="cart-block" class="alert" hidden></p>
        <button class="btn btn-primary btn-block btn-lg" id="to-checkout" type="button" disabled>Перейти к оформлению</button>
      </div>
    </aside>
  </div>
</div>
<div class="sticky-cta" id="sticky-cta" hidden><div><span class="muted small">Итого</span><strong id="sticky-total">—</strong></div><button class="btn btn-primary btn-lg" id="sticky-go" type="button" disabled>Оформить</button></div>`;
  send(res, layout({ title: 'Корзина', path: '/cart', page: 'cart', body, noindex: true }));
});

// ── Оформление ───────────────────────────────────────────────
router.get('/checkout', (req, res) => {
  const methods = payments.enabledMethods();
  const body = `
<div class="wrap page-pad-sm">
  <h1>Оформление заказа</h1>
  <div id="co-empty" class="panel center" hidden><p class="lead-sm">Корзина пуста</p><p><a class="btn btn-primary" href="/menu">Перейти в меню</a></p></div>
  <form id="co-form" class="co-grid" novalidate hidden>
    <div class="co-main">
      <div id="co-alert" class="alert" role="alert" hidden></div>
      <fieldset class="panel f-set"><legend>Получение</legend>
        <div class="seg" role="radiogroup" aria-label="Способ получения">
          <label><input type="radio" name="fulfillment" value="delivery"><span>${icon('truck')} Доставка</span></label>
          <label><input type="radio" name="fulfillment" value="pickup"><span>${icon('store')} Самовывоз</span></label>
        </div>
        <div id="co-addr-delivery">
          <p class="lbl">Адрес доставки</p>
          <div class="addr-show"><span id="co-addr-text">Адрес не указан</span> <a href="/cart#addr">Изменить</a></div>
          <div class="f-row f4">
            <div class="f"><label for="apartment">Квартира</label><input id="apartment" name="apartment" autocomplete="off" maxlength="20" inputmode="text"></div>
            <div class="f"><label for="entrance">Подъезд</label><input id="entrance" name="entrance" autocomplete="off" maxlength="20" inputmode="numeric"></div>
            <div class="f"><label for="floor">Этаж</label><input id="floor" name="floor" autocomplete="off" maxlength="20" inputmode="numeric"></div>
            <div class="f"><label for="intercom">Домофон</label><input id="intercom" name="intercom" autocomplete="off" maxlength="30" inputmode="text"></div>
          </div>
          <div class="f"><label for="courier_comment">Комментарий курьеру <span class="opt">необязательно</span></label><textarea id="courier_comment" name="courier_comment" rows="2" maxlength="300"></textarea></div>
        </div>
        <div id="co-addr-pickup" hidden><p class="hint">${icon('pin')} ${esc(settings.get('contact.address'))}</p></div>
        <p class="lbl">Время</p>
        <div class="seg seg-sm" role="radiogroup" aria-label="Время получения">
          <label><input type="radio" name="when" value="asap" checked><span>Как можно скорее</span></label>
          <label><input type="radio" name="when" value="later"><span>Ко времени</span></label>
        </div>
        <p class="hint" id="closed-note" hidden>Сейчас мы не принимаем заказы «как можно скорее». Выберите время в часы работы — оформим предзаказ.</p>
        <div class="f" id="when-box" hidden><label for="desired_time">Желаемое время (по Москве)</label><input id="desired_time" name="desired_time" type="datetime-local" step="900"><p class="err" data-err="desired_time"></p></div>
      </fieldset>
      <fieldset class="panel f-set"><legend>Контакты</legend>
        <div class="f"><label for="name">Имя</label><input id="name" name="name" autocomplete="name" required maxlength="80"><p class="err" data-err="name"></p></div>
        <div class="f"><label for="phone">Телефон</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" required maxlength="25"><p class="err" data-err="phone"></p></div>
        <div class="f"><label for="email">Электронная почта <span class="opt">необязательно</span></label><input id="email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120"><p class="err" data-err="email"></p></div>
        <div class="f"><label for="comment">Комментарий к заказу <span class="opt">необязательно</span></label><textarea id="comment" name="comment" rows="2" maxlength="500"></textarea></div>
      </fieldset>
      ${methods.length ? `<fieldset class="panel f-set"><legend>Оплата</legend>
        <div class="radios">${methods.map((m, i) => `<label class="radio"><input type="radio" name="payment_method" value="${esc(m.code)}" ${i === 0 ? 'checked' : ''}><span>${esc(m.title)}</span></label>`).join('')}</div>
        <p class="hint">Онлайн-оплата на сайте пока не подключена.</p><p class="err" data-err="payment_method"></p></fieldset>` : ''}
      <div class="panel f-set">
        <label class="check"><input type="checkbox" name="consent_pd" id="consent_pd" required><span>Даю согласие на обработку персональных данных на условиях <a href="/personal-data" target="_blank">согласия</a> и <a href="/privacy" target="_blank">политики конфиденциальности</a></span></label>
        <p class="err" data-err="consent_pd"></p>
        <label class="check"><input type="checkbox" name="consent_email" id="consent_email"><span>Хочу получать подтверждение заказа и уведомления о статусе на email <span class="opt">необязательно</span></span></label>
      </div>
    </div>
    <aside class="co-side">
      <div class="panel sum">
        <h2 class="h-sm">Ваш заказ</h2>
        <ul id="co-lines" class="mini"></ul>
        <dl>
          <div><dt>Сумма блюд</dt><dd id="c-sub">—</dd></div>
          <div id="c-disc-row" hidden><dt>Скидка <span id="c-promo" class="muted"></span></dt><dd id="c-disc" class="ok">—</dd></div>
          <div><dt>Доставка</dt><dd id="c-del">—</dd></div>
          <div class="total"><dt>Итого к оплате</dt><dd id="c-total">—</dd></div>
        </dl>
        <p id="co-block" class="alert" hidden></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="co-submit">Оформить заказ</button>
        <p class="muted small center">Нажимая «Оформить заказ», вы подтверждаете итоговую сумму.</p>
      </div>
    </aside>
  </form>
</div>`;
  send(res, layout({ title: 'Оформление заказа', path: '/checkout', page: 'checkout', body, noindex: true }));
});

// ── Страница заказа ──────────────────────────────────────────
router.get('/order/:number', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE number = ?').get(req.params.number);
  if (!o || o.public_token !== String(req.query.t || '')) return notFound(res);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  const hist = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id').all(o.id);
  const si = siteInfo();
  const body = `
<div class="wrap narrow page-pad-sm">
  <div class="panel center ok-box">
    <div class="ok-ic">${icon('check')}</div>
    <h1>Заказ ${esc(o.number)} принят</h1>
    <p class="lead-sm">Мы получили ваш заказ и свяжемся с вами по телефону ${esc(o.phone)} для подтверждения.</p>
    <p>Статус: <strong>${esc(STATUS_LABELS[o.status])}</strong></p>
  </div>
  <div class="panel">
    <h2 class="h-sm">Состав заказа</h2>
    <ul class="mini">${items.map(i => `<li><span>${esc(i.name)}${i.variant_name ? ' — ' + esc(i.variant_name) : ''}${JSON.parse(i.options_json).length ? `<small class="muted"> + ${esc(JSON.parse(i.options_json).map(x => x.name).join(', '))}</small>` : ''} × ${i.qty}</span><span>${rub(i.line_total_kop)}</span></li>`).join('')}</ul>
    <dl class="sum-dl"><div><dt>Сумма блюд</dt><dd>${rub(o.subtotal_kop)}</dd></div>
    ${o.discount_kop ? `<div><dt>Скидка ${esc(o.promo_code)}</dt><dd class="ok">−${rub(o.discount_kop)}</dd></div>` : ''}
    <div><dt>Доставка</dt><dd>${o.fulfillment === 'pickup' ? 'Самовывоз' : o.delivery_fee_kop ? rub(o.delivery_fee_kop) : 'Бесплатно'}</dd></div>
    <div class="total"><dt>Итого</dt><dd>${rub(o.total_kop)}</dd></div></dl>
  </div>
  <div class="panel">
    <h2 class="h-sm">${o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'}</h2>
    <p>${o.fulfillment === 'pickup' ? esc(si.address) : esc(o.address) + [o.apartment && ', кв. ' + esc(o.apartment), o.entrance && ', подъезд ' + esc(o.entrance), o.floor && ', этаж ' + esc(o.floor), o.intercom && ', домофон ' + esc(o.intercom)].filter(Boolean).join('')}</p>
    ${o.desired_time ? `<p class="muted">Желаемое время: ${esc(o.desired_time)} (МСК)</p>` : ''}
    <p class="muted">Оплата: ${o.payment_method ? esc(o.payment_method === 'on_receipt' ? 'при получении' : o.payment_method) : 'уточнит оператор'}.</p>
  </div>
  <p class="center"><a class="btn btn-primary" href="/menu">Вернуться в меню</a></p>
</div>`;
  send(res, layout({ title: `Заказ ${o.number}`, path: '/order/' + o.number, page: 'order', body, noindex: true }));
});

// ── Личный кабинет ───────────────────────────────────────────
router.get('/account', (req, res) => {
  const body = `<div class="wrap narrow page-pad-sm"><h1>Личный кабинет</h1><div id="account-root"><p class="muted">Загрузка…</p></div></div>`;
  send(res, layout({ title: 'Личный кабинет', path: '/account', page: 'account', body, noindex: true }));
});

// ── Информационные и юридические страницы ────────────────────
const INFO = ['about', 'delivery', 'contacts', 'privacy', 'personal-data', 'terms'];
function fillTokens(html, si) {
  const map = {
    name: esc(si.name), address: esc(si.address), phone: esc(si.phone), phone_raw: esc(si.phoneRaw), hours_html: hoursHtml(si),
    min: rub(si.min), fee: rub(si.fee), threshold: rub(si.threshold), threshold_minus: rub(si.threshold - 1), radius: String(si.radius),
  };
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? '');
}
for (const slug of INFO) {
  router.get('/' + slug, (req, res) => {
    const pg = db.prepare('SELECT * FROM pages WHERE slug = ?').get(slug);
    if (!pg) return notFound(res);
    const si = siteInfo();
    const extra = slug === 'contacts' && si.mapUrl ? `<p><a class="btn btn-ghost" href="${esc(si.mapUrl)}" target="_blank" rel="noopener">Открыть на Яндекс.Картах</a></p>` : '';
    const body = `<article class="wrap narrow page-pad-sm prose"><h1>${esc(pg.title)}</h1>${fillTokens(pg.body, si)}${extra}</article>`;
    send(res, layout({ title: pg.title, path: '/' + slug, page: 'info', body }));
  });
}

// ── SEO ──────────────────────────────────────────────────────
router.get('/robots.txt', (req, res) => {
  const { ADMIN_PATH } = require('../config');
  res.type('text/plain').send(`User-agent: *\nDisallow: ${ADMIN_PATH}\nDisallow: /api/\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /account\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});
router.get('/sitemap.xml', (req, res) => {
  const { categories, products } = getCatalog();
  const urls = ['/', '/menu', '/reviews', ...categories.filter(c => c.products.length).map(c => '/menu/' + c.slug), ...products.map(p => '/dish/' + p.slug), ...INFO.map(s => '/' + s)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${SITE_URL}${esc(u)}</loc></url>`).join('\n')}\n</urlset>`);
});

module.exports = router;
