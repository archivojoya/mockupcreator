# Mockup de camiseta 3D

Visor en three.js que arma una camiseta realista a partir de un **molde SVG** y la
muestra de dos maneras: **sostenida** por un maniquí invisible (como en las fotos
de catálogo) y **colgada** de una percha, con tela mate y sin brillos.

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # versión estática en dist/
```

Se abre con un molde de ejemplo (`public/molde-futbol.svg`, también está
`public/molde-ejemplo.svg`). Con **Cargar molde SVG** (o arrastrando el archivo a
la ventana) se carga cualquier otro molde.

- **Presentación**: sostenida y colgada lado a lado, o cualquiera de las dos de
  frente y de espaldas.
- **Partes**: cada pieza (frente, espalda, mangas, cuello) tiene su color base y
  un interruptor para mostrar u ocultar el diseño del SVG encima.
- **Colores del diseño**: reemplaza globalmente cualquier color del estampado.
- Cada camiseta gira sola: arrastrala (con inercia) o pasá el mouse por encima
  para girarla un poco; la pared queda quieta. La rueda acerca hacia donde
  apunta el mouse, arrastrar el fondo (o el botón derecho) desplaza la vista y
  las flechas del teclado giran las dos.
- Clic sobre la camiseta → abre el color de esa parte. Pasar el mouse por la
  lista de partes la resalta en 3D.
- **Descargar PNG** guarda el render actual en alta resolución.

## Camiseta deportiva paramétrica

`camiseta.html` (en desarrollo: `http://localhost:5173/camiseta.html`) es una
prueba aparte, hecha desde cero: una camiseta deportiva de cuello redondo
modelada directamente con código, sin moldes, sin Blender y sin simulación. Se
ve flotando con volumen, como puesta en un cuerpo invisible.

- **Presentación**: con cuerpo (forma fija, como puesta) o colgada de una percha
  de madera, con la tela simulada en vivo: al pasar el mouse la tela se empuja y
  se balancea, y después se acomoda sola (en el celular, con un toque).
- **Forma**: calce (ajustado, regular, holgado), largo, largo de manga, apertura
  de mangas y profundidad del escote. La malla se rehace al instante.
- **Colores** por parte: cuerpo, mangas, cuello y puños.
- **Mapa de estampado**: muestra una grilla de 5 cm con el nombre de cada pieza,
  para ver cómo caería un diseño. Las coordenadas de textura están en metros
  sobre la tela, listas para estampar más adelante.
- **Ficha**: contorno de pecho, ancho de hombros, largo y boca de manga.

Cómo se arma (`src/camiseta/shirt.js`):

- **Torso**: anillos horizontales desde el ruedo hasta el escote. Cerca del
  escote cada columna se curva hacia el contorno del cuello; a los costados esa
  curva es la línea del hombro.
- **Sisas**: un hueco en la grilla del torso a cada lado, deformado hasta
  quedar ovalado. La manga arranca exactamente de ese borde, así la costura
  queda cerrada.
- **Mangas**: de la sisa a un ruedo circular alrededor del eje del brazo, con
  puño aparte.
- **Cuello y dobladillos**: tira acanalada sobre el escote; ruedo y puños se dan
  vuelta hacia adentro y muestran el espesor de la tela.
- **Terminación**: pliegues suaves (caída hacia el ruedo, tensiones desde la
  axila), costuras hundidas, pespunte doble en ruedo y puños, y relieve de malla
  deportiva.

La versión colgada (`src/camiseta/drape.js`) simula la tela con dinámica de
posiciones sobre una malla a media resolución de la misma camiseta; la malla fina
que se ve sigue a la gruesa y el cuello y los dobladillos acompañan a su borde.
La camiseta arranca con la forma puesta y cae sobre la percha: la tela que se
apoya arriba de la barra queda adherida, unas ataduras de largo máximo evitan
que se estire con su peso, frente y espalda no se cruzan y la copa de la manga
conserva algo de cuerpo. Cuando la tela se queda quieta la simulación se duerme.

## Cómo preparar el SVG

Cada pieza debe estar en un grupo (`<g>`) cuyo id contenga:

| Parte           | id del grupo (ejemplos)                   |
| --------------- | ----------------------------------------- |
| Frente          | `frente`, `front`, `TALLE_3_frente`       |
| Espalda         | `espalda`, `back`                         |
| Manga izquierda | `manga_izquierda`, `sleeve_left`          |
| Manga derecha   | `manga_derecha`, `sleeve_right`           |
| Cuello          | `cuello`, `collar`                        |

Si las mangas se llaman sólo `manga` (por ejemplo `manga` y `manga-2`), se
asignan por posición: la de más a la derecha en el molde es la izquierda.

