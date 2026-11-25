// Оцінки друга на сторінці чужого списку (#u=…): ряд балів і коментар на
// кожній картці, «Надіслати мої оцінки» і оцінки інших друзів. Сторінка
// передає сюди свій стан аргументами (recs): views.js і app.js імпортують
// цей модуль, тож він не може імпортувати їх у відповідь (цикл).
import { esc, fmtScore, kindLabel, KIND_IDS } from './logic.js';
import { replyItem, replyMode, shelfScores, snapId, friendTable, newReplyAuthors, unseenCount, seenStamp, seenAtOf, canWrite, recsMissing, FRIENDS_MAX } from './social.js';
import { t, tn } from './i18n.js';
import { store } from './store.js';
import { friends, listdefs, prefs, socialCache } from './synced.js';
import { cloud } from './cloud.js';
import { setCardExtra } from './panel.js';
import { $, app, layer, ui, icon, ph, remember, showOverlay, toast, promptBox, confirmBox } from './ui.js';

const blank = () => ({ name: '', items: {} });
// key — чия відповідь і на чиєму списку: коли змінюється (інший список, вхід,
// вихід), стан скидається. ready — власну відповідь уже завантажено; поки ні,
// оцінювати не можна: запис нижче перезаписує документ цілком.
const rs = { key: '', owner: '', ready: false, mine: blank(), saved: {}, others: {}, confirmed: false };
let cur = null, redraw = () => {}, wasKey = null, chain = Promise.resolve();
const timers = new Map();   // id тайтла → таймер збереження коментаря

const meUid = () => cloud.user?.uid || '';
const modeOf = recs => replyMode({ ownerUid: recs?.uid || '', meUid: meUid(), signedIn: !!cloud.user });
const xOf = id => cur?.items.find(x => x.id === id);
const missing = recs => Object.keys(shelfScores(store.list(), recs.items)).filter(id => !rs.mine.items[id]?.s);

// ── розмітка ──────────────────────────────────────────────────────
// Обгортка з власною дією-«пустушкою»: клік у полі не відкриває перегляд картки.
export function replyBox(x, recs) {
  const mode = modeOf(recs);
  if (mode === 'none') return '';
  if (mode === 'signin') return `<div class="reply" data-act="reply-box"><button class="btn" data-act="rate-signin">${icon('user')}${t('reply.signin')}</button></div>`;
  const it = rs.mine.items[x.id], s = it?.s || 0, dis = rs.ready ? '' : 'disabled';
  return `<div class="reply" data-act="reply-box">
    <h4>${t('reply.label')} <small>${s ? fmtScore(s) : ''}</small></h4>
    <div class="scores">${Array.from({ length: 10 }, (_, i) =>
      `<button data-act="rate" data-v="${i + 1}" class="${s >= i + 1 ? 'fill' : ''} ${Math.floor(s) === i + 1 ? 'on' : ''}" aria-pressed="${Math.floor(s) === i + 1}" ${dis}>${i + 1}</button>`).join('')}
      <button data-act="rate-half" class="half ${s % 1 ? 'on' : ''}" aria-pressed="${!!(s % 1)}" aria-label="${t('score.half')}" title="${t('score.half')}" ${rs.ready && s >= 1 && s < 10 ? '' : 'disabled'}>+½</button></div>
    <input class="inp" type="text" data-reply-note maxlength="500" placeholder="${t('reply.note.ph')}" value="${esc(it?.n || '')}" ${dis}>
  </div>`;
}

// Оцінки інших друзів — лише коли автор відкрив список.
export function othersLine(id, recs) {
  if (!recs?.open || modeOf(recs) !== 'rate' || !rs.ready) return '';
  const rows = Object.entries(rs.others).filter(([uid, r]) => uid !== meUid() && r.items[id]).slice(0, 10);
  if (!rows.length) return '';
  return `<div class="others"><h4>${t('reply.others')}</h4>${rows.map(([, r]) => {
    const it = r.items[id];
    return `<p><b>${esc(r.name || t('reply.anon'))}</b>${it.s ? ` <span class="sc">${fmtScore(it.s)}</span>` : ''}${it.n ? ` <span class="muted">${esc(it.n)}</span>` : ''}</p>`;
  }).join('')}</div>`;
}

