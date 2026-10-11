// Camiseta colgada: la tela se simula en vivo con dinámica de posiciones
// (partículas unidas por restricciones de largo) sobre una malla a media
// resolución de la misma camiseta. La malla fina que se ve sigue a la gruesa;
// cuello y dobladillos acompañan a su borde.
//
// - Cuelga de una percha de madera (sólido de choque con forma de barra) o de
//   dos broches que pellizcan la costura de los hombros.
// - El cuello se mueve como una pieza rígida: la tira acanalada no se arruga.
// - Frente y espalda no se cruzan y guardan algo del volumen que tenían
//   puestos: cada punto del frente se mantiene delante del punto más cercano
//   de la espalda, a una fracción de la separación original. Lo mismo las dos
//   caras de cada manga.
// - El mouse empuja la tela al pasar y levanta una brisa suave.
// - Cuando la tela se queda quieta la simulación se duerme (no gasta nada).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { armholeLoopIJ } from './shirt.js';

const SUBSTEPS = 4;
const ITERATIONS = 5;
const GAP = 0.005; // separación mínima entre capas de tela
const DAMP = 0.991; // amortiguación de la velocidad por subpaso
const SLACK = 1.01; // lo que se puede estirar la tela con su peso
// Fracción de la separación entre frente y espalda (puesta) que conserva la
// tela colgada: algo más arriba, casi nada en el ruedo.
const VOLUME_TOP = 0.3;
const VOLUME_HEM = 0.06;
const VOLUME_SLEEVE = 0.5;
// Broches: filas de la costura del hombro donde pellizcan (desde la punta
// del hombro hacia el cuello), cuánto más atrás de la costura (a lo largo de
// la espalda) y media separación entre las mordazas.
const CLIP_ROWS = [1, 2];
const CLIP_BACK = 0.03;
const PINCH = 0.0035;
// La barra de la percha queda un poco detrás de la costura del hombro: la
// tela del frente pasa por arriba y de frente se ve el frente entero.
const HANGER_BACK = 0.025;
// Grosor de la tela para el choque entre puntos: dos puntos que no son
// vecinos en la tela no se acercan más que esto (algo menos que la diagonal
// de una celda de la malla, así ningún punto pasa entre otros cuatro).
const THICK = 0.011;
const VMAX = 0.004; // velocidad máxima por subpaso (≈ 1 m/s)
// Cuánto se deja achatar el cuello: 0 = pieza rígida; 1 = cualquier
// deformación lineal (sigue siendo un óvalo parejo, sin arrugas).
const COLLAR_FLEX = 1;

// ---------- percha ----------

// Barra de la percha bajo los hombros, con gancho, un poco detrás de la
// costura. Es plana y paralela a la camiseta: baja del centro hacia las
// puntas siguiendo la caída de los hombros.
export function makeHanger(M) {
  const xEnd = M.shA - 0.05;
  const seamY = (x) => {
    const ax = Math.abs(x);
    return ax <= M.neck.a ? 0 : (M.shY * (ax - M.neck.a)) / (M.shA - M.neck.a);
  };
  const radius = (x) => 0.0095 + 0.0075 * (Math.abs(x) / xEnd) ** 2;
  const z0 = M.neck.c + 0.003 - HANGER_BACK;
  const ctrl = [];
  for (const x of [-xEnd, -0.75 * xEnd, -0.5 * xEnd, -0.28 * xEnd, 0, 0.28 * xEnd, 0.5 * xEnd, 0.75 * xEnd, xEnd]) {
    const t = Math.abs(x) / xEnd;
    ctrl.push(new THREE.Vector3(x, Math.min(seamY(x) - radius(x) - 0.012, -0.036 - 0.02 * t * t), z0));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const cpts = curve.getSpacedPoints(48);
  const segments = [];
  for (let i = 0; i + 1 < cpts.length; i++) segments.push({ a: cpts[i], b: cpts[i + 1], ra: radius(cpts[i].x), rb: radius(cpts[i + 1].x) });
  // La barra que se ve es un poco más corta que la de choque: las puntas
  // quedan siempre tapadas por la tela del hombro.
  const trim = (xEnd - 0.115) / curve.getLength();
  const pts = Array.from({ length: 49 }, (_, i) => curve.getPointAt(trim + ((1 - 2 * trim) * i) / 48));
  const radii = pts.map((p) => radius(p.x));

  // Malla de la barra: anillos de radio variable, extremos redondeados.
  const R = 20;
  const rings = [];
  const frame = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const addRing = (c, t, r, sx = 1) => {
    side.crossVectors(t, new THREE.Vector3(0, 0, 1)).normalize();
    up.crossVectors(side, t).normalize();
    const ring = [];
    for (let k = 0; k < R; k++) {
      const a = (k / R) * Math.PI * 2;
      // Sección ovalada: un poco más alta que ancha, como la madera.
      ring.push(c.clone().addScaledVector(side, Math.cos(a) * r * 1.15 * sx).addScaledVector(up, Math.sin(a) * r * 0.85 * sx));
    }
    rings.push(ring);
  };
  const t0 = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
  for (let k = 4; k >= 1; k--) addRing(pts[0].clone().addScaledVector(t0, -radii[0] * Math.sin(((k / 4) * Math.PI) / 2) * 0.9), t0, radii[0], Math.cos(((k / 4) * Math.PI) / 2) + 0.01);
  for (let i = 0; i < pts.length; i++) {
    frame.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    addRing(pts[i], frame, radii[i]);
  }
  const tn = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize();
  for (let k = 1; k <= 4; k++) addRing(pts[pts.length - 1].clone().addScaledVector(tn, radii[radii.length - 1] * Math.sin(((k / 4) * Math.PI) / 2) * 0.9), tn, radii[radii.length - 1], Math.cos(((k / 4) * Math.PI) / 2) + 0.01);
  const pos = [];
  for (const ring of rings) for (const p of ring) pos.push(p.x, p.y, p.z);
  const idx = [];
  for (let i = 0; i + 1 < rings.length; i++)
    for (let k = 0; k < R; k++) {
      const a = i * R + k;
      const b = i * R + ((k + 1) % R);
      idx.push(a, a + R, b, b, a + R, b + R);
    }
  const bar = new THREE.BufferGeometry();
  bar.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bar.setIndex(idx);
  bar.computeVertexNormals();

  // Gancho de alambre.
  const top = curve.getPoint(0.5);
  const hookPts = [
    [0, 0],
    [0, 0.035],
    [0, 0.07],
    [0.006, 0.098],
    [0.026, 0.118],
    [0.05, 0.112],
    [0.058, 0.09],
    [0.05, 0.072],
  ].map(([x, y]) => new THREE.Vector3(top.x + x, top.y + y, top.z));
  const hook = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 48, 0.0026, 10, false);
  return { kind: 'hanger', wood: bar, metal: hook, segments, minY: Math.min(...cpts.map((p) => p.y - radius(p.x))) };
}

