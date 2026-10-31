/* ==========================================================================
   FORGE CORE STOCK · Módulo Catálogo + Tienda
   --------------------------------------------------------------------------
   Un módulo, seis páginas con navegación libre:
     catálogo → producto → carrito → checkout → pago → éxito
   Puedes seguir viendo productos y ir a pagar cuando quieras. El carrito se
   guarda en localStorage y sobrevive a la navegación dentro de la app.

   Datos: todo sale del núcleo local (acción `listar` y `panel`). La ficha de
   cada producto (JSON `ficha`) se usa como wiki: imagen, descripción,
   etiquetas, Nutri-Score, NOVA y alérgenos.

   Reutiliza del inventario: invApiTarde, invClp, invFichaDe, INV_CATEGORIAS
   y el apagado del lector (invLectorParar) para que nunca haya dos cámaras.
   ========================================================================== */

const CAT = {
  activa: false,
  productos: [],
  total: 0,
  q: "",
  cat: "",
  cargando: false,
  lote: 24,
  panel: null,
  vista: "catalogo",
  producto: null,
  lector: { activo: false, stream: null, detector: null, raf: 0, ultimoMs: 0, ultimo: "" },
  carro: [],
  pedido: null,
  banners: [],
  pedidoDemo: null
};

const CAT_LOTE_NUCLEO = 500;
const CAT_CLAVE_CARRO = "forge.tienda.carrito";
const CAT_CLAVE_PEDIDO = "forge.tienda.pedido";

/* ── iconos (24×24, trazo; sin emoji ni fuentes externas) ──────────────── */
const CAT_ICO = {
  buscar: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="3" y1="12" x2="21" y2="12"/>',
  carro: '<path d="M4 5h2l2.1 9.6a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6.4"/><circle cx="10" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  volver: '<path d="M15 18l-6-6 6-6"/>',
  mas: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  menos: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  rayo: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/>',
  etiqueta: '<path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  caja: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'
};

