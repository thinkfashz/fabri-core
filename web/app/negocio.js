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
    cargando: false,
    ts: 0,
    aviso: "",
    logoNueva: "",       // data URI del formulario de alta
    logoEditar: "",      // data URI del formulario de ficha
    editandoSku: "",     // producto que se está editando
    pendienteSel: "",    // tienda a seleccionar tras refrescar
    /* panel de administración */
    tab: "resumen",      // "resumen" | "pedidos" | "catalogo" | "ajustes"
    rango: 7,            // días del resumen (7 o 30)
    serie: null,         // respuesta de ventas_serie
    serieTs: 0,          // cuándo llegó (para el «en vivo»)
    serieError: "",
    cargandoSerie: false,
    buscar: "",          // filtro de la lista de pedidos
    filtro: ""           // "" | "abiertos" | estado
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
      fecha: Date.parse(p.creado) || Date.now(),
      items: (p.items || []).map((x) => ({ nombre: x.nombre, precio: x.precio, cantidad: x.cantidad })),
      subtotal: Number(p.subtotal) || 0,
      envio: Number(p.envio) || 0,
      total: Number(p.total) || 0,
      entrega: p.entrega === "delivery" ? "delivery" : "retiro",
      direccion: p.direccion || "",
      cliente: { nombre: p.cliente || "", telefono: p.telefono || "" },
      estado: p.estado || "nuevo"
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

  /* ── importación de catálogo ────────────────────────────────────────────── */
  const SINONIMOS = {
    nombre: ["nombre", "name", "producto", "descripcion", "detalle"],
    precio: ["precio", "price", "valor", "pvp", "venta"],
    sku: ["sku", "codigo", "code", "barcode", "ean"],
    stock: ["stock", "cantidad", "qty", "existencias", "inventario"],
    categoria: ["categoria", "category", "rubro", "tipo", "familia"],
    unidad: ["unidad", "unit", "medida", "formato"]
  };

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
        if (SINONIMOS[k].some((s) => n === s || n.startsWith(s + "_") || n.endsWith("_" + s))) return k;
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
    return {
      sku: String(campo(o, SINONIMOS.sku) || "").trim().slice(0, 60),
      nombre,
      precio,
      stock,
      categoria: String(campo(o, SINONIMOS.categoria) || "").trim().slice(0, 40),
      unidad: String(campo(o, SINONIMOS.unidad) || "").trim().slice(0, 30)
    };
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
    EST.serie = null;
    EST.serieError = "";
    EST.serieTs = 0;
    EST.logoEditar = "";
    EST.editandoSku = "";
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
    const estado = $("negNubeEstado");
    if (estado) {
      estado.textContent = EST.cargando ? "Sincronizando con la nube…"
        : EST.aviso ? EST.aviso
        : "Pedidos y catálogo · " + (EST.modo === "cuenta" ? "tu cuenta" : "clave de la tienda");
    }

    // Contadores de las pestañas (los mismos números en el título de la tarjeta).
    const pedidos = pedidosVisibles();
    const prods = t.catalogo || [];
    const pc = $("negPedCount"), prc = $("negProdCount");
    if (pc) pc.textContent = pedidos.length;
    if (prc) prc.textContent = prods.length;
    const pt = $("negPedTotal"), prt = $("negProdTotal");
    if (pt) pt.textContent = pedidos.length;
    if (prt) prt.textContent = prods.length;

    pintarTabs();
    pintarEstadoVivo();
    pintarResumen();
    pintarPedidos();
    pintarCatalogo();
    pintarAjustes();
  }

  /* ── pestañas ───────────────────────────────────────────────────────────── */
  const TABS = ["resumen", "pedidos", "catalogo", "ajustes"];

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
      tarjeta("Productos", String((EST.sel && EST.sel.catalogo || []).length),
        "en tu catálogo", "");

    const sub = $("negSerieSub");
    if (sub) {
      sub.textContent = s
        ? "Últimos " + dias + " días · " + clp(t.ventas) + " en total"
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
          return '<article class="neg-pedido' + (hecho || cancel ? " hecho" : "") + '">' +
            '<div class="neg-ped-cab">' +
              "<b>" + esc(p.codigo) + "</b>" +
              '<span class="neg-chip ' + (hecho ? "ok" : "pend") + '">' + esc(p.estado || "por entregar") + "</span>" +
              '<small>' + esc(dia(p.fecha)) + " · " + esc(hora(p.fecha)) + (p.nube ? "" : " · local") + "</small>" +
            "</div>" +
            '<p class="neg-ped-cli">' + esc((p.cliente && p.cliente.nombre) || "Cliente") +
              " · " + (p.entrega === "delivery" ? "delivery" : "retiro") +
              (p.direccion ? " · " + esc(p.direccion) : "") + "</p>" +
            '<div class="neg-ped-items">' +
              (p.items || []).map((x) => "<span>" + x.cantidad + "× " + esc(x.nombre) + "</span>").join("") +
            "</div>" +
            '<div class="neg-ped-pie">' +
              "<b>" + clp(p.total) + "</b>" +
              '<div class="neg-ped-acc">' +
                (hecho || cancel ? "" : '<button type="button" data-hecho="' + esc(p.nube ? p.pedido_id : p.codigo) + '"' +
                  (p.nube ? ' data-nube="1"' : "") + ">Marcar entregado</button>") +
                (p.nube ? "" : '<button type="button" class="borrar" data-borrar="' + esc(p.codigo) + '" aria-label="Borrar pedido">✕</button>') +
              "</div>" +
            "</div>" +
          "</article>";
        }).join("")
      : (todos.length
        ? '<div class="mp-vacio"><b>Ningún pedido coincide</b>' +
          "<p>Prueba con otro texto o quita el filtro de estado.</p></div>"
        : '<div class="mp-vacio"><b>Todavía no hay pedidos</b>' +
          "<p>Cuando alguien pague en MercadoPlacer, aparece acá.</p></div>");

    // La lista se repinta con cada filtro: los botones se vuelven a enganchar.
    caja.querySelectorAll("[data-hecho]").forEach((b) => {
      b.onclick = () => marcarEntregado(b.dataset.hecho, b.dataset.nube === "1");
    });
    caja.querySelectorAll("[data-borrar]").forEach((b) => {
      b.onclick = () => { guardar(leer().filter((p) => p.codigo !== b.dataset.borrar)); render(); };
    });
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
      ? prods.slice(0, MAX_CATALOGO).map((p) =>
          '<div class="neg-prod' + (EST.editandoSku && EST.editandoSku === p.sku ? " on" : "") + '">' +
            "<b>" + esc(p.nombre || "Producto") + "</b>" +
            "<small>" + esc(p.sku || "sin SKU") +
              (p.categoria ? " · " + esc(p.categoria) : "") +
              (p.stock === null || p.stock === undefined ? "" : " · stock " + p.stock) + "</small>" +
            "<span>" + clp(p.precio) + "</span>" +
            '<div class="neg-prod-acc">' +
              '<button type="button" data-editar="' + esc(p.sku) + '">Editar</button>' +
              '<button type="button" class="borrar" data-quitar="' + esc(p.sku) + '" aria-label="Borrar producto">✕</button>' +
            "</div>" +
          "</div>").join("")
      : '<div class="mp-vacio"><b>Sin productos cargados</b><p>Agrega el primero abajo, importa un CSV/JSON o trae los de tu Stock.</p></div>';
  }

  function pintarAjustes() {
    const t = EST.sel;
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
    let subidos = 0, omitidos = 0, total = 0, tope = 0;
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
    }
    aviso(av, (etiqueta || "Catálogo") + ": " + subidos + " guardados" +
      (omitidos ? " · " + omitidos + " omitidos" : "") + " · total " + total + "/" + tope + ".", "bueno");
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
    const sku = ($("negProdSku").value || "").trim() ||
      (EST.editandoSku || "LOCAL-" + Date.now().toString(36).slice(-6).toUpperCase());
    const producto = {
      sku: sku,
      nombre: nombre,
      precio: precio,
      stock: stockCrudo === "" ? null : Math.max(0, Math.round(Number(stockCrudo) || 0)),
      categoria: ($("negProdCategoria").value || "").trim(),
      unidad: "u"
    };
    await subirProductos([producto], EST.editandoSku ? "Producto actualizado" : "Producto agregado");
    EST.editandoSku = "";
    ["negProdNombre", "negProdPrecio", "negProdStock", "negProdSku", "negProdCategoria"]
      .forEach((id) => { const el = $(id); if (el) el.value = ""; });
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
    if (EST.editandoSku === sku) EST.editandoSku = "";
    render();
  }

  function editarProducto(sku) {
    const p = (EST.sel && EST.sel.catalogo || []).find((x) => x.sku === sku);
    if (!p) return;
    EST.editandoSku = sku;
    const poner = (id, v) => { const el = $(id); if (el) el.value = v == null ? "" : v; };
    poner("negProdNombre", p.nombre);
    poner("negProdPrecio", p.precio);
    poner("negProdStock", p.stock == null ? "" : p.stock);
    poner("negProdSku", p.sku);
    poner("negProdCategoria", p.categoria);
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

  async function marcarEntregado(id, esNube) {
    if (esNube) {
      if (!EST.sel) return;
      const d = await api({
        accion: "pedido_estado", local_id: EST.sel.id,
        clave: EST.sel.clave || "", pedido_id: id, estado: "entregado"
      });
      if (d && d.ok) await cargarPedidos();
      render();
      return;
    }
    guardar(leer().map((p) => p.codigo === id ? Object.assign({}, p, { estado: "entregado" }) : p));
    render();
  }

  /* ── enlaces ────────────────────────────────────────────────────────────── */
  function enganchar() {
    // Pedidos locales / de la nube.
    document.querySelectorAll("[data-hecho]").forEach((b) => {
      b.onclick = () => marcarEntregado(b.dataset.hecho, b.dataset.nube === "1");
    });
    document.querySelectorAll("[data-borrar]").forEach((b) => {
      b.onclick = () => { guardar(leer().filter((p) => p.codigo !== b.dataset.borrar)); render(); };
    });

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
    _test: { parseCSV, parseProductos, aProducto, normClave, filtrarPedidos, csvPedidos, barrasSerie }
  };
})();
