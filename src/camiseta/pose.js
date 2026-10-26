import * as THREE from 'three';
import { computeNormals, weldNormals } from './shirt.js';

// En movimiento: la camiseta con cuerpo (la de buildShirt, sin cambiarla)
// doblada por un esqueleto invisible, como un jugador en plena zancada pero
// frenado (referencias/conjunto-en-movimiento.webp). No se simula: cada punto
// de la tela se lleva con una función de su lugar en la camiseta puesta, la
// misma para todas las piezas, así las costuras siguen cerradas. Colores,
// tela y diseño no cambian (las UV son las mismas).
//
// Ejes: x hacia la izquierda de quien la lleva, y hacia arriba (0 en el
// cuello), z hacia adelante. Ángulos en grados.
export const POSES = {
  // Zancada: la pierna derecha adelante, así la cadera gira llevando el
  // costado derecho hacia adelante y los hombros al revés (el brazo izquierdo
  // adelante, el derecho atrás); el pecho apenas inclinado hacia adelante. El
  // ruedo llega tarde al giro: se abre hacia atrás del lado derecho.
  run: {
    hips: 13, // giro de la cadera (+: el costado derecho hacia adelante)
    shoulders: -14, // giro de los hombros
    lean: 8, // el pecho hacia adelante
    side: 3, // y hacia el costado izquierdo
    tilt: -4, // la cadera, hacia el costado (+: sube el lado izquierdo del ruedo)
    // El brazo de adelante gira poco (corriendo, el codo va doblado): más,
    // la boca de la manga mira a la cámara y se ve el adentro.
    arms: {
      L: { swing: -24, close: 8 }, // swing: + hacia atrás; close: + hacia el cuerpo
      R: { swing: 32, close: 6 },
    },
    hem: {
      flare: 0.055, // cuánto se abre el ruedo donde más se abre (m)
      at: -125, // dónde (ángulo alrededor del cuerpo: 0 adelante, 90 a la izquierda)
      spread: 70, // y qué tanto abarca
      base: 0.005, // lo que se abre parejo todo alrededor
      waves: 5, // ondas del ruedo abierto
      wave: 0.28,
      lift: 0.6, // cuánto sube lo que se abre (fracción de lo que se abre)
      lag: 9, // el ruedo gira menos que la cadera (llega tarde)
      rise: 0.3, // desde cuánto más arriba del ruedo empieza a abrirse (m)
    },
  },
};

