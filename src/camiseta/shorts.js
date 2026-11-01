// Short de fútbol: dos piernas, cada una de una sola pieza (con su propio
// molde de estampado), la cintura elástica arriba (frunce la tela) y abajo el
// dobladillo, como el de la camiseta: la misma tela, con doble pespunte. Sale
// del molde de Demian (moldes/short/): tiro de 30, adelante liso hasta la
// entrepierna, y la entrepierna de 10 (Demian: «lo veo largo desde abajo del
// tiro, le sacaría unos 10 centímetros»). Puesto va debajo de la camiseta,
// del mismo ancho que ella y apenas adentro, y cae derecho (Demian: «como si
// fueran exactamente del mismo ancho, pero el short queda por adentro»; «que
// caiga recto y ya»). Medidas en metros, con el mismo origen que la camiseta
// (y = 0 en el hombro, z hacia el frente).
import * as THREE from 'three';
import { buildLip, computeNormals, weldNormals, gridIndex, gridUV, orient, torsoFold } from './shirt.js';
import { hangShortLeg } from './shortdrape.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Alturas: cintura, entrepierna y ruedo. La camiseta de 62 cm termina en
// -0,62: el short entra 20 cm debajo de ella y se ven 10 de cadera y 10 de
// piernas (Demian: «si son 26 ahora, podemos hacerlo en 20»).
export const SHORT = { waist: -0.42, crotch: -0.72, hem: -0.82 };
const ROWS = 72; // filas, del ruedo a la cintura (de 5,6 mm)
const COLS = 160; // columnas de cada pierna, de la costura de adelante a la de atrás (las del frunce, de 3 mm)
const WAIST_ROWS = 7; // filas de la cintura (3,9 cm)
const CROTCH_SPAN = 0.07; // cuánto más arriba de la entrepierna empiezan a separarse las piernas
const HEM_GAP = 0.012; // entre las dos piernas, en el ruedo
// El contorno: el de la camiseta a cada altura (debajo de su ruedo, el del
// ruedo), MARGIN más adentro, con las mismas ondas suaves de su caída (ver
// followShirt). Su dobladillo va 2,4 mm hacia adentro: así no se traspasan,
// y de afuera casi no se ve el escalón (con el short más angosto quedaba un
// espacio a los costados).
const MARGIN = 0.0036;
const FOLD_FADE = 0.04; // debajo del ruedo, las ondas se apagan en esto
// El elástico junta la cintura: arriba más angosta (y menos honda) que el
// resto; la tela se abre en WAIST_EASE.
const WAIST_IN = { a: 0.017, d: 0.012 };
const WAIST_EASE = 0.09;
// Arriba, del elástico al tiro, el short es el contorno (cada pierna, su
// mitad), plano por el medio: sólo se ve la costura. Las piernas son dos
// cilindros, cada uno de la costura de adentro al costado (Demian: «la parte
// de abajo, las piernitas, tienen que ser dos cilindros; si no, el interior
// se ve recto, cuadrado»; con cada pierna cerrada por una pared plana,
// así se veía). El paso de uno a otro, en los CROTCH_SPAN de arriba de la
// entrepierna; en los últimos CROTCH_CURVE, la curva del tiro lleva la
// costura del medio hacia atrás.
const INNER_N = 2;
const CROTCH_CURVE = 0.035;
const HEM_LIP = 0.022; // dobladillo del ruedo (como el de la camiseta)
const T_SAMPLES = 480;
const FLAT = 1e3; // medio ancho de un lado plano

// El contorno del short a la altura y: medio ancho A, hondo adelante F y
// atrás B (desde z = 0; la camiseta está apenas corrida hacia adelante:
// M.sc).
function shortMeasures(M) {
  const hemY = -M.L;
  const outline = (y) => {
    const yy = Math.max(y, hemY);
    const c = M.sc(yy);
    return { A: M.sa(yy) - MARGIN, F: M.sb(yy) + c - MARGIN, B: M.sbB(yy) - c - MARGIN };
  };
  return { hemY, outline, full: outline(hemY), n: M.n };
}