function catIco(nombre, tam) {
  const d = CAT_ICO[nombre] || CAT_ICO.caja;
  const t = tam || 18;
  return '<svg viewBox="0 0 24 24" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

/** Precio compacto para los KPIs: $12,3 M en vez de $12.345.678 (que no cabe). */
function catClpCorto(n) {
  const v = Number(n || 0);
  if (v >= 1000000000) return "$" + (v / 1000000000).toFixed(1).replace(".", ",") + " MM";
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(1).replace(".", ",") + " M";
  if (v >= 100000) return "$" + Math.round(v / 1000) + " mil";
  return invClp(v);
}

/* Motivos por categoría (48×48) y tintes. */
const CAT_MOTIVO = {
  abarrotes: '<path d="M14 17h20l3 19a3 3 0 0 1-3 3.4H14A3 3 0 0 1 11 36z"/><path d="m14 17 4-6h12l4 6"/><path d="M20 27h8"/>',
  bebidas: '<path d="M20 6h8v7l4 6v21a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V19l4-6z"/><path d="M16 25h16v10H16z"/>',
  alcohol: '<path d="M15 7h18l-2 9a7 7 0 0 1-14 0Z"/><path d="M24 23v12m-6 6h12"/>',
  dulces: '<rect x="14" y="16" width="20" height="16" rx="6"/><path d="m14 22-6-4v16l6-4m20-4 6 4V18l-6 4"/><path d="M21 21v6"/>',
  lacteos: '<path d="M15 21 22 12h4l7 9v17a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z"/><path d="M15 21h18"/><path d="m22 12 3 9 3-9"/>',
  congelados: '<path d="M24 8v32M10 16l28 16M38 16 10 32"/><path d="m20 11 4 4 4-4M20 37l4-4 4 4"/>',
  cosmetica: '<rect x="17" y="18" width="14" height="22" rx="4"/><path d="M21 18v-5a3 3 0 0 1 3-3 3 3 0 0 1 3 3v5"/><path d="M21 27h6"/>',
  limpieza: '<path d="M19 18h10l2 22a3 3 0 0 1-3 3.4H20A3 3 0 0 1 17 40Z"/><path d="M22 18v-6h6v6"/><path d="M31 9h5l3 4h-8"/>',
  mascotas: '<ellipse cx="24" cy="31" rx="7" ry="6"/><circle cx="14" cy="22" r="3.4"/><circle cx="21" cy="15" r="3.4"/><circle cx="29" cy="15" r="3.4"/><circle cx="36" cy="22" r="3.4"/>',
  otros: '<path d="m12 2 9 4.5v11L12 22l-9-4.5v-11L12 2Z"/><path d="M3.3 6.7 12 11l8.7-4.3M12 11v11"/>'
};
const CAT_TINTE = {
  abarrotes: "#F5B942", bebidas: "#5AD9E8", alcohol: "#B48CFF", dulces: "#FF7AC8",
  lacteos: "#7FB5FF", congelados: "#9AD8F0", cosmetica: "#D8A1FF",
  limpieza: "#6FE3B2", mascotas: "#FFA85A", otros: "#C8FF00"
};

function catMotivo(categoria, tam) {
  const d = CAT_MOTIVO[categoria] || CAT_MOTIVO.otros;
  const t = tam || 40;
  return '<svg viewBox="0 0 48 48" width="' + t + '" height="' + t +
    '" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
}

function catTinte(categoria) {
  const c = CAT_TINTE[categoria] || CAT_TINTE.otros;
  return { fondo: c + "1A", texto: c };
}

/* ── ciclo de vida ─────────────────────────────────────────────────────── */
function catIniciar() {
  CAT.activa = true;
  CAT.carro = catCarroLeer();
  if (typeof conexionIniciar === "function") conexionIniciar();
  catIr("catalogo", true);
  catCargar(false);
}

function catSalir() {
  CAT.activa = false;
  catLectorApagar();
}

/* ── navegación entre páginas del módulo ───────────────────────────────── */
function catIr(vista, silencio) {
  const paginas = {
    catalogo: ["catEscenaCatalogo", "Catálogo", "Tu tienda"],
    producto: ["catEscenaProducto", "Producto", "Detalle"],
    carrito: ["catEscenaCarrito", "Carrito", "Tu pedido"],
    checkout: ["catEscenaCheckout", "Entrega y pago", "Paso 2 de 3"],
    pago: ["catEscenaPago", "Procesando pago", "Paso 3 de 3"],
    exito: ["catEscenaExito", "Pedido confirmado", "Listo"]
  };
  if (!paginas[vista]) vista = "catalogo";
  CAT.vista = vista;
  const def = paginas[vista];
  document.querySelectorAll("#v-catalogo .cat-escena").forEach(function (s) {
    s.classList.remove("activa");
  });
  const escena = document.getElementById(def[0]);
  if (escena) escena.classList.add("activa");
  const titulo = document.getElementById("catTituloBarra");
  const sub = document.getElementById("catSubBarra");
  if (titulo) titulo.textContent = def[1];
  if (sub) sub.textContent = def[2];
  const volver = document.getElementById("catVolver");
  if (volver) volver.hidden = vista === "catalogo";
  catCarroBadge();
  if (!silencio) window.scrollTo({ top: 0, behavior: "instant" });
}

function catCarroBadge() {
  const b = document.getElementById("catCarroBadge");
  if (!b) return;
  const n = CAT.carro.reduce(function (a, x) { return a + Number(x.cantidad || 0); }, 0);
  b.textContent = n ? String(n) : "";
}

/* ── carrito persistente ───────────────────────────────────────────────── */
function catCarroLeer() {
  try {
    const raw = localStorage.getItem(CAT_CLAVE_CARRO);
    const l = raw ? JSON.parse(raw) : [];
    return Array.isArray(l) ? l.filter(function (x) { return x && x.codigo; }) : [];
  } catch (e) { return []; }
}

function catCarroGuardar() {
  try { localStorage.setItem(CAT_CLAVE_CARRO, JSON.stringify(CAT.carro)); } catch (e) {}
  catCarroBadge();
}

function catCarroAgregar(p, cantidad) {
  if (!p || !p.codigo) return;
  const n = Math.max(1, Number(cantidad || 1));
  const ya = CAT.carro.find(function (x) { return x.codigo === p.codigo; });
  if (ya) {
    ya.cantidad = Number(ya.cantidad || 0) + n;
  } else {
    CAT.carro.push({
      codigo: p.codigo,
      nombre: p.nombre || "(sin nombre)",
      precio: Number(p.precio || 0),
      categoria: p.categoria || "otros",
      unidad: p.unidad || "",
      cantidad: n,
      imagen: (catFicha(p).imagen || "")
    });
  }
  catCarroGuardar();
  if (typeof toast === "function") toast("Agregado al carrito · " + (p.nombre || ""));
}

function catCarroQuitar(codigo) {
  CAT.carro = CAT.carro.filter(function (x) { return x.codigo !== codigo; });
  catCarroGuardar();
  catPintarCarrito();
}

function catCarroCantidad(codigo, delta) {
  const it = CAT.carro.find(function (x) { return x.codigo === codigo; });
  if (!it) return;
  it.cantidad = Number(it.cantidad || 0) + delta;
  if (it.cantidad <= 0) {
    CAT.carro = CAT.carro.filter(function (x) { return x.codigo !== codigo; });
  }
  catCarroGuardar();
  catPintarCarrito();
}

function catCarroTotales() {
  const subtotal = CAT.carro.reduce(function (a, x) {
    return a + Number(x.precio || 0) * Number(x.cantidad || 0);
  }, 0);
  const envio = subtotal >= 20000 || subtotal === 0 ? 0 : 2990;
  const total = subtotal + envio;
  return { subtotal: subtotal, envio: envio, total: total };
}

/* ── datos ─────────────────────────────────────────────────────────────── */
function catFicha(p) {
  if (!p) return {};
  if (typeof invFichaDe === "function") return invFichaDe(p);
  try { return JSON.parse(p.ficha || "{}") || {}; } catch (e) { return {}; }
}

function catPanel() {
  if (CAT.panel) return Promise.resolve(CAT.panel);
  return invApiTarde("panel", {}, { maxMs: 12000 }).then(function (r) {
    if (r.ok && r.data && r.data.ok) {
      CAT.panel = r.data;
      catPintarKpis();
      catPintarChips();
    }
    return CAT.panel;
  });
}

function catCargar(mas) {
  if (CAT.cargando) return;
  CAT.cargando = true;
  if (!mas) catPintarCargando();
  const args = { limite: CAT_LOTE_NUCLEO, offset: mas ? CAT.productos.length : 0 };
  if (CAT.q) args.texto = CAT.q;
  if (CAT.cat) args.categoria = CAT.cat;

  Promise.all([invApiTarde("listar", args, { maxMs: 12000 }), catPanel()]).then(function (par) {
    CAT.cargando = false;
    const r = par[0];
    if (!r.ok || !r.data || !Array.isArray(r.data.productos)) {
      if (!mas) {
        CAT.productos = [];
        catRender();
        catAviso("No pude leer el catálogo: " + (r.error || "error"));
      }
      return;
    }
    const filas = r.data.productos;
    CAT.total = Number(r.data.total || 0);
    CAT.productos = mas ? CAT.productos.concat(filas) : filas;
    catPintarEstado();
    catRender();
    catPintarBanners();
  });
}

/* ── pintado del catálogo ──────────────────────────────────────────────── */
function catPintarKpis() {
  const caja = document.getElementById("catKpis");
  if (!caja || !CAT.panel) return;
  const r = CAT.panel.resumen || {};
  caja.innerHTML =
    '<div class="cat-kpi"><span class="cat-kpi-etq">Productos</span>' +
      '<b class="cat-kpi-valor">' + Number(r.total || 0).toLocaleString("es-CL") + '</b>' +
      '<span class="cat-kpi-pie">en tu base</span></div>' +
    '<div class="cat-kpi' + (Number(r.stock_bajo) > 0 ? " alto" : "") + '">' +
      '<span class="cat-kpi-etq">Stock bajo</span>' +
      '<b class="cat-kpi-valor">' + Number(r.stock_bajo || 0).toLocaleString("es-CL") + '</b>' +
      '<span class="cat-kpi-pie">a reponer</span></div>' +
    '<div class="cat-kpi acento"><span class="cat-kpi-etq">Valor venta</span>' +
      '<b class="cat-kpi-valor">' + catClpCorto(r.valor_venta || 0) + '</b>' +
      '<span class="cat-kpi-pie">a precio actual</span></div>';
}

function catPintarChips() {
  const caja = document.getElementById("catChips");
  if (!caja) return;
  const conteos = {};
  ((CAT.panel && CAT.panel.categorias) || []).forEach(function (c) { conteos[c.categoria] = c.n; });
  let html = '<button class="cat-chip' + (CAT.cat === "" ? " activo" : "") +
    '" data-cat="" type="button">Todas <b>' +
    Number(CAT.panel && CAT.panel.resumen ? CAT.panel.resumen.total || 0 : 0).toLocaleString("es-CL") +
    '</b></button>';
  Object.keys(INV_CATEGORIAS).forEach(function (id) {
    const n = conteos[id];
    if (!n) return;
    html += '<button class="cat-chip' + (CAT.cat === id ? " activo" : "") +
      '" data-cat="' + id + '" type="button">' + INV_CATEGORIAS[id] +
      ' <b>' + Number(n).toLocaleString("es-CL") + '</b></button>';
  });
  caja.innerHTML = html;
  caja.querySelectorAll(".cat-chip").forEach(function (b) {
    b.addEventListener("click", function () {
      const id = b.dataset.cat || "";
      if (CAT.cat === id) return;
      CAT.cat = id;
      catPintarChips();
      catCargar(false);
    });
  });
}

function catPintarCargando() {
  const caja = document.getElementById("catLista");
  if (!caja) return;
  caja.innerHTML = '<div class="cat-skeleton"></div><div class="cat-skeleton"></div>' +
    '<div class="cat-skeleton"></div><div class="cat-skeleton"></div>';
}

function catPintarEstado() {
  const caja = document.getElementById("catEstado");
  if (!caja) return;
  const n = CAT.productos.length;
  const d = new Date();
  const hora = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  caja.innerHTML = n
    ? "Mostrando <b>" + Number(n).toLocaleString("es-CL") + "</b> de <b>" +
      Number(CAT.total).toLocaleString("es-CL") + "</b> · " + hora
    : "Sin resultados";
}

function catAviso(msg) {
  const caja = document.getElementById("catAviso");
  if (caja) caja.textContent = msg || "";
}

/* Promoción determinista por producto: siempre la misma para el mismo código,
   pero variada entre productos. */
function catPromo(p) {
  const cod = String(p.codigo || "");
  let h = 0;
  for (let i = 0; i < cod.length; i++) h = (h * 31 + cod.charCodeAt(i)) >>> 0;
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const precio = Number(p.precio || 0);
  if (stock <= 0) return null;
  if (stock <= minimo) return { texto: "Últimas " + stock, clase: "ambar" };
  if (precio >= 15000) return { texto: "Envío gratis", clase: "" };
  const r = h % 6;
  if (r === 0) return { texto: "Oferta", clase: "rojo" };
  if (r === 1) return { texto: "2x1", clase: "" };
  if (r === 2) return { texto: "Top ventas", clase: "ambar" };
  if (r === 3) return { texto: "-15%", clase: "rojo" };
  if (r === 4) return { texto: "Recomendado", clase: "" };
  return null;
}

function catCardHtml(p) {
  const t = catTinte(p.categoria);
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const claseStock = stock <= 0 ? " cero" : (stock <= minimo ? " bajo" : "");
  const promo = catPromo(p);
  const f = catFicha(p);
  const img = f.imagen
    ? '<img src="' + esc(f.imagen) + '" alt="" loading="lazy" ' +
      'onerror="this.remove()" />'
    : catMotivo(p.categoria, 40);
  return '<article class="cat-card" data-codigo="' + esc(p.codigo || "") + '" ' +
      'style="--cat-tinte:' + t.fondo + ';--cat-tinte-txt:' + t.texto + '">' +
    '<div class="cat-card-thumb">' + img +
      (promo ? '<span class="cat-card-promo ' + promo.clase + '">' + promo.texto + '</span>' : "") +
      '<span class="cat-card-stock' + claseStock + '">' + stock + ' und</span>' +
    '</div>' +
    '<b class="cat-card-nombre">' + esc(p.nombre || "(sin nombre)") + '</b>' +
    '<span class="cat-card-meta">' + esc(p.marca || "Sin marca") +
      (p.unidad ? " · " + esc(p.unidad) : "") + '</span>' +
    '<span class="cat-card-precio"><b>' + invClp(p.precio || 0) + '</b></span>' +
    '<span class="cat-card-codigo">' + esc(p.codigo || "") + '</span>' +
    '<button class="cat-card-agregar" data-agregar="' + esc(p.codigo || "") + '" type="button">' +
      catIco("carro", 14) + ' Agregar</button>' +
    '</article>';
}

function catRender() {
  const caja = document.getElementById("catLista");
  if (!caja) return;
  if (!CAT.productos.length) {
    caja.innerHTML = '<div class="cat-vacio">' + catIco("buscar", 32) +
      "<b>Sin productos para esta búsqueda</b>" +
      "<span>Prueba otro texto, toca «Todas» o escanea el código.</span></div>";
    return;
  }
  const visibles = CAT.productos.slice(0, CAT.lote);
  const restantes = CAT.total - visibles.length;
  caja.innerHTML = visibles.map(catCardHtml).join("") +
    (restantes > 0
      ? '<button class="cat-btn bloque" id="catMas" type="button" style="grid-column:1/-1">' +
        catIco("mas", 16) + " Ver " + Number(restantes).toLocaleString("es-CL") + " más</button>"
      : "");
  const b = document.getElementById("catMas");
  if (b) b.addEventListener("click", catMas);
  caja.querySelectorAll(".cat-card").forEach(function (c) {
    c.addEventListener("click", function (ev) {
      if (ev.target.closest("[data-agregar]")) return;
      catAbrirProducto(c.dataset.codigo);
    });
  });
  caja.querySelectorAll("[data-agregar]").forEach(function (b2) {
    b2.addEventListener("click", function (ev) {
      ev.stopPropagation();
      const p = CAT.productos.find(function (x) { return x.codigo === b2.dataset.agregar; });
      if (p) catCarroAgregar(p, 1);
    });
  });
}

function catMas() {
  if (CAT.productos.length < CAT.total) { catCargar(true); return; }
  CAT.lote += 24;
  catRender();
}

function catBuscar(texto) {
  CAT.q = String(texto || "").trim();
  clearTimeout(catBuscar._t);
  catBuscar._t = setTimeout(function () { catCargar(false); }, 260);
}

/* ── banners de promoción en SVG (español) ─────────────────────────────── */
function catBannerSvg(tipo, p) {
  const nombre = esc((p && p.nombre ? p.nombre : "Productos seleccionados").slice(0, 18)) +
    ((p && p.nombre && p.nombre.length > 18) ? "…" : "");
  const precio = p && p.precio ? invClp(p.precio) : "";
  const tema = [
    { fondo: "#C8FF00", texto: "#0A0A0A", acento: "#0A0A0A" },
    { fondo: "#141414", texto: "#F5F6F2", acento: "#C8FF00" },
    { fondo: "#FF5A4E", texto: "#FFF6F2", acento: "#0A0A0A" }
  ][tipo % 3];
  const titulos = [
    ["OFERTA FLASH", "hasta 30% OFF", "en productos seleccionados"],
    ["PRECIO BAJÓ", "nuevos precios", "en tu catálogo local"],
    ["LLEVA 3 PAGA 2", "en toda la tienda", "mientras haya stock"]
  ][tipo % 3];
  return '<svg viewBox="0 0 640 260" role="img" aria-label="' + titulos[0] + '">' +
    '<defs><linearGradient id="bg' + tipo + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + tema.fondo + '"/>' +
      '<stop offset="1" stop-color="' + (tema.fondo === "#141414" ? "#1F211D" : tema.fondo) + '"/>' +
    '</linearGradient></defs>' +
    '<rect width="640" height="260" rx="28" fill="url(#bg' + tipo + ')"/>' +
    (tema.fondo === "#C8FF00"
      ? '<g opacity="0.12" stroke="#0A0A0A" stroke-width="2">' +
        '<path d="M0 210 210 0M120 260 330 50M300 260 510 50M480 260 640 100"/></g>'
      : '<g opacity="0.16" stroke="' + tema.acento + '" stroke-width="2">' +
        '<path d="M0 210 210 0M120 260 330 50M300 260 510 50M480 260 640 100"/></g>') +
    '<text x="40" y="72" fill="' + tema.acento + '" font-family="system-ui,-apple-system,sans-serif" ' +
      'font-size="15" font-weight="700" letter-spacing="4">' + titulos[0] + '</text>' +
    '<text x="40" y="128" fill="' + tema.texto + '" font-family="system-ui,-apple-system,sans-serif" ' +
      'font-size="42" font-weight="800" letter-spacing="-1.5">' + titulos[1] + '</text>' +
    '<text x="40" y="164" fill="' + tema.texto + '" opacity="0.72" ' +
      'font-family="system-ui,-apple-system,sans-serif" font-size="17" font-weight="500">' +
      titulos[2] + '</text>' +
    '<rect x="40" y="190" rx="14" width="200" height="44" fill="' +
      (tema.fondo === "#C8FF00" ? "#0A0A0A" : tema.acento) + '"/>' +
    '<text x="140" y="218" text-anchor="middle" fill="' +
      (tema.fondo === "#C8FF00" ? "#C8FF00" : "#0A0A0A") + '" ' +
      'font-family="system-ui,-apple-system,sans-serif" font-size="15" font-weight="800">' +
      'VER OFERTAS</text>' +
    '<g transform="translate(430 60)">' +
      '<rect x="0" y="0" width="150" height="140" rx="24" fill="' +
        (tema.fondo === "#C8FF00" ? "rgba(10,10,10,0.08)" : "rgba(200,255,0,0.10)") + '"/>' +
      '<text x="75" y="58" text-anchor="middle" fill="' + tema.texto + '" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="11.5" font-weight="600" ' +
        'opacity="0.8">' + nombre + '</text>' +
      '<text x="75" y="96" text-anchor="middle" fill="' + tema.acento + '" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="24" font-weight="800">' +
        precio + '</text>' +
      '<text x="75" y="118" text-anchor="middle" fill="' + tema.texto + '" opacity="0.55" ' +
        'font-family="system-ui,-apple-system,sans-serif" font-size="10" font-weight="600">' +
        'precio tienda</text>' +
    '</g>' +
    '</svg>';
}

function catPintarBanners() {
  const caja = document.getElementById("catBanners");
  if (!caja) return;
  // Productos variados: los que más stock tienen, rotando por categoría.
  const conStock = CAT.productos.filter(function (p) { return Number(p.stock || 0) > 0; });
  const pick = [];
  const vistos = {};
  for (let i = 0; i < conStock.length && pick.length < 3; i++) {
    const p = conStock[(i * 7 + 3) % conStock.length];
    const k = p.categoria + "|" + p.codigo;
    if (vistos[k]) continue;
    vistos[k] = 1;
    if (pick.some(function (x) { return x.categoria === p.categoria; })) continue;
    pick.push(p);
  }
  if (!pick.length) { caja.innerHTML = ""; return; }
  caja.innerHTML = pick.map(function (p, i) {
    return '<div class="cat-banner" data-banner="' + esc(p.codigo) + '">' +
      catBannerSvg(i, p) + '</div>';
  }).join("");
  caja.querySelectorAll(".cat-banner").forEach(function (b) {
    b.addEventListener("click", function () { catAbrirProducto(b.dataset.banner); });
  });
}

/* ── página de producto ────────────────────────────────────────────────── */
function catAbrirProducto(codigo) {
  if (!codigo) return;
  const p = CAT.productos.find(function (x) { return x.codigo === codigo; });
  if (!p) { if (typeof toast === "function") toast("Producto no encontrado en la página actual."); return; }
  CAT.producto = p;
  catPintarProducto(p);
  catIr("producto");
}

function catPintarProducto(p) {
  const t = catTinte(p.categoria);
  const f = catFicha(p);
  const stock = Number(p.stock || 0);
  const minimo = Number(p.stock_minimo || 0);
  const claseStock = stock <= 0 ? " cero" : (stock <= minimo ? " bajo" : "");
  const img = f.imagen
    ? '<img src="' + esc(f.imagen) + '" alt="" onerror="this.parentNode.classList.add(\'sin-img\');this.remove()" />'
    : catMotivo(p.categoria, 96);

  const cajaImg = document.getElementById("catDetalleImg");
  if (cajaImg) {
    cajaImg.innerHTML = img + '<span class="cat-card-stock cat-detalle-stock' + claseStock + '">' +
      stock + " und</span>";
  }

  const cab = document.getElementById("catDetalleCab");
  if (cab) {
    cab.innerHTML =
      '<h2>' + esc(p.nombre || "(sin nombre)") + '</h2>' +
      '<span class="cat-detalle-marca">' + esc(p.marca || "Sin marca") +
        (p.unidad ? " · " + esc(p.unidad) : "") + '</span>' +
      '<div class="cat-detalle-precio"><b>' + invClp(p.precio || 0) + '</b>' +
        (Number(p.costo || 0) > 0 ? '<s>' + invClp(p.costo) + '</s>' : "") + '</div>';
  }

  const datos = document.getElementById("catDetalleDatos");
  if (datos) {
    datos.innerHTML =
      '<div class="cat-dato"><span>Código</span><b>' + esc(p.codigo || "") + '</b></div>' +
      '<div class="cat-dato"><span>Categoría</span><b>' +
        esc(INV_CATEGORIAS[p.categoria] || p.categoria || "Otros") + '</b></div>' +
      '<div class="cat-dato"><span>Stock</span><b>' + stock + ' und</b></div>' +
      '<div class="cat-dato"><span>Stock mínimo</span><b>' + minimo + ' und</b></div>' +
      '<div class="cat-dato"><span>Proveedor</span><b>' + esc(p.proveedor || "—") + '</b></div>';
  }

  const wiki = document.getElementById("catDetalleWiki");
  if (wiki) {
    const etiquetas = [];
    (f.etiquetas || []).forEach(function (id) {
      const et = (typeof invFreeEtiqueta === "function") ? invFreeEtiqueta(id) : id;
      etiquetas.push('<span class="cat-etq ok">' + esc(et) + '</span>');
    });
    if (f.nutriscore) etiquetas.push('<span class="cat-etq alerta">Nutri-Score ' + esc(String(f.nutriscore).toUpperCase()) + '</span>');
    if (f.nova) etiquetas.push('<span class="cat-etq">NOVA ' + esc(String(f.nova)) + '</span>');
    if ((f.alergenos || []).length) {
      etiquetas.push('<span class="cat-etq error">Alérgenos: ' + esc(f.alergenos.join(", ")) + '</span>');
    }
    const desc = f.descripcion || p.notas || "";
    if (!desc && !etiquetas.length) {
      wiki.hidden = true;
    } else {
      wiki.hidden = false;
      wiki.innerHTML = '<h3>Ficha del producto</h3>' +
        (desc ? '<p>' + esc(desc) + '</p>' : "") +
        (etiquetas.length ? '<div class="cat-wiki-etiquetas">' + etiquetas.join("") + '</div>' : "");
    }
  }

  const rel = document.getElementById("catRelacionados");
  if (rel) {
    const mismos = CAT.productos.filter(function (x) {
      return x.codigo !== p.codigo && x.categoria === p.categoria;
    }).slice(0, 8);
    if (!mismos.length) { rel.hidden = true; }
    else {
      rel.hidden = false;
      rel.innerHTML = '<h3>También te puede interesar</h3><div class="cat-relacionados-lista">' +
        mismos.map(function (r) {
          const tt = catTinte(r.categoria);
          const ff = catFicha(r);
          return '<div class="cat-rel-card" data-rel="' + esc(r.codigo) + '" ' +
            'style="--cat-tinte:' + tt.fondo + ';--cat-tinte-txt:' + tt.texto + '">' +
            '<span class="cat-rel-thumb">' +
              (ff.imagen ? '<img src="' + esc(ff.imagen) + '" alt="" loading="lazy" onerror="this.remove()" style="width:100%;height:100%;object-fit:contain;padding:4px" />'
                : catMotivo(r.categoria, 30)) + '</span>' +
            '<b>' + esc(r.nombre || "") + '</b>' +
            '<span>' + invClp(r.precio || 0) + '</span></div>';
        }).join("") + '</div>';
      rel.querySelectorAll("[data-rel]").forEach(function (c) {
        c.addEventListener("click", function () { catAbrirProducto(c.dataset.rel); });
      });
    }
  }
}

function catProductoAgregar() {
  const p = CAT.producto;
  if (!p) return;
  catCarroAgregar(p, 1);
  catIr("carrito");
}

/* ── carrito ───────────────────────────────────────────────────────────── */
function catPintarCarrito() {
  const lista = document.getElementById("catCarroLista");
  const tot = document.getElementById("catCarroTotales");
  if (!lista) return;
  if (!CAT.carro.length) {
    lista.innerHTML = '<div class="cat-vacio">' + catIco("carro", 34) +
      "<b>Tu carrito está vacío</b><span>Agrega productos desde el catálogo.</span></div>";
    if (tot) tot.innerHTML = "";
    return;
  }
  lista.innerHTML = CAT.carro.map(function (it) {
    const t = catTinte(it.categoria);
    return '<div class="cat-carro-item" style="--cat-tinte:' + t.fondo + ';--cat-tinte-txt:' + t.texto + '">' +
      '<span class="cat-carro-thumb">' +
        (it.imagen ? '<img src="' + esc(it.imagen) + '" alt="" onerror="this.remove()" />' : catMotivo(it.categoria, 26)) +
      '</span>' +
      '<div class="cat-carro-info"><b>' + esc(it.nombre) + '</b>' +
        '<span>' + invClp(it.precio) + '</span></div>' +
      '<div class="cat-carro-cant">' +
        '<button type="button" data-menos="' + esc(it.codigo) + '" aria-label="Quitar uno">−</button>' +
        '<b>' + it.cantidad + '</b>' +
        '<button type="button" data-mas="' + esc(it.codigo) + '" aria-label="Agregar uno">+</button>' +
      '</div></div>';
  }).join("");
  lista.querySelectorAll("[data-mas]").forEach(function (b) {
    b.addEventListener("click", function () { catCarroCantidad(b.dataset.mas, 1); });
  });
  lista.querySelectorAll("[data-menos]").forEach(function (b) {
    b.addEventListener("click", function () { catCarroCantidad(b.dataset.menos, -1); });
  });
  const t = catCarroTotales();
  if (tot) {
    tot.innerHTML =
      '<div class="cat-total-linea"><span>Subtotal</span><b>' + invClp(t.subtotal) + '</b></div>' +
      '<div class="cat-total-linea"><span>Envío</span><b>' +
        (t.envio ? invClp(t.envio) : "Gratis") + '</b></div>' +
      '<div class="cat-total-linea grande"><span>Total</span><b>' + invClp(t.total) + '</b></div>';
  }
}

/* ── checkout ──────────────────────────────────────────────────────────── */
function catPintarCheckout() {
  const t = catCarroTotales();
  const resumen = document.getElementById("catCheckoutResumen");
  if (resumen) {
    resumen.innerHTML =
      '<div class="cat-total-linea"><span>' + CAT.carro.length + ' producto(s)</span><b>' +
        invClp(t.subtotal) + '</b></div>' +
      '<div class="cat-total-linea"><span>Envío</span><b>' + (t.envio ? invClp(t.envio) : "Gratis") + '</b></div>' +
      '<div class="cat-total-linea grande"><span>Total</span><b>' + invClp(t.total) + '</b></div>';
  }
}

function catIrPagar() {
  if (!CAT.carro.length) { if (typeof toast === "function") toast("Tu carrito está vacío.", "error"); return; }
  catPintarCheckout();
  catIr("checkout");
}

function catConfirmarPedido(ev) {
  if (ev) ev.preventDefault();
  const nombre = (document.getElementById("catNombre") || {}).value || "";
  const direccion = (document.getElementById("catDireccion") || {}).value || "";
  const comuna = (document.getElementById("catComuna") || {}).value || "";
  const telefono = (document.getElementById("catTelefono") || {}).value || "";
  if (!nombre.trim() || !direccion.trim() || !comuna.trim()) {
    if (typeof toast === "function") toast("Completa nombre, dirección y comuna.", "error");
    return;
  }
  const metodo = document.querySelector('input[name="catPago"]:checked');
  const entrega = document.querySelector('input[name="catEntrega"]:checked');
  const t = catCarroTotales();
  CAT.pedido = {
    folio: "F-" + Date.now().toString().slice(-6),
    nombre: nombre.trim(),
    direccion: direccion.trim(),
    comuna: comuna.trim(),
    telefono: telefono.trim(),
    pago: metodo ? metodo.value : "WebPay",
    entrega: entrega ? entrega.value : "Despacho 24H",
    items: CAT.carro.slice(),
    subtotal: t.subtotal,
    envio: t.envio,
    total: t.total,
    ts: Date.now()
  };
  try { localStorage.setItem(CAT_CLAVE_PEDIDO, JSON.stringify(CAT.pedido)); } catch (e) {}
  catIr("pago");
  catSimularPago();
}

/* ── pago simulado ─────────────────────────────────────────────────────── */
function catSimularPago() {
  const aro = document.getElementById("catPagoAro");
  const pct = document.getElementById("catPagoPct");
  const pasos = ["Validando datos", "Autorizando pago", "Confirmando pedido"];
  let i = 0;
  const total = 100;
  const paso = function () {
    i += 1;
    const p = Math.round((i / pasos.length) * total);
    if (aro) aro.style.strokeDashoffset = String(264 - (264 * p) / 100);
    if (pct) pct.textContent = p + "%";
    document.querySelectorAll("#catPagoPasos .cat-pago-paso").forEach(function (el, idx) {
      el.classList.toggle("hecho", idx < i - 1);
      el.classList.toggle("activo", idx === i - 1);
    });
    if (i < pasos.length) {
      setTimeout(paso, 900);
    } else {
      document.querySelectorAll("#catPagoPasos .cat-pago-paso").forEach(function (el) {
        el.classList.add("hecho");
        el.classList.remove("activo");
      });
      setTimeout(catExito, 500);
    }
  };
  setTimeout(paso, 400);
}

/* ── éxito + seguimiento ───────────────────────────────────────────────── */
function catExito() {
  const p = CAT.pedido;
  if (!p) { catIr("catalogo"); return; }
  const caja = document.getElementById("catExitoCaja");
  if (caja) {
    caja.innerHTML =
      '<div class="cat-exito-cab">' +
        '<div class="cat-exito-check">' + catIco("check", 36) + '</div>' +
        '<h2>¡Pedido confirmado!</h2>' +
        '<p>Folio <b>' + esc(p.folio) + '</b> · ' + esc(p.pago) + ' · ' + esc(p.entrega) + '</p>' +
      '</div>' +
      '<div class="cat-seguimiento">' +
        '<div class="cat-seg-cab"><span>' + esc(p.entrega) + ' · en camino</span><b>60%</b></div>' +
        '<div class="cat-seg-barra"><i style="width:60%"></i></div>' +
        '<div class="cat-seg-pasos">' +
          '<div class="cat-seg-paso hecho"><i></i>Pedido confirmado</div>' +
          '<div class="cat-seg-paso hecho"><i></i>Preparado</div>' +
          '<div class="cat-seg-paso hecho"><i></i>En camino</div>' +
          '<div class="cat-seg-paso"><i></i>Entregado</div>' +
        '</div>' +
      '</div>' +
      '<div class="cat-totales">' +
        '<div class="cat-total-linea"><span>Envío a</span><b>' + esc(p.direccion) + ', ' + esc(p.comuna) + '</b></div>' +
        '<div class="cat-total-linea"><span>Productos</span><b>' + p.items.length + '</b></div>' +
        '<div class="cat-total-linea grande"><span>Total pagado</span><b>' + invClp(p.total) + '</b></div>' +
      '</div>';
  }
  catIr("exito");
  CAT.carro = [];
  catCarroGuardar();
  catPintarCarrito();
}

/* ── lector de código de barras (mismo que el inventario) ──────────────── */
function catLectorCaja() { return document.getElementById("catLectorCaja"); }
function catLectorVideo() { return document.getElementById("catLectorVideo"); }
function catLectorNota(msg) {
  const n = document.getElementById("catLectorNota");
  if (n) n.textContent = msg || "";
}
function catLectorPintar(on) {
  const btn = document.getElementById("btnCatLector");
  if (!btn) return;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  const b = btn.querySelector("b");
  if (b) b.textContent = on ? "ON" : "OFF";
}

function catLectorToggle() {
  if (CAT.lector.activo) catLectorApagar();
  else catLectorEncender();
}

function catLectorEncender() {
  const video = catLectorVideo();
  const caja = catLectorCaja();
  if (!video || !caja) return;
  caja.hidden = false;

  if (typeof window.BarcodeDetector !== "function" && typeof invEscanearCuadro !== "function") {
    catLectorNota("Este Android no trae detector nativo: escribe el código.");
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    catLectorNota("Sin acceso a la cámara en este dispositivo.");
    return;
  }
  // Una sola cámara en toda la app: se apaga la del inventario si estaba.
  if (typeof invLectorParar === "function") invLectorParar();

  catLectorPintar(true);
  catLectorNota("Abriendo cámara…");
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false
  }).then(function (stream) {
    CAT.lector.stream = stream;
    CAT.lector.activo = true;
    video.srcObject = stream;
    video.hidden = false;
    if (typeof window.BarcodeDetector === "function" && !CAT.lector.detector) {
      CAT.lector.detector = new window.BarcodeDetector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"]
      });
    }
    catLectorNota("Lector activo · apunta al código");
    video.play().catch(function () {});
    CAT.lector.raf = requestAnimationFrame(catLectorBucle);
  }).catch(function (e) {
    catLectorPintar(false);
    catLectorNota("No pude abrir la cámara: " + (e && e.message ? e.message : "permiso denegado"));
    if (typeof toast === "function") toast("Revisa el permiso de cámara.", "error");
  });
}

