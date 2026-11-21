// Усе, що відкривається поверх сторінки: картка запису, перегляд тайтла
// з каталогу, пошук-палітра та діалог поширення рекомендацій.
import {
  STATUSES, KINDS, KIND_LABEL, STATUS_LABEL, esc, safeUrl, backdrop, plural, fmtRating, fmtRuntime, genreUk,
  parseInput, nextEpisode, progressText, progressPct, seasonTotal, episodesWatched, episodesTotal, recItem, encodeRecs, filterSort,
} from './logic.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { cloud } from './cloud.js';
import { $, layer, icon, ph, toast, ui, showOverlay, closeOverlay, remember, recall, confirmBox } from './ui.js';
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
    if (loud) toast('Дані оновлено');
  } catch (err) {
    if (loud) toast('Не вдалося оновити: ' + err.message);
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
  else refreshMeta(item.id, { first: true, detect: !item.type });
  return e;
}

export function plus(id) {
  const e = store.get(id);
  if (!e) return;
  const patch = nextEpisode(e);
  if (!Object.keys(patch).length) return toast('Це остання відома серія');
  flushCard();
  const n = store.save(id, patch);
  if (ui.overlay?.type === 'card') drawCard();
  toast(patch.status === 'done' ? `«${n.title}» — переглянуто повністю` : `${n.title}: ${progressText(n)}`,
    { label: 'Скасувати', action: () => { store.restore(e); if (ui.overlay?.type === 'card') drawCard(); } });
}

function headHtml(x, m, extra = '') {
  return `<header class="card-hero" data-img>
    <img class="card-bg" alt="" src="${backdrop(x.id)}">
    <button class="rb solid card-x" data-act="close" aria-label="Закрити">${icon('close')}</button>
    <div class="card-id">${ph(x.id, x.title, 'medium', 'lg')}
      <div class="card-ttl"><h2>${esc(x.title)}</h2>
        <p class="sub">${esc([KIND_LABEL[x.kind], x.year, fmtRuntime(m.runtime)].filter(Boolean).join(' · '))}</p>
        <p class="card-links"><a class="badge imdb static" href="https://www.imdb.com/title/${x.id}/" target="_blank" rel="noopener noreferrer">IMDb ${fmtRating(m.imdb) || '—'} ${icon('external')}</a>
          ${m.trailer ? `<a class="badge static" href="https://www.youtube.com/watch?v=${esc(m.trailer)}" target="_blank" rel="noopener noreferrer">${icon('play')}трейлер</a>` : ''}${extra}</p>
      </div></div>
  </header>`;
}
const aboutHtml = m => `
  ${m.genres?.length ? `<p class="genres">${m.genres.map(g => `<span>${esc(genreUk(g))}</span>`).join('')}</p>` : ''}
  ${m.plot ? `<p class="plot">${esc(m.plot)}</p>` : ''}
  ${m.cast?.length ? `<p class="cast"><span>У ролях</span> ${esc(m.cast.join(', '))}</p>` : ''}`;

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
  return `<section><h3>Де я зупинився <small>${all ? `${episodesWatched(e)} з ${all} серій · ${pct}%` : ''}</small></h3>
    ${all ? `<i class="bar" style="--w:${pct}%"></i>` : ''}
    ${seasons.length > 1 && seasons.length <= 40 ? `<div class="pills">${seasons.map(n =>
      `<button class="${n === s ? 'on' : ''} ${n < s ? 'past' : ''}" data-act="season" data-v="${n}">${n}</button>`).join('')}<span>сезон</span></div>` : ''}
    ${total && total <= 200 ? `<div class="eps">${Array.from({ length: total }, (_, i) =>
      `<button class="${i + 1 <= ep ? 'on' : ''}" data-act="episode" data-v="${i + 1}" aria-label="Серія ${i + 1}">${i + 1}</button>`).join('')}</div>` : ''}
    <div class="progress">
      <div class="stepper"><button data-act="step" data-v="season:-1" aria-label="Попередній сезон">−</button>
        <label><span>сезон</span><input type="number" inputmode="numeric" min="1" data-num="season" value="${s}"></label>
        <button data-act="step" data-v="season:1" aria-label="Наступний сезон">+</button></div>
      <div class="stepper"><button data-act="step" data-v="episode:-1" aria-label="Попередня серія">−</button>
        <label><span>серія${total ? ' з ' + total : ''}</span><input type="number" inputmode="numeric" min="0" data-num="episode" value="${ep}"></label>
        <button data-act="step" data-v="episode:1" aria-label="Наступна серія">+</button></div>
      <button class="btn primary" data-act="plus">${icon('check')}Серію переглянуто</button>
    </div>
    ${m.state ? `<p class="muted small">${/ended/i.test(m.state) ? 'Серіал завершено' : 'Серіал ще виходить'}${total ? '' : ' · кількість серій у цьому сезоні невідома'}</p>` : ''}
  </section>`;
}

