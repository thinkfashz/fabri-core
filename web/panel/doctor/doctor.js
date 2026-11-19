/* FORGE CORE STOCK · página del doctor
   ---------------------------------------------------------------------------
   Lee `GET /api/diagnostico?accion=doctor`, pinta el estado medido y guarda la
   última lectura en localStorage para no dejar la pantalla en blanco si la
   nube no responde. No inventa datos: lo que falta se muestra como «—» o como
   estado vacío. */

import { diagnostico, mensajeDeError } from '../comun/api.js';

const CLAVE_CACHE = 'fcore.doctor.cache';
const REFRESCO_MS = 30_000;
const CACHE_MS = 6 * 3600 * 1000;

const estado = {
  dias: 7,
  datos: null,
  cargando: false,
  ultima: 0,
};

const $ = (sel) => document.querySelector(sel);

const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function pill(texto, tipo) {
  return '<span class="pill' + (tipo ? ' pill--' + tipo : '') + '">' + esc(texto) + '</span>';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ms(v) {
  const n = num(v);
  if (!n) return '—';
  if (n < 1000) return n + ' ms';
  return (n / 1000).toFixed(1).replace('.', ',') + ' s';
}

function hora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

function fechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function vacio(titulo, texto) {
  return '<div class="ds-empty">' +
    '<div class="ds-empty__icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>' +
    '</div>' +
    '<div class="ds-empty__title">' + esc(titulo) + '</div>' +
    '<p class="ds-empty__text">' + esc(texto) + '</p>' +
  '</div>';
}

function aviso(texto, tipo) {
  const caja = $('[data-aviso]');
  if (!caja) return;
  if (!texto) { caja.innerHTML = ''; return; }
  const ico = tipo === 'ok'
    ? '<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>'
    : '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/>';
  caja.innerHTML = '<div class="aviso aviso--' + (tipo || 'warn') + '">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true">' + ico + '</svg>' +
    '<span>' + esc(texto) + '</span></div>';
}

function marcar(texto, tipo) {
  const caja = $('[data-live]');
  const txt = $('[data-live-txt]');
  if (caja) caja.dataset.estado = tipo || '';
  if (txt) txt.textContent = texto;
}

function kpi(nombre, valor, tipo) {
  const el = document.querySelector('[data-kpi="' + nombre + '"]');
  if (!el) return;
  el.textContent = valor;
  el.className = 'ds-stat__value' + (tipo ? ' ds-stat__value--' + tipo : '');
}

function kpiMeta(nombre, texto) {
  const el = document.querySelector('[data-kpi-meta="' + nombre + '"]');
  if (el) el.textContent = texto;
}

/* ── caché local ───────────────────────────────────────────────────────── */

function guardarCache(datos) {
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ ts: Date.now(), datos }));
  } catch (_) { /* sin espacio: no es crítico */ }
}

function leerCache() {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE_CACHE) || 'null');
    if (!x || !x.datos) return null;
    if (Date.now() - num(x.ts) > CACHE_MS) return null;
    return x;
  } catch (_) { return null; }
}

/* ── pintado ───────────────────────────────────────────────────────────── */

function pintarKpis(d) {
  const s = d.salud || {};
  const r = d.reportes || {};
  const a = d.almacen || {};
  const sp = s.resumen || {};
  const k = r.kpis || {};
  const paginasOk = num(sp.paginas_ok);
  const paginasTotal = num(sp.paginas_total);
  const apisOk = num(sp.apis_ok);
  const apisTotal = num(sp.apis_total);
  const errores = num(k.errores);
  const fallos = num(k.api_fallos);

  kpi('paginas', paginasOk + '/' + paginasTotal,
    paginasTotal && paginasOk === paginasTotal ? 'ok' : 'warn');
  kpiMeta('paginas', paginasTotal && paginasOk === paginasTotal
    ? 'todas responden'
    : (paginasTotal - paginasOk) + ' con problema');

  kpi('apis', apisOk + '/' + apisTotal,
    apisTotal && apisOk === apisTotal ? 'ok' : 'warn');
  kpiMeta('apis', apisTotal && apisOk === apisTotal
    ? 'todas responden'
    : (apisTotal - apisOk) + ' con problema');

  kpi('errores', String(errores), errores ? 'err' : 'ok');
  kpiMeta('errores', errores ? 'revisar ubicación' : 'sin errores');
  const etiqueta = $('[data-kpi-label="errores"]');
  if (etiqueta) etiqueta.textContent = 'Errores · ' + estado.dias + ' d';

  kpi('fallos', String(fallos), fallos ? 'err' : 'ok');
  kpiMeta('fallos', num(k.api_llamadas) + ' llamada(s)');

  kpi('reportes', String(num(k.reportes)));
  kpiMeta('reportes', num(k.vistas) + ' vista(s)');

  kpi('kb', num(a.kb) + ' KB');
  kpiMeta('kb', num(a.filas) + ' fila(s) diaria(s)');
}

