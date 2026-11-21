// Хмара: вхід через Google і синхронізація у Firestore. Свого сервера
// немає — сторінка говорить із Firebase напряму, а хто що може читати й
// писати, вирішують правила (firestore.rules): кожен — лише своє.
//
//   users/{uid}/entries/{imdbId}  — приватний список людини
//   public/{uid}                  — її рекомендації, читати може будь-хто
import { FIREBASE } from './config.js';
import { store } from './store.js';
import { recItem, cleanRecs } from './logic.js';

const V = '10.14.1', CDN = `https://www.gstatic.com/firebasejs/${V}/`;
const FLAG = 'mws.signedIn', OWNER = 'mws.owner', PUBLISHED = 'mws.published';

let sdkPromise = null, unsub = null, pubTimer = null, lastPub = '';
const subs = new Set();

export const cloud = {
  available: !!FIREBASE,
  user: null,          // { uid, name, email }
  state: 'off',        // off | connecting | synced | offline | error
  onChange(fn) { subs.add(fn); },
  init, signIn, signOut, loadPublic, publishNow,
};

function set(state) { cloud.state = state; subs.forEach(fn => fn()); }

// SDK важить чимало, тож вантажимо його лише тим, кому він потрібен:
// хто входив раніше, хто тисне «Увійти», хто відкрив чужі рекомендації.
function sdk() {
  if (!FIREBASE) return Promise.reject(new Error('хмару не налаштовано'));
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

function init() {
  if (!FIREBASE) return;
  let was = false;
  try { was = !!localStorage.getItem(FLAG); } catch { /* нічого */ }
  if (was) { set('connecting'); sdk().catch(() => set('offline')); }
  store.onLocal((entry, what) => {
    if (!cloud.user) return;
    if (what === 'meta') pushMeta(entry); else push(entry);
    schedulePublish();
  });
  addEventListener('online', () => cloud.user && set('synced'));
  addEventListener('offline', () => cloud.user && set('offline'));
}

const ref = (c, id) => c.fs.doc(c.db, 'users', cloud.user.uid, 'entries', id);
const plain = x => JSON.parse(JSON.stringify(x));

async function push(entry) {
  try { const c = await sdk(); await c.fs.setDoc(ref(c, entry.id), plain(entry)); }
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
  if (!u) {
    cloud.user = null;
    try { localStorage.removeItem(FLAG); } catch { /* нічого */ }
    return set('off');
  }
  cloud.user = { uid: u.uid, name: u.displayName || '', email: u.email || '' };
  // Чий список лежить на пристрої. Накопичене без входу віддаємо першому,
  // хто ввійде; а от список іншого акаунта чужому не дістається — його
  // прибираємо (він і так цілий у хмарі власника).
  let owner = '';
  try { owner = localStorage.getItem(OWNER) || ''; } catch { /* нічого */ }
  if (owner && owner !== u.uid) store.clear();
  lastPub = '';
  try { localStorage.setItem(OWNER, u.uid); localStorage.setItem(FLAG, '1'); } catch { /* нічого */ }
  set('connecting');
  let first = true;
  unsub = c.fs.onSnapshot(c.fs.collection(c.db, 'users', u.uid, 'entries'), snap => {
    const incoming = [];
    snap.docChanges().forEach(ch => { if (ch.type !== 'removed') incoming.push(ch.doc.data()); });
    store.applyRemote(incoming);
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
}

async function signIn() {
  const c = await sdk();
  await c.au.signInWithPopup(c.auth, new c.au.GoogleAuthProvider());
}
async function signOut() {
  const c = await sdk();
  await c.au.signOut(c.auth);
}

function recsPayload() {
  const items = store.list().filter(e => e.rec)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title, 'uk'))
    .map(recItem);
  // Підпис — лише той, що людина вписала сама; ім'я з Google-акаунта
  // без її волі в публічний документ не потрапляє.
  return { name: store.settings.name || '', items };
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
