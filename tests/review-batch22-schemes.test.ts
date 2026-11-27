// @vitest-environment jsdom
//
// Review batch 22 (reaction schemes and Smart Schemes): Arrange Scheme on a closed loop with a
// structure in no step, scheme settings left behind by a Smart Scheme's own format, a placed
// starting material that isn't the nearest one, the drawing style's scheme distances in Arrange
// Scheme, finding a Smart Scheme from an atom, the arrow a new species gets, a fused loop that
// takes the whole cycle, and the + marks of a frame with no species left.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure, schemeItems } from '../src/chem/reaction';
import { applyArrange, planArrange, type Scope } from '../src/chem/scheme-arrange';
import { applySchemePlan, DEFAULT_SCHEME_PREFS, planCleanUp, schemePrefs, setSchemePrefs, spacing, withSchemePrefs } from '../src/chem/scheme-layout';
import { insertSlot, makeSmart, readSmart, smartFrameOf, smartMarks, stretch, type SmartRead } from '../src/chem/smart-scheme';
import type { Selection } from '../src/editor/arrange';

afterEach(() => setSchemePrefs(DEFAULT_SCHEME_PREFS));

const all = (): Scope => ({ atoms: new Set(), captions: new Set(), shapes: new Set(), arrows: new Set() });
const sel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });
const LOOK = { headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 } as const;

/** A short chain of n carbons from (x, y); returns its atom ids. */
function chain(doc: Doc, x: number, y: number, n = 2): number[] {
  const L = doc.style.bondLength;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(doc.addAtom(x + i * L * 0.87, y, 6).id);
  for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
  return ids;
}
const ref = (atoms: number[]) => 'a' + Math.min(...atoms);
const boxOf = (doc: Doc, atoms: number[]) => schemeItems(doc, plainMeasure(doc)).find((it) => it.atoms.includes(atoms[0]))!.box;

describe('Arrange Scheme on a closed loop with a structure in no step (F052)', () => {
  it('lays the loop out in every layout without failing, and leaves the stray structure out', () => {
    for (const kind of ['line', 'rows', 'snake', 'down', 'cycle'] as const) {
      const doc = new Doc();
      const m = plainMeasure(doc);
      // three structures joined round a loop A → B → C → A (arranged as a cycle first)
      doc.edit('build', () => { for (let i = 0; i < 3; i++) chain(doc, i * 60, 0); });
      applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'cycle' })!);
      expect(doc.arrows.size).toBe(3);
      // and one more structure elsewhere on the page, in no step
      const stray = doc.edit('stray', () => chain(doc, 400, 300));
      const before = boxOf(doc, stray);
      const plan = planArrange(doc, m, all(), { kind, perRow: 2 });
      expect(plan).not.toBeNull();
      applyArrange(doc, m, plan!);
      // no arrow joins the stray structure onto the loop
      expect(doc.arrows.size).toBe(3);
      const after = boxOf(doc, stray);
      expect(after.x1).toBeCloseTo(before.x1, 6);
      expect(after.y1).toBeCloseTo(before.y1, 6);
    }
  });
});

describe('scheme settings put back exactly (F053)', () => {
  it("a Smart Scheme's shortest arrow doesn't stay in the settings once it is laid out", () => {
    const bond = 20;
    const usual = spacing(bond).minArrow;
    // the usual shortest arrow is 2.8 bond lengths (SPACING.minArrow)
    expect(usual).toBeCloseTo(2.8 * bond, 6);
    const inside = withSchemePrefs({ arrowLength: 80 }, () => spacing(bond).minArrow);
    expect(inside).toBe(80);
    expect('arrowLength' in schemePrefs).toBe(false);
    expect(spacing(bond).minArrow).toBeCloseTo(usual, 6);
  });
});

describe('a starting material placed by an earlier step that is not the nearest (F054)', () => {
  it('stays put, and the nearer starting material goes between it and the arrow, with a + between them', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const ids = doc.edit('build', () => {
      const a = chain(doc, 0, 0);
      const p1 = chain(doc, 5 * L, 0);
      const r = chain(doc, 7.5 * L, 0);
      const p2 = chain(doc, 12 * L, 0);
      const r1 = doc.addArrow({ ...LOOK, tail: { x: 2.4 * L, y: 0 }, head: { x: 4.2 * L, y: 0 }, step: { reactants: [ref(a)], products: [ref(p1)], above: [], below: [], manual: true } }).id;
      const r2 = doc.addArrow({ ...LOOK, tail: { x: 9.5 * L, y: 0 }, head: { x: 11.3 * L, y: 0 }, step: { reactants: [ref(p1), ref(r)], products: [ref(p2)], above: [], below: [], manual: true } }).id;
      return { a, p1, r, p2, r1, r2 };
    });
    const m = plainMeasure(doc);
    const plan = planCleanUp(doc, m)!;
    expect(plan).not.toBeNull();
    applySchemePlan(doc, m, plan);
    const bp1 = boxOf(doc, ids.p1), br = boxOf(doc, ids.r);
    const tail2 = doc.arrows.get(ids.r2)!.tail.x;
    // side by side, not on top of each other: P1, then R, then the arrow
    expect(br.x1).toBeGreaterThan(bp1.x2);
    expect(br.x2).toBeLessThan(tail2);
    // with room for the + between them
    const sp = spacing(L);
    expect(br.x1 - bp1.x2).toBeGreaterThan(2 * sp.plus);
  });
});

