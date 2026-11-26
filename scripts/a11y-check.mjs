// The accessibility check (standing rule R10), run by the browser smoke test on every pull request
// and on its own: axe (axe-core, WCAG 2.0 and 2.1 A and AA rules) on each kind of tab, an open
// menu and an open window, in the Light and Dark Gray looks, and on every ribbon tab and a
// right-click menu in the Light look; then a keyboard-only walk: the menu
// bar (F10, arrows, Esc), the toolbox (reached and used with Tab and Enter) and a window (focus goes
// in, Tab stays in, Esc closes it and gives focus back); and that the drop-down list of a typed box in
// the Settings and Watermark windows is on top of the window, not under it.
//
// Problems found before this check existed are in scripts/a11y-known.mjs: it fails only on a new
// one, and says which known ones no longer happen. On its own, against an app being served:
//   A11Y_URL=http://localhost:5173/ node scripts/a11y-check.mjs            (npx vite running)
//   A11Y_URL=… node scripts/a11y-check.mjs --write   rewrites scripts/a11y-known.mjs with what it finds now
// (only after fixing what can be fixed: every line written there is a known gap).
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KNOWN_A11Y } from './a11y-known.mjs';

// (worked out when the check runs, so that a test can load this file in jsdom)
const axePath = () => fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url));
const LOOKS = [['Light', 'theme-light'], ['Dark Gray', 'theme-darkgray']];
const MODES = [['Canvas', 'drawing', 'new'], ['Spreadsheet', 'sheet', 'new-sheet'], ['Document', 'document', 'new-document'], ['Presentation', 'slides', 'new-slides'], ['Design', 'design', 'new-design']];

/**
 * One line per problem, the same each run: the rule, the look for colour contrast, the element. The
 * element's selector is kept to what doesn't change with the window's width or what was clicked
 * last (no :nth-child, no classes for a ribbon group folded or a button pressed), so many elements
 * of one kind (the labels of the ribbon's groups) make one line.
 */