function diasConCeros(d) {
  const mapa = new Map();
  for (const x of (d.reportes && d.reportes.dias) || []) {
    mapa.set(String(x.dia).slice(0, 10), x);
  }
  const salida = [];
  for (let i = estado.dias - 1; i >= 0; i--) {
    const dia = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    salida.push(mapa.get(dia) || { dia, vistas: 0, errores: 0, api_fallos: 0, reportes: 0 });
  }
  return salida;
}

function etiquetaDia(dia) {
  if (estado.dias > 14) return dia.slice(8, 10);
  return dia.slice(8, 10) + '/' + dia.slice(5, 7);
}

function pintarGrafico(d) {
  const caja = $('[data-grafico]');
  const pie = $('[data-grafico-pie]');
  if (!caja) return;
  const dias = diasConCeros(d);
  const total = dias.reduce((n, x) => n + num(x.errores) + num(x.api_fallos), 0);

  if (!total) {
    caja.innerHTML = vacio('Sin fallos en el periodo',
      'No hay errores de navegador ni fallos de API guardados en estos días. El gráfico aparece con el primer fallo real.');
    if (pie) pie.textContent = 'Se miden errores de JavaScript, promesas, recursos y llamadas de API.';
    return;
  }

  const max = Math.max(1, ...dias.map((x) => num(x.errores) + num(x.api_fallos)));
  caja.innerHTML = '<div class="ds-chart-bar" role="img" aria-label="Fallos por día en los últimos ' +
    estado.dias + ' días">' +
    dias.map((x) => {
      const v = num(x.errores) + num(x.api_fallos);
      const titulo = x.dia + ': ' + num(x.errores) + ' error(es), ' +
        num(x.api_fallos) + ' fallo(s) de API, ' + num(x.reportes) + ' reporte(s)';
      return '<div class="ds-chart-bar__col' + (v ? '' : ' doc-barra-cero') +
        '" style="--ds-bar:' + (v / max).toFixed(3) + '" title="' + esc(titulo) + '">' +
        '<i></i><span>' + esc(etiquetaDia(x.dia)) + '</span></div>';
    }).join('') + '</div>';

  if (pie) {
    pie.textContent = 'Máximo ' + max + ' fallo(s) en un día · ' +
      dias.reduce((n, x) => n + num(x.reportes), 0) + ' reporte(s) · ' +
      dias.reduce((n, x) => n + num(x.vistas), 0) + ' vista(s).';
  }
}

function pintarPaginas(d) {
  const caja = $('[data-paginas]');
  if (!caja) return;
  // El sondeo usa `/ruta/` y el reporte del navegador normaliza a `/ruta`:
  // se cruzan sin la barra final para no duplicar la misma página.
  const normal = (r) => String(r || '/').replace(/\/+$/, '') || '/';
  const salud = new Map();
  for (const p of (d.salud && d.salud.paginas) || []) salud.set(normal(p.ruta), p);
  const rep = new Map();
  for (const p of (d.reportes && d.reportes.paginas) || []) rep.set(normal(p.ruta), p);

  const rutas = [...new Set([...salud.keys(), ...rep.keys()])];
  if (!rutas.length) {
    caja.innerHTML = vacio('Sin páginas medidas', 'El sondeo no devolvió páginas. Revisa la salud de la API.');
    return;
  }

  const filas = rutas.map((ruta) => {
    const s = salud.get(ruta);
    const r = rep.get(ruta);
    let estadoPill = pill('sin sondeo', 'warn');
    if (s) estadoPill = s.ok ? pill('arriba', 'ok') : pill('caída', 'err');
    return '<tr>' +
      '<td data-label="Página"><b>' + esc((s && s.nombre) || 'Página') + '</b><br><span class="doc-ruta">' + esc(ruta) + '</span>' +
        (s && s.detalle ? '<br><span class="doc-tenue">' + esc(s.detalle) + '</span>' : '') + '</td>' +
      '<td data-label="Estado">' + estadoPill + '</td>' +
      '<td data-label="HTTP" class="doc-num">' + (s && s.http ? esc(s.http) : '—') + '</td>' +
      '<td data-label="Tiempo" class="doc-num">' + (s ? ms(s.ms) : '—') + '</td>' +
      '<td data-label="Visitas" class="doc-num">' + (r ? num(r.vistas) : '—') + '</td>' +
      '<td data-label="Errores" class="doc-num">' + (r ? num(r.errores) : '—') + '</td>' +
      '<td data-label="Última" class="doc-num">' + (r && r.ultima ? esc(fechaHora(r.ultima)) : '—') + '</td>' +
    '</tr>';
  }).join('');

  caja.innerHTML = '<table class="ds-table ds-table--stack">' +
    '<caption>Páginas del sitio, sondeo HTTP y actividad del navegador</caption>' +
    '<thead><tr><th>Página</th><th>Estado</th><th class="doc-num">HTTP</th><th class="doc-num">Tiempo</th>' +
    '<th class="doc-num">Visitas</th><th class="doc-num">Errores</th><th class="doc-num">Última</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table>';
}

