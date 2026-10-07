// Simulación de caída de la tela (dinámica basada en posiciones).
// Las piezas toman como largo de reposo las distancias reales del molde, se
// cosen entre sí, cuelgan de la percha y se dejan asentar con gravedad. El
// resultado reemplaza a la forma inicial calculada, que sólo sirve de punto
// de partida.

import * as THREE from 'three';

const GRAVITY = -9.81;
const FRAME_DT = 1 / 60;
const SUBSTEPS = 8;
const BEND_COMPLIANCE = 1e-5;
const MAX_STEP = 0.004; // desplazamiento máximo por subpaso (m)

export class Drape {
  /**
   * @param {object} opts
   * @param {{key:string, geo:THREE.BufferGeometry, rest2D:Float32Array}[]} opts.pieces
   * @param {(pos:Float32Array, orig:Float32Array, piece:object, local:number)=>boolean} opts.isPinned
   * @param {THREE.Vector3[]} opts.hanger  puntos de la barra de la percha
   * @param {{h:number, t:number}[]} opts.hangerSizes  semialto y semiespesor de la barra en cada punto
   * @param {number} opts.hangerMargin  separación de la tela a la barra
   * @param {(i:number, p:Float32Array)=>void} [opts.collide]  colisión extra por partícula
   */
  constructor(opts) {
    this.pieces = opts.pieces;
    let n = 0;
    for (const pc of this.pieces) {
      pc.offset = n;
      pc.count = pc.geo.attributes.position.count;
      n += pc.count;
    }
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.orig = new Float32Array(n * 3);
    this.w = new Float32Array(n).fill(1);
    this.owner = new Uint8Array(n);
    this.pieces.forEach((pc, k) => {
      this.pos.set(pc.geo.attributes.position.array, pc.offset * 3);
      for (let i = 0; i < pc.count; i++) this.owner[pc.offset + i] = k;
    });
    // Percha: tramos de la barra con su sección, y franja de alturas donde
    // puede haber contacto (incluye la caída de los hombros).
    this.hanger = opts.hanger;
    this.hangerSizes = opts.hangerSizes;
    this.hangerMargin = opts.hangerMargin;
    this.hangerReach = 0;
    this.hangerTopY = -Infinity;
    this.hangerLowY = Infinity;
    this.hanger.forEach((p, k) => {
      this.hangerTopY = Math.max(this.hangerTopY, p.y);
      this.hangerLowY = Math.min(this.hangerLowY, p.y);
      this.hangerReach = Math.max(this.hangerReach, this.hangerSizes[k].h, this.hangerSizes[k].t);
    });
    this.hangerTopY += this.hangerReach + this.hangerMargin;
    this.hangerLowY -= this.hangerReach + this.hangerMargin;
    // La forma inicial arranca afuera de la percha (también lo que queda
    // fijo): si no, la barra asomaría entre la tela.
    for (let i = 0; i < n; i++) this.pushOutOfHanger(i * 3);
    for (const pc of this.pieces) pc.geo.attributes.position.array.set(this.pos.subarray(pc.offset * 3, (pc.offset + pc.count) * 3));
    this.orig.set(this.pos);
    this.prev.set(this.pos);

    // Restricciones de distancia (estiramiento) y de flexión.
    const sI = [];
    const sJ = [];
    const sR = [];
    const sA = [];
    const bI = [];
    const bJ = [];
    const bR = [];
    const bA = [];
    for (const pc of this.pieces) {
      const idx = pc.geo.index.array;
      const o = pc.offset;
      const r2 = pc.rest2D;
      const r3 = pc.geo.attributes.position.array;
      // Largo de reposo: el del molde (2D) o, sin molde, el de la forma inicial.
      const d3 = (a, b) => Math.hypot(r3[a * 3] - r3[b * 3], r3[a * 3 + 1] - r3[b * 3 + 1], r3[a * 3 + 2] - r3[b * 3 + 2]);
      const d2 = r2 ? (a, b) => Math.hypot(r2[a * 2] - r2[b * 2], r2[a * 2 + 1] - r2[b * 2 + 1]) : d3;
      // La flexión puede tomar como reposo la forma 3D inicial (conserva curvatura).
      const dbBase = pc.bendRest3D ? d3 : d2;
      // Escala opcional del largo de reposo por arista (quita tela sobrante).
      const sc = pc.restScale || (() => 1);
      // Donde la tela envuelve algo (la percha), el reposo no es menor que la
      // forma inicial: si no, la tela tiraría contra lo que envuelve.
      const keep = pc.keepInitialLength || (() => false);
      const dStretch = (a, b) => (keep(a, b) ? Math.max(d2(a, b) * sc(a, b), d3(a, b)) : d2(a, b) * sc(a, b));
      const db = (a, b) => dbBase(a, b) * sc(a, b);
      // Las aristas en diagonal del molde (al bies) ceden: el punto se deforma
      // en rombos con facilidad y así la tela no se angosta cuando su propio
      // peso la estira.
      const shearOf = (a, b) => {
        if (!pc.shearCompliance || !r2) return 0;
        const ax = Math.abs(r2[a * 2] - r2[b * 2]);
        const ay = Math.abs(r2[a * 2 + 1] - r2[b * 2 + 1]);
        const ang = Math.atan2(ay, ax);
        return ang > 0.35 && ang < 1.22 ? pc.shearCompliance : 0;
      };
      const edges = new Map();
      for (let t = 0; t < idx.length; t += 3) {
        const tri = [idx[t], idx[t + 1], idx[t + 2]];
        for (let e = 0; e < 3; e++) {
          const a = tri[e];
          const b = tri[(e + 1) % 3];
          const c = tri[(e + 2) % 3];
          const key = a < b ? a * pc.count + b : b * pc.count + a;
          const rec = edges.get(key);
          if (rec) rec.push(c);
          else edges.set(key, [Math.min(a, b), Math.max(a, b), c]);
        }
      }
      pc.boundary = new Set();
      pc.boundaryEdges = [];
      // Las aristas casi nulas (astillas del recorte del molde) vuelven
      // inestable la simulación: se omiten.
      const MIN_REST = 0.0015;
      for (const rec of edges.values()) {
        const [a, b] = rec;
        if (d2(a, b) >= MIN_REST) {
          sI.push(o + a);
          sJ.push(o + b);
          sR.push(dStretch(a, b));
          sA.push(shearOf(a, b));
        }
        if (rec.length === 4 && db(rec[2], rec[3]) >= MIN_REST) {
          bI.push(o + rec[2]);
          bJ.push(o + rec[3]);
          bR.push(db(rec[2], rec[3]));
          bA.push(pc.bendComplianceAt?.(rec[2], rec[3]) ?? pc.bendCompliance ?? BEND_COMPLIANCE);
        } else if (rec.length === 3) {
          pc.boundary.add(a);
          pc.boundary.add(b);
          pc.boundaryEdges.push([a, b]);
        }
      }
    }
    this.sI = Int32Array.from(sI);
    this.sJ = Int32Array.from(sJ);
    this.sR = Float32Array.from(sR);
    this.sA = Float32Array.from(sA);
    this.bI = Int32Array.from(bI);
    this.bJ = Int32Array.from(bJ);
    this.bR = Float32Array.from(bR);
    this.bA = Float32Array.from(bA);

    // Fijaciones sobre la percha.
    for (const pc of this.pieces) {
      for (let i = 0; i < pc.count; i++) if (opts.isPinned(this.orig, pc, i)) this.w[pc.offset + i] = 0;
    }
    this.stitches = [];
    // Costuras sobre el borde de la otra pieza: [i, j0, j1, t] une la
    // partícula i al punto (1 − t)·j0 + t·j1 del borde.
    this.edgeStitches = [];
    this.normalPairs = []; // partículas soldadas que comparten normal
    // Guardas de costura: [partícula, punto de la costura, vecino hacia el
    // interior de la otra pieza, puntos anterior y siguiente de la costura].
    this.seamGuards = new Int32Array(0);
    this.seamMargin = 0.002;
    this.collide = opts.collide;
    this.halfZ = new Float32Array(n); // >0: z >= v ; <0: z <= v ; 0: libre
    // Memoria de forma por pieza: atrae suavemente cada partícula a su
    // posición inicial (da cuerpo a piezas que si no colapsarían).
    this.memory = new Float32Array(n);
    for (const pc of this.pieces) if (pc.shapeMemory) this.memory.fill(pc.shapeMemory, pc.offset, pc.offset + pc.count);
    this.frame = 0;
    this.lI = new Int32Array(0);
    this.lJ = new Int32Array(0);
    this.lR = new Float32Array(0);
  }

