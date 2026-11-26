// Каркас застосунку: шапка, навігація, маршрути, глобальні події.
import { esc, decodeRecs, recsHash, listView, fmtScore } from './logic.js';
import { t, tn, setLang, getLang, LANGS } from './i18n.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { $, $$, app, layer, icon, toast, ui, actions, on, closeOverlay, recall, promptBox, confirmBox, selects } from './ui.js';
import * as catalog from './meta.js';
import { view, renderHome, renderLibrary, updateLibrary, renderDiscover, resetDiscover, loadDiscover, drawDiscover, renderStats, renderRecs, updateRecs } from './views.js';
import {
  openCard, openPreview, openPalette, openShare, drawCard, plus, addItem, addFromPreview, pickResult, dropUrl, palKind,
  cardActions, buildActions, loadDemo, flushCard,
} from './panel.js';
import { renderCalendar, pickActions, wrapActions } from './extras.js';
import { replyActions, friendActions, loadReplyState, refreshReplies, flushReplies, resendReplies, takeScore, social, renderFriends } from './friends.js';
import { renderShare, shareActions } from './shared.js';

const S = store.settings;
const NAV = [['home', 'home'], ['library', 'library'], ['calendar', 'calendar'], ['friends', 'user'], ['share', 'share'], ['discover', 'compass'], ['stats', 'chart']];
// на телефоні внизу лишається чотири розділи й «+»: головна, бібліотека, друзі,
// рекомендації; календар, каталог і статистика — з меню акаунта
const TABS = NAV.filter(n => ['home', 'library', 'friends', 'share'].includes(n[0]));
const top = $('#top'), tabs = $('#tabs');
// Знак: кадр кіноплівки з кнопкою відтворення.
const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
  <rect x="1" y="4" width="30" height="24" rx="7" fill="url(#lg)"/>
  <g fill="var(--bg)" opacity=".55"><rect x="4" y="8" width="3" height="3" rx="1"/><rect x="4" y="14.500" width="3" height="3" rx="1"/><rect x="4" y="21" width="3" height="3" rx="1"/>
  <rect x="25" y="8" width="3" height="3" rx="1"/><rect x="25" y="14.500" width="3" height="3" rx="1"/><rect x="25" y="21" width="3" height="3" rx="1"/></g>
  <path d="M13 10.500v11l9-5.500z" fill="var(--bg)"/></svg>`;

function applyTheme() {
  if (S.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
}
function applyLang() {
  setLang(S.lang);
  document.documentElement.lang = getLang();
  $('.skip').textContent = t('skip');
}
const stateText = () => t('state.' + (cloud.available ? cloud.state : 'local'));
const initial = u => esc((u.name || u.email || '?').trim()[0].toUpperCase());

// ── шапка й нижня навігація ───────────────────────────────────────
function drawChrome() {
  const recs = view.route === 'recs';
  const here = r => (view.route === r ? 'on' : '');
  const href = r => `#/${r === 'home' ? '' : r}`;
  const u = cloud.user;
  top.innerHTML = `
    <a class="logo" href="#/" aria-label="${t('brand')}">${LOGO}<b>${t('brand')}</b></a>
    ${recs ? '<span class="grow"></span>' : `<nav class="nav" aria-label="${t('sections')}">${NAV.map(([r]) => `<a class="${here(r)}" href="${href(r)}">${t('nav.' + r)}</a>`).join('')}</nav>
    <button class="searchbtn" data-act="add" aria-label="${t('search.btn')}">${icon('search')}<span>${t('search.btn')}</span><kbd>/</kbd></button>`}
    ${recs ? `<a class="btn" href="./">${icon('library')}${t('my.shelf')}</a>` : `
    <button class="btn primary addbtn" data-act="add">${icon('plus')}<span>${t('add')}</span></button>`}
    <div class="dd">
      <button class="acct st-${cloud.available ? cloud.state : 'local'}" data-act="menu" aria-haspopup="true" aria-label="${t('account.aria')}" title="${esc(stateText())}">
        ${u ? `<span class="avatar">${initial(u)}</span>` : icon('user')}<i class="state"></i></button>
      <div class="pop menu" id="menu" hidden></div>
    </div>`;
  tabs.hidden = recs;
  const tab = ([r, ic]) => `<a class="tab ${here(r)}" href="${href(r)}">${icon(ic)}<span>${t('nav.' + r)}</span></a>`;
  tabs.innerHTML = recs ? '' : TABS.slice(0, 2).map(tab).join('')
    + `<button class="tab add" data-act="add" aria-label="${t('add')}">${icon('plus')}</button>` + TABS.slice(2).map(tab).join('');
  paintDot();
}

