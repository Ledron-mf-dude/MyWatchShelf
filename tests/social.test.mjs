// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSynced, defId } from '../js/synced.js';
import { sanitize, filterSort } from '../js/logic.js';
import { cleanListFilter, isEmptyFilter, listDiff, publicOver, cleanListDef } from '../js/social.js';

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