const HIPS_Y = -0.55; // de aquí para abajo, todo gira con la cadera
const CHEST_Y = -0.15; // de aquí para arriba, con los hombros
const BEND_Y = -0.5; // centro de la inclinación del pecho
const ARM_SHARE = 0.35; // cuánto del giro del brazo lleva la tela junto a la sisa
const ARM_NEAR = [0.075, 0.14]; // y hasta dónde (distancia a la articulación del hombro)
const ARM_RAMP = 0.5; // a qué fracción de la manga ya gira entera

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rad = THREE.MathUtils.degToRad;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Una copia de `built` con la tela en la pose: posiciones y normales nuevas;
// UV, costuras y zonas compartidas con la camiseta puesta (que queda en
// `rest`: el molde de estampado se aplana sobre ella, así un diseño cae igual
// que con cuerpo).
export function poseShirt(rest, pose) {
  const M = rest.measures;
  const L = M.L;
  const lay = rest.layout;
  const SW = lay.sleeveSW;
  const SR = lay.sleeveRows;
  const H = pose.hem;

  // Articulación de cada hombro (adentro del cuerpo, a media altura de la
  // sisa) y su giro.
  const joints = {};
  for (const [name, s] of [['L', 1], ['R', -1]]) {
    const a = pose.arms[name];
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(a.swing))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(-s * a.close)));
    joints[s] = { c: new THREE.Vector3(s * (M.shA - 0.05), (M.shY + M.pitY) / 2 + 0.01, -0.005), q };
  }
  const nearArm = (x, y, z) => {
    const j = joints[x >= 0 ? 1 : -1];
    const d = Math.hypot(x - j.c.x, y - j.c.y, z - j.c.z);
    return ARM_SHARE * (1 - smooth(ARM_NEAR[0], ARM_NEAR[1], d));
  };

  const yF = -L + H.rise;
  const I = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qt = new THREE.Quaternion();
  const e = new THREE.Euler();
  const P = new THREE.Vector3();
  const C = new THREE.Vector3(0, BEND_Y, 0);

  // Lleva el punto (x, y, z) de la camiseta puesta a la pose; `arm` es lo que
  // sigue al brazo (1 en la manga, ya lejos de la sisa) o null para que se
  // calcule por cercanía a la sisa (torso, cuello, ruedo).
  const place = (x, y, z, arm, flow, out) => {
    P.set(x, y, z);
    // Ruedo: se abre hacia afuera (y sube un poco) donde llega tarde al giro.
    let lag = 0;
    if (flow && y < yF) {
      const s = Math.min(1, (yF - y) / H.rise);
      const g = s * s;
      const th = Math.atan2(x, z);
      const bell = Math.exp(-((wrap(th - rad(H.at)) / rad(H.spread)) ** 2));
      const open = (H.base + H.flare * bell) * (1 + H.wave * bell * Math.sin(H.waves * th + 1.3)) * g;
      P.x += Math.sin(th) * open;
      P.z += Math.cos(th) * open;
      P.y += H.lift * open * s;
      lag = H.lag * g;
    }
    // Brazo: gira alrededor de su articulación.
    const w = arm ?? nearArm(x, y, z);
    if (w > 0) {
      const j = joints[x >= 0 ? 1 : -1];
      qa.copy(I).slerp(j.q, w);
      P.sub(j.c).applyQuaternion(qa).add(j.c);
    }
    // Torso: la altura (la de la camiseta puesta; en la manga, la del hombro)
    // dice cuánto gira con la cadera y cuánto con los hombros.
    const ye = w > 0 ? y + (joints[x >= 0 ? 1 : -1].c.y - y) * w : y;
    const u = smooth(HIPS_Y, CHEST_Y, ye);
    const yaw = rad(pose.hips + (pose.shoulders - pose.hips) * u - lag);
    P.applyAxisAngle(Y_AXIS, yaw);
    qt.setFromEuler(e.set(rad(pose.lean * u), 0, rad(-pose.side * u + pose.tilt * (1 - u))));
    P.sub(C).applyQuaternion(qt).add(C);
    return out.copy(P);
  };

  const geos = {};
  const parts = {};
  const out = new THREE.Vector3();
  for (const [key, g] of Object.entries(rest.geos)) {
    const p = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) p.setAttribute(name, name === 'position' || name === 'normal' ? attr.clone() : attr);
    p.setIndex(g.index);
    p.userData = g.userData;
    const pos = p.attributes.position.array;
    const src = g.attributes.position.array;
    // Mangas: por fila, desde la sisa (0) hasta el ruedo; el puño y su
    // dobladillo, enteros con el brazo.
    const sleeve = /^sleeve/.test(key) ? 0 : /^cuff.Lip$/.test(key) ? 2 : /^cuff/.test(key) ? 1 : -1;
    for (let v = 0; v < pos.length / 3; v++) {
      const x = src[v * 3];
      const y = src[v * 3 + 1];
      const z = src[v * 3 + 2];
      let arm = null;
      if (sleeve >= 0) {
        const r = sleeve === 2 ? 1 : (Math.floor(v / SW) + (sleeve ? SR : 0)) / SR;
        const w0 = nearArm(x, y, z);
        arm = w0 + (1 - w0) * smooth(0, ARM_RAMP, r);
      }
      place(x, y, z, arm, sleeve < 0, out).toArray(pos, v * 3);
    }
    geos[key] = p;
    parts[key] = { pos, idx: p.index.array, nrm: null };
  }
  // Normales como en buildShirt: por pieza y soldadas en las costuras.
  for (const part of Object.values(parts)) part.nrm = computeNormals(part.pos, part.idx);
  weldNormals(['front', 'back', 'sleeveL', 'sleeveR', 'cuffL', 'cuffR'].filter((k) => parts[k]).map((k) => parts[k]));
  for (const [key, g] of Object.entries(geos)) {
    g.attributes.normal.array.set(parts[key].nrm);
    g.computeBoundingBox();
  }
  return { ...rest, geos, rest, pose };
}
const Y_AXIS = new THREE.Vector3(0, 1, 0);
