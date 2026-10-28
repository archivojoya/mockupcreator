// Camiseta deportiva de cuello redondo o en V, modelada con código (sin moldes ni
// simulación). La forma es la de una prenda puesta sobre un cuerpo invisible:
//
// - Torso: anillos horizontales (cortes superelípticos) desde el ruedo hasta
//   el escote. Cerca del escote cada columna se curva hacia el contorno del
//   cuello; a los costados esa curva es la línea del hombro.
// - Sisas: un hueco en la grilla del torso a cada lado, deformado hasta
//   quedar ovalado. Las mangas arrancan exactamente de su borde.
// - Mangas: de la sisa a un ruedo circular alrededor del eje del brazo, con
//   puño aparte. La musculosa no tiene: lleva un puño (tira doble) cosido al
//   borde de cada sisa.
// - Cuello: el escote es un corte sobre la misma tela (la de la camiseta de
//   cuello redondo de referencia): redondo de cualquier hondo o en V, la
//   camiseta y su molde son los mismos y sólo cambia la línea del corte.
//   Encima va una tira de la misma tela (en V, las dos puntas se juntan
//   en una costura al medio). Ruedo y puños llevan un dobladillo hacia
//   adentro (se ve el espesor de la tela).
//
// Medidas en metros, y hacia arriba, z hacia el frente; y = 0 es el punto
// más alto del hombro (junto al cuello). Las coordenadas UV de cada pieza
// están en metros sobre la tela, listas para estampar un diseño.

import * as THREE from 'three';

export const DEFAULTS = {
  fit: 0.15, // 0 ajustada · 0.5 regular · 1 holgada
  length: 0.62, // del hombro al ruedo
  sleeveLength: 0.18, // de la punta del hombro al ruedo de la manga
  sleeveAngle: 30, // apertura de las mangas, grados desde la vertical
  neckDepth: 0.075, // profundidad del escote delantero
  neckStyle: 'round', // 'round' redondo · 'v' en V
  cuff: 'band', // 'band' con puño · 'none' sin puño (la manga sigue hasta el borde)
  garment: 'tee', // 'tee' camiseta · 'ftee' remera femenina · 'tank' tank top (de mujer, espalda nadadora) · 'tunic' remerón de danza (de mujer, largo)
  short: true, // con cuerpo, el short de fútbol debajo (ver shorts.js)
  slit: 0.2, // remerón: alto de la abertura de cada costado, desde el ruedo (0, sin abertura)
};

