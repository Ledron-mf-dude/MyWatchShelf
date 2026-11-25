// Чиста логіка друзів і добірок за фільтром: без DOM і localStorage, тож
// працює й під Node. synced.js бере звідси очищення записів.
import { KIND_IDS, STATUS_IDS, filterSort, isId, str, half } from './logic.js';

export const PUBLIC_MAX = 500, LISTS_MAX = 8;

// Назва добірки йде в id документа Firestore: «/» і крапки там небезпечні
// (шлях, «.» і «..»), тому префікс і кодування. Живе тут, а не в synced.js,
// щоб не було циклу імпорту (synced.js імпортує cleanListDef звідси).
export const defId = name => 'l_' + encodeURIComponent(name);

const year = v => { const s = String(v ?? '').trim(); return /^\d{4}$/.test(s) ? s : ''; };

// Фільтр добірки з чого завгодно (хмара, посилання, localStorage) → відомий вигляд.
export function cleanListFilter(f) {
  f = f && typeof f === 'object' ? f : {};
  const mine = +f.mine;
  return {
    kinds: [...new Set(Array.isArray(f.kinds) ? f.kinds.filter(k => KIND_IDS.includes(k)) : [])],
    from: year(f.from), to: year(f.to),
    status: STATUS_IDS.includes(f.status) ? f.status : 'all',
    genres: [...new Set(Array.isArray(f.genres) ? f.genres.filter(g => typeof g === 'string' && g && g.length <= 40) : [])].slice(0, 6),
    mine: Number.isInteger(mine) && mine >= 1 && mine <= 10 ? String(mine) : '',
  };
}

export const isEmptyFilter = f => {
  const c = cleanListFilter(f);
  return !c.kinds.length && !c.from && !c.to && c.status === 'all' && !c.genres.length && !c.mine;
};

// Запис сховища listdefs; мітки видалення проходять повз очищення (synced.js).
export function cleanListDef(r) {
  const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 40) : '';
  if (!name || r.id !== defId(name)) return null;
  return { id: r.id, name, f: cleanListFilter(r.f), updated: Number.isFinite(r.updated) ? r.updated : 0 };
}

// Що змінить «переформувати добірку»: додати підходящі без мітки, прибрати
// мітку з тих, що вже не підходять; записи з 8 добірками пропускаємо.
export function listDiff(entries, name, f) {
  const c = cleanListFilter(f);
  const hit = new Set(filterSort(entries, { ...c, status: c.status === 'all' ? undefined : c.status }, 'title', 1).map(e => e.id));
  const has = e => (e.lists || []).includes(name);
  const out = { add: [], drop: [], skip: [] };
  for (const e of entries) {
    if (hit.has(e.id) && !has(e)) (e.lists?.length >= LISTS_MAX ? out.skip : out.add).push(e);
    else if (!hit.has(e.id) && has(e)) out.drop.push(e);
  }
  return out;
}

// Скільки записів понад межу публікації вийде, якщо addIds отримають мітку:
// опублікований — це рекомендований або такий, що вже в якійсь добірці.
export function publicOver(entries, addIds) {
  const isPub = e => e.rec || e.lists?.length;
  const add = new Set(addIds);
  const total = entries.filter(e => isPub(e) || add.has(e.id)).length;
  return Math.max(0, total - PUBLIC_MAX);
}

// ── відповідь друга ───────────────────────────────────────────────
// Один документ на друга: його оцінки й коментарі до тайтлів чужого списку.
// Назва, тип і рік лежать у самому елементі, щоб власник бачив відповідь і без
// тайтла у своїй полиці. Ключ — лише справжній id IMDb: інакше в документ
// потрапить що завгодно.
export function cleanReply(data) {
  const raw = data?.items && typeof data.items === 'object' ? data.items : {};
  const items = {};
  let count = 0;
  for (const [id, x] of Object.entries(raw)) {
    if (count >= 500) break;
    if (!isId(id) || !x || typeof x !== 'object') continue;
    const s = half(x.s), n = str(x.n, 500);
    if (!s && !n) continue;   // без оцінки й слів відповіді немає
    items[id] = {
      s, n, at: Number.isFinite(x.at) ? x.at : 0, t: str(x.t, 300) || id,   // як у cleanRecs: без назви — id
      k: KIND_IDS.includes(x.k) ? x.k : 'series',
      y: str(typeof x.y === 'number' ? String(x.y) : x.y, 20),   // рік міг прийти числом
    };
    count++;
  }
  const updated = Number(data?.updated);
  return { name: str(data?.name, 80), items, updated: Number.isFinite(updated) ? updated : 0 };
}

// x — елемент рекомендацій ({ id, k, t, y }).
export const replyItem = (x, s, n, now) => ({ s, n, at: now, t: x.t, k: x.k, y: x.y });

// Чи показувати другові оцінювання: у знімку (без ownerUid) і на власному
// посиланні оцінювати нікому; без входу — пропонуємо ввійти.
export const replyMode = ({ ownerUid, meUid, signedIn }) =>
  !ownerUid || ownerUid === meUid ? 'none' : signedIn ? 'rate' : 'signin';

// Мої оцінки з полиці для тайтлів чужого списку («Надіслати мої оцінки»).
export function shelfScores(entries, items) {
  const have = new Set(items.map(x => x.id));
  const out = {};
  for (const e of entries) if (have.has(e.id) && e.score > 0) out[e.id] = e.score;
  return out;
}

// Куди повернути людину після входу: лише адреса чужого списку (#u=…).
// Значення лежить у localStorage, тож перевіряємо і при записі, і при читанні.
export const returnHash = h => (typeof h === 'string' && /^#u=[\w-]{1,128}(&l=[^#&]{1,400})?$/.test(h) ? h : '');

// Запис сховища prefs: єдиний запис 'social' — чи відкриті оцінки друзям і
// коли власник востаннє дивився відповіді. Мітки видалення йдуть повз очищення.
export function cleanPrefs(r) {
  if (r?.id !== 'social') return null;
  return { id: 'social', open: !!r.open, seenAt: Number.isFinite(r.seenAt) ? r.seenAt : 0, updated: Number.isFinite(r.updated) ? r.updated : 0 };
}
