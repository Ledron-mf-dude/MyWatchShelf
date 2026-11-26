// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSynced, defId } from '../js/synced.js';
import { sanitize, filterSort } from '../js/logic.js';
import { cleanListFilter, isEmptyFilter, listDiff, publicOver, cleanListDef, cleanReply, cleanFriend, snapId, friendTable, newReplyAuthors, unseenCount, seenStamp, SKEW, replyItem, replyMode, shelfScores, returnHash, cleanPrefs, isUid, replyPatch, replyWrite, recsMissing, publishOpen, recsFor, needsKeep, addList, seenAtOf, canWrite, sendList, scoreLines, cleanReplyMem, openNotice, ownView } from '../js/social.js';

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
test('publishOpen: відкритим публікуємо лише після синхронізації налаштувань', () => {
  assert.equal(publishOpen(false, { id: 'social', open: true }), false);
  assert.equal(publishOpen(true, { id: 'social', open: true }), true);
  assert.equal(publishOpen(true, { id: 'social', open: false }), false);
  assert.equal(publishOpen(true, null), false);
  assert.equal(publishOpen(true, { id: 'social', open: 1 }), false);
});
test('canWrite: без входу — завжди, з входом — лише після першої синхронізації', () => {
  assert.equal(canWrite(false, false), true);
  assert.equal(canWrite(true, false), false);
  assert.equal(canWrite(true, true), true);
});

