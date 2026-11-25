/* ==========================================================================
   FORGE CORE STOCK · Inventario · Lector de código de barras (inv-lector.js)
   --------------------------------------------------------------------------
   Archivo NUEVO y auto-contenido. NO toca inventario.js ni index.html: expone
   `window.InvLector` para que el hilo principal lo conecte cuando quiera.

   Diseño (a diferencia del lector fijo original, que abría cámara por paso):
     - UN solo `getUserMedia` y UN solo `requestAnimationFrame` por vídeo.
     - Idempotente: montar dos veces el mismo <video> NO abre dos cámaras ni
       lanza dos bucles (estado guardado en un WeakMap por elemento).
     - Dibuja el canvas del visor: mira animada, línea de escaneo y una etiqueta
       con el último código leído y su hora.
     - Respeta `prefers-reduced-motion` (mira quieta) y `document.hidden`
       (no gasta batería con la pestaña/actividad oculta).

   Reutiliza (no duplica) el decodificador del repo:
     - `window.invEscanearCuadro(idVideo)`  → lector EAN-13/EAN-8/UPC-A propio.
     - `window.invCodigoDeTexto(raw)`       → normaliza QR/URL/JSON a código.
   Si `BarcodeDetector` existe (WebView de escritorio), se prefiere; si no, se
   cae al decodificador EAN del repo. Si tampoco existiera, el lector queda
   mudo: el hilo principal debe cargar inventario.js (que define esas funciones).

   Dependencias: ninguna. Vanilla JS.
   ========================================================================== */
