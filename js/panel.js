// Усе, що відкривається поверх сторінки: картка запису, перегляд тайтла
// з каталогу, пошук-палітра та діалог поширення рекомендацій.
import {
  STATUS_IDS, KIND_IDS, statusLabel, kindLabel, esc, safeUrl, backdrop, fmtRating, fmtScore, fmtRuntime, genreName,
  parseInput, nextEpisode, progressText, progressPct, seasonTotal, episodesWatched, episodesTotal, recItem, encodeRecs, filterSort, listNames, insights,
} from './logic.js';
import { t, tn, getLang } from './i18n.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { listdefs, defId } from './synced.js';
import {
  cleanListFilter, isEmptyFilter, listDiff, listMatch, manualPick, tickManual, nameTaken, listKey, nameList, listPlan, publicOver, canWrite, PUBLIC_MAX,
} from './social.js';
import { cloud } from './cloud.js';
import { $, layer, icon, ph, toast, ui, showOverlay, closeOverlay, remember, recall, confirmBox, promptBox } from './ui.js';
import { view } from './views.js';

const S = store.settings;
const META_TTL = 14 * 24 * 3600 * 1000;

// ── спільне ───────────────────────────────────────────────────────
export async function refreshMeta(id, { first = false, detect = false, loud = false } = {}) {
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
    if (loud) toast(t('toast.refreshed'));
  } catch (err) {
    if (loud) toast(t('toast.refresh.fail', { e: err.message }));
  }
}

// item — запис із каталогу чи пошуку: { id, type, kind, title, year, meta? }
export function addItem(item, patch = {}) {
  if (store.get(item.id)) return store.get(item.id);
  const e = store.save(item.id, {
    type: item.type, kind: item.kind || item.type, title: item.title, year: item.year,
    status: 'planned', season: 1, episode: 0, added: Date.now(), ...patch,
  });
  if (!e) return null;
  if (item.meta) store.setMeta(item.id, item.meta);
  // запис з індексу каталогу несе лише оцінку й жанри — решту дотягуємо
  if (!item.meta || item.thin) refreshMeta(item.id, { first: true, detect: !item.type });
  return e;
}

export function plus(id) {
  const e = store.get(id);
  if (!e) return;
  const patch = nextEpisode(e);
  if (!Object.keys(patch).length) return toast(t('toast.last.ep'));
  flushCard();
  const n = store.save(id, patch);
  if (ui.overlay?.type === 'card') drawCard();
  toast(patch.status === 'done' ? t('toast.finished', { title: n.title }) : `${n.title}: ${progressText(n)}`,
    { label: t('undo'), action: () => { store.restore(e); if (ui.overlay?.type === 'card') drawCard(); } });
}

function headHtml(x, m) {
  return `<header class="card-hero" data-img>
    <img class="card-bg" alt="" src="${backdrop(x.id)}">
    <button class="rb solid card-x" data-act="close" aria-label="${t('close')}">${icon('close')}</button>
    <div class="card-id">${ph(x.id, x.title, 'medium', 'lg')}
      <div class="card-ttl"><h2>${esc(x.title)}</h2>
        <p class="sub">${esc([kindLabel(x.kind), x.year, fmtRuntime(m.runtime)].filter(Boolean).join(' · '))}</p>
        <p class="card-links"><a class="badge imdb static" href="https://www.imdb.com/title/${x.id}/" target="_blank" rel="noopener noreferrer">IMDb ${fmtRating(m.imdb) || '—'} ${icon('external')}</a>
          ${m.trailer ? `<a class="badge static" href="https://www.youtube.com/watch?v=${esc(m.trailer)}" target="_blank" rel="noopener noreferrer">${icon('play')}${t('trailer')}</a>` : ''}</p>
      </div></div>
  </header>`;
}
const aboutHtml = m => `
  ${m.genres?.length ? `<p class="genres">${m.genres.map(g => `<span>${esc(genreName(g))}</span>`).join('')}</p>` : ''}
  ${m.plot ? `<p class="plot">${esc(m.plot)}</p>` : ''}
  ${m.cast?.length ? `<p class="cast"><span>${t('cast')}</span> ${esc(m.cast.join(', '))}</p>` : ''}`;

// ── картка власного запису ────────────────────────────────────────
let pending = {}, pendingTimer = null;
export function flushCard() {
  clearTimeout(pendingTimer);
  if (ui.overlay?.type === 'card' && Object.keys(pending).length) {
    const p = pending; pending = {};
    store.save(ui.overlay.id, p);
  }
  pending = {};
}

function progressHtml(e) {
  const m = e.meta || {}, seasons = Object.keys(m.seasons || {}).map(Number).sort((a, b) => a - b);
  const total = seasonTotal(e), s = e.season || 1, ep = e.episode || 0;
  const all = episodesTotal(e), pct = progressPct(e);
  return `<section><h3>${t('card.where')} <small>${all ? `${t('eps.of', { a: episodesWatched(e), b: all })} · ${pct}%` : ''}</small></h3>
    ${all ? `<i class="bar" style="--w:${pct}%"></i>` : ''}
    ${seasons.length > 1 && seasons.length <= 40 ? `<div class="pills">${seasons.map(n =>
      `<button class="${n === s ? 'on' : ''} ${n < s ? 'past' : ''}" data-act="season" data-v="${n}">${n}</button>`).join('')}<span>${t('season')}</span></div>` : ''}
    ${total && total <= 200 ? `<div class="eps">${Array.from({ length: total }, (_, i) =>
      `<button class="${i + 1 <= ep ? 'on' : ''}" data-act="episode" data-v="${i + 1}" aria-label="${t('episode.n', { n: i + 1 })}">${i + 1}</button>`).join('')}</div>` : ''}
    <div class="progress">
      <div class="stepper"><button data-act="step" data-v="season:-1" aria-label="${t('prev.season')}">−</button>
        <label><span>${t('season')}</span><input type="number" inputmode="numeric" min="1" data-num="season" value="${s}"></label>
        <button data-act="step" data-v="season:1" aria-label="${t('next.season')}">+</button></div>
      <div class="stepper"><button data-act="step" data-v="episode:-1" aria-label="${t('prev.ep')}">−</button>
        <label><span>${total ? t('episode.of', { n: total }) : t('episode')}</span><input type="number" inputmode="numeric" min="0" data-num="episode" value="${ep}"></label>
        <button data-act="step" data-v="episode:1" aria-label="${t('next.ep')}">+</button></div>
      <button class="btn primary" data-act="plus">${icon('check')}${t('ep.watched')}</button>
    </div>
    ${m.state ? `<p class="muted small">${/ended/i.test(m.state) ? t('show.ended') : t('show.ongoing')}${total ? '' : ' · ' + t('eps.unknown')}</p>` : ''}
  </section>`;
}

