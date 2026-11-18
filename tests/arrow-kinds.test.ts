// @vitest-environment jsdom
//
// Reaction arrows, part 2: the three kinds of arrow (reaction, mechanism, plain), stricter rules
// for which structures are an arrow's starting materials and products (in line with it, near it,
// no guessing between two equally near, stored roles dropped once moved away, rows of a wrapped
// scheme joined only when they sit right), resonance arrows lined up by Clean Up, and Smart Clean.

import { afterEach, describe, expect, it } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { arrowKind, interpretArrow, isReactionArrow, isSequenceArrow, linkRows, neighborsOf, plainMeasure, rolesOf, schemeItems, setRoleLimits } from '../src/chem/reaction';
import { applySchemePlan, DEFAULT_SCHEME_PREFS, planCleanUp, setSchemePrefs } from '../src/chem/scheme-layout';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { Editor } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';

window.requestAnimationFrame = () => 0;

afterEach(() => { setSchemePrefs(DEFAULT_SCHEME_PREFS); setRoleLimits({}); });

const base: Omit<Arrow, 'id'> = { tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 };
const mk = (p: Partial<Arrow> = {}): Arrow => ({ id: 1, ...base, ...p });

/** A short chain of `n` atoms, left end at x, y (a structure a little over a bond wide for n = 2). */
function chain(doc: Doc, x: number, y: number, n = 2): number[] {
  const L = doc.style.bondLength;
  return doc.edit('chain', () => {
    const ids: number[] = [];
    for (let i = 0; i < n; i++) ids.push(doc.addAtom(x + i * L * 0.87, y + (i % 2 ? -L / 2 : 0), 6).id);
    for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
    return ids;
  });
}
const addArrow = (doc: Doc, x1: number, x2: number, y: number, p: Partial<Arrow> = {}) => doc.edit('arrow', () => doc.addArrow({ ...base, tail: { x: x1, y }, head: { x: x2, y }, ...p }).id);
const change = (doc: Doc, fn: () => void) => doc.edit('change', fn);
const items = (doc: Doc) => schemeItems(doc, plainMeasure(doc));

describe('arrow kinds', () => {
  it('reads reaction, mechanism and plain arrows from how they are drawn', () => {
    expect(arrowKind(mk())).toBe('reaction');
    expect(arrowKind(mk({ line: 'dashed' }))).toBe('reaction');
    expect(arrowKind(mk({ headType: 'hollow' }))).toBe('reaction');
    expect(arrowKind(mk({ equilibrium: true, headStyle: 'halfLeft', tailStyle: 'halfLeft' }))).toBe('reaction');
    expect(arrowKind(mk({ noGo: true, noGoKind: 'hash' }))).toBe('reaction');
    // resonance, retrosynthetic and dipole arrows are plain
    expect(arrowKind(mk({ tailStyle: 'full' }))).toBe('plain');
    expect(arrowKind(mk({ shaftSpacing: 6, headType: 'angle' }))).toBe('plain');
    expect(arrowKind(mk({ dipole: true }))).toBe('plain');
    expect(arrowKind(mk({ headStyle: 'none' }))).toBe('plain');
    // curved arrows move electrons, unless they are a catalytic cycle's steps
    expect(arrowKind(mk({ sweep: 1 }))).toBe('mechanism');
    expect(arrowKind(mk({ sweep: 1, headStyle: 'halfLeft' }))).toBe('mechanism');
    expect(arrowKind(mk({ sweep: 1, step: { reactants: ['a1'], products: ['a2'], above: [], below: [] } }))).toBe('reaction');
  });

  it('only reaction arrows are steps; a chosen kind wins', () => {
    expect(isReactionArrow(mk())).toBe(true);
    expect(isReactionArrow(mk({ shaftSpacing: 6 }))).toBe(false);
    expect(isReactionArrow(mk({ dipole: true }))).toBe(false);
    expect(isReactionArrow(mk({ kind: 'plain' }))).toBe(false);
    expect(isSequenceArrow(mk({ kind: 'plain' }))).toBe(true);
    expect(isReactionArrow(mk({ tailStyle: 'full', kind: 'reaction' }))).toBe(true);
    expect(isSequenceArrow(mk({ tailStyle: 'full' }))).toBe(true);
    // a curved arrow is never a step outside a cycle, whatever it is called
    expect(isReactionArrow(mk({ sweep: 1, kind: 'reaction' }))).toBe(false);
    expect(isSequenceArrow(mk({ sweep: 1 }))).toBe(false);
  });

  it('keeps a chosen kind in CDXML', () => {
    const doc = new Doc();
    const id = addArrow(doc, 0, 60, 0, { kind: 'plain', textLook: { guides: true } });
    const back = readCdxml(writeCdxml(doc)).doc;
    const r = [...back.arrows.values()][0];
    expect(r.kind).toBe('plain');
    expect(r.textLook).toEqual({ guides: true });
    expect(doc.arrows.get(id)!.kind).toBe('plain');
  });
});

