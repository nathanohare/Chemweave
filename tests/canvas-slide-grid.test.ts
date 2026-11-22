// View > Gridlines on canvas slides (review round 2, #21): a canvas has no edge, so the grid runs
// across whatever part of it is painted, lined up with the slide's own grid.
import { describe, expect, it } from 'vitest';
import { gridLines, paintedArea, snapMove, defaultView } from '../src/deck/guides';

const size = { w: 960, h: 540 };

describe('gridlines', () => {
  it('on a slide: inside it, none on its edges', () => {
    const g = gridLines(size, 120, 1, null);
    expect(g.xs).toEqual([120, 240, 360, 480, 600, 720, 840]);
    expect(g.ys).toEqual([120, 240, 360, 480]);
    expect(g.area).toEqual({ x1: 0, y1: 0, x2: 960, y2: 540 });
  });

  it('too close to see: every second (fourth…) line', () => {
    const g = gridLines(size, 10, 0.25, null);
    // 10 pt at a quarter scale is 2.5 px: 40 pt apart (10 px) instead
    expect(g.xs[0]).toBe(40);
    expect(g.xs[1]).toBe(80);
  });

  it('on a canvas slide: across the painted part, far off the slide too, on the same lines', () => {
    const g = gridLines(size, 100, 1, { x1: 2950, y1: -1230, x2: 3310, y2: -1010 });
    expect(g.xs).toEqual([3000, 3100, 3200, 3300]);
    expect(g.ys).toEqual([-1200, -1100]);
    // a slide's lines are among a canvas's
    const one = gridLines(size, 100, 1, { x1: 0, y1: 0, x2: 960, y2: 540 });
    expect(one.xs).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
  });

  it('works out the part a scene tile paints from its transform', () => {
    // a 512 px tile at 2× (dpr 1), its corner at (1000, -200) points
    const a = paintedArea({ a: 2, d: 2, e: -2000, f: 400 }, 512, 512)!;
    expect(a.x1).toBeCloseTo(1000);
    expect(a.y1).toBeCloseTo(-200);
    expect(a.x2).toBeCloseTo(1256);
    expect(a.y2).toBeCloseTo(56);
    expect(paintedArea({ a: 0, d: 1, e: 0, f: 0 }, 10, 10)).toBeNull();
  });

  it('snaps to the grid without guides on a canvas slide', () => {
    const v = { ...defaultView(size), grid: 50, snapToGrid: true, showGuides: false };
    const got = snapMove({ x1: 3010, y1: 10, x2: 3060, y2: 60 }, { x: 18, y: 0 }, v, 4);
    expect(got.x).toBeCloseTo(40);
  });
});
