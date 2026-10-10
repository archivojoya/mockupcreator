#!/usr/bin/env bash
# Regenera las plantillas de la camiseta desde el molde canónico: colgada de
# la percha (src/assets/tshirt-template.json) y sostenida por un maniquí
# invisible (src/assets/tshirt-maniqui.json). Sólo hace falta si se cambia el
# molde canónico, la percha, el maniquí o los parámetros de la tela; la página
# usa el resultado ya guardado.
#   PYTHON=/ruta/a/python-con-bpy tools/template/build.sh [colgada|sostenida|todas]
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=${PYTHON:-python3}
WHICH=${1:-todas}
export COLS=${COLS:-44} # resolución de la malla del cuerpo (columnas)
mkdir -p build
node tools/template/export-initial.mjs build/template-initial.json
if [[ $WHICH == colgada || $WHICH == todas ]]; then
  "$PY" tools/template/drape_blender.py build/template-initial.json build/template-final.json 160 '{"mass":0.02,"air":3}'
  node tools/template/finalize.mjs build/template-initial.json build/template-final.json src/assets/tshirt-template.json
fi
if [[ $WHICH == sostenida || $WHICH == todas ]]; then
  "$PY" tools/template/drape_blender.py build/template-initial.json build/maniqui-final.json 90 '{"mass":0.02,"air":3,"body":true}'
  node tools/template/finalize.mjs build/template-initial.json build/maniqui-final.json src/assets/tshirt-maniqui.json
fi
