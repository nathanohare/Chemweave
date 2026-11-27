// @vitest-environment jsdom
//
// Review batch 22 (chemistry): lone pairs of atoms the curved arrows don't change stay stuck to
// them in the next intermediate, metal labels with L or Ln before the metal, a focal point whose
// atom is deleted, significant figures that round up to a power of ten, isotope and bond warnings, and the Stoichiometry Table's volume and green metrics.

import { describe, expect, it } from 'vitest';
import { Doc, PARTIAL, type StereoInfo } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { pushArrow, pushPins, symbolPin, type PushEnd } from '../src/chem/mechanism';
import { productDrawing, pushArrowsOf, readPushes } from '../src/chem/push-electrons';
import { countElectrons } from '../src/chem/electrons';
import { focalKind, focalPoint, setFocal, tidyFocal } from '../src/chem/focal';
import { sigFig } from '../src/chem/bench';
import { atomWarnings, StructureChecks } from '../src/chem/warnings';
import { greenRows, stoichiometryBook } from '../src/chem/stoichiometry';

const L = new Doc().style.bondLength;
const centre = (s: { x1: number; y1: number; x2: number; y2: number }) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

describe('Draw Next Intermediate keeps the lone pairs of unchanged atoms stuck to them (F051)', () => {
  it('a lone pair on an atom the arrows do not touch is still pinned, and moves with its atom', () => {
    const doc = new Doc();
    // hydroxide and 2-bromoethanol (an SN2 step at the CH2Br), whose OH no arrow touches
    const { o, c, br, w } = doc.edit('build', () => {
      const o = doc.addAtom(100, 100, 8, { charge: -1 }).id;
      const c = doc.addAtom(100 + 2 * L, 100, 6).id;
      const br = doc.addAtom(100 + 3 * L, 100, 35).id;
      doc.addBond(c, br, 1);
      const c2 = doc.addAtom(100 + 2 * L, 100 + L, 6).id;
      doc.addBond(c, c2, 1);
      const w = doc.addAtom(100 + 2.87 * L, 100 + 1.5 * L, 8).id;
      doc.addBond(c2, w, 1);
      return { o, c, br, w };
    });
    doc.edit('pair', () => {
      const a = doc.atoms.get(w)!;
      const sh = doc.addShape({ kind: 'symbol', symbol: 'LonePair', x1: a.x + 0.3 * L - 1.12, y1: a.y + 0.2 * L, x2: a.x + 0.3 * L + 1.12, y2: a.y + 0.2 * L });
      const pin = symbolPin(doc, sh);
      expect(pin).toBeDefined();
      doc.updateShape(sh.id, { pin });
    });
    const push = (from: PushEnd, to: PushEnd) => {
      const p = pushArrow(doc, plainMeasure(doc), from, to)!;
      doc.edit('arrow', () => doc.addArrow({ tail: p.tail, head: p.head, sweep: p.sweep, ...(p.bez ? { bez: p.bez } : {}), pin: pushPins(doc, p), headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 }));
    };
    push({ kind: 'atom', id: o }, { kind: 'atom', id: c });
    push({ kind: 'bond', id: doc.bondBetween(c, br)!.id }, { kind: 'atom', id: br });
    const reading = readPushes(doc, plainMeasure(doc), pushArrowsOf(doc, doc.arrows.keys()));
    const out = productDrawing(doc, reading)!;
    const onW = () => [...out.shapes.values()].filter((s) => s.symbol === 'LonePair' && Math.hypot(centre(s).x - out.atoms.get(w)!.x, centre(s).y - out.atoms.get(w)!.y) < 0.6 * L);
    expect(onW().length).toBe(1);
    const pair = onW()[0];
    expect(pair.pin?.ref[0]).toBe(w);
    // moving the O takes its pair with it (kept at its distance from the O; it turns with the O–C bond)
    const was = centre(pair), off = Math.hypot(was.x - out.atoms.get(w)!.x, was.y - out.atoms.get(w)!.y);
    out.edit('move', () => out.updateAtom(w, { x: out.atoms.get(w)!.x + 30 }));
    const now = centre(out.shapes.get(pair.id)!);
    expect(now.x - was.x).toBeGreaterThan(25);
    expect(Math.hypot(now.x - out.atoms.get(w)!.x, now.y - out.atoms.get(w)!.y)).toBeCloseTo(off, 3);
  });
});