  // Hilos largos: largo máximo entre dos partículas de una misma columna de
  // la trama (sólo impiden estirar, no plegar). Corrigen de una vez el
  // estiramiento que la tela acumula por su peso a lo largo de muchas filas.
  setThreads(list) {
    this.lI = Int32Array.from(list.map((t) => t[0]));
    this.lJ = Int32Array.from(list.map((t) => t[1]));
    this.lR = Float32Array.from(list.map((t) => t[2]));
  }

  // Une la partícula i (global) a j: en el mismo punto o manteniendo su
  // separación inicial.
  stitch(i, j, keepOffset = true) {
    const o = this.orig;
    if (!keepOffset) this.stitches.push([i, j, 0, 0, 0]);
    else this.stitches.push([i, j, o[i * 3] - o[j * 3], o[i * 3 + 1] - o[j * 3 + 1], o[i * 3 + 2] - o[j * 3 + 2]]);
  }

  // Cose los bordes libres de dos piezas que se tocan (a menos de maxDist).
  // keepOffset: true = separación fija, false = mismo punto.
  sewBoundaries(pa, pbs, maxDist, filter = () => true, keepOffset = true, targetFilter = filter) {
    const o = this.orig;
    const bList = pbs.flatMap((pb) => [...pb.boundary].map((i) => pb.offset + i)).filter(targetFilter);
    for (const la of pa.boundary) {
      const i = pa.offset + la;
      if (!filter(i)) continue;
      let best = -1;
      let bd = maxDist * maxDist;
      for (const j of bList) {
        const dx = o[i * 3] - o[j * 3];
        const dy = o[i * 3 + 1] - o[j * 3 + 1];
        const dz = o[i * 3 + 2] - o[j * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best >= 0) this.stitch(i, best, keepOffset);
    }
  }

  // Cose el borde de pa al de pb punto a punto: cada partícula del borde de
  // pa queda sobre el punto más cercano del borde de pb (entre dos de sus
  // partículas), sin que las partículas de las dos piezas tengan que
  // coincidir. Así la costura es una línea continua, sin dientes.
  sewEdges(pa, pb, maxDist, filter = () => true) {
    const o = this.orig;
    const edges = pb.boundaryEdges
      .map(([a, b]) => [pb.offset + a, pb.offset + b])
      .filter(([a, b]) => filter(a) && filter(b));
    for (const la of pa.boundary) {
      const i = pa.offset + la;
      if (!filter(i)) continue;
      let best = null;
      let bd = maxDist * maxDist;
      for (const [a, b] of edges) {
        const ex = o[b * 3] - o[a * 3];
        const ey = o[b * 3 + 1] - o[a * 3 + 1];
        const ez = o[b * 3 + 2] - o[a * 3 + 2];
        const L2 = ex * ex + ey * ey + ez * ez || 1e-12;
        const t = Math.max(0, Math.min(1, ((o[i * 3] - o[a * 3]) * ex + (o[i * 3 + 1] - o[a * 3 + 1]) * ey + (o[i * 3 + 2] - o[a * 3 + 2]) * ez) / L2));
        const dx = o[i * 3] - o[a * 3] - ex * t;
        const dy = o[i * 3 + 1] - o[a * 3 + 1] - ey * t;
        const dz = o[i * 3 + 2] - o[a * 3 + 2] - ez * t;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = [i, a, b, t];
        }
      }
      if (best) this.edgeStitches.push(best);
    }
  }

