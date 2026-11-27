// Review batch 08: small fixes with one check each. F386 (a CIF uncertainty with an exponent),
// F392 (a crystal contact longer than 4 Å is a bond), F393 (a two-species cycle is a loop), F396
// (a ring one atom over the CoordGen limit counts as a macrocycle), F400 (tiny lab values keep
// their figures), F402 (a damaged nickname SMILES neither hangs nor throws), F391 (a molecule
// written wrapped across a cell face is grown once).
import { describe, expect, it } from 'vitest';
import { cifUncertainty, readCif } from '../src/chem/cif';
import { grow, structureFromCif } from '../src/chem/crystal';
import { smoothLoop } from '../src/chem/cycle-path';
import { COORDGEN_RING_LIMIT, hasMacrocycle, smilesGraph } from '../src/chem/engine-guard';
import { show } from '../src/chem/lab-calc';
import { parseSmiles } from '../src/chem/labels';

describe('small fixes', () => {
  it('F386: the uncertainty of 1.5e-3(2) is 2 in the last digit of the mantissa, times 10^-3', () => {
    // CIF 1.1 (IUCr): a standard uncertainty in parentheses applies to the last digits of the number
    expect(cifUncertainty('1.5e-3(2)')).toBeCloseTo(2e-4, 12);
    expect(cifUncertainty('12.345(6)')).toBeCloseTo(0.006, 12);
  });

  it('F392: a 4.1 Å Cs–I contact the growth accepts is drawn as a bond', () => {
    // Cs and I 4.1 Å apart in a big P1 cell: within the sum of their covalent radii plus the
    // tolerance the growth uses, so one piece, joined
    const [block] = readCif(`data_csi
_cell_length_a 20
_cell_length_b 20
_cell_length_c 20
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_space_group_symop_operation_xyz
'x,y,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Cs1 Cs 0.5 0.5 0.5
I1 I 0.705 0.5 0.5
`);
    const g = grow(structureFromCif(block));
    expect(g.atoms).toHaveLength(2);
    expect(g.bonds).toHaveLength(1);
    expect(g.molecules).toBe(1);
  });

  it('F393: two species make a round loop, not two crossing S-curves', () => {
    const [p0, p1] = smoothLoop([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    // the way out goes one side and the way back the other side of the line between them
    expect(Math.sign(p0[1].y)).toBe(Math.sign(p0[2].y));
    expect(Math.sign(p1[1].y)).toBe(Math.sign(p1[2].y));
    expect(Math.sign(p0[1].y)).toBe(-Math.sign(p1[1].y));
  });

  it('F396: a ring of limit + 1 atoms is a macrocycle; a ring of limit atoms is not', () => {
    const ring = (n: number) => `C1${'C'.repeat(n - 2)}C1`;
    expect(hasMacrocycle(smilesGraph(ring(COORDGEN_RING_LIMIT + 1)))).toBe(true);
    expect(hasMacrocycle(smilesGraph(ring(COORDGEN_RING_LIMIT)))).toBe(false);
  });

  it('F400: a nanomolar value keeps its figures', () => {
    expect(Number(show(2e-9))).toBe(2e-9);
    expect(Number(show(3.456e-7))).toBe(3.456e-7);
    expect(show(0.1234567)).toBe('0.1235');
  });

  it('F402: an unclosed or unread bracket atom gives a dummy atom', () => {
    expect(parseSmiles('[CC').atoms.length).toBeGreaterThan(0);
    const g = parseSmiles('[C@H](C)O');
    expect(g.atoms.map((a) => a.z)).toEqual([6, 6, 8]);
    expect(parseSmiles('[O--]').atoms[0].charge).toBe(-2);
    expect(parseSmiles('[*]C').atoms[0].dummy).toBe(true);
  });

  it('F402: a ring number before any atom, or closing on its own atom, is passed over', () => {
    const g = parseSmiles('1CC1');
    expect(g.atoms.map((a) => a.z)).toEqual([6, 6]);
    expect(g.bonds).toHaveLength(1);
    expect(parseSmiles('.1C').atoms).toHaveLength(1);
    expect(parseSmiles('C11').bonds).toHaveLength(0);
  });
});

describe('F391: a molecule written wrapped across a cell face', () => {
  it('is grown once, not once more one cell along', () => {
    // a C–C pair 1.0 Å apart across the x face of a 10 Å P1 cell, written as x = 0.95 and
    // x = 0.05 (wrapped), and the same pair written side by side: one molecule, two atoms, each time
    const cif = (x2: number) => readCif(`data_w
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_space_group_symop_operation_xyz
'x,y,z'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
C1 C 0.95 0.5 0.5
C2 C ${x2} 0.5 0.5
`)[0];
    for (const x2 of [0.05, 1.05]) {
      const g = grow(structureFromCif(cif(x2)));
      expect(g.atoms, `x = ${x2}`).toHaveLength(2);
      expect(g.molecules).toBe(1);
      expect(g.bonds).toHaveLength(1);
    }
  });
});
