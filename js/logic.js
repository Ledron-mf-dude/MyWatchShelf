// Чиста логіка без DOM і без мережі — її ж ганяють тести (tests/logic.test.mjs).

import { t, getLang, genreName, genreNames } from './i18n.js';
export { genreName };

export const STATUS_IDS = ['watching', 'planned', 'done', 'paused', 'dropped'];
export const KIND_IDS = ['anime', 'series', 'movie'];
export const statusLabel = id => t('st.' + id);
export const kindLabel = id => (KIND_IDS.includes(id) ? t('kind.' + id) : '');

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const isId = s => typeof s === 'string' && /^tt\d{6,10}$/.test(s);

// Усе, що йде в href, проходить тут: посилання вписує людина, а ще вони
// приїжджають з імпорту й з хмари. «javascript:» у сторінці нам не треба.
export function safeUrl(u) {
  let s = String(u ?? '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s/]+\.[^\s/]+/.test(s)) s = 'https://' + s;
  try {
    const x = new URL(s);
    return /^https?:$/.test(x.protocol) ? x.href : '';
  } catch { return ''; }
}

export const poster = (id, size = 'small') =>
  isId(id) ? `https://images.metahub.space/poster/${size}/${id}/img` : '';
export const backdrop = (id, size = 'medium') =>
  isId(id) ? `https://images.metahub.space/background/${size}/${id}/img` : '';

export const CATALOG_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama',
  'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
export function fmtRuntime(r) {
  const n = parseInt(r, 10);
  if (!n) return '';
  if (n < 60) return `${n} ${t('min')}`;
  return `${Math.floor(n / 60)} ${t('h')}${n % 60 ? ` ${n % 60} ${t('min')}` : ''}`;
}

export const fmtRating = x => (typeof x === 'number' && x > 0)
  ? (getLang() === 'uk' ? x.toFixed(1).replace('.', ',') : x.toFixed(1)) : '';
// Власна оцінка: ціла — без дробу («9»), проміжна — з половинкою («9,5»).
export const fmtScore = x => (typeof x === 'number' && x > 0)
  ? (Number.isInteger(x) ? String(x) : fmtRating(x)) : '';

// Що людина вставила в поле додавання: ID чи посилання IMDb, чуже посилання
// (тоді з його хвоста робимо запит, а саме посилання лишаємо як «де дивлюсь»)
// чи просто назву.
export function parseInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { query: '' };
  const m = s.match(/tt\d{6,10}/);
  if (m && (/imdb\.com/i.test(s) || /^tt\d+$/.test(s))) return { id: m[0] };
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      let seg = u.pathname.split('/').filter(Boolean).pop() || '';
      try { seg = decodeURIComponent(seg); } catch { /* лишаємо як є */ }
      const query = seg.replace(/\.(html?|php|aspx?)$/i, '')
        .replace(/[-_+.]+/g, ' ').replace(/\b\d+\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      return { query, url: u.href };
    } catch { /* не посилання — шукаємо як текст */ }
  }
  return { query: s };
}

const str = (v, max) => (typeof v === 'string' ? v : '').slice(0, max);
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

// Оцінка: 0 (немає) або 1…10 з кроком 0,5.
const half = v => {
  const n = Math.round(Number(v) * 2) / 2;
  return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : 0;
};

// Запис із чужих рук (хмара, імпорт, стара версія) зводимо до відомої форми.
export function sanitize(e) {
  if (!e || !isId(e.id)) return null;
  const updated = Number(e.updated) || 0;
  if (e.deleted) return { id: e.id, deleted: true, updated };
  const out = {
    id: e.id,
    type: e.type === 'movie' ? 'movie' : 'series',
    kind: KIND_IDS.includes(e.kind) ? e.kind : (e.type === 'movie' ? 'movie' : 'series'),
    title: str(e.title, 300) || e.id,
    year: str(e.year, 20),
    status: STATUS_IDS.includes(e.status) ? e.status : 'planned',
    season: int(e.season, 1, 999),
    episode: int(e.episode, 0, 99999),
    score: half(e.score),
    url: safeUrl(str(e.url, 2000)),
    note: str(e.note, 5000),
    rec: !!e.rec,
    recNote: str(e.recNote, 500),
    lists: [...new Set((Array.isArray(e.lists) ? e.lists : []).map(x => str(x, 40).trim()).filter(Boolean))].slice(0, 8),
    added: Number(e.added) || updated,
    updated,
  };
  if (e.meta && typeof e.meta === 'object') {
    const m = e.meta, seasons = {};
    if (m.seasons && typeof m.seasons === 'object') {
      for (const [k, v] of Object.entries(m.seasons)) {
        const s = int(k, 0, 999), n = int(v, 0, 99999);
        if (s > 0 && n > 0) seasons[s] = n;
      }
    }
    out.meta = {
      imdb: Number(m.imdb) > 0 ? Math.min(10, Number(m.imdb)) : null,
      plot: str(m.plot, 3000),
      genres: (Array.isArray(m.genres) ? m.genres : []).slice(0, 6).map(g => str(g, 40)).filter(Boolean),
      country: str(m.country, 120),
      runtime: str(m.runtime, 40),
      state: str(m.state, 40),
      cast: (Array.isArray(m.cast) ? m.cast : []).slice(0, 5).map(g => str(g, 80)).filter(Boolean),
      trailer: /^[\w-]{6,20}$/.test(m.trailer || '') ? m.trailer : '',
      seasons,
    };
    out.metaAt = Number(e.metaAt) || 0;
  }
  return out;
}

