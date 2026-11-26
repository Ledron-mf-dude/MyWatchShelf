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
// rec — «лише з позначкою „раджу“»; поле є тільки коли ввімкнено, тож старі
// збережені умови лишаються тими самими. Роки навпаки міняємо місцями.
export function cleanListFilter(f) {
  f = f && typeof f === 'object' ? f : {};
  const mine = +f.mine;
  let from = year(f.from), to = year(f.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    kinds: [...new Set(Array.isArray(f.kinds) ? f.kinds.filter(k => KIND_IDS.includes(k)) : [])],
    from, to,
    status: STATUS_IDS.includes(f.status) ? f.status : 'all',
    genres: [...new Set(Array.isArray(f.genres) ? f.genres.filter(g => typeof g === 'string' && g && g.length <= 40) : [])].slice(0, 6),
    mine: Number.isInteger(mine) && mine >= 1 && mine <= 10 ? String(mine) : '',
    ...(f.rec === true ? { rec: true } : {}),
  };
}

export const isEmptyFilter = f => {
  const c = cleanListFilter(f);
  return !c.kinds.length && !c.from && !c.to && c.status === 'all' && !c.genres.length && !c.mine && !c.rec;
};

// Що з полиці підходить під умови добірки. Роки тут свої, не як у бібліотеці:
// лише «від» — від того року й далі, лише «до» — до того року включно.
export function listMatch(entries, f, sort = 'title', dir = 1) {
  const c = cleanListFilter(f), a = +c.from || 0, b = +c.to || 9999;
  const out = filterSort(entries, { ...c, from: '', to: '', status: c.status === 'all' ? undefined : c.status }, sort, dir);
  return c.from || c.to ? out.filter(e => { const y = parseInt(e.year, 10); return y >= a && y <= b; }) : out;
}

// Ручний вибір поверх умов: plus — позначене рукою, minus — зняте рукою.
// Показане = (те, що підходить під умови ∪ plus) \ minus; зміна умов їх не чіпає.
export const manualPick = (matchIds, plus, minus) => {
  const no = new Set(minus);
  return new Set([...matchIds, ...plus].filter(id => !no.has(id)));
};
// Клік по галочці: m = { plus, minus } (Set), matches — чи підходить запис під умови.
export function tickManual(m, id, matches, on) {
  if (on) { m.minus.delete(id); if (!matches) m.plus.add(id); }
  else { m.plus.delete(id); if (matches) m.minus.add(id); }
}

// Чи зайнята назва добірки (без огляду на регістр і пробіли по краях); except —
// добірка, яку саме редагують. Повертає наявну назву або ''.
export const nameTaken = (names, name, except = '') => {
  const k = v => String(v).trim().toLowerCase();
  return names.find(n => n !== except && k(n) === k(name)) || '';
};

// Сталий ключ добірки для посилання: 10 знаків [a-z0-9], створюється один раз.
const KEY_ABC = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const listKey = (bytes = crypto.getRandomValues(new Uint8Array(10))) => Array.from(bytes, b => KEY_ABC[b % 36]).join('');
const isKey = v => typeof v === 'string' && /^[a-z0-9]{6,16}$/.test(v) && !(v in Object.prototype);
// Мапа «ключ → назва» для публічного документа: лише добірки, що ще існують.
export const colsOf = (defs, names) =>
  Object.fromEntries(defs.filter(d => isKey(d.key) && names.includes(d.name)).slice(0, 60).map(d => [d.key, d.name]));

// «А, Б, В +2» — назви в підтвердженні й повідомленнях.
export const nameList = (titles, max = 6) =>
  titles.slice(0, max).join(', ') + (titles.length > max ? ` +${titles.length - max}` : '');

