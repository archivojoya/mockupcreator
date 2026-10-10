import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SvgMold, PART_DEFS } from './svgMold.js';
import { buildFromTemplate } from './template.js';
import hangingTemplate from './assets/tshirt-template.json';
import heldTemplate from './assets/tshirt-maniqui.json';
import { Atlas, makeFabricNormalMap, makeRibNormalMap, FABRIC_TILE_M } from './atlas.js';
import { bakeAO, ensureAOAttributes } from './bakeAO.js';
import './style.css';

const SPACING = 0.43;
// Dos formas de mostrar la camiseta, cada una con su plantilla simulada:
// sostenida por un maniquí invisible o colgada de una percha.
const TEMPLATES = { sostenida: heldTemplate, colgada: hangingTemplate };
const PRESENTATIONS = {
  ambas: [{ style: 'sostenida', base: 0 }, { style: 'colgada', base: 0 }],
  sostenida: [{ style: 'sostenida', base: 0 }, { style: 'sostenida', base: Math.PI }],
  colgada: [{ style: 'colgada', base: 0 }, { style: 'colgada', base: Math.PI }],
};
const WALL_Z = -0.42;
const HELD_CENTER_Y = -0.37;
const viewport = document.getElementById('viewport');
const statusEl = document.getElementById('status');

// ---------- render ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// La escena no se mueve (sólo la cámara): las sombras se calculan una vez.
renderer.shadowMap.autoUpdate = false;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Luz ambiente de estudio (difusa): la tela es mate, así que no refleja.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

let needsRender = true;
function requestRender() {
  needsRender = true;
}
function refreshShadows() {
  renderer.shadowMap.needsUpdate = true;
  requestRender();
}
renderer.shadowMap.needsUpdate = true;
const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
camera.position.set(0, -0.3, 2.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.3, 0);
controls.enableDamping = true;
controls.minDistance = 0.35;
controls.maxDistance = 4;
// La pared queda quieta: se giran las camisetas. La cámara acerca hacia el
// puntero y se desplaza arrastrando el fondo (o con el botón derecho / dos dedos).
controls.enableRotate = false;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
// Sin perder la escena de vista: el desplazamiento queda dentro del perchero.
const PAN_LIMIT = { minX: -0.9, maxX: 0.9, minY: -0.85, maxY: 0.2 };
controls.addEventListener('change', () => {
  const t = controls.target;
  const cx = THREE.MathUtils.clamp(t.x, PAN_LIMIT.minX, PAN_LIMIT.maxX);
  const cy = THREE.MathUtils.clamp(t.y, PAN_LIMIT.minY, PAN_LIMIT.maxY);
  if (cx !== t.x || cy !== t.y) {
    camera.position.x += cx - t.x;
    camera.position.y += cy - t.y;
    t.x = cx;
    t.y = cy;
  }
  requestRender();
});
controls.update();

// Luz principal suave con sombra y relleno frío.
const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc9c0, 0.4);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff8f0, 1.9);
key.position.set(1.9, 1.7, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1.1;
key.shadow.camera.right = 1.1;
key.shadow.camera.top = 0.5;
key.shadow.camera.bottom = -1.1;
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 6;
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.01;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xf0f4ff, 0.3);
fill.position.set(-2.5, 0.4, 2);
scene.add(fill);

const wallMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 1, metalness: 0 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
wall.position.set(0, -0.5, WALL_Z);
// La pared no recibe sombra de las camisetas.
wall.receiveShadow = false;
scene.add(wall);

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Encuadre: que entren ambas camisetas en pantallas angostas.
  camera.fov = w / h < 1.2 ? 26 * (1.25 / Math.max(w / h, 0.55)) : 26;
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);

// ---------- materiales ----------

const fabricNormal = makeFabricNormalMap();
const rib = makeRibNormalMap();
const aoStrength = { value: 1 };

