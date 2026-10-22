# Build de la APK en la nube

`apk.yml` es el workflow de GitHub Actions que compila FABRI-CORE (debug + release) y
publica la APK como artefacto y en las releases.

**Por qué está aquí y no en `.github/workflows/`**: el token de GitHub de este equipo es una
OAuth App **sin el scope `workflow`**, y GitHub rechaza el push de archivos de workflow con
ese token. Para activarlo:

```sh
# 1) con un token que sí tenga el scope (PAT fine-grained o OAuth App con workflow):
cp docs/ci/apk.yml .github/workflows/apk.yml
git add .github/workflows/apk.yml && git commit -m "ci: build de APK en la nube" && git push

# 2) o desde la UI de GitHub: Settings → Actions → New workflow → pegar el contenido
```

**La vía rápida**: la nube compila en ~3-5 min; el teléfono tarda 10-25 min (Gradle+Compose
en ARM, con el contenedor reiniciándose). La APK llega como artefacto de la workflow.
