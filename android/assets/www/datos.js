/* ==========================================================================
   FORGE CORE STOCK · hoja de datos editable (SQLite local)
   --------------------------------------------------------------------------
   Todo lo que se ve acá sale de Rust: `sqlite` con acciones tablas, esquema,
   filas, actualizar, insertar, borrar, importar, exportar y auditoria.

   Reglas de la hoja:
     · Nada se escribe hasta apretar «Guardar»; antes se ve el cambio en
       amarillo para poder descartarlo.
     · Cada escritura deja rastro en `auditoria_datos` (lo hace Rust).
     · Las columnas binarias (BLOB) no se editan.
     · El token y los secretos no pasan por acá: esta hoja es sólo datos.
   ========================================================================== */

"use strict";

const hoja = {
  tablas: [],
  tabla: null,
  columnas: [],
  tipos: {},
  filas: [],
  total: 0,
  limite: 20,
  desplazamiento: 0,
  editable: false,
  modo: "ver",           // ver | editar
  cambios: new Map(),    // _fila -> { columna: valor }
  borradores: [],        // filas nuevas, todavía sin guardar
  seleccion: null,       // _fila marcada para borrar
  importacion: null,     // { filas: [...], columnas: [...] }
  cargando: false
};

/* ------------------------------------------------------------------ arranque */

function hojaIniciar() {
  if (!hoja.tablas.length) {
    hojaCargarTablas();
  } else {
    hojaPintarTablas();
    hojaPintarResumen();
  }
  hojaIniciarCanvasStream();
  hojaProbarConexion();
}

function hojaPintarResumen(extra) {
  const cont = document.getElementById("sqlResumen");
  if (!cont) return;
  const datos = extra || hoja.resumen || {};
  cont.innerHTML = `
    <div class="sql-dato">
      <span class="sql-dato-etq">Tablas</span>
      <strong>${datos.tablas == null ? "—" : datos.tablas}</strong>
    </div>
    <div class="sql-dato">
      <span class="sql-dato-etq">Filas totales</span>
      <strong>${datos.filas == null ? "—" : datos.filas}</strong>
    </div>
    <div class="sql-dato">
      <span class="sql-dato-etq">Archivo</span>
      <strong>${datos.bytes == null ? "—" : bytes(datos.bytes)}</strong>
    </div>
    <div class="sql-dato destacado">
      <span class="sql-dato-etq">SQLite</span>
      <strong>${esc(datos.version || "—")}</strong>
    </div>`;
}

function hojaCargarTablas() {
  const cont = document.getElementById("sqlTablas");
  if (cont) cont.innerHTML = `<p class="nota">Leyendo la base…</p>`;
  // `sqlite` es una operación pesada (hasta 20 s): con `api()` a secas la
  // página se quedaba en «Leyendo la base…» y el hilo de la interfaz parado.
  apiTarde("sqlite", { accion: "tablas" }, { maxMs: 25000 }).then(function (r) {
    if (!r.ok) {
      if (cont) cont.innerHTML = `<div class="sql-error">${esc(r.error || "no se pudo leer la base")}</div>`;
      hojaPintarResumen({});
      return;
    }
    const d = r.data || {};
    hoja.tablas = Array.isArray(d.tablas) ? d.tablas : [];
    hoja.resumen = {
      tablas: hoja.tablas.length,
      filas: d.total_filas,
      bytes: d.bytes,
      version: d.version
    };
    hojaPintarResumen();
    hojaPintarTablas();
  });
}

function hojaPintarTablas() {
  const cont = document.getElementById("sqlTablas");
  if (!cont) return;
  if (!hoja.tablas.length) {
    cont.innerHTML = `<p class="nota">La base todavía no tiene tablas.</p>`;
    return;
  }
  cont.innerHTML = hoja.tablas.map((t) => `
    <button class="sql-tabla-item" type="button" data-tabla="${esc(t.nombre)}">
      <span class="sql-icono">▤</span>
      <span class="sql-nombre">
        <strong>${esc(t.nombre)}</strong>
        <span>${t.filas} fila(s) · ${t.columnas} columna(s)</span>
      </span>
      <span class="sql-flecha">›</span>
    </button>`).join("");
}

/* ------------------------------------------------------------------ abrir tabla */

function hojaAbrirTabla(nombre) {
  const meta = hoja.tablas.find((t) => t.nombre === nombre);
  hoja.tabla = nombre;
  hoja.desplazamiento = 0;
  hoja.cambios.clear();
  hoja.borradores = [];
  hoja.seleccion = null;
  hoja.modo = "ver";
  hoja.importacion = null;
  hoja.columnas = [];
  hoja.tipos = {};
  hoja.filas = [];
  hoja.total = meta ? meta.filas : 0;
  hoja.editable = false;

  const detalle = document.getElementById("sqlDetalle");
  if (detalle) detalle.hidden = false;
  const importacion = document.getElementById("sqlImportacion");
  if (importacion) importacion.hidden = true;
  const auditoria = document.getElementById("sqlAuditoriaBloque");
  if (auditoria) auditoria.hidden = true;

  const titulo = document.getElementById("sqlDetalleTitulo");
  if (titulo) titulo.textContent = nombre;
  const envoltura = document.getElementById("sqlTablaEnvoltura");
  if (envoltura) envoltura.innerHTML = `<p class="nota">Leyendo ${esc(nombre)}…</p>`;

  // Esquema y filas van encadenados en segundo plano: la hoja se abre al
  // instante y los datos llegan cuando el núcleo puede.
  apiTarde("sqlite", { accion: "esquema", tabla: nombre }, { maxMs: 25000 })
    .then(function (esq) {
      if (esq.ok && esq.data) {
        (esq.data.columnas || []).forEach((c) => {
          hoja.tipos[c.nombre] = (c.tipo || "").toUpperCase();
        });
        hoja.columnasEsquema = esq.data.columnas || [];
      }
      return hojaCargarFilas();
    });
}

