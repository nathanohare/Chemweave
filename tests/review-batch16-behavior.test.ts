// @vitest-environment jsdom
//
// Review batch 16, round 2: the wording fixes checked by running the code that builds them (an
// undo label read from the deck, a panel built and read, a canvas drawn with a recording context)
// rather than by searching the source. Names are Excel's and PowerPoint's own.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Deck } from '../src/deck/deck';
import { Doc } from '../src/model';
import { OutlineView } from '../src/ui/outline-view';
import { Workbook } from '../src/sheet/workbook';
import { SheetView, type SheetViewHost } from '../src/ui/sheet-view';
import { SheetCharts } from '../src/ui/sheet-chart-ui';
import { newChartBox } from '../src/sheet/chart-box';
import { SheetAnalysis } from '../src/ui/sheet-analysis-ui';
import { SheetOutline } from '../src/ui/sheet-outline-ui';

const D = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
D.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.close ??= function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

describe('F854: slide undo steps are named in Title Case, whichever way the command is run', () => {
  const deck = () => { const d = Deck.blank(new Doc()); d.attach(); return d; };
  it('sections', () => {
    const d = deck();
    const id = d.addSection();
    expect(d.undoLabel).toBe('Add Section');
    d.renameSection(id, 'Results');
    expect(d.undoLabel).toBe('Rename Section');
    d.removeAllSections();
    expect(d.undoLabel).toBe('Remove All Sections');
  });
  it('a new slide, from the ribbon and from the Outline', () => {
    const d = deck();
    d.addSlide();
    expect(d.undoLabel).toBe('New Slide');
    const parent = document.createElement('div');
    const outline = new OutlineView(parent, { deck: () => d, go: () => {}, focusSlide: () => {} });
    d.undo();
    (outline as unknown as { addAfter(i: number): void }).addAfter(0);
    expect(d.undoLabel).toBe('New Slide');
  });
  it('show settings, timings and guides', () => {
    const d = deck();
    d.setSettings({ ...d.settings, show: { ...d.settings.show, manual: true } });
    expect(d.undoLabel).toBe('Set Up Show');
    d.setTimings(new Map([[0, 5]]));
    expect(d.undoLabel).toBe('Rehearse Timings');
    expect(d.clearTimings([0])).toBe(true);
    expect(d.undoLabel).toBe('Clear Timings');
  });
});

/** A 2D context that records the fills made, and draws nothing. */
function recordingContext(fills: { alpha: number; x: number; y: number; w: number; h: number }[]) {
  let alpha = 1;
  const stack: number[] = [];
  return new Proxy({}, {
    get: (_t, k) => {
      if (k === 'globalAlpha') return alpha;
      if (k === 'save') return () => { stack.push(alpha); };
      if (k === 'restore') return () => { alpha = stack.pop() ?? 1; };
      if (k === 'fillRect') return (x: number, y: number, w: number, h: number) => { fills.push({ alpha, x, y, w, h }); };
      if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'canvas') return document.createElement('canvas');
      return () => undefined;
    },
    set: (_t, k, v) => { if (k === 'globalAlpha') alpha = v as number; return true; },
  });
}

describe('F1072: the active cell is not tinted in a multi-cell selection', () => {
  let frames: FrameRequestCallback[] = [];
  const fills: { alpha: number; x: number; y: number; w: number; h: number }[] = [];
  beforeEach(() => {
    frames = []; fills.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recordingContext(fills) as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('draws the selection tint round the active cell, not over it', () => {
    const wb = new Workbook(['Data']);
    const host = new Proxy({} as Partial<SheetViewHost>, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => false) }) as SheetViewHost;
    const root = document.createElement('div');
    document.body.append(root);
    const view = new SheetView(root, host);
    view.show(wb);
    view.select({ r1: 1, c1: 1, r2: 3, c2: 3 }, { r: 1, c: 1 });
    for (let n = 0; frames.length && n < 50; n++) { const f = frames; frames = []; for (const cb of f) cb(0); }
    const tint = fills.filter((f) => Math.abs(f.alpha - 0.12) < 1e-9);
    expect(tint.length).toBeGreaterThan(0);
    // the cell's own box, from where the grid puts the cells
    const g = view as unknown as { cols: { pos(c: number): number }; rows: { pos(r: number): number } };
    const cell = { x: g.cols.pos(1), y: g.rows.pos(1), w: g.cols.pos(2) - g.cols.pos(1), h: g.rows.pos(2) - g.rows.pos(1) };
    const inside = (f: { x: number; y: number; w: number; h: number }) => f.x < cell.x + cell.w && cell.x < f.x + f.w && f.y < cell.y + cell.h && cell.y < f.y + f.h;
    // (the grid is drawn offset from the pane's corner, so compare sizes: the tint is the range less one cell)
    const area = tint.reduce((s, f) => s + f.w * f.h, 0);
    const range = (g.cols.pos(4) - g.cols.pos(1)) * (g.rows.pos(4) - g.rows.pos(1));
    expect(area).toBeCloseTo(range - cell.w * cell.h, 3);
    expect(tint.every((f) => !(f.w === g.cols.pos(4) - g.cols.pos(1) && f.h === g.rows.pos(4) - g.rows.pos(1)))).toBe(true);
    void inside;
  });
});

