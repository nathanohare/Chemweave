// @vitest-environment jsdom
//
// The Side Panel's Electron Count: the book's worked examples counted both ways, the count
// expected (18, or 16 for a square-planar d⁸ metal), ligand types, oxidation state, charge and
// expected count set by hand (kept on the metal, through CDXML, one undo step each), and the rows
// Insert as Table copies.
//
// Every expected count in "the book's worked examples" and "the count expected" is from Miessler,
// Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014), chapters 10 and 13, cited case by
// case ("MFT" and the page); none comes from running the code under test. The tests of values set
// by hand (ligand types, oxidation states, charges and counts chosen in the panel), of the ranges
// kept, and of where Insert as Table puts the table are plumbing: the settings are invented, and
// the numbers expected are the counting formulas' arithmetic on them (written out in comments),
// not chemistry from a source.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { sanitizeEcount } from '../src/chem/ecount-settings';
import { soundContents } from '../src/io/clip-check';
import { spotBeside } from '../src/editor/arrange';
import { Editor } from '../src/editor/editor';
import { Renderer } from '../src/render/renderer';
import { plainMeasure } from '../src/chem/reaction';
import { countElectrons, countRows, electronPrefs, countSummary, expectedCount, parseType, selectedComplex, typeCode, type MetalCount } from '../src/chem/electrons';
import { bondHapto } from '../src/chem/hapto';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml, readEcount } from '../src/io/cdxml';
import { StylePanel } from '../src/ui/style-panel';
import type { Selection } from '../src/editor/editor';

/** A ligand: a label (PPh3, CO, Cl), an atom of atomic number z with no label, or a hapto ring or chain of n carbons. */
type Lig = string | { z: number } | { ring: number } | { chain: number };

/** A metal of atomic number z with its ligands (and a charge drawn on the metal); returns the doc and the metal's id. */
function complex(z: number, ligs: Lig[], charge = 0): { doc: Doc; m: number } {
  const doc = new Doc();
  const m = doc.edit('m', () => {
    const metal = doc.addAtom(0, 0, z, { charge });
    ligs.forEach((l, i) => {
      const ang = (i / ligs.length) * 2 * Math.PI, x = 30 * Math.cos(ang), y = 30 * Math.sin(ang);
      if (typeof l === 'string') doc.addBond(metal.id, doc.addAtom(x, y, 6, { label: l }).id);
      else if ('z' in l) doc.addBond(metal.id, doc.addAtom(x, y, l.z).id);
      else {
        const n = 'ring' in l ? l.ring : l.chain;
        const ids = Array.from({ length: n }, (_, k) => doc.addAtom(x + 14 * Math.cos((2 * Math.PI * k) / n), y + 14 * Math.sin((2 * Math.PI * k) / n)).id);
        ids.forEach((id, k) => { if ('ring' in l || k < n - 1) doc.addBond(id, ids[(k + 1) % n], 1.5); });
        bondHapto(doc, metal.id, ids);
      }
    });
    return metal.id;
  });
  return { doc, m };
}

const one = (doc: Doc, m: number): MetalCount => countElectrons(doc, m)[0];
const CO = (n: number) => Array<string>(n).fill('CO');