// Додаткові секції картки реєструє friends.js (panel.js не може імпортувати
// його у відповідь — цикл): функція отримує id запису й дає HTML або ''.
// Обробник лежить на спільному ui, а не в змінній модуля: порядок обчислення
// panel.js і friends.js у циклі імпортів не має значення (без TDZ).
export function setCardExtra(fn) { ui.cardExtra = fn; }

function cardHtml(e) {
  const m = e.meta || {}, url = safeUrl(e.url);
  return `${headHtml(e, m)}
  <div class="card-body">
    <section><div class="status-seg">${STATUS_IDS.map(v =>
      `<button class="st-${v} ${e.status === v ? 'on' : ''}" data-act="set-status" data-v="${v}" aria-pressed="${e.status === v}"><i class="dot st-${v}"></i>${statusLabel(v)}</button>`).join('')}</div></section>
    ${e.type === 'series' ? progressHtml(e) : ''}
    <section><h3>${t('card.score')} <small>${e.score ? (Number.isInteger(e.score) ? '' : fmtScore(e.score) + ' · ') + t('score.' + Math.floor(e.score)) : t('score.none')}</small></h3>
      <div class="scores">${Array.from({ length: 10 }, (_, i) =>
        `<button data-act="score" data-v="${i + 1}" class="${e.score >= i + 1 ? 'fill' : ''} ${Math.floor(e.score) === i + 1 ? 'on' : ''}" aria-pressed="${Math.floor(e.score) === i + 1}">${i + 1}</button>`).join('')}
        <button data-act="score-half" class="half ${e.score % 1 ? 'on' : ''}" aria-pressed="${!!(e.score % 1)}" aria-label="${t('score.half')}" title="${t('score.half')}" ${e.score >= 1 && e.score < 10 ? '' : 'disabled'}>+½</button></div></section>
    <section><h3>${t('card.link')}</h3>
      <div class="linkrow"><label class="field wide">${icon('link')}<input type="url" data-field="url" placeholder="${t('card.link.ph')}" value="${esc(e.url)}"></label>
        ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('play')}${t('watch')}</a>` : ''}</div></section>
    <section><h3>${t('card.rec')}</h3>
      <button class="toggle ${e.rec ? 'on' : ''}" data-act="rec" aria-pressed="${e.rec}">${icon(e.rec ? 'starFill' : 'star')}
        <span><b>${e.rec ? t('rec.on') : t('rec.off')}</b><small>${e.rec ? t('rec.on.sub') : t('rec.off.sub')}</small></span><i></i></button>
      ${e.rec || e.lists?.length ? `<input class="inp mt" type="text" data-field="recNote" maxlength="500" placeholder="${t('rec.note.ph')}" value="${esc(e.recNote)}">` : ''}
      <div class="lists"><span>${t('lists')}</span>${listNames(store.list()).map(l =>
        `<button class="chip ${(e.lists || []).includes(l) ? 'on' : ''}" data-act="list-toggle" data-v="${esc(l)}" aria-pressed="${(e.lists || []).includes(l)}">${icon('folder')}${esc(l)}</button>`).join('')}
        <button class="chip reset" data-act="list-new">${icon('plus')}${t('list.new')}</button></div>
      ${e.lists?.length ? `<p class="muted small mt">${t('lists.note')}</p>` : ''}
    </section>
    ${ui.cardExtra?.(e.id) || ''}
    <section><h3>${t('card.note')}</h3><textarea class="inp" data-field="note" rows="3" placeholder="${t('card.note.ph')}">${esc(e.note)}</textarea></section>
    <section><h3>${t('card.about')}</h3>${aboutHtml(m).trim() || `<p class="muted">${e.metaAt ? t('no.plot') : t('loading.plot')}</p>`}
      <div class="kind-row"><span>${t('type')}</span>${KIND_IDS.map(v => `<button class="chip ${e.kind === v ? 'on' : ''}" data-act="set-kind" data-v="${v}">${kindLabel(v)}</button>`).join('')}</div></section>
  </div>
  <footer class="card-foot">
    <button class="rb" data-act="del" title="${t('card.delete')}" aria-label="${t('card.delete')}">${icon('trash')}</button>
    <button class="rb" data-act="refresh" title="${t('card.refresh')}" aria-label="${t('card.refresh')}">${icon('refresh')}</button>
    <span class="grow"></span>
    <button class="btn primary" data-act="close">${t('done')}</button>
  </footer>`;
}

export function drawCard() {
  const o = ui.overlay;
  if (o?.type !== 'card') return;
  const e = store.get(o.id);
  if (!e) return closeOverlay();
  const scroll = $('.card-body', layer)?.scrollTop || 0;
  // Сітка серій має власну прокрутку. Після натискання лишаємо її там,
  // де людина натиснула; а при відкритті картки чи зміні сезону —
  // підводимо до серії, на якій вона зупинилась.
  const eps0 = $('.eps', layer), epsScroll = eps0?.scrollTop || 0, sameGrid = !!eps0 && o.season === e.season;
  $('.card', layer).innerHTML = cardHtml(e);
  $('.card-body', layer).scrollTop = scroll;
  const eps = $('.eps', layer);
  if (eps) {
    if (sameGrid) eps.scrollTop = epsScroll;
    else {
      const cur = eps.querySelector('button.on:last-of-type') || [...eps.querySelectorAll('button.on')].pop();
      if (cur) eps.scrollTop = Math.max(0, cur.offsetTop - eps.offsetTop - eps.clientHeight / 2);
    }
  }
  o.season = e.season;
}
export function openCard(id) {
  const e = store.get(id);
  if (!e) return;
  showOverlay({ type: 'card', id, onClose: flushCard }, `<aside class="card" role="dialog" aria-label="${t('card.aria')}"></aside>`);
  drawCard();
  if (!e.metaAt || Date.now() - e.metaAt > META_TTL) refreshMeta(id);
}
function cardSave(patch) {
  flushCard();
  store.save(ui.overlay.id, patch);
  drawCard();   // Safari не переводить фокус на кнопку при дотику — малюємо явно
}
layer.addEventListener('input', ev => {
  if (ui.overlay?.type !== 'card') return;
  const el = ev.target;
  if (el.dataset.field) pending[el.dataset.field] = el.value;
  else if (el.dataset.num) pending[el.dataset.num] = Math.max(el.dataset.num === 'season' ? 1 : 0, parseInt(el.value, 10) || 0);
  else return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushCard, 500);
});

export const cardActions = {
  'set-status': v => {
    const e = store.get(ui.overlay.id), patch = { status: v };
    if (v === 'done' && e.type === 'series') {
      const last = Math.max(0, ...Object.keys(e.meta?.seasons || {}).map(Number));
      if (last) { patch.season = last; patch.episode = e.meta.seasons[last]; }
    }
    cardSave(patch);
  },
  'set-kind': v => cardSave({ kind: v }),
  score: v => cardSave({ score: store.get(ui.overlay.id).score === +v ? 0 : +v }),
  'score-half': () => {
    const s = store.get(ui.overlay.id).score;
    if (s >= 1 && s < 10) cardSave({ score: s % 1 ? Math.floor(s) : s + 0.5 });
  },
  rec: () => cardSave({ rec: !store.get(ui.overlay.id).rec }),
  season: v => { const e = store.get(ui.overlay.id); if (+v !== e.season) cardSave({ season: +v, episode: 0 }); },
  episode: v => {
    const e = store.get(ui.overlay.id), n = +v === e.episode ? +v - 1 : +v;
    cardSave({ episode: n, ...(n > 0 && e.status === 'planned' ? { status: 'watching' } : {}) });
  },
  step: v => {
    const [k, d] = v.split(':'), e = store.get(ui.overlay.id);
    const patch = { [k]: Math.max(k === 'season' ? 1 : 0, (e[k] || 0) + +d) };
    if (k === 'season' && patch.season !== e.season) patch.episode = 0;
    cardSave(patch);
  },
  del: () => {
    const e = store.get(ui.overlay.id);
    if (!e) return;
    pending = {};
    closeOverlay();
    store.remove(e.id);
    toast(t('toast.removed', { title: e.title }), { label: t('restore'), action: () => store.restore(e) });
  },
  refresh: () => refreshMeta(ui.overlay.id, { loud: true }),
  'list-toggle': v => {
    const cur = store.get(ui.overlay.id).lists || [];
    cardSave({ lists: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
  },
  'list-new': async () => {
    const id = ui.overlay.id;
    const name = await promptBox({ title: t('list.new'), text: t('list.new.text'), placeholder: t('list.new.ph'), ok: t('list.create') });
    if (!name || ui.overlay?.id !== id) return;
    const cur = store.get(id).lists || [];
    if (cur.length >= 8) return toast(t('list.limit'));
    cardSave({ lists: [...new Set([...cur, name.slice(0, 40)])] });
  },
};

// ── перегляд тайтла, якого ще немає на полиці ─────────────────────
export async function openPreview(id) {
  const x = recall(id);
  if (!x) return;
  if (store.get(id)) return openCard(id);
  const ac = new AbortController();
  const draw = (m, loading) => {
    const r = x.rec, ns = Object.keys(m.seasons || {}).length;
    $('.card', layer).innerHTML = `${headHtml(x, m)}
      <div class="card-body">
        ${r?.s ? `<section class="author"><div class="rec-score"><b>${fmtScore(r.s)}</b><small>${t('author.score')}</small></div>${r.n ? `<blockquote>${esc(r.n)}</blockquote>` : ''}</section>`
          : r?.n ? `<section><blockquote>${esc(r.n)}</blockquote></section>` : ''}
        <section><h3>${t('card.about')}</h3>${aboutHtml(m).trim() || `<p class="muted">${loading ? t('loading.plot') : t('no.plot')}</p>`}
          ${ns ? `<p class="muted small">${ns} ${tn('season', ns)} · ${Object.values(m.seasons).reduce((a, b) => a + b, 0)} ${tn('episode', Object.values(m.seasons).reduce((a, b) => a + b, 0))}</p>` : ''}</section>
      </div>
      <footer class="card-foot fwrap"><span class="muted small">${t('add.as')}</span><span class="grow"></span>
        <button class="btn" data-act="add-as" data-v="watching">${t('st.watching')}</button>
        <button class="btn" data-act="add-as" data-v="done">${t('st.done')}</button>
        <button class="btn primary" data-act="add-as" data-v="planned">${icon('plus')}${t('st.planned')}</button></footer>`;
  };
  showOverlay({ type: 'preview', id, abort: ac }, `<aside class="card" role="dialog" aria-label="${t('card.about')}"></aside>`);
  draw(x.meta || {}, !x.meta || !!x.thin);
  if (!x.meta || x.thin) {
    try {
      const full = await catalog.meta(id, x.type || (x.kind === 'movie' ? 'movie' : undefined));
      remember({ ...x, type: full.type, kind: x.kind || full.kind, meta: full.meta, thin: false });
      if (ui.overlay?.abort === ac) draw(full.meta, false);
    } catch { if (ui.overlay?.abort === ac) draw({}, false); }
  }
}
export function addFromPreview(status) {
  const x = recall(ui.overlay.id);
  if (!x) return;
  const patch = { status };
  if (status === 'done' && x.meta?.seasons) {
    const last = Math.max(0, ...Object.keys(x.meta.seasons).map(Number));
    if (last) { patch.season = last; patch.episode = x.meta.seasons[last]; }
  }
  addItem(x, patch);
  // Не закриваємо, а одразу показуємо вже власну картку цього тайтла:
  // після «Переглянуто» людина зазвичай хоче ще й поставити оцінку.
  openCard(x.id);
  toast(t('toast.added.as', { title: x.title, status: statusLabel(status) }));
}

// ── пошук-палітра: полиця й каталог в одному полі ─────────────────
// Категорія пошуку: «усе» або лише аніме / серіали / фільми. Тримається до
// закриття вкладки, щоб не вибирати її щоразу.
let palKindSaved = 'all';
const palKinds = (cur = palKindSaved) => ['all', ...KIND_IDS].map(v =>
  `<button class="${cur === v ? 'on' : ''}" data-act="pal-kind" data-v="${v}" role="tab" aria-selected="${cur === v}">${t(v === 'all' ? 'all.kinds' : 'kinds.' + v)}</button>`).join('');
export function palKind(v) {
  const o = ui.overlay;
  if (o?.type !== 'palette') return;
  o.kind = palKindSaved = v;
  $('#pal-kinds').innerHTML = palKinds();
  const input = $('#pal-q');
  runSearch(input.value);
  input.focus();
}
export function openPalette() {
  showOverlay({ type: 'palette', results: [], url: '', abort: null, sel: 0, kind: palKindSaved }, `
    <div class="palette" role="dialog" aria-label="${t('search.btn')}">
      <div class="pal-head">${icon('search')}
        <input id="pal-q" type="search" placeholder="${t('pal.ph')}" autocomplete="off" aria-label="${t('search')}">
        <kbd>Esc</kbd></div>
      <div class="seg pal-kinds" id="pal-kinds" role="tablist" aria-label="${t('pal.kind')}">${palKinds()}</div>
      <div class="pal-note" id="pal-note"></div>
      <div class="pal-body" id="pal-body"></div>
    </div>`);
  const input = $('#pal-q');
  input.focus();
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(input.value), 200); });
  input.addEventListener('keydown', ev => {
    const o = ui.overlay, n = o.results.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!n) return;
      o.sel = (o.sel + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
      drawPalette();
      $('.res.sel', layer)?.scrollIntoView({ block: 'nearest' });
    }
    if (ev.key === 'Enter' && o.results[o.sel]) pickResult(o.sel);
  });
  runSearch('');
}
function palNote() {
  const o = ui.overlay;
  let host = '';
  try { host = o.url ? new URL(o.url).host : ''; } catch { /* нічого */ }
  $('#pal-note').innerHTML = host
    ? `<span class="badge static">${icon('link')}${esc(host)}</span> ${t('pal.url.keep')} <button class="linkbtn" data-act="drop-url">${t('pal.url.drop')}</button>` : '';
}
function drawPalette(msg = '') {
  const o = ui.overlay, body = $('#pal-body');
  if (!body) return;
  let prev = '';
  body.innerHTML = msg ? `<p class="muted pad">${esc(msg)}</p>` : o.results.map((r, i) => {
    const have = store.get(r.id);
    const head = r.group !== prev ? `<h4>${t(prev = r.group)}</h4>` : '';
    return `${head}<div class="res ${i === o.sel ? 'sel' : ''}" data-act="pick" data-v="${i}" role="option" aria-selected="${i === o.sel}">${ph(r.id, r.title, 'small')}
      <div class="row-main"><div class="row-title"><b>${esc(r.title)}</b></div>
        <div class="row-sub">${esc([r.year, kindLabel(r.kind || r.type), have ? progressText(have) || statusLabel(have.status) : ''].filter(Boolean).join(' · '))}</div></div>
      ${r.meta?.imdb ? `<span class="badge imdb static">IMDb ${fmtRating(r.meta.imdb)}</span>` : ''}
      ${have ? `<span class="badge static ok">${icon('check')}${t('on.shelf')}</span>` : `<span class="badge static add">${icon('plus')}${t('add.lc')}</span>`}</div>`;
  }).join('');
}
async function runSearch(raw) {
  const o = ui.overlay;
  if (o?.type !== 'palette') return;
  o.abort?.abort();
  const ac = o.abort = new AbortController();
  const p = parseInput(raw);
  if (p.url) { o.url = safeUrl(p.url); palNote(); }
  o.sel = 0;
  if (!p.id && p.query.length < 2) {
    if (p.url) { $('#pal-q').value = ''; o.results = []; return drawPalette(t('pal.url.noguess')); }
    const mine = filterSort(store.list(), { kind: o.kind }, 'updated', -1).slice(0, 4).map(e => ({ ...e, group: 'pal.recent' }));
    const h = view.home || {};
    const pool = { all: h.series, anime: h.anime, movie: h.movies, series: (h.series || []).filter(x => x.kind === 'series') }[o.kind] || [];
    const hot = pool.filter(x => !store.get(x.id)).slice(0, 6).map(x => ({ ...x, group: 'rail.popular' }));
    o.results = [...mine, ...hot];
    return drawPalette(o.results.length ? '' : p.url ? t('pal.url.noguess') : t('pal.hint'));
  }
  const body = $('#pal-body');
  body.classList.add('busy');
  try {
    const mine = p.id ? [] : filterSort(store.list(), { q: p.query, kind: o.kind }, 'updated', -1).slice(0, 5).map(e => ({ ...e, group: 'pal.mine' }));
    const ids = new Set(mine.map(e => e.id));
    // видачу показуємо частинами: спершу те, що вже відомо, далі уточнення
    const put = (found, last) => {
      if (ac.signal.aborted) return;
      const cur = o.results[o.sel]?.id;
      o.results = [...mine, ...found.filter(x => !ids.has(x.id)).map(x => ({ ...x, group: 'nav.discover' }))];
      o.sel = Math.max(0, o.results.findIndex(r => r.id === cur));
      if (o.results.length || last) drawPalette(o.results.length ? '' : t('pal.none'));
    };
    const found = p.id ? [await catalog.fetchMeta(p.id, undefined, ac.signal)] : await catalog.search(p.query, ac.signal, o.kind, put);
    if (ac.signal.aborted) return;
    if (p.url && !p.id) $('#pal-q').value = p.query;
    put(found, true);
  } catch (err) {
    if (err.name !== 'AbortError') drawPalette(t('pal.fail', { e: err.message }));
  } finally {
    if (!ac.signal.aborted) body.classList.remove('busy');
  }
}
export function pickResult(i) {
  const o = ui.overlay, r = o?.results?.[i];
  if (!r) return;
  const have = store.get(r.id), url = o.url;
  closeOverlay();
  if (have) {
    if (url && !have.url) store.save(r.id, { url });
  } else {
    addItem(r, url ? { url } : {});
    toast(t('toast.added', { title: r.title }));
  }
  openCard(r.id);
}
export const dropUrl = () => { ui.overlay.url = ''; palNote(); };

// ── поширення рекомендацій ────────────────────────────────────────
// list — назва добірки; порожньо — загальні рекомендації.
// Що потрапляє за посиланням: записи добірки або (list порожній) усе з позначкою «раджу».
export const sharePool = (all, l) => (l ? all.filter(e => (e.lists || []).includes(l)) : all.filter(e => e.rec));
const byScore = (a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title, getLang());

// Умови добірки словами: «Аніме, серіали · від 2024 · моя оцінка 8+».
export function filterText(f) {
  const years = f.from && f.to ? (f.from === f.to ? f.from : `${f.from}–${f.to}`)
    : f.from ? t('year.from.n', { n: f.from }) : f.to ? t('year.to.n', { n: f.to }) : '';
  return [
    f.kinds.map(k => t('kinds.' + k)).join(', '),
    f.status !== 'all' ? statusLabel(f.status) : '',
    f.genres.map(genreName).join(', '),
    years,
    f.mine ? t('mine.min', { n: f.mine }) : '',
    f.rec ? t('build.rec') : '',
  ].filter(Boolean).join(' · ');
}
// Запис умов є в кожної добірки (у зібраної вручну умови порожні), тож «добірка
// за умовами» — це запис із непорожніми умовами. Повертає його або null.
export const condDef = name => {
  const d = name ? listdefs.get(defId(name)) : null;
  return d && !isEmptyFilter(d.f) ? d : null;
};
const mayKey = () => canWrite(!!cloud.user, cloud.synced('listdefs'));
// Сталий ключ добірки для посилання: створюється один раз і не змінюється з назвою.
// Добірка, створена раніше чи міткою з картки, отримує його тут, коли знадобилось
// посилання. З входом — лише після стану з хмари: інакше два пристрої вигадали б
// різні ключі й одне з посилань зламалось би. Немає ключа — посилання за назвою.
export function ensureKey(name) {
  const def = listdefs.get(defId(name));
  if (def?.key) return def.key;
  if (!mayKey() || !listNames(store.list()).includes(name)) return '';
  return listdefs.save(defId(name), { name, key: listKey() })?.key || '';
}
// Посилання на список: живе (з входом) або знімок у самому посиланні.
export async function shareLink(list = '') {
  const items = sharePool(store.list(), list).sort(byScore).map(recItem);
  if (!items.length) return null;
  const base = location.origin + location.pathname;
  let link, live = false;
  if (cloud.user) {
    try {
      // ключ мусить бути в публічному документі раніше, ніж посилання піде до людей
      const key = list ? ensureKey(list) : '';
      await cloud.publishNow();
      link = `${base}#u=${cloud.user.uid}${list ? (key ? '&c=' + key : '&l=' + encodeURIComponent(list)) : ''}`; live = true;
    } catch { /* нижче — знімок */ }
  }
  link ??= `${base}#r=${await encodeRecs(S.name, items, list)}`;
  return { link, live, items };
}
export async function openShare(list = '') {
  const all = store.list(), names = listNames(all);
  const pool = l => sharePool(all, l);
  if (!list && !pool('').length && names.length) list = names[0];
  const sl = await shareLink(list);
  if (!sl) return toast(t('share.none'), { ms: 4200 });
  const { link, live, items } = sl, cond = condDef(list);
  const tab = (l, label, n) => `<button class="chip ${l === list ? 'on' : ''}" data-act="share-list" data-v="${esc(l)}">${l ? icon('folder') : icon('starFill')}${esc(label)}<small>${n}</small></button>`;
  showOverlay({ type: 'share', link, list }, `
    <div class="palette narrow" role="dialog" aria-label="${t('menu.share')}">
      <div class="pal-head"><h2>${list ? esc(list) : t('share.title')} <small>${items.length}</small></h2><button class="rb" data-act="close" aria-label="${t('close')}">${icon('close')}</button></div>
      <div class="share">
        ${names.length ? `<div class="share-tabs">${pool('').length ? tab('', t('share.title'), pool('').length) : ''}${names.map(l => tab(l, l, pool(l).length)).join('')}</div>` : ''}
        <div class="share-strip">${items.slice(0, 6).map(x => ph(x.id, x.t, 'small')).join('')}${items.length > 6 ? `<span class="morecount">+${items.length - 6}</span>` : ''}</div>
        <p><span class="badge static ${live ? 'ok' : ''}">${live ? t('share.live') : t('share.snap')}</span>
          ${live ? t(!list ? 'share.live.text' : cond ? 'share.live.cond' : 'share.live.manual') : t('share.snap.text') + (cloud.available ? ' ' + t('share.snap.signin') : '')}</p>
        <label class="field wide">${icon('link')}<input class="linkbox" readonly value="${esc(link)}" aria-label="${t('link')}"></label>
        <div class="hero-act">
          <button class="btn primary" data-act="copy">${icon('link')}${t('copy')}</button>
          ${navigator.share ? `<button class="btn" data-act="native-share">${icon('share')}${t('send')}</button>` : ''}
          ${list ? `<button class="btn" data-act="list-edit" data-v="${esc(list)}">${icon('filter')}${t('edit')}</button>` : ''}
          ${cond ? `<button class="btn" data-act="list-rebuild" data-v="${esc(list)}">${icon('refresh')}${t('rebuild.btn')}</button>` : ''}
          <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${icon('external')}${t('share.preview')}</a>
        </div>
        <p class="muted small">${t('share.privacy')}${S.name ? ' ' + t('share.signed', { name: esc(S.name) }) : ''}</p>
      </div>
    </div>`);
}

