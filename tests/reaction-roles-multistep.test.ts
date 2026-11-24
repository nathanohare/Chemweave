// @vitest-environment jsdom
//
// Reaction roles in a multistep scheme: each arrow is its own step, with its own starting
// materials, products and text above and below. A structure between two arrows is the product of
// one and the starting material of the next; a structure that is not in a step has no role in it.
// Steps kept in a ChemDraw file that edits have left behind (a step naming the group round the
// whole scheme as "above the arrow", or a side left empty) are read by where things sit now.
// Roles set by hand (a role name clicked, right-click ▸ Set Role, Link Steps in Order) are kept,
// saved with the file, and each change is one undo step.
//
// All drawings here are built in the tests (none is from another program or anyone's own file).

import { afterEach, describe, expect, it } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { interpretArrow, itemFinder, linkRows, plainMeasure, reactionSteps, rolesOf, schemeItems, setRoleLimits, type Item, type StepRoles } from '../src/chem/reaction';
import { DEFAULT_SCHEME_PREFS, setSchemePrefs } from '../src/chem/scheme-layout';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Editor, linkedSteps, stepNumbers } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';
import { RESULTS_TAG } from '../src/editor/attached';

window.requestAnimationFrame = () => 0;
const noop = () => undefined;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 50, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 20 })
    : k === 'getTransform' ? () => new DOMMatrix()
    : k === 'createLinearGradient' || k === 'createPattern' || k === 'createRadialGradient' ? () => ({ addColorStop: noop })
    : noop),
  set: () => true,
});
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

afterEach(() => { setSchemePrefs(DEFAULT_SCHEME_PREFS); setRoleLimits({}); });

const base: Omit<Arrow, 'id'> = { tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 };

/** A short chain of `n` atoms, left end at x, y. Returns its first atom's id. */
function chain(doc: Doc, x: number, y: number, n = 2): number {
  const L = doc.style.bondLength;
  return doc.edit('chain', () => {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(doc.addAtom(x + i * L * 0.87, y + (i % 2 ? -L / 2 : 0), 6).id);
    for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
    return ids[0];
  });
}
const addArrow = (doc: Doc, x1: number, x2: number, y: number) => doc.edit('arrow', () => doc.addArrow({ ...base, tail: { x: x1, y }, head: { x: x2, y } }).id);
const addText = (doc: Doc, x: number, y: number, text: string) => doc.edit('text', () => doc.addCaption({ x, y, runs: [{ text }], justify: 'left' }).id);
const items = (doc: Doc) => schemeItems(doc, plainMeasure(doc));

/** The roles of every step, each as the atom ids or caption ids it names (one per item). */
function named(doc: Doc, roles: StepRoles) {
  const find = itemFinder(items(doc));
  const ids = (refs: string[]) => refs.map((ref) => find(ref)).filter((it): it is Item => !!it).map((it) => (it.caption !== undefined ? 'c' + it.caption : 'a' + Math.min(...it.atoms))).sort();
  return { reactants: ids(roles.reactants), products: ids(roles.products), above: ids(roles.above), below: ids(roles.below) };
}
const stepOf = (doc: Doc, arrow: number) => reactionSteps(doc, items(doc)).find((s) => s.arrow.id === arrow)!.roles;

// ---- A file like the one reported: a two-step scheme kept in one group, with stale ChemDraw steps
//
// Laid out in CDXML points (bond length 14.4): A, arrow 1 (LiBr over it), B, arrow 2 (a reagent
// structure R over it, "72%" marked as its Results line under it), C with "E/Z 3:1" under it. Step 1
// names no starting material; step 2 still names A, from before the scheme was redrawn; both name
// the group round the whole scheme (their own arrows in it) as above the arrow.
const frag = (id: number, x: number, y: number) =>
  `<fragment id="${id}"><n id="${id + 1}" p="${x} ${y}"/><n id="${id + 2}" p="${x + 12.5} ${y - 7.2}"/><n id="${id + 3}" p="${x + 25} ${y}"/><b id="${id + 4}" B="${id + 1}" E="${id + 2}"/><b id="${id + 5}" B="${id + 2}" E="${id + 3}"/></fragment>`;
const arrowXml = (id: number, x1: number, x2: number, y: number) =>
  `<arrow id="${id}" FillType="None" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="750" ArrowheadWidth="250" Head3D="${x2} ${y} 0" Tail3D="${x1} ${y} 0"/>`;
