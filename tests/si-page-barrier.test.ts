import { describe, expect, it } from 'vitest';
import { BARRIER_ARRIVE_MS, BARRIER_PUSH, BARRIER_REARM_MS, freshBarrier, neighbourPage, pushBarrier, wheelPixels } from '../src/si/page-barrier';

/** Steady wheel notches (equal sizes, `gap` ms apart) at the page's edge, from `t0`: the time the barrier let them through, or null. */
function notches(s: ReturnType<typeof freshBarrier>, n: number, size: number, gap: number, t0 = 1000): number | null {
  for (let i = 0; i < n; i++) {
    const t = t0 + i * gap;
    if (pushBarrier(s, size, t, true, true)?.through) return t;
  }
  return null;
}

describe('SI page soft barrier', () => {
  it('lets a steady push through, but not the first scrolls that reach the edge', () => {
    const s = freshBarrier();
    const at = notches(s, 30, 100, 90);
    expect(at).not.toBeNull();
    // (the scrolls in the first moments at the edge never count)
    expect(at! - 1000).toBeGreaterThanOrEqual(BARRIER_ARRIVE_MS);
    // (more than the push alone: some is let go of between notches)
    expect(at! - 1000).toBeGreaterThan(((BARRIER_PUSH / 100) - 1) * 90);
  });

  it('never lets a fling dying away through (each scroll smaller than the last)', () => {
    const s = freshBarrier();
    let d = 120, through = false;
    for (let t = 0; t < 3000 && d >= 1; t += 16, d *= 0.96) through ||= !!pushBarrier(s, d, 1000 + t, true, true)?.through;
    expect(through).toBe(false);
  });

  it('never lets a slow trickle through', () => {
    const s = freshBarrier();
    // 10 px every 120 ms is about 83 px a second, less than is let go of
    expect(notches(s, 100, 10, 120)).toBeNull();
  });

  it('opens one page per push: shut until the scrolling stops for a moment', () => {
    const s = freshBarrier();
    const first = notches(s, 30, 100, 60);
    expect(first).not.toBeNull();
    // the same spin goes on: never through again
    expect(notches(s, 40, 100, 60, first! + 60)).toBeNull();
    // stopped, then a new push: through again
    expect(notches(s, 30, 100, 60, first! + 60 + 39 * 60 + BARRIER_REARM_MS + 10)).not.toBeNull();
  });

  it('is not met away from the edge, with no page beyond, or when the way changes', () => {
    const s = freshBarrier();
    expect(pushBarrier(s, 100, 0, false, true)).toBeNull();
    expect(pushBarrier(s, 100, 10, true, false)).toBeNull();
    notches(s, 3, 100, 90, 100);
    const up = pushBarrier(s, -100, 500, true, true);
    // (the other way starts again from nothing)
    expect(up).toEqual({ progress: 0, through: false });
  });

  it('finds the page before and after, and none past either end', () => {
    const order = ['project', 'compound:a', 'compound:b'];
    const id = (x: string): string => x;
    expect(neighbourPage(order, id, 'compound:a', 1)).toBe('compound:b');
    expect(neighbourPage(order, id, 'compound:a', -1)).toBe('project');
    expect(neighbourPage(order, id, 'compound:b', 1)).toBeNull();
    expect(neighbourPage(order, id, 'project', -1)).toBeNull();
    expect(neighbourPage(order, id, 'dashboard', 1)).toBeNull();
  });

  it('turns lines and pages of a wheel into pixels', () => {
    expect(wheelPixels(3, 0, 800)).toBe(3);
    expect(wheelPixels(3, 1, 800)).toBe(48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});

describe('SI page soft barrier: devices that round', () => {
  it('never lets a slow fling with whole-pixel steps through (equal steps one after another)', () => {
    const s = freshBarrier();
    let through = false;
    for (let i = 0; i < 300; i++) through ||= !!pushBarrier(s, Math.round(40 * 0.98 ** i), 1000 + i * 16, true, true)?.through;
    expect(through).toBe(false);
  });

  it('still lets a fast spin of a mouse wheel through (equal large notches close together)', () => {
    const s = freshBarrier();
    expect(notches(s, 30, 100, 30)).not.toBeNull();
  });
});

describe('SI Live Preview white space setting', () => {
  it('is shown unless turned off, settings from before it included', async () => {
    const { parseSiPreviewLook } = await import('../src/ui/mode-prefs');
    expect(parseSiPreviewLook({ dim: false, link: 'bracket', custom: 'fill' }).whiteSpace).toBe(true);
    expect(parseSiPreviewLook(null).whiteSpace).toBe(true);
    expect(parseSiPreviewLook({ whiteSpace: false }).whiteSpace).toBe(false);
  });
});