describe('the book\'s worked examples', () => {
  it('Cr(CO)6: 18 electrons (MFT Example 13.1, p. 480)', () => {
    const { doc, m } = complex(24, CO(6));
    const c = one(doc, m);
    expect([c.oxidation, c.electrons, c.ionicTotal]).toEqual([0, 18, 18]);
    expect(c.expected).toMatchObject({ value: 18, set: false });
  });

  it('(η5-C5H5)Fe(CO)2Cl: Fe(II), 18 electrons; Cp 6 and Cl 2 by Method A, 5 and 1 by Method B (MFT Example 13.1, pp. 480–481)', () => {
    const { doc, m } = complex(26, [{ ring: 5 }, 'CO', 'CO', 'Cl']);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons, c.ionicTotal]).toEqual([2, 6, 18, 18]);
    // Method B starts from the iron atom's 8 electrons, Method A from Fe(II)'s 6
    expect(c.group).toBe(8);
    const cp = c.ligands.find((r) => r.hapto === 5)!, cl = c.ligands.find((r) => r.name === 'Cl')!;
    expect([cp.ionic, cp.neutral, cl.ionic, cl.neutral]).toEqual([6, 5, 2, 1]);
  });

  it('[(η5-C5H5)Fe(CO)2]−: 18 electrons (MFT p. 481; Table 13.9, p. 523)', () => {
    const { doc, m } = complex(26, ['Cp', 'CO', 'CO'], -1);
    expect(one(doc, m).electrons).toBe(18);
  });

  it('[Mn(CO)6]+: 18 electrons (MFT p. 481)', () => {
    const { doc, m } = complex(25, CO(6), 1);
    expect([one(doc, m).oxidation, one(doc, m).electrons]).toEqual([1, 18]);
  });

  it('ClMn(CO)5: Mn(I), 18 electrons both ways (MFT Example 13.2, p. 482)', () => {
    const { doc, m } = complex(25, ['Cl', ...CO(5)]);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons, c.ionicTotal]).toEqual([1, 6, 18, 18]);
  });

  it('ferrocene, (η5-C5H5)2Fe: Fe(II), 18 electrons (MFT Example 13.2, p. 482)', () => {
    const { doc, m } = complex(26, [{ ring: 5 }, { ring: 5 }]);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons]).toEqual([2, 6, 18]);
  });

  it('[Re(CO)5(PF3)]+: Re(I), 18 electrons (MFT Example 13.2, p. 482)', () => {
    const { doc, m } = complex(75, [...CO(5), 'PF3'], 1);
    const c = one(doc, m);
    expect([c.oxidation, c.electrons, c.ionicTotal]).toEqual([1, 18, 18]);
  });

  it('[Ti(CO)6]2−: Ti(−II), 6 d electrons, 18 electrons (MFT Example 13.2, p. 483)', () => {
    const { doc, m } = complex(22, CO(6), -2);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons, c.ionicTotal]).toEqual([-2, 6, 18, 18]);
  });

  it('(η3-C3H5)Mn(CO)4: 18 electrons; η3-allyl 4 by Method A, 3 by Method B (MFT p. 502; Table 13.1, p. 482)', () => {
    const { doc, m } = complex(25, [{ chain: 3 }, ...CO(4)]);
    const c = one(doc, m);
    expect(c.electrons).toBe(18);
    const allyl = c.ligands.find((r) => r.hapto === 3)!;
    expect([allyl.ionic, allyl.neutral]).toEqual([4, 3]);
  });

  it('a hydride, HMn(CO)5: 18 electrons; H 2 by Method A, 1 by Method B (MFT Exercise 13.2b, p. 483, names HM(CO)5 an 18-electron species; Table 13.1, p. 482)', () => {
    const { doc, m } = complex(25, [{ z: 1 }, ...CO(5)]);
    const c = one(doc, m);
    expect(c.electrons).toBe(18);
    const h = c.ligands.find((r) => r.name === 'H')!;
    expect([h.ionic, h.neutral]).toEqual([2, 1]);
  });

  it('Fe(CO)2(PMe3)2(CH3)Br: ML4X2, 18 electrons (MFT Table 13.9, p. 523)', () => {
    const { doc, m } = complex(26, ['CO', 'CO', 'PMe3', 'PMe3', 'CH3', 'Br']);
    const c = one(doc, m);
    expect([c.classification, c.electrons]).toEqual(['ML₄X₂', 18]);
  });

  it('ferricinium, [Fe(η5-C5H5)2]+: 17 electrons, one short of the 18 expected (MFT Table 13.9, p. 523)', () => {
    const { doc, m } = complex(26, [{ ring: 5 }, { ring: 5 }], 1);
    const c = one(doc, m);
    expect([c.electrons, c.expected.value]).toEqual([17, 18]);
  });

  it('V(CO)6: 17 electrons (MFT p. 491)', () => {
    const { doc, m } = complex(23, CO(6));
    expect(one(doc, m).electrons).toBe(17);
  });

  it('Wilkinson\'s RhCl(PPh3)3, Vaska\'s IrCl(CO)(PPh3)2 and [Ni(CN)4]2−: d8, 16 electrons, 16 expected for square planar (MFT Figure 13.10 and Exercise 13.3, p. 485; section 13.3.3, pp. 485–486)', () => {
    for (const [z, ligs, q] of [[45, ['PPh3', 'PPh3', 'PPh3', 'Cl'], 0], [77, ['Cl', 'CO', 'PPh3', 'PPh3'], 0], [28, ['CN', 'CN', 'CN', 'CN'], -2]] as [number, string[], number][]) {
      const { doc, m } = complex(z, ligs, q);
      const c = one(doc, m);
      expect([c.dn, c.electrons, c.expected.value], `${z}`).toEqual([8, 16, 16]);
      expect(c.expected.reason).toBe('usual for square planar d⁸');
    }
  });

  it('Mn2(CO)10: 18 electrons on each Mn, with one for the Mn–Mn bond (MFT p. 481)', () => {
    const doc = new Doc();
    const [a, b] = doc.edit('mm', () => {
      const a = doc.addAtom(0, 0, 25), b = doc.addAtom(30, 0, 25);
      doc.addBond(a.id, b.id);
      for (const x of [a, b]) for (let k = 0; k < 5; k++) doc.addBond(x.id, doc.addAtom(x.x, 15 + 5 * k, 6, { label: 'CO' }).id);
      return [a.id, b.id];
    });
    for (const c of countElectrons(doc, a)) expect(c.electrons).toBe(18);
    // the Side Panel counts one metal: with both selected nothing, with one Mn on its own that one
    expect(selectedComplex(doc, doc.fragmentOf(a))).toBeNull();
    expect(selectedComplex(doc, [b])?.metal).toBe(b);
  });
});