  // Ataduras de largo máximo a la fijación más cercana (evitan que la tela se
  // estire por su peso). La distancia se mide sobre la tela (camino más corto
  // por la malla y las costuras), no en línea recta: así un costado puede
  // bajar y girar libremente alrededor de la punta de la percha, pero nunca
  // alejarse más de lo que mide la tela.
  buildTethers(slack = 1.02) {
    const n = this.n;
    const { sI, sJ, sR } = this;
    const deg = new Int32Array(n + 1);
    const links = [];
    for (let c = 0; c < sI.length; c++) links.push([sI[c], sJ[c], sR[c]]);
    for (const [i, j, ox, oy, oz] of this.stitches) links.push([i, j, Math.hypot(ox, oy, oz)]);
    const o = this.orig;
    const od = (i, j) => Math.hypot(o[i * 3] - o[j * 3], o[i * 3 + 1] - o[j * 3 + 1], o[i * 3 + 2] - o[j * 3 + 2]);
    for (const [i, a, b] of this.edgeStitches) links.push([i, a, od(i, a)], [i, b, od(i, b)]);
    for (const [i, j] of links) {
      deg[i + 1]++;
      deg[j + 1]++;
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const adj = new Int32Array(deg[n]);
    const len = new Float32Array(deg[n]);
    const fill = deg.slice(0, n);
    for (const [i, j, l] of links) {
      adj[fill[i]] = j;
      len[fill[i]++] = l;
      adj[fill[j]] = i;
      len[fill[j]++] = l;
    }
    const dist = new Float64Array(n).fill(Infinity);
    const src = new Int32Array(n).fill(-1);
    // Montículo binario de (distancia, partícula).
    const hd = [];
    const hi = [];
    const push = (d, i) => {
      let k = hd.length;
      hd.push(d);
      hi.push(i);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hd[p] <= hd[k]) break;
        [hd[p], hd[k]] = [hd[k], hd[p]];
        [hi[p], hi[k]] = [hi[k], hi[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = [hd[0], hi[0]];
      const ld = hd.pop();
      const li = hi.pop();
      if (hd.length) {
        hd[0] = ld;
        hi[0] = li;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < hd.length && hd[l] < hd[m]) m = l;
          if (r < hd.length && hd[r] < hd[m]) m = r;
          if (m === k) break;
          [hd[m], hd[k]] = [hd[k], hd[m]];
          [hi[m], hi[k]] = [hi[k], hi[m]];
          k = m;
        }
      }
      return top;
    };
    for (let i = 0; i < n; i++) {
      if (this.w[i] !== 0) continue;
      dist[i] = 0;
      src[i] = i;
      push(0, i);
    }
    while (hd.length) {
      const [d, i] = pop();
      if (d > dist[i]) continue;
      for (let e = deg[i]; e < deg[i + 1]; e++) {
        const j = adj[e];
        const nd = d + len[e];
        if (nd < dist[j]) {
          dist[j] = nd;
          src[j] = src[i];
          push(nd, j);
        }
      }
    }
    const tI = [];
    const tP = [];
    const tR = [];
    for (let i = 0; i < n; i++) {
      if (this.w[i] === 0 || src[i] < 0) continue;
      tI.push(i);
      tP.push(src[i]);
      tR.push(dist[i] * slack);
    }
    this.tI = Int32Array.from(tI);
    this.tP = Int32Array.from(tP);
    this.tR = Float32Array.from(tR);
  }