const STATE = /\.(rb-folded|rb-compact|rb-idle|active|open|selected|on|checked|hover|focus|shown|hidden|pressed|current)(?=[.:\[\s>]|$)/g;
export const selectorKey = (target) => target.join(' ').replace(/:nth-(child|of-type)\(\d+\)/g, '').replace(STATE, '').replace(/\s+/g, ' ').slice(0, 160);
const axeLine = (look, v, node) => `axe ${v.id}${v.id === 'color-contrast' ? ` (${look})` : ''}: ${selectorKey(node.target)}`;

/**
 * axe's label-content-name-mismatch (WCAG 2.5.3, Label in Name) compares a button's name with all the
 * text drawn inside it, and that counts the letters of icons too: the "Aa" of the Styles icon, the
 * ring size in a ring tool's picture, the "A⁺" picture of Increase Font Size. WCAG's Understanding
 * 2.5.3 leaves symbols that stand for a command out (a "B" for Bold), and axe itself skips single
 * letters and the icons "Aa" and "abc"; it can't tell an icon's letters from a label, so this asks
 * the page. A node is kept as a problem unless, leaving out what is marked as an icon (inside an
 * aria-hidden element that is an <svg>, or whose text has no word of three letters or more), the
 * button's visible words are in its name. Words hidden that way still count, so hiding a real label
 * with aria-hidden does not pass.
 */
export function labelInNameStill(target) {
  const el = document.querySelector(target);
  if (!el) return true;
  // an icon: hidden, and a picture or one short glyph (A⁺, x₂, Aa, 3D, R/S), never words ("Go On")
  const icon = (n) => n.getAttribute('aria-hidden') === 'true' && (n.closest('svg') || !/\p{L}{3,}|\S\s+\S/u.test((n.textContent || '').trim()));
  const words = (n) => [...n.childNodes].map((c) => (c.nodeType === 3 ? c.nodeValue : c.nodeType !== 1 ? '' : c.nodeName === 'BR' ? ' ' : icon(c) || getComputedStyle(c).display === 'none' ? ' ' : words(c))).join('');
  const norm = (t) => t.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
  const visible = norm(words(el));
  const named = el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') || el.getAttribute('aria-label') || el.textContent || '';
  return !!visible && !` ${norm(named)} `.includes(` ${visible} `);
}

/** Every accessibility problem on `page` (the app already started): a sorted list of lines. */
export async function a11yProblems(page, log = () => {}) {
  const found = new Set();
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(fs.readFileSync(axePath(), 'utf8'));
  const runAxe = async (look, where) => {
    // (one expression, so that labelInNameStill runs in the page without eval, which a page's CSP may forbid)
    const r = await page.evaluate(`(async () => {
      const still = ${labelInNameStill.toString()};
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
      for (const v of r.violations) if (v.id === 'label-content-name-mismatch') v.nodes = v.nodes.filter((n) => still(n.target[0]));
      return { violations: r.violations.filter((v) => v.nodes.length) };
    })()`);
    let n = 0;
    for (const v of r.violations) for (const node of v.nodes) { found.add(axeLine(look, v, node)); n++; }
    log(`  axe, ${look}, ${where}: ${n} problem${n === 1 ? '' : 's'}`);
  };
  const cmd = (c) => page.evaluate((c) => window.__app.command(c), c);
  const esc = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(100); };
  const tabFor = async (mode, make) => {
    let t = await page.evaluate((mode) => window.__app.ws.tabs.findIndex((x) => x.mode === mode), mode);
    if (t < 0) { await cmd(make); await page.waitForTimeout(600); await page.locator('.tw-close').click({ timeout: 800 }).catch(() => {}); }
    else await page.evaluate((t) => window.__app.ws.activate(window.__app.ws.tabs[t]), t);
    await page.waitForTimeout(400);
  };

  for (const [look, theme] of LOOKS) {
    await cmd(theme);
    await page.waitForTimeout(300);
    for (const [name, mode, make] of MODES) {
      await tabFor(mode, make);
      await runAxe(look, name);
      // every other ribbon tab of this kind of tab (in the Light look only, to keep the run short)
      if (look !== 'Light') continue;
      // (every tablist but the open files', whose tabs would switch away from this kind of tab)
      const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tablist"]:not(.tab-strip) > [role="tab"]')]
        .filter((b) => b.offsetParent && !b.hidden && b.getAttribute('aria-selected') !== 'true').map((b) => b.textContent.trim()));
      for (const t of tabs) {
        await page.evaluate((t) => [...document.querySelectorAll('[role="tablist"]:not(.tab-strip) > [role="tab"]')].find((b) => b.offsetParent && b.textContent.trim() === t)?.click(), t);
        await page.waitForTimeout(150);
        await runAxe(look, `${name}, ${t} ribbon tab`);
      }
      await page.evaluate(() => [...document.querySelectorAll('.ribbon [role="tablist"] > [role="tab"]')].find((b) => b.offsetParent && !b.hidden)?.click());
      if (mode === 'drawing') {
        // a right-click menu, on the empty page
        const box = await page.locator('#overlay').boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await page.waitForTimeout(200);
          await runAxe(look, 'a right-click menu open');
          await esc();
        }
      }
    }
    await tabFor('drawing', 'new');
    // an open menu (the File tab's page in the web app, which has no menu bar), and an open window
    if (await page.evaluate(() => document.body.classList.contains('menus-in-file'))) {
      await page.locator('.ribbon > .rb-tabs > .rb-file:visible').first().click();
      await page.waitForTimeout(200);
      await runAxe(look, 'the File tab open');
      await esc();
      // and the menu bar's File menu, as the desktop app (or anyone who shows the menu bar) has it
      await cmd('menu-bar');
      await page.waitForTimeout(150);
      await page.locator('header > .menu-wrap > button').first().click();
      await page.waitForTimeout(200);
      await runAxe(look, 'the File menu open');
      await esc();
      await cmd('menu-bar');
      await page.waitForTimeout(150);
    } else {
      await page.locator('header > .menu-wrap > button').first().click();
      await page.waitForTimeout(200);
      await runAxe(look, 'the File menu open');
    }
    await esc();
    await cmd('preferences');
    await page.waitForTimeout(400);
    await runAxe(look, 'Settings open');
    await esc();
  }
  await cmd('theme-light');

  // ------------------------------------------------ the keyboard alone
  const focused = () => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const s = getComputedStyle(a);
    return {
      tag: a.tagName.toLowerCase(), cls: a.className && typeof a.className === 'string' ? a.className : '', text: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40),
      inHeader: !!a.closest('header'), inMenu: !!a.closest('[role="menu"]'), inToolbox: !!a.closest('.toolbox'), tool: a.getAttribute('data-tool'), inDialog: !!a.closest('dialog[open]'), inFileNav: !!a.closest('#backstage nav'), inFilePage: !!a.closest('#backstage .menu'),
      // a visible focus mark: an outline, or a ring drawn as a shadow
      ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'),
    };
  });
  const what = (f) => (f ? `${f.tag}${f.text ? ` “${f.text}”` : ''}` : 'nothing');
  const key = async (k, wait = 80) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
  await tabFor('drawing', 'new');
  await page.mouse.click(5, 300).catch(() => {});

  // the File tab (the web app's menus): F10 opens it on the list of menus, Right goes into the menu's
  // commands, Down moves, Left goes back to the list, Esc closes it
  const menusInFile = await page.evaluate(() => document.body.classList.contains('menus-in-file'));
  let f;
  if (menusInFile) {
    await key('F10', 200);
    f = await focused();
    if (!f?.inFileNav) found.add(`keyboard: F10 does not open the File tab on its list of menus (focus is on ${what(f)})`);
    else {
      if (!f.ring) found.add(`keyboard: the File tab's ${what(f)} shows no focus mark`);
      await key('ArrowRight', 150);
      f = await focused();
      if (!f?.inFilePage) found.add(`keyboard: Right in the File tab's list does not go to the menu's commands (focus is on ${what(f)})`);
      else {
        const first = f.text;
        await key('ArrowDown');
        f = await focused();
        if (!f?.inFilePage || f.text === first) found.add('keyboard: Down in the File tab does not move to the next command');
        else if (!f.ring) found.add(`keyboard: File tab command ${what(f)} shows no focus mark`);
        await key('ArrowLeft', 150);
        f = await focused();
        if (!f?.inFileNav) found.add(`keyboard: Left in the File tab's commands does not go back to the list (focus is on ${what(f)})`);
      }
      await key('Escape', 150);
      if (await page.evaluate(() => !document.getElementById('backstage').hidden)) found.add('keyboard: Esc does not close the File tab');
    }
    // the menu bar's own keys below (the desktop app starts with it)
    await cmd('menu-bar');
    await page.waitForTimeout(150);
    await page.mouse.click(5, 300).catch(() => {});
  }

  // menus: F10 to the menu bar, Down opens, Down moves, Right goes to the next menu, Esc closes and stays on its button
  await key('F10', 150);
  f = await focused();
  if (!f?.inHeader) found.add(`keyboard: F10 does not go to the menu bar (focus is on ${what(f)})`);
  else {
    if (!f.ring) found.add(`keyboard: the menu bar’s ${what(f)} shows no focus mark`);
    await key('ArrowDown', 200);
    f = await focused();
    if (!f?.inMenu) found.add(`keyboard: Down on a menu button does not open its menu (focus is on ${what(f)})`);
    else {
      const first = f.text;
      await key('ArrowDown');
      f = await focused();
      if (!f?.inMenu || f.text === first) found.add('keyboard: Down in an open menu does not move to the next item');
      else if (!f.ring) found.add(`keyboard: menu item ${what(f)} shows no focus mark`);
      await key('ArrowRight', 200);
      f = await focused();
      if (!f?.inMenu && !f?.inHeader) found.add(`keyboard: Right in a menu does not go to the next menu (focus is on ${what(f)})`);
      await key('Escape', 150);
      f = await focused();
      if (!f?.inHeader) found.add(`keyboard: Esc in a menu does not go back to its button (focus is on ${what(f)})`);
    }
  }
  await esc();

  // the toolbox: Tab reaches a tool, it shows where the focus is, and Enter picks it
  await page.mouse.click(5, 300).catch(() => {});
  let tool = null;
  for (let i = 0; i < 400 && !tool; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (f?.inToolbox && f.tool && f.tool !== 'select') tool = f;
  }
  if (!tool) found.add('keyboard: Tab never reaches a tool in the Drawing Tools toolbox');
  else {
    await page.waitForTimeout(50);
    if (!(await focused())?.ring) found.add(`keyboard: toolbox button ${what(tool)} shows no focus mark`);
    await key('Enter', 150);
    const now = await page.evaluate(() => window.__app.editor.toolName);
    if (now !== tool.tool) found.add(`keyboard: Enter on toolbox button ${tool.tool} does not pick the tool (the tool is ${now})`);
  }
  await page.evaluate(() => window.__app.editor.setTool('select'));

  // a drop-down list in a window: a window opened with showModal() sits above the page, so a list added
  // to the page is drawn under it and can't be clicked. For each window with typed boxes that have
  // suggestions (Settings, a Document's Custom Watermark), the last item of the list must be what
  // is on top at its own center. (The Orbital window's Pointing box, where this was first seen, is now a
  // plain Rotation box with no list.)
  // (the first typed box of each window: Settings' AI page's model box, and the Watermark window's Text box)
  for (const [command, label, before, mode] of [['preferences', 'Settings', 'ai', null], ['watermark-custom', 'Watermark', null, ['document', 'new-document']]]) {
    if (mode) await tabFor(mode[0], mode[1]);
    await cmd(command);
    await page.waitForSelector('dialog[open]', { timeout: 3000 }).catch(() => {});
    if (before) {
      await page.evaluate((p) => document.querySelector(`dialog[open] .sw-list button[data-page="${p}"]`)?.click(), before);
      await page.waitForTimeout(150);
    }
    const res = await page.evaluate(async () => {
      const input = [...document.querySelectorAll('dialog[open] input.combo')].find((x) => x.offsetParent);
      if (!input) return 'no box';
      document.querySelectorAll('.combo-list').forEach((l) => l.remove());
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      const items = document.querySelectorAll('.combo-list .combo-item');
      const last = items[items.length - 1];
      if (!last) return 'no list';
      last.scrollIntoView({ block: 'nearest' });
      const r = last.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && last.contains(top) ? 'ok' : 'covered';
    });
    if (res === 'covered') found.add(`window: a drop-down list in the ${label} window is under the window (its last item can't be clicked)`);
    else if (res !== 'ok') found.add(`window: the ${label} window's drop-down list check found ${res} (the check can't run)`);
    await esc();
    if (await page.evaluate(() => !!document.querySelector('dialog[open]'))) await esc();
    if (mode) await tabFor('drawing', 'new');
  }

  // a window: Settings, from the keyboard: focus goes in, Tab keeps it in, Esc closes it and gives focus back
  await page.mouse.click(5, 300).catch(() => {});
  await key('F10', 150);
  const opener = await focused();
  await cmd('preferences');
  await page.waitForTimeout(400);
  f = await focused();
  if (!f?.inDialog) found.add(`keyboard: opening Settings does not put the focus in it (focus is on ${what(f)})`);
  let left = null;
  for (let i = 0; i < 60 && !left; i++) {
    await page.keyboard.press('Tab');
    f = await focused();
    if (!f?.inDialog) left = f;
  }
  if (left !== null || (await page.evaluate(() => !document.querySelector('dialog[open]')))) found.add(`keyboard: Tab leaves the open Settings window (to ${what(left)})`);
  // (Esc may first leave a list or a box being typed in, so twice at most)
  const open = () => page.evaluate(() => !!document.querySelector('dialog[open]'));
  await key('Escape', 250);
  if (await open()) await key('Escape', 250);
  if (await open()) found.add('keyboard: Esc (twice) does not close the Settings window');
  else {
    f = await focused();
    if (!f && opener) found.add('keyboard: closing the Settings window leaves the focus nowhere (it should go back where it was)');
  }
  await esc();
  if (menusInFile) await cmd('menu-bar');
  return [...found].sort();
}

