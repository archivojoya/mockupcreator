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
  { key: 'front', id: 'frente', label: 'FRENTE', anchor: 'centro del escote', x: MARGIN, y: TOP, w: 760, h: 1080, ax: 380, ay: 230 },
  { key: 'back', id: 'espalda', label: 'ESPALDA', anchor: 'centro del escote', x: 2 * MARGIN + 760, y: TOP, w: 760, h: 1080, ax: 380, ay: 230 },
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

// ---------- diseño por pieza ----------

// Otra forma, más simple: un SVG por pieza (o uno con una capa por pieza)
// con sólo su diseño. La pieza sale del nombre del archivo o de la capa; la
// página lo ubica en el molde: centrado en la pieza y arriba contra su borde
// de arriba (el cuello, centrado en el medio de atrás y dando la vuelta). Si
// el SVG dice su tamaño en unidades reales (mm, cm, in, pt) va a ese tamaño;
// si no, se agranda o achica hasta cubrir la pieza.
const NAMES = [
  ['front', /frente|front|delanter/i],
  ['back', /espalda|(^|[^a-z])back([^a-z]|$)|dorso|trasera/i],
  ['sleeve', /manga|sleeve/i],
  ['cuff', /pu[ñn]o|cuff/i],
  ['collar', /cuello|collar/i],
];
export const PIECE_LABELS = { front: 'Frente', back: 'Espalda', sleeveL: 'Manga izquierda', sleeveR: 'Manga derecha', cuffL: 'Puño izquierdo', cuffR: 'Puño derecho', collar: 'Cuello' };
export function pieceKeys(name) {
  name = name.normalize('NFC');
  for (const [base, re] of NAMES) {
    if (!re.test(name)) continue;
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
    const a = built.geos[pc.key].attributes.uv1.array;
    let n = a.length / 2;
    if (pc.key === 'collar') n = (built.layout.rings.collar.length + 1) * (COLLAR_FOLD + 1);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      u0 = Math.min(u0, a[i * 2]);
      u1 = Math.max(u1, a[i * 2]);
      v0 = Math.min(v0, a[i * 2 + 1]);
      v1 = Math.max(v1, a[i * 2 + 1]);
    }
    const wrap = pc.key === 'collar' ? (u1 - u0) * 1000 : 0;
    out[pc.key] = { w: wrap || 2 * Math.max(-u0, u1) * 1000, h: (v1 - v0) * 1000, top: v0 * 1000, wrap };
  }
  return out;
}

const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };
function viewBoxOf(root) {
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || !(vb[2] > 0 && vb[3] > 0)) {
    const w = parseFloat(root.getAttribute('width'));
    const h = parseFloat(root.getAttribute('height'));
    if (!(w > 0 && h > 0)) return null;
    vb = [0, 0, w, h];
  }
  return vb;
}
// Milímetros por unidad del SVG, si dice su tamaño en unidades reales.
function mmPerUnit(root, vb) {
  const m = /^\s*([\d.]+)\s*(mm|cm|in|pt|pc)\s*$/i.exec(root.getAttribute('width') || '');
  return m ? (parseFloat(m[1]) * UNIT_MM[m[2].toLowerCase()]) / vb[2] : null;
}
const isTemplate = (root, vb) => Math.abs(vb[3] / vb[2] / (SHEET.h / SHEET.w) - 1) < 0.02 && !!root.querySelector('[id^="guias"], [data-name^="GUIAS"]');

// Lee SVGs sueltos ({ name, text }): devuelve los diseños por pieza
// ({ keys, svg (texto, sólo esa pieza), vb, mm, name }), `template` si alguno
// es la plantilla completa, y los que no se reconocieron.
export function readPieces(files) {
  const pieces = [];
  const unknown = [];
  let template = null;
  for (const { name, text } of files) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    const vb = root && root.nodeName.toLowerCase() === 'svg' && !doc.querySelector('parsererror') ? viewBoxOf(root) : null;
    if (!vb) {
      unknown.push(`${name} (no es un SVG válido)`);
      continue;
    }
    if (isTemplate(root, vb)) {
      template = text;
      continue;
    }
    const mm = mmPerUnit(root, vb);
    // Capas con nombre de pieza (las de más arriba).
    const named = [...root.querySelectorAll('[id], [data-name]')].filter((el) => {
      if (el.nodeName.toLowerCase() === 'svg' || !pieceKeys(`${el.getAttribute('id') || ''} ${el.getAttribute('data-name') || ''}`).length) return false;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (pieceKeys(`${p.getAttribute('id') || ''} ${p.getAttribute('data-name') || ''}`).length) return false;
      return true;
    });
    const keys = pieceKeys(`${name} ${root.getAttribute('id') || ''} ${doc.querySelector('title')?.textContent || ''}`);
    // Si el archivo ya dice su pieza y las capas son de esa misma, es un
    // diseño de esa pieza (su mesa de trabajo es el recuadro).
    const layerKeys = (el) => pieceKeys(`${el.getAttribute('id') || ''} ${el.getAttribute('data-name') || ''}`).join();
    if (named.length && !(keys.length && named.every((el) => layerKeys(el) === keys.join()))) {
      for (const el of named) pieces.push({ keys: pieceKeys(`${el.getAttribute('id') || ''} ${el.getAttribute('data-name') || ''}`), layer: el, doc, vb, mm, name: el.getAttribute('data-name') || el.getAttribute('id') });
      continue;
    }
    if (keys.length) pieces.push({ keys, svg: text, vb, mm, name });
    else unknown.push(name);
  }
  return { pieces, template, unknown };
}

