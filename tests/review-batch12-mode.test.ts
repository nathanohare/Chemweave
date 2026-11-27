// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 12 (Spreadsheet grid editing), the commands of Sheet mode:
// F252 Fill Down and Fill Right below the data, F253 filter lists of more than 1000 values,
// F254 SMILES pasted in a long column, F255 Strikethrough in copied HTML, F256 Cut and Paste onto
// another sheet, F257 Fit Height and Width in one step, F258 and F1045 sizes and hiding below the
// data, F1038 Insert Link on a long selection, F1040 Delete Rows below the data, F1041 Sort after
// switching sheet, F1042 and F1043 structures that arrive after the sheet is gone, F1044 Copy with
// hidden rows, F1046 Convert Column to Values with errors.
//
// The values are the cells' own; the numbers to expect come from the commands' definitions in Excel's
// documentation (Fill Down copies the top cell of the selection into the cells below it; Delete
// Rows takes out every row selected; Row Height sets every row selected).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rig, stubBrowser, settleFrames } from './review-batch12-harness';
import { MAX_COLS, MAX_ROWS, keyOf } from '../src/sheet/refs';
import { ERR } from '../src/sheet/values';
import { Workbook } from '../src/sheet/workbook';
import { smilesPrefs } from '../src/sheet/smiles-cells';
import type { Contents } from '../src/model';

const asked = vi.hoisted(() => ({ answer: null as Record<string, string> | null }));
vi.mock('../src/ui/ask', async (orig) => ({ ...(await orig<typeof import('../src/ui/ask')>()), ask: async () => asked.answer }));
vi.mock('../src/ui/links-ui', async (orig) => ({ ...(await orig<typeof import('../src/ui/links-ui')>()), askLink: async () => ({ link: 'https://example.com', text: undefined }) }));

// (the page is built afresh for each, which takes a few seconds on a busy computer)
vi.setConfig({ testTimeout: 60000 });
beforeEach(() => { stubBrowser(); asked.answer = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const drawing = { atoms: [{ id: 1 }], bonds: [], captions: [], arrows: [], shapes: [] } as unknown as Contents;
// the commands that menus and keys reach, which the class keeps to itself
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const priv = (m: unknown): any => m;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('F252: Fill Down and Fill Right with cells selected below or beside the data', () => {
  it('Ctrl+D fills the cells selected below the last used row', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(1, 1, '1'); s.setInput(2, 1, '=A3*2'); });
    mode.view.select({ r1: 2, c1: 1, r2: 9, c2: 1 }, { r: 2, c: 1 });
    priv(mode).fillDown();
    expect(s.cell(2, 1)?.input).toBe('=A3*2'); // the source stays
    expect(s.cell(3, 1)?.input).toBe('=A4*2');
    expect(s.cell(9, 1)?.input).toBe('=A10*2');
  });
  it('fills from row 1, where nothing is above', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => s.setInput(0, 1, 'x'));
    mode.view.select({ r1: 0, c1: 1, r2: 9, c2: 1 }, { r: 0, c: 1 });
    priv(mode).fillDown();
    expect(s.cell(9, 1)?.input).toBe('x');
  });
  it('Ctrl+R fills the cells selected right of the last used column', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => s.setInput(0, 0, 'y'));
    mode.view.select({ r1: 0, c1: 0, r2: 0, c2: 5 }, { r: 0, c: 0 });
    priv(mode).fillRight();
    expect(s.cell(0, 5)?.input).toBe('y');
  });
  it('still copies the cell above for one cell selected', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => s.setInput(0, 0, 'top'));
    mode.view.select({ r1: 1, c1: 0, r2: 1, c2: 0 }, { r: 1, c: 0 });
    priv(mode).fillDown();
    expect(s.cell(1, 0)?.input).toBe('top');
  });
});

describe('F253: a filter list with more than 1000 values', () => {
  it('hides only the value unticked, not every row whose value is not listed', async () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'MW'); for (let r = 1; r <= 1500; r++) s.setInput(r, 0, String(r)); });
    wb.edit('f', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 1500, c2: 0 }, conditions: {} }));
    priv(mode).filterMenu(0, { x: 0, y: 0 });
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.filter-menu .fm-values input[type=checkbox]')];
    expect(boxes.length).toBeGreaterThan(900); // the list is shown (cut at 1000)
    boxes[1].checked = false; // the first value
    [...document.querySelectorAll<HTMLButtonElement>('.filter-menu button')].find((b) => b.textContent === 'OK')!.click();
    await tick(); await tick();
    expect([...s.hiddenRows.keys()]).toEqual([1]);
  });
});

