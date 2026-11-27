// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 12 (Spreadsheet grid editing), the windows and menus around the
// grid: F249 the totals row, F251 and F1037 Increase Indent, F1029 the Data Bars live preview, F1030
// changing a conditional formatting rule, F1031 Manage Rules, F1048 the notes layer, F1049 a picture
// converted while the sheet changes, F1054 Print Titles.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Workbook, type Sheet } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { newCondFormat, PRESET_BARS } from '../src/sheet/conditional';
import { MAX_COLS, MAX_ROWS } from '../src/sheet/refs';
import { SheetFormatting } from '../src/ui/sheet-format-ui';
import { SheetLook } from '../src/ui/sheet-look-ui';
import { SheetPage, readRanges } from '../src/ui/sheet-page-ui';
import { SheetObjects } from '../src/ui/sheet-objects-ui';
import { SheetNotes } from '../src/ui/sheet-notes-ui';
import type { SheetView } from '../src/ui/sheet-view';

const asked = vi.hoisted(() => ({ answer: ((_t: string, fields: { name: string; value?: string }[]) => Object.fromEntries(fields.map((f) => [f.name, f.value ?? '']))) as (t: string, f: { name: string; value?: string }[]) => Record<string, string> | null }));
vi.mock('../src/ui/ask', async (orig) => ({ ...(await orig<typeof import('../src/ui/ask')>()), ask: async (t: string, f: { name: string; value?: string }[]) => asked.answer(t, f) }));
const converting = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock('../src/render/images', async (orig) => ({
  ...(await orig<typeof import('../src/render/images')>()),
  webpToPng: () => new Promise((r) => { converting.release = () => r(new Uint8Array([137, 80, 78, 71])); }),
}));

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

/** A host for the windows: a workbook, its first sheet showing, edits as one undo step each. */
function setUp(sheets = ['Sheet1']) {
  const wb = new Workbook(sheets);
  const sel = { active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 } };
  const flashes: string[] = [];
  const view = {
    wb,
    get sheet() { return wb.sheet; },
    sel,
    draw() {}, focus() {}, refresh() {},
    areas: () => [sel.range],
    pickObject() {},
    newObjectPlace: () => ({ row: 0, col: 0, dx: 0, dy: 0 }),
  };
  const host = { view: view as unknown as SheetView, edit: (l: string, fn: (s: Sheet) => void) => wb.edit(l, () => fn(wb.sheet)), flash: (m: string) => { flashes.push(m); } };
  return { wb, sel, view, host, flashes, s: wb.sheets[0] };
}