function partirClave(clave) {
  const i = String(clave).indexOf(' ');
  if (i > 0) return { metodo: clave.slice(0, i), ruta: clave.slice(i + 1) };
  return { metodo: 'GET', ruta: String(clave) };
}

function pintarApis(d) {
  const caja = $('[data-apis]');
  if (!caja) return;
  // GET y POST a la misma ruta son operaciones distintas: se cruzan por
  // método + ruta, no solo por ruta.
  const clave = (metodo, ruta) => String(metodo || 'GET').toUpperCase() + ' ' + String(ruta || '/');
  const salud = new Map();
  for (const a of (d.salud && d.salud.apis) || []) salud.set(clave(a.metodo, a.ruta), a);
  const rep = new Map();
  for (const a of (d.reportes && d.reportes.apis) || []) {
    const p = partirClave(a.clave);
    rep.set(clave(p.metodo, p.ruta), Object.assign({}, a, p));
  }

  const claves = [...new Set([...salud.keys(), ...rep.keys()])];
  if (!claves.length) {
    caja.innerHTML = vacio('Sin APIs medidas', 'El sondeo no devolvió endpoints. Revisa la salud de la API.');
    return;
  }

  const filas = claves.map((k) => {
    const s = salud.get(k);
    const r = rep.get(k);
    const metodo = (s && s.metodo) || (r && r.metodo) || 'GET';
    const ruta = (s && s.ruta) || (r && r.ruta) || '/api';
    let estadoPill = pill('sin sondeo', 'warn');
    if (s) estadoPill = s.ok ? pill('arriba', 'ok') : pill('caída', 'err');
    return '<tr>' +
      '<td data-label="Endpoint"><b class="doc-ruta">' + esc(metodo + ' ' + ruta) + '</b>' +
        (s && s.nombre ? '<br><span class="doc-tenue">' + esc(s.nombre) + '</span>' : '') +
        (s && s.detalle ? '<br><span class="doc-tenue">' + esc(s.detalle) + '</span>' : '') + '</td>' +
      '<td data-label="Estado">' + estadoPill + '</td>' +
      '<td data-label="HTTP" class="doc-num">' + (s && s.http ? esc(s.http) : '—') + '</td>' +
      '<td data-label="Tiempo" class="doc-num">' + (s ? ms(s.ms) : '—') + '</td>' +
      '<td data-label="Llamadas" class="doc-num">' + (r ? num(r.llamadas) : '—') + '</td>' +
      '<td data-label="Fallos" class="doc-num">' + (r ? num(r.fallos) : '—') + '</td>' +
      '<td data-label="Último" class="doc-num">' + (r && r.ultimo ? esc(fechaHora(r.ultimo)) : '—') + '</td>' +
    '</tr>';
  }).join('');

  caja.innerHTML = '<table class="ds-table ds-table--stack">' +
    '<caption>Endpoints, estado medido y fallos vistos por el cliente</caption>' +
    '<thead><tr><th>Endpoint</th><th>Estado</th><th class="doc-num">HTTP</th><th class="doc-num">Tiempo</th>' +
    '<th class="doc-num">Llamadas</th><th class="doc-num">Fallos</th><th class="doc-num">Último</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table>';
}

function tipoPill(tipo) {
  const t = String(tipo || 'error');
  if (t === 'recurso' || t === 'skeleton') return pill(t, 'warn');
  if (t === 'api') return pill(t, 'warn');
  return pill(t, 'err');
}

