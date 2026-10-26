# ECOSISTEMA FABRICK — lógica, capas y estado real

> Documento maestro del ecosistema que sostiene **FABRI-CORE**.
> Actualizado: **2026-10-26** · Autor: Fabrick / Soluciones Fabrick.
> Este archivo es la fuente única de verdad de la arquitectura en la nube.
> Si algo no está aquí, no está verificado.

---

## 1. Qué es esto en una frase

**FABRI-CORE es una consola de operador con IA local-first para Android**, y este
ecosistema es lo que la rodea: una **API** que autentica y sincroniza al teléfono,
un **cerebro** que rota modelos y recuerda, una **capa de nube** que pone la voz y
el panel, y una **capa web** que publica el producto y la PWA.

El principio que ordena todo:

> **Los agentes viven en el teléfono. La nube solo hace lo que el teléfono no debe hacer.**

Eso significa: la inferencia local, la base SQLite, el inventario y las boletas
ocurren en el dispositivo. La nube aporta lo que cuesta RAM o requiere estar
siempre encendido: TTS, memoria compartida, rotación de modelos y la puerta HTTPS
para cuando el teléfono tiene red.

---

## 2. Mapa de capas

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TELÉFONO (Android · proot Ubuntu)                                            │
│                                                                              │
│  APK FABRI-CORE 0.9.11   Rust + JNI + WebView + SQLite                       │
│    · inventario, precios, márgenes, boletas, RAG, GraphRAG                   │
│    · PIN PBKDF2 + huella (Keystore)                                          │
│    · runtime llama.cpp para GGUF                                             │
│    · Conexiones: URL + token de la API                                       │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ HTTPS + Bearer FABRI_API_TOKEN
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. API DEL TELÉFONO — fabri-api                                              │
│    https://fabri-api.vercel.app          Vercel · Node · Postgres (InsForge) │
│    /api/think  /api/sync  /api/stats  /api/diagnostico  /api/modelos         │
│    /api/memoria  /api/skills  /api/webhook  /api/health  /api/estado         │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ health + estado
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. CEREBRO — fabrick-tg-bot                                                  │
│    https://fabrick-tg-bot.vercel.app     Vercel · Node                       │
│    · model-rotator: 15 capas, 12 utilizables hoy                             │
│    · persona chilena + memoria (Postgres/InsForge/Supermemory)               │
│    · /api/talk (voz)  /api/tg (Telegram)  /api/stt  /api/voz  /api/web       │
│    · /api/health  /api/estado  /api/bridge                                   │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ TTS / cola / memoria
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. NUBE Y VOZ — fabrick-cloud                                                │
│    https://fabrick-cloud.faubricioedms.workers.dev   Cloudflare Worker       │
│    · MeloTTS (Workers AI) · KV cache · cola de tareas                        │
│    · /api/panel  /api/uso  /api/voz  /api/local  /api/tareas                 │
│    · /api/health  /api/malla  /api/estado                                    │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. WEB Y PWA — fabri-core-web                                                │
│    https://fabri-core-web.vercel.app     Vercel · Go 1.22                    │
│    · landing del producto + malla en vivo                                    │
│    · /app/ PWA con SQLite WASM                                               │
│    · /api/health  /api/estado  /api/agent  /api/auth  /api/sync              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Repositorios

| Repo | Qué es | Visibilidad | Rama |
|---|---|---|---|
| `thinkfashz/fabri-core` | Landing + PWA (Kotlin/Go) y documentación del producto | público | `master` |
| `thinkfashz/fabrick-cloud` | Worker de Cloudflare: panel + MeloTTS | privado | `master` |
| `thinkfashz/fabrick-tg-bot` | Cerebro: rotador, persona, memoria, Telegram, figura 3D | privado | `main` |

