/* C02 · Mapa
   Leaflet corre local (`/app/vendor/leaflet.js`), sin CDN. Los pines salen de
   `locales` y la distancia se calcula acá: el endpoint no acepta lat/lon.
   Si el comprador no da ubicación, no se filtra por radio ni se inventa un
   centro: se encuadran todas las tiendas publicadas. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { distanciaKm, ubicacionGuardada, pedirUbicacion, RESPALDO } from '../../comun/catalogo.js';
import { km, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);

const estado = {
  tiendas: [],
  ubi: ubicacionGuardada(),
  rubro: '',
  radio: 0,
  q: '',
  mapa: null,
  capa: null,
  marcadores: new Map(),
  elegida: '',
  sinRed: false,
};

function aviso(html, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  caja.innerHTML = html
    ? '<div class="aviso aviso--' + (tipo || 'warn') + '"><svg viewBox="0 0 24 24">' +
      '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + html + '</span></div>'
    : '';
}

function esperarLeaflet(ms) {
  return new Promise((resolve) => {
    const limite = Date.now() + (ms || 4000);
    (function mirar() {
      if (window.L && window.L.map) { resolve(true); return; }
      if (Date.now() > limite) { resolve(false); return; }
      setTimeout(mirar, 80);
    })();
  });
}

function conDistancia() {
  return estado.tiendas.map((t) => ({
    tienda: t,
    dist: estado.ubi ? distanciaKm(estado.ubi.lat, estado.ubi.lon, t.lat, t.lon) : null,
  }));
}

function visibles() {
  const q = estado.q.trim().toLowerCase();
  return conDistancia().filter((x) => {
    const t = x.tienda;
    if (estado.rubro && String(t.rubro || '') !== estado.rubro) return false;
    if (estado.radio > 0) {
      if (x.dist === null || x.dist > estado.radio) return false;
    }
    if (q) {
      const texto = [t.nombre, t.marca, t.comuna, t.rubro, t.direccion]
        .filter(Boolean).join(' ').toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.dist === null && b.dist === null) return String(a.tienda.nombre).localeCompare(String(b.tienda.nombre));
    if (a.dist === null) return 1;
    if (b.dist === null) return -1;
    return a.dist - b.dist;
  });
}

function pintarRubros() {
  const caja = $('[data-rubros]');
  if (!caja) return;
  const rubros = Array.from(new Set(estado.tiendas.map((t) => String(t.rubro || '')).filter(Boolean))).sort();
  caja.innerHTML = '<button class="ds-chip" type="button" data-rubro="" aria-pressed="' +
    (estado.rubro ? 'false' : 'true') + '">Todas</button>' + rubros.map((r) =>
    '<button class="ds-chip" type="button" data-rubro="' + esc(r) + '" aria-pressed="' +
    (estado.rubro === r ? 'true' : 'false') + '">' + esc(r) + '</button>'
  ).join('');
  caja.querySelectorAll('[data-rubro]').forEach((b) => {
    b.addEventListener('click', () => {
      estado.rubro = b.dataset.rubro || '';
      pintarRubros();
      refrescar();
    });
  });
}

function logo(t) {
  if (t.logo) return '<span class="logo-tienda"><img src="' + esc(t.logo) + '" alt=""></span>';
  return '<span class="logo-tienda" aria-hidden="true">' + esc(iniciales(t.nombre || t.marca)) + '</span>';
}

function pintarLista() {
  const lista = visibles();
  const caja = $('[data-lista]');
  const cuenta = $('[data-cuenta]');
  const titulo = $('[data-titulo]');
  if (!caja) return;
  if (cuenta) cuenta.textContent = lista.length + ' tienda' + (lista.length === 1 ? '' : 's');
  if (titulo) {
    titulo.textContent = estado.rubro
      ? estado.rubro + ' cerca'
      : (estado.ubi ? 'Tiendas cerca de ti' : 'Tiendas en el mapa');
  }
  if (!lista.length) {
    caja.innerHTML = '<div class="mapa-vacio"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>' +
      '<span>No hay tiendas con ese filtro. Prueba con más radio o quita el rubro.</span>' +
      '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-limpiar>Limpiar</button></div>';
    const b = caja.querySelector('[data-limpiar]');
    if (b) b.addEventListener('click', limpiar);
    return;
  }
  caja.innerHTML = lista.map((x) => {
    const t = x.tienda;
    const abierta = t.abierto !== false;
    return '<a class="mapa-tienda' + (estado.elegida === t.id ? '" data-elegida="true' : '"') +
      ' href="/panel/cliente/tienda/?id=' + encodeURIComponent(t.id) + '"' +
      ' data-tienda="' + esc(t.id) + '"' +
      ' data-lat="' + esc(t.lat) + '" data-lon="' + esc(t.lon) + '">' +
      logo(t) +
      '<span class="mapa-tienda__cuerpo"><span class="mapa-tienda__nombre">' + esc(t.nombre) + '</span>' +
        '<span class="mapa-tienda__meta">' +
          [t.rubro, t.comuna, x.dist !== null ? km(x.dist) : ''].filter(Boolean).map(esc).join(' · ') +
        '</span></span>' +
      '<span class="mapa-tienda__precio"><span class="pill ' + (abierta ? 'pill--ok' : 'pill--err') + '">' +
        (abierta ? 'abierta' : 'cerrada') + '</span></span></a>';
  }).join('');

  // Tocar la tarjeta centra el pin sin salir de la página; el enlace sigue
  // estando para abrir la tienda.
  caja.querySelectorAll('[data-tienda]').forEach((a) => {
    a.addEventListener('click', (e) => {
      // Con modificadores o clic derecho se respeta la navegación normal.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      elegir(a.dataset.tienda, true);
    });
  });
}

function pinHtml(t, elegida) {
  const abierta = t.abierto !== false;
  return '<span class="pin' + (abierta ? '' : ' pin--cerrada') + (elegida ? ' pin--elegida' : '') + '">' +
    '<span>' + esc(iniciales(t.nombre || t.marca)) + '</span></span>';
}

function icono(t, elegida) {
  return window.L.divIcon({
    className: 'pin-envoltorio',
    html: pinHtml(t, elegida),
    iconSize: [38, 38],
    iconAnchor: [19, 36],
    popupAnchor: [0, -34],
  });
}

function pintarMarcadores() {
  const L = window.L;
  if (!L || !estado.mapa || !estado.capa) return;
  estado.capa.clearLayers();
  estado.marcadores.clear();

  for (const x of visibles()) {
    const t = x.tienda;
    if (!Number.isFinite(Number(t.lat)) || !Number.isFinite(Number(t.lon))) continue;
    const elegida = estado.elegida === t.id;
    const m = L.marker([Number(t.lat), Number(t.lon)], {
      icon: icono(t, elegida),
      title: t.nombre,
      riseOnHover: true,
    });
    m.bindPopup(
      '<div style="min-width:170px;font-family:inherit">' +
        '<b style="font-size:13px">' + esc(t.nombre) + '</b><br>' +
        '<span style="font-size:11px;color:#8A9099">' + esc(t.rubro || 'Tienda') +
          (x.dist !== null ? ' · ' + km(x.dist) : '') + '</span><br>' +
        '<a href="/panel/cliente/tienda/?id=' + encodeURIComponent(t.id) + '" ' +
          'style="display:inline-block;margin-top:7px;font-size:12px;font-weight:700;color:#C8F542">Ver tienda →</a>' +
      '</div>'
    );
    m.on('click', () => elegir(t.id, false));
    m.addTo(estado.capa);
    estado.marcadores.set(t.id, m);
  }
}

function elegir(id, centrar) {
  estado.elegida = id;
  const t = estado.tiendas.find((x) => x.id === id);
  if (!t) return;
  // Recoloca sólo el pin elegido: repintar todos cuesta y mueve el mapa.
  for (const [tid, m] of estado.marcadores) {
    const tienda = estado.tiendas.find((x) => x.id === tid);
    if (tienda) m.setIcon(icono(tienda, tid === id));
  }
  document.querySelectorAll('[data-tienda]').forEach((a) => {
    if (a.dataset.tienda === id) a.setAttribute('data-elegida', 'true');
    else a.removeAttribute('data-elegida');
  });
  const tarjeta = document.querySelector('[data-tienda="' + CSS.escape(id) + '"]');
  if (tarjeta && tarjeta.scrollIntoView) {
    tarjeta.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
  if (centrar && estado.mapa && Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lon))) {
    estado.mapa.panTo([Number(t.lat), Number(t.lon)], { animate: true });
  }
}

function refrescar() {
  pintarLista();
  pintarMarcadores();
}

function limpiar() {
  estado.rubro = '';
  estado.q = '';
  estado.radio = 0;
  const input = $('[data-q]');
  if (input) input.value = '';
  const sel = $('[data-radio]');
  if (sel) sel.value = '0';
  pintarRubros();
  refrescar();
}

function montarMapa() {
  const L = window.L;
  const caja = $('#mapa');
  const mapa = L.map(caja, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    worldCopyJump: true,
  }).setView([RESPALDO.lat, RESPALDO.lon], 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mapa);

  estado.mapa = mapa;
  estado.capa = L.layerGroup().addTo(mapa);

  if (estado.ubi) {
    L.marker([estado.ubi.lat, estado.ubi.lon], {
      icon: L.divIcon({ className: 'pin-envoltorio', html: '<span class="pin-yo"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(mapa);
    mapa.setView([estado.ubi.lat, estado.ubi.lon], 13);
  }

  // Encuadre inicial: todas las tiendas (o la ubicación + tiendas cercanas).
  const puntos = estado.tiendas
    .filter((t) => Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lon)))
    .map((t) => [Number(t.lat), Number(t.lon)]);
  if (estado.ubi) puntos.push([estado.ubi.lat, estado.ubi.lon]);
  if (puntos.length === 1) mapa.setView(puntos[0], 13);
  else if (puntos.length > 1) mapa.fitBounds(L.latLngBounds(puntos).pad(0.18), { maxZoom: 14 });

  // Al mover el mapa no se pierde el filtro: sólo se cierran los popups.
  mapa.on('popupclose', () => { /* sin acción: el pin sigue elegido */ });
}

