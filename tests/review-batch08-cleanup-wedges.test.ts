// @vitest-environment jsdom
// Review batch 08, F043: Clean Up Structure keeps a stereocentre drawn with a hollow wedge (read
// as a wedge: toward the viewer) as it keeps one drawn with a plain wedge, and a wavy wedge's
// centre keeps the order of its neighbours.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { addMolfile } from '../src/io/chem-formats';
import { cleanUpOptions, cleanUpWays, turnOption } from '../src/chem/cleanup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

// L-alanine, PubChem CID 5950 (isomeric SMILES as PubChem lists it)
const L_ALANINE = 'C[C@@H](C(=O)O)N';

function pasted(smi: string): Doc {
  const m = RDKit.get_mol(smi);
  m.set_new_coords(true);
  const doc = new Doc();
  doc.bulk(() => addMolfile(doc, m.get_molblock(), 200, 200));
  m.delete();
  return doc;
}
const smilesOf = (doc: Doc) => {
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try { return m.get_smiles(); } finally { m.delete(); }
};
const canonical = (smi: string) => { const m = RDKit.get_mol(smi); try { return m.get_smiles(); } finally { m.delete(); } };
/** The same drawing with every plain wedge drawn as a hollow wedge. */
const hollow = (doc: Doc) => doc.bulk(() => { for (const b of [...doc.bonds.values()]) if (b.display === 'wedge') doc.updateBond(b.id, { display: 'hollowWedge' }); });

describe('Clean Up with hollow wedges', () => {
  it('a hollow wedge is read as a wedge (the structure is still L-alanine)', () => {
    const doc = pasted(L_ALANINE);
    hollow(doc);
    expect([...doc.bonds.values()].some((b) => b.display === 'hollowWedge')).toBe(true);
    expect(smilesOf(doc)).toBe(canonical(L_ALANINE));
  });

  it('flipping a layout turns a hollow wedge over, so the molecule stays the same', () => {
    const doc = pasted(L_ALANINE);
    hollow(doc);
    const o = cleanUpOptions(doc, doc.fragments()[0])[0];
    const flipped = turnOption(o, 0, true);
    doc.bulk(() => {
      for (const [id, p] of flipped.pos) doc.updateAtom(id, { x: p.x, y: p.y });
      for (const [id, d] of flipped.displays) doc.updateBond(id, { display: d });
    });
    expect(smilesOf(doc)).toBe(canonical(L_ALANINE));
  });

  it('a stereocentre whose neighbours are drawn crowded keeps its configuration', () => {
    // the three bonds round the stereocentre squeezed into a fan on one side, in an order that
    // Clean Up would otherwise rearrange
    for (let turn = 0; turn < 12; turn++) {
      const doc = pasted(L_ALANINE);
      hollow(doc);
      const centre = [...doc.atoms.values()].find((a) => (doc.adj.get(a.id) ?? []).length === 3 && a.z === 6)!;
      const nbrs = (doc.adj.get(centre.id) ?? []).map((bid) => { const b = doc.bonds.get(bid)!; return b.a1 === centre.id ? b.a2 : b.a1; });
      const L = doc.style.bondLength;
      doc.bulk(() => nbrs.forEach((id, k) => {
        const a = doc.atoms.get(id)!;
        const t = (turn * 30 + [0, 40, 80][k] * (turn % 2 ? 1 : -1)) * Math.PI / 180;
        const dx = centre.x + Math.cos(t) * L - a.x, dy = centre.y + Math.sin(t) * L - a.y;
        // the atom moves with everything beyond it (the carboxyl's oxygens)
        doc.updateAtom(id, { x: a.x + dx, y: a.y + dy });
        for (const bid of doc.adj.get(id) ?? []) {
          const b = doc.bonds.get(bid)!;
          const o = b.a1 === id ? b.a2 : b.a1;
          if (o === centre.id) continue;
          const oa = doc.atoms.get(o)!;
          doc.updateAtom(o, { x: oa.x + dx, y: oa.y + dy });
        }
      }));
      // what the drawing now says (moving the bonds round may have changed the configuration)
      const want = smilesOf(doc);
      const w = cleanUpWays(doc, doc.fragments()[0])[0];
      doc.bulk(() => {
        for (const [id, p] of w.moves) doc.updateAtom(id, { x: p.x, y: p.y });
        for (const [id, d] of w.displays) doc.updateBond(id, { display: d });
      });
      expect(smilesOf(doc), `turn ${turn}`).toBe(want);
    }
  });
});
