// Camiseta deportiva paramétrica: escena, materiales y controles.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildShirt, girth, DEFAULTS, flattenPrint } from './shirt.js';
import { makeHanger, makeClipHanger, HangingShirt, RAIL_R } from './drape.js';
import { WEAVES, weaveTextures, weaveSwatch, makeRibNormalMap, makeFlatDetail, makeMacroMap, MACRO_TILE, makeUVMap } from './fabric.js';
import { printTexture, pieceSizes, pieceCanvases, pieceOutline, coverRect, BLEED, placeTape, placeLabel, buildApplique, pieceKeys, PIECE_LABELS, PIECES } from './print.js';
import { openStore, decodeImage, transparency, newId } from './library.js';
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
};
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
const PAIR_ASPECT = 1.7; // ancho / alto que ocupan las dos camisetas (con cuerpo, mangas abiertas)
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
const view = { spin: !!CONFIG.spin, uvmap: !!CONFIG.uvmap, mode: 'body', light: BASE_LIGHT, pair: 0, tab: 'ajustes' }; // body: con cuerpo · hanger: en percha · clips: con broches

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
    m.userData.piece = k === 'hem' ? 'hem' : def.lining || k;
    rigs[i].userData.inner.add(m);
  });
  meshes[k] = mesh;
  twins[k] = twin;
}
const clothMeshes = [...Object.values(meshes), ...Object.values(twins)];
const uvMaps = {};
// Diseño: por pieza, la textura de estampado, el color del revés y las
// aplicaciones con relieve; las texturas del tapacostura y de la etiqueta.
const design = { textures: {}, inside: {}, app: {}, tapeTex: null, labelTex: null };
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
// Sin cancelar el recálculo pendiente si ya está aplanado.
function flatNow() {
  if (!built.flatPrint) ensureFlat();
}
function followFlat() {
  if (!hasDress() && !sizesBox.open) return;
  if (lastFlat) for (const k of ['front', 'back']) built.geos[k].attributes.uv1.array.set(lastFlat.geos[k].attributes.uv1.array);
  clearTimeout(flatTimer);
  flatTimer = setTimeout(() => {
    ensureFlat();
    if (hasDress()) renderDress();
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

// Tapacostura: una tira fina por dentro de la espalda, sobre la costura del
// cuello, de hombro a hombro, como se cose de verdad: cubre TAPE_FACE de la
// cara de adentro del cuello (por delante de ella, TAPE_OUT), envuelve su
// borde y baja hasta quedar pegada a la tela de la espalda (TAPE_IN),
// TAPE_DOWN por debajo de ese borde. El diseño va en la parte que cubre el
// cuello (la que se ve de frente, por el escote); lo que baja a la tela sigue
// el color de su borde de abajo. Sigue al cuello y a la tela, puesta o
// colgada. Mirada desde adentro, su diseño se lee derecho.
const TAPE_FACE = 0.007;
const TAPE_OUT = 0.0006; // por delante de la cara de adentro del cuello
const TAPE_IN = 0.0012; // separación de la tela
const TAPE_DOWN = [0.0005, 0.0015];
const tapeMat = new THREE.MeshStandardMaterial({ roughness: 0.72, side: THREE.DoubleSide });
const tape = { geo: new THREE.BufferGeometry(), cols: null, W: 0, N: 0, len: 0, w: 0 };
for (const rig of rigs) {
  const m = new THREE.Mesh(tape.geo, tapeMat);
  m.receiveShadow = true;
  m.userData.piece = 'tape';
  rig.userData.inner.add(m);
}
const TAPE_ROWS = 2 + TAPE_DOWN.length;
function buildTape() {
  const pos = built.geos.back.attributes.position.array;
  const C = built.layout.cols;
  const W = C + 1;
  const N = built.layout.rows;
  const CSW = 2 * C + 1;
  const CP = built.geos.collar.attributes.position.count / CSW;
  const sj = [0];
  for (let j = 1; j < W; j++) sj.push(sj[j - 1] + dist3(pos, N * W + j - 1, pos, N * W + j));
  tape.len = sj[W - 1];
  // Por columna de la espalda: el borde de abajo de la cara de adentro del
  // cuello y la fila de arriba (la tira monta sobre esa cara).
  tape.cols = Array.from({ length: W }, (_, j) => ({ bot: (CP - 1) * CSW + C + j, top: (CP - 2) * CSW + C + j }));
  tape.W = W;
  tape.N = N;
  const n = TAPE_ROWS * W;
  tape.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  tape.geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  updateTape();
  // Ancho del diseño: lo que cubre el cuello, hasta el borde envuelto (en el
  // centro de la espalda).
  const P = tape.geo.attributes.position.array;
  tape.w = dist3(P, C / 2, P, W + C / 2);
  const uv = [];
  for (let t = 0; t < TAPE_ROWS; t++) for (let j = 0; j < W; j++) uv.push(1 - sj[j] / tape.len, t ? 0 : 1);
  const idx = [];
  for (let t = 0; t < TAPE_ROWS - 1; t++)
    for (let j = 0; j < W - 1; j++) {
      const a = t * W + j;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  tape.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  tape.geo.setIndex(idx);
}
function dist3(p, a, q, b) {
  return Math.hypot(p[a * 3] - q[b * 3], p[a * 3 + 1] - q[b * 3 + 1], p[a * 3 + 2] - q[b * 3 + 2]);
}
function updateTape() {
  const pos = built.geos.back.attributes.position.array;
  const nor = built.geos.back.attributes.normal.array;
  const cpos = built.geos.collar.attributes.position.array;
  const P = tape.geo.attributes.position.array;
  const Nn = tape.geo.attributes.normal.array;
  const { W, N } = tape;
  const n = [0, 0, 0];
  const q = [0, 0, 0];
  // Punto de la columna j a una distancia d de la costura, separado de la
  // tela hacia adentro.
  const onBack = (i, j, d, off) => {
    let r = N;
    let acc = 0;
    for (; r > 1; r--) {
      const l = dist3(pos, r * W + j, pos, (r - 1) * W + j);
      if (acc + l >= d) break;
      acc += l;
    }
    const a = r * W + j;
    const c = a - W;
    const f = Math.min(1, (d - acc) / (dist3(pos, a, pos, c) || 1));
    for (let k = 0; k < 3; k++) n[k] = nor[a * 3 + k] + (nor[c * 3 + k] - nor[a * 3 + k]) * f;
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) {
      P[i * 3 + k] = pos[a * 3 + k] + (pos[c * 3 + k] - pos[a * 3 + k]) * f - (n[k] / l) * off;
      Nn[i * 3 + k] = -n[k] / l;
    }
  };
  for (let j = 0; j < W; j++) {
    const { bot, top } = tape.cols[j];
    // Sobre el cuello: TAPE_FACE arriba del borde y envolviéndolo, por
    // delante de la cara de adentro (contra la normal de la tela).
    const face = dist3(cpos, bot, cpos, top) || 1;
    const s = N * W + j;
    const l = Math.hypot(nor[s * 3], nor[s * 3 + 1], nor[s * 3 + 2]) || 1;
    [TAPE_FACE / face, -TAPE_OUT / face].forEach((f, t) => {
      const i = t * W + j;
      for (let k = 0; k < 3; k++) {
        P[i * 3 + k] = cpos[bot * 3 + k] + (cpos[top * 3 + k] - cpos[bot * 3 + k]) * f - (nor[s * 3 + k] / l) * TAPE_OUT;
        Nn[i * 3 + k] = -nor[s * 3 + k] / l;
      }
    });
    // Sobre la tela: desde el punto de la columna más cercano al borde (puesta
    // o colgada, el cuello se corre un poco respecto de la tela).
    let best = Infinity;
    let de = 0;
    let acc = 0;
    for (let r = N; r > N - 12; r--) {
      const a = r * W + j;
      const len = dist3(pos, a, pos, a - W);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        for (let c = 0; c < 3; c++) q[c] = pos[a * 3 + c] + (pos[(a - W) * 3 + c] - pos[a * 3 + c]) * t - cpos[bot * 3 + c];
        const dd = Math.hypot(...q);
        if (dd < best) [best, de] = [dd, acc + len * t];
      }
      acc += len;
    }
    TAPE_DOWN.forEach((down, k) => onBack((2 + k) * W + j, j, de + down, TAPE_IN));
  }
  tape.geo.attributes.position.needsUpdate = true;
  tape.geo.attributes.normal.needsUpdate = true;
  tape.geo.computeBoundingSphere();
}
// Etiqueta tejida del ruedo: cosida por afuera bajo el pespunte, abajo a la
// derecha del frente (LABEL_SIDE de la costura del costado a su centro),
// envuelve el borde y sigue por dentro. La cara de afuera mide LABEL_W ×
// LABEL_H (de su doblez de arriba al borde del ruedo). Es rígida: se apoya en
// un marco que sale del ruedo (borde, a lo largo y hacia arriba por la tela),
// puesta o colgada.
const LABEL_W = 0.016;
const LABEL_H = 0.021;
const LABEL_SIDE = 0.06;
const LABEL_OFF = 0.0006; // por fuera de la tela
const LABEL_IN = -0.003; // por dentro del dobladillo
const labelMat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
const label = { geo: null, j: 0, f: 0, sign: 1, meshes: [] };
// Perfil (alto sobre el borde, separación de la tela) de afuera hacia
// adentro: doblez de arriba (la punta va metida debajo), cara de afuera,
// vuelta alrededor del borde del ruedo y cara de adentro.
function labelGeometry() {
  const prof = [];
  const rTop = (LABEL_OFF - 0.0002) / 2;
  prof.push([LABEL_H - 0.002, 0.0002]);
  for (let a = 0; a <= 6; a++) {
    const t = (Math.PI * a) / 6;
    prof.push([LABEL_H - rTop + Math.sin(t) * rTop, 0.0002 + rTop - Math.cos(t) * rTop]);
  }
  const R = (LABEL_OFF - LABEL_IN) / 2;
  const yb = R - 0.0014;
  prof.push([LABEL_H * 0.5, LABEL_OFF]);
  for (let a = 0; a <= 10; a++) {
    const t = (Math.PI * a) / 10;
    prof.push([yb - Math.sin(t) * R, LABEL_IN + R + Math.cos(t) * R]);
  }
  prof.push([LABEL_H * 0.5, LABEL_IN], [LABEL_H - 0.002, LABEL_IN]);
  const XS = 8;
  const P = prof.length;
  const pos = [];
  const uv = [];
  for (let r = 0; r < P; r++)
    for (let c = 0; c <= XS; c++) {
      const x = (c / XS - 0.5) * LABEL_W;
      const [y, z] = prof[r];
      pos.push(x, y, z);
      // Las dos caras muestran el diseño derecho (la de adentro, espejada).
      const out = z > (LABEL_OFF + LABEL_IN) / 2;
      uv.push(out ? c / XS : 1 - c / XS, Math.min(1, Math.max(0, y / LABEL_H)));
    }
  const idx = [];
  for (let r = 0; r < P - 1; r++)
    for (let c = 0; c < XS; c++) {
      const a = r * (XS + 1) + c;
      idx.push(a, a + XS + 1, a + 1, a + 1, a + XS + 1, a + XS + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
label.geo = labelGeometry();
for (const rig of rigs) {
  const m = new THREE.Mesh(label.geo, labelMat);
  m.matrixAutoUpdate = false;
  m.userData.piece = 'label';
  m.visible = false;
  m.castShadow = true;
  m.receiveShadow = true;
  rig.userData.inner.add(m);
  label.meshes.push(m);
}
// Columna del ruedo del frente: desde la costura del costado de la derecha
// (x > 0, mirando el frente) hasta LABEL_SIDE a lo largo del borde.
function buildLabel() {
  const pos = built.geos.front.attributes.position.array;
  const C = built.layout.cols;
  const right = pos[C * 3] > pos[0];
  const step = right ? -1 : 1;
  let j = right ? C : 0;
  let acc = 0;
  label.f = 0;
  for (; j + step >= 0 && j + step <= C; j += step) {
    const l = Math.hypot(pos[(j + step) * 3] - pos[j * 3], pos[(j + step) * 3 + 1] - pos[j * 3 + 1], pos[(j + step) * 3 + 2] - pos[j * 3 + 2]);
    if (acc + l >= LABEL_SIDE) {
      label.f = (LABEL_SIDE - acc) / l;
      break;
    }
    acc += l;
  }
  // Del lado de j hacia j + step: a lo largo apunta a la izquierda de quien
  // mira; se da vuelta para que apunte a la derecha.
  label.j = j;
  label.step = step;
  updateLabel();
}
const _o = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
function updateLabel() {
  const pos = built.geos.front.attributes.position.array;
  const W = built.layout.cols + 1;
  const { j, step, f } = label;
  const at = (v, i) => v.fromArray(pos, i * 3);
  // Borde del ruedo y la fila de unos 2 cm más arriba.
  at(_o, j).lerp(at(_t, j + step), f);
  const up = Math.min(built.layout.rows, 3);
  at(_u, up * W + j).lerp(at(_n, up * W + j + step), f).sub(_o);
  at(_t, j + step).sub(at(_n, j)).multiplyScalar(-1);
  _t.normalize();
  _u.addScaledVector(_t, -_u.dot(_t)).normalize();
  _n.crossVectors(_t, _u);
  for (const m of label.meshes) {
    m.matrix.makeBasis(_t, _u, _n).setPosition(_o);
    m.matrixWorldNeedsUpdate = true;
  }
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
  if (turn) turn.gap[1] = VIEWS[turn.view].gap - turn.gap[0];
  else rigs.forEach((rig, j) => (rig.position.x = (j ? 1 : -1) * VIEWS[view.pair].gap));
  syncCurls();
}
function rebuild() {
  built = buildShirt(params);
  fitPair();
  for (const [k, mesh] of Object.entries(meshes)) {
    mesh.geometry.dispose();
    mesh.geometry = twins[k].geometry = built.geos[k];
  }
  buildTape();
  buildLabel();
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
      updateLabel();
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
  const lt = !view.uvmap && design.labelTex;
  labelMat.map = lt ? lt.color : null;
  labelMat.normalMap = lt ? lt.normal : null;
  labelMat.needsUpdate = true;
  for (const m of label.meshes) m.visible = !!lt;
  document.querySelector('[data-zoom="label"]').hidden = !design.labelTex;
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
  updateHint();
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
  // En Personalización, una imagen elegida de la biblioteca va a la pieza que
  // se toca, y agarrar un escudo o una marca lo mueve.
  if (dropArmed(e) || grabApp(e)) {
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

// ---------- personalización ----------

// Biblioteca de imágenes (id → { id, name, img, url, app, session }) y lo que
// lleva la camiseta: una imagen por pieza ({ id, fit: { scale, dx, dy } },
// que cubre la pieza, agrandada y corrida en mm) y aplicaciones sueltas
// ({ uid, id, piece, x, y, w, as }: centro y ancho en mm de estampado, y si
// van bordadas, en vinilo o sublimadas). Las de la configuración (`session`)
// no se guardan.
const lib = new Map();
const dress = { pieces: {}, apps: [] };
const SLOTS = ['front', 'back', 'sleeveL', 'sleeveR', 'cuffL', 'cuffR', 'collar', 'tape', 'label'];
const APP_PIECES = ['front', 'back', 'sleeveL', 'sleeveR'];
const APP_AS = { emb: 'Bordado', vin: 'Vinilo', print: 'Sublimado' };
const CREST_NAME = /escudo|crest|badge|emblema|insignia|parche/i;
const BRAND_NAME = /marca|logo|brand|sponsor/i;
// Un escudo o una marca que llegan por el nombre (sin soltarlos): al pecho,
// el escudo a la izquierda de quien la lleva (a la derecha mirándola).
const APP_SPOT = { crest: { x: 95, y: 110, w: 75, as: 'emb' }, brand: { x: -95, y: 110, w: 70, as: 'vin' } };
const SLOT_COLOR = { front: 'body', back: 'body', sleeveL: 'sleeves', sleeveR: 'sleeves', cuffL: 'cuffs', cuffR: 'cuffs', collar: 'collar', tape: 'collar' };
let store = null;
const designNote = document.getElementById('design-note');
const designClear = document.getElementById('design-clear');
const sizesBox = document.getElementById('design-sizes');
const libGrid = document.getElementById('lib-grid');
const slotList = document.getElementById('slots');
const appList = document.getElementById('apps');
const editor = document.getElementById('editor');
const edCanvas = document.getElementById('editor-canvas');
const edScale = document.getElementById('ed-scale');
const fitOf = (k) => dress.pieces[k]?.fit;
const hasDress = () => Object.keys(dress.pieces).length > 0 || dress.apps.length > 0;
let selected = null; // { piece } o { app: uid }

sizesBox.addEventListener('toggle', () => {
  if (!sizesBox.open) return;
  ensureFlat();
  fillSizes();
});
// Medidas de cada pieza (mm): las del molde, más el tapacostura y la
// etiqueta (recuadros centrados).
function sizesNow() {
  return {
    ...pieceSizes(built),
    tape: { w: tape.len * 1000, h: tape.w * 1000, top: -tape.w * 500 },
    label: { w: LABEL_W * 1000, h: LABEL_H * 1000, top: -LABEL_H * 500 },
  };
}
const SIZE_ROWS = [
  ['front', 'Frente'],
  ['back', 'Espalda'],
  ['sleeveR', 'Manga (cada una)'],
  ['cuffR', 'Puño (cada uno)'],
  ['collar', 'Cuello (vuelta entera)'],
  ['tape', 'Tapacostura (por dentro)'],
  ['label', 'Etiqueta (ruedo, cara de afuera)'],
];
const cmUp = (mm, d = 0) => (Math.ceil(mm / 10 ** (1 - d)) / 10 ** d).toFixed(d).replace('.', ',');
function fillSizes() {
  if (!sizesBox.open) return;
  const sz = sizesNow();
  sizesBox.querySelector('dl').innerHTML = SIZE_ROWS.map(([k, label]) => {
    const d = sz[k].h < 50 ? 1 : 0;
    return `<div><dt>${label}</dt><dd>${cmUp(sz[k].w)} × ${cmUp(sz[k].h, d)} cm</dd></div>`;
  }).join('');
}

// Texturas de una pieza (o del tapacostura o la etiqueta) con su imagen y
// sus aplicaciones.
function renderPiece(k, sz) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const p = dress.pieces[k];
  const item = p && lib.get(p.id);
  if (k === 'tape' || k === 'label') {
    if (k === 'tape') {
      design.tapeTex?.dispose();
      design.tapeTex = null;
      if (!item) return;
      design.tapeTex = new THREE.CanvasTexture(placeTape(item.img, sz.tape.w, sz.tape.h, p.fit));
      design.tapeTex.colorSpace = THREE.SRGBColorSpace;
      design.tapeTex.anisotropy = aniso;
    } else {
      disposeLabel();
      if (!item) return;
      const r = placeLabel(item.img, sz.label.w, sz.label.h, p.fit);
      const tex = (c, srgb) => {
        const t = new THREE.CanvasTexture(c);
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso;
        return t;
      };
      design.labelTex = { color: tex(r.color, true), normal: tex(r.normal, false) };
    }
    return;
  }
  design.textures[k]?.dispose();
  delete design.textures[k];
  delete design.inside[k];
  if (design.app[k]) {
    design.app[k].color.dispose();
    design.app[k].shape.dispose();
    delete design.app[k];
  }
  const apps = dress.apps.filter((a) => a.piece === k && lib.has(a.id)).map((a) => ({ ...a, img: lib.get(a.id).img }));
  if (!item && !apps.length) return;
  const c = pieceCanvases(k, sz[k], item ? { img: item.img, fit: p.fit } : null, apps);
  design.textures[k] = printTexture(k, c.print, aniso);
  if (item) design.inside[k] = dominantColor(c.print, c.rect);
  const app = (c.emb || c.vin) && buildApplique(k, c.emb, c.vin, c.k, c.box);
  if (app) design.app[k] = app;
}
function disposeLabel() {
  design.labelTex?.color.dispose();
  design.labelTex?.normal.dispose();
  design.labelTex = null;
}
// Rehace las texturas de las piezas que se piden (todas, si no) y guarda.
function renderDress(keys = SLOTS) {
  if (hasDress()) ensureFlat();
  const sz = sizesNow();
  for (const k of keys) renderPiece(k, sz);
  designClear.hidden = !hasDress();
  applyLook();
  saveDress();
}
// Mientras se arrastra algo, una vez por cuadro.
const pendingKeys = new Set();
let renderFrame = 0;
function scheduleRender(k) {
  pendingKeys.add(k);
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    const keys = [...pendingKeys];
    pendingKeys.clear();
    renderDress(keys);
  });
}
let saveTimer = 0;
function saveDress() {
  if (!store) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keep = (id) => lib.has(id) && !lib.get(id).session;
    const pieces = Object.fromEntries(Object.entries(dress.pieces).filter(([, p]) => keep(p.id)));
    store.putState('dress', { pieces, apps: dress.apps.filter((a) => keep(a.id)) }).catch(() => {});
  }, 400);
}

// ---------- biblioteca ----------

const IMAGE_TYPE = /^image\/(png|jpeg|webp|svg\+xml)$/;
const IMAGE_NAME = /\.(png|jpe?g|webp|svg)$/i;
// Agrega imágenes (File, o { name, blob }) a la biblioteca. Las que dicen su
// pieza en el nombre van a esa pieza; un escudo o una marca, al pecho.
async function addImages(files, { session = false } = {}) {
  const added = [];
  const bad = [];
  for (const f of files) {
    const blob = f.blob || f;
    if (!IMAGE_TYPE.test(blob.type) && !IMAGE_NAME.test(f.name)) {
      bad.push(f.name);
      continue;
    }
    let dec;
    try {
      dec = await decodeImage(blob);
    } catch {
      bad.push(f.name);
      continue;
    }
    const app = CREST_NAME.test(f.name) || BRAND_NAME.test(f.name) || transparency(dec.img) > 0.3;
    const item = { id: newId(), name: f.name, img: dec.img, url: dec.url, app, session };
    lib.set(item.id, item);
    if (!session && store) store.put({ id: item.id, name: item.name, type: blob.type, blob, added: Date.now(), app }).catch(() => {});
    added.push(item);
  }
  const placed = autoAssign(added);
  renderLibrary();
  renderSlots();
  renderApps();
  const notes = [];
  if (added.length) notes.push(`${added.length === 1 ? 'Una imagen agregada' : `${added.length} imágenes agregadas`}${placed.length ? ` (${placed.join(', ')})` : ''}`);
  if (bad.length) notes.push(`no se pudo leer ${bad.join(', ')} (tiene que ser PNG, JPG, WebP o SVG)`);
  designNote.textContent = notes.length ? `${notes.join(' · ')}.` : '';
  if (placed.length) renderDress();
  return added;
}
function autoAssign(items) {
  const placed = [];
  for (const item of items) {
    const kind = CREST_NAME.test(item.name) ? 'crest' : BRAND_NAME.test(item.name) ? 'brand' : null;
    if (kind) {
      if (!dress.apps.some((a) => a.id === item.id)) dress.apps.push({ uid: newId(), id: item.id, piece: 'front', ...APP_SPOT[kind] });
      placed.push(`${kind === 'crest' ? 'escudo' : 'marca'} al pecho`);
      continue;
    }
    const keys = pieceKeys(item.name);
    for (const k of keys) dress.pieces[k] = { id: item.id, fit: { scale: 1, dx: 0, dy: 0 } };
    if (keys.length) placed.push(keys.map((k) => PIECE_LABELS[k].toLowerCase()).join(' y '));
  }
  return placed;
}
function removeImage(id) {
  const item = lib.get(id);
  if (!item) return;
  lib.delete(id);
  if (armed === item) arm(null);
  if (!item.session) store?.remove(id).catch(() => {});
  setTimeout(() => URL.revokeObjectURL(item.url), 1000);
  const keys = new Set();
  for (const [k, p] of Object.entries(dress.pieces))
    if (p.id === id) {
      delete dress.pieces[k];
      keys.add(k);
    }
  dress.apps = dress.apps.filter((a) => a.id !== id || (keys.add(a.piece), false));
  renderLibrary();
  renderSlots();
  renderApps();
  if (keys.size) renderDress([...keys]);
}
// Una imagen a una pieza (de fondo) o, si es un escudo o una marca y cae en
// el frente, la espalda o una manga, como aplicación en ese punto (mm).
function assign(id, k, at = null) {
  const item = lib.get(id);
  if (!item) return;
  if (item.app && at && APP_PIECES.includes(k)) {
    const kind = BRAND_NAME.test(item.name) ? 'brand' : 'crest';
    const a = { uid: newId(), id, piece: k, x: at[0], y: at[1], w: APP_SPOT[kind].w, as: APP_SPOT[kind].as };
    dress.apps.push(a);
    selected = { app: a.uid };
  } else {
    dress.pieces[k] = { id, fit: { scale: 1, dx: 0, dy: 0 } };
    selected = { piece: k };
  }
  renderSlots();
  renderApps();
  renderDress([k]);
  drawEditor();
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter(Boolean));
  return e;
}
function closeButton(label, onClick) {
  const b = el('button', { type: 'button', className: 'x', textContent: '×', title: label });
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}
function renderLibrary() {
  libGrid.replaceChildren(
    ...[...lib.values()].map((item) => {
      const t = el('div', { className: 'thumb', title: item.name }, el('img', { src: item.url, alt: '' }), el('span', { textContent: item.name }), item.app && el('em', { textContent: 'aplicación' }));
      t.dataset.id = item.id;
      t.tabIndex = 0;
      if (armed === item) t.classList.add('armed');
      t.append(closeButton(`Sacar ${item.name} de la biblioteca`, () => removeImage(item.id)));
      t.addEventListener('pointerdown', (e) => startLibDrag(e, item));
      t.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), arm(armed === item ? null : item)));
      return t;
    }),
  );
}
function renderSlots() {
  slotList.replaceChildren(
    ...SLOTS.map((k) => {
      const item = dress.pieces[k] && lib.get(dress.pieces[k].id);
      const li = el('li', { className: `slot${item ? '' : ' empty'}`, title: item ? item.name : `Soltá una imagen para ${PIECE_LABELS[k].toLowerCase()}` }, item ? el('img', { className: 'slot-img', src: item.url, alt: '' }) : el('span', { className: 'slot-img' }), el('span', { className: 'slot-name', textContent: PIECE_LABELS[k] }));
      li.dataset.piece = k;
      li.setAttribute('aria-selected', String(selected?.piece === k));
      li.tabIndex = 0;
      if (item)
        li.append(
          closeButton(`Quitar la imagen de ${PIECE_LABELS[k].toLowerCase()}`, () => {
            delete dress.pieces[k];
            renderSlots();
            renderDress([k]);
            drawEditor();
          }),
        );
      const pick = () => {
        if (armed) {
          const item = armed;
          arm(null);
          return assign(item.id, k);
        }
        selected = { piece: k };
        renderSlots();
        renderApps();
        drawEditor();
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      return li;
    }),
  );
}
function renderApps() {
  document.getElementById('apps-empty').hidden = dress.apps.length > 0;
  appList.replaceChildren(
    ...dress.apps.map((a) => {
      const item = lib.get(a.id);
      if (!item) return '';
      const seg = el('div', { className: 'seg' }, ...Object.entries(APP_AS).map(([as, label]) => el('button', { type: 'button', textContent: label })));
      [...seg.children].forEach((b, i) => {
        const as = Object.keys(APP_AS)[i];
        b.setAttribute('aria-pressed', String(a.as === as));
        b.addEventListener('click', () => {
          a.as = as;
          renderApps();
          renderDress([a.piece]);
        });
      });
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Cómo va');
      const range = el('input', { type: 'range', min: 20, max: 300, step: 1, value: a.w });
      const out = el('output', { textContent: `${cmUp(a.w, 1)} cm` });
      range.setAttribute('aria-label', 'Ancho');
      range.addEventListener('input', () => {
        a.w = +range.value;
        out.textContent = `${cmUp(a.w, 1)} cm`;
        paintRange(range);
        scheduleRender(a.piece);
        drawEditor();
      });
      paintRange(range);
      const size = el('div', { className: 'control' }, el('span', { className: 'label', textContent: 'Ancho' }), out, range);
      const li = el('li', { className: 'app' }, el('img', { src: item.url, alt: '' }), el('div', { className: 'app-main' }, el('span', { className: 'app-name', textContent: `${item.name} · ${PIECE_LABELS[a.piece]}` }), seg, size));
      li.setAttribute('aria-selected', String(selected?.app === a.uid));
      li.append(
        closeButton(`Quitar ${item.name}`, () => {
          dress.apps = dress.apps.filter((x) => x !== a);
          if (selected?.app === a.uid) selected = null;
          renderApps();
          renderDress([a.piece]);
          drawEditor();
        }),
      );
      li.addEventListener('click', (e) => {
        if (e.target.closest('button, input')) return;
        selected = { app: a.uid };
        renderSlots();
        renderApps();
        drawEditor();
      });
      return li;
    }),
  );
}
function paintRange(input) {
  input.style.setProperty('--fill', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
}

// ---------- editor de una pieza ----------

// La pieza plana (como se corta, vista de afuera) con su imagen, lo que
// sobra apenas marcado, y sus aplicaciones. Arrastrar mueve la imagen (o la
// aplicación que se agarra); la rueda la agranda o la achica.
let edView = null;
function editorPiece() {
  if (selected?.piece) return selected.piece;
  const a = selected?.app && dress.apps.find((x) => x.uid === selected.app);
  return a ? a.piece : null;
}
function drawEditor() {
  const k = editorPiece();
  editor.hidden = !k;
  if (!k) return;
  flatNow();
  const sz = sizesNow()[k];
  const p = dress.pieces[k];
  const item = p && lib.get(p.id);
  document.getElementById('editor-title').textContent = `${PIECE_LABELS[k]}${item ? ` · ${item.name}` : ''}`;
  document.getElementById('ed-scale-row').hidden = !item;
  document.getElementById('ed-center').hidden = !item;
  if (item) {
    edScale.value = p.fit.scale;
    document.getElementById('ed-scale-out').textContent = `${Math.round(p.fit.scale * 100)} %`;
    paintRange(edScale);
  }
  const loops = k === 'tape' || k === 'label' ? [[[-sz.w / 2, sz.top], [sz.w / 2, sz.top], [sz.w / 2, sz.top + sz.h], [-sz.w / 2, sz.top + sz.h]]] : pieceOutline(built, k);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of loops)
    for (const [x, y] of l) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const cssW = edCanvas.clientWidth || 276;
  const cssH = Math.min(340, Math.max(60, (cssW * (y1 - y0)) / (x1 - x0)));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  edCanvas.style.height = `${cssH}px`;
  edCanvas.width = Math.round(cssW * dpr);
  edCanvas.height = Math.round(cssH * dpr);
  const s = Math.min(cssW / (x1 - x0), cssH / (y1 - y0)) * dpr;
  const ox = (edCanvas.width - (x1 - x0) * s) / 2 - x0 * s;
  const oy = (edCanvas.height - (y1 - y0) * s) / 2 - y0 * s;
  edView = { k, s, ox, oy, dpr };
  const g = edCanvas.getContext('2d');
  g.clearRect(0, 0, edCanvas.width, edCanvas.height);
  const outline = new Path2D();
  for (const l of loops) l.forEach(([x, y], i) => (i ? outline.lineTo(x * s + ox, y * s + oy) : outline.moveTo(x * s + ox, y * s + oy)));
  outline.closePath();
  g.fillStyle = k === 'label' ? '#f4f1e8' : colors[SLOT_COLOR[k]];
  g.fill(outline);
  const drawImg = (img, r) => g.drawImage(img, r.x * s + ox, r.y * s + oy, r.w * s, r.h * s);
  if (item) {
    const r = coverRect(sz, item.img.width, item.img.height, p.fit, k === 'tape' || k === 'label' ? 0 : BLEED);
    g.globalAlpha = 0.28;
    drawImg(item.img, r);
    g.globalAlpha = 1;
    g.save();
    g.clip(outline);
    drawImg(item.img, r);
    if (sz.wrap) for (const d of [-1, 1]) drawImg(item.img, { ...r, x: r.x + d * sz.wrap });
    g.restore();
  }
  for (const a of dress.apps) {
    if (a.piece !== k || !lib.has(a.id)) continue;
    const img = lib.get(a.id).img;
    const r = appRect(a, img);
    drawImg(img, r);
    if (selected?.app === a.uid) {
      g.setLineDash([4 * dpr, 3 * dpr]);
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      g.lineWidth = 1.5 * dpr;
      g.strokeRect(r.x * s + ox, r.y * s + oy, r.w * s, r.h * s);
      g.setLineDash([]);
    }
  }
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
  g.lineWidth = 1.2 * dpr;
  g.stroke(outline);
}
const appRect = (a, img) => {
  const h = (a.w * img.height) / img.width;
  return { x: a.x - a.w / 2, y: a.y - h / 2, w: a.w, h };
};
function appAt(k, x, y) {
  for (let i = dress.apps.length - 1; i >= 0; i--) {
    const a = dress.apps[i];
    if (a.piece !== k || !lib.has(a.id)) continue;
    const r = appRect(a, lib.get(a.id).img);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return a;
  }
  return null;
}
const edPoint = (e) => {
  const r = edCanvas.getBoundingClientRect();
  const { s, ox, oy, dpr } = edView;
  return [((e.clientX - r.left) * dpr - ox) / s, ((e.clientY - r.top) * dpr - oy) / s];
};
let edDrag = null;
edCanvas.addEventListener('pointerdown', (e) => {
  if (!edView) return;
  const [x, y] = edPoint(e);
  const a = appAt(edView.k, x, y);
  const p = dress.pieces[edView.k];
  if (!a && !p) return;
  if (a && selected?.app !== a.uid) {
    selected = { app: a.uid };
    renderApps();
  }
  edDrag = { id: e.pointerId, a, x, y, start: a ? [a.x, a.y] : [p.fit.dx, p.fit.dy] };
  edCanvas.setPointerCapture(e.pointerId);
});
edCanvas.addEventListener('pointermove', (e) => {
  if (!edDrag || e.pointerId !== edDrag.id) return;
  const [x, y] = edPoint(e);
  const [dx, dy] = [x - edDrag.x, y - edDrag.y];
  if (edDrag.a) [edDrag.a.x, edDrag.a.y] = [edDrag.start[0] + dx, edDrag.start[1] + dy];
  else {
    const f = dress.pieces[edView.k]?.fit;
    if (!f) return;
    [f.dx, f.dy] = [edDrag.start[0] + dx, edDrag.start[1] + dy];
  }
  drawEditor();
  scheduleRender(edView.k);
});
const endEdDrag = () => (edDrag = null);
edCanvas.addEventListener('pointerup', endEdDrag);
edCanvas.addEventListener('pointercancel', endEdDrag);
edCanvas.addEventListener(
  'wheel',
  (e) => {
    if (!edView) return;
    const [x, y] = edPoint(e);
    const a = appAt(edView.k, x, y);
    const f = fitOf(edView.k);
    if (!a && !f) return;
    e.preventDefault();
    const z = Math.exp(-e.deltaY * 0.0015);
    if (a) a.w = Math.min(300, Math.max(20, a.w * z));
    else f.scale = Math.min(3, Math.max(0.5, f.scale * z));
    if (a) renderApps();
    drawEditor();
    scheduleRender(edView.k);
  },
  { passive: false },
);
edScale.addEventListener('input', () => {
  const f = fitOf(editorPiece());
  if (!f) return;
  f.scale = +edScale.value;
  drawEditor();
  scheduleRender(editorPiece());
});
document.getElementById('ed-center').addEventListener('click', () => {
  const f = fitOf(editorPiece());
  if (!f) return;
  Object.assign(f, { scale: 1, dx: 0, dy: 0 });
  drawEditor();
  renderDress([editorPiece()]);
});
window.addEventListener('resize', () => drawEditor());

// ---------- arrastrar a la camiseta ----------

// Pieza bajo el puntero (y su punto en mm de estampado), en cualquiera de
// las dos camisetas: tela, tapacostura o etiqueta.
function pieceAt(x, y) {
  const r = dom.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  pointer.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = [...clothMeshes, ...rigs.flatMap((rig) => rig.userData.inner.children.filter((m) => m.userData.piece === 'tape' || (m.userData.piece === 'label' && m.visible)))];
  const hit = raycaster.intersectObjects(targets, false)[0];
  if (!hit) return null;
  let key = hit.object.userData.piece;
  if (key === 'hem') key = hit.object.userData.rig.worldToLocal(hit.point.clone()).z >= 0 ? 'front' : 'back';
  const uv = hit.object.userData.piece === key && hit.uv1 ? [hit.uv1.x * 1000, hit.uv1.y * 1000] : null;
  return { key, at: uv };
}
// Resaltado de la pieza a la que va lo que se arrastra.
let lit = null;
function highlight(k) {
  if (lit === k) return;
  const mats = (key) => (key === 'tape' ? [tapeMat] : key === 'label' ? [labelMat] : key && meshes[key] ? [meshes[key].material] : []);
  for (const m of mats(lit)) m.emissive.setRGB(0, 0, 0);
  for (const m of mats(k)) m.emissive.setRGB(0.16, 0.16, 0.16);
  lit = k;
  requestRender();
}
const ghost = el('img', { className: 'drag-ghost', alt: '' });
const tip = el('div', { className: 'drop-tip' });
let libDrag = null;
function startLibDrag(e, item) {
  if (e.button > 0) return;
  // Sin esto el arrastre selecciona el texto del panel.
  e.preventDefault();
  libDrag = { item, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, target: null };
  e.currentTarget.setPointerCapture(e.pointerId);
}
function dropTarget(e) {
  ghost.hidden = tip.hidden = true;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  ghost.hidden = tip.hidden = false;
  const slot = under?.closest('.slot');
  if (slot) return { key: slot.dataset.piece, slot };
  if (under !== dom) return null;
  return pieceAt(e.clientX, e.clientY);
}
document.addEventListener('pointermove', (e) => {
  if (!libDrag || e.pointerId !== libDrag.id) return;
  if (!libDrag.on) {
    if (Math.hypot(e.clientX - libDrag.x, e.clientY - libDrag.y) < 5) return;
    libDrag.on = true;
    document.body.classList.add('dragging');
    ghost.src = libDrag.item.url;
    document.body.append(ghost, tip);
    if (libDrag.item.app) flatNow();
  }
  ghost.style.left = tip.style.left = `${e.clientX}px`;
  ghost.style.top = tip.style.top = `${e.clientY}px`;
  const t = dropTarget(e);
  libDrag.target = t;
  slotList.querySelectorAll('.slot').forEach((s) => s.classList.toggle('target', s === t?.slot));
  highlight(t && !t.slot ? t.key : null);
  const asApp = t && !t.slot && libDrag.item.app && t.at && APP_PIECES.includes(t.key);
  tip.textContent = t ? (asApp ? `Aplicación en ${PIECE_LABELS[t.key].toLowerCase()}` : PIECE_LABELS[t.key]) : 'Soltá sobre una pieza';
});
function endLibDrag(e) {
  if (!libDrag || e.pointerId !== libDrag.id) return;
  const { item, on, target } = libDrag;
  libDrag = null;
  document.body.classList.remove('dragging');
  ghost.remove();
  tip.remove();
  highlight(null);
  slotList.querySelectorAll('.slot.target').forEach((s) => s.classList.remove('target'));
  if (!on) {
    arm(armed === item ? null : item);
    return;
  }
  if (e.type === 'pointerup' && target) assign(item.id, target.key, target.slot ? null : target.at);
}
document.addEventListener('pointerup', endLibDrag);
document.addEventListener('pointercancel', endLibDrag);

// Tocar una miniatura y después una pieza (o su casillero) también la pone:
// en el celular, la biblioteca queda lejos de la camiseta.
let armed = null;
function arm(item) {
  armed = item;
  libGrid.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('armed', t.dataset.id === item?.id));
  designNote.textContent = item ? `Tocá una pieza de la camiseta o un casillero para poner ${item.name} (o arrastrala).` : '';
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && armed && arm(null));
function dropArmed(e) {
  if (!armed || view.tab !== 'perso') return false;
  const t = pieceAt(e.clientX, e.clientY);
  if (!t) return false;
  const item = armed;
  arm(null);
  assign(item.id, t.key, t.at);
  return true;
}

