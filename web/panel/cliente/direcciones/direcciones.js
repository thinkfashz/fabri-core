/* C11 · Direcciones
   Formulario + pin. Con cuenta se guardan en la nube (`mercado_direcciones`);
   sin cuenta, en `fcore.panel.direcciones` de este teléfono. No se inventa
   geocodificación: se escribe la dirección y se mueve el pin. El checkout
   lee el mismo espejo local, así que la dirección sirve al instante. */

import { listar, guardar, borrar, predeterminada } from '../../comun/direcciones.js';
import { pedirUbicacion, ubicacionGuardada, RESPALDO } from '../../comun/catalogo.js';
import { activa, alCambiar } from '../../comun/sesion.js';
import { mensajeDeError } from '../../comun/api.js';
import { esc } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);

const estado = {
  lista: [],
  editando: '',
  lat: 0,
  lon: 0,
  mapa: null,
  marcador: null,
  cargando: true,
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

function error(e) {
  return (e && e.message) || mensajeDeError(e) || 'No pudimos guardar la dirección.';
}

function centroInicial() {
  const u = ubicacionGuardada();
  return u ? [u.lat, u.lon] : [RESPALDO.lat, RESPALDO.lon];
}

function montarMapa() {
  const caja = $('[data-mapa]');
  if (!caja || !window.L || !window.L.map) {
    if (caja) caja.innerHTML = '<div class="dir-vacio ds-empty"><div class="ds-empty__text">El mapa no está disponible: igual puedes guardar la dirección con calle, comuna y referencia.</div></div>';
    return;
  }
  const [lat, lon] = centroInicial();
  const mapa = window.L.map(caja, {
    zoomControl: true,
    preferCanvas: true,
    worldCopyJump: true,
  }).setView([lat, lon], 13);

  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(mapa);

  mapa.on('click', (e) => fijarPin(e.latlng.lat, e.latlng.lng, false));
  estado.mapa = mapa;
}

function fijarPin(lat, lon, mover) {
  estado.lat = Number(lat) || 0;
  estado.lon = Number(lon) || 0;
  const texto = $('[data-pin-texto]');
  if (texto) {
    texto.textContent = estado.lat && estado.lon
      ? 'Pin: ' + estado.lat.toFixed(5) + ', ' + estado.lon.toFixed(5)
      : 'Sin punto elegido';
  }
  if (!estado.mapa) return;
  const icono = window.L.divIcon({
    className: 'dir-pin',
    html: '<span></span>',
    iconSize: [20, 20],
    iconAnchor: [10, 20],
  });
  if (!estado.marcador) {
    estado.marcador = window.L.marker([estado.lat, estado.lon], { icon: icono, draggable: true }).addTo(estado.mapa);
    estado.marcador.on('dragend', () => {
      const p = estado.marcador.getLatLng();
      fijarPin(p.lat, p.lng, false);
    });
  } else {
    estado.marcador.setLatLng([estado.lat, estado.lon]);
  }
  if (mover) estado.mapa.panTo([estado.lat, estado.lon]);
}

function quitarPin() {
  estado.lat = 0;
  estado.lon = 0;
  if (estado.marcador) {
    try { estado.mapa.removeLayer(estado.marcador); } catch (_) { /* ya fuera */ }
    estado.marcador = null;
  }
  const texto = $('[data-pin-texto]');
  if (texto) texto.textContent = 'Sin punto elegido';
}

function logoPin() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>';
}

function tarjeta(d) {
  const pin = d.lat && d.lon
    ? '<button class="dir-mini" type="button" data-ver-pin="' + esc(d.id) + '">ver pin</button>'
    : '';
  return '<article class="dir-card' + (d.predeterminada ? ' dir-card--default' : '') + '">' +
    '<span class="dir-card__ico">' + logoPin() + '</span>' +
    '<div class="dir-card__cuerpo">' +
      '<span class="dir-card__alias">' + esc(d.alias || 'Dirección') +
        (d.predeterminada ? ' <span class="pill pill--acento">predeterminada</span>' : '') + '</span>' +
      '<span class="dir-card__direccion">' + esc(d.direccion) + '</span>' +
      '<span class="dir-card__meta">' + esc(d.comuna) +
        (d.referencia ? ' · ' + esc(d.referencia) : '') +
        (d.lat && d.lon ? ' · con pin' : '') + '</span>' +
    '</div>' +
    '<div class="dir-card__acciones">' +
      '<button class="dir-mini" type="button" data-editar="' + esc(d.id) + '">Editar</button>' +
      (d.predeterminada ? '' : '<button class="dir-mini" type="button" data-default="' + esc(d.id) + '">Predeterminar</button>') +
      pin +
      '<button class="dir-mini dir-mini--peligro" type="button" data-borrar="' + esc(d.id) + '">Borrar</button>' +
    '</div>' +
  '</article>';
}

