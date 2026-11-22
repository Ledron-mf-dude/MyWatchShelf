// Збирає власний індекс каталогу: обходить стрічки Cinemeta («за роком»,
// «популярне», «за оцінкою») і складає три компактні файли — серіали,
// фільми й аніме. Застосунок вантажить один такий файл і далі фільтрує та
// сортує сам, по повному списку, без десятків запитів до джерела.
//
//   node tools/index.mjs [--out data] [--since N]
//
// --since N — оновити лише останні N років (решту взяти з уже наявних
// файлів у теці --out). Без нього — повний обхід.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAnime, isId } from '../js/logic.js';

const BASE = 'https://v3-cinemeta.strem.io', PAGE = 50, MAX_PAGES = 30, PARALLEL = 6;
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1]; };
const OUT = opt('out', 'data'), SINCE = Number(opt('since', 0)) || 0;

let requests = 0;
async function getJson(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      requests++;
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${path}: ${err.message}`);
      await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

// Черга з обмеженням одночасних запитів.
async function pool(jobs, worker) {
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < jobs.length) await worker(jobs[next++]);
  }));
}

const found = new Map();   // id → запис
function take(m, type) {
  const id = m.imdb_id || m.id;
  if (!isId(id) || !m.name) return;
  const genres = Array.isArray(m.genres) ? m.genres : Array.isArray(m.genre) ? m.genre : [];
  // той самий номер трапляється і серед серіалів, і серед фільмів — тоді це серіал
  const prev = found.get(id);
  found.set(id, {
    id, movie: type === 'movie' && (!prev || prev.movie), title: String(m.name), year: String(m.releaseInfo || m.year || ''),
    genres: genres.map(String), imdb: parseFloat(m.imdbRating) || 0,
    pop: Math.round((Number(m.popularity) || 0) * 100) / 100,
    anime: isAnime(genres, m.country),
  });
}

// Стрічку читаємо сторінками, доки не прийде неповна.
async function feed(type, list, genre) {
  for (let page = 0; page < MAX_PAGES; page++) {
    const extra = [genre && `genre=${encodeURIComponent(genre)}`, page && `skip=${page * PAGE}`].filter(Boolean).join('&');
    const metas = (await getJson(`/catalog/${type}/${list}${extra ? '/' + extra : ''}.json`)).metas || [];
    metas.forEach(m => take(m, type));
    if (metas.length < PAGE) break;
  }
}

const manifest = await getJson('/manifest.json');
const thisYear = new Date().getFullYear();
const jobs = [];
for (const type of ['series', 'movie']) {
  const years = manifest.catalogs.find(c => c.type === type && c.id === 'year')?.extra?.find(e => e.name === 'genre')?.options || [];
  for (const y of years) if (!SINCE || Number(y) > thisYear - SINCE) jobs.push([type, 'year', y]);
  jobs.push([type, 'top', ''], [type, 'imdbRating', ''], [type, 'top', 'Animation'], [type, 'imdbRating', 'Animation']);
}

// Часткове оновлення: спершу підтягуємо те, що вже було зібрано.
const files = { series: 'series.json', movie: 'movie.json', anime: 'anime.json' };
if (SINCE) {
  for (const f of [files.series, files.movie]) {
    try {
      const old = JSON.parse(await readFile(`${OUT}/${f}`, 'utf8'));
      for (const [id, title, year, g, imdb, pop, flags] of old.items) {
        found.set(id, { id, movie: !!(flags & 1), title, year, genres: g.map(i => old.genres[i]), imdb, pop, anime: !!(flags & 2) });
      }
    } catch { console.log(`немає попереднього ${f} — буде лише свіже`); }
  }
}
const before = found.size;

console.log(`стрічок: ${jobs.length}${SINCE ? ` (останні ${SINCE} р.)` : ''}`);
let done = 0;
await pool(jobs, async ([type, list, genre]) => {
  await feed(type, list, genre);
  if (++done % 25 === 0) console.log(`  ${done}/${jobs.length} стрічок, ${found.size} записів`);
});

const all = [...found.values()].sort((a, b) => b.pop - a.pop || b.imdb - a.imdb || a.id.localeCompare(b.id));
// Жанри — словником: у записі лишаються лише номери.
const genres = [...new Set(all.flatMap(x => x.genres))].sort();
const gi = new Map(genres.map((g, i) => [g, i]));
const pack = list => ({
  v: 1, at: Date.now(), genres,
  items: list.map(x => [x.id, x.title, x.year, x.genres.map(g => gi.get(g)), x.imdb, x.pop, (x.movie ? 1 : 0) | (x.anime ? 2 : 0)]),
});
const sets = { series: all.filter(x => !x.movie), movie: all.filter(x => x.movie), anime: all.filter(x => x.anime) };
// Порожній чи підозріло малий індекс не публікуємо: краще вчорашній.
if (sets.series.length < 1000 || sets.movie.length < 1000 || sets.anime.length < 200) {
  throw new Error(`замало даних: серіалів ${sets.series.length}, фільмів ${sets.movie.length}, аніме ${sets.anime.length}`);
}
await mkdir(OUT, { recursive: true });
for (const [k, list] of Object.entries(sets)) {
  const text = JSON.stringify(pack(list));
  await writeFile(`${OUT}/${files[k]}`, text);
  console.log(`${files[k]}: ${list.length} записів, ${(text.length / 1024).toFixed(0)} КБ`);
}
console.log(`запитів: ${requests}, записів: ${all.length} (було ${before})`);
