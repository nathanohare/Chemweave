// @vitest-environment jsdom
// A sawhorse's wedge and hashed wedge say which groups point toward and away from the reader:
// read back as an ordinary wedge-and-hash structure, the drawing must be the same stereoisomer
// as the 3-D arrangement it was drawn from, at every conformation.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { NEWMAN_LOOK, drawNewman, sawhorseWedges, type NewmanData } from '../src/design/newman';
import { plainMeasure } from '../src/chem/reaction';
import type { NewmanGroup } from '../src/chem/newman';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); }, 30000);

const RAD = Math.PI / 180;
const FRONT = ['F', 'Cl', 'Br'], BACK = ['I', 'N', 'O'];

/** The molecule in 3-D: front atom at the origin, back atom along +z (away from the reader looking down the bond), groups at their angles clockwise from up as the reader sees them. */
function molblock3d(fa: number[], ba: number[]): string {
  const atoms: [string, number, number, number][] = [['C', 0, 0, 0], ['C', 0, 0, 1.5]];
  // seen from the front with y up, clockwise from up runs toward the reader's right, which is −x when looking along +z
  fa.forEach((a, i) => atoms.push([FRONT[i], -Math.sin(a * RAD), Math.cos(a * RAD), -0.4]));
  ba.forEach((a, i) => atoms.push([BACK[i], -Math.sin(a * RAD), Math.cos(a * RAD), 1.9]));
  const f = (v: number) => v.toFixed(4).padStart(10);
  const lines = ['', '  test 3D', '', `${String(atoms.length).padStart(3)}${String(7).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`];
  for (const [el, x, y, z] of atoms) lines.push(`${f(x)}${f(y)}${f(z)} ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  const bond = (a: number, b: number) => lines.push(`${String(a).padStart(3)}${String(b).padStart(3)}  1  0`);
  bond(1, 2); for (let i = 0; i < 3; i++) bond(1, 3 + i); for (let i = 0; i < 3; i++) bond(2, 6 + i);
  lines.push('M  END');
  return lines.join('\n');
}

const smiles = (block: string): string => { const m = RDKit.get_mol(block); const s = m.get_smiles(); m.delete(); return s; };

describe('sawhorse wedges', () => {
  it('gives no wedges to an atom without three groups', () => {
    expect(sawhorseWedges([[1, 0, 0], [0, 1, 0]], [0, 0, 1])).toBeNull();
  });

  it('draws the same stereoisomer as the 3-D arrangement, at every turn of the bond and both hands', () => {
    const fronts = [[0, 120, 240], [0, 240, 120]], backs = [[60, 180, 300], [60, 300, 180]];
    let checked = 0;
    for (const fa of fronts) for (const ba of backs) for (let turn = 0; turn < 360; turn += 20) {
      const group = (labels: string[], angles: number[], base: number, by: number): NewmanGroup[] => labels.map((label, i) => ({ atom: base + i, angle: (angles[i] + by) % 360, label, size: 3 - i }));
      const want = smiles(molblock3d(fa, ba.map((a) => a + turn)));
      expect(want).toContain('@');
      const doc = new Doc();
      const d: NewmanData = { kind: 'sawhorse', front: group(FRONT, fa, 2, 0), back: group(BACK, ba, 5, turn), turn: 0, conformer: 0, source: 'angle', look: { ...structuredClone(NEWMAN_LOOK), ideal: false } };
      doc.bulk(() => { drawNewman(doc, plainMeasure, d, { x: 100, y: 100 }); });
      const wedges = [...doc.bonds.values()].filter((b) => b.display === 'wedge').length, hashes = [...doc.bonds.values()].filter((b) => b.display === 'hashWedge').length;
      expect([wedges, hashes]).toEqual([2, 2]);
      expect(smiles(toMolfile(doc, doc.atoms.keys()).molblock), `front ${fa} back ${ba} turn ${turn}`).toBe(want);
      checked++;
    }
    expect(checked).toBe(72);
  });
});
