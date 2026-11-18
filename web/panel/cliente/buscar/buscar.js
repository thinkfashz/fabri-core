/* C03 · Buscar
   El servidor filtra y ordena; acá solo se pinta y se cuida el estado.
   Si no hay ubicación real, no se inventan distancias ni se ordena por
   cercanía: se ordena por precio hasta que el comprador active su GPS. */

import { mercado, guardarUltimo, leerUltimo, mensajeDeError } from '../../comun/api.js';
import { CATEGORIAS, ubicacionGuardada, pedirUbicacion, buscarEnTienda } from '../../comun/catalogo.js';
import { agregar } from '../../comun/carrito.js';
import { clp, km, esc, iniciales } from '../../comun/formato.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const PRECIOS = [
  { v: '', t: 'Todo precio' },
  { v: '1000', t: 'hasta $1.000' },
  { v: '3000', t: 'hasta $3.000' },
  { v: '5000', t: 'hasta $5.000' },
  { v: '10000', t: 'hasta $10.000' },
];
const estado = {
  q: params.get('q') || '',
  categoria: params.get('categoria') || '',
  precio: params.get('precio_max') || '',
  orden: params.get('orden') || '',
  ubi: ubicacionGuardada(),
  sello: 0,
  reloj: null,
  datos: null,
};

function urlActual() {
  const q = new URLSearchParams();
  if (estado.q) q.set('q', estado.q);
  if (estado.categoria) q.set('categoria', estado.categoria);
  if (estado.precio) q.set('precio_max', estado.precio);
  if (estado.orden) q.set('orden', estado.orden);
  const s = q.toString();
  history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
}

function ordenElegido() {
  if (estado.orden) return estado.orden;
  return estado.ubi ? 'cercania' : 'precio';
}

function pintarCategorias(categorias) {
  const caja = $('[data-categorias]');
  if (!caja) return;
  const lista = (categorias && categorias.length)
    ? categorias.map((c) => ({ nombre: c.nombre, n: c.n }))
    : CATEGORIAS.map((nombre) => ({ nombre, n: 0 }));
  const todas = '<button class="ds-chip" type="button" data-cat="" aria-pressed="' +
    (estado.categoria ? 'false' : 'true') + '">Todas</button>';
  caja.innerHTML = todas + lista.map((c) =>
    '<button class="ds-chip" type="button" data-cat="' + esc(c.nombre) + '" aria-pressed="' +
    (estado.categoria === c.nombre ? 'true' : 'false') + '">' +
    esc(c.nombre) + (c.n ? ' <span class="ds-muted">' + c.n + '</span>' : '') + '</button>'
  ).join('');
  caja.querySelectorAll('[data-cat]').forEach((b) => {
    b.addEventListener('click', () => {
      estado.categoria = b.dataset.cat || '';
      pintarCategorias(categorias);
      urlActual();
      buscar();
    });
  });
}

function pintarPrecios() {
  const caja = $('[data-precios]');
  if (!caja) return;
  caja.innerHTML = PRECIOS.map((p) =>
    '<button class="ds-chip" type="button" data-precio="' + p.v + '" aria-pressed="' +
    (estado.precio === p.v ? 'true' : 'false') + '">' + p.t + '</button>'
  ).join('');
  caja.querySelectorAll('[data-precio]').forEach((b) => {
    b.addEventListener('click', () => {
      estado.precio = b.dataset.precio || '';
      pintarPrecios();
      urlActual();
      buscar();
    });
  });
}

function pintarOrden() {
  const sel = $('[data-orden]');
  if (!sel) return;
  sel.value = ordenElegido();
  const opcionCerca = sel.querySelector('option[value="cercania"]');
  if (opcionCerca) {
    opcionCerca.disabled = !estado.ubi;
    opcionCerca.textContent = estado.ubi ? 'Por cercanía' : 'Por cercanía (activa tu GPS)';
  }
  if (!estado.ubi && sel.value === 'cercania') {
    estado.orden = 'precio';
    sel.value = 'precio';
  }
}

