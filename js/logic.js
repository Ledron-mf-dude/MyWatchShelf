// Чиста логіка без DOM і без мережі — її ж ганяють тести (tests/logic.test.mjs).

export const STATUSES = [
  ['watching', 'дивлюсь'],
  ['planned', 'у планах'],
  ['done', 'переглянуто'],
  ['paused', 'на паузі'],
  ['dropped', 'кинув'],
];
export const KINDS = [
  ['anime', 'аніме'],
  ['series', 'серіал'],
  ['movie', 'фільм'],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);
export const KIND_LABEL = Object.fromEntries(KINDS);

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

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const fmtRating = x => (typeof x === 'number' && x > 0)
  ? x.toFixed(1).replace('.', ',') : '';

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

// Запис із чужих рук (хмара, імпорт, стара версія) зводимо до відомої форми.
export function sanitize(e) {
  if (!e || !isId(e.id)) return null;
  const updated = Number(e.updated) || 0;
  if (e.deleted) return { id: e.id, deleted: true, updated };
  const out = {
    id: e.id,
    type: e.type === 'movie' ? 'movie' : 'series',
    kind: KIND_LABEL[e.kind] ? e.kind : (e.type === 'movie' ? 'movie' : 'series'),
    title: str(e.title, 300) || e.id,
    year: str(e.year, 20),
    status: STATUS_LABEL[e.status] ? e.status : 'planned',
    season: int(e.season, 1, 999),
    episode: int(e.episode, 0, 99999),
    score: int(e.score, 0, 10),
    url: safeUrl(str(e.url, 2000)),
    note: str(e.note, 5000),
    rec: !!e.rec,
    recNote: str(e.recNote, 500),
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
  return `сезон ${e.season || 1} · серія ${e.episode || 0}${total ? '/' + total : ''}`;
}

export function filterSort(list, f, sort, dir) {
  const q = (f.q || '').trim().toLowerCase();
  const out = list.filter(e => {
    if (f.kind && f.kind !== 'all' && e.kind !== f.kind) return false;
    if (f.status === 'rec') { if (!e.rec) return false; }
    else if (f.status && f.status !== 'all' && e.status !== f.status) return false;
    if (q) {
      const hay = [e.title, e.year, e.note, KIND_LABEL[e.kind], ...(e.meta?.genres || [])]
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
  }[sort];
  if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title, 'uk') * dir);
  else if (key) out.sort((a, b) => (key(a) - key(b)) * dir || a.title.localeCompare(b.title, 'uk'));
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

// ── рекомендації ──────────────────────────────────────────────────
// У рекомендації йде лише те, що не соромно показати: назва, оцінка,
// кілька слів «чому». Посилання «де дивлюсь» і нотатки лишаються вдома.
export const recItem = e => ({
  id: e.id, k: e.kind, t: e.title, y: e.year || '',
  s: e.score || 0, n: e.recNote || '', r: e.meta?.imdb || 0,
});

export function cleanRecs(data) {
  const items = (Array.isArray(data?.items) ? data.items : []).slice(0, 500)
    .filter(x => x && isId(x.id))
    .map(x => ({
      id: x.id, k: KIND_LABEL[x.k] ? x.k : 'series', t: str(x.t, 300) || x.id,
      y: str(x.y, 20), s: int(x.s, 0, 10), n: str(x.n, 500),
      r: Number(x.r) > 0 ? Math.min(10, Number(x.r)) : 0,
    }));
  return { name: str(data?.name, 80), items };
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
    if (size > limit) { await reader.cancel(); throw new Error('список завеликий'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// Список-знімок, зашитий просто в посилання: сервер для цього не потрібен.
export async function encodeRecs(name, items) {
  const compact = { n: name || '', i: items.map(x => [x.id, x.k, x.t, x.y, x.s, x.n, x.r]) };
  const raw = new TextEncoder().encode(JSON.stringify(compact));
  return b64u.enc(await pipe(raw, new CompressionStream('deflate-raw')));
}
export async function decodeRecs(text) {
  if (typeof text !== 'string' || text.length > MAX_LINK) throw new Error('посилання завелике');
  const raw = await pipe(b64u.dec(text), new DecompressionStream('deflate-raw'));
  const c = JSON.parse(new TextDecoder().decode(raw));
  return cleanRecs({
    name: c.n,
    items: (c.i || []).map(a => ({ id: a[0], k: a[1], t: a[2], y: a[3], s: a[4], n: a[5], r: a[6] })),
  });
}
