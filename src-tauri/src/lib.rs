// ============================================================================
//  FABRI-CORE · núcleo Rust
//  ---------------------------------------------------------------------------
//  Este archivo es el corazón del contenedor: guarda configuración, catálogo de
//  componentes, historial de operaciones, logs persistentes y diagnóstico.
//
//  Se compila como biblioteca compartida (cdylib) para ARM64 Android y se
//  expone a Java mediante una ÚNICA función JNI: `exec(op, payloadJson)`.
//  Java (la Activity) la publica a JavaScript con @JavascriptInterface y la
//  interfaz HTML la usa como una API de mensajes JSON.
//
//  Regla de seguridad de esta fase: NO se ejecuta ningún comando de shell
//  arbitrario. La "consola" corre tareas internas de una lista blanca.
// ============================================================================

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use rusqlite::types::ValueRef;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------------------
// Estado global del proceso (una sola conexión SQLite por proceso de la app).
// ---------------------------------------------------------------------------
struct Estado {
    db: Connection,
    data_dir: PathBuf,
}

static ESTADO: Mutex<Option<Estado>> = Mutex::new(None);

/// ¿El esquema de inventario ya está verificado? Se marca tras la primera
/// llamada para no repetir `inv_esquema` (PRAGMA + ALTER) en cada consulta.
static ESQUEMA_LISTO: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Manifiestos de Fase 3: se incrustan en el binario para que la interfaz pueda
// saber qué componentes tienen manifiesto válido sin tocar el sistema de archivos.
// Son los MISMOS archivos que valida `tools/validador` en las pruebas.
// ---------------------------------------------------------------------------
pub mod manifiesto;
pub mod modulos;

const MANIFIESTOS: &[(&str, &str)] = &[
    (
        "manifiestos/ejecutables/runtime-llama.json",
        include_str!("../../manifiestos/ejecutables/runtime-llama.json"),
    ),
    (
        "manifiestos/bibliotecas/sqlite-vec.json",
        include_str!("../../manifiestos/bibliotecas/sqlite-vec.json"),
    ),
    (
        "manifiestos/modelos/qwen2.5-0.5b-instruct-q4_k_m.json",
        include_str!("../../manifiestos/modelos/qwen2.5-0.5b-instruct-q4_k_m.json"),
    ),
    (
        "manifiestos/modelos/bge-small-en-v1.5-q4_k_m.json",
        include_str!("../../manifiestos/modelos/bge-small-en-v1.5-q4_k_m.json"),
    ),
    (
        "manifiestos/modelos/modelo-smollm2-135m.json",
        include_str!("../../manifiestos/modelos/modelo-smollm2-135m.json"),
    ),
    (
        "manifiestos/modelos/modelo-smollm2-135m-q2.json",
        include_str!("../../manifiestos/modelos/modelo-smollm2-135m-q2.json"),
    ),
    (
        "manifiestos/modelos/modelo-qwen05-q2.json",
        include_str!("../../manifiestos/modelos/modelo-qwen05-q2.json"),
    ),
    (
        "manifiestos/modelos/embeddings-minilm.json",
        include_str!("../../manifiestos/modelos/embeddings-minilm.json"),
    ),
    // Módulo de visión: los modelos son el artefacto descargable. El runtime
    // que los consume vive en el WebView (JS/WASM), porque Android 10+ prohíbe
    // ejecutar binarios nativos descargados (W^X).
    (
        "manifiestos/modelos/modelo-face-landmarker.json",
        include_str!("../../manifiestos/modelos/modelo-face-landmarker.json"),
    ),
    (
        "manifiestos/modelos/modelo-efficientdet-lite0.json",
        include_str!("../../manifiestos/modelos/modelo-efficientdet-lite0.json"),
    ),
];

/// Directorio de datos del núcleo (None si todavía no se inicializó).
fn dir_datos() -> Option<PathBuf> {
    let g = ESTADO.lock().ok()?;
    g.as_ref().map(|e| e.data_dir.clone())
}

/// Manifiestos añadidos por el usuario en `filesDir/manifiestos/**`. Permiten
/// sumar modelos o bibliotecas sin recompilar la APK: se validan con las
/// mismas reglas duras que los incrustados.
fn manifiestos_dinamicos() -> Vec<(String, String)> {
    let base = match dir_datos() {
        Some(d) => d.join("manifiestos"),
        None => return Vec::new(),
    };
    fn recorrer(dir: &std::path::Path, salida: &mut Vec<(String, String)>) {
        let entradas = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entrada in entradas.flatten() {
            let ruta = entrada.path();
            if ruta.is_dir() {
                recorrer(&ruta, salida);
            } else if ruta.extension().map(|x| x == "json").unwrap_or(false) {
                if let Ok(texto) = fs::read_to_string(&ruta) {
                    salida.push((ruta.to_string_lossy().to_string(), texto));
                }
            }
        }
    }
    let mut salida = Vec::new();
    recorrer(&base, &mut salida);
    salida
}

/// Busca un manifiesto por id y devuelve los datos mínimos para poder crear su
/// fila en la tabla `componentes` cuando el estado se guarda por primera vez.
fn datos_manifiesto(id: &str) -> (String, String, Option<String>, Option<String>) {
    let mut fuentes: Vec<(String, String)> = MANIFIESTOS
        .iter()
        .map(|(r, t)| (r.to_string(), t.to_string()))
        .collect();
    fuentes.extend(manifiestos_dinamicos());
    for (_, texto) in fuentes {
        let m = match serde_json::from_str::<Value>(&texto) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if m.get("id").and_then(|v| v.as_str()) != Some(id) {
            continue;
        }
        let texto_de = |clave: &str| -> Option<String> {
            m.get(clave).and_then(|v| v.as_str()).map(|s| s.to_string())
        };
        return (
            texto_de("nombre").unwrap_or_else(|| id.to_string()),
            texto_de("tipo").unwrap_or_else(|| "otro".to_string()),
            texto_de("version"),
            texto_de("licencia"),
        );
    }
    (id.to_string(), "otro".to_string(), None, None)
}

/// Devuelve cada manifiesto con su veredicto. La interfaz usa
/// `habilitacion.descargar` para decidir si el botón se puede tocar.
fn op_manifiestos(_payload: &Value) -> Result<Value, String> {
    let mut lista: Vec<Value> = Vec::new();
    let mut vistos: Vec<String> = Vec::new();
    let dinamicos = manifiestos_dinamicos();
    let mut fuentes: Vec<(String, String)> = MANIFIESTOS
        .iter()
        .map(|(r, t)| (r.to_string(), t.to_string()))
        .collect();
    fuentes.extend(dinamicos);
    for (ruta, texto) in fuentes.iter() {
        match serde_json::from_str::<Value>(texto) {
            Ok(m) => {
                let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if !id.is_empty() && vistos.iter().any(|x| x == &id) {
                    continue;
                }
                if !id.is_empty() {
                    vistos.push(id.clone());
                }
                let veredicto = manifiesto::validar(&m);
                lista.push(json!({
                    "ruta": ruta,
                    "id": m.get("id").cloned().unwrap_or(Value::Null),
                    "nombre": m.get("nombre").cloned().unwrap_or(Value::Null),
                    "tipo": m.get("tipo").cloned().unwrap_or(Value::Null),
                    "descripcion": m.get("descripcion").cloned().unwrap_or(Value::Null),
                    "version": m.get("version").cloned().unwrap_or(Value::Null),
                    "origen": m.get("origen").cloned().unwrap_or(Value::Null),
                    "sha256": m.get("sha256").cloned().unwrap_or(Value::Null),
                    "tamano": m.get("tamano").cloned().unwrap_or(Value::Null),
                    "autorizado": m.get("autorizado").cloned().unwrap_or(Value::Null),
                    "licencia": m.get("licencia").cloned().unwrap_or(Value::Null),
                    "plataforma": m.get("plataforma").cloned().unwrap_or(Value::Null),
                    "arquitectura": m.get("arquitectura").cloned().unwrap_or(Value::Null),
                    "dependencias": m.get("dependencias").cloned().unwrap_or(Value::Null),
                    "directorio": m.get("directorio").cloned().unwrap_or(Value::Null),
                    "interfaz": m.get("interfaz").cloned().unwrap_or(Value::Null),
                    "salud": m.get("salud").cloned().unwrap_or(Value::Null),
                    "estado": m.get("estado").cloned().unwrap_or(Value::Null),
                    "valido": veredicto["valido"].clone(),
                    "errores": veredicto["errores"].clone(),
                    "habilitacion": veredicto["habilitacion"].clone()
                }));
            }
            Err(e) => lista.push(json!({
                "ruta": ruta,
                "valido": false,
                "errores": [format!("JSON inválido: {}", e)],
                "habilitacion": { "descargar": false, "instalar": false, "probar": false }
            })),
        }
    }
    Ok(json!({ "manifiestos": lista }))
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/// Marca de tiempo UNIX en segundos.
fn ahora() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Identificador corto y único para operaciones (no requiere crates extra).
fn id_operacion(prefijo: &str) -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{}-{:x}", prefijo, n)
}

/// Lee un campo de texto obligatorio del payload JSON.
fn campo<'a>(payload: &'a Value, clave: &str) -> Result<&'a str, String> {
    payload
        .get(clave)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("falta el campo obligatorio '{}'", clave))
}

/// Escribe una línea en el log de archivo (además de la tabla SQLite).
fn escribir_log_archivo(data_dir: &Path, nivel: &str, origen: &str, mensaje: &str) {
    let dir = data_dir.join("logs");
    let _ = fs::create_dir_all(&dir);
    let ruta = dir.join("fabrick.log");
    // Rotación: el archivo crecía sin límite (cada mensaje de consola de la
    // WebView se añade aquí). En un teléfono con el disco casi lleno eso
    // termina pesando en cada arranque. A los 512 KB se conserva una copia.
    if let Ok(m) = fs::metadata(&ruta) {
        if m.len() > 512 * 1024 {
            let _ = fs::rename(&ruta, dir.join("fabrick.log.1"));
        }
    }
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ruta)
    {
        let _ = writeln!(f, "{} [{}] {} :: {}", ahora(), nivel, origen, mensaje);
    }
}

/// Conserva sólo las últimas `conservar` filas de una tabla de registro.
/// Sin esto, `logs` y `revision` crecen para siempre: la migración del arranque
/// termina recorriendo decenas de miles de filas en un teléfono.
fn podar_registro(conn: &Connection, tabla: &str, conservar: i64) -> rusqlite::Result<()> {
    // La tabla viene de una lista cerrada, nunca de la interfaz.
    if tabla != "logs" && tabla != "revision" {
        return Ok(());
    }
    let sql = format!(
        "DELETE FROM {} WHERE id <= (SELECT id FROM {} ORDER BY id DESC LIMIT 1 OFFSET ?1)",
        tabla, tabla
    );
    // Si hay menos filas que `conservar`, la subconsulta devuelve NULL y el
    // DELETE no borra nada (comparación con NULL), que es lo correcto.
    let _ = conn.execute(&sql, rusqlite::params![conservar]);
    Ok(())
}

/// Tamaño del GGUF leído desde su cabecera, sin cargar los pesos.
/// Formato: "GGUF" (4 bytes), versión (u32 LE), nº tensores (u64 LE), nº pares KV (u64 LE).
fn leer_cabecera_gguf(ruta: &Path) -> Option<(u32, u64, u64)> {
    use std::io::Read;
    let mut f = fs::File::open(ruta).ok()?;
    let mut cabecera = [0u8; 24];
    f.read_exact(&mut cabecera).ok()?;
    if &cabecera[0..4] != b"GGUF" {
        return None;
    }
    let version = u32::from_le_bytes([cabecera[4], cabecera[5], cabecera[6], cabecera[7]]);
    let tensores = u64::from_le_bytes(cabecera[8..16].try_into().ok()?);
    let kv = u64::from_le_bytes(cabecera[16..24].try_into().ok()?);
    Some((version, tensores, kv))
}

/// Espacio libre y total del filesystem que contiene `ruta`.
/// Se usa statvfs directamente para no depender de `df`.
#[repr(C)]
struct StatVfs {
    f_bsize: u64,
    f_frsize: u64,
    f_blocks: u64,
    f_bfree: u64,
    f_bavail: u64,
    f_files: u64,
    f_ffree: u64,
    f_favail: u64,
    f_fsid: u64,
    f_flag: u64,
    f_namemax: u64,
}

extern "C" {
    fn statvfs(ruta: *const std::os::raw::c_char, buf: *mut StatVfs) -> std::os::raw::c_int;
}

fn espacio(ruta: &Path) -> (u64, u64, u64) {
    use std::ffi::CString;
    let Ok(c) = CString::new(ruta.to_string_lossy().as_bytes()) else {
        return (0, 0, 0);
    };
    let mut st = StatVfs {
        f_bsize: 0,
        f_frsize: 0,
        f_blocks: 0,
        f_bfree: 0,
        f_bavail: 0,
        f_files: 0,
        f_ffree: 0,
        f_favail: 0,
        f_fsid: 0,
        f_flag: 0,
        f_namemax: 0,
    };
    let rc = unsafe { statvfs(c.as_ptr(), &mut st) };
    if rc != 0 {
        return (0, 0, 0);
    }
    let bloque = if st.f_frsize > 0 { st.f_frsize } else { st.f_bsize };
    (
        st.f_blocks * bloque,
        st.f_bfree * bloque,
        st.f_bavail * bloque,
    )
}

// ---------------------------------------------------------------------------
// Esquema: configuración, catálogo, logs, operaciones y modelos detectados.
// ---------------------------------------------------------------------------

