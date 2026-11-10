// FORGE CORE STOCK · /api/agente
// ---------------------------------------------------------------------------
// Cuatro endpoints chicos del agente reunidos en UNA sola función serverless.
//
// Por qué: el plan Hobby de Vercel permite 12 funciones por despliegue y
// fabri-api ya usaba las 12 (think, sync, stats, webhook, diagnostico, modelos,
// memoria, skills, health, estado, inventario, catalogo). Antes de sumar
// /api/mercado —el backend real del marketplace— había que soltar cupo. Estos
// tres son los que el sitio y la APK NO llaman en el flujo de venta, así que se
// juntan acá sin perder ninguna ruta.
//
// Después, al sumar /api/auth (cuentas en InsForge), se mudó acá `/api/stats`:
// es diagnóstico de base, no flujo de venta, y su contrato no cambia.
//
// Vercel conserva la ruta original en `req.url`, así que la misma función
// atiende las cuatro rutas y elige por el camino pedido:
//   GET  /api/memoria   → estado de la memoria
//   GET  /api/modelos   → catálogo de modelos locales/remotos
//   POST /api/skills    → lista/acciona skills
//   GET  /api/stats     → tablas de InsForge (antes en stats.ts)
//
// Contrato idéntico al de los archivos originales (mismo token, mismo JSON),
// para no romper a ningún consumidor. Todo exige
// `Authorization: Bearer FABRI_API_TOKEN`.
// ---------------------------------------------------------------------------

export const config = { api: { bodyParser: false } };

function json(res: any, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function autorizado(req: any): boolean {
  const esperado = (process.env.FABRI_API_TOKEN || '').trim();
  const auth = String(req.headers.authorization || '').slice(7);
  return Boolean(esperado) && auth === esperado;
}

function leerBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let c = '';
    req.on('data', (ch: any) => { c += ch; });
    req.on('end', () => { try { resolve(JSON.parse(c || '{}')); } catch (e) { reject(new Error('Body JSON inválido')); } });
    req.on('error', reject);
  });
}

/* ── GET /api/memoria ───────────────────────────────────────────────────── */
function memoria(req: any, res: any) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  if (!autorizado(req)) return json(res, { error: 'No autorizado' }, 401);
  const mensaje = String((req.query && req.query.mensaje) || '');
  return json(res, {
    ok: true,
    recibido: mensaje ? mensaje : null,
    estado: 'memoria activa',
    nota: 'Use POST con mensaje para agregar memoria.',
    origen: 'nube',
  });
}

/* ── GET /api/modelos ───────────────────────────────────────────────────── */
function modelos(req: any, res: any) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  if (!autorizado(req)) return json(res, { error: 'No autorizado' }, 401);

  const lista = [
    { id: 'qwen-0.5b-local', nombre: 'Qwen 2.5 0.5B', tipo: 'local', archivo: 'modelos/qwen2.5-0.5b-instruct-q4_k_m.gguf', estado: 'pendiente carga', necesita: 'Cargar en APK → Chat → Escanear modelos', link: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF', tamano_mb: 383 },
    { id: 'mobilellm-125m', nombre: 'MobileLLM-125M', tipo: 'local', archivo: 'modelos/mobilellm-125m.gguf', estado: 'no autorizado', necesita: 'Botón en Módulos → aceptar >50MB', link: 'https://huggingface.co/facebook/MobileLLM-125M', tamano_mb: 125 },
    { id: 'vercel-ia', nombre: 'IA nube (Vercel/InsForge)', tipo: 'nube', archivo: 'https://fabri-api.vercel.app/api/think', estado: 'configurable', necesita: 'Conexiones → URL https://fabri-api.vercel.app + FABRI_API_TOKEN', link: 'https://fabri-api.vercel.app', tamano_mb: 0 },
    { id: 'ollama-lan', nombre: 'Ollama (LAN o local)', tipo: 'remoto', archivo: 'http://localhost:11434/v1/chat/completions', estado: 'pendiente', necesita: 'Configurar URL del servidor Ollama en Conexiones', link: 'https://ollama.com/', tamano_mb: 0 },
  ];
  return json(res, { ok: true, modelos: lista, count: lista.length, origen: 'nube', nota: 'Los modelos locales no se descargan automáticamente si superan 50 MB.', timestamp: new Date().toISOString() });
}

/* ── POST /api/skills ───────────────────────────────────────────────────── */
async function skills(req: any, res: any) {
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  if (!autorizado(req)) return json(res, { error: 'No autorizado' }, 401);
  let body: any;
  try { body = await leerBody(req); } catch (e) { return json(res, { error: 'Body JSON inválido' }, 400); }
  const accion = String(body?.accion || 'listar');
  const lista = [
    { id: 'analizador', nombre: 'Analizador de datos', activo: true, archivo: 'skills/analizador.py', dependencia: 'pandas, numpy', tamano_mb: 45 },
    { id: 'graphrag', nombre: 'GraphRAG local', activo: false, archivo: 'skills/graphrag.py', dependencia: 'graphrag, networkx', tamano_mb: 200, requiere: 'Termux o nube' },
    { id: 'rag-lexico', nombre: 'RAG léxico', activo: true, archivo: 'skills/rag_lexico.py', dependencia: 'sqlite3, FTS5', tamano_mb: 0.1 },
    { id: 'pensamiento-critico', nombre: 'Pensamiento crítico', activo: true, archivo: 'skills/pensamiento.py', dependencia: 'llama-cpp-python', tamano_mb: 120 },
    { id: 'mobilellm', nombre: 'MobileLLM-125M', activo: false, archivo: 'models/mobilellm-125m.gguf', dependencia: 'gguf', tamano_mb: 125, requiere: 'Autorización >50MB' },
  ];
  return json(res, { ok: true, accion, skills: lista, count: lista.length, origen: 'nube', timestamp: new Date().toISOString() });
}

/* ── GET /api/stats ─────────────────────────────────────────────────────── */
/**
 * Antes vivía en `stats.ts`. Se mudó acá por el tope de 12 funciones del plan
 * Hobby: el contrato es idéntico (mismo token, mismo JSON) y Vercel conserva
 * la ruta original en `req.url`.
 */
async function stats(req: any, res: any) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  if (!autorizado(req)) return json(res, { error: 'No autorizado' }, 401);

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

export default async function handler(req: any, res: any) {
  const camino = new URL(String(req.url || '/'), 'http://fabri-api.local').pathname;
  if (camino.endsWith('/memoria')) return memoria(req, res);
  if (camino.endsWith('/modelos')) return modelos(req, res);
  if (camino.endsWith('/skills')) return skills(req, res);
  if (camino.endsWith('/stats')) return stats(req, res);
  return json(res, { error: 'ruta desconocida en /api/agente', camino }, 404);
}