> **Aclaración importante:** el APK que usa el usuario se compila desde el
> proyecto **local** `/data/data/com.termux/files/home/fabrick-core` (Rust/JNI),
> que es distinto del repo público `fabri-core` (Kotlin/Go/PWA). La API
> `fabri-api` se despliega desde ese proyecto local. El repo público es la cara
> del producto; el proyecto local es la app real.

---

## 3. Los cuatro servicios, con estado verificado

| # | Servicio | URL | Runtime | Estado 2026-10-26 |
|---|---|---|---|---|
| 1 | API del teléfono | `https://fabri-api.vercel.app` | Node (`api/*.ts`) | **arriba** · v1.1.0 |
| 2 | Cerebro | `https://fabrick-tg-bot.vercel.app` | Node (`api/*.js`) | **arriba** · v1.1.0 |
| 3 | Nube y voz | `https://fabrick-cloud.faubricioedms.workers.dev` | Cloudflare Worker | **arriba** (código v1.2.0 pendiente de deploy) |
| 4 | Web y PWA | `https://fabri-core-web.vercel.app` | Go 1.22 | **arriba** · v1.1.0 |

Comprobación rápida:

```sh
curl -4 -s https://fabri-api.vercel.app/api/estado | jq .resumen
curl -4 -s https://fabrick-tg-bot.vercel.app/api/estado | jq .resumen
curl -4 -s https://fabri-core-web.vercel.app/api/estado | jq .resumen
curl -4 -s https://fabrick-cloud.faubricioedms.workers.dev/api/health | jq .
```

Resultado medido al cerrar esta sesión: **4 de 4 capas arriba**, latencias entre
**31 ms y 430 ms** desde la red del teléfono.

---

## 4. Contrato común: salud y malla

Este es el pegamento del ecosistema. Las cuatro capas hablan el mismo idioma.

### 4.1 `/api/health` — salud propia, barata

Reglas:

- Responde en milisegundos. **No consulta la base ni llama modelos.**
- No expone valores de entorno: solo si están presentes.
- Nunca devuelve `ok: true` si una dependencia crítica falta.

```json
{
  "ok": true,
  "servicio": "fabri-api",
  "capa": "api",
  "version": "1.1.0",
  "hora": "2026-10-26T01:42:45.445Z",
  "dependencias": [
    { "nombre": "FABRI_API_TOKEN", "ok": true, "detalle": "token de la app configurado", "critica": true },
    { "nombre": "INSFORGE_DATABASE_URL", "ok": true, "detalle": "base Postgres enlazada", "critica": true }
  ],
  "resumen": { "dependencias": 2, "listas": 2 }
}
```

Cada capa añade extras propios sin romper el contrato:

| Capa | Extras |
|---|---|
| `fabri-api` | `telefono` (URL, token configurado, endpoints) |
| `fabrick-tg-bot` | `modelos` (capas/utilizables), `persona` |
| `fabrick-cloud` | `tieneCache`, `tieneSuperbrainKey`, `cola` |
| `fabri-core-web` | `agent`, `cloud`, `runtime` |

### 4.2 `/api/estado` (o `/api/malla`) — malla de las cuatro capas

Cada capa sondea el `/api/health` de las otras con **tope de 5 s**. Una caída no
arrastra al resto.

```json
{
  "ok": true,
  "servicio": "fabrick-tg-bot",
  "capa": "cerebro",
  "version": "1.1.0",
  "hora": "2026-10-26T01:44:09.229Z",
  "capas": [
    {
      "id": "api",
      "nombre": "API del teléfono",
      "rol": "puerta de la APK",
      "url": "https://fabri-api.vercel.app",
      "ok": true,
      "estado": "arriba",
      "ms": 93,
      "http": 200,
      "detalle": "v1.1.0",
      "servicio": "fabri-api",
      "version": "1.1.0"
    }
  ],
  "resumen": {
    "capas": 4,
    "arriba": 4,
    "degradadas": 0,
    "caidas": 0,
    "latenciaMaxMs": 429
  }
}
```