const F = (id, o = {}) => cleanFriend({ id, uid: id, name: id, kind: 'live', follow: false, added: 1, updated: 1, ...o });
const R = (name, items) => cleanReply({ name, updated: 10, items });
test('friendTable: оцінка мого списку й рекомендація — окремо; одна людина — один стовпець', () => {
  const tb = friendTable({
    entries: [E('tt0000001', { score: 10 })],
    friends: [F('oleh', { follow: true }), F('ira', { added: 2 })],
    replies: { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }), ira: R('Іра', { tt0000001: { s: 9.5, t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6 }, { id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] },
  });
  assert.deepEqual(tb.cols.map(c => c.name), ['Олег', 'Іра']);
  const a = tb.rows.find(r => r.id === 'tt0000001'), b = tb.rows.find(r => r.id === 'tt0000002');
  assert.deepEqual(a.cells.oleh, { s: 8, n: '', rec: true, rs: 6, rn: '' });
  assert.equal(a.avg, 8.8); assert.equal(a.mine, 10); assert.equal(a.have, true); assert.equal(a.only, false);
  assert.deepEqual(b.cells.oleh, { s: 0, n: '', rec: true, rs: 9, rn: '' });
  assert.equal(b.have, false); assert.equal(b.cells.ira, undefined);
  assert.equal(b.avg, 9); assert.equal(b.only, true);
  // свої тайтли — першими, рядки лише з рекомендацій — після них
  assert.deepEqual(tb.rows.map(r => r.id), ['tt0000001', 'tt0000002']);
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
  assert.deepEqual(ids(F('oleh', { kept: true })), ['tt0000001', 'tt0000004']);
  assert.deepEqual(ids(F('oleh', { kept: true, lists: ['Нові'] })), ['tt0000001', 'tt0000002', 'tt0000004']);
  // загальних рекомендацій не запам'ятовували — лише запам'ятана добірка
  assert.deepEqual(ids(F('oleh', { lists: ['Нові'] })), ['tt0000002']);
  assert.deepEqual(ids(F('oleh')), []);
  assert.deepEqual(ids({ id: 'без-lists' }), []);
  assert.deepEqual(ids(null), ['tt0000001', 'tt0000004']);                      // ще не збережений друг
  assert.deepEqual(ids(cleanFriend({ id: 's00000001', kind: 'snap', items: [] })), ['tt0000001', 'tt0000004']);
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
  // запам'ятали лише добірку: на загальному посиланні кнопка ще потрібна, на цій добірці — ні
  const one = F('oleh', { follow: true, kept: false, lists: ['Нові'] });
  assert.equal(needsKeep(one, ''), true);
  assert.equal(needsKeep(one, 'Нові'), false);
  // рекомендації вимкнено, але запам'ятане лишилось — кнопки немає
  assert.equal(needsKeep(F('oleh', { follow: false, kept: true }), ''), false);
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
  assert.deepEqual(tb.rows[0].cells.toString, { s: 0, n: '', rec: true, rs: 7, rn: '' });
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
  assert.deepEqual(tb.rows[0].cells.s00000001, { s: 0, n: '', rec: true, rs: 9, rn: '' });
  // відповідь без оцінки, але з текстом: у середню йде оцінка з рекомендації, обидва коментарі на місці
  const c = friendTable({
    entries: [], friends: [F('oleh', { follow: true })],
    replies: { oleh: R('Олег', { tt0000001: { s: 0, n: 'текст', t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000001', t: 'A', k: 'series', s: 6, n: 'раджу' }] },
  });
  assert.deepEqual(c.rows[0].cells.oleh, { s: 0, n: 'текст', rec: true, rs: 6, rn: 'раджу' });
  assert.equal(c.rows[0].avg, 6); assert.equal(c.rows[0].only, false);
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
    assert.deepEqual(socialCache.get(), { replies: {}, recs: {}, cols: {} });
  } finally { delete globalThis.localStorage; }
});

test('synced: службові слова як id не читаються з прототипа', () => {
  const s = makeSynced('t4', r => (typeof r?.id === 'string' ? r : null));
  assert.equal(s.get('constructor'), null);
  assert.equal(s.get('toString'), null);
  assert.deepEqual(Object.keys(s.save('constructor', { v: 1 })).sort(), ['id', 'updated', 'v']);
  assert.equal(s.get('constructor').v, 1);
  assert.equal(s.applyRemote([{ id: 'valueOf', v: 2, updated: 1 }]), true);
  assert.equal(s.get('valueOf').v, 2);
  assert.equal(s.raw().length, 2);
});

test('socialCache: ключ «__proto__» у кеші не стає прототипом секції', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  try {
    const { socialCache } = await import('../js/synced.js');
    mem['mws.social.cache.v1'] = '{"replies":{"__proto__":{"name":"Зло","items":{}},"u1":{"name":"Оля","items":{}}},"recs":{"__proto__":[{"id":"tt0000002"}],"constructor":[{"id":"tt0000003"}]}}';
    const c = socialCache.get();
    assert.deepEqual(Object.keys(c.replies), ['u1']);
    assert.equal(Object.getPrototypeOf(c.replies), Object.prototype);
    assert.equal(c.replies.name, undefined);
    assert.deepEqual(Object.keys(c.recs), ['constructor']);
    assert.equal(Object.getPrototypeOf(c.recs), Object.prototype);
    assert.equal(c.recs.length, undefined);
  } finally { delete globalThis.localStorage; }
});

// ── добірки: назва, ключ, ручний вибір, умови (пакет 1 після тесту друзів) ──
import { listMatch, manualPick, tickManual, listKey, colsOf, nameTaken, nameList, listPlan } from '../js/social.js';
import { cleanCols, colName, cleanRecs } from '../js/logic.js';

test('nameTaken: та сама назва без огляду на регістр і пробіли', () => {
  assert.equal(nameTaken(['Аніме', 'Нові'], ' аніме '), 'Аніме');
  assert.equal(nameTaken(['Аніме'], 'Кіно'), '');
  assert.equal(nameTaken(['Аніме', 'Нові'], 'аніме', 'Аніме'), '');   // редагуємо її саму — зміна регістру дозволена
  assert.equal(nameTaken(['Аніме', 'Нові'], 'нові', 'Аніме'), 'Нові');
});
test('cleanListFilter: «лише раджу» і переставлені роки', () => {
  assert.equal(cleanListFilter({ rec: true }).rec, true);
  assert.equal('rec' in cleanListFilter({ rec: 'так' }), false);
  assert.equal(isEmptyFilter({ rec: true }), false);
  const f = cleanListFilter({ from: '2025', to: '2020' });
  assert.deepEqual([f.from, f.to], ['2020', '2025']);
});
test('listMatch: роки «від», «до», проміжок; лише з позначкою «раджу»', () => {
  const list = [E('tt0000001', { year: '2019' }), E('tt0000002', { year: '2021', rec: true }), E('tt0000003', { year: '2024' }), E('tt0000004', { year: '' })];
  const ids = f => listMatch(list, f).map(e => e.id);
  assert.deepEqual(ids({ from: '2021' }), ['tt0000002', 'tt0000003']);
  assert.deepEqual(ids({ to: '2021' }), ['tt0000001', 'tt0000002']);
  assert.deepEqual(ids({ from: '2020', to: '2022' }), ['tt0000002']);
  assert.deepEqual(ids({ rec: true }), ['tt0000002']);
  assert.equal(ids({}).length, 4);
});
test('manualPick і tickManual: ручні галочки переживають зміну умов', () => {
  const m = { plus: new Set(), minus: new Set() };
  tickManual(m, 'a', false, true);    // позначили те, що умовам не підходить
  tickManual(m, 'b', true, false);    // зняли те, що підходить
  assert.deepEqual([...manualPick(['b', 'c'], m.plus, m.minus)].sort(), ['a', 'c']);
  assert.deepEqual([...manualPick(['d'], m.plus, m.minus)].sort(), ['a', 'd']);   // умови змінились — «a» лишилось
  tickManual(m, 'a', false, false);
  tickManual(m, 'b', true, true);
  assert.deepEqual([...manualPick(['b', 'c'], m.plus, m.minus)].sort(), ['b', 'c']);
  assert.deepEqual([m.plus.size, m.minus.size], [0, 0]);
});
test('listDiff зважає на ручні додавання й вилучення', () => {
  const list = [
    E('tt0000001', { kind: 'anime' }),                          // підходить, але знято вручну
    E('tt0000002', { kind: 'movie', type: 'movie', lists: ['Л'] }),   // не підходить, але додано вручну
    E('tt0000003', { kind: 'movie', type: 'movie', lists: ['Л'] }),   // не підходить і не ручне — прибрати
    E('tt0000004', { kind: 'anime' }),
  ];
  const d = listDiff(list, 'Л', { kinds: ['anime'] }, { plus: ['tt0000002'], minus: ['tt0000001'] });
  assert.deepEqual(d.add.map(e => e.id), ['tt0000004']);
  assert.deepEqual(d.drop.map(e => e.id), ['tt0000003']);
});
test('cleanListDef: ключ і ручні списки чистяться', () => {
  const base = { id: defId('Л'), name: 'Л', f: {}, updated: 1 };
  const d = cleanListDef({ ...base, key: 'abc123xyz0', plus: ['tt0000001', 'сміття', 'tt0000001'], minus: 'ні' });
  assert.equal(d.key, 'abc123xyz0');
  assert.deepEqual(d.plus, ['tt0000001']);
  assert.equal('minus' in d, false);
  assert.equal('key' in cleanListDef({ ...base, key: 'ABC/../x' }), false);
  assert.equal('key' in cleanListDef({ ...base, key: '__proto__' }), false);
  assert.equal(cleanListDef({ ...base, plus: Array.from({ length: 600 }, (_, i) => 'tt' + String(1000000 + i)) }).plus.length, 500);
});
test('listKey: 10 знаків із малих літер і цифр', () => {
  assert.match(listKey(), /^[a-z0-9]{10}$/);
  assert.equal(listKey(new Uint8Array([0, 25, 26, 35, 36, 255, 1, 2, 3, 4])), 'az09adbcde');
  assert.notEqual(listKey(), listKey());
});
test('colsOf: ключ → назва лише для живих добірок', () => {
  const defs = [{ name: 'А', key: 'aaaaaaaa' }, { name: 'Б' }, { name: 'Зникла', key: 'bbbbbbbb' }];
  assert.deepEqual(colsOf(defs, ['А', 'Б']), { aaaaaaaa: 'А' });
});
test('cleanCols і colName: чужа мапа добірок', () => {
  const raw = JSON.parse('{"aaaaaaaa":"А","__proto__":"x","constructor":"y","ab":"короткий","bbbbbbbb":7,"cccccccc":"' + 'я'.repeat(50) + '"}');
  const c = cleanCols(raw);
  assert.deepEqual(Object.keys(c).sort(), ['aaaaaaaa', 'cccccccc']);
  assert.equal(c.cccccccc.length, 40);
  assert.equal(colName(c, 'aaaaaaaa'), 'А');
  assert.equal(colName(c, 'constructor'), '');
  assert.equal(colName(undefined, 'aaaaaaaa'), '');
  assert.equal(Object.keys(cleanCols(Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['k' + String(1000000 + i), 'н'])))).length, 60);
  assert.deepEqual(cleanCols('ні'), {});
  assert.deepEqual(cleanRecs({ items: [], cols: { aaaaaaaa: 'А' } }).cols, { aaaaaaaa: 'А' });
  assert.equal('cols' in cleanRecs({ items: [] }), false);
});
test('returnHash пускає й посилання з ключем добірки', () => {
  assert.equal(returnHash('#u=abc&c=abc123xyz0'), '#u=abc&c=abc123xyz0');
  assert.equal(returnHash('#u=abc&c=ABC'), '');
  // ключ і назва разом: назва — запас на випадок, коли ключа немає в документі автора
  assert.equal(returnHash('#u=abc&c=abc123xyz0&l=x'), '#u=abc&c=abc123xyz0&l=x');
  assert.equal(returnHash('#u=abc&c=abc123xyz0&l=x&me=1'), '#u=abc&c=abc123xyz0&l=x&me=1');
  assert.equal(returnHash('#u=abc&c=abc123xyz0&l=x&l=y'), '');
});
test('nameList: до шести назв, далі «+N»', () => {
  assert.equal(nameList(['А', 'Б']), 'А, Б');
  assert.equal(nameList(['1', '2', '3', '4', '5', '6', '7', '8']), '1, 2, 3, 4, 5, 6 +2');
  assert.equal(nameList([]), '');
});
test('listPlan: редагування замінює склад і перейменовує', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const list = [
    E('tt0000001', { lists: ['Інша', 'Стара'] }),   // лишається — мітка перейменовується на місці
    E('tt0000002', { lists: ['Стара'] }),           // зняли галочку
    E('tt0000003'),                                 // додали
    E('tt0000004', { lists: full }),                // додали, але місця немає
    E('tt0000005', { lists: ['Інша'] }),            // не чіпали
  ];
  const p = listPlan(list, 'Стара', 'Нова', ['tt0000001', 'tt0000003', 'tt0000004']);
  assert.deepEqual(p.set, [['tt0000001', ['Інша', 'Нова']], ['tt0000002', []], ['tt0000003', ['Нова']]]);
  assert.deepEqual(p.added, ['tt0000003']);
  assert.equal(p.skipped, 1);
  // нова добірка: лише додавання, наявне не чіпаємо
  assert.deepEqual(listPlan(list, '', 'Ще', ['tt0000005']).set, [['tt0000005', ['Інша', 'Ще']]]);
  // без змін — порожній план
  assert.deepEqual(listPlan(list, 'Стара', 'Стара', ['tt0000001', 'tt0000002']).set, []);
});

