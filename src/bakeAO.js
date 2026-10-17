// Oclusión ambiental precalculada por vértice (una vez, con la escena quieta):
// sombrea el interior de pliegues, axilas y cuello sin costo al girar.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const SAMPLES = 14;
const MAX_DIST = 0.09;

// Direcciones en el hemisferio con distribución coseno (Hammersley).
const DIRS = Array.from({ length: SAMPLES }, (_, i) => {
  let bits = i;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  const u = (i + 0.5) / SAMPLES;
  const v = bits / 4294967296;
  const r = Math.sqrt(u);
  const phi = 2 * Math.PI * v;
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u)];
});

export function ensureAOAttributes(geo) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.aoF || geo.attributes.aoF.count !== n) {
    geo.setAttribute('aoF', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    geo.setAttribute('aoB', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  }
}

function mergePositions(geos) {
  let nv = 0;
  let ni = 0;
  for (const g of geos) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    pos.set(p.array.subarray(0, p.count * 3), ov * 3);
    if (g.index) {
      const src = g.index.array;
      for (let k = 0; k < g.index.count; k++) idx[oi + k] = src[k] + ov;
      oi += g.index.count;
    } else {
      for (let k = 0; k < p.count; k++) idx[oi + k] = ov + k;
      oi += p.count;
    }
    ov += p.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  return merged;
}

/**
 * Calcula aoF (cara exterior) y aoB (cara interior) para cada geometría de
 * `targets`, usando todas las de `occluders` como obstáculos.
 * Cede el hilo cada tanto; `isCancelled` permite abortar.
 */
export async function bakeAO(targets, occluders, isCancelled = () => false) {
  const merged = mergePositions(occluders);
  const bvh = new MeshBVH(merged);
  const ray = new THREE.Ray();
  const n = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  let budget = 0;
  for (const geo of targets) {
    ensureAOAttributes(geo);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const out = [geo.attributes.aoF.array, geo.attributes.aoB.array];
    for (let v = 0; v < pos.count; v++) {
      p.fromBufferAttribute(pos, v);
      n.fromBufferAttribute(nor, v).normalize();
      // Base ortonormal girada al azar por vértice para evitar bandas.
      t1.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
      t2.crossVectors(n, t1);
      const rot = (Math.sin(v * 12.9898) * 43758.5453) % (Math.PI * 2);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1;
        let occ = 0;
        for (const [dx0, dy0, dz] of DIRS) {
          const dx = dx0 * c - dy0 * s;
          const dy = dx0 * s + dy0 * c;
          ray.direction.set(
            (t1.x * dx + t2.x * dy + n.x * dz) * sg,
            (t1.y * dx + t2.y * dy + n.y * dz) * sg,
            (t1.z * dx + t2.z * dy + n.z * dz) * sg,
          );
          ray.origin.copy(p).addScaledVector(n, 0.0015 * sg);
          const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, MAX_DIST);
          if (hit) occ += 1 - (hit.distance / MAX_DIST) ** 2;
        }
        out[side][v] = Math.max(0.2, 1 - (occ / SAMPLES) * 1.15);
      }
      if (++budget % 1500 === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (isCancelled()) return false;
      }
    }
    smoothAO(geo);
    geo.attributes.aoF.needsUpdate = true;
    geo.attributes.aoB.needsUpdate = true;
  }
  merged.dispose();
  return true;
}

// Promedia cada vértice con sus vecinos para suavizar el ruido del muestreo.
function smoothAO(geo) {
  const idx = geo.index.array;
  const n = geo.attributes.position.count;
  for (const name of ['aoF', 'aoB']) {
    const a = geo.attributes[name].array;
    const sum = new Float32Array(n);
    const cnt = new Float32Array(n);
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const i = idx[t + e];
        sum[i] += a[idx[t + ((e + 1) % 3)]] + a[idx[t + ((e + 2) % 3)]];
        cnt[i] += 2;
      }
    }
    for (let i = 0; i < n; i++) a[i] = (a[i] * 2 + sum[i] / Math.max(cnt[i], 1)) / 3;
  }
}
