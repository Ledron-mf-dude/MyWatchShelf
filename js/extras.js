// Надбудови над основними екранами: календар нових серій, «що подивитись
// сьогодні», збіг смаків із автором рекомендацій і картка-підсумок.
import {
  KIND_IDS, esc, safeUrl, fmtRating, fmtScore, fmtRuntime, genreName, kindLabel, insights, agenda, dayDiff,
  pickCandidates, tasteMatch, matchTag,
} from './logic.js';
import { t, tn, getLang } from './i18n.js';
import * as catalog from './meta.js';
import { store } from './store.js';
import { $, app, layer, icon, ph, toast, ui, showOverlay, closeOverlay } from './ui.js';
import { openCard } from './panel.js';

// ── календар ──────────────────────────────────────────────────────
const cal = { sched: {}, key: '', loading: false };
const watchingIds = () => store.list()
  .filter(e => e.type === 'series' && ['watching', 'paused'].includes(e.status)).map(e => e.id).sort().slice(0, 30);

// Розклад тягнемо лише для того, що людина дивиться, і лише коли цей
// набір змінився; redraw викликається, коли дані приїхали.
export function ensureSchedules(redraw) {
  const ids = watchingIds(), key = ids.join(',');
  if (key === cal.key) return;
  cal.key = key; cal.loading = true;
  Promise.all(ids.map(id => catalog.schedule(id).then(eps => { cal.sched[id] = eps; }).catch(() => {})))
    .then(() => { cal.loading = false; redraw(); });
}
const getAgenda = () => agenda(store.list(), cal.sched);

function dayLabel(d) {
  const n = dayDiff(d);
  if (n === 0) return t('day.today');
  if (n === 1) return t('day.tomorrow');
  if (n === -1) return t('day.yesterday');
  if (n > 1 && n < 7) return new Intl.DateTimeFormat(getLang(), { weekday: 'long' }).format(d);
  if (n < -1 && n > -8) return t('day.ago', { n: -n });
  return new Intl.DateTimeFormat(getLang(), { day: 'numeric', month: 'short' }).format(d);
}
const epLabel = v => t('prog', { s: v.s, e: v.e });
function agendaItems(a) {
  const seen = new Set(), out = [];
  const push = (r, v, label, cls) => { if (!seen.has(r.e.id)) { seen.add(r.e.id); out.push({ r, v, label, cls }); } };
  a.fresh.forEach(r => push(r, r.fresh, `${t('cal.new')} · ${dayLabel(r.fresh.d)}`, 'ok'));
  a.upcoming.forEach(r => push(r, r.next, dayLabel(r.next.d), ''));
  a.behind.forEach(r => push(r, null, `${r.behind} ${tn('episode', r.behind)} ${t('cal.waiting')}`, 'warn'));
  return out;
}
// Смужка на головній: до чотирьох найближчих подій.
export function agendaStrip() {
  const a = getAgenda(), items = agendaItems(a).slice(0, 4);
  if (!items.length) return '';
  // якщо нового немає, а є лише недодивлене — так і називаємо
  return `<section class="agenda"><header><h2>${t(a.fresh.length || a.upcoming.length ? 'cal.title' : 'cal.behind')}</h2><a class="more" href="#/calendar">${t('nav.calendar')} ${icon('chevR')}</a></header>
    <div class="agenda-row">${items.map(({ r, v, label, cls }) => `
      <div class="ag" data-id="${r.e.id}" data-act="open" tabindex="0">${ph(r.e.id, r.e.title, 'small')}
        <div class="ag-main"><b>${esc(r.e.title)}</b><span>${v ? esc(epLabel(v)) : esc(t('cal.catchup'))}</span>
        <em class="badge static ${cls}">${esc(label)}</em></div></div>`).join('')}</div></section>`;
}