describe('starting materials and products', () => {
  it('counts only structures in line with the arrow and near its ends', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, -2 * L, 0);
    const r = addArrow(doc, 0, 4 * L, 0);
    // a product 2 bond lengths below the line: not in line
    chain(doc, 5 * L, 2.5 * L);
    let roles = interpretArrow(doc.arrows.get(r)!, items(doc), L);
    expect(roles.reactants).toEqual(['a' + a[0]]);
    expect(roles.products).toEqual([]);
    // one in line, but 4 bond lengths past the head: too far
    const far = chain(doc, 8 * L, 0);
    roles = interpretArrow(doc.arrows.get(r)!, items(doc), L);
    expect(roles.products).toEqual([]);
    // the reach can be widened (Settings > Schemes)
    setSchemePrefs({ roleReach: 5 });
    roles = interpretArrow(doc.arrows.get(r)!, items(doc), L);
    expect(roles.products).toEqual(['a' + far[0]]);
  });

  it("doesn't guess between two structures about as near as each other", () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const r = addArrow(doc, 0, 4 * L, 0);
    // two products stacked either side of the line, the same distance from the head
    chain(doc, 5 * L, -0.4 * L);
    chain(doc, 5 * L, 0.9 * L);
    expect(interpretArrow(doc.arrows.get(r)!, items(doc), L).products).toEqual([]);
  });

  it('drops a stored product once it is moved out of line, unless it was set by hand', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, -2 * L, 0), p = chain(doc, 5 * L, 0);
    const r = addArrow(doc, 0, 4 * L, 0);
    const step = { reactants: ['a' + a[0]], products: ['a' + p[0]], above: [], below: [] };
    change(doc, () => doc.updateArrow(r, { step }));
    expect(rolesOf(doc.arrows.get(r)!, items(doc), L).products).toEqual(['a' + p[0]]);
    change(doc, () => doc.moveAtoms(p, 0, 5 * L));
    expect(rolesOf(doc.arrows.get(r)!, items(doc), L).products).toEqual([]);
    expect(rolesOf(doc.arrows.get(r)!, items(doc), L).reactants).toEqual(['a' + a[0]]);
    change(doc, () => doc.updateArrow(r, { step: { ...step, manual: true } }));
    expect(rolesOf(doc.arrows.get(r)!, items(doc), L).products).toEqual(['a' + p[0]]);
  });

  it('joins a wrapped row to the row above only when that product ends the row directly above', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, 0, 0), b = chain(doc, 7 * L, 0);
    const r1 = addArrow(doc, 2 * L, 6 * L, 0);
    const c = chain(doc, 5 * L, 4 * L);
    const r2 = addArrow(doc, 0, 4 * L, 4 * L);
    const its = items(doc);
    const steps = () => [r1, r2].map((id) => ({ arrow: doc.arrows.get(id)!, roles: interpretArrow(doc.arrows.get(id)!, its, L) }));
    let st = steps();
    linkRows(st, its, L);
    expect(st[0].roles.reactants).toEqual(['a' + a[0]]);
    expect(st[1].roles.reactants).toEqual(['a' + b[0]]);
    expect(st[1].roles.products).toEqual(['a' + c[0]]);
    // the second row far below (a separate scheme): not joined
    change(doc, () => {
      doc.moveAtoms(c, 0, 20 * L);
      doc.updateArrow(r2, { tail: { x: 0, y: 24 * L }, head: { x: 4 * L, y: 24 * L } });
    });
    const its2 = items(doc);
    st = [r1, r2].map((id) => ({ arrow: doc.arrows.get(id)!, roles: interpretArrow(doc.arrows.get(id)!, its2, L) }));
    linkRows(st, its2, L);
    expect(st[1].roles.reactants).toEqual([]);
  });
});

describe('resonance arrows', () => {
  it('finds what a resonance arrow joins, and Clean Up lines them up without making it a step', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const a = chain(doc, 0, 0), b = chain(doc, 5 * L, 0.6 * L), c = chain(doc, 10 * L, -0.5 * L);
    const r1 = addArrow(doc, 2 * L, 4.4 * L, 0, { tailStyle: 'full' });
    const r2 = addArrow(doc, 7 * L, 9.4 * L, 0.3 * L, { tailStyle: 'full' });
    const n = neighborsOf(doc.arrows.get(r1)!, items(doc), L);
    expect(n.before).toEqual(['a' + a[0]]);
    expect(n.after).toEqual(['a' + b[0]]);
    const m = plainMeasure(doc);
    applySchemePlan(doc, m, planCleanUp(doc, m)!);
    // both arrows on one line, the same length, with no roles stored
    const A1 = doc.arrows.get(r1)!, A2 = doc.arrows.get(r2)!;
    expect(A1.tail.y).toBeCloseTo(A2.tail.y, 5);
    expect(A1.head.x - A1.tail.x).toBeCloseTo(A2.head.x - A2.tail.x, 5);
    expect(A1.step).toBeUndefined();
    expect(A2.step).toBeUndefined();
    // each structure centered on the line
    const box = (atoms: number[]) => items(doc).find((it) => it.atoms.includes(atoms[0]))!.box;
    for (const s of [a, b, c]) expect((box(s).y1 + box(s).y2) / 2).toBeCloseTo(A1.tail.y, 5);
  });
});

describe('Smart Clean', () => {
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

  it('organizes a scheme, then fits each arrow to its text when pressed again', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    chain(doc, 0, 0); chain(doc, 5 * L, 0.3 * L); chain(doc, 15 * L, 0);
    addArrow(doc, 2 * L, 4.4 * L, 0);
    addArrow(doc, 7 * L, 14 * L, 0);
    change(doc, () => { doc.addCaption({ x: 7.5 * L, y: -10, runs: [{ text: 'Pd(PPh3)4, K2CO3, dioxane' }], justify: 'left' }); });
    const ed = editorFor(doc);
    expect(ed.schemeInContext()).toBe(true);
    expect(ed.smartCleanScheme()).toBe('tidied');
    expect(ed.smartCleanScheme()).toBe('fitted');
    expect(ed.smartCleanScheme()).toBe('matched');
  });

  it('is not about a scheme for structures with no arrows, or curved arrows alone', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    chain(doc, 0, 0, 4);
    const ed = editorFor(doc);
    expect(ed.schemeInContext()).toBe(false);
    const id = addArrow(doc, 0, 2 * L, 0, { sweep: 1.5 });
    ed.selectThese({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set([id]), shapes: new Set() });
    expect(ed.schemeInContext()).toBe(false);
  });
});