function hojaCargarFilas() {
  if (!hoja.tabla) return Promise.resolve();
  // Se guarda la tabla pedida: si el usuario abre otra mientras esta llega, la
  // respuesta vieja no debe pintar encima de la nueva.
  const pedida = hoja.tabla;
  hoja.cargando = true;
  return apiTarde("sqlite", {
    accion: "filas",
    tabla: pedida,
    limite: hoja.limite,
    desplazamiento: hoja.desplazamiento
  }, { maxMs: 25000 }).then(function (r) {
    hoja.cargando = false;
    if (hoja.tabla !== pedida) return;
    if (!r.ok) {
      const envoltura = document.getElementById("sqlTablaEnvoltura");
      if (envoltura) envoltura.innerHTML = `<div class="sql-error">${esc(r.error || "no se pudo leer la tabla")}</div>`;
      return;
    }
    const d = r.data || {};
    hoja.columnas = d.columnas || [];
    hoja.filas = d.filas || [];
    hoja.total = d.total || 0;
    hoja.editable = !!d.editable;
    hoja.cambios.clear();
    hoja.seleccion = null;
    hojaPintarTabla();
    hojaPintarBotones();
  });
}

function hojaPintarBotones() {
  const modo = document.getElementById("btnSqlModo");
  const agregar = document.getElementById("btnSqlAgregar");
  const guardar = document.getElementById("btnSqlGuardar");
  const descartar = document.getElementById("btnSqlDescartar");
  const pista = document.getElementById("sqlPistaEdicion");
  const pendientes = hoja.cambios.size + hoja.borradores.length;

  if (modo) {
    modo.textContent = hoja.modo === "editar" ? "Terminar edición" : "Editar";
    modo.classList.toggle("btn-primario", hoja.modo !== "editar");
    modo.disabled = !hoja.editable;
  }
  if (agregar) agregar.disabled = !hoja.editable || hoja.modo !== "editar";
  if (guardar) {
    guardar.disabled = pendientes === 0;
    guardar.textContent = pendientes ? `Guardar (${pendientes})` : "Guardar";
  }
  if (descartar) descartar.disabled = pendientes === 0;
  if (pista) {
    if (!hoja.editable) {
      pista.className = "nota sql-pista-alerta";
      pista.textContent = "Esta tabla no expone rowid: se puede leer, pero no editar desde la hoja.";
    } else if (hoja.modo === "editar") {
      pista.className = "nota";
      pista.textContent = "Toca una celda para cambiarla. Los cambios quedan en amarillo hasta que aprietes «Guardar».";
    } else {
      pista.className = "nota";
      pista.textContent = "En modo lectura. Aprieta «Editar» para corregir celdas, agregar o borrar filas.";
    }
  }

  const pagina = document.getElementById("sqlPagina");
  if (pagina) {
    const desde = hoja.total === 0 ? 0 : hoja.desplazamiento + 1;
    const hasta = Math.min(hoja.desplazamiento + hoja.limite, hoja.total);
    pagina.textContent = `${desde}–${hasta} de ${hoja.total}`;
  }
  const anterior = document.getElementById("btnSqlAnterior");
  const siguiente = document.getElementById("btnSqlSiguiente");
  if (anterior) anterior.disabled = hoja.desplazamiento <= 0;
  if (siguiente) siguiente.disabled = hoja.desplazamiento + hoja.limite >= hoja.total;
}

/* --------------------------------------------------------------------- pintar */

function hojaValorCelda(fila, col) {
  const cambios = hoja.cambios.get(String(fila._fila));
  if (cambios && Object.prototype.hasOwnProperty.call(cambios, col)) {
    return cambios[col];
  }
  return fila[col];
}

function hojaCeldaHtml(valor) {
  if (valor === null || valor === undefined) {
    return `<span class="sql-null">null</span>`;
  }
  if (typeof valor === "object") {
    return esc(JSON.stringify(valor));
  }
  const texto = String(valor);
  return esc(texto.length > 120 ? texto.slice(0, 120) + "…" : texto);
}