function catLectorApagar() {
  const l = CAT.lector;
  if (l.raf) cancelAnimationFrame(l.raf);
  l.raf = 0;
  if (l.stream) l.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
  l.stream = null;
  l.activo = false;
  l.detector = null;
  l.ultimo = "";
  const video = catLectorVideo();
  if (video) { video.srcObject = null; video.hidden = true; }
  const caja = catLectorCaja();
  if (caja) caja.hidden = true;
  const mira = document.getElementById("catLectorMira");
  if (mira) mira.hidden = true;
  catLectorPintar(false);
  catLectorNota("Lector apagado.");
}

function catLectorBucle(ts) {
  const l = CAT.lector;
  if (!l.activo) return;
  l.raf = requestAnimationFrame(catLectorBucle);
  if (ts - l.ultimoMs < 180) return;
  l.ultimoMs = ts;
  const video = catLectorVideo();
  if (!video || !video.videoWidth) return;
  const leer = function (codigos) {
    if (!codigos || !codigos.length || !CAT.lector.activo) return;
    const raw = codigos[0].rawValue;
    if (raw && raw !== l.ultimo) {
      l.ultimo = raw;
      catLectorLeido(String(raw));
    }
  };
  if (l.detector) {
    l.detector.detect(video).then(leer).catch(function () {});
  } else if (typeof invEscanearCuadro === "function") {
    const v = invEscanearCuadro("catLectorVideo");
    if (v) leer([{ rawValue: v }]);
  }
}

