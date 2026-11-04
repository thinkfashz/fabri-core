/* ============================================================================
   MERCADOPLACER · mercados cerca de ti
   ----------------------------------------------------------------------------
   · Mapa real (Leaflet + OpenStreetMap / Esri) con radio, fallback de teselas
     y estado de error visible en vez de un rectángulo vacío.
   · Posición en vivo (`watchPosition`), memoria de la última ubicación y
     pausa del GPS cuando la pestaña queda en segundo plano.
   · Locales desde OpenStreetMap vía /api/mercados (Overpass + Nominatim).
   · Catálogo por local con categorías, búsqueda, ofertas, carrito y pedido.

   Honestidad de los datos:
     - Local, dirección y horario vienen de OpenStreetMap (ODbL).
     - El catálogo es REFERENCIAL: se arma con el rubro del local y precios de
       referencia chilenos. Ningún supermercado publica su catálogo en OSM, y
       la app lo dice en pantalla en vez de fingir que es real.
     - Si no hay red ni Overpass, aparece una muestra local rotulada «muestra».
   ========================================================================== */

window.Placer = (function () {
  "use strict";

  const API = "/api/mercados";
  const CLAVE_CARRITO = "fcore.placer.carrito";
  const CLAVE_RADIO = "fcore.placer.radio";
  const CLAVE_UBI = "fcore.placer.ubicacion";
  const CLAVE_CLIENTE = "fcore.placer.cliente";
  const CLAVE_PEDIDOS = "fcore.placer.pedidos";

  /* Santiago centro: solo si se niega la ubicación o el equipo no la entrega. */
  const RESPALDO = { lat: -33.4489, lon: -70.6693, nombre: "Santiago centro" };

  const ESTADO = {
    mapa: null,
    capa: null,
    modo: "calles",
    marcadores: [],
    porId: {},
    circulo: null,
    usuario: null,
    precision: null,
    pos: null,          // centro de búsqueda (mi GPS o un lugar buscado)
    yo: null,           // posición real del GPS, si existe
    objetivo: null,     // marcador del lugar buscado
    manual: false,      // true cuando el centro lo eligió el usuario
    texto: "",          // filtro por nombre/dirección
    buscandoLugar: false,
    aproxPedida: false,
    mercados: [],
    filtro: "",
    radio: Number(localStorage.getItem(CLAVE_RADIO) || 1500),
    cargando: false,
    viendo: null,
    modoUbi: "esperando",
    vigia: null,
    carrito: leerCarrito(),
    pago: null,
    tresD: false,
    clima: null,
    pedido: leerCliente(),
    cat: { q: "", categoria: "", orden: "relevancia" },
    teselasOk: 0,
    teselasError: 0,
    capaIndice: 0
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
  function azar(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  function guardar(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ }
  }
  function leer(k, porDefecto) {
    try { return JSON.parse(localStorage.getItem(k) || "null") || porDefecto; } catch (e) { return porDefecto; }
  }
  function leerCarrito() { return leer(CLAVE_CARRITO, {}); }
  function leerCliente() { return leer(CLAVE_CLIENTE, { nombre: "", telefono: "", modo: "retiro", nota: "" }); }
  function guardarCarrito() { guardar(CLAVE_CARRITO, ESTADO.carrito); }

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

  /* ── logos de cadena ───────────────────────────────────────────────────── */
  /* Solo para cadenas conocidas: se resuelve su dominio y se pide el icono
     público. Si no carga, queda el icono de categoría (nunca un hueco). */
  const MARCAS = [
    [/tottus/i, "tottus.cl"],
    [/l[ií]der|express de lid/i, "lider.cl"],
    [/santa isabel/i, "santaisabel.cl"],
    [/unimarc/i, "unimarc.cl"],
    [/jumbo/i, "jumbo.cl"],
    [/acuenta/i, "acuenta.cl"],
    [/mayorista 10/i, "mayorista10.cl"],
    [/alvi/i, "alvi.cl"],
    [/ok market/i, "okmarket.cl"],
    [/carrefour/i, "carrefour.cl"],
    [/ahumada/i, "farmaciasahumada.cl"],
    [/cruz verde/i, "cruzverde.cl"],
    [/salcobrand/i, "salcobrand.cl"],
    [/copec/i, "copec.cl"],
    [/shell/i, "shell.cl"]
  ];

  function logoDe(m) {
    if (!m || m.muestra) return "";
    for (let i = 0; i < MARCAS.length; i++) {
      if (MARCAS[i][0].test(m.nombre)) {
        return '<img class="mp-logo" alt="" loading="lazy" referrerpolicy="no-referrer" ' +
          'src="https://icons.duckduckgo.com/ip3/' + MARCAS[i][1] + '.ico" ' +
          'onerror="this.remove()">';
      }
    }
    return "";
  }

  /* ── catálogo referencial ──────────────────────────────────────────────── */
  const BASE = {
    supermercado: [
      ["Arroz grado 1 · 1 kg", 1690], ["Aceite vegetal · 900 ml", 2450], ["Harina sin polvos · 1 kg", 1190],
      ["Leche entera · 1 L", 1290], ["Azúcar · 1 kg", 1490], ["Fideos spaghetti · 400 g", 890],
      ["Huevos colorados · 12 u", 3290], ["Pan de molde · 550 g", 2190], ["Café molido · 170 g", 3790],
      ["Té en saquitos · 20 u", 1690], ["Detergente · 750 ml", 2890], ["Papel higiénico · 4 u", 2790],
      ["Bebida cola · 1,5 L", 1890], ["Agua mineral · 1,5 L", 990], ["Atún en agua · 160 g", 1290],
      ["Lentejas · 1 kg", 2390], ["Sal fina · 1 kg", 690], ["Salsa de tomate · 200 g", 790]
    ],
    almacen: [
      ["Pan corriente · 1 kg", 1990], ["Leche entera · 1 L", 1250], ["Huevos · 12 u", 3190],
      ["Arroz · 1 kg", 1590], ["Fideos · 400 g", 850], ["Aceite · 900 ml", 2390],
      ["Azúcar · 1 kg", 1450], ["Bebida · 1,5 L", 1790], ["Cerveza lata · 470 ml", 1290],
      ["Papel higiénico · 4 u", 2690], ["Velas · 4 u", 990], ["Carbón · 3 kg", 3990],
      ["Atún · 160 g", 1190], ["Galletas · 150 g", 890], ["Jabón · 3 u", 1990]
    ],
    verduleria: [
      ["Tomate · 1 kg", 1490], ["Papa · 1 kg", 990], ["Cebolla · 1 kg", 1090],
      ["Zanahoria · 1 kg", 950], ["Palta Hass · 1 kg", 3990], ["Plátano · 1 kg", 1290],
      ["Manzana roja · 1 kg", 1690], ["Lechuga costina · 1 u", 790], ["Limón · 1 kg", 1590],
      ["Frutilla · 500 g", 2490], ["Pimiento · 1 kg", 1890], ["Choclo · 2 u", 1190],
      ["Naranja · 1 kg", 1190], ["Cilantro · 1 u", 590]
    ],
    carniceria: [
      ["Pollo entero · 1 kg", 4990], ["Pechuga de pollo · 1 kg", 6490], ["Carne molida 5% · 1 kg", 7990],
      ["Lomo vetado · 1 kg", 13990], ["Plateada · 1 kg", 10990], ["Cerdo pulpa · 1 kg", 6990],
      ["Chorizo parrillero · 6 u", 4490], ["Costillar de cerdo · 1 kg", 7490],
      ["Hueso para cazuela · 1 kg", 2990], ["Pollo ganso · 1 kg", 4290]
    ],
    panaderia: [
      ["Marraqueta · 1 kg", 1990], ["Hallulla · 1 kg", 2190], ["Baguette · 1 u", 990],
      ["Pan integral · 800 g", 2790], ["Empanada de pino · 1 u", 1690], ["Torta de milhojas · 1 u", 8990],
      ["Kuchen de manzana · 1 u", 6990], ["Galletas surtidas · 500 g", 2990],
      ["Pan amasado · 1 kg", 2390], ["Dobladitas · 6 u", 2490]
    ],
    feria: [
      ["Tomate · 1 kg", 1290], ["Papa · 1 kg", 890], ["Cebolla · 1 kg", 990],
      ["Palta · 1 kg", 3690], ["Frutilla · 500 g", 2190], ["Malla de naranjas · 3 kg", 3490],
      ["Huevos de campo · 30 u", 6990], ["Miel de ulmo · 1 kg", 8990], ["Queso de campo · 500 g", 5490],
      ["Porotos verdes · 1 kg", 1490], ["Zapallo · 1 kg", 990]
    ],
    pescaderia: [
      ["Reineta · 1 kg", 6990], ["Merluza · 1 kg", 7490], ["Salmón · 1 kg", 12990],
      ["Camarón pelado · 500 g", 8990], ["Choritos · 1 kg", 4990], ["Machas · 500 g", 9990],
      ["Congrio · 1 kg", 11990], ["Jibia · 1 kg", 5990]
    ],
    botilleria: [
      ["Cerveza · 6 x 470 ml", 6990], ["Vino tinto · 750 ml", 4990], ["Pisco · 700 ml", 9990],
      ["Bebida cola · 1,5 L", 1890], ["Hielo · 2 kg", 1990], ["Jugo natural · 1 L", 2490],
      ["Espumante · 750 ml", 7990], ["Ron · 750 ml", 12990], ["Agua tónica · 1,5 L", 2190]
    ],
    fiambreria: [
      ["Jamón artesanal · 250 g", 4290], ["Queso mantecoso · 250 g", 3890], ["Salame · 250 g", 4590],
      ["Mortadela · 250 g", 2490], ["Aceitunas · 250 g", 2290], ["Pan de campo · 1 u", 1990],
      ["Jamón serrano · 100 g", 4990], ["Queso de cabra · 200 g", 5490]
    ],
    dietetica: [
      ["Avena integral · 1 kg", 2490], ["Frutos secos · 500 g", 5990], ["Quinoa · 500 g", 3490],
      ["Miel · 500 g", 4990], ["Té de hierbas · 20 u", 2490], ["Semillas de chía · 250 g", 2990],
      ["Leche de almendras · 1 L", 3290], ["Granola · 500 g", 3990], ["Cacao amargo · 250 g", 4490]
    ],
    lacteos: [
      ["Leche entera · 1 L", 1190], ["Yogur natural · 1 kg", 2790], ["Queso fresco · 500 g", 4990],
      ["Mantequilla · 250 g", 3290], ["Crema · 200 ml", 2190], ["Manjar · 500 g", 3490],
      ["Leche descremada · 1 L", 1190], ["Queso gauda · 250 g", 4590]
    ],
    mayorista: [
      ["Arroz · 10 kg", 14990], ["Aceite · 5 L", 11990], ["Harina · 10 kg", 9990],
      ["Azúcar · 10 kg", 12990], ["Fideos · 5 kg", 7990], ["Conservas · 12 u", 15990],
      ["Detergente · 5 L", 18990], ["Papel higiénico · 24 u", 13990]
    ],
    granja: [
      ["Huevos de campo · 30 u", 6990], ["Pollo de campo · 1 kg", 7990], ["Queso de campo · 500 g", 5490],
      ["Miel pura · 1 kg", 8990], ["Verduras de estación · 3 kg", 5990], ["Mantequilla de campo · 250 g", 3990]
    ],
    mall: [
      ["Café en grano · 250 g", 5990], ["Audífonos inalámbricos · 1 u", 19990], ["Polera básica · 1 u", 9990],
      ["Zapatillas urbanas · 1 u", 39990], ["Perfume · 100 ml", 29990], ["Cargador rápido · 1 u", 12990]
    ],
    tienda: [
      ["Bebida · 1,5 L", 1890], ["Snack · 180 g", 1990], ["Pilas AA · 4 u", 3990],
      ["Cargador USB-C · 1 u", 7990], ["Cuaderno universitario · 1 u", 2490], ["Lápiz pasta · 3 u", 1290]
    ]
  };

  /* Categorías por palabra clave: evita repetir la categoría en 130 productos
     y sigue funcionando si mañana se agrega un producto nuevo a la lista. */
  const CATS = [
    ["Lácteos", /leche|queso|yogur|mantequilla|crema|manjar/i],
    ["Panadería", /pan\b|marraqueta|hallulla|baguette|empanada|torta|kuchen|galleta|dobladita|amasado/i],
    ["Carnes", /pollo|carne|cerdo|lomo|plateada|chorizo|costillar|pechuga|molida|hueso|vacuno/i],
    ["Frutas y verduras", /tomate|papa|cebolla|zanahoria|palta|pl[aá]tano|manzana|lechuga|lim[oó]n|frutilla|pimiento|choclo|naranja|zapallo|poroto|cilantro|verdura/i],
    ["Bebidas", /bebida|agua|jugo|cerveza|vino|pisco|espumante|hielo|t[eé]\b|caf[eé]|ron\b|t[oó]nica/i],
    ["Abarrotes", /arroz|fideo|aceite|harina|az[uú]car|sal\b|at[uú]n|conserva|salsa|lenteja|avena|quinoa|semilla|granola|cacao|miel|fruto|snack|huevo/i],
    ["Limpieza", /detergente|papel|cloro|lavaloza|basura|jab[oó]n|vela/i],
    ["Pescados", /reineta|merluza|salm[oó]n|camar[oó]n|chorito|macha|congrio|jibia/i],
    ["Otros", /.*/]
  ];

  function categoriaDe(nombre) {
    for (let i = 0; i < CATS.length; i++) if (CATS[i][1].test(nombre)) return CATS[i][0];
    return "Otros";
  }
  function unidadDe(nombre) {
    const m = /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|u|unidades?)\b/i.exec(nombre);
    if (!m) return "1 u";
    const n = m[1].replace(",", ".");
    const u = m[2].toLowerCase().replace("unidades", "u").replace("unidad", "u");
    return n + " " + (u === "l" ? "L" : u);
  }

  function productos(m) {
    const base = BASE[m.ico] || BASE.tienda;
    const semilla = m.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    return base.map(function (par, i) {
      const variacion = 0.92 + azar(semilla + i * 7.7) * 0.24;       // ±12 %
      const lista = Math.round((par[1] * variacion) / 10) * 10;
      const conOferta = azar(semilla + i * 5.3) > 0.8;                // ~20 %
      const descuento = conOferta ? [10, 15, 20, 25][Math.floor(azar(semilla + i) * 4)] : 0;
      const precio = descuento ? Math.round((lista * (1 - descuento / 100)) / 10) * 10 : lista;
      return {
        id: m.id + "#" + i,
        nombre: par[0],
        categoria: categoriaDe(par[0]),
        unidad: unidadDe(par[0]),
        lista: lista,
        precio: precio,
        descuento: descuento,
        stock: 4 + Math.floor(azar(semilla + i * 3.1) * 36)
      };
    });
  }

  /* ── carrito ───────────────────────────────────────────────────────────── */
  function carritoDe(id) {
    if (!ESTADO.carrito[id]) ESTADO.carrito[id] = { nombre: "", ico: "tienda", rubro: "", items: {} };
    return ESTADO.carrito[id];
  }
  /* Cada ítem guarda nombre y precio: así un producto escaneado por SKU no
     depende de que el catálogo referencial vuelva a generarlo igual. */
  function cantidadDe(it) {
    if (it == null) return 0;
    return typeof it === "number" ? it : (it.c || 0);
  }
  function unidades(id) {
    const c = ESTADO.carrito[id];
    return c ? Object.values(c.items).reduce((a, it) => a + cantidadDe(it), 0) : 0;
  }
  function unidadesTotales() {
    return Object.keys(ESTADO.carrito).reduce((a, id) => a + unidades(id), 0);
  }
  function itemsDe(m) {
    const c = ESTADO.carrito[m.id];
    if (!c) return [];
    return Object.keys(c.items).map((pid) => {
      const it = c.items[pid];
      if (typeof it === "number") {
        // Formato viejo (sólo cantidad): se resuelve contra el catálogo.
        const p = productos(m).find((x) => x.id === pid);
        return p ? { id: pid, nombre: p.nombre, precio: p.precio, cantidad: it } : null;
      }
      return { id: pid, nombre: it.n, precio: it.p, cantidad: it.c || 0 };
    }).filter(Boolean);
  }
  function totalDe(m) {
    return itemsDe(m).reduce((a, p) => a + p.precio * p.cantidad, 0);
  }
  function cambiar(m, pid, delta, datos) {
    const c = carritoDe(m.id);
    c.nombre = m.nombre || c.nombre;
    c.ico = m.ico || c.ico;
    c.rubro = m.rubro || c.rubro;

    const actual = c.items[pid];
    const cant = cantidadDe(actual) + delta;
    const base = datos || (actual && typeof actual === "object" ? { id: pid, nombre: actual.n, precio: actual.p } : null);
    const prod = base || productos(m).find((x) => x.id === pid) || { nombre: "Producto", precio: 0 };

    if (cant <= 0) delete c.items[pid];
    else c.items[pid] = { n: prod.nombre, p: prod.precio, c: cant };
    if (!Object.keys(c.items).length) delete ESTADO.carrito[m.id];

    guardarCarrito();
    pintarHoja();
    pintarCarrito();
    pintarCarritoBtn();
    pintarLista();
    marcarActivo();
  }

  /* ── ubicación ─────────────────────────────────────────────────────────── */
  function textoUbicacion() {
    if (ESTADO.manual && ESTADO.pos) return "Buscando en " + ESTADO.pos.nombre;
    if (ESTADO.modoUbi === "aprox" && ESTADO.pos) return "Zona aproximada por red: " + ESTADO.pos.nombre;
    if (!ESTADO.yo) {
      if (ESTADO.pos && ESTADO.modoUbi === "negada") return "Ubicación de referencia: " + ESTADO.pos.nombre;
      return "Sin ubicación todavía";
    }
    return "Tu ubicación · ±" + Math.round(ESTADO.yo.precision || 0) + " m";
  }

  function pintarEstado() {
    const live = $("mpLive");
    const txt = $("mpUbiTexto");
    if (txt) txt.textContent = textoUbicacion();
    const volver = $("mpVolver");
    if (volver) volver.hidden = !(ESTADO.manual && ESTADO.yo);
    const ubi = $("mpUbicar");
    if (ubi) {
      ubi.classList.toggle("activo", ESTADO.modoUbi === "real" && !ESTADO.manual);
      ubi.classList.toggle("girando", ESTADO.modoUbi === "esperando");
      ubi.setAttribute("aria-label", ESTADO.manual ? "Volver a mi ubicación" : "Centrar en mi ubicación");
    }
    if (live) {
      const estado = ESTADO.manual ? "buscado"
        : ESTADO.modoUbi === "real" ? "ok"
        : ESTADO.modoUbi === "aprox" ? "aprox"
        : ESTADO.modoUbi === "negada" ? "warn" : "";
      live.className = "mp-live " + estado;
      live.innerHTML = "<i></i>" + (ESTADO.manual ? "lugar buscado"
        : ESTADO.modoUbi === "real" ? "en vivo"
        : ESTADO.modoUbi === "aprox" ? "aprox. por red"
        : ESTADO.modoUbi === "negada" ? "sin gps" : "ubicando");
    }
  }

  function marcarUsuario(p) {
    if (!ESTADO.mapa || !p) return;
    const punto = [p.lat, p.lon];
    if (!ESTADO.usuario) {
      ESTADO.usuario = L.marker(punto, {
        icon: L.divIcon({
          className: "mp-yo",
          html: '<span class="mp-yo-halo"></span><span class="mp-yo-punto"></span>',
          iconSize: [30, 30], iconAnchor: [15, 15]
        }),
        interactive: false, zIndexOffset: 900
      }).addTo(ESTADO.mapa);
      ESTADO.precision = L.circle(punto, {
        radius: p.precision || 40, color: "#c8ff00", weight: 1, opacity: 0.5,
        fillColor: "#c8ff00", fillOpacity: 0.07, interactive: false
      }).addTo(ESTADO.mapa);
    } else {
      ESTADO.usuario.setLatLng(punto);
      ESTADO.precision.setLatLng(punto);
      ESTADO.precision.setRadius(Math.max(25, p.precision || 40));
      if (ESTADO.circulo) ESTADO.circulo.setLatLng(punto);
    }
  }

  function pintarObjetivo() {
    if (!ESTADO.mapa) return;
    if (!ESTADO.manual || !ESTADO.pos) {
      if (ESTADO.objetivo) { ESTADO.mapa.removeLayer(ESTADO.objetivo); ESTADO.objetivo = null; }
      return;
    }
    const ico = L.divIcon({
      className: "mp-objetivo",
      html: '<span class="mp-objetivo-anillo"></span><span class="mp-objetivo-punto"></span>',
      iconSize: [40, 40], iconAnchor: [20, 20]
    });
    if (!ESTADO.objetivo) {
      ESTADO.objetivo = L.marker([ESTADO.pos.lat, ESTADO.pos.lon], { icon: ico, interactive: false, zIndexOffset: 700 }).addTo(ESTADO.mapa);
    } else {
      ESTADO.objetivo.setLatLng([ESTADO.pos.lat, ESTADO.pos.lon]).setIcon(ico);
    }
  }

  // El radio y el radar se dibujan en canvas: más fino y sin nodos de DOM.
  function pintarRadio() { pintarCanvas(); }

  function motivoPermiso() {
    if (!window.isSecureContext) return "inseguro";
    if (!navigator.geolocation) return "sin-api";
    return "";
  }

  async function ubicar(centrar) {
    ESTADO.modoUbi = "esperando";
    ESTADO.aproxPedida = false;
    pintarEstado();

    const base = motivoPermiso();
    if (base === "inseguro") {
      usarRespaldo("La ubicación necesita una conexión segura (https)");
      ubicacionAproximada();
      return;
    }
    if (base === "sin-api") {
      usarRespaldo("Este navegador no entrega ubicación");
      ubicacionAproximada();
      return;
    }

    // Se consulta el permiso antes de pedir la posición: así el mensaje es
    // exacto («lo bloqueaste») en vez de un error genérico.
    let permiso = "prompt";
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: "geolocation" });
        permiso = p.state;
        p.onchange = () => { if (p.state === "granted") ubicar(false); };
      }
    } catch (e) { /* Safari viejo: se prueba igual */ }

    if (permiso === "denied") {
      usarRespaldo("Tenés la ubicación bloqueada para este sitio");
      ubicacionAproximada();
      vigilar();
      return;
    }

    pedirPosicion(centrar, true, false);
    vigilar();
  }

  function pedirPosicion(centrar, altaPrecision, reintento) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        aplicarPosicion(pos, true);
        if (ESTADO.mapa && !ESTADO.manual && (centrar || !ESTADO.mercados.length)) {
          ESTADO.mapa.setView([pos.coords.latitude, pos.coords.longitude], 16, { animate: true });
        }
        cargar();
      },
      (err) => {
        // 2 = posición no disponible, 3 = tiempo agotado. Casi siempre es que
        // el equipo no tiene GPS o está bajo techo: se reintenta por red.
        if ((err.code === 2 || err.code === 3) && !reintento) {
          ESTADO.modoUbi = "esperando";
          pintarEstado();
          pedirPosicion(centrar, false, true);
          return;
        }
        usarRespaldo(err && err.code === 1
          ? "Bloqueaste la ubicación (o el navegador la tiene bloqueada)"
          : err && err.code === 3
            ? "El equipo no respondió a tiempo"
            : "No se pudo obtener tu ubicación");
        ubicacionAproximada();
        cargar();
      },
      {
        enableHighAccuracy: altaPrecision,
        maximumAge: altaPrecision ? 4000 : 60000,
        timeout: altaPrecision ? 15000 : 20000
      }
    );
  }

  /* Sin GPS, la ciudad aproximada por IP es mejor que Santiago para todos.
     Se rotula como aproximada y nunca se dibuja como «estás aquí». */
  async function ubicacionAproximada() {
    if (ESTADO.aproxPedida || ESTADO.manual) return;
    ESTADO.aproxPedida = true;
    cargarClima();
    const zona = await zonaPorRed();
    if (!zona || ESTADO.modoUbi === "real" || ESTADO.manual) return;
    ESTADO.pos = { lat: zona.lat, lon: zona.lon, precision: 4000, nombre: zona.nombre };
    ESTADO.modoUbi = "aprox";
    pintarEstado();
    pintarRadio();
    if (ESTADO.mapa) ESTADO.mapa.setView([zona.lat, zona.lon], 13, { animate: true });
    const aviso = $("mpAviso");
    if (aviso) {
      aviso.innerHTML = "<b>Sin GPS.</b> El mapa está en tu zona aproximada (" + esc(zona.nombre) +
        "). Activa la ubicación en el candado de la barra para precisión de metros." +
        ' <button type="button" id="mpReintentar">Reintentar</button>';
      const b = $("mpReintentar");
      if (b) b.onclick = () => ubicar(true);
    }
    cargar();
  }

  /* Ciudad aproximada por IP. No reemplaza al GPS: sirve para que, si el
     permiso está bloqueado, el mapa no arranque en otra región del país.
     Dos proveedores gratuitos, sin clave; el primero que responda gana. */
  async function zonaPorRed() {
    const fuentes = [
      {
        url: "https://get.geojs.io/v1/ip/geo.json",
        leer: (d) => ({
          lat: Number(d.latitude), lon: Number(d.longitude),
          nombre: [d.city, d.region].filter(Boolean).join(", ")
        })
      },
      {
        url: "https://ipwho.is/",
        leer: (d) => d && d.success !== false
          ? { lat: Number(d.latitude), lon: Number(d.longitude), nombre: [d.city, d.region].filter(Boolean).join(", ") }
          : null
      }
    ];
    for (const f of fuentes) {
      try {
        const ctrl = new AbortController();
        const reloj = setTimeout(() => ctrl.abort(), 7000);
        const r = await fetch(f.url, { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(reloj);
        if (!r.ok) continue;
        const z = f.leer(await r.json());
        if (z && isFinite(z.lat) && isFinite(z.lon)) {
          z.nombre = z.nombre || "tu zona";
          return z;
        }
      } catch (e) { /* siguiente proveedor */ }
    }
    return null;
  }

  function vigilar() {
    if (ESTADO.vigia != null || !navigator.geolocation) return;
    ESTADO.vigia = navigator.geolocation.watchPosition(
      (pos) => aplicarPosicion(pos, false),
      () => { /* el error ya se explicó en la primera lectura */ },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
  }

  function aplicarPosicion(pos, primera) {
    const antes = ESTADO.yo;
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy };
    ESTADO.yo = p;
    ESTADO.modoUbi = "real";
    marcarUsuario(p);
    guardar(CLAVE_UBI, { lat: p.lat, lon: p.lon, t: Date.now() });

    // Si el usuario buscó una dirección a mano, el GPS no le mueve el mapa:
    // sólo actualiza el punto azul de «estás aquí».
    if (!ESTADO.manual) {
      ESTADO.pos = p;
      pintarEstado();
      pintarRadio();
      if (!primera && antes) {
        const d = metrosc(antes.lat, antes.lon, p.lat, p.lon);
        if (d > 150 && !ESTADO.cargando) cargar(true);
      }
      cargarClima();
      return;
    }

    pintarEstado();
    // Si el GPS llega después de un fallo y no hay mercados, se usa igual.
    if (!ESTADO.mercados.length && !ESTADO.cargando) {
      ESTADO.pos = p;
      cargar();
    }
  }

  function usarRespaldo(motivo) {
    ESTADO.yo = null;
    ESTADO.modoUbi = "negada";
    if (!ESTADO.manual) {
      ESTADO.pos = { lat: RESPALDO.lat, lon: RESPALDO.lon, precision: 0, nombre: RESPALDO.nombre };
      pintarRadio();
    }
    pintarEstado();
    const aviso = $("mpAviso");
    if (aviso) {
      aviso.innerHTML = "<b>" + esc(motivo) + ".</b> " +
        (/bloqueaste/i.test(motivo)
          ? "Actívala en el candado de la barra de direcciones o escribe tu calle arriba. "
          : "") +
        "Mientras tanto, busco tu zona aproximada por red." +
        ' <button type="button" id="mpReintentar">Reintentar</button>';
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

  /* ── datos ─────────────────────────────────────────────────────────────── */
  async function cargar(silencioso) {
    if (!ESTADO.pos || ESTADO.cargando) return;
    ESTADO.cargando = true;
    if (!silencioso) pintarCargando();
    const { lat, lon } = ESTADO.pos;
    const radio = ESTADO.radio;
    let lista = null, origen = "";

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
      try { lista = await overpassDirecto(lat, lon, radio); origen = "overpass"; }
      catch (e) { lista = null; }
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
    const r = await fetch(base, { method: "POST", body: new URLSearchParams({ data: q }), signal: ctrl.signal });
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

  /* ── buscador de direcciones y negocios ────────────────────────────────── */
  let relojBusqueda = null;

  function ocultarSugerencias() {
    const caja = $("mpSugerencias");
    if (caja) { caja.hidden = true; caja.innerHTML = ""; }
  }

  function pintarSugerencias(lista) {
    const caja = $("mpSugerencias");
    if (!caja) return;
    if (!lista.length) {
      caja.hidden = false;
      caja.innerHTML = '<div class="mp-sug-vacia">Sin resultados. Prueba con «calle + número» o el nombre del local.</div>';
      return;
    }
    caja.hidden = false;
    caja.innerHTML = lista.map((l, i) =>
      '<button type="button" class="mp-sug" data-i="' + i + '">' +
        '<span class="mp-sug-ico"><svg viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg></span>' +
        '<span class="mp-sug-txt"><b>' + esc(l.nombre) + "</b><small>" + esc(l.direccion || l.tipo || "") + "</small></span>" +
      "</button>").join("");
    caja.querySelectorAll(".mp-sug").forEach((b) => {
      b.onclick = () => elegirLugar(lista[Number(b.dataset.i)]);
    });
  }

  async function buscarLugares(texto) {
    const q = texto.trim();
    if (q.length < 3) { ocultarSugerencias(); return; }
    const caja = $("mpSugerencias");
    if (caja) { caja.hidden = false; caja.innerHTML = '<div class="mp-sug-vacia">Buscando…</div>'; }
    try {
      const ctrl = new AbortController();
      const reloj = setTimeout(() => ctrl.abort(), 12000);
      let url = "/api/lugares?q=" + encodeURIComponent(q);
      if (ESTADO.yo) url += "&lat=" + ESTADO.yo.lat.toFixed(4) + "&lon=" + ESTADO.yo.lon.toFixed(4);
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(reloj);
      const d = await r.json();
      if (d && d.ok) {
        pintarSugerencias(d.lugares || []);
      } else {
        pintarSugerencias(await nominatimDirecto(q));
      }
    } catch (e) {
      try { pintarSugerencias(await nominatimDirecto(q)); }
      catch (_) { if (caja) caja.innerHTML = '<div class="mp-sug-vacia">No pude buscar. Revisa la conexión.</div>'; }
    } finally {
      ESTADO.buscandoLugar = false;
    }
  }

  // Si /api/lugares no responde (despliegue viejo, 502), se pregunta directo.
  async function nominatimDirecto(q) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 10000);
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&addressdetails=1" +
      "&accept-language=es&countrycodes=cl&q=" + encodeURIComponent(q);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(reloj);
    if (!r.ok) throw new Error("nominatim " + r.status);
    const lote = await r.json();
    return (lote || []).map((it) => ({
      nombre: it.name || (it.display_name || "").split(",")[0],
      direccion: it.display_name || "",
      tipo: it.type || "",
      lat: Number(it.lat), lon: Number(it.lon)
    })).filter((l) => isFinite(l.lat) && isFinite(l.lon));
  }

  function elegirLugar(l) {
    if (!l) return;
    ESTADO.manual = true;
    ESTADO.pos = { lat: l.lat, lon: l.lon, precision: 0, nombre: l.nombre };
    ESTADO.filtro = "";
    ESTADO.texto = "";
    const q = $("mpBuscarQ");
    if (q) q.value = l.nombre;
    ocultarSugerencias();
    const volver = $("mpVolver");
    if (volver) volver.hidden = !ESTADO.yo;
    pintarEstado();
    if (ESTADO.mapa) ESTADO.mapa.setView([l.lat, l.lon], 16, { animate: true });
    pintarRadio();
    pintarObjetivo();
    cargar();
  }

  function centrarEnMi() {
    if (!ESTADO.yo) {
      // Sin lectura todavía: se pide y, cuando llegue, aplicarPosicion centra.
      ubicar(true);
      avisar("Buscando tu ubicación…");
      return;
    }
    ESTADO.manual = false;
    ESTADO.pos = ESTADO.yo;
    const volver = $("mpVolver");
    if (volver) volver.hidden = true;
    pintarEstado();
    pintarObjetivo();
    pintarRadio();
    if (ESTADO.mapa) {
      ESTADO.mapa.flyTo([ESTADO.yo.lat, ESTADO.yo.lon], Math.max(ESTADO.mapa.getZoom(), 17),
        { duration: 1.1, easeLinearity: 0.25 });
    }
    avisar("Centrado en tu ubicación");
    if (!ESTADO.mercados.length) cargar();
  }

  function volverAMi() {
    const q = $("mpBuscarQ");
    if (q) q.value = "";
    ESTADO.texto = "";
    ocultarSugerencias();
    if (!ESTADO.yo) { ESTADO.manual = false; ubicar(true); return; }
    ESTADO.manual = false;
    ESTADO.pos = ESTADO.yo;
    const volver = $("mpVolver");
    if (volver) volver.hidden = true;
    pintarEstado();
    if (ESTADO.mapa) ESTADO.mapa.setView([ESTADO.yo.lat, ESTADO.yo.lon], 16, { animate: true });
    pintarRadio();
    pintarObjetivo();
    cargar();
  }

  /* ── clima (Open-Meteo, sin clave) ─────────────────────────────────────── */
  const CLIMA = {
    0: ["despejado", "sol"], 1: ["casi despejado", "sol"], 2: ["parcial", "parcial"], 3: ["nublado", "nube"],
    45: ["niebla", "nube"], 48: ["niebla", "nube"], 51: ["llovizna", "lluvia"], 53: ["llovizna", "lluvia"],
    55: ["llovizna", "lluvia"], 61: ["lluvia", "lluvia"], 63: ["lluvia", "lluvia"], 65: ["lluvia fuerte", "lluvia"],
    71: ["nieve", "nieve"], 73: ["nieve", "nieve"], 75: ["nieve", "nieve"], 80: ["chubascos", "lluvia"],
    81: ["chubascos", "lluvia"], 82: ["chubascos", "lluvia"], 95: ["tormenta", "tormenta"]
  };
  function iconoClima(tipo) {
    const d = tipo === "sol"
      ? '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>'
      : tipo === "lluvia"
        ? '<path d="M7 15a4 4 0 0 1 .6-7.9 5 5 0 0 1 9.4 1.4A3.4 3.4 0 0 1 17 15H7Z"/><path d="M8.5 18v2M12 18v2M15.5 18v2"/>'
        : tipo === "tormenta"
          ? '<path d="M7 14a4 4 0 0 1 .6-7.9 5 5 0 0 1 9.4 1.4A3.4 3.4 0 0 1 17 14H7Z"/><path d="m12 15-2 4h3l-1 3"/>'
          : tipo === "nieve"
            ? '<path d="M7 14a4 4 0 0 1 .6-7.9 5 5 0 0 1 9.4 1.4A3.4 3.4 0 0 1 17 14H7Z"/><path d="M9 18h.01M12 20h.01M15 18h.01"/>'
            : tipo === "parcial"
              ? '<circle cx="9" cy="9" r="3.4"/><path d="M9 2.5v1.6M2.5 9h1.6M4.4 4.4l1.1 1.1"/><path d="M10 19a3.6 3.6 0 0 1 .5-7.2 4.6 4.6 0 0 1 8.6 1.3A3 3 0 0 1 18 19h-8Z"/>'
              : '<path d="M7 18a4 4 0 0 1 .6-7.9 5 5 0 0 1 9.4 1.4A3.4 3.4 0 0 1 17 18H7Z"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";
  }
  let climaPedido = 0;
  async function cargarClima() {
    if (!ESTADO.pos || Date.now() - climaPedido < 600000) return;
    climaPedido = Date.now();
    try {
      const u = "https://api.open-meteo.com/v1/forecast?latitude=" + ESTADO.pos.lat.toFixed(3) +
        "&longitude=" + ESTADO.pos.lon.toFixed(3) +
        "&current=temperature_2m,weather_code&timezone=auto";
      const r = await fetch(u, { cache: "no-store" });
      const d = await r.json();
      if (!d || !d.current) return;
      ESTADO.clima = { temp: Math.round(d.current.temperature_2m), code: d.current.weather_code };
      pintarClima();
    } catch (e) { /* sin clima: no se muestra */ }
  }
  function pintarClima() {
    const el = $("mpClima");
    if (!el || !ESTADO.clima) return;
    const par = CLIMA[ESTADO.clima.code] || ["—", "nube"];
    el.hidden = false;
    el.innerHTML = iconoClima(par[1]) + "<b>" + ESTADO.clima.temp + "°</b><span>" + par[0] + "</span>";
    el.title = "Clima actual · Open-Meteo";
  }

  /* ── mapa ──────────────────────────────────────────────────────────────── */
  const CAPAS = {
    calles: [
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
    ],
    satelite: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    ]
  };
  const ATRIB = {
    calles: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
    satelite: '<a href="https://www.esri.com" target="_blank" rel="noopener">Imágenes © Esri</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>'
  };

  function montarMapa() {
    const caja = $("mpMapa");
    if (!caja) return;
    caja.dataset.mensaje = "No se pudieron cargar las teselas del mapa. La lista de mercados sigue funcionando.";
    if (ESTADO.mapa) return;
    if (!window.L) {
      // Sin Leaflet (primera visita sin red y sin caché) el mapa no existe,
      // pero la lista sí: se dice en vez de dejar un rectángulo vacío.
      caja.dataset.mensaje = "El mapa no está disponible sin conexión. La lista de abajo sigue funcionando.";
      caja.classList.add("sin-teselas");
      return;
    }
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
    L.control.scale({ imperial: false, position: "bottomleft", maxWidth: 90 }).addTo(ESTADO.mapa);

    montarCanvas();
    ESTADO.mapa.on("zoomend", marcarZoom);
    ESTADO.mapa.on("dragend", alMoverMapa);
    if (ESTADO.pos) marcarUsuario(ESTADO.pos);
  }

  function ponerCapa(modo) {
    const lista = CAPAS[modo] || CAPAS.calles;
    ESTADO.capaIndice = 0;
    ESTADO.teselasError = 0;
    ESTADO.teselasOk = 0;
    if (ESTADO.capa) ESTADO.mapa.removeLayer(ESTADO.capa);

    const crear = (url) => {
      const capa = L.tileLayer(url, { maxZoom: 19, crossOrigin: true });
      capa.on("tileload", () => {
        ESTADO.teselasOk++;
        const caja = $("mpMapa");
        if (caja) caja.classList.remove("sin-teselas");
      });
      capa.on("tileerror", () => {
        ESTADO.teselasError++;
        // Si fallan muchas y hay un proveedor alternativo, se cambia solo.
        if (ESTADO.teselasError > 8 && ESTADO.capaIndice < lista.length - 1) {
          ESTADO.capaIndice++;
          ESTADO.mapa.removeLayer(capa);
          ESTADO.capa = crear(lista[ESTADO.capaIndice]);
          ESTADO.capa.addTo(ESTADO.mapa);
        } else if (ESTADO.teselasError > 14 && ESTADO.teselasOk === 0) {
          const caja = $("mpMapa");
          if (caja) caja.classList.add("sin-teselas");
        }
      });
      return capa;
    };

    ESTADO.capa = crear(lista[0]).addTo(ESTADO.mapa);
    ESTADO.modo = modo;
    const caja = $("mpMapa");
    if (caja) caja.classList.toggle("modo-satelite", modo === "satelite");
    const credito = $("mpCredito");
    if (credito) credito.innerHTML = ATRIB[modo] || ATRIB.calles;
    pintarRadio();
  }

  function marcarZoom() {
    if (!ESTADO.mapa) return;
    const caja = $("mpMapa");
    if (caja) caja.classList.toggle("pines-compactos", ESTADO.mapa.getZoom() < 16);
  }

  function alMoverMapa() {
    const c = ESTADO.mapa.getCenter();
    if (ESTADO.pos && metrosc(ESTADO.pos.lat, ESTADO.pos.lon, c.lat, c.lng) > 400) {
      const ley = $("mpLeyenda");
      if (ley && !ley.querySelector("#mpBuscarAqui")) {
        const b = document.createElement("button");
        b.id = "mpBuscarAqui";
        b.type = "button";
        b.textContent = "Buscar acá";
        b.onclick = () => {
          ESTADO.pos = { lat: c.lat, lon: c.lng, precision: ESTADO.pos ? ESTADO.pos.precision : 0, nombre: "este punto" };
          ESTADO.modoUbi = "negada";
          cargar();
        };
        ley.appendChild(b);
      }
    }
  }

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

  function montarCanvas() {
    const c = $("mpCanvas");
    if (!c || !ESTADO.mapa) return;
    ESTADO.canvas = c;
    ESTADO.mapa.on("move zoom viewreset resize", pintarCanvas);
    let ultimo = 0;
    const bucle = (t) => {
      // ~24 fps: suficiente para el pulso y no gasta batería.
      if (!document.hidden && t - ultimo > 42) { ultimo = t; pintarCanvas(); }
      ESTADO.raf = requestAnimationFrame(bucle);
    };
    ESTADO.raf = requestAnimationFrame(bucle);
  }

  function pintarCanvas() {
    const c = ESTADO.canvas, mapa = ESTADO.mapa;
    if (!c || !mapa) return;
    const ctx = c.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!ESTADO.pos) return;

    const centro = mapa.latLngToContainerPoint([ESTADO.pos.lat, ESTADO.pos.lon]);
    const zoom = mapa.getZoom();
    const mpp = 156543.03392 * Math.cos(ESTADO.pos.lat * Math.PI / 180) / Math.pow(2, zoom);
    const r = Math.max(8, ESTADO.radio / mpp);

    // Radio de búsqueda: relleno tenue + aro punteado.
    ctx.beginPath();
    ctx.arc(centro.x, centro.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(200,255,0,.05)";
    ctx.fill();
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(200,255,0,.38)";
    ctx.stroke();
    ctx.setLineDash([]);

    // Radar sobre la posición real (si hay GPS).
    if (ESTADO.yo) {
      const p = mapa.latLngToContainerPoint([ESTADO.yo.lat, ESTADO.yo.lon]);
      const t = performance.now() / 1000;
      for (let i = 0; i < 3; i++) {
        const fase = ((t * 0.4) + i / 3) % 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 + fase * 48, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(200,255,0," + (0.26 * (1 - fase)).toFixed(3) + ")";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      filtrados().slice(0, 6).forEach((m) => {
        const q = mapa.latLngToContainerPoint([m.lat, m.lon]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = "rgba(200,255,0,.14)";
        ctx.stroke();
      });
    }
  }

  function pintarMapa() {
    if (!ESTADO.mapa) return;
    ESTADO.marcadores.forEach((m) => ESTADO.mapa.removeLayer(m));
    ESTADO.marcadores = [];
    ESTADO.porId = {};
    const puntos = [];

    agrupar(filtrados()).forEach((g) => {
      if (g.items.length > 1) {
        const grupo = g.items;
        const mk = L.marker([g.lat, g.lon], {
          icon: L.divIcon({
            className: "mp-pin mp-grupo",
            html: '<span class="mp-pin-cuerpo"><b>' + grupo.length + '</b></span><span class="mp-pin-pata"></span>',
            iconSize: [38, 46], iconAnchor: [19, 42]
          }),
          zIndexOffset: 200
        }).addTo(ESTADO.mapa).on("click", () => {
          ESTADO.mapa.fitBounds(grupo.map((x) => [x.lat, x.lon]), { padding: [40, 40], maxZoom: 18 });
          if (ESTADO.mapa.getZoom() >= 18) abrirHoja(grupo[0]);
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
        iconSize: [30, 40], iconAnchor: [15, 36]
      });
      const mk = L.marker([m.lat, m.lon], { icon: ico, riseOnHover: true })
        .addTo(ESTADO.mapa)
        .on("click", () => abrirHoja(m));
      ESTADO.porId[m.id] = mk;
      ESTADO.marcadores.push(mk);
      puntos.push([m.lat, m.lon]);
    });

    if (ESTADO.pos) puntos.push([ESTADO.pos.lat, ESTADO.pos.lon]);
    if (puntos.length > 1) {
      ESTADO.mapa.fitBounds(puntos, { padding: [34, 34], maxZoom: 17, animate: true });
    }
    pintarRadio();
    pintarObjetivo();
    marcarZoom();
    marcarActivo();
  }

  function marcarActivo() {
    Object.keys(ESTADO.porId).forEach((id) => {
      const mk = ESTADO.porId[id];
      const el = mk && mk.getElement && mk.getElement();
      if (el) el.classList.toggle("activo", ESTADO.viendo && ESTADO.viendo.id === id);
    });
  }

  function filtrados() {
    const t = ESTADO.texto.trim().toLowerCase();
    return ESTADO.mercados.filter((m) => {
      if (ESTADO.filtro && m.ico !== ESTADO.filtro) return false;
      if (!t) return true;
      return (m.nombre + " " + m.rubro + " " + (m.direccion || "") + " " + (m.comuna || ""))
        .toLowerCase().includes(t);
    });
  }

  /* ── lista ─────────────────────────────────────────────────────────────── */
  function pintarFiltros() {
    const caja = $("mpFiltros");
    if (!caja) return;
    const cuenta = {};
    ESTADO.mercados.forEach((m) => { cuenta[m.ico] = (cuenta[m.ico] || 0) + 1; });
    const rubros = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a]);
    caja.innerHTML = '<button type="button" class="mp-chip' + (ESTADO.filtro ? "" : " on") + '" data-f="">Todos</button>' +
      rubros.map((k) => {
        const m = ESTADO.mercados.find((x) => x.ico === k);
        return '<button type="button" class="mp-chip' + (ESTADO.filtro === k ? " on" : "") +
          '" data-f="' + esc(k) + '" aria-pressed="' + (ESTADO.filtro === k) + '">' +
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

  const DESCRIPCION = {
    supermercado: "Surtido completo para la semana",
    almacen: "Lo básico del día a día, a mano",
    feria: "Frutas y verduras de estación",
    verduleria: "Verduras y frutas frescas",
    panaderia: "Pan recién horneado y dulces",
    carniceria: "Cortes frescos y embutidos",
    pescaderia: "Pescado y mariscos del día",
    botilleria: "Bebidas, hielo y botillería",
    fiambreria: "Fiambres, quesos y aceitunas",
    dietetica: "Natural, sin azúcar y a granel",
    lacteos: "Leche, quesos y lácteos",
    mayorista: "Precios por volumen",
    mall: "Tiendas y servicios",
    tienda: "Artículos varios",
    granja: "Productos de campo"
  };

  function descripcionDe(m) {
    if (m.muestra) return "Local de referencia (sin conexión)";
    return DESCRIPCION[m.ico] || "Local de barrio";
  }
  function categoriasDe(m) {
    const vistas = [];
    productos(m).forEach((p) => { if (vistas.indexOf(p.categoria) < 0) vistas.push(p.categoria); });
    return vistas.slice(0, 3);
  }

  function pintarLista() {
    const caja = $("mpLista");
    if (!caja) return;
    const lista = filtrados();
    const total = $("mpTotal");
    if (total) total.textContent = lista.length;
    pintarFiltros();

    if (!lista.length) {
      const t = ESTADO.texto.trim();
      caja.innerHTML = t
        ? '<div class="mp-vacio"><b>Ningún local coincide con «' + esc(acortar(t, 24)) + '»</b>' +
          "<p>Arriba puedes buscar esa dirección y mover el mapa hasta ahí.</p></div>"
        : '<div class="mp-vacio"><b>Sin mercados en este radio</b>' +
          "<p>Prueba con un radio más grande o mueve el mapa y toca «Buscar acá».</p></div>";
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
        '<span class="mp-item-ico">' + icono(m.ico, 20) + logoDe(m) + "</span>" +
        '<span class="mp-item-txt"><b>' + esc(m.nombre) + "</b>" +
        "<small>" + esc(linea) + "</small>" +
        '<em class="mp-item-desc">' + esc(descripcionDe(m)) + "</em>" +
        '<span class="mp-item-prods">' + categoriasDe(m).map((c) => "<span>" + esc(c) + "</span>").join("") +
          (tags.length ? tags.join("") : "") + "</span>" +
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
    const km = (ESTADO.radio / 1000).toFixed(1).replace(".", ",");
    if (origen === "muestra") {
      ley.innerHTML = '<span class="mp-leyenda-ojo">muestra</span> sin OpenStreetMap';
    } else if (origen === "api" || origen === "overpass") {
      ley.innerHTML = "<b>" + n + "</b> locales · OSM · " + km + " km";
    } else {
      ley.textContent = "sin conexión con OSM";
    }
  }

  /* ── ficha del local y catálogo ────────────────────────────────────────── */
  function abrirHoja(m) {
    ESTADO.viendo = m;
    ESTADO.cat = { q: "", categoria: "", orden: "relevancia" };
    const hoja = $("mpHoja");
    if (!hoja) return;
    hoja.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarHoja();
    marcarActivo();
    const panel = hoja.querySelector(".mp-hoja-panel");
    if (panel) panel.scrollTop = 0;
  }

  function cerrarHoja() {
    const hoja = $("mpHoja");
    if (hoja) hoja.hidden = true;
    document.body.classList.remove("mp-abierto");
    ESTADO.viendo = null;
    marcarActivo();
  }

  function productosFiltrados(m) {
    const q = ESTADO.cat.q.trim().toLowerCase();
    let lista = productos(m);
    if (ESTADO.cat.categoria) lista = lista.filter((p) => p.categoria === ESTADO.cat.categoria);
    if (q) lista = lista.filter((p) => p.nombre.toLowerCase().includes(q));
    if (ESTADO.cat.orden === "precio") lista = lista.slice().sort((a, b) => a.precio - b.precio);
    if (ESTADO.cat.orden === "precio-desc") lista = lista.slice().sort((a, b) => b.precio - a.precio);
    return lista;
  }

  function pintarHoja() {
    const m = ESTADO.viendo;
    if (!m) return;
    const carrito = ESTADO.carrito[m.id] || { items: {} };
    const todos = productos(m);

    $("mpHojaIco").innerHTML = icono(m.ico, 22) + logoDe(m);
    $("mpHojaNombre").textContent = m.nombre;
    $("mpHojaSub").textContent = [m.rubro, distancia(m.dist) + " de ti"].filter(Boolean).join(" · ");

    const acciones = [];
    acciones.push(accion("ruta", "Ruta",
      "https://www.google.com/maps/dir/?api=1&destination=" + m.lat.toFixed(6) + "," + m.lon.toFixed(6),
      '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>'));
    if (m.telefono) acciones.push(accion("tel", "Llamar", "tel:" + m.telefono,
      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>'));
    if (m.web) acciones.push(accion("web", "Sitio", m.web,
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>'));

    const datos = [m.direccion || m.comuna, m.horario].filter(Boolean);
    const ofertas = todos.filter((p) => p.descuento).length;

    $("mpHojaCuerpo").innerHTML =
      '<p class="mp-hoja-desc">' + esc(descripcionDe(m)) + "</p>" +
      (datos.length ? '<p class="mp-hoja-datos">' + datos.map(esc).join('<i>·</i>') + "</p>" : "") +
      '<div class="mp-acciones">' +
        '<button type="button" class="mp-accion mp-3d" id="mpVerTienda">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>' +
          "<span>Ver tienda en 3D</span></button>" +
        acciones.join("") + "</div>" +
      '<div class="mp-stats">' +
        "<div><b>" + todos.length + "</b><span>productos</span></div>" +
        "<div><b>" + [...new Set(todos.map((p) => p.categoria))].length + "</b><span>categorías</span></div>" +
        "<div><b>" + (ofertas || "—") + "</b><span>ofertas</span></div>" +
      "</div>" +
      '<div class="mp-cat-cab">' +
        '<h3>Catálogo del local</h3>' +
        '<span class="mp-tag ' + (m.muestra ? "muestra" : "ref") + '">' + (m.muestra ? "muestra" : "referencial") + "</span>" +
      "</div>" +
      '<p class="mp-cat-nota">Precios de referencia en CLP armados por rubro («' + esc(m.rubro) +
        "»). El stock y los precios reales los define cada negocio.</p>" +
      '<div class="mp-cat-herramientas">' +
        '<label class="mp-buscar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>' +
          '<input id="mpCatQ" type="search" placeholder="Buscar en el catálogo…" value="' + esc(ESTADO.cat.q) + '" autocomplete="off">' +
        "</label>" +
        '<button type="button" class="mp-orden" id="mpCatOrden" aria-label="Cambiar orden">' +
          (ESTADO.cat.orden === "precio" ? "Precio ↑" : ESTADO.cat.orden === "precio-desc" ? "Precio ↓" : "Ordenar") +
        "</button>" +
      "</div>" +
      '<div class="mp-chips mp-cat-chips" id="mpCatChips">' +
        '<button type="button" class="mp-chip' + (ESTADO.cat.categoria ? "" : " on") + '" data-c="">Todo · ' + todos.length + "</button>" +
        [...new Set(todos.map((p) => p.categoria))].map((c) => {
          const n = todos.filter((p) => p.categoria === c).length;
          return '<button type="button" class="mp-chip' + (ESTADO.cat.categoria === c ? " on" : "") +
            '" data-c="' + esc(c) + '">' + esc(c) + " · " + n + "</button>";
        }).join("") +
      "</div>" +
      '<div class="mp-productos" id="mpProductos">' + pintarProductos(m, productosFiltrados(m)) + "</div>";

    
    const q = $("mpCatQ");
    if (q) q.oninput = () => {
      ESTADO.cat.q = q.value;
      const caja = $("mpProductos");
      if (caja) caja.innerHTML = pintarProductos(m, productosFiltrados(m));
      engancharProductos(m);
    };
    const orden = $("mpCatOrden");
    if (orden) orden.onclick = () => {
      ESTADO.cat.orden = ESTADO.cat.orden === "relevancia" ? "precio" :
        ESTADO.cat.orden === "precio" ? "precio-desc" : "relevancia";
      pintarHoja();
    };
    document.querySelectorAll("#mpCatChips .mp-chip").forEach((b) => {
      b.onclick = () => { ESTADO.cat.categoria = b.dataset.c; pintarHoja(); };
    });
    // Ver el local caminable: el visor 3D recibe el catálogo de este negocio
    const verTienda = $("mpVerTienda");
    if (verTienda) verTienda.onclick = () => {
      if (window.Tienda3D && Tienda3D.ponerTienda) Tienda3D.ponerTienda(productos(m), m);
      if (window.Fabri) window.Fabri.go("tienda");
    };
    engancharProductos(m);
    pintarPieHoja(m);
  }

  function pintarProductos(m, lista) {
    if (!lista.length) {
      return '<div class="mp-vacio"><b>Nada con ese filtro</b><p>Prueba con otra palabra o quita la categoría.</p></div>';
    }
    const carrito = ESTADO.carrito[m.id] || { items: {} };
    return lista.map((p) => {
      const cant = cantidadDe(carrito.items[p.id]);
      return '<div class="mp-prod' + (cant ? " en-carrito" : "") + '" data-pid="' + esc(p.id) + '">' +
        '<span class="mp-prod-ico" data-cat="' + esc(p.categoria) + '" aria-hidden="true">' +
          '<b>' + esc(p.nombre.charAt(0)) + "</b></span>" +
        '<div class="mp-prod-txt">' +
          "<b>" + esc(p.nombre) + "</b>" +
          '<small><em>' + esc(p.categoria) + "</em> · " + esc(p.unidad) + " · quedan " + p.stock + "</small>" +
          '<span class="mp-prod-precio">' +
            (p.descuento ? '<i class="mp-prod-antes">' + clp(p.lista) + "</i>" : "") +
            "<b>" + clp(p.precio) + "</b>" +
            (p.descuento ? '<em class="mp-prod-off">−' + p.descuento + "%</em>" : "") +
          "</span>" +
        "</div>" +
        '<div class="mp-prod-acc">' +
          (cant ? '<button type="button" class="mp-mas" data-p="' + esc(p.id) + '" data-d="-1" aria-label="Quitar uno">−</button>' +
                  '<b class="mp-cant">' + cant + "</b>" : "") +
          '<button type="button" class="mp-mas" data-p="' + esc(p.id) + '" data-d="1" aria-label="Agregar uno">+</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function volarAlCarrito(origen) {
    const destino = $("mpCarritoBtn");
    if (!origen || !destino) return;
    const a = origen.getBoundingClientRect();
    const b = destino.getBoundingClientRect();
    const dot = document.createElement("span");
    dot.className = "mp-vuelo";
    dot.style.left = (a.left + a.width / 2 - 7) + "px";
    dot.style.top = (a.top + a.height / 2 - 7) + "px";
    document.body.appendChild(dot);
    requestAnimationFrame(() => {
      dot.style.transform = "translate(" + (b.left + b.width / 2 - a.left - a.width / 2) +
        "px," + (b.top + b.height / 2 - a.top - a.height / 2) + "px) scale(.3)";
      dot.style.opacity = "0";
    });
    setTimeout(() => dot.remove(), 700);
  }

  function engancharProductos(m) {
    document.querySelectorAll("#mpHojaCuerpo .mp-mas").forEach((b) => {
      b.onclick = () => {
        const delta = Number(b.dataset.d);
        cambiar(m, b.dataset.p, delta);
        if (delta > 0) volarAlCarrito(b);
      };
    });
  }

  function pintarPieHoja(m) {
    const pie = $("mpHojaPie");
    if (!pie) return;
    const items = itemsDe(m);
    const total = totalDe(m);
    if (!items.length) {
      pie.innerHTML = "";
      return;
    }
    pie.innerHTML =
      '<div class="mp-pedido"><span><b>' + clp(total) + "</b> · " +
        items.reduce((a, p) => a + p.cantidad, 0) +
        (items.reduce((a, p) => a + p.cantidad, 0) === 1 ? " producto" : " productos") + "</span>" +
        '<button type="button" class="btn primary sm" id="mpPedir">Ver pedido</button></div>';
    $("mpPedir").onclick = () => { cerrarHoja(); abrirCarrito(m.id); };
  }

  function accion(id, texto, url, svg) {
    return '<a class="mp-accion" id="mpAccion-' + id + '" href="' + esc(url) + '"' +
      (url.startsWith("https") ? ' target="_blank" rel="noopener"' : "") + ">" +
      '<svg viewBox="0 0 24 24" aria-hidden="true">' + svg + "</svg><span>" + esc(texto) + "</span></a>";
  }

  function fila(k, v) {
    return '<div class="mp-fila"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
  }

  /* ── carrito / pedido ──────────────────────────────────────────────────── */
  function abrirCarrito(foco) {
    const hoja = $("mpCarrito");
    if (!hoja) return;
    hoja.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarCarrito(foco);
  }

  function cerrarCarrito() {
    const hoja = $("mpCarrito");
    if (hoja) hoja.hidden = true;
    document.body.classList.remove("mp-abierto");
  }

  function tiendasConPedido() {
    return Object.keys(ESTADO.carrito).map((id) => {
      const guardado = ESTADO.carrito[id];
      const vivo = ESTADO.mercados.find((m) => m.id === id);
      return vivo || {
        id: id, nombre: guardado.nombre || "Local del pedido",
        ico: guardado.ico || "tienda", rubro: guardado.rubro || "", dist: 0
      };
    }).filter((m) => ESTADO.carrito[m.id] && Object.keys(ESTADO.carrito[m.id].items).length);
  }

  function pintarCarrito() {
    const cuerpo = $("mpCarritoCuerpo");
    const pie = $("mpCarritoPie");
    if (!cuerpo || !pie) return;
    const tiendas = tiendasConPedido();

    if (!tiendas.length) {
      cuerpo.innerHTML = '<div class="mp-vacio"><b>Tu pedido está vacío</b>' +
        "<p>Toca un mercado, elige productos y vuelve acá.</p></div>";
      pie.innerHTML = "";
      pintarCarritoBtn();
      return;
    }

    let granTotal = 0;
    const p = ESTADO.pedido;
    cuerpo.innerHTML =
      '<div class="mp-cliente">' +
        '<div class="mp-cli-fila">' +
          '<input id="mpCliNombre" type="text" placeholder="Tu nombre" autocomplete="name" value="' + esc(p.nombre) + '">' +
          '<input id="mpCliTel" type="tel" placeholder="Teléfono (opcional)" autocomplete="tel" value="' + esc(p.telefono) + '">' +
        "</div>" +
        '<div class="mp-cli-modos" id="mpCliModos">' +
          '<button type="button" data-modo="retiro" class="' + (p.modo !== "delivery" ? "on" : "") + '">Retiro</button>' +
          '<button type="button" data-modo="delivery" class="' + (p.modo === "delivery" ? "on" : "") + '">Delivery</button>' +
        "</div>" +
        '<input id="mpCliNota" type="text" placeholder="Nota para el local (opcional)" value="' + esc(p.nota) + '">' +
      "</div>" +
      '<p class="mp-car-nota">Cada local recibe su propio pedido. Revisa cantidades y envía.</p>' +
      tiendas.map((m) => {
        const items = itemsDe(m);
        const total = totalDe(m);
        granTotal += total;
        return '<section class="mp-car-grupo">' +
          '<header><span class="mp-car-ico">' + icono(m.ico, 16) + "</span>" +
            "<b>" + esc(m.nombre) + "</b>" +
            "<small>" + (m.dist ? distancia(m.dist) + " · " : "") + items.length + (items.length === 1 ? " producto" : " productos") + "</small></header>" +
          items.map((p) =>
            '<div class="mp-car-item">' +
              '<div class="mp-car-nom"><b>' + esc(p.nombre) + "</b><small>" + clp(p.precio) + " c/u</small></div>" +
              '<div class="mp-prod-acc">' +
                '<button type="button" class="mp-mas" data-t="' + esc(m.id) + '" data-p="' + esc(p.id) + '" data-d="-1">−</button>' +
                '<b class="mp-cant">' + p.cantidad + "</b>" +
                '<button type="button" class="mp-mas" data-t="' + esc(m.id) + '" data-p="' + esc(p.id) + '" data-d="1">+</button>' +
              "</div>" +
              '<b class="mp-car-sub">' + clp(p.precio * p.cantidad) + "</b>" +
            "</div>").join("") +
          '<footer><span>Subtotal</span><b>' + clp(total) + "</b></footer>" +
          '<button type="button" class="btn primary block sm" data-pedir="' + esc(m.id) + '">Pagar ' + clp(total) + "</button>" +
        "</section>";
      }).join("");

    pie.innerHTML =
      '<div class="mp-car-total"><span>Total del pedido</span><b>' + clp(granTotal) + "</b></div>" +
      '<button type="button" class="mp-link" id="mpVaciar">Vaciar todo</button>';

    const nombre = $("mpCliNombre"), tel = $("mpCliTel"), nota = $("mpCliNota");
    const guardarCliente = () => {
      ESTADO.pedido = {
        nombre: (nombre && nombre.value || "").trim(),
        telefono: (tel && tel.value || "").trim(),
        modo: ESTADO.pedido.modo,
        nota: (nota && nota.value || "").trim()
      };
      guardar(CLAVE_CLIENTE, ESTADO.pedido);
    };
    [nombre, tel, nota].forEach((el) => { if (el) el.oninput = guardarCliente; });
    cuerpo.querySelectorAll("#mpCliModos button").forEach((b) => {
      b.onclick = () => {
        ESTADO.pedido.modo = b.dataset.modo;
        cuerpo.querySelectorAll("#mpCliModos button").forEach((x) => x.classList.toggle("on", x === b));
        guardarCliente();
      };
    });

    cuerpo.querySelectorAll(".mp-mas").forEach((b) => {
      b.onclick = () => {
        const m = ESTADO.mercados.find((x) => x.id === b.dataset.t) || { id: b.dataset.t, ico: "tienda", nombre: "" };
        cambiar(m, b.dataset.p, Number(b.dataset.d));
        pintarCarrito();
      };
    });
    cuerpo.querySelectorAll("[data-pedir]").forEach((b) => {
      b.onclick = () => { cerrarCarrito(); abrirPago(b.dataset.pedir); };
    });
    const vaciar = $("mpVaciar");
    if (vaciar) vaciar.onclick = () => {
      ESTADO.carrito = {};
      guardarCarrito();
      pintarCarrito(); pintarCarritoBtn(); pintarLista();
    };
    pintarCarritoBtn();
  }

  function pintarCarritoBtn() {
    const n = unidadesTotales();
    const b = $("mpCarritoBtn");
    const badge = $("mpCarritoN");
    if (b) b.classList.toggle("con-pedido", n > 0);
    if (badge) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.hidden = n === 0;
    }

    // Barra flotante: total de todos los locales, no sólo del abierto.
    const barra = $("mpBarra");
    if (!barra) return;
    let total = 0;
    Object.keys(ESTADO.carrito).forEach((id) => { total += totalDe({ id: id }); });
    barra.hidden = n === 0;
    const hud = document.querySelector(".mp-hud");
    if (hud) hud.classList.toggle("con-barra", n > 0);
    const t = $("mpBarraTotal");
    const c = $("mpBarraCount");
    if (t) t.textContent = clp(total);
    if (c) c.textContent = n + (n === 1 ? " producto" : " productos");
  }

  /* ── escáner ───────────────────────────────────────────────────────────── */
  async function escanear() {
    if (!window.Scan) { avisar("El escáner no está disponible en este navegador."); return; }
    let codigo = null;
    try {
      codigo = await window.Scan.abrir({ subtitulo: "apunta al código del producto" });
    } catch (e) { avisar("No pude abrir la cámara."); return; }
    if (codigo) agregarPorCodigo(codigo);
  }

  function agregarPorCodigo(codigo) {
    const m = ESTADO.viendo || filtrados()[0] || ESTADO.mercados[0];
    if (!m) { avisar("Primero elige un mercado."); return; }

    // 1) Inventario propio (tabla products): es el único dato real de precios.
    let fila = null;
    try {
      if (window.Fabri && window.Fabri.one) {
        fila = window.Fabri.one("SELECT name, price FROM products WHERE sku = ? COLLATE NOCASE", [codigo]);
      }
    } catch (e) { /* sin base todavía */ }

    let prod, nota;
    if (fila && fila.name) {
      prod = { id: m.id + "#sku:" + codigo, nombre: fila.name, precio: Number(fila.price) || 0 };
      nota = "de tu inventario";
    } else {
      // 2) Referencia del local: elegido por el código, siempre el mismo.
      const bolsa = productos(m);
      const idx = String(codigo).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) % bolsa.length;
      const p = bolsa[idx];
      prod = { id: p.id, nombre: p.nombre, precio: p.precio };
      nota = "código no registrado · referencia";
    }

    cambiar(m, prod.id, 1, prod);
    avisar("Agregado: " + prod.nombre + " · " + clp(prod.precio) + " (" + nota + ")");
  }

  function luhn(numero) {
    const n = String(numero).replace(/\D/g, "");
    if (n.length < 13 || n.length > 19) return false;
    let suma = 0, doble = false;
    for (let i = n.length - 1; i >= 0; i--) {
      let d = Number(n[i]);
      if (doble) { d *= 2; if (d > 9) d -= 9; }
      suma += d; doble = !doble;
    }
    return suma % 10 === 0;
  }

  function fechaTarjetaOk(v) {
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(v).trim());
    if (!m) return false;
    const mes = Number(m[1]), anio = 2000 + Number(m[2]);
    if (mes < 1 || mes > 12) return false;
    const hoy = new Date();
    return new Date(anio, mes, 0, 23, 59) >= new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  }

  function abrirPago(id) {
    const m = tiendasConPedido().find((x) => x.id === id) ||
      ESTADO.mercados.find((x) => x.id === id);
    if (!m || !itemsDe(m).length) { avisar("Ese pedido ya no tiene productos."); return; }
    ESTADO.pago = {
      id: id, tienda: m,
      items: itemsDe(m), subtotal: totalDe(m),
      numero: "", exp: "", cvv: "", titular: "",
      metodo: "tarjeta", entrega: ESTADO.pedido.modo === "delivery" ? "delivery" : "retiro",
      estado: "form"
    };
    const hoja = $("mpPago");
    if (!hoja) return;
    hoja.hidden = false;
    document.body.classList.add("mp-abierto");
    pintarPago();
    const panel = hoja.querySelector(".mp-hoja-panel");
    if (panel) panel.scrollTop = 0;
  }

  function cerrarPago() {
    const hoja = $("mpPago");
    if (hoja) hoja.hidden = true;
    document.body.classList.remove("mp-abierto");
    ESTADO.pago = null;
  }

  // La tienda se guarda al abrir el pago: después de cobrar el carrito queda
  // vacío y volver a buscarla dejaría la confirmación sin datos.
  function tiendaDePago() {
    return ESTADO.pago ? ESTADO.pago.tienda : null;
  }

  function costoEnvio() {
    return ESTADO.pago && ESTADO.pago.entrega === "delivery" ? 1990 : 0;
  }

  function marcaTarjeta(numero) {
    const n = String(numero).replace(/\D/g, "");
    if (/^4/.test(n)) return { nombre: "Visa", largo: [13, 16, 19], cvv: 3 };
    if (/^(5[1-5]|2[2-7])/.test(n)) return { nombre: "Mastercard", largo: [16], cvv: 3 };
    if (/^3[47]/.test(n)) return { nombre: "Amex", largo: [15], cvv: 4 };
    if (/^(6011|65|64[4-9])/.test(n)) return { nombre: "Discover", largo: [16], cvv: 3 };
    return { nombre: "Tarjeta", largo: [13, 16, 19], cvv: 3 };
  }

  function erroresPago() {
    const e = {};
    const p = ESTADO.pedido;
    if (!p.nombre || p.nombre.trim().length < 2) e.nombre = "Escribe tu nombre para el pedido.";
    if (p.telefono && p.telefono.replace(/\D/g, "").length < 8 && p.telefono.trim()) {
      e.telefono = "El teléfono debe tener al menos 8 dígitos.";
    }
    if (ESTADO.pago.entrega === "delivery" && !(ESTADO.pago.direccion || "").trim()) {
      e.direccion = "Falta la dirección para el delivery.";
    }
    if (ESTADO.pago.metodo === "tarjeta") {
      const num = String(ESTADO.pago.numero || "").replace(/\D/g, "");
      const m = marcaTarjeta(num);
      if (!m.largo.includes(num.length) || !luhn(num)) e.numero = "Número inválido para " + m.nombre + ".";
      if (!fechaTarjetaOk(ESTADO.pago.exp || "")) e.exp = "Vencimiento MM/AA no válido.";
      if (!new RegExp("^\\d{" + m.cvv + "}$").test(ESTADO.pago.cvv || "")) e.cvv = "CVV de " + m.cvv + " dígitos.";
      if (!(ESTADO.pago.titular || "").trim()) e.titular = "Nombre como figura en la tarjeta.";
    }
    return e;
  }

  function err(clave) {
    const e = ESTADO.pago.errores || {};
    return e[clave] ? '<p class="mp-error">' + esc(e[clave]) + "</p>" : "";
  }

  function pintarPago() {
    const m = tiendaDePago();
    if (!m) { cerrarPago(); return; }
    const items = ESTADO.pago.items || [];
    const subtotal = ESTADO.pago.subtotal || 0;
    const envio = costoEnvio();
    const total = subtotal + envio;
    const p = ESTADO.pedido;

    $("mpPagoTit").textContent = ESTADO.pago.estado === "listo" ? "Pedido pagado" : "Pagar pedido";
    $("mpPagoSub").textContent = m.nombre + " · " + items.length +
      (items.length === 1 ? " producto" : " productos");

    if (ESTADO.pago.estado === "listo") {
      $("mpPagoCuerpo").innerHTML =
        '<div class="mp-exito">' +
          '<div class="mp-exito-marca"><svg viewBox="0 0 24 24"><path d="m4 12.5 5 5L20 6.5"/></svg></div>' +
          "<h3>Pago simulado aprobado</h3>" +
          '<p class="mp-exito-sub">Pedido ' + esc(ESTADO.pago.codigo) + " · " + clp(total) + "</p>" +
          '<div class="mp-meta">' +
            fila("Local", esc(m.nombre)) +
            fila("Entrega", ESTADO.pago.entrega === "delivery" ? "Delivery" : "Retiro en el local") +
            fila("Pago", ESTADO.pago.metodo === "tarjeta" ? "Tarjeta de crédito/débito" : "Transferencia") +
            (envio ? fila("Envío", clp(envio)) : "") +
            fila("Total", "<b>" + clp(total) + "</b>") +
          "</div>" +
          '<p class="mp-pago-nota">Esto es una simulación: no se cobró ni se enviaron datos de la tarjeta. ' +
            "El local confirma el pedido por WhatsApp.</p>" +
        "</div>";
      $("mpPagoPie").innerHTML =
        '<button type="button" class="btn primary block" id="mpWhats">Confirmar por WhatsApp</button>' +
        '<button type="button" class="mp-link" id="mpCerrarPago">Cerrar</button>';
      $("mpWhats").onclick = () => confirmarPedido(m, total, envio);
      $("mpCerrarPago").onclick = cerrarPago;
      return;
    }

    const tarjeta = ESTADO.pago.metodo === "tarjeta";
    const marca = marcaTarjeta(ESTADO.pago.numero);

    $("mpPagoCuerpo").innerHTML =
      '<div class="mp-pago-resumen">' +
        items.map((x) => '<div class="mp-pago-linea"><span>' + x.cantidad + " × " + esc(x.nombre) +
          "</span><b>" + clp(x.precio * x.cantidad) + "</b></div>").join("") +
        '<div class="mp-pago-linea mp-pago-sub"><span>Subtotal</span><b>' + clp(subtotal) + "</b></div>" +
        (envio ? '<div class="mp-pago-linea mp-pago-sub"><span>Envío</span><b>' + clp(envio) + "</b></div>" : "") +
      "</div>" +

      '<div class="mp-sec"><h3>Tus datos</h3>' +
        '<input id="mpCliNombre" class="mp-campo' + (err("nombre") ? " mal" : "") + '" autocomplete="name" placeholder="Nombre y apellido" value="' + esc(p.nombre) + '">' +
        err("nombre") +
        '<input id="mpCliTel" class="mp-campo' + (err("telefono") ? " mal" : "") + '" type="tel" inputmode="tel" autocomplete="tel" placeholder="Teléfono (opcional)" value="' + esc(p.telefono) + '">' +
        err("telefono") +
      "</div>" +

      '<div class="mp-sec"><h3>Entrega</h3>' +
        '<div class="mp-cli-modos" id="mpEntrega">' +
          '<button type="button" data-e="retiro" class="' + (ESTADO.pago.entrega !== "delivery" ? "on" : "") + '">Retiro</button>' +
          '<button type="button" data-e="delivery" class="' + (ESTADO.pago.entrega === "delivery" ? "on" : "") + '">Delivery (+' + clp(1990) + ")</button>" +
        "</div>" +
        (ESTADO.pago.entrega === "delivery"
          ? '<input id="mpPagoDir" class="mp-campo' + (err("direccion") ? " mal" : "") + '" autocomplete="street-address" placeholder="Calle y número" value="' + esc(ESTADO.pago.direccion || "") + '">' + err("direccion")
          : "") +
      "</div>" +

      '<div class="mp-sec"><h3>Pago</h3>' +
        '<div class="mp-metodos" id="mpMetodos">' +
          '<button type="button" data-m="tarjeta" class="' + (tarjeta ? "on" : "") + '">' +
            '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19"/></svg>Tarjeta</button>' +
          '<button type="button" data-m="transferencia" class="' + (!tarjeta ? "on" : "") + '">' +
            '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h10M4 17h7"/><path d="m16 15 3 3 3-3"/><path d="M19 10v8"/></svg>Transferencia</button>' +
        "</div>" +
        (tarjeta
          ? '<div class="mp-tarjeta">' +
              '<div class="mp-tar-cab"><input id="mpTarNum" class="mp-campo' + (err("numero") ? " mal" : "") + '" inputmode="numeric" autocomplete="cc-number" placeholder="Número de tarjeta" maxlength="23" value="' + esc(ESTADO.pago.numero || "") + '">' +
                '<span class="mp-tar-marca" id="mpTarMarca">' + esc(marca.nombre) + "</span></div>" +
              err("numero") +
              '<div class="mp-tar-fila">' +
                '<input id="mpTarExp" class="mp-campo' + (err("exp") ? " mal" : "") + '" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA" maxlength="5" value="' + esc(ESTADO.pago.exp || "") + '">' +
                '<input id="mpTarCvv" class="mp-campo' + (err("cvv") ? " mal" : "") + '" inputmode="numeric" autocomplete="cc-csc" placeholder="CVV" maxlength="4" value="' + esc(ESTADO.pago.cvv || "") + '">' +
              "</div>" + err("exp") + err("cvv") +
              '<input id="mpTarNom" class="mp-campo' + (err("titular") ? " mal" : "") + '" autocomplete="cc-name" placeholder="Nombre en la tarjeta" value="' + esc(ESTADO.pago.titular || "") + '">' +
              err("titular") +
              '<p class="mp-pago-nota">Simulación: los datos no se envían a ninguna parte. ' +
                "Puedes probar con 4111 1111 1111 1111.</p>" +
            "</div>"
          : '<div class="mp-transf">' +
              '<p>Transfiere el total a:</p>' +
              '<div class="mp-meta">' +
                fila("Banco", "Banco Estado") +
                fila("Titular", "Soluciones Fabrick SpA") +
                fila("RUT", "76.095.190-3") +
                fila("Cuenta", "RUT · 76095190") +
                fila("Correo", "pagos@solucionesfabrick.com") +
              "</div>" +
              '<p class="mp-pago-nota">Después de transferir, toca «Ya transferí». El local confirma la recepción.</p>' +
            "</div>") +
      "</div>" +
      '<p class="mp-pago-nota">Pago simulado con fines de demostración.</p>';

    const cuerpo = $("mpPagoCuerpo");
    cuerpo.querySelectorAll("#mpEntrega button").forEach((b) => {
      b.onclick = () => { ESTADO.pago.entrega = b.dataset.e; ESTADO.pago.errores = {}; pintarPago(); };
    });
    cuerpo.querySelectorAll("#mpMetodos button").forEach((b) => {
      b.onclick = () => { ESTADO.pago.metodo = b.dataset.m; ESTADO.pago.errores = {}; pintarPago(); };
    });

    const nom = $("mpCliNombre"), tel = $("mpCliTel"), dir = $("mpPagoDir");
    if (nom) nom.oninput = () => { ESTADO.pedido.nombre = nom.value; guardar(CLAVE_CLIENTE, ESTADO.pedido); };
    if (tel) tel.oninput = () => { ESTADO.pedido.telefono = tel.value; guardar(CLAVE_CLIENTE, ESTADO.pedido); };
    if (dir) dir.oninput = () => { ESTADO.pago.direccion = dir.value; };

    ["mpTarNum", "mpTarExp", "mpTarCvv", "mpTarNom"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.oninput = () => {
        if (id === "mpTarNum") {
          const d = el.value.replace(/\D/g, "").slice(0, 19);
          el.value = d.replace(/(.{4})/g, "$1 ").trim();
          ESTADO.pago.numero = el.value;
          const chip = $("mpTarMarca");
          if (chip) chip.textContent = marcaTarjeta(el.value).nombre;
        } else if (id === "mpTarExp") {
          let v = el.value.replace(/\D/g, "").slice(0, 4);
          if (v.length > 2) v = v.slice(0, 2) + "/" + v.slice(2);
          el.value = v;
          ESTADO.pago.exp = v;
        } else if (id === "mpTarCvv") {
          el.value = el.value.replace(/\D/g, "").slice(0, 4);
          ESTADO.pago.cvv = el.value;
        } else {
          ESTADO.pago.titular = el.value;
        }
        el.classList.remove("mal");
      };
    });

    $("mpPagoPie").innerHTML =
      '<div class="mp-car-total"><span>Total a pagar</span><b>' + clp(total) + "</b></div>" +
      '<button type="button" class="btn primary block" id="mpPagar">' +
        (tarjeta ? "Pagar " + clp(total) : "Ya transferí " + clp(total)) + "</button>";
    $("mpPagar").onclick = () => pagar(m);
  }

  function pagar(m) {
    const problemas = erroresPago();
    if (Object.keys(problemas).length) {
      ESTADO.pago.errores = problemas;
      pintarPago();
      const primero = document.querySelector("#mpPago .mp-campo.mal");
      if (primero) primero.focus({ preventScroll: false });
      return;
    }
    ESTADO.pago.errores = {};

    ESTADO.pago.estado = "procesando";
    const pie = $("mpPagoPie");
    const cuerpo = $("mpPagoCuerpo");
    if (pie) pie.innerHTML = "";
    if (cuerpo) {
      cuerpo.innerHTML = '<div class="mp-procesando"><span class="mp-spin"></span>' +
        "<p>" + (ESTADO.pago.metodo === "tarjeta" ? "Autorizando el pago…" : "Confirmando la transferencia…") + "</p></div>";
    }
    setTimeout(() => {
      ESTADO.pago.estado = "listo";
      ESTADO.pago.codigo = "MP-" + String(Date.now()).slice(-6);
      guardarPedido(m, total);
      delete ESTADO.carrito[m.id];
      guardarCarrito();
      pintarCarritoBtn();
      pintarCarrito();
      pintarLista();
      pintarPago();
    }, 1600);
  }

  /* El pedido queda en el historial local: es lo que alimenta el panel de
     negocio (pedidos, ventas del día y ticket promedio). */
  function guardarPedido(m, total) {
    try {
      const lista = leer(CLAVE_PEDIDOS, []);
      lista.unshift({
        codigo: ESTADO.pago.codigo,
        fecha: Date.now(),
        local: { id: m.id, nombre: m.nombre },
        items: (ESTADO.pago.items || []).map((x) => ({ nombre: x.nombre, precio: x.precio, cantidad: x.cantidad })),
        subtotal: ESTADO.pago.subtotal || 0,
        envio: costoEnvio(),
        total: total,
        metodo: ESTADO.pago.metodo,
        entrega: ESTADO.pago.entrega,
        direccion: ESTADO.pago.direccion || "",
        cliente: { nombre: ESTADO.pedido.nombre || "", telefono: ESTADO.pedido.telefono || "" },
        estado: "pagado"
      });
      guardar(CLAVE_PEDIDOS, lista.slice(0, 300));
      if (window.Negocio) window.Negocio.render();
    } catch (e) { /* almacenamiento lleno o privado */ }
  }

  function textoPedido(m, total, envio) {
    const p = ESTADO.pedido;
    const items = itemsDe(m);
    const lineas = items.map((x) => "• " + x.cantidad + " × " + x.nombre + " — " + clp(x.precio * x.cantidad));
    return "Pedido " + ESTADO.pago.codigo + " a " + m.nombre + "\n" +
      (p.nombre ? "Cliente: " + p.nombre + "\n" : "") +
      (p.telefono ? "Teléfono: " + p.telefono + "\n" : "") +
      "Entrega: " + (ESTADO.pago.entrega === "delivery"
        ? "Delivery a " + (ESTADO.pago.direccion || "—") : "Retiro en el local") + "\n" +
      "Pago: " + (ESTADO.pago.metodo === "tarjeta" ? "Tarjeta (simulado)" : "Transferencia") + "\n" +
      (p.nota ? "Nota: " + p.nota + "\n" : "") +
      "\n" + lineas.join("\n") +
      "\nSubtotal: " + clp(total - (envio || 0)) +
      (envio ? "\nEnvío: " + clp(envio) : "") +
      "\nTotal: " + clp(total) +
      "\n\nMercadoPlacer · FORGE CORE STOCK";
  }

  function confirmarPedido(m, total, envio) {
    const texto = textoPedido(m, total, envio);
    const tel = String(m.telefono || "").replace(/[^\d]/g, "");
    if (tel && tel.length >= 8) {
      const wa = tel.startsWith("56") ? tel : "56" + tel.replace(/^0/, "");
      window.open("https://wa.me/" + wa + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
      return;
    }
    if (navigator.share) {
      navigator.share({ title: "Pedido " + ESTADO.pago.codigo, text: texto }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(texto).then(
      () => avisar("Pedido copiado: pégalo en el WhatsApp del local"),
      () => avisar("No pude copiar el pedido")
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
    // Si el montaje falla a mitad, no se marca como hecho: así el reintento
    // del próximo render puede completarlo en vez de quedar en blanco.
    try { montarInterfaz(); ESTADO.montado = true; }
    catch (e) { ESTADO.montado = false; window.__mpErr = e && e.message; console.error("MercadoPlacer:", e); }
  }

  function montarInterfaz() {

    $("mpUbicar").onclick = () => centrarEnMi();
    const zi = $("mpZoomIn"), zo = $("mpZoomOut");
    if (zi) zi.onclick = () => { if (ESTADO.mapa) ESTADO.mapa.zoomIn(1); };
    if (zo) zo.onclick = () => { if (ESTADO.mapa) ESTADO.mapa.zoomOut(1); };
    const volver = $("mpVolver");
    if (volver) volver.onclick = volverAMi;

    const form = $("mpBuscador");
    const campo = $("mpBuscarQ");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const q = (campo && campo.value || "").trim();
        if (!q) return;
        await buscarLugares(q);
        const primero = document.querySelector("#mpSugerencias .mp-sug");
        if (primero) primero.click();
      });
    }
    if (campo) {
      campo.addEventListener("input", () => {
        ESTADO.texto = campo.value.trim();
        pintarLista();
        clearTimeout(relojBusqueda);
        relojBusqueda = setTimeout(() => buscarLugares(campo.value), 380);
      });
      campo.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { campo.value = ""; ESTADO.texto = ""; ocultarSugerencias(); pintarLista(); }
      });
    }
    document.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(".mp-buscar-caja")) ocultarSugerencias();
    });
    const refrescar = $("mpRefrescar");
    if (refrescar) refrescar.onclick = () => cargar();
    $("mpHojaX").onclick = cerrarHoja;
    $("mpHojaFondo").onclick = cerrarHoja;
    const carBtn = $("mpCarritoBtn");
    if (carBtn) carBtn.onclick = () => { if (ESTADO.viendo) cerrarHoja(); abrirCarrito(); };
    const irCarrito = $("mpIrCarrito");
    if (irCarrito) irCarrito.onclick = () => abrirCarrito();
    const scanBtn = $("mpScan");
    if (scanBtn) scanBtn.onclick = () => escanear();
    const pagoX = $("mpPagoX");
    if (pagoX) pagoX.onclick = cerrarPago;
    const pagoFondo = $("mpPagoFondo");
    if (pagoFondo) pagoFondo.onclick = cerrarPago;

    // Vista 3D: inclinación suave del lienzo. Se puede apagar (2D plano).
    const btnPanel = $("mpFiltrosBtn"), panel = $("mpPanel");
    if (btnPanel && panel) {
      btnPanel.onclick = () => {
        const abrir = panel.hidden;
        panel.hidden = !abrir;
        btnPanel.setAttribute("aria-expanded", String(abrir));
        btnPanel.classList.toggle("activo", abrir);
      };
    }

    const btnMas = $("mpMas"), menu = $("mpMenu");
    const cerrarMenu = () => {
      if (menu) menu.hidden = true;
      if (btnMas) btnMas.setAttribute("aria-expanded", "false");
    };
    if (btnMas && menu) {
      btnMas.onclick = (e) => {
        e.stopPropagation();
        const abrir = menu.hidden;
        menu.hidden = !abrir;
        btnMas.setAttribute("aria-expanded", String(abrir));
      };
      menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        if (b.id !== "mp3d") cerrarMenu();
      }));
    }
    document.addEventListener("click", (e) => {
      if (!(e.target instanceof Element)) return;
      if (!e.target.closest("#mpMenu") && !e.target.closest("#mpMas")) cerrarMenu();
    });

    const foco = $("mpFoco"), salir = $("mpSalirFoco");
    if (foco) foco.onclick = () => {
      document.body.classList.add("mp-foco");
      if (salir) salir.hidden = false;
      if (ESTADO.mapa) setTimeout(() => ESTADO.mapa.invalidateSize(), 140);
    };
    if (salir) salir.onclick = () => {
      document.body.classList.remove("mp-foco");
      salir.hidden = true;
      if (ESTADO.mapa) setTimeout(() => ESTADO.mapa.invalidateSize(), 140);
    };

    const btn3d = $("mp3d");
    const lienzo = $("mpLienzo");
    const aplicar3d = (on) => {
      ESTADO.tresD = on;
      if (lienzo) lienzo.classList.toggle("es-3d", on);
      if (btn3d) {
        btn3d.classList.toggle("activo", on);
        btn3d.setAttribute("aria-pressed", on);
      }
      if (ESTADO.mapa) setTimeout(() => ESTADO.mapa.invalidateSize(), 280);
    };
    if (btn3d) btn3d.onclick = () => aplicar3d(!ESTADO.tresD);
    aplicar3d(ESTADO.tresD);
    const carX = $("mpCarritoX");
    if (carX) carX.onclick = cerrarCarrito;
    const carFondo = $("mpCarritoFondo");
    if (carFondo) carFondo.onclick = cerrarCarrito;

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const car = $("mpCarrito");
      if (car && !car.hidden) { cerrarCarrito(); return; }
      if (ESTADO.viendo) cerrarHoja();
    });

    const modos = $("mpModos");
    if (modos) modos.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        modos.querySelectorAll("button").forEach((x) => {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-pressed", x === b);
        });
        if (ESTADO.mapa) ponerCapa(b.dataset.modo);
      };
    });
    const btnMapa = $("mpMapaBtn");
    if (btnMapa) btnMapa.onclick = () => {
      const nuevo = ESTADO.modo === "calles" ? "satelite" : "calles";
      if (ESTADO.mapa) ponerCapa(nuevo);
      btnMapa.classList.toggle("activo", nuevo === "satelite");
      btnMapa.setAttribute("aria-pressed", nuevo === "satelite");
      avisar(nuevo === "satelite" ? "Vista satélite" : "Vista de calles");
    };

    const radios = document.querySelectorAll("#mpRadios button");
    radios.forEach((b) => {
      b.classList.toggle("on", Number(b.dataset.r) === ESTADO.radio);
      b.onclick = () => {
        ESTADO.radio = Number(b.dataset.r);
        localStorage.setItem(CLAVE_RADIO, ESTADO.radio);
        radios.forEach((x) => x.classList.toggle("on", x === b));
        pintarRadio();
        cargar();
      };
    });

    const q = new URLSearchParams(location.search);
    const la = parseFloat(q.get("lat")), lo = parseFloat(q.get("lon"));
    if (isFinite(la) && isFinite(lo)) {
      ESTADO.pos = { lat: la, lon: lo, precision: 0, nombre: "un punto compartido" };
      ESTADO.modoUbi = "negada";
      ESTADO.manual = true;   // el punto vino en la URL: no lo pisa el GPS
    } else {
      // Abre en la última ubicación conocida mientras el GPS responde.
      const previa = leer(CLAVE_UBI, null);
      if (previa && Date.now() - previa.t < 86400000) {
        ESTADO.pos = { lat: previa.lat, lon: previa.lon, precision: 0, nombre: "tu última ubicación" };
      }
    }

    montarMapa();
    pintarEstado();
    pintarCarritoBtn();

    if (ESTADO.pos) {
      cargarClima();
      // Se abre con la última ubicación conocida para no mostrar un mapa vacío…
      setTimeout(() => { pintarRadio(); cargar(); }, 60);
      // …pero se pide el GPS igual: la última ubicación puede ser de ayer.
      setTimeout(() => { if (!ESTADO.manual) ubicar(false); }, 700);
    } else {
      ubicar(true);
    }

    // El GPS se apaga cuando la pestaña queda en segundo plano: gasta batería.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (ESTADO.vigia != null && navigator.geolocation) {
          navigator.geolocation.clearWatch(ESTADO.vigia);
          ESTADO.vigia = null;
        }
      } else if (!document.hidden && ESTADO.modoUbi === "real") {
        vigilar();
      }
    });
  }

  function render() {
    montar();
    if (ESTADO.mapa) setTimeout(() => { ESTADO.mapa.invalidateSize(); }, 90);
    if (ESTADO.pos && !ESTADO.mercados.length && !ESTADO.cargando) cargar();
  }

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
