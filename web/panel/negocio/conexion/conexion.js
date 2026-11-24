/* N18 · Conexión APK / dispositivos
   --------------------------------------------------------------------------
   El puente real ya existe: `/api/inventario` acepta `local_id` + la clave de
   8 caracteres de la tienda y sincroniza el catálogo. Esta página no inventa
   nada: verifica esa clave contra la API, lee el estado con la sesión del
   dueño (`conexion_estado`) y dibuja el enlace tienda ↔ dispositivos que la
   API reporta de verdad.

   Si no hay dispositivos, la lista va vacía. Si la API falla, se dice. La
   clave nueva se muestra una sola vez y se avisa que los dispositivos
   anteriores quedan fuera. */

import { arrancar, llamar } from '../../comun/negocio.js';
import { esc } from '../../comun/formato.js';
import { alCambiar } from '../../comun/sesion.js';
import { inventarioPost } from '../../comun/api.js';

const $ = (sel, raiz) => (raiz || document).querySelector(sel);
const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

const estado = {
  ctx: null,
  conexion: null,
  dispositivos: [],
  errores: [],
  cargando: true,
  fallo: '',
  verif: null,        // { clase, texto, tienda, productos, ms, codigo }
  probando: false,
  clave: '',          // valor nuevo, sólo en memoria
  rotando: false,
  copiado: false,
  reloj: null,
  escena: null,
};

/* ── utilidades ─────────────────────────────────────────────────────────── */

function fechaHora(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch (_) { return d.toLocaleString('es-CL'); }
}

function hace(v) {
  if (!v) return '';
  const ms = Date.now() - new Date(v).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return 'hace ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return 'hace ' + Math.round(h / 24) + ' d';
}

/** Estado de un dispositivo según su última conexión. */
function estadoDe(d) {
  if (!d || !d.conectado) return 'mal';
  const min = (Date.now() - new Date(d.conectado).getTime()) / 60000;
  if (min <= 10) return 'ok';
  if (min <= 60 * 24) return 'aviso';
  return 'mal';
}

function textoEstado(e) {
  return { ok: 'conectado', aviso: 'sin sincronizar', mal: 'desconectado' }[e] || e;
}

/** La clave se muestra agrupada: ABCD-EFGH. */
function claveVisible(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : s;
}

/** Motivo legible de un fallo del puente. */
function motivoDe(d, status) {
  const cod = String((d && d.codigo) || '');
  if (cod === 'clave_mala' || status === 401) return 'La clave no abre esta tienda. Revísala o genera una nueva.';
  if (cod === 'local_inexistente') return 'Esa tienda no existe en la base.';
  if (cod === 'SIN_CREDENCIALES') return 'Falta la clave o el identificador de la tienda.';
  if (cod === 'SIN_BASE') return 'La nube no tiene la base configurada: avisa al administrador.';
  if (cod === 'SIN_LOCAL') return 'Falta indicar la tienda.';
  return (d && (d.error || d.codigo)) || 'No pudimos verificar la conexión.';
}

/* ── verificación de la clave ───────────────────────────────────────────── */

