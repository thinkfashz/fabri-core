/* FORGE CORE STOCK · aviso legal y de datos (APK)
   --------------------------------------------------------------------------
   Explica en lenguaje claro qué datos toca la app, dónde se guardan y qué
   responsabilidad asume quien la usa. No es asesoría legal: es un aviso
   transparente y una aceptación explícita, guardada con versión y fecha.

   Se muestra antes de usar la app. Si el usuario no acepta, no se puede
   continuar: el botón queda deshabilitado y el overlay no se cierra. */
(function () {
  "use strict";

  var VERSION = "2026-11-24";
  var CLAVE = "fcore.legal.version";
  var FECHA = "fcore.legal.fecha";

  function leido() {
    try { return localStorage.getItem(CLAVE) === VERSION; } catch (e) { return false; }
  }

  function aceptar() {
    try {
      localStorage.setItem(CLAVE, VERSION);
      localStorage.setItem(FECHA, new Date().toISOString());
    } catch (e) { /* modo privado: se acepta solo para esta sesión */ }
    var o = document.getElementById("legalOverlay");
    if (o) o.hidden = true;
    try { document.body.classList.remove("legal-bloqueado"); } catch (e) { /* nada */ }
  }

  function abrirExterno(ruta) {
    /* La WebView de la app abre en el navegador el dominio propio (ver
       MainActivity.shouldOverrideUrlLoading). Es la vía para leer la versión
       completa de los términos sin salir de la app de forma brusca. */
    try { window.location.href = "https://forge-core-stock.vercel.app" + ruta; }
    catch (e) { /* sin navegador */ }
  }

  function montar() {
    if (leido()) return;
    if (document.getElementById("legalOverlay")) return;

    var o = document.createElement("div");
    o.id = "legalOverlay";
    o.setAttribute("role", "dialog");
    o.setAttribute("aria-modal", "true");
    o.setAttribute("aria-labelledby", "legalTitulo");
    o.innerHTML =
      '<div class="legal-caja">' +
        '<h2 id="legalTitulo">Antes de continuar</h2>' +
        '<p class="legal-sub">Aviso de datos, permisos y responsabilidad · v' + VERSION + "</p>" +

        "<h3>Qué datos usa la app</h3>" +
        "<p>Para funcionar, FORGE CORE STOCK accede y guarda datos en este equipo y, si conectas tu tienda, " +
          "en la nube:</p>" +
        "<ul>" +
          "<li><b>Del vendedor:</b> nombre de la tienda, identificador, clave de conexión (cifrada), catálogo, " +
            "precios, stock, pedidos, boletas y ajustes.</li>" +
          "<li><b>Del cliente:</b> nombre, teléfono, dirección de entrega, pedidos y reseñas que deja al comprar.</li>" +
          "<li><b>Del uso:</b> registros técnicos (errores, fecha y resultado de las sincronizaciones) para " +
            "diagnosticar fallos.</li>" +
        "</ul>" +

        "<h3>Dónde se guardan</h3>" +
        "<p><b>En el teléfono:</b> la base local, los modelos de IA descargados, el catálogo y la bóveda de " +
          "credenciales. Ese espacio puede ocupar varios GB y <b>no se sube a la nube</b>.</p>" +
        "<p><b>En la nube</b> (InsForge, servidor del responsable): tienda, catálogo, pedidos, reseñas y clientes " +
          "agregados. Las claves se guardan como hash; la clave de conexión se muestra una sola vez.</p>" +

        "<h3>Cookies y almacenamiento local</h3>" +
        "<p>La app no usa cookies publicitarias ni rastreadores de terceros. Usa almacenamiento local del " +
          "dispositivo (base de datos y almacenamiento del navegador interno) para mantener tu sesión y tus datos " +
          "aunque cierres la app. Puedes borrarlo desde Ajustes de Android o desde la propia app; al hacerlo se " +
          "pierden los datos locales, no los de la nube.</p>" +

        "<h3>Permisos</h3>" +
        "<ul>" +
          "<li><b>Internet:</b> para sincronizar con tu tienda y usar la IA remota.</li>" +
          "<li><b>Cámara:</b> sólo cuando abres el escáner de códigos o la foto de un producto.</li>" +
          "<li><b>Notificaciones:</b> sólo si tú las activas.</li>" +
        "</ul>" +
        "<p>La app no lee tus contactos, mensajes, llamadas ni archivos ajenos a los que tú eliges.</p>" +

        "<h3>Responsabilidad</h3>" +
        "<p>La app se entrega <b>tal como está</b>. El responsable del tratamiento de los datos es quien opera " +
          "la tienda y decide qué información carga. El fundador y los desarrolladores de FORGE CORE STOCK " +
          "<b>no se hacen responsables</b> del uso indebido de la aplicación, de decisiones comerciales tomadas " +
          "con sus datos, ni de daños derivados de un uso contrario a la ley o a estos avisos. Cada usuario es " +
          "responsable de la información que ingresa, de sus claves y del cumplimiento de la normativa aplicable " +
          "en su país.</p>" +

        "<h3>Tus derechos</h3>" +
        "<p>Puedes ver, corregir y exportar tus datos desde la app (Ajustes → exportar) y pedir la eliminación de " +
          "tu tienda desde el panel del negocio. Los datos de clientes se pueden eliminar junto con la tienda o " +
          "los pedidos.</p>" +

        '<div class="legal-check">' +
          '<input id="legalAcepto" type="checkbox" aria-label="Acepto los avisos">' +
          "<label for=\"legalAcepto\">He leído y acepto el aviso de datos, el uso de almacenamiento local y la " +
            "nube, y entiendo que el uso que haga de la app es mi responsabilidad.</label>" +
        "</div>" +
        '<div class="legal-fila">' +
          '<button class="legal-btn" id="legalTerminos" type="button">Leer términos</button>' +
          '<button class="legal-btn" id="legalPrivacidad" type="button">Privacidad</button>' +
          '<button class="legal-btn legal-btn--pri" id="legalContinuar" type="button" disabled>Continuar</button>' +
        "</div>" +
        '<p class="legal-nota">Si no aceptas, cierra la app. No se envía nada a la nube hasta que conectes tu ' +
          "tienda y aceptes.</p>" +
      "</div>";

    document.body.appendChild(o);
    try { document.body.classList.add("legal-bloqueado"); } catch (e) { /* nada */ }

    var check = document.getElementById("legalAcepto");
    var seguir = document.getElementById("legalContinuar");
    if (check && seguir) {
      check.addEventListener("change", function () {
        seguir.disabled = !check.checked;
      });
    }
    if (seguir) seguir.addEventListener("click", aceptar);
    var t = document.getElementById("legalTerminos");
    if (t) t.addEventListener("click", function () { abrirExterno("/terminos.html"); });
    var p = document.getElementById("legalPrivacidad");
    if (p) p.addEventListener("click", function () { abrirExterno("/privacidad.html"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
