// FORGE CORE STOCK · /api/visitas
// ---------------------------------------------------------------------------
// Contador de visitas del visor 3D, con el canal de origen.
//
// Para qué: el dueño quiere saber cuánta gente entra a la tienda y de dónde
// llega (Instagram, Facebook, WhatsApp, Google…). Se guarda UNA fila por
// visita, sin cookies de terceros y sin datos personales: del visitante sólo
// queda un hash (IP + user-agent + sal) para poder contar únicos.
//
// Contrato:
//   POST /api/visitas   (público, sin token)
//     { canal?, utm_source?, utm_medium?, utm_campaign?, ref?, ruta?, visitante? }
//     → { ok: true, canal }  · el servidor decide el canal, no confía en el cliente
//   GET  /api/visitas?dias=30   (Authorization: Bearer FABRI_API_TOKEN)
//     → totales, únicos, hoy/ayer, por canal, por día, rutas y países
//   OPTIONS → CORS
//
// El canal se deduce en este orden:
//   1. utm_source / utm_medium (lo que trae el enlace)
//   2. navegador dentro de la app (Instagram/Facebook/WhatsApp abren su
//      propio navegador y NO mandan referrer: es el caso más común)
//   3. dominio del referrer (google, bing, etc.)
//   4. sin nada → "directo"
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { Pool } from 'pg';

export const config = { api: { bodyParser: false } };

const TABLA = 'visitas';
const MAX_TEXTO = 300;
const CANALES = [
  'instagram', 'facebook', 'whatsapp', 'google', 'tiktok',
  'buscador', 'x', 'linkedin', 'qr', 'otro', 'directo',
];

let pool: Pool | null = null;
let listo: Promise<void> | null = null;

function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      max: 3,
    });
  }
  return pool;
}

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

function leerBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    let tamano = 0;
    req.on('data', (trozo) => {
      tamano += trozo.length;
      if (tamano > 8_000) { reject(new Error('cuerpo demasiado grande')); req.destroy(); return; }
      cuerpo += trozo;
    });
    req.on('end', () => {
      try {
        const datos = JSON.parse(cuerpo || '{}');
        resolve(datos && typeof datos === 'object' ? datos : {});
      } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function texto(v: unknown, max = MAX_TEXTO): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function autorizado(req: IncomingMessage): boolean {
  const esperado = process.env.FABRI_API_TOKEN;
  if (!esperado) return false;
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return false;
  return h.slice(7).trim() === esperado;
}

/* ── clasificación del canal ────────────────────────────────────────────── */

function canalDe(utm: string, ref: string, ua: string): string {
  const s = (utm + ' ' + ref).toLowerCase();

  // 1 · lo que dice el enlace
  if (/instagram|ig\.me|instagr\.am/.test(s)) return 'instagram';
  if (/facebook|fb\.me|fb\.watch|messenger/.test(s)) return 'facebook';
  if (/whatsapp|wa\.me|api\.whatsapp/.test(s)) return 'whatsapp';
  if (/google|googleusercontent|gclid|adwords/.test(s)) return 'google';
  if (/tiktok/.test(s)) return 'tiktok';
  if (/bing|duckduckgo|yahoo|ecosia|brave/.test(s)) return 'buscador';
  if (/twitter|t\.co|x\.com/.test(s)) return 'x';
  if (/linkedin/.test(s)) return 'linkedin';
  if (/\bqr\b|cartel|afiche/.test(s)) return 'qr';

  // 2 · navegador dentro de la app (no manda referrer)
  const u = ua.toLowerCase();
  if (/instagram/.test(u)) return 'instagram';
  if (/fban|fbav|fb_iab|fbios/.test(u)) return 'facebook';
  if (/whatsapp/.test(u)) return 'whatsapp';
  if (/musical_ly|tiktok|bytedance/.test(u)) return 'tiktok';

  // 3 · referrer conocido / 4 · directo
  if (ref) return 'otro';
  return 'directo';
}

function esBot(ua: string): boolean {
  return /bot|crawler|spider|crawling|facebookexternalhit|slurp|headless|preview|monitor|curl|wget|python-requests|axios|node-fetch/i.test(ua);
}

function visitanteDe(req: IncomingMessage, ua: string): string {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.socket?.remoteAddress || '');
  const sal = process.env.VISITAS_SAL || 'forge-core-stock';
  return createHash('sha256').update(ip + '|' + ua + '|' + sal).digest('hex').slice(0, 24);
}

/* ── esquema ────────────────────────────────────────────────────────────── */

async function asegurar(): Promise<void> {
  if (!listo) {
    listo = (async () => {
      await db().query(`
        CREATE TABLE IF NOT EXISTS ${TABLA} (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT now(),
          canal TEXT NOT NULL,
          ref TEXT,
          utm_source TEXT,
          utm_medium TEXT,
          utm_campaign TEXT,
          ruta TEXT,
          pais TEXT,
          movil BOOLEAN DEFAULT false,
          visitante TEXT
        )
      `);
      await db().query(`CREATE INDEX IF NOT EXISTS ${TABLA}_ts_idx ON ${TABLA} (ts DESC)`);
      await db().query(`CREATE INDEX IF NOT EXISTS ${TABLA}_canal_idx ON ${TABLA} (canal)`);
    })().catch((e) => { listo = null; throw e; });
  }
  return listo;
}

/* ── POST: registrar una visita ────────────────────────────────────────── */

async function registrar(req: IncomingMessage, res: ServerResponse) {
  const cuerpo = await leerBody(req);
  const ua = String(req.headers['user-agent'] || '');
  if (esBot(ua)) return json(res, { ok: true, omitida: 'bot' });

  await asegurar();

  const visitante = visitanteDe(req, ua);

  // cortafuegos simple: más de 40 visitas del mismo hash en un minuto se ignoran
  const spam = await db().query(
    `SELECT count(*)::int n FROM ${TABLA} WHERE visitante = $1 AND ts > now() - interval '1 minute'`,
    [visitante],
  );
  if ((spam.rows[0]?.n || 0) > 40) return json(res, { ok: true, omitida: 'limite' });

  const ref = texto(cuerpo.ref);
  const utmSource = texto(cuerpo.utm_source, 80);
  const utmMedium = texto(cuerpo.utm_medium, 80);
  const canalPedido = texto(cuerpo.canal, 40).toLowerCase();
  const canal = CANALES.includes(canalPedido)
    ? canalPedido
    : canalDe(utmSource + ' ' + utmMedium, ref, ua);

  const pais = texto(req.headers['x-vercel-ip-country'] as string, 8).toUpperCase() || null;
  const movil = /android|iphone|ipad|ipod|mobile|windows phone/i.test(ua);

  await db().query(
    `INSERT INTO ${TABLA} (canal, ref, utm_source, utm_medium, utm_campaign, ruta, pais, movil, visitante)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [canal, ref || null, utmSource || null, utmMedium || null,
      texto(cuerpo.utm_campaign, 120) || null, texto(cuerpo.ruta, 160) || null,
      pais, movil, visitante],
  );

  return json(res, { ok: true, canal });
}

/* ── GET: informe para el panel del dueño ──────────────────────────────── */

async function informe(req: IncomingMessage, res: ServerResponse) {
  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, { ok: false, error: 'base no configurada' }, 503);
  }
  if (!autorizado(req)) {
    return json(res, { ok: false, error: 'requiere Authorization: Bearer del dueño' }, 401);
  }
  await asegurar();

  const url = new URL(String(req.url || ''), 'http://x');
  const dias = Math.min(365, Math.max(1, Number(url.searchParams.get('dias') || 30) || 30));
  const q = (sql: string, params: unknown[] = []) => db().query(sql, params);

  const [tot, canales, porDia, rutas, paises, ultimas, hoy, ayer] = await Promise.all([
    q(`SELECT count(*)::int total, count(DISTINCT visitante)::int unicos
       FROM ${TABLA} WHERE ts > now() - make_interval(days => $1)`, [dias]),
    q(`SELECT canal, count(*)::int n FROM ${TABLA}
       WHERE ts > now() - make_interval(days => $1)
       GROUP BY canal ORDER BY n DESC`, [dias]),
    q(`SELECT to_char(date_trunc('day', ts), 'YYYY-MM-DD') dia, count(*)::int n
       FROM ${TABLA} WHERE ts > now() - make_interval(days => $1)
       GROUP BY 1 ORDER BY 1`, [dias]),
    q(`SELECT ruta, count(*)::int n FROM ${TABLA}
       WHERE ts > now() - make_interval(days => $1) AND ruta IS NOT NULL
       GROUP BY ruta ORDER BY n DESC LIMIT 8`, [dias]),
    q(`SELECT pais, count(*)::int n FROM ${TABLA}
       WHERE ts > now() - make_interval(days => $1) AND pais IS NOT NULL
       GROUP BY pais ORDER BY n DESC LIMIT 8`, [dias]),
    q(`SELECT canal, ruta, pais, movil, ts FROM ${TABLA} ORDER BY ts DESC LIMIT 20`),
    q(`SELECT count(*)::int n FROM ${TABLA} WHERE ts >= date_trunc('day', now())`),
    q(`SELECT count(*)::int n FROM ${TABLA}
       WHERE ts >= date_trunc('day', now()) - interval '1 day'
         AND ts <  date_trunc('day', now())`),
  ]);

  const total = tot.rows[0]?.total || 0;
  const canalesFila = canales.rows.map((r) => ({ canal: r.canal, n: r.n }));
  const suma = canalesFila.reduce((a, r) => a + Number(r.n || 0), 0) || 1;

  return json(res, {
    ok: true,
    dias,
    total,
    unicos: tot.rows[0]?.unicos || 0,
    hoy: hoy.rows[0]?.n || 0,
    ayer: ayer.rows[0]?.n || 0,
    canales: canalesFila.map((r) => ({
      canal: r.canal,
      n: r.n,
      pct: Math.round((Number(r.n) / suma) * 1000) / 10,
    })),
    porDia: porDia.rows.map((r) => ({ dia: r.dia, n: r.n })),
    rutas: rutas.rows,
    paises: paises.rows,
    ultimas: ultimas.rows,
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (req.method === 'POST') return await registrar(req, res);
    if (req.method === 'GET') return await informe(req, res);
    return json(res, { ok: false, error: 'usa GET o POST' }, 405);
  } catch (e) {
    return json(res, { ok: false, error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
}
