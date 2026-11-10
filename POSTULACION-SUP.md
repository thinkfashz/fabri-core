# Postulación Start-Up Chile — BIG 13 (programa Build)

> Documento de trabajo para postular **FORGE CORE STOCK / MercadoPlacer**.
> Redactado el **2026-11-05**. La generación **BIG 13 cierra el 24-nov-2026,
> 13:00 (hora de Chile)**. Postular en: <https://startupchile.charly.io/>
>
> **Regla de este documento: nada inflado.** Todo lo que dice acá se puede
> mostrar en vivo y se sostiene si el evaluador pregunta «¿me lo pruebas?».

---

## 1 · La frase que lo resume (elevator, 20 segundos)

> En Linares y Rengo, los almacenes y ferias de barrio no aparecen en Rappi ni
> en PedidosYa porque las comisiones los dejan fuera. Armé un mapa donde el
> local entra gratis, tiene su catálogo real y su tienda caminable en 3D, y el
> vecino pide desde el celular. El local decide si está abierto, cuánto es el
> pedido mínimo y si entrega o se retira.

---

## 2 · Problema

- Las apps de delivery cobran comisiones (20–30%) que un almacén de barrio no
  puede pagar, así que **no existen para el cliente digital**.
- El vecino no sabe **qué está abierto ahora** ni **a qué precio** está la
  verdura del día, así que camina sin saber.
- En comunas fuera de Santiago (Linares, Rengo) la cobertura de las grandes
  plataformas es pobre o nula.

## 3 · Solución

Un marketplace **local-first** para negocios de barrio:

1. **El local entra gratis** y carga su catálogo (hasta **300 productos gratis**).
2. Aparece en el **mapa** con su estado **ABIERTO/CERRADO** y su **pedido mínimo**.
3. El cliente **pide desde el celular**: **retira en el local** o **coordina despacho**.
4. Cada local tiene además su **tienda 3D caminable**, para recorrer los productos.
5. Después de los 300 productos: **$20.000 una vez al año** (≈ $1.666/mes). Nada más.

El pedido se confirma por **WhatsApp** con el local (funciona hoy, sin depender
de integraciones de pago).

---

## 4 · Qué existe HOY (producto real, no PPT)

| Pieza | Estado | Evidencia |
|---|---|---|
| **PWA en vivo** (mapa, catálogo, carrito, checkout) | Funcionando | `https://forge-core-stock.vercel.app/app/` |
| **Registro de locales** (catálogo real servido por CDN) | Funcionando | `https://forge-core-stock.vercel.app/datos/tiendas.json` |
| **ABIERTO/CERRADO** (pin gris si cerró) | Funcionando | ficha del local en la PWA |
| **Pedido mínimo por local** (bloquea el pago bajo el mínimo) | Funcionando | carrito y checkout |
| **Retiro o despacho por local** | Funcionando | checkout |
| **Tienda 3D caminable** | Funcionando | `/app/` → entrar a un local → «Ver tienda en 3D» |
| **APK Android** (consola de inventario/POS, offline) | Existe y corre | `/descargas/FORGE-CORE-STOCK.apk` |
| **Alta de locales** (script validado) | Funcionando | `scripts/nueva-tienda.mjs` |
| **Pago** | **Simulado y rotulado** | el checkout lo dice explícitamente |

**Nivel técnico:** prototipo avanzado / MVP monousuario (TRL ~4–5). El mapa, el
catálogo real y las tres funciones clave están operativas; falta el uso con
comercios reales.

---

## 5 · Tracción (honesta — esto es lo que decide la postulación)

> ⚠️ **No decir «32 locales usando la plataforma».** Esos 32 puntos vienen de
> **OpenStreetMap**: son negocios que existen en el mapa público, pero **no se
> registraron, no cargaron catálogo y no usan la app**. Decirlo inflado y que el
> evaluador pregunte «¿cuántos tienen catálogo?» hunde la credibilidad.

**Cómo decirlo bien:**

> «El prototipo ya muestra los negocios reales de mi comuna desde OpenStreetMap
> (dato público, ODbL) y sobre eso funciona el registro propio: los locales
> piloto que me dejan cargar su catálogo aparecen con su catálogo real, su
> estado abierto/cerrado, su pedido mínimo y su forma de entrega. Hoy tengo
> **[N] locales piloto cargados** y [M] contactados para entrar esta semana.»

**Métricas que sí se pueden mostrar:** locales piloto con catálogo cargado,
productos por local, pedidos de prueba de punta a punta (ficha → carrito →
mínimo → confirmación por WhatsApp).

**Meta de las 2 semanas (la que se promete y se cumple):** **5 locales reales**
en Linares/Rengo con catálogo cargado y **un video** de cada uno usándolo.

---

## 6 · Modelo de negocio

| | Detalle |
|---|---|
| Para el local | Gratis al entrar · hasta **300 productos gratis** |
| Al pasar 300 productos | **$20.000 una vez al año** (≈ $1.666/mes) · sin comisión por venta |
| Ingreso adicional (futuro) | Coordinación de despacho |
| Por qué es defendible | En el nicho, la barrera es la **confianza y la densidad local**, no la tecnología: quien entra primero se queda |

