// @vitest-environment jsdom
//
// Focal points (feature file II): the spot on a structure that counts as its middle when lining
// things up. Kept as marks on atoms (one atom, a bond's two, or a ring's), so it moves and turns
// with the structure, goes into ChemDraw files and comes back, and Align, Distribute, Arrange and
// Clean Up Reaction line structures up on it.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import {
  alignPoint, clearFocal, focalAtoms, focalKind, focalPoint, focalTarget, parseFocalPrefs, setFocal, tidyFocal, DEFAULT_FOCAL_PREFS,
} from '../src/chem/focal';
import { units, alignOffsets, distributeOffsets, POINTS, type Selection } from '../src/editor/arrange';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { plainMeasure } from '../src/chem/reaction';
import { planCleanUp } from '../src/chem/scheme-layout';

const sel = (s: Partial<Selection>): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set(), ...s });

/** A benzene ring centred at (x, y) with a chain of `tail` carbons going down from its bottom atom. */
function arene(doc: Doc, x: number, y: number, tail = 0): { ring: number[]; chain: number[] } {
  const L = 14.4;
  const ring: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    ring.push(doc.addAtom(x + L * Math.cos(a), y + L * Math.sin(a)).id);
  }
  for (let k = 0; k < 6; k++) doc.addBond(ring[k], ring[(k + 1) % 6], k % 2 ? 1 : 2);
  const chain: number[] = [];
  let prev = ring[3];
  for (let k = 0; k < tail; k++) {
    const p = doc.atoms.get(prev)!;
    const a = doc.addAtom(p.x + (k % 2 ? 12 : -12), p.y + 7.2).id;
    doc.addBond(prev, a);
    chain.push(a);
    prev = a;
  }
  return { ring, chain };
}

describe('focal point marks', () => {
  it('a ring, a bond or an atom, and its middle', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 0, 0, 3));
    expect(focalKind(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
    doc.edit('set', () => setFocal(doc, s.ring));
    expect(focalKind(doc, doc.fragmentOf(s.ring[0]))).toBe('ring');
    const p = focalPoint(doc, doc.fragmentOf(s.ring[0]))!;
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
    // setting another spot replaces the first
    doc.edit('set', () => setFocal(doc, [s.chain[0], s.chain[1]]));
    expect(focalKind(doc, doc.fragmentOf(s.ring[0]))).toBe('bond');
    expect(focalAtoms(doc, doc.fragmentOf(s.ring[0])).sort()).toEqual([s.chain[0], s.chain[1]].sort());
    doc.edit('reset', () => clearFocal(doc, doc.fragmentOf(s.ring[0])));
    expect(focalPoint(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
  });

  it('what a selection names: one atom, a bond, or exactly one ring', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 0, 0, 2));
    expect(focalTarget(doc, { atoms: new Set([s.ring[0]]), bonds: new Set() })).toEqual([s.ring[0]]);
    expect(focalTarget(doc, { atoms: new Set([s.ring[0], s.ring[1]]), bonds: new Set() })?.length).toBe(2);
    expect(focalTarget(doc, { atoms: new Set([s.ring[0], s.ring[2]]), bonds: new Set() })).toBeNull();
    expect(focalTarget(doc, { atoms: new Set(s.ring), bonds: new Set() })?.length).toBe(6);
    expect(focalTarget(doc, { atoms: new Set([...s.ring, s.chain[0]]), bonds: new Set() })).toBeNull();
  });

  it('with the Largest ring preference, a structure without its own lines up on its ring', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 0, 0, 4));
    const atoms = [...doc.fragmentOf(s.ring[0])];
    expect(alignPoint(doc, atoms, { x: 0, y: 30 }, 'box')).toBeNull();
    const p = alignPoint(doc, atoms, { x: 0, y: 30 }, 'ring')!;
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('settings from a file: anything odd keeps its default', () => {
    expect(parseFocalPrefs(undefined)).toEqual(DEFAULT_FOCAL_PREFS);
    expect(parseFocalPrefs({ look: 'mass', dflt: 'ring', distribute: 'focal', tipShown: true })).toEqual({ look: 'mass', dflt: 'ring', distribute: 'focal', tipShown: true });
    expect(parseFocalPrefs({ look: 'star', dflt: 7 }).look).toBe('target');
  });
});

