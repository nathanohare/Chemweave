// Makes the app icon in every size the installers need, from one drawing in code.
//
// The icon is an interlaced hexagon: six bars, each one running past its corner and lying over the
// start of the next (many tools woven into one). Cream bars, one coral bar, on a deep teal tile.
// It is drawn three times, so it stays sharp when small:
//   large  (96 px and up)  a starry sky behind the bars and a faint rim round the tile
//   medium (28 to 95 px)   thicker bars, wider gaps, two sparkles for the sky
//   small  (under 28 px)   the tile fills the square, the thickest bars, a plain sky
//
// Run:  node scripts/make-app-icons.mjs      (needs `npm install` first, for the browser that draws the PNGs)
// It rewrites src-tauri/icons/* and the tab icon in index.html. Commit what it changes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'icons');

// ---------------------------------------------------------------- the drawing
const CREAM = '#fbf6ea', CORAL = '#ff7f57', GOLD = '#f6c453';
const SKY = ['#124c5d', '#09323e', '#041b22'], RIM = '#2a7f95';
/** The colour behind the iPad icon's transparent corners (also in .github/workflows/ios.yml). */
export const IOS_COLOUR = SKY[1];
const BARS = [CREAM, CREAM, CREAM, CREAM, CREAM, CORAL];
const TIERS = {
  large: { inset: 32, rx: 216, R: 286, e: 112, W: 96, g: 26, rim: 6 },
  medium: { inset: 20, rx: 210, R: 292, e: 112, W: 112, g: 34, rim: 14 },
  small: { inset: 0, rx: 200, R: 300, e: 104, W: 128, g: 46, rim: 0 },
};
export const tierFor = (px) => (px >= 96 ? 'large' : px >= 28 ? 'medium' : 'small');
const f = (n) => Math.round(n * 10) / 10;

/** Six bars round a hexagon. Each bar is cut back where the bar before it lies over its start. */
function bars(t) {
  const v = [0, 1, 2, 3, 4, 5].map((i) => { const a = ((-90 + 60 * i) * Math.PI) / 180; return [512 + t.R * Math.cos(a), 512 + t.R * Math.sin(a)]; });
  const bar = (i) => {
    const p = v[i], q = v[(i + 1) % 6], L = Math.hypot(q[0] - p[0], q[1] - p[1]), d = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    return { p, d, end: [q[0] + d[0] * t.e, q[1] + d[1] * t.e] };
  };
  const line = (a, b, c, w) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${c}" stroke-width="${w}"/>`;
  let defs = '', body = '';
  for (let i = 0; i < 6; i++) {
    const b = bar(i), over = bar((i + 5) % 6);
    defs += `<mask id="m${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/>${line(over.p, [over.end[0] + over.d[0] * t.g, over.end[1] + over.d[1] * t.g], '#000', t.W + 2 * t.g)}</mask>`;
    body += `<g mask="url(#m${i})">${line(b.p, b.end, BARS[i], t.W)}</g>`;
  }
  return `<defs>${defs}</defs>${body}`;
}
const sparkle = (x, y, r) => `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${GOLD}"/>`;
/** The same scattered stars every run (a fixed seed), none of them close behind the ring of bars. */
function stars(R) {
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let o = '';
  for (let i = 0; i < 46; i++) {
    const x = 70 + r() * 884, y = 70 + r() * 884, rr = 3 + r() * 6, op = 0.35 + r() * 0.6, d = Math.hypot(x - 512, y - 512);
    if (d > R - 90 && d < R + 120) continue;
    o += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${CREAM}" opacity="${f(op)}"/>`;
  }
  return o;
}
/** The icon as SVG. `square` fills the whole square with no rounded corners (iPadOS rounds them itself). */
export function iconSvg(tier, square = false) {
  const t = { ...TIERS[tier], ...(square ? { inset: 0, rx: 0, rim: 0 } : {}) }, s = 1024 - 2 * t.inset;
  const sky = tier === 'large' ? stars(t.R) + sparkle(800, 196, 46) + sparkle(214, 812, 30) : tier === 'medium' ? sparkle(808, 200, 64) + sparkle(210, 816, 44) : '';
  const tile = `x="${t.inset}" y="${t.inset}" width="${s}" height="${s}" rx="${t.rx}"`;
  const rim = t.rim ? `<rect x="${t.inset + t.rim / 2}" y="${t.inset + t.rim / 2}" width="${s - t.rim}" height="${s - t.rim}" rx="${t.rx - t.rim / 2}" fill="none" stroke="${RIM}" stroke-opacity="0.7" stroke-width="${t.rim}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${SKY[0]}"/><stop offset="0.5" stop-color="${SKY[1]}"/><stop offset="1" stop-color="${SKY[2]}"/></linearGradient><clipPath id="c"><rect ${tile}/></clipPath></defs><rect ${tile} fill="url(#g)"/><g clip-path="url(#c)">${sky}</g>${rim}${bars(t)}</svg>\n`;
}