// Resolución de las mallas.
const COLS = 64; // columnas de cada mitad del torso (de costado a costado)
const ARM_COLS = 10; // columnas de la sisa a cada lado de la costura
const NECK_SPAN = 2.2; // desde cuánto más abajo que el corte se reacomodan las filas del escote
const SHOULDER_CUT = 0.02; // sin mangas: cuánto más angosto queda el hombro
const SHOULDER_SPREAD = 2; // en cuántos anchos de la sisa (desde la costura) se apaga ese corrimiento
const SHOULDER_TOP_E = 4; // exponente de la mitad de arriba de la sisa sin mangas (2 = redonda)
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
// (La musculosa y la de básquet se sacaron el 27 de octubre: no se parecían a
// la camiseta. Se rehacen partiendo de ella; la de básquet, de su molde. El
// puño de la sisa sin manga, que llevaban, queda para ellas.)
// Tank top (de mujer): cuerpo con busto, cintura y cadera; escote redondo
// ancho y hondo adelante y alto atrás; tiras de 4,2 cm en el hombro; espalda
// nadadora (las sisas de atrás, en C, dejan una columna en el centro); vivos
// finos en el escote y las sisas.
// Remera femenina: el cuerpo del remerón (abajo) con el largo de la
// camiseta, recto de la cadera al ruedo y sin aberturas; la caída, la de la
// camiseta.
// Remerón de danza (de mujer): la camiseta con mangas y cuello redondo sobre
// un cuerpo con busto, cintura y cadera, hombros más angostos, largo hasta
// arriba de la rodilla y casi recto de la cadera al ruedo, con pliegues que
// bajan de la cadera y una abertura en cada costado (ver buildTorso).
const NECK_REF = 0.075; // escote de referencia (ver measures)
const ARM_BAND = 0.024; // ancho del puño de la sisa
const ARM_RISE = 0.0011; // con cuerpo, lo que el puño queda por encima de la tela
const ARM_WRAP = 0.0015; // y lo que su vuelta pasa del borde
const ARM_STEP = 0.002; // paso con que se recorre la tela debajo del puño
const TANK = {
  neck: { a: 0.1, b: 0.075, bB: 0.04, c: -0.012 },
  dropB: 0.04, // escote de atrás
  strap: 0.042, // ancho de las tiras en el hombro
  racerTop: 0.065, // de ahí la sisa de atrás baja hasta la columna del centro, a esto del escote
  racerGap: 0.05, // tramo vertical de la columna del centro
  binding: 0.009, // ancho de los vivos
  colsF: 14, // columnas de la sisa en el frente y en la espalda
  colsB: 26,
};
const TUNIC = {
  hipY: -0.6, // altura de la cadera (de ahí se abre hasta el ruedo)
  flareA: 0.008, // cuánto se abre hacia el ruedo, a lo ancho y de fondo (por metro de largo)
  flareB: 0.0033,
  folds: 9, // pliegues alrededor (del ruedo a la cadera)
  fold: 0.009, // y su hondo en el ruedo
  slitOpen: 0.147, // cuánto se separa cada borde de la abertura en el ruedo (radianes alrededor del cuerpo: unos 5 cm entre los bordes)
};
export function measures(p) {
  const f = p.fit;
  const L = p.length;
  const garment = ['ftee', 'tank', 'tunic'].includes(p.garment) ? p.garment : 'tee';
  const sleeveless = garment === 'tank';
  const tank = garment === 'tank';
  const tunic = garment === 'tunic';
  const fem = tunic || garment === 'ftee'; // cuerpo de mujer con mangas
  const M = {
    L,
    fit: f,
    // Contorno del cuello en el hombro: medio ancho, fondo hacia adelante y
    // hacia atrás desde los hombros (atrás es casi plano, como un escote real:
    // colgada, si no, la espalda del cuello cuelga en U detrás de la percha),
    // y centro.
    neck: tank ? TANK.neck : { a: 0.088, b: 0.08, bB: 0.035, c: -0.014 },
    dropF: p.neckDepth,
    dropB: tank ? TANK.dropB : 0.014,
    // Escote de referencia: la tela de todas las camisetas es la de cuello
    // redondo con este escote, y cada cuello (redondo de cualquier hondo o en
    // V) es un corte sobre ella. El tank top tiene su propia tela.
    refF: tank ? p.neckDepth : NECK_REF,
    vNeck: !tank && p.neckStyle === 'v',
    // Escote hondo (tank top): el borde va apoyado sobre el pecho y la
    // espalda, no se mete hacia el cuello.
    deepNeck: tank,
    shY: -0.046, // altura de la punta del hombro
    pitY: (tank ? -0.26 : -0.205) - 0.03 * f, // altura de la axila
    n: 2.35, // exponente de los cortes (2 = elipse)
    garment,
    sleeveless,
    armBand: tank ? TANK.binding : ARM_BAND,
    armCols: tank ? TANK.colsF : ARM_COLS,
    armColsB: tank ? TANK.colsB : ARM_COLS,
    racer: tank,
    strap: TANK.strap,
    racerTop: TANK.racerTop,
    racerGap: TANK.racerGap,
    // Busto: altura y separación de las puntas, relieve y caída arriba y
    // abajo (más suelta, menos relieve y cae más derecho).
    // (En el remerón, la tela es más suelta: menos relieve y cae más derecho.)
    bust: tank
      ? { x: 0.085, y: -0.245, h: 0.042 * (1 - 0.4 * f), sx: 0.045, sUp: 0.12, sDown: 0.05 + 0.07 * f }
      : fem
        ? { x: 0.085, y: -0.245, h: 0.034 * (1 - 0.4 * f), sx: 0.05, sUp: 0.12, sDown: 0.09 + 0.06 * f }
        : null,
    flare: tunic ? { y0: -Math.min(-TUNIC.hipY, L - 0.12), n: TUNIC.folds, h: TUNIC.fold * (1 + f), slit: Math.min(Math.max(0, p.slit ?? DEFAULTS.slit), L - 0.25) } : null,
  };
  const shA = tank ? M.neck.a + TANK.strap : fem ? 0.196 + 0.03 * f : 0.214 + 0.032 * f; // medio ancho de hombros
  if (tank || fem) M.shY = (-0.046 * (shA - M.neck.a)) / (0.214 - M.neck.a);
  const aC = 0.176 + 0.046 * f; // medio ancho y media profundidad del pecho
  const bC = 0.112 + 0.022 * f;
  // Tank top: pecho (sin el busto), cintura y cadera.
  const aB = 0.152 + 0.04 * f;
  const bB = 0.1 + 0.02 * f;
  const aW = lerp(0.128, 0.162, f);
  const bW = 0.088 + 0.02 * f;
  const aH = 0.168 + 0.035 * f;
  const bH = 0.1 + 0.02 * f;
  // Remerón y remera femenina: pecho (sin el busto), cintura, cadera y, de
  // ahí al ruedo, el remerón se abre parejo (a lo ancho más que de fondo).
  const tunicRows = () => {
    const aT = 0.168 + 0.04 * f;
    const bT = 0.104 + 0.02 * f;
    const tip = [M.shY, shA, 0.09 + 0.01 * f, -0.008];
    const mid = [M.shY / 2, lerp(M.neck.a, shA, 0.5), lerp(M.neck.b, tip[2], 0.5), lerp(M.neck.c, -0.008, 0.5)];
    const below = [-0.115, Math.max(shA - 0.008, aT + 0.006), bT - 0.006, 0];
    // Remera femenina: de la cintura se abre parejo hasta la cadera (a lo
    // ancho; de fondo apenas, si no hace panza de perfil) y de ahí cae
    // derecha.
    const yHf = -Math.min(L, 0.62);
    const hipF = [0.178 + 0.03 * f, 0.104 + 0.016 * f];
    // Y su cintura, 6 mm más adentro de cada lado que la del remerón (Demian:
    // «un poquitito más de forma»).
    const waistIn = tunic ? 0 : 0.006;
    const lower = tunic
      ? (() => {
          const yH = -Math.min(-TUNIC.hipY, L - 0.12);
          const aHt = 0.182 + 0.03 * f;
          const bHt = 0.114 + 0.016 * f;
          const open = (y) => [y, aHt + TUNIC.flareA * (yH - y), bHt + TUNIC.flareB * (yH - y), -0.006];
          return [open(-L - 0.2), open(-L), [yH, aHt, bHt, -0.004]];
        })()
      : [[-L - 0.2, ...hipF, -0.004], [-L, ...hipF, -0.004], ...(L > 0.63 ? [[yHf, ...hipF, -0.004]] : [])];
    return [
      ...lower,
      [-0.4, 0.16 + 0.03 * f - waistIn, 0.099 + 0.016 * f, 0.004],
      [-0.31, aT - 0.004, bT - 0.006, 0.006],
      [M.pitY, aT, bT, 0.006],
      below,
      ...shoulderRows(M, below, tip, mid),
      mid,
      [0, M.neck.a, M.neck.b, M.neck.c],
    ];
  };
  const rows = fem
    ? tunicRows()
    : tank
    ? [
        [-L - 0.2, aH, bH, 0],
        [-L, aH, bH, 0],
        [-0.56, aH - 0.004, bH, 0],
        [-0.4, aW, bW, 0.004],
        [Math.min(-0.3, M.pitY - 0.04), aW + 0.012, bW + 0.008, 0.006],
        [M.pitY, aB, bB, 0.008],
        [-0.11, aB - 0.008, bB - 0.012, 0],
        [M.shY, shA, 0.082, -0.008],
        [M.shY / 2, lerp(M.neck.a, shA, 0.5), lerp(M.neck.b, 0.082, 0.5), lerp(M.neck.c, -0.008, 0.5)],
        [0, M.neck.a, M.neck.b, M.neck.c],
      ]
    : [
        // y, medio ancho, media profundidad, centro z
        [-L - 0.2, aC + 0.012 * f, bC - 0.004 + 0.004 * f, 0],
        [-L, aC + 0.012 * f, bC - 0.004 + 0.004 * f, 0],
        [-0.44, aC - 0.008 + 0.006 * f, bC - 0.008, 0.004],
        [M.pitY, aC, bC, 0.006],
        [-0.115, Math.max(shA - 0.008, aC + 0.006), bC - 0.006, 0],
        ...shoulderRows(M, [-0.115, Math.max(shA - 0.008, aC + 0.006), bC - 0.006, 0], [M.shY, shA, 0.098 + 0.01 * f, -0.008], [M.shY / 2, lerp(M.neck.a, shA, 0.5), lerp(M.neck.b, 0.098 + 0.01 * f, 0.5), lerp(M.neck.c, -0.008, 0.5)]),
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
  const pit = rows.find((r) => r[0] === M.pitY);
  const zPit = pit[3] - pit[2];
  const zNeck = M.neck.c - M.neck.bB;
  M.sbB = monotone(
    ys,
    rows.map((r) => (r[0] <= pit[0] ? r[2] : r[3] - lerp(zPit, zNeck, (r[0] - pit[0]) / -pit[0]))),
  );
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

// Punta del hombro: con mangas, una fila (el costado sube casi vertical y
// ahí dobla hacia el cuello, bajo la costura de la manga). Sin mangas el borde
// de la sisa cruza esa zona: se redondea con un arco de SHOULDER_R que empalma
// el costado (desde la fila de abajo) con la línea del hombro (hacia la de
// arriba); medio ancho, fondo y centro de cada fila del arco, interpolados.
const SHOULDER_R = 0.03;
function shoulderRows(M, below, tip, above) {
  if (!M.sleeveless) return [tip];
  const dir = (a, b) => {
    const l = Math.hypot(b[1] - a[1], b[0] - a[0]);
    return [(b[1] - a[1]) / l, (b[0] - a[0]) / l]; // (x, y)
  };
  const u1 = dir(below, tip);
  const u2 = dir(tip, above);
  const turn = Math.acos(u1[0] * u2[0] + u1[1] * u2[1]);
  const T = SHOULDER_R * Math.tan(turn / 2);
  const n1 = [-u1[1], u1[0]];
  const start = [tip[1] - u1[0] * T, tip[0] - u1[1] * T];
  const O = [start[0] + n1[0] * SHOULDER_R, start[1] + n1[1] * SHOULDER_R];
  const rows = [];
  for (let k = 0; k <= 4; k++) {
    const a = (turn * k) / 4;
    const x = O[0] - n1[0] * SHOULDER_R * Math.cos(a) + u1[0] * SHOULDER_R * Math.sin(a);
    const y = O[1] - n1[1] * SHOULDER_R * Math.cos(a) + u1[1] * SHOULDER_R * Math.sin(a);
    const [r0, r1] = y <= tip[0] ? [below, tip] : [tip, above];
    const f = (y - r0[0]) / (r1[0] - r0[0]);
    rows.push([y, x, lerp(r0[2], r1[2], f), lerp(r0[3], r1[3], f)]);
  }
  return rows;
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

// Altura del escote redondo: baja al frente y apenas atrás. Con el exponente
// la curva llega plana al punto del hombro (sin pico donde se juntan frente y
// espalda). (La camiseta lo corta con cutY; neckY lo usa el tank top.)
const neckY = (M, th) => {
  const c = Math.cos(th);
  return -(c >= 0 ? M.dropF : M.dropB) * Math.abs(c) ** 1.6;
};
// El escote de referencia (redondo, ver measures), hasta donde llega la tela
// de base.
const refY = (M, th) => {
  const c = Math.cos(th);
  return -(c >= 0 ? M.refF : M.dropB) * Math.abs(c) ** 1.6;
};

// Busto (tank top): la tela pasa por encima de los dos pechos y entre ellos
// sin meterse (pareja entre las puntas) y abajo cae; se apaga hacia los
// costados (`side`: 1 al frente, 0 en la costura).
export function bust(M, x, y, side = 1) {
  const B = M.bust;
  if (!B) return 0;
  const ax = Math.abs(x);
  const across = ax <= B.x ? 1 : Math.exp(-(((ax - B.x) / B.sx) ** 2));
  const dy = y - B.y;
  return B.h * across * Math.exp(-((dy / (dy >= 0 ? B.sUp : B.sDown)) ** 2)) * smoothstep(0, 0.35, side);
}

// Frente del torso (sin la curva hacia el cuello) en el punto de ancho x y
// altura y: el corte superelíptico a esa altura (con el busto).
function chestZ(M, x, y) {
  const a = M.sa(y);
  const r = Math.min(1, Math.abs(x) / a) ** M.n;
  return M.sc(y) + M.sb(y) * (1 - r) ** (1 / M.n) + bust(M, x, y);
}
// Lo mismo en la espalda.
function backZ(M, x, y) {
  const a = M.sa(y);
  const r = Math.min(1, Math.abs(x) / a) ** M.n;
  return M.sc(y) - M.sbB(y) * (1 - r) ** (1 / M.n);
}

// Punto del torso para el ángulo th (0 frente, π/2 costado izquierdo, π
// espalda) y t (0 ruedo, 1 escote de referencia). Más allá de 1 la tela sigue
// hacia arriba por el cuello (ver NECK_EXT_R): de ahí sale lo que un escote
// tiene por encima del de referencia (un redondo más alto, las patas de la V
// junto al hombro).
function torsoPoint(M, th, t, out) {
  const cs = Math.cos(th);
  if (!M.vNeck || cs <= 0) return torsoBase(M, th, t, out);
  // Cuello en V: en el último tramo hacia el escote de referencia
  // (VEE_FLAT_U del recorrido de la curva hacia el cuello: unos 8 mm de alto
  // en el medio) la tela de referencia se curva hacia el cuello casi
  // horizontal. En el redondo la tapa la tira parada; en la V quedaba a la
  // vista bajo la punta y las patas, como una hundidura. Ahí la tela de la V
  // sigue derecha, con la dirección que traía (del todo en el medio, nada en
  // el hombro). El molde de estampado no cambia (sale del redondo).
  const del = lerp(-M.shY, 0.075, cs * cs);
  const t0 = 1 - (VEE_FLAT_U * del) / (refY(M, th) + M.L);
  if (t <= t0) return torsoBase(M, th, t, out);
  const h = 1e-4;
  const a = torsoBase(M, th, t0, [0, 0, 0]);
  const b = torsoBase(M, th, t0 - h, [0, 0, 0]);
  torsoBase(M, th, t, out);
  const g = cs * cs;
  for (let c = 0; c < 3; c++) out[c] = lerp(out[c], a[c] + ((a[c] - b[c]) / h) * (t - t0), g);
  return out;
}
const VEE_FLAT_U = 0.27;
function torsoBase(M, th, t, out) {
  if (t > 1) return torsoAbove(M, th, t, out);
  const yn = refY(M, th);
  const y = lerp(-M.L, yn, t);
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  const e = 2 / M.n;
  let x = M.sa(y) * spow(sn, e);
  let z = M.sc(y) + (cs >= 0 ? M.sb(y) : M.sbB(y)) * spow(cs, e);
  if (cs > 0) z += bust(M, x, y, cs);
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
    // Escote hondo (tank top): el borde va apoyado sobre el pecho y la
    // espalda, no se mete hacia el cuello.
    if (M.deepNeck && cs > 0) z = Math.max(z, chestZ(M, x, yy));
    if (M.deepNeck && cs < 0) z = Math.min(z, backZ(M, x, yy));
  }
  out[0] = x;
  out[1] = yy;
  out[2] = z;
  return out;
}
// Por encima del escote de referencia: la columna sigue desde su punta con la
// misma dirección y velocidad y dobla hacia arriba (radio NECK_EXT_R) hasta
// subir derecho, pegada al cuello. Mientras dobla, su rumbo horizontal gira
// hacia el eje del cuello (perpendicular al contorno): así las columnas no se
// juntan en el medio.
const NECK_EXT_R = 0.012;
const NECK_EXT_RV = 0.003;
function torsoAbove(M, th, t, out) {
  const h = 1e-4;
  const p1 = torsoBase(M, th, 1, [0, 0, 0]);
  const p0 = torsoBase(M, th, 1 - h, [0, 0, 0]);
  const T = [(p1[0] - p0[0]) / h, (p1[1] - p0[1]) / h, (p1[2] - p0[2]) / h];
  const v = Math.hypot(...T) || 1e-9;
  const s = (t - 1) * v;
  const R = M.vNeck ? NECK_EXT_RV : NECK_EXT_R;
  const c0 = Math.min(1, Math.max(-1, T[1] / v));
  const phi0 = Math.acos(c0);
  // Rumbo horizontal: el de la columna al salir, el del contorno al terminar
  // de doblar.
  const ha = Math.atan2(T[2], T[0]);
  let hb = Math.atan2(-Math.cos(th) / (Math.cos(th) >= 0 ? M.neck.b : M.neck.bB), -Math.sin(th) / M.neck.a);
  hb = ha + Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha));
  const steps = 24;
  const ds = Math.min(s, R * phi0) / steps;
  out[0] = p1[0];
  out[1] = p1[1];
  out[2] = p1[2];
  for (let k = 0; k < steps; k++) {
    const phi = Math.acos(c0) - ((k + 0.5) * ds) / R;
    const el = Math.PI / 2 - Math.max(0, phi); // elevación del rumbo
    const az = lerp(ha, hb, smooth(phi0 > 1e-6 ? 1 - Math.max(0, phi) / phi0 : 1));
    out[0] += ds * Math.cos(el) * Math.cos(az);
    out[1] += ds * Math.sin(el);
    out[2] += ds * Math.cos(el) * Math.sin(az);
  }
  out[1] += Math.max(0, s - R * phi0);
  return out;
}
// t en que la columna th (desde t0 hacia el cuello) llega al medio ancho x.
function tAtX(M, th, t0, x) {
  const P = [0, 0, 0];
  let lo = t0;
  let hi = 1;
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (Math.abs(torsoPoint(M, th, mid, P)[0]) > x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
// Escote del frente visto de frente: la altura del corte a la distancia ax
// del centro (cada cuello, con el mismo ancho en el hombro). Fuera del cuello
// no corta nada. La V es el redondo con las patas algo más rectas: su curva
// mezclada con la recta de cada punto del hombro a la punta, que queda en el
// medio y al mismo hondo (la tira lleva ahí una costura, ver seamMarks). La
// prenda es la del redondo (salvo el último tramo hacia el cuello, ver
// torsoPoint) y la tira va acostada (ver buildCollar). (Una V honda cortada en la
// tela de referencia pasa por donde esa tela se curva hacia el cuello: se
// hundía, se caía colgada y la tira se armaba mal en la punta.) Junto al
// hombro se redondea el último pedacito de la recta.
const VEE_EASE = 0.08; // fracción del ancho que se redondea junto al hombro
const VEE_STRAIGHT = 0.4; // cuánto de la recta llevan las patas (0 = redondo, 1 = rectas)
// El escote de referencia visto de frente (el redondo de NECK_REF).
const refCutY = (M, ax) => -M.refF * (1 - Math.min(1, ax / M.neck.a) ** 2) ** 0.8;
const NECK_LIE = 0.03; // cuánto más abajo que la referencia la tira va del todo acostada
const VEE_LIE = [0.5, 0.8]; // en V, entre qué fracciones del ancho del cuello la tira pasa de acostada a parada
const cutY = (M, ax) => {
  const r = Math.min(1, ax / M.neck.a);
  const round = (1 - r * r) ** 0.8;
  if (!M.vNeck) return -M.dropF * round;
  const u = 1 - r;
  const e = VEE_EASE;
  const straight = (u < e ? (u * u) / (2 * e) : u - e / 2) / (1 - e / 2);
  return -M.dropF * (round + VEE_STRAIGHT * (straight - round));
};
// Dónde corta el escote la columna de ángulo th del frente: el t en que la
// columna llega a la línea del corte (menos de 1 si pasa más abajo que el de
// referencia, más si pasa más arriba). Atrás no cambia.
function neckT(M, th) {
  const c = Math.cos(th);
  if (c < 1e-9 || (!M.vNeck && M.dropF === M.refF)) return 1;
  const P = [0, 0, 0];
  const f = (t) => torsoPoint(M, th, t, P)[1] - cutY(M, Math.abs(P[0]));
  let lo = 0.5;
  let hi = 1.5;
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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
  if (M.racer) return buildRacerTorso(M);
  const N = ROWS_LOW + ROWS_ARM + ROWS_TOP;
  const tPit = (M.pitY + M.L) / M.L;
  const tSh = (M.shY + M.L) / M.L;
  // Sin mangas el hombro queda SHOULDER_CUT más angosto: la tela es la misma
  // y la sisa sube por ella hacia el cuello, arriba eso y nada en la axila
  // (las filas de arriba se apretan hacia el escote). Agrandar el óvalo de la
  // sisa lo dejaba en punta: arriba de la punta del hombro la tela rinde tres
  // veces más por cada t.
  const lift0 = M.sleeveless ? tAtX(M, Math.PI / 2, tSh, M.shA - SHOULDER_CUT * Math.cos(Math.atan2(-M.shY, M.shA - M.neck.a))) - tSh : 0;
  const lift = (th, t) => {
    if (!lift0 || t <= tPit) return t;
    const d = Math.abs(Math.atan2(Math.sin(th - Math.PI / 2), Math.cos(th - Math.PI / 2)));
    // Parejo en todo el ancho de la sisa (arriba el borde cruza el hombro
    // derecho, de frente a espalda; si fuera más en la costura, haría un pico
    // hacia el cuello) y se apaga hacia el frente y la espalda.
    const e = (Math.min(d, Math.PI - d) / dTh - 1) / (SHOULDER_SPREAD - 1);
    if (e >= 1) return t;
    const k = e <= 0 ? lift0 : lift0 * Math.cos((Math.PI / 2) * e) ** 2;
    return t <= tSh ? t + k * smooth((t - tPit) / (tSh - tPit)) : t + (k * (1 - t)) / (1 - tSh);
  };
  // Hasta dónde llega el hombro (medio ancho y altura).
  [M.shTip, M.shTipY] = torsoPoint(M, Math.PI / 2, tSh + lift0, [0, 0, 0]);
  const tRow = (i) => {
    if (i <= ROWS_LOW) return (tPit * i) / ROWS_LOW;
    if (i <= ROWS_LOW + ROWS_ARM) return lerp(tPit, tSh, (i - ROWS_LOW) / ROWS_ARM);
    return lerp(tSh, 1, (i - ROWS_LOW - ROWS_ARM) / ROWS_TOP);
  };
  const i1 = ROWS_LOW;
  const i2 = ROWS_LOW + ROWS_ARM;
  const A = M.armCols;
  const dTh = (A * Math.PI) / COLS;
  const tc = (tPit + tSh) / 2;
  const dT = (tSh - tPit) / 2;
  // Las sisas son huecos rectangulares en la grilla; alrededor de cada una
  // los parámetros se deforman para que el borde quede ovalado.
  const warp = (th, t, thc) => {
    const p = (th - thc) / dTh;
    const q = (t - tc) / dT;
    const rho = Math.max(Math.abs(p), Math.abs(q));
    // Sin mangas, la mitad de arriba más cuadrada (ver lift).
    const m = lift0 && q > 0 ? SHOULDER_TOP_E : 2;
    const r = (Math.abs(p) ** m + Math.abs(q) ** m) ** (1 / m);
    if (rho >= 2.4 || r < 1e-9) return [th, t];
    // Sin tocar el escote (la fila de arriba sigue en t = 1).
    const top = q > 0 ? clamp01((1 - t) / (1 - tSh)) : 1;
    const k = lerp(1, rho / r, (1 - smoothstep(1, 2.4, rho)) * top);
    return [thc + p * k * dTh, tc + q * k * dT];
  };
  // Abertura del remerón: en cada costado, del ruedo hasta `slit` más arriba,
  // frente y espalda dejan de estar cosidos. Cada pieza se angosta un poco
  // alrededor del cuerpo (parejo en toda la fila) y sus bordes se separan en
  // línea recta: un triángulo, cerrado arriba y de unos 5 cm en el ruedo
  // (Demian: «primero el corte y después la costura»; curvo, casi no se abría
  // hasta abajo). El molde de estampado sale de la pieza sin abrir (ver
  // flattenPrint).
  const slit = M.flare ? M.flare.slit : 0;
  const tSlit = slit / M.L; // en el costado el escote no baja: y = -L + t·L
  const slitOpen = (t) => (t < tSlit ? (TUNIC.slitOpen * (tSlit - t)) / tSlit : 0);
  const panels = {};
  for (const key of ['front', 'back']) {
    const th0 = key === 'front' ? -Math.PI / 2 : Math.PI / 2;
    const W = COLS + 1;
    const pos = new Float32Array(W * (N + 1) * 3);
    const ang = new Float32Array(W * (N + 1));
    const tmp = [0, 0, 0];
    // Escote: cada columna termina donde la corta (neckT). Sus filas se
    // corren sólo arriba, desde tA (nunca más abajo que la punta del hombro,
    // ni que dos veces lo que cambia el escote): debajo la tela es la misma
    // con cualquier cuello.
    const cut = [];
    for (let j = 0; j <= COLS; j++) {
      const t1 = neckT(M, th0 + (Math.PI * j) / COLS);
      cut.push([t1, 1 - Math.max(1 - tSh, NECK_SPAN * (1 - t1))]);
    }
    const reach = (t, j) => {
      const [t1, tA] = cut[j];
      return t1 === 1 || t <= tA ? t : t + (t1 - 1) * smooth((t - tA) / (1 - tA));
    };
    // t de cada punto antes y después del corte (para sacar el molde del de
    // referencia, ver flattenPrint).
    const tw = new Float32Array(W * (N + 1));
    const tv = new Float32Array(W * (N + 1));
    if (cut.some(([t1]) => t1 !== 1)) M.cutNeck = true;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= COLS; j++) {
        let th = th0 + (Math.PI * j) / COLS;
        let t = tRow(i);
        if (slit) {
          const o = slitOpen(t);
          th = th0 + o + ((Math.PI - 2 * o) * j) / COLS;
        }
        [th, t] = warp(th, t, th0);
        [th, t] = warp(th, t, th0 + Math.PI);
        t = lift(th, t);
        const k = i * W + j;
        tw[k] = t;
        tv[k] = reach(t, j);
        torsoPoint(M, th, tv[k], tmp);
        pos.set(tmp, k * 3);
        ang[k] = th;
      }
    }
    // Celdas: todas menos las de las sisas.
    const idx = [];
    const hole = (i, j) => i >= i1 && i < i2 && (j < A || j >= COLS - A);
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
    panels[key] = { pos, ang, idx, W, N, tw, tv };
  }
  // Filas que quedan abiertas en los costados (desde el ruedo).
  let slitRows = 0;
  while (slit && tRow(slitRows + 1) < tSlit) slitRows++;
  return { panels, i1, i2, N, armCols: A, armColsB: A, slitRows: slit ? slitRows + 1 : 0 };
}

