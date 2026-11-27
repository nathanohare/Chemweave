// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 27 (spreadsheet analysis windows): Moving Average and Exponential
// Smoothing across sheets (F241) and on a whole column (F242), the one undo step of Goal Seek and
// Solver (F243), Data Table on the sheet it was set up on (F244), Solver's Constraint box and
// options (F1014, F1015), Number of Samples and Random Numbers typed as words (F1012).
//
// Expected values come from arithmetic done by hand, and from Excel's own rules:
//  - a reference to cells on another sheet is written Sheet1!A1:A3, the sheet's name once at the
//    front of the range (Microsoft Support, "Create a cell reference to another worksheet");
//  - the vertex of y = 10 - (x - 3)^2 is at x = 3 (the Solver test);
//  - Goal Seek on B1 = A1^2 for the value 9 finds A1 = 3 (the positive root of x^2 = 9).

import { describe, it, expect, vi } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import { movingAverage, expSmoothing, sample, randomNumbers } from '../src/sheet/analysis-tools';
import { SheetAnalysis } from '../src/ui/sheet-analysis-ui';
import { ToolWindow } from '../src/ui/tool-window';

const D = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
D.show ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
D.close ??= function (this: HTMLDialogElement) { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const val = (wb: Workbook, sheet: number, r: number, c: number) => {
  const v = wb.sheets[sheet].value(r, c);
  return v instanceof CellError ? v.code : v;
};

/** A workbook with numbers 1..n down Sheet1!A, and a view that shows the sheet `cur` points at. */
function setup(sheets: string[], n = 5) {
  const wb = new Workbook(sheets);
  wb.edit('fill', () => { for (let r = 0; r < n; r++) wb.sheets[0].setInput(r, 0, String(r + 1)); });
  wb.build(() => {});
  const state = { cur: 0, sel: { r1: 0, c1: 0, r2: 0, c2: 0 } };
  const view = {
    wb,
    get sheet() { return wb.sheets[state.cur]; },
    get sel() { return { range: state.sel, active: { r: state.sel.r1, c: state.sel.c1 } }; },
    commitEdit() {}, goSheet(i: number) { state.cur = i; }, select() {}, refresh() {}, focus() {}, place: () => undefined,
  };
  const flash = vi.fn();
  const ui = new SheetAnalysis({ view: view as never, edit: (l, fn) => wb.edit(l, () => fn(view.sheet)), flash });
  return { wb, state, view, ui, flash };
}

const open = () => [...document.querySelectorAll('dialog.tool-window')].pop() as HTMLDialogElement;
const refBoxes = (d: HTMLElement) => [...d.querySelectorAll<HTMLInputElement>('input.ref-box')];
const submit = async (d: HTMLElement) => {
  d.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await wait(5);
};
const button = (d: HTMLElement, text: string) => [...d.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

describe('F241: Moving Average and Exponential Smoothing from another sheet', () => {
  it('names the other sheet once at the front of each range', () => {
    const refs = ['Sheet1!A1', 'Sheet1!A2', 'Sheet1!A3', 'Sheet1!A4'];
    const ma = movingAverage(refs, 3, true);
    if (typeof ma === 'string') throw new Error(ma);
    expect(ma.cells[2][0]).toEqual({ f: '=AVERAGE(Sheet1!A1:A3)' });
    expect(JSON.stringify(ma.cells)).not.toContain('Sheet1!A1:Sheet1!');
    const es = expSmoothing(['Sheet1!A1', 'Sheet1!A2', 'Sheet1!A3', 'Sheet1!A4', 'Sheet1!A5'], 0.3, true);
    if (typeof es === 'string') throw new Error(es);
    expect(JSON.stringify(es.cells)).toContain('SUMXMY2(Sheet1!A3:A5,');
    expect(JSON.stringify(es.cells)).not.toContain(':Sheet1!');
  });

  it('a sheet name with spaces is quoted once', () => {
    const ma = movingAverage(["'My Data'!A1", "'My Data'!A2", "'My Data'!A3"], 3, false);
    if (typeof ma === 'string') throw new Error(ma);
    expect(ma.cells[2][0]).toEqual({ f: "=AVERAGE('My Data'!A1:A3)" });
  });

  it('writes forecasts (not syntax errors) on Sheet2 from numbers on Sheet1', async () => {
    const { wb, state, ui } = setup(['Sheet1', 'Sheet2']);
    state.cur = 1;
    (ui as unknown as { openTool(t: string): void }).openTool('Moving Average');
    const d = open();
    const [input, output] = refBoxes(d);
    input.value = 'Sheet1!$A$1:$A$5';
    output.value = '$A$1';
    await submit(d);
    // the average of 1,2,3 is 2; of 2,3,4 is 3; of 3,4,5 is 4
    expect(val(wb, 1, 2, 0)).toBe(2);
    expect(val(wb, 1, 3, 0)).toBe(3);
    expect(val(wb, 1, 4, 0)).toBe(4);
    expect(wb.sheets[1].cell(2, 0)?.input).toBe('=AVERAGE(Sheet1!A1:A3)');
  });

  it('writes the standard errors with a readable range too', async () => {
    const { wb, state, ui } = setup(['Sheet1', 'Sheet2'], 8);
    state.cur = 1;
    (ui as unknown as { openTool(t: string): void }).openTool('Exponential Smoothing');
    const d = open();
    const [input, output] = refBoxes(d);
    input.value = 'Sheet1!$A$1:$A$8';
    output.value = '$A$1';
    [...d.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((b) => b.parentElement?.textContent === 'Standard Errors')!.checked = true;
    await submit(d);
    for (let r = 1; r < 8; r++) expect(val(wb, 1, r, 0), `forecast ${r}`).not.toBe('#NAME?');
    expect(wb.sheets[1].value(1, 0)).toBe(1);
    const f = wb.sheets[1].cell(6, 1)?.input ?? '';
    expect(f).toMatch(/^=SQRT\(SUMXMY2\(Sheet1!A5:A7,/);
    expect(typeof wb.sheets[1].value(6, 1)).toBe('number');
  });
});

describe('F242: a whole column as the input range', () => {
  it('writes only as many forecasts as there are numbers', async () => {
    const { wb, ui } = setup(['Sheet1'], 20);
    (ui as unknown as { openTool(t: string): void }).openTool('Moving Average');
    const d = open();
    const [input, output] = refBoxes(d);
    input.value = 'A:A';
    output.value = '$C$1';
    await submit(d);
    const s = wb.sheets[0];
    expect(s.cell(19, 2)?.input).toBe('=AVERAGE(A18:A20)');
    expect(s.cell(20, 2)).toBeUndefined();
    expect(s.lastRow).toBe(19);
  }, 20000);
});

describe('F243: Goal Seek and Solver take one undo step, and Cancel leaves none', () => {
  function goalSeekOn(ui: SheetAnalysis, state: { sel: { r1: number; c1: number; r2: number; c2: number } }) {
    state.sel = { r1: 1, c1: 0, r2: 1, c2: 0 };
    ui.goalSeekWindow();
    const d = open();
    const [set, by] = refBoxes(d);
    set.value = '$B$1';
    by.value = '$A$1';
    d.querySelector<HTMLInputElement>('input[inputmode=decimal]')!.value = '9';
    return d;
  }
  const model = () => {
    const w = setup(['Sheet1'], 0);
    w.wb.edit('fill', () => { w.wb.sheets[0].setInput(0, 0, '2'); w.wb.sheets[0].setInput(0, 1, '=A1^2'); });
    w.wb.build(() => {});
    return w;
  };

  it('Cancel puts the cell back and leaves nothing to undo or redo', async () => {
    const { wb, ui, state } = model();
    const d = goalSeekOn(ui, state);
    await submit(d);
    await wait(5);
    expect(wb.sheets[0].value(0, 0)).toBeCloseTo(3, 2);
    button(open(), 'Cancel').click();
    expect(wb.sheets[0].value(0, 0)).toBe(2);
    expect(wb.canUndo()).toBe(false);
    expect(wb.canRedo()).toBe(false);
  });

  it('OK keeps the answer as one step', async () => {
    const { wb, ui, state } = model();
    await submit(goalSeekOn(ui, state));
    await wait(5);
    button(open(), 'OK').click();
    expect(wb.sheets[0].value(0, 0)).toBeCloseTo(3, 2);
    expect(wb.undoLabel).toBe('Goal Seek');
    wb.undo();
    expect(wb.sheets[0].value(0, 0)).toBe(2);
    expect(wb.canUndo()).toBe(false);
  });

  /** y = 10 - (x - 3)^2 in B1, with x in A1 (starting at 1): the best x is 3. */
  async function solve() {
    const w = setup(['Sheet1'], 0);
    w.wb.edit('fill', () => { w.wb.sheets[0].setInput(0, 0, '1'); w.wb.sheets[0].setInput(0, 1, '=10-(A1-3)^2'); });
    w.wb.build(() => {});
    w.ui.solverWindow();
    const d = open();
    const [objective, vars] = refBoxes(d);
    objective.value = '$B$1';
    vars.value = '$A$1';
    await submit(d);
    await wait(120);
    return { ...w, results: open() };
  }

  it('Solver: switching Keep and Restore and pressing Cancel leaves only the model step, and the cell as it was', async () => {
    const { wb, results } = await solve();
    expect(results.querySelector('h2')!.textContent).toBe('Solver Results');
    expect(wb.sheets[0].value(0, 0)).toBeCloseTo(3, 2);
    const radios = [...results.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    for (const i of [1, 0, 1, 0]) { radios[i].checked = true; radios[i].dispatchEvent(new Event('change')); }
    expect(wb.sheets[0].value(0, 0)).toBeCloseTo(3, 2);
    button(results, 'Cancel').click();
    expect(wb.sheets[0].value(0, 0)).toBe(1);
    // the model is kept (one step); nothing else
    expect(wb.undoLabel).toBe('Solver model');
    wb.undo();
    expect(wb.canUndo()).toBe(false);
  });

  it('Solver: OK with the answer and a report is one step', async () => {
    const { wb, results } = await solve();
    const report = [...results.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0];
    report.checked = true;
    button(results, 'OK').click();
    expect(wb.sheetNamed('Sheet1')!.value(0, 0)).toBeCloseTo(3, 2);
    expect(wb.sheets.length).toBe(2);
    expect(wb.undoLabel).toBe('Solver');
    wb.undo();
    expect(wb.sheets.length).toBe(1);
    expect(wb.sheets[0].value(0, 0)).toBe(1);
    expect(wb.names.length).toBe(0);
    expect(wb.canUndo()).toBe(false);
  });
});

describe('F244: Data Table is made on the sheet it was set up on', () => {
  it('clears and sets up the table on Sheet1 even when Sheet2 shows by the time OK is pressed', async () => {
    const { wb, state, ui } = setup(['Sheet1', 'Sheet2'], 0);
    wb.edit('fill', () => {
      // a column of input values with the formula over the results
      wb.sheets[0].setInput(0, 1, '=D1*2');
      for (let r = 1; r < 5; r++) wb.sheets[0].setInput(r, 0, String(r));
      wb.sheets[1].setInput(1, 1, 'keep me');
    });
    wb.build(() => {});
    state.sel = { r1: 0, c1: 0, r2: 4, c2: 1 };
    ui.dataTableWindow();
    const d = open();
    state.cur = 1;
    const [, col] = refBoxes(d);
    col.value = '$D$1';
    await submit(d);
    expect(wb.sheets[0].dataTables.length).toBe(1);
    expect(wb.sheets[1].dataTables.length).toBe(0);
    expect(wb.sheets[1].cell(1, 1)?.input).toBe('keep me');
    wb.undo();
    expect(wb.sheets[0].dataTables.length).toBe(0);
  });
});

describe('F1014: the Constraint box follows the Relation of the constraint picked in the list', () => {
  it('is greyed for int and open again for <=', async () => {
    const { ui } = setup(['Sheet1'], 3);
    ui.solverWindow();
    const d = open();
    const [, , lhs, rhs] = refBoxes(d);
    const rel = [...d.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'int'))!;
    const add = button(d, 'Add');
    const list = d.querySelector<HTMLSelectElement>('select.tool-list')!;
    lhs.value = '$A$1'; rhs.value = '5'; rel.value = '<='; add.click();
    lhs.value = '$B$1'; rel.value = 'int'; rel.dispatchEvent(new Event('change')); add.click();
    expect(list.options.length).toBe(2);
    // pick the int constraint, then the <= one
    list.selectedIndex = 1; list.dispatchEvent(new Event('change'));
    expect(rel.value).toBe('int');
    expect(rhs.disabled).toBe(true);
    list.selectedIndex = 0; list.dispatchEvent(new Event('change'));
    expect(rel.value).toBe('<=');
    expect(rhs.value).toBe('5');
    expect(rhs.disabled).toBe(false);
  });
});

describe('F1015: an option of 0 stays 0', () => {
  it('Integer Optimality of 0% is saved as 0, not 1%', async () => {
    const { wb, ui } = setup(['Sheet1'], 0);
    wb.edit('fill', () => { wb.sheets[0].setInput(0, 0, '1'); wb.sheets[0].setInput(0, 1, '=10-(A1-3)^2'); });
    ui.solverWindow();
    const d = open();
    const [objective, vars] = refBoxes(d);
    objective.value = '$B$1';
    vars.value = '$A$1';
    const box = (label: string) => [...d.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
    box('Integer Optimality').value = '0';
    box('Constraint Precision').value = '0';
    button(d, 'Close (Keep Model)').click();
    const { modelFromNames } = await import('../src/sheet/solver');
    const m = modelFromNames(wb.names, wb.sheets[0])!;
    expect(m.intTolerance).toBe(0);
    expect(m.precision).toBe(0);
  });
});

describe('F1012: Number of Samples and Random Numbers typed as words', () => {
  it('sample() and randomNumbers() refuse a count that is not a number', () => {
    expect(typeof sample([1, 2, 3], { random: NaN }, () => 0.5)).toBe('string');
    expect(typeof sample([1, 2, 3], { periodic: NaN }, () => 0.5)).toBe('string');
    expect(typeof randomNumbers({ kind: 'uniform', from: 0, to: 1 }, 1, NaN, () => 0.5)).toBe('string');
  });

  it('the Sampling window says so', async () => {
    const { wb, ui } = setup(['Sheet1'], 5);
    (ui as unknown as { openTool(t: string): void }).openTool('Sampling');
    const d = open();
    refBoxes(d)[0].value = '$A$1:$A$5';
    refBoxes(d)[1].value = '$C$1';
    const radios = [...d.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    radios.find((r) => r.value === 'random')!.checked = true;
    const count = [...d.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Number of Samples'))!.querySelector('input')!;
    count.value = 'ten';
    await submit(d);
    expect(d.querySelector('.tool-error')!.textContent).toContain('Number of Samples');
    expect(wb.sheets[0].cell(0, 2)).toBeUndefined();
  });

  it('the Random Number Generation window says so', async () => {
    const { wb, ui } = setup(['Sheet1'], 1);
    (ui as unknown as { openTool(t: string): void }).openTool('Random Number Generation');
    const d = open();
    refBoxes(d)[0] ?? null;
    const boxes = [...d.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Number of Random Numbers'))!.querySelector('input')!;
    boxes.value = 'ten';
    d.querySelector<HTMLInputElement>('input.ref-box')!.value = '$C$1';
    await submit(d);
    expect(d.querySelector('.tool-error')!.textContent).toContain('Number of Random Numbers');
    expect(wb.sheets[0].cell(0, 2)).toBeUndefined();
  });
});

describe('F1016: Solver says it is working before it holds the page', () => {
  it('shows a status line first', async () => {
    const { ui, flash, wb } = setup(['Sheet1'], 0);
    wb.edit('fill', () => { wb.sheets[0].setInput(0, 0, '1'); wb.sheets[0].setInput(0, 1, '=10-(A1-3)^2'); });
    ui.solverWindow();
    const d = open();
    const [objective, vars] = refBoxes(d);
    objective.value = '$B$1';
    vars.value = '$A$1';
    await submit(d);
    expect(flash.mock.calls.some((c) => String(c[0]).startsWith('Solving'))).toBe(true);
    expect(ToolWindow.open).not.toBeNull();
  });
});
