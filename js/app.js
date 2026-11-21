// Каркас застосунку: шапка, навігація, маршрути, глобальні події.
import { esc, plural, decodeRecs } from './logic.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { $, $$, app, layer, icon, toast, ui, actions, on, closeOverlay, recall, promptBox, confirmBox } from './ui.js';
import { view, renderHome, renderLibrary, updateLibrary, renderDiscover, loadDiscover, drawDiscover, renderStats, renderRecs } from './views.js';
import {
  openCard, openPreview, openPalette, openShare, drawCard, plus, addItem, addFromPreview, pickResult, dropUrl,
  cardActions, loadDemo,
} from './panel.js';

const S = store.settings;
const NAV = [['home', 'Головна', 'home'], ['library', 'Бібліотека', 'library'], ['discover', 'Каталог', 'compass'], ['stats', 'Статистика', 'chart']];
const top = $('#top'), tabs = $('#tabs');

function applyTheme() {
  if (S.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
}

// ── шапка й нижня навігація ───────────────────────────────────────
function drawChrome() {
  const recs = view.route === 'recs';
  const here = r => (view.route === r ? 'on' : '');
  const u = cloud.user;
  const stateText = !cloud.available ? 'лише цей пристрій'
    : { off: '', connecting: 'з’єднання…', synced: 'синхронізовано', offline: 'офлайн', error: 'помилка синхронізації' }[cloud.state];
  top.innerHTML = `
    <a class="logo" href="#/" aria-label="Полиця — на головну"><span class="mark"><i></i><i></i><i></i></span><b>Полиця</b></a>
    ${recs ? '<span class="grow"></span>' : `<nav class="nav" aria-label="Розділи">${NAV.map(([r, l]) => `<a class="${here(r)}" href="#/${r === 'home' ? '' : r}">${l}</a>`).join('')}</nav>
    <button class="searchbtn" data-act="add" aria-label="Пошук і додавання">${icon('search')}<span>Пошук і додавання</span><kbd>/</kbd></button>`}
    ${recs ? `<a class="btn" href="./">${icon('library')}Моя полиця</a>` : `
    <button class="btn primary addbtn" data-act="add">${icon('plus')}<span>Додати</span></button>
    <div class="dd">
      <button class="acct st-${cloud.available ? cloud.state : 'local'}" data-act="menu" aria-haspopup="true" aria-label="Акаунт і меню" title="${esc(stateText)}">
        ${u ? `<span class="avatar">${esc((u.name || u.email || '?').trim()[0].toUpperCase())}</span>` : icon('user')}<i class="state"></i></button>
      <div class="pop menu" id="menu" hidden></div>
    </div>`}`;
  tabs.hidden = recs;
  tabs.innerHTML = recs ? '' : NAV.slice(0, 2).map(tab).join('')
    + `<button class="tab add" data-act="add" aria-label="Додати">${icon('plus')}</button>` + NAV.slice(2).map(tab).join('');
  function tab([r, l, ic]) { return `<a class="tab ${here(r)}" href="#/${r === 'home' ? '' : r}">${icon(ic)}<span>${l}</span></a>`; }
}

function toggleMenu(force) {
  const menu = $('#menu');
  if (!menu) return;
  const open = force ?? menu.hidden;
  if (open) {
    const u = cloud.user, nRec = store.list().filter(e => e.rec).length;
    const state = { off: 'не ввійшов', connecting: 'з’єднання…', synced: 'синхронізовано', offline: 'офлайн — зміни збережено тут', error: 'помилка синхронізації' }[cloud.state];
    menu.innerHTML = `
      ${cloud.available ? (u
        ? `<div class="who"><span class="avatar lg">${esc((u.name || u.email || '?').trim()[0].toUpperCase())}</span><div><b>${esc(u.name || 'Акаунт Google')}</b><small>${esc(u.email)}</small><em class="st-${cloud.state}"><i class="state"></i>${state}</em></div></div>`
        : `<div class="who signin"><p>Увійди, щоб полиця синхронізувалась між телефоном і компʼютером.</p><button class="btn primary" data-act="signin">${icon('user')}Увійти через Google</button></div>`)
        : '<div class="who"><p>Список зберігається в цьому браузері.</p></div>'}
      <hr>
      <button data-act="share">${icon('share')}Поділитись рекомендаціями<small>${nRec}</small></button>
      <button data-act="name">${icon('user')}Підпис у рекомендаціях<small>${esc(S.name || 'не вказано')}</small></button>
      <hr>
      <button data-act="theme">${icon('sun')}Тема<small>${{ auto: 'як у системі', light: 'світла', dark: 'темна' }[S.theme]}</small></button>
      <button data-act="demo">${icon('sparkle')}Показати на прикладі</button>
      <button data-act="export">${icon('download')}Зберегти копію у файл</button>
      <button data-act="import">${icon('upload')}Завантажити з файла…</button>
      ${u ? `<hr><button data-act="signout">${icon('logout')}Вийти</button>` : ''}`;
  }
  menu.hidden = !open;
}

// ── маршрути ──────────────────────────────────────────────────────
const RENDER = { home: renderHome, library: renderLibrary, discover: renderDiscover, stats: renderStats, recs: renderRecs };
function draw() { RENDER[view.route](); }
async function route() {
  closeOverlay();
  const raw = location.hash.slice(1);
  if (raw.startsWith('u=') || raw.startsWith('r=')) {
    view.route = 'recs';
    drawChrome();
    app.innerHTML = '<div class="empty"><b>Завантажую рекомендації…</b></div>';
    try {
      view.recs = raw.startsWith('u=') ? await cloud.loadPublic(raw.slice(2).replace(/[^\w-]/g, '')) : await decodeRecs(raw.slice(2));
      if (!view.recs) throw new Error('такого списку немає');
      document.title = `Рекомендації${view.recs.name ? ' від ' + view.recs.name : ''} · Полиця`;
      renderRecs();
    } catch (err) {
      app.innerHTML = `<div class="empty">${icon('link')}<b>Список не відкрився</b><p>${esc(err.message || 'невідома помилка')}. Попроси автора надіслати посилання ще раз.</p><a class="btn primary" href="./">На мою полицю</a></div>`;
    }
    return;
  }
  const r = raw.replace(/^\//, '');
  view.route = RENDER[r] && r !== 'recs' ? r : 'home';
  view.recs = null;
  document.title = { home: 'Полиця переглядів', library: 'Бібліотека · Полиця', discover: 'Каталог · Полиця', stats: 'Статистика · Полиця' }[view.route];
  drawChrome(); draw();
  scrollTo(0, 0);
}

// ── дії ───────────────────────────────────────────────────────────
function exportFile() {
  const blob = new Blob([JSON.stringify({ app: 'MyWatchShelf', version: 1, entries: store.raw() }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `watchshelf-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Копію збережено у файл');
}
function importFile() {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      const list = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(list)) throw new Error('у файлі немає списку');
      const n = store.importMany(list);
      toast(n ? `Завантажено: ${n} ${plural(n, 'запис', 'записи', 'записів')}` : 'Нового у файлі немає');
    } catch (err) { toast('Файл не прочитався: ' + err.message, { ms: 4500 }); }
  };
  inp.click();
}
const idOf = el => el.closest('[data-id]')?.dataset.id || ui.overlay?.id;

on({
  ...cardActions,
  close: closeOverlay,
  add: openPalette,
  menu: () => toggleMenu(),
  signin: () => { try { cloud.signIn(); } catch (err) { toast('Не вдалося ввійти: ' + err.message, { ms: 5000 }); } },
  signout: async () => {
    if (await confirmBox({ title: 'Вийти з акаунта?', text: 'Список лишиться на цьому пристрої, але перестане синхронізуватись.', ok: 'Вийти' })) {
      await cloud.signOut(); toast('Ви вийшли з акаунта');
    }
  },
  'hide-hint': () => { store.setSetting('hint', false); draw(); },
  theme: () => { store.setSetting('theme', { auto: 'light', light: 'dark', dark: 'auto' }[S.theme]); applyTheme(); toggleMenu(true); return 'keep'; },
  name: async () => {
    const v = await promptBox({ title: 'Підпис у рекомендаціях', text: 'Його побачать усі, кому ти даси посилання на свої рекомендації.', value: S.name || cloud.user?.name || '', placeholder: 'Наприклад, Костя' });
    if (v !== null) { store.setSetting('name', v.slice(0, 80)); cloud.publishNow().catch(() => {}); toast('Підпис збережено'); }
  },
  share: openShare,
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
    toast(`«${x.title}» — у планах`, { label: 'Відкрити', action: () => openCard(x.id) });
  },
  take: (v, el) => {
    const x = recall(idOf(el));
    if (!x || !addItem(x)) return;
    toast(`«${x.title}» — на твоїй полиці`);
    if (ui.overlay) closeOverlay();
  },
  'add-as': v => addFromPreview(v),
  rail: (v, el) => { const t = $('.rail-track', el.closest('.rail')); t.scrollBy({ left: +v * t.clientWidth * 0.85, behavior: 'smooth' }); },
  // бібліотека
  kind: v => { view.f.kind = v; updateLibrary(); },
  status: v => { view.f.status = v; updateLibrary(); },
  genre: v => { const g = view.f.genres, i = g.indexOf(v); if (i < 0) g.push(v); else g.splice(i, 1); updateLibrary(); return 'keep'; },
  'genres-toggle': () => { const p = $('#lib-genres'); p.hidden = !p.hidden; return 'keep'; },
  'reset-filters': () => { Object.assign(view.f, { q: '', kind: 'all', status: 'all', genres: [] }); if ($('#lib-q')) $('#lib-q').value = ''; updateLibrary(); },
  dir: () => { store.setSetting('dir', -S.dir); updateLibrary(); },
  view: () => { store.setSetting('view', S.view === 'grid' ? 'list' : 'grid'); updateLibrary(); },
  // каталог
  'disc-type': v => { view.disc.type = v; renderDiscover(); },
  'disc-more': () => loadDiscover(false),
  // пошук і поширення
  pick: v => pickResult(+v),
  'drop-url': dropUrl,
  copy: async () => {
    try { await navigator.clipboard.writeText(ui.overlay.link); toast('Посилання скопійовано'); }
    catch { $('.linkbox', layer).select(); toast('Виділено — скопіюй вручну'); }
  },
  'native-share': () => navigator.share({ title: 'Мої рекомендації', url: ui.overlay.link }).catch(() => {}),
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
function closePops() { $$('.pop').forEach(p => { p.hidden = true; }); }
document.addEventListener('keydown', ev => {
  const typing = ev.target.matches?.('input,textarea,select');
  if (ev.key === 'Escape') { if (ui.overlay) closeOverlay(); else closePops(); }
  else if ((ev.key === '/' && !typing) || (ev.key.toLowerCase() === 'k' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); if (view.route !== 'recs') openPalette(); }
  else if (ev.key === 'Enter' && ev.target.matches?.('[data-act][tabindex]')) ev.target.click();
});

// ── зміни даних ───────────────────────────────────────────────────
function refresh() {
  if (view.route === 'library') updateLibrary();
  else if (view.route === 'discover') drawDiscover();
  else if (view.route === 'home') {
    // ряди після перемальовування лишаються там, де їх прогорнули
    const pos = new Map($$('.rail').map(r => [$('h2', r).textContent, $('.rail-track', r).scrollLeft]));
    draw();
    $$('.rail').forEach(r => { const x = pos.get($('h2', r).textContent); if (x) $('.rail-track', r).scrollLeft = x; });
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
  if (cloud.lastError) { toast(`Не вдалося ввійти (${cloud.lastError}). Спробуй ще раз.`, { ms: 5000 }); cloud.lastError = ''; }
  if (cloud.justSignedIn && cloud.state === 'synced' && !greeted) { greeted = true; toast('Вхід виконано — полиця синхронізується'); }
});
addEventListener('error', () => toast('Щось пішло не так. Онови сторінку, якщо застосунок не відповідає.', { ms: 5000 }));

applyTheme();
cloud.init();
addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
