// Оболонка застосунку для роботи без мережі. Спершу мережа (щоб оновлення
// приїжджали одразу), а коли її немає — остання збережена копія.
// Чужих адрес (каталог, постери, Firebase) не чіпаємо.
const CACHE = 'mws-shell-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'js/app.js', 'js/logic.js', 'js/meta.js', 'js/store.js', 'js/cloud.js', 'js/config.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