// Las ondas de la camiseta (sus pliegues de caída, ±4 mm o más con calce
// holgado): cada punto del contorno del short se mueve lo mismo que la tela
// de la camiseta en esa dirección, y debajo de su ruedo se apagan en
// FOLD_FADE (el short cae liso). Los puntos de adentro (entre las piernas)
// no se mueven.
function followShirt(pos, S, M) {
  const e = 2 / M.n;
  for (let v = 0; v < pos.length; v += 3) {
    const [x, y, z] = [pos[v], pos[v + 1], pos[v + 2]];
    const k = 1 - smooth(clamp01((S.hemY - y) / FOLD_FADE));
    if (!k) continue;
    const U = S.outline(y);
    const b = z >= 0 ? U.F : U.B;
    const on = smooth(clamp01(((Math.abs(x) / U.A) ** S.n + (Math.abs(z) / b) ** S.n) ** (1 / S.n) * 20 - 18.6));
    if (!on) continue;
    // El punto de la camiseta en la misma dirección (su ángulo th: 0
    // adelante, π/2 a la izquierda).
    const yy = Math.max(y, S.hemY);
    const c = M.sc(yy);
    const sb = z >= c ? M.sb(yy) : M.sbB(yy);
    const th = Math.atan2(spow(x / M.sa(yy), 1 / e), spow((z - c) / sb, 1 / e) || 1e-9);
    const xs = M.sa(yy) * spow(Math.sin(th), e);
    const zs = c + sb * spow(Math.cos(th), e);
    const d = torsoFold(M, xs, yy, zs, th) * k * on;
    // (Como la tela de la camiseta, a lo largo de su normal: hacia afuera
    // derecho, en las diagonales se acercaba hasta 2 mm.)
    const nx = spow(xs / M.sa(yy), S.n - 1) / M.sa(yy);
    const nz = spow((zs - c) / sb, S.n - 1) / sb;
    const l = Math.hypot(nx, nz) || 1;
    pos[v] += (nx / l) * d;
    pos[v + 2] += (nz / l) * d;
  }
}

// Sección a la altura y: superelipse de centro (sx, 0), medio ancho afuera
// sa y adentro si, hondo adelante sbF y atrás sbB, exponente afuera n y
// adentro ni. Arriba es el contorno entero (cada pierna, su mitad); en los
// CROTCH_SPAN de arriba de la entrepierna el centro se corre hacia afuera,
// con el borde de afuera en su lugar, hasta el del cilindro, y el lado de
// adentro llega al medio justo en la entrepierna; más abajo, cada pierna un
// cilindro, apenas separado del otro.
function section(S, y) {
  const U = S.outline(y);
  const pull = smooth(clamp01((y - (SHORT.waist - WAIST_EASE)) / WAIST_EASE));
  const A = Math.min(U.A, S.full.A - WAIST_IN.a * pull);
  const F = Math.min(U.F, S.full.F - WAIST_IN.d * pull);
  const B = Math.min(U.B, S.full.B - WAIST_IN.d * pull);
  const s = smooth(clamp01((SHORT.crotch + CROTCH_SPAN - y) / CROTCH_SPAN));
  const b = clamp01((SHORT.crotch - y) / (SHORT.crotch - SHORT.hem));
  const inner = y > SHORT.crotch ? 0 : (HEM_GAP / 2) * b ** 1.2;
  const R = (A - inner) / 2; // radio del cilindro
  const sx = inner + R * s;
  // La costura del medio, en la curva del tiro: de adelante (q = 1) hacia
  // atrás hasta la entrepierna (q = 0), donde se cierra la pierna; el ancho de
  // adentro `si` hace que el lado de adentro la cruce justo ahí (más arriba,
  // plano: infinito).
  const q = clamp01((y - SHORT.crotch) / CROTCH_CURVE);
  const g = (1 - (1 - (1 - q) ** 2) ** INNER_N) ** (1 / INNER_N);
  return { sx, sa: A - sx, si: g > 1e-4 ? (sx - inner) / g : FLAT, sbF: lerp(F, R, s), sbB: lerp(B, R, s), n: lerp(S.n, 2, s), ni: INNER_N };
}
// Punto de la sección para el ángulo t (π/2 adelante, 0 afuera, -π/2 atrás).
// (Sin `si` ni `ni`, la superelipse es la misma de los dos lados.)
function sectionPoint(c, t) {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const e = 2 / (ct >= 0 ? c.n : c.ni ?? c.n);
  return [c.sx + (ct >= 0 ? c.sa : c.si ?? c.sa) * spow(ct, e), (st >= 0 ? c.sbF : c.sbB) * spow(st, e)];
}
// Hacia afuera de la sección en (sx + dx, dz): su gradiente (sin largo
// fijo).
function sectionGrad(c, dx, dz) {
  const b = dz >= 0 ? c.sbF : c.sbB;
  const a = dx >= 0 ? c.sa : c.si ?? c.sa;
  const n = dx >= 0 ? c.n : c.ni ?? c.n;
  return [spow(dx / a, n - 1) / a, spow(dz / b, n - 1) / b];
}

