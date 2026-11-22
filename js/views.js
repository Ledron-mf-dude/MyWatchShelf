// Екрани: головна, бібліотека, каталог, статистика, чужі рекомендації.
import {
  STATUS_IDS, KIND_IDS, CATALOG_GENRES, statusLabel, kindLabel, esc, safeUrl, backdrop, fmtRating, fmtScore, fmtRuntime,
  genreName, yearRange, progressText, progressPct, filterSort, insights, episodesWatched, episodesTotal, listNames,
} from './logic.js';
import { ensureSchedules, agendaStrip, taste, tasteBadge } from './extras.js';
import { t, tn } from './i18n.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { $, app, icon, ph, remember, dropdown, selects } from './ui.js';

const S = store.settings;
export const view = {
  route: 'home',
  f: { q: '', kind: 'all', status: 'all', genres: [], list: '', from: '', to: '', min: '' },
  disc: { type: 'series', genre: '', from: '', to: '', min: '', sort: 'pop', items: [], feeds: [], loading: false, more: true, error: '', key: '' },
  recs: null,
  home: null,   // добірки каталогу для головної, щоб не тягнути їх щоразу
};
const SORTS = ['updated', 'added', 'score', 'imdb', 'progress', 'title', 'year'];
const canPlus = e => e.type === 'series' && e.status !== 'done' && e.status !== 'dropped';
const count = (key, n) => `${n} ${tn(key, n)}`;

