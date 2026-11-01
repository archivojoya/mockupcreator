// Short colgado de dos broches: plano, como la camiseta colgada, y asentado
// con su peso por una simulación de tela simple (una sola vez al armarlo:
// queda fijo, no se mueve con el mouse). Demian: «está como aplastado hasta
// la mitad y desde la mitad se abre; debería caer como la camiseta» (antes,
// plano arriba, y la tela de más de las piernas se volvía volumen).
//
// Cada fila de la pieza se acuesta en dos capas, el frente adelante y la
// espalda atrás, con la tela repartida a lo largo como está: arriba de la
// entrepierna, del medio (x = 0) al doblez del costado; abajo, cada pierna,
// del doblez de la entrepierna al del costado. Entre las capas, un volumen
// (el radio de los dobleces) que crece suave de la cadera a las piernas: la
// pierna da más vuelta que la mitad de la cadera, y parte de esa tela va al
// volumen y parte al ancho (el costado se abre apenas). La cintura, juntada
// por el elástico, va derecha entre los broches y se abre a la cadera en
// EASE. Después la simulación (como la de la camiseta: largos, diagonales y
// flexión, y las capas que no se acercan) lo deja asentarse con su peso.
//
// Se arma la pierna izquierda (x > 0): la derecha es su espejo. Arriba de la
// entrepierna sus bordes (las costuras del medio) van en x = 0.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => t * t * (3 - 2 * t);

const ROW_STEP = 2; // filas de la grilla fina por fila simulada
const COL_STEP = 4; // y columnas
const ELASTIC = 0.88; // cuánto junta el elástico la cintura
const EASE = 0.13; // debajo de la cintura, en esto la tela se abre a su ancho (más corto parecían hombros)
const RHO = 0.006; // medio volumen de la cadera (radio de los dobleces)
const RHO_LEG = 0.012; // y de las piernas
const HEM_GAP = 0.006; // en el ruedo, entre cada pierna y el medio
const HEM_OUT = 0.025; // cuánto se abre el costado de la cadera al ruedo
const CLIP_IN = 0.02; // los broches, a esto del doblez del costado
const STEPS = 30;
const SUBSTEPS = 2;
const ITERATIONS = 8;
const DAMP = 0.96;
const SLACK = 1.01; // lo que se estira la tela con su peso
const BEND = 0.5;

