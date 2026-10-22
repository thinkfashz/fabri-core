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

## Estado real de GitHub Actions (22-10-2026)

El workflow **arranca pero no corre**:

```
The job was not started because your account is locked due to a billing issue.
```

No es el YAML (un workflow mínimo falla igual, y en un repo público el runner sí
responde): es la **cuenta** de GitHub. Se arregla en la web, una sola vez:

1. <https://github.com/settings/billing> → revisar pago pendiente / añadir método.
2. Volver a **Actions → APK → Run workflow**.

Mientras eso no esté resuelto, la vía que funciona es la local:
`bash build-fast.sh` (~4 min, APK firmada en `out/`).
