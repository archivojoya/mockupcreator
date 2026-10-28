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

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);
const spow = (v, e) => Math.sign(v) * Math.abs(v) ** e;

// Alturas: cintura, entrepierna y ruedo (la camiseta de 62 cm termina en
// -0,62: el short entra 14 cm debajo de ella).
export const SHORT = { waist: -0.48, crotch: -0.78, hem: -0.88 };
const ROWS = 72; // filas, del ruedo a la cintura (de 5,6 mm)
const COLS = 160; // columnas de cada pierna, de la costura de adelante a la de atrás (las del frunce, de 3 mm)
const WAIST_ROWS = 7; // filas de la cintura (3,9 cm)
const CROTCH_SPAN = 0.11; // cuánto más arriba de la entrepierna empiezan a separarse las piernas
const HEM_GAP = 0.02; // entre las dos piernas, en el ruedo
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
// Cada pierna, la mitad del contorno con el lado de adentro cerrado por una
// pared (la tela de la entrepierna) que dobla hacia atrás en CORNER: de
// frente y de costado no cambia nada, sólo aparece la raya del medio. (Con
// cada pierna redonda, el costado se curvaba y de perfil hacía un pliegue.)
// Arriba de la entrepierna, la curva del tiro lleva la costura del medio
// hacia atrás en CROTCH_CURVE.
const CORNER = 0.02;
const INNER_N = 2;
const CROTCH_CURVE = 0.06;
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
// CROTCH_SPAN de arriba de la entrepierna el centro se corre CORNER hacia
// afuera, con el borde de afuera en su lugar, y el lado de adentro llega al
// medio justo en la entrepierna; más abajo, cada pierna sola, apenas
// separada de la otra.
function section(S, y) {
  const U = S.outline(y);
  const pull = smooth(clamp01((y - (SHORT.waist - WAIST_EASE)) / WAIST_EASE));
  const A = Math.min(U.A, S.full.A - WAIST_IN.a * pull);
  const F = Math.min(U.F, S.full.F - WAIST_IN.d * pull);
  const B = Math.min(U.B, S.full.B - WAIST_IN.d * pull);
  const s = smooth(clamp01((SHORT.crotch + CROTCH_SPAN - y) / CROTCH_SPAN));
  const b = clamp01((SHORT.crotch - y) / (SHORT.crotch - SHORT.hem));
  const inner = y > SHORT.crotch ? 0 : (HEM_GAP / 2) * b ** 1.2;
  const sx = inner + CORNER * s;
  // La costura del medio, en la curva del tiro: de adelante (q = 1) hacia
  // atrás hasta la entrepierna (q = 0), donde se cierra la pierna; el ancho de
  // adentro `si` hace que el lado de adentro la cruce justo ahí (más arriba,
  // plano: infinito).
  const q = clamp01((y - SHORT.crotch) / CROTCH_CURVE);
  const g = (1 - (1 - (1 - q) ** 2) ** INNER_N) ** (1 / INNER_N);
  return { sx, oa: A, sa: A - sx, si: g > 1e-4 ? (sx - inner) / g : FLAT, sbF: F, sbB: B, n: S.n, ni: INNER_N };
}
// Punto de la sección para el ángulo t (π/2 adelante, 0 afuera, -π/2 atrás).
// (Sin `si` ni `ni`, la superelipse es la misma de los dos lados.) Con `oa`,
// el lado de afuera es el contorno entero (centrado en 0, medio ancho oa)
// desde x = sx, y el de adentro baja desde ahí (hondo `innerDepth`): las
// piernas siguen el contorno de la cadera (corridas, se abultaban en
// diagonal).
function sectionPoint(c, t) {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const b = st >= 0 ? c.sbF : c.sbB;
  if (c.oa !== undefined) {
    if (ct >= 0) {
      const e = 2 / c.n;
      const tc = Math.acos(Math.min(1, c.sx / c.oa) ** (c.n / 2));
      const u = Math.atan2(Math.abs(st), ct) * (tc / (Math.PI / 2));
      return [c.oa * Math.cos(u) ** e, Math.sign(st) * b * Math.sin(u) ** e];
    }
    const e = 2 / c.ni;
    return [c.sx + c.si * spow(ct, e), innerDepth(c, b) * spow(st, e)];
  }
  const e = 2 / (ct >= 0 ? c.n : c.ni ?? c.n);
  return [c.sx + (ct >= 0 ? c.sa : c.si ?? c.sa) * spow(ct, e), b * spow(st, e)];
}
const innerDepth = (c, b) => b * (1 - Math.min(1, c.sx / c.oa) ** c.n) ** (1 / c.n);
// Hacia afuera de la sección en (sx + dx, dz): su gradiente (sin largo
// fijo).
function sectionGrad(c, dx, dz) {
  const b = dz >= 0 ? c.sbF : c.sbB;
  if (c.oa !== undefined) {
    if (dx >= 0) return [spow((c.sx + dx) / c.oa, c.n - 1) / c.oa, spow(dz / b, c.n - 1) / b];
    const bi = innerDepth(c, b);
    return [spow(dx / c.si, c.ni - 1) / c.si, spow(dz / bi, c.ni - 1) / bi];
  }
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
// coinciden en las costuras. `k` achica todo (colgado, el short va plano) y
// `under(y)`, la camiseta encima: ahí no hay frunce (no se ve y la haría
// asomar).
const GATHER = 0.0028; // hondo del frunce en la cintura
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
      // (El frunce, sólo hacia afuera: hacia adentro pasaba detrás del
      // dobladillo de la cintura y se veía su revés, como tajos.)
      const ripple = 0.5 + 0.5 * (0.6 * Math.sin((2 * Math.PI * u) / 0.013) + 0.4 * Math.sin((2 * Math.PI * u) / 0.0085 + 1.7));
      const d = k * (1 - under(pos[v * 3 + 1])) * GATHER * band * ripple;
      if (!d) continue;
      const c = secOf(pos[v * 3 + 1]);
      const [gx, gz] = sectionGrad(c, pos[v * 3] - c.sx, pos[v * 3 + 2] - z0);
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
// El ancho de cada fila colgada: de la cintura hasta donde las piernas se
// empiezan a separar, el de la tela plana con el volumen de siempre (el
// costado se abre de la cintura a la cadera); de ahí hasta el ruedo, derecho
// (Demian: «que caiga recto»). Cada fila mide lo mismo que puesta: lo que
// sobra o falta lo toma el volumen (la pierna, que da más vuelta que la
// mitad de la cadera, cuelga como un tubo achatado). (Con el costado derecho
// desde la cintura, el volumen iba y venía y el short se veía en franjas.)
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
  const widths = Array.from({ length: ROWS + 1 }, (_, r) => (r >= rTop ? free(r) : 0));
  const oT = widths[rTop];
  const out = [];
  for (let r = 0; r <= ROWS; r++) {
    const y = rowY(r);
    const len = rowLen(r);
    const outer = r >= rTop ? widths[r] : oT;
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
  // (En las piernas, el volumen no baja del de la cadera: un pozo justo
  // arriba de la entrepierna era otra franja.)
  for (let r = 0; r < rTop; r++) if (out[r].sbF < out[rTop].sbF) out[r] = { ...out[r], sbF: out[rTop].sbF, sbB: out[rTop].sbF };
  const outerS = avg((c) => c.sx + c.sa, HUNG_SMOOTH);
  const tS = avg((c) => c.sbF, HUNG_SMOOTH);
  return out.map((_, r) => hungSection(rowY(r), outerS[r], tS[r]));
}
const HUNG_SMOOTH = 12; // filas a cada lado
const CLIP_IN = 0.016; // los broches, a esto del doblez de cada costado
const CLIP = { width: 0.03, depth: 0.012 };

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
  } else gather(base, W, uvPiece, secOf, 0, 1, (y) => 1 - smooth(clamp01((S.hemY - y) / 0.02)));
  const parts = {};
  const c0 = COLS / 2;
  const waistV = (WAIST_ROWS / ROWS) * (SHORT.waist - SHORT.hem);
  for (const [key, side] of [
    ['L', 1],
    ['R', -1],
  ]) {
    const pos = Float32Array.from(base);
    if (side < 0) for (let v = 0; v < pos.length; v += 3) pos[v] = -pos[v];
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
    const z0 = hung ? hung.z : 0;
    const out = (x, y, z) => {
      const c = secOf(y);
      const [gx, gz] = sectionGrad(c, side * x - c.sx, z - z0);
      return [gx * side, 0, gz];
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
