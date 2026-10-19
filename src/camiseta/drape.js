// Camiseta colgada: la tela se simula en vivo con dinámica de posiciones
// (partículas unidas por restricciones de largo) sobre una malla a media
// resolución de la misma camiseta. La malla fina que se ve sigue a la gruesa;
// cuello y dobladillos acompañan a su borde.
//
// - Cuelga de una percha de madera (sólido de choque bajo la costura de los
//   hombros) o de dos broches que pellizcan la espalda junto a la costura.
// - La tira del cuello es una cinta con cuerpo propio: se dobla y se gira
//   libre, pero no se estira ni se dobla de canto, así el escote no cae en
//   V ni se arruga. El contorno y el pecho caen libres.
// - Ninguna parte de la tela atraviesa a otra (choque entre puntos y contra
//   el centro de cada celda), y frente, espalda y mangas guardan algo del
//   volumen que tenían puestos.
// - El mouse empuja la tela al pasar y levanta una brisa suave.
// - Cuando la tela se aquieta, queda simétrica y la simulación se duerme (no
//   gasta nada).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { armholeLoopIJ, flattenPanel, bust, mitreV, vRestOffset } from './shirt.js';

const SUBSTEPS = 4;
const ITERATIONS = 5;
const GAP = 0.005; // separación mínima entre capas de tela
const DAMP = 0.991; // amortiguación de la velocidad por subpaso
const DAMP_CALM = 0.96; // la misma, un rato después del último empujón
const CALM_AFTER = 2; // segundos
const SLACK = 1.01; // lo que se puede estirar la tela con su peso
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Fracción de la separación entre frente y espalda (puesta) que conserva la
// tela colgada: algo más arriba, casi nada en el ruedo.
const VOLUME_TOP = 0.3;
// Con broches nada sostiene el cuello atrás (entre los broches) ni el
// hombro de afuera del broche: la tira guarda algo de su forma puesta (si
// no, la espalda del cuello se adelanta y se marca una canaleta en la
// espalda; con 0,3 un punto junto al cuello no termina de quedarse quieto),
// arriba se guarda menos volumen y la copa de la manga cede más.
const CLIPS_BAND = 0.2;
const CLIPS_VOLUME_TOP = 0.1;
const CLIPS_CAP = 0.15;
// En los costados del cuello la tira guarda mucho más su forma puesta: ahí,
// colgada, dobla del frente a la espalda en una curva cerrada; acostada
// hacia adentro se comprimía en su plano y levantaba una aleta (el cuello
// parecía quebrado a cada lado). Parada, como puesta, dobla limpio.
const CLIPS_BAND_SIDE = 0.9;
const CLIPS_BAND_SEAM = 0.45;
const HANGER_SINK = 0.008; // (tank top) cuánto baja la madera que se ve bajo las tiras
const HANGER_MARGIN = 0.005; // cuánto más grande que la madera es su sección de choque
const VOLUME_HEM = 0.06;
const RACER_PAIR = 0.03; // (tank top) a más de esto, de costado, no se miran
const VOLUME_SLEEVE = 0.5;
// Broches: filas de la costura del hombro donde pellizcan (desde la punta
// del hombro hacia el cuello) y media separación entre las mordazas.
const CLIP_ROWS = [1, 2];
const PINCH = 0.0035;
const LIP_ROWS = 4; // filas de tela que sigue cada dobladillo (más que su alto)
// En reposo la camiseta cuelga simétrica: mientras se mueve, la tela es
// libre; cuando se aquieta, el lado derecho (visto de frente) se acomoda en
// espejo del izquierdo durante estos cuadros y la simulación se duerme.
const FINISH_FRAMES = 36;
const SETTLE_MAX = 8; // segundos sin empujones tras los que se termina de acomodar sí o sí
// Grosor de la tela para el choque entre puntos: dos puntos que no son
// vecinos en la tela no se acercan más que esto (algo menos que la diagonal
// de una celda de la malla, así ningún punto pasa entre otros cuatro).
const THICK = 0.011;
const GEO_NEAR = 0.045; // por la tela más cerca que esto: no chocan (los sostiene la malla)
// Entre manga y torso alcanza con menos: más allá de esto, aunque estén
// cerca por la tela, chocan (si no, la copa de la manga atraviesa el torso
// junto a la sisa).
const GEO_NEAR_SEAM = 0.012;
const VMAX = 0.004; // velocidad máxima por subpaso (≈ 1 m/s)
// Tira del cuello: fila del perfil de la tira que hace de borde de arriba de
// la cinta (la cara de afuera, justo antes del doblez).
const BAND_ROW = 2;
// Cuerpo de la tira (sólo con broches, CLIPS_BAND): cada tramo de la cinta
// (BAND_SPAN puntos a cada lado) tiende a su forma puesta, girado como haga
// falta. En la percha no: recordaría la vuelta alrededor del cuello y
// colgada armaría un aro que empuja el frente hacia adelante (arrugas en los
// hombros); ahí la cinta sólo no se estira ni se da vuelta sobre la costura.
const BAND_SPAN = 6;
// Entre qué fracciones del medio ancho del cuello crece hacia los costados
// (CLIPS_BAND_SIDE).
const BAND_SIDE = [0.6, 0.9];
// La costura de la tira es más firme que la tela: no la deja darse vuelta.
const SEAM_K = 0.5;
// La tira del cuello se cose estirada y frunce un poco el escote:
// al aplanar el molde para colgarla, el borde del escote apunta a este largo
// respecto del puesto, en el frente y en la espalda (la tela de alrededor no
// lo deja llegar). Es igual para cualquier cuello: sin esto el escote colgado
// se caía (redondo 7,6 cm → 11,3; V 9 → 13,6); con esto, 8,3 y 10. (El tank
// top, con su escote hondo y su vivo, no.)
const NECK_EASE = [0.5, 0.75];
// Columnas desde la costura del hombro en las que ese acortamiento se apaga:
// tiraba de la punta del hombro y el hombro del frente quedaba más largo que
// el de la espalda (al coserlos, los dos se arrugaban).
const NECK_EASE_SIDE = [1, 4];
// La tira es doble y cosida, más firme que la tela: sus uniones se resuelven
// estas veces más en cada iteración (casi no se estira con el peso del pecho).
const BAND_PASSES = 4;
// Aplanado del molde para el largo de reposo colgada (grilla de la
// simulación): [cada cuántos puntos, iteraciones].
const FLAT_REST = [
  [4, 300],
  [2, 150],
  [1, 60],
];

// ---------- percha ----------

// Percha de madera bajo la costura de los hombros: plana y paralela a la
// camiseta, con el arco de una percha de verdad (alta en el centro, baja
// hacia las puntas, siempre por debajo de la costura). La sección es un
// rectángulo de bordes apenas redondeados (más alto que ancho) y las puntas
// son redondas vistas de frente.
export function makeHanger(M) {
  // La percha llega cerca de la punta del hombro: si termina antes, la punta
  // y la manga caen, los costados se cierran y arriba la tela queda sobrando
  // a lo ancho (ondas verticales en la espalda y el frente: con 5 cm, 4 mm;
  // con 1,5 cm, la mitad). Sin mangas, un poco antes (si no, la punta
  // cuelga y se dobla junto a la sisa); con las tiras finas del tank top,
  // casi hasta su borde de afuera (si no, media tira queda en el aire).
  const xEnd = (M.shTip || M.shA) - (M.deepNeck ? 0.008 : M.sleeveless ? 0.022 : 0.015);
  const seamY = (x) => {
    const ax = Math.abs(x);
    return ax <= M.neck.a ? 0 : (M.shY * (ax - M.neck.a)) / (M.shA - M.neck.a);
  };
  const z0 = M.neck.c + 0.003;
  const half = (x) => 0.015 - 0.005 * (Math.abs(x) / xEnd) ** 2; // medio alto de la sección
  const depth = 0.007; // medio espesor
  const round = 0.0025; // radio de los bordes
  // Arco del borde de arriba: y0 en el centro y una caída que lo deja al
  // menos a 6 mm por debajo de la costura en todo el hombro.
  const y0 = -0.003;
  const p = 1.8;
  let drop = 0.03;
  for (let x = M.neck.a - 0.01; x <= xEnd; x += 0.002) drop = Math.max(drop, (y0 - (seamY(x) - 0.006)) / (x / xEnd) ** p);
  const topY = (x) => y0 - drop * (Math.abs(x) / xEnd) ** p;
  const center = (x) => new THREE.Vector3(x, topY(x) - half(x), z0);
  const tangent = (x) => new THREE.Vector3().subVectors(center(x + 1e-4), center(x - 1e-4)).normalize();
  const upOf = (t) => new THREE.Vector3(-t.y, t.x, 0).normalize();

  // Tramos de choque: la sección es algo mayor que la madera (la malla de
  // la tela es más gruesa que la barra).
  const MARGIN = HANGER_MARGIN;
  const segments = [];
  const S = 48;
  for (let i = 0; i < S; i++) {
    const xa = -xEnd + (2 * xEnd * i) / S;
    const xb = -xEnd + (2 * xEnd * (i + 1)) / S;
    const a = center(xa);
    const b = center(xb);
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    segments.push({ a, b, t, up: upOf(t), hu: (half(xa) + half(xb)) / 2 + MARGIN, hz: depth + MARGIN, r: round });
  }

  // Malla: anillos con la sección a lo largo del arco, y en cada punta unos
  // anillos más que se achican en alto (punta redonda vista de frente). La
  // madera que se ve termina (con su punta) en el borde de adentro de la
  // tira: más afuera la tapa la tela del hombro, pero con la tira acostada,
  // como en la V, la madera taparía la tira en las esquinas de los hombros.
  // (Con escote hondo y vivo fino, como el del tank top, la madera se ve
  // entera: cortada ahí quedaba en el aire en medio del escote.)
  const xVis = M.deepNeck ? xEnd - 0.015 : Math.min(xEnd, M.neck.a - 0.032);
  const K = 4; // tramos por borde redondeado
  const R = 4 * (K + 1);
  const pos = [];
  const nor = [];
  const ring = (c, t, h, d, r, analytic) => {
    const up = upOf(t);
    const rr = Math.min(r, h * 0.99, d * 0.99);
    for (let q = 0; q < 4; q++) {
      const su = q === 0 || q === 3 ? 1 : -1;
      const sv = q < 2 ? 1 : -1;
      for (let k = 0; k <= K; k++) {
        const a = ((q + k / K) * Math.PI) / 2;
        const cu = Math.cos(a);
        const cv = Math.sin(a);
        const u = su * (h - rr) + rr * cu;
        const v = sv * (d - rr) + rr * cv;
        pos.push(c.x + up.x * u, c.y + up.y * u, c.z + v);
        if (analytic) nor.push(up.x * cu, up.y * cu, cv);
        else nor.push(0, 0, 0);
      }
    }
  };
  // Bajo las tiras del tank top la madera que se ve baja su borde de arriba:
  // la tela, de malla gruesa, corta camino sobre la barra y la dejaba asomar.
  const sink = (x) => (M.deepNeck ? HANGER_SINK * smoothstep(M.neck.a - 0.012, M.neck.a + 0.004, Math.abs(x)) : 0);
  const visC = (x) => center(x).addScaledVector(upOf(tangent(x)), -sink(x) / 2);
  const visH = (x) => half(x) - sink(x) / 2;
  const N = 60;
  const TIP = 6;
  const tipRings = (x, sign) => {
    const t = tangent(x).multiplyScalar(sign);
    const h = visH(x);
    const list = [];
    for (let k = 1; k <= TIP; k++) {
      const th = ((k / TIP) * Math.PI) / 2;
      list.push([visC(x).addScaledVector(t, h * Math.sin(th)), tangent(x), Math.max(h * Math.cos(th), 0.0004)]);
    }
    return list;
  };
  const rings = [
    ...tipRings(-xVis, -1).reverse(),
    ...Array.from({ length: N + 1 }, (_, i) => {
      const x = -xVis + (2 * xVis * i) / N;
      return [visC(x), tangent(x), visH(x), true];
    }),
    ...tipRings(xVis, 1),
  ];
  for (const [c, t, h, analytic] of rings) ring(c, t, h, depth, round, analytic);
  const idx = [];
  for (let i = 0; i + 1 < rings.length; i++)
    for (let k = 0; k < R; k++) {
      const a = i * R + k;
      const b = i * R + ((k + 1) % R);
      idx.push(a, b, a + R, b, b + R, a + R);
    }
  const bar = new THREE.BufferGeometry();
  bar.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bar.setIndex(idx);
  // Normales: las del cuerpo, exactas (caras planas y bordes redondeados);
  // las de las puntas, calculadas.
  const exact = Float32Array.from(nor);
  bar.computeVertexNormals();
  const na = bar.attributes.normal.array;
  for (let i = 0; i < exact.length; i += 3) if (exact[i] || exact[i + 1] || exact[i + 2]) na.set([exact[i], exact[i + 1], exact[i + 2]], i);

  // Gancho de alambre, desde el centro del borde de arriba.
  const hook = makeHook(topY(0) - 0.004, z0, 0.035);
  // Caja que encierra la sección de choque (para descartar rápido).
  const box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const sg of segments)
    for (const p of [sg.a, sg.b]) {
      const r = Math.max(sg.hu, sg.hz);
      box[0] = Math.min(box[0], p.x - r);
      box[1] = Math.max(box[1], p.x + r);
      box[2] = Math.min(box[2], p.y - r);
      box[3] = Math.max(box[3], p.y + r);
      box[4] = Math.min(box[4], p.z - r);
      box[5] = Math.max(box[5], p.z + r);
    }
  return { kind: 'hanger', wood: bar, metal: hook.stem, hook, segments, box, minY: Math.min(...segments.map((s) => Math.min(s.a.y, s.b.y) - s.hu)) };
}