async function verificarClave(ev) {
  if (ev) ev.preventDefault();
  const ctx = estado.ctx;
  if (!ctx || !ctx.tienda) return;
  const input = $('#cnClave');
  const clave = String((input && input.value) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (clave.length !== 8) {
    estado.verif = { clase: 'aviso', texto: 'La clave tiene 8 caracteres. Revísala antes de probar.' };
    pintar();
    return;
  }
  estado.probando = true;
  estado.verif = null;
  pintar();
  const t0 = Date.now();
  try {
    const d = await inventarioPost('verificar', { local_id: ctx.tienda.id, clave }, { ms: 15000 });
    const ms = Date.now() - t0;
    const c = d && d.conexion;
    estado.verif = {
      clase: 'ok',
      texto: 'La clave abre esta tienda.',
      tienda: c && c.tienda,
      productos: c ? Number(c.productos) || 0 : 0,
      ultima: c && c.ultima_nube,
      ms,
    };
  } catch (e) {
    const ms = Date.now() - t0;
    const status = (e && e.status) || 0;
    const codigo = (e && e.codigo) || '';
    if (codigo === 'SIN_RED') {
      estado.verif = {
        clase: 'mal',
        texto: 'No hay conexión con la nube. Revisa tu red e inténtalo otra vez.',
        ms,
      };
    } else if (status === 503) {
      estado.verif = { clase: 'aviso', texto: motivoDe({ codigo }, status), ms };
    } else {
      estado.verif = { clase: 'mal', texto: motivoDe({ codigo, error: e && e.message }, status), ms };
    }
  } finally {
    estado.probando = false;
    pintar();
  }
}

/* ── rotar / generar clave ──────────────────────────────────────────────── */

async function rotarClave() {
  const ctx = estado.ctx;
  if (!ctx || !ctx.tienda || estado.rotando) return;
  const aviso = estado.conexion && estado.conexion.tiene_clave
    ? 'Se generará una clave nueva y los dispositivos conectados dejarán de sincronizar hasta que la usen. ¿Continuar?'
    : 'Se generará la clave de conexión de esta tienda. ¿Continuar?';
  if (!window.confirm(aviso)) return;
  estado.rotando = true;
  estado.fallo = '';
  pintar();
  try {
    const d = await llamar('conexion_rotar', { local_id: ctx.tienda.id, confirmar: true });
    estado.clave = String(d.clave || '');
    estado.copiado = false;
    await cargarEstado();
  } catch (e) {
    estado.fallo = (e && e.message) || 'No pudimos generar la clave.';
  } finally {
    estado.rotando = false;
    pintar();
  }
}

async function copiarClave() {
  if (!estado.clave) return;
  try {
    await navigator.clipboard.writeText(claveVisible(estado.clave));
    estado.copiado = true;
  } catch (_) {
    estado.copiado = false;
  }
  pintar();
}

/* ── datos ──────────────────────────────────────────────────────────────── */

async function cargarEstado() {
  const ctx = estado.ctx;
  if (!ctx || !ctx.tienda) return;
  try {
    const d = await llamar('conexion_estado', { local_id: ctx.tienda.id });
    estado.conexion = d.conexion || null;
    estado.dispositivos = Array.isArray(d.dispositivos) ? d.dispositivos : [];
    estado.errores = Array.isArray(d.errores) ? d.errores : [];
    estado.fallo = '';
  } catch (e) {
    estado.fallo = (e && e.message) || 'No pudimos leer el estado de la conexión.';
  } finally {
    estado.cargando = false;
  }
}

/* ── canvas: tienda ↔ dispositivos ──────────────────────────────────────── */

function crearEscena(canvas) {
  const g = canvas.getContext('2d');
  if (!g) return null;
  const reducir = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let raf = 0;
  let t = 0;
  let w = 360, h = 240;

  function ajustar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || 360;
    h = canvas.clientHeight || 240;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function nodoTienda(x, y, activo) {
    const r = 26;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#141C0E';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = activo ? '#C8F542' : '#3A4A38';
    g.stroke();
    g.fillStyle = activo ? '#C8F542' : '#8FA08C';
    g.font = '800 15px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('T', x, y + 1);
  }

  function nodoDispositivo(x, y, est) {
    const color = { ok: '#B8E86A', aviso: '#F5C542', mal: '#F58C8C' }[est] || '#8FA08C';
    g.save();
    g.translate(x, y);
    g.lineWidth = 2;
    g.strokeStyle = color;
    g.fillStyle = '#0E120F';
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(-12, -18, 24, 36, 6);
    else g.rect(-12, -18, 24, 36);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(0, 13, 1.8, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.restore();
  }

  function pulso(x1, y1, x2, y2, fase, color) {
    const p = fase % 1;
    const x = x1 + (x2 - x1) * p;
    const y = y1 + (y2 - y1) * p;
    g.beginPath();
    g.arc(x, y, 3.4, 0, Math.PI * 2);
    g.fillStyle = color;
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
  }

  function dibujar() {
    g.clearRect(0, 0, w, h);

    /* Rejilla tenue: da profundidad sin distraer. */
    g.strokeStyle = 'rgba(200,245,66,0.045)';
    g.lineWidth = 1;
    const paso = 28;
    for (let x = paso; x < w; x += paso) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let y = paso; y < h; y += paso) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    const disps = estado.dispositivos.slice(0, 4);
    const hay = disps.length > 0;
    const conOk = disps.some((d) => estadoDe(d) === 'ok');
    const conError = disps.some((d) => estadoDe(d) === 'mal') || estado.errores.length > 0;

    /* En pantallas angostas, tienda arriba y dispositivos abajo en columna. */
    const vertical = w < 420;
    const tx = vertical ? w / 2 : Math.max(60, w * 0.16);
    const ty = vertical ? 56 : h / 2;

    nodoTienda(tx, ty, hay && !conError);

    if (!hay) {
      /* Camino punteado hacia un dispositivo fantasma: se ve que falta
         conectar, sin inventar uno. */
      const gx = vertical ? w / 2 : w - 70;
      const gy = vertical ? h - 62 : h / 2;
      g.save();
      g.setLineDash([5, 6]);
      g.strokeStyle = 'rgba(245,197,66,0.55)';
      g.lineWidth = 1.6;
      g.beginPath();
      if (vertical) { g.moveTo(tx, ty + 30); g.lineTo(gx, gy - 22); }
      else { g.moveTo(tx + 32, ty); g.lineTo(gx - 22, gy); }
      g.stroke();
      g.restore();
      nodoDispositivo(gx, gy, 'aviso');
      g.fillStyle = '#F5C542';
      g.font = '700 11px system-ui, -apple-system, sans-serif';
      g.textAlign = 'center';
      g.fillText('sin dispositivos', gx, gy + 34);
    } else {
      const inicio = vertical ? 120 : 90;
      const fin = vertical ? h - 40 : h - 40;
      const n = disps.length;
      disps.forEach((d, i) => {
        const frac = n === 1 ? 0.5 : i / (n - 1);
        const dy = inicio + (fin - inicio) * frac;
        const dx = vertical ? w / 2 : Math.max(w * 0.62, w - 128);
        const est = estadoDe(d);
        const color = { ok: '#B8E86A', aviso: '#F5C542', mal: '#F58C8C' }[est];

        g.strokeStyle = est === 'mal' ? 'rgba(245,140,140,0.35)' : 'rgba(200,245,66,0.28)';
        g.lineWidth = 1.6;
        g.beginPath();
        if (vertical) { g.moveTo(tx, ty + 30); g.lineTo(dx, dy - 20); }
        else { g.moveTo(tx + 32, ty); g.lineTo(dx - 16, dy); }
        g.stroke();

        if (!reducir) pulso(tx + (vertical ? 0 : 32), ty + (vertical ? 30 : 0), dx, dy, t + i * 0.28, color);
        nodoDispositivo(dx, dy, est);

        g.fillStyle = color;
        g.font = '700 10.5px system-ui, -apple-system, sans-serif';
        g.textAlign = vertical ? 'center' : 'left';
        const etiqueta = String(d.etiqueta || 'dispositivo').slice(0, 18);
        g.fillText(etiqueta, vertical ? dx : dx + 20, vertical ? dy + 32 : dy - 4);
        g.fillStyle = 'rgba(169,178,170,0.8)';
        g.font = '500 9.5px system-ui, -apple-system, sans-serif';
        g.fillText(est === 'ok' ? 'sincronizando' : (est === 'aviso' ? 'sin novedad' : 'sin conexión'),
          vertical ? dx : dx + 20, vertical ? dy + 45 : dy + 9);
      });
    }

    /* Etiqueta de la tienda */
    g.fillStyle = 'rgba(242,245,240,0.9)';
    g.font = '700 11px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    const nombre = estado.ctx && estado.ctx.tienda ? String(estado.ctx.tienda.nombre || 'Tu tienda') : 'Tu tienda';
    g.fillText(nombre.slice(0, 24), tx, ty + 42);
    if (conOk) {
      g.fillStyle = '#B8E86A';
      g.font = '700 9.5px system-ui, -apple-system, sans-serif';
      g.fillText('en línea', tx, ty + 55);
    }
  }

  function paso() {
    raf = 0;
    if (document.hidden) return;
    t += 0.008;
    dibujar();
    if (!reducir) raf = requestAnimationFrame(paso);
  }

  function arrancar() {
    ajustar();
    dibujar();
    if (!reducir && !raf) raf = requestAnimationFrame(paso);
  }

  const enResize = () => { ajustar(); dibujar(); };
  window.addEventListener('resize', enResize);
  const enVis = () => { if (!document.hidden) arrancar(); };
  document.addEventListener('visibilitychange', enVis);

  arrancar();

  return {
    actualizar: () => { if (reducir) dibujar(); else arrancar(); },
    destruir: () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', enResize);
      document.removeEventListener('visibilitychange', enVis);
    },
  };
}

