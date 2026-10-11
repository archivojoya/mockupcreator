// Camiseta colgada: la tela se simula en vivo con dinámica de posiciones
// (partículas unidas por restricciones de largo) sobre una malla a media
// resolución de la misma camiseta. La malla fina que se ve sigue a la gruesa;
// cuello y dobladillos acompañan a su borde.
//
// - Cuelga de una percha de madera (sólido de choque con forma de barra).
// - Frente y espalda no se cruzan: cada punto del frente se mantiene delante
//   del punto más cercano de la espalda. Lo mismo las dos caras de cada
//   manga.
// - El mouse empuja la tela al pasar y levanta una brisa suave.
// - Cuando la tela se queda quieta la simulación se duerme (no gasta nada).

import * as THREE from 'three';
import { armholeLoopIJ } from './shirt.js';

const SUBSTEPS = 4;
const ITERATIONS = 5;
const GAP = 0.005; // separación mínima entre capas de tela
const DAMP = 0.991; // amortiguación de la velocidad por subpaso

// ---------- percha ----------

// Barra de la percha bajo la costura de los hombros, con gancho.
export function makeHanger(M) {
  const xEnd = M.shA - 0.06;
  const seamY = (x) => {
    const ax = Math.abs(x);
    return ax <= M.neck.a ? 0 : (M.shY * (ax - M.neck.a)) / (M.shA - M.neck.a);
  };
  const radius = (x) => 0.0095 + 0.0075 * (Math.abs(x) / xEnd) ** 2;
  // Puntos de control: debajo de la costura del hombro y, en el centro,
  // debajo de la nuca (vista de arriba la barra se curva hacia adelante en
  // las puntas, como una percha de madera).
  const backZ = M.neck.c - M.neck.b * 0.82;
  const ctrl = [];
  for (const x of [-xEnd, -0.75 * xEnd, -0.5 * xEnd, -0.28 * xEnd, 0, 0.28 * xEnd, 0.5 * xEnd, 0.75 * xEnd, xEnd]) {
    const t = Math.abs(x) / xEnd;
    const y = Math.min(seamY(x) - radius(x) - 0.006, -0.032 - 0.02 * t * t);
    const z = backZ + (-0.008 - backZ) * Math.min(1, t * 1.25) ** 1.4;
    ctrl.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const cpts = curve.getSpacedPoints(48);
  const segments = [];
  for (let i = 0; i + 1 < cpts.length; i++) segments.push({ a: cpts[i], b: cpts[i + 1], ra: radius(cpts[i].x), rb: radius(cpts[i + 1].x) });
  // La barra que se ve es un poco más corta que la de choque: las puntas
  // quedan siempre tapadas por la tela del hombro.
  const trim = 0.038 / curve.getLength();
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
  return { bar, hook, segments, minY: Math.min(...cpts.map((p) => p.y - radius(p.x))) };
}

// ---------- simulación ----------

export class HangingShirt {
  constructor(built, hanger) {
    this.geos = built.geos;
    this.hanger = hanger;
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
    this.w = new Float32Array(n).fill(1); // 0 = adherida a la percha

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
    // El contorno del cuello no se deforma (lo sostiene la tira acanalada):
    // uniones cruzadas de lado a lado y de adelante hacia atrás.
    const top = (key, j) => map[key][NC * WC + j];
    for (let j = 0; j < C / 2; j += 2) {
      link(top('front', j), top('front', C - j), 3);
      link(top('back', j), top('back', C - j), 3);
      link(top('front', j), top('back', C - j), 3);
      link(top('front', C / 2), top('back', j), 3);
      link(top('back', C / 2), top('front', j), 3);
    }
    const list = [...pairs.values()];
    this.ca = Int32Array.from(list, (c) => c[0]);
    this.cb = Int32Array.from(list, (c) => c[1]);
    this.rest = Float32Array.from(list, (c) => c[2]);
    this.kind = Uint8Array.from(list, (c) => c[3]);

    // Ataduras de largo máximo: cada punto no se aleja de los hombros (que
    // apoyan en la percha) más que su distancia a lo largo de la tela. Así
    // la tela no se estira como goma con su propio peso.
    const anchors = [];
    for (let i = i2; i <= NC; i++) anchors.push(map.front[i * WC], map.front[i * WC + C]);
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b, r, kd] of list) {
      if (kd > 1) continue;
      adj[a].push(b, r);
      adj[b].push(a, r);
    }
    const geo = new Float32Array(n).fill(Infinity);
    const owner = new Int32Array(n).fill(-1);
    const heap = [];
    const pushH = (d, i) => {
      heap.push([d, i]);
      let c = heap.length - 1;
      while (c > 0) {
        const pnt = (c - 1) >> 1;
        if (heap[pnt][0] <= heap[c][0]) break;
        [heap[pnt], heap[c]] = [heap[c], heap[pnt]];
        c = pnt;
      }
    };
    const popH = () => {
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
      pushH(0, a);
    }
    while (heap.length) {
      const [d, i] = popH();
      if (d > geo[i]) continue;
      const nb = adj[i];
      for (let e = 0; e < nb.length; e += 2) {
        const j = nb[e];
        const nd = d + nb[e + 1];
        if (nd < geo[j]) {
          geo[j] = nd;
          owner[j] = owner[i];
          pushH(nd, j);
        }
      }
    }
    this.tetherOwner = owner;
    this.tetherLen = Float32Array.from(geo, (g) => g * 1.02);

    // Pares de capas: frente delante de la espalda, y las dos caras de cada
    // manga.
    const layers = [];
    // Frente y espalda: se comparan por cercanía (no por índice), así no se
    // cruzan aunque se corran al colgar.
    const own = (key) => new Set(map[key].filter((id) => id >= 0));
    const fs = own('front');
    const bs = own('back');
    this.frontIds = Int32Array.from([...fs].filter((id) => !bs.has(id)));
    this.backIds = Int32Array.from([...bs].filter((id) => !fs.has(id)));
    const LC = SWC - 1;
    for (const m of Object.values(sleeveMap))
      for (let r = 1; r <= RC; r++)
        for (let k = 1; k < LC / 2; k++) layers.push(m[r * SWC + k], m[r * SWC + LC - k]);
    this.layers = Int32Array.from(layers);
    this.bindFine(L, W, SW);
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
    // Cuello y dobladillos: cada vértice guarda su posición en el marco
    // local (tangente, subida, normal) de su punto del borde.
    this.ribbons = [];
    for (const [key, ring, sign] of [
      ['collar', L.rings.collar, -1],
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
        const vx = (P[k] - Q[k]) * DAMP;
        const vy = (P[k + 1] - Q[k + 1]) * DAMP;
        const vz = (P[k + 2] - Q[k + 2]) * DAMP;
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
        // Brisa con variación suave en el espacio (no empuja todo igual).
        const gust = 0.55 + 0.45 * Math.sin(P[k] * 21 + P[k + 1] * 13 + this.time * 3.1);
        P[k] += vx + wx * gust;
        P[k + 1] += vy + g + wy * gust;
        P[k + 2] += vz + wz * gust;
      }
      this.findContacts();
      for (let it = 0; it < ITERATIONS; it++) {
        this.solveLengths();
        this.tethers();
        this.collideHanger();
      }
      this.separateLayers();
    }
    for (let i = 0; i < n * 3; i++) motion = Math.max(motion, Math.abs(P[i] - Q[i]));
    this.wind.multiplyScalar(Math.exp(-2.2 * dt));
    if (motion < 4e-5 && this.wind.lengthSq() < 1e-3) this.calm++;
    else this.calm = 0;
    if (this.calm > 40 && this.time > 1.5) this.sleeping = true;
    return true;
  }

  tethers() {
    const P = this.p;
    const own = this.tetherOwner;
    const len = this.tetherLen;
    for (let i = 0; i < this.n; i++) {
      const a = own[i];
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
      const k = kd === 2 ? (err > 0 ? 0.3 : 0.1) : kd === 4 ? 0.35 : err > 0 || kd === 3 ? 1 : kd === 1 ? 0.5 : 0.7;
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

  separateLayers() {
    const P = this.p;
    const W = this.w;
    // Torso: cada punto del frente contra el punto de la espalda más cercano
    // en el plano (grilla de celdas de 2 cm).
    const cell = 0.02;
    const grid = new Map();
    const cellKey = (x, y) => (Math.floor(x / cell) + 512) * 1024 + Math.floor(y / cell) + 512;
    for (const b of this.backIds) {
      const key = cellKey(P[b * 3], P[b * 3 + 1]);
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(b);
    }
    for (const f of this.frontIds) {
      const fx = P[f * 3];
      const fy = P[f * 3 + 1];
      const cx = Math.floor(fx / cell);
      const cy = Math.floor(fy / cell);
      let best = -1;
      let bd = cell * cell;
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get((cx + ox + 512) * 1024 + cy + oy + 512);
          if (!list) continue;
          for (const b of list) {
            const d = (P[b * 3] - fx) ** 2 + (P[b * 3 + 1] - fy) ** 2;
            if (d < bd) {
              bd = d;
              best = b;
            }
          }
        }
      if (best < 0) continue;
      const wf = W[f];
      const wb = W[best];
      if (!(wf + wb)) continue;
      const d = P[f * 3 + 2] - P[best * 3 + 2] - GAP;
      if (d < 0) {
        P[f * 3 + 2] -= (d * wf) / (wf + wb);
        P[best * 3 + 2] += (d * wb) / (wf + wb);
      }
    }
    const L = this.layers;
    for (let c = 0; c < L.length; c += 2) {
      const wf = W[L[c]];
      const wb = W[L[c + 1]];
      if (!(wf + wb)) continue;
      const f = L[c] * 3 + 2;
      const b = L[c + 1] * 3 + 2;
      const d = P[f] - P[b] - GAP;
      if (d < 0) {
        P[f] -= (d * wf) / (wf + wb);
        P[b] += (d * wb) / (wf + wb);
      }
    }
  }

  // Las mangas no entran en el torso: quedan del lado de afuera del costado
  // (cuando están a la misma profundidad que el cuerpo).
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
    for (const g of Object.values(this.geos)) g.computeBoundingSphere();
  }
}
