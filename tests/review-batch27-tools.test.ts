// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 27, the Data, Insert, Formulas and Chart windows of Sheet mode:
// Freeze Panes and Split (F248, F1028), the Series window and Custom Sort (F1024, F1026), Data >
// Clear after an Advanced Filter (F247), Subtotal (F1051 to F1053), the chart's region, Pie and
// the Insert into Cells note (F245, F1018, F1020), Compound look-ups (F246, F1023), sparklines
// (F262, F1066) and the Formulas tab (F250, F1033 to F1036).
//
// What Excel does is the reference (Microsoft Support pages named beside each test); numbers are
// worked out by hand, never read from the code under test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import { SheetView, type SheetViewHost } from '../src/ui/sheet-view';
import { SheetData } from '../src/ui/sheet-data-ui';
import { SheetOutline } from '../src/ui/sheet-outline-ui';
import { SheetCharts } from '../src/ui/sheet-chart-ui';
import { SheetCompounds } from '../src/ui/sheet-compound-ui';
import { SheetSparklines } from '../src/ui/sheet-sparkline-ui';
import { SheetFormulas } from '../src/ui/sheet-formulas-ui';
import { chartFromRange } from '../src/sheet/chart';
import { makeSparklines } from '../src/sheet/sparklines';
import { rig, stubBrowser } from './review-batch12-harness';
import type { CompoundCard } from '../src/sheet/compound';

const pubchem = vi.hoisted(() => ({ card: null as null | ((q: unknown) => Promise<unknown>) }));
vi.mock('../src/chem/pubchem', () => ({
  pubchemCard: (q: unknown) => pubchem.card!(q),
  PubChemError: class extends Error {},
}));

const D = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
D.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.close ??= function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const lastDialog = () => [...document.querySelectorAll('dialog')].pop() as HTMLDialogElement;
const submit = async (d: HTMLElement) => { d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await wait(5); };
const buttonOf = (d: HTMLElement, text: string) => [...d.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
const range = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });

// ---------------------------------------------------------------- a real grid, for the view tests

