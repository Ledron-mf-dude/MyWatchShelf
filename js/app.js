import {
  STATUSES, KINDS, STATUS_LABEL, KIND_LABEL, esc, safeUrl, poster, plural, fmtRating,
  parseInput, nextEpisode, progressText, seasonTotal, filterSort, stats,
  recItem, encodeRecs, decodeRecs,
} from './logic.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { cloud } from './cloud.js';

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app'), layer = $('#layer');
const S = store.settings;

const f = { q: '', kind: 'all', status: 'all' };
let mode = 'shelf';      // shelf | recs
let recs = null;         // чужі рекомендації, коли відкрито посилання
let overlay = null;      // { type: 'card'|'add'|'share'|'info', ... }

const SORTS = [['updated', 'за оновленням'], ['score', 'за моєю оцінкою'], ['imdb', 'за IMDb'], ['title', 'за назвою'], ['year', 'за роком']];
const META_TTL = 14 * 24 * 3600 * 1000;

// ── дрібниці ──────────────────────────────────────────────────────
function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('on'), ms);
}
function applyTheme() {
  if (S.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.theme;
}
const initials = t => esc(String(t || '?').trim().slice(0, 2).toUpperCase());
const ph = (id, title, size = 'small', cls = '') =>
  `<span class="ph ${cls}"><em>${initials(title)}</em><img loading="lazy" alt="" src="${poster(id, size)}"></span>`;
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') e.target.closest('.ph')?.classList.add('noimg');
}, true);
const chip = (act, v, label, on, cls = '') =>
  `<button class="chip ${cls} ${on ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${on}">${esc(label)}</button>`;

// ── полиця ────────────────────────────────────────────────────────
function shell() {
  app.innerHTML = `
  <header class="top">
    <div class="brand-row">
      <div class="brand"><b>Полиця</b><span>переглядів</span></div>
      <button class="pill" id="pill" data-act="pill"></button>
    </div>
    <dl class="stats" id="stats"></dl>
  </header>
  <div class="tools">
    <label class="fld search"><input id="q" type="search" placeholder="Пошук у списку" autocomplete="off" aria-label="Пошук у списку"></label>
    <div class="fld sort"><span class="cap">сортувати</span>
      <select id="sort" aria-label="Сортування">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <button class="mini" data-act="dir" id="dir" title="Напрям сортування"></button>
    </div>
    <span class="grow"></span>
    <button class="btn primary" data-act="add">Додати</button>
    <div class="menu-wrap">
      <button class="btn" data-act="menu" aria-label="Меню" aria-haspopup="true">···</button>
      <div class="menu" id="menu" hidden></div>
    </div>
  </div>
  <div class="chips" id="kinds"></div>
  <div class="chips" id="statuses"></div>
  <div id="hint"></div>
  <div class="count-row"><span class="cap" id="count"></span><span class="grow"></span>
    <button class="sq" data-act="view" id="view" title="Список або плитка"></button></div>
  <ul id="list"></ul>`;
  $('#q').value = f.q;
  $('#sort').value = S.sort;
  $('#q').addEventListener('input', e => { f.q = e.target.value; renderList(); });
  $('#sort').addEventListener('change', e => { store.setSetting('sort', e.target.value); renderList(); });
}

function renderPill() {
  const el = $('#pill');
  if (!el) return;
  const text = !cloud.available ? 'лише цей пристрій'
    : { off: 'увійти', connecting: 'з’єднання…', synced: 'синхронізовано', offline: 'офлайн', error: 'помилка синхронізації' }[cloud.state];
  el.className = 'pill st-' + (cloud.available ? cloud.state : 'local');
  el.innerHTML = `<i></i>${esc(text)}`;
  el.title = cloud.user ? cloud.user.email : '';
}

function renderStats() {
  const s = stats(store.list());
  const parts = [s.anime && `${s.anime} аніме`, s.series && `${s.series} ${plural(s.series, 'серіал', 'серіали', 'серіалів')}`,
    s.movie && `${s.movie} ${plural(s.movie, 'фільм', 'фільми', 'фільмів')}`].filter(Boolean).join(' · ');
  $('#stats').innerHTML = `
    <div><dt>На полиці</dt><dd>${s.total} <small>${esc(parts)}</small></dd></div>
    <div><dt>Дивлюсь зараз</dt><dd>${s.watching}</dd></div>
    <div><dt>Переглянуто</dt><dd>${s.done}</dd></div>
    <div><dt>Оцінено</dt><dd>${s.rated} <small>${s.rated ? 'середня ' + fmtRating(s.avg) : ''}</small></dd></div>`;
}