// ── картки ────────────────────────────────────────────────────────
export function entryCard(e, { rank = 0 } = {}) {
  const pct = progressPct(e), url = safeUrl(e.url), m = e.meta || {};
  return `<article class="pc" data-id="${e.id}" data-act="open" tabindex="0" role="button" aria-label="${esc(e.title)}">
    ${rank ? `<span class="rank" aria-hidden="true">${rank}</span>` : ''}
    <div class="pc-body">
      <div class="pc-img">${ph(e.id, e.title, 'medium', 'fill')}
        <span class="pc-top">${e.score ? `<b class="badge score">${icon('starFill')}${fmtScore(e.score)}</b>` : ''}${e.rec ? `<b class="badge rec">${t('badge.rec')}</b>` : ''}</span>
        ${m.imdb ? `<span class="badge imdb">IMDb ${fmtRating(m.imdb)}</span>` : ''}
        <div class="pc-acts">
          ${url ? `<a class="rb solid" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${t('watch')}" aria-label="${t('watch')}">${icon('play')}</a>` : ''}
          ${canPlus(e) ? `<button class="rb solid" data-act="plus" title="${t('next.ep')}">+1</button>` : ''}
        </div>
        ${e.type === 'series' && pct > 0 && pct < 100 ? `<i class="pc-bar" style="--w:${pct}%"></i>` : ''}
      </div>
      <h3>${esc(e.title)}</h3>
      <p><i class="dot st-${e.status}"></i>${esc(progressText(e) || statusLabel(e.status))}</p>
    </div>
  </article>`;
}
export function catalogCard(x, { rank = 0 } = {}) {
  remember(x);
  const have = store.get(x.id), m = x.meta || {};
  return `<article class="pc" data-id="${x.id}" data-act="${have ? 'open' : 'preview'}" tabindex="0" role="button" aria-label="${esc(x.title)}">
    ${rank ? `<span class="rank" aria-hidden="true">${rank}</span>` : ''}
    <div class="pc-body">
      <div class="pc-img">${ph(x.id, x.title, 'medium', 'fill')}
        ${m.imdb ? `<span class="badge imdb">IMDb ${fmtRating(m.imdb)}</span>` : ''}
        <div class="pc-acts show">${have
          ? `<span class="rb solid on" title="${t('on.shelf.already')}">${icon('check')}</span>`
          : `<button class="rb solid" data-act="quick-add" title="${t('to.shelf')}" aria-label="${t('to.shelf')}">${icon('plus')}</button>`}</div>
      </div>
      <h3>${esc(x.title)}</h3>
      <p>${esc([x.year, kindLabel(x.kind)].filter(Boolean).join(' · '))}</p>
    </div>
  </article>`;
}
const skeletons = n => Array.from({ length: n }, () => '<div class="pc skel"><div class="pc-body"><div class="pc-img"></div><h3>&nbsp;</h3><p>&nbsp;</p></div></div>').join('');

function rail(id, cards, { ranked = false, link = '' } = {}) {
  return `<section class="rail ${ranked ? 'ranked' : ''}" data-rail="${id}">
    <header><h2>${t('rail.' + id)}</h2>${link}<span class="grow"></span>
      <button class="rb ghost" data-act="rail" data-v="-1" aria-label="${t('back')}">${icon('chevL')}</button>
      <button class="rb ghost" data-act="rail" data-v="1" aria-label="${t('forward')}">${icon('chevR')}</button></header>
    <div class="rail-track">${cards}</div>
  </section>`;
}

function hintHtml() {
  const show = cloud.available && !cloud.user && cloud.state === 'off' && S.hint && store.list().length > 0;
  return show ? `<div class="hint">${icon('sparkle')}<div><b>${t('hint.title')}</b>
    <p>${t('hint.text')}</p></div>
    <div class="hint-act"><button class="btn primary" data-act="signin">${t('signin')}</button>
    <button class="btn ghost" data-act="hide-hint">${t('not.now')}</button></div></div>` : '';
}

// ── головна ───────────────────────────────────────────────────────
function heroHtml(e) {
  if (!e) {
    return `<section class="hero empty"><div class="hero-in">
      <span class="kicker">${t('brand.long')}</span>
      <h1>${t('hero.empty.title')}</h1>
      <p class="hero-plot">${t('hero.empty.text')}</p>
      <div class="hero-act"><button class="btn primary lg" data-act="add">${icon('plus')}${t('add.first')}</button>
        <button class="btn lg" data-act="demo">${icon('sparkle')}${t('demo')}</button></div>
    </div></section>`;
  }
  const m = e.meta || {}, url = safeUrl(e.url), pct = progressPct(e);
  const total = episodesTotal(e);
  return `<section class="hero" data-img data-id="${e.id}">
    <img class="hero-bg" alt="" src="${backdrop(e.id)}">
    <div class="hero-in">
      <span class="kicker">${e.status === 'watching' || e.status === 'paused' ? t('rail.continue') : t('hero.from.shelf')}</span>
      <h1>${esc(e.title)}</h1>
      <p class="hero-meta">${[kindLabel(e.kind), e.year, fmtRuntime(m.runtime)].filter(Boolean).map(esc).join('<i>·</i>')}
        ${m.imdb ? `<b class="badge imdb static">IMDb ${fmtRating(m.imdb)}</b>` : ''}${e.score ? `<b class="badge score static">${icon('starFill')}${fmtScore(e.score)}</b>` : ''}</p>
      ${m.plot ? `<p class="hero-plot">${esc(m.plot)}</p>` : ''}
      ${e.type === 'series' ? `<div class="hero-prog"><i class="bar" style="--w:${pct}%"></i>
        <span>${esc(progressText(e) || t('not.started'))}${total ? ` · ${t('eps.of', { a: episodesWatched(e), b: total })}` : ''}</span></div>` : ''}
      <div class="hero-act">
        ${url ? `<a class="btn primary lg" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('play')}${t('watch')}</a>` : ''}
        ${canPlus(e) ? `<button class="btn lg ${url ? '' : 'primary'}" data-act="plus">${icon('check')}${t('ep.watched')}</button>` : ''}
        <button class="btn lg ghost" data-act="open">${t('details')}</button>
      </div>
    </div>
  </section>`;
}

export function renderHome() {
  const list = store.list();
  const byUpd = (a, b) => (b.updated || 0) - (a.updated || 0);
  const watching = list.filter(e => e.status === 'watching' || e.status === 'paused').sort(byUpd);
  const top = list.filter(e => e.score >= 7).sort((a, b) => b.score - a.score || byUpd(a, b)).slice(0, 10);
  const planned = list.filter(e => e.status === 'planned').sort(byUpd);
  const feature = watching[0] || top[0] || [...list].sort(byUpd)[0];
  const more = r => `<a class="more" href="#/${r}">${t('all')} ${icon('chevR')}</a>`;
  ensureSchedules(() => { const b = $('#home-agenda'); if (b) b.innerHTML = agendaStrip(); });
  const pickBtn = `<button class="more" data-act="tonight">${icon('dice')}${t('pick.title')}</button>`;
  app.innerHTML = heroHtml(feature) + hintHtml() + `<div id="home-agenda">${agendaStrip()}</div>`
    + (watching.length > 1 ? rail('continue', watching.map(e => entryCard(e)).join(''), { link: more('library') }) : '')
    + (top.length ? rail('top', top.map((e, i) => entryCard(e, { rank: i + 1 })).join(''), { ranked: true }) : '')
    + (planned.length ? rail('planned', planned.slice(0, 20).map(e => entryCard(e)).join(''), { link: more('library') + pickBtn }) : '')
    + '<div id="home-catalog"></div>';
  drawHomeCatalog();
}
function drawHomeCatalog() {
  const box = $('#home-catalog');
  if (!box) return;
  // посилання веде одразу на ту вкладку каталогу, з якої зібрано ряд
  const more = type => `<a class="more" href="#/discover/${type}">${t('nav.discover')} ${icon('chevR')}</a>`;
  if (!view.home) {
    box.innerHTML = rail('popular', skeletons(8), { ranked: true });
    if (view.home === null) {
      view.home = undefined;   // «уже вантажимо»
      Promise.all([catalog.catalog({ type: 'series' }), catalog.catalog({ type: 'series', genre: 'Animation' }), catalog.catalog({ type: 'movie' })])
        .then(([s, a, m]) => { view.home = { series: s.items, anime: a.items.filter(x => x.kind === 'anime'), movies: m.items }; })
        .catch(() => { view.home = { error: true }; })
        .finally(() => { if (view.route === 'home') drawHomeCatalog(); });
    }
    return;
  }
  if (view.home.error) { box.innerHTML = `<p class="muted pad">${t('catalog.down')}</p>`; return; }
  const h = view.home;
  box.innerHTML = rail('popular', h.series.slice(0, 10).map((x, i) => catalogCard(x, { rank: i + 1 })).join(''), { ranked: true, link: more('series') })
    + (h.anime.length ? rail('anime', h.anime.slice(0, 20).map(x => catalogCard(x)).join(''), { link: more('anime') }) : '')
    + rail('movies', h.movies.slice(0, 20).map(x => catalogCard(x)).join(''), { link: more('movie') });
}

// ── бібліотека ────────────────────────────────────────────────────
function rowHtml(e) {
  const m = e.meta || {}, url = safeUrl(e.url), pct = progressPct(e);
  const line = [statusLabel(e.status), progressText(e), ...(m.genres || []).slice(0, 3).map(genreName), fmtRuntime(m.runtime)].filter(Boolean).join(' · ');
  return `<li class="row" data-id="${e.id}" data-act="open" tabindex="0">
    ${ph(e.id, e.title, 'small')}
    <div class="row-main">
      <div class="row-title"><i class="dot st-${e.status}"></i><b>${esc(e.title)}</b>${e.rec ? `<span class="badge rec static">${t('badge.rec')}</span>` : ''}</div>
      <div class="row-sub">${esc([kindLabel(e.kind), e.year].filter(Boolean).join(' · '))}</div>
      <div class="row-meta">${esc(line)}</div>
      ${e.type === 'series' && pct > 0 ? `<i class="bar thin" style="--w:${pct}%"></i>` : ''}
    </div>
    <div class="row-act">
      ${url ? `<a class="rb" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${t('watch')}" aria-label="${t('watch')}">${icon('play')}</a>` : ''}
      ${canPlus(e) ? `<button class="rb" data-act="plus" title="${t('next.ep')}">+1</button>` : ''}
    </div>
    <div class="score ${e.score ? '' : 'none'}"><b>${fmtScore(e.score) || '—'}</b><small>IMDb ${fmtRating(m.imdb) || '—'}</small></div>
  </li>`;
}

const RATING_MINS = [9, 8.5, 8, 7.5, 7, 6];
export function renderLibrary() {
  const f = view.f, now = new Date().getFullYear();
  // роки — від найстарішого запису в списку до поточного
  const first = Math.min(now, ...store.list().map(e => parseInt(e.year, 10)).filter(y => y > 1900), +f.from || now, +f.to || now);
  const years = Array.from({ length: now - first + 1 }, (_, i) => now - i);
  app.innerHTML = `
  <header class="page-head"><h1>${t('nav.library')}</h1><span class="count" id="lib-count"></span></header>
  <div class="filters wide">
    <label class="field search">${icon('search')}<input id="lib-q" type="search" placeholder="${t('lib.search')}" autocomplete="off" aria-label="${t('lib.search.aria')}"></label>
    <div class="seg" id="lib-kind" role="tablist"></div>
    <span class="grow"></span>
    <button class="btn" data-act="tonight">${icon('dice')}${t('pick.short')}</button>
    <div class="dd"><button class="btn" data-act="genres-toggle" aria-haspopup="true">${icon('filter')}${t('genres')}<b id="lib-gcount"></b></button>
      <div class="pop" id="lib-genres" hidden></div></div>
    ${dropdown('lib-from', f.from, [['', t('year.from')], ...years.map(y => [y, t('year.from.n', { n: y })])], 'clock', t('year.from'))}
    ${dropdown('lib-to', f.to, [['', t('year.to')], ...years.map(y => [y, t('year.to.n', { n: y })])], 'clock', t('year.to'))}
    ${dropdown('lib-min', f.min, [['', t('any.rating')], ...RATING_MINS.map(n => [n, t('rating.min', { n: fmtRating(n) })])], 'starFill', t('rating'))}
    ${dropdown('lib-sort', S.sort, SORTS.map(v => [v, t('sort.' + v)]), 'sortDown', t('sorting'))}
    <button class="rb" data-act="dir" id="lib-dir" title="${t('sort.dir')}"></button>
    <button class="rb" data-act="view" id="lib-view" title="${t('view.toggle')}"></button>
  </div>
  <div class="chips" id="lib-status"></div>
  <div id="lib-list"></div>`;
  $('#lib-q').value = view.f.q;
  $('#lib-q').addEventListener('input', e => { view.f.q = e.target.value; updateLibrary(); });
  selects['lib-sort'] = v => { store.setSetting('sort', v); renderLibrary(); };
  for (const k of ['from', 'to', 'min']) selects['lib-' + k] = v => { f[k] = v; renderLibrary(); };
  updateLibrary();
}
export function updateLibrary() {
  if (!$('#lib-list')) return;
  const all = store.list(), f = view.f;
  const n = fn => all.filter(fn).length;
  const seg = (v, l, c) => `<button class="${f.kind === v ? 'on' : ''}" data-act="kind" data-v="${v}" role="tab" aria-selected="${f.kind === v}">${l}<small>${c}</small></button>`;
  $('#lib-kind').innerHTML = seg('all', t('all.kinds'), all.length) + KIND_IDS.map(k => seg(k, t('kinds.' + k), n(e => e.kind === k))).join('');
  const chip = (v, l, c, cls = '') => `<button class="chip ${cls} ${f.status === v ? 'on' : ''}" data-act="status" data-v="${v}" aria-pressed="${f.status === v}">${l}<small>${c}</small></button>`;
  $('#lib-status').innerHTML = chip('all', t('all.statuses'), all.length)
    + STATUS_IDS.map(v => chip(v, `<i class="dot st-${v}"></i>${statusLabel(v)}`, n(e => e.status === v))).join('')
    + chip('rec', `${icon('starFill')}${t('badge.rec')}`, n(e => e.rec), 'rec')
    + listNames(all).map(l => `<button class="chip ${f.list === l ? 'on' : ''}" data-act="list-filter" data-v="${esc(l)}" aria-pressed="${f.list === l}">${icon('folder')}${esc(l)}<small>${n(e => (e.lists || []).includes(l))}</small></button>`).join('')
    + (f.q || f.kind !== 'all' || f.status !== 'all' || f.genres.length || f.list || f.from || f.to || f.min ? `<button class="chip reset" data-act="reset-filters">${icon('close')}${t('reset.filters')}</button>` : '');
  const genres = insights(all).genres;
  $('#lib-gcount').textContent = f.genres.length || '';
  $('#lib-genres').innerHTML = genres.length
    ? genres.map(([g, c]) => `<button class="chip ${f.genres.includes(g) ? 'on' : ''}" data-act="genre" data-v="${esc(g)}">${esc(genreName(g))}<small>${c}</small></button>`).join('')
    : `<p class="muted">${t('genres.empty')}</p>`;
  $('#lib-dir').innerHTML = icon(S.dir < 0 ? 'sortDown' : 'sortUp');
  $('#lib-view').innerHTML = icon(S.view === 'grid' ? 'list' : 'grid');
  const list = filterSort(all, f, S.sort, S.dir);
  $('#lib-count').textContent = list.length === all.length ? count('entry', all.length) : t('n.of.m', { a: list.length, b: all.length });
  const box = $('#lib-list');
  if (!all.length) {
    box.innerHTML = `<div class="empty">${icon('library')}<b>${t('lib.empty.title')}</b>
      <p>${t('lib.empty.text')}</p>
      <div class="hero-act"><button class="btn primary" data-act="add">${icon('plus')}${t('add.entry')}</button><a class="btn" href="#/discover">${icon('compass')}${t('open.catalog')}</a></div></div>`;
  } else if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('search')}<b>${t('nothing.found')}</b><p>${t('nothing.found.text')}</p>
      <button class="btn" data-act="reset-filters">${t('reset.filters')}</button></div>`;
  } else {
    box.innerHTML = S.view === 'grid'
      ? `<div class="grid">${list.map(e => entryCard(e)).join('')}</div>`
      : `<ul class="list">${list.map(rowHtml).join('')}</ul>`;
  }
}

