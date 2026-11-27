// Review batch 08, F050: torsion angles follow IUPAC's sign rule, as the Newman projection's
// angles do. IUPAC Gold Book, "torsion angle" (https://doi.org/10.1351/goldbook.T06406): looking
// along the bond B–C, the angle is positive when the bond to the front atom A has to turn
// clockwise (by less than 180°) to eclipse the bond to the back atom D; a positive torsion is a
// right-handed helix (IUPAC Recommendations 1996, Basic terminology of stereochemistry, Pure Appl.
// Chem. 68, 2193).
import { describe, expect, it } from 'vitest';
import { newmanView, torsion } from '../src/chem/newman';
import { torsion as karplusTorsion } from '../src/chem/nmr/karplus';

// a = (1,0,0), b = origin, c = (0,0,1), d = (0,1,1). Looking from b to c is looking along +z;
// seen that way, +x turns clockwise onto +y by 90°, so the torsion is +90°.
const QUARTER = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1];
// four points on a right-handed helix about z (each 90° further anticlockwise seen from +z, and
// 1 higher): a right-handed helix has a positive torsion
const HELIX = [1, 0, 0, 0, 1, 1, -1, 0, 2, 0, -1, 3];

describe('torsion sign', () => {
  it('is +90° for a quarter turn clockwise seen from b to c', () => {
    expect(torsion(QUARTER, 0, 1, 2, 3)).toBeCloseTo(90, 9);
    expect(karplusTorsion(QUARTER, 0, 1, 2, 3)).toBeCloseTo(90, 9);
  });

  it('is positive for a right-handed helix', () => {
    expect(torsion(HELIX, 0, 1, 2, 3)).toBeGreaterThan(0);
    expect(karplusTorsion(HELIX, 0, 1, 2, 3)).toBeGreaterThan(0);
  });

  it('matches the Newman projection\'s clockwise angle', () => {
    const mol = {
      atoms: [6, 6, 6, 6].map((z) => ({ z, charge: 0 })),
      bonds: [{ a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1 }, { a: 2, b: 3, order: 1 }],
    };
    for (const xyz of [QUARTER, HELIX]) {
      const view = newmanView(mol, xyz, 1, 2);
      expect(view.dihedral).toBeCloseTo(torsion(xyz, 0, 1, 2, 3), 6);
    }
  });
});
