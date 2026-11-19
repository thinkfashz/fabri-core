// FORGE CORE STOCK · /api/diagnostico
// ---------------------------------------------------------------------------
// Doctor nativo + informe legacy del ecosistema.
//
// Contrato:
//   GET  /api/diagnostico?accion=doctor&dias=14      (público, CORS)
//     Sondea páginas y APIs reales y devuelve el estado medido + los reportes
//     de navegador agregados por día. No exige token: es el mismo nivel de
//     exposición que /api/health, y todo texto se limpia antes de guardarse.
//   POST /api/diagnostico  { accion:'reporte', pagina, eventos[] }   (público)
//     Guarda un reporte comprimido en `doctor_dias` (una fila por día).
//   GET/POST sin `accion`  (Authorization: Bearer FABRI_API_TOKEN)
//     Informe legacy de la malla. Sigue exigiendo el token del dueño.
//
// Economía de datos (el motivo del diseño):
//   · una fila por día, no una por evento;
//   · agregados con huellas (fingerprints) y topes por página/error/API;
//   · fila máxima ~48 KB y retención de 30 días;
//   · el navegador manda como máximo 12 eventos por carga y 1 latido por
//     página/día; el servidor acepta 20 eventos y 8 KB por reporte.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { Pool } from 'pg';

export const config = { api: { bodyParser: false } };

const TABLA = 'doctor_dias';
const RETENCION_DIAS = 30;
const MAX_CUERPO = 8_000;
const MAX_EVENTOS = 20;
const TOPE_PAGINAS = 25;
const TOPE_ERRORES = 20;
const TOPE_APIS = 15;
const TOPE_FILA = 48 * 1024;
const CACHE_SONDEO_MS = 45_000;

const SITIO = 'https://forge-core-stock.vercel.app';
const API = 'https://fabri-api.vercel.app';

const PAGINAS_WEB = [
  { ruta: '/', nombre: 'Portada', marca: '<title>FORGE CORE STOCK' },
  { ruta: '/app/', nombre: 'App / PWA', marca: 'id="pubBar"' },
  { ruta: '/terminos.html', nombre: 'Términos', marca: '19.496' },
  { ruta: '/panel/cliente/inicio/', nombre: 'Cliente · Inicio', marca: 'data-modulo="inicio"' },
  { ruta: '/panel/cliente/mapa/', nombre: 'Cliente · Mapa', marca: 'data-modulo="mapa"' },
  { ruta: '/panel/cliente/buscar/', nombre: 'Cliente · Buscar', marca: 'data-modulo="buscar"' },
  { ruta: '/panel/cliente/tienda/', nombre: 'Cliente · Tienda', marca: 'data-modulo="tienda"' },
  { ruta: '/panel/cliente/producto/', nombre: 'Cliente · Producto', marca: 'data-modulo="producto"' },
  { ruta: '/panel/cliente/carrito/', nombre: 'Cliente · Carrito', marca: 'data-modulo="carrito"' },
  { ruta: '/panel/cliente/checkout/', nombre: 'Cliente · Checkout', marca: 'data-modulo="checkout"' },
  { ruta: '/panel/cliente/pedido/', nombre: 'Cliente · Pedido', marca: 'data-modulo="pedido"' },
  { ruta: '/panel/cliente/cuenta/', nombre: 'Cliente · Cuenta', marca: 'data-modulo="cuenta"' },
  { ruta: '/panel/cliente/ayuda/', nombre: 'Cliente · Ayuda', marca: 'data-modulo="ayuda"' },
  { ruta: '/panel/doctor/', nombre: 'Doctor', marca: 'data-doctor="1"' },
];

const APIS_SONDEO = [
  { id: 'health', nombre: 'Salud de la API', metodo: 'GET', ruta: '/api/health', espera: 200, valida: (d: any) => d?.ok !== false },
  { id: 'estado', nombre: 'Malla del ecosistema', metodo: 'GET', ruta: '/api/estado', espera: 200, valida: (d: any) => d?.ok !== false },
  { id: 'mercado', nombre: 'Mercado (locales)', metodo: 'GET', ruta: '/api/mercado?accion=locales', espera: 200, valida: (d: any) => Array.isArray(d?.tiendas) },
  { id: 'diagnostico', nombre: 'Diagnóstico protegido', metodo: 'GET', ruta: '/api/diagnostico', espera: 401, valida: () => true, detalle: 'exige token del dueño (401)' },
  { id: 'visitas', nombre: 'Visitas protegido', metodo: 'GET', ruta: '/api/visitas', espera: 401, valida: () => true, detalle: 'exige token del dueño (401)' },
];

