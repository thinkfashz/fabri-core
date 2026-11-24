# Conexión de la APK con la tienda

La APK **lite** (`fast/lite/`) se conecta a una tienda con la **misma clave de 8
caracteres** que genera el panel del negocio. No hay token de plataforma ni una
segunda llave: el puente es `/api/inventario`, multi-inquilino por `local_id`.

## 1 · Dónde se obtiene la clave

1. El dueño crea la tienda en `/app/` (pestaña **Negocio**) o en el panel.
2. En `/panel/negocio/conexion/` ve el estado, prueba la clave y puede **generar
   una nueva** (se muestra una sola vez).
3. La clave se guarda sólo como `SHA-256` en `mercado_locales.clave_hash`.

## 2 · Qué hace la pestaña «Tienda» de la APK

| Acción | Llamada | Qué pasa |
|---|---|---|
| Conectar y probar | `POST /api/inventario { accion: "verificar" }` | valida `local_id` + `clave` y guarda la credencial **cifrada** con el Keystore |
| Probar | `verificar` | comprueba el enlace sin tocar el catálogo |
| Ver estado | `estado` | devuelve tienda, productos en la nube, dispositivos y fallos |
| Subir catálogo | `subir` | manda la tabla local `products` en lotes de 200 |
| Bajar catálogo | `bajar` | guarda el catálogo de la nube en SQLite (upsert por `sku`) |
| Cambiar de tienda | — | olvida la credencial y conserva el catálogo local |

Cada llamada envía `huella` (Android ID), `etiqueta` (marca y modelo),
`plataforma: "android"` y `version`. Así el panel muestra **dispositivos reales**
con su última conexión, sin inventar una lista.

Si una llamada falla, la APK la reporta con `accion: "error"` y el panel la
muestra en «Fallos recientes». La clave nunca se escribe en claro ni se registra
en logs; se cifra con `Sec` (AES-256-GCM, clave del Android Keystore).

Archivos: `fast/lite/Shop.kt` (puente), `fast/lite/Db.kt` (`kv*`,
`productUpsert`), `fast/lite/MainActivity.kt` (pantalla «Tienda»).

## 3 · Compilar rápido (sin Gradle)

El build lite no levanta daemon ni resuelve dependencias. En este equipo tarda
~4 minutos y deja la APK firmada:

```sh
bash build-fast.sh
# APK: out/forge-core-stock-lite.apk
```

Si el SDK no está en `/root/android-sdk`, el script lo busca en
`/data/data/com.termux/files/home/android-sdk` y en `$HOME/android-sdk`. Para
forzarlo:

```sh
ANDROID_SDK_ROOT=/ruta/al/sdk bash build-fast.sh
```

Pipeline: `aapt2` (recursos) → `kotlinc` embebido → `d8` → `zip/zipalign` →
`apksigner` con el keystore de debug. `fast/out/` y `fast/lib/` son artefactos:
están ignorados por git y se regeneran solos.

Verificación rápida de la APK:

```sh
unzip -l out/forge-core-stock-lite.apk | tail
$ANDROID_SDK_ROOT/build-tools/34.0.0/apksigner verify --print-certs out/forge-core-stock-lite.apk
```

## 4 · Contrato del puente (resumen)

```http
POST https://fabri-api.vercel.app/api/inventario
{ "accion": "verificar", "local_id": "mi-tienda", "clave": "ABCD1234" }
→ { "ok": true, "conexion": { "tienda": "Mi tienda", "productos": 12, ... } }
```

Acciones: `verificar`, `estado`, `error`, `desconectar`, `subir`, `bajar`,
`buscar`, `borrar`, `subir_boletas`, `resumen`, `respaldo`.

- `subir` y `bajar` son idempotentes por `(local_id, codigo)`.
- `estado` y `subir` registran el dispositivo; `verificar` no.
- Nada devuelve la clave, su hash, el correo del dueño ni el teléfono completo.

## 5 · Pendiente del lado Android

La pantalla ya existe y compila. Falta probarla en un teléfono con una tienda
real (el build no se puede ejecutar en este entorno). El panel
`/panel/negocio/conexion/` sirve para comprobar, desde el navegador, que el
dispositivo aparece y que el catálogo subió.
