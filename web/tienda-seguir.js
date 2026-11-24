/* ==========================================================================
   PÁGINA: Seguimiento de pedido (seguir.html)
   --------------------------------------------------------------------------
   El comprador abre el enlace que le dio el local (`?t=<token>`) y ve cómo va
   su pedido sin crear cuenta. Si perdió el enlace, escribe el código MP-XXXXX
   y los últimos 4 dígitos del teléfono.

   Toda la lógica de pintado vive aquí; las funciones puras (normalizar el
   código, armar los pasos, formatear fechas) se exponen en `Seguir._test`
   para poder probarlas sin navegador.
   ========================================================================== */

(function () {
  "use strict";

  var MERCADO = "https://fabri-api.vercel.app/api/mercado";
  var K_ULTIMO = "fcs.seguir.ultimo";   // { codigo, token } del último pedido
  var K_RESENADO = "fcs.seguir.resenado"; // pedidos ya calificados en este equipo
  var K_AVISOS = "fcs.seguir.avisos";   // { <clave del pedido>: endpoint }
  var SW_AVISOS = "/sw-push.js";
  var F = window.FCS || {};
  /* Con qué se probó que el pedido es tuyo: el enlace (token) o el código +
     los últimos 4 del teléfono. La reseña viaja con lo mismo. */
  var CRED = { token: "", codigo: "", contacto: "" };

  /* ── utilidades puras ─────────────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function clp(n) {
    var v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(v);
    } catch (e) { return "$" + Math.round(v); }
  }

  /**
   * Deja el código como lo guarda la base: `MP-ABCDE`.
   * Acepta `mpabcde`, `MP ABCDE`, `ABCDE` o `MP-ABCDE`, porque el comprador lo
   * escribe como puede. Si no trae el prefijo y son 5 caracteres, lo agrega.
   */
  function normalizarCodigo(v) {
    var s = String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return "";
    if (s.indexOf("MP") === 0) s = s.slice(2);
    if (!s) return "";
    return "MP-" + s.slice(0, 5);
  }

  /** Últimos 4 dígitos de un teléfono escrito de cualquier forma. */
  function telefono4(v) {
    var d = String(v == null ? "" : v).replace(/\D/g, "");
    return d.length >= 4 ? d.slice(-4) : "";
  }

  /** «recibido», «preparando», «listo», «entregado» o «cancelado». */
  var ESTADOS = {
    nuevo:     { chip: "Recibido",     titulo: "El local recibió tu pedido",      clase: "nuevo" },
    visto:     { chip: "Preparando",   titulo: "Están preparando tu pedido",      clase: "visto" },
    listo:     { chip: "Listo",        titulo: "Tu pedido está listo",            clase: "listo" },
    entregado: { chip: "Entregado",    titulo: "Pedido entregado",                clase: "entregado" },
    cancelado: { chip: "Cancelado",    titulo: "El pedido fue cancelado",         clase: "cancelado" }
  };

  function estadoInfo(estado, entrega) {
    var e = ESTADOS[estado] || ESTADOS.nuevo;
    if (estado === "listo" && entrega === "delivery") {
      return { chip: "En camino", titulo: "Tu pedido va en camino", clase: "listo" };
    }
    return e;
  }

  var ULTIMO_PEDIDO = null;

  var PASOS = [
    { clave: "nuevo", txt: "Pedido recibido" },
    { clave: "visto", txt: "En preparación" },
    { clave: "listo", txt: "Listo" },
    { clave: "entregado", txt: "Entregado" }
  ];

  /**
   * Pasos de la línea de tiempo con su marca de tiempo.
   * `eventos` es el historial real (puede venir vacío en pedidos antiguos, y
   * entonces se usa `creado` para el primer paso). Un pedido cancelado corta
   * la línea: los pasos posteriores no se marcan como hechos.
   */
  function pasos(estado, eventos, creado) {
    var hist = Array.isArray(eventos) ? eventos : [];
    var ts = {};
    for (var i = 0; i < hist.length; i++) {
      var ev = hist[i] || {};
      if (ev.estado) ts[ev.estado] = ev.ts;
    }
    if (!ts.nuevo && creado) ts.nuevo = creado;

    var indice = { nuevo: 0, visto: 1, listo: 2, entregado: 3 }[estado];
    var cancelado = estado === "cancelado";

    var lista = PASOS.map(function (p, n) {
      var hecho = cancelado ? Boolean(ts[p.clave]) : indice != null && n <= indice;
      return {
        clave: p.clave,
        txt: p.txt,
        ts: ts[p.clave] || 0,
        hecho: hecho,
        actual: !cancelado && n === indice
      };
    });

    if (cancelado) {
      lista.push({ clave: "cancelado", txt: "Cancelado", ts: ts.cancelado || 0, hecho: true, actual: true });
    }
    return lista;
  }

  /** «hoy 14:32» · «ayer 09:10» · «10 nov 18:00». Acepta número o ISO. */
  function fechaCorta(ms, ahoraMs) {
    var t = ms instanceof Date ? ms.getTime()
      : (typeof ms === "string" ? Date.parse(ms) : Number(ms));
    if (!t || !isFinite(t)) return "";
    var ahora = Number(ahoraMs) || Date.now();
    var d = new Date(t);
    var hora = "";
    try {
      hora = d.toLocaleTimeString("es-CL", {
        hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Santiago"
      });
    } catch (e) { hora = ""; }
    var dia = "";
    try {
      dia = d.toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })
        .replace(/\.$/, "");
    } catch (e) { dia = ""; }

    var diaMs = 86400000;
    var dif = Math.floor((ahora - t) / diaMs);
    if (dif <= 0) return "hoy " + hora;
    if (dif === 1) return "ayer " + hora;
    return dia + " " + hora;
  }

  /* ── red ──────────────────────────────────────────────────────────────── */

  function ultimo() {
    try {
      var d = JSON.parse(localStorage.getItem(K_ULTIMO) || "null");
      return d && d.token ? d : null;
    } catch (e) { return null; }
  }

  function guardarUltimo(codigo, token) {
    if (!token) return;
    try { localStorage.setItem(K_ULTIMO, JSON.stringify({ codigo: codigo, token: token })); }
    catch (e) { /* modo privado: el enlace igual sirve */ }
  }

  /* ── reseña (sólo con el pedido entregado) ─────────────────────────────── */

  function claveCred(cred) {
    if (cred && cred.token) return cred.token;
    if (cred && cred.codigo) return "c:" + cred.codigo;
    return "";
  }

  function yaResenado(cred) {
    var clave = claveCred(cred);
    if (!clave) return false;
    try {
      var lista = JSON.parse(localStorage.getItem(K_RESENADO) || "[]");
      return Array.isArray(lista) && lista.indexOf(clave) >= 0;
    } catch (e) { return false; }
  }

  function marcarResenado(cred) {
    var clave = claveCred(cred);
    if (!clave) return;
    try {
      var lista = JSON.parse(localStorage.getItem(K_RESENADO) || "[]");
      if (!Array.isArray(lista)) lista = [];
      if (lista.indexOf(clave) < 0) lista.push(clave);
      localStorage.setItem(K_RESENADO, JSON.stringify(lista.slice(-40)));
    } catch (e) { /* modo privado */ }
  }

  var ESTRELLA = "M12 3.3l2.55 5.3 5.85.82-4.25 4.1 1.02 5.8L12 16.6l-5.17 2.72 1.02-5.8-4.25-4.1 5.85-.82z";

  /** Cinco estrellas, llenas hasta `n`. Es lo mismo que ve la ficha del local. */
  /** Una sola estrella: el botón de calificar es una estrella, no cinco. */
  function unEstrella(tam) {
    var alto = tam || 20;
    return '<svg class="sg-estrella-svg" viewBox="0 0 24 24" width="' + alto + '" height="' + alto +
      '" aria-hidden="true"><path d="' + ESTRELLA + '" ' +
      'fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
  }

  function estrellas(n, tam) {
    var k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    var alto = tam || 12;
    var svg = '<svg class="sg-estrellas" viewBox="0 0 120 24" width="' + alto * 5 +
      '" height="' + alto + '" aria-hidden="true">';
    for (var i = 0; i < 5; i++) {
      svg += '<path d="' + ESTRELLA + '" transform="translate(' + i * 24 + ' 0)" ' +
        (i < k ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.2" opacity=".35"') + "/>";
    }
    return svg + "</svg>";
  }

  function bloqueResena(pedido, cred) {
    if (pedido.estado !== "entregado") return "";
    if (!claveCred(cred)) return "";
    if (yaResenado(cred)) {
      return '<div class="ds-card sg-resena sg-resena-hecha">' +
        "<h2>Gracias por calificar</h2>" +
        '<p class="sg-dato">Tu reseña ya está publicada en la ficha del local.</p></div>';
    }
    // Una estrella por botón, en orden 1→5: al tocar la tercera, se llenan tres.
    var botones = "";
    for (var i = 1; i <= 5; i++) {
      botones += '<button type="button" class="sg-estrella" data-estrella="' + i +
        '" aria-label="' + i + " de 5\" aria-pressed=\"false\">" + unEstrella(20) + "</button>";
    }
    return '<div class="ds-card sg-resena" id="sgResena">' +
      "<h2>¿Cómo estuvo tu pedido?</h2>" +
      '<p class="sg-dato">Tu opinión ayuda a otros compradores. Se publica con tu nombre abreviado.</p>' +
      '<div class="sg-estrellas-fila" role="group" aria-label="Calificación">' + botones + "</div>" +
      '<textarea id="sgResenaTexto" class="ds-input sg-textarea" rows="3" maxlength="500" ' +
        'placeholder="Cuenta qué tal estuvo la atención, la entrega o los productos (opcional)"></textarea>' +
      '<p class="sg-error" id="sgResenaError" role="alert" hidden></p>' +
      '<button type="button" class="ds-btn ds-btn--block sg-resena-btn" id="sgResenaEnviar">Publicar reseña</button>' +
      '<small class="sg-dato sg-resena-nota">Sólo puedes calificar una vez por pedido.</small>' +
    "</div>";
  }

  function engancharResena(cred) {
    var caja = document.getElementById("sgResena");
    if (!caja) return;
    var elegidas = 5;
    var botones = caja.querySelectorAll(".sg-estrella");

    function pintarEstrellas() {
      for (var i = 0; i < botones.length; i++) {
        var n = Number(botones[i].getAttribute("data-estrella")) || 0;
        botones[i].className = "sg-estrella" + (n <= elegidas ? " on" : "");
        botones[i].setAttribute("aria-pressed", n === elegidas ? "true" : "false");
      }
    }
    for (var i = 0; i < botones.length; i++) {
      botones[i].onclick = function () {
        elegidas = Number(this.getAttribute("data-estrella")) || 5;
        pintarEstrellas();
      };
    }
    pintarEstrellas();

    var enviar = document.getElementById("sgResenaEnviar");
    if (!enviar) return;
    enviar.onclick = function () {
      var textoEl = document.getElementById("sgResenaTexto");
      var errEl = document.getElementById("sgResenaError");
      enviar.disabled = true;
      enviar.textContent = "Publicando…";
      if (errEl) errEl.hidden = true;
      var cuerpo = { accion: "resena_crear", estrellas: elegidas, texto: textoEl ? textoEl.value : "" };
      if (cred && cred.token) cuerpo.token = cred.token;
      else { cuerpo.codigo = cred.codigo; cuerpo.contacto = cred.contacto; }
      buscar(cuerpo).then(function (d) {
        if (d && d.ok) {
          marcarResenado(cred);
          var prom = d.calificacion && d.calificacion.promedio;
          caja.innerHTML = "<h2>Gracias por calificar</h2>" +
            '<p class="sg-dato">' + (prom
              ? "Tu reseña ya se ve en la ficha del local (promedio " +
                String(prom).replace(".", ",") + " de 5)."
              : "Tu reseña ya se ve en la ficha del local.") + "</p>";
          caja.className = "ds-card sg-resena sg-resena-hecha";
          return;
        }
        enviar.disabled = false;
        enviar.textContent = "Publicar reseña";
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = (d && d.error) || "No pudimos publicar la reseña.";
        }
      }).catch(function () {
        enviar.disabled = false;
        enviar.textContent = "Publicar reseña";
        if (errEl) { errEl.hidden = false; errEl.textContent = "No hay conexión. Inténtalo de nuevo."; }
      });
    };
  }

  function buscar(cuerpo) {
    // Si la persona entró en este navegador, la reseña queda ligada a su
    // cuenta para «Mis reseñas» del panel. La prueba de compra del pedido
    // sigue viajando aparte y no se reemplaza por la sesión.
    var cabeceras = { "Content-Type": "application/json" };
    try {
      var nube = JSON.parse(localStorage.getItem("fcore.nube") || "null");
      if (nube && nube.token) {
        cabeceras.Authorization = "Bearer " + nube.token;
        var disp = localStorage.getItem("fcore.dispositivo");
        if (disp) cabeceras["x-dispositivo"] = disp;
      }
    } catch (e) { /* invitado: la reseña se publica igual */ }
    return fetch(MERCADO, {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify(cuerpo)
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  /* ── avisos push del pedido ───────────────────────────────────────────── */

  function soportaAvisos() {
    return typeof window !== "undefined" && "Notification" in window &&
      "serviceWorker" in navigator && "PushManager" in window;
  }

  /** endpoint guardado para este pedido ("" si no se activaron los avisos). */
  function avisosActivos(cred) {
    var clave = claveCred(cred);
    if (!clave) return "";
    try {
      var d = JSON.parse(localStorage.getItem(K_AVISOS) || "{}") || {};
      return typeof d[clave] === "string" ? d[clave] : "";
    } catch (e) { return ""; }
  }

  function guardarAviso(cred, endpoint) {
    var clave = claveCred(cred);
    if (!clave) return;
    try {
      var d = JSON.parse(localStorage.getItem(K_AVISOS) || "{}") || {};
      d[clave] = endpoint;
      localStorage.setItem(K_AVISOS, JSON.stringify(d));
    } catch (e) { /* modo privado: los avisos igual quedan activos en el navegador */ }
  }

  function borrarAviso(cred) {
    var clave = claveCred(cred);
    if (!clave) return;
    try {
      var d = JSON.parse(localStorage.getItem(K_AVISOS) || "{}") || {};
      delete d[clave];
      localStorage.setItem(K_AVISOS, JSON.stringify(d));
    } catch (e) { /* nada */ }
  }

  /** base64url → Uint8Array, que es lo que pide `applicationServerKey`. */
  function claveToUint8(b64) {
    var s = String(b64 || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function cuerpoAviso(accion, suscripcion) {
    var cuerpo = { accion: accion };
    if (CRED.token) cuerpo.token = CRED.token;
    else { cuerpo.codigo = CRED.codigo; cuerpo.contacto = CRED.contacto; }
    if (suscripcion) cuerpo.suscripcion = suscripcion;
    return cuerpo;
  }

  function bloqueAvisos(pedido) {
    if (!pedido || !pedido.push || !pedido.push.disponible) return "";
    if (pedido.estado === "entregado" || pedido.estado === "cancelado") return "";
    if (!soportaAvisos()) return "";
    if (!claveCred(CRED)) return "";
    var activo = avisosActivos(CRED);
    return '<section class="ds-card sg-avisos" id="sgAvisos" data-clave="' + esc(claveCred(CRED)) + '">' +
      '<div class="sg-avisos-cab"><h2>Avisarme cuando cambie</h2>' +
        (activo ? '<span class="ds-badge ds-badge--ok">activado</span>' : "") +
      "</div>" +
      '<p class="sg-dato">' + (activo
        ? "Te avisaremos en este teléfono cuando el local mueva tu pedido."
        : "Una notificación en este teléfono cuando el local reciba, prepare o entregue tu pedido.") + "</p>" +
      (activo
        ? '<button type="button" class="sg-avisos-quitar" id="sgAvisosQuitar">Dejar de avisar</button>'
        : '<button type="button" class="ds-btn ds-btn--secondary ds-btn--block" id="sgAvisosBtn">Activar avisos</button>') +
      '<p class="sg-error" id="sgAvisosError" role="alert" hidden></p>' +
    "</section>";
  }

  function pintarBotonAvisos(activo) {
    var caja = document.getElementById("sgAvisos");
    if (!caja) return;
    caja.innerHTML =
      '<div class="sg-avisos-cab"><h2>Avisarme cuando cambie</h2>' +
        (activo ? '<span class="ds-badge ds-badge--ok">activado</span>' : "") +
      "</div>" +
      '<p class="sg-dato">' + (activo
        ? "Te avisaremos en este teléfono cuando el local mueva tu pedido."
        : "Una notificación en este teléfono cuando el local reciba, prepare o entregue tu pedido.") + "</p>" +
      (activo
        ? '<button type="button" class="sg-avisos-quitar" id="sgAvisosQuitar">Dejar de avisar</button>'
        : '<button type="button" class="ds-btn ds-btn--secondary ds-btn--block" id="sgAvisosBtn">Activar avisos</button>') +
      '<p class="sg-error" id="sgAvisosError" role="alert" hidden></p>';
    engancharAvisos();
  }

  function errorAvisos(txt) {
    var el = document.getElementById("sgAvisosError");
    if (!el) return;
    if (!txt) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = txt;
  }

  function activarAvisos(pedido) {
    var btn = document.getElementById("sgAvisosBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Activando…"; }
    errorAvisos("");

    if (Notification.permission === "denied") {
      if (btn) { btn.disabled = false; btn.textContent = "Activar avisos"; }
      errorAvisos("El navegador tiene bloqueadas las notificaciones para este sitio. " +
        "Actívalas en los ajustes del navegador y vuelve a intentar.");
      return;
    }

    var pedir = Notification.permission === "granted"
      ? Promise.resolve("granted")
      : Notification.requestPermission();

    pedir.then(function (permiso) {
      if (permiso !== "granted") {
        throw new Error("permiso");
      }
      return navigator.serviceWorker.register(SW_AVISOS);
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (actual) {
        if (actual) return actual;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: claveToUint8(pedido.push.clave)
        });
      });
    }).then(function (sub) {
      var json = sub.toJSON ? sub.toJSON() : null;
      if (!json || !json.endpoint) throw new Error("suscripcion");
      return buscar(cuerpoAviso("push_suscribir", json)).then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "no se pudo guardar");
        guardarAviso(CRED, json.endpoint);
        pintarBotonAvisos(true);
      });
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Activar avisos"; }
      if (e && e.message === "permiso") {
        errorAvisos("Sin permiso de notificaciones no podemos avisarte. Puedes activarlo desde los ajustes del navegador.");
      } else if (e && e.message === "no se pudo guardar") {
        errorAvisos("No pudimos registrar el aviso. Inténtalo de nuevo.");
      } else {
        errorAvisos("Este navegador no pudo activar los avisos. Revisa los permisos del sitio.");
      }
    });
  }

  function quitarAvisos() {
    var btn = document.getElementById("sgAvisosQuitar");
    if (btn) { btn.disabled = true; btn.textContent = "Quitando…"; }
    var endpoint = avisosActivos(CRED);

    function darDeBaja(ep) {
      if (!ep) return Promise.resolve();
      return fetch(MERCADO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign(cuerpoAviso("push_baja"), { endpoint: ep }))
      }).catch(function () { /* sin red: igual se borra en el navegador */ });
    }

    navigator.serviceWorker.getRegistration(SW_AVISOS).then(function (reg) {
      var sub = reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
      return Promise.resolve(sub).then(function (s) {
        if (!s) return darDeBaja(endpoint);
        var json = s.toJSON ? s.toJSON() : {};
        return s.unsubscribe().then(function () {
          return darDeBaja(json.endpoint || endpoint);
        });
      });
    }).then(function () {
      borrarAviso(CRED);
      pintarBotonAvisos(false);
    }).catch(function () {
      borrarAviso(CRED);
      pintarBotonAvisos(false);
    });
  }

  function engancharAvisos() {
    var btn = document.getElementById("sgAvisosBtn");
    if (btn) {
      btn.onclick = function () {
        if (ULTIMO_PEDIDO) activarAvisos(ULTIMO_PEDIDO);
      };
    }
    var quitar = document.getElementById("sgAvisosQuitar");
    if (quitar) quitar.onclick = quitarAvisos;
  }

  /* ── pintado ──────────────────────────────────────────────────────────── */

  function error(txt) {
    var el = document.getElementById("sgError");
    if (!el) return;
    if (!txt) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = txt;
  }

  function cargando(si) {
    var b = document.getElementById("sgBuscar");
    if (!b) return;
    b.disabled = Boolean(si);
    b.textContent = si ? "Buscando…" : "Ver el pedido";
  }

  function linea(pedido) {
    var lista = pasos(pedido.estado, pedido.eventos, pedido.creado);
    return '<ol class="sg-pasos">' + lista.map(function (p) {
      return '<li class="sg-paso' + (p.hecho ? " hecho" : "") + (p.actual ? " actual" : "") +
        (p.clave === "cancelado" ? " cancelado" : "") + '">' +
        '<i aria-hidden="true"></i>' +
        '<div><b>' + esc(p.txt) + "</b>" +
        (p.ts ? "<small>" + esc(fechaCorta(p.ts)) + "</small>" : "") +
        "</div></li>";
    }).join("") + "</ol>";
  }

  function resumen(pedido) {
    var items = Array.isArray(pedido.items) ? pedido.items : [];
    var filas = items.map(function (x) {
      var n = Number(x.cantidad) || 1;
      var precio = Number(x.precio) || 0;
      return '<div class="sg-linea"><span>' + n + " × " + esc(x.nombre || "Producto") +
        "</span><b>" + clp(precio * n) + "</b></div>";
    }).join("");
    var envio = Number(pedido.envio) || 0;
    var comuna = pedido.comuna_entrega ? ", " + pedido.comuna_entrega : "";
    return '<div class="ds-card sg-resumen">' +
      '<div class="sg-resumen-cab"><h2>Tu pedido</h2>' +
        '<span class="ds-badge">' + items.length + (items.length === 1 ? " producto" : " productos") + "</span></div>" +
      filas +
      (envio ? '<div class="sg-linea sg-linea--sub"><span>Envío</span><b>' + clp(envio) + "</b></div>" : "") +
      '<div class="sg-linea sg-linea--total"><span>Total</span><b>' + clp(pedido.total) + "</b></div>" +
      '<p class="sg-dato"><b>Entrega:</b> ' + esc(pedido.entrega === "delivery"
        ? "Delivery" + (pedido.direccion ? " a " + pedido.direccion + comuna : "") : "Retiro en el local") + "</p>" +
      (pedido.referencia_entrega
        ? '<p class="sg-dato"><b>Referencia:</b> ' + esc(pedido.referencia_entrega) + "</p>" : "") +
      (pagoTexto(pedido)
        ? '<p class="sg-dato"><b>Pago:</b> ' + esc(pagoTexto(pedido)) + "</p>" : "") +
      (pedido.clave_entrega && pedido.estado !== "entregado" && pedido.estado !== "cancelado"
        ? '<div class="sg-clave">' +
            "<span>Código de entrega</span>" +
            "<b>" + esc(pedido.clave_entrega) + "</b>" +
            "<small>Dáselo al repartidor o al local sólo cuando recibas tu pedido.</small>" +
          "</div>"
        : "") +
      (pedido.nota ? '<p class="sg-dato"><b>Nota:</b> ' + esc(pedido.nota) + "</p>" : "") +
    "</div>";
  }

  /** Cómo se paga: el efectivo con vuelto se lee de un vistazo. */
  function pagoTexto(p) {
    var m = p.metodo_pago || "";
    if (m === "efectivo") {
      var con = Number(p.pago_con) || 0;
      var vuelto = Number(p.vuelto) || 0;
      return "Efectivo" + (con
        ? " · pagas con " + clp(con) + (vuelto ? " · vuelto " + clp(vuelto) : " · monto justo")
        : " al recibir");
    }
    if (m === "transferencia") return "Transferencia";
    if (m === "tarjeta") return "Tarjeta (simulada)";
    return "";
  }

  function localHtml(pedido) {
    var l = pedido.local || {};
    var tel = String(l.telefono || "").replace(/[^\d]/g, "");
    var wa = "";
    if (tel.length >= 8) {
      var numero = tel.indexOf("56") === 0 ? tel : "56" + tel.replace(/^0/, "");
      wa = "https://wa.me/" + numero + "?text=" +
        encodeURIComponent("Hola, consulto por mi pedido " + (pedido.codigo || ""));
    }
    return '<div class="ds-card sg-local">' +
      '<div class="sg-local-cab">' +
        "<h2>" + esc(l.nombre || "El local") + "</h2>" +
        '<span class="ds-badge ' + (l.abierto ? "ds-badge--ok" : "ds-badge--warn") + '">' +
          (l.abierto ? "abierto" : "cerrado") + "</span>" +
      "</div>" +
      (l.direccion || l.comuna
        ? '<p class="sg-dato">' + esc([l.direccion, l.comuna].filter(Boolean).join(", ")) + "</p>" : "") +
      (l.horario ? '<p class="sg-dato"><b>Horario:</b> ' + esc(l.horario) + "</p>" : "") +
      (wa ? '<a class="ds-btn ds-btn--secondary ds-btn--block sg-wa" href="' + esc(wa) +
        '" target="_blank" rel="noopener">Escribir al local por WhatsApp</a>' : "") +
    "</div>";
  }

  /* Código único de verificación + acceso al recorrido 3D. Sólo aparece si
     la nube lo devolvió (pedidos nuevos o abiertos por primera vez). */
  function mostrarVerif(v) {
    var s = String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return "";
    if (s.charAt(0) !== "V") s = "V" + s;
    s = s.slice(0, 9);
    return s.length === 9 ? "V-" + s.slice(1, 5) + "-" + s.slice(5, 9) : "";
  }

  function bloqueVerificacion(pedido) {
    var verif = mostrarVerif(pedido && pedido.verificacion);
    if (!verif) return "";
    return '<div class="sg-verif">' +
      '<div class="sg-verif__cabeza">' +
        '<small>Código único de verificación</small>' +
        '<b class="sg-verif__cod">' + esc(verif) + "</b>" +
      "</div>" +
      '<a class="ds-btn ds-btn--block" href="./verificar.html?v=' + encodeURIComponent(verif) + '">' +
        "Ver el recorrido 3D del envío</a>" +
      '<small class="sg-verif__nota">Con este código se comprueba el estado real del pedido en cualquier equipo.</small>' +
    "</div>";
  }

  function pintar(pedido) {
    var cont = document.getElementById("sgResultado");
    if (!cont) return;
    ULTIMO_PEDIDO = pedido;
    var est = estadoInfo(pedido.estado, pedido.entrega);
    cont.innerHTML =
      '<div class="sg-estado sg-estado--' + est.clase + '">' +
        '<span class="ds-badge ds-badge--solid">' + esc(est.chip) + "</span>" +
        "<b>" + esc(est.titulo) + "</b>" +
        "<small>Pedido " + esc(pedido.codigo || "") +
          (pedido.local && pedido.local.nombre ? " · " + esc(pedido.local.nombre) : "") +
        "</small>" +
      "</div>" +
      linea(pedido) +
      resumen(pedido) +
      bloqueVerificacion(pedido) +
      localHtml(pedido) +
      bloqueAvisos(pedido) +
      bloqueResena(pedido, CRED);
    cont.hidden = false;
    error("");

    // El formulario deja de estorbar cuando ya hay un pedido en pantalla.
    var form = document.getElementById("sgForm");
    if (form) form.hidden = true;
    var pie = document.getElementById("sgPie");
    if (pie) pie.hidden = true;
    var sub = document.getElementById("sgSub");
    if (sub) sub.textContent = "Este es el estado de tu pedido. El local lo actualiza desde su panel.";

    engancharAvisos();
    engancharResena(CRED);

    try {
      cont.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { /* navegador viejo */ }
  }

  function mostrarError(txt) {
    error(txt);
    var cont = document.getElementById("sgResultado");
    if (cont) cont.hidden = true;
    var form = document.getElementById("sgForm");
    if (form) form.hidden = false;
  }

  /* ── flujo ────────────────────────────────────────────────────────────── */

  function porToken(token) {
    CRED = { token: token || "", codigo: "", contacto: "" };
    cargando(true);
    error("");
    return buscar({ accion: "pedido_seguir", token: token }).then(function (d) {
      cargando(false);
      if (d && d.ok && d.pedido) {
        guardarUltimo(d.pedido.codigo, token);
        pintar(d.pedido);
      } else {
        mostrarError((d && d.error) || "No pudimos abrir ese enlace. Revisa el código.");
      }
    }).catch(function () {
      cargando(false);
      mostrarError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
    });
  }

  function porCodigo(codigo, contacto) {
    CRED = { token: "", codigo: codigo || "", contacto: contacto || "" };
    cargando(true);
    error("");
    return buscar({ accion: "pedido_seguir", codigo: codigo, contacto: contacto })
      .then(function (d) {
        cargando(false);
        if (d && d.ok && d.pedido) {
          pintar(d.pedido);
        } else {
          mostrarError((d && d.error) || "No encontramos ese pedido.");
        }
      }).catch(function () {
        cargando(false);
        mostrarError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
      });
  }

  function montar() {
    if (F.montaNav) F.montaNav();

    var form = document.getElementById("sgForm");
    var codigo = document.getElementById("sgCodigo");
    var tel = document.getElementById("sgTel");

    if (form) {
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var c = normalizarCodigo(codigo ? codigo.value : "");
        var t = telefono4(tel ? tel.value : "");
        if (!c || c === "MP-") { mostrarError("Escribe el código del pedido (por ejemplo MP-ABCDE)."); if (codigo) codigo.focus(); return; }
        if (!t) { mostrarError("Escribe los últimos 4 dígitos del teléfono con que hiciste el pedido."); if (tel) tel.focus(); return; }
        porCodigo(c, t);
      });
    }

    if (codigo) {
      codigo.addEventListener("input", function () {
        var pos = codigo.selectionStart;
        codigo.value = codigo.value.toUpperCase();
        try { codigo.setSelectionRange(pos, pos); } catch (e) { /* nada */ }
      });
    }

    var token = "";
    try { token = new URLSearchParams(location.search).get("t") || ""; } catch (e) { token = ""; }

    if (token) { porToken(token); return; }

    // Sin enlace: si este teléfono ya abrió un pedido, se muestra solo.
    var u = ultimo();
    if (u) { porToken(u.token); return; }
  }

  window.Seguir = {
    render: montar,
    buscar: porToken,
    _test: { normalizarCodigo: normalizarCodigo, telefono4: telefono4, estadoInfo: estadoInfo,
      pasos: pasos, fechaCorta: fechaCorta, clp: clp, estrellas: estrellas,
      claveCred: claveCred, bloqueResena: bloqueResena }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar);
  } else {
    montar();
  }
})();
