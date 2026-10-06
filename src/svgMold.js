// Lectura de un molde SVG de camiseta: detecta cada parte (frente, espalda,
// mangas, cuello) por el id de su grupo, extrae su contorno y prepara capas
// rasterizables (diseño de las piezas y elementos sueltos como logos).

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHAPES = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line']);

export const PART_DEFS = [
  { key: 'front', label: 'Frente', re: /(frente|front|delantero|delantera|pecho)/i },
  { key: 'back', label: 'Espalda', re: /(espalda|\bback|_back|trasero|trasera|dorso)/i },
  { key: 'sleeveL', label: 'Manga izquierda', re: /(manga|sleeve).*(izq|left)|(izq|left).*(manga|sleeve)/i },
  { key: 'sleeveR', label: 'Manga derecha', re: /(manga|sleeve).*(der|right)|(der|right).*(manga|sleeve)/i },
  { key: 'collar', label: 'Cuello', re: /(cuello|collar|neck|rib)/i },
];

function parseCss(text) {
  const rules = {};
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^}]*)\}/g, (_, sel, body) => {
    const decl = parseDecl(body);
    for (let s of sel.split(',')) {
      s = s.trim();
      const m = s.match(/^\.([\w-]+)$/);
      if (m) rules[m[1]] = Object.assign(rules[m[1]] || {}, decl);
    }
    return '';
  });
  return rules;
}

function parseDecl(body) {
  const decl = {};
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  return decl;
}

