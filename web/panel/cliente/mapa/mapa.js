/* C02 · Mapa
   Leaflet corre local (`/app/vendor/leaflet.js`), sin CDN. Los pines salen de
   `locales` y la distancia se calcula acá: el endpoint no acepta lat/lon.
   Si el comprador no da ubicación, no se filtra por radio ni se inventa un
   centro: se encuadran todas las tiendas publicadas. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { distanciaKm, ubicacionGuardada, pedirUbicacion, RESPALDO } from '../../comun/catalogo.js';
import { km, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const REDUCIR = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

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
  redibujarUbi: null,
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

function textoMetros(m) {
  const n = Math.max(0, Number(m) || 0);
  if (n >= 1000) {
    const km = n / 1000;
    return (km >= 10 ? Math.round(km) : km.toFixed(1).replace('.', ',')) + ' km';
  }
  return Math.round(n) + ' m';
}

function edadCorta(ts) {
  const min = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  return h < 24 ? 'hace ' + h + ' h' : '';
}

/* Chip bajo los filtros: dice si la ubicación es de ahora o la última
   guardada, y con qué precisión. No se muestra nada si no hay ubicación. */
function pintarGps() {
  const chip = $('[data-gps]');
  const texto = $('[data-gps-texto]');
  if (!chip || !texto) return;
  const u = estado.ubi;
  if (!u) {
    chip.hidden = true;
    const b = $('[data-ubicarme]');
    if (b) b.dataset.activo = 'false';
    return;
  }
  chip.hidden = false;
  const b = $('[data-ubicarme]');
  if (b) b.dataset.activo = 'true';
  const p = Number(u.precision) || 0;
  if (u.origen === 'gps') {
    texto.textContent = p
      ? 'Mi ubicación · precisión ±' + textoMetros(p)
      : 'Mi ubicación';
  } else {
    const edad = edadCorta(u.t);
    texto.textContent = 'Guardada' + (edad ? ' ' + edad : '') +
      (p ? ' · ±' + textoMetros(p) : '');
  }
  chip.dataset.origen = u.origen === 'gps' ? 'gps' : 'cache';
}

/* Capa de ubicación propia dibujada en canvas (no son divs de Leaflet):
   punto, precisión real del GPS y radio de búsqueda elegido. Se redibuja en
   cada movimiento o zoom usando la proyección del mapa. */
function montarCapaUbicacion(mapa) {
  const cont = mapa.getContainer();
  const lienzo = document.createElement('canvas');
  lienzo.className = 'mapa-ubicacion-canvas';
  lienzo.setAttribute('aria-hidden', 'true');
  cont.appendChild(lienzo);
  const ctx = lienzo.getContext('2d');
  if (!ctx) return null;

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let raf = 0;
  let ancho = 0;
  let alto = 0;
  let dpr = 1;

  function ajustar() {
    const w = Math.max(1, cont.clientWidth);
    const h = Math.max(1, cont.clientHeight);
    const d = Math.min(2.5, window.devicePixelRatio || 1);
    if (lienzo.width !== Math.round(w * d) || lienzo.height !== Math.round(h * d)) {
      lienzo.width = Math.round(w * d);
      lienzo.height = Math.round(h * d);
      lienzo.style.width = w + 'px';
      lienzo.style.height = h + 'px';
    }
    ancho = w; alto = h; dpr = d;
  }

  // Metros por píxel en la latitud del punto (Web Mercator).
  function metrosPorPixel(lat) {
    return 156543.03392 * Math.cos((Number(lat) || 0) * Math.PI / 180) /
      Math.pow(2, mapa.getZoom());
  }

  function circulo(x, y, r, relleno, borde, guion) {
    if (r <= 0) return;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (relleno) { ctx.fillStyle = relleno; ctx.fill(); }
    if (borde) {
      ctx.setLineDash(guion || []);
      ctx.lineWidth = guion ? 1.4 : 1.2;
      ctx.strokeStyle = borde;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function dibujar(ts) {
    raf = 0;
    ajustar();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, ancho, alto);

    const u = estado.ubi;
    if (!u) return;
    const p = mapa.latLngToContainerPoint([u.lat, u.lon]);
    if (p.x < -120 || p.y < -120 || p.x > ancho + 120 || p.y > alto + 120) return;

    const mpp = metrosPorPixel(u.lat);
    const vivo = u.origen === 'gps';
    const precision = Math.max(0, Number(u.precision) || 0);

    // Radio de búsqueda: el mismo que filtra la lista, dibujado punteado.
    if (estado.radio > 0) {
      circulo(p.x, p.y, (estado.radio * 1000) / mpp, null, 'rgba(200, 245, 66, 0.38)', [5, 7]);
    }

    // Círculo de precisión real. Sólo si el GPS lo entregó y es razonable:
    // un radio de kilómetros no dice nada útil y taparía las tiendas.
    if (precision > 0 && precision <= 3000) {
      const r = Math.max(12, precision / mpp);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(90, 217, 232, 0.30)');
      g.addColorStop(0.72, 'rgba(90, 217, 232, 0.12)');
      g.addColorStop(1, 'rgba(90, 217, 232, 0.02)');
      circulo(p.x, p.y, r, g, 'rgba(90, 217, 232, 0.46)');
    }

    // Halo pulsante sólo con GPS de ahora; una ubicación cacheada se dibuja
    // quieta para no fingir que el teléfono está leyendo el GPS.
    if (vivo && !REDUCIR.matches) {
      const fase = ((ts - t0) % 2400) / 2400;
      circulo(p.x, p.y, 14 + fase * 22, null,
        'rgba(90, 217, 232, ' + (0.5 * (1 - fase)).toFixed(3) + ')');
    }

    // Punto propio: borde oscuro, relleno cian y aro claro.
    circulo(p.x, p.y, 10.5, 'rgba(8, 9, 10, 0.9)');
    circulo(p.x, p.y, 7.5, '#5AD9E8');
    circulo(p.x, p.y, 7.5, null, '#EAFBFF');
  }

  function animar(ts) {
    dibujar(ts);
    if (!REDUCIR.matches && estado.ubi && estado.ubi.origen === 'gps') {
      raf = window.requestAnimationFrame(animar);
    }
  }

  function redibujar() {
    if (raf) return;
    raf = window.requestAnimationFrame(animar);
  }

  mapa.on('move zoom viewreset resize moveend zoomend', redibujar);
  if (REDUCIR.addEventListener) REDUCIR.addEventListener('change', redibujar);
  return redibujar;
}

function puntosDeTiendas() {
  return estado.tiendas
    .filter((t) => Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lon)))
    .map((t) => [Number(t.lat), Number(t.lon)]);
}

