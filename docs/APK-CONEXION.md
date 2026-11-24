# Conexión de la APK con la tienda

La APK **FORGE CORE STOCK 1.2.0** (`fast/lite/`) se conecta a una tienda con la
**misma clave de 8 caracteres** que genera el panel del negocio. No hay token de plataforma ni una
segunda llave: el puente es `/api/inventario`, multi-inquilino por `local_id`.

## 1 · Dónde se obtiene la clave

1. El dueño crea la tienda en `/app/` (pestaña **Negocio**) o en el panel.
2. En `/panel/negocio/conexion/` ve el estado, prueba la clave y puede **generar
   una nueva** (se muestra una sola vez).
3. La clave se guarda sólo como `SHA-256` en `mercado_locales.clave_hash`.

## 2 · Pestañas de la app (simplificada)

`Inicio · Tienda · Productos · Clientes · Ajustes`

- **Inicio:** estado de la tienda, última sincronización, productos, clientes y
  fallos; accesos directos a las otras pestañas.
- **Tienda:** conectar, probar, crear tablas, subir/bajar catálogo, estado en la
  nube (publicada, plan, dispositivos, fallos) y fallos locales con su motivo.
- **Productos:** catálogo publicado (`local_ver`), edición de nombre, precio y
  stock con `productos_subir` + clave, y alta de producto nuevo.
- **Clientes:** CRM real desde `clientes_listar` (teléfono enmascarado).
- **Ajustes:** cuenta local, exportar, versión 1.2.0.

## 3 · Qué hace la pestaña «Tienda»

| Acción | Llamada | Qué pasa |
|---|---|---|
| Conectar y probar | `POST /api/inventario { accion: "verificar" }` | valida `local_id` + `clave` y guarda la credencial **cifrada** con el Keystore |
| Probar | `verificar` | comprueba el enlace sin tocar el catálogo |
| Ver estado | `estado` | devuelve tienda, productos en la nube, dispositivos y fallos |
| Subir catálogo | `subir` | manda la tabla local `products` en lotes de 200 |
| Bajar catálogo | `bajar` | guarda el catálogo de la nube en SQLite (upsert por `sku`) |
| Asegurar tablas | `asegurar` (inventario + mercado) | crea las tablas que falten en la nube |
| Estado en la nube | `conexion_estado` | publicada, plan, productos, dispositivos y fallos |
| Cambiar de tienda | — | olvida la credencial y conserva el catálogo local |

Cada llamada envía `huella` (Android ID), `etiqueta` (marca y modelo),
`plataforma: "android"` y `version`. Así el panel muestra **dispositivos reales**
con su última conexión, sin inventar una lista.

Si una llamada falla, la APK la reporta con `accion: "error"` y el panel la
muestra en «Fallos recientes». La clave nunca se escribe en claro ni se registra
en logs; se cifra con `Sec` (AES-256-GCM, clave del Android Keystore).

Archivos: `fast/lite/Shop.kt` (puente), `fast/lite/Db.kt` (tablas
`shop_catalogo`, `shop_clientes`, `shop_sync`, `shop_fallos` + helpers),
`fast/lite/MainActivity.kt` (pestañas).

**Tablas locales (SQLite, versión 4):** `products` (base de trabajo) y
`shop_catalogo`, `shop_clientes`, `shop_sync`, `shop_fallos` (espejo de la
nube). **Tablas en la nube:** `inv_productos`, `inv_conexiones` (creadas por
`/api/inventario`) y `mercado_locales`/`mercado_productos` (por `/api/mercado`).
La APK llama `asegurar` en ambos endpoints al conectar.

## 3 · Compilar rápido (sin Gradle)

El build lite no levanta daemon ni resuelve dependencias. En este equipo tarda
~4 minutos y deja la APK firmada:

```sh
bash build-fast.sh
# APK: out/FORGE-CORE-STOCK-1.2.0.apk  (~4 min, firmada)
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

## 4 · Entrega

- Copia local fuera del proot: `/sdcard/Download/FORGE-CORE-STOCK-1.2.0.apk`
- Descarga pública: `https://forge-core-stock.vercel.app/descargas/FORGE-CORE-STOCK.apk`
  (el mismo archivo, con nombre versionado al descargar)

## 5 · Contrato del puente (resumen)

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

## 6 · Pendiente del lado Android

La pantalla ya existe y compila. Falta probarla en un teléfono con una tienda
real (el build no se puede ejecutar en este entorno). El panel
`/panel/negocio/conexion/` sirve para comprobar, desde el navegador, que el
dispositivo aparece y que el catálogo subió.
