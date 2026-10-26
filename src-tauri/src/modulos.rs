// ============================================================================
//  Módulos (plugins declarativos) de FABRI-CORE
//  ---------------------------------------------------------------------------
//  Un módulo NO es código ejecutable descargado: es un manifiesto JSON que
//  declara capacidades y parámetros. El núcleo Rust implementa las capacidades
//  seguras (dividir texto, indexar/buscar vectores, renderizar plantillas y
//  analizar archivos) y el módulo sólo las configura.
//
//  Por qué así: Android prohíbe ejecutar binarios desde el sandbox (W^X, T0) y
//  cargar código nativo descargado sería una superficie de ataque inaceptable.
//  Los módulos que necesitan otro lenguaje viven fuera (Termux/servidor) y se
//  consumen por HTTP; acá quedan los que sí caben en el teléfono.
// ============================================================================

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CATALOGO: &[(&str, &str)] = &[
    ("modulos/vector-local.json", include_str!("../../modulos/vector-local.json")),
    ("modulos/rag-basico.json", include_str!("../../modulos/rag-basico.json")),
    ("modulos/ingesta-local.json", include_str!("../../modulos/ingesta-local.json")),
    ("modulos/analisis-local.json", include_str!("../../modulos/analisis-local.json")),
    // Páginas por construir: se siembran como módulos `tipo: pagina`. El menú
    // lateral las lista y cada una explica su función e instrucciones copiables.
    ("modulos/paginas/pagina-memoria.json", include_str!("../../modulos/paginas/pagina-memoria.json")),
    ("modulos/paginas/pagina-chat.json", include_str!("../../modulos/paginas/pagina-chat.json")),
    ("modulos/paginas/pagina-termux.json", include_str!("../../modulos/paginas/pagina-termux.json")),
    ("modulos/paginas/pagina-repositorio.json", include_str!("../../modulos/paginas/pagina-repositorio.json")),
    ("modulos/paginas/pagina-grafo.json", include_str!("../../modulos/paginas/pagina-grafo.json")),
    ("modulos/paginas/pagina-voz.json", include_str!("../../modulos/paginas/pagina-voz.json")),
    ("modulos/paginas/pagina-vision.json", include_str!("../../modulos/paginas/pagina-vision.json")),
    ("modulos/paginas/pagina-automatizaciones.json", include_str!("../../modulos/paginas/pagina-automatizaciones.json")),
    ("modulos/paginas/pagina-mcp.json", include_str!("../../modulos/paginas/pagina-mcp.json")),
    ("modulos/paginas/pagina-ajustes.json", include_str!("../../modulos/paginas/pagina-ajustes.json")),
    ("modulos/paginas/pagina-ayuda.json", include_str!("../../modulos/paginas/pagina-ayuda.json")),
];

