/* FORGE CORE STOCK · rastreador de visitas del visor 3D
   ---------------------------------------------------------------------------
   Manda UNA visita por sesión a /api/visitas (fabri-api) y deja que el
   servidor decida el canal: Instagram, Facebook, WhatsApp, Google, etc.
   El servidor deduce el canal por utm_source, por el navegador interno de la
   app (Instagram/Facebook/WhatsApp no mandan referrer) y por el referrer.

   Privacidad: no usa cookies de terceros ni identificadores personales; el
   servidor sólo guarda un hash para contar visitantes únicos. Se respeta
   Do Not Track y `?noTrack=1`, y en localhost no se envía nada. */
(function () {
  "use strict";

  var API = "https://fabri-api.vercel.app/api/visitas";
  var CLAVE = "fcore.visita.enviada";

  try {
    // respeto por el usuario y por el entorno de desarrollo
    var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
    if (dnt === "1" || dnt === "yes") return;
    if (/(^\?|&)noTrack=1(&|$)/.test(location.search)) return;
    if (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|::1)/i.test(location.hostname || "")) return;
    if (sessionStorage.getItem(CLAVE)) return;      // ya contada en esta pestaña

    var q = new URLSearchParams(location.search || "");
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { ref = ""; }

    var datos = {
      // el servidor vuelve a clasificar; esto es sólo la pista del enlace
      canal: (q.get("utm_source") || q.get("utm_medium") || "").toLowerCase().slice(0, 40),
      utm_source: q.get("utm_source") || "",
      utm_medium: q.get("utm_medium") || "",
      utm_campaign: q.get("utm_campaign") || "",
      ref: ref,
      ruta: location.pathname + (location.hash || "")
    };

    sessionStorage.setItem(CLAVE, "1");

    var cuerpo = JSON.stringify(datos);
    /* text/plain es un tipo seguro para CORS: no dispara preflight. Con
       application/json el navegador manda OPTIONS y el envío falla (probado
       en producción: net::ERR_FAILED). El servidor parsea el cuerpo igual. */
    if (navigator.sendBeacon) {
      var blob = new Blob([cuerpo], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(API, blob)) return;
    }
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: cuerpo,
      keepalive: true,
      mode: "cors",
      credentials: "omit"
    }).catch(function () { /* sin red: la visita no se cuenta y ya */ });
  } catch (e) {
    /* modo privado o almacenamiento lleno: no se rompe nada */
  }
})();