function cardHtml(e) {
  const m = e.meta || {}, url = safeUrl(e.url);
  return `${headHtml(e, m)}
  <div class="card-body">
    <section><div class="status-seg">${STATUSES.map(([v, l]) =>
      `<button class="st-${v} ${e.status === v ? 'on' : ''}" data-act="set-status" data-v="${v}" aria-pressed="${e.status === v}"><i class="dot st-${v}"></i>${l}</button>`).join('')}</div></section>
    ${e.type === 'series' ? progressHtml(e) : ''}
    <section><h3>Моя оцінка <small>${e.score ? ['', 'жахливо', 'дуже погано', 'погано', 'слабко', 'середньо', 'непогано', 'добре', 'дуже добре', 'чудово', 'шедевр'][e.score] : 'ще не оцінено'}</small></h3>
      <div class="scores">${Array.from({ length: 10 }, (_, i) =>
        `<button data-act="score" data-v="${i + 1}" class="${e.score >= i + 1 ? 'fill' : ''} ${e.score === i + 1 ? 'on' : ''}" aria-pressed="${e.score === i + 1}">${i + 1}</button>`).join('')}</div></section>
    <section><h3>Де дивлюсь</h3>
      <div class="linkrow"><label class="field wide">${icon('link')}<input type="url" data-field="url" placeholder="Посилання на сайт чи плеєр" value="${esc(e.url)}"></label>
        ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('play')}Дивитись</a>` : ''}</div></section>
    <section><h3>Рекомендація</h3>
      <button class="toggle ${e.rec ? 'on' : ''}" data-act="rec" aria-pressed="${e.rec}">${icon(e.rec ? 'starFill' : 'star')}
        <span><b>${e.rec ? 'Раджу друзям' : 'Додати в рекомендації'}</b><small>${e.rec ? 'Запис видно за твоїм посиланням на рекомендації' : 'Потрапить у список, яким можна поділитись посиланням'}</small></span><i></i></button>
      ${e.rec ? `<input class="inp mt" type="text" data-field="recNote" maxlength="500" placeholder="Кілька слів, чому варто подивитись" value="${esc(e.recNote)}">` : ''}
    </section>
    <section><h3>Нотатка</h3><textarea class="inp" data-field="note" rows="3" placeholder="Для себе: враження, з ким дивитись, що далі">${esc(e.note)}</textarea></section>
    <section><h3>Про тайтл</h3>${aboutHtml(m) || (e.metaAt ? '<p class="muted">Опису немає.</p>' : '<p class="muted">Тягну опис і оцінку…</p>')}
      <div class="kind-row"><span>Тип</span>${KINDS.map(([v, l]) => `<button class="chip ${e.kind === v ? 'on' : ''}" data-act="set-kind" data-v="${v}">${l}</button>`).join('')}</div></section>
  </div>
  <footer class="card-foot">
    <button class="rb" data-act="del" title="Видалити з полиці" aria-label="Видалити">${icon('trash')}</button>
    <button class="rb" data-act="refresh" title="Оновити дані з каталогу" aria-label="Оновити дані">${icon('refresh')}</button>
    <span class="grow"></span>
    <button class="btn primary" data-act="close">Готово</button>
  </footer>`;
}

export function drawCard() {
  const o = ui.overlay;
  if (o?.type !== 'card') return;
  const e = store.get(o.id);
  if (!e) return closeOverlay();
  const scroll = $('.card-body', layer)?.scrollTop || 0;
  $('.card', layer).innerHTML = cardHtml(e);
  $('.card-body', layer).scrollTop = scroll;
}
export function openCard(id) {
  const e = store.get(id);
  if (!e) return;
  showOverlay({ type: 'card', id, onClose: flushCard }, '<aside class="card" role="dialog" aria-label="Картка запису"></aside>');
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
  const t = ev.target;
  if (t.dataset.field) pending[t.dataset.field] = t.value;
  else if (t.dataset.num) pending[t.dataset.num] = Math.max(t.dataset.num === 'season' ? 1 : 0, parseInt(t.value, 10) || 0);
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
    toast(`«${e.title}» прибрано з полиці`, { label: 'Повернути', action: () => store.restore(e) });
  },
  refresh: () => refreshMeta(ui.overlay.id, { loud: true }),
};

// ── перегляд тайтла, якого ще немає на полиці ─────────────────────
export async function openPreview(id) {
  const x = recall(id);
  if (!x) return;
  if (store.get(id)) return openCard(id);
  const ac = new AbortController();
  const draw = (m, loading) => {
    const r = x.rec;
    $('.card', layer).innerHTML = `${headHtml(x, m)}
      <div class="card-body">
        ${r?.s ? `<section class="author"><div class="rec-score"><b>${r.s}</b><small>оцінка автора</small></div>${r.n ? `<blockquote>${esc(r.n)}</blockquote>` : ''}</section>`
          : r?.n ? `<section><blockquote>${esc(r.n)}</blockquote></section>` : ''}
        <section><h3>Про тайтл</h3>${aboutHtml(m) || `<p class="muted">${loading ? 'Тягну опис…' : 'Опису немає.'}</p>`}
          ${Object.keys(m.seasons || {}).length ? `<p class="muted small">${Object.keys(m.seasons).length} ${plural(Object.keys(m.seasons).length, 'сезон', 'сезони', 'сезонів')} · ${Object.values(m.seasons).reduce((a, b) => a + b, 0)} серій</p>` : ''}</section>
      </div>
      <footer class="card-foot fwrap"><span class="muted small">Покласти на полицю як</span><span class="grow"></span>
        <button class="btn" data-act="add-as" data-v="watching">Дивлюсь</button>
        <button class="btn" data-act="add-as" data-v="done">Переглянуто</button>
        <button class="btn primary" data-act="add-as" data-v="planned">${icon('plus')}У плани</button></footer>`;
  };
  showOverlay({ type: 'preview', id, abort: ac }, '<aside class="card" role="dialog" aria-label="Про тайтл"></aside>');
  draw(x.meta || {}, !x.meta);
  if (!x.meta) {
    try {
      const full = await catalog.fetchMeta(id, x.kind === 'movie' ? 'movie' : undefined, ac.signal);
      remember({ ...x, type: full.type, meta: full.meta });
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
  closeOverlay();
  toast(`«${x.title}» — на полиці (${STATUS_LABEL[status]})`, { label: 'Відкрити', action: () => openCard(x.id) });
}

// ── пошук-палітра: полиця й каталог в одному полі ─────────────────
export function openPalette() {
  showOverlay({ type: 'palette', results: [], url: '', abort: null, sel: 0 }, `
    <div class="palette" role="dialog" aria-label="Пошук і додавання">
      <div class="pal-head">${icon('search')}
        <input id="pal-q" type="search" placeholder="Назва, посилання IMDb або сайту, де дивишся" autocomplete="off" aria-label="Пошук">
        <kbd>Esc</kbd></div>
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
    ? `<span class="badge static">${icon('link')}${esc(host)}</span> збережу як «де дивлюсь» <button class="linkbtn" data-act="drop-url">не треба</button>` : '';
}
function drawPalette(msg = '') {
  const o = ui.overlay, body = $('#pal-body');
  if (!body) return;
  let prev = '';
  body.innerHTML = msg ? `<p class="muted pad">${esc(msg)}</p>` : o.results.map((r, i) => {
    const have = store.get(r.id);
    const head = r.group !== prev ? `<h4>${esc(prev = r.group)}</h4>` : '';
    return `${head}<div class="res ${i === o.sel ? 'sel' : ''}" data-act="pick" data-v="${i}" role="option" aria-selected="${i === o.sel}">${ph(r.id, r.title, 'small')}
      <div class="row-main"><div class="row-title"><b>${esc(r.title)}</b></div>
        <div class="row-sub">${esc([r.year, KIND_LABEL[r.kind || r.type], have ? progressText(have) || STATUS_LABEL[have.status] : ''].filter(Boolean).join(' · '))}</div></div>
      ${r.meta?.imdb ? `<span class="badge imdb static">IMDb ${fmtRating(r.meta.imdb)}</span>` : ''}
      ${have ? `<span class="badge static ok">${icon('check')}на полиці</span>` : `<span class="badge static add">${icon('plus')}додати</span>`}</div>`;
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
    if (p.url) $('#pal-q').value = '';
    const mine = filterSort(store.list(), {}, 'updated', -1).slice(0, 4).map(e => ({ ...e, group: 'Нещодавнє на полиці' }));
    const hot = (view.home?.series || []).filter(x => !store.get(x.id)).slice(0, 6).map(x => ({ ...x, group: 'Популярне зараз' }));
    o.results = [...mine, ...hot];
    return drawPalette(o.results.length ? '' : p.url ? 'З посилання не вдалося вгадати назву — допиши її вручну.' : 'Почни вводити назву будь-якою мовою або встав посилання.');
  }
  const body = $('#pal-body');
  body.classList.add('busy');
  try {
    const mine = p.id ? [] : filterSort(store.list(), { q: p.query }, 'updated', -1).slice(0, 5).map(e => ({ ...e, group: 'На полиці' }));
    const found = p.id ? [await catalog.fetchMeta(p.id, undefined, ac.signal)] : await catalog.search(p.query, ac.signal);
    if (ac.signal.aborted) return;
    if (p.url && !p.id) $('#pal-q').value = p.query;
    const ids = new Set(mine.map(e => e.id));
    o.results = [...mine, ...found.filter(x => !ids.has(x.id)).map(x => ({ ...x, group: 'Каталог' }))];
    drawPalette(o.results.length ? '' : 'Нічого не знайшлось. Спробуй англійську чи оригінальну назву або встав посилання з IMDb.');
  } catch (err) {
    if (err.name !== 'AbortError') drawPalette(`Пошук зараз недоступний (${err.message}). Перевір мережу й спробуй ще раз.`);
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
    toast(`«${r.title}» додано на полицю`);
  }
  openCard(r.id);
}
export const dropUrl = () => { ui.overlay.url = ''; palNote(); };

// ── поширення рекомендацій ────────────────────────────────────────
export async function openShare() {
  const items = store.list().filter(e => e.rec)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title, 'uk')).map(recItem);
  if (!items.length) return toast('Спершу відкрий запис і ввімкни «Додати в рекомендації»', { ms: 4200 });
  const base = location.origin + location.pathname;
  let link, live = false;
  if (cloud.user) {
    try { await cloud.publishNow(); link = `${base}#u=${cloud.user.uid}`; live = true; } catch { /* нижче — знімок */ }
  }
  link ??= `${base}#r=${await encodeRecs(S.name, items)}`;
  showOverlay({ type: 'share', link }, `
    <div class="palette narrow" role="dialog" aria-label="Поділитись рекомендаціями">
      <div class="pal-head"><h2>Мої рекомендації <small>${items.length}</small></h2><button class="rb" data-act="close" aria-label="Закрити">${icon('close')}</button></div>
      <div class="share">
        <div class="share-strip">${items.slice(0, 6).map(x => ph(x.id, x.t, 'small')).join('')}${items.length > 6 ? `<span class="morecount">+${items.length - 6}</span>` : ''}</div>
        <p><span class="badge static ${live ? 'ok' : ''}">${live ? 'постійне посилання' : 'знімок'}</span>
          ${live ? 'Завжди показує свіжий список — додаєш чи прибираєш рекомендації, і гості бачать зміни.'
            : 'Список зашито просто в посилання. Зміниш рекомендації — надішли нове.' + (cloud.available ? ' Увійди через Google, і посилання стане постійним.' : '')}</p>
        <label class="field wide">${icon('link')}<input class="linkbox" readonly value="${esc(link)}" aria-label="Посилання"></label>
        <div class="hero-act">
          <button class="btn primary" data-act="copy">${icon('link')}Копіювати</button>
          ${navigator.share ? `<button class="btn" data-act="native-share">${icon('share')}Надіслати…</button>` : ''}
          <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${icon('external')}Як бачить гість</a>
        </div>
        <p class="muted small">Гість бачить назви, твої оцінки й коментарі до рекомендацій${S.name ? ` та підпис «${esc(S.name)}»` : ''}. Посилання «де дивлюсь» і нотатки не передаються.</p>
      </div>
    </div>`);
}

