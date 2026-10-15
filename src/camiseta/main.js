// Camiseta deportiva paramétrica: escena, materiales y controles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShirt, girth, DEFAULTS, flattenPrint } from './shirt.js';
import { makeHanger, makeClipHanger, HangingShirt } from './drape.js';
import { WEAVES, weaveTextures, weaveSwatch, makeRibNormalMap, makeFlatDetail, makeMacroMap, MACRO_TILE, makeUVMap } from './fabric.js';
import { templateSVG, readDesign, printTexture } from './print.js';
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
// Dos camisetas lado a lado (la misma, simulada una vez y dibujada dos
// veces): de entrada una muestra el frente y la otra la espalda; en
// Perfiles, cada una un costado, mirándose (de costado ocupan menos: se
// acercan). En cada vista: giro de cada una y distancia de su centro al medio.
const VIEWS = [
  { turn: [0, Math.PI], gap: 0.43 },
  { turn: [Math.PI / 2, -Math.PI / 2], gap: 0.22 },
];

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

const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
camera.position.set(0, -0.28, 2.15);
const PAIR_ASPECT = 1.7; // ancho / alto que ocupan las dos camisetas (con cuerpo, mangas abiertas)
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

// Luces que acompañan a la cámara: la camiseta siempre se ve bien iluminada
// desde donde se la mire. Cuatro ambientes:
// - Estudio: luz principal alta de costado, relleno suave y un contraluz.
// - Pareja: luz amplia de frente y sombras muy suaves; lo que mira de frente
//   se ve con el color elegido tal cual (para comparar colores).
// - Contraste: luz rasante de costado, casi sin relleno; marca el relieve de
//   la tela y los pliegues.
// - Día: sol cálido alto y cielo azulado, sombras más definidas.
const LIGHTS = {
  studio: { key: [0xfff7ee, 2.1, [1.3, 1.5, 0.4]], fill: [0xeef3ff, 0.55, [-1.8, 0.3, 0.3]], rim: [0xffffff, 0.8, [0.4, 1.6, -3]], hemi: [0xffffff, 0x9aa0a8, 0.45], env: 0.42, soft: 5 },
  soft: { key: [0xffffff, 0.84, [0.45, 0.7, 1]], fill: [0xffffff, 0.44, [-1.2, 0.25, 0.9]], rim: [0xffffff, 0.15, [0.4, 1.6, -3]], hemi: [0xffffff, 0xd4d7db, 0.4], env: 0.33, soft: 9 },
  contrast: { key: [0xfff1e2, 3.1, [2.4, 0.9, -0.15]], fill: [0xdfe8ff, 0.1, [-1.8, 0.3, 0.3]], rim: [0xffffff, 1.3, [-0.7, 1.4, -3]], hemi: [0xffffff, 0x6e737a, 0.16], env: 0.16, soft: 2 },
  day: { key: [0xfff0d8, 2.6, [1.1, 2.3, 0.7]], fill: [0xcfe0ff, 0.5, [-1.6, 0.6, 0.4]], rim: [0xfff6e8, 0.55, [0.4, 1.6, -3]], hemi: [0xcfe2ff, 0x8c8a7e, 0.6], env: 0.5, soft: 2.5 },
};
const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa0a8, 0.45);
scene.add(hemi);
const lightTarget = new THREE.Object3D();
lightTarget.position.copy(CENTER);
scene.add(lightTarget);
const key = new THREE.DirectionalLight();
key.target = lightTarget;
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.5, far: 6 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.006;
const fill = new THREE.DirectionalLight();
fill.target = lightTarget;
const rim = new THREE.DirectionalLight();
rim.target = lightTarget;
camera.add(key, fill, rim);
function applyLights(name) {
  const L = LIGHTS[name] || LIGHTS.studio;
  for (const [light, [color, intensity, at]] of [
    [key, L.key],
    [fill, L.fill],
    [rim, L.rim],
  ]) {
    light.color.set(color);
    light.intensity = intensity;
    light.position.set(...at);
  }
  hemi.color.set(L.hemi[0]);
  hemi.groundColor.set(L.hemi[1]);
  hemi.intensity = L.hemi[2];
  scene.environmentIntensity = L.env;
  key.shadow.radius = L.soft;
}

// ---------- materiales ----------