// ── каталог ───────────────────────────────────────────────────────
const discKey = d => [d.type, d.genre, d.from, d.to, d.min, d.sort].join('|');
// Один вибраний рік — це той самий рік; два — діапазон у будь-якому порядку.
const discYears = d => yearRange(d.from, d.to);
let discWatch = null;
export function renderDiscover() {
  const d = view.disc;
  const years = Array.from({ length: 60 }, (_, i) => new Date().getFullYear() - i);
  const active = d.genre || d.from || d.to || d.min || d.sort !== 'pop';
  app.innerHTML = `
  <header class="page-head"><h1>${t('nav.discover')}</h1><span class="count">${t('disc.sub')}</span></header>
  <div class="filters wide">
    <div class="seg" id="disc-type" role="tablist">${['series', 'anime', 'movie'].map(v =>
      `<button class="${d.type === v ? 'on' : ''}" data-act="disc-type" data-v="${v}" role="tab" aria-selected="${d.type === v}">${t('kinds.' + v)}</button>`).join('')}</div>
    <span class="grow"></span>
    ${dropdown('disc-genre', d.genre, [['', t('all.genres')], ...CATALOG_GENRES.map(g => [g, genreName(g)])], 'filter', t('genre'))}
    ${dropdown('disc-from', d.from, [['', t('year.from')], ...years.map(y => [y, t('year.from.n', { n: y })])], 'clock', t('year.from'))}
    ${dropdown('disc-to', d.to, [['', t('year.to')], ...years.map(y => [y, t('year.to.n', { n: y })])], 'clock', t('year.to'))}
    ${dropdown('disc-min', d.min, [['', t('any.rating')], ...RATING_MINS.map(n => [n, t('rating.min', { n: fmtRating(n) })])], 'starFill', t('rating'))}
    ${dropdown('disc-sort', d.sort, ['pop', 'rating', 'year'].map(v => [v, t('dsort.' + v)]), 'sortDown', t('sorting'))}
    ${active ? `<button class="chip reset" data-act="disc-reset">${icon('close')}${t('reset.filters')}</button>` : ''}
  </div>
  <div id="disc-list" class="grid"></div><div id="disc-more" class="center"></div>`;
  for (const k of ['genre', 'from', 'to', 'min', 'sort']) selects['disc-' + k] = v => { d[k] = v; renderDiscover(); };
  // дозавантаження під час прокрутки: кнопка «Показати ще» лишається запасним шляхом
  discWatch?.disconnect();
  if (typeof IntersectionObserver !== 'undefined') {
    discWatch = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) discAuto(); }, { rootMargin: '800px' });
    discWatch.observe($('#disc-more'));
  }
  if (d.key === discKey(d) && d.items.length) drawDiscover(); else loadDiscover(true);
}
export const resetDiscover = () => { Object.assign(view.disc, { genre: '', from: '', to: '', min: '', sort: 'pop' }); renderDiscover(); };
function discAuto() {
  const d = view.disc, el = $('#disc-more');
  if (!el || view.route !== 'discover' || d.loading || d.error || !d.more) return;
  if (el.getBoundingClientRect().top < innerHeight + 800) loadDiscover(false);
}
// Каталог віддає готові стрічки: «популярне» й «за оцінкою» (можна звузити
// жанром) та «за роком» — окрема на кожен рік. Аніме, діапазон років і
// поріг оцінки він не вміє, тож беремо потрібні стрічки й відсіюємо самі.
// Аніме серед серіалів року — приблизно кожен десятий запис, тому тягнемо
// сторінки кількома колами, доки не набереться екран або стрічки скінчаться.
function discFeeds(d) {
  const anime = d.type === 'anime', yr = discYears(d);
  const types = d.type === 'movie' ? ['movie'] : anime ? ['series', 'movie'] : ['series'];
  const feeds = [];
  for (const type of types) {
    if (yr) for (let y = yr[1]; y >= yr[0]; y--) feeds.push({ type, list: 'year', genre: String(y), skip: 0, done: false });
    else feeds.push({ type, list: d.sort === 'rating' ? 'imdbRating' : 'top', genre: anime ? 'Animation' : d.genre, skip: 0, done: false });
  }
  return feeds;
}
export async function loadDiscover(reset) {
  const d = view.disc;
  if (d.loading && !reset) return;
  const key = discKey(d);
  if (reset || d.key !== key) { d.items = []; d.feeds = discFeeds(d); d.more = true; }
  d.key = key; d.error = false;
  d.loading = true; drawDiscover();
  const anime = d.type === 'anime', yr = discYears(d), min = +d.min || 0;
  const fits = x => (!anime || x.kind === 'anime')
    && (!yr || (parseInt(x.year, 10) >= yr[0] && parseInt(x.year, 10) <= yr[1]))   // добірка «за роком» у каталозі неточна
    && (!(yr || anime) || !d.genre || x.meta.genres.includes(d.genre))
    && (!min || (x.meta.imdb || 0) >= min);
  const order = { rating: (a, b) => (b.meta.imdb || 0) - (a.meta.imdb || 0), year: (a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0) }[d.sort];
  const feeds = d.feeds;
  try {
    let added = 0;
    for (let round = 0; round < 8 && added < 24; round++) {
      // за коло — по сторінці з кожної стрічки, але не більше восьми запитів разом
      const turn = feeds.filter(f => !f.done).sort((a, b) => a.skip - b.skip).slice(0, 8);
      if (!turn.length) break;
      const pages = await Promise.all(turn.map(f => catalog.catalog({ type: f.type, list: f.list, genre: f.genre, skip: f.skip })));
      if (d.key !== key || d.feeds !== feeds) return;
      const have = new Set(d.items.map(x => x.id));
      turn.forEach((f, i) => {
        f.skip += catalog.PAGE;
        if (pages[i].n < catalog.PAGE) f.done = true;
        for (const x of pages[i].items) if (!have.has(x.id) && fits(x)) { have.add(x.id); d.items.push(x); added++; }
      });
      if (order) d.items.sort(order);
      d.more = feeds.some(f => !f.done);
      drawDiscover();
    }
  } catch (err) {
    if (d.key === key && d.feeds === feeds) d.error = true;
  } finally {
    if (d.key === key && d.feeds === feeds) { d.loading = false; drawDiscover(); setTimeout(discAuto, 0); }
  }
}
export function drawDiscover() {
  const box = $('#disc-list'), d = view.disc;
  if (!box) return;
  box.innerHTML = d.items.map(x => catalogCard(x)).join('') + (d.loading ? skeletons(d.items.length ? 6 : 18) : '');
  $('#disc-more').innerHTML = d.error ? `<p class="muted">${t('catalog.down.retry')}</p><button class="btn" data-act="disc-more">${t('retry')}</button>`
    : !d.loading && !d.items.length ? `<div class="empty">${icon('compass')}<b>${t('disc.empty.title')}</b><p>${t('disc.empty.text')}</p></div>`
    : !d.loading && d.more ? `<button class="btn lg" data-act="disc-more">${t('show.more')}</button>` : '';
}

