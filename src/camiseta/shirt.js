// Camiseta deportiva de cuello redondo, modelada con código (sin moldes ni
// simulación). La forma es la de una prenda puesta sobre un cuerpo invisible:
//
// - Torso: anillos horizontales (cortes superelípticos) desde el ruedo hasta
//   el escote. Cerca del escote cada columna se curva hacia el contorno del
//   cuello; a los costados esa curva es la línea del hombro.
// - Sisas: un hueco en la grilla del torso a cada lado, deformado hasta
//   quedar ovalado. Las mangas arrancan exactamente de su borde.
// - Mangas: de la sisa a un ruedo circular alrededor del eje del brazo, con
//   puño aparte.
// - Cuello: tira acanalada sobre el borde del escote. Ruedo y puños llevan
//   un dobladillo hacia adentro (se ve el espesor de la tela).
//
// Medidas en metros, y hacia arriba, z hacia el frente; y = 0 es el punto
// más alto del hombro (junto al cuello). Las coordenadas UV de cada pieza
// están en metros sobre la tela, listas para estampar un diseño.

import * as THREE from 'three';

export const DEFAULTS = {
  fit: 0.5, // 0 ajustada · 0.5 regular · 1 holgada
  length: 0.72, // del hombro al ruedo
  sleeveLength: 0.21, // de la punta del hombro al ruedo de la manga
  sleeveAngle: 40, // apertura de las mangas, grados desde la vertical
  neckDepth: 0.085, // profundidad del escote delantero
};

// Resolución de las mallas.
const COLS = 64; // columnas de cada mitad del torso (de costado a costado)
const ARM_COLS = 10; // columnas de la sisa a cada lado de la costura
const ROWS_LOW = 64; // del ruedo a la axila
const ROWS_ARM = 24; // de la axila a la punta del hombro
const ROWS_TOP = 8; // del hombro al cuello
const SLEEVE_ROWS = 30;
const CUFF_ROWS = 4;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Interpolación cúbica monótona (no se pasa de los valores de la tabla).
function monotone(xs, ys) {
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// Medidas del cuerpo de la prenda según los controles.
export function measures(p) {
  const f = p.fit;
  const L = p.length;
  const M = {
    L,
    fit: f,
    neck: { a: 0.088, b: 0.08, c: -0.014 }, // contorno del cuello en el hombro
    dropF: p.neckDepth,
    dropB: 0.02,
    shY: -0.046, // altura de la punta del hombro
    pitY: -0.205 - 0.03 * f, // altura de la axila
    n: 2.35, // exponente de los cortes (2 = elipse)
  };
  const shA = 0.214 + 0.032 * f; // medio ancho de hombros
  const aC = 0.176 + 0.046 * f; // medio ancho y media profundidad del pecho
  const bC = 0.112 + 0.022 * f;
  const rows = [
    // y, medio ancho, media profundidad, centro z
    [-L - 0.2, aC + 0.012 * f, bC - 0.004 + 0.004 * f, 0],
    [-L, aC + 0.012 * f, bC - 0.004 + 0.004 * f, 0],
    [-0.44, aC - 0.008 + 0.006 * f, bC - 0.008, 0.004],
    [M.pitY, aC, bC, 0.006],
    [-0.115, Math.max(shA - 0.008, aC + 0.006), bC - 0.006, 0],
    [M.shY, shA, 0.098 + 0.01 * f, -0.008],
    [M.shY / 2, lerp(M.neck.a, shA, 0.5), lerp(M.neck.b, 0.098 + 0.01 * f, 0.5), lerp(M.neck.c, -0.008, 0.5)],
    [0, M.neck.a, M.neck.b, M.neck.c],
  ];
  const ys = rows.map((r) => r[0]);
  M.sa = monotone(ys, rows.map((r) => r[1]));
  M.sb = monotone(ys, rows.map((r) => r[2]));
  M.sc = monotone(ys, rows.map((r) => r[3]));
  M.shA = shA;
  M.sleeve = {
    len: p.sleeveLength,
    angle: THREE.MathUtils.degToRad(p.sleeveAngle),
    rHem: 0.058 + 0.016 * f,
    cuff: 0.026,
  };
  return M;
}

// Perímetro del corte del torso a una altura (para la ficha de medidas).
export function girth(M, y) {
  let per = 0;
  let prev = null;
  const a = M.sa(y);
  const b = M.sb(y);
  for (let i = 0; i <= 256; i++) {
    const t = (i / 256) * Math.PI * 2;
    const q = [a * spow(Math.sin(t), 2 / M.n), b * spow(Math.cos(t), 2 / M.n)];
    if (prev) per += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    prev = q;
  }
  return per;
}

const neckY = (M, th) => {
  const c = Math.cos(th);
  return c >= 0 ? -M.dropF * c : M.dropB * c;
};

// Punto del torso para el ángulo th (0 frente, π/2 costado izquierdo, π
// espalda) y t (0 ruedo, 1 escote).
function torsoPoint(M, th, t, out) {
  const yn = neckY(M, th);
  const y = lerp(-M.L, yn, t);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const e = 2 / M.n;
  let x = M.sa(y) * spow(sn, e);
  let z = M.sc(y) + M.sb(y) * spow(cs, e);
  let yy = y;
  // Cerca del escote la columna se curva hacia el contorno del cuello. A los
  // costados eso recorre la línea del hombro; al frente, la subida del pecho.
  const del = lerp(-M.shY, cs >= 0 ? 0.075 : 0.05, cs * cs);
  // Arranque suave y final con pendiente: las últimas filas no se apiñan.
  const w = 1 - Math.cos((Math.PI / 2) * clamp01((y - (yn - del)) / del));
  if (w > 0) {
    x = lerp(x, M.neck.a * sn, w);
    yy = lerp(y, yn, w);
    z = lerp(z, M.neck.c + M.neck.b * cs, w);
  }
  out[0] = x;
  out[1] = yy;
  out[2] = z;
  return out;
}

// ---------- ruido suave para los pliegues ----------

function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  let v = 0;
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++)
      for (let dz = 0; dz < 2; dz++) {
        const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        v += w * hash3(xi + dx, yi + dy, zi + dz);
      }
  return v * 2 - 1;
}