const CAPAS = [
  { id: 'cerebro', nombre: 'Cerebro (Vercel)', url: 'https://fabrick-tg-bot.vercel.app/api/health' },
  { id: 'nube', nombre: 'Nube y voz (Cloudflare)', url: 'https://fabrick-cloud.faubricioedms.workers.dev/api/health' },
  { id: 'web', nombre: 'Web y PWA (Vercel)', url: 'https://fabri-core-web.vercel.app/api/health' },
];

/* ── plomería http ──────────────────────────────────────────────────────── */

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function json(res: ServerResponse, data: unknown, status = 200) {
  cors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function leerBody(req: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    let tamano = 0;
    let excedido = false;
    req.on('data', (trozo: Buffer) => {
      tamano += trozo.length;
      if (tamano > MAX_CUERPO) { excedido = true; return; }
      cuerpo += trozo;
    });
    req.on('end', () => {
      if (excedido) return reject(new Error('cuerpo demasiado grande (máx 8 KB)'));
      try {
        const d = JSON.parse(cuerpo || '{}');
        resolve(d && typeof d === 'object' && !Array.isArray(d) ? d : {});
      } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function autorizado(req: IncomingMessage): boolean {
  const esperado = process.env.FABRI_API_TOKEN;
  if (!esperado) return false;
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') && h.slice(7).trim() === esperado;
}

/* ── limpieza: nada de secretos ni datos personales en la nube ──────────── */

function limpiar(v: unknown, max = 300): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '‹token›')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '‹correo›')
    .replace(/\b[a-f0-9]{32,}\b/gi, '‹hash›')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function rutaDe(v: unknown): string {
  const s = limpiar(v, 500);
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) return (new URL(s).pathname || '/').slice(0, 160);
  } catch { /* cae al recorte simple */ }
  return s.split('?')[0].split('#')[0].slice(0, 160);
}

function paginaDe(v: unknown): string {
  let p = rutaDe(v) || '/';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p.slice(0, 160) || '/';
}

function huella(partes: unknown[]): string {
  return createHash('sha1').update(partes.map((x) => String(x ?? '')).join('|')).digest('hex').slice(0, 10);
}

function esBot(ua: string): boolean {
  return /bot|crawler|spider|crawling|facebookexternalhit|slurp|headless|preview|monitor|curl|wget|python-requests|axios|node-fetch/i.test(ua);
}

const ventanas = new Map<string, number[]>();

function permitido(req: IncomingMessage): boolean {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.socket?.remoteAddress || '');
  const ua = String(req.headers['user-agent'] || '');
  const k = createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 16);
  const ahora = Date.now();
  const arr = (ventanas.get(k) || []).filter((t) => ahora - t < 60_000);
  if (arr.length >= 30) { ventanas.set(k, arr); return false; }
  arr.push(ahora);
  ventanas.set(k, arr);
  if (ventanas.size > 500) {
    for (const [kk, vv] of ventanas) {
      if (!vv.length || ahora - vv[vv.length - 1] > 120_000) ventanas.delete(kk);
    }
  }
  return true;
}

/* ── base de datos ──────────────────────────────────────────────────────── */

let pool: Pool | null = null;
let listo: Promise<void> | null = null;
let ultimaLimpieza = 0;

function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10_000,
      max: 3,
    });
  }
  return pool;
}