describe('F253: one value alone in a filter list of more than 1000 values', () => {
  it('shows only that value when (Select all) is unchecked and one box is checked', async () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'MW'); for (let r = 1; r <= 1500; r++) s.setInput(r, 0, String(r)); });
    wb.edit('f', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 1500, c2: 0 }, conditions: {} }));
    priv(mode).filterMenu(0, { x: 0, y: 0 });
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.filter-menu .fm-values input[type=checkbox]')];
    const all = boxes[0];
    all.checked = false;
    all.dispatchEvent(new Event('change'));
    boxes[2].checked = true; // the second value
    [...document.querySelectorAll<HTMLButtonElement>('.filter-menu button')].find((b) => b.textContent === 'OK')!.click();
    await tick(); await tick();
    const shown = [];
    for (let r = 1; r <= 1500; r++) if (!s.hiddenRows.has(r)) shown.push(r);
    expect(shown).toEqual([2]);
  });
});

describe('F254: SMILES pasted down a long column', () => {
  it('draws no more than 500', async () => {
    const calls: string[] = [];
    const { mode, wb, flashes } = rig(['Sheet1'], { toStructure: async (t: string) => { calls.push(t); return { contents: drawing, notes: [] }; } });
    smilesPrefs.draw = true;
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let r = 0; r < 800; r++) s.setInput(r, 0, 'CC(=O)OC1=CC=CC=C1C(=O)O'); });
    await priv(mode).pastedSmiles(s, { r1: 0, c1: 0, r2: 799, c2: 0 });
    expect(calls.length).toBe(500);
    expect(flashes.some((f) => /500/.test(f))).toBe(true);
    expect(s.cell(499, 0)?.structure).toBeTruthy();
    expect(s.cell(500, 0)?.structure).toBeFalsy();
  });
});

describe('F1042 and F1043: structures that arrive after the sheet changed', () => {
  it('pasted SMILES are not written to a sheet deleted meanwhile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mode, wb } = rig(['A', 'B'], { toStructure: async () => { await gate; return { contents: drawing, notes: [] }; } });
    smilesPrefs.draw = true;
    mode.view.goSheet(1);
    const s = wb.sheets[1];
    wb.edit('t', () => s.setInput(0, 0, 'CC(=O)OC1=CC=CC=C1C(=O)O'));
    const p = priv(mode).pastedSmiles(s, { r1: 0, c1: 0, r2: 0, c2: 0 });
    wb.edit('deleted', () => wb.removeSheet(s));
    release();
    await p;
    expect(wb.undoLabel).toBe('deleted');
  });
  it('drawings that arrive do not finish what is being typed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mode, wb } = rig(['Sheet1'], { toStructure: async () => { await gate; return { contents: drawing, notes: [] }; } });
    smilesPrefs.draw = true;
    const s = wb.sheets[0];
    wb.edit('t', () => s.setInput(0, 0, 'CC(=O)OC1=CC=CC=C1C(=O)O'));
    const p = priv(mode).pastedSmiles(s, { r1: 0, c1: 0, r2: 0, c2: 0 });
    mode.view.selectCell(4, 2);
    mode.view.editCell('half typed');
    release();
    await p;
    expect(s.cell(0, 0)?.structure).toBeTruthy();
    expect(mode.view.editing).not.toBeNull(); // still typing
    expect(s.cell(4, 2)?.input).toBeUndefined();
  });
  it('Paste SMILES draws on the sheet it was asked on', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { mode, wb } = rig(['A', 'B'], { toStructure: async () => { await gate; return { contents: drawing, notes: [] }; } });
    const p = mode.structureFromText('CCO');
    mode.view.goSheet(1);
    release();
    await p;
    expect(wb.sheets[0].cell(0, 0)?.structure).toBeTruthy();
    expect(wb.sheets[1].cell(0, 0)?.structure).toBeFalsy();
  });
});