Estados posibles: `arriba`, `degradada` (respondió con error), `caida` (no respondió
o timeout). **Nunca se inventa un `ok`.**

### 4.3 Por qué no hay recursión

`/api/estado` solo llama a `/api/health`. `/api/health` no llama a nadie. La malla
es siempre de un salto, aunque las cuatro capas expongan el mismo agregador.

---

## 5. Flujo real de una petición

### 5.1 Chat desde el teléfono

```
APK → Conexiones (URL + FABRI_API_TOKEN)
    → POST https://fabri-api.vercel.app/api/think   { texto, contexto, usuario_id }
    → Postgres (InsForge): búsqueda de contexto
    → respuesta con fuente, confianza y origen
    → la APK guarda la respuesta en SQLite con procedencia
```

Si no hay red o no hay token, la APK **no simula**: responde con el error exacto y
ofrece el modo local (GGUF cargado en el dispositivo).

### 5.2 Voz

```
APK / navegador → POST /api/talk (cerebro)
    → model-rotator elige la capa más rápida disponible (Groq primero)
    → si hay que hablar: POST https://fabrick-cloud.../api/voz
    → MeloTTS devuelve WAV (se detecta el tipo real, no el declarado)
    → el audio se reproduce; el teléfono no ejecuta TTS
```

### 5.3 Telegram

```
Telegram → POST /api/tg (webhook, secreto TG_WEBHOOK_SECRET)
    → responde 200 al instante
    → waitUntil: persona + memoria + rotador
    → sendMessage al chat configurado
```

El puente `/api/bridge` comprueba **de verdad** las cinco conexiones: Telegram,
cerebro, voz, API del teléfono y Hermex local. Antes decía «todo conectado»
aunque la APK no pudiera autenticarse.

### 5.4 Panel de la nube

```
Navegador → GET / (Worker) → UI
    → GET /api/panel?period=7d   (supermemory + reporte local)
    → GET /api/uso               (neuronas MeloTTS del día)
    → GET /api/malla             (estado de las 4 capas)
```

El agente local publica su memoria con `POST /api/local`; el Worker solo la lee.
**No hay filesystem en la nube y el dispositivo sigue siendo el dueño del dato.**

---

## 6. Qué se cambió en esta sesión

### 6.1 `fabri-api` (API del teléfono) — local → Vercel

| Archivo | Cambio |
|---|---|
| `vercel.json` | **Bug real corregido:** solo enrutaba 4 endpoints. `/api/diagnostico`, `/api/modelos`, `/api/memoria` y `/api/skills` devolvían **404** aunque el código existía. Ahora están los 10. |
| `api/health.ts` | Nuevo. Salud pública, sin token, sin tocar la base. |
| `api/estado.ts` | Nuevo. Malla de las 4 capas. |
| `api/diagnostico.ts` | Versión de APK 0.9.1 → **0.9.10** y bloque `malla` con latencias reales. |
| `.vercelignore` | Evita subir 975 MB (APK, Rust, assets) al deploy. |

> Este era el eslabón más roto: el teléfono llamaba a `/api/diagnostico` y recibía
> un 404 de Vercel, no un error de la app. Ahora responde 401 sin token y 200 con
> token, como corresponde.

### 6.2 `fabrick-tg-bot` (cerebro) — Vercel

| Archivo | Cambio |
|---|---|
| `api/health.js` | Nuevo. Cuenta capas utilizables (12/15 hoy), memoria, Telegram y voz. |
| `api/estado.js` | Nuevo. Malla de las 4 capas. |
| `api/bridge.js` | La voz se comprobaba contra `/live` (inexistente) → siempre «unknown». Ahora usa `/api/health`. Se añadió la API del teléfono. El chat de Telegram ya no está fijo en el código: `TG_CHATS` manda. |
| `index.html` | Botón **Estado** (lima) + hoja de malla con las 4 capas, latencia y enlace. Vive fuera de `app.js`: si el módulo principal se cae, el estado sigue funcionando. |
| `vercel.json` | `maxDuration` para health/estado. |