// ---------------------------------------------------------------- the files
/** Windows .ico: a directory of PNG pictures. */
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(([px, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(px >= 256 ? 0 : px, e); head.writeUInt8(px >= 256 ? 0 : px, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p[1])]);
}
/** macOS .icns: PNG pictures under their four-letter size names. */
export function icns(parts) {
  const chunks = parts.map(([type, png]) => { const h = Buffer.alloc(8); h.write(type, 0, 'ascii'); h.writeUInt32BE(png.length + 8, 4); return Buffer.concat([h, png]); });
  const body = Buffer.concat(chunks), h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

async function main() {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('@playwright/test')); } catch { ({ chromium } = require('playwright')); }
  const browser = await chromium.launch();
  const cache = new Map();
  /** One PNG, `px` pixels square, from the drawing meant for that size. */
  async function png(px, { square = false, opaque = false } = {}) {
    const key = `${px}/${square}/${opaque}`;
    if (cache.has(key)) return cache.get(key);
    const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
    const src = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg(tierFor(px), square)).toString('base64');
    await page.setContent(`<body style="margin:0;background:${opaque ? IOS_COLOUR : 'transparent'}"><img src="${src}" width="${px}" height="${px}" style="display:block">`);
    await page.waitForFunction(() => document.images[0].complete);
    const buf = await page.screenshot({ omitBackground: !opaque });
    await page.close();
    cache.set(key, buf);
    return buf;
  }
  const write = (name, data) => fs.writeFileSync(path.join(out, name), data);

  write('source.svg', iconSvg('large'));
  write('source-medium.svg', iconSvg('medium'));
  write('source-small.svg', iconSvg('small'));
  write('ios-source.svg', iconSvg('large', true));
  for (const [name, px] of [['32x32.png', 32], ['64x64.png', 64], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512], ['StoreLogo.png', 50],
    ...[30, 44, 71, 89, 107, 142, 150, 284, 310].map((n) => [`Square${n}x${n}Logo.png`, n])]) write(name, await png(px));
  write('ios-icon.png', await png(1024, { square: true, opaque: true }));
  write('icon.ico', ico(await Promise.all([32, 16, 24, 48, 64, 256].map(async (px) => [px, await png(px)]))));
  write('icon.icns', icns(await Promise.all([['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
    .map(async ([type, px]) => [type, await png(px)]))));
  await browser.close();

  // the browser tab's icon (index.html): the small drawing, written into the page itself
  const index = path.join(root, 'index.html');
  const html = fs.readFileSync(index, 'utf8');
  const tab = iconSvg('small').trim().replace(' width="1024" height="1024"', '').replace(/%/g, '%25').replace(/"/g, '%22').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
  const next = html.replace(/<link rel="icon" href="[^"]*" \/>/, `<link rel="icon" href="data:image/svg+xml,${tab}" />`);
  if (next === html && !html.includes(tab)) throw new Error('make-app-icons: the tab icon line in index.html was not found');
  fs.writeFileSync(index, next);
  console.log('make-app-icons: wrote src-tauri/icons and the tab icon in index.html');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
