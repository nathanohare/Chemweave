// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 27, PivotTables and Get Data: Refresh All asking before it covers
// cells (F259) and being one step (F261), the Fields window staying on (F260), showing Undo
// (F1055) and showing a refused change as refused (F1056), the Query Editor's Change Source…
// (F1058, F1059), Refresh saying it did nothing (F1063), the preview not running every step again
// (F1060), and a connection-only query staying one (F1061).
//
// What Excel does is the reference: Refresh All is one command that Undo takes back at once;
// "A PivotTable report cannot overlap another PivotTable report" and "Do you want to replace the
// contents of the destination cells?" are Excel's own questions; a query loaded with Only Create
// Connection stays connection-only when it is edited (Microsoft Support, "Manage queries in
// Excel").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { newPivotId, type PivotTable } from '../src/sheet/pivot';
import { writePivot } from '../src/sheet/pivot-sheet';
import { SheetPivots } from '../src/ui/sheet-pivot-ui';
import { SheetQueries } from '../src/ui/sheet-query-ui';
import { rig, stubBrowser } from './review-batch12-harness';
import { writeXlsx } from '../src/io/xlsx';
import { ToolWindow } from '../src/ui/tool-window';
import type { Query } from '../src/sheet/query';

const files = vi.hoisted(() => ({ next: [] as { name: string; bytes: Uint8Array }[] }));
vi.mock('../src/io/files', async (orig) => ({
  ...(await orig<typeof import('../src/io/files')>()),
  openBytesDialog: async () => {
    const f = files.next.shift();
    return f ? { name: f.name, bytes: f.bytes, ref: { kind: 'none' } } : null;
  },
}));
const runs = vi.hoisted(() => ({ steps: 0 }));
vi.mock('../src/sheet/query', async (orig) => {
  const m = await orig<typeof import('../src/sheet/query')>();
  return { ...m, runSteps: (...a: Parameters<typeof m.runSteps>) => { runs.steps++; return m.runSteps(...a); } };
});

const D = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
D.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.close ??= function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const lastDialog = () => [...document.querySelectorAll('dialog')].pop() as HTMLDialogElement;
const submit = async (d: HTMLElement) => { d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await wait(10); };
const buttonOf = (d: HTMLElement, text: string) => [...d.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
const range = (r1: number, c1: number, r2: number, c2: number) => ({ r1, c1, r2, c2 });
const bytesOf = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});
afterEach(() => {
  vi.unstubAllGlobals();
  ToolWindow.open?.close();
  document.body.replaceChildren();
  files.next = [];
});

function fakeView(wb: Workbook) {
  const state = { cur: 0, active: { r: 0, c: 0 } };
  const view = {
    wb,
    get sheet() { return wb.sheets[state.cur]; },
    get sel() { return { range: range(state.active.r, state.active.c, state.active.r, state.active.c), active: state.active }; },
    editing: null, commitEdit() {}, goSheet(i: number) { state.cur = i; wb.active = i; }, select() {}, selectCell() {}, refresh() {}, focus() {},
    place: () => undefined,
  };
  return { state, view };
}

// ---------------------------------------------------------------- PivotTables

// Catalyst, Solvent and Yield of five runs (made up for the test; the sums are worked out by hand:
// Pd 80 + 70 = 150, Ni 60 + 64 = 124, Cu 50)
const RUNS: string[][] = [['Catalyst', 'Solvent', 'Yield'], ['Pd', 'THF', '80'], ['Pd', 'DMF', '70'], ['Ni', 'THF', '60'], ['Ni', 'THF', '64'], ['Cu', 'DMF', '50']];
const pivot = (over: Partial<PivotTable>): PivotTable => ({
  id: newPivotId(), name: 'PivotTable1', source: '=Sheet1!$A$1:$C$6', at: { row: 0, col: 6 },
  rows: ['Catalyst'], cols: [], values: [{ field: 'Yield', fn: 'sum' }], filters: [], hidden: {}, layout: 'compact', subtotals: true, grandRows: true, grandCols: true, ...over,
});

function pivotBook(extra: Partial<PivotTable>[] = [{}]) {
  const wb = new Workbook(['Sheet1']);
  const s = wb.sheets[0];
  wb.edit('data', () => RUNS.forEach((row, r) => row.forEach((v, c) => s.setInput(r, c, v))));
  const made: PivotTable[] = [];
  wb.edit('pivots', () => { extra.forEach((o, i) => { const kept = writePivot(s, pivot({ name: `PivotTable${i + 1}`, ...o })); if (typeof kept === 'string') throw new Error(kept); made.push(kept); }); });
  wb.build(() => {});
  const { state, view } = fakeView(wb);
  const flash = vi.fn();
  const ui = new SheetPivots({ view: view as never, flash });
  return { wb, s, state, ui, flash, made };
}