// ── нова добірка й редагування наявної ────────────────────────────
// Умови лежать у o.f (завжди крізь cleanListFilter). Позначене = (те, що підходить
// під умови ∪ o.plus) \ o.minus: plus — позначене рукою, minus — зняте рукою, тож
// зміна умов ручного вибору не стирає. Порожні умови — лише ручний вибір.
const buildHit = f => new Set(isEmptyFilter(f) ? [] : listMatch(store.list(), f).map(e => e.id));
const buildPicked = o => manualPick(buildHit(o.f), o.plus, o.minus);
// У переліку — те, що підходить під умови, і додане рукою; без умов — уся полиця.
function buildRows(o) {
  const all = filterSort(store.list(), {}, 'score', -1), hit = buildHit(o.f);
  return isEmptyFilter(o.f) ? all : all.filter(e => hit.has(e.id) || o.plus.has(e.id));
}

// edit — назва добірки, яку редагують; без неї — нова добірка.
export function openBuild(edit = '') {
  const all = store.list();
  if (typeof edit !== 'string' || !listNames(all).includes(edit)) edit = '';
  const def = edit ? listdefs.get(defId(edit)) : null;
  // back — редагування відкрили з діалогу «Поділитись»: після збереження повертаємось туди
  const o = { type: 'build', edit, back: ui.overlay?.type === 'share', f: cleanListFilter(def?.f), name: edit, plus: new Set(), minus: new Set(), pending: new Set() };
  if (edit) {
    // Галочки = теперішній склад: зайве щодо умов — «позначене рукою», чого бракує —
    // «зняте рукою». Те, що підійшло під умови вже після останнього формування
    // (pending), рукою ніхто не знімав: у збережені вилучення воно не піде.
    const has = new Set(sharePool(all, edit).map(e => e.id)), hit = buildHit(o.f), cut = new Set(def?.minus);
    for (const id of has) if (!hit.has(id)) o.plus.add(id);
    for (const id of hit) if (!has.has(id)) { o.minus.add(id); if (!cut.has(id)) o.pending.add(id); }
  }
  showOverlay(o, `<div class="palette build-pal" role="dialog" aria-label="${t(edit ? 'list.edit' : 'list.new')}"></div>`);
  drawBuild();
}
// Каркас малюємо один раз: поля року, назва й кнопка «Зберегти» лишаються тими
// самими елементами, тож фокус і набране не губляться (оновлює їх updateBuild).
function drawBuild() {
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  const f = o.f;
  // жанри з умов добірки показуємо завжди, навіть коли вони вже не серед найчастіших
  const genres = [...new Set([...insights(store.list()).genres.slice(0, 6).map(g => g[0]), ...f.genres])];
  const chip = (k, v, label) => `<button class="chip" data-act="build-set" data-v="${k}:${esc(v)}" aria-pressed="false">${label}</button>`;
  const year = (k, key) => `<input class="inp" type="text" inputmode="numeric" maxlength="4" data-build-year="${k}" placeholder="${t(key)}" aria-label="${t(key)}" value="${esc(f[k])}">`;
  // на низькому чи вузькому екрані умови згорнуті, щоб було видно сам перелік
  const small = matchMedia('(max-width:720px), (max-height:640px)').matches;
  $('.palette', layer).innerHTML = `
    <div class="pal-head"><h2>${t(o.edit ? 'list.edit' : 'list.new')}</h2><button class="rb" data-act="close" aria-label="${t('close')}">${icon('close')}</button></div>
    <div class="build">
      <div class="build-body">
        <details class="build-cond"${small ? '' : ' open'}>
          <summary><b>${t('build.cond')}</b><span class="muted small" id="build-cond"></span>${icon('chevD', 'caret')}</summary>
          <div class="build-f">
            <div><b>${t('type')}</b>${KIND_IDS.map(k => chip('kinds', k, t('kinds.' + k))).join('')}</div>
            <div><b>${t('build.status')}</b>${['all', ...STATUS_IDS].map(v => chip('status', v, v === 'all' ? t('all.statuses') : statusLabel(v))).join('')}</div>
            ${genres.length ? `<div><b>${t('genres')}</b>${genres.map(g => chip('genres', g, esc(genreName(g)))).join('')}</div>` : ''}
            <div><b>${t('year')}</b>${year('from', 'year.from')}${year('to', 'year.to')}<small class="muted">${t('build.years.hint')}</small></div>
            <div><b>${t('card.score')}</b>${[7, 8, 9].map(n => chip('mine', n, t('mine.min', { n }))).join('')}</div>
            <div><b>${t('card.rec')}</b>${chip('rec', '1', t('build.rec'))}</div>
          </div>
        </details>
        <div class="build-main"><p class="muted small" id="build-note"></p><div id="build-res"></div></div>
      </div>
      <div class="build-foot">
        <span class="muted small" id="build-count"></span>
        <p class="muted small" id="build-keep" hidden>${t('build.keep')}</p>
        <div class="build-save"><input class="inp" type="text" maxlength="40" data-build-name placeholder="${t('build.name.ph')}" aria-label="${t('build.name.ph')}" value="${esc(o.name)}">
          <span class="muted small" id="build-n"></span>
          <button class="btn primary" data-act="build-save">${t(o.edit ? 'save' : 'build.save')}</button></div>
        <p class="muted small">${t('lists.note')}</p>
      </div>
    </div>`;
  buildNameCount(o);
  updateBuild();
}
const buildNameCount = o => { $('#build-n', layer).textContent = `${o.name.length}/40`; };
// Лічильник і примітка: коли є і умови, і ручні зміни, кажемо, що «Сформувати знову» їх не чіпає.
function buildCount(o) {
  $('#build-count', layer).textContent = t('build.picked', { n: [...buildPicked(o)].filter(id => store.get(id)).length });
  $('#build-keep', layer).hidden = isEmptyFilter(o.f) || !(o.plus.size || o.minus.size > o.pending.size);
}
function updateBuild() {
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  const f = o.f, rows = buildRows(o), picked = buildPicked(o), hit = buildHit(f), empty = isEmptyFilter(f);
  const scroll = $('.build-body', layer).scrollTop;
  // чипи лише перемикають вигляд; рік чіпаємо, хіба що поле не в фокусі
  for (const b of layer.querySelectorAll('[data-act="build-set"]')) {
    const i = b.dataset.v.indexOf(':'), k = b.dataset.v.slice(0, i), x = b.dataset.v.slice(i + 1);
    const on = k === 'kinds' || k === 'genres' ? f[k].includes(x) : k === 'rec' ? !!f.rec : f[k] === x;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  }
  for (const inp of layer.querySelectorAll('[data-build-year]')) if (inp !== document.activeElement) inp.value = f[inp.dataset.buildYear];
  $('#build-cond', layer).textContent = empty ? t('build.cond.none') : filterText(f);
  $('#build-note', layer).textContent = empty ? t('build.manual') : '';
  $('#build-res', layer).innerHTML = rows.length ? `<div class="build-list">${rows.map(e => {
    const on = picked.has(e.id);
    // що піде до людей без оцінки — видно ще до збереження
    const tag = e.status === 'planned' ? 'build.b.planned' : e.score ? '' : 'build.b.noscore';
    const tags = [!empty && !hit.has(e.id) ? 'build.b.hand' : '', tag].filter(Boolean).map(k => ` <span class="badge static">${t(k)}</span>`).join('');
    return `<div class="res" role="checkbox" aria-checked="${on}" tabindex="0" data-act="build-tick" data-v="${esc(e.id)}">
      <span class="tick ${on ? 'on' : ''}">${on ? icon('check') : ''}</span>${ph(e.id, e.title, 'small')}
      <div class="row-main"><div class="row-title"><b>${esc(e.title)}</b></div>
        <div class="row-sub">${esc([e.year, kindLabel(e.kind)].filter(Boolean).join(' · '))}${tags}</div></div>
      ${e.score ? `<span class="badge static score">${fmtScore(e.score)}</span>` : ''}</div>`;
  }).join('')}</div>` : `<p class="muted pad">${t('build.none')}</p>`;
  buildCount(o);
  $('.build-body', layer).scrollTop = scroll;
}
// Нові умови: ручний вибір лишається, а «ще не сформоване» перестає бути знятим —
// умови застосовуються наново.
function buildApply(f) {
  const o = ui.overlay;
  o.f = cleanListFilter(f);
  for (const id of o.pending) o.minus.delete(id);
  o.pending.clear();
  updateBuild();
}
// Роки беремо з обох полів разом: навпаки вписані міняються місцями й у полях теж.
let yearTimer;
function buildYears() {
  clearTimeout(yearTimer);
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  const [a, b] = ['from', 'to'].map(k => $(`[data-build-year="${k}"]`, layer));
  const next = cleanListFilter({ ...o.f, from: a.value, to: b.value });
  if (a.value.length === 4 && b.value.length === 4 && a.value > b.value) { a.value = next.from; b.value = next.to; }
  if (next.from !== o.f.from || next.to !== o.f.to) buildApply(next);
}
layer.addEventListener('input', ev => {
  const o = ui.overlay, el = ev.target;
  if (o?.type !== 'build') return;
  if (el.matches('[data-build-name]')) { o.name = el.value; buildNameCount(o); }
  if (el.matches('[data-build-year]')) {
    // лише цифри; застосовуємо невдовзі після останньої, не чекаючи виходу з поля
    const v = el.value.replace(/\D/g, '');
    if (v !== el.value) el.value = v;
    clearTimeout(yearTimer);
    yearTimer = setTimeout(buildYears, 300);
  }
});
layer.addEventListener('change', ev => {
  if (ui.overlay?.type === 'build' && ev.target.matches('[data-build-year]')) buildYears();
});
// Enter у назві зберігає добірку.
layer.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ui.overlay?.type === 'build' && ev.target.matches('[data-build-name]')) { ev.preventDefault(); buildSave(); }
});
function buildSet(v) {
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  const i = v.indexOf(':'), k = v.slice(0, i), x = v.slice(i + 1), f = o.f;
  const flip = a => (a.includes(x) ? a.filter(y => y !== x) : [...a, x]);
  buildApply({
    ...f,
    ...(k === 'kinds' || k === 'genres' ? { [k]: flip(f[k]) }
      : k === 'rec' ? { rec: !f.rec }
        : { [k]: f[k] === x ? (k === 'status' ? 'all' : '') : x }),
  });
}
function buildTick(id) {
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  const on = !buildPicked(o).has(id);
  tickManual(o, id, buildHit(o.f).has(id), on);
  o.pending.delete(id);
  // міняємо лише цей рядок і лічильник — решта діалогу не перемальовується
  const row = [...layer.querySelectorAll('[data-act="build-tick"]')].find(r => r.dataset.v === id);
  if (row) {
    row.setAttribute('aria-checked', String(on));
    const tk = row.querySelector('.tick');
    tk.classList.toggle('on', on); tk.innerHTML = on ? icon('check') : '';
  }
  buildCount(o);
}
// Нова добірка лише додає мітку; редагування замінює склад рівно позначеним і
// переносить нову назву на всі записи та на умови (ключ посилання лишається тим самим).
function buildSave() {
  const o = ui.overlay;
  if (o?.type !== 'build') return;
  buildYears();   // рік могли щойно вписати — застосуємо, не чекаючи таймера
  const all = store.list(), name = o.name.trim().slice(0, 40);
  const picked = [...buildPicked(o)].filter(id => store.get(id));
  if (!name) return toast(t('build.err.name'));
  // та сама назва злила б дві добірки в одну — відмовляємо, нічого не пишучи
  const dup = nameTaken(listNames(all), name, o.edit);
  if (dup) return toast(t('build.err.dup', { name: dup }), { ms: 5000 });
  if (!picked.length) return toast(t('build.err.pick'));
  const plan = listPlan(all, o.edit, name, picked);
  const over = publicOver(all, plan.added);
  if (over > 0) return toast(t('build.over', { n: over, max: PUBLIC_MAX }), { ms: 4500 });
  // старі умови читаємо до запису: коли зі старої назви зникне остання мітка, їх прибере слухач нижче
  const old = o.edit ? listdefs.get(defId(o.edit)) : null;
  plan.set.forEach(([id, lists]) => store.save(id, { lists }));
  if (plan.skipped) toast(t('build.skipped', { n: plan.skipped }), { ms: 4000 });
  if (!listNames(store.list()).includes(name)) return;   // усе позначене вже у 8 добірках — добірки не вийшло
  if (o.edit && o.edit !== name && listdefs.get(defId(o.edit))) listdefs.remove(defId(o.edit));
  const hit = buildHit(o.f), empty = isEmptyFilter(o.f), pk = new Set(picked);
  listdefs.save(defId(name), {
    name, f: o.f, key: old?.key || listdefs.get(defId(name))?.key || (mayKey() ? listKey() : undefined),
    plus: empty ? [] : picked.filter(id => !hit.has(id)),
    minus: empty ? [] : [...hit].filter(id => !pk.has(id) && !o.pending.has(id)),
  });
  if (!o.edit || o.back) return openShare(name);
  closeOverlay();
  if (!plan.skipped) toast(t('build.saved', { name }));
}

