// @vitest-environment jsdom
//
// Fix phase F8a, item 4 (F1 Needs Nate 8): a copied reaction scheme's text form is a reaction
// SMILES (reactants>agents>products; Daylight Theory Manual, "Reaction SMILES"), not the dotted
// SMILES of its structures; a plain structure keeps the dotted form.
// Values: ethanol CCO (PubChem CID 702) to acetaldehyde CC=O (PubChem CID 177), DMSO CS(C)=O
// (PubChem CID 679) over the arrow, as RDKit writes their canonical SMILES.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { reactionSmilesOf, setSmilesMaker } from '../src/io/clipboard';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
  setSmilesMaker(async (mb) => { const m = RDKit.get_mol(mb); try { return m ? m.get_smiles() : null; } finally { m?.delete(); } });
});
afterAll(() => setSmilesMaker(null));

const L = ACS_1996.bondLength;
/** Ethanol (or acetaldehyde, with `double`) at x: C–C–O. */
function c2o(d: Doc, x: number, double = false) {
  const a = d.addAtom(x, 0), b = d.addAtom(x + L * 0.87, -L / 2), o = d.addAtom(x + L * 1.73, 0, 8);
  d.addBond(a.id, b.id); d.addBond(b.id, o.id, double ? 2 : 1);
}
const arrow = (d: Doc, x1: number, x2: number) => d.addArrow({ tail: { x: x1, y: -L / 4 }, head: { x: x2, y: -L / 4 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 });

describe('the clipboard text of a reaction scheme', () => {
  it('is a reaction SMILES, the reagent over the arrow as an agent', async () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.edit('build', () => {
      c2o(d, 0);
      arrow(d, 3 * L, 7 * L);
      d.addCaption({ x: 4.2 * L, y: -L, runs: [{ text: 'DMSO' }], justify: 'left' });
      c2o(d, 9 * L, true);
    });
    expect(await reactionSmilesOf(d)).toBe('CCO>CS(C)=O>CC=O');
  });
  it('is nothing for a drawing with no arrow, so the dotted SMILES goes instead', async () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.edit('build', () => { c2o(d, 0); c2o(d, 5 * L, true); });
    expect(await reactionSmilesOf(d)).toBeNull();
  });
});
