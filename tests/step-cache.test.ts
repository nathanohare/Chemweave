// The reaction steps behind Stoichiometry Table and Check Balance's greyed state (retrospective
// audit G5-28) are worked out once per change of the drawing, so a big drawing stays fast however
// often the menus open or the ribbon repaints.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { StepCache } from '../src/chem/step-cache';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const L = 14.4;

/** A big drawing: 60 rows of A → B steps, each structure a 20-atom chain (2,400 atoms, 60 arrows). */
function bigScheme(): Doc {
  const doc = new Doc();
  doc.bulk(() => {
    for (let r = 0; r < 60; r++) {
      const y = r * 120;
      for (const x0 of [140, 280]) {
        let prev = doc.addAtom(x0, y);
        for (let i = 1; i < 20; i++) { const a = doc.addAtom(x0 + (i % 4) * L, y + Math.floor(i / 4) * L * 0.8 + (i % 2) * 7); doc.addBond(prev.id, a.id); prev = a; }
      }
      doc.addArrow({ tail: { x: 200, y: y + 28 }, head: { x: 265, y: y + 28 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
    }
  });
  return doc;
}

describe('StepCache (G5-28)', () => {
  it('works out a big drawing\'s steps once, then answers from the cache until the drawing changes', () => {
    const doc = bigScheme();
    expect(doc.atoms.size).toBe(2400);
    const cache = new StepCache();
    expect(cache.fresh(doc)).toBe(false);
    const first = cache.get(doc, () => plainMeasure(doc));
    expect(first.steps.length).toBeGreaterThan(0);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) cache.get(doc, () => plainMeasure(doc)); // a thousand menu openings
    const took = performance.now() - t0;
    expect(cache.computed).toBe(1);
    expect(took).toBeLessThan(50);
    expect(cache.fresh(doc)).toBe(true);
    // a change to the drawing: worked out again, once
    doc.bulk(() => { doc.addAtom(-100, -100); });
    expect(cache.fresh(doc)).toBe(false);
    cache.get(doc, () => plainMeasure(doc));
    cache.get(doc, () => plainMeasure(doc));
    expect(cache.computed).toBe(2);
  });
  it('the app uses the cache, and works the steps out only when a menu or the pointer asks', () => {
    const main = src('src/main.ts');
    expect(main).toContain('const { m, items, steps } = stepCache.get(doc, () => editor.measure());');
    expect(main).toContain('if (lazy && !stepCache.fresh(doc)) return null;');
    expect(main).toContain("'cmd', (c) => whyCannotRun(c, true));");
    expect(main).toContain("paintCanRun(sub.querySelectorAll<HTMLButtonElement>(':scope > button[data-cmd]'), 'cmd', (c) => whyCannotRun(c));");
    expect(main).toContain("paintCanRun(shown, 'cmd', (c) => whyDrawingCannotRun(c, true));");
  });
});