/* ── pintado ────────────────────────────────────────────────────────────── */

function bloqueVerificador() {
  const v = estado.verif;
  let resultado = '';
  if (v) {
    resultado = '<div class="cn-verif cn-verif--' + esc(v.clase) + '" role="status">' +
      '<div class="cn-verif__estado">' +
        '<span aria-hidden="true">' + (v.clase === 'ok' ? '✔' : (v.clase === 'aviso' ? '!' : '✕')) + '</span>' +
        '<span>' + esc(v.texto) + '</span>' +
      '</div>' +
      (v.tienda ? '<div class="cn-verif__fila"><span>Tienda</span><b>' + esc(v.tienda) + '</b></div>' : '') +
      (v.productos != null ? '<div class="cn-verif__fila"><span>Productos en la nube</span><b>' + v.productos + '</b></div>' : '') +
      (v.ultima ? '<div class="cn-verif__fila"><span>Última sincronización</span><b>' + esc(fechaHora(v.ultima)) + '</b></div>' : '') +
      (v.ms != null ? '<div class="cn-verif__fila"><span>Respuesta</span><b>' + v.ms + ' ms</b></div>' : '') +
    '</div>';
  }
  return '<section class="cn-card" aria-labelledby="cnVerifTitulo">' +
    '<div class="cn-card__cabeza"><h2 class="cn-card__titulo" id="cnVerifTitulo">Verificar la clave de conexión</h2>' +
      '<span class="pill">API</span></div>' +
    '<p class="cn-nota">La misma clave de 8 caracteres que usa la app y la APK. Aquí se comprueba contra la nube, sin guardarla.</p>' +
    '<form class="cn-form" data-verif novalidate>' +
      '<label class="cn-campo" for="cnClave">' +
        '<span class="cn-label">Clave de la tienda</span>' +
        '<input id="cnClave" class="ds-input cn-input" type="text" inputmode="text" autocomplete="off" ' +
          'spellcheck="false" maxlength="9" placeholder="ABCD-EFGH" aria-describedby="cnClaveAyuda">' +
      '</label>' +
      '<div class="cn-fila">' +
        '<button class="ds-btn" type="submit"' + (estado.probando ? ' disabled' : '') + '>' +
          (estado.probando ? 'Comprobando…' : 'Probar conexión') + '</button>' +
        (estado.conexion && estado.conexion.tiene_clave
          ? '<button class="ds-btn ds-btn--ghost" type="button" data-rotar' + (estado.rotando ? ' disabled' : '') + '>' +
              (estado.rotando ? 'Generando…' : 'Generar clave nueva') + '</button>'
          : '') +
      '</div>' +
      '<p class="cn-nota" id="cnClaveAyuda">La clave no se puede volver a mostrar: vive cifrada en la nube. Si la perdiste, genera una nueva.</p>' +
      resultado +
    '</form>' +
  '</section>';
}