function renderChips() {
  const list = store.list();
  const n = fn => list.filter(fn).length;
  $('#kinds').innerHTML = `<span class="cap">тип</span>` +
    chip('kind', 'all', 'усі', f.kind === 'all') +
    KINDS.map(([v]) => chip('kind', v, { anime: 'аніме', series: 'серіали', movie: 'фільми' }[v], f.kind === v)).join('');
  $('#statuses').innerHTML = `<span class="cap">статус</span>` +
    chip('status', 'all', 'усі', f.status === 'all') +
    STATUSES.map(([v, l]) => chip('status', v, l, f.status === v)).join('') +
    chip('status', 'rec', `★ раджу${n(e => e.rec) ? ' ' + n(e => e.rec) : ''}`, f.status === 'rec');
}

function renderHint() {
  const el = $('#hint');
  if (!el) return;
  const show = cloud.available && !cloud.user && cloud.state === 'off' && S.hint && store.list().length > 0;
  el.innerHTML = show ? `
    <div class="hint"><div><span class="cap">лише цей пристрій</span>
      <p>Список зберігається в цьому браузері. Увійди через Google — і він сам з’явиться на телефоні та інших пристроях.</p></div>
      <div class="hint-act"><button class="btn primary" data-act="signin">Увійти</button>
      <button class="btn" data-act="hide-hint">Не зараз</button></div></div>` : '';
}

