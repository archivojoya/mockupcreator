// Diseños propios: plantilla SVG con todas las piezas (1:1, en mm) y lectura
// del SVG diseñado sobre ella. Cada pieza ocupa un recuadro fijo de la
// plantilla, con su punto de anclaje siempre en el mismo lugar (ver printUV
// en shirt.js): lo que se dibuja dentro del recuadro se estampa en esa pieza,
// y no se mueve si después cambian el largo o el calce.
import * as THREE from 'three';
import { COLLAR_FOLD } from './shirt.js';

// Recuadros (mm sobre la mesa de trabajo) y anclaje dentro de cada uno.
const MARGIN = 40;
const TOP = 110; // lugar para el título y las instrucciones
export const PIECES = [
  { key: 'front', id: 'frente', label: 'FRENTE', anchor: 'centro del escote', x: MARGIN, y: TOP, w: 760, h: 1080, ax: 380, ay: 280 },
  { key: 'back', id: 'espalda', label: 'ESPALDA', anchor: 'centro del escote', x: 2 * MARGIN + 760, y: TOP, w: 760, h: 1080, ax: 380, ay: 280 },
  { key: 'sleeveR', id: 'manga-derecha', label: 'MANGA DERECHA', anchor: 'punta del hombro', x: MARGIN, y: TOP + 1080 + 60, w: 580, h: 320, ax: 290, ay: 20 },
  { key: 'sleeveL', id: 'manga-izquierda', label: 'MANGA IZQUIERDA', anchor: 'punta del hombro', x: 2 * MARGIN + 760, y: TOP + 1080 + 60, w: 580, h: 320, ax: 290, ay: 20 },
  { key: 'cuffR', id: 'puno-derecho', label: 'PUÑO DERECHO', anchor: 'centro de arriba', x: MARGIN, y: TOP + 1460 + 60, w: 500, h: 50, ax: 250, ay: 10 },
  { key: 'cuffL', id: 'puno-izquierdo', label: 'PUÑO IZQUIERDO', anchor: 'centro de arriba', x: 2 * MARGIN + 760, y: TOP + 1460 + 60, w: 500, h: 50, ax: 250, ay: 10 },
  { key: 'collar', id: 'cuello', label: 'CUELLO', anchor: 'centro de atrás, en la costura', x: MARGIN, y: TOP + 1570 + 80, w: 1240, h: 75, ax: 620, ay: 65 },
];
export const SHEET = { w: 3 * MARGIN + 2 * 760, h: TOP + 1570 + 80 + 75 + 60 };
const PX_PER_MM = 2.5;
const MAX_PX = 4096;

const NS = 'http://www.w3.org/2000/svg';
const f1 = (v) => (Math.round(v * 10) / 10).toString();

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

// Puntos de una línea de la pieza (una fila o columna de la grilla).
function linePoints(geo, ids) {
  const uv = geo.attributes.uv1.array;
  return ids.map((v) => [uv[v * 2], uv[v * 2 + 1]]);
}

