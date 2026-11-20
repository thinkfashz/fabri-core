/* N04 · Inventario
   Matriz de stock con celdas editables. Los cambios se acumulan y se guardan
   en un solo lote; cada producto viaja completo para no borrar su nombre,
   precio ni categoría (el upsert del servidor reemplaza esos campos). */

import { arrancar, llamar } from '../../comun/negocio.js';
import { esc } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const estado = {
  ctx: null,
  q: '',
  categoria: '',
  criticos: false,
  cambios: new Map(),
  guardando: false,
  aviso: '',
  error: '',
};

function catalogo() {
  return estado.ctx && Array.isArray(estado.ctx.tienda.catalogo) ? estado.ctx.tienda.catalogo : [];
}

function categorias() {
  const set = new Set();
  catalogo().forEach((p) => { if (p.categoria) set.add(p.categoria); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function valor(sku) {
  return estado.cambios.has(sku) ? estado.cambios.get(sku) : null;
}

function filtrados() {
  const q = estado.q.trim().toLowerCase();
  return catalogo().filter((p) => {
    if (estado.categoria && p.categoria !== estado.categoria) return false;
    const n = p.stock === null || p.stock === undefined ? null : Number(p.stock);
    if (estado.criticos && !(n !== null && n <= 5)) return false;
    if (!q) return true;
    return String(p.nombre || '').toLowerCase().includes(q) ||
      String(p.sku || '').toLowerCase().includes(q) ||
      String(p.codigo || '').toLowerCase().includes(q);
  });
}

function conteos() {
  let agotados = 0, bajos = 0, sinControl = 0;
  catalogo().forEach((p) => {
    const n = p.stock === null || p.stock === undefined ? null : Number(p.stock);
    if (n === null) sinControl++;
    else if (n <= 0) agotados++;
    else if (n <= 5) bajos++;
  });
  return { agotados, bajos, sinControl };
}

function fila(p) {
  const n = p.stock === null || p.stock === undefined ? null : Number(p.stock);
  const actual = valor(p.sku);
  const mostrado = actual === null ? (n === null ? '' : n) : actual;
  const clase = n === null ? '' : n <= 0 ? ' inv-agotado' : n <= 5 ? ' inv-bajo' : '';
  return '<tr data-sku="' + esc(p.sku) + '" class="' + clase + '">' +
    '<td class="inv-nombre"><strong>' + esc(p.nombre) + '</strong>' +
      '<span>' + esc(p.sku) + (p.codigo ? ' · ' + esc(p.codigo) : '') + '</span></td>' +
    '<td>' + (p.categoria ? '<span class="pill">' + esc(p.categoria) + '</span>' : '<span class="inv-tenue">—</span>') + '</td>' +
    '<td class="inv-control">' +
      '<button type="button" class="inv-step" data-menos="' + esc(p.sku) + '" aria-label="Restar uno">−</button>' +
      '<input type="number" inputmode="numeric" min="0" step="1" data-stock="' + esc(p.sku) + '" value="' + esc(mostrado) + '" aria-label="Stock de ' + esc(p.nombre) + '">' +
      '<button type="button" class="inv-step" data-mas="' + esc(p.sku) + '" aria-label="Sumar uno">+</button>' +
    '</td>' +
    '<td class="inv-estado">' + (n === null ? '<span class="inv-tenue">Sin control</span>' :
      n <= 0 ? '<span class="pill pill--err">Agotado</span>' :
      n <= 5 ? '<span class="pill pill--warn">Quedan ' + n + '</span>' :
      '<span class="pill pill--ok">Disponible</span>') + '</td>' +
  '</tr>';
}

function pantalla() {
  const lista = filtrados();
  const c = conteos();
  const nCambios = estado.cambios.size;
  return '<header class="neg-cabeza">' +
    '<div><span class="neg-cabeza__kicker">Stock real</span>' +
      '<h1>Inventario</h1>' +
      '<p>Ajusta las unidades que quedan. Al guardar se actualiza el catálogo público y el checkout deja de vender lo que no hay.</p></div>' +
    '<div class="neg-cabeza__acciones">' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-descartar' + (nCambios ? '' : ' hidden') + '>Descartar</button>' +
      '<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-guardar' + (nCambios ? '' : ' disabled') + '>' +
        'Guardar' + (nCambios ? ' ' + nCambios + ' cambio' + (nCambios === 1 ? '' : 's') : '') + '</button>' +
    '</div>' +
  '</header>' +
  '<div class="neg-aviso" data-aviso>' + estado.aviso + '</div>' +
  '<div class="inv-kpis">' +
    '<div class="inv-kpi"><span>Agotados</span><strong>' + c.agotados + '</strong></div>' +
    '<div class="inv-kpi"><span>Stock bajo</span><strong>' + c.bajos + '</strong></div>' +
    '<div class="inv-kpi"><span>Sin control</span><strong>' + c.sinControl + '</strong></div>' +
    '<div class="inv-kpi"><span>Productos</span><strong>' + catalogo().length + '</strong></div>' +
  '</div>' +
  '<div class="inv-barra">' +
    '<label class="inv-buscar"><span class="sr-only">Buscar</span>' +
      '<input type="search" data-q value="' + esc(estado.q) + '" placeholder="Buscar por nombre, SKU o código"></label>' +
    '<select data-categoria aria-label="Categoría"><option value="">Todas las categorías</option>' +
      categorias().map((c2) => '<option value="' + esc(c2) + '"' + (estado.categoria === c2 ? ' selected' : '') + '>' + esc(c2) + '</option>').join('') +
    '</select>' +
    '<label class="inv-check"><input type="checkbox" data-criticos' + (estado.criticos ? ' checked' : '') + '> Sólo críticos</label>' +
  '</div>' +
  (lista.length
    ? '<div class="inv-tabla-caja"><table class="inv-tabla"><thead><tr>' +
        '<th scope="col">Producto</th><th scope="col">Categoría</th><th scope="col">Stock</th><th scope="col">Estado</th>' +
      '</tr></thead><tbody>' + lista.map(fila).join('') + '</tbody></table></div>'
    : '<div class="neg-vacio"><b>No hay productos con ese filtro.</b>Prueba con otra búsqueda o categoría.</div>');
}

function pintar(caja) {
  caja.innerHTML = pantalla();
  enganchar(caja);
}

function resumen(caja) {
  const n = estado.cambios.size;
  const boton = $('[data-guardar]', caja);
  if (boton) {
    boton.disabled = n === 0;
    boton.textContent = 'Guardar' + (n ? ' ' + n + ' cambio' + (n === 1 ? '' : 's') : '');
  }
  const descartar = $('[data-descartar]', caja);
  if (descartar) descartar.hidden = n === 0;
}

function enganchar(caja) {
  const q = $('[data-q]', caja);
  if (q) {
    let reloj = null;
    q.addEventListener('input', () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => {
        estado.q = q.value;
        pintar(caja);
        const nuevo = $('[data-q]', caja);
        if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
      }, 220);
    });
  }
  const cat = $('[data-categoria]', caja);
  if (cat) cat.addEventListener('change', () => { estado.categoria = cat.value; pintar(caja); });
  const crit = $('[data-criticos]', caja);
  if (crit) crit.addEventListener('change', () => { estado.criticos = crit.checked; pintar(caja); });

  $$('[data-stock]', caja).forEach((input) => {
    input.addEventListener('input', () => {
      const sku = input.dataset.stock;
      const texto = input.value.trim();
      if (texto === '') estado.cambios.set(sku, null);
      else estado.cambios.set(sku, Math.max(0, Math.round(Number(texto) || 0)));
      resumen(caja);
    });
  });
  $$('[data-menos]', caja).forEach((b) => b.addEventListener('click', () => paso(caja, b.dataset.menos, -1)));
  $$('[data-mas]', caja).forEach((b) => b.addEventListener('click', () => paso(caja, b.dataset.mas, 1)));

  $('[data-guardar]', caja)?.addEventListener('click', () => guardar(caja));
  $('[data-descartar]', caja)?.addEventListener('click', () => {
    estado.cambios.clear();
    estado.aviso = '';
    pintar(caja);
  });
}

function paso(caja, sku, delta) {
  const p = catalogo().find((x) => x.sku === sku);
  if (!p) return;
  const input = $('[data-stock="' + CSS.escape(sku) + '"]', caja);
  const actual = input ? Number(input.value) || 0 : Number(p.stock) || 0;
  const nuevo = Math.max(0, actual + delta);
  if (input) input.value = nuevo;
  estado.cambios.set(sku, nuevo);
  resumen(caja);
}

async function guardar(caja) {
  if (estado.guardando || !estado.cambios.size) return;
  estado.guardando = true;
  const boton = $('[data-guardar]', caja);
  if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
  const productos = [];
  estado.cambios.forEach((stock, sku) => {
    const p = catalogo().find((x) => x.sku === sku);
    if (!p) return;
    productos.push({
      sku: p.sku,
      nombre: p.nombre,
      precio: Number(p.precio) || 0,
      categoria: p.categoria || '',
      unidad: p.unidad || '',
      stock,
    });
  });
  try {
    await llamar('productos_subir', { local_id: estado.ctx.tienda.id, productos });
    estado.cambios.clear();
    estado.aviso = '<div class="aviso aviso--ok">Inventario guardado en la nube.</div>';
    estado.guardando = false;
    await estado.ctx.recargar();
  } catch (fallo) {
    estado.guardando = false;
    estado.aviso = '<div class="aviso aviso--err">' + esc(fallo && fallo.message ? fallo.message : 'No se pudo guardar el inventario.') + '</div>';
    pintar(caja);
  }
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    estado.cambios.clear();
    const caja = $('[data-negocio]');
    if (caja) pintar(caja);
  },
});
