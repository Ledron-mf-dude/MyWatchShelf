// Екрани: головна, бібліотека, каталог, статистика, чужі рекомендації.
import {
  STATUSES, STATUS_LABEL, KIND_LABEL, CATALOG_GENRES, esc, safeUrl, backdrop, plural, fmtRating, fmtRuntime,
  genreUk, progressText, progressPct, filterSort, insights, episodesWatched, episodesTotal,
} from './logic.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { $, app, icon, ph, remember } from './ui.js';

const S = store.settings;
export const view = {
  route: 'home',
  f: { q: '', kind: 'all', status: 'all', genres: [] },
  disc: { type: 'series', genre: '', year: '', items: [], skip: 0, loading: false, more: true, error: '', key: '' },
  recs: null,
  home: null,   // добірки каталогу для головної, щоб не тягнути їх щоразу
};
const KIND_PLURAL = { anime: 'Аніме', series: 'Серіали', movie: 'Фільми' };
const SORTS = [['updated', 'Нещодавно змінені'], ['added', 'Нещодавно додані'], ['score', 'Моя оцінка'], ['imdb', 'Оцінка IMDb'],
  ['progress', 'Прогрес'], ['title', 'Назва'], ['year', 'Рік']];
const canPlus = e => e.type === 'series' && e.status !== 'done' && e.status !== 'dropped';

