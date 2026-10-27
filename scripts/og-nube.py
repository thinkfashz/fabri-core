#!/usr/bin/env python3
"""Genera la imagen social (Open Graph) de la nube FABRI-CORE.

1200x630, la marca Aurora y el titular de la landing. Sin dependencias más
allá de Pillow y de las fuentes del sistema (Roboto Flex, variable).

Uso: python3 scripts/og-nube.py
Salida: web/og.png
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "web/og.png"

ANCHO, ALTO = 1200, 630
VOID = (4, 6, 13)
BG = (7, 10, 20)
IRIS = (140, 140, 255)
AQUA = (63, 224, 201)
TX = (242, 245, 253)
TX2 = (170, 180, 201)
TX3 = (122, 132, 153)
TX4 = (89, 97, 122)
LINEA = (255, 255, 255, 18)

FUENTE = "/system/fonts/RobotoFlex-Regular.ttf"


def fuente(tam: int, peso: str = "Regular") -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(FUENTE, tam)
    try:
        f.set_variation_by_name(peso)
    except Exception:
        pass
    return f


def degradado_vertical(alto: int) -> Image.Image:
    img = Image.new("RGB", (ANCHO, alto))
    d = ImageDraw.Draw(img)
    for y in range(alto):
        t = y / (alto - 1)
        d.line(
            [(0, y), (ANCHO, y)],
            fill=(
                round(BG[0] + (VOID[0] - BG[0]) * t),
                round(BG[1] + (VOID[1] - BG[1]) * t),
                round(BG[2] + (VOID[2] - BG[2]) * t),
            ),
        )
    return img


def halo(base: Image.Image, cx: int, cy: int, radio: int, color, alfa: int) -> None:
    """Mancha radial suave: el mismo recurso del fondo aurora del CSS."""
    capa = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(capa)
    d.ellipse([cx - radio, cy - radio, cx + radio, cy + radio],
              fill=color + (alfa,))
    capa = capa.filter(ImageFilter.GaussianBlur(radio * 0.55))
    base.alpha_composite(capa)


def texto_espaciado(d, xy, texto, f, relleno, espaciado=0.0):
    """PIL no tiene letter-spacing: se avanza carácter por carácter."""
    x, y = xy
    for c in texto:
        d.text((x, y), c, font=f, fill=relleno)
        x += d.textlength(c, font=f) + espaciado
    return x


def marca(lado: int) -> Image.Image:
    n = lado * 4
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    grad = Image.new("RGB", (n, n))
    px = grad.load()
    for y in range(n):
        for x in range(n):
            t = (x + y) / (2 * (n - 1))
            px[x, y] = (
                round(IRIS[0] + (AQUA[0] - IRIS[0]) * t),
                round(IRIS[1] + (AQUA[1] - IRIS[1]) * t),
                round(IRIS[2] + (AQUA[2] - IRIS[2]) * t),
            )
    mascara = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mascara).rounded_rectangle([0, 0, n - 1, n - 1],
                                              radius=round(n * 0.24), fill=255)
    img.paste(grad, (0, 0), mascara)
    d = ImageDraw.Draw(img)
    inset = round(n * 0.27)
    d.rounded_rectangle([inset, inset, n - inset, n - inset],
                        radius=round(n * 0.11), fill=VOID + (255,))
    punto = round(n * 0.42)
    d.rounded_rectangle([punto, punto, n - punto, n - punto],
                        radius=max(2, round(n * 0.028)), fill=AQUA + (255,))
    return img.resize((lado, lado), Image.LANCZOS)


def main() -> None:
    img = degradado_vertical(ALTO).convert("RGBA")
    halo(img, 1010, 40, 430, IRIS, 62)
    halo(img, 60, 600, 330, AQUA, 26)

    # rejilla tenue, como el fondo de la consola
    rejilla = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dg = ImageDraw.Draw(rejilla)
    for x in range(0, ANCHO, 64):
        dg.line([(x, 0), (x, ALTO)], fill=LINEA)
    for y in range(0, ALTO, 64):
        dg.line([(0, y), (ANCHO, y)], fill=LINEA)
    img.alpha_composite(rejilla)

    d = ImageDraw.Draw(img)

    # marca + wordmark
    img.alpha_composite(marca(60), (72, 62))
    f_logo = fuente(19, "Bold")
    texto_espaciado(d, (150, 82), "FABRI-CORE", f_logo, TX, 3.2)

    # eyebrow
    f_eyebrow = fuente(15, "Medium")
    texto_espaciado(d, (72, 176), "CONSOLA AUTÓNOMA · NAVEGADOR + ANDROID",
                    f_eyebrow, IRIS, 2.6)
    d.line([(72, 205), (102, 205)], fill=IRIS, width=2)

    # titular
    f_h1 = fuente(68, "Bold")
    d.text((72, 228), "Tu núcleo de datos,", font=f_h1, fill=TX)
    d.text((72, 304), "sin instalar nada.", font=f_h1, fill=IRIS)

    # bajada
    f_sub = fuente(23, "Regular")
    d.text((72, 404), "SQLite real, agente, consola SQL e inventario.", font=f_sub, fill=TX2)
    d.text((72, 436), "Tus datos no salen de tu dispositivo.", font=f_sub, fill=TX2)

    # píldoras · el alfa se compone en una capa aparte: dibujar (255,255,255,10)
    # directo sobre RGBA y luego convertir a RGB deja la píldora blanca sólida.
    f_pill = fuente(16, "Medium")
    capa = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dp = ImageDraw.Draw(capa)
    x = 72
    for etiqueta in ["SQLite WASM", "FTS5", "offline", "sin cuentas"]:
        ancho = d.textlength(etiqueta, font=f_pill)
        dp.rounded_rectangle([x, 508, x + ancho + 34, 548], radius=20,
                             fill=(255, 255, 255, 12), outline=(255, 255, 255, 40))
        x += ancho + 34 + 12
    img.alpha_composite(capa)

    x = 72
    for etiqueta in ["SQLite WASM", "FTS5", "offline", "sin cuentas"]:
        ancho = d.textlength(etiqueta, font=f_pill)
        d.text((x + 17, 518), etiqueta, font=f_pill, fill=TX3)
        x += ancho + 34 + 12

    # pie
    f_pie = fuente(15, "Regular")
    d.text((72, 578), "fabri-core-web.vercel.app", font=f_pie, fill=TX4)
    d.text((ANCHO - 72 - d.textlength("Soluciones Fabrick", font=f_pie), 578),
           "Soluciones Fabrick", font=f_pie, fill=TX4)

    img.convert("RGB").save(SALIDA, "PNG", optimize=True)
    print(f"  ok web/og.png · {ANCHO}x{ALTO} · {SALIDA.stat().st_size} B")


main()