function fila(r) {
  const t = r.tienda || {};
  const p = r.producto || {};
  const precio = Number(p.precio_efectivo) || Number(p.precio) || 0;
  const lista = Number(p.precio) || 0;
  const descuento = Number(p.descuento_vigente) || 0;
  const stock = p.stock === null || p.stock === undefined ? null : Number(p.stock);
  const abierta = t.abierto !== false;
  const agotado = stock !== null && stock <= 0;
  const pocas = stock !== null && stock > 0 && stock <= 5;
  const destino = p.sku
    ? '/panel/cliente/producto/?local=' + encodeURIComponent(t.id) + '&sku=' + encodeURIComponent(p.sku)
    : '/panel/cliente/tienda/?id=' + encodeURIComponent(t.id);
  const clickeable = !agotado && abierta;

  return '<article class="resultado' + (abierta ? '' : ' resultado--cerrada') + '">' +
    '<a class="resultado__link" href="' + destino + '">' +
      (p.imagen
        ? '<span class="mini"><img src="' + esc(p.imagen) + '" alt="" loading="lazy"></span>'
        : '<span class="mini" aria-hidden="true">' + esc(iniciales(p.nombre)) + '</span>') +
      '<span class="resultado__cuerpo">' +
        '<span class="resultado__nombre">' + esc(p.nombre) + '</span>' +
        '<span class="resultado__tienda">' + esc(t.nombre || 'Tienda') +
          (t.comuna ? ' · ' + esc(t.comuna) : '') +
          (r.dist !== null && r.dist !== undefined ? ' · a ' + km(r.dist) : '') +
          (!abierta ? ' · <span class="ds-badge ds-badge--err">cerrada</span>' : '') +
          (agotado ? ' · <span class="ds-badge ds-badge--warn">agotado</span>' : '') +
          (pocas ? ' · <span class="ds-badge ds-badge--warn">quedan ' + stock + '</span>' : '') +
        '</span>' +
      '</span>' +
      '<span class="resultado__derecha">' +
        '<b class="precio precio--sm' + (descuento ? ' precio--oferta' : '') + '">' + clp(precio) + '</b>' +
        (descuento && lista > precio ? '<span class="precio-lista">' + clp(lista) + '</span>' : '') +
        (descuento ? '<span class="pill pill--acento">-' + descuento + '%</span>' : '') +
      '</span>' +
    '</a>' +
    '<button class="resultado__agregar" type="button" data-agregar="' + esc(t.id) + '" data-sku="' +
      esc(p.sku || '') + '" data-nombre="' + esc(p.nombre) + '"' +
      (clickeable ? '' : ' disabled') +
      ' aria-label="' + (clickeable ? 'Agregar ' + esc(p.nombre) + ' al carrito' : 'No disponible') + '">+</button>' +
    '</article>';
}

function pintarExplorar() {
  const caja = $('[data-resultados]');
  const meta = $('[data-meta]');
  if (meta) meta.innerHTML = '<span>Escribe al menos 2 letras o elige una categoría.</span>';
  if (!caja) return;
  caja.innerHTML = '<div class="explorar">' + CATEGORIAS.map((c) =>
    '<a class="explorar__item" href="/panel/cliente/buscar/?categoria=' + encodeURIComponent(c) + '">' +
    '<span class="explorar__punto"></span>' + esc(c) + '</a>'
  ).join('') + '</div>';
}

function cargando() {
  const caja = $('[data-resultados]');
  if (!caja) return;
  caja.innerHTML = Array.from({ length: 5 }).map(() =>
    '<div class="resultado"><span class="ds-skeleton" style="width:56px;height:56px;border-radius:12px"></span>' +
    '<div class="crece"><div class="ds-skeleton ds-skeleton--text" style="width:60%"></div>' +
    '<div class="ds-skeleton ds-skeleton--text" style="width:35%;margin-top:8px"></div></div></div>'
  ).join('');
}

function aviso(html) {
  const caja = $('[data-aviso]');
  if (caja) caja.innerHTML = html;
}

function error(titulo, detalle) {
  const caja = $('[data-resultados]');
  if (!caja) return;
  caja.innerHTML = '<div class="ds-error"><div class="ds-error__title">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
    esc(titulo) + '</div><div class="ds-error__text">' + esc(detalle) + '</div>' +
    '<div class="ds-error__action"><button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-reintentar>Reintentar</button></div></div>';
  const b = caja.querySelector('[data-reintentar]');
  if (b) b.addEventListener('click', buscar);
}