describe('the count expected', () => {
  it('is 16 for square-planar d8 gold(III), [AuCl4]−, as for Pt(II) and Pd(II)', () => {
    // MFT section 10.6, p. 396: "The d⁸ ions Au(III), Pt(II), Pd(II), Rh(I), and Ir(I) often form
    // square-planar" complexes; four ligands on a d⁸ ion: 8 + 4 × 2 = 16 by the donor-pair method
    // (MFT section 13.3.1, p. 480), the sixteen-electron count of section 13.3.3, pp. 485–486
    const { doc, m } = complex(79, ['Cl', 'Cl', 'Cl', 'Cl'], -1);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons, c.expected.value]).toEqual([3, 8, 16, 16]);
    expect(c.expected.reason).toBe('usual for square planar d⁸');
  });

  it('is 18 unless a d8 metal of group 9 or 10 has four ligand sites', () => {
    // (Pd(PPh3)4 is d¹⁰ and Fe(CO)5 d⁸ with five ligands: both 18, MFT pp. 485 and 523)
    expect(expectedCount({ group: 10, dn: 10, l: 4, x: 0, z: 0 }).value).toBe(18);
    expect(expectedCount({ group: 8, dn: 8, l: 5, x: 0, z: 0 }).value).toBe(18);
    expect(expectedCount({ group: 10, dn: 8, l: 2, x: 2, z: 0 }).value).toBe(16);
  });
});

describe('values set by hand', () => {
  const wilkinson = () => complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);

  it('reads and writes type codes', () => {
    expect([typeCode(1, 0, 0), typeCode(2, 1, 0), typeCode(0, 0, 1), typeCode(0, 0, 0, 1)]).toEqual(['L', 'L2X', 'Z', 'M–M']);
    expect(parseType('L2X')).toEqual({ l: 2, x: 1, z: 0 });
    expect(parseType('Q')).toBeNull();
  });

  it('a ligand type, oxidation state, charge and expected count each replace the automatic one', () => {
    const { doc, m } = wilkinson();
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { 'Cl|X': 'L' } } }));
    let c = one(doc, m);
    // Cl as an L ligand: RhL₄, Rh(0), 9 + 8 = 17 by the neutral count
    expect([c.classification, c.oxidation, c.electrons]).toEqual(['ML₄', 0, 17]);
    expect(c.ligands.find((r) => r.name === 'Cl')).toMatchObject({ type: 'L', auto: 'X' });
    doc.edit('set', () => doc.updateAtom(m, { ecount: { ox: 3, charge: 0, expect: 14 } }));
    c = one(doc, m);
    expect([c.oxidation, c.autoOxidation, c.dn, c.electrons, c.ionicTotal]).toEqual([3, 1, 6, 16, 14]);
    expect(c.expected).toEqual({ value: 14, auto: 18, reason: 'set by hand', set: true });
    doc.edit('set', () => doc.updateAtom(m, { ecount: { charge: 1 } }));
    c = one(doc, m);
    expect([c.charge, c.autoCharge, c.oxidation, c.electrons]).toEqual([1, 0, 2, 15]);
  });

  it('are kept through CDXML; a broken or stale value falls back to automatic', () => {
    const { doc, m } = wilkinson();
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { 'PPh3|L': 'X', 'Gone|L': 'X' }, expect: 16 } }));
    const back = readCdxml(writeCdxml(doc)).doc;
    const metal = [...back.atoms.values()].find((a) => a.z === 45)!;
    expect(metal.ecount).toEqual({ types: { 'PPh3|L': 'X', 'Gone|L': 'X' }, expect: 16 });
    // (a ligand that isn't there any more is simply not used)
    expect(one(back, metal.id).classification).toBe('MX₄');
    expect(readEcount('not json')).toBeNull();
    expect(readEcount('{"types":{"Cl":"bad!"},"ox":1.5}')).toBeNull();
    expect(readEcount('{"types":{"Cl|X":"L"},"ox":2}')).toEqual({ types: { 'Cl|X': 'L' }, ox: 2 });
  });

  it('Insert as Table copies the rows: ligands, total, oxidation state, charge and the summary', () => {
    const { doc, m } = wilkinson();
    const rows = countRows(one(doc, m));
    expect(rows[0]).toEqual(['Ligand', 'Type', 'Neutral', 'Ionic']);
    expect(rows[1]).toEqual(['Rh', 'metal', '9', 'd⁸: 8']);
    expect(rows).toContainEqual(['PPh₃ ×3', 'L', '6', '6']);
    expect(rows).toContainEqual(['Cl', 'X', '1', '2']);
    expect(rows).toContainEqual(['Total', '', '16', '16']);
    expect(rows[rows.length - 1]).toEqual(['Rh(I), d⁸, 16 electrons · ML₃X']);
    expect(countSummary(one(doc, m))).toBe('Rh(I), d⁸, 16 electrons · ML₃X');
  });
});