// ---------- torso ----------

function buildTorso(M) {
  const N = ROWS_LOW + ROWS_ARM + ROWS_TOP;
  const tPit = (M.pitY + M.L) / M.L;
  const tSh = (M.shY + M.L) / M.L;
  const tRow = (i) => {
    if (i <= ROWS_LOW) return (tPit * i) / ROWS_LOW;
    if (i <= ROWS_LOW + ROWS_ARM) return lerp(tPit, tSh, (i - ROWS_LOW) / ROWS_ARM);
    return lerp(tSh, 1, (i - ROWS_LOW - ROWS_ARM) / ROWS_TOP);
  };
  const i1 = ROWS_LOW;
  const i2 = ROWS_LOW + ROWS_ARM;
  const dTh = (ARM_COLS * Math.PI) / COLS;
  const tc = (tPit + tSh) / 2;
  const dT = (tSh - tPit) / 2;
  // Las sisas son huecos rectangulares en la grilla; alrededor de cada una
  // los parámetros se deforman para que el borde quede ovalado.
  const warp = (th, t, thc) => {
    const p = (th - thc) / dTh;
    const q = (t - tc) / dT;
    const rho = Math.max(Math.abs(p), Math.abs(q));
    const r = Math.hypot(p, q);
    if (rho >= 2.4 || r < 1e-9) return [th, t];
    // Sin tocar el escote (la fila de arriba sigue en t = 1).
    const top = q > 0 ? clamp01((1 - t) / (1 - tSh)) : 1;
    const k = lerp(1, rho / r, (1 - smoothstep(1, 2.4, rho)) * top);
    return [thc + p * k * dTh, tc + q * k * dT];
  };
  const panels = {};
  for (const key of ['front', 'back']) {
    const th0 = key === 'front' ? -Math.PI / 2 : Math.PI / 2;
    const W = COLS + 1;
    const pos = new Float32Array(W * (N + 1) * 3);
    const ang = new Float32Array(W * (N + 1));
    const tmp = [0, 0, 0];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= COLS; j++) {
        let th = th0 + (Math.PI * j) / COLS;
        let t = tRow(i);
        [th, t] = warp(th, t, th0);
        [th, t] = warp(th, t, th0 + Math.PI);
        torsoPoint(M, th, t, tmp);
        const k = i * W + j;
        pos.set(tmp, k * 3);
        ang[k] = th;
      }
    }
    // Celdas: todas menos las de las sisas.
    const idx = [];
    const hole = (i, j) => i >= i1 && i < i2 && (j < ARM_COLS || j >= COLS - ARM_COLS);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < COLS; j++) {
        if (hole(i, j)) continue;
        const a = i * W + j;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    orient(pos, idx, fromVertical);
    panels[key] = { pos, ang, idx, W, N };
  }
  return { panels, i1, i2, N };
}

