// @vitest-environment jsdom
//
// The Side Panel's Electron Count: the book's worked examples counted both ways, the count
// expected (18, or 16 for a square-planar d⁸ metal), ligand types, oxidation state, charge and
// expected count set by hand (kept on the metal, through CDXML, one undo step each), and the rows
// Insert as Table copies.
//
// Every expected count below is from Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed.
// (Pearson, 2014), chapter 13, cited case by case ("MFT" and the page); none comes from running
// the code under test.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { countElectrons, countRows, countSummary, expectedCount, parseType, selectedComplex, typeCode, type MetalCount } from '../src/chem/electrons';
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
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { Cl: 'L' } } }));
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
    doc.edit('set', () => doc.updateAtom(m, { ecount: { types: { PPh3: 'X', Gone: 'L' }, expect: 16 } }));
    const back = readCdxml(writeCdxml(doc)).doc;
    const metal = [...back.atoms.values()].find((a) => a.z === 45)!;
    expect(metal.ecount).toEqual({ types: { PPh3: 'X', Gone: 'L' }, expect: 16 });
    // (a ligand that isn't there any more is simply not used)
    expect(one(back, metal.id).classification).toBe('MX₄');
    expect(readEcount('not json')).toBeNull();
    expect(readEcount('{"types":{"Cl":"bad!"},"ox":1.5}')).toBeNull();
    expect(readEcount('{"types":{"Cl":"L"},"ox":2}')).toEqual({ types: { Cl: 'L' }, ox: 2 });
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
    expect(doc.atoms.get(m)!.ecount).toEqual({ types: { Cl: 'L' } });
    expect(doc.undoLabel).toBe('Ligand Type');
    p.refresh();
    expect(body.querySelector('.ec-sum')?.textContent).toBe('Rh(0), d⁹, 17 electrons · ML₄');
    // Reset Types: one step
    const reset = [...body.querySelectorAll('button')].find((b) => b.textContent === 'Reset Types')!;
    expect(reset.disabled).toBe(false);
    reset.click();
    expect(doc.atoms.get(m)!.ecount).toBeUndefined();
    doc.undo();
    expect(doc.atoms.get(m)!.ecount).toEqual({ types: { Cl: 'L' } });
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
