# mockupcreator

Mockups 3D de prendas deportivas con three.js (`camiseta.html`, código en
`src/camiseta/`). El README explica cada parte; la skill de cuenta
`camiseta-3d` lleva la misma página y sus lecciones (`references/motor.md`).

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
- La percha se ve donde la prenda se apoya, sostiene casi hasta la punta del
  hombro (más corta, la tela de arriba sobra a lo ancho y se ondula) y nunca
  atraviesa la tela: la malla que se ve (más fina que la simulada) se empuja
  fuera de la madera. Para encontrarlo, buscar puntos de la malla que se ve
  dentro de la madera (rayos en seis direcciones: número impar de cruces).
  La percha queda a su altura de siempre, sin espacio con la tela.
- Un borde que termina en punta (la V) llega recto: si una curva se apaga
  antes de la punta, la pata se mete hacia adentro (inflexión). Se usa la
  recta desde la punta tangente a la curva; medir el desvío de cada borde a la
  cuerda desde la punta, vista de frente.
- Una variante nueva parte de lo que ya funciona: la V es el redondo con las
  patas algo más rectas y una costura en la punta, y todo lo demás (tira,
  caída colgada) es el del redondo. La tela de referencia llega al escote casi
  horizontal hacia la garganta: un corte que la cruza o pasa apenas encima se
  va hacia atrás (la V honda anterior se hundía y se caía colgada). Medir el
  hondo del escote puesto y colgado: el redondo baja 0,4 cm.
- Ondas de una celda en la tela colgada son la malla, no la tela: la flexión
  tiene que resistir la compresión (medir el residuo de cada fila contra su
  versión suavizada, no la curva entera).
- Si el pedido viene dibujado, pasar el trazo a medidas y superponerlo a la
  prenda en 2D antes de renderizar.

## Cómo probar

Playwright + Chromium sin pantalla (`--use-gl=angle --use-angle=swiftshader`):
adelantar la simulación a mano (`d.step(1/60)` hasta `d.sleeping`), valores
extremos de los controles, simetría, acercamientos de cámara al cuello, los
hombros y las sisas. Pruebas numéricas útiles: triángulos dados vuelta,
distancia de una pieza apoyada a la tela, ángulo que dobla un borde y largo de
las costuras en los moldes aplanados.

Responder en español rioplatense.
