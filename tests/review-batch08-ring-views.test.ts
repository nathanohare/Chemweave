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
  it('keeps the stereocentre a wedge from the substituent shows', () => {
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
    // (the wedge stays on the bond from the CH, or moves to another of the CH's bonds)
    expect([...doc.bonds.values()].some((b) => b.a1 === ch && b.display !== 'solid')).toBe(true);
    void wedge;
    expect(canon(doc)).toBe(before);
  });

  it('keeps the ring\'s cis/trans as well as the substituent\'s own centre', () => {
    // cis-4-methyl-1-(1-hydroxyethyl)cyclohexane, both ring substituents wedged from the ring
    const doc = new Doc();
    const L = doc.style.bondLength;
    let ring: number[] = [], toRing = 0, ch = 0;
    doc.bulk(() => {
      ring = hexane(doc);
      const top = doc.atoms.get(ring[0])!, bottom = doc.atoms.get(ring[3])!;
      const c = doc.addAtom(top.x, top.y - L), o = doc.addAtom(top.x - L * 0.866, top.y - 1.5 * L, 8), me = doc.addAtom(top.x + L * 0.866, top.y - 1.5 * L);
      toRing = doc.addBond(ring[0], c.id, 1, 'wedge').id;
      doc.addBond(c.id, o.id); doc.addBond(c.id, me.id);
      const m4 = doc.addAtom(bottom.x, bottom.y + L);
      doc.addBond(ring[3], m4.id, 1, 'wedge');
      ch = c.id;
    });
    const cis = canon(doc);
    expect(cis.match(/@+/g)?.length).toBe(2);
    step(doc, ring, 'chair');
    // in the chair, the side chain's own centre is shown by a wedge from it to the ring carbon
    doc.edit('wedge', () => doc.updateBond(toRing, { a1: ch, a2: ring[0], display: 'wedge' }));
    const chair = canon(doc);
    step(doc, ring, 'flat');
    const flat = canon(doc);
    // both ring centres and the side chain's centre are drawn
    expect(flat.match(/@+/g)?.length).toBe(3);
    // and the ring is still cis: with the side chain's centre left out, it is the drawing we began with
    const sideWedge = [...doc.bonds.values()].find((b) => b.a1 === ch && b.display !== 'solid')!;
    doc.edit('plain', () => doc.updateBond(sideWedge.id, { display: 'solid' }));
    expect(canon(doc)).toBe(cis);
    // the chair drawing reads the same (the chemistry engine is shown it laid out flat)
    expect(chair).toBe(flat);
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

  it('going flat keeps a branch\'s depths relative to its first atom (another chair further along)', () => {
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
    // the branch's far atom drawn 7 deeper than its first (as a chair in the branch would be)
    doc.edit('depth', () => doc.updateAtom(ch3, { depth: (doc.atoms.get(ch2)!.depth ?? 0) + 7 }));
    step(doc, ring, 'flat');
    expect(doc.atoms.get(ch2)!.depth).toBeUndefined();
    expect(doc.atoms.get(ch3)!.depth).toBeCloseTo(7, 6);
  });
});
