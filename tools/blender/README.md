# Camiseta desde el molde, en Blender

Prueba del 2 de noviembre de 2026: la camiseta sale del molde real de
Illustrator, cosida y simulada en Blender sobre un cuerpo invisible, y se
renderiza con Cycles (luz de estudio, tela, fondo transparente). El diseño
del molde cae justo donde se sublima, porque el estampado de cada pieza es su
propio molde plano.

```bash
python3.13 -m venv .venv && .venv/bin/pip install -r tools/blender/requirements.txt
PYTHON=.venv/bin/python tools/blender/armar.sh moldes/camiseta/redondo.svg build/blender
```

Pasos (cada uno se puede correr solo):

1. `piezas.py`: lee el contorno de cada pieza (`Frente`, `Espalda`,
   `Manga_izquierda`, `Manga_derecha`), encuentra las esquinas, rellena
   muescas y piquetes de pocos milímetros y corta cada pieza en triángulos
   de ~1,3 cm. Los bordes que se cosen llevan la misma cantidad de puntos en
   las dos piezas, e imprime cuánto mide cada costura de cada lado.
2. `textura.py`: el diseño del molde, en PNG de 6000 px, sin los contornos.
3. `coser.py`: frente y espalda arrancan enrollados alrededor del cuerpo (sin
   estirarlos) y las mangas como tubos alrededor de los brazos. La simulación
   cierra las costuras sin peso y después deja caer la tela. La copa mide un
   poco más que la sisa (en este molde, 2,4 %): ese sobrante se encoge junto a
   la costura para que no se frunza. Guarda la forma final y un `.blend`.
4. `render.py`: une las costuras, suaviza (Taubin, 4 mm como mucho), le da
   espesor, agrega la tira del cuello (rib, color `collar_color`) y renderiza
   frente, espalda y tres cuartos.

Lo que espera del SVG: las piezas dentro de la mesa de trabajo, el contorno
como trazo sin relleno (clase `st9` en el export de Illustrator), unidades en
puntos (1 pt = 0,353 mm) y los textos pasados a contornos (si no, sale otra
letra).

Pendiente: el cuerpo es uno solo (el maniquí de `tools/template/body.py`
agrandado, ~100 cm de pecho); no descuenta márgenes de costura; el ruedo y
los puños son el borde cortado.