// ── картки ────────────────────────────────────────────────────────
export function entryCard(e, { rank = 0 } = {}) {
  const pct = progressPct(e), url = safeUrl(e.url), m = e.meta || {};
  return `<article class="pc" data-id="${e.id}" data-act="open" tabindex="0" role="button" aria-label="${esc(e.title)}">
    ${rank ? `<span class="rank" aria-hidden="true">${rank}</span>` : ''}
    <div class="pc-body">
      <div class="pc-img">${ph(e.id, e.title, 'medium', 'fill')}
        <span class="pc-top">${e.score ? `<b class="badge score">${icon('starFill')}${e.score}</b>` : ''}${e.rec ? '<b class="badge rec">раджу</b>' : ''}</span>
        ${m.imdb ? `<span class="badge imdb">IMDb ${fmtRating(m.imdb)}</span>` : ''}
        <div class="pc-acts">
          ${url ? `<a class="rb solid" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Дивитись" aria-label="Дивитись">${icon('play')}</a>` : ''}
          ${canPlus(e) ? '<button class="rb solid" data-act="plus" title="Наступна серія">+1</button>' : ''}
        </div>
        ${e.type === 'series' && pct > 0 && pct < 100 ? `<i class="pc-bar" style="--w:${pct}%"></i>` : ''}
      </div>
      <h3>${esc(e.title)}</h3>
      <p><i class="dot st-${e.status}"></i>${esc(progressText(e) || STATUS_LABEL[e.status])}</p>
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
          ? `<span class="rb solid on" title="Уже на полиці">${icon('check')}</span>`
          : `<button class="rb solid" data-act="quick-add" title="На полицю" aria-label="Додати на полицю">${icon('plus')}</button>`}</div>
      </div>
      <h3>${esc(x.title)}</h3>
      <p>${esc([x.year, KIND_LABEL[x.kind]].filter(Boolean).join(' · '))}</p>
    </div>
  </article>`;
}
const skeletons = n => Array.from({ length: n }, () => '<div class="pc skel"><div class="pc-body"><div class="pc-img"></div><h3>&nbsp;</h3><p>&nbsp;</p></div></div>').join('');

function rail(title, cards, { ranked = false, link = '' } = {}) {
  return `<section class="rail ${ranked ? 'ranked' : ''}">
    <header><h2>${esc(title)}</h2>${link}<span class="grow"></span>
      <button class="rb ghost" data-act="rail" data-v="-1" aria-label="Назад">${icon('chevL')}</button>
      <button class="rb ghost" data-act="rail" data-v="1" aria-label="Далі">${icon('chevR')}</button></header>
    <div class="rail-track">${cards}</div>
  </section>`;
}

function hintHtml() {
  const show = cloud.available && !cloud.user && cloud.state === 'off' && S.hint && store.list().length > 0;
  return show ? `<div class="hint">${icon('sparkle')}<div><b>Список живе лише в цьому браузері</b>
    <p>Увійди через Google — і полиця сама з’явиться на телефоні та інших пристроях.</p></div>
    <div class="hint-act"><button class="btn primary" data-act="signin">Увійти</button>
    <button class="btn ghost" data-act="hide-hint">Не зараз</button></div></div>` : '';
}

// ── головна ───────────────────────────────────────────────────────
function heroHtml(e) {
  if (!e) {
    return `<section class="hero empty"><div class="hero-in">
      <span class="kicker">Полиця переглядів</span>
      <h1>Усе, що ти дивишся, — в одному місці</h1>
      <p class="hero-plot">Аніме, серіали й фільми з оцінками IMDb. Памʼятає серію, на якій ти зупинився, твої оцінки й посилання, де дивишся, — і синхронізується між пристроями.</p>
      <div class="hero-act"><button class="btn primary lg" data-act="add">${icon('plus')}Додати перший запис</button>
        <button class="btn lg" data-act="demo">${icon('sparkle')}Показати на прикладі</button></div>
    </div></section>`;
  }
  const m = e.meta || {}, url = safeUrl(e.url), pct = progressPct(e);
  const total = episodesTotal(e);
  return `<section class="hero" data-img data-id="${e.id}">
    <img class="hero-bg" alt="" src="${backdrop(e.id)}">
    <div class="hero-in">
      <span class="kicker">${e.status === 'watching' || e.status === 'paused' ? 'Продовжити перегляд' : 'З твоєї полиці'}</span>
      <h1>${esc(e.title)}</h1>
      <p class="hero-meta">${[KIND_LABEL[e.kind], e.year, fmtRuntime(m.runtime)].filter(Boolean).map(esc).join('<i>·</i>')}
        ${m.imdb ? `<b class="badge imdb static">IMDb ${fmtRating(m.imdb)}</b>` : ''}${e.score ? `<b class="badge score static">${icon('starFill')}${e.score}</b>` : ''}</p>
      ${m.plot ? `<p class="hero-plot">${esc(m.plot)}</p>` : ''}
      ${e.type === 'series' ? `<div class="hero-prog"><i class="bar" style="--w:${pct}%"></i>
        <span>${esc(progressText(e) || 'ще не починав')}${total ? ` · ${episodesWatched(e)} з ${total} серій` : ''}</span></div>` : ''}
      <div class="hero-act">
        ${url ? `<a class="btn primary lg" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('play')}Дивитись</a>` : ''}
        ${canPlus(e) ? `<button class="btn lg ${url ? '' : 'primary'}" data-act="plus">${icon('check')}Серію переглянуто</button>` : ''}
        <button class="btn lg ghost" data-act="open">Картка</button>
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
  const more = r => `<a class="more" href="#/${r}">Усе ${icon('chevR')}</a>`;
  app.innerHTML = heroHtml(feature) + hintHtml()
    + (watching.length > 1 ? rail('Продовжити перегляд', watching.map(e => entryCard(e)).join(''), { link: more('library') }) : '')
    + (top.length ? rail('Мій топ', top.map((e, i) => entryCard(e, { rank: i + 1 })).join(''), { ranked: true }) : '')
    + (planned.length ? rail('У планах', planned.slice(0, 20).map(e => entryCard(e)).join(''), { link: more('library') }) : '')
    + '<div id="home-catalog"></div>';
  drawHomeCatalog();
}
function drawHomeCatalog() {
  const box = $('#home-catalog');
  if (!box) return;
  const more = `<a class="more" href="#/discover">Каталог ${icon('chevR')}</a>`;
  if (!view.home) {
    box.innerHTML = rail('Популярне зараз', skeletons(8), { ranked: true });
    if (view.home === null) {
      view.home = undefined;   // «уже вантажимо»
      Promise.all([catalog.catalog({ type: 'series' }), catalog.catalog({ type: 'series', genre: 'Animation' }), catalog.catalog({ type: 'movie' })])
        .then(([s, a, m]) => { view.home = { series: s, anime: a.filter(x => x.kind === 'anime'), movies: m }; })
        .catch(() => { view.home = { error: true }; })
        .finally(() => { if (view.route === 'home') drawHomeCatalog(); });
    }
    return;
  }
  if (view.home.error) { box.innerHTML = '<p class="muted pad">Каталог зараз недоступний — перевір мережу.</p>'; return; }
  const h = view.home;
  box.innerHTML = rail('Популярне зараз', h.series.slice(0, 10).map((x, i) => catalogCard(x, { rank: i + 1 })).join(''), { ranked: true, link: more })
    + (h.anime.length ? rail('Популярне аніме', h.anime.slice(0, 20).map(x => catalogCard(x)).join(''), { link: more }) : '')
    + rail('Фільми, про які говорять', h.movies.slice(0, 20).map(x => catalogCard(x)).join(''), { link: more });
}

