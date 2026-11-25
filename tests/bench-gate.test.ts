// The speed check on pull requests (scripts/bench-gate.mjs): besides the 40% step against the base
// branch, each measure in BUDGETS has an absolute budget (standing rule R6).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error (a plain JavaScript module of the scripts)
import { BUDGETS, STEP_LIMITS, overBudget, slowerThanBase } from '../scripts/bench-gate.mjs';

describe('speed budgets', () => {
  it('fails a measure over its budget, and one whose measure is gone', () => {
    const k = Object.keys(BUDGETS)[0];
    const head = Object.fromEntries(Object.entries(BUDGETS as Record<string, number>).map(([m, b]) => [m, b / 2]));
    expect(overBudget(head)).toEqual([]);
    expect(overBudget({ ...head, [k]: BUDGETS[k] + 1 })).toEqual([{ k, now: BUDGETS[k] + 1, budget: BUDGETS[k] }]);
    const { [k]: _, ...gone } = head;
    expect(overBudget(gone)).toEqual([{ k, now: undefined, budget: BUDGETS[k] }]);
  });

  it('names only measures that bench/core.bench.ts has', () => {
    const src = readFileSync('bench/core.bench.ts', 'utf8');
    const missing = Object.keys(BUDGETS).filter((k) => {
      const [group, name] = k.split(' / ');
      return !src.includes(`describe('${group}'`) || !src.includes(`bench('${name}'`);
    });
    expect(missing, 'budgets in scripts/bench-gate.mjs BUDGETS with no measure of that name').toEqual([]);
  });

  it('gives every measure of bench/core.bench.ts a budget', () => {
    // (a measure without one could double over a few pull requests, each under the 40% step)
    const measures: string[] = [];
    let group = '';
    for (const line of readFileSync('bench/core.bench.ts', 'utf8').split('\n')) {
      const d = line.match(/^describe\('([^']+)'/);
      if (d) group = d[1];
      const b = line.match(/^\s*bench\('([^']+)'/);
      if (b) measures.push(`${group} / ${b[1]}`);
    }
    // (every bench( call was read: one written another way, such as bench("…") or bench.skip(, would be missed above)
    const calls = readFileSync('bench/core.bench.ts', 'utf8').match(/\bbench(\.\w+)?\(/g) ?? [];
    expect(measures.length).toBe(calls.length);
    expect(measures.filter((k) => !(k in BUDGETS)), 'add these to BUDGETS in scripts/bench-gate.mjs (about 1.8 times the Checks time)').toEqual([]);
  });
});

describe('the step between the base branch and a pull request', () => {
  it('fails a measure more than 40% slower, ignoring under 10 ms', () => {
    expect(slowerThanBase('drawing (1,000 rings, 6,000 atoms) / open CDXML', 300, 430)).toBe(true);
    expect(slowerThanBase('drawing (1,000 rings, 6,000 atoms) / open CDXML', 300, 410)).toBe(false);
    expect(slowerThanBase('x', 2, 5)).toBe(false);
  });

  it('gives the two-speed .pptx save a higher step, and only that measure', () => {
    const k = 'slides (100 slides) / save .pptx';
    expect(Object.keys(STEP_LIMITS)).toEqual([k]);
    expect(slowerThanBase(k, 320, 640)).toBe(false); // the usual flip between its two speeds
    expect(slowerThanBase(k, 320, 900)).toBe(true);
    expect(k in BUDGETS).toBe(true); // a real slowdown still meets the budget
  });
});
