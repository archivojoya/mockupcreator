// Construye la camiseta 3D a partir de los contornos del molde. Cada vértice
// conserva su coordenada del molde como UV, de modo que la textura del SVG cae
// exactamente sobre su pieza. La forma simula una prenda colgada de una
// percha: hombros apoyados, costuras cerradas y caída con pliegues suaves.

import * as THREE from 'three';
import { Drape } from './drape.js';

const BODY_LENGTH = 0.72; // m, del punto de cuello al ruedo
const ARM_OPEN = 0.03; // apertura (media) de la sisa
const HANGER_R = 0.0055;
const DROP_DEG = 66; // caída preferida de las mangas bajo la horizontal // radio de la barra de la percha

// ---------- utilidades 2D ----------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- sección del cuerpo: media elipse con largo de arco fijo ----------
// Una camiseta colgada no es plana: frente y espalda se separan y los costados
// se curvan hacia atrás. Para que la tela conserve su ancho real (el del
// molde), cada fila del cuerpo se reparte sobre media elipse cuyo arco mide
// lo mismo que la fila plana; así, cuanto más volumen, más angosta la silueta.

const ARC_K = 33; // relaciones profundidad/ancho tabuladas (0…1)
const ARC_N = 96; // muestras de ángulo por tabla
const ARC = (() => {
  const tables = [];
  for (let ki = 0; ki < ARC_K; ki++) {
    const k = ki / (ARC_K - 1);
    const cum = new Float32Array(ARC_N + 1);
    for (let i = 1; i <= ARC_N; i++) {
      const p0 = -Math.PI / 2 + (Math.PI * (i - 1)) / ARC_N;
      const p1 = -Math.PI / 2 + (Math.PI * i) / ARC_N;
      const pm = (p0 + p1) / 2;
      cum[i] = cum[i - 1] + Math.sqrt(Math.cos(pm) ** 2 + (k * Math.sin(pm)) ** 2) * (p1 - p0);
    }
    tables.push(cum);
  }
  return tables;
})();

// Largo de media elipse de semiejes (1, k).
function halfArc(k) {
  const f = clamp(k, 0, 1) * (ARC_K - 1);
  const i = Math.min(Math.floor(f), ARC_K - 2);
  return lerp(ARC[i][ARC_N], ARC[i + 1][ARC_N], f - i);
}

// Ángulo (−π/2…π/2) donde el arco recorrido es la fracción `t` del total.
function arcAngle(k, t) {
  const f = clamp(k, 0, 1) * (ARC_K - 1);
  const i = Math.min(Math.floor(f), ARC_K - 2);
  const w = f - i;
  const target = clamp(t, 0, 1);
  const total = lerp(ARC[i][ARC_N], ARC[i + 1][ARC_N], w);
  let lo = 0;
  let hi = ARC_N;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (lerp(ARC[i][m], ARC[i + 1][m], w) / total <= target) lo = m;
    else hi = m;
  }
  const c0 = lerp(ARC[i][lo], ARC[i + 1][lo], w) / total;
  const c1 = lerp(ARC[i][hi], ARC[i + 1][hi], w) / total;
  const a = lo + (c1 > c0 ? (target - c0) / (c1 - c0) : 0);
  return -Math.PI / 2 + (Math.PI * a) / ARC_N;
}

// Semiancho visible de una fila de ancho plano 2·W con profundidad B.
function ellipseHalfWidth(W, B) {
  if (B <= 1e-6) return W;
  let A = W;
  for (let it = 0; it < 6; it++) A = (2 * W) / halfArc(B / A);
  return A;
}

// Profundidad (semieje frente-espalda) del cuerpo según la altura.
function bodyDepth(b) {
  return 0.012 + 0.036 * smooth(0.02, 0.3, b) - 0.008 * smooth(0.55, 1, b);
}

function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function rowCrossings(pts, y) {
  const xs = [];
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  return xs.sort((p, q) => p - q);
}

// Camino sobre el polígono de i a j; se elige el sentido que (no) pasa por k.
function pathBetween(pts, i, j, k, throughK) {
  const n = pts.length;
  const walk = (dir) => {
    const out = [];
    let hit = false;
    for (let t = i; ; t = (t + dir + n) % n) {
      out.push(pts[t]);
      if (t === k) hit = true;
      if (t === j) break;
    }
    return { out, hit };
  };
  const a = walk(1);
  const b = walk(-1);
  if (k === undefined) return a.out.length <= b.out.length ? a.out : b.out;
  return a.hit === throughK ? a.out : b.out;
}

class Polyline {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    this.length = this.cum.at(-1) || 1e-9;
  }
  at(f) {
    const d = clamp(f, 0, 1) * this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= d) lo = m;
      else hi = m;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (d - this.cum[lo]) / seg;
    return { x: lerp(this.pts[lo].x, this.pts[hi].x, t), y: lerp(this.pts[lo].y, this.pts[hi].y, t) };
  }
}