// ── бібліотека ────────────────────────────────────────────────────
function rowHtml(e) {
  const m = e.meta || {}, url = safeUrl(e.url), pct = progressPct(e);
  const line = [STATUS_LABEL[e.status], progressText(e), ...(m.genres || []).slice(0, 3).map(genreUk), fmtRuntime(m.runtime)].filter(Boolean).join(' · ');
  return `<li class="row" data-id="${e.id}" data-act="open" tabindex="0">
    ${ph(e.id, e.title, 'small')}
    <div class="row-main">
      <div class="row-title"><i class="dot st-${e.status}"></i><b>${esc(e.title)}</b>${e.rec ? '<span class="badge rec static">раджу</span>' : ''}</div>
      <div class="row-sub">${esc([KIND_LABEL[e.kind], e.year].filter(Boolean).join(' · '))}</div>
      <div class="row-meta">${esc(line)}</div>
      ${e.type === 'series' && pct > 0 ? `<i class="bar thin" style="--w:${pct}%"></i>` : ''}
    </div>
    <div class="row-act">
      ${url ? `<a class="rb" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="Дивитись" aria-label="Дивитись">${icon('play')}</a>` : ''}
      ${canPlus(e) ? '<button class="rb" data-act="plus" title="Наступна серія">+1</button>' : ''}
    </div>
    <div class="score ${e.score ? '' : 'none'}"><b>${e.score || '—'}</b><small>IMDb ${fmtRating(m.imdb) || '—'}</small></div>
  </li>`;
}

