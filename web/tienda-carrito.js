/* ==========================================================================
   PÁGINA: Carrito (carrito.html)
   Lista editable (±, quitar), KPIs y resumen con descuento aplicado.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  var lista = F.$("#caLista");
  var resumen = F.$("#caResumen");

  function ahorroTotal() {
    var a = 0;
    F.carrito().forEach(function (item) {
      var p = F.prod(item.id);
      if (p && F.enOferta(p)) a += (p.precio - F.precioEfectivo(p)) * item.cantidad;
    });
    return a;
  }

  function pinta() {
    var carrito = F.carrito();
    var unidades = F.contarItems();
    var total = F.totalCarrito();

    F.$("#kpUn").textContent = unidades;
    F.$("#kpItems").textContent = carrito.length + (carrito.length === 1 ? " producto" : " productos");
    F.$("#kpTotal").textContent = F.fmtCLP(total);

    if (!carrito.length) {
      resumen.hidden = true;
      lista.innerHTML = '<div class="ds-empty">' +
        '<span class="ds-empty__icon" aria-hidden="true">' + F.ICONO.carrito + "</span>" +
        '<span class="ds-empty__title">Tu carrito está vacío</span>' +
        '<span class="ds-empty__text">Agrega productos desde el catálogo o escanea un QR con el escáner.</span>' +
        '<span class="ds-cluster" style="justify-content:center;margin-top:14px">' +
          '<a class="ds-btn" href="tienda.html">Ver catálogo</a>' +
          '<a class="ds-btn ds-btn--secondary" href="escaner.html">Escanear QR</a>' +
        "</span></div>";
      return;
    }

    lista.innerHTML = carrito.map(F.filaProdHtml).join("");
    resumen.hidden = false;

    var ahorro = ahorroTotal();
    F.$("#caDetalle").innerHTML =
      '<div class="ds-row"><span class="ds-row__key">Subtotal (precio de lista)</span>' +
        '<span class="ds-row__value ds-row__value--muted ds-tabular">' + F.fmtCLP(total + ahorro) + "</span></div>" +
      '<div class="ds-row"><span class="ds-row__key">Descuento de oferta</span>' +
        '<span class="ds-row__value ds-row__value--ok ds-tabular">' + (ahorro ? "−" + F.fmtCLP(ahorro) : F.fmtCLP(0)) + "</span></div>" +
      '<div class="ds-row"><span class="ds-row__key">Envío</span>' +
        '<span class="ds-row__value ds-row__value--muted">A coordinar por WhatsApp</span></div>';
    F.$("#caTotal").textContent = F.fmtCLP(total);
  }

  F.cargar().then(function () {
    F.bindeaFilas(lista, pinta);
    F.$("#caVaciar").addEventListener("click", function () {
      F.vaciar();
      pinta();
      F.toast("Carrito vacío");
    });
    pinta();
    F.titulo("Carrito");
  });
})();