// ── оцінювання чужого списку ──────────────────────────────────────
test('sendList: оцінки з полиці, яких ще немає у відповіді; зняте навмисно не пропонуємо', () => {
  const shelf = [{ id: 'tt0000001', score: 8, title: 'A' }, { id: 'tt0000002', score: 7, title: 'B' }, { id: 'tt0000003', score: 0, title: 'C' }, { id: 'tt0000004', score: 9, title: 'D' }, { id: 'tt0000009', score: 5, title: 'Z' }];
  const items = [{ id: 'tt0000001', t: 'A' }, { id: 'tt0000002', t: 'B' }, { id: 'tt0000003', t: 'C' }, { id: 'tt0000004', t: 'D' }];
  const mine = { tt0000002: { s: 6, n: '' }, tt0000004: { s: 0, n: 'лише коментар' } };
  assert.deepEqual(sendList(shelf, items, mine, []), [{ id: 'tt0000001', t: 'A', s: 8 }, { id: 'tt0000004', t: 'D', s: 9 }]);
  assert.deepEqual(sendList(shelf, items, mine, ['tt0000001']), [{ id: 'tt0000004', t: 'D', s: 9 }]);
  assert.deepEqual(sendList([], items, {}, []), []);
});
test('scoreLines: «назва — оцінка» рядками, далі «+N»', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ t: 'T' + i, s: i === 0 ? 8.5 : 7 }));
  const lines = scoreLines(rows, 12).split('\n');
  assert.equal(lines.length, 13);
  assert.equal(lines[0], 'T0 — 8.5');
  assert.equal(lines[12], '+2');
  assert.equal(scoreLines(rows.slice(0, 2)), 'T0 — 8.5\nT1 — 7');
});
test('cleanReplyMem: лише справжні власники й id, межі, без службових ключів', () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['u' + i, { skip: [], at: i }]));
  const m = cleanReplyMem({
    alice: { skip: ['tt0000001', 'tt0000001', 'x', 5], open: false, at: 5 },
    'bad/uid': { skip: ['tt0000001'] }, constructor: { skip: ['tt0000002'] }, bob: 'x', carl: { open: 'yes' },
  });
  assert.deepEqual(Object.keys(m).sort(), ['alice', 'carl']);
  assert.deepEqual({ ...m.alice }, { skip: ['tt0000001'], at: 5, open: false });
  assert.deepEqual({ ...m.carl }, { skip: [], at: 0 });            // open — лише булеве
  const kept = Object.keys(cleanReplyMem(many));
  assert.equal(kept.length, 50);
  assert.ok(kept.includes('u59') && !kept.includes('u0'));          // лишаються найсвіжіші
  assert.deepEqual(Object.keys(cleanReplyMem(null)), []);
  assert.equal(cleanReplyMem({ a: { skip: Array.from({ length: 600 }, (_, i) => 'tt' + String(1000000 + i)) } }).a.skip.length, 500);
});
test('openNotice: помітне повідомлення, лише коли список відкрили вже після моїх оцінок', () => {
  assert.equal(openNotice(true, 3, false), true);       // бачив закритим, тепер відкрито
  assert.equal(openNotice(true, 3, undefined), true);   // оцінки є, а про відкритість ще не казали
  assert.equal(openNotice(true, 3, true), false);       // уже знає
  assert.equal(openNotice(true, 0, false), false);      // оцінок немає — досить рядка
  assert.equal(openNotice(false, 3, false), false);
});
test('ownView: власник на власному посиланні', () => {
  const items = [{ id: 'tt0000001' }, { id: 'tt0000002' }], all = ['tt0000001', 'tt0000002', 'tt0000003'];
  assert.equal(ownView({ uid: 'a', meUid: 'a', me: false, items, shelfIds: [] }), true);
  assert.equal(ownView({ uid: 'a', meUid: 'b', me: true, items, shelfIds: all }), false);   // увійшов хтось інший
  assert.equal(ownView({ uid: 'a', meUid: '', me: true, items, shelfIds: all }), true);     // без входу, «Як бачить гість»
  assert.equal(ownView({ uid: '', meUid: 'a', me: true, items, shelfIds: all }), true);     // знімок
  assert.equal(ownView({ uid: '', meUid: '', me: true, items, shelfIds: ['tt0000001'] }), false);
  assert.equal(ownView({ uid: '', meUid: '', me: false, items, shelfIds: all }), false);
  assert.equal(ownView({ uid: '', meUid: '', me: true, items: [], shelfIds: all }), false);
});
test('returnHash пускає й позначку перегляду власником', () => {
  assert.equal(returnHash('#u=abc&me=1'), '#u=abc&me=1');
  assert.equal(returnHash('#u=abc&c=abcdef12&me=1'), '#u=abc&c=abcdef12&me=1');
  assert.equal(returnHash('#u=abc&me=2'), '');
});