function bloqueClave() {
  if (!estado.clave) return '';
  return '<section class="cn-card" aria-labelledby="cnNuevaTitulo">' +
    '<div class="cn-card__cabeza"><h2 class="cn-card__titulo" id="cnNuevaTitulo">Clave nueva</h2>' +
      '<span class="pill pill--ok">se muestra una vez</span></div>' +
    '<p class="cn-clave" data-clave>' + esc(claveVisible(estado.clave)) + '</p>' +
    '<div class="cn-fila">' +
      '<button class="ds-btn ds-btn--secondary" type="button" data-copiar>' +
        (estado.copiado ? 'Copiada' : 'Copiar clave') + '</button>' +
    '</div>' +
    '<p class="cn-nota">Guárdala en la app o en la APK. Los dispositivos anteriores dejaron de sincronizar: ' +
      'vuelve a conectarlos con esta clave.</p>' +
  '</section>';
}

function bloqueEstado() {
  const c = estado.conexion;
  if (!c) return '';
  const disp = estado.dispositivos;
  const conectados = disp.filter((d) => estadoDe(d) === 'ok').length;
  const filas = [
    ['Tienda', esc(c.tienda)],
    ['Identificador', '<code>' + esc(c.local_id) + '</code>'],
    ['Clave de conexión', c.tiene_clave ? 'configurada' : 'sin generar'],
    ['Productos en la nube', String(c.productos || 0)],
    ['Última sincronización', c.ultima_nube ? esc(fechaHora(c.ultima_nube)) : 'nunca'],
    ['Dispositivos conectados', String(conectados) + ' de ' + disp.length],
  ];
  const lista = disp.length
    ? '<ul class="cn-lista">' + disp.map((d) => {
        const est = estadoDe(d);
        return '<li class="cn-disp">' +
          '<span class="cn-disp__ico" aria-hidden="true">▤</span>' +
          '<div class="cn-disp__cuerpo">' +
            '<span class="cn-disp__nombre">' + esc(d.etiqueta || 'Dispositivo sin nombre') + '</span>' +
            '<span class="cn-disp__meta">' + esc(d.plataforma || 'desconocida') +
              (d.version ? ' · ' + esc(d.version) : '') +
              ' · ' + (Number(d.productos) || 0) + (Number(d.productos) === 1 ? ' producto' : ' productos') +
              ' · ' + esc(hace(d.conectado)) + '</span>' +
          '</div>' +
          '<span class="cn-disp__estado" data-estado="' + est + '">' + esc(textoEstado(est)) + '</span>' +
        '</li>';
      }).join('') + '</ul>'
    : '<div class="cn-vacio"><b>Ningún dispositivo conectado todavía</b>' +
      '<span>Abre la app o la APK con la clave de esta tienda y sincroniza. Aquí aparecerá con su hora.</span></div>';

  return '<section class="cn-card" aria-labelledby="cnEstTitulo">' +
    '<div class="cn-card__cabeza"><h2 class="cn-card__titulo" id="cnEstTitulo">Estado de la conexión</h2>' +
      '<button class="ds-btn ds-btn--ghost ds-btn--sm" type="button" data-actualizar>Actualizar</button></div>' +
    '<div class="cn-datos">' + filas.map(([rot, val]) =>
      '<div class="cn-dato"><span class="cn-dato__rot">' + rot + '</span>' +
      '<span class="cn-dato__val">' + val + '</span></div>').join('') + '</div>' +
    lista +
  '</section>';
}