describe('the Side Panel section', () => {
  const sel = (atoms: Iterable<number>): Selection => ({ atoms: new Set(atoms), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }) as Selection;
  function panel(doc: Doc, atoms: Iterable<number>) {
    const section = document.createElement('section'), body = document.createElement('div');
    section.append(Object.assign(document.createElement('h2'), { textContent: 'Style' }));
    const ids = [...atoms];
    const p = new StylePanel(section, body, doc, () => sel(ids), () => p.refresh());
    p.refresh(true);
    return { p, body };
  }

  it('shows the count, the status, a type per ligand and the rows; a type change is one undo step', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    const { p, body } = panel(doc, doc.fragmentOf(m));
    expect(body.querySelector('h3')?.textContent).toContain('Electron Count');
    expect(body.querySelector('.ec-sum')?.textContent).toBe('Rh(I), d⁸, 16 electrons · ML₃X');
    expect(body.querySelector('.ec-status')?.textContent).toBe('16 of 16 expected: usual for square planar d⁸');
    const labels = [...body.querySelectorAll('.style-row > span')].map((s) => s.firstChild?.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Oxidation State', 'Charge', 'Expected Count']));
    const types = [...body.querySelectorAll<HTMLSelectElement>('.ec-panel-table select')];
    expect(types.map((s) => s.value)).toEqual(['L', 'X']);
    // Cl made an L: one undo step, and undo puts it back
    types[1].value = 'L';
    types[1].dispatchEvent(new Event('change'));
    expect(doc.atoms.get(m)!.ecount).toEqual({ types: { 'Cl|X': 'L' } });
    expect(doc.undoLabel).toBe('Ligand Type');
    p.refresh();
    expect(body.querySelector('.ec-sum')?.textContent).toBe('Rh(0), d⁹, 17 electrons · ML₄');
    // Reset Types: one step
    const reset = [...body.querySelectorAll('button')].find((b) => b.textContent === 'Reset Types')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(doc.atoms.get(m)!.ecount).toBeUndefined();
    doc.undo();
    expect(doc.atoms.get(m)!.ecount).toEqual({ types: { 'Cl|X': 'L' } });
    doc.undo();
    expect(doc.atoms.get(m)!.ecount).toBeUndefined();
  });

  it('the oxidation state, charge and expected count are each one undo step, and Auto goes back', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    const { p, body } = panel(doc, doc.fragmentOf(m));
    const row = (name: string) => [...body.querySelectorAll('.style-row')].find((r) => r.firstElementChild?.firstChild?.textContent === name)!;
    const ox = row('Oxidation State').querySelector('select')!;
    expect(ox.options[ox.selectedIndex].textContent).toBe('Auto (+1)');
    ox.value = '3';
    ox.dispatchEvent(new Event('change'));
    expect(doc.atoms.get(m)!.ecount).toEqual({ ox: 3 });
    p.refresh();
    const q = row('Charge').querySelector('input')!;
    q.value = '-1';
    q.dispatchEvent(new Event('change'));
    expect(doc.atoms.get(m)!.ecount).toEqual({ ox: 3, charge: -1 });
    p.refresh();
    const exp = row('Expected Count').querySelector('select')!;
    expect(exp.options[0].textContent).toBe('Auto (18)');
    exp.value = '16';
    exp.dispatchEvent(new Event('change'));
    expect(doc.atoms.get(m)!.ecount).toEqual({ ox: 3, charge: -1, expect: 16 });
    p.refresh();
    const ox2 = row('Oxidation State').querySelector('select')!;
    ox2.value = 'auto';
    ox2.dispatchEvent(new Event('change'));
    expect(doc.atoms.get(m)!.ecount).toEqual({ charge: -1, expect: 16 });
    for (let k = 0; k < 4; k++) doc.undo();
    expect(doc.atoms.get(m)!.ecount).toBeUndefined();
  });

  it('is not shown for a structure with no transition metal', () => {
    const doc = new Doc();
    const a = doc.edit('e', () => { const a = doc.addAtom(0, 0); doc.addBond(a.id, doc.addAtom(20, 0, 8).id); return a.id; });
    const { body } = panel(doc, doc.fragmentOf(a));
    expect(body.textContent).not.toContain('Electron Count');
  });
});

