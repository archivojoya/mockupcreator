// Camiseta deportiva paramétrica: escena, materiales y controles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShirt, girth, DEFAULTS, flattenPrint } from './shirt.js';
import { makeHanger, makeClipHanger, HangingShirt, RAIL_R } from './drape.js';
import { WEAVES, weaveTextures, weaveSwatch, makeRibNormalMap, makeFlatDetail, makeMacroMap, MACRO_TILE, makeUVMap } from './fabric.js';
import { templateSVG, readDesign, printTexture, readPieces, isolateLayer, placePiece, placeTape, pieceSizes, buildApplique, KINDS } from './print.js';
import './style.css';

const COLORS = { body: '#c81e3a', sleeves: '#c81e3a', collar: '#17191d', cuffs: '#17191d' };
// Pieza → grupo de color, textura de relieve y nombre en el mapa de estampado.
// Los dobladillos (`lining`) van del color del revés de su pieza.
const PARTS = {
  front: { color: 'body', label: 'FRENTE' },
  back: { color: 'body', label: 'ESPALDA' },
  hem: { color: 'body', lining: 'front' },
  sleeveL: { color: 'sleeves', label: 'MANGA IZQ.' },
  sleeveR: { color: 'sleeves', label: 'MANGA DER.' },
  cuffL: { color: 'cuffs', label: 'PUÑO' },
  cuffR: { color: 'cuffs', label: 'PUÑO' },
  cuffLLip: { color: 'cuffs', lining: 'cuffL' },
  cuffRLip: { color: 'cuffs', lining: 'cuffR' },
  collar: { color: 'collar', label: 'CUELLO', rib: true },
  // Vivos de las sisas (sin mangas): acanalados, del color del cuello.
  armL: { color: 'collar', rib: true },
  armR: { color: 'collar', rib: true },
};
const NO_GEO = new THREE.BufferGeometry();
const CENTER = new THREE.Vector3(0, -0.36, 0);
const HANG_Y = -0.38; // centro de la vista colgada
const CAM_OFF = new THREE.Vector3(0, 0.08, 2.15); // cámara respecto del centro, de entrada
// Dos camisetas lado a lado (la misma, simulada una vez y dibujada dos
// veces): de entrada una muestra el frente y la otra la espalda; en
// Perfiles, cada una un costado, mirándose (de costado ocupan menos: se
// acercan). En cada vista: giro de cada una y distancia de su centro al medio
// (se ajusta al ancho de la camiseta: quedan a PAIR_MARGIN de tocarse, aunque
// una gire).
const VIEWS = [
  { turn: [0, Math.PI], gap: 0.39 },
  { turn: [Math.PI / 2, -Math.PI / 2], gap: 0.22 },
];
const PAIR_MARGIN = 0.025;
// Giro de cada camiseta con el puntero (radianes por píxel) y sola (rad/s).
const SPIN_PX = 0.009;
const SPIN_SPEED = 0.17;

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