// Una pierna (la izquierda, x > 0): grilla de ROWS + 1 filas por COLS + 1
// columnas. Cada fila va de la costura de adelante a la de atrás por afuera
// (las columnas, como dice SPACING_ROWS). Arriba de la entrepierna las puntas
// están en el medio (las costuras de adelante y de atrás, con la otra
// pierna); debajo se juntan (la costura de la entrepierna). `sec(r, y)` da la
// sección de cada fila (y es la altura puesta) y `outY(y)`, dónde va.
const rowY = (r) => lerp(SHORT.hem, SHORT.waist, r / ROWS);
// La columna del medio va en el costado (t = 0) y, de ahí hacia cada
// costura, las columnas a una distancia que cambia suave de fila en fila
// (promedio de ±SPACING_ROWS, sin pasar de la de distancias iguales); lo que
// sobra en cada fila lo toman las columnas de la parte EDGE más cerca de la
// costura. (A distancias iguales en
// cada fila, al cerrarse la pierna en la entrepierna todas las columnas se
// corrían de golpe y marcaban una arruga a lo ancho.)
const SPACING_ROWS = 8;
const EDGE = 0.35;
function legGrid(sec, outY = (y) => y, z0 = 0) {
  const W = COLS + 1;
  const c0 = COLS / 2;
  const pos = new Float32Array(W * (ROWS + 1) * 3);
  const rows = [];
  for (let r = 0; r <= ROWS; r++) {
    const y = rowY(r);
    const c = sec(r, y);
    const ts = new Float64Array(T_SAMPLES + 1);
    const cum = new Float64Array(T_SAMPLES + 1);
    const pts = new Float64Array((T_SAMPLES + 1) * 2);
    sampleArc(c, ts, cum, pts);
    let k = 0;
    while (k < T_SAMPLES - 1 && ts[k + 1] > 0) k++;
    const side = lerp(cum[k], cum[k + 1], ts[k] / (ts[k] - ts[k + 1] || 1));
    rows.push({ y, c, cum, pts, half: [side, cum[T_SAMPLES] - side] });
  }
  const step = [0, 1].map((h) =>
    rows.map((_, r) => {
      let sum = 0;
      let n = 0;
      for (let q = Math.max(0, r - SPACING_ROWS); q <= Math.min(ROWS, r + SPACING_ROWS); q++) {
        sum += rows[q].half[h];
        n++;
      }
      return Math.min(rows[r].half[h], sum / n) / c0;
    }),
  );
  for (let r = 0; r <= ROWS; r++) {
    const { y, c, cum, pts, half } = rows[r];
    for (let j = 0; j <= COLS; j++) {
      const h = j < c0 ? 0 : 1;
      const u = Math.abs(j - c0) / c0;
      const d = u * c0 * step[h][r] + (half[h] - c0 * step[h][r]) * smooth(clamp01((u - 1 + EDGE) / EDGE));
      const target = half[0] + (h ? d : -d);
      let lo = 0;
      let hi = T_SAMPLES;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid;
      }
      // (Entre dos muestras, en línea recta: en un lado plano, una muestra
      // lo cruza entero y el ángulo intermedio caía en la punta.)
      const f = clamp01((target - cum[lo]) / (cum[hi] - cum[lo] || 1));
      pos.set([lerp(pts[lo * 2], pts[hi * 2], f), outY(y), z0 + lerp(pts[lo * 2 + 1], pts[hi * 2 + 1], f)], (r * W + j) * 3);
    }
    // La primera y la última columna: juntas (entrepierna) o justo en el
    // medio (tiro).
    if (c.sx >= (c.si ?? c.sa)) pos.set(pos.subarray(r * W * 3, r * W * 3 + 3), (r * W + COLS) * 3);
    else {
      pos[r * W * 3] = 0;
      pos[(r * W + COLS) * 3] = 0;
    }
  }
  return { pos, W };
}
// Recorrido de la tela en una sección: desde donde cruza el medio adelante
// (o desde la entrepierna, si la vuelta está cerrada), por afuera, hasta
// atrás; ángulos en `ts`, largo acumulado en `cum` y, si hace falta, los
// puntos en `pts` (x, z). Devuelve el largo.
function sampleArc(c, ts, cum, pts = null) {
  const tf = Math.acos(-(Math.min(1, c.sx / (c.si ?? c.sa)) ** ((c.ni ?? c.n) / 2)));
  let px = 0;
  let pz = 0;
  for (let k = 0; k <= T_SAMPLES; k++) {
    ts[k] = tf - (2 * tf * k) / T_SAMPLES;
    const p = sectionPoint(c, ts[k]);
    cum[k] = k ? cum[k - 1] + Math.hypot(p[0] - px, p[1] - pz) : 0;
    px = p[0];
    pz = p[1];
    if (pts) pts.set(p, k * 2);
  }
  return cum[T_SAMPLES];
}

