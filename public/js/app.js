/* В'кусно — клиентская часть витрины. Цены, скидки и доставка ВСЕГДА считает сервер (/api/quote, /api/order);
   здесь только состав корзины и отображение. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const page = document.body.dataset.page;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rub = kop => {
    const v = kop / 100, s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
    const [i, f] = s.split(',');
    return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? ',' + f : '') + ' ₽';
  };
  const ic = n => `<svg class="ic" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ── Локальное хранилище (с защитой от недоступности) ─────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
  };

  // ── Корзина: хранит только выбор клиента (id, вариант, опции, количество) ──
  const MAXQ = 50;
  const keyOf = (p, v, o) => `${p}:${v || 0}:${[...o].sort((a, b) => a - b).join(',')}`;
  let cart = (store.get('vk_cart', []) || []).filter(l => l && Number.isInteger(l.p) && l.q > 0).map(l => ({ k: l.k, p: l.p, v: l.v || 0, o: l.o || [], q: Math.min(MAXQ, l.q) }));
  const saveCart = () => { store.set('vk_cart', cart); window.dispatchEvent(new Event('cart:change')); };
  const cartCount = () => cart.reduce((s, l) => s + l.q, 0);
  function addToCart(p, v, o, q) {
    const k = keyOf(p, v, o), ex = cart.find(l => l.k === k);
    if (ex) ex.q = Math.min(MAXQ, ex.q + q); else cart.push({ k, p, v: v || 0, o: [...o], q: Math.min(MAXQ, q) });
    saveCart();
  }
  function setQty(k, q) {
    const l = cart.find(x => x.k === k); if (!l) return;
    if (q <= 0) cart = cart.filter(x => x.k !== k); else l.q = Math.min(MAXQ, q);
    saveCart();
  }
  const clearCart = () => { cart = []; saveCart(); };
  window.addEventListener('storage', e => { if (e.key === 'vk_cart') { cart = store.get('vk_cart', []) || []; window.dispatchEvent(new Event('cart:change')); } });

  // ── Сеть ────────────────────────────────────────────────────
  let csrf = null, meP = null;
  const loadMe = () => meP || (meP = fetch('/api/me', { credentials: 'same-origin' }).then(r => r.json()).then(j => { csrf = j.csrf; return j.user; }).catch(() => null));
  async function api(path, { method = 'GET', body } = {}) {
    const h = {};
    if (method !== 'GET') { await loadMe(); h['Content-Type'] = 'application/json'; if (csrf) h['X-CSRF-Token'] = csrf; }
    let r;
    try { r = await fetch(path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
    catch { const e = new Error('network'); e.network = true; throw e; }
    let j = {}; try { j = await r.json(); } catch { /* пустой ответ */ }
    if (!r.ok) { const e = new Error(j.message || 'Ошибка'); e.status = r.status; e.data = j; throw e; }
    return j;
  }

  // ── Уведомления ─────────────────────────────────────────────
  function toast(msg, { link, type, ms = 3500, action } = {}) {
    const box = $('#toasts'); if (!box) return;
    const t = document.createElement('div'); t.className = 'toast' + (type === 'err' ? ' err' : '');
    t.innerHTML = `<span>${esc(msg)}</span>${link ? `<a href="${link.href}">${esc(link.text)}</a>` : ''}${action ? '<button class="btn btn-ghost btn-sm" type="button">' + esc(action.text) + '</button>' : ''}`;
    if (action) $('button', t).addEventListener('click', () => { t.remove(); action.fn(); });
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
    while (box.children.length > 3) box.firstChild.remove();
  }

  // ── Шапка: бейдж корзины, меню-«гамбургер», активный пункт ───
  function updateBadges() {
    const n = cartCount();
    $$('[data-cart-count]').forEach(b => { b.textContent = n; b.hidden = n === 0; });
  }
  window.addEventListener('cart:change', updateBadges); updateBadges();
  $$('.bnav a[data-nav]').forEach(a => { if (location.pathname.startsWith(a.getAttribute('href'))) a.classList.add('on'); });
  const drawer = $('#drawer');
  if (drawer) {
    const open = () => { drawer.hidden = false; $('[data-drawer-open]').setAttribute('aria-expanded', 'true'); $('.drawer-x', drawer).focus(); document.body.style.overflow = 'hidden'; };
    const close = () => { drawer.hidden = true; $('[data-drawer-open]').setAttribute('aria-expanded', 'false'); document.body.style.overflow = ''; $('[data-drawer-open]').focus(); };
    $('[data-drawer-open]').addEventListener('click', open);
    $$('[data-drawer-close]').forEach(e => e.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) close(); });
    $$('a', drawer).forEach(a => a.addEventListener('click', () => { document.body.style.overflow = ''; }));
  }
  $$('[data-focus-search]').forEach(a => a.addEventListener('click', e => {
    const inp = $('#search'); if (inp) { e.preventDefault(); inp.scrollIntoView({ block: 'center' }); inp.focus(); }
  }));
  if (location.hash === '#search') setTimeout(() => $('#search')?.focus(), 50);

  // ── Данные меню (для добавления в корзину) ───────────────────
  let MENU = {};
  try { MENU = JSON.parse($('#menu-data')?.textContent || '{}'); } catch { /* */ }

  const unitPrice = (p, vid, oids) => {
    let u = p.p; if (p.v.length) u = (p.v.find(v => v.id === vid) || p.v[0]).p;
    for (const id of oids) u += (p.o.find(o => o.id === id) || { p: 0 }).p;
    return u;
  };

  // Форма выбора (варианты, опции, количество) — в окне на мобильных и на странице блюда
  function buildForm(pid, onDone) {
    const p = MENU[pid], f = document.createElement('form');
    f.className = 'opt-form'; let qty = 1;
    f.innerHTML = `
      ${p.v.length ? `<fieldset class="opt-group"><legend>${p.w ? `Выберите вес · цена за 100 г: ${rub(p.w.p)}` : 'Выберите вариант'}</legend>${p.w ? `<p class="hint hint-min">Минимальный заказ — ${p.w.m} г</p>` : ''}<div class="radios">${p.v.map((v, i) =>
        `<label class="radio"><input type="radio" name="variant" value="${v.id}" ${i === 0 ? 'checked' : ''}><span>${esc(v.n)}</span><span class="p">${rub(v.p)}</span></label>`).join('')}</div></fieldset>` : ''}
      ${p.o.length ? `<fieldset class="opt-group"><legend>Добавки <span class="opt">необязательно</span></legend><div class="radios">${p.o.map(o =>
        `<label class="check"><input type="checkbox" name="opt" value="${o.id}"><span>${esc(o.n)}</span><span class="p muted">${o.p ? '+' + rub(o.p) : 'бесплатно'}</span></label>`).join('')}</div></fieldset>` : ''}
      <div class="buy-row">
        <div class="stepper" role="group" aria-label="Количество"><button type="button" data-d="-1" aria-label="Уменьшить количество">${ic('minus')}</button><output aria-live="polite">1</output><button type="button" data-d="1" aria-label="Увеличить количество">${ic('plus')}</button></div>
        <button class="btn btn-primary btn-lg" type="submit"></button>
      </div>`;
    const state = () => ({ vid: Number($('input[name=variant]:checked', f)?.value || 0), oids: $$('input[name=opt]:checked', f).map(i => Number(i.value)) });
    const redraw = () => { const s = state(); $('output', f).textContent = qty; $('button[type=submit]', f).textContent = `Добавить · ${rub(unitPrice(p, s.vid, s.oids) * qty)}`; };
    f.addEventListener('change', redraw);
    f.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { qty = Math.max(1, Math.min(MAXQ, qty + Number(b.dataset.d))); redraw(); } });
    f.addEventListener('submit', e => {
      e.preventDefault(); const s = state();
      addToCart(Number(pid), s.vid, s.oids, qty);
      toast(`Добавлено: ${p.n}`, { link: { href: '/cart', text: 'В корзину' } });
      onDone && onDone();
    });
    redraw(); return f;
  }
  function openSheet(pid) {
    const p = MENU[pid]; let dlg = $('#sheet');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'sheet'; dlg.className = 'sheet'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<div class="sheet-in"><div class="sheet-hd"><h2>${esc(p.n)}</h2><button class="icon-btn" type="button" data-close aria-label="Закрыть">${ic('x')}</button></div></div>`;
    $('.sheet-in', dlg).appendChild(buildForm(pid, () => dlg.close()));
    $('[data-close]', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }, { once: true });
    dlg.showModal();
  }

  // Кнопка «В корзину» / счётчик «− 1 +» на карточке
  function renderAct(pid) {
    const box = $(`[data-act="${pid}"]`); if (!box) return;
    const p = MENU[pid]; if (!p || !p.a) return;
    const simple = !p.v.length && !p.o.length;
    const line = simple ? cart.find(l => l.p === Number(pid) && l.v === 0 && !l.o.length) : null;
    if (line) {
      box.innerHTML = `<div class="stepper" role="group" aria-label="Количество: ${esc(p.n)}"><button type="button" data-q="-1" aria-label="Уменьшить количество">${ic('minus')}</button><output aria-live="polite">${line.q}</output><button type="button" data-q="1" aria-label="Увеличить количество">${ic('plus')}</button></div>`;
    } else if (!$('[data-add]', box)) {
      box.innerHTML = `<button class="btn btn-primary btn-sm" type="button" data-add="${pid}" ${simple ? '' : 'data-choose="1"'}>${simple ? 'В корзину' : 'Выбрать'}</button>`;
    }
  }
  document.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const pid = add.dataset.add, p = MENU[pid]; if (!p) return;
      if (add.dataset.choose) return openSheet(pid);
      addToCart(Number(pid), 0, [], 1);
      toast(`Добавлено: ${p.n}`, { link: { href: '/cart', text: 'В корзину' } });
      return;
    }
    const q = e.target.closest('[data-act] [data-q]');
    if (q) {
      const pid = Number(q.closest('[data-act]').dataset.act), line = cart.find(l => l.p === pid && l.v === 0 && !l.o.length);
      if (line) setQty(line.k, line.q + Number(q.dataset.q));
    }
  });
  const renderAllActs = () => $$('[data-act]').forEach(b => renderAct(b.dataset.act));
  window.addEventListener('cart:change', renderAllActs); renderAllActs();

  // ── Каталог: поиск, фильтры, сортировка, активная категория ──
  function initMenu() {
    const input = $('#search'), sort = $('#sort'), flt = { pop: false, new: false };
    const cards = $$('.card[data-id]'); if (!input) return;
    cards.forEach((c, i) => { c.dataset.i = i; });
    const apply = () => {
      const q = input.value.trim().toLowerCase(); let any = false;
      for (const c of cards) {
        const show = (!q || c.dataset.name.includes(q)) && (!flt.pop || c.dataset.pop === '1') && (!flt.new || c.dataset.new === '1');
        c.hidden = !show; if (show) any = true;
      }
      $$('[data-cat]').forEach(s => { s.hidden = !$$('.card', s).some(c => !c.hidden); });
      $('#nores').hidden = any;
      $$('[data-cat] .grid').forEach(g => {
        const arr = $$('.card', g).sort((a, b) => sort.value === 'asc' ? a.dataset.price - b.dataset.price : sort.value === 'desc' ? b.dataset.price - a.dataset.price : a.dataset.i - b.dataset.i);
        arr.forEach(c => g.appendChild(c));
      });
    };
    input.addEventListener('input', debounce(apply, 120)); sort.addEventListener('change', apply);
    $$('[data-filter]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.filter; flt[k] = !flt[k]; b.setAttribute('aria-pressed', flt[k]); apply(); }));
    // подсветка текущей категории при прокрутке (без scrollIntoView — он дёргал страницу)
    const chipsBox = $('.chips'), chips = $$('.chips a[href^="#cat-"]');
    if (chips.length && 'IntersectionObserver' in window) {
      let cur = null;
      const mark = id => {
        if (id === cur) return; cur = id; $('.chips a[href="/menu"]')?.classList.remove('on');
        let active = null;
        chips.forEach(c => { const on = c.getAttribute('href') === '#' + id; c.classList.toggle('on', on); if (on) active = c; });
        if (active) { const l = active.offsetLeft - (chipsBox.clientWidth - active.offsetWidth) / 2; chipsBox.scrollTo({ left: Math.max(0, l), behavior: 'auto' }); }
      };
      const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) mark(en.target.id); }), { rootMargin: '-30% 0px -65% 0px' });
      $$('[data-cat]').forEach(sec => io.observe(sec));
    }
  }

  // ── Страница блюда ──────────────────────────────────────────
  function initDish() {
    const host = $('#dish-form'); if (!host) return;
    host.appendChild(buildForm($('[data-dish]').dataset.dish));
  }

  // ── Состояние доставки (общее для корзины и оформления) ──────
  const ful = () => store.get('vk_ful', 'delivery') === 'pickup' ? 'pickup' : 'delivery';
  const addrState = () => store.get('vk_addr', null);
  const promoCode = () => store.get('vk_promo', '') || '';
  const payload = () => ({
    items: cart.map(l => ({ ref: l.k, product_id: l.p, variant_id: l.v || null, option_ids: l.o, qty: l.q })),
    promo_code: promoCode(), fulfillment: ful(), address_token: ful() === 'delivery' ? (addrState()?.token || '') : '',
  });
  let seq = 0;
  async function fetchQuote() {
    const my = ++seq, r = await api('/api/quote', { method: 'POST', body: payload() });
    return my === seq ? r : null; // устаревший ответ отбрасываем
  }
  const delText = q => {
    const d = q.delivery;
    if (q.fulfillment === 'pickup') return 'Бесплатно';
    if (d.blocked_reason === 'no_address' || d.blocked_reason === 'bad_address') return 'Укажите адрес';
    if (d.blocked_reason === 'delivery_disabled') return 'Недоступна';
    return d.fee_kop ? rub(d.fee_kop) : 'Бесплатно';
  };
  const blockText = (q, store_) => {
    const d = q.delivery;
    if (!q.lines.length) return 'Корзина пуста';
    if (q.has_issues) return 'Уберите из корзины недоступные блюда';
    if (store_ && !store_.accepting) return store_.message;
    if (q.fulfillment === 'delivery') {
      if (d.blocked_reason === 'below_min') return `Доставка недоступна: минимальная сумма заказа ${rub(d.min_order_kop)}. Добавьте ещё на ${rub(d.remaining_min_kop)} или выберите самовывоз.`;
      if (d.blocked_reason === 'no_address') return 'Укажите адрес доставки, чтобы продолжить';
      if (d.blocked_reason === 'bad_address') return 'Адрес устарел — выберите его из подсказок заново';
      if (d.blocked_reason === 'delivery_disabled') return 'Доставка временно недоступна. Выберите самовывоз.';
    }
    if (q.promo && q.promo.status !== 'applied') return '';
    return '';
  };

  // ── Корзина ─────────────────────────────────────────────────
  function initCart() {
    const root = $('#cart-root'), empty = $('#cart-empty'), list = $('#cart-lines');
    let last = null, lastStore = null;
    const setFul = v => {
      store.set('vk_ful', v);
      $$('input[name=ful]').forEach(r => { r.checked = r.value === v; });
      $('#addr-box').hidden = v !== 'delivery'; $('#pickup-box').hidden = v !== 'pickup';
    };
    setFul(ful());
    $$('input[name=ful]').forEach(r => r.addEventListener('change', () => { setFul(r.value); refresh(); }));

    const lineHtml = l => {
      const issue = { unavailable: 'Сейчас недоступно', gone: 'Блюдо удалено из меню', variant_required: 'Выберите вариант блюда заново', bad_option: 'Добавка недоступна' }[l.issue];
      const img = l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy" width="96" height="96">` : `<img src="/img/mark.webp" alt="" width="48" height="38">`;
      return `<li class="line${issue ? ' bad' : ''}" data-k="${esc(l.ref)}">
        <div class="card-img${l.image ? '' : ' ph'}">${img}</div>
        <div><p class="line-name">${l.slug ? `<a href="/dish/${esc(l.slug)}">${esc(l.name)}</a>` : esc(l.name)}</p>
          ${l.variant_name ? `<p class="line-sub">${esc(l.variant_name)}</p>` : ''}
          ${l.options.length ? `<p class="line-sub">+ ${esc(l.options.map(o => o.name).join(', '))}</p>` : ''}
          ${issue ? `<p class="line-issue">${issue}</p>` : `<p class="line-sub">${rub(l.unit_kop)} за шт.</p>`}</div>
        <div class="line-foot">
          <div class="stepper" role="group" aria-label="Количество: ${esc(l.name)}">
            <button type="button" data-q="-1" aria-label="Уменьшить количество: ${esc(l.name)}">${ic('minus')}</button><output aria-live="polite">${l.qty}</output><button type="button" data-q="1" aria-label="Увеличить количество: ${esc(l.name)}">${ic('plus')}</button></div>
          <span class="line-sum">${issue ? '' : rub(l.line_kop)}</span>
          <button class="icon-btn line-del" type="button" data-del aria-label="Удалить: ${esc(l.name)}">${ic('trash')}</button>
        </div></li>`;
    };
    list.addEventListener('click', e => {
      const li = e.target.closest('.line'); if (!li) return;
      const k = li.dataset.k, l = cart.find(x => x.k === k); if (!l) return;
      if (e.target.closest('[data-del]')) setQty(k, 0);
      const q = e.target.closest('[data-q]'); if (q) setQty(k, l.q + Number(q.dataset.q));
    });

    function render(r) {
      const q = r.quote, d = q.delivery; last = q; lastStore = r.store;
      list.innerHTML = q.lines.map(lineHtml).join('');
      $('#s-sub').textContent = rub(q.subtotal_kop);
      $('#s-disc-row').hidden = !q.discount_kop;
      if (q.discount_kop) { $('#s-disc').textContent = '−' + rub(q.discount_kop); $('#s-promo').textContent = q.promo?.code ? `(${q.promo.code})` : ''; }
      $('#s-del').textContent = delText(q);
      $('#s-total').textContent = rub(q.total_kop);
      // промокод
      const pm = $('#promo-msg');
      if (q.promo) { pm.textContent = q.promo.message; pm.className = 'hint ' + (q.promo.status === 'applied' ? 'good' : 'bad'); } else { pm.textContent = ''; pm.className = 'hint'; }
      // адрес
      const am = $('#addr-msg');
      if (q.fulfillment === 'delivery') {
        if (d.zone) {
          am.className = 'hint good';
          am.innerHTML = `${ic('check')} ${esc(d.zone.address)}${d.zone.free ? (d.zone.reason === 'district' ? ' · Автозаводский район' : ` · ${d.zone.distance_km} км от ресторана`) : ` · ${d.zone.distance_km} км от ресторана`}`;
        } else if (d.blocked_reason === 'bad_address') { am.className = 'hint bad'; am.textContent = 'Адрес устарел — выберите его из подсказок заново.'; store.del('vk_addr'); }
        else if (!$('#addr-list').children.length) { am.className = 'hint'; am.textContent = 'Начните вводить улицу и номер дома — мы проверим адрес и рассчитаем доставку.'; }
      }
      // индикатор
      const ind = d.indicator, box = $('#indicator'); let h = '';
      if (ind) {
        const isFree = ind.type === 'free_zone' || ind.type === 'free_reached' || ind.type === 'pickup';
        const bar = ['progress', 'below_min', 'free_reached'].includes(ind.type)
          ? `<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ind.progress)}" aria-label="Прогресс до бесплатной доставки"><i data-w="${ind.progress}"></i></div>` : '';
        h = `<p class="ind-msg">${ic(ind.type === 'pickup' ? 'store' : 'truck')} ${esc(ind.message)}</p>${bar}${ind.min_message ? `<p class="ind-warn">${esc(ind.min_message)}</p>` : ''}`;
        box.className = 'panel ind' + (isFree ? ' ind-ok' : '');
      }
      box.innerHTML = h;
      const i = $('i[data-w]', box); if (i) requestAnimationFrame(() => { i.style.width = i.dataset.w + '%'; });
      // кнопки
      const msg = blockText(q, r.store), can = q.can_checkout && r.store.accepting;
      const blk = $('#cart-block'); blk.hidden = !msg; blk.textContent = msg;
      for (const b of [$('#to-checkout'), $('#sticky-go')]) { b.disabled = !can; b.setAttribute('aria-disabled', !can); }
      $('#sticky-total').textContent = rub(q.total_kop);
    }
    async function refresh() {
      if (!cart.length) { root.hidden = true; $('#sticky-cta').hidden = true; empty.hidden = false; return; }
      empty.hidden = true; root.hidden = false; $('#sticky-cta').hidden = false;
      try { const r = await fetchQuote(); if (r) render(r); }
      catch (e) {
        if (e.network) toast('Нет связи с сервером. Суммы могут быть неактуальны.', { type: 'err', ms: 7000, action: { text: 'Повторить', fn: refresh } });
        else toast(e.message || 'Не удалось рассчитать заказ', { type: 'err' });
      }
    }
    window.addEventListener('cart:change', debounce(refresh, 60));

    // промокод
    $('#promo').value = promoCode();
    const applyPromo = () => { store.set('vk_promo', $('#promo').value.trim()); refresh(); };
    $('#promo-apply').addEventListener('click', applyPromo);
    $('#promo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } });

    // адрес
    const input = $('#addr'), listEl = $('#addr-list'), am = $('#addr-msg');
    const a0 = addrState(); if (a0) input.value = a0.label;
    let searching = 0;
    const closeList = () => { listEl.hidden = true; listEl.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); };
    async function search() {
      const text = input.value.trim(); if (text.length < 4) return;
      const my = ++searching; am.className = 'hint'; am.textContent = 'Проверяем адрес…';
      try {
        const r = await api('/api/address/search', { method: 'POST', body: { q: text } });
        if (my !== searching) return;
        if (!r.candidates.length) { closeList(); am.className = 'hint bad'; am.textContent = 'Адрес не найден. Укажите улицу и номер дома, например: Белинского 61.'; return; }
        am.textContent = 'Выберите адрес из списка:';
        listEl.innerHTML = r.candidates.map((c, i) => c.token
          ? `<li role="option" tabindex="0" data-i="${i}">${esc(c.label)}</li>`
          : `<li role="option" class="dis" aria-disabled="true">${esc(c.label)}<small>${c.problem === 'outside_city' ? 'За пределами Нижнего Новгорода — доставка по городским тарифам недоступна' : 'Уточните номер дома'}</small></li>`).join('');
        listEl.hidden = false; input.setAttribute('aria-expanded', 'true');
        listEl._c = r.candidates;
      } catch (e) {
        if (my !== searching) return; closeList(); am.className = 'hint bad';
        am.textContent = e.network ? 'Нет связи с сервером. Проверьте интернет и нажмите «Найти».' : (e.data?.message || 'Не удалось проверить адрес. Попробуйте ещё раз или выберите самовывоз.');
      }
    }
    const pick = li => {
      const c = listEl._c?.[Number(li.dataset.i)]; if (!c?.token) return;
      store.set('vk_addr', { label: c.label, token: c.token }); input.value = c.label; closeList(); refresh();
    };
    listEl.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pick(li); });
    listEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.i) pick(e.target); });
    input.addEventListener('input', () => {
      if (addrState() && input.value.trim() !== addrState().label) { store.del('vk_addr'); refresh(); } // ввод изменён — прежний выбор недействителен
      debounceSearch();
    });
    const debounceSearch = debounce(() => { if (input.value.trim().length >= 6 && !addrState()) search(); }, 900);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    $('#addr-find').addEventListener('click', search);

    const go = () => { if (last && last.can_checkout) location.href = '/checkout'; };
    $('#to-checkout').addEventListener('click', go); $('#sticky-go').addEventListener('click', go);
    refresh();
  }

  // ── Оформление заказа ───────────────────────────────────────
  function initCheckout() {
    const form = $('#co-form'), empty = $('#co-empty');
    if (!cart.length) { empty.hidden = false; return; }
    form.hidden = false;
    const alertBox = $('#co-alert'); let last = null, lastStore = null, busy = false;
    const FIELDS = ['name', 'phone', 'email', 'apartment', 'entrance', 'floor', 'intercom', 'courier_comment', 'comment'];
    const saved = store.get('vk_form', {});
    FIELDS.forEach(n => { if (saved[n] && form.elements[n]) form.elements[n].value = saved[n]; });
    loadMe().then(u => { if (u) { if (!form.elements.name.value) form.elements.name.value = u.name || ''; if (!form.elements.phone.value) form.elements.phone.value = u.phone || ''; if (!form.elements.email.value) form.elements.email.value = u.email || ''; } });
    form.addEventListener('input', () => store.set('vk_form', Object.fromEntries(FIELDS.map(n => [n, form.elements[n].value]))));

    const setFul = v => {
      store.set('vk_ful', v); $$('input[name=fulfillment]').forEach(r => { r.checked = r.value === v; });
      $('#co-addr-delivery').hidden = v !== 'delivery'; $('#co-addr-pickup').hidden = v !== 'pickup';
    };
    setFul(ful());
    $$('input[name=fulfillment]').forEach(r => r.addEventListener('change', () => { setFul(r.value); refresh(); }));
    const a = addrState(); $('#co-addr-text').textContent = a ? a.label : 'Адрес не указан';

    // желаемое время (по Москве)
    const mskNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const dt = $('#desired_time'), whenBox = $('#when-box');
    const setWhen = v => { $$('input[name=when]').forEach(r => { r.checked = r.value === v; }); whenBox.hidden = v !== 'later'; if (v === 'later') { const m = new Date(mskNow().getTime() + 60 * 60000); m.setMinutes(Math.ceil(m.getMinutes() / 15) * 15, 0, 0); dt.min = fmtLocal(new Date(mskNow().getTime() + 45 * 60000)); dt.max = fmtLocal(new Date(mskNow().getTime() + 3 * 864e5)); if (!dt.value) dt.value = fmtLocal(m); } };
    $$('input[name=when]').forEach(r => r.addEventListener('change', () => setWhen(r.value)));

    function render(r) {
      const q = r.quote; last = q; lastStore = r.store;
      $('#co-lines').innerHTML = q.lines.map(l => `<li><span>${esc(l.name)}${l.variant_name ? ' — ' + esc(l.variant_name) : ''}${l.options.length ? `<small class="muted"> + ${esc(l.options.map(o => o.name).join(', '))}</small>` : ''} × ${l.qty}</span><span>${l.issue ? 'недоступно' : rub(l.line_kop)}</span></li>`).join('');
      $('#c-sub').textContent = rub(q.subtotal_kop);
      $('#c-disc-row').hidden = !q.discount_kop; if (q.discount_kop) { $('#c-disc').textContent = '−' + rub(q.discount_kop); $('#c-promo').textContent = q.promo?.code ? `(${q.promo.code})` : ''; }
      $('#c-del').textContent = delText(q); $('#c-total').textContent = rub(q.total_kop);
      const msg = blockText(q, r.store) || (q.promo && q.promo.status !== 'applied' ? q.promo.message + ' Вернитесь в корзину, чтобы исправить промокод.' : '');
      const blk = $('#co-block'); blk.hidden = !msg; blk.textContent = msg;
      $('#co-submit').disabled = busy || !!msg;
      if (!r.store.open && r.store.accepting) { // сейчас закрыто — возможен только предзаказ
        const asap = $('input[name=when][value=asap]'); asap.disabled = true; if (asap.checked) setWhen('later');
        $('#when-box').insertAdjacentHTML('beforeend', '');
      }
    }
    async function refresh() {
      try { const r = await fetchQuote(); if (r) render(r); }
      catch (e) { showAlert(e.network ? 'Нет связи с сервером. Проверьте интернет — данные формы сохранены.' : (e.message || 'Не удалось рассчитать заказ')); }
    }
    function showAlert(t) { alertBox.hidden = !t; alertBox.textContent = t || ''; if (t) alertBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    const fieldErr = (n, m) => { const el = $(`[data-err="${n}"]`); if (el) el.textContent = m || ''; const inp = form.elements[n]; if (inp) { if (m) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); } };
    const normPhone = v => { const d = v.replace(/\D/g, ''); const t = d.length === 11 && /^[78]/.test(d) ? d.slice(1) : d.length === 10 ? d : ''; return t ? `+7 ${t.slice(0, 3)} ${t.slice(3, 6)}-${t.slice(6, 8)}-${t.slice(8)}` : null; };
    form.elements.phone.addEventListener('blur', e => { const n = normPhone(e.target.value); if (n) e.target.value = n; });

    // ключ идемпотентности привязан к составу заказа: повтор того же запроса не создаёт дубль
    const idemKey = () => {
      const sig = JSON.stringify([payload().items, ful(), addrState()?.label, promoCode()]);
      let s = null; try { s = JSON.parse(sessionStorage.getItem('vk_idem')); } catch { /* */ }
      if (!s || s.sig !== sig) { s = { sig, key: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)) }; try { sessionStorage.setItem('vk_idem', JSON.stringify(s)); } catch { /* */ } }
      return s.key;
    };

    form.addEventListener('submit', async e => {
      e.preventDefault(); if (busy) return; showAlert('');
      FIELDS.forEach(n => fieldErr(n, '')); fieldErr('consent_pd', ''); fieldErr('payment_method', ''); fieldErr('desired_time', '');
      const errs = {};
      if (form.elements.name.value.trim().length < 2) errs.name = 'Укажите имя';
      if (!normPhone(form.elements.phone.value.trim())) errs.phone = 'Укажите телефон в формате +7 900 000-00-00';
      const em = form.elements.email.value.trim(); if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) errs.email = 'Проверьте адрес электронной почты';
      if (!form.elements.consent_pd.checked) errs.consent_pd = 'Необходимо согласие на обработку персональных данных';
      if (ful() === 'delivery' && !addrState()) { showAlert('Укажите адрес доставки в корзине и выберите его из подсказок.'); return; }
      if (Object.keys(errs).length) { Object.entries(errs).forEach(([k, v]) => fieldErr(k, v)); form.elements[Object.keys(errs)[0]].focus(); return; }
      busy = true; const btn = $('#co-submit'); btn.disabled = true; btn.textContent = 'Оформляем…';
      const body = {
        ...payload(), idempotency_key: idemKey(), expected_total_kop: last?.total_kop,
        name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), email: em,
        apartment: form.elements.apartment.value, entrance: form.elements.entrance.value, floor: form.elements.floor.value, intercom: form.elements.intercom.value,
        courier_comment: form.elements.courier_comment.value, comment: form.elements.comment.value,
        desired_time: $('input[name=when]:checked').value === 'later' ? dt.value : '',
        payment_method: $('input[name=payment_method]:checked')?.value || '',
        consent_pd: true, consent_email: form.elements.consent_email.checked,
      };
      try {
        const r = await api('/api/order', { method: 'POST', body });
        clearCart(); store.del('vk_promo'); try { sessionStorage.removeItem('vk_idem'); } catch { /* */ }
        location.href = `/order/${encodeURIComponent(r.number)}?t=${encodeURIComponent(r.token)}`;
      } catch (err) {
        busy = false; btn.textContent = 'Оформить заказ';
        if (err.network) showAlert('Нет связи с сервером. Заказ мог не дойти — нажмите «Оформить заказ» ещё раз: дубликат не создастся.');
        else if (err.status === 409 && err.data?.quote) { render({ quote: err.data.quote, store: lastStore }); showAlert('Стоимость заказа изменилась. Проверьте итоговую сумму и подтвердите ещё раз.'); }
        else if (err.data?.errors) { Object.entries(err.data.errors).forEach(([k, v]) => k === 'address' ? showAlert(v) : fieldErr(k, v)); const f = Object.keys(err.data.errors).find(k => form.elements[k]); if (f) form.elements[f].focus(); }
        else if (err.data?.field === 'desired_time') { fieldErr('desired_time', err.message); setWhen('later'); }
        else { showAlert(err.message || 'Не удалось оформить заказ. Попробуйте ещё раз.'); if (err.data?.quote) render({ quote: err.data.quote, store: lastStore }); }
        $('#co-submit').disabled = false;
      }
    });
    setWhen('asap'); refresh();
  }

  // ── Личный кабинет ──────────────────────────────────────────
  async function initAccount() {
    const root = $('#account-root'); const user = await loadMe();
    const statusRu = { new: 'Новый', confirmed: 'Подтверждён', cooking: 'Готовится', ready: 'Готов к выдаче', on_courier: 'Передан курьеру', done: 'Выполнен', cancelled: 'Отменён' };
    async function showProfile(u) {
      let orders = []; try { orders = (await api('/api/me/orders')).orders; } catch { /* */ }
      root.innerHTML = `<div class="panel"><p><strong>${esc(u.name || u.email)}</strong><br><span class="muted">${esc(u.email)}</span></p>
        <form id="prof" class="f-set" novalidate><div class="f"><label for="pn">Имя</label><input id="pn" value="${esc(u.name)}" autocomplete="name"></div><div class="f"><label for="pp">Телефон</label><input id="pp" type="tel" inputmode="tel" value="${esc(u.phone)}" autocomplete="tel"></div>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Сохранить</button><button class="btn btn-ghost" type="button" id="out">Выйти</button></div><p class="hint" id="pm" role="status"></p></form></div>
        <h2>Мои заказы</h2><div class="panel">${orders.length ? orders.map(o => `<a class="order-row" href="/order/${esc(o.number)}?t=${esc(o.public_token)}"><span><strong>${esc(o.number)}</strong><br><span class="muted small">${new Date(o.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })} · ${esc(statusRu[o.status] || o.status)}</span></span><strong>${rub(o.total_kop)}</strong></a>`).join('') : '<p class="muted">Заказов пока нет.</p>'}</div>`;
      $('#prof').addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/me', { method: 'PUT', body: { name: $('#pn').value, phone: $('#pp').value } }); $('#pm').className = 'hint good'; $('#pm').textContent = 'Сохранено'; } catch (er) { $('#pm').className = 'hint bad'; $('#pm').textContent = er.message; } });
      $('#out').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); });
    }
    if (user) return showProfile(user);
    let mode = 'login';
    const draw = () => {
      root.innerHTML = `<div class="panel"><div class="seg" role="tablist"><label><input type="radio" name="m" value="login" ${mode === 'login' ? 'checked' : ''}><span>Вход</span></label><label><input type="radio" name="m" value="reg" ${mode === 'reg' ? 'checked' : ''}><span>Регистрация</span></label></div>
        <form id="af" novalidate>
          ${mode === 'reg' ? '<div class="f"><label for="an">Имя</label><input id="an" autocomplete="name" maxlength="80"></div><div class="f"><label for="ap">Телефон <span class="opt">необязательно</span></label><input id="ap" type="tel" inputmode="tel" autocomplete="tel"></div>' : ''}
          <div class="f"><label for="ae">Электронная почта</label><input id="ae" type="email" inputmode="email" autocomplete="email" required></div>
          <div class="f"><label for="aw">Пароль</label><input id="aw" type="password" autocomplete="${mode === 'reg' ? 'new-password' : 'current-password'}" required>${mode === 'reg' ? '<p class="hint">Не короче 10 символов, буквы и цифры.</p>' : ''}</div>
          ${mode === 'reg' ? '<label class="check"><input type="checkbox" id="ac"><span>Даю согласие на обработку персональных данных (<a href="/personal-data" target="_blank">условия</a>)</span></label>' : ''}
          <p class="err" id="ae-err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" type="submit">${mode === 'reg' ? 'Зарегистрироваться' : 'Войти'}</button></form>
        <p class="hint">Личный кабинет необязателен: заказ можно оформить без регистрации.</p></div>`;
      $$('input[name=m]').forEach(r => r.addEventListener('change', () => { mode = r.value; draw(); }));
      $('#af').addEventListener('submit', async e => {
        e.preventDefault(); const er = $('#ae-err'); er.textContent = '';
        try {
          const body = { email: $('#ae').value.trim(), password: $('#aw').value };
          if (mode === 'reg') Object.assign(body, { name: $('#an').value, phone: $('#ap').value, consent_pd: $('#ac').checked });
          await api(mode === 'reg' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body }); location.reload();
        } catch (x) { er.textContent = x.network ? 'Нет связи с сервером' : x.message; }
      });
    };
    draw();
  }

  // ── Плавная прокрутка к якорям (кнопки, категории, ссылки #…) ──
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const glide = el => el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href*="#"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute('data-focus-search')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname !== location.pathname || u.hash.length < 2) return;
    const el = document.getElementById(decodeURIComponent(u.hash.slice(1)));
    if (!el) return;
    e.preventDefault(); glide(el); history.pushState(null, '', u.hash);
    if (drawer && !drawer.hidden) { drawer.hidden = true; document.body.style.overflow = ''; }
  });
  // переход с другой страницы по ссылке с якорем (например «Акции» или категория из главной) — тоже плавно
  if (location.hash.length > 1 && location.hash !== '#search') {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) { window.scrollTo(0, 0); setTimeout(() => glide(el), 250); }
  }

  if (page === 'menu') initMenu();
  if (page === 'dish') initDish();
  if (page === 'cart') initCart();
  if (page === 'checkout') initCheckout();
  if (page === 'account') initAccount();
})();