/** The problems not in KNOWN_A11Y, and the known ones that no longer happen. */
export function compareA11y(found, known = KNOWN_A11Y) {
  const k = new Set(known), f = new Set(found);
  return { fresh: found.filter((x) => !k.has(x)), gone: known.filter((x) => !f.has(x)) };
}

// ------------------------------------------------ on its own
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { launch } = await import('../bench/browser.mjs');
  const url = process.env.A11Y_URL || 'http://localhost:5173/';
  const browser = await launch();
  let code = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('dialog', (d) => d.dismiss());
    await page.goto(url);
    await page.waitForFunction(() => window.__app?.chem?.ready, null, { timeout: 60000 });
    await page.locator('#welcome-close').click({ timeout: 2000 }).catch(() => {});
    const found = await a11yProblems(page, console.log);
    if (process.argv.includes('--write')) {
      const file = fileURLToPath(new URL('./a11y-known.mjs', import.meta.url));
      const src = fs.readFileSync(file, 'utf8');
      const head = src.slice(0, src.indexOf('export const KNOWN_A11Y'));
      fs.writeFileSync(file, `${head}export const KNOWN_A11Y = [\n${found.map((x) => `  ${JSON.stringify(x)},\n`).join('')}];\n`);
      console.log(`Wrote ${found.length} known problems to scripts/a11y-known.mjs.`);
    } else {
      const { fresh, gone } = compareA11y(found);
      if (gone.length) console.log(`\nNo longer happening (take them off scripts/a11y-known.mjs):\n  ${gone.join('\n  ')}`);
      if (fresh.length) { console.log(`\n${fresh.length} new accessibility problem${fresh.length === 1 ? '' : 's'}:\n  ${fresh.join('\n  ')}`); code = 1; }
      console.log(`\n${found.length} accessibility problems, ${found.length - fresh.length} of them already known.`);
    }
  } finally {
    await browser.close();
  }
  process.exit(code);
}