// The tests below are plumbing: the settings are invented, and each number expected is arithmetic
// on them (the formulas at the top of src/chem/electrons.ts), not a value from a book.

/** [Rh(CO)2Cl]2-like: two Rh, two CO on each, two Cl each bonded to both Rh. Returns the doc and the two Rh ids. */
function chlorideBridged(): { doc: Doc; a: number; b: number } {
  const doc = new Doc();
  const [a, b] = doc.edit('dimer', () => {
    const a = doc.addAtom(0, 0, 45), b = doc.addAtom(40, 0, 45);
    for (const y of [-20, 20]) { const cl = doc.addAtom(20, y, 17); doc.addBond(a.id, cl.id); doc.addBond(b.id, cl.id); }
    for (const [mx, dx] of [[a, -20], [b, 20]] as const) for (const y of [-15, 15]) doc.addBond(mx.id, doc.addAtom(mx.x + dx, y, 6, { label: 'CO' }).id);
    return [a.id, b.id];
  });
  return { doc, a, b };
}

describe('ligand types set by hand are told apart by their automatic type', () => {
  it('a bridging Cl: the X row and the L row of one Rh are set apart, and not put on one row', () => {
    const { doc, a } = chlorideBridged();
    const auto = one(doc, a).ligands.filter((r) => r.name === 'Cl').map((r) => r.auto).sort();
    // each Rh: one Cl shares an electron (X), the other gives a lone pair (L)
    expect(auto).toEqual(['L', 'X']);
    doc.edit('set', () => doc.updateAtom(a, { ecount: { types: { 'Cl|X': 'L' } } }));
    const cls = one(doc, a).ligands.filter((r) => r.name === 'Cl');
    // both are L now, but on rows of their own, each with its own automatic type
    expect(cls.map((r) => [r.type, r.auto, r.count]).sort()).toEqual([['L', 'L', 1], ['L', 'X', 1]]);
    // the L row was not changed: an L row set to X changes only that row
    doc.edit('set', () => doc.updateAtom(a, { ecount: { types: { 'Cl|L': 'X' } } }));
    const c = one(doc, a);
    // l = 2 (CO) , x = 2: 9 + 2·2 + 2 = 15, oxidation state x + q = +2
    expect([c.l, c.x, c.oxidation, c.electrons]).toEqual([2, 2, 2, 15]);
    expect(c.ligands.filter((r) => r.name === 'Cl').map((r) => [r.type, r.auto]).sort()).toEqual([['X', 'L'], ['X', 'X']]);
  });

  it('an amine N and an amide N on one Ti: setting the amide to LX leaves the amine alone', () => {
    const doc = new Doc();
    const m = doc.edit('ti', () => {
      const ti = doc.addAtom(0, 0, 22);
      // NMe3 (no room for another bond: L) and NMe2 (room for one: X)
      const amine = doc.addAtom(30, 0, 7), amide = doc.addAtom(-30, 0, 7);
      doc.addBond(ti.id, amine.id); doc.addBond(ti.id, amide.id);
      for (const k of [0, 1, 2]) doc.addBond(amine.id, doc.addAtom(45, -15 + 15 * k, 6).id);
      for (const k of [0, 1]) doc.addBond(amide.id, doc.addAtom(-45, -10 + 20 * k, 6).id);
      for (const y of [-30, 30]) doc.addBond(ti.id, doc.addAtom(0, y, 17).id);
      return ti.id;
    });
    const ns = () => one(doc, m).ligands.filter((r) => r.name === 'N').map((r) => [r.auto, r.type]).sort();
    expect(ns()).toEqual([['L', 'L'], ['X', 'X']]);
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { 'N|X': 'LX' } } }));
    expect(ns()).toEqual([['L', 'L'], ['X', 'LX']]);
  });

  it('in the panel, each row\'s "(auto)" is its own automatic type, and a change is kept by name and that type', () => {
    const { doc, a } = chlorideBridged();
    const { body } = panelFor(doc, [a]);
    const rows = [...body.querySelectorAll<HTMLSelectElement>('.ec-panel-table select')].filter((x) => x.getAttribute('aria-label') === 'Type of Cl');
    expect(rows.map((x) => x.value).sort()).toEqual(['L', 'X']);
    const xRow = rows.find((x) => x.value === 'X')!;
    xRow.value = 'L';
    xRow.dispatchEvent(new Event('change'));
    expect(doc.atoms.get(a)!.ecount).toEqual({ types: { 'Cl|X': 'L' } });
    const { body: again } = panelFor(doc, [a]);
    const after = [...again.querySelectorAll<HTMLSelectElement>('.ec-panel-table select')].filter((x) => x.getAttribute('aria-label') === 'Type of Cl');
    // the row set by hand says its automatic type was X; the other row was never set by hand
    const own = after.find((x) => x.classList.contains('own'))!;
    expect([...own.options].find((o) => o.textContent?.includes('(auto)'))?.value).toBe('X');
    expect(after.filter((x) => x.classList.contains('own')).length).toBe(1);
  });
});