async function cargar() {
  try {
    const d = await mercado('locales', { con_catalogo: 0 });
    estado.tiendas = Array.isArray(d.tiendas) ? d.tiendas : [];
    estado.sinRed = false;
    guardarUltimo('mapa', estado.tiendas);
    aviso('');
  } catch (e) {
    const cache = leerUltimo('mapa', 72);
    estado.tiendas = cache && Array.isArray(cache.datos) ? cache.datos : [];
    estado.sinRed = true;
    aviso('<b>Sin conexión.</b> ' + esc(mensajeDeError(e)) +
      (cache ? ' Mostramos las tiendas guardadas.' : ''), 'warn');
  }
  pintarRubros();
  refrescar();
}

async function ubicarme() {
  const b = $('[data-ubicarme]');
  if (b) { b.disabled = true; b.dataset.activo = 'true'; }
  const u = await pedirUbicacion();
  estado.ubi = u;
  if (b) b.disabled = false;
  if (u.origen === 'gps') {
    const sel = $('[data-radio]');
    if (sel && sel.value === '0') sel.value = '3';
    estado.radio = Number(sel && sel.value) || 0;
    if (estado.mapa) estado.mapa.setView([u.lat, u.lon], 14);
    aviso('');
  } else {
    aviso('No pudimos leer tu ubicación. Puedes seguir explorando el mapa sin filtro de radio.', 'warn');
  }
  refrescar();
}

