// Diseños propios hechos con imágenes (PNG, JPG, WebP o SVG): una por pieza,
// que cubre la pieza y se puede correr y agrandar, más aplicaciones sueltas
// (escudo, marcas) en su lugar, estampadas, bordadas o en vinilo. Cada pieza
// tiene un recuadro fijo (mm) con su punto de anclaje siempre en el mismo
// lugar (ver printUV en shirt.js): lo que se dibuja en el recuadro se estampa
// en esa pieza.
import * as THREE from 'three';
import { COLLAR_FOLD } from './shirt.js';

// Recuadros (mm) y anclaje dentro de cada uno.
export const PIECES = [
  { key: 'front', w: 760, h: 1080, ax: 380, ay: 230 },
  { key: 'back', w: 760, h: 1080, ax: 380, ay: 230 },
  { key: 'sleeveR', w: 580, h: 320, ax: 290, ay: 20 },
  { key: 'sleeveL', w: 580, h: 320, ax: 290, ay: 20 },
  { key: 'cuffR', w: 500, h: 50, ax: 250, ay: 10 },
  { key: 'cuffL', w: 500, h: 50, ax: 250, ay: 10 },
  { key: 'collar', w: 1240, h: 75, ax: 620, ay: 65 },
  // Short: cada pierna con su cintura (el anclaje es la cintura en el
  // costado; arriba, la cintura y el tiro, que sube 7 cm hacia atrás como en
  // el molde). La pieza, 67 × 47 cm.
  { key: 'legR', w: 720, h: 510, ax: 360, ay: 90 },
  { key: 'legL', w: 720, h: 510, ax: 360, ay: 90 },
];
// Piezas que llevan el mismo estampado que otra (la cintura del short, el
// de su pierna).
export const PRINT_WITH = { waistR: 'legR', waistL: 'legL' };
const PX_PER_MM = 2.5;
const MAX_PX = 4096;
export const pieceK = (key) => {
  const pc = PIECES.find((p) => p.key === key);
  return Math.min(PX_PER_MM, MAX_PX / Math.max(pc.w, pc.h));
};

