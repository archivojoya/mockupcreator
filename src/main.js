import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SvgMold, PART_DEFS } from './svgMold.js';
import { GarmentModel } from './garment.js';
import { Atlas, makeKnitNormalMap, makeRibNormalMap } from './atlas.js';
import './style.css';

const SPACING = 0.43;
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
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.05, 20);
camera.position.set(0, -0.3, 2.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.3, 0);
controls.enableDamping = true;
controls.minDistance = 0.6;
controls.maxDistance = 4;
controls.minPolarAngle = Math.PI * 0.2;
controls.maxPolarAngle = Math.PI * 0.75;
controls.update();

// Luz de estudio suave: sin mapa de entorno para evitar reflejos.
const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc9c0, 1.2);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff8f0, 1.75);
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
const fill = new THREE.DirectionalLight(0xf0f4ff, 0.55);
fill.position.set(-2.5, 0.4, 2);
scene.add(fill);

const wallMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 1, metalness: 0 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), wallMat);
wall.position.set(0, -0.5, -0.16);
wall.receiveShadow = true;
scene.add(wall);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 0.06, distanceExponent: 1.5, thickness: 1, scale: 1.1, samples: 16 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
composer.addPass(new OutputPass());

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // Encuadre: que entren ambas camisetas en pantallas angostas.
  camera.fov = w / h < 1.2 ? 26 * (1.25 / Math.max(w / h, 0.55)) : 26;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- materiales ----------

const knit = makeKnitNormalMap();
const rib = makeRibNormalMap();

function fabricMaterial(map, normalMap) {
  const m = new THREE.MeshPhysicalMaterial({
    map,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0.12,
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    side: THREE.DoubleSide,
  });
  // El interior de la prenda (caras traseras) muestra la tela sin estampar,
  // algo más oscura, como en una prenda sublimada.
  m.userData.inside = { value: new THREE.Color(0xffffff) };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.insideColor = m.userData.inside;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 insideColor;\nvoid main() {')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n if (!gl_FrontFacing) diffuseColor.rgb = insideColor * 0.8;',
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
  parts: Object.fromEntries(PART_DEFS.map((d) => [d.key, { color: '#ffffff', design: true }])),
  palette: {},
  logos: true,
  hanger: 'madera',
  ao: true,
  background: '#f7f5f1',
};

let mold = null;
let atlas = null;
let garmentGroup = null;
let materials = {};
let pickables = [];

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

function disposeGroup(g) {
  g.traverse((o) => o.geometry?.dispose());
  g.removeFromParent();
}

function buildGarment() {
  if (garmentGroup) disposeGroup(garmentGroup);
  const model = new GarmentModel(mold);
  const P = mold.parts;
  const tex = atlas.texture;
  knit.repeat.set(mold.viewBox.w * model.front.S / 0.0028, (mold.viewBox.h * model.front.S) / 0.0021);
  materials = {
    front: fabricMaterial(tex, knit),
    back: fabricMaterial(tex, knit),
    sleeveL: fabricMaterial(tex, knit),
    sleeveR: fabricMaterial(tex, knit),
    collar: fabricMaterial(P.collar ? tex : null, rib),
  };
  rib.repeat.set(220, 1);
  materials.collar.normalScale.set(0.6, 0.6);
  const parts = [];
  parts.push(['front', model.buildBody(model.front, atlas)]);
  parts.push(['back', model.buildBody(model.back, atlas)]);
  const sl = P.sleeveL || P.sleeveR;
  const sr = P.sleeveR || P.sleeveL;
  if (sl) parts.push(['sleeveL', model.buildSleeve(sl, +1, atlas)]);
  if (sr) parts.push(['sleeveR', model.buildSleeve(sr, -1, atlas)]);
  parts.push(['collar', model.buildCollar(atlas, P.collar)]);
  const hanger = model.buildHanger();

  const makeShirt = () => {
    const g = new THREE.Group();
    for (const [key, geo] of parts) {
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = key;
      g.add(mesh);
      pickables.push(mesh);
    }
    const hm = hangerMats[state.hanger];
    for (const geo of [hanger.bar, ...hanger.caps]) {
      const mesh = new THREE.Mesh(geo, hm);
      mesh.castShadow = true;
      mesh.userData.hanger = true;
      g.add(mesh);
    }
    for (const geo of [hanger.hook, hanger.tip]) {
      const mesh = new THREE.Mesh(geo, hookMat);
      mesh.castShadow = true;
      g.add(mesh);
    }
    return g;
  };
  pickables = [];
  garmentGroup = new THREE.Group();
  const frontShirt = makeShirt();
  frontShirt.position.x = -SPACING;
  const backShirt = makeShirt();
  backShirt.position.x = SPACING;
  backShirt.rotation.y = Math.PI;
  garmentGroup.add(frontShirt, backShirt);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.4, 20).rotateZ(Math.PI / 2), rodMat);
  rod.position.set(0, hanger.rodY, hanger.rodZ);
  rod.castShadow = true;
  garmentGroup.add(rod);
  // Contrarrota la posición z del gancho en la camiseta girada.
  backShirt.position.z = 2 * hanger.rodZ;
  garmentGroup.position.y = 0.02;
  scene.add(garmentGroup);
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
      if (!mold.parts[def.key] && def.key === 'collar') materials.collar.color.set(color.value);
      debounced(refreshTexture);
    });
    li.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      ps.design = e.target.checked;
      refreshTexture();
    });
    li.addEventListener('pointerenter', () => highlight(def.key));
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
  for (const key of Object.keys(state.parts)) state.parts[key].color = e.target.value;
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
});
document.getElementById('ao').addEventListener('change', (e) => {
  state.ao = e.target.checked;
  gtao.enabled = state.ao;
});
const bgInput = document.getElementById('background');
bgInput.addEventListener('input', () => {
  state.background = bgInput.value;
  wallMat.color.set(bgInput.value);
});
document.getElementById('reset-view').addEventListener('click', () => {
  camera.position.set(0, -0.3, 2.7);
  controls.target.set(0, -0.3, 0);
  controls.update();
});
document.getElementById('download').addEventListener('click', () => {
  const prev = renderer.getPixelRatio();
  renderer.setPixelRatio(Math.max(prev, 2));
  resize();
  composer.render();
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

// ---------- selección en 3D ----------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
function highlight(key) {
  if (hovered === key) return;
  if (hovered && materials[hovered]) materials[hovered].emissive.setHex(0x000000);
  hovered = key;
  if (key && materials[key]) materials[key].emissive.setHex(0x1c2a3a);
  for (const li of partsList.children) li.classList.toggle('active', li.dataset.part === key);
  renderer.domElement.style.cursor = key ? 'pointer' : '';
}
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  return hit ? hit.object.userData.part : null;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  highlight(pick(e));
});
renderer.domElement.addEventListener('pointerleave', () => highlight(null));
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
  const key = pick(e);
  if (!key) return;
  const li = partsList.querySelector(`[data-part="${key}"]`);
  li?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  li?.querySelector('input[type=color]').click();
});

// ---------- arranque ----------

resize();
renderer.setAnimationLoop(() => {
  controls.update();
  composer.render();
});

fetch(`${import.meta.env.BASE_URL}molde-ejemplo.svg`)
  .then((r) => r.text())
  .then((t) => loadMold(t, 'molde-ejemplo.svg'))
  .catch((err) => {
    console.error(err);
    setStatus(err.message, true);
  });

window.__mockup = { state, refreshTexture, scene, camera, controls, getAtlas: () => atlas, getMold: () => mold };
