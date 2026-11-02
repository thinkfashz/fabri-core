/* ==========================================================================
   FORGE CORE STOCK · Módulo DTE (documentos tributarios electrónicos)
   --------------------------------------------------------------------------
   Certificado digital + CAF (folios) + emisión de boleta/factura.

   IMPORTANTE: un DTE sólo es válido ante el SII con (1) certificado digital
   del contribuyente, (2) CAF autorizado para ese tipo de documento y (3) el
   proceso de certificación del SII. Este módulo genera el XML y lo firma,
   guarda los folios y la traza; mientras no estén esos tres elementos, los
   documentos quedan como «borrador» y la app lo dice claramente.
   ========================================================================== */

const DTE = {
  activo: false,
  cert: null,
  cafs: [],
  docs: [],
  resumen: null,
  cargando: false
};

const DTE_TIPOS = {
  39: "Boleta electrónica",
  33: "Factura electrónica",
  41: "Boleta exenta",
  61: "Nota de crédito",
  56: "Nota de débito"
};

function dteClp(n) { return "$" + Math.round(Number(n || 0)).toLocaleString("es-CL"); }

function dteAviso(msg, tipo) {
  const el = document.getElementById("dteAviso");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "dte-aviso" + (tipo ? " " + tipo : "");
}

/* ── ciclo ─────────────────────────────────────────────────────────────── */
function dteIniciar() {
  DTE.activo = true;
  dtePintarFormulario();
  dteEstadoCertificado();
  dteCargar();
}

function dteSalir() { DTE.activo = false; }

function dteCargar() {
  if (DTE.cargando) return;
  DTE.cargando = true;
  Promise.all([
    apiTarde("dte", { accion: "listar", limite: 100 }, { maxMs: 15000 }),
    apiTarde("dte", { accion: "caf_listar" }, { maxMs: 15000 }),
    apiTarde("dte", { accion: "resumen" }, { maxMs: 15000 })
  ]).then(function (r) {
    DTE.cargando = false;
    if (r[0] && r[0].ok && r[0].data) DTE.docs = r[0].data.documentos || [];
    if (r[1] && r[1].ok && r[1].data) DTE.cafs = r[1].data.cafs || [];
    if (r[2] && r[2].ok && r[2].data) DTE.resumen = r[2].data;
    dtePintar();
  }).catch(function (e) {
    DTE.cargando = false;
    dteAviso("No pude leer los documentos: " + e.message, "error");
  });
}

/* ── certificado ───────────────────────────────────────────────────────── */
function dteEstadoCertificado() {
  const el = document.getElementById("dteCertEstado");
  if (!el) return;
  const c = DTE.cert;
  if (!c) {
    el.textContent = "Sin certificado cargado";
    el.className = "dte-chip";
    return;
  }
  el.textContent = "RUT " + (c.rut || "—") + " · vence " + (c.vence || "—");
  el.className = "dte-chip ok";
}

function dteImportarCertificado(archivo, clave) {
  const lector = new FileReader();
  lector.onload = function () {
    const base64 = String(lector.result || "").split(",")[1] || "";
    let r;
    try {
      r = JSON.parse(window.FabrickNative.dteCertificado(base64, clave));
    } catch (e) { r = { ok: false, error: String(e) }; }
    if (!r.ok) { dteAviso("Certificado: " + (r.error || "no se pudo leer"), "error"); return; }
    DTE.cert = r;
    DTE.p12 = base64;
    DTE.clave = clave;
    dteEstadoCertificado();
    dteAviso("Certificado cargado: " + (r.nombre || r.rut || ""), "ok");
  };
  lector.readAsDataURL(archivo);
}