// Aplicaciones: en Personalización, arrastrar una sobre la camiseta la mueve.
let appDrag = null;
function grabApp(e) {
  if (view.tab !== 'perso') return false;
  const t = pieceAt(e.clientX, e.clientY);
  const a = t && t.at && appAt(t.key, ...t.at);
  if (!a) return false;
  flatNow();
  appDrag = { id: e.pointerId, a, off: [a.x - t.at[0], a.y - t.at[1]] };
  dom.setPointerCapture(e.pointerId);
  if (selected?.app !== a.uid) {
    selected = { app: a.uid };
    renderSlots();
    renderApps();
    drawEditor();
  }
  return true;
}
dom.addEventListener('pointermove', (e) => {
  if (appDrag) {
    if (e.pointerId !== appDrag.id) return;
    const t = pieceAt(e.clientX, e.clientY);
    if (!t || t.key !== appDrag.a.piece || !t.at) return;
    appDrag.a.x = t.at[0] + appDrag.off[0];
    appDrag.a.y = t.at[1] + appDrag.off[1];
    scheduleRender(appDrag.a.piece);
    drawEditor();
    return;
  }
  // Sobre una aplicación, el puntero avisa que se puede mover (mirando cada
  // tanto: buscar la pieza bajo el puntero cuesta).
  if (view.tab !== 'perso' || e.buttons || e.pointerType !== 'mouse' || !dress.apps.length) {
    dom.style.cursor = '';
    return;
  }
  const now = performance.now();
  if (now - hoverAt < 80) return;
  hoverAt = now;
  const t = pieceAt(e.clientX, e.clientY);
  dom.style.cursor = t && t.at && appAt(t.key, ...t.at) ? 'move' : '';
});
let hoverAt = 0;
const endAppDrag = (e) => {
  if (appDrag && e.pointerId === appDrag.id) appDrag = null;
};
dom.addEventListener('pointerup', endAppDrag);
dom.addEventListener('pointercancel', endAppDrag);