### 6.3 `fabrick-cloud` (nube y voz) — Cloudflare Worker

| Archivo | Cambio |
|---|---|
| `worker/src/malla.js` | Nuevo. Sondeo paralelo con `AbortController` y tope de 5 s. |
| `worker/src/index.js` | `/api/malla` y `/api/estado`; `/api/health` con contrato común; **UI rediseñada completa** con la marca (negro `#050505`, lima `#C8FF00`, Inter, radios 12 px) y sección de malla en vivo. |
| `worker/wrangler.toml` | Sin cambios: binding `AI` y KV `CACHE` ya estaban. |

### 6.4 `fabri-core` (web y PWA) — Vercel

| Archivo | Cambio |
|---|---|
| `web/index.html` | Tokens de marca exactos (`#050505` / `#C8FF00`), radios 12 px, enlace **Malla** y sección **Malla en vivo** con las 4 capas. |
| `web/api/health.go` | Contrato común: `servicio`, `capa`, `version`, `hora`, `dependencias`. |
| `web/api/estado/index.go` | Nuevo. Malla en Go con goroutines y tope de 5 s. |
| `web/vercel.json` | `maxDuration` para la malla. |

---

## 7. Interfaz y marca

### 7.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#050505` | fondo |
| `--card` | `#0C0C0C` | tarjetas |
| `--bd` | `#1D1D1D` | bordes |
| `--lima` | `#C8FF00` | acción, estado arriba, acento |
| `--tx` | `#F5F5F0` | texto |
| `--tx2` | `#A8A8A0` | texto secundario |
| `--warn` | `#FFB020` | degradado |
| `--bad` | `#FF5252` | caído |
| radio | `12px` | tarjetas, botones, hojas |
| tipografía | `Inter` | 400–800 |

### 7.2 Reglas de interfaz

1. **Botón principal = lima con texto negro.** Nunca lima sobre lima.
2. **Un solo acento por pantalla.** El oro pertenece al personaje 3D; el lima
   pertenece al sistema. No se mezclan en el mismo componente.
3. **El estado se muestra, no se decora.** Punto + palabra + latencia. Si no hay
   dato, se dice «—», no se inventa.
4. **Móvil primero.** Todo se toca con una mano; hojas inferiores, no modales
   centrados.
5. **`prefers-reduced-motion`** respetado en escáner, barras y transiciones.
6. **Contraste**: texto principal sobre `#050505` supera 7:1; el lima solo se usa
   como fondo con texto negro.

### 7.3 Dónde se ve

| Interfaz | URL |
|---|---|
| Landing + malla | `https://fabri-core-web.vercel.app/#malla` |
| PWA | `https://fabri-core-web.vercel.app/app/` |
| Cerebro + estado | `https://fabrick-tg-bot.vercel.app` (botón **Estado**) |
| Panel de nube | `https://fabrick-cloud.faubricioedms.workers.dev` |
| APK | `https://github.com/thinkfashz/fabri-core/releases/latest` |

---

## 8. Seguridad y límites

| Regla | Dónde se aplica |
|---|---|
| Token de la API en `Authorization: Bearer`, nunca en la URL | `fabri-api` |
| PIN PBKDF2 (120 000 iteraciones) en tabla `usuarios`; un PIN incorrecto no prueba la base | APK |
| Huella con Keystore; sin clave privada exportable | APK |
| Tokens de terceros en SQLite, nunca devueltos a la página | APK |
| Descargas > 50 MB requieren autorización explícita + SHA-256 | APK |
| Sin shell arbitrario desde la WebView | `MainActivity` |
| Cada evento relevante en `revision` (tipo, severidad, ms) | APK |
| Secretos solo en variables de entorno; el repo no los contiene | los 4 servicios |
| `health` no revela valores, solo presencia | los 4 servicios |
| CORS abierto solo en endpoints de lectura (`health`, `estado`) | los 4 servicios |

