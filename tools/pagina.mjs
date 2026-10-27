// Arma una página de un solo archivo para publicar como artifact (como
// «Camiseta Deportiva 3D» o «Tank Top Deportivo»): el estudio de
// camiseta.html con su código y sus estilos adentro, y la configuración con
// que arranca (ver CONFIG en src/camiseta/main.js).
//
//   node tools/pagina.mjs --out remeron.html --title "Remerón de Danza" \
//     --heading "Remerón de danza" --config '{"params": {"garment": "tunic"}}'
//
// --title es el de la pestaña; --heading, el del panel y el nombre que
// propone la lámina de muestra (si falta, el título).
//
// Sale sin doctype ni head: el título arriba y después el resto, que es el
// formato en que se publica un artifact.

import { build } from 'vite';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    out: { type: 'string' },
    title: { type: 'string', default: 'Camiseta Deportiva 3D' },
    heading: { type: 'string' },
    config: { type: 'string', default: '{}' },
  },
});
if (!a.out) {
  console.error('Falta --out');
  process.exit(1);
}
const config = JSON.parse(a.config);
const root = new URL('..', import.meta.url).pathname;
const outDir = mkdtempSync(join(tmpdir(), 'pagina-'));
try {
  await build({
    root,
    base: './',
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir,
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000,
      rolldownOptions: { input: join(root, 'camiseta.html'), output: { codeSplitting: false } },
    },
  });
  const html = readFileSync(join(outDir, 'camiseta.html'), 'utf8');
  const assets = readdirSync(join(outDir, 'assets'));
  const js = assets.filter((f) => f.endsWith('.js'));
  const css = assets.filter((f) => f.endsWith('.css'));
  if (js.length !== 1) throw new Error(`Se esperaba un solo script y salieron ${js.length}: ${js.join(', ')}`);
  const read = (f) => readFileSync(join(outDir, 'assets', f), 'utf8');
  // Nada adentro puede cerrar la etiqueta que lo contiene.
  const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
  const links = html.match(/<link rel="(preconnect|stylesheet)" href="https:[^>]*>/g) || [];
  const heading = a.heading || a.title;
  const main = html
    .slice(html.indexOf('<main class="studio">'), html.indexOf('</main>') + '</main>'.length)
    .replace('<h1>Camiseta deportiva</h1>', `<h1>${heading}</h1>`)
    .replace('placeholder="Camiseta deportiva"', `placeholder="${heading}"`);
  if (!main.includes(`<h1>${heading}</h1>`)) throw new Error('No encontré el título del panel en camiseta.html');
  const page = [
    `<title>${a.title}</title>`,
    ...links,
    `<style>\n${css.map(read).join('\n')}\n</style>`,
    main,
    `<script type="application/json" id="camiseta-config">${safe(JSON.stringify(config))}</script>`,
    `<script type="module">\n${safe(read(js[0]))}\n</script>`,
    '',
  ].join('\n');
  writeFileSync(a.out, page);
  console.log(`${a.out}: ${(page.length / 1024).toFixed(0)} KB`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