async function buscar() {
  const sello = ++estado.sello;
  const q = estado.q.trim();
  const hayFiltro = q.length >= 2 || estado.categoria || estado.precio;
  if (!hayFiltro) {
    pintarExplorar();
    return;
  }
  cargando();
  aviso('');
  const meta = $('[data-meta]');
  if (meta) meta.textContent = 'Buscando…';

  const consulta = {
    q: q.length >= 2 ? q : '',
    categoria: estado.categoria,
    precio_max: estado.precio,
    orden: ordenElegido(),
    limite: 40,
  };
  if (estado.ubi) {
    consulta.lat = estado.ubi.lat;
    consulta.lon = estado.ubi.lon;
  }

  try {
    const d = await mercado('productos_buscar', consulta);
    if (sello !== estado.sello) return;
    estado.datos = d;
    guardarUltimo('buscar', d);
    pintarCategorias(d.categorias || []);
    const caja = $('[data-resultados]');
    const resultados = Array.isArray(d.resultados) ? d.resultados : [];
    if (meta) {
      meta.innerHTML = '<span><b>' + (d.total || 0) + '</b> producto' + (d.total === 1 ? '' : 's') +
        ' en ' + (d.tiendas || 0) + ' tienda' + (d.tiendas === 1 ? '' : 's') + '</span>' +
        '<span>' + (d.orden === 'cercania' ? 'más cerca primero' : d.orden === 'precio' ? 'menor precio primero' : '') + '</span>';
    }
    if (!resultados.length) {
      caja.innerHTML = '<div class="ds-empty"><div class="ds-empty__icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>' +
        '</div><div class="ds-empty__title">Sin resultados</div>' +
        '<p class="ds-empty__text">Prueba con otra palabra, quita el filtro de precio o mira todas las categorías.</p>' +
        '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-limpiar>Limpiar filtros</button></div>';
      const b = caja.querySelector('[data-limpiar]');
      if (b) b.addEventListener('click', limpiar);
      return;
    }
    caja.innerHTML = resultados.map(fila).join('');
    caja.querySelectorAll('[data-agregar]').forEach((b) => {
      b.addEventListener('click', () => agregarDesdeBusqueda(b));
    });
  } catch (e) {
    if (sello !== estado.sello) return;
    const cache = leerUltimo('buscar', 24);
    if (cache && cache.datos && Array.isArray(cache.datos.resultados) && cache.datos.resultados.length) {
      estado.datos = cache.datos;
      pintarCategorias(cache.datos.categorias || []);
      const caja = $('[data-resultados]');
      if (meta) meta.innerHTML = '<span><b>' + cache.datos.total + '</b> resultados guardados</span><span>sin conexión</span>';
      caja.innerHTML = cache.datos.resultados.map(fila).join('');
      caja.querySelectorAll('[data-agregar]').forEach((b) => {
        b.addEventListener('click', () => agregarDesdeBusqueda(b));
      });
      aviso('<div class="aviso aviso--warn"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
        '<span>' + esc(mensajeDeError(e)) + '. Mostramos la última búsqueda guardada.</span></div>');
      return;
    }
    if (meta) meta.textContent = '';
    const codigo = e && e.codigo === 'SIN_BASE'
      ? 'La base de datos no está configurada en este momento.'
      : mensajeDeError(e);
    error('No pudimos buscar', codigo);
  }
}

async function agregarDesdeBusqueda(boton) {
  const localId = boton.dataset.agregar;
  const sku = boton.dataset.sku;
  const nombre = boton.dataset.nombre;
  boton.disabled = true;
  const original = boton.textContent;
  boton.textContent = '…';
  try {
    const d = await mercado('local_ver', { id: localId });
    const prod = buscarEnTienda(d.tienda, sku);
    if (!prod) throw new Error('«' + nombre + '» ya no está en esa tienda');
    agregar(d.tienda, prod, 1);
    boton.textContent = '✓';
    boton.setAttribute('aria-label', 'Agregado al carrito');
    setTimeout(() => {
      boton.textContent = original;
      boton.disabled = false;
      boton.setAttribute('aria-label', 'Agregar ' + nombre + ' al carrito');
    }, 1500);
  } catch (e) {
    boton.textContent = original;
    boton.disabled = false;
    aviso('<div class="aviso aviso--err"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      '<span>' + esc(e.message || mensajeDeError(e)) + '</span></div>');
  }
}

function limpiar() {
  estado.q = '';
  estado.categoria = '';
  estado.precio = '';
  estado.orden = '';
  const input = $('[data-q]');
  if (input) input.value = '';
  pintarCategorias([]);
  pintarPrecios();
  pintarOrden();
  urlActual();
  pintarExplorar();
}

function montar() {
  const input = $('[data-q]');
  const form = $('[data-form]');
  if (input) {
    input.value = estado.q;
    input.addEventListener('input', () => {
      estado.q = input.value;
      clearTimeout(estado.reloj);
      estado.reloj = setTimeout(() => {
        urlActual();
        buscar();
      }, 300);
    });
  }
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      estado.q = input ? input.value : estado.q;
      urlActual();
      buscar();
    });
  }
  const sel = $('[data-orden]');
  if (sel) {
    sel.addEventListener('change', () => {
      estado.orden = sel.value;
      urlActual();
      buscar();
    });
  }
  const cabeza = document.querySelector('.buscar-cabeza');
  if (cabeza) {
    const observador = new IntersectionObserver(([e]) => {
      cabeza.dataset.pegada = e.intersectionRatio < 1 ? 'true' : 'false';
    }, { threshold: [0.95] });
    observador.observe(cabeza);
  }
  // «Cerca de mí» aparece solo cuando no hay una ubicación real.
  if (!estado.ubi) {
    const filtros = document.querySelector('.filtros__grupo');
    if (filtros) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ds-chip ds-chip--accent';
      b.textContent = 'Cerca de mí';
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Ubicando…';
        const u = await pedirUbicacion();
        if (u.origen === 'gps') {
          estado.ubi = u;
          estado.orden = 'cercania';
          b.remove();
          pintarOrden();
          urlActual();
          buscar();
        } else {
          b.disabled = false;
          b.textContent = 'Sin permiso de ubicación';
        }
      });
      filtros.appendChild(b);
    }
  }
}

pintarCategorias([]);
pintarPrecios();
pintarOrden();
montar();
buscar();
