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
- Clic sobre la camiseta → abre el color de esa parte. Pasar el mouse resalta la
  parte en 3D y en el panel.
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

El contorno de la pieza se toma de la línea de corte sin relleno del grupo o, si
no existe, del `clip-path` que recorta su contenido. Los elementos que quedan
fuera de los grupos (logos, textos) se dibujan encima y se pueden ocultar.
Las piezas se orientan como en un molde estándar: frente y espalda con el cuello
arriba (espalda vista desde atrás), mangas con la copa arriba y el ruedo abajo,
cuello como una tira horizontal.

## Estructura

- `src/svgMold.js` — lectura del SVG, detección de piezas, contornos y paleta.
- `src/garment.js` — geometría 3D generada desde los contornos (cuerpo, mangas,
  cuello y percha) con caída y pliegues de prenda colgada.
- `src/atlas.js` — textura con todas las piezas coloreadas y mapa de tejido.
- `src/main.js` — escena, iluminación de estudio suave y panel de control.