// ── показ на прикладі ─────────────────────────────────────────────
const DEMO = [
  ['tt22248376', 'series', 'watching', 1, 12, 10, true, 'Найтепліше фентезі останніх років — про час і памʼять.'],
  ['tt0903747', 'series', 'done', 5, 16, 10, true, 'Еталон серіальної драми: жодної зайвої серії.'],
  ['tt2560140', 'series', 'done', 4, 30, 9, true, 'Фінал, який не підвів.'],
  ['tt11126994', 'series', 'watching', 2, 4, 9, false, ''],
  ['tt9335498', 'series', 'paused', 1, 19, 8, false, ''],
  ['tt5180504', 'series', 'dropped', 2, 3, 6, false, ''],
  ['tt13443470', 'series', 'planned', 1, 0, 0, false, ''],
  ['tt14452776', 'series', 'watching', 3, 2, 9, true, 'Кухня як трилер. Дивитись голодним не раджу.'],
  ['tt0245429', 'movie', 'done', 1, 0, 10, true, 'Міядзакі в найкращій формі.'],
  ['tt0816692', 'movie', 'done', 1, 0, 9, false, ''],
  ['tt15239678', 'movie', 'done', 1, 0, 9, false, ''],
  ['tt6751668', 'movie', 'done', 1, 0, 8, false, ''],
  ['tt5311514', 'movie', 'planned', 1, 0, 0, false, ''],
  ['tt1160419', 'movie', 'planned', 1, 0, 0, false, ''],
];
export async function loadDemo() {
  const ok = await confirmBox({
    title: 'Показати на прикладі?',
    text: `На полицю ляже ${DEMO.length} відомих тайтлів з оцінками, прогресом і рекомендаціями — щоб побачити застосунок у дії.`
      + (cloud.user ? ' Ти ввійшов в акаунт, тож вони синхронізуються на інші пристрої.' : '') + ' Кожен запис можна видалити.',
    ok: 'Заповнити',
  });
  if (!ok) return;
  toast('Заповнюю полицю…');
  const now = Date.now();
  await Promise.all(DEMO.map(async ([id, type, status, season, episode, score, rec, recNote], i) => {
    if (store.get(id)) return;
    try {
      const x = await catalog.fetchMeta(id, type);
      addItem(x, { status, season, episode, score, rec, recNote, added: now - i * 864e5 });
    } catch { /* один тайтл не завантажився — не страшно */ }
  }));
  toast('Готово — полиця заповнена прикладами');
}