function rowHtml(e) {
  const m = e.meta || {}, url = safeUrl(e.url);
  const line = [STATUS_LABEL[e.status], progressText(e), ...(m.genres || []).slice(0, 3).map(g => g.toLowerCase()), m.runtime]
    .filter(Boolean).join(' · ');
  return `<li class="row" data-id="${e.id}" data-act="open" tabindex="0">
    ${ph(e.id, e.title)}
    <div class="row-main">
      <div class="row-title"><i class="dot st-${e.status}"></i><b>${esc(e.title)}</b>${e.rec ? '<span class="tag">★ раджу</span>' : ''}</div>
      <div class="row-sub">${esc([KIND_LABEL[e.kind], e.year].filter(Boolean).join(' · '))}</div>
      <div class="row-meta">${esc(line)}</div>
    </div>
    <div class="row-act">
      ${url ? `<a class="sq" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Дивитись" aria-label="Дивитись">▶</a>` : ''}
      ${e.type === 'series' && e.status !== 'done' && e.status !== 'dropped' ? `<button class="sq" data-act="plus" title="Наступна серія">+1</button>` : ''}
    </div>
    <div class="score ${e.score ? '' : 'none'}"><b>${e.score || '—'}</b><i style="--w:${(e.score || 0) * 10}%"></i>
      <small>IMDb ${fmtRating(m.imdb) || '—'}</small></div>
  </li>`;
}
function tileHtml(e) {
  const m = e.meta || {};
  return `<li class="tile" data-id="${e.id}" data-act="open" tabindex="0">
    <div class="tile-img">${ph(e.id, e.title, 'medium', 'fill')}
      ${e.score ? `<span class="badge">${e.score}</span>` : ''}
      ${m.imdb ? `<span class="badge imdb">IMDb ${fmtRating(m.imdb)}</span>` : ''}</div>
    <div class="tile-cap"><div class="row-title"><i class="dot st-${e.status}"></i><b>${esc(e.title)}</b></div>
      <div class="row-meta">${esc(progressText(e) || STATUS_LABEL[e.status])}</div></div>
  </li>`;
}

function renderList() {
  const all = store.list();
  const list = filterSort(all, f, S.sort, S.dir);
  const ul = $('#list');
  $('#dir').textContent = S.dir < 0 ? '↓' : '↑';
  $('#view').textContent = S.view === 'grid' ? '☰' : '▦';
  $('#count').textContent = `${list.length} ${plural(list.length, 'запис', 'записи', 'записів')}` +
    (list.length !== all.length ? ` з ${all.length}` : '');
  ul.className = S.view === 'grid' ? 'grid' : 'list';
  if (!all.length) {
    ul.innerHTML = `<li class="empty"><b>Полиця поки порожня</b>
      <p>Додай перше аніме, фільм чи серіал — за назвою, посиланням IMDb або посиланням сайту, де дивишся.</p>
      <button class="btn primary" data-act="add">Додати перший запис</button></li>`;
  } else if (!list.length) {
    ul.innerHTML = `<li class="empty"><b>Нічого не знайшлось</b><p>Спробуй інший фільтр або пошук.</p></li>`;
  } else {
    ul.innerHTML = list.map(S.view === 'grid' ? tileHtml : rowHtml).join('');
  }
}

function renderShelf() {
  if (mode !== 'shelf') return;
  renderPill(); renderStats(); renderChips(); renderHint(); renderList();
}

// ── меню ──────────────────────────────────────────────────────────
function toggleMenu(force) {
  const menu = $('#menu');
  if (!menu) return;
  const open = force ?? menu.hidden;
  if (open) {
    const nRec = store.list().filter(e => e.rec).length;
    const themeLabel = { auto: 'як у системі', light: 'світла', dark: 'темна' }[S.theme];
    menu.innerHTML = `
      <button data-act="share">Поділитись рекомендаціями <small>${nRec}</small></button>
      <button data-act="name">Ім’я в рекомендаціях… <small>${esc(S.name || 'не вказано')}</small></button>
      <hr>
      ${cloud.available ? (cloud.user
        ? `<button data-act="signout">Вийти <small>${esc(cloud.user.email)}</small></button>`
        : `<button data-act="signin">Увійти через Google <small>синхронізація</small></button>`) : ''}
      <button data-act="theme">Тема <small>${themeLabel}</small></button>
      <hr>
      <button data-act="export">Зберегти копію у файл</button>
      <button data-act="import">Завантажити з файла…</button>`;
  }
  menu.hidden = !open;
}

// ── шар поверх: картка, додавання, поширення ──────────────────────
function closeOverlay() {
  flushCard();
  overlay?.abort?.abort();
  overlay = null;
  layer.innerHTML = '';
  document.documentElement.classList.remove('locked');
}
function showOverlay(o, html) {
  overlay?.abort?.abort();
  overlay = o;
  layer.innerHTML = `<div class="scrim" data-act="close"></div>${html}`;
  document.documentElement.classList.add('locked');
}

// картка власного запису
let pending = {}, pendingTimer = null;
function flushCard() {
  clearTimeout(pendingTimer);
  if (overlay?.type === 'card' && Object.keys(pending).length) {
    const p = pending; pending = {};
    store.save(overlay.id, p);
  }
  pending = {};
}

function cardHtml(e) {
  const m = e.meta || {}, total = seasonTotal(e), url = safeUrl(e.url);
  const maxSeason = Math.max(0, ...Object.keys(m.seasons || {}).map(Number));
  return `
  <header class="card-head">
    ${ph(e.id, e.title, 'medium', 'lg')}
    <div class="card-ttl">
      <h2>${esc(e.title)}</h2>
      <p class="sub">${esc([KIND_LABEL[e.kind], e.year, m.runtime].filter(Boolean).join(' · '))}</p>
      <p class="sub"><a class="imdb" href="https://www.imdb.com/title/${e.id}/" target="_blank" rel="noopener noreferrer">IMDb <b>${fmtRating(m.imdb) || '—'}</b> ↗</a></p>
      ${m.genres?.length ? `<p class="genres">${m.genres.map(g => `<span>${esc(g)}</span>`).join('')}</p>` : ''}
    </div>
    <button class="sq" data-act="close" aria-label="Закрити">✕</button>
  </header>
  <div class="card-body">
    ${m.plot ? `<p class="plot">${esc(m.plot)}</p>` : (e.metaAt ? '' : '<p class="plot faint">Тягну опис і оцінку…</p>')}
    <section><h3>Статус</h3><div class="chipset">${STATUSES.map(([v, l]) => chip('set-status', v, l, e.status === v, 'st-' + v)).join('')}</div></section>
    ${e.type === 'series' ? `<section><h3>Де я зупинився</h3>
      <div class="progress">
        <div class="stepper"><button data-act="step" data-v="season:-1" aria-label="Попередній сезон">−</button>
          <label><span>сезон</span><input type="number" inputmode="numeric" min="1" data-num="season" value="${e.season || 1}"></label>
          <button data-act="step" data-v="season:1" aria-label="Наступний сезон">+</button></div>
        <div class="stepper"><button data-act="step" data-v="episode:-1" aria-label="Попередня серія">−</button>
          <label><span>серія</span><input type="number" inputmode="numeric" min="0" data-num="episode" value="${e.episode || 0}"></label>
          <button data-act="step" data-v="episode:1" aria-label="Наступна серія">+</button></div>
        <button class="btn" data-act="plus">+1 серія</button>
      </div>
      <p class="faint small">${total ? `У сезоні ${e.season || 1} — ${total} ${plural(total, 'серія', 'серії', 'серій')}` : 'Кількість серій у цьому сезоні невідома'}${maxSeason ? ` · сезонів: ${maxSeason}` : ''}${m.state ? ` · ${/ended/i.test(m.state) ? 'завершено' : 'ще виходить'}` : ''}</p>
    </section>` : ''}
    <section><h3>Моя оцінка</h3><div class="scores">${Array.from({ length: 10 }, (_, i) =>
      `<button data-act="score" data-v="${i + 1}" class="${e.score === i + 1 ? 'on' : ''}" aria-pressed="${e.score === i + 1}">${i + 1}</button>`).join('')}</div></section>
    <section><h3>Де дивлюсь</h3>
      <div class="linkrow"><input type="url" data-field="url" placeholder="Посилання на сайт чи плеєр" value="${esc(e.url)}">
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Відкрити ↗</a>` : ''}</div></section>
    <section><h3>Нотатка</h3><textarea data-field="note" rows="3" placeholder="Для себе: враження, на чому зупинився, з ким дивитись">${esc(e.note)}</textarea></section>
    <section><h3>Рекомендація</h3>
      <div class="chipset">${chip('rec', '', e.rec ? '★ Раджу друзям' : '☆ Додати в рекомендації', e.rec, 'rec')}</div>
      ${e.rec ? `<input type="text" data-field="recNote" maxlength="500" placeholder="Кілька слів, чому варто (побачать усі, кому даси посилання)" value="${esc(e.recNote)}">` : ''}
    </section>
    <section><h3>Тип</h3><div class="chipset">${KINDS.map(([v, l]) => chip('set-kind', v, l, e.kind === v)).join('')}</div></section>
  </div>
  <footer class="card-foot">
    <button class="btn danger" data-act="del">Видалити</button>
    <button class="btn" data-act="refresh">Оновити дані</button>
    <span class="grow"></span>
    <button class="btn primary" data-act="close">Готово</button>
  </footer>`;
}