// Tela: un tejido (relieve, tono y brillo punto a punto) y cómo se ve según
// la calidad y el jaspeado. Los valores compartidos están en `shared`: al
// cambiar la tela se cambian una vez para todas las piezas.
const flatDetail = makeFlatDetail();
const ribNormal = makeRibNormalMap();
const shared = {
  macroMap: { value: makeMacroMap() },
  macroTile: { value: MACRO_TILE },
  feature: { value: 0.002 },
  roughAdd: { value: 0.05 },
  irregular: { value: 0 },
  pills: { value: 0 },
  pucker: { value: 0 },
  heather: { value: 0 },
  zoneOn: { value: 0 },
  zoneNormal: { value: flatDetail },
  zoneDetail: { value: flatDetail },
  zoneTile: { value: new THREE.Vector2(1, 1) },
};
function fabricMaterial(rib) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.9,
    metalness: 0,
    specularIntensity: 0.15,
    sheen: 0.35,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color(0xffffff),
    normalMap: ribNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    side: THREE.DoubleSide,
  });
  // Tono y aspereza punto a punto del tejido (el cuello acanalado no tiene).
  const own = { detailMap: { value: flatDetail }, detailTile: { value: new THREE.Vector2(1, 1) } };
  m.userData = { rib, own };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute vec2 seam;\nattribute float zone;\nvarying vec2 vSeam;\nvarying vec2 vCloth;\nvarying float vZone;\nvoid main() {\n vSeam = seam;\n vCloth = uv;\n vZone = zone;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec2 vSeam;
varying vec2 vCloth;
varying float vZone;
uniform sampler2D detailMap, macroMap, zoneNormal, zoneDetail;
uniform vec2 detailTile, zoneTile;
uniform float macroTile, feature, roughAdd, irregular, pills, pucker, heather, zoneOn;
void main() {
  // De lejos el relieve es más chico que un píxel: se pasa a aspereza (así
  // la tela no se ve plástica).
  vec2 fp = fwidth(vCloth);
  float fabricBlur = smoothstep(0.35, 1.6, max(fp.x, fp.y) / feature);
  // Dos copias a escalas distintas: juntas no se repiten.
  vec3 macro = texture2D(macroMap, vCloth / macroTile).rgb;
  vec3 macro2 = texture2D(macroMap, vCloth / (macroTile * 1.618) + vec2(0.37, 0.71)).rgb;
  macro.r = 0.5 * (macro.r + macro2.r);
  macro.b = max(macro.b, macro2.b);
  vec4 det = texture2D(detailMap, vCloth / detailTile);
  float inZone = zoneOn * vZone;
  if (inZone > 0.001) det = mix(det, texture2D(zoneDetail, vCloth / zoneTile), inZone);
  float pill = smoothstep(0.35, 0.8, macro.g) * pills;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  // Estampado (o mapa de piezas) sobre el color de la pieza, según su
  // opacidad; por dentro apenas se trasluce.
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  diffuseColor.rgb = mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a * (gl_FrontFacing ? 1.0 : 0.3));
#endif`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // Tono del tejido, hilos jaspeados, irregularidad del teñido y bolitas.
  diffuseColor.rgb *= 0.5 + det.r;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vec3(0.78), 0.55), heather * macro.b);
  diffuseColor.rgb *= 1.0 + (macro.r - 0.5) * (0.05 + 0.12 * irregular);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.15 + 0.025, pill * 0.7);
  // Costuras: un hundido fino y la tela apenas levantada al lado (fruncida
  // en la tela económica).
  float groove = 1.0 - smoothstep(0.0005, 0.0016, vSeam.x);
  float ridge = smoothstep(0.0016, 0.0028, vSeam.x) * (1.0 - smoothstep(0.0028, 0.0055, vSeam.x));
  diffuseColor.rgb *= 1.0 - 0.34 * groove + 0.05 * ridge;
  float nearSeam = 1.0 - smoothstep(0.003, 0.013, vSeam.x);
  diffuseColor.rgb *= 1.0 + pucker * nearSeam * 0.08 * sin((vCloth.x + vCloth.y) * 6.2832 / 0.011);
  // Pespunte doble del ruedo y de los puños.
  float line = max(1.0 - smoothstep(0.0002, 0.00055, abs(vSeam.y - 0.0125)), 1.0 - smoothstep(0.0002, 0.00055, abs(vSeam.y - 0.0185)));
  float dash = smoothstep(0.25, 0.35, fract(vCloth.x / 0.004)) * (1.0 - smoothstep(0.75, 0.85, fract(vCloth.x / 0.004)));
  diffuseColor.rgb *= 1.0 - 0.22 * line * dash;
  // Por dentro la tela queda en sombra.
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.72;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor + (det.g - 0.5) * 0.5 + roughAdd * fabricBlur + pill * 0.15, 0.04, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  if (inZone > 0.001) mapN = mix(mapN, texture2D(zoneNormal, vCloth / zoneTile).xyz * 2.0 - 1.0, inZone);
  mapN.xy *= normalScale * (1.0 + (macro.r - 0.5) * 1.2 * irregular) * (1.0 - 0.5 * fabricBlur);
  normal = normalize(tbn * mapN);`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  if (!gl_FrontFacing) { reflectedLight.indirectDiffuse *= 0.45; reflectedLight.indirectSpecular *= 0.3; }`,
      );
  };
  return m;
}