const text = (id: number, x: number, y: number, s: string, results = false) =>
  `<t id="${id}" p="${x} ${y}" LineHeight="auto">${results ? `<objecttag TagType="String" Name="${RESULTS_TAG}" Value="yes" Visible="no"/>` : ''}<s font="3" size="10" face="0">${s}</s></t>`;
const STALE = `<?xml version="1.0" encoding="UTF-8" ?>
<CDXML BondLength="14.40" LabelFont="3" LabelSize="10" CaptionFont="3" CaptionSize="10"><fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable><page id="1">
<group id="900">${frag(100, 100, 200)}${arrowXml(200, 140, 200, 196)}${text(210, 158, 190, 'LiBr')}${frag(300, 215, 200)}${arrowXml(400, 255, 315, 196)}${frag(410, 270, 175)}${text(420, 272, 210, '72%', true)}${frag(500, 330, 200)}${text(510, 332, 214, 'E/Z 3:1')}</group>
<scheme id="950"><step id="951" ReactionStepReactants="" ReactionStepProducts="300" ReactionStepArrows="200" ReactionStepObjectsAboveArrow="900"/><step id="952" ReactionStepReactants="100" ReactionStepProducts="500" ReactionStepArrows="400" ReactionStepObjectsAboveArrow="900"/></scheme>
</page></CDXML>`;

describe('a scheme whose file keeps stale steps', () => {
  function open() {
    const { doc } = readCdxml(STALE);
    const arrows = [...doc.arrows.values()].sort((a, b) => a.tail.x - b.tail.x).map((r) => r.id);
    const atomNear = (x: number, y: number) => [...doc.atoms.values()].reduce((b, a) => (Math.hypot(a.x - x, a.y - y) < Math.hypot(b.x - x, b.y - y) ? a : b));
    const capWith = (s: string) => [...doc.captions.values()].find((c) => c.runs.map((r) => r.text).join('').includes(s))!;
    const k = doc.style.bondLength / 14.4;
    const ref = (x: number) => 'a' + atomNear(x * k, 200 * k).id;
    return { doc, arrows, A: ref(100), B: ref(215), C: ref(330), R: 'a' + atomNear(270 * k, 175 * k).id, libr: 'c' + capWith('LiBr').id, results: 'c' + capWith('72%').id, ez: 'c' + capWith('E/Z').id };
  }

  it('reads no group holding a step\'s own arrow, and never an arrow, as one of its roles', () => {
    const { doc, arrows } = open();
    for (const id of arrows) {
      const st = doc.arrows.get(id)!.step!;
      expect(st).toBeDefined();
      for (const k of ['reactants', 'products', 'above', 'below'] as const) expect(st[k].some((ref) => ref[0] === 'r')).toBe(false);
      // the group round the whole scheme would have made everything "above the arrow"
      expect(st.above.length).toBe(0);
    }
  });

  it('gives each arrow its own starting material, product and text over and under it', () => {
    const { doc, arrows, A, B, C, R, libr, results, ez } = open();
    expect(doc.captions.get(Number(results.slice(1)))!.results).toBe(true);
    const id = (ref: string) => named(doc, { reactants: [ref], products: [], above: [], below: [] }).reactants;
    const one = named(doc, stepOf(doc, arrows[0]));
    const two = named(doc, stepOf(doc, arrows[1]));
    // step 1: its empty starting material side worked out from where things sit (A)
    expect(one.reactants).toEqual(id(A));
    expect(one.products).toEqual(id(B));
    expect(one.above).toEqual(id(libr));
    expect(one.below).toEqual([]);
    // step 2: A (named by a stale step) is in no role; B, the middle structure, starts it
    expect(two.reactants).toEqual(id(B));
    expect(two.products).toEqual(id(C));
    expect(two.above).toEqual(id(R));
    expect(two.below).toEqual(id(results));
    // the E/Z ratio under the last product is in neither step, nor is anything of the other step
    for (const s of [one, two]) for (const k of ['reactants', 'products', 'above', 'below'] as const) expect(s[k]).not.toContain(id(ez)[0]);
    expect([...two.above, ...two.below]).not.toContain(id(libr)[0]);
    expect([...one.above, ...one.below]).not.toContain(id(R)[0]);
  });

  it('numbers the steps of one scheme 1 and 2', () => {
    const { doc } = open();
    const steps = reactionSteps(doc, items(doc)).sort((a, b) => a.arrow.tail.x - b.arrow.tail.x);
    expect(stepNumbers(steps, itemFinder(items(doc)))).toEqual([1, 2]);
  });
});

