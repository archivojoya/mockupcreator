// Pasa un SVG a PNG con Chromium (fondo transparente):
//   node svg2png.mjs entrada.svg salida.png ancho
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function playwright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    const global = execSync('npm root -g').toString().trim();
    return createRequire(global + '/')('playwright');
  }
}

const [, , src, dst, w] = process.argv;
const svg = readFileSync(src, 'utf8');
const vb = svg.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
const W = Number(w);
const H = Math.round((W * vb[3]) / vb[2]);
const browser = await playwright().chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${W}" height="${H}" `)}</body></html>`);
await page.screenshot({ path: dst, omitBackground: true });
await browser.close();
