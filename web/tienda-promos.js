/* ==========================================================================
   PÁGINA: Promociones (promociones.html)
   Oferta activa: cuenta regresiva, gauge d3, ahorro por producto y listado.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  function enOferta() {
    return F.lista().filter(F.enOferta);
  }

  function pintaKpis() {
    var l = enOferta();
    var maxAhorro = 0;
    l.forEach(function (p) { maxAhorro = Math.max(maxAhorro, p.precio - F.precioEfectivo(p)); });
    F.$("#kpN").textContent = l.length;
    F.$("#kpCat").textContent = F.OFERTA.categoria + " · −" + F.OFERTA.descuento + "%";
    F.$("#kpAhorro").textContent = l.length ? F.fmtCLP(maxAhorro) : "—";
    F.$("#kpCarrito").textContent = F.contarItems();
    F.$("#coAlcance").textContent = "Categoría " + F.OFERTA.categoria + " (" + l.length + " productos)";
  }

  /* barras de ahorro: componente .ds-progress del sistema */
  function pintaBarras() {
    var l = enOferta();
    var cont = F.$("#poBarras");
    if (!l.length) {
      cont.innerHTML = '<div class="ds-empty"><span class="ds-empty__title">Sin promociones activas</span>' +
        '<span class="ds-empty__text">Vuelve pronto: las ofertas se publican por tiempo limitado.</span></div>';
      return;
    }
    var max = l.reduce(function (m, p) { return Math.max(m, p.precio); }, 0);
    cont.innerHTML = l.map(function (p) {
      var frac = max ? F.precioEfectivo(p) / max : 0;
      var pct = Math.round((1 - F.precioEfectivo(p) / p.precio) * 100);
      return '<div>' +
        '<div class="ds-cluster ds-cluster--between" style="margin-bottom:6px">' +
          '<a href="producto.html?id=' + F.esc(p.id) + '" class="ds-truncate" style="color:inherit;text-decoration:none;font-weight:700">' + F.esc(p.nombre) + "</a>" +
          '<span class="ds-muted ds-tabular" style="font-size:var(--ds-text-sm)">' +
            "<s>" + F.fmtCLP(p.precio) + "</s> → <b style=\"color:var(--ds-warn)\">" + F.fmtCLP(F.precioEfectivo(p)) + "</b> (−" + pct + "%)" +
          "</span>" +
        "</div>" +
        '<div class="ds-progress ds-progress--ok" style="--ds-progress:' + frac.toFixed(3) + '" role="img" aria-label="' +
          F.esc(p.nombre) + ": precio final sobre precio de lista " + Math.round(frac * 100) + ' por ciento"><i></i></div>' +
      "</div>";
    }).join("");
  }

  /* listado con acción directa al carrito */
  function pintaLista() {
    var l = enOferta();
    var cont = F.$("#poLista");
    if (!l.length) { pintaBarras(); return; }
    cont.innerHTML = l.map(function (p) {
      return '<div class="ti-fila-prod" data-id="' + F.esc(p.id) + '">' +
        '<span class="ti-fila-media" style="--tinte:' + F.esc(p.tinte || "#c8f542") + '">' + F.cuboHtml(p.tinte) + "</span>" +
        '<span class="ti-fila-info">' +
          '<a class="ti-nombre" href="producto.html?id=' + F.esc(p.id) + '" style="color:inherit;text-decoration:none">' + F.esc(p.nombre) + "</a>" +
          '<span class="ti-precio"><s>' + F.fmtCLP(p.precio) + '</s><b class="en-oferta">' + F.fmtCLP(F.precioEfectivo(p)) +
          '</b><span class="ti-ahorra">−' + F.OFERTA.descuento + "%</span></span>" +
        "</span>" +
        '<span class="ti-fila-tools">' +
          '<button class="ds-btn ds-btn--sm" type="button" data-agrega="' + F.esc(p.id) + '">Agregar</button>' +
        "</span></div>";
    }).join("");

    cont.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-agrega]");
      if (!b) return;
      var p = F.prod(b.getAttribute("data-agrega"));
      if (!p) return;
      F.agregar(p.id, 1);
      F.$("#kpCarrito").textContent = F.contarItems();
      F.toast("Agregado: " + p.nombre);
    });
  }

  /* ── arranque ────────────────────────────────────────────────────────── */
  F.cargar().then(function () {
    pintaKpis();
    pintaBarras();
    pintaLista();

    F.$("#poTitulo").textContent = F.OFERTA.descuento + "% OFF en " + F.OFERTA.categoria;
    F.$("#poPct").textContent = F.OFERTA.descuento + "%";

    F.temporizador(
      { d: "#poD", h: "#poH", m: "#poM", s: "#poS" },
      {
        gauge: "#poGauge",
        colorGauge: "#FFB020",
        alTerminar: function () {
          F.$("#poSub").textContent = "La oferta terminó. Vuelve pronto por nuevas promociones.";
          F.$("#kpResto").textContent = "Terminó";
        }
      }
    );

    // KPI "Termina en": horas y minutos restantes, en vivo.
    function restoTxt() {
      var r = Math.max(0, F.finOferta() - Date.now());
      var h = Math.floor(r / 36e5);
      var m = Math.floor(r % 36e5 / 6e4);
      F.$("#kpResto").textContent = h + " h " + F.pad(m) + " min";
    }
    restoTxt();
    setInterval(restoTxt, 30000);

    F.titulo("Promociones");
  });
})();
