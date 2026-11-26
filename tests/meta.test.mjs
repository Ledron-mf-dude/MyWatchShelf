// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson } from '../js/meta.js';

// fetch, що не відповідає, доки запит не скасують
const hang = (url, { signal }) => new Promise((res, rej) => {
  if (signal.aborted) return rej(new DOMException('aborted', 'AbortError'));
  signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')), { once: true });
});
const withFetch = async (fn, run) => {
  const was = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await run(); } finally { globalThis.fetch = was; }
};

test('getJson: каталог мовчить — запит обривається за часом і це не «скасовано»', async () => {
  await withFetch(hang, async () => {
    const at = Date.now();
    await assert.rejects(getJson('https://x.test/a.json', undefined, 30), err => err.name === 'TimeoutError' && !!err.message);
    assert.ok(Date.now() - at < 2000);
  });
});
test('getJson: скасування викликачем лишається скасуванням', async () => {
  await withFetch(hang, async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(getJson('https://x.test/a.json', ac.signal, 5000), err => err.name === 'AbortError');
    const dead = new AbortController(); dead.abort();
    await assert.rejects(getJson('https://x.test/a.json', dead.signal, 5000), err => err.name === 'AbortError');
  });
});
test('getJson: відповідь у строк проходить, помилка сервера — помилка', async () => {
  await withFetch(async () => ({ ok: true, json: async () => ({ v: 1 }) }), async () => {
    assert.deepEqual(await getJson('https://x.test/a.json', undefined, 30), { v: 1 });
  });
  await withFetch(async () => ({ ok: false, status: 503 }), async () => {
    await assert.rejects(getJson('https://x.test/a.json', undefined, 30), /HTTP 503/);
  });
});
