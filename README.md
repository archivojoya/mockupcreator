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
prueba aparte, hecha desde cero: una camiseta deportiva de cuello redondo o en V
modelada directamente con código, sin moldes, sin Blender y sin simulación. Se
ve flotando con volumen, como puesta en un cuerpo invisible.

- **Frente y espalda a la vez**: hay dos camisetas lado a lado (la misma, con
  la misma simulación): la de la izquierda muestra el frente y la de la
  derecha la espalda, tan cerca como permite su ancho. **Perfiles** las gira
  para mostrar los dos costados, mirándose; **Frente y espalda** vuelve.
  Arrastrar sobre una camiseta la gira sólo a ella, sobre su eje (arriba y
  abajo inclina la cámara); la rueda o el pellizco acercan, hacia donde está
  el mouse. **Pecho**, **Espalda alta** y **Cuello** llevan la cámara cerca de
  la tela (el pecho y el escote de la de la izquierda, la espalda de la de la
  derecha), aunque estén colgadas o giradas; **Etiqueta** (si hay una) va a
  la del ruedo. **Girar solas** gira cada una
  sobre su eje. El mouse empuja la tela de cualquiera de las dos.

- **Presentación**: con cuerpo (forma fija, como puesta), en percha o con
  broches. La percha es de madera, plana y paralela a la camiseta, con el arco
  de una percha de verdad y bordes definidos; apoya bajo la costura de los
  hombros. Los dos broches cuelgan de una barra y pellizcan la costura de cada
  hombro, como un broche de pinza: la costura arriba, el frente contra la
  mordaza de adelante y la espalda contra la de atrás. Los ganchos calzan en
  la barra de un perchero que baja del techo; son giratorios: la curva queda
  en la barra y la percha gira debajo. Colgada, la tela se simula en vivo: al pasar el mouse
  se empuja y se balancea, y después se acomoda sola (en el celular, con un
  toque).
- **Forma**: calce (ajustado, regular, holgado), largo, largo de manga, apertura
  de mangas, cuello (redondo o en V) y profundidad del escote. La malla se rehace
  al instante. El cuello en V tiene el mismo ancho que el redondo; sus patas
  bajan de cada hombro a la punta apenas abombadas hacia afuera (como el
  redondo, pero en punta); adelante la tira va acostada sobre el pecho, con el
  mismo ancho en toda la V, y sus dos puntas se juntan en una costura que
  también se respeta colgada.
- **Tela**: siete tejidos (malla deportiva, piqué, panal, jersey liso,
  acanalada, jacquard con rayas tono sobre tono y microperforada con zonas
  caladas a los costados y bajo los brazos), más tres controles:
  - **Calidad**: económica (brillo plástico, tejido y teñido desparejos,
    bolitas, costuras fruncidas), estándar o premium (mate con un brillo suave
    y parejo, relieve nítido).
  - **Peso** (120 a 220 g/m²): colgada, la tela pesada hace pliegues más amplios,
    guarda más volumen y el mouse la mueve menos.
  - **Jaspeado**: hilos de otro tono a lo largo de las pasadas (melange).
  De lejos el relieve es más chico que un píxel: se pasa a aspereza, así la
  tela no se ve plástica. Una textura grande con irregularidades evita que se
  note la repetición.
- **Luz**: estudio, pareja (luz amplia de frente: lo que mira de frente se ve
  con el color elegido tal cual, para comparar colores), contraste (rasante,
  marca el relieve y los pliegues) y día (sol cálido y cielo azulado).
