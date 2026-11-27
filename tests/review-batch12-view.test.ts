// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 12 (Spreadsheet grid editing), the grid itself: F263 a sheet
// switched while a validation alert is waiting, F264 a whole column selected, F265 text over the
// fills of empty cells, F266 Ctrl+Enter, F267 dragging a column border, F268 resizing with whole
// columns selected, F269 double-clicking the fill handle, F1068 pointercancel, F1069 wrapped text
// in merged cells, F1070 text running over from a cell scrolled out of view, F1073 Delete Sheet
// while typing, F1074 arrows at a hidden first row, F1075 Page Down, F1076 the border under a
// hidden row, F1077 zooming.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { newValidation } from '../src/sheet/validation';
import { MAX_COLS, MAX_ROWS } from '../src/sheet/refs';
import { makeSparklines, type SparklineGroup } from '../src/sheet/sparklines';
import { SheetView, type SheetViewHost } from '../src/ui/sheet-view';

let frames: FrameRequestCallback[] = [];
function settle(max = 50): void {
  let n = 0;
  while (frames.length && n++ < max) { const f = frames; frames = []; for (const cb of f) cb(0); }
}

/** What the grid drew: each rectangle filled (with its color) and each piece of text, in order. */
let drawn: { op: 'rect' | 'text'; style: string; text?: string; x: number }[] = [];

beforeEach(() => {
  frames = [];
  drawn = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const state: Record<string, unknown> = { fillStyle: '#000' };
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k === 'measureText') return (text: string) => ({ width: 6 * String(text).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'canvas') return document.createElement('canvas');
      if (k === 'fillRect') return (x: number) => { drawn.push({ op: 'rect', style: String(t.fillStyle), x }); };
      if (k === 'fillText') return (text: string, x: number) => { drawn.push({ op: 'text', style: String(t.fillStyle), text, x }); };
      if (k in t) return t[k as string];
      return () => undefined;
    },
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// the grid's own parts, which the page's commands reach through its events
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Inner = any;

function make(sheets: string[] = ['Sheet1'], host: Partial<SheetViewHost> = {}) {
  const wb = new Workbook(sheets);
  const full = new Proxy({ structureBox: () => ({ w: 100, h: 75 }), structureBitmap: () => null, ...host } as Partial<SheetViewHost>, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => false) }) as SheetViewHost;
  const root = document.createElement('div');
  document.body.append(root);
  const view = new SheetView(root, full);
  view.show(wb);
  settle();
  const inner = view as Inner;
  // jsdom doesn't scroll or capture pointers: these remember what is set
  let top = 0, left = 0;
  Object.defineProperty(inner.scroller, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
  Object.defineProperty(inner.scroller, 'scrollLeft', { get: () => left, set: (v: number) => { left = v; }, configurable: true });
  inner.scroller.hasPointerCapture = () => false;
  inner.scroller.releasePointerCapture = () => {};
  return { wb, view, inner };
}

describe('F263 and F1073: typing is finished on the sheet it was typed on', () => {
  it('a sheet cannot be switched while a validation alert is waiting, and the typing goes where it was typed', async () => {
    let answer!: (a: string) => void;
    const { wb, view } = make(['A', 'B'], { invalid: () => new Promise((r) => { answer = r as (a: string) => void; }) });
    wb.edit('rule', () => wb.sheets[0].setValidations([newValidation([{ r1: 0, c1: 0, r2: 0, c2: 0 }], { kind: 'whole', op: 'between', value1: '1', value2: '9', alertStyle: 'warning' })]));
    view.selectCell(0, 0);
    view.editCell('abc');
    view.goSheet(1);
    expect(wb.active).toBe(0);
    answer('keep');
    await Promise.resolve(); await Promise.resolve();
    expect(wb.sheets[0].cell(0, 0)?.input).toBe('abc');
    expect(wb.sheets[1].cell(0, 0)?.input).toBeUndefined();
  });
  it('Delete Sheet ends the typing on the sheet that goes', () => {
    const { wb, view } = make(['A', 'B']);
    view.goSheet(1);
    view.selectCell(1, 1);
    view.editCell('hello');
    view.deleteSheet();
    expect(view.editing).toBeNull();
    view.commitEdit();
    expect(wb.sheets[0].cell(1, 1)?.input).toBeUndefined();
  });
});