// Cómo devuelve la luz según la calidad: económica (brillo plástico),
// estándar y premium (mate con un brillo suave y parejo). El algodón tiene
// algo más de pelusa (brillo suave) que el poliéster.
const FINISH = [
  { roughness: 0.68, specularIntensity: 0.48, sheen: 0.12, sheenRoughness: 0.8 },
  { roughness: 0.9, specularIntensity: 0.15, sheen: 0.35, sheenRoughness: 0.75 },
  { roughness: 0.87, specularIntensity: 0.2, sheen: 0.62, sheenRoughness: 0.55 },
];
const unit = (x) => Math.min(1, Math.max(0, x));
function applyFabric() {
  const w = WEAVES[fabric.weave] || WEAVES.mesh;
  const t = weaveTextures(WEAVES[fabric.weave] ? fabric.weave : 'mesh');
  const q = unit(fabric.quality);
  shared.feature.value = w.feature;
  shared.roughAdd.value = w.roughAdd;
  shared.irregular.value = unit((0.5 - q) * 2);
  shared.pills.value = unit((0.35 - q) / 0.35);
  shared.pucker.value = unit((0.4 - q) / 0.4);
  shared.heather.value = unit(fabric.heather);
  shared.zoneOn.value = t.zone ? 1 : 0;
  if (t.zone) {
    shared.zoneNormal.value = t.zone.normal;
    shared.zoneDetail.value = t.zone.detail;
    shared.zoneTile.value.set(...w.zone.tile);
  }
  const [a, b, f] = q < 0.5 ? [FINISH[0], FINISH[1], q * 2] : [FINISH[1], FINISH[2], q * 2 - 1];
  const cotton = w.fiber === 'cotton' ? 1 : 0;
  for (const mesh of Object.values(meshes)) {
    const m = mesh.material;
    for (const k of Object.keys(a)) m[k] = a[k] + (b[k] - a[k]) * f;
    m.sheen += 0.08 * cotton;
    m.roughness = Math.min(1, m.roughness + 0.02 * cotton);
    if (m.userData.rib) continue;
    m.normalMap = t.normal;
    const s = w.scale * (0.85 + 0.3 * q);
    m.normalScale.set(s, s);
    m.userData.own.detailMap.value = t.detail;
    m.userData.own.detailTile.value.set(...w.tile);
  }
  requestRender();
}

// ---------- estado ----------

// Configuración opcional escrita en la página (así se adapta la camiseta sin
// tocar el código): <script type="application/json" id="camiseta-config">
// { "params": {...}, "colors": {...}, "fabric": {...}, "light": "studio",
//   "mode": "hanger", "spin": false, "uvmap": false, "design": "<svg…>" }
const CONFIG = (() => {
  try {
    return JSON.parse(document.getElementById('camiseta-config')?.textContent || '{}');
  } catch {
    return {};
  }
})();
// Tela: tejido (ver WEAVES en fabric.js), calidad (0 económica · 0,5
// estándar · 1 premium), peso (0 liviana · 1 pesada) y jaspeado (0 a 1).
const FABRIC = { weave: 'mesh', quality: 0.5, weight: 0.5, heather: 0 };
const BASE_PARAMS = { ...DEFAULTS, ...CONFIG.params };
const BASE_COLORS = { ...COLORS, ...CONFIG.colors };
const BASE_FABRIC = { ...FABRIC, ...CONFIG.fabric };
const BASE_LIGHT = CONFIG.light in LIGHTS ? CONFIG.light : 'studio';
const params = { ...BASE_PARAMS };
const colors = { ...BASE_COLORS };
const fabric = { ...BASE_FABRIC };
const view = { spin: !!CONFIG.spin, uvmap: !!CONFIG.uvmap, mode: 'body', light: BASE_LIGHT }; // body: con cuerpo · hanger: en percha · clips: con broches