// Archivos arrastrados desde la computadora: a la biblioteca (y, si caen
// sobre una pieza, a esa pieza).
const libDrop = document.getElementById('lib-drop');
const libFile = document.getElementById('lib-file');
document.getElementById('lib-add').addEventListener('click', () => libFile.click());
libFile.addEventListener('change', async () => {
  await addImages([...libFile.files]);
  libFile.value = '';
});
const hasFiles = (e) => [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file');
for (const zone of [stage, libDrop]) {
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dropping'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dropping');
    const t = zone === stage ? pieceAt(e.clientX, e.clientY) : null;
    const added = await addImages([...e.dataTransfer.files]);
    if (t && added.length === 1) assign(added[0].id, t.key, t.at);
    if (added.length) showTab('perso');
  });
}
designClear.addEventListener('click', () => {
  dress.pieces = {};
  dress.apps = [];
  selected = null;
  renderSlots();
  renderApps();
  drawEditor();
  renderDress();
  designNote.textContent = 'La camiseta quedó sin diseño; la biblioteca sigue.';
});

// Al abrir: la biblioteca guardada y lo que tenía la camiseta (o, si la
// página viene configurada con diseños, esos).
async function initLibrary() {
  store = await openStore();
  const recs = store ? await store.images().catch(() => []) : [];
  recs.sort((a, b) => a.added - b.added);
  for (const rec of recs) {
    try {
      const dec = await decodeImage(rec.blob);
      lib.set(rec.id, { id: rec.id, name: rec.name, img: dec.img, url: dec.url, app: !!rec.app, session: false });
    } catch {
      // Una imagen que ya no se puede leer queda afuera.
    }
  }
  const cfg = Array.isArray(CONFIG.design) ? CONFIG.design.filter((d) => typeof d?.text === 'string' && typeof d?.name === 'string') : [];
  if (cfg.length) {
    await addImages(
      cfg.map((d) => ({ name: d.name, blob: new Blob([d.text], { type: 'image/svg+xml' }) })),
      { session: true },
    );
  } else {
    const saved = store ? await store.getState('dress').catch(() => null) : null;
    if (saved) {
      for (const [k, p] of Object.entries(saved.pieces || {})) if (SLOTS.includes(k) && lib.has(p.id)) dress.pieces[k] = p;
      dress.apps = (saved.apps || []).filter((a) => lib.has(a.id) && APP_PIECES.includes(a.piece));
    }
  }
  renderLibrary();
  renderSlots();
  renderApps();
  if (hasDress()) renderDress();
}