fn ahora() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn migrar(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS modulos (
            id          TEXT PRIMARY KEY,
            nombre      TEXT NOT NULL,
            version     TEXT,
            tipo        TEXT,
            lenguaje    TEXT,
            estado      TEXT NOT NULL DEFAULT 'INSTALADO',
            actualizado INTEGER NOT NULL,
            manifiesto  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vectores (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            documento TEXT,
            texto     TEXT NOT NULL,
            vector    BLOB NOT NULL,
            metadatos TEXT,
            creado    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_vectores_doc ON vectores(documento);
        "#,
    )
}

/// Registra los módulos que vienen con la app (no descargan nada).
pub fn sembrar(conn: &Connection) -> rusqlite::Result<()> {
    let ts = ahora();
    for (_ruta, texto) in CATALOGO {
        let Ok(m) = serde_json::from_str::<Value>(texto) else {
            continue;
        };
        let id = m.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let tipo = m.get("tipo").and_then(|v| v.as_str()).unwrap_or("declarativo");
        let lenguaje = m
            .get("lenguaje")
            .and_then(|v| v.as_str())
            .unwrap_or(if tipo == "pagina" { "declarativo" } else { "rust" });
        conn.execute(
            "INSERT INTO modulos (id,nombre,version,tipo,lenguaje,estado,actualizado,manifiesto)
             VALUES (?1,?2,?3,?4,?5,'INSTALADO',?6,?7)
             ON CONFLICT(id) DO UPDATE SET
                 nombre=excluded.nombre, version=excluded.version, tipo=excluded.tipo,
                 lenguaje=excluded.lenguaje, manifiesto=excluded.manifiesto",
            params![
                id,
                m.get("nombre").and_then(|v| v.as_str()).unwrap_or(id),
                m.get("version").and_then(|v| v.as_str()).unwrap_or("0"),
                tipo,
                lenguaje,
                ts,
                texto
            ],
        )?;
    }
    Ok(())
}

pub fn op(payload: &Value, conn: &Connection, data_dir: &Path) -> Result<Value, String> {
    match payload.get("accion").and_then(|v| v.as_str()).unwrap_or("listar") {
        "listar" => listar(conn),
        "ejecutar" => ejecutar(payload, conn, data_dir),
        "importar" => importar(payload, conn),
        "instalar" => instalar(payload, conn, data_dir),
        otra => Err(format!("acción de módulos desconocida: {}", otra)),
    }
}

/// Capacidades que el núcleo implementa. Un módulo importado no puede declarar
/// otra cosa: el manifiesto es configuración, no código.
const CAPACIDADES: &[&str] = &[
    "texto.dividir",
    "plantilla.render",
    "vector.indexar",
    "vector.buscar",
    "archivo.analizar",
];

const MAX_MANIFIESTO: usize = 64 * 1024;

/// Importa un módulo desde el texto JSON que eligió el usuario.
/// No ejecuta nada: valida, normaliza y guarda en la tabla `modulos`.
fn importar(payload: &Value, conn: &Connection) -> Result<Value, String> {
    let texto = payload
        .get("texto")
        .and_then(|v| v.as_str())
        .ok_or("falta el contenido del módulo (campo 'texto')")?;
    if texto.len() > MAX_MANIFIESTO {
        return Err(format!(
            "manifiesto demasiado grande: {} bytes (máximo {})",
            texto.len(),
            MAX_MANIFIESTO
        ));
    }
    importar_texto(conn, texto)
}

/// Valida y registra un manifiesto ya leído. Acepta dos tipos:
/// - `declarativo`: módulo con capacidades seguras del núcleo.
/// - `pagina`: ficha de una pantalla por construir (menú lateral).
fn importar_texto(conn: &Connection, texto: &str) -> Result<Value, String> {
    if texto.len() > MAX_MANIFIESTO {
        return Err(format!(
            "manifiesto demasiado grande: {} bytes (máximo {})",
            texto.len(),
            MAX_MANIFIESTO
        ));
    }

    let m: Value = serde_json::from_str(texto).map_err(|e| format!("JSON inválido: {}", e))?;
    if !m.is_object() {
        return Err("el manifiesto debe ser un objeto JSON".into());
    }

    if m.get("tipo").and_then(|v| v.as_str()) == Some("pagina") {
        return importar_pagina(&m, conn);
    }

    let id = m
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("falta 'id'")?
        .trim();
    if id.len() < 2 || id.len() > 64 {
        return Err("'id' debe tener entre 2 y 64 caracteres".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || !id.chars().next().map(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).unwrap_or(false)
    {
        return Err("'id' sólo admite minúsculas, dígitos y guiones (ej: mi-modulo)".into());
    }

    let tipo = m.get("tipo").and_then(|v| v.as_str()).unwrap_or("");
    if tipo != "declarativo" {
        return Err(format!(
            "tipo no admitido: '{}' (se aceptan módulos declarativos o páginas)",
            tipo
        ));
    }

    let version = m.get("version").and_then(|v| v.as_str()).unwrap_or("").trim();
    if version.is_empty() || version.len() > 32 {
        return Err("'version' es obligatoria (máximo 32 caracteres)".into());
    }

    let capacidades = m
        .get("capacidades")
        .and_then(|v| v.as_array())
        .ok_or("falta el arreglo 'capacidades'")?;
    if capacidades.is_empty() {
        return Err("'capacidades' no puede estar vacío".into());
    }
    let mut limpias: Vec<String> = Vec::new();
    for cap in capacidades {
        let c = cap
            .as_str()
            .ok_or("cada capacidad debe ser texto")?
            .trim();
        if !CAPACIDADES.contains(&c) {
            return Err(format!(
                "capacidad desconocida: '{}' (admitidas: {:?})",
                c, CAPACIDADES
            ));
        }
        if !limpias.iter().any(|x| x == c) {
            limpias.push(c.to_string());
        }
    }

    let limites = m
        .get("limites")
        .and_then(|v| v.as_array())
        .ok_or("falta el arreglo 'limites'")?;
    if limites.is_empty() || limites.iter().any(|x| x.as_str().map(|s| s.trim().is_empty()).unwrap_or(true))
    {
        return Err("'limites' debe traer al menos un texto no vacío".into());
    }

    if let Some(plantilla) = m.get("plantilla").and_then(|v| v.as_str()) {
        if plantilla.len() > 16000 {
            return Err("la plantilla supera 16 000 caracteres".into());
        }
        if !limpias.iter().any(|c| c == "plantilla.render") {
            return Err("el módulo trae plantilla pero no declara 'plantilla.render'".into());
        }
    }

    // Se guarda el JSON ya normalizado (sin campos raros) con los datos que usa
    // el núcleo. `reemplaza` y `evidencia` son informativos.
    let normalizado = json!({
        "id": id,
        "nombre": m.get("nombre").and_then(|v| v.as_str()).unwrap_or(id),
        "version": version,
        "tipo": "declarativo",
        "lenguaje": m.get("lenguaje").and_then(|v| v.as_str()).unwrap_or("rust"),
        "licencia": m.get("licencia").and_then(|v| v.as_str()).unwrap_or("MIT"),
        "descripcion": m.get("descripcion").and_then(|v| v.as_str()).unwrap_or(""),
        "capacidades": limpias,
        "parametros": m.get("parametros").cloned().unwrap_or_else(|| json!({})),
        "plantilla": m.get("plantilla").cloned().unwrap_or(Value::Null),
        "limites": limites,
        "reemplaza": m.get("reemplaza").cloned().unwrap_or_else(|| json!([])),
        "evidencia": m.get("evidencia").and_then(|v| v.as_str()).unwrap_or("")
    });
    let texto_normalizado = normalizado.to_string();

    conn.execute(
        "INSERT INTO modulos (id,nombre,version,tipo,lenguaje,estado,actualizado,manifiesto)
         VALUES (?1,?2,?3,'declarativo',?4,'INSTALADO',?5,?6)
         ON CONFLICT(id) DO UPDATE SET
             nombre=excluded.nombre, version=excluded.version, lenguaje=excluded.lenguaje,
             estado='INSTALADO', actualizado=excluded.actualizado, manifiesto=excluded.manifiesto",
        params![
            id,
            normalizado.get("nombre").and_then(|v| v.as_str()).unwrap_or(id),
            version,
            normalizado.get("lenguaje").and_then(|v| v.as_str()).unwrap_or("rust"),
            ahora(),
            texto_normalizado
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "version": version,
        "capacidades": normalizado.get("capacidades"),
        "importado": true
    }))
}

/// Ficha de una página por construir. No ejecuta nada: es contenido para el
/// menú lateral (descripción, secciones e instrucciones copiables).
fn importar_pagina(m: &Value, conn: &Connection) -> Result<Value, String> {
    let id = m
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("falta 'id'")?
        .trim();
    if id.len() < 2 || id.len() > 64 {
        return Err("'id' debe tener entre 2 y 64 caracteres".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || !id.chars().next().map(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).unwrap_or(false)
    {
        return Err("'id' sólo admite minúsculas, dígitos y guiones (ej: pagina-memoria)".into());
    }

    let nombre = m
        .get("nombre")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if nombre.len() < 2 || nombre.chars().count() > 80 {
        return Err("'nombre' debe tener entre 2 y 80 caracteres".into());
    }

    let version = m.get("version").and_then(|v| v.as_str()).unwrap_or("").trim();
    if version.is_empty() || version.len() > 32 {
        return Err("'version' es obligatoria (máximo 32 caracteres)".into());
    }

    let descripcion = m
        .get("descripcion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if descripcion.chars().count() < 20 || descripcion.chars().count() > 4000 {
        return Err("'descripcion' debe tener entre 20 y 4.000 caracteres".into());
    }

    let secciones = m
        .get("secciones")
        .and_then(|v| v.as_array())
        .ok_or("falta el arreglo 'secciones'")?;
    if secciones.is_empty() || secciones.len() > 12 {
        return Err("'secciones' debe tener entre 1 y 12 elementos".into());
    }
    let mut limpias: Vec<Value> = Vec::new();
    for s in secciones {
        let titulo = s
            .get("titulo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let texto = s
            .get("texto")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if titulo.is_empty() || texto.is_empty() {
            return Err("cada sección necesita 'titulo' y 'texto'".into());
        }
        if titulo.chars().count() > 80 || texto.chars().count() > 2000 {
            return Err("sección demasiado larga (título máx. 80, texto máx. 2.000)".into());
        }
        limpias.push(json!({ "titulo": titulo, "texto": texto }));
    }

    let instrucciones = m
        .get("instrucciones")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if instrucciones.chars().count() < 20 || instrucciones.chars().count() > 20000 {
        return Err("'instrucciones' debe tener entre 20 y 20.000 caracteres".into());
    }

    let estado = m
        .get("estado")
        .and_then(|v| v.as_str())
        .unwrap_or("POR CONSTRUIR")
        .trim();
    if estado.is_empty() || estado.chars().count() > 40 {
        return Err("'estado' inválido".into());
    }

    let depende: Vec<String> = m
        .get("depende")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && s.len() <= 80)
                .take(12)
                .collect()
        })
        .unwrap_or_default();

    let modulo = m
        .get("modulo")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let normalizado = json!({
        "id": id,
        "nombre": nombre,
        "version": version,
        "tipo": "pagina",
        "estado": estado,
        "descripcion": descripcion,
        "secciones": limpias,
        "instrucciones": instrucciones,
        "depende": depende,
        "modulo": modulo,
        "licencia": m.get("licencia").and_then(|v| v.as_str()).unwrap_or("MIT")
    });

    conn.execute(
        "INSERT INTO modulos (id,nombre,version,tipo,lenguaje,estado,actualizado,manifiesto)
         VALUES (?1,?2,?3,'pagina','declarativo','INSTALADO',?4,?5)
         ON CONFLICT(id) DO UPDATE SET
             nombre=excluded.nombre, version=excluded.version, tipo='pagina',
             lenguaje='declarativo', estado='INSTALADO',
             actualizado=excluded.actualizado, manifiesto=excluded.manifiesto",
        params![id, nombre, version, ahora(), normalizado.to_string()],
    )
    .map_err(|e| e.to_string())?;

    Ok(json!({
        "id": id,
        "version": version,
        "tipo": "pagina",
        "secciones": normalizado.get("secciones").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "importado": true
    }))
}

/// Instala un módulo o página ya descargado y verificado en
/// `filesDir/componentes/<componente>/`. Sólo lee manifiestos JSON pequeños:
/// nunca ejecuta el archivo ni lo saca del sandbox.
fn instalar(payload: &Value, conn: &Connection, data_dir: &Path) -> Result<Value, String> {
    let componente = campo(payload, "componente")?.trim();
    if componente.len() < 2 || componente.len() > 64 {
        return Err("'componente' debe tener entre 2 y 64 caracteres".into());
    }
    if componente.contains("..")
        || componente.starts_with('.')
        || !componente
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
    {
        return Err("'componente' inválido: admite minúsculas, dígitos, '-', '_' y '.'".into());
    }

    let base = data_dir.join("componentes");
    if !base.exists() {
        return Err("todavía no hay componentes descargados".into());
    }
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("no se pudo resolver la carpeta de componentes: {}", e))?;
    let dir = base.join(componente);
    let dir_canon = dir
        .canonicalize()
        .map_err(|_| format!("no existe la carpeta del componente '{}'", componente))?;
    if !dir_canon.starts_with(&base_canon) {
        return Err("el componente queda fuera de la carpeta permitida".into());
    }
    if !dir_canon.is_dir() {
        return Err(format!("'{}' no es una carpeta de componente", componente));
    }

    let mut rutas: Vec<PathBuf> = fs::read_dir(&dir_canon)
        .map_err(|e| format!("no se pudo leer {}: {}", componente, e))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("json"))
                    .unwrap_or(false)
        })
        .collect();
    rutas.sort();

    if rutas.is_empty() {
        return Err(format!(
            "el componente '{}' no trae manifiestos .json; no hay nada que instalar",
            componente
        ));
    }

    let mut instalados: Vec<Value> = Vec::new();
    let mut errores: Vec<String> = Vec::new();

    for ruta in rutas {
        let nombre = ruta
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("manifiesto.json")
            .to_string();
        let meta = match fs::metadata(&ruta) {
            Ok(m) => m,
            Err(e) => {
                errores.push(format!("{}: {}", nombre, e));
                continue;
            }
        };
        if meta.len() > MAX_MANIFIESTO as u64 {
            errores.push(format!(
                "{}: demasiado grande ({} bytes, máximo {})",
                nombre, meta.len(), MAX_MANIFIESTO
            ));
            continue;
        }
        let texto = match fs::read_to_string(&ruta) {
            Ok(t) => t,
            Err(e) => {
                errores.push(format!("{}: no se pudo leer ({})", nombre, e));
                continue;
            }
        };
        match importar_texto(conn, &texto) {
            Ok(v) => instalados.push(json!({ "archivo": nombre, "resultado": v })),
            Err(e) => errores.push(format!("{}: {}", nombre, e)),
        }
    }

    if !instalados.is_empty() {
        conn.execute(
            "UPDATE componentes SET estado='INSTALADO', actualizado=?1 WHERE id=?2",
            params![ahora(), componente],
        )
        .ok();
    }

    Ok(json!({
        "componente": componente,
        "instalados": instalados,
        "errores": errores,
        "directorio": format!("filesDir/componentes/{}", componente),
        "nota": "Instalar registra el manifiesto en SQLite; no ejecuta código descargado."
    }))
}

