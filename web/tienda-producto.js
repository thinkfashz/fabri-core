/* ==========================================================================
   PÁGINA: Detalle de producto (producto.html?id=<id>)
   Ficha completa, cantidad, QR real del producto y relacionados.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  var id = F.param("id");

  function noExiste() {
    F.$("#tiDetalle").innerHTML =
      '<div class="ds-empty">' +
      '<span class="ds-empty__icon" aria-hidden="true">' + F.ICONO.buscar + "</span>" +
      '<span class="ds-empty__title">No encontramos ese producto</span>' +
      '<span class="ds-empty__text">Puede que el enlace sea antiguo o el artículo ya no esté en el catálogo.</span>' +
      '<a class="ds-btn" href="tienda.html" style="margin-top:12px">Ver catálogo</a>' +
      "</div>";
    F.titulo("Producto no disponible");
  }

  function render(p) {
    var caja = F.$("#tiDetalle");
    var stock = typeof p.stock === "number" ? p.stock : null;

    caja.innerHTML =
      '<div class="ti-detalle">' +
        '<div class="ti-detalle-media" style="--tinte:' + F.esc(p.tinte || "#c8f542") + '">' +
          F.cuboHtml(p.tinte) +
          '<div class="ti-qr-caja" style="width:100%">' +
            '<canvas id="qrProd" width="132" height="132" aria-label="Código QR de ' + F.esc(p.nombre) + '"></canvas>' +
            "<div>" +
              '<p class="ti-eyebrow" style="color:var(--ds-accent-2)">Código del producto</p>' +
              "<b class=\"ds-mono\">" + F.esc(F.qrProducto(p)) + "</b>" +
              "<p>Escanealo con el <a href=\"escaner.html\" style=\"color:var(--ds-accent-2)\">escáner de la tienda</a> para buscarlo en la base de datos y agregarlo al carrito.</p>" +
            "</div>" +
          "</div>" +
        "</div>" +

        '<div class="ti-detalle-info">' +
          '<p class="ti-eyebrow">' + F.esc(p.categoria) + " · " + F.esc(p.clasificacion) + " · ref. " + F.esc(p.id) + "</p>" +
          "<h1>" + F.esc(p.nombre) + "</h1>" +
          '<div class="ti-detalle-precio">' +
            (F.enOferta(p)
              ? "<s>" + F.fmtCLP(p.precio) + "</s> " + F.fmtCLP(F.precioEfectivo(p)) +
                ' <span class="ti-ahorra">ahorras ' + F.esc(p.moneda || "CLP") + " " + F.fmtCLP(p.precio - F.precioEfectivo(p)) + " · −" + F.OFERTA.descuento + "%</span>"
              : F.fmtCLP(p.precio) + ' <small style="font-size:13px;color:var(--ds-text-tertiary)">' + F.esc(p.moneda || "CLP") + "</small>") +
          "</div>" +
          '<p class="ti-detalle-desc">' + F.esc(p.descripcion) + "</p>" +
          '<div class="ti-badges">' +
            '<span class="ds-badge ds-badge--accent">' + F.esc(p.categoria) + "</span>" +
            '<span class="ds-badge">' + F.esc(p.clasificacion) + "</span>" +
            (stock !== null
              ? (stock > 0
                  ? '<span class="ds-badge ds-badge--ok">' + stock + " en stock</span>"
                  : '<span class="ds-badge ds-badge--warn">Sin stock</span>')
              : "") +
            (F.enOferta(p) ? '<span class="ds-badge ds-badge--warn">OFERTA −' + F.OFERTA.descuento + "%</span>" : "") +
          "</div>" +

          '<div class="ti-cant" role="group" aria-label="Cantidad">' +
            '<button type="button" id="detMenos" aria-label="Disminuir cantidad">−</button>' +
            '<output id="detCant" aria-live="polite">' + (F.cantidadDe(p.id) || 1) + "</output>" +
            '<button type="button" id="detMas" aria-label="Aumentar cantidad">+</button>' +
          "</div>" +

          '<div class="ti-detalle-acciones">' +
            '<button class="ds-btn" type="button" id="detAgregar">Agregar al carrito</button>' +
            '<button class="ds-btn ds-btn--secondary" type="button" id="detComprar">Comprar ahora</button>' +
          "</div>" +
          '<p class="ti-nota">El precio con oferta se aplica solo en el carrito y en el resumen de pago.</p>' +
        "</div>" +
      "</div>";

    /* QR real del producto */
    if (!F.qrCanvas(F.qrProducto(p), F.$("#qrProd"), 300)) {
      var cv = F.$("#qrProd");
      if (cv) cv.style.display = "none";
    }

    /* cantidad */
    var cant = F.cantidadDe(p.id) || 1;
    F.$("#detMenos").addEventListener("click", function () { if (cant > 1) { cant--; F.$("#detCant").textContent = cant; } });
    F.$("#detMas").addEventListener("click", function () { cant++; F.$("#detCant").textContent = cant; });

    function sumar(irAlCarrito) {
      F.agregar(p.id, cant);
      F.pintaBadge();
      if (irAlCarrito) location.href = "carrito.html";
      else F.toast("Agregado: " + p.nombre + " ×" + cant);
    }
    F.$("#detAgregar").addEventListener("click", function () { sumar(false); });
    F.$("#detComprar").addEventListener("click", function () { sumar(true); });

    /* relacionados: misma categoría primero */
    var relacionados = F.lista().filter(function (x) { return x.id !== p.id; })
      .sort(function (a, b) {
        var pa = a.categoria === p.categoria ? 0 : 1;
        var pb = b.categoria === p.categoria ? 0 : 1;
        return pa - pb;
      }).slice(0, 4);
    if (relacionados.length) {
      F.$("#tiRelacionados").hidden = false;
      F.montaTarjetas(F.$("#gridRel"), relacionados);
    }

    F.titulo(p.nombre);
  }

  F.cargar().then(function () {
    var p = id ? F.prod(id) : null;
    if (!p) { noExiste(); return; }
    render(p);
  });
})();