// Cada camiseta (con su percha o sus broches) cuelga de su soporte, que la
// ubica y la gira; adentro, las coordenadas son las de la simulación.
const rigs = [-1, 1].map((side, i) => {
  const rig = new THREE.Group();
  rig.position.x = side * VIEWS[0].gap;
  rig.rotation.y = VIEWS[0].turn[i];
  scene.add(rig);
  return rig;
});
// Piezas de la tela: las de la primera camiseta y sus gemelas (misma
// geometría y material).
const meshes = {};
const twins = {};
for (const [k, def] of Object.entries(PARTS)) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), fabricMaterial(def.rib));
  const twin = new THREE.Mesh(mesh.geometry, mesh.material);
  [mesh, twin].forEach((m, i) => {
    m.castShadow = m.receiveShadow = true;
    m.userData.rig = rigs[i];
    rigs[i].add(m);
  });
  meshes[k] = mesh;
  twins[k] = twin;
}
const clothMeshes = [...Object.values(meshes), ...Object.values(twins)];
const uvMaps = {};
// Diseño cargado: una textura de estampado por pieza.
const design = { textures: {}, found: [] };
// Molde del frente y la espalda para el estampado: se calcula sólo con un
// diseño cargado o al bajar la plantilla (tarda). Al cambiar una medida se
// usa enseguida el molde anterior (la grilla es la misma) y, cuando el
// control queda quieto, se recalcula partiendo de él.
let lastFlat = null;
let flatTimer = 0;
function ensureFlat() {
  clearTimeout(flatTimer);
  flattenPrint(built, lastFlat);
  lastFlat = built;
}
function followFlat() {
  if (!lastFlat || !Object.keys(design.textures).length) return;
  for (const k of ['front', 'back']) built.geos[k].attributes.uv1.array.set(lastFlat.geos[k].attributes.uv1.array);
  clearTimeout(flatTimer);
  flatTimer = setTimeout(() => {
    ensureFlat();
    requestRender();
  }, 180);
}

// Percha o broches (sólo en la versión colgada), uno por camiseta.
const supportMaterials = {
  wood: new THREE.MeshStandardMaterial({ color: 0xb48a60, roughness: 0.62, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.35, metalness: 0.85 }),
  plastic: new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.55, metalness: 0.1 }),
};
const supports = rigs.map((rig) => {
  const group = new THREE.Group();
  const parts = {};
  for (const [k, mat] of Object.entries(supportMaterials)) {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    parts[k] = m;
  }
  rig.add(group);
  return { group, parts };
});
const hanging = () => view.mode !== 'body';