const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 20);
camera.position.copy(CENTER).add(CAM_OFF);
// Ancho / alto que ocupan las dos camisetas (con cuerpo, mangas abiertas): se
// ajusta al ancho de la prenda (ver fitPair).
let pairAspect = 1.7;
scene.add(camera);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(CENTER);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.22;
// La rueda acerca hacia donde está el mouse (si no, hacia el medio de las dos).
controls.zoomToCursor = true;
controls.maxDistance = 3.4;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 2.35;
// Se arrastra para girar cada camiseta (ver más abajo): los controles sólo
// acercan (rueda o pellizco).
controls.enableRotate = false;
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
const blankTex = new THREE.DataTexture(new Uint8Array([128, 128, 0, 0]), 1, 1);
blankTex.needsUpdate = true;
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
  const own = {
    detailMap: { value: flatDetail },
    detailTile: { value: new THREE.Vector2(1, 1) },
    insideColor: { value: new THREE.Color() },
    // Aplicaciones (bordado y vinilo): color, forma y cómo se llega a ellas
    // desde las coordenadas de estampado.
    appOn: { value: 0 },
    appColor: { value: blankTex },
    appShape: { value: blankTex },
    appTransform: { value: new THREE.Matrix3() },
  };
  m.userData = { rib, own };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      '#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nattribute vec2 seam;\nattribute float zone;\nuniform mat3 appTransform;\nvarying vec2 vSeam;\nvarying vec2 vCloth;\nvarying float vZone;\nvarying vec2 vAppUv;\nvarying vec2 vPrint;\nvoid main() {\n vSeam = seam;\n vCloth = uv;\n vZone = zone;\n vPrint = uv1;\n vAppUv = (appTransform * vec3(uv1, 1.0)).xy;',
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
uniform vec3 insideColor;
uniform sampler2D appColor, appShape;
uniform float appOn;
varying vec2 vAppUv;
varying vec2 vPrint;
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
  float pill = smoothstep(0.35, 0.8, macro.g) * pills;
  // Aplicaciones de esta pieza (sólo por fuera): bordado (tipo 1) o vinilo
  // (tipo 0,5), y la sombra que deja el bordado alrededor.
  vec4 appC = texture2D(appColor, vAppUv);
  vec4 appS = texture2D(appShape, vAppUv);
  float isEmb = step(0.75, appS.a);
  float appA = gl_FrontFacing ? appC.a * appOn : 0.0;
  float embW = appA * isEmb;
  float vinW = appA - embW;
  float aoEmb = gl_FrontFacing ? appS.b * appOn * isEmb : 0.0;
  // Puntadas del bordado: relleno a 45° en filas de 1,2 mm, puntadas de
  // 4 mm con las filas corridas, cada una con su brillo; el hilo es redondo
  // a lo ancho de la fila. De lejos (más chicas que un píxel) se apagan.
  vec2 sDir = vec2(0.7071, 0.7071);
  vec2 sAcross = vec2(-0.7071, 0.7071);
  float sRowPh = dot(vPrint, sAcross) / 0.0012;
  float sRow = floor(sRowPh);
  float sAlong = dot(vPrint, sDir) / 0.004 + fract(sRow * 0.618);
  float sPx = length(fwidth(vPrint));
  float sFade = 1.0 - smoothstep(0.3, 0.7, sPx / 0.0012);
  float sGap = smoothstep(0.0, 0.06, fract(sAlong)) * smoothstep(1.0, 0.94, fract(sAlong));
  float sHash = fract(sin(dot(vec2(sRow, floor(sAlong)), vec2(12.9898, 78.233))) * 43758.5453);
  float sBump = sin(3.1416 * fract(sRowPh)) * sGap;
  float sRidge = cos(3.1416 * fract(sRowPh)) * sGap * sFade;
  pill *= 1.0 - appA;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  // Estampado (o mapa de piezas) sobre el color de la pieza, según su
  // opacidad. Por dentro no se ve: la tela es lisa, del color que más hay
  // en el diseño de la pieza.
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  diffuseColor.rgb = gl_FrontFacing ? mix(diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a) : insideColor;
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, appC.rgb, appA);
  diffuseColor.rgb *= 1.0 - 0.3 * aoEmb * (1.0 - appA);
  diffuseColor.rgb *= 1.0 + embW * sFade * (0.16 * (sBump - 0.64) + 0.08 * (sHash - 0.5));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // Tono del tejido, hilos jaspeados, irregularidad del teñido y bolitas.
  diffuseColor.rgb *= mix(0.5 + det.r, 1.0, appA);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vec3(0.78), 0.55), heather * macro.b * (1.0 - appA));
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
  roughnessFactor = clamp(roughnessFactor + (det.g - 0.5) * 0.5 + roughAdd * fabricBlur + pill * 0.15, 0.04, 1.0);
  // El hilo del bordado tiene brillo; el vinilo es liso y semimate.
  roughnessFactor = mix(roughnessFactor, 0.5, embW);
  roughnessFactor = mix(roughnessFactor, 0.34, vinW);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  if (inZone > 0.001) mapN = mix(mapN, texture2D(zoneNormal, vCloth / zoneTile).xyz * 2.0 - 1.0, inZone);
  mapN.xy *= normalScale * (1.0 + (macro.r - 0.5) * 1.2 * irregular) * (1.0 - 0.5 * fabricBlur) * (1.0 - 0.7 * vinW - embW);
  // Relieve de las aplicaciones: el borde (que sube) y los hilos del bordado,
  // en el plano de estampado mirado de afuera.
  mat3 tbnApp = getTangentFrame(-vViewPosition, normal, vec2(vPrint.x, -vPrint.y));
  vec3 appN = vec3(appS.rg * 2.0 - 1.0, 1.0);
  appN.xy += vec2(sAcross.x, -sAcross.y) * sRidge * 0.7 * isEmb;
  normal = normalize(mix(normalize(tbn * mapN), normalize(tbnApp * appN), appA));`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
  // El vinilo refleja más que la tela; el hilo del bordado, algo más.
  material.specularColor *= 1.0 + 5.0 * vinW + 2.0 * embW;
  material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
  material.specularF90 = mix(material.specularF90, 1.0, appA);`,
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
//   "mode": "hanger", "spin": false, "uvmap": false,
//   "design": [{ "name": "frente.svg", "text": "<svg…>" }, …] (o la plantilla
//   completa como texto), "kinds": { "crest": "emb", "brand": "vin",
//   "number": "print", "name": "print" } }
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
const view = { spin: !!CONFIG.spin, uvmap: !!CONFIG.uvmap, mode: 'body', light: BASE_LIGHT, pair: 0 }; // body: con cuerpo · hanger: en percha · clips: con broches

