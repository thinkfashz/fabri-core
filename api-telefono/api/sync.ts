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

  const tabla = String(body?.tabla || '');
  const filas = Array.isArray(body?.filas) ? body.filas : [];
  const operacion = String(body?.operacion || 'subir');

  if (!tabla) {
    return json(res, { error: 'Falta el campo tabla' }, 400);
  }

  let error_db = null;
  let filas_recibidas = 0;
  let filas_devueltas = [];

  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, {
      ok: false,
      operacion,
      tabla,
      filas_recibidas: 0,
      filas: [],
      error_db: 'INSFORGE_DATABASE_URL no configurada',
      origen: 'nube',
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
      if (operacion === 'subir') {
        for (const fila of filas) {
          const columnas = Object.keys(fila);
          if (columnas.length === 0) continue;
          const names = columnas.map((c) => `"${c}"`).join(', ');
          const values = columnas.map((c) => {
            const v = fila[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return String(v);
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          await pool.query(
            `INSERT INTO ${tabla} (${names}) VALUES (${values.join(', ')})`
          );
          filas_recibidas++;
        }
      } else if (operacion === 'bajar') {
        const result = await pool.query(`SELECT * FROM ${tabla} LIMIT 100`);
        filas_devueltas = result.rows;
        filas_recibidas = filas_devueltas.length;
      }
    } catch (e: any) {
      error_db = e?.message || String(e);
    } finally {
      try { await pool.end(); } catch (e) { /* ignore */ }
    }
  } catch (e: any) {
    error_db = e?.message || String(e);
  }

  return json(res, {
    ok: !error_db,
    operacion,
    tabla,
    filas_recibidas,
    filas: filas_devueltas,
    error_db,
    origen: 'nube',
  });
}
