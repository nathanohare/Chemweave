// Find with a search that starts with an emoji or another character outside the Basic
// Multilingual Plane (a mathematical italic letter, a CJK Extension B character): the search
// stepped one code unit on, into the middle of the character's surrogate pair, where a 'u'
// search starts again at the same character, so it found the same place for ever (the app froze).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { findAll } from '../src/document/find';

afterEach(() => { vi.restoreAllMocks(); });

/** findAll, stopped with an error (not a frozen test run) if it searches far more often than the text is long. */
function findBounded(text: string, q: string, opts = {}): [number, number][] {
  const exec = RegExp.prototype.exec;
  let n = 0;
  vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, s: string) {
    if (++n > 1000) throw new Error('findAll does not end');
    return exec.call(this, s);
  });
  try { return findAll(text, q, opts); } finally { vi.restoreAllMocks(); }
}

describe('Find: astral characters', () => {
  it('finds each emoji once and ends', () => {
    // '😀' (U+1F600) is two UTF-16 code units
    expect(findBounded('a😀b😀', '😀')).toEqual([[1, 3], [4, 6]]);
    expect(findBounded('😀😀x😀', '😀')).toEqual([[0, 2], [2, 4], [5, 7]]);
    expect(findBounded('😀😀x😀', '😀', { matchCase: true })).toEqual([[0, 2], [2, 4], [5, 7]]);
  });

  it('finds a word starting with a mathematical italic letter', () => {
    // U+1D6FF MATHEMATICAL ITALIC SMALL DELTA
    expect(findBounded('\u{1D6FF}H and \u{1D6FF}H', '\u{1D6FF}H')).toEqual([[0, 3], [8, 11]]);
  });

  it('still finds overlapping-start places in plain text', () => {
    expect(findBounded('aaa', 'aa')).toEqual([[0, 2]]);
    expect(findBounded('abab', 'ab')).toEqual([[0, 2], [2, 4]]);
  });
});
