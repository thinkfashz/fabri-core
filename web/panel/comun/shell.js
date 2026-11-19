/* Shell del panel: pinta la navegación, resuelve la sesión y maneja el cajón
   móvil. No pinta contenido: cada módulo decide su layout y sus secciones. */

import { leer as leerSesion, alCambiar } from './sesion.js';
import { unidades, suscribir as suscribirCarrito } from './carrito.js';
import { iniciales } from './formato.js';

/* El doctor de cliente mide errores reales y los manda comprimidos a la nube.
   Se carga aparte para que un fallo del doctor jamás tumbe el panel. */
import('/doctor.js').catch(() => { /* sin doctor se sigue navegando */ });

const ICO = {
  inicio: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
  mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  buscar: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  carrito: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M3 4h2l2.4 11h11l2-8H6"/>',
  pedidos: '<path d="M7 3h10l3 4v14H4V7l3-4Z"/><path d="M4 8h16M9 12h6M9 16h4"/>',
  corazon: '<path d="M12 20S4 15 4 9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15 12 20 12 20Z"/>',
  cuenta: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  ayuda: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1 1-1.1 2"/><path d="M12 17h.01"/>',
  campana: '<path d="M6 18h12l-1.5-3v-4a4.5 4.5 0 0 0-9 0v4L6 18Z"/><path d="M10 21h4"/>',
  caja: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  etiqueta: '<path d="M3 11V4h7l11 11-7 7L3 11Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  tienda: '<path d="M4 9h16l-1.5 11h-13L4 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  estrella: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7L12 3Z"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  cupon: '<path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z"/><path d="M12 6v2M12 16v2"/>',
  tarjeta: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  equipo: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><path d="M16 14c2.6.2 4 1.8 4 4"/>',
  escudo: '<path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  nube: '<path d="M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6-1A3.8 3.8 0 0 1 18 18H7Z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

function icono(nombre) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICO[nombre] || ICO.tienda) + '</svg>';
}

function rutaActual() {
  let r = location.pathname.replace(/\/index\.html$/, '/');
  if (r.length > 1) r = r.replace(/\/+$/, '');
  return r || '/';
}

function esActual(ruta) {
  const a = rutaActual();
  const b = ruta.replace(/\/+$/, '') || '/';
  return a === b || a === b + '/index.html';
}

function pintarNav(contenedor, nav, panel) {
  const secciones = nav.map((s) => {
    const items = s.items.map((it) => {
      const iconoHtml = icono(it.icono);
      if (it.pronto) {
        return '<span class="nav-item nav-item--pronto" aria-disabled="true">' +
          iconoHtml + '<span>' + it.texto + '</span>' +
          '<span class="nav-item__pronto">pronto</span></span>';
      }
      const activo = esActual(it.ruta) ? ' aria-current="page"' : '';
      const contador = it.contador
        ? '<span class="nav-item__n" data-contador="' + it.contador + '" hidden></span>'
        : '';
      return '<a class="nav-item" href="' + it.ruta + '"' + activo + '>' +
        iconoHtml + '<span>' + it.texto + '</span>' + contador + '</a>';
    }).join('');
    return '<div class="nav-seccion">' + s.seccion + '</div>' + items;
  }).join('');
  contenedor.innerHTML = secciones;
  contenedor.setAttribute('aria-label', panel === 'negocio'
    ? 'Navegación del negocio'
    : 'Navegación del cliente');
}

function pintarCuenta() {
  const slots = document.querySelectorAll('[data-cuenta-slot]');
  const d = leerSesion();
  const u = d && d.usuario;
  const html = u
    ? '<a class="sidebar__cuenta" href="/panel/cliente/cuenta/">' +
      '<span class="cuenta-chip__ini">' + iniciales(u.nombre || u.email) + '</span>' +
      '<span class="crece"><b>' + (u.nombre || 'Tu cuenta') + '</b>' +
      '<small>' + (u.email || '') + '</small></span></a>'
    : '<a class="sidebar__cuenta" href="/panel/cliente/cuenta/">' +
      '<span class="cuenta-chip__ini">?</span>' +
      '<span class="crece"><b>Entrar</b><small>para sincronizar tu cuenta</small></span></a>';
  slots.forEach((s) => { s.innerHTML = html; });

  const chip = document.querySelector('[data-cuenta-chip]');
  if (chip) {
    chip.innerHTML = u
      ? '<span class="cuenta-chip__ini">' + iniciales(u.nombre || u.email) + '</span><span>' +
        (u.nombre || 'Mi cuenta') + '</span>'
      : '<span class="cuenta-chip__ini">?</span><span>Entrar</span>';
    chip.setAttribute('href', '/panel/cliente/cuenta/');
  }
}

function pintarContadores() {
  const n = unidades();
  document.querySelectorAll('[data-contador="carrito"]').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n <= 0;
  });
}

function montarCajon() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.querySelector('[data-cerrar-sidebar]');
  if (!sidebar) return;
  let focoPrevio = null;

  const abrir = () => {
    focoPrevio = document.activeElement;
    sidebar.dataset.abierta = 'true';
    if (backdrop) backdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    const primero = sidebar.querySelector('a, button');
    if (primero) primero.focus();
  };
  const cerrar = () => {
    sidebar.dataset.abierta = 'false';
    if (backdrop) backdrop.hidden = true;
    document.body.style.overflow = '';
    if (focoPrevio && typeof focoPrevio.focus === 'function') focoPrevio.focus();
  };
  const abierta = () => sidebar.dataset.abierta === 'true';

  document.querySelectorAll('[data-abrir-sidebar]').forEach((b) => {
    b.addEventListener('click', () => (abierta() ? cerrar() : abrir()));
  });
  if (backdrop) backdrop.addEventListener('click', cerrar);

  document.addEventListener('keydown', (e) => {
    if (!abierta()) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const focos = Array.from(sidebar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((el) => el.offsetParent !== null);
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  });

  window.addEventListener('resize', () => { if (window.innerWidth > 900 && abierta()) cerrar(); });

  window.PanelShell = { abrir, cerrar };
}

async function iniciar() {
  const panel = document.body.dataset.panel === 'negocio' ? 'negocio' : 'cliente';
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const nav = panel === 'negocio'
    ? (await import('./nav-negocio.js')).NAV
    : (await import('./nav-cliente.js')).NAV;

  sidebar.innerHTML =
    '<a class="marca" href="/panel/' + panel + '/inicio/">' +
      '<img src="/logo-f.svg" alt="">' +
      '<span class="marca__texto"><b>FORGE CORE</b><span>STOCK</span></span>' +
    '</a>' +
    '<nav class="nav"></nav>' +
    '<div class="sidebar__pie">' +
      '<div data-cuenta-slot></div>' +
      '<a href="/panel/doctor/">Estado y diagnóstico</a>' +
      '<a href="/app/">Abrir la app de compra</a>' +
      '<span>Precios en CLP · Chile</span>' +
    '</div>';

  pintarNav(sidebar.querySelector('.nav'), nav, panel);
  pintarCuenta();
  pintarContadores();
  montarCajon();

  alCambiar(pintarCuenta);
  suscribirCarrito(pintarContadores);
}

iniciar().catch((e) => {
  // El shell no puede tumbar la página: si falla, el contenido sigue visible.
  console.error('shell:', e);
});
