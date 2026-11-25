// Чиста логіка друзів і добірок за фільтром: без DOM і localStorage, тож
// працює й під Node. synced.js бере звідси очищення записів.
import { KIND_IDS, STATUS_IDS, filterSort, isId, str, half, cleanRecs } from './logic.js';

export const PUBLIC_MAX = 500, LISTS_MAX = 8, FRIENDS_MAX = 100;

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

// ── друзі ─────────────────────────────────────────────────────────
// Запис сховища friends: живий друг (kind 'live', id === uid) або знімок
// чужого списку з посилання (kind 'snap', items — очищений масив). Мітки
// видалення ідуть повз очищення (synced.js).
export function cleanFriend(r) {
  // uid Firebase і id знімка вкладаються в цей шаблон; службові слова не
  // ловимо поіменно, а читаємо мапи лише через own-перевірку (own нижче).
  const id = typeof r?.id === 'string' ? r.id : '';
  if (!/^[\w-]{1,128}$/.test(id) || id === '__proto__') return null;
  const snap = r.kind === 'snap';
  const num = v => (Number.isFinite(v) ? v : 0);
  const out = {
    id, uid: snap ? '' : id, name: str(r.name, 80).trim(), kind: snap ? 'snap' : 'live',
    follow: !!r.follow, added: num(r.added), updated: num(r.updated),
  };
  if (snap) out.items = cleanRecs({ items: r.items }).items;
  return out;
}

// Стабільний id знімка: FNV-1a від підпису й відсортованих id тайтлів, тож
// той самий список із того самого посилання не дублюється.
export function snapId(name, items) {
  let h = 0x811c9dc5;
  for (const ch of name + '|' + items.map(x => x.id).sort().join(',')) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  }
  return 's' + h.toString(16).padStart(8, '0');
}

// Живі друзі за порядком додавання; `friends` — raw() сховища, тож мітки
// видалення відсіюємо тут.
// Рівні `added` розв'язує id, щоб зріз до 100 був однаковий на всіх пристроях.
const liveFriends = friends => friends.filter(f => !f.deleted).sort((a, b) => a.added - b.added || a.id.localeCompare(b.id));
// replies і recs — звичайні об'єкти з id друга як ключем: «constructor» чи
// «toString» не повинні читатися з прототипа.
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

// Таблиця «тайтл × друзі». Оцінка з відповіді друга важить більше за його
// рекомендацію; рекомендації читаємо лише в тих, за ким стежимо (або зі знімка).
export function friendTable({ entries, friends, replies, recs }) {
  const all = liveFriends(friends), shown = all.slice(0, FRIENDS_MAX);
  const mine = new Map(entries.map(e => [e.id, e]));
  const cols = shown.map(f => ({ id: f.id, name: own(replies, f.uid)?.name || f.name }));
  const rows = new Map();
  for (const f of shown) {
    const reply = f.kind === 'live' ? own(replies, f.uid)?.items || {} : {};
    const rec = new Map(f.follow || f.kind === 'snap' ? (own(recs, f.id) ?? f.items ?? []).map(x => [x.id, x]) : []);
    for (const id of new Set([...Object.keys(reply), ...rec.keys()])) {
      const a = reply[id], b = rec.get(id), e = mine.get(id), src = a || b;
      const row = rows.get(id) || { id, t: e?.title || src.t || id, k: e?.kind || src.k, y: e?.year || src.y || '', mine: e?.score || 0, have: !!e, cells: new Map(), avg: 0, n: 0 };
      const cells = row.cells;
      // Відповідь без оцінки, але з текстом: оцінка — з рекомендації, коментар лишається (так задумано).
      cells.set(f.id, { s: a?.s || b?.s || 0, n: a?.n || b?.n || '', rec: !!b });
      rows.set(id, row);
    }
  }
  for (const r of rows.values()) {
    const sc = [...r.cells.values()].map(c => c.s).filter(s => s > 0);
    r.cells = Object.fromEntries(r.cells);   // для виклику — звичайний об'єкт; ключ «__proto__» відсіяв cleanFriend
    r.n = sc.length;
    r.avg = sc.length ? Math.round(sc.reduce((a, s) => a + s, 0) / sc.length * 10) / 10 : 0;
  }
  return { cols, hidden: all.length - shown.length, rows: [...rows.values()].sort((a, b) => b.avg - a.avg || a.t.localeCompare(b.t)) };
}

// Автори відповідей, яких у сховищі ще не було: мітка видалення теж «є»,
// інакше видалений друг повертався б, щойно відповість знову.
export function newReplyAuthors(friends, replies) {
  const known = new Set(friends.map(f => f.id));
  return Object.keys(replies).filter(uid => !known.has(uid));
}

// Скільки видимих друзів відповіли після останнього перегляду таблиці.
export const unseenCount = (table, replies, seenAt) =>
  table.cols.filter(c => (own(replies, c.id)?.updated || 0) > seenAt).length;

// uid потрапляє в шлях Firestore: пропускаємо лише звичайні ідентифікатори.
export const isUid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

// Документ відповіді для запису: підпис задає викликач (завжди той, що людина
// вписала сама), а не те, що прийшло у reply.
export function replyDoc(reply, name, now) {
  const { items } = cleanReply({ items: reply?.items });
  return { name: str(name, 80), items, updated: now };
}
