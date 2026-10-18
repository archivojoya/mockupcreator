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
- Puños y vivos con cuerpo, apoyados sobre la tela (envuelven el borde);
  colgados siguen la tela sin levantarse.
- Bordes de huecos en curvas sin quiebres: si la grilla dobla en un punto, se
  promedia el borde a lo largo de sí mismo.
- Colgada, cada pieza tiende a su molde aplanado: las costuras tienen que
  medir lo mismo en las dos piezas, y los acortamientos van lejos de ellas.
- Con broches, la tira del cuello queda parada en los costados.
- La percha se ve donde la prenda se apoya.
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
