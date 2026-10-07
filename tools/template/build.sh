#!/usr/bin/env bash
# Regenera la plantilla de la camiseta (forma 3D colgada) desde el molde
# canónico. Sólo hace falta si se cambia el molde canónico, la percha o los
# parámetros de la tela; la página usa el resultado ya guardado.
#   PYTHON=/ruta/a/python-con-bpy tools/template/build.sh [cuadros]
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=${PYTHON:-python3}
FRAMES=${1:-160}
OPTS=${OPTS:-'{"mass":0.02,"air":3}'}
export COLS=${COLS:-44} # resolución de la malla del cuerpo (columnas)
mkdir -p build
node tools/template/export-initial.mjs build/template-initial.json
"$PY" tools/template/drape_blender.py build/template-initial.json build/template-final.json "$FRAMES" "$OPTS"
node tools/template/finalize.mjs build/template-initial.json build/template-final.json src/assets/tshirt-template.json