describe('F1021: how to drill into a chart is behind an "i", not a line of its own', () => {
  it('has the treemap and decomposition tree tips on their row labels', () => {
    for (const [kind, words] of [['treemap', 'drill into it'], ['decomp', 'split it by the next level']] as const) {
      const box = newChartBox(kind);
      const chart = box.chart;
      const wb = new Workbook(['Sheet1']);
      wb.build(() => box.cells.forEach((row, r) => row.forEach((t, c) => wb.sheet.setInput(r, c, t))));
      const charts = new SheetCharts({ view: { sheet: wb.sheet, wb }, flash: () => {} } as never);
      charts.ownData = true;
      charts.target = { get: () => chart, set: () => {}, remove: () => {} };
      const els = charts.panel(chart);
      const tips = els.flatMap((e) => [...e.querySelectorAll<HTMLElement>('.info-icon')]).map((i) => i.dataset.tip ?? '');
      expect(tips.some((t) => t.includes(words)), kind).toBe(true);
      expect(els.some((e) => e.tagName === 'P' && e.textContent?.startsWith('Click a')), kind).toBe(false);
      const buttons = els.flatMap((e) => [...e.querySelectorAll('button')]).map((b) => b.textContent);
      expect(buttons).toContain('Delete Chart');
    }
  });
});

describe('F1013, F1050: Data Table and Outline Settings keep help behind the title\'s "i"', () => {
  it('Data Table shows only the range as a line', () => {
    const wb = new Workbook(['Data']);
    const s = wb.sheet;
    const view = { wb, sheet: s, sel: { range: { r1: 0, c1: 0, r2: 3, c2: 3 }, active: { r: 0, c: 0 } }, commitEdit() {}, goSheet() {}, select() {}, refresh() {}, focus() {}, place: () => undefined };
    const ui = new SheetAnalysis({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(s)), flash: vi.fn() });
    ui.dataTableWindow();
    const d = [...document.querySelectorAll('dialog.tool-window')].pop()!;
    expect(d.querySelector('h2')!.textContent).toContain('Data Table');
    const lines = [...d.querySelectorAll('.tool-body > p')].map((p) => p.textContent);
    expect(lines).toEqual(['The table: A1:D4.']);
    expect([...d.querySelectorAll<HTMLElement>('h2 .info-icon')].map((i) => i.dataset.tip)[0]).toContain('Put the input values in the top row');
  });
  it('Outline Settings is in Title Case, with its help in the "i"', () => {
    const wb = new Workbook(['Data']);
    const view = { wb, sheet: wb.sheet, sel: { range: { r1: 0, c1: 0, r2: 0, c2: 0 } } };
    const ui = new SheetOutline({ view: view as never, edit: () => {}, flash: () => {}, table: () => null });
    ui.settings();
    const d = [...document.querySelectorAll('dialog.tool-window')].pop()!;
    expect(d.querySelector('h2')!.firstChild!.textContent).toBe('Outline Settings');
    expect(d.querySelectorAll('.tool-body > p')).toHaveLength(0);
    expect(d.querySelector<HTMLElement>('h2 .info-icon')!.dataset.tip).toContain('summary rows and columns');
  });
});