describe('F266: Ctrl+Enter', () => {
  it('fills every cell selected, below the data too', () => {
    const { wb, view } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let r = 0; r < 10; r++) s.setInput(r, 0, '1'); });
    view.select({ r1: 0, c1: 0, r2: 99, c2: 0 }, { r: 0, c: 0 });
    view.editCell('x');
    view.commitEdit(0, 0, true);
    expect(s.cell(99, 0)?.input).toBe('x');
    expect(s.cell(50, 0)?.input).toBe('x');
  });
});

describe('F266: Ctrl+Enter in a huge block', () => {
  it('says so and keeps the typing instead of filling millions of cells', () => {
    const flashes: string[] = [];
    const { wb, view } = make(['Sheet1'], { flash: (m: string) => { flashes.push(m); } });
    const s = wb.sheets[0];
    view.select({ r1: 0, c1: 0, r2: 299999, c2: 25 }, { r: 0, c: 0 });
    view.editCell('x');
    const before = wb.undoLabel;
    expect(view.commitEdit(0, 0, true)).toBe(true);
    expect(flashes.join(' ')).toContain('more than 500,000 cells');
    expect(view.editing).not.toBeNull();
    expect(s.cell(0, 0)?.input).toBeUndefined();
    expect(wb.undoLabel).toBe(before);
  });
});

describe('F264: a whole column selected', () => {
  it('does not lay out a million rows', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => wb.sheets[0].setInput(5, 2, 'x'));
    view.select({ r1: 0, c1: 2, r2: MAX_ROWS - 1, c2: 2 }, { r: 0, c: 2 });
    settle();
    expect(inner.rows.n).toBeLessThan(1000);
    view.select({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, { r: 0, c: 0 });
    settle();
    expect(inner.rows.n).toBeLessThan(1000);
    expect(inner.cols.n).toBeLessThan(1000);
  });
  it('makes room to scroll to the end when a selection is run there, and lets it go again', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => wb.sheets[0].setInput(5, 2, 'x'));
    view.selectCell(0, 0);
    inner.extendTo(MAX_ROWS - 1, 0); // Ctrl+Shift+Down in a column with nothing below
    settle();
    expect(inner.rows.n).toBeGreaterThanOrEqual(MAX_ROWS - 1);
    expect(inner.scroller.scrollTop).toBeGreaterThan(1e6);
    view.selectCell(0, 0); // back to the top
    inner.scroller.dispatchEvent(new Event('scroll'));
    settle();
    expect(inner.scroller.scrollTop).toBe(0);
    expect(inner.rows.n).toBeLessThan(1000);
  });
});

describe('F268: resizing with whole columns selected', () => {
  it('sets the one dragged, past the data', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => { for (let c = 0; c < 3; c++) wb.sheets[0].setInput(0, c, 'x'); });
    view.select({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, { r: 0, c: 0 });
    inner.drag = { kind: 'resize-col', col: 7, start: 0, size: 64, orig: undefined, pointer: 1 };
    inner.previewSize('col', 7, 150);
    inner.onUp({ pointerId: 1 });
    expect(wb.sheets[0].colWidths.get(7)).toBe(150);
    expect(wb.sheets[0].colWidths.get(0)).toBe(150);
  });
  it('sets every column of a selection that stops short of the end, past the data', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => { for (let c = 0; c < 3; c++) wb.sheets[0].setInput(0, c, 'x'); });
    view.select({ r1: 0, c1: 2, r2: MAX_ROWS - 1, c2: 25 }, { r: 0, c: 2 }); // C:Z
    inner.drag = { kind: 'resize-col', col: 12, start: 0, size: 64, orig: undefined, pointer: 1 };
    inner.previewSize('col', 12, 150);
    inner.onUp({ pointerId: 1 });
    expect([2, 12, 13, 25].map((c) => wb.sheets[0].colWidths.get(c))).toEqual([150, 150, 150, 150]);
    expect(wb.sheets[0].colWidths.has(26)).toBe(false);
  });
});