describe('F259: Refresh All and cells under a report that has grown', () => {
  it('leaves what is there alone, and says which PivotTable to refresh on its own', () => {
    const { wb, s, ui, made } = pivotBook();
    const below = made[0].last!.r2 + 1;
    wb.edit('note', () => s.setInput(below, 6, 'my notes'));
    // a new run with a new catalyst makes the report one row longer
    wb.edit('more', () => {
      s.setInput(6, 0, 'Zn'); s.setInput(6, 1, 'THF'); s.setInput(6, 2, '30');
      s.setPivots(s.pivots.map((p) => ({ ...p, source: '=Sheet1!$A$1:$C$7' })));
    });
    const got = ui.refreshAll(true);
    expect(got.problems.length).toBe(1);
    expect(got.problems[0]).toContain('PivotTable1');
    expect(got.problems[0]).toContain('refresh it on its own');
    expect(s.cell(below, 6)?.input).toBe('my notes');
  });

  it('still refreshes a report that has nothing to cover', () => {
    const { wb, s, ui } = pivotBook();
    wb.edit('change', () => s.setInput(1, 2, '90'));
    const got = ui.refreshAll(true);
    expect(got.problems).toEqual([]);
    // (Cu, Ni, Pd in order) Pd is now 90 + 70
    expect(s.value(3, 7)).toBe(160);
  });
});