let frames: FrameRequestCallback[] = [];
function settle(max = 50): void {
  let n = 0;
  while (frames.length && n++ < max) { const f = frames; frames = []; for (const cb of f) cb(0); }
}
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => {
      if (k === 'measureText') return (text: string) => ({ width: 6 * String(text).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'canvas') return document.createElement('canvas');
      if (k in t) return t[k as string];
      return () => undefined;
    },
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function grid(sheets: string[] = ['Sheet1']) {
  const wb = new Workbook(sheets);
  const full = new Proxy({ structureBox: () => ({ w: 100, h: 75 }), structureBitmap: () => null } as Partial<SheetViewHost>, { get: (t, k) => (k in t ? t[k as keyof typeof t] : () => false) }) as SheetViewHost;
  const root = document.createElement('div');
  document.body.append(root);
  const view = new SheetView(root, full);
  view.show(wb);
  settle();
  let top = 0, left = 0;
  const sc = (view as unknown as { scroller: HTMLElement }).scroller;
  Object.defineProperty(sc, 'scrollTop', { get: () => top, set: (v: number) => { top = v; }, configurable: true });
  Object.defineProperty(sc, 'scrollLeft', { get: () => left, set: (v: number) => { left = v; }, configurable: true });
  const flash = vi.fn();
  let table: { data: ReturnType<typeof range>; header: number | null } | null = null;
  const data = new SheetData({
    view, flash, goTo() {}, pasteSpecial() {},
    edit: (label, fn) => wb.edit(label, () => fn(view.sheet!), view.place()),
    table: () => table,
  });
  return { wb, view, data, flash, setTable: (t: typeof table) => { table = t; } };
}

describe('F248: Freeze Panes far down a long sheet', () => {
  // Excel freezes the rows above the active cell as they are on the screen; here the frozen rows
  // are counted from row 1, so a freeze that would fill the window is refused with a reason
  // (Microsoft Support, "Freeze panes to lock rows and columns").
  it('refuses to freeze 204 rows into a window that shows about 30', () => {
    const { wb, view, data, flash } = grid();
    wb.edit('fill', () => { for (let r = 0; r < 500; r++) wb.sheets[0].setInput(r, 0, String(r)); });
    view.selectCell(204, 0);
    data.freeze('cell');
    expect(wb.sheets[0].frozen.rows).toBe(0);
    expect(String(flash.mock.calls.at(-1)?.[0])).toContain('Freezing here would fill the window');
    expect(wb.canUndo()).toBe(true);
    wb.undo();
    expect(wb.canUndo()).toBe(false);
  });

  it('still freezes a few rows and columns', () => {
    const { wb, view, data } = grid();
    view.selectCell(3, 1);
    data.freeze('cell');
    expect(wb.sheets[0].frozen).toEqual({ rows: 3, cols: 1 });
  });
});

describe('F248: Freeze header row (Sheet mode) far down a long sheet', () => {
  it('refuses to freeze 204 rows too, and still freezes a few', () => {
    stubBrowser();
    const { mode, wb, flashes } = rig();
    const s = wb.sheets[0];
    wb.edit('fill', () => { for (let r = 0; r < 500; r++) s.setInput(r, 0, String(r)); });
    mode.view.selectCell(204, 0);
    (mode as unknown as { freezeHeader(): void }).freezeHeader();
    expect(s.frozen.rows).toBe(0);
    expect(flashes.at(-1)).toContain('Freezing here would fill the window');
    mode.view.selectCell(3, 0);
    (mode as unknown as { freezeHeader(): void }).freezeHeader();
    expect(s.frozen.rows).toBe(3);
  });
});

describe('F1028: Split on a sheet with frozen panes is one step', () => {
  it('one Undo brings the frozen panes back', () => {
    const { wb, view, data } = grid();
    data.freeze('row');
    expect(wb.sheets[0].frozen.rows).toBe(1);
    view.selectCell(4, 2);
    data.toggleSplit();
    expect(wb.sheets[0].split).toEqual({ rows: 4, cols: 2 });
    expect(wb.sheets[0].frozen).toEqual({ rows: 0, cols: 0 });
    wb.undo();
    expect(wb.sheets[0].split).toBeNull();
    expect(wb.sheets[0].frozen.rows).toBe(1);
  });
});

describe('F1024 and F1026: the Series window and Custom Sort', () => {
  it('Step value stays open after Trend is ticked under Linear and the type becomes Date', () => {
    const { view, data } = grid();
    view.select(range(0, 0, 4, 0), { r: 0, c: 0 });
    data.series();
    const d = lastDialog();
    const radio = (v: string) => d.querySelector<HTMLInputElement>(`input[name=sd-type][value=${v}]`)!;
    const trend = [...d.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0];
    const step = [...d.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Step value'))!.querySelector('input')!;
    trend.checked = true;
    trend.dispatchEvent(new Event('change'));
    expect(step.disabled).toBe(true);
    radio('date').checked = true;
    radio('date').dispatchEvent(new Event('change'));
    expect(trend.disabled).toBe(true);
    expect(step.disabled).toBe(false);
    // and back to Linear: the tick still counts there
    radio('linear').checked = true;
    radio('linear').dispatchEvent(new Event('change'));
    expect(step.disabled).toBe(true);
  });

  it('a level keyed on column C is not left on Row 3 when Sort left to right is ticked', () => {
    const { wb, view, data, setTable } = grid();
    wb.edit('fill', () => { for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) wb.sheets[0].setInput(r, c, String(r * 4 + c)); });
    setTable({ data: range(0, 0, 5, 3), header: null });
    view.selectCell(0, 0);
    data.sortDialog();
    const d = lastDialog();
    const key = d.querySelector<HTMLSelectElement>('select[aria-label=Column]')!;
    key.value = '2';
    const across = [...d.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((b) => b.parentElement?.textContent?.includes('left to right'))!;
    across.checked = true;
    across.dispatchEvent(new Event('change'));
    // the options are rows now; the level starts again on the active cell's row (row 1)
    expect(key.options[0].textContent).toBe('Row 1');
    expect(key.value).toBe('0');
    across.checked = false;
    across.dispatchEvent(new Event('change'));
    expect(key.options[0].textContent).toContain('Column A');
    expect(key.value).toBe('0');
  });
});

describe('F247: Data > Clear after an in-place Advanced Filter on a sheet with an AutoFilter', () => {
  it('shows the hidden rows again', () => {
    const { wb, view, data, setTable, flash } = grid();
    const s = wb.sheets[0];
    wb.edit('fill', () => {
      for (let r = 0; r < 6; r++) { s.setInput(r, 0, r ? String(r) : 'n'); s.setInput(r, 1, 'x'); }
      s.setFilter({ range: range(0, 0, 5, 1), conditions: {} });
      // what an Advanced Filter in place does: rows are hidden, not filtered by a condition
      s.setRowHidden(2, true);
      s.setRowHidden(4, true);
    });
    setTable({ data: range(1, 0, 5, 1), header: 0 });
    view.selectCell(0, 0);
    data.clearFilter();
    expect(s.hiddenRows.size).toBe(0);
    expect(wb.undoLabel).toBe('Clear filter');
    // it says the rows are shown, not that none were hidden
    expect(String(flash.mock.calls.at(-1)?.[0])).toBe('2 hidden rows show again.');
    wb.undo();
    expect(s.hiddenRows.size).toBe(2);
  });

  it('a filter with a condition: the rows it hid show, and the message says so (not that none were hidden)', () => {
    const { wb, view, data, flash } = grid();
    const s = wb.sheets[0];
    wb.edit('fill', () => {
      ['n', '10', '60', '20', '70'].forEach((v, r) => s.setInput(r, 0, v));
      s.setFilter({ range: range(0, 0, 4, 0), conditions: {} });
    });
    wb.edit('filter', () => s.setCondition(0, { kind: 'values', allowed: ['10', '20'] }));
    expect(s.hiddenRows.size).toBe(2);
    view.selectCell(0, 0);
    data.clearFilter();
    expect(s.hiddenRows.size).toBe(0);
    expect(String(flash.mock.calls.at(-1)?.[0])).toBe('2 hidden rows show again.');
  });

  it('says there is nothing to clear only when nothing was hidden or filtered', () => {
    const { wb, view, data, flash } = grid();
    wb.edit('fill', () => { for (let r = 0; r < 3; r++) wb.sheets[0].setInput(r, 0, String(r)); });
    view.selectCell(0, 0);
    data.clearFilter();
    expect(String(flash.mock.calls.at(-1)?.[0])).toBe('No rows are hidden here.');
  });
});

// ---------------------------------------------------------------- Subtotal

/** A view of a workbook that shows the sheet `state.cur`, for the windows that don't need a grid. */
function fakeView(wb: Workbook, sel = range(0, 0, 0, 0)) {
  const state = { cur: 0, sel };
  const view = {
    wb,
    get sheet() { return wb.sheets[state.cur]; },
    get sel() { return { range: state.sel, active: { r: state.sel.r1, c: state.sel.c1 } }; },
    editing: null, commitEdit() {}, goSheet(i: number) { state.cur = i; wb.active = i; }, select() {}, selectCell() {}, refresh() {}, focus() {}, pickChart() {},
    place: () => undefined, clearOfCharts: (c: unknown) => c, areas: () => [state.sel],
  };
  return { state, view };
}

describe('F1051 to F1053: Subtotal', () => {
  it('F1053: a table that grew while the window stayed open is not subtotaled over the old range', async () => {
    const wb = new Workbook(['Sheet1']);
    wb.edit('fill', () => {
      const s = wb.sheets[0];
      [['Solvent', 'Yield'], ['THF', '10'], ['DMF', '20']].forEach((row, r) => row.forEach((v, c) => s.setInput(r, c, v)));
    });
    const { view } = fakeView(wb);
    let t = { data: range(1, 0, 2, 1), header: 0 as number | null };
    const ui = new SheetOutline({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(view.sheet)), flash: vi.fn(), table: () => t });
    ui.subtotal();
    const d = lastDialog();
    for (const l of d.querySelectorAll('fieldset label')) if (l.textContent === 'Yield') l.querySelector('input')!.checked = true;
    wb.edit('grow', () => wb.sheets[0].setInput(3, 0, 'THF'));
    t = { data: range(1, 0, 3, 1), header: 0 };
    await submit(d);
    expect(d.querySelector('.tool-error')!.textContent).toContain('The table has changed');
    expect(wb.undoLabel).not.toBe('Subtotal');
  });

  const book = () => {
    const wb = new Workbook(['Sheet1', 'Sheet2']);
    wb.edit('fill', () => {
      const s = wb.sheets[0];
      s.setInput(0, 0, 'Solvent'); s.setInput(0, 1, 'Note'); s.setInput(0, 2, 'Yield');
      // numbers in column C from the second data row on; the first data row's C is blank
      const data = [['THF', 'a', ''], ['THF', 'b', '70'], ['DMF', 'c', '55']];
      data.forEach((row, i) => row.forEach((v, c) => { if (v) s.setInput(i + 1, c, v); }));
    });
    return wb;
  };

  it('F1051: no header row found: the window still opens, reads the first row as the headings and says so', () => {
    const wb = book();
    const { view } = fakeView(wb);
    const ui = new SheetOutline({ view: view as never, edit: () => {}, flash: vi.fn(), table: () => ({ data: range(0, 0, 3, 2), header: null }) });
    ui.subtotal();
    const d = lastDialog();
    expect(d.textContent).toContain('No header row was found, so row 1 is read as the headings');
    const names = [...d.querySelectorAll('select')[0].querySelectorAll('option')].map((o) => o.textContent);
    expect(names).toEqual(['Solvent', 'Note', 'Yield']);
  });

  it('F1052: the numeric column is ticked though its first data row is blank', () => {
    const wb = book();
    const { view } = fakeView(wb);
    const ui = new SheetOutline({ view: view as never, edit: () => {}, flash: vi.fn(), table: () => ({ data: range(1, 0, 3, 2), header: 0 }) });
    ui.subtotal();
    const d = lastDialog();
    const ticked = [...d.querySelectorAll('fieldset label')].filter((l) => l.querySelector<HTMLInputElement>('input')!.checked).map((l) => l.textContent);
    expect(ticked).toEqual(['Yield']);
  });

  it('F1053: OK on another sheet does not insert subtotal rows there', async () => {
    const wb = book();
    const { view, state } = fakeView(wb);
    const ui = new SheetOutline({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(view.sheet)), flash: vi.fn(), table: () => ({ data: range(1, 0, 3, 2), header: 0 }) });
    ui.subtotal();
    const d = lastDialog();
    // (a column ticked on purpose, so the window gets as far as the sheet check)
    for (const l of d.querySelectorAll('fieldset label')) if (l.textContent === 'Yield') l.querySelector('input')!.checked = true;
    state.cur = 1;
    await submit(d);
    expect(d.querySelector('.tool-error')!.textContent).toContain('Go back to Sheet1');
    expect(wb.sheets[1].lastRow).toBe(-1);
    expect(wb.canUndo()).toBe(true); // (only the typing of the data above)
    expect(wb.undoLabel).not.toBe('Subtotal');
  });
});

