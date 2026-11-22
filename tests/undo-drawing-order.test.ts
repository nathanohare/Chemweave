// Undo audit, Canvas and slides (review round 2, finding 8): undoing a delete puts the objects
// back where they were in the drawing's order (the order files are written in, and overlapping
// text, arrows and structures are drawn in), so the drawing is exactly as it was.
import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';

function sample(): Doc {
  const d = new Doc();
  d.edit('Draw', () => {
    const a = [0, 1, 2, 3].map((i) => d.addAtom(i * 20, 0).id);
    for (let i = 0; i < 3; i++) d.addBond(a[i], a[i + 1]);
    for (const t of ['first', 'second', 'third']) d.addCaption({ x: 0, y: 40, text: t } as never);
  });
  return d;
}

const json = (d: Doc) => JSON.stringify(d.contents());

describe('Undo keeps the drawing order', () => {
  it('deleting atoms and text in the middle, then undoing, gives the very same drawing', () => {
    const d = sample();
    const before = json(d);
    const atoms = [...d.atoms.keys()], caps = [...d.captions.keys()];
    d.edit('Delete', () => {
      d.removeAtom(atoms[1]);
      d.removeCaption(caps[1]);
    });
    const after = json(d);
    expect(after).not.toBe(before);
    d.undo();
    expect(json(d)).toBe(before);
    expect([...d.atoms.keys()]).toEqual(atoms);
    expect([...d.captions.keys()]).toEqual(caps);
    d.redo();
    expect(json(d)).toBe(after);
    d.undo();
    expect(json(d)).toBe(before);
  });

  it('things added after the undone delete keep their place at the end', () => {
    const d = sample();
    const caps = [...d.captions.keys()];
    d.edit('Delete', () => d.removeCaption(caps[0]));
    d.undo();
    let added = 0;
    d.edit('Add', () => { added = d.addCaption({ x: 0, y: 80, text: 'fourth' } as never).id; });
    expect([...d.captions.keys()]).toEqual([...caps, added]);
  });
});