// Torso del tank top (espalda nadadora). La sisa es otra vez un hueco
// rectangular en la grilla, pero de AF columnas en el frente y AB en la
// espalda, y las filas no van a la misma altura en todas las columnas. En el
// frente la de arriba de la sisa queda a `strap` del escote y la de la axila
// va derecha. En la espalda (escote alto, casi plano) el borde de arriba baja
// desde el hombro hasta `racerTop` debajo del escote donde se juntan las
// tiras, el de abajo sube desde la axila hasta `racerGap` más abajo, y entre
// los dos queda la columna del centro. Las esquinas del hueco se redondean en
// la grilla (superelipse) antes de ubicar cada punto.
const RACER_E = 2.2;
const RACER_C = 0.99; // qué tan vertical llegan los bordes de atrás a la unión (1 = del todo)
const RACER_K = 0.4; // cuánto de elipse lleva el borde de arriba (0 = recto)
const RACER_KB = 0.6; // y el de abajo
const RACER_SMOOTH = 0.016; // radio con que se promedia el borde de la C de atrás
const RACER_ROUND = 0.012; // radio con que se redondea el borde sobre el hombro
const RACER_D = 0.6; // columnas que se curva hacia afuera en las puntas el tramo vertical
function buildRacerTorso(M) {
  const N = ROWS_LOW + ROWS_ARM + ROWS_TOP;
  const i1 = ROWS_LOW;
  const i2 = ROWS_LOW + ROWS_ARM;
  const AF = M.armCols;
  const AB = M.armColsB;
  const L = M.L;
  // Por ángulo desde el centro del frente (0) hasta el de la espalda (π):
  // parámetro de la axila y del borde de arriba de la sisa.
  const S = 128;
  const tPit = new Float64Array(S + 1);
  const tTop = new Float64Array(S + 1);
  const neckPts = [];
  for (let k = 0; k <= 256; k++) neckPts.push(torsoPoint(M, (k / 256) * 2 * Math.PI, 1, [0, 0, 0]));
  const P = [0, 0, 0];
  const toNeck = (th, t) => {
    torsoPoint(M, th, t, P);
    let d = Infinity;
    for (const q of neckPts) d = Math.min(d, Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2]));
    return d;
  };
  for (let s = 0; s <= S; s++) {
    const phi = (s / S) * Math.PI;
    let lo = 0.5;
    let hi = 1;
    for (let it = 0; it < 32; it++) {
      const mid = (lo + hi) / 2;
      if (toNeck(phi, mid) > M.strap) lo = mid;
      else hi = mid;
    }
    tTop[s] = (lo + hi) / 2;
  }
  const look = (tab, th) => {
    const x = (Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) / Math.PI) * S;
    const k = Math.min(S - 1, Math.floor(x));
    return lerp(tab[k], tab[k + 1], x - k);
  };
  // Bordes de atrás: rectos y, cerca de la unión, elipse que llega casi
  // vertical (la sisa queda como una C que se cierra hacia el centro).
  const thJ = Math.PI / 2 + (AB * Math.PI) / COLS;
  const RE = Math.sqrt(1 - RACER_C * RACER_C);
  const arc = (u, k) => (1 - k) * (1 - u) + (k * (Math.sqrt(1 - (RACER_C * u) ** 2) - RE)) / (1 - RE);
  const tOfY = (phi, y) => {
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 32; it++) {
      const mid = (lo + hi) / 2;
      if (torsoPoint(M, phi, mid, P)[1] < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const yS = torsoPoint(M, Math.PI / 2, tTop[S / 2], P)[1];
  const yT = neckY(M, thJ) - M.racerTop;
  const yJ = yT - M.racerGap;
  // Avance medido de costado a costado (vista de atrás), no alrededor del
  // cuerpo: si no, junto a la costura los bordes bajan derecho.
  const X = (phi) => Math.abs(Math.sin(phi)) ** (2 / M.n);
  // En la columna del centro esas dos filas se separan hacia el medio hasta
  // quedar parejas con las demás (si no, las de la sisa se apiñan en
  // `racerGap` y al redondear las esquinas se pisan).
  const yN = neckY(M, Math.PI);
  const yPC = lerp(-L, yN, i1 / N);
  const yTC = lerp(-L, yN, i2 / N);
  for (let s = 0; s <= S; s++) {
    const phi = (s / S) * Math.PI;
    const u = phi <= Math.PI / 2 ? 0 : phi >= thJ ? 1 : (1 - X(phi)) / (1 - X(thJ));
    const w = smooth(clamp01((phi - thJ) / (Math.PI - thJ)));
    if (s > S / 2) tTop[s] = tOfY(phi, lerp(yT + (yS - yT) * arc(u, RACER_K), yTC, w));
    tPit[s] = tOfY(phi, lerp(yJ - (yJ - M.pitY) * arc(u, RACER_KB), yPC, w));
  }
  // Sobre el hombro el borde de arriba se redondea (visto de costado): el
  // frente sube empinado siguiendo el escote hondo y la espalda, alta, sigue
  // casi plana; sin esto la punta del hombro queda levantada en pico y la
  // cola del vivo asoma por la tela.
  const ez = [];
  const ey = [];
  for (let s = 0; s <= S; s++) {
    torsoPoint(M, (s / S) * Math.PI, tTop[s], P);
    ez.push(P[2]);
    ey.push(P[1]);
  }
  const z0 = ez[S / 2];
  for (let s = 0; s <= S; s++) {
    const keep = smoothstep(2, 4, Math.abs(ez[s] - z0) / RACER_ROUND);
    if (keep >= 1) continue;
    let sw = 0;
    let sy = 0;
    for (let j = 0; j <= S; j++) {
      const dz = (ez[j] - ez[s]) / RACER_ROUND;
      if (Math.abs(dz) > 3) continue;
      const wj = Math.exp(-dz * dz) * Math.abs(ez[Math.min(S, j + 1)] - ez[Math.max(0, j - 1)]);
      sw += wj;
      sy += wj * ey[j];
    }
    tTop[s] = tOfY((s / S) * Math.PI, lerp(sy / sw, ey[s], keep));
  }
  const tOf = (i, th) => {
    const tp = look(tPit, th);
    const tt = look(tTop, th);
    if (i <= i1) return (tp * i) / i1;
    if (i <= i2) return lerp(tp, tt, (i - i1) / (i2 - i1));
    return lerp(tt, 1, (i - i2) / (N - i2));
  };
  const hw = (AF + AB) / 2;
  const ic = (i1 + i2) / 2;
  const hh = (i2 - i1) / 2;
  // Corrimiento (filas, columnas) que redondea la sisa centrada en jc; las
  // dos sisas de una pieza se suman (una tras otra, la segunda torcería la
  // primera y no quedarían iguales).
  // Hacia la punta de atrás (`tip`: de qué lado queda) no redondea: ahí la
  // curva la dan los bordes, y la grilla, apretada en la columna del centro,
  // se pisaría.
  const warp = (i, j, jc, tip) => {
    const p = (j - jc) / hw;
    const q = (i - ic) / hh;
    const rho = Math.max(Math.abs(p), Math.abs(q));
    const r = Math.hypot(p, q);
    if (rho >= 1.8 || r < 1e-9) return [0, 0];
    const top = q > 0 ? clamp01((N - i) / (N - i2)) : 1;
    const away = 1 - smoothstep(0.2, 0.6, (tip * p) / r);
    const R = ((Math.abs(p) / r) ** RACER_E + (Math.abs(q) / r) ** RACER_E) ** (-1 / RACER_E);
    const k = lerp(1, (R * rho) / r, (1 - smoothstep(1, 1.8, rho)) * top * away) - 1;
    return [q * k * hh, p * k * hw];
  };
  // El tramo vertical de la columna del centro se curva un poco hacia la sisa
  // en las puntas: empalma con los bordes sin esquina.
  const bend = (i) => {
    const q = Math.abs(i - ic) / hh;
    return q <= 1 ? q * q : Math.max(0, 1 - (q - 1) * 2);
  };
  const panels = {};
  for (const key of ['front', 'back']) {
    const front = key === 'front';
    const th0 = front ? -Math.PI / 2 : Math.PI / 2;
    // Centro de cada sisa en las columnas de esta pieza (cada sisa sigue en
    // la otra pieza, del otro lado de la costura).
    const centers = front ? [COLS + (AB - AF) / 2, (AF - AB) / 2] : [(AB - AF) / 2, COLS + (AF - AB) / 2];
    const A = front ? AF : AB;
    const W = COLS + 1;
    const pos = new Float32Array(W * (N + 1) * 3);
    const ang = new Float32Array(W * (N + 1));
    const tmp = [0, 0, 0];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= COLS; j++) {
        let [ii, jj] = [i, j];
        for (const jc of centers) {
          const [di, dj] = warp(i, j, jc, front ? 0 : jc < COLS / 2 ? 1 : -1);
          ii += di;
          jj += dj;
        }
        if (!front) for (const [e, sg] of [[AB, 1], [COLS - AB, -1]]) jj -= sg * RACER_D * bend(i) * (1 - smoothstep(0, 3, Math.abs(j - e)));
        const th = th0 + (Math.PI * jj) / COLS;
        torsoPoint(M, th, tOf(ii, th), tmp);
        const k = i * W + j;
        pos.set(tmp, k * 3);
        ang[k] = th;
      }
    }
    const idx = [];
    const hole = (i, j) => i >= i1 && i < i2 && (j < A || j >= COLS - A);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < COLS; j++) {
        if (hole(i, j)) continue;
        const a = i * W + j;
        idx.push(a, a + 1, a + W + 1, a, a + W + 1, a + W);
      }
    orient(pos, idx, fromVertical);
    panels[key] = { pos, ang, idx, W, N };
  }
  // El borde de cada sisa de atrás, promediado a lo largo de sí mismo: la C
  // queda sin quiebres donde los bordes se juntan con la columna (ahí la
  // grilla dobla en uno o dos puntos). Junto a las costuras no se toca.
  const back = panels.back.pos;
  for (const side of [1, -1]) {
    const loop = armholeLoopIJ(COLS, AF, i1, i2, side, AB)
      .filter(([key]) => key === 'back')
      .map(([, i, j]) => i * (COLS + 1) + j);
    const Q = loop.map((v) => [back[v * 3], back[v * 3 + 1], back[v * 3 + 2]]);
    const sAt = [0];
    for (let k = 1; k < Q.length; k++) sAt.push(sAt[k - 1] + Math.hypot(Q[k][0] - Q[k - 1][0], Q[k][1] - Q[k - 1][1], Q[k][2] - Q[k - 1][2]));
    const end = sAt[Q.length - 1];
    loop.forEach((v, k) => {
      const keep = smoothstep(2, 4, Math.min(sAt[k], end - sAt[k]) / RACER_SMOOTH);
      if (!keep) return;
      const acc = [0, 0, 0];
      let sw = 0;
      for (let m = 0; m < Q.length; m++) {
        const z = (sAt[m] - sAt[k]) / RACER_SMOOTH;
        if (Math.abs(z) > 3) continue;
        const w = Math.exp(-z * z) * (sAt[Math.min(Q.length - 1, m + 1)] - sAt[Math.max(0, m - 1)]);
        sw += w;
        for (let c = 0; c < 3; c++) acc[c] += w * Q[m][c];
      }
      for (let c = 0; c < 3; c++) back[v * 3 + c] = lerp(Q[k][c], acc[c] / sw, keep);
    });
  }
  return { panels, i1, i2, N, armCols: AF, armColsB: AB };
}