/* ── CAF ───────────────────────────────────────────────────────────────── */
function dteImportarCaf(archivo) {
  const lector = new FileReader();
  lector.onload = function () {
    const xml = String(lector.result || "");
    let info;
    try { info = JSON.parse(window.FabrickNative.dteCaf(xml)); }
    catch (e) { info = { ok: false, error: String(e) }; }
    const c = (info && info.caf) || {};
    if (!info || !info.ok || !c.ok) {
      dteAviso("CAF: " + ((c && c.error) || (info && info.error) || "archivo inválido"), "error");
      return;
    }
    apiTarde("dte", {
      accion: "registrar_caf", tipo: c.tipo, desde: c.desde, hasta: c.hasta, xml: xml
    }, { maxMs: 12000 }).then(function (r) {
      if (!r.ok) { dteAviso("CAF: " + (r.error || "no se pudo guardar"), "error"); return; }
      dteAviso("CAF cargado · tipo " + c.tipo + " · folios " + c.desde + "–" + c.hasta, "ok");
      dteCargar();
    });
  };
  lector.readAsText(archivo);
}

/* ── emisión ───────────────────────────────────────────────────────────── */
function dtePintarFormulario() {
  const caja = document.getElementById("dteForm");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML =
    '<div class="dte-fila">' +
      '<div class="dte-campo"><span>Tipo</span>' +
        '<select id="dteTipo">' +
          Object.keys(DTE_TIPOS).map(function (k) {
            return '<option value="' + k + '">' + DTE_TIPOS[k] + "</option>";
          }).join("") +
        "</select></div>" +
      '<div class="dte-campo"><span>RUT receptor</span>' +
        '<input id="dteRutRec" placeholder="12.345.678-9" autocomplete="off" /></div>' +
    "</div>" +
    '<div class="dte-campo"><span>Razón social receptor</span>' +
      '<input id="dteRazonRec" placeholder="Consumidor final" autocomplete="off" /></div>' +
    '<div class="dte-campo"><span>Detalle (nombre, precio)</span>' +
      '<input id="dteItem" placeholder="Ej: Coca-Cola 1.5 L, 1990" autocomplete="off" /></div>' +
    '<p class="dte-nota">El total incluye IVA. Se calcula neto e IVA automáticamente.</p>';
}

function dteEmitir() {
  const tipo = Number((document.getElementById("dteTipo") || {}).value || 39);
  const rut = ((document.getElementById("dteRutRec") || {}).value || "").trim();
  const razon = ((document.getElementById("dteRazonRec") || {}).value || "").trim() || "Consumidor final";
  const item = ((document.getElementById("dteItem") || {}).value || "").trim();
  if (!item) { dteAviso("Escribe al menos un producto con su precio", "error"); return; }
  const partes = item.split(",");
  const nombre = (partes[0] || "").trim();
  const precio = Number(String(partes[1] || "").replace(/[^\d]/g, "")) || 0;
  if (!nombre || precio <= 0) { dteAviso("Usa el formato: nombre, precio", "error"); return; }
  if (!window.FabrickNative || typeof window.FabrickNative.dteEmitir !== "function") {
    dteAviso("Este build no trae el motor DTE", "error");
    return;
  }
  if (!DTE.p12) { dteAviso("Carga primero el certificado (.pfx)", "error"); return; }
  dteAviso("Reservando folio y firmando…");
  apiTarde("dte", { accion: "siguiente_folio", tipo: tipo }, { maxMs: 12000 })
    .then(function (r) {
      if (!r.ok) { dteAviso("Sin folios: " + (r.error || ""), "error"); return; }
      const folio = r.data.folio;
      DTE.pendiente = {
        tipo: tipo, folio: folio, rut_receptor: rut, razon_receptor: razon,
        nombre: nombre, precio: precio
      };
      const datos = {
        tipo: tipo, folio: folio, rut_receptor: rut, razon_receptor: razon,
        items: [{ nombre: nombre, cantidad: 1, precio: precio }]
      };
      let res;
      try {
        res = JSON.parse(window.FabrickNative.dteEmitir(
          JSON.stringify(datos), DTE.p12, DTE.clave));
      } catch (e) { res = { ok: false, error: String(e) }; }
      if (!res.ok) { dteAviso("Emisión: " + (res.error || "error"), "error"); return; }
      // El documento firmado llega por FabriDte.documento (hilo aparte).
    });
}