// «Сформувати знову»: порівняти полицю з умовами добірки й оновити мітки.
// Додане рукою лишається, зняте рукою не повертається (listDiff).
async function rebuild(name) {
  const def = condDef(name);
  if (!def) return;
  const d = listDiff(store.list(), name, def.f, def);
  if (!d.add.length && !d.drop.length) return toast(t('rebuild.none'));
  const over = publicOver(store.list(), d.add.map(e => e.id));
  if (over > 0) return toast(t('build.over', { n: over, max: PUBLIC_MAX }), { ms: 4500 });
  const part = (key, list) => (list.length ? t(key, { n: list.length, names: nameList(list.map(e => e.title)) }) : '');
  const ok = await confirmBox({
    title: t('rebuild.title', { name }),
    text: [part('rebuild.add', d.add), part('rebuild.drop', d.drop), d.skip.length ? t('rebuild.skip', { n: d.skip.length }) : ''].filter(Boolean).join(' '),
    ok: t('rebuild.btn'),
  });
  if (!ok) return;
  for (const e of d.add) { const c = store.get(e.id); if (c) store.save(c.id, { lists: [...new Set([...(c.lists || []), name])] }); }
  for (const e of d.drop) { const c = store.get(e.id); if (c) store.save(c.id, { lists: (c.lists || []).filter(l => l !== name) }); }
  // Лишаємось там, де були: відкритий діалог «Поділитись» лише оновлюємо
  // (якщо мітку зняли з усіх, добірки вже нема — діалог закриваємо).
  if (ui.overlay?.type === 'share') { if (listNames(store.list()).includes(name)) await openShare(name); else closeOverlay(); }
  toast(t('rebuild.done', { a: d.add.length, d: d.drop.length }));
}

