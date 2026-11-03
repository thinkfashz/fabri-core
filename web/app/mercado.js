/* ============================================================================
   MERCADO · escaparate de pequeños comerciantes
   ----------------------------------------------------------------------------
   Catálogo servido por fabri-api (/api/catalogo) con respaldo local. Cada
   producto se muestra con su categoría, stock, código de barras y precio; al
   abrirlo se ve la ficha completa con la barra de cantidad.

   El código de barras se calcula con el dígito verificador EAN-13 y se dibuja
   en SVG (95 módulos), así que es un código real y no una decoración.
   ========================================================================== */

window.Mercado = (function () {
  "use strict";

  const API = "https://fabri-api.vercel.app/api/catalogo";
  const CLAVE = "fcore.mercado.carrito";

  // Espejo del catálogo del backend (para offline / antes del deploy).
  const SEED = [
    { id: "eq-001", nombre: "Caja registradora táctil", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Pantalla de 15,6\" con Android integrado, impresora térmica de 80 mm y batería de respaldo.", precio: 489990, moneda: "CLP", stock: 12, tinte: "#C8FF00" },
    { id: "eq-002", nombre: "Lector de códigos láser", categoria: "Equipos", clasificacion: "Gama media", descripcion: "Escáner de mano ergonómico, lee EAN-13, Code128 y QR a 30 cm.", precio: 45990, moneda: "CLP", stock: 40, tinte: "#5AD9E8" },
    { id: "eq-003", nombre: "Báscula de mostrador", categoria: "Equipos", clasificacion: "Economico", descripcion: "Capacidad 30 kg, precisión de 5 g, cabezal orientable con teclado.", precio: 74990, moneda: "CLP", stock: 8, tinte: "#B48CFF" },
    { id: "eq-004", nombre: "Terminal de punto de venta", categoria: "Equipos", clasificacion: "Gama alta", descripcion: "Procesador dual-core, doble pantalla, soporte VESA y 4 GB de RAM.", precio: 359990, moneda: "CLP", stock: 5, tinte: "#C8FF00" },
    { id: "ac-001", nombre: "Papel térmico 80 mm", categoria: "Insumos", clasificacion: "Gama media", descripcion: "Rollos de 50 mm de diámetro, calidad industrial, por caja de 50 unidades.", precio: 18990, moneda: "CLP", stock: 120, tinte: "#FFB020" },
    { id: "ac-002", nombre: "Cinta para medir stock", categoria: "Insumos", clasificacion: "Economico", descripcion: "Rollo de 300 etiquetas por caja, resistente a agua y frío.", precio: 8990, moneda: "CLP", stock: 86, tinte: "#5AD9E8" },
    { id: "ac-003", nombre: "Cargador de sobremesa", categoria: "Accesorios", clasificacion: "Gama media", descripcion: "Fuente de 12 V / 3 A con cable de 1,5 m, ideal para terminales POS.", precio: 12990, moneda: "CLP", stock: 34, tinte: "#FFB020" },
    { id: "ac-004", nombre: "Soporte metálico para display", categoria: "Accesorios", clasificacion: "Economico", descripcion: "Base orientable 360° con brazo ajustable en altura.", precio: 15990, moneda: "CLP", stock: 22, tinte: "#B48CFF" },
    { id: "au-001", nombre: "Altavoz de mostrador", categoria: "Audio", clasificacion: "Gama media", descripcion: "5 W, plug 3,5 mm, carcasa de aluminio.", precio: 19990, moneda: "CLP", stock: 18, tinte: "#C8FF00" },
    { id: "au-002", nombre: "Torre de sonido para local", categoria: "Audio", clasificacion: "Gama alta", descripcion: "2×50 W, Bluetooth, entrada USB y control remoto.", precio: 129990, moneda: "CLP", stock: 6, tinte: "#3DDC84" },
    { id: "pr-001", nombre: "Lámina anti-robo para vitrina", categoria: "Protección", clasificacion: "Premium", descripcion: "Lámina de seguridad de 0,22 mm con adhesivo de alta sujeción.", precio: 34990, moneda: "CLP", stock: 4, tinte: "#5AA9FF" },
    { id: "pr-002", nombre: "Candado de vitrina", categoria: "Protección", clasificacion: "Gama media", descripcion: "Cuerpo de acero, llave doble y cierre reforzado.", precio: 11990, moneda: "CLP", stock: 15, tinte: "#3DDC84" }
  ];

  let datos = null;
  let origen = "nube";
  const estado = { q: "", categoria: "", clasificacion: "", max: -1 };
  let carrito = {};
  let vista = "estantes";
  let pasillo = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function clp(n) {
    try { return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n); }
    catch (e) { return "$" + Math.round(n).toLocaleString("es-CL"); }
  }

  /* ── código de barras EAN-13 ───────────────────────────────────────────── */
  // Determinista por producto: mismo código siempre, con dígito verificador.
  function codigoDe(p) {
    // Prefijo 780 = Chile, más 9 dígitos del producto y el verificador EAN-13.
    const base = String(p.id || p.nombre || "0").split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000000000, 7);
    const doce = "780" + String(base).padStart(9, "0");
    let suma = 0;
    for (let i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 ? 3 : 1);
    const dv = (10 - (suma % 10)) % 10;
    return doce + dv;
  }

  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
  const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
  const PARIDAD = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

  function ean13Svg(numero) {
    const n = String(numero).padEnd(13, "0").slice(0, 13);
    const p = PARIDAD[Number(n[0])];
    let bits = "101";
    for (let i = 1; i <= 6; i++) bits += (p[i - 1] === "L" ? L : G)[Number(n[i])];
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[Number(n[i])];
    bits += "101";

    let barras = "";
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") barras += '<rect x="' + i + '" y="0" width="1" height="46"/>';
    }
    return '<svg class="merc-ean" viewBox="0 0 95 58" preserveAspectRatio="none" aria-label="Código de barras ' +
      n + '">' + barras + "</svg>" + '<span class="merc-ean-num">' + n + "</span>";
  }

  /* ── datos ─────────────────────────────────────────────────────────────── */
  async function cargar() {
    try {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(API, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(reloj);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.productos)) {
        datos = d; origen = "nube"; return datos;
      }
    } catch (e) { /* offline o endpoint sin desplegar */ }
    datos = { ok: true, total: SEED.length, productos: SEED, origen: "local" };
    origen = "local";
    return datos;
  }

  function categorias() {
    return [...new Set((datos.productos || []).map((p) => p.categoria).filter(Boolean))].sort();
  }
  function clasificaciones() {
    return [...new Set((datos.productos || []).map((p) => p.clasificacion).filter(Boolean))].sort();
  }
  function filtrados() {
    const q = estado.q.toLowerCase();
    return (datos.productos || []).filter((p) => {
      if (estado.categoria && p.categoria !== estado.categoria) return false;
      if (estado.clasificacion && p.clasificacion !== estado.clasificacion) return false;
      if (estado.max >= 0 && p.precio > estado.max) return false;
      if (q) {
        const t = (p.nombre + " " + p.descripcion + " " + p.categoria + " " + p.clasificacion + " " + codigoDe(p)).toLowerCase();
        if (!t.includes(q)) return false;
      }
      return true;
    });
  }

  /* ── carrito ───────────────────────────────────────────────────────────── */
  function leerCarrito() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch (e) { return {}; }
  }
  function guardarCarrito() {
    try { localStorage.setItem(CLAVE, JSON.stringify(carrito)); } catch (e) { /* privado */ }
    pintarBarra();
  }
  function unidades() { return Object.values(carrito).reduce((a, n) => a + n, 0); }
  function total() {
    return Object.keys(carrito).reduce((a, id) => {
      const p = (datos.productos || []).find((x) => x.id === id);
      return a + (p ? p.precio * carrito[id] : 0);
    }, 0);
  }
  function cambiar(id, delta) {
    const n = (carrito[id] || 0) + delta;
    if (n <= 0) delete carrito[id]; else carrito[id] = n;
    guardarCarrito();
    pintarVista();
    if (detalleActual && detalleActual.id === id) pintarDetalle();
  }

  function pintarBarra() {
    const barra = $("mercBarra");
    if (!barra) return;
    const n = unidades();
    barra.hidden = n === 0;
    const t = $("mercBarraTotal");
    const c = $("mercBarraCount");
    if (t) t.textContent = clp(total());
    if (c) c.textContent = n + (n === 1 ? " producto" : " productos");
  }

  /* ── tarjetas ──────────────────────────────────────────────────────────── */
  function tinteDe(p) {
    return p.tinte || {
      Equipos: "#C8FF00", Insumos: "#FFB020", Accesorios: "#B48CFF",
      Audio: "#3DDC84", Protección: "#5AA9FF"
    }[p.categoria] || "#C8FF00";
  }

  function pintarChips(cont, lista, sel, fn) {
    if (!cont) return;
    cont.innerHTML = lista.map((c) => '<button class="mp-chip' + (c === sel ? " on" : "") +
      '" data-k="' + esc(c) + '" type="button">' + esc(c) + "</button>").join("");
    cont.querySelectorAll(".mp-chip").forEach((ch) => {
      ch.onclick = () => fn(ch.dataset.k === sel ? "" : ch.dataset.k);
    });
  }

  /* ── minimarket: pasillos y estantes ───────────────────────────────────── */
  function repartir(lista, filas) {
    const porFila = Math.max(1, Math.ceil(lista.length / filas));
    const out = [];
    for (let i = 0; i < filas; i++) out.push(lista.slice(i * porFila, (i + 1) * porFila));
    return out;
  }

  function caja(p, copia) {
    const n = carrito[p.id] || 0;
    const tinte = tinteDe(p);
    // Frentes: un producto con mucho stock ocupa más espacio en el estante,
    // como en un supermercado. Las copias no repiten nombre ni precio.
    return '<button type="button" class="mm-prod' + (copia ? " mm-rep" : "") + (n ? " en-carrito" : "") + '" data-id="' + esc(p.id) +
      '" style="--tinte:' + tinte + '" aria-label="' + esc(p.nombre) + '">' +
      '<span class="mm-caja">' +
        '<span class="mm-caja-tapa"></span>' +
        '<span class="mm-caja-letra">' + esc((p.nombre || "?").charAt(0)) + "</span>" +
        (copia ? "" : '<span class="mm-caja-nom">' + esc(p.nombre) + "</span>") +
        (n && !copia ? '<span class="mm-caja-cant">' + n + "</span>" : "") +
      "</span>" +
      (copia ? "" : '<span class="mm-tag">' + clp(p.precio) + "</span>") +
      '<span class="mm-caja-stock' + (p.stock <= 10 ? " bajo" : "") + '">' + p.stock + "</span>" +
    "</button>";
  }

  // Un pasillo = hasta 16 productos (4 filas × 4 frentes). Las categorías se
  // agrupan de a una para que el estante nunca quede medio vacío.
  function construirPasillos(lista) {
    const grupos = categorias()
      .map((c) => ({ cat: c, items: lista.filter((p) => p.categoria === c) }))
      .filter((g) => g.items.length);
    const pasillos = [];
    let actual = null;
    grupos.forEach((g) => {
      if (!actual || actual.items.length + g.items.length > 16) {
        actual = { cats: [], items: [] };
        pasillos.push(actual);
      }
      actual.cats.push(g.cat);
      actual.items = actual.items.concat(g.items);
    });
    return pasillos.map((p) => ({
      titulo: p.cats[0] + (p.cats.length > 1 ? " y más" : ""),
      detalle: p.cats.join(" · "),
      items: p.items
    }));
  }

  function renderEstantes(lista) {
    const cont = $("mmPasillos");
    if (!cont) return;
    const grupos = construirPasillos(lista);

    if (!grupos.length) {
      cont.innerHTML = '<div class="mm-vacio"><b>Sin productos en este pasillo</b><p>Cambia el filtro o busca otra cosa.</p></div>';
      actualizarCabecera([], 0);
      return;
    }

    cont.innerHTML = grupos.map((g, i) => {
      const filas = repartir(g.items, Math.min(4, Math.max(1, Math.ceil(g.items.length / 4))));
      return '<section class="mm-pasillo" data-i="' + i + '">' +
        '<div class="mm-cartel"><span>Pasillo ' + (i + 1) + "</span><b>" + esc(g.titulo) + "</b></div>" +
        '<div class="mm-estante">' +
          filas.map((fila, fi) => '<div class="mm-fila">' +
            '<span class="mm-fila-n">' + (fi + 1) + "</span>" +
            '<div class="mm-fila-prods">' + fila.map((p) => {
              const frentes = Math.min(3, 1 + Math.floor(p.stock / 25));
              return Array.from({ length: frentes }, (_, k) => caja(p, k > 0)).join("");
            }).join("") + "</div>" +
          "</div>").join("") +
        "</div>" +
      "</section>";
    }).join("");

    const puntos = $("mmPuntos");
    if (puntos) {
      puntos.innerHTML = grupos.map((g, i) =>
        '<button type="button" data-i="' + i + '" aria-label="Pasillo ' + (i + 1) + ": " + esc(g.cat) + '"' +
        (i === pasillo ? ' class="on"' : "") + "></button>").join("");
      puntos.querySelectorAll("button").forEach((b) => {
        b.onclick = () => irPasillo(Number(b.dataset.i));
      });
    }

    cont.querySelectorAll(".mm-prod").forEach((b) => {
      b.onclick = () => {
        const p = datos.productos.find((x) => x.id === b.dataset.id);
        if (p) abrirDetalle(p);
      };
    });

    actualizarCabecera(grupos, pasillo);
    irPasillo(Math.min(pasillo, grupos.length - 1), true);
  }

  function actualizarCabecera(grupos, i) {
    const g = grupos[i];
    const num = $("mmNum"), tot = $("mmTot"), cat = $("mmCat"), sub = $("mmSub");
    if (num) num.textContent = grupos.length ? i + 1 : 0;
    if (tot) tot.textContent = grupos.length;
    if (cat) cat.textContent = g ? g.titulo : "—";
    if (sub) sub.textContent = g ? g.items.length + " productos · " + g.detalle : "—";
  }

  function irPasillo(i, silencioso) {
    const cont = $("mmPasillos");
    if (!cont || !cont.children.length) return;
    pasillo = Math.max(0, Math.min(i, cont.children.length - 1));
    cont.scrollTo({ left: pasillo * cont.clientWidth, behavior: silencioso ? "auto" : "smooth" });
    const grupos = construirPasillos(filtrados());
    actualizarCabecera(grupos, pasillo);
    const puntos = $("mmPuntos");
    if (puntos) puntos.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === pasillo));
  }

  function pintarVista() {
    const mm = $("mm"), grid = $("mercGrid");
    if (!mm || !grid) return;
    const estantes = vista === "estantes";
    mm.hidden = !estantes;
    grid.hidden = estantes;
    const extra = $("mercExtra");
    if (extra) extra.hidden = estantes;
    const sec = $("s-mercado");
    if (sec) sec.classList.toggle("vista-estantes", estantes);
    if (estantes) renderEstantes(filtrados());
    else renderGrid(filtrados());
  }

  function renderGrid(lista) {
    const grid = $("mercGrid");
    if (!grid) return;
    const count = $("mercCount");
    if (count) {
      count.textContent = lista.length + (lista.length === 1 ? " producto" : " productos");
      count.className = "badge " + (lista.length ? "acc" : "warn");
    }
    if (!lista.length) {
      grid.innerHTML = '<div class="merc-vacio"><b>Sin coincidencias</b><p>Prueba con otro filtro o busca otra cosa.</p></div>';
      return;
    }
    grid.innerHTML = lista.map((p) => {
      const n = carrito[p.id] || 0;
      const tinte = tinteDe(p);
      const codigo = codigoDe(p);
      return '<article class="merc-card2' + (n ? " en-carrito" : "") + '" data-id="' + esc(p.id) + '" tabindex="0">' +
        '<div class="merc-media" style="--tinte:' + tinte + '">' +
          '<span class="merc-media-letra">' + esc((p.nombre || "?").charAt(0)) + "</span>" +
          '<span class="merc-media-cat">' + esc(p.categoria) + "</span>" +
          '<span class="merc-media-stock' + (p.stock <= 10 ? " bajo" : "") + '">' + p.stock + " disp.</span>" +
        "</div>" +
        '<div class="merc-cuerpo">' +
          '<h3 class="merc-titulo">' + esc(p.nombre) + "</h3>" +
          '<p class="merc-desc2">' + esc(p.descripcion) + "</p>" +
          '<div class="merc-meta">' +
            '<span class="merc-cod">' + esc(codigo) + "</span>" +
            '<span class="merc-clas">' + esc(p.clasificacion) + "</span>" +
          "</div>" +
          '<div class="merc-pie">' +
            '<div class="merc-precio2"><b>' + clp(p.precio) + "</b><small>" + esc(p.moneda || "CLP") + "</small></div>" +
            (n
              ? '<div class="merc-cant"><button type="button" data-menos="' + esc(p.id) + '" aria-label="Quitar">−</button>' +
                "<b>" + n + '</b><button type="button" data-mas="' + esc(p.id) + '" aria-label="Agregar">+</button></div>'
              : '<button type="button" class="merc-add" data-mas="' + esc(p.id) + '">Agregar</button>') +
          "</div>" +
        "</div>" +
      "</article>";
    }).join("");

    grid.querySelectorAll("[data-mas]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); cambiar(b.dataset.mas, 1); };
    });
    grid.querySelectorAll("[data-menos]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); cambiar(b.dataset.menos, -1); };
    });
    grid.querySelectorAll(".merc-card2").forEach((card) => {
      card.onclick = () => {
        const p = datos.productos.find((x) => x.id === card.dataset.id);
        if (p) abrirDetalle(p);
      };
    });
  }

  /* ── ficha del producto ────────────────────────────────────────────────── */
  let detalleActual = null;

  function abrirDetalle(p) {
    detalleActual = p;
    const hoja = $("mercHoja");
    if (!hoja) return;
    hoja.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarDetalle();
    const panel = hoja.querySelector(".mp-hoja-panel");
    if (panel) panel.scrollTop = 0;
  }
  function cerrarDetalle() {
    const hoja = $("mercHoja");
    if (hoja) hoja.hidden = true;
    document.body.classList.remove("mp-abierto");
    detalleActual = null;
  }

  function pintarDetalle() {
    const p = detalleActual;
    if (!p) return;
    const n = carrito[p.id] || 0;
    const codigo = codigoDe(p);
    $("mercHojaNombre").textContent = p.nombre;
    $("mercHojaSub").textContent = [p.categoria, p.clasificacion].filter(Boolean).join(" · ");
    $("mercHojaCuerpo").innerHTML =
      '<div class="merc-ficha-media" style="--tinte:' + tinteDe(p) + '">' +
        '<span class="merc-ficha-letra">' + esc((p.nombre || "?").charAt(0)) + "</span>" +
        '<span class="merc-ficha-cat">' + esc(p.categoria) + " · " + esc(p.clasificacion) + "</span>" +
      "</div>" +
      '<p class="merc-ficha-desc">' + esc(p.descripcion) + "</p>" +
      '<div class="merc-ficha-datos">' +
        '<div><span>Precio</span><b>' + clp(p.precio) + "</b></div>" +
        '<div><span>Stock</span><b>' + p.stock + " un.</b></div>" +
        '<div><span>Moneda</span><b>' + esc(p.moneda || "CLP") + "</b></div>" +
      "</div>" +
      '<div class="merc-ficha-codigo"><div class="merc-barras">' + ean13Svg(codigo) + "</div>" +
        '<small>EAN-13 · ' + codigo + "</small></div>" +
      '<div class="merc-cant-barra">' +
        '<button type="button" id="mercDetMenos" aria-label="Quitar uno">−</button>' +
        '<div class="merc-cant-pista"><span style="width:' + Math.min(100, n * 12) + '%"></span></div>' +
        '<b id="mercDetNum">' + n + "</b>" +
        '<button type="button" id="mercDetMas" aria-label="Agregar uno">+</button>' +
      "</div>" +
      '<button type="button" class="btn primary block" id="mercDetAdd">' +
        (n ? "Agregar otro · " + clp(p.precio) : "Agregar al pedido · " + clp(p.precio)) + "</button>";

    $("mercDetMas").onclick = () => cambiar(p.id, 1);
    $("mercDetMenos").onclick = () => cambiar(p.id, -1);
    $("mercDetAdd").onclick = () => cambiar(p.id, 1);
  }

  /* ── hoja del carrito ──────────────────────────────────────────────────── */
  function abrirCarrito() {
    const h = $("mercCarrito");
    if (!h) return;
    h.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarCarrito();
    const panel = h.querySelector(".mp-hoja-panel");
    if (panel) panel.scrollTop = 0;
  }
  function cerrarCarrito() {
    const h = $("mercCarrito");
    if (h) h.hidden = true;
    document.body.classList.remove("mp-abierto");
  }

  function lineas() {
    return Object.keys(carrito).map((id) => {
      const p = (datos.productos || []).find((x) => x.id === id);
      return p ? { p: p, n: carrito[id] } : null;
    }).filter(Boolean);
  }

  function pintarCarrito() {
    const cuerpo = $("mercCarritoCuerpo"), pie = $("mercCarritoPie");
    if (!cuerpo || !pie) return;
    const items = lineas();
    const totalPedido = items.reduce((a, x) => a + x.p.precio * x.n, 0);
    const unidadesTot = items.reduce((a, x) => a + x.n, 0);

    $("mercCarritoSub").textContent = unidadesTot
      ? unidadesTot + (unidadesTot === 1 ? " producto" : " productos")
      : "vacío";

    if (!items.length) {
      cuerpo.innerHTML = '<div class="mp-vacio"><b>Tu pedido está vacío</b><p>Agrega productos desde los estantes.</p></div>';
      pie.innerHTML = "";
      return;
    }

    cuerpo.innerHTML =
      '<div class="mc-lista">' + items.map((x) =>
        '<div class="mc-linea">' +
          '<span class="mc-ico" style="--tinte:' + tinteDe(x.p) + '">' + esc(x.p.nombre.charAt(0)) + "</span>" +
          '<div class="mc-txt"><b>' + esc(x.p.nombre) + "</b><small>" + clp(x.p.precio) + " c/u</small></div>" +
          '<div class="mc-cant">' +
            '<button type="button" data-menos="' + esc(x.p.id) + '" aria-label="Quitar">−</button>' +
            "<b>" + x.n + "</b>" +
            '<button type="button" data-mas="' + esc(x.p.id) + '" aria-label="Agregar">+</button>' +
          "</div>" +
          '<b class="mc-sub">' + clp(x.p.precio * x.n) + "</b>" +
        "</div>").join("") +
      "</div>";

    pie.innerHTML =
      '<div class="mp-car-total"><span>Total</span><b>' + clp(totalPedido) + "</b></div>" +
      '<button type="button" class="btn primary block" id="mcPedir">Pedir por WhatsApp</button>' +
      '<button type="button" class="mp-link" id="mcVaciar">Vaciar pedido</button>';

    cuerpo.querySelectorAll("[data-mas]").forEach((b) => {
      b.onclick = () => { cambiar(b.dataset.mas, 1); pintarCarrito(); };
    });
    cuerpo.querySelectorAll("[data-menos]").forEach((b) => {
      b.onclick = () => { cambiar(b.dataset.menos, -1); pintarCarrito(); };
    });
    $("mcPedir").onclick = () => pedirWhatsApp(items, totalPedido);
    $("mcVaciar").onclick = () => { carrito = {}; guardarCarrito(); pintarCarrito(); pintarBarra(); render(); };
  }

  function pedirWhatsApp(items, totalPedido) {
    const texto = "Pedido a Mercado FORGE\n\n" +
      items.map((x) => "• " + x.n + " × " + x.p.nombre + " — " + clp(x.p.precio * x.n)).join("\n") +
      "\n\nTotal: " + clp(totalPedido) +
      "\n\nEnviado desde MercadoPlacer · FORGE CORE STOCK";
    if (navigator.share) {
      navigator.share({ title: "Pedido Mercado FORGE", text: texto }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(texto).then(
      () => { if (window.Fabri) window.Fabri.toast("Pedido copiado"); },
      () => { if (window.Fabri) window.Fabri.toast("No pude copiar el pedido"); }
    );
  }

  /* ── escáner ───────────────────────────────────────────────────────────── */
  async function escanear() {
    if (!window.Scan) {
      if (window.Fabri) window.Fabri.toast("El escáner no está disponible");
      return;
    }
    let code = null;
    try { code = await window.Scan.abrir({ subtitulo: "apunta al código del producto" }); } catch (e) { return; }
    if (!code) return;
    const limpio = String(code).trim();
    const p = (datos.productos || []).find((x) => codigoDe(x) === limpio) ||
      (datos.productos || []).find((x) => (x.id || "").toLowerCase() === limpio.toLowerCase());
    if (p) { abrirDetalle(p); return; }
    estado.q = limpio;
    const q = $("mercQ");
    if (q) q.value = limpio;
    render();
    if (window.Fabri) window.Fabri.toast("Sin coincidencia para " + limpio);
  }

  /* ── ciclo ─────────────────────────────────────────────────────────────── */
  async function render() {
    if (!datos) await cargar();
    carrito = leerCarrito();

    pintarChips($("mercCats"), categorias(), estado.categoria, (v) => { estado.categoria = v; render(); });
    pintarChips($("mercClas"), clasificaciones(), estado.clasificacion, (v) => { estado.clasificacion = v; render(); });

    const q = $("mercQ");
    if (q && q.value !== estado.q) q.value = estado.q;

    const max = $("mercMax"), maxVal = $("mercMaxVal");
    if (max && maxVal) {
      max.max = 500000;
      max.value = estado.max < 0 ? 500000 : estado.max;
      maxVal.textContent = clp(estado.max < 0 ? 500000 : estado.max);
    }

    const nota = $("mercNota");
    if (nota) {
      nota.textContent = origen === "nube"
        ? "Catálogo servido por fabri-api · /api/catalogo"
        : "Sin red o API sin desplegar: catálogo local de respaldo";
    }

    pintarVista();
    pintarBarra();
  }

  function init() {
    const q = $("mercQ");
    const qx = $("mercQx");
    if (q) q.addEventListener("input", () => {
      estado.q = q.value;
      if (qx) qx.hidden = !q.value;
      if (vista === "estantes") renderEstantes(filtrados()); else renderGrid(filtrados());
    });
    if (qx) qx.onclick = () => {
      estado.q = ""; if (q) q.value = ""; qx.hidden = true;
      if (vista === "estantes") renderEstantes(filtrados()); else renderGrid(filtrados());
    };
    const scan = $("mercScan");
    if (scan) scan.onclick = escanear;

    const ver = $("mercVerCarrito");
    if (ver) ver.onclick = abrirCarrito;
    const cx = $("mercCarritoX"), cf = $("mercCarritoFondo");
    if (cx) cx.onclick = cerrarCarrito;
    if (cf) cf.onclick = cerrarCarrito;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const h = $("mercCarrito");
        if (h && !h.hidden) cerrarCarrito();
      }
    });

    const max = $("mercMax"), maxVal = $("mercMaxVal");
    if (max && maxVal) {
      max.addEventListener("input", () => {
        estado.max = Number(max.value) >= 500000 ? -1 : Number(max.value);
        maxVal.textContent = clp(Number(max.value));
        renderGrid(filtrados());
      });
    }

    document.querySelectorAll("#mercVista button").forEach((b) => {
      b.onclick = () => {
        vista = b.dataset.vista;
        document.querySelectorAll("#mercVista button").forEach((x) => {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-selected", x === b);
        });
        pintarVista();
      };
    });

    const prev = $("mmPrev"), next = $("mmNext"), cont = $("mmPasillos");
    if (prev) prev.onclick = () => irPasillo(pasillo - 1);
    if (next) next.onclick = () => irPasillo(pasillo + 1);
    if (cont) {
      let t = null;
      cont.addEventListener("scroll", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const i = Math.round(cont.scrollLeft / cont.clientWidth);
          if (i !== pasillo) {
            pasillo = i;
            const grupos = construirPasillos(filtrados());
            actualizarCabecera(grupos, i);
            const puntos = $("mmPuntos");
            if (puntos) puntos.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i));
          }
        }, 90);
      }, { passive: true });
    }

    const ir3d = $("merc3d");
    if (ir3d) ir3d.onclick = () => { if (window.Fabri) window.Fabri.go("tienda"); };

    const salir3d = $("t3dSalir");
    if (salir3d) salir3d.onclick = () => { if (window.Fabri) window.Fabri.go("mercado"); };
    const car3d = $("t3dCarrito");
    if (car3d) car3d.onclick = () => { if (window.Fabri) window.Fabri.go("mercado"); };

    const x = $("mercHojaX"), fondo = $("mercHojaFondo");
    if (x) x.onclick = cerrarDetalle;
    if (fondo) fondo.onclick = cerrarDetalle;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && detalleActual) cerrarDetalle();
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);

  return { render, abrirDetalle, productos: () => (datos ? datos.productos : []) };
})();
