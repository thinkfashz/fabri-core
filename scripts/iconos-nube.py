#!/usr/bin/env python3
"""Genera los iconos de la PWA de la nube con la marca Aurora.

La APK tiene sus propios iconos (lima sobre negro). La nube usa el mismo
símbolo —cuadrado redondeado con núcleo— pero con el degradado iris→aqua.

Se dibuja a 4x y se reduce con LANCZOS: sin eso, los bordes redondeados y el
cuadrado interior quedan con escalones visibles en la pantalla de inicio.

Uso: python3 scripts/iconos-nube.py
Salida: web/app/icons/{icon-192,icon-512,maskable-512}.png y web/favicon.png
"""
from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ICONOS = RAIZ / "web/app/icons"
ICONOS.mkdir(parents=True, exist_ok=True)

VOID = (4, 6, 13, 255)
IRIS = (140, 140, 255)
AQUA = (63, 224, 201)
ESCALA = 4


def degradado(lado: int) -> Image.Image:
    """Degradado diagonal iris → aqua, calculado por píxel (sin bandas)."""
    img = Image.new("RGBA", (lado, lado))
    px = img.load()
    for y in range(lado):
        for x in range(lado):
            t = (x + y) / (2 * (lado - 1))
            px[x, y] = (
                round(IRIS[0] + (AQUA[0] - IRIS[0]) * t),
                round(IRIS[1] + (AQUA[1] - IRIS[1]) * t),
                round(IRIS[2] + (AQUA[2] - IRIS[2]) * t),
                255,
            )
    return img


def marca(lado: int, bleed: bool) -> Image.Image:
    """Dibuja la marca. `bleed` = fondo a sangre para el icono maskable."""
    n = lado * ESCALA
    base = Image.new("RGBA", (n, n), VOID)
    grad = degradado(n)

    if bleed:
        base = grad.copy()
        inset = round(n * 0.16)
    else:
        inset = round(n * 0.045)

    # cuadrado exterior con degradado y esquinas redondeadas
    mascara = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(mascara)
    d.rounded_rectangle(
        [inset, inset, n - inset, n - inset],
        radius=round(n * (0.24 if not bleed else 0.20)),
        fill=255,
    )
    base.paste(grad, (0, 0), mascara)

    # núcleo oscuro y punto aqua, con las mismas proporciones que .mark del CSS
    caja = (n - 2 * inset)
    dentro = inset + round(caja * 0.27)
    d2 = ImageDraw.Draw(base)
    d2.rounded_rectangle(
        [dentro, dentro, n - dentro, n - dentro],
        radius=round(caja * 0.11),
        fill=VOID,
    )
    punto = inset + round(caja * 0.42)
    d2.rounded_rectangle(
        [punto, punto, n - punto, n - punto],
        radius=max(2, round(caja * 0.028)),
        fill=AQUA + (255,),
    )

    return base.resize((lado, lado), Image.LANCZOS)


def guardar(nombre: str, lado: int, bleed: bool = False) -> None:
    img = marca(lado, bleed)
    ruta = ICONOS / nombre
    img.save(ruta, "PNG", optimize=True)
    print(f"  ok {ruta.relative_to(RAIZ)} · {lado}x{lado} · {ruta.stat().st_size} B")


guardar("icon-192.png", 192)
guardar("icon-512.png", 512)
guardar("maskable-512.png", 512, bleed=True)

# favicon de la landing: mismo símbolo, tamaño de pestaña
fav = marca(64, bleed=False)
fav.save(RAIZ / "web/favicon.png", "PNG", optimize=True)
print(f"  ok web/favicon.png · 64x64 · {(RAIZ / 'web/favicon.png').stat().st_size} B")
print("ok · iconos de la nube regenerados")
