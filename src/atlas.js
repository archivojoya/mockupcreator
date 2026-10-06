// Textura única con todo el molde: cada pieza se pinta con su color base y,
// opcionalmente, el diseño del SVG encima; luego se superponen los logos.

import * as THREE from 'three';
import { svgTextToImage } from './svgMold.js';

export class Atlas {
  constructor(mold, maxSize) {
    this.mold = mold;
    const vb = mold.viewBox;
    this.scale = Math.min(maxSize / vb.w, maxSize / vb.h);
    this.width = Math.round(vb.w * this.scale);
    this.height = Math.round(vb.h * this.scale);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.layers = null;
    this.layerKey = '';
    this.metersPerUnit = null;
  }

  uv(x, y) {
    const vb = this.mold.viewBox;
    return [(x - vb.x) / vb.w, 1 - (y - vb.y) / vb.h];
  }

  toPx(p) {
    const vb = this.mold.viewBox;
    return [(p.x - vb.x) * this.scale, (p.y - vb.y) * this.scale];
  }

  async ensureLayers(colorMap) {
    const key = JSON.stringify(colorMap);
    if (this.layers && key === this.layerKey) return;
    const partsSvg = this.mold.buildLayer('parts', colorMap, this.width, this.height);
    const looseSvg = this.mold.buildLayer('loose', colorMap, this.width, this.height);
    const [parts, loose] = await Promise.all([
      svgTextToImage(partsSvg),
      looseSvg ? svgTextToImage(looseSvg) : null,
    ]);
    this.layers = { parts, loose };
    this.layerKey = key;
  }

  pathOf(part) {
    const path = new Path2D();
    part.poly.forEach((p, i) => {
      const [x, y] = this.toPx(p);
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    });
    path.closePath();
    return path;
  }

  async compose(state) {
    await this.ensureLayers(state.palette);
    const { ctx, width, height } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    const union = new Path2D();
    for (const part of Object.values(this.mold.parts)) {
      const ps = state.parts[part.key];
      const path = this.pathOf(part);
      union.addPath(path);
      ctx.save();
      ctx.clip(path);
      ctx.fillStyle = ps.color;
      ctx.fillRect(0, 0, width, height);
      if (ps.design) ctx.drawImage(this.layers.parts, 0, 0, width, height);
      if (this.metersPerUnit && part.key !== 'collar') this.drawHem(part);
      ctx.restore();
    }
    if (this.layers.loose && state.logos) {
      ctx.save();
      ctx.clip(union);
      ctx.drawImage(this.layers.loose, 0, 0, width, height);
      ctx.restore();
    }
    this.dropFringe();
    this.dilate(4, 3);
    this.texture.needsUpdate = true;
  }

  // Dobladillo con doble costura de recubridora a ~2 cm del ruedo.
  drawHem(part) {
    const { ctx } = this;
    const vb = this.mold.viewBox;
    const k = this.scale / this.metersPerUnit; // px por metro
    const yB = (part.bbox.maxY - vb.y) * this.scale;
    const x0 = (part.bbox.minX - vb.x) * this.scale;
    const x1 = (part.bbox.maxX - vb.x) * this.scale;
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    ctx.fillRect(x0, yB - 0.025 * k, x1 - x0, 0.025 * k);
    ctx.lineWidth = Math.max(1, 0.0007 * k);
    ctx.setLineDash([0.0028 * k, 0.0013 * k]);
    for (const d of [0.0155, 0.0215]) {
      const y = yB - d * k;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(x0, y + ctx.lineWidth);
      ctx.lineTo(x1, y + ctx.lineWidth);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Elimina los píxeles semitransparentes del borde (mezclados con el fondo)
  // para que la dilatación parta sólo de color opaco.
  dropFringe() {
    const img = this.ctx.getImageData(0, 0, this.width, this.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) d[i] = 0;
    this.ctx.putImageData(img, 0, 0);
  }

  // Extiende los bordes de cada pieza hacia afuera para que el filtrado de la
  // textura no muestre halos transparentes en las costuras.
  dilate(iterations, step) {
    const tmp = document.createElement('canvas');
    tmp.width = this.width;
    tmp.height = this.height;
    const tctx = tmp.getContext('2d');
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (let k = 0; k < iterations; k++) {
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      tctx.drawImage(this.canvas, 0, 0);
      this.ctx.globalCompositeOperation = 'destination-over';
      for (const [dx, dy] of dirs) this.ctx.drawImage(tmp, dx * step, dy * step);
    }
    this.ctx.globalCompositeOperation = 'source-over';
  }
}

// Mapa de normales de la tela: punto jersey (columnas de 1,25 mm) más
// ondulaciones suaves de la tela, en un mosaico que representa 8 × 8 cm.
export const FABRIC_TILE_M = 0.08;
export function makeFabricNormalMap() {
  const N = 1024;
  const h = new Float32Array(N * N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = Array.from({ length: 12 }, () => {
    const fx = Math.floor(rnd() * 7) - 3;
    const fy = Math.floor(rnd() * 6) + 1;
    const amp = 2.6 / Math.hypot(fx, fy);
    return { fx, fy, amp, ph: rnd() * Math.PI * 2 };
  });
  const knit = new Float32Array(16 * 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = x - 8 + 0.5;
      const cy = y - 8 + 0.5;
      const side = cx < 0 ? -1 : 1;
      const ax = cx - side * 3.5;
      const rx = ax * Math.cos(0.45 * side) - cy * Math.sin(0.45 * side);
      const ry = ax * Math.sin(0.45 * side) + cy * Math.cos(0.45 * side);
      const d = (rx / 3.2) ** 2 + (ry / 7.5) ** 2;
      knit[y * 16 + x] = Math.max(0, 1 - d) ** 0.6;
    }
  }
  const sinRow = waves.map((w) => {
    const row = new Float32Array(N);
    for (let x = 0; x < N; x++) row[x] = (2 * Math.PI * w.fx * x) / N + w.ph;
    return row;
  });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (let k = 0; k < waves.length; k++) {
        const w = waves[k];
        v += w.amp * Math.sin(sinRow[k][x] + (2 * Math.PI * w.fy * y) / N);
      }
      h[y * N + x] = v + 0.7 * knit[(y % 16) * 16 + (x % 16)] + 0.06 * rnd();
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.9;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.9;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Textura acanalada para el cuello (rib).
export function makeRibNormalMap() {
  const N = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.cos((x / N) * Math.PI * 2 * 4) * 0.7;
      const l = Math.hypot(dx, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = 128;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