function turningAt(pts, k, span) {
  // Ángulo de giro usando vecinos a cierta distancia (robusto a puntos densos).
  const p = pts[k];
  let a = k;
  while (a > 0 && Math.hypot(pts[a].x - p.x, pts[a].y - p.y) < span) a--;
  let b = k;
  while (b < pts.length - 1 && Math.hypot(pts[b].x - p.x, pts[b].y - p.y) < span) b++;
  const v1 = { x: p.x - pts[a].x, y: p.y - pts[a].y };
  const v2 = { x: pts[b].x - p.x, y: pts[b].y - p.y };
  const l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!l) return 0;
  return Math.acos(clamp((v1.x * v2.x + v1.y * v2.y) / l, -1, 1));
}

// ---------- pieza del cuerpo (frente / espalda) ----------

class Panel {
  constructor(part, kind) {
    this.part = part;
    this.kind = kind;
    const pts = part.poly;
    this.pts = pts;
    const { minX, maxX, minY, maxY } = part.bbox;
    Object.assign(this, { minX, maxX, minY, maxY });
    const cx = (minX + maxX) / 2;
    const idx = pts.map((_, i) => i);
    const left = idx.filter((i) => pts[i].x < cx);
    const right = idx.filter((i) => pts[i].x >= cx);
    const by = (list, f) => list.reduce((best, i) => (f(i) < f(best) ? i : best), list[0]);
    const iNL = by(left, (i) => pts[i].y + 1e-3 * (cx - pts[i].x));
    const iNR = by(right, (i) => pts[i].y + 1e-3 * (pts[i].x - cx));
    const iHem = by(idx, (i) => -pts[i].y);
    this.neckY = (pts[iNL].y + pts[iNR].y) / 2;
    const yLim = this.neckY + 0.55 * (maxY - this.neckY);
    const iUL = by(left.filter((i) => pts[i].y < yLim), (i) => pts[i].x);
    const iUR = by(right.filter((i) => pts[i].y < yLim), (i) => -pts[i].x);
    const span = (maxX - minX) * 0.015;
    const shoulderOf = (iN, iU) => {
      const path = pathBetween(pts, iN, iU, iHem, false);
      let best = Math.floor(path.length / 3);
      let bestA = -1;
      const n = path.length;
      for (let k = 1; k < n - 1; k++) {
        const a = turningAt(path, k, span);
        if (a > bestA) {
          bestA = a;
          best = k;
        }
      }
      return path[best];
    };
    this.neckL = pts[iNL];
    this.neckR = pts[iNR];
    this.uaL = pts[iUL];
    this.uaR = pts[iUR];
    this.shL = shoulderOf(iNL, iUL);
    this.shR = shoulderOf(iNR, iUR);
    this.H = maxY - this.neckY;
    this.S = BODY_LENGTH / this.H;
    this.neckCurve = new Polyline(pathBetween(pts, iNL, iNR, iHem, false));
    this.shoulderLineL = new Polyline(pathBetween(pts, iNL, pts.indexOf(this.shL), iHem, false));
    this.shoulderLineR = new Polyline(pathBetween(pts, iNR, pts.indexOf(this.shR), iHem, false));
    // Tabla de extremos por fila.
    this.rows = 1024;
    this.xl = new Float32Array(this.rows + 1);
    this.xr = new Float32Array(this.rows + 1);
    let last = [minX, maxX];
    for (let r = 0; r <= this.rows; r++) {
      const y = lerp(minY + 1e-3, maxY - 1e-3, r / this.rows);
      const xs = rowCrossings(pts, y);
      if (xs.length >= 2) last = [xs[0], xs.at(-1)];
      this.xl[r] = last[0];
      this.xr[r] = last[1];
    }
  }
  ext(y) {
    const f = clamp((y - this.minY) / (this.maxY - this.minY), 0, 1) * this.rows;
    const r = Math.min(Math.floor(f), this.rows - 1);
    const t = f - r;
    return [lerp(this.xl[r], this.xl[r + 1], t), lerp(this.xr[r], this.xr[r + 1], t)];
  }
  // Altura de la línea de hombros (costura superior) en x.
  ysh(x) {
    const { shL, neckL, neckR, shR } = this;
    if (x <= shL.x) return shL.y;
    if (x < neckL.x) return lerp(shL.y, neckL.y, (x - shL.x) / (neckL.x - shL.x));
    if (x <= neckR.x) return lerp(neckL.y, neckR.y, (x - neckL.x) / (neckR.x - neckL.x || 1));
    if (x < shR.x) return lerp(neckR.y, shR.y, (x - neckR.x) / (shR.x - neckR.x));
    return shR.y;
  }
  b(y) {
    return (y - this.neckY) / this.H;
  }
}

// ---------- modelo de la prenda ----------

