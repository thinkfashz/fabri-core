/* ==========================================================================
   PÁGINA: Confirmación de pago (pago.html)
   Lee el resultado guardado por checkout y muestra aprobado / rechazado,
   con el pedido ya armado para confirmarlo por WhatsApp.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  function textoWA(p) {
    var t = "Hola! Quiero comprar en FORGE CORE STOCK:\n\n*Pedido " + p.ref + "*\n";
    p.lineas.forEach(function (l) {
      t += l.cantidad + "× " + l.nombre + " — " + F.fmtCLP(l.subtotal) + "\n";
    });
    t += "\n*Total:* " + F.fmtCLP(p.total) + "\n";
    t += "*Pago:* " + (p.metodo === "tarjeta" ? "Tarjeta" : "Efectivo") + "\n";
    if (p.ahorro) t += "*Ahorro de oferta:* −" + F.fmtCLP(p.ahorro) + "\n";
    if (p.nombre) t += "*Nombre:* " + p.nombre + "\n";
    if (p.tel) t += "*Teléfono:* " + p.tel + "\n";
    if (p.dir) t += "*Dirección:* " + p.dir + "\n";
    t += "\nConfirmo mi pedido.";
    return t;
  }

  function aprobado(r) {
    var p = r.pedido;
    F.$("#pgEstado").innerHTML =
      '<div class="ti-estado-icono ok" aria-hidden="true">' + F.ICONO.check + "</div>" +
      "<h1>Pago aprobado</h1>" +
      '<p class="ti-sub">Tu pedido quedó registrado con total <b>' + F.fmtCLP(p.total) +
      "</b>. Ahora confírmalo al negocio por WhatsApp: el mensaje ya viene con el detalle armado.</p>" +
      '<div class="ti-estado-acciones">' +
        '<a class="ti-wa" href="https://wa.me/' + F.WA + "?text=" + encodeURIComponent(textoWA(p)) + '" target="_blank" rel="noopener">' +
          F.ICONO.whatsapp + "Confirmar mi compra por WhatsApp</a>" +
      "</div>" +
      '<div class="ti-estado-acciones" style="margin-top:14px">' +
        '<a class="ds-btn ds-btn--secondary" href="tienda.html">Volver al catálogo</a>' +
        '<a class="ds-btn ds-btn--ghost" href="escaner.html">Escanear otro producto</a>' +
      "</div>" +
      '<p class="ti-pedido-ref">Pedido ' + F.esc(p.ref) + " · Pago: " + (p.metodo === "tarjeta" ? "Tarjeta" : "Efectivo") +
      " · " + p.lineas.length + (p.lineas.length === 1 ? " artículo" : " artículos") + "</p>";
    F.titulo("Pago aprobado");
  }

  function rechazado(r) {
    F.$("#pgEstado").innerHTML =
      '<div class="ti-estado-icono err" aria-hidden="true">' + F.ICONO.x + "</div>" +
      "<h1>Pago rechazado</h1>" +
      '<p class="ti-sub">' + F.esc(r.motivo || "La entidad emisora rechazó el pago.") +
      " Tu carrito sigue guardado: puedes intentarlo de nuevo o cambiar la forma de pago.</p>" +
      '<div class="ti-estado-acciones">' +
        '<a class="ds-btn" href="checkout.html">Reintentar el pago</a>' +
        '<a class="ds-btn ds-btn--secondary" href="carrito.html">Volver al carrito</a>' +
      "</div>" +
      '<p class="ti-pedido-ref">Sin cargo realizado · demo de pasarela</p>';
    F.titulo("Pago rechazado");
  }

  function sinPedido() {
    F.$("#pgEstado").innerHTML =
      '<div class="ds-empty">' +
      '<span class="ds-empty__icon" aria-hidden="true">' + F.ICONO.check + "</span>" +
      '<span class="ds-empty__title">Todavía no hay un pedido que mostrar</span>' +
      '<span class="ds-empty__text">El estado del pago aparece aquí después de pasar por el checkout.</span>' +
      '<span class="ds-cluster" style="justify-content:center;margin-top:14px">' +
        '<a class="ds-btn" href="tienda.html">Ver catálogo</a>' +
        '<a class="ds-btn ds-btn--secondary" href="carrito.html">Ver carrito</a>' +
      "</span></div>";
    F.titulo("Sin pedido");
  }

  var r = F.leeResultado();
  if (!r || !r.pedido) { sinPedido(); return; }
  if (r.estado === "aprobado") aprobado(r);
  else rechazado(r);
})();