function catLectorLeido(codigo) {
  const mira = document.getElementById("catLectorMira");
  if (mira) mira.hidden = false;
  const p = CAT.productos.find(function (x) { return x.codigo === codigo; });
  const res = document.getElementById("catLectorResultado");
  catLectorApagar();
  const input = document.getElementById("catBuscar");
  if (input) input.value = codigo;
  CAT.q = codigo;
  catCargar(false);

  if (p) {
    if (res) {
      res.innerHTML = '<div class="cat-lec-ficha"><b>' + esc(p.nombre || "") + '</b>' +
        '<span class="cat-lec-linea"><span>Código</span><span>' + esc(p.codigo) + '</span></span>' +
        '<span class="cat-lec-linea"><span>Precio</span><span>' + invClp(p.precio || 0) + '</span></span>' +
        '<span class="cat-lec-linea"><span>Stock</span><span>' + Number(p.stock || 0) + ' und</span></span>' +
        '<button class="cat-btn lima bloque" id="catLecVer" type="button">Ver producto</button></div>';
      const b = res.querySelector("#catLecVer");
      if (b) b.addEventListener("click", function () { catAbrirProducto(p.codigo); });
    }
    if (typeof toast === "function") toast("Encontrado: " + (p.nombre || codigo));
  } else {
    if (res) {
      res.innerHTML = '<div class="cat-lec-ficha"><b>Sin coincidencia</b>' +
        '<span class="cat-lec-linea"><span>Código leído</span><span>' + esc(codigo) + '</span></span>' +
        '<span class="cat-lec-linea"><span>Acción</span><span>Escríbelo en el buscador</span></span></div>';
    }
    if (typeof toast === "function") toast("Código leído: " + codigo);
  }
}

