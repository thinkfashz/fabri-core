/* Acceso al panel del dueño dentro de la app (`/app/#negocio`).
   --------------------------------------------------------------------------
   La app la usa cualquiera: un comprador entra al mapa, al carrito y a su
   cuenta. El panel del NEGOCIO no es parte de esa experiencia, así que:
     · el botón «Negocio» nace oculto y sólo aparece si la cuenta administra
       al menos una tienda (o tiene rol admin);
     · sin sesión, el hash `#negocio` se corrige a `#panel` antes de que la
       app lo pinte, para no mostrar una sección de administración a quien
       llegó por un enlace viejo;
     · si la nube no responde, el botón queda oculto (mejor oculto que
       mostrar administración a quien no corresponde);
     · al cerrar sesión se vuelve a comprobar: el botón desaparece.

   No guarda nada: pregunta a `local_mio` con la sesión de este navegador y
   reacciona al evento `fcore:sesion`. El panel web del negocio sigue en
   `/panel/negocio/` y es la vía principal. */

(function () {
  "use strict";

  var API = "https://fabri-api.vercel.app/api/mercado";
  var DISP = "fcore.dispositivo";
  var CLAVE = "fcore.nube";
  var EVENTO = "fcore:sesion";
  var ESTADO = "desconocido"; // 'si' | 'no' | 'sin-sesion'

  function boton() {
    return document.querySelector('[data-go="negocio"]');
  }

  function sesion() {
    try {
      var d = JSON.parse(localStorage.getItem(CLAVE) || "null");
      if (!d || !d.token) return null;
      return d;
    } catch (e) { return null; }
  }

  function dispositivo() {
    try {
      var v = localStorage.getItem(DISP);
      return v && /^[A-Za-z0-9_-]{16,64}$/.test(v) ? v : "navegador";
    } catch (e) { return "navegador"; }
  }

  /* Oculto por defecto: si algo falla, nadie ve administración de más. */
  function aplicar(permite, motivo) {
    ESTADO = permite ? "si" : (motivo || "no");
    var b = boton();
    if (b) {
      b.hidden = !permite;
      b.setAttribute("aria-hidden", permite ? "false" : "true");
      if (permite) b.removeAttribute("aria-hidden");
    }
    /* Un enlace viejo a #negocio no debe dejar a un comprador en una sección
       de administración: se le lleva a la pantalla principal. */
    if (!permite) {
      var h = String(location.hash || "").replace("#", "");
      if (h === "negocio") {
        try { location.replace(location.pathname + location.search + "#panel"); }
        catch (e) { location.hash = "#panel"; }
      }
    }
  }

  async function comprobar() {
    var s = sesion();
    if (!s) { aplicar(false, "sin-sesion"); return false; }
    try {
      var r = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + s.token,
          "X-Dispositivo": dispositivo(),
        },
        body: JSON.stringify({ accion: "local_mio" }),
      });
      var d = await r.json();
      if (!d || !d.ok) { aplicar(false, "sin-permiso"); return false; }
      var tiendas = Array.isArray(d.tiendas) ? d.tiendas : [];
      var rol = String((d.cuenta && d.cuenta.rol) || "").toLowerCase();
      var permite = tiendas.length > 0 || rol === "admin";
      aplicar(permite, "sin-tienda");
      return permite;
    } catch (e) {
      aplicar(false, "sin-red");
      return false;
    }
  }

  /* El botón también se protege en el clic: si no hay permiso confirmado, no
     navega. Evita el caso de un `hidden` que algún estilo haya pisado. */
  function cuidarClic() {
    document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-go="negocio"]') : null;
      if (!b) return;
      if (ESTADO !== "si") {
        e.preventDefault();
        e.stopPropagation();
        comprobar();
      }
    }, true);
  }

  function cuidarHash() {
    /* Un enlace, el botón «atrás» o un `#negocio` escrito a mano pueden
       cambiar el hash sin recargar la página: se revisa siempre. */
    window.addEventListener("hashchange", function () {
      var h = String(location.hash || "").replace("#", "");
      if (h !== "negocio") return;
      if (ESTADO === "si") return;      // la cuenta sí administra: es válido
      if (ESTADO === "desconocido") { comprobar(); return; }
      aplicar(false, ESTADO);
    });
  }

  function iniciar() {
    /* Sin sesión no hay nada que preguntar: se corrige el hash ya mismo. */
    if (!sesion()) aplicar(false, "sin-sesion");
    else {
      var b = boton();
      if (b) b.hidden = true; // nunca visible antes de confirmar
    }
    comprobar();
    cuidarClic();
    cuidarHash();
    window.addEventListener(EVENTO, comprobar);
    /* Al volver a la pestaña, se revisa otra vez: la sesión pudo cambiar en
       otro dispositivo. */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) comprobar();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