// ---- Layouts drawn in the app

describe('linear, wrapped and branching schemes', () => {
  it('a linear sequence: each middle structure ends one step and starts the next', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, 0, 0), r1 = addArrow(doc, 2 * L, 4 * L, 0), b = chain(doc, 4.6 * L, 0);
    const r2 = addArrow(doc, 6.6 * L, 8.6 * L, 0), c = chain(doc, 9.2 * L, 0), r3 = addArrow(doc, 11.2 * L, 13.2 * L, 0), d = chain(doc, 13.8 * L, 0);
    const t1 = addText(doc, 2.4 * L, -0.5 * L, 'LiBr'), t3 = addText(doc, 11.6 * L, 0.9 * L, 'DMF');
    expect(named(doc, stepOf(doc, r1))).toEqual({ reactants: ['a' + a], products: ['a' + b], above: ['c' + t1], below: [] });
    expect(named(doc, stepOf(doc, r2))).toEqual({ reactants: ['a' + b], products: ['a' + c], above: [], below: [] });
    expect(named(doc, stepOf(doc, r3))).toEqual({ reactants: ['a' + c], products: ['a' + d], above: [], below: ['c' + t3] });
    const steps = reactionSteps(doc, items(doc)).sort((p, q) => p.arrow.tail.x - q.arrow.tail.x);
    expect(stepNumbers(steps, itemFinder(items(doc)))).toEqual([1, 2, 3]);
  });

  it('a wrapped scheme: the first arrow of row 2 goes on from the last product of row 1', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    chain(doc, 0, 0); addArrow(doc, 2 * L, 4 * L, 0); const b = chain(doc, 4.6 * L, 0);
    const r2 = addArrow(doc, 0, 2 * L, 3 * L), c = chain(doc, 2.6 * L, 3 * L);
    expect(interpretArrow(doc.arrows.get(r2)!, items(doc), L).reactants).toEqual([]);
    expect(named(doc, stepOf(doc, r2))).toEqual({ reactants: ['a' + b], products: ['a' + c], above: [], below: [] });
    // both rows are one scheme
    const steps = reactionSteps(doc, items(doc)).sort((p, q) => p.arrow.tail.y - q.arrow.tail.y);
    expect(stepNumbers(steps, itemFinder(items(doc)))).toEqual([1, 2]);
  });

  it('an arrow that starts with nothing before it is not joined to a product on its own row', () => {
    // ? → C → B, the first arrow a little lower than the second (as drawn by hand): B, to the right
    // and a few points higher, is not the row above
    const doc = new Doc();
    const L = doc.style.bondLength;
    const r1 = addArrow(doc, 0, 2 * L, 5), c = chain(doc, 2.6 * L, 5, 3);
    const r2 = addArrow(doc, 4.8 * L, 6.8 * L, 0), b = chain(doc, 7.4 * L, 0);
    expect(named(doc, stepOf(doc, r2))).toEqual({ reactants: ['a' + c], products: ['a' + b], above: [], below: [] });
    const all = [r1, r2].map((id) => ({ arrow: doc.arrows.get(id)!, roles: rolesOf(doc.arrows.get(id)!, items(doc), L) }));
    linkRows(all, items(doc), L);
    expect(all[0].roles.reactants).toEqual([]);
  });

  it('a branching scheme: one structure starts two steps', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, 0, 0);
    const up = doc.edit('arrow', () => doc.addArrow({ ...base, tail: { x: 2 * L, y: -0.5 * L }, head: { x: 4 * L, y: -2 * L } }).id);
    const down = doc.edit('arrow', () => doc.addArrow({ ...base, tail: { x: 2 * L, y: 0.5 * L }, head: { x: 4 * L, y: 2 * L } }).id);
    const b = chain(doc, 4.5 * L, -2.6 * L), c = chain(doc, 4.5 * L, 2.6 * L);
    expect(named(doc, stepOf(doc, up))).toMatchObject({ reactants: ['a' + a], products: ['a' + b] });
    expect(named(doc, stepOf(doc, down))).toMatchObject({ reactants: ['a' + a], products: ['a' + c] });
  });

  it('separate schemes on one page are each numbered from 1', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    chain(doc, 0, 0); addArrow(doc, 2 * L, 4 * L, 0); chain(doc, 4.6 * L, 0); addArrow(doc, 6.6 * L, 8.6 * L, 0); chain(doc, 9.2 * L, 0);
    chain(doc, 0, 10 * L); addArrow(doc, 2 * L, 4 * L, 10 * L); chain(doc, 4.6 * L, 10 * L);
    const steps = reactionSteps(doc, items(doc)).sort((p, q) => p.arrow.tail.y - q.arrow.tail.y || p.arrow.tail.x - q.arrow.tail.x);
    expect(stepNumbers(steps, itemFinder(items(doc)))).toEqual([1, 2, 1]);
  });
});