/* ── luz piloto de conexión ────────────────────────────────────────────── */
const CONEXION = { estado: "espera", ms: 0, ts: 0, timer: 0, corriendo: false };

function conexionIniciar() {
  if (CONEXION.corriendo) return;
  CONEXION.corriendo = true;
  window.addEventListener("online", function () { conexionPing(); });
  window.addEventListener("offline", function () { conexionPintar("error", 0, "Sin internet"); });
  conexionPing();
  CONEXION.timer = setInterval(conexionPing, 45000);
}

function conexionPing() {
  if (navigator.onLine === false) { conexionPintar("error", 0, "Sin internet"); return; }
  conexionPintar("espera", 0, "Verificando…");
  const t0 = Date.now();
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const limite = setTimeout(function () { if (ctrl) ctrl.abort(); }, 6000);
  fetch("https://fabri-api.vercel.app/api/health", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
    .then(function (r) {
      clearTimeout(limite);
      const ms = Date.now() - t0;
      if (r.ok) conexionPintar(ms > 2500 ? "aviso" : "ok", ms, ms > 2500 ? "Nube lenta" : "En línea");
      else conexionPintar("aviso", ms, "Nube HTTP " + r.status);
    }).catch(function () {
      clearTimeout(limite);
      if (navigator.onLine === false) conexionPintar("error", 0, "Sin internet");
      else conexionPintar("aviso", 0, "Sin nube");
    });
}

function conexionPintar(estado, ms, texto) {
  CONEXION.estado = estado;
  CONEXION.ms = ms;
  CONEXION.ts = Date.now();
  ["pilotoConexion", "catPiloto", "invPilotoConexion"].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "piloto-conexion " + estado;
    const hora = new Date();
    const hh = String(hora.getHours()).padStart(2, "0") + ":" + String(hora.getMinutes()).padStart(2, "0");
    // En la barra del módulo el piloto va compacto: ahí manda el título.
    if (id === "catPiloto") {
      el.innerHTML = "<i></i>" + esc(texto);
      el.title = texto + (ms ? " · " + ms + " ms" : "") + " · " + hh;
      return;
    }
    el.innerHTML = "<i></i>" + esc(texto) + (ms ? " · " + ms + " ms" : "") + " · " + hh;
  });
}

/* ── eventos ───────────────────────────────────────────────────────────── */
(function catMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnCatLector")) { catLectorToggle(); return; }
    if (t.closest("#catVolver")) { catIr("catalogo"); return; }
    if (t.closest("#catBtnCarro")) { catPintarCarrito(); catIr("carrito"); return; }
    if (t.closest("#catIrPagar")) { catIrPagar(); return; }
    if (t.closest("#catAgregarDetalle")) { catProductoAgregar(); return; }
    if (t.closest("#catSeguirComprando")) { catIr("catalogo"); return; }
    if (t.closest("#catVolverTienda")) { catIr("catalogo"); return; }
    if (t.closest("#catVolverTienda2")) { catIr("catalogo"); return; }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "catBuscar") catBuscar(ev.target.value);
  });
  const form = document.getElementById("catFormPedido");
  if (form) form.addEventListener("submit", catConfirmarPedido);
})();
