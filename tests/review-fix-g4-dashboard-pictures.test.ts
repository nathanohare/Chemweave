// @vitest-environment jsdom
//
// A dashboard's structure gallery fills in its pictures without drawing the whole dashboard again
// for them. It used to queue a new draw whenever a picture wasn't made yet, so a gallery needing
// more pictures than the picture cache keeps (making the last ones lets the first go), or a
// structure whose picture can't be made, redrew every tile on every frame, forever.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Workbook, type Structure } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { newDashboard, type GalleryTile } from '../src/sheet/dashboard';
import type { Contents } from '../src/model';
import { DashboardView, type DashHost } from '../src/ui/dashboard-view';

// a stand-in drawing: the fake host below never looks inside it
const drawing = { atoms: [{ id: 1 }], bonds: [], captions: [], arrows: [], shapes: [] } as unknown as Contents;

function gallery(rows: number): Workbook {
  const wb = new Workbook(['Data', 'Dash']);
  const s = wb.sheets[0];
  wb.edit('fill', () => {
    s.setInput(0, 0, 'Structure');
    s.setInput(0, 1, 'Name');
    for (let r = 1; r <= rows; r++) { s.setStructure(r, 0, drawing); s.setInput(r, 1, `C${r}`); }
    s.setTables([{ ...newTable({ r1: 0, c1: 0, r2: rows, c2: 1 }, []), name: 'Compounds' }]);
  });
  const tile: GalleryTile = { id: 1, kind: 'gallery', x: 0, y: 0, w: 12, h: 20, source: { table: 'Compounds' }, structure: 'Structure', labels: ['Name'] };
  wb.sheets[1].dashboard = { ...newDashboard(), tiles: [tile] };
  return wb;
}

/** A host whose picture cache keeps `keep` bitmaps, least recently used let go (as StructurePictures). */
function host(wb: Workbook, keep: number, makeable = true) {
  const cache = new Map<number, CanvasImageSource>();
  const made: number[] = [];
  const h: DashHost = {
    wb, zoom: 1,
    structureBox: () => ({ w: 100, h: 75 }),
    structureBitmap: (s: Structure, scale: number) => {
      const got = cache.get(s.id);
      if (got) { cache.delete(s.id); cache.set(s.id, got); return got; }
      if (scale >= 0) return null;
      made.push(s.id);
      if (!makeable) return null;
      const bmp = document.createElement('canvas');
      cache.set(s.id, bmp);
      if (cache.size > keep) cache.delete(cache.keys().next().value as number);
      return bmp;
    },
    setDashboard: () => {}, picked: () => {}, open: () => {}, contextMenu: () => {}, flash: () => {}, key: () => false,
  };
  return { h, made };
}

let frames: FrameRequestCallback[] = [];
const painted = new Set<HTMLCanvasElement>();
/** Run queued frames until none is left (at most `max`): the number run. */
function settle(max = 200): number {
  let n = 0;
  while (frames.length && n < max) { const f = frames; frames = []; for (const cb of f) cb(0); n++; }
  return n;
}

beforeEach(() => {
  frames = [];
  painted.clear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return { drawImage: () => { painted.add(this); } } as unknown as CanvasRenderingContext2D;
  } as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('dashboard structure pictures', () => {
  it('fills every card of a gallery bigger than the picture cache and then stops', () => {
    const wb = gallery(40);
    const { h, made } = host(wb, 10);
    const view = new DashboardView(document.body, h);
    const draw = vi.spyOn(view, 'draw');
    view.show(wb.sheets[1]);
    const ran = settle();
    expect(frames).toHaveLength(0); // settled: nothing queued for later
    expect(ran).toBeLessThan(10);
    expect(draw).toHaveBeenCalledTimes(1); // the dashboard is drawn once, not again for each batch of pictures
    const cards = [...view.el.querySelectorAll<HTMLCanvasElement>('.dash-card canvas')];
    expect(cards).toHaveLength(40);
    expect(cards.every((c) => painted.has(c))).toBe(true);
    expect(made).toHaveLength(40); // each picture made once
  });

  it('stops trying a structure whose picture cannot be made', () => {
    const wb = gallery(30);
    const { h, made } = host(wb, 400, false);
    const view = new DashboardView(document.body, h);
    const draw = vi.spyOn(view, 'draw');
    view.show(wb.sheets[1]);
    settle();
    expect(frames).toHaveLength(0);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(30); // each tried once
  });
});
