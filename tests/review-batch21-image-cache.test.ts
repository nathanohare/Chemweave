// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (F885): the decoded-picture cache never lets go of a picture
// drawn in the paint going on, even past its limit, so a page whose pictures together pass it
// doesn't decode, redraw and let go of them round and round; in later paints the oldest go first.

import { it, expect, beforeAll, afterAll } from 'vitest';
import { imageFor, imageCache } from '../src/render/images';

/** Stand-in images: each one made is counted (a picture decoded again). */
let made = 0;
class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor() { made++; }
}
const realImage = globalThis.Image;
const realLimit = imageCache.keepChars;
beforeAll(() => { (globalThis as { Image: unknown }).Image = StubImage; });
afterAll(() => { (globalThis as { Image: unknown }).Image = realImage; imageCache.keepChars = realLimit; });

const nextPaint = () => new Promise((ok) => setTimeout(ok, 0));
const src = (name: string) => `data:image/png;base64,${name.padEnd(1000, 'A')}`;

it('keeps the pictures drawn in this paint past its limit, and lets the oldest go in a later one', async () => {
  // room for one and a half pictures' data
  imageCache.keepChars = 1500;
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(src);
  for (const s of [a, b, c]) imageFor(s);
  expect(made).toBe(3);
  await nextPaint();
  // the next paint finds all three: none was let go while they were on the screen
  for (const s of [a, b, c]) imageFor(s);
  expect(made).toBe(3);
  await nextPaint();
  // a new picture in a later paint: the ones drawn longest ago go
  imageFor(d);
  expect(made).toBe(4);
  imageFor(c);
  expect(made).toBe(4);
  imageFor(a);
  expect(made).toBe(5);
});