describe('lining up on focal points', () => {
  /** Three arenes with different tails, rings at different heights, each ring its focal point. */
  function row() {
    const doc = new Doc();
    const parts = doc.edit('build', () => [arene(doc, 0, 0, 0), arene(doc, 60, 10, 4), arene(doc, 120, -6, 2)]);
    doc.edit('focal', () => { for (const p of parts) setFocal(doc, p.ring); });
    const all = sel({ atoms: new Set(doc.atoms.keys()), bonds: new Set(doc.bonds.keys()) });
    return { doc, parts, us: units(doc, all, POINTS) };
  }

  it('Align Middle puts every ring at the same height', () => {
    const { us } = row();
    const off = alignOffsets(us, 'vcenter');
    const ys = us.map((u, i) => u.focus!.y + off[i].y);
    expect(ys[1]).toBeCloseTo(ys[0], 6);
    expect(ys[2]).toBeCloseTo(ys[0], 6);
  });

  it('Distribute by focal points spaces the rings evenly', () => {
    const { us } = row();
    const off = distributeOffsets(us, 'x', 'focal');
    const xs = us.map((u, i) => u.focus!.x + off[i].x).sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 6);
  });

  it('without focal points, Align Middle lines up the boxes as before', () => {
    const doc = new Doc();
    doc.edit('build', () => { arene(doc, 0, 0, 0); arene(doc, 60, 10, 4); });
    const us = units(doc, sel({ atoms: new Set(doc.atoms.keys()), bonds: new Set(doc.bonds.keys()) }), POINTS);
    const off = alignOffsets(us, 'vcenter');
    const mid = (i: number) => (us[i].box.y1 + us[i].box.y2) / 2 + off[i].y;
    expect(mid(1)).toBeCloseTo(mid(0), 6);
  });

  it('Clean Up Reaction puts each focal point on the arrow line', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const a = arene(doc, 0, 0, 0);
      const b = arene(doc, 120, 8, 4);
      const r = doc.addArrow({ tail: { x: 30, y: 0 }, head: { x: 80, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 });
      return { a, b, r: r.id };
    });
    doc.edit('focal', () => { setFocal(doc, ids.a.ring); setFocal(doc, ids.b.ring); });
    const plan = planCleanUp(doc, plainMeasure(doc))!;
    expect(plan).not.toBeNull();
    const arrowY = plan.arrows.get(ids.r)!.tail.y;
    const shift = plan.shifts.get('a' + Math.min(...doc.fragmentOf(ids.b.ring[0]))) ?? { x: 0, y: 0 };
    const ring = focalPoint(doc, doc.fragmentOf(ids.b.ring[0]))!;
    expect(ring.y + shift.y).toBeCloseTo(arrowY, 6);
  });
});

describe('keeping focal points sound', () => {
  it('ChemDraw files keep them', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 0, 0, 2));
    doc.edit('focal', () => setFocal(doc, [s.chain[0], s.chain[1]]));
    const back = readCdxml(writeCdxml(doc)).doc;
    const marked = [...back.atoms.values()].filter((a) => a.focal);
    expect(marked.length).toBe(2);
    expect(focalKind(back, back.fragmentOf(marked[0].id))).toBe('bond');
    // and a structure without one gains none
    const plain = new Doc();
    plain.edit('build', () => arene(plain, 0, 0, 2));
    expect(writeCdxml(plain)).not.toContain('focal point');
  });

  it('taking out an atom of the focal ring goes back to the middle of the box', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 0, 0, 2));
    doc.edit('focal', () => setFocal(doc, s.ring));
    let lost = 0;
    doc.beforeCommit = (before) => { lost += tidyFocal(doc, before); };
    doc.edit('Delete', () => doc.removeAtom(s.ring[1]));
    expect(lost).toBeGreaterThan(0);
    expect(focalPoint(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
  });

  it('joining two structures keeps the focal point of the one drawn from', () => {
    const doc = new Doc();
    const p = doc.edit('build', () => [arene(doc, 0, 0, 1), arene(doc, 60, 0, 1)]);
    doc.edit('focal', () => { setFocal(doc, p[0].ring); setFocal(doc, p[1].ring); });
    // a bond drawn from the second structure's tail to the first's
    doc.beforeCommit = (before) => { tidyFocal(doc, before, p[1].chain[0]); };
    doc.edit('Draw', () => doc.addBond(p[1].chain[0], p[0].chain[0]));
    const f = focalAtoms(doc, doc.fragmentOf(p[0].ring[0]));
    expect(f.sort()).toEqual([...p[1].ring].sort());
    expect(p[0].ring.some((id) => doc.atoms.get(id)!.focal)).toBe(false);
  });
});