// Borde de cada sisa, desde la axila: sube por el frente, cruza el hombro y
// baja por la espalda. Devuelve [pieza, índice] de cada punto.
function armholeLoop(torso, side) {
  const { i1, i2 } = torso;
  const W = COLS + 1;
  const F = (i, j) => ['front', i * W + j];
  const B = (i, j) => ['back', i * W + j];
  const out = [];
  const A = ARM_COLS;
  if (side > 0) {
    out.push(F(i1, COLS));
    for (let j = COLS - 1; j >= COLS - A; j--) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, COLS - A));
    for (let j = COLS - A + 1; j <= COLS; j++) out.push(F(i2, j));
    for (let j = 1; j <= A; j++) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, A));
    for (let j = A - 1; j >= 1; j--) out.push(B(i1, j));
  } else {
    out.push(F(i1, 0));
    for (let j = 1; j <= A; j++) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, A));
    for (let j = A - 1; j >= 0; j--) out.push(F(i2, j));
    for (let j = COLS - 1; j >= COLS - A; j--) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, COLS - A));
    for (let j = COLS - A + 1; j <= COLS - 1; j++) out.push(B(i1, j));
  }
  return out;
}

// Pliegues del torso: caída suave hacia el ruedo y tensiones que salen de la
// axila. Es un campo continuo en el espacio, así las costuras no se abren.
function torsoFolds(M, x, y, z, th, armpits) {
  const f = M.fit;
  const drapeA = (0.003 + 0.005 * f) * smoothstep(M.pitY - 0.04, M.pitY - 0.34, y);
  let d = drapeA * (0.6 * Math.sin(7 * th + 1.3 + 9 * y) + 0.4 * Math.sin(11 * th + 0.4 - 6 * y));
  for (const pa of armpits) {
    const dy = pa.y - y;
    const dh = (th - pa.th) * 0.17;
    const r = Math.hypot(dh, dy);
    if (r > 0.25 || dy < -0.03) continue;
    const psi = Math.atan2(dh, Math.max(dy, 1e-4));
    d += (0.0034 + 0.002 * f) * Math.sin(9 * psi) * Math.exp(-r / 0.06) * smoothstep(0.006, 0.03, r) * smoothstep(-0.03, 0.01, dy);
  }
  d += 0.0009 * noise3(x * 18, y * 18, z * 18);
  return d;
}

// ---------- utilidades de malla ----------

function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l;
    n[k + 1] /= l;
    n[k + 2] /= l;
  }
  return n;
}

// Cara de adelante hacia afuera de la prenda: ¿hay que dar vuelta los
// triángulos? out(x, y, z) da la dirección "afuera"; `only` limita los
// vértices que cuentan.
function inverted(pos, idx, out, only = null) {
  const nrm = computeNormals(pos, idx);
  let s = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    if (only && !only(v)) continue;
    const o = out(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    s += nrm[v * 3] * o[0] + nrm[v * 3 + 1] * o[1] + nrm[v * 3 + 2] * o[2];
  }
  return s < 0;
}
function flip(idx) {
  for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  return idx;
}
function orient(pos, idx, out, only) {
  return inverted(pos, idx, out, only) ? flip(idx) : idx;
}
const fromVertical = (x, y, z) => [x, 0, z];

// Las normales de puntos que coinciden en distintas piezas (costuras) se
// promedian: la prenda se ve continua.
function weldNormals(parts) {
  const map = new Map();
  const key = (p, k) => `${Math.round(p[k] * 2e5)},${Math.round(p[k + 1] * 2e5)},${Math.round(p[k + 2] * 2e5)}`;
  for (const part of parts) {
    const used = new Uint8Array(part.pos.length / 3);
    for (const v of part.idx) used[v] = 1;
    for (let v = 0; v < used.length; v++) {
      if (!used[v]) continue;
      const k = key(part.pos, v * 3);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push([part, v]);
    }
  }
  for (const list of map.values()) {
    if (list.length < 2) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const [p, v] of list) {
      x += p.nrm[v * 3];
      y += p.nrm[v * 3 + 1];
      z += p.nrm[v * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const [p, v] of list) p.nrm.set([x / l, y / l, z / l], v * 3);
  }
}

