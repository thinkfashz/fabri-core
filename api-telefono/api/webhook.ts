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

  const { tipo, mensaje, origen } = body;

  console.log(`[WEBHOOK] ${origen || 'unknown'} | ${tipo || 'sin_tipo'} | ${mensaje || ''}`);

  return json(res, {
    ok: true,
    recibido: true,
    tipo: tipo || null,
    mensaje: mensaje || null,
    origen: origen || null,
    timestamp: new Date().toISOString(),
  });
}