describe('values set by hand are kept only in range', () => {
  it('one sanitizer: whole numbers, ox −4 to +9, charge −8 to +8, expect 2 to 30, types that read', () => {
    expect(sanitizeEcount({ ox: 999999, charge: 2.5, expect: -3.7, types: { 'Cl|X': 'anything' } })).toBeNull();
    expect(sanitizeEcount({ ox: -5, charge: 9, expect: 31 })).toBeNull();
    expect(sanitizeEcount({ ox: -4, charge: -8, expect: 2 })).toEqual({ ox: -4, charge: -8, expect: 2 });
    expect(sanitizeEcount({ ox: 9, charge: 8, expect: 30, types: { 'Cl|X': 'L2X', 'N|L': 'Q' } })).toEqual({ ox: 9, charge: 8, expect: 30, types: { 'Cl|X': 'L2X' } });
    expect(sanitizeEcount('text')).toBeNull();
  });

  it('CDXML and the clipboard keep only what is in range', () => {
    expect(readEcount('{"ox":99,"charge":-99,"expect":0}')).toBeNull();
    expect(readEcount('{"ox":4,"expect":40}')).toEqual({ ox: 4 });
    const pasted = soundContents({ atoms: [{ id: 1, x: 0, y: 0, z: 45, ecount: { ox: 999999, charge: 2.5, expect: -3.7, types: { Cl: 7 } } }, { id: 2, x: 9, y: 0, z: 45, ecount: { ox: 2, types: { 'Cl|X': 'L', bad: 'x!' } } }] })!;
    expect(pasted.atoms[0].ecount).toBeUndefined();
    expect(pasted.atoms[1].ecount).toEqual({ ox: 2, types: { 'Cl|X': 'L' } });
  });

  it('the count ignores a value out of range, or an oxidation state above the group number', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    doc.edit('set', () => doc.updateAtom(m, { ecount: { ox: 999999, charge: 2.5 } }));
    // both left out: automatic, x + q = 1 + 0
    expect([one(doc, m).oxidation, one(doc, m).charge]).toEqual([1, 0]);
    // Rh is group 9: +9 would be d⁰ and is kept; nothing above it can be stored
    doc.edit('set', () => doc.updateAtom(m, { ecount: { ox: 9 } }));
    expect([one(doc, m).oxidation, one(doc, m).dn]).toEqual([9, 0]);
  });

  it('the panel lists oxidation states from −4 to the group number', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    // stored straight onto the atom, as a damaged file might have it: the panel must still be quick
    doc.edit('set', () => doc.updateAtom(m, { ecount: { ox: 999999 } }));
    const { body } = panelFor(doc, doc.fragmentOf(m));
    const ox = [...body.querySelectorAll('.style-row')].find((r) => r.firstElementChild?.firstChild?.textContent === 'Oxidation State')!.querySelector('select')!;
    const values = [...ox.options].map((o) => o.value);
    // Auto, then −4 … +9 (group 9): 14 values
    expect(values).toEqual(['auto', ...Array.from({ length: 14 }, (_, k) => String(k - 4))]);
    expect(ox.value).toBe('auto');
  });
});

