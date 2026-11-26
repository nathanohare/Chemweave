// The UI style guide's rules each have their own number (S1, S2 …): two rules with one number make
// "see S98" in code and reviews point at the wrong rule.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('UI style guide numbers', () => {
  it('gives no two rules the same number', () => {
    const text = readFileSync('docs/ui-style.md', 'utf8');
    const nums = [...text.matchAll(/^\| S(\d+) \|/gm)].map((m) => Number(m[1]));
    expect(nums.length).toBeGreaterThan(50);
    const twice = nums.filter((n, i) => nums.indexOf(n) !== i);
    expect(twice.map((n) => `S${n}`)).toEqual([]);
  });
});