**Lo que este ecosistema no hace:** no entrena modelos con tus datos, no vende
telemetría, no guarda tokens en el navegador y no simula funciones que no existen.

---

## 9. Despliegue

### 9.1 Reglas

- Autor de commit: **`faubricioedms@gmail.com`** (Vercel bloquea deploys de otros
  autores en proyectos con Git integrado).
- Los proyectos `fabri-api`, `fabrick-tg-bot` y `fabri-core-web` se despliegan con
  la CLI autenticada como `thinkfashz`.
- El Worker de Cloudflare requiere `wrangler` y una sesión/API token de la cuenta.
- Nunca reiniciar OpenCode desde una sesión; nunca usar `pm2`.

### 9.2 API del teléfono

```sh
# desde un directorio limpio con api/, package.json y vercel.json
vercel link --yes --project fabri-api
vercel --prod --yes
```

### 9.3 Cerebro

```sh
cd fabrick-tg-bot
vercel link --yes --project fabrick-tg-bot
vercel --prod --yes
```

### 9.4 Web y PWA

```sh
cd fabri-core/web
vercel link --yes --project fabri-core-web
vercel --prod --yes
```

### 9.5 Nube y voz (pendiente de credenciales)

```sh
cd fabrick-cloud/worker
npx wrangler deploy
```

Variables/bindings que ya están en `wrangler.toml`:

- `AI` (Workers AI, MeloTTS)
- `CACHE` (KV `fabrick-cache`)
- secreto `SUPERMEMORY_API_KEY` (`wrangler secret put`)

> El código del Worker **está listo y validado** (`node --check`), pero este
> entorno no tiene token de Cloudflare. El panel nuevo y `/api/malla` quedan
> activos con ese único comando.

### 9.6 APK

```sh
cd /data/data/com.termux/files/home/fabrick-core
bash scripts/compilar.sh
```

Salida: `dist/FABRI-CORE-0.9.11.apk` (4 082 822 B,
sha256 `4d7135641123c4781dc1316501fabc2556add7853c08e7456b1e19965fef3c49`) y
copia en `/storage/emulated/0/Download/`.

### 9.7 Arranque y acceso (0.9.11)

La APK 0.9.10 se quedaba en «LOADING CORE SYSTEM · 0 %» y, al reabrir, el login
aparecía sin responder. La causa y las reglas para no repetirla están en
**`docs/ARRANQUE-Y-ACCESO.md`**. Resumen:

| Regla | Dónde se cumple |
|---|---|
| La primera pintura no espera al núcleo | `iniciar()` en `app.js`: loader primero, núcleo en el turno siguiente |
| Ninguna llamada al puente espera más de 1,2 s | `NativeBridge.ESPERA_NUCLEO_MS` |
| `ping` no espera nunca | `NativeBridge.necesitaNucleo()` |
| El hilo de interfaz no llama al puente | `ColaConsola` (hilo de fondo) |
| El loader no depende de JavaScript | animación CSS + `pointer-events: none` |
| El acceso no depende del núcleo | PIN contra `SharedPreferences`; `usuarios` es respaldo |
| Todo lo recuperable se recupera solo | `window.__fabriNucleoListo()` |

Evidencia en el teléfono: **Menú ☰ → Diagnóstico → Bitácora de arranque**
(`filesDir/arranque.log`, escrita por `Bitacora.java` sin pasar por el núcleo).
A los 5 s anota `loader=`, `login=`, `delegacion=` y `nucleo=`.

Pruebas nuevas:

```sh
bash tests/arranque/correr.sh
```

---

## 10. Verificación reproducible