export class GarmentModel {
  constructor(mold) {
    const P = mold.parts;
    const frontPart = P.front || P.back;
    const backPart = P.back || P.front;
    if (!frontPart) throw new Error('No se encontró la pieza del frente ni de la espalda en el SVG.');
    this.mold = mold;
    this.front = new Panel(frontPart, 'front');
    this.back = new Panel(backPart, 'back');
    const panels = [this.front, this.back];
    this.bSh = avg(panels.map((p) => p.b((p.shL.y + p.shR.y) / 2)));
    this.bUA = avg(panels.map((p) => p.b((p.uaL.y + p.uaR.y) / 2)));
    // Semiancho compartido para que las costuras laterales coincidan.
    this.wRows = 512;
    this.bMin = Math.min(...panels.map((p) => p.b(p.minY)));
    this.W = new Float32Array(this.wRows + 1);
    for (let r = 0; r <= this.wRows; r++) {
      const b = lerp(this.bMin, 1, r / this.wRows);
      this.W[r] = avg(panels.map((p) => {
        const [xl, xr] = p.ext(p.neckY + b * p.H);
        return ((xr - xl) / 2) * p.S;
      }));
    }
    this.seeds = { front: [0.7, 2.1, 4.0], back: [2.4, 0.3, 1.2] };
  }

  Wb(b) {
    const f = clamp((b - this.bMin) / (1 - this.bMin), 0, 1) * this.wRows;
    const r = Math.min(Math.floor(f), this.wRows - 1);
    return lerp(this.W[r], this.W[r + 1], f - r);
  }

  // Posición 3D de un punto (x, y) del molde de una pieza del cuerpo.
  bodyPos(panel, x, y, out = new THREE.Vector3()) {
    const b = panel.b(y);
    const [xl, xr] = panel.ext(y);
    const s = (x - xl) / (xr - xl || 1);
    const W = this.Wb(b);
    const sign = panel.kind === 'front' ? 1 : -1;
    const Y = -b * BODY_LENGTH;
    // Junto a la costura de hombros frente y espalda se juntan (sin volumen).
    const dy = Math.max(0, (y - panel.ysh(x)) * panel.S);
    const q = Math.min(dy / 0.03, 1);
    const h = Math.sqrt(1 - (1 - q) ** 2);
    const B = bodyDepth(b) * h;
    const A = ellipseHalfWidth(W, B);
    const phi = arcAngle(B / A, s);
    // En los hombros la tela apoya sobre la percha: perfil plano hasta los
    // bordes. Hacia abajo pasa a la media elipse.
    const flat = Math.sqrt(Math.max(0, 1 - Math.abs(Math.sin(phi)) ** 4));
    const g = lerp(flat, Math.cos(phi), smooth(this.bSh, this.bUA, b));
    let X = A * Math.sin(phi) * sign;
    // Apertura de la sisa: frente y espalda se separan donde va la manga.
    const ta = (b - this.bSh) / (this.bUA - this.bSh);
    const e = ta > 0 && ta < 1 ? ARM_OPEN * Math.sin(Math.PI * ta) ** 0.75 : 0;
    const fold = this.fold(panel.kind, X, b, Y);
    // Ondulación leve del costado (igual en frente y espalda: la costura cierra).
    const rip = 0.005 * smooth(0.45, 1, b) * Math.sin(b * 23 + (X > 0 ? 0.8 : 2.1));
    X += Math.sign(X) * rip * Math.abs(2 * s - 1) ** 3;
    const Z = (B * g + e * h * (1 - g) + 0.022 * fold * g * g * h);
    return out.set(X, Y, Z * sign);
  }

  // Semiancho visible del cuerpo (con volumen) a la altura b.
  halfWidth(b) {
    return ellipseHalfWidth(this.Wb(b), bodyDepth(b));
  }

  // Pliegues de caída: ondas verticales abajo, diagonales desde los hombros.
  fold(kind, X, b, Y) {
    const [p1, p2, p3] = this.seeds[kind];
    const lower = smooth(0.3, 1.0, b);
    let f = 0.7 * lower * Math.sin((X * Math.PI * 2) / 0.16 + p1 + 1.6 * Math.sin(b * 4.5 + p2));
    f += 0.22 * lower * Math.sin((X * Math.PI * 2) / 0.07 + p2 + 2.5 * b);
    // Arrugas diagonales que bajan desde las puntas de la percha (asimétricas).
    const right = X > 0;
    const upper = smooth(0.06, 0.16, b) * (1 - smooth(0.28, right ? 0.5 : 0.42, b));
    const d = Math.abs(X) * (right ? 0.75 : 0.62) - Y * (right ? 0.65 : 0.78);
    const fade = smooth(0.02, 0.12, Math.abs(X)) * (0.6 + 0.4 * Math.sin(X * 31 + p1));
    f += 0.24 * upper * fade * Math.sin((d * Math.PI * 2) / (right ? 0.1 : 0.125) + p3 + (right ? 0 : 1.9));
    // Caída vertical desde las puntas de los hombros.
    const ax = Math.abs(X) - 0.17;
    f -= 0.35 * smooth(0.12, 0.4, b) * Math.exp(-((ax / 0.035) ** 2)) * (1 - 0.4 * smooth(0.6, 1, b));
    f += 0.25 * smooth(0.88, 1, b) * Math.sin((X * Math.PI * 2) / 0.11 + p3);
    return f;
  }

  // ---------- mallas ----------