function pintarErrores(d) {
  const caja = $('[data-errores]');
  const contador = $('[data-errores-pill]');
  if (!caja) return;
  const errores = (d.reportes && d.reportes.errores) || [];
  if (contador) {
    contador.className = 'pill' + (errores.length ? ' pill--err' : ' pill--ok');
    contador.textContent = errores.length
      ? errores.length + ' huella(s) · ' + num(d.reportes.kpis.errores) + ' evento(s)'
      : 'sin errores';
  }
  if (!errores.length) {
    caja.innerHTML = vacio('Sin errores de navegador',
      'El doctor está midiendo. Si una página falla, aparece acá con archivo, línea y columna.');
    return;
  }

  const filas = errores.map((e) => {
    const ubicacion = e.archivo
      ? '<code class="doc-codigo">' + esc(e.archivo) + ':' + num(e.linea) +
        (e.columna ? ':' + num(e.columna) : '') + '</code>'
      : '<span class="doc-tenue">sin ubicación</span>';
    const stack = e.stack
      ? '<details class="doc-detalle"><summary>Ver stack</summary><pre class="doc-stack">' + esc(e.stack) + '</pre></details>'
      : '<span class="doc-tenue">sin stack</span>';
    return '<tr>' +
      '<td data-label="Tipo">' + tipoPill(e.tipo) + '</td>' +
      '<td data-label="Error y ubicación"><b>' + esc(e.mensaje || '(sin mensaje)') + '</b><br>' + ubicacion +
        (e.pagina ? '<br><span class="doc-ruta">' + esc(e.pagina) + '</span>' : '') + '</td>' +
      '<td data-label="Veces" class="doc-num">' + num(e.veces) + '</td>' +
      '<td data-label="Último" class="doc-num">' + esc(fechaHora(e.ultimo)) + '</td>' +
      '<td data-label="Detalle">' + stack + '</td>' +
    '</tr>';
  }).join('');

  caja.innerHTML = '<div class="doc-tabla"><table class="ds-table ds-table--stack">' +
    '<caption>Huellas de error agrupadas por mensaje y archivo</caption>' +
    '<thead><tr><th>Tipo</th><th>Error y ubicación</th><th class="doc-num">Veces</th>' +
    '<th class="doc-num">Último</th><th>Detalle</th></tr></thead>' +
    '<tbody>' + filas + '</tbody></table></div>';
}

function pintarAlmacen(d) {
  const caja = $('[data-almacen]');
  if (!caja) return;
  const a = d.almacen || {};
  if (!a.ok) {
    caja.innerHTML = '<div class="ds-error">' +
      '<div class="ds-error__title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/>' +
      '<path d="M10.3 4.2 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/></svg>' +
      'El almacén no responde</div>' +
      '<p class="ds-error__text">' + esc(a.error || 'No se pudo leer la tabla del doctor. El sondeo de páginas y APIs sigue funcionando.') + '</p>' +
    '</div>';
    return;
  }

  const dias = num(a.dias);
  const retencion = Math.max(1, num(a.retencion_dias));
  const progreso = Math.min(1, dias / retencion);
  caja.innerHTML =
    '<div class="doc-datos">' +
      '<div class="doc-dato"><small>Filas</small><b>' + num(a.filas) + '</b></div>' +
      '<div class="doc-dato"><small>Peso</small><b>' + num(a.kb) + ' KB</b></div>' +
      '<div class="doc-dato"><small>Retención</small><b>' + retencion + ' días</b></div>' +
      '<div class="doc-dato"><small>Topes por día</small><b>' +
        num(a.topes && a.topes.paginas) + '/' + num(a.topes && a.topes.errores) + '/' +
        num(a.topes && a.topes.apis) + '</b></div>' +
    '</div>' +
    '<div class="doc-barra"><div class="ds-progress ds-progress--thin" style="--ds-progress:' +
      progreso.toFixed(2) + '"><i></i></div></div>' +
    '<p class="doc-tenue" style="margin-top:8px">' +
      (dias
        ? esc('Desde ' + (a.desde || '—') + ' hasta ' + (a.hasta || '—') + '.')
        : 'Aún no hay filas: el primer reporte crea la fila del día.') +
    '</p>' +
    '<p class="doc-tenue" style="margin-top:6px">Una fila por día, no una por evento. ' +
      'Topes: 25 páginas, 20 errores y 15 APIs por día; fila máxima ' +
      num(a.topes && a.topes.fila_kb) + ' KB. El navegador manda 12 eventos por carga y un latido por página/día.</p>';
}