// Grilla (columnas × filas) a partir de una función de posición.
function gridIndex(cols, rows, W) {
  const idx = [];
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const a = r * W + k;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  return idx;
}

// UV en metros: u acumulado a lo largo de las filas desde la columna c0, v
// acumulado a lo largo de las columnas desde la fila 0.
function gridUV(pos, W, H, c0 = 0) {
  const uv = new Float32Array(W * H * 2);
  const d = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (let r = 0; r < H; r++) {
    let u = 0;
    for (let k = c0 + 1; k < W; k++) {
      u += d(r * W + k, r * W + k - 1);
      uv[(r * W + k) * 2] = u;
    }
    u = 0;
    for (let k = c0 - 1; k >= 0; k--) {
      u -= d(r * W + k, r * W + k + 1);
      uv[(r * W + k) * 2] = u;
    }
  }
  for (let k = 0; k < W; k++) {
    let v = 0;
    for (let r = 1; r < H; r++) {
      v += d(r * W + k, (r - 1) * W + k);
      uv[(r * W + k) * 2 + 1] = v;
    }
  }
  return uv;
}

// ---------- armado ----------

export function buildShirt(params) {
  const M = measures(params);
  const torso = buildTorso(M);
  const { panels, i1, i2, N } = torso;
  const W = COLS + 1;

  // Pliegues del torso (desplazamiento a lo largo de la normal).
  // Axilas (el costado derecho es -π/2 en el frente y 3π/2 en la espalda).
  const pitY = panels.front.pos[(i1 * W + COLS) * 3 + 1];
  const armpits = [Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 2].map((th) => ({ y: pitY, th }));
  for (const key of ['front', 'back']) {
    const p = panels[key];
    const nrm = computeNormals(p.pos, p.idx);
    p.nrm = nrm;
  }
  weldNormals([panels.front, panels.back]);
  for (const key of ['front', 'back']) {
    const p = panels[key];
    for (let v = 0; v < p.pos.length / 3; v++) {
      const k = v * 3;
      const d = torsoFolds(M, p.pos[k], p.pos[k + 1], p.pos[k + 2], p.ang[v], armpits);
      p.pos[k] += p.nrm[k] * d;
      p.pos[k + 1] += p.nrm[k + 1] * d;
      p.pos[k + 2] += p.nrm[k + 2] * d;
    }
  }

  const parts = {};
  for (const key of ['front', 'back']) {
    const p = panels[key];
    parts[key] = { pos: p.pos, idx: p.idx, uv: gridUV(p.pos, W, N + 1, COLS / 2), seam: null };
  }

  // ---------- mangas ----------
  const S = M.sleeve;
  for (const side of [1, -1]) {
    const loop = armholeLoop(torso, side).map(([key, v]) => new THREE.Vector3().fromArray(panels[key].pos, v * 3));
    const L = loop.length;
    const top = loop[L / 2];
    const dir = new THREE.Vector3(side * Math.sin(S.angle), -Math.cos(S.angle), 0.07).normalize();
    // "Arriba" de la manga (hacia el hombro) y su frente.
    const up = new THREE.Vector3(side * Math.cos(S.angle), Math.sin(S.angle), 0);
    up.addScaledVector(dir, -up.dot(dir)).normalize();
    const fwd = new THREE.Vector3().crossVectors(dir, up).multiplyScalar(-side);
    if (fwd.z < 0) fwd.negate();
    const hemC = top.clone().addScaledVector(dir, S.len).addScaledVector(up, -S.rHem);
    // Parámetro de cada punto de la sisa por largo de arco (0 axila, 0.5
    // hombro).
    const cum = [0];
    for (let k = 1; k <= L; k++) cum.push(cum[k - 1] + loop[k % L].distanceTo(loop[k - 1]));
    const per = cum[L];
    const rows = SLEEVE_ROWS + CUFF_ROWS;
    const sCuff = 1 - S.cuff / S.len;
    const sRow = (r) => (r <= SLEEVE_ROWS ? (sCuff * r) / SLEEVE_ROWS : lerp(sCuff, 1, (r - SLEEVE_ROWS) / CUFF_ROWS));
    const SW = L + 1; // columna repetida al final (costura de abajo)
    const pos = new Float32Array(SW * (rows + 1) * 3);
    const P = new THREE.Vector3();
    const H = new THREE.Vector3();
    for (let k = 0; k <= L; k++) {
      const Lp = loop[k % L];
      const phi = (cum[k] / per) * Math.PI * 2;
      H.copy(hemC).addScaledVector(up, -Math.cos(phi) * S.rHem).addScaledVector(fwd, Math.sin(phi) * S.rHem);
      const span = Lp.distanceTo(H);
      for (let r = 0; r <= rows; r++) {
        const s = sRow(r);
        const s2 = s * s;
        const s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;
        P.copy(Lp).multiplyScalar(h00).addScaledVector(dir, h10 * span * 0.95).addScaledVector(H, h01).addScaledVector(dir, h11 * span * 0.9);
        P.toArray(pos, (r * SW + k) * 3);
      }
    }
    const fromAxis = (x, y, z) => {
      P.set(x, y, z).sub(hemC);
      P.addScaledVector(dir, -P.dot(dir));
      return [P.x, P.y, P.z];
    };
    const idx = gridIndex(L, rows, SW);
    const turned = inverted(pos, idx, fromAxis);
    if (turned) flip(idx);
    // Pliegues: algunos en la axila y un leve ondulado general; nada en la
    // costura de la sisa (queda pegada al torso).
    const nrm = computeNormals(pos, idx);
    for (let r = 0; r <= rows; r++) {
      // La columna repetida (costura de abajo) comparte normal.
      const a = r * SW * 3;
      const b = (r * SW + L) * 3;
      for (let c = 0; c < 3; c++) nrm[a + c] = nrm[b + c] = (nrm[a + c] + nrm[b + c]) / 2;
    }
    for (let r = 1; r <= rows; r++) {
      const s = sRow(r);
      for (let k = 0; k <= L; k++) {
        const f = cum[k] / per;
        const dphi = Math.min(f, 1 - f);
        const under = Math.exp(-((dphi / 0.13) ** 2)) * smoothstep(0, 0.18, s) * (1 - smoothstep(0.4, 0.62, s));
        const v = (r * SW + k) * 3;
        let d = (0.0026 + 0.002 * M.fit) * under * Math.sin(2 * Math.PI * (s * S.len / 0.045 + f * 4));
        d += 0.0007 * noise3(pos[v] * 20, pos[v + 1] * 20, pos[v + 2] * 20) * smoothstep(0, 0.1, s);
        pos[v] += nrm[v] * d;
        pos[v + 1] += nrm[v + 1] * d;
        pos[v + 2] += nrm[v + 2] * d;
      }
    }
    const uv = gridUV(pos, SW, rows + 1, 0);
    const key = side > 0 ? 'sleeveL' : 'sleeveR';
    const cuffKey = side > 0 ? 'cuffL' : 'cuffR';
    // Manga y puño: las mismas filas, separadas en el anillo del puño.
    const cut = SLEEVE_ROWS * SW;
    const sub = (n) => (turned ? flip(gridIndex(L, n, SW)) : gridIndex(L, n, SW));
    parts[key] = { pos: pos.slice(0, (cut + SW) * 3), idx: sub(SLEEVE_ROWS), uv: uv.slice(0, (cut + SW) * 2) };
    parts[cuffKey] = { pos: pos.slice(cut * 3), idx: sub(CUFF_ROWS), uv: uv.slice(cut * 2), axis: [hemC.clone(), dir.clone()] };
    parts[key].loopLen = per;
    parts[cuffKey].ring = Array.from({ length: SW }, (_, k) => ((CUFF_ROWS) * SW + k));
  }

  // ---------- cuello ----------
  const neck = [];
  for (let j = 0; j <= COLS; j++) neck.push(['front', N * W + j, (N - 3) * W + j]);
  for (let j = 1; j < COLS; j++) neck.push(['back', N * W + j, (N - 3) * W + j]);
  parts.collar = buildCollar(M, neck.map(([key, v, below]) => [panels[key].pos, v, below]));

  // ---------- dobladillos (espesor de la tela en ruedo y puños) ----------
  const hemRing = [];
  for (let j = 0; j <= COLS; j++) hemRing.push([panels.front.pos, j, W + j]);
  for (let j = 1; j < COLS; j++) hemRing.push([panels.back.pos, j, W + j]);
  parts.hem = buildLip(hemRing, 0.022, true);
  for (const k of ['cuffL', 'cuffR']) {
    const c = parts[k];
    const SW = c.ring.length;
    const ring = [];
    for (let i = 0; i < SW - 1; i++) ring.push([c.pos, c.ring[i], c.ring[i] - SW]);
    parts[k + 'Lip'] = buildLip(ring, 0.016, true);
  }

  // Normales, costuras soldadas y marcas de costura.
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals([parts.front, parts.back, parts.sleeveL, parts.sleeveR, parts.cuffL, parts.cuffR]);
  seamMarks(parts, N, W);

  const geos = {};
  for (const [key, part] of Object.entries(parts)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(part.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    g.setAttribute('seam', new THREE.BufferAttribute(part.seam || new Float32Array((part.pos.length / 3) * 2).fill(1), 2));
    g.setIndex(part.idx);
    g.computeBoundingBox();
    geos[key] = g;
  }
  return { geos, measures: M };
}

// Tira acanalada del cuello sobre el borde del escote (lazo cerrado).
function buildCollar(M, neck) {
  const n = neck.length;
  const base = neck.map(([pos, v]) => new THREE.Vector3().fromArray(pos, v * 3));
  const below = neck.map(([pos, , b]) => new THREE.Vector3().fromArray(pos, b * 3));
  // Contorno suavizado (redondo y parejo).
  const ring = base.map((p) => p.clone());
  for (let pass = 0; pass < 2; pass++) {
    const prev = ring.map((p) => p.clone());
    for (let i = 0; i < n; i++) ring[i].copy(prev[(i - 1 + n) % n]).add(prev[(i + 1) % n]).multiplyScalar(0.25).addScaledVector(prev[i], 0.5);
  }
  const h = 0.021;
  const th = 0.0034;
  // Perfil (subida, hacia afuera): cara de afuera, borde enrollado, cara de
  // adentro que baja un poco dentro de la camiseta.
  const prof = [[0, 0], [h * 0.5, -0.0006], [h - th / 2, -0.0012]];
  for (let a = 1; a < 6; a++) {
    const ang = (a / 6) * Math.PI;
    prof.push([h - th / 2 + Math.sin(ang) * (th / 2), -0.0012 - th / 2 + Math.cos(ang) * (th / 2)]);
  }
  prof.push([h - th / 2, -0.0012 - th], [h * 0.4, -0.0008 - th], [-0.009, -0.0004 - th]);
  const P = prof.length;
  const SW = n + 1;
  const pos = new Float32Array(SW * P * 3);
  const uv = new Float32Array(SW * P * 2);
  const center = new THREE.Vector3();
  for (const p of ring) center.add(p);
  center.divideScalar(n);
  const up = new THREE.Vector3();
  const out = new THREE.Vector3();
  const q = new THREE.Vector3();
  let u = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) u += ring[k].distanceTo(ring[i - 1]);
    // Arriba: siguiendo la tela hacia el cuello, inclinado un poco hacia
    // adentro para abrazar el cuello.
    up.subVectors(base[k], below[k]).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.85).normalize();
    out.set(ring[k].x - center.x, 0, ring[k].z - center.z).normalize();
    up.addScaledVector(out, -0.16).normalize();
    // Afuera: perpendicular a "arriba" dentro del plano vertical radial.
    out.addScaledVector(up, -out.dot(up)).normalize();
    let v = 0;
    for (let j = 0; j < P; j++) {
      if (j > 0) v += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
      const start = j === 0 ? base[k] : ring[k];
      q.copy(start).addScaledVector(up, prof[j][0]).addScaledVector(out, prof[j][1]);
      q.toArray(pos, (j * SW + i) * 3);
      uv[(j * SW + i) * 2] = u;
      uv[(j * SW + i) * 2 + 1] = v;
    }
  }
  const idx = gridIndex(n, P - 1, SW);
  return { pos, uv, idx: orient(pos, idx, fromVertical, (v) => v < SW * 3) };
}