export function renderLibrary() {
  app.innerHTML = `
  <header class="page-head"><h1>Бібліотека</h1><span class="count" id="lib-count"></span></header>
  <div class="filters">
    <label class="field search">${icon('search')}<input id="lib-q" type="search" placeholder="Пошук: назва, жанр, нотатка" autocomplete="off" aria-label="Пошук у бібліотеці"></label>
    <div class="seg" id="lib-kind" role="tablist"></div>
    <span class="grow"></span>
    <div class="dd"><button class="btn" data-act="genres-toggle" aria-haspopup="true">${icon('filter')}Жанри<b id="lib-gcount"></b></button>
      <div class="pop" id="lib-genres" hidden></div></div>
    <label class="field">${icon('sortDown')}<select id="lib-sort" aria-label="Сортування">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
    <button class="rb" data-act="dir" id="lib-dir" title="Напрям сортування"></button>
    <button class="rb" data-act="view" id="lib-view" title="Плитка або список"></button>
  </div>
  <div class="chips" id="lib-status"></div>
  <div id="lib-list"></div>`;
  $('#lib-q').value = view.f.q;
  $('#lib-sort').value = S.sort;
  $('#lib-q').addEventListener('input', e => { view.f.q = e.target.value; updateLibrary(); });
  $('#lib-sort').addEventListener('change', e => { store.setSetting('sort', e.target.value); updateLibrary(); });
  updateLibrary();
}
export function updateLibrary() {
  if (!$('#lib-list')) return;
  const all = store.list(), f = view.f;
  const n = fn => all.filter(fn).length;
  const seg = (v, l, c) => `<button class="${f.kind === v ? 'on' : ''}" data-act="kind" data-v="${v}" role="tab" aria-selected="${f.kind === v}">${l}<small>${c}</small></button>`;
  $('#lib-kind').innerHTML = seg('all', 'Усе', all.length) + ['anime', 'series', 'movie'].map(k => seg(k, KIND_PLURAL[k], n(e => e.kind === k))).join('');
  const chip = (v, l, c, cls = '') => `<button class="chip ${cls} ${f.status === v ? 'on' : ''}" data-act="status" data-v="${v}" aria-pressed="${f.status === v}">${l}<small>${c}</small></button>`;
  $('#lib-status').innerHTML = chip('all', 'Усі статуси', all.length)
    + STATUSES.map(([v, l]) => chip(v, `<i class="dot st-${v}"></i>${l}`, n(e => e.status === v))).join('')
    + chip('rec', `${icon('starFill')}раджу`, n(e => e.rec), 'rec')
    + (f.q || f.kind !== 'all' || f.status !== 'all' || f.genres.length ? `<button class="chip reset" data-act="reset-filters">${icon('close')}Скинути фільтри</button>` : '');
  const genres = insights(all).genres;
  $('#lib-gcount').textContent = f.genres.length || '';
  $('#lib-genres').innerHTML = genres.length
    ? genres.map(([g, c]) => `<button class="chip ${f.genres.includes(g) ? 'on' : ''}" data-act="genre" data-v="${esc(g)}">${esc(genreUk(g))}<small>${c}</small></button>`).join('')
    : '<p class="muted">Жанри зʼявляться, коли на полиці буде хоч один запис.</p>';
  $('#lib-dir').innerHTML = icon(S.dir < 0 ? 'sortDown' : 'sortUp');
  $('#lib-view').innerHTML = icon(S.view === 'grid' ? 'list' : 'grid');
  const list = filterSort(all, f, S.sort, S.dir);
  $('#lib-count').textContent = list.length === all.length ? `${all.length} ${plural(all.length, 'запис', 'записи', 'записів')}` : `${list.length} з ${all.length}`;
  const box = $('#lib-list');
  if (!all.length) {
    box.innerHTML = `<div class="empty">${icon('library')}<b>Полиця поки порожня</b>
      <p>Додай перше аніме, фільм чи серіал — за назвою, посиланням IMDb або посиланням сайту, де дивишся.</p>
      <div class="hero-act"><button class="btn primary" data-act="add">${icon('plus')}Додати запис</button><a class="btn" href="#/discover">${icon('compass')}Відкрити каталог</a></div></div>`;
  } else if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('search')}<b>Нічого не знайшлось</b><p>Спробуй інший запит або скинь фільтри.</p>
      <button class="btn" data-act="reset-filters">Скинути фільтри</button></div>`;
  } else {
    box.innerHTML = S.view === 'grid'
      ? `<div class="grid">${list.map(e => entryCard(e)).join('')}</div>`
      : `<ul class="list">${list.map(rowHtml).join('')}</ul>`;
  }
}

// ── каталог ───────────────────────────────────────────────────────
export function renderDiscover() {
  const d = view.disc;
  const years = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);
  app.innerHTML = `
  <header class="page-head"><h1>Каталог</h1><span class="count">популярне просто зараз</span></header>
  <div class="filters">
    <div class="seg" id="disc-type" role="tablist">${[['series', 'Серіали'], ['anime', 'Аніме'], ['movie', 'Фільми']].map(([v, l]) =>
      `<button class="${d.type === v ? 'on' : ''}" data-act="disc-type" data-v="${v}" role="tab" aria-selected="${d.type === v}">${l}</button>`).join('')}</div>
    <span class="grow"></span>
    <label class="field">${icon('filter')}<select id="disc-genre" aria-label="Жанр"><option value="">Усі жанри</option>${CATALOG_GENRES.map(g =>
      `<option value="${g}" ${d.genre === g ? 'selected' : ''}>${esc(genreUk(g))}</option>`).join('')}</select></label>
    <label class="field">${icon('clock')}<select id="disc-year" aria-label="Рік"><option value="">Будь-який рік</option>${years.map(y =>
      `<option ${String(d.year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
  </div>
  <div id="disc-list" class="grid"></div><div id="disc-more" class="center"></div>`;
  $('#disc-genre').addEventListener('change', e => { d.genre = e.target.value; loadDiscover(true); });
  $('#disc-year').addEventListener('change', e => { d.year = e.target.value; loadDiscover(true); });
  const key = [d.type, d.genre, d.year].join('|');
  if (d.key === key && d.items.length) drawDiscover(); else loadDiscover(true);
}
export async function loadDiscover(reset) {
  const d = view.disc;
  if (reset) { d.items = []; d.skip = 0; d.more = true; d.error = ''; }
  const key = d.key = [d.type, d.genre, d.year].join('|');
  d.loading = true; drawDiscover();
  try {
    const type = d.type === 'movie' ? 'movie' : 'series';
    const anime = d.type === 'anime';
    const batch = d.year
      ? await catalog.catalog({ type, list: 'year', genre: d.year, skip: d.skip })
      : await catalog.catalog({ type, genre: anime ? 'Animation' : d.genre, skip: d.skip });
    if (d.key !== key) return;
    d.more = batch.length >= 40;
    d.skip += batch.length || 50;
    const have = new Set(d.items.map(x => x.id));
    d.items.push(...batch.filter(x => !have.has(x.id)
      && (!anime || x.kind === 'anime')
      && (!(d.year || anime) || !d.genre || x.meta.genres.includes(d.genre))));
  } catch (err) {
    if (d.key === key) d.error = 'Каталог зараз недоступний. Перевір мережу й спробуй ще раз.';
  } finally {
    if (d.key === key) { d.loading = false; drawDiscover(); }
  }
}
export function drawDiscover() {
  const box = $('#disc-list'), d = view.disc;
  if (!box) return;
  box.innerHTML = d.items.map(x => catalogCard(x)).join('') + (d.loading ? skeletons(d.items.length ? 6 : 18) : '');
  $('#disc-more').innerHTML = d.error ? `<p class="muted">${esc(d.error)}</p><button class="btn" data-act="disc-more">Спробувати ще раз</button>`
    : !d.loading && !d.items.length ? `<div class="empty">${icon('compass')}<b>За цими фільтрами порожньо</b><p>Спробуй інший жанр чи рік.</p></div>`
    : !d.loading && d.more ? `<button class="btn lg" data-act="disc-more">Показати ще</button>` : '';
}

// ── статистика ────────────────────────────────────────────────────
export function renderStats() {
  const list = store.list(), s = insights(list);
  if (!list.length) {
    app.innerHTML = `<header class="page-head"><h1>Статистика</h1></header><div class="empty">${icon('chart')}<b>Поки нема що рахувати</b>
      <p>Додай кілька записів — і тут зʼявляться години перегляду, улюблені жанри та розподіл оцінок.</p>
      <div class="hero-act"><button class="btn primary" data-act="add">${icon('plus')}Додати запис</button><button class="btn" data-act="demo">${icon('sparkle')}Показати на прикладі</button></div></div>`;
    return;
  }
  const hours = Math.round(s.minutes / 60);
  const bars = (rows, max, cls = '') => rows.map(([l, v, extra]) =>
    `<div class="hbar ${cls}"><span>${l}</span><i style="--w:${max ? Math.max(2, v / max * 100) : 0}%"></i><b>${extra ?? v}</b></div>`).join('');
  const maxS = Math.max(1, ...s.scores), maxG = s.genres[0]?.[1] || 1, maxSt = Math.max(1, ...Object.values(s.byStatus));
  app.innerHTML = `
  <header class="page-head"><h1>Статистика</h1><span class="count">${s.total} ${plural(s.total, 'запис', 'записи', 'записів')} на полиці</span></header>
  <div class="tiles">
    <div class="tile"><span>Переглянуто</span><b>${hours}<small> год</small></b><em>${hours >= 48 ? `це ${(hours / 24).toFixed(1).replace('.', ',')} доби без перерви` : 'і це лише початок'}</em></div>
    <div class="tile"><span>Серій</span><b>${s.episodes}</b><em>${s.byStatus.watching || 0} ${plural(s.byStatus.watching || 0, 'тайтл', 'тайтли', 'тайтлів')} дивлюсь зараз</em></div>
    <div class="tile"><span>Середня оцінка</span><b>${fmtRating(s.avg) || '—'}</b><em>оцінено ${s.rated} з ${s.total}</em></div>
    <div class="tile"><span>Завершено</span><b>${s.byStatus.done || 0}</b><em>${s.rec} у рекомендаціях</em></div>
  </div>
  <div class="panels">
    <section class="panel"><h2>Мої оцінки</h2>
      <div class="vbars">${s.scores.map((v, i) => `<div><i style="--h:${v / maxS * 100}%" title="${v}"></i><span>${i + 1}</span></div>`).join('')}</div></section>
    <section class="panel"><h2>Улюблені жанри</h2>${bars(s.genres.slice(0, 8).map(([g, v]) => [esc(genreUk(g)), v]), maxG) || '<p class="muted">Жанри ще підтягуються.</p>'}</section>
    <section class="panel"><h2>За статусом</h2>${bars(STATUSES.map(([k, l]) => [`<i class="dot st-${k}"></i>${l}`, s.byStatus[k] || 0]), maxSt)}
      <h2 class="mt">За типом</h2>${bars(['anime', 'series', 'movie'].map(k => [KIND_PLURAL[k], s.byKind[k] || 0]), Math.max(1, ...Object.values(s.byKind)))}</section>
    <section class="panel"><h2>Де я не згоден з IMDb</h2>${s.gaps.length ? `<ul class="gaps">${s.gaps.map(({ e, d }) =>
      `<li data-id="${e.id}" data-act="open" tabindex="0">${ph(e.id, e.title, 'small')}<div><b>${esc(e.title)}</b>
        <span>моя ${e.score} · IMDb ${fmtRating(e.meta.imdb)}</span></div><em class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${fmtRating(Math.abs(d)) || '0'}</em></li>`).join('')}</ul>`
      : '<p class="muted">Постав кілька оцінок — порівняю їх з IMDb.</p>'}</section>
  </div>`;
}

// ── чужі рекомендації ─────────────────────────────────────────────
export function renderRecs() {
  const { name, items } = view.recs;
  items.forEach(x => remember({ id: x.id, type: x.k === 'movie' ? 'movie' : 'series', kind: x.k, title: x.t, year: x.y, rec: x }));
  const lead = items[0];
  app.innerHTML = `
  <section class="hero recs-hero" data-img>
    ${lead ? `<img class="hero-bg" alt="" src="${backdrop(lead.id)}">` : ''}
    <div class="hero-in"><span class="kicker">Добірка</span>
      <h1>${name ? `${esc(name)} радить подивитись` : 'Рекомендації до перегляду'}</h1>
      <p class="hero-plot">${items.length} ${plural(items.length, 'назва', 'назви', 'назв')} з особистими оцінками й коментарями. Натисни «Собі на полицю» — і запис опиниться у твоєму власному списку.</p>
      <div class="hero-act"><a class="btn lg" href="./">${icon('library')}Моя полиця</a></div></div>
  </section>
  <ul class="rec-list">${items.map((x, i) => {
    const have = store.get(x.id);
    return `<li class="rcard" data-id="${x.id}" data-act="preview" tabindex="0">
      <span class="rec-n">${i + 1}</span>${ph(x.id, x.t, 'medium')}
      <div class="rec-main"><h3>${esc(x.t)}</h3>
        <p class="row-sub">${esc([KIND_LABEL[x.k], x.y].filter(Boolean).join(' · '))}${x.r ? ` · IMDb ${fmtRating(x.r)}` : ''}</p>
        ${x.n ? `<blockquote>${esc(x.n)}</blockquote>` : ''}
        <button class="btn ${have ? '' : 'primary'}" data-act="take" ${have ? 'disabled' : ''}>${icon(have ? 'check' : 'plus')}${have ? 'Уже в тебе' : 'Собі на полицю'}</button></div>
      ${x.s ? `<div class="rec-score"><b>${x.s}</b><small>оцінка автора</small></div>` : ''}
    </li>`;
  }).join('') || `<li class="empty">${icon('star')}<b>Тут поки порожньо</b><p>Автор ще нічого не порадив.</p></li>`}</ul>`;
}
