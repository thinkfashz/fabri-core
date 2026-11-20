/* N03 · Productos
   Tabla real del catálogo con edición en línea, foto achicada en el navegador,
   importación CSV/JSON y borrado por lote. Todo pasa por `productos_subir` y
   `producto_borrar`; después de guardar se vuelve a leer `local_mio`. */

import { arrancar, llamar, comprimirImagen } from '../../comun/negocio.js';
import { clp, esc } from '../../comun/formato.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const estado = {
  ctx: null,
  q: '',
  categoria: '',
  formAbierto: false,
  importAbierto: false,
  editando: null,
  foto: '',
  fotoTocada: false,
  fotoNombre: '',
  guardando: false,
  importando: false,
  aviso: '',
  error: '',
};

function aviso(html, tipo) {
  estado.aviso = html
    ? '<div class="aviso aviso--' + (tipo || 'ok') + '">' + html + '</div>'
    : '';
}

function catalogo() {
  return estado.ctx && Array.isArray(estado.ctx.tienda.catalogo) ? estado.ctx.tienda.catalogo : [];
}

function categorias() {
  const set = new Set();
  catalogo().forEach((p) => { if (p.categoria) set.add(p.categoria); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function filtrados() {
  const q = estado.q.trim().toLowerCase();
  return catalogo().filter((p) => {
    if (estado.categoria && p.categoria !== estado.categoria) return false;
    if (!q) return true;
    return String(p.nombre || '').toLowerCase().includes(q) ||
      String(p.sku || '').toLowerCase().includes(q) ||
      String(p.codigo || '').toLowerCase().includes(q);
  });
}

function fotoProducto(p) {
  if (p.imagen) {
    return '<span class="prod-foto"><img src="' + esc(p.imagen) + '" alt="" loading="lazy"></span>';
  }
  return '<span class="prod-foto prod-foto--vacia" aria-hidden="true">' +
    esc(String(p.nombre || '?').charAt(0).toUpperCase()) + '</span>';
}

function fila(p) {
  const dcto = Number(p.descuento_vigente) || 0;
  const precio = Number(p.precio) || 0;
  const efectivo = Number(p.precio_efectivo) || precio;
  const stock = p.stock === null || p.stock === undefined ? null : Number(p.stock);
  const agotado = stock !== null && stock <= 0;
  const bajo = stock !== null && stock > 0 && stock <= 5;
  return '<tr data-sku="' + esc(p.sku) + '">' +
    '<td class="prod-celda-foto">' + fotoProducto(p) + '</td>' +
    '<td class="prod-celda-nombre">' +
      '<strong>' + esc(p.nombre || 'Producto') + '</strong>' +
      '<span>' + esc(p.sku || '') + (p.codigo ? ' · ' + esc(p.codigo) : '') + '</span>' +
    '</td>' +
    '<td>' + (p.categoria ? '<span class="pill">' + esc(p.categoria) + '</span>' : '<span class="prod-tenue">—</span>') + '</td>' +
    '<td class="prod-celda-precio">' +
      (dcto > 0
        ? '<strong>' + clp(efectivo) + '</strong><s>' + clp(precio) + '</s><span class="prod-dcto">−' + dcto + '%</span>'
        : '<strong>' + clp(precio) + '</strong>') +
    '</td>' +
    '<td class="prod-celda-stock">' +
      (stock === null
        ? '<span class="prod-tenue">Sin control</span>'
        : '<span class="pill ' + (agotado ? 'pill--err' : bajo ? 'pill--warn' : 'pill--ok') + '">' + stock + '</span>') +
    '</td>' +
    '<td class="prod-celda-acciones">' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-editar="' + esc(p.sku) + '">Editar</button>' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm prod-borrar" type="button" data-borrar="' + esc(p.sku) + '">Borrar</button>' +
    '</td>' +
  '</tr>';
}

function formHtml() {
  const p = estado.editando ? catalogo().find((x) => x.sku === estado.editando) : null;
  const fecha = p && p.oferta_hasta ? new Date(Number(p.oferta_hasta) * 1000).toISOString().slice(0, 10) : '';
  return '<section class="prod-panel" aria-labelledby="prod-form-titulo">' +
    '<div class="prod-panel__cabeza">' +
      '<h2 id="prod-form-titulo">' + (p ? 'Editar producto' : 'Nuevo producto') + '</h2>' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-cerrar-form>Cancelar</button>' +
    '</div>' +
    '<form class="prod-form" data-form novalidate>' +
      '<div class="prod-form__foto">' +
        '<label class="prod-foto-campo">' +
          '<span class="prod-foto-preview" data-foto-preview>' +
            (estado.foto ? '<img src="' + esc(estado.foto) + '" alt="">' : '<span>Foto</span>') +
          '</span>' +
          '<input type="file" accept="image/*" data-foto>' +
          '<span class="prod-foto-nota">JPG, PNG o WebP. Se achica a 640 px y 200 KB.</span>' +
        '</label>' +
        (estado.foto ? '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-quitar-foto>Quitar foto</button>' : '') +
      '</div>' +
      '<div class="prod-form__campos">' +
        '<label class="campo campo--ancho"><span>Nombre</span><input name="nombre" required maxlength="160" value="' + esc(p ? p.nombre : '') + '" placeholder="Ej: Arroz grado 1 · 1 kg"></label>' +
        '<label class="campo"><span>SKU</span><input name="sku" maxlength="60" value="' + esc(p ? p.sku : '') + '" ' + (p ? 'readonly' : '') + ' placeholder="Se genera si lo dejas vacío"></label>' +
        '<label class="campo"><span>Precio CLP</span><input name="precio" type="number" min="1" step="1" required value="' + (p ? Number(p.precio) || '' : '') + '"></label>' +
        '<label class="campo"><span>Stock</span><input name="stock" type="number" min="0" step="1" value="' + (p && p.stock !== null ? Number(p.stock) : '') + '" placeholder="Vacío = sin control"></label>' +
        '<label class="campo"><span>Categoría</span><input name="categoria" maxlength="40" list="prod-categorias" value="' + esc(p ? p.categoria : '') + '"></label>' +
        '<label class="campo"><span>Unidad</span><input name="unidad" maxlength="30" value="' + esc(p ? p.unidad : '') + '" placeholder="Ej: 1 kg"></label>' +
        '<label class="campo"><span>Código de barras</span><input name="codigo" maxlength="30" value="' + esc(p ? p.codigo : '') + '" placeholder="Opcional"></label>' +
        '<label class="campo"><span>Descuento %</span><input name="descuento" type="number" min="0" max="90" step="1" value="' + (p ? Number(p.descuento) || 0 : 0) + '"></label>' +
        '<label class="campo"><span>Oferta hasta</span><input name="oferta_hasta" type="date" value="' + fecha + '"></label>' +
      '</div>' +
      '<div class="prod-form__pie">' +
        '<p class="prod-nota">El precio que se cobra es el efectivo. Si hay descuento, se aplica hasta la fecha indicada.</p>' +
        '<button class="ds-btn ds-btn--primary" type="submit" data-guardar' + (estado.guardando ? ' disabled' : '') + '>' +
          (estado.guardando ? 'Guardando…' : 'Guardar producto') + '</button>' +
      '</div>' +
    '</form>' +
    '<datalist id="prod-categorias">' + categorias().map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
  '</section>';
}

function importHtml() {
  return '<section class="prod-panel" aria-labelledby="prod-import-titulo">' +
    '<div class="prod-panel__cabeza">' +
      '<h2 id="prod-import-titulo">Importar catálogo</h2>' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-cerrar-import>Cancelar</button>' +
    '</div>' +
    '<p class="prod-nota">Pega un CSV (coma o punto y coma) o un JSON. Columnas: nombre, precio, sku, stock, categoria, unidad, codigo, descuento. Los productos se actualizan por SKU.</p>' +
    '<textarea class="prod-import-area" data-import-texto rows="8" placeholder="nombre,precio,sku,stock,categoria&#10;Arroz 1 kg,2490,ARR-1,12,Despensa"></textarea>' +
    '<div class="prod-import-pie">' +
      '<label class="prod-archivo"><input type="file" accept=".csv,.json,text/csv,application/json" data-import-archivo> Cargar archivo</label>' +
      '<button class="ds-btn ds-btn--primary" type="button" data-importar' + (estado.importando ? ' disabled' : '') + '>' +
        (estado.importando ? 'Importando…' : 'Importar productos') + '</button>' +
    '</div>' +
  '</section>';
}

function pantalla() {
  const lista = filtrados();
  const total = catalogo().length;
  return '<header class="neg-cabeza">' +
    '<div><span class="neg-cabeza__kicker">Catálogo</span>' +
      '<h1>Productos</h1>' +
      '<p>' + total + ' producto' + (total === 1 ? '' : 's') + ' en la nube. ' +
      'El precio y el stock que ves acá son los que compra el cliente.</p></div>' +
    '<div class="neg-cabeza__acciones">' +
      '<button class="ds-btn ds-btn--secondary ds-btn--sm" type="button" data-abrir-import>Importar</button>' +
      '<button class="ds-btn ds-btn--primary ds-btn--sm" type="button" data-nuevo>Nuevo producto</button>' +
    '</div>' +
  '</header>' +
  '<div class="neg-aviso" data-aviso>' + estado.aviso + '</div>' +
  (estado.formAbierto ? formHtml() : '') +
  (estado.importAbierto ? importHtml() : '') +
  '<div class="prod-barra">' +
    '<label class="prod-buscar"><span class="sr-only">Buscar</span>' +
      '<input type="search" data-buscar value="' + esc(estado.q) + '" placeholder="Buscar por nombre, SKU o código"></label>' +
    '<select data-categoria aria-label="Filtrar por categoría">' +
      '<option value="">Todas las categorías</option>' +
      categorias().map((c) => '<option value="' + esc(c) + '"' + (estado.categoria === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    '</select>' +
    '<span class="prod-cuenta">' + lista.length + ' de ' + total + '</span>' +
  '</div>' +
  (lista.length
    ? '<div class="prod-tabla-caja"><table class="prod-tabla"><thead><tr>' +
        '<th scope="col">Foto</th><th scope="col">Producto</th><th scope="col">Categoría</th>' +
        '<th scope="col">Precio</th><th scope="col">Stock</th><th scope="col"><span class="sr-only">Acciones</span></th>' +
      '</tr></thead><tbody>' + lista.map(fila).join('') + '</tbody></table></div>'
    : '<div class="neg-vacio"><b>' + (total ? 'No hay productos con ese filtro.' : 'El catálogo está vacío.') + '</b>' +
      (total ? 'Prueba con otra búsqueda o categoría.' : 'Crea el primero o importa una lista.') + '</div>');
}

function pintar(caja) {
  caja.innerHTML = pantalla();
  enganchar(caja);
}

function enganchar(caja) {
  $('[data-nuevo]', caja)?.addEventListener('click', () => {
    estado.formAbierto = true; estado.importAbierto = false;
    estado.editando = null; estado.foto = ''; estado.fotoTocada = false; estado.fotoNombre = '';
    aviso('', '');
    pintar(caja);
  });
  $('[data-abrir-import]', caja)?.addEventListener('click', () => {
    estado.importAbierto = true; estado.formAbierto = false;
    aviso('', '');
    pintar(caja);
  });
  $('[data-cerrar-import]', caja)?.addEventListener('click', () => {
    estado.importAbierto = false;
    pintar(caja);
  });
  $('[data-cerrar-form]', caja)?.addEventListener('click', () => {
    estado.formAbierto = false; estado.editando = null; estado.foto = ''; estado.fotoTocada = false;
    pintar(caja);
  });
  $$('[data-editar]', caja).forEach((b) => b.addEventListener('click', () => {
    const p = catalogo().find((x) => x.sku === b.dataset.editar);
    if (!p) return;
    estado.editando = p.sku;
    estado.formAbierto = true;
    estado.importAbierto = false;
    estado.foto = p.imagen || '';
    estado.fotoTocada = false;
    estado.fotoNombre = '';
    aviso('', '');
    pintar(caja);
  }));
  $$('[data-borrar]', caja).forEach((b) => b.addEventListener('click', () => borrar(caja, b.dataset.borrar)));
  const buscar = $('[data-buscar]', caja);
  if (buscar) {
    buscar.addEventListener('input', () => {
      estado.q = buscar.value;
      const foco = document.activeElement === buscar;
      pintar(caja);
      if (foco) {
        const nuevo = $('[data-buscar]', caja);
        if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
      }
    });
  }
  const cat = $('[data-categoria]', caja);
  if (cat) cat.addEventListener('change', () => { estado.categoria = cat.value; pintar(caja); });

  const foto = $('[data-foto]', caja);
  if (foto) foto.addEventListener('change', () => elegirFoto(caja, foto));
  $('[data-quitar-foto]', caja)?.addEventListener('click', () => {
    estado.foto = ''; estado.fotoTocada = true; estado.fotoNombre = '';
    pintar(caja);
  });

  const form = $('[data-form]', caja);
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); guardar(caja, form); });

  $('[data-importar]', caja)?.addEventListener('click', () => importar(caja));
  const archivo = $('[data-import-archivo]', caja);
  if (archivo) archivo.addEventListener('change', () => {
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      const area = $('[data-import-texto]', caja);
      if (area) area.value = String(lector.result || '');
    };
    lector.readAsText(f);
  });
}

async function elegirFoto(caja, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const uri = await comprimirImagen(file, { maxPx: 640, maxBytes: 200 * 1024, calidad: 0.7 });
    estado.foto = uri;
    estado.fotoTocada = true;
    estado.fotoNombre = file.name || '';
    aviso('', '');
    pintar(caja);
  } catch (fallo) {
    aviso(esc(fallo && fallo.message ? fallo.message : 'No se pudo procesar la foto.'), 'err');
    pintar(caja);
  }
}