// Cada camiseta (con su percha o sus broches) cuelga de su soporte, que la
// ubica y la gira sobre el eje del gancho; adentro (`inner`), las
// coordenadas son las de la simulación.
const rigs = [-1, 1].map((side, i) => {
  const rig = new THREE.Group();
  rig.position.x = side * VIEWS[0].gap;
  rig.rotation.y = VIEWS[0].turn[i];
  const inner = new THREE.Group();
  rig.add(inner);
  rig.userData.inner = inner;
  scene.add(rig);
  return rig;
});
function setAxis(z) {
  for (const rig of rigs) {
    rig.position.z = z;
    rig.userData.inner.position.z = -z;
  }
}
// Piezas de la tela: las de la primera camiseta y sus gemelas (misma
// geometría y material).
const meshes = {};
const twins = {};
for (const [k, def] of Object.entries(PARTS)) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), fabricMaterial(def.rib));
  const twin = new THREE.Mesh(mesh.geometry, mesh.material);
  [mesh, twin].forEach((m, i) => {
    m.castShadow = m.receiveShadow = true;
    m.userData.rig = rigs[i].userData.inner;
    rigs[i].userData.inner.add(m);
  });
  meshes[k] = mesh;
  twins[k] = twin;
}
const clothMeshes = [...Object.values(meshes), ...Object.values(twins)];
const uvMaps = {};
// Diseño cargado: una textura de estampado por pieza.
// `mode`: 'template' (la plantilla completa) o 'pieces' (un diseño por
// pieza, ubicado por la página).
// `parts`: por pieza, los lienzos de lo estampado y de cada aplicación
// (escudo, marca, dorsal, nombre); `kinds`: cómo va cada una (bordado,
// vinilo o estampado).
const KIND_NAMES = KINDS.map(([kind]) => kind);
const design = { textures: {}, found: [], inside: {}, pieces: {}, tape: null, tapeTex: null, mode: null, parts: {}, app: {}, kinds: { crest: 'emb', brand: 'print', number: 'print', name: 'print' } };
// Color que más hay en el diseño de una pieza (lo transparente cuenta como
// el color de la pieza: null). Es el color del revés de la tela.
function dominantColor(canvas, rect = [0, 0, canvas.width, canvas.height]) {
  const N = 48;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, ...rect, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  const bins = new Map();
  let base = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) {
      base++;
      continue;
    }
    const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
    const b = bins.get(key) || [0, 0, 0, 0];
    b[0] += px[i];
    b[1] += px[i + 1];
    b[2] += px[i + 2];
    b[3]++;
    bins.set(key, b);
  }
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  if (!best || best[3] < base) return null;
  return new THREE.Color().setRGB(best[0] / best[3] / 255, best[1] / best[3] / 255, best[2] / best[3] / 255, THREE.SRGBColorSpace);
}
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
  if (!Object.keys(design.textures).length && !sizesBox.open) return;
  if (lastFlat) for (const k of ['front', 'back']) built.geos[k].attributes.uv1.array.set(lastFlat.geos[k].attributes.uv1.array);
  clearTimeout(flatTimer);
  flatTimer = setTimeout(() => {
    ensureFlat();
    if (design.mode === 'pieces') layoutPieces();
    fillSizes();
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
    m.userData.rig = rig.userData.inner;
    group.add(m);
    parts[k] = m;
  }
  rig.userData.inner.add(group);
  // La curva del gancho no gira: queda calzada en la barra.
  const curl = new THREE.Mesh(new THREE.BufferGeometry(), supportMaterials.metal);
  curl.castShadow = true;
  scene.add(curl);
  return { group, parts, curl };
});
// Perchero: una barra cromada colgada del techo, de donde cuelgan los ganchos
// (así las camisetas no cuelgan en el aire).
const RAIL_HALF = 1.6;
const DROP_X = 1.35;
const rail = new THREE.Group();
{
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, roughness: 0.22, metalness: 0.95 });
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_R, RAIL_R, 2 * RAIL_HALF, 32).rotateZ(Math.PI / 2), chrome);
  rail.add(bar);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(RAIL_R, 24, 12), chrome);
    cap.position.x = s * RAIL_HALF;
    // Bajada del techo: una varilla que abraza la barra.
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 3, 16).translate(0, 1.5 + RAIL_R * 0.6, 0), chrome);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RAIL_R + 0.003, 0.0045, 10, 28).rotateY(Math.PI / 2), chrome);
    drop.position.x = ring.position.x = s * DROP_X;
    rail.add(cap, drop, ring);
  }
  rail.traverse((o) => (o.castShadow = o.receiveShadow = o.isMesh));
  rail.visible = false;
  scene.add(rail);
}
function syncCurls() {
  supports.forEach((sp, i) => (sp.curl.position.x = rigs[i].position.x));
}
const hanging = () => view.mode !== 'body';

let built = null;
let drape = null;

