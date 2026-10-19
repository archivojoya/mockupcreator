// Short de fútbol: dos piernas, cada una de una sola pieza (con su propio
// molde de estampado), la cintura elástica arriba y el ruedo abajo, que es
// como el puño de la manga (otra pieza, con su color y su dobladillo). Puesto
// va debajo de la camiseta, que tapa la cintura. Medidas en metros, con el
// mismo origen que la camiseta (y = 0 en el hombro, z hacia el frente).
import * as THREE from 'three';
import { buildLip, computeNormals, weldNormals, gridIndex, gridUV, orient } from './shirt.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Alturas: cintura, entrepierna y ruedo (la camiseta de 62 cm termina en
// -0,62).
export const SHORT = { waist: -0.53, crotch: -0.78, hem: -0.93 };
const ROWS = 72; // filas, del ruedo a la cintura (de 5,5 mm)
const COLS = 96; // columnas de cada pierna, de la costura de adelante a la de atrás
const HEM_ROWS = 4; // filas del ruedo (2,2 cm)
const WAIST_ROWS = 7; // filas de la cintura (3,9 cm)
const CROTCH_SPAN = 0.07; // cuánto más arriba de la entrepierna empiezan a separarse las piernas
const HEM_GAP = 0.04; // entre las dos piernas, en el ruedo
const FLARE = 1.1; // cuánto más ancho es el ruedo que la cadera (visto de frente)
const CUFF_OUT = 0.0012; // el ruedo va apoyado por fuera de la tela
const T_SAMPLES = 480;

// Medidas que salen de la camiseta: debajo de ella la cadera entra con
// margen en su parte más angosta (si no, asoma a través de la tela); al salir
// del ruedo se ensancha enseguida hasta casi su ancho (A2, F2, B2) y abajo se
// abre un poco más.
function shortMeasures(M) {
  const hemY = -M.L;
  let a = Infinity;
  let f = Infinity;
  let b = Infinity;
  for (let k = 0; k <= 8; k++) {
    const y = Math.max(hemY, lerp(SHORT.waist, hemY, k / 8));
    a = Math.min(a, M.sa(y));
    f = Math.min(f, M.sb(y));
    b = Math.min(b, M.sbB(y));
  }
  return { hemY, A: a * 0.94, F: f * 0.88, B: b * 0.88, A2: M.sa(hemY) * 0.99, F2: M.sb(hemY) * 0.95, B2: M.sbB(hemY) * 0.98, n: M.n };
}
const OUT_OF_SHIRT = 0.03; // cuánto tarda en ensancharse al salir de la camiseta

// Sección a la altura y: superelipse de centro (sx, 0), medio ancho sa,
// hondo adelante sbF y atrás sbB, exponente n. Arriba es la cadera (centrada:
// cada pierna es su mitad); cerca de la entrepierna se corre hacia afuera y se
// achica con el borde de afuera derecho, hasta tocar el medio justo en la
// entrepierna; más abajo, cada pierna sola, apenas separada de la otra.
function section(S, y) {
  const w = smooth(clamp01((S.hemY - y) / OUT_OF_SHIRT));
  const fl = clamp01((S.hemY - y) / (S.hemY - SHORT.hem));
  const outer = lerp(S.A, S.A2, w) * (1 + (FLARE - 1) * fl ** 1.6);
  const F = lerp(S.F, S.F2, w);
  const B = lerp(S.B, S.B2, w);
  const top = SHORT.crotch + CROTCH_SPAN;
  const s = smooth(clamp01((top - y) / CROTCH_SPAN));
  const b = clamp01((SHORT.crotch - y) / (SHORT.crotch - SHORT.hem));
  const inner = y > SHORT.crotch ? -(1 - s) * outer : (HEM_GAP / 2) * b ** 1.2;
  return {
    sx: (outer + inner) / 2,
    sa: (outer - inner) / 2,
    sbF: F * (y > SHORT.crotch ? lerp(1, 0.9, s) : lerp(0.9, 0.86, b)),
    sbB: B * (y > SHORT.crotch ? lerp(1, 0.86, s) : lerp(0.86, 0.8, b)),
    n: y > SHORT.crotch ? lerp(S.n, 2, s) : 2,
  };
}
// Punto de la sección para el ángulo t (π/2 adelante, 0 afuera, -π/2 atrás).
function sectionPoint(c, t) {
  const e = 2 / c.n;
  const st = Math.sin(t);
  return [c.sx + c.sa * spow(Math.cos(t), e), (st >= 0 ? c.sbF : c.sbB) * spow(st, e)];
}

