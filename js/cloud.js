// Хмара: вхід через Google і синхронізація у Firestore. Свого сервера
// немає — сторінка говорить із Firebase напряму, а хто що може читати й
// писати, вирішують правила (firestore.rules): кожен — лише своє.
//
//   users/{uid}/entries/{imdbId}  — приватний список людини
//   public/{uid}                  — її рекомендації, читати може будь-хто
import { FIREBASE, GOOGLE_CLIENT_ID, SITE_URL } from './config.js';
import { store } from './store.js';
import { friends, listdefs, prefs, socialCache } from './synced.js';
import { recItem, cleanRecs } from './logic.js';
import { cleanReply, returnHash, isUid, replyDoc } from './social.js';
import { t, getLang } from './i18n.js';

const V = '10.14.1', CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const RETURN = 'mws.returnTo', FLAG = 'mws.signedIn', OWNER = 'mws.owner', PUBLISHED = 'mws.published', STATE = 'mws.oauthState';

let signingIn = false, sdkPromise = null, unsub = null, unsubs = [], pubTimer = null, lastPub = '';
const subs = new Set();

export const cloud = {
  available: !!FIREBASE,
  user: null,          // { uid, name, email }
  state: 'off',        // off | connecting | synced | offline | error
  onChange(fn) { subs.add(fn); },
  init, signIn, signOut, loadPublic, publishNow,
  sendReply, loadReply, loadReplies, watchReplies, deleteReply,
};

function set(state) { cloud.state = state; subs.forEach(fn => fn()); }

// SDK важить чимало, тож вантажимо його лише тим, кому він потрібен:
// хто входив раніше, хто тисне «Увійти», хто відкрив чужі рекомендації.
function sdk() {
  if (!FIREBASE) return Promise.reject(new Error(t('err.nocloud')));
  sdkPromise ??= Promise.all([
    import(CDN + 'firebase-app.js'),
    import(CDN + 'firebase-auth.js'),
    import(CDN + 'firebase-firestore.js'),
  ]).then(([a, au, fs]) => {
    const app = a.initializeApp(FIREBASE);
    const ctx = { au, fs, auth: au.getAuth(app), db: fs.getFirestore(app) };
    au.onAuthStateChanged(ctx.auth, u => onUser(ctx, u));
    return ctx;
  });
  sdkPromise.catch(() => { sdkPromise = null; });
  return sdkPromise;
}

// Вхід — звичайним переходом сторінки до Google і назад, без спливних
// вікон: їх блокують телефони й застосунки з головного екрана, а
// вбудований у Firebase «redirect» не працює, коли сайт і вікно входу
// живуть на різних доменах. Google повертає підписаний id_token у хвості
// адреси; його й віддаємо Firebase.
function takeReturn() {
  const h = location.hash.slice(1);
  if (!/(^|&)(id_token|error)=/.test(h) || !/(^|&)state=/.test(h)) return null;
  const p = new URLSearchParams(h);
  // Токену в адресі не місце; натомість повертаємо адресу списку, з якого
  // людина натиснула «Увійти» (вона лежала у сховищі, тож перевіряємо ще раз).
  let back = '';
  try { back = returnHash(localStorage.getItem(RETURN)); localStorage.removeItem(RETURN); } catch { /* нічого */ }
  history.replaceState(null, '', location.pathname + location.search + back);
  // state — наш одноразовий квиток: чужий токен, підсунутий посиланням, не пройде.
  // Лежить і в сховищі, і в cookie: встановлений на телефон застосунок
  // відкриває вхід в окремій вкладці, і одне з двох може туди не доїхати.
  const expected = new Set();
  try { expected.add(localStorage.getItem(STATE)); localStorage.removeItem(STATE); } catch { /* нічого */ }
  expected.add(document.cookie.match(/(?:^|; )mws_state=([0-9a-f]{32})/)?.[1]);
  document.cookie = 'mws_state=; Max-Age=0; Path=/; Secure; SameSite=Lax';
  expected.delete(null); expected.delete(undefined); expected.delete('');
  if (!expected.has(p.get('state'))) return { error: 'state' };
  return p.get('id_token') ? { token: p.get('id_token') } : { error: p.get('error') || 'unknown' };
}