function drawCard() {
  const e = store.get(overlay.id);
  if (!e) return closeOverlay();
  const card = $('.card', layer);
  const scroll = $('.card-body', layer)?.scrollTop || 0;
  card.innerHTML = cardHtml(e);
  $('.card-body', layer).scrollTop = scroll;
}
function openCard(id) {
  const e = store.get(id);
  if (!e) return;
  showOverlay({ type: 'card', id }, `<aside class="card" role="dialog" aria-label="Картка"></aside>`);
  drawCard();
  if (!e.metaAt || Date.now() - e.metaAt > META_TTL) refreshMeta(id);
}

async function refreshMeta(id, { first = false, detect = false, loud = false } = {}) {
  const e = store.get(id);
  if (!e) return;
  try {
    const x = await catalog.fetchMeta(id, detect ? undefined : e.type);
    const cur = store.get(id);
    if (!cur) return;
    const patch = {};
    if (first && cur.kind !== x.kind) patch.kind = x.kind;
    if (cur.type !== x.type) patch.type = x.type;
    if (x.title && cur.title !== x.title) patch.title = x.title;
    if (x.year && cur.year !== x.year) patch.year = x.year;
    if (Object.keys(patch).length) store.save(id, patch);
    store.setMeta(id, x.meta);
    if (loud) toast('Дані оновлено');
  } catch (err) {
    if (loud) toast('Не вдалося оновити: ' + err.message);
  }
}

