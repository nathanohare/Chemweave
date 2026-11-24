// Chemweave's own PDF of each Office sampler, for comparing page by page with Office's
// (docs/developers.md, "The Office samplers"). After `npm run build`:
//   node scripts/office-sampler-pdf.mjs <folder> [subfolder ...]
// opens every .docx and .pptx file in <folder> (and in each subfolder named, such as
// office-saved) in the built app in Chromium, runs File ▸ Export ▸ PDF, and saves the PDF as
// <folder>/pdf/chemweave/<subfolder->/<name>.pdf. The files are read where they are; nothing is
// written into the repository.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from '../bench/browser.mjs';

const [folder, ...subs] = process.argv.slice(2);
if (!folder || !existsSync(folder)) { console.error('Usage: node scripts/office-sampler-pdf.mjs <folder> [subfolder ...]'); process.exit(2); }

const PORT = 4181;
const URL = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const up = async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the preview server did not start (run `npm run build` first)');
};

let browser;
let failed = 0;
try {
  await up();
  browser = await launch();
  for (const sub of ['', ...subs]) {
    const dir = join(folder, sub);
    if (!existsSync(dir)) { console.log(`- ${dir}: not there, skipped`); continue; }
    const out = join(folder, 'pdf', 'chemweave', sub);
    mkdirSync(out, { recursive: true });
    // (Spreadsheet mode has no Export PDF: index.html offers it in Canvas, Slides, Design and Document)
    for (const skipped of readdirSync(dir).filter((n) => /\.xlsx$/i.test(n))) console.log(`- ${join(sub, skipped)}: skipped (spreadsheets have no Export PDF)`);
    for (const name of readdirSync(dir).filter((n) => /\.(docx|pptx)$/i.test(n)).sort()) {
      // a fresh page each time, so one file's trouble doesn't carry into the next
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => d.dismiss());
      // no save picker: Export downloads the file instead
      await page.addInitScript(() => { delete window.showSaveFilePicker; });
      try {
        await page.goto(URL);
        await page.waitForFunction(() => window.__app?.chem?.ready || window.__app?.chem?.error, null, { timeout: 60000 });
        const b64 = readFileSync(join(dir, name)).toString('base64');
        const opened = await page.evaluate(async ([b, n]) => {
          await window.__app.loadModes();
          const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
          return window.__app.ws.openBytes(bytes, n);
        }, [b64, name]);
        if (!opened) throw new Error('did not open');
        await page.waitForTimeout(1500);
        const download = page.waitForEvent('download', { timeout: 120000 });
        await page.evaluate(() => window.__app.command('export-pdf'));
        const d = await download;
        await d.saveAs(join(out, name.replace(/\.\w+$/, '.pdf')));
        console.log(`- ${join(sub, name)}: saved${errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''}`);
      } catch (e) {
        failed++;
        console.log(`- ${join(sub, name)}: FAILED ${e instanceof Error ? e.message.split('\n')[0] : e}${errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