describe('F1068: pointercancel', () => {
  it('puts a size shown while dragging back, and ends the drag', () => {
    const { wb, view, inner } = make();
    inner.drag = { kind: 'resize-col', col: 2, start: 0, size: 64, orig: undefined, pointer: 3 };
    inner.previewSize('col', 2, 200);
    expect(wb.sheets[0].colWidths.get(2)).toBe(200);
    const ev = new Event('pointercancel');
    Object.defineProperty(ev, 'pointerId', { value: 3 });
    inner.scroller.dispatchEvent(ev);
    expect(wb.sheets[0].colWidths.has(2)).toBe(false);
    expect(inner.drag).toBeNull();
    expect(inner.sizePreview).toBeNull();
    expect(wb.undoLabel).toBe('');
    expect(view.sheet).toBe(wb.sheets[0]);
  });
});

describe('F267: dragging a column border', () => {
  it('measures only the cells of the column dragged for each step', () => {
    const { wb, view, inner } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => {
      for (let r = 0; r < 300; r++) s.setInput(r, 1, `a long note of ${r} words that wraps over a few lines in its cell`);
      s.setInput(0, 0, 'a note in the first column that wraps as well');
      s.patchStyle({ r1: 0, c1: 0, r2: 299, c2: 1 }, { wrap: true });
    });
    view.refresh();
    settle();
    const wrap = vi.spyOn(inner, 'wrapLines');
    inner.drag = { kind: 'resize-col', col: 0, start: 0, size: 64, orig: undefined, pointer: 1 };
    inner.previewSize('col', 0, 80);
    settle();
    wrap.mockClear();
    inner.previewSize('col', 0, 90);
    inner.previewSize('col', 0, 100);
    settle();
    expect(wrap.mock.calls.length).toBeLessThanOrEqual(6);
    // the rows still fit what the column shows
    expect(inner.autoHeights(s).get(0)).toBeGreaterThan(22);
  });
});

describe('F269: double-clicking the fill handle', () => {
  it('counts on, as dragging does', () => {
    const { wb, view } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, '1'); s.setInput(1, 0, '2'); for (let r = 0; r < 20; r++) s.setInput(r, 1, 'x'); s.setInput(0, 2, 'S1'); });
    view.select({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r: 0, c: 0 });
    view.fillToEnd();
    expect([2, 3, 19].map((r) => s.cell(r, 0)?.input)).toEqual(['3', '4', '20']);
    view.select({ r1: 0, c1: 2, r2: 0, c2: 2 }, { r: 0, c: 2 });
    // (a column beside it that is filled down: B)
    wb.edit('t', () => { for (let r = 0; r < 20; r++) s.setInput(r, 3, 'y'); });
    view.fillToEnd();
    expect([1, 2].map((r) => s.cell(r, 2)?.input)).toEqual(['S2', 'S3']);
  });
});

describe('F1069: wrapped text in merged cells', () => {
  it('does not make the row as tall as one narrow column would need', () => {
    const { wb, view } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'a paragraph of text that is long enough to wrap in one narrow column '.repeat(5)); s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { wrap: true }); s.setMerges([{ r1: 0, c1: 0, r2: 0, c2: 5 }]); });
    expect(view.autoHeights(s).get(0)).toBeUndefined();
  });
});