function pintarDescubrimientos(d) {
  const caja = $('[data-descubrimientos]');
  if (!caja) return;
  const lista = Array.isArray(d.descubrimientos) ? d.descubrimientos : [];
  if (!lista.length) {
    caja.innerHTML = vacio('Sin hallazgos todavía',
      'Cuando haya reportes suficientes, acá aparecen la página más lenta, la API con más fallos y el error más repetido.');
    return;
  }
  caja.innerHTML = '<ul class="doc-lista">' +
    lista.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
}

function pintarTodo(d) {
  estado.datos = d;
  pintarKpis(d);
  pintarGrafico(d);
  pintarPaginas(d);
  pintarApis(d);
  pintarErrores(d);
  pintarAlmacen(d);
  pintarDescubrimientos(d);
  const pre = $('[data-resumen]');
  if (pre) pre.textContent = d.resumen_ia || 'El doctor no devolvió resumen.';
}

/* ── carga ─────────────────────────────────────────────────────────────── */

async function cargar(silencioso) {
  if (estado.cargando) return;
  estado.cargando = true;
  const boton = $('[data-refrescar]');
  if (boton) boton.disabled = true;
  if (!silencioso) marcar('consultando…', '');

  try {
    const d = await diagnostico({ dias: estado.dias });
    estado.ultima = Date.now();
    guardarCache(d);
    pintarTodo(d);
    marcar('en vivo · ' + hora(d.hora), 'vivo');
    aviso('');
  } catch (e) {
    const cache = leerCache();
    if (cache && cache.datos) {
      pintarTodo(cache.datos);
      marcar('última lectura ' + hora(cache.datos.hora), 'stale');
      aviso('No pudimos actualizar: ' + mensajeDeError(e) + '. Se muestra la última lectura guardada.', 'warn');
    } else {
      marcar('sin conexión', 'error');
      aviso('No pudimos consultar el doctor: ' + mensajeDeError(e) + '.', 'err');
    }
  } finally {
    estado.cargando = false;
    if (boton) boton.disabled = false;
  }
}

/* ── acciones ──────────────────────────────────────────────────────────── */

async function copiar(texto, boton) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto);
    } else {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const previo = boton.textContent;
    boton.textContent = 'Copiado';
    setTimeout(() => { boton.textContent = previo; }, 1800);
  } catch (_) {
    aviso('No pudimos copiar al portapapeles. Selecciona el texto y cópialo a mano.', 'warn');
  }
}

function montar() {
  const refrescar = $('[data-refrescar]');
  if (refrescar) refrescar.addEventListener('click', () => cargar(false));

  document.querySelectorAll('[data-dias]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const dias = Number(boton.dataset.dias) || 7;
      if (dias === estado.dias) return;
      estado.dias = dias;
      document.querySelectorAll('[data-dias]').forEach((b) => {
        const activo = Number(b.dataset.dias) === dias;
        b.classList.toggle('is-active', activo);
        b.setAttribute('aria-pressed', activo ? 'true' : 'false');
      });
      cargar(false);
    });
  });

  const copiarResumen = $('[data-copiar]');
  if (copiarResumen) {
    copiarResumen.addEventListener('click', () => {
      const texto = (estado.datos && estado.datos.resumen_ia) || $('[data-resumen]').textContent || '';
      copiar(texto, copiarResumen);
    });
  }

  const copiarJson = $('[data-copiar-json]');
  if (copiarJson) {
    copiarJson.addEventListener('click', () => {
      const d = estado.datos || {};
      const texto = JSON.stringify({
        hora: d.hora, dias: d.dias, salud: d.salud, reportes: d.reportes,
        almacen: d.almacen, descubrimientos: d.descubrimientos,
      }, null, 2);
      copiar(texto, copiarJson);
    });
  }

  window.addEventListener('online', () => cargar(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - estado.ultima > REFRESCO_MS) cargar(true);
  });

  setInterval(() => {
    if (document.hidden) return;
    if (Date.now() - estado.ultima < REFRESCO_MS - 2000) return;
    cargar(true);
  }, REFRESCO_MS);
}

/* ── arranque ──────────────────────────────────────────────────────────── */

montar();
const cache = leerCache();
if (cache) {
  pintarTodo(cache.datos);
  marcar('última lectura ' + hora(cache.datos.hora), 'stale');
  cargar(true);
} else {
  cargar(false);
}