  buildBody(panel, atlas, cols = 60) {
    const pts = panel.pts;
    const cell = (panel.maxX - panel.minX) / cols;
    const rows = Math.ceil((panel.maxY - panel.minY) / cell);
    const positions = [];
    const uvs = [];
    const normals = [];
    const index = [];
    const keyMap = new Map();
    const px = [];
    const py = [];
    const v = new THREE.Vector3();
    const dx = new THREE.Vector3();
    const dy = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const eps = cell * 0.25;
    const orient = panel.kind === 'front' ? 1 : -1;
    const vertex = (x, y) => {
      const key = `${Math.round(x * 100)},${Math.round(y * 100)}`;
      let id = keyMap.get(key);
      if (id !== undefined) return id;
      id = positions.length / 3;
      keyMap.set(key, id);
      px.push(x);
      py.push(y);
      this.bodyPos(panel, x, y, v);
      positions.push(v.x, v.y, v.z);
      const [u, w] = atlas.uv(x, y);
      uvs.push(u, w);
      this.bodyPos(panel, x + eps, y, dx).sub(this.bodyPos(panel, x - eps, y, tmp));
      this.bodyPos(panel, x, y + eps, dy).sub(this.bodyPos(panel, x, y - eps, tmp));
      const n = dx.cross(dy).normalize();
      if (n.z * orient < 0) n.negate();
      normals.push(n.x, n.y, n.z);
      return id;
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = panel.minX + c * cell;
        const y0 = panel.minY + r * cell;
        const x1 = x0 + cell;
        const y1 = y0 + cell;
        const clipped = clipToRect(pts, x0, y0, x1, y1);
        if (clipped.length < 3) continue;
        let tris;
        if (clipped.length === 4 && isRect(clipped, x0, y0, x1, y1)) {
          tris = [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]];
        } else {
          const contour = clipped.map((p) => new THREE.Vector2(p.x, p.y));
          const faces = THREE.ShapeUtils.triangulateShape(contour, []);
          tris = faces.flat().map((i) => [clipped[i].x, clipped[i].y]);
          // Si la triangulación pierde superficie (contorno degenerado), abanico.
          let area = 0;
          for (let t = 0; t < tris.length; t += 3) area += Math.abs(triArea(tris[t], tris[t + 1], tris[t + 2]));
          if (Math.abs(area - Math.abs(THREE.ShapeUtils.area(contour))) > cell * cell * 0.01) {
            tris = [];
            for (let k = 1; k + 1 < clipped.length; k++) {
              tris.push([clipped[0].x, clipped[0].y], [clipped[k].x, clipped[k].y], [clipped[k + 1].x, clipped[k + 1].y]);
            }
          }
        }
        for (let t = 0; t < tris.length; t += 3) {
          const a = vertex(...tris[t]);
          const b = vertex(...tris[t + 1]);
          const c2 = vertex(...tris[t + 2]);
          index.push(a, b, c2);
        }
      }
    }
    const geo = finishGeometry(positions, normals, uvs, index);
    geo.userData = { panel, px: Float32Array.from(px), py: Float32Array.from(py) };
    return geo;
  }

  // Bucle de la sisa en 3D. u: 0 axila → 0.5 hombro (por delante) → 1 axila (por detrás)
  armholePoint(side, u, out = new THREE.Vector3()) {
    const front = u <= 0.5;
    const panel = front ? this.front : this.back;
    const t = front ? u / 0.5 : (1 - u) / 0.5;
    const b = lerp(this.bUA, this.bSh, t);
    const y = panel.neckY + b * panel.H;
    const [xl, xr] = panel.ext(y);
    // +X es el costado izquierdo del usuario: en el frente es el borde derecho
    // del molde y en la espalda (vista desde atrás) el izquierdo.
    const useRight = (side > 0) === front;
    return this.bodyPos(panel, useRight ? xr : xl, y, out);
  }

  buildSleeve(part, side, atlas) {
    const pts = part.poly;
    const idx = pts.map((_, i) => i);
    const by = (list, f) => list.reduce((best, i) => (f(i) < f(best) ? i : best), list[0]);
    const { minY, maxY } = part.bbox;
    const iCL = by(idx, (i) => pts[i].x);
    const iCR = by(idx, (i) => -pts[i].x);
    const iTop = by(idx, (i) => pts[i].y);
    const lowSet = idx.filter((i) => pts[i].y >= maxY - (maxY - minY) * 0.03);
    const iHL = by(lowSet, (i) => pts[i].x);
    const iHR = by(lowSet, (i) => -pts[i].x);
    const cap = new Polyline(pathBetween(pts, iCL, iCR, iTop, true));
    const hem = new Polyline(pathBetween(pts, iHL, iHR, iTop, false));
    const sideL = new Polyline(pathBetween(pts, iCL, iHL, iTop, false));
    const sideR = new Polyline(pathBetween(pts, iCR, iHR, iTop, false));
    const coons = (u, t) => {
      const T = cap.at(u);
      const B = hem.at(u);
      const L = sideL.at(t);
      const R = sideR.at(t);
      const TL = cap.at(0);
      const TR = cap.at(1);
      const BL = hem.at(0);
      const BR = hem.at(1);
      const f = (k) =>
        (1 - t) * T[k] + t * B[k] + (1 - u) * L[k] + u * R[k] -
        ((1 - u) * (1 - t) * TL[k] + u * (1 - t) * TR[k] + (1 - u) * t * BL[k] + u * t * BR[k]);
      return { x: f('x'), y: f('y') };
    };
    const S = this.front.S;
    const topLen = Math.hypot(hem.at(0.5).x - pts[iTop].x, hem.at(0.5).y - pts[iTop].y) * S;
    const underLen = ((sideL.length + sideR.length) / 2) * S;
    const rY = (hem.length * S) / 4.2;
    const rZ = 0.012;

    const Nu = 72;
    const Nt = 28;
    const A = [];
    for (let i = 0; i <= Nu; i++) A.push(this.armholePoint(side, i / Nu));
    const Ac = A.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / A.length);
    Ac.z = 0;

    const hemFrame = (alpha, Ls) => {
      const D = new THREE.Vector3(side * Math.cos(alpha), -Math.sin(alpha), 0);
      const up = new THREE.Vector3(side * Math.sin(alpha), Math.cos(alpha), 0);
      const Hc = Ac.clone().addScaledVector(D, Ls);
      return { D, up, Hc };
    };
    const hemPoint = (fr, u) => {
      const th = Math.PI - 2 * Math.PI * u;
      return fr.Hc.clone().addScaledVector(fr.up, Math.cos(th) * rY).add(new THREE.Vector3(0, 0, Math.sin(th) * rZ));
    };
    // Curva de la manga (Hermite) desde la sisa hasta el ruedo para cada u.
    const T0 = new THREE.Vector3();
    const curve = (fr, u, t, a0, out) => {
      const h1 = hemPoint(fr, u);
      const top = (1 - Math.cos(2 * Math.PI * u)) / 2;
      T0.set(side, -1.1 + 0.6 * top, 0).normalize();
      const m = a0.distanceTo(h1) * 0.9;
      const t2 = t * t;
      const t3 = t2 * t;
      return out.copy(a0).multiplyScalar(2 * t3 - 3 * t2 + 1)
        .addScaledVector(T0, (t3 - 2 * t2 + t) * m)
        .addScaledVector(h1, -2 * t3 + 3 * t2)
        .addScaledVector(fr.D, (t3 - t2) * m);
    };
    // La manga no puede empezar metida dentro del cuerpo: se mide cuánto
    // entra la parte de abajo (axila) en el ancho del cuerpo.
    const tmpP = new THREE.Vector3();
    const insideBody = (fr) => {
      let worst = 0;
      for (const iu of [0, Math.round(Nu * 0.1), Math.round(Nu * 0.2), Nu - Math.round(Nu * 0.2), Nu - Math.round(Nu * 0.1)]) {
        for (let k = 1; k <= 6; k++) {
          const P = curve(fr, iu / Nu, k / 6, A[iu], tmpP);
          const b = -P.y / BODY_LENGTH;
          if (b < this.bUA) continue;
          worst = Math.max(worst, this.halfWidth(b) + 0.002 - P.x * side);
        }
      }
      return worst;
    };
    // Ángulo de caída y largo que respetan los largos del molde.
    let best = null;
    for (let a = 30; a <= 75; a += 1) {
      for (let Ls = 0.03; Ls <= 0.4; Ls += 0.004) {
        const fr = hemFrame((a * Math.PI) / 180, Ls);
        const e1 = hemPoint(fr, 0.5).distanceTo(A[Nu / 2]) - topLen;
        const e2 = hemPoint(fr, 0).distanceTo(A[0]) - underLen;
        const err = e1 * e1 + e2 * e2 + 6e-5 * (a - DROP_DEG) ** 2;
        if (best && err > best.err) continue;
        const pen = insideBody(fr);
        const total = err + 4 * pen * pen;
        if (!best || total < best.err) best = { err: total, fr };
      }
    }
    const fr = best.fr;

    const positions = [];
    const uvs = [];
    const index = [];
    const px = [];
    const py = [];
    const P = new THREE.Vector3();
    for (let i = 0; i <= Nu; i++) {
      const u = i / Nu;
      const a0 = A[i];
      const pu = side > 0 ? u : 1 - u;
      for (let j = 0; j <= Nt; j++) {
        const t = j / Nt;
        curve(fr, u, t, a0, P);
        if (j === 0) {
          P.addScaledVector(T0, -0.004);
          P.z *= 0.75;
        }
        positions.push(P.x, P.y, P.z);
        const q = coons(pu, t);
        px.push(q.x);
        py.push(q.y);
        uvs.push(...atlas.uv(q.x, q.y));
      }
    }
    const row = Nt + 1;
    for (let i = 0; i < Nu; i++) {
      for (let j = 0; j < Nt; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mid = Ac.clone().lerp(fr.Hc, 0.5);
    orientOutward(geo, (n, p) => n.dot(p.clone().sub(mid)), index);
    weldSeamNormals(geo, Nu, row);
    geo.userData = { px: Float32Array.from(px), py: Float32Array.from(py), Nu, row, side, weld: (g) => weldSeamNormals(g, Nu, row) };
    return geo;
  }

  // Bucle del escote: centro espalda → lado −X → frente → lado +X → centro espalda.
  neckLoop() {
    const samples = [];
    const add = (panel, poly, f0, f1, n) => {
      for (let i = 0; i < n; i++) {
        const f = lerp(f0, f1, i / n);
        samples.push({ panel, poly, f });
      }
    };
    const fc = this.front.neckCurve;
    const bc = this.back.neckCurve;
    const total = fc.length + bc.length;
    const nB = Math.round(160 * (bc.length / total));
    const nF = 160 - nB;
    add(this.back, bc, 0.5, 1, Math.round(nB / 2));
    add(this.front, fc, 0, 1, nF);
    add(this.back, bc, 0, 0.5, nB - Math.round(nB / 2));
    samples.push(samples[0]);
    return samples;
  }

  buildCollar(atlas, collarPart) {
    const loop = this.neckLoop();
    const height = 0.0135;
    const thick = 0.0035;
    // Perfil: cara exterior subiendo, borde redondeado y cara interior bajando.
    const prof = [];
    const M = 6;
    prof.push({ up: -0.004, inn: -0.0009, v: 0 });
    for (let i = 0; i <= M; i++) prof.push({ up: (height * i) / M, inn: -0.0009 * (1 - i / M), v: (0.5 * i) / M });
    for (let i = 1; i < 6; i++) {
      const a = (Math.PI * i) / 6;
      prof.push({ up: height + Math.sin(a) * thick * 0.5, inn: thick * 0.5 * (1 - Math.cos(a)), v: 0.5 });
    }
    for (let i = 0; i <= M; i++) prof.push({ up: height - ((height + 0.004) * i) / M, inn: thick, v: 0.5 + (0.5 * i) / M });
    const lengths = [0];
    const pos3 = loop.map((s) => {
      const p = s.poly.at(s.f);
      return this.bodyPos(s.panel, p.x, p.y);
    });
    for (let i = 1; i < pos3.length; i++) lengths.push(lengths[i - 1] + pos3[i].distanceTo(pos3[i - 1]));
    const total = lengths.at(-1);
    const positions = [];
    const uvs = [];
    const index = [];
    const bb = collarPart?.bbox;
    const tmp = new THREE.Vector3();
    const ups = loop.map((s, i) => {
      const N = pos3[i];
      const p = s.poly.at(s.f);
      const q = s.poly.at(Math.min(1, s.f + 0.002));
      const q0 = s.poly.at(Math.max(0, s.f - 0.002));
      let nx = -(q.y - q0.y);
      let ny = q.x - q0.x;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const d = s.panel.H * 0.02;
      if (!pointInPoly(s.panel.pts, p.x + nx * d, p.y + ny * d)) {
        nx = -nx;
        ny = -ny;
      }
      const inner = this.bodyPos(s.panel, p.x + nx * d, p.y + ny * d, tmp);
      return N.clone().sub(inner).normalize();
    });
    // Suaviza las direcciones para evitar picos en las esquinas del escote.
    const n = ups.length - 1;
    for (let pass = 0; pass < 3; pass++) {
      const prev = ups.map((v) => v.clone());
      for (let i = 0; i < n; i++) {
        ups[i].copy(prev[(i - 1 + n) % n]).add(prev[i]).add(prev[(i + 1) % n]).normalize();
      }
      ups[n].copy(ups[0]);
    }
    loop.forEach((s, i) => {
      const N = pos3[i];
      const up = ups[i];
      const inn = new THREE.Vector3(-N.x, 0, -N.z).normalize();
      const u = lengths[i] / total;
      for (const pr of prof) {
        const P = N.clone().addScaledVector(up, pr.up).addScaledVector(inn, pr.inn);
        positions.push(P.x, P.y, P.z);
        if (bb) uvs.push(...atlas.uv(lerp(bb.minX, bb.maxX, u), lerp(bb.minY, bb.maxY, pr.v)));
        else uvs.push(u, pr.v);
      }
    });
    const row = prof.length;
    for (let i = 0; i < loop.length - 1; i++) {
      for (let j = 0; j < row - 1; j++) {
        const a = i * row + j;
        const b = (i + 1) * row + j;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    geo.userData = { row };
    return geo;
  }

  // Percha: barra bajo la costura de hombros, pieza central y gancho.
  buildHanger() {
    const f = this.front;
    const pts = [];
    const S = f.S;
    const drop = (HANGER_R + 0.006) / S;
    const sampleLine = (line, from, to, n) => {
      for (let i = 0; i <= n; i++) {
        const p = line.at(lerp(from, to, i / n));
        const v = this.bodyPos(f, p.x, p.y + drop);
        v.z = 0;
        pts.push(v);
      }
    };
    sampleLine(f.shoulderLineL, 0.72, 0, 10);
    const yN = pts.at(-1).y;
    pts.push(new THREE.Vector3(0, yN + 0.012, 0));
    sampleLine(f.shoulderLineR, 0, 0.72, 10);
    const bar = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 120, HANGER_R, 16, false);
    const hookBase = new THREE.Vector3(0, yN + 0.012, 0);
    const r = 0.022;
    const stemTop = hookBase.clone().add(new THREE.Vector3(0, 0.045, 0));
    const hookPts = [hookBase.clone().add(new THREE.Vector3(0, 0.005, 0)), stemTop];
    for (let i = 1; i <= 14; i++) {
      const a = (i / 14) * (Math.PI * 1.15);
      hookPts.push(new THREE.Vector3(0, stemTop.y + Math.sin(a) * r, -r + Math.cos(a) * r));
    }
    const hook = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 60, 0.0028, 10, false);
    const tip = new THREE.SphereGeometry(0.0032, 12, 8).translate(hookPts.at(-1).x, hookPts.at(-1).y, hookPts.at(-1).z);
    const caps = [pts[0], pts.at(-1)].map((p) => new THREE.SphereGeometry(HANGER_R, 16, 10).translate(p.x, p.y, p.z));
    const rodY = stemTop.y + r - 0.0028 - 0.006;
    return { bar, hook, tip, caps, rodY, rodZ: -r, barPts: pts };
  }

  // Prepara la simulación de caída: piezas, costuras, fijaciones y colisiones.
  setupDrape(geos, hanger) {
    const mk = (key, geo, S) => {
      const { px, py } = geo.userData;
      const rest2D = new Float32Array(px.length * 2);
      for (let i = 0; i < px.length; i++) {
        rest2D[i * 2] = px[i] * S;
        rest2D[i * 2 + 1] = py[i] * S;
      }
      return { key, geo, rest2D };
    };
    // El cuerpo conserva su curvatura (volumen) al asentarse.
    const pieces = [
      { ...mk('front', geos.front, this.front.S), bendRest3D: true },
      { ...mk('back', geos.back, this.back.S), bendRest3D: true },
    ];
    // Las mangas cuelgan con algo más de cuerpo (costura de hombro y dobladillo).
    // Las mangas toman como largo de reposo su forma inicial lisa (no el
    // molde): así no se arrugan al asentarse y quedan como planchadas.
    if (geos.sleeveL) pieces.push({ key: 'sleeveL', geo: geos.sleeveL, rest2D: null, side: 1, bendCompliance: 2e-8, shapeMemory: 0.004 });
    if (geos.sleeveR) pieces.push({ key: 'sleeveR', geo: geos.sleeveR, rest2D: null, side: -1, bendCompliance: 2e-8, shapeMemory: 0.004 });
    const collar = { key: 'collar', geo: geos.collar, rest2D: null };
    pieces.push(collar);
    const hangerEnd = Math.max(...hanger.barPts.map((p) => Math.abs(p.x)));
    // Distancia (m) de cada punto del molde al escote: el escote y el cuello
    // acanalado conservan su forma, el resto de la tela cae.
    const neckDist = (panel, x, y) => {
      let best = Infinity;
      for (const q of panel.neckCurve.pts) best = Math.min(best, (q.x - x) ** 2 + (q.y - y) ** 2);
      return Math.sqrt(best) * panel.S;
    };
    const drape = new Drape({
      pieces,
      hanger: hanger.barPts,
      hangerRadius: HANGER_R + 0.0025,
      isPinned: (orig, pc, i) => {
        if (pc.key === 'collar') return true;
        if (pc.key !== 'front' && pc.key !== 'back') return false;
        const panel = pc.key === 'front' ? this.front : this.back;
        const { px, py } = pc.geo.userData;
        if (neckDist(panel, px[i], py[i]) < 0.014) return true;
        const dy = (py[i] - panel.ysh(px[i])) * panel.S;
        const X = orig[(pc.offset + i) * 3];
        return dy < 0.012 && Math.abs(X) < hangerEnd + 0.004;
      },
    });
    const [front, back] = pieces;
    const sleeves = pieces.filter((pc) => pc.side);
    const z0 = (i) => drape.orig[i * 3 + 2];
    // Costuras laterales y de hombro: donde frente y espalda se tocan.
    drape.sewBoundaries(front, [back], 0.008, (i) => Math.abs(z0(i)) < 0.003, false);
    drape.sewBoundaries(back, [front], 0.008, (i) => Math.abs(z0(i)) < 0.003, false);
    for (const sl of sleeves) {
      const { Nu, row } = sl.geo.userData;
      // Costura bajo el brazo (primera y última columna) y unión a la sisa.
      for (let j = 0; j < row; j++) drape.stitch(sl.offset + j, sl.offset + Nu * row + j);
      drape.sewBoundaries(sl, [front, back], 0.03, (i) => (i - sl.offset) % row === 0);
    }
    // Y al revés: el borde de la sisa del cuerpo se cose a la manga, para que
    // no quede abierto entre puntadas.
    if (sleeves.length) {
      const ring = (pc) => [...pc.boundary].filter((l) => l % pc.geo.userData.row === 0).map((l) => pc.offset + l);
      const ringPts = sleeves.flatMap(ring);
      for (const body of [front, back]) {
        for (const l of body.boundary) {
          const i = body.offset + l;
          if (drape.w[i] === 0) continue;
          let best = -1;
          let bd = 0.012 ** 2;
          for (const j of ringPts) {
            const d = (drape.orig[i * 3] - drape.orig[j * 3]) ** 2 + (drape.orig[i * 3 + 1] - drape.orig[j * 3 + 1]) ** 2 + (drape.orig[i * 3 + 2] - drape.orig[j * 3 + 2]) ** 2;
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
          if (best >= 0) drape.stitch(i, best);
        }
      }
    }
    // El cuello se cose por su borde inferior al escote.
    const crow = collar.geo.userData.row;
    drape.sewBoundaries(collar, [front, back], 0.015, (i) => (i - collar.offset) % crow <= 1);
    // La tela no atraviesa el plano entre frente y espalda (ni entre las dos
    // caras de la manga), salvo en las costuras donde se juntan.
    for (const pc of pieces) {
      for (let k = 0; k < pc.count; k++) {
        const i = pc.offset + k;
        const z = z0(i);
        if (pc.key === 'front') drape.halfZ[i] = z > 0.002 ? 0.0015 : 0;
        else if (pc.key === 'back') drape.halfZ[i] = z < -0.002 ? -0.0015 : 0;
        // Las mangas conservan parte de su volumen: no se aplastan del todo.
        else if (pc.side) drape.halfZ[i] = Math.abs(z) > 0.003 ? z * 0.65 : 0;
      }
    }
    // Las mangas no se meten dentro del cuerpo.
    const sleeveOf = pieces.map((pc) => pc.side || 0);
    drape.collide = (i, pos) => {
      const side = sleeveOf[drape.owner[i]];
      if (!side) return;
      const k = i * 3;
      const b = -pos[k + 1] / BODY_LENGTH;
      if (b < this.bUA + 0.01 || Math.abs(pos[k + 2]) > 0.035) return;
      const lim = this.halfWidth(b) + 0.004;
      if (pos[k] * side < lim) pos[k] = side * lim;
    };
    drape.buildTethers();
    for (const sl of sleeves) sl.afterApply = sl.geo.userData.weld;
    return drape;
  }
}

function avg(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function clipToRect(poly, x0, y0, x1, y1) {
  let out = poly;
  const edges = [
    (p) => p.x >= x0, (p) => p.x <= x1, (p) => p.y >= y0, (p) => p.y <= y1,
  ];
  const inter = [
    (a, b) => ({ x: x0, y: a.y + ((x0 - a.x) * (b.y - a.y)) / (b.x - a.x) }),
    (a, b) => ({ x: x1, y: a.y + ((x1 - a.x) * (b.y - a.y)) / (b.x - a.x) }),
    (a, b) => ({ x: a.x + ((y0 - a.y) * (b.x - a.x)) / (b.y - a.y), y: y0 }),
    (a, b) => ({ x: a.x + ((y1 - a.y) * (b.x - a.x)) / (b.y - a.y), y: y1 }),
  ];
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    if (!input.length) break;
    const inside = edges[e];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(inter[e](prev, cur));
        out.push(cur);
      } else if (pi) out.push(inter[e](prev, cur));
    }
  }
  // Limpia duplicados consecutivos.
  const clean = [];
  for (const p of out) {
    const q = clean.at(-1);
    if (!q || Math.abs(p.x - q.x) > 1e-6 || Math.abs(p.y - q.y) > 1e-6) clean.push(p);
  }
  if (clean.length > 1 && Math.abs(clean[0].x - clean.at(-1).x) < 1e-6 && Math.abs(clean[0].y - clean.at(-1).y) < 1e-6) clean.pop();
  return clean;
}