// Dobladillo: desde el borde, la tela se da vuelta hacia adentro y sube.
// ring: [posiciones, índice del borde, índice de la fila de arriba].
function buildLip(ring, height, closed) {
  const n = ring.length;
  const prof = [[0, 0], [-0.0008, -0.0009], [-0.0003, -0.0021], [0.002, -0.0024], [height, -0.0024]];
  const P = prof.length;
  const SW = n + (closed ? 1 : 0);
  const pos = new Float32Array(SW * P * 3);
  const uv = new Float32Array(SW * P * 2);
  const center = new THREE.Vector3();
  for (const [p, v] of ring) center.add(new THREE.Vector3().fromArray(p, v * 3));
  center.divideScalar(n);
  const e = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const up = new THREE.Vector3();
  const out = new THREE.Vector3();
  const q = new THREE.Vector3();
  let u = 0;
  for (let i = 0; i < SW; i++) {
    const [p, v, w] = ring[i % n];
    e.fromArray(p, v * 3);
    up.fromArray(p, w * 3).sub(e).normalize();
    // Hacia afuera de la prenda: lejos del centro del borde.
    out.subVectors(e, center);
    out.addScaledVector(up, -out.dot(up)).normalize();
    if (i > 0) u += e.distanceTo(prev);
    prev.copy(e);
    for (let j = 0; j < P; j++) {
      q.copy(e).addScaledVector(up, prof[j][0]).addScaledVector(out, prof[j][1]);
      q.toArray(pos, (j * SW + i) * 3);
      uv[(j * SW + i) * 2] = u;
      uv[(j * SW + i) * 2 + 1] = j * 0.004;
    }
  }
  const idx = gridIndex(n - (closed ? 0 : 1), P - 1, SW);
  return { pos, uv, idx: orient(pos, idx, (x, y, z) => [x - center.x, y - center.y, z - center.z]) };
}