function hojaPintarTabla() {
  const cont = document.getElementById("sqlTablaEnvoltura");
  if (!cont) return;

  const columnasDatos = hoja.columnas.filter((c) => c !== "_fila");
  const meta = document.getElementById("sqlDetalleMeta");
  if (meta) {
    meta.textContent = `${hoja.total} fila(s) · ${columnasDatos.length} columna(s)`
      + (hoja.modo === "editar" ? " · editando" : "");
  }

  const chips = document.getElementById("sqlColumnas");
  if (chips) {
    chips.innerHTML = (hoja.columnasEsquema || []).map((c) => {
      const tipo = (c.tipo || "").toUpperCase();
      const esPk = c.pk;
      const esBinaria = tipo.indexOf("BLOB") >= 0;
      const clase = ["sql-col"];
      if (esPk) clase.push("pk");
      const etiqueta = esBinaria ? "sólo lectura" : tipo || "sin tipo";
      return `<span class="${clase.join(" ")}"><b>${esc(c.nombre)}</b> ${esc(etiqueta)}${esPk ? " · pk" : ""}</span>`;
    }).join("");
  }

  if (!hoja.columnas.length) {
    cont.innerHTML = `<p class="nota">La tabla no tiene columnas para mostrar.</p>`;
    return;
  }

  const cabecera = `<tr>`
    + (hoja.editable ? `<th class="col-fila">#</th>` : "")
    + columnasDatos.map((c) => `<th>${esc(c)}</th>`).join("")
    + `</tr>`;

  const borradores = hoja.borradores.map((b, i) => {
    const celdas = columnasDatos.map((col) => {
      const binaria = hojaEsBinaria(col);
      if (binaria) return `<td class="sql-null">—</td>`;
      return `<td class="celda-editando"><input type="text" data-nueva="${esc(col)}" data-indice="${i}"
                value="${esc(b[col] == null ? "" : String(b[col]))}"
                placeholder="${esc(hoja.tipos[col] || "texto")}" /></td>`;
    }).join("");
    return `<tr class="fila-nueva"><td class="col-fila">nueva</td>${celdas}</tr>`;
  }).join("");

  const filas = hoja.filas.map((fila) => {
    const id = String(fila._fila);
    const cambios = hoja.cambios.get(id);
    const clases = ["fila-dato"];
    if (cambios && Object.keys(cambios).length) clases.push("fila-cambiada");
    if (hoja.seleccion === fila._fila) clases.push("fila-seleccionada");
    const celdas = columnasDatos.map((col) => {
      const binaria = hojaEsBinaria(col);
      const editable = hoja.modo === "editar" && hoja.editable && !binaria;
      const clasesCelda = ["celda"];
      if (editable) clasesCelda.push("celda-editable");
      return `<td class="${clasesCelda.join(" ")}"
                  data-fila="${id}" data-col="${esc(col)}"
                  data-editable="${editable ? "1" : "0"}">${hojaCeldaHtml(hojaValorCelda(fila, col))}</td>`;
    }).join("");
    const numero = hoja.editable
      ? `<td class="col-fila" data-seleccion="${id}">${id}</td>`
      : "";
    return `<tr class="${clases.join(" ")}" data-idfila="${id}">${numero}${celdas}</tr>`;
  }).join("");

  cont.innerHTML = `<table class="sql-tabla">
      <thead>${cabecera}</thead>
      <tbody>${borradores}${filas || ""}</tbody>
    </table>`
    + (hoja.filas.length || hoja.borradores.length
      ? ""
      : `<p class="sql-vacio">La tabla está vacía.${hoja.editable ? " Usa «+ Fila» para crear la primera." : ""}</p>`);
}

function hojaEsBinaria(col) {
  const tipo = (hoja.tipos[col] || "").toUpperCase();
  return tipo.indexOf("BLOB") >= 0;
}

/* ------------------------------------------------------------------ edición */

function hojaAlternarModo() {
  if (!hoja.editable) {
    toast("Esta tabla no se puede editar desde la hoja", "error");
    return;
  }
  hoja.modo = hoja.modo === "editar" ? "ver" : "editar";
  if (hoja.modo === "ver") {
    hoja.borradores = [];
  }
  hojaPintarTabla();
  hojaPintarBotones();
}

function hojaEmpezarEdicion(td) {
  if (!td || td.dataset.editable !== "1") return;
  if (td.querySelector("input")) return;
  const fila = td.dataset.fila;
  const col = td.dataset.col;
  const origen = hoja.filas.find((f) => String(f._fila) === String(fila));
  const valor = origen ? origen[col] : null;

  const texto = valor === null || valor === undefined
    ? ""
    : (typeof valor === "object" ? JSON.stringify(valor) : String(valor));
  td.dataset.previo = td.innerHTML;
  td.classList.add("celda-editando");
  td.innerHTML = `<input type="text" value="${esc(texto)}"
      placeholder="${esc(hoja.tipos[col] || "texto")}" />`;
  const input = td.querySelector("input");
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* nada */ }

  let cerrado = false;
  const cerrar = (guardar) => {
    if (cerrado) return;
    cerrado = true;
    const nuevo = input.value;
    td.classList.remove("celda-editando");
    if (guardar) {
      const convertido = hojaConvertir(col, nuevo, valor);
      const original = valor === undefined ? null : valor;
      const iguales = String(convertido === null ? "" : convertido) === String(original === null ? "" : original);
      let cambios = hoja.cambios.get(String(fila));
      if (iguales) {
        if (cambios) {
          delete cambios[col];
          if (!Object.keys(cambios).length) hoja.cambios.delete(String(fila));
        }
      } else {
        if (!cambios) { cambios = {}; hoja.cambios.set(String(fila), cambios); }
        cambios[col] = convertido;
      }
      const filaObj = hoja.filas.find((f) => String(f._fila) === String(fila));
      const mostrar = filaObj ? hojaValorCelda(filaObj, col) : convertido;
      td.innerHTML = hojaCeldaHtml(mostrar);
      const tr = td.parentNode;
      if (tr) {
        tr.classList.toggle("fila-cambiada", hoja.cambios.has(String(fila)));
      }
      hojaPintarBotones();
    } else {
      td.innerHTML = td.dataset.previo || hojaCeldaHtml(valor);
    }
    delete td.dataset.previo;
  };

  input.addEventListener("blur", () => cerrar(true));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
    if (ev.key === "Escape") { ev.preventDefault(); cerrar(false); }
  });
}

