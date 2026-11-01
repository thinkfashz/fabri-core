/* ==========================================================================
   FORGE CORE STOCK · Módulo Contabilidad · Contribuyentes
   --------------------------------------------------------------------------
   Registro local de contribuyentes (RUT) sin depender de ninguna API:
     · Se puede escribir a mano o autocompletar desde «Mi identidad».
     · Se puede importar el JSON de cualquier consulta (alias tolerantes).
     · Cada cambio crea una versión en el historial.
     · Borrar es lógico: la ficha queda marcada y se puede restaurar.
     · Todo queda auditado en el núcleo (tablas ctb_*).
   ========================================================================== */

const CTB = {
  activo: false,
  lista: [],
  filtro: "",
  editando: null,
  incluirBorrados: false,
  cargando: false,
  demo: true,
  sii: null,
  cola: [],
  actualizando: false,
  progreso: { hechos: 0, total: 0 }
};

const CTB_CAMPOS = [
  ["rut", "RUT", "12.345.678-9"],
  ["razon_social", "Razón social", "Almacén Doña Rosa SpA"],
  ["nombre_fantasia", "Nombre de fantasía", "Almacén Doña Rosa"],
  ["giro", "Giro", "Comercio al por menor"],
  ["direccion", "Domicilio", "Av. Providencia 1234"],
  ["comuna", "Comuna", "Providencia"],
  ["region", "Región", "Metropolitana"],
  ["email", "Correo", "contacto@negocio.cl"],
  ["telefono", "Teléfono", "+56 9 1234 5678"],
  ["situacion", "Situación tributaria", "Activo / Suspendido"],
  ["regimen", "Régimen", "Pro Pyme 14 D N°8"],
  ["inicio_actividades", "Inicio de actividades", "01/03/2024"]
];

function ctbClp(n) { return "$" + Math.round(Number(n || 0)).toLocaleString("es-CL"); }

/* ── ciclo ────────────────────────────────────────────────────────────── */
function ctbIniciar() {
  CTB.activo = true;
  ctbPintarFormulario();
  ctbModo(CTB.demo);
  ctbEstadoClave();
  ctbAutoRefresco();
  ctbCargar();
}

function ctbSalir() { CTB.activo = false; }

function ctbCargar() {
  if (CTB.cargando) return;
  CTB.cargando = true;
  apiTarde("contabilidad", { accion: "listar", incluir_borrados: CTB.incluirBorrados }, { maxMs: 15000 })
    .then(function (r) {
      CTB.cargando = false;
      if (!r.ok) { ctbAviso("No pude leer el registro: " + (r.error || "error")); return; }
      const d = r.data || {};
      CTB.lista = d.contribuyentes || [];
      ctbAviso("");
      ctbPintarLista();
      ctbPintarCabecera();
    })
    .catch(function (e) {
      CTB.cargando = false;
      ctbAviso("Error al leer: " + e.message);
    });
}

function ctbAviso(msg) {
  const el = document.getElementById("ctbAviso");
  if (el) el.textContent = msg || "";
}

function ctbPintarCabecera() {
  const n = CTB.lista.filter(function (c) { return !c.borrado; }).length;
  const el = document.getElementById("ctbCuenta");
  if (el) el.textContent = n + (n === 1 ? " contribuyente" : " contribuyentes") + " en el registro";
  const tot = document.getElementById("ctbTotalVersiones");
  if (tot) {
    const v = CTB.lista.reduce(function (a, c) { return a + Number(c.versiones || 0); }, 0);
    tot.textContent = v + " versiones guardadas";
  }
}

/* ── formulario ───────────────────────────────────────────────────────── */
function ctbPintarFormulario() {
  const caja = document.getElementById("ctbFormulario");
  if (!caja || caja.dataset.listo) return;
  caja.dataset.listo = "1";
  caja.innerHTML = CTB_CAMPOS.map(function (c) {
    return '<div class="ctb-campo">' +
      '<span>' + esc(c[1]) + "</span>" +
      '<input id="ctb_' + c[0] + '" data-campo="' + c[0] + '" placeholder="' + esc(c[2]) + '" ' +
        'autocomplete="off" spellcheck="false" />' +
      "</div>";
  }).join("");
}

