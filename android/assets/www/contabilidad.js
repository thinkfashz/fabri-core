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
  cargando: false
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
  document.addEventListener("input", function (ev) {
    if (ev.target && ev.target.id === "ctbBuscar") {
      CTB.filtro = ev.target.value || "";
      ctbPintarLista();
    }
  });
})();
