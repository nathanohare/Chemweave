// Makes the icon that SI project files (.chemsi) show in Explorer, Finder and Linux file managers,
// in every size those need.
//
// The drawing is the Chem SI Assistant's app icon (Nate's design, from the retired
// nathanohare/chem-si-assistant program, also GPL v3): a page with a structure, a spectrum and
// colored index tabs on a navy tile. Its master is src-tauri/icons/chemsi.svg. Drawn at 16, 24
// and 32 pixels it blurs, so those three sizes are the same drawing laid on the pixel grid by hand
// (below): every edge on a whole pixel, the hexagon a ring of pixels, the lines one pixel thick.
//
// Run:  node scripts/make-file-icons.mjs      (needs `npm install` first, for the browser that draws the PNGs)
// It rewrites src-tauri/icons/chemsi.ico, chemsi.icns and chemsi-<size>.png. Commit what it changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ico, icns } from './make-app-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'icons');

const NAVY = '#123a5e', TEAL = '#2fc4b2', PALE = '#9cc9e8', BLUE = '#5fa8d8', GOLD = '#f2b84b', GRAY = '#94a3b8', SHADE = '#cfe3f2';

/** The drawing on a 16-pixel grid. */
const SMALL16 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">
<rect width="16" height="16" rx="3.5" fill="${NAVY}" shape-rendering="geometricPrecision"/>
<rect x="11" y="3" width="2" height="2" fill="${TEAL}"/><rect x="11" y="6" width="2" height="2" fill="${PALE}"/>
<rect x="11" y="9" width="2" height="2" fill="${BLUE}"/><rect x="11" y="12" width="2" height="2" fill="${GOLD}"/>
<rect x="3" y="2" width="8" height="12" fill="#fff"/>
<rect x="4" y="3" width="2" height="2" fill="${TEAL}"/><rect x="7" y="4" width="3" height="1" fill="${GRAY}"/>
<rect x="4" y="9" width="6" height="1" fill="${NAVY}"/><rect x="6" y="7" width="1" height="2" fill="${NAVY}"/><rect x="8" y="6" width="1" height="3" fill="${NAVY}"/>
<rect x="4" y="11" width="5" height="1" fill="${GRAY}"/>
</svg>`;

/** The drawing on a 24-pixel grid. */
const SMALL24 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" shape-rendering="crispEdges">
<rect width="24" height="24" rx="5" fill="${NAVY}" shape-rendering="geometricPrecision"/>
<rect x="17" y="5" width="3" height="3" fill="${TEAL}"/><rect x="17" y="9" width="3" height="3" fill="${PALE}"/>
<rect x="17" y="13" width="3" height="3" fill="${BLUE}"/><rect x="17" y="17" width="3" height="3" fill="${GOLD}"/>
<rect x="5" y="3" width="12" height="18" fill="#fff"/>
<path d="M8 5h2v1h-2zM7 6h1v2h-1zM10 6h1v2h-1zM8 8h2v1h-2z" fill="${TEAL}"/>
<rect x="12" y="6" width="4" height="1" fill="${GRAY}"/><rect x="12" y="8" width="3" height="1" fill="${GRAY}"/>
<rect x="7" y="15" width="9" height="1" fill="${NAVY}"/><rect x="9" y="12" width="1" height="3" fill="${NAVY}"/>
<rect x="11" y="14" width="1" height="1" fill="${NAVY}"/><rect x="12" y="11" width="1" height="4" fill="${NAVY}"/>
<rect x="7" y="17" width="9" height="1" fill="${GRAY}"/><rect x="7" y="19" width="6" height="1" fill="${GRAY}"/>
</svg>`;

/** The drawing for 32 pixels: the master's layout with every edge on a whole pixel (2 units). */
const SMALL32 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
<rect x="2" y="2" width="60" height="60" rx="14" fill="${NAVY}"/>
<rect x="44" y="14" width="6" height="8" rx="1" fill="${TEAL}"/><rect x="44" y="24" width="6" height="8" rx="1" fill="${PALE}"/>
<rect x="44" y="34" width="6" height="8" rx="1" fill="${BLUE}"/><rect x="44" y="44" width="6" height="8" rx="1" fill="${GOLD}"/>
<rect x="16" y="12" width="30" height="42" fill="${SHADE}"/><rect x="14" y="10" width="30" height="42" fill="#fff"/>
<path d="M22 14h4v2h2v4h-2v2h-4v-2h-2v-4h2z" fill="${TEAL}"/><rect x="22" y="16" width="4" height="4" fill="#fff"/>
<path d="M30 17h10M30 21h7" stroke="${GRAY}" stroke-width="2"/>
<path d="M18 41h22M23 41v-8M27 41v-4M31 41v-10" stroke="${NAVY}" stroke-width="2"/>
<path d="M18 45h22M18 49h14" stroke="${GRAY}" stroke-width="2"/>
</svg>`;

/** The drawing meant for a size. */
export function fileIconSvg(px) {
  if (px <= 16) return SMALL16;
  if (px <= 24) return SMALL24;
  if (px <= 32) return SMALL32;
  return fs.readFileSync(path.join(out, 'chemsi.svg'), 'utf8');
}

/** The sizes of the Linux PNGs (src-tauri/icons/chemsi-<size>.png; tauri.linux.conf.json installs them). */
export const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** The sizes in chemsi.ico. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 256];

async function main() {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('@playwright/test')); } catch { ({ chromium } = require('playwright')); }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const cache = new Map();
  async function png(px) {
    if (cache.has(px)) return cache.get(px);
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
    const src = 'data:image/svg+xml;base64,' + Buffer.from(fileIconSvg(px)).toString('base64');
    await page.setContent(`<body style="margin:0;background:transparent"><img src="${src}" width="${px}" height="${px}" style="display:block">`);
    await page.waitForFunction(() => document.images[0].complete);
    const buf = await page.screenshot({ omitBackground: true });
    await page.close();
    cache.set(px, buf);
    return buf;
  }
  const write = (name, data) => fs.writeFileSync(path.join(out, name), data);
  for (const px of LINUX_SIZES) write(`chemsi-${px}.png`, await png(px));
  write('chemsi.ico', ico(await Promise.all(ICO_SIZES.map(async (px) => [px, await png(px)]))));
  // icp4 and icp5 are 16 and 32 pixels; ic11 to ic14 the double-density sizes (32 to 512)
  write('chemsi.icns', icns(await Promise.all([['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]]
    .map(async ([type, px]) => [type, await png(px)]))));
  await browser.close();
  console.log('make-file-icons: wrote src-tauri/icons/chemsi.ico, chemsi.icns and chemsi-<size>.png');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