function init() {
  if (!FIREBASE) return;
  const back = takeReturn();
  let was = false;
  try { was = !!localStorage.getItem(FLAG); } catch { /* нічого */ }
  if (back?.token) {
    cloud.justSignedIn = true;
    set('connecting');
    signingIn = true;
    sdk().then(c => c.au.signInWithCredential(c.auth, c.au.GoogleAuthProvider.credential(back.token)))
      .catch(e => { console.warn('вхід', e); cloud.lastError = e?.code || 'sign-in'; signingIn = false; set('error'); });
  } else if (back?.error && back.error !== 'access_denied') {
    cloud.lastError = back.error;
  }
  if (was && !back?.token) { set('connecting'); sdk().catch(() => set('offline')); }
  store.onLocal((entry, what) => {
    if (!cloud.user) return;
    if (what === 'meta') pushMeta(entry); else push(entry);
    schedulePublish();
  });
  for (const [name, s] of SYNCED) s.onLocal(rec => { if (cloud.user) pushRec(name, rec); });
  prefs.onLocal(() => { if (cloud.user) schedulePublish(); });   // «open» живе в публічному документі
  // Увійти могли в іншій вкладці (так буває в застосунку з головного
  // екрана): повернувшись сюди, підхоплюємо вже наявний вхід.
  const wake = () => {
    let was2 = false;
    try { was2 = !!localStorage.getItem(FLAG); } catch { /* нічого */ }
    if (was2 && !cloud.user && !sdkPromise) { set('connecting'); sdk().catch(() => set('offline')); }
  };
  addEventListener('storage', e => { if (e.key === FLAG) wake(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  addEventListener('pageshow', wake);
  addEventListener('online', () => cloud.user && set('synced'));
  addEventListener('offline', () => cloud.user && set('offline'));
}

const ref = (c, id) => c.fs.doc(c.db, 'users', cloud.user.uid, 'entries', id);
const plain = x => JSON.parse(JSON.stringify(x));

async function push(entry) {
  try { const c = await sdk(); await c.fs.setDoc(ref(c, entry.id), plain(entry)); }
  catch (e) { console.warn('не записалось у хмару', e); set('error'); }
}
// друзі, фільтри добірок і налаштування — колекції поруч з entries
const SYNCED = [['friends', friends], ['listdefs', listdefs], ['prefs', prefs]];
async function pushRec(name, rec) {
  try { const c = await sdk(); await c.fs.setDoc(c.fs.doc(c.db, 'users', cloud.user.uid, name, rec.id), plain(rec)); }
  catch (e) { console.warn('не записалось у хмару', e); set('error'); }
}
async function pushMeta(entry) {
  try {
    const c = await sdk();
    await c.fs.updateDoc(ref(c, entry.id), plain({ meta: entry.meta, metaAt: entry.metaAt }));
  } catch { /* запису в хмарі ще немає — приїде повним записом */ }
}

function onUser(c, u) {
  unsub?.(); unsub = null;
  unsubs.forEach(f => f()); unsubs = [];
  if (!u) {
    // Поки токен від Google ще обмінюється на вхід, Firebase встигає
    // сказати «нікого немає» — це не привід показувати «Увійти».
    if (signingIn) return;
    cloud.user = null;
    try { localStorage.removeItem(FLAG); } catch { /* нічого */ }
    return set('off');
  }
  signingIn = false;
  cloud.user = { uid: u.uid, name: u.displayName || '', email: u.email || '' };
  // Чий список лежить на пристрої. Накопичене без входу віддаємо першому,
  // хто ввійде; а от список іншого акаунта чужому не дістається — його
  // прибираємо (він і так цілий у хмарі власника).
  let owner = '';
  try { owner = localStorage.getItem(OWNER) || ''; } catch { /* нічого */ }
  if (owner && owner !== u.uid) {
    store.clear();
    store.setSetting('name', '');   // підпис рекомендацій теж був чужий
    SYNCED.forEach(([, s]) => s.clear());
    socialCache.clear();   // відповіді й рекомендації друзів теж чужі
    try { localStorage.removeItem(PUBLISHED); } catch { /* нічого */ }
  }
  lastPub = '';
  try { localStorage.setItem(OWNER, u.uid); localStorage.setItem(FLAG, '1'); } catch { /* нічого */ }
  set('connecting');
  let first = true;
  unsub = c.fs.onSnapshot(c.fs.collection(c.db, 'users', u.uid, 'entries'), snap => {
    const incoming = [];
    snap.docChanges().forEach(ch => { if (ch.type !== 'removed') incoming.push(ch.doc.data()); });
    // зміна приїхала з іншого пристрою — рекомендації могли змінитись теж
    if (store.applyRemote(incoming) && !first) schedulePublish();
    if (first) {
      // Перша зустріч: усе, що на пристрої свіжіше або чого в хмарі
      // немає (накопичене без входу чи без мережі), віддаємо нагору.
      first = false;
      const remote = new Map(snap.docs.map(d => [d.id, d.data()]));
      for (const e of store.raw()) {
        const r = remote.get(e.id);
        if (!r || (e.updated || 0) > (r.updated || 0)) push(e);
        else if (!e.deleted && (e.metaAt || 0) > (r.metaAt || 0)) pushMeta(e);
      }
      schedulePublish();
    }
    set(navigator.onLine === false ? 'offline' : 'synced');
  }, err => { console.warn('синхронізація', err); set('error'); });
  // ті самі правила для друзів, фільтрів добірок і налаштувань
  for (const [name, s] of SYNCED) {
    let firstRec = true;
    unsubs.push(c.fs.onSnapshot(c.fs.collection(c.db, 'users', u.uid, name), snap => {
      const incoming = [];
      snap.docChanges().forEach(ch => { if (ch.type !== 'removed') incoming.push(ch.doc.data()); });
      s.applyRemote(incoming);
      if (firstRec) {
        firstRec = false;
        const remote = new Map(snap.docs.map(d => [d.id, d.data()]));
        for (const e of s.raw()) {
          const r = remote.get(e.id);
          if (!r || (e.updated || 0) > (r.updated || 0)) pushRec(name, e);
        }
      }
    }, err => console.warn('синхронізація', name, err)));
  }
}

function signIn() {
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const state = rnd();
  try { localStorage.setItem(STATE, state); } catch { throw new Error(t('err.private')); }
  try { localStorage.setItem(RETURN, returnHash(location.hash)); } catch { /* нічого */ }
  document.cookie = `mws_state=${state}; Max-Age=900; Path=/; Secure; SameSite=Lax`;
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: location.origin === new URL(SITE_URL).origin ? SITE_URL : location.origin + location.pathname,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: rnd(),
    state,
    prompt: 'select_account',
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q);
}
async function signOut() {
  const c = await sdk();
  await c.au.signOut(c.auth);
}

function recsPayload() {
  // у публічний документ ідуть рекомендації й усе, що в добірках
  const items = store.list().filter(e => e.rec || e.lists?.length)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title, getLang()))
    .map(recItem);
  // Підпис — лише той, що людина вписала сама; ім'я з Google-акаунта
  // без її волі в публічний документ не потрапляє.
  const payload = { name: store.settings.name || '', items };
  // Оцінки друзям відкриті лише за згодою власника (prefs.social.open).
  if (prefs.get('social')?.open) payload.open = true;
  return payload;
}
const wasPublished = () => { try { return localStorage.getItem(PUBLISHED) === cloud.user?.uid; } catch { return false; } };
function schedulePublish() {
  clearTimeout(pubTimer);
  pubTimer = setTimeout(() => publishNow().catch(() => {}), 1500);
}
// Рекомендації лежать окремим публічним документом: щоб показати їх
// гостю, не треба відкривати йому весь список.
async function publishNow() {
  if (!cloud.user) return false;
  clearTimeout(pubTimer);
  const payload = recsPayload(), sig = JSON.stringify(payload);
  if (sig === lastPub) return true;
  // Публічний документ з'являється лише тоді, коли людина сама щось
  // порадила; далі оновлюємо його, щоб прибране зникало й у гостей.
  if (!payload.items.length && !wasPublished()) return false;
  const c = await sdk();
  await c.fs.setDoc(c.fs.doc(c.db, 'public', cloud.user.uid), { ...payload, updated: Date.now() });
  lastPub = sig;
  try { localStorage.setItem(PUBLISHED, cloud.user.uid); } catch { /* нічого */ }
  return true;
}
async function loadPublic(uid) {
  const c = await sdk();
  const snap = await c.fs.getDoc(c.fs.doc(c.db, 'public', uid));
  return snap.exists() ? cleanRecs(snap.data()) : null;
}

