// Розділ «Рекомендації»: усе, чим власник ділиться, — загальні рекомендації
// й добірки — на одному екрані, з кнопкою створити нову добірку.
import { esc, listNames } from './logic.js';
import { t, tn } from './i18n.js';
import { store } from './store.js';
import { listdefs, defId } from './synced.js';
import { listDiff } from './social.js';
import { cloud } from './cloud.js';
import { app, icon, ph, toast, confirmBox } from './ui.js';
import { sharePool, shareLink, openShare, filterText, condDef } from './panel.js';

function listCard(name, rows, all) {
  const cond = condDef(name);
  // добірка за умовами застаріла, коли полиця вже розійшлася з умовами
  const d = cond ? listDiff(all, name, cond.f, cond) : null, stale = d && (d.add.length || d.drop.length);
  // додане рукою поверх умов — щоб було видно, чому в добірці є не лише відповідне умовам
  const hand = cond ? rows.filter(e => (cond.plus || []).includes(e.id)).length : 0;
  const top = [...rows].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
  const v = esc(name);
  return `<article class="sh-card">
    <header><h2>${name ? icon('folder') + v : icon('starFill') + t('share.title')}</h2><span class="count">${rows.length} ${tn('title', rows.length)}</span></header>
    ${rows.length
    ? `<div class="share-strip">${top.map(e => ph(e.id, e.title, 'small', '', true)).join('')}${rows.length > 6 ? `<span class="morecount">+${rows.length - 6}</span>` : ''}</div>`
    : `<p class="muted small">${t('sh.general.empty')}</p>`}
    ${name ? `<p class="muted small">${cond ? `${icon('filter')} ${esc(filterText(cond.f))}${hand ? ` · ${t('sh.hand', { n: hand })}` : ''}` : t('sh.manual')}${stale ? ` <span class="badge static warn">${t('sh.stale', { a: d.add.length, d: d.drop.length })}</span>` : ''}</p>` : rows.length ? `<p class="muted small">${t('sh.general.text')}</p>` : ''}
    ${rows.length ? `<div class="hero-act">
      <button class="btn primary" data-act="sh-copy" data-v="${v}">${icon('link')}${t('copy')}</button>
      <button class="btn" data-act="share-list" data-v="${v}">${icon('share')}${t('sh.share')}</button>
      ${name ? `<button class="btn" data-act="list-edit" data-v="${v}">${icon('filter')}${t('edit')}</button>` : ''}
      ${cond ? `<button class="btn" data-act="list-rebuild" data-v="${v}">${icon('refresh')}${t('rebuild.btn')}</button>` : ''}
      ${name ? `<button class="btn ghost" data-act="sh-drop" data-v="${v}" aria-label="${t('sh.drop')}: ${v}" title="${t('sh.drop')}">${icon('trash')}</button>` : ''}
    </div>` : ''}
  </article>`;
}

export function renderShare() {
  const all = store.list(), names = listNames(all), general = sharePool(all, '');
  const head = `<header class="page-head"><h1>${t('nav.share')}</h1><span class="count">${names.length} ${tn('coll', names.length)}</span>
    <span class="grow"></span><button class="btn primary" data-act="list-build">${icon('plus')}${t('list.new')}</button></header>`;
  if (!names.length && !general.length) {
    app.innerHTML = `${head}<div class="empty">${icon('share')}<b>${t('sh.empty.title')}</b><p>${t('sh.empty.text')}</p>
      <button class="btn primary" data-act="list-build">${icon('plus')}${t('list.new')}</button></div>`;
    return;
  }
  app.innerHTML = `${head}<p class="muted sh-note">${t('sh.note')}</p>
    <div class="sh-grid">${listCard('', general, all)}${names.map(n => listCard(n, sharePool(all, n), all)).join('')}</div>`;
}

export const shareActions = {
  'sh-copy': async v => {
    const sl = await shareLink(v);
    if (!sl) return toast(t('share.none'), { ms: 4200 });
    try { await navigator.clipboard.writeText(sl.link); toast(t(sl.live ? 'toast.copied' : 'sh.copied.snap'), { ms: sl.live ? 2800 : 4500 }); }
    // буфер недоступний — показуємо посилання в діалозі й кажемо, що з ним робити
    catch { await openShare(v); toast(t('sh.copy.manual'), { ms: 5000 }); }
  },
  // Добірка — це мітка на записах: знімаємо її, самі записи лишаються на полиці.
  'sh-drop': async v => {
    const rows = sharePool(store.list(), v);
    if (!await confirmBox({ title: t('sh.drop.title', { name: v }), text: t(cloud.user ? 'sh.drop.text' : 'sh.drop.text.snap', { n: rows.length }), ok: t('sh.drop'), danger: true })) return;
    for (const e of rows) { const c = store.get(e.id); if (c) store.save(c.id, { lists: (c.lists || []).filter(l => l !== v) }); }
    if (listdefs.get(defId(v))) listdefs.remove(defId(v));
    toast(t('sh.dropped', { name: v }));
  },
};
