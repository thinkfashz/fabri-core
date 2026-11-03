/* ============================================================================
   NEGOCIO · panel del local
   ----------------------------------------------------------------------------
   Lo que ve el dueño: pedidos que llegan desde MercadoPlacer, ventas del día,
   ticket promedio y su catálogo real (tabla `products` de SQLite).

   Los pedidos se guardan en `fcore.placer.pedidos` al confirmar el pago; acá
   se leen, se marcan como entregados o se borran. No hay servidor: es el mismo
   almacenamiento local que usa el resto de la consola.
   ========================================================================== */

window.Negocio = (function () {
  "use strict";

  const CLAVE = "fcore.placer.pedidos";
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

  function productos() {
    try {
      if (window.Fabri && window.Fabri.q) {
        return window.Fabri.q("SELECT sku, name, price, unit FROM products ORDER BY id DESC LIMIT 80") || [];
      }
    } catch (e) { /* base todavía no lista */ }
    return [];
  }

  function render() {
    if (!$("negPedidos")) return;
    const pedidos = leer();
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const delDia = pedidos.filter((p) => p.fecha >= hoy.getTime());
    const ventas = delDia.reduce((a, p) => a + (Number(p.total) || 0), 0);
    const ticket = delDia.length ? Math.round(ventas / delDia.length) : 0;
    const pendientes = pedidos.filter((p) => p.estado !== "entregado").length;
    const prods = productos();

    $("negKpis").innerHTML =
      tarjeta("Ventas de hoy", clp(ventas), delDia.length + " pedidos", "oro") +
      tarjeta("Pedidos por entregar", String(pendientes), pendientes ? "requieren atención" : "todo al día", pendientes ? "alerta" : "") +
      tarjeta("Ticket promedio", clp(ticket), "por pedido de hoy", "") +
      tarjeta("Productos", String(prods.length), prods.length ? "en tu catálogo" : "sin cargar", "");

    const pc = $("negPedCount"), prc = $("negProdCount");
    if (pc) pc.textContent = pedidos.length;
    if (prc) prc.textContent = prods.length;

    $("negPedidos").innerHTML = pedidos.length
      ? pedidos.slice(0, 30).map((p) => {
          const hecho = p.estado === "entregado";
          return '<article class="neg-pedido' + (hecho ? " hecho" : "") + '">' +
            '<div class="neg-ped-cab">' +
              "<b>" + esc(p.codigo) + "</b>" +
              '<span class="neg-chip ' + (hecho ? "ok" : "pend") + '">' + (hecho ? "entregado" : "por entregar") + "</span>" +
              '<small>' + esc(dia(p.fecha)) + " · " + esc(hora(p.fecha)) + "</small>" +
            "</div>" +
            '<p class="neg-ped-cli">' + esc(p.cliente && p.cliente.nombre || "Cliente") +
              " · " + (p.entrega === "delivery" ? "delivery" : "retiro") +
              (p.direccion ? " · " + esc(p.direccion) : "") + "</p>" +
            '<div class="neg-ped-items">' +
              (p.items || []).map((x) => '<span>' + x.cantidad + "× " + esc(x.nombre) + "</span>").join("") +
            "</div>" +
            '<div class="neg-ped-pie">' +
              "<b>" + clp(p.total) + "</b>" +
              '<div class="neg-ped-acc">' +
                (hecho ? "" : '<button type="button" data-hecho="' + esc(p.codigo) + '">Marcar entregado</button>') +
                '<button type="button" class="borrar" data-borrar="' + esc(p.codigo) + '" aria-label="Borrar pedido">✕</button>' +
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

  function tarjeta(k, v, d, tono) {
    return '<div class="neg-kpi' + (tono ? " " + tono : "") + '">' +
      "<span>" + esc(k) + "</span><b>" + esc(v) + "</b><small>" + esc(d) + "</small></div>";
  }

  function enganchar(pedidos) {
    document.querySelectorAll("[data-hecho]").forEach((b) => {
      b.onclick = () => {
        const l = leer().map((p) => p.codigo === b.dataset.hecho ? Object.assign({}, p, { estado: "entregado" }) : p);
        guardar(l); render();
      };
    });
    document.querySelectorAll("[data-borrar]").forEach((b) => {
      b.onclick = () => {
        guardar(leer().filter((p) => p.codigo !== b.dataset.borrar));
        render();
      };
    });

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
          render();
        } catch (err) {
          window.Fabri.toast("No pude guardar: " + err.message);
        }
      });
    }
  }

  return { render };
})();
