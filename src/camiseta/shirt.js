// Camiseta deportiva de cuello redondo o en V, modelada con código (sin moldes ni
// simulación). La forma es la de una prenda puesta sobre un cuerpo invisible:
//
// - Torso: anillos horizontales (cortes superelípticos) desde el ruedo hasta
//   el escote. Cerca del escote cada columna se curva hacia el contorno del
//   cuello; a los costados esa curva es la línea del hombro.
// - Sisas: un hueco en la grilla del torso a cada lado, deformado hasta
//   quedar ovalado. Las mangas arrancan exactamente de su borde.
// - Mangas: de la sisa a un ruedo circular alrededor del eje del brazo, con
//   puño aparte.
// - Cuello: tira acanalada sobre el borde del escote (en V, las dos puntas
//   de la tira se juntan en una costura al medio). Ruedo y puños llevan un
//   dobladillo hacia adentro (se ve el espesor de la tela).
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
  neckStyle: 'round', // 'round' redondo · 'v' en V
  garment: 'tee', // 'tee' manga corta · 'long' manga larga
};

// Resolución de las mallas.
const COLS = 64; // columnas de cada mitad del torso (de costado a costado)
const ARM_COLS = 10; // columnas de la sisa a cada lado de la costura
const ROWS_LOW = 64; // del ruedo a la axila
const ROWS_ARM = 24; // de la axila a la punta del hombro
const ROWS_TOP = 8; // del hombro al cuello
const SLEEVE_ROWS = 30; // filas de la manga (como mínimo: la larga lleva más)
const SLEEVE_ROW = 0.008; // largo de cada fila de la manga larga
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
    // Contorno del cuello en el hombro: medio ancho, fondo hacia adelante y
    // hacia atrás desde los hombros (atrás es casi plano, como un escote real:
    // colgada, si no, la espalda del cuello cuelga en U detrás de la percha),
    // y centro.
    neck: { a: 0.088, b: 0.08, bB: 0.035, c: -0.014 },
    dropF: p.neckDepth,
    dropB: 0.014,
    vNeck: p.neckStyle === 'v',
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
  // La espalda, de la axila al cuello, sube con una pendiente pareja hasta el
  // escote (casi plano atrás): si siguiera redonda como el frente, justo
  // abajo del cuello haría un escalón casi horizontal y lo que se estampa ahí
  // miraría hacia arriba.
  const pit = rows[3];
  const zPit = pit[3] - pit[2];
  const zNeck = M.neck.c - M.neck.bB;
  M.sbB = monotone(
    ys,
    rows.map((r) => (r[0] <= pit[0] ? r[2] : r[3] - lerp(zPit, zNeck, (r[0] - pit[0]) / -pit[0]))),
  );
  M.sc = monotone(ys, rows.map((r) => r[3]));
  M.shA = shA;
  // Manga larga: hasta la muñeca, angosta abajo y con un puño acanalado alto.
  const long = p.garment === 'long';
  M.garment = long ? 'long' : 'tee';
  M.sleeve = {
    len: p.sleeveLength,
    angle: THREE.MathUtils.degToRad(p.sleeveAngle),
    rHem: long ? 0.041 + 0.008 * f : 0.058 + 0.016 * f,
    cuff: long ? 0.06 : 0.026,
    long,
  };
  M.sleeveRows = Math.max(SLEEVE_ROWS, 2 * Math.round(p.sleeveLength / SLEEVE_ROW / 2));
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

// Altura del escote: baja al frente y apenas atrás. Con el exponente la curva
// llega plana al punto del hombro (sin pico donde se juntan frente y espalda).
// En V, adelante la recta (vista de frente) desde cada punto del hombro hasta
// la punta se mezcla con la curva del cuello redondo: las patas se abomban un
// poco hacia afuera y la punta queda neta. Junto al hombro se redondea el
// último pedacito para no hacer pico donde sigue la espalda.
const VEE_EASE = 0.08; // fracción del ancho que se redondea junto al hombro
const VEE_ROUND = 0.4; // cuánto de la curva redonda llevan las patas (0 = rectas)
const neckY = (M, th) => {
  const c = Math.cos(th);
  if (c >= 0 && M.vNeck) {
    const u = 1 - Math.abs(Math.sin(th)); // 0 en el hombro, 1 al medio
    const e = VEE_EASE;
    const g = ((u < e ? (u * u) / (2 * e) : u - e / 2) / (1 - e / 2)) * (1 - VEE_ROUND) + c ** 1.6 * VEE_ROUND;
    return -M.dropF * g;
  }
  return -(c >= 0 ? M.dropF : M.dropB) * Math.abs(c) ** 1.6;
};