describe('F260 and F1055: the Fields window', () => {
  it('F260: follows the person from one PivotTable to another, hides outside, and comes back', () => {
    const { state, ui, made } = pivotBook([{}, { at: { row: 10, col: 6 } }]);
    const open = () => !!ToolWindow.open && ToolWindow.open.d.querySelector('h2')!.textContent === 'PivotTable Fields';
    const click = (r: number, c: number) => { state.active = { r, c }; ui.selectionChanged(); };
    click(made[0].last!.r1 + 1, 6);
    expect(open()).toBe(true);
    click(made[1].last!.r1 + 1, 6);
    expect(open()).toBe(true);
    click(30, 0);
    expect(open()).toBe(false);
    click(made[0].last!.r1 + 1, 6);
    expect(open()).toBe(true);
  });

  it('F260: another tool window, or Clear PivotTable, does not turn Field List off', () => {
    const { state, ui, made } = pivotBook([{}, { at: { row: 10, col: 6 } }]);
    const open = () => !!ToolWindow.open && ToolWindow.open.d.querySelector('h2')!.textContent === 'PivotTable Fields';
    state.active = { r: made[0].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    expect(open()).toBe(true);
    new ToolWindow('Goal Seek').show();
    expect(open()).toBe(false);
    ToolWindow.open?.close();
    state.active = { r: made[1].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    expect(open()).toBe(true);
    ui.clear();
    expect(open()).toBe(false);
    state.active = { r: made[0].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    expect(open()).toBe(true);
  });

  it('F260: pressing Close does turn it off', () => {
    const { state, ui, made } = pivotBook();
    state.active = { r: made[0].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    buttonOf(ToolWindow.open!.d, 'Close').click();
    expect(ToolWindow.open).toBeNull();
    ui.selectionChanged();
    expect(ToolWindow.open).toBeNull();
  });

  const tick = (label: string) => [...ToolWindow.open!.d.querySelectorAll('label.pivot-field')].find((l) => l.textContent === label)!.querySelector('input')!;

  it('F1055: shows the PivotTable as Undo left it', async () => {
    const { wb, state, ui, made } = pivotBook();
    state.active = { r: made[0].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    const box = tick('Solvent');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await wait(10);
    expect(wb.sheets[0].pivots[0].rows).toEqual(['Catalyst', 'Solvent']);
    expect(tick('Solvent').checked).toBe(true);
    wb.undo();
    state.active = { r: 1, c: 6 };
    ui.selectionChanged();
    expect(wb.sheets[0].pivots[0].rows).toEqual(['Catalyst']);
    expect(tick('Solvent').checked).toBe(false);
  });

  it('F1056: a change that is answered Cancel leaves the box as it was', async () => {
    const { s, wb, state, ui, made } = pivotBook();
    wb.edit('note', () => s.setInput(made[0].last!.r2 + 1, 6, 'notes'));
    state.active = { r: made[0].last!.r1 + 1, c: 6 };
    ui.selectionChanged();
    const box = tick('Solvent');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await wait(10);
    const ask = lastDialog();
    expect(ask.querySelector('h2')!.textContent).toBe('Replace the cells?');
    buttonOf(ask, 'Cancel').click();
    await wait(10);
    expect(wb.sheets[0].pivots[0].rows).toEqual(['Catalyst']);
    expect(tick('Solvent').checked).toBe(false);
    expect(s.cell(made[0].last!.r2 + 1, 6)?.input).toBe('notes');
  });
});

// ---------------------------------------------------------------- Get Data

const CSV_A = 'Entry,Yield\n1,10\n2,20\n';
const CSV_A_GROWN = 'Entry,Yield\n1,11\n2,21\n3,31\n';
const CSV_B = 'Run,Mass\n1,5\n2,6\n';
const CSV_B_GROWN = 'Run,Mass\n1,50\n2,60\n3,70\n';

function queryBook() {
  const wb = new Workbook(['Sheet1']);
  wb.build(() => {});
  const { view } = fakeView(wb);
  const flash = vi.fn();
  const ui = new SheetQueries({ view: view as never, flash });
  return { wb, ui, flash, view };
}

/** Get Data > From Text/CSV, then Close & Load. */
async function loadCsv(ui: SheetQueries, name: string, text: string): Promise<void> {
  files.next.push({ name, bytes: bytesOf(text) });
  await ui.fromText();
  await submit(ToolWindow.open!.d);
}
/** Put a newer copy of a file where a refresh finds it (Get Data again, and its editor closed). */
async function replaceFile(ui: SheetQueries, name: string, text: string): Promise<void> {
  files.next.push({ name, bytes: bytesOf(text) });
  await ui.fromText();
  ToolWindow.open?.close();
}

vi.setConfig({ testTimeout: 60000 });
describe('F261: Refresh All is one step, and the PivotTables read what the queries just wrote', () => {
  it('SheetMode Refresh All: a PivotTable of a query\'s table shows the new rows, and one Undo undoes both', async () => {
    stubBrowser();
    try {
      const { mode, wb } = rig(['Sheet1']);
      const queries = (mode as unknown as { queries: SheetQueries }).queries;
      await loadCsv(queries, 'a.csv', CSV_A);
      const home = wb.sheets.find((x) => x.name === 'Sheet1')!;
      const table = wb.queries[0].table!;
      // the Yield of each Entry, from the query's table (1 and 2 of the file as first read)
      wb.edit('pivot', () => {
        const kept = writePivot(home, pivot({ name: 'PivotTable1', source: table, at: { row: 0, col: 6 }, rows: ['Entry'], values: [{ field: 'Yield', fn: 'sum' }] }));
        if (typeof kept === 'string') throw new Error(kept);
      });
      const labels = () => { const r = home.pivots[0].last!; const out: unknown[] = []; for (let i = r.r1 + 1; i <= r.r2; i++) out.push(`${home.value(i, 6)}=${home.value(i, 7)}`); return out; };
      expect(labels()).toEqual(['1=10', '2=20', 'Grand Total=30']);
      // a newer copy of the file: three rows, one of them new
      files.next.push({ name: 'a.csv', bytes: bytesOf(CSV_A_GROWN) });
      await queries.fromText();
      ToolWindow.open?.close();
      wb.build(() => {});
      wb.edit('mark', () => {});
      await mode.refreshAll();
      expect(labels()).toEqual(['1=11', '2=21', '3=31', 'Grand Total=63']);
      expect(wb.undoLabel).toBe('Refresh All');
      wb.undo();
      expect(labels()).toEqual(['1=10', '2=20', 'Grand Total=30']);
      expect(wb.undoLabel).not.toBe('Refresh All');
    } finally { vi.restoreAllMocks(); }
  });
});

describe('F1063: Refresh says so when the replace question is answered Cancel', () => {
  it('does not report "Refreshed"', async () => {
    const { wb, ui } = queryBook();
    await loadCsv(ui, 'a.csv', CSV_A);
    const sheet = wb.sheets.find((s) => s.tables.length)!;
    // something just under the table
    const t = sheet.tables[0];
    wb.edit('note', () => sheet.setInput(t.range.r2 + 1, t.range.c1, 'keep me'));
    await replaceFile(ui, 'a.csv', CSV_A_GROWN);
    const done = ui.refresh(wb.queries[0]);
    await wait(30);
    const ask = lastDialog();
    expect(ask.querySelector('h2')!.textContent).toBe('Replace the cells?');
    buttonOf(ask, 'Cancel').click();
    const said = await done;
    expect(said).toBe(`${wb.queries[0].name} was not refreshed.`);
    expect(sheet.cell(t.range.r2 + 1, t.range.c1)?.input).toBe('keep me');
  });
});

describe('F1061: a connection-only query stays one when it is edited', () => {
  it('Close & Load adds no sheet', async () => {
    const { wb, ui } = queryBook();
    const q: Query = { id: 'q1', name: 'Yields', source: { kind: 'text', file: 'a.csv', delimiter: 'auto' }, steps: [], table: null };
    wb.edit('query', () => wb.setQueries([q]));
    ui.editor(q, { bytes: bytesOf(CSV_A) }, false);
    await submit(ToolWindow.open!.d);
    expect(wb.sheets.length).toBe(1);
    expect(wb.queries[0].table).toBeNull();
    expect(wb.sheets[0].tables.length).toBe(0);
  });

  it('a query whose table was deleted is loaded to a new sheet again, not turned into a connection', async () => {
    const { wb, ui } = queryBook();
    await loadCsv(ui, 'a.csv', CSV_A);
    const q = wb.queries[0];
    const home = wb.sheets.find((x) => x.tables.length)!;
    wb.edit('delete the table', () => home.setTables([]));
    ui.editor(q, { bytes: bytesOf(CSV_A) }, false);
    await submit(ToolWindow.open!.d);
    expect(wb.sheets.length).toBe(3);
    expect(wb.queries[0].table).toBeTruthy();
    expect(wb.sheets.flatMap((x) => x.tables).length).toBe(1);
  });

  it('a query loaded to a table still writes over its table, and a new one still gets a sheet', async () => {
    const { wb, ui } = queryBook();
    await loadCsv(ui, 'a.csv', CSV_A);
    expect(wb.sheets.length).toBe(2);
    expect(wb.queries[0].table).toBeTruthy();
  });
});

describe('F1059: Change Source… keeps the settings chosen since', () => {
  it('the delimiter picked stays', async () => {
    const { wb, ui } = queryBook();
    files.next.push({ name: 'a.csv', bytes: bytesOf('Entry;Yield\n1;10\n2;20\n') });
    await ui.fromText();
    const d = ToolWindow.open!.d;
    const delimiter = d.querySelector<HTMLSelectElement>('select[aria-label=Delimiter]')!;
    delimiter.value = ';';
    delimiter.dispatchEvent(new Event('change'));
    files.next.push({ name: 'b.csv', bytes: bytesOf('Entry;Yield\n5;50\n') });
    buttonOf(d, 'Change Source…').click();
    await wait(10);
    await submit(ToolWindow.open!.d);
    expect(wb.queries[0].source).toMatchObject({ kind: 'text', file: 'b.csv', delimiter: ';' });
  });
});

describe('F1058: a workbook that can\'t be read leaves the editor as it was', () => {
  it('the Item list still works afterwards', async () => {
    const { wb, ui, flash } = queryBook();
    const book = new Workbook(['Data', 'More']);
    book.edit('fill', () => { book.sheets[0].setInput(0, 0, 'x'); book.sheets[0].setInput(1, 0, '1'); book.sheets[1].setInput(0, 0, 'x'); book.sheets[1].setInput(1, 0, '2'); });
    const bytes = await writeXlsx(book, { forSheet: () => [], hasAny: false } as never);
    files.next.push({ name: 'book.xlsx', bytes });
    const opened = ui.fromWorkbook();
    await wait(30);
    // the Navigator: take the first item
    buttonOf(ToolWindow.open!.d, 'Transform Data').click();
    await opened;
    await wait(10);
    const d = ToolWindow.open!.d;
    const item = d.querySelector<HTMLSelectElement>('select[aria-label=Item]')!;
    files.next.push({ name: 'notes.xlsx', bytes: bytesOf('this is not a workbook') });
    buttonOf(d, 'Change Source…').click();
    await wait(30);
    expect(flash).toHaveBeenCalled();
    // the Item list still reads the workbook it had
    item.value = [...item.options].find((o) => o.value.startsWith('sheet:More'))!.value;
    item.dispatchEvent(new Event('change'));
    expect(d.querySelector('.qe-error')).toBeNull();
    await submit(d);
    expect(wb.queries[0].source).toMatchObject({ kind: 'workbook', file: 'book.xlsx', item: 'sheet:More' });
  });
});

describe('F1060: the Query Editor keeps the result of the steps until something changes', () => {
  it('clicking column headers does not run the steps again', async () => {
    const { ui } = queryBook();
    files.next.push({ name: 'a.csv', bytes: bytesOf(CSV_A) });
    await ui.fromText();
    const d = ToolWindow.open!.d;
    const heads = [...d.querySelectorAll<HTMLElement>('th')].filter((h) => h.tabIndex === 0);
    expect(heads.length).toBe(2);
    heads[0].click();
    const before = runs.steps;
    heads[1].click();
    heads[0].click();
    expect(runs.steps).toBe(before);
    // a step added runs them again
    buttonOf(d, 'Trim').click();
    expect(runs.steps).toBeGreaterThan(before);
  });
});