function triArea(a, b, c) {
  return ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

function isRect(pts, x0, y0, x1, y1) {
  return pts.every((p) => (Math.abs(p.x - x0) < 1e-6 || Math.abs(p.x - x1) < 1e-6) && (Math.abs(p.y - y0) < 1e-6 || Math.abs(p.y - y1) < 1e-6));
}

function finishGeometry(positions, normals, uvs, index) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // Ordena el sentido de cada triángulo según su normal (cara exterior = frontal).
  const p = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const fn = p(b).sub(p(a)).cross(p(c).sub(p(a)));
    const vn = new THREE.Vector3(normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]);
    if (fn.dot(vn) < 0) {
      index[t + 1] = c;
      index[t + 2] = b;
    }
  }
  geo.setIndex(index);
  return geo;
}

function weldSeamNormals(geo, Nu, row) {
  const n = geo.attributes.normal;
  for (let j = 0; j < row; j++) {
    const a = j;
    const b = Nu * row + j;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

function orientOutward(geo, score, index) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  let s = 0;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 7) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    s += Math.sign(score(n, p));
  }
  if (s >= 0) return;
  for (let t = 0; t < index.length; t += 3) {
    const tmp = index[t + 1];
    index[t + 1] = index[t + 2];
    index[t + 2] = tmp;
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
}