// Frunce del elástico: la cintura junta tela (más que la vuelta del
// elástico) y la ondea en pliegues finos, que se apagan enseguida debajo de
// ella (abajo, el short liso, como el molde: los pliegues que bajaban al tiro
// no le gustaron a Demian). Se mueve cada punto hacia afuera de su sección,
// según dónde está en la tela (u, v de la pieza), así las dos piernas
// coinciden en las costuras. `out(v)` es hacia afuera en el punto v, `k`
// achica todo (colgado, el short va plano) y `under(y)`, la camiseta encima:
// ahí no hay frunce (no se ve y la haría asomar).
const GATHER = 0.0028; // hondo del frunce en la cintura
function gather(pos, W, uv, out, k = 1, under = () => 0) {
  const waistV = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
  for (let r = 0; r <= ROWS; r++) {
    for (let j = 0; j < W; j++) {
      const v = r * W + j;
      const u = uv[v * 2];
      const top = uv[(ROWS * W + j) * 2 + 1];
      const below = top - waistV - uv[v * 2 + 1]; // > 0 debajo de la cintura
      const inBand = clamp01(-below / waistV); // de abajo (0) a arriba (1) de la cintura
      const band = below < 0 ? 0.4 + 0.6 * Math.sin(Math.PI * inBand) : 1 - smooth(clamp01(below / 0.015));
      // (El frunce, sólo hacia afuera: hacia adentro pasaba detrás del
      // dobladillo de la cintura y se veía su revés, como tajos.)
      const ripple = 0.5 + 0.5 * (0.6 * Math.sin((2 * Math.PI * u) / 0.013) + 0.4 * Math.sin((2 * Math.PI * u) / 0.0085 + 1.7));
      const d = k * (1 - under(pos[v * 3 + 1])) * GATHER * band * ripple;
      if (!d) continue;
      const [gx, gy, gz] = out(v);
      const l = Math.hypot(gx, gy, gz) || 1;
      pos[v * 3] += (gx / l) * d;
      pos[v * 3 + 1] += (gy / l) * d;
      pos[v * 3 + 2] += (gz / l) * d;
    }
  }
}

// Hacia afuera de una grilla (de abajo arriba, de la costura de adelante a
// la de atrás): la normal de la superficie en cada punto.
function gridNormals(pos, W) {
  const H = pos.length / 3 / W;
  const p = (r, j) => Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, j));
  return (v) => {
    const r = Math.floor(v / W);
    const j = v % W;
    const a = p(r, j + 1) * 3;
    const b = p(r, j - 1) * 3;
    const c = p(r + 1, j) * 3;
    const d = p(r - 1, j) * 3;
    const ux = pos[a] - pos[b];
    const uy = pos[a + 1] - pos[b + 1];
    const uz = pos[a + 2] - pos[b + 2];
    const vx = pos[c] - pos[d];
    const vy = pos[c + 1] - pos[d + 1];
    const vz = pos[c + 2] - pos[d + 2];
    // (A lo largo de la fila va de adelante hacia atrás por afuera: con la
    // subida, la normal mira hacia afuera.)
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
}

// Canales del elástico (costuras hundidas a lo largo de la cintura, desde
// abajo).
const CHANNELS = [0.013, 0.026];

