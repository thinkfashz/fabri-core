/* ==========================================================================
   PÁGINA: Catálogo (tienda.html)
   Hero + KPIs + promoción d3 + filtros + grilla. Todo sobre FCS (núcleo).
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  var filtro = { q: "", categoria: "", clasificacion: "", max: -1 };
  var grid = F.$("#tiGrid");

  /* ── KPIs (sección 2 del orden Fabrick) ──────────────────────────────── */
  function pintaKpis() {
    F.$("#kpProd").textContent = F.lista().length;
    F.$("#kpCats").textContent = F.categorias().length;
    F.$("#kpOferta").textContent = "−" + F.OFERTA.descuento + "%";
    F.$("#kpOfertaMeta").textContent = F.OFERTA.categoria + " · hasta las 23:59";
    F.$("#kpCarrito").textContent = F.contarItems();
  }

  /* ── chips de filtro ─────────────────────────────────────────────────── */
  function chip(grupo, valor, actual, alPulsar) {
    var on = actual === valor;
    return '<button class="ds-chip' + (on ? " ds-chip--accent" : "") + '" type="button" aria-pressed="' + on + '" data-v="' + F.esc(valor) + '">' + F.esc(valor) + "</button>";
  }
  function pintaChips() {
    F.$("#fiCats").innerHTML = F.categorias().map(function (c) { return chip("cats", c, filtro.categoria); }).join("");
    F.$("#fiClas").innerHTML = F.clasificaciones().map(function (c) { return chip("clas", c, filtro.clasificacion); }).join("");

    F.$$("#fiCats .ds-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        filtro.categoria = filtro.categoria === v ? "" : v;
        pintaChips(); render();
      });
    });
    F.$$("#fiClas .ds-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-v");
        filtro.clasificacion = filtro.clasificacion === v ? "" : v;
        pintaChips(); render();
      });
    });
  }

  /* ── grilla ──────────────────────────────────────────────────────────── */
  function render() {
    var l = F.filtrados(filtro);
    F.montaTarjetas(grid, l);
    var cuenta = F.$("#fiCuenta");
    cuenta.textContent = l.length + (l.length === 1 ? " producto" : " productos");
    F.$("#kpProd").textContent = l.length;
    F.$("#kpCarrito").textContent = F.contarItems();
  }

  /* ── eventos de filtro ───────────────────────────────────────────────── */
  function bindea() {
    var q = F.$("#fiQ");
    var t = null;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { filtro.q = q.value; render(); }, 140);
    });

    var rango = F.$("#fiMax"), salida = F.$("#fiMaxVal");
    rango.addEventListener("input", function () {
      var tope = Number(rango.max) || 500000;
      var v = Number(rango.value);
      filtro.max = v >= tope ? -1 : v;
      salida.textContent = F.fmtCLP(v);
      render();
    });
  }

  /* ── arranque ────────────────────────────────────────────────────────── */
  F.cargar().then(function () {
    pintaKpis();
    pintaChips();
    bindea();
    render();

    F.reloj("#tiReloj", "#tiFecha");

    F.$("#tiPromoTitulo").textContent = F.OFERTA.descuento + "% OFF en " + F.OFERTA.categoria;
    F.$("#tiPromoPct").textContent = F.OFERTA.descuento + "%";
    F.$("#tiPromoSub").innerHTML = "Se aplica automáticamente en el carrito a los productos de la categoría <b>" +
      F.esc(F.OFERTA.categoria) + "</b>.";

    F.temporizador(
      { d: "#cdD", h: "#cdH", m: "#cdM", s: "#cdS" },
      {
        gauge: "#promoGauge",
        colorGauge: "#FFB020",
        alTerminar: function () {
          F.$("#tiPromoSub").textContent = "La oferta terminó. Vuelve pronto por nuevas promociones.";
        }
      }
    );

    F.titulo("Catálogo");
  });
})();
