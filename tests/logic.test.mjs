// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeUrl, parseInput, sanitize, mergeEntry, nextEpisode, progressText,
  filterSort, encodeRecs, decodeRecs, cleanRecs, fmtRating, statusLabel, kindLabel,
  episodesWatched, episodesTotal, progressPct, minutesWatched, insights, fmtRuntime, genreName,
} from '../js/logic.js';
import { setLang, getLang, t, tn } from '../js/i18n.js';

// Основна частина тестів перевіряє українські підписи; англійські — окремо внизу.
setLang('uk');

test('safeUrl пускає лише http(s)', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('https://a.example/x'), 'https://a.example/x');
  assert.equal(safeUrl('uakino.me/film/1'), 'https://uakino.me/film/1');
  assert.equal(safeUrl('просто текст'), '');
});

test('parseInput: ID, посилання IMDb, чуже посилання, назва', () => {
  assert.deepEqual(parseInput('tt22248376'), { id: 'tt22248376' });
  assert.deepEqual(parseInput('https://www.imdb.com/title/tt0133093/?ref_=x'), { id: 'tt0133093' });
  const p = parseInput('https://site.example/anime/1234-frieren-beyond-journeys-end.html');
  assert.equal(p.query, 'frieren beyond journeys end');
  assert.equal(p.url, 'https://site.example/anime/1234-frieren-beyond-journeys-end.html');
  assert.deepEqual(parseInput('  відьмак '), { query: 'відьмак' });
});

test('sanitize відкидає сміття й чистить посилання', () => {
  assert.equal(sanitize({ id: 'x' }), null);
  const e = sanitize({ id: 'tt1234567', title: 'A', url: 'javascript:alert(1)', score: 99, status: 'нема', updated: 5 });
  assert.equal(e.url, '');
  assert.equal(e.score, 10);
  assert.equal(e.status, 'planned');
  assert.deepEqual(sanitize({ id: 'tt1234567', deleted: true, updated: 7, title: 'x' }), { id: 'tt1234567', deleted: true, updated: 7 });
});

test('злиття: свіжіше перемагає, при рівних — те, що приїхало', () => {
  const a = { id: 'tt1', score: 5, updated: 10 }, b = { id: 'tt1', score: 9, updated: 20 };
  assert.equal(mergeEntry(a, b).score, 9);
  assert.equal(mergeEntry(b, a).score, 9);
  assert.equal(mergeEntry({ ...a, updated: 20 }, b).score, 9);
  assert.equal(mergeEntry(undefined, b), b);
  assert.equal(mergeEntry(a, { id: 'tt1', deleted: true, updated: 30 }).deleted, true);
});

test('злиття: довідкове з IMDb їде окремо від людського', () => {
  const phone = { id: 'tt1', score: 9, updated: 20, meta: { imdb: 8 }, metaAt: 1 };
  const pc = { id: 'tt1', score: 0, updated: 10, meta: { imdb: 8.5 }, metaAt: 50 };
  const m = mergeEntry(phone, pc);
  assert.equal(m.score, 9);
  assert.equal(m.meta.imdb, 8.5);
  assert.equal(m.metaAt, 50);
});

test('+1 серія: наступна, новий сезон, кінець серіалу', () => {
  const base = { type: 'series', status: 'planned', season: 1, episode: 0, meta: { seasons: { 1: 2, 2: 3 }, state: 'Ended' } };
  assert.deepEqual(nextEpisode(base), { episode: 1, status: 'watching' });
  assert.deepEqual(nextEpisode({ ...base, status: 'watching', episode: 2 }), { season: 2, episode: 1 });
  assert.deepEqual(nextEpisode({ ...base, status: 'watching', season: 2, episode: 2 }), { episode: 3, status: 'done' });
  assert.deepEqual(nextEpisode({ ...base, status: 'watching', season: 2, episode: 3 }), { status: 'done' });
  const ongoing = { ...base, status: 'watching', season: 2, episode: 3, meta: { seasons: { 1: 2, 2: 3 }, state: 'Continuing' } };
  assert.deepEqual(nextEpisode(ongoing), {});
  assert.deepEqual(nextEpisode({ type: 'series', status: 'watching', season: 1, episode: 7 }), { episode: 8 });
});

