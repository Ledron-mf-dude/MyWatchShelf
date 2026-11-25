// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSynced, defId } from '../js/synced.js';
import { sanitize, filterSort } from '../js/logic.js';
import { cleanListFilter, isEmptyFilter, listDiff, publicOver, cleanListDef, cleanReply, cleanFriend, snapId, friendTable, newReplyAuthors, unseenCount, seenStamp, SKEW, replyItem, replyMode, shelfScores, returnHash, cleanPrefs, isUid, replyPatch, replyWrite, recsMissing, recsFor, needsKeep, addList, seenAtOf, canWrite } from '../js/social.js';

test('synced: свіжіше перемагає, видалене лишається міткою', () => {
  const s = makeSynced('t1', r => (typeof r?.id === 'string' ? r : null));
  s.save('a', { v: 1 });
  const at = s.get('a').updated;
  assert.equal(s.applyRemote([{ id: 'a', v: 2, updated: at - 1 }]), false);
  assert.equal(s.get('a').v, 1);
  assert.equal(s.applyRemote([{ id: 'a', v: 3, updated: at + 1 }]), true);
  assert.equal(s.get('a').v, 3);
  s.remove('a');
  assert.equal(s.get('a'), null);
  assert.equal(s.raw().length, 1);
  assert.equal(s.raw()[0].deleted, true);
  assert.equal(s.applyRemote([{ id: 'x' }, null, { v: 1 }]), true);   // без id відкидається
  assert.equal(s.list().length, 1);
});
test('defId безпечний для назв із / і крапками', () => {
  assert.equal(defId('.'), 'l_.');
  assert.equal(defId('a/b'), 'l_a%2Fb');
  assert.ok(!defId('..').includes('/') && defId('..') !== '..');
});

test('synced: мітка видалення з нечисловим updated не перекриває свіжий локальний запис', () => {
  const s = makeSynced('t2', r => (typeof r?.id === 'string' ? r : null));
  s.save('a', { v: 1 });
  assert.equal(s.applyRemote([{ id: 'a', deleted: true, updated: 'рядок' }]), false);
  assert.equal(s.get('a').v, 1);
});

const E = (id, o = {}) => sanitize({ id, title: id, kind: 'series', updated: 1, ...o });
test('filterSort: кілька типів одночасно', () => {
  const list = [E('tt0000001', { kind: 'anime' }), E('tt0000002', { kind: 'movie', type: 'movie' }), E('tt0000003')];
  assert.deepEqual(filterSort(list, { kinds: ['anime', 'series'] }, 'title', 1).map(e => e.id), ['tt0000001', 'tt0000003']);
  assert.equal(filterSort(list, { kinds: [] }, 'title', 1).length, 3);
});
test('cleanListFilter відкидає невідоме', () => {
  const f = cleanListFilter({ kinds: ['anime', 'x'], status: 'нема', mine: '99', genres: 'не масив', from: 2020 });
  assert.deepEqual(f, { kinds: ['anime'], from: '2020', to: '', status: 'all', genres: [], mine: '' });
  assert.equal(isEmptyFilter(cleanListFilter({})), true);
  assert.equal(isEmptyFilter(f), false);
});
test('listDiff: що додати, що прибрати, що пропустити', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const list = [
    E('tt0000001', { kind: 'anime', year: '2024' }),
    E('tt0000002', { kind: 'anime', year: '2019', lists: ['Нові'] }),
    E('tt0000003', { kind: 'anime', year: '2025', lists: ['Нові'] }),
    E('tt0000004', { kind: 'anime', year: '2025', lists: full }),
  ];
  const d = listDiff(list, 'Нові', cleanListFilter({ kinds: ['anime'], from: '2024', to: '2025' }));
  assert.deepEqual(d.add.map(e => e.id), ['tt0000001']);
  assert.deepEqual(d.drop.map(e => e.id), ['tt0000002']);
  assert.deepEqual(d.skip.map(e => e.id), ['tt0000004']);
});
test('publicOver рахує лише нові публікації', () => {
  const list = Array.from({ length: 499 }, (_, i) => E('tt' + String(1000000 + i), { rec: true }));
  list.push(E('tt2000001'), E('tt2000002'), E('tt2000003', { rec: true }));
  assert.equal(publicOver(list, ['tt2000003']), 0);              // уже опублікований
  assert.equal(publicOver(list, ['tt2000001', 'tt2000002']), 2);
});
test('cleanListDef: id мусить збігатися з назвою', () => {
  const ok = { id: defId('Нові'), name: 'Нові', f: { kinds: ['anime'] }, updated: 5 };
  assert.deepEqual(cleanListDef(ok), { ...ok, f: cleanListFilter(ok.f) });
  assert.equal(cleanListDef({ ...ok, id: 'l_інше' }), null);
  assert.equal(cleanListDef({ id: 'x' }), null);
});