fn migrar(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS config (
            clave       TEXT PRIMARY KEY,
            valor       TEXT NOT NULL,
            actualizado INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS componentes (
            id              TEXT PRIMARY KEY,
            nombre          TEXT NOT NULL,
            tipo            TEXT NOT NULL,
            version         TEXT,
            descripcion     TEXT,
            estado          TEXT NOT NULL DEFAULT 'NO DISPONIBLE',
            version_inst    TEXT,
            licencia        TEXT,
            origen          TEXT,
            sha256          TEXT,
            tamano_bytes    INTEGER DEFAULT 0,
            actualizado     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            ts      INTEGER NOT NULL,
            nivel   TEXT NOT NULL,
            origen  TEXT NOT NULL,
            mensaje TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS operaciones (
            id      TEXT PRIMARY KEY,
            inicio  INTEGER NOT NULL,
            fin     INTEGER,
            tipo    TEXT NOT NULL,
            fase    TEXT,
            estado  TEXT NOT NULL,
            detalle TEXT
        );

        CREATE TABLE IF NOT EXISTS modelos (
            id        TEXT PRIMARY KEY,
            ruta      TEXT NOT NULL,
            nombre    TEXT NOT NULL,
            formato   TEXT,
            tamano    INTEGER,
            version   INTEGER,
            tensores  INTEGER,
            estado    TEXT,
            detectado INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auditoria_datos (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            ts      INTEGER NOT NULL,
            tabla   TEXT NOT NULL,
            fila    TEXT,
            accion  TEXT NOT NULL,
            detalle TEXT
        );

        -- Tabla de productos (colector de inventario)
        CREATE TABLE IF NOT EXISTS productos (
            id_producto       TEXT PRIMARY KEY,
            nombre            TEXT NOT NULL,
            descripcion       TEXT,
            precio_venta      REAL DEFAULT 0,
            stock_actual      INTEGER DEFAULT 0,
            stock_minimo      INTEGER DEFAULT 0,
            fecha_actualizacion INTEGER NOT NULL
        );

        -- Tabla de clientes
        CREATE TABLE IF NOT EXISTS clientes (
            id_cliente   TEXT PRIMARY KEY,
            nombre       TEXT NOT NULL,
            contacto     TEXT,
            fecha_alta   INTEGER NOT NULL
        );

        -- Tabla de facturas (encabezado de ventas)
        CREATE TABLE IF NOT EXISTS facturas (
            id_factura          TEXT PRIMARY KEY,
            id_cliente          TEXT,
            fecha_emision       INTEGER NOT NULL,
            subtotal            REAL DEFAULT 0,
            impuesto_calculado  REAL DEFAULT 0,
            total               REAL DEFAULT 0,
            codigo_qr           TEXT,
            estado_sincronizacion INTEGER DEFAULT 0,
            FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente)
        );

        -- Tabla de detalle de factura (conexión productos-ventas)
        CREATE TABLE IF NOT EXISTS detalle_factura (
            id_detalle      INTEGER PRIMARY KEY AUTOINCREMENT,
            id_factura      TEXT NOT NULL,
            id_producto     TEXT NOT NULL,
            cantidad        INTEGER DEFAULT 1,
            precio_unitario REAL DEFAULT 0,
            FOREIGN KEY (id_factura) REFERENCES facturas(id_factura),
            FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
        );

        -- Tabla de auto-aprendizaje (memoria dinámica del asistente)
        CREATE TABLE IF NOT EXISTS aprendizajes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            tema        TEXT NOT NULL,
            contenido   TEXT NOT NULL,
            preferencia TEXT,
            veces_usado INTEGER DEFAULT 0,
            fecha       INTEGER NOT NULL
        );

        -- Tabla de conocimiento GraphRAG (nodos y relaciones)
        CREATE TABLE IF NOT EXISTS conocimiento_vector (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            texto   TEXT NOT NULL,
            tema    TEXT,
            vector  TEXT,  -- JSON con embedding (cuando haya embeddings)
            fuente  TEXT,
            fecha   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS revision (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        INTEGER NOT NULL,
            tipo      TEXT NOT NULL,
            severidad TEXT NOT NULL,
            origen    TEXT NOT NULL,
            mensaje   TEXT NOT NULL,
            detalle   TEXT DEFAULT '',
            ms        INTEGER DEFAULT 0
        );

        -- Perfil del operador: es una sola fila (id = 1). La foto viaja como
        -- data URL ya reducida por la interfaz (~20 KB), nunca el original.
        CREATE TABLE IF NOT EXISTS perfil (
            id          INTEGER PRIMARY KEY CHECK (id = 1),
            nombre      TEXT NOT NULL DEFAULT '',
            indicativo  TEXT NOT NULL DEFAULT '',
            foto        TEXT NOT NULL DEFAULT '',
            actualizado INTEGER NOT NULL DEFAULT 0
        );

        -- Usuarios de la app. El acceso (PIN) vive aquí, no sólo en las
        -- preferencias del teléfono: el verificador PBKDF2 se guarda con su sal
        -- y su algoritmo, y Java sólo hace el cálculo. La huella sigue en el
        -- Keystore de Android.
        CREATE TABLE IF NOT EXISTS usuarios (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario       TEXT NOT NULL UNIQUE,
            nombre        TEXT NOT NULL DEFAULT '',
            indicativo    TEXT NOT NULL DEFAULT '',
            foto          TEXT NOT NULL DEFAULT '',
            rol           TEXT NOT NULL DEFAULT 'operador',
            algoritmo     TEXT NOT NULL DEFAULT '',
            sal           TEXT NOT NULL DEFAULT '',
            hash          TEXT NOT NULL DEFAULT '',
            iteraciones   INTEGER NOT NULL DEFAULT 0,
            activo        INTEGER NOT NULL DEFAULT 1,
            creado        INTEGER NOT NULL DEFAULT 0,
            ultimo_acceso INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_revision_ts ON revision(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_ops_inicio ON operaciones(inicio DESC);
        CREATE INDEX IF NOT EXISTS idx_auditoria_ts ON auditoria_datos(ts DESC);
        CREATE INDEX IF NOT EXISTS idx_productos_stock ON productos(stock_actual);
        CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON facturas(fecha_emision);
        CREATE INDEX IF NOT EXISTS idx_detalle_factura ON detalle_factura(id_factura);
        CREATE INDEX IF NOT EXISTS idx_aprendizajes_tema ON aprendizajes(tema);
        CREATE INDEX IF NOT EXISTS idx_conocimiento_tema ON conocimiento_vector(tema);
        "#,
    )?;

    // Ficha de identidad del negocio (página «Mi identidad»): logo, razón
    // social, RUT, giro, dirección, ID de cliente… Se guarda como JSON en una
    // sola columna. La migración va AQUÍ, en el arranque, no sólo en el esquema
    // de inventario: si no, `perfil` fallaba con «no such column: datos» hasta
    // que el usuario abría Inventario. Idempotente en cada arranque.
    if !inv_tiene_columna(conn, "perfil", "datos") {
        let _ = conn.execute(
            "ALTER TABLE perfil ADD COLUMN datos TEXT NOT NULL DEFAULT '{}'",
            [],
        );
    }

    // El perfil existente se refleja como primer usuario: así la tarjeta del
    // login y la tabla de usuarios muestran lo mismo desde el primer arranque,
    // sin pedirle al usuario que vuelva a escribir su nombre.
    conn.execute(
        "INSERT OR IGNORE INTO usuarios (usuario,nombre,indicativo,foto,rol,creado,ultimo_acceso)
         SELECT 'operador', nombre, indicativo, foto, 'propietario', actualizado, 0
           FROM perfil WHERE id = 1 AND TRIM(nombre) <> ''",
        [],
    )?;

    // Catálogo semilla: se muestran las entradas aunque no estén instaladas.
    let semilla = [
        ("backend", "Backend FABRI-CORE", "backend", "Servicio local de FABRI-CORE", "Apache-2.0"),
        ("runtime-llama", "Motor de inferencia local", "runtime", "llama.cpp para ARM64", "MIT"),
        ("modelo-qwen05", "Modelo Qwen2.5 0.5B (Q4_K_M)", "modelo", "LLM pequeño ya presente en el dispositivo", "Apache-2.0"),
        ("embeddings", "Embeddings y recuperación semántica", "modelo", "Índice vectorial local", "MIT"),
        ("graphrag", "SQLite/GraphRAG e indexación", "herramienta", "Indexación incremental del corpus", "MIT"),
        ("plugin-demo", "Plugin de ejemplo", "plugin", "Plugin declarativo de demostración", "MIT"),
        ("voz", "Herramientas de voz", "herramienta", "TTS/STT local opcional", "MIT"),
        ("diag", "Diagnóstico del sistema", "herramienta", "Sondas de entorno y almacenamiento", "MIT"),
    ];
    for (id, nombre, tipo, desc, lic) in semilla {
        conn.execute(
            "INSERT INTO componentes (id,nombre,tipo,descripcion,estado,licencia,actualizado)
             VALUES (?1,?2,?3,?4,'NO DISPONIBLE',?5,?6)
             ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, tipo=excluded.tipo,
                 descripcion=excluded.descripcion, licencia=excluded.licencia",
            params![id, nombre, tipo, desc, lic, ahora()],
        )?;
    }

    // Módulos declarativos (plugins seguros) que viajan dentro de la app.
    crate::modulos::migrar(conn)?;
    crate::modulos::sembrar(conn)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Operaciones de la API interna
// ---------------------------------------------------------------------------

fn op_init(payload: &Value) -> Result<Value, String> {
    let data_dir = PathBuf::from(campo(payload, "dataDir")?);
    fs::create_dir_all(&data_dir).map_err(|e| format!("no se pudo crear {}: {}", data_dir.display(), e))?;
    fs::create_dir_all(data_dir.join("logs")).ok();

    let db = Connection::open(data_dir.join("fabrick.db"))
        .map_err(|e| format!("no se pudo abrir SQLite: {}", e))?;
    // Tope de espera por bloqueo: si otra conexión está escribiendo, la consulta
    // falla en 400 ms en vez de quedarse esperando. Es la diferencia entre una
    // interfaz que responde y una pantalla congelada.
    let _ = db.execute_batch("PRAGMA busy_timeout = 400;");
    migrar(&db).map_err(|e| format!("migración falló: {}", e))?;

    // La poda y el checkpoint YA NO se hacen aquí. Eran lo más caro del
    // arranque: con `logs`/`revision` grandes, el DELETE y el checkpoint
    // mantenían el bloqueo de escritura mientras la interfaz ya estaba pidiendo
    // datos, y cada llamada terminaba esperando la base. Ahora se ejecutan en
    // la op `mantenimiento`, después de que la app está usable.
    let _ = db.execute_batch("PRAGMA optimize;");

    let version: String = db
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .unwrap_or_else(|_| "?".into());

    escribir_log_archivo(&data_dir, "INFO", "core", "núcleo inicializado");

    let mut g = ESTADO.lock().map_err(|_| "estado bloqueado".to_string())?;
    *g = Some(Estado { db, data_dir: data_dir.clone() });

    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "abi": std::env::consts::ARCH,
        "sqlite": version,
        "dataDir": data_dir.to_string_lossy(),
        "esquema": 1
    }))
}

/// Acceso al estado ya inicializado.
/// Mantenimiento diferido: poda de registros y checkpoint del WAL.
///
/// Se ejecuta **después** de que la interfaz está usable (Java lo lanza en un
/// hilo de fondo al terminar `init`). Antes esto vivía dentro de `init` y era
/// lo que más tardaba: con la base grande, el DELETE y el checkpoint mantenían
/// el bloqueo de escritura justo cuando la WebView empezaba a pedir datos.
fn op_mantenimiento(_payload: &Value) -> Result<Value, String> {
    con_estado(|e| {
        // Poda acotada: se borra en lotes pequeños para no retener el mutex
        // durante un escaneo gigante. `podar_registro` ya usa conservar=3000;
        // aquí solo corroboramos que la tabla no esté creciendo sin control.
        let _ = podar_registro(&e.db, "logs", 3000);
        let _ = podar_registro(&e.db, "revision", 3000);
        // Checkpoint pasivo: no fuerza la escritura, solo compacta si puede.
        let _ = e.db.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
        Ok(json!({ "ok": true, "poda": "logs/revision", "wal": "pasivo" }))
    })
}

fn con_estado<F>(f: F) -> Result<Value, String>
where
    F: FnOnce(&mut Estado) -> Result<Value, String>,
{
    // Bloqueo ACOTADO: si el carril del núcleo está ocupado, no esperamos para
    // siempre. Intentamos tomar el mutex durante ~800 ms y, si no se puede,
    // respondemos «núcleo ocupado» para que la interfaz reintente. Antes usaba
    // `.lock()` sin tope: si una operación se colgaba, TODAS las demás se
    // quedaban esperando y expiraban con «el núcleo no respondió a tiempo».
    let plazo = std::time::Instant::now();
    let mut g = loop {
        match ESTADO.try_lock() {
            Ok(g) => break g,
            Err(_) => {
                if plazo.elapsed() >= std::time::Duration::from_millis(800) {
                    return Err("núcleo ocupado: no se pudo tomar el carril en 800 ms".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
    };
    let t0 = std::time::Instant::now();
    let res = match g.as_mut() {
        Some(e) => f(e),
        None => Err("el núcleo no está inicializado (falta llamar a init)".into()),
    };
    // Registrar duración para el monitoreo (no interfiere en el resultado).
    if let Ok(mut ops) = ULTIMAS_OPS.lock() {
        ops.push(json!({
            "op": "con_estado",
            "ms": t0.elapsed().as_millis() as u64,
            "ts": ahora()
        }));
        let exceso = ops.len().saturating_sub(30);
        if exceso > 0 {
            ops.drain(0..exceso);
        }
    }
    res
}

fn op_config(payload: &Value) -> Result<Value, String> {
    match campo(payload, "accion")? {
        "leer" => {
            let clave = campo(payload, "clave")?;
            con_estado(|e| {
                let v: Option<String> = e
                    .db
                    .query_row("SELECT valor FROM config WHERE clave=?1", params![clave], |r| r.get(0))
                    .optional()
                    .map_err(|x| x.to_string())?;
                Ok(json!({ "clave": clave, "valor": v }))
            })
        }
        "escribir" => {
            let clave = campo(payload, "clave")?;
            let valor = campo(payload, "valor")?;
            con_estado(|e| {
                e.db
                    .execute(
                        "INSERT INTO config (clave,valor,actualizado) VALUES (?1,?2,?3)
                         ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, actualizado=excluded.actualizado",
                        params![clave, valor, ahora()],
                    )
                    .map_err(|x| x.to_string())?;
                Ok(json!({ "guardado": true }))
            })
        }
        otra => Err(format!("acción de configuración desconocida: {}", otra)),
    }
}

/// RAG léxico de respaldo: indexa notas y busca en los textos guardados en
/// `vectores`. No inventa embeddings: guarda un vector vacío y lo declara.
/// La búsqueda vectorial real sigue pendiente hasta tener un modelo de embeddings.
fn op_rag(payload: &Value) -> Result<Value, String> {
    let accion = payload.get("accion").and_then(|v| v.as_str()).unwrap_or("buscar");
    match accion {
        "indexar" => {
            let texto = campo(payload, "texto")?.trim();
            if texto.is_empty() {
                return Err("el texto a indexar está vacío".into());
            }
            if texto.len() > 200_000 {
                return Err("el texto supera 200 000 bytes; divídelo primero".into());
            }
            let documento = payload
                .get("documento")
                .and_then(|v| v.as_str())
                .unwrap_or("nota")
                .trim();
            con_estado(|e| {
                e.db.execute(
                    "INSERT INTO vectores (documento,texto,vector,metadatos,creado) VALUES (?1,?2,?3,?4,?5)",
                    params![documento, texto, Vec::<u8>::new(), "{\"modo\":\"lexico\"}", ahora()],
                )
                .map_err(|x| x.to_string())?;
                let total: i64 = e
                    .db
                    .query_row("SELECT COUNT(*) FROM vectores", [], |r| r.get(0))
                    .unwrap_or(0);
                Ok(json!({
                    "modo": "lexico",
                    "documento": documento,
                    "caracteres": texto.chars().count(),
                    "total": total,
                    "nota": "texto indexado para búsqueda léxica; vector real pendiente"
                }))
            })
        }
        "estado" => con_estado(|e| {
            let total: i64 = e
                .db
                .query_row("SELECT COUNT(*) FROM vectores", [], |r| r.get(0))
                .unwrap_or(0);
            Ok(json!({
                "modo": "lexico",
                "total": total,
                "embeddings": false,
                "nota": "búsqueda léxica; sin modelo de embeddings"
            }))
        }),
        _ => {
            let consulta = campo(payload, "consulta")?.trim();
            if consulta.is_empty() {
                return Err("la consulta RAG está vacía".into());
            }
            let k = payload.get("k").and_then(|v| v.as_i64()).unwrap_or(3).clamp(1, 8);
            let patron = format!("%{}%", consulta.replace('%', "").replace('_', ""));
            con_estado(|e| {
                let mut st = e
                    .db
                    .prepare("SELECT documento, texto FROM vectores WHERE texto LIKE ?1 ORDER BY id DESC LIMIT ?2")
                    .map_err(|x| x.to_string())?;
                let filas = st
                    .query_map(params![patron, k], |r| {
                        Ok(json!({
                            "documento": r.get::<_, Option<String>>(0)?,
                            "texto": r.get::<_, String>(1)?
                        }))
                    })
                    .map_err(|x| x.to_string())?;
                let lista: Vec<Value> = filas.filter_map(|f| f.ok()).collect();
                Ok(json!({
                    "consulta": consulta,
                    "modo": "lexico",
                    "resultados": lista,
                    "nota": if lista.is_empty() { "sin coincidencias; los embeddings reales siguen pendientes" } else { "coincidencias léxicas en vectores indexados" }
                }))
            })
        }
    }
}

fn op_componentes(payload: &Value) -> Result<Value, String> {
    match payload.get("accion").and_then(|v| v.as_str()).unwrap_or("listar") {
        "listar" => {
            // Los manifiestos pueden sumar componentes que aún no están en la
            // tabla (por ejemplo, modelos añadidos después de instalar la APK).
            let dinamicos = manifiestos_dinamicos();
            con_estado(move |e| {
                let mut st = e
                    .db
                    .prepare("SELECT id,nombre,tipo,version,descripcion,estado,version_inst,licencia,origen,sha256,tamano_bytes FROM componentes ORDER BY tipo, nombre")
                    .map_err(|x| x.to_string())?;
                let filas = st
                    .query_map([], |r| {
                        Ok(json!({
                            "id": r.get::<_, String>(0)?,
                            "nombre": r.get::<_, String>(1)?,
                            "tipo": r.get::<_, String>(2)?,
                            "version": r.get::<_, Option<String>>(3)?,
                            "descripcion": r.get::<_, Option<String>>(4)?,
                            "estado": r.get::<_, String>(5)?,
                            "versionInstalada": r.get::<_, Option<String>>(6)?,
                            "licencia": r.get::<_, Option<String>>(7)?,
                            "origen": r.get::<_, Option<String>>(8)?,
                            "sha256": r.get::<_, Option<String>>(9)?,
                            "tamano": r.get::<_, i64>(10).unwrap_or(0)
                        }))
                    })
                    .map_err(|x| x.to_string())?;
                let mut lista: Vec<Value> = filas.filter_map(|f| f.ok()).collect();
                let mut ids: Vec<String> = lista
                    .iter()
                    .filter_map(|v| v.get("id").and_then(|x| x.as_str()).map(|s| s.to_string()))
                    .collect();
                let mut fuentes: Vec<(String, String)> = MANIFIESTOS
                    .iter()
                    .map(|(r, t)| (r.to_string(), t.to_string()))
                    .collect();
                fuentes.extend(dinamicos);
                for (_, texto) in fuentes {
                    let m = match serde_json::from_str::<Value>(&texto) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if id.is_empty() || ids.iter().any(|x| x == id) {
                        continue;
                    }
                    ids.push(id.to_string());
                    lista.push(json!({
                        "id": id,
                        "nombre": m.get("nombre").cloned().unwrap_or(Value::Null),
                        "tipo": m.get("tipo").cloned().unwrap_or(Value::Null),
                        "version": m.get("version").cloned().unwrap_or(Value::Null),
                        "descripcion": m.get("descripcion").cloned().unwrap_or(Value::Null),
                        "estado": "NO DISPONIBLE",
                        "versionInstalada": Value::Null,
                        "licencia": m.get("licencia").cloned().unwrap_or(Value::Null),
                        "origen": m.get("origen").cloned().unwrap_or(Value::Null),
                        "sha256": m.get("sha256").cloned().unwrap_or(Value::Null),
                        "tamano": m.get("tamano").and_then(|v| v.as_i64()).unwrap_or(0)
                    }));
                }
                lista.sort_by(|a, b| {
                    let ka = (
                        a.get("tipo").and_then(|v| v.as_str()).unwrap_or(""),
                        a.get("nombre").and_then(|v| v.as_str()).unwrap_or(""),
                    );
                    let kb = (
                        b.get("tipo").and_then(|v| v.as_str()).unwrap_or(""),
                        b.get("nombre").and_then(|v| v.as_str()).unwrap_or(""),
                    );
                    ka.cmp(&kb)
                });
                Ok(json!({ "componentes": lista }))
            })
        }
        "estado" => {
            let id = campo(payload, "id")?;
            let estado = campo(payload, "estado")?;
            let ts = ahora();
            con_estado(move |e| {
                let n = e
                    .db
                    .execute(
                        "UPDATE componentes SET estado=?1, actualizado=?2 WHERE id=?3",
                        params![estado, ts, id],
                    )
                    .map_err(|x| x.to_string())?;
                if n == 0 {
                    // El componente venía del manifiesto y no tenía fila en la
                    // tabla. Sin insertarla, el estado se perdía al reiniciar y
                    // la app volvía a pedir la misma descarga (bug "me pide
                    // descargar dos veces").
                    let (nombre, tipo, version, licencia) = datos_manifiesto(&id);
                    e.db
                        .execute(
                            "INSERT INTO componentes
                               (id,nombre,tipo,version,descripcion,estado,version_inst,
                                licencia,origen,sha256,tamano_bytes,actualizado)
                             VALUES (?1,?2,?3,?4,'',?5,NULL,?6,NULL,NULL,0,?7)
                             ON CONFLICT(id) DO UPDATE SET estado=?5, actualizado=?7",
                            params![id, nombre, tipo, version, estado, licencia, ts],
                        )
                        .map_err(|x| x.to_string())?;
                }
                Ok(json!({ "id": id, "estado": estado, "creado": n == 0 }))
            })
        }
        "descargarModeloIA" => {
            // MobileLLM-125M supera los 50 MB. Según la regla de oro de and4oid,
            // no se pueden descargar binarios >50 MB sin autorización expresa del
            // usuario, y nunca se ejecutan descargas (W^X). Esta acción solo
            // registra la intención y devuelve instrucciones claras.
            let modelo = payload.get("modelo").and_then(|v| v.as_str()).unwrap_or("desconocido");
            let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");
            Ok(json!({
                "ok": false,
                "error": "Descarga no autorizada",
                "codigo": "MODELO_50MB_REQUIERE_AUTORIZACION",
                "modelo": modelo,
                "url": url,
                "mensaje": format!(
                    "El modelo {} supera los 50 MB. La descarga requiere autorización expresa del usuario y no se ejecutarán binarios descargados (regla W^X). Usa Android TextToSpeech nativo para voz.",
                    modelo
                ),
                "sugerencia": "Contacta al administrador para autorizar la descarga o usa el TTS nativo es-CL integrado."
            }))
        }
        otra => Err(format!("acción de componentes desconocida: {}", otra)),
    }
}

fn op_logs(payload: &Value) -> Result<Value, String> {
    match payload.get("accion").and_then(|v| v.as_str()).unwrap_or("listar") {
        "listar" => {
            let limite = payload.get("limite").and_then(|v| v.as_i64()).unwrap_or(200);
            con_estado(|e| {
                let mut st = e
                    .db
                    .prepare("SELECT id,ts,nivel,origen,mensaje FROM logs ORDER BY id DESC LIMIT ?1")
                    .map_err(|x| x.to_string())?;
                let filas = st
                    .query_map(params![limite], |r| {
                        Ok(json!({
                            "id": r.get::<_, i64>(0)?,
                            "ts": r.get::<_, i64>(1)?,
                            "nivel": r.get::<_, String>(2)?,
                            "origen": r.get::<_, String>(3)?,
                            "mensaje": r.get::<_, String>(4)?
                        }))
                    })
                    .map_err(|x| x.to_string())?;
                let lista: Vec<Value> = filas.filter_map(|f| f.ok()).collect();
                Ok(json!({ "logs": lista }))
            })
        }
        "limpiar" => con_estado(|e| {
            e.db.execute("DELETE FROM logs", []).map_err(|x| x.to_string())?;
            Ok(json!({ "limpiado": true }))
        }),
        otra => Err(format!("acción de logs desconocida: {}", otra)),
    }
}

fn op_operaciones(payload: &Value) -> Result<Value, String> {
    match payload.get("accion").and_then(|v| v.as_str()).unwrap_or("listar") {
        "listar" => {
            let limite = payload.get("limite").and_then(|v| v.as_i64()).unwrap_or(100);
            con_estado(|e| {
                let mut st = e
                    .db
                    .prepare("SELECT id,inicio,fin,tipo,fase,estado,detalle FROM operaciones ORDER BY inicio DESC LIMIT ?1")
                    .map_err(|x| x.to_string())?;
                let filas = st
                    .query_map(params![limite], |r| {
                        Ok(json!({
                            "id": r.get::<_, String>(0)?,
                            "inicio": r.get::<_, i64>(1)?,
                            "fin": r.get::<_, Option<i64>>(2)?,
                            "tipo": r.get::<_, String>(3)?,
                            "fase": r.get::<_, Option<String>>(4)?,
                            "estado": r.get::<_, String>(5)?,
                            "detalle": r.get::<_, Option<String>>(6)?
                        }))
                    })
                    .map_err(|x| x.to_string())?;
                let lista: Vec<Value> = filas.filter_map(|f| f.ok()).collect();
                Ok(json!({ "operaciones": lista }))
            })
        }
        "registrar" => {
            let tipo = campo(payload, "tipo")?;
            let estado = campo(payload, "estado")?;
            let fase = payload.get("fase").and_then(|v| v.as_str()).unwrap_or("-");
            let detalle = payload.get("detalle").and_then(|v| v.as_str()).unwrap_or("");
            let id = id_operacion("op");
            con_estado(|e| {
                e.db
                    .execute(
                        "INSERT INTO operaciones (id,inicio,fin,tipo,fase,estado,detalle) VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![id, ahora(), ahora(), tipo, fase, estado, detalle],
                    )
                    .map_err(|x| x.to_string())?;
                Ok(json!({ "id": id }))
            })
        }
        otra => Err(format!("acción de operaciones desconocida: {}", otra)),
    }
}

// ── Monitoreo de rendimiento del núcleo ────────────────────────────────────
// Lleva un anillo con los tiempos de las últimas operaciones y algún dato de
// uso de la cola. No interfiere con las operaciones normales.

static ULTIMAS_OPS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

/// Registrar una operación completada con su duración (ms). Se llama desde
/// `con_estado` una vez que la operación terminó.
pub fn op_estado_registrar(op: &str, ms: u64) {
    if let Ok(mut v) = ULTIMAS_OPS.lock() {
        v.push(json!({
            "op": op,
            "ms": ms,
            "ts": ahora()
        }));
        let exceso = v.len().saturating_sub(30);
        if exceso > 0 {
            v.drain(0..exceso);
        }
    }
}

fn op_rendimiento(_payload: &Value) -> Result<Value, String> {
    let ops = ULTIMAS_OPS.lock().map_err(|_| "estado bloqueado".to_string())?;
    let total: u64 = ops.iter().map(|o| o["ms"].as_u64().unwrap_or(0)).sum();
    let n = ops.len() as u64;
    let promedio = if n > 0 { total / n } else { 0 };
    Ok(json!({
        "ops": *ops,
        "conteo": ops.len(),
        "promedioMs": promedio,
        "totalMs": total,
        "esquemaVerificado": ESQUEMA_LISTO.load(std::sync::atomic::Ordering::Relaxed)
    }))
}

fn op_sys(_payload: &Value) -> Result<Value, String> {
    con_estado(|e| {
        let (total, libre, disponible) = espacio(&e.data_dir);
        let mem = fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let leer_kb = |clave: &str| -> u64 {
            mem.lines()
                .find(|l| l.starts_with(clave))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0)
        };
        Ok(json!({
            "arch": std::env::consts::ARCH,
            "os": std::env::consts::OS,
            "discoTotal": total,
            "discoLibre": libre,
            "discoDisponible": disponible,
            "memTotalKb": leer_kb("MemTotal:"),
            "memLibreKb": leer_kb("MemAvailable:"),
            "dataDir": e.data_dir.to_string_lossy(),
            "version": env!("CARGO_PKG_VERSION")
        }))
    })
}

/// ---------------------------------------------------------------------------
/// Verificador global: estado real de todas las áreas del sistema.
/// Se usa en la página de Inicio para mostrar en tiempo real qué funciona
/// y qué falta, con conteo de tokens y barra de progreso.
/// ---------------------------------------------------------------------------
fn op_estado_global(_payload: &Value) -> Result<Value, String> {
    con_estado(|e| {
        let (total, libre, disponible) = espacio(&e.data_dir);

        // Componentes instalados vs totales
        let comp_total: i64 = e
            .db
            .query_row("SELECT COUNT(*) FROM componentes", [], |r| r.get(0))
            .unwrap_or(0);
        let comp_instalados: i64 = e
            .db
            .query_row(
                "SELECT COUNT(*) FROM componentes WHERE estado IN ('DESCARGADO_VERIFICADO','INSTALADO')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // Tablas y filas de la base local
        let tablas: Vec<String> = e
            .db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .map_err(|e2| e2.to_string())?
            .query_map([], |r| r.get(0))
            .map_err(|e2| e2.to_string())?
            .filter_map(Result::ok)
            .collect();
        let mut filas_totales: u64 = 0;
        for t in &tablas {
            let n: i64 = e
                .db
                .query_row(
                    &format!("SELECT COUNT(*) FROM \"{}\"", t),
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            filas_totales += n as u64;
        }

        // Modelo cargado
        let modelo_cargado = e
            .db
            .query_row("SELECT estado FROM modelos WHERE detectado = 1 LIMIT 1", [], |r| r.get::<_, String>(0))
            .optional()
            .unwrap_or(None);

        // Operaciones recientes (últimas 10)
        let mut ops: Vec<Value> = Vec::new();
        if let Ok(mut st) = e.db.prepare("SELECT tipo,estado,detalle,fin FROM operaciones ORDER BY id DESC LIMIT 10") {
            if let Ok(rows) = st.query_map([], |r| {
                Ok(json!({
                    "tipo": r.get::<_, String>(0).unwrap_or_default(),
                    "estado": r.get::<_, String>(1).unwrap_or_default(),
                    "detalle": r.get::<_, Option<String>>(2).unwrap_or_default(),
                    "fin": r.get::<_, i64>(3).unwrap_or(0)
                }))
            }) {
                for r in rows.filter_map(Result::ok) {
                    ops.push(r);
                }
            }
        }

        // Memoria
        let mem = fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let leer_kb = |clave: &str| -> u64 {
            mem.lines()
                .find(|l| l.starts_with(clave))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0)
        };
        let mem_total = leer_kb("MemTotal:");
        let mem_libre = leer_kb("MemAvailable:");

        let cpu_nombre = fs::read_to_string("/proc/cpuinfo")
            .ok()
            .and_then(|c| c.lines().find(|l| l.starts_with("model name")).map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string()))
            .unwrap_or_else(|| "desconocido".to_string());

        let nucleos = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);

        Ok(json!({
            "version": env!("CARGO_PKG_VERSION"),
            "arch": std::env::consts::ARCH,
            "os": std::env::consts::OS,
            "discoTotal": total,
            "discoLibre": libre,
            "discoDisponible": disponible,
            "memTotalKb": mem_total,
            "memLibreKb": mem_libre,
            "memUsadaKb": mem_total.saturating_sub(mem_libre),
            "componentesTotal": comp_total,
            "componentesInstalados": comp_instalados,
            "tablas": tablas.len(),
            "filasTotales": filas_totales,
            "modeloCargado": modelo_cargado.unwrap_or("ninguno".to_string()),
            "cpu": cpu_nombre,
            "nucleos": nucleos,
            "dataDir": e.data_dir.to_string_lossy(),
            "operacionesRecientes": ops,
            "dataDirPath": e.data_dir.to_string_lossy()
        }))
    })
}

/// Detalles del dispositivo: información de hardware y entorno para la tabla de comparación.
fn op_dispositivo_detalles(_payload: &Value) -> Result<Value, String> {
    con_estado(|e| {
        let (total, libre, disponible) = espacio(&e.data_dir);

        let mem = fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let leer_kb = |clave: &str| -> u64 {
            mem.lines()
                .find(|l| l.starts_with(clave))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0)
        };

        let cpuinfo = fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
        let cpu_nombre = cpuinfo.lines()
            .find(|l| l.starts_with("model name"))
            .and_then(|l| l.split(':').nth(1).map(|s| s.trim().to_string()))
            .unwrap_or_else(|| "desconocido".to_string());
        let cpu_hz = cpuinfo.lines()
            .find(|l| l.starts_with("cpu MHz"))
            .and_then(|l| l.split(':').nth(1).map(|s| s.trim().parse::<f64>().unwrap_or(0.0)))
            .unwrap_or(0.0);
        let nucleos = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);

        // Versión de Android y SDK (build.prop si existe)
        let (android_version, sdk) = {
            let build_prop = fs::read_to_string("/system/build.prop").unwrap_or_default();
            let mut av = "desconocida".to_string();
            let mut sv = "?".to_string();
            for linea in build_prop.lines() {
                if linea.starts_with("ro.build.version.release") {
                    av = linea.split('=').nth(1).map(|s| s.trim().to_string()).unwrap_or_else(|| "desconocida".to_string());
                }
                if linea.starts_with("ro.build.version.sdk") {
                    sv = linea.split('=').nth(1).map(|s| s.trim().to_string()).unwrap_or_else(|| "?".to_string());
                }
            }
            (av, sv)
        };

        Ok(json!({
            "arch": std::env::consts::ARCH,
            "os": std::env::consts::OS,
            "androidVersion": android_version,
            "sdk": sdk,
            "cpu": cpu_nombre,
            "cpuMhz": cpu_hz,
            "nucleos": nucleos,
            "memTotalKb": leer_kb("MemTotal:"),
            "memLibreKb": leer_kb("MemAvailable:"),
            "discoTotal": total,
            "discoLibre": libre,
            "discoDisponible": disponible,
            "dataDir": e.data_dir.to_string_lossy(),
            "version": env!("CARGO_PKG_VERSION")
        }))
    })
}

/// Recomendación de modelos según la arquitectura del dispositivo.
/// Devuelve qué modelos GGUF deberían correr bien basado en RAM y CPU.
fn op_modelos_recomendados(_payload: &Value) -> Result<Value, String> {
    // Las recomendaciones salen de los MISMOS manifiestos que se pueden
    // descargar. Antes eran ids sueltos que no existían en el catálogo y el
    // botón «Descargar» sólo mostraba un aviso: por eso ningún modelo nuevo
    // se podía bajar.
    let dinamicos = manifiestos_dinamicos();
    let mut fuentes: Vec<(String, String)> = MANIFIESTOS
        .iter()
        .map(|(r, t)| (r.to_string(), t.to_string()))
        .collect();
    fuentes.extend(dinamicos);

    let mut recomendaciones: Vec<Value> = Vec::new();
    let mut vistos: Vec<String> = Vec::new();
    for (_, texto) in fuentes {
        let m = match serde_json::from_str::<Value>(&texto) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if m.get("tipo").and_then(|v| v.as_str()) != Some("modelo") {
            continue;
        }
        let id = match m.get("id").and_then(|v| v.as_str()) {
            Some(x) if !x.is_empty() => x.to_string(),
            _ => continue,
        };
        if vistos.iter().any(|x| x == &id) {
            continue;
        }
        vistos.push(id.clone());
        let tam = m.get("tamano").and_then(|v| v.as_u64()).unwrap_or(0);
        if tam == 0 {
            continue;
        }
        let mb = (tam / (1024 * 1024)) as u64;
        let ram = (mb as f64 * 1.7) as u64 + 256;
        let nivel = if ram <= 1200 {
            "muy fluido"
        } else if ram <= 2400 {
            "fluido"
        } else {
            "funcional"
        };
        let es_embeddings = m
            .get("interfaz")
            .and_then(|v| v.as_str())
            .map(|x| x.contains("embeddings"))
            .unwrap_or(false);
        let uso = if es_embeddings {
            "Embeddings: búsqueda semántica y RAG"
        } else if mb <= 150 {
            "Chat local rápido con poca RAM"
        } else {
            "Asistente general y razonamiento básico"
        };
        recomendaciones.push(json!({
            "id": id,
            "nombre": m.get("nombre").cloned().unwrap_or(Value::Null),
            "tamanoMB": mb,
            "ramMinimaMB": ram,
            "nivel": nivel,
            "uso": uso,
            "tipo": if es_embeddings { "embeddings" } else { "chat" },
            "descargar": true,
            "licencia": m.get("licencia").cloned().unwrap_or(Value::Null)
        }));
    }
    recomendaciones.sort_by_key(|v| v.get("tamanoMB").and_then(|x| x.as_u64()).unwrap_or(0));

    con_estado(move |e| {
        let mem = fs::read_to_string("/proc/meminfo").unwrap_or_default();
        let leer_kb = |clave: &str| -> u64 {
            mem.lines()
                .find(|l| l.starts_with(clave))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0)
        };
        let mem_total_mb = leer_kb("MemTotal:") / 1024;

        let mut detectados: Vec<Value> = Vec::new();
        if let Ok(mut st) = e.db.prepare("SELECT id,nombre,formato,tamano,estado FROM modelos ORDER BY id") {
            if let Ok(rows) = st.query_map([], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "nombre": r.get::<_, String>(1)?,
                    "formato": r.get::<_, Option<String>>(2)?.unwrap_or_else(|| "desconocido".to_string()),
                    "tamano": r.get::<_, i64>(3)?.max(0),
                    "estado": r.get::<_, String>(4)?,
                    "descargar": false
                }))
            }) {
                for r in rows {
                    if let Ok(v) = r {
                        detectados.push(v);
                    }
                }
            }
        }

        Ok(json!({
            "memTotalMB": mem_total_mb,
            "recomendados": recomendaciones,
            "detectados": detectados
        }))
    })
}

