// @vitest-environment jsdom
// Chemistry warnings and how labels are read: the formula a label gives (checked with the
// chemistry engine), and which drawings get a red box. The expected warnings follow what
// ChemDraw itself flagged in real drawings, except where noted.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc, Atom } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { formulaFromJson } from '../src/chem/formula';
import { labelGraph, isElementList } from '../src/chem/labels';
import { valenceOfBonds } from '../src/chem/elements';
import { StructureChecks, atomWarnings, isotopeOk } from '../src/chem/warnings';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const L = 14.4;

function formulaOf(doc: Doc): string {
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try { return formulaFromJson(m.get_json()).formula; } finally { m.delete(); }
}

/** CH3 bonded to an atom with this label. */
function methylWith(label: string): Doc {
  const d = new Doc();
  d.bulk(() => {
    const c = d.addAtom(0, 0);
    const x = d.addAtom(L, 0, 6, { label });
    d.addBond(c.id, x.id);
  });
  return d;
}

/** One unbonded atom with this label (reagents written as text). */
function alone(label: string): Doc {
  const d = new Doc();
  d.bulk(() => { d.addAtom(0, 0, 6, { label }); });
  return d;
}

describe('reading labels', () => {
  it('gives the right formula for condensed formulas', () => {
    const cases: [string, string][] = [
      ['B(OH)2', 'CH5BO2'], // methylboronic acid
      ['CONH2', 'C2H5NO'], // acetamide: C(=O)NH2, not C–O–N
      ['SO3H', 'CH4O3S'], // methanesulfonic acid
      ['SO2Cl', 'CH3ClO2S'],
      ['CO2Me', 'C3H6O2'],
      ['(CH2)3OH', 'C4H10O'], // butanol: a chain of three CH2
      ['CH(CH3)2', 'C4H10'], // isobutane: two methyls on one carbon
      ['C2H5', 'C3H8'],
      ['NHBoc', 'C6H13NO2'],
      ['NH3+', 'CH6N+'],
      ['N(CH2CH3)2', 'C5H13N'],
      ['PO(OEt)2', 'C5H13O3P'],
    ];
    for (const [label, want] of cases) expect([label, formulaOf(methylWith(label))]).toEqual([label, want]);
  });
  it('reads labels written backwards, as on the left of a structure', () => {
    const cases: [string, string][] = [
      ['MeO', 'C2H6O'], // dimethyl ether, bonded through O
      ['O2N', 'CH3NO2'], // nitromethane
      ['F3C', 'C2H3F3'],
      ['BocHN', 'C6H13NO2'],
      ['HO2C', 'C2H4O2'], // acetic acid
      ['(HO)2B', 'CH5BO2'],
    ];
    for (const [label, want] of cases) expect([label, formulaOf(methylWith(label))]).toEqual([label, want]);
    expect(labelGraph('MeO')!.atoms[0].z).toBe(8);
  });
  it('reads salts and anions written as one label', () => {
    expect(formulaOf(alone('NaBH4'))).toBe('BH4Na');
    expect(formulaOf(alone('KOtBu'))).toBe('C4H9KO');
    expect(formulaOf(alone('PhSO3-'))).toBe('C6H5O3S−');
  });
  it('treats R groups and element lists as "any group"', () => {
    expect(labelGraph('NR2')!.atoms.filter((a) => a.dummy).length).toBe(2); // N(R)2, not N–R2
    expect(isElementList('[Cl, Br, I]')).toBe(true);
    expect(isElementList('[Rh]')).toBe(true);
    expect(isElementList('[Rh]*')).toBe(false);
    expect(labelGraph('[Cl, Br, I]')!.atoms[0].dummy).toBe(true);
  });
  it('counts aromatic bonds as a chemist would', () => {
    // benzene carbon with a substituent: 4; N-methylpyrrole N: 3 (its lone pair is in the ring)
    expect(valenceOfBonds([1.5, 1.5, 1], 6)).toBe(4);
    expect(valenceOfBonds([1.5, 1.5, 1], 7)).toBe(3);
    expect(valenceOfBonds([1.5, 1.5, 1.5], 6)).toBe(4); // ring fusion
  });
});

