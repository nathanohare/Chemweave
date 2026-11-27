// Regression tests for the spreadsheet data tools fixed in the November 2026 code review (batch 26):
// Find and Replace wildcards, Go To Special, Paste Special Validation, Text to Columns, Advanced
// Filter, PivotChart series over tabular reports, and a query table's Total Row on refresh.
//
// Excel's Find and Replace wildcards, as Microsoft documents them ("Find or replace text and
// numbers on a worksheet", support.microsoft.com, article 0e304ca5-ecef-4808-b90f-fdb42f892e90):
// "Use the asterisk (*) to find any number of characters", "Use the tilde (~) followed by ?, *, or
// ~ to find question marks, asterisks, or other tilde characters".

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { findPattern, replaceIn, replaceCell, goToSpecial, pasteSpecial, splitText, advancedRows } from '../src/sheet/data-tools';
import { newValidation } from '../src/sheet/validation';
import { layoutPivot, sourceOf, newPivotId, pivotChartSeries, type PivotTable } from '../src/sheet/pivot';
import { refValues } from '../src/sheet/chart';
import { removeSubtotals } from '../src/sheet/outline';
import { writeResult } from '../src/sheet/query-sheet';
import type { Query, QTable } from '../src/sheet/query';
import type { CellNote } from '../src/sheet/notes';

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};
const R = (s: string) => {
  const [a, b] = s.split(':');
  const [r1, c1] = A(a), [r2, c2] = A(b ?? a);
  return { r1, c1, r2, c2 };
};
function book(cells: Record<string, string> = {}): Workbook {
  const wb = new Workbook();
  wb.edit('Type', () => { for (const [addr, v] of Object.entries(cells)) wb.sheet.setInput(...A(addr), v); });
  return wb;
}
const note = (text: string): CellNote => ({ kind: 'note', author: 'Tester', date: '', text });

describe('Find and Replace wildcards', () => {
  it('reads ~~ as a tilde without throwing (F273)', () => {
    const re = findPattern({ text: 'a~~b' });
    expect(re.test('a~b')).toBe(true);
    expect(re.test('ab')).toBe(false);
    expect(replaceIn('x a~b y', { text: 'a~~b' }, 'T')).toBe('x T y');
    // ~* and ~? are still the characters themselves
    expect(replaceIn('2*3?', { text: '~*' }, 'x')).toBe('2x3?');
    expect(replaceIn('2*3?', { text: '~?' }, '!')).toBe('2*3!');
  });

  it('replaces the whole run a * matches, not the gaps between characters (F274)', () => {
    expect(replaceIn('Pd(OAc)2', { text: 'Pd*' }, 'X')).toBe('X');
    expect(replaceIn('abc', { text: '*' }, 'x')).toBe('x');
    // ? is still exactly one character, and text around a * is kept
    expect(replaceIn('Pd(OAc)2 cat', { text: '(*)' }, '[L]')).toBe('Pd[L]2 cat');
    expect(replaceIn('set sat', { text: 's?t' }, 'X')).toBe('X X');
    const wb = book({ A1: 'Pd(OAc)2' });
    wb.edit('Replace', () => replaceCell(wb.sheet, 0, 0, { text: 'Pd*' }, 'X'));
    expect(wb.sheet.cell(0, 0)?.input).toBe('X');
  });
});

describe('Go To Special', () => {
  it('Notes with a selection outside the cells in use finds none (F1089)', () => {
    const wb = book({ A1: '1', B1: '2', C1: '3', A3: 'x', C3: 'y' });
    wb.edit('Notes', () => { wb.sheet.setNote(0, 0, note('one')); wb.sheet.setNote(1, 1, note('two')); });
    expect(goToSpecial(wb.sheet, R('F10:H12'), { r: 9, c: 5 }, { kind: 'notes' })).toBeNull();
    // a note on an empty cell inside the selection, past the last cell in use, is found
    wb.edit('Note', () => wb.sheet.setNote(10, 6, note('three')));
    expect(goToSpecial(wb.sheet, R('F10:H12'), { r: 9, c: 5 }, { kind: 'notes' })).toEqual([R('G11')]);
  });

  it('Row differences tells =A2+1 in B2 from =A2+1 in C2 (F1090)', () => {
    const wb = book({ A2: '5', B2: '=A2+1', C2: '=A2+1' });
    expect(goToSpecial(wb.sheet, R('B2:C2'), { r: 1, c: 1 }, { kind: 'rowdiff' })).toEqual([R('C2')]);
    // the same formula relative to each cell is alike
    const same = book({ A2: '5', B2: '=A2+1', C2: '=B2+1' });
    expect(goToSpecial(same.sheet, R('B2:C2'), { r: 1, c: 1 }, { kind: 'rowdiff' })).toBeNull();
    // column differences: C2 =A2*2 against C3 =B3*2 differ
    const cols = book({ A2: '1', B3: '1', C2: '=A2*2', C3: '=B3*2' });
    expect(goToSpecial(cols.sheet, R('C2:C3'), { r: 1, c: 2 }, { kind: 'coldiff' })).toEqual([R('C3')]);
  });

  it('Precedents selects the whole block a formula reads (F1091)', () => {
    const wb = book({ A6000: '1', C1: '=SUM(A1:A6000)' });
    expect(goToSpecial(wb.sheet, R('C1'), { r: 0, c: 2 }, { kind: 'precedents' })).toEqual([R('A1:A6000')]);
  });

  it('Dependents for every level follows a chain of formulas (F1092)', () => {
    const wb = book({ A1: '1', A2: '=A1+1', A3: '=A2+1', A4: '=A3+1', B1: '=SUM(A1:A200)' });
    const got = goToSpecial(wb.sheet, R('A1'), { r: 0, c: 0 }, { kind: 'dependents', allLevels: true });
    expect(got).toEqual([R('B1'), R('A2:A4')]);
    expect(goToSpecial(wb.sheet, R('A1'), { r: 0, c: 0 }, { kind: 'dependents' })).toEqual([R('B1'), R('A2')]);
  });
});