describe('Reset Types and the note when the totals differ', () => {
  it('Reset Types is off when the only types kept are for ligands that are gone', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { 'Gone|L': 'X', Cl: 'L' } } }));
    let reset = [...panelFor(doc, doc.fragmentOf(m)).body.querySelectorAll('button')].find((b) => b.textContent === 'Reset Types')!;
    expect(reset.disabled).toBe(true);
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { 'Gone|L': 'X', 'Cl|X': 'L' } } }));
    reset = [...panelFor(doc, doc.fragmentOf(m)).body.querySelectorAll('button')].find((b) => b.textContent === 'Reset Types')!;
    expect(reset.disabled).toBe(false);
  });

  it('an oxidation state that does not fit the ligand types: a quiet note, and a row in the table', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    expect(panelFor(doc, doc.fragmentOf(m)).body.querySelector('.ec-differ')).toBeNull();
    expect(countRows(one(doc, m)).some((r) => r.length === 1 && r[0].startsWith('The counts differ'))).toBe(false);
    doc.edit('set', () => doc.updateAtom(m, { ecount: { ox: 3 } }));
    // neutral 9 + 6 + 1 = 16; ionic d⁶ + 6 + 2 = 14
    const c = one(doc, m);
    expect([c.electrons, c.ionicTotal]).toEqual([16, 14]);
    expect(panelFor(doc, doc.fragmentOf(m)).body.querySelector('.ec-differ')?.textContent).toBe('The counts differ: the oxidation state set does not fit the ligand types.');
    const rows = countRows(c);
    expect(rows[rows.length - 2]).toEqual(['The counts differ: the oxidation state set does not fit the ligand types.']);
    expect(rows[rows.length - 1]).toEqual([countSummary(c)]);
  });
});

describe('Insert as Table: where the table goes', () => {
  // (invented boxes, in points; the gap is 10)
  it('right of the complex\'s drawn box when that is clear, else below, else the nearest clear spot, on the page', () => {
    const b = { x1: 0, y1: 0, x2: 100, y2: 50 };
    expect(spotBeside(b, 60, 40, [], 10)).toEqual({ x: 110, y: 0 });
    // something to the right: below
    expect(spotBeside(b, 60, 40, [{ x1: 105, y1: -10, x2: 300, y2: 60 }], 10)).toEqual({ x: 0, y: 60 });
    // right runs off a 150-wide page: below
    expect(spotBeside(b, 60, 40, [], 10, { w: 150, h: 400 })).toEqual({ x: 0, y: 60 });
    // both taken: somewhere clear of everything
    const others = [{ x1: 105, y1: -10, x2: 300, y2: 60 }, { x1: -10, y1: 55, x2: 300, y2: 200 }];
    const p = spotBeside(b, 60, 40, others, 10);
    const hit = (o: { x1: number; y1: number; x2: number; y2: number }) => p.x < o.x2 && o.x1 < p.x + 60 && p.y < o.y2 && o.y1 < p.y + 40;
    expect([b, ...others].some(hit)).toBe(false);
  });

  it('measures from the structure\'s labels, not its atom centers, and keeps clear of other objects', () => {
    window.requestAnimationFrame = () => 0;
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    const scene = document.createElement('canvas'), overlay = document.createElement('canvas'), host = document.createElement('div');
    host.append(scene, overlay); document.body.append(host);
    const ed = new Editor(doc, new Renderer(scene, overlay), host);
    ed.paused = true;
    const meas = plainMeasure(doc);
    Object.assign(ed, { measure: () => meas, fullMeasure: () => meas });
    const atoms = [...doc.fragmentOf(m)].map((id) => doc.atoms.get(id)!);
    const right = Math.max(...atoms.map((a) => a.x));
    const p = ed.spotBesideStructure(m, 50, 30)!;
    // past the rightmost label's right edge (its center plus half its width), by a gap
    expect(p.x).toBeGreaterThan(right + 5);
    // a box put just there: the table goes elsewhere, clear of it
    doc.edit('box', () => { doc.addShape({ kind: 'rect', x1: p.x - 2, y1: p.y - 2, x2: p.x + 80, y2: p.y + 60 }); });
    const q = ed.spotBesideStructure(m, 50, 30)!;
    expect(q.x >= p.x + 80 || q.y >= p.y + 60 || q.x + 50 <= p.x - 2 || q.y + 30 <= p.y - 2).toBe(true);
    host.remove();
  });
});