// додавання
function openAdd() {
  showOverlay({ type: 'add', results: [], url: '', abort: null }, `
    <div class="dialog" role="dialog" aria-label="Додати на полицю">
      <div class="dlg-head">
        <input id="addq" type="search" placeholder="Назва, посилання IMDb або сайту, де дивишся" autocomplete="off" aria-label="Що додати">
        <button class="sq" data-act="close" aria-label="Закрити">✕</button>
      </div>
      <div class="dlg-note" id="addnote"></div>
      <ul class="results" id="results"><li class="faint pad">Почни вводити назву — будь-якою мовою. Можна вставити посилання.</li></ul>
    </div>`);
  const input = $('#addq');
  input.focus();
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 220); });
  input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && overlay.results[0]) pick(0); });
}
function addNote() {
  const o = overlay, host = o.url ? new URL(o.url).host : '';
  $('#addnote').innerHTML = host
    ? `<span class="tag">посилання ${esc(host)} збережу як «де дивлюсь»</span> <button class="linkbtn" data-act="drop-url">не треба</button>` : '';
}
async function runSearch(raw) {
  const o = overlay;
  if (o?.type !== 'add') return;
  o.abort?.abort();
  const ac = o.abort = new AbortController();
  const p = parseInput(raw), ul = $('#results');
  if (p.url) { o.url = safeUrl(p.url); addNote(); }
  if (!p.id && p.query.length < 2) {
    o.results = [];
    ul.innerHTML = `<li class="faint pad">${p.url ? 'З посилання не вдалося вгадати назву — допиши її вручну.' : 'Почни вводити назву — будь-якою мовою. Можна вставити посилання.'}</li>`;
    if (p.url) { $('#addq').value = ''; }
    return;
  }
  ul.classList.add('busy');
  try {
    const res = p.id ? [await catalog.fetchMeta(p.id, undefined, ac.signal)] : await catalog.search(p.query, ac.signal);
    if (ac.signal.aborted) return;
    if (p.url && !p.id) $('#addq').value = p.query;
    o.results = res;
    ul.innerHTML = res.length ? res.map((r, i) => {
      const have = store.get(r.id);
      return `<li class="res" data-act="pick" data-v="${i}" tabindex="0">${ph(r.id, r.title)}
        <div class="row-main"><div class="row-title"><b>${esc(r.title)}</b></div>
          <div class="row-sub">${esc([r.year, KIND_LABEL[r.kind || r.type]].filter(Boolean).join(' · '))}</div></div>
        ${have ? '<span class="tag">уже на полиці</span>' : '<span class="tag add">＋ додати</span>'}</li>`;
    }).join('') : `<li class="faint pad">Нічого не знайшлось. Спробуй англійську або оригінальну назву, чи встав посилання з IMDb.</li>`;
  } catch (err) {
    if (err.name === 'AbortError') return;
    ul.innerHTML = `<li class="faint pad">Пошук зараз недоступний (${esc(err.message)}). Перевір мережу й спробуй ще раз.</li>`;
  } finally {
    if (!ac.signal.aborted) ul.classList.remove('busy');
  }
}
function pick(i) {
  const o = overlay, r = o.results[i];
  if (!r) return;
  const have = store.get(r.id), url = o.url;
  if (have) {
    if (url && !have.url) store.save(r.id, { url });
  } else {
    store.save(r.id, { type: r.type, kind: r.kind || r.type, title: r.title, year: r.year,
      status: 'planned', season: 1, episode: 0, url: url || '', added: Date.now() });
    if (r.meta) store.setMeta(r.id, r.meta);
  }
  closeOverlay();
  openCard(r.id);
  if (!have && !r.meta) refreshMeta(r.id, { first: true });
}

