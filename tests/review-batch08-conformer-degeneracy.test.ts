// Review batch 08, F044 and F058: a conformer found in several equivalent forms (its degeneracy)
// keeps that count when more rotamers are merged in and when xTB refines the energies, so its
// Boltzmann share still counts every form. Equal energies make the shares simple fractions: two
// forms of one conformer and one of another split 2 : 1 (the Boltzmann factor is 1 for both).
import { describe, it, expect } from 'vitest';
import { mergeConformers } from '../src/chem/conformer-rank';
import { refineWithXtb, type XtbRunner } from '../src/chem/xtb';
import type { Model3d } from '../src/chem/model3d-build';

const atoms = [{ z: 6, charge: 0 }, { z: 6, charge: 0 }];
const gauche = { xyz: [0, 0, 0, 1.5, 0, 0], energy: 0, degeneracy: 2, population: 2 / 3 };
const anti = { xyz: [0, 0, 0, 0, 1.5, 0], energy: 0, population: 1 / 3 };

describe('degeneracy survives', () => {
  it('merging extra rotamers that are already found', () => {
    // the extra rotamer is the gauche form again, so nothing new is added
    const out = mergeConformers(atoms, [gauche, anti], [{ xyz: [0, 0, 0, 1.5, 0, 0], energy: 0 }]);
    expect(out).toHaveLength(2);
    const g = out.find((c) => c.xyz[3] === 1.5)!;
    expect(g.degeneracy).toBe(2);
    expect(g.population).toBeCloseTo(2 / 3, 9);
  });

  it('refining with xTB, energies only', async () => {
    const m: Model3d = {
      atoms,
      bonds: [{ a: 0, b: 1, order: 1, aromatic: false }],
      conformers: [gauche, anti],
    };
    const run: XtbRunner = async (job) => ({ xyz: job.xyz, energy: -10 });
    const r = await refineWithXtb(m, { exe: 'xtb', solvent: '', opt: false, count: 5 }, run);
    const g = r.conformers.find((c) => c.xyz[3] === 1.5)!;
    expect(g.degeneracy).toBe(2);
    expect(g.population).toBeCloseTo(2 / 3, 9);
    expect(r.conformers.reduce((s, c) => s + c.population!, 0)).toBeCloseTo(1, 9);
  });
});
