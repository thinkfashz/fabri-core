export const config = { api: { bodyParser: false } };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
  const auth = (req.headers.authorization || '').slice(7);
  if (!auth || auth !== process.env.FABRI_API_TOKEN) return json(res, { error: 'No autorizado' }, 401);
  const mensaje = String(req.query?.mensaje || '');
  return json(res, { ok: true, recibido: mensaje ? mensaje : null, estado: 'memoria activa', nota: 'Use POST con mensaje para agregar memoria.', origen: 'nube' });
}