function pintarLista() {
  const caja = $('[data-lista]');
  const contador = $('[data-cuenta-dirs]');
  if (contador) contador.textContent = String(estado.lista.length);
  if (!caja) return;
  if (estado.cargando) return;
  if (!estado.lista.length) {
    caja.innerHTML = '<div class="ds-empty dir-vacio">' +
      '<div class="ds-empty__icon">' + logoPin() + '</div>' +
      '<div class="ds-empty__title">Todavía no hay direcciones</div>' +
      '<p class="ds-empty__text">Guarda la casa o el trabajo una vez y el checkout las ofrecerá cuando pidas delivery.</p>' +
    '</div>';
    return;
  }
  caja.innerHTML = estado.lista.map(tarjeta).join('');
}

function rellenarFormulario(d) {
  estado.editando = d ? d.id : '';
  const campos = {
    '#d-alias': d ? d.alias : '',
    '#d-direccion': d ? d.direccion : '',
    '#d-comuna': d ? d.comuna : '',
    '#d-referencia': d ? d.referencia : '',
  };
  for (const [sel, v] of Object.entries(campos)) {
    const el = $(sel);
    if (el) { el.value = v || ''; el.removeAttribute('aria-invalid'); }
  }
  const pred = $('[data-predeterminada]');
  if (pred) pred.checked = Boolean(d && d.predeterminada);
  const titulo = $('[data-form-titulo]');
  if (titulo) titulo.textContent = d ? 'Editar dirección' : 'Nueva dirección';
  const cancelar = $('[data-cancelar]');
  if (cancelar) cancelar.hidden = !d;
  const guardarBtn = $('[data-guardar]');
  if (guardarBtn) guardarBtn.textContent = d ? 'Guardar cambios' : 'Guardar dirección';

  if (d && d.lat && d.lon) {
    fijarPin(d.lat, d.lon, true);
    if (estado.mapa) estado.mapa.setView([d.lat, d.lon], 16);
  } else {
    quitarPin();
  }
}

function limpiarErrores() {
  document.querySelectorAll('.dir-campo input').forEach((el) => {
    el.removeAttribute('aria-invalid');
  });
}

function validar() {
  limpiarErrores();
  let ok = true;
  const dir = $('#d-direccion');
  const comuna = $('#d-comuna');
  if (!dir || dir.value.trim().length < 5) {
    if (dir) dir.setAttribute('aria-invalid', 'true');
    ok = false;
  }
  if (!comuna || comuna.value.trim().length < 2) {
    if (comuna) comuna.setAttribute('aria-invalid', 'true');
    ok = false;
  }
  if (!ok) aviso('Completa la calle con número y la comuna.', 'err');
  return ok;
}

async function cargar() {
  estado.cargando = true;
  pintarLista();
  try {
    const r = await listar();
    estado.lista = r.direcciones;
    estado.cargando = false;
    if (!activa()) {
      aviso('Las direcciones se guardan en este teléfono. <a href="/panel/cliente/cuenta/">Entra a tu cuenta</a> para usarlas en otros dispositivos.', 'acento');
    } else if (!r.nube) {
      aviso('No pudimos leer la nube: estás viendo las direcciones guardadas en este teléfono.', 'warn');
    } else {
      aviso('');
    }
    pintarLista();
    const d = predeterminada(estado.lista);
    if (d && d.lat && d.lon && estado.mapa && !estado.marcador) {
      estado.mapa.setView([d.lat, d.lon], 15);
    }
  } catch (e) {
    estado.cargando = false;
    aviso(esc(error(e)), 'err');
    pintarLista();
  }
}