// Контейнер лишається й порожнім: на нього опирається paintBar().
export function replyBar(recs) {
  if (modeOf(recs) !== 'rate') return '';
  const n = rs.ready ? missing(recs).length : 0;
  return `<div class="reply-bar">${n ? `<button class="btn primary" data-act="rate-all">${icon('upload')}${t('reply.all')}<small>${n}</small></button>` : ''}</div>`;
}

// Малюємо картку чи смугу на місці — без перемальовування сторінки, щоб не
// збити фокус і прокрутку.
const paint = id => {
  const el = document.querySelector(`.rcard[data-id="${CSS.escape(id)}"] .reply`), x = xOf(id);
  if (el && x) el.outerHTML = replyBox(x, cur);
};
const paintBar = () => { const el = document.querySelector('.reply-bar'); if (el && cur) el.outerHTML = replyBar(cur); };

// ── стан ──────────────────────────────────────────────────────────
export function loadReplyState(recs, redrawFn) {
  cur = recs; redraw = redrawFn;
  const key = `${recs?.uid || ''}|${meUid()}`;
  if (key === rs.key) return;
  flushNotes();   // недописаний коментар піде ще у стару відповідь
  const first = wasKey === null;
  wasKey = key;
  Object.assign(rs, { key, owner: recs?.uid || '', ready: false, mine: blank(), saved: {}, others: {}, confirmed: false });
  if (!first) redraw();
  if (modeOf(recs) !== 'rate') return;
  const me = meUid();
  Promise.all([
    cloud.loadReply(rs.owner, me),
    // чужі оцінки — додаток: їхня відсутність не заважає оцінювати
    recs.open ? cloud.loadReplies(rs.owner).catch(e => { console.warn('оцінки друзів', e); return {}; }) : {},
  ]).then(([mine, others]) => {
    if (rs.key !== key) return;
    Object.assign(rs, { ready: true, mine: mine || blank(), saved: structuredClone((mine || blank()).items), others });
    redraw();
  }).catch(e => { if (rs.key === key) toast(t('toast.reply.fail', { e: e?.message || '' }), { ms: 5000 }); });
}

// Перша відповідь: потрібен підпис, а на відкритому списку ще й згода, що
// оцінки бачать усі друзі автора. Відмова — нічого не зберігаємо.
const needsAsk = () => !store.settings.name || (cur?.open && !rs.confirmed && !Object.keys(rs.mine.items).length);
async function mayReply() {
  const key = rs.key;
  if (!rs.ready) return false;
  if (!store.settings.name) {
    const v = await promptBox({ title: t('menu.name'), text: t('name.text'), value: store.settings.name || '', placeholder: t('name.ph') });
    if (!v) return false;
    store.setSetting('name', v.slice(0, 80));
    cloud.publishNow().catch(() => {});
  }
  if (cur?.open && !rs.confirmed && !Object.keys(rs.mine.items).length
    && !await confirmBox({ title: t('reply.open.title'), text: t('reply.open.text'), ok: t('reply.open.ok') })) return false;
  rs.confirmed = true;
  return rs.key === key;   // поки висів діалог, людина могла піти зі сторінки
}

// Елемент без оцінки й коментаря у відповіді не тримаємо.
function apply(id, s, n) {
  const prev = rs.mine.items[id];
  if (s || n) rs.mine.items[id] = replyItem(xOf(id), s, n, Date.now());
  else delete rs.mine.items[id];
  return prev;
}
// Без мережі не надсилаємо взагалі: запис завис би в черзі, а на екрані
// висіла б оцінка, якої в хмарі немає. Стан при цьому не міняємо.
const offline = () => {
  if (navigator.onLine !== false) return false;
  toast(t('toast.reply.offline'), { ms: 5000 });
  return true;
};
// Надсилаємо чергою, щоб відповіді не обганяли одна одну. rs.saved — останній
// підтверджений хмарою стан: не вдалося — повертаємо його і перемальовуємо все,
// тож на екрані не лишається оцінка, якої немає в хмарі (які б збої не йшли підряд).
function send() {
  // Стан знімаємо тут, а не в черзі: за цей час список чи акаунт могли змінитись,
  // і тоді нова чи порожня відповідь пішла б у документ старого власника.
  const key = rs.key, owner = rs.owner, sent = structuredClone(rs.mine.items);
  chain = chain.then(() => {
    if (rs.key !== key) return false;
    return cloud.sendReply(owner, { items: sent }).then(() => { if (rs.key === key) rs.saved = sent; return true; });
  }).catch(e => {
    if (rs.key === key) {
      rs.mine.items = structuredClone(rs.saved);
      document.querySelectorAll('.rcard[data-id]').forEach(el => paint(el.dataset.id));
      paintBar();
    }
    toast(t('toast.reply.fail', { e: e?.message || '' }), { ms: 5000 });
    return false;
  });
  return chain;
}