// Plantilla SVG para la camiseta armada (`built`) y sus parámetros.
export function templateSVG(built, params, colors) {
  const M = built.measures;
  const L = built.layout;
  const out = [];
  const W = L.cols + 1;
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="${NS}" width="${SHEET.w}mm" height="${SHEET.h}mm" viewBox="0 0 ${SHEET.w} ${SHEET.h}">`);
  out.push(`<title>Plantilla de camiseta 1:1</title>`);
  const neck = params.neckStyle === 'v' ? 'en V' : 'redondo';
  const fit = params.fit < 0.3 ? 'ajustado' : params.fit < 0.7 ? 'regular' : 'holgado';
  out.push(`<g id="guias-instrucciones" data-name="GUIAS instrucciones" font-family="Arial, Helvetica, sans-serif" fill="#333">`);
  out.push(`<text x="${MARGIN}" y="52" font-size="30" font-weight="bold">PLANTILLA DE CAMISETA · ESCALA 1:1 (mm)</text>`);
  out.push(
    `<text x="${MARGIN}" y="82" font-size="15">Calce ${fit} · largo ${Math.round(M.L * 100)} cm · manga ${Math.round(params.sleeveLength * 100)} cm · cuello ${neck} de ${f1(params.neckDepth * 100)} cm. Diseñá cada pieza dentro de su recuadro, en su capa DISEÑO (podés pasarte del contorno: lo de afuera no se ve). Las capas GUIAS no se estampan.</text>`,
  );
  out.push(`<text x="${MARGIN}" y="102" font-size="15">Antes de exportar a SVG: textos a contornos, imágenes incrustadas, colores en RGB. No muevas ni cambies el tamaño de la mesa de trabajo.</text>`);
  out.push(`</g>`);
  for (const pc of PIECES) {
    const geo = built.geos[pc.key];
    const X = (px) => pc.x + pc.ax + px * 1000;
    const Y = (py) => pc.y + pc.ay + py * 1000;
    const path = (pts, close) => pts.map(([u, v], i) => `${i ? 'L' : 'M'}${f1(X(u))} ${f1(Y(v))}`).join('') + (close ? 'Z' : '');
    const color = colors[{ front: 'body', back: 'body', sleeveL: 'sleeves', sleeveR: 'sleeves', cuffL: 'cuffs', cuffR: 'cuffs', collar: 'collar' }[pc.key]];
    out.push(`<g id="${pc.id}" data-name="${pc.label}">`);
    out.push(`<g id="guias-${pc.id}" data-name="GUIAS ${pc.label}" fill="none" font-family="Arial, Helvetica, sans-serif">`);
    out.push(`<rect x="${pc.x}" y="${pc.y}" width="${pc.w}" height="${pc.h}" stroke="#9aa0a8" stroke-width="0.6" stroke-dasharray="6 4"/>`);
    // Grilla de 5 cm desde el anclaje.
    const grid = [];
    for (let gx = pc.ax % 50; gx <= pc.w; gx += 50) grid.push(`M${f1(pc.x + gx)} ${pc.y}V${pc.y + pc.h}`);
    for (let gy = pc.ay % 50; gy <= pc.h; gy += 50) grid.push(`M${pc.x} ${f1(pc.y + gy)}H${pc.x + pc.w}`);
    out.push(`<path d="${grid.join('')}" stroke="#d6d9de" stroke-width="0.4"/>`);
    // Contorno: los bordes de la malla (el cuello, sus dos caras por separado).
    let loops;
    if (pc.key === 'collar') {
      const uv = geo.attributes.uv1.array;
      const SW = L.rings.collar.length + 1;
      const P = uv.length / 2 / SW;
      const row = (j) => Array.from({ length: SW }, (_, i) => [uv[(j * SW + i) * 2], uv[(j * SW + i) * 2 + 1]]);
      loops = [
        [...row(0), ...row(COLLAR_FOLD).reverse()],
        [...row(COLLAR_FOLD + 1), ...row(P - 1).reverse()],
      ];
    } else loops = outlineLoops(geo);
    out.push(`<path d="${loops.map((l) => path(l, true)).join('')}" fill="${color}" fill-opacity="0.12" stroke="#1d2125" stroke-width="0.8"/>`);
    // Líneas de referencia de cada pieza.
    const refs = [];
    if (pc.key === 'front' || pc.key === 'back') {
      refs.push(['centro', linePoints(geo, Array.from({ length: L.rows + 1 }, (_, r) => r * W + L.cols / 2))]);
    } else if (pc.key.startsWith('sleeve') || pc.key.startsWith('cuff')) {
      const SW = L.sleeveSW;
      const rows = pc.key.startsWith('sleeve') ? L.sleeveRows : L.cuffRows;
      refs.push(['centro', linePoints(geo, Array.from({ length: rows + 1 }, (_, r) => r * SW + (SW - 1) / 2))]);
    } else if (pc.key === 'collar') {
      const uv = geo.attributes.uv1.array;
      const n = L.rings.collar.length;
      const SW = n + 1;
      const P = uv.length / 2 / SW;
      // Marcas de centro y hombros en las dos caras.
      for (const [label, i] of [
        ['centro atrás', L.cols + L.cols / 2],
        ['centro adelante', L.cols / 2],
        ['hombro', 0],
        ['hombro', L.cols],
      ]) {
        refs.push([label, [0, COLLAR_FOLD].map((j) => [uv[(j * SW + i) * 2], uv[(j * SW + i) * 2 + 1]])]);
        refs.push([null, [COLLAR_FOLD + 1, P - 1].map((j) => [uv[(j * SW + i) * 2], uv[(j * SW + i) * 2 + 1]])]);
      }
    }
    for (const [, pts] of refs) out.push(`<path d="${path(pts, false)}" stroke="#c81e3a" stroke-width="0.5" stroke-dasharray="4 3"/>`);
    // Anclaje: una cruz.
    out.push(`<path d="M${pc.x + pc.ax - 8} ${pc.y + pc.ay}h16M${pc.x + pc.ax} ${pc.y + pc.ay - 8}v16" stroke="#c81e3a" stroke-width="0.8"/>`);
    const fs = pc.h < 100 ? 11 : 22;
    out.push(`<text x="${pc.x + 8}" y="${pc.y + fs + 6}" font-size="${fs}" font-weight="bold" fill="#1d2125">${pc.label}</text>`);
    if (pc.h >= 100) out.push(`<text x="${pc.x + 8}" y="${pc.y + 2 * fs + 10}" font-size="12" fill="#5c636b">Cruz: ${pc.anchor}. Vista desde afuera. Grilla de 5 cm.</text>`);
    if (pc.key === 'collar') {
      out.push(`<text x="${pc.x + pc.w - 8}" y="${pc.y + pc.h - 3}" font-size="8" fill="#5c636b" text-anchor="end">abajo: cara de afuera (vista desde afuera) · arriba: cara de adentro (vista desde adentro)</text>`);
      for (const [label, pts] of refs) if (label) out.push(`<text x="${f1(X(pts[0][0]) + 2)}" y="${pc.y + pc.h - 3}" font-size="8" fill="#c81e3a">${label}</text>`);
    }
    out.push(`</g>`);
    out.push(`<g id="diseno-${pc.id}" data-name="DISEÑO ${pc.label}"></g>`);
    out.push(`</g>`);
  }
  out.push(`</svg>`);
  return out.join('\n');
}

// Lee un SVG diseñado sobre la plantilla: devuelve un lienzo por pieza (lo
// que haya dentro de su recuadro) y qué piezas tienen algo.
export async function readDesign(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.nodeName.toLowerCase() !== 'svg') throw new Error('El archivo no es un SVG válido.');
  // Escala: la mesa de trabajo de la plantilla (sea cual sea la unidad con
  // que la guardó el programa de diseño).
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) {
    const w = parseFloat(root.getAttribute('width'));
    const h = parseFloat(root.getAttribute('height'));
    if (!(w > 0 && h > 0)) throw new Error('El SVG no tiene tamaño (viewBox).');
    vb = [0, 0, w, h];
  }
  const s = vb[2] / SHEET.w;
  const ratio = vb[3] / vb[2] / (SHEET.h / SHEET.w);
  if (Math.abs(ratio - 1) > 0.02) throw new Error('La mesa de trabajo no es la de la plantilla (¿se cambió su tamaño?).');
  // Fuera las guías.
  for (const el of [...root.querySelectorAll('[id], [data-name]')]) {
    const name = `${el.getAttribute('id') || ''} ${el.getAttribute('data-name') || ''}`;
    if (/gu[ií]as/i.test(name)) el.remove();
  }
  const result = {};
  const found = [];
  for (const pc of PIECES) {
    const k = Math.min(PX_PER_MM, MAX_PX / Math.max(pc.w, pc.h));
    const pw = Math.round(pc.w * k);
    const ph = Math.round(pc.h * k);
    root.setAttribute('viewBox', `${vb[0] + pc.x * s} ${vb[1] + pc.y * s} ${pc.w * s} ${pc.h * s}`);
    root.setAttribute('width', pw);
    root.setAttribute('height', ph);
    root.setAttribute('preserveAspectRatio', 'none');
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, pw, ph);
      // ¿Hay algo dibujado? (mirando una copia chica)
      const probe = document.createElement('canvas');
      probe.width = probe.height = 48;
      const pctx = probe.getContext('2d', { willReadFrequently: true });
      pctx.drawImage(canvas, 0, 0, 48, 48);
      const a = pctx.getImageData(0, 0, 48, 48).data;
      let any = false;
      for (let i = 3; i < a.length && !any; i += 4) any = a[i] > 8;
      if (any) {
        result[pc.key] = canvas;
        found.push(pc.label.toLowerCase());
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { canvases: result, found };
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
