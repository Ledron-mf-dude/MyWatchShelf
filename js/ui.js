// Спільне для всіх екранів: іконки, постери, повідомлення, діалоги,
// шар поверх сторінки та реєстр дій (data-act → функція).
import { esc, poster, isId } from './logic.js';
import { t } from './i18n.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const app = $('#app'), layer = $('#layer');

// ── іконки ────────────────────────────────────────────────────────
const I = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>',
  starFill: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  library: '<rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="m16.5 6.5 3.3 12.8"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M11 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-5"/>',
  chevL: '<path d="m14.5 6-6 6 6 6"/>',
  chevR: '<path d="m9.5 6 6 6-6 6"/>',
  chevD: '<path d="m6 9.5 6 6 6-6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sortDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  sortUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.200 1.900 7 5.500"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>',
  clock: '<circle cx="12" cy="12" r="8.500"/><path d="M12 7.500V12l3 2"/>',
  film: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  logout: '<path d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h9"/>',
  globe: '<circle cx="12" cy="12" r="8.500"/><path d="M3.500 12h17M12 3.500c2.500 2.300 3.800 5.200 3.800 8.500s-1.300 6.200-3.800 8.500c-2.500-2.300-3.800-5.200-3.800-8.500s1.300-6.200 3.800-8.500z"/>',
  calendar: '<rect x="4" y="5.500" width="16" height="14.500" rx="2"/><path d="M4 10h16M8.500 3.500v4M15.500 3.500v4"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.500"/><circle cx="9" cy="9" r="1.100" fill="currentColor"/><circle cx="15" cy="15" r="1.100" fill="currentColor"/><circle cx="15" cy="9" r="1.100" fill="currentColor"/><circle cx="9" cy="15" r="1.100" fill="currentColor"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.500"/><path d="m5 17 4.500-4 3.500 3 2.500-2 3.500 3"/>',
  folder: '<path d="M4 7.500a1.500 1.500 0 0 1 1.500-1.500h4l2 2h7a1.500 1.500 0 0 1 1.500 1.500v8a1.500 1.500 0 0 1-1.500 1.500h-13a1.500 1.500 0 0 1-1.500-1.500z"/>',
  sparkle: '<path d="M12 4l1.800 5.200L19 11l-5.200 1.800L12 18l-1.800-5.200L5 11l5.200-1.800z"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`;

// ── постер із запасним виглядом ───────────────────────────────────
const initials = t => esc(String(t || '?').trim().slice(0, 2).toUpperCase());
export const ph = (id, title, size = 'medium', cls = '') =>
  `<span class="ph ${cls}"><em>${initials(title)}</em>${isId(id) ? `<img loading="lazy" decoding="async" alt="" src="${poster(id, size)}">` : ''}</span>`;
document.addEventListener('error', e => {
  if (e.target.tagName === 'IMG') (e.target.closest('.ph') || e.target.closest('[data-img]'))?.classList.add('noimg');
}, true);

// ── власний випадаючий список ─────────────────────────────────────
// Системний <select> не оформлюється — малюємо свій: кнопка зі значенням
// і список варіантів. options: [[значення, підпис], …]. Що робити з
// вибором, каже таблиця selects (за id).
export const selects = {};
export function dropdown(id, value, options, ic, aria) {
  const is = v => String(v) === String(value);
  const cur = options.find(o => is(o[0])) || options[0];
  return `<div class="dd sel" data-sel="${id}">
    <button class="field selbtn" data-act="sel-toggle" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(aria)}: ${esc(cur[1])}">${icon(ic)}<span>${esc(cur[1])}</span>${icon('chevD', 'caret')}</button>
    <div class="pop options" role="listbox" aria-label="${esc(aria)}" hidden>${options.map(([v, l]) =>
      `<button role="option" aria-selected="${is(v)}" class="${is(v) ? 'on' : ''}" data-act="sel-pick" data-v="${esc(v)}"><span>${esc(l)}</span>${is(v) ? icon('check') : ''}</button>`).join('')}</div>
  </div>`;
}

// ── повідомлення внизу екрана, за потреби з дією («Скасувати») ───
let toastTimer;
export function toast(text, { ms = 2800, label = '', action = null } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${label ? `<button type="button">${esc(label)}</button>` : ''}`;
  if (label) $('button', t).onclick = () => { t.classList.remove('on'); action?.(); };
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), label ? Math.max(ms, 6000) : ms);
}

// ── реєстр дій ────────────────────────────────────────────────────
export const actions = {};
export const on = map => Object.assign(actions, map);

// Записи з каталогу й чужих рекомендацій, які зараз на екрані: за ID
// з data-id дістаємо повний запис, не зашиваючи його в розмітку.
const seen = new Map();
export const remember = item => { if (item?.id) seen.set(item.id, item); return item; };
export const recall = id => seen.get(id);

// ── шар поверх сторінки (картка, пошук, діалог поширення) ────────
export const ui = { overlay: null, dirty: false, afterClose: null, cardExtra: null };
export function showOverlay(o, html) {
  ui.overlay?.onClose?.();
  ui.overlay?.abort?.abort();
  ui.overlay = o;
  layer.innerHTML = `<div class="scrim" data-act="close"></div>${html}`;
  document.documentElement.classList.add('locked');
}
export function closeOverlay() {
  if (!ui.overlay) return;
  ui.overlay.onClose?.();
  ui.overlay.abort?.abort();
  ui.overlay = null;
  layer.innerHTML = '';
  document.documentElement.classList.remove('locked');
  ui.afterClose?.();
}

// ── власні діалоги замість confirm()/prompt() ─────────────────────
function modal(html, resolveWith) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal-wrap';
    box.innerHTML = `<div class="scrim"></div><div class="modal" role="alertdialog" aria-modal="true">${html}</div>`;
    document.body.append(box);
    const done = v => { box.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); done(resolveWith(box, false)); }
      if (e.key === 'Enter' && !e.target.matches('textarea')) { e.preventDefault(); e.stopPropagation(); done(resolveWith(box, true)); }
    };
    document.addEventListener('keydown', key, true);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-ok],[data-cancel]');
      if (b) done(resolveWith(box, b.hasAttribute('data-ok')));
      else if (e.target.classList.contains('scrim')) done(resolveWith(box, false));
      e.stopPropagation();
    });
    (box.querySelector('input') || box.querySelector('[data-ok]')).focus();
  });
}
export const confirmBox = ({ title, text = '', ok = 'OK', danger = false }) => modal(`
  <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
  <div class="modal-act"><button class="btn" data-cancel>${t('cancel')}</button>
  <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ok>${esc(ok)}</button></div>`, (_, yes) => yes);
export const promptBox = ({ title, text = '', value = '', placeholder = '', ok = t('save') }) => modal(`
  <h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
  <input class="inp" maxlength="80" value="${esc(value)}" placeholder="${esc(placeholder)}">
  <div class="modal-act"><button class="btn" data-cancel>${t('cancel')}</button>
  <button class="btn primary" data-ok>${esc(ok)}</button></div>`, (box, yes) => (yes ? box.querySelector('input').value.trim() : null));