```sh
# 1. Las cuatro capas responden
for u in \
  https://fabri-api.vercel.app/api/health \
  https://fabrick-tg-bot.vercel.app/api/health \
  https://fabrick-cloud.faubricioedms.workers.dev/api/health \
  https://fabri-core-web.vercel.app/api/health; do
  printf '%-70s ' "$u"; curl -4 -s -o /dev/null -w '%{http_code}\n' "$u"
done

# 2. La malla ve las cuatro
curl -4 -s https://fabri-api.vercel.app/api/estado | jq '.capas[] | {id, estado, ms}'

# 3. La API protegida ya no da 404
curl -4 -s -o /dev/null -w '%{http_code}\n' https://fabri-api.vercel.app/api/diagnostico   # 401
curl -4 -s -o /dev/null -w '%{http_code}\n' https://fabri-api.vercel.app/api/modelos       # 401

# 4. La landing sirve la malla
curl -4 -s https://fabri-core-web.vercel.app/ | grep -c 'Malla en vivo'                     # 1
```

Pruebas locales del APK:

```sh
cd /data/data/com.termux/files/home/fabrick-core
bash tests/seguridad/correr.sh            # 23/23
bash tests/seguridad/validar-manifiestos.sh  # 23/23
bash tests/arranque/correr.sh             # DOM hostil + carga sin bloqueo
```

---

## 11. Estado real y pendientes

### 11.1 Arriba y verificado

- [x] API del teléfono con los 10 endpoints enrutados y token obligatorio.
- [x] Cerebro con salud, malla y puente corregido.
- [x] Web con malla en vivo y marca exacta.
- [x] Contrato común en las cuatro capas.
- [x] APK 0.9.11 firmada: arranque sin bloqueo, loader CSS, bitácora y login de respaldo.
- [x] Documentación maestra (este archivo).

### 11.2 Pendiente inmediato

- [ ] **Desplegar el Worker** (`wrangler deploy`) para activar la UI nueva y
      `/api/malla`. Mientras tanto, la capa responde con la UI anterior.
- [ ] **Probar `/api/think` con token real** desde la APK y confirmar que
      InsForge tiene las tablas esperadas.
- [ ] **Release build** de la APK (hoy es debug-signed).
- [ ] **README + licencia** en el repo público (lo primero que mira un juez).
- [ ] **Runtime de visión** (EfficientDet / Face Landmarker) sin integrar.
- [ ] Revisar el aviso de Vercel sobre Node 24 en `fabri-api` (hoy corre 24.x).

### 11.3 Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| RAM del teléfono (~1.7 GB libres) | nada de renders durante builds; `masterlib/bin/shot.sh`; no pm2 |
| IPv6 roto en la red | todo `curl` y los MCP usan `--ipv4` |
| Worker sin deploy | el resto de la malla funciona; el panel nuevo espera credenciales |
| Tokens de 60 días | `token-keeper` y el panel de Vercel renuevan |
| Duplicación local/repo | el APK se compila del proyecto local; el repo público es la cara |

---

## 12. Hackathon Meta 2026: cómo calza

**Evento:** Meta Global AI Developer Hackathon · remoto · 26/10–4/11/2026 ·
$1 000 000 en premios · tracks **Indie developer** y **Startup** ·
temas **Build for Your World** y **Push the Frontier**.

### 12.1 Track recomendado: Indie developer

Eres un builder individual con un producto que **ya corre**. El track Startup pide
ejecución de producción; la app es pre-1.0 y debug-signed. Indie premia
creatividad, ambición técnica y que funcione — exactamente lo que hay.

### 12.2 Tema principal: Build for Your World

El problema es de primera mano: pequeños negocios en Chile que trabajan con
planillas, WhatsApp y memoria, en lugares con mala señal. FABRI-CORE les da
inventario, precios, márgenes y boletas **en el teléfono**, con IA que no necesita
internet.

### 12.3 Tema secundario: Push the Frontier

Un agente que **percibe** (foto/código), **razona** (modelo local o Meta),
**actúa** (inventario, boleta, publicación) y **recuerda** (SQLite/GraphRAG),
todo en un dispositivo de bolsillo y con auditoría.