// Barra de metal con gancho y dos broches que cuelgan de ella. Cada broche:
// dos mordazas que aprietan la tela (una adelante y otra atrás), unidas
// arriba por el resorte, y un alambre hasta la barra.
export function makeClipHanger(clips) {
  const metal = [];
  const plastic = [];
  const top = Math.max(0.035, ...clips.map((c) => c.y + 0.06));
  const z = clips[0].z;
  const xMax = Math.max(...clips.map((c) => Math.abs(c.x))) + 0.035;
  const along = (geo, a, b) => {
    // Cilindro de `a` a `b`.
    const d = new THREE.Vector3().subVectors(b, a);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return geo;
  };
  const rodR = 0.0032;
  metal.push(along(new THREE.CylinderGeometry(rodR, rodR, 2 * xMax, 16, 1, true), new THREE.Vector3(-xMax, top, z), new THREE.Vector3(xMax, top, z)));
  for (const s of [-1, 1]) metal.push(new THREE.SphereGeometry(rodR * 1.35, 16, 10).translate(s * xMax, top, z));
  const hookPts = [
    [0, 0],
    [0, 0.025],
    [0, 0.045],
    [0.005, 0.068],
    [0.022, 0.085],
    [0.042, 0.08],
    [0.049, 0.062],
    [0.042, 0.047],
  ].map(([x, y]) => new THREE.Vector3(x, top + y, z));
  metal.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 48, 0.0026, 10, false));
  for (const c of clips) {
    const t = 0.0034; // espesor de cada mordaza
    const jawTop = c.y + 0.014;
    const jawBot = c.y - c.depth - 0.006;
    const h = jawTop - jawBot;
    const tilt = 0.07; // las mordazas se abren un poco hacia el resorte
    for (const s of [-1, 1]) {
      const jaw = new RoundedBoxGeometry(c.width, h, t, 2, 0.0012);
      jaw.translate(0, h / 2, 0);
      jaw.rotateX(s * tilt);
      jaw.translate(c.x, jawBot, c.z + s * (PINCH + 0.0012 + t / 2));
      plastic.push(jaw);
    }
    const spring = c.z;
    const springR = PINCH + 0.0012 + t + Math.sin(tilt) * h - 0.001;
    metal.push(along(new THREE.CylinderGeometry(springR, springR, c.width * 0.42, 20), new THREE.Vector3(c.x - c.width * 0.21, jawTop, spring), new THREE.Vector3(c.x + c.width * 0.21, jawTop, spring)));
    metal.push(along(new THREE.CylinderGeometry(0.0016, 0.0016, top - jawTop - springR, 8), new THREE.Vector3(c.x, jawTop + springR * 0.8, z), new THREE.Vector3(c.x, top - 0.004, z)));
    metal.push(new THREE.TorusGeometry(0.0052, 0.0015, 8, 20).rotateY(Math.PI / 2).translate(c.x, top, z));
  }
  return { kind: 'clips', metal: mergeGeometries(metal), plastic: mergeGeometries(plastic) };
}

// ---------- simulación ----------

// Distancia a lo largo de la tela desde el punto de apoyo más cercano
// (Dijkstra sobre las uniones de la malla): de qué punto cuelga cada uno y
// cuánto se puede alejar de él.
function geodesic(n, adj, anchors) {
  const geo = new Float32Array(n).fill(Infinity);
  const owner = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  for (const a of anchors) {
    geo[a] = 0;
    owner[a] = a;
    push(0, a);
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d > geo[i]) continue;
    const nb = adj[i];
    for (let e = 0; e < nb.length; e += 2) {
      const j = nb[e];
      const nd = d + nb[e + 1];
      if (nd < geo[j]) {
        geo[j] = nd;
        owner[j] = owner[i];
        push(nd, j);
      }
    }
  }
  return { owner, len: Float32Array.from(geo, (g) => g * SLACK) };
}

// Rotación más cercana a la matriz A (columnas a0, a1, a2), partiendo de la
// rotación q (Müller y otros, 2016). Deja el resultado en q.
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
function extractRotation(a, q, iterations) {
  for (let it = 0; it < iterations; it++) {
    const { x, y, z, w } = q;
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let dot = 0;
    for (let c = 0; c < 3; c++) {
      const [rx, ry, rz] = [r[c * 3], r[c * 3 + 1], r[c * 3 + 2]];
      const [ax, ay, az] = [a[c * 3], a[c * 3 + 1], a[c * 3 + 2]];
      ox += ry * az - rz * ay;
      oy += rz * ax - rx * az;
      oz += rx * ay - ry * ax;
      dot += rx * ax + ry * ay + rz * az;
    }
    const s = 1 / (Math.abs(dot) + 1e-9);
    const angle = Math.hypot(ox, oy, oz) * s;
    if (angle < 1e-7) break;
    _axis.set(ox, oy, oz).normalize();
    q.premultiply(_dq.setFromAxisAngle(_axis, angle)).normalize();
  }
}