export const buildActions = {
  'list-build': () => openBuild(), 'list-edit': v => openBuild(v), 'build-set': buildSet, 'build-tick': buildTick, 'build-save': buildSave, 'list-rebuild': rebuild,
};

// Остання мітка добірки знята (в картці чи тут) — її умови й ключ більше нічого не значать.
// Лише зміни людини на цьому пристрої й не під час першого злиття з хмарою:
// інакше умови, що приїхали раніше за записи з міткою, стерлись би, а мітка
// видалення поїхала б у хмару.
store.onLocal((entry, what) => {
  if (what !== 'user' || cloud.state === 'connecting') return;
  const names = new Set(listNames(store.list()));
  for (const d of listdefs.list()) if (!names.has(d.name)) listdefs.remove(d.id);
});

// ── показ на прикладі ─────────────────────────────────────────────
const DEMO = [
  ['tt22248376', 'series', 'watching', 1, 12, 10, true, 'demo.n1'],
  ['tt0903747', 'series', 'done', 5, 16, 10, true, 'demo.n2'],
  ['tt2560140', 'series', 'done', 4, 30, 9, true, 'demo.n3'],
  ['tt11126994', 'series', 'watching', 2, 4, 9, false, ''],
  ['tt9335498', 'series', 'paused', 1, 19, 8, false, ''],
  ['tt5180504', 'series', 'dropped', 2, 3, 6, false, ''],
  ['tt13443470', 'series', 'planned', 1, 0, 0, false, ''],
  ['tt14452776', 'series', 'watching', 3, 2, 9, true, 'demo.n4'],
  ['tt0245429', 'movie', 'done', 1, 0, 10, true, 'demo.n5'],
  ['tt0816692', 'movie', 'done', 1, 0, 9, false, ''],
  ['tt15239678', 'movie', 'done', 1, 0, 9, false, ''],
  ['tt6751668', 'movie', 'done', 1, 0, 8, false, ''],
  ['tt5311514', 'movie', 'planned', 1, 0, 0, false, ''],
  ['tt1160419', 'movie', 'planned', 1, 0, 0, false, ''],
];
export async function loadDemo() {
  const ok = await confirmBox({
    title: t('demo.title'),
    text: t('demo.text', { n: DEMO.length }) + (cloud.user ? ' ' + t('demo.sync') : '') + ' ' + t('demo.removable'),
    ok: t('demo.ok'),
  });
  if (!ok) return;
  toast(t('demo.loading'));
  const now = Date.now();
  await Promise.all(DEMO.map(async ([id, type, status, season, episode, score, rec, note], i) => {
    if (store.get(id)) return;
    try {
      const x = await catalog.fetchMeta(id, type);
      addItem(x, { status, season, episode, score, rec, recNote: note ? t(note) : '', added: now - i * 864e5 });
    } catch { /* один тайтл не завантажився — не страшно */ }
  }));
  toast(t('demo.done'));
}
