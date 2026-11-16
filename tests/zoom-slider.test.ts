import { describe, expect, it } from 'vitest';
import { pctToSlider, sliderToPct } from '../src/ui/zoom-slider';

describe('status bar zoom slider', () => {
  it('has 100% in the middle and 10% / 400% at the ends', () => {
    expect(sliderToPct(0)).toBe(10);
    expect(sliderToPct(50)).toBe(100);
    expect(sliderToPct(100)).toBe(400);
    expect(sliderToPct(25)).toBe(55);
    expect(sliderToPct(75)).toBe(250);
  });

  it('goes back and forth between position and zoom', () => {
    for (const v of [0, 10, 33, 50, 61, 99, 100]) expect(pctToSlider(sliderToPct(v))).toBeCloseTo(v, 9);
    for (const p of [10, 50, 76, 100, 150, 400]) expect(sliderToPct(pctToSlider(p))).toBeCloseTo(p, 9);
  });

  it('keeps zooms past either end at that end', () => {
    expect(pctToSlider(5)).toBe(0);
    expect(pctToSlider(800)).toBe(100);
    expect(sliderToPct(-3)).toBe(10);
    expect(sliderToPct(140)).toBe(400);
  });
});