fn listar(conn: &Connection) -> Result<Value, String> {
    let mut lista: Vec<Value> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT estado, actualizado, manifiesto FROM modulos ORDER BY id")
            .map_err(|e| e.to_string())?;
        let filas = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for fila in filas {
            let (estado, actualizado, texto) = fila.map_err(|e| e.to_string())?;
            let manifiesto: Value = serde_json::from_str(&texto).unwrap_or_else(|_| json!({}));
            lista.push(json!({
                "estado": estado,
                "actualizado": actualizado,
                "manifiesto": manifiesto
            }));
        }
    }
    Ok(json!({ "modulos": lista, "total": lista.len() }))
}

fn ejecutar(payload: &Value, conn: &Connection, data_dir: &Path) -> Result<Value, String> {
    let id = campo(payload, "id")?;
    let capacidad = campo(payload, "capacidad")?;
    let entrada = payload.get("entrada").cloned().unwrap_or_else(|| json!({}));

    let texto: Option<String> = conn
        .query_row(
            "SELECT manifiesto FROM modulos WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let texto = texto.ok_or_else(|| format!("módulo no instalado: {}", id))?;
    let manifiesto: Value =
        serde_json::from_str(&texto).map_err(|e| format!("manifiesto inválido: {}", e))?;

    let permitida = manifiesto
        .get("capacidades")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().any(|x| x.as_str() == Some(capacidad)))
        .unwrap_or(false);
    if !permitida {
        return Err(format!(
            "el módulo {} no declara la capacidad {}",
            id, capacidad
        ));
    }

    let parametros = manifiesto
        .get("parametros")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let resultado = match capacidad {
        "texto.dividir" => cap_dividir(&entrada, &parametros)?,
        "vector.indexar" => cap_indexar(conn, &entrada)?,
        "vector.buscar" => cap_buscar(conn, &entrada, &parametros)?,
        "plantilla.render" => cap_plantilla(&entrada, &manifiesto)?,
        "archivo.analizar" => cap_analizar(&entrada, data_dir, &parametros)?,
        otra => return Err(format!("capacidad no implementada en el núcleo: {}", otra)),
    };

    Ok(json!({
        "modulo": id,
        "capacidad": capacidad,
        "resultado": resultado
    }))
}