// ---------------------------------------------------------------- charts

describe('F245: a chart of one cell in a long table', () => {
  it('takes in all 12,000 rows, not the first 10,000', () => {
    const wb = new Workbook(['Sheet1']);
    const s = wb.sheets[0];
    wb.edit('fill', () => {
      s.setInput(0, 0, 'x'); s.setInput(0, 1, 'y');
      for (let r = 1; r <= 12000; r++) { s.setInput(r, 0, String(r)); s.setInput(r, 1, String(r * 2)); }
    });
    const { view } = fakeView(wb, range(5, 0, 5, 0));
    const charts = new SheetCharts({ view: view as never, flash: vi.fn(), edit: (l, fn) => wb.edit(l, () => fn(s)) });
    const t0 = Date.now();
    charts.insert('scatter');
    expect(Date.now() - t0).toBeLessThan(5000);
    const c = s.charts[0];
    expect(c.series[0].y).toContain('$B$2:$B$12001');
  }, 30000);
});

describe('F1018 and F1020: the chart type and the Insert into Cells note', () => {
  const chartOf = () => {
    const wb = new Workbook(['Sheet1']);
    wb.edit('fill', () => { for (let r = 0; r < 5; r++) { wb.sheets[0].setInput(r, 0, String(r)); wb.sheets[0].setInput(r, 1, String(r * 3)); } });
    return { wb, chart: chartFromRange(wb.sheets[0], range(0, 0, 4, 1), 'column') };
  };

  it('F1018: Pie and back to Column keeps the grid lines', () => {
    const { wb, chart } = chartOf();
    const { view } = fakeView(wb);
    let kept = { ...chart, y: { ...chart.y, grid: true } };
    const charts = new SheetCharts({ view: view as never, flash: vi.fn(), edit: () => {} });
    charts.target = { get: () => kept, set: (c) => { kept = c; }, remove: () => {} };
    charts.setKind('pie');
    charts.setKind('column');
    expect(kept.kind).toBe('column');
    expect(kept.y.grid).toBe(true);
    // a chart that had them off still has them off
    kept = { ...kept, y: { ...kept.y, grid: false } };
    charts.setKind('pie');
    charts.setKind('line');
    expect(kept.y.grid).toBe(false);
  });

  it('F1020: the note promises only what is written', async () => {
    const { wb } = chartOf();
    const { view } = fakeView(wb);
    const scatter = chartFromRange(wb.sheets[0], range(0, 0, 4, 1), 'scatter');
    const charts = new SheetCharts({ view: view as never, flash: vi.fn(), edit: () => {} });
    charts.target = { get: () => scatter, set: () => {}, remove: () => {} };
    const done = charts.fitToCells(0);
    await wait(5);
    const d = lastDialog();
    // (the note sits behind the "i" beside the title)
    const note = d.textContent + [...d.querySelectorAll<HTMLElement>('[data-tip]')].map((i) => i.dataset.tip).join(' ');
    expect(note).toContain('STEYX');
    expect(note).not.toContain('LINEST');
    buttonOf(d, 'Cancel').click();
    await done;
  });
});