test('cleanReply чистить сміття й тримає межі', () => {
  const big = Object.fromEntries(Array.from({ length: 600 }, (_, i) => ['tt' + String(1000000 + i), { s: 7 }]));
  assert.equal(Object.keys(cleanReply({ items: big }).items).length, 500);
  const r = cleanReply({ name: 'x'.repeat(200), updated: '5', items: {
    tt0000001: { s: 99, n: 'y'.repeat(10000), t: 'A', k: 'нема', y: 2020, at: 3 },
    'нема': { s: 5 }, tt0000002: { s: 0, n: '' }, tt0000003: 'рядок', tt0000004: { s: 0, n: 'лише слова' },
  } });
  assert.equal(r.name.length, 80);
  assert.deepEqual(Object.keys(r.items), ['tt0000001', 'tt0000004']);
  assert.deepEqual(r.items.tt0000001, { s: 10, n: 'y'.repeat(500), at: 3, t: 'A', k: 'series', y: '2020' });
  assert.equal(r.items.tt0000004.t, 'tt0000004');   // порожня назва → id, щоб таблиця не мала порожніх рядків
  assert.deepEqual(cleanReply(null), { name: '', items: {}, updated: 0 });
});
test('cleanReply: вороже введення не ламає прототип, оцінки й масив', () => {
  const evil = cleanReply(JSON.parse('{"items":{"__proto__":{"s":5},"constructor":{"s":5}}}'));
  assert.deepEqual(Object.keys(evil.items), []);
  assert.equal({}.s, undefined);   // Object.prototype не забруднено
  const sc = v => cleanReply({ items: { tt0000001: { s: v, n: 'ок' } } }).items.tt0000001.s;
  assert.equal(sc(NaN), 0); assert.equal(sc(-3), 0); assert.equal(sc('8'), 8);
  assert.equal(sc(0.7), 0); assert.equal(sc(7.3), 7.5); assert.equal(sc(null), 0); assert.equal(sc('abc'), 0);
  assert.deepEqual(cleanReply({ items: [{ s: 5, id: 'tt0000001' }] }).items, {});
});
test('replyItem збирає елемент відповіді з рекомендації', () => {
  assert.deepEqual(replyItem({ id: 'tt0000001', k: 'movie', t: 'Фільм', y: '2001' }, 7.5, 'ок', 42),
    { s: 7.5, n: 'ок', at: 42, t: 'Фільм', k: 'movie', y: '2001' });
});
test('replyMode: власне посилання і знімок — без оцінювання', () => {
  assert.equal(replyMode({ ownerUid: '', meUid: 'a', signedIn: true }), 'none');
  assert.equal(replyMode({ ownerUid: 'a', meUid: 'a', signedIn: true }), 'none');
  assert.equal(replyMode({ ownerUid: 'a', meUid: '', signedIn: false }), 'signin');
  assert.equal(replyMode({ ownerUid: 'a', meUid: 'b', signedIn: true }), 'rate');
});
test('shelfScores бере лише оцінені тайтли зі списку', () => {
  const mine = [E('tt0000001', { score: 8.5 }), E('tt0000002'), E('tt0000009', { score: 6 })];
  assert.deepEqual(shelfScores(mine, [{ id: 'tt0000001' }, { id: 'tt0000002' }, { id: 'tt0000003' }]), { tt0000001: 8.5 });
});
test('returnHash пускає лише адресу списку', () => {
  assert.equal(returnHash('#u=abcDEF_12-3'), '#u=abcDEF_12-3');
  assert.equal(returnHash('#u=abc&l=%D0%9D%D0%BE%D0%B2%D1%96'), '#u=abc&l=%D0%9D%D0%BE%D0%B2%D1%96');
  assert.equal(returnHash('#id_token=x&state=y'), '');
  assert.equal(returnHash('#u=abc&x=1'), '');
  assert.equal(returnHash('#/library'), '');
});
test('returnHash відкидає задовгі й нерядкові значення', () => {
  assert.equal(returnHash('#u=' + 'a'.repeat(129)), '');
  assert.equal(returnHash('#u=abc&l=' + 'x'.repeat(401)), '');
  assert.equal(returnHash('#u=abc&l=' + 'x'.repeat(400)), '#u=abc&l=' + 'x'.repeat(400));
  assert.equal(returnHash(null), '');
});
test('cleanPrefs: два записи, кожен лише зі своїм полем', () => {
  assert.deepEqual(cleanPrefs({ id: 'social', open: 1, updated: 7, junk: 'x' }), { id: 'social', open: true, updated: 7 });
  assert.deepEqual(cleanPrefs({ id: 'social', open: 'так', seenAt: 'abc' }), { id: 'social', open: true, updated: 0 });
  assert.equal(cleanPrefs({ id: 'social', open: 0 }).open, false);
  assert.deepEqual(cleanPrefs({ id: 'seen', seenAt: 5, open: true, updated: 7, junk: 1 }), { id: 'seen', seenAt: 5, updated: 7 });
  assert.deepEqual(cleanPrefs({ id: 'seen', seenAt: 'abc' }), { id: 'seen', seenAt: 0, updated: 0 });
  assert.equal(cleanPrefs({ id: 'other', open: true }), null);
  assert.equal(cleanPrefs({ id: 'constructor' }), null);
  assert.equal(cleanPrefs(null), null);
  // запис старої форми: seenAt у social лишається лише щоб його можна було прочитати
  assert.deepEqual(cleanPrefs({ id: 'social', open: 0, seenAt: 5, updated: 7 }), { id: 'social', open: false, seenAt: 5, updated: 7 });
});
test('seenAtOf: власний запис seen, а без нього — стара позначка з social', () => {
  assert.equal(seenAtOf({ id: 'seen', seenAt: 9 }, { id: 'social', seenAt: 5 }), 9);
  assert.equal(seenAtOf({ id: 'seen', seenAt: 0 }, { id: 'social', seenAt: 5 }), 0);
  assert.equal(seenAtOf(null, { id: 'social', open: true, seenAt: 5 }), 5);
  assert.equal(seenAtOf(null, { id: 'social', open: true }), 0);
  assert.equal(seenAtOf(null, null), 0);
});
test('canWrite: без входу — завжди, з входом — лише після першої синхронізації', () => {
  assert.equal(canWrite(false, false), true);
  assert.equal(canWrite(true, false), false);
  assert.equal(canWrite(true, true), true);
});