describe("Arrange Scheme uses the drawing style's own scheme distances (F413)", () => {
  it('puts the gap the style sets between a structure and its arrow, as Clean Up Reaction does', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const a = chain(doc, 0, 0), b = chain(doc, 80, 0);
      const r = doc.addArrow({ ...LOOK, tail: { x: 30, y: 0 }, head: { x: 70, y: 0 }, step: { reactants: [ref(a)], products: [ref(b)], above: [], below: [], manual: true } }).id;
      return { a, b, r };
    });
    doc.edit('style', () => { doc.style = { ...doc.style, scheme: { structGap: 20 } }; });
    // (the app's own setting differs: 0.75 bond lengths)
    expect(spacing(doc.style.bondLength).gap).not.toBeCloseTo(20, 3);
    const m = plainMeasure(doc);
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'line' })!);
    expect(doc.arrows.get(ids.r)!.tail.x - boxOf(doc, ids.a).x2).toBeCloseTo(20, 3);
    expect(boxOf(doc, ids.b).x1 - doc.arrows.get(ids.r)!.head.x).toBeCloseTo(20, 3);
  });
});

/** A Smart Scheme of two species, the first a structure of `n` atoms and the second a text box. */
function smartWithStructure(n: number) {
  const doc = new Doc();
  const m = plainMeasure(doc);
  const s = sel();
  const L = doc.style.bondLength;
  let id = 0;
  doc.edit('make', () => {
    const atoms = chain(doc, 0, 0, n);
    for (const a of atoms) s.atoms.add(a);
    const x2 = n * 0.87 * L;
    const cap = doc.addCaption({ x: x2 + 80, y: 0, runs: [{ text: 'P' }], justify: 'center' });
    s.captions.add(cap.id);
    const r = doc.addArrow({ ...LOOK, tail: { x: x2 + 10, y: 0 }, head: { x: x2 + 60, y: 0 }, step: { reactants: [ref(atoms)], products: ['c' + cap.id], above: [], below: [], manual: true } });
    s.arrows.add(r.id);
    id = makeSmart(doc, m, s)!;
  });
  return { doc, m, id };
}

describe('finding the Smart Scheme an atom belongs to (F055)', () => {
  it('walks each structure of a frame once, not once for every atom it keeps', () => {
    const { doc, id } = smartWithStructure(40);
    expect(doc.shapes.get(id)!.frame!.atoms.length).toBe(40);
    const other = doc.edit('other', () => chain(doc, 0, 400, 30));
    const spy = vi.spyOn(doc, 'fragmentOf');
    expect(smartFrameOf(doc, 'atom', other[5])).toBeNull();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    spy.mockRestore();
    // (an atom of the scheme's structure is still found)
    const inside = doc.shapes.get(id)!.frame!.atoms[0];
    expect(smartFrameOf(doc, 'atom', inside)).toBe(id);
  });
});

describe('a species added to a line that starts with an equilibrium arrow (F415)', () => {
  it('gets an ordinary arrow with a full head, not half heads at both ends of one shaft', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const s = sel();
    let id = 0;
    doc.edit('make', () => {
      const caps = ['A', 'B', 'C'].map((t, i) => doc.addCaption({ x: i * 120, y: 0, runs: [{ text: t }], justify: 'center' }));
      for (const c of caps) s.captions.add(c.id);
      for (let i = 0; i < 2; i++) {
        const eq = i === 0;
        const r = doc.addArrow({
          ...LOOK, ...(eq ? { headStyle: 'halfLeft', tailStyle: 'halfLeft', equilibrium: true } : {}),
          tail: { x: i * 120 + 35, y: 0 }, head: { x: i * 120 + 85, y: 0 },
          step: { reactants: ['c' + caps[i].id], products: ['c' + caps[i + 1].id], above: [], below: [], manual: true },
        });
        s.arrows.add(r.id);
      }
      id = makeSmart(doc, m, s)!;
    });
    const had = new Set(doc.arrows.keys());
    doc.edit('add', () => insertSlot(doc, m, id, 2));
    const made = [...doc.arrows.values()].filter((r) => !had.has(r.id));
    expect(made.length).toBe(1);
    expect(made[0].equilibrium).toBe(false);
    expect(made[0].headStyle).toBe('full');
    expect(made[0].tailStyle).toBe('none');
  });
});

describe('a fused loop along the whole of a cycle (F416)', () => {
  it('is refused: some of the cycle has to be left for the loop already there', () => {
    const read = { closed: true, chain: true, slots: [0, 1, 2, 3].map(() => ({})), links: [] } as unknown as SmartRead;
    // species 2 to species 1 the way the arrows go runs round all four
    expect(stretch(read, 1, 0)).toBeNull();
    // three of the four is a stretch
    expect(stretch(read, 1, 3)).toEqual([1, 2, 3]);
  });
});

describe('the + marks of a Smart Scheme with no species left (F417)', () => {
  it("don't fail when only its arrows are left in the frame", () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const s = sel();
    let id = 0;
    const caps: number[] = [];
    doc.edit('make', () => {
      for (const t of ['A', 'B']) { const c = doc.addCaption({ x: caps.length * 120, y: 0, runs: [{ text: t }], justify: 'center' }); caps.push(c.id); s.captions.add(c.id); }
      const r = doc.addArrow({ ...LOOK, tail: { x: 35, y: 0 }, head: { x: 85, y: 0 }, step: { reactants: ['c' + caps[0]], products: ['c' + caps[1]], above: [], below: [], manual: true } });
      s.arrows.add(r.id);
      id = makeSmart(doc, m, s)!;
    });
    doc.edit('Delete', () => { for (const c of caps) doc.removeCaption(c); });
    const read = readSmart(doc, m, id);
    expect(read?.slots.length ?? 0).toBe(0);
    expect(() => smartMarks(doc, m, id)).not.toThrow();
  });
});