### 12.4 Evidencia para el jurado

| Criterio | Evidencia |
|---|---|
| Creatividad | consola de operador para comercio real; local-first + nube; 17 vistas; módulos |
| Ambición técnica | Rust/JNI/WebView/SQLite sin Gradle; llama.cpp en Android; GraphRAG; APK de 4 MB |
| Que funcione | APK 0.9.11 firmada; 23+23 pruebas; inferencia local cableada; inventario y boletas |
| Build for Your World | stock, precios de proveedor, márgenes, boletas, offline, Chile |
| Push the Frontier | agente privado en el teléfono; modelos de Meta como capacidad enchufable |
| Producción | seguridad, auditoría, biometría, migraciones; falta release build y README |

### 12.5 Demo de 3 minutos: «de la factura del proveedor al post en la Page»

1. **Foto de la factura** (cámara de la APK).
2. **Meta Model API** extrae ítems y precios (SAM 3.1 para segmentar; el modelo de
   razonamiento para los datos).
3. **Alta de productos** y cálculo de margen en SQLite.
4. **Boleta** emitida en el teléfono.
5. **Publicación** del resumen en la Page vía Graph API.
6. **Modo avión**: el chat sigue respondiendo con el GGUF local.

### 12.6 Frase de postulación (inglés)

> FABRI-CORE is a local-first AI operator console for small businesses in Latin
> America. A 4 MB Android app that runs open-weight models on-device, scans
> inventory, computes margins, issues receipts, and falls back to Meta's models in
> the cloud when connectivity allows. Private by default, useful offline,
> auditable end to end.

### 12.7 Brechas honestas

| Brecha | Qué hacer |
|---|---|
| Hoy corre Qwen/SmolLM, no modelos de Meta | añadir manifiesto GGUF de Meta + proveedor Meta Model API |
| Visión no integrada en el teléfono | usar SAM 3.1 por API en la nube; cámara local para captura |
| Firma de depuración | release build antes de entregar |
| Sin README ni licencia | publicarlos esta semana |
| Código previo | declarar la base y mostrar el diff del evento |

---

## 13. Roadmap de 10 días

| Día | Entregable |
|---|---|
| 1–2 | Proveedor `meta` en Conexiones (token en SQLite, nunca en la página) |
| 2–3 | Manifiesto GGUF de un modelo abierto de Meta + demo en modo avión |
| 3–6 | Factura → visión → alta de productos → margen |
| 6–7 | Publicación en la Page vía Graph API |
| 8–9 | Video de 3 min, README, diagrama, hash de la APK, nota de privacidad |
| 10 | Repo público + demo + formulario |

---

## 14. Mapa de archivos

### Proyecto local del APK

```
/data/data/com.termux/files/home/fabrick-core/
├── android/assets/www/        index.html · app.js · app.css · diagnostico.js
├── android/java/cl/fabrick/   MainActivity.java · NativeBridge.java
├── src-tauri/src/lib.rs       núcleo Rust (3 246 líneas, ~30 operaciones)
├── api/                       fabri-api (think, sync, diagnostico, health, estado…)
├── manifiestos/               10 manifiestos (modelos, bibliotecas, ejecutables)
├── modulos/                   15 módulos/páginas instalables
├── docs/                      52 documentos
├── tests/seguridad/           23 + 23 comprobaciones
├── dist/                      APK firmadas
└── vercel.json                rutas de fabri-api
```

### Repo `fabri-core`

```
web/
├── index.html                 landing + malla en vivo
├── app/                       PWA (SQLite WASM)
└── api/
    ├── health.go              salud común
    ├── estado/index.go        malla en Go
    ├── agent.go               proxy LLM
    ├── auth/index.go          cuentas (PBKDF2 + Blob)
    └── sync/index.go          copia cifrada
```

