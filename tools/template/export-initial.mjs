// Paso 1 de la plantilla: arma la camiseta inicial (forma 3D aproximada,
// costuras, molde plano en reposo y percha) a partir del molde canónico y la
// guarda en JSON para simular la caída en Blender (drape_blender.py).
//   node tools/template/export-initial.mjs salida.json
import { writeFileSync } from 'node:fs';
import { GarmentModel } from '../../src/garment.js';
import { canonicalMold } from './canonical.mjs';

const out = process.argv[2] || 'template-initial.json';
const mold = canonicalMold();
const model = new GarmentModel(mold);
const atlas = { uv: () => [0, 0] };
const COLS = Number(process.env.COLS || 44); // resolución de la malla del cuerpo
const body = { front: model.buildBody(model.front, atlas, COLS), back: model.buildBody(model.back, atlas, COLS) };
const geos = {
  ...body,
  sleeveL: model.buildSleeve(mold.parts.sleeveL, +1, atlas, model.armholeLoop(+1, body)),
  sleeveR: model.buildSleeve(mold.parts.sleeveR, -1, atlas, model.armholeLoop(-1, body)),
  collar: model.buildCollar(atlas, null),
};
const hanger = model.buildHanger();
const drape = model.setupDrape(geos, hanger);

const pieces = drape.pieces.filter((pc) => pc.key !== 'collar');
// Sólo partículas que pertenecen a algún triángulo (las sueltas caerían libres
// y, si estuvieran cosidas o fijas, tirarían del resto).
const keep = new Set();
for (const pc of pieces) for (const k of pc.geo.index.array) keep.add(pc.offset + k);
const S = model.front.S;
const json = { pieces: [], sew: [], pins: [], hanger: {}, mold: { parts: {} } };
for (const pc of pieces) {
  const g = pc.geo;
  const { px, py } = g.userData;
  // Molde plano en reposo (m): el del cuerpo con calce y silueta; el de las
  // mangas, su molde tal cual (coordenadas de la copa en el molde).
  const rest = [];
  for (let k = 0; k < pc.count; k++) {
    if (pc.rest2D) rest.push(pc.rest2D[k * 2], pc.rest2D[k * 2 + 1]);
    else rest.push(px[k] * S, py[k] * S);
  }
  const piece = {
    key: pc.key,
    offset: pc.offset,
    position: Array.from(g.attributes.position.array),
    rest,
    mold: Array.from({ length: pc.count }, (_, k) => [px[k], py[k]]).flat(),
    index: Array.from(g.index.array),
  };
  if (g.userData.row) Object.assign(piece, { row: g.userData.row, Nu: g.userData.Nu, hu: g.userData.loop.cols.map((c) => c.hu) });
  json.pieces.push(piece);
}
// Costuras como pares de partículas (índices globales).
const pairs = new Set();
const add = (i, j) => {
  if (i === j || !keep.has(i) || !keep.has(j)) return;
  pairs.add(i < j ? `${i},${j}` : `${j},${i}`);
};
for (const [i, j] of drape.stitches) add(i, j);
for (const [i, a, b, t] of drape.edgeStitches) add(i, t < 0.5 ? a : b);
json.sew = [...pairs].map((s) => s.split(',').map(Number));
// Fijaciones: el borde del escote (ahí va el cuello acanalado, que lo sostiene).
for (let i = 0; i < drape.n; i++) if (drape.w[i] === 0 && keep.has(i)) json.pins.push(i);
json.hanger = {
  barPts: hanger.barPts.map((p) => [p.x, p.y, p.z]),
  barSizes: hanger.barSizes.map((s) => [s.h, s.t]),
  position: Array.from(hanger.bar.attributes.position.array),
  index: Array.from(hanger.bar.index.array),
  rodY: hanger.rodY,
  rodZ: hanger.rodZ,
  hookPts: hanger.hookPts.map((p) => [p.x, p.y, p.z]),
};
for (const [k, p] of Object.entries(mold.parts)) json.mold.parts[k] = { poly: p.poly, bbox: p.bbox };
writeFileSync(out, JSON.stringify(json));
console.log(`piezas ${json.pieces.map((p) => `${p.key}:${p.position.length / 3}`).join(' ')} · costuras ${json.sew.length} · fijas ${json.pins.length}`);