- **Colores** por parte: cuerpo, mangas, cuello y puños.
- **Diseño propio** (`src/camiseta/print.js`): se cargan uno o varios SVG
  (o PNG, JPG o WebP) con sólo el diseño de cada pieza (frente, espalda,
  manga, puño, cuello, tapacostura o etiqueta: lo
  dice el nombre del archivo, o el de cada capa si vienen todas en un
  archivo; manga y puño van a los dos lados salvo que digan izquierda o
  derecha). **Medidas para diseñar** da el ancho y el alto de cada pieza para
  la camiseta tal como está. La página ubica cada diseño en su molde,
  centrado y arriba (el cuello, centrado en el medio de atrás y dando la
  vuelta): si el SVG dice su tamaño en unidades reales (mm, cm, in, pt) va a
  ese tamaño; si no, se agranda o achica hasta cubrir la pieza. Cargar otra
  pieza la reemplaza sólo a ella, y al cambiar una medida los diseños se
  vuelven a ubicar. Frente y espalda son un molde común: la tela aplanada
  como se corta (hombros rectos, sin la curva del cuerpo), así lo que se
  dibuja recto queda recto en la camiseta, con cuerpo y colgada.
  - **Escudo, marca, dorsal y nombre**: dentro del diseño, un grupo (o
    capa) llamado "escudo" va bordado (o sublimado, desde el panel); los
    llamados "marca" (o "logo"), "dorsal" (o "número") y "nombre" van
    sublimados o en vinilo termoadhesivo. El sponsor va con el resto del
    diseño. El bordado sube 1,1 mm con el borde redondeado, deja una sombra
    alrededor y tiene puntadas de relleno (se ven al acercar) y hilo con
    brillo; el vinilo es liso, semimate, con un borde fino y más reflejo.
  - **Tapacostura**: una tira fina por dentro de la espalda, de hombro a
    hombro: cubre los últimos 7 mm de la cara de adentro del cuello, envuelve
    su borde y baja pegada a la tela. Un archivo con "tapacostura" en el
    nombre lleva su diseño (unos 21 × 0,8 cm, se lee derecho desde adentro;
    se ve entero de frente, por el escote); si no, va lisa del color del
    cuello.
  - **Etiqueta**: una etiqueta tejida de 1,6 × 2,1 cm cosida por afuera
    bajo el pespunte del ruedo, abajo a la derecha del frente (a 6 cm del
    costado), que envuelve el borde y sigue por dentro, como las de verdad.
    Aparece al cargar un archivo con "etiqueta" en el nombre: su diseño se
    teje (los colores principales en una grilla de hilos de 0,25 mm, con
    bordes escalonados) y la trama marca relieve (hilos horizontales en el
    fondo, en diagonal en el dibujo). Sigue al ruedo colgada; el
    acercamiento **Etiqueta** la muestra de cerca.
  - **Revés**: por dentro no se ve el estampado; la tela es lisa, del color
    que más hay en el diseño de cada pieza.
  - **Plantilla completa** (opcional) baja un SVG a escala 1:1 (mm) con
    todas las piezas en sus recuadros (contorno, centro, grilla de 5 cm y
    cruz de anclaje); lo que se dibuja dentro de cada recuadro va a esa pieza.
  Antes de exportar: textos a contornos, imágenes incrustadas, colores RGB.
- **Mapa de estampado**: muestra una grilla de 5 cm con el nombre de cada pieza.
- **Ficha**: contorno de pecho, ancho de hombros, largo, boca de manga y tela.
- **Configuración sin tocar código**: si la página trae un bloque
  `<script type="application/json" id="camiseta-config">` con `params`
  (incluido `neckStyle`: `round` o `v`), `colors`, `fabric` (`weave`,
  `quality`, `weight`, `heather`), `light` (`studio`, `soft`, `contrast` o
  `day`), `mode` (`body`, `hanger` o `clips`), `spin`, `uvmap`, `design`
  (lista de `{ name, text }` con el SVG de cada pieza, o la plantilla
  completa como texto) o `kinds` (`{ "crest": "emb", "brand": "vin",
  "number": "print", "name": "print" }`: bordado, vinilo o estampado),
  arranca con esos valores (y "Restablecer todo" vuelve a ellos).

Cómo se arma (`src/camiseta/shirt.js`):

- **Torso**: anillos horizontales desde el ruedo hasta el escote. Cerca del
  escote cada columna se curva hacia el contorno del cuello; a los costados esa
  curva es la línea del hombro. Visto desde arriba, el contorno del cuello es
  una D: adelante baja 8 cm por delante de los hombros y atrás es casi plano
  (3,5 cm), como un escote real. La espalda sube de la axila al cuello con una
  pendiente pareja: sin escalón bajo el cuello, así lo que se estampa ahí (un
  logo, un nombre) mira hacia atrás y no hacia arriba.
- **Sisas**: un hueco en la grilla del torso a cada lado, deformado hasta
  quedar ovalado. La manga arranca exactamente de ese borde, así la costura
  queda cerrada.
- **Mangas**: de la sisa a un ruedo circular alrededor del eje del brazo, con
  puño aparte.
- **Cuello y dobladillos**: tira acanalada sobre el escote; ruedo y puños se dan
  vuelta hacia adentro y muestran el espesor de la tela.
