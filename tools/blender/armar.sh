#!/usr/bin/env bash
# Camiseta desde un molde SVG, de punta a punta: piezas, textura, costuras,
# costura simulada sobre el cuerpo invisible y vistas renderizadas.
#   PYTHON=.venv/bin/python tools/blender/armar.sh moldes/camiseta/redondo.svg [carpeta]
#   LISO='#f4f4f4' ...  todo de un solo color, sin el diseño del molde
set -euo pipefail
PY=${PYTHON:-python3}
D=$(cd "$(dirname "$0")" && pwd)
SVG=$(realpath "$1")
OUT=$(realpath -m "${2:-build/blender}")
mkdir -p "$OUT"
"$PY" "$D/piezas.py" "$SVG" "$OUT/piezas.json"
"$PY" "$D/textura.py" "$SVG" "$OUT/diseno.png"
"$PY" "$D/costuras.py" "$OUT/piezas.json" "$OUT/costuras.png"
"$PY" "$D/coser.py" "$OUT/piezas.json" "$OUT/final.json" "$OUT/camiseta.blend"
if [[ -n ${LISO:-} ]]; then
  COLOR="\"plain\":\"$LISO\",\"exposure\":-1.0"
else
  COLOR="\"exposure\":-0.5"
fi
"$PY" "$D/render.py" "$OUT/camiseta.blend" "$OUT/piezas.json" "$OUT/diseno.png" "$OUT/vista" \
  "{\"res\":[1600,2000],\"stitch\":\"$OUT/costuras.png\",$COLOR,\"views\":[\"frente\",\"espalda\",\"tres_cuartos\"],\"save\":\"$OUT/camiseta-render.blend\"}"
"$PY" "$D/lamina.py" --fondo=#ffffff "$OUT/lamina.jpg" "$OUT/vista_frente.png" "$OUT/vista_espalda.png"
