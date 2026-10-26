# api-telefono — la puerta HTTPS de la APK (fabri-api)

Este directorio es la **copia versionada** del código que se despliega en
`https://fabri-api.vercel.app`, el proyecto de Vercel que usa la APK FABRI-CORE.

> El despliegue real se hace desde el proyecto local del teléfono
> (`/data/data/com.termux/files/home/fabrick-core`), que es donde vive la APK.
> Esta copia existe para que el código quede respaldado en GitHub y cualquiera
> pueda auditar la puerta de entrada.

## Endpoints

| Ruta | Método | Token | Qué hace |
|---|---|---|---|
| `/api/think` | POST | sí | responde con contexto de Postgres (InsForge) |
| `/api/sync` | POST | sí | sube/baja filas de una tabla |
| `/api/stats` | GET | sí | estado de la base |
| `/api/webhook` | POST | sí | recibe eventos de agentes |
| `/api/diagnostico` | GET/POST | sí | informe real + malla de las 4 capas |
| `/api/modelos` | GET | sí | catálogo de modelos locales/remotos |
| `/api/memoria` | GET | sí | estado de la memoria |
| `/api/skills` | POST | sí | lista/acciona skills |
| `/api/health` | GET | **no** | salud barata (contrato común) |
| `/api/estado` | GET | **no** | malla de las 4 capas |
| `/api/inventario` | GET/POST | sí¹ | inventario compartido con la APK y la web |

¹ `POST { accion: "asegurar" }` no exige token: sólo ejecuta un
`CREATE TABLE IF NOT EXISTS` con columnas fijas, sin datos del cliente y sin
`DROP`. `subir`, `bajar`, `borrar` y `resumen` sí exigen
`Authorization: Bearer FABRI_API_TOKEN`. `GET /api/inventario?diag=1` es público
y sólo informa si la tabla existe.

## Variables de entorno

| Nombre | Para qué |
|---|---|
| `FABRI_API_TOKEN` | token que lleva la APK en `Authorization: Bearer` |
| `INSFORGE_DATABASE_URL` | Postgres donde viven memoria, sync y stats |

Sin `FABRI_API_TOKEN` los endpoints protegidos responden **401**; sin
`INSFORGE_DATABASE_URL` responden con `error_db` explícito, nunca con datos
inventados.

## Despliegue

```sh
cd api-telefono
vercel link --yes --project fabri-api
vercel --prod --yes
```

El `vercel.json` enruta **los diez** endpoints. Antes solo enrutaba cuatro y los
otros seis devolvían 404 aunque el código existía.

## Verificación

```sh
curl -4 -s https://fabri-api.vercel.app/api/health | jq .
curl -4 -s https://fabri-api.vercel.app/api/estado | jq .resumen
curl -4 -s -o /dev/null -w '%{http_code}\n' https://fabri-api.vercel.app/api/diagnostico  # 401
```