describe('F1041: Sort after the sheet shown changed', () => {
  it('sorts the sheet it was asked on', async () => {
    const { mode, wb } = rig(['A', 'B']);
    const [a, b] = wb.sheets;
    wb.edit('t', () => {
      for (let r = 0; r < 4; r++) { a.setStructure(r, 0, drawing); a.setInput(r, 1, String(r)); b.setInput(r, 0, String(4 - r)); }
    });
    mode.view.select({ r1: 0, c1: 0, r2: 0, c2: 0 });
    const p = priv(mode).sort(false);
    mode.view.goSheet(1);
    await p;
    expect([0, 1, 2, 3].map((r) => b.cell(r, 0)?.input)).toEqual(['4', '3', '2', '1']);
  });
});

describe('F255: Strikethrough in copied and printed cells', () => {
  it('writes the line through text and numbers', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'old value'); s.setInput(1, 0, '12.5'); s.patchStyle({ r1: 0, c1: 0, r2: 1, c2: 0 }, { strike: true }); s.patchStyle({ r1: 1, c1: 0, r2: 1, c2: 0 }, { pos: 'sub' }); });
    expect(priv(mode).cellHtml(s, 0, 0, false).attrs).toContain('line-through');
    const num = priv(mode).cellHtml(s, 1, 0, false).attrs;
    expect(num).toContain('line-through');
    expect(num).toContain('vertical-align:sub');
  });
});

describe('F256: Cut then Paste on another sheet moves the cells', () => {
  it('empties the old place, re-points formulas and undoes in one step', async () => {
    const clip: { own?: string; text?: string } = {};
    const { mode, wb } = rig(['Sheet1', 'Sheet2'], {
      writeCells: async (own: string, text: string) => { clip.own = own; clip.text = text; },
      readCells: async () => ({ own: clip.own, text: clip.text }),
    });
    const [a, b] = wb.sheets;
    wb.edit('t', () => { a.setInput(0, 0, '1'); a.setInput(1, 0, '2'); a.setInput(2, 0, '=D1+1'); a.setInput(0, 1, '=A2*2'); });
    mode.view.select({ r1: 0, c1: 0, r2: 2, c2: 0 }, { r: 0, c: 0 });
    await mode.copy(true);
    mode.view.goSheet(1);
    mode.view.select({ r1: 0, c1: 2, r2: 0, c2: 2 }, { r: 0, c: 2 });
    await mode.paste(null);
    expect([0, 1, 2].map((r) => b.cell(r, 2)?.input)).toEqual(['1', '2', '=Sheet1!D1+1']);
    expect([0, 1, 2].map((r) => a.cell(r, 0)?.input)).toEqual([undefined, undefined, undefined]);
    expect(a.cell(0, 1)?.input).toBe('=Sheet2!C2*2');
    expect(wb.undoLabel).toBe('Move');
    wb.undo();
    expect([0, 1, 2].map((r) => a.cell(r, 0)?.input)).toEqual(['1', '2', '=D1+1']);
    expect(b.cell(0, 2)?.input).toBeUndefined();
    expect(a.cell(0, 1)?.input).toBe('=A2*2');
  });
});

describe('F256: Cut then Paste into another workbook', () => {
  it('pastes there and empties the cells here, one step in each workbook, each with a clear name', async () => {
    const clip: { own?: string; text?: string } = {};
    const { mode, wb, flashes } = rig(['Sheet1'], {
      writeCells: async (own: string, text: string) => { clip.own = own; clip.text = text; },
      readCells: async () => ({ own: clip.own, text: clip.text }),
    });
    const a = wb.sheets[0];
    wb.edit('t', () => { a.setInput(0, 0, '1'); a.setInput(1, 0, '2'); });
    mode.view.select({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r: 0, c: 0 });
    await mode.copy(true);
    // the cells were cut in another workbook: this one is where they are pasted
    const from = new Workbook(['Other']);
    from.edit('t', () => { from.sheets[0].setInput(0, 0, '1'); from.sheets[0].setInput(1, 0, '2'); });
    priv(mode).clip.sheet = from.sheets[0];
    mode.view.select({ r1: 0, c1: 3, r2: 0, c2: 3 }, { r: 0, c: 3 });
    await mode.paste(null);
    expect([0, 1].map((r) => a.cell(r, 3)?.input)).toEqual(['1', '2']);
    expect(wb.undoLabel).toBe('Paste');
    expect([0, 1].map((r) => from.sheets[0].cell(r, 0)?.input)).toEqual([undefined, undefined]);
    expect(from.undoLabel).toBe('Cut');
    expect(flashes.some((f) => /Undo in each workbook takes back its part/.test(f))).toBe(true);
    from.undo();
    expect(from.sheets[0].cell(1, 0)?.input).toBe('2');
  });
});

