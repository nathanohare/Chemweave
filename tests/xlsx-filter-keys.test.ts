// A filter moved with the grid (or kept where it was) comes back with its range's keys in one
// order, so Chemweave's own part in the file is the same on every save (F-X-008: the second save
// wrote r1, c1, c2, r2 where the first wrote r1, c1, r2, c2).

import { describe, it, expect } from 'vitest';
import { moveFilter, STILL } from '../src/io/xlsx-relocate';

describe('a filter\'s range through a save (F-X-008)', () => {
  it('keeps its keys in a range\'s own order', () => {
    const moved = moveFilter({ range: { r1: 0, c1: 1, r2: 5, c2: 3 }, conditions: {} }, STILL)!;
    expect(JSON.stringify(moved.range)).toBe('{"r1":0,"c1":1,"r2":5,"c2":3}');
  });
});
