/* ============================================================================
   NEGOCIO · panel del local
   ----------------------------------------------------------------------------
   Lo que ve el dueño: los pedidos que llegan desde MercadoPlacer, sus ventas del
   día, el ticket promedio y su catálogo.

   Dos orígenes, uno manda:
     · NUBE (InsForge vía fabri-api): el dueño se conecta una vez con el ID de su
       local y su clave de 8 caracteres. Desde ahí ve los pedidos REALES de
       cualquier teléfono, prende/apaga el local y avanza el estado de cada
       pedido. La clave se guarda como SHA-256 en la base; acá queda solo en el
       navegador del dueño.
     · DISPOSITIVO (localStorage): el historial local de compras hechas en este
       teléfono. Sigue existiendo como respaldo si no hay conexión.

   Al conectar, se muestran los pedidos de la nube del local conectado y se
   ocultan los locales duplicados de este dispositivo; los pedidos locales de
   OTROS locales se siguen viendo.
   ========================================================================== */

window.Negocio = (function () {
  "use strict";

  const CLAVE = "fcore.placer.pedidos";      // historial local (lo escribe placer.js)
  const CLAVE_NUBE = "fcore.negocio.nube";   // { local_id, clave } del dueño
  const API = "https://fabri-api.vercel.app/api/mercado";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clp(n) {
    return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
  }
  function leer() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || "[]") || []; } catch (e) { return []; }
  }
  function guardar(lista) {
    try { localStorage.setItem(CLAVE, JSON.stringify(lista)); } catch (e) { /* sin espacio */ }
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

  /* ── estado de la nube ──────────────────────────────────────────────────── */
  const NUBE = { local_id: "", clave: "", conectado: false, cargando: false,
                 aviso: "", nombre: "", abierto: null, pedidos: [], ts: 0 };

  function leerNube() {
    try { return JSON.parse(localStorage.getItem(CLAVE_NUBE) || "null") || {}; } catch (e) { return {}; }
  }
  function guardarNube(v) {
    try { localStorage.setItem(CLAVE_NUBE, JSON.stringify(v)); } catch (e) { /* modo privado */ }
  }

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

  async function apiMercado(cuerpo) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });
    return await r.json();
  }

  /* Trae pedidos y estado del local. Es idempotente y no bloquea la pintura. */
  async function refrescar() {
    if (!NUBE.local_id || !NUBE.clave || NUBE.cargando) return;
    NUBE.cargando = true;
    NUBE.ts = Date.now();
    try {
      const d = await apiMercado({ accion: "pedidos_listar", local_id: NUBE.local_id, clave: NUBE.clave });
      if (d && d.ok) {
        NUBE.conectado = true;
        NUBE.aviso = "";
        NUBE.nombre = d.local || NUBE.nombre;
        NUBE.pedidos = (d.pedidos || []).map(aLocal);
        try {
          const rl = await fetch(API + "?accion=locales&con_catalogo=0", { cache: "no-store" });
          const dl = await rl.json();
          const yo = (dl.tiendas || []).find((t) => t.id === NUBE.local_id);
          if (yo) { NUBE.abierto = yo.abierto !== false; NUBE.nombre = yo.nombre || NUBE.nombre; }
        } catch (e) { /* el estado abierto/cerrado es opcional */ }
      } else if (d && d.codigo === "clave_mala") {
        NUBE.conectado = false;
        NUBE.aviso = "Clave incorrecta para " + NUBE.local_id + ".";
      } else if (d && d.codigo === "local_inexistente") {
        NUBE.conectado = false;
        NUBE.aviso = "No existe un local con ese ID.";
      } else {
        NUBE.aviso = (d && d.error) || "No pude leer los pedidos.";
      }
    } catch (e) {
      NUBE.aviso = "Sin conexión con la nube.";
    }
    NUBE.cargando = false;
    pintar();
  }

  /* ── datos del dispositivo ──────────────────────────────────────────────── */
  function productos() {
    try {
      if (window.Fabri && window.Fabri.q) {
        return window.Fabri.q("SELECT sku, name, price, unit FROM products ORDER BY id DESC LIMIT 80") || [];
      }
    } catch (e) { /* base todavía no lista */ }
    return [];
  }

  /* Pedidos visibles: los de la nube del local conectado + los locales de OTROS
     locales (para no duplicar el mismo pedido hecho en este teléfono). */
  function pedidosVisibles() {
    const local = leer();
    if (!NUBE.conectado) return local;
    const otros = local.filter((p) => !(p.local && p.local.id === NUBE.local_id));
    return NUBE.pedidos.concat(otros).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  }

  /* ── pintura ────────────────────────────────────────────────────────────── */
  function render() {
    if (!$("negPedidos")) return;
    pintar();
    // Al abrir el panel con la nube guardada, refresca si pasó un rato.
    if (NUBE.local_id && NUBE.clave && !NUBE.cargando && Date.now() - NUBE.ts > 15000) refrescar();
  }

  function pintar() {
    if (!$("negPedidos")) return;
    const pedidos = pedidosVisibles();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const delDia = pedidos.filter((p) => p.fecha >= hoy.getTime());
    const ventas = delDia.reduce((a, p) => a + (Number(p.total) || 0), 0);
    const ticket = delDia.length ? Math.round(ventas / delDia.length) : 0;
    const pendientes = pedidos.filter((p) => p.estado !== "entregado" && p.estado !== "cancelado").length;
    const prods = productos();

    $("negKpis").innerHTML =
      tarjeta("Ventas de hoy", clp(ventas), delDia.length + " pedidos", "oro") +
      tarjeta("Pedidos por entregar", String(pendientes), pendientes ? "requieren atención" : "todo al día", pendientes ? "alerta" : "") +
      tarjeta("Ticket promedio", clp(ticket), "por pedido de hoy", "") +
      tarjeta("Productos", String(prods.length), prods.length ? "en tu catálogo" : "sin cargar", "");

    const pc = $("negPedCount"), prc = $("negProdCount");
    if (pc) pc.textContent = pedidos.length;
    if (prc) prc.textContent = prods.length;

    pintarNube();

    $("negPedidos").innerHTML = pedidos.length
      ? pedidos.slice(0, 40).map((p) => {
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
      : '<div class="mp-vacio"><b>Todavía no hay pedidos</b><p>Cuando alguien pague en MercadoPlacer, aparece acá.</p></div>';

    $("negProductos").innerHTML = prods.length
      ? prods.slice(0, 24).map((p) =>
          '<div class="neg-prod"><b>' + esc(p.name || "Producto") + "</b>" +
          "<small>" + esc(p.sku || "sin SKU") + "</small>" +
          "<span>" + clp(p.price) + "</span></div>").join("")
      : '<div class="mp-vacio"><b>Sin productos cargados</b><p>Agrega el primero abajo o impórtalos desde Stock.</p></div>';

    enganchar(pedidos);
  }

  function pintarNube() {
    const el = $("negNubeEstado"), chip = $("negNubeChip"), btn = $("negNubeBtn"), ab = $("negAbiertoBtn");
    if (!el) return;
    if (NUBE.cargando) { el.textContent = "Sincronizando con la nube…"; }
    else if (NUBE.conectado) {
      el.textContent = "Conectado a " + (NUBE.nombre || NUBE.local_id) +
        (NUBE.abierto === false ? " · cerrado" : NUBE.abierto === true ? " · abierto" : "");
    } else if (NUBE.aviso) { el.textContent = NUBE.aviso; }
    else { el.textContent = "Mostrando solo este dispositivo."; }
    if (chip) {
      chip.textContent = NUBE.cargando ? "sincronizando" : NUBE.conectado ? "en línea" : "sin conectar";
      chip.className = "neg-chip " + (NUBE.conectado ? "ok" : "pend");
    }
    if (btn) btn.textContent = NUBE.conectado ? "Actualizar" : "Conectar";
    if (ab) {
      if (NUBE.conectado && NUBE.abierto !== null) {
        ab.hidden = false;
        ab.textContent = NUBE.abierto ? "Cerrar el local" : "Abrir el local";
      } else { ab.hidden = true; }
    }
  }

  /* ── acciones del dueño ─────────────────────────────────────────────────── */
  function conectar() {
    const li = $("negNubeLocal"), cl = $("negNubeClave");
    const local_id = (li ? li.value : "").trim().toLowerCase();
    const clave = (cl ? cl.value : "").trim() || NUBE.clave;
    if (!local_id || !clave) {
      NUBE.aviso = "Escribe el ID del local y su clave.";
      pintarNube();
      return;
    }
    NUBE.local_id = local_id;
    NUBE.clave = clave;
    NUBE.ts = 0;
    guardarNube({ local_id: local_id, clave: clave });
    if (cl) cl.value = "";
    refrescar();
  }

  async function alternarAbierto() {
    if (!NUBE.conectado || NUBE.abierto === null) return;
    const nuevo = !NUBE.abierto;
    NUBE.cargando = true; pintarNube();
    try {
      const d = await apiMercado({ accion: "local_estado", local_id: NUBE.local_id, clave: NUBE.clave, abierto: nuevo });
      if (d && d.ok) NUBE.abierto = nuevo;
      else NUBE.aviso = (d && d.error) || "No pude cambiar el estado.";
    } catch (e) { NUBE.aviso = "Sin conexión con la nube."; }
    NUBE.cargando = false;
    pintar();
  }

  async function marcarEntregado(id, esNube) {
    if (esNube) {
      try {
        const d = await apiMercado({ accion: "pedido_estado", local_id: NUBE.local_id, clave: NUBE.clave, pedido_id: id, estado: "entregado" });
        if (d && d.ok) await refrescar();
      } catch (e) { /* queda para el próximo refresco */ }
      return;
    }
    guardar(leer().map((p) => p.codigo === id ? Object.assign({}, p, { estado: "entregado" }) : p));
    pintar();
  }

  function enganchar() {
    document.querySelectorAll("[data-hecho]").forEach((b) => {
      b.onclick = () => marcarEntregado(b.dataset.hecho, b.dataset.nube === "1");
    });
    document.querySelectorAll("[data-borrar]").forEach((b) => {
      b.onclick = () => { guardar(leer().filter((p) => p.codigo !== b.dataset.borrar)); pintar(); };
    });

    const nb = $("negNubeBtn");
    if (nb) nb.onclick = conectar;
    const ab = $("negAbiertoBtn");
    if (ab) ab.onclick = alternarAbierto;

    const form = $("negFormProd");
    if (form && !form.dataset.listo) {
      form.dataset.listo = "1";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const nombre = ($("negProdNombre").value || "").trim();
        const precio = Number(($("negProdPrecio").value || "").replace(/[^\d]/g, ""));
        const sku = ($("negProdSku").value || "").trim() || "LOCAL-" + Date.now().toString(36).slice(-6).toUpperCase();
        if (!nombre || !precio) return;
        try {
          window.Fabri.run("INSERT INTO products(sku, name, price, unit) VALUES(?,?,?,?)",
            [sku, nombre, precio, "u"]);
          $("negProdNombre").value = "";
          $("negProdPrecio").value = "";
          $("negProdSku").value = "";
          window.Fabri.toast("Producto agregado: " + nombre);
          pintar();
        } catch (err) {
          window.Fabri.toast("No pude guardar: " + err.message);
        }
      });
    }
  }

  /* Deja los campos con lo último que se guardó, la primera vez que se pinta. */
  function precargar() {
    const n = leerNube();
    const li = $("negNubeLocal");
    if (li && n.local_id && !li.value) li.value = n.local_id;
    if (n.local_id && n.clave) { NUBE.local_id = n.local_id; NUBE.clave = n.clave; }
  }

  precargar();

  return { render, refrescar };
})();