describe('F257: Fit Height and Fit Width for several rows or columns', () => {
  it('is one step to undo', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let r = 0; r < 20; r++) { s.setInput(r, 0, 'x'); s.setRowHeight(r, 60); } for (let c = 0; c < 5; c++) s.setColWidth(c, 200); });
    const before = wb.undoLabel;
    mode.view.autoFitLines('row', 0, 19);
    expect(wb.undoLabel).toBe('Row height');
    expect(s.rowHeights.size).toBe(0);
    wb.undo();
    expect(wb.undoLabel).toBe(before);
    expect(s.rowHeights.size).toBe(20);
    mode.view.autoFitLines('col', 0, 4);
    wb.undo();
    expect(wb.undoLabel).toBe(before);
    expect(s.colWidths.get(3)).toBe(200);
  });
});

describe('F258 and F1045: sizes and hiding for rows and columns past the data', () => {
  const setUp = () => {
    const r = rig();
    r.wb.edit('t', () => { for (let i = 0; i < 10; i++) r.wb.sheets[0].setInput(i, 0, 'x'); });
    return r;
  };
  it('Row Height sets every row selected, below the data too', async () => {
    const { mode, wb } = setUp();
    mode.view.select({ r1: 19, c1: 0, r2: 24, c2: MAX_COLS - 1 }, { r: 19, c: 0 });
    asked.answer = { px: '40' };
    await priv(mode).askSize('row');
    expect([19, 20, 21, 22, 23, 24].map((r) => wb.sheets[0].rowHeights.get(r))).toEqual([40, 40, 40, 40, 40, 40]);
    expect(wb.sheets[0].rowHeights.has(25)).toBe(false);
  });
  it('Column Width likewise, right of the data', async () => {
    const { mode, wb } = setUp();
    mode.view.select({ r1: 0, c1: 8, r2: MAX_ROWS - 1, c2: 10 }, { r: 0, c: 8 });
    asked.answer = { px: '90' };
    await priv(mode).askSize('col');
    expect([8, 9, 10].map((c) => wb.sheets[0].colWidths.get(c))).toEqual([90, 90, 90]);
  });
  it('Hide Rows hides every row selected', () => {
    const { mode, wb } = setUp();
    mode.view.select({ r1: 19, c1: 0, r2: 24, c2: MAX_COLS - 1 }, { r: 19, c: 0 });
    priv(mode).hide('row', true);
    expect([...wb.sheets[0].hiddenRows.keys()].sort((x, y) => x - y)).toEqual([19, 20, 21, 22, 23, 24]);
  });
  it('a whole-sheet selection stops a little past the data', () => {
    const { mode, wb } = setUp();
    mode.view.select({ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, { r: 0, c: 0 });
    priv(mode).hide('row', true);
    expect(wb.sheets[0].hiddenRows.size).toBe(11);
  });
  it('hides all the rows that hold data, however many, and says when it stops short below them', () => {
    const { mode, wb, flashes } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let i = 0; i < 30000; i++) s.setInput(i, 0, 'x'); });
    mode.view.select({ r1: 0, c1: 0, r2: 39999, c2: 0 }, { r: 0, c: 0 });
    priv(mode).hide('row', true);
    expect(s.hiddenRows.has(29999)).toBe(true); // the data is all covered
    expect(s.hiddenRows.has(30001)).toBe(false);
    expect(flashes.some((f) => /Only the first 30,001 rows/.test(f))).toBe(true); // rows 30,002 to 40,000 hold nothing
    // an empty sheet, 50,000 rows selected: the first 10,000 change, and the message says so
    const other = rig();
    other.mode.view.select({ r1: 0, c1: 0, r2: 49999, c2: 0 }, { r: 0, c: 0 });
    priv(other.mode).hide('row', true);
    expect(other.wb.sheets[0].hiddenRows.size).toBe(10000);
    expect(other.flashes.some((f) => /Only the first 10,000 rows/.test(f))).toBe(true);
  });
  it('a cleared box is no size', async () => {
    const { mode, wb } = setUp();
    mode.view.select({ r1: 2, c1: 0, r2: 2, c2: MAX_COLS - 1 }, { r: 2, c: 0 });
    const label = wb.undoLabel;
    asked.answer = { px: '  ' };
    await priv(mode).askSize('row');
    expect(wb.sheets[0].rowHeights.has(2)).toBe(false);
    expect(wb.undoLabel).toBe(label);
  });
});