// Tapacostura: una tira (TAPE_W de ancho) por dentro de la espalda, sobre la
// costura del cuello, de hombro a hombro. Sigue a la tela de la espalda,
// puesta o colgada: cada punto sale de la columna de la espalda que baja del
// escote, hacia adentro: arriba tapa el borde de la cara de adentro del
// cuello (TAPE_IN[0]) y abajo queda contra la tela (TAPE_IN[1]). Mirada desde
// adentro (desde el frente, por el escote), su diseño se lee derecho.
const TAPE_W = 0.02;
const TAPE_IN = [0.0047, 0.0016];
const TAPE_ROWS = 4;
const tapeMat = new THREE.MeshStandardMaterial({ roughness: 0.72, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const tape = { geo: new THREE.BufferGeometry(), binds: null, len: 0 };
for (const rig of rigs) {
  const m = new THREE.Mesh(tape.geo, tapeMat);
  m.receiveShadow = true;
  rig.userData.inner.add(m);
}
function buildTape() {
  const pos = built.geos.back.attributes.position.array;
  const W = built.layout.cols + 1;
  const N = built.layout.rows;
  const d3 = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  const sj = [0];
  for (let j = 1; j < W; j++) sj.push(sj[j - 1] + d3(N * W + j - 1, N * W + j));
  tape.len = sj[W - 1];
  const binds = [];
  const uv = [];
  for (let t = 0; t <= TAPE_ROWS; t++) {
    const d = (TAPE_W * t) / TAPE_ROWS;
    for (let j = 0; j < W; j++) {
      let r = N;
      let acc = 0;
      for (; r > 1; r--) {
        const l = d3(r * W + j, (r - 1) * W + j);
        if (acc + l >= d) break;
        acc += l;
      }
      const l = d3(r * W + j, (r - 1) * W + j) || 1;
      binds.push(r * W + j, (r - 1) * W + j, Math.min(1, (d - acc) / l), TAPE_IN[0] + ((TAPE_IN[1] - TAPE_IN[0]) * t) / TAPE_ROWS);
      uv.push(1 - sj[j] / tape.len, 1 - t / TAPE_ROWS);
    }
  }
  const idx = [];
  for (let t = 0; t < TAPE_ROWS; t++)
    for (let j = 0; j < W - 1; j++) {
      const a = t * W + j;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  const n = binds.length / 4;
  tape.binds = binds;
  tape.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  tape.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  tape.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tape.geo.setIndex(idx);
  updateTape();
}
function updateTape() {
  const g = built.geos.back;
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const P = tape.geo.attributes.position.array;
  const Nn = tape.geo.attributes.normal.array;
  const b = tape.binds;
  for (let i = 0; i < b.length / 4; i++) {
    const [a, c, f, off] = [b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]];
    let nx = nor[a * 3] + (nor[c * 3] - nor[a * 3]) * f;
    let ny = nor[a * 3 + 1] + (nor[c * 3 + 1] - nor[a * 3 + 1]) * f;
    let nz = nor[a * 3 + 2] + (nor[c * 3 + 2] - nor[a * 3 + 2]) * f;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 3; k++) P[i * 3 + k] = pos[a * 3 + k] + (pos[c * 3 + k] - pos[a * 3 + k]) * f;
    P[i * 3] -= nx * off;
    P[i * 3 + 1] -= ny * off;
    P[i * 3 + 2] -= nz * off;
    Nn[i * 3] = -nx;
    Nn[i * 3 + 1] = -ny;
    Nn[i * 3 + 2] = -nz;
  }
  tape.geo.attributes.position.needsUpdate = true;
  tape.geo.attributes.normal.needsUpdate = true;
  tape.geo.computeBoundingSphere();
}
// Distancia entre las camisetas según su ancho (con cuerpo, mangas abiertas):
// de frente quedan a PAIR_MARGIN de tocarse; de perfil, según su fondo.
function fitPair() {
  let w = 0;
  let d = 0;
  for (const g of Object.values(built.geos)) {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      w = Math.max(w, Math.abs(a[i]));
      d = Math.max(d, Math.abs(a[i + 2]));
    }
  }
  VIEWS[0].gap = w + PAIR_MARGIN;
  VIEWS[1].gap = Math.max(0.22, d + 0.06);
  const aspect = Math.max(1.7, (4 * w + 2 * PAIR_MARGIN + 0.1) / 0.95);
  if (Math.abs(aspect - pairAspect) > 0.01) {
    pairAspect = aspect;
    resize();
  }
  if (turn) turn.gap[1] = VIEWS[turn.view].gap - turn.gap[0];
  else rigs.forEach((rig, j) => (rig.position.x = (j ? 1 : -1) * VIEWS[view.pair].gap));
  syncCurls();
}
function rebuild() {
  built = buildShirt(params);
  fitPair();
  for (const [k, mesh] of Object.entries(meshes)) {
    if (mesh.geometry !== NO_GEO) mesh.geometry.dispose();
    mesh.geometry = twins[k].geometry = built.geos[k] || NO_GEO;
    mesh.visible = twins[k].visible = !!built.geos[k];
  }
  buildTape();
  followFlat();
  // Colgada: la tela arranca con la forma puesta y cae (sobre la percha, o
  // sostenida por los broches).
  drape = null;
  for (const sp of supports) sp.group.visible = sp.curl.visible = hanging();
  rail.visible = hanging();
  setAxis(0);
  if (hanging()) {
    let support;
    if (view.mode === 'hanger') {
      support = makeHanger(built.measures);
      drape = new HangingShirt(built, support, { weight: fabric.weight });
    } else {
      drape = new HangingShirt(built, { kind: 'clips' }, { weight: fabric.weight });
      support = makeClipHanger(drape.clips);
    }
    // El tapacostura sigue a la tela cada vez que se actualiza.
    const update = drape.updateMeshes.bind(drape);
    drape.updateMeshes = () => {
      update();
      updateTape();
    };
    for (const k of Object.keys(supportMaterials)) {
      supports[0].parts[k].geometry.dispose();
      supports[0].parts[k].geometry = supports[1].parts[k].geometry = support[k] || new THREE.BufferGeometry();
    }
    supports[0].curl.geometry.dispose();
    supports[0].curl.geometry = supports[1].curl.geometry = support.hook.curl;
    // Cada camiseta gira sobre el eje de su gancho, que cuelga de la barra.
    setAxis(support.hook.rail.z);
    rail.position.set(0, support.hook.rail.y, support.hook.rail.z);
  }
  applyLook();
  updateSpec();
  requestRender();
}