async function setScore(el, pick) {
  const id = el.closest('[data-id]')?.dataset.id;
  if (!cur || !xOf(id) || !rs.ready) return;
  const key = rs.key, input = el.closest('.reply').querySelector('[data-reply-note]');
  const n = input ? input.value.trim() : rs.mine.items[id]?.n || '';
  clearTimeout(timers.get(id)); timers.delete(id);
  if (!await mayReply() || rs.key !== key || offline()) return;
  const s = pick(rs.mine.items[id]?.s || 0);
  apply(id, s, n);
  paint(id); paintBar();
  if (!await send()) return;
  // На полиці оцінку міняємо лише там, де тайтл уже є, і лише ставимо: знята
  // тут оцінка не стирає власну оцінку з полиці. Нових записів не створюємо.
  if (s > 0 && store.get(id)) { flushNotes(); store.save(id, { score: s }); }
}

async function saveNote(id, text) {
  if (!cur || !xOf(id) || !rs.ready) return;
  const key = rs.key, n = text.trim().slice(0, 500);
  if ((rs.mine.items[id]?.n || '') === n) return;
  if (!await mayReply() || rs.key !== key || offline()) return;
  apply(id, rs.mine.items[id]?.s || 0, n);
  send();
}
function flushNote(id) {
  clearTimeout(timers.get(id)); timers.delete(id);
  const inp = document.querySelector(`.rcard[data-id="${CSS.escape(id)}"] [data-reply-note]`);
  if (inp) saveNote(id, inp.value);
}
const flushNotes = () => [...timers.keys()].forEach(flushNote);

// Коментар зберігається за 500 мс після набору (як pending у panel.js) і при
// виході з поля. Питання про підпис чи згоду посеред набору не вискакує:
// тоді чекаємо виходу з поля.
const noteId = ev => (ev.target.matches?.('[data-reply-note]') ? ev.target.closest('[data-id]')?.dataset.id : '');
document.addEventListener('input', ev => {
  const id = noteId(ev);
  if (!id) return;
  clearTimeout(timers.get(id));
  if (!needsAsk()) timers.set(id, setTimeout(() => flushNote(id), 500));
});
document.addEventListener('change', ev => { const id = noteId(ev); if (id) flushNote(id); });

// ── запам'ятати друга ─────────────────────────────────────────────
// Живе посилання — за uid, знімок — за відбитком підпису й тайтлів. Видалений
// друг (мітка видалення) для get() не існує, тож кнопка повертається, а save
// його воскрешає.
const nameOf = recs => (recs.name || '').slice(0, 80);
const friendId = recs => (recs.uid || snapId(nameOf(recs), recs.items));
export function keepButton(recs) {
  if (!recs || (recs.uid && recs.uid === meUid()) || friends.get(friendId(recs))) return '';
  return `<button class="btn lg" data-act="friend-keep">${icon('user')}${t('fr.keep')}</button>`;
}

// У кеші лишаємо рекомендації лише тих, за ким досі стежимо: видалений чи
// відписаний друг не засмічує кеш.
const followed = id => { const f = friends.get(id); return !!f && f.kind === 'live' && f.follow; };
const prunedRecs = () => Object.fromEntries(Object.entries(socialCache.get().recs).filter(([k]) => followed(k)));
const cacheRecs = (id, items) => {
  const recs = prunedRecs();
  if (followed(id)) recs[id] = items;
  socialCache.set({ recs });
};
// Помилка не зупиняє решту; null (публічного документа немає) кеш не стирає.
// Пізня відповідь не пишеться, якщо за цей час змінилась людина чи друга вже нема.
// Той самий запит двічі не шлемо; ключ — разом з людиною, бо запит, початий до
// входу, буде відкинуто, і після входу потрібен новий.
const pulling = new Set();
const pullRecs = f => {
  const me = meUid(), k = `${me}|${f.id}`;
  if (pulling.has(k)) return Promise.resolve();
  pulling.add(k);
  return cloud.loadPublic(f.uid).then(r => { if (r && meUid() === me && followed(f.id)) { cacheRecs(f.id, r.items); socialRedraw(); } })
    .catch(e => console.warn('рекомендації друга', e))
    .finally(() => pulling.delete(k));
};