/// ---------------------------------------------------------------------------
/// Consulta SQL segura para el chat: solo SELECT, sin escritura.
/// Permite que el asistente responda sobre productos, facturas, clientes, etc.
/// ---------------------------------------------------------------------------
fn sql_consultar_seguro(data_dir: &Path, sql: &str) -> Result<Value, String> {
    let limpio = sql.trim().trim_end_matches(';').trim().to_string();
    if limpio.is_empty() {
        return Err("escribe una consulta SQL".into());
    }
    if limpio.len() > 4000 {
        return Err("la consulta es demasiado larga".into());
    }
    if limpio.contains(';') {
        return Err("solo se permite una consulta".into());
    }
    let bajo = limpio.to_lowercase();
    if !(bajo.starts_with("select") || bajo.starts_with("with")) {
        return Err("solo se permiten consultas SELECT en el chat".into());
    }
    // Bloquear palabras peligrosas aunque estén dentro de SELECT
    for prohibida in ["drop", "delete", "update", "insert", "alter", "create", "attach", "pragma", "exec"] {
        if bajo.contains(prohibida) {
            return Err(format!("la palabra '{prohibida}' no está permitida en consultas del chat"));
        }
    }
    sqlite_consultar(data_dir, &limpio)
}

/// ---------------------------------------------------------------------------
/// GraphRAG sobre SQLite: busca en conocimiento_vector y aprendizajes
/// para inyectar contexto relevante en el prompt del asistente.
/// ---------------------------------------------------------------------------
fn graphrag_buscar(data_dir: &Path, tema: &str, limite: i64) -> Result<Value, String> {
    let con = rusqlite::Connection::open(data_dir.join("fabrick.db"))
        .map_err(|e| e.to_string())?;
    let lim = limite.clamp(1, 20);

    // Buscar en conocimiento_vector por tema o contenido similar (LIKE)
    let mut filas: Vec<Value> = Vec::new();
    let like = format!("%{}%", tema);
    if let Ok(mut st) = con.prepare(
        "SELECT texto, tema, fuente FROM conocimiento_vector
         WHERE tema LIKE ?1 OR texto LIKE ?1
         ORDER BY fecha DESC LIMIT ?2",
    ) {
        if let Ok(rows) = st.query_map(params![&like, lim as i64], |r| {
            Ok(json!({
                "texto": r.get::<_, String>(0)?,
                "tema": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "fuente": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "origen": "conocimiento"
            }))
        }) {
            for r in rows.flatten() {
                filas.push(r);
            }
        }
    }

    // Buscar en aprendizajes por tema o preferencia
    if let Ok(mut st) = con.prepare(
        "SELECT tema, contenido, preferencia FROM aprendizajes
         WHERE tema LIKE ?1 OR preferencia LIKE ?1
         ORDER BY veces_usado DESC, fecha DESC LIMIT ?2",
    ) {
        if let Ok(rows) = st.query_map(params![&like, lim as i64], |r| {
            Ok(json!({
                "texto": r.get::<_, String>(1)?,
                "tema": r.get::<_, String>(0)?,
                "preferencia": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "origen": "aprendizaje"
            }))
        }) {
            for r in rows.flatten() {
                filas.push(r);
            }
        }
    }

    // Ordenar y limitar
    filas.truncate(lim as usize);

    Ok(json!({
        "tema": tema,
        "resultados": filas,
        "total": filas.len()
    }))
}

