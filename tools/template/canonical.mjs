// Molde canónico de la camiseta plantilla (mm, y hacia abajo como en un SVG).
// Es el molde con el que se simula, una sola vez, la caída "ideal"; cualquier
// molde del cliente se estampa después sobre esa forma. No pretende copiar
// ningún molde real: está pensado para colgar bien (hombros poco caídos,
// cuello redondo, copa de manga sin frunces).

export const DIMS = {
  neckHalf: 85, // semiancho del escote
  frontDrop: 88, // profundidad del escote delantero
  backDrop: 22, // profundidad del escote trasero
  shoulderX: 222, // punta del hombro
  shoulderDrop: 30, // caída del hombro desde el punto del cuello
  armX: 255, // axila
  armY: 232, // profundidad de sisa (desde el punto del cuello)
  hemX: 252, // costado en el ruedo
  length: 720, // del punto del cuello al ruedo
  sleeveW: 400, // ancho de la manga en la axila (de esquina a esquina)
  sleeveHemW: 360,
  sleeveL: 225, // de la cabeza de la copa al ruedo
  capEase: 1.0, // largo de la copa respecto de la sisa (frente + espalda)
};

const bez = (p0, p1, p2, p3, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const d = t ** 3;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return out;
};
const line = (p, q, n) => Array.from({ length: n + 1 }, (_, i) => ({ x: p.x + ((q.x - p.x) * i) / n, y: p.y + ((q.y - p.y) * i) / n }));
const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);

// Sisa del lado derecho (x > 0), del hombro a la axila.
function armholeRight(d) {
  const sh = { x: d.shoulderX, y: d.shoulderDrop };
  const ua = { x: d.armX, y: d.armY };
  return bez(sh, { x: sh.x - 12, y: sh.y + 80 }, { x: ua.x - 40, y: ua.y - 18 }, ua, 60);
}

function bodyPoly(d, drop) {
  const R = [];
  // Escote: del centro al punto del cuello derecho.
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * (Math.PI / 2);
    R.push({ x: d.neckHalf * Math.sin(t), y: drop * Math.cos(t) });
  }
  R.push(...line({ x: d.neckHalf, y: 0 }, { x: d.shoulderX, y: d.shoulderDrop }, 30).slice(1));
  R.push(...armholeRight(d).slice(1));
  R.push(...line({ x: d.armX, y: d.armY }, { x: d.hemX, y: d.length }, 80).slice(1));
  R.push(...line({ x: d.hemX, y: d.length }, { x: 0, y: d.length }, 50).slice(1));
  // Mitad izquierda, espejada (sin repetir el centro).
  const L = R.slice(1, -1).map((p) => ({ x: -p.x, y: p.y })).reverse();
  return [...R.slice(0, -1), { x: 0, y: d.length }, ...L];
}

function sleevePoly(d, ch) {
  const W = d.sleeveW / 2;
  const pts = [];
  for (let i = 0; i <= 120; i++) {
    const x = -W + (2 * W * i) / 120;
    pts.push({ x, y: ch * (1 - Math.sin((Math.PI * (x + W)) / (2 * W)) ** 2) });
  }
  pts.push(...line({ x: W, y: ch }, { x: d.sleeveHemW / 2, y: d.sleeveL }, 40).slice(1));
  pts.push(...line({ x: d.sleeveHemW / 2, y: d.sleeveL }, { x: -d.sleeveHemW / 2, y: d.sleeveL }, 60).slice(1));
  pts.push(...line({ x: -d.sleeveHemW / 2, y: d.sleeveL }, { x: -W, y: ch }, 40).slice(1, -1));
  return pts;
}

const shift = (pts, dx, dy) => pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
function part(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { poly: pts, bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } };
}

export function canonicalMold(d = DIMS) {
  const armLen = len(armholeRight(d));
  // Altura de copa tal que la copa mida lo mismo que la sisa (frente + espalda).
  let lo = 20;
  let hi = 220;
  for (let it = 0; it < 40; it++) {
    const ch = (lo + hi) / 2;
    const capLen = len(sleevePoly(d, ch).slice(0, 121));
    if (capLen < 2 * armLen * d.capEase) lo = ch;
    else hi = ch;
  }
  const ch = (lo + hi) / 2;
  const front = part(shift(bodyPoly(d, d.frontDrop), 300, 20));
  const back = part(shift(bodyPoly(d, d.backDrop), 900, 20));
  const sl = part(shift(sleevePoly(d, ch), 1500, 20));
  const sr = part(shift(sleevePoly(d, ch), 2000, 20));
  return { parts: { front, back, sleeveL: sl, sleeveR: sr }, capHeight: ch, armholeLength: armLen, viewBox: { w: 2300, h: 800 } };
}