// ── екран «Друзі» й «Керувати друзями» (пакет 3 після тесту друзів) ──
import { hasKept, wantsRecs, friendLink, cutNote, replyStats } from '../js/social.js';

test('cleanFriend: kept — запам’ятані загальні рекомендації; старі записи з follow вважаємо запам’ятаними', () => {
  assert.equal(cleanFriend({ id: 'oleh' }).kept, false);
  assert.equal(cleanFriend({ id: 'oleh', follow: true }).kept, true);                 // старий запис без поля
  assert.equal(cleanFriend({ id: 'oleh', follow: true, kept: false }).kept, false);   // запам'ятали лише добірку
  assert.equal(cleanFriend({ id: 'oleh', follow: false, kept: true }).kept, true);
  assert.equal(cleanFriend({ id: 'oleh', kept: 'так' }).kept, false);
  assert.equal(cleanFriend({ id: 's00000001', kind: 'snap', items: [] }).kept, true);
});
test('wantsRecs: рекомендації читаємо лише в того, кого запам’ятали й не вимкнули', () => {
  assert.equal(wantsRecs(F('oleh', { follow: true })), true);
  assert.equal(wantsRecs(F('oleh', { follow: true, kept: false, lists: ['Нові'] })), true);
  assert.equal(wantsRecs(F('oleh', { follow: true, kept: false })), false);   // лише оцінив мій список
  assert.equal(wantsRecs(F('oleh', { follow: false, kept: true })), false);
  assert.equal(wantsRecs({ id: 'oleh', deleted: true }), false);
  assert.equal(wantsRecs(null), false);
  assert.equal(hasKept(F('oleh')), false);
  assert.equal(hasKept(F('oleh', { lists: ['Нові'] })), true);
  assert.deepEqual(recsMissing([F('oleh', { follow: true, kept: false })], {}), []);
});
test('friendTable: «прибрані» рекомендації зникають, оцінки мого списку лишаються', () => {
  const data = {
    entries: [], replies: { oleh: R('Олег', { tt0000001: { s: 8, t: 'A' } }) },
    recs: { oleh: [{ id: 'tt0000002', t: 'B', k: 'anime', s: 9 }] },
  };
  const ids = f => friendTable({ ...data, friends: [f] }).rows.map(r => r.id);
  assert.deepEqual(ids(F('oleh', { follow: true })), ['tt0000001', 'tt0000002']);
  assert.deepEqual(ids(F('oleh', { follow: false, kept: false, lists: [] })), ['tt0000001']);
  // оцінка мого списку для тайтла, якого в мене вже немає, — не «лише рекомендація»
  assert.equal(friendTable({ ...data, friends: [F('oleh')] }).rows[0].only, false);
});
test('friendLink: загальні рекомендації, добірка за ключем або за назвою', () => {
  assert.equal(friendLink('oleh'), '#u=oleh');
  assert.equal(friendLink('oleh', 'Нові & старі', {}), '#u=oleh&l=' + encodeURIComponent('Нові & старі'));
  assert.equal(friendLink('oleh', 'Нові', { abc123def0: 'Нові', zzz999zzz9: 'Інші' }), '#u=oleh&c=abc123def0&l=' + encodeURIComponent('Нові'));
  assert.equal(friendLink('oleh', 'Нові', { zzz999zzz9: 'Інші' }), '#u=oleh&l=' + encodeURIComponent('Нові'));
  const both = friendLink('oleh', 'Нові', { abc123def0: 'Нові' });
  assert.equal(returnHash(both), both);
});
test('cutNote: початок коментаря для клітинки', () => {
  assert.equal(cutNote('коротко'), 'коротко');
  assert.equal(cutNote('а'.repeat(40)), 'а'.repeat(40));
  assert.equal(cutNote('слово '.repeat(10)), 'слово слово слово слово слово слово слов…');
});
test('replyStats: скільки людей і оцінок відкриє перемикач', () => {
  const replies = { a: R('А', { tt0000001: { s: 8 }, tt0000002: { n: 'текст' } }), b: R('Б', {}), constructor: R('В', { tt0000003: { s: 5 } }) };
  assert.deepEqual(replyStats(replies), { people: 2, scores: 3 });
  assert.deepEqual(replyStats({}), { people: 0, scores: 0 });
});
test('socialCache: мапи добірок друзів (cols) чистяться як у публічному документі', async () => {
  const mem = {};
  globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  try {
    const { socialCache } = await import('../js/synced.js');
    mem['mws.social.cache.v1'] = '{"cols":{"__proto__":{"abc123def0":"Зло"},"oleh":{"abc123def0":" Нові ","constructor":"X","BAD":"Y"}}}';
    assert.deepEqual(socialCache.get().cols, { oleh: { abc123def0: 'Нові' } });
    socialCache.set({ recs: {} });
    assert.deepEqual(socialCache.get().cols, { oleh: { abc123def0: 'Нові' } });   // інша секція вціліла
  } finally { delete globalThis.localStorage; }
});