function toggleMenu(force) {
  const menu = $('#menu');
  if (!menu) return;
  const open = force ?? menu.hidden;
  if (open) {
    // на сторінці чужого списку меню коротке: вхід, підпис, мова, тема
    const u = cloud.user, recs = view.route === 'recs';
    menu.innerHTML = `
      ${cloud.available ? (u
        ? `<div class="who"><span class="avatar lg">${initial(u)}</span><div><b>${esc(u.name || t('menu.google'))}</b><small>${esc(u.email)}</small><em class="st-${cloud.state}"><i class="state"></i>${stateText()}</em></div></div>`
        : `<div class="who signin"><p>${t('menu.signin.text')}</p><button class="btn primary" data-act="signin">${icon('user')}${t('menu.signin')}</button></div>`)
        : `<div class="who"><p>${t('menu.local.text')}</p></div>`}
      <hr>${recs ? '' : `
      <button data-act="go" data-v="calendar">${icon('calendar')}${t('nav.calendar')}</button>
      <button data-act="go" data-v="discover">${icon('compass')}${t('nav.discover')}</button>
      <button data-act="go" data-v="stats">${icon('chart')}${t('nav.stats')}</button>
      <button data-act="tonight">${icon('dice')}${t('pick.title')}</button>
      <hr>`}
      <button data-act="name">${icon('user')}${t('menu.name')}<small>${esc(S.name || t('not.set'))}</small></button>
      <hr>
      <button data-act="lang">${icon('globe')}${t('menu.lang')}<small>${LANGS.find(l => l[0] === getLang())[1]}</small></button>
      <button data-act="theme">${icon('sun')}${t('menu.theme')}<small>${t('theme.' + S.theme)}</small></button>${recs ? '' : `
      <button data-act="demo">${icon('sparkle')}${t('demo')}</button>
      <button data-act="export">${icon('download')}${t('menu.export')}</button>
      <button data-act="import">${icon('upload')}${t('menu.import')}</button>`}
      ${u ? `<hr><button data-act="signout">${icon('logout')}${t('menu.signout')}</button>` : ''}`;
  }
  menu.hidden = !open;
}