describe('Paste Special', () => {
  it('Validation puts each rule over its own pasted cells (F1093)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const list = newValidation([R('A1:A5')], { kind: 'list', value1: 'Pd,Ni' });
    const whole = newValidation([R('B1:B5')], { kind: 'whole', value1: '1', value2: '10' });
    wb.edit('Rules', () => s.setValidations([list, whole]));
    wb.edit('Paste', () => pasteSpecial(s, { row: 0, col: 3 }, s.copy(R('A1:B5')), { what: 'validation' }, { sheet: s, range: R('A1:B5') }));
    expect(s.validationAt(0, 3)?.kind).toBe('list');
    expect(s.validationAt(4, 3)?.kind).toBe('list');
    expect(s.validationAt(0, 4)?.kind).toBe('whole');
    expect(s.validationAt(4, 4)?.kind).toBe('whole');
    // one step to undo
    wb.undo();
    expect(s.validationAt(0, 3)).toBeUndefined();
  });
});

describe('Text to Columns', () => {
  it('takes a quote inside a field as an ordinary character (F1095)', () => {
    expect(splitText('5" pipe, 6" pipe', { mode: 'delimited', delimiters: ',', qualifier: '"' })).toEqual(['5" pipe', ' 6" pipe']);
    // a quote at the start of a field still keeps separators inside it
    expect(splitText('"a,b",c', { mode: 'delimited', delimiters: ',', qualifier: '"' })).toEqual(['a,b', 'c']);
  });
});

describe('Advanced Filter', () => {
  it('a blank criteria row matches every record (F1096)', () => {
    const wb = book({ A1: 'Region', B1: 'Yield', A2: 'North', B2: '1', A3: 'South', B3: '2', A4: 'North', B4: '3', A5: 'East', B5: '4', D1: 'Region', D2: 'North' });
    expect(advancedRows(wb.sheet, { list: R('A1:B5'), criteria: R('D1:D2') })).toEqual([1, 3]);
    expect(advancedRows(wb.sheet, { list: R('A1:B5'), criteria: R('D1:D3') })).toEqual([1, 2, 3, 4]);
  });
});

