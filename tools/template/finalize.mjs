// Paso 3 de la plantilla: junta la forma inicial con la caída simulada en
// Blender y escribe el recurso que usa la página (src/assets/tshirt-template.json).
//   node tools/template/finalize.mjs inicial.json final.json [salida.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { Panel } from '../../src/garment.js';

const [initPath, finalPath, outPath = 'src/assets/tshirt-template.json'] = process.argv.slice(2);
const init = JSON.parse(readFileSync(initPath, 'utf8'));
const fin = JSON.parse(readFileSync(finalPath, 'utf8'));
const pos = Float64Array.from(fin.position);

// Costuras cerradas: cada grupo de partículas cosidas va a su punto medio.
const parent = new Int32Array(pos.length / 3).map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
for (const [i, j] of init.sew) parent[find(i)] = find(j);
const groups = new Map();
for (const [i, j] of init.sew) for (const k of [i, j]) {
  const r = find(k);
  if (!groups.has(r)) groups.set(r, new Set());
  groups.get(r).add(k);
}
for (const g of groups.values()) {
  const m = [0, 0, 0];
  for (const k of g) for (let c = 0; c < 3; c++) m[c] += pos[k * 3 + c] / g.size;
  for (const k of g) for (let c = 0; c < 3; c++) pos[k * 3 + c] = m[c];
}

// Partículas sueltas (sin triángulo): no se ven, pero en la simulación caen
// libres; se llevan junto a la partícula usada más cercana en el molde para
// que no deformen las cajas envolventes.
for (const p of init.pieces) {
  const used = new Set(p.index);
  const n = p.position.length / 3;
  const ids = [...used];
  for (let k = 0; k < n; k++) {
    if (used.has(k)) continue;
    let best = ids[0];
    let bd = Infinity;
    for (const j of ids) {
      const d = (p.rest[j * 2] - p.rest[k * 2]) ** 2 + (p.rest[j * 2 + 1] - p.rest[k * 2 + 1]) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    for (let c = 0; c < 3; c++) pos[(p.offset + k) * 3 + c] = pos[(p.offset + best) * 3 + c];
  }
}

// Camiseta sostenida: el contacto con el maniquí deja un rizado fino en la
// tela. Un suavizado de Taubin (alterna suavizar y "desinflar", así no
// encoge) lo borra y conserva la forma; los bordes libres (ruedo, puños,
// escote) se suavizan sólo a lo largo del borde.
if (fin.body) taubin(Number(process.env.SMOOTH || 30));
function taubin(iters) {
  const nb = new Map();
  const count = new Map();
  for (const p of init.pieces) {
    for (let t = 0; t < p.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = find(p.offset + p.index[t + e]);
        const b = find(p.offset + p.index[t + ((e + 1) % 3)]);
        if (a === b) continue;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        count.set(key, (count.get(key) || 0) + 1);
        for (const [u, v] of [[a, b], [b, a]]) {
          if (!nb.has(u)) nb.set(u, new Set());
          nb.get(u).add(v);
        }
      }
    }
  }
  const edgeNb = new Map();
  for (const [key, c] of count) {
    if (c !== 1) continue;
    const [a, b] = key.split(',').map(Number);
    for (const [u, v] of [[a, b], [b, a]]) {
      if (!edgeNb.has(u)) edgeNb.set(u, new Set());
      edgeNb.get(u).add(v);
    }
  }
  const nodes = [...nb.keys()];
  const near = new Map(nodes.map((u) => [u, [...(edgeNb.get(u) || nb.get(u))]]));
  const next = new Float64Array(pos.length);
  for (let it = 0; it < iters * 2; it++) {
    const f = it % 2 ? -0.53 : 0.5;
    for (const u of nodes) {
      const list = near.get(u);
      for (let c = 0; c < 3; c++) {
        let m = 0;
        for (const v of list) m += pos[v * 3 + c];
        next[u * 3 + c] = pos[u * 3 + c] + f * (m / list.length - pos[u * 3 + c]);
      }
    }
    for (const u of nodes) for (let c = 0; c < 3; c++) pos[u * 3 + c] = next[u * 3 + c];
  }
  for (const g of groups.values()) {
    const r = find([...g][0]);
    for (const k of g) for (let c = 0; c < 3; c++) pos[k * 3 + c] = pos[r * 3 + c];
  }
}