export function normalizeColor(c) {
  if (!c) return null;
  c = c.trim().toLowerCase();
  if (c === 'none' || c === 'transparent' || c.startsWith('url(')) return null;
  const named = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080' };
  if (named[c]) return named[c];
  let m = c.match(/^#([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((h) => h + h).join('');
  m = c.match(/^#([0-9a-f]{6})$/);
  if (m) return c;
  m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
  return null;
}

export class SvgMold {
  constructor(text, name = 'molde.svg') {
    this.name = name;
    this.text = text;
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('El archivo no es un SVG válido.');
    this.doc = doc;
    this.root = doc.documentElement;
    const vb = (this.root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite)) {
      this.viewBox = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    } else {
      const w = parseFloat(this.root.getAttribute('width')) || 1000;
      const h = parseFloat(this.root.getAttribute('height')) || 1000;
      this.viewBox = { x: 0, y: 0, w, h };
    }
    this.css = parseCss([...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n'));
    this._tagElements();
    this._findParts();
    this._findPalette();
  }

  // Marca cada elemento con un índice para reencontrarlo en los clones.
  _tagElements() {
    let i = 0;
    for (const el of this.root.querySelectorAll('*')) el.setAttribute('data-mc', String(i++));
  }

  styleOf(el) {
    const st = {};
    for (const cls of (el.getAttribute('class') || '').split(/\s+/)) {
      if (cls && this.css[cls]) Object.assign(st, this.css[cls]);
    }
    for (const a of ['fill', 'stroke', 'clip-path', 'display', 'opacity']) {
      if (el.hasAttribute(a)) st[a] = el.getAttribute(a);
    }
    if (el.hasAttribute('style')) Object.assign(st, parseDecl(el.getAttribute('style')));
    return st;
  }

  _findParts() {
    const groups = [...this.root.querySelectorAll('g, [id]')].filter((el) => el.closest('defs') === null);
    this.parts = {};
    for (const def of PART_DEFS) {
      const found = groups.find((el) => {
        const id = `${el.getAttribute('id') || ''} ${el.getAttribute('data-name') || ''}`;
        if (!id.trim() || !def.re.test(id)) return false;
        // Evita confundir "manga" genéricas cuando hay lado explícito.
        return !Object.values(this.parts).some((p) => p.el === el || p.el.contains(el));
      });
      if (!found) continue;
      const outline = this._outlineOf(found);
      if (!outline) continue;
      this.parts[def.key] = { key: def.key, label: def.label, el: found, ...outline };
    }
    // Elementos sueltos (logos, textos) fuera de las piezas.
    const partEls = Object.values(this.parts).map((p) => p.el);
    this.looseEls = [];
    const visit = (node) => {
      for (const child of node.children) {
        const tag = child.localName;
        if (['defs', 'style', 'title', 'desc', 'metadata', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'symbol'].includes(tag)) continue;
        if (partEls.includes(child)) continue;
        if (partEls.some((p) => child.contains(p))) visit(child);
        else this.looseEls.push(child);
      }
    };
    visit(this.root);
  }

  // Contorno de la pieza: primero un trazo sin relleno hijo directo del grupo
  // (línea de corte), si no, el clipPath que recorta su contenido.
  _outlineOf(group) {
    const candidates = [];
    if (SHAPES.has(group.localName)) candidates.push(group);
    for (const child of group.children) {
      if (!SHAPES.has(child.localName)) continue;
      const st = this.styleOf(child);
      if ((st.fill || '').trim() === 'none') candidates.push(child);
    }
    let best = null;
    for (const c of candidates) {
      const pts = this._shapePoints(c);
      if (!pts || pts.length < 3) continue;
      const a = Math.abs(polyArea(pts));
      if (!best || a > best.area) best = { pts, area: a, outlineEl: c };
    }
    if (!best) {
      const stack = [...group.children];
      while (stack.length && !best) {
        const el = stack.shift();
        const cp = this.styleOf(el)['clip-path'];
        const m = cp && cp.match(/url\(\s*['"]?#([^'")\s]+)/);
        if (m) {
          const clip = this.doc.getElementById(m[1]);
          const shape = clip && [...clip.children].find((c) => SHAPES.has(c.localName));
          const pts = shape && this._shapePoints(shape);
          if (pts && pts.length >= 3) best = { pts, area: Math.abs(polyArea(pts)), outlineEl: null };
        }
        stack.push(...el.children);
      }
    }
    if (!best) return null;
    let pts = dedupe(best.pts);
    if (polyArea(pts) < 0) pts = pts.reverse();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      poly: pts,
      outlineEl: best.outlineEl,
      bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
    };
  }

  _shapePoints(el) {
    const tag = el.localName;
    if (tag === 'polygon' || tag === 'polyline') {
      const n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push({ x: n[i], y: n[i + 1] });
      return pts;
    }
    if (tag === 'rect') {
      const x = +el.getAttribute('x') || 0;
      const y = +el.getAttribute('y') || 0;
      const w = +el.getAttribute('width') || 0;
      const h = +el.getAttribute('height') || 0;
      return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
    }
    // Trazados genéricos: se muestrean en un SVG temporal del documento.
    const tmp = document.createElementNS(SVG_NS, 'svg');
    tmp.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden');
    const clone = document.importNode(el, false);
    tmp.appendChild(clone);
    document.body.appendChild(tmp);
    const pts = [];
    try {
      const len = clone.getTotalLength();
      const n = 400;
      for (let i = 0; i < n; i++) {
        const p = clone.getPointAtLength((len * i) / n);
        pts.push({ x: p.x, y: p.y });
      }
    } finally {
      tmp.remove();
    }
    return pts;
  }

  // Colores de relleno usados por el diseño (con herencia), por frecuencia.
  _findPalette() {
    const counts = new Map();
    const walk = (el, inherited) => {
      const st = this.styleOf(el);
      let fill = inherited;
      if (st.fill !== undefined) fill = st.fill;
      if (st.display === 'none') return;
      const tag = el.localName;
      if (['defs', 'clipPath', 'mask', 'style'].includes(tag)) return;
      if (SHAPES.has(tag) && tag !== 'line') {
        const c = normalizeColor(fill);
        if (c) counts.set(c, (counts.get(c) || 0) + 1);
      }
      for (const child of el.children) walk(child, fill);
    };
    walk(this.root, this.root.getAttribute('fill') || '#000000');
    this.palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }

  // Serializa una versión del SVG: sólo piezas (sin líneas de corte) o sólo
  // elementos sueltos, con el remapeo de colores aplicado.
  buildLayer(kind, colorMap, pixelW, pixelH) {
    const doc = this.doc.cloneNode(true);
    const root = doc.documentElement;
    const byId = (el) => root.querySelector(`[data-mc="${el.getAttribute('data-mc')}"]`);
    const parts = Object.values(this.parts);
    if (kind === 'parts') {
      for (const el of this.looseEls) byId(el)?.remove();
      for (const p of parts) if (p.outlineEl) byId(p.outlineEl)?.remove();
    } else {
      if (!this.looseEls.length) return null;
      for (const p of parts) byId(p.el)?.remove();
    }
    const changed = Object.entries(colorMap || {}).filter(([a, b]) => a !== b);
    if (changed.length) {
      const map = new Map(changed);
      const walk = (el, inherited) => {
        const st = this.styleOf(el);
        let fill = inherited;
        if (st.fill !== undefined) fill = st.fill;
        const tag = el.localName;
        if (['defs', 'clipPath', 'mask', 'style'].includes(tag)) return;
        if (SHAPES.has(tag)) {
          const c = normalizeColor(fill);
          if (c && map.has(c)) el.setAttribute('style', `${el.getAttribute('style') || ''};fill:${map.get(c)}`);
        }
        for (const child of el.children) walk(child, fill);
      };
      walk(root, root.getAttribute('fill') || '#000000');
    }
    root.setAttribute('width', String(pixelW));
    root.setAttribute('height', String(pixelH));
    root.setAttribute('preserveAspectRatio', 'none');
    return new XMLSerializer().serializeToString(doc);
  }
}

export async function svgTextToImage(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-3) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) < 1e-3) out.pop();
  return out;
}
