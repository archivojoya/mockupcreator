# mockupcreator

Mockups 3D de prendas deportivas con three.js (`camiseta.html`, código en
`src/camiseta/`). El README explica cada parte; la skill de cuenta
`camiseta-3d` lleva la página y sus lecciones (`references/motor.md`), pero
quedó atrás: no tiene musculosa, tank top, short ni personalización. La fuente
es este repo.

## Para qué es

Los mockups de los pedidos reales de Demian (diseño y sublimación de ropa
deportiva), para mandarle al cliente una lámina de muestra y para sacar flyers
y motion (PNG grande con fondo transparente, giros, el modelo 3D). Clientes y
lo que piden:

- **Pádel y marcas (LLAQTA):** casi siempre camiseta cuello redondo y tank top.
- **Walter** (conjuntos de fútbol): camiseta redonda y en V, musculosa,
  musculosa de básquet cuello en V, remera con molde femenino, chomba, short.
- **Penuel + Worship Wear:** como Walter, un poco menos (redonda, V, femenina,
  musculosa femenina, short). Worship hace además remerones de danza de mujer
  y de varón (el molde de la camiseta alargado hacia abajo, con una abertura
  al costado), remeras oversize y pantalones.

Demian usa casi siempre los mismos moldes: el catálogo de prendas es corto.

## Decisiones (24 de octubre de 2026)

- **Camiseta cuello redondo y tank top, congeladas.** Son las que están en
  producción (artifacts «Camiseta Deportiva 3D» y «Tank Top Deportivo»,
  publicados desde `eff8e34`). Sólo se tocan para arreglar algo de esas dos, y
  antes de publicar se comparan con capturas de `eff8e34` en percha y con
  broches.
- **Prendas nuevas con la caída fija, no simulada en vivo.** Cambiar el cuello
  o la manga movía toda la simulación (se inflaba de un lado, la percha y los
  broches perdían forma) y arreglar una prenda rompía otra. Ahora cada prenda
  nueva se cuelga una vez, se aprueba mirándola y su forma queda guardada en
  un archivo por prenda y presentación. Colores, tela y diseño siguen en vivo
  (son textura); el peso de la tela sí cambia la caída, así que se fija al
  guardar. Cambiar de cuello es elegir otra prenda ya aprobada.
- **La tela que se mueve con el mouse** queda para el perchero del catálogo
  (todas camisetas cuello redondo, sin ajustes de forma).
- **Orden:** 1) remerón de danza (Worship), 2) lo de Walter (básquet cuello V,
  musculosa, remera femenina).
- **La vara:** una prenda en 3D tiene que salir más rápido que el mockup a
  mano. Si no, no está lista.
- **Descartado:** coser los moldes SVG en Blender (artifact «Molde a 3D
  LLAQTA», principios de octubre). De cerca no convencía y la página pesaba
  mucho. La base es three.js con la tela de `fabric.js`.

## Nombres compartidos con escalado

Los scripts de Illustrator de `archivojoya/escalado` leen las piezas por
nombre, y el mockup tiene que usar los mismos para que un diseño exportado
de Illustrator caiga solo en su pieza:

- Capa «Diseño» (diseño base, un talle): `frente`, `espalda`, `manga`
  (`MANGA (derecha)` / `MANGA (izquierda)`), `manga larga`, `cuello`; el short,
  `short derecha numero`, `short izquierda escudo` (el rol va en el nombre).
- Capa «Escala» (moldes por talle): `L / frente (r)`, `L / frente (v)`,
  `L / espalda`, `L / manga`. Los talles femeninos llevan F adelante (`FS`,
  `FM`, `F2XL`, `F12`).

## Criterios estéticos (para todas las prendas)

Es un mockup: manda cómo se ve, no la física exacta.

- Lisa ante todo: nada de arrugas que no se pidieron. Recortar tela,
  esconder una pieza o hacer un truco está bien si las evita.
- Pliegues de terminación sólo donde tienen sentido (los que salen de la
  axila, sólo con mangas).
- La tira del cuello alcanza justo: sin tela de más que la doble o la tuerza.
  Con escote hondo va acostada sobre el pecho (parada se torcía a lo largo de
  la pata). Medir, por tramo, el borde de arriba contra la costura: nunca más
  largo.