// Gancho giratorio, como en una vidriera: el alambre sube derecho desde la
// percha (`stem`, gira con ella) hasta un buje, y arriba la curva (`curl`,
// queda quieta) calza en la barra del perchero, de atrás hacia adelante.
// El punto de apoyo (arriba de la barra) queda justo sobre el alambre: así
// cuelga derecho. `rail` dice dónde va el centro de la barra.
export const RAIL_R = 0.0125; // radio de la barra del perchero
const WIRE_R = 0.0026;
function makeHook(y0, z, stemLen) {
  const yJ = y0 + stemLen;
  const rc = RAIL_R + WIRE_R + 0.0006;
  const yb = yJ + 0.02 + rc;
  const stem = new THREE.CylinderGeometry(WIRE_R, WIRE_R, stemLen + 0.004, 10).translate(0, y0 + stemLen / 2, z);
  const collar = new THREE.CylinderGeometry(0.0048, 0.0048, 0.009, 16).translate(0, yJ, z);
  const pts = [
    [z, yJ - 0.002],
    [z, yJ + 0.008],
    [z - 0.5 * rc, yb - 1.25 * rc],
  ].map(([zz, y]) => new THREE.Vector3(0, y, zz));
  for (let a = 215; a >= -30; a -= 15) {
    const t = (a * Math.PI) / 180;
    pts.push(new THREE.Vector3(0, yb + rc * Math.sin(t), z + rc * Math.cos(t)));
  }
  const curl = mergeGeometries([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, WIRE_R, 10, false), new THREE.SphereGeometry(WIRE_R, 10, 8).translate(0, pts.at(-1).y, pts.at(-1).z), collar]);
  return { stem, curl, rail: { y: yb, z } };
}

// Barra de metal con gancho y dos broches que cuelgan de ella. Cada broche:
// dos mordazas que aprietan la tela (una adelante y otra atrás), unidas
// arriba por el resorte, y un alambre hasta la barra.
export function makeClipHanger(clips) {
  const metal = [];
  const plastic = [];
  const top = Math.max(0.035, ...clips.map((c) => c.y + 0.06));
  const z = clips[0].z;
  const xMax = Math.max(...clips.map((c) => Math.abs(c.x))) + 0.035;
  const along = (geo, a, b) => {
    // Cilindro de `a` a `b`.
    const d = new THREE.Vector3().subVectors(b, a);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return geo;
  };
  const rodR = 0.0032;
  metal.push(along(new THREE.CylinderGeometry(rodR, rodR, 2 * xMax, 16, 1, true), new THREE.Vector3(-xMax, top, z), new THREE.Vector3(xMax, top, z)));
  for (const s of [-1, 1]) metal.push(new THREE.SphereGeometry(rodR * 1.35, 16, 10).translate(s * xMax, top, z));
  const hook = makeHook(top, z, 0.025);
  metal.push(hook.stem);
  for (const c of clips) {
    const t = 0.0034; // espesor de cada mordaza
    const jawTop = c.y + 0.014;
    const jawBot = c.y - c.depth - 0.006;
    const h = jawTop - jawBot;
    const tilt = 0.07; // las mordazas se abren un poco hacia el resorte
    for (const s of [-1, 1]) {
      const jaw = new RoundedBoxGeometry(c.width, h, t, 2, 0.0012);
      jaw.translate(0, h / 2, 0);
      jaw.rotateX(s * tilt);
      jaw.translate(c.x, jawBot, c.z + s * (PINCH + 0.0012 + t / 2));
      plastic.push(jaw);
    }
    const spring = c.z;
    const springR = PINCH + 0.0012 + t + Math.sin(tilt) * h - 0.001;
    metal.push(along(new THREE.CylinderGeometry(springR, springR, c.width * 0.42, 20), new THREE.Vector3(c.x - c.width * 0.21, jawTop, spring), new THREE.Vector3(c.x + c.width * 0.21, jawTop, spring)));
    metal.push(along(new THREE.CylinderGeometry(0.0016, 0.0016, top - jawTop - springR, 8), new THREE.Vector3(c.x, jawTop + springR * 0.8, z), new THREE.Vector3(c.x, top - 0.004, z)));
    metal.push(new THREE.TorusGeometry(0.0052, 0.0015, 8, 20).rotateY(Math.PI / 2).translate(c.x, top, z));
  }
  return { kind: 'clips', metal: mergeGeometries(metal), plastic: mergeGeometries(plastic), hook };
}

// Subidas de un borde cerrado (n vectores en `u`, tangentes en `t`),
// promediadas con sus vecinos a lo largo del borde y perpendiculares a la
// tangente otra vez. Cambia `u`.
const SMOOTH_W = [1, 2, 3, 2, 1];
function smoothUps(u, t, n) {
  const src = Float32Array.from(u);
  for (let k = 0; k < n; k++) {
    let x = 0;
    let y = 0;
    let z = 0;
    SMOOTH_W.forEach((w, d) => {
      const j = (k + d - 2 + n) % n;
      x += src[j * 3] * w;
      y += src[j * 3 + 1] * w;
      z += src[j * 3 + 2] * w;
    });
    const dt = x * t[k * 3] + y * t[k * 3 + 1] + z * t[k * 3 + 2];
    x -= dt * t[k * 3];
    y -= dt * t[k * 3 + 1];
    z -= dt * t[k * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    u[k * 3] = x / l;
    u[k * 3 + 1] = y / l;
    u[k * 3 + 2] = z / l;
  }
}

// ---------- simulación ----------

// Distancia a lo largo de la tela desde el punto de apoyo más cercano
// (Dijkstra sobre las uniones de la malla): de qué punto cuelga cada uno y
// cuánto se puede alejar de él.
function geodesic(n, adj, anchors) {
  const geo = new Float64Array(n).fill(Infinity);
  const owner = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  for (const a of anchors) {
    geo[a] = 0;
    owner[a] = a;
    push(0, a);
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d > geo[i]) continue;
    const nb = adj[i];
    for (let e = 0; e < nb.length; e += 2) {
      const j = nb[e];
      const nd = d + nb[e + 1];
      if (nd < geo[j]) {
        geo[j] = nd;
        owner[j] = owner[i];
        push(nd, j);
      }
    }
  }
  return { owner, len: Float32Array.from(geo, (g) => g * SLACK) };
}

// Rotación más cercana a la matriz A (columnas a0, a1, a2), partiendo de la
// rotación q (Müller y otros, 2016). Deja el resultado en q.
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _r = new Float32Array(9);
function extractRotation(a, q, iterations) {
  const r = _r;
  for (let it = 0; it < iterations; it++) {
    const { x, y, z, w } = q;
    r[0] = 1 - 2 * (y * y + z * z);
    r[1] = 2 * (x * y + w * z);
    r[2] = 2 * (x * z - w * y);
    r[3] = 2 * (x * y - w * z);
    r[4] = 1 - 2 * (x * x + z * z);
    r[5] = 2 * (y * z + w * x);
    r[6] = 2 * (x * z + w * y);
    r[7] = 2 * (y * z - w * x);
    r[8] = 1 - 2 * (x * x + y * y);
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let dot = 0;
    for (let c = 0; c < 9; c += 3) {
      ox += r[c + 1] * a[c + 2] - r[c + 2] * a[c + 1];
      oy += r[c + 2] * a[c] - r[c] * a[c + 2];
      oz += r[c] * a[c + 1] - r[c + 1] * a[c];
      dot += r[c] * a[c] + r[c + 1] * a[c + 1] + r[c + 2] * a[c + 2];
    }
    const s = 1 / (Math.abs(dot) + 1e-9);
    const angle = Math.hypot(ox, oy, oz) * s;
    if (angle < 1e-7) break;
    _axis.set(ox, oy, oz).normalize();
    q.premultiply(_dq.setFromAxisAngle(_axis, angle)).normalize();
  }
}