test('підпис прогресу', () => {
  assert.equal(progressText({ type: 'movie' }), '');
  assert.equal(progressText({ type: 'series', status: 'planned', season: 1, episode: 0 }), '');
  assert.equal(progressText({ type: 'series', status: 'watching', season: 2, episode: 5, meta: { seasons: { 2: 12 } } }), 'сезон 2 · серія 5/12');
});

test('фільтр і сортування', () => {
  const list = [
    { id: 'tt1', title: 'Б', kind: 'anime', status: 'watching', score: 7, updated: 1, rec: true },
    { id: 'tt2', title: 'А', kind: 'movie', status: 'done', score: 9, updated: 2 },
  ];
  assert.deepEqual(filterSort(list, { kind: 'anime', status: 'all' }, 'score', -1).map(e => e.id), ['tt1']);
  assert.deepEqual(filterSort(list, { kind: 'all', status: 'rec' }, 'score', -1).map(e => e.id), ['tt1']);
  assert.deepEqual(filterSort(list, { kind: 'all', status: 'all' }, 'score', -1).map(e => e.id), ['tt2', 'tt1']);
  assert.deepEqual(filterSort(list, { kind: 'all', status: 'all' }, 'title', 1).map(e => e.id), ['tt2', 'tt1']);
  assert.deepEqual(filterSort(list, { q: 'фільм' }, 'updated', -1).map(e => e.id), ['tt2']);
});

test('рекомендації в посиланні: туди й назад', async () => {
  const items = [{ id: 'tt22248376', k: 'anime', t: 'Фрірен <b>', y: '2023–', s: 10, n: 'Найкраще за роки', r: 8.9 }];
  const text = await encodeRecs('Костя', items);
  assert.match(text, /^[\w-]+$/);
  assert.deepEqual(await decodeRecs(text), { name: 'Костя', items });
});

test('чужий список чиститься', () => {
  const r = cleanRecs({ name: 5, items: [{ id: 'bad' }, { id: 'tt1234567', k: '?', s: 55, t: 'X' }] });
  assert.equal(r.name, '');
  assert.deepEqual(r.items, [{ id: 'tt1234567', k: 'series', t: 'X', y: '', s: 10, n: '', r: 0 }]);
});

test('множина', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22].map(n => tn('entry', n)),
    ['запис', 'записи', 'записів', 'записів', 'запис', 'записи']);
});

test('прогрес по серіях', () => {
  const e = { type: 'series', kind: 'anime', status: 'watching', season: 2, episode: 3, meta: { seasons: { 1: 12, 2: 8 }, runtime: '25 min' } };
  assert.equal(episodesWatched(e), 15);
  assert.equal(episodesTotal(e), 20);
  assert.equal(progressPct(e), 75);
  assert.equal(minutesWatched(e), 375);
  assert.equal(progressPct({ ...e, status: 'done' }), 100);
  assert.equal(progressPct({ type: 'movie', status: 'planned' }), 0);
  assert.equal(minutesWatched({ type: 'movie', status: 'done', meta: { runtime: '136 min' } }), 136);
  assert.equal(minutesWatched({ type: 'movie', status: 'planned', meta: { runtime: '136 min' } }), 0);
});

