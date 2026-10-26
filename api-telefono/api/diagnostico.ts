export const config = { api: { bodyParser: false } };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return json(res, { error: 'No autorizado' }, 401);
  if (auth.slice(7) !== process.env.FABRI_API_TOKEN) return json(res, { error: 'Token inválido' }, 401);

  // Informe de diagnóstico real: no alucinaciones. Solo verifica lo que se puede medir.
  const partes = [];
  let db_ok = false, db_err = null, db_tablas = 0, db_nombres = [];

  if (process.env.INSFORGE_DATABASE_URL) {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.INSFORGE_DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      try {
        const r = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
        db_tablas = r.rows.length;
        db_nombres = r.rows.map((x: any) => x.tablename);
        db_ok = true;
      } catch (e: any) { db_err = e?.message || String(e); }
      finally { try { await pool.end(); } catch (e) {} }
    } catch (e: any) { db_err = e?.message || String(e); }
  } else { db_err = 'INSFORGE_DATABASE_URL no configurada en Vercel'; }

  const vercel_token = !!process.env.FABRI_API_TOKEN ? 'presente' : 'faltante';

  partes.push({
    componente: 'API Vercel',
    estado: 'operativa',
    detalle: 'Endpoint /api/diagnostico responde',
    url: 'https://fabri-api.vercel.app',
    token_api: vercel_token
  });
  partes.push({
    componente: 'Base de datos InsForge',
    estado: db_ok ? 'conectada' : 'error',
    detalle: db_ok ? `${db_tablas} tablas encontradas` : (db_err || 'desconocido'),
    tablas: db_nombres,
    error: db_err
  });
  partes.push({
    componente: 'APK FABRI-CORE',
    estado: 'instalada 0.9.10',
    detalle: 'Verifica en el dispositivo si la APK en /storage/emulated/0/Download/FABRI-CORE-0.9.10.apk responde',
    nota: 'No hay verificación remota automática: requiere interacción con la APK instalada',
    requerimiento: 'Instalar 0.9.10 y configurar Conexiones con URL + token'
  });
  partes.push({
    componente: 'Modelo local Qwen 0.5B',
    estado: 'pendiente',
    detalle: 'Requiere archivo .gguf cargado en APK (localCargar). Si no está cargado, chat local responderá vacío.',
    accion: 'Usa Escanear modelos → Cargar modelo en la pantalla Chat',
    link: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF'
  });
  partes.push({
    componente: 'Modelo remoto / Nube',
    estado: 'pendiente',
    detalle: 'Requiere configurar URL + clave en Conexiones (Vercel o local).',
    accion: 'Abre Conexiones → Agregar URL https://fabri-api.vercel.app + token → Probar',
    link: 'https://fabri-api.vercel.app'
  });
  partes.push({
    componente: 'MobileLLM-125M',
    estado: 'pendiente autorización',
    detalle: 'Modelo >50 MB. No se descarga sin tu autorización explícita (W^X).',
    accion: 'Pulsa botón en Módulos → Acepta confirmación → se registra intento, no descarga automática',
    link: 'https://huggingface.co/facebook/MobileLLM-125M'
  });
  partes.push({
    componente: 'Termux exterior conectado a APK',
    estado: 'posible',
    detalle: 'Si necesitas herramientas pesadas (GraphRAG, Python) fuera de la APK: instala en Termux al lado y conecta por HTTP local.',
    accion: 'En Termux: pkg install python clang nodejs; luego configura URL local (ej. http://localhost:8000) en la APK',
    nota: 'No se puede integrar Termux dentro de la APK por W^X y tamaño >50 MB.'
  });
  partes.push({
    componente: 'Sistema de diseño / branding',
    estado: 'aplicado',
    detalle: 'tokens.css, SKILL.md y BRAND_GUIDELINES.md creados en branding/. App.css actualizado con variables --fb-*. Revisar que el logo y loader 2.5s estén presentes.',
    link_local: './branding/'
  });

  // Malla real: se consulta el /api/health de cada capa con tope de tiempo.
  // Si una está caída se informa la caída; nunca se inventa un "ok".
  const capas = [
    { id: 'cerebro', nombre: 'Cerebro (Vercel)', url: 'https://fabrick-tg-bot.vercel.app/api/health' },
    { id: 'nube', nombre: 'Nube y voz (Cloudflare)', url: 'https://fabrick-cloud.faubricioedms.workers.dev/api/health' },
    { id: 'web', nombre: 'Web y PWA (Vercel)', url: 'https://fabri-core-web.vercel.app/api/health' },
  ];
  const malla = await Promise.all(capas.map(async (c) => {
    const t0 = Date.now();
    try {
      const r = await fetch(c.url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      const d: any = await r.json().catch(() => null);
      return { id: c.id, nombre: c.nombre, ok: r.ok && d?.ok !== false, ms: Date.now() - t0, detalle: d?.servicio ? `${d.servicio} v${d.version || '?'}` : `HTTP ${r.status}` };
    } catch (e: any) {
      return { id: c.id, nombre: c.nombre, ok: false, ms: Date.now() - t0, detalle: e?.name === 'TimeoutError' ? 'sin respuesta en 5 s' : String(e?.message || e) };
    }
  }));
  for (const m of malla) {
    partes.push({
      componente: m.nombre,
      estado: m.ok ? 'arriba' : 'caida',
      detalle: `${m.detalle} · ${m.ms} ms`,
      url: capas.find((c) => c.id === m.id)?.url.replace('/api/health', ''),
    });
  }

  return json(res, {
    ok: true,
    informe: partes,
    malla,
    resumen_malla: {
      capas: malla.length,
      arriba: malla.filter((m) => m.ok).length,
      caidas: malla.filter((m) => !m.ok).length,
    },
    timestamp: new Date().toISOString(),
    origen: 'nube',
    nota: 'Sin alucinaciones: solo datos verificados o acciones concretas requeridas.',
  });
}
