// Review batch 08, F057: clearing a hand-typed stereo label goes back to the worked-out label,
// and where the rules can't decide one (an R group sets the order) nothing is left on the drawing.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { atomStereoText, bondStereoText, setStereoText } from '../src/chem/stereo';
import type { StereoInfo } from '../src/model';

const measure = (text: string, size: number) => text.length * size * 0.6;
/** What the stereo engine says when it can't decide any label. */
const undecided: StereoInfo = { atom: () => undefined, bond: () => undefined };

describe('clearing a typed stereo label', () => {
  it('leaves no label on an atom the rules can\'t decide', () => {
    const doc = new Doc();
    const c = doc.edit('d', () => {
      const c = doc.addAtom(0, 0), r = doc.addAtom(14, 0, 0, { label: 'R' }), o = doc.addAtom(-7, 12, 8), n = doc.addAtom(-7, -12, 7);
      doc.addBond(c.id, r.id, 1); doc.addBond(c.id, o.id, 1); doc.addBond(c.id, n.id, 1, 'wedge');
      return c.id;
    });
    doc.edit('type', () => setStereoText(doc, 'a', c, '(R)', measure));
    expect(atomStereoText(doc.atoms.get(c)!, undecided)).toBe('(R)');
    doc.edit('clear', () => setStereoText(doc, 'a', c, '', measure));
    expect(atomStereoText(doc.atoms.get(c)!, undecided)).toBeNull();
    // the worked-out label shows again once there is one
    expect(atomStereoText(doc.atoms.get(c)!, { atom: () => 'S', bond: () => null })).toBe('(S)');
  });

  it('and on a bond', () => {
    const doc = new Doc();
    const b = doc.edit('d', () => {
      const p = doc.addAtom(0, 0), q = doc.addAtom(14, 0);
      return doc.addBond(p.id, q.id, 2).id;
    });
    doc.edit('type', () => setStereoText(doc, 'b', b, '(E)', measure));
    doc.edit('clear', () => setStereoText(doc, 'b', b, '', measure));
    expect(bondStereoText(doc.bonds.get(b)!, undecided)).toBeNull();
  });
});