function montar() {
  const input = $('[data-q]');
  let reloj = null;
  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        estado.q = input.value;
        refrescar();
      }, 220);
    });
  }
  const sel = $('[data-radio]');
  if (sel) {
    sel.addEventListener('change', () => {
      if (Number(sel.value) > 0 && !estado.ubi) {
        aviso('Activa tu ubicación para filtrar por radio.', 'warn');
        sel.value = '0';
        estado.radio = 0;
        refrescar();
        return;
      }
      estado.radio = Number(sel.value) || 0;
      refrescar();
    });
  }
  const ubi = $('[data-ubicarme]');
  if (ubi) ubi.addEventListener('click', ubicarme);
}

(async function arranque() {
  montar();
  const listo = await esperarLeaflet();
  if (!listo) {
    aviso('No pudimos cargar el mapa. Revisa tu conexión y recarga la página.', 'err');
    const caja = $('#mapa');
    if (caja) {
      caja.innerHTML = '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#8A9099">' +
        'El mapa no está disponible.<br><a href="/panel/cliente/buscar/" style="color:#C8F542">Buscar tiendas por catálogo</a></div>';
    }
    return;
  }
  await cargar();
  montarMapa();
  refrescar();
  if (!estado.ubi) {
    const sel = $('[data-radio]');
    if (sel) sel.value = '0';
    estado.radio = 0;
    refrescar();
  }
})();