// Злиття двох копій одного запису. Людське (оцінка, серія, посилання) —
// за міткою `updated`: свіжіше перемагає, при рівних — те, що приїхало.
// Довідкове з IMDb — окремо, за `metaAt`: оновлення опису на одному
// пристрої не має затирати оцінку, що чекає в черзі на іншому.
export function mergeEntry(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const base = (remote.updated || 0) >= (local.updated || 0) ? remote : local;
  const other = base === remote ? local : remote;
  if (!base.deleted && other.meta && (other.metaAt || 0) > (base.metaAt || 0)) {
    return { ...base, meta: other.meta, metaAt: other.metaAt };
  }
  return base;
}

export const sameVersion = (a, b) => !!a && !!b &&
  (a.updated || 0) === (b.updated || 0) && (a.metaAt || 0) === (b.metaAt || 0) &&
  !!a.deleted === !!b.deleted;

export const seasonTotal = (e, s = e.season || 1) => (e.meta?.seasons || {})[s] || 0;

// «+1 серія»: наступна серія, перехід у новий сезон, а на останній серії
// завершеного серіалу — статус «переглянуто».
export function nextEpisode(e) {
  const seasons = e.meta?.seasons || {};
  const s = e.season || 1, ep = e.episode || 0, total = seasons[s] || 0;
  const patch = {};
  if (total && ep >= total) {
    if (seasons[s + 1]) { patch.season = s + 1; patch.episode = 1; }
  } else {
    patch.episode = ep + 1;
  }
  const ns = patch.season || s, nep = patch.episode ?? ep;
  const atEnd = !!seasons[ns] && nep >= seasons[ns] && !seasons[ns + 1];
  if (atEnd && /ended/i.test(e.meta?.state || '')) patch.status = 'done';
  else if (e.status !== 'watching') patch.status = 'watching';
  return patch;
}

export function progressText(e) {
  if (e.type !== 'series') return '';
  if (!e.episode && e.status === 'planned') return '';
  const total = seasonTotal(e);
  return t('prog', { s: e.season || 1, e: `${e.episode || 0}${total ? '/' + total : ''}` });
}

