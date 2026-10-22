# Dependencias locales del build Java

Todo corre **en el teléfono** (Termux + este proot Ubuntu). No hay Gradle, ni Android
Studio, ni Kotlin, ni librerías externas: la app usa **solo el SDK de Android**.

## Herramientas (verificadas en este dispositivo)

| Herramienta | Ruta | Versión | Paquete Termux | Para qué |
|---|---|---|---|---|
| `javac` | `/data/data/com.termux/files/usr/bin/javac` | 21.0.13 | `openjdk-21` | compilar `.java` → `.class` |
| `keytool` | idem | 21.0.13 | `openjdk-21` | generar el keystore de debug |
| `aapt2` | idem | 2.20-android-16 | `aapt2` | manifest + recursos → `base.apk` |
| `d8` | idem | 9.2.4 | `d8` | `.class` → `classes.dex` |
| `apksigner` | idem | 0.9 | `apksigner` | firma v1+v2+v3 |
| `zipalign` | idem | — | `aapt` | alinear el APK |
| `zip` | idem | — | `zip` | meter el `classes.dex` en el APK |

Plataforma: `/root/android-sdk/platforms/android-34/android.jar` (solo se usa como
`-cp`/`--lib`; no se necesita `build-tools` del SDK porque son x86-64).

## Reinstalar en Termux (fuera del proot)

```sh
pkg install openjdk-21 aapt2 d8 apksigner aapt zip
```

`zipalign` viene dentro del paquete `aapt`.

## Comprobar sin compilar

```sh
bash /root/fabri-core/build-java.sh --check
```

Devuelve `0` si está todo y lista lo que falta.

## Lo que NO hace falta

- `kotlinc` (el build es Java puro)
- Gradle / Android Studio
- `androidx.*` / AppCompat / Material Components
- `build-tools` del SDK (x86-64: no ejecuta en ARM)
- Recursos propios: el tema y el icono son de plataforma, así que se salta `aapt2 compile`

## Tiempos de referencia (medidos aquí)

| Paso | Descargado | Cargado |
|---|---|---|
| aapt2 link | 8 s | 10 s |
| javac (6 clases) | 28 s | 40 s |
| d8 | 28 s | 94 s |
| zip + zipalign | 1 s | 3 s |
| apksigner | 22 s | 50 s |
| **Total** | **88 s** | **207 s** |

## Instalar la APK resultante

Android **no permite** `pm install` desde Termux ni desde el proot (el uid de la app no
es `shell`: `SecurityException ... uid u0a643`). Vías válidas:

1. El APK se copia a `/sdcard/Download/` y se toca desde el gestor de archivos
   (el sistema abre el instalador y pide confirmación).
2. `adb install -r` desde un PC con depuración USB.

El paquete `cl.fabri.core.j` es distinto de `cl.fabri.core.lite`: conviven sin conflicto.
