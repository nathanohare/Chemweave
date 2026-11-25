// The browser smoke test run on every pull request (`npm run smoke`, after `npm run build`): starts
// the built app in Chromium and goes through what everyone does first. It fails on any error the
// page reports, on a step that doesn't do what it should, and on a menu too tall for a laptop's
// window (each menu must fit in one column at 1280 × 720, and every top menu and right-click menu
// must fit a 1389 × 700 window without scrolling). Last, the accessibility check of
// scripts/a11y-check.mjs (standing rule R10): axe and a keyboard-only walk in Light and Dark Gray,
// failing on a problem not already in scripts/a11y-known.mjs.
import { spawn } from 'node:child_process';
import { launch } from '../bench/browser.mjs';
import { a11yProblems, compareA11y } from './a11y-check.mjs';

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const failures = [];
const fail = (msg) => { failures.push(msg); console.log('  FAIL ' + msg); };
const step = (msg) => console.log('- ' + msg);

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const up = async () => {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('the preview server did not start');
};

let browser;
try {
  await up();
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('page error: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console error: ' + m.text()); });
  page.on('dialog', (d) => d.dismiss());

  step('start');
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForFunction(() => window.__app?.chem?.ready || window.__app?.chem?.error, null, { timeout: 30000 });
  if (await page.evaluate(() => window.__app.chem.error)) fail('the chemistry engine did not load: ' + await page.evaluate(() => String(window.__app.chem.error)));
  console.log(`  up and chemistry ready in ${Date.now() - t0} ms`);
  await page.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});

  step('draw a ring and grow a bond with a hotkey');
  const box = await page.locator('#overlay').boundingBox();
  await page.click('[data-tool="ring-benzene"]');
  await page.mouse.click(box.x + 300, box.y + 300);
  const first = await page.evaluate(() => [...window.__app.doc.atoms.keys()][0]);
  const at = await page.evaluate((id) => window.__app.renderer.toScreen(window.__app.doc.atoms.get(id)), first);
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.keyboard.press('1');
  const atoms = await page.evaluate(() => window.__app.doc.atoms.size);
  if (atoms !== 7) fail(`benzene plus one bond should have 7 atoms, not ${atoms}`);

  step('paste SMILES twice: the two land apart');
  for (const s of ['CC(=O)Oc1ccccc1C(=O)O', 'CC(=O)Oc1ccccc1C(=O)O']) {
    await page.evaluate((t) => window.__app.pasteChemistry(t), s);
  }
  const apart = await page.evaluate(() => {
    const d = window.__app.doc, frags = d.fragments().map((f) => [...f].map((id) => d.atoms.get(id)));
    const boxes = frags.map((a) => ({ x1: Math.min(...a.map((p) => p.x)), x2: Math.max(...a.map((p) => p.x)), y1: Math.min(...a.map((p) => p.y)), y2: Math.max(...a.map((p) => p.y)) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      if (p.x1 < q.x2 && q.x1 < p.x2 && p.y1 < q.y2 && q.y1 < p.y2) return false;
    }
    return boxes.length === 3;
  });
  if (!apart) fail('pasted structures overlap (or did not all arrive)');

  step('save as CDXML and open it again');
  const round = await page.evaluate(() => {
    const before = window.__app.doc.atoms.size;
    const text = window.__app.cdxml('smoke.cdxml');
    window.__app.openText(text, 'smoke.cdxml');
    return [before, window.__app.doc.atoms.size];
  });
  if (round[0] !== round[1]) fail(`CDXML round trip changed the atom count: ${round[0]} → ${round[1]}`);

  step('open each kind of tab');
  for (const cmd of ['new-sheet', 'new-document', 'new-slides', 'new']) {
    await page.evaluate((c) => window.__app.command(c), cmd);
    await page.waitForTimeout(400);
  }

  step('every ribbon, on every tab, is the Spreadsheet\'s height');
  // (the web version starts with the one-row Simplified Canvas ribbon; the heights are held for the
  // Classic two-row look, and the Simplified one must be lower than that)
  const simplified = () => page.evaluate(() => !!document.querySelector('.canvas-ribbon:not(.cr-classic)'));
  const startedSimplified = await simplified();
  if (startedSimplified) await page.evaluate(() => window.__app.command('ribbon-simplified'));
  if (await simplified()) fail('View ▸ Ribbon ▸ Simplified Ribbon did not switch the Canvas ribbon to Classic');
  await page.evaluate(() => window.__app.ws.newDesign({ w: 720, h: 540 }));
  // the SI tab too (retrospective audit G5-06), with a project kept in memory
  await page.evaluate(() => window.__app.openMemorySi({ 'project.json': JSON.stringify({ title: 'Smoke test' }) }));
  await page.waitForTimeout(1500);
  const heights = await page.evaluate(async () => {
    const ws = window.__app.ws, out = [];
    const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    for (const tab of [...ws.tabs]) {
      ws.activate(tab);
      await frame();
      const r = [...document.querySelectorAll('.ribbon')].find((x) => x.offsetParent);
      if (!r) continue;
      const tabs = [...r.querySelectorAll(':scope > .rb-tabs [role="tab"]')];
      // (an object's own tabs too, hidden until one is selected)
      for (const t of tabs) {
        const was = t.hidden;
        t.hidden = false;
        t.click();
        await frame();
        out.push({ mode: tab.mode, tab: t.textContent.trim(), h: r.offsetHeight });
        t.hidden = was;
      }
      tabs.find((t) => !t.hidden)?.click();
    }
    return out;
  });
  const sheetH = heights.find((x) => x.mode === 'sheet')?.h;
  console.log(`  ${heights.length} tabs in ${new Set(heights.map((x) => x.mode)).size} modes, ${sheetH} px`);
  if (new Set(heights.map((x) => x.mode)).size < 6) fail('not every mode\'s ribbon (and the SI tab\'s) was checked');
  for (const x of heights) if (x.h !== sheetH) fail(`the ${x.mode} ribbon's ${x.tab} tab is ${x.h} px tall, not the Spreadsheet's ${sheetH} px`);
  if (startedSimplified) {
    const low = await page.evaluate(async () => {
      const ws = window.__app.ws;
      ws.activate(ws.tabs.find((t) => t.mode === 'drawing') ?? ws.tabs[0]);
      window.__app.command('ribbon-simplified');
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const r = document.querySelector('.canvas-ribbon');
      return { simple: !r?.classList.contains('cr-classic'), h: r?.offsetHeight ?? 0 };
    });
    if (!low.simple) fail('the Canvas ribbon did not go back to Simplified');
    else if (!(low.h > 0 && low.h < sheetH)) fail(`the Simplified Canvas ribbon is ${low.h} px tall, not lower than the Classic ${sheetH} px`);
  }
  step('going to a canvas slide, the Keyframes group fits in the Home ribbon: nothing runs off its right end');
  const over = await page.evaluate(async () => {
    const ws = window.__app.ws;
    const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    ws.activate(ws.tabs.find((t) => t.mode === 'slides'));
    await frame();
    document.querySelector('#ribbon [data-sl-tab="home"]')?.click();
    window.__app.command('new-canvas-slide');
    window.__app.command('new-slide');
    await frame();
    // (a plain slide, then back to the canvas slide: the Keyframes group shows with the window's width unchanged)
    const deck = ws.active.deck;
    deck.go(deck.slides.findIndex((s) => s.canvas));
    await frame();
    await frame();
    const row = [...document.querySelectorAll('#ribbon .rb-panel')].find((p) => p.offsetParent && !p.hidden);
    const keys = [...document.querySelectorAll('#ribbon .rb-group.keyframes-only')].some((g) => g.offsetParent);
    return { keys, over: row ? row.scrollWidth - row.clientWidth : -1 };
  });
  if (!over.keys) fail('the Keyframes group did not show on a canvas slide');
  if (over.over > 0) fail(`on a canvas slide the Presentation Home ribbon runs ${over.over} px past the window's edge`);

  step('Presentation\'s status bar has the view buttons and zoom slider, on one line, and the slider zooms');
  const bar = await page.evaluate(async () => {
    const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const shown = ['#slide-views', '#slide-zoom', '#slide-fit'].every((s) => document.querySelector(s)?.offsetParent);
    const range = document.querySelector('#slide-zoom-range');
    range.value = '50';
    range.dispatchEvent(new Event('input'));
    await frame();
    const pct = document.querySelector('#zoom-pick').selectedOptions[0]?.textContent;
    return { shown, pct, h: document.querySelector('footer#status').offsetHeight };
  });
  if (!bar.shown) fail('the view buttons or zoom slider are missing from Presentation\'s status bar');
  if (bar.pct !== '100%') fail(`the zoom slider's middle should be 100%, not ${bar.pct}`);
  if (bar.h > 30) fail(`Presentation's status bar is ${bar.h} px tall: its buttons wrapped onto a second line`);

  await page.evaluate(() => window.__app.ws.activate(window.__app.ws.tabs.find((t) => t.mode === 'drawing')));
  await page.waitForTimeout(200);

  step('the Drawing Tools toolbox is two columns wide in every mode, and all of it shows at 1280 × 720');
  const columns = await page.evaluate(async () => {
    const ws = window.__app.ws, out = [];
    const frame = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    for (const tab of [...ws.tabs]) {
      ws.activate(tab);
      await frame();
      if (tab.mode === 'sheet' || tab.mode === 'document') continue;
      const box = document.querySelector('.toolbox[data-id="main"]'), body = box?.querySelector('.tb-body');
      // the SI tab has no canvas (its structures open in a drawing window): no docked toolbox shows there
      if (tab.mode === 'si') { out.push({ mode: 'si', siShown: !!box?.offsetParent }); continue; }
      const cells = box?.querySelector('.tb-cells');
      if (!cells || !box.offsetParent) { out.push({ mode: tab.mode, cols: 0 }); continue; }
      const b = box.getBoundingClientRect();
      out.push({ mode: tab.mode, cols: getComputedStyle(cells).gridTemplateColumns.split(' ').length, bottom: b.bottom, h: innerHeight, page: document.documentElement.scrollHeight, scrolls: body.scrollHeight > body.clientHeight });
    }
    ws.activate(ws.tabs.find((t) => t.mode === 'drawing'));
    return out;
  });
  if (!columns.some((x) => x.mode === 'si')) fail('the toolbox step did not visit the SI tab');
  for (const x of columns) {
    if (x.mode === 'si') { if (x.siShown) fail('the SI tab shows the docked Drawing Tools toolbox, but it has no canvas to draw on'); continue; }
    if (x.cols !== 2) fail(`the Drawing Tools toolbox in a ${x.mode} tab is ${x.cols} columns wide, not two`);
    else if (x.bottom > x.h || x.page > x.h) fail(`the Drawing Tools toolbox in a ${x.mode} tab runs past the window's foot (${Math.round(x.bottom)} px of ${x.h})`);
  }
  // (two columns of twelve as it comes: no third column, and nothing to scroll to; UI audit U2)
  if (columns.some((x) => x.scrolls)) fail('at 1280 × 720 the whole Drawing Tools toolbox should show without scrolling');
  await page.waitForTimeout(200);

  step('the Drawing Tools toolbox keeps its docked width when it floats');
  const widths = await page.evaluate(async () => {
    const tb = window.__app.toolboxes;
    const w = () => document.querySelector('.toolbox[data-id="main"] .tb-cells').getBoundingClientRect().width;
    const box = () => document.querySelector('.toolbox[data-id="main"]').getBoundingClientRect().width;
    // (its scroll bar's room, while it scrolls)
    const bar = () => { const b = document.querySelector('.toolbox[data-id="main"] > .tb-body'); return b.offsetWidth - b.clientWidth; };
    tb.setLocked(false);
    tb.put('main', { dock: 'float', x: 300, y: 120 });
    await new Promise((ok) => requestAnimationFrame(ok));
    const got = { cells: w(), box: box(), bar: bar(), bottom: document.querySelector('.toolbox[data-id="main"]').getBoundingClientRect().bottom };
    tb.reset();
    return got;
  });
  if (widths.box > widths.cells + widths.bar + 20) fail(`the floating Drawing Tools toolbox is ${Math.round(widths.box)} px wide for ${Math.round(widths.cells)} px of buttons and a ${widths.bar} px scroll bar`);
  if (widths.cells > 100) fail(`the floating Drawing Tools toolbox has ${Math.round(widths.cells)} px of buttons across: more than two columns`);
  if (widths.bottom > 720) fail('the floating Drawing Tools toolbox runs past the window\'s foot');

  step('typing on the Canvas, the Home tab\'s Font and Paragraph groups stand in for the bar above the text');
  await page.evaluate(() => window.__app.editor.setTool('text'));
  const ov = await page.locator('#overlay').boundingBox();
  await page.mouse.click(ov.x + ov.width / 2, ov.y + 120);
  await page.keyboard.type('CH2Cl2');
  const typing = await page.evaluate(() => ({
    open: !!window.__app.editor.typingCaption,
    bar: document.querySelector('.caption-bar')?.hidden,
    buttons: document.querySelectorAll('#canvas-ribbon [data-cr-panel="home"] .cr-font .cb-btn').length,
  }));
  await page.keyboard.press('Escape');
  if (!typing.open) fail('clicking with the Text tool opened no text to type in');
  else if (typing.bar !== true) fail('the bar above the text shows while the Canvas Home tab has the same buttons');
  if (typing.buttons < 18) fail(`the Canvas Home tab's Font and Paragraph groups have ${typing.buttons} buttons, not all of the typing bar's`);

  step('the File tab opens every menu as a page, and Esc closes it');
  if (!(await page.evaluate(() => document.body.classList.contains('menus-in-file')))) fail('the web app starts with the menu bar showing, not the menus in the File tab');
  if (await page.locator('header > .menu-wrap > button').first().isVisible()) fail('the menu bar shows while the menus are in the File tab');
  await page.locator('.canvas-ribbon .rb-file').click();
  await page.waitForTimeout(200);
  const pages = await page.evaluate(() => {
    const out = [];
    const nav = [...document.querySelectorAll('#backstage nav button[data-i]')];
    for (const b of nav) {
      b.click();
      const m = document.querySelector('.menu.bs-page');
      const items = m ? [...m.querySelectorAll('button[data-cmd]')].filter((x) => x.getClientRects().length) : [];
      // the page scrolls down when it is long; columns that run past the window's right edge would hide commands
      const pane = document.querySelector('#backstage .bs-pane');
      const off = items.filter((x) => x.getBoundingClientRect().right > innerWidth + 0.5).length;
      out.push({ name: b.textContent.trim(), shown: !!m && !m.hidden && pane.contains(m), items: items.length, off, wide: pane.scrollWidth > pane.clientWidth + 1 });
    }
    return out;
  });
  if (pages.length < 7) fail(`the File tab lists ${pages.length} menus, not File, Edit, View, Insert, Format, Chemistry and Help`);
  for (const p of pages) {
    if (!p.shown || !p.items) fail(`the File tab's ${p.name} page shows no commands`);
    else if (p.off || p.wide) fail(`the File tab's ${p.name} page runs off a 1280 × 720 window (${p.off} commands off it)`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  if (await page.evaluate(() => !document.getElementById('backstage').hidden)) fail('Esc did not close the File tab');
  // a shortcut while the page shows runs and closes it (Ctrl+Shift+F1 is Focus View, on and off again)
  await page.locator('.canvas-ribbon .rb-file').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.evaluate(() => window.__app.command('focus-view'));
  await page.waitForTimeout(150);
  if (await page.evaluate(() => !document.getElementById('backstage').hidden)) fail('a command run while the File tab shows left it open over the work');
  await page.evaluate(() => window.__app.command('focus-view'));
  await page.waitForTimeout(150);
  // Search (Alt+Q) from a command in the page
  await page.locator('.canvas-ribbon .rb-file').click();
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+KeyQ');
  await page.waitForTimeout(200);
  if (await page.evaluate(() => !document.getElementById('backstage').hidden)) fail('Alt+Q from a command in the File tab left the page open');
  if (!(await page.evaluate(() => !!document.querySelector('dialog.command-search[open]')))) fail('Alt+Q from a command in the File tab did not open Search');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  // the menu bar's checks below: the desktop app starts with it, and anyone can show it (View ▸ Menu Bar)
  await page.evaluate(() => window.__app.command('menu-bar'));
  await page.waitForTimeout(200);

  step('every menu fits in one column at 1280 × 720');
  for (const btn of await page.$$('header > .menu-wrap > button')) {
    if (!(await btn.isVisible())) continue;
    const name = (await btn.innerText()).trim();
    await btn.click();
    await page.waitForTimeout(100);
    const cols = await page.evaluate(() => [...document.querySelectorAll('header > .menu-wrap > .menu')].find((m) => !m.hidden)?.classList.contains('cols'));
    if (cols) fail(`the ${name} menu is too tall for the window and breaks into columns`);
    await page.keyboard.press('Escape');
  }

  step('Settings opens with the search box ready and Esc closes it');
  await page.evaluate(() => window.__app.command('preferences'));
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => document.activeElement?.classList.contains('sw-search')))) fail('Settings did not put the cursor in "Find a setting"');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  if (await page.evaluate(() => !!document.querySelector('dialog.settings-window[open]'))) fail('Esc did not close Settings');

  step('every menu fits a 1389 × 700 window without scrolling: the top menus and the right-click menus');
  await page.setViewportSize({ width: 1389, height: 700 });
  await page.waitForTimeout(300);
  /** The menu open now (the right-click menu, else the top menu showing): too tall if it scrolls or runs off the window. */
  const tooTall = (what) => page.evaluate((what) => {
    const m = document.querySelector('.context-menu, .menu.popup-menu, .text-menu')
      ?? [...document.querySelectorAll('header > .menu-wrap > .menu')].find((x) => !x.hidden);
    if (!m) return `the ${what} menu did not open`;
    const r = m.getBoundingClientRect();
    if (m.scrollHeight > m.clientHeight + 1 || r.bottom > innerHeight + 0.5) return `the ${what} menu is too tall for a 1389 × 700 window (${Math.round(m.scrollHeight)} px of items in ${Math.round(Math.min(m.clientHeight, innerHeight - r.top))} px)`;
    // the Chemistry menu, the longest, keeps 40 px to spare: one more row must not push it off the window (UI audit U22)
    if (/ Chemistry$/.test(what) && r.bottom > innerHeight - 40) return `the ${what} menu has under 40 px to spare in a 1389 × 700 window (it ends at ${Math.round(r.bottom)} px): move rows into its groups`;
    return null;
  }, what);
  const close = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(100); };
  const showTab = async (mode) => {
    await page.evaluate((mode) => window.__app.ws.activate(window.__app.ws.tabs.find((t) => t.mode === mode)), mode);
    await page.waitForTimeout(400);
  };
  for (const mode of ['drawing', 'sheet', 'document', 'slides', 'design']) {
    await showTab(mode);
    for (const btn of await page.$$('header > .menu-wrap > button')) {
      if (!(await btn.isVisible())) continue;
      const name = (await btn.innerText()).trim();
      await btn.click();
      await page.waitForTimeout(100);
      const bad = await tooTall(`${mode} ${name}`);
      if (bad) fail(bad);
      await close();
    }
  }
  /** Right-click at (x, y) in the window and check the menu that opens. */
  const rightClick = async (what, x, y) => {
    await page.mouse.click(x, y, { button: 'right' });
    await page.waitForTimeout(250);
    const bad = await tooTall(what);
    if (bad) fail(bad);
    await close();
  };
  // the Canvas: empty space, an atom, and a whole structure picked
  await page.evaluate(() => window.__app.command('new'));
  await page.waitForTimeout(400);
  const cv = await page.locator('#overlay').boundingBox();
  await rightClick('Canvas empty-space right-click', cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.click('[data-tool="ring-benzene"]');
  await page.mouse.click(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.evaluate(() => window.__app.editor.setTool('select'));
  const ringAtom = await page.evaluate(() => { const d = window.__app.editor.doc; return window.__app.renderer.toScreen(d.atoms.get([...d.atoms.keys()][0])); });
  await page.mouse.click(cv.x + 20, cv.y + cv.height - 20);
  await rightClick('Canvas atom right-click', cv.x + ringAtom.x, cv.y + ringAtom.y);
  await page.evaluate(() => window.__app.command('select-all'));
  await rightClick('Canvas selected-structure right-click', cv.x + ringAtom.x, cv.y + ringAtom.y);
  /** The middle of the biggest canvas showing (the sheet's grid, the document's page, the slide). */
  const middle = () => page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].filter((x) => x.offsetParent).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const r = c.getBoundingClientRect();
    return { x: r.x + Math.min(200, r.width / 2), y: r.y + Math.min(140, r.height / 2) };
  });
  await showTab('sheet');
  const cell = await middle();
  await page.mouse.click(cell.x, cell.y);
  await rightClick('Spreadsheet cell right-click', cell.x, cell.y);
  await showTab('document');
  const text = await middle();
  await page.mouse.click(text.x, text.y);
  await page.keyboard.type('Aldol condensation');
  await rightClick('Document text right-click', text.x, text.y);
  await showTab('slides');
  const slide = await page.locator('#overlay').boundingBox();
  await rightClick('Presentation slide right-click', slide.x + slide.width / 2, slide.y + slide.height / 2);
  await showTab('design');
  const page2 = await page.locator('#overlay').boundingBox();
  await rightClick('Design page right-click', page2.x + page2.width / 2, page2.y + page2.height / 2);

  step('accessibility: axe and the keyboard alone, in Light and Dark Gray (scripts/a11y-check.mjs)');
  // (in a fresh page, as `node scripts/a11y-check.mjs` runs it, so the lines match scripts/a11y-known.mjs)
  const fresh1 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  fresh1.on('pageerror', (e) => errors.push('page error: ' + e.message));
  fresh1.on('dialog', (d) => d.dismiss());
  await fresh1.goto(URL);
  await fresh1.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 30000 });
  await fresh1.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});
  const { fresh, gone } = compareA11y(await a11yProblems(fresh1));
  for (const p of fresh) fail(`accessibility (not in scripts/a11y-known.mjs): ${p}`);
  if (gone.length) console.log(`  no longer happening (take them off scripts/a11y-known.mjs):\n    ${gone.join('\n    ')}`);

  for (const e of errors) fail(e);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length) {
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log('\nSmoke test passed.');
