// @vitest-environment jsdom
//
// The grid's structure pictures: a structure whose picture can't be made is tried once and drawn
// as a grey box, instead of the grid queueing a new draw every frame, forever, while it is shown.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Workbook, type Structure } from '../src/sheet/workbook';
import type { Contents } from '../src/model';
import { SheetView, type SheetViewHost } from '../src/ui/sheet-view';

const drawing = { atoms: [{ id: 1 }], bonds: [], captions: [], arrows: [], shapes: [] } as unknown as Contents;

let frames: FrameRequestCallback[] = [];
function settle(max = 100): number {
  let n = 0;
  while (frames.length && n < max) { const f = frames; frames = []; for (const cb of f) cb(0); n++; }
  return n;
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // a 2D context that draws nothing (jsdom has none)
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }) : k === 'canvas' ? document.createElement('canvas') : () => undefined), set: () => true });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('grid structure pictures', () => {
  it('settles when a picture cannot be made', () => {
    const wb = new Workbook(['Data']);
    wb.edit('fill', () => { for (let r = 0; r < 3; r++) wb.sheets[0].setStructure(r, 0, drawing); });
    const made: number[] = [];
    const host = new Proxy({
      structureBox: () => ({ w: 100, h: 75 }),
      structureBitmap: (s: Structure, scale: number) => { if (scale < 0) made.push(s.id); return null; },
    } as Partial<SheetViewHost>, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => false) }) as SheetViewHost;
    const root = document.createElement('div');
    document.body.append(root);
    const view = new SheetView(root, host);
    view.show(wb);
    settle();
    expect(frames).toHaveLength(0); // nothing queued for later
    expect(made.length).toBeGreaterThan(0);
    expect(made.length).toBeLessThan(20);
  });

  it('makes every makeable picture even after many that cannot be made', () => {
    const wb = new Workbook(['Data']);
    // 7 structures that can't be made (more than one frame's budget of 6), then 4 that can
    wb.edit('fill', () => { for (let r = 0; r < 11; r++) wb.sheets[0].setStructure(r, 0, drawing); });
    const bad = new Set([0, 1, 2, 3, 4, 5, 6].map((r) => wb.sheets[0].cell(r, 0)!.structure!.id));
    const cache = new Map<number, HTMLCanvasElement>();
    const host = new Proxy({
      structureBox: () => ({ w: 100, h: 75 }),
      structureBitmap: (s: Structure, scale: number) => {
        if (cache.has(s.id)) return cache.get(s.id)!;
        if (scale >= 0 || bad.has(s.id)) return null;
        const c = document.createElement('canvas'); cache.set(s.id, c); return c;
      },
    } as Partial<SheetViewHost>, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => false) }) as SheetViewHost;
    const root = document.createElement('div');
    document.body.append(root);
    const view = new SheetView(root, host);
    view.show(wb);
    settle();
    expect(frames).toHaveLength(0);
    expect(cache.size).toBe(4);
  });
});