let built = null;
let drape = null;
function rebuild() {
  built = buildShirt(params);
  for (const [k, mesh] of Object.entries(meshes)) {
    mesh.geometry.dispose();
    mesh.geometry = twins[k].geometry = built.geos[k];
  }
  followFlat();
  // Colgada: la tela arranca con la forma puesta y cae (sobre la percha, o
  // sostenida por los broches).
  drape = null;
  for (const sp of supports) sp.group.visible = hanging();
  if (hanging()) {
    let support;
    if (view.mode === 'hanger') {
      support = makeHanger(built.measures);
      drape = new HangingShirt(built, support, { weight: fabric.weight });
    } else {
      drape = new HangingShirt(built, { kind: 'clips' }, { weight: fabric.weight });
      support = makeClipHanger(drape.clips);
    }
    for (const k of Object.keys(supportMaterials)) {
      supports[0].parts[k].geometry.dispose();
      supports[0].parts[k].geometry = supports[1].parts[k].geometry = support[k] || new THREE.BufferGeometry();
    }
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
    if (!view.uvmap && design.textures[k]) {
      m.map = design.textures[k];
      m.color.set(colors[def.color]);
    } else if (view.uvmap && def.label) {
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
// Tela (fuera de la forma: cambiarla no rehace la camiseta, salvo el peso
// colgada).
const FOUT = {
  quality: (v) => (v < 0.3 ? 'Económica' : v < 0.7 ? 'Estándar' : 'Premium'),
  weight: (v) => `${Math.round(120 + 100 * v)} g/m²`,
  heather: (v) => (v < 0.05 ? 'Sin jaspeado' : v < 0.5 ? 'Suave' : 'Marcado'),
};
// Escote según el tipo de cuello: mínimo, máximo y valor al elegirlo.
const NECK = { round: [0.055, 0.12, 0.085], v: [0.07, 0.13, 0.09] };
const sliders = {};
const fabricSliders = {};
function setFill(input) {
  const f = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', `${f}%`);
}
function syncControls() {
  const [lo, hi] = NECK[params.neckStyle] || NECK.round;
  sliders.neckDepth.min = lo;
  sliders.neckDepth.max = hi;
  params.neckDepth = Math.min(hi, Math.max(lo, params.neckDepth));
  for (const [k, input] of Object.entries(sliders)) {
    input.value = params[k];
    document.getElementById(`${k}-out`).textContent = OUT[k](params[k]);
    setFill(input);
  }
  for (const [k, input] of Object.entries(fabricSliders)) {
    input.value = fabric[k];
    document.getElementById(`${k}-out`).textContent = FOUT[k](fabric[k]);
    setFill(input);
  }
  neckButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.neck === (params.neckStyle === 'v' ? 'v' : 'round'))));
  weaveButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weave === fabric.weave)));
  document.getElementById('weave-note').textContent = (WEAVES[fabric.weave] || WEAVES.mesh).note;
  lightButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.light === view.light)));
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
// Tipo de cuello: al cambiarlo, el escote vuelve al valor típico de ese
// cuello.
const neckButtons = [...document.querySelectorAll('[data-neck]')];
neckButtons.forEach((b) =>
  b.addEventListener('click', () => {
    if (params.neckStyle === b.dataset.neck) return;
    params.neckStyle = b.dataset.neck;
    params.neckDepth = NECK[params.neckStyle][2];
    syncControls();
    scheduleRebuild();
  }),
);
// Tejidos: un botón con una muestra del relieve para cada uno.
const weaveBox = document.querySelector('.weaves');
const weaveButtons = Object.entries(WEAVES).map(([k, w]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.weave = k;
  b.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  img.alt = '';
  img.src = weaveSwatch(k);
  const label = document.createElement('span');
  label.textContent = w.label;
  b.append(img, label);
  b.addEventListener('click', () => {
    fabric.weave = k;
    syncControls();
    applyFabric();
    updateSpec();
  });
  weaveBox.append(b);
  return b;
});
for (const k of Object.keys(FOUT)) {
  const input = document.getElementById(k);
  fabricSliders[k] = input;
  input.addEventListener('input', () => {
    fabric[k] = Number(input.value);
    document.getElementById(`${k}-out`).textContent = FOUT[k](fabric[k]);
    setFill(input);
    applyFabric();
    updateSpec();
    // El peso cambia cómo cae: colgada, se vuelve a soltar.
    if (k === 'weight' && hanging()) scheduleRebuild();
  });
}
// Luz.
const lightButtons = [...document.querySelectorAll('[data-light]')];
function setLight(name) {
  view.light = LIGHTS[name] ? name : 'studio';
  applyLights(view.light);
  lightButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.light === view.light)));
  requestRender();
}
lightButtons.forEach((b) => b.addEventListener('click', () => setLight(b.dataset.light)));
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
// Presentación: con cuerpo (forma fija) o colgada, en percha o con broches
// (tela simulada).
const modeButtons = [...document.querySelectorAll('.mode button')];
function setMode(mode) {
  // La colgada queda más baja (el gancho arriba, la tela estirada por su
  // peso): la vista se centra un poco más abajo.
  const dy = (mode === 'body' ? CENTER.y : -0.4) - controls.target.y;
  controls.target.y += dy;
  camera.position.y += dy;
  lightTarget.position.y = controls.target.y;
  controls.update();
  view.mode = mode;
  modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelector('.hint').textContent =
    mode === 'body'
      ? 'Arrastrá para girar · rueda o pellizco para acercar'
      : matchMedia('(hover: none)').matches
        ? 'Tocá la tela para moverla · arrastrá para girar'
        : 'Pasá el mouse sobre la tela para moverla · arrastrá para girar';
  rebuild();
}
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// El mouse empuja la tela al pasar y levanta una brisa suave. Se toca
// cualquiera de las dos camisetas: el punto y las direcciones pasan a las
// coordenadas de la simulación (las de adentro de su soporte).
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const unturn = new THREE.Quaternion();
function pickCloth(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(clothMeshes, false)[0];
  if (!hit) return null;
  const rig = hit.object.userData.rig;
  rig.updateMatrixWorld();
  unturn.copy(rig.quaternion).invert();
  return { point: rig.worldToLocal(hit.point.clone()), local: (v) => v.applyQuaternion(unturn) };
}
let lastMove = null;
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drape || e.buttons || e.pointerType === 'touch') {
    lastMove = null;
    return;
  }
  const now = performance.now();
  const dx = lastMove ? e.clientX - lastMove.x : 0;
  const dy = lastMove ? e.clientY - lastMove.y : 0;
  const dtm = lastMove ? Math.max(now - lastMove.t, 8) : 16;
  lastMove = { x: e.clientX, y: e.clientY, t: now };
  const speed = Math.hypot(dx, dy) / dtm; // px/ms
  if (speed < 0.02) return;
  const hit = pickCloth(e);
  if (!hit) return;
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  camUp.setFromMatrixColumn(camera.matrixWorld, 1);
  const dir = raycaster.ray.direction.clone().multiplyScalar(0.8).addScaledVector(camRight, dx * 0.02).addScaledVector(camUp, -dy * 0.02).normalize();
  drape.push(hit.point, hit.local(dir), Math.min(0.004, speed * 0.0016));
  drape.breeze(hit.local(camRight.multiplyScalar(dx * 0.008).addScaledVector(camUp, -dy * 0.008).addScaledVector(raycaster.ray.direction, speed * 0.15)));
});
renderer.domElement.addEventListener('pointerleave', () => (lastMove = null));
// En pantallas táctiles, un toque sobre la tela la empuja.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!drape || e.pointerType !== 'touch') return;
  const hit = pickCloth(e);
  if (!hit) return;
  drape.push(hit.point, hit.local(raycaster.ray.direction.clone()), 0.005, 0.09);
  drape.breeze(hit.local(raycaster.ray.direction.clone().multiplyScalar(0.6)));
});