// Збереження добірки: які записи отримують який перелік міток. old — стара назва
// (порожньо — нова добірка), name — нова, picked — позначені id. Під час
// редагування склад замінюється рівно позначеним, а мітка перейменовується на місці.
export function listPlan(entries, old, name, picked) {
  const want = new Set(picked), out = { set: [], added: [], skipped: 0 };
  for (const e of entries) {
    const cur = e.lists || [], has = !!old && cur.includes(old);
    let next = cur;
    if (want.has(e.id)) {
      if (has) next = [...new Set(cur.map(l => (l === old ? name : l)))];
      else if (cur.includes(name)) continue;
      else if (cur.length >= LISTS_MAX) { out.skipped++; continue; }
      else { next = [...cur, name]; out.added.push(e.id); }
    } else if (has) next = cur.filter(l => l !== old);
    if (next.length !== cur.length || next.some((l, i) => l !== cur[i])) out.set.push([e.id, next]);
  }
  return out;
}

// Запис сховища listdefs; мітки видалення проходять повз очищення (synced.js).
// Є для кожної добірки (у зібраної вручну умови порожні): key — сталий ключ для
// посилання, plus/minus — додане й зняте рукою поверх умов. Необов'язкові поля
// пишемо лише коли вони є, тож старі записи не змінюються.
const ids = v => [...new Set(Array.isArray(v) ? v.filter(isId) : [])].slice(0, 500);
export function cleanListDef(r) {
  const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 40) : '';
  if (!name || r.id !== defId(name)) return null;
  const plus = ids(r.plus), minus = ids(r.minus);
  return {
    id: r.id, name, f: cleanListFilter(r.f), updated: Number.isFinite(r.updated) ? r.updated : 0,
    ...(isKey(r.key) ? { key: r.key } : {}), ...(plus.length ? { plus } : {}), ...(minus.length ? { minus } : {}),
  };
}

// Що змінить «переформувати добірку»: додати підходящі без мітки, прибрати
// мітку з тих, що вже не підходять; записи з 8 добірками пропускаємо.
// manual — { plus, minus } з умов добірки: додане рукою не прибираємо, зняте не додаємо.
export function listDiff(entries, name, f, manual = {}) {
  const hit = manualPick(listMatch(entries, f).map(e => e.id), ids(manual.plus), ids(manual.minus));
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
// Мітка часу з хмари не може бути з далекого майбутнього: її пише сам автор, а нею
// міряємо «нове». Допускаємо добу запасу на розбіг годинників.
export const SKEW = 864e5;
const stamp = (v, now) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), now + SKEW) : 0);

