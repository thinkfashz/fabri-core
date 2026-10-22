# Compilación en la nube

La APK se compila en **GitHub Actions** (`.github/workflows/apk.yml`), en dos variantes:

| Job | Qué compila | Cuándo |
|---|---|---|
| `apk-lite` | pipeline sin Gradle (`build-fast.sh`): aapt2 + kotlinc + d8 + apksigner | siempre; ~2 min |
| `apk-full` | app Kotlin + Compose completa con Gradle 8.9 / AGP 8.7.3 | siempre; no bloquea |

La APK lite queda como artefacto de la ejecución y, si el push es un tag `v*`, se adjunta
a la release. También se puede lanzar a mano: **Actions → APK → Run workflow**.

## Por qué no se compila en el teléfono

`python/proot` + Gradle = fase de configuración de 20+ minutos y el daemon muere cuando
el contenedor se reinicia (cada pocos minutos). Además, los binarios del SDK en
`/root/android-sdk` son **x86-64** y no corren en ARM.

La vía local existe igual (`bash build-fast.sh`, ~4 min) usando las herramientas ARM de
Termux y el compilador Kotlin de la caché de Gradle. El script detecta la plataforma.
