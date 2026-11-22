// Undo audit in the built app (`npm run undo-audit -- [part] [file]`, after `npm run build`).
// Each part does things in a real browser, undoes them, and checks the file is exactly as it was
// before; then redoes and checks it is as it was after. It lists every command or drag that
// changed something without an undo step, needed more than one Ctrl+Z, left an undo step that
// changes nothing, or wasn't put back by Undo. A private file (such as a lab's Word document) is
// opened where it is and never copied.
//
//   document [file.docx]  every Document command, with text, a floating picture and a picture in
//                         line picked; then moving and sizing pictures with the mouse. Without a
//                         file, a sample document made here.
//   sheet                 every Spreadsheet command, on a small table with cells picked
//   canvas | slides | design
//                         every menu command with everything selected, on a structure, an arrow,
//                         a rectangle and some text
//   drags                 drags from points all over and round each kind of object, in Canvas and
//                         on a slide (moving, sizing, turning, bending: whatever the point does)
//   all (the default)     all of the above
//
// Set CHROMIUM_PATH if Playwright's own Chromium is missing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { launch } from '../bench/browser.mjs';

const part = process.argv[2] ?? 'all';
const file = process.argv[3];
const PARTS = ['document', 'sheet', 'canvas', 'slides', 'design', 'drags'];
if (part !== 'all' && !PARTS.includes(part)) {
  console.log(`Usage: npm run undo-audit -- [${PARTS.join('|')}|all] [file.docx]`);
  process.exit(2);
}
const PORT = 4183;
const URL = `http://localhost:${PORT}/`;
const problems = [];
const report = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  ${where}: ${what}`); };

/** The `case` labels of a method in a source file (the commands it knows by name). */
function casesOf(path, from, to) {
  const src = fs.readFileSync(path, 'utf8');
  const a = src.indexOf(from);
  const body = src.slice(a, to ? src.indexOf(to, a) : src.indexOf('\n  }\n', a));
  return [...body.matchAll(/case '([^']+)'/g)].map((m) => m[1]);
}
/** Commands that leave the tab, open files or other programs, or only change what is shown. */
const SKIP = /^(new|open|save|export|print|close|quit|exit|reload|revert|present|slide-show|show-|start-show|play|rehearse|record|help|about|feedback|support|update|check-updates|settings|preferences|import|batch|find-in-files|recent|sponsor|send|share|email|tour|guide|keyboard|hotkeys|dev|diagnostics|stress|window|tab-|next-tab$|prev-tab$|undo$|redo$|zoom|fullscreen|split|view-|insert-picture$|insert-object$|hf-picture$|compare-docs$|combine-docs$|sheet-print)/;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL)).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', (d) => d.dismiss());
  await page.goto(URL);
  await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
  await page.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});
  // each part starts in a fresh page (what one part left on, such as a tool or a view, doesn't carry over)
  const restart = async () => {
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
    await page.goto(URL);
    await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
    await page.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});
  };
  // a new file can open on the template window: close it (the new file stays blank)
  const closeTemplates = () => page.locator('.tw-close').click({ timeout: 800 }).catch(() => {});
  const run = (cmd) => Promise.race([page.evaluate((c) => window.__app.command(c), cmd).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  // windows and menus a command opened are closed unchanged
  const tidy = () => page.evaluate(() => {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  /**
   * Run each command and check its undo. `probe` gives a fingerprint of the file and the number of
   * undo steps; `reset` makes a fresh file; `pick` sets the selection before each command.
   */
  async function sweep(where, cmds, probe, reset, pick) {
    await reset();
    let changed = 0;
    for (const cmd of cmds) {
      await pick();
      const a = await probe();
      await run(cmd);
      await page.waitForTimeout(60);
      await tidy();
      await page.waitForTimeout(40);
      const b = await probe();
      const steps = b.n - a.n;
      if (b.h !== a.h || steps > 0) {
        changed++;
        if (steps <= 0) report(where, `${cmd} changed the file without an undo step`);
        else if (b.h === a.h) report(where, `${cmd} made an undo step that changes nothing`);
        else {
          await run('undo');
          const c = await probe();
          if (c.h === a.h) {
            await run('redo');
            if ((await probe()).h !== b.h) report(where, `${cmd}: Redo did not bring the change back`);
            await run('undo');
          } else {
            let k = 1, e = c;
            while (e.n > a.n && k < 20) { await run('undo'); e = await probe(); k++; }
            report(where, e.h === a.h ? `${cmd} took ${k} undos (one is expected)` : `${cmd}: Undo did not put the file back`);
          }
        }
      }
      if ((await probe()).h !== a.h) await reset();
    }
    console.log(`${where}: ${cmds.length} commands, ${changed} changed the file`);
  }

  // (each probe works out a fingerprint of the file in the page: the app's own security rules
  // let no code be made from text there, so each one has its own copy of the loop)

  // ------------------------------------------------------------ Document
  if (part === 'all' || part === 'document') {
    await restart();
    const bytes = file ? [...fs.readFileSync(file)] : null;
    const reset = async () => {
      if (bytes) await page.evaluate(async (b) => window.__app.ws.openBytes(new Uint8Array(b), 'audit.docx'), bytes);
      else await run('new-document');
      await page.waitForFunction(() => window.__app.docMode?.file, null, { timeout: 60000 });
      await closeTemplates();
      if (!bytes) await page.evaluate(sampleDocument);
      await page.waitForTimeout(500);
    };
    function sampleDocument() {
      const f = window.__app.docMode.file;
      const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const obj = (id) => ({ text: '\ufffc', obj: id });
      f.ed.update({ ...f.t, runs: [{ text: 'Synthesis of the ketone\nThe ketone was made as shown ' }, obj(901), { text: ' and purified.\nFirst item\nSecond item\n' }, obj(902), { text: ' Text beside a floating picture. ' + 'More words here. '.repeat(20) + '\nThe end.' }],
        paras: [{ style: 'Heading1' }, {}, { list: 'bullet' }, { list: 'bullet' }, {}, {}],
        objects: { ...f.t.objects, 901: { kind: 'picture', src: PIC, w: 60, h: 40 }, 902: { kind: 'picture', src: PIC, w: 120, h: 80, float: { wrap: 'square', x: 300, y: 0 } } } }, 'Sample');
    }
    const probe = () => page.evaluate(() => {
      const f = window.__app.docMode.file;
      const s = JSON.stringify(f.t, (k, v) => (k === 'src' && typeof v === 'string' ? v.length + v.slice(-40) : v));
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return { h, n: f.ed.undoStack.length };
    });
    const cmds = [...new Set([
      ...await (async () => { await reset(); return page.evaluate(() => [...new Set([...document.querySelectorAll('[data-doc]')].map((e) => e.getAttribute('data-doc')))]); })(),
      ...casesOf('src/ui/doc-mode.ts', '  run(cmd: string): boolean {', '  /** The pinned settings boxes were read'),
    ])].filter((c) => !SKIP.test(c));
    const pickObject = (floating) => page.evaluate((floating) => {
      const f = window.__app.docMode.file;
      if (f.box) f.endBox();
      const id = Object.keys(f.t.objects).map(Number).find((k) => f.t.objects[k].kind === 'picture' && !!f.t.objects[k].float === floating);
      let at = 0;
      for (const r of f.t.runs) { if (r.obj === id) break; at += r.text.length; }
      if (id !== undefined) f.ed.select(at, at + 1);
    }, floating);
    await sweep('Document, text picked', cmds, probe, reset, () => page.evaluate(() => { const f = window.__app.docMode.file; if (f.box) f.endBox(); f.ed.select(Math.min(30, f.ed.text.length), Math.min(70, f.ed.text.length)); }));
    await sweep('Document, floating picture picked', cmds, probe, reset, () => pickObject(true));
    await sweep('Document, picture in line picked', cmds, probe, reset, () => pickObject(false));

    // moving and sizing pictures with the mouse
    await reset();
    const ids = await page.evaluate(() => {
      const f = window.__app.docMode.file;
      const pics = Object.keys(f.t.objects).map(Number).filter((k) => f.t.objects[k].kind === 'picture' || f.t.objects[k].kind === 'drawing' || f.t.objects[k].kind === 'textbox');
      return pics.slice(0, 12);
    });
    const where = (id, fx, fy) => page.evaluate(([id, fx, fy]) => {
      const m = window.__app.docMode, v = m.view;
      const o = m.file.layout().objects.find((x) => x.id === id);
      if (!o) return null;
      let s = v.toScreen(o.x + o.w * fx, o.y + o.h * fy);
      if (s.y < 100 || s.y > 600) { v.scroller.scrollTop += s.y - 300; v.redraw?.(); s = v.toScreen(o.x + o.w * fx, o.y + o.h * fy); }
      const r = v.scroller.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    }, [id, fx, fy]);
    let drags = 0;
    for (const id of ids) {
      for (const [name, fx, fy] of [['moved', 0.5, 0.5], ['sized by its bottom right corner', 1, 1], ['sized by its top left corner', 0, 0]]) {
        const c0 = await where(id, 0.5, 0.5);
        if (!c0) { if (process.env.DEBUG) console.log('  not on the page:', id); continue; }
        await page.mouse.click(c0.x, c0.y);
        const a = await probe();
        const c = await where(id, fx, fy);
        if (!c) continue;
        await page.mouse.move(c.x, c.y);
        await page.mouse.down();
        for (let k = 1; k <= 5; k++) await page.mouse.move(c.x + 8 * k, c.y + 6 * k);
        await page.mouse.up();
        const b = await probe();
        drags++;
        if (b.h === a.h) continue;
        await page.keyboard.press('Control+z');
        const u = await probe();
        await page.keyboard.press('Control+y');
        const r = await probe();
        const kind = await page.evaluate((id) => window.__app.docMode.file.t.objects[id]?.kind, id);
        if (u.h !== a.h) report('Document drags', `a ${kind} ${name}: Undo did not put it back`);
        else if (r.h !== b.h) report('Document drags', `a ${kind} ${name}: Redo did not bring it back`);
        while ((await probe()).n > a.n) await page.keyboard.press('Control+z');
      }
    }
    console.log(`Document drags: ${drags} drags`);
  }

  // ------------------------------------------------------------ Spreadsheet
  if (part === 'all' || part === 'sheet') {
    await restart();
    const reset = async () => {
      await run('new-sheet');
      await page.waitForFunction(() => window.__app.sheetMode?.book, null, { timeout: 30000 });
      await closeTemplates();
      await page.evaluate(() => {
        const wb = window.__app.sheetMode.book;
        wb.edit('Sample', () => {
          const s = wb.sheets[wb.active];
          [['Entry', 'Temp (°C)', 'Time (h)', 'Yield'], ['1', '25', '2', '0.45'], ['2', '40', '4', '0.62'], ['3', '60', '1', '0.71'], ['4', '80', '0.5', '=B5/100']]
            .forEach((row, r) => row.forEach((v, c) => s.setInput(r, c, v)));
        });
        wb.undoList.length = 0;
      });
    };
    // the sheets' own data (not what is worked out from it), maps in key order
    const probe = () => page.evaluate(() => {
      const wb = window.__app.sheetMode.book;
      const seen = new WeakSet();
      const skip = new Set(['wb', 'onChange', 'calc', 'cache', 'deps', 'refsByText', 'undoList', 'redoList', 'tx', 'edits', 'listeners', 'view', 'valuesGen', 'values', 'lastRow', 'lastCol']);
      const ser = (v, depth) => {
        if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
        if (seen.has(v) || depth > 12) return '#';
        seen.add(v);
        if (v instanceof Map) return [...v.entries()].sort((p, q) => (String(p[0]) < String(q[0]) ? -1 : 1)).map(([k, x]) => [k, ser(x, depth + 1)]);
        if (v instanceof Set) return [...v].map((x) => ser(x, depth + 1));
        if (Array.isArray(v)) return v.map((x) => ser(x, depth + 1));
        const o = {};
        for (const k of Object.keys(v)) if (!skip.has(k) && !/cache|Cache|memo/.test(k)) o[k] = ser(v[k], depth + 1);
        return o;
      };
      const s = JSON.stringify(wb.sheets.map((x) => ser(x, 0))) + JSON.stringify(ser({ names: wb.names, theme: wb.theme, customViews: wb.customViews, queries: wb.queries }, 0));
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return { h, n: wb.undoList.length };
    });
    await reset();
    const cmds = [...new Set([
      ...await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-sh]')].map((e) => e.getAttribute('data-sh')))]),
      ...casesOf('src/ui/sheet-mode.ts', '  run(name: string): boolean {'),
    ])].filter((c) => !SKIP.test(c));
    await sweep('Spreadsheet', cmds, probe, reset, () => page.evaluate(() => window.__app.sheetMode.view.select({ r1: 1, c1: 1, r2: 3, c2: 2 })));
  }

  // ------------------------------------------------------------ Canvas, Presentation, Design
  const drawSample = async (mode) => {
    await run(mode === 'canvas' ? 'new' : mode === 'slides' ? 'new-slides' : 'new-design');
    await page.waitForTimeout(600);
    await page.locator('#welcome-close').click({ timeout: 500 }).catch(() => {});
    await closeTemplates();
    const ov = await page.locator('#overlay').boundingBox();
    const X = (x) => ov.x + x, Y = (y) => ov.y + y;
    const tool = (t) => page.evaluate((t) => window.__app.editor.setTool(t), t);
    const dragp = async (a, b) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(); for (let k = 1; k <= 5; k++) await page.mouse.move(a[0] + (b[0] - a[0]) * k / 5, a[1] + (b[1] - a[1]) * k / 5); await page.mouse.up(); };
    await page.evaluate(() => { window.__app.pasteChemistry('CC(=O)Oc1ccccc1C(=O)O'); });
    await page.waitForTimeout(300);
    await tool('arrow'); await dragp([X(380), Y(450)], [X(520), Y(450)]);
    await tool('arrow-curved'); await dragp([X(250), Y(650)], [X(400), Y(670)]);
    await tool('shape-rect'); await dragp([X(250), Y(520)], [X(370), Y(600)]);
    await tool('shape-oval'); await dragp([X(420), Y(520)], [X(520), Y(600)]);
    await tool('bracket-square'); await dragp([X(600), Y(250)], [X(700), Y(350)]);
    await tool('text'); await page.mouse.click(X(600), Y(560)); await page.keyboard.type('Hello world'); await page.keyboard.press('Escape');
    await tool('select');
    return { X, Y, dragp };
  };
  const drawingProbe = (mode) => page.evaluate((mode) => {
    const a = window.__app;
    const rep = (k, v) => (k === 'src' && typeof v === 'string' ? v.length : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v);
    const deck = a.slideList?.deck;
    let s, n;
    if (mode !== 'canvas' && deck) {
      s = JSON.stringify({ slides: deck.slides.map((x, i) => { const { doc, ...rest } = x; return { ...rest, doc: deck.docOf(i).contents() }; }), master: deck.master, size: deck.size, settings: deck.settings, sections: deck.sections }, rep);
      n = deck.undoList.length;
    } else { s = JSON.stringify(a.doc.contents(), rep); n = a.doc.undoStack.length; }
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return { h, n };
  }, mode);
  for (const mode of ['canvas', 'slides', 'design']) {
    if (part !== 'all' && part !== mode) continue;
    await restart();
    const src = fs.readFileSync('src/main.ts', 'utf8');
    const at = src.indexOf('const COMMANDS: Record<string, () => unknown> = {');
    const cmds = [...src.slice(at, src.indexOf('\n};', at)).matchAll(/^ {2}'?([a-zA-Z0-9:._-]+)'?:/gm)].map((m) => m[1]).filter((c) => !SKIP.test(c));
    await sweep({ canvas: 'Canvas', slides: 'Presentation', design: 'Design' }[mode], cmds, () => drawingProbe(mode), async () => { await drawSample(mode); }, async () => {
      await page.evaluate(() => { const ed = window.__app.editor; ed.setTool?.('select'); });
      await run('select-all');
    });
  }

  // ------------------------------------------------------------ drags all over each object
  if (part === 'all' || part === 'drags') {
    await restart();
    for (const mode of ['canvas', 'slides']) {
      const { X, Y, dragp } = await drawSample(mode);
      const targets = await page.evaluate(() => {
        const d = window.__app.doc, r = window.__app.renderer, out = [];
        const add = (kind, pts) => { const s = pts.map((p) => r.toScreen(p)); out.push({ kind, x1: Math.min(...s.map((p) => p.x)), y1: Math.min(...s.map((p) => p.y)), x2: Math.max(...s.map((p) => p.x)), y2: Math.max(...s.map((p) => p.y)) }); };
        const atoms = [...d.atoms.values()];
        if (atoms.length) add('structure', atoms);
        for (const c of d.captions.values()) add('text', [{ x: c.x, y: c.y }]);
        for (const a of d.arrows.values()) { const pts = (a.points ?? []).filter((p) => p && typeof p.x === 'number'); if (pts.length) add('arrow', pts); }
        for (const s of d.shapes.values()) {
          const pts = [s.p1, s.p2, s.from, s.to, s.a, s.b].filter((p) => p && typeof p.x === 'number');
          if (s.x1 !== undefined) pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
          if (s.x !== undefined && s.w !== undefined) pts.push({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h });
          if (pts.length) add(s.kind ?? 'shape', pts);
        }
        return out;
      });
      let drags = 0, changed = 0;
      const STEP = 14;
      for (const t of targets) {
        const cx = (t.x1 + t.x2) / 2, cy = (t.y1 + t.y2) / 2;
        for (let y = t.y1 - 24; y <= t.y2 + 24; y += STEP) for (let x = t.x1 - 24; x <= t.x2 + 24; x += STEP) {
          await page.mouse.click(X(1000), Y(780));
          await page.mouse.click(X(cx), Y(cy));
          const a = await drawingProbe(mode);
          await dragp([X(x), Y(y)], [X(x + 23), Y(y + 15)]);
          const b = await drawingProbe(mode);
          drags++;
          if (b.h === a.h) continue;
          changed++;
          await page.keyboard.press('Control+z');
          const u = await drawingProbe(mode);
          await page.keyboard.press('Control+y');
          const r = await drawingProbe(mode);
          const at = `${Math.round(x - t.x1)}, ${Math.round(y - t.y1)}`;
          if (u.h !== a.h) report(`${mode} drags`, `a drag on a ${t.kind} (from ${at} px of its top left): Undo did not put it back`);
          else if (r.h !== b.h) report(`${mode} drags`, `a drag on a ${t.kind} (from ${at} px of its top left): Redo did not bring it back`);
          for (let k = 0; k < 5 && (await drawingProbe(mode)).h !== a.h; k++) await page.keyboard.press('Control+z');
        }
      }
      console.log(`${mode} drags: ${drags} drags, ${changed} changed something`);
    }
  }
} finally {
  await browser?.close();
  server.kill();
}
console.log(problems.length ? `\n${problems.length} undo problems found.` : '\nNo undo problems found.');
process.exit(problems.length ? 1 : 0);