function bloqueFallos() {
  if (!estado.errores.length && !estado.fallo) return '';
  const lista = estado.errores.length
    ? '<ul class="cn-lista">' + estado.errores.map((e) =>
        '<li class="cn-error"><b>' + esc(e.etiqueta || 'Dispositivo') + '</b> · ' +
        esc(fechaHora(e.error_ts)) + '<br>' + esc(e.error || 'fallo sin detalle') + '</li>').join('') + '</ul>'
    : '';
  return '<section class="cn-card" aria-labelledby="cnFallosTitulo">' +
    '<div class="cn-card__cabeza"><h2 class="cn-card__titulo" id="cnFallosTitulo">Fallos recientes</h2>' +
      '<span class="pill pill--err">' + (estado.errores.length + (estado.fallo ? 1 : 0)) + '</span></div>' +
    (estado.fallo ? '<div class="cn-error"><b>Panel</b><br>' + esc(estado.fallo) + '</div>' : '') +
    lista +
    '<p class="cn-nota">Los fallos los reporta el dispositivo al no poder sincronizar. No se borran solos al reconectar.</p>' +
  '</section>';
}

function bloquePasos() {
  return '<section class="cn-card" aria-labelledby="cnPasosTitulo">' +
    '<div class="cn-card__cabeza"><h2 class="cn-card__titulo" id="cnPasosTitulo">Cómo conectar un dispositivo</h2></div>' +
    '<ol class="cn-pasos">' +
      '<li>En la app o la APK, abre <b>Stock → Conexión</b>.</li>' +
      '<li>Escribe el identificador <code>' + esc(estado.ctx && estado.ctx.tienda ? estado.ctx.tienda.id : 'tu-tienda') + '</code> y la clave de 8 caracteres.</li>' +
      '<li>Sube el catálogo del dispositivo: se sincroniza con esta tienda por <code>/api/inventario</code>.</li>' +
      '<li>Vuelve aquí: verás el dispositivo, su hora y sus fallos.</li>' +
    '</ol>' +
    '<p class="cn-nota">El respaldo local sigue viviendo en el dispositivo (SQLite de la app). La nube guarda la copia de la tienda; ' +
      'si cambias de equipo, baja el catálogo desde la app con la misma clave.</p>' +
    '<div class="cn-fila">' +
      '<a class="ds-btn ds-btn--secondary" href="/panel/negocio/ajustes/">Descargar respaldo del catálogo</a>' +
    '</div>' +
  '</section>';
}