// Un camino de tramos rectos y arcos: el punto a la distancia u del
// comienzo.
function pathPoint(segs, u) {
  for (const s of segs) {
    if (u <= s.len || s === segs[segs.length - 1]) {
      const t = s.len ? Math.min(1, u / s.len) : 0;
      if (s.line) return [lerp(s.a[0], s.b[0], t), lerp(s.a[1], s.b[1], t)];
      const ang = lerp(s.from, s.to, t);
      return [s.c[0] + s.r * Math.cos(ang), s.c[1] + s.r * Math.sin(ang)];
    }
    u -= s.len;
  }
  return [0, 0];
}
const line = (a, b) => ({ line: true, a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
const arc = (c, r, from, to) => ({ c, r, from, to, len: Math.abs(to - from) * r });

// `piece`: la grilla fina de la pierna izquierda puesta (H filas de W
// columnas, de abajo arriba; columna 0 la costura de adelante, W - 1 la de
// atrás, la del medio el costado), `waistRows` las filas de la cintura,
// `flareFrom` la altura (puesta) donde el costado empieza a abrirse y `hung`
// ({ top, z }) dónde va el borde de arriba y el plano del medio. Devuelve la
// grilla fina colgada y dónde van los broches.
export function hangShortLeg(piece, W, H, waistRows, flareFrom, hung) {
  const C = (W - 1) / COL_STEP;
  const R = (H - 1) / ROW_STEP;
  const c0 = C / 2;
  const fine = (i, j) => (i * ROW_STEP * W + j * COL_STEP) * 3;
  const pieceY = (i) => piece[fine(i, c0) + 1];
  const yTop = pieceY(R);
  const isClosed = Array.from({ length: R + 1 }, (_, i) => {
    const a = fine(i, 0);
    const b = fine(i, C);
    return Math.hypot(piece[a] - piece[b], piece[a + 2] - piece[b + 2]) < 1e-5;
  });
  // Partículas (en una fila cerrada, la primera y la última columna son la
  // misma).
  const id = new Int32Array((R + 1) * (C + 1));
  let n = 0;
  for (let i = 0; i <= R; i++)
    for (let j = 0; j <= C; j++) id[i * (C + 1) + j] = isClosed[i] && j === C ? id[i * (C + 1)] : n++;
  const at = (i, j) => id[i * (C + 1) + j];
  const dist3 = (a, b) => Math.hypot(piece[a] - piece[b], piece[a + 1] - piece[b + 1], piece[a + 2] - piece[b + 2]);
  // Las filas acostadas quedan a la altura que tienen puestas: junto a la
  // costura del medio la tela recorre la curva del tiro (hacia atrás) y
  // colgada con ese largo quedaba 7 cm más abajo que el costado (el ruedo
  // en V). Esa tela es la extensión del tiro, que en el short plano va a lo
  // ancho.
  const rise = (i) => Math.abs(pieceY(i + 1) - pieceY(i));
  // A lo ancho, el largo de la tela, juntado por el elástico en la cintura
  // (y abriéndose en EASE debajo).
  const iBand = R - Math.ceil(waistRows / ROW_STEP);
  const widthK = (i) => (i >= iBand ? ELASTIC : lerp(ELASTIC, 1, smooth(clamp01((pieceY(iBand) - pieceY(i)) / EASE))));
  const hlen = (i, j) => dist3(fine(i, j), fine(i, j + 1)) * widthK(i);

  // Cada fila, acostada.
  const P = new Float64Array(n * 3);
  const rows = [];
  for (let i = 0; i <= R; i++) {
    const cum = [0];
    for (let j = 0; j < C; j++) cum.push(cum[j] + hlen(i, j));
    rows.push({ cum, T: cum[C] });
  }
  let iCrotch = R;
  while (iCrotch > 0 && !isClosed[iCrotch]) iCrotch--;
  const yCrotch = pieceY(iCrotch);
  // El ancho (X: del medio al costado) y el volumen (el radio de los
  // dobleces, t): hasta la cadera, de la tela juntada por el elástico que se
  // abre; de ahí el costado baja en línea recta abriéndose HEM_OUT hasta el
  // ruedo y el volumen crece de a poco hasta la entrepierna. Arriba de la
  // entrepierna (abierta) se dobla en el costado; cada pierna (cerrada), en
  // el costado y en la entrepierna, con el mismo volumen, y las filas de
  // arriba van de una forma a la otra (`c`): las piernas se separan de a
  // poco. Colgada, la tela toma el largo de esta forma: justo arriba de la
  // entrepierna aparece la tela de adentro de la pierna (en los 3,5 cm de la
  // curva del tiro la vuelta crece 10 cm) y siguiéndola el ancho o el volumen
  // saltaban ahí (el short se veía partido; en las piernas la diferencia es
  // de un 4 %).
  const iFrom = rows.findIndex((_, i) => pieceY(i) >= flareFrom + 0.03);
  const yFrom = pieceY(iFrom);
  const xHip = (rows[iFrom].T - (Math.PI - 2) * RHO) / 2;
  let xBand = 0;  const openPath = (X, r) => ({
    front: [line([0, r], [X - r, r]), arc([X - r, 0], r, Math.PI / 2, 0)],
    back: [arc([X - r, 0], r, 0, -Math.PI / 2), line([X - r, -r], [0, -r])],
  });
  const closedPath = (X, r, x0) => ({
    front: [arc([x0 + r, 0], r, Math.PI, Math.PI / 2), line([x0 + r, r], [X - r, r]), arc([X - r, 0], r, Math.PI / 2, 0)],
    back: [arc([X - r, 0], r, 0, -Math.PI / 2), line([X - r, -r], [x0 + r, -r]), arc([x0 + r, 0], r, -Math.PI / 2, -Math.PI)],
  });
  const place = (path, cum, j) => {
    const lf = path.front.reduce((s, g) => s + g.len, 0);
    const lb = path.back.reduce((s, g) => s + g.len, 0);
    return j <= c0 ? pathPoint(path.front, (cum[j] / cum[c0]) * lf) : pathPoint(path.back, ((cum[j] - cum[c0]) / (cum[C] - cum[c0])) * lb);
  };
  for (let i = 0; i <= R; i++) {
    const { cum } = rows[i];
    const y = pieceY(i);
    const below = clamp01((yFrom - y) / (yFrom - pieceY(0)));
    const X = i >= iFrom ? (rows[i].T - (Math.PI - 2) * RHO) / 2 : xHip + HEM_OUT * below;
    const t = lerp(RHO, RHO_LEG, smooth(clamp01((yFrom - y) / (yFrom - yCrotch))));
    const c = isClosed[i] ? 1 : smooth(clamp01((flareFrom - y) / (flareFrom - yCrotch)));
    const open = c < 1 && openPath(X, t);
    // (Abajo las piernas se separan apenas, como puestas.)
    const closed = c > 0 && closedPath(X, t, HEM_GAP * clamp01((yCrotch - y) / (yCrotch - pieceY(0))) ** 1.2);
    if (i === R) xBand = X;
    for (let j = 0; j <= C; j++) {
      const k = at(i, j) * 3;
      const a = open && place(open, cum, j);
      const b = closed && place(closed, cum, j);
      const [x, z] = !b ? a : !a ? b : [lerp(a[0], b[0], c), lerp(a[1], b[1], c)];
      P[k] = Math.max(0, x);
      P[k + 1] = hung.top + (y - yTop);
      P[k + 2] = hung.z + z;
    }
  }
  const P0 = Float64Array.from(P);
  const chord = (a, b) => Math.hypot(P0[a * 3] - P0[b * 3], P0[a * 3 + 1] - P0[b * 3 + 1], P0[a * 3 + 2] - P0[b * 3 + 2]);

  // Uniones [a, b, largo, rigidez]: a lo ancho y a lo largo, las diagonales
  // de cada celda y la flexión (saltando un punto), con el largo de la forma
  // acostada (medidas a lo largo con lo que sube cada fila, las columnas no
  // se dejaban abrir y la tela de más se ondulaba).
  const links = [];
  const link = (a, b, k) => a !== b && links.push(a, b, chord(a, b), k);
  for (let i = 0; i <= R; i++)
    for (let j = 0; j <= C; j++) {
      if (j < C) link(at(i, j), at(i, j + 1), 1);
      if (i < R) link(at(i, j), at(i + 1, j), 1);
      if (i < R && j < C) {
        link(at(i, j), at(i + 1, j + 1), 1);
        link(at(i, j + 1), at(i + 1, j), 1);
      }
      if (j + 2 <= C) link(at(i, j), at(i, j + 2), BEND);
      if (i + 2 <= R) link(at(i, j), at(i + 2, j), BEND);
    }
  const L = Float64Array.from(links);
  // Volumen: cada punto del frente y el de la espalda que tiene enfrente no
  // se acercan más que en la forma acostada.
  const vol = [];
  for (let i = 0; i <= R; i++)
    for (let j = 1; j < c0; j++) vol.push(at(i, j), at(i, C - j), 0.95 * chord(at(i, j), at(i, C - j)));
  const V = Float64Array.from(vol);
  // La cintura queda fija (los broches y el elástico); arriba de la
  // entrepierna las costuras del medio van en x = 0.
  const pinned = new Uint8Array(n);
  const onMid = new Uint8Array(n);
  for (let i = 0; i <= R; i++)
    for (let j = 0; j <= C; j++) {
      if (i >= iBand) pinned[at(i, j)] = 1;
      if (!isClosed[i] && (j === 0 || j === C)) onMid[at(i, j)] = 1;
    }
  // Lo más abajo que llega cada punto: la cintura menos lo que sube la tela
  // desde su fila.
  const drop = new Float64Array(n);
  for (let i = 0; i <= R; i++) {
    let up = 0;
    for (let k = i; k < R; k++) up += rise(k);
    for (let j = 0; j <= C; j++) drop[at(i, j)] = hung.top - up * SLACK;
  }

  const Q = Float64Array.from(P);
  const h = 1 / 60 / SUBSTEPS;
  const g = -9.8 * h * h;
  const nl = L.length / 4;
  const nv = V.length / 3;
  for (let step = 0; step < STEPS; step++)
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const k = i * 3;
        const vx = (P[k] - Q[k]) * DAMP;
        const vy = (P[k + 1] - Q[k + 1]) * DAMP;
        const vz = (P[k + 2] - Q[k + 2]) * DAMP;
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
        P[k] += vx;
        P[k + 1] += vy + g;
        P[k + 2] += vz;
      }
      for (let it = 0; it < ITERATIONS; it++) {
        for (let l = 0; l < nl; l++) {
          const a = L[l * 4];
          const b = L[l * 4 + 1];
          const wa = pinned[a] ? 0 : 1;
          const wb = pinned[b] ? 0 : 1;
          if (!wa && !wb) continue;
          const ka = a * 3;
          const kb = b * 3;
          const dx = P[kb] - P[ka];
          const dy = P[kb + 1] - P[ka + 1];
          const dz = P[kb + 2] - P[ka + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const corr = (L[l * 4 + 3] * (d - L[l * 4 + 2])) / d / (wa + wb);
          P[ka] += dx * corr * wa;
          P[ka + 1] += dy * corr * wa;
          P[ka + 2] += dz * corr * wa;
          P[kb] -= dx * corr * wb;
          P[kb + 1] -= dy * corr * wb;
          P[kb + 2] -= dz * corr * wb;
        }
        for (let v = 0; v < nv; v++) {
          const a = V[v * 3] * 3;
          const b = V[v * 3 + 1] * 3;
          const gap = V[v * 3 + 2];
          const dx = P[a] - P[b];
          const dy = P[a + 1] - P[b + 1];
          const dz = P[a + 2] - P[b + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= gap && dz > 0) continue;
          // (Si se cruzaron, el frente vuelve adelante.)
          const ok = d > 1e-6 && dz > 0;
          const push = (gap - (ok ? d : -d)) / 2;
          const nx = ok ? dx / d : 0;
          const ny = ok ? dy / d : 0;
          const nz = ok ? dz / d : 1;
          P[a] += nx * push;
          P[a + 1] += ny * push;
          P[a + 2] += nz * push;
          P[b] -= nx * push;
          P[b + 1] -= ny * push;
          P[b + 2] -= nz * push;
        }
        for (let i = 0; i < n; i++) {
          if (pinned[i]) continue;
          if (onMid[i]) P[i * 3] = 0;
          else if (P[i * 3] < 0) P[i * 3] = 0;
          if (P[i * 3 + 1] < drop[i]) P[i * 3 + 1] = drop[i];
        }
      }
    }

  // De vuelta a la grilla fina: Catmull-Rom a lo ancho (en una fila cerrada,
  // la vuelta sigue) y a lo largo.
  const cr = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const rowsFine = [];
  for (let i = 0; i <= R; i++) {
    const row = new Float64Array(W * 3);
    const col = (j) => at(i, isClosed[i] ? ((j % C) + C) % C : Math.max(0, Math.min(C, j))) * 3;
    for (let f = 0; f < W; f++) {
      const j = Math.floor(f / COL_STEP);
      const t = (f - j * COL_STEP) / COL_STEP;
      for (let c = 0; c < 3; c++) row[f * 3 + c] = t ? cr(P[col(j - 1) + c], P[col(j) + c], P[col(j + 1) + c], P[col(j + 2) + c], t) : P[col(j) + c];
    }
    rowsFine.push(row);
  }
  const out = new Float32Array(W * H * 3);
  for (let r = 0; r < H; r++) {
    const i = Math.floor(r / ROW_STEP);
    const t = (r - i * ROW_STEP) / ROW_STEP;
    const row = (k) => rowsFine[Math.max(0, Math.min(R, k))];
    for (let f = 0; f < W * 3; f++) out[r * W * 3 + f] = t ? cr(row(i - 1)[f], row(i)[f], row(i + 1)[f], row(i + 2)[f], t) : row(i)[f];
  }
  // Los broches pellizcan la cintura cerca del doblez de cada costado.
  const cx = xBand - CLIP_IN;
  return { pos: out, clips: [-1, 1].map((sd) => ({ x: sd * cx, y: hung.top, z: hung.z, width: 0.03, depth: 0.012 })) };
}