// ── маршрути ──────────────────────────────────────────────────────
const RENDER = { home: renderHome, library: renderLibrary, calendar: renderCalendar, friends: renderFriends, share: renderShare, discover: renderDiscover, stats: renderStats, recs: renderRecs };
function draw() { RENDER[view.route](); paintDot(); }
// Крапка «нове» на пункті «Друзі»: у шапці й на нижній вкладці телефона.
function paintDot() {
  const n = social.unseen() > 0;
  $$('.nav a[href="#/friends"], .tab[href="#/friends"]').forEach(el => el.classList.toggle('fnew', n));
}
function setTitle() {
  document.title = view.route === 'recs'
    ? `${view.fail ? t('recs.fail.title') : view.recs?.title || (view.recs?.name ? t('title.recs.by', { name: view.recs.name }) : t('title.recs'))} · ${t('brand')}`
    : view.route === 'home' ? `${t('brand')} — ${t('brand.long')}` : `${t('nav.' + view.route)} · ${t('brand')}`;
}
// Чужий список за адресою (recsHash): { recs } або { fail } — чому його не показати.
// #u=<uid> — загальні рекомендації; #u=<uid>&c=<ключ> — добірка за сталим ключем
// (назву дає мапа cols автора); #u=<uid>&l=<назва> — старі посилання за назвою;
// #r=<знімок> — список у самому посиланні. uid і open потрібні оцінюванню: чий це
// список і чи бачать оцінки всі; у знімка їх немає — оцінювати нікому.
async function loadRecs(raw) {
  const h = recsHash(raw);
  if ('snap' in h) {
    let r = null;
    try { r = await decodeRecs(h.snap); } catch (err) { console.warn('знімок', err); }
    return r ? { recs: { ...r, uid: '', open: false, me: h.me } } : { fail: { kind: 'bad' } };
  }
  if (!h.uid) return { fail: { kind: 'bad' } };   // порожній чи негодящий uid до хмари не доходить
  const v = listView(await cloud.loadPublic(h.uid), h.key, h.list);
  if (!v) return { fail: { kind: 'bad' } };
  return v.missing ? { fail: { kind: 'nolist', name: v.name, uid: h.uid } } : { recs: { ...v, uid: h.uid, me: h.me } };
}
// Живий список оновлюється сам: коли вкладка знову на видноті й раз на хвилину.
// Змінився — перемальовуємо, але не тоді, коли саме набирають коментар.
let refreshing = false;
async function refreshRecs() {
  const was = view.recs, raw = location.hash.slice(1);
  if (view.route !== 'recs' || !was?.uid || document.hidden || refreshing) return;
  refreshing = true;
  try {
    const { recs } = await loadRecs(raw);
    if (!recs || view.recs !== was || location.hash.slice(1) !== raw) return;
    if (JSON.stringify(recs) !== JSON.stringify(was)) {
      if (document.activeElement?.matches?.('[data-reply-note]')) return;
      // змінився лише перемикач «оцінки бачать усі» — досить оновити шматки
      const full = JSON.stringify({ ...recs, open: 0 }) !== JSON.stringify({ ...was, open: 0 });
      view.recs = recs;
      setTitle();
      loadReplyState(recs, recsRedraw);
      refresh(full ? renderRecs : updateRecs);
    }
    refreshReplies();
  } catch (err) { console.warn('оновлення списку', err); } finally { refreshing = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRecs(); });
setInterval(refreshRecs, 60000);

async function route() {
  flushReplies();   // недописаний коментар на списку, з якого йдемо
  closeOverlay();
  const raw = location.hash.slice(1);
  if (raw.startsWith('u=') || raw.startsWith('r=')) {
    Object.assign(view, { route: 'recs', recs: null, fail: null });
    setTitle(); drawChrome();
    renderRecs();   // «завантажую…»
    let res;
    try { res = await loadRecs(raw); } catch (err) { console.warn('список', err); res = { fail: { kind: 'net' } }; }
    if (location.hash.slice(1) !== raw) return;   // поки вантажилось, людина пішла далі
    Object.assign(view, { recs: res.recs || null, fail: res.fail || null });
    setTitle();
    if (view.recs) loadReplyState(view.recs, recsRedraw);
    renderRecs();
    return;
  }
  // #/discover/anime — каталог одразу на потрібній вкладці
  const [r, sub] = raw.replace(/^\//, '').split('/');
  if (r === 'discover' && ['series', 'anime', 'movie'].includes(sub) && view.disc.type !== sub) Object.assign(view.disc, { type: sub, genre: '', from: '', to: '', min: '', sort: 'pop' });
  view.route = RENDER[r] && r !== 'recs' ? r : 'home';
  view.recs = view.fail = null;
  setTitle(); drawChrome(); draw();
  scrollTo(0, 0);
}

// ── дії ───────────────────────────────────────────────────────────
function exportFile() {
  const blob = new Blob([JSON.stringify({ app: 'MyWatchShelf', version: 1, entries: store.raw() }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ovion-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(t('toast.exported'));
}
function importFile() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const list = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(list)) throw new Error(t('import.nolist'));
      const n = store.importMany(list);
      toast(n ? t('toast.imported', { n: `${n} ${tn('entry', n)}` }) : t('toast.import.none'));
    } catch (err) { toast(t('toast.import.fail', { e: err.message }), { ms: 4500 }); }
  };
  inp.click();
}
const idOf = el => el.closest('[data-id]')?.dataset.id || ui.overlay?.id;

