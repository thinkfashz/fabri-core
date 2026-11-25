/* FORGE CORE STOCK · panel «Sin conexión» (mapa y visor)
   --------------------------------------------------------------------------
   Pide precachear el mapa (teselas de un rectángulo) y el visor (texturas y
   recursos por producto). No descarga nada por su cuenta: sólo cuando el
   usuario pulsa. Muestra el estado real de la caché (teselas, bytes, recursos
   y fallos) y permite limpiarla.

   Se monta donde exista `#oflPanel`; si no existe, no hace nada. */

(function () {
  "use strict";

  var PANEL = null;
  var OCUPADO = false;

  function $(s) { return document.querySelector(s); }
  function el(id) { return document.getElementById(id); }

  function bytes(n) {
    var v = Number(n) || 0;
    if (v <= 0) return "0 B";
    var u = ["B", "KB", "MB", "GB"];
    var i = 0, x = v;
    while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
    return (i === 0 ? x : x.toFixed(1)) + " " + u[i];
  }

  function msg(texto, tipo) {
    var m = el("oflMsg");
    if (!m) return;
    m.textContent = texto || "";
    m.hidden = !texto;
    if (tipo) m.setAttribute("data-tipo", tipo); else m.removeAttribute("data-tipo");
  }

  function progreso(p) {
    var b = el("oflBarra");
    if (b) b.style.width = Math.max(0, Math.min(100, Number(p && p.pct) || 0)) + "%";
  }

  function pill(id, ok, texto) {
    var e = el(id);
    if (!e) return;
    e.textContent = texto;
    e.setAttribute("data-ok", ok === true ? "si" : (ok === false ? "no" : "aviso"));
  }

  async function pintarEstado() {
    if (!window.OfflineMapa || !window.OfflineMapa.estado) return;
    try {
      const m = await window.OfflineMapa.estado();
      pill("oflMapa", (Number(m.teselas) || 0) > 0,
        (Number(m.teselas) || 0) + " teselas · " + bytes(m.bytes));
    } catch (e) { pill("oflMapa", false, "sin datos"); }
    if (window.OfflineVisor && window.OfflineVisor.estado) {
      try {
        const v = await window.OfflineVisor.estado();
        const fallos = Number(v.fallos) || 0;
        pill("oflVisor", (Number(v.recursos) || 0) > 0 && fallos === 0,
          (Number(v.recursos) || 0) + " recursos · " + bytes(v.bytes) +
          (fallos ? " · " + fallos + " fallo(s)" : ""));
      } catch (e) { pill("oflVisor", false, "sin datos"); }
    }
    const total = (Number((window.__oflUltimo || {}).mapa) || 0);
    var e = el("oflUltima");
    if (e) e.textContent = total ? "Último precacheo: " + total : "";
  }

  async function cachearMapa() {
    if (OCUPADO || !window.OfflineMapa) return;
    OCUPADO = true;
    msg("Descargando teselas del mapa…", "");
    progreso(0);
    try {
      const r = await window.OfflineMapa.cachear(
        { south: -33.46, west: -70.67, north: -33.44, east: -70.64 },
        14, 16,
        function (p) {
          progreso(p);
          msg("Mapa " + (p.pct || 0) + "% · " + (p.hechos || 0) + "/" + (p.total || 0) + " teselas", "");
        }
      );
      const aviso = r && r.cortado ? " (cortado: " + r.cortado + ")" : "";
      msg("Mapa guardado: " + (r.hechos || 0) + " teselas · " + bytes(r.bytes) + aviso,
        r && r.cortado ? "mal" : "ok");
      window.__oflUltimo = window.__oflUltimo || {};
      window.__oflUltimo.mapa = Date.now();
    } catch (e) {
      msg("No se pudo cachear el mapa: " + (e && e.message ? e.message : "error"), "mal");
    } finally {
      OCUPADO = false;
      await pintarEstado();
    }
  }

  async function cachearVisor() {
    if (OCUPADO || !window.OfflineVisor) return;
    OCUPADO = true;
    msg("Guardando texturas y recursos del visor…", "");
    progreso(0);
    try {
      const productos = (window.INV && Array.isArray(INV.productos) ? INV.productos : [])
        .slice(0, 50)
        .map(function (p) { return { codigo: p.codigo || p.sku || "" }; })
        .filter(function (p) { return p.codigo; });
      const r = await window.OfflineVisor.cachear(productos, function (p) {
        progreso(p);
        msg("Visor " + (p.pct || 0) + "% · " + (p.hechos || 0) + "/" + (p.total || 0) + " recursos", "");
      });
      const fallos = Number(r.fallos) || 0;
      msg("Visor listo: " + (r.recursos || 0) + " recursos · " + bytes(r.bytes) +
        (fallos ? " · " + fallos + " fallo(s)" : "") + (r.aviso ? " · " + r.aviso : ""),
        fallos ? "mal" : "ok");
    } catch (e) {
      msg("No se pudo cachear el visor: " + (e && e.message ? e.message : "error"), "mal");
    } finally {
      OCUPADO = false;
      await pintarEstado();
    }
  }

  async function limpiarTodo() {
    if (OCUPADO) return;
    if (!window.confirm("¿Borrar la caché del mapa y del visor de este teléfono?")) return;
    OCUPADO = true;
    try {
      if (window.OfflineMapa && window.OfflineMapa.limpiar) await window.OfflineMapa.limpiar();
      if (window.OfflineVisor && window.OfflineVisor.limpiar) await window.OfflineVisor.limpiar();
      msg("Caché borrada.", "ok");
    } catch (e) {
      msg("No se pudo borrar: " + (e && e.message ? e.message : "error"), "mal");
    } finally {
      OCUPADO = false;
      progreso(0);
      await pintarEstado();
    }
  }

  function montar() {
    PANEL = el("oflPanel");
    if (!PANEL || PANEL.dataset.listo === "1") return;
    PANEL.dataset.listo = "1";
    PANEL.innerHTML =
      '<div class="ofl-barra">' +
        '<span class="ofl-pill" id="oflMapa" data-ok="no">mapa: —</span>' +
        '<span class="ofl-pill" id="oflVisor" data-ok="no">visor: —</span>' +
        '<span class="ofl-pill" id="oflUltima" data-ok="aviso"></span>' +
      "</div>" +
      '<div class="ofl-fila">' +
        '<button class="ofl-btn ofl-btn--pri" type="button" data-ofl="mapa">Guardar mapa</button>' +
        '<button class="ofl-btn" type="button" data-ofl="visor">Guardar visor</button>' +
        '<button class="ofl-btn" type="button" data-ofl="limpiar">Borrar caché</button>' +
      "</div>" +
      '<div class="ofl-progreso"><i id="oflBarra"></i></div>' +
      '<p class="ofl-msg" id="oflMsg" hidden></p>' +
      '<p class="ofl-msg">El mapa guarda las teselas de Santiago centro (zooms 14–16) y el visor sus ' +
        "texturas. Nada se descarga solo: tú decides cuándo. Sirven sin internet.</p>";
    PANEL.addEventListener("click", function (e) {
      const b = e.target.closest ? e.target.closest("[data-ofl]") : null;
      if (!b) return;
      if (b.dataset.ofl === "mapa") cachearMapa();
      else if (b.dataset.ofl === "visor") cachearVisor();
      else if (b.dataset.ofl === "limpiar") limpiarTodo();
    });
    pintarEstado();
  }

  window.OfflinePanel = { montar: montar, cachearMapa: cachearMapa, cachearVisor: cachearVisor, estado: pintarEstado };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montar);
  else montar();
})();