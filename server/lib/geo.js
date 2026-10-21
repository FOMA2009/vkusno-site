const fs = require('fs');
const path = require('path');
const { db, settings } = require('../db');
const cfg = require('../config');
const { sign, verify } = require('./util');

// ── Геометрия ────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPolygon(lon, lat, rings) { // rings[0] — внешний контур, остальные — дыры
  if (!inRing(lon, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k])) return false;
  return true;
}
function inGeometry(lon, lat, g) {
  if (!g) return false;
  if (g.type === 'Polygon') return inPolygon(lon, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return g.coordinates.some(p => inPolygon(lon, lat, p));
  return false;
}

// ── Районы доставки ──────────────────────────────────────────
const districtGeoCache = new Map();
function districtGeometry(d) {
  if (d.geojson) return d.geojson.geometry || d.geojson;
  if (d.source && d.source.startsWith('file:')) {
    if (!districtGeoCache.has(d.source)) {
      const f = path.join(__dirname, '..', 'data', d.source.slice(5));
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      districtGeoCache.set(d.source, j.geometry || j);
    }
    return districtGeoCache.get(d.source);
  }
  return null;
}

// Определение зоны по координатам. Работает только с проверенными геометриями.
function classifyPoint(lat, lon) {
  const rlat = Number(settings.get('contact.lat')), rlon = Number(settings.get('contact.lon'));
  const distance = haversineKm(rlat, rlon, lat, lon);
  const radius = Number(settings.get('delivery.free_radius_km'));
  const freeIds = settings.get('delivery.free_districts') || [];
  let district = null;
  for (const d of settings.get('delivery.districts') || []) {
    let g; try { g = districtGeometry(d); } catch { g = null; }
    if (g && inGeometry(lon, lat, g)) { district = d; break; }
  }
  const freeByDistrict = !!district && freeIds.includes(district.id);
  const freeByRadius = distance <= radius;
  return {
    distance_km: Math.round(distance * 100) / 100,
    district: district ? district.name : null,
    free: freeByDistrict || freeByRadius,
    free_reason: freeByDistrict ? 'district' : freeByRadius ? 'radius' : null,
  };
}

// ── Геокодирование ───────────────────────────────────────────
// Провайдер: Яндекс.Геокодер (если задан YANDEX_GEOCODER_KEY), иначе OSM Nominatim.
// Все запросы выполняются на сервере: ключи не попадают в браузер.
const NN_BBOX = { w: 43.55, s: 56.15, e: 44.25, n: 56.45 };
let lastExternal = 0, chain = Promise.resolve();
function throttled(fn, gapMs = 1100) { // политика Nominatim: не чаще 1 запроса/сек
  const run = chain.then(async () => {
    const wait = Math.max(0, lastExternal + gapMs - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } finally { lastExternal = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}
async function fetchJson(url, headers = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) { // публичные геокодеры иногда отвечают 5xx — повторяем
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'vkusno-shop/1.0 (restaurant delivery site)', 'Accept-Language': 'ru', ...headers }, signal: ctrl.signal });
      if (r.ok) return await r.json();
      lastErr = new Error('HTTP ' + r.status);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { lastErr = e; }
    finally { clearTimeout(t); }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  throw lastErr;
}

const HOUSE_CLASSES = new Set(['building', 'place', 'amenity', 'shop', 'office', 'tourism', 'leisure']);
function fromNominatim(x) {
  const a = x.address || {};
  const city = a.city || a.town || a.village || a.municipality || '';
  const house = a.house_number || '';
  const road = a.road || a.pedestrian || a.residential || '';
  const label = [city, road, house].filter(Boolean).join(', ');
  return {
    label: label || x.display_name,
    full: x.display_name,
    lat: Number(x.lat), lon: Number(x.lon),
    city, house, road,
    precise: !!house && !!road, // есть и улица, и номер дома — это точный адрес (здание или заведение по этому адресу)
  };
}
async function nominatim(q, city, bounded) {
  const p = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'ru', countrycodes: 'ru', q });
  if (bounded) { p.set('viewbox', `${NN_BBOX.w},${NN_BBOX.n},${NN_BBOX.e},${NN_BBOX.s}`); p.set('bounded', '1'); }
  const arr = await throttled(() => fetchJson('https://nominatim.openstreetmap.org/search?' + p));
  return arr.map(fromNominatim);
}
// Структурированный запрос «номер дома + улица» — точнее, когда обычный поиск вернул только улицу или город
async function nominatimStructured(street, house, city) {
  const p = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'ru', countrycodes: 'ru', street: `${house} ${street}`, city });
  p.set('viewbox', `${NN_BBOX.w},${NN_BBOX.n},${NN_BBOX.e},${NN_BBOX.s}`); p.set('bounded', '1');
  const arr = await throttled(() => fetchJson('https://nominatim.openstreetmap.org/search?' + p));
  return arr.map(fromNominatim);
}
async function yandex(q, city) {
  const p = new URLSearchParams({ apikey: cfg.YANDEX_GEOCODER_KEY, geocode: q, format: 'json', results: '5', lang: 'ru_RU',
    bbox: `${NN_BBOX.w},${NN_BBOX.s}~${NN_BBOX.e},${NN_BBOX.n}`, rspn: '0' });
  const j = await fetchJson('https://geocode-maps.yandex.ru/1.x/?' + p);
  const members = j?.response?.GeoObjectCollection?.featureMember || [];
  return members.map(m => {
    const o = m.GeoObject, meta = o.metaDataProperty.GeocoderMetaData;
    const comps = meta.Address?.Components || [];
    const get = k => comps.find(c => c.kind === k)?.name || '';
    const [lon, lat] = o.Point.pos.split(' ').map(Number);
    const house = get('house'), road = get('street');
    return { label: [get('locality'), road, house].filter(Boolean).join(', ') || meta.text, full: meta.text,
      lat, lon, city: get('locality'), house, road, precise: meta.precision === 'exact' && !!house };
  });
}