export class HangingShirt {
  // support: la percha de makeHanger, o { kind: 'clips' } para colgarla de
  // dos broches (después de crearla, `clips` dice dónde dibujarlos).
  constructor(built, support) {
    this.geos = built.geos;
    this.hanger = support.kind === 'hanger' ? support : null;
    const L = built.layout;
    const C = L.cols / 2; // columnas de la grilla gruesa
    const NC = L.rows / 2;
    const i1 = L.i1 / 2;
    const i2 = L.i2 / 2;
    const A = L.armCols / 2;
    const W = L.cols + 1;
    const WC = C + 1;
    const SW = L.sleeveSW;
    const SWC = (SW - 1) / 2 + 1;
    const RC = (L.sleeveRows + L.cuffRows) / 2;
    this.dims = { C, NC, WC, SWC, RC };

    const pos = [];
    const add = (p) => {
      pos.push(p[0], p[1], p[2]);
      return pos.length / 3 - 1;
    };
    const fine = (key, v) => {
      const a = this.geos[key].attributes.position.array;
      return [a[v * 3], a[v * 3 + 1], a[v * 3 + 2]];
    };
    // Partículas del torso: la grilla fina tomando una fila y columna de cada
    // dos; las costuras de costado y hombro comparten partícula.
    const map = { front: new Int32Array(WC * (NC + 1)).fill(-1), back: new Int32Array(WC * (NC + 1)).fill(-1) };
    const inHole = (i, j) => i > i1 && i < i2 && (j < A || j > C - A);
    for (const key of ['front', 'back']) {
      for (let i = 0; i <= NC; i++)
        for (let j = 0; j <= C; j++) {
          if (inHole(i, j)) continue;
          let id = -1;
          if (key === 'back' && (j === 0 || j === C)) id = map.front[i * WC + (j === 0 ? C : 0)];
          map[key][i * WC + j] = id >= 0 ? id : add(fine(key, 2 * i * W + 2 * j));
        }
    }
    // Mangas (con el puño): la primera fila es la sisa del torso.
    const sleeveMap = {};
    for (const [key, side] of [['sleeveL', 1], ['sleeveR', -1]]) {
      const m = new Int32Array(SWC * (RC + 1)).fill(-1);
      const loop = armholeLoopIJ(C, A, i1, i2, side);
      const cuff = key === 'sleeveL' ? 'cuffL' : 'cuffR';
      for (let r = 0; r <= RC; r++)
        for (let k = 0; k < SWC; k++) {
          let id;
          if (r === 0) {
            const [pk, i, j] = loop[k % loop.length];
            id = map[pk][i * WC + j];
          } else if (k === SWC - 1) id = m[r * SWC];
          else {
            const R = 2 * r;
            id = add(R <= L.sleeveRows ? fine(key, R * SW + 2 * k) : fine(cuff, (R - L.sleeveRows) * SW + 2 * k));
          }
          m[r * SWC + k] = id;
        }
      sleeveMap[key] = m;
    }
    this.map = map;
    this.sleeveMap = sleeveMap;
    const n = pos.length / 3;
    this.n = n;
    this.p = Float32Array.from(pos);
    this.q = Float32Array.from(pos);
    this.w = new Float32Array(n).fill(1); // 0 = adherida a la percha o al broche

    // Restricciones de largo: lados y diagonales de cada celda, y "flexión"
    // (saltando un punto) con menos rigidez.
    const pairs = new Map();
    const P = this.p;
    const dist = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const link = (a, b, kind) => {
      if (a < 0 || b < 0 || a === b) return;
      const key = a < b ? a * n + b : b * n + a;
      if (!pairs.has(key)) pairs.set(key, [a, b, dist(a, b), kind]);
    };
    const grid = (m, w, h, cellOk) => {
      for (let i = 0; i <= h; i++)
        for (let j = 0; j < w; j++) {
          const a = m[i * w + j];
          if (j + 1 < w) link(a, m[i * w + j + 1], 0);
          if (i < h) link(a, m[(i + 1) * w + j], 0);
          if (i < h && j + 1 < w && cellOk(i, j)) {
            link(a, m[(i + 1) * w + j + 1], 1);
            link(m[i * w + j + 1], m[(i + 1) * w + j], 1);
          }
          if (j + 2 < w && m[i * w + j + 1] >= 0) link(a, m[i * w + j + 2], 2);
          if (i + 2 <= h && m[(i + 1) * w + j] >= 0) link(a, m[(i + 2) * w + j], 2);
        }
    };
    const cellOk = (i, j) => !(i >= i1 && i < i2 && (j < A || j >= C - A));
    grid(map.front, WC, NC, cellOk);
    grid(map.back, WC, NC, cellOk);
    for (const m of Object.values(sleeveMap)) grid(m, SWC, RC, () => true);
    // La copa de la manga tiene algo de cuerpo: uniones blandas entre las
    // primeras filas de la manga y la tela del torso junto a la sisa (la
    // manga no cuelga a plomo).
    const torsoIds = [...new Set([...map.front, ...map.back])].filter((id) => id >= 0 && Math.abs(P[id * 3]) > 0.1 && P[id * 3 + 1] > -0.4);
    for (const m of Object.values(sleeveMap))
      for (const r of [2, 4, 6])
        for (let k = 0; k < SWC - 1; k++) {
          const a = m[r * SWC + k];
          const near = torsoIds
            .map((id) => [dist(a, id), id])
            .filter(([d]) => d < 0.07 && d > 0.015)
            .sort((x, y) => x[0] - y[0])
            .slice(0, 2);
          for (const [, id] of near) link(a, id, 4);
        }
    const list = [...pairs.values()];
    this.ca = Int32Array.from(list, (c) => c[0]);
    this.cb = Int32Array.from(list, (c) => c[1]);
    this.rest = Float32Array.from(list, (c) => c[2]);
    this.kind = Uint8Array.from(list, (c) => c[3]);

    // El cuello: la fila de arriba del torso se mueve como una pieza rígida.
    const ring = [...new Set([...Array.from({ length: C + 1 }, (_, j) => map.front[NC * WC + j]), ...Array.from({ length: C + 1 }, (_, j) => map.back[NC * WC + j])])];
    this.ringIds = Int32Array.from(ring);
    const c0 = new THREE.Vector3();
    for (const id of ring) c0.add(new THREE.Vector3(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]));
    c0.divideScalar(ring.length);
    this.ringRest = Float32Array.from(ring.flatMap((id) => [P[id * 3] - c0.x, P[id * 3 + 1] - c0.y, P[id * 3 + 2] - c0.z]));
    this.ringQ = new THREE.Quaternion();
    this.ringC = c0.clone();
    this.ringG = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const qq = new Float32Array(9);
    for (let k = 0; k < ring.length; k++)
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) qq[c * 3 + r] += this.ringRest[k * 3 + r] * this.ringRest[k * 3 + c];
    this.ringQQ = new THREE.Matrix3().fromArray(qq).invert().elements;
    // Tira del cuello: su borde de abajo (cosido al escote) sigue la forma
    // del contorno; el resto de la tira, sólo su giro (no se deforma).
    const collar = this.geos.collar.attributes.position.array;
    const CSW = L.rings.collar.length + 1;
    this.collarSW = CSW;
    this.collarBase = Float32Array.from(collar.subarray(0, CSW * 3), (v, i) => v - c0.getComponent(i % 3));
    this.collarOff = Float32Array.from(collar, (v, i) => v - collar[((Math.floor(i / 3) % CSW) * 3) + (i % 3)]);
    // La cara de adentro de la tira llega sólo hasta el escote (puesta baja
    // un poco dentro de la camiseta; colgada, asomaría por la tela).
    const last = collar.length / 3 / CSW - 1;
    for (let i = 0; i < CSW * 3; i++) {
      const o = this.collarOff;
      o[last * CSW * 3 + i] = (o[last * CSW * 3 + i] + o[(last - 1) * CSW * 3 + i]) / 2;
    }

    // Broches: pellizcan la espalda un poco detrás de la costura de cada
    // hombro (en dos puntos), con la tela apretada entre las mordazas en un
    // pliegue vertical. Los puntos quedan fijos; la costura y el frente pasan
    // por arriba y caen adelante.
    this.pins = [];
    this.clips = [];
    if (support.kind === 'clips') {
      const at = (id) => new THREE.Vector3(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]);
      for (const col of [0, C]) {
        // Columna k de la espalda contando desde la costura (k = 0).
        const back = (i, k) => map.back[i * WC + (col ? k : C - k)];
        const picks = CLIP_ROWS.map((r) => {
          const i = i2 + r;
          let s = 0;
          let best = 1;
          let bd = Infinity;
          for (let k = 1; k < 8; k++) {
            s += at(back(i, k)).distanceTo(at(back(i, k - 1)));
            if (Math.abs(s - CLIP_BACK) < bd) {
              bd = Math.abs(s - CLIP_BACK);
              best = k;
            }
          }
          return [i, best];
        });
        const centers = picks.map(([i, k]) => back(i, k));
        const ys = centers.reduce((s, id) => s + P[id * 3 + 1], 0) / centers.length;
        const zs = centers.reduce((s, id) => s + P[id * 3 + 2], 0) / centers.length;
        let depth = 0;
        picks.forEach(([i, k], r) => {
          const c = at(centers[r]);
          this.pins.push({ id: centers[r], from: c, to: new THREE.Vector3(c.x, ys, zs) });
          // El vecino hacia la costura va contra la mordaza de adelante; el
          // otro, contra la de atrás.
          for (const [id, side] of [
            [back(i, k - 1), 1],
            [back(i, k + 1), -1],
          ]) {
            const d = at(id).distanceTo(c);
            depth = Math.max(depth, d);
            this.pins.push({ id, from: at(id), to: new THREE.Vector3(c.x, ys - d, zs + side * PINCH) });
          }
        });
        const xs = centers.map((id) => P[id * 3]);
        this.clips.push({ x: (xs[0] + xs[1]) / 2, y: ys, z: zs, width: Math.abs(xs[0] - xs[1]) + 0.02, depth });
      }
      for (const pin of this.pins) this.w[pin.id] = 0;
    }

    // Ataduras de largo máximo: cada punto no se aleja de lo que lo sostiene
    // (la costura de cada hombro, o cada broche) más que su distancia a lo
    // largo de la tela. Así la tela no se estira como goma con su propio
    // peso. Con un punto de cada lado, el largo queda bien atado también en
    // el centro.
    const anchorSets =
      support.kind === 'clips'
        ? [this.pins.slice(0, this.pins.length / 2).map((p) => p.id), this.pins.slice(this.pins.length / 2).map((p) => p.id)]
        : [0, C].map((col) => Array.from({ length: NC - i2 + 1 }, (_, r) => map.front[(i2 + r) * WC + col]));
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b, r, kd] of list) {
      if (kd > 1) continue;
      adj[a].push(b, r);
      adj[b].push(a, r);
    }
    this.tetherSets = anchorSets.map((anchors) => geodesic(n, adj, anchors));

    // Pares de capas: frente delante de la espalda, y las dos caras de cada
    // manga. Cada par guarda la separación mínima que conserva colgado.
    // Frente y espalda: se comparan por cercanía (no por índice), así no se
    // cruzan aunque se corran al colgar.
    const own = (key) => new Set(map[key].filter((id) => id >= 0));
    const fs = own('front');
    const bs = own('back');
    this.frontIds = Int32Array.from([...fs].filter((id) => !bs.has(id)));
    this.backIds = Int32Array.from([...bs].filter((id) => !fs.has(id)));
    const rowOf = new Float32Array(n);
    map.front.forEach((id, k) => id >= 0 && (rowOf[id] = Math.floor(k / WC)));
    // Volumen: cada punto del frente queda unido al de la espalda que tenía
    // enfrente puesta, y no se le acerca más que una fracción de esa
    // distancia (pares fijos: el equilibrio no salta de un vecino a otro).
    const vol = [];
    const volGap = [];
    for (const f of this.frontIds) {
      let best = -1;
      let bd = Infinity;
      for (const b of this.backIds) {
        const d = (P[b * 3] - P[f * 3]) ** 2 + (P[b * 3 + 1] - P[f * 3 + 1]) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      const t = Math.min(1, rowOf[f] / i1);
      const g = (P[f * 3 + 2] - P[best * 3 + 2]) * (VOLUME_HEM + (VOLUME_TOP - VOLUME_HEM) * t * t * (3 - 2 * t));
      if (g <= GAP) continue;
      vol.push(f, best);
      volGap.push(g);
    }
    this.volPairs = Int32Array.from(vol);
    this.volGap = Float32Array.from(volGap);
    const layers = [];
    const LC = SWC - 1;
    for (const m of Object.values(sleeveMap))
      for (let r = 1; r <= RC; r++)
        for (let k = 1; k < LC / 2; k++) layers.push(m[r * SWC + k], m[r * SWC + LC - k]);
    this.layers = Int32Array.from(layers);
    this.layerGap = Float32Array.from({ length: layers.length / 2 }, (_, c) => Math.max(GAP, (P[layers[2 * c] * 3 + 2] - P[layers[2 * c + 1] * 3 + 2]) * VOLUME_SLEEVE));
    this.bindFine(L, W, SW);
    // Choque entre puntos: posiciones de reposo (para saber quién es vecino
    // en la tela) y la grilla espacial, armada de nuevo en cada pasada.
    this.p0 = Float32Array.from(this.p);
    // Junto a los broches la tela queda apretada a propósito (más cerca que
    // el grosor): ahí no hay choque entre puntos. Tampoco en el contorno del
    // cuello, que se mueve como una pieza.
    this.noCollide = new Uint8Array(n);
    for (const id of this.ringIds) this.noCollide[id] = 1;
    for (let i = 0; i < n; i++)
      for (const { id } of this.pins)
        if (Math.hypot(P[i * 3] - P[id * 3], P[i * 3 + 1] - P[id * 3 + 1], P[i * 3 + 2] - P[id * 3 + 2]) < 0.035) this.noCollide[i] = 1;
    this.cellStart = new Int32Array(1);
    this.cellFill = new Int32Array(0);
    this.pairs = new Int32Array(4096);
    this.pairCount = 0;
    this.cellIds = new Int32Array(n);
    this.cellOf = new Int32Array(n);
    this.time = 0;
    this.calm = 0;
    this.sleeping = false;
    this.wind = new THREE.Vector3();
    this.bounds = new THREE.Box3();
  }

  // Cada vértice de la malla fina sale de las 4 partículas de su celda.
  bindFine(L, W, SW) {
    const { C, NC, WC, SWC, RC } = this.dims;
    this.binds = [];
    const bindGrid = (key, rows, cols, at) => {
      const g = this.geos[key];
      const count = g.attributes.position.count;
      const ids = new Int32Array(count * 4);
      const ws = new Float32Array(count * 4);
      const use = new Uint8Array(count);
      for (let v = 0; v < count; v++) {
        const [I, J, gridMap, gw, gh] = at(v);
        const i0 = Math.min(Math.floor(I / 2), gh - 1);
        const j0 = Math.min(Math.floor(J / 2), gw - 2);
        const fi = I / 2 - i0;
        const fj = J / 2 - j0;
        const cs = [
          [i0, j0, (1 - fi) * (1 - fj)],
          [i0, j0 + 1, (1 - fi) * fj],
          [i0 + 1, j0, fi * (1 - fj)],
          [i0 + 1, j0 + 1, fi * fj],
        ];
        let ok = true;
        cs.forEach(([i, j, w], c) => {
          const id = gridMap[i * gw + j];
          if (w > 1e-6 && id < 0) ok = false;
          ids[v * 4 + c] = Math.max(id, 0);
          ws[v * 4 + c] = w;
        });
        use[v] = ok ? 1 : 0;
      }
      this.binds.push({ key, ids, ws, use });
    };
    for (const key of ['front', 'back']) bindGrid(key, NC, C, (v) => [Math.floor(v / W), v % W, this.map[key], WC, NC]);
    for (const [key, cuff] of [['sleeveL', 'cuffL'], ['sleeveR', 'cuffR']]) {
      bindGrid(key, RC, SWC, (v) => [Math.floor(v / SW), v % SW, this.sleeveMap[key], SWC, RC]);
      bindGrid(cuff, RC, SWC, (v) => [Math.floor(v / SW) + L.sleeveRows, v % SW, this.sleeveMap[key], SWC, RC]);
    }
    // Normales soldadas en las costuras (puntos que coinciden).
    const groups = new Map();
    for (const key of ['front', 'back', 'sleeveL', 'sleeveR', 'cuffL', 'cuffR']) {
      const g = this.geos[key];
      const a = g.attributes.position.array;
      const used = new Uint8Array(g.attributes.position.count);
      for (const v of g.index.array) used[v] = 1;
      for (let v = 0; v < used.length; v++) {
        if (!used[v]) continue;
        const k = `${Math.round(a[v * 3] * 2e5)},${Math.round(a[v * 3 + 1] * 2e5)},${Math.round(a[v * 3 + 2] * 2e5)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push([key, v]);
      }
    }
    this.weld = [...groups.values()].filter((g) => g.length > 1);
    // Dobladillos: cada vértice guarda su posición en el marco local
    // (tangente, subida, normal) de su punto del borde. (El cuello acompaña
    // al anillo rígido.)
    this.ribbons = [];
    for (const [key, ring, sign] of [
      ['hem', L.rings.hem, 1],
      ['cuffLLip', L.rings.cuffLLip, 1],
      ['cuffRLip', L.rings.cuffRLip, 1],
    ]) {
      const g = this.geos[key];
      const n = ring.length;
      const SWr = n + 1;
      const frames = this.ringFrames(ring, sign);
      const a = g.attributes.position.array;
      const local = new Float32Array(a.length);
      for (let v = 0; v < a.length / 3; v++) {
        const k = (v % SWr) % n;
        const f = frames[k];
        const ox = a[v * 3] - f.o.x;
        const oy = a[v * 3 + 1] - f.o.y;
        const oz = a[v * 3 + 2] - f.o.z;
        local[v * 3] = ox * f.t.x + oy * f.t.y + oz * f.t.z;
        local[v * 3 + 1] = ox * f.u.x + oy * f.u.y + oz * f.u.z;
        local[v * 3 + 2] = ox * f.n.x + oy * f.n.y + oz * f.n.z;
      }
      this.ribbons.push({ key, ring, sign, local, SWr, n });
    }
  }

  ringFrames(ring, sign) {
    const n = ring.length;
    const P = (key, v) => {
      const a = this.geos[key].attributes.position.array;
      return new THREE.Vector3(a[v * 3], a[v * 3 + 1], a[v * 3 + 2]);
    };
    const base = ring.map(([key, v]) => P(key, v));
    return ring.map(([key, v, w], k) => {
      const t = new THREE.Vector3().subVectors(base[(k + 1) % n], base[(k - 1 + n) % n]).normalize();
      const u0 = P(key, w).sub(base[k]).multiplyScalar(sign).normalize();
      const nn = new THREE.Vector3().crossVectors(t, u0).normalize();
      const u = new THREE.Vector3().crossVectors(nn, t).normalize();
      return { o: base[k], t, u, n: nn };
    });
  }

  wake() {
    this.sleeping = false;
    this.calm = 0;
  }

  // Empuje del mouse: las partículas cerca del punto se mueven en `dir`.
  push(point, dir, amount, radius = 0.075) {
    const P = this.p;
    for (let i = 0; i < this.n; i++) {
      if (!this.w[i]) continue;
      const dx = P[i * 3] - point.x;
      const dy = P[i * 3 + 1] - point.y;
      const dz = P[i * 3 + 2] - point.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= radius) continue;
      const w = (1 - d / radius) ** 2 * amount;
      P[i * 3] += dir.x * w;
      P[i * 3 + 1] += dir.y * w;
      P[i * 3 + 2] += dir.z * w;
    }
    this.wake();
  }

  breeze(v) {
    this.wind.add(v);
    if (this.wind.length() > 1.4) this.wind.setLength(1.4);
    this.wake();
  }

  step(dt) {
    if (this.sleeping) return false;
    const P = this.p;
    const Q = this.q;
    const n = this.n;
    const h = dt / SUBSTEPS;
    this.time += dt;
    const g = -9.8 * Math.min(1, 0.35 + this.time * 1.6) * h * h;
    const wx = this.wind.x * h * h;
    const wy = this.wind.y * h * h;
    const wz = this.wind.z * h * h;
    let motion = 0;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) {
        if (!this.w[i]) continue;
        const k = i * 3;
        let vx = (P[k] - Q[k]) * DAMP;
        let vy = (P[k + 1] - Q[k + 1]) * DAMP;
        let vz = (P[k + 2] - Q[k + 2]) * DAMP;
        // Tope de velocidad: ningún punto salta en un subpaso más que una
        // fracción del grosor (así no atraviesa otra capa de tela).
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > VMAX * VMAX) {
          const s = VMAX / Math.sqrt(v2);
          vx *= s;
          vy *= s;
          vz *= s;
        }
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
        // Brisa con variación suave en el espacio (no empuja todo igual).
        const gust = 0.55 + 0.45 * Math.sin(P[k] * 21 + P[k + 1] * 13 + this.time * 3.1);
        P[k] += vx + wx * gust;
        P[k + 1] += vy + g + wy * gust;
        P[k + 2] += vz + wz * gust;
      }
      this.holdPins();
      if (s === 0) this.findPairs();
      if (this.hanger) this.findContacts();
      for (let it = 0; it < ITERATIONS; it++) {
        this.solveLengths();
        this.tethers();
        this.matchCollar();
        this.collideSelf();
        this.holdApart(this.volPairs, this.volGap, 0.5);
        this.holdApart(this.layers, this.layerGap, 0.5);
        if (this.hanger) this.collideHanger();
      }
    }
    for (let i = 0; i < n * 3; i++) motion = Math.max(motion, Math.abs(P[i] - Q[i]));
    this.wind.multiplyScalar(Math.exp(-2.2 * dt));
    if (motion < 1e-4 && this.wind.lengthSq() < 1e-3) this.calm++;
    else this.calm = 0;
    if (this.calm > 40 && this.time > 1.5) this.sleeping = true;
    return true;
  }

  tethers() {
    const P = this.p;
    for (const { owner, len } of this.tetherSets)
      for (let i = 0; i < this.n; i++) {
        const a = owner[i];
        if (a < 0 || a === i || !this.w[i]) continue;
        const k = i * 3;
        const ka = a * 3;
        const dx = P[k] - P[ka];
        const dy = P[k + 1] - P[ka + 1];
        const dz = P[k + 2] - P[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= len[i]) continue;
        const f = len[i] / d;
        P[k] = P[ka] + dx * f;
        P[k + 1] = P[ka + 1] + dy * f;
        P[k + 2] = P[ka + 2] + dz * f;
      }
  }

  // Los broches llevan su tela de a poco hasta donde la aprietan (en el
  // primer tercio de segundo) y después la sostienen quieta.
  holdPins() {
    if (!this.pins.length) return;
    const P = this.p;
    const Q = this.q;
    const t = Math.min(1, this.time / 0.3);
    const e = t * t * (3 - 2 * t);
    for (const { id, from, to } of this.pins) {
      const k = id * 3;
      P[k] = Q[k] = from.x + (to.x - from.x) * e;
      P[k + 1] = Q[k + 1] = from.y + (to.y - from.y) * e;
      P[k + 2] = Q[k + 2] = from.z + (to.z - from.z) * e;
    }
  }

  // El cuello se mueve como una pieza: se busca la deformación lineal que
  // mejor lleva su forma original a la actual (mezcla de la rotación más
  // cercana y del ajuste lineal) y cada punto vuelve a su lugar en esa forma.
  // Así se puede inclinar y achatar en óvalo, pero no arrugarse.
  matchCollar() {
    const P = this.p;
    const ids = this.ringIds;
    const R = this.ringRest;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const id of ids) {
      cx += P[id * 3];
      cy += P[id * 3 + 1];
      cz += P[id * 3 + 2];
    }
    cx /= ids.length;
    cy /= ids.length;
    cz /= ids.length;
    const a = (this._a ||= new Float32Array(9)).fill(0);
    for (let k = 0; k < ids.length; k++) {
      const px = P[ids[k] * 3] - cx;
      const py = P[ids[k] * 3 + 1] - cy;
      const pz = P[ids[k] * 3 + 2] - cz;
      for (let c = 0; c < 3; c++) {
        const q = R[k * 3 + c];
        a[c * 3] += px * q;
        a[c * 3 + 1] += py * q;
        a[c * 3 + 2] += pz * q;
      }
    }
    const G = this.ringG;
    const qq = this.ringQQ;
    if (COLLAR_FLEX < 1) extractRotation(a, this.ringQ, 4);
    const { x, y, z, w } = this.ringQ;
    const rot = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        const lin = a[r] * qq[c * 3] + a[3 + r] * qq[c * 3 + 1] + a[6 + r] * qq[c * 3 + 2];
        G[c * 3 + r] = (1 - COLLAR_FLEX) * rot[c * 3 + r] + COLLAR_FLEX * lin;
      }
    this.ringC.set(cx, cy, cz);
    for (let k = 0; k < ids.length; k++) {
      if (!this.w[ids[k]]) continue;
      const [qx, qy, qz] = [R[k * 3], R[k * 3 + 1], R[k * 3 + 2]];
      const i = ids[k] * 3;
      P[i] = cx + G[0] * qx + G[3] * qy + G[6] * qz;
      P[i + 1] = cy + G[1] * qx + G[4] * qy + G[7] * qz;
      P[i + 2] = cz + G[2] * qx + G[5] * qy + G[8] * qz;
    }
  }

  solveLengths() {
    const P = this.p;
    const W = this.w;
    const { ca, cb, rest, kind } = this;
    for (let c = 0; c < ca.length; c++) {
      const a = ca[c] * 3;
      const b = cb[c] * 3;
      const dx = P[b] - P[a];
      const dy = P[b + 1] - P[a + 1];
      const dz = P[b + 2] - P[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const err = d - rest[c];
      // Estirar cuesta mucho; comprimir, poco (la tela se pliega). La
      // flexión es blanda.
      const kd = kind[c];
      const k = kd === 2 ? (err > 0 ? 0.4 : 0.25) : kd === 4 ? 0.35 : err > 0 ? 1 : kd === 1 ? 0.5 : 0.7;
      const wa = W[ca[c]];
      const wb = W[cb[c]];
      const ws = wa + wb;
      if (!ws) continue;
      const f = ((err / d) * k) / ws;
      P[a] += dx * f * wa;
      P[a + 1] += dy * f * wa;
      P[a + 2] += dz * f * wa;
      P[b] -= dx * f * wb;
      P[b + 1] -= dy * f * wb;
      P[b + 2] -= dz * f * wb;
    }
  }

  // Partículas cerca de la barra y el tramo más cercano de cada una (se
  // busca una vez por subpaso; en cada iteración sólo se miran sus vecinos).
  findContacts() {
    const P = this.p;
    const segs = this.hanger.segments;
    const minY = this.hanger.minY - 0.04;
    const ids = [];
    const near = [];
    const side = [];
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (P[k + 1] < minY || !this.w[i]) continue;
      let best = null;
      let bs = -1;
      for (let si = 0; si < segs.length; si++) {
        const r = this.segDist(k, segs[si]);
        if (!best || r.d2 < best.d2) {
          best = r;
          bs = si;
        }
      }
      if (best.d2 < 0.05 * 0.05) {
        ids.push(i);
        near.push(bs);
        // De qué lado de la barra está al empezar el subpaso: si en las
        // iteraciones la cruzara, vuelve por ese lado.
        const d = Math.sqrt(best.d2) || 1;
        side.push([(P[k] - best.cx) / d, (P[k + 1] - best.cy) / d, (P[k + 2] - best.cz) / d]);
      }
    }
    this.contacts = { ids, near, side };
  }

  segDist(k, s) {
    const P = this.p;
    const ex = s.b.x - s.a.x;
    const ey = s.b.y - s.a.y;
    const ez = s.b.z - s.a.z;
    let u = ((P[k] - s.a.x) * ex + (P[k + 1] - s.a.y) * ey + (P[k + 2] - s.a.z) * ez) / (ex * ex + ey * ey + ez * ez);
    u = Math.max(0, Math.min(1, u));
    const cx = s.a.x + ex * u;
    const cy = s.a.y + ey * u;
    const cz = s.a.z + ez * u;
    // Radio de choque algo mayor que el de la barra: la malla de la tela es
    // más gruesa que la barra y así ningún tramo de tela la atraviesa.
    return { d2: (P[k] - cx) ** 2 + (P[k + 1] - cy) ** 2 + (P[k + 2] - cz) ** 2, cx, cy, cz, r: Math.max(0.017, s.ra + (s.rb - s.ra) * u + 0.006) };
  }

  // Choque con la barra de la percha (dentro del ciclo de restricciones, así
  // la tela nunca llega a pasar del centro de la barra).
  collideHanger() {
    const P = this.p;
    const Q = this.q;
    const segs = this.hanger.segments;
    const { ids, near, side } = this.contacts;
    for (let c = 0; c < ids.length; c++) {
      const k = ids[c] * 3;
      let best = null;
      for (let si = Math.max(0, near[c] - 1); si <= Math.min(segs.length - 1, near[c] + 1); si++) {
        const r = this.segDist(k, segs[si]);
        if (!best || r.d2 < best.d2) best = r;
      }
      const d = Math.sqrt(best.d2);
      const rr = best.r;
      if (d >= rr) continue;
      let nx = (P[k] - best.cx) / (d || 1);
      let ny = (P[k + 1] - best.cy) / (d || 1);
      let nz = (P[k + 2] - best.cz) / (d || 1);
      const s0 = side[c];
      if (d < 1e-9 || nx * s0[0] + ny * s0[1] + nz * s0[2] < 0) [nx, ny, nz] = s0;
      P[k] = best.cx + nx * rr;
      P[k + 1] = best.cy + ny * rr;
      P[k + 2] = best.cz + nz * rr;
      // La tela que se apoya arriba de la barra queda adherida donde tocó
      // (como sobre una percha de madera); la que roza de costado, no.
      if (ny > 0.25) {
        this.w[ids[c]] = 0;
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
      }
    }
  }

  // Choque entre todos los puntos de la tela: si dos puntos que en la tela
  // están lejos (no son vecinos) quedan a menos de THICK, se separan. Cubre
  // manga contra cuerpo, pliegues que se meten en otros y frente contra
  // espalda en cualquier dirección.
  //
  // Una vez por cuadro se buscan los pares que están cerca (a menos de dos
  // grosores), con una grilla espacial sobre la caja que ocupa la tela: cada
  // punto sólo mira las 27 celdas que lo rodean. En cada subpaso sólo se
  // revisan esos pares (en un cuadro la tela se mueve mucho menos que eso).
  findPairs() {
    const P = this.p;
    const P0 = this.p0;
    const n = this.n;
    const reach = 2 * THICK;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const inv = 1 / reach;
    const nx = Math.floor((x1 - x0) * inv) + 1;
    const ny = Math.floor((y1 - y0) * inv) + 1;
    const nz = Math.floor((z1 - z0) * inv) + 1;
    const cells = nx * ny * nz;
    this.pairCount = 0;
    if (!(cells < 2e6)) return;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array(cells + 1);
      this.cellFill = new Int32Array(cells);
    }
    const start = this.cellStart;
    const fill = this.cellFill;
    const ids = this.cellIds;
    const cellOf = this.cellOf;
    start.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      const c = (Math.floor((P[i * 3] - x0) * inv) * ny + Math.floor((P[i * 3 + 1] - y0) * inv)) * nz + Math.floor((P[i * 3 + 2] - z0) * inv);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 1; c <= cells; c++) start[c] += start[c - 1];
    fill.set(start.subarray(0, cells));
    for (let i = 0; i < n; i++) ids[fill[cellOf[i]]++] = i;
    const r2 = reach * reach;
    const far2 = (2.5 * THICK) ** 2;
    let pairs = this.pairs;
    let count = 0;
    const skip = this.noCollide;
    for (let i = 0; i < n; i++) {
      if (skip[i]) continue;
      const ix = Math.floor((P[i * 3] - x0) * inv);
      const iy = Math.floor((P[i * 3 + 1] - y0) * inv);
      const iz = Math.floor((P[i * 3 + 2] - z0) * inv);
      for (let ax = Math.max(0, ix - 1); ax <= Math.min(nx - 1, ix + 1); ax++)
        for (let ay = Math.max(0, iy - 1); ay <= Math.min(ny - 1, iy + 1); ay++) {
          const row = (ax * ny + ay) * nz;
          const c0 = row + Math.max(0, iz - 1);
          const c1 = row + Math.min(nz - 1, iz + 1);
          for (let e = start[c0]; e < start[c1 + 1]; e++) {
            const j = ids[e];
            if (j <= i || skip[j]) continue;
            const dx = P[j * 3] - P[i * 3];
            const dy = P[j * 3 + 1] - P[i * 3 + 1];
            const dz = P[j * 3 + 2] - P[i * 3 + 2];
            if (dx * dx + dy * dy + dz * dz >= r2) continue;
            const rx = P0[j * 3] - P0[i * 3];
            const ry = P0[j * 3 + 1] - P0[i * 3 + 1];
            const rz = P0[j * 3 + 2] - P0[i * 3 + 2];
            if (rx * rx + ry * ry + rz * rz < far2) continue;
            if (count * 2 + 2 > pairs.length) {
              const grown = new Int32Array(pairs.length * 2);
              grown.set(pairs);
              pairs = this.pairs = grown;
            }
            pairs[count * 2] = i;
            pairs[count * 2 + 1] = j;
            count++;
          }
        }
    }
    this.pairCount = count;
  }

  // Los pares que se tocan se separan (a medias en cada iteración: corre
  // dentro del ciclo de restricciones y así converge sin vibrar).
  collideSelf() {
    const P = this.p;
    const W = this.w;
    const pairs = this.pairs;
    const t2 = THICK * THICK;
    for (let c = 0; c < this.pairCount; c++) {
      const i = pairs[c * 2];
      const j = pairs[c * 2 + 1];
      const dx = P[j * 3] - P[i * 3];
      const dy = P[j * 3 + 1] - P[i * 3 + 1];
      const dz = P[j * 3 + 2] - P[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= t2 || d2 < 1e-12) continue;
      const wi = W[i];
      const wj = W[j];
      if (!(wi + wj)) continue;
      const d = Math.sqrt(d2);
      const f = (((THICK - d) / d) * 0.5) / (wi + wj);
      P[i * 3] -= dx * f * wi;
      P[i * 3 + 1] -= dy * f * wi;
      P[i * 3 + 2] -= dz * f * wi;
      P[j * 3] += dx * f * wj;
      P[j * 3 + 1] += dy * f * wj;
      P[j * 3 + 2] += dz * f * wj;
    }
  }

  // Volumen: cada par (frente y espalda, o las dos caras de una manga) no se
  // acerca más que su separación mínima, en la dirección que los une (así
  // vale aunque la tela gire).
  holdApart(pairs, gaps, k) {
    const P = this.p;
    const W = this.w;
    for (let c = 0; c < pairs.length; c += 2) {
      const a = pairs[c];
      const b = pairs[c + 1];
      const wa = W[a];
      const wb = W[b];
      if (!(wa + wb)) continue;
      const dx = P[a * 3] - P[b * 3];
      const dy = P[a * 3 + 1] - P[b * 3 + 1];
      const dz = P[a * 3 + 2] - P[b * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const gap = gaps[c / 2];
      if (d >= gap || d < 1e-6) continue;
      const f = (((gap - d) / d) * k) / (wa + wb);
      P[a * 3] += dx * f * wa;
      P[a * 3 + 1] += dy * f * wa;
      P[a * 3 + 2] += dz * f * wa;
      P[b * 3] -= dx * f * wb;
      P[b * 3 + 1] -= dy * f * wb;
      P[b * 3 + 2] -= dz * f * wb;
    }
  }

  // Malla fina, cuello y dobladillos a partir de las partículas.
  updateMeshes() {
    const P = this.p;
    for (const b of this.binds) {
      const attr = this.geos[b.key].attributes.position;
      const a = attr.array;
      for (let v = 0; v < attr.count; v++) {
        if (!b.use[v]) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        for (let c = 0; c < 4; c++) {
          const w = b.ws[v * 4 + c];
          if (!w) continue;
          const id = b.ids[v * 4 + c] * 3;
          x += P[id] * w;
          y += P[id + 1] * w;
          z += P[id + 2] * w;
        }
        a[v * 3] = x;
        a[v * 3 + 1] = y;
        a[v * 3 + 2] = z;
      }
      attr.needsUpdate = true;
      this.geos[b.key].computeVertexNormals();
    }
    for (const group of this.weld) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const [key, v] of group) {
        const nn = this.geos[key].attributes.normal.array;
        x += nn[v * 3];
        y += nn[v * 3 + 1];
        z += nn[v * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      for (const [key, v] of group) this.geos[key].attributes.normal.array.set([x / l, y / l, z / l], v * 3);
    }
    for (const r of this.ribbons) {
      const frames = this.ringFrames(r.ring, r.sign);
      const attr = this.geos[r.key].attributes.position;
      const a = attr.array;
      for (let v = 0; v < attr.count; v++) {
        const f = frames[(v % r.SWr) % r.n];
        const l = r.local;
        a[v * 3] = f.o.x + f.t.x * l[v * 3] + f.u.x * l[v * 3 + 1] + f.n.x * l[v * 3 + 2];
        a[v * 3 + 1] = f.o.y + f.t.y * l[v * 3] + f.u.y * l[v * 3 + 1] + f.n.y * l[v * 3 + 2];
        a[v * 3 + 2] = f.o.z + f.t.z * l[v * 3] + f.u.z * l[v * 3 + 1] + f.n.z * l[v * 3 + 2];
      }
      attr.needsUpdate = true;
      this.geos[r.key].computeVertexNormals();
    }
    // La tira del cuello acompaña al contorno.
    const attr = this.geos.collar.attributes.position;
    const a = attr.array;
    const B = this.collarBase;
    const O = this.collarOff;
    const SW = this.collarSW;
    const G = this.ringG;
    const c = this.ringC;
    extractRotation(G, this.ringQ, 8);
    const m = (this._m ||= new THREE.Matrix4()).makeRotationFromQuaternion(this.ringQ).elements;
    for (let v = 0; v < a.length / 3; v++) {
      const b = (v % SW) * 3;
      const i = v * 3;
      a[i] = c.x + G[0] * B[b] + G[3] * B[b + 1] + G[6] * B[b + 2] + m[0] * O[i] + m[4] * O[i + 1] + m[8] * O[i + 2];
      a[i + 1] = c.y + G[1] * B[b] + G[4] * B[b + 1] + G[7] * B[b + 2] + m[1] * O[i] + m[5] * O[i + 1] + m[9] * O[i + 2];
      a[i + 2] = c.z + G[2] * B[b] + G[5] * B[b + 1] + G[8] * B[b + 2] + m[2] * O[i] + m[6] * O[i + 1] + m[10] * O[i + 2];
    }
    attr.needsUpdate = true;
    this.geos.collar.computeVertexNormals();
    for (const g of Object.values(this.geos)) g.computeBoundingSphere();
  }
}
