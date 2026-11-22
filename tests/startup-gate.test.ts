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
