// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (Picture Format): how the pictures worked out for the screen
// are kept. Remove Background and sharpening are worked out once, the quick settings on a copy of
// that (F205); a picture is worked at about the pixels it is drawn at (F203); many pictures shown
// together are not let go in the middle of a paint (F899); what is kept is counted in pixels, the
// picture used last kept longest (F900); and a version used again is the last forgotten (F901).
// The browser's canvas is stood in for by one that only counts what is drawn.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/** Stand-in pictures, by their data. */
const pictures = new Map<string, { width: number; height: number; naturalWidth: number; naturalHeight: number }>();
vi.mock('../src/render/images', async (orig) => ({
  ...(await orig<typeof import('../src/render/images')>()),
  imageFor: (src: string) => pictures.get(src) ?? null,
}));

import { fxCanvas, fxSideFor } from '../src/render/picture-fx';

/** How many times each stand-in picture was drawn onto a canvas (worked from its own data). */
const drawnFrom = new Map<object, number>();
let canvases = 0;
const realCreate = document.createElement.bind(document);
let restore: (() => void) | null = null;

beforeAll(() => {
  const ctx = () => ({
    drawImage: (img: object) => drawnFrom.set(img, (drawnFrom.get(img) ?? 0) + 1),
    // (a few pixels stand for the picture: only how often it is worked out is looked at)
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
    putImageData: () => undefined,
    beginPath: () => undefined, fill: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    bezierCurveTo: () => undefined, closePath: () => undefined,
  });
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'canvas') { canvases++; Object.assign(el, { getContext: ctx }); }
    return el;
  }) as typeof document.createElement);
  restore = () => spy.mockRestore();
});
afterAll(() => restore?.());

const picture = (src: string, w = 10, h = 10) => {
  const img = { width: w, height: h, naturalWidth: w, naturalHeight: h };
  pictures.set(src, img);
  return img;
};
/** The paint going on ends (the next code runs in a new one). */
const nextPaint = () => new Promise((ok) => setTimeout(ok, 0));

describe('pictures worked out for the screen', () => {
  it('works Remove Background out once, and only the quick settings again as a slider moves (F205)', async () => {
    const img = picture('data:image/png;base64,F205');
    for (const bright of [0.1, 0.2, 0.3, 0.4]) {
      expect(fxCanvas({ src: 'data:image/png;base64,F205', fx: { bg: {}, bright } })).not.toBeNull();
      await nextPaint();
    }
    // the picture's own data was drawn once, into the copy with its background taken out
    expect(drawnFrom.get(img)).toBe(1);
  });

  it('works a big picture at about the pixels it is drawn at, at full size for exports (F203)', () => {
    picture('data:image/png;base64,F203', 4000, 3000);
    const p = { src: 'data:image/png;base64,F203', fx: { bright: 0.2 } };
    // drawn 1,000 pixels across: worked 1,024 across
    expect([fxCanvas(p, 1000)!.width, fxCanvas(p, 1000)!.height]).toEqual([1024, 768]);
    // not said (or drawn bigger than the picture): its own size
    expect(fxCanvas(p)!.width).toBe(4000);
    expect(fxCanvas(p, 9000)!.width).toBe(4000);
    // a crop to a fifth of the width, drawn 500 across, needs 2,500 across of the whole picture
    expect(fxSideFor(500, 100, 1, { l: 0.4, t: 0, r: 0.4, b: 0 })).toBeCloseTo(2500, 6);
    // at twice the pixels (a high-resolution screen, a zoom)
    expect(fxSideFor(300, 200, 2)).toBe(600);
  });

  it('keeps one copy of a small picture whatever size it is asked for, and one of a picture with only Remove Background (F900, F205)', () => {
    picture('data:image/png;base64,F900-small', 300, 200);
    const p = { src: 'data:image/png;base64,F900-small', fx: { bright: 0.2 } };
    expect(fxCanvas(p, 500)).toBe(fxCanvas(p));
    picture('data:image/png;base64,F205-only', 30, 20);
    const before = canvases;
    fxCanvas({ src: 'data:image/png;base64,F205-only', fx: { bg: {} } });
    expect(canvases).toBe(before + 1);
  });

  it('keeps thirty pictures shown together from one paint to the next (F899)', async () => {
    const srcs = Array.from({ length: 30 }, (_, i) => `data:image/png;base64,F899-${i}`);
    srcs.forEach((s) => picture(s));
    for (const src of srcs) fxCanvas({ src, fx: { recolor: { kind: 'grey' } } });
    await nextPaint();
    const before = canvases;
    for (const src of srcs) fxCanvas({ src, fx: { recolor: { kind: 'grey' } } });
    expect(canvases).toBe(before);
  });

  it('keeps what they take in pixels under a limit, letting the picture used longest ago go (F900)', async () => {
    // twenty photos, each 2048 × 2048 on the screen: 84 million pixels in all, more than is kept
    const srcs = Array.from({ length: 20 }, (_, i) => `data:image/png;base64,F900-${i}`);
    srcs.forEach((s) => picture(s, 4096, 4096));
    for (const src of srcs) { fxCanvas({ src, fx: { bright: 0.1 } }, 2000); await nextPaint(); }
    // the last one is kept; the first had to go
    let before = canvases;
    fxCanvas({ src: srcs[19], fx: { bright: 0.1 } }, 2000);
    expect(canvases).toBe(before);
    await nextPaint();
    before = canvases;
    fxCanvas({ src: srcs[0], fx: { bright: 0.1 } }, 2000);
    expect(canvases).toBe(before + 1);
  });

  it('forgets the version of a picture used longest ago, not the one made first (F901)', async () => {
    const src = 'data:image/png;base64,F901';
    picture(src);
    const show = async (bright: number) => { fxCanvas({ src, fx: { bright } }); await nextPaint(); };
    for (const b of [0.1, 0.2, 0.3, 0.4, 0.5]) await show(b);
    await show(0.2);
    await show(0.6);
    await show(0.7);
    const before = canvases;
    await show(0.2);
    expect(canvases).toBe(before);
  });
});
