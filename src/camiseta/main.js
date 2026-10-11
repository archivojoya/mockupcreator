// Camiseta deportiva paramétrica: escena, materiales y controles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShirt, girth, DEFAULTS } from './shirt.js';
import { makeMeshNormalMap, makeRibNormalMap, makeUVMap, MESH_TILE, RIB_TILE } from './fabric.js';
import './style.css';

const COLORS = { body: '#c81e3a', sleeves: '#c81e3a', collar: '#17191d', cuffs: '#17191d' };
// Pieza → grupo de color, textura de relieve y nombre en el mapa de estampado.
const PARTS = {
  front: { color: 'body', label: 'FRENTE' },
  back: { color: 'body', label: 'ESPALDA' },
  hem: { color: 'body' },
  sleeveL: { color: 'sleeves', label: 'MANGA IZQ.' },
  sleeveR: { color: 'sleeves', label: 'MANGA DER.' },
  cuffL: { color: 'cuffs', label: 'PUÑO' },
  cuffR: { color: 'cuffs', label: 'PUÑO' },
  cuffLLip: { color: 'cuffs' },
  cuffRLip: { color: 'cuffs' },
  collar: { color: 'collar', label: 'CUELLO', rib: true },
};
const CENTER = new THREE.Vector3(0, -0.36, 0);

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 0);
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
camera.position.set(0, -0.28, 2.15);
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(CENTER);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.8;
controls.maxDistance = 3.4;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 2.35;
controls.autoRotateSpeed = 1.6;
controls.update();

// Luces de estudio que acompañan a la cámara: la camiseta siempre se ve bien
// iluminada desde donde se la mire.
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 0.45));
const lightTarget = new THREE.Object3D();
lightTarget.position.copy(CENTER);
scene.add(lightTarget);
const key = new THREE.DirectionalLight(0xfff7ee, 2.1);
key.position.set(1.3, 1.5, 0.4);
key.target = lightTarget;
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.5, far: 6 });
key.shadow.radius = 5;
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.006;
const fill = new THREE.DirectionalLight(0xeef3ff, 0.55);
fill.position.set(-1.8, 0.3, 0.3);
fill.target = lightTarget;
const rim = new THREE.DirectionalLight(0xffffff, 0.8);
rim.position.set(0.4, 1.6, -3);
rim.target = lightTarget;
camera.add(key, fill, rim);

// ---------- materiales ----------

const meshNormal = makeMeshNormalMap();
const ribNormal = makeRibNormalMap();
meshNormal.repeat.set(1 / MESH_TILE, 1 / MESH_TILE);
ribNormal.repeat.set(1 / RIB_TILE, 1 / RIB_TILE);