export function renderCalendar() {
  ensureSchedules(() => { if ($('#cal-body')) renderCalendar(); });
  const a = getAgenda(), n = watchingIds().length;
  const row = (r, v, label, cls) => `<li class="row" data-id="${r.e.id}" data-act="open" tabindex="0">${ph(r.e.id, r.e.title, 'small')}
    <div class="row-main"><div class="row-title"><b>${esc(r.e.title)}</b></div>
      <div class="row-sub">${v ? esc(epLabel(v)) : ''}${v && r.behind > 1 ? ' · ' : ''}${r.behind > 1 || !v ? `${r.behind} ${tn('episode', r.behind)} ${t('cal.waiting')}` : ''}</div></div>
    <div class="row-act">${r.behind > 0 ? `<button class="rb" data-act="plus" title="${t('next.ep')}">+1</button>` : ''}</div>
    <div class="when"><em class="badge static ${cls}">${esc(label)}</em></div></li>`;
  const group = (title, rows) => (rows.length ? `<h2 class="cal-h">${title}<small>${rows.length}</small></h2><ul class="list">${rows.join('')}</ul>` : '');
  const body = group(t('cal.fresh'), a.fresh.map(r => row(r, r.fresh, dayLabel(r.fresh.d), 'ok')))
    + group(t('cal.upcoming'), a.upcoming.map(r => row({ ...r, behind: 0 }, r.next, dayLabel(r.next.d), '')))
    + group(t('cal.behind'), a.behind.map(r => row(r, null, t('cal.catchup'), 'warn')));
  app.innerHTML = `<header class="page-head"><h1>${t('nav.calendar')}</h1><span class="count">${t('cal.sub', { n: `${n} ${tn('title', n)}` })}</span></header>
    <div id="cal-body">${body || (cal.loading
      ? `<div class="empty"><b>${t('cal.loading')}</b></div>`
      : `<div class="empty">${icon('calendar')}<b>${t('cal.empty.title')}</b><p>${n ? t('cal.empty.quiet') : t('cal.empty.text')}</p>
          <a class="btn" href="#/library">${icon('library')}${t('nav.library')}</a></div>`)}</div>`;
}