### Repo `fabrick-cloud`

```
worker/
├── wrangler.toml              bindings AI + KV
└── src/
    ├── index.js               router + UI de marca
    ├── malla.js               malla de las 4 capas
    ├── panel.js               panel híbrido
    ├── voz.js                 MeloTTS
    └── uso.js                 contabilidad de neuronas
```

### Repo `fabrick-tg-bot`

```
api/
├── health.js                  salud del cerebro
├── estado.js                  malla
├── bridge.js                  puente Telegram ↔ cerebro ↔ voz ↔ API
├── talk.js                    agente de voz
├── tg.js                      webhook de Telegram
├── stt.js                     transcripción (Groq → Worker)
└── voz.js / voz-edge.js       TTS
model-rotator.js               15 capas de modelos
persona.js                     persona chilena
memoria.js                     memoria persistente
index.html                     figura 3D + botón Estado
```

---

## 15. Decisiones que no se deben deshacer

1. **La nube no ejecuta agentes.** Si se mueve el agente a la nube, se pierde la
   promesa local-first y se dispara el costo.
2. **`/api/health` no toca la base.** Es la única forma de que la malla no se
   caiga cuando InsForge está lento.
3. **La malla es de un salto.** `estado → health`, nunca `estado → estado`.
4. **Un fallo se informa, no se esconde.** `degradada` y `caida` son estados
   válidos; `ok` sin datos no lo es.
5. **El token del teléfono nunca viaja en la URL.** Solo `Authorization: Bearer`.
6. **El chat de Telegram es configurable** (`TG_CHATS`), no hardcodeado.
7. **La UI del Worker se sirve como string** para no depender de un bundler.
8. **El botón de estado vive fuera de `app.js`** para sobrevivir a un fallo del
   módulo principal.
9. **La marca es negro + lima + Inter + 12 px.** El oro es del personaje, no del
   sistema.
10. **Los deploys de Vercel llevan autor `faubricioedms@gmail.com`.**

---

## 16. Bitácora de esta sesión (2026-10-26)

| Hora (UTC) | Acción | Resultado |
|---|---|---|
| 01:27 | Clonado superficial de los tres repos | `fabri-core` 11 MB · `fabrick-cloud` 314 KB · `fabrick-tg-bot` 5.5 MB |
| 01:29 | Descubrimiento del dominio real de la API | `fabri-api.vercel.app` (proyecto `prj_XggFitwOGe2toRExtX9Lv10zuuml`) |
| 01:31 | Diagnóstico del enrutado | `/api/diagnostico`, `/api/modelos`, `/api/memoria`, `/api/skills` → **404** |
| 01:35 | Contrato común implementado | `health` + `estado` en las cuatro capas |
| 01:38 | UI de marca en el Worker | negro/lima/Inter + malla |
| 01:40 | Botón Estado en el cerebro | hoja inferior con 4 capas |
| 01:41 | Landing con malla en vivo | tokens exactos + sección `#malla` |
| 01:42 | Deploy `fabri-api` | READY · 10 endpoints |
| 01:44 | Deploy `fabrick-tg-bot` | READY · 12/15 capas |
| 01:45 | Deploy `fabri-core-web` | READY · malla en Go |
| 01:46 | Verificación | 4/4 capas arriba · 31–430 ms |
| 01:50 | Documento maestro | este archivo |

---

## 17. Contacto y propiedad

- **Producto:** FABRI-CORE · Soluciones Fabrick
- **GitHub:** [thinkfashz](https://github.com/thinkfashz)
- **Panel público:** `https://fabrick-cloud.faubricioedms.workers.dev`
- **Web:** `https://fabri-core-web.vercel.app`
- **Cerebro:** `https://fabrick-tg-bot.vercel.app`

> Este documento se puede copiar, citar y auditar. Si una afirmación no tiene una
> URL o un comando que la respalde, trátala como pendiente, no como hecha.