// Las piezas del short: piernas (legL, legR) con su dobladillo abajo
// (hemLLip, hemRLip) y cintura (waistL, waistR) con su dobladillo de arriba.
// Con `hung` ({ top, z }: borde de arriba y plano del medio), colgado de dos
// broches en la cintura; devuelve también dónde van los broches.
export function buildShorts(M, hung = null) {
  const S = shortMeasures(M);
  const worn = legGrid((r, y) => section(S, y));
  const W = worn.W;
  // La pieza (molde, tela y largos de la colgada) es la del short sin el
  // achique de debajo de la camiseta: puesto, ahí no se ve.
  const S2 = { ...S, outline: () => S.full };
  const piece = legGrid((r, y) => section(S2, y)).pos;
  const uvPiece = gridUV(piece, W, ROWS + 1, COLS / 2);
  let base = worn.pos;
  let clips = null;
  // Sección de cada fila (por la altura donde quedó).
  const secOf = (y) => section(S, y);
  if (hung) {
    // Colgado: la tela simulada (shortdrape.js), con la mitad del frunce.
    const h = hangShortLeg(piece, W, ROWS + 1, WAIST_ROWS, SHORT.crotch + CROTCH_SPAN, hung);
    base = h.pos;
    clips = h.clips;
    gather(base, W, uvPiece, gridNormals(base, W), 0.5);
  } else {
    const out = (v) => {
      const c = secOf(base[v * 3 + 1]);
      const [gx, gz] = sectionGrad(c, base[v * 3] - c.sx, base[v * 3 + 2]);
      return [gx, 0, gz];
    };
    gather(base, W, uvPiece, out, 1, (y) => 1 - smooth(clamp01((S.hemY - y) / 0.02)));
  }
  const parts = {};
  const c0 = COLS / 2;
  const waistV = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
  for (const [key, side] of [
    ['L', 1],
    ['R', -1],
  ]) {
    const pos = Float32Array.from(base);
    // (Las caras, orientadas con la pierna puesta: colgada es la misma tela.)
    const wornPos = Float32Array.from(worn.pos);
    if (side < 0) for (let v = 0; v < pos.length; v += 3) pos[v] = -pos[v];
    if (side < 0) for (let v = 0; v < wornPos.length; v += 3) wornPos[v] = -wornPos[v];
    // (Las ondas de la camiseta no son iguales de los dos lados.)
    if (!hung) followShirt(pos, S, M);
    // (Tela y molde, los de la pierna puesta: colgada es la misma pieza.)
    const uv = uvPiece;
    // Molde: visto desde afuera, x hacia la derecha (en la izquierda, hacia
    // atrás; en la derecha, hacia adelante) e y hacia abajo desde la
    // cintura en el costado.
    const vTop = uv[(ROWS * W + c0) * 2 + 1];
    const uv1 = new Float32Array(uv.length);
    for (let v = 0; v < uv.length / 2; v++) {
      uv1[v * 2] = side * uv[v * 2];
      uv1[v * 2 + 1] = vTop - uv[v * 2 + 1];
    }
    // Hacia afuera: el gradiente de la superelipse de su fila.
    const out = (x, y, z) => {
      const c = secOf(y);
      const [gx, gz] = sectionGrad(c, side * x - c.sx, z);
      return [gx * side, 0, gz];
    };
    const slice = (r0, r1, waist) => {
      const a = r0 * W;
      const b = (r1 + 1) * W;
      const p = pos.slice(a * 3, b * 3);
      const part = { pos: p, uv: uv.slice(a * 2, b * 2), uv1: uv1.slice(a * 2, b * 2), idx: orient(wornPos.slice(a * 3, b * 3), gridIndex(COLS, r1 - r0, W), out) };
      // Costuras: los bordes de la pieza (entrepierna y tiro), el corte de la
      // cintura y, en ella, los canales del elástico; en la pierna, el doble
      // pespunte del dobladillo (desde el ruedo).
      const vv = part.uv;
      part.seam = new Float32Array((p.length / 3) * 2);
      for (let v = 0; v < p.length / 3; v++) {
        const row = Math.floor(v / W);
        const u = vv[v * 2];
        const uL = vv[row * W * 2];
        const uR = vv[(row * W + COLS) * 2];
        const lo = vv[(v % W) * 2 + 1];
        const hi = vv[((r1 - r0) * W + (v % W)) * 2 + 1];
        const h = vv[v * 2 + 1] - lo;
        let d = Math.min(u - uL, uR - u, waist ? h : hi - vv[v * 2 + 1]);
        if (waist) for (const c of CHANNELS) d = Math.min(d, Math.abs(h - c));
        part.seam[v * 2] = d;
        part.seam[v * 2 + 1] = waist ? 1 : h;
      }
      return part;
    };
    parts['leg' + key] = slice(0, ROWS - WAIST_ROWS, false);
    parts['waist' + key] = slice(ROWS - WAIST_ROWS, ROWS, true);
    // Dobladillo del ruedo (vuelta cerrada: la última columna es la primera).
    const ring = [];
    for (let j = 0; j < COLS; j++) ring.push([pos, j, W + j]);
    parts['hem' + key + 'Lip'] = buildLip(ring, HEM_LIP, true);
  }
  // Dobladillo de la cintura: la vuelta entera (las dos piernas).
  const waistRing = [];
  const L = parts.waistL.pos;
  const R = parts.waistR.pos;
  const rt = WAIST_ROWS * W;
  for (let j = 0; j < COLS; j++) waistRing.push([L, rt + j, rt - W + j]);
  for (let j = COLS; j > 0; j--) waistRing.push([R, rt + j, rt - W + j]);
  parts.waistLip = buildLip(waistRing, 0.012, true);
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals(['legL', 'legR', 'waistL', 'waistR'].map((k) => parts[k]));
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
  return hung ? { geos, clips } : geos;
}