El contorno de la pieza se toma de la línea de corte sin relleno del grupo o, si
no existe, del `clip-path` que recorta su contenido. Los elementos que quedan
fuera de los grupos (logos, textos) se dibujan encima y se pueden ocultar.
Las piezas se orientan como en un molde estándar: frente y espalda con el cuello
arriba (espalda vista desde atrás), mangas con la copa arriba y el ruedo abajo,
cuello como una tira horizontal.

## Cómo funciona

La forma 3D no se calcula con cada molde: son dos **plantillas**, una camiseta
"ideal" simulada una sola vez con el simulador de tela de Blender (con su molde
plano como forma en reposo, costuras y gravedad):

- **Colgada:** cuelga de la percha, que actúa como sólido.
- **Sostenida:** vestida sobre un maniquí invisible. Como en un programa de
  confección, cada pieza arranca curvada alrededor del cuerpo (curvarla así no
  la estira) y las costuras se cierran solas: primero hombros y costados,
  después las mangas, que arrancan pegadas a la sisa. Al final un suavizado
  borra el rizado fino que deja el contacto con el maniquí.

Las dos comparten la malla, así que cada molde del cliente se **estampa** igual
sobre cualquiera:

- **Frente y espalda:** cada punto de la plantilla conoce su lugar en el molde
  canónico. Una deformación suave (thin plate spline) lleva ese molde al del
  cliente haciendo coincidir los contornos tramo a tramo: escote con escote,
  hombros, sisas, costados y ruedo. El diseño cae donde corresponde aunque las
  proporciones del molde sean otras.
- **Mangas:** cada punto conoce su posición a lo largo de la sisa y de la copa
  al ruedo, y se ubica en la manga del cliente con la misma parametrización
  (la cabeza de la copa va al hombro, sus esquinas a la axila).
- **Cuello:** una tira acanalada sobre el contorno del escote, suavizado para
  que sea redondo. Si el molde no trae cuello, toma el color dominante.
- Si el molde no trae mangas, se pintan con el color del frente.

Así la caída es siempre la de una prenda real (hombros apoyados, mangas que
caen plegándose en la sisa, costados que se pliegan y se enciman) y no depende
de cómo esté dibujado cada molde: el molde sólo aporta el diseño.

### Regenerar las plantillas

Sólo hace falta si se cambia el molde canónico, la percha, el maniquí o la tela:

```bash
pip install bpy                      # Blender como módulo de Python
npm run template                     # o PYTHON=/ruta/python tools/template/build.sh [colgada|sostenida]
```

1. `tools/template/canonical.mjs` — molde canónico (hombros poco caídos,
   cuello redondo, copa sin frunces).
2. `tools/template/export-initial.mjs` — forma inicial, costuras, fijaciones
   (borde del escote y hombros) y percha, con el generador de `src/garment.js`.
3. `tools/template/drape_blender.py` — simula la caída en Blender: frente y
   espalda chocan entre sí (no se atraviesan), las costuras se mantienen
   cerradas y el aire amortigua el balanceo hasta que la prenda se asienta.
   Con `{"body": true}` arma la camiseta sobre el maniquí de
   `tools/template/body.py` en lugar de colgarla.
4. `tools/template/finalize.mjs` — cierra cada costura en un punto común y
   guarda `src/assets/tshirt-template.json` (colgada) o
   `src/assets/tshirt-maniqui.json` (sostenida), con posiciones en 16 bits.

El molde de ejemplo de fútbol se genera sobre el molde canónico con
`node tools/demo-mold.mjs`.

## Estructura

- `src/svgMold.js` — lectura del SVG, detección de piezas, contornos y paleta.
- `src/template.js` — arma la camiseta desde una plantilla (colgada o
  sostenida) y estampa el molde.
- `src/garment.js` — análisis de las piezas del molde (puntos notables,
  parametrización de la manga), percha, y el generador de la forma inicial
  que usa la herramienta de la plantilla.
- `src/drape.js` — simulación simple usada por el generador de la forma inicial.
- `src/bakeAO.js` — sombras de pliegues (oclusión ambiental) calculadas una vez
  por vértice al cargar el molde.
- `src/atlas.js` — textura con todas las piezas coloreadas, dobladillo con
  costura y mapa de relieve del tejido.
- `src/main.js` — escena, iluminación de estudio suave y panel de control.
- `camiseta.html` y `src/camiseta/` — la camiseta deportiva paramétrica:
  `shirt.js` (geometría), `drape.js` (versión colgada: percha y simulación de
  la tela), `fabric.js` (texturas de la tela), `main.js` (escena y controles) y
  `style.css`.

## Rendimiento

Al cargar un molde sólo se estampa el diseño sobre las plantillas y se calculan
las sombras de los pliegues: no hay simulación en la página. A partir de ahí la
escena queda quieta y sólo se redibuja cuando se mueve la cámara o cambia un
color, así que girar es fluido incluso en equipos modestos.