/** Convierte el texto de la celda al tipo de la columna. */
function hojaConvertir(col, texto, anterior) {
  const tipo = (hoja.tipos[col] || "").toUpperCase();
  if (texto === "") {
    if (anterior === "" || anterior === undefined) return "";
    return null;
  }
  if (tipo.indexOf("INT") >= 0) {
    const n = Number(texto.trim());
    return Number.isFinite(n) ? Math.trunc(n) : texto;
  }
  if (tipo.indexOf("REAL") >= 0 || tipo.indexOf("FLOA") >= 0 || tipo.indexOf("DOUB") >= 0
      || tipo.indexOf("NUM") >= 0 || tipo.indexOf("DEC") >= 0) {
    const n = Number(texto.trim());
    return Number.isFinite(n) ? n : texto;
  }
  if (tipo.indexOf("BOOL") >= 0) {
    const t = texto.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "si" || t === "sí") return 1;
    if (t === "false" || t === "0" || t === "no") return 0;
  }
  return texto;
}

/* --------------------------------------------------------------- filas nuevas */

function hojaAgregarBorrador() {
  if (!hoja.editable) return;
  if (hoja.modo !== "editar") hoja.modo = "editar";
  hoja.borradores.push({});
  hojaPintarTabla();
  hojaPintarBotones();
  const primera = document.querySelector('#sqlTablaEnvoltura input[data-nueva]');
  if (primera) primera.focus();
}

function hojaSeleccionarFila(id) {
  hoja.seleccion = hoja.seleccion === Number(id) ? null : Number(id);
  hojaPintarTabla();
}

async function hojaBorrarSeleccionada() {
  if (!hoja.seleccion) {
    toast("Primero toca el número de la fila que quieres borrar");
    return;
  }
  const id = hoja.seleccion;
  const fila = hoja.filas.find((f) => Number(f._fila) === Number(id));
  const resumen = fila ? Object.keys(fila).filter((k) => k !== "_fila")
    .slice(0, 3).map((k) => `${k}=${fila[k]}`).join(" · ") : `fila ${id}`;
  if (!window.confirm(`¿Borrar la fila ${id}?\n\n${resumen}\n\nEsta acción no se puede deshacer.`)) {
    return;
  }
  const r = await apiTarde("sqlite", { accion: "borrar", tabla: hoja.tabla, fila: id }, { maxMs: 20000 });
  if (!r.ok) {
    toast("No se borró: " + (r.error || "error"), "error");
    return;
  }
  toast("Fila borrada");
  hoja.seleccion = null;
  hojaCargarFilas();
  hojaCargarTablas();
}

/* -------------------------------------------------------------------- guardar */

async function hojaGuardar() {
  if (!hoja.tabla) return;
  if (!hoja.cambios.size && !hoja.borradores.length) {
    toast("No hay cambios pendientes");
    return;
  }
  let insertadas = 0;
  let actualizadas = 0;
  const errores = [];

  // 1) Filas nuevas, en orden.
  for (let i = 0; i < hoja.borradores.length; i++) {
    const borrador = hoja.borradores[i];
    const valores = {};
    let vacia = true;
    Object.keys(borrador).forEach((col) => {
      const v = borrador[col];
      if (v !== "" && v !== null && v !== undefined) vacia = false;
      valores[col] = v;
    });
    if (vacia) continue;
    const r = await apiTarde("sqlite", { accion: "insertar", tabla: hoja.tabla, valores }, { maxMs: 20000 });
    if (r.ok) {
      insertadas++;
    } else {
      errores.push(`fila nueva ${i + 1}: ${r.error || "error"}`);
    }
  }

  // 2) Cambios por fila.
  for (const [id, cambios] of hoja.cambios) {
    if (!Object.keys(cambios).length) continue;
    const r = await apiTarde("sqlite", {
      accion: "actualizar",
      tabla: hoja.tabla,
      fila: Number(id),
      cambios
    }, { maxMs: 20000 });
    if (r.ok) {
      actualizadas++;
    } else {
      errores.push(`fila ${id}: ${r.error || "error"}`);
    }
  }

  if (errores.length) {
    toast(`${insertadas} nueva(s), ${actualizadas} actualizada(s), ${errores.length} error(es)`, "error");
    const envoltura = document.getElementById("sqlTablaEnvoltura");
    if (envoltura) {
      const aviso = document.createElement("div");
      aviso.className = "sql-error";
      aviso.textContent = errores.slice(0, 4).join(" · ");
      envoltura.insertBefore(aviso, envoltura.firstChild);
    }
  } else {
    toast(`${insertadas} nueva(s), ${actualizadas} actualizada(s)`);
  }

  hoja.borradores = [];
  hoja.cambios.clear();
  hojaCargarFilas();
  hojaCargarTablas();
  if (document.getElementById("sqlAuditoriaBloque")
      && !document.getElementById("sqlAuditoriaBloque").hidden) {
    hojaVerAuditoria();
  }
}

function hojaDescartar() {
  if (!hoja.cambios.size && !hoja.borradores.length) return;
  if (!window.confirm("¿Descartar los cambios que no guardaste?")) return;
  hoja.cambios.clear();
  hoja.borradores = [];
  hoja.seleccion = null;
  hojaPintarTabla();
  hojaPintarBotones();
}

/* -------------------------------------------------------------- exportar CSV */