// ── добірка за умовами: зміни з картки тайтла ──
import { manualNote } from '../js/social.js';
test('manualNote: додане й зняте з картки лягає в plus/minus добірки', () => {
  const def = { plus: ['tt0000001'], minus: ['tt0000002'] };
  // додали те, що умовам не підходить — «додано рукою»
  assert.deepEqual(manualNote(def, 'tt0000003', false, true), { plus: ['tt0000001', 'tt0000003'], minus: ['tt0000002'] });
  // зняли те, що підходить — «знято рукою»: «Сформувати знову» його не поверне
  assert.deepEqual(manualNote(def, 'tt0000004', true, false), { plus: ['tt0000001'], minus: ['tt0000002', 'tt0000004'] });
  // повернули зняте, що підходить; зняли додане рукою — записи про них зникають
  assert.deepEqual(manualNote(def, 'tt0000002', true, true), { plus: ['tt0000001'], minus: [] });
  assert.deepEqual(manualNote(def, 'tt0000001', false, false), { plus: [], minus: ['tt0000002'] });
  // запис без списків і сам def не змінюється
  assert.deepEqual(manualNote({}, 'tt0000005', true, true), { plus: [], minus: [] });
  assert.deepEqual(def, { plus: ['tt0000001'], minus: ['tt0000002'] });
  // разом із listDiff: зняте з картки не додається назад, додане не прибирається
  const shelf = [
    { id: 'tt0000004', title: 'А', kind: 'anime', type: 'series', status: 'done', lists: [] },
    { id: 'tt0000003', title: 'Б', kind: 'movie', type: 'movie', status: 'done', lists: ['Л'] },
  ];
  const f = { kinds: ['anime'] };
  assert.equal(listDiff(shelf, 'Л', f).add.length + listDiff(shelf, 'Л', f).drop.length, 2);
  let m = manualNote({}, 'tt0000004', true, false);
  m = manualNote(m, 'tt0000003', false, true);
  assert.deepEqual(listDiff(shelf, 'Л', f, m), { add: [], drop: [], skip: [] });
});

