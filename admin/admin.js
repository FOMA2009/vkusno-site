/* Панель управления рестораном. Вся логика прав и валидации — на сервере (/api/admin/*). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rub = kop => { const v = kop / 100; return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
  const toKop = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  const fromKop = k => (k / 100).toString().replace('.', ',');
  const dtLocal = iso => { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmtDate = iso => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
  const BASE = document.body.dataset.admin;

  let csrf = null, me = null, labels = {}, flow = {};
  const toast = (msg, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.innerHTML = `<span>${esc(msg)}</span>`; $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000); };
  async function api(path, { method = 'GET', body, form } = {}) {
    const h = {}; if (csrf) h['X-CSRF-Token'] = csrf;
    if (body) h['Content-Type'] = 'application/json';
    let r; try { r = await fetch('/api/admin' + path, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined), credentials: 'same-origin' }); }
    catch { throw Object.assign(new Error('Нет связи с сервером'), { network: true }); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { me = null; renderLogin(); throw Object.assign(new Error('Сессия истекла'), { handled: true }); }
    if (!r.ok) throw Object.assign(new Error(j.message || 'Ошибка ' + r.status), { data: j });
    return j;
  }
  const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { if (!e.handled) toast(e.message, true); } };

  // ── Диалог ───────────────────────────────────────────────────
  function dialog(title, html, { onSave, saveText = 'Сохранить', wide } = {}) {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = `<form class="dlg-in" novalidate><div class="dlg-hd"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-x aria-label="Закрыть"><svg class="ic"><use href="#i-x"/></svg></button></div>${html}
      ${onSave ? `<div class="dlg-ft"><button class="btn btn-ghost" type="button" data-x>Отмена</button><button class="btn btn-primary" type="submit">${saveText}</button></div>` : ''}</form>`;
    document.body.appendChild(d);
    $$('[data-x]', d).forEach(b => b.addEventListener('click', () => d.close()));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    if (onSave) $('form', d).addEventListener('submit', guard(async e => { e.preventDefault(); const btn = $('[type=submit]', d); btn.disabled = true; try { await onSave(d); d.close(); } finally { btn.disabled = false; } }));
    d.showModal(); return d;
  }
  const field = (label, input, extra = '') => `<div class="f"><label>${esc(label)}</label>${input}${extra}</div>`;
  const inp = (name, val = '', attrs = '') => `<input name="${name}" value="${esc(val)}" ${attrs}>`;
  const chk = (name, on, label) => `<label class="sw"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}> ${esc(label)}</label>`;

  // ── Вход ─────────────────────────────────────────────────────
  function renderLogin() {
    $('#app').innerHTML = `<div class="login"><div class="panel"><h1 class="login-h">Вход в панель управления</h1>
      <form id="lf" novalidate><div class="f"><label for="le">Email</label><input id="le" type="email" autocomplete="username" required></div>
      <div class="f"><label for="lp">Пароль</label><input id="lp" type="password" autocomplete="current-password" required></div>
      <p class="err" id="lerr" role="alert"></p><button class="btn btn-primary btn-block btn-lg" type="submit">Войти</button></form></div></div>`;
    $('#lf').addEventListener('submit', async e => {
      e.preventDefault(); $('#lerr').textContent = '';
      try { const r = await api('/login', { method: 'POST', body: { email: $('#le').value.trim(), password: $('#lp').value } }); csrf = r.csrf; await boot(); }
      catch (x) { $('#lerr').textContent = x.message; }
    });
  }

  // ── Каркас ───────────────────────────────────────────────────
  const TABS = [['orders', 'Заказы', ['admin', 'manager']], ['menu', 'Меню', ['admin']], ['prices', 'Цены', ['admin', 'manager']], ['promos', 'Промокоды', ['admin']], ['promotions', 'Акции', ['admin']], ['pages', 'Страницы', ['admin']], ['settings', 'Настройки', ['admin']], ['users', 'Сотрудники', ['admin']]];
  let tab = 'orders', poll = null;
  function shell() {
    const tabs = me.scope === 'prices' ? TABS.filter(t => t[0] === 'prices') : TABS.filter(t => t[2].includes(me.role) && !(t[0] === 'prices' && me.role !== 'admin'));
    if (!tabs.some(t => t[0] === tab)) tab = tabs[0][0];
    $('#app').innerHTML = `<header class="adm-top"><div class="adm-top-in"><h1>Панель управления</h1><span class="muted small">${esc(me.email)}</span><button class="btn btn-ghost btn-xs" id="logout">Выйти</button></div>
      <nav class="adm-nav" aria-label="Разделы">${tabs.map(([k, t]) => `<button class="chip${k === tab ? ' on' : ''}" data-tab="${k}">${t}</button>`).join('')}</nav></header><main class="adm-main" id="view"></main>`;
    $$('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; shell(); }));
    $('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); me = null; csrf = null; renderLogin(); });
    clearInterval(poll);
    ({ orders: viewOrders, menu: viewMenu, prices: viewPrices, promos: viewPromos, promotions: viewPromotions, pages: viewPages, settings: viewSettings, users: viewUsers })[tab]();
  }
  const view = () => $('#view');

  // ── Заказы ───────────────────────────────────────────────────
  function viewOrders() {
    const q = { q: '', status: '', fulfillment: '', sort: 'created', dir: 'desc', page: 1, from: '', to: '' };
    view().innerHTML = `<div class="bar"><input class="grow" id="oq" type="search" placeholder="Поиск: номер, имя, телефон, адрес" aria-label="Поиск заказов">
      <select id="os" aria-label="Статус"><option value="">Все статусы</option>${Object.entries(labels).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="of" aria-label="Способ получения"><option value="">Доставка и самовывоз</option><option value="delivery">Доставка</option><option value="pickup">Самовывоз</option></select>
      <select id="osort" aria-label="Сортировка"><option value="created:desc">Сначала новые</option><option value="created:asc">Сначала старые</option><option value="total:desc">Сумма ↓</option><option value="total:asc">Сумма ↑</option></select>
      <input id="ofrom" type="date" aria-label="С даты"><input id="oto" type="date" aria-label="По дату"></div>
      <div id="olist"></div><div class="bar" id="opager"></div>`;
    let timer;
    const load = guard(async (quiet) => {
      const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '')); const r = await api('/orders?' + p);
      $('#olist').innerHTML = r.orders.length ? `<table class="tbl resp"><thead><tr><th>Заказ</th><th>Создан (МСК)</th><th>Клиент</th><th>Получение</th><th>Статус</th><th class="num">Сумма</th></tr></thead><tbody>${r.orders.map(o => `<tr data-open="${o.id}" tabindex="0">
        <td data-l="Заказ"><strong>${esc(o.number)}</strong></td><td data-l="Создан">${fmtDate(o.created_at)}</td><td data-l="Клиент">${esc(o.customer_name)}<br><span class="muted small">${esc(o.phone)}</span></td>
        <td data-l="Получение">${o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'}${o.address ? `<br><span class="muted small">${esc(o.address)}</span>` : ''}</td><td data-l="Статус"><span class="pill ${o.status}">${esc(labels[o.status])}</span></td><td class="num" data-l="Сумма"><strong>${rub(o.total_kop)}</strong></td></tr>`).join('')}</tbody></table>` : '<p class="muted center">Заказов не найдено</p>';
      const pages = Math.ceil(r.total / r.per);
      $('#opager').innerHTML = `<span class="muted">Всего: ${r.total}</span>${pages > 1 ? `<button class="btn btn-ghost btn-xs" data-pg="-1" ${r.page <= 1 ? 'disabled' : ''}>Назад</button><span>${r.page} / ${pages}</span><button class="btn btn-ghost btn-xs" data-pg="1" ${r.page >= pages ? 'disabled' : ''}>Вперёд</button>` : ''}`;
      if (quiet) return;
    });
    const reload = () => { q.page = 1; load(); };
    $('#oq').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q.q = $('#oq').value.trim(); reload(); }, 300); });
    $('#os').addEventListener('change', e => { q.status = e.target.value; reload(); }); $('#of').addEventListener('change', e => { q.fulfillment = e.target.value; reload(); });
    $('#osort').addEventListener('change', e => { [q.sort, q.dir] = e.target.value.split(':'); reload(); });
    $('#ofrom').addEventListener('change', e => { q.from = e.target.value; reload(); }); $('#oto').addEventListener('change', e => { q.to = e.target.value; reload(); });
    view().addEventListener('click', e => { const pg = e.target.closest('[data-pg]'); if (pg) { q.page += Number(pg.dataset.pg); load(); } const tr = e.target.closest('[data-open]'); if (tr) openOrder(Number(tr.dataset.open), load); });
    view().addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('[data-open]'); if (tr) openOrder(Number(tr.dataset.open), load); } });
    load(); poll = setInterval(() => { if (!document.querySelector('dialog[open]')) load(true); }, 30000);
  }
  const guardOpen = guard(async (id, after) => {
    const r = await api('/orders/' + id), o = r.order;
    const d = dialog(`Заказ ${o.number}`, `
      <div class="g2"><div><h3>Клиент</h3><dl class="kv"><div><dt>Имя</dt><dd>${esc(o.customer_name)}</dd></div><div><dt>Телефон</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></dd></div><div><dt>Email</dt><dd>${esc(o.email) || '—'}</dd></div><div><dt>Создан</dt><dd>${fmtDate(o.created_at)}</dd></div>
        ${o.desired_time ? `<div><dt>Желаемое время</dt><dd>${esc(o.desired_time)}</dd></div>` : ''}</dl></div>
      <div><h3>${o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'}</h3><dl class="kv">${o.fulfillment === 'delivery' ? `<div><dt>Адрес</dt><dd>${esc(o.address)}</dd></div><div><dt>Кв / подъезд / этаж / домофон</dt><dd>${[o.apartment, o.entrance, o.floor, o.intercom].map(x => esc(x) || '—').join(' / ')}</dd></div><div><dt>Зона</dt><dd>${{ district: 'Автозаводский район (бесплатно)', radius: 'В радиусе (бесплатно)', paid: 'Платная зона' }[o.delivery_zone] || '—'}${o.distance_km != null ? `, ${o.distance_km} км` : ''}</dd></div>` : ''}
        <div><dt>Оплата</dt><dd>${esc(o.payment_method === 'on_receipt' ? 'при получении' : o.payment_method || '—')} · ${esc({ unpaid: 'не оплачен', pending: 'ожидает', paid: 'оплачен', failed: 'ошибка', refunded: 'возврат' }[o.payment_status] || o.payment_status)}</dd></div></dl></div></div>
      ${o.courier_comment ? `<p><strong>Комментарий курьеру:</strong> ${esc(o.courier_comment)}</p>` : ''}${o.comment ? `<p><strong>Комментарий к заказу:</strong> ${esc(o.comment)}</p>` : ''}
      <h3>Состав</h3><ul class="mini">${r.items.map(i => `<li><span>${esc(i.name)}${i.variant_name ? ' — ' + esc(i.variant_name) : ''}${i.options.length ? ` <small class="muted">+ ${esc(i.options.map(x => x.name).join(', '))}</small>` : ''} × ${i.qty} (${rub(i.unit_price_kop)})</span><span>${rub(i.line_total_kop)}</span></li>`).join('')}</ul>
      <dl class="sum-dl"><div><dt>Сумма блюд</dt><dd>${rub(o.subtotal_kop)}</dd></div>${o.discount_kop ? `<div><dt>Скидка ${esc(o.promo_code)}</dt><dd>−${rub(o.discount_kop)}</dd></div>` : ''}<div><dt>Доставка</dt><dd>${o.delivery_fee_kop ? rub(o.delivery_fee_kop) : 'бесплатно'}</dd></div><div class="total"><dt>Итого</dt><dd>${rub(o.total_kop)}</dd></div></dl>
      <h3>Статус</h3><div class="g2 gap-sm"><div class="f"><label>Новый статус</label><select name="status">${r.allowed_statuses.map(s => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${esc(labels[s])}</option>`).join('')}</select></div>
        <div class="f"><label>Комментарий <span class="opt">необязательно</span></label><input name="note" maxlength="300"></div></div>
      <h3>История</h3><ul class="hist">${r.history.map(h => `<li>${fmtDate(h.created_at)} — <strong>${esc(labels[h.status])}</strong>${h.note ? ` · ${esc(h.note)}` : ''}${h.by_email ? ` <span class="muted">(${esc(h.by_email)})</span>` : ''}</li>`).join('')}</ul>`,
      { saveText: 'Сменить статус', wide: true, onSave: async dd => { const f = $('form', dd); await api(`/orders/${id}/status`, { method: 'POST', body: { status: f.status.value, note: f.note.value } }); toast('Статус сохранён'); after && after(); } });
  });
  const openOrder = guardOpen;

  // ── Меню ─────────────────────────────────────────────────────
  async function viewMenu() {
    const render = guard(async () => {
      const [{ categories }, { products }] = await Promise.all([api('/categories'), api('/products')]);
      view().innerHTML = `<div class="note">Изменения сразу отображаются на сайте. Блюда без цены скрыты — задайте цену и включите «Показывать».</div>
        <div class="bar"><button class="btn btn-primary" id="addcat">Новая категория</button><button class="btn btn-primary" id="addprod">Новое блюдо</button><input class="grow" id="pf" type="search" placeholder="Поиск по блюдам" aria-label="Поиск по блюдам"></div>
        ${categories.map((c, ci) => { const list = products.filter(p => p.category_id === c.id); return `<section data-cat="${c.id}"><div class="group-h"><h2 class="cat-h">${esc(c.name)} <span class="muted small">${list.length}${c.is_active ? '' : ' · скрыта'}</span></h2>
          <div class="row-actions"><button class="btn btn-ghost btn-xs" data-cmove="${c.id}:-1" ${ci === 0 ? 'disabled' : ''} aria-label="Поднять категорию">↑</button><button class="btn btn-ghost btn-xs" data-cmove="${c.id}:1" ${ci === categories.length - 1 ? 'disabled' : ''} aria-label="Опустить категорию">↓</button><button class="btn btn-ghost btn-xs" data-cedit="${c.id}">Изменить</button></div></div>
          ${list.map((p, pi) => `<div class="item-row${p.is_active ? '' : ' off'}" data-name="${esc(p.name.toLowerCase())}"><div><div class="nm">${esc(p.name)}</div><div class="sub">${p.price_kop ? rub(p.price_kop) : 'цена не задана'}${p.is_active ? '' : ' · скрыто'}${p.in_stock ? '' : ' · нет в наличии'}</div></div>
            <div class="row-actions"><label class="sw"><input type="checkbox" data-tg="is_active:${p.id}" ${p.is_active ? 'checked' : ''}> Показывать</label><label class="sw"><input type="checkbox" data-tg="in_stock:${p.id}" ${p.in_stock ? 'checked' : ''}> В наличии</label><label class="sw"><input type="checkbox" data-tg="is_popular:${p.id}" ${p.is_popular ? 'checked' : ''}> Хит</label></div>
            <div class="row-actions"><button class="btn btn-ghost btn-xs" data-pmove="${c.id}:${p.id}:-1" ${pi === 0 ? 'disabled' : ''} aria-label="Поднять">↑</button><button class="btn btn-ghost btn-xs" data-pmove="${c.id}:${p.id}:1" ${pi === list.length - 1 ? 'disabled' : ''} aria-label="Опустить">↓</button><button class="btn btn-ghost btn-xs" data-pedit="${p.id}">Изменить</button></div></div>`).join('')}</section>`; }).join('')}`;
      const cats = categories;
      $('#addcat').onclick = () => editCategory(null, render); $('#addprod').onclick = () => editProduct(null, cats, render);
      $('#pf').oninput = e => { const q = e.target.value.toLowerCase(); $$('.item-row').forEach(r => { r.hidden = q && !r.dataset.name.includes(q); }); };
      view().onclick = guard(async e => {
        const g = (a) => e.target.closest(`[${a}]`);
        let t;
        if ((t = g('data-cedit'))) editCategory(cats.find(c => c.id === Number(t.dataset.cedit)), render);
        else if ((t = g('data-pedit'))) editProduct(Number(t.dataset.pedit), cats, render);
        else if ((t = g('data-cmove'))) { const [id, d] = t.dataset.cmove.split(':').map(Number); const ids = cats.map(c => c.id), i = ids.indexOf(id); ids.splice(i + d, 0, ids.splice(i, 1)[0]); await api('/categories/reorder', { method: 'POST', body: { ids } }); render(); }
        else if ((t = g('data-pmove'))) { const [cid, id, d] = t.dataset.pmove.split(':').map(Number); const ids = products.filter(p => p.category_id === cid).map(p => p.id), i = ids.indexOf(id); ids.splice(i + d, 0, ids.splice(i, 1)[0]); await api('/products/reorder', { method: 'POST', body: { ids } }); render(); }
      });
      view().onchange = guard(async e => { const t = e.target.closest('[data-tg]'); if (!t) return; const [k, id] = t.dataset.tg.split(':'); try { await api('/products/' + id, { method: 'PATCH', body: { [k]: t.checked } }); toast('Сохранено'); } catch (x) { t.checked = !t.checked; throw x; } render(); });
    }); render();
  }
  function editCategory(c, done) {
    const d = dialog(c ? 'Категория' : 'Новая категория', `${field('Название', inp('name', c?.name, 'required maxlength="80"'))}${field('Описание', inp('description', c?.description, 'maxlength="300"'))}${chk('is_active', c ? c.is_active : true, 'Показывать на сайте')}
      ${c ? '<div class="bar mt14"><button class="btn btn-danger btn-xs" type="button" data-del>Удалить категорию</button></div>' : ''}`,
      { onSave: async dd => { const f = $('form', dd); await api('/categories', { method: 'POST', body: { id: c?.id, name: f.name.value, description: f.description.value, is_active: f.is_active.checked, sort: c?.sort } }); toast('Сохранено'); done(); } });
    const del = $('[data-del]', d); if (del) del.onclick = guard(async () => { if (!confirm('Удалить категорию?')) return; await api('/categories/' + c.id, { method: 'DELETE' }); d.close(); toast('Удалено'); done(); });
  }
  const guardEditProduct = guard(async (id, cats, done) => {
    const full = id ? await api('/products/' + id) : { product: { category_id: cats[0]?.id, is_active: 1, in_stock: 1, price_kop: 0, image: '' }, variants: [], options: [] };
    const p = full.product; let image = p.image;
    const vRow = v => `<div class="sub-row v" data-v="${v.id || ''}"><input placeholder="Название (например, 200 г)" value="${esc(v.name)}" maxlength="80" aria-label="Название варианта"><input placeholder="Цена, ₽" inputmode="decimal" value="${v.price_kop != null ? fromKop(v.price_kop) : ''}" aria-label="Цена варианта"><label class="sw"><input type="checkbox" ${v.in_stock === 0 ? '' : 'checked'}> есть</label><button class="btn btn-danger btn-xs" type="button" data-rm aria-label="Удалить вариант">×</button></div>`;
    const oRow = o => `<div class="sub-row" data-o="${o.id || ''}"><input placeholder="Название добавки" value="${esc(o.name)}" maxlength="80" aria-label="Название добавки"><input placeholder="Цена, ₽" inputmode="decimal" value="${o.price_kop != null ? fromKop(o.price_kop) : ''}" aria-label="Цена добавки"><button class="btn btn-danger btn-xs" type="button" data-rm aria-label="Удалить добавку">×</button></div>`;
    const d = dialog(id ? 'Изменить блюдо' : 'Новое блюдо', `
      ${field('Название', inp('name', p.name, 'required maxlength="120"'))}
      <div class="g2">${field('Категория', `<select name="category_id">${cats.map(c => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`)}
      ${field('Цена, ₽ (если нет вариантов)', inp('price', p.price_kop ? fromKop(p.price_kop) : '', 'inputmode="decimal"'))}</div>
      ${field('Описание', `<textarea name="description" rows="2" maxlength="600">${esc(p.description)}</textarea>`)}
      ${field('Вес / объём / порция', inp('weight_label', p.weight_label, 'maxlength="60" placeholder="например: 250 г или 6 шт"'))}
      <div class="f"><label>Фото</label><div class="up-row"><img class="thumb" id="pimg" alt="" ${image ? `src="${esc(image)}"` : 'hidden'}><input type="file" id="pfile" accept="image/jpeg,image/png,image/webp" aria-label="Загрузить фото"><button class="btn btn-ghost btn-xs" type="button" id="pimg-rm" ${image ? '' : 'hidden'}>Убрать фото</button></div><p class="hint">JPG, PNG или WebP до 10 МБ — сайт сам уменьшит и оптимизирует.</p></div>
      <div class="bar">${chk('is_active', p.is_active, 'Показывать в каталоге')}${chk('in_stock', p.in_stock, 'В наличии')}${chk('is_popular', p.is_popular, 'Популярное')}${chk('is_new', p.is_new, 'Новинка')}</div>
      <h3>Варианты (вес, размер, комплектация)</h3><p class="hint">Если заданы варианты, клиент выбирает один из них, а цена берётся из варианта.</p><div class="sub-rows" id="vars">${full.variants.map(vRow).join('')}</div><button class="btn btn-ghost btn-xs" type="button" id="addv">+ Вариант</button>
      <h3 class="mt18">Дополнительные опции (добавки)</h3><div class="sub-rows" id="opts">${full.options.map(oRow).join('')}</div><button class="btn btn-ghost btn-xs" type="button" id="addo">+ Опция</button>
      ${id ? '<div class="bar mt18"><button class="btn btn-danger btn-xs" type="button" data-del>Удалить блюдо</button></div>' : ''}`,
      { onSave: async dd => {
        const f = $('form', dd);
        const variants = $$('#vars .sub-row', dd).map(r => { const i = $$('input', r); return { id: r.dataset.v || undefined, name: i[0].value, price_kop: toKop(i[1].value), in_stock: i[2].checked }; });
        const options = $$('#opts .sub-row', dd).map(r => { const i = $$('input', r); return { id: r.dataset.o || undefined, name: i[0].value, price_kop: toKop(i[1].value) }; });
        await api('/products', { method: 'POST', body: { id: id || undefined, name: f.name.value, category_id: f.category_id.value, description: f.description.value, weight_label: f.weight_label.value, price_kop: toKop(f.price.value), image, is_active: f.is_active.checked, in_stock: f.in_stock.checked, is_popular: f.is_popular.checked, is_new: f.is_new.checked, variants, options, sort: p.sort } });
        toast('Сохранено'); done();
      } });
    d.addEventListener('click', e => { if (e.target.closest('[data-rm]')) e.target.closest('.sub-row').remove(); });
    $('#addv', d).onclick = () => $('#vars', d).insertAdjacentHTML('beforeend', vRow({ name: '' })); $('#addo', d).onclick = () => $('#opts', d).insertAdjacentHTML('beforeend', oRow({ name: '' }));
    $('#pfile', d).onchange = guard(async e => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); const r = await api('/upload', { method: 'POST', form: fd }); image = r.url; $('#pimg', d).src = image; $('#pimg', d).hidden = false; $('#pimg-rm', d).hidden = false; toast('Фото загружено — нажмите «Сохранить»'); });
    $('#pimg-rm', d).onclick = () => { image = ''; $('#pimg', d).hidden = true; $('#pimg-rm', d).hidden = true; };
    const del = $('[data-del]', d); if (del) del.onclick = guard(async () => { if (!confirm('Удалить блюдо? Оформленные заказы сохранятся.')) return; await api('/products/' + id, { method: 'DELETE' }); d.close(); toast('Удалено'); done(); });
  });
  const editProduct = guardEditProduct;

  // ── Цены ─────────────────────────────────────────────────────
  async function viewPrices() {
    const { products } = await api('/prices').catch(e => { toast(e.message, true); return { products: [] }; });
    view().innerHTML = `<div class="note">Здесь меняются только цены. Изменения сразу видны на сайте, все правки записываются в журнал. Цены указаны в рублях.</div>
      <div class="bar"><input class="grow" id="prq" type="search" placeholder="Найти блюдо" aria-label="Найти блюдо"></div><div id="prl"></div><div id="prlog"></div>`;
    const priceInput = (key, label, kop) => `<label class="pr-row"><span>${esc(label)}</span><input data-k="${key}" data-o="${kop}" inputmode="decimal" value="${fromKop(kop)}" aria-label="${esc(label)}, цена в рублях"></label>`;
    let cat = '';
    $('#prl').innerHTML = products.map(p => {
      const head = p.category_name !== cat ? `<h2 class="pr-cat">${esc(cat = p.category_name)}</h2>` : '';
      return `${head}<section class="pr-item${p.is_active ? '' : ' off'}" data-id="${p.id}" data-name="${esc(p.name.toLowerCase())}">
        <div class="pr-h"><strong>${esc(p.name)}</strong>${p.is_active ? '' : '<span class="muted small">скрыто на сайте</span>'}</div>
        ${p.variants.length ? p.variants.map(v => priceInput('v:' + v.id, v.name, v.price_kop)).join('') : priceInput('base', 'Цена', p.price_kop)}
        ${p.options.map(o => priceInput('o:' + o.id, 'Добавка: ' + o.name, o.price_kop)).join('')}
        <div class="pr-act"><span class="muted small" data-msg></span><button class="btn btn-primary btn-xs" type="button" data-save disabled>Сохранить</button></div></section>`;
    }).join('') || '<p class="muted">Блюд нет.</p>';
    $('#prq').oninput = e => { const q = e.target.value.toLowerCase(); $$('.pr-item').forEach(i => { i.hidden = q && !i.dataset.name.includes(q); }); };
    const changed = it => $$('input[data-k]', it).some(i => toKop(i.value) !== Number(i.dataset.o));
    $('#prl').addEventListener('input', e => { const it = e.target.closest('.pr-item'); if (it) { $('[data-save]', it).disabled = !changed(it); $('[data-msg]', it).textContent = ''; } });
    $('#prl').addEventListener('click', guard(async e => {
      const btn = e.target.closest('[data-save]'); if (!btn) return;
      const it = btn.closest('.pr-item'), body = { variants: [], options: [] };
      for (const i of $$('input[data-k]', it)) {
        const k = i.dataset.k, v = toKop(i.value);
        if (k === 'base') body.price_kop = v; else if (k[0] === 'v') body.variants.push({ id: k.slice(2), price_kop: v }); else body.options.push({ id: k.slice(2), price_kop: v });
      }
      btn.disabled = true;
      try { await api('/prices/' + it.dataset.id, { method: 'PUT', body }); $$('input[data-k]', it).forEach(i => { i.dataset.o = toKop(i.value); i.value = fromKop(toKop(i.value)); }); $('[data-msg]', it).textContent = 'Сохранено'; toast('Цена сохранена'); }
      catch (x) { btn.disabled = false; throw x; }
    }));
    if (me.role === 'admin') {
      const { log } = await api('/price-log').catch(() => ({ log: [] }));
      $('#prlog').innerHTML = `<h2 class="pr-cat">Журнал изменений цен</h2>${log.length ? `<ul class="hist">${log.map(l => `<li>${fmtDate(l.created_at)} — <strong>${esc(l.product_name)}</strong> (${esc(l.what)}): ${rub(l.old_kop)} → <strong>${rub(l.new_kop)}</strong> <span class="muted">${esc(l.by_email || '')}</span></li>`).join('')}</ul>` : '<p class="muted">Пока без изменений.</p>'}`;
    }
  }

  // ── Промокоды ────────────────────────────────────────────────
  async function viewPromos() {
    const render = guard(async () => {
      const [{ promos }, { categories }, { products }] = await Promise.all([api('/promos'), api('/categories'), api('/products')]);
      view().innerHTML = `<div class="bar"><button class="btn btn-primary" id="np">Новый промокод</button></div>${promos.length ? `<table class="tbl resp"><thead><tr><th>Код</th><th>Скидка</th><th>Условия</th><th>Использован</th><th>Статус</th><th></th></tr></thead><tbody>${promos.map(p => `<tr><td data-l="Код"><strong>${esc(p.code)}</strong><br><span class="muted small">${esc(p.description)}</span></td><td data-l="Скидка">${p.type === 'percent' ? p.value + ' %' : rub(p.value)}</td>
        <td data-l="Условия" class="small">${p.min_order_kop ? 'от ' + rub(p.min_order_kop) + '<br>' : ''}${p.starts_at ? 'с ' + fmtDate(p.starts_at) + '<br>' : ''}${p.expires_at ? 'до ' + fmtDate(p.expires_at) + '<br>' : ''}${p.category_ids.length || p.product_ids.length ? 'ограничен по меню' : ''}</td>
        <td data-l="Использован">${p.used_count}${p.max_uses != null ? ' / ' + p.max_uses : ''}</td><td data-l="Статус"><span class="pill ${p.is_active ? 'done' : ''}">${p.is_active ? 'Активен' : 'Выключен'}</span></td><td><button class="btn btn-ghost btn-xs" data-pe="${p.id}">Изменить</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Промокодов пока нет.</p>'}`;
      $('#np').onclick = () => editPromo(null, categories, products, render);
      $$('[data-pe]').forEach(b => b.onclick = () => editPromo(promos.find(p => p.id === Number(b.dataset.pe)), categories, products, render));
    }); render();
  }
  function editPromo(p, cats, prods, done) {
    const sel = (name, list, chosen) => `<select name="${name}" multiple size="5" aria-label="${name}">${list.map(x => `<option value="${x.id}" ${chosen.includes(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    const d = dialog(p ? 'Промокод' : 'Новый промокод', `
      <div class="g2">${field('Код', inp('code', p?.code, 'required maxlength="40" autocapitalize="characters"'))}${field('Описание (для себя)', inp('description', p?.description, 'maxlength="200"'))}
      ${field('Тип скидки', `<select name="type"><option value="percent" ${p?.type !== 'fixed' ? 'selected' : ''}>Процент</option><option value="fixed" ${p?.type === 'fixed' ? 'selected' : ''}>Сумма в рублях</option></select>`)}
      ${field('Размер (% или ₽)', inp('value', p ? (p.type === 'fixed' ? fromKop(p.value) : p.value) : '', 'inputmode="decimal" required'))}
      ${field('Минимальная сумма заказа, ₽', inp('min', p?.min_order_kop ? fromKop(p.min_order_kop) : '', 'inputmode="decimal"'))}${field('Лимит использований', inp('max_uses', p?.max_uses ?? '', 'inputmode="numeric" placeholder="без ограничений"'))}
      ${field('Действует с', inp('starts_at', dtLocal(p?.starts_at), 'type="datetime-local"'))}${field('Действует до', inp('expires_at', dtLocal(p?.expires_at), 'type="datetime-local"'))}</div>
      <p class="hint">Ограничения по меню (необязательно). Если выбрано — скидка применяется только к этим категориям/блюдам. Ctrl/Cmd — выбрать несколько.</p>
      <div class="g2">${field('Категории', sel('category_ids', cats, p?.category_ids || []))}${field('Блюда', sel('product_ids', prods, p?.product_ids || []))}</div>
      ${chk('is_active', p ? p.is_active : true, 'Промокод активен')}
      ${p ? '<div class="bar mt14"><button class="btn btn-danger btn-xs" type="button" data-del>Удалить</button></div>' : ''}`,
      { onSave: async dd => {
        const f = $('form', dd), type = f.type.value, raw = f.value.value;
        const v = type === 'fixed' ? toKop(raw) : parseInt(raw, 10);
        await api('/promos', { method: 'POST', body: { id: p?.id, code: f.code.value, description: f.description.value, type, value: v, min_order_kop: toKop(f.min.value), max_uses: f.max_uses.value === '' ? null : f.max_uses.value, starts_at: f.starts_at.value || null, expires_at: f.expires_at.value || null, is_active: f.is_active.checked,
          category_ids: [...f.category_ids.selectedOptions].map(o => o.value), product_ids: [...f.product_ids.selectedOptions].map(o => o.value) } });
        toast('Сохранено'); done();
      } });
    const del = $('[data-del]', d); if (del) del.onclick = guard(async () => { if (!confirm('Удалить промокод?')) return; await api('/promos/' + p.id, { method: 'DELETE' }); d.close(); done(); });
  }

  // ── Акции ────────────────────────────────────────────────────
  async function viewPromotions() {
    const render = guard(async () => {
      const { promotions } = await api('/promotions');
      view().innerHTML = `<div class="bar"><button class="btn btn-primary" id="na">Новая акция</button></div>${promotions.map(a => `<div class="item-row${a.is_active ? '' : ' off'}"><div><div class="nm">${esc(a.title)}</div><div class="sub">${esc(a.text)}</div></div><div class="row-actions"><button class="btn btn-ghost btn-xs" data-ae="${a.id}">Изменить</button></div></div>`).join('') || '<p class="muted">Акций пока нет.</p>'}`;
      $('#na').onclick = () => editPromotion(null, render); $$('[data-ae]').forEach(b => b.onclick = () => editPromotion(promotions.find(a => a.id === Number(b.dataset.ae)), render));
    }); render();
  }
  function editPromotion(a, done) {
    let image = a?.image || '';
    const d = dialog(a ? 'Акция' : 'Новая акция', `${field('Заголовок', inp('title', a?.title, 'required maxlength="100"'))}${field('Текст', `<textarea name="text" rows="3" maxlength="400">${esc(a?.text)}</textarea>`)}${field('Ссылка (необязательно)', inp('link', a?.link, 'maxlength="200" placeholder="/menu/sets"'))}
      <div class="f"><label>Картинка (необязательно)</label><div class="up-row"><img class="thumb" id="aimg" alt="" ${image ? `src="${esc(image)}"` : 'hidden'}><input type="file" id="afile" accept="image/jpeg,image/png,image/webp" aria-label="Загрузить картинку"></div></div>
      ${field('Порядок (меньше — выше)', inp('sort', a?.sort ?? 0, 'inputmode="numeric"'))}${chk('is_active', a ? a.is_active : true, 'Показывать на главной')}${a ? '<div class="bar mt14"><button class="btn btn-danger btn-xs" type="button" data-del>Удалить</button></div>' : ''}`,
      { onSave: async dd => { const f = $('form', dd); await api('/promotions', { method: 'POST', body: { id: a?.id, title: f.title.value, text: f.text.value, link: f.link.value, image, sort: f.sort.value, is_active: f.is_active.checked } }); toast('Сохранено'); done(); } });
    $('#afile', d).onchange = guard(async e => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); image = (await api('/upload', { method: 'POST', form: fd })).url; $('#aimg', d).src = image; $('#aimg', d).hidden = false; });
    const del = $('[data-del]', d); if (del) del.onclick = guard(async () => { if (!confirm('Удалить акцию?')) return; await api('/promotions/' + a.id, { method: 'DELETE' }); d.close(); done(); });
  }

  // ── Страницы ─────────────────────────────────────────────────
  async function viewPages() {
    const { pages } = await api('/pages').catch(e => { toast(e.message, true); return { pages: [] }; });
    view().innerHTML = `<p class="hint">Тексты юридических страниц — шаблоны-черновики. Поля <code>[…]</code> замените реальными данными, а текст перед запуском покажите юристу. Подстановки: {{name}} {{address}} {{phone}} {{hours_html}} {{min}} {{fee}} {{threshold}} {{radius}}.</p>
      <div class="bar"><select id="pg" aria-label="Страница">${pages.map(p => `<option value="${p.slug}">${esc(p.title)} (/${p.slug})</option>`).join('')}</select></div><form id="pf" novalidate>${field('Заголовок', '<input name="title" maxlength="150">')}${field('Текст (HTML)', '<textarea name="body" rows="18"></textarea>')}<button class="btn btn-primary" type="submit">Сохранить страницу</button></form>`;
    const load = () => { const p = pages.find(x => x.slug === $('#pg').value); $('#pf').title.value = p.title; $('#pf').body.value = p.body; };
    $('#pg').onchange = load; if (pages.length) load();
    $('#pf').onsubmit = guard(async e => { e.preventDefault(); const slug = $('#pg').value; await api('/pages/' + slug, { method: 'PUT', body: { title: e.target.title.value, body: e.target.body.value } }); const p = pages.find(x => x.slug === slug); p.title = e.target.title.value; p.body = e.target.body.value; toast('Страница сохранена'); });
  }

  // ── Настройки ────────────────────────────────────────────────
  const DAYS = [[1, 'Понедельник'], [2, 'Вторник'], [3, 'Среда'], [4, 'Четверг'], [5, 'Пятница'], [6, 'Суббота'], [0, 'Воскресенье']];
  async function viewSettings() {
    const r = await api('/settings').catch(e => { toast(e.message, true); return null; }); if (!r) return;
    const s = r.settings;
    view().innerHTML = `<form id="sf" novalidate>
      <section class="sect panel"><h2>Заведение</h2><div class="g2">${field('Название', inp('site.name', s['site.name']))}${field('Слоган', inp('site.tagline', s['site.tagline']))}${field('Телефон', inp('contact.phone', s['contact.phone'], 'type="tel"'))}${field('Email для связи', inp('contact.email', s['contact.email'], 'type="email"'))}
        ${field('Адрес ресторана', inp('contact.address', s['contact.address']))}${field('Ссылка на Яндекс.Карты', inp('contact.map_url', s['contact.map_url'], 'type="url"'))}${field('Ссылка «Оставить отзыв» (Яндекс.Карты)', inp('contact.reviews_url', s['contact.reviews_url'], 'type="url"'))}${field('Широта (откуда считается расстояние)', inp('contact.lat', s['contact.lat'], 'inputmode="decimal"'))}${field('Долгота', inp('contact.lon', s['contact.lon'], 'inputmode="decimal"'))}</div>
        ${field('Описание для поисковиков', `<textarea name="site.description" rows="2">${esc(s['site.description'])}</textarea>`)}<p class="hint">Логотип и фото главной находятся в папке <code>public/img</code>. Заменить их можно, подменив файлы и выполнив <code>node scripts/build-images.js</code>.</p></section>
      <section class="sect panel"><h2>Время работы (по Москве)</h2><p class="hint">Если время закрытия меньше времени открытия (например, 10:00–02:00), закрытие приходится на следующую ночь. Пустое время открытия — выходной.</p>
        ${DAYS.map(([d, n]) => { const x = s['hours.schedule'].find(y => y.day === d); return `<div class="sw-row" data-day="${d}"><span>${n}</span><span><input type="time" aria-label="${n}: открытие" value="${x ? x.open : ''}"> <input type="time" aria-label="${n}: закрытие" value="${x ? x.close : ''}"></span></div>`; }).join('')}</section>
      <section class="sect panel"><h2>Приём заказов и доставка</h2>${chk('orders.accepting', s['orders.accepting'], 'Принимаем заказы (снимите галочку, чтобы временно закрыть приём)')}<br>${chk('delivery.enabled', s['delivery.enabled'], 'Доставка включена (снимите, чтобы временно отключить — останется самовывоз)')}
        ${field('Сообщение при закрытии приёма', inp('orders.closed_message', s['orders.closed_message']))}
        <div class="g2">${field('Минимальная сумма доставки, ₽', inp('delivery.min_order_kop', fromKop(s['delivery.min_order_kop']), 'inputmode="decimal"'))}${field('Стоимость доставки, ₽', inp('delivery.fee_kop', fromKop(s['delivery.fee_kop']), 'inputmode="decimal"'))}
        ${field('Порог бесплатной доставки, ₽', inp('delivery.free_threshold_kop', fromKop(s['delivery.free_threshold_kop']), 'inputmode="decimal"'))}${field('Радиус бесплатной доставки, км', inp('delivery.free_radius_km', s['delivery.free_radius_km'], 'inputmode="decimal"'))}
        ${field('Предзаказ: не раньше чем через, минут', inp('orders.min_lead_minutes', s['orders.min_lead_minutes'], 'inputmode="numeric"'))}</div>
        <h3>Районы с бесплатной доставкой</h3>${s['delivery.districts'].map(dd => `<div class="bar"><label class="sw"><input type="checkbox" data-dist="${esc(dd.id)}" ${s['delivery.free_districts'].includes(dd.id) ? 'checked' : ''}> ${esc(dd.name)}</label>${dd.id !== 'autozavodsky' ? `<button class="btn btn-danger btn-xs" type="button" data-rmdist="${esc(dd.id)}">Удалить</button>` : ''}</div>`).join('')}
        <button class="btn btn-ghost btn-xs" type="button" id="adddist">+ Добавить район (GeoJSON)</button></section>
      <section class="sect panel"><h2>Почта</h2><div class="${r.mail.enabled && r.mail.configured ? 'note' : 'alert'}">${r.mail.configured ? (r.mail.enabled ? 'SMTP настроен. Отправьте тестовое письмо, чтобы убедиться, что оно доходит.' : 'SMTP настроен, но отправка выключена галочкой ниже.') : 'Почта НЕ работает: не заданы ' + esc(r.mail.missing.join(', ')) + '. Параметры SMTP задаются в файле .env на сервере (пароль в админке не хранится).'}</div>
        ${chk('mail.enabled', s['mail.enabled'], 'Отправлять письма')}<br>${chk('mail.notify_status_change', s['mail.notify_status_change'], 'Уведомлять клиента о смене статуса (если дал согласие и указал email)')}
        <div class="g2">${field('Адрес отправителя', inp('mail.from', s['mail.from'], 'placeholder="В\'кусно <orders@ваш-домен.ru>"'))}${field('Куда присылать новые заказы', inp('mail.admin_to', s['mail.admin_to'], 'type="email"'))}</div>
        <div class="bar"><button class="btn btn-ghost btn-xs" type="button" id="mtest">Отправить тестовое письмо</button><button class="btn btn-ghost btn-xs" type="button" id="mlog">Журнал отправки</button></div></section>
      <section class="sect panel"><h2>Оплата</h2><div class="note">Онлайн-оплата не подключена: ${r.env.providers.length ? 'выберите провайдера и включите.' : 'в коде нет зарегистрированных платёжных провайдеров (см. <code>server/lib/payments.js</code>). Заказы оформляются без онлайн-платежа.'}</div>
        <h3>Способы оплаты, которые вы принимаете</h3><div id="pm">${s['payments.methods'].map(m => `<div class="sub-row" data-pm="${esc(m.code)}"><input value="${esc(m.title)}" aria-label="Название способа оплаты" maxlength="60"><label class="sw"><input type="checkbox" ${m.enabled ? 'checked' : ''}> включён</label><button class="btn btn-danger btn-xs" type="button" data-rm aria-label="Удалить">×</button></div>`).join('')}</div>
        <button class="btn btn-ghost btn-xs" type="button" id="addpm">+ Способ оплаты</button><p class="hint">Если ни один способ не включён, на странице оформления выбор оплаты не показывается — способ уточняет оператор.</p>
        ${field('Платёжный провайдер', `<select name="payments.provider"><option value="">— не выбран —</option>${r.env.providers.map(p => `<option ${s['payments.provider'] === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>`)}${chk('payments.online_enabled', s['payments.online_enabled'], 'Онлайн-оплата включена')}</section>
      <p class="muted small">Геокодер адресов: ${r.env.geocoder === 'yandex' ? 'Яндекс.Геокодер (ключ задан)' : 'OpenStreetMap Nominatim (без ключа; для точности и нагрузки рекомендуется ключ Яндекс.Геокодера в .env)'}.</p>
      <div class="dlg-ft"><button class="btn btn-primary btn-lg" type="submit">Сохранить настройки</button></div></form>`;
    const f = $('#sf');
    $('#addpm').onclick = () => $('#pm').insertAdjacentHTML('beforeend', '<div class="sub-row" data-pm><input aria-label="Название способа оплаты" maxlength="60" placeholder="Например: Картой курьеру"><label class="sw"><input type="checkbox" checked> включён</label><button class="btn btn-danger btn-xs" type="button" data-rm>×</button></div>');
    f.addEventListener('click', e => { if (e.target.closest('[data-rm]')) e.target.closest('.sub-row').remove(); });
    f.onsubmit = guard(async e => {
      e.preventDefault(); const g = n => f.elements[n];
      const val = n => g(n).value; const out = {};
      ['site.name', 'site.tagline', 'site.description', 'contact.phone', 'contact.email', 'contact.address', 'contact.map_url', 'contact.reviews_url', 'contact.lat', 'contact.lon', 'orders.closed_message', 'orders.min_lead_minutes', 'delivery.free_radius_km', 'mail.from', 'mail.admin_to', 'payments.provider'].forEach(n => { out[n] = val(n); });
      ['orders.accepting', 'delivery.enabled', 'mail.enabled', 'mail.notify_status_change', 'payments.online_enabled'].forEach(n => { out[n] = g(n).checked; });
      ['delivery.min_order_kop', 'delivery.fee_kop', 'delivery.free_threshold_kop'].forEach(n => { out[n] = toKop(val(n)); });
      out['hours.schedule'] = $$('[data-day]', f).map(r => { const t = $$('input', r); return t[0].value && t[1].value ? { day: Number(r.dataset.day), open: t[0].value, close: t[1].value } : null; }).filter(Boolean);
      out['delivery.free_districts'] = $$('[data-dist]', f).filter(c => c.checked).map(c => c.dataset.dist);
      out['payments.methods'] = $$('[data-pm]', f).map(r => ({ title: $('input[type=text],input:not([type])', r).value, enabled: $('input[type=checkbox]', r).checked, code: r.dataset.pm || undefined })).filter(m => m.title.trim());
      await api('/settings', { method: 'PUT', body: { settings: out } }); toast('Настройки сохранены'); viewSettings();
    });
    $('#mtest').onclick = guard(async () => { const m = await api('/mail/test', { method: 'POST', body: { to: f.elements['mail.admin_to'].value } }); toast(m.message); });
    $('#mlog').onclick = guard(async () => { const { log } = await api('/mail/log'); dialog('Журнал отправки', log.length ? `<ul class="hist">${log.map(l => `<li>${fmtDate(l.created_at)} — ${esc(l.to_addr)} — <strong>${esc(l.status)}</strong> ${esc(l.error)}<br><span class="muted">${esc(l.subject)}</span></li>`).join('')}</ul>` : '<p class="muted">Писем пока не было.</p>'); });
    $('#adddist').onclick = () => dialog('Новый район доставки', `${field('Название', inp('name', '', 'required'))}${field('GeoJSON (Polygon или MultiPolygon)', '<textarea name="geojson" rows="8" placeholder=\'{"type":"Polygon","coordinates":[[[43.8,56.2],...]]}\'></textarea>')}<p class="hint">Границы можно получить, например, из OpenStreetMap (polygons.openstreetmap.fr). Принадлежность района определяется только по этим границам.</p>`,
      { onSave: async dd => { const ff = $('form', dd); await api('/districts', { method: 'POST', body: { name: ff.name.value, geojson: ff.geojson.value } }); toast('Район добавлен'); viewSettings(); } });
    $$('[data-rmdist]', f).forEach(b => b.onclick = guard(async () => { if (!confirm('Удалить район?')) return; await api('/districts/' + b.dataset.rmdist, { method: 'DELETE' }); viewSettings(); }));
  }

  // ── Сотрудники ───────────────────────────────────────────────
  async function viewUsers() {
    const render = guard(async () => {
      const { users } = await api('/users');
      view().innerHTML = `<div class="bar"><button class="btn btn-primary" id="nu">Добавить сотрудника</button></div><table class="tbl resp"><thead><tr><th>Email</th><th>Роль</th><th>Статус</th><th></th></tr></thead><tbody>${users.map(u => `<tr><td data-l="Email">${esc(u.email)}</td><td data-l="Роль">${u.role === 'admin' ? 'Администратор' : u.scope === 'prices' ? 'Только цены' : 'Менеджер (заказы)'}</td><td data-l="Статус">${u.is_active ? 'Активен' : 'Отключён'}</td>
        <td><div class="row-actions">${u.id !== me.id ? `<button class="btn btn-ghost btn-xs" data-tog="${u.id}:${u.is_active ? 0 : 1}">${u.is_active ? 'Отключить' : 'Включить'}</button>` : ''}<button class="btn btn-ghost btn-xs" data-pw="${u.id}">Новый пароль</button></div></td></tr>`).join('')}</tbody></table>`;
      $('#nu').onclick = () => dialog('Новый сотрудник', `${field('Email', inp('email', '', 'type="email" required'))}${field('Имя', inp('name', ''))}${field('Роль', '<select name="role"><option value="manager">Менеджер — только заказы</option><option value="prices">Редактор цен — только цены</option><option value="admin">Администратор — всё</option></select>')}${field('Пароль (от 10 символов, буквы и цифры)', inp('password', '', 'type="password" autocomplete="new-password" required'))}`,
        { onSave: async dd => { const f = $('form', dd); await api('/users', { method: 'POST', body: { email: f.email.value, name: f.name.value, role: f.role.value === 'admin' ? 'admin' : 'manager', scope: f.role.value === 'prices' ? 'prices' : '', password: f.password.value } }); toast('Сотрудник добавлен'); render(); } });
      $$('[data-tog]').forEach(b => b.onclick = guard(async () => { const [id, v] = b.dataset.tog.split(':'); await api('/users/' + id, { method: 'PATCH', body: { is_active: v === '1' } }); render(); }));
      $$('[data-pw]').forEach(b => b.onclick = () => dialog('Новый пароль', field('Пароль (от 10 символов, буквы и цифры)', inp('password', '', 'type="password" autocomplete="new-password" required')), { onSave: async dd => { await api('/users/' + b.dataset.pw, { method: 'PATCH', body: { password: $('form', dd).password.value } }); toast('Пароль изменён'); } }));
    }); render();
  }

  async function boot() {
    try {
      const r = await api('/me'); me = r.user; csrf = r.csrf; labels = r.status_labels; flow = r.status_flow; shell();
    } catch (e) { if (!e.handled) renderLogin(); }
  }
  boot();
})();
