// Узагальнене сховище записів, що їдуть у хмару разом зі списком: друзі,
// фільтри добірок, налаштування. Поведінка дзеркалить store.js (ключ у
// localStorage, мітка видалення, «свіжіше перемагає»), але без довідкових
// даних і без DOM — тож працює й під Node. Хмара тут не імпортується:
// вона сама підписується через onLocal і кличе applyRemote.

import { cleanListDef, cleanPrefs, cleanFriend, cleanReply, defId } from './social.js';
import { cleanRecs } from './logic.js';

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватне вікно чи Node — живемо в пам'яті */ }
}

// Мітка видалення — це лише { id, deleted, updated } і йде повз clean;
// updated мусить бути числом, інакше рядок із хмари вигравав би порівняння.
const tomb = r => (typeof r.id === 'string' && r.id ? { id: r.id, deleted: true, updated: Number.isFinite(r.updated) ? r.updated : 0 } : null);

// clean — функція очищення запису: усе, що прийшло з хмари, посилання чи
// localStorage, проходить крізь неї; null — запис відкинуто.
export function makeSynced(name, clean) {
  const cleanRec = r => (r?.deleted ? tomb(r) : clean(r));
  const KEY = `mws.${name}.v1`;
  let recs = {};
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
      const next = clean({ ...(recs[id] && !recs[id].deleted ? recs[id] : {}), ...patch, id, updated: Date.now() });
      if (!next) return null;
      recs[id] = next; save(); emit(); emitLocal(next);
      return next;
    },
    // Видалене лишається міткою: інакше стара копія на іншому пристрої
    // воскресила б викинутий запис.
    remove(id) {
      const next = { id, deleted: true, updated: Date.now() };
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
    clear() { recs = {}; save(); emit(); },
  };
  return s;
}

export { defId };

// Локальний кеш для екрана друзів без мережі: відповіді на мій список
// ({ uid → відповідь }) і рекомендації друзів ({ id друга → тайтли }). У хмару
// не йде, тож це не makeSynced; живе тут, щоб cloud.js міг стерти його при
// зміні власника пристрою без циклу імпорту. Читання проходить очищення.
const CACHE_KEY = 'mws.social.cache.v1';
export const socialCache = {
  get() {
    const raw = load(CACHE_KEY), replies = {}, recs = {};
    for (const [k, v] of Object.entries(raw.replies && typeof raw.replies === 'object' ? raw.replies : {})) replies[k] = cleanReply(v);
    for (const [k, v] of Object.entries(raw.recs && typeof raw.recs === 'object' ? raw.recs : {})) recs[k] = cleanRecs({ items: v }).items;
    return { replies, recs };
  },
  // patch ({ replies } і/або { recs }) замінює відповідну частину цілком
  set(patch) { persist(CACHE_KEY, { ...socialCache.get(), ...patch }); },
  clear() { try { localStorage.removeItem(CACHE_KEY); } catch { /* нічого */ } },
};

export const friends = makeSynced('friends', cleanFriend);
export const listdefs = makeSynced('listdefs', cleanListDef);
export const prefs = makeSynced('prefs', cleanPrefs);
