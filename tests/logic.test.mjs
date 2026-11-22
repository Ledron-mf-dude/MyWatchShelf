// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeUrl, parseInput, sanitize, mergeEntry, nextEpisode, progressText,
  filterSort, encodeRecs, decodeRecs, cleanRecs, fmtRating, statusLabel, kindLabel,
  episodesWatched, episodesTotal, progressPct, minutesWatched, insights, fmtRuntime, genreName,
  agenda, dayDiff, tasteMatch, matchTag, pickCandidates, listNames, recItem,
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
  assert.equal(sanitize({ id: 'tt1234567', score: 9.5 }).score, 9.5);
  assert.equal(sanitize({ id: 'tt1234567', score: 5.4 }).score, 5.5);
  assert.equal(sanitize({ id: 'tt1234567', score: 0.4 }).score, 0);
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
  const dated = [
    { id: 'tt1', title: 'A', year: '2019–2021', meta: { imdb: 8.4 } },
    { id: 'tt2', title: 'B', year: '2021', meta: { imdb: 6.9 } },
    { id: 'tt3', title: 'C', year: '2023', meta: {} },
  ];
  assert.deepEqual(filterSort(dated, { from: '2021' }, 'title', 1).map(e => e.id), ['tt2']);
  assert.deepEqual(filterSort(dated, { from: '2023', to: '2020' }, 'title', 1).map(e => e.id), ['tt2', 'tt3']);
  assert.deepEqual(filterSort(dated, { min: '7' }, 'title', 1).map(e => e.id), ['tt1']);
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

test('календар: свіжі, наступні й пропущені серії', () => {
  const DAY = 864e5, now = Date.UTC(2026, 10, 20, 12);
  const sched = {
    tt1: [{ s: 1, e: 1, d: now - 30 * DAY }, { s: 1, e: 2, d: now - 2 * DAY }, { s: 1, e: 3, d: now + 5 * DAY }, { s: 1, e: 4, d: now + 40 * DAY }],
    tt2: [{ s: 1, e: 1, d: now - 90 * DAY }, { s: 1, e: 2, d: now - 80 * DAY }, { s: 1, e: 3, d: now - 70 * DAY }],
    tt3: [{ s: 1, e: 1, d: now - 2 * DAY }],
    tt4: [{ s: 2, e: 1, d: now + DAY }],
  };
  const entries = [
    { id: 'tt1', type: 'series', status: 'watching', season: 1, episode: 1 },
    { id: 'tt2', type: 'series', status: 'paused', season: 1, episode: 1 },
    { id: 'tt3', type: 'series', status: 'planned', season: 1, episode: 0 },   // не дивлюсь — не в календарі
    { id: 'tt4', type: 'series', status: 'watching', season: 1, episode: 12 },
    { id: 'tt5', type: 'movie', status: 'watching' },
  ];
  const a = agenda(entries, sched, now);
  assert.deepEqual(a.fresh.map(r => [r.e.id, r.fresh.e, r.behind]), [['tt1', 2, 1]]);
  assert.deepEqual(a.upcoming.map(r => [r.e.id, r.next.s, r.next.e]), [['tt4', 2, 1], ['tt1', 1, 3]]);
  assert.deepEqual(a.behind.map(r => [r.e.id, r.behind]), [['tt2', 2]]);
  // усе наздогнав — зі «свіжих» зникає, наступна лишається
  const b = agenda([{ ...entries[0], episode: 2 }], sched, now);
  assert.equal(b.fresh.length, 0);
  assert.equal(b.upcoming[0].next.e, 3);
  assert.deepEqual(agenda(entries, {}, now), { fresh: [], upcoming: [], behind: [] });
});

test('різниця в календарних днях', () => {
  const now = new Date(2026, 10, 20, 23, 30).getTime();
  assert.equal(dayDiff(new Date(2026, 10, 20, 0, 5).getTime(), now), 0);
  assert.equal(dayDiff(new Date(2026, 10, 21, 0, 5).getTime(), now), 1);
  assert.equal(dayDiff(new Date(2026, 10, 19, 23, 59).getTime(), now), -1);
});

