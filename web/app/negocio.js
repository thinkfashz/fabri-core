/* ============================================================================
   NEGOCIO · panel del local (multi-tienda)
   ----------------------------------------------------------------------------
   El dueño entra con SU CUENTA de la nube (la misma de `/api/auth`) y desde
   acá:

     · crea su tienda con nombre, marca, logo, rubro, dirección y GPS;
     · publica el catálogo y el stock (uno por uno, CSV/JSON o desde su base
       local de Stock);
     · ve y avanza los pedidos que llegan desde MercadoPlacer;
     · edita la ficha que aparece en el mapa (marca, logo, descripción,
       horario, mínimo, envío).

   Autorización: la cuenta dueña del local (`Authorization: Bearer`) manda. La
   `clave` de 8 caracteres sigue existiendo como respaldo para la APK y para
   quien ya tenía un local creado por el admin; se conecta desde el bloque
   «Conectar con ID y clave».

   El historial de compras hecho en ESTE teléfono sigue viviendo en
   localStorage (`fcore.placer.pedidos`) y se mezcla con los pedidos de la
   nube sin duplicar los del local conectado.
   ========================================================================== */

window.Negocio = (function () {
  "use strict";

  const API = "https://fabri-api.vercel.app/api/mercado";
  const CLAVE = "fcore.placer.pedidos";          // historial local (placer.js)
  const CLAVE_NUBE = "fcore.negocio.nube";       // respaldo {local_id, clave}
  const CLAVE_SEL = "fcore.negocio.sel";         // tienda elegida
  const MAX_LOGO = 120 * 1024;                   // 120 KB de data URI
  const LOGO_PX = 192;                           // lado máximo del logo
  const MAX_FOTO = 200 * 1024;                   // 200 KB de data URI (tope API: 220.000)
  const FOTO_PX = 640;                           // lado máximo de la foto de producto
  const MAX_CATALOGO = 3000;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clp(n) {
    return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
  }

  function leerJSON(clave, porDefecto) {
    try {
      const v = JSON.parse(localStorage.getItem(clave) || "null");
      return v === null || v === undefined ? porDefecto : v;
    } catch (e) { return porDefecto; }
  }
  function guardarJSON(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }
  function borrarJSON(clave) {
    try { localStorage.removeItem(clave); } catch (e) { /* modo privado */ }
  }

  function hora(ts) {
    return new Date(ts).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  }
  function dia(ts) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (ts >= hoy.getTime()) return "hoy";
    const ayer = hoy.getTime() - 86400000;
    if (ts >= ayer) return "ayer";
    return new Date(ts).toLocaleDateString("es-CL", { day: "2-digit", month: "short" });
  }
  function tarjeta(k, v, d, tono) {
    return '<div class="neg-kpi' + (tono ? " " + tono : "") + '">' +
      "<span>" + esc(k) + "</span><b>" + esc(v) + "</b><small>" + esc(d) + "</small></div>";
  }
  function toast(txt) {
    try { if (window.Fabri && window.Fabri.toast) window.Fabri.toast(txt); } catch (e) { /* opcional */ }
  }
  function aviso(el, txt, tono) {
    if (!el) return;
    el.textContent = txt || "";
    el.className = "neg-aviso" + (tono ? " " + tono : "");
  }

  /* ── estado ─────────────────────────────────────────────────────────────── */
  const EST = {
    token: "",
    cuenta: null,        // { email, nombre, rol }
    modo: "",            // "cuenta" | "clave" | ""
    tiendas: [],         // mis tiendas con catálogo
    sel: null,           // tienda abierta
    pedidos: [],         // pedidos de la nube del local abierto
    pedidosTotal: 0,     // total del local en la nube (no el de la página)
    pedidosNuevos: 0,    // sin abrir todavía
    pedidosAbiertos: 0,  // sin entregar ni cancelar
    cargando: false,
    ts: 0,
    aviso: "",
    logoNueva: "",       // data URI del formulario de alta
    logoEditar: "",      // data URI del formulario de ficha
    editandoSku: "",     // producto que se está editando
    /* Foto del producto en el formulario:
       · undefined → no se tocó (si edita, se conserva la que ya tenía)
       · ""        → se quitó (el servidor la borra al guardar)
       · data URL  → foto nueva comprimida por el navegador */
    prodImagen: undefined,
    pendienteSel: "",    // tienda a seleccionar tras refrescar
    avisosConsultados: false, // ya se preguntó al navegador si hay suscripción
    /* panel de administración */
    tab: "resumen",      // "resumen" | "pedidos" | "catalogo" | "ajustes"
    rango: 7,            // días del resumen (7 o 30)
    serie: null,         // respuesta de ventas_serie
    serieTs: 0,          // cuándo llegó (para el «en vivo»)
    serieError: "",
    cargandoSerie: false,
    buscar: "",          // filtro de la lista de pedidos
    filtro: "",          // "" | "abiertos" | estado
    verificando: "",     // pedido al que se le está pidiendo el código de entrega
    errorVerif: "",      // el servidor rechazó el código: se muestra en la caja
    resenas: null,       // { calificacion, resenas } de resenas_panel
    resenasError: "",
    cargandoResenas: false
  };

  /* ── red ────────────────────────────────────────────────────────────────── */
  function tokenNube() {
    try {
      if (!window.CoreNube) return "";
      const d = window.CoreNube.leer();
      if (!d || !d.token) return "";
      if (d.exp && Number(d.exp) <= Date.now()) return "";
      return d.token;
    } catch (e) { return ""; }
  }

  async function api(cuerpo) {
    const cabeceras = { "Content-Type": "application/json" };
    if (EST.token) cabeceras.Authorization = "Bearer " + EST.token;
    // La sesión está atada a este dispositivo: sin esta cabecera la nube no
    // puede recalcular la huella y responde DISPOSITIVO.
    try {
      cabeceras["X-Dispositivo"] = (window.CoreNube && window.CoreNube.dispositivo)
        ? window.CoreNube.dispositivo() : "navegador";
    } catch (e) { cabeceras["X-Dispositivo"] = "navegador"; }
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify(cuerpo)
      });
      const d = await r.json().catch(() => ({}));
      const res = d && typeof d === "object" ? d : { ok: false, error: "respuesta inválida" };
      if (res && res.codigo === "DISPOSITIVO") {
        // El token guardado no pertenece a este equipo: se borra para no
        // reintentar en bucle. El espejo local y la clave siguen sirviendo.
        try { if (window.CoreNube) window.CoreNube.limpiar(); } catch (e) {}
        EST.token = "";
        EST.cuenta = null;
        EST.tiendas = [];
        EST.sel = null;
        EST.aviso = "La sesión se abrió en otro dispositivo: vuelve a entrar desde este.";
      }
      return res;
    } catch (e) {
      return { ok: false, error: "Sin conexión con la nube.", codigo: "SIN_RED" };
    }
  }

  /* ── pedidos locales (este teléfono) ────────────────────────────────────── */
  function leer() {
    const v = leerJSON(CLAVE, []);
    return Array.isArray(v) ? v : [];
  }
  function guardar(lista) { guardarJSON(CLAVE, lista); }

  function aLocal(p) {
    return {
      codigo: p.codigo || p.id,
      pedido_id: p.id,
      nube: true,
      seguimiento: p.seguimiento || "",
      fecha: Date.parse(p.creado) || Date.now(),
      items: (p.items || []).map((x) => ({
        nombre: x.nombre, precio: x.precio, cantidad: x.cantidad,
        lista: x.precio_lista != null ? Number(x.precio_lista) : undefined,
        descuento: Number(x.descuento) || 0
      })),
      subtotal: Number(p.subtotal) || 0,
      envio: Number(p.envio) || 0,
      total: Number(p.total) || 0,
      ahorro: Number(p.ahorro) || 0,
      entrega: p.entrega === "delivery" ? "delivery" : "retiro",
      direccion: p.direccion || "",
      comuna: p.comuna_entrega || "",
      referencia: p.referencia_entrega || "",
      metodo: p.metodo_pago || "",
      pagoCon: Number(p.pago_con) || 0,
      vuelto: Number(p.vuelto) || 0,
      requiereClave: p.requiere_clave === true,
      cliente: { nombre: p.cliente || "", telefono: p.telefono || "" },
      estado: p.estado || "nuevo",
      eventos: Array.isArray(p.eventos) ? p.eventos : []
    };
  }

  /** Nombre legible del pago para el panel del local. */
  function etiquetaPagoLocal(m) {
    return m === "efectivo" ? "Efectivo"
      : m === "transferencia" ? "Transferencia"
      : m === "tarjeta" ? "Tarjeta (simulada)"
      : "Pago por confirmar";
  }

  /**
   * Contador del local abierto. Cuando hay nube manda el total del servidor
   * (no el de la página); sin conexión se cuenta lo que quedó en este teléfono,
   * y se dice: nunca se muestra un número que no sea real.
   */
  function contarPedidos() {
    if (!EST.sel) return { total: 0, abiertos: 0, nuevos: 0, origen: "nube" };
    const conNube = EST.modo === "cuenta" || EST.pedidos.length > 0;
    if (conNube) {
      return {
        total: EST.pedidosTotal, abiertos: EST.pedidosAbiertos,
        nuevos: EST.pedidosNuevos, origen: "nube",
      };
    }
    const local = leer().filter((p) => p.local && p.local.id === EST.sel.id);
    return {
      total: local.length,
      abiertos: local.filter((p) => p.estado !== "entregado" && p.estado !== "cancelado").length,
      nuevos: 0,
      origen: "local",
    };
  }

  /* Los pedidos visibles: los de la nube del local abierto + los locales de
     OTROS locales (para no duplicar el mismo pedido hecho en este teléfono). */
  function pedidosVisibles() {
    const local = leer();
    if (!EST.sel) return local;
    const otros = local.filter((p) => !(p.local && p.local.id === EST.sel.id));
    return EST.pedidos.concat(otros).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  }

  /* ── filtros y exportación (puros: se prueban sin DOM ni red) ───────────── */
  function normalizarBusqueda(s) {
    return String(s == null ? "" : s).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  /** Pedidos que coinciden con el texto y el estado elegidos. */
  function filtrarPedidos(pedidos, buscar, filtro) {
    const q = normalizarBusqueda(buscar);
    return (Array.isArray(pedidos) ? pedidos : []).filter((p) => {
      if (filtro === "abiertos") {
        if (p.estado === "entregado" || p.estado === "cancelado") return false;
      } else if (filtro && p.estado !== filtro) {
        return false;
      }
      if (!q) return true;
      const texto = normalizarBusqueda([
        p.codigo,
        p.cliente && p.cliente.nombre,
        p.cliente && p.cliente.telefono,
        p.direccion,
        (p.items || []).map((x) => x.nombre).join(" ")
      ].filter(Boolean).join(" "));
      return texto.indexOf(q) >= 0;
    });
  }

  /** Pedidos → CSV para Excel chileno (separador «;» y BOM). */
  function csvPedidos(pedidos) {
    const cabecera = ["codigo", "fecha", "cliente", "telefono", "entrega",
      "direccion", "productos", "subtotal", "envio", "total", "estado"];
    const celda = (v) => {
      const s = String(v == null ? "" : v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const filas = (Array.isArray(pedidos) ? pedidos : []).map((p) => [
      p.codigo || "",
      p.fecha ? new Date(p.fecha).toISOString() : "",
      (p.cliente && p.cliente.nombre) || "",
      (p.cliente && p.cliente.telefono) || "",
      p.entrega === "delivery" ? "delivery" : "retiro",
      p.direccion || "",
      (p.items || []).map((x) => x.cantidad + "x " + x.nombre).join(" | "),
      Number(p.subtotal) || 0,
      Number(p.envio) || 0,
      Number(p.total) || 0,
      p.estado || ""
    ].map(celda).join(";"));
    return [cabecera.join(";")].concat(filas).join("\r\n");
  }

  /** Serie diaria → barras con alto relativo y etiqueta legible. */
  function barrasSerie(serie) {
    const datos = Array.isArray(serie) ? serie : [];
    if (!datos.length) return [];
    const max = Math.max(1, ...datos.map((d) => Number(d.ventas) || 0));
    const cada = datos.length <= 10 ? 1 : 5;
    return datos.map((d, i) => {
      const ventas = Number(d.ventas) || 0;
      const ultimo = i === datos.length - 1;
      return {
        dia: d.dia,
        ventas,
        pedidos: Number(d.pedidos) || 0,
        alto: Math.max(2, Math.round((ventas / max) * 100)),
        // Con 30 barras no caben 30 números: se rotula cada 5 y el último.
        etiqueta: (i % cada === 0 || ultimo) ? String(d.dia || "").slice(8, 10) : "",
        hoy: ultimo
      };
    });
  }

  /* ── logo ───────────────────────────────────────────────────────────────── */
  function pintarLogo(el, data) {
    if (!el) return;
    el.innerHTML = data
      ? '<img src="' + esc(data) + '" alt="Logo de la tienda">'
      : '<span class="neg-logo-vacio">Sin logo</span>';
  }

  /* Achica la imagen en el navegador (192 px de lado, JPEG) para que el data
     URI no engorde la base ni el JSON. Sin servicio externo de archivos. */
  function achicarLogo(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Elige un archivo de imagen (PNG, JPG o WebP)."));
        return;
      }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("No pude leer la imagen."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("La imagen no se pudo abrir."));
        img.onload = () => {
          const lado = Math.max(img.width || 1, img.height || 1);
          const k = Math.min(1, LOGO_PX / lado);
          const w = Math.max(1, Math.round((img.width || 1) * k));
          const h = Math.max(1, Math.round((img.height || 1) * k));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) { reject(new Error("Este navegador no puede procesar la imagen.")); return; }
          // Fondo blanco: un PNG con transparencia no debe quedar negro al
          // convertirlo a JPEG.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let uri = c.toDataURL("image/jpeg", 0.78);
          if (uri.length > MAX_LOGO) uri = c.toDataURL("image/jpeg", 0.52);
          if (uri.length > MAX_LOGO) {
            reject(new Error("El logo queda muy pesado: usa una imagen más simple."));
            return;
          }
          resolve(uri);
        };
        img.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }

  /* Achica la foto del producto en el navegador (640 px de lado, JPEG 0.7)
     antes de mandarla. La API guarda el data URL y publica una URL corta;
     así el catálogo no viaja con la imagen adentro. */
  function achicarFoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Elige una foto (JPG, PNG o WebP)."));
        return;
      }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("No pude leer la foto."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("La foto no se pudo abrir."));
        img.onload = () => {
          const lado = Math.max(img.width || 1, img.height || 1);
          const k = Math.min(1, FOTO_PX / lado);
          const w = Math.max(1, Math.round((img.width || 1) * k));
          const h = Math.max(1, Math.round((img.height || 1) * k));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) { reject(new Error("Este navegador no puede procesar la foto.")); return; }
          // Fondo blanco: una foto PNG con transparencia no queda negra.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          let uri = c.toDataURL("image/jpeg", 0.7);
          if (uri.length > MAX_FOTO) uri = c.toDataURL("image/jpeg", 0.5);
          if (uri.length > MAX_FOTO) {
            reject(new Error("La foto queda muy pesada: usa una imagen más simple."));
            return;
          }
          resolve(uri);
        };
        img.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }

  /* ── importación de catálogo ────────────────────────────────────────────── */
  const SINONIMOS = {
    nombre: ["nombre", "name", "producto", "descripcion", "detalle"],
    precio: ["precio", "price", "valor", "pvp", "venta"],
    // El código de barras va ANTES de sku: «codigo_barras» empieza con
    // «codigo» y, si sku fuera primero, se lo quedaría como SKU.
    codigo: ["codigo_barras", "codigo_de_barras", "barcode", "ean", "ean13", "upc", "gtin", "barra"],
    sku: ["sku", "codigo", "code"],
    stock: ["stock", "cantidad", "qty", "existencias", "inventario"],
    categoria: ["categoria", "category", "rubro", "tipo", "familia"],
    unidad: ["unidad", "unit", "medida", "formato"],
    // El descuento es un porcentaje entero 0–90. Se aceptan los nombres que
    // usan las planillas chilenas; la fecha de fin es opcional.
    descuento: ["descuento", "dcto", "desc", "rebaja", "off", "promo"],
    oferta_hasta: ["oferta_hasta", "hasta", "vence", "vencimiento", "vigencia", "termina"]
  };

  /** ¿La fila trae esta columna? Sirve para no borrar una oferta existente
   *  cuando se importa una lista de stock que no habla de descuentos. */
  function tieneCampo(obj, claves) {
    return Object.keys(obj || {}).some((e) => {
      const k = normClave(e);
      return claves.some((c) => k === c || k.startsWith(c + "_") || k.endsWith("_" + c));
    });
  }

  function normClave(s) {
    return String(s || "").trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  /** Separa una línea CSV respetando comillas dobles. */
  function lineaCSV(linea, sep) {
    const out = [];
    let actual = "", comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
        else if (c === '"') comillas = false;
        else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) { out.push(actual); actual = ""; }
      else actual += c;
    }
    out.push(actual);
    return out;
  }

  /** CSV → filas con encabezados canónicos. Acepta coma o punto y coma y
   *  encabezados como "Precio CLP" o "Nombre del producto". */
  function parseCSV(texto) {
    const lineas = String(texto || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lineas.length < 2) return [];
    const sep = (lineas[0].match(/;/g) || []).length > (lineas[0].match(/,/g) || []).length ? ";" : ",";
    const canon = (h) => {
      const n = normClave(h);
      for (const k of Object.keys(SINONIMOS)) {
        if (SINONIMOS[k].some((s) => n === s || n.startsWith(s + "_") || n.endsWith("_" + s))) {
          // El grupo `codigo` es el código de barras, no el SKU: se devuelve
          // con un nombre propio para que una planilla con encabezado
          // «Código» (que sigue siendo SKU) no se confunda con «Código de
          // barras» / «EAN» / «Barcode».
          return k === "codigo" ? "codigo_barras" : k;
        }
      }
      return n;
    };
    const cabecera = lineaCSV(lineas[0], sep).map(canon);
    const filas = [];
    for (let i = 1; i < lineas.length; i++) {
      const celdas = lineaCSV(lineas[i], sep);
      const fila = {};
      cabecera.forEach((h, j) => { if (h) fila[h] = String(celdas[j] == null ? "" : celdas[j]).trim(); });
      filas.push(fila);
    }
    return filas;
  }

  function campo(obj, claves) {
    const entradas = Object.keys(obj);
    for (let i = 0; i < claves.length; i++) {
      const k = claves[i];
      for (let j = 0; j < entradas.length; j++) {
        const e = entradas[j];
        if (e !== k && !e.startsWith(k + "_") && !e.endsWith("_" + k)) continue;
        const v = obj[e];
        if (v !== undefined && v !== null && String(v).trim() !== "") return v;
      }
    }
    return "";
  }

  /** Número tolerante al formato chileno: "$1.690" → 1690, "1690,5" → 1690.5. */
  function aNumero(v) {
    let s = String(v == null ? "" : v).trim();
    if (!s) return 0;
    s = s.replace(/[^\d.,-]/g, "");
    const coma = s.includes(","), punto = s.includes(".");
    if (coma && punto) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
    } else if (coma) {
      const partes = s.split(",");
      // "1,690" es miles; "1690,5" es decimal.
      s = (partes.length === 2 && partes[1].length === 3 && partes[0].length <= 3)
        ? partes.join("")
        : s.replace(",", ".");
    } else if (punto) {
      const partes = s.split(".");
      // "1.690" es miles; "1690.5" es decimal.
      if (partes.length > 2 || (partes[1] && partes[1].length === 3)) s = partes.join("");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function aProducto(o) {
    if (!o || typeof o !== "object") return null;
    const nombre = String(campo(o, SINONIMOS.nombre) || "").trim().slice(0, 160);
    const precio = Math.round(aNumero(campo(o, SINONIMOS.precio)));
    if (!nombre || precio <= 0) return null;
    const stockCrudo = campo(o, SINONIMOS.stock);
    const stock = stockCrudo === "" ? null : Math.max(0, Math.round(aNumero(stockCrudo)));
    const producto = {
      sku: String(campo(o, SINONIMOS.sku) || "").trim().slice(0, 60),
      nombre,
      precio,
      stock,
      categoria: String(campo(o, SINONIMOS.categoria) || "").trim().slice(0, 40),
      unidad: String(campo(o, SINONIMOS.unidad) || "").trim().slice(0, 30)
    };
    // El descuento sólo viaja si la fuente lo trae: una planilla de stock sin
    // esa columna no debe apagar la oferta que ya está en la nube.
    if (tieneCampo(o, SINONIMOS.descuento)) {
      producto.descuento = Math.max(0, Math.min(90, Math.round(aNumero(campo(o, SINONIMOS.descuento)))));
    }
    if (tieneCampo(o, SINONIMOS.oferta_hasta)) {
      producto.oferta_hasta = String(campo(o, SINONIMOS.oferta_hasta)).trim().slice(0, 40);
    }
    // Igual con el código de barras: si la planilla no lo trae, se conserva el
    // que ya estaba guardado en el producto.
    if (tieneCampo(o, SINONIMOS.codigo)) {
      producto.codigo = String(campo(o, SINONIMOS.codigo)).trim().slice(0, 48);
    }
    return producto;
  }

  /** Precio de lista, descuento vigente y precio que se cobra. El servidor
   *  manda los tres; si una versión vieja no los trae, se calculan acá con el
   *  mismo redondeo (a peso) para que la pantalla nunca invente otra oferta. */
  function ofertaDe(p) {
    const lista = Math.max(0, Math.round(Number(p && p.precio) || 0));
    const crudo = p && p.descuento_vigente != null ? p.descuento_vigente : (p && p.descuento);
    const descuento = Math.max(0, Math.min(90, Math.round(Number(crudo) || 0)));
    const efectivo = p && p.precio_efectivo != null
      ? Math.max(0, Math.round(Number(p.precio_efectivo) || 0))
      : (descuento ? Math.max(1, Math.round(lista * (100 - descuento) / 100)) : lista);
    return { lista, descuento, efectivo };
  }

  /** Unix en segundos → `YYYY-MM-DD` para el <input type="date">. */
  function fechaInput(seg) {
    const n = Number(seg) || 0;
    if (!n) return "";
    const d = new Date(n * 1000);
    const dos = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + dos(d.getMonth() + 1) + "-" + dos(d.getDate());
  }

  /** Texto pegado o archivo CSV/JSON → productos listos para `productos_subir`. */
  function parseProductos(texto) {
    const t = String(texto || "").trim();
    if (!t) return [];
    if (t[0] === "{" || t[0] === "[") {
      let d;
      try { d = JSON.parse(t); } catch (e) { throw new Error("El JSON no se pudo leer."); }
      const arr = Array.isArray(d) ? d : (Array.isArray(d.productos) ? d.productos : (Array.isArray(d.catalogo) ? d.catalogo : []));
      return arr.map(aProducto).filter(Boolean);
    }
    return parseCSV(t).map(aProducto).filter(Boolean);
  }

  /** Productos de la base local de Stock (mismo SQLite del navegador). */
  function productosDeStock() {
    try {
      if (!(window.Fabri && window.Fabri.q)) return [];
      const filas = window.Fabri.q("SELECT sku, name, price, unit FROM products ORDER BY id DESC LIMIT 3000") || [];
      return filas.map((f) => aProducto({
        sku: f.sku, nombre: f.name, precio: f.price, unidad: f.unit
      })).filter(Boolean);
    } catch (e) { return []; }
  }

  /* ── carga ──────────────────────────────────────────────────────────────── */
  async function cargarPedidos() {
    if (!EST.sel) { EST.pedidos = []; return; }
    const d = await api({
      accion: "pedidos_listar",
      local_id: EST.sel.id,
      clave: EST.sel.clave || ""
    });
    if (d && d.ok) {
      EST.pedidos = (d.pedidos || []).map(aLocal);
      EST.pedidosTotal = Number(d.total) || EST.pedidos.length;
      EST.pedidosNuevos = Number(d.nuevos) || 0;
      EST.pedidosAbiertos = Number(d.abiertos) || 0;
      EST.aviso = "";
    } else if (d && d.codigo === "clave_mala") {
      EST.aviso = "La sesión no autoriza este local.";
    } else if (d && d.codigo === "SIN_RED") {
      EST.aviso = "Sin conexión: se ven los pedidos de este teléfono.";
    }
  }

  /** Conecta un local con ID + clave (respaldo). */
  async function conectarClave(localId, clave, silencioso) {
    EST.token = tokenNube();
    const d = await api({ accion: "pedidos_listar", local_id: localId, clave: clave });
    if (!d || !d.ok) {
      if (!silencioso) {
        aviso($("negNubeClaveEstado"), (d && d.error) || "No pude conectar: revisa el ID y la clave.", "malo");
      }
      return false;
    }
    EST.modo = "clave";
    EST.cuenta = null;
    EST.tiendas = [];
    EST.sel = {
      id: localId, nombre: d.local || localId, clave: clave,
      marca: "", logo: "", descripcion: "", rubro: "", abierto: null,
      catalogo: []
    };
    guardarJSON(CLAVE_NUBE, { local_id: localId, clave: clave });
    // La ficha pública completa (marca, logo, catálogo) viene del listado.
    try {
      const r = await fetch(API + "?accion=locales", { cache: "no-store" });
      const dl = await r.json();
      const t = dl && dl.ok && (dl.tiendas || []).find((x) => x.id === localId);
      if (t) EST.sel = Object.assign(EST.sel, t, { clave: clave });
    } catch (e) { /* el estado abierto/cerrado es opcional */ }
    if (!silencioso) {
      aviso($("negNubeClaveEstado"), "Conectado a " + EST.sel.nombre + ".", "bueno");
    }
    await cargarPedidos();
    return true;
  }

  /** Serie del periodo + top + estados + visitas (una sola llamada). */
  async function cargarSerie() {
    if (!EST.sel || EST.cargandoSerie) return;
    const tienda = EST.sel.id;
    EST.cargandoSerie = true;
    const d = await api({
      accion: "ventas_serie",
      local_id: EST.sel.id,
      clave: EST.sel.clave || "",
      dias: EST.rango
    });
    EST.cargandoSerie = false;
    // Si mientras cargaba el dueño cambió de tienda, esta respuesta ya no sirve.
    if (!EST.sel || EST.sel.id !== tienda) return;
    if (d && d.ok) {
      EST.serie = d;
      EST.serieTs = Date.now();
      EST.serieError = "";
    } else {
      EST.serie = null;
      EST.serieError = (d && (d.error || d.codigo)) || "sin respuesta de la nube";
    }
    pintarResumen();
    pintarEstadoVivo();
  }

  async function refrescar(opciones) {
    const o = opciones || {};
    if (EST.cargando) return;
    EST.cargando = true;
    if (!o.silencioso) { pintarCuenta(); pintarTiendas(); }

    try {
      EST.token = tokenNube();
      if (EST.token) {
        EST.modo = "cuenta";
        const d = await api({ accion: "local_mio" });
        if (d && d.ok) {
          EST.cuenta = d.cuenta || null;
          EST.tiendas = Array.isArray(d.tiendas) ? d.tiendas : [];
          EST.aviso = "";
          const guardada = String(leerJSON(CLAVE_SEL, "") || "");
          const id = EST.pendienteSel || guardada;
          EST.sel = EST.tiendas.find((t) => t.id === id) || EST.tiendas[0] || null;
          EST.pendienteSel = "";
          if (EST.sel) guardarJSON(CLAVE_SEL, EST.sel.id);
          else borrarJSON(CLAVE_SEL);
        } else {
          EST.aviso = (d && d.error) || "No pude leer tus tiendas.";
          if (d && d.codigo === "SESION") {
            EST.cuenta = null;
            EST.tiendas = [];
            EST.sel = null;
          }
        }
      } else {
        EST.modo = "";
        EST.cuenta = null;
        EST.tiendas = [];
        const n = leerJSON(CLAVE_NUBE, null);
        if (n && n.local_id && n.clave) {
          const ok = await conectarClave(n.local_id, n.clave, true);
          if (!ok) { EST.sel = null; borrarJSON(CLAVE_NUBE); }
        } else {
          EST.sel = null;
        }
      }
      if (EST.sel) {
        await cargarPedidos();
        await cargarSerie();
      } else {
        EST.pedidos = [];
        EST.serie = null;
      }
    } finally {
      EST.cargando = false;
      EST.ts = Date.now();
      render();
    }
  }

  async function abrirTienda(id) {
    const t = EST.tiendas.find((x) => x.id === id);
    if (!t) return;
    EST.sel = t;
    EST.pedidos = [];
    EST.avisosConsultados = false;   // el estado del push se pregunta por tienda
    EST.serie = null;
    EST.serieError = "";
    EST.serieTs = 0;
    EST.logoEditar = "";
    EST.editandoSku = "";
    EST.prodImagen = undefined;
    pintarFotoProducto();
    guardarJSON(CLAVE_SEL, id);
    await cargarPedidos();
    await cargarSerie();
    render();
  }

  /* ── pintura ────────────────────────────────────────────────────────────── */
  function render() {
    if (!$("negPedidos")) return;
    pintarCuenta();
    pintarTiendas();
    pintarPanel();
    enganchar();
    if (EST.modo === "cuenta" && !EST.cargando && Date.now() - EST.ts > 20000) {
      refrescar({ silencioso: true });
    }
  }

  function pintarCuenta() {
    const chip = $("negCuentaChip"), mail = $("negCuentaMail"), est = $("negCuentaEstado");
    const token = tokenNube();
    // Con una tienda abierta, la tarjeta de cuenta es puro estorbo: el estado
    // vivo ya dice con qué cuenta estás y la pantalla «Cuenta» sigue a un toque.
    // Se queda visible si hay algo que contar (error, sin sesión, sin tienda).
    const caja = $("negCuenta");
    if (caja) caja.hidden = !!(EST.sel && token && !EST.aviso);

    const u = EST.cuenta || (function () {
      try {
        const d = window.CoreNube && window.CoreNube.leer();
        return d && d.usuario ? d.usuario : null;
      } catch (e) { return null; }
    })();

    if (chip) {
      chip.textContent = token ? (EST.cargando ? "sincronizando" : "en línea") : "sin sesión";
      chip.className = "neg-chip " + (token ? "ok" : "pend");
    }
    if (mail) {
      mail.textContent = token
        ? ((u && (u.email || u.correo)) || "cuenta de la nube")
        : "Sin cuenta en la nube";
    }
    if (est) {
      if (EST.aviso) est.textContent = EST.aviso;
      else if (token) {
        const n = EST.tiendas.length;
        est.textContent = "Rol " + ((u && u.rol) || "member") + " · " +
          (n ? n + (n === 1 ? " tienda publicada" : " tiendas publicadas") : "todavía sin tienda") +
          (EST.sel ? " · administrando " + EST.sel.nombre : "");
      } else {
        est.textContent = "Entra a tu cuenta para crear y publicar tu tienda. La clave de 8 caracteres sigue sirviendo como respaldo.";
      }
    }
  }

  function logoTienda(t, tam) {
    const px = tam || 40;
    if (t && t.logo) {
      return '<span class="neg-logo" style="--px:' + px + 'px"><img src="' + esc(t.logo) + '" alt=""></span>';
    }
    const inicial = String((t && (t.marca || t.nombre)) || "?").trim().charAt(0).toUpperCase() || "?";
    return '<span class="neg-logo" style="--px:' + px + 'px"><b>' + esc(inicial) + "</b></span>";
  }

  function pintarTiendas() {
    const caja = $("negTiendas");
    if (!caja) return;
    const form = $("negFormTienda");

    if (!EST.token) {
      if (form) form.hidden = true;
      caja.innerHTML =
        '<div class="neg-vacio card">' +
          '<b>Publica tu tienda en el mapa</b>' +
          "<p>Entra a tu cuenta de la nube (pantalla «Cuenta») y vuelve acá: vas a poder crear tu local con marca, logo y catálogo.</p>" +
          '<button class="btn primary sm" type="button" data-cuenta>Ir a mi cuenta</button>' +
        "</div>";
      return;
    }

    const lista = EST.tiendas || [];
    const crear = '<button class="btn primary sm" type="button" data-crear>+ Crear tienda</button>';

    if (!lista.length) {
      caja.innerHTML =
        '<div class="neg-vacio card">' +
          "<b>Tu cuenta todavía no tiene tienda</b>" +
          "<p>Crea la primera: se publica en el mapa con nombre, marca, logo y catálogo.</p>" +
          '<button class="btn primary sm" type="button" data-crear>Crear mi tienda</button>' +
        "</div>";
      if (form) form.hidden = true;
      return;
    }

    caja.innerHTML =
      '<div class="neg-mis-cab"><div class="eyebrow">Mis tiendas · ' + lista.length + "</div>" + crear + "</div>" +
      '<div class="neg-mis-lista">' +
        lista.map((t) => {
          const abierto = t.abierto !== false;
          const prods = (t.catalogo || []).length;
          const pend = Number(t.pedidos_pendientes) || 0;
          const sel = EST.sel && EST.sel.id === t.id;
          // La tienda abierta no repite «Administrar»: ya estás dentro, así
          // que su acción útil es verla como la ve el cliente.
          return '<article class="neg-tienda-card' + (sel ? " on" : "") + '" data-tienda="' + esc(t.id) + '">' +
            logoTienda(t, 44) +
            '<div class="neg-tienda-txt"><b>' + esc(t.nombre) + "</b>" +
              "<small>" + esc([t.marca, t.rubro, t.comuna].filter(Boolean).join(" · ") || "Sin marca") +
                " · " + (abierto ? "abierto" : "cerrado") + "</small>" +
              "<em>" + prods + " productos" + (pend ? " · " + pend + " por atender" : "") + "</em>" +
            "</div>" +
            (sel
              ? '<button class="btn sm ghost" type="button" data-mapa="' + esc(t.id) + '">Ver mapa</button>'
              : '<button class="btn sm" type="button" data-abrir="' + esc(t.id) + '">Administrar</button>') +
          "</article>";
        }).join("") +
      "</div>";
  }

  /** Abre el local en el mapa (la ficha pública que ve el cliente). */
  function verEnMapa(id) {
    const tienda = id || (EST.sel && EST.sel.id);
    if (!tienda) return;
    if (window.Fabri) window.Fabri.go("panel");
    if (window.Placer && window.Placer.irATienda) window.Placer.irATienda(tienda);
  }

  /** Abre el visor 3D con el catálogo y la marca de ESTA tienda. Es la misma
   *  escena que ve el comprador, pero con el rótulo del local y su carrito. */
  function verTienda3d() {
    if (!EST.sel) return;
    /* El carrito necesita el local completo (mínimo, envío, entrega) aunque
       el mapa no lo haya cargado en esta visita. */
    if (window.Placer && window.Placer.registrarLocal) window.Placer.registrarLocal(EST.sel);
    if (window.Tienda3D && window.Tienda3D.ponerTienda) {
      const cat = window.Placer && window.Placer.productosDe
        ? window.Placer.productosDe(EST.sel)
        : (EST.sel.catalogo || []);
      window.Tienda3D.ponerTienda(cat, EST.sel, "negocio");
    }
    if (window.Fabri) window.Fabri.go("tienda");
  }

  function pintarPanel() {
    const panel = $("negPanel");
    if (!panel) return;
    if (!EST.sel) { panel.hidden = true; return; }
    panel.hidden = false;

    const t = EST.sel;
    const abierto = t.abierto !== false;

    const ab = $("negAbiertoBtn");
    if (ab) {
      ab.hidden = false;
      ab.textContent = abierto ? "Cerrar el local" : "Abrir el local";
    }
    const v3 = $("negVer3d");
    if (v3) {
      v3.hidden = false;
      v3.textContent = (t.catalogo && t.catalogo.length)
        ? "Ver en 3D"
        : "Ver en 3D (sin productos)";
    }
    const estado = $("negNubeEstado");
    if (estado) {
      estado.textContent = EST.cargando ? "Sincronizando con la nube…"
        : EST.aviso ? EST.aviso
        : "Pedidos y catálogo · " + (EST.modo === "cuenta" ? "tu cuenta" : "clave de la tienda");
    }

    // Contadores: el del servidor cuando hay nube; si no, lo que hay en este
    // teléfono. La pestaña y la tarjeta muestran el mismo número.
    const cuenta = contarPedidos();
    const prods = t.catalogo || [];
    const pc = $("negPedCount"), prc = $("negProdCount");
    if (pc) pc.textContent = cuenta.total;
    if (prc) prc.textContent = prods.length;
    const pt = $("negPedTotal"), prt = $("negProdTotal");
    if (pt) {
      pt.textContent = cuenta.total + (cuenta.origen === "local" ? " · local" : "");
      pt.className = "badge " + (cuenta.total ? "acc" : "");
    }
    const pend = $("negPedPend");
    if (pend) {
      pend.hidden = !cuenta.abiertos;
      pend.textContent = cuenta.abiertos + (cuenta.abiertos === 1 ? " por atender" : " por atender");
      pend.className = "badge " + (cuenta.nuevos ? "acc" : "warn");
    }
    if (prt) {
      const enOferta = prods.filter((p) => ofertaDe(p).descuento).length;
      prt.textContent = prods.length + (enOferta ? " · " + enOferta + " en oferta" : "");
      prt.className = "badge " + (enOferta ? "acc" : "");
    }

    pintarTabs();
    pintarEstadoVivo();
    pintarResumen();
    pintarPedidos();
    pintarCatalogo();
    pintarResenas();
    pintarAjustes();
    pintarMarca();
  }

  /* ── pestañas ───────────────────────────────────────────────────────────── */
  const TABS = ["resumen", "pedidos", "catalogo", "resenas", "ajustes"];

  function pintarTabs() {
    const cont = $("negTabs");
    if (!cont) return;
    cont.querySelectorAll("[data-tab]").forEach((b) => {
      const on = b.dataset.tab === EST.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    TABS.forEach((k) => {
      const p = $("negTab" + k.charAt(0).toUpperCase() + k.slice(1));
      if (p) p.hidden = k !== EST.tab;
    });
  }

  /** «En vivo» sólo si la última lectura es de hace menos de un minuto. */
  function pintarEstadoVivo() {
    const el = $("negLive");
    if (!el) return;
    const ts = EST.serieTs || EST.ts || 0;
    const min = ts ? Math.max(0, Math.round((Date.now() - ts) / 60000)) : null;
    const vivo = min !== null && min < 1;
    el.className = "neg-live" + (vivo ? "" : " stale");
    const txt = vivo ? "en vivo"
      : min === null ? "sin lectura"
      : "hace " + (min < 60 ? min + " min" : Math.round(min / 60) + " h");
    el.innerHTML = "<i></i><b>" + esc(txt) + "</b>";
  }

  /* ── resumen: KPIs, serie, top, estados y visitas ───────────────────────── */
  function pintarResumen() {
    const kpis = $("negKpis");
    if (!kpis) return;

    const s = EST.serie;
    const t = (s && s.totales) || {};
    const v = (s && s.visitas) || null;
    const dias = EST.rango;
    const periodo = dias + " días";
    const catalogo = (EST.sel && EST.sel.catalogo) || [];
    const ofertas = catalogo.filter((p) => ofertaDe(p).descuento).length;

    kpis.innerHTML =
      tarjeta("Ventas · " + periodo, s ? clp(t.ventas) : "—",
        s ? (t.pedidos || 0) + " pedido(s)" : "sin datos", "oro") +
      tarjeta("Ticket promedio", s ? clp(t.ticket) : "—", "por pedido del periodo", "") +
      tarjeta("Por atender", s ? String(t.abiertos || 0) : "—",
        (s && t.abiertos) ? "requieren atención" : "todo al día",
        (s && t.abiertos) ? "alerta" : "") +
      tarjeta("Visitas a la app", v ? String(v.total || 0) : "—",
        v ? "de todos los locales" : "sin datos", "") +
      tarjeta("Conversión", (s && s.conversion != null)
        ? String(s.conversion).replace(".", ",") + " %" : "—", "pedidos ÷ visitas de la app", "") +
      tarjeta("Productos", String(catalogo.length),
        ofertas ? ofertas + " en oferta" : "en tu catálogo",
        ofertas ? "oro" : "");

    const sub = $("negSerieSub");
    if (sub) {
      sub.textContent = s
        ? "Últimos " + dias + " días · " + clp(t.ventas) + " en total" +
          (Number(t.descuento) ? " · " + clp(t.descuento) + " en descuentos" : "")
        : EST.cargandoSerie ? "Cargando el periodo…" : "Sin datos del periodo";
    }
    const chip = $("negSerieChip");
    if (chip) {
      chip.textContent = EST.serieError ? "sin datos" : "en vivo";
      chip.className = "neg-chip " + (EST.serieError ? "pend" : "ok");
    }

    pintarSerie();
    pintarTop();
    pintarEstados();
    pintarVisitas();
  }

  function pintarSerie() {
    const caja = $("negSerie");
    if (!caja) return;
    if (EST.serieError) {
      caja.innerHTML = '<div class="neg-vacio"><b>No pude leer el periodo</b>' +
        "<p>" + esc(EST.serieError) + ". Revisa la conexión y vuelve a abrir la pestaña.</p></div>";
      return;
    }
    if (!EST.serie) {
      caja.innerHTML = '<div class="neg-vacio"><b>Cargando…</b><p>Pidiendo la serie de ventas.</p></div>';
      return;
    }
    const barras = barrasSerie(EST.serie.serie);
    if (!barras.length) {
      caja.innerHTML = '<div class="neg-vacio"><b>Sin días que mostrar</b><p>El periodo llegó vacío.</p></div>';
      return;
    }
    caja.innerHTML = barras.map((b) =>
      '<div class="neg-bars-dia' + (b.ventas ? "" : " vacia") + (b.hoy ? " hoy" : "") + '"' +
        ' title="' + esc(b.dia + " · " + clp(b.ventas) + " · " + b.pedidos + " pedido(s)") + '">' +
        '<span class="neg-bars-col" style="height:' + b.alto + '%"></span>' +
        "<small>" + esc(b.etiqueta) + "</small>" +
      "</div>").join("");
  }

  function pintarTop() {
    const caja = $("negTop");
    if (!caja) return;
    const rango = $("negTopRango");
    if (rango) rango.textContent = EST.rango + " días";
    const top = (EST.serie && EST.serie.top) || [];
    caja.innerHTML = top.length
      ? top.map((p, i) =>
          '<div class="neg-top-fila">' +
            '<span class="neg-top-n">' + (i + 1) + "</span>" +
            '<div class="neg-top-txt"><b>' + esc(p.nombre || "Producto") + "</b>" +
              "<small>" + (Number(p.unidades) || 0) + " unidades</small></div>" +
            '<span class="neg-top-monto">' + clp(p.monto) + "</span>" +
          "</div>").join("")
      : '<div class="neg-vacio"><b>Sin ventas en el periodo</b>' +
        "<p>Cuando entre un pedido, acá aparece qué se vende más.</p></div>";
  }

  function pintarEstados() {
    const caja = $("negEstados");
    if (!caja) return;
    const e = (EST.serie && EST.serie.estados) || null;
    const total = $("negEstCount");
    if (!e) {
      caja.innerHTML = '<span class="neg-estado-chip">sin datos</span>';
      if (total) total.textContent = "—";
      return;
    }
    const orden = ["nuevo", "visto", "listo", "entregado", "cancelado"];
    const suma = orden.reduce((a, k) => a + (Number(e[k]) || 0), 0);
    if (total) total.textContent = suma;
    const visibles = orden.filter((k) => Number(e[k]) > 0);
    caja.innerHTML = visibles.length
      ? visibles.map((k) =>
          '<span class="neg-estado-chip ' + k + '">' + esc(k) + " <b>" + e[k] + "</b></span>").join("")
      : '<span class="neg-estado-chip">sin pedidos en el periodo</span>';
  }

  function pintarVisitas() {
    const caja = $("negVisitas");
    if (!caja) return;
    const rango = $("negVisitasRango");
    if (rango) rango.textContent = EST.rango + " días";
    const v = EST.serie && EST.serie.visitas;
    if (!v) {
      caja.innerHTML = '<div class="neg-visitas-cab"><b>—</b><small>visitas a la app</small></div>' +
        '<p class="neg-visitas-nota">Todavía no hay visitas registradas en el periodo.</p>';
      return;
    }
    const canales = (v.por_canal || []).filter((c) => Number(c.n) > 0);
    caja.innerHTML =
      '<div class="neg-visitas-cab"><b>' + (Number(v.total) || 0) + "</b>" +
        "<small>visitas a la app en el periodo</small></div>" +
      (canales.length
        ? '<div class="neg-canales">' + canales.map((c) =>
            '<span class="neg-canal">' + esc(c.canal) + " · " + (Number(c.n) || 0) + "</span>").join("") + "</div>"
        : "") +
      '<p class="neg-visitas-nota">La tabla de visitas no distingue local: el número es de toda la app.</p>';
  }

  /* Enlace público de seguimiento de un pedido. Vive en la raíz del sitio
     (`/seguir.html`), no dentro de la app: lo abre el comprador sin cuenta. */
  function enlaceSeguimiento(token) {
    const t = String(token == null ? "" : token).trim();
    if (!t) return "";
    const base = (window.location && window.location.origin) ? window.location.origin : "https://forge-core-stock.vercel.app";
    return base + "/seguir.html?t=" + encodeURIComponent(t);
  }

  /* ── aviso al cliente por WhatsApp ───────────────────────────────────────── */

  /**
   * Número en formato wa.me. Acepta `+56 9 1234 5678`, `912345678` o
   * `09 1234 5678`. Si no parece un teléfono, devuelve "" (no hay botón).
   */
  function numeroWa(tel) {
    let d = String(tel == null ? "" : tel).replace(/\D/g, "");
    if (d.length < 8) return "";
    if (d.indexOf("56") === 0 && d.length >= 11) return d;
    if (d.length > 11) return d;              // ya trae código de otro país
    d = d.replace(/^0+/, "");
    return d.length >= 8 ? "56" + d : "";
  }

  /** Qué se le dice al cliente según el estado del pedido. */
  function fraseEstado(pedido) {
    const e = pedido.estado || "nuevo";
    if (e === "visto") return "está en preparación";
    if (e === "listo") return pedido.entrega === "delivery" ? "va en camino" : "está listo para retirar";
    if (e === "entregado") return "fue entregado";
    if (e === "cancelado") return "fue cancelado";
    return "lo recibimos";
  }

  /** Mensaje ya escrito para el cliente, con el enlace de seguimiento si existe. */
  function mensajePedido(pedido, tienda) {
    const nombre = (pedido.cliente && pedido.cliente.nombre || "").trim();
    const quien = nombre ? "Hola " + nombre.split(/\s+/)[0] + ", " : "Hola, ";
    const local = String(tienda || (pedido.local && pedido.local.nombre) || "").trim();
    let txt = quien + "tu pedido " + (pedido.codigo || "") +
      (local ? " de " + local : "") + " " + fraseEstado(pedido) + ".";
    const enlace = enlaceSeguimiento(pedido.seguimiento);
    if (enlace) txt += " Puedes verlo acá: " + enlace;
    return txt;
  }

  /** URL de WhatsApp lista para abrir, o "" si el pedido no trae teléfono. */
  function enlaceWa(pedido, tienda) {
    const n = numeroWa(pedido.cliente && pedido.cliente.telefono);
    if (!n) return "";
    return "https://wa.me/" + n + "?text=" + encodeURIComponent(mensajePedido(pedido, tienda));
  }

  function abrirWa(url) {
    if (!url) return;
    try {
      const v = window.open(url, "_blank", "noopener");
      if (!v) window.location.href = url;
    } catch (e) { window.location.href = url; }
  }

  function copiarEnlace(token, boton) {
    const url = enlaceSeguimiento(token);
    if (!url) return;
    const marcar = () => {
      if (!boton) { toast("Enlace copiado"); return; }
      const antes = boton.textContent;
      boton.textContent = "Copiado";
      setTimeout(() => { boton.textContent = antes; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(marcar, () => window.prompt("Copia el enlace", url));
    } else {
      window.prompt("Copia el enlace", url);
    }
  }

  /* ── link público de la marca ──────────────────────────────────────────── */
  /**
   * URL estable del visor de esta marca. No arrastra `lat`, `lon` ni `demo`
   * de una visita anterior: el link sólo lleva la identidad del local.
   */
  function enlaceMarca(local) {
    const id = typeof local === "string" ? local : (local && local.id);
    if (!id) return "";
    const loc = (typeof location !== "undefined" ? location
      : (window.location || {}));
    const base = (loc.origin || "") + (loc.pathname || "/");
    try {
      const u = new URL(base);
      u.searchParams.set("marca", id);
      u.hash = "tienda";
      return u.toString();
    } catch (e) {
      return base + "?marca=" + encodeURIComponent(id) + "#tienda";
    }
  }

  function copiarUrl(url, boton) {
    if (!url) return;
    const marcar = () => {
      if (!boton) { toast("Enlace copiado"); return; }
      const antes = boton.textContent;
      boton.textContent = "Copiado";
      setTimeout(() => { boton.textContent = antes; }, 1400);
    };
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(marcar, () => window.prompt("Copia el enlace", url));
    } else {
      window.prompt("Copia el enlace", url);
    }
  }

  /** Comparte el link con la hoja nativa del teléfono; si no hay, lo copia. */
  function compartirMarca(boton) {
    if (!EST.sel) return;
    const url = enlaceMarca(EST.sel);
    if (!url) return;
    const titulo = "Mi tienda " + (EST.sel.marca || EST.sel.nombre);
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ title: titulo, text: "Mira mi catálogo y compra en 3D", url })
        .catch((e) => { if (!e || e.name !== "AbortError") copiarUrl(url, boton); });
      return;
    }
    copiarUrl(url, boton);
  }

  function pintarMarca() {
    const t = EST.sel;
    const url = t ? enlaceMarca(t) : "";
    const input = $("negLinkMarca");
    if (input) input.value = url;
    const chip = $("negLinkChip");
    if (chip) {
      chip.textContent = t ? (t.marca || t.nombre) : "sin marca";
      chip.className = "badge " + (t ? "acc" : "");
    }
    const wa = $("negLinkWa");
    if (wa) {
      wa.hidden = !url;
      wa.href = url
        ? "https://wa.me/?text=" + encodeURIComponent(
            "Mira mi tienda " + (t.marca || t.nombre) + ": " + url)
        : "#";
    }
    const abrir = $("negLinkAbrir");
    if (abrir) abrir.disabled = !url;
    pintarSeguridad();
  }

  /** Cuenta y seguridad: qué se guarda, qué se publica y qué no. */
  function pintarSeguridad() {
    const caja = $("negSeguridad");
    if (!caja) return;
    const u = EST.cuenta || (function () {
      try {
        const d = window.CoreNube && window.CoreNube.leer();
        if (d && d.usuario) return d.usuario;
      } catch (e) { /* sin nube */ }
      /* Cuenta creada sólo en este dispositivo (sin nube): el nombre y el
         correo viven en la sesión local, no en InsForge. */
      return (window.Fabri && window.Fabri.user) || null;
    })() || {};
    const t = EST.sel;
    const fila = (k, v) => "<div><dt>" + esc(k) + "</dt><dd>" + esc(v || "—") + "</dd></div>";
    const conNube = !!tokenNube();
    caja.innerHTML =
      '<dl class="neg-seg">' +
        fila("Nombre", u.nombre || u.name || "") +
        fila("Correo", u.email || u.correo || "") +
        fila("Rol", u.rol || u.role || "") +
        fila("Marca", t ? (t.marca || t.nombre) : "") +
        fila("Sesión", conNube
          ? "token de 256 bits · atada a este dispositivo"
          : (u.email ? "cuenta de este dispositivo · sin nube" : "sin sesión")) +
      "</dl>" +
      '<p class="hint">La contraseña se guarda como hash PBKDF2-SHA256 (120.000 iteraciones), nunca en claro. ' +
        (conNube
          ? "En InsForge sólo queda el SHA-256 del token de sesión, atado a este dispositivo."
          : "Esta cuenta no tiene sesión en la nube: todo queda en este dispositivo.") + "</p>" +
      '<p class="hint">Público en tu link de marca: nombre, marca, logo, descripción, catálogo, precios y stock. Privado: tu correo, tus pedidos y tus ajustes.</p>' +
      '<button class="btn ghost sm" type="button" id="negSegIr">Mi cuenta y sesiones</button>';
    const ir = $("negSegIr");
    if (ir) ir.onclick = () => { if (window.Fabri) window.Fabri.go("cuenta"); };
  }

  function pintarPedidos() {
    const caja = $("negPedidos");
    if (!caja) return;
    const todos = pedidosVisibles();
    const lista = filtrarPedidos(todos, EST.buscar, EST.filtro);
    const total = $("negPedTotal");
    if (total) total.textContent = lista.length === todos.length
      ? todos.length
      : lista.length + " de " + todos.length;

    caja.innerHTML = lista.length
      ? lista.slice(0, 60).map((p) => {
          const hecho = p.estado === "entregado";
          const cancel = p.estado === "cancelado";
          const wa = enlaceWa(p, EST.sel && EST.sel.nombre);
          return '<article class="neg-pedido' + (hecho || cancel ? " hecho" : "") + '">' +
            '<div class="neg-ped-cab">' +
              "<b>" + esc(p.codigo) + "</b>" +
              '<span class="neg-chip ' + (hecho ? "ok" : "pend") + '">' + esc(p.estado || "por entregar") + "</span>" +
              '<small>' + esc(dia(p.fecha)) + " · " + esc(hora(p.fecha)) + (p.nube ? "" : " · local") + "</small>" +
            "</div>" +
            '<p class="neg-ped-cli">' + esc((p.cliente && p.cliente.nombre) || "Cliente") +
              " · " + (p.entrega === "delivery" ? "delivery" : "retiro") +
              (p.direccion ? " · " + esc(p.direccion) : "") +
              (p.comuna ? ", " + esc(p.comuna) : "") +
              (p.referencia ? " · " + esc(p.referencia) : "") + "</p>" +
            (p.metodo
              ? '<p class="neg-ped-pago">' + esc(etiquetaPagoLocal(p.metodo)) +
                (p.metodo === "efectivo" && p.pagoCon
                  ? " · paga con " + clp(p.pagoCon) +
                    (p.vuelto ? " · vuelto " + clp(p.vuelto) : " · monto justo")
                  : "") + "</p>"
              : "") +
            '<div class="neg-ped-items">' +
              (p.items || []).map((x) => "<span>" +
                (x.imagen ? '<img class="neg-ped-foto" src="' + esc(x.imagen) + '" alt="" loading="lazy">' : "") +
                x.cantidad + "× " + esc(x.nombre) +
                (Number(x.descuento) ? ' <em class="neg-item-off">−' + Number(x.descuento) + "%</em>" : "") +
                "</span>").join("") +
            "</div>" +
            '<div class="neg-ped-pie">' +
              '<div class="neg-ped-tot"><b>' + clp(p.total) + "</b>" +
                (p.ahorro ? "<small>ahorró " + clp(p.ahorro) + " con ofertas</small>" : "") +
              "</div>" +
              '<div class="neg-ped-acc">' +
                (hecho || cancel ? "" : (p.nube
                  ? '<select class="neg-ped-estado" data-estado="' + esc(p.pedido_id) + '" aria-label="Estado del pedido ' + esc(p.codigo) + '">' +
                      ESTADOS_PEDIDO.map((e) => '<option value="' + e.clave + '"' +
                        (e.clave === (p.estado || "nuevo") ? " selected" : "") + ">" + e.txt + "</option>").join("") +
                    "</select>"
                  : '<button type="button" data-hecho="' + esc(p.codigo) + '">Marcar entregado</button>')) +
                (wa && !cancel ? '<button type="button" class="wa" data-wa="' + esc(wa) + '">Avisar</button>' : "") +
                (p.seguimiento ? '<button type="button" data-enlace="' + esc(p.seguimiento) + '">Enlace</button>' : "") +
                (p.nube ? "" : '<button type="button" class="borrar" data-borrar="' + esc(p.codigo) + '" aria-label="Borrar pedido">✕</button>') +
              "</div>" +
            "</div>" +
            (EST.verificando === p.pedido_id
              ? '<div class="neg-verif">' +
                  "<p>Pide al comprador el <b>código de entrega</b> de 4 dígitos.</p>" +
                  '<input class="neg-verif-clave" data-clave="' + esc(p.pedido_id) + '" inputmode="numeric" maxlength="4" placeholder="0000" aria-label="Código de entrega">' +
                  (EST.errorVerif ? '<small class="neg-verif-err">' + esc(EST.errorVerif) + "</small>" : "") +
                  '<div class="neg-verif-acc">' +
                    '<button type="button" class="ok" data-verificar="' + esc(p.pedido_id) + '">Confirmar entrega</button>' +
                    '<button type="button" data-cancelar-verif="1">Cancelar</button>' +
                  "</div>" +
                "</div>"
              : "") +
            historialPedido(p) +
          "</article>";
        }).join("")
      : (todos.length
        ? '<div class="mp-vacio"><b>Ningún pedido coincide</b>' +
          "<p>Prueba con otro texto o quita el filtro de estado.</p></div>"
        : '<div class="mp-vacio"><b>Todavía no hay pedidos</b>' +
          "<p>Cuando alguien pague en MercadoPlacer, aparece acá.</p></div>");

    // La lista se repinta con cada filtro: los botones se vuelven a enganchar.
    engancharPedidos(caja);
  }

  /** Handlers de la lista de pedidos. Se usa al pintar la lista y también en
   *  `enganchar`, que corre después del panel: si no, pisaría la verificación
   *  del código de entrega con el cambio de estado directo. */
  function engancharPedidos(raiz) {
    raiz.querySelectorAll("[data-hecho]").forEach((b) => {
      b.onclick = () => cambiarEstado(b.dataset.hecho, "entregado", false);
    });
    raiz.querySelectorAll("[data-estado]").forEach((s) => {
      s.onchange = () => {
        const p = EST.pedidos.find((x) => x.pedido_id === s.dataset.estado);
        // Entregar un pedido con código exige pedírselo al comprador.
        if (s.value === "entregado" && p && p.requiereClave) {
          EST.verificando = s.dataset.estado;
          EST.errorVerif = "";
          render();
          return;
        }
        cambiarEstado(s.dataset.estado, s.value, true);
      };
    });
    raiz.querySelectorAll("[data-verificar]").forEach((b) => {
      b.onclick = () => verificarEntrega(b.dataset.verificar);
    });
    raiz.querySelectorAll("[data-cancelar-verif]").forEach((b) => {
      b.onclick = () => { EST.verificando = ""; EST.errorVerif = ""; render(); };
    });
    const campoClave = raiz.querySelector(".neg-verif-clave");
    if (campoClave) {
      campoClave.oninput = () => {
        campoClave.value = campoClave.value.replace(/\D/g, "").slice(0, 4);
      };
      campoClave.onkeydown = (ev) => {
        if (ev.key === "Enter") verificarEntrega(campoClave.dataset.clave);
      };
    }
    raiz.querySelectorAll("[data-borrar]").forEach((b) => {
      b.onclick = () => { guardar(leer().filter((p) => p.codigo !== b.dataset.borrar)); render(); };
    });
    raiz.querySelectorAll("[data-enlace]").forEach((b) => {
      b.onclick = () => copiarEnlace(b.dataset.enlace, b);
    });
    raiz.querySelectorAll("[data-wa]").forEach((b) => {
      b.onclick = () => abrirWa(b.dataset.wa);
    });
  }

  /** Confirma la entrega con el código que dictó el comprador. */
  function verificarEntrega(id) {
    if (!id) return;
    const inp = document.querySelector('.neg-verif-clave[data-clave="' + id + '"]');
    const clave = ((inp && inp.value) || "").replace(/\D/g, "");
    if (clave.length !== 4) {
      EST.errorVerif = "El código tiene 4 dígitos.";
      render();
      return;
    }
    cambiarEstado(id, "entregado", true, clave);
  }

  /** Historial del pedido: quién lo movió, cuándo y con qué nota. */
  function historialPedido(p) {
    const ev = (p.eventos || []).filter((e) => e && e.estado);
    if (ev.length < 2) return "";
    return '<details class="neg-ped-hist">' +
        "<summary>Historial · " + ev.length + "</summary>" +
        "<ol>" + ev.map((e) => {
          const ts = Date.parse(e.ts);
          return "<li><b>" + esc(e.estado) + "</b>" +
            "<small>" + esc(dia(ts) + " " + hora(ts)) +
              (e.actor && e.actor !== "sistema" ? " · " + esc(e.actor) : "") + "</small>" +
            (e.nota ? "<p>" + esc(e.nota) + "</p>" : "") + "</li>";
        }).join("") + "</ol>" +
      "</details>";
  }

  /* Pinta la miniatura del formulario. `prodImagen` manda:
     · undefined → la foto guardada del producto que se edita (si hay)
     · ""        → sin foto (se borrará al guardar)
     · data URL  → foto nueva elegida en este formulario */
  function pintarFotoProducto() {
    const caja = $("negProdFotoPrev");
    if (!caja) return;
    let src = "";
    if (EST.prodImagen === undefined) {
      const p = (EST.sel && EST.sel.catalogo || []).find((x) => x.sku === EST.editandoSku);
      src = (p && p.imagen) || "";
    } else {
      src = EST.prodImagen;
    }
    caja.innerHTML = src
      ? '<img src="' + esc(src) + '" alt="Foto del producto">'
      : '<span class="neg-foto-vacio">Sin foto</span>';
    const quitar = $("negProdFotoQuitar");
    if (quitar) quitar.hidden = !src;
  }

  function pintarCatalogo() {
    const caja = $("negProductos");
    if (!caja || !EST.sel) return;
    const prods = EST.sel.catalogo || [];

    // Categorías para el datalist del formulario.
    const cat = $("negCategorias");
    if (cat) {
      const vistas = Array.from(new Set(prods.map((p) => p.categoria).filter(Boolean))).sort();
      cat.innerHTML = vistas.map((c) => '<option value="' + esc(c) + '"></option>').join("");
    }

    caja.innerHTML = prods.length
      ? prods.slice(0, MAX_CATALOGO).map((p) => {
          const o = ofertaDe(p);
          const conStock = p.stock !== null && p.stock !== undefined;
          const stockTxt = !conStock ? ""
            : p.stock <= 0 ? ' · <em class="neg-stock-err">agotado</em>'
            : p.stock <= 5 ? ' · <em class="neg-stock-warn">quedan ' + p.stock + "</em>"
            : " · stock " + p.stock;
          return '<div class="neg-prod' + (EST.editandoSku && EST.editandoSku === p.sku ? " on" : "") + '">' +
            '<span class="neg-prod-foto" aria-hidden="true">' +
              (p.imagen
                ? '<img src="' + esc(p.imagen) + '" alt="" loading="lazy">'
                : '<b>' + esc(String(p.nombre || "P").charAt(0)) + "</b>") +
            "</span>" +
            "<b>" + esc(p.nombre || "Producto") + "</b>" +
            "<small>" + esc(p.sku || "sin SKU") +
              (p.categoria ? " · " + esc(p.categoria) : "") + stockTxt +
              (p.codigo ? ' · <span class="neg-prod-cod" title="Código de barras">' +
                esc(p.codigo) + "</span>" : "") +
            "</small>" +
            '<span class="neg-prod-precio">' +
              (o.descuento ? "<s>" + clp(o.lista) + "</s>" : "") +
              clp(o.efectivo) +
              (o.descuento ? '<em class="neg-prod-off">−' + o.descuento + "%</em>" : "") +
            "</span>" +
            '<div class="neg-prod-acc">' +
              '<button type="button" data-editar="' + esc(p.sku) + '">Editar</button>' +
              '<button type="button" class="borrar" data-quitar="' + esc(p.sku) + '" aria-label="Borrar producto">✕</button>' +
            "</div>" +
          "</div>";
        }).join("")
      : '<div class="mp-vacio"><b>Sin productos cargados</b><p>Agrega el primero abajo, importa un CSV/JSON o trae los de tu Stock.</p></div>';
  }

  /* ── reseñas del panel ───────────────────────────────────────────────────── */

  const ESTRELLA = "M12 3.3l2.55 5.3 5.85.82-4.25 4.1 1.02 5.8L12 16.6l-5.17 2.72 1.02-5.8-4.25-4.1 5.85-.82z";

  /** Cinco estrellas en SVG, llenas hasta el promedio redondeado. */
  function estrellas(n, tam) {
    const k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    const alto = tam || 12;
    let svg = '<svg class="neg-estrellas" viewBox="0 0 120 24" width="' + (alto * 5) +
      '" height="' + alto + '" aria-hidden="true">';
    for (let i = 0; i < 5; i++) {
      svg += '<path d="' + ESTRELLA + '" transform="translate(' + i * 24 + ' 0)" ' +
        (i < k ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.2" opacity=".35"') + "/>";
    }
    return svg + "</svg>";
  }

  async function cargarResenas() {
    if (!EST.sel || EST.cargandoResenas) return;
    EST.cargandoResenas = true;
    const d = await api({
      accion: "resenas_panel", local_id: EST.sel.id, clave: EST.sel.clave || ""
    });
    EST.cargandoResenas = false;
    if (d && d.ok) {
      EST.resenas = { calificacion: d.calificacion || { n: 0, promedio: 0, ocultas: 0 }, resenas: d.resenas || [] };
      EST.resenasError = "";
    } else {
      EST.resenasError = (d && d.error) || "no se pudieron leer las reseñas";
    }
    pintarResenas();
  }

  function pintarResenas() {
    const lista = $("negResLista"), resumen = $("negResResumen");
    if (!lista || !resumen) return;
    const total = $("negResCount"), chip = $("negResChip");
    const r = EST.resenas;

    if (!r) {
      // Antes de abrir la pestaña, el contador sale del resumen (ventas_serie).
      const s = EST.serie && EST.serie.resenas;
      if (total) total.textContent = s ? s.n : "—";
      if (chip) chip.textContent = EST.resenasError ? "error" : "—";
      resumen.innerHTML = "";
      lista.innerHTML = '<div class="neg-vacio"><b>' +
        (EST.resenasError ? "No pudimos leer las reseñas" : "Cargando reseñas…") + "</b>" +
        (EST.resenasError ? "<p>" + esc(EST.resenasError) + "</p>" : "") + "</div>";
      return;
    }

    const c = r.calificacion || { n: 0, promedio: 0, ocultas: 0 };
    if (total) total.textContent = c.n;
    if (chip) {
      chip.textContent = c.n ? "promedio " + String(c.promedio.toFixed(1)).replace(".", ",") : "sin reseñas";
      chip.className = "badge" + (c.n ? " ok" : "");
    }

    if (!c.n) {
      resumen.innerHTML = "";
      lista.innerHTML = '<div class="neg-vacio"><b>Todavía no tienes reseñas</b>' +
        "<p>El comprador puede calificar desde el enlace de su pedido, " +
        "cuando lo marcas como entregado.</p></div>";
      return;
    }

    const prom = String(c.promedio.toFixed(1)).replace(".", ",");
    resumen.innerHTML =
      '<div class="neg-res-nota"><b>' + prom + "</b>" + estrellas(c.promedio, 13) +
        "<small>" + c.n + (c.n === 1 ? " comprador calificó" : " compradores calificaron") +
        (c.ocultas ? " · " + c.ocultas + " oculta" + (c.ocultas === 1 ? "" : "s") : "") + "</small></div>";

    lista.innerHTML = (r.resenas || []).map((x) => {
      const est = Math.max(1, Math.min(5, Number(x.estrellas) || 5));
      return '<article class="neg-resena' + (x.oculta ? " oculta" : "") + '">' +
          '<div class="neg-resena-cab">' +
            "<b>" + esc(x.autor || "Cliente") + "</b>" +
            '<span class="neg-resena-est">' + estrellas(est, 11) + "</span>" +
            '<small>' + esc(dia(Date.parse(x.creado)) + " · " + hora(Date.parse(x.creado))) + "</small>" +
          "</div>" +
          (x.texto ? '<p class="neg-resena-txt">' + esc(x.texto) + "</p>"
            : '<p class="neg-resena-txt neg-resena-sin">sin comentario</p>') +
          '<div class="neg-resena-pie">' +
            (x.oculta ? '<span class="badge">oculta</span>' : "") +
            '<button type="button" data-moderar="' + esc(x.id) + '" data-oculta="' + (x.oculta ? "0" : "1") + '">' +
              (x.oculta ? "Mostrar" : "Ocultar") + "</button>" +
          "</div>" +
        "</article>";
    }).join("");

    lista.querySelectorAll("[data-moderar]").forEach((b) => {
      b.onclick = () => moderarResena(b.dataset.moderar, b.dataset.oculta === "1");
    });
  }

  /** Ocultar no borra: la reseña deja de mostrarse y de contar en el promedio. */
  async function moderarResena(id, oculta) {
    if (!EST.sel) return;
    const d = await api({
      accion: "resena_moderar", local_id: EST.sel.id, clave: EST.sel.clave || "",
      resena_id: id, oculta
    });
    if (d && d.ok) {
      toast(oculta ? "Reseña oculta" : "Reseña publicada de nuevo");
      await cargarResenas();
    } else {
      toast((d && d.error) || "No se pudo cambiar la reseña");
    }
  }

  /* ── avisos push del dueño ───────────────────────────────────────────────── */

  function soportaAvisos() {
    return typeof window !== "undefined" && "Notification" in window &&
      "serviceWorker" in navigator && "PushManager" in window;
  }

  function claveToUint8(b64) {
    const s = String(b64 || "").replace(/-/g, "+").replace(/_/g, "/");
    let con = s;
    while (con.length % 4) con += "=";
    const raw = atob(con);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function pintarAvisosDueno(activo, nota) {
    const chip = $("negAvisosChip"), btn = $("negAvisosBtn"), quitar = $("negAvisosQuitar");
    const txt = $("negAvisosTxt"), av = $("negAvisosNota");
    if (chip) {
      chip.textContent = activo ? "activado" : "sin activar";
      chip.className = "badge" + (activo ? " ok" : "");
    }
    if (txt) {
      txt.textContent = activo
        ? "Te avisaremos acá cuando entre un pedido, aunque tengas el panel cerrado."
        : "Recibe un aviso cuando entre un pedido, aunque tengas el panel cerrado.";
    }
    if (btn) btn.hidden = Boolean(activo);
    if (quitar) quitar.hidden = !activo;
    if (av) av.textContent = nota || "";
  }

  function consultarAvisosDueno() {
    if (!EST.sel || !soportaAvisos()) return;
    navigator.serviceWorker.getRegistration("/app/sw.js").then((reg) => {
      if (!reg || !reg.pushManager) return pintarAvisosDueno(false, "");
      return reg.pushManager.getSubscription().then((s) => pintarAvisosDueno(Boolean(s), ""));
    }).catch(() => pintarAvisosDueno(false, ""));
  }

  function activarAvisosDueno() {
    const btn = $("negAvisosBtn");
    if (!EST.sel) return;
    const push = EST.serie && EST.serie.push;
    if (!push || !push.disponible) {
      pintarAvisosDueno(false, "El servidor no tiene los avisos configurados.");
      return;
    }
    if (!soportaAvisos()) {
      pintarAvisosDueno(false, "Este navegador no soporta notificaciones push.");
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Activando…"; }
    pintarAvisosDueno(false, "");

    const pedir = Notification.permission === "granted"
      ? Promise.resolve("granted")
      : Notification.requestPermission();

    pedir.then((permiso) => {
      if (permiso !== "granted") throw new Error("permiso");
      return navigator.serviceWorker.register("/app/sw.js");
    }).then((reg) => reg.pushManager.getSubscription().then((actual) => {
      if (actual) return actual;
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveToUint8(push.clave),
      });
    })).then((sub) => {
      const json = sub.toJSON ? sub.toJSON() : null;
      if (!json || !json.endpoint) throw new Error("suscripcion");
      return api({
        accion: "push_local_suscribir", local_id: EST.sel.id,
        clave: EST.sel.clave || "", suscripcion: json,
      }).then((d) => {
        if (!d || !d.ok) throw new Error("guardar");
        if (btn) { btn.disabled = false; btn.textContent = "Activar avisos"; }
        pintarAvisosDueno(true, "Listo: este teléfono recibirá los pedidos nuevos.");
      });
    }).catch((e) => {
      if (btn) { btn.disabled = false; btn.textContent = "Activar avisos"; }
      pintarAvisosDueno(false, e && e.message === "permiso"
        ? "El navegador bloqueó las notificaciones. Actívalas en los ajustes del sitio."
        : "No se pudieron activar los avisos. Inténtalo de nuevo.");
    });
  }

  function quitarAvisosDueno() {
    const quitar = $("negAvisosQuitar");
    if (quitar) { quitar.disabled = true; quitar.textContent = "Quitando…"; }
    navigator.serviceWorker.getRegistration("/app/sw.js").then((reg) => {
      const sub = reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
      return Promise.resolve(sub).then((s) => {
        if (!s) return null;
        const json = s.toJSON ? s.toJSON() : {};
        return s.unsubscribe().then(() => json.endpoint || "");
      });
    }).then((endpoint) => {
      if (!endpoint || !EST.sel) return null;
      return api({
        accion: "push_local_baja", local_id: EST.sel.id,
        clave: EST.sel.clave || "", endpoint,
      });
    }).then(() => {
      if (quitar) { quitar.disabled = false; quitar.textContent = "Dejar de avisar"; }
      pintarAvisosDueno(false, "Este teléfono ya no recibirá avisos.");
    }).catch(() => {
      if (quitar) { quitar.disabled = false; quitar.textContent = "Dejar de avisar"; }
      pintarAvisosDueno(false, "");
    });
  }

  function engancharAvisosDueno() {
    const btn = $("negAvisosBtn");
    if (btn && !btn.dataset.listo) { btn.dataset.listo = "1"; btn.onclick = activarAvisosDueno; }
    const quitar = $("negAvisosQuitar");
    if (quitar && !quitar.dataset.listo) { quitar.dataset.listo = "1"; quitar.onclick = quitarAvisosDueno; }
    const card = $("negAvisosCard");
    if (card) card.hidden = !EST.sel;
  }

  function pintarAjustes() {
    const t = EST.sel;
    engancharAvisosDueno();
    if (t && !EST.avisosConsultados) {
      EST.avisosConsultados = true;
      if (soportaAvisos()) consultarAvisosDueno();
      else pintarAvisosDueno(false, "Este navegador no soporta notificaciones push.");
    }
    if (!t) return;
    const poner = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };
    poner("neNombre", t.nombre);
    poner("neMarca", t.marca);
    poner("neRubro", t.rubro);
    poner("neTelefono", t.telefono);
    poner("neDireccion", t.direccion);
    poner("neComuna", t.comuna);
    poner("neHorario", t.horario);
    poner("neMinimo", t.minimo || "");
    poner("neEnvio", t.envio || "");
    poner("neDesc", t.descripcion);
    const retiro = $("neRetiro"), delivery = $("neDelivery");
    const entrega = Array.isArray(t.entrega) ? t.entrega : ["retiro"];
    if (retiro) retiro.checked = entrega.indexOf("retiro") >= 0;
    if (delivery) delivery.checked = entrega.indexOf("delivery") >= 0;
    pintarLogo($("neLogoPrev"), EST.logoEditar || t.logo);
  }

  /* ── acciones ───────────────────────────────────────────────────────────── */
  async function crearTienda(e) {
    if (e) e.preventDefault();
    const btn = $("negFormTienda") && $("negFormTienda").querySelector('button[type="submit"]');
    const campos = {
      nombre: ($("ntNombre").value || "").trim(),
      marca: ($("ntMarca").value || "").trim(),
      rubro: ($("ntRubro").value || "").trim() || "Local",
      telefono: ($("ntTel").value || "").trim(),
      direccion: ($("ntDireccion").value || "").trim(),
      comuna: ($("ntComuna").value || "").trim(),
      lat: Number(String($("ntLat").value || "").replace(",", ".")),
      lon: Number(String($("ntLon").value || "").replace(",", ".")),
      descripcion: ($("ntDesc").value || "").trim(),
      logo: EST.logoNueva || "",
      abierto: true
    };
    if (campos.nombre.length < 2) { aviso($("ntAviso"), "Escribe el nombre del local.", "malo"); return; }
    if (!campos.lat || !campos.lon) {
      aviso($("ntAviso"), "Faltan las coordenadas: toca «Usar mi ubicación» o escríbelas.", "malo");
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Publicando…"; }
    aviso($("ntAviso"), "Publicando tu tienda…");
    const d = await api({ accion: "local_crear", local: campos });
    if (btn) { btn.disabled = false; btn.textContent = "Publicar mi tienda"; }
    if (!d || !d.ok) {
      aviso($("ntAviso"), (d && d.error) || "No pude crear la tienda.", "malo");
      return;
    }
    aviso($("ntAviso"), "Tienda creada. Clave de respaldo: " + d.clave + " (guárdala).", "bueno");
    toast("Tienda publicada: " + d.nombre);
    EST.pendienteSel = d.id;
    guardarJSON(CLAVE_SEL, d.id);
    // Limpia el formulario.
    ["ntNombre", "ntMarca", "ntRubro", "ntTel", "ntDireccion", "ntComuna",
      "ntLat", "ntLon", "ntDesc"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    EST.logoNueva = "";
    pintarLogo($("ntLogoPrev"), "");
    const form = $("negFormTienda");
    if (form) form.hidden = true;
    await refrescar();
  }

  async function guardarAjustes() {
    if (!EST.sel) return;
    const campos = {
      nombre: ($("neNombre").value || "").trim(),
      marca: ($("neMarca").value || "").trim(),
      rubro: ($("neRubro").value || "").trim(),
      telefono: ($("neTelefono").value || "").trim(),
      direccion: ($("neDireccion").value || "").trim(),
      comuna: ($("neComuna").value || "").trim(),
      horario: ($("neHorario").value || "").trim(),
      minimo: Number(String($("neMinimo").value || "").replace(/[^\d]/g, "")) || 0,
      envio: Number(String($("neEnvio").value || "").replace(/[^\d]/g, "")) || 0,
      descripcion: ($("neDesc").value || "").trim(),
      logo: EST.logoEditar || EST.sel.logo || "",
      entrega: []
    };
    if ($("neRetiro") && $("neRetiro").checked) campos.entrega.push("retiro");
    if ($("neDelivery") && $("neDelivery").checked) campos.entrega.push("delivery");
    if (!campos.entrega.length) campos.entrega = ["retiro"];
    if (campos.nombre.length < 2) { aviso($("neAviso"), "El nombre no puede quedar vacío.", "malo"); return; }

    const btn = $("neGuardar");
    if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
    const d = await api({
      accion: "local_actualizar", local_id: EST.sel.id,
      clave: EST.sel.clave || "", campos: campos
    });
    if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
    if (!d || !d.ok) {
      aviso($("neAviso"), (d && d.error) || "No pude guardar los cambios.", "malo");
      return;
    }
    Object.assign(EST.sel, campos);
    EST.logoEditar = "";
    aviso($("neAviso"), "Cambios guardados: el mapa ya muestra la ficha nueva.", "bueno");
    toast("Ficha actualizada");
    render();
  }

  async function borrarTienda() {
    if (!EST.sel) return;
    const t = EST.sel;
    if (!window.confirm('¿Borrar "' + t.nombre + '"? Se eliminan su catálogo y sus pedidos.')) return;
    const d = await api({ accion: "local_borrar", local_id: t.id, clave: t.clave || "" });
    if (!d || !d.ok) {
      aviso($("neAviso"), (d && d.error) || "No pude borrar la tienda.", "malo");
      return;
    }
    EST.tiendas = EST.tiendas.filter((x) => x.id !== t.id);
    EST.sel = EST.tiendas[0] || null;
    if (EST.sel) guardarJSON(CLAVE_SEL, EST.sel.id); else borrarJSON(CLAVE_SEL);
    EST.pedidos = [];
    toast("Tienda borrada");
    await refrescar();
  }

  async function subirProductos(lista, etiqueta) {
    if (!EST.sel) return;
    const av = $("negImportAviso");
    if (!lista || !lista.length) {
      aviso(av, "No encontré productos válidos (nombre y precio son obligatorios).", "malo");
      return;
    }
    const LOTE = 400;   // el servidor acepta hasta 500 por petición
    let subidos = 0, omitidos = 0, total = 0, tope = 0, codigosMalos = 0;
    let ejemploCodigo = "";
    aviso(av, "Subiendo " + lista.length + " producto(s)…");
    for (let i = 0; i < lista.length; i += LOTE) {
      const lote = lista.slice(i, i + LOTE);
      const d = await api({
        accion: "productos_subir", local_id: EST.sel.id,
        clave: EST.sel.clave || "", productos: lote
      });
      if (!d || !d.ok) {
        aviso(av, (d && d.error) || "No pude subir el catálogo.", "malo");
        if (subidos) await refrescar({ silencioso: true });
        return;
      }
      subidos += Number(d.subidos) || 0;
      omitidos += Number(d.omitidos) || 0;
      total = Number(d.total) || total;
      tope = Number(d.tope) || tope;
      codigosMalos += Number(d.codigos_invalidos) || 0;
      if (!ejemploCodigo && Array.isArray(d.detalle_codigos_invalidos) && d.detalle_codigos_invalidos[0]) {
        ejemploCodigo = String(d.detalle_codigos_invalidos[0].codigo || "");
      }
    }
    aviso(av, (etiqueta || "Catálogo") + ": " + subidos + " guardados" +
      (omitidos ? " · " + omitidos + " omitidos" : "") +
      (codigosMalos
        ? " · " + codigosMalos + " con código inválido" +
          (ejemploCodigo ? " («" + ejemploCodigo + "»)" : "") + ", quedaron sin código"
        : "") +
      " · total " + total + "/" + tope + ".",
      codigosMalos ? "malo" : "bueno");
    toast(subidos + " producto(s) en el catálogo");
    await refrescar({ silencioso: true });
  }

  async function agregarProducto(e) {
    if (e) e.preventDefault();
    if (!EST.sel) return;
    const nombre = ($("negProdNombre").value || "").trim();
    const precio = Math.round(Number(String($("negProdPrecio").value || "").replace(/[^\d]/g, "")) || 0);
    if (!nombre || precio <= 0) { toast("Falta el nombre o el precio"); return; }
    const stockCrudo = ($("negProdStock").value || "").trim();
    const dctoCrudo = ($("negProdDescuento").value || "").trim();
    const hastaCrudo = ($("negProdOfertaHasta").value || "").trim();
    const codigoCrudo = ($("negProdCodigo").value || "").trim();
    const codigo = window.Scan ? window.Scan.normalizarCodigo(codigoCrudo) : codigoCrudo;
    if (codigo && window.Scan && !window.Scan.pareceCodigo(codigo)) {
      aviso($("negProdCodigoAviso"), "Ese código no es válido: revisa el dígito verificador.", "malo");
      toast("Código de barras inválido");
      const el = $("negProdCodigo");
      if (el) el.focus();
      return;
    }
    const sku = ($("negProdSku").value || "").trim() ||
      (EST.editandoSku || "LOCAL-" + Date.now().toString(36).slice(-6).toUpperCase());
    const producto = {
      sku: sku,
      nombre: nombre,
      precio: precio,
      stock: stockCrudo === "" ? null : Math.max(0, Math.round(Number(stockCrudo) || 0)),
      categoria: ($("negProdCategoria").value || "").trim(),
      unidad: "u",
      descuento: dctoCrudo === "" ? 0 : Math.max(0, Math.min(90, Math.round(Number(dctoCrudo) || 0))),
      // El servidor guarda el fin de la oferta como unix; una fecha sin hora
      // vale hasta el final de ese día en Chile.
      oferta_hasta: hastaCrudo || 0,
      // El campo muestra el código guardado: vacío significa «sin código».
      codigo: codigo
    };
    // Sólo se manda `imagen` si el vendedor la tocó: si no, el servidor
    // conserva la foto que ya tenía el producto.
    if (EST.prodImagen !== undefined) producto.imagen = EST.prodImagen;
    await subirProductos([producto], EST.editandoSku ? "Producto actualizado" : "Producto agregado");
    EST.editandoSku = "";
    EST.prodImagen = undefined;
    ["negProdNombre", "negProdPrecio", "negProdStock", "negProdSku", "negProdCategoria",
      "negProdDescuento", "negProdOfertaHasta", "negProdCodigo"]
      .forEach((id) => { const el = $(id); if (el) el.value = ""; });
    const foto = $("negProdFotoFile");
    if (foto) foto.value = "";
    pintarFotoProducto();
    aviso($("negProdFotoAviso"), "JPG, PNG o WebP. Se achica a 640 px.", "");
    aviso($("negProdCodigoAviso"), "", "");
    const b = $("negFormProd") && $("negFormProd").querySelector('button[type="submit"]');
    if (b) b.textContent = "Agregar al catálogo";
    render();
  }

  async function borrarProducto(sku) {
    if (!EST.sel || !sku) return;
    const d = await api({
      accion: "producto_borrar", local_id: EST.sel.id,
      clave: EST.sel.clave || "", skus: [sku]
    });
    if (!d || !d.ok) { toast((d && d.error) || "No pude borrar el producto"); return; }
    EST.sel.catalogo = (EST.sel.catalogo || []).filter((p) => p.sku !== sku);
    if (EST.editandoSku === sku) {
      EST.editandoSku = "";
      EST.prodImagen = undefined;
      pintarFotoProducto();
    }
    render();
  }

  function editarProducto(sku) {
    const p = (EST.sel && EST.sel.catalogo || []).find((x) => x.sku === sku);
    if (!p) return;
    EST.editandoSku = sku;
    EST.prodImagen = undefined;   // conserva la foto guardada hasta que la toquen
    const foto = $("negProdFotoFile");
    if (foto) foto.value = "";
    pintarFotoProducto();
    const poner = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };
    poner("negProdNombre", p.nombre);
    poner("negProdPrecio", p.precio);
    poner("negProdStock", p.stock == null ? "" : p.stock);
    poner("negProdSku", p.sku);
    poner("negProdCategoria", p.categoria);
    poner("negProdDescuento", p.descuento ? p.descuento : "");
    poner("negProdOfertaHasta", fechaInput(p.oferta_hasta));
    poner("negProdCodigo", p.codigo);
    aviso($("negProdCodigoAviso"), "", "");
    const b = $("negFormProd") && $("negFormProd").querySelector('button[type="submit"]');
    if (b) b.textContent = "Guardar cambios";
    pintarCatalogo();
    const form = $("negFormProd");
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function alternarAbierto() {
    if (!EST.sel || EST.sel.abierto === null || EST.sel.abierto === undefined) return;
    const nuevo = !EST.sel.abierto;
    const d = await api({
      accion: "local_estado", local_id: EST.sel.id,
      clave: EST.sel.clave || "", abierto: nuevo
    });
    if (!d || !d.ok) { toast((d && d.error) || "No pude cambiar el estado"); return; }
    EST.sel.abierto = nuevo;
    render();
  }

  /** Descarga la lista visible (con sus filtros) como CSV para Excel. */
  function exportarPedidos() {
    const lista = filtrarPedidos(pedidosVisibles(), EST.buscar, EST.filtro);
    if (!lista.length) { toast("No hay pedidos que exportar"); return; }
    const csv = csvPedidos(lista);
    // BOM: sin esto Excel abre los acentos como basura.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pedidos-" + ((EST.sel && EST.sel.id) || "local") + "-" +
      new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(lista.length + " pedido(s) exportados");
  }

  const ESTADOS_PEDIDO = [
    { clave: "nuevo", txt: "Recibido" },
    { clave: "visto", txt: "Preparando" },
    { clave: "listo", txt: "Listo" },
    { clave: "entregado", txt: "Entregado" },
    { clave: "cancelado", txt: "Cancelado" }
  ];

  /** Avanza el pedido a `estado`. En la nube lo deja el historial de eventos. */
  async function cambiarEstado(id, estado, esNube, claveEntrega) {
    if (esNube) {
      if (!EST.sel) return;
      const d = await api({
        accion: "pedido_estado", local_id: EST.sel.id,
        clave: EST.sel.clave || "", pedido_id: id, estado,
        clave_entrega: claveEntrega || ""
      });
      if (d && d.ok) {
        EST.verificando = "";
        EST.errorVerif = "";
        await cargarPedidos();
        const txt = (ESTADOS_PEDIDO.find((e) => e.clave === estado) || {}).txt;
        toast("Pedido en «" + String(txt || estado).toLowerCase() + "»");
      } else {
        // El código de entrega no coincide: la caja sigue abierta para
        // volver a pedírselo al comprador.
        if (d && d.codigo === "CLAVE_ENTREGA") {
          EST.errorVerif = d.error || "El código de entrega no coincide.";
        }
        toast((d && d.error) || "No se pudo cambiar el estado");
      }
      render();
      return;
    }
    guardar(leer().map((p) => p.codigo === id ? Object.assign({}, p, { estado }) : p));
    render();
  }

  /* ── enlaces ────────────────────────────────────────────────────────────── */
  function enganchar() {
    // Pedidos: la misma función que usa la lista, para no pisar el código
    // de entrega con un cambio de estado directo.
    engancharPedidos(document);

    // Pestañas del panel.
    const tabs = $("negTabs");
    if (tabs && !tabs.dataset.listo) {
      tabs.dataset.listo = "1";
      tabs.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-tab]");
        if (!b) return;
        EST.tab = b.dataset.tab;
        pintarTabs();
        // Pedidos cambia todo el tiempo: al abrir la pestaña se relee.
        if (EST.tab === "pedidos" && EST.sel) {
          cargarPedidos().then(() => pintarPedidos());
        }
        // Las reseñas también llegan solas (el comprador califica desde su
        // enlace), así que se releen al abrir la pestaña.
        if (EST.tab === "resenas" && EST.sel) cargarResenas();
      });
    }

    // Periodo del resumen (7 o 30 días).
    const rango = $("negRango");
    if (rango && !rango.dataset.listo) {
      rango.dataset.listo = "1";
      rango.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-rango]");
        if (!b) return;
        const n = Number(b.dataset.rango) || 7;
        if (n === EST.rango) return;
        EST.rango = n;
        rango.querySelectorAll("[data-rango]").forEach((x) => {
          const on = Number(x.dataset.rango) === n;
          x.classList.toggle("on", on);
          x.setAttribute("aria-pressed", on ? "true" : "false");
        });
        EST.serie = null;
        EST.serieError = "";
        pintarResumen();
        cargarSerie();
      });
    }

    // Filtros de la lista de pedidos.
    const buscar = $("negPedBuscar");
    if (buscar && !buscar.dataset.listo) {
      buscar.dataset.listo = "1";
      buscar.addEventListener("input", () => { EST.buscar = buscar.value; pintarPedidos(); });
    }
    const filtro = $("negPedFiltro");
    if (filtro && !filtro.dataset.listo) {
      filtro.dataset.listo = "1";
      filtro.addEventListener("change", () => { EST.filtro = filtro.value; pintarPedidos(); });
    }
    const exp = $("negPedExport");
    if (exp) exp.onclick = exportarPedidos;

    // Mis tiendas.
    const caja = $("negTiendas");
    if (caja && !caja.dataset.listo) {
      caja.dataset.listo = "1";
      caja.addEventListener("click", (ev) => {
        const crear = ev.target.closest("[data-crear]");
        const cuenta = ev.target.closest("[data-cuenta]");
        const abrir = ev.target.closest("[data-abrir]");
        const mapa = ev.target.closest("[data-mapa]");
        const card = ev.target.closest("[data-tienda]");
        if (crear) { mostrarFormTienda(); return; }
        if (cuenta) { if (window.Fabri) window.Fabri.go("cuenta"); return; }
        if (mapa) { verEnMapa(mapa.dataset.mapa); return; }
        if (abrir) { abrirTienda(abrir.dataset.abrir); return; }
        if (card) abrirTienda(card.dataset.tienda);
      });
    }

    // Catálogo.
    const prods = $("negProductos");
    if (prods && !prods.dataset.listo) {
      prods.dataset.listo = "1";
      prods.addEventListener("click", (ev) => {
        const ed = ev.target.closest("[data-editar]");
        const quitar = ev.target.closest("[data-quitar]");
        if (ed) { editarProducto(ed.dataset.editar); return; }
        if (quitar) borrarProducto(quitar.dataset.quitar);
      });
    }

    // Formularios y botones fijos: se reasignan (onclick no acumula).
    const ntCancelar = $("ntCancelar");
    if (ntCancelar) ntCancelar.onclick = () => { const f = $("negFormTienda"); if (f) f.hidden = true; };
    const ntGps = $("ntGps");
    if (ntGps) ntGps.onclick = usarUbicacion;
    const cuentaIr = $("negCuentaIr");
    if (cuentaIr) cuentaIr.onclick = () => { if (window.Fabri) window.Fabri.go("cuenta"); };

    const verMapa = $("negVerMapa");
    if (verMapa) verMapa.onclick = () => verEnMapa();

    const ab = $("negAbiertoBtn");
    if (ab) ab.onclick = alternarAbierto;
    const v3 = $("negVer3d");
    if (v3) v3.onclick = verTienda3d;

    // Link público de la marca.
    const compartir = $("negCompartir");
    if (compartir) compartir.onclick = () => compartirMarca(compartir);
    const copiarLink = $("negLinkCopiar");
    if (copiarLink) copiarLink.onclick = () => {
      const campo = $("negLinkMarca");
      copiarUrl((campo && campo.value) || "", copiarLink);
    };
    const abrirLink = $("negLinkAbrir");
    if (abrirLink) abrirLink.onclick = () => {
      const campo = $("negLinkMarca");
      const url = (campo && campo.value) || "";
      if (!url) return;
      try {
        const v = window.open(url, "_blank", "noopener");
        if (!v) window.location.href = url;
      } catch (e) { window.location.href = url; }
    };
    const guardarBtn = $("neGuardar");
    if (guardarBtn) guardarBtn.onclick = guardarAjustes;
    const borrarBtn = $("neBorrar");
    if (borrarBtn) borrarBtn.onclick = borrarTienda;

    const claveBtn = $("negNubeBtn");
    if (claveBtn) claveBtn.onclick = async () => {
      const li = $("negNubeLocal"), cl = $("negNubeClave");
      const localId = (li ? li.value : "").trim().toLowerCase();
      const clave = (cl ? cl.value : "").trim();
      if (!localId || !clave) {
        aviso($("negNubeClaveEstado"), "Escribe el ID del local y su clave.", "malo");
        return;
      }
      const ok = await conectarClave(localId, clave, false);
      if (ok) { if (cl) cl.value = ""; render(); }
    };

    const impStock = $("negImportStock");
    if (impStock) impStock.onclick = () => {
      const lista = productosDeStock();
      if (!lista.length) {
        aviso($("negImportAviso"), "Tu Stock local no tiene productos (o la base no está lista).", "malo");
        return;
      }
      subirProductos(lista, "Desde mi Stock");
    };
  }

  function mostrarFormTienda() {
    const form = $("negFormTienda");
    if (!form) return;
    form.hidden = false;
    aviso($("ntAviso"), "");
    const n = $("ntNombre");
    if (n && n.focus) n.focus();
    if (form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function usarUbicacion() {
    const av = $("ntAviso");
    if (!navigator.geolocation) {
      aviso(av, "Este navegador no entrega la ubicación: escribe latitud y longitud.", "malo");
      return;
    }
    aviso(av, "Pidiendo tu ubicación…");
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      if ($("ntLat")) $("ntLat").value = lat.toFixed(6);
      if ($("ntLon")) $("ntLon").value = lon.toFixed(6);
      aviso(av, "Ubicación lista: revisa que sea la del local.", "bueno");
    }, (err) => {
      aviso(av, "No pude obtener la ubicación (" + (err && err.message ? err.message : "permiso denegado") + ").", "malo");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }

  /* ── arranque ───────────────────────────────────────────────────────────── */
  function precargar() {
    const n = leerJSON(CLAVE_NUBE, null);
    const li = $("negNubeLocal");
    if (li && n && n.local_id && !li.value) li.value = n.local_id;
    EST.token = tokenNube();
  }

  function enlazarFormularios() {
    const form = $("negFormProd");
    if (form && !form.dataset.listo) {
      form.dataset.listo = "1";
      form.addEventListener("submit", agregarProducto);
    }
    const scanCodigo = $("negProdCodigoScan");
    if (scanCodigo && !scanCodigo.dataset.listo) {
      scanCodigo.dataset.listo = "1";
      scanCodigo.addEventListener("click", async () => {
        const av = $("negProdCodigoAviso");
        if (!window.Scan) {
          aviso(av, "Este navegador no tiene escáner de códigos.", "malo");
          return;
        }
        let leido = null;
        try {
          leido = await window.Scan.abrir({ subtitulo: "apunta al código del producto" });
        } catch (e) {
          aviso(av, "No pude abrir la cámara.", "malo");
          return;
        }
        if (!leido) return;
        const codigo = window.Scan.normalizarCodigo(leido);
        const el = $("negProdCodigo");
        if (el) el.value = codigo;
        const vale = window.Scan.pareceCodigo(codigo);
        aviso(av, vale ? "Código leído: " + codigo
          : "El código leído no es válido: revisa el dígito verificador.",
          vale ? "bueno" : "malo");
      });
    }
    const fotoProd = $("negProdFotoFile");
    if (fotoProd && !fotoProd.dataset.listo) {
      fotoProd.dataset.listo = "1";
      fotoProd.addEventListener("change", async () => {
        const f = fotoProd.files && fotoProd.files[0];
        if (!f) return;
        const av = $("negProdFotoAviso");
        aviso(av, "Achicando la foto…");
        try {
          EST.prodImagen = await achicarFoto(f);
          pintarFotoProducto();
          aviso(av, "Foto lista (" + Math.round(EST.prodImagen.length / 1024) + " KB).", "bueno");
        } catch (e) {
          aviso(av, e.message, "malo");
        }
        fotoProd.value = "";
      });
    }
    const quitarFoto = $("negProdFotoQuitar");
    if (quitarFoto && !quitarFoto.dataset.listo) {
      quitarFoto.dataset.listo = "1";
      quitarFoto.addEventListener("click", () => {
        EST.prodImagen = "";
        pintarFotoProducto();
        aviso($("negProdFotoAviso"), "La foto se borrará al guardar.", "bueno");
      });
    }
    const ft = $("negFormTienda");
    if (ft && !ft.dataset.listo) {
      ft.dataset.listo = "1";
      ft.addEventListener("submit", crearTienda);
    }
    const logoNueva = $("ntLogoFile");
    if (logoNueva && !logoNueva.dataset.listo) {
      logoNueva.dataset.listo = "1";
      logoNueva.addEventListener("change", async () => {
        const f = logoNueva.files && logoNueva.files[0];
        if (!f) return;
        try {
          EST.logoNueva = await achicarLogo(f);
          pintarLogo($("ntLogoPrev"), EST.logoNueva);
          aviso($("ntAviso"), "Logo listo (" + Math.round(EST.logoNueva.length / 1024) + " KB).", "bueno");
        } catch (e) { aviso($("ntAviso"), e.message, "malo"); }
      });
    }
    const logoEditar = $("neLogoFile");
    if (logoEditar && !logoEditar.dataset.listo) {
      logoEditar.dataset.listo = "1";
      logoEditar.addEventListener("change", async () => {
        const f = logoEditar.files && logoEditar.files[0];
        if (!f) return;
        try {
          EST.logoEditar = await achicarLogo(f);
          pintarLogo($("neLogoPrev"), EST.logoEditar);
          aviso($("neAviso"), "Logo listo: toca «Guardar cambios» para publicarlo.", "bueno");
        } catch (e) { aviso($("neAviso"), e.message, "malo"); }
      });
    }
    const imp = $("negImportFile");
    if (imp && !imp.dataset.listo) {
      imp.dataset.listo = "1";
      imp.addEventListener("change", () => {
        const f = imp.files && imp.files[0];
        if (!f) return;
        const fr = new FileReader();
        fr.onerror = () => aviso($("negImportAviso"), "No pude leer el archivo.", "malo");
        fr.onload = () => {
          try {
            const lista = parseProductos(String(fr.result || ""));
            subirProductos(lista, f.name);
          } catch (e) {
            aviso($("negImportAviso"), e.message, "malo");
          }
        };
        fr.readAsText(f);
        imp.value = "";
      });
    }
  }

  precargar();

  return {
    render() { enlazarFormularios(); render(); },
    refrescar,
    /** Sólo para pruebas: parsers puros, sin DOM ni red. */
    _test: { parseCSV, parseProductos, aProducto, normClave, filtrarPedidos, csvPedidos, barrasSerie,
      enlaceSeguimiento, numeroWa, fraseEstado, mensajePedido, enlaceWa,
      enlaceMarca, ofertaDe, fechaInput, tieneCampo, achicarFoto }
  };
})();