- **Terminación**: pliegues suaves (caída hacia el ruedo, tensiones desde la
  axila), costuras hundidas y pespunte doble en ruedo y puños. El relieve, el
  tono y el brillo punto a punto de cada tejido se generan en canvas
  (`src/camiseta/fabric.js`).

La versión colgada (`src/camiseta/drape.js`) simula la tela con dinámica de
posiciones sobre una malla a media resolución de la misma camiseta; la malla fina
que se ve sigue a la gruesa y el cuello y los dobladillos acompañan a su borde.
La camiseta arranca con la forma puesta y cae sobre la percha (la tela que se
apoya arriba de la barra queda adherida) o queda sostenida por los broches (los
puntos que pellizcan quedan fijos: la costura y, a cada lado, el frente y la
espalda; así la espalda no se escapa hacia abajo y no queda un hueco entre el
cuello y los hombros). Unas ataduras de largo máximo
hacia los dos hombros evitan que se estire con su peso. La tira del cuello es una
cinta simulada, cosida al escote: no se estira (sus uniones se resuelven varias
veces por paso), no se dobla de canto y no se da vuelta sobre la costura, pero
se achata libre: en la percha la abertura queda como un óvalo finito, el frente
cae en U delante de la barra y la espalda apoya contra ella, como una camiseta
colgada de verdad (si la tira recordara la vuelta alrededor del cuello, armaría
un aro que empuja el frente y arruga los hombros). En V la tira se cose estirada y
frunce apenas el escote: en el molde plano del frente las patas de la V quedan
un 30 % más cortas que puestas (repartido en la tela de alrededor, que queda
plana, sin burbujas bajo la punta) y la tira sigue al escote. Colgada, la V se
hace unos 3 cm más honda que puesta, como el cuello redondo. Con broches nada sostiene el
cuello atrás (entre los broches) ni el hombro de afuera del broche: ahí cada
tramo de unos 10 cm de la tira guarda algo de su forma puesta (si no, la
espalda del cuello cae y se embolsa), se guarda menos volumen arriba y la copa
de la manga cede más. Frente, espalda y mangas guardan algo del volumen que
tenían puestas (más arriba, casi nada en el ruedo), y la copa de la manga
conserva algo de cuerpo. La tela tiende a su molde plano (frente y espalda
aplanados como se cortan, cada unión con su largo en la pieza plana) y no a la
forma puesta: si recordara la curva de hombros, pecho y espalda, al quedar
plana se arrugaría (pliegues junto al cuello y bajo los hombros) y deformaría
el diseño; así un diseño recto cuelga recto.

Ninguna parte de la tela atraviesa a otra: cada punto de la simulación tiene un
grosor de 1,1 cm y ningún punto que en la tela esté lejos puede acercarse más
que eso (manga contra cuerpo, frente contra espalda, pliegues); los que a lo
largo de la tela están a menos de 4,5 cm no chocan entre sí (en la axila, por
ejemplo, la manga y la espalda están cerca sin ser capas distintas); entre
manga y torso ese margen es de sólo 1,2 cm, así la copa de la manga no
atraviesa el torso junto a la sisa. El centro de
cada celda de la malla también choca, así ningún punto pasa por el medio de una
celda grande. Los pares cercanos se buscan con una grilla espacial sólo cuando
algún punto se movió más de medio grosor desde la última búsqueda, y en cada
paso sólo se revisan esos pares; además ningún punto se mueve más de 4 mm por
paso, así un empujón fuerte no hace que una capa salte a través de otra. Los
dobladillos siguen la curva de su propia tela. En reposo la camiseta cuelga
simétrica: la forma de partida y todas las uniones se arman simétricas, la tela
se mueve libre y, cuando se aquieta, el lado derecho (visto de frente) se
acomoda en medio segundo como espejo del izquierdo. Pasado un rato sin
empujones el aire frena un poco más, así no quedan balanceos lentos. Después
la simulación se duerme (como mucho 8 s después del último empujón).

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
  `shirt.js` (geometría), `drape.js` (versión colgada: percha, broches y
  simulación de la tela), `fabric.js` (texturas de la tela), `main.js` (escena y controles) y
  `style.css`.

## Rendimiento

Al cargar un molde sólo se estampa el diseño sobre las plantillas y se calculan
las sombras de los pliegues: no hay simulación en la página. A partir de ahí la
escena queda quieta y sólo se redibuja cuando se mueve la cámara o cambia un
color, así que girar es fluido incluso en equipos modestos.
