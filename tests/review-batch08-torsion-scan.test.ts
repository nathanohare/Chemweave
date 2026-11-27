// Review batch 08, F050: a torsion scan turns the bond to the angle it says. Torsion angles are
// signed as IUPAC defines them: looking along b→c, positive when the front bond a–b has to be
// turned clockwise to eclipse the back bond c–d (IUPAC Gold Book, "torsion angle"). Each point of
// a scan of 2-chlorobutane (chiral, so a mirrored scan would show) measures as its own angle.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Resources } from 'openchemlib';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { addMolfile } from '../src/io/chem-formats';
import { searchModel } from '../src/chem/model3d-build';
import { scanTorsion } from '../src/chem/torsion-scan';
import { torsion } from '../src/chem/newman';

let molblock = '';
let xyz0: number[] = [];

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RDKit: any = await createRequire(import.meta.url)('@rdkit/rdkit')();
  Resources.registerFromNodejs();
  // (R)-2-chlorobutane, the heavy atoms in the order C1 C2 C3 C4 Cl
  const m = RDKit.get_mol('C[C@@H](CC)Cl');
  const doc = new Doc();
  doc.bulk(() => addMolfile(doc, m.get_molblock(), 200, 200));
  m.delete();
  molblock = toMolfile(doc, doc.atoms.keys()).molblock;
  xyz0 = searchModel(molblock, { starts: 10, window: 6, rmsd: 0.3 })!.conformers[0].xyz;
}, 120000);

describe('torsion scan', () => {
  it('measures each point at its own angle (C1–C2–C3–C4)', () => {
    const t: [number, number, number, number] = [0, 1, 2, 3];
    const scan = scanTorsion(molblock, xyz0, t, { step: 30, rounds: 6 })!;
    expect(scan.points).toHaveLength(12);
    for (const p of scan.points) {
      const got = ((torsion(p.xyz, ...t) % 360) + 360) % 360;
      const off = Math.abs(((got - p.phi + 540) % 360) - 180);
      expect(off, `at ${p.phi}°`).toBeLessThan(0.5);
    }
  }, 120000);
});
