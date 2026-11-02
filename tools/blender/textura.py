"""Textura del diseño a partir del molde SVG: esconde los contornos de las
piezas (si no, quedan como una raya negra en las costuras), lo pasa a PNG con
Chromium y rellena lo transparente alrededor de cada pieza con el color más
cercano, así el borde de la tela no toma el fondo.

    python textura.py molde.svg diseno.png [ancho_px]
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))


def main(svg, dst, width=6000):
    text = open(svg, encoding='utf-8').read()
    # Los contornos: la clase de los trazos sin relleno que usa piezas.py.
    import re
    text = re.sub(r'(\.st9\s*\{[^}]*?)stroke:\s*#[0-9a-fA-F]+;', r'\1stroke: none;', text)
    with tempfile.TemporaryDirectory() as tmp:
        clean = os.path.join(tmp, 'molde.svg')
        raw = os.path.join(tmp, 'molde.png')
        open(clean, 'w', encoding='utf-8').write(text)
        subprocess.run(['node', os.path.join(HERE, 'svg2png.mjs'), clean, raw, str(width)], check=True)
        im = np.asarray(Image.open(raw).convert('RGBA')).astype(np.float32)
    inside = im[..., 3] > 250
    _, (iy, ix) = ndimage.distance_transform_edt(~inside, return_indices=True)
    Image.fromarray(im[..., :3][iy, ix].astype(np.uint8)).save(dst)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6000)
