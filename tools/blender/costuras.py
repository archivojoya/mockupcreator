"""Mapa de relieve de las terminaciones, en el plano del molde (mismas
coordenadas que la textura del diseño): la hundidura de cada costura, el
doble pespunte del ruedo y de los puños, y el pespunte bajo la tira del
cuello. Blanco = tela lisa; más oscuro = más hundido.

    python costuras.py piezas.json costuras.png [ancho_px]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import LineString, Point, Polygon

CM = 72 / 2.54  # unidades del molde por cm


def main(src, dst, width=6000):
    d = json.load(open(src))
    vx, vy, vw, vh = d['viewbox']
    W, H = width, round(width * vh / vw)
    k = W / vw
    px_cm = CM * k

    def to_px(pts):
        return [((x - vx) * k, (y - vy) * k) for x, y in pts]

    seams = Image.new('L', (W, H), 0)
    stitch = Image.new('L', (W, H), 0)
    fold = Image.new('L', (W, H), 0)
    ds, dt, df = ImageDraw.Draw(seams), ImageDraw.Draw(stitch), ImageDraw.Draw(fold)

    def dashed(line, dash_cm=0.3, gap_cm=0.12, width_px=3):
        L = line.length
        s = 0.0
        while s < L:
            a, b = line.interpolate(s), line.interpolate(min(L, s + dash_cm * CM))
            dt.line(to_px([(a.x, a.y), (b.x, b.y)]), fill=255, width=width_px)
            s += (dash_cm + gap_cm) * CM

    def inside_offset(line, poly, dist_cm):
        for sgn in (1, -1):
            off = line.offset_curve(sgn * dist_cm * CM)
            if off.is_empty:
                continue
            if off.geom_type == 'MultiLineString':
                off = max(off.geoms, key=lambda g: g.length)
            if poly.contains(Point(off.interpolate(0.5, normalized=True).coords[0])):
                return off
        return None

    for pc in d['pieces']:
        uv = pc['uv']
        ring = uv[:pc['boundary']]
        poly = Polygon(ring)
        off = pc['offset']
        for name, ids in pc['edges'].items():
            pts = [uv[i - off] for i in ids]
            line = LineString(pts)
            if name in ('hem',):
                # Ruedo doblado y cosido con recubridora de dos agujas.
                for dist in (2.0, 2.6):
                    o = inside_offset(line, poly, dist)
                    if o is not None:
                        dashed(o)
                band = line.buffer(2.9 * CM)
                fold_poly = band.intersection(poly)
                if not fold_poly.is_empty:
                    geoms = getattr(fold_poly, 'geoms', [fold_poly])
                    for g in geoms:
                        df.polygon(to_px(list(g.exterior.coords)), fill=255)
            elif name == 'neck':
                o = inside_offset(line, poly, 0.6)
                if o is not None:
                    dashed(o)
            else:
                ds.line(to_px(pts), fill=255, width=3)

    # Hundidura de las costuras: suave, unos 2,5 mm a cada lado.
    dist = ndimage.distance_transform_edt(np.asarray(seams) == 0)
    groove = np.exp(-(dist / (0.25 * px_cm)) ** 2)
    # Pespuntes: líneas finas hundidas, apenas suavizadas.
    st = ndimage.gaussian_filter(np.asarray(stitch).astype(float) / 255, 0.8)
    # El ruedo doblado tiene doble tela: un poco más alto.
    fd = ndimage.gaussian_filter(np.asarray(fold).astype(float) / 255, 0.15 * px_cm)
    h = 0.75 - 0.6 * groove - 0.45 * st + 0.2 * fd
    h = np.clip(h, 0, 1)
    Image.fromarray((h * 65535).astype(np.uint16)).save(dst)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6000)