test('збіг смаків', () => {
  const mine = [{ id: 'tt1', score: 10 }, { id: 'tt2', score: 6 }, { id: 'tt3', score: 0 }];
  const items = [{ id: 'tt1', s: 10 }, { id: 'tt2', s: 9 }, { id: 'tt3', s: 8 }, { id: 'tt4', s: 7 }];
  const m = tasteMatch(mine, items);
  assert.equal(m.scored, 2);
  assert.equal(m.common, 3);
  assert.equal(m.unseen, 1);
  assert.equal(m.pct, 83);                       // середня різниця 1,5 з 9
  assert.deepEqual(m.rows.map(matchTag), ['match', 'differ', 'have', 'new']);
  assert.equal(tasteMatch([], items).pct, null);
  assert.equal(tasteMatch([{ id: 'tt1', score: 1 }], [{ id: 'tt1', s: 10 }]).pct, 0);
});

test('вибір на вечір: лише плани й пауза, фільтри', () => {
  const list = [
    { id: 'tt1', status: 'planned', kind: 'anime', meta: { runtime: '24 min', genres: ['Comedy'] } },
    { id: 'tt2', status: 'planned', kind: 'movie', meta: { runtime: '140 min', genres: ['Drama'] } },
    { id: 'tt3', status: 'paused', kind: 'series', meta: { runtime: '', genres: ['Comedy'] } },
    { id: 'tt4', status: 'done', kind: 'anime', meta: { runtime: '24 min', genres: ['Comedy'] } },
    { id: 'tt5', status: 'watching', kind: 'anime', meta: { runtime: '24 min' } },
  ];
  const ids = f => pickCandidates(list, f).map(e => e.id);
  assert.deepEqual(ids({}), ['tt1', 'tt2', 'tt3']);
  assert.deepEqual(ids({ max: 30 }), ['tt1']);      // без відомої тривалості під ліміт не підходить
  assert.deepEqual(ids({ kind: 'movie' }), ['tt2']);
  assert.deepEqual(ids({ genre: 'Comedy' }), ['tt1', 'tt3']);
  assert.deepEqual(ids({ max: 30, genre: 'Drama' }), []);
});

test('добірки: чистка, перелік, фільтр, публічний запис', async () => {
  const e = sanitize({ id: 'tt1234567', updated: 1, lists: [' A ', 'A', '', 5, 'x'.repeat(60), ...'bcdefghij'.split('')] });
  assert.equal(e.lists.length, 8);
  assert.equal(e.lists[0], 'A');
  assert.equal(e.lists[1].length, 40);
  assert.deepEqual(sanitize({ id: 'tt1234567', updated: 1 }).lists, []);
  const list = [
    { id: 'tt1', title: 'A', kind: 'anime', status: 'done', rec: true, lists: ['Вечір'] },
    { id: 'tt2', title: 'B', kind: 'movie', status: 'done', rec: false, lists: ['Вечір', 'Аніме'] },
    { id: 'tt3', title: 'C', kind: 'movie', status: 'done', rec: true },
  ];
  assert.deepEqual(listNames(list), ['Аніме', 'Вечір']);
  assert.deepEqual(filterSort(list, { list: 'Вечір' }, 'title', 1).map(x => x.id), ['tt1', 'tt2']);
  assert.deepEqual(recItem(list[1]).p, 0);
  assert.deepEqual(recItem(list[1]).l, ['Вечір', 'Аніме']);
  assert.ok(!('p' in recItem(list[0])) && !('l' in recItem(list[2])));
  // чужий документ: мітки чистяться, сміття відкидається
  const c = cleanRecs({ items: [{ id: 'tt1234567', t: 'X', p: 0, l: ['ok', 7, ''] }, { id: 'tt7654321', t: 'Y', p: 'zzz', l: 'nope' }] });
  assert.deepEqual(c.items[0].l, ['ok']);
  assert.equal(c.items[0].p, 0);
  assert.ok(!('p' in c.items[1]) && !('l' in c.items[1]));
  // знімок добірки несе її назву
  const back = await decodeRecs(await encodeRecs('Костя', [recItem({ ...list[1], id: 'tt1234567' })], 'Вечір'));
  assert.equal(back.title, 'Вечір');
  assert.equal(back.items[0].id, 'tt1234567');
});