const F = (id, o = {}) => cleanFriend({ id, uid: id, name: id, kind: 'live', follow: false, added: 1, updated: 1, ...o });
const R = (name, items) => cleanReply({ name, updated: 10, items });
test('friendTable: відповідь має перевагу, ★ — з рекомендацій, одна людина — один стовпець', () => {
  const tb = friendTable({
    entries: [E('tt0000001', { score: 10 })],
    friends: [F('oleh', { follow: true }), F('ira', { added: 2 })],
    replies: { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }), ira: R('Іра', { tt0000001: { s: 9.5, t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6 }, { id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] },
  });
  assert.deepEqual(tb.cols.map(c => c.name), ['Олег', 'Іра']);
  const a = tb.rows.find(r => r.id === 'tt0000001'), b = tb.rows.find(r => r.id === 'tt0000002');
  assert.deepEqual(a.cells.oleh, { s: 8, n: '', rec: true });
  assert.equal(a.avg, 8.8); assert.equal(a.mine, 10); assert.equal(a.have, true);
  assert.deepEqual(b.cells.oleh, { s: 9, n: '', rec: true });
  assert.equal(b.have, false); assert.equal(b.cells.ira, undefined);
  assert.deepEqual(tb.rows.map(r => r.id), ['tt0000002', 'tt0000001']);
});
test('видалений друг не повертається, коли відповідає знову', () => {
  const friends = [{ id: 'oleh', deleted: true, updated: 5 }];
  const replies = { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }) };
  assert.deepEqual(newReplyAuthors(friends, replies), []);
  assert.equal(friendTable({ entries: [], friends, replies, recs: {} }).rows.length, 0);
  assert.deepEqual(newReplyAuthors([], replies), ['oleh']);
});
test('рекомендації без follow не читаються; понад 100 друзів ховаються', () => {
  const tb = friendTable({ entries: [], friends: [F('oleh')], replies: {}, recs: { oleh: [{ id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] } });
  assert.equal(tb.rows.length, 0);
  const many = Array.from({ length: 103 }, (_, i) => F('u' + i, { added: i }));
  const big = friendTable({ entries: [], friends: many, replies: {}, recs: {} });
  assert.equal(big.cols.length, 100); assert.equal(big.hidden, 3); assert.equal(big.cols[0].id, 'u0');
});
test('recsMissing: лише живі друзі з follow, чиїх рекомендацій ще немає в кеші', () => {
  const friends = [F('oleh', { follow: true }), F('ira', { follow: true }), F('max'), { id: 'gone', deleted: true, updated: 1 },
    cleanFriend({ id: 's00000001', kind: 'snap', follow: true, items: [] }), F('constructor', { follow: true })];
  assert.deepEqual(recsMissing(friends, { oleh: [] }).map(f => f.id), ['ira', 'constructor']);
  assert.deepEqual(recsMissing([], {}), []);
});
test('snapId стабільний і залежить від вмісту', () => {
  const a = snapId('Олег', [{ id: 'tt0000002' }, { id: 'tt0000001' }]);
  assert.equal(a, snapId('Олег', [{ id: 'tt0000001' }, { id: 'tt0000002' }]));
  assert.notEqual(a, snapId('Іра', [{ id: 'tt0000001' }, { id: 'tt0000002' }]));
  assert.match(a, /^s[0-9a-f]{8}$/);
});
test('unseenCount рахує лише свіжіші за останній перегляд', () => {
  const friends = [F('oleh'), F('ira')], replies = { oleh: R('Олег', { tt0000001: { s: 8 } }) };
  const tb = friendTable({ entries: [], friends, replies, recs: {} });
  assert.equal(unseenCount(tb, replies, 5), 1);
  assert.equal(unseenCount(tb, replies, 10), 0);
});

test('seenStamp: майбутня відповідь гасить «нове» за один запис, без відповідей — now', () => {
  const friends = [F('oleh')], replies = { oleh: { ...R('Олег', { tt0000001: { s: 8 } }), updated: 9000 } };
  const tb = friendTable({ entries: [], friends, replies, recs: {} });
  assert.equal(seenStamp(tb, replies, 100), 9000);
  assert.equal(unseenCount(tb, replies, seenStamp(tb, replies, 100)), 0);
  assert.equal(seenStamp(tb, {}, 100), 100);
});

test('мітка часу з майбутнього обрізається при очищенні й не глушить «нове»', () => {
  const now = 1000, c = cleanReply({ updated: 1e15, items: { tt0000001: { s: 5, at: 1e15 } } }, now);
  assert.equal(c.updated, now + SKEW);
  assert.equal(c.items.tt0000001.at, now + SKEW);
  assert.equal(cleanReply({ updated: -5 }, now).updated, 0);
  const friends = [F('oleh')], replies = { oleh: c };
  const tb = friendTable({ entries: [], friends, replies, recs: {} });
  const stamp = seenStamp(tb, replies, now);
  assert.ok(stamp <= now + SKEW);
  assert.equal(unseenCount(tb, replies, stamp), 0);
  // справжня відповідь пізніше (now2 далеко за межею першої) знову «нова»
  const now2 = now + 3 * SKEW, later = cleanReply({ updated: now2, items: { tt0000001: { s: 5 } } }, now2);
  assert.equal(unseenCount(tb, { oleh: later }, stamp), 1);
  assert.equal(cleanPrefs({ id: 'seen', seenAt: 1e15 }, now).seenAt, now + SKEW);
  assert.equal(cleanPrefs({ id: 'social', seenAt: 1e15 }, now).seenAt, now + SKEW);   // стара форма — та сама межа
});

test('isUid: лише звичайні ідентифікатори', () => {
  assert.equal(isUid('abc_DEF-123'), true);
  for (const bad of ['', 'a/b', 'a'.repeat(129), null, 5]) assert.equal(isUid(bad), false);
  assert.equal(isUid('a'.repeat(128)), true);
});
test('replyPatch: у set — нове й змінене, у del — прибране, решту не чіпаємо', () => {
  const it = (s, n = '') => ({ s, n, at: 1, t: 'A', k: 'movie', y: '2001' });
  const prev = { tt0000001: it(7), tt0000002: it(8), tt0000003: it(5) };
  const next = { tt0000001: it(7), tt0000002: it(9), tt0000004: it(6, 'ок'), bad: it(5), tt0000005: { s: 0, n: '' } };
  const p = replyPatch(prev, next);
  assert.deepEqual(Object.keys(p.set), ['tt0000002', 'tt0000004']);
  assert.deepEqual(p.set.tt0000004, it(6, 'ок'));
  assert.deepEqual(p.del, ['tt0000003']);
  assert.deepEqual(replyPatch(prev, prev), { set: {}, del: [] });
  assert.deepEqual(replyPatch(null, null), { set: {}, del: [] });
  // елементи чистяться так само, як у cleanReply
  const dirty = { tt0000001: { s: 99, n: 'y'.repeat(600), k: 'нема', y: 2020, at: 3 } };
  assert.deepEqual(replyPatch({}, dirty).set, cleanReply({ items: dirty }).items);
  // службові слова як ключі не стають ні записом, ні видаленням
  assert.deepEqual(replyPatch({}, JSON.parse('{"__proto__":{"s":5},"constructor":{"s":5}}')), { set: {}, del: [] });
  assert.deepEqual(replyPatch(JSON.parse('{"constructor":{"s":5},"bad":{"s":5}}'), {}), { set: {}, del: [] });
});
test('replyWrite: підпис заданий викликачем, видалене — міткою, чужого імені немає', () => {
  const DEL = Symbol('del');
  const w = replyWrite({ name: 'Google Name', set: { tt0000001: { s: 7, n: 'ок', t: 'Ф', k: 'movie', y: '2001', at: 2 }, bad: { s: 5 } }, del: ['tt0000002', 'нема', '__proto__', 5] }, 'Підпис', 5, DEL);
  assert.deepEqual(Object.keys(w).sort(), ['items', 'name', 'updated']);
  assert.equal(w.name, 'Підпис');
  assert.equal(w.updated, 5);
  assert.deepEqual(Object.keys(w.items), ['tt0000001', 'tt0000002']);
  assert.deepEqual(w.items.tt0000001, { s: 7, n: 'ок', at: 2, t: 'Ф', k: 'movie', y: '2001' });
  assert.equal(w.items.tt0000002, DEL);
  assert.equal(replyWrite({ set: {}, del: ['tt0000002'] }, 'x'.repeat(100), 1, DEL).name.length, 80);
  // порожня різниця — писати нічого: порожня мапа items при об'єднанні стерла б усю відповідь
  assert.equal(replyWrite({ set: {}, del: [] }, 'x', 1, DEL), null);
  assert.equal(replyWrite({ set: { bad: { s: 5 } }, del: ['нема'] }, 'x', 1, DEL), null);
  assert.equal(replyWrite(null, 'x', 1, DEL), null);
  // тайтл і в set, і в del: перемагає запис (видалення не стирає щойно поставлену оцінку)
  assert.deepEqual(replyWrite({ set: { tt0000001: { s: 7 } }, del: ['tt0000001'] }, '', 1, DEL).items.tt0000001.s, 7);
});

test('cleanFriend: службові слова й сміття як ідентифікатор', () => {
  assert.equal(cleanFriend({ id: '__proto__', uid: '__proto__', kind: 'live' }), null);
  assert.equal(cleanFriend({ id: 'a b' }), null);
  assert.equal(cleanFriend({ id: 'a/b' }), null);
  assert.equal(cleanFriend({ id: 'x'.repeat(129) }), null);
  assert.equal(cleanFriend({ id: 'constructor' }).id, 'constructor');
});
test('cleanFriend: lists — назви добірок без сміття й повторів, не більше 8', () => {
  assert.deepEqual(F('oleh').lists, []);
  assert.deepEqual(cleanFriend({ id: 'oleh', lists: 'не масив' }).lists, []);
  assert.deepEqual(cleanFriend({ id: 'oleh', lists: ['Нові', 'Нові', '', 5, 'x'.repeat(60), null] }).lists, ['Нові', 'x'.repeat(40)]);
  assert.equal(cleanFriend({ id: 'oleh', lists: Array.from({ length: 12 }, (_, i) => 'л' + i) }).lists.length, 8);
  assert.deepEqual(cleanFriend({ id: 's00000001', kind: 'snap', items: [] }).lists, []);
});
test('addList: нова назва в кінець, без повторів, лишаються останні 8', () => {
  assert.deepEqual(addList([], 'Нові'), ['Нові']);
  assert.deepEqual(addList(['Нові'], 'Нові'), ['Нові']);
  assert.deepEqual(addList(['Нові'], ''), ['Нові']);
  assert.deepEqual(addList(undefined, ''), []);
  const full = Array.from({ length: 8 }, (_, i) => 'л' + i);
  assert.deepEqual(addList(full, 'Нові'), [...full.slice(1), 'Нові']);
});
test('recsFor: загальні рекомендації й лише ті добірки, що надіслані мені', () => {
  const items = [{ id: 'tt0000001' }, { id: 'tt0000002', p: 0, l: ['Нові'] }, { id: 'tt0000003', p: 0, l: ['Чужа'] },
    { id: 'tt0000004', l: ['Чужа'] }, { id: 'tt0000005', p: 0 }];
  const ids = f => recsFor(f, items).map(x => x.id);
  assert.deepEqual(ids(F('oleh')), ['tt0000001', 'tt0000004']);
  assert.deepEqual(ids(F('oleh', { lists: ['Нові'] })), ['tt0000001', 'tt0000002', 'tt0000004']);
  assert.deepEqual(ids({ id: 'без-lists' }), ['tt0000001', 'tt0000004']);
  assert.deepEqual(ids(null), ['tt0000001', 'tt0000004']);
  assert.deepEqual(recsFor(F('oleh'), undefined), []);
});
test('friendTable: тайтл лише з чужої добірки не показується як «радив»', () => {
  const recs = { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6 }, { id: 'tt0000002', t: 'B', k: 'anime', s: 9, n: 'не мені', p: 0, l: ['Нові'] }] };
  const rows = f => friendTable({ entries: [], friends: [f], replies: {}, recs }).rows.map(r => r.id).sort();
  assert.deepEqual(rows(F('oleh', { follow: true })), ['tt0000001']);
  assert.deepEqual(rows(F('oleh', { follow: true, lists: ['Нові'] })), ['tt0000001', 'tt0000002']);
});
test('needsKeep: коли на сторінці друга потрібна кнопка «Запам’ятати»', () => {
  assert.equal(needsKeep(null, ''), true);                                      // ще не друг
  assert.equal(needsKeep(F('oleh'), ''), true);                                 // додався сам, бо відповів
  assert.equal(needsKeep(F('oleh', { follow: true }), ''), false);
  assert.equal(needsKeep(F('oleh', { follow: true }), 'Нові'), true);           // цієї добірки ще не запам'ятали
  assert.equal(needsKeep(F('oleh', { follow: true, lists: ['Нові'] }), 'Нові'), false);
  assert.equal(needsKeep(cleanFriend({ id: 's00000001', kind: 'snap', items: [] }), 'Нові'), false);
});
test('friendTable: id «constructor» і «toString» не ламають зведення', () => {
  const snap = cleanFriend({ id: 'toString', kind: 'snap', name: 'Знімок', follow: true, added: 2, items: [{ id: 'tt0000003', t: 'C', k: 'movie', s: 7 }] });
  const tb = friendTable({
    entries: [],
    friends: [F('constructor', { follow: true, name: 'Свій' }), snap],
    replies: {},
    recs: {},
  });
  assert.deepEqual(tb.cols.map(c => c.name), ['Свій', 'Знімок']);
  assert.equal(tb.rows.length, 1);
  assert.deepEqual(tb.rows[0].cells.toString, { s: 7, n: '', rec: true });
  const tb2 = friendTable({
    entries: [], friends: [F('constructor', { follow: true, name: 'Свій' }), F('valueOf', { name: 'Інший' })],
    replies: { valueOf: R('Ім', { tt0000001: { s: 6, t: 'A' } }) },
    recs: { constructor: [{ id: 'tt0000001', t: 'A', k: 'series', s: 8 }] },
  });
  assert.deepEqual(tb2.cols.map(c => c.name), ['Свій', 'Ім']);
  assert.equal(tb2.rows[0].avg, 7); assert.equal(tb2.rows[0].n, 2);
  assert.equal(unseenCount(tb2, {}, 0), 0);
});
test('friendTable: однаковий added розрізняє id; чужа відповідь без запису — без стовпця', () => {
  const many = Array.from({ length: 102 }, (_, i) => F('u' + String(i).padStart(3, '0'), { added: 1 }));
  const a = friendTable({ entries: [], friends: many, replies: {}, recs: {} });
  const b = friendTable({ entries: [], friends: [...many].reverse(), replies: {}, recs: {} });
  assert.deepEqual(a.cols, b.cols);
  const st = friendTable({ entries: [], friends: [], replies: { x: R('Хтось', { tt0000001: { s: 5 } }) }, recs: {} });
  assert.equal(st.cols.length, 0); assert.equal(st.rows.length, 0);
});
test('friendTable: знімок і відповідь лише з коментарем', () => {
  const snap = cleanFriend({ id: 's00000001', kind: 'snap', name: 'Знімок', items: [{ id: 'tt0000005', t: 'E', k: 'anime', s: 9 }] });
  const tb = friendTable({ entries: [], friends: [snap], replies: {}, recs: {} });
  assert.deepEqual(tb.rows[0].cells.s00000001, { s: 9, n: '', rec: true });
  // відповідь без оцінки, але з текстом: оцінка — з рекомендації, коментар лишається
  const c = friendTable({
    entries: [], friends: [F('oleh', { follow: true })],
    replies: { oleh: R('Олег', { tt0000001: { s: 0, n: 'текст', t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6 }] },
  });
  assert.deepEqual(c.rows[0].cells.oleh, { s: 6, n: 'текст', rec: true });
});
test('synced: id __proto__ відкидається скрізь', () => {
  const s = makeSynced('t3', r => (typeof r?.id === 'string' ? r : null));
  assert.equal(s.save('__proto__', { v: 1 }), null);
  assert.equal(s.applyRemote([{ id: '__proto__', v: 1 }, { id: '__proto__', deleted: true }]), false);
  s.remove('__proto__');
  assert.equal(s.raw().length, 0);
  assert.equal({}.v, undefined);
});

test('socialCache: читання очищає, set замінює лише свою частину, clear стирає все', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  try {
    const { socialCache } = await import('../js/synced.js');
    // у сховищі лежить сміття: відповідь з чужим ключем і рекомендація без справжнього id
    mem['mws.social.cache.v1'] = JSON.stringify({
      replies: { u1: { name: 'Оля', items: { tt0000001: { s: 8, n: 'ок' }, '__proto__': { s: 5 }, bad: { s: 9 } } } },
      recs: { f1: [{ id: 'tt0000002', t: 'Фільм', k: 'movie' }, { id: 'не-id', t: 'X' }] },
    });
    const c = socialCache.get();
    assert.deepEqual(Object.keys(c.replies.u1.items), ['tt0000001']);
    assert.deepEqual(c.recs.f1.map(x => x.id), ['tt0000002']);
    socialCache.set({ replies: { u2: { name: 'Іра', items: {} } } });
    const d = socialCache.get();
    assert.deepEqual(Object.keys(d.replies), ['u2']);   // секція замінена цілком
    assert.deepEqual(d.recs.f1.map(x => x.id), ['tt0000002']);   // інша секція вціліла
    socialCache.clear();
    assert.deepEqual(socialCache.get(), { replies: {}, recs: {} });
  } finally { delete globalThis.localStorage; }
});
