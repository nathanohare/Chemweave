// The redraw check on pull requests (bench/redraw.mjs, scripts/redraw-gate.mjs): dragging in a big
// drawing fails over its budget or when it got more than 40% slower than the base branch.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error a plain JavaScript module of the benchmarks
import { REDRAW_BUDGETS, REDRAW_FLOOR_MS, redrawVerdict } from '../bench/redraw.mjs';

const at = (one: number, many: number) => [{ one, many }, { one: one + 3, many: many + 30 }];

describe('redraw check (standing rule R6)', () => {
  it('passes the same speed on both sides, under the budgets', () => {
    const v = redrawVerdict(at(4, 70), at(4, 70));
    expect(v.fail).toBe(false);
    expect(v.text).toContain('within its budget');
  });

  it('fails a redraw over its budget even when the base branch was as slow', () => {
    const slow = REDRAW_BUDGETS.many + 10;
    const v = redrawVerdict(at(4, slow), at(4, slow));
    expect(v.fail).toBe(true);
    expect(v.text).toContain(`over its ${REDRAW_BUDGETS.many} ms budget`);
  });

  it('fails a redraw 40% slower than the base branch, but not a small difference', () => {
    expect(redrawVerdict(at(4, 60), at(4, 90)).fail).toBe(true);
    // (more than 40%, but under the floor: a few ms of noise on a fast redraw)
    expect(redrawVerdict(at(3, 70), at(3 + REDRAW_FLOOR_MS - 1, 70)).fail).toBe(false);
    // (the fastest run counts, so one slow run on a busy machine doesn't fail it)
    expect(redrawVerdict(at(4, 70), [{ one: 4, many: 72 }, { one: 30, many: 140 }]).fail).toBe(false);
  });

  it('runs on every pull request that changes code', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('node scripts/redraw-gate.mjs http://localhost:4174/ http://localhost:4173/');
  });
});