// Bordes de una malla (aristas de un solo triángulo) en vueltas cerradas.
function outlineLoops(geo) {
  const idx = geo.index.array;
  const count = new Map();
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < idx.length; t += 3)
    for (const [a, b] of [
      [idx[t], idx[t + 1]],
      [idx[t + 1], idx[t + 2]],
      [idx[t + 2], idx[t]],
    ]) {
      const k = key(a, b);
      count.set(k, (count.get(k) || 0) + 1);
    }
  // Vértices repetidos (costuras de la grilla) se juntan por posición en el
  // plano de estampado.
  const uv = geo.attributes.uv1.array;
  const at = (v) => `${Math.round(uv[v * 2] * 2e4)},${Math.round(uv[v * 2 + 1] * 2e4)}`;
  const next = new Map();
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const [a, b] = k.split(',').map(Number);
    const pa = at(a);
    const pb = at(b);
    if (pa === pb) continue;
    (next.get(pa) || next.set(pa, []).get(pa)).push([pb, b]);
    (next.get(pb) || next.set(pb, []).get(pb)).push([pa, a]);
  }
  const point = new Map();
  for (let v = 0; v < uv.length / 2; v++) point.set(at(v), [uv[v * 2], uv[v * 2 + 1]]);
  const used = new Set();
  const loops = [];
  for (const start of next.keys()) {
    const loop = [];
    let p = start;
    let prev = null;
    while (p && !used.has(p)) {
      used.add(p);
      loop.push(point.get(p));
      const n = (next.get(p) || []).find(([q]) => q !== prev && !used.has(q));
      prev = p;
      p = n && n[0];
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

// Contorno de una pieza (vueltas en mm de estampado) para verla plana: los
// bordes de la malla; del cuello, la cara de afuera.
export function pieceOutline(built, key) {
  const geo = built.geos[key];
  let loops;
  if (key === 'collar') {
    const uv = geo.attributes.uv1.array;
    const SW = built.layout.rings.collar.length + 1;
    const row = (j) => Array.from({ length: SW }, (_, i) => [uv[(j * SW + i) * 2], uv[(j * SW + i) * 2 + 1]]);
    loops = [[...row(0), ...row(COLLAR_FOLD).reverse()]];
  } else loops = outlineLoops(geo);
  return loops.map((l) => l.map(([u, v]) => [u * 1000, v * 1000]));
}

// Textura de estampado de una pieza: lee las coordenadas de estampado (uv1)
// y las lleva a su recuadro.
export function printTexture(key, canvas, anisotropy = 4) {
  const pc = PIECES.find((p) => p.key === key);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.channel = 1;
  t.anisotropy = anisotropy;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1000 / pc.w, -1000 / pc.h);
  t.offset.set(pc.ax / pc.w, 1 - pc.ay / pc.h);
  return t;
}

// ---------- piezas ----------

// La pieza de una imagen sale de su nombre (frente, espalda, manga, puño,
// cuello, tapacostura, etiqueta; manga y puño van a los dos lados salvo que
// digan izquierda o derecha).
const NAMES = [
  ['label', /etiqueta|label/i],
  ['front', /frente|front|delanter/i],
  ['back', /espalda|(^|[^a-z])back([^a-z]|$)|dorso|trasera/i],
  ['sleeve', /manga|sleeve/i],
  ['cuff', /pu[ñn]o|cuff/i],
  ['tape', /tapa ?costura|tapa ?cuello|tape|cinta/i],
  ['collar', /cuello|collar/i],
  ['leg', /pierna|leg|short/i],
];
export const PIECE_LABELS = { front: 'Frente', back: 'Espalda', sleeveL: 'Manga izquierda', sleeveR: 'Manga derecha', cuffL: 'Puño izquierdo', cuffR: 'Puño derecho', collar: 'Cuello', tape: 'Tapacostura', label: 'Etiqueta', legR: 'Pierna 1 (derecha)', legL: 'Pierna 2 (izquierda)' };
export function pieceKeys(name) {
  name = name.normalize('NFC');
  for (const [base, re] of NAMES) {
    if (!re.test(name)) continue;
    // Piernas: la 1 es la derecha.
    if (base === 'leg') {
      const side = /(^|[^a-zñ])(izq|left)|pierna ?2|leg ?2/i.test(name) ? 'L' : /(^|[^a-zñ])(der|right)|pierna ?1|leg ?1/i.test(name) ? 'R' : '';
      return side ? ['leg' + side] : ['legR', 'legL'];
    }
    if (base !== 'sleeve' && base !== 'cuff') return [base];
    const side = /(^|[^a-zñ])(izq|left)/i.test(name) ? 'L' : /(^|[^a-zñ])(der|right)/i.test(name) ? 'R' : '';
    return side ? [base + side] : [base + 'L', base + 'R'];
  }
  return [];
}

// Medidas de cada pieza para diseñar (mm): ancho (simétrico respecto del
// centro de la pieza), alto y dónde queda su borde de arriba respecto del
// anclaje. El cuello: largo de la vuelta y alto de la cara de afuera.
export function pieceSizes(built) {
  const out = {};
  for (const pc of PIECES) {
    if (!built.geos[pc.key]) continue; // pieza que esta prenda no tiene (mangas en la musculosa)
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    // (Con las piezas que llevan su mismo estampado.)
    const keys = [pc.key, ...Object.keys(PRINT_WITH).filter((k) => PRINT_WITH[k] === pc.key && built.geos[k])];
    for (const key of keys) {
      const a = built.geos[key].attributes.uv1.array;
      let n = a.length / 2;
      if (key === 'collar') n = (built.layout.rings.collar.length + 1) * (COLLAR_FOLD + 1);
      for (let i = 0; i < n; i++) {
        u0 = Math.min(u0, a[i * 2]);
        u1 = Math.max(u1, a[i * 2]);
        v0 = Math.min(v0, a[i * 2 + 1]);
        v1 = Math.max(v1, a[i * 2 + 1]);
      }
    }
    const wrap = pc.key === 'collar' ? (u1 - u0) * 1000 : 0;
    out[pc.key] = { w: wrap || 2 * Math.max(-u0, u1) * 1000, h: (v1 - v0) * 1000, top: v0 * 1000, wrap };
  }
  return out;
}

// Lugar de una imagen que cubre un recuadro de `size` (mm; centro horizontal
// en 0 y borde de arriba en size.top) y `bleed` mm más de cada lado:
// centrada, agrandada por fit.scale y corrida fit.dx, fit.dy (mm). Devuelve
// x, y, ancho y alto en mm.
export const BLEED = 4; // las piezas: sin esto, en el borde se cuela el color de base
export function coverRect(size, iw, ih, fit = {}, bleed = 0) {
  const s = Math.max((size.w + 2 * bleed) / iw, (size.h + 2 * bleed) / ih) * (fit.scale || 1);
  const w = iw * s;
  const h = ih * s;
  return { x: (fit.dx || 0) - w / 2, y: (size.top || 0) + size.h / 2 + (fit.dy || 0) - h / 2, w, h };
}
// Lienzos de una pieza (su recuadro a pieceK px/mm): `print` con la imagen de
// fondo (si hay) y lo que va estampado; `emb` y `vin` con lo bordado y lo que
// va en vinilo (null si no hay). El fondo: { img, fit } y, si no cubre su
// propio recuadro, `cover` (el recuadro que cubre) y `shift` (mm hacia abajo:
// el puño, sin puño, sigue a la manga). Cada aplicación: { img, x, y
// (centro, mm de estampado), w (ancho, mm), as ('print' | 'emb' | 'vin') }.
// `rect`: dónde quedó el fondo (px), y `box`: el recuadro de las
// aplicaciones en relieve.
export function pieceCanvases(key, size, base, apps = []) {
  const pc = PIECES.find((p) => p.key === key);
  const k = pieceK(key);
  const W = Math.round(pc.w * k);
  const H = Math.round(pc.h * k);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    return c;
  };
  const px = (x, y) => [(pc.ax + x) * k, (pc.ay + y) * k];
  const out = { print: make(), emb: null, vin: null, k, rect: [0, 0, W, H], box: null };
  if (base) {
    const r = coverRect(base.cover || size, base.img.width, base.img.height, base.fit, BLEED);
    const [x, y] = px(r.x, r.y + (base.shift || 0));
    const ctx = out.print.getContext('2d');
    ctx.drawImage(base.img, x, y, r.w * k, r.h * k);
    // El cuello da la vuelta: lo que pasa de una punta sigue en la otra.
    if (size.wrap) for (const d of [-1, 1]) ctx.drawImage(base.img, x + d * size.wrap * k, y, r.w * k, r.h * k);
    const [x0, y0] = [Math.max(0, x), Math.max(0, y)];
    out.rect = [x0, y0, Math.min(W, x + r.w * k) - x0, Math.min(H, y + r.h * k) - y0];
  }
  const m = 8 * k;
  for (const a of apps) {
    const h = (a.w * a.img.height) / a.img.width;
    const [x, y] = px(a.x - a.w / 2, a.y - h / 2);
    const target = a.as === 'print' ? out.print : (out[a.as] ||= make());
    target.getContext('2d').drawImage(a.img, x, y, a.w * k, h * k);
    if (a.as === 'print') continue;
    const b = [Math.max(0, x - m), Math.max(0, y - m), Math.min(W - 1, x + a.w * k + m), Math.min(H - 1, y + h * k + m)];
    out.box = out.box ? [Math.min(out.box[0], b[0]), Math.min(out.box[1], b[1]), Math.max(out.box[2], b[2]), Math.max(out.box[3], b[3])] : b;
  }
  return out;
}

