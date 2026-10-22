/* FABRI-CORE · service worker
   Shell cache-first (arranca sin red), navegación network-first con respaldo,
   y /api siempre a la red (un agente cacheado sería una mentira). */
const V = 'fcore-v3';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './core-xlsx.js', './core-sec.js', './core-pro.js', './core-sheet.js',
  './manifest.webmanifest', './vendor/sql-wasm.js', './vendor/sql-wasm.wasm',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;          // el agente nunca se cachea
  if (url.origin !== location.origin) return;            // solo mismo origen

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(r => { caches.open(V).then(c => c.put(req, r.clone())); return r; })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) caches.open(V).then(c => c.put(req, r.clone()));
      return r;
    }).catch(() => hit))
  );
});
