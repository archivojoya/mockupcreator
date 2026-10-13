// Telas, generadas en canvas: el relieve de cada tejido (mapa de normales),
// su tono y brillo punto a punto (mapa de detalle), una textura grande con
// irregularidades, bolitas e hilos jaspeados, el acanalado del cuello y el
// mapa de estampado (grilla con el nombre de cada pieza).
//
// Coordenadas de un mosaico: u a lo ancho de la tela (las pasadas del
// tejido), v a lo largo (las columnas de puntos), las dos en [0, 1).

import * as THREE from 'three';

const TAU = Math.PI * 2;
const ramp = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const frac = (x) => x - Math.floor(x);

// Ruido de valor periódico (se repite cada `period` celdas, así el mosaico no
// tiene cortes).
function hash2(x, y, seed) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(u, v, period, seed = 0) {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => hash2(((i % period) + period) % period, ((j % period) + period) % period, seed);
  const a = at(xi, yi);
  const b = at(xi + 1, yi);
  const c = at(xi, yi + 1);
  const d = at(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Mapa de normales a partir de una función de altura en [0, 1)² (los
// píxeles miden lo mismo a lo ancho y a lo largo de la tela).
function normalMapFrom(w, h, height, strength) {
  const hs = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hs[y * w + x] = height(x / w, y / h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const at = (x, y) => hs[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (-dx / l) * 127.5 + 127.5;
      img.data[i + 1] = (dy / l) * 127.5 + 127.5;
      img.data[i + 2] = (1 / l) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return { canvas, tex: dataTexture(canvas) };
}

// Mapa de detalle: r = tono (0,5 = el color tal cual), g = aspereza (0,5 =
// la de la tela), b = 0.
function detailMapFrom(w, h, detail) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [a, r] = detail(x / w, y / h);
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(Math.min(1, Math.max(0, a)) * 255);
      img.data[i + 1] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return dataTexture(canvas);
}

function dataTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- tejidos ----------

// Punto de jersey: cada columna de puntos es una fila de "V" (dos patitas
// por punto). fu, fv: posición dentro de un punto.
function stitch(fu, fv) {
  const leg = (x0) => {
    // Segmento de (x0, 1) a (0,5, 0), con la patita algo ovalada.
    const ax = x0 - 0.5;
    const t = Math.min(1, Math.max(0, ((fu - 0.5) * ax + (fv - 0) * 1) / (ax * ax + 1)));
    const dx = fu - (0.5 + ax * t);
    const dy = fv - t;
    return Math.exp(-((Math.hypot(dx, dy * 0.8) / 0.17) ** 2));
  };
  return Math.max(leg(0.12), leg(0.88));
}

// Celda hexagonal (punta arriba): distancia normalizada al borde (0 en el
// centro, 1 en el borde). Mosaico de √3·s × 3·s con s = 1/√3 (ancho 1).
function hexCell(u, v) {
  const s = 1 / Math.sqrt(3);
  const x = u;
  const y = v * 3 * s;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let j = -1; j <= 2; j++)
    for (let i = -1; i <= 2; i++) {
      const cx = i + (j % 2 ? 0.5 : 0);
      const cy = j * 1.5 * s;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < best) {
        best = d;
        bx = x - cx;
        by = y - cy;
      }
    }
  const a = 0.5; // apotema
  const r3 = Math.sqrt(3) / 2;
  return Math.max(Math.abs(bx), Math.abs(bx * 0.5 + by * r3), Math.abs(-bx * 0.5 + by * r3)) / a;
}

// Cada tejido: nombre, mosaico (metros a lo ancho y a lo largo), resolución,
// relieve, tono y aspereza punto a punto, tamaño del detalle más chico (para
// pasar el relieve a aspereza de lejos) y cuánta aspereza suma entonces.
export const WEAVES = {
  mesh: {
    label: 'Malla deportiva',
    note: 'agujeritos en tresbolillo',
    tile: [0.008, 0.008],
    px: [256, 256],
    strength: 2.2,
    scale: 0.35,
    feature: 0.002,
    roughAdd: 0.05,
    fiber: 'poly',
    height(u, v) {
      const n = 4;
      let d = Infinity;
      for (let r = -1; r <= n; r++)
        for (let c = -1; c <= n; c++) d = Math.min(d, Math.hypot(u - (c + (r % 2 ? 0.5 : 0) + 0.5) / n, v - (r + 0.5) / n));
      const hole = Math.exp(-(((d * n) / 0.22) ** 2));
      const knit = 0.5 + 0.5 * Math.sin(u * TAU * n * 4) * Math.sin(v * TAU * n * 2);
      return -hole * 0.9 + knit * 0.12;
    },
    detail(u, v) {
      const h = this.height(u, v);
      return [0.5 + Math.min(0, h) * 0.2, 0.5 - Math.min(0, h) * 0.08];
    },
  },
  pique: {
    label: 'Piqué',
    note: 'granito en relieve',
    tile: [0.006, 0.006],
    px: [256, 256],
    strength: 2.6,
    scale: 0.45,
    feature: 0.0015,
    roughAdd: 0.06,
    fiber: 'cotton',
    // Granitos redondos en tresbolillo (sin surcos corridos), sobre el punto.
    grain(u, v) {
      const n = 4;
      let d = Infinity;
      for (let r = -1; r <= 2 * n; r++)
        for (let c = -1; c <= n; c++) d = Math.min(d, Math.hypot(u - (c + (r % 2 ? 0.5 : 0) + 0.25) / n, (v - (r + 0.5) / (2 * n)) * 1.0));
      return Math.exp(-(((d * n) / 0.36) ** 2));
    },
    height(u, v) {
      return this.grain(u, v) + 0.1 * stitch(frac(u * 12), frac(v * 16));
    },
    detail(u, v) {
      const g = this.grain(u, v);
      return [0.45 + 0.08 * g, 0.55 - 0.05 * g];
    },
  },
  honeycomb: {
    label: 'Panal',
    note: 'celdas hexagonales',
    tile: [0.0035, 0.0035 * Math.sqrt(3)],
    px: [192, 333],
    strength: 2.4,
    scale: 0.5,
    feature: 0.0035,
    roughAdd: 0.05,
    fiber: 'poly',
    height(u, v) {
      const d = hexCell(u, v);
      return ramp(0.62, 0.92, d) - 0.15 * Math.exp(-((d / 0.25) ** 2));
    },
    detail(u, v) {
      const d = hexCell(u, v);
      const wall = ramp(0.62, 0.92, d);
      return [0.45 + 0.1 * wall, 0.54 - 0.08 * wall];
    },
  },
  jersey: {
    label: 'Jersey liso',
    note: 'punto fino, casi liso',
    tile: [0.004, 0.004],
    px: [256, 256],
    strength: 1.6,
    scale: 0.28,
    feature: 0.0007,
    roughAdd: 0.04,
    fiber: 'cotton',
    height(u, v) {
      return stitch(frac(u * 6), frac(v * 8));
    },
    detail(u, v) {
      return [0.47 + 0.05 * this.height(u, v), 0.5];
    },
  },
  rib: {
    label: 'Acanalada',
    note: 'costillas verticales',
    tile: [0.0048, 0.0048],
    px: [256, 256],
    strength: 3.2,
    scale: 0.55,
    feature: 0.0016,
    roughAdd: 0.04,
    fiber: 'cotton',
    height(u, v) {
      const rib = (0.5 + 0.5 * Math.cos(u * TAU * 3)) ** 0.7;
      return rib + 0.12 * rib * stitch(frac(u * 3 + 0.5), frac(v * 10));
    },
    detail(u) {
      const rib = (0.5 + 0.5 * Math.cos(u * TAU * 3)) ** 0.7;
      return [0.4 + 0.12 * rib, 0.52];
    },
  },
  jacquard: {
    label: 'Jacquard',
    note: 'rayas tono sobre tono',
    tile: [0.024, 0.006],
    px: [1024, 256],
    strength: 2.2,
    scale: 0.4,
    feature: 0.0007,
    roughAdd: 0.04,
    fiber: 'poly',
    band(u) {
      // 1 en la raya con dibujo, 0 en la lisa, con un borde de 0,3 mm.
      const x = frac(u) * 0.024;
      return ramp(0.0118, 0.0121, x) * (1 - ramp(0.0236, 0.0239, x));
    },
    height(u, v) {
      const b = this.band(u);
      const plain = stitch(frac(u * 36), frac(v * 12));
      const fu = frac(u * 12);
      const fv = frac(v * 3);
      const diamond = Math.max(0, 1 - (Math.abs(fu - 0.5) + Math.abs(fv - 0.5)) * 2.2);
      return plain * (1 - b) * 0.6 + b * (diamond ** 0.7 + 0.15 * plain);
    },
    detail(u) {
      const b = this.band(u);
      return [0.53 - 0.07 * b, 0.43 + 0.16 * b];
    },
  },
  perforated: {
    label: 'Microperforada',
    note: 'lisa, con zonas caladas',
    tile: [0.004, 0.004],
    px: [256, 256],
    strength: 1.4,
    scale: 0.25,
    feature: 0.0007,
    roughAdd: 0.03,
    fiber: 'poly',
    height(u, v) {
      return stitch(frac(u * 6), frac(v * 8));
    },
    detail(u, v) {
      return [0.48 + 0.04 * this.height(u, v), 0.45];
    },
    // Zonas caladas (costados y bajo los brazos): agujeros de láser de
    // 0,9 mm, cada 2,5 mm en tresbolillo.
    zone: {
      tile: [0.005, 0.005],
      px: [256, 256],
      strength: 2.4,
      hole(u, v) {
        let d = Infinity;
        for (const [cx, cy] of [
          [0.25, 0.25],
          [0.75, 0.75],
          [-0.25, 0.75],
          [1.25, 0.25],
          [0.25, 1.25],
          [0.75, -0.25],
        ])
          d = Math.min(d, Math.hypot(u - cx, v - cy));
        return d * 0.005; // en metros
      },
      height(u, v) {
        const d = this.hole(u, v);
        return -ramp(0.00055, 0.00035, d) + 0.15 * ramp(0.0007, 0.00045, d) * ramp(0.00035, 0.00045, d);
      },
      detail(u, v) {
        const hole = ramp(0.00048, 0.00038, this.hole(u, v));
        return [0.5 - 0.42 * hole, 0.5 + 0.2 * hole];
      },
    },
  },
};

const cache = new Map();
// Texturas de un tejido (se arman la primera vez que se usan).
export function weaveTextures(key) {
  if (cache.has(key)) return cache.get(key);
  const w = WEAVES[key];
  const build = (def) => {
    const { canvas, tex: normal } = normalMapFrom(def.px[0], def.px[1], def.height.bind(def), def.strength);
    normal.repeat.set(1 / def.tile[0], 1 / def.tile[1]);
    const detail = detailMapFrom(def.px[0], def.px[1], def.detail.bind(def));
    return { normal, detail, canvas };
  };
  const out = { ...build(w), zone: w.zone ? build(w.zone) : null };
  cache.set(key, out);
  return out;
}

// Muestra chica del tejido (relieve iluminado de costado) para el panel.
export function weaveSwatch(key, size = 44) {
  const w = WEAVES[key];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  // Se ven unos 6 mm de tela.
  const span = 0.006;
  const at = (x, y) => w.height(frac((x / size) * (span / w.tile[0])), frac((y / size) * (span / w.tile[1])));
  const zone = w.zone;
  const atZ = (x, y) => (zone ? zone.height(frac((x / size) * (span / zone.tile[0])), frac((y / size) * (span / zone.tile[1]))) : 0);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // La mitad de abajo de la microperforada muestra la zona calada.
      const z = zone && y > size / 2;
      const f = z ? atZ : at;
      const dx = (f(x + 1, y) - f(x - 1, y)) * w.strength * 0.6;
      const dy = (f(x, y + 1) - f(x, y - 1)) * w.strength * 0.6;
      const l = Math.hypot(dx, dy, 1);
      const shade = Math.max(0, (-dx * 0.55 - dy * 0.45 + 0.7) / l);
      const hole = z ? zone.detail(frac((x / size) * (span / zone.tile[0])), frac((y / size) * (span / zone.tile[1])))[0] : 0.5;
      const g = Math.round(Math.min(1, 0.25 + shade * 0.75) * 255 * (0.3 + hole * 1.4));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, g);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

// Acanalado del cuello: costillas a lo largo de la tira. Un mosaico mide
// RIB_TILE metros.
export const RIB_TILE = 0.004;
export function makeRibNormalMap() {
  const { tex } = normalMapFrom(128, 128, (u) => 0.5 + 0.5 * Math.cos(u * TAU * 2), 3.5);
  tex.repeat.set(1 / RIB_TILE, 1 / RIB_TILE);
  return tex;
}

// Detalle neutro (sin cambios de tono ni de aspereza).
export function makeFlatDetail() {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

// Textura grande (MACRO_TILE metros, no múltiplo de ningún mosaico, así no se
// nota la repetición): r = irregularidad suave del tejido y del teñido, g =
// bolitas (pilling), b = hilos de otro color a lo largo de las pasadas
// (jaspeado).
export const MACRO_TILE = 0.061;
export function makeMacroMap() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  // Bolitas: puntos al azar de 0,6 a 1,2 mm.
  const pills = new Float32Array(size * size);
  const mm = size / (MACRO_TILE * 1000);
  for (let k = 0; k < 140; k++) {
    const cx = hash2(k, 1, 3) * size;
    const cy = hash2(k, 2, 3) * size;
    const r = (0.3 + 0.3 * hash2(k, 3, 3)) * mm;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        const i = ((y + size) % size) * size + ((x + size) % size);
        pills[i] = Math.max(pills[i], 1 - d * d);
      }
  }
  // Jaspeado: tramos de hilo de 1 a 4 mm a lo largo de cada pasada (0,4 mm),
  // alternados con huecos de 4 a 16 mm (así la densidad es pareja y no se
  // forman manchas).
  const yarn = new Float32Array(size * size);
  const course = 0.4 * mm;
  const rows = Math.round(size / course);
  for (let r = 0; r < rows; r++) {
    let x = hash2(r, 7, 5) * size;
    while (x < size * 2) {
      const len = (1 + 3 * hash2(r, x, 6)) * mm;
      for (let xx = Math.floor(x); xx < x + len; xx++)
        for (let yy = Math.floor(r * course); yy < (r + 1) * course; yy++) {
          const e = Math.min(1, (xx - x) / mm, (x + len - xx) / mm); // puntas finitas
          const i = (((yy % size) + size) % size) * size + (xx % size);
          yarn[i] = Math.max(yarn[i], e * (0.75 + 0.25 * hash2(r, 9, 9)));
        }
      x += len + (4 + 12 * hash2(r, x, 10)) * mm;
    }
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = 0.6 * noise(u, v, 4, 1) + 0.4 * noise(u, v, 11, 2);
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(n * 255);
      img.data[i + 1] = Math.round(pills[y * size + x] * 255);
      img.data[i + 2] = Math.round(yarn[y * size + x] * 255);
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return dataTexture(canvas);
}

// Mapa de estampado: grilla de 5 cm con el nombre de la pieza.
export function makeUVMap(label, size = [0.5, 0.75]) {
  const px = 900;
  const w = Math.round(px * Math.min(1, size[0] / size[1]));
  const h = Math.round(px * Math.min(1, size[1] / size[0]));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f3f1ec';
  ctx.fillRect(0, 0, w, h);
  const cell = 0.05 * (w / size[0]);
  for (let y = 0, r = 0; y < h; y += cell, r++)
    for (let x = 0, c = 0; x < w; x += cell, c++) {
      if ((r + c) % 2) {
        ctx.fillStyle = '#d9d4ca';
        ctx.fillRect(x, h - y - cell, cell, cell);
      }
    }
  ctx.strokeStyle = '#b8402f';
  ctx.lineWidth = Math.max(2, w / 300);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.fillStyle = '#1e2430';
  const fs = Math.min(w, h) * 0.13;
  ctx.font = `700 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  // Flecha "arriba" de la pieza.
  ctx.beginPath();
  ctx.moveTo(w / 2, h * 0.16);
  ctx.lineTo(w / 2 - fs * 0.35, h * 0.16 + fs * 0.45);
  ctx.lineTo(w / 2 + fs * 0.35, h * 0.16 + fs * 0.45);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
