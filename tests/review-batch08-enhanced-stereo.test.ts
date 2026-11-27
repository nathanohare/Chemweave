// Review batch 08, F404: a stereocentre that carries a text label (a sulfoxide's S typed as a
// label) keeps its enhanced stereo group when saved as a molfile. CTfile formats (BIOVIA, 2020):
// enhanced stereo groups are V3000 collections, MDLV30/STERACn for an "and" group.
import { describe, expect, it } from 'vitest';
import { writeMolFile } from '../src/io/chem-formats';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';

const L = ACS_1996.bondLength;

describe('enhanced stereo on a labelled centre', () => {
  it('writes the and group of a labelled sulfoxide S', () => {
    const d = new Doc();
    d.style = { ...ACS_1996 };
    d.bulk(() => {
      // ethyl methyl sulfoxide, the S drawn as a label, with a wedge to its methyl
      const me = d.addAtom(0, 0), s = d.addAtom(L, 0, 16, { label: 'S', enhStereo: { type: 'and', group: 1 } });
      const o = d.addAtom(L, -L, 8), c1 = d.addAtom(2 * L, 0.5 * L), c2 = d.addAtom(3 * L, 0);
      d.addBond(s.id, me.id, 1, 'wedge'); d.addBond(s.id, o.id, 2); d.addBond(s.id, c1.id); d.addBond(c1.id, c2.id);
    });
    const mol = writeMolFile(d).text;
    expect(mol).toMatch(/MDLV30\/STERAC1 ATOMS=\(1 \d+\)/);
  });
});