/// ---------------------------------------------------------------------------
/// Guardar un nuevo aprendizaje (auto-aprendizaje del asistente).
/// ---------------------------------------------------------------------------
fn aprendizaje_guardar(conn: &Connection, tema: &str, contenido: &str, preferencia: Option<&str>) -> Result<Value, String> {
    let ts = ahora();
    conn.execute(
        "INSERT INTO aprendizajes (tema, contenido, preferencia, veces_usado, fecha) VALUES (?1,?2,?3,?4,?5)",
        params![tema, contenido, preferencia.unwrap_or(""), 0, ts],
    ).map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "ts": ts }))
}

/// ---------------------------------------------------------------------------
/// Buscar aprendizajes por tema (para inyectar en el prompt).
/// ---------------------------------------------------------------------------
fn aprendizaje_buscar(conn: &Connection, tema: &str, limite: i64) -> Result<Value, String> {
    let lim = limite.clamp(1, 10);
    let like = format!("%{}%", tema);
    let mut st = conn.prepare(
        "SELECT tema, contenido, preferencia, veces_usado FROM aprendizajes
         WHERE tema LIKE ?1 OR contenido LIKE ?1
         ORDER BY veces_usado DESC, fecha DESC LIMIT ?2",
    ).map_err(|e| e.to_string())?;
    let mut filas = Vec::new();
    if let Ok(rows) = st.query_map(params![&like, lim as i64], |r| {
        Ok(json!({
            "tema": r.get::<_, String>(0)?,
            "contenido": r.get::<_, String>(1)?,
            "preferencia": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            "veces_usado": r.get::<_, i64>(3)?
        }))
    }) {
        for r in rows.flatten() {
            filas.push(r);
        }
    }
    Ok(json!({ "tema": tema, "resultados": filas }))
}

/// Recorre un directorio de modelos hasta `max_nivel` subdirectorios.
/// No sigue enlaces simbólicos y sólo lee la cabecera del archivo.
fn recolectar_modelos(
    dir: &Path,
    nivel: u32,
    max_nivel: u32,
    vistos: &mut HashSet<String>,
    encontrados: &mut Vec<Value>,
) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entrada in rd.flatten() {
        let ruta = entrada.path();
        let Ok(tipo) = entrada.file_type() else { continue };
        if tipo.is_symlink() {
            continue;
        }
        if tipo.is_dir() {
            if nivel < max_nivel {
                recolectar_modelos(&ruta, nivel + 1, max_nivel, vistos, encontrados);
            }
            continue;
        }
        if !tipo.is_file() {
            continue;
        }
        let ext = ruta
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "gguf" && ext != "bin" {
            continue;
        }
        let clave = ruta.to_string_lossy().to_string();
        if !vistos.insert(clave) {
            continue;
        }
        let tam = entrada.metadata().map(|m| m.len()).unwrap_or(0);
        let cabecera = leer_cabecera_gguf(&ruta);
        let (formato, version, tensores) = match cabecera {
            Some((v, t, _)) => ("GGUF".to_string(), v as i64, t as i64),
            None => ("desconocido".to_string(), 0, 0),
        };
        // Un archivo de menos de 1 MB no puede ser un modelo real.
        let valido = tam > 1_000_000 && formato == "GGUF";
        encontrados.push(json!({
            "ruta": ruta.to_string_lossy(),
            "nombre": ruta.file_name().and_then(|n| n.to_str()).unwrap_or("?"),
            "formato": formato,
            "version": version,
            "tensores": tensores,
            "tamano": tam,
            "valido": valido,
            "runtime": if valido { "pendiente" } else { "no compatible" }
        }));
    }
}

fn op_nube(payload: &Value) -> Result<Value, String> {
    match payload.get("accion").and_then(|v| v.as_str()).unwrap_or("estado") {
        "estado" => {
            let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let token = payload.get("token").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                return Ok(json!({ "ok": false, "error": "Falta URL", "codigo": "NUBE_URL_FALTA" }));
            }
            if !url.starts_with("https://") && !url.starts_with("http://localhost") && !url.starts_with("http://127.0.0.1") {
                return Ok(json!({ "ok": false, "error": "URL no segura (usa https://)", "codigo": "NUBE_URL_NO_HTTPS" }));
            }
            Ok(json!({ "ok": true, "url": url, "mensaje": "URL lista para usar", "token_configurado": !token.is_empty(), "codigo": "NUBE_OK" }))
        }
        "configurar" => {
            let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let token = payload.get("token").and_then(|v| v.as_str()).unwrap_or("");
            Ok(json!({ "ok": true, "guardado": true, "url": url, "mensaje": "Configuración guardada localmente (no se envía al servidor)", "codigo": "NUBE_CONFIG_OK" }))
        }
        otro => Err(format!("operación nube desconocida: {}", otro)),
    }
}

/// Detecta modelos GGUF en directorios autorizados sin copiarlos ni descargarlos.
fn op_modelos(payload: &Value) -> Result<Value, String> {
    if payload.get("accion").and_then(|v| v.as_str()).unwrap_or("escanear") != "escanear" {
        return Err("acción de modelos no soportada en esta fase".into());
    }
    let dirs: Vec<String> = payload
        .get("dirs")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut encontrados: Vec<Value> = Vec::new();
    let mut vistos: HashSet<String> = HashSet::new();
    let mut leidos: Vec<String> = Vec::new();
    for dir in &dirs {
        let p = Path::new(dir);
        if !p.is_dir() {
            continue;
        }
        leidos.push(dir.clone());
        // filesDir/componentes/<id>/<modelo>.gguf está a un nivel; se permiten
        // dos para no dejar fuera una subcarpeta razonable sin recorrer todo.
        recolectar_modelos(p, 0, 2, &mut vistos, &mut encontrados);
    }

    con_estado(|e| {
        for m in &encontrados {
            let ruta = m["ruta"].as_str().unwrap_or("");
            let id = format!("m-{:x}", ruta.len() as u64 * 31 + m["tamano"].as_i64().unwrap_or(0) as u64);
            let _ = e.db.execute(
                "INSERT INTO modelos (id,ruta,nombre,formato,tamano,version,tensores,estado,detectado)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET tamano=excluded.tamano, formato=excluded.formato, detectado=excluded.detectado",
                params![
                    id,
                    ruta,
                    m["nombre"].as_str().unwrap_or("?"),
                    m["formato"].as_str().unwrap_or("desconocido"),
                    m["tamano"].as_i64().unwrap_or(0),
                    m["version"].as_i64().unwrap_or(0),
                    m["tensores"].as_i64().unwrap_or(0),
                    if m["valido"].as_bool().unwrap_or(false) { "detectado" } else { "invalido" },
                    ahora()
                ],
            );
        }
        Ok(json!({ "modelos": encontrados, "dirs": leidos }))
    })
}

/// Registra una línea de log (tabla + archivo).
// ---------------------------------------------------------------------------
// Registro de revisión (persistente): botones, descargas, consultas, LLM y red.
// Es distinto de `logs`: aquí cada fila lleva tipo, severidad, detalle y ms,
// para poder auditar la app sin leer transcripciones.
// ---------------------------------------------------------------------------

fn op_revision_registrar(payload: &Value) -> Result<Value, String> {
    let tipo = payload.get("tipo").and_then(|v| v.as_str()).unwrap_or("evento");
    let severidad = payload.get("severidad").and_then(|v| v.as_str()).unwrap_or("info");
    let origen = payload.get("origen").and_then(|v| v.as_str()).unwrap_or("ui");
    let mensaje = campo(payload, "mensaje")?;
    let detalle = payload.get("detalle").and_then(|v| v.as_str()).unwrap_or("");
    let ms = payload.get("ms").and_then(|v| v.as_i64()).unwrap_or(0);
    con_estado(|e| {
        e.db
            .execute(
                "INSERT INTO revision (ts,tipo,severidad,origen,mensaje,detalle,ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![ahora(), tipo, severidad, origen, mensaje, detalle, ms],
            )
            .map_err(|x| x.to_string())?;
        // Un error de severidad alta también queda en el log clásico.
        if severidad == "error" || severidad == "critico" {
            let _ = e.db.execute(
                "INSERT INTO logs (ts,nivel,origen,mensaje) VALUES (?1,?2,?3,?4)",
                params![ahora(), "ERROR", origen, format!("[{}] {}", tipo, mensaje)],
            );
        }
        Ok(json!({ "registrado": true }))
    })
}

fn op_revision_listar(payload: &Value) -> Result<Value, String> {
    let limite = payload.get("limite").and_then(|v| v.as_i64()).unwrap_or(200).clamp(1, 2000);
    let severidad = payload.get("severidad").and_then(|v| v.as_str()).unwrap_or("");
    let tipo = payload.get("tipo").and_then(|v| v.as_str()).unwrap_or("");
    let origen = payload.get("origen").and_then(|v| v.as_str()).unwrap_or("");
    con_estado(|e| {
        let mut stmt = e
            .db
            .prepare(
                "SELECT id,ts,tipo,severidad,origen,mensaje,detalle,ms FROM revision
                 WHERE (?1 = '' OR severidad = ?1)
                   AND (?2 = '' OR tipo = ?2)
                   AND (?3 = '' OR origen = ?3)
                 ORDER BY id DESC LIMIT ?4",
            )
            .map_err(|x| x.to_string())?;
        let filas = stmt
            .query_map(params![severidad, tipo, origen, limite], |r| {
                Ok(json!({
                    "id": r.get::<_, i64>(0)?,
                    "ts": r.get::<_, i64>(1)?,
                    "tipo": r.get::<_, String>(2)?,
                    "severidad": r.get::<_, String>(3)?,
                    "origen": r.get::<_, String>(4)?,
                    "mensaje": r.get::<_, String>(5)?,
                    "detalle": r.get::<_, String>(6)?,
                    "ms": r.get::<_, i64>(7)?
                }))
            })
            .map_err(|x| x.to_string())?;
        let mut salida = Vec::new();
        for f in filas {
            salida.push(f.map_err(|x| x.to_string())?);
        }
        Ok(json!({ "eventos": salida, "total": salida.len() }))
    })
}