describe('roles worked out afresh where a stored step no longer fits', () => {
  it('a stored side left empty is worked out; a stored product moved out of line is replaced', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, 0, 0), r = addArrow(doc, 2 * L, 4 * L, 0), b = chain(doc, 4.6 * L, 0), far = chain(doc, 4.6 * L, 12 * L);
    doc.edit('roles', () => doc.updateArrow(r, { step: { reactants: [], products: ['a' + far], above: [], below: [] } }));
    expect(named(doc, stepOf(doc, r))).toEqual({ reactants: ['a' + a], products: ['a' + b], above: [], below: [] });
  });
});

// ---- Roles set by hand

function editorFor(doc: Doc) {
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas');
  const host = document.createElement('div');
  host.append(scene, overlay);
  document.body.append(host);
  const ed = new Editor(doc, new Renderer(scene, overlay), host);
  ed.paused = true;
  const m = plainMeasure(doc);
  Object.assign(ed, { measure: () => m, fullMeasure: () => m });
  return ed;
}

/** A → B → C on one row, with "72%" under the second arrow. */
function twoSteps() {
  const doc = new Doc();
  const L = doc.style.bondLength;
  const a = chain(doc, 0, 0), r1 = addArrow(doc, 2 * L, 4 * L, 0), b = chain(doc, 4.6 * L, 0);
  const r2 = addArrow(doc, 6.6 * L, 8.6 * L, 0), c = chain(doc, 9.2 * L, 0);
  const pct = addText(doc, 7.2 * L, 1.2 * L, '72%');
  return { doc, L, a, b, c, r1, r2, pct };
}

describe('setting roles by hand', () => {
  it('sets one role in one undo step, keeps the step as set, and saves it with the file', () => {
    const { doc, a, b, c, r2, pct } = twoSteps();
    const ed = editorFor(doc);
    const find = itemFinder(ed.schemeItems());
    // B is wrongly made a product of step 2 (as a scrambled file might have it), then put back
    expect(ed.setItemsRole(r2, [find('a' + b)!], 'products')).toBe(true);
    expect(named(doc, doc.arrows.get(r2)!.step!)).toMatchObject({ reactants: [], products: ['a' + b, 'a' + c].sort() });
    expect(doc.arrows.get(r2)!.step!.manual).toBe(true);
    // the Results line: marked so, and under the arrow
    ed.setItemsRole(r2, [find('c' + pct)!], 'results');
    expect(doc.captions.get(pct)!.results).toBe(true);
    expect(doc.arrows.get(r2)!.step!.below).toContain('c' + pct);
    ed.undo();
    expect(doc.captions.get(pct)!.results).toBeFalsy();
    ed.redo();
    // set by hand, it stays as set when things move
    doc.edit('move', () => doc.moveAtoms([a], 0, 40));
    expect(ed.reactionRoles(r2)).toBe(doc.arrows.get(r2)!.step);
    const back = readCdxml(writeCdxml(doc)).doc;
    const st = back.arrows.get(r2)?.step ?? [...back.arrows.values()].sort((p, q) => p.tail.x - q.tail.x)[1].step!;
    expect(st.manual).toBe(true);
    expect(st.products.length).toBe(2);
    expect(st.reactants).toEqual([]);
    const r2back = [...back.arrows.values()].sort((p, q) => p.tail.x - q.tail.x)[1];
    expect(rolesOf(r2back, items(back), back.style.bondLength)).toBe(r2back.step);
  });

  it('takes a thing out of a step; Reset to Automatic reads it afresh; each is one undo step', () => {
    const { doc, b, c, r2 } = twoSteps();
    const ed = editorFor(doc);
    const find = itemFinder(ed.schemeItems());
    const before = doc.arrows.get(r2)!.step;
    ed.setItemsRole(r2, [find('a' + b)!], 'none');
    expect(named(doc, ed.reactionRoles(r2)!).reactants).toEqual([]);
    ed.undo();
    expect(doc.arrows.get(r2)!.step).toEqual(before);
    expect(named(doc, ed.reactionRoles(r2)!).reactants).toEqual(['a' + b]);
    ed.setItemsRole(r2, [find('a' + c)!], 'reactants');
    expect(named(doc, ed.reactionRoles(r2)!).reactants).toEqual(['a' + b, 'a' + c].sort());
    ed.resetReactionRoles(r2);
    expect(doc.arrows.get(r2)!.step).toBeUndefined();
    expect(named(doc, ed.reactionRoles(r2)!)).toMatchObject({ reactants: ['a' + b], products: ['a' + c] });
    ed.undo();
    expect(doc.arrows.get(r2)!.step!.manual).toBe(true);
  });

  it('offers right-click ▸ Set Role for each step a structure between two arrows is in', () => {
    const { doc, b, r1, r2 } = twoSteps();
    const ed = editorFor(doc);
    const find = itemFinder(ed.schemeItems());
    expect(ed.roleStepsFor([find('a' + b)!])).toEqual([{ arrow: r1, n: 1, role: 'products' }, { arrow: r2, n: 2, role: 'reactants' }]);
  });
});

