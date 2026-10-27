// Prueba de que las prendas congeladas no cambian: arma cada una con varios
// valores de los controles (con cuerpo, el molde de estampado, el short y,
// colgada, la tela simulada hasta que se duerme) y compara una huella de
// cada malla contra la guardada.
//
//   node tools/regresion.mjs            compara contra tools/regresion-v1.json
//   node tools/regresion.mjs --guardar  guarda las huellas actuales
//
// Corre en Node, sin navegador. Las huellas son de los bytes exactos: un
// cambio de cualquier vértice, por chico que sea, aparece.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildShirt, flattenPrint, DEFAULTS } from '../src/camiseta/shirt.js';
import { buildShorts } from '../src/camiseta/shorts.js';
import { HangingShirt, makeHanger } from '../src/camiseta/drape.js';

const FILE = new URL('./regresion-v1.json', import.meta.url);
// (La musculosa y la de básquet se sacaron el 27 de octubre: se rehacen.)
const GARMENTS = ['tee', 'tank'];
// Variantes de forma (sobre los valores de entrada de cada prenda).
const SHAPES = {
  base: {},
  ajustada: { fit: 0 },
  holgada: { fit: 1 },
  corta: { length: 0.62 },
  larga: { length: 0.82 },
  'manga larga y abierta': { sleeveLength: 0.3, sleeveAngle: 65 },
  'cuello V': { neckStyle: 'v' },
  'escote 12': { neckDepth: 0.12 },
  'sin puño': { cuff: 'none' },
};
const TANK_DEPTH = 0.13; // el escote con que arranca el tank top (main.js)

function hashGeos(geos) {
  const h = createHash('sha256');
  for (const key of Object.keys(geos).sort()) {
    const g = geos[key];
    h.update(key);
    for (const name of Object.keys(g.attributes).sort()) {
      h.update(name);
      h.update(Buffer.from(g.attributes[name].array.buffer, g.attributes[name].array.byteOffset, g.attributes[name].array.byteLength));
    }
    if (g.index) h.update(Buffer.from(g.index.array.buffer, g.index.array.byteOffset, g.index.array.byteLength));
  }
  return h.digest('hex').slice(0, 16);
}
const hashJSON = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16);
const numbers = (M) => Object.fromEntries(Object.entries(M).filter(([, v]) => typeof v === 'number'));

function settle(drape) {
  for (let f = 0; f < 900 && !drape.sleeping; f++) drape.step(1 / 60);
  drape.updateMeshes();
}

const prints = {};
const t0 = Date.now();
for (const garment of GARMENTS) {
  for (const [name, shape] of Object.entries(SHAPES)) {
    if (garment === 'tank' && (shape.neckStyle || shape.neckDepth)) continue;
    if (garment !== 'tee' && (shape.sleeveLength || shape.cuff)) continue;
    const params = { ...DEFAULTS, garment, ...(garment === 'tank' ? { neckDepth: TANK_DEPTH } : {}), ...shape };
    const id = `${garment} · ${name}`;
    const built = buildShirt(params);
    prints[`${id} · con cuerpo`] = hashGeos(built.geos);
    prints[`${id} · medidas`] = hashJSON(numbers(built.measures));
    prints[`${id} · short`] = hashGeos(buildShorts(built.measures));
    if (name !== 'base') continue;
    flattenPrint(built);
    prints[`${id} · molde de estampado`] = hashGeos({ front: built.geos.front, back: built.geos.back });
    for (const mode of ['hanger', 'clips']) {
      const fresh = buildShirt(params);
      const drape = mode === 'hanger' ? new HangingShirt(fresh, makeHanger(fresh.measures), { weight: 0.5 }) : new HangingShirt(fresh, { kind: 'clips' }, { weight: 0.5 });
      settle(drape);
      prints[`${id} · ${mode === 'hanger' ? 'en percha' : 'con broches'}`] = hashGeos(fresh.geos);
    }
  }
}

if (process.argv.includes('--guardar')) {
  writeFileSync(FILE, JSON.stringify(prints, null, 2) + '\n');
  console.log(`Guardadas ${Object.keys(prints).length} huellas (${((Date.now() - t0) / 1000).toFixed(0)} s).`);
} else {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  const changed = Object.keys(saved).filter((k) => saved[k] !== prints[k]);
  const missing = Object.keys(saved).filter((k) => !(k in prints));
  for (const k of changed) console.log(`CAMBIÓ  ${k}`);
  for (const k of missing) console.log(`FALTA   ${k}`);
  console.log(`${Object.keys(saved).length - changed.length} de ${Object.keys(saved).length} iguales (${((Date.now() - t0) / 1000).toFixed(0)} s).`);
  process.exit(changed.length ? 1 : 0);
}
