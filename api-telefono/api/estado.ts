// FABRI-CORE · /api/estado
// Malla del ecosistema vista desde la capa que usa el teléfono.
//
// Sondea el /api/health de las cuatro capas y devuelve un contrato único.
// Nunca falla entero: si una capa está caída, esa fila lo dice y el resto
// sigue respondiendo. Es la misma forma que exponen fabrick-cloud
// (/api/malla) y fabrick-tg-bot (/api/estado).
export const config = { api: { bodyParser: false } };

const CAPAS = [
  { id: 'api', nombre: 'API del teléfono', url: 'https://fabri-api.vercel.app', health: '/api/health', rol: 'puerta de la APK' },
  { id: 'cerebro', nombre: 'Cerebro', url: 'https://fabrick-tg-bot.vercel.app', health: '/api/health', rol: 'modelos + persona + memoria' },
  { id: 'nube', nombre: 'Nube y voz', url: 'https://fabrick-cloud.faubricioedms.workers.dev', health: '/api/health', rol: 'panel + MeloTTS + cola' },
  { id: 'web', nombre: 'Web y PWA', url: 'https://fabri-core-web.vercel.app', health: '/api/health', rol: 'landing + app web' },
];

const TOPE_MS = 5000;

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=45',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

async function sondear(capa: (typeof CAPAS)[number]) {
  const inicio = Date.now();
  try {
    const r = await fetch(capa.url + capa.health, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TOPE_MS),
    });
    const ms = Date.now() - inicio;
    const cuerpo: any = await r.json().catch(() => null);
    const ok = r.ok && cuerpo?.ok !== false;
    return {
      ...capa,
      ok,
      estado: ok ? 'arriba' : 'degradada',
      ms,
      http: r.status,
      detalle: ok
        ? (cuerpo?.version ? `v${cuerpo.version}` : 'responde')
        : `HTTP ${r.status}`,
      servicio: cuerpo?.servicio || capa.id,
      version: cuerpo?.version || null,
    };
  } catch (e: any) {
    return {
      ...capa,
      ok: false,
      estado: 'caida',
      ms: Date.now() - inicio,
      http: 0,
      detalle: e?.name === 'TimeoutError' ? `sin respuesta en ${TOPE_MS / 1000}s` : String(e?.message || e),
      servicio: capa.id,
      version: null,
    };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const capas = await Promise.all(CAPAS.map(sondear));
  const arriba = capas.filter((c) => c.ok).length;

  return json(res, {
    ok: arriba > 0,
    servicio: 'fabri-api',
    capa: 'api',
    version: '1.1.0',
    hora: new Date().toISOString(),
    capas,
    resumen: {
      capas: capas.length,
      arriba,
      degradadas: capas.filter((c) => c.estado === 'degradada').length,
      caidas: capas.filter((c) => c.estado === 'caida').length,
      latenciaMaxMs: Math.max(...capas.map((c) => c.ms)),
    },
  });
}
