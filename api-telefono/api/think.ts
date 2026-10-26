export const config = { api: { bodyParser: false } };

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let cuerpo = '';
    req.on('data', (chunk) => { cuerpo += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(cuerpo || '{}')); } catch (e) { reject(new Error('Body JSON inválido')); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return json(res, { error: 'No autorizado' }, 401);
  }
  if (auth.slice(7) !== process.env.FABRI_API_TOKEN) {
    return json(res, { error: 'Token inválido' }, 401);
  }

  let body;
  try {
    body = await leerBody(req);
  } catch (e) {
    return json(res, { error: 'Body JSON inválido' }, 400);
  }

  const texto = String(body?.texto || body?.pregunta || '');
  const contexto = String(body?.contexto || '');
  const usuario_id = String(body?.usuario_id || 'anonimo');

  if (!texto) {
    return json(res, { error: 'Falta el campo texto' }, 400);
  }

  let resultados = [];
  let error_db = null;
  let respuesta = `Recibí tu consulta: "${texto}".`;

  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, {
      ok: true,
      respuesta: 'INSFORGE_DATABASE_URL no configurada en el servidor.',
      resultados: [],
      fuente: null,
      confianza: 0,
      error_db: 'INSFORGE_DATABASE_URL no configurada',
      origen: 'nube',
      usuario_id,
    });
  }

  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      const result = await pool.query(
        `SELECT texto, tema, fuente, puntuacion_dopamina
         FROM conocimiento_vectorial
         WHERE tema ILIKE $1 OR texto ILIKE $1
         ORDER BY puntuacion_dopamina DESC NULLS LAST, fecha DESC
         LIMIT 5`,
        [`%${texto}%`]
      );
      resultados = result.rows;
      respuesta = `Encontré ${resultados.length} resultado(s) relacionado(s) con tu consulta en la base de datos.`;
    } catch (e: any) {
      error_db = e?.message || String(e);
      respuesta = `No pude consultar la base de datos: ${error_db}`;
    } finally {
      try { await pool.end(); } catch (e) { /* ignore */ }
    }
  } catch (e: any) {
    error_db = e?.message || String(e);
    respuesta = `No se pudo inicializar el cliente de base de datos: ${error_db}`;
  }

  return json(res, {
    ok: true,
    respuesta,
    resultados,
    fuente: error_db ? null : 'insforge_postgresql',
    confianza: error_db ? 0 : 0.85,
    error_db,
    origen: 'nube',
    usuario_id,
  });
}
