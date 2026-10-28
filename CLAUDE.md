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
- **Orden** (al 27 de octubre; hechos el remerón y la camiseta en
  movimiento): 1) remera femenina, 2) short nuevo (el de elástico) en la
  zancada, 3) caída fija con broches para las prendas nuevas, 4) rehacer la
  musculosa y la de básquet partiendo de la camiseta (la de básquet con su
  molde, que Demian tiene: más ancha, sisa más grande), 5) refinar el tank
  top («tiene algunos detalles raros»: se descongela para eso, con su
  aprobación, y se guardan sus huellas nuevas).
- **Musculosa y básquet, sacadas** (27 de octubre): «las veo diferentes a la
  camiseta». Se borraron de la página y de la prueba; el código de la sisa
  sin manga con puño queda para cuando se rehagan.
- **Remera femenina** (`ftee`, 27 de octubre): el cuerpo de mujer del
  remerón con el largo de la camiseta, de la cintura a la cadera abierta a lo
  ancho (de fondo apenas: hacía panza de perfil) y recta hasta el ruedo.
  La cintura, 6 mm más adentro de cada lado que la del remerón («un
  poquitito más angosta, para darle apenas más de forma»).
- **En movimiento** (26 de octubre, Demian: «dale, arrancá con la pose»):
  el conjunto con el cuerpo invisible en una pose de jugador, en movimiento
  pero frenado (`referencias/conjunto-en-movimiento.webp`: zancada, una
  pierna adelante con la boca del short hacia la cámara, la otra atrás, el
  torso apenas girado). Nada de maniquí: «le saca la magia». Hecho en
  `pose.js`: un esqueleto invisible dobla la camiseta con cuerpo ya armada
  (una pose es una lista de ángulos y sirve para todas las prendas) y el
  movimiento de la tela se agrega a mano (el ruedo), no se simula. Por ahora
  sin short: se suma cuando se mejore el short. Demian: «me encantó, está
  perfecto». Para el remerón, además del mismo movimiento («es como
  movimiento genérico»), un giro de danza (`spin`): la falda abierta toda
  alrededor, con ondas, y las aberturas separadas. Para las prendas nuevas,
  colgada sólo con broches (muestra el conjunto); la percha queda para la
  camiseta y el tank top, que ya la tienen, y para el perchero del catálogo.
- **Remerón (25 de octubre):** prenda `tunic`, con cuerpo o en movimiento
  hasta que se fije su caída colgada. Sale de las fotos de Worship Wear: con cintura,
  hasta arriba de la rodilla (85 cm) y casi recto de la cadera al ruedo (99
  y 100 cm de contorno: Demian lo pidió así después de verlo con 127 y con
  120), abertura de 20 cm en cada costado. Se probó
  con las medidas del molde FXL (`moldes/worship/`, casi recto, 97 de largo,
  manga de 24 sin puño) y a Demian le gustaba menos: la forma sale de las
  fotos. Que un diseño hecho sobre el molde caiga justo se resuelve en el
  estampado, sin cambiar la forma. La abertura (28 de octubre): «primero el
  corte y después la costura». Un triángulo de bordes rectos (4,8 cm en el
  ruedo), los bordes limpios, el ruedo termina en ellos (antes doblaba hacia
  arriba con su pespunte y parecía cosido para arriba) y la costura del
  costado empieza arriba del corte; sin presilla.
- **Short nuevo** (28 de octubre), del molde de Demian (`moldes/short/`,
  una pieza por pierna, 63 cm de alto): 50 cm de costado, tiro de 30,
  entrepierna de 20, 108 de cadera, la pierna de 73 a 64 cm de vuelta.
  Demian: el elástico frunce la tela; el dobladillo igual que el de la
  camiseta (la misma tela, sin otro color); sin cordón. Visto (28 de
  octubre): «las caderas tienen que estar tapadas por la remera» (al salir
  de ella el short no pasa del 95 % de su ruedo: achicado a la camiseta, un
  M, 92 de cadera); «se ve como dividido a la mitad, cambia la textura desde
  el tiro hacia abajo» (el frente liso por el medio hasta la curva del tiro
  y la malla sin arruga en la entrepierna); «lo veo largo desde abajo del
  tiro, le sacaría unos 10 centímetros» (entrepierna de 10); «no me gustan
  los pliegues que le haces al tiro, el que te mandé es más liso» (sólo el
  frunce del elástico); al lado de la camiseta «se ve muy grande»: va
  debajo. Le gustan el elástico y la forma («antes se veía aplastado»).
  Falta: las piernas en la zancada.
- **La vara:** una prenda en 3D tiene que salir más rápido que el mockup a
  mano. Si no, no está lista.
- **Descartado:** coser los moldes SVG en Blender (artifact «Molde a 3D
  LLAQTA», principios de octubre). De cerca no convencía y la página pesaba
  mucho. La base es three.js con la tela de `fabric.js`.

## Más adelante

- **Exportar el modelo en GLB.** Es la puerta a todo lo demás: Blender (para
  una foto más realista que la de tiempo real), motion, realidad aumentada.
- **Personajes animados para los pedidos de niños:** un personaje con su
  propia remera, con el diseño del pedido estampado encima, grabado como
  video. No es la camiseta de producción puesta en otro cuerpo: con las
  proporciones de un dibujo no calzaría.
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

Antes de cualquier cambio en `src/camiseta/`: `node tools/regresion.mjs`
(unos 45 s). Compara camiseta, musculosa, básquet y tank top (con cuerpo,
molde de estampado, short, en percha y con broches) contra las huellas de la
versión 1; tiene que dar todo igual. Si un cambio en esas prendas es a
propósito y Demian lo aprobó, `--guardar` y se commitea el JSON con el cambio.

Para publicar: `node tools/pagina.mjs --out x.html --title … --heading …
--config '{…}'` arma la página de un solo archivo, y se publica ese HTML.

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
