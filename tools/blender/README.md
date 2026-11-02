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
3. `costuras.py`: mapa de relieve en el plano del molde: la hundidura de cada
   costura, el doble pespunte del ruedo y los puños (a 2 y 2,6 cm del borde,
   con el doblez un poco más alto) y el pespunte bajo la tira del cuello.
4. `coser.py`: frente y espalda arrancan enrollados alrededor del cuerpo (sin
   estirarlos) y las mangas como tubos alrededor de los brazos abiertos a 42°.
   La simulación cierra las costuras sin peso, deja caer la tela y después
   baja los brazos despacio hasta 32°: cosiendo con los brazos bajos, la axila
   quedaba aplastada entre brazo y torso y las costuras no se juntaban. La
   copa mide un poco más que la sisa (en este molde, 2,4 %): ese sobrante se
   encoge junto a la costura para que no se frunza. Guarda la forma final y un
   `.blend`.
5. `render.py`: une las costuras, suaviza (Taubin, 9 mm como mucho: borra los
   bollos sin tocar la caída), le da espesor, agrega la tira del cuello (rib,
   inclinada hacia el cuello) y renderiza frente, espalda y tres cuartos con
   las luces girando con la cámara (la espalda se ilumina como el frente).
   Con `plain` sale todo de un color liso, sin el diseño.

El maniquí (en `coser.py`) es para este molde (116 cm de pecho): un torso
más ancho que hondo y lleno hasta la cadera, con la espalda alta 1,5 cm más
salida que el pecho (sin omóplatos a la espalda le sobraba largo y hacía
ondas), y brazos más gruesos que los de verdad y angostos de costado (llenan
la manga y dejan lugar en la axila). La forma se comparó con referencias de
mockups de Demian (camiseta blanca de frente y espalda).

Lo que espera del SVG: las piezas dentro de la mesa de trabajo, el contorno
como trazo sin relleno (clase `st9` en el export de Illustrator), unidades en
puntos (1 pt = 0,353 mm) y los textos pasados a contornos (si no, sale otra
letra).

Pendiente: el cuerpo es uno solo (para otros talles hay que agrandarlo o
achicarlo); no descuenta márgenes de costura; la trama de la tela (`knit`)
casi no se ve a 1600 px; quedan bollos suaves en la espalda baja.
