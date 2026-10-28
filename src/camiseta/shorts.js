// Short de fútbol: dos piernas, cada una de una sola pieza (con su propio
// molde de estampado), la cintura elástica arriba (frunce la tela) y abajo el
// dobladillo, como el de la camiseta: la misma tela, con doble pespunte. Las
// medidas salen del molde de Demian (moldes/short/): 50 cm de costado, tiro
// de 30, entrepierna de 20, 108 de cadera, la pierna de 74 cm de vuelta en
// la entrepierna y 64 en el ruedo. Puesto va debajo de la camiseta, que tapa
// la cintura, o al lado de ella, entero. Medidas en metros, con el mismo
// origen que la camiseta (y = 0 en el hombro, z hacia el frente).
import * as THREE from 'three';
import { buildLip, computeNormals, weldNormals, gridIndex, gridUV, orient } from './shirt.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Alturas: cintura, entrepierna y ruedo (la camiseta de 62 cm termina en
// -0,62: el short entra 14 cm debajo de ella).
export const SHORT = { waist: -0.48, crotch: -0.78, hem: -0.98 };
const ROWS = 90; // filas, del ruedo a la cintura (de 5,6 mm)
const COLS = 160; // columnas de cada pierna, de la costura de adelante a la de atrás (las del frunce, de 3 mm)
const WAIST_ROWS = 7; // filas de la cintura (3,9 cm)
const CROTCH_SPAN = 0.11; // cuánto más arriba de la entrepierna empiezan a separarse las piernas (más corto hacía un pliegue de sombra)
const HEM_GAP = 0.02; // entre las dos piernas, en el ruedo
// Cadera (medio ancho, hondo adelante y atrás: 108 cm de vuelta) y cada
// pierna: medio ancho y hondo en la entrepierna (73 cm de vuelta, más honda
// que ancha: el muslo y la cola) y en el ruedo (64). Visto de frente, el
// costado baja de la cadera al ruedo apenas abierto (más ancha la pierna
// arriba que la cadera, hacía un escalón en la entrepierna).
const HIP = { a: 0.2, f: 0.125, b: 0.135 };
// El elástico junta la cintura: arriba más angosta (y menos honda) que la
// cadera; la tela se abre hasta ella en WAIST_EASE.
const WAIST_IN = { a: 0.017, d: 0.012 };
const WAIST_EASE = 0.09;
const LEG = { top: [0.1, 0.13], hem: [0.1, 0.104], seat: 0.006 }; // (atrás, la cola: un poco más honda)
const HEM_LIP = 0.022; // dobladillo del ruedo (como el de la camiseta)
const T_SAMPLES = 480;

// Medidas que salen de la camiseta: debajo de ella la cadera entra con
// margen en su parte más angosta (si no, asoma a través de la tela); al salir
// del ruedo se ensancha enseguida hasta casi su ancho (A2, F2, B2) y abajo se
// abre un poco más.
// (Al lado de la camiseta, `beside`, no hay achique: el short entero.)
function shortMeasures(M, beside = false) {
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
  const S = { hemY, A: Math.min(HIP.a, a * 0.94), F: Math.min(HIP.f, f * 0.88), B: Math.min(HIP.b, b * 0.88), A2: HIP.a, F2: HIP.f, B2: HIP.b, n: M.n };
  return beside ? { ...S, A: S.A2, F: S.F2, B: S.B2 } : S;
}
const OUT_OF_SHIRT = 0.09; // cuánto tarda en ensancharse al salir de la camiseta (más rápido hacía un hombro)