// ── статистика ────────────────────────────────────────────────────
export function renderStats() {
  const list = store.list(), s = insights(list);
  if (!list.length) {
    app.innerHTML = `<header class="page-head"><h1>${t('nav.stats')}</h1></header><div class="empty">${icon('chart')}<b>${t('stats.empty.title')}</b>
      <p>${t('stats.empty.text')}</p>
      <div class="hero-act"><button class="btn primary" data-act="add">${icon('plus')}${t('add.entry')}</button><button class="btn" data-act="demo">${icon('sparkle')}${t('demo')}</button></div></div>`;
    return;
  }
  const hours = Math.round(s.minutes / 60);
  const bars = rows => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.map(([l, v]) =>
    `<div class="hbar"><span>${l}</span><i style="--w:${Math.max(2, v / max * 100)}%"></i><b>${v}</b></div>`).join(''); };
  const maxS = Math.max(1, ...s.scores), w = s.byStatus.watching || 0;
  app.innerHTML = `
  <header class="page-head"><h1>${t('nav.stats')}</h1><span class="count">${t('stats.sub', { n: count('entry', s.total) })}</span><span class="grow"></span>
    <button class="btn" data-act="wrapped">${icon('image')}${t('wrap.btn')}</button></header>
  <div class="tiles">
    <div class="tile"><span>${t('tile.watched')}</span><b>${hours}<small> ${t('h')}</small></b><em>${hours >= 48 ? t('tile.days', { d: fmtRating(hours / 24) }) : t('tile.start')}</em></div>
    <div class="tile"><span>${t('tile.episodes')}</span><b>${s.episodes}</b><em>${t('tile.watching', { n: count('title', w) })}</em></div>
    <div class="tile"><span>${t('tile.avg')}</span><b>${fmtRating(s.avg) || '—'}</b><em>${t('tile.rated', { a: s.rated, b: s.total })}</em></div>
    <div class="tile"><span>${t('tile.done')}</span><b>${s.byStatus.done || 0}</b><em>${t('tile.recs', { n: s.rec })}</em></div>
  </div>
  <div class="panels">
    <section class="panel"><h2>${t('panel.scores')}</h2>
      <div class="vbars">${s.scores.map((v, i) => `<div><i style="--h:${v / maxS * 100}%" title="${v}"></i><span>${i + 1}</span></div>`).join('')}</div></section>
    <section class="panel"><h2>${t('panel.genres')}</h2>${bars(s.genres.slice(0, 8).map(([g, v]) => [esc(genreName(g)), v])) || `<p class="muted">${t('genres.loading')}</p>`}</section>
    <section class="panel"><h2>${t('panel.status')}</h2>${bars(STATUS_IDS.map(k => [`<i class="dot st-${k}"></i>${statusLabel(k)}`, s.byStatus[k] || 0]))}
      <h2 class="mt">${t('panel.kind')}</h2>${bars(KIND_IDS.map(k => [t('kinds.' + k), s.byKind[k] || 0]))}</section>
    <section class="panel"><h2>${t('panel.gaps')}</h2>${s.gaps.length ? `<ul class="gaps">${s.gaps.map(({ e, d }) =>
      `<li data-id="${e.id}" data-act="open" tabindex="0">${ph(e.id, e.title, 'small')}<div><b>${esc(e.title)}</b>
        <span>${t('gap.line', { a: fmtScore(e.score), b: fmtRating(e.meta.imdb) })}</span></div><em class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${fmtRating(Math.abs(d)) || '0'}</em></li>`).join('')}</ul>`
      : `<p class="muted">${t('gaps.empty')}</p>`}</section>
  </div>`;
}

