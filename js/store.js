// Сховище цього пристрою. Правда спершу лягає сюди (localStorage), а вже
// потім, якщо людина ввійшла, — у хмару. Тож без мережі й без входу все
// працює так само.
import { sanitize, mergeEntry, sameVersion } from './logic.js';

const KEY = 'mws.entries.v1', SKEY = 'mws.settings.v1';

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* приватне вікно — живемо в пам'яті */ }
}

let entries = {};
for (const e of Object.values(load(KEY, {}))) {
  const c = sanitize(e);
  if (c) entries[c.id] = c;
}
const settings = { view: 'list', sort: 'updated', dir: -1, theme: 'auto', name: '', hint: true, ...load(SKEY, {}) };

const subs = new Set(), localSubs = new Set();
const emit = () => subs.forEach(fn => fn());
const emitLocal = (entry, what) => localSubs.forEach(fn => fn(entry, what));
const save = () => persist(KEY, entries);

export const store = {
  settings,
  setSetting(k, v) { settings[k] = v; persist(SKEY, settings); },

  onChange(fn) { subs.add(fn); },
  // what: 'user' — людина щось змінила; 'meta' — освіжили довідкове
  onLocal(fn) { localSubs.add(fn); },

  raw: () => Object.values(entries),
  list: () => Object.values(entries).filter(e => !e.deleted),
  get: id => (entries[id] && !entries[id].deleted ? entries[id] : null),

  save(id, patch) {
    const next = sanitize({ ...(entries[id] && !entries[id].deleted ? entries[id] : {}), ...patch, id, updated: Date.now() });
    if (!next) return null;
    entries[id] = next; save(); emit(); emitLocal(next, 'user');
    return next;
  },
  setMeta(id, meta) {
    const cur = store.get(id);
    if (!cur) return;
    const next = sanitize({ ...cur, meta, metaAt: Date.now() });
    entries[id] = next; save(); emit(); emitLocal(next, 'meta');
  },
  // Видалене лишається міткою: інакше стара копія на іншому пристрої
  // воскресила б викинутий запис.
  remove(id) {
    const next = { id, deleted: true, updated: Date.now() };
    entries[id] = next; save(); emit(); emitLocal(next, 'user');
  },
  applyRemote(list) {
    let changed = false;
    for (const r of list) {
      const c = sanitize(r);
      if (!c) continue;
      const merged = mergeEntry(entries[c.id], c);
      if (!sameVersion(merged, entries[c.id])) { entries[c.id] = merged; changed = true; }
    }
    if (changed) { save(); emit(); }
    return changed;
  },
  // Імпорт файла: зливаємо за тими ж правилами, а що змінилось — це
  // вже «наша» правка, вона має поїхати в хмару.
  importMany(list) {
    let n = 0;
    for (const r of list) {
      const c = sanitize(r);
      if (!c) continue;
      const merged = mergeEntry(entries[c.id], c);
      if (!sameVersion(merged, entries[c.id])) { entries[c.id] = merged; n++; emitLocal(merged, 'user'); }
    }
    if (n) { save(); emit(); }
    return n;
  },
  clear() { entries = {}; save(); emit(); },
};