describe('F249: the totals row', () => {
  /** A table A1:C5 with numbers, and the toggle. */
  function table() {
    const rig = setUp();
    const { wb, host, s } = rig;
    wb.edit('t', () => { for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) s.setInput(r, c, r === 0 ? `H${c}` : String(r * 10 + c)); });
    wb.edit('table', () => s.setTables([newTable({ r1: 0, c1: 0, r2: 4, c2: 2 }, [])]));
    return { ...rig, fmt: new SheetFormatting(host) };
  }

  it('writes the totals into a free row and moves nothing', () => {
    const { wb, s, fmt } = table();
    wb.edit('t', () => { s.setInput(7, 0, 'below'); s.setInput(2, 4, 'beside'); });
    fmt.toggleTotals(s.tables[0]);
    expect(s.cell(5, 0)?.input).toBe('Total');
    expect(s.cell(7, 0)?.input).toBe('below');
    expect(s.cell(2, 4)?.input).toBe('beside');
    expect(s.tables[0].range.r2).toBe(5);
    fmt.toggleTotals(s.tables[0]);
    expect(s.cell(5, 0)?.input).toBeUndefined();
    expect(s.cell(7, 0)?.input).toBe('below');
    expect(s.tables[0].range.r2).toBe(4);
    expect(wb.undoLabel).toBe('No totals row');
    wb.undo();
    expect(s.cell(5, 0)?.input).toBe('Total');
  });

  it('makes a whole row when the row under the table is used, and what is under it follows', () => {
    const { wb, s, fmt } = table();
    wb.edit('t', () => {
      s.setInput(5, 0, 'below');
      s.setInput(7, 0, 'H0'); s.setInput(7, 1, 'H1'); s.setInput(7, 2, 'H2');
      for (let r = 8; r < 11; r++) for (let c = 0; c < 3; c++) s.setInput(r, c, String(r * 10 + c));
      s.setInput(0, 4, '=SUM(B1:B10)');
      s.setInput(1, 4, '=B9');
    });
    wb.edit('more', () => {
      s.setTables([...s.tables, newTable({ r1: 7, c1: 0, r2: 10, c2: 2 }, [])]);
      s.setMerges([{ r1: 12, c1: 0, r2: 12, c2: 2 }]);
      s.setCondFormats([newCondFormat([{ r1: 8, c1: 0, r2: 10, c2: 0 }], { kind: 'bar', color: '#ff0000' } as never)]);
    });
    const first = s.tables[0], second = s.tables[1];
    fmt.toggleTotals(first);
    expect(s.cell(5, 0)?.input).toBe('Total');
    expect(s.cell(6, 0)?.input).toBe('below');
    expect(s.tables.find((x) => x.id === second.id)!.range).toEqual({ r1: 8, c1: 0, r2: 11, c2: 2 });
    expect(s.cell(8, 0)?.input).toBe('H0'); // the second table's header is still the first row of its range
    expect(s.merges).toEqual([{ r1: 13, c1: 0, r2: 13, c2: 2 }]);
    expect(s.condFormats[0].ranges).toEqual([{ r1: 9, c1: 0, r2: 11, c2: 0 }]);
    expect(s.cell(0, 4)?.input).toBe('=SUM(B1:B11)'); // a formula across the new row is stretched
    expect(s.cell(1, 4)?.input).toBe('=B10');
    fmt.toggleTotals(s.tables.find((x) => x.id === first.id)!);
    expect(s.cell(5, 0)?.input).toBe('below');
    expect(s.tables.find((x) => x.id === second.id)!.range).toEqual({ r1: 7, c1: 0, r2: 10, c2: 2 });
    expect(s.merges).toEqual([{ r1: 12, c1: 0, r2: 12, c2: 2 }]);
    expect(s.cell(0, 4)?.input).toBe('=SUM(B1:B10)');
    wb.undo();
    expect(s.cell(5, 0)?.input).toBe('Total');
    wb.undo();
    expect(s.cell(5, 0)?.input).toBe('below');
    expect(s.tables.find((x) => x.id === second.id)!.range).toEqual({ r1: 7, c1: 0, r2: 10, c2: 2 });
  });

  it('says so and changes nothing when making room would move cells beside the table', () => {
    const { wb, s, fmt, flashes } = table();
    wb.edit('t', () => { s.setInput(5, 0, 'below'); s.setInput(7, 4, 'beside'); });
    const before = wb.undoLabel;
    fmt.toggleTotals(s.tables[0]);
    expect(flashes.join(' ')).toContain('totals row has no room');
    expect(s.cell(5, 0)?.input).toBe('below');
    expect(s.cell(7, 4)?.input).toBe('beside');
    expect(s.tables[0].totals).toBeFalsy();
    expect(wb.undoLabel).toBe(before);
  });

  it('turns the totals row off without moving cells when others sit beside the table', () => {
    const { wb, s, fmt, flashes } = table();
    fmt.toggleTotals(s.tables[0]); // in place
    wb.edit('t', () => { s.setInput(6, 0, 'below'); s.setInput(7, 4, 'beside'); });
    fmt.toggleTotals(s.tables[0]);
    expect(s.tables[0].totals).toBe(false);
    expect(s.cell(5, 0)?.input).toBeUndefined();
    expect(s.cell(6, 0)?.input).toBe('below');
    expect(s.cell(7, 4)?.input).toBe('beside');
    expect(flashes.join(' ')).toContain('stayed where they are');
  });
});