// ── чужі рекомендації ─────────────────────────────────────────────
export function renderRecs() {
  const { name, items, title } = view.recs;
  const tm = taste(items);
  items.forEach(x => remember({ id: x.id, type: x.k === 'movie' ? 'movie' : 'series', kind: x.k, title: x.t, year: x.y, rec: x }));
  const lead = items[0];
  app.innerHTML = `
  <section class="hero recs-hero" data-img>
    ${lead ? `<img class="hero-bg" alt="" src="${backdrop(lead.id)}">` : ''}
    <div class="hero-in"><span class="kicker">${title ? (name ? t('recs.list.by', { name: esc(name) }) : t('recs.list')) : t('recs.kicker')}</span>
      <h1>${title ? esc(title) : name ? t('recs.title.by', { name: esc(name) }) : t('recs.title')}</h1>
      <p class="hero-plot">${t('recs.text', { n: count('title', items.length) })}</p>
      <div class="hero-act"><a class="btn lg" href="./">${icon('library')}${t('my.shelf')}</a></div></div>
  </section>
  ${tm.panel}
  <ul class="rec-list">${items.map((x, i) => {
    const have = store.get(x.id);
    return `<li class="rcard" data-id="${x.id}" data-act="preview" tabindex="0">
      <span class="rec-n">${i + 1}</span>${ph(x.id, x.t, 'medium')}
      <div class="rec-main"><h3>${esc(x.t)}</h3>
        <p class="row-sub">${esc([kindLabel(x.k), x.y].filter(Boolean).join(' · '))}${x.r ? ` · IMDb ${fmtRating(x.r)}` : ''}</p>
        ${x.n ? `<blockquote>${esc(x.n)}</blockquote>` : ''}
        ${tasteBadge(tm.tags.get(x.id))}
        <button class="btn ${have ? '' : 'primary'}" data-act="take" ${have ? 'disabled' : ''}>${icon(have ? 'check' : 'plus')}${have ? t('have.already') : t('take')}</button></div>
      ${x.s ? `<div class="rec-score"><b>${fmtScore(x.s)}</b><small>${t('author.score')}</small></div>` : ''}
    </li>`;
  }).join('') || `<li class="empty">${icon('star')}<b>${t('recs.empty.title')}</b><p>${t('recs.empty.text')}</p></li>`}</ul>`;
}
