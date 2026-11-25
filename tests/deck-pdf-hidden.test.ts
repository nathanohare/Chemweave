// A deck's PDF leaves out its hidden slides, as PowerPoint's Save as PDF does.

import { describe, it, expect } from 'vitest';
import { shownSlides } from '../src/deck/deck';

describe("a deck's PDF", () => {
  it('has the slides that are shown, in order', () => {
    expect(shownSlides([{}, { hidden: true }, { hidden: false }, {}])).toEqual([0, 2, 3]);
    expect(shownSlides([{ hidden: true }])).toEqual([]);
    expect(shownSlides([])).toEqual([]);
  });
});
