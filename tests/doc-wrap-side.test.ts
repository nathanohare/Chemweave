// The side of a square-wrapped figure the text goes (Word's wrapText, ECMA-376 Part 1 §20.4.2.17
// wrapSquare and §20.4.3.7 ST_WrapText: bothSides, left, right, largest). A figure with text only
// at its left was saved as "largest" (F-W-021), so Word put the text on the wider side.

import { describe, it, expect } from 'vitest';
import { narrowLine, MIN_BESIDE } from '../src/document/doc-layout';

describe('which side of a figure the text goes (F-W-021)', () => {
  // a figure from 100 to 200 pt across a 468 pt line: 100 pt free at its left, 268 at its right
  const fig = { x1: 100, y1: 0, x2: 200, y2: 50, wrap: 'square' as const };
  it('puts the text on the wider side when it isn\'t said (Word\'s largest)', () => {
    expect(narrowLine([fig], 10, 20, 468)).toEqual({ left: 200, right: 0 });
  });
  it('puts the text at its left only, or its right only, when the figure says so', () => {
    expect(narrowLine([{ ...fig, side: 'left' }], 10, 20, 468)).toEqual({ left: 0, right: 368 });
    expect(narrowLine([{ ...fig, side: 'right' }], 10, 20, 468)).toEqual({ left: 200, right: 0 });
  });
  it('moves the text below the figure when its side has too little room', () => {
    const narrow = { ...fig, x1: MIN_BESIDE - 10, x2: MIN_BESIDE + 90, side: 'left' as const };
    expect(narrowLine([narrow], 10, 20, 468)).toEqual({ left: 0, right: 0, down: 40 });
  });
});
