// The start-up check on pull requests (scripts/startup-gate.mjs, G4-12): fastest start against
// fastest start, failing only past both 25% and 100 ms.
import { describe, expect, it } from 'vitest';
// @ts-expect-error (a plain JavaScript module of the bench scripts)
import { startupSlower } from '../bench/startup.mjs';

const runs = (...up: number[]) => up.map((u) => ({ up: u, busy: 0, quiet: 0, longest: 0 }));

describe('start-up check', () => {
  it('compares the fastest starts, so one slow start on a busy machine does not count', () => {
    expect(startupSlower(runs(530, 560), runs(540, 2000))).toBe(false);
  });
  it('fails a start-up 40% slower (the 528 → 723 ms regression of November 2026)', () => {
    expect(startupSlower(runs(528, 560), runs(723, 760))).toBe(true);
  });
  it('lets through a small slowdown, and a big percentage of a few milliseconds', () => {
    expect(startupSlower(runs(800), runs(950))).toBe(false);
    expect(startupSlower(runs(100), runs(190))).toBe(false);
  });
});

describe('start-up check: an expected slowdown and a side that does not start (review F4-R16)', () => {
  it('passes a slowdown when the pull request carries the label, and says how to get there', async () => {
    const { startupVerdict, SLOWER_OK_LABEL } = await import('../bench/startup.mjs' as string);
    expect(SLOWER_OK_LABEL).toBe('slower start-up expected');
    const red = startupVerdict(runs(528), runs(723));
    expect(red.fail).toBe(true);
    expect(red.text).toContain('195 ms (37%) longer');
    expect(red.text).toContain('add the label “slower start-up expected”');
    const ok = startupVerdict(runs(528), runs(723), true);
    expect(ok.fail).toBe(false);
    expect(ok.text).toContain('Passed: the pull request has the label');
    expect(startupVerdict(runs(528), runs(540)).fail).toBe(false);
  });
  it('names the side whose app did not start instead of a bare timeout', async () => {
    const { startSide } = await import('../bench/startup.mjs' as string);
    const timeout = async () => { throw new Error('page.waitForFunction: Timeout 60000ms exceeded.\nCall log: …'); };
    await expect(startSide(null, 'base', 'http://localhost:4174/', 0, timeout)).rejects.toThrow(
      'The base branch’s app did not start at http://localhost:4174/ (page.waitForFunction: Timeout 60000ms exceeded.). Build and open it to see why.');
    await expect(startSide(null, 'head', 'http://localhost:4173/', 0, timeout)).rejects.toThrow(/^This pull request’s app did not start/);
    expect(await startSide(null, 'head', 'u', 0, async () => ({ up: 500 }))).toEqual({ up: 500 });
  });
});

describe('start-up budget (standing rule R6)', () => {
  it('fails a start-up over the absolute budget even when the base branch was as slow', async () => {
    const { startupVerdict, STARTUP_BUDGET_MS } = await import('../bench/startup.mjs' as string);
    const slow = STARTUP_BUDGET_MS + 200;
    const v = startupVerdict(runs(slow), runs(slow));
    expect(v.fail).toBe(true);
    expect(v.text).toContain(`over the ${STARTUP_BUDGET_MS} ms budget`);
    expect(startupVerdict(runs(slow), runs(slow), true).fail).toBe(false);
    expect(startupVerdict(runs(STARTUP_BUDGET_MS - 10), runs(STARTUP_BUDGET_MS - 5)).fail).toBe(false);
  });
});