describe('F1019, F1022: the chart\'s Fit Line menu and panel buttons', () => {
  const setup = () => {
    const box = newChartBox('scatter');
    const chart = { ...box.chart, series: box.chart.series.map((s, i) => (i === 0 ? { ...s, fit: { kind: 'linear' as const, showEq: true, showR2: true, intercept: 0 } } : s)) };
    const wb = new Workbook(['Sheet1']);
    wb.build(() => box.cells.forEach((row, r) => row.forEach((t, c) => wb.sheet.setInput(r, c, t))));
    const charts = new SheetCharts({ view: { sheet: wb.sheet, wb }, flash: () => {} } as never);
    charts.target = { get: () => chart, set: () => {}, remove: () => {} };
    return { charts, chart };
  };
  it('marks Through the Origin when it is on, and Linear is the straight line\'s name', () => {
    const { charts } = setup();
    charts.fitMenu(0, 0);
    const items = [...document.querySelectorAll('.popup-menu button')].map((b) => b.textContent);
    expect(items).toContain('✓ Through the Origin');
    expect(items).toContain('✓ Linear');
  });
  it('has no check mark on Through the Origin when it is off', () => {
    const { charts, chart } = setup();
    charts.target = { get: () => ({ ...chart, series: chart.series.map((s) => (s.fit ? { ...s, fit: { ...s.fit, intercept: undefined } } : s)) }), set: () => {}, remove: () => {} };
    charts.fitMenu(0, 0);
    const items = [...document.querySelectorAll('.popup-menu button')].map((b) => b.textContent);
    expect(items).toContain('Through the Origin');
  });
  it('names the panel buttons in Title Case', () => {
    const { charts, chart } = setup();
    const els = charts.panel(chart);
    const buttons = els.flatMap((e) => [...e.querySelectorAll('button')]).map((b) => b.textContent);
    for (const n of ['Add Series…', 'Copy as Picture', 'Delete Chart']) expect(buttons, n).toContain(n);
    for (const old of ['Add series…', 'Copy as picture', 'Delete chart', 'Remove this series', 'Copy equation', 'Reset position (beside the line)']) expect(buttons, old).not.toContain(old);
  });
});

describe('F682: the "i" in a floating box\'s title bar opens on a click', () => {
  it('is left out of the bar\'s drag, so the click reaches it', async () => {
    const { FloatBox } = await import('../src/ui/float-box');
    const { addInfo } = await import('../src/ui/info-tip');
    const box = new FloatBox('Charts', () => {});
    const tip = addInfo(box.el.querySelector('.fb-title'), 'Help for the pane.')!;
    box.show();
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    tip.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    // dragging by the bar itself still works
    const bar = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.assign(bar, { pointerId: 1 });
    (box.el.querySelector('.fb-head') as HTMLElement).setPointerCapture = () => {};
    box.el.querySelector('.fb-head')!.dispatchEvent(bar);
    expect(bar.defaultPrevented).toBe(true);
  });
});

describe('F1027, F1062, F457: messages say what happened', () => {
  it('sorting left to right on one column says "column" (Custom Sort)', async () => {
    const { SheetData } = await import('../src/ui/sheet-data-ui');
    const wb = new Workbook(['Data']);
    wb.edit('fill', () => { wb.sheet.setInput(0, 0, 'b'); wb.sheet.setInput(1, 0, 'a'); });
    const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
    const view = { wb, sheet: wb.sheet, sel: { range, active: { r: 0, c: 0 } }, commitEdit() {}, focus() {}, refresh() {}, select() {} };
    const ui = new SheetData({ view: view as never, edit: () => {}, flash: vi.fn(), table: () => ({ data: range, header: null }), goTo() {}, pasteSpecial() {} });
    ui.sortDialog();
    const d = [...document.querySelectorAll('dialog')].pop()!;
    const across = [...d.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((b) => b.parentElement?.textContent?.includes('left to right'))!;
    across.checked = true;
    d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(d.textContent).toContain('There is only one column to sort.');
    expect(d.textContent).not.toContain('only one row');
  });
});

describe('F457: marking a citation again says it was updated, not marked', () => {
  it('flashes "Updated the citation" when only its category changed', async () => {
    const { DocFile } = await import('../src/document/doc-file');
    const { newDocument } = await import('../src/document/document');
    const { DocIndexUI } = await import('../src/ui/doc-index-ui');
    const f = new DocFile({ ...newDocument(), runs: [{ text: 'See Roe v. Wade.' }], paras: [{}] } as never);
    f.ed.select(4, 15);
    const flashes: string[] = [];
    const ui = new DocIndexUI({ file: () => f, flash: (m: string) => { flashes.push(m); }, focus() {}, insertObject: () => 0 } as never);
    const mark = async (cat: string) => {
      const done = ui.markCitation();
      const d = [...document.querySelectorAll('dialog')].pop()!;
      const select = d.querySelector<HTMLSelectElement>('select')!;
      select.value = cat;
      d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await done;
    };
    await mark('1');
    expect(flashes.pop()).toMatch(/^Marked under /);
    await mark('2');
    const again = flashes.pop() ?? '';
    expect(again).toMatch(/^Updated the citation under /);
    expect(again).not.toMatch(/^Marked/);
  });
});
