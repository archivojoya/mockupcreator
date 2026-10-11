// Texturas de la tela, generadas en un canvas: relieve de malla deportiva,
// acanalado del cuello y el mapa de estampado (grilla con el nombre de cada
// pieza, para ver cómo cae un diseño sobre la prenda).

import * as THREE from 'three';

// Mapa de normales a partir de una función de altura en [0, 1)².
function normalMapFrom(size, height, strength) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = height(x / size, y / size);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l) * 127.5 + 127.5;
      img.data[i + 1] = (dy / l) * 127.5 + 127.5;
      img.data[i + 2] = (1 / l) * 127.5 + 127.5;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Malla deportiva: agujeritos en tresbolillo sobre un tejido de punto fino.
// Un mosaico mide MESH_TILE metros.
export const MESH_TILE = 0.008;
export function makeMeshNormalMap() {
  const holes = 4; // agujeros por lado del mosaico
  return normalMapFrom(
    256,
    (u, v) => {
      let d = Infinity;
      for (let r = -1; r <= holes; r++)
        for (let c = -1; c <= holes; c++) {
          const cx = (c + (r % 2 ? 0.5 : 0) + 0.5) / holes;
          const cy = (r + 0.5) / holes;
          d = Math.min(d, Math.hypot(u - cx, v - cy));
        }
      const hole = Math.exp(-(((d * holes) / 0.22) ** 2));
      const knit = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * holes * 4) * Math.sin(v * Math.PI * 2 * holes * 2);
      return -hole * 0.9 + knit * 0.12;
    },
    2.2,
  );
}

// Acanalado del cuello y los puños: costillas a lo largo de v. Un mosaico
// mide RIB_TILE metros a lo largo de la tira.
export const RIB_TILE = 0.004;
export function makeRibNormalMap() {
  return normalMapFrom(128, (u) => 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 2), 3.5);
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
