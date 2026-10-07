"""Prepara los recursos del avatar a partir de las fotos originales.

Uso:  python tools/preparar_avatar.py
Entrada:  assets/src/retrato.jpg (fondo azul en degradado), assets/src/espejo.png
Salida:   assets/img/avatar.webp       retrato recortado con transparencia
          assets/img/avatar.png        igual, en PNG (respaldo)
          assets/img/avatar-depth.png  profundidad aproximada (blanco = cerca)
          assets/img/espejo.webp       foto de cuerpo completo optimizada
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

RAIZ = Path(__file__).resolve().parent.parent
SRC = RAIZ / "assets" / "src"
OUT = RAIZ / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)


def ajustar_fondo(rgb, muestra):
    """Ajusta un polinomio de grado 3 en (x, y) a los píxeles de fondo seguros."""
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    xn, yn = xx / w, yy / h

    def base(x, y):
        return np.stack([x**i * y**j for i in range(4) for j in range(4 - i)], -1)

    A = base(xn[muestra], yn[muestra])
    plano = np.empty_like(rgb)
    todo = base(xn.ravel(), yn.ravel())
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, rgb[..., c][muestra], rcond=None)
        plano[..., c] = (todo @ coef).reshape(h, w)
    return plano


def recortar(ruta):
    im = Image.open(ruta).convert("RGB")
    rgb = np.asarray(im).astype(np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    azul = (b > r + 8) & (b >= g) & (sat > 0.42)

    # Fondo = región azul conectada con el borde de la imagen.
    etiquetas, _ = ndimage.label(azul)
    borde = np.unique(np.concatenate([etiquetas[0], etiquetas[-1], etiquetas[:, 0], etiquetas[:, -1]]))
    borde = borde[borde > 0]
    # Zonas azules grandes encerradas por el armazón: fondo visto a través del lente.
    tam = ndimage.sum(azul, etiquetas, range(1, etiquetas.max() + 1))
    vidrio = [i + 1 for i, t in enumerate(tam) if t > 250 and (i + 1) not in borde]
    fondo = np.isin(etiquetas, np.concatenate([borde, vidrio]).astype(int))
    seguro = ndimage.binary_erosion(fondo, iterations=6)

    plano = ajustar_fondo(rgb, seguro)

    # Alfa por "exceso de azul" relativo al fondo local.
    exceso = b - (r + g) / 2
    exceso_fondo = np.maximum(plano[..., 2] - (plano[..., 0] + plano[..., 1]) / 2, 12)
    exceso_figura = 4.0
    alfa = 1 - np.clip((exceso - exceso_figura) / (exceso_fondo - exceso_figura), 0, 1)

    # Lo que no toca el fondo es figura sí o sí (reflejos azulados en lentes, camisa).
    cerca_fondo = ndimage.binary_dilation(fondo, iterations=4)
    alfa = np.where(cerca_fondo, alfa, 1.0)
    alfa = np.where(seguro, 0.0, alfa)

    # Limpieza: quedarse con la figura principal y rellenar huecos.
    solida = alfa > 0.5
    lab, n = ndimage.label(solida)
    if n > 1:
        tam = ndimage.sum(solida, lab, range(1, n + 1))
        principal = lab == (1 + int(np.argmax(tam)))
        principal = ndimage.binary_fill_holes(principal)
        alrededor = ndimage.binary_dilation(principal, iterations=10)
        alfa = np.where(alrededor, alfa, 0)
        alfa = np.where(principal & ~cerca_fondo, 1.0, alfa)

    alfa = ndimage.gaussian_filter(alfa, 0.8)
    alfa = np.clip((alfa - 0.04) / 0.92, 0, 1)

    # Quitar el tinte azul de los bordes: F = (P - (1 - a) B) / a
    a3 = alfa[..., None]
    figura = (rgb - (1 - a3) * plano) / np.maximum(a3, 0.08)
    figura = np.where(a3 > 0.98, rgb, figura)
    figura = np.clip(figura, 0, 255)

    rgba = np.dstack([figura, alfa * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA"), alfa


def profundidad(alfa):
    """Relieve aproximado: volumen del contorno + elipsoide de la cabeza + nariz."""
    h, w = alfa.shape
    mascara = alfa > 0.5
    d = ndimage.distance_transform_edt(mascara)
    cuerpo = np.sqrt(d / max(d.max(), 1))

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    sx, sy = w / 1500, h / 2000  # coordenadas medidas sobre el retrato de 1500 x 2000

    def gauss(cx, cy, rx, ry):
        return np.exp(-(((xx - cx * sx) / (rx * sx)) ** 2 + ((yy - cy * sy) / (ry * sy)) ** 2))

    q = 1 - ((xx - 770 * sx) / (440 * sx)) ** 2 - ((yy - 860 * sy) / (620 * sy)) ** 2
    cabeza = np.sqrt(np.clip(q, 0, 1))
    nariz = gauss(815, 900, 62, 130) * 0.22
    boca = gauss(800, 1120, 210, 70) * 0.08
    cuencas = (gauss(600, 760, 95, 55) + gauss(1000, 760, 95, 55)) * -0.07

    z = 0.45 * cuerpo + 0.55 * cabeza + nariz + boca + cuencas
    hombros = np.clip((yy / h - 0.72) / 0.28, 0, 1)
    z = z * (1 - 0.35 * hombros)
    z = ndimage.gaussian_filter(z, 6 * sx)
    z = np.where(mascara, z, 0)
    z = z / max(z.max(), 1e-6)
    return Image.fromarray((z * 255).astype(np.uint8), "L")


def main():
    avatar, alfa = recortar(SRC / "retrato.jpg")
    avatar = avatar.resize((1200, 1600), Image.LANCZOS)
    avatar.save(OUT / "avatar.png", optimize=True)
    avatar.save(OUT / "avatar.webp", quality=88, method=6)

    a_peq = np.asarray(Image.fromarray((alfa * 255).astype(np.uint8)).resize((600, 800), Image.LANCZOS)) / 255.0
    profundidad(a_peq).save(OUT / "avatar-depth.png", optimize=True)

    espejo = Image.open(SRC / "espejo.png").convert("RGB")
    espejo.save(OUT / "espejo.webp", quality=86, method=6)

    # Vista de control sobre fondo neutro para revisar el recorte.
    control = Image.new("RGBA", avatar.size, (128, 128, 128, 255))
    control.alpha_composite(avatar)
    control.convert("RGB").resize((600, 800)).save(RAIZ / "tools" / "control-recorte.jpg", quality=85)
    for f in sorted(OUT.iterdir()):
        print(f.name, f.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