// Colores, o el mapa de estampado (grilla con el nombre de cada pieza).
function applyLook() {
  tapeMat.map = view.uvmap ? null : design.tapeTex || null;
  tapeMat.color.set(tapeMat.map ? '#ffffff' : view.uvmap ? '#cfcac0' : colors.collar);
  tapeMat.needsUpdate = true;
  for (const [k, mesh] of Object.entries(meshes)) {
    const def = PARTS[k];
    const m = mesh.material;
    const app = !view.uvmap && design.app[k];
    m.userData.own.appOn.value = app ? 1 : 0;
    m.userData.own.appColor.value = app ? app.color : blankTex;
    m.userData.own.appShape.value = app ? app.shape : blankTex;
    if (app) m.userData.own.appTransform.value.copy(app.matrix);
    if (!view.uvmap && design.textures[k]) {
      m.map = design.textures[k];
      m.color.set(colors[def.color]);
      m.userData.own.insideColor.value.copy(design.inside[k] || m.color);
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
      m.userData.own.insideColor.value.set('#cfcac0');
    } else {
      m.map = null;
      m.color.set(view.uvmap ? '#cfcac0' : colors[def.color]);
      if (!view.uvmap && design.inside[def.lining]) m.color.copy(design.inside[def.lining]);
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
// Prendas: largo de manga (mínimo, máximo, típico) y apertura típica.
const GARMENTS = {
  tee: { sleeve: [0.13, 0.3, 0.21], angle: 40 },
  long: { sleeve: [0.5, 0.68, 0.6], angle: 22 },
  tank: { sleeve: [0.13, 0.3, 0.21], angle: 40, bare: true },
  singlet: { sleeve: [0.13, 0.3, 0.21], angle: 40, bare: true },
};
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
  if (!GARMENTS[params.garment]) params.garment = 'tee';
  const [slo, shi] = GARMENTS[params.garment].sleeve;
  sliders.sleeveLength.min = slo;
  sliders.sleeveLength.max = shi;
  params.sleeveLength = Math.min(shi, Math.max(slo, params.sleeveLength));
  garmentButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.garment === params.garment)));
  // Sin mangas no hay largo ni apertura de mangas, ni colores de mangas y puños.
  const bare = !!GARMENTS[params.garment].bare;
  for (const id of ['sleeveLength', 'sleeveAngle', 'c-sleeves', 'c-cuffs']) document.getElementById(id).closest('.control, .swatch').hidden = bare;
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
// Prenda: al cambiarla, el largo y la apertura de las mangas vuelven a los
// típicos de esa prenda y la vista se reencuadra.
const garmentButtons = [...document.querySelectorAll('[data-garment]')];
garmentButtons.forEach((b) =>
  b.addEventListener('click', () => {
    if (params.garment === b.dataset.garment) return;
    params.garment = b.dataset.garment;
    params.sleeveLength = GARMENTS[params.garment].sleeve[2];
    params.sleeveAngle = GARMENTS[params.garment].angle;
    syncControls();
    rebuild();
    goToView(view.pair);
  }),
);
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
  // La colgada queda más baja (la barra y el gancho arriba, la tela
  // estirada por su peso): la vista se centra un poco más abajo.
  const dy = (mode === 'body' ? CENTER.y : HANG_Y) - controls.target.y;
  controls.target.y += dy;
  camera.position.y += dy;
  lightTarget.position.y = controls.target.y;
  controls.update();
  view.mode = mode;
  modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.querySelector('.hint').textContent =
    mode === 'body'
      ? 'Arrastrá sobre una camiseta para girarla · rueda o pellizco para acercar'
      : matchMedia('(hover: none)').matches
        ? 'Tocá la tela para moverla · arrastrá para girar cada camiseta'
        : 'Pasá el mouse sobre la tela para moverla · arrastrá para girar cada camiseta';
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
  rig.getWorldQuaternion(unturn).invert();
  return { point: rig.worldToLocal(hit.point.clone()), local: (v) => v.applyQuaternion(unturn) };
}