function hojaCsvCampo(valor) {
  if (valor === null || valor === undefined) return "";
  let texto = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  if (/[",\n\r]/.test(texto)) {
    texto = '"' + texto.replace(/"/g, '""') + '"';
  }
  return texto;
}

async function hojaAExportar() {
  if (!hoja.tabla) {
    toast("Abre una tabla primero", "error");
    return;
  }
  const r = await apiTarde("sqlite", { accion: "exportar", tabla: hoja.tabla }, { maxMs: 25000 });
  if (!r.ok) {
    toast("No se pudo exportar: " + (r.error || "error"), "error");
    return;
  }
  const d = r.data || {};
  const columnas = (d.columnas || []).filter((c) => c !== "_fila");
  const filas = d.filas || [];
  const csv = [columnas.map(hojaCsvCampo).join(",")]
    .concat(filas.map((f) => columnas.map((c) => hojaCsvCampo(f[c])).join(",")))
    .join("\n");
  const nombre = `fabrick-${hoja.tabla}-${hojaSello()}.csv`;
  hojaGuardarArchivo(nombre, csv, `${filas.length} fila(s)`);
}

async function hojaAExportarJson() {
  if (!hoja.tabla) {
    toast("Abre una tabla primero", "error");
    return;
  }
  const r = await apiTarde("sqlite", { accion: "exportar", tabla: hoja.tabla }, { maxMs: 25000 });
  if (!r.ok) {
    toast("No se pudo exportar: " + (r.error || "error"), "error");
    return;
  }
  const d = r.data || {};
  const doc = {
    tipo: "fabrick-tabla",
    version: 1,
    generado: Math.floor(Date.now() / 1000),
    tabla: hoja.tabla,
    columnas: (d.columnas || []).filter((c) => c !== "_fila"),
    filas: (d.filas || []).map((f) => {
      const copia = {};
      Object.keys(f).forEach((k) => { if (k !== "_fila") copia[k] = f[k]; });
      return copia;
    }),
    truncado: !!d.truncado
  };
  hojaGuardarArchivo(`fabrick-${hoja.tabla}-${hojaSello()}.json`,
    JSON.stringify(doc, null, 2), `${doc.filas.length} fila(s)`);
}

function hojaGuardarArchivo(nombre, contenido, detalle) {
  let r;
  try {
    if (!window.FabrickNative || typeof window.FabrickNative.guardarArchivo !== "function") {
      toast("El puente nativo no permite guardar archivos", "error");
      return;
    }
    r = JSON.parse(window.FabrickNative.guardarArchivo(nombre, contenido));
  } catch (e) {
    r = { ok: false, error: String(e) };
  }
  if (r.ok) {
    toast(`Guardado ${r.archivo} (${detalle})`);
    const mensaje = document.getElementById("conxRespaldoMensaje");
    if (mensaje) mensaje.textContent = `Archivo: ${r.ruta}`;
  } else {
    toast("No se pudo guardar: " + (r.error || "error"), "error");
  }
}

function hojaSello() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}`;
}

/* --------------------------------------------------------------- importar CSV */

function hojaLeerCsvArchivo(input) {
  const archivo = input && input.files && input.files[0];
  if (!archivo) return;
  if (archivo.size > 10 * 1024 * 1024) {
    toast("El archivo supera los 10 MB", "error");
    input.value = "";
    return;
  }
  const lector = new FileReader();
  lector.onload = () => {
    try {
      hojaPrepararImportacion(String(lector.result || ""), archivo.name);
    } catch (e) {
      toast("No se pudo leer el CSV: " + e, "error");
    }
    input.value = "";
  };
  lector.onerror = () => {
    toast("No se pudo leer el archivo", "error");
    input.value = "";
  };
  lector.readAsText(archivo, "UTF-8");
}

function hojaParseCsv(texto) {
  let t = texto;
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const filas = [];
  let campo = "";
  let fila = [];
  let entreComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === "," || c === ";") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo.length || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((v) => String(v).trim() !== ""));
}

function hojaPrepararImportacion(texto, nombreArchivo) {
  if (!hoja.tabla) {
    toast("Abre la tabla destino antes de importar", "error");
    return;
  }
  const crudo = hojaParseCsv(texto);
  if (crudo.length < 2) {
    toast("El CSV necesita una fila de encabezados y al menos una de datos", "error");
    return;
  }
  const encabezados = crudo[0].map((h) => String(h).trim());
  const conocidas = hoja.columnas.filter((c) => c !== "_fila");
  const desconocidas = encabezados.filter((h) => h && conocidas.indexOf(h) < 0);
  if (desconocidas.length) {
    toast("Columnas que no existen en la tabla: " + desconocidas.join(", "), "error");
    return;
  }
  const filas = [];
  for (let i = 1; i < crudo.length; i++) {
    const valores = {};
    encabezados.forEach((h, j) => {
      if (!h) return;
      if (hojaEsBinaria(h)) return;
      const texto = crudo[i][j] === undefined ? "" : crudo[i][j];
      valores[h] = hojaConvertir(h, texto, null);
    });
    filas.push(valores);
  }
  if (filas.length > 1000) {
    toast("Máximo 1000 filas por importación: divide el archivo", "error");
    return;
  }
  hoja.importacion = { filas, columnas: encabezados.filter((h) => h) };

  const bloque = document.getElementById("sqlImportacion");
  const meta = document.getElementById("sqlImportacionMeta");
  const tabla = document.getElementById("sqlImportacionTabla");
  if (meta) {
    meta.textContent = `${nombreArchivo || "CSV"} · ${filas.length} fila(s) para ${hoja.tabla}`
      + (filas.length > 8 ? " · se muestran las primeras 8" : "");
  }
  if (tabla) {
    const cols = hoja.importacion.columnas;
    const cabecera = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    const cuerpo = filas.slice(0, 8).map((f) => `<tr>${cols.map((c) => `<td>${hojaCeldaHtml(f[c])}</td>`).join("")}</tr>`).join("");
    tabla.innerHTML = `<table class="sql-tabla"><thead>${cabecera}</thead><tbody>${cuerpo}</tbody></table>`;
  }
  if (bloque) {
    bloque.hidden = false;
    bloque.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function hojaConfirmarImportacion(reemplazar) {
  if (!hoja.importacion || !hoja.tabla) return;
  const n = hoja.importacion.filas.length;
  const texto = reemplazar
    ? `¿Importar ${n} fila(s) en ${hoja.tabla} reemplazando las que tengan la misma clave?`
    : `¿Agregar ${n} fila(s) a ${hoja.tabla}?`;
  if (!window.confirm(texto)) return;
  const r = await apiTarde("sqlite", {
    accion: "importar",
    tabla: hoja.tabla,
    filas: hoja.importacion.filas,
    reemplazar: !!reemplazar
  }, { maxMs: 25000 });
  if (!r.ok) {
    toast("No se importó: " + (r.error || "error"), "error");
    return;
  }
  toast(`${r.data.importadas} fila(s) importadas`);
  hoja.importacion = null;
  const bloque = document.getElementById("sqlImportacion");
  if (bloque) bloque.hidden = true;
  hojaCargarFilas();
  hojaCargarTablas();
}

function hojaCancelarImportacion() {
  hoja.importacion = null;
  const bloque = document.getElementById("sqlImportacion");
  if (bloque) bloque.hidden = true;
}

/* ------------------------------------------------------------------ auditoría */

async function hojaVerAuditoria() {
  const bloque = document.getElementById("sqlAuditoriaBloque");
  const tabla = document.getElementById("sqlAuditoriaTabla");
  if (!bloque || !tabla) return;
  bloque.hidden = false;
  tabla.innerHTML = `<p class="nota">Leyendo la auditoría…</p>`;
  const r = await apiTarde("sqlite", { accion: "auditoria", limite: 60 }, { maxMs: 20000 });
  if (!r.ok) {
    tabla.innerHTML = `<div class="sql-error">${esc(r.error || "no se pudo leer la auditoría")}</div>`;
    return;
  }
  const filas = (r.data && r.data.filas) || [];
  if (!filas.length) {
    tabla.innerHTML = `<p class="nota">Todavía no hay cambios registrados.</p>`;
    return;
  }
  const cabecera = `<tr><th>Cuándo</th><th>Tabla</th><th>Fila</th><th>Acción</th><th>Detalle</th></tr>`;
  const cuerpo = filas.map((f) => `<tr>
      <td>${esc(fechaHora(f.ts))}</td>
      <td>${esc(f.tabla || "")}</td>
      <td class="num">${esc(f.fila || "")}</td>
      <td>${esc(f.accion || "")}</td>
      <td>${esc(f.detalle || "")}</td>
    </tr>`).join("");
  tabla.innerHTML = `<table class="sql-tabla"><thead>${cabecera}</thead><tbody>${cuerpo}</tbody></table>`;
  bloque.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------ consulta rápida */

async function hojaEjecutarConsulta() {
  const entrada = document.getElementById("sqlConsulta");
  const salida = document.getElementById("sqlResultado");
  if (!entrada || !salida) return;
  const sql = entrada.value.trim();
  if (!sql) {
    toast("Escribe una consulta SELECT", "error");
    return;
  }
  salida.innerHTML = `<p class="nota">Ejecutando…</p>`;
  const r = await apiTarde("sqlite", { accion: "consultar", sql }, { maxMs: 25000 });
  if (!r.ok) {
    salida.innerHTML = `<div class="sql-error">${esc(r.error || "error")}</div>`;
    return;
  }
  const d = r.data || {};
  const columnas = d.columnas || [];
  const filas = d.filas || [];
  if (!columnas.length) {
    salida.innerHTML = `<p class="nota">La consulta no devolvió columnas.</p>`;
    return;
  }
  const cabecera = `<tr>${columnas.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
  const cuerpo = filas.map((f) => `<tr>${columnas.map((c) => `<td>${hojaCeldaHtml(f[c])}</td>`).join("")}</tr>`).join("");
  salida.innerHTML = `<p class="nota">${filas.length} fila(s)${d.truncado ? " · resultado recortado" : ""}</p>
    <div class="sql-tabla-envoltura"><table class="sql-tabla"><thead>${cabecera}</thead><tbody>${cuerpo}</tbody></table></div>`;
}

/* -------------------------------------------------------------------- eventos */

document.addEventListener("click", (ev) => {
  const tabla = ev.target.closest("[data-tabla]");
  if (tabla) { hojaAbrirTabla(tabla.dataset.tabla); return; }

  const seleccion = ev.target.closest("[data-seleccion]");
  if (seleccion) { hojaSeleccionarFila(seleccion.dataset.seleccion); return; }

  const celda = ev.target.closest("td[data-editable='1']");
  if (celda) { hojaEmpezarEdicion(celda); return; }
});

document.addEventListener("input", (ev) => {
  const entrada = ev.target.closest("input[data-nueva]");
  if (!entrada) return;
  const i = Number(entrada.dataset.indice);
  const col = entrada.dataset.nueva;
  if (!hoja.borradores[i]) return;
  hoja.borradores[i][col] = hojaConvertir(col, entrada.value, null);
  hojaPintarBotones();
});

document.addEventListener("DOMContentLoaded", () => {
  const mapa = {
    btnSqlRefrescar: () => { hojaCargarTablas(); toast("Base actualizada"); },
    btnSqlCerrar: () => {
      const d = document.getElementById("sqlDetalle");
      if (d) d.hidden = true;
      hojaCancelarImportacion();
      const a = document.getElementById("sqlAuditoriaBloque");
      if (a) a.hidden = true;
    },
    btnSqlModo: hojaAlternarModo,
    btnSqlAgregar: hojaAgregarBorrador,
    btnSqlGuardar: hojaGuardar,
    btnSqlDescartar: hojaDescartar,
    btnSqlAnterior: () => {
      hoja.desplazamiento = Math.max(0, hoja.desplazamiento - hoja.limite);
      hojaCargarFilas();
    },
    btnSqlSiguiente: () => {
      hoja.desplazamiento += hoja.limite;
      hojaCargarFilas();
    },
    btnSqlExportarCsv: hojaAExportar,
    btnSqlExportarJson: hojaAExportarJson,
    btnSqlImportar: () => {
      if (!hoja.tabla) { toast("Abre una tabla primero", "error"); return; }
      const input = document.getElementById("sqlArchivo");
      if (input) input.click();
    },
    btnSqlAuditoria: hojaVerAuditoria,
    btnSqlAuditoriaCerrar: () => {
      const a = document.getElementById("sqlAuditoriaBloque");
      if (a) a.hidden = true;
    },
    btnSqlImportacionAgregar: () => hojaConfirmarImportacion(false),
    btnSqlImportacionReemplazar: () => hojaConfirmarImportacion(true),
    btnSqlImportacionCancelar: hojaCancelarImportacion,
    btnSqlEjecutar: hojaEjecutarConsulta,
    btnSqlLimpiarConsulta: () => {
      const e = document.getElementById("sqlConsulta");
      if (e) e.value = "";
      const s = document.getElementById("sqlResultado");
      if (s) s.innerHTML = "";
    }
  };
  Object.keys(mapa).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", mapa[id]);
  });
  const archivo = document.getElementById("sqlArchivo");
  if (archivo) archivo.addEventListener("change", () => hojaLeerCsvArchivo(archivo));
});

