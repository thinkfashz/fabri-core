export const config = { api: { bodyParser: false } };

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return json(res, { error: 'Method not allowed' }, 405);
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return json(res, { error: 'No autorizado' }, 401);
  }
  if (auth.slice(7) !== process.env.FABRI_API_TOKEN) {
    return json(res, { error: 'Token inválido' }, 401);
  }

  let db_conectada = false;
  let tablas: string[] = [];
  let error_db: string | null = null;

  if (!process.env.INSFORGE_DATABASE_URL) {
    return json(res, {
      ok: true,
      origen: 'insforge',
      db_conectada: false,
      tablas_count: 0,
      tablas: [],
      error_db: 'INSFORGE_DATABASE_URL no configurada',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: process.env.INSFORGE_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      const resQuery = await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
      tablas = resQuery.rows.map((r: { tablename: string }) => r.tablename);
      db_conectada = true;
    } catch (e: any) {
      error_db = e?.message || String(e);
    } finally {
      try { await pool.end(); } catch (e) { /* ignore */ }
    }
  } catch (e: any) {
    error_db = e?.message || String(e);
  }

  return json(res, {
    ok: true,
    origen: 'insforge',
    db_conectada,
    tablas_count: tablas.length,
    tablas,
    error_db,
    timestamp: new Date().toISOString(),
  });
}