describe('metal labels with ligands written before the metal (F045)', () => {
  /** An atom of atomic number z labelled `label`, with two Cl atoms bonded to it. */
  function pd(label: string, z = 46) {
    const doc = new Doc();
    const m = doc.edit('m', () => {
      const metal = doc.addAtom(0, 0, z, { label });
      for (const x of [-20, 20]) doc.addBond(metal.id, doc.addAtom(x, 0, 17).id, 1);
      return metal.id;
    });
    return countElectrons(doc, m).find((c) => c.metal === m);
  }
  // Covalent bond classification (Green, J. Organomet. Chem. 1995, 500, 127; Parkin's CBC page,
  // columbia.edu/cu/chemistry/groups/parkin/cbcm.html): an MLlXx complex has m + 2l + x
  // electrons, m the valence electrons of the neutral metal (10 for Pd, group 10), and valence
  // number x. PdCl2 drawn: two X, no L, so 10 + 2 = 12 electrons and Pd(II).
  it('counts LnPd, L2Pd and (L)nPd from their drawn bonds, as Pd', () => {
    for (const label of ['LnPd', 'L2Pd', '(L)nPd', 'LPd']) {
      const c = pd(label);
      expect(c, label).toBeDefined();
      expect(c!.symbol).toBe('Pd');
      expect([c!.x, c!.oxidation, c!.electrons]).toEqual([2, 2, 12]);
    }
  });
  it("a label it can't read is still counted from its bonds as the metal it starts with, and the note says so", () => {
    // (a typed label whose first part isn't an element leaves the atom's own number at carbon)
    for (const [label, z] of [['Pd-?', 46], ['Pd-?', 6], ['[Pd]', 6]] as const) {
      const c = pd(label, z);
      expect(c, label).toBeDefined();
      expect(c!.symbol, label).toBe('Pd');
      expect([c!.x, c!.oxidation, c!.electrons], label).toEqual([2, 2, 12]);
      expect(c!.notes.join(' ')).toMatch(/isn't read for its ligands/);
    }
  });
  it('a generic metal (M, [M], MLn) is left out, not counted as carbon', () => {
    for (const label of ['M', '[M]', 'MLn', 'LnM']) expect(pd(label, 6), label).toBeUndefined();
  });
});

/** A benzene ring at (x, y) with a chain of `tail` carbons from its bottom atom. */
function arene(doc: Doc, tail: number): { ring: number[]; chain: number[] } {
  const ring: number[] = [];
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k - Math.PI / 2; ring.push(doc.addAtom(L * Math.cos(a), L * Math.sin(a)).id); }
  for (let k = 0; k < 6; k++) doc.addBond(ring[k], ring[(k + 1) % 6], k % 2 ? 1 : 2);
  const chain: number[] = [];
  let prev = ring[3];
  for (let k = 0; k < tail; k++) { const p = doc.atoms.get(prev)!; const a = doc.addAtom(p.x + (k % 2 ? 12 : -12), p.y + 7.2).id; doc.addBond(prev, a); chain.push(a); prev = a; }
  return { ring, chain };
}

