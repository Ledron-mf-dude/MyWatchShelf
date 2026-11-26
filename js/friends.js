// Оцінки друга на сторінці чужого списку (#u=…): ряд балів і коментар на
// кожній картці, «Надіслати мої оцінки» і оцінки інших. Сторінка передає сюди
// свій стан аргументами (recs): views.js і app.js імпортують цей модуль, тож
// він не може імпортувати їх у відповідь (цикл). Розмітку віддаємо шматками
// (replyParts), а views.js міняє на сторінці лише ті шматки, що змінились.
import { esc, fmtScore, kindLabel, KIND_IDS } from './logic.js';
import { replyItem, replyMode, replyPatch, sendList, scoreLines, openNotice, ownView, snapId, friendTable, newReplyAuthors, unseenCount, seenStamp, seenAtOf, canWrite, recsMissing, recsFor, needsKeep, addList, FRIENDS_MAX } from './social.js';
import { t, tn } from './i18n.js';
import { store } from './store.js';
import { friends, listdefs, prefs, socialCache, replyMem } from './synced.js';
import { cloud } from './cloud.js';
import { setCardExtra } from './panel.js';
import { $, app, layer, ui, icon, ph, remember, showOverlay, toast, promptBox, confirmBox } from './ui.js';

const blank = () => ({ name: '', items: {} });
// Стан — окремий об'єкт на пару «чий список | хто оцінює»: коли пара змінюється
// (інший список, вхід, вихід), створюємо новий, а записи, що вже стоять у черзі,
// доходять зі своїм старим. ready — власну відповідь завантажено; поки ні,
// оцінювати не можна: не знаємо, що вже стоїть. saved — останній підтверджений
// хмарою стан: у хмару йде лише різниця з ним. state — що зараз з оцінкою
// тайтла: 'sending' | 'saved' | 'failed' | 'unsigned' (чекає підпису);
// shelf — оцінку поставлено й на власній полиці.
const fresh = (key = '', owner = '', me = '') => ({
  key, owner, me, ready: false, loading: false, failed: false, tries: 0,
  mine: blank(), saved: {}, others: {}, confirmed: false, state: new Map(), shelf: new Set(),
});
let rs = fresh(), cur = null, redraw = () => {}, chain = Promise.resolve(), pending = 0;

const meUid = () => cloud.user?.uid || '';
const modeOf = recs => replyMode({ ownerUid: recs?.uid || '', meUid: meUid(), signedIn: !!cloud.user });
const xOf = id => cur?.items.find(x => x.id === id);
const idOf = el => el.closest('[data-id]')?.dataset.id;
const ownSigned = recs => !!recs?.uid && recs.uid === meUid();
// Власник на власному посиланні: з входом — за uid, інакше за позначкою «Як бачить гість».
const isOwn = recs => (recs.uid && meUid() ? recs.uid === meUid()
  : !!recs.me && ownView({ uid: recs.uid, meUid: meUid(), me: true, items: recs.items, shelfIds: store.list().map(e => e.id) }));