/** Atoms in a row with bonds between neighbours; returns the doc and the atoms. */
function build(fn: (d: Doc) => void): Doc {
  const d = new Doc();
  d.bulk(() => fn(d));
  return d;
}

/** An atom with `n` single bonds to plain carbons. */
function star(z: number, n: number, extra: Partial<Atom> = {}): { d: Doc; c: Atom } {
  let c!: Atom;
  const d = build((d) => {
    c = d.addAtom(0, 0, z, extra);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI;
      d.addBond(c.id, d.addAtom(L * Math.cos(t), L * Math.sin(t)).id);
    }
  });
  return { d, c };
}

describe('warnings', () => {
  it('flags too many bonds, allowing for charge', () => {
    const c5 = star(6, 5);
    expect(atomWarnings(c5.d, c5.c)[0]).toBe('C has 5 bonds (max 4)');
    expect(atomWarnings(star(6, 4).d, star(6, 4).c)).toEqual([]);
    const n4 = star(7, 4);
    expect(atomWarnings(n4.d, n4.c)[0]).toBe('N has 4 bonds (max 3; N⁺ allows 4)');
    const n4plus = star(7, 4, { charge: 1 });
    expect(atomWarnings(n4plus.d, n4plus.c)).toEqual([]);
  });
  it('words valence with the charge, and says which charge would allow the bonds', () => {
    const o3 = star(8, 3);
    expect(atomWarnings(o3.d, o3.c)[0]).toBe('O has 3 bonds (max 2; O⁺ allows 3)');
    const o3plus = star(8, 3, { charge: 1 });
    expect(atomWarnings(o3plus.d, o3plus.c)).toEqual([]);
    const b4 = star(5, 4);
    expect(atomWarnings(b4.d, b4.c)[0]).toBe('B has 4 bonds (max 3; B⁻ allows 4)');
    const om2 = star(8, 2, { charge: -1 });
    expect(atomWarnings(om2.d, om2.c)[0]).toBe('O⁻ has 2 bonds (max 1; O allows 2)');
    // no charge hint where hypervalence, not charge, is the question
    const s7 = star(16, 7);
    expect(atomWarnings(s7.d, s7.c)[0]).toBe('S has 7 bonds (max 6)');
  });
  it('flags labels that cannot be read, or whose atoms have too many or too few bonds', () => {
    expect(atomWarnings(methylWith('Aryl'), methylWith('Aryl').atoms.get(2)!)[0]).toMatch(/can't be read/);
    for (const ok of ['R', 'EWG', 'Ar1', '[Cl, Br, I]', 'NR2', 'CO2Et', 'B(OH)2', 'MeO']) {
      const d = methylWith(ok);
      expect([ok, atomWarnings(d, d.atoms.get(2)!)]).toEqual([ok, []]);
    }
    const br = methylWith('CH(CH3');
    expect(atomWarnings(br, br.atoms.get(2)!)[0]).toMatch(/brackets/);
    // NH2 with two bonds: N would have 4
    const nh2 = star(6, 2, { label: 'NH2' });
    expect(atomWarnings(nh2.d, nh2.c)[0]).toBe('N in “NH2” has 4 bonds (max 3; N⁺ allows 4)');
    // Ph with two bonds
    const ph = star(6, 2, { label: 'Ph' });
    expect(atomWarnings(ph.d, ph.c)[0]).toMatch(/^C in “Ph” has \d+ bonds \(max 4\)$/);
    // a "P" label fixes the hydrogens at none, so one bond is too few (ChemDraw flags this too)
    const p = methylWith('P');
    expect(atomWarnings(p, p.atoms.get(2)!)[0]).toBe('P in “P” has 1 bond (min 3)');
    expect(atomWarnings(alone('C'), alone('C').atoms.get(1)!)[0]).toMatch(/\(min 4\)$/);
    // a carbene label with its radical is fine
    const bh = build((d) => { d.addAtom(0, 0, 6, { label: 'BH', radical: 'singlet' }); });
    expect(atomWarnings(bh, bh.atoms.get(1)!)).toEqual([]);
  });
  it('checks isotopes', () => {
    expect(isotopeOk(6, 13)).toBe(true);
    expect(isotopeOk(1, 2)).toBe(true);
    expect(isotopeOk(6, 3)).toBe(false);
    expect(isotopeOk(6, 130)).toBe(false);
    const d = build((d) => { d.addAtom(0, 0, 6, { isotope: 3 }); });
    expect(atomWarnings(d, d.atoms.get(1)!)[0]).toMatch(/no isotope 3C/);
  });
  it('finds atoms on top of each other and clears the warning when they are moved apart', () => {
    let a!: Atom, b!: Atom;
    const d = build((d) => {
      a = d.addAtom(0, 0);
      b = d.addAtom(1, 0);
      d.addBond(a.id, d.addAtom(-L, 0).id);
      d.addBond(b.id, d.addAtom(L + 1, 0).id);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.atoms.get(a.id)![0]).toMatch(/on top of another/);
    expect(ch.atoms.get(b.id)![0]).toMatch(/on top of another/);
    // moving b away must clear a's warning too, though a itself did not change
    d.edit('move', () => d.updateAtom(b.id, { x: 0, y: L }));
    expect(ch.update()).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ch.atoms.has(a.id)).toBe(false);
    expect(ch.atoms.has(b.id)).toBe(false);
  });
  it('finds an atom sitting on a bond, and notices when the bond moves away', () => {
    let lone!: Atom, p!: Atom;
    const d = build((d) => {
      p = d.addAtom(-L / 2, 0);
      d.addBond(p.id, d.addAtom(L / 2, 0).id);
      lone = d.addAtom(0, 0.5, 8);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.atoms.get(lone.id)![0]).toMatch(/sits on a bond/);
    d.edit('move', () => d.updateAtom(p.id, { y: L }));
    ch.update();
    expect(ch.atoms.has(lone.id)).toBe(false);
    // and a bond moved onto an atom that did not change
    d.edit('move back', () => d.updateAtom(p.id, { y: 0 }));
    ch.update();
    expect(ch.atoms.get(lone.id)![0]).toMatch(/sits on a bond/);
  });
  it('flags a lone single bond (ChemDraw: "probably not intended")', () => {
    let a!: Atom, b!: Atom;
    const d = build((d) => { a = d.addAtom(0, 0); b = d.addAtom(L, 0); d.addBond(a.id, b.id, 1, 'hash'); });
    const ch = new StructureChecks(d);
    ch.update();
    expect([...ch.bonds.values()][0][0]).toMatch(/single bond on its own/);
    d.edit('grow', () => { d.addBond(b.id, d.addAtom(2 * L, L / 2).id); });
    ch.update();
    expect(ch.bonds.size).toBe(0);
  });
  it('leaves out warnings the person chose to ignore', () => {
    const { d, c } = star(6, 5);
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.list().length).toBe(1);
    d.edit('ignore', () => d.updateAtom(c.id, { ignoreWarnings: true }));
    ch.update();
    expect(ch.forAtom(d.atoms.get(c.id)!)).toBeUndefined();
    expect(ch.list().length).toBe(0);
    expect(ch.ignoredCount()).toBe(1);
  });
  it('counts a point of attachment as a bond', () => {
    // N in a ring, bonded to a wavy attachment point: three bonds, no H, nothing wrong
    const d = build((d) => {
      const n = d.addAtom(0, 0, 7);
      d.addBond(n.id, d.addAtom(-L, 0).id);
      d.addBond(n.id, d.addAtom(L, 0).id);
      d.addBond(n.id, d.addAtom(0, L, 0, { attach: 'Wavy' }).id);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.list()).toEqual([]);
  });
});

describe('no false valence warnings on common labels', () => {
  // Nate (2026-11-16): HO, OH and MeO on a pyranose all got red boxes ("the O in OH has 3").
  /** A ring carbon (with two ring neighbours) carrying this label by a bond drawn this way. */
  function onRing(label: string, display: 'solid' | 'hash' | 'bold' | 'wedge' | 'hashWedge'): { d: Doc; x: Atom } {
    const d = new Doc();
    let x!: Atom;
    d.bulk(() => {
      const c = d.addAtom(0, 0);
      d.addBond(c.id, d.addAtom(-L, 0).id);
      d.addBond(c.id, d.addAtom(L / 2, L).id);
      x = d.addAtom(L / 2, -L, 6, { label });
      d.addBond(c.id, x.id, 1, display);
    });
    return { d, x };
  }
  it('reads OH, HO, MeO, OMe and Me either way round, on any bond', () => {
    for (const label of ['OH', 'HO', 'MeO', 'OMe', 'Me', 'OBn', 'BnO', 'OAc', 'AcO', 'OTBS', 'TBSO']) {
      for (const display of ['solid', 'hash', 'bold', 'wedge', 'hashWedge'] as const) {
        const { d, x } = onRing(label, display);
        expect([label, display, atomWarnings(d, x)]).toEqual([label, display, []]);
      }
    }
  });
  it('still flags a label with a second bond to the structure', () => {
    for (const [label, text] of [['OH', 'O in “OH” has 3 bonds (max 2; O⁺ allows 3)'], ['HO', 'O in “HO” has 3 bonds (max 2; O⁺ allows 3)'], ['MeO', 'O in “MeO” has 3 bonds (max 2; O⁺ allows 3)'], ['OMe', 'O in “OMe” has 3 bonds (max 2; O⁺ allows 3)']]) {
      const s = star(6, 2, { label });
      expect(atomWarnings(s.d, s.c)).toEqual([text]);
    }
  });
  it('reads a numbered R group as one group, not a count (OR⁵, CO₂R², SO₂R³)', () => {
    for (const ok of ['OR5', 'OR2', 'CO2R2', 'SO2R3', 'NHSO2R3', 'OR1', 'NR2', 'SiR3', 'PR3']) {
      const d = methylWith(ok);
      expect([ok, atomWarnings(d, d.atoms.get(2)!)]).toEqual([ok, []]);
    }
    // NR3 on a carbon is an ammonium N: the count is still read as three R groups
    const nr3 = methylWith('NR3');
    expect(atomWarnings(nr3, nr3.atoms.get(2)!)).toEqual(['N in “NR3” has 4 bonds (max 3; N⁺ allows 4)']);
  });
  it('knows the Mosher acyl group (OMTPA)', () => {
    const d = methylWith('OMTPA');
    expect(atomWarnings(d, d.atoms.get(2)!)).toEqual([]);
    expect(formulaOf(d)).toBe('C11H11F3O3');
  });
  // Nate's 2026-11-16 file: a pyranose whose ring and OH/OMe bonds were all Order="1.5" in the
  // CDXML (ChemDraw draws them as plain lines). The O labels were counted with an aromatic bond
  // (2) to the ring, and the structure had no formula.
  function oneAndHalfPyranose(): { d: Doc; labels: Atom[] } {
    const d = new Doc();
    const labels: Atom[] = [];
    d.bulk(() => {
      // ring: C1 (anomeric), C2, C3, C4, C5, O5
      const pts = [0, 1, 2, 3, 4, 5].map((i) => ({ x: L * Math.cos((i * Math.PI) / 3), y: L * Math.sin((i * Math.PI) / 3) }));
      const ring = pts.map((p, i) => d.addAtom(p.x, p.y, i === 5 ? 8 : 6).id);
      for (let i = 0; i < 6; i++) d.addBond(ring[i], ring[(i + 1) % 6], 1.5);
      const out = (i: number, label: string | null, z: number, display: 'wedge' | 'hashWedge') => {
        const a = d.addAtom(2 * pts[i].x, 2 * pts[i].y, z, label ? { label } : {});
        if (label) labels.push(a);
        d.addBond(ring[i], a.id, 1.5, display);
      };
      out(0, 'OMe', 8, 'wedge');
      out(1, 'MeO', 8, 'hashWedge');
      out(2, 'HO', 8, 'hashWedge');
      out(3, 'OH', 8, 'hashWedge');
      out(4, null, 6, 'hashWedge');
    });
    return { d, labels };
  }
  it('reads 1½ bonds that cannot be aromatic as single (no warnings, and a formula)', () => {
    const { d, labels } = oneAndHalfPyranose();
    expect(labels.length).toBe(4);
    for (const a of d.atoms.values()) expect([a.label, atomWarnings(d, a)]).toEqual([a.label, []]);
    expect(formulaOf(d)).toBe('C8H16O5');
    // the wedges still give each stereocentre
    const m = RDKit.get_mol(toMolfile(d, d.atoms.keys()).molblock);
    try { expect((m.get_smiles().match(/@/g) ?? []).length).toBeGreaterThanOrEqual(5); } finally { m.delete(); }
  });
  it('keeps real aromatic 1½ bonds aromatic', () => {
    const ring = (d: Doc, cx: number, zs: number[]) => {
      const ids = zs.map((z, i) => d.addAtom(cx + L * Math.cos((i * Math.PI) / 3), L * Math.sin((i * Math.PI) / 3), z).id);
      for (let i = 0; i < ids.length; i++) d.addBond(ids[i], ids[(i + 1) % ids.length], 1.5);
      return ids;
    };
    // biphenyl drawn all in 1½ bonds: the bond between the rings is single, the rings aromatic
    const bi = build((d) => { const a = ring(d, 0, [6, 6, 6, 6, 6, 6]); const b = ring(d, 3 * L, [6, 6, 6, 6, 6, 6]); d.addBond(a[0], b[3], 1.5); });
    expect(formulaOf(bi)).toBe('C12H10');
    for (const a of bi.atoms.values()) expect(atomWarnings(bi, a)).toEqual([]);
    // pyridine
    expect(formulaOf(build((d) => { ring(d, 0, [7, 6, 6, 6, 6, 6]); }))).toBe('C5H5N');
  });
  it('keeps the tooltip short', () => {
    const c5 = star(6, 5);
    expect(atomWarnings(c5.d, c5.c)[0].length).toBeLessThan(40);
  });
});

describe('saving warning settings', () => {
  it('keeps ignored warnings, radicals and attachment points in CDXML', () => {
    const d = build((d) => {
      const c = d.addAtom(100, 100, 6, { ignoreWarnings: true });
      for (let i = 0; i < 5; i++) d.addBond(c.id, d.addAtom(100 + L * Math.cos(i), 100 + L * Math.sin(i)).id);
      const r = d.addAtom(200, 100, 6, { radical: 'doublet' });
      const n = d.addAtom(300, 100, 7);
      d.addBond(r.id, n.id);
      d.addBond(n.id, d.addAtom(300, 100 + L, 0, { attach: 'Wavy' }).id);
    });
    const xml = writeCdxml(d);
    expect(xml).toContain('IgnoreWarnings="yes"');
    expect(xml).toContain('Radical="Doublet"');
    expect(xml).toMatch(/NodeType="ExternalConnectionPoint"[^>]*ExternalConnectionType="Wavy"/);
    const back = readCdxml(xml).doc;
    const atoms = [...back.atoms.values()];
    expect(atoms.filter((a) => a.ignoreWarnings).length).toBe(1);
    expect(atoms.filter((a) => a.radical === 'doublet').length).toBe(1);
    expect(atoms.filter((a) => a.attach === 'Wavy').length).toBe(1);
  });
});
