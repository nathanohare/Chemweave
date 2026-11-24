// The speed check on pull requests (scripts/bench-gate.mjs): besides the 40% step against the base
// branch, each measure in BUDGETS has an absolute budget (standing rule R6).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error (a plain JavaScript module of the scripts)
import { BUDGETS, overBudget } from '../scripts/bench-gate.mjs';

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
