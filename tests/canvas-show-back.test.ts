// @vitest-environment jsdom
// Going back on a canvas slide in the slide show (review round 2, #20): the click undone plays
// backwards, so the view glides back to the keyframe it came from instead of jumping there; a
// normal slide still goes back at once, as in PowerPoint.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/deck/slide-view', async (orig) => ({
  ...(await orig<typeof import('../src/deck/slide-view')>()),
  paintSlide: (c: HTMLCanvasElement, w: number, h: number, dpr: number, p: { size: { w: number; h: number } }) => {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const k = Math.min(w / p.size.w, h / p.size.h);
    return { x: (w - p.size.w * k) / 2, y: (h - p.size.h * k) / 2, k };
  },
  drawDrawing: () => undefined,
  drawCanvasUnder: () => undefined,
  drawScreen: () => undefined,
  drawKeyTitle: () => undefined,
}));

import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { Player } from '../src/deck/playback';

const noop = () => undefined;
const ctx = new Proxy({}, { get: () => noop, set: () => true });
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

/** A deck whose second slide is a canvas with two keyframes (so one keyframe move, on a click). */
function canvasShow() {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  d.addCanvasSlide();
  const c = d.slides[1].canvas!;
  d.setCanvas({ ...c, keys: [...c.keys, { id: 2, x: 2000, y: 0, zoom: 1 }] }, 'Add keyframe', 1);
  const doc = d.docOf(1);
  doc.edit('a', () => { doc.addAtom(100, 100); doc.addAtom(2600, 300); });
  const p = new Player(document.createElement('canvas'), d);
  p.resize(1600, 900, 1);
  return { d, p };
}

type Move = { from: number; to: number; p: number };

afterEach(() => vi.useRealTimers());

describe('going back on a canvas slide in the show', () => {
  it('glides the view back to the keyframe it came from', () => {
    vi.useFakeTimers();
    const { p } = canvasShow();
    p.show(1);
    expect(p.stepCount).toBe(1);
    p.next();
    vi.advanceTimersByTime(5000);
    expect(p.busy).toBe(false);
    expect(p.done).toBe(1);
    expect(p.key).toBe(1);

    const moves: Move[] = [];
    const spy = vi.spyOn(p as unknown as { drawMove: (...a: unknown[]) => void }, 'drawMove').mockImplementation((...a: unknown[]) => { moves.push(a[1] as Move); });
    p.prev();
    expect(p.done).toBe(0);
    // still moving: not a jump
    expect(p.busy).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(p.busy).toBe(false);
    expect(p.key).toBe(0);
    // the same move, played from its end towards its start
    expect(moves.length).toBeGreaterThan(3);
    expect(moves.every((m) => m.from === 0 && m.to === 1)).toBe(true);
    const ps = moves.map((m) => m.p);
    expect(ps[0]).toBeGreaterThan(0.8);
    expect(ps.at(-1)!).toBeLessThan(0.2);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeLessThanOrEqual(ps[i - 1]);
    spy.mockRestore();
  });

  it('a click while going back finishes it at once', () => {
    vi.useFakeTimers();
    const { p } = canvasShow();
    p.show(1, { atEnd: true });
    expect(p.done).toBe(1);
    p.prev();
    expect(p.busy).toBe(true);
    p.next();
    expect(p.busy).toBe(false);
    expect(p.done).toBe(0);
    expect(p.key).toBe(0);
  });

  it('Show without animation goes back at once', () => {
    vi.useFakeTimers();
    const { p } = canvasShow();
    p.noAnimation = true;
    p.show(1, { atEnd: true });
    p.prev();
    expect(p.busy).toBe(false);
    expect(p.done).toBe(0);
  });
});