function encuadrarTiendas(maxZoom) {
  const L = window.L;
  if (!L || !estado.mapa) return;
  const puntos = puntosDeTiendas();
  if (!puntos.length) return;
  if (puntos.length === 1) estado.mapa.setView(puntos[0], Math.min(15, maxZoom || 14));
  else estado.mapa.fitBounds(L.latLngBounds(puntos).pad(0.16), { maxZoom: maxZoom || 14 });
}

/* Zoom que deja el radio elegido dentro de la pantalla, sin adivinar: se
   calcula con los metros por píxel del mapa y el lado menor visible. */
function zoomParaRadio(metros) {
  const mapa = estado.mapa;
  if (!mapa || !estado.ubi) return 14;
  const caja = mapa.getSize();
  const px = Math.max(90, Math.min(caja.x, caja.y) * 0.38);
  const mpp = Math.max(0.05, metros / px);
  const lat = Number(estado.ubi.lat) || RESPALDO.lat;
  const z = Math.log2(156543.03392 * Math.cos(lat * Math.PI / 180) / mpp);
  return Math.max(4, Math.min(18, Math.round(z * 2) / 2));
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
  pintarGps();
  if (estado.redibujarUbi) estado.redibujarUbi();
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
    // 20 es el tope de cercanía: las teselas nativas llegan a 19 y Leaflet
    // escala esa última para el nivel 20 (0,12 m/px en Chile). Con 0,5 de
    // paso el zoom fino no obliga a saltar de golpe.
    minZoom: 3,
    maxZoom: 20,
    zoomSnap: 0.5,
    zoomDelta: 0.5,
    wheelPxPerZoomLevel: 90,
  }).setView([RESPALDO.lat, RESPALDO.lon], 12);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    maxNativeZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mapa);

  estado.mapa = mapa;
  estado.capa = L.layerGroup().addTo(mapa);
  estado.redibujarUbi = montarCapaUbicacion(mapa);

  // Encuadre inicial: si hay ubicación propia se parte cerca de ella; si no,
  // se encuadran todas las tiendas publicadas.
  if (estado.ubi) mapa.setView([estado.ubi.lat, estado.ubi.lon], 15);
  else encuadrarTiendas(14);

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
  const previa = estado.ubi;
  if (b) {
    b.disabled = true;
    b.dataset.activo = 'true';
    b.setAttribute('aria-busy', 'true');
  }
  const u = await pedirUbicacion({ ms: 14000, alta: true });
  if (b) {
    b.disabled = false;
    b.removeAttribute('aria-busy');
  }

  if (u && u.origen === 'gps') {
    estado.ubi = u;
    const sel = $('[data-radio]');
    if (sel && sel.value === '0') sel.value = '3';
    estado.radio = Number(sel && sel.value) || 0;
    if (estado.mapa) {
      const z = estado.radio > 0
        ? Math.max(14, zoomParaRadio(estado.radio * 1000))
        : 16;
      estado.mapa.setView([u.lat, u.lon], z, { animate: true });
    }
    const p = Number(u.precision) || 0;
    aviso(p > 1000
      ? 'La señal del GPS es imprecisa (±' + textoMetros(p) + '). El punto es aproximado.'
      : '', p > 1000 ? 'warn' : '');
  } else {
    // El respaldo de Santiago sirve para encuadrar el mapa, no para decir
    // «estás acá». Si había una ubicación guardada se conserva; si no, el
    // mapa queda sin punto propio.
    estado.ubi = previa;
    aviso(previa
      ? 'No pudimos actualizar tu ubicación: seguimos mostrando la última guardada.'
      : 'No pudimos leer tu ubicación. Puedes mover el mapa y explorar las tiendas sin filtro de radio.', 'warn');
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
      const n = Number(sel.value) || 0;
      if (n > 0 && !estado.ubi) {
        aviso('Activa tu ubicación para filtrar por radio.', 'warn');
        sel.value = '0';
        estado.radio = 0;
        refrescar();
        return;
      }
      estado.radio = n;
      if (estado.mapa && estado.ubi) {
        if (n > 0) {
          estado.mapa.setView(
            [estado.ubi.lat, estado.ubi.lon],
            zoomParaRadio(n * 1000),
            { animate: true }
          );
        } else {
          encuadrarTiendas(12);
        }
      }
      refrescar();
    });
  }
  const ubi = $('[data-ubicarme]');
  if (ubi) ubi.addEventListener('click', ubicarme);
  const centrar = $('[data-gps-centrar]');
  if (centrar) {
    centrar.addEventListener('click', () => {
      if (!estado.ubi || !estado.mapa) return;
      estado.mapa.setView(
        [estado.ubi.lat, estado.ubi.lon],
        Math.max(15, estado.mapa.getZoom()),
        { animate: true }
      );
    });
  }
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
