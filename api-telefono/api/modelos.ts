export const config = { api: { bodyParser: false } };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  const auth = (req.headers.authorization || '').slice(7);
  if (!auth || auth !== process.env.FABRI_API_TOKEN) return json(res, { error: 'No autorizado' }, 401);

  const modelos = [
    { id: 'qwen-0.5b-local', nombre: 'Qwen 2.5 0.5B', tipo: 'local', archivo: 'modelos/qwen2.5-0.5b-instruct-q4_k_m.gguf', estado: 'pendiente carga', necesita: 'Cargar en APK → Chat → Escanear modelos', link: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF', tamano_mb: 383 },
    { id: 'mobilellm-125m', nombre: 'MobileLLM-125M', tipo: 'local', archivo: 'modelos/mobilellm-125m.gguf', estado: 'no autorizado', necesita: 'Botón en Módulos → aceptar >50MB', link: 'https://huggingface.co/facebook/MobileLLM-125M', tamano_mb: 125 },
    { id: 'vercel-ia', nombre: 'IA nube (Vercel/InsForge)', tipo: 'nube', archivo: 'https://fabri-api.vercel.app/api/think', estado: 'configurable', necesita: 'Conexiones → URL https://fabri-api.vercel.app + FABRI_API_TOKEN', link: 'https://fabri-api.vercel.app', tamano_mb: 0 },
    { id: 'ollama-lan', nombre: 'Ollama (LAN o local)', tipo: 'remoto', archivo: 'http://localhost:11434/v1/chat/completions', estado: 'pendiente', necesita: 'Configurar URL del servidor Ollama en Conexiones', link: 'https://ollama.com/', tamano_mb: 0 }
  ];
  return json(res, { ok: true, modelos, count: modelos.length, origen: 'nube', nota: 'Los modelos locales no se descargan automáticamente si superan 50 MB.', timestamp: new Date().toISOString() });
}
