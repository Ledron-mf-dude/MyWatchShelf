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

export async function search(q, signal) {
  const enc = encodeURIComponent(q);
  const lists = await Promise.all(['series', 'movie'].map(t =>
    getJson(`${BASE}/catalog/${t}/top/search=${enc}.json`, signal)
      .then(x => x.metas || [])
      .catch(e => { if (e.name === 'AbortError') throw e; return null; })));
  if (lists.every(l => l === null)) throw new Error(t('err.search'));
  const [s, m] = lists.map(l => l || []);
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
    .filter(x => isId(x.id) && x.title && !seen.has(x.id) && seen.add(x.id))
    .slice(0, 14);
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
  let m = null, t = type;
  if (type !== 'movie') {
    m = (await getJson(`${BASE}/meta/series/${id}.json`, signal)).meta;
    if (!type && !(m?.videos?.length)) m = null;
    t = 'series';
  }
  if (!m) {
    m = (await getJson(`${BASE}/meta/movie/${id}.json`, signal)).meta;
    t = 'movie';
  }
  if (!m || !m.name) throw new Error(t('err.notfound'));
  return normalize(m, t);
}

// Готові добірки каталогу: list — 'top' (популярне) або 'year' (тоді в
// genre передається рік). Записи приходять одразу з довідковими даними.
const catalogCache = new Map();
export async function catalog({ type = 'series', list = 'top', genre = '', skip = 0 } = {}, signal) {
  const extra = [genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${skip}`].filter(Boolean).join('&');
  const url = `${BASE}/catalog/${type}/${list}${extra ? '/' + extra : ''}.json`;
  if (catalogCache.has(url)) return catalogCache.get(url);
  const j = await getJson(url, signal);
  const out = (j.metas || []).filter(m => isId(m.imdb_id || m.id) && m.name).map(m => normalize(m, type));
  catalogCache.set(url, out);
  return out;
}