// поширення рекомендацій
async function openShare() {
  const items = store.list().filter(e => e.rec)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title, 'uk')).map(recItem);
  if (!items.length) return toast('Спершу відкрий запис і натисни «Додати в рекомендації»', 4000);
  const base = location.origin + location.pathname;
  let link, live = false;
  if (cloud.user) {
    try { await cloud.publishNow(); link = `${base}#u=${cloud.user.uid}`; live = true; } catch { /* нижче — знімок */ }
  }
  link ??= `${base}#r=${await encodeRecs(S.name, items)}`;
  showOverlay({ type: 'share', link }, `
    <div class="dialog narrow" role="dialog" aria-label="Поділитись рекомендаціями">
      <div class="dlg-head"><h2>Мої рекомендації · ${items.length}</h2><button class="sq" data-act="close" aria-label="Закрити">✕</button></div>
      <div class="pad">
        <p>${live
          ? 'Це постійне посилання: воно саме показує свіжий список, коли ти додаєш чи прибираєш рекомендації.'
          : 'Це знімок: список зашито просто в посилання. Зміниш рекомендації — надішли нове.' + (cloud.available ? ' Увійди через Google, і посилання стане постійним.' : '')}</p>
        <input class="linkbox" readonly value="${esc(link)}" aria-label="Посилання">
        <div class="hint-act">
          <button class="btn primary" data-act="copy">Копіювати</button>
          ${navigator.share ? '<button class="btn" data-act="native-share">Надіслати…</button>' : ''}
          <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">Подивитись</a>
        </div>
        <p class="faint small">Гість бачить назви, твої оцінки й коментарі до рекомендацій. Посилання «де дивлюсь» і нотатки не передаються.</p>
      </div>
    </div>`);
}

// ── чужі рекомендації ─────────────────────────────────────────────
function renderRecs() {
  const { name, items } = recs;
  app.innerHTML = `
  <header class="top">
    <div class="brand-row">
      <div class="brand"><b>Рекомендації</b><span>${name ? 'від ' + esc(name) : ''}</span></div>
      <a class="pill" href="./"><i></i>моя полиця →</a>
    </div>
  </header>
  <p class="lead">${items.length} ${plural(items.length, 'назва', 'назви', 'назв')}, які варто подивитись. «＋ собі» кладе запис на твою власну полицю — вона зберігається в цьому браузері.</p>
  <ul class="list recs">${items.map((x, i) => {
    const have = store.get(x.id);
    return `<li class="row" data-act="info" data-v="${i}" tabindex="0">
      ${ph(x.id, x.t, 'medium', 'md')}
      <div class="row-main">
        <div class="row-title"><b>${esc(x.t)}</b></div>
        <div class="row-sub">${esc([KIND_LABEL[x.k], x.y].filter(Boolean).join(' · '))}</div>
        ${x.n ? `<blockquote>${esc(x.n)}</blockquote>` : ''}
      </div>
      <div class="row-act"><button class="btn ${have ? '' : 'primary'}" data-act="take" data-v="${i}" ${have ? 'disabled' : ''}>${have ? '✓ у тебе' : '＋ собі'}</button></div>
      <div class="score ${x.s ? '' : 'none'}"><b>${x.s || '—'}</b><i style="--w:${x.s * 10}%"></i><small>IMDb ${fmtRating(x.r) || '—'}</small></div>
    </li>`;
  }).join('') || '<li class="empty"><b>Тут поки порожньо</b><p>Автор ще нічого не порадив.</p></li>'}</ul>`;
}
function take(i) {
  const x = recs.items[i];
  if (!x || store.get(x.id)) return;
  store.save(x.id, { type: x.k === 'movie' ? 'movie' : 'series', kind: x.k, title: x.t, year: x.y,
    status: 'planned', season: 1, episode: 0, added: Date.now() });
  refreshMeta(x.id, { detect: true });
  toast('Додано на твою полицю');
}
async function openInfo(i) {
  const x = recs.items[i];
  if (!x) return;
  const ac = new AbortController();
  const html = (m, plot) => `
    <header class="card-head">${ph(x.id, x.t, 'medium', 'lg')}
      <div class="card-ttl"><h2>${esc(x.t)}</h2>
        <p class="sub">${esc([KIND_LABEL[x.k], x.y, m?.runtime].filter(Boolean).join(' · '))}</p>
        <p class="sub"><a class="imdb" href="https://www.imdb.com/title/${x.id}/" target="_blank" rel="noopener noreferrer">IMDb <b>${fmtRating(m?.imdb || x.r) || '—'}</b> ↗</a></p>
        ${m?.genres?.length ? `<p class="genres">${m.genres.map(g => `<span>${esc(g)}</span>`).join('')}</p>` : ''}</div>
      <button class="sq" data-act="close" aria-label="Закрити">✕</button></header>
    <div class="card-body">
      ${x.s ? `<section><h3>Оцінка автора</h3><p class="bigscore">${x.s}<small> з 10</small></p></section>` : ''}
      ${x.n ? `<section><h3>Чому варто</h3><blockquote>${esc(x.n)}</blockquote></section>` : ''}
      <section><h3>Про що</h3><p class="plot ${m ? '' : 'faint'}">${esc(plot)}</p></section>
    </div>
    <footer class="card-foot"><span class="grow"></span>
      <button class="btn primary" data-act="take" data-v="${i}" ${store.get(x.id) ? 'disabled' : ''}>${store.get(x.id) ? '✓ у тебе' : '＋ собі на полицю'}</button></footer>`;
  showOverlay({ type: 'info', i, abort: ac }, `<aside class="card" role="dialog" aria-label="Про запис">${html(null, 'Тягну опис…')}</aside>`);
  try {
    const r = await catalog.fetchMeta(x.id, x.k === 'movie' ? 'movie' : undefined, ac.signal);
    if (overlay?.abort === ac) $('.card', layer).innerHTML = html(r.meta, r.meta.plot || 'Опису немає.');
  } catch (err) {
    if (err.name !== 'AbortError' && overlay?.abort === ac) $('.card', layer).innerHTML = html(null, 'Опис не завантажився.');
  }
}