describe('deleting an atom of a focal bond or ring (F046)', () => {
  it('a bond: the other end lets go too, and it counts as one lost', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 2));
    doc.edit('focal', () => setFocal(doc, [s.chain[0], s.chain[1]]));
    let lost = 0;
    doc.beforeCommit = (before) => { lost += tidyFocal(doc, before); };
    doc.edit('Delete', () => doc.removeAtom(s.chain[1]));
    expect(lost).toBe(1);
    expect(focalKind(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
    expect(focalPoint(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
  });
  it('a three-membered ring: the two atoms left are not a bond focal point', () => {
    const doc = new Doc();
    const ring = doc.edit('build', () => {
      const ids = [doc.addAtom(0, 0).id, doc.addAtom(L, 0).id, doc.addAtom(L / 2, 0.87 * L).id];
      ids.forEach((id, k) => doc.addBond(id, ids[(k + 1) % 3]));
      doc.addBond(ids[0], doc.addAtom(-L, 0).id);
      return ids;
    });
    doc.edit('focal', () => setFocal(doc, ring));
    let lost = 0;
    doc.beforeCommit = (before) => { lost += tidyFocal(doc, before); };
    doc.edit('Delete', () => doc.removeAtom(ring[2]));
    expect(lost).toBe(1);
    expect(focalKind(doc, doc.fragmentOf(ring[0]))).toBeNull();
  });
  it('a six-membered ring counts as one lost, not two', () => {
    const doc = new Doc();
    const s = doc.edit('build', () => arene(doc, 1));
    doc.edit('focal', () => setFocal(doc, s.ring));
    let lost = 0;
    doc.beforeCommit = (before) => { lost += tidyFocal(doc, before); };
    doc.edit('Delete', () => doc.removeAtom(s.ring[1]));
    expect(lost).toBe(1);
    expect(focalKind(doc, doc.fragmentOf(s.ring[0]))).toBeNull();
  });
});

describe('significant figures that round up to a power of ten (F383)', () => {
  it('keeps the number of figures asked for', () => {
    expect(sigFig(9.996, 3)).toBe('10.0');
    expect(sigFig(99.96, 3)).toBe('100');
    expect(sigFig(0.09996, 3)).toBe('0.100');
    expect(sigFig(-9.996, 3)).toBe('-10.0');
    // (no carry: as before)
    expect(sigFig(9.994, 3)).toBe('9.99');
    expect(sigFig(39.55, 3)).toBe('39.6');
  });
});

describe('isotope and bond warnings (F424, F425, F426)', () => {
  // a mass number below the atomic number has fewer nucleons than protons: no such isotope
  it('an atom with a partial bond still gets the isotope warning', () => {
    const doc = new Doc();
    const a = doc.edit('build', () => {
      const a = doc.addAtom(0, 0, 6, { isotope: 1 });
      doc.addBond(a.id, doc.addAtom(L, 0, 6).id, PARTIAL);
      return a;
    });
    expect(atomWarnings(doc, doc.atoms.get(a.id)!).join(' ')).toMatch(/There is no isotope 1C/);
  });
  it('an unlabelled metal with a bad isotope keeps its stereo label warning', () => {
    const doc = new Doc();
    const a = doc.edit('build', () => doc.addAtom(0, 0, 46, { isotope: 10, stereoLabel: { text: '(S)', dx: 0, dy: 0, size: 8, fromFile: true } }));
    doc.stereo = { atom: () => 'R', bond: () => null, asFirst: () => true } as StereoInfo;
    const w = atomWarnings(doc, doc.atoms.get(a.id)!);
    expect(w.some((t) => /There is no isotope 10Pd/.test(t))).toBe(true);
    expect(w.some((t) => /stereo label says/.test(t))).toBe(true);
  });
  it('finds an atom sitting on a bond five bond lengths long', () => {
    const doc = new Doc();
    const lone = doc.edit('build', () => {
      doc.addBond(doc.addAtom(0, 0).id, doc.addAtom(5 * L, 0).id);
      return doc.addAtom(2.5 * L, 0, 8);
    });
    const ch = new StructureChecks(doc);
    ch.update();
    expect(ch.atoms.get(lone.id)?.join(' ') ?? '').toMatch(/sits on a bond/);
  });
});

describe('Stoichiometry Table (F419, F420)', () => {
  const book = () => stoichiometryBook([
    // (made-up round numbers, not real compounds: only the sheet's arithmetic is checked here)
    { role: 'Starting material', name: 'A', mw: 100 },
    { role: 'Reagent', name: 'B', mw: 50 },
    { role: 'Product', name: 'C', mw: 120 },
  ], 2);
  it('a concentration of 0 or text falls back to the volume from the density', () => {
    const wb = book();
    const sh = wb.sheets[0];
    // 2 mmol × 100 mg/mmol = 200 mg; at 1.25 g/mL (mg/µL) that is 160 µL (V = m/ρ)
    for (const conc of ['0', 'n/a', 'neat']) {
      wb.edit('conc', () => { sh.setInput(1, 8, '1.25'); sh.setInput(1, 9, conc); });
      expect(Number(sh.value(1, 10)), conc).toBeCloseTo(160, 6);
    }
    // (a concentration still gives the solution's volume: 2 mmol ÷ 0.5 M = 4 mL = 4000 µL)
    wb.edit('conc', () => { sh.setInput(1, 9, '0.5'); });
    expect(Number(sh.value(1, 10))).toBeCloseTo(4000, 6);
  });
  it('E-factor and PMI count a row typed just under the table, and the note says how', () => {
    const wb = book();
    const sh = wb.sheets[0];
    const g = greenRows(3);
    wb.edit('iso', () => { sh.setInput(g.isolated, 3, '200'); });
    const pmi0 = Number(sh.value(g.pmi, 3));
    // PMI = mass in ÷ product: (200 + 100) ÷ 200 (2 mmol of each at 1 equiv)
    expect(pmi0).toBeCloseTo(1.5, 6);
    // a solvent typed in the empty row under the table, with its mass
    wb.edit('THF', () => { sh.setInput(4, 0, 'Solvent'); sh.setInput(4, 1, 'THF'); sh.setInput(4, 6, '4445'); });
    expect(Number(sh.value(g.pmi, 3))).toBeCloseTo((300 + 4445) / 200, 6);
    expect(String(sh.value(g.note, 0))).toMatch(/Mass \(mg\)/);
    expect(String(sh.value(g.note, 0))).not.toMatch(/density and volume/);
  });
});