describe('F251 and F1037: Increase Indent', () => {
  it('indents the empty cells of a block as far as the block goes', () => {
    const { wb, sel, host, s } = setUp();
    wb.edit('t', () => s.setInput(0, 0, 'x'));
    sel.range = { r1: 0, c1: 0, r2: 999, c2: 0 };
    new SheetLook(host as never).indent(1);
    expect(s.styleAt(0, 0)?.indent).toBe(1);
    expect(s.styleAt(700, 0)?.indent).toBe(1);
    expect(s.styleAt(999, 0)?.indent).toBe(1);
  });
  it('says so when the empty cells of a block over 50,000 cells are left as they are', () => {
    const { wb, sel, host, s, flashes } = setUp();
    wb.edit('t', () => s.setInput(0, 0, 'x'));
    sel.range = { r1: 0, c1: 0, r2: 59999, c2: 0 };
    new SheetLook(host as never).indent(1);
    expect(s.styleAt(0, 0)?.indent).toBe(1);
    expect(s.styleAt(5, 0)?.indent).toBeUndefined();
    expect(flashes.join(' ')).toContain('left as they are');
  });
  it('keeps each cell its own level in a long column', () => {
    const { wb, sel, host, s } = setUp();
    wb.edit('t', () => { for (let r = 0; r < 25000; r++) s.setInput(r, 0, 'x'); s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { indent: 2 }); });
    sel.range = { r1: 0, c1: 0, r2: 24999, c2: 0 };
    new SheetLook(host as never).indent(1);
    expect(s.styleAt(0, 0)?.indent).toBe(3);
    expect(s.styleAt(5, 0)?.indent).toBe(1);
  });
});

describe('F1029: the Data Bars preview', () => {
  it('shows the bar each entry says', () => {
    const { host, s, sel } = setUp();
    s.wb.edit('t', () => { for (let r = 0; r < 5; r++) s.setInput(r, 0, String(r)); });
    sel.range = { r1: 0, c1: 0, r2: 4, c2: 0 };
    new SheetFormatting(host).conditionalMenu(0, 0);
    [...document.querySelectorAll<HTMLButtonElement>('.popup-menu button')].find((b) => b.textContent === 'Data Bars ▸')!.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.popup-menu > button')];
    const n = PRESET_BARS.length;
    expect(items.length).toBe(2 * n + 1);
    // the first solid entry, and the one after it
    for (const i of [n, n + 1]) {
      items[i].dispatchEvent(new Event('pointerenter'));
      expect(s.condFormats[0].rule).toMatchObject({ kind: 'bar', color: PRESET_BARS[i - n].color, gradient: false });
      items[i].dispatchEvent(new Event('pointerleave'));
    }
    // Custom… has none to show
    items[2 * n].dispatchEvent(new Event('pointerenter'));
    expect(s.condFormats.length).toBe(0);
  });
});
describe('F1030: changing a conditional formatting rule', () => {
  it('keeps a fill-only look fill-only, and its underline', async () => {
    const { host, s } = setUp();
    s.wb.edit('t', () => s.setCondFormats([newCondFormat([{ r1: 1, c1: 1, r2: 9, c2: 1 }], { kind: 'cells', op: 'gt', value: 5, look: { fill: '#ffc7ce', underline: true } })]));
    asked.answer = (_t, fields) => Object.fromEntries(fields.map((f) => [f.name, f.value ?? '']));
    await new SheetFormatting(host).ruleDialog(s.condFormats[0].rule, s.condFormats[0]);
    const rule = s.condFormats[0].rule as { look: Record<string, unknown> };
    expect(rule.look).toEqual({ fill: '#ffc7ce', underline: true });
  });
  it('a custom format can have no text color', async () => {
    const { host } = setUp();
    asked.answer = (_t, fields) => ({ ...Object.fromEntries(fields.map((f) => [f.name, f.value ?? ''])), nocolor: 'true' });
    const look = await (new SheetFormatting(host) as unknown as { pickLook(v: Record<string, string>): Promise<Record<string, unknown> | null> }).pickLook({ look: 'custom' });
    expect(look).toEqual({ fill: '#ffeb9c' });
  });
});