// Borde de cada sisa, desde la axila: sube por el frente, cruza el hombro y
// baja por la espalda. Devuelve [pieza, fila, columna] de cada punto de una
// grilla de `cols` columnas con la sisa entre las filas i1 e i2 (de A
// columnas en el frente y AB en la espalda).
export function armholeLoopIJ(cols, A, i1, i2, side, AB = A) {
  const F = (i, j) => ['front', i, j];
  const B = (i, j) => ['back', i, j];
  const out = [];
  if (side > 0) {
    out.push(F(i1, cols));
    for (let j = cols - 1; j >= cols - A; j--) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, cols - A));
    for (let j = cols - A + 1; j <= cols; j++) out.push(F(i2, j));
    for (let j = 1; j <= AB; j++) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, AB));
    for (let j = AB - 1; j >= 1; j--) out.push(B(i1, j));
  } else {
    out.push(F(i1, 0));
    for (let j = 1; j <= A; j++) out.push(F(i1, j));
    for (let i = i1 + 1; i <= i2; i++) out.push(F(i, A));
    for (let j = A - 1; j >= 0; j--) out.push(F(i2, j));
    for (let j = cols - 1; j >= cols - AB; j--) out.push(B(i2, j));
    for (let i = i2 - 1; i >= i1; i--) out.push(B(i, cols - AB));
    for (let j = cols - AB + 1; j <= cols - 1; j++) out.push(B(i1, j));
  }
  return out;
}
function armholeLoop(torso, side) {
  const W = COLS + 1;
  return armholeLoopIJ(COLS, torso.armCols, torso.i1, torso.i2, side, torso.armColsB).map(([key, i, j]) => [key, i * W + j]);
}

