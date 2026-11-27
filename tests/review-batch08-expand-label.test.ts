// Review batch 08, F397 and F398: Expand Label keeps the isotopes of a deuterated label (CD3,
// OCD3) and the label's own charge: PPh3 with a + on a carbon is a phosphonium ion, R4P+, whose
// formal charge +1 is on phosphorus (IUPAC Gold Book, "onium compounds"). A carboxylate, RCO2−,
// carries its charge on oxygen (IUPAC Gold Book, "carboxylates"), as does a sulfonate RSO3−: the
// same label read as a structure (the molfile writer) and drawn out must give the same anion.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { expandInPlace, expandWithMolblock, inPlaceSmiles, labelSmiles } from '../src/chem/expand';
import { toMolfile } from '../src/chem/molfile';

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

  // the drawing as canonical SMILES, through the molfile writer (null when RDKit can't read it)
  const smilesOf = (doc: Doc) => {
    const m = RDKit.get_mol(toMolfile(doc, [...doc.atoms.keys()]).molblock);
    if (!m) return null;
    try { return m.get_smiles(); } finally { m.delete(); }
  };
  const canon = (smi: string) => { const m = RDKit.get_mol(smi); try { return m.get_smiles(); } finally { m.delete(); } };

  it('puts a carboxylate\'s charge on oxygen: CO2 with a − reads and expands as CC(=O)[O-]', () => {
    const doc = new Doc();
    const x = doc.edit('a', () => { const c = doc.addAtom(0, 0), x = doc.addAtom(30, 0, 6, { label: 'CO2', charge: -1 }); doc.addBond(c.id, x.id); return x.id; });
    expect(smilesOf(doc)).toBe(canon('CC(=O)[O-]'));
    const smi = labelSmiles(doc.atoms.get(x)!, 1)!;
    doc.edit('Expand', () => expandWithMolblock(doc, x, layout('*' + smi)));
    expect(smilesOf(doc)).toBe(canon('CC(=O)[O-]'));
    expect([...doc.atoms.values()].filter((a) => a.charge).map((a) => [a.z, a.charge])).toEqual([[8, -1]]);
  });

  it('puts a sulfonate\'s charge on oxygen: SO3 with a − expands as CS(=O)(=O)[O-]', () => {
    const { doc } = labelled('SO3', -1);
    expect(smilesOf(doc)).toBe(canon('CS(=O)(=O)[O-]'));
  });

  it('keeps an alkoxide\'s charge where it is: O with a − is CH3O−', () => {
    const { doc } = labelled('O', -1);
    expect(smilesOf(doc)).toBe(canon('C[O-]'));
  });

  it('a label drawn out in place keeps its own charge: NMe with a + between two carbons is the ammonium R2NHMe+', () => {
    const doc = new Doc();
    const x = doc.edit('a', () => {
      const c1 = doc.addAtom(-30, 0), c2 = doc.addAtom(30, 0), x = doc.addAtom(0, 20, 6, { label: 'NMe', charge: 1 });
      doc.addBond(c1.id, x.id); doc.addBond(c2.id, x.id);
      return x.id;
    });
    const smi = inPlaceSmiles(doc, doc.atoms.get(x)!)!;
    expect(smi).not.toBeNull();
    doc.edit('Expand', () => expandInPlace(doc, x, layout(smi)));
    expect(doc.atoms.get(x)!.charge).toBe(1);
    expect(smilesOf(doc)).toBe(canon('C[NH+](C)C'));
  });

  it('a label drawn out in place keeps its isotopes: NCD3 between two carbons has three deuterium atoms', () => {
    const doc = new Doc();
    const x = doc.edit('a', () => {
      const c1 = doc.addAtom(-30, 0), c2 = doc.addAtom(30, 0), x = doc.addAtom(0, 20, 6, { label: 'NCD3' });
      doc.addBond(c1.id, x.id); doc.addBond(c2.id, x.id);
      return x.id;
    });
    const smi = inPlaceSmiles(doc, doc.atoms.get(x)!);
    expect(smi).not.toBeNull();
    doc.edit('Expand', () => expandInPlace(doc, x, layout(smi!)));
    const d = [...doc.atoms.values()].filter((a) => a.z === 1);
    expect(d).toHaveLength(3);
    for (const a of d) expect(a.isotope).toBe(2);
  });
});
