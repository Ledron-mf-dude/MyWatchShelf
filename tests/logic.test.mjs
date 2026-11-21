// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeUrl, parseInput, sanitize, mergeEntry, nextEpisode, progressText,
  filterSort, encodeRecs, decodeRecs, cleanRecs, plural,
} from '../js/logic.js';

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
  assert.deepEqual([1, 2, 5, 11, 21, 22].map(n => plural(n, 'запис', 'записи', 'записів')),
    ['запис', 'записи', 'записів', 'записів', 'запис', 'записи']);
});
