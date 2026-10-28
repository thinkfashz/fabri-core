/* ==========================================================================
   FABRI-CORE · Guía de InsForge dentro de la app
   --------------------------------------------------------------------------
   No configura la base por sí sola: eso vive en Vercel (fabri-api), porque la
   APK no debe llevar credenciales de Postgres. Aquí se explica el contrato,
   se copian los bloques y se prueba la nube ya configurada con una llamada
   real al endpoint `resumen`.
   ========================================================================== */

(function () {
  "use strict";

  function $(id) {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  function aviso(texto, tipo) {
    if (typeof window.toast === "function") window.toast(texto, tipo || "");
    else if (typeof window.invAviso === "function") window.invAviso(texto, tipo);
  }

  function estado(texto, error) {
    var caja = $("invGuiaEstado");
    if (!caja) return;
    caja.textContent = texto || "";
    caja.className = "inv-ayuda" + (error ? " inv-error" : "");
  }

  function leer(clave) {
    try { return localStorage.getItem(clave) || ""; } catch (e) { return ""; }
  }

  function pintarConfig() {
    var url = leer("fabrick.nube.url") || "https://fabri-api.vercel.app";
    var token = leer("fabrick.nube.token");
    estado("Nube configurada: " + url + (token ? " · token guardado" : " · falta el token")
      + ". Probá la conexión cuando quieras.");
  }

  /* ── copiar bloques ───────────────────────────────────────────────────── */

  function copiarTexto(texto) {
    if (typeof window.copiar === "function") {
      window.copiar(texto, "Copiado");
      return true;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto);
        aviso("Copiado");
        return true;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = texto;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      aviso("Copiado");
      return true;
    } catch (e2) {
      aviso("No se pudo copiar: seleccioná el texto a mano", "error");
      return false;
    }
  }

  function alCopiar(boton) {
    var id = boton.getAttribute("data-copiar");
    var bloque = id ? $(id) : null;
    if (!bloque) return;
    copiarTexto(bloque.textContent || "");
  }

  /* ── probar la nube ───────────────────────────────────────────────────── */

  function probar() {
    var url = leer("fabrick.nube.url");
    var token = leer("fabrick.nube.token");
    if (!url || !token) {
      estado("Falta configurar la nube: andá a Integración → Nube y guardá la URL y el token.", true);
      aviso("La nube no está configurada", "error");
      return Promise.resolve({ ok: false, error: "sin configurar" });
    }
    estado("Consultando " + url + "…");
    var boton = $("btnInvGuiaProbar");
    if (boton) boton.disabled = true;

    var llamada;
    if (typeof window.invNubeResumen === "function") {
      llamada = window.invNubeResumen();
    } else {
      llamada = Promise.resolve({ ok: false, error: "el módulo de inventario no está cargado" });
    }

    return llamada.then(function (r) {
      if (boton) boton.disabled = false;
      if (!r || !r.ok) {
        estado("No se pudo conectar: " + ((r && r.error) || "sin respuesta")
          + ". Revisá la URL, el token y el deploy de fabri-api.", true);
        aviso("Nube: " + ((r && r.error) || "sin respuesta"), "error");
        return r || { ok: false };
      }
      var d = r.resumen || {};
      estado("Conectada · " + (d.total || 0) + " producto(s) en InsForge · "
        + (d.stock_bajo || 0) + " con stock bajo.");
      aviso("Nube conectada");
      try {
        if (typeof window.revision === "function") {
          window.revision("inventario", "info", "prueba de InsForge correcta",
            (d.total || 0) + " productos · " + url);
        }
      } catch (e) {}
      return r;
    }).catch(function (e) {
      if (boton) boton.disabled = false;
      var msg = e && e.message ? e.message : String(e);
      estado("No se pudo conectar: " + msg, true);
      aviso("Nube: " + msg, "error");
      return { ok: false, error: msg };
    });
  }

  /* ── guía completa ────────────────────────────────────────────────────── */

  function alternarGuia() {
    var caja = $("invGuiaCompleta");
    var boton = $("btnInvGuiaCompleta");
    if (!caja) return;
    caja.hidden = !caja.hidden;
    if (boton) boton.textContent = caja.hidden ? "Ver guía completa" : "Ocultar guía completa";
    if (!caja.hidden && caja.scrollIntoView) {
      setTimeout(function () { caja.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 60);
    }
  }

  /* ── arranque ─────────────────────────────────────────────────────────── */

  function iniciarUi() {
    pintarConfig();
    document.querySelectorAll("[data-copiar]").forEach(function (b) {
      b.addEventListener("click", function () { alCopiar(b); });
    });
    if ($("btnInvGuiaProbar")) $("btnInvGuiaProbar").addEventListener("click", probar);
    if ($("btnInvGuiaCompleta")) $("btnInvGuiaCompleta").addEventListener("click", alternarGuia);

    var guia = $("invGuiaInsforge");
    if (guia) {
      guia.addEventListener("toggle", function () {
        if (guia.open) pintarConfig();
      });
    }
  }

  window.FabriInsforge = {
    probar: probar,
    copiar: copiarTexto,
    pintarConfig: pintarConfig,
    iniciarUi: iniciarUi
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", iniciarUi);
    } else {
      iniciarUi();
    }
  }
})();
