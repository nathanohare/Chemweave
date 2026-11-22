// Doc.contentsKey: async commands check it to know the drawing they started on is still the one
// showing (G4-04, G4-05). It changes when another drawing is swapped in (a tab, slide or Draw
// window), comes back with the drawing, and stays the same through ordinary edits.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';

describe('Doc.contentsKey', () => {
  it('follows the drawing through swaps, not edits', () => {
    const shown = new Doc(), other = new Doc();
    const first = shown.contentsKey;
    shown.edit('add', () => shown.addAtom(0, 0, 6));
    expect(shown.contentsKey).toBe(first);
    // another tab comes up: its drawing is swapped in
    shown.swap(other);
    expect(shown.contentsKey).not.toBe(first);
    expect(other.contentsKey).toBe(first);
    // and back again
    shown.swap(other);
    expect(shown.contentsKey).toBe(first);
    expect(shown.atoms.size).toBe(1);
  });
});