// ── що подивитись сьогодні ────────────────────────────────────────
export function openPick() {
  showOverlay({ type: 'pick', f: { max: 0, kind: 'all', genre: '' }, seen: [], cur: null, count: 0 },
    `<div class="palette narrow" role="dialog" aria-label="${t('pick.title')}"></div>`);
  rollPick();
}
function rollPick() {
  const o = ui.overlay, all = pickCandidates(store.list(), o.f);
  let pool = all.filter(e => !o.seen.includes(e.id));
  if (!pool.length) { o.seen = []; pool = all; }   // усе показали — починаємо коло знову
  o.cur = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  if (o.cur) o.seen.push(o.cur.id);
  o.count = all.length;
  drawPick();
}
function drawPick() {
  const o = ui.overlay, e = o.cur, f = o.f;
  const base = pickCandidates(store.list(), {});
  const genres = insights(base).genres.slice(0, 6).map(g => g[0]);
  const chip = (k, v, label) => `<button class="chip ${String(f[k]) === String(v) ? 'on' : ''}" data-act="pick-set" data-v="${k}:${esc(v)}">${esc(label)}</button>`;
  const url = e ? safeUrl(e.url) : '';
  $('.palette', layer).innerHTML = `
    <div class="pal-head"><h2>${t('pick.title')}</h2><button class="rb" data-act="close" aria-label="${t('close')}">${icon('close')}</button></div>
    <div class="share">
      <div class="pick-f">
        <div>${chip('max', 0, t('pick.any.time'))}${[30, 60, 120].map(m => chip('max', m, t('pick.upto', { n: fmtRuntime(m) }))).join('')}</div>
        <div>${chip('kind', 'all', t('all.kinds'))}${KIND_IDS.map(k => chip('kind', k, t('kinds.' + k))).join('')}</div>
        ${genres.length ? `<div>${chip('genre', '', t('all.genres'))}${genres.map(g => chip('genre', g, genreName(g))).join('')}</div>` : ''}
      </div>
      ${e ? `<div class="pick-res" data-id="${e.id}">${ph(e.id, e.title, 'medium', 'lg')}
          <div><span class="muted small">${t('pick.from', { n: o.count })}</span><h3>${esc(e.title)}</h3>
            <p class="sub">${esc([kindLabel(e.kind), e.year, fmtRuntime(e.meta?.runtime)].filter(Boolean).join(' · '))}${e.meta?.imdb ? ` · IMDb ${fmtRating(e.meta.imdb)}` : ''}</p>
            ${e.meta?.plot ? `<p class="plot clamp">${esc(e.meta.plot)}</p>` : ''}</div></div>
        <div class="hero-act">
          ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('play')}${t('watch')}</a>` : ''}
          <button class="btn ${url ? '' : 'primary'}" data-act="pick-start">${icon('check')}${t('pick.start')}</button>
          ${o.count > 1 ? `<button class="btn" data-act="pick-again">${icon('refresh')}${t('pick.again')}</button>` : ''}
        </div>`
      : `<div class="empty small">${icon('dice')}<b>${base.length ? t('pick.none.filter') : t('pick.none')}</b>
          <p>${base.length ? t('pick.none.filter.text') : t('pick.none.text')}</p>
          ${base.length ? '' : `<a class="btn" href="#/discover">${icon('compass')}${t('open.catalog')}</a>`}</div>`}
    </div>`;
}
export const pickActions = {
  tonight: openPick,
  'pick-set': v => { const i = v.indexOf(':'), k = v.slice(0, i), val = v.slice(i + 1); ui.overlay.f[k] = k === 'max' ? +val : val; ui.overlay.seen = []; rollPick(); },
  'pick-again': rollPick,
  'pick-start': () => { const id = ui.overlay.cur.id; closeOverlay(); store.save(id, { status: 'watching' }); openCard(id); },
};

// ── збіг смаків ───────────────────────────────────────────────────
// Повертає панель для сторінки рекомендацій і підпис для кожного тайтла.
export function taste(items) {
  const m = tasteMatch(store.list(), items);
  const tags = new Map(m.rows.map(r => [r.x.id, { tag: matchTag(r), mine: r.mine }]));
  if (!store.list().length || !items.length) return { panel: '', tags };
  const panel = `<section class="taste">
    ${m.pct !== null ? `<div class="taste-pct"><b>${m.pct}%</b><small>${t('taste.match')}</small></div>` : ''}
    <div><b>${m.pct === null ? t('taste.none') : m.pct >= 75 ? t('taste.high') : m.pct >= 50 ? t('taste.mid') : t('taste.low')}</b>
      <p>${t('taste.line', { a: m.common, b: m.unseen })}${m.scored ? ' ' + t('taste.scored', { n: m.scored }) : ''}</p></div></section>`;
  return { panel, tags };
}
export const tasteBadge = info => {
  if (!info) return '';
  const label = { match: t('taste.tag.match'), differ: t('taste.tag.differ'), new: t('taste.tag.new'), have: '' }[info.tag];
  if (!label) return '';
  return `<span class="badge static ${{ match: 'ok', differ: 'warn', new: 'add' }[info.tag]}">${label}${info.mine ? ` · ${t('taste.mine', { n: info.mine })}` : ''}</span>`;
};

// ── картка-підсумок ───────────────────────────────────────────────
export async function openWrapped() {
  if (!store.list().length) return toast(t('wrap.empty'));
  showOverlay({ type: 'wrap' }, `<div class="palette narrow" role="dialog" aria-label="${t('wrap.title')}">
    <div class="pal-head"><h2>${t('wrap.title')}</h2><button class="rb" data-act="close" aria-label="${t('close')}">${icon('close')}</button></div>
    <div class="share"><canvas id="wrap-cv" width="1080" height="1350" aria-label="${t('wrap.title')}"></canvas>
      <div class="hero-act"><button class="btn primary" data-act="wrap-save">${icon('download')}${t('wrap.save')}</button>
        ${navigator.canShare ? `<button class="btn" data-act="wrap-share">${icon('share')}${t('send')}</button>` : ''}</div>
      <p class="muted small">${t('wrap.note')}</p></div></div>`);
  try { await document.fonts?.ready; } catch { /* намалюємо запасним шрифтом */ }
  if (ui.overlay?.type === 'wrap') drawWrapped($('#wrap-cv'));
}
function drawWrapped(cv) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const s = insights(store.list()), hours = Math.round(s.minutes / 60);
  const font = (w, px) => { c.font = `${w} ${px}px Manrope, "Segoe UI", system-ui, sans-serif`; };
  const fit = (text, max) => { let x = String(text); while (x.length > 3 && c.measureText(x).width > max) x = x.slice(0, -2).trimEnd() + '…'; return x; };
  c.fillStyle = '#0A0C0B'; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * .85, 120, 40, W * .85, 120, 900);
  g.addColorStop(0, 'rgba(61,214,181,.34)'); g.addColorStop(1, 'rgba(61,214,181,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // знак і назва
  c.fillStyle = '#3DD6B5'; c.beginPath(); c.roundRect(80, 84, 96, 72, 20); c.fill();
  c.fillStyle = '#0A0C0B'; c.beginPath(); c.moveTo(118, 100); c.lineTo(118, 140); c.lineTo(150, 120); c.closePath(); c.fill();
  c.fillStyle = '#EEF2EF'; font(800, 52); c.textBaseline = 'middle'; c.fillText(t('brand'), 200, 122);
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#3DD6B5'; font(800, 30); c.fillText(t('wrap.kicker').toUpperCase(), 80, 300);
  c.fillStyle = '#EEF2EF'; font(800, 230); c.fillText(String(hours), 72, 520);
  const hw = c.measureText(String(hours)).width;
  c.fillStyle = '#9BA5A0'; font(700, 64); c.fillText(t('wrap.hours'), 72 + hw + 28, 520);
  font(600, 38); c.fillText(hours >= 48 ? t('tile.days', { d: fmtRating(hours / 24) }) : t('tile.start'), 80, 590);
  // три числа
  const cols = [[String(s.episodes), t('tile.episodes')], [String(s.total), tn('title', s.total)], [fmtRating(s.avg) || '—', t('tile.avg')]];
  cols.forEach(([n, l], i) => {
    const x = 80 + i * 320;
    c.fillStyle = '#151918'; c.beginPath(); c.roundRect(x, 660, 290, 190, 28); c.fill();
    c.fillStyle = '#EEF2EF'; font(800, 84); c.fillText(n, x + 30, 760);
    c.fillStyle = '#9BA5A0'; font(600, 30); c.fillText(fit(l, 240), x + 30, 812);
  });
  // топ за оцінкою
  const top = store.list().filter(e => e.score > 0).sort((a, b) => b.score - a.score || (b.updated || 0) - (a.updated || 0)).slice(0, 3);
  c.fillStyle = '#6A7470'; font(800, 28); c.fillText(t('wrap.top').toUpperCase(), 80, 930);
  top.forEach((e, i) => {
    const y = 995 + i * 72;
    c.fillStyle = '#F2B84B'; font(800, 44); c.fillText(fmtScore(e.score), 80, y);
    c.fillStyle = '#EEF2EF'; font(700, 44); c.fillText(fit(e.title, 860), 150, y);
  });
  if (!top.length) { c.fillStyle = '#9BA5A0'; font(600, 36); c.fillText(t('score.none'), 80, 995); }
  c.fillStyle = '#9BA5A0'; font(600, 32);
  if (s.genres[0]) c.fillText(`${t('wrap.genre')}: ${genreName(s.genres[0][0])}`, 80, 1238);
  c.fillStyle = '#6A7470'; font(600, 28);
  c.fillText(`${new Intl.DateTimeFormat(getLang(), { month: 'long', year: 'numeric' }).format(new Date())} · ${location.host}`, 80, 1290);
}
const wrapBlob = () => new Promise(res => $('#wrap-cv').toBlob(res, 'image/png'));
export const wrapActions = {
  wrapped: openWrapped,
  'wrap-save': async () => {
    const url = URL.createObjectURL(await wrapBlob());
    Object.assign(document.createElement('a'), { href: url, download: 'ovion-stats.png' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(t('wrap.saved'));
  },
  'wrap-share': async () => {
    const file = new File([await wrapBlob()], 'ovion-stats.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) navigator.share({ files: [file], title: t('wrap.title') }).catch(() => {});
    else toast(t('wrap.noshare'));
  },
};
