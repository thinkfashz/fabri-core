// ============================================================================
//  FORGE CORE STOCK · validador de manifiestos (Fase 3)
//  ---------------------------------------------------------------------------
//  Un manifiesto es un JSON que declara cómo bajar e instalar un artefacto.
//  Este módulo NO descarga nada: sólo decide si el manifiesto es seguro y si
//  sus botones pueden habilitarse. Se usa desde el núcleo (JNI) y desde el
//  binario de pruebas `tools/validador`.
//
//  Reglas duras (si alguna falla, el manifiesto se rechaza completo):
//    · origen HTTPS (o file:// sólo si origen_tipo = "local")
//    · sha256 = 64 hex en minúscula
//    · tamano > 0 y <= 4 GiB
//    · > 50 MiB exige "autorizado": true escrito en el manifiesto
//    · tipo y arquitectura de una lista cerrada
//    · comando = array de argumentos, sin metacaracteres de shell
//    · campos desconocidos → error (no se ignoran)
// ============================================================================

use serde_json::{json, Value};

/// Tope sin autorización explícita del usuario (50 MiB).
pub const LIMITE_SIN_AUTORIZACION: u64 = 50 * 1024 * 1024;
/// Tope absoluto por artefacto (4 GiB): nada de este proyecto lo supera.
pub const LIMITE_ABSOLUTO: u64 = 4 * 1024 * 1024 * 1024;

const TIPOS: &[&str] = &["ejecutable", "modelo", "biblioteca", "plugin", "datos"];
const ARQUITECTURAS: &[&str] = &[
    "arm64-v8a",
    "aarch64",
    "agnostica-al-runtime",
    "agnostica",
];

/// Campos admitidos. Cualquier otro se considera error.
const CAMPOS: &[&str] = &[
    "id",
    "nombre",
    "tipo",
    "version",
    "descripcion",
    "origen",
    "origen_tipo",
    "sha256",
    "tamano",
    "licencia",
    "plataforma",
    "arquitectura",
    "min_android",
    "dependencias",
    "directorio",
    "comando",
    "interfaz",
    "salud",
    "actualizacion",
    "desinstalacion",
    "autorizado",
    "contenido_verificado",
    "estado",
];

const OBLIGATORIOS: &[&str] = &[
    "id",
    "nombre",
    "tipo",
    "version",
    "descripcion",
    "origen",
    "origen_tipo",
    "sha256",
    "licencia",
    "plataforma",
    "arquitectura",
    "directorio",
    "actualizacion",
    "desinstalacion",
];

/// Metacaracteres que jamás deben aparecer en un argumento de comando.
/// Si aparecen, alguien está intentando inyectar shell.
const PROHIBIDOS: &[char] = &[
    ';', '&', '|', '$', '`', '>', '<', '\n', '\r', '(', ')', '{', '}', '*', '?', '\\', '\'', '"',
];