// ---------- solapas ----------

const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
function showTab(id) {
  view.tab = id;
  tabs.forEach((t) => {
    const on = t.dataset.tab === id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  updateHint();
  if (id === 'perso') drawEditor();
  try {
    localStorage.setItem('camiseta-tab', id);
  } catch {
    // Sin almacenamiento: arranca siempre en Ajustes.
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => showTab(t.dataset.tab));
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const n = tabs[(i + d + tabs.length) % tabs.length];
    showTab(n.dataset.tab);
    n.focus();
  });
});
function updateHint() {
  document.querySelector('.hint').textContent =
    view.tab === 'perso'
      ? 'Arrastrá una imagen de la biblioteca a una pieza · arrastrá un escudo para moverlo'
      : view.mode === 'body'
        ? 'Arrastrá sobre una camiseta para girarla · rueda o pellizco para acercar'
        : matchMedia('(hover: none)').matches
          ? 'Tocá la tela para moverla · arrastrá para girar cada camiseta'
          : 'Pasá el mouse sobre la tela para moverla · arrastrá para girar cada camiseta';
}

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
  if (name === 'label') return zoomLabel();
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
// Etiqueta: de frente a su cara de afuera, apenas de arriba.
function zoomLabel() {
  const m = label.meshes[0];
  m.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(0, LABEL_H * 0.45, LABEL_OFF).applyMatrix4(m.matrixWorld);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(m.matrixWorld);
  n.y = Math.max(n.y, 0) + 0.25;
  n.normalize();
  flyTo(p, p.clone().addScaledVector(n, 0.2));
  zoomButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.zoom === 'label')));
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
  camera.fov = w / h < PAIR_ASPECT ? 28 * (PAIR_ASPECT / Math.max(w / h, 0.45)) ** 0.8 : 28;
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
let savedTab = 'ajustes';
try {
  savedTab = localStorage.getItem('camiseta-tab') || savedTab;
} catch {
  // Sin almacenamiento: Ajustes.
}
showTab(tabs.some((t) => t.dataset.tab === savedTab) ? savedTab : 'ajustes');
initLibrary();

window.__camiseta = { params, colors, fabric, rebuild, applyLook, applyFabric, setLight, syncControls, camera, controls, scene, meshes, rigs, view, goToView, zoomTo, setMode, design, drape: () => drape, lib, dress, addImages, assign, renderDress, showTab, pieceAt };