// Giro: arrastrar de costado gira sólo la camiseta que está bajo el puntero
// (o la más cercana), sobre su eje; arriba y abajo inclina la cámara. Al
// soltar sigue girando un poco y frena.
const dom = renderer.domElement;
const spinVel = [0, 0];
const drag = { id: -1, rig: 0, x: 0, y: 0, t: 0, v: 0 };
const touches = new Set();
const sph = new THREE.Spherical();
const tmpV = new THREE.Vector3();
function rigAt(e) {
  const r = dom.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const pickable = [...clothMeshes, ...supports.flatMap((sp) => (sp.group.visible ? Object.values(sp.parts) : []))];
  const hit = raycaster.intersectObjects(pickable, false)[0];
  if (hit) return rigs.findIndex((rig) => rig.userData.inner === hit.object.userData.rig);
  let best = 0;
  let bd = Infinity;
  rigs.forEach((rig, i) => {
    const d = Math.abs(rig.getWorldPosition(tmpV).project(camera).x - pointer.x);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}
function tilt(dy) {
  const off = tmpV.copy(camera.position).sub(controls.target);
  sph.setFromVector3(off);
  sph.phi = Math.min(controls.maxPolarAngle, Math.max(controls.minPolarAngle, sph.phi - dy * 0.006));
  camera.position.copy(controls.target).add(off.setFromSpherical(sph));
  camera.lookAt(controls.target);
}
dom.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') touches.add(e.pointerId);
  // Dos dedos: pellizco (lo manejan los controles).
  if (touches.size > 1 || (e.pointerType === 'mouse' && e.button !== 0)) {
    drag.id = -1;
    return;
  }
  if (turn) placeRigs(1);
  turn = null;
  fly = null;
  Object.assign(drag, { id: e.pointerId, rig: rigAt(e), x: e.clientX, y: e.clientY, t: performance.now(), v: 0 });
  spinVel[drag.rig] = 0;
});
dom.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag.id) return;
  const now = performance.now();
  const a = (e.clientX - drag.x) * SPIN_PX;
  rigs[drag.rig].rotation.y += a;
  drag.v = (a / Math.max(now - drag.t, 8)) * 16;
  tilt(e.clientY - drag.y);
  Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
  requestRender();
});
function endDrag(e) {
  touches.delete(e.pointerId);
  if (e.pointerId !== drag.id) return;
  if (performance.now() - drag.t < 80) spinVel[drag.rig] = drag.v;
  drag.id = -1;
}
dom.addEventListener('pointerup', endDrag);
dom.addEventListener('pointercancel', endDrag);
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
const sizesBox = document.getElementById('design-sizes');
const kindsBox = document.getElementById('design-kinds');
kindsBox.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-as]');
  if (!b) return;
  design.kinds[b.closest('[data-kind]').dataset.kind] = b.dataset.as;
  compose();
});
sizesBox.addEventListener('toggle', () => {
  if (!sizesBox.open) return;
  ensureFlat();
  fillSizes();
});
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
  for (const a of Object.values(design.app)) a.color.dispose(), a.shape.dispose();
  design.textures = {};
  design.found = [];
  design.inside = {};
  design.pieces = {};
  design.parts = {};
  design.app = {};
  design.mode = null;
  design.tape = null;
  design.tapeTex?.dispose();
  design.tapeTex = null;
  designClear.hidden = true;
  kindsBox.hidden = true;
}
// Arma las texturas de cada pieza: lo estampado (más el escudo o las marcas
// si van estampados) y las aplicaciones (bordado y vinilo) con su relieve.
function compose() {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const t of Object.values(design.textures)) t.dispose();
  for (const a of Object.values(design.app)) a.color.dispose(), a.shape.dispose();
  design.textures = {};
  design.app = {};
  const has = {};
  for (const [k, p] of Object.entries(design.parts)) {
    let print = p.print;
    const by = { emb: [], vin: [], print: [] };
    for (const kind of KIND_NAMES)
      if (p[kind]) {
        has[kind] = true;
        by[design.kinds[kind]].push(p[kind]);
      }
    if (by.print.length) {
      print = document.createElement('canvas');
      print.width = p.print.width;
      print.height = p.print.height;
      const ctx = print.getContext('2d');
      ctx.drawImage(p.print, 0, 0);
      for (const c of by.print) ctx.drawImage(c, 0, 0);
    }
    design.textures[k] = printTexture(k, print, aniso);
    design.inside[k] = dominantColor(print, p.rect);
    const merge = (list) => {
      if (list.length < 2) return list[0] || null;
      const c = document.createElement('canvas');
      c.width = list[0].width;
      c.height = list[0].height;
      for (const x of list) c.getContext('2d').drawImage(x, 0, 0);
      return c;
    };
    const app = buildApplique(k, merge(by.emb), merge(by.vin), p.k);
    if (app) design.app[k] = app;
  }
  for (const kind of KIND_NAMES) {
    kindsBox.querySelector(`[data-kind="${kind}"]`).hidden = !has[kind];
    kindsBox.querySelectorAll(`[data-kind="${kind}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.as === design.kinds[kind])));
  }
  kindsBox.hidden = !Object.keys(has).length;
  applyLook();
}
// Medidas de cada pieza para diseñar (para la camiseta tal como está).
const SIZE_ROWS = [
  ['front', 'Frente'],
  ['back', 'Espalda'],
  ['sleeveR', 'Manga (cada una)'],
  ['cuffR', 'Puño (cada uno)'],
  ['collar', 'Cuello (vuelta entera)'],
  ['tape', 'Tapacostura (por dentro)'],
];
const cmUp = (mm, d = 0) => (Math.ceil(mm / 10 ** (1 - d)) / 10 ** d).toFixed(d).replace('.', ',');
function fillSizes() {
  if (!sizesBox.open) return;
  const sz = { ...pieceSizes(built), tape: { w: tape.len * 1000, h: TAPE_W * 1000 } };
  sizesBox.querySelector('dl').innerHTML = SIZE_ROWS.filter(([k]) => sz[k]).map(([k, label]) => {
    const d = sz[k].h < 50 ? 1 : 0;
    return `<div><dt>${label}</dt><dd>${cmUp(sz[k].w)} × ${cmUp(sz[k].h, d)} cm</dd></div>`;
  }).join('');
}
// Diseños por pieza: cada uno a su lugar en el molde. Si mientras tanto se
// rehízo la camiseta, se descarta (lo hace la vuelta siguiente).
let layoutGen = 0;
async function layoutPieces() {
  const gen = ++layoutGen;
  ensureFlat();
  const sz = pieceSizes(built);
  const notes = [];
  const placed = {};
  for (const [k, p] of Object.entries(design.pieces)) {
    if (!sz[k]) continue; // pieza que esta prenda no tiene (mangas en la musculosa)
    try {
      placed[k] = await placePiece(k, p, sz[k]);
    } catch {
      notes.push(`${p.name}: no se pudo dibujar`);
    }
    if (gen !== layoutGen) return;
  }
  design.parts = Object.fromEntries(Object.entries(placed).map(([k, r]) => [k, r]));
  compose();
  const seen = new Set();
  for (const [k, p] of Object.entries(design.pieces)) {
    if (seen.has(p) || !placed[k]) continue;
    seen.add(p);
    const r = placed[k];
    notes.push(`${p.keys.map((x) => PIECE_NAMES[x]).join(' y ')}: ${cmUp(r.w)} × ${cmUp(r.h, r.h < 50 ? 1 : 0)} cm${r.real ? '' : ' (ajustado a la pieza)'}`);
  }
  if (design.tape) {
    const t = design.tape;
    try {
      const canvas = await placeTape(t, tape.len * 1000, TAPE_W * 1000);
      if (gen !== layoutGen) return;
      design.tapeTex?.dispose();
      design.tapeTex = new THREE.CanvasTexture(canvas);
      design.tapeTex.colorSpace = THREE.SRGBColorSpace;
      design.tapeTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      notes.push(`tapacostura: ${cmUp(tape.len * 1000)} × ${cmUp(TAPE_W * 1000, 1)} cm`);
      applyLook();
    } catch {
      notes.push(`${t.name}: no se pudo dibujar`);
    }
  }
  design.found = Object.keys(placed);
  if (design.tape) design.found.push('tape');
  designClear.hidden = !design.found.length;
  designNote.textContent = notes.length ? `${notes.join(' · ')}.` : '';
  applyLook();
}
const PIECE_NAMES = { front: 'frente', back: 'espalda', sleeveL: 'manga izquierda', sleeveR: 'manga derecha', cuffL: 'puño izquierdo', cuffR: 'puño derecho', collar: 'cuello', tape: 'tapacostura' };
async function loadFiles(files) {
  designNote.textContent = 'Leyendo…';
  const { pieces, template, unknown } = readPieces(files);
  if (template) return loadDesign(template, 'la plantilla');
  if (!pieces.length) {
    designNote.textContent = `No sé a qué pieza va ${unknown.join(', ')}: poné en el nombre del archivo (o de la capa) frente, espalda, manga, puño o cuello.`;
    return;
  }
  if (design.mode !== 'pieces') clearDesign();
  design.mode = 'pieces';
  for (const p of pieces) {
    if (p.layer) {
      const iso = isolateLayer(p);
      if (!iso) continue;
      Object.assign(p, iso, { doc: null, layer: null });
    }
    if (p.keys.includes('tape')) design.tape = p;
    else for (const k of p.keys) design.pieces[k] = p;
  }
  if (view.uvmap) {
    view.uvmap = false;
    document.getElementById('uvmap').checked = false;
  }
  await layoutPieces();
  if (unknown.length) designNote.textContent += ` No sé a qué pieza va ${unknown.join(', ')}.`;
}
async function loadDesign(text, name = 'diseño') {
  designNote.textContent = `Leyendo ${name}…`;
  try {
    const r = await readDesign(text);
    const found = r.found;
    clearDesign();
    ensureFlat();
    design.mode = 'template';
    for (const [k, c] of Object.entries(r.canvases)) design.parts[k] = { print: c, k: r.k[k], ...Object.fromEntries(KIND_NAMES.map((kind) => [kind, r[kind][k]])) };
    compose();
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
const readFiles = async (list) => Promise.all([...list].filter((f) => /\.svg$/i.test(f.name) || f.type === 'image/svg+xml').map(async (f) => ({ name: f.name, text: await f.text() })));
designFile.addEventListener('change', async () => {
  const files = await readFiles(designFile.files);
  if (files.length) await loadFiles(files);
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
  const files = await readFiles(e.dataTransfer.files);
  if (files.length) await loadFiles(files);
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
  document.getElementById('s-sleeve').textContent = M.sleeveless ? 'sin manga' : fmtCm(Math.PI * 2 * M.sleeve.rHem);
  document.getElementById('s-fabric').textContent = `${(WEAVES[fabric.weave] || WEAVES.mesh).label} · ${FOUT.weight(fabric.weight)}`;
}

// Vistas: frente y espalda, o los dos perfiles. Giran las camisetas (por el
// camino más corto) y la cámara vuelve al frente.
const viewButtons = [...document.querySelectorAll('.views [data-view]')];
const zoomButtons = [...document.querySelectorAll('[data-zoom]')];
let turn = null;
// Vuelo de la cámara (vistas y acercamientos).
let fly = null;
function flyTo(target, position) {
  fly = { from: [controls.target.clone(), camera.position.clone()], to: [target, position], t0: performance.now() };
  requestRender();
}
const shortest = (d) => Math.atan2(Math.sin(d), Math.cos(d));
function goToView(i) {
  const c = new THREE.Vector3(0, view.mode === 'body' ? CENTER.y : HANG_Y, 0);
  flyTo(c, c.clone().add(CAM_OFF));
  zoomButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
  turn = {
    rigs: rigs.map((rig, j) => [rig.rotation.y, shortest(VIEWS[i].turn[j] - rig.rotation.y)]),
    gap: [Math.abs(rigs[0].position.x), VIEWS[i].gap - Math.abs(rigs[0].position.x)],
    view: i,
    t0: performance.now(),
  };
  view.pair = i;
  spinVel.fill(0);
  viewButtons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  requestRender();
}
function placeRigs(e) {
  const gap = turn.gap[0] + turn.gap[1] * e;
  rigs.forEach((rig, j) => {
    rig.rotation.y = turn.rigs[j][0] + turn.rigs[j][1] * e;
    rig.position.x = (j ? 1 : -1) * gap;
  });
  syncCurls();
}
viewButtons.forEach((b, i) => b.addEventListener('click', () => goToView(i)));
// Acercamientos: al pecho de la camiseta de la izquierda, a la espalda alta
// de la de la derecha y adentro del cuello (el tapacostura) de la de la
// izquierda, sobre la tela tal como está (con cuerpo o colgada, y aunque
// estén giradas): el punto del medio de la pieza que queda unos centímetros
// bajo el escote, mirado de frente a la tela (el cuello, desde arriba y
// adelante).
const ZOOMS = {
  chest: { rig: 0, key: 'front', below: 0.13, dist: 0.56 },
  back: { rig: 1, key: 'back', below: 0.1, dist: 0.52 },
  neck: { rig: 0, key: 'back', below: 0.012, dist: 0.34, from: 'front' },
};
function zoomTo(name) {
  const z = ZOOMS[name];
  const mesh = (z.rig ? twins : meshes)[z.key];
  const g = mesh.geometry;
  const W = built.layout.cols + 1;
  const col = built.layout.cols / 2;
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const top = built.layout.rows;
  const yNeck = pos[(top * W + col) * 3 + 1];
  let row = top;
  while (row > 0 && pos[(row * W + col) * 3 + 1] > yNeck - z.below) row--;
  const v = row * W + col;
  mesh.updateWorldMatrix(true, false);
  const p = new THREE.Vector3().fromArray(pos, v * 3).applyMatrix4(mesh.matrixWorld);
  const n = new THREE.Vector3().fromArray(nor, v * 3).transformDirection(mesh.matrixWorld);
  if (z.from) {
    // Desde adelante y arriba: la normal del frente en el pecho, levantada.
    const f = (z.rig ? twins : meshes)[z.from];
    const fv = (top - 12) * W + col;
    n.fromArray(f.geometry.attributes.normal.array, fv * 3).transformDirection(f.matrixWorld);
    n.y = 0;
    n.normalize().add(new THREE.Vector3(0, 0.3, 0));
  } else n.y = Math.max(n.y, 0) + 0.12;
  n.normalize();
  flyTo(p, p.clone().addScaledVector(n, z.dist));
  zoomButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === name)));
}
zoomButtons.forEach((b) => b.addEventListener('click', () => zoomTo(b.dataset.zoom)));
viewButtons[0].setAttribute('aria-pressed', 'true');
// Si se arrastra o se acerca durante un giro o un vuelo, terminan de golpe.
controls.addEventListener('start', () => {
  if (turn) placeRigs(1);
  turn = null;
  fly = null;
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
  camera.fov = w / h < pairAspect ? 28 * (pairAspect / Math.max(w / h, 0.45)) ** 0.8 : 28;
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(stage);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
renderer.setAnimationLoop((now) => {
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  if (turn) {
    const k = reduceMotion.matches ? 1 : Math.min(1, (now - turn.t0) / 650);
    placeRigs(ease(k));
    if (k >= 1) turn = null;
    needsRender = true;
  }
  if (fly) {
    const k = reduceMotion.matches ? 1 : Math.min(1, (now - fly.t0) / 700);
    const e = ease(k);
    controls.target.lerpVectors(fly.from[0], fly.to[0], e);
    camera.position.lerpVectors(fly.from[1], fly.to[1], e);
    if (k >= 1) fly = null;
    needsRender = true;
  }
  if (controls.update()) needsRender = true;
  // Inercia del giro y giro solo (cada una sobre su eje).
  rigs.forEach((rig, j) => {
    if (drag.id >= 0 && drag.rig === j) return;
    if (Math.abs(spinVel[j]) > 1e-4) {
      rig.rotation.y += spinVel[j];
      spinVel[j] *= 0.92;
      needsRender = true;
    } else if (view.spin && !turn) {
      rig.rotation.y += SPIN_SPEED / 60;
      needsRender = true;
    }
  });
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
if (CONFIG.mode === 'hanger' || CONFIG.mode === 'clips') setMode(CONFIG.mode);
else rebuild();
resize();
for (const k of KIND_NAMES) if (['emb', 'vin', 'print'].includes(CONFIG.kinds?.[k])) design.kinds[k] = CONFIG.kinds[k];
if (typeof CONFIG.design === 'string' && CONFIG.design.includes('<svg')) loadFiles([{ name: 'diseño', text: CONFIG.design }]);
else if (Array.isArray(CONFIG.design)) loadFiles(CONFIG.design.filter((d) => typeof d?.text === 'string'));

window.__camiseta = { params, colors, fabric, rebuild, applyLook, applyFabric, setLight, syncControls, camera, controls, scene, meshes, rigs, view, goToView, zoomTo, setMode, loadDesign, loadFiles, setKinds: (k) => (Object.assign(design.kinds, k), compose()), templateSVG: () => (ensureFlat(), templateSVG(built, params, colors)), design, drape: () => drape };