(function () {
  "use strict";

  var montajes = new WeakMap(); // <video> -> controlador (idempotencia)
  var genId = 0;

  function prefersReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function fmtHora(t) {
    var d = new Date(t || Date.now());
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  // Dibuja un rectángulo de esquinas redondeadas (algunos WebView no traen
  // ctx.roundRect, así que se traza a mano).
  function redondear(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function crearControlador(video, canvas, opciones) {
    opciones = opciones || {};

    var estado = {
      activo: false,
      raf: 0,
      camara: null,
      detector: null,
      gen: 0,            // invalida una apertura en vuelo si se apaga a mitad
      ocupado: false,    // hay una detección en curso (evita solapar detect() )
      lastScan: 0,       // timestamp del último intento de lectura
      interval: Number(opciones.intervalMs) > 0 ? Number(opciones.intervalMs) : 420,
      ultimo: "",        // último código emitido (freno de repetición)
      ultimoT: 0,
      lastCode: "",      // código que se muestra en la etiqueta del canvas
      lastTime: 0,
      lectores: []       // callbacks de alLeer()
    };
    if (typeof opciones.alLeer === "function") estado.lectores.push(opciones.alLeer);

    // El decodificador EAN del repo busca el <video> por id: si el elemento no
    // tiene uno, se le asigna (no se asume nada del HTML que lo contiene).
    if (!video.id) video.id = "invLecGen_" + (++genId);

    function ctx2d() {
      return canvas && canvas.getContext ? canvas.getContext("2d") : null;
    }

    function emitir(codigo) {
      for (var i = 0; i < estado.lectores.length; i++) {
        try { estado.lectores[i](codigo); } catch (e) { /* un lector roto no corta al resto */ }
      }
    }

    // Normaliza el valor leído reutilizando `invCodigoDeTexto` del repo.
    function normalizar(v) {
      if (typeof window.invCodigoDeTexto === "function") {
        try { return window.invCodigoDeTexto(v); } catch (e) { /* cae al valor pelado */ }
      }
      return String(v == null ? "" : v).trim();
    }

    // Una detección: BarcodeDetector si existe; si no, el EAN propio del repo.
    // Devuelve SIEMPRE una promesa que resuelve a string ("" si no leyó nada).
    function detectar() {
      if (estado.detector) {
        return estado.detector.detect(video).then(function (codigos) {
          return (codigos && codigos.length) ? (codigos[0].rawValue || "") : "";
        }, function () { return ""; });
      }
      if (typeof window.invEscanearCuadro === "function") {
        try { return Promise.resolve(window.invEscanearCuadro(video.id) || ""); }
        catch (e) { return Promise.resolve(""); }
      }
      // Sin decodificador disponible: no hay nada que leer.
      return Promise.resolve("");
    }

    // Dibuja el visor: mira + línea de escaneo + etiqueta del último código.
    function dibujar(ahora) {
      var ctx = ctx2d();
      if (!ctx) return;
      var w = video.videoWidth || video.clientWidth || 320;
      var h = video.videoHeight || video.clientHeight || 240;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);

      var lime = opciones.miraColor || "#C8FF00";
      var mx = w * 0.12, my = h * 0.30, mw = w * 0.76, mh = h * 0.40;

      // Mira: cuatro esquinas (no un marco continuo, para no tapar el código).
      var c = Math.min(mw, mh) * 0.18;
      ctx.strokeStyle = lime;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      var esquinas = [
        [mx, my, 1, 1], [mx + mw, my, -1, 1],
        [mx, my + mh, 1, -1], [mx + mw, my + mh, -1, -1]
      ];
      for (var i = 0; i < esquinas.length; i++) {
        var e = esquinas[i];
        ctx.beginPath();
        ctx.moveTo(e[0] + e[2] * c, e[1]);
        ctx.lineTo(e[0], e[1]);
        ctx.lineTo(e[0], e[1] + e[3] * c);
        ctx.stroke();
      }

      // Línea de escaneo: oscila dentro de la mira. Con reduced-motion se omite.
      if (!prefersReduced()) {
        var t = (ahora % 1400) / 1400;
        var y = my + t * mh;
        ctx.strokeStyle = "rgba(200,255,0,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(mx, y);
        ctx.lineTo(mx + mw, y);
        ctx.stroke();
      }

      // Etiqueta con el último código y su hora (abajo de la mira).
      if (estado.lastCode) {
        var txt = estado.lastCode + " · " + fmtHora(estado.lastTime);
        ctx.font = "600 13px system-ui, -apple-system, sans-serif";
        var tw = ctx.measureText(txt).width + 16;
        var bx = mx, by = my + mh + 8;
        ctx.fillStyle = "rgba(5,5,5,0.72)";
        redondear(ctx, bx, by, tw, 22, 6);
        ctx.fill();
        ctx.fillStyle = lime;
        ctx.fillText(txt, bx + 8, by + 15);
      }
    }

    // Bucle único: dibuja y, cada `interval` ms, intenta leer un código.
    function bucle(ahora) {
      if (!estado.activo) return;
      estado.raf = requestAnimationFrame(bucle);
      if (document.hidden) return; // actividad oculta: no gastar batería
      dibujar(ahora);
      if (estado.ocupado) return;
      if (ahora - estado.lastScan < estado.interval) return;
      if (video.readyState < 2) return; // el vídeo aún no tiene fotogramas
      estado.lastScan = ahora;
      estado.ocupado = true;
      detectar().then(function (valor) {
        if (valor) {
          var cod = normalizar(valor);
          var t = Date.now();
          // Freno de repetición: el mismo código no se repite antes de 1,6 s.
          if (cod && (cod !== estado.ultimo || t - estado.ultimoT > 1600)) {
            estado.ultimo = cod;
            estado.ultimoT = t;
            estado.lastCode = cod;
            estado.lastTime = t;
            emitir(cod);
          }
        }
      }, function () { /* frame malo: se ignora */ }).then(function () {
        estado.ocupado = false;
      });
    }

    // Enciende: una sola cámara, un solo bucle. Idempotente.
    function encender() {
      if (estado.activo) return Promise.resolve(true);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error("getUserMedia no está disponible en este WebView"));
      }
      estado.activo = true; // marca antes de await: evita dos aperturas paralelas
      var gen = ++estado.gen;
      return navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        .then(function (stream) {
          // Si se apagó mientras se abría la cámara, se cierra y no se enciende.
          if (gen !== estado.gen || !estado.activo) {
            stream.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
            return false;
          }
          estado.camara = stream;
          video.srcObject = stream;
          var p = video.play();
          if (p && p.catch) p.catch(function () {});

          if (typeof window.BarcodeDetector === "function") {
            try {
              estado.detector = new window.BarcodeDetector({
                formats: ["ean_13", "ean_8", "upc_a", "code_128", "qr_code"]
              });
            } catch (e) { estado.detector = null; }
          }
          estado.lastScan = 0;
          estado.raf = requestAnimationFrame(bucle);
          return true;
        })
        .catch(function (e) {
          estado.activo = false;
          throw e;
        });
    }

    // Apaga: corta el bucle, detiene la cámara y limpia el visor.
    function apagar() {
      estado.gen++;        // invalida cualquier apertura en vuelo
      estado.activo = false;
      if (estado.raf) { cancelAnimationFrame(estado.raf); estado.raf = 0; }
      if (estado.camara) {
        estado.camara.getTracks().forEach(function (tr) { try { tr.stop(); } catch (e) {} });
        estado.camara = null;
      }
      video.srcObject = null;
      estado.detector = null;
      var ctx = ctx2d();
      if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    return {
      encender: encender,
      apagar: apagar,
      estaActivo: function () { return estado.activo; },
      // Registra (o suma) un callback que recibe cada código leído.
      alLeer: function (cb) {
        if (typeof cb === "function") estado.lectores.push(cb);
        return this;
      },
      // Acceso de diagnóstico (no forma parte del contrato mínimo).
      _estado: estado
    };
  }

  /* ── API pública ────────────────────────────────────────────────────────── */

  window.InvLector = {
    // Monta el lector sobre un <video> y un <canvas>. Idempotente: si el mismo
    // <video> ya tiene lector, devuelve el existente (y suma `opciones.alLeer`
    // si se pasó). NO enciende la cámara solo: hay que llamar a encender().
    // opciones: { alLeer(codigo), intervalMs, miraColor }
    montar: function (video, canvas, opciones) {
      if (!video) throw new Error("InvLector.montar: falta el elemento <video>");
      var previo = montajes.get(video);
      if (previo) {
        if (opciones && typeof opciones.alLeer === "function") previo.alLeer(opciones.alLeer);
        return previo;
      }
      var ctrl = crearControlador(video, canvas, opciones);
      montajes.set(video, ctrl);
      return ctrl;
    },

    // ¿Ese <video> ya tiene un lector montado?
    estaMontado: function (video) {
      return !!(video && montajes.get(video));
    },

    // Utilidades expuestas por comodidad / diagnóstico.
    _prefersReduced: prefersReduced
  };
})();