on({
  ...cardActions, ...buildActions, ...pickActions, ...wrapActions, ...replyActions, ...friendActions, ...shareActions,
  go: v => { location.hash = '#/' + v; },
  'sel-toggle': (v, el) => {
    const pop = $('.pop', el.closest('.dd')), open = pop.hidden;
    closePops();
    pop.hidden = !open;
    el.setAttribute('aria-expanded', String(open));
    if (open) { const cur = $('.on', pop) || $('button', pop); cur.scrollIntoView({ block: 'nearest' }); cur.focus({ preventScroll: true }); }
    return 'keep';
  },
  'sel-pick': (v, el) => { selects[el.closest('.sel').dataset.sel]?.(v); },
  'share-list': v => openShare(v),
  'list-filter': v => { view.f.list = view.f.list === v ? '' : v; updateLibrary(); },
  close: closeOverlay,
  add: openPalette,
  menu: () => toggleMenu(),
  signin: () => { try { cloud.signIn(); } catch (err) { toast(t('toast.signin.fail', { e: err.message }), { ms: 5000 }); } },
  signout: async () => {
    if (await confirmBox({ title: t('signout.title'), text: t('signout.text'), ok: t('menu.signout') })) {
      await cloud.signOut(); toast(t('toast.signedout'));
    }
  },
  'hide-hint': () => { store.setSetting('hint', false); draw(); },
  theme: () => { store.setSetting('theme', { auto: 'light', light: 'dark', dark: 'auto' }[S.theme]); applyTheme(); toggleMenu(true); return 'keep'; },
  lang: () => {
    store.setSetting('lang', getLang() === 'en' ? 'uk' : 'en');
    applyLang(); setTitle(); drawChrome(); draw(); toggleMenu(true);
    return 'keep';
  },
  // Імʼя з Google-акаунта не підставляємо: погодившись не глянувши, людина опублікувала б його.
  name: async () => {
    const v = await promptBox({ title: t('menu.name'), text: t('name.text'), value: S.name || '', placeholder: t('name.ph') });
    if (v !== null) { store.setSetting('name', v.slice(0, 80)); cloud.publishNow().catch(() => {}); toast(t('toast.name.saved')); }
    if (v && view.route === 'recs') resendReplies();   // оцінки, що чекали підпису
  },
  'recs-retry': route,
  share: () => openShare(),
  demo: loadDemo,
  export: exportFile,
  import: importFile,
  // списки
  open: (v, el) => openCard(idOf(el)),
  preview: (v, el) => openPreview(idOf(el)),
  plus: (v, el) => plus(idOf(el)),
  'quick-add': (v, el) => {
    const x = recall(idOf(el));
    if (!x || !addItem(x)) return;
    toast(t('toast.planned', { title: x.title }), { label: t('open'), action: () => openCard(x.id) });
  },
  take: (v, el) => {
    const x = recall(idOf(el));
    if (!x) return;
    // Оцінив цей тайтл на списку друга — на полицю він іде вже переглянутим, з тією ж
    // оцінкою (коментар лишається лише на списку друга).
    const s = view.route === 'recs' ? takeScore(x.id) : 0;
    if (!addItem(x, s ? { status: 'done', score: s } : {})) return;
    toast(s ? t('toast.taken.score', { title: x.title, n: fmtScore(s) }) : t('toast.taken', { title: x.title }));
    if (ui.overlay) closeOverlay();
  },
  'add-as': v => addFromPreview(v, view.route === 'recs' ? takeScore(ui.overlay.id) : 0),
  rail: (v, el) => { const tr = $('.rail-track', el.closest('.rail')); tr.scrollBy({ left: +v * tr.clientWidth * 0.85, behavior: 'smooth' }); },
  // бібліотека
  kind: v => { view.f.kind = v; updateLibrary(); },
  status: v => { view.f.status = v; updateLibrary(); },
  genre: v => { const g = view.f.genres, i = g.indexOf(v); if (i < 0) g.push(v); else g.splice(i, 1); updateLibrary(); return 'keep'; },
  'genres-toggle': () => { const p = $('#lib-genres'); p.hidden = !p.hidden; return 'keep'; },
  'reset-filters': () => { Object.assign(view.f, { q: '', kind: 'all', status: 'all', genres: [], list: '', from: '', to: '', min: '', mine: '' }); if ($('#lib-list')) renderLibrary(); },
  dir: () => { store.setSetting('dir', -S.dir); updateLibrary(); },
  view: () => { store.setSetting('view', S.view === 'grid' ? 'list' : 'grid'); updateLibrary(); },
  // каталог
  'disc-type': v => { view.disc.type = v; history.replaceState(null, '', '#/discover/' + v); renderDiscover(); },
  'disc-more': () => loadDiscover(false),
  'disc-reset': resetDiscover,
  'pal-kind': palKind,
  // пошук і поширення
  pick: v => pickResult(+v),
  'drop-url': dropUrl,
  copy: async () => {
    try { await navigator.clipboard.writeText(ui.overlay.link); toast(t('toast.copied')); }
    catch { $('.linkbox', layer).select(); toast(t('toast.copy.manual')); }
  },
  'native-share': () => navigator.share({ title: t('share.title'), url: ui.overlay.link }).catch(() => {}),
});

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  const inPop = ev.target.closest('.dd');
  if (!el) { if (!inPop) closePops(); return; }
  // посилання всередині картки мають власну дію, а не «відкрити»
  if (['open', 'preview'].includes(el.dataset.act) && ev.target.closest('a')) return;
  const keep = actions[el.dataset.act]?.(el.dataset.v, el, ev);
  if (keep !== 'keep' && el.dataset.act !== 'menu') closePops();
});
function closePops() { $$('.pop').forEach(p => { p.hidden = true; }); $$('.selbtn').forEach(b => b.setAttribute('aria-expanded', 'false')); }
// Довідку тайтла з каталогу тягнемо, щойно на картку навели чи торкнулись:
// поки людина натисне, опис і кількість серій уже лежатимуть у кеші.
let warmTimer;
document.addEventListener('pointerover', ev => {
  const el = ev.target.closest?.('.pc[data-act="preview"]');
  clearTimeout(warmTimer);
  if (!el) return;
  warmTimer = setTimeout(() => {
    const x = recall(el.dataset.id);
    if (x && (!x.meta || x.thin)) catalog.meta(x.id, x.type || (x.kind === 'movie' ? 'movie' : undefined)).catch(() => {});
  }, ev.pointerType === 'mouse' ? 120 : 0);
});

