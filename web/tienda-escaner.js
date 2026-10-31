/* ==========================================================================
   PÁGINA: Escáner (escaner.html)
   Lector QR / código de barras con la cámara (ZXing), por código manual o
   desde una imagen. Lo leído se busca en el catálogo (local y API) y el
   producto se agrega al carrito al instante.
   ========================================================================== */

(function () {
  "use strict";
  var F = window.FCS;
  F.montaNav();

  var reader = null;
  var ultimo = { txt: "", ts: 0 };   // evita repetir el mismo código en bucle
  var LS_HIST = "fcs_escaneos";

  /* ── historial ───────────────────────────────────────────────────────── */
  function leeHistorial() {
    try { var v = JSON.parse(localStorage.getItem(LS_HIST)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function guardaHistorial(txt) {
    var h = leeHistorial().filter(function (x) { return x.t !== txt; });
    h.unshift({ t: txt, ts: Date.now() });
    h = h.slice(0, 8);
    try { localStorage.setItem(LS_HIST, JSON.stringify(h)); } catch (e) { /* modo privado */ }
    pintaHistorial();
  }
  function pintaHistorial() {
    var h = leeHistorial();
    var cont = F.$("#scHist");
    F.$("#kpScan").textContent = h.length;
    if (!h.length) {
      cont.innerHTML = '<span class="ds-muted" style="font-size:var(--ds-text-sm)">Sin escaneos todavía.</span>';
      return;
    }
    cont.innerHTML = h.map(function (x) {
      return '<button class="ds-chip ds-mono" type="button" data-cod="' + F.esc(x.t) + '">' + F.esc(x.t) + "</button>";
    }).join("");
    cont.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-cod]");
      if (b) maneja(b.getAttribute("data-cod"), true);
    });
  }

  /* ── búsqueda del código en la base de datos ─────────────────────────── */
  function normaliza(txt) {
    txt = String(txt || "").trim();
    if (!txt) return "";
    var m = txt.match(/producto\.html\?id=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (/^forge:/i.test(txt)) return txt.replace(/^forge:/i, "").trim();
    return txt;
  }
  function buscarLocal(cod) {
    var bajo = cod.toLowerCase();
    var l = F.lista();
    for (var i = 0; i < l.length; i++) if (String(l[i].id).toLowerCase() === bajo) return l[i];
    for (var j = 0; j < l.length; j++) if (String(l[j].id).toLowerCase().indexOf(bajo) !== -1) return l[j];
    for (var k = 0; k < l.length; k++) if (String(l[k].nombre).toLowerCase().indexOf(bajo) !== -1) return l[k];
    return null;
  }

  function pintaEncontrado(p, codigo) {
    F.$("#scResultado").innerHTML =
      '<p class="ti-eyebrow">Encontrado en la base de datos</p>' +
      '<div class="ti-fila-prod">' +
        '<span class="ti-fila-media" style="--tinte:' + F.esc(p.tinte || "#c8f542") + '">' + F.cuboHtml(p.tinte) + "</span>" +
        '<span class="ti-fila-info">' +
          '<a class="ti-nombre" href="producto.html?id=' + F.esc(p.id) + '" style="color:inherit;text-decoration:none">' + F.esc(p.nombre) + "</a>" +
          '<span class="ti-precio">' + (F.enOferta(p)
            ? '<s>' + F.fmtCLP(p.precio) + '</s><b class="en-oferta">' + F.fmtCLP(F.precioEfectivo(p)) + '</b><span class="ti-ahorra">−' + F.OFERTA.descuento + "%</span>"
            : '<b>' + F.fmtCLP(p.precio) + "</b>") + "</span>" +
        "</span>" +
        '<span class="ti-fila-tools"><span class="ds-mono ds-muted" style="font-size:11px">' + F.esc(p.id) + "</span></span>" +
      "</div>" +
      '<div class="ds-cluster" style="margin-top:12px">' +
        '<button class="ds-btn" type="button" id="scAgregar">Agregar al carrito</button>' +
        '<a class="ds-btn ds-btn--secondary" href="producto.html?id=' + F.esc(p.id) + '">Ver ficha</a>' +
      "</div>" +
      '<p class="ti-nota" style="margin-top:10px">Código leído: <b class="ds-mono">' + F.esc(codigo) + "</b></p>";

    F.$("#scAgregar").addEventListener("click", function () {
      F.agregar(p.id, 1);
      F.$("#kpCarrito").textContent = F.contarItems();
      F.toast("Agregado al carrito: " + p.nombre);
      F.$("#scAgregar").textContent = "Agregado";
      setTimeout(function () { var b = F.$("#scAgregar"); if (b) b.textContent = "Agregar otra unidad"; }, 900);
    });
    F.$("#kpCarrito").textContent = F.contarItems();
  }

  function pintaError(codigo, motivo) {
    F.$("#scResultado").innerHTML =
      '<div class="ds-error">' +
        '<span class="ds-error__title" style="color:var(--ds-err)">Producto no encontrado</span>' +
        '<span class="ds-error__text">' + F.esc(motivo || "Ese código no corresponde a ningún artículo del catálogo actual.") + "</span>" +
        '<span class="ds-cluster ds-error__action" style="margin-top:10px">' +
          '<a class="ds-btn ds-btn--sm" href="tienda.html?q=' + encodeURIComponent(codigo) + '">Buscar en el catálogo</a>' +
          '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="tienda.html">Ver todo</a>' +
        "</span>" +
        '<span class="ds-error__text ds-mono" style="margin-top:8px">Código leído: ' + F.esc(codigo) + "</span>" +
      "</div>";
  }

  // Flujo completo: local → API → error.
  function maneja(txt, repetir) {
    var ahora = Date.now();
    if (!repetir && txt === ultimo.txt && ahora - ultimo.ts < 3000) return;   // misma lectura
    ultimo = { txt: txt, ts: ahora };

    var cod = normaliza(txt);
    if (!cod) return;
    guardaHistorial(txt);
    F.$("#scVacio").hidden = true;

    var p = buscarLocal(cod);
    if (p) { pintaEncontrado(p, cod); return; }

    F.$("#scResultado").innerHTML = '<p class="ti-eyebrow">Buscando…</p><div class="ds-skeleton ds-skeleton--line"></div>';
    fetch(F.API + "?q=" + encodeURIComponent(cod), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.productos && d.productos.length) pintaEncontrado(d.productos[0], cod);
        else pintaError(cod, "No hay coincidencias en el catálogo de la nube para ese código.");
      })
      .catch(function () { pintaError(cod, "Sin conexión y el código no existe en el catálogo local de respaldo."); });
  }

  /* ── cámara ──────────────────────────────────────────────────────────── */
  function activaCamara() {
    if (!window.ZXing || !ZXing.BrowserMultiFormatReader) {
      F.$("#scCamNota").textContent = "El lector de códigos no se pudo cargar en este navegador.";
      return;
    }
    try { if (reader) reader.reset(); } catch (e) { /* nada */ }
    reader = new ZXing.BrowserMultiFormatReader();
    var video = F.$("#scVideo");
    F.$("#scVacio").hidden = true;
    F.$("#scCam").hidden = true;
    F.$("#scStop").hidden = false;

    var promesa = reader.decodeFromVideoDevice(undefined, video, function (resultado) {
      if (resultado && resultado.getText) maneja(resultado.getText());
    });
    if (promesa && promesa.catch) {
      promesa.catch(function (err) {
        var nombre = err && err.name ? err.name : "";
        var msg = nombre === "NotAllowedError"
          ? "Permiso de cámara denegado: actívalo en el navegador para escanear."
          : nombre === "NotFoundError"
            ? "No se encontró ninguna cámara conectada."
            : "No se pudo abrir la cámara: usa el código manual o sube una foto.";
        F.$("#scCamNota").textContent = msg;
        F.$("#scCam").hidden = false;
        F.$("#scStop").hidden = true;
        F.$("#scVacio").hidden = false;
        F.toast("Cámara no disponible");
      });
    }
    F.$("#scCamNota").textContent = "Escaneando… alinea el código dentro del marco.";
  }

  function detieneCamara() {
    try { if (reader) reader.reset(); } catch (e) { /* nada */ }
    F.$("#scCam").hidden = false;
    F.$("#scStop").hidden = true;
    F.$("#scCamNota").textContent = "Formatos admitidos: QR, EAN-13, Code128 y el resto que reconozca tu dispositivo.";
  }

  /* ── eventos ─────────────────────────────────────────────────────────── */
  function bindea() {
    F.$("#scCam").addEventListener("click", activaCamara);
    F.$("#scStop").addEventListener("click", detieneCamara);

    var campo = F.$("#scTexto");
    function porTexto() {
      var v = campo.value.trim();
      if (!v) { F.toast("Escribe un código"); campo.focus(); return; }
      maneja(v, true);
    }
    F.$("#scBuscar").addEventListener("click", porTexto);
    campo.addEventListener("keydown", function (ev) { if (ev.key === "Enter") porTexto(); });

    F.$("#scArchivo").addEventListener("change", function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var nombre = F.$("#scArchivoNombre");
      if (nombre) nombre.textContent = f.name;
      if (!window.ZXing) { F.toast("Lector no disponible"); return; }
      F.$("#scResultado").innerHTML = '<p class="ti-eyebrow">Leyendo imagen…</p><div class="ds-skeleton ds-skeleton--line"></div>';
      try { if (reader) reader.reset(); } catch (e) { /* nada */ }
      reader = reader || new ZXing.BrowserMultiFormatReader();
      reader.decodeFromFile(f)
        .then(function (r) { if (r && r.getText) maneja(r.getText(), true); })
        .catch(function () { pintaError(f.name, "No se pudo leer ningún código dentro de esa imagen."); });
    });
  }

  /* ── arranque ────────────────────────────────────────────────────────── */
  F.cargar().then(function () {
    F.$("#kpCarrito").textContent = F.contarItems();
    pintaHistorial();
    bindea();
    F.titulo("Escáner");
    // Llegando con ?q= (desde "buscar en el catálogo") se busca de una vez.
    var q = F.param("q");
    if (q) maneja(q, true);
  });
})();