export class HangingShirt {
  // support: la percha de makeHanger, o { kind: 'clips' } para colgarla de
  // dos broches (después de crearla, `clips` dice dónde dibujarlos).
  // opts.weight: peso de la tela (0 liviana · 0,5 estándar · 1 pesada). Una
  // tela más pesada es más gruesa (se dobla en pliegues más amplios y guarda
  // más volumen), el aire la frena menos y el mouse la mueve menos.
  constructor(built, support, opts = {}) {
    const heavy = Math.min(1, Math.max(0, opts.weight ?? 0.5)) - 0.5;
    // Flexión: estirar, comprimir en el torso y en las mangas. En el torso
    // comprimir no es tan blando: si no, la tela se arruga punto a punto
    // (ondas de una celda junto a los hombros y un pliegue a lo largo del
    // centro de la espalda y el frente colgados). En las mangas sí (bajo la
    // axila la tela queda apretada y, más firme, no se terminaba de quedar
    // quieta).
    this.bend = [0.4 + 0.5 * heavy, 0.7 + 0.36 * heavy, 0.25 + 0.36 * heavy];
    this.damp = DAMP + 0.006 * heavy;
    this.dampCalm = DAMP_CALM + 0.01 * heavy;
    this.pushScale = 1 - 0.7 * heavy;
    const clips = support.kind === 'clips';
    const volTop = (clips ? CLIPS_VOLUME_TOP : VOLUME_TOP) + 0.16 * heavy;
    this.bandStiff = clips ? CLIPS_BAND : 0;
    this.capK = clips ? CLIPS_CAP : 0.35;
    this.geos = built.geos;
    this.hanger = support.kind === 'hanger' ? support : null;
    const L = built.layout;
    const C = L.cols / 2; // columnas de la grilla gruesa
    const NC = L.rows / 2;
    const i1 = L.i1 / 2;
    const i2 = L.i2 / 2;
    const A = L.armCols / 2;
    // (El tank top tiene la sisa más ancha en la espalda.)
    const AB = (L.armColsB ?? L.armCols) / 2;
    const AK = { front: A, back: AB };
    const W = L.cols + 1;
    const WC = C + 1;
    // Sin mangas (musculosa) no hay grilla de manga.
    const SW = L.sleeveSW;
    const SWC = L.sleeveless ? 0 : (SW - 1) / 2 + 1;
    const RC = (L.sleeveRows + L.cuffRows) / 2;
    this.dims = { C, NC, WC, SWC, RC };

    const pos = [];
    const add = (p) => {
      pos.push(p[0], p[1], p[2]);
      return pos.length / 3 - 1;
    };
    const fine = (key, v) => {
      const a = this.geos[key].attributes.position.array;
      return [a[v * 3], a[v * 3 + 1], a[v * 3 + 2]];
    };
    // Partículas del torso: la grilla fina tomando una fila y columna de cada
    // dos; las costuras de costado y hombro comparten partícula.
    const map = { front: new Int32Array(WC * (NC + 1)).fill(-1), back: new Int32Array(WC * (NC + 1)).fill(-1) };
    // En V, lo que separa la tela apoyada sobre el pecho de su molde (el de la
    // referencia): ver vRestOffset y, más abajo, el molde de reposo.
    const vLift = built.frontBare ? vRestOffset(built) : null;
    const inHole = (key, i, j) => i > i1 && i < i2 && (j < AK[key] || j > C - AK[key]);
    for (const key of ['front', 'back']) {
      for (let i = 0; i <= NC; i++)
        for (let j = 0; j <= C; j++) {
          if (inHole(key, i, j)) continue;
          let id = -1;
          if (key === 'back' && (j === 0 || j === C)) id = map.front[i * WC + (j === 0 ? C : 0)];
          map[key][i * WC + j] = id >= 0 ? id : add(fine(key, 2 * i * W + 2 * j));
        }
    }
    // Mangas (con el puño): la primera fila es la sisa del torso.
    const sleeveMap = {};
    for (const [key, side] of L.sleeveless ? [] : [['sleeveL', 1], ['sleeveR', -1]]) {
      const m = new Int32Array(SWC * (RC + 1)).fill(-1);
      const loop = armholeLoopIJ(C, A, i1, i2, side);
      const cuff = key === 'sleeveL' ? 'cuffL' : 'cuffR';
      for (let r = 0; r <= RC; r++)
        for (let k = 0; k < SWC; k++) {
          let id;
          if (r === 0) {
            const [pk, i, j] = loop[k % loop.length];
            id = map[pk][i * WC + j];
          } else if (k === SWC - 1) id = m[r * SWC];
          else {
            const R = 2 * r;
            id = add(R <= L.sleeveRows ? fine(key, R * SW + 2 * k) : fine(cuff, (R - L.sleeveRows) * SW + 2 * k));
          }
          m[r * SWC + k] = id;
        }
      sleeveMap[key] = m;
    }
    // Tira del cuello: un punto en su borde de arriba sobre cada punto del
    // escote (el escote es la fila de arriba del torso: frente de costado a
    // costado y espalda de vuelta, una vuelta cerrada).
    const ring = [...Array.from({ length: C + 1 }, (_, j) => map.front[NC * WC + j]), ...Array.from({ length: C - 1 }, (_, j) => map.back[NC * WC + j + 1])];
    const collarPos = this.geos.collar.attributes.position.array;
    const CSW = L.rings.collar.length + 1;
    const bandRest = ring.map((_, k) => Array.from(collarPos.subarray((BAND_ROW * CSW + 2 * k) * 3, (BAND_ROW * CSW + 2 * k) * 3 + 3)));
    const band = bandRest.map((p) => add(p));
    this.ring = Int32Array.from(ring);
    this.band = Int32Array.from(band);
    this.map = map;
    this.sleeveMap = sleeveMap;
    const n = pos.length / 3;
    this.n = n;
    this.p = Float32Array.from(pos);
    this.q = Float32Array.from(pos);
    this.w = new Float32Array(n).fill(1); // 0 = adherida a la percha o al broche
    // Espejo: columna j del torso con C - j, y cada punto de una manga con el
    // mismo de la otra. Manda el lado izquierdo visto de frente (x < 0). La
    // forma de partida se hace simétrica antes de armar las restricciones
    // (el molde tiene pliegues que no son iguales de los dos lados): así la
    // camiseta simétrica es también la que está en equilibrio.
    const mirror = new Int32Array(n).fill(-1);
    const P = this.p;
    for (const key of ['front', 'back'])
      for (let i = 0; i <= NC; i++)
        for (let j = 0; j <= C; j++) {
          const a = map[key][i * WC + j];
          const m = map[key][i * WC + C - j];
          if (a >= 0 && m >= 0) mirror[a] = m;
        }
    for (let k = 0; k < (sleeveMap.sleeveL?.length || 0); k++) {
      const a = sleeveMap.sleeveL[k];
      const m = sleeveMap.sleeveR[k];
      if (mirror[a] < 0 && mirror[m] < 0) {
        mirror[a] = m;
        mirror[m] = a;
      }
    }
    const ringIndex = new Map(ring.map((id, k) => [id, k]));
    band.forEach((id, k) => (mirror[id] = band[ringIndex.get(mirror[ring[k]])]));
    // Lado de cada punto (los de la tira, el de su punto del escote: en V
    // varios quedan justo en el medio, en la costura de la punta).
    const sideX = Float32Array.from({ length: n }, (_, i) => P[i * 3]);
    band.forEach((id, k) => (sideX[id] = P[ring[k] * 3]));
    const mpairs = [];
    const mid = [];
    for (let i = 0; i < n; i++) {
      if (mirror[i] === i) mid.push(i);
      else if (mirror[i] >= 0 && sideX[i] < 0) mpairs.push(i, mirror[i]);
    }
    this.mirrorOf = mirror;
    // En V, cada lado de la cinta del frente llega hasta el medio (costura en
    // inglete de la punta) y no pasa al otro: colgada, la V se cierra un poco
    // y los puntos junto a la punta se cruzarían.
    const sides = [];
    if (built.measures.vNeck) band.forEach((id, k) => P[ring[k] * 3 + 2] > 0 && P[ring[k] * 3] && sides.push(id, Math.sign(P[ring[k] * 3])));
    this.bandSides = Int32Array.from(sides);
    this.mirrorPairs = Int32Array.from(mpairs);
    this.midline = Int32Array.from(mid);
    this.lastPoke = -Infinity;
    this.symmetrize(1);

    // Restricciones de largo: lados y diagonales de cada celda, y "flexión"
    // (saltando un punto) con menos rigidez.
    const pairs = new Map();
    const dist = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const link = (a, b, kind, force = false) => {
      if (a < 0 || b < 0 || a === b) return;
      const key = a < b ? a * n + b : b * n + a;
      if (!pairs.has(key)) pairs.set(key, [a, b, dist(a, b), kind]);
      else if (force) pairs.get(key)[3] = kind;
    };
    const grid = (m, w, h, cellOk, bendKind = 2) => {
      for (let i = 0; i <= h; i++)
        for (let j = 0; j < w; j++) {
          const a = m[i * w + j];
          if (j + 1 < w) link(a, m[i * w + j + 1], 0);
          if (i < h) link(a, m[(i + 1) * w + j], 0);
          if (i < h && j + 1 < w && cellOk(i, j)) {
            link(a, m[(i + 1) * w + j + 1], 1);
            link(m[i * w + j + 1], m[(i + 1) * w + j], 1);
          }
          if (j + 2 < w && m[i * w + j + 1] >= 0) link(a, m[i * w + j + 2], bendKind);
          if (i + 2 <= h && m[(i + 1) * w + j] >= 0) link(a, m[(i + 2) * w + j], bendKind);
        }
    };
    const cellOkOf = (a) => (i, j) => !(i >= i1 && i < i2 && (j < a || j >= C - a));
    const cellOkK = { front: cellOkOf(A), back: cellOkOf(AB) };
    grid(map.front, WC, NC, cellOkK.front);
    grid(map.back, WC, NC, cellOkK.back);
    for (const m of Object.values(sleeveMap)) grid(m, SWC, RC, () => true, 8);
    // La copa de la manga tiene algo de cuerpo: uniones blandas entre las
    // primeras filas de la manga y la tela del torso junto a la sisa (la
    // manga no cuelga a plomo).
    const torsoIds = [...new Set([...map.front, ...map.back])].filter((id) => id >= 0 && Math.abs(P[id * 3]) > 0.1 && P[id * 3 + 1] > -0.4);
    // (Se buscan para una manga y la otra copia en espejo: así las dos
    // quedan iguales aunque haya empates de distancia.)
    for (const r of L.sleeveless ? [] : [2, 4, 6])
      for (let k = 0; k < SWC - 1; k++) {
        const a = sleeveMap.sleeveR[r * SWC + k];
        const near = torsoIds
          .map((id) => [dist(a, id), id])
          .filter(([d]) => d < 0.07 && d > 0.015)
          .sort((x, y) => x[0] - y[0])
          .slice(0, 2);
        for (const [, id] of near) {
          link(a, id, 4);
          link(mirror[a], mirror[id], 4);
        }
      }
    // Tira del cuello: escote y borde de arriba unidos por travesaños y
    // diagonales (una cinta de triángulos), más uniones que saltan un punto
    // a lo largo de los dos bordes y otras que cruzan la costura (del borde
    // de arriba a la tela justo debajo del escote). La cinta gira libre sobre
    // los travesaños (se achata al colgar), pero no se estira, no se dobla de
    // canto y no se da vuelta sobre la costura: el escote conserva su curva
    // sin dar forma al resto de la camiseta.
    const K = ring.length;
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const k2 = (k + 2) % K;
      link(ring[k], band[k], 5);
      link(band[k], band[k1], 5);
      link(ring[k], band[k1], 5);
      link(ring[k1], band[k], 5);
      link(ring[k], ring[k1], 5, true);
      link(band[k], band[k2], 6);
      link(ring[k], ring[k2], 6, true);
      for (const key of ['front', 'back'])
        for (let j = 0; j <= C; j++) if (map[key][NC * WC + j] === ring[k]) link(band[k], map[key][(NC - 1) * WC + j], 7);
    }
    // Colgada, la tela tiende a su molde (frente y espalda planos, como se
    // cortan) y no a la forma puesta: si no, recuerda la curva de hombros,
    // pecho y espalda y al quedar plana se arruga. Cada unión dentro de una
    // pieza toma su largo en la pieza aplanada (las de la costura, el
    // promedio de las dos). El borde del escote se acorta como la tira
    // (NECK_EASE) en el mismo aplanado: la tela de alrededor se acomoda plana,
    // sin fruncirse.
    const flatSum = new Map();
    for (const key of ['front', 'back']) {
      const m = map[key];
      const base = built.printBase[key];
      const pos3 = new Float64Array(m.length * 3);
      const X0 = new Float64Array(m.length * 2);
      const lift = key === 'front' ? vLift : null;
      m.forEach((id, v) => {
        if (id < 0) return;
        const f = 2 * Math.floor(v / WC) * W + 2 * (v % WC);
        pos3.set(P.subarray(id * 3, id * 3 + 3), v * 3);
        if (lift) for (let d = 0; d < 3; d++) pos3[v * 3 + d] += lift[f * 3 + d];
        X0[v * 2] = base[f * 2];
        X0[v * 2 + 1] = base[f * 2 + 1];
      });
      const tri = [];
      for (let i = 0; i < NC; i++)
        for (let j = 0; j < C; j++) {
          const a = i * WC + j;
          if (cellOkK[key](i, j)) tri.push(a, a + 1, a + WC, a + 1, a + WC + 1, a + WC);
        }
      const top = NC * WC;
      const e = built.measures.deepNeck ? 1 : NECK_EASE[key === 'front' ? 0 : 1];
      // (Se apaga junto a la costura del hombro: ver NECK_EASE_SIDE.)
      const side = (p, q) => smoothstep(NECK_EASE_SIDE[0], NECK_EASE_SIDE[1], Math.min(p % WC, q % WC, C - (p % WC), C - (q % WC)));
      const ease = e !== 1 ? (p, q) => (p >= top && q >= top ? 1 + (e - 1) * side(p, q) : 1) : null;
      const X = flattenPanel(pos3, tri, WC, NC + 1, X0, FLAT_REST, ease);
      const cellOf = new Map();
      m.forEach((id, v) => id >= 0 && cellOf.set(id, v));
      for (const [k, c] of pairs) {
        const va = cellOf.get(c[0]);
        const vb = cellOf.get(c[1]);
        if (va === undefined || vb === undefined) continue;
        const s = flatSum.get(k) || [0, 0];
        s[0] += Math.hypot(X[va * 2] - X[vb * 2], X[va * 2 + 1] - X[vb * 2 + 1]);
        s[1]++;
        flatSum.set(k, s);
      }
    }
    for (const [k, s] of flatSum) pairs.get(k)[2] = s[0] / s[1];
    // La tira sigue al escote: a lo largo, cada tramo se acorta o alarga como
    // el escote aplanado (las diagonales, sólo en su parte a lo largo; los
    // travesaños quedan iguales: la tira no se angosta).
    const pairOf = (a, b) => pairs.get(a < b ? a * n + b : b * n + a);
    const flatRatio = Float64Array.from(ring, (id, k) => {
      const d0 = dist(id, ring[(k + 1) % K]);
      return d0 > 1e-6 ? pairOf(id, ring[(k + 1) % K])[2] / d0 : 1;
    });
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const k2 = (k + 2) % K;
      const f = flatRatio[k];
      pairOf(band[k], band[k1])[2] = dist(band[k], band[k1]) * f;
      const s0 = dist(ring[k], ring[k1]);
      const s1 = dist(ring[k1], ring[k2]);
      pairOf(band[k], band[k2])[2] = dist(band[k], band[k2]) * ((s0 * f + s1 * flatRatio[k1]) / (s0 + s1));
      for (const [a, b] of [
        [ring[k], band[k1]],
        [ring[k1], band[k]],
      ]) {
        const r = dist(a, b);
        pairOf(a, b)[2] = Math.sqrt(Math.max(r * r * 0.5, r * r - (1 - f * f) * s0 * s0));
      }
    }
    const list = [...pairs.values()];
    // Tramos de la cinta para su cuerpo (ver holdBand): puntos del escote y
    // del borde de arriba, con su forma puesta respecto de su centro.
    const win = [];
    const winRest = [];
    for (let k = 0; k < K; k++) {
      const ids = [];
      for (let j = -BAND_SPAN; j <= BAND_SPAN; j++) ids.push(ring[(k + j + K) % K], band[(k + j + K) % K]);
      const c = [0, 1, 2].map((d) => ids.reduce((sum, id) => sum + P[id * 3 + d], 0) / ids.length);
      win.push(...ids);
      winRest.push(...ids.flatMap((id) => [0, 1, 2].map((d) => P[id * 3 + d] - c[d])));
    }
    // Cuánto guarda cada punto su forma: más el borde de arriba de la tira en
    // los costados del cuello (la costura no: arrastraría la tela del hombro
    // y se daría vuelta junto al broche).
    const half = Math.max(...ring.map((id) => Math.abs(P[id * 3])));
    this.bandK = new Float32Array(n);
    for (const [list, side] of [
      [ring, CLIPS_BAND_SEAM],
      [band, CLIPS_BAND_SIDE],
    ])
      for (const id of list) {
        const sd = smoothstep(BAND_SIDE[0], BAND_SIDE[1], Math.abs(P[id * 3]) / half);
        this.bandK[id] = this.bandStiff + (side - this.bandStiff) * sd;
      }
    this.bandWin = Int32Array.from(win);
    this.bandWinRest = Float32Array.from(winRest);
    this.bandWinQ = Array.from({ length: K }, () => new THREE.Quaternion());
    this.bandGoal = new Float32Array(n * 3);
    this.bandCount = new Uint8Array(n);
    this.ca = Int32Array.from(list, (c) => c[0]);
    this.cb = Int32Array.from(list, (c) => c[1]);
    this.rest = Float32Array.from(list, (c) => c[2]);
    this.kind = Uint8Array.from(list, (c) => c[3]);
    this.bandLinks = Int32Array.from(list.flatMap((c, i) => (c[3] >= 5 ? [i] : [])));

    // Dibujo de la tira: cada vértice guarda su posición en el marco local
    // (a lo largo del escote, subida de la cinta, normal) de su punto del
    // escote; colgada, el marco sale de la tela y de la cinta simuladas.
    // La cara de adentro llega sólo hasta el escote (puesta baja un poco
    // dentro de la camiseta; colgada, asomaría por la tela).
    const collarRing = L.rings.collar;
    const nf = collarRing.length;
    const rest = Float32Array.from(collarPos);
    const last = rest.length / 3 / CSW - 1;
    for (let i = 0; i < CSW * 3; i++) rest[last * CSW * 3 + i] = (rest[last * CSW * 3 + i] + rest[(last - 1) * CSW * 3 + i]) / 2;
    const seamRest = new Float32Array(nf * 3);
    collarRing.forEach(([key, v], e) => seamRest.set(this.geos[key].attributes.position.array.subarray(v * 3, v * 3 + 3), e * 3));
    const topRest = new Float32Array(nf * 3);
    this.bandTop((k, c) => bandRest[k][c], topRest);
    this.collarRing = collarRing;
    this.collarSW = CSW;
    this.collarSeam = new Float32Array(nf * 3);
    this.collarTop = new Float32Array(nf * 3);
    this.collarFrames = new Float32Array(nf * 10);
    this.collarLocal = new Float32Array(rest.length);
    this.collarFrame(seamRest, topRest);
    const F = this.collarFrames;
    for (let v = 0; v < rest.length / 3; v++) {
      const e = (v % CSW) % nf;
      const f = e * 10;
      const ox = rest[v * 3] - seamRest[e * 3];
      const oy = rest[v * 3 + 1] - seamRest[e * 3 + 1];
      const oz = rest[v * 3 + 2] - seamRest[e * 3 + 2];
      this.collarLocal[v * 3] = ox * F[f] + oy * F[f + 1] + oz * F[f + 2];
      this.collarLocal[v * 3 + 1] = (ox * F[f + 3] + oy * F[f + 4] + oz * F[f + 5]) / F[f + 9];
      this.collarLocal[v * 3 + 2] = ox * F[f + 6] + oy * F[f + 7] + oz * F[f + 8];
    }
    // En V, la punta de la tira se cose en inglete (ver mitreV): columna de
    // la punta (la del frente en el medio).
    this.collarTip = -1;
    if (built.measures.vNeck)
      for (let e = 0; e < nf; e++)
        if (collarRing[e][0] === 'front' && (this.collarTip < 0 || Math.abs(seamRest[e * 3]) < Math.abs(seamRest[this.collarTip * 3]))) this.collarTip = e;

    // Broches: pellizcan la costura de cada hombro (en dos puntos), como se
    // cuelga de verdad con un broche de pinza: la costura queda arriba, entre
    // las mordazas, el frente contra la mordaza de adelante y la espalda
    // contra la de atrás. Así frente y espalda quedan a la misma altura en el
    // broche y la espalda no se escapa hacia abajo. Los puntos quedan fijos.
    this.pins = [];
    this.clips = [];
    if (support.kind === 'clips') {
      const at = (id) => new THREE.Vector3(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]);
      for (const col of [0, C]) {
        // En la fila i: el punto de la costura y sus vecinos del frente y de
        // la espalda.
        const seam = (i) => map.front[i * WC + (col ? C : 0)];
        const nearFront = (i) => map.front[i * WC + (col ? C - 1 : 1)];
        const nearBack = (i) => map.back[i * WC + (col ? 1 : C - 1)];
        const rows = CLIP_ROWS.map((r) => i2 + r);
        const centers = rows.map(seam);
        const ys = centers.reduce((s, id) => s + P[id * 3 + 1], 0) / centers.length;
        const zs = centers.reduce((s, id) => s + P[id * 3 + 2], 0) / centers.length;
        let depth = 0;
        rows.forEach((i, r) => {
          const c = at(centers[r]);
          this.pins.push({ id: centers[r], from: c, to: new THREE.Vector3(c.x, ys, zs) });
          for (const [id, side] of [
            [nearFront(i), 1],
            [nearBack(i), -1],
          ]) {
            const d = at(id).distanceTo(c);
            depth = Math.max(depth, d);
            this.pins.push({ id, from: at(id), to: new THREE.Vector3(c.x, ys - d, zs + side * PINCH) });
          }
        });
        const xs = centers.map((id) => P[id * 3]);
        this.clips.push({ x: (xs[0] + xs[1]) / 2, y: ys, z: zs, width: Math.abs(xs[0] - xs[1]) + 0.02, depth });
      }
      for (const pin of this.pins) this.w[pin.id] = 0;
    }

    // Ataduras de largo máximo: cada punto no se aleja de lo que lo sostiene
    // (la costura de cada hombro, o cada broche) más que su distancia a lo
    // largo de la tela. Así la tela no se estira como goma con su propio
    // peso. Con un punto de cada lado, el largo queda bien atado también en
    // el centro.
    const anchorSets =
      support.kind === 'clips'
        ? [this.pins.slice(0, this.pins.length / 2).map((p) => p.id), this.pins.slice(this.pins.length / 2).map((p) => p.id)]
        : [0, C].map((col) => Array.from({ length: NC - i2 + 1 }, (_, r) => map.front[(i2 + r) * WC + col]));
    const adj = Array.from({ length: n }, () => []);
    for (const [a, b, r, kd] of list) {
      if (kd > 1 && kd !== 5) continue;
      adj[a].push(b, r);
      adj[b].push(a, r);
    }
    // La atadura hacia el hombro derecho es el espejo de la del izquierdo.
    const left = geodesic(n, adj, anchorSets[0]);
    const right = { owner: new Int32Array(n).fill(-1), len: new Float32Array(n).fill(Infinity) };
    for (let i = 0; i < n; i++) {
      const m = mirror[i];
      if (m < 0 || left.owner[m] < 0) continue;
      right.owner[i] = mirror[left.owner[m]];
      right.len[i] = left.len[m];
    }
    this.tetherSets = [left, right];
    // Vecinos por la tela: los puntos que a lo largo de la tela están a menos
    // de GEO_NEAR no chocan entre sí (los sostienen las uniones de la malla;
    // junto a las costuras pueden estar cerca en el espacio sin ser capas
    // distintas, como en la axila). Entre manga y torso, sólo hasta
    // GEO_NEAR_SEAM.
    this.near = new Uint32Array(Math.ceil((n * n) / 32));
    const dist0 = new Float32Array(n).fill(Infinity);
    const inSleeve = new Uint8Array(n);
    for (const m of Object.values(sleeveMap)) for (let k = SWC; k < m.length; k++) inSleeve[m[k]] = 1;
    for (let s0 = 0; s0 < n; s0++) {
      const seen = [s0];
      dist0[s0] = 0;
      const open = [s0];
      while (open.length) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (dist0[open[k]] < dist0[open[bi]]) bi = k;
        const u = open[bi];
        open[bi] = open[open.length - 1];
        open.pop();
        const nb = adj[u];
        for (let e = 0; e < nb.length; e += 2) {
          const v = nb[e];
          const nd = dist0[u] + nb[e + 1];
          if (nd >= GEO_NEAR || nd >= dist0[v]) continue;
          if (dist0[v] === Infinity) seen.push(v);
          if (!open.includes(v)) open.push(v);
          dist0[v] = nd;
        }
      }
      for (const v of seen) {
        if (inSleeve[s0] === inSleeve[v] || dist0[v] < GEO_NEAR_SEAM) {
          const key = s0 * n + v;
          this.near[key >>> 5] |= 1 << (key & 31);
        }
        dist0[v] = Infinity;
      }
    }

    // Pares de capas: frente delante de la espalda, y las dos caras de cada
    // manga. Cada par guarda la separación mínima que conserva colgado.
    // Frente y espalda: se comparan por cercanía (no por índice), así no se
    // cruzan aunque se corran al colgar.
    const own = (key) => new Set(map[key].filter((id) => id >= 0));
    const fs = own('front');
    const bs = own('back');
    this.frontIds = Int32Array.from([...fs].filter((id) => !bs.has(id)));
    this.backIds = Int32Array.from([...bs].filter((id) => !fs.has(id)));
    const rowOf = new Float32Array(n);
    map.front.forEach((id, k) => id >= 0 && (rowOf[id] = Math.floor(k / WC)));
    // Volumen: cada punto del frente queda unido al de la espalda que tenía
    // enfrente puesta, y no se le acerca más que una fracción de esa
    // distancia (pares fijos: el equilibrio no salta de un vecino a otro).
    const vol = [];
    const volGap = [];
    const partner = new Int32Array(n).fill(-1);
    const nearestBack = (f) => {
      let best = -1;
      let bd = Infinity;
      for (const b of this.backIds) {
        const d = (P[b * 3] - P[f * 3]) ** 2 + (P[b * 3 + 1] - P[f * 3 + 1]) ** 2;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      return best;
    };
    // El lado derecho copia en espejo los pares del izquierdo.
    for (const f of this.frontIds) if (P[f * 3] <= 0) partner[f] = nearestBack(f);
    for (const f of this.frontIds) if (P[f * 3] > 0) partner[f] = mirror[partner[mirror[f]]];
    // Espalda nadadora: frente a la sisa de atrás no hay espalda; el punto
    // más cercano queda en el borde de la sisa y lo empujaría hacia afuera.
    const racer = built.measures.racer;
    for (const f of this.frontIds) {
      const best = partner[f];
      if (racer && Math.hypot(P[f * 3] - P[best * 3], P[f * 3 + 1] - P[best * 3 + 1]) > RACER_PAIR) continue;
      const t = Math.min(1, rowOf[f] / i1);
      // (El relieve del busto no cuenta: inflaría la espalda.)
      const depth = P[f * 3 + 2] - P[best * 3 + 2] - bust(built.measures, P[f * 3], P[f * 3 + 1]);
      const g = depth * (VOLUME_HEM + (volTop - VOLUME_HEM) * t * t * (3 - 2 * t));
      if (g <= GAP) continue;
      vol.push(f, best);
      volGap.push(g);
    }
    this.volPairs = Int32Array.from(vol);
    this.volGap = Float32Array.from(volGap);
    const layers = [];
    const LC = SWC - 1;
    for (const m of Object.values(sleeveMap))
      for (let r = 1; r <= RC; r++)
        for (let k = 1; k < LC / 2; k++) layers.push(m[r * SWC + k], m[r * SWC + LC - k]);
    this.layers = Int32Array.from(layers);
    this.layerGap = Float32Array.from({ length: layers.length / 2 }, (_, c) => Math.max(GAP, (P[layers[2 * c] * 3 + 2] - P[layers[2 * c + 1] * 3 + 2]) * VOLUME_SLEEVE));
    this.bindFine(L, W, SW);
    // Choque entre puntos. Junto a los broches la tela queda apretada a
    // propósito (más cerca que el grosor): ahí no hay choque.
    this.noCollide = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      for (const { id } of this.pins)
        if (Math.hypot(P[i * 3] - P[id * 3], P[i * 3 + 1] - P[id * 3 + 1], P[i * 3 + 2] - P[id * 3 + 2]) < 0.025) this.noCollide[i] = 1;
    this.cellStart = new Int32Array(1);
    this.cellFill = new Int32Array(0);
    this.pairs = new Int32Array(4096);
    this.pairCount = 0;
    // El centro de cada celda también choca (contra los puntos): así un
    // punto de otra capa no puede pasar por el medio de una celda grande.
    const quads = [];
    const addQuads = (m, w, h, ok) => {
      for (let i = 0; i < h; i++)
        for (let j = 0; j + 1 < w; j++) {
          const q = [m[i * w + j], m[i * w + j + 1], m[(i + 1) * w + j + 1], m[(i + 1) * w + j]];
          if (ok(i, j) && q.every((id) => id >= 0 && !this.noCollide[id]) && new Set(q).size === 4) quads.push(...q);
        }
    };
    addQuads(map.front, WC, NC, cellOkK.front);
    addQuads(map.back, WC, NC, cellOkK.back);
    for (const m of Object.values(sleeveMap)) addQuads(m, SWC, RC, () => true);
    const bandRows = [...ring, ring[0], ...band, band[0]];
    addQuads(bandRows, K + 1, 1, () => true);
    this.quads = Int32Array.from(quads);
    const nq = quads.length / 4;
    this.quadPos = new Float32Array(nq * 3);
    this.cellIds = new Int32Array(n + nq);
    this.cellOf = new Int32Array(n + nq);
    this.qpairs = new Int32Array(4096);
    this.qpairCount = 0;
    this.time = 0;
    this.calm = 0;
    this.sleeping = false;
    this.wind = new THREE.Vector3();
    this.bounds = new THREE.Box3();
  }

  // Cada vértice de la malla fina sale de las 4 partículas de su celda.
  bindFine(L, W, SW) {
    const { C, NC, WC, SWC, RC } = this.dims;
    this.binds = [];
    const bindGrid = (key, rows, cols, at) => {
      const g = this.geos[key];
      const count = g.attributes.position.count;
      const ids = new Int32Array(count * 4);
      const ws = new Float32Array(count * 4);
      const use = new Uint8Array(count);
      for (let v = 0; v < count; v++) {
        const [I, J, gridMap, gw, gh] = at(v);
        const i0 = Math.min(Math.floor(I / 2), gh - 1);
        const j0 = Math.min(Math.floor(J / 2), gw - 2);
        const fi = I / 2 - i0;
        const fj = J / 2 - j0;
        const cs = [
          [i0, j0, (1 - fi) * (1 - fj)],
          [i0, j0 + 1, (1 - fi) * fj],
          [i0 + 1, j0, fi * (1 - fj)],
          [i0 + 1, j0 + 1, fi * fj],
        ];
        let ok = true;
        cs.forEach(([i, j, w], c) => {
          const id = gridMap[i * gw + j];
          if (w > 1e-6 && id < 0) ok = false;
          ids[v * 4 + c] = Math.max(id, 0);
          ws[v * 4 + c] = w;
        });
        use[v] = ok ? 1 : 0;
      }
      this.binds.push({ key, ids, ws, use });
    };
    for (const key of ['front', 'back']) bindGrid(key, NC, C, (v) => [Math.floor(v / W), v % W, this.map[key], WC, NC]);
    for (const [key, cuff] of L.sleeveless ? [] : [['sleeveL', 'cuffL'], ['sleeveR', 'cuffR']]) {
      bindGrid(key, RC, SWC, (v) => [Math.floor(v / SW), v % SW, this.sleeveMap[key], SWC, RC]);
      bindGrid(cuff, RC, SWC, (v) => [Math.floor(v / SW) + L.sleeveRows, v % SW, this.sleeveMap[key], SWC, RC]);
    }
    // Normales soldadas en las costuras (puntos que coinciden).
    const groups = new Map();
    for (const key of ['front', 'back', 'sleeveL', 'sleeveR', 'cuffL', 'cuffR'].filter((k) => this.geos[k])) {
      const g = this.geos[key];
      const a = g.attributes.position.array;
      const used = new Uint8Array(g.attributes.position.count);
      for (const v of g.index.array) used[v] = 1;
      for (let v = 0; v < used.length; v++) {
        if (!used[v]) continue;
        const k = `${Math.round(a[v * 3] * 2e5)},${Math.round(a[v * 3 + 1] * 2e5)},${Math.round(a[v * 3 + 2] * 2e5)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push([key, v]);
      }
    }
    this.weld = [...groups.values()].filter((g) => g.length > 1);
    // Dobladillos: cada vértice guarda su posición en el marco local
    // (tangente, subida, normal) de su punto del borde: la subida se mide a
    // lo largo de la tela (sigue su curva), así el dobladillo no se separa de
    // su panel ni atraviesa el de enfrente. (La tira del cuello se arma
    // aparte, con la cinta simulada: ver updateMeshes.) Los puños de las
    // sisas de la musculosa siguen su borde igual.
    this.ribbons = [];
    const lips = L.sleeveless ? ['armL', 'armR'] : ['cuffLLip', 'cuffRLip'];
    for (const [key, ring, sign] of [['hem', L.rings.hem, 1], ...lips.map((k) => [k, L.rings[k], 1])]) {
      const g = this.geos[key];
      const n = ring.length;
      const SWr = n + 1;
      // Los puños de las sisas siguen la tela por filas y por columnas según
      // el tramo de la sisa: su subida se suaviza a lo largo del borde (si
      // no, se quiebran en las esquinas).
      const smooth = key.startsWith('arm');
      const frames = this.ringFrames(ring, sign, smooth);
      // (Los puños de las sisas, con su forma de reposo colgada.)
      const a = g.userData.hang || g.attributes.position.array;
      const local = new Float32Array(a.length);
      for (let v = 0; v < a.length / 3; v++) {
        const k = (v % SWr) % n;
        const f = frames[k];
        const ox = a[v * 3] - f.o.x;
        const oy = a[v * 3 + 1] - f.o.y;
        const oz = a[v * 3 + 2] - f.o.z;
        local[v * 3] = ox * f.t.x + oy * f.t.y + oz * f.t.z;
        local[v * 3 + 1] = ox * f.u.x + oy * f.u.y + oz * f.u.z;
        local[v * 3 + 2] = ox * f.n.x + oy * f.n.y + oz * f.n.z;
      }
      // Columna de la tela que sube desde cada punto del borde.
      const cols = new Int32Array(n * (LIP_ROWS + 1));
      ring.forEach(([, v, w], k) => {
        for (let r = 0; r <= LIP_ROWS; r++) cols[k * (LIP_ROWS + 1) + r] = v + r * (w - v);
      });
      this.ribbons.push({ key, ring, sign, local, SWr, n, cols, smooth });
    }
  }

  ringFrames(ring, sign, smooth = false) {
    const n = ring.length;
    const P = (key, v) => {
      const a = this.geos[key].attributes.position.array;
      return new THREE.Vector3(a[v * 3], a[v * 3 + 1], a[v * 3 + 2]);
    };
    const base = ring.map(([key, v]) => P(key, v));
    const ts = base.map((_, k) => new THREE.Vector3().subVectors(base[(k + 1) % n], base[(k - 1 + n) % n]).normalize());
    let us = ring.map(([key, , w], k) => P(key, w).sub(base[k]).multiplyScalar(sign).normalize());
    if (smooth) {
      const flat = new Float32Array(n * 3);
      us.forEach((u, k) => u.toArray(flat, k * 3));
      smoothUps(flat, ts.map((t) => t.toArray()).flat(), n);
      us = us.map((u, k) => u.fromArray(flat, k * 3));
    }
    return base.map((o, k) => {
      const t = ts[k];
      const nn = new THREE.Vector3().crossVectors(t, us[k]).normalize();
      const u = new THREE.Vector3().crossVectors(nn, t).normalize();
      return { o, t, u, n: nn };
    });
  }

  // Borde de arriba de la tira en cada punto del escote fino: los pares son
  // los puntos de la cinta; los impares, una curva suave entre ellos.
  bandTop(get, out) {
    const K = this.band.length;
    for (let k = 0; k < K; k++) {
      const km = (k - 1 + K) % K;
      const k1 = (k + 1) % K;
      const k2 = (k + 2) % K;
      for (let c = 0; c < 3; c++) {
        out[2 * k * 3 + c] = get(k, c);
        out[(2 * k + 1) * 3 + c] = (9 * (get(k, c) + get(k1, c)) - get(km, c) - get(k2, c)) / 16;
      }
    }
  }

  // Marco de cada punto del escote fino: a lo largo del escote (t), subida de
  // la tira hasta su borde de arriba (u), normal (t × u), y alto de la subida.
  collarFrame(seam, top) {
    const nf = seam.length / 3;
    const F = this.collarFrames;
    for (let e = 0; e < nf; e++) {
      const ep = ((e + 1) % nf) * 3;
      const em = ((e - 1 + nf) % nf) * 3;
      let tx = seam[ep] - seam[em];
      let ty = seam[ep + 1] - seam[em + 1];
      let tz = seam[ep + 2] - seam[em + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let ux = top[e * 3] - seam[e * 3];
      let uy = top[e * 3 + 1] - seam[e * 3 + 1];
      let uz = top[e * 3 + 2] - seam[e * 3 + 2];
      const ut = ux * tx + uy * ty + uz * tz;
      ux -= tx * ut;
      uy -= ty * ut;
      uz -= tz * ut;
      const ul = Math.hypot(ux, uy, uz) || 1e-6;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const f = e * 10;
      F[f] = tx;
      F[f + 1] = ty;
      F[f + 2] = tz;
      F[f + 3] = ux;
      F[f + 4] = uy;
      F[f + 5] = uz;
      F[f + 6] = ty * uz - tz * uy;
      F[f + 7] = tz * ux - tx * uz;
      F[f + 8] = tx * uy - ty * ux;
      F[f + 9] = ul;
    }
  }

  wake() {
    this.sleeping = false;
    this.calm = 0;
    this.finishing = null;
  }

  // Empuje del mouse: las partículas cerca del punto se mueven en `dir`.
  push(point, dir, amount, radius = 0.075) {
    const P = this.p;
    for (let i = 0; i < this.n; i++) {
      if (!this.w[i]) continue;
      const dx = P[i * 3] - point.x;
      const dy = P[i * 3 + 1] - point.y;
      const dz = P[i * 3 + 2] - point.z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= radius) continue;
      const w = (1 - d / radius) ** 2 * amount * this.pushScale;
      P[i * 3] += dir.x * w;
      P[i * 3 + 1] += dir.y * w;
      P[i * 3 + 2] += dir.z * w;
    }
    this.lastPoke = this.time;
    this.wake();
  }

  breeze(v) {
    this.lastPoke = this.time;
    this.wind.addScaledVector(v, this.pushScale);
    if (this.wind.length() > 1.4) this.wind.setLength(1.4);
    this.wake();
  }

  step(dt) {
    if (this.sleeping) return false;
    if (this.finishing) return this.finish();
    const P = this.p;
    const Q = this.q;
    const n = this.n;
    const h = dt / SUBSTEPS;
    this.time += dt;
    const g = -9.8 * Math.min(1, 0.35 + this.time * 1.6) * h * h;
    const wx = this.wind.x * h * h;
    const wy = this.wind.y * h * h;
    const wz = this.wind.z * h * h;
    let motion = 0;
    // Freno del aire: normal mientras se mueve; pasado un rato sin empujones
    // frena más, así no quedan balanceos lentos (una tela real se aquieta
    // enseguida).
    const quiet = Math.min(1, Math.max(0, (this.time - Math.max(0, this.lastPoke) - CALM_AFTER) / 2));
    const damp = this.damp + (this.dampCalm - this.damp) * quiet;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) {
        if (!this.w[i]) continue;
        const k = i * 3;
        let vx = (P[k] - Q[k]) * damp;
        let vy = (P[k + 1] - Q[k + 1]) * damp;
        let vz = (P[k + 2] - Q[k + 2]) * damp;
        // Tope de velocidad: ningún punto salta en un subpaso más que una
        // fracción del grosor (así no atraviesa otra capa de tela).
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > VMAX * VMAX) {
          const s = VMAX / Math.sqrt(v2);
          vx *= s;
          vy *= s;
          vz *= s;
        }
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
        // Brisa con variación suave en el espacio (no empuja todo igual).
        const gust = 0.55 + 0.45 * Math.sin(P[k] * 21 + P[k + 1] * 13 + this.time * 3.1);
        P[k] += vx + wx * gust;
        P[k + 1] += vy + g + wy * gust;
        P[k + 2] += vz + wz * gust;
      }
      this.holdPins();
      if (this.moved() > (THICK / 2) ** 2) this.findPairs();
      if (this.hanger) this.findContacts();
      for (let it = 0; it < ITERATIONS; it++) {
        this.solveLengths();
        for (let b = 0; b < BAND_PASSES; b++) this.solveLengths(this.bandLinks);
        this.tethers();
        if (this.bandStiff) this.holdBand();
        this.keepSides();
        this.collideSelf();
        this.holdApart(this.volPairs, this.volGap, 0.5);
        this.holdApart(this.layers, this.layerGap, 0.5);
        if (this.hanger) this.collideHanger();
      }
    }
    for (let i = 0; i < n * 3; i++) motion = Math.max(motion, Math.abs(P[i] - Q[i]));
    this.wind.multiplyScalar(Math.exp(-2.2 * dt));
    if (motion < 1e-4 && this.wind.lengthSq() < 1e-3) this.calm++;
    else this.calm = 0;
    // Quieta (o, como tope, un rato largo después del último empujón con un
    // movimiento mínimo): se termina de acomodar simétrica y se duerme.
    const settled = this.calm > 30 && this.time > 1.5;
    const late = this.time - Math.max(0, this.lastPoke) > SETTLE_MAX && motion < 2e-3;
    if (settled || late) this.startFinish();
    return true;
  }

  // Final: la física se detiene y el lado derecho va, en FINISH_FRAMES
  // cuadros, hasta el espejo exacto del izquierdo (los puntos del medio, a
  // x = 0). Después la simulación se duerme.
  startFinish() {
    const P = this.p;
    const M = this.mirrorPairs;
    const from = new Float32Array(M.length / 2 * 3);
    const to = new Float32Array(M.length / 2 * 3);
    for (let c = 0; c < M.length; c += 2) {
      const a = M[c] * 3;
      const b = M[c + 1] * 3;
      const o = (c / 2) * 3;
      from.set([P[b], P[b + 1], P[b + 2]], o);
      to.set([-P[a], P[a + 1], P[a + 2]], o);
    }
    const mid = Float32Array.from(this.midline, (i) => P[i * 3]);
    this.finishing = { frame: 0, from, to, mid };
  }

  finish() {
    const P = this.p;
    const Q = this.q;
    const f = this.finishing;
    f.frame++;
    const t = Math.min(1, f.frame / FINISH_FRAMES);
    const e = t * t * (3 - 2 * t);
    const M = this.mirrorPairs;
    for (let c = 0; c < M.length; c += 2) {
      const b = M[c + 1] * 3;
      const o = (c / 2) * 3;
      for (let k = 0; k < 3; k++) P[b + k] = Q[b + k] = f.from[o + k] + (f.to[o + k] - f.from[o + k]) * e;
    }
    this.midline.forEach((i, k) => (P[i * 3] = Q[i * 3] = f.mid[k] * (1 - e)));
    if (t >= 1) {
      this.finishing = null;
      this.sleeping = true;
    }
    return true;
  }

  // Lleva cada punto del lado derecho (y su velocidad) hacia el espejo de su
  // par del izquierdo; k = 1 lo copia exacto. Los puntos del medio quedan en
  // x = 0.
  symmetrize(k) {
    const P = this.p;
    const Q = this.q;
    const M = this.mirrorPairs;
    for (let c = 0; c < M.length; c += 2) {
      const a = M[c] * 3;
      const b = M[c + 1] * 3;
      const dx = (-P[a] - P[b]) * k;
      const dy = (P[a + 1] - P[b + 1]) * k;
      const dz = (P[a + 2] - P[b + 2]) * k;
      const vx = (-Q[a] - Q[b]) * k;
      const vy = (Q[a + 1] - Q[b + 1]) * k;
      const vz = (Q[a + 2] - Q[b + 2]) * k;
      P[b] += dx;
      P[b + 1] += dy;
      P[b + 2] += dz;
      Q[b] += vx;
      Q[b + 1] += vy;
      Q[b + 2] += vz;
    }
    for (const i of this.midline) {
      P[i * 3] *= 1 - k;
      Q[i * 3] *= 1 - k;
    }
  }

  // Las dos ataduras de cada punto (una hacia cada hombro) se calculan desde
  // la misma posición y se suman (no se tironea primero de un lado y después
  // del otro).
  tethers() {
    const P = this.p;
    const sets = this.tetherSets;
    for (let i = 0; i < this.n; i++) {
      if (!this.w[i]) continue;
      const k = i * 3;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let s = 0; s < 2; s++) {
        const a = sets[s].owner[i];
        if (a < 0 || a === i) continue;
        const len = sets[s].len[i];
        const ka = a * 3;
        const dx = P[k] - P[ka];
        const dy = P[k + 1] - P[ka + 1];
        const dz = P[k + 2] - P[ka + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= len) continue;
        const f = len / d - 1;
        cx += dx * f;
        cy += dy * f;
        cz += dz * f;
      }
      P[k] += cx;
      P[k + 1] += cy;
      P[k + 2] += cz;
    }
  }

  // Los broches llevan su tela de a poco hasta donde la aprietan (en el
  // primer tercio de segundo) y después la sostienen quieta.
  holdPins() {
    if (!this.pins.length) return;
    const P = this.p;
    const Q = this.q;
    const t = Math.min(1, this.time / 0.3);
    const e = t * t * (3 - 2 * t);
    for (const { id, from, to } of this.pins) {
      const k = id * 3;
      P[k] = Q[k] = from.x + (to.x - from.x) * e;
      P[k + 1] = Q[k + 1] = from.y + (to.y - from.y) * e;
      P[k + 2] = Q[k + 2] = from.z + (to.z - from.z) * e;
    }
  }

  // Cuerpo de la tira: cada tramo busca el giro que mejor lleva su forma
  // puesta a la actual, y sus puntos se acercan (de a poco) a esa forma
  // girada. Cada punto participa de varios tramos y va al promedio.
  holdBand() {
    const P = this.p;
    const W = this.w;
    const ids = this.bandWin;
    const R = this.bandWinRest;
    const G = this.bandGoal;
    const cnt = this.bandCount;
    const m = 2 * (2 * BAND_SPAN + 1);
    const a = (this._ba ||= new Float32Array(9));
    for (const id of this.ring) cnt[id] = 0;
    for (const id of this.band) cnt[id] = 0;
    for (let w = 0; w < this.bandWinQ.length; w++) {
      const o = w * m;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let k = 0; k < m; k++) {
        const i = ids[o + k] * 3;
        cx += P[i];
        cy += P[i + 1];
        cz += P[i + 2];
      }
      cx /= m;
      cy /= m;
      cz /= m;
      a.fill(0);
      for (let k = 0; k < m; k++) {
        const i = ids[o + k] * 3;
        const r = (o + k) * 3;
        const px = P[i] - cx;
        const py = P[i + 1] - cy;
        const pz = P[i + 2] - cz;
        for (let c = 0; c < 3; c++) {
          const rc = R[r + c];
          a[c * 3] += px * rc;
          a[c * 3 + 1] += py * rc;
          a[c * 3 + 2] += pz * rc;
        }
      }
      const q = this.bandWinQ[w];
      extractRotation(a, q, 3);
      const { x, y, z, w: qw } = q;
      const r00 = 1 - 2 * (y * y + z * z);
      const r01 = 2 * (x * y - qw * z);
      const r02 = 2 * (x * z + qw * y);
      const r10 = 2 * (x * y + qw * z);
      const r11 = 1 - 2 * (x * x + z * z);
      const r12 = 2 * (y * z - qw * x);
      const r20 = 2 * (x * z - qw * y);
      const r21 = 2 * (y * z + qw * x);
      const r22 = 1 - 2 * (x * x + y * y);
      for (let k = 0; k < m; k++) {
        const id = ids[o + k];
        const r = (o + k) * 3;
        const qx = R[r];
        const qy = R[r + 1];
        const qz = R[r + 2];
        const gx = cx + r00 * qx + r01 * qy + r02 * qz;
        const gy = cy + r10 * qx + r11 * qy + r12 * qz;
        const gz = cz + r20 * qx + r21 * qy + r22 * qz;
        if (cnt[id]) {
          G[id * 3] += gx;
          G[id * 3 + 1] += gy;
          G[id * 3 + 2] += gz;
        } else {
          G[id * 3] = gx;
          G[id * 3 + 1] = gy;
          G[id * 3 + 2] = gz;
        }
        cnt[id]++;
      }
    }
    for (const list of [this.ring, this.band])
      for (const id of list) {
        if (!W[id] || !cnt[id]) continue;
        const i = id * 3;
        for (let c = 0; c < 3; c++) P[i + c] += (G[i + c] / cnt[id] - P[i + c]) * this.bandK[id];
      }
  }

  keepSides() {
    const P = this.p;
    const S = this.bandSides;
    for (let c = 0; c < S.length; c += 2) if (P[S[c] * 3] * S[c + 1] < 0) P[S[c] * 3] = 0;
  }

  // Restricciones de largo (todas, o sólo las de la lista `only`).
  solveLengths(only = null) {
    const P = this.p;
    const W = this.w;
    const { ca, cb, rest, kind } = this;
    const [bendS, bendC, bendCS] = this.bend;
    const capK = this.capK;
    const count = only ? only.length : ca.length;
    for (let o = 0; o < count; o++) {
      const c = only ? only[o] : o;
      const a = ca[c] * 3;
      const b = cb[c] * 3;
      const dx = P[b] - P[a];
      const dy = P[b + 1] - P[a + 1];
      const dz = P[b + 2] - P[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const err = d - rest[c];
      // Estirar cuesta mucho; comprimir, poco (la tela se pliega). La
      // flexión es blanda.
      const kd = kind[c];
      const k = kd === 7 ? SEAM_K : kd === 2 ? (err > 0 ? bendS : bendC) : kd === 8 ? (err > 0 ? bendS : bendCS) : kd === 4 ? capK : kd === 6 ? (err > 0 ? 0.6 : 0.45) : err > 0 ? 1 : kd === 1 ? 0.5 : kd === 5 ? 0.9 : 0.7;
      const wa = W[ca[c]];
      const wb = W[cb[c]];
      const ws = wa + wb;
      if (!ws) continue;
      const f = ((err / d) * k) / ws;
      P[a] += dx * f * wa;
      P[a + 1] += dy * f * wa;
      P[a + 2] += dz * f * wa;
      P[b] -= dx * f * wb;
      P[b + 1] -= dy * f * wb;
      P[b + 2] -= dz * f * wb;
    }
  }

  // Partículas cerca de la barra y el tramo más cercano de cada una (se
  // busca una vez por subpaso; en cada iteración sólo se miran sus vecinos).
  findContacts() {
    const P = this.p;
    const segs = this.hanger.segments;
    const minY = this.hanger.minY - 0.04;
    const ids = [];
    const near = [];
    const side = [];
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (P[k + 1] < minY || !this.w[i]) continue;
      let best = null;
      let bs = -1;
      for (let si = 0; si < segs.length; si++) {
        const r = this.segDist(k, segs[si]);
        if (!best || r.q < best.q) {
          best = r;
          bs = si;
        }
      }
      if (best.d2 < 0.05 * 0.05) {
        ids.push(i);
        near.push(bs);
        // De qué lado de la barra está al empezar el subpaso: si en las
        // iteraciones la cruzara, vuelve por ese lado.
        const d = Math.sqrt(best.d2) || 1;
        side.push([(P[k] - best.cx) / d, (P[k + 1] - best.cy) / d, (P[k + 2] - best.cz) / d]);
      }
    }
    this.contacts = { ids, near, side };
  }

  // Punto más cercano del eje de un tramo y qué tan adentro de la sección
  // está la partícula: q < 1 es adentro.
  segDist(k, s) {
    const P = this.p;
    const ex = s.b.x - s.a.x;
    const ey = s.b.y - s.a.y;
    const ez = s.b.z - s.a.z;
    let u = ((P[k] - s.a.x) * ex + (P[k + 1] - s.a.y) * ey + (P[k + 2] - s.a.z) * ez) / (ex * ex + ey * ey + ez * ez);
    u = Math.max(0, Math.min(1, u));
    const cx = s.a.x + ex * u;
    const cy = s.a.y + ey * u;
    const cz = s.a.z + ez * u;
    const ox = P[k] - cx;
    const oy = P[k + 1] - cy;
    const oz = P[k + 2] - cz;
    return { d2: ox * ox + oy * oy + oz * oz, cx, cy, cz, q: this.inside(s, ox, oy, oz) };
  }

  // Sección de choque: casi un rectángulo (superelipse de grado 4), así
  // también las esquinas de la madera quedan cubiertas.
  inside(s, ox, oy, oz) {
    const u = (ox * s.up.x + oy * s.up.y) / s.hu;
    const w = (ox * s.t.x + oy * s.t.y + oz * s.t.z) / s.hu;
    const v = oz / s.hz;
    const u2 = u * u;
    const v2 = v * v;
    const w2 = w * w;
    return Math.sqrt(u2 * u2 + v2 * v2 + w2 * w2);
  }

  // La tira del cuello que se dibuja (más fina que la simulada) corta camino
  // donde se apoya en la madera: en los costados de la V su borde de arriba
  // pasaba por dentro de la barra y la madera asomaba a través del cuello.
  // Cada punto que queda dentro de la madera (la sección de choque sin su
  // margen) sale hasta su superficie.
  outOfWood(a) {
    const segs = this.hanger.segments;
    const bb = this.hanger.box;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < bb[0] || a[i] > bb[1] || a[i + 1] < bb[2] || a[i + 1] > bb[3] || a[i + 2] < bb[4] || a[i + 2] > bb[5]) continue;
      let best = null;
      let bs = null;
      for (const sg of segs) {
        const ex = sg.b.x - sg.a.x;
        const ey = sg.b.y - sg.a.y;
        const ez = sg.b.z - sg.a.z;
        const u = Math.max(0, Math.min(1, ((a[i] - sg.a.x) * ex + (a[i + 1] - sg.a.y) * ey + (a[i + 2] - sg.a.z) * ez) / (ex * ex + ey * ey + ez * ez)));
        const o = [a[i] - sg.a.x - ex * u, a[i + 1] - sg.a.y - ey * u, a[i + 2] - sg.a.z - ez * u];
        const q = this.insideWood(sg, o);
        if (!best || q < best.q) {
          best = { q, o };
          bs = sg;
        }
      }
      // (La superelipse elige el tramo; el empuje es con la sección de la
      // madera, un rectángulo de bordes redondeados: en las esquinas queda
      // afuera de la superelipse y la tira de la V colgada se metía ahí.)
      if (best.q >= 1.5) continue;
      const m = this.woodPush(bs, best.o);
      if (!m) continue;
      a[i] += bs.up.x * m[0];
      a[i + 1] += bs.up.y * m[0];
      a[i + 2] += m[1];
    }
  }
  // Cuánto mover un punto (o, desde el eje del tramo s) a lo alto y a lo
  // hondo de la sección para dejarlo en el borde de la madera (null si ya
  // está afuera).
  woodPush(s, o) {
    const h = s.hu - HANGER_MARGIN + 0.0005;
    const d = s.hz - HANGER_MARGIN + 0.0005;
    const u = o[0] * s.up.x + o[1] * s.up.y;
    const v = o[2];
    const au = Math.abs(u);
    const av = Math.abs(v);
    const cu = au - (h - s.r);
    const cv = av - (d - s.r);
    let nu = au;
    let nv = av;
    if (cu > 0 && cv > 0) {
      const l = Math.hypot(cu, cv);
      if (l >= s.r) return null;
      nu = h - s.r + (cu / l) * s.r;
      nv = d - s.r + (cv / l) * s.r;
    } else if (au >= h || av >= d) return null;
    else if (h - au < d - av) nu = h;
    else nv = d;
    return [Math.sign(u) * (nu - au), Math.sign(v) * (nv - av)];
  }
  insideWood(s, o) {
    const hu = s.hu - HANGER_MARGIN + 0.0005;
    const u = (o[0] * s.up.x + o[1] * s.up.y) / hu;
    const w = (o[0] * s.t.x + o[1] * s.t.y + o[2] * s.t.z) / hu;
    const v = o[2] / (s.hz - HANGER_MARGIN + 0.0005);
    return Math.sqrt(u ** 4 + v ** 4 + w ** 4);
  }

  // Choque con la barra de la percha (dentro del ciclo de restricciones, así
  // la tela nunca llega a pasar del centro de la barra). La partícula que
  // entra en la sección sale hacia afuera por la misma dirección (o por el
  // lado del que venía, si la cruzó).
  collideHanger() {
    const P = this.p;
    const Q = this.q;
    const segs = this.hanger.segments;
    const { ids, near, side } = this.contacts;
    for (let c = 0; c < ids.length; c++) {
      const k = ids[c] * 3;
      let best = null;
      let bs = null;
      for (let si = Math.max(0, near[c] - 1); si <= Math.min(segs.length - 1, near[c] + 1); si++) {
        const r = this.segDist(k, segs[si]);
        if (!best || r.q < best.q) {
          best = r;
          bs = segs[si];
        }
      }
      if (best.q >= 1) continue;
      let ox = P[k] - best.cx;
      let oy = P[k + 1] - best.cy;
      let oz = P[k + 2] - best.cz;
      const s0 = side[c];
      if (best.d2 < 1e-12 || ox * s0[0] + oy * s0[1] + oz * s0[2] < 0) [ox, oy, oz] = s0;
      const f = 1 / Math.sqrt(this.inside(bs, ox, oy, oz));
      P[k] = best.cx + ox * f;
      P[k + 1] = best.cy + oy * f;
      P[k + 2] = best.cz + oz * f;
      // La tela que se apoya arriba de la barra queda adherida donde tocó
      // (como sobre una percha de madera); la que roza de costado, no.
      if (oy / Math.hypot(ox, oy, oz) > 0.25) {
        this.w[ids[c]] = 0;
        Q[k] = P[k];
        Q[k + 1] = P[k + 1];
        Q[k + 2] = P[k + 2];
      }
    }
  }

  // Choque entre todos los puntos de la tela: si dos puntos que en la tela
  // están lejos (no son vecinos) quedan a menos de THICK, se separan. Cubre
  // manga contra cuerpo, pliegues que se meten en otros y frente contra
  // espalda en cualquier dirección.
  //
  // Una vez por cuadro se buscan los pares que están cerca (a menos de dos
  // grosores), con una grilla espacial sobre la caja que ocupa la tela: cada
  // punto sólo mira las 27 celdas que lo rodean. En cada subpaso sólo se
  // revisan esos pares (en un cuadro la tela se mueve mucho menos que eso).
  // Cuánto se alejó (al cuadrado) el punto que más se movió desde la última
  // búsqueda de pares. Los pares se buscan hasta dos grosores: mientras nadie
  // se mueva más de medio grosor, la lista sigue sirviendo.
  moved() {
    const P = this.p;
    const B = this.pairsAt;
    if (!B) return Infinity;
    let m = 0;
    for (let i = 0; i < P.length; i += 3) {
      const d = (P[i] - B[i]) ** 2 + (P[i + 1] - B[i + 1]) ** 2 + (P[i + 2] - B[i + 2]) ** 2;
      if (d > m) m = d;
    }
    return m;
  }

  findPairs() {
    const P = this.p;
    if (!this.pairsAt) this.pairsAt = new Float32Array(P.length);
    this.pairsAt.set(P);
    const n = this.n;
    const Qd = this.quads;
    const nq = Qd.length / 4;
    const QP = this.quadPos;
    for (let q = 0; q < nq; q++)
      for (let c = 0; c < 3; c++) QP[q * 3 + c] = (P[Qd[q * 4] * 3 + c] + P[Qd[q * 4 + 1] * 3 + c] + P[Qd[q * 4 + 2] * 3 + c] + P[Qd[q * 4 + 3] * 3 + c]) / 4;
    const reach = 2 * THICK;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const inv = 1 / reach;
    const nx = Math.floor((x1 - x0) * inv) + 1;
    const ny = Math.floor((y1 - y0) * inv) + 1;
    const nz = Math.floor((z1 - z0) * inv) + 1;
    const cells = nx * ny * nz;
    this.pairCount = 0;
    this.qpairCount = 0;
    if (!(cells < 2e6)) return;
    if (this.cellStart.length < cells + 1) {
      this.cellStart = new Int32Array(cells + 1);
      this.cellFill = new Int32Array(cells);
    }
    const start = this.cellStart;
    const fill = this.cellFill;
    const ids = this.cellIds;
    const cellOf = this.cellOf;
    // En la grilla van los puntos (0..n-1) y los centros de celda (n..).
    const total = n + nq;
    const pos = (e, c) => (e < n ? P[e * 3 + c] : QP[(e - n) * 3 + c]);
    start.fill(0, 0, cells + 1);
    for (let e = 0; e < total; e++) {
      const cx = Math.min(nx - 1, Math.max(0, Math.floor((pos(e, 0) - x0) * inv)));
      const cy = Math.min(ny - 1, Math.max(0, Math.floor((pos(e, 1) - y0) * inv)));
      const cz = Math.min(nz - 1, Math.max(0, Math.floor((pos(e, 2) - z0) * inv)));
      const c = (cx * ny + cy) * nz + cz;
      cellOf[e] = c;
      start[c + 1]++;
    }
    for (let c = 1; c <= cells; c++) start[c] += start[c - 1];
    fill.set(start.subarray(0, cells));
    for (let e = 0; e < total; e++) ids[fill[cellOf[e]]++] = e;
    const r2 = reach * reach;
    const near = this.near;
    let pairs = this.pairs;
    let qpairs = this.qpairs;
    let count = 0;
    let qcount = 0;
    const skip = this.noCollide;
    for (let i = 0; i < n; i++) {
      if (skip[i]) continue;
      const px = P[i * 3];
      const py = P[i * 3 + 1];
      const pz = P[i * 3 + 2];
      const ix = Math.floor((px - x0) * inv);
      const iy = Math.floor((py - y0) * inv);
      const iz = Math.floor((pz - z0) * inv);
      for (let ax = Math.max(0, ix - 1); ax <= Math.min(nx - 1, ix + 1); ax++)
        for (let ay = Math.max(0, iy - 1); ay <= Math.min(ny - 1, iy + 1); ay++) {
          const row = (ax * ny + ay) * nz;
          const c0 = row + Math.max(0, iz - 1);
          const c1 = row + Math.min(nz - 1, iz + 1);
          for (let e = start[c0]; e < start[c1 + 1]; e++) {
            const j = ids[e];
            if (j < n) {
              if (j <= i || skip[j]) continue;
              const dx = P[j * 3] - px;
              const dy = P[j * 3 + 1] - py;
              const dz = P[j * 3 + 2] - pz;
              if (dx * dx + dy * dy + dz * dz >= r2) continue;
              const key = i * n + j;
              if (near[key >>> 5] & (1 << (key & 31))) continue;
              if (count * 2 + 2 > pairs.length) {
                const grown = new Int32Array(pairs.length * 2);
                grown.set(pairs);
                pairs = this.pairs = grown;
              }
              pairs[count * 2] = i;
              pairs[count * 2 + 1] = j;
              count++;
            } else {
              const q = j - n;
              const dx = QP[q * 3] - px;
              const dy = QP[q * 3 + 1] - py;
              const dz = QP[q * 3 + 2] - pz;
              if (dx * dx + dy * dy + dz * dz >= r2) continue;
              let close = false;
              for (let k = 0; k < 4; k++) {
                const c = Qd[q * 4 + k];
                const key = i * n + c;
                if (c === i || near[key >>> 5] & (1 << (key & 31))) close = true;
              }
              if (close) continue;
              if (qcount * 2 + 2 > qpairs.length) {
                const grown = new Int32Array(qpairs.length * 2);
                grown.set(qpairs);
                qpairs = this.qpairs = grown;
              }
              qpairs[qcount * 2] = i;
              qpairs[qcount * 2 + 1] = q;
              qcount++;
            }
          }
        }
    }
    this.pairCount = count;
    this.qpairCount = qcount;
  }

  // Los pares que se tocan se separan (a medias en cada iteración: corre
  // dentro del ciclo de restricciones y así converge sin vibrar).
  collideSelf() {
    const P = this.p;
    const W = this.w;
    const pairs = this.pairs;
    const t2 = THICK * THICK;
    for (let c = 0; c < this.pairCount; c++) {
      const i = pairs[c * 2];
      const j = pairs[c * 2 + 1];
      const dx = P[j * 3] - P[i * 3];
      const dy = P[j * 3 + 1] - P[i * 3 + 1];
      const dz = P[j * 3 + 2] - P[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= t2 || d2 < 1e-12) continue;
      const wi = W[i];
      const wj = W[j];
      if (!(wi + wj)) continue;
      const d = Math.sqrt(d2);
      const f = (((THICK - d) / d) * 0.5) / (wi + wj);
      P[i * 3] -= dx * f * wi;
      P[i * 3 + 1] -= dy * f * wi;
      P[i * 3 + 2] -= dz * f * wi;
      P[j * 3] += dx * f * wj;
      P[j * 3 + 1] += dy * f * wj;
      P[j * 3 + 2] += dz * f * wj;
    }
    // Punto contra centro de celda: el centro se mueve repartido entre las
    // cuatro esquinas.
    const Qd = this.quads;
    const qp = this.qpairs;
    for (let c = 0; c < this.qpairCount; c++) {
      const i = qp[c * 2];
      const q = qp[c * 2 + 1] * 4;
      const a = Qd[q];
      const b = Qd[q + 1];
      const e = Qd[q + 2];
      const g = Qd[q + 3];
      const dx = P[i * 3] - (P[a * 3] + P[b * 3] + P[e * 3] + P[g * 3]) / 4;
      const dy = P[i * 3 + 1] - (P[a * 3 + 1] + P[b * 3 + 1] + P[e * 3 + 1] + P[g * 3 + 1]) / 4;
      const dz = P[i * 3 + 2] - (P[a * 3 + 2] + P[b * 3 + 2] + P[e * 3 + 2] + P[g * 3 + 2]) / 4;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= t2 || d2 < 1e-12) continue;
      const wi = W[i];
      const wq = (W[a] + W[b] + W[e] + W[g]) / 16;
      if (!(wi + wq)) continue;
      const d = Math.sqrt(d2);
      const f = (((THICK - d) / d) * 0.5) / (wi + wq);
      P[i * 3] += dx * f * wi;
      P[i * 3 + 1] += dy * f * wi;
      P[i * 3 + 2] += dz * f * wi;
      for (const k of [a, b, e, g]) {
        const s = (f * W[k]) / 4;
        P[k * 3] -= dx * s;
        P[k * 3 + 1] -= dy * s;
        P[k * 3 + 2] -= dz * s;
      }
    }
  }

  // Volumen: cada par (frente y espalda, o las dos caras de una manga) no se
  // acerca más que su separación mínima, en la dirección que los une (así
  // vale aunque la tela gire).
  holdApart(pairs, gaps, k) {
    const P = this.p;
    const W = this.w;
    for (let c = 0; c < pairs.length; c += 2) {
      const a = pairs[c];
      const b = pairs[c + 1];
      const wa = W[a];
      const wb = W[b];
      if (!(wa + wb)) continue;
      const dx = P[a * 3] - P[b * 3];
      const dy = P[a * 3 + 1] - P[b * 3 + 1];
      const dz = P[a * 3 + 2] - P[b * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const gap = gaps[c / 2];
      if (d >= gap || d < 1e-6) continue;
      const f = (((gap - d) / d) * k) / (wa + wb);
      P[a * 3] += dx * f * wa;
      P[a * 3 + 1] += dy * f * wa;
      P[a * 3 + 2] += dz * f * wa;
      P[b * 3] -= dx * f * wb;
      P[b * 3 + 1] -= dy * f * wb;
      P[b * 3 + 2] -= dz * f * wb;
    }
  }

  // Dobladillo a partir de la tela: en cada punto del borde se arma la
  // columna que sube por el panel (con su tangente y su normal en cada fila)
  // y cada vértice del dobladillo se ubica a su altura sobre esa columna.
  updateRibbon(rb) {
    const R = LIP_ROWS + 1;
    const n = rb.n;
    const pts = (rb._pts ||= new Float32Array(n * R * 3));
    for (let k = 0; k < n; k++) {
      const a = this.geos[rb.ring[k][0]].attributes.position.array;
      for (let r = 0; r < R; r++) {
        const v = rb.cols[k * R + r] * 3;
        const o = (k * R + r) * 3;
        pts[o] = a[v];
        pts[o + 1] = a[v + 1];
        pts[o + 2] = a[v + 2];
      }
    }
    const len = (rb._len ||= new Float32Array(n * R));
    const nrm = (rb._nrm ||= new Float32Array(n * R * 3));
    const tan = (rb._tan ||= new Float32Array(n * R * 3));
    const up = (rb._up ||= new Float32Array(n * R * 3));
    const at = (k, r, c) => pts[(k * R + r) * 3 + c];
    for (let k = 0; k < n; k++) {
      const kp = (k + 1) % n;
      const km = (k - 1 + n) % n;
      for (let r = 0; r < R; r++) {
        const i = (k * R + r) * 3;
        let tx = at(kp, r, 0) - at(km, r, 0);
        let ty = at(kp, r, 1) - at(km, r, 1);
        let tz = at(kp, r, 2) - at(km, r, 2);
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const r0 = r < R - 1 ? r : r - 1;
        let ux = (at(k, r0 + 1, 0) - at(k, r0, 0)) * rb.sign;
        let uy = (at(k, r0 + 1, 1) - at(k, r0, 1)) * rb.sign;
        let uz = (at(k, r0 + 1, 2) - at(k, r0, 2)) * rb.sign;
        // Perpendicular al borde, como en el marco de reposo (en las esquinas
        // de la sisa la columna de la tela no lo es).
        const ut = ux * tx + uy * ty + uz * tz;
        ux -= ut * tx;
        uy -= ut * ty;
        uz -= ut * tz;
        const seg = Math.hypot(ux, uy, uz) || 1;
        ux /= seg;
        uy /= seg;
        uz /= seg;
        const nx = ty * uz - tz * uy;
        const ny = tz * ux - tx * uz;
        const nz = tx * uy - ty * ux;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nrm[i] = nx / nl;
        nrm[i + 1] = ny / nl;
        nrm[i + 2] = nz / nl;
        tan[i] = tx;
        tan[i + 1] = ty;
        tan[i + 2] = tz;
        up[i] = ux;
        up[i + 1] = uy;
        up[i + 2] = uz;
        len[k * R + r] = r ? len[k * R + r - 1] + Math.hypot(at(k, r, 0) - at(k, r - 1, 0), at(k, r, 1) - at(k, r - 1, 1), at(k, r, 2) - at(k, r - 1, 2)) : 0;
      }
    }
    // Puños de las sisas: la subida del borde (fila 0), suavizada como en
    // reposo, y su normal.
    if (rb.smooth) {
      const u0 = (rb._u0 ||= new Float32Array(n * 3));
      const t0 = (rb._t0 ||= new Float32Array(n * 3));
      for (let k = 0; k < n; k++)
        for (let c = 0; c < 3; c++) {
          u0[k * 3 + c] = up[k * R * 3 + c];
          t0[k * 3 + c] = tan[k * R * 3 + c];
        }
      smoothUps(u0, t0, n);
      for (let k = 0; k < n; k++) {
        const i = k * R * 3;
        const [tx, ty, tz] = [t0[k * 3], t0[k * 3 + 1], t0[k * 3 + 2]];
        const [ux, uy, uz] = [u0[k * 3], u0[k * 3 + 1], u0[k * 3 + 2]];
        up[i] = ux;
        up[i + 1] = uy;
        up[i + 2] = uz;
        const nx = ty * uz - tz * uy;
        const ny = tz * ux - tx * uz;
        const nz = tx * uy - ty * ux;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nrm[i] = nx / nl;
        nrm[i + 1] = ny / nl;
        nrm[i + 2] = nz / nl;
      }
    }
    const attr = this.geos[rb.key].attributes.position;
    const a = attr.array;
    const l = rb.local;
    for (let v = 0; v < attr.count; v++) {
      const k = (v % rb.SWr) % n;
      const s = l[v * 3 + 1];
      let r = 0;
      while (r < R - 2 && len[k * R + r + 1] < s) r++;
      const i0 = (k * R + r) * 3;
      const i1 = i0 + 3;
      const span = len[k * R + r + 1] - len[k * R + r] || 1;
      const f = s <= 0 ? 0 : (s - len[k * R + r]) / span;
      // Abajo del borde (o arriba de la última fila) se sigue en línea recta.
      const ex = s <= 0 ? s : Math.max(0, f - 1) * span;
      const fc = Math.min(1, f);
      for (let c = 0; c < 3; c++) {
        const base = pts[i0 + c] + (pts[i1 + c] - pts[i0 + c]) * fc + up[(s <= 0 ? i0 : i1) + c] * ex;
        const nn = nrm[i0 + c] + (nrm[i1 + c] - nrm[i0 + c]) * fc;
        a[v * 3 + c] = base + tan[i0 + c] * l[v * 3] + nn * l[v * 3 + 2];
      }
    }
    attr.needsUpdate = true;
    this.geos[rb.key].computeVertexNormals();
  }

  // Malla fina, cuello y dobladillos a partir de las partículas.
  updateMeshes() {
    const P = this.p;
    for (const b of this.binds) {
      const attr = this.geos[b.key].attributes.position;
      const a = attr.array;
      for (let v = 0; v < attr.count; v++) {
        if (!b.use[v]) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        for (let c = 0; c < 4; c++) {
          const w = b.ws[v * 4 + c];
          if (!w) continue;
          const id = b.ids[v * 4 + c] * 3;
          x += P[id] * w;
          y += P[id + 1] * w;
          z += P[id + 2] * w;
        }
        a[v * 3] = x;
        a[v * 3 + 1] = y;
        a[v * 3 + 2] = z;
      }
      attr.needsUpdate = true;
      this.geos[b.key].computeVertexNormals();
    }
    for (const group of this.weld) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (const [key, v] of group) {
        const nn = this.geos[key].attributes.normal.array;
        x += nn[v * 3];
        y += nn[v * 3 + 1];
        z += nn[v * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      for (const [key, v] of group) this.geos[key].attributes.normal.array.set([x / l, y / l, z / l], v * 3);
    }
    for (const r of this.ribbons) this.updateRibbon(r);
    // La tira del cuello: su borde de abajo va cosido al escote de la tela (el
    // mismo punto del borde del frente o la espalda) y sube hasta el borde de
    // la cinta simulada.
    const seam = this.collarSeam;
    this.collarRing.forEach(([key, e], i) => seam.set(this.geos[key].attributes.position.array.subarray(e * 3, e * 3 + 3), i * 3));
    this.bandTop((k, c) => P[this.band[k] * 3 + c], this.collarTop);
    this.collarFrame(seam, this.collarTop);
    const F = this.collarFrames;
    const l = this.collarLocal;
    const SW = this.collarSW;
    const nf = this.collarRing.length;
    const attr = this.geos.collar.attributes.position;
    const a = attr.array;
    for (let v = 0; v < a.length / 3; v++) {
      const e = (v % SW) % nf;
      const f = e * 10;
      const i = v * 3;
      const lu = l[i + 1] * F[f + 9];
      for (let c = 0; c < 3; c++) a[i + c] = seam[e * 3 + c] + F[f + c] * l[i] + F[f + 3 + c] * lu + F[f + 6 + c] * l[i + 2];
    }
    if (this.collarTip >= 0) mitreV(a, SW, a.length / 3 / SW, this.collarTip);
    if (this.hanger) this.outOfWood(a);
    attr.needsUpdate = true;
    this.geos.collar.computeVertexNormals();
    for (const g of Object.values(this.geos)) g.computeBoundingSphere();
  }
}