function panelFor(doc: Doc, atoms: Iterable<number>) {
  const sel = (ids: number[]): Selection => ({ atoms: new Set(ids), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }) as Selection;
  const section = document.createElement('section'), body = document.createElement('div');
  section.append(Object.assign(document.createElement('h2'), { textContent: 'Style' }));
  const ids = [...atoms];
  const p = new StylePanel(section, body, doc, () => sel(ids), () => p.refresh());
  p.refresh(true);
  return { p, body };
}

describe('Settings ▸ Preferences ▸ Electron Counting Method', () => {
  // (plumbing: which columns show; the numbers are those of the Wilkinson's catalyst test above, MFT Figure 13.10)
  const sel = (atoms: Iterable<number>): Selection => ({ atoms: new Set(atoms), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }) as Selection;
  const heads = (doc: Doc, m: number) => {
    const section = document.createElement('section'), body = document.createElement('div');
    const ids = [...doc.fragmentOf(m)];
    new StylePanel(section, body, doc, () => sel(ids), () => {}).refresh(true);
    return [...body.querySelectorAll('.ec-panel-table th')].map((t) => t.textContent);
  };
  const reset = () => { electronPrefs.method = 'both'; };

  it('shows both columns unless one method is chosen', () => {
    reset();
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    expect(electronPrefs.method).toBe('both');
    expect(countRows(one(doc, m))[0]).toEqual(['Ligand', 'Type', 'Neutral', 'Ionic']);
    expect(heads(doc, m)).toEqual(['Ligand', 'Type', 'Neutral', 'Ionic']);
  });

  it('Neutral Ligand hides the Ionic column in the rows and the panel, and keeps the total and summary', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    try {
      electronPrefs.method = 'neutral';
      const rows = countRows(one(doc, m));
      expect(rows[0]).toEqual(['Ligand', 'Type', 'Neutral']);
      expect(rows).toContainEqual(['Total', '', '16']);
      expect(rows[rows.length - 1]).toEqual(['Rh(I), d⁸, 16 electrons · ML₃X']);
      expect(heads(doc, m)).toEqual(['Ligand', 'Type', 'Neutral']);
    } finally { reset(); }
  });

  it('Donor Pair (Ionic) hides the Neutral column in the rows and the panel, and keeps the total and summary', () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    try {
      electronPrefs.method = 'ionic';
      const rows = countRows(one(doc, m));
      expect(rows[0]).toEqual(['Ligand', 'Type', 'Ionic']);
      expect(rows[1]).toEqual(['Rh', 'metal', 'd⁸: 8']);
      expect(rows).toContainEqual(['Total', '', '16']);
      expect(rows[rows.length - 1]).toEqual(['Rh(I), d⁸, 16 electrons · ML₃X']);
      expect(heads(doc, m)).toEqual(['Ligand', 'Type', 'Ionic']);
    } finally { reset(); }
  });

  it('is a setting that defaults to both, is kept, and ignores a bad value', async () => {
    const { parseSettings, DEFAULT_SETTINGS } = await import('../src/settings');
    expect(DEFAULT_SETTINGS.electronMethod).toBe('both');
    expect(parseSettings('{}').electronMethod).toBe('both');
    expect(parseSettings(JSON.stringify({ electronMethod: 'ionic' })).electronMethod).toBe('ionic');
    expect(parseSettings(JSON.stringify({ electronMethod: 'neutral' })).electronMethod).toBe('neutral');
    expect(parseSettings(JSON.stringify({ electronMethod: 'other' })).electronMethod).toBe('both');
  });
});