// ---------------------------------------------------------------- Compound look-ups

describe('F246 and F1023: Compound cards are written back to the cells they were looked up for', () => {
  // PubChem CID 2244 is aspirin (acetylsalicylic acid), molecular weight 180.16 g/mol
  const aspirin: CompoundCard = { cid: 2244, name: 'Aspirin', fields: { Name: 'Aspirin', Formula: 'C9H8O4', 'Molecular weight': 180.16 } };
  const make = (cells: Record<string, string>) => {
    const wb = new Workbook(['Sheet1']);
    const s = wb.sheets[0];
    wb.edit('fill', () => { for (const [a, v] of Object.entries(cells)) s.setInput(Number(a.slice(1)) - 1, a.charCodeAt(0) - 65, v); });
    const { view } = fakeView(wb, range(0, 0, 0, 0));
    const flash = vi.fn();
    const ui = new SheetCompounds({ view: view as never, flash, edit: () => {}, editSheet: (sh, l, fn) => { wb.edit(l, () => fn(sh)); return true; } });
    return { wb, s, ui, flash };
  };

  it('F246: a name with a space after it is still made into a compound, and counted once', async () => {
    pubchem.card = async () => ({ ...aspirin });
    const { s, ui, flash } = make({ A1: 'Aspirin ' });
    expect(s.values.get(0)).toBe('Aspirin ');
    await ui.convert(false);
    expect(s.cell(0, 0)?.compound?.cid).toBe(2244);
    expect(String(flash.mock.calls.at(-1)?.[0])).toContain('Made 1 compound.');
  });

  it('F246: says so, rather than "Made 1 compound", when the cell changed meanwhile', async () => {
    let release!: () => void;
    pubchem.card = () => new Promise((r) => { release = () => r({ ...aspirin }); });
    const { s, wb, ui, flash } = make({ A1: 'Aspirin' });
    const done = ui.convert(false);
    await wait(1);
    wb.edit('typed over', () => s.setInput(0, 0, 'Caffeine'));
    release();
    await done;
    expect(s.cell(0, 0)?.compound).toBeUndefined();
    expect(String(flash.mock.calls.at(-1)?.[0])).not.toContain('Made');
  });

  it('F1023: Refresh does not bring a card back to a cell turned into text meanwhile', async () => {
    let release!: () => void;
    const { s, wb, ui } = make({ A1: 'Aspirin' });
    wb.edit('card', () => s.setCompound(0, 0, aspirin));
    pubchem.card = () => new Promise((r) => { release = () => r({ ...aspirin, fields: { ...aspirin.fields, Formula: 'C9H8O4' } }); });
    const done = ui.refreshCards();
    await wait(1);
    wb.edit('Convert to Text', () => s.setCompound(0, 0, undefined));
    release();
    await done;
    expect(s.cell(0, 0)?.compound).toBeUndefined();
  });

  it('F1023: Refresh still refreshes a card that is where it was', async () => {
    const { s, wb, ui } = make({ A1: 'Aspirin' });
    wb.edit('card', () => s.setCompound(0, 0, aspirin));
    pubchem.card = async () => ({ ...aspirin, fields: { ...aspirin.fields, 'Molecular weight': 180.16, Extra: 'new' } });
    await ui.refreshCards();
    expect(s.cell(0, 0)?.compound?.fields.Extra).toBe('new');
  });
});

