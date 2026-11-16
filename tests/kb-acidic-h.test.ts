// The hydrogen each pKa belongs to, drawn on its own bond in red (Nate's pick B, 2026-11-16): which
// atom carries it (scripts/kb/build-pka-acidic.mjs), and how the drawing shows it.

import { describe, expect, it } from 'vitest';
import { PKA_VALUES_TABLE, acidicSite, pkaPicture } from '../src/kb/pka';
import { ACIDIC_H_COLOR, withAcidicH } from '../src/kb/acidic-h';
import type { Template } from '../src/chem/templates';
import type { Cell } from '../src/kb/tables';

const rows = PKA_VALUES_TABLE.rows;
const row = (name: string, solvent: string, pka?: string) => {
  const r = rows.find((x) => x.name === name && x.solvent === solvent && (pka === undefined || x.pka === pka));
  if (!r) throw new Error(`no row ${name} in ${solvent}`);
  return r;
};
/** The element the hydrogen goes on, and whether the drawing is the conjugate acid. */
const site = (r: Record<string, Cell>) => {
  const s = acidicSite(r)!;
  const t = pkaPicture(r)!;
  return { el: t.atoms[s[0]][2], base: s[1] === 1, atom: s[0], t };
};

describe('which hydrogen a pKa belongs to', () => {
  it('finds one for nearly every row', () => {
    const missing = rows.filter((r) => !acidicSite(r));
    expect(missing.length).toBeLessThan(10);
  });

  it('picks the acid group the value belongs to', () => {
    expect(site(row('Acetic acid', 'Water', '4.76'))).toMatchObject({ el: 'O', base: false });
    expect(site(row('Acetic acid', 'Water', '~24'))).toMatchObject({ el: 'C', base: false });
    expect(site(row('Phenol', 'DMSO'))).toMatchObject({ el: 'O', base: false });
    expect(site(row('Thiophenol', 'DMSO'))).toMatchObject({ el: 'S', base: false });
    // glycine 2.34, 9.6: the lowest is the CO2H
    const gly = site(row('Glycine', 'Water', '2.34, 9.6'));
    expect(gly.el).toBe('O');
    expect(gly.t.bonds.some(([a, b, o]) => o === 2 && (a === gly.atom || b === gly.atom))).toBe(false);
  });

  it('picks the most acidic C–H: between two carbonyls, at C9 of fluorene', () => {
    const acac = site(row('Acetylacetone', 'DMSO'));
    const nbrs = acac.t.bonds.filter(([a, b]) => a === acac.atom || b === acac.atom).map(([a, b]) => (a === acac.atom ? b : a));
    expect(nbrs.filter((i) => acac.t.bonds.some(([a, b, o]) => o === 2 && (a === i || b === i))).length).toBe(2);
    const fl = site(row('Fluorene', 'DMSO'));
    expect(fl.t.bonds.filter(([a, b]) => a === fl.atom || b === fl.atom)).toHaveLength(3); // two ring bonds and the H
  });

  it('draws a base as its conjugate acid, the value being that acid\'s', () => {
    expect(site(row('Pyridine', 'Water', '5.14'))).toMatchObject({ el: 'N', base: true });
    expect(site(row('Triethylamine', 'Water'))).toMatchObject({ el: 'N', base: true });
    // imidazole: 6.95 in water is the imidazolium; 18.6 in DMSO the N–H coming off
    expect(site(row('Imidazole', 'Water'))).toMatchObject({ el: 'N', base: true });
    expect(site(row('Imidazole', 'DMSO'))).toMatchObject({ el: 'N', base: false });
    // histamine's 6.0 is its ring nitrogen, not its amine
    const h = site(row('Histamine', 'Water', '6.0'));
    expect(h.t.atoms[h.atom].length).toBeGreaterThan(0);
    expect(h.t.bonds.filter(([a, b]) => a === h.atom || b === h.atom)).toHaveLength(3);
  });
});

describe('the acidic hydrogen in a drawing', () => {
  const acetic: Template = { id: 't', name: 'Acetic acid', group: 'own', attach: 0,
    atoms: [[0, 0, 'C'], [0.87, 0.5, 'C'], [0.87, 1.5, 'O'], [1.73, 0, 'O']], bonds: [[0, 1, 1], [1, 2, 2], [1, 3, 1]] };

  it('adds the hydrogen on a bond of its own, both in red', () => {
    const t = withAcidicH(acetic, 3);
    expect(t.atoms).toHaveLength(5);
    expect(t.atoms[4][2]).toBe('H');
    expect(t.bonds[3]).toEqual([3, 4, 1]);
    expect(t.highlight).toEqual({ atoms: [4], bonds: [3], color: ACIDIC_H_COLOR });
    // one bond length away, at a zigzag from the C–O bond and clear of the other atoms
    const [hx, hy] = t.atoms[4];
    expect(Math.hypot(hx - 1.73, hy)).toBeCloseTo(1, 5);
    for (const a of t.atoms.slice(0, 3)) expect(Math.hypot(a[0] - hx, a[1] - hy)).toBeGreaterThan(1.2);
    // the drawing it was given is left alone
    expect(acetic.atoms).toHaveLength(4);
  });

  it('charges an atom that takes the hydrogen on', () => {
    const py: Template = { id: 'p', name: 'Pyridine', group: 'own', attach: 0, atoms: [[0, 0, 'N'], [1, 0, 'C'], [-0.5, 0.87, 'C']], bonds: [[0, 1, 2], [0, 2, 1]] };
    expect(withAcidicH(py, 0, true).atoms[0][3]).toBe(1);
    const oxide: Template = { ...py, atoms: [[0, 0, 'O', -1], [1, 0, 'N', 1]], bonds: [[0, 1, 1]] };
    expect(withAcidicH(oxide, 0, true).atoms[0]).toEqual([0, 0, 'O']);
  });

  it('writes a lone atom (H2O, CH4) with one hydrogen drawn apart', () => {
    const water: Template = { id: 'w', name: 'Water', group: 'own', attach: 0, atoms: [[0, 0, 'O', 0, 'H2O']], bonds: [] };
    expect(withAcidicH(water, 0).atoms[0]).toEqual([0, 0, 'O']);
    const methane: Template = { ...water, atoms: [[0, 0, 'C', 0, 'CH4']] };
    expect(withAcidicH(methane, 0).atoms[0]).toEqual([0, 0, 'C', 0, 'CH3']);
  });
});
