"""Junta vistas PNG transparentes en una lámina sobre un fondo liso.

    python lamina.py [--fondo=#ececea] salida.jpg vista1.png vista2.png ...
"""
import sys

from PIL import Image

args = sys.argv[1:]
bg = '#ececea'
if args[0].startswith('--fondo='):
    bg = args.pop(0).split('=', 1)[1]
rgb = tuple(int(bg[i:i + 2], 16) for i in (1, 3, 5))
ims = [Image.open(p).convert('RGBA') for p in args[1:]]
out = Image.new('RGBA', (sum(i.width for i in ims), max(i.height for i in ims)), rgb + (255,))
x = 0
for i in ims:
    out.alpha_composite(i, (x, 0))
    x += i.width
out.convert('RGB').save(args[0], quality=92)
