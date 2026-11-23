// @vitest-environment jsdom
//
// Fix phase F8a, item 6 (F7b Needs Nate 1): an RXN file from any program keeps its molecules where
// they stand; it is laid out afresh only when it gives no usable places (every atom at 0, 0, or
// molecules on top of one another). Files typed here in BIOVIA's RXN V2000 layout (CTfile
// Formats: $RXN, header, counts, then each $MOL); chemistry: methanol CO (PubChem CID 887) to
// formaldehyde C=O (PubChem CID 712).

import { describe, it, expect } from 'vitest';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';

/** A two-atom molfile with its atoms at (x, y) and (x + 1.5, y), bond order `order`. */
const mol = (x: number, y: number, order: number, el = 'O') => `\n  OtherPrg\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n`
  + `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n`
  + `${(x + (order ? 1.5 : 0)).toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}    0.0000 ${el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0\n`
  + `  1  2  ${order || 1}  0\nM  END\n`;
const rxn = (a: string, b: string) => `$RXN\n\n      OtherProg\n\n  1  1\n$MOL\n${a}$MOL\n${b}`;
const open = (text: string) => sceneToDoc(readScene('rxn', text)!, ACS_1996).doc;
/** The starting material's and the product's first atoms, in bond lengths, the product's relative to the starting material's. */
function placed(text: string): { dx: number; dy: number; arrows: number } {
  const d = open(text);
  const atoms = [...d.atoms.values()];
  const L = ACS_1996.bondLength;
  return { dx: Math.round((atoms[2].x - atoms[0].x) / L * 10) / 10, dy: Math.round((atoms[2].y - atoms[0].y) / L * 10) / 10, arrows: d.arrows.size };
}

describe('RXN files from other programs', () => {
  it('keep molecules standing in a row where they are, with an arrow between', () => {
    expect(placed(rxn(mol(0, 0, 1), mol(8, 0, 2)))).toEqual({ dx: 5.3, dy: 0, arrows: 1 }) // (8 units at a bond of 1.5);
  });
  it('keep molecules standing elsewhere (the product above) where they are too', () => {
    // (y grows upwards in a molfile and downwards in the drawing)
    expect(placed(rxn(mol(0, 0, 1), mol(0, 6, 2)))).toEqual({ dx: 0, dy: -4, arrows: 1 }) // (6 units at a bond of 1.5);
  });
  it('are laid out afresh when every atom is at 0, 0', () => {
    const p = placed(rxn(mol(0, 0, 0), mol(0, 0, 0)));
    expect(p.dx).toBeGreaterThan(1.5);
    expect(p.dy).toBe(0);
  });
  it('are laid out afresh when the molecules overlap', () => {
    const p = placed(rxn(mol(0, 0, 1), mol(0.5, 0, 2)));
    expect(p.dx).toBeGreaterThan(1.5);
  });
});

describe('RXN files from other programs, laid out on a slant', () => {
  it('keep the product above and to the right where it is, and the arrow\'s step finds both (review F8a-R11)', () => {
    const d = open(rxn(mol(0, 0, 1), mol(8, 5, 2)));
    const r = [...d.arrows.values()][0];
    expect(r.step?.reactants).toHaveLength(1);
    expect(r.step?.products).toHaveLength(1);
    expect(placed(rxn(mol(0, 0, 1), mol(8, 5, 2)))).toEqual({ dx: 5.3, dy: -3.3, arrows: 1 }); // (8 and 5 units at a bond of 1.5)
  });
});