export const friendActions = {
  'friend-keep': () => {
    if (!cur || (cur.uid && cur.uid === meUid()) || friends.get(friendId(cur))) return;
    const id = friendId(cur), name = nameOf(cur), added = Date.now();
    if (cur.uid) {
      friends.save(id, { uid: id, name, kind: 'live', follow: true, added });
      cacheRecs(id, cur.items);
      pullRecs({ id, uid: id });   // на сторінці могла бути лише одна добірка — беремо весь список
    } else friends.save(id, { name, kind: 'snap', follow: true, items: cur.items, added });
    redraw();
  },
};

// ── відповіді, кеш і оновлення ────────────────────────────────────
let unwatch = null, watching = '', socialRedraw = () => {};
const syncKey = () => `${cloud.synced('friends')}|${cloud.synced('prefs')}`;
let lastReplies = null, syncedWas = syncKey();
// Чи можна вже писати у сховище: з входом — лише після його першого знімка з хмари.
const ready = name => canWrite(!!cloud.user, cloud.synced(name));
const seenAt = () => seenAtOf(prefs.get('seen'), prefs.get('social'));
// Авторів відповідей додаємо, лише коли друзі вже приїхали з хмари: на порожньому
// пристрої ми не знаємо ні про видалених, ні про запам'ятаних, а свіжий запис
// «follow: false» переміг би їх на всіх пристроях. До того тримаємо останні відповіді.
function autoAdd() {
  if (!lastReplies || watching !== meUid() || !ready('friends')) return;
  const map = lastReplies;
  // Не більше, ніж лишилось до межі: далі таблиця все одно показує перші FRIENDS_MAX.
  const room = Math.max(0, FRIENDS_MAX - friends.list().length);
  for (const uid of newReplyAuthors(friends.raw(), map).slice(0, room)) friends.save(uid, { uid, name: map[uid].name, kind: 'live', follow: false, added: Date.now() });
}
function onReplies(map) {
  socialCache.set({ replies: map });
  lastReplies = map;
  autoAdd();
  socialRedraw();
}
// watchReplies мовчки нічого не робить без cloud.user і сам не підписується
// після входу — тож слідкуємо за uid і підписуємось наново при кожній зміні.
function syncWatch() {
  const uid = meUid();
  // Сховище щойно отримало стан хмари: доробляємо відкладене (авто-додавання,
  // позначка «бачив» при перемальовуванні екрана «Друзі»).
  const sy = syncKey(), flipped = sy !== syncedWas;
  syncedWas = sy;
  if (uid === watching) { if (flipped) { autoAdd(); later(); } return; }
  unwatch?.(); unwatch = null; watching = uid; lastReplies = null;
  if (uid) unwatch = cloud.watchReplies(map => { if (watching === uid) onReplies(map); });
  // Запит, початий при запуску (вхід ще не відновився), буде відкинуто: тягнемо наново.
  pullAll();
}
const pullAll = () => {
  if (!cloud.available) return;
  socialCache.set({ recs: prunedRecs() });   // заодно чистимо кеш від тих, за ким не стежимо
  friends.list().filter(f => f.kind === 'live' && f.follow).forEach(pullRecs);
};
// Сховища змінюються й з хмари (інший пристрій): перемальовуємо один раз на
// пачку змін. Самі обробники у сховища нічого не пишуть — лише читають і малюють.
let started = false, queued = false, friendsChanged = false;
const pullMissing = () => { if (cloud.available) recsMissing(friends.raw(), socialCache.get().recs).forEach(pullRecs); };
const later = () => {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    if (friendsChanged) { friendsChanged = false; pullMissing(); }
    drawManage(); socialRedraw();
  });
};

