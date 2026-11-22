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

/** The pull request label that passes an expected slowdown (the check still prints the times). */
export const SLOWER_OK_LABEL = 'slower start-up expected';

/**
 * The most the fastest start may take at all, whatever the base branch takes (standing rule R6), in
 * ms. Set at about 2.8 times the 528 ms the Checks machines measured in November 2026, so a
 * busy machine passes and a start-up that has crept up over many pull requests, each under the 25%
 * step, still fails. Raise it only with the reason in the pull request.
 */
export const STARTUP_BUDGET_MS = 1500;

/** { fail, text }: the start-up check's answer; `accepted` when the pull request carries SLOWER_OK_LABEL. */
export function startupVerdict(base, head, accepted = false) {
  const was = Math.min(...base.map((o) => o.up)), now = Math.min(...head.map((o) => o.up));
  if (now > STARTUP_BUDGET_MS) {
    const over = `The app takes ${now} ms to start, over the ${STARTUP_BUDGET_MS} ms budget (bench/startup.mjs STARTUP_BUDGET_MS).`;
    if (accepted) return { fail: false, text: `${over} Passed: the pull request has the label “${SLOWER_OK_LABEL}”.` };
    return { fail: true, text: `${over} Make it start faster, or if that is expected, say why in the pull request, add the label “${SLOWER_OK_LABEL}” and run this check again.` };
  }
  if (!startupSlower(base, head)) return { fail: false, text: 'Start-up did not get noticeably slower.' };
  const by = `The app takes ${now - was} ms (${Math.round((now / was - 1) * 100)}%) longer to start than on the base branch.`;
  if (accepted) return { fail: false, text: `${by} Passed: the pull request has the label “${SLOWER_OK_LABEL}”.` };
  return { fail: true, text: `${by} If that is expected, say why in the pull request, add the label “${SLOWER_OK_LABEL}” and run this check again.` };
}

/** startOnce, saying which side did not start (the base branch or the pull request) instead of a bare timeout. */
export async function startSide(browser, side, url, settle, start = startOnce) {
  try {
    return await start(browser, url, settle);
  } catch (e) {
    const who = side === 'base' ? 'The base branch’s app' : 'This pull request’s app';
    throw new Error(`${who} did not start at ${url} (${String(e?.message ?? e).split('\n')[0]}). Build and open it to see why.`);
  }
}