// Pliegues del torso: caída suave hacia el ruedo y tensiones que salen de la
// axila. Es un campo continuo en el espacio, así las costuras no se abren.
function torsoFolds(M, x, y, z, th, armpits) {
  const f = M.fit;
  let drapeA = (0.003 + 0.005 * f) * smoothstep(M.pitY - 0.04, M.pitY - 0.34, y);
  // Remerón: de la cadera para abajo la caída son pliegues que bajan derechos
  // y se abren hacia el ruedo (en vez de las ondas en diagonal).
  const F = M.flare;
  if (F) drapeA *= smoothstep(F.y0 - 0.12, F.y0 + 0.02, y);
  let d = drapeA * (0.6 * Math.sin(7 * th + 1.3 + 9 * y) + 0.4 * Math.sin(11 * th + 0.4 - 6 * y));
  if (F) d += F.h * smoothstep(F.y0 + 0.04, -M.L, y) ** 1.3 * (0.75 * Math.sin(F.n * th + 0.6) + 0.25 * Math.sin((F.n + 4) * th + 2.1));
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

export function computeNormals(pos, idx) {
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
export function inverted(pos, idx, out, only = null) {
  const nrm = computeNormals(pos, idx);
  let s = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    if (only && !only(v)) continue;
    const o = out(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    s += nrm[v * 3] * o[0] + nrm[v * 3 + 1] * o[1] + nrm[v * 3 + 2] * o[2];
  }
  return s < 0;
}
export function flip(idx) {
  for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
  return idx;
}
export function orient(pos, idx, out, only) {
  return inverted(pos, idx, out, only) ? flip(idx) : idx;
}
const fromVertical = (x, y, z) => [x, 0, z];

// Superficie de unas piezas, suavizada: `project(p, n)` lleva el punto p a la
// superficie (promedio de los planos de los vértices de alrededor, con peso
// gaussiano de radio `r`) y deja en n su normal. Sirve para apoyar algo sobre
// la tela sin que copie las facetas de la malla.
function smoothSurface(parts, r = 0.01) {
  const cell = r;
  const map = new Map();
  const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const part of parts)
    for (let v = 0; v < part.pos.length / 3; v++) {
      if (!part.nrm[v * 3] && !part.nrm[v * 3 + 1] && !part.nrm[v * 3 + 2]) continue;
      const k = key(part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2], part.nrm[v * 3], part.nrm[v * 3 + 1], part.nrm[v * 3 + 2]);
    }
  return (p, n) => {
    for (let it = 0; it < 2; it++) {
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      const cz = Math.floor(p.z / cell);
      let sw = 0;
      let sd = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++)
          for (let c = -2; c <= 2; c++) {
            const list = map.get(`${cx + a},${cy + b},${cz + c}`);
            if (!list) continue;
            for (let q = 0; q < list.length; q += 6) {
              const dx = p.x - list[q];
              const dy = p.y - list[q + 1];
              const dz = p.z - list[q + 2];
              const w = Math.exp(-(dx * dx + dy * dy + dz * dz) / (r * r));
              sw += w;
              sd += w * (dx * list[q + 3] + dy * list[q + 4] + dz * list[q + 5]);
              nx += w * list[q + 3];
              ny += w * list[q + 4];
              nz += w * list[q + 5];
            }
          }
      if (sw < 1e-9) return p;
      n.set(nx, ny, nz).normalize();
      p.addScaledVector(n, -sd / sw);
    }
    return p;
  };
}