  step(frames) {
    const { pos, prev, w, sI, sJ, sR, sA, lI, lJ, lR, bI, bJ, bR, bA, halfZ, n } = this;
    const dt = FRAME_DT / SUBSTEPS;
    const g = GRAVITY * dt * dt;
    const invDt2 = 1 / (dt * dt);
    // La forma inicial no respeta exactamente los largos del molde: los primeros
    // cuadros relajan sin acumular velocidad para que no "explote".
    for (let f = 0; f < frames; f++) {
      const damp = this.frame < 25 ? 0 : 0.985;
      for (let s = 0; s < SUBSTEPS; s++) {
        for (let i = 0; i < n; i++) {
          if (w[i] === 0) continue;
          const k = i * 3;
          let vx = (pos[k] - prev[k]) * damp;
          let vy = (pos[k + 1] - prev[k + 1]) * damp;
          let vz = (pos[k + 2] - prev[k + 2]) * damp;
          const v2 = vx * vx + vy * vy + vz * vz;
          if (v2 > MAX_STEP * MAX_STEP) {
            const m = MAX_STEP / Math.sqrt(v2);
            vx *= m;
            vy *= m;
            vz *= m;
          }
          prev[k] = pos[k];
          prev[k + 1] = pos[k + 1];
          prev[k + 2] = pos[k + 2];
          pos[k] += vx;
          pos[k + 1] += vy + g;
          pos[k + 2] += vz;
        }
        // Estiramiento (rígido, salvo al bies).
        for (let c = 0; c < sI.length; c++) {
          const a = sI[c] * 3;
          const b = sJ[c] * 3;
          const wa = w[sI[c]];
          const wb = w[sJ[c]];
          const ws = wa + wb;
          if (!ws) continue;
          const dx = pos[a] - pos[b];
          const dy = pos[a + 1] - pos[b + 1];
          const dz = pos[a + 2] - pos[b + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const corr = (d - sR[c]) / (d * (ws + sA[c] * invDt2));
          pos[a] -= dx * corr * wa;
          pos[a + 1] -= dy * corr * wa;
          pos[a + 2] -= dz * corr * wa;
          pos[b] += dx * corr * wb;
          pos[b + 1] += dy * corr * wb;
          pos[b + 2] += dz * corr * wb;
        }
        // Hilos largos: sólo actúan si la columna quedó más larga que la tela.
        for (let c = 0; c < lI.length; c++) {
          const ia = lI[c];
          const ib = lJ[c];
          const a = ia * 3;
          const b = ib * 3;
          const dx = pos[b] - pos[a];
          const dy = pos[b + 1] - pos[a + 1];
          const dz = pos[b + 2] - pos[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d <= lR[c]) continue;
          const wa = w[ia];
          const wb = w[ib];
          const ws = wa + wb;
          if (!ws) continue;
          const k = (d - lR[c]) / (d * ws);
          pos[a] += dx * k * wa;
          pos[a + 1] += dy * k * wa;
          pos[a + 2] += dz * k * wa;
          pos[b] -= dx * k * wb;
          pos[b + 1] -= dy * k * wb;
          pos[b + 2] -= dz * k * wb;
        }
        // Flexión (blanda): sólo resiste si la tela se pliega sobre sí misma.
        for (let c = 0; c < bI.length; c++) {
          const a = bI[c] * 3;
          const b = bJ[c] * 3;
          const wa = w[bI[c]];
          const wb = w[bJ[c]];
          const ws = wa + wb;
          if (!ws) continue;
          const dx = pos[a] - pos[b];
          const dy = pos[a + 1] - pos[b + 1];
          const dz = pos[a + 2] - pos[b + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const corr = (d - bR[c]) / (d * (ws + bA[c] * invDt2));
          pos[a] -= dx * corr * wa;
          pos[a + 1] -= dy * corr * wa;
          pos[a + 2] -= dz * corr * wa;
          pos[b] += dx * corr * wb;
          pos[b + 1] += dy * corr * wb;
          pos[b + 2] += dz * corr * wb;
        }
        // Costuras.
        for (const [i, j, ox, oy, oz] of this.stitches) {
          const wa = w[i];
          const wb = w[j];
          const ws = wa + wb;
          if (!ws) continue;
          const a = i * 3;
          const b = j * 3;
          const cx = pos[a] - pos[b] - ox;
          const cy = pos[a + 1] - pos[b + 1] - oy;
          const cz = pos[a + 2] - pos[b + 2] - oz;
          pos[a] -= (cx * wa) / ws;
          pos[a + 1] -= (cy * wa) / ws;
          pos[a + 2] -= (cz * wa) / ws;
          pos[b] += (cx * wb) / ws;
          pos[b + 1] += (cy * wb) / ws;
          pos[b + 2] += (cz * wb) / ws;
        }
        for (const [i, ja, jb, t] of this.edgeStitches) {
          const wi = w[i];
          const wa = w[ja] * (1 - t) * (1 - t);
          const wb = w[jb] * t * t;
          const ws = wi + wa + wb;
          if (!ws) continue;
          const p = i * 3;
          const a = ja * 3;
          const b = jb * 3;
          const cx = (pos[p] - pos[a] * (1 - t) - pos[b] * t) / ws;
          const cy = (pos[p + 1] - pos[a + 1] * (1 - t) - pos[b + 1] * t) / ws;
          const cz = (pos[p + 2] - pos[a + 2] * (1 - t) - pos[b + 2] * t) / ws;
          pos[p] -= cx * wi;
          pos[p + 1] -= cy * wi;
          pos[p + 2] -= cz * wi;
          const fa = w[ja] * (1 - t);
          const fb = w[jb] * t;
          pos[a] += cx * fa;
          pos[a + 1] += cy * fa;
          pos[a + 2] += cz * fa;
          pos[b] += cx * fb;
          pos[b + 1] += cy * fb;
          pos[b + 2] += cz * fb;
        }
        this.guardSeams();
        // Ataduras.
        if (this.tI) {
          const { tI, tP, tR } = this;
          for (let c = 0; c < tI.length; c++) {
            const a = tI[c] * 3;
            const b = tP[c] * 3;
            const dx = pos[a] - pos[b];
            const dy = pos[a + 1] - pos[b + 1];
            const dz = pos[a + 2] - pos[b + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d <= tR[c]) continue;
            const k = (d - tR[c]) / d;
            pos[a] -= dx * k;
            pos[a + 1] -= dy * k;
            pos[a + 2] -= dz * k;
          }
        }
        // Colisiones: percha, separación frente/espalda y extras.
        for (let i = 0; i < n; i++) {
          if (w[i] === 0) continue;
          const k = i * 3;
          this.pushOutOfHanger(k);
          const mem = this.memory[i];
          if (mem) {
            pos[k] += (this.orig[k] - pos[k]) * mem;
            pos[k + 1] += (this.orig[k + 1] - pos[k + 1]) * mem;
            pos[k + 2] += (this.orig[k + 2] - pos[k + 2]) * mem;
          }
          const hz = halfZ[i];
          if (hz > 0 && pos[k + 2] < hz) pos[k + 2] = hz;
          else if (hz < 0 && pos[k + 2] > hz) pos[k + 2] = hz;
          if (this.collide) this.collide(i, pos);
        }
      }
      this.frame++;
    }
  }

  // Una pieza cosida a otra no puede doblarse hacia adentro de ella: cuando
  // una partícula cae sobre la otra pieza (del lado de su tela), se la deja
  // del lado de afuera de su superficie. La corrección se reparte: la pieza
  // que se dobla sale y la otra cede hacia adentro.
  guardSeams() {
    const { pos, w, seamGuards: g, seamMargin: m } = this;
    for (let q = 0; q < g.length; q += 5) {
      const p = g[q] * 3;
      const s = g[q + 1] * 3;
      const inn = g[q + 2] * 3;
      const a = g[q + 3] * 3;
      const b = g[q + 4] * 3;
      // Dirección hacia el interior de la pieza y normal de su superficie.
      let ix = pos[inn] - pos[s];
      let iy = pos[inn + 1] - pos[s + 1];
      let iz = pos[inn + 2] - pos[s + 2];
      const tx = pos[b] - pos[a];
      const ty = pos[b + 1] - pos[a + 1];
      const tz = pos[b + 2] - pos[a + 2];
      let nx = ty * iz - tz * iy;
      let ny = tz * ix - tx * iz;
      let nz = tx * iy - ty * ix;
      const nl = Math.hypot(nx, ny, nz);
      const il = Math.hypot(ix, iy, iz);
      if (nl < 1e-9 || il < 1e-9) continue;
      // Hacia afuera: lejos del eje vertical de la prenda.
      const out = nx * pos[s] + nz * pos[s + 2] < 0 ? -1 / nl : 1 / nl;
      nx *= out;
      ny *= out;
      nz *= out;
      ix /= il;
      iy /= il;
      iz /= il;
      const dx = pos[p] - pos[s];
      const dy = pos[p + 1] - pos[s + 1];
      const dz = pos[p + 2] - pos[s + 2];
      if (dx * ix + dy * iy + dz * iz <= 0) continue;
      const h = dx * nx + dy * ny + dz * nz;
      if (h >= m) continue;
      const wp = w[g[q]];
      const wi = w[g[q + 2]];
      const ws = wp + wi;
      if (!ws) continue;
      const c = (m - h) / ws;
      pos[p] += nx * c * wp;
      pos[p + 1] += ny * c * wp;
      pos[p + 2] += nz * c * wp;
      pos[inn] -= nx * c * wi;
      pos[inn + 1] -= ny * c * wi;
      pos[inn + 2] -= nz * c * wi;
    }
  }

  // Saca de la percha a la partícula de índice k (posición k, k+1, k+2): la
  // barra es un tubo de lados planos y cantos redondos, más el margen.
  pushOutOfHanger(k) {
    const { pos, hanger: hp, hangerSizes: hs, hangerMargin: hm, hangerReach: reach } = this;
    if (pos[k + 1] <= this.hangerLowY || pos[k + 1] >= this.hangerTopY) return;
    for (let h = 0; h + 1 < hp.length; h++) {
      const p0 = hp[h];
      const p1 = hp[h + 1];
      const ex = p1.x - p0.x;
      // Lejos del tramo (a lo largo de x): sin contacto posible.
      if (Math.abs(pos[k] - (p0.x + p1.x) / 2) > Math.abs(ex) / 2 + reach + hm) continue;
      const ey = p1.y - p0.y;
      const ez = p1.z - p0.z;
      const L = Math.sqrt(ex * ex + ey * ey + ez * ez);
      // Coordenadas locales: a lo largo del tramo (s), según la normal de la
      // barra en su plano (a) y según z.
      const rx = pos[k] - p0.x;
      const ry = pos[k + 1] - p0.y;
      const rz = pos[k + 2] - p0.z;
      const s = (rx * ex + ry * ey + rz * ez) / L;
      const sc = Math.max(0, Math.min(L, s));
      const t = sc / L;
      const nx = -ey / L;
      const ny = ex / L;
      const a = rx * nx + ry * ny;
      // Sección: tramo recto de semialto h − t, redondeado con radio t.
      const th = hs[h].t + (hs[h + 1].t - hs[h].t) * t;
      const core = Math.max(0, hs[h].h + (hs[h + 1].h - hs[h].h) * t - th);
      const r = th + hm;
      const ds = s - sc;
      const da = a - Math.max(-core, Math.min(core, a));
      const d2 = ds * ds + da * da + rz * rz;
      if (d2 < r * r && d2 > 1e-12) {
        // Afuera en la dirección más corta (normal a la superficie).
        const m = r / Math.sqrt(d2) - 1;
        pos[k] += ((ds * ex) / L + da * nx) * m;
        pos[k + 1] += ((ds * ey) / L + da * ny) * m;
        pos[k + 2] += ((ds * ez) / L) * m + rz * m;
      }
    }
  }

  // Copia el estado a las geometrías y recalcula normales.
  apply() {
    for (const pc of this.pieces) {
      const attr = pc.geo.attributes.position;
      attr.array.set(this.pos.subarray(pc.offset * 3, (pc.offset + pc.count) * 3));
      attr.needsUpdate = true;
      pc.geo.computeVertexNormals();
      pc.afterApply?.(pc.geo);
      pc.geo.computeBoundingSphere();
    }
    // Costuras sobre el borde: frente y espalda (ambas con la normal hacia
    // afuera) promedian sus normales, así el doblez se ve redondo y cerrado.
    if (this.edgeStitches.length) {
      const acc = new Map();
      const nrmOf = (g) => {
        const pc = this.pieces[this.owner[g]];
        return [pc.geo.attributes.normal, g - pc.offset];
      };
      const add = (g, x, y, z) => {
        let v = acc.get(g);
        if (!v) {
          const [na, ia] = nrmOf(g);
          v = [na.getX(ia), na.getY(ia), na.getZ(ia)];
          acc.set(g, v);
        }
        v[0] += x;
        v[1] += y;
        v[2] += z;
      };
      for (const [i, a, b, t] of this.edgeStitches) {
        const [ni, ii] = nrmOf(i);
        const [nA, iA] = nrmOf(a);
        const [nB, iB] = nrmOf(b);
        add(i, nA.getX(iA) * (1 - t) + nB.getX(iB) * t, nA.getY(iA) * (1 - t) + nB.getY(iB) * t, nA.getZ(iA) * (1 - t) + nB.getZ(iB) * t);
        add(a, ni.getX(ii) * (1 - t), ni.getY(ii) * (1 - t), ni.getZ(ii) * (1 - t));
        add(b, ni.getX(ii) * t, ni.getY(ii) * t, ni.getZ(ii) * t);
      }
      for (const [g, [x, y, z]] of acc) {
        const l = Math.hypot(x, y, z);
        if (l < 1e-6) continue;
        const [na, ia] = nrmOf(g);
        na.setXYZ(ia, x / l, y / l, z / l);
        na.needsUpdate = true;
      }
    }
    // Normales compartidas en las uniones soldadas (sombreado continuo).
    const nrm = (g) => {
      const pc = this.pieces[this.owner[g]];
      return [pc.geo.attributes.normal, g - pc.offset];
    };
    for (const [a, b] of this.normalPairs) {
      const [na, ia] = nrm(a);
      const [nb, ib] = nrm(b);
      // La manga y el cuerpo pueden tener la cara exterior hacia lados
      // opuestos de su normal: se alinean antes de promediar.
      const dot = na.getX(ia) * nb.getX(ib) + na.getY(ia) * nb.getY(ib) + na.getZ(ia) * nb.getZ(ib);
      const sgn = dot < 0 ? -1 : 1;
      let x = na.getX(ia) + sgn * nb.getX(ib);
      let y = na.getY(ia) + sgn * nb.getY(ib);
      let z = na.getZ(ia) + sgn * nb.getZ(ib);
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
      na.setXYZ(ia, x, y, z);
      nb.setXYZ(ib, sgn * x, sgn * y, sgn * z);
      na.needsUpdate = true;
      nb.needsUpdate = true;
    }
  }

}