export function cleanReply(data, now = Date.now()) {
  const raw = data?.items && typeof data.items === 'object' ? data.items : {};
  const items = {};
  let count = 0;
  for (const [id, x] of Object.entries(raw)) {
    if (count >= 500) break;
    if (!isId(id) || !x || typeof x !== 'object') continue;
    const s = half(x.s), n = str(x.n, 500);
    if (!s && !n) continue;   // без оцінки й слів відповіді немає
    items[id] = {
      s, n, at: stamp(x.at, now), t: str(x.t, 300) || id,   // як у cleanRecs: без назви — id
      k: KIND_IDS.includes(x.k) ? x.k : 'series',
      y: str(typeof x.y === 'number' ? String(x.y) : x.y, 20),   // рік міг прийти числом
    };
    count++;
  }
  return { name: str(data?.name, 80), items, updated: stamp(Number(data?.updated), now) };
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
export const returnHash = h => (typeof h === 'string' && /^#u=[\w-]{1,128}(&l=[^#&]{1,400}|&c=[a-z0-9]{6,16})?(&me=1)?$/.test(h) ? h : '');

// «Надіслати мої оцінки»: тайтли списку, які я оцінив на полиці, а тут ще ні.
// skip — id, з яких я навмисно зняв оцінку на списках цього автора: їх не пропонуємо.
export function sendList(entries, items, mineItems, skip) {
  const sc = shelfScores(entries, items), no = new Set(skip);
  return items.filter(x => Object.hasOwn(sc, x.id) && !no.has(x.id) && !(Object.hasOwn(mineItems, x.id) && mineItems[x.id].s))
    .map(x => ({ id: x.id, t: x.t, s: sc[x.id] }));
}
// Перелік «назва — оцінка» для підтвердження; довгий обрізаємо до «+N».
export const scoreLines = (rows, max = 12) =>
  [...rows.slice(0, max).map(r => `${r.t} — ${r.s}`), ...(rows.length > max ? [`+${rows.length - max}`] : [])].join('\n');

// Пам'ять оцінювача на цьому пристрої, за автором списку: skip — з яких тайтлів я
// сам зняв оцінку, open — яким я востаннє бачив перемикач «оцінки бачать усі».
// Лежить у localStorage, тож чистимо: справжні uid та id, не більше 50 авторів
// (найсвіжіші за at) і 500 тайтлів на автора; мапа без прототипа.
export function cleanReplyMem(raw) {
  const rows = Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([k, v]) => isUid(k) && !(k in Object.prototype) && v && typeof v === 'object')
    .map(([k, v]) => [k, { skip: ids(v.skip), at: Number.isFinite(v.at) ? v.at : 0, ...(typeof v.open === 'boolean' ? { open: v.open } : {}) }]);
  return Object.assign(Object.create(null), Object.fromEntries(rows.sort((a, b) => b[1].at - a[1].at).slice(0, 50)));
}
// Чи казати помітно, що список тепер відкритий: у мене вже є оцінки на ньому, а
// відкритим я його ще не бачив (seen — останнє побачене значення перемикача).
export const openNotice = (open, nRated, seen) => open === true && nRated > 0 && seen !== true;

// Чи це власник дивиться власне посилання: з входом — за uid; без входу чи на
// знімку — коли відкрито кнопкою «Як бачить гість» (me) і всі тайтли є на полиці.
export const ownView = ({ uid, meUid, me, items, shelfIds }) => {
  if (uid && meUid) return uid === meUid;
  const have = new Set(shelfIds);
  return !!me && items.length > 0 && items.every(x => have.has(x.id));
};

// Записи сховища prefs: 'social' — чи відкриті оцінки друзям, 'seen' — коли
// власник востаннє дивився відповіді. Окремо, бо запис цілком замінюється
// свіжішим: позначка «бачив» зі старого пристрою тягла б за собою і старий
// перемикач приватності. Мітки видалення йдуть повз очищення.
export function cleanPrefs(r, now = Date.now()) {
  const updated = Number.isFinite(r?.updated) ? r.updated : 0;
  if (r?.id === 'seen') return { id: 'seen', seenAt: stamp(r.seenAt, now), updated };
  if (r?.id !== 'social') return null;
  // Раніше seenAt жив тут же: уже збережене значення лишаємо, щоб seenAtOf міг
  // його прочитати; нового сюди ніхто не пише.
  const old = stamp(r.seenAt, now);
  return { id: 'social', open: !!r.open, ...(old ? { seenAt: old } : {}), updated };
}
// Позначка «бачив»: власний запис, а поки його немає — стара з 'social'.
export const seenAtOf = (seen, social) => (seen ? seen.seenAt : social?.seenAt) || 0;

// Чи можна писати в синхронізоване сховище: без входу воно лише локальне, а з
// входом — тільки коли хмара вже віддала свій стан. Інакше запис із порожнього
// чи застарілого пристрою виграв би за часом і затер справжній.
export const canWrite = (signedIn, synced) => !signedIn || !!synced;

// Чи публікувати список відкритим для оцінок одне одного: лише коли налаштування
// вже приїхали з хмари й перемикач справді ввімкнено.
export const publishOpen = (prefsSynced, socialRec) => !!prefsSynced && socialRec?.open === true;

// ── друзі ─────────────────────────────────────────────────────────
// Запис сховища friends: живий друг (kind 'live', id === uid) або знімок
// чужого списку з посилання (kind 'snap', items — очищений масив). lists —
// назви добірок друга, посилання на які власник відкрив і запам'ятав: лише їх
// (і загальні рекомендації) показуємо як «радив». Мітки видалення ідуть повз
// очищення (synced.js).
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
    lists: [...new Set((Array.isArray(r.lists) ? r.lists : []).map(v => str(v, 40)).filter(Boolean))].slice(0, LISTS_MAX),
  };
  if (snap) out.items = cleanRecs({ items: r.items }).items;
  return out;
}