// Sección a la altura y: superelipse de centro (sx, 0), medio ancho sa,
// hondo adelante sbF y atrás sbB, exponente n. Arriba es la cadera (centrada:
// cada pierna es su mitad); cerca de la entrepierna se corre hacia afuera y se
// achica con el borde de afuera derecho, hasta tocar el medio justo en la
// entrepierna; más abajo, cada pierna sola, apenas separada de la otra.
function section(S, y) {
  const w = smooth(clamp01((S.hemY - y) / OUT_OF_SHIRT));
  const F = lerp(S.F, S.F2, w);
  const B = lerp(S.B, S.B2, w);
  const top = SHORT.crotch + CROTCH_SPAN;
  const s = smooth(clamp01((top - y) / CROTCH_SPAN));
  const b = clamp01((SHORT.crotch - y) / (SHORT.crotch - SHORT.hem));
  // Cada pierna, de la entrepierna al ruedo (y arriba, mientras se separan,
  // la de la entrepierna).
  // (Debajo de una camiseta larga, que tapa el arranque de las piernas, se
  // achican como la cadera.)
  const la = lerp(LEG.top[0], LEG.hem[0], b) * lerp(S.A / S.A2, 1, w);
  const kd = lerp(Math.min(S.F / S.F2, S.B / S.B2), 1, w);
  const ld = lerp(LEG.top[1], LEG.hem[1], b) * kd;
  const ldB = (lerp(LEG.top[1], LEG.hem[1], b) + LEG.seat) * kd;
  const inner = y > SHORT.crotch ? 0 : (HEM_GAP / 2) * b ** 1.2;
  const pull = smooth(clamp01((y - (SHORT.waist - WAIST_EASE)) / WAIST_EASE));
  const hip = Math.min(lerp(S.A, S.A2, w), S.A2 - WAIST_IN.a * pull);
  const outer = y > SHORT.crotch ? lerp(hip, 2 * la, s) : inner + 2 * la;
  const inn = y > SHORT.crotch ? -(1 - s) * outer : inner;
  return {
    sx: (outer + inn) / 2,
    sa: (outer - inn) / 2,
    sbF: y > SHORT.crotch ? lerp(Math.min(F, S.F2 - WAIST_IN.d * pull), ld, s) : ld,
    sbB: y > SHORT.crotch ? lerp(Math.min(B, S.B2 - WAIST_IN.d * pull), ldB, s) : ldB,
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
// pierna); debajo se juntan (la costura de la entrepierna). `sec(r, y)` da la
// sección de cada fila (y es la altura puesta) y `outY(y)`, dónde va.
const rowY = (r) => lerp(SHORT.hem, SHORT.waist, r / ROWS);
function legGrid(sec, outY = (y) => y, z0 = 0) {
  const W = COLS + 1;
  const pos = new Float32Array(W * (ROWS + 1) * 3);
  const ts = new Float64Array(T_SAMPLES + 1);
  const cum = new Float64Array(T_SAMPLES + 1);
  for (let r = 0; r <= ROWS; r++) {
    const y = rowY(r);
    const c = sec(r, y);
    sampleArc(c, ts, cum);
    let k = 0;
    for (let j = 0; j <= COLS; j++) {
      const target = (cum[T_SAMPLES] * j) / COLS;
      while (k < T_SAMPLES - 1 && cum[k + 1] < target) k++;
      const f = (target - cum[k]) / (cum[k + 1] - cum[k] || 1);
      const p = sectionPoint(c, lerp(ts[k], ts[k + 1], clamp01(f)));
      pos.set([p[0], outY(y), z0 + p[1]], (r * W + j) * 3);
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
// Recorrido de la tela en una sección: desde donde cruza el medio adelante
// (o desde la entrepierna, si la vuelta está cerrada), por afuera, hasta
// atrás; ángulos en `ts` y largo acumulado en `cum`. Devuelve el largo.
function sampleArc(c, ts, cum) {
  const tf = Math.acos(-(Math.min(1, c.sx / c.sa) ** (c.n / 2)));
  let px = 0;
  let pz = 0;
  for (let k = 0; k <= T_SAMPLES; k++) {
    ts[k] = tf - (2 * tf * k) / T_SAMPLES;
    const p = sectionPoint(c, ts[k]);
    cum[k] = k ? cum[k - 1] + Math.hypot(p[0] - px, p[1] - pz) : 0;
    px = p[0];
    pz = p[1];
  }
  return cum[T_SAMPLES];
}

// Frunce del elástico: la cintura junta tela (más que la vuelta del
// elástico) y la ondea en pliegues finos; abajo, pliegues suaves que bajan
// derechos y se apagan. Se mueve cada punto hacia afuera de su sección, según
// dónde está en la tela (u, v de la pieza), así las dos piernas coinciden en
// las costuras. `k` achica todo (colgado, el short va plano) y `under(y)`,
// la camiseta encima: ahí no hay frunce (no se ve y la haría asomar).
const GATHER = 0.0028; // hondo del frunce en la cintura
const FOLD = 0.005; // y de los pliegues de abajo
const FOLD_LEN = 0.14; // hasta dónde bajan
function gather(pos, W, uv, secOf, z0 = 0, k = 1, under = () => 0) {
  const waistV = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
  for (let r = 0; r <= ROWS; r++) {
    for (let j = 0; j < W; j++) {
      const v = r * W + j;
      const u = uv[v * 2];
      const top = uv[(ROWS * W + j) * 2 + 1];
      const below = top - waistV - uv[v * 2 + 1]; // > 0 debajo de la cintura
      const inBand = clamp01(-below / waistV); // de abajo (0) a arriba (1) de la cintura
      const band = below < 0 ? 0.4 + 0.6 * Math.sin(Math.PI * inBand) : 1 - smooth(clamp01(below / 0.015));
      const fold = 1 - smooth(clamp01(Math.max(0, below) / FOLD_LEN));
      const d =
        k *
        (1 - under(pos[v * 3 + 1])) *
        (GATHER * band * (0.6 * Math.sin((2 * Math.PI * u) / 0.013) + 0.4 * Math.sin((2 * Math.PI * u) / 0.0085 + 1.7)) +
          FOLD * fold * (0.65 * Math.sin((2 * Math.PI * u) / 0.048 + 0.5) + 0.35 * Math.sin((2 * Math.PI * u) / 0.029 + 2.3)));
      if (!d) continue;
      const c = secOf(pos[v * 3 + 1]);
      const dx = pos[v * 3] - c.sx;
      const dz = pos[v * 3 + 2] - z0;
      const sb = dz >= 0 ? c.sbF : c.sbB;
      const gx = spow(dx / c.sa, c.n - 1) / c.sa;
      const gz = spow(dz / sb, c.n - 1) / sb;
      const l = Math.hypot(gx, gz) || 1;
      pos[v * 3] += (gx / l) * d;
      pos[v * 3 + 2] += (gz / l) * d;
    }
  }
}

// Colgado de broches: plano (el frente sobre la espalda) con algo de volumen,
// como en una foto de producto, y sin arrugas (no se simula). Cada fila mide
// lo mismo que puesta: su sección es una superelipse finita (n = 4: caras
// planas y dobleces redondeados) del ancho que haga falta, con las piernas
// separadas como puestas.
const HUNG_N = 4;
const HUNG_T = 0.012; // medio espesor (el volumen)
const HUNG_T_WAIST = 0.007; // en la cintura, más finito (el elástico)
const WAIST_H = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
function hungSection(y, outer, t = null) {
  const top = SHORT.crotch + CROTCH_SPAN;
  const s = smooth(clamp01((top - y) / CROTCH_SPAN));
  const b = clamp01((SHORT.crotch - y) / (SHORT.crotch - SHORT.hem));
  const inner = y > SHORT.crotch ? -(1 - s) * outer : (HEM_GAP / 2) * b ** 1.2;
  if (t === null) t = lerp(HUNG_T, HUNG_T_WAIST, smooth(clamp01((y - (SHORT.waist - 1.6 * WAIST_H)) / (0.6 * WAIST_H))));
  return { sx: (outer + inner) / 2, sa: (outer - inner) / 2, sbF: t, sbB: t, n: HUNG_N };
}
// El ancho de cada fila colgada: el costado baja derecho desde la cintura
// hasta donde las piernas se empiezan a separar y de ahí hasta el ruedo
// (HUNG_FLARE más ancho), y cada fila mide lo mismo que puesta: lo que sobra
// o falta lo toma el volumen (la cadera, al salir de la camiseta, y la pierna,
// que da más vuelta que la mitad de la cadera, cuelgan como un tubo
// achatado).
const HUNG_FLARE = 1.1;
const HUNG_T_MIN = 0.004;
const HUNG_T_MAX = 0.07;
function hungSections(worn, W) {
  const ts = new Float64Array(T_SAMPLES + 1);
  const cum = new Float64Array(T_SAMPLES + 1);
  const rowLen = (r) => {
    let len = 0;
    for (let j = 1; j <= COLS; j++) {
      const a = (r * W + j - 1) * 3;
      const b = (r * W + j) * 3;
      len += Math.hypot(worn[b] - worn[a], worn[b + 1] - worn[a + 1], worn[b + 2] - worn[a + 2]);
    }
    return len;
  };
  const solve = (lo, hi, f, len) => {
    for (let k = 0; k < 32; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < len) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const yTop = SHORT.crotch + CROTCH_SPAN;
  const rTop = Math.round(((yTop - SHORT.hem) / (SHORT.waist - SHORT.hem)) * ROWS);
  // Costado: recto de la cintura a rTop y de ahí al ruedo.
  const free = (r) => solve(0.02, 0.6, (o) => sampleArc(hungSection(rowY(r), o), ts, cum), rowLen(r));
  const oW = free(ROWS);
  const oT = free(rTop);
  const out = [];
  for (let r = 0; r <= ROWS; r++) {
    const y = rowY(r);
    const len = rowLen(r);
    const outer = r >= rTop ? lerp(oT, oW, (r - rTop) / (ROWS - rTop)) : oT * lerp(HUNG_FLARE, 1, r / rTop);
    const arc = (t) => sampleArc(hungSection(y, outer, t), ts, cum);
    if (arc(HUNG_T_MIN) > len) out.push(hungSection(y, solve(0.02, outer, (o) => sampleArc(hungSection(y, o, HUNG_T_MIN), ts, cum), len), HUNG_T_MIN));
    else if (arc(HUNG_T_MAX) < len) out.push(hungSection(y, solve(outer, 0.8, (o) => sampleArc(hungSection(y, o, HUNG_T_MAX), ts, cum), len), HUNG_T_MAX));
    else out.push(hungSection(y, outer, solve(HUNG_T_MIN, HUNG_T_MAX, arc, len)));
  }
  // Ancho y volumen parejos fila a fila (el largo de cada fila cambia un poco:
  // si no, la pierna se infla de golpe en la entrepierna).
  const avg = (get, R) => out.map((_, r) => {
    let sum = 0;
    let n = 0;
    for (let q = Math.max(0, r - R); q <= Math.min(ROWS, r + R); q++) {
      sum += get(out[q]);
      n++;
    }
    return sum / n;
  });
  const outerS = avg((c) => c.sx + c.sa, HUNG_SMOOTH);
  const tS = avg((c) => c.sbF, HUNG_SMOOTH);
  return out.map((_, r) => hungSection(rowY(r), outerS[r], tS[r]));
}
const HUNG_SMOOTH = 6; // filas a cada lado
const CLIP_IN = 0.016; // los broches, a esto del doblez de cada costado
const CLIP = { width: 0.03, depth: 0.012 };

// Al lado de la camiseta (`beside`): dónde va el short entero. A la derecha
// de su ruedo, con 2 cm de aire, y la cintura a media camiseta (abajo de la
// manga: más arriba la tocaría).
const BESIDE_GAP = 0.02;
const BESIDE_WAIST = -0.3;
export function besideOffset(M) {
  return { x: M.sa(-M.L) + BESIDE_GAP + 2 * LEG.hem[0] + HEM_GAP / 2, y: BESIDE_WAIST - SHORT.waist, z: 0 };
}

// Canales del elástico (costuras hundidas a lo largo de la cintura, desde
// abajo).
const CHANNELS = [0.013, 0.026];

// Las piezas del short: piernas (legL, legR) con su dobladillo abajo
// (hemLLip, hemRLip) y cintura (waistL, waistR) con su dobladillo de arriba.
// Con `hung` ({ top, z }: borde de arriba y plano del medio), colgado de dos
// broches en la cintura; devuelve también dónde van los broches. Con
// `opts.beside`, entero al lado de la camiseta (ver besideOffset).
export function buildShorts(M, hung = null, opts = {}) {
  const beside = !hung && opts.beside;
  const S = shortMeasures(M, beside);
  const worn = legGrid((r, y) => section(S, y));
  const W = worn.W;
  // La pieza (molde, tela y largos de la colgada) es la del short sin el
  // achique de debajo de la camiseta: puesto, ahí no se ve.
  const S2 = { ...S, A: S.A2, F: S.F2, B: S.B2 };
  const piece = legGrid((r, y) => section(S2, y)).pos;
  const uvPiece = gridUV(piece, W, ROWS + 1, COLS / 2);
  let base = worn.pos;
  let clips = null;
  // Sección de cada fila (por la altura donde quedó).
  let secOf = (y) => section(S, y);
  if (hung) {
    const secs = hungSections(piece, W);
    const sec = (r) => secs[r];
    secOf = (y) => secs[Math.min(ROWS, Math.max(0, Math.round(((y - hung.top) / (SHORT.waist - SHORT.hem)) * ROWS + ROWS)))];
    base = legGrid(sec, (y) => hung.top + (y - SHORT.waist), hung.z).pos;
    gather(base, W, uvPiece, secOf, hung.z, 0.5);
    // Los broches aprietan las dos capas en la cintura, cerca de cada costado.
    const top = secs[ROWS];
    const cx = top.sx + top.sa - CLIP_IN;
    clips = [-1, 1].map((sd) => ({ x: sd * cx, y: hung.top, z: hung.z, ...CLIP }));
    for (let v = 0; v < base.length; v += 3) {
      const wx = 1 - smooth(clamp01((Math.abs(base[v] - cx) - CLIP.width / 2) / 0.012));
      const wy = smooth(clamp01((base[v + 1] - (hung.top - CLIP.depth - 0.012)) / 0.012));
      base[v + 2] = hung.z + (base[v + 2] - hung.z) * (1 - 0.8 * wx * wy);
    }
  } else gather(base, W, uvPiece, secOf, 0, 1, beside ? () => 0 : (y) => 1 - smooth(clamp01((S.hemY - y) / 0.02)));
  const parts = {};
  const c0 = COLS / 2;
  const waistV = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
  for (const [key, side] of [
    ['L', 1],
    ['R', -1],
  ]) {
    const pos = Float32Array.from(base);
    if (side < 0) for (let v = 0; v < pos.length; v += 3) pos[v] = -pos[v];
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
    const z0 = hung ? hung.z : 0;
    const out = (x, y, z) => {
      const c = secOf(y);
      const dz = z - z0;
      return [spow((side * x - c.sx) / c.sa, c.n - 1) / c.sa * side, 0, spow(dz / (dz >= 0 ? c.sbF : c.sbB), c.n - 1) / (dz >= 0 ? c.sbF : c.sbB)];
    };
    const slice = (r0, r1, waist) => {
      const a = r0 * W;
      const b = (r1 + 1) * W;
      const p = pos.slice(a * 3, b * 3);
      const part = { pos: p, uv: uv.slice(a * 2, b * 2), uv1: uv1.slice(a * 2, b * 2), idx: orient(p, gridIndex(COLS, r1 - r0, W), out) };
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
  parts.waistLip = buildLip(waistRing, 0.03, true);
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals(['legL', 'legR', 'waistL', 'waistR'].map((k) => parts[k]));
  // Al lado de la camiseta: todo corrido (no cambia las normales).
  if (beside) {
    const o = besideOffset(M);
    for (const part of Object.values(parts))
      for (let v = 0; v < part.pos.length; v += 3) {
        part.pos[v] += o.x;
        part.pos[v + 1] += o.y;
        part.pos[v + 2] += o.z;
      }
  }
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