// ── правки після перевірки всієї зміни ────────────────────────────
import { listHash } from '../js/social.js';
import { listView, recsHash } from '../js/logic.js';

test('listHash: посилання на добірку несе і ключ, і назву', () => {
  assert.equal(listHash('oleh'), '#u=oleh');
  assert.equal(listHash('oleh', 'Нові & старі'), '#u=oleh&l=' + encodeURIComponent('Нові & старі'));
  assert.equal(listHash('oleh', 'Нові', 'abc123def0'), '#u=oleh&c=abc123def0&l=' + encodeURIComponent('Нові'));
  assert.deepEqual(recsHash(listHash('oleh', 'Нові & старі', 'abc123def0').slice(1)), { uid: 'oleh', key: 'abc123def0', list: 'Нові & старі', me: false });
});
test('listView: ключ важить більше за назву, а без нього в cols рятує назва', () => {
  const items = [{ id: 'tt0000001', s: 9, l: ['Нова назва'] }, { id: 'tt0000002', s: 8, l: ['Стара'] }, { id: 'tt0000003', s: 7 }];
  const withCols = { name: 'Аліса', items, cols: { abcdef12: 'Нова назва' } };
  // добірку перейменували: ключ веде до неї, хоч у посиланні ще стара назва
  assert.deepEqual(listView(withCols, 'abcdef12', 'Стара'), { name: 'Аліса', title: 'Нова назва', open: false, items: [items[0]] });
  // документ опублікував старий клієнт без cols: ключа немає — шукаємо за назвою
  assert.deepEqual(listView({ name: 'Аліса', items }, 'abcdef12', 'Стара').items.map(x => x.id), ['tt0000002']);
  assert.deepEqual(listView({ name: 'Аліса', items, cols: { zzzzzz99: 'Інша' } }, 'abcdef12', 'Стара').title, 'Стара');
  // ні ключа, ні назви в автора немає — «такої добірки немає»
  assert.deepEqual(listView({ name: 'Аліса', items }, 'abcdef12', 'Нема'), { missing: true, name: 'Аліса' });
  assert.deepEqual(listView({ name: 'Аліса', items }, 'abcdef12', ''), { missing: true, name: 'Аліса' });
});
test('listPlan: left — скільки записів нестиме назву; нуль означає, що добірка зникла б', () => {
  const full = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const list = [{ id: 'tt0000001', lists: ['Х'] }, { id: 'tt0000002', lists: full }, { id: 'tt0000003', lists: ['Х', 'Інша'] }];
  // зняли всіх учасників, позначили лише тайтл, що вже у 8 добірках — назви не нестиме ніхто
  assert.equal(listPlan(list, 'Х', 'Х', ['tt0000002']).left, 0);
  assert.equal(listPlan(list, '', 'Нова', ['tt0000002']).left, 0);
  assert.equal(listPlan(list, 'Х', 'Y', ['tt0000001', 'tt0000002']).left, 1);
  assert.equal(listPlan(list, '', 'Інша', ['tt0000003']).left, 1);   // уже з міткою — теж рахується
  assert.equal(listPlan(list, '', 'Нова', ['tt0000001', 'tt0000003']).left, 2);
});