function fabricMaterial(map, normalMap) {
  const m = new THREE.MeshPhysicalMaterial({
    map,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0.1,
    // Brillo muy suave en ángulos rasantes, propio del poliéster.
    sheen: 0.3,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffffff),
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    side: THREE.DoubleSide,
  });
  // El interior de la prenda (caras traseras) muestra la tela sin estampar,
  // algo más oscura, como en una prenda sublimada. La oclusión precalculada
  // oscurece pliegues, axilas e interior.
  m.userData.inside = { value: new THREE.Color(0xffffff) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.insideColor = m.userData.inside;
    shader.uniforms.aoStrength = aoStrength;
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'attribute float aoF;\nattribute float aoB;\nvarying float vAoF;\nvarying float vAoB;\nvoid main() {\n vAoF = aoF;\n vAoB = aoB;',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 insideColor;\nuniform float aoStrength;\nvarying float vAoF;\nvarying float vAoB;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        // Por dentro se ve el estampado del revés (como en una prenda sublimada),
        // algo lavado hacia el color de la tela y más oscuro.
        '#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb = mix(insideColor, diffuseColor.rgb, 0.85) * 0.7;',
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
  float bakedAo = mix(1.0, gl_FrontFacing ? vAoF : vAoB, aoStrength);
  reflectedLight.indirectDiffuse *= bakedAo;
  reflectedLight.indirectSpecular *= bakedAo;
  reflectedLight.directDiffuse *= mix(1.0, bakedAo, 0.5);`,
      );
  };
  return m;
}

const hangerMats = {
  madera: new THREE.MeshStandardMaterial({ color: 0xb98d62, roughness: 0.85, metalness: 0 }),
  negra: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.8, metalness: 0 }),
  blanca: new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.85, metalness: 0 }),
};
const hookMat = new THREE.MeshStandardMaterial({ color: 0x8c8e91, roughness: 0.55, metalness: 0.6 });
const rodMat = new THREE.MeshStandardMaterial({ color: 0x6f7174, roughness: 0.7, metalness: 0.4 });

// ---------- estado ----------

const state = {
  parts: Object.fromEntries(PART_DEFS.map((d) => [d.key, { color: '#ffffff', design: true, auto: d.key === 'collar' }])),
  palette: {},
  logos: true,
  hanger: 'madera',
  ao: true,
  background: '#f7f5f1',
  presentation: 'ambas',
};

let mold = null;
let atlas = null;
let garmentGroup = null;
let materials = {};
let pickables = [];
let shirts = [];
let built = {}; // forma (sostenida / colgada) -> geometrías del molde actual
let buildToken = 0;

async function loadMold(text, name) {
  setStatus('Procesando molde…');
  await new Promise((r) => setTimeout(r, 20));
  const m = new SvgMold(text, name);
  if (!m.parts.front && !m.parts.back) throw new Error('No se detectaron piezas. Los grupos del SVG deben llamarse "frente", "espalda", "manga_izquierda", "manga_derecha" y "cuello".');
  mold = m;
  state.palette = Object.fromEntries(m.palette.map((c) => [c, c]));
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, 4096);
  atlas?.texture.dispose();
  atlas = new Atlas(m, maxTex);
  buildGarment();
  buildUI();
  await refreshTexture();
  setStatus('');
}

function disposeBuilt() {
  for (const b of Object.values(built)) {
    for (const geo of Object.values(b.geos)) geo.dispose();
    if (b.hanger) for (const geo of [b.hanger.bar, b.hanger.hook, b.hanger.tip]) geo.dispose();
  }
  built = {};
}

// La forma viene de la plantilla (ya simulada); el molde se estampa encima.
function shape(style) {
  if (!built[style]) {
    const b = buildFromTemplate(mold, atlas, TEMPLATES[style]);
    for (const geo of Object.values(b.geos)) ensureAOAttributes(geo);
    if (!b.hanger) {
      // Sostenida: gira sobre el eje vertical del torso.
      const box = new THREE.Box3();
      for (const k of ['front', 'back']) {
        b.geos[k].computeBoundingBox();
        box.union(b.geos[k].boundingBox);
      }
      b.axisZ = (box.min.z + box.max.z) / 2;
      // A la altura de las colgadas (centro del cuerpo a la par).
      b.offsetY = HELD_CENTER_Y - (box.min.y + box.max.y) / 2;
    }
    built[style] = b;
  }
  return built[style];
}

function buildGarment() {
  disposeBuilt();
  const P = mold.parts;
  const tex = atlas.texture;
  const first = shape(PRESENTATIONS[state.presentation][0].style);
  const S = first.metersPerUnit;
  atlas.metersPerUnit = S;
  atlas.seamEdges = first.seamEdges;
  fabricNormal.repeat.set((mold.viewBox.w * S) / FABRIC_TILE_M, (mold.viewBox.h * S) / FABRIC_TILE_M);
  materials = {
    front: fabricMaterial(tex, fabricNormal),
    back: fabricMaterial(tex, fabricNormal),
    sleeveL: fabricMaterial(tex, fabricNormal),
    sleeveR: fabricMaterial(tex, fabricNormal),
    collar: fabricMaterial(P.collar ? tex : null, rib),
  };
  rib.repeat.set(220, 1);
  materials.collar.normalScale.set(0.6, 0.6);
  layoutShirts();
}

// Arma las dos camisetas según la presentación elegida.
function layoutShirts() {
  // Las geometrías de las camisetas quedan guardadas; el barral se rehace.
  garmentGroup?.traverse((o) => o.userData.own && o.geometry.dispose());
  garmentGroup?.removeFromParent();
  pickables = [];
  garmentGroup = new THREE.Group();
  const list = PRESENTATIONS[state.presentation];
  const makeShirt = (index, b) => {
    const g = new THREE.Group();
    for (const [key, geo] of Object.entries(b.geos)) {
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = key;
      mesh.userData.shirt = index;
      g.add(mesh);
      pickables.push(mesh);
    }
    if (b.hanger) {
      const bar = new THREE.Mesh(b.hanger.bar, hangerMats[state.hanger]);
      bar.castShadow = true;
      bar.userData.hanger = true;
      g.add(bar);
      for (const geo of [b.hanger.hook, b.hanger.tip]) {
        const mesh = new THREE.Mesh(geo, hookMat);
        mesh.castShadow = true;
        g.add(mesh);
      }
    }
    // Cada camiseta gira sobre su eje vertical: el del gancho o el del torso.
    const axisZ = b.hanger ? b.hanger.rodZ : b.axisZ;
    g.position.z = -axisZ;
    g.position.y = b.offsetY || 0;
    const pivot = new THREE.Group();
    pivot.add(g);
    pivot.position.z = axisZ;
    return pivot;
  };
  shirts = list.map(({ style, base }, i) => {
    const pivot = makeShirt(i, shape(style));
    pivot.position.x = (i ? 1 : -1) * SPACING;
    garmentGroup.add(pivot);
    return { pivot, base, angle: 0, vel: 0, hover: 0, hoverTarget: 0 };
  });
  // Barral para las colgadas: de pared a pared, o uno corto amurado si hay
  // una sola.
  const hanging = list.map((e, i) => (built[e.style].hanger ? i : -1)).filter((i) => i >= 0);
  document.getElementById('hanger').disabled = !hanging.length;
  if (hanging.length) {
    const h = built.colgada.hanger;
    const short = hanging.length === 1;
    const len = short ? 0.66 : 2.4;
    const cx = short ? shirts[hanging[0]].pivot.position.x : 0;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 20).rotateZ(Math.PI / 2), rodMat);
    rod.position.set(cx, h.rodY, h.rodZ);
    rod.castShadow = true;
    rod.userData.own = true;
    garmentGroup.add(rod);
    if (short) {
      for (const sx of [-1, 1]) {
        const depth = h.rodZ - WALL_Z;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, depth, 16).rotateX(Math.PI / 2), rodMat);
        arm.position.set(cx + (sx * len) / 2, h.rodY, WALL_Z + depth / 2);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 16, 12), rodMat);
        cap.position.set(cx + (sx * len) / 2, h.rodY, h.rodZ);
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 24).rotateX(Math.PI / 2), rodMat);
        plate.position.set(cx + (sx * len) / 2, h.rodY, WALL_Z + 0.003);
        for (const m of [arm, cap, plate]) m.userData.own = true;
        garmentGroup.add(arm, cap, plate);
      }
    }
  }
  garmentGroup.position.y = 0.02;
  scene.add(garmentGroup);
  refreshShadows();
  bakeShadows();
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Precalcula la oclusión de los pliegues (una vez por molde y por forma).
async function bakeShadows() {
  const token = ++buildToken;
  const cancelled = () => token !== buildToken;
  await nextFrame();
  if (cancelled()) return;
  refreshShadows();
  for (const b of Object.values(built)) {
    if (b.baked) continue;
    setStatus('Calculando sombras de los pliegues…');
    await nextFrame();
    const fabric = ['front', 'back', 'sleeveL', 'sleeveR', 'collar'].map((k) => b.geos[k]).filter(Boolean);
    const done = await bakeAO(fabric, b.hanger ? [...fabric, b.hanger.bar] : fabric, cancelled);
    if (!done || cancelled()) return;
    b.baked = true;
    refreshShadows();
  }
  setStatus('');
}

let composing = null;
let pending = false;
async function refreshTexture() {
  if (!atlas) return;
  for (const [key, mat] of Object.entries(materials)) mat.userData.inside.value.set(state.parts[key].color);
  if (composing) {
    pending = true;
    return composing;
  }
  composing = (async () => {
    try {
      await atlas.compose(state);
      syncCollarWithoutPiece();
      requestRender();
    } catch (err) {
      console.error(err);
      setStatus('No se pudo dibujar el diseño del SVG.');
    }
  })();
  await composing;
  composing = null;
  if (pending) {
    pending = false;
    await refreshTexture();
  }
}

// Si el molde no trae pieza de cuello, el cuello acanalado toma por defecto el
// color dominante de la camiseta (hasta que se elija uno a mano).
function syncCollarWithoutPiece() {
  if (!mold || mold.parts.collar || !materials.collar) return;
  const ps = state.parts.collar;
  if (ps.auto) {
    ps.color = atlas.dominantColor(['front', 'back']);
    const li = partsList.querySelector('[data-part="collar"]');
    if (li) {
      li.querySelector('input[type=color]').value = ps.color;
      li.querySelector('.swatch span').style.background = ps.color;
    }
  }
  materials.collar.color.set(ps.color);
  materials.collar.userData.inside.value.set(ps.color);
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = !msg;
}

// ---------- UI ----------

const partsList = document.getElementById('parts');
const paletteList = document.getElementById('palette');
let debounceT = 0;
const debounced = (fn, ms = 120) => {
  clearTimeout(debounceT);
  debounceT = setTimeout(fn, ms);
};

function buildUI() {
  document.getElementById('mold-name').textContent = mold.name;
  partsList.innerHTML = '';
  for (const def of PART_DEFS) {
    const found = !!mold.parts[def.key];
    const ps = state.parts[def.key];
    const li = document.createElement('li');
    li.className = 'part' + (found ? '' : ' missing');
    li.dataset.part = def.key;
    li.innerHTML = `
      <label class="swatch" title="Color de ${def.label.toLowerCase()}">
        <input type="color" value="${ps.color}">
        <span style="background:${ps.color}"></span>
      </label>
      <div class="part-name">
        <strong>${def.label}</strong>
        <small>${found ? 'detectada en el molde' : 'no encontrada · se reutiliza otra pieza'}</small>
      </div>
      <label class="toggle" title="Mostrar el diseño del SVG sobre el color">
        <input type="checkbox" ${ps.design ? 'checked' : ''} ${found ? '' : 'disabled'}>
        <span>Diseño</span>
      </label>`;
    const color = li.querySelector('input[type=color]');
    const chip = li.querySelector('.swatch span');
    color.addEventListener('input', () => {
      ps.color = color.value;
      chip.style.background = color.value;
      ps.auto = false;
      debounced(refreshTexture);
    });
    li.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      ps.design = e.target.checked;
      refreshTexture();
    });
    li.addEventListener('pointerenter', () => highlight(def.key, true));
    li.addEventListener('pointerleave', () => highlight(null));
    partsList.appendChild(li);
  }
  paletteList.innerHTML = '';
  for (const c of mold.palette) {
    const li = document.createElement('li');
    li.innerHTML = `<label class="swatch" title="Reemplazar ${c}"><input type="color" value="${state.palette[c]}"><span style="background:${state.palette[c]}"></span></label><code>${c}</code>`;
    const input = li.querySelector('input');
    input.addEventListener('input', () => {
      state.palette[c] = input.value;
      li.querySelector('span').style.background = input.value;
      li.querySelector('code').textContent = input.value === c ? c : `${c} → ${input.value}`;
      debounced(refreshTexture, 350);
    });
    paletteList.appendChild(li);
  }
  document.getElementById('palette-section').hidden = !mold.palette.length;
}

document.getElementById('all-color').addEventListener('input', (e) => {
  for (const key of Object.keys(state.parts)) {
    state.parts[key].color = e.target.value;
    state.parts[key].auto = false;
  }
  for (const li of partsList.children) {
    li.querySelector('input[type=color]').value = e.target.value;
    li.querySelector('.swatch span').style.background = e.target.value;
  }
  debounced(refreshTexture);
});
document.getElementById('all-design').addEventListener('change', (e) => {
  for (const key of Object.keys(state.parts)) state.parts[key].design = e.target.checked;
  for (const li of partsList.children) {
    const cb = li.querySelector('input[type=checkbox]');
    if (!cb.disabled) cb.checked = e.target.checked;
  }
  refreshTexture();
});
document.getElementById('palette-reset').addEventListener('click', () => {
  for (const c of mold.palette) state.palette[c] = c;
  buildUI();
  refreshTexture();
});
document.getElementById('logos').addEventListener('change', (e) => {
  state.logos = e.target.checked;
  refreshTexture();
});
document.getElementById('hanger').addEventListener('change', (e) => {
  state.hanger = e.target.value;
  garmentGroup?.traverse((o) => {
    if (o.userData.hanger) o.material = hangerMats[state.hanger];
  });
  requestRender();
});
document.getElementById('presentation').addEventListener('change', (e) => {
  state.presentation = e.target.value;
  if (mold) layoutShirts();
});
document.getElementById('ao').addEventListener('change', (e) => {
  state.ao = e.target.checked;
  aoStrength.value = state.ao ? 1 : 0;
  requestRender();
});
const bgInput = document.getElementById('background');
bgInput.addEventListener('input', () => {
  state.background = bgInput.value;
  wallMat.color.set(bgInput.value);
  requestRender();
});
document.getElementById('reset-view').addEventListener('click', () => {
  camera.position.set(0, -0.3, 2.7);
  controls.target.set(0, -0.3, 0);
  controls.update();
  for (const s of shirts) {
    // Vuelve a la vista de frente / espalda por el camino más corto.
    s.angle = Math.atan2(Math.sin(s.angle), Math.cos(s.angle));
    s.vel = -s.angle * 2.8;
  }
  requestRender();
});
document.getElementById('download').addEventListener('click', () => {
  const prev = renderer.getPixelRatio();
  renderer.setPixelRatio(Math.max(prev, 2));
  resize();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(prev);
  resize();
  const a = document.createElement('a');
  a.href = url;
  a.download = (mold?.name || 'mockup').replace(/\.svg$/i, '') + '-mockup.png';
  a.click();
});

const fileInput = document.getElementById('file');
fileInput.addEventListener('change', () => {
  const f = fileInput.files[0];
  if (f) openFile(f);
  fileInput.value = '';
});
async function openFile(f) {
  try {
    await loadMold(await f.text(), f.name);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  }
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files].find((x) => /svg/i.test(x.type) || /\.svg$/i.test(x.name));
  if (f) openFile(f);
});

// ---------- selección y giro en 3D ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const RAD_PER_PX = 0.011;
const HOVER_TURN = 0.35; // giro máximo al pasar el mouse (rad)
let hovered = null;
let drag = null;

// Marca la parte en el panel; con `tint` también la aclara en 3D (sólo al
// pasar por la lista, para no alterar los colores mientras se gira).
function highlight(key, tint = false) {
  const tinted = tint ? key : null;
  for (const [k, m] of Object.entries(materials)) {
    const v = k === tinted ? 0x262626 : 0x000000;
    if (m.emissive.getHex() !== v) {
      m.emissive.setHex(v);
      requestRender();
    }
  }
  if (hovered === key) return;
  hovered = key;
  for (const li of partsList.children) li.classList.toggle('active', li.dataset.part === key);
}
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  return hit ? { part: hit.object.userData.part, shirt: shirts[hit.object.userData.shirt] } : null;
}
// Posición horizontal del puntero respecto del centro de la camiseta (−1…1).
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
function relativeX(e, s) {
  const r = renderer.domElement.getBoundingClientRect();
  s.pivot.getWorldPosition(_c);
  _e.copy(_c).add(new THREE.Vector3(0.3, 0, 0));
  _c.project(camera);
  _e.project(camera);
  const cx = r.left + ((_c.x + 1) / 2) * r.width;
  const hw = Math.abs(_e.x - _c.x) * 0.5 * r.width || 1;
  return Math.max(-1, Math.min(1, (e.clientX - cx) / hw));
}
function setHover(target, e) {
  for (const s of shirts) s.hoverTarget = s === target && e ? relativeX(e, s) * HOVER_TURN : 0;
  requestRender();
}

const canvas = renderer.domElement;
// Antes que los controles de cámara: si el puntero baja sobre una camiseta,
// el arrastre la gira; si baja sobre el fondo, desplaza la vista.
viewport.addEventListener(
  'pointerdown',
  (e) => {
    if (e.target !== canvas || !e.isPrimary) return;
    controls.enabled = !(e.button === 0 && pick(e));
  },
  { capture: true },
);
window.addEventListener('pointerup', () => (controls.enabled = true));
window.addEventListener('pointercancel', () => (controls.enabled = true));
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const hit = pick(e);
  drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), vel: 0, moved: false, hit };
  if (hit) {
    hit.shirt.vel = 0;
    hit.shirt.hoverTarget = hit.shirt.hover;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    if (!drag.hit) return;
    const s = drag.hit.shirt;
    const now = performance.now();
    const dx = e.clientX - drag.lastX;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    s.angle += dx * RAD_PER_PX;
    const dt = Math.max(now - drag.lastT, 1) / 1000;
    drag.vel = drag.vel * 0.6 + ((dx * RAD_PER_PX) / dt) * 0.4;
    drag.lastX = e.clientX;
    drag.lastT = now;
    requestRender();
    return;
  }
  const hit = pick(e);
  highlight(hit ? hit.part : null);
  setHover(hit ? hit.shirt : null, e);
  canvas.style.cursor = hit ? 'grab' : 'move';
});
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  highlight(null);
  setHover(null);
});
function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.style.cursor = d.hit ? 'grab' : '';
  if (!d.hit) return;
  if (d.moved) {
    // Inercia: sigue girando y frena solo.
    d.hit.shirt.vel = performance.now() - d.lastT < 80 ? Math.max(-12, Math.min(12, d.vel)) : 0;
    return;
  }
  if (e.type !== 'pointerup') return;
  const li = partsList.querySelector(`[data-part="${d.hit.part}"]`);
  li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  li?.querySelector('input[type=color]').click();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// Teclado: flechas giran ambas camisetas.
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'Vista 3D: flechas izquierda y derecha para girar las camisetas');
canvas.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  for (const s of shirts) s.vel += e.key === 'ArrowRight' ? 2.5 : -2.5;
  requestRender();
});

// Avanza giros, inercia y el giro suave al pasar el mouse.
function updateShirts(dt) {
  let moving = false;
  for (const s of shirts) {
    if (!(drag && drag.hit && drag.hit.shirt === s)) {
      if (Math.abs(s.vel) > 0.01) {
        s.angle += s.vel * dt;
        s.vel *= Math.exp(-2.8 * dt);
      } else s.vel = 0;
    }
    const dh = s.hoverTarget - s.hover;
    if (Math.abs(dh) > 1e-4) s.hover += dh * (1 - Math.exp(-7 * dt));
    else s.hover = s.hoverTarget;
    const rot = s.base + s.angle + s.hover;
    if (rot !== s.pivot.rotation.y) {
      s.pivot.rotation.y = rot;
      moving = true;
    }
  }
  return moving;
}

// ---------- arranque ----------

resize();
// Se dibuja sólo cuando algo cambió (cámara, giro, texturas, simulación).
let lastT = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  controls.update();
  if (updateShirts(dt)) refreshShadows();
  if (!needsRender) return;
  needsRender = false;
  renderer.render(scene, camera);
});

// Moldes de ejemplo incluidos.
const examples = document.getElementById('examples');
function loadExample(name) {
  return fetch(`${import.meta.env.BASE_URL}${name}`)
    .then((r) => r.text())
    .then((t) => loadMold(t, name))
    .catch((err) => {
      console.error(err);
      setStatus(err.message, true);
    });
}
examples.addEventListener('change', () => loadExample(examples.value));
loadExample(examples.value);

window.__mockup = { state, refreshTexture, scene, camera, controls, materials: () => materials, getAtlas: () => atlas, getMold: () => mold };