function bloqueEscena() {
  return '<div class="cn-escena" aria-label="Enlace entre la tienda y sus dispositivos">' +
    '<div class="cn-hud" data-hud></div>' +
    '<canvas id="cnCanvas" role="img" aria-label="Diagrama animado del enlace entre la tienda y los dispositivos conectados"></canvas>' +
    '<p class="cn-escena__pie">La animación sale del estado real: cada línea es un dispositivo que la API reporta. ' +
      'Verde, sincronizó hace menos de 10 minutos; ámbar, sin novedad hoy; rojo, sin conexión.</p>' +
  '</div>';
}

function pintarHud() {
  const cont = $('[data-hud]');
  if (!cont) return;
  const disp = estado.dispositivos;
  const conError = estado.errores.length > 0 || disp.some((d) => estadoDe(d) === 'mal');
  const conOk = disp.some((d) => estadoDe(d) === 'ok');
  const est = conError ? 'mal' : (conOk ? 'ok' : (disp.length ? 'aviso' : 'aviso'));
  const texto = conError ? 'con fallos' : (conOk ? 'en línea' : (disp.length ? 'sin novedad' : 'sin dispositivos'));
  cont.innerHTML =
    '<span class="cn-hud__chip" data-estado="' + est + '">' + esc(texto) + '</span>' +
    '<span class="cn-hud__chip">' + disp.length + (disp.length === 1 ? ' dispositivo' : ' dispositivos') + '</span>';
}

function contenido() {
  return '<div class="cn-main">' +
    '<header class="cn-cab">' +
      '<p class="ti-eyebrow">Conexión</p>' +
      '<h1 class="cn-cab__titulo">Conecta tu tienda con la app</h1>' +
      '<p class="cn-cab__sub">Una clave por tienda para que la app y la APK sincronicen el catálogo, ' +
        'con respaldo local en el dispositivo. Aquí ves el estado real y los fallos.</p>' +
    '</header>' +
    bloqueEscena() +
    bloqueVerificador() +
    bloqueClave() +
    '<div class="cn-grid cn-grid--dos">' +
      bloqueEstado() +
      bloqueFallos() +
    '</div>' +
    bloquePasos() +
  '</div>';
}

function pintar() {
  const caja = $('[data-negocio]');
  if (!caja || !estado.ctx) return;
  caja.innerHTML = contenido();
  pintarHud();
  const canvas = $('#cnCanvas');
  if (canvas) {
    if (estado.escena) estado.escena.destruir();
    estado.escena = crearEscena(canvas);
  }

  const form = $('[data-verif]');
  if (form) form.addEventListener('submit', verificarClave);
  const input = $('#cnClave');
  if (input) {
    input.addEventListener('input', () => {
      const pos = input.selectionStart;
      const v = claveVisible(input.value);
      if (v) {
        input.value = v;
        try { input.setSelectionRange(pos, pos); } catch (e) { /* sin foco */ }
      }
    });
  }
  const rotar = $('[data-rotar]');
  if (rotar) rotar.addEventListener('click', rotarClave);
  const copiar = $('[data-copiar]');
  if (copiar) copiar.addEventListener('click', copiarClave);
  const act = $('[data-actualizar]');
  if (act) act.addEventListener('click', async () => {
    act.disabled = true;
    await cargarEstado();
    act.disabled = false;
    pintar();
  });
}

function programar() {
  if (estado.reloj) clearInterval(estado.reloj);
  estado.reloj = setInterval(async () => {
    if (document.hidden || !estado.ctx || !estado.ctx.tienda) return;
    await cargarEstado();
    pintar();
  }, 30000);
}

let escuchandoSesion = false;

async function iniciar() {
  const ctx = await arrancar();
  if (!ctx) return;
  if (!escuchandoSesion) {
    escuchandoSesion = true;
    /* Si la sesión se abre o se cierra en otra pestaña, la página se
       reconstruye con el estado nuevo en vez de quedarse con datos viejos. */
    alCambiar(() => { if (estado.ctx) iniciar(); });
  }
  estado.ctx = ctx;
  if (!ctx.tienda) {
    const caja = $('[data-negocio]');
    if (caja) caja.innerHTML = '<div class="cn-vacio"><b>Primero publica tu tienda</b>' +
      '<span>La conexión se genera por tienda. Publica una y vuelve a esta página.</span></div>';
    return;
  }
  pintar();
  await cargarEstado();
  pintar();
  programar();
}

iniciar().catch((e) => {
  const caja = $('[data-negocio]');
  if (caja) caja.innerHTML = '<div class="cn-error"><b>No pudimos abrir la conexión</b><br>' +
    esc((e && e.message) || 'Error inesperado') + '</div>';
});
