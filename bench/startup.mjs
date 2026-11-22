// One start of the app in a fresh page: when it is up (window.__app exists), and how busy the
// window is in its first `settle` ms (long tasks). Used by bench/launch.mjs and scripts/startup-gate.mjs.

/** { up, quiet, longest, busy } in ms for one start of the app at `url`. */
export async function startOnce(browser, url, settle = 5000) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
    const t = setInterval(() => { if (window.__app) { window.__up = performance.now(); clearInterval(t); } }, 5);
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__up, null, { timeout: 60000 });
  await page.waitForTimeout(settle);
  const r = await page.evaluate(() => {
    const l = window.__long;
    const busy = l.reduce((s, [, d]) => s + d, 0);
    const last = l.length ? Math.max(...l.map(([s, d]) => s + d)) : 0;
    return { up: Math.round(window.__up), quiet: Math.round(last), longest: Math.round(Math.max(0, ...l.map(([, d]) => d))), busy: Math.round(busy) };
  });
  await page.close();
  return r;
}

/** The middle value of `k` over the runs. */
export const median = (runs, k) => runs.map((o) => o[k]).sort((a, b) => a - b)[Math.floor(runs.length / 2)];

/** Fails the start-up check: the fastest start now is more than 25% and 100 ms slower than before. */
export const STARTUP_LIMIT = 1.25, STARTUP_FLOOR_MS = 100;
export function startupSlower(base, head) {
  const was = Math.min(...base.map((o) => o.up)), now = Math.min(...head.map((o) => o.up));
  return now > was * STARTUP_LIMIT && now - was > STARTUP_FLOOR_MS;
}