function ctbLeerFormulario() {
  const o = {};
  CTB_CAMPOS.forEach(function (c) {
    const el = document.getElementById("ctb_" + c[0]);
    o[c[0]] = el ? el.value.trim() : "";
  });
  return o;
}

function ctbLlenarFormulario(c) {
  CTB_CAMPOS.forEach(function (campo) {
    const el = document.getElementById("ctb_" + campo[0]);
    if (el) el.value = (c && c[campo[0]]) || "";
  });
  const titulo = document.getElementById("ctbFormTitulo");
  if (titulo) titulo.textContent = (c && c.rut) ? "Editar " + c.rut : "Nuevo contribuyente";
  CTB.editando = (c && c.rut) || null;
}

function ctbDesdeIdentidad() {
  let p = {};
  try {
    const crudo = JSON.parse(localStorage.getItem("fabrick.identidad") || "{}");
    p = {
      rut: (crudo.datos && crudo.datos.rut) || "",
      razon_social: (crudo.datos && crudo.datos.nombre_comercial) || crudo.nombre || "",
      giro: (crudo.datos && crudo.datos.giro) || "",
      direccion: (crudo.datos && crudo.datos.direccion) || "",
      telefono: (crudo.datos && crudo.datos.telefono) || "",
      email: (crudo.datos && crudo.datos.email) || ""
    };
  } catch (e) { p = {}; }
  ctbLlenarFormulario(p);
  if (typeof toast === "function") toast("Datos copiados de «Mi identidad»");
}

function ctbGuardar() {
  const c = ctbLeerFormulario();
  if (!c.rut.trim()) {
    if (typeof toast === "function") toast("El RUT es obligatorio", "error");
    return;
  }
  apiTarde("contabilidad", { accion: "guardar", contribuyente: c }, { maxMs: 15000 })
    .then(function (r) {
      if (!r.ok) {
        if (typeof toast === "function") toast("No se pudo guardar: " + (r.error || "error"), "error");
        return;
      }
      if (typeof toast === "function") toast("Guardado · versión " + ((r.data && r.data.version) || 1));
      CTB.editando = null;
      ctbLlenarFormulario(null);
      ctbCargar();
    })
    .catch(function (e) {
      if (typeof toast === "function") toast("Error: " + e.message, "error");
    });
}

