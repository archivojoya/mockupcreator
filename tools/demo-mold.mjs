// Genera public/molde-futbol.svg: un molde de ejemplo con diseño de camiseta
// de fútbol (franja central, costados, hombros y mangas en contraste, puños y
// cuello), dibujado sobre el molde canónico de la plantilla.
//   node tools/demo-mold.mjs [salida.svg]
import { writeFileSync } from 'node:fs';
import { canonicalMold, DIMS } from './template/canonical.mjs';

const out = process.argv[2] || 'public/molde-futbol.svg';
const C = { base: '#ffffff', stripe: '#2330d6', yoke: '#111114', cuff: '#ffffff', collar: '#ffffff' };
const m = canonicalMold();
const P = m.parts;
const pts = (poly) => poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const bez = (p0, p1, p2, p3, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  });
// Recortes de cada pieza (van en <defs>).
const clips = [];
const mirror = (poly, cx) => poly.map((p) => ({ x: 2 * cx - p.x, y: p.y })).reverse();

// Hombros en contraste (efecto ranglan): del escote a la axila.
function yoke(cx, top, neckX, neckY) {
  const curve = bez({ x: cx + neckX, y: top + neckY }, { x: cx + neckX + 40, y: top + neckY + 70 }, { x: cx + DIMS.armX - 70, y: top + DIMS.armY - 30 }, { x: cx + DIMS.armX + 5, y: top + DIMS.armY + 6 });
  const right = [...curve, { x: cx + 400, y: top + DIMS.armY + 6 }, { x: cx + 400, y: top - 60 }, { x: cx + neckX, y: top - 60 }];
  return [right, mirror(right, cx)];
}
function body(key, cx, top) {
  const id = key === 'front' ? 'frente' : 'espalda';
  const poly = P[key].poly;
  const H = DIMS.length;
  const shapes = [`<rect x="${cx - 400}" y="${top - 60}" width="800" height="${H + 120}" fill="${C.base}"/>`];
  // Franja central (en la espalda, sólo abajo del número).
  const sw = 108;
  if (key === 'front') shapes.push(`<rect x="${cx - sw / 2}" y="${top - 60}" width="${sw}" height="${H + 120}" fill="${C.stripe}"/>`);
  else shapes.push(`<rect x="${cx - sw / 2}" y="${top + 505}" width="${sw}" height="${H}" fill="${C.stripe}"/>`);
  // Costados.
  for (const s of [-1, 1]) {
    const band = [
      { x: cx + s * (DIMS.armX - 48), y: top + DIMS.armY },
      { x: cx + s * 420, y: top + DIMS.armY },
      { x: cx + s * 420, y: top + H + 60 },
      { x: cx + s * (DIMS.hemX - 44), y: top + H + 60 },
    ];
    shapes.push(`<polygon points="${pts(band)}" fill="${C.stripe}"/>`);
  }
  const [yr, yl] = key === 'front' ? yoke(cx, top, 62, 34) : yoke(cx, top, 0, 52);
  shapes.push(`<polygon points="${pts(yr)}" fill="${C.yoke}"/>`, `<polygon points="${pts(yl)}" fill="${C.yoke}"/>`);
  clips.push(`<clipPath id="recorte-${clips.length + 1}"><polygon points="${pts(poly)}"/></clipPath>`);
  return `<g id="${id}">
    <g clip-path="url(#recorte-${clips.length})">${shapes.join('')}</g>
    <polygon points="${pts(poly)}" fill="none" stroke="#000" stroke-width="1"/>
  </g>`;
}
function sleeve(key, id) {
  const poly = P[key].poly;
  const b = P[key].bbox;
  const cuff = 34;
  clips.push(`<clipPath id="recorte-${clips.length + 1}"><polygon points="${pts(poly)}"/></clipPath>`);
  return `<g id="${id}">
    <g clip-path="url(#recorte-${clips.length})"><rect x="${b.minX - 10}" y="${b.minY - 10}" width="${b.maxX - b.minX + 20}" height="${b.maxY - b.minY + 20}" fill="${C.yoke}"/><rect x="${b.minX - 10}" y="${b.maxY - cuff}" width="${b.maxX - b.minX + 20}" height="${cuff + 10}" fill="${C.cuff}"/></g>
    <polygon points="${pts(poly)}" fill="none" stroke="#000" stroke-width="1"/>
  </g>`;
}
const fx = P.front.bbox.minX + (P.front.bbox.maxX - P.front.bbox.minX) / 2;
const bx = P.back.bbox.minX + (P.back.bbox.maxX - P.back.bbox.minX) / 2;
const top = P.front.bbox.minY;
const font = `font-family="Impact, 'Arial Narrow Bold', 'Arial Black', sans-serif" font-weight="700" text-anchor="middle"`;
const outline = `stroke="${C.stripe}" stroke-width="5" paint-order="stroke" stroke-linejoin="round"`;
const pieces = [body('front', fx, top), body('back', bx, top), sleeve('sleeveL', 'manga_izquierda'), sleeve('sleeveR', 'manga_derecha')];
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.viewBox.w} ${m.viewBox.h + 80}">
  <!-- Molde de ejemplo generado por tools/demo-mold.mjs -->
  <defs>${clips.join('')}</defs>
  ${pieces.join('\n  ')}
  <g id="cuello">
    <rect x="1500" y="${m.viewBox.h - 20}" width="620" height="44" fill="${C.collar}"/>
    <rect x="1500" y="${m.viewBox.h - 20}" width="620" height="44" fill="none" stroke="#000" stroke-width="1"/>
  </g>
  <g id="numero_chico"><text x="${fx - 112}" y="${top + 205}" font-size="84" ${font} fill="#111114" ${outline}>7</text></g>
  <g id="estrella"><polygon points="${pts(Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 7 : 17;
    return { x: fx + 112 + r * Math.cos(a), y: top + 128 + r * Math.sin(a) };
  }))}" fill="#e2b13c"/></g>
  <g id="nombre"><text x="${bx}" y="${top + 205}" font-size="60" ${font} fill="#111114" ${outline}>JOYITA</text></g>
  <g id="dorsal"><text x="${bx}" y="${top + 478}" font-size="265" ${font} fill="#111114" ${outline}>7</text></g>
</svg>
`;
writeFileSync(out, svg);
console.log(`${out}: ${(svg.length / 1024).toFixed(0)} KB`);