import { friendTomb } from '../js/social.js';
test('схована людина: мітка видалення зберігає запамʼятане, і воно ніде не показується', () => {
  const s = makeSynced('t_hide', cleanFriend, friendTomb);
  s.save('oleh', { name: 'Олег', kind: 'live', follow: true, kept: true, lists: ['Нові', 'Нові', 7] });
  s.remove('oleh');
  const gone = s.raw()[0];
  assert.deepEqual({ ...gone, updated: 0 }, { id: 'oleh', deleted: true, updated: 0, kept: true, lists: ['Нові'] });
  assert.equal(s.get('oleh'), null);
  // поки сховано — рекомендацій не тягнемо й не показуємо
  assert.equal(wantsRecs(gone), false);
  assert.deepEqual(recsMissing([gone], {}), []);
  assert.equal(friendTable({ entries: [], friends: [gone], replies: {}, recs: { oleh: [{ id: 'tt0000001', t: 'A', s: 9, l: ['Нові'] }] } }).rows.length, 0);
  // мітка з хмари проходить те саме очищення: зайве відпадає, запам'ятане лишається
  s.applyRemote([{ id: 'ira', deleted: true, updated: 5, kept: 'так', lists: ['Х', { a: 1 }], name: 'Іра', items: [1] }]);
  assert.deepEqual(s.raw().find(r => r.id === 'ira'), { id: 'ira', deleted: true, updated: 5, kept: false, lists: ['Х'] });
  // нічого не запам'ятали — мітка лишається голою, як і в решти сховищ
  s.save('max', { kind: 'live' }); s.remove('max');
  assert.deepEqual(Object.keys(s.raw().find(r => r.id === 'max')).sort(), ['deleted', 'id', 'updated']);
  assert.deepEqual(friendTomb({ id: 'snap_1', kind: 'snap', lists: ['Х'] }), {});
  const plain = makeSynced('t_hide2', cleanFriend);
  plain.save('oleh', { kind: 'live', kept: true }); plain.remove('oleh');
  assert.equal('kept' in plain.raw()[0], false);
});