describe('F1038: Insert Link on a long selection', () => {
  it('links every cell selected', async () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    mode.view.select({ r1: 0, c1: 0, r2: 1999, c2: 0 }, { r: 0, c: 0 });
    await priv(mode).editLink();
    expect(s.cell(1999, 0)?.link).toBe('https://example.com');
    expect(s.cell(1000, 0)?.link).toBe('https://example.com');
  });
});

describe('F1040: Delete Rows below the data', () => {
  it('takes out every row selected, so what lies below them (a row height, here) moves up by as many', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let i = 0; i < 10; i++) s.setInput(i, 0, 'x'); s.setRowHeight(70, 99); });
    mode.view.select({ r1: 49, c1: 0, r2: 59, c2: 0 }, { r: 49, c: 0 });
    priv(mode).deleteCells('row');
    expect(s.rowHeights.get(59)).toBe(99);
    expect(s.rowHeights.has(69)).toBe(false);
  });
  it('a selection to the end of the sheet stops at the data', () => {
    const { mode, wb } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let i = 0; i < 10; i++) s.setInput(i, 0, 'x'); });
    mode.view.select({ r1: 4, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 }, { r: 4, c: 0 });
    priv(mode).deleteCells('row');
    expect(s.lastRow).toBe(3);
  });
});

describe('F1044: Copy and hidden rows and columns', () => {
  it('leaves them out of the text, as of the HTML table', async () => {
    const clip: { text?: string } = {};
    const { mode, wb } = rig(['Sheet1'], { writeCells: async (_o: string, text: string) => { clip.text = text; } });
    const s = wb.sheets[0];
    wb.edit('t', () => { for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) s.setInput(r, c, `a${r}${c}`); s.setRowHidden(2, true); s.setColHidden(1, true); });
    mode.view.select({ r1: 0, c1: 0, r2: 4, c2: 2 }, { r: 0, c: 0 });
    await mode.copy();
    expect(clip.text).toBe('a00\ta02\r\na10\ta12\r\na30\ta32\r\na40\ta42\r\n');
  });
});

describe('F1046: Convert Column to Values with error results', () => {
  it('keeps the error as text and says so', async () => {
    const { mode, wb, flashes } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'H'); s.setInput(1, 0, 'a'); s.setInput(2, 0, 'b'); s.setColDef(1, { formula: '=NA()', firstRow: 1 }); });
    wb.recalc();
    expect(s.shownText(1, 1)).toBe('#N/A');
    await priv(mode).freezeColumn(1);
    expect(s.colDefs.has(1)).toBe(false);
    expect(s.cell(1, 1)?.input).toBe('#N/A');
    expect(flashes.some((f) => /error/.test(f))).toBe(true);
    settleFrames();
  });
  it('waits for results still being worked out, and leaves any that never arrive empty (not "#BUSY!")', async () => {
    const { mode, wb, flashes } = rig();
    const s = wb.sheets[0];
    wb.edit('t', () => { s.setInput(0, 0, 'H'); s.setInput(1, 0, 'a'); s.setInput(2, 0, 'b'); s.setColDef(1, { formula: '=NA()', firstRow: 1 }); });
    wb.recalc();
    s.values.set(keyOf(1, 1), ERR.busy());
    s.values.set(keyOf(2, 1), ERR.busy());
    // the engine answers for the first row; the second never does
    vi.spyOn(wb, 'recalc').mockImplementation(() => { s.values.set(keyOf(1, 1), 7); });
    await priv(mode).freezeColumn(1);
    expect(s.colDefs.has(1)).toBe(false);
    expect(s.cell(1, 1)?.input).toBe('7');
    expect(s.cell(2, 1)?.input).toBeUndefined();
    expect(flashes.some((f) => /not calculated yet/.test(f))).toBe(true);
    settleFrames();
  });
});