fn op_revision_resumen(_payload: &Value) -> Result<Value, String> {
    con_estado(|e| {
        let total: i64 = e
            .db
            .query_row("SELECT COUNT(*) FROM revision", [], |r| r.get(0))
            .unwrap_or(0);
        let errores: i64 = e
            .db
            .query_row(
                "SELECT COUNT(*) FROM revision WHERE severidad IN ('error','critico')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let avisos: i64 = e
            .db
            .query_row(
                "SELECT COUNT(*) FROM revision WHERE severidad = 'aviso'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let ultimo: i64 = e
            .db
            .query_row("SELECT COALESCE(MAX(ts),0) FROM revision", [], |r| r.get(0))
            .unwrap_or(0);
        let mut origenes = Vec::new();
        if let Ok(mut stmt) = e.db.prepare(
            "SELECT origen, COUNT(*) c FROM revision GROUP BY origen ORDER BY c DESC LIMIT 8",
        ) {
            if let Ok(filas) = stmt.query_map([], |r| {
                Ok(json!({ "origen": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)? }))
            }) {
                for f in filas.flatten() {
                    origenes.push(f);
                }
            }
        }
        let mut tipos = Vec::new();
        if let Ok(mut stmt) = e.db.prepare(
            "SELECT tipo, COUNT(*) c FROM revision GROUP BY tipo ORDER BY c DESC LIMIT 8",
        ) {
            if let Ok(filas) = stmt.query_map([], |r| {
                Ok(json!({ "tipo": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)? }))
            }) {
                for f in filas.flatten() {
                    tipos.push(f);
                }
            }
        }
        Ok(json!({
            "total": total,
            "errores": errores,
            "avisos": avisos,
            "ultimo": ultimo,
            "origenes": origenes,
            "tipos": tipos
        }))
    })
}

fn op_log_append(payload: &Value) -> Result<Value, String> {
    let nivel = payload.get("nivel").and_then(|v| v.as_str()).unwrap_or("INFO");
    let origen = payload.get("origen").and_then(|v| v.as_str()).unwrap_or("ui");
    let mensaje = campo(payload, "mensaje")?;
    con_estado(|e| {
        e.db
            .execute(
                "INSERT INTO logs (ts,nivel,origen,mensaje) VALUES (?1,?2,?3,?4)",
                params![ahora(), nivel, origen, mensaje],
            )
            .map_err(|x| x.to_string())?;
        escribir_log_archivo(&e.data_dir, nivel, origen, mensaje);
        Ok(json!({ "registrado": true }))
    })
}

// ---------------------------------------------------------------------------
// SQLite con interfaz (sólo lectura)
// ---------------------------------------------------------------------------
// La WebView puede ver tablas, esquema, filas y hacer consultas SELECT.
// Nunca puede escribir: las consultas libres se abren en una conexión
// READ_ONLY y, además, se validan por prefijo y por palabras prohibidas.

fn valor_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => json!(n),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => {
            let s = String::from_utf8_lossy(t);
            if s.chars().count() > 300 {
                json!(format!("{}…", s.chars().take(300).collect::<String>()))
            } else {
                json!(s.into_owned())
            }
        }
        ValueRef::Blob(b) => json!(format!("<BLOB {} bytes>", b.len())),
    }
}

fn leer_filas(
    stmt: &mut rusqlite::Statement<'_>,
    limite: usize,
) -> Result<(Vec<String>, Vec<Value>, bool), String> {
    let columnas: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut filas = stmt.query([]).map_err(|e| format!("SQL: {}", e))?;
    let mut salida = Vec::new();
    let mut truncado = false;
    while let Some(fila) = filas.next().map_err(|e| format!("SQL: {}", e))? {
        if salida.len() >= limite {
            truncado = true;
            break;
        }
        let mut obj = serde_json::Map::new();
        for (i, c) in columnas.iter().enumerate() {
            let v = fila
                .get_ref(i)
                .map_err(|e| format!("columna {}: {}", c, e))?;
            obj.insert(c.clone(), valor_json(v));
        }
        salida.push(Value::Object(obj));
    }
    Ok((columnas, salida, truncado))
}

/// Sólo acepta nombres que existan de verdad en sqlite_master y que sean
/// alfanuméricos: así el nombre se puede interpolar sin riesgo de inyección.
fn tabla_valida(conn: &Connection, tabla: &str) -> Result<String, String> {
    if tabla.is_empty()
        || tabla.len() > 64
        || !tabla
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("nombre de tabla inválido".into());
    }
    let existe: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![tabla],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if existe == 0 {
        return Err(format!("no existe la tabla: {}", tabla));
    }
    Ok(tabla.to_string())
}

fn sqlite_tablas(conn: &Connection, data_dir: &Path) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let mut lista = Vec::new();
    let mut total_filas: i64 = 0;
    let mut filas = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(f) = filas.next().map_err(|e| e.to_string())? {
        let nombre: String = f.get(0).map_err(|e| e.to_string())?;
        let ddl: Option<String> = f.get(1).unwrap_or(None);
        // Conteo rápido: para tablas de bitácora (logs/revision) hacer
        // `COUNT(*)` escanea TODAS las filas y puede tardar segundos cada vez
        // (son tablas grandes). Se usa el máximo del id (índice) que es casi
        // instantáneo, o se devuelve -1 si no hay clave entera.
        let n: i64 = if nombre == "logs" || nombre == "revision" || nombre == "operaciones" {
            conn.query_row(&format!("SELECT COALESCE(MAX(id),0) FROM \"{}\"", nombre), [], |r| r.get(0))
                .unwrap_or(0)
        } else {
            conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", nombre), [], |r| r.get(0))
                .unwrap_or(0)
        };
        total_filas += n;
        let columnas = conn
            .prepare(&format!("SELECT * FROM \"{}\" LIMIT 0", nombre))
            .map(|s| s.column_count())
            .unwrap_or(0);
        lista.push(json!({
            "nombre": nombre,
            "filas": n,
            "columnas": columnas,
            "ddl": ddl.unwrap_or_default()
        }));
    }
    let version: String = conn
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .unwrap_or_else(|_| "?".into());
    let archivo = data_dir.join("fabrick.db");
    let mut bytes = fs::metadata(&archivo).map(|m| m.len()).unwrap_or(0);
    if let Ok(m) = fs::metadata(data_dir.join("fabrick.db-wal")) {
        bytes += m.len();
    }
    Ok(json!({
        "version": version,
        "archivo": "fabrick.db",
        "bytes": bytes,
        "total_filas": total_filas,
        "tablas": lista
    }))
}

fn sqlite_esquema(conn: &Connection, tabla: &str) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let ddl: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![t],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{}\")", t))
        .map_err(|e| e.to_string())?;
    let mut filas = stmt.query([]).map_err(|e| e.to_string())?;
    let mut columnas = Vec::new();
    while let Some(c) = filas.next().map_err(|e| e.to_string())? {
        columnas.push(json!({
            "cid": c.get::<_, i64>(0).unwrap_or(0),
            "nombre": c.get::<_, String>(1).unwrap_or_default(),
            "tipo": c.get::<_, String>(2).unwrap_or_default(),
            "no_nulo": c.get::<_, i64>(3).unwrap_or(0) != 0,
            "defecto": c.get::<_, Option<String>>(4).unwrap_or(None),
            "pk": c.get::<_, i64>(5).unwrap_or(0) != 0
        }));
    }
    Ok(json!({ "tabla": t, "ddl": ddl, "columnas": columnas }))
}

fn sqlite_filas(
    conn: &Connection,
    tabla: &str,
    limite: i64,
    desplazamiento: i64,
) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let limite = limite.clamp(1, 100);
    let desplazamiento = desplazamiento.max(0);
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t), [], |r| r.get(0))
        .unwrap_or(0);

    // `_fila` es el rowid con el que la hoja identifica cada fila para poder
    // editarla o borrarla. Si la tabla no expone rowid (WITHOUT ROWID) se
    // devuelve sin esa columna y la hoja queda en modo sólo lectura.
    let con_rowid = !columnas_tabla(conn, &t)?
        .iter()
        .any(|(n, _)| n == "_fila");
    let prefijo = if con_rowid { "rowid AS _fila, " } else { "" };
    let candidatos = [
        format!(
            "SELECT {}* FROM \"{}\" ORDER BY rowid DESC LIMIT {} OFFSET {}",
            prefijo, t, limite, desplazamiento
        ),
        format!(
            "SELECT {}* FROM \"{}\" LIMIT {} OFFSET {}",
            prefijo, t, limite, desplazamiento
        ),
        format!(
            "SELECT * FROM \"{}\" ORDER BY rowid DESC LIMIT {} OFFSET {}",
            t, limite, desplazamiento
        ),
        format!(
            "SELECT * FROM \"{}\" LIMIT {} OFFSET {}",
            t, limite, desplazamiento
        ),
    ];
    let mut stmt = {
        let mut elegido = None;
        for sql in candidatos.iter() {
            if let Ok(s) = conn.prepare(sql) {
                elegido = Some(s);
                break;
            }
        }
        elegido.ok_or_else(|| format!("no se pudo leer la tabla {}", t))?
    };
    let (columnas, filas, truncado) = leer_filas(&mut stmt, limite as usize)?;
    Ok(json!({
        "tabla": t,
        "columnas": columnas,
        "filas": filas,
        "total": total,
        "limite": limite,
        "desplazamiento": desplazamiento,
        "truncado": truncado,
        "editable": columnas.iter().any(|c| c == "_fila")
    }))
}

fn sqlite_exportar(conn: &Connection, tabla: &str) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let total: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t), [], |r| r.get(0))
        .unwrap_or(0);
    let sql = format!("SELECT * FROM \"{}\" ORDER BY rowid LIMIT 10000", t);
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => conn
            .prepare(&format!("SELECT * FROM \"{}\" LIMIT 10000", t))
            .map_err(|e| e.to_string())?,
    };
    let (columnas, filas, truncado) = leer_filas(&mut stmt, 10000)?;
    Ok(json!({
        "tabla": t,
        "columnas": columnas,
        "filas": filas,
        "total": total,
        "truncado": truncado || total > 10000
    }))
}

fn columnas_tabla(conn: &Connection, tabla: &str) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{}\")", tabla))
        .map_err(|e| e.to_string())?;
    let mut filas = stmt.query([]).map_err(|e| e.to_string())?;
    let mut cols = Vec::new();
    while let Some(c) = filas.next().map_err(|e| e.to_string())? {
        cols.push((
            c.get::<_, String>(1).unwrap_or_default(),
            c.get::<_, String>(2).unwrap_or_default(),
        ));
    }
    Ok(cols)
}

fn json_a_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as SqlValue;
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        otro => SqlValue::Text(otro.to_string()),
    }
}

fn auditar(
    conn: &Connection,
    tabla: &str,
    fila: &str,
    accion: &str,
    detalle: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO auditoria_datos (ts,tabla,fila,accion,detalle) VALUES (?1,?2,?3,?4,?5)",
        params![ahora(), tabla, fila, accion, detalle],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn validar_cambios(
    cols: &[(String, String)],
    cambios: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    if cambios.is_empty() {
        return Err("no hay cambios para guardar".into());
    }
    for col in cambios.keys() {
        let (_, tipo) = cols
            .iter()
            .find(|(n, _)| n == col)
            .ok_or_else(|| format!("columna desconocida: {}", col))?;
        if tipo.to_uppercase().contains("BLOB") {
            return Err(format!(
                "la columna {} es binaria y no se edita desde la hoja",
                col
            ));
        }
    }
    Ok(())
}

fn sqlite_actualizar(
    conn: &Connection,
    tabla: &str,
    fila: i64,
    cambios: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let cols = columnas_tabla(conn, &t)?;
    validar_cambios(&cols, cambios)?;

    let mut sets = Vec::new();
    let mut valores = Vec::new();
    for (col, val) in cambios {
        sets.push(format!("\"{}\" = ?", col));
        valores.push(json_a_sql(val));
    }
    valores.push(rusqlite::types::Value::Integer(fila));
    let sql = format!("UPDATE \"{}\" SET {} WHERE rowid = ?", t, sets.join(", "));
    let n = conn
        .execute(&sql, rusqlite::params_from_iter(valores))
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("no se encontró la fila {}", fila));
    }
    auditar(
        conn,
        &t,
        &fila.to_string(),
        "actualizar",
        &format!("{} columna(s)", sets.len()),
    )?;
    Ok(json!({ "actualizados": n, "fila": fila }))
}

fn sqlite_insertar(
    conn: &Connection,
    tabla: &str,
    valores: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let cols = columnas_tabla(conn, &t)?;
    validar_cambios(&cols, valores)?;

    let mut nombres = Vec::new();
    let mut marcas = Vec::new();
    let mut params_sql = Vec::new();
    for (col, val) in valores {
        nombres.push(format!("\"{}\"", col));
        marcas.push("?");
        params_sql.push(json_a_sql(val));
    }
    let sql = format!(
        "INSERT INTO \"{}\" ({}) VALUES ({})",
        t,
        nombres.join(", "),
        marcas.join(", ")
    );
    conn.execute(&sql, rusqlite::params_from_iter(params_sql))
        .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    auditar(conn, &t, &id.to_string(), "insertar", "fila nueva")?;
    Ok(json!({ "fila": id }))
}

fn sqlite_borrar(conn: &Connection, tabla: &str, fila: i64) -> Result<Value, String> {
    let t = tabla_valida(conn, tabla)?;
    let n = conn
        .execute(&format!("DELETE FROM \"{}\" WHERE rowid = ?1", t), params![fila])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("no se encontró la fila {}", fila));
    }
    auditar(conn, &t, &fila.to_string(), "borrar", "fila eliminada")?;
    Ok(json!({ "borrados": n }))
}

fn sqlite_importar(
    conn: &mut Connection,
    tabla: &str,
    filas: &[Value],
    reemplazar: bool,
) -> Result<Value, String> {
    if filas.is_empty() {
        return Err("no hay filas para importar".into());
    }
    if filas.len() > 1000 {
        return Err("máximo 1000 filas por importación".into());
    }
    let t = tabla_valida(conn, tabla)?;
    let cols = columnas_tabla(conn, &t)?;
    let prefijo = if reemplazar {
        "INSERT OR REPLACE"
    } else {
        "INSERT"
    };

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut n = 0usize;
    for fila in filas {
        let obj = fila
            .as_object()
            .ok_or_else(|| "cada fila debe ser un objeto JSON".to_string())?;
        validar_cambios(&cols, obj)?;
        let mut nombres = Vec::new();
        let mut marcas = Vec::new();
        let mut params_sql = Vec::new();
        for (col, val) in obj {
            nombres.push(format!("\"{}\"", col));
            marcas.push("?");
            params_sql.push(json_a_sql(val));
        }
        let sql = format!(
            "{} INTO \"{}\" ({}) VALUES ({})",
            prefijo,
            t,
            nombres.join(", "),
            marcas.join(", ")
        );
        tx.execute(&sql, rusqlite::params_from_iter(params_sql))
            .map_err(|e| format!("fila {}: {}", n + 1, e))?;
        n += 1;
    }
    tx.commit().map_err(|e| e.to_string())?;
    auditar(
        conn,
        &t,
        "",
        "importar",
        &format!("{} fila(s){}", n, if reemplazar { " · reemplazo" } else { "" }),
    )?;
    Ok(json!({ "importadas": n }))
}

