# Tráfico sobre el mapa · autos en las calles reales

Capa de animación del **MercadoPlacer** (`web/app/mapa-trafico.js`): autos que
circulan por las calles que OpenStreetMap tiene dibujadas, en **los dos
sentidos**. No es tráfico real: es el flujo de la vía, dibujado.

## 1. De dónde salen las calles

No se inventan calles ni se usan teselas como si fueran datos. Las vías se piden
a **Overpass** (el mismo OpenStreetMap que alimenta el mapa) con su geometría
completa:

```overpassql
[out:json][timeout:15];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"](S,W,N,E);
out geom 250;
```

| Regla | Valor | Por qué |
|---|---|---|
| Zoom mínimo | 14 | es el zoom con que abre el mapa al encuadrar los locales; con menos, las calles se pisan |
| Lado máximo de la vista | 8000 m | más ancho = demasiadas vías y los autos serían motas |
| Puntos de vía | 3500 | techo de memoria del teléfono |
| Autos | 60 | uno cada ~220 m, entre 2 y 6 por calle |
| Velocidad | 25–50 km/h | ritmo de ciudad |
| Caché | 15 min, 10 zonas | volver al mismo barrio no vuelve a pedir |
| Espejos | `overpass-api.de`, `overpass.kumi.systems` | si uno falla, se prueba el otro |
| Espera tras mover | 700 ms | no se pide en cada cuadro del arrastre |

Las vías se ordenan por jerarquía (avenida antes que pasaje) y se descartan las
que no sirven: menos de 2 puntos, menos de 40 m, coordenadas rotas o puntos
repetidos seguidos.

## 2. Los dos sentidos

Cada calle se convierte en una polilínea con longitud acumulada en metros. Los
autos se reparten a lo largo de ella **alternando el sentido**, y cada uno:

- avanza (o retrocede) a su velocidad, y al llegar al final **vuelve a entrar**
  por el otro extremo;
- se dibuja desplazado al **carril de su derecha** (Chile circula por la
  derecha), así los dos flujos no se pisan;
- gira su silueta según su rumbo: el que va al oeste apunta al oeste, con la
  luz trasera roja del lado correcto.

Los autos miden 6–15 px: a escala real (4,5 m) serían invisibles. El tamaño está
exagerado a propósito y así se dice en el propio código.

## 3. Honestidad de los datos

| Estado (`canvas#mpTrafico.dataset.trafico`) | Qué significa |
|---|---|
| `cargando` | se está pidiendo la zona |
| `ok` | hay calles y autos |
| `muy-lejos` | zoom < 14 o vista de más de 8 km: no se dibuja nada |
| `sin-calles` | la zona no tiene vías mapeadas: **no se inventan** |
| `sin-red` | Overpass no respondió: el mapa sigue, sin autos |

Lo que **no** es:

- **No es tráfico real.** No hay velocidades ni congestión: eso exige Google,
  TomTom o similar, de pago. Aquí se muestra el flujo de la vía.
- **No lee `oneway`** todavía: en una calle de un solo sentido se ven autos en
  los dos. Es una simplificación consciente; el dato ya viene en las etiquetas
  de OSM, así que es una mejora barata cuando se quiera.
- **No hay semáforos, cruces ni giros**: cada auto sigue su vía y reaparece.

## 4. Uso y ahorro

- Botón **«Tráfico en vivo»** en el menú `⋯` del mapa (`#mpTraficoBtn`). Se
  recuerda entre visitas en `localStorage` (`fcore.placer.trafico` = `1`/`0`).
- Se pausa solo cuando la pestaña queda oculta.
- Con `prefers-reduced-motion: reduce` los autos **no se animan**: se dibujan
  una vez y sólo se repintan al mover el mapa (sin bucle de `requestAnimationFrame`).
- Canvas propio (`#mpTrafico`, `z-index: 401`) para no pelear con el canvas del
  radar y el radio (`#mpCanvas`, `402`).
- Si el módulo no carga (sin red y sin caché), el mapa y la lista de mercados
  siguen funcionando: simplemente no hay autos.

## 5. Pruebas

```sh
node tests/web/trafico.js
```

69 comprobaciones sobre el archivo real, con un mapa y un canvas falsos que
anotan cada dibujo: geometría, filtros, tope de puntos, interpolación y vuelta,
reparto en ambos sentidos, avance hacia el este y hacia el oeste, carriles
opuestos, vuelta al final de la calle, caché (una sola petición por zona),
apagado/encendido, `parar()` sin oyentes ni bucles, `muy-lejos`, `sin-red`,
movimiento reducido y descarte de respuestas de una zona abandonada.

La prueba encontró un bug real antes de desplegar: `map.getBounds()` de Leaflet
devuelve `lng`, y el módulo leía `lon`. La consulta salía con `NaN` y el tráfico
nunca cargaba. Se normaliza en `bboxDe()`.

## 6. Costo

Overpass y las teselas son gratuitos con atribución (ya está en el mapa). El
tráfico no toca la API propia ni InsForge: es lectura directa de OSM desde el
navegador, con caché local por 15 minutos.
