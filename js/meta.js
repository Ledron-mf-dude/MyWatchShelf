// Довідкові дані: пошук, оцінка IMDb, опис, жанри, серії по сезонах.
// Джерело — Cinemeta (відкритий каталог Stremio, ключований ID з IMDb):
// віддає JSON будь-якій сторінці, ключа не просить. Сам IMDb браузерну
// сторінку до себе не пускає, тож напряму до нього не ходимо.
import { isId } from './logic.js';
import { t } from './i18n.js';

const BASE = 'https://v3-cinemeta.strem.io';

async function getJson(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Кеш відповідей каталогу: спершу пам'ять вкладки, далі сховище браузера
// (Cache API), і лише потім мережа. Зберігаємо вже стиснуту до потрібного
// форму — сира сторінка каталогу важить ~700 КБ, наша — кілька десятків.
// Однакові запити, що летять одночасно, зливаються в один.
const DATA_CACHE = 'mws-data-v1', mem = new Map();
const store = typeof caches === 'undefined' ? null : caches.open(DATA_CACHE).catch(() => null);
const keyUrl = key => 'https://cache.local/' + encodeURIComponent(key);
async function cached(key, ttl, load) {
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    const c = await store;
    try {
      const hit = c && await c.match(keyUrl(key));
      if (hit) { const j = await hit.json(); if (Date.now() - j.at < ttl) return j.v; }
    } catch { /* зіпсований запис — беремо з мережі */ }
    const v = await load();
    c?.put(keyUrl(key), new Response(JSON.stringify({ at: Date.now(), v }), { headers: { 'content-type': 'application/json' } })).catch(() => {});
    return v;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
// Раз на вкладку прибираємо записи, старші за дві доби.
store?.then(async c => {
  if (!c) return;
  for (const req of await c.keys()) {
    try { const j = await (await c.match(req)).json(); if (Date.now() - j.at > 48 * 3600e3) c.delete(req); } catch { c.delete(req); }
  }
}).catch(() => {});
const HOUR = 3600e3;

// kind: 'all' | 'anime' | 'series' | 'movie'. Для фільмів питаємо лише
// каталог фільмів. Аніме від серіалу пошук не відрізняє (у видачі немає ні
// жанрів, ні країни), тож для цих двох категорій дотягуємо довідку по
// кожному знайденому запису — вона маленька й кешується.
export async function search(q, signal, kind = 'all') {
  const enc = encodeURIComponent(q);
  const types = kind === 'movie' ? ['movie'] : kind === 'series' ? ['series'] : ['series', 'movie'];
  const lists = await Promise.all(types.map(t =>
    cached(`s|${t}|${q.toLowerCase()}`, 24 * HOUR, () => getJson(`${BASE}/catalog/${t}/top/search=${enc}.json`)
      .then(x => (x.metas || []).map(m => ({ id: m.id, imdb_id: m.imdb_id, type: m.type, name: m.name, releaseInfo: m.releaseInfo }))))
      .catch(() => null)));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  if (lists.every(l => l === null)) throw new Error(t('err.search'));
  const [s, m] = types.length === 2 ? lists.map(l => l || []) : types[0] === 'movie' ? [[], lists[0]] : [lists[0], []];
  const mixed = [];
  for (let i = 0; i < Math.max(s.length, m.length); i++) {
    if (s[i]) mixed.push(s[i]);
    if (m[i]) mixed.push(m[i]);
  }
  // «witcher» має знайти «The Witcher» раніше за «Witcher Logic»
  const bare = s => s.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  const ql = bare(q);
  const rank = x => {
    const n = bare(x.name || '');
    // точний збіг навмисно не піднімаємо: «frieren» — це передусім відомий
    // серіал «Frieren: Beyond…», а не однойменний маловідомий фільм
    return n.startsWith(ql) ? 0 : n.includes(ql) ? 1 : 2;
  };
  const seen = new Set();
  const found = mixed.map((x, i) => ({ x, i, r: rank(x) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ x }) => ({
      id: x.imdb_id || x.id,
      type: x.type === 'movie' ? 'movie' : 'series',
      title: x.name || '',
      year: String(x.releaseInfo || ''),
    }))
    .filter(x => isId(x.id) && x.title && !seen.has(x.id) && seen.add(x.id));
  if (kind !== 'anime' && kind !== 'series') return found.slice(0, 14);
  const full = await Promise.all(found.slice(0, 30).map(x =>
    cached(`m|${x.type}|${x.id}`, 24 * HOUR, () => fetchMeta(x.id, x.type)).catch(() => null)));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  // запис, довідку якого не вдалося дістати, лишаємо серед серіалів, але не видаємо за аніме
  return full.map((f, i) => f || (kind === 'series' ? found[i] : null))
    .filter(x => x && (x.kind || x.type) === kind).slice(0, 14);
}

function normalize(m, type) {
  const seasons = {};
  for (const v of m.videos || []) {
    const s = Number(v.season), n = Number(v.number ?? v.episode);
    if (s > 0 && n > 0) seasons[s] = Math.max(seasons[s] || 0, n);
  }
  const genres = Array.isArray(m.genres) ? m.genres : Array.isArray(m.genre) ? m.genre : [];
  const country = String(m.country || '');
  const anime = genres.includes('Animation') && /japan/i.test(country);
  return {
    id: m.imdb_id || m.id,
    type,
    kind: anime ? 'anime' : type,
    title: m.name || '',
    year: String(m.releaseInfo || m.year || ''),
    meta: {
      imdb: parseFloat(m.imdbRating) || null,
      plot: m.description || '',
      genres: genres.slice(0, 5),
      country,
      runtime: String(m.runtime || ''),
      state: String(m.status || ''),
      cast: (Array.isArray(m.cast) ? m.cast : []).slice(0, 4),
      trailer: (Array.isArray(m.trailers) && m.trailers[0]?.source) || '',
      seasons,
    },
  };
}

// type невідомий (вставили посилання IMDb) — пробуємо серіал; якщо серій
// немає, це фільм.
export async function fetchMeta(id, type, signal) {
  if (!isId(id)) throw new Error(t('err.badid'));
  let m = null, ty = type;
  if (type !== 'movie') {
    m = (await getJson(`${BASE}/meta/series/${id}.json`, signal)).meta;
    if (!type && !(m?.videos?.length)) m = null;
    ty = 'series';
  }
  if (!m) {
    m = (await getJson(`${BASE}/meta/movie/${id}.json`, signal)).meta;
    ty = 'movie';
  }
  if (!m || !m.name) throw new Error(t('err.notfound'));
  return normalize(m, ty);
}

// Готові добірки каталогу: list — 'top' (популярне) або 'year' (тоді в
// genre передається рік). Записи приходять одразу з довідковими даними.
// list: 'top' (популярне), 'imdbRating' (за оцінкою IMDb) або 'year' (тоді в
// genre передається рік). Сторінка — 50 записів.
export const PAGE = 50;
export function catalog({ type = 'series', list = 'top', genre = '', skip = 0 } = {}) {
  const extra = [genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${skip}`].filter(Boolean).join('&');
  const path = `/catalog/${type}/${list}${extra ? '/' + extra : ''}.json`;
  return cached('c|' + path, 6 * HOUR, async () => {
    const j = await getJson(BASE + path);
    // n — скільки записів віддав каталог: за ним видно, чи це остання сторінка
    return { n: (j.metas || []).length, items: (j.metas || []).filter(m => isId(m.imdb_id || m.id) && m.name).map(m => normalize(m, type)) };
  });
}

// Дати виходу серій — для календаря. Тримаємо в пам'яті й у сховищі
// вкладки шість годин: розклад змінюється рідко, а записів багато.
const schedCache = new Map();
export async function schedule(id, signal) {
  if (schedCache.has(id)) return schedCache.get(id);
  const key = 'mws.sched.' + id;
  try {
    const c = JSON.parse(sessionStorage.getItem(key));
    if (c && Date.now() - c.at < 6 * 3600e3) { schedCache.set(id, c.eps); return c.eps; }
  } catch { /* нічого */ }
  const m = (await getJson(`${BASE}/meta/series/${id}.json`, signal)).meta;
  const eps = (m?.videos || [])
    .map(v => ({ s: Number(v.season), e: Number(v.number ?? v.episode), d: Date.parse(v.released || v.firstAired) }))
    .filter(v => v.s > 0 && v.e > 0 && Number.isFinite(v.d));
  schedCache.set(id, eps);
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), eps })); } catch { /* нічого */ }
  return eps;
}