// ---------- escudo y marcas ----------

// Relieve de las aplicaciones de una pieza, a partir de lo bordado (`emb`)
// y lo que va en vinilo (`vin`), lienzos del recuadro a `k` px/mm. Para no
// ocupar todo el recuadro se recorta a lo que ocupan (con margen).
// Devuelve las texturas (color con su opacidad; forma: normal del borde en
// RG, sombra alrededor del bordado en B, tipo en A: 1 bordado, 0,5 vinilo) y
// la matriz que lleva las coordenadas de estampado (m) a ellas.
const EMB_BEVEL = 1.4; // mm: cuánto tarda el bordado en llegar a su alto
const EMB_HEIGHT = 1.1; // mm de alto del bordado
const VIN_BEVEL = 0.35;
const VIN_HEIGHT = 0.15;
const AO_RADIUS = 2.4; // mm de sombra alrededor del bordado
function boxBlur(src, w, h, r, passes) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / n;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / n;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}
export function buildApplique(key, emb, vin, k, box = null) {
  const pc = PIECES.find((p) => p.key === key);
  const layers = [emb, vin].filter(Boolean);
  if (!layers.length) return null;
  const W = layers[0].width;
  const H = layers[0].height;
  // Recorte: el recuadro que ocupan (si se sabe, no hace falta buscarlo).
  let [x0, y0, x1, y1] = box ? box.map(Math.round) : [W, H, -1, -1];
  if (!box)
    for (const a of layers.map((c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data))
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          if (a[(y * W + x) * 4 + 3] > 4) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
  if (x1 < x0 || y1 < y0) return null;
  const m = Math.ceil(AO_RADIUS * 2 * k) + 4;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(W - 1, x1 + m);
  y1 = Math.min(H - 1, y1 + m);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const mask = (c) => {
    const a = c.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, w, h).data;
    return Float32Array.from({ length: w * h }, (_, i) => a[i * 4 + 3] / 255);
  };
  const embM = emb ? mask(emb) : new Float32Array(w * h);
  const vinM = vin ? mask(vin) : new Float32Array(w * h);
  // Alto: sube desde el borde en EMB_BEVEL (o VIN_BEVEL) mm.
  const smooth = (e0, e1, v) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const height = new Float32Array(w * h);
  if (emb) {
    const b = boxBlur(embM, w, h, Math.max(1, Math.round((EMB_BEVEL * k) / 2)), 3);
    for (let i = 0; i < height.length; i++) height[i] += EMB_HEIGHT * embM[i] * smooth(0.5, 1, b[i]);
  }
  if (vin) {
    const b = boxBlur(vinM, w, h, Math.max(1, Math.round((VIN_BEVEL * k) / 2)), 3);
    for (let i = 0; i < height.length; i++) height[i] += VIN_HEIGHT * vinM[i] * smooth(0.5, 1, b[i]);
  }
  const ao = emb ? boxBlur(embM, w, h, Math.max(1, Math.round((AO_RADIUS * k) / 2)), 2) : null;
  // Forma (filas de abajo hacia arriba, como la lee la textura).
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const hx = (height[y * w + Math.min(w - 1, x + 1)] - height[y * w + Math.max(0, x - 1)]) * (k / 2);
      const hy = (height[Math.min(h - 1, y + 1) * w + x] - height[Math.max(0, y - 1) * w + x]) * (k / 2);
      // Normal en el plano de estampado mirado de afuera (x a la derecha, y
      // hacia arriba; en el lienzo y va hacia abajo).
      const nx = Math.max(-1, Math.min(1, -hx));
      const ny = Math.max(-1, Math.min(1, hy));
      const o = ((h - 1 - y) * w + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = ao ? Math.round(Math.min(1, ao[i]) * 255) : 0;
      data[o + 3] = embM[i] > 0.02 || (ao && ao[i] > 0.02) ? 255 : vinM[i] > 0.02 ? 128 : 0;
    }
  const shape = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  shape.magFilter = THREE.LinearFilter;
  shape.minFilter = THREE.LinearMipmapLinearFilter;
  shape.generateMipmaps = true;
  shape.needsUpdate = true;
  const cc = document.createElement('canvas');
  cc.width = w;
  cc.height = h;
  const ctx = cc.getContext('2d');
  for (const c of layers) ctx.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  const color = new THREE.CanvasTexture(cc);
  color.colorSpace = THREE.SRGBColorSpace;
  // Coordenadas de estampado (m, y hacia abajo) → textura recortada (v hacia
  // arriba).
  const mmX0 = x0 / k - pc.ax;
  const mmY0 = y0 / k - pc.ay;
  const wm = w / k;
  const hm = h / k;
  const matrix = new THREE.Matrix3().set(1000 / wm, 0, -mmX0 / wm, 0, -1000 / hm, 1 + mmY0 / hm, 0, 0, 1);
  return { color, shape, matrix };
}

