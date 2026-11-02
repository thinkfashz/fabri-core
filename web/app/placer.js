/* ============================================================================
   MERCADOPLACER · mercados cerca de ti
   ----------------------------------------------------------------------------
   · Mapa real (Leaflet + teselas de OpenStreetMap/CARTO y Esri)
   · Posición en vivo con `watchPosition` (no una foto del momento)
   · Locales cercanos desde OpenStreetMap vía /api/mercados (Overpass)
   · Al tocar un local se abre su catálogo, con carrito y pedido por WhatsApp

   Honestidad de los datos:
     - El local, su dirección y su horario vienen de OpenStreetMap (ODbL).
     - El catálogo de cada local es REFERENCIAL: se arma con el rubro del local
       y precios de referencia chilenos. Ningún supermercado publica su catálogo
       en OSM, así que la app lo dice en pantalla en vez de fingir que es real.
     - Si no hay red, se muestra una muestra local marcada como «muestra».
   ========================================================================== */

window.Placer = (function () {
  "use strict";

  const API = "/api/mercados";
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const CLAVE_CARRITO = "fcore.placer.carrito";
  const CLAVE_RADIO = "fcore.placer.radio";

  /* Santiago centro: solo se usa si el usuario niega la ubicación o el
     dispositivo no la entrega. Siempre se avisa en pantalla. */
  const RESPALDO = { lat: -33.4489, lon: -70.6693, nombre: "Santiago centro" };

  const ESTADO = {
    mapa: null,
    capa: null,
    modo: "calles",
    marcadores: [],
    usuario: null,
    precision: null,
    pos: null,
    mercados: [],
    filtro: "",
    radio: Number(localStorage.getItem(CLAVE_RADIO) || 1500),
    cargando: false,
    viendo: null,
    modoUbi: "esperando",
    carrito: leerCarrito()
  };

  /* ── utilidades ─────────────────────────────────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clp(n) {
    return "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
  }

  function distancia(m) {
    if (m == null) return "—";
    if (m < 950) return Math.round(m / 10) * 10 + " m";
    return (m / 1000).toFixed(1).replace(".", ",") + " km";
  }

  /* Generador determinista: el mismo local siempre muestra los mismos precios,
     así el catálogo no cambia al recargar (sería desconcertante). */
  function azar(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function leerCarrito() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "{}") || {}; } catch (e) { return {}; }
  }
  function guardarCarrito() {
    try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify(ESTADO.carrito)); } catch (e) { /* modo privado */ }
  }

  /* ── iconos ─────────────────────────────────────────────────────────────── */
  const ICO = {
    supermercado: '<path d="M3 9h18l-1.6 10H4.6L3 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
    almacen: '<path d="M4 9h16l-1.2 10H5.2L4 9Z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>',
    verduleria: '<path d="M12 20c-4 0-7-3-7-7 0-3 2-5 4-5 1.6 0 2.2.8 3 .8s1.4-.8 3-.8c2 0 4 2 4 5 0 4-3 7-7 7Z"/><path d="M12 8c0-2 1.2-4 3-4"/>',
    carniceria: '<path d="M14 3a7 7 0 0 1 7 7c0 4-3 5-5 7l-4 4-3-3 3-3-4-4-3 3-3-3 4-4c2-2 4-4 8-4Z"/>',
    panaderia: '<path d="M4 12c0-4 3.5-7 8-7s8 3 8 7c0 2-1 3-1 5H5c0-2-1-3-1-5Z"/><path d="M9 12v5M15 12v5"/>',
    feria: '<path d="M3 9h18"/><path d="M4 9 6 4h12l2 5"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
    pescaderia: '<path d="M3 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z"/><circle cx="15" cy="12" r="1.2"/>',
    botilleria: '<path d="M9 3h6v5l2 3v10H7V11l2-3V3Z"/><path d="M7 12h10"/>',
    fiambreria: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
    dietetica: '<path d="M12 21c-5 0-8-3-8-8 0-5 4-9 8-10 4 1 8 5 8 10 0 5-3 8-8 8Z"/><path d="M12 3v18"/>',
    granja: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    lacteos: '<path d="M8 3h8l1 5-2 2v9a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-9L7 8l1-5Z"/><path d="M7 8h10"/>',
    mayorista: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    mall: '<path d="M3 9h18l-1.6 10H4.6L3 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/><path d="M9 13h6"/>',
    tienda: '<path d="M4 21V8l8-4 8 4v13"/><path d="M9 21v-6h6v6"/>'
  };
  function icono(clave, tam) {
    const d = ICO[clave] || ICO.tienda;
    return '<svg viewBox="0 0 24 24" width="' + (tam || 18) + '" height="' + (tam || 18) + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

  /* ── catálogo referencial ──────────────────────────────────────────────── */
  const BASE = {
    supermercado: [
      ["Arroz grado 1 · 1 kg", 1690], ["Aceite vegetal · 900 ml", 2450], ["Harina sin polvos · 1 kg", 1190],
      ["Leche entera · 1 L", 1290], ["Azúcar · 1 kg", 1490], ["Fideos spaghetti · 400 g", 890],
      ["Huevos colorados · 12 u", 3290], ["Pan de molde · 550 g", 2190], ["Café molido · 170 g", 3790],
      ["Té en saquitos · 20 u", 1690], ["Detergente · 750 ml", 2890], ["Papel higiénico · 4 u", 2790],
      ["Bebida cola · 1,5 L", 1890], ["Agua mineral · 1,5 L", 990], ["Atún en agua · 160 g", 1290]
    ],
    almacen: [
      ["Pan corriente · 1 kg", 1990], ["Leche entera · 1 L", 1250], ["Huevos · 12 u", 3190],
      ["Arroz · 1 kg", 1590], ["Fideos · 400 g", 850], ["Aceite · 900 ml", 2390],
      ["Azúcar · 1 kg", 1450], ["Bebida · 1,5 L", 1790], ["Cerveza lata · 470 ml", 1290],
      ["Papel higiénico · 4 u", 2690], ["Velas · 4 u", 990], ["Carbón · 3 kg", 3990]
    ],
    verduleria: [
      ["Tomate · 1 kg", 1490], ["Papa · 1 kg", 990], ["Cebolla · 1 kg", 1090],
      ["Zanahoria · 1 kg", 950], ["Palta Hass · 1 kg", 3990], ["Plátano · 1 kg", 1290],
      ["Manzana roja · 1 kg", 1690], ["Lechuga costina · 1 u", 790], ["Limón · 1 kg", 1590],
      ["Frutilla · 500 g", 2490], ["Pimiento · 1 kg", 1890], ["Choclo · 2 u", 1190]
    ],
    carniceria: [
      ["Pollo entero · 1 kg", 4990], ["Pechuga de pollo · 1 kg", 6490], ["Carne molida 5% · 1 kg", 7990],
      ["Lomo vetado · 1 kg", 13990], ["Plateada · 1 kg", 10990], ["Cerdo pulpa · 1 kg", 6990],
      ["Chorizo parrillero · 6 u", 4490], ["Costillar de cerdo · 1 kg", 7490]
    ],
    panaderia: [
      ["Marraqueta · 1 kg", 1990], ["Hallulla · 1 kg", 2190], ["Baguette · 1 u", 990],
      ["Pan integral · 800 g", 2790], ["Empanada de pino · 1 u", 1690], ["Torta de milhojas · 1 u", 8990],
      ["Kuchen de manzana · 1 u", 6990], ["Galletas surtidas · 500 g", 2990]
    ],
    feria: [
      ["Tomate · 1 kg", 1290], ["Papa · 1 kg", 890], ["Cebolla · 1 kg", 990],
      ["Palta · 1 kg", 3690], ["Frutilla · 500 g", 2190], ["Malla de naranjas · 3 kg", 3490],
      ["Huevos de campo · 30 u", 6990], ["Miel de ulmo · 1 kg", 8990], ["Queso de campo · 500 g", 5490]
    ],
    pescaderia: [
      ["Reineta · 1 kg", 6990], ["Merluza · 1 kg", 7490], ["Salmón · 1 kg", 12990],
      ["Camarón pelado · 500 g", 8990], ["Choritos · 1 kg", 4990], ["Machas · 500 g", 9990]
    ],
    botilleria: [
      ["Cerveza · 6 x 470 ml", 6990], ["Vino tinto · 750 ml", 4990], ["Pisco · 700 ml", 9990],
      ["Bebida cola · 1,5 L", 1890], ["Hielo · 2 kg", 1990], ["Jugo natural · 1 L", 2490],
      ["Espumante · 750 ml", 7990]
    ],
    fiambreria: [
      ["Jamón artesanal · 250 g", 4290], ["Queso mantecoso · 250 g", 3890], ["Salame · 250 g", 4590],
      ["Mortadela · 250 g", 2490], ["Aceitunas · 250 g", 2290], ["Pan de campo · 1 u", 1990]
    ],
    dietetica: [
      ["Avena integral · 1 kg", 2490], ["Frutos secos · 500 g", 5990], ["Quinoa · 500 g", 3490],
      ["Miel · 500 g", 4990], ["Té de hierbas · 20 u", 2490], ["Semillas de chía · 250 g", 2990],
      ["Leche de almendras · 1 L", 3290]
    ],
    lacteos: [
      ["Leche entera · 1 L", 1190], ["Yogur natural · 1 kg", 2790], ["Queso fresco · 500 g", 4990],
      ["Mantequilla · 250 g", 3290], ["Crema · 200 ml", 2190], ["Manjar · 500 g", 3490]
    ],
    mayorista: [
      ["Arroz · 10 kg", 14990], ["Aceite · 5 L", 11990], ["Harina · 10 kg", 9990],
      ["Azúcar · 10 kg", 12990], ["Fideos · 5 kg", 7990], ["Conservas · 12 u", 15990]
    ],
    granja: [
      ["Huevos de campo · 30 u", 6990], ["Pollo de campo · 1 kg", 7990], ["Queso de campo · 500 g", 5490],
      ["Miel pura · 1 kg", 8990], ["Verduras de estación · 3 kg", 5990]
    ],
    mall: [
      ["Café en grano · 250 g", 5990], ["Audífonos inalámbricos", 19990], ["Polera básica", 9990],
      ["Zapatillas urbanas", 39990], ["Perfume · 100 ml", 29990], ["Cargador rápido · 20 W", 12990]
    ],
    tienda: [
      ["Bebida · 1,5 L", 1890], ["Snack · 180 g", 1990], ["Pilas AA · 4 u", 3990],
      ["Cargador USB-C", 7990], ["Cuaderno universitario", 2490], ["Lápiz pasta · 3 u", 1290]
    ]
  };

  function productos(m) {
    const base = BASE[m.ico] || BASE.tienda || BASE.almacen;
    const semilla = m.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return base.map(function (par, i) {
      const factor = 0.92 + azar(semilla + i * 7.7) * 0.24;   // ±12 %
      const precio = Math.round((par[1] * factor) / 10) * 10;
      return {
        id: m.id + "#" + i,
        nombre: par[0],
        precio: precio,
        stock: 4 + Math.floor(azar(semilla + i * 3.1) * 36)
      };
    });
  }

  /* ── carrito ───────────────────────────────────────────────────────────── */
  function carritoDe(id) {
    if (!ESTADO.carrito[id]) ESTADO.carrito[id] = { nombre: "", items: {} };
    return ESTADO.carrito[id];
  }
  function unidades(id) {
    const c = ESTADO.carrito[id];
    if (!c) return 0;
    return Object.values(c.items).reduce((a, b) => a + b, 0);
  }
  function itemsDe(m) {
    const c = ESTADO.carrito[m.id];
    if (!c) return [];
    const bolsa = productos(m);
    return Object.keys(c.items)
      .map((pid) => {
        const p = bolsa.find((x) => x.id === pid);
        return p ? { ...p, cantidad: c.items[pid] } : null;
      })
      .filter(Boolean);
  }
  function totalDe(m) {
    return itemsDe(m).reduce((a, p) => a + p.precio * p.cantidad, 0);
  }
  function cambiar(m, pid, delta) {
    const c = carritoDe(m.id);
    const nuevo = (c.items[pid] || 0) + delta;
    if (nuevo <= 0) delete c.items[pid]; else c.items[pid] = nuevo;
    if (!Object.keys(c.items).length) delete ESTADO.carrito[m.id];
    guardarCarrito();
    pintarHoja();
  }

  /* ── ubicación ─────────────────────────────────────────────────────────── */
  function textoUbicacion() {
    const p = ESTADO.pos;
    if (!p) return "Sin ubicación todavía";
    if (ESTADO.modoUbi === "real") {
      return "Tu ubicación · ±" + Math.round(p.precision || 0) + " m";
    }
    return "Ubicación de referencia: " + p.nombre;
  }

  function pintarEstado() {
    const live = $("mpLive");
    const txt = $("mpUbiTexto");
    if (txt) txt.textContent = textoUbicacion();
    if (live) {
      live.className = "mp-live " + (ESTADO.modoUbi === "real" ? "ok" : ESTADO.modoUbi === "negada" ? "warn" : "");
      live.innerHTML = "<i></i>" + (ESTADO.modoUbi === "real" ? "en vivo" : ESTADO.modoUbi === "negada" ? "referencia" : "ubicando");
    }
  }

  function marcarUsuario(p) {
    if (!ESTADO.mapa) return;
    const punto = [p.lat, p.lon];
    if (!ESTADO.usuario) {
      ESTADO.usuario = L.marker(punto, {
        icon: L.divIcon({ className: "mp-yo", html: '<span class="mp-yo-halo"></span><span class="mp-yo-punto"></span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        interactive: false, zIndexOffset: 900
      }).addTo(ESTADO.mapa);
      ESTADO.precision = L.circle(punto, {
        radius: p.precision || 40, color: "#c8ff00", weight: 1, opacity: .5,
        fillColor: "#c8ff00", fillOpacity: .07, interactive: false
      }).addTo(ESTADO.mapa);
    } else {
      ESTADO.usuario.setLatLng(punto);
      ESTADO.precision.setLatLng(punto);
      ESTADO.precision.setRadius(Math.max(25, p.precision || 40));
    }
  }

  function ubicar(centrar) {
    ESTADO.modoUbi = "esperando";
    pintarEstado();
    if (!navigator.geolocation) {
      usarRespaldo("Este navegador no entrega ubicación");
      return;
    }
    const opciones = { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 };

    // Primera lectura: ubica el mapa rápido.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        aplicarPosicion(pos, true);
        if (ESTADO.mapa && (centrar || !ESTADO.mercados.length)) {
          ESTADO.mapa.setView([pos.coords.latitude, pos.coords.longitude], 16, { animate: true });
        }
        cargar();
      },
      (err) => {
        usarRespaldo(err && err.code === 1
          ? "No diste permiso de ubicación"
          : "No se pudo obtener tu ubicación");
        cargar();
      },
      opciones
    );

    // Y se queda escuchando: la marca se mueve en tiempo real.
    if (ESTADO.vigia == null) {
      ESTADO.vigia = navigator.geolocation.watchPosition(
        (pos) => aplicarPosicion(pos, false),
        () => { /* el error ya se explicó en la primera lectura */ },
        opciones
      );
    }
  }

  function aplicarPosicion(pos, primera) {
    const antes = ESTADO.pos;
    ESTADO.pos = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy };
    ESTADO.modoUbi = "real";
    marcarUsuario(ESTADO.pos);
    pintarEstado();
    if (!primera && antes) {
      // Si se movió más de 150 m, los cercanos cambiaron: se refrescan solos.
      const d = metrosc(antes.lat, antes.lon, ESTADO.pos.lat, ESTADO.pos.lon);
      if (d > 150) cargar(true);
    }
  }

  function usarRespaldo(motivo) {
    ESTADO.pos = { lat: RESPALDO.lat, lon: RESPALDO.lon, precision: 0, nombre: RESPALDO.nombre };
    ESTADO.modoUbi = "negada";
    marcarUsuario(ESTADO.pos);
    pintarEstado();
    const aviso = $("mpAviso");
    if (aviso) {
      aviso.innerHTML = '<b>' + esc(motivo) + '.</b> Mostrando ' + esc(RESPALDO.nombre) +
        ' y sus mercados. <button type="button" id="mpReintentar">Reintentar</button>';
      const b = $("mpReintentar");
      if (b) b.onclick = () => ubicar(true);
    }
    if (ESTADO.mapa) ESTADO.mapa.setView([RESPALDO.lat, RESPALDO.lon], 15);
  }

  function metrosc(a, b, c, d) {
    const R = 6371000, f1 = a * Math.PI / 180, f2 = c * Math.PI / 180;
    const df = (c - a) * Math.PI / 180, dl = (d - b) * Math.PI / 180;
    const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /* ── datos: API propia → Overpass directo → muestra ────────────────────── */
  async function cargar(silencioso) {
    if (!ESTADO.pos || ESTADO.cargando) return;
    ESTADO.cargando = true;
    if (!silencioso) pintarCargando();
    const { lat, lon } = ESTADO.pos;
    const radio = ESTADO.radio;
    let lista = null, origen = "";

    // `?demo=1` salta la red y muestra los locales de referencia. Sirve para
    // revisar la interfaz sin depender de Overpass (que se satura seguido).
    if (new URLSearchParams(location.search).get("demo") === "1") {
      ESTADO.cargando = false;
      ESTADO.mercados = muestra(lat, lon);
      ESTADO.origen = "muestra";
      pintarLeyenda("muestra", ESTADO.mercados.length);
      pintarMapa(); pintarLista();
      return;
    }

    try {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), 22000);
      const r = await fetch(API + "?lat=" + lat.toFixed(5) + "&lon=" + lon.toFixed(5) + "&r=" + radio,
        { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(reloj);
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.mercados)) { lista = d.mercados; origen = "api"; }
      else if (d && d.error) origen = d.error;
    } catch (e) { origen = "api"; }

    if (!lista) {
      try {
        lista = await overpassDirecto(lat, lon, radio);
        origen = "overpass";
      } catch (e) { lista = null; }
    }

    if (!lista) {
      lista = muestra(lat, lon);
      origen = "muestra";
    }

    ESTADO.origen = origen;
    ESTADO.mercados = lista;
    ESTADO.cargando = false;
    pintarLeyenda(origen, lista.length);
    pintarMapa();
    pintarLista();
  }

  const ESPEJOS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.jp/api/interpreter"
  ];

  // En paralelo: el primero que conteste gana. En serie, con un espejo caído,
  // la espera se hacía insoportable en datos móviles.
  async function overpassDirecto(lat, lon, radio) {
    try {
      return await Promise.any(ESPEJOS.map((e) => unOverpass(e, lat, lon, radio)));
    } catch (e) {
      throw new Error("Overpass no respondió");
    }
  }

  async function unOverpass(base, lat, lon, radio) {
    const q = '[out:json][timeout:16];(' +
      'nwr["shop"~"^(supermarket|convenience|grocery|general|greengrocer|butcher|bakery|deli|seafood|beverages|alcohol|health_food|farm|dairy|wholesale|mall|department_store)$"](around:' + radio + ',' + lat + ',' + lon + ');' +
      'nwr["amenity"="marketplace"](around:' + radio + ',' + lat + ',' + lon + ');' +
      ');out center tags 80;';
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 11000);
    const r = await fetch(base, {
      method: "POST",
      body: new URLSearchParams({ data: q }),
      signal: ctrl.signal
    });
    clearTimeout(reloj);
    if (!r.ok) throw new Error("overpass " + r.status);
    const d = await r.json();
    const RUBROS = {
      supermarket: ["Supermercado", "supermercado"], convenience: ["Almacén", "almacen"],
      grocery: ["Almacén", "almacen"], general: ["Almacén", "almacen"],
      greengrocer: ["Verdulería", "verduleria"], butcher: ["Carnicería", "carniceria"],
      bakery: ["Panadería", "panaderia"], deli: ["Fiambrería", "fiambreria"],
      seafood: ["Pescadería", "pescaderia"], beverages: ["Botillería", "botilleria"],
      alcohol: ["Botillería", "botilleria"], health_food: ["Dietética", "dietetica"],
      farm: ["Granja", "granja"], dairy: ["Lácteos", "lacteos"],
      wholesale: ["Mayorista", "mayorista"], mall: ["Centro comercial", "mall"],
      department_store: ["Tienda", "tienda"], marketplace: ["Feria", "feria"]
    };
    const out = [];
    (d.elements || []).forEach((el) => {
      const t = el.tags || {};
      const tipo = t.amenity === "marketplace" ? "marketplace" : t.shop;
      if (!tipo) return;
      const la = el.lat || (el.center && el.center.lat);
      const lo = el.lon || (el.center && el.center.lon);
      if (!la || !lo) return;
      // Un local sin nombre ni dirección no se puede visitar: ocupa lugar.
      if (!(t.name || "").trim() && !(t["addr:street"] || "").trim()) return;
      const rub = RUBROS[tipo] || ["Local", "tienda"];
      out.push({
        id: el.type + "/" + el.id,
        nombre: (t.name || "").trim() ||
        (t["addr:street"] ? rub[0] + " en " + t["addr:street"] : rub[0] + " sin nombre"),
        tipo: tipo, rubro: rub[0], ico: rub[1],
        lat: la, lon: lo,
        dist: Math.round(metrosc(lat, lon, la, lo)),
        direccion: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "),
        comuna: t["addr:city"] || t["addr:suburb"] || "",
        horario: t.opening_hours || "",
        telefono: t.phone || t["contact:phone"] || t.mobile || "",
        web: t.website || t["contact:website"] || t.facebook || ""
      });
    });
    out.sort((a, b) => a.dist - b.dist);
    if (!out.length) throw new Error("sin resultados");
    return out.slice(0, 60);
  }

  // Muestra de referencia: solo aparece si no hay red ni Overpass. Se rotula
  // como «muestra» en la interfaz para no hacer pasar datos inventados por reales.
  function muestra(lat, lon) {
    const MODELO = [
      ["Supermercado Los Aromos", "supermercado", "Supermercado", 60, -150],
      ["Almacén Doña Rosa", "almacen", "Almacén", -90, 40],
      ["Verdulería La Quinta", "verduleria", "Verdulería", 140, 190],
      ["Panadería El Trigal", "panaderia", "Panadería", 210, -60],
      ["Carnicería San Jorge", "carniceria", "Carnicería", -170, -210],
      ["Botillería La Esquina", "botilleria", "Botillería", 300, 120],
      ["Feria Libre del Barrio", "feria", "Feria", -260, 260],
      ["Pescadería Puerto Sur", "pescaderia", "Pescadería", 420, -330]
    ];
    return MODELO.map((m, i) => {
      // 0.00001° ≈ 1,1 m: se reparten alrededor del punto, no encima.
      const la = lat + m[4] / 111300;
      const lo = lon + m[3] / (111300 * Math.cos(lat * Math.PI / 180));
      return {
        id: "muestra/" + i, nombre: m[0], tipo: m[1], rubro: m[2], ico: m[1],
        lat: la, lon: lo, dist: Math.round(metrosc(lat, lon, la, lo)),
        direccion: "Dirección de referencia", comuna: "", horario: "", telefono: "", web: "",
        muestra: true
      };
    }).sort((a, b) => a.dist - b.dist);
  }

  /* ── mapa ──────────────────────────────────────────────────────────────── */
  /* Teselas abiertas: OpenStreetMap estándar (las oscurece el CSS para que
     encajen con el tema) y Esri World Imagery para la vista con textura.
     Ambas exigen atribución visible: se pinta en la leyenda del mapa. */
  const CAPAS = {
    calles: {
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      opciones: { maxZoom: 19, attribution: "" }
    },
    satelite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      opciones: { maxZoom: 19, attribution: "" }
    }
  };
  const ATRIB = {
    calles: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
    satelite: '<a href="https://www.esri.com" target="_blank" rel="noopener">Imágenes © Esri</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>'
  };

  function montarMapa() {
    const caja = $("mpMapa");
    if (!caja || ESTADO.mapa || !window.L) return;
    const centro = ESTADO.pos ? [ESTADO.pos.lat, ESTADO.pos.lon] : [RESPALDO.lat, RESPALDO.lon];
    ESTADO.mapa = L.map(caja, {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      zoomSnap: 0.5,
      maxBoundsViscosity: 0.6
    }).setView(centro, 16);
    ponerCapa(ESTADO.modo);
    L.control.zoom({ position: "bottomright" }).addTo(ESTADO.mapa);
    ESTADO.mapa.on("zoomend", marcarZoom);
    ESTADO.mapa.on("dragend", () => {
      const c = ESTADO.mapa.getCenter();
      if (ESTADO.pos && metrosc(ESTADO.pos.lat, ESTADO.pos.lon, c.lat, c.lng) > 400) {
        const ley = $("mpLeyenda");
        if (ley && !ley.querySelector("#mpBuscarAqui")) {
          const b = document.createElement("button");
          b.id = "mpBuscarAqui"; b.type = "button";
          b.textContent = "Buscar mercados aquí";
          b.onclick = () => {
            ESTADO.pos = { lat: c.lat, lon: c.lng, precision: ESTADO.pos ? ESTADO.pos.precision : 0, nombre: "este punto" };
            ESTADO.modoUbi = "negada";
            cargar();
          };
          ley.appendChild(b);
        }
      }
    });
    if (ESTADO.pos) marcarUsuario(ESTADO.pos);
  }

  function ponerCapa(modo) {
    const def = CAPAS[modo] || CAPAS.calles;
    if (ESTADO.capa) ESTADO.mapa.removeLayer(ESTADO.capa);
    ESTADO.capa = L.tileLayer(def.url, def.opciones).addTo(ESTADO.mapa);
    const caja = $("mpMapa");
    if (caja) caja.classList.toggle("modo-satelite", modo === "satelite");
    const credito = $("mpCredito");
    if (credito) credito.innerHTML = ATRIB[modo] || ATRIB.calles;
    ESTADO.modo = modo;
  }

  /* Agrupa por celda geográfica según el zoom: en una cuadra puede haber seis
     almacenes y seis pines encima no se pueden tocar. */
  function agrupar(lista) {
    const z = ESTADO.mapa ? ESTADO.mapa.getZoom() : 16;
    if (z >= 18) return lista.map((m) => ({ items: [m], lat: m.lat, lon: m.lon }));
    const celda = z >= 17 ? 0.0007 : z >= 16 ? 0.0014 : 0.0028;
    const grupos = new Map();
    lista.forEach((m) => {
      const k = Math.round(m.lat / celda) + "," + Math.round(m.lon / celda);
      if (!grupos.has(k)) grupos.set(k, { items: [], lat: 0, lon: 0 });
      const g = grupos.get(k);
      g.items.push(m); g.lat += m.lat; g.lon += m.lon;
    });
    return [...grupos.values()].map((g) => ({
      items: g.items, lat: g.lat / g.items.length, lon: g.lon / g.items.length
    }));
  }

  function pintarMapa() {
    if (!ESTADO.mapa) return;
    ESTADO.marcadores.forEach((m) => ESTADO.mapa.removeLayer(m));
    ESTADO.marcadores = [];
    const visibles = filtrados();
    const puntos = [];
    agrupar(visibles).forEach((g) => {
      if (g.items.length > 1) {
        const cerca = g.items[0];
        const mk = L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            className: "mp-pin mp-grupo",
            html: '<span class="mp-pin-cuerpo"><b>' + g.items.length + '</b></span><span class="mp-pin-pata"></span>',
            iconSize: [38, 46], iconAnchor: [19, 42]
          }),
          zIndexOffset: 200
        }).addTo(ESTADO.mapa).on("click", () => {
          ESTADO.mapa.fitBounds(g.items.map((x) => [x.lat, x.lon]), { padding: [40, 40], maxZoom: 18 });
          abrirHoja(cerca);
        });
        ESTADO.marcadores.push(mk);
        puntos.push([g.lat, g.lon]);
        return;
      }
      const m = g.items[0];
      const ico = L.divIcon({
        className: "mp-pin",
        html: '<span class="mp-pin-cuerpo">' + icono(m.ico, 16) + "</span>" +
          '<span class="mp-pin-pata"></span>' +
          '<b class="mp-pin-dist">' + distancia(m.dist) + "</b>",
        iconSize: [30, 40],
        iconAnchor: [15, 36]
      });
      const mk = L.marker([m.lat, m.lon], { icon: ico, riseOnHover: true })
        .addTo(ESTADO.mapa)
        .on("click", () => abrirHoja(m));
      mk._mercado = m;
      ESTADO.marcadores.push(mk);
      puntos.push([m.lat, m.lon]);
    });
    if (ESTADO.pos) puntos.push([ESTADO.pos.lat, ESTADO.pos.lon]);
    marcarZoom();
    if (puntos.length > 1) {
      ESTADO.mapa.fitBounds(puntos, { padding: [34, 34], maxZoom: 17, animate: true });
    }
  }

  function marcarZoom() {
    if (!ESTADO.mapa) return;
    const z = ESTADO.mapa.getZoom();
    const caja = $("mpMapa");
    if (caja) caja.classList.toggle("pines-compactos", z < 16);
  }

  function filtrados() {
    return ESTADO.mercados.filter((m) => !ESTADO.filtro || m.ico === ESTADO.filtro);
  }

  /* ── lista y filtros ───────────────────────────────────────────────────── */
  function pintarFiltros() {
    const caja = $("mpFiltros");
    if (!caja) return;
    const cuenta = {};
    ESTADO.mercados.forEach((m) => { cuenta[m.ico] = (cuenta[m.ico] || 0) + 1; });
    const rubros = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
    caja.innerHTML = '<button type="button" class="mp-chip' + (ESTADO.filtro ? "" : " on") + '" data-f="">Todos</button>' +
      rubros.map((k) => {
        const m = ESTADO.mercados.find((x) => x.ico === k);
        return '<button type="button" class="mp-chip' + (ESTADO.filtro === k ? " on" : "") + '" data-f="' + esc(k) + '">' +
          esc(m.rubro) + " · " + cuenta[k] + "</button>";
      }).join("");
    caja.querySelectorAll(".mp-chip").forEach((b) => {
      b.onclick = () => { ESTADO.filtro = b.dataset.f; pintarFiltros(); pintarLista(); pintarMapa(); };
    });
  }

  function pintarCargando() {
    const l = $("mpLista");
    if (!l) return;
    l.innerHTML = Array.from({ length: 4 }).map(() =>
      '<div class="mp-esqueleto"><span></span><div><i></i><i></i></div></div>').join("");
    const t = $("mpTotal");
    if (t) t.textContent = "…";
  }

  function pintarLista() {
    const caja = $("mpLista");
    if (!caja) return;
    const lista = filtrados();
    const total = $("mpTotal");
    if (total) total.textContent = lista.length;
    pintarFiltros();

    if (!lista.length) {
      caja.innerHTML = '<div class="mp-vacio"><b>Sin mercados en este radio</b>' +
        "<p>Prueba con un radio más grande o mueve el mapa y toca «Buscar mercados aquí».</p></div>";
      return;
    }

    caja.innerHTML = lista.map((m) => {
      const n = unidades(m.id);
      const tags = [];
      if (m.muestra) tags.push('<em class="mp-tag muestra">muestra</em>');
      if (m.horario) tags.push('<em class="mp-tag">' + esc(acortar(m.horario, 26)) + "</em>");
      if (n) tags.push('<em class="mp-tag carrito">' + n + " en el pedido</em>");
      const linea = [m.rubro, m.direccion || m.comuna].filter(Boolean).join(" · ");
      return '<button type="button" class="mp-item" data-id="' + esc(m.id) + '">' +
        '<span class="mp-item-ico mp-ico-' + esc(m.ico) + '">' + icono(m.ico, 20) + "</span>" +
        '<span class="mp-item-txt"><b>' + esc(m.nombre) + "</b>" +
        "<small>" + esc(linea) + "</small>" +
        (tags.length ? '<span class="mp-item-tags">' + tags.join("") + "</span>" : "") +
        "</span>" +
        '<span class="mp-item-dist"><b>' + esc(distancia(m.dist)) + "</b><small>de ti</small></span>" +
        "</button>";
    }).join("");

    caja.querySelectorAll(".mp-item").forEach((b) => {
      b.onclick = () => {
        const m = ESTADO.mercados.find((x) => x.id === b.dataset.id);
        if (!m) return;
        abrirHoja(m);
        if (ESTADO.mapa) ESTADO.mapa.setView([m.lat, m.lon], Math.max(ESTADO.mapa.getZoom(), 17), { animate: true });
      };
    });
  }

  function acortar(t, n) {
    t = String(t || "");
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function pintarLeyenda(origen, n) {
    const ley = $("mpLeyenda");
    if (!ley) return;
    if (origen === "muestra") {
      ley.innerHTML = '<span class="mp-leyenda-ojo">Datos de muestra</span> Sin OpenStreetMap: los locales son de referencia.';
    } else if (origen === "api" || origen === "overpass") {
      ley.innerHTML = n + " locales de OpenStreetMap en " + (ESTADO.radio / 1000).toFixed(1).replace(".", ",") + " km";
    } else {
      ley.innerHTML = "No se pudo consultar OpenStreetMap. Revisa tu conexión.";
    }
  }

  /* ── hoja del local ────────────────────────────────────────────────────── */
  function abrirHoja(m) {
    ESTADO.viendo = m;
    const hoja = $("mpHoja");
    if (!hoja) return;
    hoja.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarHoja();
    hoja.querySelector(".mp-hoja-panel").scrollTop = 0;
  }

  function cerrarHoja() {
    const hoja = $("mpHoja");
    if (hoja) hoja.hidden = true;
    document.body.classList.remove("mp-abierto");
    ESTADO.viendo = null;
  }

  function pintarHoja() {
    const m = ESTADO.viendo;
    if (!m) return;
    $("mpHojaIco").innerHTML = icono(m.ico, 22);
    $("mpHojaNombre").textContent = m.nombre;
    $("mpHojaSub").textContent = [m.rubro, distancia(m.dist) + " de ti"].filter(Boolean).join(" · ");

    const meta = [];
    if (m.direccion) meta.push(fila("Dirección", esc(m.direccion) + (m.comuna ? ", " + esc(m.comuna) : "")));
    else if (m.comuna) meta.push(fila("Comuna", esc(m.comuna)));
    if (m.horario) meta.push(fila("Horario", esc(m.horario)));
    if (m.telefono) meta.push(fila("Teléfono", '<a href="tel:' + esc(m.telefono) + '">' + esc(m.telefono) + "</a>"));
    if (m.web) meta.push(fila("Sitio", '<a href="' + esc(m.web) + '" target="_blank" rel="noopener">' + esc(acortar(m.web.replace(/^https?:\/\//, ""), 34)) + "</a>"));
    meta.push(fila("Origen", m.muestra ? "muestra local (sin red)" : "OpenStreetMap"));
    meta.push(fila("Cómo llegar", '<a href="https://www.google.com/maps/dir/?api=1&destination=' +
      m.lat.toFixed(6) + "," + m.lon.toFixed(6) + '" target="_blank" rel="noopener">Abrir ruta</a>'));

    const prods = productos(m);
    const carrito = ESTADO.carrito[m.id] || { items: {} };

    $("mpHojaCuerpo").innerHTML =
      '<div class="mp-meta">' + meta.join("") + "</div>" +
      '<div class="mp-cat-cab">' +
        '<h3>Catálogo del local</h3>' +
        '<span class="mp-tag ' + (m.muestra ? "muestra" : "ref") + '">' + (m.muestra ? "muestra" : "referencial") + "</span>" +
      "</div>" +
      '<p class="mp-cat-nota">Este catálogo se arma con el rubro del local («' + esc(m.rubro) +
        "») y precios de referencia en CLP. El stock y los precios reales los define cada negocio.</p>" +
      '<div class="mp-productos">' +
        prods.map((p) => {
          const cant = carrito.items[p.id] || 0;
          return '<div class="mp-prod' + (cant ? " en-carrito" : "") + '">' +
            '<div class="mp-prod-txt"><b>' + esc(p.nombre) + "</b>" +
              "<small>" + p.stock + " disponibles · " + clp(p.precio) + "</small></div>" +
            '<div class="mp-prod-acc">' +
              (cant
                ? '<button type="button" class="mp-mas" data-p="' + esc(p.id) + '" data-d="-1" aria-label="Quitar uno">−</button>' +
                  '<b class="mp-cant">' + cant + "</b>"
                : "") +
              '<button type="button" class="mp-mas" data-p="' + esc(p.id) + '" data-d="1" aria-label="Agregar uno">+</button>' +
            "</div>" +
          "</div>";
        }).join("") +
      "</div>";

    $("mpHojaCuerpo").querySelectorAll(".mp-mas").forEach((b) => {
      b.onclick = () => cambiar(m, b.dataset.p, Number(b.dataset.d));
    });

    const items = itemsDe(m);
    const total = totalDe(m);
    const pie = $("mpHojaPie");
    if (items.length) {
      pie.innerHTML =
        '<div class="mp-pedido"><span><b>' + clp(total) + "</b> · " +
          items.reduce((a, p) => a + p.cantidad, 0) +
          (items.reduce((a, p) => a + p.cantidad, 0) === 1 ? " producto" : " productos") + "</span>" +
        '<button type="button" class="btn primary sm" id="mpPedir">Pedir</button></div>' +
        '<button type="button" class="mp-limpiar" id="mpLimpiar">Vaciar pedido</button>';
      $("mpPedir").onclick = () => pedir(m);
      $("mpLimpiar").onclick = () => {
        delete ESTADO.carrito[m.id];
        guardarCarrito(); pintarHoja(); pintarLista();
      };
    } else {
      pie.innerHTML = "";
    }
  }

  function fila(k, v) {
    return '<div class="mp-fila"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
  }

  function pedir(m) {
    const items = itemsDe(m);
    if (!items.length) return;
    const lineas = items.map((p) => "• " + p.cantidad + " × " + p.nombre + " — " + clp(p.precio * p.cantidad));
    const texto = "Pedido a " + m.nombre + "\n" + lineas.join("\n") + "\nTotal: " + clp(totalDe(m)) +
      "\n\nEnviado desde MercadoPlacer · FORGE CORE STOCK";
    const tel = String(m.telefono || "").replace(/[^\d]/g, "");
    if (tel && tel.length >= 8) {
      const wa = tel.startsWith("56") ? tel : "56" + tel.replace(/^0/, "");
      window.open("https://wa.me/" + wa + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
      return;
    }
    if (navigator.share) {
      navigator.share({ title: "Pedido a " + m.nombre, text: texto }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(texto).then(
      () => avisar("Pedido copiado al portapapeles"),
      () => avisar("Copia el pedido desde la lista")
    );
  }

  function avisar(t) {
    const el = $("mpAviso");
    if (!el) return;
    el.innerHTML = esc(t);
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => { if (el) el.innerHTML = ""; }, 3600);
  }

  /* ── ciclo de vida ─────────────────────────────────────────────────────── */
  function montar() {
    if (ESTADO.montado) return;
    ESTADO.montado = true;

    $("mpUbicar").onclick = () => ubicar(true);
    const centrar = $("mpCentrar");
    if (centrar) centrar.onclick = () => {
      if (!ESTADO.pos) { ubicar(true); return; }
      if (ESTADO.mapa) ESTADO.mapa.setView([ESTADO.pos.lat, ESTADO.pos.lon], Math.max(ESTADO.mapa.getZoom(), 16), { animate: true });
    };
    $("mpRefrescar").onclick = () => cargar();
    $("mpHojaX").onclick = cerrarHoja;
    $("mpHojaFondo").onclick = cerrarHoja;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && ESTADO.viendo) cerrarHoja();
    });

    $("mpModos").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        $("mpModos").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        if (ESTADO.mapa) ponerCapa(b.dataset.modo);
      };
    });

    const radios = document.querySelectorAll("#mpRadios button");
    radios.forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.r) === ESTADO.radio);
      b.onclick = () => {
        ESTADO.radio = Number(b.dataset.r);
        localStorage.setItem(CLAVE_RADIO, ESTADO.radio);
        radios.forEach((x) => x.classList.toggle("on", x === b));
        cargar();
      };
    });

    // Si la URL trae ?lat=&lon= se usa eso (para probar y para compartir un punto).
    const q = new URLSearchParams(location.search);
    const la = parseFloat(q.get("lat")), lo = parseFloat(q.get("lon"));
    if (isFinite(la) && isFinite(lo)) {
      ESTADO.pos = { lat: la, lon: lo, precision: 0, nombre: "un punto compartido" };
      ESTADO.modoUbi = "negada";
    }

    montarMapa();
    pintarEstado();
    if (ESTADO.pos) { setTimeout(() => { marcarUsuario(ESTADO.pos); cargar(); }, 60); }
    else ubicar(true);
  }

  function render() {
    montar();
    if (ESTADO.mapa) setTimeout(() => { ESTADO.mapa.invalidateSize(); }, 90);
    if (ESTADO.pos && !ESTADO.mercados.length && !ESTADO.cargando) cargar();
  }

  /* Se monta sola si la pantalla ya está visible: no depende de que app.js
     termine su arranque (SQLite WASM puede tardar varios segundos y, mientras
     tanto, el mapa se vería vacío). Es idempotente. */
  function autoMontar() {
    const sec = document.getElementById("s-panel");
    if (sec && sec.classList.contains("on") && !ESTADO.montado) {
      try { montar(); } catch (e) { console.error("MercadoPlacer:", e); }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMontar);
  else setTimeout(autoMontar, 40);
  window.addEventListener("load", () => setTimeout(autoMontar, 250));

  return { render };
})();
