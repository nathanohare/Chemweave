// The motion check run by the smoke test (docs/ui-style.md S99): with animations on, go through the
// switches people make most (ribbon tabs, modes, files, Settings, the File tab, menus, the Side Panel)
// and fail on
//   - a part that fades although it was on screen before and stays, or a part in the page (not
//     floating over it) that fades with a background of its own (it pulses: only what a switch
//     brings may fade, and a background never does),
//   - a part arriving by a move (translate, scale) that holds fixed-position parts, such as the window
//     buttons in a dialog or a submenu: for those frames they are placed against it, show in the wrong
//     place and jump,
//   - a color fading on another mode's look (the window changes color at once).
// Give it a page of the desktop app (desktopStub, which starts on Fast): `motionProblems(page, label)`.

const SETTLE = 400;

/** Start watching: what is on screen now (call just before the action). */
function before() {
  window.__mvis = new WeakSet();
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.height && getComputedStyle(el).visibility !== 'hidden') window.__mvis.add(el);
  }
}

/** The animations running just after the action, with what is wrong with each. */
function report(colorsStill) {
  const out = [];
  const name = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  for (const a of document.getAnimations()) {
    const t = a.effect?.target;
    if (!t || a.playState === 'finished' || !t.isConnected) continue;
    if (a.constructor.name === 'CSSTransition') {
      if (colorsStill && /color/i.test(a.transitionProperty)) out.push(`${name(t)}: its colors fade on another mode's look; they should change at once`);
      continue;
    }
    const iterations = a.effect.getTiming?.().iterations;
    if (iterations === Infinity) continue;
    const props = new Set((a.effect.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k)));
    const r = t.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0;
    if (props.has('opacity') && shown && window.__mvis.has(t)) out.push(`${name(t)} fades although it was on screen before (it pulses)`);
    else if (props.has('opacity') && shown && /^(static|relative|sticky)$/.test(getComputedStyle(t).position)) {
      // a part in the page, not over it, with a background of its own: as it fades from nothing, what
      // was behind shows through for a moment and the background pulses (fade what is on it instead)
      const own = getComputedStyle(t).backgroundColor;
      if (!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(own)) out.push(`${name(t)} fades in the page with a background of its own (the background pulses)`);
    }
    if ([...props].some((p) => /^(transform|translate|scale|rotate)$/.test(p))) {
      const fixed = [...t.querySelectorAll('*')].find((d) => getComputedStyle(d).position === 'fixed' && d.getBoundingClientRect().width > 0);
      if (fixed) out.push(`${name(t)} arrives by a move while it holds ${name(fixed)} (fixed): that part shows in the wrong place, then jumps`);
    }
  }
  return out;
}

/** How many fading animations run inside the parts `sel` names (to check one that should, or should not). */
function fading(sel) {
  let n = 0;
  for (const el of document.querySelectorAll(sel)) for (const a of el.getAnimations({ subtree: true })) {
    if (a.playState === 'finished' || a.constructor.name === 'CSSTransition') continue;
    if ((a.effect?.getKeyframes?.() ?? []).some((k) => 'opacity' in k)) n++;
  }
  return n;
}

export async function motionProblems(page, label) {
  const problems = [];
  const level = await page.evaluate(() => document.documentElement.dataset.motion);
  if (level === 'off') return [`${label}: the motion check needs animations on, and they are Off`];
  const cmd = (c) => page.evaluate((c) => window.__app.command(c), c);
  const tabs = () => page.$$('.ribbon:not([hidden]) .rb-tablist [role="tab"]:visible');
  // fades: where a fade must run (so a fade that broke fails too); still: where nothing may fade
  const run = async (what, act, { colorsStill = false, fades = null, still = null, prepare = null } = {}) => {
    await page.waitForTimeout(SETTLE);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(SETTLE);
    if (prepare) { await prepare(); await page.waitForTimeout(SETTLE); }
    await page.evaluate(before);
    try { await act(); } catch (e) { problems.push(`${label}, ${what}: could not do it (${String(e.message).split('\n')[0]})`); return; }
    await page.waitForTimeout(20);
    for (const p of await page.evaluate(report, colorsStill)) problems.push(`${label}, ${what}: ${p}`);
    if (fades && !(await page.evaluate(fading, fades))) problems.push(`${label}, ${what}: nothing in ${fades} fades in, and it should`);
    if (still) {
      const n = await page.evaluate(fading, still);
      if (n) problems.push(`${label}, ${what}: ${n} part(s) of ${still} fade in; another file shows at once`);
    }
  };
  const panel = '.ribbon:not([hidden]) .rb-panel:not([hidden])';
  await run('another ribbon tab', async () => (await tabs())[1].click(), { fades: panel });
  await run('back to the first ribbon tab', async () => (await tabs())[0].click(), { fades: panel });
  await run('Settings', () => cmd('preferences'));
  await run('a Settings page', () => page.evaluate(() => [...document.querySelectorAll('dialog[open] .sw-nav button, dialog[open] nav button')][2].click()),
    { prepare: () => cmd('preferences'), fades: 'dialog[open] .sw-pane' });
  for (const k of ['new-document', 'new-slides', 'new-sheet', 'new', 'prev-tab', 'next-tab']) {
    await run(`File ▸ ${k}`, () => cmd(k), { colorsStill: true, still: '#work, .ribbon' });
  }
  await run('a menu, then its submenu straight away', async () => {
    const top = await page.$('header > .menu-wrap > button:visible');
    if (!top) throw new Error('no menu bar');
    await top.click();
    const sub = await page.$('.menu:not([hidden]) > .submenu > .has-sub:visible');
    if (sub) { await sub.hover(); await sub.press('ArrowRight').catch(() => {}); }
  });
  await run('a right-click menu', async () => {
    const box = await page.locator('#overlay').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  }, { fades: '.context-menu, .menu.popup-menu' });
  await run('fold the Side Panel', () => cmd('fold-side'));
  await run('unfold the Side Panel', () => cmd('fold-side'));
  await page.keyboard.press('Escape');
  return [...new Set(problems)];
}