async function guardar(caja, form) {
  if (estado.guardando) return;
  const datos = new FormData(form);
  const nombre = String(datos.get('nombre') || '').trim();
  const precio = Number(datos.get('precio'));
  const stockTxt = String(datos.get('stock') || '').trim();
  const descuento = Number(datos.get('descuento') || 0);
  const fecha = String(datos.get('oferta_hasta') || '').trim();
  if (!nombre || !Number.isFinite(precio) || precio <= 0) {
    aviso('El nombre y un precio mayor que cero son obligatorios.', 'err');
    pintar(caja);
    return;
  }
  if (descuento < 0 || descuento > 90) {
    aviso('El descuento va de 0 a 90 %.', 'err');
    pintar(caja);
    return;
  }
  const producto = {
    nombre,
    precio,
    sku: String(datos.get('sku') || '').trim() || (estado.editando || 'P' + Date.now().toString(36).toUpperCase()),
    categoria: String(datos.get('categoria') || '').trim(),
    unidad: String(datos.get('unidad') || '').trim(),
    codigo: String(datos.get('codigo') || '').trim(),
    stock: stockTxt === '' ? null : Math.max(0, Math.round(Number(stockTxt) || 0)),
    descuento,
    oferta_hasta: descuento > 0 && fecha ? Math.floor(new Date(fecha + 'T23:59:59').getTime() / 1000) : 0,
  };
  if (estado.fotoTocada) producto.imagen = estado.foto || '';

  estado.guardando = true;
  aviso('', '');
  pintar(caja);
  try {
    await llamar('productos_subir', { local_id: estado.ctx.tienda.id, productos: [producto] });
    estado.formAbierto = false;
    estado.editando = null;
    estado.foto = '';
    estado.fotoTocada = false;
    aviso('Producto guardado en la nube.', 'ok');
    await estado.ctx.recargar();
  } catch (fallo) {
    estado.guardando = false;
    aviso(esc(fallo && fallo.message ? fallo.message : 'No se pudo guardar el producto.'), 'err');
    pintar(caja);
  }
}