// Ім'я автора в реченні стоїть підметом, тож відмінювати його не треба.
const ownerName = recs => recs?.name || t('reply.author');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const toSend = recs => sendList(store.list(), recs.items, rs.mine.items, replyMem.get(rs.owner).skip);
const stuck = st => [...st.state].filter(([, v]) => v === 'failed' || v === 'unsigned').map(([id]) => id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── розмітка ──────────────────────────────────────────────────────
function scoreHtml(x) {
  const s = rs.mine.items[x.id]?.s || 0, dis = rs.ready ? '' : 'disabled';
  return `<h4>${t('reply.label')} <small>${s ? fmtScore(s) : ''}</small>${s ? `<button class="rb" data-act="rate-clear" aria-label="${t('reply.clear')}" title="${t('reply.clear')}" ${dis}>${icon('close')}</button>` : ''}</h4>
    <div class="scores">${Array.from({ length: 10 }, (_, i) =>
      `<button data-act="rate" data-v="${i + 1}" class="${s >= i + 1 ? 'fill' : ''} ${Math.floor(s) === i + 1 ? 'on' : ''}" aria-pressed="${Math.floor(s) === i + 1}" ${dis}>${i + 1}</button>`).join('')}
      <button data-act="rate-half" class="half ${s % 1 ? 'on' : ''}" aria-pressed="${!!(s % 1)}" aria-label="${t('score.half')}" title="${t('score.half')}" ${rs.ready && s >= 1 && s < 10 ? '' : 'disabled'}>+½</button></div>`;
}
// Поле коментаря росте разом із текстом; лічильник з'являється ближче до межі.
function noteHtml(x) {
  const dis = rs.ready ? '' : 'disabled';
  return `<textarea class="inp" rows="2" data-reply-note maxlength="500" placeholder="${t('reply.note.ph')}" aria-label="${t('reply.note.ph')}" ${dis}>${esc(rs.mine.items[x.id]?.n || '')}</textarea>
    <div class="reply-f"><small class="muted" data-reply-count hidden></small><button class="btn sm" data-act="note-save" ${dis}>${t('save')}</button></div>`;
}
// Що з моєю оцінкою цього тайтла: надсилається, збережена чи ще не в хмарі.
function stateHtml(id) {
  const st = rs.state.get(id);
  if (st === 'sending') return `<span class="rst">${t('reply.st.sending')}</span>`;
  if (st === 'saved') return `<span class="rst ok">${t('reply.st.saved')}${rs.shelf.has(id) ? ` · ${t('reply.st.shelf')}` : ''}</span>`;
  if (st === 'failed') return `<span class="rst bad">${t('reply.st.failed')}</span><button class="btn sm" data-act="reply-retry">${t('reply.retry')}</button>`;
  if (st === 'unsigned') return `<span class="rst bad">${t('reply.st.unsigned')}</span><button class="btn sm" data-act="reply-retry">${t('reply.sign')}</button>`;
  return '';
}
// Оцінки інших — лише коли автор відкрив список. Це не обов'язково мої друзі.
function othersHtml(id) {
  const rows = Object.entries(rs.others).filter(([uid, r]) => uid !== meUid() && r.items[id]).slice(0, 10);
  if (!rows.length) return '';
  return `<div class="others"><h4>${t('reply.others')}</h4>${rows.map(([, r]) => {
    const it = r.items[id];
    return `<p><b>${esc(r.name || t('fr.unsigned'))}</b>${it.s ? ` · <span class="sc">${fmtScore(it.s)}</span>` : ''}${it.n ? ` — <span class="muted">${t('quote', { x: esc(it.n) })}</span>` : ''}</p>`;
  }).join('')}</div>`;
}
// Рядок під шапкою живого списку: хто бачить мої оцінки. Коли автор відкрив список
// уже після моїх оцінок — помітне повідомлення, яке треба закрити самому.
function whoHtml(recs, mode) {
  const owner = esc(ownerName(recs));
  if (mode === 'signin') return `<p class="who-line">${recs.open ? t('who.signin') : cap(t('who.closed', { owner }))}</p>`;
  if (recs.open && rs.ready && openNotice(true, Object.keys(rs.mine.items).length, replyMem.get(rs.owner).open)) {
    return `<div class="who-box" role="status"><div><b>${t('who.changed')}</b><p>${cap(t('who.open', { owner }))}</p></div>
      <button class="btn" data-act="who-ok">${t('who.ok')}</button></div>`;
  }
  return `<p class="who-line">${cap(t(recs.open ? 'who.open' : 'who.closed', { owner }))}</p>`;
}
function barHtml(recs) {
  if (rs.failed) return `<p class="who-line bad">${t('reply.load.fail')} <button class="btn sm" data-act="reply-reload">${t('retry')}</button></p>`;
  if (!rs.ready) return `<p class="who-line">${t('reply.loading')}</p>`;
  const n = toSend(recs).length;
  return n ? `<button class="btn primary" data-act="rate-all">${icon('upload')}${t('reply.all')}<small>${n}</small></button>` : '';
}

// Усе, що на сторінці списку залежить від оцінювання, — шматками за ключем:
// 'banner', 'who', 'keep', 'bar' і на кожен тайтл 'o:' (оцінки інших), 'r:' (моя
// оцінка), 'n:' (коментар), 't:' (стан збереження). my(id) — моя оцінка тут.
export function replyParts(recs) {
  const mode = modeOf(recs), own = isOwn(recs), rate = mode === 'rate' && !own;
  // власник бачить оцінки інших так само, як друг, якому їх відкрито
  const others = !!recs.open && rs.ready && (rate || ownSigned(recs));
  const signin = mode === 'signin' && !own ? `<button class="btn" data-act="rate-signin">${icon('user')}${t('reply.signin')}</button>` : '';
  const zones = new Map([
    ['banner', own ? `<div class="own-banner">${icon('user')}<span>${t('recs.own')}</span></div>` : ''],
    ['who', recs.uid && !own ? whoHtml(recs, mode) : ''],
    ['keep', own ? '' : keepButton(recs)],
    ['bar', rate ? barHtml(recs) : ''],
  ]);
  for (const x of recs.items) {
    zones.set('o:' + x.id, others ? othersHtml(x.id) : '');
    zones.set('r:' + x.id, rate ? scoreHtml(x) : signin);
    zones.set('n:' + x.id, rate ? noteHtml(x) : '');
    zones.set('t:' + x.id, rate ? stateHtml(x.id) : '');
  }
  return { own, zones, my: id => (rate && rs.ready ? rs.mine.items[id]?.s || 0 : 0) };
}
// Моя оцінка тайтла на відкритому зараз списку (0 — немає): з нею тайтл іде на полицю.
export const takeScore = id => (cur && rs.ready && modeOf(cur) === 'rate' && !isOwn(cur) ? rs.mine.items[id]?.s || 0 : 0);

// ── стан ──────────────────────────────────────────────────────────
// Повертає true, коли стан почато наново (інший список чи інша людина): сторінку
// тоді малює викликач.
export function loadReplyState(recs, redrawFn) {
  cur = recs; redraw = redrawFn;
  const key = `${recs?.uid || ''}|${meUid()}`;
  if (key === rs.key) { trackOpen(); return false; }
  rs = fresh(key, recs?.uid || '', meUid());
  fetchReply();
  return true;
}
// Запам'ятовуємо, яким оцінювач бачив перемикач автора: закритим чи відкритим.
// Поки висить повідомлення «список відкрили», відкритим його не вважаємо.
function trackOpen() {
  if (!cur || !rs.ready || !rs.owner || modeOf(cur) !== 'rate') return;
  const seen = replyMem.get(rs.owner).open;
  if (!cur.open) { if (seen !== false) replyMem.set(rs.owner, { open: false }); }
  else if (seen !== true && !openNotice(true, Object.keys(rs.mine.items).length, seen)) replyMem.set(rs.owner, { open: true });
}
// Власна відповідь (а на відкритому списку й чужі). Одразу після входу запит
// може не пройти, тож двічі повторюємо самі; далі — кнопка «спробувати ще» і
// повернення мережі. Поки не завантажилось, шкала видна, але вимкнена.
function fetchReply() {
  const st = rs, recs = cur, own = ownSigned(recs);
  if (!recs || st.ready || st.loading || (modeOf(recs) !== 'rate' && !own)) return;
  st.loading = true;
  Promise.all([
    own ? null : cloud.loadReply(st.owner, st.me),
    // чужі оцінки — додаток: їхня відсутність не заважає оцінювати
    recs.open ? cloud.loadReplies(st.owner).catch(e => { console.warn('оцінки інших', e); return {}; }) : {},
  ]).then(([mine, others]) => {
    Object.assign(st, { loading: false, ready: true, failed: false, mine: mine || blank(), saved: structuredClone((mine || blank()).items), others });
    if (st === rs) { trackOpen(); redraw(); }
  }).catch(e => {
    console.warn('мої оцінки', e);
    st.loading = false;
    if (st !== rs) return;
    if (++st.tries < 3) return void setTimeout(() => { if (st === rs) fetchReply(); }, 1200 * st.tries);
    st.failed = true;
    redraw();
  });
}
const reload = () => { if (rs.ready) return; rs.tries = 0; rs.failed = false; redraw(); fetchReply(); };
// Сторінка знову на видноті або минула хвилина: чи не з'явилось нових оцінок інших.
export function refreshReplies() {
  const st = rs, recs = cur;
  if (!recs || !st.ready || !(modeOf(recs) === 'rate' || ownSigned(recs))) return;
  if (!recs.open) { if (Object.keys(st.others).length) { st.others = {}; redraw(); } return; }
  cloud.loadReplies(st.owner).then(others => { if (st === rs && !same(others, st.others)) { st.others = others; redraw(); } })
    .catch(e => console.warn('оцінки інших', e));
}

// Підпис: без нього оцінку не надсилаємо, але й не викидаємо — вона лишається на
// картці як «не надіслано», з кнопкою вказати підпис.
async function sign(st, ids) {
  ids.forEach(id => st.state.set(id, 'unsigned'));
  redraw();
  const v = await promptBox({ title: t('reply.name.title'), text: t('reply.name.text', { owner: cap(ownerName(cur)) }), placeholder: t('name.ph') });
  if (!v) return false;
  store.setSetting('name', v.slice(0, 80));
  cloud.publishNow().catch(() => {});
  return true;
}
// Надсилання вже внесених у st.mine змін: спершу підпис, на відкритому списку —
// згода, що оцінки бачать усі (відмова повертає як було), далі — у чергу.
// Коли питати нічого, до черги доходимо без жодного await: запис, початий перед
// самим виходом зі сторінки, уже порахований у pending.
async function commit(ids) {
  const st = rs;
  if (!store.settings.name && (!await sign(st, ids) || st !== rs)) return false;
  ids = [...new Set([...ids, ...stuck(st)])];   // разом із тим, що чекало підпису чи мережі
  if (cur?.open && !st.confirmed && !Object.keys(st.saved).length
    && !await confirmBox({ title: t('reply.open.title'), text: t('reply.open.text'), ok: t('reply.open.ok') })) {
    for (const id of ids) {
      if (Object.hasOwn(st.saved, id)) st.mine.items[id] = structuredClone(st.saved[id]); else delete st.mine.items[id];
      st.state.delete(id);
    }
    if (st === rs) redraw();
    return false;
  }
  if (st !== rs) return false;   // поки висів діалог, людина могла піти зі сторінки
  st.confirmed = true;
  // Без мережі запис завис би в черзі: кажемо чесно, що оцінка ще не в хмарі.
  if (navigator.onLine === false) {
    ids.forEach(id => st.state.set(id, 'failed'));
    redraw();
    toast(t('toast.reply.offline'), { ms: 5000 });
    return false;
  }
  return send(st, ids);
}

// Елемент без оцінки й коментаря у відповіді не тримаємо.
function apply(st, id, s, n) {
  if (s || n) st.mine.items[id] = replyItem(xOf(id), s, n, Date.now());
  else delete st.mine.items[id];
}
// Запис іде одразу, без затримки; черга лише тримає порядок, щоб відповіді не
// обганяли одна одну. Стан знімаємо тут, а не в черзі, і тримаємось свого st:
// за цей час список чи акаунт могли змінитись, а оцінка має дійти туди, де її
// поставили. Не вдалося — оцінка лишається на картці з позначкою «не збережено».
function send(st, ids) {
  ids.forEach(id => st.state.set(id, 'sending'));
  pending++;
  redraw();
  const sent = structuredClone(st.mine.items);
  chain = chain.then(async () => {
    if (meUid() !== st.me) throw new Error(t('err.nocloud'));   // вийшли з акаунта — писати нікому
    // Різницю рахуємо, коли дійшла черга: st.saved тоді вже містить усе, що
    // підтвердили попередні записи (інакше «поставив і одразу зняв» не дійшло б як зняття).
    const patch = replyPatch(st.saved, sent);
    await cloud.sendReply(st.owner, patch);
    st.saved = sent;
    for (const id of new Set([...ids, ...Object.keys(patch.set), ...patch.del])) if (same(st.mine.items[id], sent[id])) st.state.set(id, 'saved');
    return true;
  }).catch(e => {
    console.warn('оцінка не збереглась', e);
    for (const id of ids) if (st.state.get(id) === 'sending') st.state.set(id, same(st.mine.items[id], st.saved[id]) ? 'saved' : 'failed');
    if (st === rs) toast(t('toast.reply.fail', { e: e?.message || '' }), { ms: 5000 });
    return false;
  }).then(ok => { pending--; if (st === rs) redraw(); return ok; });
  return chain;
}
const resend = () => { const ids = stuck(rs); if (cur && rs.ready && ids.length) commit(ids); };
export { resend as resendReplies };

function setScore(el, pick) {
  const id = idOf(el), st = rs;
  if (!cur || !xOf(id) || !st.ready) return;
  const was = st.mine.items[id], s = pick(was?.s || 0), box = el.closest('.reply')?.querySelector('[data-reply-note]');
  const n = box ? box.value.trim().slice(0, 500) : was?.n || '';
  if (s === (was?.s || 0) && n === (was?.n || '')) return;
  apply(st, id, s, n);
  // Зняв оцінку сам — «Надіслати мої оцінки» її більше не пропонує, доки не оціню тут знову.
  const skip = replyMem.get(st.owner).skip, had = skip.includes(id);
  if (!s && was?.s && !had) replyMem.set(st.owner, { skip: [...skip, id].slice(-500) });
  else if (s && had) replyMem.set(st.owner, { skip: skip.filter(v => v !== id) });
  redraw();
  commit([id]).then(ok => {
    // На полиці оцінку міняємо лише там, де тайтл уже є, і лише ставимо: знята
    // тут оцінка не стирає власну оцінку з полиці. Нових записів не створюємо.
    if (ok && s > 0 && store.get(id) && st.mine.items[id]?.s === s) { st.shelf.add(id); store.save(id, { score: s }); }
  });
}
function saveNote(id, text) {
  const st = rs;
  if (!cur || !xOf(id) || !st.ready) return;
  const was = st.mine.items[id], n = text.trim().slice(0, 500);
  if ((was?.n || '') === n) return;
  apply(st, id, was?.s || 0, n);
  redraw();
  commit([id]);
}
// Недописане в полях коментарів — у чергу (перед виходом зі сторінки чи переходом).
// Діалогів тут не показуємо: коли потрібен підпис чи згода, чекаємо кнопки «Зберегти».
export function flushReplies() {
  if (!cur || !rs.ready || !store.settings.name || (cur.open && !rs.confirmed && !Object.keys(rs.saved).length)) return;
  document.querySelectorAll('.rcard [data-reply-note]').forEach(el => saveNote(idOf(el), el.value));
}

// Коментар зберігається кнопкою «Зберегти», клавішею Enter (Shift+Enter — новий
// рядок) і при виході з поля — одразу, без відкладання.
const noteEl = ev => (ev.target.matches?.('[data-reply-note]') ? ev.target : null);
document.addEventListener('input', ev => {
  const el = noteEl(ev);
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 220) + 'px';
  const c = el.closest('.reply')?.querySelector('[data-reply-count]');
  if (c) { c.hidden = el.value.length < 450; c.textContent = `${el.value.length}/500`; }
});
document.addEventListener('change', ev => { const el = noteEl(ev); if (el) saveNote(idOf(el), el.value); });
document.addEventListener('keydown', ev => {
  const el = noteEl(ev);
  if (el && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); saveNote(idOf(el), el.value); }
});

