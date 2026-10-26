// FABRI-CORE · /api/health
// Salud PÚBLICA y barata de la puerta que usa el teléfono.
//
// Reglas:
//   · No consulta la base: si InsForge está lento, este endpoint igual
//     responde en milisegundos (es el que usa la malla del ecosistema).
//   · No expone valores de entorno, solo si están presentes.
//   · Contrato común con fabrick-cloud, fabrick-tg-bot y fabri-core-web:
//       { ok, servicio, capa, version, hora, dependencias[] }
//     Así el panel de cualquiera de las tres capas puede leer a las demás.
export const config = { api: { bodyParser: false } };

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data, null, 2));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const dependencias = [
    {
      nombre: 'FABRI_API_TOKEN',
      ok: Boolean(process.env.FABRI_API_TOKEN),
      detalle: process.env.FABRI_API_TOKEN
        ? 'token de la app configurado'
        : 'falta: el teléfono no podrá autenticarse',
      critica: true,
    },
    {
      nombre: 'INSFORGE_DATABASE_URL',
      ok: Boolean(process.env.INSFORGE_DATABASE_URL),
      detalle: process.env.INSFORGE_DATABASE_URL
        ? 'base Postgres enlazada'
        : 'falta: /api/think y /api/sync responderán sin base',
      critica: true,
    },
  ];

  return json(res, {
    ok: true,
    servicio: 'fabri-api',
    capa: 'api',
    version: '1.1.0',
    hora: new Date().toISOString(),
    // El teléfono es el cliente de esta capa: no hay servidor que sondear.
    telefono: {
      url: 'https://fabri-api.vercel.app',
      token_configurado: Boolean(process.env.FABRI_API_TOKEN),
      endpoints: ['/api/think', '/api/sync', '/api/stats', '/api/diagnostico', '/api/modelos', '/api/estado'],
    },
    dependencias,
    resumen: {
      dependencias: dependencias.length,
      listas: dependencias.filter((d) => d.ok).length,
    },
  });
}