// ---------------------------------------------------------------- sparklines

describe('F262 and F1066: sparkline groups go where they were made', () => {
  const fill = (wb: Workbook) => wb.edit('fill', () => {
    for (const s of wb.sheets) for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) s.setInput(r, c, String(r + c));
  });

  it('F262: OK pressed while another sheet shows puts the group on the sheet the window was opened on', async () => {
    const wb = new Workbook(['Sheet1', 'Sheet2']);
    fill(wb);
    const { view, state } = fakeView(wb, range(0, 0, 0, 0));
    const ui = new SheetSparklines({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(view.sheet)), flash: vi.fn() });
    ui.insert('line');
    const d = document.querySelector('dialog.tool-window') as HTMLElement;
    const [data, place] = [...d.querySelectorAll<HTMLInputElement>('input.ref-box')];
    data.value = 'Sheet2!$B$2:$F$6';
    place.value = '$G$2:$G$6';
    state.cur = 1;
    await submit(d);
    expect(wb.sheets[0].sparklines.length).toBe(1);
    expect(wb.sheets[0].sparklines[0].items[0]).toMatchObject({ row: 1, col: 6 });
    expect(wb.sheets[1].sparklines.length).toBe(0);
    // Undo shows the sheet that was edited, not the one that showed when OK was pressed
    expect(wb.undo()?.sheet).toBe(wb.sheets[0]);
    expect(wb.sheets[0].sparklines.length).toBe(0);
  });

  it('F1066: moving a group onto another group\'s cells takes them from it', async () => {
    const wb = new Workbook(['Sheet1']);
    fill(wb);
    const s = wb.sheets[0];
    const a = makeSparklines('line', range(1, 1, 4, 3), range(1, 5, 4, 5));
    const b = makeSparklines('column', range(1, 1, 4, 3), range(1, 6, 4, 6));
    if (typeof a === 'string' || typeof b === 'string') throw new Error('sparklines');
    wb.edit('groups', () => s.setSparklines([a, b]));
    const { view } = fakeView(wb, range(1, 5, 1, 5));
    const ui = new SheetSparklines({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(s)), flash: vi.fn() });
    (ui as unknown as { editGroup(): void }).editGroup();
    const d = document.querySelector('dialog.tool-window') as HTMLElement;
    const [, place] = [...d.querySelectorAll<HTMLInputElement>('input.ref-box')];
    place.value = '$G$2:$G$5';
    await submit(d);
    const cells = s.sparklines.flatMap((g) => g.items.map((it) => `${it.row},${it.col}`));
    expect(new Set(cells).size).toBe(cells.length);
    // the second group lost all its cells, so it is gone, and the first holds column G
    expect(s.sparklines.length).toBe(1);
    expect(s.sparklines[0].items.every((it) => it.col === 6)).toBe(true);
  });
});