// Una capa sola de un SVG con varias: su contenido (con los estilos y
// definiciones del archivo) y su recuadro (un rectángulo llamado "mesa" o
// "marco" dentro de la capa, o lo que ocupa lo dibujado).
export function isolateLayer(piece) {
  const { doc, layer } = piece;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:1000px;visibility:hidden';
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('width', 1000);
  svg.setAttribute('height', 1000);
  svg.setAttribute('preserveAspectRatio', 'none');
  host.append(svg);
  document.body.append(host);
  try {
    // El mismo elemento en la copia.
    const path = [];
    for (let el = layer; el !== doc.documentElement; el = el.parentElement) path.unshift([...el.parentElement.children].indexOf(el));
    let mine = svg;
    for (const i of path) mine = mine.children[i];
    const frameEl = [...mine.querySelectorAll('rect')].find((r) => /mesa|marco|frame|artboard|area/i.test(`${r.id} ${r.getAttribute('data-name') || ''}`));
    const box = (frameEl || mine).getBoundingClientRect();
    const sb = svg.getBoundingClientRect();
    const vb = piece.vb;
    const ux = vb[2] / sb.width;
    const uy = vb[3] / sb.height;
    const rect = [vb[0] + (box.left - sb.left) * ux, vb[1] + (box.top - sb.top) * uy, box.width * ux, box.height * uy];
    if (frameEl) frameEl.remove();
    // Fuera todo lo que no es la capa, sus antepasados o definiciones.
    const keep = new Set([mine]);
    for (let p = mine.parentElement; p; p = p.parentElement) keep.add(p);
    const prune = (el) => {
      for (const ch of [...el.children]) {
        if (keep.has(ch)) {
          if (ch !== mine) prune(ch);
        } else if (!/^(defs|style|lineargradient|radialgradient|clippath|mask|pattern|symbol|filter)$/i.test(ch.nodeName)) ch.remove();
      }
    };
    prune(svg);
    if (!(rect[2] > 0 && rect[3] > 0)) return null;
    return { svg: new XMLSerializer().serializeToString(svg), vb: rect };
  } finally {
    host.remove();
  }
}

// Lienzo del recuadro de una pieza (como los de la plantilla) con el diseño
// ubicado en su molde. Devuelve también cómo se ubicó.
export async function placePiece(key, piece, size) {
  const pc = PIECES.find((p) => p.key === key);
  const [, , fw, fh] = piece.vb;
  const real = piece.mm && Math.abs((fw * piece.mm) / size.w - 1) < 0.6;
  // Sin tamaño real: cubre la pieza (lo que sobra queda a los costados o abajo).
  const s = real ? piece.mm : Math.max(size.w / fw, size.wrap ? 0 : size.h / fh); // mm por unidad
  const w = fw * s;
  const h = fh * s;
  const k = Math.min(PX_PER_MM, MAX_PX / Math.max(pc.w, pc.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pc.w * k);
  canvas.height = Math.round(pc.h * k);
  const doc = new DOMParser().parseFromString(piece.svg, 'image/svg+xml');
  const root = doc.documentElement;
  const pw = Math.max(1, Math.round(w * k));
  const ph = Math.max(1, Math.round(h * k));
  root.setAttribute('viewBox', piece.vb.join(' '));
  root.setAttribute('width', pw);
  root.setAttribute('height', ph);
  root.setAttribute('preserveAspectRatio', 'none');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const ctx = canvas.getContext('2d');
    const x = (pc.ax - w / 2) * k;
    const y = (pc.ay + size.top) * k;
    ctx.drawImage(img, x, y, pw, ph);
    // El cuello da la vuelta: lo que pasa de una punta sigue en la otra.
    if (size.wrap) for (const d of [-1, 1]) ctx.drawImage(img, x + d * size.wrap * k, y, pw, ph);
  } finally {
    URL.revokeObjectURL(url);
  }
  return { canvas, real, w, h, rect: [(pc.ax - w / 2) * k, (pc.ay + size.top) * k, pw, ph] };
}
