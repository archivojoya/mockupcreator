// Biblioteca de imágenes de diseño: se guarda en el navegador (IndexedDB),
// con el estado de la personalización (qué imagen va en cada pieza y las
// aplicaciones). Si el navegador no deja guardar (ventana privada, datos
// bloqueados), funciona igual, sin guardar.
const DB_NAME = 'camiseta-3d';
const DB_VERSION = 1;

function request(r) {
  return new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

// Guarda: imágenes ({ id, name, type, blob, added }) y estado (clave → valor).
export async function openStore() {
  try {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    const db = await request(open);
    const tx = (store, mode, fn) => request(fn(db.transaction(store, mode).objectStore(store)));
    return {
      images: () => tx('images', 'readonly', (s) => s.getAll()),
      put: (rec) => tx('images', 'readwrite', (s) => s.put(rec)),
      remove: (id) => tx('images', 'readwrite', (s) => s.delete(id)),
      getState: (key) => tx('state', 'readonly', (s) => s.get(key)),
      putState: (key, value) => tx('state', 'readwrite', (s) => s.put(value, key)),
    };
  } catch {
    return null;
  }
}

// Una imagen lista para dibujar (y su dirección, para las miniaturas).
export async function decodeImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  // Un SVG sin tamaño propio se dibuja a 1000 px de ancho.
  if (!img.naturalWidth || !img.naturalHeight) {
    img.width = 1000;
    img.height = 1000;
  } else {
    img.width = img.naturalWidth;
    img.height = img.naturalHeight;
  }
  return { img, url };
}

// Parte transparente de una imagen (0 a 1, mirando una copia chica): un
// escudo o una marca sueltos tienen fondo transparente; el diseño de una
// pieza la cubre entera.
export function transparency(img) {
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  const a = g.getImageData(0, 0, N, N).data;
  let n = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 16) n++;
  return n / (N * N);
}

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
