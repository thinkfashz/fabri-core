/* ==========================================================================
   PÁGINA: Checkout (checkout.html)
   Datos de contacto + método de pago + pasarela simulada (Luhn).
   El resultado (aprobado / rechazado) se guarda y lo lee pago.html.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  var metodo = "tarjeta";
  var pagando = false;

  /* ── resumen ─────────────────────────────────────────────────────────── */
  function pintaResumen() {
    var carrito = F.carrito();
    var cont = F.$("#coResumen");
    if (!carrito.length) {
      cont.innerHTML = '<div class="ds-empty"><span class="ds-empty__title">No hay productos</span>' +
        '<span class="ds-empty__text">Agrega algo al catálogo antes de pagar.</span>' +
        '<a class="ds-btn ds-btn--sm" href="tienda.html" style="margin-top:10px">Ver catálogo</a></div>';
      F.$("#coTotal").textContent = F.fmtCLP(0);
      F.$("#coPagar").disabled = true;
      return;
    }
    cont.innerHTML = carrito.map(function (item) {
      var p = F.prod(item.id);
      if (!p) return "";
      return '<div class="ds-row ds-row--flush"><span class="ds-row__key ds-truncate">' + item.cantidad + "× " + F.esc(p.nombre) + "</span>" +
        '<span class="ds-row__value ds-tabular">' + F.fmtCLP(F.precioEfectivo(p) * item.cantidad) + "</span></div>";
    }).join("") +
      '<div class="ds-row ds-row--flush"><span class="ds-row__key">Descuento de oferta</span>' +
      '<span class="ds-row__value ds-row__value--ok ds-tabular">' + (F.carrito().some(function (i) { var p = F.prod(i.id); return p && F.enOferta(p); })
        ? "aplicado" : "sin oferta") + "</span></div>";
    F.$("#coTotal").textContent = F.fmtCLP(F.totalCarrito());
    F.$("#coPagar").disabled = false;
    F.$("#coPagar").textContent = "Pagar " + F.fmtCLP(F.totalCarrito());
  }

  /* ── pasarela simulada ───────────────────────────────────────────────── */
  function luhn(digitos) {
    var suma = 0, doble = false;
    for (var i = digitos.length - 1; i >= 0; i--) {
      var d = Number(digitos[i]);
      if (doble) { d *= 2; if (d > 9) d -= 9; }
      suma += d;
      doble = !doble;
    }
    return suma % 10 === 0;
  }
  function validarTarjeta() {
    var num = (F.$("#coCardNum").value || "").replace(/\s+/g, "");
    var exp = (F.$("#coCardExp").value || "").trim();
    var cvv = (F.$("#coCardCvv").value || "").trim();
    if (!/^\d{13,19}$/.test(num)) return "Número de tarjeta inválido";
    if (!luhn(num)) return "Tarjeta rechazada: el número no pasa la validación de Luhn";
    var m = exp.match(/^(\d{2})\/(\d{2})$/);
    if (!m) return "Fecha de expiración inválida (usa MM/AA)";
    var mes = Number(m[1]), anio = 2000 + Number(m[2]);
    if (mes < 1 || mes > 12) return "Mes de expiración inválido";
    if (new Date(anio, mes, 1) <= new Date()) return "La tarjeta está vencida";
    if (!/^\d{3,4}$/.test(cvv)) return "CVV inválido";
    return null;
  }

  function armaPedido(ref) {
    var lineas = F.carrito().map(function (item) {
      var p = F.prod(item.id);
      return { id: item.id, nombre: p ? p.nombre : item.id, cantidad: item.cantidad, subtotal: p ? F.precioEfectivo(p) * item.cantidad : 0 };
    });
    var ahorro = 0;
    F.carrito().forEach(function (item) {
      var p = F.prod(item.id);
      if (p && F.enOferta(p)) ahorro += (p.precio - F.precioEfectivo(p)) * item.cantidad;
    });
    return {
      ref: ref,
      metodo: metodo,
      total: F.totalCarrito(),
      ahorro: ahorro,
      lineas: lineas,
      nombre: F.$("#coNombre").value.trim(),
      email: F.$("#coEmail").value.trim(),
      tel: F.$("#coTel").value.trim(),
      dir: F.$("#coDir").value.trim(),
      ts: Date.now()
    };
  }

  function terminar(estado, motivo) {
    var ref = "FCS-" + Date.now().toString(36).toUpperCase().slice(-6);
    F.guardaResultado({ estado: estado, motivo: motivo || "", pedido: armaPedido(ref) });
    if (estado === "aprobado") F.vaciar();   // el rechazo conserva el carrito
    location.href = "pago.html";
  }

  function pagar() {
    if (pagando) return;
    if (!F.carrito().length) { location.href = "carrito.html"; return; }

    var nombre = F.$("#coNombre").value.trim();
    var tel = F.$("#coTel").value.trim();
    if (!nombre) { F.toast("Escribe tu nombre"); F.$("#coNombre").focus(); return; }
    if (!tel) { F.toast("Escribe tu teléfono"); F.$("#coTel").focus(); return; }

    if (metodo === "tarjeta") {
      var error = validarTarjeta();
      if (error) { terminar("rechazado", error); return; }
    }

    pagando = true;
    var btn = F.$("#coPagar");
    btn.disabled = true;
    var estado = F.$("#coEstado");
    estado.textContent = "Procesando pago…";
    estado.className = "ti-pasarela";

    setTimeout(function () {
      pagando = false;
      var aprobado = metodo === "efectivo" ? true : luhn((F.$("#coCardNum").value || "").replace(/\s+/g, ""));
      if (aprobado) terminar("aprobado", "");
      else terminar("rechazado", "La entidad emisora rechazó la tarjeta. Revisa el número o usa otra.");
    }, 1300);
  }

  /* ── eventos ─────────────────────────────────────────────────────────── */
  function bindea() {
    F.$("#coMetodo").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-m]");
      if (!b) return;
      metodo = b.getAttribute("data-m");
      F.$$("#coMetodo .ds-chip").forEach(function (x) {
        var on = x === b;
        x.classList.toggle("ds-chip--accent", on);
        x.setAttribute("aria-pressed", String(on));
      });
      F.$("#coTarjeta").hidden = metodo !== "tarjeta";
      F.$("#coEfectivo").hidden = metodo !== "efectivo";
      F.$("#coEstado").textContent = "";
    });

    F.$("#coCardNum").addEventListener("input", function () {
      var dig = (F.$("#coCardNum").value || "").replace(/\D/g, "").slice(0, 16);
      F.$("#coCardNum").value = dig.replace(/(.{4})/g, "$1 ").trim();
    });
    F.$("#coCardExp").addEventListener("input", function () {
      var v = (F.$("#coCardExp").value || "").replace(/\D/g, "").slice(0, 4);
      F.$("#coCardExp").value = v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v;
    });
    F.$("#coCardCvv").addEventListener("input", function () {
      F.$("#coCardCvv").value = (F.$("#coCardCvv").value || "").replace(/\D/g, "").slice(0, 4);
    });

    F.$("#coPagar").addEventListener("click", pagar);
  }

  /* ── arranque ────────────────────────────────────────────────────────── */
  F.cargar().then(function () {
    if (!F.carrito().length) { location.href = "carrito.html"; return; }
    pintaResumen();
    bindea();
    F.titulo("Pago");
  });
})();