// Frente del torso (sin la curva hacia el cuello) en el punto de ancho x y
// altura y: el corte superelíptico a esa altura.
function chestZ(M, x, y) {
  const a = M.sa(y);
  const r = Math.min(1, Math.abs(x) / a) ** M.n;
  return M.sc(y) + M.sb(y) * (1 - r) ** (1 / M.n);
}

// Punto del torso para el ángulo th (0 frente, π/2 costado izquierdo, π
// espalda) y t (0 ruedo, 1 escote).
function torsoPoint(M, th, t, out) {
  const yn = neckY(M, th);
  const y = lerp(-M.L, yn, t);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const e = 2 / M.n;
  let x = M.sa(y) * spow(sn, e);
  let z = M.sc(y) + (cs >= 0 ? M.sb(y) : M.sbB(y)) * spow(cs, e);
  let yy = y;
  // Cerca del escote la columna se curva hacia el contorno del cuello. A los
  // costados eso recorre la línea del hombro; al frente, la subida del pecho.
  const del = lerp(-M.shY, cs >= 0 ? 0.075 : 0.05, cs * cs);
  // Arranque suave y final con pendiente: las últimas filas no se apiñan.
  const w = 1 - Math.cos((Math.PI / 2) * clamp01((y - (yn - del)) / del));
  if (w > 0) {
    x = lerp(x, M.neck.a * sn, w);
    yy = lerp(y, yn, w);
    z = lerp(z, M.neck.c + (cs >= 0 ? M.neck.b : M.neck.bB) * cs, w);
    // En V el escote baja por el pecho: ahí la tela sigue el pecho y no se
    // hunde hacia el cuello (el contorno del cuello queda más atrás).
    if (M.vNeck && cs > 0) z = Math.max(z, chestZ(M, x, yy));
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
// baja por la espalda. Devuelve [pieza, fila, columna] de cada punto de una
// grilla de `cols` columnas con la sisa entre las filas i1 e i2.
export function armholeLoopIJ(cols, A, i1, i2, side) {
  const F = (i, j) => ['front', i, j];
  const B = (i, j) => ['back', i, j];
  const out = [];
  if (side > 0) {
    out.push(F(i1, cols));
    for (let j = cols - 1; j >= cols - A; j--) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, cols - A));
    for (let j = cols - A + 1; j <= cols; j++) out.push(F(i2, j));
    for (let j = 1; j <= A; j++) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, A));
    for (let j = A - 1; j >= 1; j--) out.push(B(i1, j));
  } else {
    out.push(F(i1, 0));
    for (let j = 1; j <= A; j++) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, A));
    for (let j = A - 1; j >= 0; j--) out.push(F(i2, j));
    for (let j = cols - 1; j >= cols - A; j--) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, cols - A));
    for (let j = cols - A + 1; j <= cols - 1; j++) out.push(B(i1, j));
  }
  return out;
}
function armholeLoop(torso, side) {
  const W = COLS + 1;
  return armholeLoopIJ(COLS, ARM_COLS, torso.i1, torso.i2, side).map(([key, i, j]) => [key, i * W + j]);
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
    const SR = M.sleeveRows;
    const rows = SR + CUFF_ROWS;
    // Costura del puño: un anillo paralelo al ruedo, así el puño es una
    // banda recta del mismo ancho todo alrededor.
    const cuffC = hemC.clone().addScaledVector(dir, -S.cuff);
    const sRow = (r) => Math.min(1, r / SR);
    const SW = L + 1; // columna repetida al final (costura de abajo)
    const pos = new Float32Array(SW * (rows + 1) * 3);
    const P = new THREE.Vector3();
    const H = new THREE.Vector3();
    const C = new THREE.Vector3();
    for (let k = 0; k <= L; k++) {
      const Lp = loop[k % L];
      const phi = (cum[k] / per) * Math.PI * 2;
      const ou = -Math.cos(phi) * S.rHem;
      const of = Math.sin(phi) * S.rHem;
      H.copy(hemC).addScaledVector(up, ou).addScaledVector(fwd, of);
      C.copy(cuffC).addScaledVector(up, ou).addScaledVector(fwd, of);
      const span = Lp.distanceTo(C);
      for (let r = SR + 1; r <= rows; r++) {
        P.lerpVectors(C, H, (r - SR) / CUFF_ROWS);
        P.toArray(pos, (r * SW + k) * 3);
      }
      for (let r = 0; r <= SR; r++) {
        const s = r / SR;
        const s2 = s * s;
        const s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;
        P.copy(Lp).multiplyScalar(h00).addScaledVector(dir, h10 * span * 0.95).addScaledVector(C, h01).addScaledVector(dir, h11 * span * 0.9);
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
    for (let r = 1; r < SR; r++) {
      const s = sRow(r);
      for (let k = 0; k <= L; k++) {
        const f = cum[k] / per;
        const dphi = Math.min(f, 1 - f);
        const under = Math.exp(-((dphi / 0.13) ** 2)) * smoothstep(0, 0.18, s) * (1 - smoothstep(0.4, 0.62, s));
        const v = (r * SW + k) * 3;
        let d = (0.0026 + 0.002 * M.fit) * under * Math.sin(2 * Math.PI * (s * S.len / 0.045 + f * 4));
        d += 0.0007 * noise3(pos[v] * 20, pos[v + 1] * 20, pos[v + 2] * 20) * smoothstep(0, 0.1, s) * (1 - smoothstep(0.8, 1, s));
        // Manga larga: la tela se junta en ondas sobre el puño.
        if (S.long) d += 0.0034 * smoothstep(0.7, 0.96, s) * Math.sin(2 * Math.PI * ((s * S.len) / 0.05) + 1.8 * Math.sin(2 * Math.PI * f));
        pos[v] += nrm[v] * d;
        pos[v + 1] += nrm[v + 1] * d;
        pos[v + 2] += nrm[v + 2] * d;
      }
    }
    const uv = gridUV(pos, SW, rows + 1, 0);
    const key = side > 0 ? 'sleeveL' : 'sleeveR';
    const cuffKey = side > 0 ? 'cuffL' : 'cuffR';
    // Manga y puño: las mismas filas, separadas en el anillo del puño.
    const cut = SR * SW;
    const sub = (n) => (turned ? flip(gridIndex(L, n, SW)) : gridIndex(L, n, SW));
    parts[key] = { pos: pos.slice(0, (cut + SW) * 3), idx: sub(SR), uv: uv.slice(0, (cut + SW) * 2), rows: SR };
    parts[cuffKey] = { pos: pos.slice(cut * 3), idx: sub(CUFF_ROWS), uv: uv.slice(cut * 2), axis: [hemC.clone(), dir.clone()] };
    parts[key].loopLen = per;
    parts[cuffKey].ring = Array.from({ length: SW }, (_, k) => ((CUFF_ROWS) * SW + k));
  }

  // ---------- cuello ----------
  const neck = [];
  for (let j = 0; j <= COLS; j++) neck.push(['front', N * W + j, (N - 3) * W + j]);
  for (let j = 1; j < COLS; j++) neck.push(['back', N * W + j, (N - 3) * W + j]);
  parts.collar = buildCollar(M, neck.map(([key, v, below]) => [panels[key].pos, v, below]), COLS / 2);

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

  printUV(parts, N, W);

  // Normales, costuras soldadas y marcas de costura.
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals([parts.front, parts.back, parts.sleeveL, parts.sleeveR, parts.cuffL, parts.cuffR]);
  seamMarks(parts, N, W);
  zoneMarks(parts, M, W);

  const geos = {};
  for (const [key, part] of Object.entries(parts)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(part.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    if (part.uv1) g.setAttribute('uv1', new THREE.BufferAttribute(part.uv1, 2));
    g.setAttribute('seam', new THREE.BufferAttribute(part.seam || new Float32Array((part.pos.length / 3) * 2).fill(1), 2));
    g.setAttribute('zone', new THREE.BufferAttribute(part.zone || new Float32Array(part.pos.length / 3), 1));
    g.setIndex(part.idx);
    g.computeBoundingBox();
    geos[key] = g;
  }
  // Estructura de las mallas (para la versión colgada, que simula la tela).
  const sleeveSW = parts.cuffL.ring.length;
  const layout = {
    cols: COLS,
    armCols: ARM_COLS,
    rows: N,
    i1,
    i2,
    sleeveRows: M.sleeveRows,
    cuffRows: CUFF_ROWS,
    sleeveSW,
    rings: {
      collar: neck,
      hem: [...Array.from({ length: COLS + 1 }, (_, j) => ['front', j, W + j]), ...Array.from({ length: COLS - 1 }, (_, j) => ['back', j + 1, W + j + 1])],
      cuffLLip: Array.from({ length: sleeveSW - 1 }, (_, i) => ['cuffL', CUFF_ROWS * sleeveSW + i, (CUFF_ROWS - 1) * sleeveSW + i]),
      cuffRLip: Array.from({ length: sleeveSW - 1 }, (_, i) => ['cuffR', CUFF_ROWS * sleeveSW + i, (CUFF_ROWS - 1) * sleeveSW + i]),
    },
  };
  return { geos, measures: M, layout, printBase: { front: parts.front.printBase, back: parts.back.printBase } };
}

// ---------- coordenadas de estampado ----------

// Cada pieza desplegada en metros sobre la tela (las UV de la tela), como se
// ve desde afuera: x hacia la derecha, y hacia abajo, con el origen en un
// punto fijo de la pieza (así un diseño no se mueve al cambiar el largo o el
// calce): frente y espalda, el centro del escote; mangas, la punta del
// hombro, con el ruedo derecho (como un molde); puños, el centro de arriba;
// cuello, el centro de atrás en la costura (arriba la cara de afuera y, más
// arriba, la de adentro).
function printUV(parts, N, W) {
  const C = COLS / 2;
  // Signo de x: que crezca hacia la derecha de quien mira de afuera.
  const facing = (pos, uv, ids, right) => {
    let s = 0;
    for (const [a, b] of ids) s += (uv[b * 2] - uv[a * 2]) * ((pos[b * 3] - pos[a * 3]) * right[0] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * right[2]);
    return s >= 0 ? 1 : -1;
  };
  // Frente y espalda: de entrada, el ancho a lo largo de cada fila y la
  // altura. El molde de verdad (la tela aplanada) lo calcula flattenPrint,
  // sólo cuando hace falta (tarda).
  for (const [key, right] of [['front', [1, 0, 0]], ['back', [-1, 0, 0]]]) {
    const { pos, uv } = parts[key];
    const r = Math.round(N / 3);
    const sx = facing(pos, uv, [[r * W, r * W + COLS]], right);
    const uv1 = new Float32Array(W * (N + 1) * 2);
    for (let v = 0; v < W * (N + 1); v++) {
      uv1[v * 2] = sx * uv[v * 2];
      uv1[v * 2 + 1] = -pos[v * 3 + 1];
    }
    const A = (N * W + C) * 2;
    parts[key].uv1 = uv1.map((x, i) => x - uv1[A + (i % 2)]);
    parts[key].printBase = Float32Array.from(parts[key].uv1);
  }
  for (const [key, cuffKey, side] of [['sleeveL', 'cuffL', 1], ['sleeveR', 'cuffR', -1]]) {
    const sl = parts[key];
    const cf = parts[cuffKey];
    const SW = cf.ring.length;
    const L = SW - 1;
    const cap = L / 2;
    const right = [0, 0, -side];
    const sx = facing(sl.pos, sl.uv, [[cap - 4, cap + 4]], right);
    const R = sl.rows;
    const vEnd = (k) => sl.uv[(R * SW + k) * 2 + 1];
    sl.uv1 = new Float32Array(sl.uv.length);
    for (let r = 0; r <= R; r++)
      for (let k = 0; k < SW; k++) {
        const i = (r * SW + k) * 2;
        sl.uv1[i] = sx * (sl.uv[i] - sl.uv[(r * SW + cap) * 2]);
        sl.uv1[i + 1] = sl.uv[i + 1] + vEnd(cap) - vEnd(k);
      }
    cf.uv1 = new Float32Array(cf.uv.length);
    for (let r = 0; r <= CUFF_ROWS; r++)
      for (let k = 0; k < SW; k++) {
        const i = (r * SW + k) * 2;
        cf.uv1[i] = sx * (cf.uv[i] - cf.uv[(r * SW + cap) * 2]);
        cf.uv1[i + 1] = cf.uv[i + 1] - cf.uv[k * 2 + 1];
      }
  }
  // Cuello: abajo la cara de afuera (vista desde afuera, hasta la mitad del
  // doblez) y, más arriba, la de adentro como se la ve desde adentro
  // (derecha, sin espejar), separadas.
  const col = parts.collar;
  const bc = COLS + C;
  const sx = facing(col.pos, col.uv, [[bc - 2, bc + 2]], [-1, 0, 0]);
  const uA = col.uv[bc * 2];
  const SW = col.uv.length / 2 / col.P;
  const v = (j) => col.uv[j * SW * 2 + 1];
  const top = -(v(COLLAR_FOLD) + COLLAR_GAP + v(col.P - 1) - v(COLLAR_FOLD + 1));
  col.uv1 = new Float32Array(col.uv.length);
  for (let j = 0; j < col.P; j++)
    for (let i = 0; i < SW; i++) {
      const k = (j * SW + i) * 2;
      const out = j <= COLLAR_FOLD;
      col.uv1[k] = (out ? sx : -sx) * (col.uv[k] - uA);
      col.uv1[k + 1] = out ? -col.uv[k + 1] : top + col.uv[k + 1] - v(COLLAR_FOLD + 1);
    }
}
// Molde de frente y espalda para el estampado: la tela aplanada (ver
// flattenPanel), con el origen en el centro del escote. `prev` es una
// camiseta anterior ya aplanada (la grilla es la misma para cualquier
// medida): se parte de su molde y alcanza con menos vueltas.
const FLAT_LEVELS = [
  [4, 1500],
  [2, 250],
  [1, 50],
];
const FLAT_WARM = [
  [2, 120],
  [1, 40],
];
export function flattenPrint(built, prev = null) {
  if (built.flatPrint) return;
  const L = built.layout;
  const W = L.cols + 1;
  const H = L.rows + 1;
  const A = (L.rows * W + L.cols / 2) * 2;
  const warm = prev && prev.flatPrint && prev.measures.vNeck === built.measures.vNeck;
  for (const key of ['front', 'back']) {
    const g = built.geos[key];
    // Arranque: la forma de entrada de esta camiseta y, si hay una anterior
    // aplanada, lo que el aplanado le corrigió a aquella.
    const base = built.printBase[key];
    const X0 = Float64Array.from(base);
    if (warm) {
      const pf = prev.geos[key].attributes.uv1.array;
      const pb = prev.printBase[key];
      for (let i = 0; i < X0.length; i++) X0[i] += pf[i] - pb[i];
    }
    const X = flattenPanel(g.attributes.position.array, g.index.array, W, H, X0, warm ? FLAT_WARM : FLAT_LEVELS);
    const uv1 = g.attributes.uv1.array;
    for (let i = 0; i < uv1.length; i++) uv1[i] = X[i] - X[A + (i % 2)];
    g.attributes.uv1.needsUpdate = true;
  }
  built.flatPrint = true;
}

// Molde de una pieza del torso (grilla W×H, simétrica respecto de la columna
// del medio): la tela aplanada, con cada arista de su largo en la tela, como
// al sacar un molde. Resortes en las aristas y diagonales de cada celda,
// resueltos primero en grillas más gruesas (cada `s` puntos) y llevados a la
// fina. `ease(p, q)`, si está, multiplica el largo de la arista p–q.
const AREA_MIN = 0.3;
const EASE_PASSES = 4;
export function flattenPanel(pos, idx, W, H, X0, levels, ease = null) {
  const C = (W - 1) / 2;
  // Celdas con tela (las de la sisa no tienen).
  const cell = new Uint8Array(W * H);
  for (let t = 0; t < idx.length; t += 3) {
    const r = Math.min(Math.floor(idx[t] / W), Math.floor(idx[t + 1] / W), Math.floor(idx[t + 2] / W));
    const j = Math.min(idx[t] % W, idx[t + 1] % W, idx[t + 2] % W);
    cell[r * W + j] = 1;
  }
  const d3 = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const X = Float64Array.from(X0);
  let prev = null;
  for (const [s, iters] of levels) {
    const ok = (r, j) => {
      for (let a = r; a < r + s; a++) for (let b = j; b < j + s; b++) if (!cell[a * W + b]) return false;
      return true;
    };
    const list = [];
    const tris = [];
    const used = new Uint8Array(W * H);
    for (let r = 0; r + s < H; r += s)
      for (let j = 0; j + s < W; j += s) {
        if (!ok(r, j)) continue;
        const a = r * W + j;
        const b = a + s;
        const c = a + s * W;
        const d = c + s;
        for (const [p, q] of [
          [a, b],
          [a, c],
          [b, d],
          [c, d],
          [a, d],
          [b, c],
        ]) {
          // Las aristas con otro largo son más firmes: se resuelven
          // EASE_PASSES veces por vuelta.
          const k = ease ? ease(p, q) : 1;
          for (let n = k === 1 ? 1 : EASE_PASSES; n > 0; n--) list.push(p, q, d3(p, q) * k);
        }
        tris.push(a, b, d, a, d, c);
        used[a] = used[b] = used[c] = used[d] = 1;
      }
    const ne = list.length / 3;
    const ea = new Int32Array(ne);
    const eb = new Int32Array(ne);
    const el = new Float64Array(ne);
    for (let e = 0; e < ne; e++) {
      ea[e] = list[e * 3] * 2;
      eb[e] = list[e * 3 + 1] * 2;
      el[e] = list[e * 3 + 2];
    }
    // Arranque: lo que se movió en la grilla anterior, llevado a esta.
    if (prev) {
      const [ps, D] = prev;
      for (let r = 0; r < H; r += s)
        for (let j = 0; j < W; j += s) {
          const v = r * W + j;
          if (!used[v] || (r % ps === 0 && j % ps === 0)) continue;
          const r0 = Math.floor(r / ps) * ps;
          const j0 = Math.floor(j / ps) * ps;
          let wx = 0;
          let dx = 0;
          let dy = 0;
          for (const [rr, jj] of [
            [r0, j0],
            [r0 + ps, j0],
            [r0, j0 + ps],
            [r0 + ps, j0 + ps],
          ]) {
            if (rr >= H || jj >= W || !D.has(rr * W + jj)) continue;
            const w = (1 - Math.abs(r - rr) / ps) * (1 - Math.abs(j - jj) / ps) + 1e-6;
            const [ddx, ddy] = D.get(rr * W + jj);
            dx += ddx * w;
            dy += ddy * w;
            wx += w;
          }
          if (wx > 0) {
            X[v * 2] = X0[v * 2] + dx / wx;
            X[v * 2 + 1] = X0[v * 2 + 1] + dy / wx;
          }
        }
    }
    // Ningún triángulo se da vuelta ni se aplasta (donde la tela puesta
    // tiene mucha curva, como el hombro de la espalda junto a la sisa, los
    // resortes solos la doblarían sobre sí misma): cada uno conserva al
    // menos AREA_MIN de su área, con el sentido de la mayoría.
    const nt = tris.length / 3;
    const ta = new Int32Array(tris.length);
    const tArea = new Float64Array(nt);
    let orient = 0;
    for (let t = 0; t < nt; t++) {
      const [a, b, c] = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      ta[t * 3] = a * 2;
      ta[t * 3 + 1] = b * 2;
      ta[t * 3 + 2] = c * 2;
      const u = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
      const v = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
      tArea[t] = 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      orient += (X[b * 2] - X[a * 2]) * (X[c * 2 + 1] - X[a * 2 + 1]) - (X[c * 2] - X[a * 2]) * (X[b * 2 + 1] - X[a * 2 + 1]);
    }
    const sg = orient >= 0 ? 0.5 : -0.5;
    for (let it = 0; it < iters; it++) {
      for (let t = 0; t < nt; t++) {
        const a = ta[t * 3];
        const b = ta[t * 3 + 1];
        const c = ta[t * 3 + 2];
        const area = sg * ((X[b] - X[a]) * (X[c + 1] - X[a + 1]) - (X[c] - X[a]) * (X[b + 1] - X[a + 1]));
        const goal = AREA_MIN * tArea[t];
        if (area >= goal) continue;
        // Gradiente del área respecto de cada vértice (perpendicular al lado opuesto).
        const gax = sg * (X[b + 1] - X[c + 1]);
        const gay = sg * (X[c] - X[b]);
        const gbx = sg * (X[c + 1] - X[a + 1]);
        const gby = sg * (X[a] - X[c]);
        const gcx = sg * (X[a + 1] - X[b + 1]);
        const gcy = sg * (X[b] - X[a]);
        const l = (goal - area) / (gax * gax + gay * gay + gbx * gbx + gby * gby + gcx * gcx + gcy * gcy + 1e-18);
        X[a] += l * gax;
        X[a + 1] += l * gay;
        X[b] += l * gbx;
        X[b + 1] += l * gby;
        X[c] += l * gcx;
        X[c + 1] += l * gcy;
      }
      for (let e = 0; e < ne; e++) {
        const a = ea[e];
        const b = eb[e];
        const dx = X[b] - X[a];
        const dy = X[b + 1] - X[a + 1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        const f = ((len - el[e]) / len) * 0.5;
        X[a] += dx * f;
        X[a + 1] += dy * f;
        X[b] -= dx * f;
        X[b + 1] -= dy * f;
      }
      // Simétrica: cada columna con su espejo, la del medio en x = 0.
      for (let r = 0; r < H; r += s) {
        for (let j = 0; j < C; j += s) {
          const a = (r * W + j) * 2;
          const m = (r * W + W - 1 - j) * 2;
          const x = (X[a] - X[m]) / 2;
          const y = (X[a + 1] + X[m + 1]) / 2;
          X[a] = x;
          X[m] = -x;
          X[a + 1] = X[m + 1] = y;
        }
        X[(r * W + C) * 2] = 0;
      }
    }
    const D = new Map();
    for (let v = 0; v < W * H; v++) if (used[v]) D.set(v, [X[v * 2] - X0[v * 2], X[v * 2 + 1] - X0[v * 2 + 1]]);
    prev = [s, D];
  }
  return X;
}

// Fila del perfil de la tira en la mitad del doblez, y separación (m) entre
// las dos caras en la plantilla.
export const COLLAR_FOLD = 5;
const COLLAR_GAP = 0.006;

// Tira acanalada del cuello sobre el borde del escote (lazo cerrado). En V,
// la punta del escote es el punto `tip` del lazo.
function buildCollar(M, neck, tip) {
  const n = neck.length;
  const base = neck.map(([pos, v]) => new THREE.Vector3().fromArray(pos, v * 3));
  const below = neck.map(([pos, , b]) => new THREE.Vector3().fromArray(pos, b * 3));
  // Contorno suavizado (redondo y parejo; en V, el frente queda tal cual para
  // que las patas sean rectas y la punta neta).
  const front = (k) => M.vNeck && k <= 2 * tip;
  const ring = base.map((p) => p.clone());
  for (let pass = 0; pass < 2; pass++) {
    const prev = ring.map((p) => p.clone());
    for (let i = 0; i < n; i++) if (!front(i)) ring[i].copy(prev[(i - 1 + n) % n]).add(prev[(i + 1) % n]).multiplyScalar(0.25).addScaledVector(prev[i], 0.5);
  }
  // Alto de la tira (en V, apenas más angosta).
  const h = M.vNeck ? 0.019 : 0.021;
  const th = 0.0034;
  const center = new THREE.Vector3();
  for (const p of ring) center.add(p);
  center.divideScalar(n);
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
  // Arriba: siguiendo la tela hacia el cuello, casi vertical e inclinado un
  // poco hacia adentro para abrazar el cuello; suavizado alrededor para que
  // el borde de arriba sea parejo.
  const vertical = new THREE.Vector3(0, 1, 0);
  let ups = base.map((b, k) => {
    const o = new THREE.Vector3(ring[k].x - center.x, 0, ring[k].z - center.z).normalize();
    return new THREE.Vector3().subVectors(b, below[k]).normalize().lerp(vertical, 0.45).normalize().addScaledVector(o, -0.16).normalize();
  });
  for (let pass = 0; pass < 6; pass++) ups = ups.map((_, k) => ups[(k - 1 + n) % n].clone().add(ups[(k + 1) % n]).addScaledVector(ups[k], 2).normalize());
  // La tira sube sin inclinarse a lo largo del contorno (si no, en el centro
  // de la espalda las columnas se juntan arriba y queda una muesca).
  const along = (u, k) => {
    const t = new THREE.Vector3().subVectors(ring[(k + 1) % n], ring[(k - 1 + n) % n]).normalize();
    return u.addScaledVector(t, -u.dot(t)).normalize();
  };
  ups = ups.map((u, k) => along(u.clone(), k));
  // El borde de arriba no puede subir en punta donde el escote es más alto
  // (junto al hombro): se empareja su altura alrededor del cuello y, donde
  // baja, la tira se inclina hacia adentro (abraza el cuello) sin acortarse.
  let ty = ring.map((r, k) => r.y + ups[k].y * h);
  const minRise = 0.3 * h;
  for (let pass = 0; pass < 80; pass++) ty = ty.map((y, k) => Math.max((ty[(k - 1 + n) % n] + ty[(k + 1) % n] + 2 * y) / 4, ring[k].y + minRise));
  ups = ups.map((u0, k) => {
    const rise = Math.min(h, ty[k] - ring[k].y);
    const hz = new THREE.Vector3(u0.x, 0, u0.z);
    if (hz.lengthSq() < 1e-8) hz.set(center.x - ring[k].x, 0, center.z - ring[k].z);
    hz.normalize().multiplyScalar(Math.sqrt(Math.max(0, h * h - rise * rise)));
    return along(new THREE.Vector3(hz.x, rise, hz.z), k);
  });
  // En V, en todo el frente la tira no se para: queda acostada sobre el pecho
  // siguiendo la tela, con el mismo ancho a lo largo de cada pata (parada
  // sería una pared). Atrás se para como en el cuello redondo; el cambio es
  // junto a cada hombro.
  if (M.vNeck) {
    ups = ups.map((u, k) => {
      const f = k <= 2 * tip ? smoothstep(M.neck.a, M.neck.a * 0.8, Math.abs(base[k].x)) : 0;
      if (f <= 0) return u;
      const flat = along(new THREE.Vector3().subVectors(base[k], below[k]).normalize(), k);
      return along(u.clone().lerp(flat, f).normalize(), k);
    });
  }
  const up = new THREE.Vector3();
  const out = new THREE.Vector3();
  const q = new THREE.Vector3();
  let u = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) u += ring[k].distanceTo(ring[i - 1]);
    up.copy(ups[k]);
    // Afuera: perpendicular a "arriba" dentro del plano vertical radial.
    out.set(ring[k].x - center.x, 0, ring[k].z - center.z).normalize();
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
  // En V, cada lado de la tira llega hasta el medio y ahí se corta (costura
  // en inglete): nada pasa al otro lado.
  if (M.vNeck) {
    const half = Math.round(n / 4);
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      if (k === tip || Math.abs(k - tip) > half) continue;
      const side = Math.sign(base[k].x);
      for (let j = 0; j < P; j++) {
        const v = (j * SW + i) * 3;
        if (pos[v] * side < 0) pos[v] = 0;
      }
    }
  }
  const idx = gridIndex(n, P - 1, SW);
  return { pos, uv, P, idx: orient(pos, idx, fromVertical, (v) => v < SW * 3) };
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

// Zonas de tela calada (para los tejidos que las tienen): una franja a cada
// costado, de la axila al ruedo, y otra bajo el brazo en cada manga. 1 en la
// zona, 0 afuera, con un borde suave.
function zoneMarks(parts, M, W) {
  for (const key of ['front', 'back']) {
    const p = parts[key];
    const n = p.pos.length / 3;
    p.zone = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const r0 = Math.floor(v / W) * W;
      const u = p.uv[v * 2];
      const side = Math.min(u - p.uv[r0 * 2], p.uv[(r0 + COLS) * 2] - u);
      const y = p.pos[v * 3 + 1];
      p.zone[v] = smoothstep(0.075, 0.06, side) * smoothstep(M.pitY + 0.01, M.pitY - 0.02, y);
    }
  }
  for (const key of ['sleeveL', 'sleeveR']) {
    const p = parts[key];
    const n = p.pos.length / 3;
    const SW = p.uv.length / 2 / (p.rows + 1);
    p.zone = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const r = Math.floor(v / SW);
      const per = p.uv[(r * SW + SW - 1) * 2];
      const u = p.uv[v * 2];
      p.zone[v] = smoothstep(0.05, 0.035, Math.min(u, per - u));
    }
  }
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
    const SW = s.uv.length / 2 / (s.rows + 1);
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
    const SW = p.uv.length / 2 / (p.rows + 1);
    set(p, (v) => {
      const k = v % SW;
      const r = Math.floor(v / SW);
      const per = p.uv[(r * SW + SW - 1) * 2];
      const u = p.uv[v * 2];
      const vEnd = p.uv[(p.rows * SW + k) * 2 + 1];
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