// Marcas de costura por vértice: x = distancia a la costura más cercana
// (hundido de la costura), y = distancia al borde con pespunte (ruedos).
function seamMarks(parts, N, W) {
  const set = (part, f) => {
    const n = part.pos.length / 3;
    part.seam = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      const [a, b] = f(v);
      part.seam[v * 2] = a;
      part.seam[v * 2 + 1] = b;
    }
  };
  // Torso: costados y hombros (bordes de la grilla), sisas, escote; pespunte
  // del ruedo.
  const loops = [];
  for (const k of ['sleeveL', 'sleeveR']) {
    const s = parts[k];
    const SW = s.uv.length / 2 / (SLEEVE_ROWS + 1);
    const pts = [];
    for (let i = 0; i < SW; i++) pts.push([s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]]);
    loops.push(pts);
  }
  for (const key of ['front', 'back']) {
    const p = parts[key];
    const uvs = p.uv;
    set(p, (v) => {
      const j = v % W;
      const i = Math.floor(v / W);
      const r0 = i * W;
      const uL = uvs[r0 * 2];
      const uR = uvs[(r0 + COLS) * 2];
      const u = uvs[v * 2];
      let d = Math.min(u - uL, uR - u);
      const vTop = uvs[(N * W + j) * 2 + 1];
      d = Math.min(d, vTop - uvs[v * 2 + 1]);
      const x = p.pos[v * 3];
      const y = p.pos[v * 3 + 1];
      const z = p.pos[v * 3 + 2];
      if (Math.abs(x) > 0.1 && y > -0.33) {
        for (const loop of loops)
          for (const q of loop) {
            const dd = Math.hypot(x - q[0], y - q[1], z - q[2]);
            if (dd < d) d = dd;
          }
      }
      return [d, uvs[v * 2 + 1]];
    });
  }
  for (const key of ['sleeveL', 'sleeveR']) {
    const p = parts[key];
    const SW = p.uv.length / 2 / (SLEEVE_ROWS + 1);
    set(p, (v) => {
      const k = v % SW;
      const r = Math.floor(v / SW);
      const per = p.uv[(r * SW + SW - 1) * 2];
      const u = p.uv[v * 2];
      const vEnd = p.uv[(SLEEVE_ROWS * SW + k) * 2 + 1];
      return [Math.min(p.uv[v * 2 + 1], u, per - u, vEnd - p.uv[v * 2 + 1]), 1];
    });
  }
  for (const key of ['cuffL', 'cuffR']) {
    const p = parts[key];
    const SW = p.ring.length;
    set(p, (v) => {
      const k = v % SW;
      const vEnd = p.uv[(CUFF_ROWS * SW + k) * 2 + 1];
      return [p.uv[v * 2 + 1] - p.uv[k * 2 + 1], vEnd - p.uv[v * 2 + 1]];
    });
  }
  set(parts.collar, () => [1, 1]);
}
