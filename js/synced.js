// Узагальнене сховище записів, що їдуть у хмару разом зі списком: друзі,
// фільтри добірок, налаштування. Поведінка дзеркалить store.js (ключ у
// localStorage, мітка видалення, «свіжіше перемагає»), але без довідкових
// даних і без DOM — тож працює й під Node. Хмара тут не імпортується:
// вона сама підписується через onLocal і кличе applyRemote.

import { cleanListDef, cleanPrefs, cleanFriend, friendTomb, cleanReply, cleanReplyMem, cleanOutbox, emptyBox, defId } from './social.js';
import { cleanRecs, cleanCols } from './logic.js';

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватне вікно чи Node — живемо в пам'яті */ }
}

// Мітка видалення — це лише { id, deleted, updated } і йде повз clean;
// updated мусить бути числом, інакше рядок із хмари вигравав би порівняння.
// keep — що сховище лишає на мітці понад це (у друзів — запам'ятане, щоб сховану
// людину можна було повернути); воно саме чистить те, що віддає.
const tomb = (r, keep) => (typeof r.id === 'string' && r.id ? { id: r.id, deleted: true, updated: Number.isFinite(r.updated) ? r.updated : 0, ...keep(r) } : null);

// clean — функція очищення запису: усе, що прийшло з хмари, посилання чи
// localStorage, проходить крізь неї; null — запис відкинуто.
export function makeSynced(name, clean, keep = () => ({})) {
  // «__proto__» як ключ мапи записів задав би прототип замість запису.
  const cleanRec = r => (r?.id === '__proto__' ? null : r?.deleted ? tomb(r, keep) : clean(r));
  const KEY = `mws.${name}.v1`;
  // Мапа без прототипа: id «constructor» чи «toString» не має знаходити
  // успадковане замість запису.
  let recs = Object.create(null);
  for (const r of Object.values(load(KEY))) {
    const c = cleanRec(r);
    if (c) recs[c.id] = c;
  }
  const subs = new Set(), localSubs = new Set();
  const emit = () => subs.forEach(fn => fn());
  const emitLocal = rec => localSubs.forEach(fn => fn(rec));
  const save = () => persist(KEY, recs);

  const s = {
    onChange(fn) { subs.add(fn); },
    onLocal(fn) { localSubs.add(fn); },
    raw: () => Object.values(recs),
    list: () => Object.values(recs).filter(r => !r.deleted),
    get: id => (recs[id] && !recs[id].deleted ? recs[id] : null),
    save(id, patch) {
      if (id === '__proto__') return null;
      const next = clean({ ...(recs[id] && !recs[id].deleted ? recs[id] : {}), ...patch, id, updated: Date.now() });
      if (!next) return null;
      recs[id] = next; save(); emit(); emitLocal(next);
      return next;
    },
    // Видалене лишається міткою: інакше стара копія на іншому пристрої
    // воскресила б викинутий запис.
    remove(id) {
      if (id === '__proto__') return;
      const next = { id, deleted: true, updated: Date.now(), ...keep(recs[id] || {}) };
      recs[id] = next; save(); emit(); emitLocal(next);
    },
    // Свіжіший за `updated` перемагає; при рівних — той, що приїхав.
    applyRemote(list) {
      let changed = false;
      for (const r of list) {
        const c = cleanRec(r);
        if (!c) continue;
        const cur = recs[c.id];
        if (cur && (c.updated || 0) < (cur.updated || 0)) continue;
        if (cur && JSON.stringify(cur) === JSON.stringify(c)) continue;
        recs[c.id] = c; changed = true;
      }
      if (changed) { save(); emit(); }
      return changed;
    },
    clear() { recs = Object.create(null); save(); emit(); },
  };
  return s;
}

export { defId };

// Локальний кеш для екрана друзів без мережі: відповіді на мій список
// ({ uid → відповідь }), рекомендації друзів ({ id друга → тайтли }) і ключі
// їхніх добірок для посилань ({ id друга → { ключ → назва } }). У хмару
// не йде, тож це не makeSynced; живе тут, щоб cloud.js міг стерти його при
// зміні власника пристрою без циклу імпорту. Читання проходить очищення.
const CACHE_KEY = 'mws.social.cache.v1';
export const socialCache = {
  get() {
    const raw = load(CACHE_KEY), replies = {}, recs = {}, cols = {};
    // «__proto__» як ключ задав би прототип секції замість запису — пропускаємо;
    // решту службових слів читачі беруть лише через own-перевірку.
    const part = v => Object.entries(v && typeof v === 'object' ? v : {}).filter(([k]) => k !== '__proto__');
    for (const [k, v] of part(raw.replies)) replies[k] = cleanReply(v);
    for (const [k, v] of part(raw.recs)) recs[k] = cleanRecs({ items: v }).items;
    for (const [k, v] of part(raw.cols)) { const c = cleanCols(v); if (Object.keys(c).length) cols[k] = c; }
    return { replies, recs, cols };
  },
  // patch ({ replies }, { recs } і/або { cols }) замінює відповідну частину цілком
  set(patch) { persist(CACHE_KEY, { ...socialCache.get(), ...patch }); },
  clear() { try { localStorage.removeItem(CACHE_KEY); } catch { /* нічого */ } },
};

// Пам'ять оцінювача за автором списку (cleanReplyMem): зняті навмисно оцінки й
// останній побачений стан «оцінки бачать усі». Лише цей пристрій; при зміні
// власника пристрою cloud.js її стирає разом із кешем.
const MEM_KEY = 'mws.replymem.v1';
export const replyMem = {
  get(owner) { const all = cleanReplyMem(load(MEM_KEY)); return Object.hasOwn(all, owner) ? all[owner] : { skip: [], at: 0 }; },
  set(owner, patch) {
    const all = cleanReplyMem(load(MEM_KEY));
    all[owner] = { ...replyMem.get(owner), ...patch, at: Date.now() };
    persist(MEM_KEY, cleanReplyMem(all));
  },
  clear() { try { localStorage.removeItem(MEM_KEY); } catch { /* нічого */ } },
};

// Вихідні оцінки чужих списків (cleanOutbox): зміна лягає сюди одразу, синхронно,
// ще до запису в хмару — тож вихід зі сторінки її не губить. Лише цей пристрій;
// при зміні власника пристрою cloud.js стирає її разом із пам'яттю оцінювача.
const OUT_KEY = 'mws.outbox.v1';
export const outbox = {
  all: () => cleanOutbox(load(OUT_KEY)),
  get(owner) { const all = outbox.all(); return Object.hasOwn(all, owner) ? all[owner] : emptyBox(); },
  // fn — чиста зміна скриньки автора (outboxPut, outboxDone…); повертає нову скриньку
  change(owner, fn) {
    const all = outbox.all();
    all[owner] = { ...fn(Object.hasOwn(all, owner) ? all[owner] : emptyBox()), at: Date.now() };
    persist(OUT_KEY, cleanOutbox(all));
    return all[owner];
  },
  clear() { try { localStorage.removeItem(OUT_KEY); } catch { /* нічого */ } },
};

export const friends = makeSynced('friends', cleanFriend, friendTomb);
export const listdefs = makeSynced('listdefs', cleanListDef);
export const prefs = makeSynced('prefs', cleanPrefs);
