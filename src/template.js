// Camiseta a partir de la plantilla: la forma 3D ya viene simulada (una
// camiseta "ideal" colgada, ver tools/template) y cada molde del cliente se
// estampa sobre ella. Cada partícula de la plantilla conoce su lugar en el
// molde canónico; se lleva al molde del cliente con una deformación suave que
// hace coincidir los contornos (escote con escote, sisa con sisa, ruedo con
// ruedo), así el diseño cae donde corresponde con cualquier molde.

import * as THREE from 'three';
import { Panel, Polyline, pathBetween, sleeveCap, sleeveFrame, capFraction, hangerBarGeometry } from './garment.js';
import template from './assets/tshirt-template.json';

const BODY_LENGTH = 0.72;

const decode = (b64, Type) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
};

let cache = null;
function loadTemplate(tpl = template) {
  if (cache && cache.src === tpl) return cache;
  const pieces = {};
  const scaled = (b64, step) => Float32Array.from(decode(b64, Int16Array), (v) => v * step);
  for (const [key, p] of Object.entries(tpl.pieces)) {
    pieces[key] = {
      position: scaled(p.position, tpl.posStep),
      index: decode(p.index, Uint16Array),
      mold: p.mold ? scaled(p.mold, tpl.moldStep) : null,
      uv: p.uv ? Float32Array.from(decode(p.uv, Uint16Array), (v) => v / 65535) : null,
      side: p.side,
    };
  }
  const canonical = {};
  for (const [key, c] of Object.entries(tpl.canonical)) canonical[key] = { poly: c.poly.map(([x, y]) => ({ x, y })), bbox: c.bbox };
  cache = { src: tpl, pieces, canonical, seams: tpl.seams, neck: tpl.neck, hanger: tpl.hanger };
  return cache;
}

// ---------- deformación suave entre contornos (thin plate spline) ----------

function solve(A, B) {
  // Eliminación gaussiana con pivoteo; B tiene varias columnas.
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [B[c], B[p]] = [B[p], B[c]];
    const d = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (let k = 0; k < B[r].length; k++) B[r][k] -= f * B[c][k];
    }
  }
  const X = B.map((row) => row.map(() => 0));
  for (let r = n - 1; r >= 0; r--) {
    for (let k = 0; k < B[r].length; k++) {
      let s = B[r][k];
      for (let c = r + 1; c < n; c++) s -= A[r][c] * X[c][k];
      X[r][k] = s / (A[r][r] || 1e-12);
    }
  }
  return X;
}

function thinPlate(src, dst) {
  const n = src.length;
  // Coordenadas normalizadas (mejor condicionamiento).
  let mx = 0;
  let my = 0;
  for (const p of src) {
    mx += p.x / n;
    my += p.y / n;
  }
  let sc = 0;
  for (const p of src) sc = Math.max(sc, Math.abs(p.x - mx), Math.abs(p.y - my));
  sc = sc || 1;
  const P = src.map((p) => [(p.x - mx) / sc, (p.y - my) / sc]);
  const U = (r2) => (r2 > 1e-12 ? r2 * Math.log(r2) * 0.5 : 0);
  const A = [];
  const B = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n + 3).fill(0);
    for (let j = 0; j < n; j++) row[j] = U((P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2);
    row[n] = 1;
    row[n + 1] = P[i][0];
    row[n + 2] = P[i][1];
    A.push(row);
    B.push([dst[i].x, dst[i].y]);
  }
  for (let k = 0; k < 3; k++) {
    const row = new Array(n + 3).fill(0);
    for (let j = 0; j < n; j++) row[j] = k === 0 ? 1 : P[j][k - 1];
    A.push(row);
    B.push([0, 0]);
  }
  const W = solve(A, B);
  return (x, y) => {
    const u = (x - mx) / sc;
    const v = (y - my) / sc;
    let ox = W[n][0] + W[n + 1][0] * u + W[n + 2][0] * v;
    let oy = W[n][1] + W[n + 1][1] * u + W[n + 2][1] * v;
    for (let j = 0; j < n; j++) {
      const k = U((u - P[j][0]) ** 2 + (v - P[j][1]) ** 2);
      ox += W[j][0] * k;
      oy += W[j][1] * k;
    }
    return { x: ox, y: oy };
  };
}