// Limpieza de cruces que deja la simulación:
// 1) ninguna partícula dentro de la percha (con un margen);
// 2) donde el frente mira de frente a la cámara, la espalda queda detrás de él
//    (si no, asoman puntitos de la espalda a través del frente).
const sewn = new Set();
for (const g of groups.values()) for (const k of g) sewn.add(k);
// Camiseta sostenida (maniquí): no hay percha.
const onHanger = !fin.body;
if (onHanger) {
  const hp = init.hanger.barPts;
  const hs = init.hanger.barSizes;
  const m = 0.0025;
  for (let i = 0; i < pos.length / 3; i++) {
    const k = i * 3;
    for (let h = 0; h + 1 < hp.length; h++) {
      const [x0, y0, z0] = hp[h];
      const [x1, y1, z1] = hp[h + 1];
      const ex = x1 - x0;
      const ey = y1 - y0;
      const ez = z1 - z0;
      const L = Math.hypot(ex, ey, ez);
      const rx = pos[k] - x0;
      const ry = pos[k + 1] - y0;
      const rz = pos[k + 2] - z0;
      const sAl = (rx * ex + ry * ey + rz * ez) / L;
      const sc = Math.max(0, Math.min(L, sAl));
      const t = sc / L;
      const nx = -ey / L;
      const ny = ex / L;
      const a = rx * nx + ry * ny;
      const th = hs[h][1] + (hs[h + 1][1] - hs[h][1]) * t;
      const core = Math.max(0, hs[h][0] + (hs[h + 1][0] - hs[h][0]) * t - th);
      const r = th + m;
      const ds = sAl - sc;
      const da = a - Math.max(-core, Math.min(core, a));
      const d2 = ds * ds + da * da + rz * rz;
      if (d2 < r * r && d2 > 1e-12) {
        const f = r / Math.sqrt(d2) - 1;
        pos[k] += ((ds * ex) / L + da * nx) * f;
        pos[k + 1] += ((ds * ey) / L + da * ny) * f;
        pos[k + 2] += ((ds * ez) / L) * f + rz * f;
      }
    }
  }
}
{
  const fr = init.pieces.find((p) => p.key === 'front');
  const bk = init.pieces.find((p) => p.key === 'back');
  // Normales del frente.
  const nF = fr.position.length / 3;
  const nrm = new Float64Array(nF * 3);
  for (let t = 0; t < fr.index.length; t += 3) {
    const [a, b, c] = [fr.index[t], fr.index[t + 1], fr.index[t + 2]].map((v) => (fr.offset + v) * 3);
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const v of [fr.index[t], fr.index[t + 1], fr.index[t + 2]]) for (let c2 = 0; c2 < 3; c2++) nrm[v * 3 + c2] += n[c2];
  }
  const used = new Set(fr.index);
  const cellSize = 0.012;
  const grid = new Map();
  for (let k = 0; k < nF; k++) {
    if (!used.has(k)) continue;
    const l = Math.hypot(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]) || 1;
    if (Math.abs(nrm[k * 3 + 2] / l) < 0.6) continue; // pliegues de canto: no
    const g = fr.offset + k;
    const key = `${Math.floor(pos[g * 3] / cellSize)},${Math.floor(pos[g * 3 + 1] / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(g);
  }
  let moved = 0;
  for (let k = 0; k < bk.position.length / 3; k++) {
    const g = bk.offset + k;
    if (sewn.has(g)) continue;
    const x = pos[g * 3];
    const y = pos[g * 3 + 1];
    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    let best = -1;
    let bd = cellSize * cellSize;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const f of grid.get(`${cx + ox},${cy + oy}`) || []) {
        const d = (pos[f * 3] - x) ** 2 + (pos[f * 3 + 1] - y) ** 2;
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
    }
    if (best < 0) continue;
    const zf = pos[best * 3 + 2];
    if (pos[g * 3 + 2] > zf - 0.001) {
      pos[g * 3 + 2] = zf - 0.0015;
      moved++;
    }
  }
  console.log(`espalda llevada detrás del frente: ${moved} partículas`);
}

const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
const byKey = Object.fromEntries(init.pieces.map((p) => [p.key, p]));
const local = (g) => {
  for (const p of init.pieces) if (g >= p.offset && g < p.offset + p.position.length / 3) return [p.key, g - p.offset];
  return null;
};
// Cuantización a 16 bits: posiciones cada 0,05 mm, molde cada 0,1 unidad,
// (u, t) de las mangas en 0…1.
const POS_Q = 0.00005;
const MOLD_Q = 0.1;
const q16 = (arr, step) => Int16Array.from(arr, (v) => Math.round(v / step));
const asset = { version: 2, posStep: POS_Q, moldStep: MOLD_Q, pieces: {}, seams: [], neck: [], hanger: {}, canonical: {} };
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const { barPts, barSizes, rodY, rodZ, hookPts } = init.hanger;
asset.hanger = !onHanger ? null : { barPts: barPts.map((p) => p.map(r5)), barSizes: barSizes.map((p) => p.map(r5)), rodY: r5(rodY), rodZ: r5(rodZ), hookPts: hookPts.map((p) => p.map(r5)) };
for (const p of init.pieces) {
  const n = p.position.length / 3;
  const piece = { position: b64(q16(pos.subarray(p.offset * 3, (p.offset + n) * 3), POS_Q)), index: b64(Uint16Array.from(p.index)) };
  if (p.row) {
    // Mangas: (u, t) de cada partícula — u a lo largo de la sisa (0 axila
    // delantera, 0.5 hombro, 1 axila trasera), t de la sisa al ruedo.
    const uv = new Uint16Array(n * 2);
    for (let k = 0; k < n; k++) {
      uv[k * 2] = Math.round(p.hu[Math.floor(k / p.row)] * 65535);
      uv[k * 2 + 1] = Math.round(((k % p.row) / (p.row - 1)) * 65535);
    }
    piece.uv = b64(uv);
    piece.side = p.key === 'sleeveL' ? 1 : -1;
  } else {
    piece.mold = b64(q16(p.mold, MOLD_Q));
  }
  asset.pieces[p.key] = piece;
}
for (const g of groups.values()) {
  const list = [...g].map(local);
  for (let a = 1; a < list.length; a++) asset.seams.push([...list[0], ...list[a]]);
}

// Bucle del escote (frente y espalda), ordenado alrededor del cuello desde el
// centro de la espalda, con un punto interior de cada uno (para orientar el
// cuello acanalado).
const neck = [];
for (const key of ['front', 'back']) {
  const p = byKey[key];
  const part = init.mold.parts[key];
  const panel = new Panel(part, key);
  const cell = (panel.maxX - panel.minX) / 60;
  const n = p.position.length / 3;
  const mx = (k) => p.mold[k * 2];
  const my = (k) => p.mold[k * 2 + 1];
  const curve = panel.neckCurve;
  const proj = (k) => {
    let best = { d: Infinity, s: 0 };
    const q = curve.pts;
    for (let i = 0; i + 1 < q.length; i++) {
      const ex = q[i + 1].x - q[i].x;
      const ey = q[i + 1].y - q[i].y;
      const t = Math.max(0, Math.min(1, ((mx(k) - q[i].x) * ex + (my(k) - q[i].y) * ey) / (ex * ex + ey * ey || 1e-12)));
      const d = Math.hypot(mx(k) - q[i].x - ex * t, my(k) - q[i].y - ey * t);
      if (d < best.d) best = { d, s: (curve.cum[i] + t * (curve.cum[i + 1] - curve.cum[i])) / curve.length };
    }
    return best;
  };
  const pr = Array.from({ length: n }, (_, k) => proj(k));
  const d = pr.map((q) => q.d);
  const used = new Set(p.index);
  for (let k = 0; k < n; k++) {
    if (d[k] > cell * 0.05 || !used.has(k)) continue;
    let inner = -1;
    let bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (d[j] < cell * 0.7 || d[j] > cell * 1.6) continue;
      const dd = Math.hypot(mx(j) - mx(k), my(j) - my(k));
      if (dd < bd) {
        bd = dd;
        inner = j;
      }
    }
    neck.push({ key, k, inner, g: p.offset + k, s: pr[k].s });
  }
}
// Orden a lo largo del escote del molde: espalda desde el centro hacia un
// lado, el frente de punta a punta y la espalda de vuelta al centro (frente y
// espalda están dibujados vistos desde afuera, así que sus lados se cruzan).
const backA = neck.filter((e) => e.key === 'back' && e.s >= 0.5).sort((a, b) => a.s - b.s);
const frontAll = neck.filter((e) => e.key === 'front').sort((a, b) => a.s - b.s);
const backB = neck.filter((e) => e.key === 'back' && e.s < 0.5).sort((a, b) => a.s - b.s);
const ordered = [...backA, ...frontAll, ...backB];
// Sin duplicados (punto del cuello compartido por frente y espalda).
const loop = [];
for (const e of ordered) {
  const last = loop.at(-1);
  if (last && Math.hypot(...[0, 1, 2].map((c) => pos[last.g * 3 + c] - pos[e.g * 3 + c])) < 0.002) continue;
  loop.push(e);
}
if (loop.length > 2 && Math.hypot(...[0, 1, 2].map((c) => pos[loop[0].g * 3 + c] - pos[loop.at(-1).g * 3 + c])) < 0.002) loop.pop();
asset.neck = loop.map((e) => [e.key, e.k, e.inner]);
for (const [k, p] of Object.entries(init.mold.parts)) asset.canonical[k] = { poly: p.poly.map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]), bbox: p.bbox };
writeFileSync(outPath, JSON.stringify(asset));
console.log(`plantilla: ${Object.keys(asset.pieces).join(', ')} · costuras ${asset.seams.length} · escote ${asset.neck.length} puntos → ${outPath} (${(JSON.stringify(asset).length / 1024).toFixed(0)} KB)`);
