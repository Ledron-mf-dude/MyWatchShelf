// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSynced, defId } from '../js/synced.js';

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