// Diseño: plantilla con todas las piezas (para la camiseta tal como está) y
// carga del SVG diseñado sobre ella (botón o arrastrando el archivo).
const designNote = document.getElementById('design-note');
const designClear = document.getElementById('design-clear');
// Publicada en claude.ai, la descarga pasa por la capacidad `downloads` (la
// persona confirma); sola o en desarrollo, un enlace de descarga común.
const downloadsP = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
async function download(name, text, type) {
  const dl = await downloadsP;
  if (dl) {
    try {
      await dl.save({ filename: name, data: text });
      return;
    } catch (e) {
      if (e?.code === 'declined' || e?.code === 'rate_limited') return;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById('template').addEventListener('click', () => {
  ensureFlat();
  download('plantilla-camiseta.svg', templateSVG(built, params, colors), 'image/svg+xml');
});
function clearDesign() {
  for (const t of Object.values(design.textures)) t.dispose();
  design.textures = {};
  design.found = [];
  designClear.hidden = true;
}
async function loadDesign(text, name = 'diseño') {
  designNote.textContent = `Leyendo ${name}…`;
  try {
    const { canvases, found } = await readDesign(text);
    clearDesign();
    ensureFlat();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    for (const [k, c] of Object.entries(canvases)) design.textures[k] = printTexture(k, c, Math.min(8, aniso));
    design.found = found;
    designClear.hidden = !found.length;
    designNote.textContent = found.length ? `Diseño en: ${found.join(', ')}.` : 'El SVG no tiene nada dentro de los recuadros de la plantilla.';
    if (view.uvmap) {
      view.uvmap = false;
      document.getElementById('uvmap').checked = false;
    }
  } catch (e) {
    designNote.textContent = e.message || 'No se pudo leer el SVG.';
  }
  applyLook();
}
const designFile = document.getElementById('design-file');
document.getElementById('design-load').addEventListener('click', () => designFile.click());
designFile.addEventListener('change', async () => {
  const f = designFile.files[0];
  if (f) await loadDesign(await f.text(), f.name);
  designFile.value = '';
});
designClear.addEventListener('click', () => {
  clearDesign();
  designNote.textContent = '';
  applyLook();
});
stage.addEventListener('dragover', (e) => {
  if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
  e.preventDefault();
  stage.classList.add('dropping');
});
stage.addEventListener('dragleave', () => stage.classList.remove('dropping'));
stage.addEventListener('drop', async (e) => {
  e.preventDefault();
  stage.classList.remove('dropping');
  const f = [...e.dataTransfer.files].find((x) => /\.svg$/i.test(x.name) || x.type === 'image/svg+xml');
  if (f) await loadDesign(await f.text(), f.name);
});

document.getElementById('reset').addEventListener('click', () => {
  Object.assign(params, BASE_PARAMS);
  Object.assign(colors, BASE_COLORS);
  Object.assign(fabric, BASE_FABRIC);
  setLight(BASE_LIGHT);
  syncControls();
  applyFabric();
  rebuild();
});

function updateSpec() {
  const M = built.measures;
  document.getElementById('s-chest').textContent = fmtCm(girth(M, M.pitY - 0.03));
  document.getElementById('s-shoulders').textContent = fmtCm(M.shA * 2);
  document.getElementById('s-length').textContent = fmtCm(M.L);
  document.getElementById('s-sleeve').textContent = fmtCm(Math.PI * 2 * M.sleeve.rHem);
  document.getElementById('s-fabric').textContent = `${(WEAVES[fabric.weave] || WEAVES.mesh).label} · ${FOUT.weight(fabric.weight)}`;
}

// Vistas: frente y espalda, o los dos perfiles. Giran las camisetas (por el
// camino más corto) y la cámara vuelve al frente.
const viewButtons = [...document.querySelectorAll('.views button')];
let turn = null;
const shortest = (d) => Math.atan2(Math.sin(d), Math.cos(d));
function goToView(i) {
  const off = camera.position.clone().sub(controls.target);
  const from = Math.atan2(off.x, off.z);
  turn = {
    from,
    d: shortest(-from),
    r: Math.hypot(off.x, off.z),
    y: off.y,
    rigs: rigs.map((rig, j) => [rig.rotation.y, shortest(VIEWS[i].turn[j] - rig.rotation.y)]),
    gap: [Math.abs(rigs[0].position.x), VIEWS[i].gap - Math.abs(rigs[0].position.x)],
    t0: performance.now(),
  };
  viewButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  requestRender();
}
function placeRigs(e) {
  const gap = turn.gap[0] + turn.gap[1] * e;
  rigs.forEach((rig, j) => {
    rig.rotation.y = turn.rigs[j][0] + turn.rigs[j][1] * e;
    rig.position.x = (j ? 1 : -1) * gap;
  });
}
viewButtons.forEach((b, i) => b.addEventListener('click', () => goToView(i)));
viewButtons[0].setAttribute('aria-pressed', 'true');
// Si se arrastra durante el giro, las camisetas terminan de girar de golpe.
controls.addEventListener('start', () => {
  if (turn) placeRigs(1);
  turn = null;
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
  // Si la pantalla es más angosta que el par de camisetas, se abre el
  // ángulo para que entren las dos.
  camera.fov = w / h < PAIR_ASPECT ? 28 * (PAIR_ASPECT / Math.max(w / h, 0.45)) ** 0.8 : 28;
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
    placeRigs(e);
    if (k >= 1) turn = null;
    needsRender = true;
  }
  if (controls.update() || controls.autoRotate) needsRender = true;
  if (drape && !drape.sleeping) {
    drape.step(1 / 60);
    drape.updateMeshes();
    needsRender = true;
  }
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
});

syncControls();
applyLights(view.light);
applyFabric();
document.getElementById('spin').checked = view.spin;
document.getElementById('uvmap').checked = view.uvmap;
controls.autoRotate = view.spin;
if (CONFIG.mode === 'hanger' || CONFIG.mode === 'clips') setMode(CONFIG.mode);
else rebuild();
resize();
if (typeof CONFIG.design === 'string' && CONFIG.design.includes('<svg')) loadDesign(CONFIG.design);

window.__camiseta = { params, colors, fabric, rebuild, applyLook, applyFabric, setLight, syncControls, camera, controls, scene, meshes, rigs, view, goToView, setMode, loadDesign, templateSVG: () => (ensureFlat(), templateSVG(built, params, colors)), design, drape: () => drape };
