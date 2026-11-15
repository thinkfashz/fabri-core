/* FORGE CORE STOCK · service worker de avisos (raíz)
   --------------------------------------------------------------------------
   Existe sólo para recibir notificaciones push del pedido. NO cachea nada y
   NO intercepta pedidos: no tiene `fetch`, así que la app y el sitio siguen
   cargando igual que antes. Va en la raíz para cubrir `/seguir.html`, que está
   fuera del alcance del service worker de `/app/` (ese sigue mandando ahí).

   El aviso llega cifrado de extremo a extremo (aes128gcm): el servicio de
   push del navegador nunca ve el texto. Acá sólo se muestra y, al tocarlo, se
   abre el seguimiento del pedido. */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

function datos(e) {
  try {
    return e.data ? e.data.json() : {};
  } catch (err) {
    // Si el payload no es JSON se muestra algo genérico antes que fallar.
    try { return { cuerpo: e.data ? e.data.text() : '' }; } catch (e2) { return {}; }
  }
}

self.addEventListener('push', (e) => {
  const d = datos(e);
  const titulo = String(d.titulo || 'FORGE CORE STOCK').slice(0, 80);
  const cuerpo = String(d.cuerpo || 'Tu pedido cambió de estado.').slice(0, 160);
  const codigo = d.codigo ? String(d.codigo).slice(0, 20) : '';
  const url = String(d.url || '/seguir.html');

  e.waitUntil(self.registration.showNotification(titulo, {
    body: codigo ? cuerpo + ' · ' + codigo : cuerpo,
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-192.png',
    // Un pedido = una notificación: el aviso nuevo reemplaza al anterior en
    // vez de apilar cinco en la cortina.
    tag: codigo ? 'pedido-' + codigo : 'pedido',
    renotify: true,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/seguir.html';
  const base = url.split('?')[0];

  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    // Si el seguimiento ya está abierto, se reusa esa pestaña.
    for (const c of lista) {
      if (c.url && c.url.indexOf(base) === 0 && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(url);
  }));
});