function fabricMaterial(rib) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.9,
    metalness: 0,
    specularIntensity: 0.15,
    sheen: 0.35,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xffffff),
    normalMap: rib ? ribNormal : meshNormal,
    normalScale: new THREE.Vector2(rib ? 0.55 : 0.35, rib ? 0.55 : 0.35),
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute vec2 seam;\nvarying vec2 vSeam;\nvarying vec2 vCloth;\nvoid main() {\n vSeam = seam;\n vCloth = uv;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec2 vSeam;\nvarying vec2 vCloth;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // Costuras: un hundido fino y la tela apenas levantada al lado.
  float groove = 1.0 - smoothstep(0.0005, 0.0016, vSeam.x);
  float ridge = smoothstep(0.0016, 0.0028, vSeam.x) * (1.0 - smoothstep(0.0028, 0.0055, vSeam.x));
  diffuseColor.rgb *= 1.0 - 0.34 * groove + 0.05 * ridge;
  // Pespunte doble del ruedo y de los puños.
  float line = max(1.0 - smoothstep(0.0002, 0.00055, abs(vSeam.y - 0.0125)), 1.0 - smoothstep(0.0002, 0.00055, abs(vSeam.y - 0.0185)));
  float dash = smoothstep(0.25, 0.35, fract(vCloth.x / 0.004)) * (1.0 - smoothstep(0.75, 0.85, fract(vCloth.x / 0.004)));
  diffuseColor.rgb *= 1.0 - 0.22 * line * dash;
  // Por dentro la tela queda en sombra.
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.72;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  if (!gl_FrontFacing) { reflectedLight.indirectDiffuse *= 0.45; reflectedLight.indirectSpecular *= 0.3; }`,
      );
  };
  return m;
}

// ---------- estado ----------

const params = { ...DEFAULTS };
const colors = { ...COLORS };
const view = { spin: false, uvmap: false };

const shirt = new THREE.Group();
scene.add(shirt);
const meshes = {};
for (const [k, def] of Object.entries(PARTS)) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), fabricMaterial(def.rib));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  shirt.add(mesh);
  meshes[k] = mesh;
}
const uvMaps = {};

let built = null;
function rebuild() {
  built = buildShirt(params);
  for (const [k, mesh] of Object.entries(meshes)) {
    mesh.geometry.dispose();
    mesh.geometry = built.geos[k];
  }
  applyLook();
  updateSpec();
  requestRender();
}

// Colores, o el mapa de estampado (grilla con el nombre de cada pieza).
function applyLook() {
  for (const [k, mesh] of Object.entries(meshes)) {
    const def = PARTS[k];
    const m = mesh.material;
    if (view.uvmap && def.label) {
      const uv = mesh.geometry.attributes.uv.array;
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (let i = 0; i < uv.length; i += 2) {
        u0 = Math.min(u0, uv[i]);
        u1 = Math.max(u1, uv[i]);
        v0 = Math.min(v0, uv[i + 1]);
        v1 = Math.max(v1, uv[i + 1]);
      }
      if (!uvMaps[k]) uvMaps[k] = makeUVMap(def.label, [u1 - u0, v1 - v0]);
      const t = uvMaps[k];
      t.repeat.set(1 / (u1 - u0), 1 / (v1 - v0));
      t.offset.set(-u0 / (u1 - u0), -v0 / (v1 - v0));
      m.map = t;
      m.color.set(0xffffff);
    } else {
      m.map = null;
      m.color.set(view.uvmap ? '#cfcac0' : colors[def.color]);
    }
    m.needsUpdate = true;
  }
  requestRender();
}

// ---------- controles ----------

const fmtCm = (m) => `${Math.round(m * 100)} cm`;
const OUT = {
  fit: (v) => (v < 0.3 ? 'Ajustado' : v < 0.7 ? 'Regular' : 'Holgado'),
  length: fmtCm,
  sleeveLength: fmtCm,
  sleeveAngle: (v) => `${Math.round(v)}°`,
  neckDepth: (v) => `${(v * 100).toFixed(1).replace('.', ',')} cm`,
};
const sliders = {};
function setFill(input) {
  const f = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${f}%`);
}
function syncControls() {
  for (const [k, input] of Object.entries(sliders)) {
    input.value = params[k];
    document.getElementById(`${k}-out`).textContent = OUT[k](params[k]);
    setFill(input);
  }
  for (const [k, id] of Object.entries({ body: 'c-body', sleeves: 'c-sleeves', collar: 'c-collar', cuffs: 'c-cuffs' })) document.getElementById(id).value = colors[k];
}
let pending = false;
function scheduleRebuild() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    rebuild();
  });
}
for (const k of Object.keys(OUT)) {
  const input = document.getElementById(k);
  sliders[k] = input;
  input.addEventListener('input', () => {
    params[k] = Number(input.value);
    document.getElementById(`${k}-out`).textContent = OUT[k](params[k]);
    setFill(input);
    scheduleRebuild();
  });
}
for (const [k, id] of Object.entries({ body: 'c-body', sleeves: 'c-sleeves', collar: 'c-collar', cuffs: 'c-cuffs' })) {
  document.getElementById(id).addEventListener('input', (e) => {
    colors[k] = e.target.value;
    applyLook();
  });
}
document.getElementById('spin').addEventListener('change', (e) => {
  view.spin = e.target.checked;
  controls.autoRotate = view.spin;
  requestRender();
});
document.getElementById('uvmap').addEventListener('change', (e) => {
  view.uvmap = e.target.checked;
  applyLook();
});
document.getElementById('reset').addEventListener('click', () => {
  Object.assign(params, DEFAULTS);
  Object.assign(colors, COLORS);
  syncControls();
  rebuild();
});

function updateSpec() {
  const M = built.measures;
  document.getElementById('s-chest').textContent = fmtCm(girth(M, M.pitY - 0.03));
  document.getElementById('s-shoulders').textContent = fmtCm(M.shA * 2);
  document.getElementById('s-length').textContent = fmtCm(M.L);
  document.getElementById('s-sleeve').textContent = fmtCm(Math.PI * 2 * M.sleeve.rHem);
}

// Vistas rápidas: frente, perfil y espalda (giro animado de la cámara).
const viewButtons = [...document.querySelectorAll('.views button')];
let turn = null;
function goToView(i) {
  const off = camera.position.clone().sub(controls.target);
  const r = Math.hypot(off.x, off.z);
  const from = Math.atan2(off.x, off.z);
  let to = [0, Math.PI / 2, Math.PI][i];
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  turn = { from, d, r, y: off.y, t0: performance.now() };
  viewButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  requestRender();
}
viewButtons.forEach((b, i) => b.addEventListener('click', () => goToView(i)));
viewButtons[0].setAttribute('aria-pressed', 'true');
controls.addEventListener('start', () => {
  turn = null;
  viewButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
});

// ---------- dibujo ----------

let needsRender = true;
function requestRender() {
  needsRender = true;
}
controls.addEventListener('change', requestRender);

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // En pantallas angostas, se aleja un poco para que entre entera.
  camera.fov = w / h < 0.8 ? 28 * (0.8 / Math.max(w / h, 0.45)) ** 0.8 : 28;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(stage);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
renderer.setAnimationLoop((now) => {
  if (turn) {
    const k = reduceMotion.matches ? 1 : Math.min(1, (now - turn.t0) / 650);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    const a = turn.from + turn.d * e;
    camera.position.set(controls.target.x + Math.sin(a) * turn.r, controls.target.y + turn.y, controls.target.z + Math.cos(a) * turn.r);
    if (k >= 1) turn = null;
    needsRender = true;
  }
  if (controls.update() || controls.autoRotate) needsRender = true;
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
});

syncControls();
rebuild();
resize();

window.__camiseta = { params, colors, rebuild, applyLook, camera, controls, scene, meshes, view, goToView };