- Puños y vivos con cuerpo, apoyados sobre la tela (envuelven el borde);
  colgados siguen la tela sin levantarse.
- Bordes de huecos en curvas sin quiebres: si la grilla dobla en un punto, se
  promedia el borde a lo largo de sí mismo.
- Colgada, cada pieza tiende a su molde aplanado: las costuras tienen que
  medir lo mismo en las dos piezas, y los acortamientos van lejos de ellas.
- Con broches, la tira del cuello queda parada en los costados.
- Variantes de una prenda (cuello redondo o en V, hondo del escote, sisa
  más grande): la misma tela y el mismo molde, sólo cambia el corte. El
  estampado sale del molde de referencia, así un diseño cae igual en todas.
  Aplanar cada variante por su lado no sirve: al sacarle un pedazo el molde
  entero se acomoda distinto.
- Un borde no cruza en diagonal un doblez cerrado de la tela (la punta del
  hombro): se redondea el doblez o el borde lo cruza derecho. Agrandar un
  hueco en la grilla donde la tela rinde distinto por fila lo deja en punta.
- La percha se ve donde la prenda se apoya, con mangas termina 5 cm antes de
  la punta del hombro (la tela cae antes de la manga; más larga, la camiseta
  se ve ancha y cuadrada) y nunca atraviesa la tela: la malla que se ve (más fina que la simulada) se empuja
  fuera de la madera. Para encontrarlo, buscar puntos de la malla que se ve
  dentro de la madera (rayos en seis direcciones: número impar de cruces).
  La percha queda a su altura de siempre, sin espacio con la tela.
- Un borde que termina en punta (la V) llega recto: si una curva se apaga
  antes de la punta, la pata se mete hacia adentro (inflexión). Se usa la
  recta desde la punta tangente a la curva; medir el desvío de cada borde a la
  cuerda desde la punta, vista de frente.
- Una variante nueva parte de lo que ya funciona: la V es el redondo con las
  patas algo más rectas, una costura en la punta y la tira acostada. Puesta,
  la camiseta tiene que ser la del redondo (medir la distancia de la tela a la
  del redondo: 0 salvo junto al escote). La tela de referencia llega al
  escote casi horizontal hacia la garganta: en el redondo la tapa la tira
  parada; donde queda a la vista (bajo la punta y las patas de la V) es una
  hundidura, y la tela sigue derecha en ese último tramo. Medir el hondo del
  escote puesto y colgado: el redondo baja 0,4 cm.
- Ondas de una celda en la tela colgada son la malla, no la tela: la flexión
  tiene que resistir la compresión (medir el residuo de cada fila contra su
  versión suavizada, no la curva entera).
- Colgada, lo que se ve es la tela simulada suavizada (Taubin, cada punto se
  mueve 4 mm como mucho): borra ondas y pliegues chicos sin tocar la caída ni
  los dobleces de verdad. Es el primer recurso contra arrugas: endurecer la
  flexión o ablandar el apoyo en la madera las empeoraba o no la dejaba
  quieta.
- Una prenda que va debajo de otra (el short bajo la camiseta) entra con
  margen en la parte más angosta de la de arriba: medir por rayos que no
  asome (hoy ≥ 5 mm). Lo que se arregla sólo para que no asome no cambia el
  molde (sale de la pieza sin ese arreglo).
- Si el pedido viene dibujado, pasar el trazo a medidas y superponerlo a la
  prenda en 2D antes de renderizar.

## Cómo probar

Playwright + Chromium sin pantalla (`--use-gl=angle --use-angle=swiftshader`):
adelantar la simulación a mano (`d.step(1/60)` hasta `d.sleeping`), valores
extremos de los controles, simetría, acercamientos de cámara al cuello, los
hombros y las sisas. Arrugómetro (antes que una imagen): en la grilla
simulada, la curvatura de cada punto (laplaciano sobre la normal) menos su
promedio en ±2 puntos, por zona (arriba, medio, abajo de frente y espalda, y
mangas), en mm; en lo que se ve no debería pasar de 0,5 de promedio, salvo
arriba junto a la percha y los broches. Otras pruebas numéricas útiles: triángulos dados vuelta,
distancia de una pieza apoyada a la tela, ángulo que dobla un borde y largo de
las costuras en los moldes aplanados.

Responder en español rioplatense.
