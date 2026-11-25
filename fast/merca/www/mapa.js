/* MercaFabrick · mapa interactivo (mapa.js)
   --------------------------------------------------------------------------
   Mapa "slippy" dibujado en canvas, sin librerías: teselas de OpenStreetMap,
   marcadores de locales, punto de ubicación, arrastre, zoom y pinch.
   Se monta en un contenedor y avisa qué local se eligió.

   API:
     MercaMapa.montar(contenedor, {
       locales: [...], alElegir: fn(local), alVerCatalogo: fn(local),
       ubicacion: {lat, lon} | null
     }) -> { redibujar, destruir, centrar(lat, lon, zoom), setUbicacion }

   Por qué canvas y no Leaflet: menos peso, sin dependencias y control total
   del estilo (oscuro, acento lima).
   -------------------------------------------------------------------------- */

(function () {
  "use strict";

  var TILE = 256;
  var MIN_Z = 3;
  var MAX_Z = 18;
  var URL_TILE = "https://tile.openstreetmap.org/";

  function proyecto(lat, lon, z) {
    var n = Math.pow(2, z) * TILE;
    var sen = Math.sin((lat * Math.PI) / 180);
    var x = ((lon + 180) / 360) * n;
    var y = (0.5 - Math.log((1 + sen) / (1 - sen)) / (4 * Math.PI)) * n;
    return { x: x, y: y };
  }

  function desproyecto(x, y, z) {
    var n = Math.pow(2, z) * TILE;
    var lon = (x / n) * 360 - 180;
    var lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    return { lat: lat, lon: lon };
  }

  function montar(contenedor, opts) {
    if (!contenedor) return null;
    opts = opts || {};

    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", "Mapa de locales del barrio");
    contenedor.appendChild(canvas);

    var ctx = canvas.getContext("2d");
    var creditos = document.createElement("div");
    creditos.className = "mf-mapa__credito";
    creditos.textContent = "© OpenStreetMap";
    contenedor.appendChild(creditos);

    var controles = document.createElement("div");
    controles.className = "mf-mapa__controles";
    controles.innerHTML =
      '<button class="mf-mapa__btn" type="button" data-mapa-mas aria-label="Acercar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
      '<path d="M12 5v14M5 12h14"/></svg></button>' +
      '<button class="mf-mapa__btn" type="button" data-mapa-menos aria-label="Alejar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
      '<path d="M5 12h14"/></svg></button>' +
      '<button class="mf-mapa__btn" type="button" data-centrar aria-label="Mi ubicación">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>';
    contenedor.appendChild(controles);

    var ficha = document.createElement("div");
    ficha.className = "mf-mapa__ficha mf-oculto";
    contenedor.appendChild(ficha);

    var estado = {
      z: 15,
      lat: -33.45,
      lon: -70.66,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      w: 0,
      h: 0,
      arrastrando: false,
      movido: false,
      ultimoX: 0,
      ultimoY: 0,
      inicioX: 0,
      inicioY: 0,
      t0: 0,
      pinch: null,
      seleccion: null,
    };

    var cache = {};
    var locales = Array.isArray(opts.locales) ? opts.locales : [];
    var ubicacion = opts.ubicacion || null;

    /* ── dibujo ─────────────────────────────────────────────────────── */

    function tamano() {
      var r = contenedor.getBoundingClientRect();
      estado.w = Math.max(1, Math.round(r.width));
      estado.h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(estado.w * estado.dpr);
      canvas.height = Math.round(estado.h * estado.dpr);
      canvas.style.width = estado.w + "px";
      canvas.style.height = estado.h + "px";
      ctx.setTransform(estado.dpr, 0, 0, estado.dpr, 0, 0);
    }

    function centroPx() {
      return proyecto(estado.lat, estado.lon, estado.z);
    }

    function aPantalla(lat, lon) {
      var p = proyecto(lat, lon, estado.z);
      var c = centroPx();
      return { x: p.x - c.x + estado.w / 2, y: p.y - c.y + estado.h / 2 };
    }

    function pedirTile(z, x, y) {
      var clave = z + "/" + x + "/" + y;
      if (cache[clave] !== undefined) return cache[clave];
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { cache[clave] = img; dibujar(); };
      img.onerror = function () { cache[clave] = false; };
      img.src = URL_TILE + clave + ".png";
      cache[clave] = null;
      return null;
    }

    function dibujarTeselas() {
      var c = centroPx();
      var izq = c.x - estado.w / 2;
      var arr = c.y - estado.h / 2;
      var x0 = Math.floor(izq / TILE);
      var y0 = Math.floor(arr / TILE);
      var x1 = Math.floor((izq + estado.w) / TILE);
      var y1 = Math.floor((arr + estado.h) / TILE);
      var n = Math.pow(2, estado.z);
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          if (ty < 0 || ty >= n) continue;
          var env = ((tx % n) + n) % n;
          var img = cache[estado.z + "/" + env + "/" + ty];
          if (!img) { pedirTile(estado.z, env, ty); continue; }
          var px = tx * TILE - izq;
          var py = ty * TILE - arr;
          try { ctx.drawImage(img, px, py, TILE, TILE); } catch (e) {}
        }
      }
    }

    function dibujarPin(x, y, activo, color) {
      var r = activo ? 13 : 10;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(0, 2, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -r - 4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.2);
      ctx.lineTo(0, 6);
      ctx.lineTo(r * 0.55, -r * 0.2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#0A1000";
      ctx.beginPath();
      ctx.arc(0, -r - 4, r * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function dibujar() {
      if (!ctx) return;
      var grilla = ctx.createLinearGradient(0, 0, 0, estado.h);
      grilla.addColorStop(0, "#0B0B10");
      grilla.addColorStop(1, "#07070A");
      ctx.fillStyle = grilla;
      ctx.fillRect(0, 0, estado.w, estado.h);

      dibujarTeselas();

      /* Un velo oscuro para que las teselas claras no desentonen. */
      ctx.fillStyle = "rgba(5, 5, 8, 0.34)";
      ctx.fillRect(0, 0, estado.w, estado.h);

      if (ubicacion && ubicacion.lat != null && ubicacion.lon != null) {
        var u = aPantalla(Number(ubicacion.lat), Number(ubicacion.lon));
        ctx.fillStyle = "rgba(10,132,255,0.20)";
        ctx.beginPath();
        ctx.arc(u.x, u.y, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0A84FF";
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(u.x, u.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      locales.forEach(function (l) {
        if (l.lat == null || l.lon == null) return;
        var p = aPantalla(Number(l.lat), Number(l.lon));
        if (p.x < -40 || p.y < -40 || p.x > estado.w + 40 || p.y > estado.h + 40) return;
        var activo = estado.seleccion && estado.seleccion.id === l.id;
        dibujarPin(p.x, p.y, activo, l.abierto === false ? "#FF453A" : "#C8FF00");
      });
    }

    /* ── interacción ────────────────────────────────────────────────── */

    function puntos(ev) {
      var r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function alBajar(ev) {
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      estado.arrastrando = true;
      estado.movido = false;
      estado.ultimoX = ev.clientX;
      estado.ultimoY = ev.clientY;
      estado.inicioX = ev.clientX;
      estado.inicioY = ev.clientY;
      estado.t0 = Date.now();
    }

    function alMover(ev) {
      if (!estado.arrastrando) return;
      var dx = ev.clientX - estado.ultimoX;
      var dy = ev.clientY - estado.ultimoY;
      if (Math.abs(ev.clientX - estado.inicioX) + Math.abs(ev.clientY - estado.inicioY) > 6) {
        estado.movido = true;
      }
      if (!estado.movido) return;
      var c = centroPx();
      var n = Math.pow(2, estado.z) * TILE;
      var cen = desproyecto(c.x - dx, c.y - dy, estado.z);
      estado.lat = Math.max(-85, Math.min(85, cen.lat));
      estado.lon = ((((cen.lon + 180) % 360) + 360) % 360) - 180;
      estado.ultimoX = ev.clientX;
      estado.ultimoY = ev.clientY;
      dibujar();
    }

    function alSoltar(ev) {
      if (!estado.arrastrando) return;
      estado.arrastrando = false;
      if (estado.movido || Date.now() - estado.t0 > 500) return;
      var p = puntos(ev);
      var mejor = null;
      var mejorD = 34;
      locales.forEach(function (l) {
        if (l.lat == null || l.lon == null) return;
        var q = aPantalla(Number(l.lat), Number(l.lon));
        var d = Math.sqrt(Math.pow(q.x - p.x, 2) + Math.pow(q.y - (p.y + 6), 2));
        if (d < mejorD) { mejorD = d; mejor = l; }
      });
      if (mejor) elegir(mejor);
    }

    function zoom(delta) {
      estado.z = Math.max(MIN_Z, Math.min(MAX_Z, estado.z + delta));
      dibujar();
    }

    function elegir(l) {
      estado.seleccion = l;
      dibujar();
      if (typeof opts.alElegir === "function") opts.alElegir(l);
      pintarFicha(l);
    }

    function pintarFicha(l) {
      if (!l) { ficha.classList.add("mf-oculto"); return; }
      ficha.classList.remove("mf-oculto");
      ficha.innerHTML =
        "<b>" + (l.nombre || "Local") + "</b>" +
        "<small>" + [l.rubro, l.direccion || l.comuna, l.abierto === false ? "Cerrado" : "Abierto"]
          .filter(Boolean).join(" · ") + "</small>" +
        '<button class="mf-btn mf-btn--pri mf-btn--sm" type="button">Ver productos</button>';
      var b = ficha.querySelector("button");
      if (b) b.onclick = function () {
        if (typeof opts.alVerCatalogo === "function") opts.alVerCatalogo(l);
      };
    }

    function alRueda(ev) {
      ev.preventDefault();
      zoom(ev.deltaY < 0 ? 0.35 : -0.35);
    }

    /* Dos dedos: pellizcar para acercar/alejar. */
    var activos = {};
    function alToque(ev) {
      if (ev.pointerType !== "touch") return;
      activos[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(activos);
      if (ids.length === 2) {
        var a = activos[ids[0]];
        var b = activos[ids[1]];
        estado.pinch = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
        estado.arrastrando = false;
      }
    }
    function alToqueMover(ev) {
      if (ev.pointerType !== "touch" || !activos[ev.pointerId]) return;
      activos[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(activos);
      if (ids.length === 2 && estado.pinch) {
        var a = activos[ids[0]];
        var b = activos[ids[1]];
        var d = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
        if (Math.abs(d - estado.pinch) > 24) {
          zoom(d > estado.pinch ? 0.5 : -0.5);
          estado.pinch = d;
        }
      }
    }
    function alToqueFin(ev) {
      delete activos[ev.pointerId];
      if (Object.keys(activos).length < 2) estado.pinch = null;
    }

    canvas.addEventListener("pointerdown", alBajar);
    canvas.addEventListener("pointermove", alMover);
    canvas.addEventListener("pointerup", alSoltar);
    canvas.addEventListener("pointercancel", alSoltar);
    canvas.addEventListener("wheel", alRueda, { passive: false });
    canvas.addEventListener("pointerdown", alToque);
    canvas.addEventListener("pointermove", alToqueMover);
    canvas.addEventListener("pointerup", alToqueFin);
    canvas.addEventListener("pointercancel", alToqueFin);

    controles.querySelector("[data-mapa-mas]").onclick = function () { zoom(0.6); };
    controles.querySelector("[data-mapa-menos]").onclick = function () { zoom(-0.6); };
    controles.querySelector("[data-centrar]").onclick = function () {
      if (ubicacion && ubicacion.lat != null) {
        estado.lat = Number(ubicacion.lat);
        estado.lon = Number(ubicacion.lon);
        estado.z = 15;
        dibujar();
      } else if (typeof opts.alCentrar === "function") {
        opts.alCentrar();
      }
    };

    function alRedimensionar() { tamano(); dibujar(); }
    window.addEventListener("resize", alRedimensionar);

    /* ── arranque ───────────────────────────────────────────────────── */

    tamano();
    if (ubicacion && ubicacion.lat != null) {
      estado.lat = Number(ubicacion.lat);
      estado.lon = Number(ubicacion.lon);
    } else if (locales.length) {
      var con = locales.filter(function (l) { return l.lat != null; })[0];
      if (con) { estado.lat = Number(con.lat); estado.lon = Number(con.lon); }
    }
    dibujar();

    return {
      redibujar: function () { dibujar(); },
      destruir: function () {
        window.removeEventListener("resize", alRedimensionar);
        canvas.remove(); creditos.remove(); controles.remove(); ficha.remove();
      },
      centrar: function (lat, lon, z) {
        if (lat != null) estado.lat = Number(lat);
        if (lon != null) estado.lon = Number(lon);
        if (z != null) estado.z = Math.max(MIN_Z, Math.min(MAX_Z, z));
        dibujar();
      },
      setUbicacion: function (u) { ubicacion = u; if (u) { estado.lat = Number(u.lat); estado.lon = Number(u.lon); } dibujar(); },
      setLocales: function (l) { locales = l || []; dibujar(); },
    };
  }

  window.MercaMapa = { montar: montar };
})();