document.addEventListener('keydown', ev => {
  const typing = ev.target.matches?.('input,textarea,select');
  if (ev.key === 'Escape') { if (ui.overlay) closeOverlay(); else closePops(); }
  else if ((ev.key === '/' && !typing) || (ev.key.toLowerCase() === 'k' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); if (view.route !== 'recs') openPalette(); }
  else if (ev.key === 'Enter' && ev.target.matches?.('[data-act][tabindex]')) ev.target.click();
  else if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && ev.target.matches?.('.options button')) {
    ev.preventDefault();
    (ev.key === 'ArrowDown' ? ev.target.nextElementSibling : ev.target.previousElementSibling)?.focus();
  }
});

// ── зміни даних ───────────────────────────────────────────────────
// Перемальовування після зміни даних не має зсувати людину з місця: вміст
// замінюється цілком, сторінка на мить коротшає, і браузер скидає
// прокрутку на початок. Тому запам'ятовуємо її й повертаємо.
function refresh(paint = redraw) {
  const y = scrollY;
  app.style.minHeight = app.offsetHeight + 'px';
  paint();
  app.style.minHeight = '';
  if (Math.abs(scrollY - y) > 1) scrollTo({ top: y, behavior: 'instant' });
}
// Оцінювання просить оновити сторінку списку й тоді, коли людина з неї вже пішла
// (запис дійшов пізніше): інших екранів це не стосується.
function recsRedraw() { if (view.route === 'recs') updateRecs(); }
function redraw() {
  if (view.route === 'library') updateLibrary();
  else if (view.route === 'discover') drawDiscover();
  // чужий список оновлюємо шматками: оцінка чи закрита картка не блимають постерами
  else if (view.route === 'recs') updateRecs();
  else if (view.route === 'home') {
    // ряди після перемальовування лишаються там, де їх прогорнули
    const pos = new Map($$('.rail').map(r => [r.dataset.rail, $('.rail-track', r).scrollLeft]));
    draw();
    $$('.rail').forEach(r => { const x = pos.get(r.dataset.rail); if (x) $('.rail-track', r).scrollLeft = x; });
  } else draw();
}
// Поки відкрита картка, сторінку під нею не перемальовуємо (щоб не
// смикались ряди й зображення) — зробимо це, коли картку закриють.
ui.afterClose = () => { if (ui.dirty) { ui.dirty = false; refresh(); } };
store.onChange(() => {
  if (ui.overlay) {
    ui.dirty = true;
    if (ui.overlay.type === 'card') {
      const a = document.activeElement;
      if (!(a && layer.contains(a) && a.matches('input,textarea'))) drawCard();
    }
    return;
  }
  refresh();
});
let greeted = false;
cloud.onChange(() => {
  drawChrome();
  if (view.route === 'home' && !ui.overlay) draw();
  // увійшли чи вийшли на чужому списку — оцінки завантажуємо наново, а шкала
  // з'являється одразу, щойно відомо, хто це
  if (view.route === 'recs' && view.recs && loadReplyState(view.recs, recsRedraw)) updateRecs();
  if (cloud.lastError) { toast(t('toast.signin.fail', { e: cloud.lastError }), { ms: 5000 }); cloud.lastError = ''; }
  if (cloud.justSignedIn && cloud.state === 'synced' && !greeted) { greeted = true; toast(t('toast.signedin')); }
});
addEventListener('error', () => toast(t('toast.error'), { ms: 5000 }));

applyTheme();
applyLang();
cloud.init();
// відповіді друзів не мають смикати сторінку під відкритою карткою
social.start(() => {
  paintDot();
  // На чужому списку даних друзів немає, а перемальовування стерло б коментар, який саме набирають.
  if (view.route === 'recs') return;
  // «Керувати друзями» лежить поверх таблиці: вона має оновитись одразу, а не після закриття
  if (!ui.overlay || (ui.overlay.type === 'friends' && view.route === 'friends')) return refresh();
  ui.dirty = true;
  // відкрита картка показує оцінки друзів — оновлюємо її, не вириваючи поле з-під пальців
  if (ui.overlay.type === 'card' && !(document.activeElement && layer.contains(document.activeElement) && document.activeElement.matches('input,textarea'))) { flushCard(); drawCard(); }
});
addEventListener('hashchange', route);
route();
// вхід міг не вдатися ще до того, як сторінка намалювалась — скажемо про це
if (cloud.lastError) { toast(t('toast.signin.fail', { e: cloud.lastError }), { ms: 8000 }); cloud.lastError = ''; }
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
