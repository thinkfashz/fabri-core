export const config = { api: { bodyParser: false } };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
function leerBody(req) { return new Promise((resolve, reject) => { let c=''; req.on('data',(ch)=>{c+=ch}); req.on('end',()=>{try{resolve(JSON.parse(c||'{}'))}catch(e){reject(new Error('Body JSON inválido'))}}); req.on('error', reject); }); }
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  const auth = (req.headers.authorization || '').slice(7);
  if (!auth || auth !== process.env.FABRI_API_TOKEN) return json(res, { error: 'No autorizado' }, 401);
  let body;
  try { body = await leerBody(req); } catch { return json(res, { error: 'Body JSON inválido' }, 400); }
  const accion = String(body?.accion || 'listar');
  const skills = [
    { id: 'analizador', nombre: 'Analizador de datos', activo: true, archivo: 'skills/analizador.py', dependencia: 'pandas, numpy', tamano_mb: 45 },
    { id: 'graphrag', nombre: 'GraphRAG local', activo: false, archivo: 'skills/graphrag.py', dependencia: 'graphrag, networkx', tamano_mb: 200, requiere: 'Termux o nube' },
    { id: 'rag-lexico', nombre: 'RAG léxico', activo: true, archivo: 'skills/rag_lexico.py', dependencia: 'sqlite3, FTS5', tamano_mb: 0.1 },
    { id: 'pensamiento-critico', nombre: 'Pensamiento crítico', activo: true, archivo: 'skills/pensamiento.py', dependencia: 'llama-cpp-python', tamano_mb: 120 },
    { id: 'mobilellm', nombre: 'MobileLLM-125M', activo: false, archivo: 'models/mobilellm-125m.gguf', dependencia: 'gguf', tamano_mb: 125, requiere: 'Autorización >50MB' }
  ];
  return json(res, { ok: true, accion, skills, count: skills.length, origen: 'nube', timestamp: new Date().toISOString() });
}