fn texto_ok(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn es_id_valido(id: &str) -> bool {
    if id.is_empty() || id.len() > 64 {
        return false;
    }
    let mut chars = id.chars();
    let primero = chars.next().unwrap();
    if !primero.is_ascii_alphanumeric() {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '.')
}

fn es_sha256_valido(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn argumento_inseguro(arg: &str) -> Option<String> {
    if arg.trim().is_empty() {
        return Some("argumento vacío".into());
    }
    if arg.contains("..") {
        return Some(format!("argumento con '..': {}", arg));
    }
    if let Some(c) = arg.chars().find(|c| PROHIBIDOS.contains(c)) {
        return Some(format!("argumento con metacaracter '{}': {}", c, arg));
    }
    None
}

/// Valida un manifiesto y devuelve el veredicto con su habilitación.
///
/// Formato de salida:
/// ```json
/// { "valido": bool, "errores": ["..."], "habilitacion": { "descargar": bool, "motivos": [] } }
/// ```
pub fn validar(m: &Value) -> Value {
    let mut errores: Vec<String> = Vec::new();
    let obj = match m.as_object() {
        Some(o) => o,
        None => {
            return json!({
                "valido": false,
                "errores": ["el manifiesto debe ser un objeto JSON"],
                "habilitacion": { "descargar": false, "motivos": ["manifiesto inválido"] }
            })
        }
    };

    // 1. Campos desconocidos.
    for clave in obj.keys() {
        if !CAMPOS.contains(&clave.as_str()) {
            errores.push(format!("campo desconocido: {}", clave));
        }
    }

    // 2. Campos obligatorios.
    for campo in OBLIGATORIOS {
        if texto_ok(obj.get(*campo)).is_none() {
            errores.push(format!("falta o está vacío: {}", campo));
        }
    }

    // 3. Identificador.
    if let Some(id) = texto_ok(obj.get("id")) {
        if !es_id_valido(&id) {
            errores.push(format!(
                "id inválido '{}': sólo minúsculas, dígitos, '-', '_' y '.', empezando por letra o dígito",
                id
            ));
        }
    }

    // 4. Tipo y arquitectura cerrados.
    if let Some(tipo) = texto_ok(obj.get("tipo")) {
        if !TIPOS.contains(&tipo.as_str()) {
            errores.push(format!("tipo desconocido: {} (admitidos: {:?})", tipo, TIPOS));
        }
    }
    if let Some(arq) = texto_ok(obj.get("arquitectura")) {
        if !ARQUITECTURAS.contains(&arq.as_str()) {
            errores.push(format!(
                "arquitectura desconocida: {} (admitidas: {:?})",
                arq, ARQUITECTURAS
            ));
        }
    }

    // 5. Origen: HTTPS obligatorio; file:// sólo para artefactos locales.
    if let Some(origen) = texto_ok(obj.get("origen")) {
        let tipo_origen = texto_ok(obj.get("origen_tipo")).unwrap_or_default();
        let ok = if tipo_origen == "local" {
            origen.starts_with("file://")
        } else {
            origen.starts_with("https://")
        };
        if !ok {
            errores.push(format!(
                "origen rechazado: {} (se exige https://, o file:// con origen_tipo=local)",
                origen
            ));
        }
    }

    // 6. Integridad.
    if let Some(sha) = texto_ok(obj.get("sha256")) {
        if !es_sha256_valido(&sha) {
            errores.push("sha256 inválido: se exigen 64 hex en minúscula".into());
        }
    }

    // 7. Tamaño y autorización.
    match obj.get("tamano").and_then(|v| v.as_u64()) {
        Some(0) => errores.push("tamano inválido: debe ser mayor que 0".into()),
        Some(t) if t > LIMITE_ABSOLUTO => {
            errores.push(format!("tamano excede el tope absoluto de 4 GiB: {} B", t))
        }
        Some(t) if t > LIMITE_SIN_AUTORIZACION && obj.get("autorizado") != Some(&json!(true)) => {
            errores.push(format!(
                "tamano {} B supera 50 MiB y el manifiesto no declara \"autorizado\": true",
                t
            ));
        }
        Some(_) => {}
        None => errores.push("tamano inválido: falta o no es entero positivo".into()),
    }

    // 8. Comando: sólo ejecutables, siempre como array de argumentos.
    let tipo = texto_ok(obj.get("tipo")).unwrap_or_default();
    match obj.get("comando") {
        Some(Value::Null) => {
            // Un null explícito equivale a "no declarado": sólo vale si no es ejecutable.
            if tipo == "ejecutable" {
                errores.push("falta comando: un ejecutable no puede instalarse sin comando".into());
            }
        }
        Some(Value::Array(args)) if !args.is_empty() => {
            if tipo != "ejecutable" {
                errores.push("comando sólo se admite cuando tipo = ejecutable".into());
            }
            for (i, a) in args.iter().enumerate() {
                match a.as_str() {
                    Some(s) => {
                        if let Some(motivo) = argumento_inseguro(s) {
                            errores.push(format!("comando[{}] rechazado: {}", i, motivo));
                        }
                    }
                    None => errores.push(format!("comando[{}] no es texto", i)),
                }
            }
            if let Some(primero) = args.first().and_then(|v| v.as_str()) {
                if primero.starts_with('/') {
                    errores.push(
                        "comando[0] no puede ser ruta absoluta: debe resolverse dentro del componente"
                            .into(),
                    );
                }
            }
        }
        Some(_) => {
            if tipo == "ejecutable" {
                errores.push("comando inválido: se exige array de argumentos no vacío".into());
            } else {
                errores.push("comando inválido: debe ser array de texto".into());
            }
        }
        None => {
            if tipo == "ejecutable" {
                errores.push("falta comando: un ejecutable no puede instalarse sin comando".into());
            }
        }
    }

    // 9. Dependencias: ids válidos.
    if let Some(deps) = obj.get("dependencias") {
        match deps.as_array() {
            Some(lista) => {
                for d in lista {
                    match d.as_str() {
                        Some(s) if es_id_valido(s) => {}
                        _ => errores.push(format!("dependencia inválida: {}", d)),
                    }
                }
            }
            None => errores.push("dependencias debe ser un array".into()),
        }
    }

    // 10. Habilitación de botones (informativa; nunca reemplaza la verificación real).
    let mut motivos: Vec<String> = Vec::new();
    if !errores.is_empty() {
        motivos.push("el manifiesto no es válido".into());
    }
    if obj.get("contenido_verificado") != Some(&json!(true)) {
        motivos.push("el contenido del artefacto no fue verificado todavía".into());
    }
    if texto_ok(obj.get("salud")).is_none() {
        motivos.push("no declara comprobación de salud".into());
    }
    if tipo == "ejecutable" && obj.get("comando").is_none() {
        motivos.push("no declara comando de ejecución".into());
    }

    json!({
        "valido": errores.is_empty(),
        "errores": errores,
        "habilitacion": {
            "descargar": errores.is_empty(),
            "instalar": errores.is_empty() && obj.get("contenido_verificado") == Some(&json!(true)),
            "probar": errores.is_empty()
                && obj.get("contenido_verificado") == Some(&json!(true))
                && texto_ok(obj.get("salud")).is_some(),
            "motivos": motivos
        }
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn base() -> Value {
        json!({
            "id": "runtime-prueba",
            "nombre": "Runtime de prueba",
            "tipo": "ejecutable",
            "version": "1.0.0",
            "descripcion": "artefacto de prueba",
            "origen": "https://example.org/a.tar.gz",
            "origen_tipo": "github-release",
            "sha256": "a".repeat(64),
            "tamano": 1024,
            "licencia": "MIT",
            "plataforma": "android",
            "arquitectura": "arm64-v8a",
            "directorio": "filesDir/componentes/runtime-prueba/",
            "comando": ["bin/run", "--version"],
            "salud": "ejecutar --version",
            "actualizacion": "manual",
            "desinstalacion": "borrar el directorio",
            "contenido_verificado": true
        })
    }

    #[test]
    fn acepta_manifiesto_valido() {
        let r = validar(&base());
        assert_eq!(r["valido"], json!(true), "{:?}", r["errores"]);
        assert_eq!(r["habilitacion"]["probar"], json!(true));
    }

    #[test]
    fn rechaza_hash_en_mayusculas() {
        let mut m = base();
        m["sha256"] = json!("A".repeat(64));
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        assert!(r["errores"].to_string().contains("sha256"));
    }

    #[test]
    fn rechaza_http_sin_tls() {
        let mut m = base();
        m["origen"] = json!("http://example.org/a.tar.gz");
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        assert!(r["errores"].to_string().contains("origen"));
    }

    #[test]
    fn rechaza_shell_en_comando() {
        for malo in ["sh", "bin/run;id", "bin/run$(id)", "bin/run && id", "bin/../../etc/passwd"] {
            let mut m = base();
            m["comando"] = json!([malo]);
            let r = validar(&m);
            assert_eq!(r["valido"], json!(false), "debió rechazar: {}", malo);
        }
    }

    #[test]
    fn rechaza_comando_absoluto() {
        let mut m = base();
        m["comando"] = json!(["/system/bin/sh", "-c", "id"]);
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
    }

    #[test]
    fn rechaza_campo_desconocido() {
        let mut m = base();
        m["shell"] = json!("rm -rf /");
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        assert!(r["errores"].to_string().contains("desconocido"));
    }

    #[test]
    fn rechaza_tamano_grande_sin_autorizacion() {
        let mut m = base();
        m["tamano"] = json!(60u64 * 1024 * 1024);
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        m["autorizado"] = json!(true);
        assert_eq!(validar(&m)["valido"], json!(true));
    }

    #[test]
    fn rechaza_tipo_y_arquitectura_desconocidos() {
        let mut m = base();
        m["tipo"] = json!("binario");
        m["arquitectura"] = json!("x86");
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        let txt = r["errores"].to_string();
        assert!(txt.contains("tipo desconocido"));
        assert!(txt.contains("arquitectura desconocida"));
    }

    #[test]
    fn rechaza_ejecutable_sin_comando() {
        let mut m = base();
        m.as_object_mut().unwrap().remove("comando");
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        assert!(r["errores"].to_string().contains("falta comando"));
    }

    #[test]
    fn rechaza_modelo_con_comando() {
        let mut m = base();
        m["tipo"] = json!("modelo");
        m["arquitectura"] = json!("agnostica-al-runtime");
        let r = validar(&m);
        assert_eq!(r["valido"], json!(false));
        assert!(r["errores"].to_string().contains("sólo se admite"));
    }

    #[test]
    fn rechaza_tamano_cero_y_ausente() {
        let mut m = base();
        m["tamano"] = json!(0);
        assert_eq!(validar(&m)["valido"], json!(false));
        m.as_object_mut().unwrap().remove("tamano");
        assert_eq!(validar(&m)["valido"], json!(false));
    }

    #[test]
    fn no_habilita_sin_salud_ni_verificacion() {
        let mut m = base();
        m.as_object_mut().unwrap().remove("salud");
        m["contenido_verificado"] = json!(false);
        let r = validar(&m);
        assert_eq!(r["valido"], json!(true));
        assert_eq!(r["habilitacion"]["descargar"], json!(true));
        assert_eq!(r["habilitacion"]["probar"], json!(false));
    }
}