// ---------------------------------------------------------------- the Formulas tab

describe('Formulas tab', () => {
  const make = (cells: Record<string, string>, sheets = ['Sheet1']) => {
    const wb = new Workbook(sheets);
    wb.edit('fill', () => { for (const [a, v] of Object.entries(cells)) wb.sheets[0].setInput(Number(a.slice(1)) - 1, a.charCodeAt(0) - 65, v); });
    wb.build(() => {});
    const { view } = fakeView(wb, range(0, 0, 0, 0));
    const flash = vi.fn();
    const ui = new SheetFormulas({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(view.sheet)), flash });
    return { wb, view, ui, flash };
  };
  const val = (wb: Workbook, r: number, c: number, sheet = 0) => { const v = wb.sheets[sheet].value(r, c); return v instanceof CellError ? v.code : v; };

  describe('F250: Insert Function on a formula with two calls', () => {
    it('opens the list of functions, and leaves the formula as it is', async () => {
      const { wb, ui } = make({ A1: '=IF(B1>0,1,2)+IF(C1>0,3,4)' });
      ui.insertFunction();
      expect(lastDialog().querySelector('h2')!.textContent).toBe('Insert Function');
      expect(wb.sheets[0].cell(0, 0)?.input).toBe('=IF(B1>0,1,2)+IF(C1>0,3,4)');
    });
    it('also for =ROUND(A1,2)+MAX(B1,B2)', () => {
      const { ui } = make({ A1: '=ROUND(B1,2)+MAX(B1,B2)' });
      ui.insertFunction();
      expect(lastDialog().querySelector('h2')!.textContent).toBe('Insert Function');
    });
    it('a single call still opens its arguments, with a bracket and quotes inside them', () => {
      const { ui } = make({ A1: '=IF(B1>0,"a,)b",MAX(1,2))' });
      ui.insertFunction();
      expect(lastDialog().querySelector('h2')!.textContent).toBe('Function Arguments');
      const boxes = [...lastDialog().querySelectorAll<HTMLInputElement>('.fx-args input')];
      expect(boxes.map((b) => b.value)).toEqual(['B1>0', '"a,)b"', 'MAX(1,2)']);
    });
  });

  describe('F1033 to F1036: names', () => {
    it('F1033: Esc on New Name takes the window out of the page', async () => {
      const { ui } = make({});
      void ui.defineName();
      const d = document.querySelector('dialog.nm-edit') as HTMLDialogElement;
      expect(d).not.toBeNull();
      d.dispatchEvent(new Event('cancel', { cancelable: true }));
      await wait(2);
      expect(document.querySelector('dialog.nm-edit')).toBeNull();
    });

    it('F1035: Enter in the Name Manager\'s Filter box leaves the window open, and Close closes it', () => {
      const { ui } = make({});
      ui.nameManager();
      const d = document.querySelector('dialog.nm-dialog') as HTMLDialogElement;
      const filter = d.querySelector<HTMLInputElement>('input[type=search]')!;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      filter.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      const close = buttonOf(d, 'Close');
      expect(close.type).toBe('button');
      close.click();
      expect(document.querySelector('dialog.nm-dialog')).toBeNull();
    });

    it('F1034: renaming a sheet\'s own name leaves a formula that uses the workbook name alone', async () => {
      const { wb, ui } = make({ B1: '=Rate*2', C1: '=Rate' }, ['Sheet1', 'Sheet2']);
      wb.edit('names', () => {
        wb.setNames([
          { name: 'Rate', formula: '=Sheet1!$A$1' },
          { name: 'Rate', formula: '=Sheet2!$A$1', sheet: wb.sheets[1] },
        ]);
        wb.sheets[0].setInput(0, 0, '5');
        wb.sheets[1].setInput(0, 0, '7');
        wb.sheets[1].setInput(0, 1, '=Rate*3');
      });
      expect(val(wb, 0, 1)).toBe(10);
      expect(val(wb, 0, 1, 1)).toBe(21);
      ui.nameManager();
      const mgr = document.querySelector('dialog.nm-dialog') as HTMLDialogElement;
      const row = [...mgr.querySelectorAll('tbody tr')].find((tr) => tr.children[3]?.textContent === 'Sheet2') as HTMLElement;
      row.click();
      buttonOf(mgr, 'Edit…').click();
      await wait(2);
      const edit = document.querySelector('dialog.nm-edit') as HTMLDialogElement;
      edit.querySelector<HTMLInputElement>('input')!.value = 'Rate2';
      await submit(edit);
      expect(wb.sheets[0].cell(0, 1)?.input).toBe('=Rate*2');
      expect(val(wb, 0, 1)).toBe(10);
      // Sheet2's own formula followed its own name
      expect(wb.sheets[1].cell(0, 1)?.input).toBe('=Rate2*3');
      expect(val(wb, 0, 1, 1)).toBe(21);
    });

    it('F1034: renaming the workbook name leaves the formula that uses the sheet\'s own name alone', async () => {
      const { wb, ui } = make({ B1: '=Rate*2' }, ['Sheet1', 'Sheet2']);
      wb.edit('names', () => {
        wb.setNames([
          { name: 'Rate', formula: '=Sheet1!$A$1' },
          { name: 'Rate', formula: '=Sheet2!$A$1', sheet: wb.sheets[1] },
        ]);
        wb.sheets[1].setInput(0, 1, '=Rate*3');
      });
      ui.nameManager();
      const mgr = document.querySelector('dialog.nm-dialog') as HTMLDialogElement;
      (([...mgr.querySelectorAll('tbody tr')].find((tr) => tr.children[3]?.textContent === 'Workbook')) as HTMLElement).click();
      buttonOf(mgr, 'Edit…').click();
      await wait(2);
      const edit = document.querySelector('dialog.nm-edit') as HTMLDialogElement;
      edit.querySelector<HTMLInputElement>('input')!.value = 'Rate1';
      await submit(edit);
      expect(wb.sheets[0].cell(0, 1)?.input).toBe('=Rate1*2');
      expect(wb.sheets[1].cell(0, 1)?.input).toBe('=Rate*3');
    });

    describe('F1036: Create Names from Selection and a name already in the workbook', () => {
      it('asks first; Replace points the name at the new cells', async () => {
        const wb = new Workbook(['Sheet1']);
        wb.edit('fill', () => { const s = wb.sheets[0]; s.setInput(0, 0, 'Yields'); s.setInput(1, 0, '1'); s.setInput(2, 0, '2'); s.setInput(0, 1, 'Other'); s.setInput(1, 1, '3'); s.setInput(2, 1, '4'); });
        wb.build(() => {});
        wb.edit('name', () => wb.setNames([{ name: 'Yields', formula: '=Sheet1!$C$2:$C$3' }]));
        const { view } = fakeView(wb, range(0, 0, 2, 1));
        const flash = vi.fn();
        const ui = new SheetFormulas({ view: view as never, edit: () => {}, flash });
        ui.createFromSelection();
        await submit(lastDialog());
        await wait(5);
        const ask = lastDialog();
        expect(ask.querySelector('h2')!.textContent).toBe('Replace Names?');
        expect(ask.textContent).toContain('Yields');
        // nothing has changed yet
        expect(wb.names.find((n) => n.name === 'Yields')!.formula).toBe('=Sheet1!$C$2:$C$3');
        buttonOf(ask, 'Replace').click();
        await wait(5);
        expect(wb.names.find((n) => n.name === 'Yields')!.formula).toBe('=Sheet1!$A$2:$A$3');
        expect(wb.names.find((n) => n.name === 'Other')).toBeTruthy();
        expect(String(flash.mock.calls.at(-1)?.[0])).toContain('Replaced: Yields');
      });

      it('Cancel keeps the name and makes only the others', async () => {
        const wb = new Workbook(['Sheet1']);
        wb.edit('fill', () => { const s = wb.sheets[0]; s.setInput(0, 0, 'Yields'); s.setInput(1, 0, '1'); s.setInput(2, 0, '2'); s.setInput(0, 1, 'Other'); s.setInput(1, 1, '3'); s.setInput(2, 1, '4'); });
        wb.build(() => {});
        wb.edit('name', () => wb.setNames([{ name: 'Yields', formula: '=Sheet1!$C$2:$C$3' }]));
        const { view } = fakeView(wb, range(0, 0, 2, 1));
        const flash = vi.fn();
        const ui = new SheetFormulas({ view: view as never, edit: () => {}, flash });
        ui.createFromSelection();
        await submit(lastDialog());
        await wait(5);
        buttonOf(lastDialog(), 'Cancel').click();
        await wait(5);
        expect(wb.names.find((n) => n.name === 'Yields')!.formula).toBe('=Sheet1!$C$2:$C$3');
        expect(wb.names.find((n) => n.name === 'Other')!.formula).toBe('=Sheet1!$B$2:$B$3');
        expect(String(flash.mock.calls.at(-1)?.[0])).toContain('Skipped: Yields');
      });
    });
  });
});