// ── дії ───────────────────────────────────────────────────────────
function plus(id) {
  const e = store.get(id);
  if (!e) return;
  const patch = nextEpisode(e);
  if (patch.episode === undefined && patch.season === undefined && !patch.status) return toast('Це остання відома серія');
  flushCard();
  const n = store.save(id, patch);
  if (overlay?.type === 'card') drawCard();
  toast(patch.status === 'done' ? `«${n.title}» — переглянуто повністю` : `${n.title}: ${progressText(n)}`);
}
async function signIn() {
  try { await cloud.signIn(); toast('Вхід виконано — список синхронізується'); }
  catch (err) {
    const code = err?.code || '';
    if (/popup-closed|cancelled/.test(code)) return;
    toast(/unauthorized-domain/.test(code) ? 'Цю адресу не додано до дозволених у Firebase'
      : /popup-blocked/.test(code) ? 'Браузер заблокував вікно входу — дозволь спливні вікна'
      : 'Не вдалося ввійти: ' + (err.message || code), 5000);
  }
}
function exportFile() {
  const blob = new Blob([JSON.stringify({ app: 'MyWatchShelf', version: 1, entries: store.raw() }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `watchshelf-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
    } catch (err) { toast('Файл не прочитався: ' + err.message, 4000); }
  };
  inp.click();
}

const actions = {
  close: closeOverlay,
  add: openAdd,
  menu: () => toggleMenu(),
  pill: () => (!cloud.available ? toast('Список зберігається в цьому браузері. Копію можна зберегти у файл через меню «···».', 4500)
    : cloud.user ? toggleMenu(true) : cloud.state === 'off' ? signIn() : null),
  signin: signIn,
  signout: async () => { if (confirm('Вийти з акаунта? Список лишиться на цьому пристрої, але перестане синхронізуватись.')) { await cloud.signOut(); toast('Ви вийшли'); } },
  'hide-hint': () => { store.setSetting('hint', false); renderHint(); },
  dir: () => { store.setSetting('dir', -S.dir); renderList(); },
  view: () => { store.setSetting('view', S.view === 'grid' ? 'list' : 'grid'); renderList(); },
  kind: v => { f.kind = v; renderChips(); renderList(); },
  status: v => { f.status = v; renderChips(); renderList(); },
  theme: () => { store.setSetting('theme', { auto: 'light', light: 'dark', dark: 'auto' }[S.theme]); applyTheme(); toggleMenu(true); return 'keep'; },
  name: () => { const v = prompt('Як підписати твої рекомендації?', S.name || cloud.user?.name || ''); if (v !== null) { store.setSetting('name', v.trim().slice(0, 80)); cloud.publishNow().catch(() => {}); } },
  share: openShare,
  export: exportFile,
  import: importFile,
  open: (v, el) => openCard(el.closest('[data-id]').dataset.id),
  plus: (v, el) => plus(el.closest('[data-id]')?.dataset.id || overlay?.id),
  pick: v => pick(+v),
  'drop-url': () => { overlay.url = ''; addNote(); },
  info: v => openInfo(+v),
  take: v => { take(+v); if (overlay) closeOverlay(); renderRecs(); },
  copy: async () => { try { await navigator.clipboard.writeText(overlay.link); toast('Посилання скопійовано'); } catch { $('.linkbox', layer).select(); toast('Виділено — скопіюй вручну'); } },
  'native-share': () => navigator.share({ title: 'Мої рекомендації', url: overlay.link }).catch(() => {}),
  // картка
  'set-status': v => {
    const e = store.get(overlay.id), patch = { status: v };
    if (v === 'done' && e.type === 'series') {
      const last = Math.max(0, ...Object.keys(e.meta?.seasons || {}).map(Number));
      if (last) { patch.season = last; patch.episode = e.meta.seasons[last]; }
    }
    cardSave(patch);
  },
  'set-kind': v => cardSave({ kind: v }),
  score: v => cardSave({ score: store.get(overlay.id).score === +v ? 0 : +v }),
  rec: () => cardSave({ rec: !store.get(overlay.id).rec }),
  step: v => {
    const [k, d] = v.split(':'), e = store.get(overlay.id);
    const patch = { [k]: Math.max(k === 'season' ? 1 : 0, (e[k] || 0) + +d) };
    if (k === 'season' && patch.season !== e.season) patch.episode = 0;
    cardSave(patch);
  },
  del: () => { const e = store.get(overlay.id); if (e && confirm(`Прибрати «${e.title}» з полиці?`)) { const id = overlay.id; pending = {}; closeOverlay(); store.remove(id); } },
  refresh: () => refreshMeta(overlay.id, { loud: true }),
};
function cardSave(patch) {
  flushCard();
  store.save(overlay.id, patch);
  // Safari не переводить фокус на кнопку при дотику, тож покладатися на
  // «фокус не в полі» не можна: після дії з картки малюємо її явно.
  drawCard();
}

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  const inMenu = ev.target.closest('.menu-wrap');
  if (!el) { if (!inMenu) toggleMenu(false); return; }
  // посилання й кнопки всередині рядка мають власну дію, а не «відкрити картку»
  if (el.dataset.act === 'open' && ev.target.closest('a')) return;
  const keep = actions[el.dataset.act]?.(el.dataset.v, el);
  if (el.dataset.act !== 'menu' && keep !== 'keep') toggleMenu(false);
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { if (overlay) closeOverlay(); else toggleMenu(false); }
  if (ev.key === 'Enter' && ev.target.matches('li[data-act]')) ev.target.click();
});
// текстові поля картки зберігаються самі, за пів секунди після останньої літери
layer.addEventListener('input', ev => {
  if (overlay?.type !== 'card') return;
  const t = ev.target;
  if (t.dataset.field) pending[t.dataset.field] = t.value;
  else if (t.dataset.num) pending[t.dataset.num] = Math.max(t.dataset.num === 'season' ? 1 : 0, parseInt(t.value, 10) || 0);
  else return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushCard, 500);
});

// ── зміни даних ───────────────────────────────────────────────────
store.onChange(() => {
  if (mode === 'recs') { if (!overlay) renderRecs(); return; }
  renderStats(); renderChips(); renderHint(); renderList();
  if (overlay?.type === 'card') {
    const a = document.activeElement;
    // поки людина друкує в картці, не перемальовуємо її під руками
    if (!(a && layer.contains(a) && a.matches('input,textarea'))) drawCard();
  }
});
cloud.onChange(() => { renderPill(); renderHint(); });

// ── маршрути ──────────────────────────────────────────────────────
async function route() {
  closeOverlay();
  const h = location.hash.slice(1);
  if (h.startsWith('u=') || h.startsWith('r=')) {
    mode = 'recs';
    app.innerHTML = '<p class="lead">Завантажую рекомендації…</p>';
    try {
      recs = h.startsWith('u=') ? await cloud.loadPublic(h.slice(2).replace(/[^\w-]/g, '')) : await decodeRecs(h.slice(2));
      if (!recs) throw new Error('такого списку немає');
      document.title = `Рекомендації${recs.name ? ' від ' + recs.name : ''}`;
      renderRecs();
    } catch (err) {
      app.innerHTML = `<div class="empty"><b>Список не відкрився</b><p>${esc(err.message || 'невідома помилка')}. Попроси автора надіслати посилання ще раз.</p><a class="btn primary" href="./">На мою полицю</a></div>`;
    }
    return;
  }
  mode = 'shelf'; recs = null;
  document.title = 'Полиця переглядів';
  shell(); renderShelf();
}

applyTheme();
cloud.init();
addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
