// Оцінки друга на сторінці чужого списку (#u=…): ряд балів і коментар на
// кожній картці, «Надіслати мої оцінки» і оцінки інших друзів. Сторінка
// передає сюди свій стан аргументами (recs): views.js і app.js імпортують
// цей модуль, тож він не може імпортувати їх у відповідь (цикл).
import { esc, fmtScore } from './logic.js';
import { replyItem, replyMode, shelfScores } from './social.js';
import { t } from './i18n.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { icon, toast, promptBox, confirmBox } from './ui.js';

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
    const v = await promptBox({ title: t('menu.name'), text: t('name.text'), value: cloud.user?.name || '', placeholder: t('name.ph') });
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
  const key = rs.key, owner = rs.owner;
  chain = chain.then(() => {
    const sent = structuredClone(rs.mine.items);
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
