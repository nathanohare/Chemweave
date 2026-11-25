// The Spectrum window's view arithmetic: the range a drag selects, keeping it inside the spectrum,
// moving along, and the intensity steps (wheel, keys, buttons, the left edge).

import { describe, expect, it } from 'vitest';
import { CLICK_PX, clampRange, dragZoom, fullHeight, panRange, PEAK_FRACTION, ppmAt, rangeFromDrag, stepZoom, wheelZoom, Y_ZOOM_MAX, Y_ZOOM_MIN } from '../src/ui/nmr-view';

const full = { hi: 10, lo: 0 };

describe('the range a drag selects', () => {
  it('runs high ppm on the left, low on the right', () => {
    expect(ppmAt(0, 500, full)).toBe(10);
    expect(ppmAt(500, 500, full)).toBe(0);
    expect(ppmAt(250, 500, full)).toBe(5);
  });
  it('takes the two ends whichever way the drag went', () => {
    expect(rangeFromDrag(100, 200, 500, full, 0.05)).toEqual({ hi: 8, lo: 6 });
    expect(rangeFromDrag(200, 100, 500, full, 0.05)).toEqual({ hi: 8, lo: 6 });
  });
  it('treats a short drag as a click', () => {
    expect(rangeFromDrag(100, 100 + CLICK_PX - 1, 500, full, 0.05)).toBeNull();
    expect(rangeFromDrag(100, 100 + CLICK_PX, 500, full, 0.05)).not.toBeNull();
  });
  it('is never narrower than the smallest span, widened about its middle', () => {
    const r = rangeFromDrag(250, 255, 500, full, 1)!;
    expect(r.hi - r.lo).toBeCloseTo(1, 9);
    expect((r.hi + r.lo) / 2).toBeCloseTo(4.95, 9);
  });
  it('stops at the plot edges when the pointer goes past them', () => {
    expect(rangeFromDrag(-50, 100, 500, full, 0.05)).toEqual({ hi: 10, lo: 8 });
  });
});

describe('keeping the view inside the spectrum', () => {
  it('moves a range back in from either end, keeping its width', () => {
    expect(clampRange({ hi: 11, lo: 9 }, full)).toEqual({ hi: 10, lo: 8 });
    expect(clampRange({ hi: 1, lo: -1 }, full)).toEqual({ hi: 2, lo: 0 });
  });
  it('is the full view when as wide as the spectrum', () => {
    expect(clampRange({ hi: 12, lo: -2 }, full)).toBeNull();
    expect(clampRange({ hi: 10, lo: 0 }, full)).toBeNull();
  });
  it('moves along by the dragged distance, toward higher ppm when dragged right', () => {
    expect(panRange({ hi: 6, lo: 4 }, 100, 200, full)).toEqual({ hi: 7, lo: 5 });
    expect(panRange({ hi: 6, lo: 4 }, -100, 200, full)).toEqual({ hi: 5, lo: 3 });
    expect(panRange({ hi: 6, lo: 4 }, 10000, 200, full)).toEqual({ hi: 10, lo: 8 });
  });
});

describe('the intensity', () => {
  it('puts the tallest peak at three quarters of the height, times the zoom', () => {
    expect(PEAK_FRACTION).toBe(0.75);
    expect(3 / fullHeight(3)).toBeCloseTo(0.75, 12);
    expect(3 / fullHeight(3, 2)).toBeCloseTo(1.5, 12);
    expect(fullHeight(0)).toBe(1);
  });
  it('grows when the wheel turns up (negative deltaY) and shrinks when it turns down', () => {
    const up = wheelZoom(1, -100), down = wheelZoom(1, 100);
    expect(up).toBeGreaterThan(1.15);
    expect(up).toBeLessThan(1.25);
    expect(down).toBeCloseTo(1 / up, 9);
  });
  it('reads line and page wheel steps, and a pinch\'s small steps', () => {
    expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48, 0), 9);
    expect(wheelZoom(1, -10, 0, true)).toBeGreaterThan(wheelZoom(1, -10, 0, false));
  });
  it('stays within its limits', () => {
    let y = 1;
    for (let i = 0; i < 500; i++) y = wheelZoom(y, -300);
    expect(y).toBe(Y_ZOOM_MAX);
    for (let i = 0; i < 500; i++) y = stepZoom(y, -1);
    expect(y).toBe(Y_ZOOM_MIN);
    expect(wheelZoom(1, Number.NaN)).toBe(1);
  });
  it('steps by 1.25 with the buttons and keys, and follows a drag on the left edge', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25, 12);
    expect(stepZoom(1, -1)).toBeCloseTo(0.8, 12);
    expect(dragZoom(2, -100)).toBeCloseTo(2 * Math.E, 9);
    expect(dragZoom(2, 0)).toBe(2);
  });
});
