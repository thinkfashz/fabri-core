/* MercaFabrick · mapa interactivo (mapa.js)
   --------------------------------------------------------------------------
   Mapa oscuro estilo CARTO + Leaflet, con:
     · capas (locales, mi ubicación, ruta)
     · acercar / alejar / centrar
     · GPS en vivo (watchPosition) y coordenadas al día
     · tiempo de recorrido estimado a pie y en auto
     · selección de local con ficha y botón «Ver productos»
     · modo 3D (perspectiva) para mirar el mapa inclinado

   API:
     MercaMapa.montar(contenedor, {
       locales, ubicacion, alElegir, alVerCatalogo
     }) -> { destruir, centrar, setUbicacion, setLocales, modo3D }

   Por qué Leaflet: maneja teselas, capas, marcadores y zoom con un peso bajo
   (147 KB) y sin claves. Las teselas son oscuras (CARTO dark_all).
   -------------------------------------------------------------------------- */

(function () {
  "use strict";

  var TILE_URL = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  var CREDITO = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &copy; CARTO';

  function montar(contenedor, opts) {
    if (!contenedor || typeof L === "undefined") return null;
    opts = opts || {};

    var locales = Array.isArray(opts.locales) ? opts.locales : [];
    var ubicacion = opts.ubicacion || null;

    /* ── construcciones auxiliares ─────────────────────────────────── */
    function haversine(a, b) {
      var R = 6371;
      var dLat = ((b.lat - a.lat) * Math.PI) / 180;
      var dLon = ((b.lon - a.lon) * Math.PI) / 180;
      var la1 = (a.lat * Math.PI) / 180;
      var la2 = (b.lat * Math.PI) / 180;
      var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * R * Math.asin(Math.sqrt(h));
    }

    function minutos(km) {
      var aPie = Math.round((km / 4.8) * 60);
      var auto = Math.round((km / 28) * 60) + 2;
      return { pie: Math.max(1, aPie), auto: Math.max(2, auto) };
    }

    function conCoordenadas(l) {
      return l && l.lat != null && l.lon != null && isFinite(Number(l.lat)) && isFinite(Number(l.lon));
    }

    /* ── mapa ──────────────────────────────────────────────────────── */
    var centro = ubicacion && conCoordenadas(ubicacion)
      ? [Number(ubicacion.lat), Number(ubicacion.lon)]
      : (function () {
          var c = locales.filter(conCoordenadas)[0];
          return c ? [Number(c.lat), Number(c.lon)] : [-33.45, -70.66];
        })();

    /* Lienzo interno: es lo que se inclina en modo 3D, así los controles y
       la ficha no se deforman. */
    var lienzo = document.createElement("div");
    lienzo.className = "mf-mapa__lienzo";
    contenedor.appendChild(lienzo);

    var map = L.map(lienzo, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 19,
    }).setView(centro, 15);

    var capas = L.tileLayer(TILE_URL, {
      subdomains: "abcd",
      maxZoom: 20,
      detectRetina: true,
      opacity: 0.92,
    }).addTo(map);

    /* Crédito propio (atención: las teselas son de OSM/CARTO). */
    var credito = L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);
    credito.addAttribution(CREDITO);

    /* ── estilos de marcadores ─────────────────────────────────────── */
    var ICONO_TIENDA = L.divIcon({
      className: "mf-pin-wrap",
      html: '<span class="mf-pin mf-pin--tienda"><i></i></span>',
      iconSize: [30, 38],
      iconAnchor: [15, 34],
    });
    var ICONO_CERRADO = L.divIcon({
      className: "mf-pin-wrap",
      html: '<span class="mf-pin mf-pin--cerrado"><i></i></span>',
      iconSize: [30, 38],
      iconAnchor: [15, 34],
    });

    var grupoLocales = L.layerGroup().addTo(map);
    var grupoRuta = L.layerGroup().addTo(map);
    var marcadorUsuario = null;
    var circuloUsuario = null;
    var seleccion = null;
    var modo3D = false;

    function pintarLocales() {
      grupoLocales.clearLayers();
      locales.forEach(function (l) {
        if (!conCoordenadas(l)) return;
        var m = L.marker([Number(l.lat), Number(l.lon)], {
          icon: l.abierto === false ? ICONO_CERRADO : ICONO_TIENDA,
          keyboard: false,
          title: l.nombre || "Local",
        }).addTo(grupoLocales);
        m.on("click", function () { elegir(l); });
      });
    }

    function pintarUsuario() {
      if (marcadorUsuario) { map.removeLayer(marcadorUsuario); marcadorUsuario = null; }
      if (circuloUsuario) { map.removeLayer(circuloUsuario); circuloUsuario = null; }
      if (!ubicacion || !conCoordenadas(ubicacion)) return;
      var p = [Number(ubicacion.lat), Number(ubicacion.lon)];
      circuloUsuario = L.circle(p, {
        radius: 26, color: "#0A84FF", weight: 1, fillColor: "#0A84FF", fillOpacity: 0.18,
      }).addTo(map);
      marcadorUsuario = L.circleMarker(p, {
        radius: 7, color: "#fff", weight: 2.5, fillColor: "#0A84FF", fillOpacity: 1,
      }).addTo(map);
    }

    /* ── ficha del local ───────────────────────────────────────────── */
    var ficha = document.createElement("div");
    ficha.className = "mf-mapa__ficha mf-oculto";
    contenedor.appendChild(ficha);

    function pintarFicha(l) {
      if (!l) { ficha.classList.add("mf-oculto"); return; }
      var km = (ubicacion && conCoordenadas(ubicacion)) ? haversine(ubicacion, l) : null;
      var t = km != null ? minutos(km) : null;
      var datos = [
        l.rubro || "Local",
        l.direccion || l.comuna || "",
        l.abierto === false ? "Cerrado" : "Abierto",
      ].filter(Boolean).join(" · ");

      ficha.classList.remove("mf-oculto");
      ficha.innerHTML =
        "<b>" + (l.nombre || "Local") + "</b>" +
        "<small>" + datos + "</small>" +
        (t ? '<div class="mf-mapa__tiempos">' +
          "<span>" + (km).toFixed(1) + " km</span>" +
          "<span>" + t.pie + " min a pie</span>" +
          "<span>" + t.auto + " min auto</span></div>" : "") +
        '<div class="mf-mapa__acciones">' +
        '<button class="mf-btn mf-btn--pri mf-btn--sm" type="button" data-ver>Ver productos</button>' +
        '<button class="mf-btn mf-btn--sm" type="button" data-ruta>Ruta</button>' +
        "</div>";

      ficha.querySelector("[data-ver]").onclick = function () {
        if (typeof opts.alVerCatalogo === "function") opts.alVerCatalogo(l);
      };
      ficha.querySelector("[data-ruta]").onclick = function () { trazarRuta(l); };
    }

    function trazarRuta(l) {
      grupoRuta.clearLayers();
      if (!ubicacion || !conCoordenadas(ubicacion) || !conCoordenadas(l)) return;
      var a = [Number(ubicacion.lat), Number(ubicacion.lon)];
      var b = [Number(l.lat), Number(l.lon)];
      L.polyline([a, b], {
        color: "#C8FF00", weight: 3.5, opacity: 0.95, dashArray: "7 9", lineCap: "round",
      }).addTo(grupoRuta);
      map.fitBounds(L.latLngBounds([a, b]).pad(0.35), { animate: true });
    }

    function elegir(l) {
      seleccion = l;
      pintarFicha(l);
      if (typeof opts.alElegir === "function") opts.alElegir(l);
    }

    /* ── controles ─────────────────────────────────────────────────── */
    var controles = document.createElement("div");
    controles.className = "mf-mapa__controles";
    controles.innerHTML =
      '<button class="mf-mapa__btn" type="button" data-mas aria-label="Acercar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
      '<button class="mf-mapa__btn" type="button" data-menos aria-label="Alejar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/></svg></button>' +
      '<button class="mf-mapa__btn" type="button" data-centrar aria-label="Mi ubicación">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button>' +
      '<button class="mf-mapa__btn mf-mapa__btn--3d" type="button" data-3d aria-label="Vista 3D" aria-pressed="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' +
      '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg></button>';
    contenedor.appendChild(controles);

    /* Capas */
    var capasBox = document.createElement("div");
    capasBox.className = "mf-mapa__capas";
    capasBox.innerHTML =
      '<label><input type="checkbox" data-capa="locales" checked> Locales</label>' +
      '<label><input type="checkbox" data-capa="usuario" checked> Mi ubicación</label>' +
      '<label><input type="checkbox" data-capa="ruta" checked> Ruta</label>';
    contenedor.appendChild(capasBox);

    /* Coordenadas */
    var coords = document.createElement("div");
    coords.className = "mf-mapa__coords";
    contenedor.appendChild(coords);

    function pintarCoords() {
      var c = map.getCenter();
      coords.textContent = c.lat.toFixed(5) + ", " + c.lng.toFixed(5) + " · z" + map.getZoom();
    }
    map.on("move zoom", pintarCoords);

    controles.querySelector("[data-mas]").onclick = function () { map.zoomIn(); };
    controles.querySelector("[data-menos]").onclick = function () { map.zoomOut(); };
    controles.querySelector("[data-centrar]").onclick = function () {
      if (ubicacion && conCoordenadas(ubicacion)) map.setView([Number(ubicacion.lat), Number(ubicacion.lon)], 16, { animate: true });
      else if (typeof opts.alCentrar === "function") opts.alCentrar();
    };
    controles.querySelector("[data-3d]").onclick = function () {
      modo3D = !modo3D;
      contenedor.classList.toggle("mf-mapa--3d", modo3D);
      this.setAttribute("aria-pressed", modo3D ? "true" : "false");
      setTimeout(function () { map.invalidateSize(); }, 320);
    };

    capasBox.addEventListener("change", function (ev) {
      var k = ev.target && ev.target.dataset ? ev.target.dataset.capa : "";
      if (!ev.target.checked) {
        if (k === "locales") map.removeLayer(grupoLocales);
        if (k === "ruta") map.removeLayer(grupoRuta);
        if (k === "usuario") {
          if (marcadorUsuario) map.removeLayer(marcadorUsuario);
          if (circuloUsuario) map.removeLayer(circuloUsuario);
        }
      } else {
        if (k === "locales") grupoLocales.addTo(map);
        if (k === "ruta") grupoRuta.addTo(map);
        if (k === "usuario") pintarUsuario();
      }
    });

    /* ── GPS en vivo ───────────────────────────────────────────────── */
    var relojGps = null;
    function iniciarGps() {
      if (!navigator.geolocation) return;
      try {
        relojGps = navigator.geolocation.watchPosition(function (pos) {
          ubicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          pintarUsuario();
          if (seleccion) pintarFicha(seleccion);
        }, function () {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      } catch (e) { relojGps = null; }
    }

    /* ── arranque ──────────────────────────────────────────────────── */
    pintarLocales();
    pintarUsuario();
    pintarCoords();
    iniciarGps();

    var ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(function () { map.invalidateSize(); });
      ro.observe(contenedor);
    }

    return {
      destruir: function () {
        try { if (relojGps != null && navigator.geolocation) navigator.geolocation.clearWatch(relojGps); } catch (e) {}
        if (ro) { try { ro.disconnect(); } catch (e) {} }
        try { map.remove(); } catch (e) {}
        ficha.remove(); controles.remove(); capasBox.remove(); coords.remove();
      },
      centrar: function (lat, lon, z) {
        if (lat != null && lon != null) map.setView([Number(lat), Number(lon)], z || 15, { animate: true });
      },
      setUbicacion: function (u) {
        ubicacion = u;
        pintarUsuario();
        if (u && conCoordenadas(u)) map.setView([Number(u.lat), Number(u.lon)], 16, { animate: true });
      },
      setLocales: function (l) { locales = l || []; pintarLocales(); },
      modo3D: function (on) {
        modo3D = on !== false;
        contenedor.classList.toggle("mf-mapa--3d", modo3D);
        setTimeout(function () { map.invalidateSize(); }, 320);
      },
      mapa: map,
    };
  }

  window.MercaMapa = { montar: montar };
})();