// Las normales de puntos que coinciden en distintas piezas (costuras) se
// promedian: la prenda se ve continua.
export function weldNormals(parts) {
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
export function gridIndex(cols, rows, W) {
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
export function gridUV(pos, W, H, c0 = 0) {
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
  // Sin mangas no hay manga que tire de la axila: sin esos pliegues (arrugaban
  // los costados bajo el busto del tank top y asomaban debajo de los puños).
  const pitY = panels.front.pos[(i1 * W + COLS) * 3 + 1];
  const armpits = M.sleeveless ? [] : [Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 2].map((th) => ({ y: pitY, th }));
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
  for (const side of M.sleeveless ? [] : [1, -1]) {
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
    // Costura del puño: un anillo paralelo al ruedo, así el puño es una
    // banda recta del mismo ancho todo alrededor.
    const cuffC = hemC.clone().addScaledVector(dir, -S.cuff);
    const sRow = (r) => Math.min(1, r / SLEEVE_ROWS);
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
      for (let r = SLEEVE_ROWS + 1; r <= rows; r++) {
        P.lerpVectors(C, H, (r - SLEEVE_ROWS) / CUFF_ROWS);
        P.toArray(pos, (r * SW + k) * 3);
      }
      for (let r = 0; r <= SLEEVE_ROWS; r++) {
        const s = r / SLEEVE_ROWS;
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
    for (let r = 1; r < SLEEVE_ROWS; r++) {
      const s = sRow(r);
      for (let k = 0; k <= L; k++) {
        const f = cum[k] / per;
        const dphi = Math.min(f, 1 - f);
        const under = Math.exp(-((dphi / 0.13) ** 2)) * smoothstep(0, 0.18, s) * (1 - smoothstep(0.4, 0.62, s));
        const v = (r * SW + k) * 3;
        let d = (0.0026 + 0.002 * M.fit) * under * Math.sin(2 * Math.PI * (s * S.len / 0.045 + f * 4));
        d += 0.0007 * noise3(pos[v] * 20, pos[v + 1] * 20, pos[v + 2] * 20) * smoothstep(0, 0.1, s) * (1 - smoothstep(0.8, 1, s));
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
    parts[key].seamLoop = Array.from({ length: SW }, (_, k) => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]);
    parts[cuffKey].ring = Array.from({ length: SW }, (_, k) => ((CUFF_ROWS) * SW + k));
  }

  // ---------- puños de las sisas (musculosa) ----------
  // Cada punto del borde con el de la tela que le sigue hacia adentro de la
  // pieza (para orientar el puño y para que, colgada, lo siga).
  const armRings = {};
  if (M.sleeveless) {
    for (const key of ['front', 'back']) panels[key].nrm = computeNormals(panels[key].pos, panels[key].idx);
    weldNormals([panels.front, panels.back]);
    const surface = smoothSurface([panels.front, panels.back]);
    for (const [name, side] of [['armL', 1], ['armR', -1]]) {
      const ring = armholeLoopIJ(COLS, torso.armCols, i1, i2, side, torso.armColsB).map(([key, i, j]) => {
        const [ii, jj] = i === i1 ? [i - 1, j] : i === i2 ? [i + 1, j] : [i, j < COLS / 2 ? j + 1 : j - 1];
        return [key, i * W + j, ii * W + jj];
      });
      armRings[name] = ring;
      parts[name] = buildArmBand(ring.map(([key, v, w]) => [panels[key].pos, v, w, panels[key].nrm]), M.armBand, surface);
    }
  }

  // ---------- cuello ----------
  const neck = [];
  for (let j = 0; j <= COLS; j++) neck.push(['front', N * W + j, (N - 3) * W + j]);
  for (let j = 1; j < COLS; j++) neck.push(['back', N * W + j, (N - 3) * W + j]);
  parts.collar = buildCollar(M, neck.map(([key, v, below]) => [panels[key].pos, v, below, panels[key].nrm]), COLS / 2);

  // ---------- dobladillos (espesor de la tela en ruedo y puños) ----------
  if (torso.slitRows) {
    // Con abertura (remerón), el ruedo son dos tiras sueltas, una por pieza,
    // que terminan en los bordes del corte: no suben por ellos (subiendo
    // parecía cosida hacia arriba).
    const lips = [];
    for (const key of ['front', 'back']) {
      const p = panels[key].pos;
      lips.push(buildLip(Array.from({ length: COLS + 1 }, (_, j) => [p, j, W + j]), 0.022, false, true));
    }
    parts.hem = mergeParts(lips);
  } else {
    const hemRing = [];
    for (let j = 0; j <= COLS; j++) hemRing.push([panels.front.pos, j, W + j]);
    for (let j = 1; j < COLS; j++) hemRing.push([panels.back.pos, j, W + j]);
    parts.hem = buildLip(hemRing, 0.022, true);
  }
  for (const k of M.sleeveless ? [] : ['cuffL', 'cuffR']) {
    const c = parts[k];
    const SW = c.ring.length;
    const ring = [];
    for (let i = 0; i < SW - 1; i++) ring.push([c.pos, c.ring[i], c.ring[i] - SW]);
    parts[k + 'Lip'] = buildLip(ring, 0.016, true);
  }

  printUV(parts, N, W, M);

  // Normales, costuras soldadas y marcas de costura.
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals(['front', 'back', 'sleeveL', 'sleeveR', 'cuffL', 'cuffR'].filter((k) => parts[k]).map((k) => parts[k]));
  seamMarks(parts, N, W, params.cuff === 'none', M.vNeck ? COLS / 2 : -1, torso.slitRows);
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
    if (part.hang) g.userData.hang = part.hang;
    geos[key] = g;
  }
  // Estructura de las mallas (para la versión colgada, que simula la tela).
  const sleeveSW = M.sleeveless ? 0 : parts.cuffL.ring.length;
  const layout = {
    cols: COLS,
    armCols: torso.armCols,
    armColsB: torso.armColsB,
    rows: N,
    i1,
    i2,
    sleeveless: M.sleeveless,
    sleeveRows: SLEEVE_ROWS,
    cuffRows: CUFF_ROWS,
    sleeveSW,
    rings: {
      collar: neck,
      hem: [...Array.from({ length: COLS + 1 }, (_, j) => ['front', j, W + j]), ...Array.from({ length: COLS - 1 }, (_, j) => ['back', j + 1, W + j + 1])],
      ...(M.sleeveless
        ? armRings
        : {
            cuffLLip: Array.from({ length: sleeveSW - 1 }, (_, i) => ['cuffL', CUFF_ROWS * sleeveSW + i, (CUFF_ROWS - 1) * sleeveSW + i]),
            cuffRLip: Array.from({ length: sleeveSW - 1 }, (_, i) => ['cuffR', CUFF_ROWS * sleeveSW + i, (CUFF_ROWS - 1) * sleeveSW + i]),
          }),
    },
  };
  return {
    geos,
    measures: M,
    layout,
    params: { ...DEFAULTS, ...params },
    printBase: { front: parts.front.printBase, back: parts.back.printBase },
    cut: M.cutNeck ? { tw: panels.front.tw, tv: panels.front.tv } : null,
  };
}

// ---------- coordenadas de estampado ----------

// Cada pieza desplegada en metros sobre la tela (las UV de la tela), como se
// ve desde afuera: x hacia la derecha, y hacia abajo, con el origen en un
// punto fijo de la pieza (así un diseño no se mueve al cambiar el largo o el
// calce ni el cuello): frente y espalda, el centro del escote (en el frente,
// el del escote de referencia, aunque el corte pase más abajo o más arriba:
// ver flattenPrint); mangas, la punta del
// hombro, con el ruedo derecho (como un molde); puños, el centro de arriba;
// cuello, el centro de atrás en la costura (arriba la cara de afuera y, más
// arriba, la de adentro).
function printUV(parts, N, W, M) {
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
    // Con otro cuello, el origen sigue en el escote de referencia (ver
    // flattenPrint); de entrada, a su altura.
    const o = [uv1[A], key === 'front' && M.cutNeck ? M.refF : uv1[A + 1]];
    parts[key].uv1 = uv1.map((x, i) => x - o[i % 2]);
    parts[key].printBase = Float32Array.from(parts[key].uv1);
  }
  for (const [key, cuffKey, side] of [['sleeveL', 'cuffL', 1], ['sleeveR', 'cuffR', -1]]) {
    const sl = parts[key];
    const cf = parts[cuffKey];
    if (!sl) continue;
    const SW = cf.ring.length;
    const L = SW - 1;
    const cap = L / 2;
    const right = [0, 0, -side];
    const sx = facing(sl.pos, sl.uv, [[cap - 4, cap + 4]], right);
    const R = SLEEVE_ROWS;
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
  // Con otro cuello el molde es el de la camiseta de referencia (la misma, con
  // el escote redondo de referencia), cortado: un diseño cae igual con
  // cualquier cuello. Esa camiseta se aplana una vez y sirve para todos.
  // Con abertura (remerón), lo mismo con la pieza sin abrir: abierta se
  // angosta abajo, y el molde tiene que ser el de la tela (rectangular).
  const prevRef = prev && prev.ref ? prev.ref : prev;
  const slit = built.measures.flare?.slit > 0;
  if (built.cut || slit) {
    const rp = { ...built.params, neckStyle: 'round', neckDepth: NECK_REF, slit: 0 };
    const ref = prevRef && prevRef.flatPrint && refKey(prevRef.params) === refKey(rp) ? prevRef : buildShirt(rp);
    flattenPrint(ref, prevRef);
    if (built.cut) cutMold(built, ref);
    else for (const key of ['front', 'back']) built.geos[key].attributes.uv1.array.set(ref.geos[key].attributes.uv1.array);
    built.ref = ref;
    built.flatPrint = true;
    return;
  }
  prev = prevRef;
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
const refKey = (p) => [p.garment, p.fit, p.length, p.neckStyle === 'v' ? 'v' : 'r', p.neckDepth].join();
// Molde del frente cortado (cutMold): cada punto toma el lugar del de
// referencia en su columna con el mismo t (entre dos filas, interpolado; por
// encima del escote de referencia, la columna sigue derecha en el molde lo
// que sube sobre la tela). La espalda es la misma pieza.
function cutMold(built, ref) {
  const M = built.measures;
  const L = built.layout;
  const W = L.cols + 1;
  const N = L.rows;
  const { tw, tv } = built.cut;
  const src = ref.geos.front.attributes.uv1.array;
  const dst = built.geos.front.attributes.uv1.array;
  const P = [0, 0, 0];
  const Q = [0, 0, 0];
  for (let j = 0; j <= L.cols; j++) {
    const th = -Math.PI / 2 + (Math.PI * j) / L.cols;
    const tTop = tw[N * W + j];
    for (let i = 0; i <= N; i++) {
      const v = i * W + j;
      const t = tv[v];
      if (t > tTop) {
        const a = N * W + j;
        const b = a - W;
        const dx = src[a * 2] - src[b * 2];
        const dy = src[a * 2 + 1] - src[b * 2 + 1];
        const l = Math.hypot(dx, dy) || 1;
        let len = 0;
        torsoPoint(M, th, tTop, Q);
        for (let k = 1; k <= 16; k++) {
          torsoPoint(M, th, lerp(tTop, t, k / 16), P);
          len += Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2]);
          Q.splice(0, 3, ...P);
        }
        dst[v * 2] = src[a * 2] + (dx / l) * len;
        dst[v * 2 + 1] = src[a * 2 + 1] + (dy / l) * len;
        continue;
      }
      let k = Math.min(i, N - 1);
      while (k > 0 && tw[k * W + j] > t) k--;
      while (k < N - 1 && tw[(k + 1) * W + j] < t) k++;
      const t0 = tw[k * W + j];
      const t1 = tw[(k + 1) * W + j];
      const f = t1 > t0 ? clamp01((t - t0) / (t1 - t0)) : 0;
      const a = k * W + j;
      dst[v * 2] = lerp(src[a * 2], src[(a + W) * 2], f);
      dst[v * 2 + 1] = lerp(src[a * 2 + 1], src[(a + W) * 2 + 1], f);
    }
  }
  built.geos.front.attributes.uv1.needsUpdate = true;
  built.geos.back.attributes.uv1.array.set(ref.geos.back.attributes.uv1.array);
  built.geos.back.attributes.uv1.needsUpdate = true;
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

// Costura en inglete de la punta de la V (tira del cuello, puesta o
// colgada): cada fila del perfil de cada lado es paralela a su pata y sigue
// derecho hasta el medio (x = 0), donde se encuentra con la del otro lado;
// los puntos que pasarían al otro lado (y la columna de la punta) quedan ahí.
// Correr sólo su x los dejaba más abajo que la fila: el borde de la tira
// hacía una muesca en el medio (abierta, sobre todo colgada). La cola de la
// cara de adentro (las últimas TAIL filas, que bajan por dentro de la prenda)
// sólo se corta en el medio: prolongada, en la punta salía por delante de la
// tela.
const TAIL = 2;
export function mitreV(pos, SW, P, tip, span = 10) {
  const at = (j, i) => (j * SW + i) * 3;
  for (let j = P - TAIL; j < P; j++)
    for (const s of [-1, 1])
      for (let m = 1; m < span; m++) if (pos[at(j, tip + s * m)] * s < 0) pos[at(j, tip + s * m)] = 0;
  for (let j = 1; j < P - TAIL; j++) {
    const meet = [0, 0, 0];
    let got = 0;
    for (const s of [-1, 1]) {
      // Las dos columnas más cercanas al medio que quedan de su lado.
      let m = 1;
      while (m < span && pos[at(j, tip + s * m)] * s <= 1e-5) m++;
      const a = at(j, tip + s * m);
      const b = at(j, tip + s * (m + 1));
      const dx = pos[b] - pos[a];
      const t = Math.abs(dx) > 1e-9 ? Math.min(3, -pos[a] / dx) : 0;
      const q = [0, 0, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * t];
      for (let k = 1; k < m; k++) pos.set([0, q[2], q[3]], at(j, tip + s * k));
      meet[1] += q[2];
      meet[2] += q[3];
      got++;
    }
    pos.set([0, meet[1] / got, meet[2] / got], at(j, tip));
  }
}

// Fila del perfil de la tira en la mitad del doblez, y separación (m) entre
// las dos caras en la plantilla.
export const COLLAR_FOLD = 5;
const COLLAR_GAP = 0.006;

// Tira del cuello (de la misma tela) sobre el borde del escote (lazo cerrado):
// `tip` es el punto del lazo en el centro del frente (en V, la punta). Con el
// escote hondo del tank top es un vivo angosto que sigue la tela (mismo
// perfil, más chico).
function buildCollar(M, neck, tip) {
  const n = neck.length;
  const base = neck.map(([pos, v]) => new THREE.Vector3().fromArray(pos, v * 3));
  const below = neck.map(([pos, , b]) => new THREE.Vector3().fromArray(pos, b * 3));
  const nrms = neck.map(([, v, , nn]) => new THREE.Vector3().fromArray(nn, v * 3));
  const flat = M.deepNeck;
  // Contorno suavizado (redondo y parejo).
  const ring = base.map((p) => p.clone());
  for (let pass = 0; pass < 2; pass++) {
    const prev = ring.map((p) => p.clone());
    for (let i = 0; i < n; i++) ring[i].copy(prev[(i - 1 + n) % n]).add(prev[(i + 1) % n]).multiplyScalar(0.25).addScaledVector(prev[i], 0.5);
  }
  // Alto de la tira.
  const h = flat ? M.armBand : 0.021;
  const th = flat ? 0.0032 : 0.0034;
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
  if (!flat) ups = ups.map((u0, k) => {
    const rise = Math.min(h, ty[k] - ring[k].y);
    const hz = new THREE.Vector3(u0.x, 0, u0.z);
    if (hz.lengthSq() < 1e-8) hz.set(center.x - ring[k].x, 0, center.z - ring[k].z);
    hz.normalize().multiplyScalar(Math.sqrt(Math.max(0, h * h - rise * rise)));
    return along(new THREE.Vector3(hz.x, rise, hz.z), k);
  });
  // Donde el escote pasa más abajo que el de referencia (en V y en el
  // redondo hondo), la tira se va acostando sobre el pecho, siguiendo la tela
  // (del todo NECK_LIE más abajo): parada, junto a la punta quedaba delante de
  // la tela (el pecho ahí va inclinado) y más arriba se inclinaba hacia atrás;
  // torcida a lo largo de la pata, hacía un quiebre con tela de más arriba.
  // En V va acostada en todo el frente, con cualquier escote (parada en las
  // patas, junto a la punta se doblaba): se para recién junto al hombro.
  if (!flat)
    ups = ups.map((u, k) => {
      const ax = Math.abs(base[k].x);
      const deep = smoothstep(0, NECK_LIE, refCutY(M, ax) - cutY(M, ax));
      const f = base[k].z > 0 && ax < M.neck.a ? Math.max(deep, M.vNeck ? 1 - smoothstep(VEE_LIE[0], VEE_LIE[1], ax / M.neck.a) : 0) : 0;
      if (f <= 0) return u;
      const lie = along(new THREE.Vector3().subVectors(base[k], below[k]).normalize(), k);
      return along(u.clone().lerp(lie, f).normalize(), k);
    });
  // Vivo: sigue la tela desde el borde.
  if (flat) {
    ups = base.map((b, k) => along(new THREE.Vector3().subVectors(b, below[k]).normalize(), k));
    for (let pass = 0; pass < 4; pass++) ups = ups.map((_, k) => along(ups[(k - 1 + n) % n].clone().add(ups[(k + 1) % n]).addScaledVector(ups[k], 2).normalize(), k));
  }
  const up = new THREE.Vector3();
  const out = new THREE.Vector3();
  const q = new THREE.Vector3();
  let u = 0;
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    if (i > 0) u += ring[k].distanceTo(ring[i - 1]);
    up.copy(ups[k]);
    // Afuera: perpendicular a "arriba" dentro del plano vertical radial (el
    // vivo, del lado de afuera de la tela).
    if (flat) out.copy(nrms[k]);
    else out.set(ring[k].x - center.x, 0, ring[k].z - center.z).normalize();
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
  // en inglete).
  if (M.vNeck) mitreV(pos, SW, P, tip);
  const idx = gridIndex(n, P - 1, SW);
  return { pos, uv, P, idx: orient(pos, idx, fromVertical, (v) => v < SW * 3) };
}

// Dobladillo: desde el borde, la tela se da vuelta hacia adentro y sube.
// ring: [posiciones, índice del borde, índice de la fila de arriba].
// Afuera es lejos del centro del borde, o, con `axis`, lejos del eje de la
// prenda a la altura de cada punto (para un borde que no da la vuelta
// entera: una tira del ruedo, el borde de una abertura).
export function buildLip(ring, height, closed, axis = false) {
  const n = ring.length;
  const prof = [[0, 0], [-0.0008, -0.0009], [-0.0003, -0.0021], [0.002, -0.0024], [height, -0.0024]];
  const P = prof.length;
  const SW = n + (closed ? 1 : 0);
  const pos = new Float32Array(SW * P * 3);
  const uv = new Float32Array(SW * P * 2);
  const center = new THREE.Vector3();
  for (const [p, v] of ring) center.add(new THREE.Vector3().fromArray(p, v * 3));
  center.divideScalar(n);
  if (axis) center.x = center.z = 0;
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
    if (axis) center.y = e.y;
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
  return { pos, uv, idx: orient(pos, idx, axis ? fromVertical : (x, y, z) => [x - center.x, y - center.y, z - center.z]) };
}
// Varias mallas en una sola pieza (posiciones, UV e índices).
function mergeParts(list) {
  const pos = new Float32Array(list.reduce((s, m) => s + m.pos.length, 0));
  const uv = new Float32Array(list.reduce((s, m) => s + m.uv.length, 0));
  const idx = [];
  let base = 0;
  for (const m of list) {
    pos.set(m.pos, base * 3);
    uv.set(m.uv, base * 2);
    for (const v of m.idx) idx.push(v + base);
    base += m.pos.length / 3;
  }
  return { pos, uv, idx };
}

// Puño de la sisa (musculosa) o vivo (tank top): una tira doble cosida al
// borde. Con cuerpo envuelve el borde y se apoya sobre la tela, hacia
// adentro de la pieza, en todo su ancho (`surface`: la tela suavizada): de
// frente y de espalda se ve como una franja a lo largo de la sisa. Saliendo
// del borde (siguiendo la tela hacia el hueco, hacia su centro o hacia el
// costado) quedaba detrás del borde, se hundía en el hombro o se torcía.
// Colgada, la sisa se aplasta: el puño sale del borde siguiendo la tela
// (`hang`, la forma de reposo con la que lo acompaña la simulación). Cara de
// afuera, borde redondeado y cara de adentro, que sigue un poco por dentro de
// la prenda. `ring`: [posiciones, punto del borde, punto de la tela que le
// sigue hacia adentro de la pieza, normales], desde la axila.
function buildArmBand(ring, h, surface) {
  const n = ring.length;
  const th = 0.0032;
  const prof = [[0, 0], [h * 0.5, 0.0002], [h - th / 2, 0]];
  for (let a = 1; a < 6; a++) {
    const ang = (a / 6) * Math.PI;
    prof.push([h - th / 2 + Math.sin(ang) * (th / 2), -th / 2 + Math.cos(ang) * (th / 2)]);
  }
  prof.push([h - th / 2, -th], [h * 0.4, -th], [-0.009, -th]);
  const P = prof.length;
  const SW = n + 1;
  const E = ring.map(([p, v]) => new THREE.Vector3().fromArray(p, v * 3));
  const ins = ring.map(([p, , w]) => new THREE.Vector3().fromArray(p, w * 3));
  const nrm = ring.map(([, v, , nn]) => new THREE.Vector3().fromArray(nn, v * 3));
  // Perpendicular al borde dentro de la tela, hacia el hueco (suavizado).
  const tans = E.map((e, k) => new THREE.Vector3().subVectors(E[(k + 1) % n], E[(k - 1 + n) % n]).normalize());
  let flat = E.map((e, k) => {
    const d = new THREE.Vector3().crossVectors(tans[k], nrm[k]).normalize();
    return d.dot(new THREE.Vector3().subVectors(e, ins[k])) < 0 ? d.negate() : d;
  });
  for (let pass = 0; pass < 4; pass++) flat = flat.map((_, k) => flat[(k - 1 + n) % n].clone().add(flat[(k + 1) % n]).addScaledVector(flat[k], 2).normalize());
  const outOf = (d, k) => {
    const o = new THREE.Vector3().crossVectors(tans[k], d).normalize();
    return o.dot(nrm[k]) < 0 ? o.negate() : o;
  };
  // Con cuerpo: camino sobre la tela desde cada punto del borde hacia adentro
  // (puntos y normales cada ARM_STEP), y lo que sobresale del borde.
  const reach = h + 0.012;
  const steps = Math.ceil(reach / ARM_STEP);
  const paths = E.map((e, k) => {
    const pts = [e.clone()];
    const nrs = [nrm[k].clone()];
    const d = flat[k].clone().negate();
    const p = e.clone();
    const nn = nrm[k].clone();
    for (let st = 0; st < steps; st++) {
      const q = surface(p.clone().addScaledVector(d, ARM_STEP), nn);
      d.subVectors(q, p).addScaledVector(nn, -d.dot(nn)).normalize();
      p.copy(q);
      pts.push(p.clone());
      nrs.push(nn.clone());
    }
    return { pts, nrs };
  });
  const onCloth = (k, s, b, out) => {
    if (s <= 0) return out.copy(E[k]).addScaledVector(flat[k], -s).addScaledVector(nrm[k], b);
    const f = Math.min(s / ARM_STEP, steps - 1e-6);
    const a = Math.floor(f);
    const { pts, nrs } = paths[k];
    const nn = nrs[a].clone().lerp(nrs[a + 1], f - a).normalize();
    return out.copy(pts[a]).lerp(pts[a + 1], f - a).addScaledVector(nn, b);
  };
  const pos = new Float32Array(SW * P * 3);
  const hang = new Float32Array(SW * P * 3);
  const uv = new Float32Array(SW * P * 2);
  const q = new THREE.Vector3();
  const tail = E.map((e, k) => Object.assign(new THREE.Vector3().subVectors(ins[k], e), { len: e.distanceTo(ins[k]) || 1e-6 }));
  let u = 0;
  for (let i = 0; i < SW; i++) {
    const k = i % n;
    if (i > 0) u += E[k].distanceTo(E[i - 1]);
    let v = 0;
    for (let j = 0; j < P; j++) {
      if (j > 0) v += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
      const [a, b] = prof[j];
      // Con cuerpo, el perfil va al revés: la cara de afuera sobre la tela
      // desde su ancho hasta el borde, la vuelta un poco más allá del borde y
      // la cara de adentro por debajo de la tela.
      onCloth(k, h - a - ARM_WRAP, b + ARM_RISE * (j ? 1 : 0.5), q).toArray(pos, (j * SW + i) * 3);
      // Colgada sale del borde siguiendo la tela. (La cola de la cara de
      // adentro va hacia el punto de la tela de al lado: donde la tela se
      // curva, una recta saldría por encima y se vería.)
      if (a < 0) q.copy(E[k]).addScaledVector(tail[k], Math.min(-a, tail[k].len) / tail[k].len).addScaledVector(outOf(flat[k], k), b);
      else q.copy(E[k]).addScaledVector(flat[k], a).addScaledVector(outOf(flat[k], k), b);
      q.toArray(hang, (j * SW + i) * 3);
      uv[(j * SW + i) * 2] = u;
      uv[(j * SW + i) * 2 + 1] = v;
    }
  }
  // La cara de afuera mira hacia afuera de la prenda.
  const idx = gridIndex(n, P - 1, SW);
  const nn = computeNormals(pos, idx);
  let s = 0;
  for (let i = 0; i < SW; i++) s += nn[(SW + i) * 3] * nrm[i % n].x + nn[(SW + i) * 3 + 1] * nrm[i % n].y + nn[(SW + i) * 3 + 2] * nrm[i % n].z;
  return { pos, hang, uv, idx: s < 0 ? flip(idx) : idx, seamLoop: E.map((e) => e.toArray()) };
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
    if (!p) continue;
    const n = p.pos.length / 3;
    const SW = p.uv.length / 2 / (SLEEVE_ROWS + 1);
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
// Sin puño (`noCuff`), entre la manga y el puño no hay costura: la manga
// sigue, con la costura de abajo del brazo, hasta el borde. En V, la tira
// lleva una costura en la punta (`vTip`, su columna). Con abertura en los
// costados (las primeras `slitRows` filas del torso), ahí el costado no es
// costura sino borde, limpio: el pespunte del ruedo corre por abajo y
// termina en él.
function seamMarks(parts, N, W, noCuff = false, vTip = -1, slitRows = 0) {
  const set = (part, f) => {
    const n = part.pos.length / 3;
    part.seam = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      const [a, b] = f(v);
      part.seam[v * 2] = a;
      part.seam[v * 2 + 1] = b;
    }
  };
  // Torso: costados y hombros (bordes de la grilla), sisas (donde arranca la
  // manga o el puño de la sisa), escote; pespunte del ruedo.
  const loops = ['sleeveL', 'sleeveR', 'armL', 'armR'].filter((k) => parts[k]).map((k) => parts[k].seamLoop);
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
      const side = Math.min(u - uL, uR - u);
      const open = i < slitRows;
      let d = open ? Infinity : side;
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
    if (!p) continue;
    const SW = p.uv.length / 2 / (SLEEVE_ROWS + 1);
    set(p, (v) => {
      const k = v % SW;
      const r = Math.floor(v / SW);
      const per = p.uv[(r * SW + SW - 1) * 2];
      const u = p.uv[v * 2];
      const vEnd = p.uv[(SLEEVE_ROWS * SW + k) * 2 + 1];
      return [Math.min(p.uv[v * 2 + 1], u, per - u, noCuff ? Infinity : vEnd - p.uv[v * 2 + 1]), 1];
    });
  }
  for (const key of ['cuffL', 'cuffR']) {
    const p = parts[key];
    if (!p) continue;
    const SW = p.ring.length;
    set(p, (v) => {
      const k = v % SW;
      const vEnd = p.uv[(CUFF_ROWS * SW + k) * 2 + 1];
      const u = p.uv[v * 2];
      const per = p.uv[(Math.floor(v / SW) * SW + SW - 1) * 2];
      return [noCuff ? Math.min(u, per - u) : p.uv[v * 2 + 1] - p.uv[k * 2 + 1], vEnd - p.uv[v * 2 + 1]];
    });
  }
  // Puños de las sisas: el hundido de la costura del lado del puño.
  for (const key of ['armL', 'armR']) {
    const p = parts[key];
    if (p) set(p, (v) => [p.uv[v * 2 + 1], 1]);
  }
  const cu = parts.collar.uv;
  set(parts.collar, (v) => [vTip >= 0 ? Math.abs(cu[v * 2] - cu[vTip * 2]) : 1, 1]);
}