// Contorno de una pieza del cuerpo dividido en tramos entre puntos notables,
// en el mismo orden para cualquier molde.
function outlineSegments(panel) {
  const pts = panel.pts;
  const at = (p) => pts.indexOf(p);
  const H = panel.maxY - panel.neckY;
  const W = panel.maxX - panel.minX;
  const cx = (panel.minX + panel.maxX) / 2;
  const low = pts.map((_, i) => i).filter((i) => pts[i].y > panel.neckY + 0.85 * H);
  const best = (f) => low.reduce((b, i) => (f(i) > f(b) ? i : b), low[0]);
  const hemR = best((i) => (pts[i].x - cx) / W + (pts[i].y - panel.neckY) / H);
  const hemL = best((i) => (cx - pts[i].x) / W + (pts[i].y - panel.neckY) / H);
  const nL = at(panel.neckL);
  const nR = at(panel.neckR);
  const sL = at(panel.shL);
  const sR = at(panel.shR);
  const uL = at(panel.uaL);
  const uR = at(panel.uaR);
  const hem = panel.iHem;
  return [
    pathBetween(pts, nL, nR, hem, false),
    pathBetween(pts, nR, sR, hem, false),
    pathBetween(pts, sR, uR, hem, false),
    pathBetween(pts, uR, hemR, nL, false),
    pathBetween(pts, hemR, hemL, nL, false),
    pathBetween(pts, hemL, uL, nL, false),
    pathBetween(pts, uL, sL, hem, false),
    pathBetween(pts, sL, nL, hem, false),
  ].map((path) => new Polyline(path));
}

function panelWarp(canonPanel, userPanel) {
  const a = outlineSegments(canonPanel);
  const b = outlineSegments(userPanel);
  const step = (canonPanel.maxX - canonPanel.minX) / 40;
  const src = [];
  const dst = [];
  a.forEach((seg, k) => {
    const n = Math.max(2, Math.round(seg.length / step));
    for (let i = 0; i < n; i++) {
      src.push(seg.at(i / n));
      dst.push(b[k].at(i / n));
    }
  });
  return thinPlate(src, dst);
}

// Lleva un punto del molde adentro de su pieza (a `inset` del borde) si cayó
// afuera: la textura fuera de la pieza no es tela.
function insideOf(poly, inset) {
  const n = poly.length;
  const contains = (x, y) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  return (q) => {
    if (contains(q.x, q.y)) return q;
    let best = Infinity;
    let px = q.x;
    let py = q.y;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[j];
      const b = poly[i];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.y - a.y) * ey) / (ex * ex + ey * ey || 1e-12)));
      const d = (q.x - a.x - ex * t) ** 2 + (q.y - a.y - ey * t) ** 2;
      if (d < best) {
        best = d;
        px = a.x + ex * t;
        py = a.y + ey * t;
      }
    }
    // Un poco hacia adentro desde el borde.
    const dx = px - q.x;
    const dy = py - q.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: px + (dx / l) * inset, y: py + (dy / l) * inset };
  };
}

// ---------- armado ----------

export function buildFromTemplate(mold, atlas, tpl) {
  const T = loadTemplate(tpl);
  const P = mold.parts;
  const frontPart = P.front || P.back;
  const backPart = P.back || P.front;
  const user = { front: new Panel(frontPart, 'front'), back: new Panel(backPart, 'back') };
  const canon = { front: new Panel(T.canonical.front, 'front'), back: new Panel(T.canonical.back, 'back') };
  const geos = {};
  const tmp = { x: 0, y: 0 };
  for (const key of ['front', 'back']) {
    const p = T.pieces[key];
    const warp = panelWarp(canon[key], user[key]);
    const inside = insideOf(user[key].pts, (user[key].maxX - user[key].minX) * 0.002);
    const n = p.position.length / 3;
    const uvs = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const q = inside(warp(p.mold[k * 2], p.mold[k * 2 + 1]));
      const [u, v] = atlas.uv(q.x, q.y);
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
    }
    geos[key] = makeGeometry(p, uvs);
  }
  const sleeveParts = { sleeveL: P.sleeveL || P.sleeveR, sleeveR: P.sleeveR || P.sleeveL };
  for (const key of ['sleeveL', 'sleeveR']) {
    const p = T.pieces[key];
    const part = sleeveParts[key];
    const n = p.position.length / 3;
    const uvs = new Float32Array(n * 2);
    if (part) {
      const frame = sleeveFrame(part);
      const inside = insideOf(part.poly, (part.bbox.maxX - part.bbox.minX) * 0.002);
      for (let k = 0; k < n; k++) {
        const pu = capFraction(p.uv[k * 2], frame.capTop, p.side);
        const q = inside(frame.coons(pu, p.uv[k * 2 + 1]));
        const [u, v] = atlas.uv(q.x, q.y);
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    } else {
      // Sin manga en el molde: toma el color del frente (un punto del pecho).
      tmp.x = (user.front.minX + user.front.maxX) / 2;
      tmp.y = user.front.neckY + user.front.H * 0.45;
      const [u, v] = atlas.uv(tmp.x, tmp.y);
      for (let k = 0; k < n; k++) {
        uvs[k * 2] = u;
        uvs[k * 2 + 1] = v;
      }
    }
    geos[key] = makeGeometry(p, uvs);
  }
  weldSeams(geos, T.seams);
  geos.collar = buildCollar(T, geos, atlas, P.collar);
  // El cuello (suavizado) no puede quedar atravesado por la percha.
  pushOutOfBar(geos.collar, T.hanger, 0.0015);
  geos.collar.computeVertexNormals();
  // Costuras de la sisa en el molde del cliente (para sombrearlas en la textura).
  const seamEdges = { front: [], back: [], sleeveL: [], sleeveR: [] };
  for (const key of ['front', 'back']) {
    const pn = user[key];
    const pts = pn.pts;
    for (const [sh, ua] of [[pn.shL, pn.uaL], [pn.shR, pn.uaR]]) seamEdges[key].push(pathBetween(pts, pts.indexOf(sh), pts.indexOf(ua), pn.iHem, false));
  }
  for (const key of ['sleeveL', 'sleeveR']) if (P[key]) seamEdges[key].push(sleeveCap(P[key]).path);
  return { geos, hanger: buildHanger(T.hanger), seamEdges, metersPerUnit: BODY_LENGTH / user.front.H };
}