// Назва щойно запам'ятаної добірки — в кінець; коли місця немає, випадає найстаріша.
export const addList = (lists, name) => [...new Set([...(lists || []), ...(name ? [name] : [])])].slice(-LISTS_MAX);

// Що з публічного документа друга справді радили мені: загальні рекомендації
// (p !== 0) і тайтли з добірок, які я запам'ятав. Решта — добірки для інших.
export const recsFor = (friend, items) => {
  const mine = friend?.lists || [];
  return (items || []).filter(x => x.p !== 0 || (x.l || []).some(n => mine.includes(n)));
};

// Чи показувати «Запам'ятати» на сторінці друга: його ще немає; він додався сам,
// бо відповів (follow вимкнено); або це добірка, якої ще не запам'ятали.
export const needsKeep = (friend, listName) =>
  !friend || (friend.kind === 'live' && (!friend.follow || (!!listName && !friend.lists.includes(listName))));

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
    const rec = new Map(f.follow || f.kind === 'snap' ? recsFor(f, own(recs, f.id) ?? f.items ?? []).map(x => [x.id, x]) : []);
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

// Друзі, чиї рекомендації треба дочитати: стежимо, а копії в кеші ще немає
// (друга запам'ятали на іншому пристрої). `friends` — raw() сховища.
export const recsMissing = (friends, recs) =>
  friends.filter(f => !f.deleted && f.kind === 'live' && f.follow && !Object.hasOwn(recs, f.id));

// Скільки видимих друзів відповіли після останнього перегляду таблиці.
export const unseenCount = (table, replies, seenAt) =>
  table.cols.filter(c => (own(replies, c.id)?.updated || 0) > seenAt).length;

// Позначка «бачив»: не раніше за найновішу відповідь видимих друзів, бо годинник
// друга може поспішати, і тоді «нове» не згасло б. Лише власні поля replies.
export const seenStamp = (table, replies, now) =>
  table.cols.reduce((m, c) => Math.max(m, own(replies, c.id)?.updated || 0), now);

// uid потрапляє в шлях Firestore: пропускаємо лише звичайні ідентифікатори.
export const isUid = v => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

// Що змінилося у відповіді відносно останнього підтвердженого хмарою стану:
// у хмару йдуть лише ці тайтли, тож інша вкладка чи пристрій із тією самою
// відповіддю не втрачає оцінок, поставлених там. Елементи чистяться як у cleanReply.
export function replyPatch(prevItems, nextItems) {
  const a = cleanReply({ items: prevItems }).items, b = cleanReply({ items: nextItems }).items;
  const set = {};
  for (const [id, x] of Object.entries(b)) if (!Object.hasOwn(a, id) || JSON.stringify(a[id]) !== JSON.stringify(x)) set[id] = x;
  return { set, del: Object.keys(a).filter(id => !Object.hasOwn(b, id)) };
}

// Об'єкт для запису з об'єднанням (merge): підпис задає викликач (завжди той, що
// людина вписала сама), а не те, що прийшло у patch; DEL — мітка видалення поля
// (у хмарі це deleteField()), її теж дає викликач, щоб логіка лишалась чистою.
// Порожня різниця → null, писати нічого: порожня мапа items при об'єднанні
// означала б «заміни всі оцінки порожнім» і стерла б відповідь цілком.
export function replyWrite(patch, name, now, DEL) {
  const { items } = cleanReply({ items: patch?.set });
  for (const id of Array.isArray(patch?.del) ? patch.del : []) if (isId(id) && !Object.hasOwn(items, id)) items[id] = DEL;
  if (!Object.keys(items).length) return null;
  return { name: str(name, 80), items, updated: now };
}
