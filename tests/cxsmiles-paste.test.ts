// @vitest-environment jsdom
//
// Pasted CXSMILES (audit G1-22): a SMILES with its |…| extras is taken as chemistry, and its
// enhanced stereo comes through. The CXSMILES syntax is from ChemAxon's "ChemAxon Extended SMILES
// and SMARTS" documentation: "&1:1" puts atom 1 (counted from 0) in "and" group 1. The molecule is
// butan-2-ol (PubChem CID 6568), whose one stereocentre is C2, atom 1 of C[C@H](O)CC.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { looksLikeChemistry } from '../src/io/clipboard';
import { cxSmiles, cxSmilesLeftOut, isReactionSmiles } from '../src/chem/reaction-io';
import { smilesMolblock } from '../src/chem/smiles-molfile';
import { addMolfile } from '../src/io/chem-formats';
import { Doc } from '../src/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

describe('CXSMILES paste', () => {
  it('takes a SMILES with |…| extras as chemistry, not as text', () => {
    expect(looksLikeChemistry('C[C@H](O)CC |&1:1|')).toBe(true);
    expect(cxSmiles('C[C@H](O)CC |&1:1|')).toEqual({ smiles: 'C[C@H](O)CC', extras: '&1:1' });
    // ordinary text with a space is still text
    expect(looksLikeChemistry('two words')).toBe(false);
    expect(cxSmiles('CCO is ethanol')).toBeNull();
    // a reaction SMILES with extras stays a reaction (its extras dropped by design)
    expect(isReactionSmiles('CC>>CO |$;;$|')).toBe(true);
    expect(cxSmiles('CC>>CO |$;;$|')).toBeNull();
  });

  it('says which extras a drawing has no place for', () => {
    expect(cxSmilesLeftOut('&1:1,(0,0,;1,0,)')).toEqual([]);
    expect(cxSmilesLeftOut('Sg:n:1,2::ht,LN:1:1.3')).toEqual(['S-groups (polymer brackets, data)', 'link nodes']);
  });

  it('keeps the and-group of a CXSMILES through the engine into the drawing', () => {
    const mb = smilesMolblock(RDKit, 'C[C@H](O)CC |&1:1|')!;
    expect(mb).toMatch(/V3000/);
    expect(mb).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 2\)/);
    const d = new Doc();
    d.bulk(() => { addMolfile(d, mb, 0, 0); });
    expect([...d.atoms.values()].filter((a) => a.enhStereo).map((a) => a.enhStereo)).toEqual([{ type: 'and', group: 1 }]);
    // a plain SMILES still gives the usual V2000 molfile
    expect(smilesMolblock(RDKit, 'CCO')).toMatch(/V2000/);
  });
});
