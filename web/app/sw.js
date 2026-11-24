/* FORGE CORE STOCK · service worker
   Shell cache-first (arranca sin red), navegación network-first con respaldo,
   y /api siempre a la red (un agente cacheado sería una mentira).

   La lista de precache es deliberadamente explícita: si un archivo falta, el
   install falla y la app deja de ser offline — mejor detectarlo en la prueba
   `tests/web/diseno.js` que en el teléfono del usuario. */
/* Bump de caché: fcore-v99 → fcore-v100. La v99 quedaba envenenada por el
   `clone()` tardío de `redYCache` (respuestas a medio cachear), así que subir el
   nombre es lo que hace que `activate` borre esa caché rota en los clientes que
   ya la tienen. */
const V = 'fcore-v100';
const SHELL = [
  './', './index.html', './terminos.html', './styles.css', './app.js', './cloud.js', './lottie-mount.js',
  '../doctor.js',
  './mercado.js', './placer.js', './placer.css', './mapa-trafico.js', './negocio.js', './plataforma.js', './tienda3d.js', './visitas.js',
  '../datos/tiendas.json',
  './texturas/piso-diff.jpg', './texturas/piso-nor.jpg',
  './texturas/muro-diff.jpg', './texturas/muro-nor.jpg',
  './texturas/techo-diff.jpg', './texturas/techo-nor.jpg',
  './texturas/metal-diff.jpg', './texturas/metal-nor.jpg',
  './vendor/leaflet.js', './vendor/leaflet.css',
  './vendor/images/marker-icon.png', './vendor/images/marker-shadow.png',
  './core-xlsx.js', './core-nube.js', './core-sec.js', './core-pro.js', './core-sheet.js',
  './core-scan.js', './core-wiki.js',
  './manifest.webmanifest',
  './vendor/sql-wasm.js', './vendor/sql-wasm.wasm',
  './vendor/lottie.min.js', './vendor/d3-mini.js',
  './anim/core.json', './anim/sync.json', './anim/scan.json', './anim/check.json', './anim/empty.json',
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

const sinRed = () => new Response('', { status: 504, statusText: 'Sin conexion' });

/* ── red + copia en caché ───────────────────────────────────────────────────
   El orden de las tres líneas de abajo es el arreglo, no un detalle de estilo.
   Antes se hacía `caches.open(V).then(c => c.put(req, r.clone()))` y se devolvía
   `r` acto seguido: ese `clone()` corría en un microtask POSTERIOR a la
   devolución, cuando el navegador ya estaba leyendo el body para pintar la
   página, y explotaba con
     "Failed to execute 'clone' on 'Response': Response body is already used"
   en cada navegación de /app/ (sw.js:63 y sw.js:71) y, en silencio, en /datos/.
   Ahora se clona en el mismo tick en que llega la respuesta —el body todavía
   está intacto— y la escritura se espera dentro del propio `respondWith`: así
   queda dentro del tiempo de vida del evento y el navegador no la corta a
   mitad de camino (un `waitUntil` ya no se puede registrar cuando llega). */
async function redYCache(req) {
  const r = await fetch(req);
  /* Fuera de la caché: opacas / de otro origen (status 0, no se pueden
     verificar y sería cachear a ciegas), parciales (206, `put` las rechaza),
     errores y redirecciones raras. */
  if (r.ok && r.type !== 'opaque' && r.status !== 206) {
    const copia = r.clone();                       // ← antes de entregarla
    await caches.open(V).then(c => c.put(req, copia))
      .catch(() => { /* cuota llena: seguimos sirviendo desde la red */ });
  }
  return r;
}

/* Assets: cache-first (arranque sin red) y la red solo rellena el hueco. */
async function servirDeCache(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try { return await redYCache(req); } catch (err) { return sinRed(); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;          // el agente nunca se cachea
  if (url.origin !== location.origin) return;            // solo mismo origen (fabri-api incluida)

  /* El registro de locales cambia sin subir versión: va siempre a la red y la
     caché solo respalda cuando no hay conexión. Si fuera cache-first, el local
     que se suma hoy no aparecería hasta cambiar el nombre de la caché. */
  if (url.pathname.startsWith('/datos/')) {
    e.respondWith(
      redYCache(req).catch(() => caches.match(req).then(r => r || sinRed()))
    );
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(
      redYCache(req).catch(async () => (await caches.match(req))
        || (await caches.match('./index.html')) || sinRed())
    );
    return;
  }

  e.respondWith(servirDeCache(req));
});
/* ── avisos del dueño ──────────────────────────────────────────────────────
   El panel se suscribe a la tienda y recibe el pedido nuevo aunque esté
   cerrado. No hay `fetch` nuevo: el shell sigue igual. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {
    try { d = { cuerpo: e.data ? e.data.text() : '' }; } catch (e2) { d = {}; }
  }
  const titulo = String(d.titulo || 'FORGE CORE STOCK').slice(0, 80);
  const cuerpo = String(d.cuerpo || 'Tienes novedades en tu tienda.').slice(0, 160);
  e.waitUntil(self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'pedido-local',
    renotify: true,
    data: { url: String(d.url || '/app/#negocio') },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app/#negocio';
  const base = url.split('#')[0];
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) {
      if (c.url && c.url.indexOf(base) === 0 && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(url);
  }));
});
