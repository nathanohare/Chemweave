// Screenshots of a screen at three window sizes and in two looks (standing rule R13), for a pull
// request that changes what people see: 1024 × 700 (a small laptop), 1366 × 768 (the most common
// laptop) and 1920 × 1080, each in Light and Dark Gray, at twice the pixels (deviceScaleFactor 2) so
// small type and 1 px lines can be judged. With the rare states too: an empty file, a floating
// toolbox, an error shown, zoomed in. Pictures go to a folder outside the repository, with a page
// (index.html) showing them side by side to look through and attach to the pull request.
//
//   npx vite                                     (in another terminal: the app being served)
//   node scripts/screenshot-matrix.mjs           every screen
//   node scripts/screenshot-matrix.mjs canvas settings      only these screens
//   node scripts/screenshot-matrix.mjs --list    the screens it knows
//   options: --url http://localhost:5173/   --out <folder>   (default: chemweave-screenshots in the
//            computer's temporary folder)   --sizes 1366x768,1920x1080   --looks light,darkgray
// Set CHROMIUM_PATH if Playwright's own Chromium is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../bench/browser.mjs';

export const SIZES = [[1024, 700], [1366, 768], [1920, 1080]];
export const LOOKS = [['light', 'Light', 'theme-light'], ['darkgray', 'Dark Gray', 'theme-darkgray']];

// (not waited for: the paste can wait on the chemistry engine; the screen waits a moment instead)
const paste = () => { void window.__app.pasteChemistry('CC(=O)Oc1ccccc1C(=O)O'); };
/** A structure on the Canvas (a small window can paste it past the page's edge: its question is answered OK). */
const sample = async (page) => {
  await page.evaluate(paste);
  await page.waitForTimeout(600);
  await page.locator('dialog[open] button', { hasText: /^OK$/ }).click({ timeout: 500 }).catch(() => {});
};
const tab = async (page, make) => {
  await page.evaluate((make) => window.__app.command(make), make);
  await page.waitForTimeout(700);
  await page.locator('.tw-close').click({ timeout: 800 }).catch(() => {});
};

/** Each screen: how to get to it from a fresh start. */
export const SCREENS = {
  canvas: { what: 'Canvas with a structure', go: sample },
  empty: { what: 'Canvas, an empty file (rare state)', go: async () => {} },
  'floating-toolbox': { what: 'Canvas with the Drawing Tools toolbox floating (rare state)', go: async (page) => { await sample(page); await page.evaluate(() => window.__app.toolboxes.put('main', { dock: 'float', x: 260, y: 180, shown: true })); } },
  error: { what: 'an error shown: a file that can’t be read (rare state)', go: async (page) => { await page.evaluate(() => window.__app.ws.openBytes(new TextEncoder().encode('<CDXML><broken'), 'broken.cdxml').catch(() => {})); await page.waitForTimeout(300); } },
  'zoomed-in': { what: 'Canvas zoomed in on a structure (rare state)', go: async (page) => { await sample(page); await page.evaluate(() => window.__app.command('zoom-selection')); for (let i = 0; i < 2; i++) await page.evaluate(() => window.__app.command('zoom-in')); } },
  sheet: { what: 'Spreadsheet', go: (page) => tab(page, 'new-sheet') },
  document: { what: 'Document', go: (page) => tab(page, 'new-document') },
  slides: { what: 'Presentation', go: (page) => tab(page, 'new-slides') },
  design: { what: 'Design', go: (page) => tab(page, 'new-design') },
  'file-menu': { what: 'the File menu open', go: async (page) => { await page.locator('header > .menu-wrap > button').first().click(); } },
  settings: { what: 'the Settings window', go: async (page) => { await page.evaluate(() => window.__app.command('preferences')); } },
};

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const flags = new Set(['--url', '--out', '--sizes', '--looks']);
const names = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flags.has(all[i - 1]));

if (process.argv.includes('--list')) {
  for (const [k, s] of Object.entries(SCREENS)) console.log(`${k.padEnd(18)} ${s.what}`);
  process.exit(0);
}
const unknown = names.filter((n) => !SCREENS[n]);
if (unknown.length) {
  console.log(`No screen called ${unknown.join(', ')}. The screens: ${Object.keys(SCREENS).join(', ')}`);
  process.exit(2);
}
const url = arg('--url', 'http://localhost:5173/');
const out = path.resolve(arg('--out', path.join(os.tmpdir(), 'chemweave-screenshots')));
const sizes = arg('--sizes') ? arg('--sizes').split(',').map((s) => s.split('x').map(Number)) : SIZES;
const looks = arg('--looks') ? LOOKS.filter(([k]) => arg('--looks').split(',').includes(k)) : LOOKS;
const screens = names.length ? names : Object.keys(SCREENS);
fs.mkdirSync(out, { recursive: true });

const browser = await launch();
const shots = [], problems = [];
try {
  for (const name of screens) for (const [w, h] of sizes) for (const [look, lookName, theme] of looks) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`${name} ${w}×${h} ${lookName}: ${e.message}`));
    page.on('dialog', (d) => d.dismiss());
    await page.goto(url);
    await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
    await page.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});
    await page.evaluate((t) => window.__app.command(t), theme);
    await SCREENS[name].go(page);
    await page.waitForTimeout(800);
    const file = `${name}-${w}x${h}-${look}.png`;
    await page.screenshot({ path: path.join(out, file) });
    shots.push({ name, w, h, lookName, file });
    console.log(`  ${file}`);
    await context.close();
  }
} finally {
  await browser.close();
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = `<!doctype html><meta charset="utf-8"><title>Screenshots</title>
<style>body{font:14px system-ui;margin:16px;background:#f4f4f4}h2{margin:24px 0 8px}figure{display:inline-block;margin:0 12px 12px 0;vertical-align:top}img{max-width:460px;border:1px solid #ccc;display:block}figcaption{color:#555}</style>
${screens.map((n) => `<h2>${esc(n)}: ${esc(SCREENS[n].what)}</h2>\n${shots.filter((s) => s.name === n).map((s) => `<figure><a href="${s.file}"><img src="${s.file}" loading="lazy"></a><figcaption>${s.w} × ${s.h}, ${s.lookName}</figcaption></figure>`).join('\n')}`).join('\n')}`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`\n${shots.length} screenshots in ${out} (open index.html there to see them side by side).`);
if (problems.length) { console.log(`\nErrors in the page:\n  ${problems.join('\n  ')}`); process.exit(1); }
