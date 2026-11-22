// Довідкові дані: пошук, оцінка IMDb, опис, жанри, серії по сезонах.
// Джерело — Cinemeta (відкритий каталог Stremio, ключований ID з IMDb):
// віддає JSON будь-якій сторінці, ключа не просить. Сам IMDb браузерну
// сторінку до себе не пускає, тож напряму до нього не ходимо.
import { isId, isAnime } from './logic.js';
import { INDEX_URL } from './config.js';
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
// Прострочений запис усе одно показуємо одразу, а свіжий тягнемо у фоні —
// він підміняє старий у пам'яті й у сховищі. Зовсім старе (понад тиждень)
// не показуємо.
const KEEP = 7 * 24 * 3600e3;
async function cached(key, ttl, load) {
  if (mem.has(key)) return mem.get(key);
  const p = (async () => {
    const c = await store;
    let stale;
    try {
      const hit = c && await c.match(keyUrl(key));
      if (hit) {
        const j = await hit.json(), age = Date.now() - j.at;
        if (age < ttl) return j.v;
        if (age < KEEP) stale = j;
      }
    } catch { /* зіпсований запис — беремо з мережі */ }
    const fresh = async () => {
      const v = await load();
      c?.put(keyUrl(key), new Response(JSON.stringify({ at: Date.now(), v }), { headers: { 'content-type': 'application/json' } })).catch(() => {});
      return v;
    };
    if (!stale) return fresh();
    fresh().then(v => mem.set(key, Promise.resolve(v))).catch(() => {});
    return stale.v;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
// Раз на вкладку прибираємо записи, старші за тиждень.
store?.then(async c => {
  if (!c) return;
  for (const req of await c.keys()) {
    try { const j = await (await c.match(req)).json(); if (Date.now() - j.at > KEEP) c.delete(req); } catch { c.delete(req); }
  }
}).catch(() => {});
const HOUR = 3600e3;

// Довідка по одному тайтлу з кешем на добу: для пошуку, перегляду з
// каталогу й підвантаження наперед. Картка на полиці оновлюється окремо,
// напряму через fetchMeta — їй потрібне найсвіжіше.
export const meta = (id, type) => cached(`m|${type || ''}|${id}`, 24 * HOUR, () => fetchMeta(id, type));

// ── власний індекс каталогу ───────────────────────────────────────
// Один файл на вкладку: 'series', 'movie' або 'anime'. Записи вже
// впорядковані за популярністю. Довідка в них скорочена (thin): лише
// оцінка й жанри, решту дотягуємо, коли тайтл відкривають чи додають.
const INDEX = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'data/' : INDEX_URL;
const indexMem = new Map();
export function index(kind) {
  if (!indexMem.has(kind)) {
    const p = cached('i|' + kind, 12 * HOUR, async () => {
      const j = await getJson(`${INDEX}${kind}.json`);
      if (j?.v !== 1 || !Array.isArray(j.items) || !Array.isArray(j.genres)) throw new Error('bad index');
      return j;
    }).then(j => j.items.map(([id, title, year, g, imdb, pop, flags]) => ({
      id, type: flags & 1 ? 'movie' : 'series', kind: flags & 2 ? 'anime' : flags & 1 ? 'movie' : 'series',
      title, year, thin: true,
      meta: { imdb: imdb || null, plot: '', genres: g.map(i => j.genres[i]), country: '', runtime: '', state: '', cast: [], trailer: '', seasons: {} },
    })));
    indexMem.set(kind, p);
    p.catch(() => indexMem.delete(kind));
  }
  return indexMem.get(kind);
}
const animeIds = () => index('anime').then(l => new Set(l.map(x => x.id))).catch(() => null);

// ── назви іншими мовами ───────────────────────────────────────────
// Каталог шукає лише за англійською чи оригінальною назвою. Запит
// українською, японською чи ромадзі віддаємо у Вікідані: там є назви всіма
// мовами й номер IMDb. Сервіс суворо обмежує частоту запитів, тож чекаємо,
// доки людина перестане друкувати, а будь-яку відмову мовчки пропускаємо.
const WD = 'https://www.wikidata.org/w/api.php';
const pause = (ms, signal) => new Promise((res, rej) => {
  const id = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});
async function altIds(q, signal) {
  const key = 'w|' + q.toLowerCase();
  if (!mem.has(key)) await pause(450, signal);
  return cached(key, 24 * HOUR, async () => {
    const s = await getJson(`${WD}?action=query&list=search&format=json&origin=*&srlimit=8&srprop=&srsearch=${encodeURIComponent(q.replace(/["\\:]/g, ' ') + ' haswbstatement:P345')}`);
    const ids = (s.query?.search || []).map(x => x.title).filter(x => /^Q\d+$/.test(x));
    if (!ids.length) return [];
    const e = await getJson(`${WD}?action=wbgetentities&format=json&origin=*&props=claims&ids=${ids.join('|')}`);
    return ids.map(id => (e.entities?.[id]?.claims?.P345 || []).map(c => c.mainsnak?.datavalue?.value).find(isId)).filter(Boolean);
  });
}

async function titles(q, types) {
  const enc = encodeURIComponent(q);
  const lists = await Promise.all(types.map(t =>
    cached(`s|${t}|${q.toLowerCase()}`, 24 * HOUR, () => getJson(`${BASE}/catalog/${t}/top/search=${enc}.json`)
      .then(x => (x.metas || []).map(m => ({ id: m.id, imdb_id: m.imdb_id, type: m.type, name: m.name, releaseInfo: m.releaseInfo }))))
      .catch(() => null)));
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
  return mixed.map((x, i) => ({ x, i, r: rank(x) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ x }) => ({
      id: x.imdb_id || x.id,
      type: x.type === 'movie' ? 'movie' : 'series',
      title: x.name || '',
      year: String(x.releaseInfo || ''),
    }))
    .filter(x => isId(x.id) && x.title && !seen.has(x.id) && seen.add(x.id));
}

// kind: 'all' | 'anime' | 'series' | 'movie'. Для фільмів питаємо лише
// каталог фільмів. Аніме від серіалу пошук не відрізняє (у видачі немає ні
// жанрів, ні країни): що є в індексі аніме — знаємо одразу, по решті
// дотягуємо довідку. onPartial викликається щоразу, коли видача уточнилась,
// — щоб показати знайдене, не чекаючи на останній запит.
export async function search(q, signal, kind = 'all', onPartial) {
  const check = () => { if (signal?.aborted) throw new DOMException('aborted', 'AbortError'); };
  const narrow = kind === 'anime' || kind === 'series';
  const fits = x => kind === 'all' ? true
    : kind === 'movie' ? x.type === 'movie'
    : kind === 'series' ? x.type === 'series' && x.kind !== 'anime'
    : x.kind === 'anime';
  let rows = [];
  const view = () => rows.filter(fits).slice(0, 14);
  const show = () => { if (!signal?.aborted) onPartial?.(view()); };

  const [found, anime] = await Promise.all([
    titles(q, kind === 'movie' ? ['movie'] : kind === 'series' ? ['series'] : ['series', 'movie']).catch(err => err),
    narrow ? animeIds() : null,
  ]);
  check();
  const base = Array.isArray(found) ? found : [];
  rows = base.slice(0, 30).map(x => (anime?.has(x.id) ? { ...x, kind: 'anime' } : x));
  show();

  const jobs = [];
  // уточнюємо, що з непізнаного — аніме
  if (narrow) {
    rows.forEach((x, i) => {
      if (x.kind) return;
      jobs.push(meta(x.id, x.type).then(full => { rows[i] = full; }, () => { rows[i] = { ...x, kind: x.type }; }).then(show));
    });
  }
  // назви іншими мовами: коли в запиті не латиниця або каталог знайшов мало
  if (q.length >= 3 && (/[^\x00-\x7f]/.test(q) || base.length < 4)) {
    jobs.push(altIds(q, signal).then(ids => Promise.all(ids.filter(id => !rows.some(x => x.id === id)).slice(0, 8)
      .map(id => meta(id).catch(() => null)))).then(more => {
      const add = more.filter(Boolean).filter(x => !rows.some(r => r.id === x.id));
      // для нелатинського запиту це якраз найточніші збіги — ставимо першими
      rows = /[^\x00-\x7f]/.test(q) ? [...add, ...rows] : [...rows, ...add];
      show();
    }, err => { if (err.name === 'AbortError') throw err; }));
  }
  await Promise.all(jobs);
  check();
  if (!rows.length && !Array.isArray(found)) throw found;
  return view();
}

function normalize(m, type) {
  const seasons = {};
  for (const v of m.videos || []) {
    const s = Number(v.season), n = Number(v.number ?? v.episode);
    if (s > 0 && n > 0) seasons[s] = Math.max(seasons[s] || 0, n);
  }
  const genres = Array.isArray(m.genres) ? m.genres : Array.isArray(m.genre) ? m.genre : [];
  const country = String(m.country || '');
  const anime = isAnime(genres, country);
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