const tableOf = c => friendTable({ entries: store.list(), friends: friends.raw(), replies: c.replies, recs: c.recs });
export const social = {
  table: () => tableOf(socialCache.get()),
  // Крапка «нове»: хтось відповів після останнього перегляду екрана «Друзі».
  unseen: () => {
    const c = socialCache.get();
    return unseenCount(tableOf(c), c.replies, seenAt());
  },
  start(redrawFn) {
    socialRedraw = redrawFn;
    if (started) return;
    started = true;
    cloud.onChange(syncWatch);
    syncWatch();
    pullAll();
    addEventListener('online', pullAll);
    friends.onChange(() => { friendsChanged = true; later(); });
    prefs.onChange(later);
    listdefs.onChange(later);
  },
};

export const replyActions = {
  'reply-box': () => 'keep',
  rate: (v, el) => setScore(el, s => (s === +v ? 0 : +v)),
  'rate-half': (v, el) => setScore(el, s => (s >= 1 && s < 10 ? (s % 1 ? Math.floor(s) : s + 0.5) : s)),
  'rate-signin': () => { try { cloud.signIn(); } catch (err) { toast(t('toast.signin.fail', { e: err.message }), { ms: 5000 }); } },
  // Мої оцінки з полиці для тайтлів списку, яких ще немає у відповіді — одним записом.
  'rate-all': async () => {
    if (!cur || !rs.ready) return;
    const key = rs.key, ids = missing(cur);
    if (!ids.length || !await mayReply() || rs.key !== key || offline()) return;
    const sc = shelfScores(store.list(), cur.items);
    for (const id of ids) apply(id, sc[id], rs.mine.items[id]?.n || '');
    ids.forEach(paint); paintBar();
    if (await send()) toast(t('toast.reply.sent', { n: ids.length }));
  },
};

// ── екран «Друзі» ─────────────────────────────────────────────────
// Фільтри живуть тут, а не у views.js: той імпортує цей модуль, а не навпаки.
const fr = { who: '', kind: 'all' };
// Ключ — id друга, а він може збігтись зі службовим словом («constructor»):
// читаємо мапу лише через own-перевірку.
const cellOf = (r, id) => (Object.hasOwn(r.cells, id) ? r.cells[id] : null);
const chip = (act, v, on, label) => `<button class="chip ${on ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${label}</button>`;
const colName = c => c.name || t('fr.unsigned');

// Коментар друга йде і в title (широкий екран), і під оцінкою (вузький, CSS).
function frCell(c) {
  if (!c) return '<td class="fr-c"></td>';
  return `<td class="fr-c"${c.n ? ` title="${esc(c.n)}"` : ''}><span class="fr-s">${c.s ? fmtScore(c.s) : '·'}</span>${c.rec ? `<span class="fr-rec" title="${t('fr.rec')}" aria-label="${t('fr.rec')}">${icon('starFill')}</span>` : ''}${c.n ? `<small class="fr-n">${esc(c.n)}</small>` : ''}</td>`;
}
function frRow(r, cols) {
  // тайтла немає на полиці — запам'ятовуємо для перегляду й дії take (за data-id)
  if (!r.have) remember({ id: r.id, type: r.k === 'movie' ? 'movie' : 'series', kind: r.k, title: r.t, year: r.y });
  return `<tr class="fr-row" data-id="${esc(r.id)}" data-act="${r.have ? 'open' : 'preview'}" tabindex="0">
    <th scope="row" class="fr-t"><div>${ph(r.id, r.t, 'small')}<span><b>${esc(r.t)}</b><small>${esc([kindLabel(r.k), r.y].filter(Boolean).join(' · '))}</small></span>
      ${r.have ? '' : `<button class="rb" data-act="take" title="${t('take')}" aria-label="${t('take')}">${icon('plus')}</button>`}</div></th>
    <td class="fr-c me"><span class="fr-s">${r.mine ? fmtScore(r.mine) : ''}</span></td>
    ${cols.map(c => frCell(cellOf(r, c.id))).join('')}
    <td class="fr-c avg"${r.n ? ` title="${esc(t('fr.avg.n', { n: r.n }))}"` : ''}><span class="fr-s">${r.n ? fmtScore(r.avg) : ''}</span></td></tr>`;
}