// Поки записи в дорозі, сторінку не можна губити: браузер перепитає перед
// закриттям, а власне посилання, що перезавантажує сторінку («Мій список»),
// спершу дає черзі дописати. Згортання вкладки запис не скасовує.
addEventListener('beforeunload', ev => {
  flushReplies();
  if (pending > 0) { ev.preventDefault(); ev.returnValue = ''; }
});
addEventListener('pagehide', flushReplies);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushReplies(); });
document.addEventListener('click', ev => {
  const a = ev.target.closest?.('a[href]');
  if (!a || a.target === '_blank' || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.hash) return;   // зміна лише хеша сторінку не вивантажує
  flushReplies();
  if (!pending) return;
  ev.preventDefault();
  toast(t('reply.st.sending'));
  Promise.race([chain, new Promise(done => setTimeout(done, 4000))]).then(() => location.assign(url.href));
}, true);
addEventListener('online', () => { reload(); resend(); });

// ── запам'ятати друга ─────────────────────────────────────────────
// Живе посилання — за uid, знімок — за відбитком підпису й тайтлів. Видалений
// друг (мітка видалення) для get() не існує, тож кнопка повертається, а save
// його воскрешає. Кнопка є й для друга, що вже є, коли запам'ятовувати ще є що
// (needsKeep): він додався сам або це його добірка, якої ми ще не брали.
const nameOf = recs => (recs.name || '').slice(0, 80);
const friendId = recs => (recs.uid || snapId(nameOf(recs), recs.items));
const listOf = recs => (recs.uid ? (recs.title || '').slice(0, 40) : '');   // назва добірки на живому посиланні
const mayKeep = recs => !!recs && !isOwn(recs) && needsKeep(friends.get(friendId(recs)), listOf(recs));
export function keepButton(recs) {
  if (!mayKeep(recs)) return '';
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
  // У кеш кладемо лише те, що радили мені (recsFor): чужі добірки на пристрої не лишаються.
  return cloud.loadPublic(f.uid).then(r => { if (r && meUid() === me && followed(f.id)) { cacheRecs(f.id, recsFor(friends.get(f.id), r.items)); socialRedraw(); } })
    .catch(e => console.warn('рекомендації друга', e))
    .finally(() => pulling.delete(k));
};