// El botón «Borrar fila» no está en el HTML fijo: se agrega al bloque de acciones
// para no romper el layout existente. Se crea una sola vez.
document.addEventListener("DOMContentLoaded", () => {
  const acciones = document.querySelector(".sql-acciones");
  if (!acciones || document.getElementById("btnSqlBorrarFila")) return;
  const boton = document.createElement("button");
  boton.className = "btn btn-peligro";
  boton.type = "button";
  boton.id = "btnSqlBorrarFila";
  boton.textContent = "Borrar fila";
  boton.addEventListener("click", hojaBorrarSeleccionada);
  acciones.appendChild(boton);

  // Conectar botones del Banner de Flujo SQLite ⇄ Nube
  const bSync = document.getElementById("btnSqlSyncNube");
  if (bSync) bSync.addEventListener("click", hojaSincronizarNube);
  const bResp = document.getElementById("btnSqlRespaldoCompleto");
  if (bResp) bResp.addEventListener("click", hojaRespaldoCompleto);
  const bPing = document.getElementById("btnSqlProbarConexion");
  if (bPing) bPing.addEventListener("click", hojaProbarConexion);
});

/* ── Flujo en vivo Canvas: SQLite Local ⇄ Nube Vercel ── */
let streamAnimId = null;
function hojaIniciarCanvasStream() {
  const canvas = document.getElementById("sqlCanvasStream");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ancho = canvas.parentElement ? (canvas.parentElement.clientWidth || 560) : 560;
  canvas.width = ancho;
  canvas.height = 84;
  const w = canvas.width;
  const h = canvas.height;

  const particulas = [];
  for (let i = 0; i < 28; i++) {
    particulas.push({
      x: 140 + Math.random() * (w - 280),
      y: h / 2 + (Math.random() - 0.5) * 16,
      v: 1.4 + Math.random() * 2.4,
      tam: 2 + Math.random() * 3,
      alfa: 0.35 + Math.random() * 0.65
    });
  }

  function frame() {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);

    // Nodo Izquierdo: SQLite Local
    ctx.fillStyle = "#121212";
    ctx.strokeStyle = "#2A2A2A";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(10, 14, 130, 56, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#C8FF00";
    ctx.beginPath();
    ctx.arc(26, 42, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("SQLite Local", 38, 36);
    ctx.fillStyle = "#8A8A8A";
    ctx.font = "9.5px monospace";
    ctx.fillText("Base en teléfono", 38, 51);

    // Nodo Derecho: Nube Postgres
    ctx.fillStyle = "#121212";
    ctx.strokeStyle = "#2A2A2A";
    ctx.beginPath();
    ctx.roundRect(w - 140, 14, 130, 56, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#3DDC84";
    ctx.beginPath();
    ctx.arc(w - 124, 42, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("Nube Fabrick", w - 112, 36);
    ctx.fillStyle = "#8A8A8A";
    ctx.font = "9.5px monospace";
    ctx.fillText("fabri-api Vercel", w - 112, 51);

    // Bus de datos punteado
    ctx.strokeStyle = "rgba(200, 255, 0, 0.22)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(140, 42);
    ctx.lineTo(w - 140, 42);
    ctx.stroke();
    ctx.setLineDash([]);

    // Partículas de datos fluyendo
    ctx.fillStyle = "#C8FF00";
    particulas.forEach((p) => {
      p.x += p.v;
      if (p.x > w - 140) p.x = 140;
      ctx.globalAlpha = p.alfa;
      ctx.beginPath();
      ctx.arc(p.x, 42 + Math.sin(p.x * 0.08) * 3, p.tam, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    const vista = document.getElementById("v-sql");
    if (vista && vista.classList.contains("activa")) {
      streamAnimId = requestAnimationFrame(frame);
    }
  }
  if (streamAnimId) cancelAnimationFrame(streamAnimId);
  frame();
}

async function hojaProbarConexion() {
  const lbl = document.getElementById("sqlNubeEstadoTexto");
  if (lbl) lbl.textContent = "Probando latencia con fabri-api…";
  const t0 = performance.now();
  try {
    const res = await fetch("https://fabri-api.vercel.app/api/health", { cache: "no-store" });
    const ms = Math.round(performance.now() - t0);
    if (res.ok) {
      if (lbl) { lbl.classList.add("sync-vivo"); lbl.classList.remove("sync-error"); lbl.textContent = "Nube Conectada · " + ms + " ms (Postgres online)"; }
    } else {
      if (lbl) { lbl.classList.add("sync-error"); lbl.classList.remove("sync-vivo"); lbl.textContent = "Nube HTTP " + res.status; }
    }
  } catch (e) {
    if (lbl) { lbl.classList.add("sync-error"); lbl.classList.remove("sync-vivo"); lbl.textContent = "Sin conexión con la nube"; }
  }
}

async function hojaSincronizarNube() {
  invAnimarEnvioModal("Sincronizando SQLite con Nube Vercel…", async (progreso) => {
    progreso("Leyendo cambios en SQLite local…", 20);
    const q = await invApiTarde("sync_pendientes", {}, { maxMs: 15000 });
    const pendientes = (q.ok && q.data && q.data.productos) || [];
    
    progreso(`Transmitiendo ${pendientes.length} registros a Postgres…`, 60);
    const url = "https://fabri-api.vercel.app/api/inventario";
    const token = localStorage.getItem("fabrick.nube.token") || "";

    const resp = await fetch(url, {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        token ? { "Authorization": "Bearer " + token } : {}
      ),
      body: JSON.stringify({ accion: "subir", productos: pendientes })
    });

    progreso("Verificando la respuesta de Postgres…", 80);
    // Sin estas comprobaciones, un 401 (token viejo/rechazado) habría marcado
    // los pendientes como enviados igual: sync_marcar corría igual aunque la
    // nube hubiera rechazado la subida.
    if (resp.status === 401) {
      throw new Error("el token de la nube fue rechazado (revisa Integración)");
    }
    if (!resp.ok) {
      throw new Error("la nube respondió HTTP " + resp.status);
    }
    const salida = await resp.json().catch(function () { return { ok: false, error: "respuesta ilegible de la nube" }; });
    if (salida && salida.ok === false) {
      throw new Error(String(salida.error || "la nube rechazó la subida"));
    }

    progreso("Confirmando integridad de la base…", 90);
    if (pendientes.length) {
      const codigos = pendientes.map((p) => p.codigo);
      await invApiTarde("sync_marcar", { codigos: codigos }, { maxMs: 10000 });
    }
    hojaCargarTablas();
    return { ok: true, mensaje: `${pendientes.length} productos sincronizados con Postgres en la nube.` };
  });
}

async function hojaRespaldoCompleto() {
  toast("Generando respaldo de todas las tablas…");
  try {
    const rTablas = await apiTarde("sqlite", { accion: "tablas" }, { maxMs: 20000 });
    if (!rTablas.ok || !rTablas.data) {
      toast("Error al leer tablas: " + rTablas.error, "error");
      return;
    }
    const tablas = rTablas.data.tablas || [];
    const respaldo = {
      sistema: "FORGE CORE STOCK",
      version: "0.9.16",
      fecha: new Date().toISOString(),
      tablas: {}
    };
    for (const t of tablas) {
      const rf = await apiTarde("sqlite", { accion: "filas", tabla: t.nombre, limite: 1000 }, { maxMs: 15000 });
      respaldo.tablas[t.nombre] = (rf.ok && rf.data && rf.data.filas) || [];
    }
    const jsonStr = JSON.stringify(respaldo, null, 2);
    const nombre = "respaldo-fabri-core-" + new Date().toISOString().slice(0, 10) + ".json";
    if (window.FabrickNative && typeof window.FabrickNative.guardarArchivo === "function") {
      const g = JSON.parse(window.FabrickNative.guardarArchivo(nombre, jsonStr));
      toast("Respaldo guardado en Descargas: " + (g.ruta || nombre));
    } else {
      toast("Respaldo creado: " + Math.round(jsonStr.length / 1024) + " KB");
    }
  } catch (e) {
    toast("Fallo al exportar respaldo: " + e.message, "error");
  }
}