async function enviar(ev) {
  ev.preventDefault();
  if (!validar()) return;
  const boton = $('[data-guardar]');
  if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
  try {
    const datos = {
      id: estado.editando,
      alias: ($('#d-alias') && $('#d-alias').value.trim()) || 'Dirección',
      direccion: $('#d-direccion').value.trim(),
      comuna: $('#d-comuna').value.trim(),
      referencia: $('#d-referencia') ? $('#d-referencia').value.trim() : '',
      lat: estado.lat,
      lon: estado.lon,
      predeterminada: Boolean($('[data-predeterminada]') && $('[data-predeterminada]').checked),
    };
    const r = await guardar(datos);
    const editaba = Boolean(estado.editando);
    rellenarFormulario(null);
    await cargar();
    aviso((editaba ? 'Dirección actualizada' : 'Dirección guardada') +
      (r.nube ? ' en tu cuenta.' : ' en este teléfono.'), 'ok');
  } catch (e) {
    aviso(esc(error(e)), 'err');
    if (boton) { boton.disabled = false; boton.textContent = estado.editando ? 'Guardar cambios' : 'Guardar dirección'; }
  }
}

async function marcarPredeterminada(id) {
  const d = estado.lista.find((x) => x.id === id);
  if (!d) return;
  try {
    await guardar(Object.assign({}, d, { predeterminada: true }));
    await cargar();
    aviso('«' + esc(d.alias || d.direccion) + '» quedó como predeterminada.', 'ok');
  } catch (e) {
    aviso(esc(error(e)), 'err');
  }
}

async function eliminar(id) {
  const d = estado.lista.find((x) => x.id === id);
  if (!d) return;
  if (!window.confirm('¿Borrar «' + (d.alias || d.direccion) + '»? No se puede deshacer.')) return;
  try {
    await borrar(id);
    if (estado.editando === id) rellenarFormulario(null);
    await cargar();
    aviso('Dirección borrada.', 'ok');
  } catch (e) {
    aviso(esc(error(e)), 'err');
  }
}

document.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-editar]');
  if (ed) {
    const d = estado.lista.find((x) => x.id === ed.dataset.editar);
    if (d) {
      rellenarFormulario(d);
      const caja = $('.dir-form-caja');
      if (caja) caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return;
  }
  const def = e.target.closest('[data-default]');
  if (def) { marcarPredeterminada(def.dataset.default); return; }
  const del = e.target.closest('[data-borrar]');
  if (del) { eliminar(del.dataset.borrar); return; }
  const ver = e.target.closest('[data-ver-pin]');
  if (ver) {
    const d = estado.lista.find((x) => x.id === ver.dataset.verPin);
    if (d && d.lat && d.lon) {
      fijarPin(d.lat, d.lon, true);
      if (estado.mapa) estado.mapa.setView([d.lat, d.lon], 16);
    }
    return;
  }
  if (e.target.closest('[data-cancelar]')) {
    rellenarFormulario(null);
    quitarPin();
    return;
  }
  if (e.target.closest('[data-centrar]')) {
    const [lat, lon] = centroInicial();
    if (estado.mapa) estado.mapa.setView([lat, lon], 14);
    return;
  }
  if (e.target.closest('[data-ubicacion]')) usarUbicacion();
});

async function usarUbicacion() {
  const boton = $('[data-ubicacion]');
  if (boton) { boton.disabled = true; boton.textContent = 'Buscando…'; }
  try {
    const u = await pedirUbicacion({ ms: 9000 });
    if (!u || u.origen === 'respaldo') {
      if (estado.mapa) estado.mapa.setView([RESPALDO.lat, RESPALDO.lon], 12);
      aviso('No pudimos leer tu ubicación: mueve el mapa y toca el punto exacto.', 'warn');
    } else {
      fijarPin(u.lat, u.lon, true);
      if (estado.mapa) estado.mapa.setView([u.lat, u.lon], 16);
      aviso('Pin puesto en tu ubicación. Ajusta la calle y la comuna a mano.', 'ok');
    }
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = 'Usar mi ubicación'; }
  }
}

const form = $('[data-form]');
if (form) form.addEventListener('submit', enviar);

alCambiar(cargar);
montarMapa();
cargar();