// Секція картки: середня й оцінки друзів цього тайтла; без жодної оцінки — нічого.
function friendsBlock(id) {
  const tb = social.table(), r = tb.rows.find(x => x.id === id);
  const list = r ? tb.cols.map(c => [c, cellOf(r, c.id)]).filter(([, c]) => c && (c.s || c.n || c.rec)) : [];
  if (!list.length) return '';
  return `<section class="fr-card"><h3>${t('nav.friends')} <small>${r.n ? `${t('fr.avg')} ${fmtScore(r.avg)}` : ''}</small></h3>
    ${list.map(([f, c]) => `<p><b>${esc(colName(f))}</b>${c.s ? ` <span class="fr-s">${fmtScore(c.s)}</span>` : ''}${c.rec ? ` <span class="fr-rec" title="${t('fr.rec')}" aria-label="${t('fr.rec')}">${icon('starFill')}</span>` : ''}${c.n ? ` <span class="muted">${esc(c.n)}</span>` : ''}</p>`).join('')}
    <a class="more" href="#/friends">${t('fr.card.all')} ${icon('chevR')}</a></section>`;
}
setCardExtra(friendsBlock);

export function renderFriends() {
  const c = socialCache.get(), tb = tableOf(c);
  // Відкрили екран — усе, що було, вважаємо баченим (зберігаємо лише коли є що, а з
  // входом — коли налаштування вже приїхали з хмари; тоді екран перемалюється сам).
  if (unseenCount(tb, c.replies, seenAt()) > 0 && ready('prefs')) prefs.save('seen', { seenAt: seenStamp(tb, c.replies, Date.now()) });
  if (!tb.cols.some(x => x.id === fr.who)) fr.who = '';   // друга видалили
  const cols = fr.who ? tb.cols.filter(x => x.id === fr.who) : tb.cols;
  const rows = tb.rows.filter(r => (!fr.who || cellOf(r, fr.who)) && (fr.kind === 'all' || r.k === fr.kind));
  const head = `<header class="page-head"><h1>${t('nav.friends')}</h1><span class="count">${tb.rows.length} ${tn('title', tb.rows.length)}</span>
    <span class="grow"></span><button class="btn" data-act="fr-manage">${icon('user')}${t('fr.manage')}</button></header>`;
  if (!tb.rows.length) {
    app.innerHTML = `${head}<div class="empty">${icon('user')}<b>${t('fr.empty.title')}</b><p>${t('fr.empty.text')}</p>
      <button class="btn primary" data-act="share">${icon('share')}${t('menu.share')}</button></div>`;
    return;
  }
  app.innerHTML = `${head}
    <div class="chips fr-chips">${chip('fr-who', '', !fr.who, t('fr.all'))}${tb.cols.map(x => chip('fr-who', x.id, fr.who === x.id, esc(colName(x)))).join('')}</div>
    <div class="chips fr-chips">${['all', ...KIND_IDS].map(k => chip('fr-kind', k, fr.kind === k, k === 'all' ? t('all.kinds') : t('kinds.' + k))).join('')}</div>
    ${rows.length ? `<div class="fr-wrap"><table class="fr-table"><thead><tr><th scope="col" class="fr-t">${t('fr.title')}</th><th scope="col" class="fr-c">${t('fr.me')}</th>
      ${cols.map(x => `<th scope="col" class="fr-c" title="${esc(colName(x))}"><span>${esc(colName(x))}</span></th>`).join('')}<th scope="col" class="fr-c">${t('fr.avg')}</th></tr></thead>
      <tbody>${rows.map(r => frRow(r, cols)).join('')}</tbody></table></div>`
      : `<div class="empty small"><b>${t('fr.none')}</b></div>`}`;
}