describe('F1031: Manage Rules, moving a rule up', () => {
  it('moves it past the rule shown, not one for other cells', () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const { host, s, sel } = setUp();
    const rule = (v: number) => ({ kind: 'cells' as const, op: 'gt' as const, value: v, look: { fill: '#ffc7ce' } });
    const B = { r1: 1, c1: 1, r2: 9, c2: 1 }, D = { r1: 1, c1: 3, r2: 9, c2: 3 };
    const a = newCondFormat([B], rule(1)), b = newCondFormat([D], rule(2)), c = newCondFormat([B], rule(3));
    s.wb.edit('t', () => s.setCondFormats([c, b, a]));
    sel.range = B; sel.active = { r: 1, c: 1 };
    new SheetFormatting(host).manage();
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.cf-row')];
    expect(rows.length).toBe(2); // C and A
    rows[1].click();
    [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((x) => x.textContent === '▲')!.click();
    expect(s.condFormats.map((x) => x.id)).toEqual([a.id, c.id, b.id]);
    expect(s.wb.undoLabel).toBe('Reorder rules');
  });
});

describe('F1054: Print Titles', () => {
  it('reads rows for the rows box and columns for the columns box', () => {
    expect(readRanges('$1:$2', 'rows')).toEqual([{ r1: 0, c1: 0, r2: 1, c2: MAX_COLS - 1 }]);
    expect(readRanges('$A:$B', 'cols')).toEqual([{ r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: 1 }]);
    expect(readRanges('$A:$B', 'rows')).toBeNull();
    expect(readRanges('A1:D20', 'rows')).toBeNull();
    expect(readRanges('$1:$2', 'cols')).toBeNull();
    expect(readRanges('A1:D20')).toEqual([{ r1: 0, c1: 0, r2: 19, c2: 3 }]);
  });
  it('refuses columns typed as rows, and sets nothing', async () => {
    const { host, s, flashes } = setUp();
    asked.answer = () => ({ rows: '$A:$B', cols: '' });
    await new SheetPage(host).printTitles();
    expect(flashes.some((f) => /Type rows like/.test(f))).toBe(true);
    expect(s.pageSetup?.titleRows).toBeUndefined();
  });
  it('sets rows and columns typed as they should be', async () => {
    const { host, s } = setUp();
    asked.answer = () => ({ rows: '$1:$2', cols: '$A:$B' });
    await new SheetPage(host).printTitles();
    expect(s.pageSetup?.titleRows).toEqual([0, 1]);
    expect(s.pageSetup?.titleCols).toEqual([0, 1]);
  });
});

describe('F1049: a picture converted while the sheet changes', () => {
  it('is not added to the sheet then showing', async () => {
    const { wb: book, host, view, flashes } = setUp(['A', 'B']);
    const objects = new SheetObjects({ ...host, pickPicture: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp', name: 'p.webp' }) });
    const p = objects.insertPicture();
    await new Promise((r) => setTimeout(r, 0));
    book.active = 1;
    expect(view.sheet).toBe(book.sheets[1]);
    converting.release!();
    await p;
    expect(book.sheets[0].objects.length).toBe(0);
    expect(book.sheets[1].objects.length).toBe(0);
    expect(flashes.some((f) => /not added/.test(f))).toBe(true);
  });
});

describe('F1048: the notes layer', () => {
  it('does not write every note out each time the grid is drawn', () => {
    const { wb: book, s } = setUp();
    book.edit('t', () => { for (let r = 0; r < 300; r++) s.setNote(r, 0, { kind: 'note', author: 'A', date: '', text: `note ${r}`, shown: true } as never); });
    const layer = document.createElement('div');
    const view = {
      sheet: s, sel: { active: { r: 0, c: 0 } }, noteLayer: layer, layerRect: () => ({ x: 0, y: 0, w: 60, h: 20 }),
      screenRect: () => null, selectCell() {}, refresh() {}, focus() {}, reveal() {}, commitEdit() {},
    };
    const notes = new SheetNotes({ view: view as unknown as SheetView, edit: (_l, fn) => fn(s), flash() {}, askName: async () => true });
    notes.layout();
    expect(layer.children.length).toBe(300);
    const spy = vi.spyOn(JSON, 'stringify');
    notes.layout();
    notes.layout();
    expect(spy).not.toHaveBeenCalled();
    // a changed note is still drawn again
    book.edit('t', () => s.setNote(0, 0, { kind: 'note', author: 'A', date: '', text: 'changed', shown: true } as never));
    notes.layout();
    expect(layer.children[0].textContent).toContain('changed');
  });
});
