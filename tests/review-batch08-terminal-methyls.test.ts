// Review batch 08, F048: Show Terminal Methyls on a selection with no chain end in it changes
// nothing (it used to take every written-out methyl in the drawing off).
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { toggleChainEndLabels } from '../src/chem/hydrogens';

describe('Show Terminal Methyls', () => {
  it('leaves the drawing alone when the selection has no chain end', () => {
    const doc = new Doc();
    const { ring, ends } = doc.edit('d', () => {
      // toluene: a six-membered ring with a methyl, and a separate ethane
      const ring = [0, 1, 2, 3, 4, 5].map((k) => doc.addAtom(Math.cos(k * Math.PI / 3) * 14, Math.sin(k * Math.PI / 3) * 14));
      ring.forEach((a, k) => doc.addBond(a.id, ring[(k + 1) % 6].id, k % 2 ? 1 : 2));
      const me = doc.addAtom(28, 0);
      doc.addBond(ring[0].id, me.id, 1);
      const e1 = doc.addAtom(100, 0), e2 = doc.addAtom(114, 0);
      doc.addBond(e1.id, e2.id, 1);
      return { ring: ring.map((a) => a.id), ends: [me.id, e1.id, e2.id] };
    });
    // nothing selected: every chain end is written out
    const all = doc.edit('show', () => toggleChainEndLabels(doc, []));
    expect(all).toEqual({ count: 3, shown: true });
    for (const id of ends) expect(doc.atoms.get(id)!.showCarbon).toBe(true);
    // the ring atoms only: no chain end among them
    expect(doc.edit('show', () => toggleChainEndLabels(doc, ring))).toEqual({ count: 0, shown: false });
    for (const id of ends) expect(doc.atoms.get(id)!.showCarbon).toBe(true);
  });
});