/* ── lista ────────────────────────────────────────────────────────────── */
function ctbPintarLista() {
  const caja = document.getElementById("ctbLista");
  if (!caja) return;
  const t = CTB.filtro.toLowerCase();
  const lista = CTB.lista.filter(function (c) {
    if (!t) return true;
    return (c.rut + " " + c.razon_social + " " + c.nombre_fantasia + " " + c.giro).toLowerCase().indexOf(t) >= 0;
  });
  if (!lista.length) {
    caja.innerHTML = '<div class="ctb-vacio">Sin contribuyentes todavía.<br>' +
      "Crea uno, copia tus datos o importa el JSON de una consulta.</div>";
    return;
  }
  caja.innerHTML = lista.map(function (c) {
    const estado = c.borrado
      ? '<span class="ctb-chip rojo">eliminado</span>'
      : '<span class="ctb-chip lima">activo</span>';
    const sit = c.situacion ? '<span class="ctb-chip">' + esc(c.situacion) + "</span>" : "";
    const reg = c.regimen ? '<span class="ctb-chip">' + esc(c.regimen) + "</span>" : "";
    return '<article class="ctb-card' + (c.borrado ? " borrado" : "") + '" data-rut="' + esc(c.rut) + '">' +
      '<div class="ctb-card-cab">' +
        '<div class="ctb-card-id">' +
          '<b>' + esc(c.razon_social || c.nombre_fantasia || "(sin nombre)") + "</b>" +
          '<span class="ctb-rut">' + esc(c.rut) + "</span>" +
          (c.giro ? '<small>' + esc(c.giro) + "</small>" : "") +
        "</div>" +
        '<div class="ctb-card-estado">' + estado +
          '<small>' + (c.versiones || 0) + " v.</small></div>" +
      "</div>" +
      '<div class="ctb-card-chips">' + sit + reg +
        (c.comuna ? '<span class="ctb-chip">' + esc(c.comuna) + "</span>" : "") +
      "</div>" +
      '<div class="ctb-card-acciones">' +
        '<button class="ctb-btn" type="button" data-ctb-editar="' + esc(c.rut) + '">Editar</button>' +
        '<button class="ctb-btn" type="button" data-ctb-hist="' + esc(c.rut) + '">Historial</button>' +
        (c.borrado
          ? '<button class="ctb-btn" type="button" data-ctb-restaurar="' + esc(c.rut) + '">Restaurar</button>'
          : '<button class="ctb-btn peligro" type="button" data-ctb-borrar="' + esc(c.rut) + '">Borrar</button>') +
      "</div></article>";
  }).join("");

  caja.querySelectorAll("[data-ctb-editar]").forEach(function (b) {
    b.addEventListener("click", function () {
      const c = CTB.lista.find(function (x) { return x.rut === b.dataset.ctbEditar; });
      ctbLlenarFormulario(c);
      const f = document.getElementById("ctbFormularioCaja");
      if (f) f.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  caja.querySelectorAll("[data-ctb-hist]").forEach(function (b) {
    b.addEventListener("click", function () { ctbVerHistorial(b.dataset.ctbHist); });
  });
  caja.querySelectorAll("[data-ctb-borrar]").forEach(function (b) {
    b.addEventListener("click", function () { ctbBorrar(b.dataset.ctbBorrar); });
  });
  caja.querySelectorAll("[data-ctb-restaurar]").forEach(function (b) {
    b.addEventListener("click", function () { ctbRestaurar(b.dataset.ctbRestaurar); });
  });
}

/* ── acciones ─────────────────────────────────────────────────────────── */
function ctbBorrar(rut) {
  if (typeof confirm === "function" && !confirm("¿Marcar " + rut + " como eliminado? Se puede restaurar.")) return;
  apiTarde("contabilidad", { accion: "borrar", rut: rut }, { maxMs: 12000 }).then(function (r) {
    if (!r.ok) { if (typeof toast === "function") toast(r.error || "no se pudo borrar", "error"); return; }
    if (typeof toast === "function") toast("Eliminado (queda en el historial)");
    ctbCargar();
  });
}

function ctbRestaurar(rut) {
  apiTarde("contabilidad", { accion: "restaurar", rut: rut }, { maxMs: 12000 }).then(function (r) {
    if (!r.ok) { if (typeof toast === "function") toast(r.error || "no se pudo restaurar", "error"); return; }
    if (typeof toast === "function") toast("Restaurado");
    ctbCargar();
  });
}

function ctbVerHistorial(rut) {
  apiTarde("contabilidad", { accion: "historial", rut: rut, limite: 50 }, { maxMs: 12000 }).then(function (r) {
    if (!r.ok) { if (typeof toast === "function") toast(r.error || "error", "error"); return; }
    const lista = (r.data && r.data.historial) || [];
    const caja = document.getElementById("ctbHistorial");
    const tit = document.getElementById("ctbHistTitulo");
    if (tit) tit.textContent = "Historial · " + rut;
    if (caja) {
      caja.innerHTML = lista.length
        ? lista.map(function (h) {
            const d = new Date(Number(h.ts || 0));
            const fecha = d.toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
            const datos = h.datos || {};
            return '<div class="ctb-hist-fila">' +
              '<span class="ctb-hist-v">v' + h.version + "</span>" +
              '<div class="ctb-hist-txt"><b>' + esc(h.accion) + "</b>" +
                "<small>" + esc(fecha) + " · " + esc(datos.razon_social || "") + "</small></div>" +
              "</div>";
          }).join("")
        : '<div class="ctb-vacio">Sin versiones.</div>';
    }
    const hoja = document.getElementById("ctbHistHoja");
    if (hoja) hoja.hidden = false;
  });
}

function ctbImportar() {
  const area = document.getElementById("ctbImportarTexto");
  const texto = area ? area.value.trim() : "";
  if (!texto) { if (typeof toast === "function") toast("Pega el JSON primero", "error"); return; }
  let datos;
  try { datos = JSON.parse(texto); }
  catch (e) { if (typeof toast === "function") toast("El JSON no es válido", "error"); return; }
  apiTarde("contabilidad", Object.assign({ accion: "importar" }, datos), { maxMs: 20000 })
    .then(function (r) {
      if (!r.ok) { if (typeof toast === "function") toast(r.error || "error", "error"); return; }
      const d = r.data || {};
      if (typeof toast === "function") {
        toast("Importados: " + (d.guardados || 0) + ((d.errores || []).length ? " · " + d.errores.length + " con error" : ""));
      }
      if (area) area.value = "";
      ctbCargar();
    });
}

/* ==========================================================================
   CONSULTA AL SII (opcional, con clave de API propia)
   --------------------------------------------------------------------------
   La app funciona 100 % local sin esto. Si el usuario tiene una clave de la
   API de situación tributaria, puede consultar un RUT y el resultado se
   mapea al registro local, guardando la respuesta completa en `extra`.
   Endpoint: POST /api/v1/sii/contribuyente/situacion-tributaria
   Cabecera: X-API-Key
   ========================================================================== */
function ctbEsApi() {
  return !!(window.FabrickNative && typeof window.FabrickNative.siiConsultar === "function");
}

function ctbEstadoClave() {
  const el = document.getElementById("ctbApiEstado");
  if (!el) return;
  if (!ctbEsApi()) {
    el.textContent = "Este build no trae el puente de consulta.";
    return;
  }
  try {
    const r = JSON.parse(window.FabrickNative.siiEstadoClave());
    el.textContent = r.configurado ? "Clave guardada en este teléfono" : "Sin clave: solo registro local";
    el.className = "ctb-api-estado" + (r.configurado ? " ok" : "");
  } catch (e) {
    el.textContent = "No pude leer el estado de la clave.";
  }
}

function ctbGuardarClaveSii() {
  const input = document.getElementById("ctbApiClave");
  const clave = input ? input.value.trim() : "";
  if (!clave) { if (typeof toast === "function") toast("Escribe la clave de la API", "error"); return; }
  if (!ctbEsApi()) return;
  try {
    const r = JSON.parse(window.FabrickNative.siiGuardarClave(clave));
    if (!r.ok) { if (typeof toast === "function") toast(r.error || "no se pudo guardar", "error"); return; }
    input.value = "";
    ctbEstadoClave();
    if (typeof toast === "function") toast("Clave guardada");
  } catch (e) {
    if (typeof toast === "function") toast("Error al guardar la clave", "error");
  }
}

/* ── modo demo ────────────────────────────────────────────────────────── */
const CTB_DEMO_NEGOCIOS = [
  { nombre: "ALMACÉN DOÑA ROSA SPA", giro: "VENTA AL POR MENOR EN ALMACENES", comuna: "PROVIDENCIA", region: "REGIÓN METROPOLITANA", menor: true, iva: true, alertas: 0, cumple: "SI" },
  { nombre: "DISTRIBUIDORA SUR LIMITADA", giro: "VENTA AL POR MAYOR DE ALIMENTOS", comuna: "MAIPÚ", region: "REGIÓN METROPOLITANA", menor: false, iva: true, alertas: 1, cumple: "SI" },
  { nombre: "COMERCIAL ANTIGUA EIRL", giro: "FERRETERÍA Y MATERIALES", comuna: "ÑUÑOA", region: "REGIÓN METROPOLITANA", menor: true, iva: true, alertas: 2, cumple: "NO" },
  { nombre: "SERVICIOS ANDINOS SPA", giro: "CONSULTORÍA INFORMÁTICA", comuna: "CONCEPCIÓN", region: "REGIÓN DEL BIOBÍO", menor: true, iva: false, alertas: 0, cumple: "SI" }
];

/** Respuesta simulada con la MISMA forma que la API real. */
function ctbDemoSii(rut, indice) {
  let h = indice != null ? Number(indice) : 0;
  if (indice == null) {
    for (let i = 0; i < rut.length; i++) h = (h * 31 + rut.charCodeAt(i)) >>> 0;
  }
  const n = CTB_DEMO_NEGOCIOS[Math.abs(h) % CTB_DEMO_NEGOCIOS.length];
  const alertas = [];
  for (let i = 0; i < n.alertas; i++) {
    alertas.push({
      titulo: i === 0 && n.cumple === "NO" ? "Alerta:" : "Observación:",
      grave: n.cumple === "NO" && i === 0,
      grupo: "0" + (25 + i),
      texto: i === 0 && n.cumple === "NO"
        ? "No registra pago de impuestos del período."
        : "Recomendación general de cumplimiento.",
      motivo: "Dato simulado del modo demo."
    });
  }
  return {
    rut: rut,
    nombre: n.nombre,
    fechaConsulta: new Date().toLocaleString("es-CL"),
    inicioActividades: true,
    fechaInicioActividades: "01-01-" + (2015 + (h % 9)),
    terminoGiro: false,
    empresaMenorTamano: n.menor,
    obligadoFacturaElectronica: true,
    primeraCategoria: n.iva,
    monedaExtranjera: false,
    cumpleObligacionTributaria: n.cumple,
    actividadesEconomicas: [
      { codigo: "620200", descripcion: n.giro, categoriaTributaria: "1", afectaIva: n.iva, fechaInicio: "01-01-2015" }
    ],
    documentosAutorizados: [
      { codigo: "0033", descripcion: "Factura Electrónica", ultimoAnioAutorizacion: "2026" },
      { codigo: "0039", descripcion: "Boleta Electrónica", ultimoAnioAutorizacion: "2026" }
    ],
    documentosElectronicos: true,
    alertas: alertas,
    demo: true
  };
}

/** Carga 4 fichas de ejemplo en el registro local (marcadas como demo). */
function ctbCargarDemo() {
  const hoy = new Date();
  const ejemplos = CTB_DEMO_NEGOCIOS.map(function (n, i) {
    const rut = ["76.543.210-3", "77.123.456-8", "78.987.654-2", "79.111.222-5"][i];
    const sim = ctbDemoSii(rut, i);
    return ctbMapearSii(sim);
  });
  let hechos = 0;
  const paso = function (i) {
    if (i >= ejemplos.length) {
      if (typeof toast === "function") toast("Ejemplos demo cargados: " + hechos);
      ctbCargar();
      return;
    }
    apiTarde("contabilidad", { accion: "guardar", contribuyente: ejemplos[i] }, { maxMs: 15000 })
      .then(function (r) { if (r.ok) hechos++; paso(i + 1); })
      .catch(function () { paso(i + 1); });
  };
  paso(0);
}

/** Borra (lógicamente) las fichas que vinieron del modo demo. */
function ctbBorrarDemo() {
  const demo = CTB.lista.filter(function (c) { return c.origen === "api-sii-demo" || c.origen === "demo"; });
  if (!demo.length) {
    if (typeof toast === "function") toast("No hay ejemplos demo en el registro");
    return;
  }
  let hechos = 0;
  const paso = function (i) {
    if (i >= demo.length) {
      if (typeof toast === "function") toast("Ejemplos demo eliminados: " + hechos);
      ctbCargar();
      return;
    }
    apiTarde("contabilidad", { accion: "borrar", rut: demo[i].rut }, { maxMs: 12000 })
      .then(function () { hechos++; paso(i + 1); })
      .catch(function () { paso(i + 1); });
  };
  paso(0);
}

function ctbModo(demo) {
  CTB.demo = !!demo;
  document.querySelectorAll("[data-ctb-modo]").forEach(function (b) {
    b.classList.toggle("activo", (b.dataset.ctbModo === "demo") === CTB.demo);
  });
  const el = document.getElementById("ctbModoNota");
  if (el) {
    el.textContent = CTB.demo
      ? "Modo demo: respuestas simuladas, sin internet ni claves. Ideal para probar el flujo."
      : "Modo real: consulta la API con tu clave. Sin clave, el registro local sigue funcionando.";
  }
  ctbEstadoClave();
}

function ctbConsultarSii() {
  const input = document.getElementById("ctbApiRut");
  const rut = input ? input.value.trim() : "";
  const caja = document.getElementById("ctbApiResultado");
  if (!rut) { if (typeof toast === "function") toast("Escribe el RUT a consultar", "error"); return; }
  if (CTB.demo) {
    if (caja) caja.innerHTML = '<div class="ctb-api-cargando">Simulando consulta (demo)…</div>';
    const sim = ctbDemoSii(rut);
    setTimeout(function () { window.FabriSii.resultado({ ok: true, data: sim }); }, 700);
    return;
  }
  if (!ctbEsApi()) return;
  if (caja) caja.innerHTML = '<div class="ctb-api-cargando">Consultando al SII…</div>';
  let r;
  try {
    r = JSON.parse(window.FabrickNative.siiConsultar(rut));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (!r.ok) {
    if (caja) caja.innerHTML = '<div class="ctb-api-error">' + esc(r.error || "error") + "</div>";
    return;
  }
  // La respuesta real llega por FabriSii.resultado.
}

window.FabriSii = {
  resultado: function (r) {
    const caja = document.getElementById("ctbApiResultado");
    if (!r || !r.ok || !r.data) {
      const msg = (r && r.error) || "La consulta no devolvió datos.";
      if (caja) caja.innerHTML = '<div class="ctb-api-error">' + esc(msg) + "</div>";
      return;
    }
    const d = r.data;
    CTB.sii = d;

    // Cola automática: guarda y sigue con el siguiente RUT.
    if (CTB.actualizando) {
      ctbGuardarSiiSilencioso(d).then(function () {
        CTB.cola.shift();
        CTB.progreso.hechos++;
        setTimeout(ctbSiguienteDeCola, 500);
      });
      return;
    }
    const acts = (d.actividadesEconomicas || []).length;
    const alertas = d.alertas || [];
    const graves = alertas.filter(function (a) { return a.grave; }).length;
    if (caja) {
      caja.innerHTML =
        '<div class="ctb-api-card">' +
          '<b>' + esc(d.nombre || "—") + "</b>" +
          '<span class="ctb-api-rut">' + esc(d.rut || "") + "</span>" +
          '<div class="ctb-api-chips">' +
            '<span class="ctb-chip ' + (String(d.cumpleObligacionTributaria || "").toUpperCase() === "SI" ? "lima" : "rojo") + '">' +
              "Obligación: " + esc(d.cumpleObligacionTributaria || "—") + "</span>" +
            '<span class="ctb-chip">' + (d.inicioActividades ? "Inicio de actividades" : "Sin inicio") + "</span>" +
            '<span class="ctb-chip">' + acts + " actividades</span>" +
            (d.empresaMenorTamano ? '<span class="ctb-chip">Menor tamaño</span>' : "") +
            (d.obligadoFacturaElectronica ? '<span class="ctb-chip">Factura electrónica</span>' : "") +
            (alertas.length ? '<span class="ctb-chip ' + (graves ? "rojo" : "") + '">' + alertas.length + " alertas</span>" : "") +
          "</div>" +
          (d.fechaInicioActividades ? '<p class="ctb-api-dato">Inicio: ' + esc(d.fechaInicioActividades) + "</p>" : "") +
          (alertas.length ? '<div class="ctb-api-alertas">' + alertas.slice(0, 3).map(function (a) {
            return '<div class="ctb-api-alerta' + (a.grave ? " grave" : "") + '">' +
              "<b>" + esc(a.titulo || "Alerta") + "</b><span>" + esc(a.texto || a.motivo || "") + "</span></div>";
          }).join("") + "</div>" : "") +
          '<button class="ctb-btn principal" id="btnCtbGuardarSii" type="button">Guardar en el registro</button>' +
        "</div>";
    }
  }
};

/** Convierte la respuesta del SII a la ficha local (todo queda en `extra`). */
function ctbMapearSii(d) {
  const acts = (d.actividadesEconomicas || []).map(function (a) {
    return {
      codigo: a.codigo || "",
      descripcion: a.descripcion || "",
      categoria: a.categoriaTributaria || "",
      afecto_iva: a.afectaIva,
      desde: a.fechaInicio || ""
    };
  });
  const situaciones = [];
  if (d.cumpleObligacionTributaria) situaciones.push("Obligación: " + d.cumpleObligacionTributaria);
  if (d.terminoGiro) situaciones.push("Término de giro");
  if (d.empresaMenorTamano) situaciones.push("Empresa de menor tamaño");
  return {
    rut: d.rut || "",
    razon_social: d.nombre || "",
    nombre_fantasia: "",
    giro: (acts[0] && acts[0].descripcion) || "",
    actividades: JSON.stringify(acts),
    direccion: "",
    comuna: "",
    region: "",
    email: "",
    telefono: "",
    situacion: situaciones.join(" · "),
    regimen: "",
    inicio_actividades: d.fechaInicioActividades || "",
    extra: JSON.stringify(d),
    origen: (d && d.demo) ? "api-sii-demo" : "api-sii"
  };
}

/* ── automatización: actualizar todos los RUT de una vez ──────────────── */
const CTB_AUTO_CLAVE = "ctb.auto.refresco";
const CTB_AUTO_DIAS = 7;

function ctbProgreso(texto) {
  const el = document.getElementById("ctbProgreso");
  if (!el) return;
  if (!texto) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = texto;
}

/** Pide la situación tributaria de cada RUT guardado, de a uno. */
function ctbActualizarTodos(silencioso) {
  if (CTB.actualizando) return;
  const objetivos = CTB.lista.filter(function (c) { return !c.borrado && c.rut; });
  if (!objetivos.length) {
    if (!silencioso && typeof toast === "function") toast("No hay contribuyentes para actualizar");
    return;
  }
  CTB.cola = objetivos.map(function (c) { return c.rut; });
  CTB.progreso = { hechos: 0, total: CTB.cola.length };
  CTB.actualizando = true;
  ctbProgreso("Actualizando 0/" + CTB.progreso.total + "…");
  ctbSiguienteDeCola();
}

function ctbSiguienteDeCola() {
  if (!CTB.cola.length) {
    CTB.actualizando = false;
    ctbProgreso("");
    try { localStorage.setItem(CTB_AUTO_CLAVE, String(Date.now())); } catch (e) {}
    if (typeof toast === "function") toast("Actualización terminada: " + CTB.progreso.total + " RUT");
    ctbCargar();
    return;
  }
  const rut = CTB.cola[0];
  ctbProgreso("Actualizando " + (CTB.progreso.hechos + 1) + "/" + CTB.progreso.total + " · " + rut);
  if (CTB.demo) {
    // Se conserva la identidad del ejemplo: se busca por el nombre guardado,
    // así refrescar no cambia de negocio ni duplica fichas.
    const fila = CTB.lista.find(function (c) { return c.rut === rut; });
    let idx = 0;
    if (fila) {
      const k = CTB_DEMO_NEGOCIOS.findIndex(function (n) { return n.nombre === fila.razon_social; });
      if (k >= 0) idx = k;
    }
    const sim = ctbDemoSii(rut, idx);
    setTimeout(function () { window.FabriSii.resultado({ ok: true, data: sim }); }, 450);
    return;
  }
  if (!ctbEsApi()) {
    CTB.cola = [];
    ctbSiguienteDeCola();
    return;
  }
  let r;
  try { r = JSON.parse(window.FabrickNative.siiConsultar(rut)); }
  catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) {
    // Si falla un RUT (clave, red, límite), se salta y sigue con el resto.
    CTB.cola.shift();
    CTB.progreso.hechos++;
    setTimeout(ctbSiguienteDeCola, 400);
  }
}

/** Guarda sin pintar la tarjeta: se usa en la cola automática. */
function ctbGuardarSiiSilencioso(d) {
  const c = ctbMapearSii(d);
  return apiTarde("contabilidad", { accion: "guardar", contribuyente: c }, { maxMs: 15000 })
    .then(function () { return true; })
    .catch(function () { return false; });
}

/** Actualización automática al abrir (cada 7 días, sólo si hay clave). */
function ctbAutoRefresco() {
  const chk = document.getElementById("ctbAutoRefresco");
  if (!chk) return;
  try { chk.checked = localStorage.getItem("ctb.auto.on") === "1"; } catch (e) {}
  if (!chk.checked) return;
  let ultimo = 0;
  try { ultimo = Number(localStorage.getItem(CTB_AUTO_CLAVE) || 0); } catch (e) {}
  const dias = (Date.now() - ultimo) / 86400000;
  if (dias < CTB_AUTO_DIAS) return;
  if (!CTB.demo) {
    let listo = false;
    try { listo = JSON.parse(window.FabrickNative.siiEstadoClave()).configurado; } catch (e) {}
    if (!listo) return;
  }
  setTimeout(function () { ctbActualizarTodos(true); }, 1200);
}

function ctbGuardarSii() {
  if (!CTB.sii) return;
  const c = ctbMapearSii(CTB.sii);
  apiTarde("contabilidad", { accion: "guardar", contribuyente: c }, { maxMs: 15000 })
    .then(function (r) {
      if (!r.ok) { if (typeof toast === "function") toast(r.error || "error", "error"); return; }
      if (typeof toast === "function") toast("Guardado desde el SII · versión " + ((r.data && r.data.version) || 1));
      ctbLlenarFormulario(c);
      ctbCargar();
    });
}

/* ── eventos ──────────────────────────────────────────────────────────── */
(function ctbMontar() {
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.closest("#btnCtbGuardar")) { ctbGuardar(); return; }
    if (t.closest("#btnCtbIdentidad")) { ctbDesdeIdentidad(); return; }
    if (t.closest("#btnCtbLimpiar")) { ctbLlenarFormulario(null); return; }
    if (t.closest("#btnCtbImportar")) { ctbImportar(); return; }
    if (t.closest("#btnCtbRefrescar")) { ctbCargar(); return; }
    if (t.closest("#btnCtbGuardarClave")) { ctbGuardarClaveSii(); return; }
    if (t.closest("#btnCtbConsultarSii")) { ctbConsultarSii(); return; }
    if (t.closest("#btnCtbGuardarSii")) { ctbGuardarSii(); return; }
    if (t.closest("#btnCtbActualizarTodos")) { ctbActualizarTodos(false); return; }
    if (t.closest("#btnCtbDemoCargar")) { ctbCargarDemo(); return; }
    if (t.closest("#btnCtbDemoBorrar")) { ctbBorrarDemo(); return; }
    const modo = t.closest("[data-ctb-modo]");
    if (modo) { ctbModo(modo.dataset.ctbModo === "demo"); return; }
    const enlace = t.closest("[data-url]");
    if (enlace && enlace.dataset.url) {
      try { window.FabrickNative.abrirUrl(enlace.dataset.url); } catch (e) {
        if (typeof toast === "function") toast("No se pudo abrir el enlace");
      }
      return;
    }
    if (t.closest("#btnCtbVerBorrados")) {
      CTB.incluirBorrados = !CTB.incluirBorrados;
      t.closest("#btnCtbVerBorrados").classList.toggle("activo", CTB.incluirBorrados);
      ctbCargar();
      return;
    }
    if (t.closest("[data-cerrar-hist]")) {
      const h = document.getElementById("ctbHistHoja");
      if (h) h.hidden = true;
      return;
    }
  });
  document.addEventListener("change", function (ev) {
    if (ev.target && ev.target.id === "ctbAutoRefresco") {
      try { localStorage.setItem("ctb.auto.on", ev.target.checked ? "1" : "0"); } catch (e) {}
      if (typeof toast === "function") {
        toast(ev.target.checked ? "Se actualizará cada 7 días al abrir" : "Actualización automática apagada");
      }
    }
  });
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "ctbBuscar") {
      CTB.filtro = ev.target.value || "";
      ctbPintarLista();
    }
  });
})();