function cacheGet(key) {
  const r = db.prepare('SELECT result, created_at FROM geocache WHERE q = ?').get(key);
  if (r && Date.now() - r.created_at < 30 * 864e5) return JSON.parse(r.result);
  return null;
}
function cacheSet(key, v) {
  db.prepare('INSERT INTO geocache(q,result,created_at) VALUES(?,?,?) ON CONFLICT(q) DO UPDATE SET result=excluded.result, created_at=excluded.created_at')
    .run(key, JSON.stringify(v), Date.now());
}

// Возвращает кандидатов; к каждому — вердикт по городу и точности и подписанный токен.
async function search(input) {
  const city = settings.get('delivery.city');
  const text = String(input || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (text.length < 4) return { candidates: [] };
  const key = (cfg.YANDEX_GEOCODER_KEY ? 'y:' : 'n:') + text.toLowerCase();
  let list = cacheGet(key);
  if (!list) {
    const mentionsCity = text.toLowerCase().includes(city.toLowerCase());
    const q = mentionsCity ? text : `${text}, ${city}`;
    try {
      if (cfg.YANDEX_GEOCODER_KEY) list = await yandex(q, city);
      else {
        list = await nominatim(q, city, true);
        if (!list.length) list = await nominatim(text, city, false); // вдруг адрес вне города
        if (!list.some(c => c.precise)) { // дом не найден — пробуем структурированный запрос
          const m = /^(.*?)[,\s]+(\d+\s?[а-яa-z]?(?:\/\d+)?)$/i.exec(text.replace(new RegExp(city, 'i'), '').replace(/^[,\s]+|[,\s]+$/g, ''));
          if (m) { try { list = [...(await nominatimStructured(m[1].replace(/,\s*$/, ''), m[2].replace(/\s/g, ''), city)), ...list]; } catch { /* оставляем первый результат */ } }
        }
      }
    } catch (e) {
      const err = new Error('geocoder_unavailable'); err.cause = e; throw err;
    }
    if (list.some(c => c.precise)) cacheSet(key, list); // неточные/пустые ответы не кешируем — геокодер мог дать сбой
  }
  const seen = new Set();
  const uniq = [...list].sort((a, b) => Number(b.precise) - Number(a.precise)) // точные — вперёд, затем убираем дубли
    .filter(c => { const k = c.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const candidates = uniq.map(c => {
    const inCity = c.city.toLowerCase() === city.toLowerCase();
    const inBox = c.lon >= NN_BBOX.w && c.lon <= NN_BBOX.e && c.lat >= NN_BBOX.s && c.lat <= NN_BBOX.n;
    const out = { label: c.label, full: c.full, in_city: inCity && inBox, precise: c.precise };
    if (!out.in_city) out.problem = 'outside_city';
    else if (!c.precise) out.problem = 'need_house';
    else {
      const t = sign(cfg.SECRET, { l: c.label, lat: c.lat, lon: c.lon, exp: Date.now() + 24 * 3600e3 });
      out.token = t;
    }
    return out;
  });
  return { candidates };
}

// Проверка токена: клиент не может подставить свои координаты.
function resolveToken(token) {
  const p = verify(cfg.SECRET, token);
  if (!p) return null;
  return { label: p.l, lat: p.lat, lon: p.lon, ...classifyPoint(p.lat, p.lon) };
}

module.exports = { haversineKm, inGeometry, classifyPoint, search, resolveToken };