describe('PivotCharts of tabular and outline reports', () => {
  const RUNS: (string | number | null)[][] = [
    ['Catalyst', 'Solvent', 'Yield'],
    ['Pd', 'THF', 80],
    ['Pd', 'DMF', 70],
    ['Ni', 'THF', 60],
    ['Ni', 'THF', 64],
    ['Cu', 'DMF', 50],
  ];
  const src = sourceOf(RUNS);
  if (typeof src === 'string') throw new Error(src);
  const pivot = (over: Partial<PivotTable>): PivotTable => ({
    id: newPivotId(), name: 'PivotTable1', source: '=Sheet1!$A$1:$C$6', at: { row: 0, col: 6 },
    rows: ['Catalyst', 'Solvent'], cols: [], values: [{ field: 'Yield', fn: 'sum' }], filters: [], hidden: {}, layout: 'tabular', subtotals: true, grandRows: true, grandCols: true, ...over,
  });

  it('leave out the subtotal rows between the items (F284)', () => {
    const pt = pivot({});
    const rep = layoutPivot(pt, src);
    if (typeof rep === 'string') throw new Error(rep);
    // rows 2..9: Cu DMF, Cu Total, Ni THF, Ni Total, Pd DMF, Pd THF, Pd Total, Grand Total
    expect(rep.cells.slice(1).map((r) => r[0])).toEqual(['Cu', 'Cu Total', 'Ni', 'Ni Total', 'Pd', null, 'Pd Total', 'Grand Total']);
    expect(pivotChartSeries(rep, pt.at, 'Sheet1', pt)).toEqual([{
      name: 'Sum of Yield',
      x: '=(Sheet1!$H$2:$H$2,Sheet1!$H$4:$H$4,Sheet1!$H$6:$H$7)',
      y: '=(Sheet1!$I$2:$I$2,Sheet1!$I$4:$I$4,Sheet1!$I$6:$I$7)',
    }]);
    // outline form: each outer item has its own line above its items
    const out = pivot({ layout: 'outline' });
    const orep = layoutPivot(out, src);
    if (typeof orep === 'string') throw new Error(orep);
    const series = pivotChartSeries(orep, out.at, 'Sheet1', out);
    const items = orep.rowLines.flatMap((l, i) => (l.kind === 'item' ? [i] : []));
    expect(items.length).toBe(4);
    expect(series[0].y.startsWith('=(')).toBe(true);
    for (const i of items) expect(series[0].y).toContain(`$I$${i + 2}`);
  });

  it('a chart reads a union of blocks in turn', () => {
    const wb = book({ A1: '1', A2: '2', A3: '99', A4: '4', A5: '5' });
    expect(refValues(wb, '=(Sheet1!$A$1:$A$2,Sheet1!$A$4:$A$5)', wb.sheet)).toEqual([1, 2, 4, 5]);
    expect(refValues(wb, '=Sheet1!$A$1:$A$2', wb.sheet)).toEqual([1, 2]);
  });
});

describe('Subtotal', () => {
  it('Remove All leaves a row hidden by hand hidden (F1118)', () => {
    const wb = book({ A1: 'Catalyst', B1: 'Yield', A2: 'Pd', B2: '1', A3: 'Ni', B3: '2', A4: 'Cu', B4: '3' });
    const s = wb.sheet;
    wb.edit('Hide', () => s.setRowHidden(2, true));
    wb.edit('Remove All', () => removeSubtotals(s, R('A1:B4')));
    expect(s.hiddenRows.has(2)).toBe(true);
    // a row the outline folded away is shown again
    wb.edit('Group', () => { s.setRowLevel(1, 1); s.setRowHidden(1, true); });
    wb.edit('Remove All', () => removeSubtotals(s, R('A1:B4')));
    expect(s.hiddenRows.has(1)).toBe(false);
    expect(s.hiddenRows.has(2)).toBe(true);
  });
});

describe('query tables with a Total Row', () => {
  const q: Query = { id: 1, name: 'Screen', source: { kind: 'text', file: 'screen.csv', delimiter: 'auto' }, steps: [], table: null };
  const t3: QTable = { cols: ['Entry', 'Catalyst', 'Temp'], types: ['whole', 'text', 'whole'], rows: [[1, 'Pd(OAc)2', 80], [2, 'Pd2(dba)3', 100], [3, 'NiCl2', 80]] };
  const t2: QTable = { cols: ['Entry', 'Catalyst', 'Temp'], types: ['whole', 'text', 'whole'], rows: [[1, 'Pd(OAc)2', 80], [3, 'NiCl2', 80]] };

  it('keep the totals row under the new records on refresh (F285)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const got = wb.edit('Load', () => writeResult(s, { row: 0, col: 0 }, t3, null, q));
    // the Total Row as Table Design ▸ Total Row makes it: a label and SUBTOTAL(109, …) under the numbers
    wb.edit('Totals', () => {
      s.setInput(4, 0, 'Total');
      s.setInput(4, 2, '=SUBTOTAL(109,C2:C4)');
      s.setTables(s.tables.map((x) => (x.id === got.table.id ? { ...x, totals: true, range: { ...x.range, r2: 4 } } : x)));
    });
    expect(s.value(4, 2)).toBe(260);
    const own = s.tables.find((x) => x.id === got.table.id)!;
    const again = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, t2, own, q));
    expect(again.table.totals).toBe(true);
    expect(again.table.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 2 });
    // the last record is still a record, and the totals row adds up the new records
    expect(s.value(2, 1)).toBe('NiCl2');
    expect(s.value(3, 0)).toBe('Total');
    expect(s.cell(3, 2)?.input).toBe('=SUBTOTAL(109,C2:C3)');
    expect(s.value(3, 2)).toBe(160);
    expect(s.value(4, 2)).toBeNull();
    // and back with more records
    const own2 = s.tables.find((x) => x.id === got.table.id)!;
    const third = wb.edit('Refresh', () => writeResult(s, { row: 0, col: 0 }, t3, own2, q));
    expect(third.table.range.r2).toBe(4);
    expect(s.value(3, 1)).toBe('NiCl2');
    expect(s.value(4, 2)).toBe(260);
  });
});