async function asegurar(): Promise<void> {
  if (!process.env.INSFORGE_DATABASE_URL) throw new Error('INSFORGE_DATABASE_URL no configurada');
  if (!listo) {
    listo = (async () => {
      await db().query(`
        CREATE TABLE IF NOT EXISTS ${TABLA} (
          dia DATE PRIMARY KEY,
          datos JSONB NOT NULL DEFAULT '{}'::jsonb,
          bytes INTEGER NOT NULL DEFAULT 0,
          actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await db().query(`CREATE INDEX IF NOT EXISTS ${TABLA}_actualizado_idx ON ${TABLA} (actualizado DESC)`);
    })().catch((e) => { listo = null; throw e; });
  }
  return listo;
}

async function limpiarHistorial(): Promise<void> {
  if (Date.now() - ultimaLimpieza < 3_600_000) return;
  ultimaLimpieza = Date.now();
  try {
    await db().query(
      `DELETE FROM ${TABLA} WHERE dia < current_date - make_interval(days => $1)`,
      [RETENCION_DIAS],
    );
  } catch { /* la retención no puede tumbar un reporte */ }
}

/* ── fusión compacta de un reporte ──────────────────────────────────────── */

type Evento = {
  t: string; m: string; a: string; l: number; c: number; p: string;
  s: string; u: string; st: number; ms: number; me: string;
};

const TIPOS = new Set(['error', 'promesa', 'recurso', 'api', 'skeleton', 'visto', 'lento']);

function normalizarEvento(crudo: any, paginaReporte: string): Evento | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const t = limpiar(crudo.t, 20).toLowerCase();
  if (!TIPOS.has(t)) return null;
  const mensaje = limpiar(crudo.m, 400);
  const archivo = rutaDe(crudo.a || crudo.archivo);
  const url = rutaDe(crudo.u || crudo.url);
  if (!mensaje && !url && t !== 'visto') return null;
  return {
    t,
    m: mensaje,
    a: archivo,
    l: Math.max(0, Math.min(9_999_999, Number(crudo.l || crudo.linea) || 0)),
    c: Math.max(0, Math.min(9_999, Number(crudo.c || crudo.columna) || 0)),
    p: paginaDe(crudo.p || paginaReporte),
    s: limpiar(crudo.s || crudo.stack, 600),
    u: url,
    st: Math.max(0, Math.min(599, Number(crudo.st || crudo.status) || 0)),
    ms: Math.max(0, Math.min(600_000, Number(crudo.ms) || 0)),
    me: /^post$/i.test(String(crudo.me || '')) ? 'POST' : 'GET',
  };
}

function promedio(actual: number, nuevo: number, n: number): number {
  if (!nuevo) return actual;
  if (!actual) return nuevo;
  return Math.round(actual + (nuevo - actual) / Math.max(1, n));
}

function topPor(obj: Record<string, any>, tope: number, peso: (v: any) => number) {
  const claves = Object.keys(obj);
  if (claves.length <= tope) return { obj, quitados: 0 };
  const orden = claves.sort((a, b) => peso(obj[b]) - peso(obj[a]));
  const nuevo: Record<string, any> = {};
  for (const k of orden.slice(0, tope)) nuevo[k] = obj[k];
  return { obj: nuevo, quitados: claves.length - tope };
}

function fusionar(datos: any, pagina: string, eventos: Evento[]) {
  const d = datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
  d.v = 1;
  d.paginas = d.paginas && typeof d.paginas === 'object' ? d.paginas : {};
  d.errores = d.errores && typeof d.errores === 'object' ? d.errores : {};
  d.apis = d.apis && typeof d.apis === 'object' ? d.apis : {};
  d.kpis = d.kpis && typeof d.kpis === 'object' ? d.kpis : {};
  const k = d.kpis;
  for (const campo of ['v', 'e', 'a', 'f', 'l', 'r']) k[campo] = Number(k[campo]) || 0;
  k.r += 1;

  const p = d.paginas[pagina] || (d.paginas[pagina] = { v: 0, e: 0, a: 0, f: 0, l: 0, ms: 0, ult: '' });
  for (const campo of ['v', 'e', 'a', 'f', 'l', 'ms']) p[campo] = Number(p[campo]) || 0;
  const ahora = new Date().toISOString();
  p.ult = ahora;

  for (const e of eventos) {
    if (e.t === 'visto') {
      p.v += 1;
      k.v += 1;
      if (e.ms) p.ms = promedio(p.ms, e.ms, p.v);
      continue;
    }
    if (e.t === 'lento') {
      p.l += 1;
      p.ms = promedio(p.ms, e.ms, p.v + p.l);
      k.l += 1;
      continue;
    }
    if (e.t === 'api') {
      p.a += 1;
      k.a += 1;
      const clave = (e.me + ' ' + (e.u || '/api')).slice(0, 100);
      const a = d.apis[clave] || (d.apis[clave] = { n: 0, f: 0, ms: 0, st: 0, u: '' });
      a.n = Number(a.n) || 0;
      a.f = Number(a.f) || 0;
      a.ms = Number(a.ms) || 0;
      a.n += 1;
      a.ms = promedio(a.ms, e.ms, a.n);
      a.st = e.st || 0;
      a.u = ahora;
      if (!e.st || e.st >= 400) { a.f += 1; p.f += 1; k.f += 1; }
      continue;
    }

    // error, promesa, recurso o esqueleto atascado: se agrupa por huella.
    p.e += 1;
    k.e += 1;
    const fp = huella([e.t, e.m, e.a, e.l, e.p]);
    const x = d.errores[fp] || (d.errores[fp] = {
      t: e.t, m: e.m, a: e.a, l: e.l, c: e.c, p: e.p, n: 0, u: '', s: '',
    });
    x.n = (Number(x.n) || 0) + 1;
    x.u = ahora;
    if (!x.s && e.s) x.s = e.s;
  }

  const rp = topPor(d.paginas, TOPE_PAGINAS, (v) => (v.v || 0) + (v.e || 0) + (v.a || 0));
  const re = topPor(d.errores, TOPE_ERRORES, (v) => v.n || 0);
  const ra = topPor(d.apis, TOPE_APIS, (v) => v.n || 0);
  d.paginas = rp.obj; d.errores = re.obj; d.apis = ra.obj;
  k.recortados = (Number(k.recortados) || 0) + rp.quitados + re.quitados + ra.quitados;
  return d;
}

function recortarHasta(d: any): number {
  let bytes = Buffer.byteLength(JSON.stringify(d), 'utf8');
  if (bytes <= TOPE_FILA) return bytes;

  // Primero se sacrifica el stack (lo más caro y lo menos necesario para IA).
  for (const x of Object.values(d.errores) as any[]) {
    if (x.s) { x.s = ''; bytes = Buffer.byteLength(JSON.stringify(d), 'utf8'); }
    if (bytes <= TOPE_FILA) return bytes;
  }

  // Después se van las huellas menos repetidas.
  while (bytes > TOPE_FILA) {
    const claves = Object.keys(d.errores);
    if (!claves.length) break;
    const peor = claves.sort((a, b) => (d.errores[a].n || 0) - (d.errores[b].n || 0))[0];
    delete d.errores[peor];
    d.kpis.recortados = (Number(d.kpis.recortados) || 0) + 1;
    bytes = Buffer.byteLength(JSON.stringify(d), 'utf8');
  }
  return bytes;
}

async function guardarReporte(pagina: string, eventos: Evento[]) {
  await asegurar();
  const cliente = await db().connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(
      `INSERT INTO ${TABLA} (dia, datos) VALUES (current_date, '{}'::jsonb) ON CONFLICT (dia) DO NOTHING`,
    );
    const r = await cliente.query(`SELECT datos FROM ${TABLA} WHERE dia = current_date FOR UPDATE`);
    const datos = fusionar(r.rows[0]?.datos, pagina, eventos);
    const bytes = recortarHasta(datos);
    await cliente.query(
      `UPDATE ${TABLA} SET datos = $1::jsonb, bytes = $2, actualizado = now() WHERE dia = current_date`,
      [JSON.stringify(datos), bytes],
    );
    await cliente.query('COMMIT');
    return { bytes, dia: new Date().toISOString().slice(0, 10) };
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch { /* nada */ }
    throw e;
  } finally {
    cliente.release();
  }
}

/* ── sondeo real de páginas y APIs ──────────────────────────────────────── */

let cacheSondeo: { ts: number; paginas: any[]; apis: any[]; malla: any[] } | null = null;

async function sondearPagina(p: typeof PAGINAS_WEB[number]) {
  const t0 = Date.now();
  try {
    const r = await fetch(SITIO + p.ruta, {
      headers: { Accept: 'text/html', 'User-Agent': 'ForgeDoctor/1.0 (+panel)' },
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
      cache: 'no-store',
    });
    const html = await r.text();
    const ms = Date.now() - t0;
    const marcador = html.includes(p.marca);
    const ok = r.ok && marcador;
    return {
      ruta: p.ruta, nombre: p.nombre, ok, http: r.status, ms, marcador,
      detalle: !r.ok ? `HTTP ${r.status}` : (!marcador ? 'responde, pero falta el marcador de la página' : 'responde'),
    };
  } catch (e: any) {
    return {
      ruta: p.ruta, nombre: p.nombre, ok: false, http: 0, ms: Date.now() - t0, marcador: false,
      detalle: e?.name === 'TimeoutError' ? 'sin respuesta en 6 s' : String(e?.message || e).slice(0, 160),
    };
  }
}

async function sondearApi(a: typeof APIS_SONDEO[number]) {
  const t0 = Date.now();
  try {
    const r = await fetch(API + a.ruta, {
      method: a.metodo,
      headers: { Accept: 'application/json', 'User-Agent': 'ForgeDoctor/1.0 (+panel)' },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    const ms = Date.now() - t0;
    let d: any = null;
    try { d = await r.json(); } catch { /* respuesta sin JSON */ }
    const ok = r.status === a.espera && a.valida(d);
    return {
      id: a.id, nombre: a.nombre, metodo: a.metodo, ruta: a.ruta.split('?')[0],
      ok, http: r.status, ms,
      detalle: ok ? (a.detalle || (d?.version ? 'v' + d.version : 'responde')) : (d?.error || `HTTP ${r.status}`),
    };
  } catch (e: any) {
    return {
      id: a.id, nombre: a.nombre, metodo: a.metodo, ruta: a.ruta.split('?')[0],
      ok: false, http: 0, ms: Date.now() - t0,
      detalle: e?.name === 'TimeoutError' ? 'sin respuesta en 6 s' : String(e?.message || e).slice(0, 160),
    };
  }
}

async function sondearMalla() {
  return Promise.all(CAPAS.map(async (c) => {
    const t0 = Date.now();
    try {
      const r = await fetch(c.url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      const d: any = await r.json().catch(() => null);
      return {
        id: c.id, nombre: c.nombre, ok: r.ok && d?.ok !== false, ms: Date.now() - t0,
        detalle: d?.servicio ? `${d.servicio} v${d.version || '?'}` : `HTTP ${r.status}`,
      };
    } catch (e: any) {
      return {
        id: c.id, nombre: c.nombre, ok: false, ms: Date.now() - t0,
        detalle: e?.name === 'TimeoutError' ? 'sin respuesta en 5 s' : String(e?.message || e).slice(0, 160),
      };
    }
  }));
}

async function medir() {
  if (cacheSondeo && Date.now() - cacheSondeo.ts < CACHE_SONDEO_MS) return cacheSondeo;
  const [paginas, apis, malla] = await Promise.all([
    Promise.all(PAGINAS_WEB.map(sondearPagina)),
    Promise.all(APIS_SONDEO.map(sondearApi)),
    sondearMalla(),
  ]);
  cacheSondeo = { ts: Date.now(), paginas, apis, malla };
  return cacheSondeo;
}

/* ── agregación de los días guardados ───────────────────────────────────── */

function agregar(filas: any[], dias: number) {
  const paginas: Record<string, any> = {};
  const errores: Record<string, any> = {};
  const apis: Record<string, any> = {};
  const kpis = { vistas: 0, errores: 0, api_llamadas: 0, api_fallos: 0, lentas: 0, reportes: 0, recortados: 0 };
  const porDia: any[] = [];

  for (const fila of filas) {
    const d = fila.datos && typeof fila.datos === 'object' ? fila.datos : {};
    const k = d.kpis || {};
    kpis.vistas += Number(k.v) || 0;
    kpis.errores += Number(k.e) || 0;
    kpis.api_llamadas += Number(k.a) || 0;
    kpis.api_fallos += Number(k.f) || 0;
    kpis.lentas += Number(k.l) || 0;
    kpis.reportes += Number(k.r) || 0;
    kpis.recortados += Number(k.recortados) || 0;
    porDia.push({
      dia: String(fila.dia).slice(0, 10),
      vistas: Number(k.v) || 0,
      errores: Number(k.e) || 0,
      api_fallos: Number(k.f) || 0,
      reportes: Number(k.r) || 0,
      kb: Math.round((Number(fila.bytes) || 0) / 102.4) / 10,
    });

    for (const [ruta, v] of Object.entries(d.paginas || {})) {
      const p = paginas[ruta] || (paginas[ruta] = { ruta, vistas: 0, errores: 0, api_llamadas: 0, api_fallos: 0, lentas: 0, ms: 0, ultima: '' });
      const n = Number((v as any).v) || 0;
      p.vistas += n;
      p.errores += Number((v as any).e) || 0;
      p.api_llamadas += Number((v as any).a) || 0;
      p.api_fallos += Number((v as any).f) || 0;
      p.lentas += Number((v as any).l) || 0;
      p.ms = promedio(p.ms, Number((v as any).ms) || 0, p.vistas + p.lentas);
      const u = String((v as any).ult || '');
      if (u > p.ultima) p.ultima = u;
    }

    for (const [fp, x] of Object.entries(d.errores || {})) {
      const e = errores[fp] || (errores[fp] = {
        fp, tipo: (x as any).t || 'error', mensaje: (x as any).m || '', archivo: (x as any).a || '',
        linea: Number((x as any).l) || 0, columna: Number((x as any).c) || 0, pagina: (x as any).p || '',
        veces: 0, ultimo: '', stack: (x as any).s || '',
      });
      e.veces += Number((x as any).n) || 0;
      const u = String((x as any).u || '');
      if (u > e.ultimo) e.ultimo = u;
      if (!e.stack && (x as any).s) e.stack = (x as any).s;
    }

    for (const [clave, a] of Object.entries(d.apis || {})) {
      const x = apis[clave] || (apis[clave] = { clave, llamadas: 0, fallos: 0, ms: 0, status: 0, ultimo: '' });
      x.llamadas += Number((a as any).n) || 0;
      x.fallos += Number((a as any).f) || 0;
      x.ms = promedio(x.ms, Number((a as any).ms) || 0, x.llamadas);
      x.status = Number((a as any).st) || x.status;
      const u = String((a as any).u || '');
      if (u > x.ultimo) x.ultimo = u;
    }
  }

  return {
    dias: porDia.slice(-dias),
    paginas: Object.values(paginas).sort((a: any, b: any) => (b.vistas + b.errores) - (a.vistas + a.errores)),
    errores: Object.values(errores).sort((a: any, b: any) => b.veces - a.veces),
    apis: Object.values(apis).sort((a: any, b: any) => (b.fallos - a.fallos) || (b.llamadas - a.llamadas)),
    kpis,
  };
}

function descubrir(salud: any, reportes: any, almacen: any): string[] {
  const d: string[] = [];
  const caidas = salud.paginas.filter((p: any) => !p.ok);
  if (caidas.length) {
    d.push(`${caidas.length} página(s) no responden o llegan incompletas: ` +
      caidas.slice(0, 3).map((p: any) => p.ruta + ' (' + p.detalle + ')').join('; ') + '.');
  }
  const apisCaidas = salud.apis.filter((a: any) => !a.ok);
  if (apisCaidas.length) {
    d.push(`${apisCaidas.length} API(s) con problema: ` +
      apisCaidas.map((a: any) => a.metodo + ' ' + a.ruta + ' (' + a.detalle + ')').join('; ') + '.');
  }
  const lentas = salud.paginas.filter((p: any) => p.ok).sort((a: any, b: any) => b.ms - a.ms);
  if (lentas.length) d.push(`La página más lenta es ${lentas[0].ruta} con ${lentas[0].ms} ms.`);

  const apiPeor = reportes.apis.filter((a: any) => a.fallos > 0).sort((a: any, b: any) => b.fallos - a.fallos)[0];
  if (apiPeor) d.push(`La API con más fallos es ${apiPeor.clave}: ${apiPeor.fallos} de ${apiPeor.llamadas} llamadas.`);

  const errTop = reportes.errores[0];
  if (errTop) {
    d.push(`El error más repetido es «${errTop.mensaje.slice(0, 120)}» en ` +
      `${errTop.archivo || '?'}:${errTop.linea || 0}${errTop.columna ? ':' + errTop.columna : ''} (${errTop.veces} veces).`);
  }
  const pagError = reportes.paginas.filter((p: any) => p.errores > 0).sort((a: any, b: any) => b.errores - a.errores)[0];
  if (pagError) d.push(`La página con más errores es ${pagError.ruta} (${pagError.errores}).`);

  if (almacen.ok && almacen.filas) {
    d.push(`El almacén guarda ${reportes.kpis.reportes} reporte(s) y ${reportes.kpis.errores} error(es) ` +
      `en ${almacen.kb} KB: ${almacen.filas} fila(s), una por día.`);
  }
  if (!reportes.kpis.vistas) {
    d.push('Todavía no hay latidos de navegador: el doctor empieza a medir cuando alguien abre una página con el cliente cargado.');
  }
  return d;
}

function resumenIA(salud: any, reportes: any, almacen: any, descubrimientos: string[]): string {
  const L: string[] = [];
  L.push('DOCTOR FORGE CORE · ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  L.push(`Páginas: ${salud.resumen.paginas_ok}/${salud.resumen.paginas_total} arriba · ` +
    `APIs: ${salud.resumen.apis_ok}/${salud.resumen.apis_total} arriba.`);
  const pCaidas = salud.paginas.filter((p: any) => !p.ok).map((p: any) => p.ruta);
  if (pCaidas.length) L.push('Páginas con problema: ' + pCaidas.join(', ') + '.');
  const aCaidas = salud.apis.filter((a: any) => !a.ok).map((a: any) => a.metodo + ' ' + a.ruta);
  if (aCaidas.length) L.push('APIs con problema: ' + aCaidas.join(', ') + '.');

  if (reportes.errores.length) {
    L.push(`Errores de navegador: ${reportes.kpis.errores} en ${reportes.errores.length} huella(s).`);
    for (const e of reportes.errores.slice(0, 5)) {
      L.push(`- [${e.tipo}] ${e.mensaje.slice(0, 160)} · ${e.archivo || '?'}:${e.linea || 0}` +
        `${e.columna ? ':' + e.columna : ''} · ${e.pagina} · ${e.veces}×`);
    }
  } else {
    L.push('Sin errores de navegador reportados en el periodo.');
  }

  const peores = reportes.apis.filter((a: any) => a.fallos > 0).slice(0, 3);
  if (peores.length) {
    L.push('APIs con fallos: ' + peores.map((a: any) =>
      `${a.clave} (${a.fallos}/${a.llamadas}, último ${a.status || 'sin red'})`).join('; ') + '.');
  }

  if (descubrimientos.length) {
    L.push('Descubrimientos:');
    for (const d of descubrimientos.slice(0, 6)) L.push('- ' + d);
  }
  L.push(`Almacén: ${almacen.filas} fila(s), ${almacen.kb} KB, retención ${almacen.retencion_dias} días, ` +
    `topes ${almacen.topes.paginas}/${almacen.topes.errores}/${almacen.topes.apis}.`);
  return L.join('\n').slice(0, 3000);
}

/* ── GET público: estado real + reportes ────────────────────────────────── */

async function doctor(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(String(req.url || ''), 'http://x');
  const dias = Math.min(RETENCION_DIAS, Math.max(1, Number(url.searchParams.get('dias') || 14) || 14));

  const saludBase = await medir();
  const salud = {
    ok: saludBase.paginas.every((p) => p.ok) && saludBase.apis.every((a) => a.ok),
    paginas: saludBase.paginas,
    apis: saludBase.apis,
    malla: saludBase.malla,
    resumen: {
      paginas_ok: saludBase.paginas.filter((p) => p.ok).length,
      paginas_total: saludBase.paginas.length,
      apis_ok: saludBase.apis.filter((a) => a.ok).length,
      apis_total: saludBase.apis.length,
      malla_ok: saludBase.malla.filter((m) => m.ok).length,
      malla_total: saludBase.malla.length,
    },
  };

  const almacen: any = {
    ok: false, tabla: TABLA, filas: 0, dias: 0, bytes: 0, kb: 0,
    retencion_dias: RETENCION_DIAS,
    topes: { paginas: TOPE_PAGINAS, errores: TOPE_ERRORES, apis: TOPE_APIS, fila_kb: Math.round(TOPE_FILA / 1024) },
    desde: null, hasta: null, error: null,
  };
  let reportes: any = { dias: [], paginas: [], errores: [], apis: [], kpis: {
    vistas: 0, errores: 0, api_llamadas: 0, api_fallos: 0, lentas: 0, reportes: 0, recortados: 0,
  } };

  if (!process.env.INSFORGE_DATABASE_URL) {
    almacen.error = 'INSFORGE_DATABASE_URL no configurada';
  } else {
    try {
      await asegurar();
      const [filas, meta] = await Promise.all([
        db().query(
          `SELECT dia::text AS dia, datos, bytes FROM ${TABLA}
           WHERE dia > current_date - make_interval(days => $1) ORDER BY dia`,
          [dias],
        ),
        db().query(
          `SELECT count(*)::int AS filas,
                  coalesce(sum(pg_column_size(datos)), 0)::int AS bytes,
                  min(dia)::text AS desde,
                  max(dia)::text AS hasta
           FROM ${TABLA}`,
        ),
      ]);
      reportes = agregar(filas.rows, dias);
      const m = meta.rows[0] || {};
      almacen.ok = true;
      almacen.filas = Number(m.filas) || 0;
      almacen.dias = almacen.filas;
      almacen.bytes = Number(m.bytes) || 0;
      almacen.kb = Math.round(almacen.bytes / 102.4) / 10;
      almacen.desde = m.desde || null;
      almacen.hasta = m.hasta || null;
    } catch (e: any) {
      almacen.error = String(e?.message || e).slice(0, 200);
    }
  }

  const descubrimientos = descubrir(salud, reportes, almacen);
  return json(res, {
    ok: true,
    servicio: 'forge-doctor',
    version: 1,
    hora: new Date().toISOString(),
    dias,
    salud,
    reportes,
    almacen,
    descubrimientos,
    resumen_ia: resumenIA(salud, reportes, almacen, descubrimientos),
    nota: 'Datos medidos, no estimados. El sondeo se cachea 45 s para no castigar los despliegues.',
  });
}

/* ── POST público: un reporte comprimido ────────────────────────────────── */

async function recibirReporte(req: IncomingMessage, res: ServerResponse, cuerpo: Record<string, any>) {
  const ua = String(req.headers['user-agent'] || '');
  if (esBot(ua)) return json(res, { ok: true, guardado: false, omitido: 'bot' });
  if (!permitido(req)) return json(res, { ok: true, guardado: false, omitido: 'limite' });

  const pagina = paginaDe(cuerpo.pagina);
  const crudos = Array.isArray(cuerpo.eventos) ? cuerpo.eventos.slice(0, MAX_EVENTOS) : [];
  const eventos: Evento[] = [];
  for (const c of crudos) {
    const e = normalizarEvento(c, pagina);
    if (e) eventos.push(e);
  }
  if (!eventos.length) return json(res, { ok: true, guardado: false, omitidos: crudos.length });

  try {
    const r = await guardarReporte(pagina, eventos);
    limpiarHistorial();
    return json(res, {
      ok: true, guardado: true, pagina, eventos: eventos.length,
      omitidos: crudos.length - eventos.length, dia: r.dia, bytes: r.bytes,
    });
  } catch (e: any) {
    // El doctor nunca rompe la página que lo llama: si el almacén falla, se
    // responde 200 con guardado:false para que el navegador no reintente.
    return json(res, {
      ok: true, guardado: false,
      error: String(e?.message || e).slice(0, 160),
    });
  }
}

/* ── POST protegido: limpieza manual de un día ─────────────────────────── */

async function limpiarDia(req: IncomingMessage, res: ServerResponse, cuerpo: Record<string, any>) {
  if (!autorizado(req)) {
    return json(res, { ok: false, error: 'requiere Authorization: Bearer del dueño' }, 401);
  }
  await asegurar();
  const dia = String(cuerpo.dia || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    const r = await db().query(`DELETE FROM ${TABLA} WHERE dia = $1`, [dia]);
    return json(res, { ok: true, borradas: r.rowCount, dia });
  }
  const dias = Math.max(0, Math.min(365, Number(cuerpo.dias) || RETENCION_DIAS));
  const r = await db().query(
    `DELETE FROM ${TABLA} WHERE dia < current_date - make_interval(days => $1)`,
    [dias],
  );
  return json(res, { ok: true, borradas: r.rowCount, dias });
}

/* ── informe legacy (con token) ─────────────────────────────────────────── */

async function informeLegacy(req: IncomingMessage, res: ServerResponse) {
  if (!autorizado(req)) {
    return json(res, { ok: false, error: 'requiere Authorization: Bearer del dueño' }, 401);
  }

  const partes: any[] = [];
  let db_ok = false, db_err: string | null = null, db_tablas = 0, db_nombres: string[] = [];

  if (process.env.INSFORGE_DATABASE_URL) {
    try {
      await asegurar();
      const r = await db().query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
      db_tablas = r.rows.length;
      db_nombres = r.rows.map((x: any) => x.tablename);
      db_ok = true;
    } catch (e: any) { db_err = String(e?.message || e); }
  } else {
    db_err = 'INSFORGE_DATABASE_URL no configurada en Vercel';
  }

  partes.push({
    componente: 'API Vercel',
    estado: 'operativa',
    detalle: 'Endpoint /api/diagnostico responde',
    url: API,
    token_api: process.env.FABRI_API_TOKEN ? 'presente' : 'faltante',
  });
  partes.push({
    componente: 'Base de datos InsForge',
    estado: db_ok ? 'conectada' : 'error',
    detalle: db_ok ? `${db_tablas} tablas encontradas` : (db_err || 'desconocido'),
    tablas: db_nombres,
    error: db_err,
  });
  partes.push({
    componente: 'Doctor nativo',
    estado: 'operativo',
    detalle: 'GET ?accion=doctor (público) y POST {accion:"reporte"} guardan una fila por día en ' + TABLA,
    link: '/panel/doctor/',
  });

  const malla = await sondearMalla();
  for (const m of malla) {
    partes.push({
      componente: m.nombre,
      estado: m.ok ? 'arriba' : 'caida',
      detalle: `${m.detalle} · ${m.ms} ms`,
      url: CAPAS.find((c) => c.id === m.id)?.url.replace('/api/health', ''),
    });
  }

  return json(res, {
    ok: true,
    informe: partes,
    malla,
    resumen_malla: {
      capas: malla.length,
      arriba: malla.filter((m) => m.ok).length,
      caidas: malla.filter((m) => !m.ok).length,
    },
    timestamp: new Date().toISOString(),
    origen: 'nube',
    nota: 'Sin alucinaciones: solo datos verificados o acciones concretas requeridas.',
  });
}

/* ── handler ────────────────────────────────────────────────────────────── */

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(String(req.url || '/'), 'http://x');
  const accion = String(url.searchParams.get('accion') || '').toLowerCase();

  try {
    if (req.method === 'GET') {
      if (accion === 'doctor') return await doctor(req, res);
      return await informeLegacy(req, res);
    }

    if (req.method === 'POST') {
      // El reporte público se reconoce por `accion` en el cuerpo. Sin esa
      // marca, el POST conserva el comportamiento legacy con token. El cuerpo
      // se lee UNA vez: volver a leerlo dejaría el stream consumido.
      let cuerpo: Record<string, any> | null = null;
      let errorCuerpo: any = null;
      try {
        cuerpo = await leerBody(req);
      } catch (e) {
        errorCuerpo = e;
      }
      if (cuerpo && String(cuerpo.accion || '').toLowerCase() === 'reporte') {
        return await recibirReporte(req, res, cuerpo);
      }
      // Limpieza manual (solo el dueño): borra un día concreto o lo anterior
      // a N días. Sirve para retirar datos de prueba sin esperar la retención.
      if (cuerpo && String(cuerpo.accion || '').toLowerCase() === 'limpiar') {
        return await limpiarDia(req, res, cuerpo);
      }
      // Si el cuerpo no se pudo leer y quien llama no es el dueño, es un
      // reporte roto: 413 claro. Con token, el legacy sigue respondiendo.
      if (errorCuerpo && !autorizado(req)) {
        return json(res, { ok: false, error: String(errorCuerpo?.message || errorCuerpo) }, 413);
      }
      return await informeLegacy(req, res);
    }

    return json(res, { ok: false, error: 'usa GET, POST u OPTIONS' }, 405);
  } catch (e: any) {
    return json(res, { ok: false, error: String(e?.message || e).slice(0, 200) }, 500);
  }
}
