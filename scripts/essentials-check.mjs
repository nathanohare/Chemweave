// The controls nobody can do without stay reachable (Nate, 2026-11-26): at any window size they may
// get smaller (a button down to its picture, the file tabs onto a line of their own), but they are
// never squeezed to nothing, covered by something else or pushed off the window. Used by
// scripts/smoke.mjs, in every kind of tab, with the menu bar and with the menus in the File tab, in
// the web app and in the desktop app (its window buttons in the row: see desktopStub).

/** What must always be there to click when it shows. */
export const ESSENTIAL = [
  '.rb-file', 'header > .menu-wrap > button', '.rb-tablist [role="tab"]', '#quick-bar > button', '#tabs .tab.active',
  '#tabs .tab-ctl', '#btn-search', '.win-controls > button', '#btn-settings', 'footer button', '.toolbox .tb-head',
];

/** What must show in every window, whatever its size (but in Focus View): the open files' list, New Tab, the open file's tab and Search. */
export const REQUIRED = ['#tabs .tab-list', '#tabs .tab-add', '#tabs .tab.active', '#btn-search'];

/**
 * The problems in the window as it is now, each starting with `label`. It first watches the window
 * for a moment: a layout that keeps changing by itself (two looks taking turns) is a problem too.
 */
export function essentialProblems(page, label) {
  return page.evaluate(async ({ ESSENTIAL, REQUIRED, label }) => {
    const out = [];
    let flips = 0, loops = 0;
    const mo = new MutationObserver(() => flips++);
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const onErr = (e) => { if (/ResizeObserver loop/.test(e.message)) loops++; };
    addEventListener('error', onErr);
    await new Promise((ok) => setTimeout(ok, 600));
    mo.disconnect();
    removeEventListener('error', onErr);
    if (flips > 2 || loops) out.push(`${label}: the layout keeps changing by itself (${flips} changes${loops ? `, ${loops} ResizeObserver loops` : ''} in 0.6 s)`);
    if (!document.body.classList.contains('focus-view')) {
      for (const sel of REQUIRED) {
        const el = document.querySelector(sel);
        const r = el?.getBoundingClientRect();
        if (!el || !r.width || !r.height) out.push(`${label}: ${sel} does not show`);
      }
    }
    for (const sel of ESSENTIAL) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        // (not showing on purpose: hidden, in a closed window or menu, or not in this kind of tab)
        if (el.closest('[hidden], dialog:not([open]), .menu, .flyout, .popup-menu, #backstage') || cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        const name = `${sel} "${(el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
        if (r.width < 12 || r.height < 12) { out.push(`${label}: ${name} is squeezed to ${Math.round(r.width)} × ${Math.round(r.height)} px`); continue; }
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) { out.push(`${label}: ${name} runs off the window (${Math.round(r.left)}, ${Math.round(r.top)} to ${Math.round(r.right)}, ${Math.round(r.bottom)})`); continue; }
        // (its middle and both ends: a control half under something is covered too)
        for (const x of [r.left + 3, r.left + r.width / 2, r.right - 3]) {
          const hit = document.elementFromPoint(x, r.top + r.height / 2);
          if (hit && hit !== el && !el.contains(hit)) { out.push(`${label}: ${name} is covered by ${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}${typeof hit.className === 'string' && hit.className ? '.' + hit.className.split(' ')[0] : ''}`); break; }
        }
      }
    }
    return out;
  }, { ESSENTIAL, REQUIRED, label });
}

/**
 * Makes the page take itself for the desktop app (Tauri), so its own title bar and window buttons
 * show: give it to page.addInitScript before the page loads. The desktop calls do nothing.
 */
export function desktopStub() {
  window.isTauri = true;
  let n = 0;
  window.__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => ++n, unregisterCallback: () => {}, convertFileSrc: (s) => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}

/** Go round every open tab at each size, with the menu bar and with the File tab, and collect the problems. */
export async function sweepEssentials(page, sizes, label) {
  const out = [];
  const was = await page.evaluate(() => window.__app.ws.tabs.indexOf(window.__app.ws.active));
  for (const bar of [false, true]) {
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      const n = await page.evaluate(() => window.__app.ws.tabs.length);
      for (let i = 0; i < n; i++) {
        await page.evaluate((i) => window.__app.ws.activate(window.__app.ws.tabs[i]), i);
        if (await page.evaluate(() => document.body.classList.contains('menus-in-file')) !== bar) await page.evaluate(() => window.__app.command('menu-bar'));
        await page.waitForTimeout(200);
        const mode = await page.evaluate(() => window.__app.ws.active.mode);
        const where = `${label}, ${bar ? 'File tab' : 'menu bar'}, ${w} × ${h}, ${mode} tab`;
        out.push(...await essentialProblems(page, where));
        // (a wide window has room for the file tabs on the row: no second line)
        if (w >= 1366 && await page.evaluate(() => /\b(row-wrap|header-wrap)\b/.test(document.body.className))) out.push(`${where}: the file tabs are on a line of their own in a window this wide`);
      }
    }
  }
  // (back to the tab that was open)
  await page.evaluate((i) => window.__app.ws.activate(window.__app.ws.tabs[i]), was);
  await page.waitForTimeout(200);
  return out;
}