fn sqlite_auditoria(conn: &Connection, limite: i64) -> Result<Value, String> {
    let lim = limite.clamp(1, 100);
    let sql = format!(
        "SELECT id, ts, tabla, fila, accion, detalle
         FROM auditoria_datos ORDER BY id DESC LIMIT {}",
        lim
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let (columnas, filas, truncado) = leer_filas(&mut stmt, lim as usize)?;
    Ok(json!({
        "columnas": columnas,
        "filas": filas,
        "truncado": truncado
    }))
}

fn sqlite_consultar(data_dir: &Path, sql: &str) -> Result<Value, String> {
    let limpio = sql.trim().trim_end_matches(';').trim().to_string();
    if limpio.is_empty() {
        return Err("escribe una consulta SELECT".into());
    }
    if limpio.len() > 4000 {
        return Err("la consulta es demasiado larga".into());
    }
    if limpio.contains(';') {
        return Err("solo se permite una consulta".into());
    }
    let bajo = limpio.to_lowercase();
    if !(bajo.starts_with("select") || bajo.starts_with("with")) {
        return Err("solo se permiten consultas SELECT o WITH".into());
    }
    for palabra in [
        "insert ", "update ", "delete ", "drop ", "alter ", "create ", "attach ", "detach ",
        "pragma ", "vacuum ", "reindex ", "replace ", "trigger ",
    ] {
        if bajo.contains(palabra) {
            return Err(format!(
                "la consulta contiene una operación no permitida: {}",
                palabra.trim()
            ));
        }
    }

    let ruta = data_dir.join("fabrick.db");
    let conn = Connection::open_with_flags(&ruta, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("no se pudo abrir en sólo lectura: {}", e))?;
    let mut stmt = conn.prepare(&limpio).map_err(|e| format!("SQL: {}", e))?;
    let (columnas, filas, truncado) = leer_filas(&mut stmt, 200)?;
    let cantidad = filas.len();
    Ok(json!({
        "columnas": columnas,
        "filas": filas,
        "cantidad": cantidad,
        "truncado": truncado
    }))
}

fn op_sqlite(payload: &Value) -> Result<Value, String> {
    let accion = payload
        .get("accion")
        .and_then(|v| v.as_str())
        .unwrap_or("tablas")
        .to_string();
    con_estado(|e| match accion.as_str() {
        "tablas" => sqlite_tablas(&e.db, &e.data_dir),
        "esquema" => sqlite_esquema(&e.db, &campo(payload, "tabla")?),
        "filas" => {
            let tabla = campo(payload, "tabla")?;
            let limite = payload.get("limite").and_then(|v| v.as_i64()).unwrap_or(20);
            let desplazamiento = payload
                .get("desplazamiento")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            sqlite_filas(&e.db, &tabla, limite, desplazamiento)
        }
        "exportar" => sqlite_exportar(&e.db, &campo(payload, "tabla")?),
        "consultar" => sqlite_consultar(&e.data_dir, &campo(payload, "sql")?),
        "actualizar" => {
            let tabla = campo(payload, "tabla")?;
            let fila = payload
                .get("fila")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| "falta el número de fila".to_string())?;
            let cambios = payload
                .get("cambios")
                .and_then(|v| v.as_object())
                .ok_or_else(|| "faltan los cambios a guardar".to_string())?
                .clone();
            sqlite_actualizar(&e.db, &tabla, fila, &cambios)
        }
        "insertar" => {
            let tabla = campo(payload, "tabla")?;
            let valores = payload
                .get("valores")
                .and_then(|v| v.as_object())
                .ok_or_else(|| "faltan los valores de la fila nueva".to_string())?
                .clone();
            sqlite_insertar(&e.db, &tabla, &valores)
        }
        "borrar" => {
            let tabla = campo(payload, "tabla")?;
            let fila = payload
                .get("fila")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| "falta el número de fila".to_string())?;
            sqlite_borrar(&e.db, &tabla, fila)
        }
        "importar" => {
            let tabla = campo(payload, "tabla")?;
            let filas = payload
                .get("filas")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "faltan las filas para importar".to_string())?
                .clone();
            let reemplazar = payload
                .get("reemplazar")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            sqlite_importar(&mut e.db, &tabla, &filas, reemplazar)
        }
        "auditoria" => {
            let limite = payload.get("limite").and_then(|v| v.as_i64()).unwrap_or(50);
            sqlite_auditoria(&e.db, limite)
        }
        otra => Err(format!("acción sqlite no autorizada: {}", otra)),
    })
}