export function filterSort(list, f, sort, dir) {
  const q = (f.q || '').trim().toLowerCase();
  const out = list.filter(e => {
    if (f.kind && f.kind !== 'all' && e.kind !== f.kind) return false;
    if (f.genres?.length && !f.genres.some(g => (e.meta?.genres || []).includes(g))) return false;
    if (f.list && !(e.lists || []).includes(f.list)) return false;
    if (f.status === 'rec') { if (!e.rec) return false; }
    else if (f.status && f.status !== 'all' && e.status !== f.status) return false;
    if (q) {
      const hay = [e.title, e.year, e.note, kindLabel(e.kind), ...(e.meta?.genres || []).flatMap(genreNames)]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = {
    updated: e => e.updated || 0,
    score: e => e.score || 0,
    imdb: e => e.meta?.imdb || 0,
    year: e => parseInt(e.year, 10) || 0,
    added: e => e.added || 0,
    progress: e => progressPct(e),
  }[sort];
  if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title, getLang()) * dir);
  else if (key) out.sort((a, b) => (key(a) - key(b)) * dir || a.title.localeCompare(b.title, getLang()));
  return out;
}

export function stats(list) {
  const rated = list.filter(e => e.score > 0);
  const by = k => list.filter(e => e.kind === k).length;
  return {
    total: list.length,
    anime: by('anime'), series: by('series'), movie: by('movie'),
    watching: list.filter(e => e.status === 'watching').length,
    done: list.filter(e => e.status === 'done').length,
    rated: rated.length,
    avg: rated.length ? rated.reduce((s, e) => s + e.score, 0) / rated.length : 0,
    rec: list.filter(e => e.rec).length,
  };
}

// ── прогрес і статистика ──────────────────────────────────────────
export const runtimeMin = e => parseInt(e.meta?.runtime, 10) || 0;
export function episodesWatched(e) {
  if (e.type !== 'series') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(e.meta?.seasons || {})) if (+k < (e.season || 1)) n += v;
  return n + (e.episode || 0);
}
export const episodesTotal = e => Object.values(e.meta?.seasons || {}).reduce((a, b) => a + b, 0);
export function progressPct(e) {
  if (e.status === 'done') return 100;
  if (e.type !== 'series') return 0;
  const t = episodesTotal(e);
  return t ? Math.min(100, Math.round(episodesWatched(e) / t * 100)) : 0;
}
// Скільки хвилин уже переглянуто. Коли тривалість невідома, беремо типові
// 24 хв для аніме, 45 хв для серіалу, 100 хв для фільму: це оцінка, не облік.
export function minutesWatched(e) {
  const r = runtimeMin(e);
  if (e.type === 'series') return episodesWatched(e) * (r || (e.kind === 'anime' ? 24 : 45));
  return e.status === 'done' ? (r || 100) : 0;
}
export function insights(list) {
  const rated = list.filter(e => e.score > 0);
  const count = fn => { const m = {}; for (const e of list) for (const k of [].concat(fn(e))) m[k] = (m[k] || 0) + 1; return m; };
  const genres = Object.entries(count(e => e.meta?.genres || [])).sort((a, b) => b[1] - a[1]);
  const scores = Array.from({ length: 10 }, (_, i) => rated.filter(e => Math.floor(e.score) === i + 1).length);
  const gaps = rated.filter(e => e.meta?.imdb).map(e => ({ e, d: e.score - e.meta.imdb }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
  return {
    total: list.length,
    minutes: list.reduce((s, e) => s + minutesWatched(e), 0),
    episodes: list.reduce((s, e) => s + episodesWatched(e), 0),
    rated: rated.length,
    avg: rated.length ? rated.reduce((s, e) => s + e.score, 0) / rated.length : 0,
    rec: list.filter(e => e.rec).length,
    byStatus: count(e => e.status), byKind: count(e => e.kind),
    genres, scores, gaps,
  };
}

// ── рекомендації ──────────────────────────────────────────────────
// У рекомендації йде лише те, що не соромно показати: назва, оцінка,
// кілька слів «чому». Посилання «де дивлюсь» і нотатки лишаються вдома.
// p: 0 — запис не в загальних рекомендаціях, а лише в добірках; l — назви добірок.
export const recItem = e => ({
  id: e.id, k: e.kind, t: e.title, y: e.year || '',
  s: e.score || 0, n: e.recNote || '', r: e.meta?.imdb || 0,
  ...(e.rec ? {} : { p: 0 }), ...(e.lists?.length ? { l: e.lists } : {}),
});

export function cleanRecs(data) {
  const items = (Array.isArray(data?.items) ? data.items : []).slice(0, 500)
    .filter(x => x && isId(x.id))
    .map(x => {
      const l = (Array.isArray(x.l) ? x.l : []).map(v => str(v, 40)).filter(Boolean).slice(0, 8);
      return {
        id: x.id, k: KIND_IDS.includes(x.k) ? x.k : 'series', t: str(x.t, 300) || x.id,
        y: str(x.y, 20), s: half(x.s), n: str(x.n, 500),
        r: Number(x.r) > 0 ? Math.min(10, Number(x.r)) : 0,
        ...(x.p === 0 ? { p: 0 } : {}), ...(l.length ? { l } : {}),
      };
    });
  const out = { name: str(data?.name, 80), items };
  if (data?.title) out.title = str(data.title, 40);
  return out;
}

// ── добірки ───────────────────────────────────────────────────────
// Добірка — це просто мітка на записах: існує, доки нею позначено хоч
// один запис. Окремого сховища для неї не треба, тож і синхронізується
// вона разом із записами.
export const listNames = list =>
  [...new Set(list.flatMap(e => e.lists || []))].sort((a, b) => a.localeCompare(b, getLang()));

// ── збіг смаків ───────────────────────────────────────────────────
// Порівнюємо оцінки автора рекомендацій з моїми. Відсоток — наскільки
// близькі оцінки на спільних тайтлах (різниця 0 → 100%, різниця 9 → 0%).
export function tasteMatch(mine, items) {
  const by = new Map(mine.map(e => [e.id, e]));
  const rows = items.map(x => {
    const e = by.get(x.id);
    return { x, have: !!e, mine: e?.score || 0, d: e?.score && x.s ? e.score - x.s : null };
  });
  const scored = rows.filter(r => r.d !== null);
  return {
    rows,
    pct: scored.length ? Math.round(100 - scored.reduce((a, r) => a + Math.abs(r.d), 0) / scored.length / 9 * 100) : null,
    scored: scored.length,
    common: rows.filter(r => r.have).length,
    unseen: rows.filter(r => !r.have).length,
  };
}
export const matchTag = r => (r.d === null ? (r.have ? 'have' : 'new') : Math.abs(r.d) <= 1 ? 'match' : 'differ');

// ── «що подивитись сьогодні» ──────────────────────────────────────
export function pickCandidates(list, { max = 0, kind = 'all', genre = '' } = {}) {
  return list.filter(e => e.status === 'planned' || e.status === 'paused')
    .filter(e => kind === 'all' || e.kind === kind)
    .filter(e => !genre || (e.meta?.genres || []).includes(genre))
    .filter(e => !max || (runtimeMin(e) > 0 && runtimeMin(e) <= max));
}

// ── календар серій ────────────────────────────────────────────────
// schedules: { id: [{ s, e, d }] } — сезон, серія, час виходу (мс).
// Для кожного серіалу, який людина дивиться: скільки серій уже вийшло
// після її позиції, чи є свіжа (за останній тиждень) і коли наступна.
export function agenda(entries, schedules, now = Date.now()) {
  const DAY = 864e5, rows = [];
  for (const e of entries) {
    if (e.type !== 'series' || !['watching', 'paused'].includes(e.status)) continue;
    const eps = schedules[e.id];
    if (!eps?.length) continue;
    const after = v => v.s > (e.season || 1) || (v.s === (e.season || 1) && v.e > (e.episode || 0));
    const aired = eps.filter(v => v.d <= now && after(v)).sort((a, b) => a.d - b.d);
    const next = eps.filter(v => v.d > now && v.d <= now + 14 * DAY).sort((a, b) => a.d - b.d)[0] || null;
    const fresh = aired.filter(v => v.d >= now - 7 * DAY).pop() || null;
    if (aired.length || next) rows.push({ e, behind: aired.length, fresh, next });
  }
  return {
    fresh: rows.filter(r => r.fresh).sort((a, b) => b.fresh.d - a.fresh.d),
    upcoming: rows.filter(r => r.next).sort((a, b) => a.next.d - b.next.d),
    behind: rows.filter(r => !r.fresh && r.behind > 0).sort((a, b) => b.behind - a.behind),
  };
}
// Скільки календарних днів від сьогодні до дати (0 — сьогодні, −1 — вчора).
export function dayDiff(d, now = Date.now()) {
  const day = x => { const v = new Date(x); return new Date(v.getFullYear(), v.getMonth(), v.getDate()).getTime(); };
  return Math.round((day(d) - day(now)) / 864e5);
}

const b64u = {
  enc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  },
};
// Посилання приходить від будь-кого, тож розпаковуємо з межею: кілька
// кілобайтів «бомби» не мають роздутися в гігабайти пам'яті.
const MAX_LINK = 200_000, MAX_RAW = 512_000;
async function pipe(bytes, stream, limit = MAX_RAW) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error(t('err.too.big')); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Список-знімок, зашитий просто в посилання: сервер для цього не потрібен.
export async function encodeRecs(name, items, title = '') {
  const compact = { n: name || '', i: items.map(x => [x.id, x.k, x.t, x.y, x.s, x.n, x.r]), ...(title ? { t: title } : {}) };
  const raw = new TextEncoder().encode(JSON.stringify(compact));
  return b64u.enc(await pipe(raw, new CompressionStream('deflate-raw')));
}
export async function decodeRecs(text) {
  if (typeof text !== 'string' || text.length > MAX_LINK) throw new Error(t('err.link.big'));
  const raw = await pipe(b64u.dec(text), new DecompressionStream('deflate-raw'));
  const c = JSON.parse(new TextDecoder().decode(raw));
  return cleanRecs({
    name: c.n, title: c.t,
    items: (c.i || []).map(a => ({ id: a[0], k: a[1], t: a[2], y: a[3], s: a[4], n: a[5], r: a[6] })),
  });
}