export const friendActions = {
  'friend-keep': () => {
    if (!mayKeep(cur)) return;
    const id = friendId(cur), name = nameOf(cur), was = friends.get(id), added = was?.added || Date.now();
    if (cur.uid) {
      // Друг міг уже бути (відповів сам або запам'ятаний з іншого посилання): тоді
      // лише вмикаємо рекомендації й дописуємо цю добірку до запам'ятаних.
      const f = friends.save(id, { uid: id, name: was?.name || name, kind: 'live', follow: true, added, lists: addList(was?.lists, listOf(cur)) });
      // Те, що на сторінці, кладемо одразу лише коли копії ще немає: добірка не має витіснити вже зібране.
      if (f && !Object.hasOwn(socialCache.get().recs, id)) cacheRecs(id, recsFor(f, cur.items));
      pullRecs({ id, uid: id });   // на сторінці могла бути лише одна добірка — беремо весь список
    } else friends.save(id, { name, kind: 'snap', follow: true, items: recsFor(null, cur.items), added });
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
// пачку змін. Обробники у свої сховища не пишуть. Єдиний запис під час малювання —
// позначка «бачив» в renderFriends — іде з markingSeen і нового малювання не
// викликає: інакше відповідь із годинником із майбутнього крутила б це по колу.
let started = false, queued = false, friendsChanged = false, markingSeen = false;
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
    prefs.onChange(() => { if (!markingSeen) later(); });
    listdefs.onChange(later);
  },
};

