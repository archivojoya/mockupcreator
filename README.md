# Mockup de camiseta 3D

Visor en three.js que arma una camiseta realista a partir de un **molde SVG** y la
muestra duplicada (una de frente y otra de espaldas), colgada de una percha, con
tela mate y sin brillos.

## Uso

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # versión estática en dist/
```

Se abre con `public/molde-ejemplo.svg`. Con **Cargar molde SVG** (o arrastrando el
archivo a la ventana) se carga cualquier otro molde.

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

La forma 3D no se calcula con cada molde: es una **plantilla**, una camiseta
"ideal" que ya cuelga de la percha, simulada una sola vez con el simulador de
tela de Blender (con su molde plano como forma en reposo, costuras, gravedad y
la percha como sólido). Cada molde del cliente se **estampa** sobre ella:

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

### Regenerar la plantilla

Sólo hace falta si se cambia el molde canónico, la percha o la tela:

```bash
pip install bpy                      # Blender como módulo de Python
npm run template                     # o PYTHON=/ruta/python tools/template/build.sh
```

1. `tools/template/canonical.mjs` — molde canónico (hombros poco caídos,
   cuello redondo, copa sin frunces).
2. `tools/template/export-initial.mjs` — forma inicial, costuras, fijaciones
   (borde del escote y hombros) y percha, con el generador de `src/garment.js`.
3. `tools/template/drape_blender.py` — simula la caída en Blender: frente y
   espalda chocan entre sí (no se atraviesan), las costuras se mantienen
   cerradas y el aire amortigua el balanceo hasta que la prenda se asienta.
4. `tools/template/finalize.mjs` — cierra cada costura en un punto común y
   guarda `src/assets/tshirt-template.json` (posiciones en 16 bits).

## Estructura

- `src/svgMold.js` — lectura del SVG, detección de piezas, contornos y paleta.
- `src/template.js` — arma la camiseta desde la plantilla y estampa el molde.
- `src/garment.js` — análisis de las piezas del molde (puntos notables,
  parametrización de la manga), percha, y el generador de la forma inicial
  que usa la herramienta de la plantilla.
- `src/drape.js` — simulación simple usada por el generador de la forma inicial.
- `src/bakeAO.js` — sombras de pliegues (oclusión ambiental) calculadas una vez
  por vértice al cargar el molde.
- `src/atlas.js` — textura con todas las piezas coloreadas, dobladillo con
  costura y mapa de relieve del tejido.
- `src/main.js` — escena, iluminación de estudio suave y panel de control.

## Rendimiento

Al cargar un molde sólo se estampa el diseño sobre la plantilla y se calculan
las sombras de los pliegues: no hay simulación en la página. A partir de ahí la
escena queda quieta y sólo se redibuja cuando se mueve la cámara o cambia un
color, así que girar es fluido incluso en equipos modestos.
