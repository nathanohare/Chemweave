// The drawing's scroll bars: how long the thumbs are and where they sit.

import { describe, it, expect } from 'vitest';
import { thumbFor, scrollRange, clampPan, stopAtEdge, keepInSlide, panEnds, SlideFlip } from '../src/ui/scrollbars';

describe('scroll bars', () => {
  it('make the thumb as long as the part on screen, and put it where that part is', () => {
    // a quarter of the range on screen, at its start, middle and end
    expect(thumbFor([0, 400], [0, 100], 200)).toEqual({ start: 0, size: 50 });
    expect(thumbFor([0, 400], [150, 250], 200)).toEqual({ start: 75, size: 50 });
    expect(thumbFor([0, 400], [300, 400], 200)).toEqual({ start: 150, size: 50 });
  });

  it('keep the thumb big enough to grab', () => {
    expect(thumbFor([0, 100000], [0, 10], 200).size).toBe(24);
  });

  it('cover the drawing with a quarter of a screen of room round it, and what is on screen', () => {
    const r = scrollRange({ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 500, y1: 0, x2: 700, y2: 100 });
    expect(r).toEqual({ x1: -50, y1: -25, x2: 700, y2: 100 });
  });

  it('give somewhere to go when nothing is drawn', () => {
    expect(scrollRange(null, { x1: 0, y1: 0, x2: 100, y2: 80 })).toEqual({ x1: -100, y1: -80, x2: 200, y2: 160 });
  });
});

describe('scrolling stops at the edge', () => {
  it('keeps a scroll inside the ends, but lets a view already past one come back', () => {
    expect(clampPan(0, 50, -10, 20)).toBe(20);
    expect(clampPan(0, -50, -10, 20)).toBe(-10);
    expect(clampPan(40, 60, -10, 20)).toBe(40);
    expect(clampPan(40, 30, -10, 20)).toBe(30);
  });

  it('stops the wheel a quarter of a screen past a big drawing, at any zoom', () => {
    // a 1000 × 600 point drawing in a 400 × 300 px window at 2× (200 × 150 points on screen)
    const big = { x1: 0, y1: 0, x2: 1000, y2: 600 };
    const r = { view: { ox: 0, oy: 0, scale: 2 }, width: 400, height: 300 };
    r.view.oy = -10000;
    stopAtEdge(r, big, { ox: 0, oy: 0 });
    // the top of the screen goes no lower than 600 + 37.5 − 150 points
    expect(r.view.oy).toBe(-975);
    r.view.ox = 10000;
    stopAtEdge(r, big, { ox: 0, oy: -975 });
    // nor further left than 50 points before the drawing
    expect(r.view.ox).toBe(100);
  });

  it('keeps a small drawing on screen', () => {
    const r = { view: { ox: 0, oy: 0, scale: 1 }, width: 400, height: 300 };
    r.view.oy = -10000;
    stopAtEdge(r, { x1: 100, y1: 100, x2: 150, y2: 150 }, { ox: 0, oy: 0 });
    // scrolling down stops with the drawing's top a quarter of the window (75 points) below the window's
    expect(r.view.oy).toBe(-25);
  });

  it('lets an empty drawing scroll freely', () => {
    const r = { view: { ox: -5000, oy: 0, scale: 1 }, width: 400, height: 300 };
    stopAtEdge(r, null, { ox: 0, oy: 0 });
    expect(r.view.ox).toBe(-5000);
  });
});

// Presentation (Nate's findings of 2026-11-23, Presentation 3): a slide scrolls only to its edges
// and a 16 px band past them, and stays in the middle of the window while it fits.
describe('a slide held tight', () => {
  // a 960 × 540 point slide (16:9) with a 16 px band
  const slide = { x1: 0, y1: 0, x2: 960, y2: 540, tight: 16 };

  it('stays centered while it fits the window, however far it is scrolled', () => {
    // at 1×, in a 1200 × 700 px window the slide fits both ways
    const r = { view: { ox: -400, oy: 300, scale: 1 }, width: 1200, height: 700 };
    stopAtEdge(r, slide, { ox: 0, oy: 0 });
    expect(r.view).toEqual({ ox: 120, oy: 80, scale: 1 });
  });

  it('scrolls a zoomed slide to its edge and the band past it, no further', () => {
    // at 2× the slide is 1920 × 1080 px in an 800 × 600 px window
    const r = { view: { ox: 0, oy: -100000, scale: 2 }, width: 800, height: 600 };
    stopAtEdge(r, slide, { ox: 0, oy: 0 });
    // the slide's bottom edge 16 px above the window's
    expect(r.view.oy + 540 * 2).toBe(600 - 16);
    r.view.ox = 100000;
    keepInSlide(r, slide);
    // its left edge 16 px right of the window's
    expect(r.view.ox).toBe(16);
  });

  it('is brought back inside after a zoom left it off center (a view past an end is not kept)', () => {
    const r = { view: { ox: 900, oy: -40, scale: 0.5 }, width: 1200, height: 700 };
    keepInSlide(r, slide);
    expect(r.view).toEqual({ ox: 360, oy: 215, scale: 0.5 });
  });

  it('gives the scroll bars no room past the band, so a fitting slide has none', () => {
    // fitted: the slide and its band are all on screen, so the range is what is on screen
    expect(scrollRange(slide, { x1: -120, y1: -80, x2: 1080, y2: 620 }, 1)).toEqual({ x1: -120, y1: -80, x2: 1080, y2: 620 });
    // zoomed in 2×: the range is the slide and 8 points (16 px) each way
    expect(scrollRange(slide, { x1: 100, y1: 100, x2: 500, y2: 400 }, 2)).toEqual({ x1: -8, y1: -8, x2: 968, y2: 548 });
  });

  it('keeps the drawing loose: content without `tight` scrolls as before', () => {
    // (a quarter of the 400-point window, 100 points, of room: the drawing may sit anywhere from 100 to 200 points into the window)
    expect(panEnds(0, 100, 400)).toEqual([-200, -100]);
    expect(panEnds(0, 100, 400, 10)).toEqual([-150, -150]);
  });
});

// Scroll between slides (Settings ▸ Navigation, Nate's pick 1A of 2026-11-23): PowerPoint's
// Normal view, where the wheel past a slide's edge goes to the next or previous slide.
describe('scrolling past a slide', () => {
  it('goes one slide on for a notch of the wheel, and back for one the other way', () => {
    const f = new SlideFlip();
    expect(f.push(100, 0)).toBe(1);
    expect(f.push(-100, 1000)).toBe(-1);
  });

  it('goes one slide for a whole touchpad swipe, not one per small step', () => {
    const f = new SlideFlip();
    const turns: number[] = [];
    // 40 steps of 10 px, 16 ms apart (a swipe of about two thirds of a second)
    for (let i = 0; i < 40; i++) { const d = f.push(10, i * 16); if (d) turns.push(d); }
    expect(turns).toEqual([1]);
  });

  it('goes on through the slides while the wheel is spun, a slide at a time', () => {
    const f = new SlideFlip();
    let n = 0;
    // a notch every 100 ms for 1.2 s
    for (let i = 0; i <= 12; i++) if (f.push(100, i * 100)) n++;
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(13);
  });

  it('starts afresh after a pause, and when the wheel moved within the slide', () => {
    const f = new SlideFlip();
    expect(f.push(40, 0)).toBe(0);
    // half a notch, then a pause: the next half doesn't add to it
    expect(f.push(40, 1000)).toBe(0);
    f.reset();
    expect(f.push(40, 1010)).toBe(0);
    expect(f.push(40, 1020)).toBe(1);
  });
});