export const replyActions = {
  'reply-box': () => 'keep',
  rate: (v, el) => setScore(el, s => (s === +v ? 0 : +v)),
  'rate-half': (v, el) => setScore(el, s => (s >= 1 && s < 10 ? (s % 1 ? Math.floor(s) : s + 0.5) : s)),
  'rate-signin': () => { try { cloud.signIn(); } catch (err) { toast(t('toast.signin.fail', { e: err.message }), { ms: 5000 }); } },
  'rate-clear': (v, el) => setScore(el, () => 0),
  'note-save': (v, el) => { const box = el.closest('.reply')?.querySelector('[data-reply-note]'); if (box) saveNote(idOf(el), box.value); },
  // «повторити» й «вказати підпис»: усе, що ще не в хмарі, — однією спробою
  'reply-retry': resend,
  'reply-reload': reload,
  'who-ok': () => { if (rs.owner) replyMem.set(rs.owner, { open: true }); redraw(); },
  // Мої оцінки з полиці для тайтлів списку, яких ще немає у відповіді — одним
  // записом; спершу показуємо, що саме піде авторові.
  'rate-all': async () => {
    const st = rs;
    if (!cur || !st.ready) return;
    const rows = toSend(cur);
    if (!rows.length) return;
    const text = `${t('reply.all.text', { owner: cap(ownerName(cur)) })}\n${scoreLines(rows.map(r => ({ t: r.t, s: fmtScore(r.s) })))}`;
    if (!await confirmBox({ title: t('reply.all.title', { n: rows.length }), text, ok: t('reply.all.ok') }) || st !== rs) return;
    for (const r of rows) apply(st, r.id, r.s, st.mine.items[r.id]?.n || '');
    redraw();
    if (await commit(rows.map(r => r.id))) toast(t('toast.reply.sent', { n: rows.length }));
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
  if (unseenCount(tb, c.replies, seenAt()) > 0 && ready('prefs')) {
    markingSeen = true;
    try { prefs.save('seen', { seenAt: seenStamp(tb, c.replies, Date.now()) }); } finally { markingSeen = false; }
  }
  if (!tb.cols.some(x => x.id === fr.who)) fr.who = '';   // друга видалили
  const cols = fr.who ? tb.cols.filter(x => x.id === fr.who) : tb.cols;
  const rows = tb.rows.filter(r => (!fr.who || cellOf(r, fr.who)) && (fr.kind === 'all' || r.k === fr.kind));
  const head = `<header class="page-head"><h1>${t('nav.friends')}</h1><span class="count">${tb.rows.length} ${tn('title', tb.rows.length)}</span>
    <span class="grow"></span><button class="btn" data-act="fr-manage">${icon('user')}${t('fr.manage')}</button></header>`;
  if (!tb.rows.length) {
    app.innerHTML = `${head}<div class="empty">${icon('user')}<b>${t('fr.empty.title')}</b><p>${t('fr.empty.text')}</p>
      <button class="btn primary" data-act="go" data-v="share">${icon('share')}${t('nav.share')}</button></div>`;
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