test('статистика полиці', () => {
  const list = [
    { id: 'tt1', kind: 'anime', type: 'series', status: 'watching', season: 1, episode: 4, score: 9, rec: true, meta: { imdb: 8.5, genres: ['Animation', 'Drama'], seasons: { 1: 12 }, runtime: '30 min' } },
    { id: 'tt2', kind: 'movie', type: 'movie', status: 'done', score: 6, meta: { imdb: 8.6, genres: ['Drama'], runtime: '120 min' } },
    { id: 'tt3', kind: 'movie', type: 'movie', status: 'planned', score: 0, meta: { genres: ['Comedy'] } },
  ];
  const s = insights(list);
  assert.equal(s.total, 3);
  assert.equal(s.minutes, 240);
  assert.equal(s.episodes, 4);
  assert.equal(s.rated, 2);
  assert.equal(s.avg, 7.5);
  assert.equal(s.rec, 1);
  assert.deepEqual(s.genres[0], ['Drama', 2]);
  assert.equal(s.scores[8], 1);
  assert.deepEqual(s.byKind, { anime: 1, movie: 2 });
  assert.equal(s.gaps[0].e.id, 'tt2');
});

test('фільтр за жанрами й пошук українською назвою жанру', () => {
  const list = [
    { id: 'tt1', title: 'A', kind: 'anime', status: 'done', meta: { genres: ['Fantasy'] } },
    { id: 'tt2', title: 'B', kind: 'movie', status: 'done', meta: { genres: ['Drama'] } },
  ];
  assert.deepEqual(filterSort(list, { genres: ['Fantasy'] }, 'title', 1).map(e => e.id), ['tt1']);
  assert.deepEqual(filterSort(list, { q: 'фентезі' }, 'title', 1).map(e => e.id), ['tt1']);
  assert.deepEqual(filterSort(list, { genres: [] }, 'title', 1).length, 2);
});

test('підписи: тривалість і жанри', () => {
  assert.equal(fmtRuntime('25 min'), '25 хв');
  assert.equal(fmtRuntime('155 min'), '2 год 35 хв');
  assert.equal(fmtRuntime('120 min'), '2 год');
  assert.equal(fmtRuntime(''), '');
  assert.equal(genreName('Sci-Fi'), 'фантастика');
  assert.equal(genreName('Unknown Thing'), 'unknown thing');
});

test('sanitize: трейлер лише як ідентифікатор YouTube', () => {
  const ok = sanitize({ id: 'tt1234567', updated: 1, meta: { trailer: 'VFkjBy2b50Q' } });
  assert.equal(ok.meta.trailer, 'VFkjBy2b50Q');
  const bad = sanitize({ id: 'tt1234567', updated: 1, meta: { trailer: '"><script>' } });
  assert.equal(bad.meta.trailer, '');
});

test('англійська — мова за замовчуванням: підписи, множина, числа', () => {
  setLang('en');
  try {
    assert.equal(getLang(), 'en');
    assert.equal(t('nav.library'), 'Library');
    assert.equal(statusLabel('watching'), 'Watching');
    assert.equal(kindLabel('movie'), 'movie');
    assert.deepEqual([0, 1, 2, 21].map(n => tn('episode', n)), ['episodes', 'episode', 'episodes', 'episodes']);
    assert.equal(progressText({ type: 'series', status: 'watching', season: 2, episode: 5, meta: { seasons: { 2: 12 } } }), 'season 2 · episode 5/12');
    assert.equal(fmtRuntime('155 min'), '2 h 35 min');
    assert.equal(fmtRating(8.9), '8.9');
    assert.equal(genreName('Sci-Fi'), 'Sci-Fi');
    assert.equal(t('toast.added', { title: 'Dune' }), '“Dune” added to your list');
    // пошук знаходить жанр і англійською, і українською, хоч би яка мова стояла
    const list = [{ id: 'tt1', title: 'A', kind: 'anime', status: 'done', meta: { genres: ['Fantasy'] } }];
    assert.equal(filterSort(list, { q: 'fantasy' }, 'title', 1).length, 1);
    assert.equal(filterSort(list, { q: 'фентезі' }, 'title', 1).length, 1);
  } finally { setLang('uk'); }
});

test('невідома мова чи ключ не ламають інтерфейс', () => {
  setLang('xx');
  assert.equal(getLang(), 'en');
  assert.equal(t('no.such.key'), 'no.such.key');
  setLang('uk');
  assert.equal(fmtRating(8.9), '8,9');
});