function makeGeometry(p, uvs) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p.position.slice(), 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(p.index, 1));
  geo.computeVertexNormals();
  return geo;
}

// Las partículas cosidas comparten normal: la costura se ve continua.
function weldSeams(geos, seams) {
  for (const [ka, ia, kb, ib] of seams) {
    const na = geos[ka].attributes.normal;
    const nb = geos[kb].attributes.normal;
    const dot = na.getX(ia) * nb.getX(ib) + na.getY(ia) * nb.getY(ib) + na.getZ(ia) * nb.getZ(ib);
    const sg = dot < 0 ? -1 : 1;
    const x = na.getX(ia) + sg * nb.getX(ib);
    const y = na.getY(ia) + sg * nb.getY(ib);
    const z = na.getZ(ia) + sg * nb.getZ(ib);
    const l = Math.hypot(x, y, z) || 1;
    na.setXYZ(ia, x / l, y / l, z / l);
    nb.setXYZ(ib, (sg * x) / l, (sg * y) / l, (sg * z) / l);
  }
}

// Cuello acanalado sobre el borde del escote, con el contorno suavizado.
function buildCollar(T, geos, atlas, collarPart) {
  const loop = T.neck.map(([key, k]) => ({ N: new THREE.Vector3().fromBufferAttribute(geos[key].attributes.position, k), up: new THREE.Vector3() }));
  const n = loop.length;
  // "Arriba" del cuello: sobre la tela, perpendicular al escote y saliendo
  // del cuerpo (hacia arriba).
  const tan = new THREE.Vector3();
  const sn = new THREE.Vector3();
  T.neck.forEach(([key, k], i) => {
    tan.subVectors(loop[(i + 1) % n].N, loop[(i - 1 + n) % n].N);
    sn.fromBufferAttribute(geos[key].attributes.normal, k);
    loop[i].up.crossVectors(tan, sn).normalize();
    if (loop[i].up.y < 0) loop[i].up.negate();
  });
  // Suavizado del contorno (redondo y parejo) y de las direcciones.
  for (let pass = 0; pass < 4; pass++) {
    const prevN = loop.map((e) => e.N.clone());
    const prevU = loop.map((e) => e.up.clone());
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n;
      const b = (i + 1) % n;
      loop[i].N.copy(prevN[a]).add(prevN[b]).multiplyScalar(0.25).addScaledVector(prevN[i], 0.5);
      loop[i].up.copy(prevU[a]).add(prevU[b]).add(prevU[i]).normalize();
    }
  }
  // El borde del escote del cuerpo sigue al contorno suavizado.
  T.neck.forEach(([key, k], i) => {
    const pa = geos[key].attributes.position;
    pa.setXYZ(k, loop[i].N.x, loop[i].N.y, loop[i].N.z);
  });
  const height = 0.011;
  const thick = 0.0035;
  const prof = [];
  const M = 6;
  // La base del cuello baja por fuera del escote y lo tapa (sin rendijas).
  prof.push({ up: -0.009, inn: -0.0018, v: 0 });
  prof.push({ up: -0.004, inn: -0.0016, v: 0.02 });
  for (let i = 0; i <= M; i++) prof.push({ up: (height * i) / M, inn: -0.0014 * (1 - i / M), v: (0.5 * i) / M });
  for (let i = 1; i < 6; i++) {
    const a = (Math.PI * i) / 6;
    prof.push({ up: height + Math.sin(a) * thick * 0.5, inn: thick * 0.5 * (1 - Math.cos(a)), v: 0.5 });
  }
  for (let i = 0; i <= M; i++) prof.push({ up: height - ((height + 0.009) * i) / M, inn: thick, v: 0.5 + (0.5 * i) / M });
  const pts = [...loop, loop[0]];
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].N.distanceTo(pts[i - 1].N));
  const total = lengths.at(-1);
  const c = loop.reduce((s, e) => s.add(e.N), new THREE.Vector3()).multiplyScalar(1 / n);
  const positions = [];
  const uvs = [];
  const index = [];
  const bb = collarPart?.bbox;
  pts.forEach((e, i) => {
    const inn = new THREE.Vector3(c.x - e.N.x, 0, c.z - e.N.z).normalize();
    const u = lengths[i] / total;
    for (const pr of prof) {
      const P = e.N.clone().addScaledVector(e.up, pr.up).addScaledVector(inn, pr.inn);
      positions.push(P.x, P.y, P.z);
      if (bb) uvs.push(...atlas.uv(bb.minX + (bb.maxX - bb.minX) * u, bb.minY + (bb.maxY - bb.minY) * pr.v));
      else uvs.push(u, pr.v);
    }
  });
  const row = prof.length;
  for (let i = 0; i < pts.length - 1; i++) {
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
  // Cara exterior hacia afuera del cuello.
  const nrm = geo.attributes.normal;
  let out = 0;
  for (let i = 0; i < nrm.count; i += 5) {
    const dx = positions[i * 3] - c.x;
    const dz = positions[i * 3 + 2] - c.z;
    out += Math.sign(nrm.getX(i) * dx + nrm.getZ(i) * dz);
  }
  if (out < 0) {
    for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  geo.userData = { row };
  return geo;
}

// Saca de la barra de la percha (lados planos, cantos redondos) los vértices
// que quedaron adentro.
function pushOutOfBar(geo, h, margin) {
  const pa = geo.attributes.position;
  const p = pa.array;
  const hp = h.barPts;
  const hs = h.barSizes;
  for (let k = 0; k < p.length; k += 3) {
    for (let i = 0; i + 1 < hp.length; i++) {
      const [x0, y0, z0] = hp[i];
      const [x1, y1, z1] = hp[i + 1];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const ez = z1 - z0;
      const L = Math.hypot(ex, ey, ez);
      const rx = p[k] - x0;
      const ry = p[k + 1] - y0;
      const rz = p[k + 2] - z0;
      const s = (rx * ex + ry * ey + rz * ez) / L;
      const sc = Math.max(0, Math.min(L, s));
      const t = sc / L;
      const nx = -ey / L;
      const ny = ex / L;
      const a = rx * nx + ry * ny;
      const th = hs[i][1] + (hs[i + 1][1] - hs[i][1]) * t;
      const core = Math.max(0, hs[i][0] + (hs[i + 1][0] - hs[i][0]) * t - th);
      const r = th + margin;
      const ds = s - sc;
      const da = a - Math.max(-core, Math.min(core, a));
      const d2 = ds * ds + da * da + rz * rz;
      if (d2 < r * r && d2 > 1e-12) {
        const f = r / Math.sqrt(d2) - 1;
        p[k] += ((ds * ex) / L + da * nx) * f;
        p[k + 1] += ((ds * ey) / L + da * ny) * f;
        p[k + 2] += ((ds * ez) / L) * f + rz * f;
      }
    }
  }
  pa.needsUpdate = true;
}

function buildHanger(h) {
  const barPts = h.barPts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(barPts, false, 'centripetal');
  const sizes = h.barSizes;
  const sizeAt = (u) => {
    const f = u * (sizes.length - 1);
    const i = Math.min(Math.floor(f), sizes.length - 2);
    const t = f - i;
    return { h: sizes[i][0] + (sizes[i + 1][0] - sizes[i][0]) * t, t: sizes[i][1] + (sizes[i + 1][1] - sizes[i][1]) * t };
  };
  const bar = hangerBarGeometry(curve, sizeAt);
  const hookPts = h.hookPts.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const hook = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 60, 0.0028, 10, false);
  const end = hookPts.at(-1);
  const tip = new THREE.SphereGeometry(0.0032, 12, 8).translate(end.x, end.y, end.z);
  return { bar, hook, tip, rodY: h.rodY, rodZ: h.rodZ };
}