describe('F1074 and F1076: hidden rows at the edges', () => {
  it('the arrow keys stay when only hidden rows lie above', () => {
    const { wb, view } = make();
    wb.edit('t', () => { wb.sheets[0].setRowHidden(0, true); wb.sheets[0].setColHidden(0, true); });
    view.selectCell(1, 1);
    view.move(-1, 0);
    expect(view.sel.active).toEqual({ r: 1, c: 1 });
    view.move(0, -1);
    expect(view.sel.active).toEqual({ r: 1, c: 1 });
  });
  it('the border under a hidden row is the visible row above it', () => {
    const { wb, inner } = make();
    wb.edit('t', () => wb.sheets[0].setRowHidden(4, true));
    inner.layout();
    const y = inner.HH + inner.rows.pos(5) + 1;
    expect(inner.borderAt(5, y)).toEqual({ kind: 'row', index: 3 });
  });
});

describe('F1075: Page Down', () => {
  it('moves by the rows that fill the window, as tall as they are, and scrolls by that much', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => { for (let r = 0; r < 100; r++) wb.sheets[0].setRowHeight(r, 120); });
    view.refresh();
    settle();
    view.selectCell(0, 0);
    inner.pageMove(1, false);
    const r = view.sel.active.r;
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThanOrEqual(6);
    expect(inner.scroller.scrollTop).toBe(inner.rows.pos(r));
    inner.pageMove(-1, false);
    expect(view.sel.active.r).toBe(0);
    expect(inner.scroller.scrollTop).toBe(0);
  });
});

describe('F1077: zooming', () => {
  it('keeps the cells at the top left', () => {
    const { view, inner } = make();
    inner.scroller.scrollTop = 100000;
    inner.scroller.scrollLeft = 5000;
    view.setZoom(1.1);
    expect(Math.round(inner.scroller.scrollTop)).toBe(110000);
    expect(Math.round(inner.scroller.scrollLeft)).toBe(5500);
  });
});

describe('F265 and F1070: text that runs over empty cells', () => {
  const title = 'A long title that runs over the cells beside it';
  it('shows over their fills', () => {
    const { wb, view } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, title); s.patchStyle({ r1: 0, c1: 1, r2: 0, c2: 5 }, { fill: '#aabbcc' }); });
    view.refresh();
    drawn = [];
    settle();
    const text = drawn.findIndex((d) => d.op === 'text' && d.text === title);
    expect(text).toBeGreaterThan(-1);
    // no fill of the cells beside it is drawn after the text
    expect(drawn.slice(text).some((d) => d.op === 'rect' && d.style === '#aabbcc')).toBe(false);
  });
  it('leaves a sparkline in an empty cell it runs over', () => {
    const { wb, view } = make();
    const s = wb.sheets[0];
    wb.edit('t', () => {
      s.setInput(0, 0, title);
      for (let c = 3; c <= 5; c++) s.setInput(1, c, String(c));
      const group = makeSparklines('line', { r1: 1, c1: 3, r2: 1, c2: 5 }, { r1: 0, c1: 1, r2: 0, c2: 1 });
      s.setSparklines([group as SparklineGroup]);
    });
    let sparkX = -1;
    (view as unknown as { drawSparkline: (...a: unknown[]) => void }).drawSparkline = (...a) => { sparkX = a[3] as number; };
    view.refresh();
    drawn = [];
    settle();
    expect(sparkX).toBeGreaterThan(0);
    // nothing white is painted over the cell the sparkline sits in, after or before it
    expect(drawn.some((d) => d.op === 'rect' && d.style === '#ffffff' && Math.abs(d.x - (sparkX - 1)) < 1.5)).toBe(false);
    expect(drawn.some((d) => d.op === 'text' && d.text === title)).toBe(true);
  });
  it('goes on over the empty cells in view when its own cell is scrolled out', () => {
    const { wb, view, inner } = make();
    wb.edit('t', () => wb.sheets[0].setInput(0, 0, title));
    view.refresh();
    settle();
    inner.scroller.scrollLeft = 70;
    drawn = [];
    inner.draw();
    expect(drawn.some((d) => d.op === 'text' && d.text === title)).toBe(true);
  });
});
