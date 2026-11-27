// Review batch 08, F397 and F398: Expand Label keeps the isotopes of a deuterated label (CD3,
// OCD3) and the label's own charge: PPh3 with a + on a carbon is a phosphonium ion, R4P+, whose
// formal charge +1 is on phosphorus (IUPAC Gold Book, "onium compounds").
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { expandWithMolblock, labelSmiles } from '../src/chem/expand';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); }, 30000);
const layout = (smi: string) => { const m = RDKit.get_mol(smi); m.set_new_coords(true); try { return m.get_molblock(); } finally { m.delete(); } };

function labelled(label: string, charge = 0) {
  const doc = new Doc();
  const L = doc.style.bondLength;
  const { c, x } = doc.edit('a', () => {
    const c = doc.addAtom(0, 0), x = doc.addAtom(L, 0, 6, { label, charge });
    doc.addBond(c.id, x.id);
    return { c: c.id, x: x.id };
  });
  const smi = labelSmiles(doc.atoms.get(x)!, 1)!;
  const ids = doc.edit('Expand', () => expandWithMolblock(doc, x, layout('*' + smi)));
  return { doc, c, ids };
}

describe('Expand Label', () => {
  it('keeps deuterium: OCD3 has three deuterium atoms', () => {
    const { doc, ids } = labelled('OCD3');
    const d = ids.map((id) => doc.atoms.get(id)!).filter((a) => a.z === 1);
    expect(d).toHaveLength(3);
    for (const a of d) expect(a.isotope).toBe(2);
  });

  it('keeps the label\'s own charge on its first atom', () => {
    const { doc, ids } = labelled('PPh3', 1);
    const n = ids.map((id) => doc.atoms.get(id)!).find((a) => a.z === 15)!;
    expect(n.charge).toBe(1);
  });
});