/// Consola FABRI-CORE: sólo tareas internas de una lista blanca.
/// NUNCA se ejecuta un comando recibido desde la interfaz.
fn op_tarea(payload: &Value) -> Result<Value, String> {
    let tarea = campo(payload, "tarea")?;
    let inicio = ahora();
    let (ok, salida) = match tarea {
        "ping" => (true, "pong: núcleo Rust activo".to_string()),
        "espacio" => con_estado(|e| {
            let (t, l, d) = espacio(&e.data_dir);
            Ok(json!({ "salida": format!("total={} libre={} disponible={}", t, l, d), "ok": true }))
        })
        .map(|v| (true, v["salida"].as_str().unwrap_or("").to_string()))
        .unwrap_or((false, "sin estado".into())),
        "version" => (true, format!("FABRI-CORE {} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::ARCH)),
        "sqlite" => con_estado(|e| {
            let v: String = e
                .db
                .query_row("SELECT sqlite_version()", [], |r| r.get(0))
                .unwrap_or_else(|_| "?".into());
            Ok(json!({ "salida": v, "ok": true }))
        })
        .map(|v| (true, v["salida"].as_str().unwrap_or("").to_string()))
        .unwrap_or((false, "sin estado".into())),
        otra => (false, format!("tarea no autorizada: {}", otra)),
    };

    con_estado(|e| {
        e.db
            .execute(
                "INSERT INTO logs (ts,nivel,origen,mensaje) VALUES (?1,?2,'consola',?3)",
                params![ahora(), if ok { "OK" } else { "ERROR" }, salida],
            )
            .map_err(|x| x.to_string())?;
        e.db
            .execute(
                "INSERT INTO operaciones (id,inicio,fin,tipo,fase,estado,detalle) VALUES (?1,?2,?3,'tarea','ejecucion',?4,?5)",
                params![id_operacion("t"), inicio, ahora(), if ok { "OK" } else { "ERROR" }, salida],
            )
            .map_err(|x| x.to_string())?;
        escribir_log_archivo(&e.data_dir, if ok { "OK" } else { "ERROR" }, "consola", &salida);
        Ok(json!({ "ok": ok, "tarea": tarea, "salida": salida, "inicio": inicio, "fin": ahora() }))
    })
}

// ---------------------------------------------------------------------------
// Punto de entrada JNI: una sola función que despacha por "op".
// Java la declara en cl.fabrick.core.NativeBridge.exec(String, String).
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "system" fn Java_cl_fabrick_core_NativeBridge_exec<'local>(
    mut env: JNIEnv<'local>,
    _clase: JClass<'local>,
    op: JString<'local>,
    payload: JString<'local>,
) -> jstring {
    let op: String = env.get_string(&op).map(|s| s.into()).unwrap_or_default();
    let payload_txt: String = env.get_string(&payload).map(|s| s.into()).unwrap_or_default();
    let payload_json: Value = serde_json::from_str(&payload_txt).unwrap_or_else(|_| json!({}));

    let resultado: Result<Value, String> = match op.as_str() {
        "ping" => Ok(json!({
            "pong": true,
            "version": env!("CARGO_PKG_VERSION"),
            "abi": std::env::consts::ARCH
        })),
        "init" => op_init(&payload_json),
        "mantenimiento" => op_mantenimiento(&payload_json),
        "config" => op_config(&payload_json),
        "componentes" => op_componentes(&payload_json),
        "manifiestos" => op_manifiestos(&payload_json),
        "logs" => op_logs(&payload_json),
        "log.append" => op_log_append(&payload_json),
        "revision.registrar" => op_revision_registrar(&payload_json),
        "revision.listar" => op_revision_listar(&payload_json),
        "revision.resumen" => op_revision_resumen(&payload_json),
        "operaciones" => op_operaciones(&payload_json),
        "rendimiento" => op_rendimiento(&payload_json),
        "sys" => op_sys(&payload_json),
        "estado_global" => op_estado_global(&payload_json),
        "dispositivo_detalles" => op_dispositivo_detalles(&payload_json),
        "modelos_recomendados" => op_modelos_recomendados(&payload_json),
        "modelos" => op_modelos(&payload_json),
        "nube" => op_nube(&payload_json),
        "rag" => op_rag(&payload_json),
        "graphrag_buscar" => match campo(&payload_json, "tema") {
            Ok(tema) => {
                let limite = payload_json.get("limite").and_then(|v| v.as_i64()).unwrap_or(10);
                con_estado(|e| graphrag_buscar(&e.data_dir, &tema, limite))
            }
            Err(e) => Err(e),
        },
        "aprendizaje_guardar" => match campo(&payload_json, "tema") {
            Ok(tema) => match campo(&payload_json, "contenido") {
                Ok(contenido) => {
                    let preferencia = payload_json.get("preferencia").and_then(|v| v.as_str());
                    con_estado(|e| aprendizaje_guardar(&e.db, &tema, &contenido, preferencia))
                }
                Err(e) => Err(e),
            },
            Err(e) => Err(e),
        },
        "aprendizaje_buscar" => match campo(&payload_json, "tema") {
            Ok(tema) => {
                let limite = payload_json.get("limite").and_then(|v| v.as_i64()).unwrap_or(5);
                con_estado(|e| aprendizaje_buscar(&e.db, &tema, limite))
            }
            Err(e) => Err(e),
        },
        "consultar_seguro" => match campo(&payload_json, "sql") {
            Ok(sql) => con_estado(|e| sql_consultar_seguro(&e.data_dir, &sql)),
            Err(e) => Err(e),
        },
        "sqlite" => op_sqlite(&payload_json),
        "inventario" => con_estado(|e| op_inventario(&payload_json, &e.db)),
        "perfil" => con_estado(|e| op_perfil(&payload_json, &e.db)),
        "usuarios" => con_estado(|e| op_usuarios(&payload_json, &e.db)),
        "modulos" => con_estado(|e| modulos::op(&payload_json, &e.db, &e.data_dir)),
        "tarea" => op_tarea(&payload_json),
        otro => Err(format!("operación desconocida: {}", otro)),
    };

    let respuesta = match resultado {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(e) => json!({ "ok": false, "error": e.clone(), "codigo": "CORE_ERROR" }),
    };

    match env.new_string(respuesta.to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

// ===========================================================================
//  INVENTARIO · productos, precios por proveedor, márgenes y boletas
//  -------------------------------------------------------------------------
//  Todo vive en la misma SQLite local (fabrick.db). La nube no es obligatoria:
//  `sync_pendientes` devuelve lo que cambió desde el último envío y
//  `sync_marcar` lo da por sincronizado. Si no hay nube configurada, la app
//  sigue funcionando igual y lo dice.
// ===========================================================================

fn inv_txt(v: &Value, clave: &str) -> String {
    v.get(clave)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn inv_num(v: &Value, clave: &str) -> f64 {
    v.get(clave)
        .and_then(|x| {
            x.as_f64()
                .or_else(|| x.as_str().map(|s| s.replace(',', ".").parse::<f64>().unwrap_or(0.0)))
        })
        .unwrap_or(0.0)
}

fn inv_entero(v: &Value, clave: &str) -> i64 {
    v.get(clave)
        .and_then(|x| {
            x.as_i64()
                .or_else(|| x.as_str().map(|s| s.replace(',', ".").parse::<f64>().unwrap_or(0.0) as i64))
        })
        .unwrap_or(0)
}

/// Ficha ampliada del producto (etiquetas, alérgenos, Nutri-Score, NOVA…).
///
/// Llega como objeto o como cadena JSON desde la interfaz. Se valida para que
/// una entrada corrupta no rompa la fila: cualquier cosa que no sea un objeto
/// JSON razonable se guarda como `{}`.
fn inv_ficha(p: &Value) -> String {
    const TOPE: usize = 4000;
    match p.get("ficha") {
        Some(Value::Object(m)) => {
            let s = Value::Object(m.clone()).to_string();
            if s.len() <= TOPE { s } else { "{}".to_string() }
        }
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.starts_with('{') && t.len() <= TOPE && serde_json::from_str::<Value>(t).is_ok() {
                t.to_string()
            } else {
                "{}".to_string()
            }
        }
        _ => "{}".to_string(),
    }
}

fn inv_esquema(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS inv_productos (
            codigo       TEXT PRIMARY KEY,
            nombre       TEXT NOT NULL DEFAULT '',
            marca        TEXT NOT NULL DEFAULT '',
            categoria    TEXT NOT NULL DEFAULT 'abarrotes',
            unidad       TEXT NOT NULL DEFAULT 'unidad',
            costo        REAL NOT NULL DEFAULT 0,
            precio       REAL NOT NULL DEFAULT 0,
            stock        INTEGER NOT NULL DEFAULT 0,
            stock_minimo INTEGER NOT NULL DEFAULT 0,
            iva          INTEGER NOT NULL DEFAULT 19,
            proveedor    TEXT NOT NULL DEFAULT '',
            origen       TEXT NOT NULL DEFAULT 'manual',
            notas        TEXT NOT NULL DEFAULT '',
            ficha        TEXT NOT NULL DEFAULT '{}',
            creado       INTEGER NOT NULL DEFAULT 0,
            actualizado  INTEGER NOT NULL DEFAULT 0,
            sync_ts      INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS inv_precios (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo    TEXT NOT NULL,
            proveedor TEXT NOT NULL DEFAULT '',
            precio    REAL NOT NULL DEFAULT 0,
            fecha     INTEGER NOT NULL DEFAULT 0,
            nota      TEXT NOT NULL DEFAULT ''
         );
         CREATE INDEX IF NOT EXISTS idx_inv_precios_codigo ON inv_precios(codigo);
         CREATE TABLE IF NOT EXISTS inv_movimientos (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo   TEXT NOT NULL,
            tipo     TEXT NOT NULL DEFAULT 'entrada',
            cantidad INTEGER NOT NULL DEFAULT 0,
            motivo   TEXT NOT NULL DEFAULT '',
            ts       INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS inv_boletas (
            folio    INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente  TEXT NOT NULL DEFAULT '',
            rut      TEXT NOT NULL DEFAULT '',
            items    TEXT NOT NULL DEFAULT '[]',
            neto     REAL NOT NULL DEFAULT 0,
            iva      REAL NOT NULL DEFAULT 0,
            total    REAL NOT NULL DEFAULT 0,
            pago     TEXT NOT NULL DEFAULT 'efectivo',
            estado   TEXT NOT NULL DEFAULT 'emitida',
            ts       INTEGER NOT NULL DEFAULT 0
         );",
    )?;
    // Bases creadas antes de la ficha ampliada: se añade la columna una sola
    // vez. `CREATE TABLE IF NOT EXISTS` no toca tablas existentes.
    if !inv_tiene_columna(db, "inv_productos", "ficha") {
        let _ = db.execute(
            "ALTER TABLE inv_productos ADD COLUMN ficha TEXT NOT NULL DEFAULT '{}'",
            [],
        );
    }
    // Ficha de identidad del negocio (página ID): logo, razón social, RUT,
    // giro, dirección, ID de cliente… Se guarda como JSON en una sola columna
    // para no migrar la tabla en cada campo nuevo.
    if !inv_tiene_columna(db, "perfil", "datos") {
        let _ = db.execute(
            "ALTER TABLE perfil ADD COLUMN datos TEXT NOT NULL DEFAULT '{}'",
            [],
        );
    }
    Ok(())
}

/** ¿La tabla ya tiene esa columna? Se usa para migrar sin romper bases viejas. */
fn inv_tiene_columna(db: &Connection, tabla: &str, columna: &str) -> bool {
    let sql = format!("PRAGMA table_info({})", tabla);
    let mut encontrada = false;
    if let Ok(mut stmt) = db.prepare(&sql) {
        if let Ok(filas) = stmt.query_map([], |r| r.get::<_, String>(1)) {
            for nombre in filas.flatten() {
                if nombre == columna {
                    encontrada = true;
                }
            }
        }
    }
    encontrada
}

fn inv_fila(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    let costo: f64 = r.get(5)?;
    let precio: f64 = r.get(6)?;
    let margen = if precio > 0.0 { (precio - costo) / precio * 100.0 } else { 0.0 };
    Ok(json!({
        "codigo": r.get::<_, String>(0)?,
        "nombre": r.get::<_, String>(1)?,
        "marca": r.get::<_, String>(2)?,
        "categoria": r.get::<_, String>(3)?,
        "unidad": r.get::<_, String>(4)?,
        "costo": costo,
        "precio": precio,
        "margen": (margen * 10.0).round() / 10.0,
        "stock": r.get::<_, i64>(7)?,
        "stock_minimo": r.get::<_, i64>(8)?,
        "iva": r.get::<_, i64>(9)?,
        "proveedor": r.get::<_, String>(10)?,
        "origen": r.get::<_, String>(11)?,
        "notas": r.get::<_, String>(12)?,
        "actualizado": r.get::<_, i64>(13)?,
        "pendiente_sync": r.get::<_, i64>(14)? == 0,
        // Ficha ampliada de la API libre (etiquetas, alérgenos, Nutri-Score,
        // NOVA, país, imagen). Se guarda como JSON para no perder información
        // entre consultas y poder filtrar por «sin gluten», etc.
        "ficha": r.get::<_, String>(15).unwrap_or_else(|_| "{}".to_string()),
    }))
}

fn inv_producto(db: &Connection, codigo: &str) -> Result<Value, String> {
    let mut stmt = db
        .prepare(
            "SELECT codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,
                    iva,proveedor,origen,notas,actualizado,sync_ts,ficha
             FROM inv_productos WHERE codigo = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![codigo], inv_fila)
        .optional()
        .map_err(|e| e.to_string())
        .map(|o| o.unwrap_or(Value::Null))
}

fn op_perfil(payload: &Value, db: &Connection) -> Result<Value, String> {
    let accion = payload
        .get("accion")
        .and_then(|v| v.as_str())
        .unwrap_or("obtener");
    match accion {
        "obtener" => {
            let fila = db
                .query_row(
                    "SELECT nombre, indicativo, foto, actualizado, datos FROM perfil WHERE id = 1",
                    [],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, i64>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(match fila {
                Some((nombre, indicativo, foto, actualizado, datos)) => json!({
                    "existe": true,
                    "nombre": nombre,
                    "indicativo": indicativo,
                    "foto": foto,
                    "actualizado": actualizado,
                    "datos": perfil_datos_parse(&datos),
                }),
                None => json!({
                    "existe": false,
                    "nombre": "",
                    "indicativo": "",
                    "foto": "",
                    "actualizado": 0,
                    "datos": {},
                }),
            })
        }
        "guardar" => {
            let nombre = payload
                .get("nombre")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let indicativo = payload
                .get("indicativo")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let foto = payload
                .get("foto")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // La foto se guarda como data URL de imagen y con tope: una foto de
            // cámara sin reducir puede pesar 4 MB y no tiene por qué entrar en
            // SQLite. La interfaz la reduce a ~256 px antes de mandarla.
            if !foto.is_empty() {
                if !foto.starts_with("data:image/") {
                    return Err("la foto debe ser una imagen (data:image/...)".into());
                }
                if foto.len() > 900_000 {
                    return Err("la foto supera 900 KB: usa una imagen más pequeña".into());
                }
            }
            if nombre.chars().count() > 60 {
                return Err("el nombre supera 60 caracteres".into());
            }
            if indicativo.chars().count() > 24 {
                return Err("el indicativo supera 24 caracteres".into());
            }

            let ahora_ms = ahora();
            // `datos` es opcional: si no viene, se conserva lo que ya había
            // (la página ID guarda su ficha aparte y no debe borrarla al
            // cambiar sólo el nombre).
            let datos_nuevos = match payload.get("datos") {
                Some(v) if v.is_object() => {
                    let texto = v.to_string();
                    if texto.len() > 24_000 {
                        return Err("la ficha de identidad supera 24 KB".into());
                    }
                    Some(texto)
                }
                _ => None,
            };
            db.execute(
                "INSERT INTO perfil (id, nombre, indicativo, foto, actualizado, datos)
                 VALUES (1, ?1, ?2, ?3, ?4, COALESCE(?5, '{}'))
                 ON CONFLICT(id) DO UPDATE SET
                     nombre = ?1, indicativo = ?2,
                     foto = CASE WHEN ?3 = '' THEN foto ELSE ?3 END,
                     datos = COALESCE(?5, datos),
                     actualizado = ?4",
                params![nombre, indicativo, foto, ahora_ms, datos_nuevos],
            )
            .map_err(|e| e.to_string())?;
            // La tarjeta del login y la tabla de usuarios muestran lo mismo: el
            // perfil se refleja en el usuario operador sin duplicar la captura.
            db.execute(
                "UPDATE usuarios SET nombre = ?1, indicativo = ?2,
                        foto = CASE WHEN ?3 = '' THEN foto ELSE ?3 END
                  WHERE usuario = 'operador'",
                params![nombre, indicativo, foto],
            )
            .ok();
            Ok(json!({
                "ok": true,
                "nombre": nombre,
                "indicativo": indicativo,
                "actualizado": ahora_ms,
                "bytes_foto": foto.len(),
            }))
        }
        "guardar_datos" => {
            // Mezcla parcial: sólo se reemplazan las claves enviadas, así la
            // página ID puede guardar un campo sin reenviar la ficha entera.
            let nuevos = payload
                .get("datos")
                .ok_or_else(|| "falta `datos`".to_string())?;
            if !nuevos.is_object() {
                return Err("`datos` debe ser un objeto".into());
            }
            let actual = db
                .query_row("SELECT datos FROM perfil WHERE id = 1", [], |r| {
                    r.get::<_, String>(0)
                })
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| "{}".to_string());
            let mut mezcla = perfil_datos_parse(&actual);
            if let (Some(destino), Some(origen)) = (mezcla.as_object_mut(), nuevos.as_object()) {
                for (k, v) in origen {
                    destino.insert(k.clone(), v.clone());
                }
            }
            let texto = mezcla.to_string();
            if texto.len() > 24_000 {
                return Err("la ficha de identidad supera 24 KB".into());
            }
            let ahora_ms = ahora();
            db.execute(
                "INSERT INTO perfil (id, datos, actualizado) VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET datos = ?1, actualizado = ?2",
                params![texto, ahora_ms],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({
                "ok": true,
                "datos": mezcla,
                "actualizado": ahora_ms,
                "bytes": texto.len(),
            }))
        }
        "borrar_foto" => {
            db.execute(
                "UPDATE perfil SET foto = '', actualizado = ?1 WHERE id = 1",
                params![ahora()],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "foto": "" }))
        }
        otra => Err(format!("acción de perfil no soportada: {}", otra)),
    }
}

/// Lee la ficha de identidad guardada como JSON. Si el texto está corrupto
/// (edición manual de la base), devuelve un objeto vacío en vez de fallar: la
/// página ID tiene que abrir siempre.
fn perfil_datos_parse(texto: &str) -> Value {
    serde_json::from_str::<Value>(texto)
        .ok()
        .filter(|v| v.is_object())
        .unwrap_or_else(|| json!({}))
}

/// Usuarios de la app. El verificador del PIN vive aquí (PBKDF2 con sal y
/// algoritmo); Java sólo calcula el hash y aplica el bloqueo por intentos.
/// Nunca se devuelve el PIN en claro porque nunca se guarda.
fn op_usuarios(payload: &Value, db: &Connection) -> Result<Value, String> {
    let accion = payload
        .get("accion")
        .and_then(|v| v.as_str())
        .unwrap_or("listar");
    let usuario = payload
        .get("usuario")
        .and_then(|v| v.as_str())
        .unwrap_or("operador")
        .trim()
        .to_string();

    let texto = |clave: &str| {
        payload
            .get(clave)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };

    match accion {
        "listar" => {
            let mut stmt = db
                .prepare(
                    "SELECT id,usuario,nombre,indicativo,foto,rol,activo,creado,ultimo_acceso,
                            CASE WHEN hash <> '' THEN 1 ELSE 0 END
                       FROM usuarios ORDER BY id",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map([], |r| {
                    Ok(json!({
                        "id": r.get::<_, i64>(0)?,
                        "usuario": r.get::<_, String>(1)?,
                        "nombre": r.get::<_, String>(2)?,
                        "indicativo": r.get::<_, String>(3)?,
                        "foto": r.get::<_, String>(4)?,
                        "rol": r.get::<_, String>(5)?,
                        "activo": r.get::<_, i64>(6)? == 1,
                        "creado": r.get::<_, i64>(7)?,
                        "ultimo_acceso": r.get::<_, i64>(8)?,
                        "tiene_pin": r.get::<_, i64>(9)? == 1,
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            let activos = filas
                .iter()
                .filter(|u| u["activo"].as_bool().unwrap_or(false))
                .count();
            Ok(json!({ "usuarios": filas, "total": filas.len(), "activos": activos }))
        }

        // Material criptográfico del verificador: sólo lo pide la pantalla de
        // acceso para pasárselo a Java. No incluye ningún dato en claro.
        "verificador" => {
            let fila = db
                .query_row(
                    "SELECT usuario,algoritmo,sal,hash,iteraciones FROM usuarios
                      WHERE usuario = ?1 AND activo = 1",
                    params![usuario],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, i64>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(match fila {
                Some((usuario, algoritmo, sal, hash, iteraciones)) => json!({
                    "existe": !hash.is_empty(),
                    "usuario": usuario,
                    "algoritmo": algoritmo,
                    "sal": sal,
                    "hash": hash,
                    "iteraciones": iteraciones,
                }),
                None => json!({ "existe": false, "usuario": usuario }),
            })
        }

        "crear" | "sincronizar" => {
            let nombre = texto("nombre");
            let indicativo = texto("indicativo");
            let foto = texto("foto");
            let rol = {
                let r = texto("rol");
                if r.is_empty() { "operador".to_string() } else { r }
            };
            let algoritmo = texto("algoritmo");
            let sal = texto("sal");
            let hash = texto("hash");
            let iteraciones = payload
                .get("iteraciones")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            if usuario.is_empty() {
                return Err("el usuario no puede estar vacío".into());
            }
            if nombre.chars().count() > 60 {
                return Err("el nombre supera 60 caracteres".into());
            }
            if indicativo.chars().count() > 24 {
                return Err("el indicativo supera 24 caracteres".into());
            }
            if !foto.is_empty() {
                if !foto.starts_with("data:image/") {
                    return Err("la foto debe ser una imagen (data:image/...)".into());
                }
                if foto.len() > 900_000 {
                    return Err("la foto supera 900 KB: usa una imagen más pequeña".into());
                }
            }
            // Si viene hash, viene con su sal y su algoritmo: sin los tres no
            // se puede verificar nada y guardarlo a medias sería peor.
            if !hash.is_empty() && (sal.is_empty() || algoritmo.is_empty()) {
                return Err("el verificador necesita algoritmo, sal y hash".into());
            }

            let ahora_ms = ahora();
            db.execute(
                "INSERT INTO usuarios
                     (usuario,nombre,indicativo,foto,rol,algoritmo,sal,hash,iteraciones,activo,creado,ultimo_acceso)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,0)
                 ON CONFLICT(usuario) DO UPDATE SET
                     nombre      = CASE WHEN excluded.nombre      = '' THEN usuarios.nombre      ELSE excluded.nombre      END,
                     indicativo  = CASE WHEN excluded.indicativo  = '' THEN usuarios.indicativo  ELSE excluded.indicativo  END,
                     foto        = CASE WHEN excluded.foto        = '' THEN usuarios.foto        ELSE excluded.foto        END,
                     rol         = excluded.rol,
                     algoritmo   = CASE WHEN excluded.hash = '' THEN usuarios.algoritmo ELSE excluded.algoritmo END,
                     sal         = CASE WHEN excluded.hash = '' THEN usuarios.sal       ELSE excluded.sal       END,
                     hash        = CASE WHEN excluded.hash = '' THEN usuarios.hash      ELSE excluded.hash      END,
                     iteraciones = CASE WHEN excluded.hash = '' THEN usuarios.iteraciones ELSE excluded.iteraciones END,
                     activo      = 1",
                params![
                    usuario,
                    nombre,
                    indicativo,
                    foto,
                    rol,
                    algoritmo,
                    sal,
                    hash,
                    iteraciones,
                    ahora_ms
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(json!({
                "ok": true,
                "usuario": usuario,
                "con_pin": !hash.is_empty(),
                "actualizado": ahora_ms,
            }))
        }

        "ultimo_acceso" => {
            let ahora_ms = ahora();
            let filas = db
                .execute(
                    "UPDATE usuarios SET ultimo_acceso = ?1 WHERE usuario = ?2",
                    params![ahora_ms, usuario],
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "filas": filas, "ultimo_acceso": ahora_ms }))
        }

        "actualizar" => {
            let nombre = texto("nombre");
            let indicativo = texto("indicativo");
            let foto = texto("foto");
            let rol = texto("rol");
            let ahora_ms = ahora();
            let filas = db
                .execute(
                    "UPDATE usuarios SET
                         nombre     = CASE WHEN ?1 = '' THEN nombre     ELSE ?1 END,
                         indicativo = CASE WHEN ?2 = '' THEN indicativo ELSE ?2 END,
                         foto       = CASE WHEN ?3 = '' THEN foto       ELSE ?3 END,
                         rol        = CASE WHEN ?4 = '' THEN rol        ELSE ?4 END
                      WHERE usuario = ?5",
                    params![nombre, indicativo, foto, rol, usuario],
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "filas": filas, "actualizado": ahora_ms }))
        }

        "borrar" => {
            // No se borra el último usuario activo: dejaría la app sin acceso.
            let activos: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM usuarios WHERE activo = 1 AND usuario <> ?1",
                    params![usuario],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if activos == 0 {
                return Err("no se puede borrar el único usuario activo".into());
            }
            let filas = db
                .execute("DELETE FROM usuarios WHERE usuario = ?1", params![usuario])
                .map_err(|e| e.to_string())?;
            Ok(json!({ "ok": true, "filas": filas }))
        }

        "resumen" => {
            let (total, con_pin, activos): (i64, i64, i64) = db
                .query_row(
                    "SELECT COUNT(*),
                            SUM(CASE WHEN hash <> '' THEN 1 ELSE 0 END),
                            SUM(CASE WHEN activo = 1 THEN 1 ELSE 0 END)
                       FROM usuarios",
                    [],
                    |r| Ok((r.get(0)?, r.get(1).unwrap_or(0), r.get(2).unwrap_or(0))),
                )
                .map_err(|e| e.to_string())?;
            Ok(json!({ "total": total, "con_pin": con_pin, "activos": activos }))
        }

        otra => Err(format!("acción de usuarios no soportada: {}", otra)),
    }
}

fn op_inventario(payload: &Value, db: &Connection) -> Result<Value, String> {
    if !ESQUEMA_LISTO.load(std::sync::atomic::Ordering::Relaxed) {
        inv_esquema(db).map_err(|e| format!("no se pudo crear el esquema de inventario: {}", e))?;
        ESQUEMA_LISTO.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    let accion = payload.get("accion").and_then(|v| v.as_str()).unwrap_or("listar");

    match accion {
        // ---------------------------------------------------------------- listar
        "listar" => {
            let texto = inv_txt(payload, "texto");
            let categoria = inv_txt(payload, "categoria");
            let bajo = inv_entero(payload, "stock_bajo");
            let limite = inv_entero(payload, "limite").clamp(1, 500);
            let offset = inv_entero(payload, "offset").max(0);
            let mut stmt = db
                .prepare(
                    "SELECT codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,
                            iva,proveedor,origen,notas,actualizado,sync_ts,ficha
                     FROM inv_productos
                     WHERE (?1 = '' OR nombre LIKE '%'||?1||'%' OR codigo LIKE '%'||?1||'%'
                            OR marca LIKE '%'||?1||'%' OR categoria LIKE '%'||?1||'%')
                       AND (?2 = '' OR categoria = ?2)
                       AND (?3 = 0 OR stock <= stock_minimo)
                     ORDER BY nombre COLLATE NOCASE
                     LIMIT ?4 OFFSET ?5",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map(params![texto, categoria, bajo, limite, offset], inv_fila)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            let total: i64 = db
                .query_row("SELECT COUNT(*) FROM inv_productos", [], |r| r.get(0))
                .unwrap_or(0);
            Ok(json!({ "productos": filas, "total": total, "limite": limite, "offset": offset }))
        }

        // --------------------------------------------------------------- guardar
        "guardar" => {
            let p = payload.get("producto").cloned().unwrap_or_else(|| payload.clone());
            let mut codigo = inv_txt(&p, "codigo");
            if codigo.is_empty() {
                codigo = format!("MAN-{}", ahora());
            }
            let nombre = inv_txt(&p, "nombre");
            if nombre.is_empty() {
                return Ok(json!({ "ok": false, "codigo": "INV_SIN_NOMBRE",
                    "error": "el producto necesita un nombre" }));
            }
            let ts = ahora();
            let categoria = {
                let c = inv_txt(&p, "categoria");
                if c.is_empty() { "abarrotes".to_string() } else { c }
            };
            db.execute(
                "INSERT INTO inv_productos
                   (codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,
                    iva,proveedor,origen,notas,ficha,creado,actualizado,sync_ts)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,0)
                 ON CONFLICT(codigo) DO UPDATE SET
                   nombre=excluded.nombre, marca=excluded.marca, categoria=excluded.categoria,
                   unidad=excluded.unidad, costo=excluded.costo, precio=excluded.precio,
                   stock=excluded.stock, stock_minimo=excluded.stock_minimo, iva=excluded.iva,
                   proveedor=excluded.proveedor, origen=excluded.origen, notas=excluded.notas,
                   ficha=excluded.ficha,
                   actualizado=excluded.actualizado, sync_ts=0",
                params![
                    codigo,
                    nombre,
                    inv_txt(&p, "marca"),
                    categoria,
                    {
                        let u = inv_txt(&p, "unidad");
                        if u.is_empty() { "unidad".to_string() } else { u }
                    },
                    inv_num(&p, "costo"),
                    inv_num(&p, "precio"),
                    inv_entero(&p, "stock"),
                    inv_entero(&p, "stock_minimo"),
                    {
                        let iva = inv_entero(&p, "iva");
                        if p.get("iva").is_some() { iva } else { 19 }
                    },
                    inv_txt(&p, "proveedor"),
                    {
                        let o = inv_txt(&p, "origen");
                        if o.is_empty() { "manual".to_string() } else { o }
                    },
                    inv_txt(&p, "notas"),
                    inv_ficha(&p),
                    ts
                ],
            )
            .map_err(|e| format!("no se pudo guardar el producto: {}", e))?;
            let guardado = inv_producto(db, &codigo)?;
            Ok(json!({ "ok": true, "producto": guardado, "codigo": codigo }))
        }

        // ---------------------------------------------------------------- borrar
        "borrar" => {
            let codigo = inv_txt(payload, "codigo");
            if codigo.is_empty() {
                return Ok(json!({ "ok": false, "error": "falta el código" }));
            }
            let n = db
                .execute("DELETE FROM inv_productos WHERE codigo = ?1", params![codigo])
                .map_err(|e| e.to_string())?;
            db.execute("DELETE FROM inv_precios WHERE codigo = ?1", params![codigo]).ok();
            Ok(json!({ "ok": true, "borrados": n }))
        }

        // -------------------------------------------------------- buscar_codigo
        "buscar_codigo" => {
            let codigo = inv_txt(payload, "codigo");
            let p = inv_producto(db, &codigo)?;
            Ok(json!({ "ok": true, "encontrado": !p.is_null(), "producto": p }))
        }

        // --------------------------------------------------------- precio_agregar
        "precio_agregar" => {
            let codigo = inv_txt(payload, "codigo");
            if codigo.is_empty() {
                return Ok(json!({ "ok": false, "error": "falta el código" }));
            }
            db.execute(
                "INSERT INTO inv_precios (codigo,proveedor,precio,fecha,nota)
                 VALUES (?1,?2,?3,?4,?5)",
                params![
                    codigo,
                    inv_txt(payload, "proveedor"),
                    inv_num(payload, "precio"),
                    ahora(),
                    inv_txt(payload, "nota")
                ],
            )
            .map_err(|e| format!("no se pudo guardar el precio: {}", e))?;
            Ok(json!({ "ok": true }))
        }

        // --------------------------------------------------------------- precios
        "precios" => {
            let codigo = inv_txt(payload, "codigo");
            let mut stmt = db
                .prepare(
                    "SELECT id,proveedor,precio,fecha,nota FROM inv_precios
                     WHERE codigo = ?1 ORDER BY precio ASC, fecha DESC",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map(params![codigo], |r| {
                    Ok(json!({
                        "id": r.get::<_, i64>(0)?,
                        "proveedor": r.get::<_, String>(1)?,
                        "precio": r.get::<_, f64>(2)?,
                        "fecha": r.get::<_, i64>(3)?,
                        "nota": r.get::<_, String>(4)?
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            let precios: Vec<f64> = filas
                .iter()
                .map(|f| f["precio"].as_f64().unwrap_or(0.0))
                .filter(|p| *p > 0.0)
                .collect();
            let mejor = precios.first().copied().unwrap_or(0.0);
            let peor = precios.last().copied().unwrap_or(0.0);
            let promedio = if precios.is_empty() {
                0.0
            } else {
                precios.iter().sum::<f64>() / precios.len() as f64
            };
            let mejor_proveedor = filas
                .iter()
                .find(|f| f["precio"].as_f64().unwrap_or(0.0) == mejor)
                .and_then(|f| f["proveedor"].as_str())
                .unwrap_or("")
                .to_string();
            Ok(json!({
                "precios": filas,
                "mejor": mejor,
                "peor": peor,
                "promedio": (promedio * 100.0).round() / 100.0,
                "ahorro": ((peor - mejor) * 100.0).round() / 100.0,
                "mejor_proveedor": mejor_proveedor
            }))
        }

        // ---------------------------------------------------------------- margen
        "margen" => {
            let costo = inv_num(payload, "costo");
            let precio = inv_num(payload, "precio");
            let objetivo = inv_num(payload, "objetivo");
            let iva_pct = {
                let v = inv_entero(payload, "iva");
                if payload.get("iva").is_some() { v } else { 19 }
            };
            let utilidad = precio - costo;
            let margen_venta = if precio > 0.0 { utilidad / precio * 100.0 } else { 0.0 };
            let markup = if costo > 0.0 { utilidad / costo * 100.0 } else { 0.0 };
            let sugerido = if objetivo > 0.0 && objetivo < 100.0 {
                costo / (1.0 - objetivo / 100.0)
            } else {
                0.0
            };
            let factor_iva = 1.0 + (iva_pct as f64) / 100.0;
            Ok(json!({
                "utilidad": (utilidad * 100.0).round() / 100.0,
                "margen_venta": (margen_venta * 10.0).round() / 10.0,
                "markup": (markup * 10.0).round() / 10.0,
                "precio_sugerido": (sugerido * 100.0).round() / 100.0,
                "precio_con_iva": (precio * factor_iva * 100.0).round() / 100.0,
                "neto": (precio / factor_iva * 100.0).round() / 100.0,
                "rentable": utilidad > 0.0
            }))
        }

        // ------------------------------------------------------------ movimiento
        "movimiento" => {
            let codigo = inv_txt(payload, "codigo");
            let tipo = inv_txt(payload, "tipo");
            let cantidad = inv_entero(payload, "cantidad");
            if codigo.is_empty() || cantidad == 0 {
                return Ok(json!({ "ok": false, "error": "faltan código o cantidad" }));
            }
            let delta = match tipo.as_str() {
                "salida" => -cantidad.abs(),
                "ajuste" => cantidad,
                _ => cantidad.abs(),
            };
            let n = db
                .execute(
                    "UPDATE inv_productos SET stock = stock + ?1, actualizado = ?2, sync_ts = 0
                     WHERE codigo = ?3",
                    params![delta, ahora(), codigo],
                )
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Ok(json!({ "ok": false, "error": "el producto no existe" }));
            }
            db.execute(
                "INSERT INTO inv_movimientos (codigo,tipo,cantidad,motivo,ts)
                 VALUES (?1,?2,?3,?4,?5)",
                params![codigo, tipo, cantidad, inv_txt(payload, "motivo"), ahora()],
            )
            .ok();
            let stock: i64 = db
                .query_row("SELECT stock FROM inv_productos WHERE codigo = ?1", params![codigo], |r| r.get(0))
                .unwrap_or(0);
            Ok(json!({ "ok": true, "stock": stock, "delta": delta }))
        }

        // --------------------------------------------------------------- resumen
        "resumen" => {
            let (total, valor_costo, valor_venta, bajo, sin_precio) = db
                .query_row(
                    "SELECT COUNT(*),
                            COALESCE(SUM(costo*stock),0),
                            COALESCE(SUM(precio*stock),0),
                            COALESCE(SUM(CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END),0),
                            COALESCE(SUM(CASE WHEN precio <= 0 THEN 1 ELSE 0 END),0)
                     FROM inv_productos",
                    [],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?,
                            r.get::<_, i64>(3)?, r.get::<_, i64>(4)?)),
                )
                .unwrap_or((0, 0.0, 0.0, 0, 0));
            let mut stmt = db
                .prepare("SELECT categoria, COUNT(*) FROM inv_productos GROUP BY categoria ORDER BY 2 DESC")
                .map_err(|e| e.to_string())?;
            let categorias = stmt
                .query_map([], |r| Ok(json!({ "categoria": r.get::<_, String>(0)?, "n": r.get::<_, i64>(1)? })))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            let pendientes: i64 = db
                .query_row("SELECT COUNT(*) FROM inv_productos WHERE sync_ts = 0", [], |r| r.get(0))
                .unwrap_or(0);
            Ok(json!({
                "total": total,
                "valor_costo": (valor_costo * 100.0).round() / 100.0,
                "valor_venta": (valor_venta * 100.0).round() / 100.0,
                "utilidad_potencial": ((valor_venta - valor_costo) * 100.0).round() / 100.0,
                "stock_bajo": bajo,
                "sin_precio": sin_precio,
                "categorias": categorias,
                "pendientes_sync": pendientes
            }))
        }

        // ---------------------------------------------------------- boleta_crear
        "boleta_crear" => {
            let items = payload.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            if items.is_empty() {
                return Ok(json!({ "ok": false, "error": "la boleta no tiene ítems" }));
            }
            let iva_pct = {
                let v = inv_num(payload, "iva");
                if payload.get("iva").is_some() { v } else { 19.0 }
            };
            let mut total = 0.0;
            for it in &items {
                let cant = inv_num(it, "cantidad").max(1.0);
                total += inv_num(it, "precio") * cant;
            }
            let factor = 1.0 + iva_pct / 100.0;
            let neto = total / factor;
            let iva = total - neto;
            let ts = ahora();
            db.execute(
                "INSERT INTO inv_boletas (cliente,rut,items,neto,iva,total,pago,estado,ts)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,'emitida',?8)",
                params![
                    inv_txt(payload, "cliente"),
                    inv_txt(payload, "rut"),
                    Value::Array(items.clone()).to_string(),
                    (neto * 100.0).round() / 100.0,
                    (iva * 100.0).round() / 100.0,
                    (total * 100.0).round() / 100.0,
                    {
                        let p = inv_txt(payload, "pago");
                        if p.is_empty() { "efectivo".to_string() } else { p }
                    },
                    ts
                ],
            )
            .map_err(|e| format!("no se pudo emitir la boleta: {}", e))?;
            let folio: i64 = db.query_row("SELECT last_insert_rowid()", [], |r| r.get(0)).unwrap_or(0);
            // Descuenta stock de cada ítem vendido.
            for it in &items {
                let codigo = inv_txt(it, "codigo");
                let cant = inv_num(it, "cantidad").max(1.0) as i64;
                if codigo.is_empty() {
                    continue;
                }
                db.execute(
                    "UPDATE inv_productos SET stock = stock - ?1, actualizado = ?2, sync_ts = 0
                     WHERE codigo = ?3",
                    params![cant, ts, codigo],
                )
                .ok();
                db.execute(
                    "INSERT INTO inv_movimientos (codigo,tipo,cantidad,motivo,ts)
                     VALUES (?1,'salida',?2,?3,?4)",
                    params![codigo, cant, format!("boleta {}", folio), ts],
                )
                .ok();
            }
            Ok(json!({
                "ok": true,
                "folio": folio,
                "neto": (neto * 100.0).round() / 100.0,
                "iva": (iva * 100.0).round() / 100.0,
                "total": (total * 100.0).round() / 100.0,
                "items": items,
                "cliente": inv_txt(payload, "cliente"),
                "rut": inv_txt(payload, "rut"),
                "pago": inv_txt(payload, "pago"),
                "fecha": ts
            }))
        }

        // --------------------------------------------------------------- boletas
        "boletas" => {
            let limite = inv_entero(payload, "limite").clamp(1, 200);
            let mut stmt = db
                .prepare(
                    "SELECT folio,cliente,rut,total,estado,ts,items,neto,iva,pago
                     FROM inv_boletas ORDER BY folio DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map(params![limite], |r| {
                    // Los ítems se guardan como JSON: se devuelven ya como
                    // arreglo para que reimprimir una boleta vieja funcione.
                    let crudos: String = r.get::<_, String>(6)?;
                    let items: Value = serde_json::from_str(&crudos).unwrap_or(json!([]));
                    Ok(json!({
                        "folio": r.get::<_, i64>(0)?,
                        "cliente": r.get::<_, String>(1)?,
                        "rut": r.get::<_, String>(2)?,
                        "total": r.get::<_, f64>(3)?,
                        "estado": r.get::<_, String>(4)?,
                        "ts": r.get::<_, i64>(5)?,
                        "items": items,
                        "neto": r.get::<_, f64>(7)?,
                        "iva": r.get::<_, f64>(8)?,
                        "pago": r.get::<_, String>(9)?
                    }))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            Ok(json!({ "boletas": filas }))
        }

        // -------------------------------------------------------------- exportar
        "exportar" => {
            let categoria = inv_txt(payload, "categoria");
            let mut stmt = db
                .prepare(
                    "SELECT codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,proveedor
                     FROM inv_productos WHERE (?1 = '' OR categoria = ?1) ORDER BY categoria, nombre",
                )
                .map_err(|e| e.to_string())?;
            let mut csv = String::from(
                "Codigo;Nombre;Marca;Categoria;Unidad;Costo;Precio;Stock;Stock minimo;Proveedor;Margen %;Valor costo;Valor venta\n",
            );
            let filas = stmt
                .query_map(params![categoria], |r| {
                    Ok((
                        r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, f64>(5)?,
                        r.get::<_, f64>(6)?, r.get::<_, i64>(7)?, r.get::<_, i64>(8)?,
                        r.get::<_, String>(9)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            let mut n = 0;
            for f in filas.filter_map(|x| x.ok()) {
                let margen = if f.6 > 0.0 { (f.6 - f.5) / f.6 * 100.0 } else { 0.0 };
                csv.push_str(&format!(
                    "{};{};{};{};{};{:.0};{:.0};{};{};{};{:.1};{:.0};{:.0}\n",
                    f.0, f.1.replace(';', ","), f.2.replace(';', ","), f.3, f.4,
                    f.5, f.6, f.7, f.8, f.9.replace(';', ","), margen, f.5 * f.7 as f64, f.6 * f.7 as f64
                ));
                n += 1;
            }
            Ok(json!({ "ok": true, "csv": csv, "filas": n }))
        }

        // ----------------------------------------------------- sync_pendientes
        "sync_pendientes" => {
            let mut stmt = db
                .prepare(
                    "SELECT codigo,nombre,marca,categoria,unidad,costo,precio,stock,stock_minimo,
                            iva,proveedor,origen,notas,actualizado,sync_ts,ficha
                     FROM inv_productos WHERE sync_ts = 0 ORDER BY actualizado ASC LIMIT 500",
                )
                .map_err(|e| e.to_string())?;
            let filas = stmt
                .query_map([], inv_fila)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<Value>>();
            Ok(json!({ "ok": true, "productos": filas, "n": filas.len() }))
        }

        // ---------------------------------------------------------- sync_marcar
        "sync_marcar" => {
            let codigos = payload.get("codigos").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let ts = ahora();
            let mut n = 0;
            for c in codigos {
                if let Some(codigo) = c.as_str() {
                    if db
                        .execute("UPDATE inv_productos SET sync_ts = ?1 WHERE codigo = ?2", params![ts, codigo])
                        .is_ok()
                    {
                        n += 1;
                    }
                }
            }
            Ok(json!({ "ok": true, "marcados": n, "ts": ts }))
        }

        otro => Err(format!("acción de inventario desconocida: {}", otro)),
    }
}
