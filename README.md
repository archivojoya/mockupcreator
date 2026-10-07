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

Si las mangas se llaman sólo `manga` (por ejemplo `manga` y `manga-2`), se
asignan por posición: la de más a la derecha en el molde es la izquierda.
| Cuello          | `cuello`, `collar`                        |

El contorno de la pieza se toma de la línea de corte sin relleno del grupo o, si
no existe, del `clip-path` que recorta su contenido. Los elementos que quedan
fuera de los grupos (logos, textos) se dibujan encima y se pueden ocultar.
Las piezas se orientan como en un molde estándar: frente y espalda con el cuello
arriba (espalda vista desde atrás), mangas con la copa arriba y el ruedo abajo,
cuello como una tira horizontal.

## Estructura

- `src/svgMold.js` — lectura del SVG, detección de piezas, contornos y paleta.
- `src/garment.js` — geometría 3D generada desde los contornos (cuerpo, mangas,
  cuello y percha) y preparación de la simulación (costuras, fijaciones).
- `src/drape.js` — simulación de caída de la tela: las piezas usan los largos
  reales del molde, se cosen entre sí y cuelgan de la percha con gravedad.

## Cómo se cosen las piezas

Para que funcione con cualquier molde, las costuras siguen reglas fijas, sin
depender del dibujo concreto:

- **Sisa ↔ copa de la manga:** se busca en el frente y la espalda el borde
  entre el punto del hombro y la axila. La primera fila de la manga se arma
  sobre esos mismos vértices, soldada a ellos, como el cuello sobre el escote.
  El punto más alto de la copa va al hombro y sus esquinas a la axila. El
  resto se reparte en proporción al largo.
- **Costados y hombros:** frente y espalda se unen donde sus bordes coinciden.
- **Cuello:** se construye sobre el contorno del escote.
- **Bajo del brazo:** la manga se cierra uniendo sus dos costados.
- `src/bakeAO.js` — sombras de pliegues (oclusión ambiental) calculadas una vez
  por vértice cuando la tela se asienta.
- `src/atlas.js` — textura con todas las piezas coloreadas, dobladillo con
  costura y mapa de relieve del tejido.
- `src/main.js` — escena, iluminación de estudio suave y panel de control.

## Rendimiento

Al cargar un molde la tela se acomoda en un par de segundos y después se
calculan las sombras de los pliegues. A partir de ahí la escena queda quieta:
las sombras ya están calculadas y sólo se redibuja cuando se mueve la cámara o
cambia un color, así que girar es fluido incluso en equipos modestos.