async function borrar(caja, sku) {
  const p = catalogo().find((x) => x.sku === sku);
  if (!p) return;
  if (!window.confirm('¿Borrar «' + p.nombre + '» del catálogo? Esta acción no se puede deshacer.')) return;
  try {
    await llamar('producto_borrar', { local_id: estado.ctx.tienda.id, skus: [sku] });
    estado.aviso = '<div class="aviso aviso--ok">Producto borrado.</div>';
    await estado.ctx.recargar();
  } catch (fallo) {
    aviso(esc(fallo && fallo.message ? fallo.message : 'No se pudo borrar el producto.'), 'err');
    pintar(caja);
  }
}

/* ── importación ─────────────────────────────────────────────────────────── */

function partirLinea(linea, sep) {
  const out = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (comillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else comillas = !comillas;
    } else if (c === sep && !comillas) {
      out.push(actual); actual = '';
    } else actual += c;
  }
  out.push(actual);
  return out;
}

function normClave(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const ALIAS = {
  nombre: 'nombre', producto: 'nombre', name: 'nombre', titulo: 'nombre',
  precio: 'precio', valor: 'precio', price: 'precio', precio_clp: 'precio',
  sku: 'sku', codigo_interno: 'sku',
  stock: 'stock', existencias: 'stock', cantidad: 'stock', inventory: 'stock',
  categoria: 'categoria', rubro: 'categoria', category: 'categoria',
  unidad: 'unidad', medida: 'unidad', unit: 'unidad',
  codigo: 'codigo', codigo_barras: 'codigo', barras: 'codigo', barcode: 'codigo', ean: 'codigo',
  descuento: 'descuento', descuento_pct: 'descuento', descuento_porcentaje: 'descuento',
};

function aProducto(fila) {
  const p = {};
  Object.keys(fila).forEach((k) => {
    const destino = ALIAS[normClave(k)];
    if (destino) p[destino] = fila[k];
  });
  const nombre = String(p.nombre || '').trim();
  const precio = Number(String(p.precio || '').replace(/[^\d.-]/g, ''));
  if (!nombre || !Number.isFinite(precio) || precio <= 0) return null;
  const stockTxt = String(p.stock == null ? '' : p.stock).trim();
  return {
    nombre,
    precio: Math.round(precio),
    sku: String(p.sku || '').trim(),
    categoria: String(p.categoria || '').trim(),
    unidad: String(p.unidad || '').trim(),
    codigo: String(p.codigo || '').trim(),
    stock: stockTxt === '' ? null : Math.max(0, Math.round(Number(stockTxt) || 0)),
    descuento: Math.max(0, Math.min(90, Math.round(Number(p.descuento) || 0))),
  };
}

function parsear(texto) {
  const t = String(texto || '').trim();
  if (!t) return [];
  if (t.charAt(0) === '[' || t.charAt(0) === '{') {
    const d = JSON.parse(t);
    const arr = Array.isArray(d) ? d : (Array.isArray(d.productos) ? d.productos : []);
    return arr.map(aProducto).filter(Boolean);
  }
  const lineas = t.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return [];
  const cabecera = lineas[0];
  const sep = (cabecera.match(/;/g) || []).length > (cabecera.match(/,/g) || []).length ? ';' : ',';
  const cols = partirLinea(cabecera, sep).map((c) => c.replace(/^"|"$/g, '').trim());
  const salida = [];
  for (let i = 1; i < lineas.length; i++) {
    const valores = partirLinea(lineas[i], sep);
    const fila = {};
    cols.forEach((c, j) => { fila[c] = valores[j] == null ? '' : valores[j].trim(); });
    const p = aProducto(fila);
    if (p) salida.push(p);
  }
  return salida;
}

async function importar(caja) {
  if (estado.importando) return;
  const area = $('[data-import-texto]', caja);
  const texto = area ? area.value : '';
  let productos = [];
  try {
    productos = parsear(texto);
  } catch (fallo) {
    aviso('El JSON no se pudo leer: ' + esc(fallo.message || 'revisa el formato.'), 'err');
    pintar(caja);
    return;
  }
  if (!productos.length) {
    aviso('No se encontraron productos válidos. Revisa que cada fila tenga nombre y precio.', 'err');
    pintar(caja);
    return;
  }
  estado.importando = true;
  aviso('', '');
  pintar(caja);
  try {
    const d = await llamar('productos_subir', { local_id: estado.ctx.tienda.id, productos });
    estado.importAbierto = false;
    const subidos = Number(d.subidos) || productos.length;
    const omitidos = Number(d.omitidos) || 0;
    aviso('Importados ' + subidos + ' producto' + (subidos === 1 ? '' : 's') +
      (omitidos ? ' · ' + omitidos + ' omitidos' : '') + '.', 'ok');
    await estado.ctx.recargar();
  } catch (fallo) {
    estado.importando = false;
    aviso(esc(fallo && fallo.message ? fallo.message : 'No se pudo importar el catálogo.'), 'err');
    pintar(caja);
  }
}

arrancar({
  alListo(ctx) {
    estado.ctx = ctx;
    const caja = document.querySelector('[data-negocio]');
    if (caja) pintar(caja);
  },
});
