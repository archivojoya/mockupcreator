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

// Mapa de normales de tejido de punto (jersey) que se repite en mosaico.
export function makeKnitNormalMap() {
  const N = 128;
  const h = new Float32Array(N * N);
  const wale = 16; // ancho de columna de punto en píxeles
  const course = 12; // alto de pasada
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = (x % wale) - wale / 2;
      const cy = (y % course) - course / 2;
      // Dos "patas" inclinadas formando la V del punto.
      const side = cx < 0 ? -1 : 1;
      const ax = cx - side * wale * 0.22;
      const rx = ax * Math.cos(0.5 * side) - cy * Math.sin(0.5 * side);
      const ry = ax * Math.sin(0.5 * side) + cy * Math.cos(0.5 * side);
      const d = (rx / (wale * 0.2)) ** 2 + (ry / (course * 0.62)) ** 2;
      h[y * N + x] = Math.max(0, 1 - d) ** 0.6 + 0.08 * Math.random();
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 1.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 1.2;
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
