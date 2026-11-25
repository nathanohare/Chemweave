// Chemweave's own PDF of each Office sampler, for comparing page by page with Office's
// (docs/developers.md, "The Office samplers"). After `npm run build`:
//   node scripts/office-sampler-pdf.mjs <folder> [subfolder ...]
// opens every .docx, .pptx and .xlsx file in <folder> (and in each subfolder named, such as
// office-saved) in the built app in Chromium and saves its PDF as
// <folder>/pdf/chemweave/<subfolder>/<name>.pdf: Word and PowerPoint files through File ▸ Export ▸
// PDF; workbooks, which have no Export PDF, through File ▸ Print's own page layout (each sheet's
// printed pages, as Print and Print Preview make them), printed to PDF by the browser. The files are read where they are; nothing is
// written into the repository.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../bench/browser.mjs';

const [folder, ...subs] = process.argv.slice(2);
if (!folder || !existsSync(folder)) { console.error('Usage: node scripts/office-sampler-pdf.mjs <folder> [subfolder ...]'); process.exit(2); }
// the PDFs (and Office's copies beside them) never go into the repository
const rel = relative(resolve(dirname(fileURLToPath(import.meta.url)), '..'), resolve(folder));
if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error(`${folder} is inside the repository; give a folder outside it`); process.exit(2); }

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
    for (const name of readdirSync(dir).filter((n) => /\.(docx|pptx|xlsx)$/i.test(n)).sort()) {
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
        if (/\.xlsx$/i.test(name)) {
          // Spreadsheet mode has no Export PDF (index.html offers it in Canvas, Slides, Design and
          // Document): print every sheet as File ▸ Print lays it out (sheetMode.printedSheet), each
          // page at its own size through a named @page rule, with the window's print style
          // (body.printing, as src/ui/print.ts printPages sets it) showing only those pages
          const printed = await page.evaluate((n) => {
            const sm = window.__app.sheetMode, wb = sm.book;
            const root = document.createElement('div');
            root.id = 'print-root';
            let count = 0, css = '';
            for (let i = 0; i < wb.sheets.length; i++) {
              sm.view.goSheet(i);
              const got = sm.printedSheet({ selection: false, ignoreArea: false, file: n });
              if (!got) continue;
              css += `@page s${i} { size: ${got.w}pt ${got.h}pt; margin: 0; }`;
              for (const svg of got.pages) {
                const p = document.createElement('div');
                p.className = 'print-page';
                p.style.cssText = `width:${got.w}pt;height:${got.h}pt;page:s${i}`;
                p.innerHTML = svg;
                root.append(p);
                count++;
              }
            }
            const rules = document.createElement('style');
            rules.textContent = css;
            document.head.append(rules);
            document.body.append(root);
            document.body.classList.add('printing');
            return count;
          }, name);
          if (!printed) throw new Error('no printed pages');
          await page.waitForTimeout(500);
          await page.emulateMedia({ media: 'print' });
          await page.pdf({ path: join(out, name.replace(/\.\w+$/, '.pdf')), preferCSSPageSize: true, printBackground: true });
          console.log(`- ${join(sub, name)}: saved (${printed} printed pages)${errors.length ? ` (page errors: ${errors.slice(0, 3).join(' | ')})` : ''}`);
          continue;
        }
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