// Lienzo del tapacostura (largo × ancho en mm): la imagen lo cubre, centrada
// (corrida y agrandada según `fit`); lo que sobra se corta.
export function placeTape(img, lengthMm, widthMm, fit) {
  const k = 8; // px/mm
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(lengthMm * k);
  canvas.height = Math.round(widthMm * k);
  const r = coverRect({ w: lengthMm, h: widthMm, top: -widthMm / 2 }, img.width, img.height, fit);
  canvas.getContext('2d').drawImage(img, (r.x + lengthMm / 2) * k, (r.y + widthMm / 2) * k, r.w * k, r.h * k);
  return canvas;
}

// Etiqueta tejida (ancho × alto de la cara de afuera, en mm): la imagen la
// cubre (según `fit`) y se teje: queda en una grilla de hilos de WEAVE mm,
// con los colores que más hay (bordes escalonados, como una etiqueta de
// verdad). El relieve (normalMap) marca la trama: hilos horizontales en el
// fondo y flotes en diagonal en el dibujo.
const WEAVE = 0.25;
export function placeLabel(img, wMm, hMm, fit) {
  const k = 24; // px/mm
  const W = Math.round(wMm * k);
  const H = Math.round(hMm * k);
  const full = document.createElement('canvas');
  [full.width, full.height] = [W, H];
  const fx = full.getContext('2d');
  fx.fillStyle = '#ffffff';
  fx.fillRect(0, 0, W, H);
  const r = coverRect({ w: wMm, h: hMm, top: -hMm / 2 }, img.width, img.height, fit);
  fx.drawImage(img, (r.x + wMm / 2) * k, (r.y + hMm / 2) * k, r.w * k, r.h * k);
  // Paleta: los colores que cubren al menos el 1 % (agrupados de a 16 por canal).
  const px = fx.getImageData(0, 0, W, H).data;
  const bins = new Map();
  for (let i = 0; i < px.length; i += 4) {
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const b = bins.get(key) || [0, 0, 0, 0];
    b[0]++;
    b[1] += px[i];
    b[2] += px[i + 1];
    b[3] += px[i + 2];
    bins.set(key, b);
  }
  const palette = [...bins.values()]
    .filter((b) => b[0] >= (W * H) / 100)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 6)
    .map((b) => [b[1] / b[0], b[2] / b[0], b[3] / b[0]]);
  // Grilla de hilos: cada celda toma el color de la paleta más cercano al
  // promedio de lo que cubre; el primero (el que más hay) es el fondo.
  const gw = Math.round(wMm / WEAVE);
  const gh = Math.round(hMm / WEAVE);
  const grid = document.createElement('canvas');
  [grid.width, grid.height] = [gw, gh];
  const gx = grid.getContext('2d');
  gx.imageSmoothingQuality = 'high';
  gx.drawImage(full, 0, 0, gw, gh);
  const g = gx.getImageData(0, 0, gw, gh);
  const ink = new Uint8Array(gw * gh);
  for (let c = 0; c < gw * g.height; c++) {
    let best = 0;
    let bd = Infinity;
    palette.forEach((p, n) => {
      const d = (g.data[c * 4] - p[0]) ** 2 + (g.data[c * 4 + 1] - p[1]) ** 2 + (g.data[c * 4 + 2] - p[2]) ** 2;
      if (d < bd) [bd, best] = [d, n];
    });
    ink[c] = best ? 1 : 0;
    for (let ch = 0; ch < 3; ch++) g.data[c * 4 + ch] = palette[best][ch];
    g.data[c * 4 + 3] = 255;
  }
  gx.putImageData(g, 0, 0);
  const color = document.createElement('canvas');
  [color.width, color.height] = [W, H];
  const cx = color.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.drawImage(grid, 0, 0, W, H);
  // Relieve: altura de los hilos (y el dibujo apenas más alto), a normales.
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const mx = x / k;
      const my = y / k;
      const c = Math.min(gh - 1, Math.floor(my / WEAVE)) * gw + Math.min(gw - 1, Math.floor(mx / WEAVE));
      const t = ink[c] ? (mx + my) / (WEAVE * 1.6) : my / WEAVE;
      const thread = Math.sin(Math.PI * (t - Math.floor(t))) ** 0.6;
      const warp = ink[c] ? 0 : 0.25 * Math.sin(Math.PI * ((mx / (WEAVE * 2)) % 1)) ** 2;
      hgt[y * W + x] = thread - warp + (ink[c] ? 0.5 : 0);
    }
  const normal = document.createElement('canvas');
  [normal.width, normal.height] = [W, H];
  const nx = normal.getContext('2d');
  const nd = nx.createImageData(W, H);
  const amp = 0.9;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (hgt[y * W + Math.min(W - 1, x + 1)] - hgt[y * W + Math.max(0, x - 1)]) * amp;
      const dy = (hgt[Math.min(H - 1, y + 1) * W + x] - hgt[Math.max(0, y - 1) * W + x]) * amp;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      nd.data[i] = (0.5 - dx / l / 2) * 255;
      nd.data[i + 1] = (0.5 + dy / l / 2) * 255;
      nd.data[i + 2] = (0.5 + 0.5 / l) * 255;
      nd.data[i + 3] = 255;
    }
  nx.putImageData(nd, 0, 0);
  return { color, normal };
}