**Por qué $20.000/año funciona como arma de entrada:** es un precio que un
almacén de barrio no discute y elimina la fricción de «probar». La densidad
(locales + vecinos en la misma comuna) es lo que después trae el valor.

---

## 7 · Mercado

- **Foco inicial:** Linares y Rengo (Región del Maule).
- **Por qué ahí:** Rappi/PedidosYa cubren mal; comercio de barrio denso;
  el nicho desatendido es exactamente donde una plataforma liviana gana.
- **Expansión:** comunas similares de la zona, una por una (no «Chile entero»
  de entrada — el pitch pierde si promete demasiado).

---

## 8 · Equipo y situación legal (decir la verdad)

- **Cofundador técnico / desarrollador:** Fabrick (yo) — construyó la app, el
  mapa, la tienda 3D y la APK.
- **Titular legal:** persona con **RUT chileno y residencia** (familiar de
  confianza), mientras se regulariza la situación del fundador técnico.
  Start-Up Chile **acepta fundadores extranjeros** y apoya el trámite de visa.
- ⚠️ **Esto hay que confirmarlo con un contador en Chile** antes de mover plata:
  quién factura, quién rinde cuentas y cómo se reparte. La plata es legalmente
  de quien firma.

---

## 9 · Uso de los fondos (Build = $15.000.000, equity-free)

| Destino | % aprox. | Para qué |
|---|---|---|
| Trabajo de campo (10 semanas) | 40% | Cargar 40–60 locales reales y sus catálogos |
| Producto | 30% | Backend real (registro + pedidos persistentes), pago, app de Android en release |
| Operación y legal | 20% | Formalización, contador, soporte a los locales |
| Difusión local | 10% | Volantes, video, presencia en ferias |

---

## 10 · Qué falta y hoja de ruta

1. **Backend persistente** — el registro ya es multiusuario (JSON por CDN); el
   siguiente paso es una base de datos para que el dueño prenda/apague y reciba
   pedidos sin depender del fundador.
2. **Alta de local self-service** en la app (form que emite el JSON del local).
3. **Pago real** (hoy simulado y rotulado).
4. **APK firmada en release** (hoy firmada con clave de depuración).
5. **5 locales reales + video** (la prueba que convence a ángeles después).

---

## 11 · Qué NO decir (anti-inflado)

- ❌ «32 locales en la plataforma» → ✅ «32 negocios reales en el mapa (OSM) + N piloto».
- ❌ «Tengo usuarios» → ✅ «Tengo el prototipo operativo y N locales cargados».
- ❌ «Procesamos pagos» → ✅ «El pago está simulado y rotulado; se coordina por WhatsApp».
- ❌ «Vamos a conquistar Chile» → ✅ «Empezamos en Linares y Rengo, una comuna a la vez».

---

## 12 · One-pager para imprimir / mandar

> **FORGE CORE STOCK · MercadoPlacer**
> *El mapa de los negocios de barrio que sí atienden donde estás.*
>
> **Problema:** los locales de barrio de Linares/Rengo no aparecen en las apps
> de delivery porque las comisiones los dejan fuera.
>
> **Solución:** mapa + catálogo real + pedido por celular. El local entra gratis,
> sube hasta 300 productos, decide si está abierto, su pedido mínimo y si entrega
> o se retira. Después, $20.000 al año.
>
> **Ya funciona:** mapa en vivo, catálogo real, abierto/cerrado, pedido mínimo,
> retiro/despacho y tienda 3D caminable.
> `forge-core-stock.vercel.app/app/`
>
> **Buscamos:** programa Build de Start-Up Chile para cargar 40–60 locales reales
> y construir el backend persistente.
>
> **Contacto:** [tu nombre] · [WhatsApp] · [correo]

---

## 13 · Checklist de postulación (BIG 13, cierra 24-nov-2026 13:00)

- [ ] Cuenta en <https://startupchile.charly.io/>.
- [ ] Video de 40 s mostrando el mapa, un local abierto y el pedido hasta el
      mínimo (el video ya grabado sirve).
- [ ] Descripción del problema y la solución (§2 y §3 de este doc).
- [ ] Estado del producto con evidencia real (§4).
- [ ] Tracción dicha **honestamente** (§5).
- [ ] Modelo de negocio y mercado (§6 y §7).
- [ ] Equipo y titular legal con RUT (§8) — **confirmar con contador**.
- [ ] Uso de fondos (§9).
- [ ] Revisar los 4 puntos de §11 antes de apretar «Enviar».

> **Ruta paralela (para después):** CORFO **Semilla Inicia** — hasta
> **$15.000.000, cubre 75%** — para prototipo sin ventas. Requiere postulante con
> **residencia y formalización en Chile** (vía el titular legal). El 25% restante
> normalmente se aporta como **horas de trabajo valorizadas** (confirmar en las
> bases vigentes).
