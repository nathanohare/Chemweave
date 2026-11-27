// @vitest-environment jsdom
// Review batch 08, F411 and F412: turning a cyclohexane into a chair and back keeps a wedge that
// starts at a substituent's own stereocentre, and a substituent's far atoms move in depth with
// its first atom.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { stepRing, viewRingOf, type RingStep } from '../src/chem/ring-views';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); }, 30000);
const canon = (doc: Doc): string => {
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try { return m.get_smiles(); } finally { m.delete(); }
};

/** A flat cyclohexane, corner at the top, and that top atom's id. */
function hexane(doc: Doc): number[] {
  const L = doc.style.bondLength;
  const ring: number[] = [];
  for (let k = 0; k < 6; k++) {
    const t = (-90 + 60 * k) * Math.PI / 180;
    ring.push(doc.addAtom(200 + L * Math.cos(t), 200 + L * Math.sin(t)).id);
  }
  ring.forEach((id, k) => doc.addBond(id, ring[(k + 1) % 6], 1));
  return ring;
}
const step = (doc: Doc, ring: number[], s: RingStep) => {
  const got = viewRingOf(doc, ring);
  if (!('ring' in got)) throw new Error(got.why);
  doc.edit('ring', () => stepRing(doc, got.ring, s));
};

describe('chair and back', () => {
  it('keeps a wedge drawn from the substituent\'s own stereocentre', () => {
    // 1-cyclohexylethanol, its CH(OH) centre shown by a wedge from that CH to the ring carbon
    const doc = new Doc();
    const L = doc.style.bondLength;
    let ring: number[] = [], wedge = 0, ch = 0;
    doc.bulk(() => {
      ring = hexane(doc);
      const top = doc.atoms.get(ring[0])!;
      const c = doc.addAtom(top.x, top.y - L), o = doc.addAtom(top.x - L * 0.866, top.y - 1.5 * L, 8), me = doc.addAtom(top.x + L * 0.866, top.y - 1.5 * L);
      wedge = doc.addBond(c.id, ring[0], 1, 'wedge').id;
      doc.addBond(c.id, o.id); doc.addBond(c.id, me.id);
      ch = c.id;
    });
    const before = canon(doc);
    expect(before).toContain('@');
    step(doc, ring, 'chair');
    step(doc, ring, 'flat');
    const b = doc.bonds.get(wedge)!;
    expect(b.a1).toBe(ch);
    expect(b.display).toBe('wedge');
    expect(canon(doc)).toBe(before);
  });

  it('moves an ethyl group\'s CH3 in depth with its CH2', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    let ring: number[] = [], ch2 = 0, ch3 = 0;
    doc.bulk(() => {
      ring = hexane(doc);
      const top = doc.atoms.get(ring[0])!;
      const a = doc.addAtom(top.x, top.y - L), b = doc.addAtom(top.x + L * 0.866, top.y - 1.5 * L);
      doc.addBond(ring[0], a.id); doc.addBond(a.id, b.id);
      ch2 = a.id; ch3 = b.id;
    });
    step(doc, ring, 'chair');
    const d2 = doc.atoms.get(ch2)!.depth ?? 0, d3 = doc.atoms.get(ch3)!.depth ?? 0;
    expect(d2).not.toBeCloseTo(0, 3);
    // in the flat drawing both were at depth 0: they stay level with each other
    expect(d3).toBeCloseTo(d2, 6);
  });
});
