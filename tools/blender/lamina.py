# Junta vistas PNG transparentes en una lámina sobre gris claro: python lamina.py salida.png a.png b.png ...
import sys
from PIL import Image
ims = [Image.open(p).convert('RGBA') for p in sys.argv[2:]]
W = sum(i.width for i in ims); H = max(i.height for i in ims)
out = Image.new('RGBA', (W, H), (236, 236, 234, 255))
x = 0
for i in ims:
    out.alpha_composite(i, (x, 0)); x += i.width
out.convert('RGB').save(sys.argv[1], quality=92)