fn campo<'a>(payload: &'a Value, clave: &str) -> Result<&'a str, String> {
    payload
        .get(clave)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("falta el campo obligatorio '{}'", clave))
}

// ------------------------------------------------------------------ texto

fn cap_dividir(entrada: &Value, parametros: &Value) -> Result<Value, String> {
    let texto = entrada
        .get("texto")
        .and_then(|v| v.as_str())
        .ok_or("falta entrada.texto")?;
    let max = parametros
        .get("maxCaracteres")
        .and_then(|v| v.as_u64())
        .unwrap_or(900) as usize;
    let solape = parametros
        .get("solape")
        .and_then(|v| v.as_u64())
        .unwrap_or(120) as usize;
    let max = max.clamp(200, 8000);
    let solape = solape.min(max / 2);

    let bytes = texto.len();
    let mut fragmentos: Vec<Value> = Vec::new();
    let mut inicio = 0usize;

    while inicio < bytes {
        let mut fin = (inicio + max).min(bytes);
        while fin > inicio && !texto.is_char_boundary(fin) {
            fin -= 1;
        }
        if fin < bytes {
            let piso = inicio + (max * 7 / 10).min(fin - inicio);
            let corte = texto[inicio..fin]
                .rfind("\n\n")
                .map(|p| inicio + p)
                .filter(|p| *p >= piso)
                .or_else(|| {
                    texto[inicio..fin]
                        .rfind('\n')
                        .map(|p| inicio + p)
                        .filter(|p| *p >= piso)
                });
            if let Some(p) = corte {
                fin = p;
            }
        }

        let trozo = texto[inicio..fin].trim();
        if !trozo.is_empty() {
            let indice = fragmentos.len();
            fragmentos.push(json!({
                "indice": indice,
                "texto": trozo,
                "caracteres": trozo.chars().count()
            }));
        }

        if fin >= bytes {
            break;
        }
        let mut siguiente = fin.saturating_sub(solape);
        while siguiente > inicio && !texto.is_char_boundary(siguiente) {
            siguiente -= 1;
        }
        inicio = if siguiente > inicio { siguiente } else { fin };
    }

    Ok(json!({
        "fragmentos": fragmentos,
        "total": fragmentos.len(),
        "maxCaracteres": max,
        "solape": solape
    }))
}

