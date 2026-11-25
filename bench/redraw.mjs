// How long the drawing takes to redraw while something is dragged in a big drawing, in a real
// browser (standing rule R6). The speed job's bench/core.bench.ts times the edit alone (well under
// a millisecond), so a slow redraw only showed when someone dragged in a big file. Used by
// scripts/redraw-gate.mjs; bench/big.mjs prints the same and more by hand.

/** The drawing timed: the Stress test command's 2,000 structures (40,000 atoms). */
export const REDRAW_STRUCTURES = 2000;

/**
 * The most each redraw may take (the fastest side's middle step, in ms: an edit and the full redraw
 * of the drawing, not counting the screen's own compositing), whatever the base branch takes. About
 * 1.8 times the first run on the Checks machines (2026-11-24, #709: one structure 4.4 ms, 2,000
 * atoms 64 ms), as scripts/bench-gate.mjs BUDGETS. Raise one only with the reason in the pull request.
 */
export const REDRAW_BUDGETS = { one: 8, many: 115 };

/**
 * The drawing area the drags are timed in, in CSS pixels at a device pixel ratio of 1, whatever
 * size the window's ribbon, toolboxes and panels leave it. Zoom to fit depends on that size, and a
 * structure drawn bigger crosses more tiles: when #749 made the ribbon shorter and a toolbox
 * narrower, fit zoomed in 7% and dragging one structure timed 60% slower with no change to drawing.
 */
export const REDRAW_CANVAS = { width: 1500, height: 820 };

/** Fails the redraw check: the pull request is more than 40% and REDRAW_FLOOR_MS slower than the base. */
export const REDRAW_LIMIT = 1.4, REDRAW_FLOOR_MS = 2;

/** { one, many }: the middle step, in ms, of each drag in one fresh page of the app at `url`. */
export async function redrawOnce(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__app?.chem.ready, null, { timeout: 60000 });
    return await page.evaluate(([n, size]) => {
      const { doc, renderer: r, editor, stressTest } = window.__app;
      // the same drawing area on both sides (the window's own resize handling waits for a frame,
      // and this runs in one go, so it stays this size until the timing is done)
      r.resize(size.width, size.height, 1);
      const med = (xs) => +[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(2);
      stressTest(n);
      editor.fit();
      r.renderScene(doc);
      const atoms = [...doc.atoms.values()];
      const drag = (ids, steps) => {
        const t = [];
        doc.begin('Move');
        for (let i = 0; i < steps; i++) { const s0 = performance.now(); doc.moveAtoms(ids, 0.5, 0.3); r.renderScene(doc); t.push(performance.now() - s0); }
        doc.commit();
        return med(t);
      };
      const one = drag([...doc.fragmentOf(atoms[Math.floor(atoms.length / 2)].id)], 40);
      const many = drag(atoms.slice(0, 2000).map((a) => a.id), 20);
      return { one, many };
    }, [REDRAW_STRUCTURES, REDRAW_CANVAS]);
  } finally {
    await page.close();
  }
}

/** { fail, text } for the fastest runs of each side ({ one, many } lists). */
export function redrawVerdict(base, head) {
  const lines = [], bad = [];
  for (const k of Object.keys(REDRAW_BUDGETS)) {
    const was = Math.min(...base.map((o) => o[k])), now = Math.min(...head.map((o) => o[k]));
    lines.push(`${k.padEnd(28)} ${was.toFixed(1).padStart(7)} ${now.toFixed(1).padStart(7)}   (budget ${REDRAW_BUDGETS[k]})`);
    const name = k === 'one' ? 'Dragging one structure' : 'Dragging 2,000 atoms';
    if (now > REDRAW_BUDGETS[k]) bad.push(`${name} redraws in ${now.toFixed(1)} ms, over its ${REDRAW_BUDGETS[k]} ms budget (bench/redraw.mjs REDRAW_BUDGETS). Make it faster, or raise the budget with the reason in the pull request.`);
    else if (now > was * REDRAW_LIMIT && now - was > REDRAW_FLOOR_MS) bad.push(`${name} redraws ${Math.round((now / was - 1) * 100)}% slower than on the base branch (${was.toFixed(1)} → ${now.toFixed(1)} ms). If that is expected, say why in the pull request.`);
  }
  const head1 = `${'redraw (ms, fastest)'.padEnd(28)} ${'before'.padStart(7)} ${'now'.padStart(7)}`;
  return { fail: bad.length > 0, text: [head1, ...lines, '', ...(bad.length ? bad : ['The redraw did not get noticeably slower, and is within its budget.'])].join('\n') };
}
