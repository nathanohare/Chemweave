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

/** The problems in the window as it is now, each starting with `label`. */
export function essentialProblems(page, label) {
  return page.evaluate(({ ESSENTIAL, label }) => {
    const out = [];
    for (const sel of ESSENTIAL) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        // (not showing on purpose: hidden, in a closed window or menu, or not in this kind of tab)
        if (el.closest('[hidden], dialog:not([open]), .menu, .flyout, .popup-menu, #backstage') || cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
        const r = el.getBoundingClientRect();
        const name = `${sel} "${(el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
        if (r.width < 4 || r.height < 4) { out.push(`${label}: ${name} is squeezed to ${Math.round(r.width)} × ${Math.round(r.height)} px`); continue; }
        if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) { out.push(`${label}: ${name} runs off the window (${Math.round(r.left)}, ${Math.round(r.top)} to ${Math.round(r.right)}, ${Math.round(r.bottom)})`); continue; }
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !el.contains(hit)) out.push(`${label}: ${name} is covered by ${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}${typeof hit.className === 'string' && hit.className ? '.' + hit.className.split(' ')[0] : ''}`);
      }
    }
    return out;
  }, { ESSENTIAL, label });
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
        out.push(...await essentialProblems(page, `${label}, ${bar ? 'File tab' : 'menu bar'}, ${w} × ${h}, ${mode} tab`));
      }
    }
  }
  // (back to the tab that was open)
  await page.evaluate((i) => window.__app.ws.activate(window.__app.ws.tabs[i]), was);
  await page.waitForTimeout(200);
  return out;
}