fn cap_plantilla(entrada: &Value, manifiesto: &Value) -> Result<Value, String> {
    let plantilla = manifiesto
        .get("plantilla")
        .and_then(|v| v.as_str())
        .ok_or("el módulo no trae plantilla")?;
    let mut salida = plantilla.to_string();
    if let Some(obj) = entrada.as_object() {
        for (clave, valor) in obj {
            let texto = match valor {
                Value::String(s) => s.clone(),
                otro => otro.to_string(),
            };
            salida = salida.replace(&format!("{{{{{}}}}}", clave), &texto);
        }
    }
    let recortado: String = salida.chars().take(16000).collect();
    Ok(json!({
        "prompt": recortado,
        "caracteres": recortado.chars().count(),
        "recortado": recortado.chars().count() < salida.chars().count()
    }))
}

// ---------------------------------------------------------------- vectores

fn cap_indexar(conn: &Connection, entrada: &Value) -> Result<Value, String> {
    let documento = entrada
        .get("documento")
        .and_then(|v| v.as_str())
        .unwrap_or("sin-documento");
    let texto = entrada
        .get("texto")
        .and_then(|v| v.as_str())
        .ok_or("falta entrada.texto")?;
    let vector = leer_vector(entrada.get("vector").ok_or("falta entrada.vector")?)?;
    let metadatos = entrada
        .get("metadatos")
        .cloned()
        .unwrap_or_else(|| json!({}))
        .to_string();

    conn.execute(
        "INSERT INTO vectores (documento,texto,vector,metadatos,creado)
         VALUES (?1,?2,?3,?4,?5)",
        params![documento, texto, vector_a_blob(&vector), metadatos, ahora()],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM vectores", [], |r| r.get(0))
        .unwrap_or(0);

    Ok(json!({ "id": id, "dim": vector.len(), "total": total }))
}

fn cap_buscar(conn: &Connection, entrada: &Value, parametros: &Value) -> Result<Value, String> {
    let consulta = leer_vector(entrada.get("vector").ok_or("falta entrada.vector")?)?;
    let k = entrada
        .get("k")
        .and_then(|v| v.as_u64())
        .unwrap_or(5) as usize;
    let k = k.clamp(1, parametros.get("kMax").and_then(|v| v.as_u64()).unwrap_or(20) as usize);
    let filas_max = parametros
        .get("filasMax")
        .and_then(|v| v.as_u64())
        .unwrap_or(20000) as i64;

    let mut crudos: Vec<(i64, String, String, Vec<u8>, Option<String>)> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id,documento,texto,vector,metadatos FROM vectores
                 ORDER BY id DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let filas = stmt
            .query_map(params![filas_max], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Vec<u8>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for fila in filas {
            crudos.push(fila.map_err(|e| e.to_string())?);
        }
    }

    let comparados = crudos.len();
    let mut resultados: Vec<(f64, Value)> = Vec::new();
    for (id, documento, texto, blob, metadatos) in crudos {
        let vector = blob_a_vector(&blob);
        if vector.len() != consulta.len() {
            continue;
        }
        let score = coseno(&consulta, &vector);
        resultados.push((
            score,
            json!({
                "id": id,
                "documento": documento,
                "texto": texto,
                "score": score,
                "metadatos": metadatos
                    .and_then(|m| serde_json::from_str::<Value>(&m).ok())
                    .unwrap_or_else(|| json!({}))
            }),
        ));
    }
    resultados.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    resultados.truncate(k);

    Ok(json!({
        "resultados": resultados.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        "k": k,
        "comparados": comparados
    }))
}

fn leer_vector(v: &Value) -> Result<Vec<f32>, String> {
    let arr = v.as_array().ok_or("el vector debe ser un arreglo de números")?;
    if arr.is_empty() || arr.len() > 4096 {
        return Err(format!("dimensión inválida: {} (1..4096)", arr.len()));
    }
    let mut out = Vec::with_capacity(arr.len());
    for x in arr {
        let n = x
            .as_f64()
            .ok_or_else(|| "el vector contiene un valor no numérico".to_string())?;
        if !n.is_finite() {
            return Err("el vector contiene NaN o infinito".into());
        }
        out.push(n as f32);
    }
    Ok(out)
}

fn vector_a_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

fn blob_a_vector(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn coseno(a: &[f32], b: &[f32]) -> f64 {
    let mut punto = 0.0f64;
    let mut na = 0.0f64;
    let mut nb = 0.0f64;
    for i in 0..a.len() {
        let x = a[i] as f64;
        let y = b[i] as f64;
        punto += x * y;
        na += x * x;
        nb += y * y;
    }
    if na <= 0.0 || nb <= 0.0 {
        0.0
    } else {
        punto / (na.sqrt() * nb.sqrt())
    }
}

// -------------------------------------------------------------- archivos

fn cap_analizar(entrada: &Value, data_dir: &Path, parametros: &Value) -> Result<Value, String> {
    let rel = entrada
        .get("ruta")
        .and_then(|v| v.as_str())
        .ok_or("falta entrada.ruta")?;
    let ruta = resolver(data_dir, rel)?;
    let meta = fs::metadata(&ruta).map_err(|e| format!("no se pudo leer {}: {}", rel, e))?;
    if !meta.is_file() {
        return Err(format!("{} no es un archivo", rel));
    }
    let max_bytes = parametros
        .get("maxBytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(64 * 1024 * 1024);
    if meta.len() > max_bytes {
        return Err(format!(
            "archivo demasiado grande: {} bytes (máximo {})",
            meta.len(),
            max_bytes
        ));
    }

    let mut cabeza = vec![0u8; 4096.min(meta.len().max(1) as usize)];
    let mut f = fs::File::open(&ruta).map_err(|e| e.to_string())?;
    let n = f.read(&mut cabeza).map_err(|e| e.to_string())?;
    cabeza.truncate(n);

    let tipo = clasificar(&ruta, &cabeza);
    let mut evidencia = vec![
        format!("tamaño: {} bytes", meta.len()),
        format!("magic: {}", hex(&cabeza[..n.min(16)])),
    ];

    let elf = if tipo == "elf" {
        let detalle = analizar_elf(&cabeza);
        if let Some(maquina) = detalle.get("maquina_nombre").and_then(|v| v.as_str()) {
            evidencia.push(format!("ELF para {}", maquina));
        }
        detalle
    } else {
        Value::Null
    };

    let max_cadenas = parametros
        .get("maxCadenas")
        .and_then(|v| v.as_u64())
        .unwrap_or(2000) as usize;
    let muestra = parametros
        .get("muestraCadenas")
        .and_then(|v| v.as_u64())
        .unwrap_or(12) as usize;
    let cadenas = extraer_cadenas(&ruta, 1024 * 1024, max_cadenas, muestra)
        .unwrap_or_else(|_| json!({ "total": 0, "muestra": [] }));

    Ok(json!({
        "ruta": rel,
        "tipo": tipo,
        "bytes": meta.len(),
        "elf": elf,
        "cadenas": cadenas,
        "evidencia": evidencia,
        "limites": [
            "Triage estático: no descompila, no desofusca y no ejecuta el archivo.",
            "Sólo se inspecciona el primer MiB para cadenas."
        ]
    }))
}

fn resolver(data_dir: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains("..") || rel.starts_with('/') || rel.contains('\\') {
        return Err("ruta inválida: debe ser relativa y sin '..'".into());
    }
    let base = data_dir
        .canonicalize()
        .map_err(|e| format!("no se pudo resolver el directorio de datos: {}", e))?;
    let destino = data_dir.join(rel);
    let canon = destino
        .canonicalize()
        .map_err(|e| format!("no existe {}: {}", rel, e))?;
    if !canon.starts_with(&base) {
        return Err("ruta fuera del directorio de datos".into());
    }
    Ok(canon)
}

fn clasificar(ruta: &Path, h: &[u8]) -> String {
    if h.starts_with(b"\x7fELF") {
        return "elf".into();
    }
    if h.starts_with(b"MZ") {
        return "pe".into();
    }
    if h.starts_with(b"PK\x03\x04") {
        // No se lee el archivo completo: 2 MiB alcanzan para ver si es una APK.
        let mut buf = vec![0u8; 2 * 1024 * 1024];
        if let Ok(mut f) = fs::File::open(ruta) {
            if let Ok(n) = f.read(&mut buf) {
                if buf[..n]
                    .windows(b"AndroidManifest.xml".len())
                    .any(|w| w == b"AndroidManifest.xml")
                {
                    return "apk".into();
                }
            }
        }
        return "zip".into();
    }
    if h.starts_with(b"GGUF") {
        return "gguf".into();
    }
    if h.starts_with(b"%PDF") {
        return "pdf".into();
    }

    let imprimibles = h.iter().filter(|b| es_imprimible(**b)).count();
    let ratio = if h.is_empty() {
        0.0
    } else {
        imprimibles as f64 / h.len() as f64
    };
    let texto = String::from_utf8_lossy(h);
    let recortado = texto.trim_start();
    if recortado.starts_with('{') || recortado.starts_with('[') {
        return "json".into();
    }
    if ratio > 0.85 {
        let muestra = &texto[..texto.len().min(4096)];
        if muestra.contains("function ")
            || muestra.contains("=>")
            || muestra.contains("const ")
            || muestra.contains("require(")
        {
            return "javascript".into();
        }
        return "texto".into();
    }
    "desconocido".into()
}

fn analizar_elf(h: &[u8]) -> Value {
    if h.len() < 20 {
        return Value::Null;
    }
    let clase = h[4];
    let datos = h[5];
    let little = datos == 1;
    let u16at = |o: usize| -> u16 {
        if little {
            u16::from_le_bytes([h[o], h[o + 1]])
        } else {
            u16::from_be_bytes([h[o], h[o + 1]])
        }
    };
    let e_type = u16at(16);
    let maquina = u16at(18);
    json!({
        "clase": if clase == 2 { "64" } else { "32" },
        "endianness": if little { "little" } else { "big" },
        "tipo": e_type,
        "maquina": maquina,
        "maquina_nombre": match maquina {
            0xB7 => "aarch64",
            0x28 => "arm",
            0x3E => "x86-64",
            0x03 => "x86",
            _ => "otra",
        },
        "pie": e_type == 3
    })
}

fn extraer_cadenas(
    ruta: &Path,
    limite: usize,
    max: usize,
    muestra: usize,
) -> Result<Value, String> {
    let mut f = fs::File::open(ruta).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; limite];
    let n = f.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);

    let mut total = 0usize;
    let mut muestra_vec: Vec<String> = Vec::new();
    let mut actual = String::new();

    for b in &buf {
        if es_imprimible(*b) {
            if actual.len() < 120 {
                actual.push(*b as char);
            }
        } else {
            if actual.len() >= 6 {
                total += 1;
                if muestra_vec.len() < muestra {
                    muestra_vec.push(actual.chars().take(80).collect());
                }
                if total >= max {
                    break;
                }
            }
            actual.clear();
        }
    }

    Ok(json!({ "total": total, "muestra": muestra_vec, "truncado": total >= max }))
}

fn es_imprimible(b: u8) -> bool {
    b == b'\n' || b == b'\r' || b == b'\t' || (32..=126).contains(&b)
}

fn hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}
