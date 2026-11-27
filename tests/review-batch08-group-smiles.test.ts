// Review batch 08, F047 and F399: a selection made into a group (Contract Label, Define Nickname)
// must be one piece, and an aromatic (order 1.5) bond joining it counts as one bond to its first
// atom when the hydrogens of a bracketed atom are written.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { selectedGroup } from '../src/chem/group-smiles';

describe('selectedGroup', () => {
  it('refuses a selection in two pieces (a phenyl and a separate Cl)', () => {
    const doc = new Doc();
    const ids = doc.edit('d', () => {
      const c = doc.addAtom(0, 0), ph = doc.addAtom(14, 0, 6, { label: 'Ph' }), cl = doc.addAtom(60, 30, 17);
      doc.addBond(c.id, ph.id, 1);
      return { ph: ph.id, cl: cl.id };
    });
    const g = selectedGroup(doc, [ids.ph, ids.cl]);
    expect('error' in g).toBe(true);
    // the phenyl alone is one group
    expect('smiles' in selectedGroup(doc, [ids.ph])).toBe(true);
  });

  it('counts an aromatic join as one bond: a 13C methyl is [13CH3]', () => {
    // a carbon-13 methyl has three hydrogens when it makes one bond (CH3, valence 4)
    const doc = new Doc();
    const m = doc.edit('d', () => {
      const ring = doc.addAtom(0, 0), me = doc.addAtom(14, 0, 6, { isotope: 13 });
      doc.addBond(ring.id, me.id, 1.5);
      return me.id;
    });
    const g = selectedGroup(doc, [m]);
    expect('smiles' in g && g.smiles).toBe('[13CH3]');
  });
});