describe('Link Steps in Order', () => {
  it('pairs things clicked in reading order into steps', () => {
    const it_ = (n: number) => ({ item: { ref: 'a' + n } as Item });
    const seq = [it_(1), { arrow: 10 }, it_(2), { arrow: 11 }, it_(3), it_(4)];
    expect(linkedSteps(seq).map((s) => ({ arrow: s.arrow, before: s.before.map((x) => x.ref), after: s.after.map((x) => x.ref) }))).toEqual([
      { arrow: 10, before: ['a1'], after: ['a2'] },
      { arrow: 11, before: ['a2'], after: ['a3', 'a4'] },
    ]);
  });

  it('fixes a scrambled sequence in one pass, as one undo step, text over and under found by position', () => {
    const { doc, a, b, c, r1, r2, pct } = twoSteps();
    const ed = editorFor(doc);
    const find = itemFinder(ed.schemeItems());
    // scrambled: step 1 says C → A, step 2 says B → nothing
    doc.edit('scramble', () => {
      doc.updateArrow(r1, { step: { reactants: ['a' + c], products: ['a' + a], above: [], below: [], manual: true } });
      doc.updateArrow(r2, { step: { reactants: ['a' + b], products: [], above: [], below: [], manual: true } });
    });
    const mid = (it: Item) => ({ x: (it.box.x1 + it.box.x2) / 2, y: (it.box.y1 + it.box.y2) / 2 });
    const linkAt = (p: { x: number; y: number }) => (ed as unknown as { linkAt(p: { x: number; y: number }): void }).linkAt(p);
    const arrowMid = (id: number) => { const r = doc.arrows.get(id)!; return { x: (r.tail.x + r.head.x) / 2, y: r.tail.y }; };
    ed.startLinking();
    linkAt(mid(find('a' + a)!));
    linkAt(arrowMid(r1));
    linkAt(arrowMid(r1)); // (a repeat adds nothing)
    linkAt(mid(find('a' + b)!));
    linkAt(arrowMid(r2));
    linkAt(mid(find('a' + c)!));
    expect(ed.linking!.seq.length).toBe(5);
    expect(ed.stopLinking(true)).toBe(2);
    expect(named(doc, doc.arrows.get(r1)!.step!)).toEqual({ reactants: ['a' + a], products: ['a' + b], above: [], below: [] });
    expect(named(doc, doc.arrows.get(r2)!.step!)).toEqual({ reactants: ['a' + b], products: ['a' + c], above: [], below: ['c' + pct] });
    expect(doc.arrows.get(r2)!.step!.manual).toBe(true);
    ed.undo();
    expect(doc.arrows.get(r1)!.step!.reactants).toEqual(['a' + c]);
    expect(doc.arrows.get(r2)!.step!.products).toEqual([]);
  });

  it('Escape leaves the steps as they were', () => {
    const { doc, a, r1 } = twoSteps();
    const ed = editorFor(doc);
    const find = itemFinder(ed.schemeItems());
    const v = doc.version;
    ed.startLinking();
    (ed as unknown as { linkAt(p: { x: number; y: number }): void }).linkAt({ x: find('a' + a)!.box.x1 + 1, y: find('a' + a)!.box.y1 + 1 });
    expect(ed.stopLinking(false)).toBe(0);
    expect(ed.linking).toBeNull();
    expect(doc.version).toBe(v);
    expect(doc.arrows.get(r1)!.step).toBeUndefined();
  });
});