window.FabriDte = {
  documento: function (r) {
    const p = DTE.pendiente || {};
    if (!r || !r.ok) {
      dteAviso("No se pudo firmar: " + ((r && r.error) || "error"), "error");
      return;
    }
    apiTarde("dte", {
      accion: "guardar",
      documento: {
        folio: r.folio || p.folio, tipo: r.tipo || p.tipo,
        rut_emisor: DTE.cert ? (DTE.cert.rut || "") : "",
        rut_receptor: p.rut_receptor || "", razon_receptor: p.razon_receptor || "Consumidor final",
        neto: r.neto, iva: r.iva, total: r.total,
        xml: r.xml, ted: r.ted || "",
        estado: "firmado", glosa: "emitido desde la app"
      }
    }, { maxMs: 15000 }).then(function (g) {
      if (!g.ok) { dteAviso("Guardado: " + (g.error || "error"), "error"); return; }
      dteAviso("Documento " + (r.folio || p.folio) + " firmado · " + dteClp(r.total), "ok");
      DTE.pendiente = null;
      dteCargar();
    });
  },
  firma: function (r) {
    dteAviso(r && r.ok ? "Firma generada" : ("Firma: " + ((r && r.error) || "error")),
      r && r.ok ? "ok" : "error");
  }
};

/* ── pintado ───────────────────────────────────────────────────────────── */
function dtePintar() {
  const caf = document.getElementById("dteCafs");
  if (caf) {
    caf.innerHTML = DTE.cafs.length
      ? DTE.cafs.map(function (c) {
          const rest = Math.max(0, Number(c.hasta) - Number(c.siguiente) + 1);
          return '<div class="dte-caf">' +
            '<b>' + (DTE_TIPOS[c.tipo] || ("Tipo " + c.tipo)) + "</b>" +
            '<span>' + c.desde + "–" + c.hasta + " · quedan " + rest + "</span></div>";
        }).join("")
      : '<div class="dte-vacio">Sin CAF cargado. Pide los folios en el SII.</div>';
  }
  const caja = document.getElementById("dteDocs");
  if (caja) {
    caja.innerHTML = DTE.docs.length
      ? DTE.docs.map(function (d) {
          return '<div class="dte-doc">' +
            '<div class="dte-doc-id"><b>' + (DTE_TIPOS[d.tipo] || d.tipo) + " · " + d.folio + "</b>" +
              '<span>' + (d.razon_receptor || "—") + "</span></div>" +
            '<div class="dte-doc-datos"><b>' + dteClp(d.total) + "</b>" +
              '<span class="dte-chip ' + (d.estado === "aceptado" ? "ok" : (d.estado === "error" ? "err" : "")) + '">' +
              esc(d.estado) + "</span></div>" +
          "</div>";
        }).join("")
      : '<div class="dte-vacio">Todavía no hay documentos.</div>';
  }
  const cont = document.getElementById("dteResumen");
  if (cont && DTE.resumen) {
    const r = DTE.resumen;
    cont.innerHTML =
      '<span><b>' + (r.total || 0) + "</b> documentos</span>" +
      '<span><b>' + (r.aceptados || 0) + "</b> aceptados</span>" +
      '<span><b>' + (r.pendientes || 0) + "</b> pendientes</span>";
  }
}

/* ── eventos ──────────────────────────────────────────────────────────── */
(function dteMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnDteEmitir")) { dteEmitir(); return; }
    if (t.closest("#btnDteCert")) {
      const i = document.getElementById("dteCertArchivo");
      if (i) i.click();
      return;
    }
    if (t.closest("#btnDteCaf")) {
      const i = document.getElementById("dteCafArchivo");
      if (i) i.click();
      return;
    }
    if (t.closest("#btnDteRefrescar")) { dteCargar(); return; }
  });
  document.addEventListener("change", function (ev) {
    const id = ev.target && ev.target.id;
    if (id === "dteCertArchivo" && ev.target.files && ev.target.files[0]) {
      const clase = (document.getElementById("dteCertClave") || {}).value || "";
      if (!clase) { dteAviso("Escribe la clave del certificado antes de elegir el archivo", "error"); return; }
      dteImportarCertificado(ev.target.files[0], clase);
      ev.target.value = "";
    }
    if (id === "dteCafArchivo" && ev.target.files && ev.target.files[0]) {
      dteImportarCaf(ev.target.files[0]);
      ev.target.value = "";
    }
  });
})();