// ── відповіді друзів: public/{власник}/replies/{друг} ──────────────
// uid потрапляє в шлях Firestore: пропускаємо лише звичайні ідентифікатори.
const needUid = (...u) => { if (!u.every(isUid)) throw new Error('uid'); };
const replyRef = (c, owner, friend) => c.fs.doc(c.db, 'public', owner, 'replies', friend);
async function sendReply(ownerUid, reply) {
  if (!cloud.user) throw new Error(t('err.nocloud'));
  needUid(ownerUid, cloud.user.uid);
  // Підпис — завжди той, що людина вписала сама (як у рекомендаціях): ні ім'я
  // з Google-акаунта, ні надіслане викликачем у відповідь не потрапляє.
  const c = await sdk(), doc = replyDoc(reply, store.settings.name, Date.now());
  await c.fs.setDoc(replyRef(c, ownerUid, cloud.user.uid), plain(doc));
}
async function loadReply(ownerUid, friendUid) {
  needUid(ownerUid, friendUid);
  const c = await sdk(), snap = await c.fs.getDoc(replyRef(c, ownerUid, friendUid));
  return snap.exists() ? cleanReply(snap.data()) : null;
}
async function loadReplies(ownerUid) {
  needUid(ownerUid);
  const c = await sdk(), snap = await c.fs.getDocs(c.fs.collection(c.db, 'public', ownerUid, 'replies'));
  return Object.fromEntries(snap.docs.map(d => [d.id, cleanReply(d.data())]));
}
// Стежить за відповідями на список поточного користувача; повертає відписку.
function watchReplies(cb) {
  let off = null, stopped = false;
  sdk().then(c => {
    if (stopped || !cloud.user) return;
    // Знімок із кешу пропускаємо: без мережі Firestore віддає порожній, і він
    // стер би вже отримані відповіді. Зміни метаданих слухаємо, щоб після
    // повернення мережі прийшов серверний знімок, навіть коли документи ті самі.
    off = c.fs.onSnapshot(c.fs.collection(c.db, 'public', cloud.user.uid, 'replies'), { includeMetadataChanges: true },
      snap => { if (!snap.metadata.fromCache) cb(Object.fromEntries(snap.docs.map(d => [d.id, cleanReply(d.data())]))); },
      err => console.warn('відповіді', err));
  }).catch(() => {});
  return () => { stopped = true; off?.(); };
}
async function deleteReply(ownerUid, friendUid) {
  needUid(ownerUid, friendUid);
  const c = await sdk();
  await c.fs.deleteDoc(replyRef(c, ownerUid, friendUid));
}