// ── керування друзями (оверлей) ───────────────────────────────────
const SNAP_ID = /^s[0-9a-f]{8}$/;   // id знімка (snapId): його тайтлів уже нема, повернути не можна
const drawManage = () => {
  if (ui.overlay?.type !== 'friends') return;
  const c = socialCache.get(), tb = tableOf(c), open = !!prefs.get('social')?.open;
  const gone = friends.raw().filter(f => f.deleted && !SNAP_ID.test(f.id));
  const friend = col => {
    const f = friends.get(col.id), snap = f?.kind === 'snap';
    if (!f) return '';
    const hasRecs = f.follow || Object.hasOwn(c.recs, f.id);
    return `<div class="fr-man"><div class="fr-man-h"><b>${esc(colName(col))}</b>${snap ? `<small class="muted">${t('fr.snap')}</small>` : ''}</div>
      <div class="fr-man-a">
        ${snap ? '' : chip('fr-follow', f.id, f.follow, `${icon('star')}${t('fr.follow')}`)}
        ${hasRecs ? `<button class="chip" data-act="fr-drop-recs" data-v="${esc(f.id)}">${t('fr.drop')}</button>` : ''}
        <button class="chip danger" data-act="fr-del" data-v="${esc(f.id)}">${icon('trash')}${t('fr.del')}</button></div></div>`;
  };
  $('.palette', layer).innerHTML = `
    <div class="pal-head"><h2>${t('fr.manage')}</h2><button class="rb" data-act="close" aria-label="${t('close')}">${icon('close')}</button></div>
    <div class="pal-body fr-manage">
      <button class="toggle ${open ? 'on' : ''}" data-act="fr-open" aria-pressed="${open}"><span><b>${t('fr.open')}</b><small>${t('fr.open.sub')}</small></span><i></i></button>
      ${tb.cols.length ? tb.cols.map(friend).join('') : `<p class="muted small">${t('fr.nofriends')}</p>`}
      ${gone.length || tb.hidden ? `<h4>${t('fr.hidden')}</h4>` : ''}
      ${gone.map(f => `<div class="fr-man"><div class="fr-man-h"><b>${esc((Object.hasOwn(c.replies, f.id) && c.replies[f.id].name) || t('fr.unsigned'))}</b>
        <button class="chip" data-act="fr-restore" data-v="${esc(f.id)}">${icon('refresh')}${t('restore')}</button></div></div>`).join('')}
      ${tb.hidden ? `<p class="muted small">${t('fr.more', { n: tb.hidden })}</p>` : ''}
    </div>`;
};
// Таблиця під оверлеєм перемалюється, коли його закриють (ui.dirty).
const manageDone = () => { ui.dirty = true; drawManage(); };

Object.assign(friendActions, {
  'fr-who': v => { fr.who = v; renderFriends(); },
  'fr-kind': v => { fr.kind = v; renderFriends(); },
  'fr-manage': () => {
    showOverlay({ type: 'friends' }, `<div class="palette narrow" role="dialog" aria-label="${t('fr.manage')}"></div>`);
    drawManage();
  },
  // До першого знімка з хмари локальний перемикач може бути застарілим: перемкнувши
  // його, опублікували б не те, що людина бачить на інших пристроях.
  'fr-open': () => {
    if (!ready('prefs')) { toast(t('toast.syncing')); return; }
    prefs.save('social', { open: !prefs.get('social')?.open });
    manageDone();
  },
  'fr-follow': v => {
    const f = friends.get(v);
    if (!f || f.kind !== 'live') return;
    friends.save(v, { follow: !f.follow });
    if (!f.follow) pullRecs({ id: v, uid: v });   // нові рядки зʼявляються без ручного перемальовування (pullRecs малює сам)
    manageDone();
  },
  // Знімок без рекомендацій не має сенсу — прибираємо запис; живий друг лишається, але без добірки в кеші.
  'fr-drop-recs': async v => {
    const f = friends.get(v);
    if (!f) return;
    if (f.kind === 'snap') {
      if (!await confirmBox({ title: t('fr.drop.snap.title'), text: t('fr.drop.snap.text'), ok: t('fr.drop'), danger: true })) return;
      friends.remove(v);
    }
    else { friends.save(v, { follow: false }); socialCache.set({ recs: prunedRecs() }); }
    manageDone();
  },
  'fr-del': async v => {
    const f = friends.get(v);
    if (!f) return;
    const rep = socialCache.get().replies, name = (Object.hasOwn(rep, v) && rep[v].name) || f.name || t('fr.unsigned');
    if (!await confirmBox({ title: t('fr.del.title', { name }), text: t('fr.del.text'), ok: t('fr.del'), danger: true })) return;
    friends.remove(v);
    socialCache.set({ recs: prunedRecs() });
    // Відповідь у хмарі стираємо, не чекаючи: без мережі вона полежить до наступного разу.
    if (f.kind === 'live' && cloud.user) cloud.deleteReply(cloud.user.uid, v).catch(e => console.warn('видалення відповіді', e));
    manageDone();
  },
  // Мітка видалення імені не має: ім'я підтягнеться з відповіді, коли вона є (friendTable).
  'fr-restore': v => {
    if (!friends.raw().some(f => f.id === v && f.deleted && !SNAP_ID.test(v))) return;
    friends.save(v, { uid: v, name: '', kind: 'live', follow: false, added: Date.now() });
    manageDone();
  },
});