// Una pierna (la izquierda, x > 0): grilla de ROWS + 1 filas por COLS + 1
// columnas. Cada fila va de la costura de adelante a la de atrás por afuera,
// con las columnas a distancias iguales. Arriba de la entrepierna las puntas
// están en el medio (las costuras de adelante y de atrás, con la otra
// pierna); debajo se juntan (la costura de la entrepierna).
function legGrid(S) {
  const W = COLS + 1;
  const pos = new Float32Array(W * (ROWS + 1) * 3);
  const ts = new Float64Array(T_SAMPLES + 1);
  const cum = new Float64Array(T_SAMPLES + 1);
  for (let r = 0; r <= ROWS; r++) {
    const y = lerp(SHORT.hem, SHORT.waist, r / ROWS);
    const c = section(S, y);
    // Ángulo donde la sección cruza el medio (x = 0), o la vuelta entera.
    const tf = Math.acos(-(Math.min(1, c.sx / c.sa) ** (c.n / 2)));
    let prev = null;
    for (let k = 0; k <= T_SAMPLES; k++) {
      ts[k] = tf - (2 * tf * k) / T_SAMPLES;
      const p = sectionPoint(c, ts[k]);
      cum[k] = prev ? cum[k - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 0;
      prev = p;
    }
    let k = 0;
    for (let j = 0; j <= COLS; j++) {
      const target = (cum[T_SAMPLES] * j) / COLS;
      while (k < T_SAMPLES - 1 && cum[k + 1] < target) k++;
      const f = (target - cum[k]) / (cum[k + 1] - cum[k] || 1);
      const p = sectionPoint(c, lerp(ts[k], ts[k + 1], clamp01(f)));
      pos.set([p[0], y, p[1]], (r * W + j) * 3);
    }
    // La primera y la última columna: juntas (entrepierna) o justo en el
    // medio (tiro).
    if (c.sx >= c.sa) pos.set(pos.subarray(r * W * 3, r * W * 3 + 3), (r * W + COLS) * 3);
    else {
      pos[r * W * 3] = 0;
      pos[(r * W + COLS) * 3] = 0;
    }
  }
  return { pos, W };
}

// El ruedo (las filas de abajo) se apoya por fuera de la tela: sube desde la
// costura en una fila.
function liftCuff(S, pos, W) {
  for (let r = 0; r < HEM_ROWS; r++) {
    const f = CUFF_OUT * Math.min(1, HEM_ROWS - r);
    for (let j = 0; j < W; j++) {
      const v = (r * W + j) * 3;
      const c = section(S, pos[v + 1]);
      const dx = pos[v] - c.sx;
      const dz = pos[v + 2];
      const l = Math.hypot(dx, dz) || 1;
      pos[v] += (dx / l) * f;
      pos[v + 2] += (dz / l) * f;
    }
  }
}
// Las piezas del short: piernas (legL, legR), ruedos (hemL, hemR) con su
// dobladillo, y cintura (waistL, waistR) con su dobladillo de arriba.
export function buildShorts(M) {
  const S = shortMeasures(M);
  const { pos: base, W } = legGrid(S);
  liftCuff(S, base, W);
  const parts = {};
  const c0 = COLS / 2;
  for (const [key, side] of [
    ['L', 1],
    ['R', -1],
  ]) {
    const pos = Float32Array.from(base);
    if (side < 0) for (let v = 0; v < pos.length; v += 3) pos[v] = -pos[v];
    const uv = gridUV(pos, W, ROWS + 1, c0);
    // Molde: visto desde afuera, x hacia la derecha (en la izquierda, hacia
    // atrás; en la derecha, hacia adelante) e y hacia abajo desde la
    // cintura en el costado.
    const vTop = uv[(ROWS * W + c0) * 2 + 1];
    const uv1 = new Float32Array(uv.length);
    for (let v = 0; v < uv.length / 2; v++) {
      uv1[v * 2] = side * uv[v * 2];
      uv1[v * 2 + 1] = vTop - uv[v * 2 + 1];
    }
    const out = (x, y, z) => {
      const c = section(S, y);
      return [x - side * c.sx, 0, z];
    };
    const slice = (r0, r1) => {
      const a = r0 * W;
      const b = (r1 + 1) * W;
      const p = pos.slice(a * 3, b * 3);
      const part = { pos: p, uv: uv.slice(a * 2, b * 2), uv1: uv1.slice(a * 2, b * 2), idx: orient(p, gridIndex(COLS, r1 - r0, W), out) };
      // Costuras: los bordes de la pieza (entrepierna y tiro) y los cortes
      // del ruedo y la cintura.
      const vv = part.uv;
      part.seam = new Float32Array((p.length / 3) * 2);
      for (let v = 0; v < p.length / 3; v++) {
        const row = Math.floor(v / W);
        const u = vv[v * 2];
        const uL = vv[row * W * 2];
        const uR = vv[(row * W + COLS) * 2];
        const lo = vv[(v % W) * 2 + 1];
        const hi = vv[((r1 - r0) * W + (v % W)) * 2 + 1];
        part.seam[v * 2] = Math.min(u - uL, uR - u, r0 > 0 ? vv[v * 2 + 1] - lo : Infinity, r1 < ROWS ? hi - vv[v * 2 + 1] : Infinity);
        part.seam[v * 2 + 1] = 1;
      }
      return part;
    };
    parts['leg' + key] = slice(HEM_ROWS, ROWS - WAIST_ROWS);
    parts['hem' + key] = slice(0, HEM_ROWS);
    parts['waist' + key] = slice(ROWS - WAIST_ROWS, ROWS);
    // Dobladillo del ruedo (vuelta cerrada: la última columna es la primera).
    const ring = [];
    for (let j = 0; j < COLS; j++) ring.push([pos, j, W + j]);
    parts['hem' + key + 'Lip'] = buildLip(ring, 0.016, true);
  }
  // Dobladillo de la cintura: la vuelta entera (las dos piernas).
  const waistRing = [];
  const L = parts.waistL.pos;
  const R = parts.waistR.pos;
  const rt = WAIST_ROWS * W;
  for (let j = 0; j < COLS; j++) waistRing.push([L, rt + j, rt - W + j]);
  for (let j = COLS; j > 0; j--) waistRing.push([R, rt + j, rt - W + j]);
  parts.waistLip = buildLip(waistRing, 0.03, true);
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals(['legL', 'legR', 'hemL', 'hemR', 'waistL', 'waistR'].map((k) => parts[k]));
  const geos = {};
  for (const [key, part] of Object.entries(parts)) {
    const g = new THREE.BufferGeometry();
    const n = part.pos.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(part.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    if (part.uv1) g.setAttribute('uv1', new THREE.BufferAttribute(part.uv1, 2));
    g.setAttribute('seam', new THREE.BufferAttribute(part.seam || new Float32Array(n * 2).fill(1), 2));
    g.setAttribute('zone', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setIndex(part.idx);
    g.computeBoundingBox();
    geos[key] = g;
  }
  return geos;
}
