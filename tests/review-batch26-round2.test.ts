// Regression tests for the second round of the batch 26 review fixes (spreadsheet data tools):
// Remove All after Subtotal, PivotChart unions over sheets with brackets in their names, column
// sparklines with set axis limits, conditional formatting of empty cells, a query table's Total
// Row when its columns change, overlapping precedents, headerless dashboard tables, whole-column
// validation lists, and the work done by sparklines, box charts and Dependents.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { addSubtotals, removeSubtotals, outlineGroups, setCollapsed } from '../src/sheet/outline';
import { refValues, unionParts } from '../src/sheet/chart';
import { sparkShape, groupLimits, sparkLimits, sparklineAt, SPARK_DEFAULTS, type SparklineGroup } from '../src/sheet/sparklines';
import { workOutLooks, newCondFormat, type CfHost } from '../src/sheet/conditional';
import { writeResult } from '../src/sheet/query-sheet';
import type { Query, QTable } from '../src/sheet/query';
import { goToSpecial } from '../src/sheet/data-tools';
import { labelsName, chartPickMask } from '../src/sheet/dashboard';
import { newValidation, listItems } from '../src/sheet/validation';
import { boxGroups } from '../src/sheet/chart-stats';
import { keyOf, rangeSize } from '../src/sheet/refs';

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

afterEach(() => vi.restoreAllMocks());

describe('Subtotal ▸ Remove All', () => {
  it('shows rows the outline folded and leaves a row hidden by hand hidden (F1118)', () => {
    const wb = book({ A1: 'Catalyst', B1: 'Yield', A2: 'Pd', B2: '1', A3: 'Pd', B3: '2', A4: 'Ni', B4: '3', A5: 'Ni', B5: '4' });
    const s = wb.sheet;
    let T = R('A1:B5');
    wb.edit('Subtotal', () => { const got = addSubtotals(s, R('A1:B5'), { by: 0, fn: 9, cols: [1] }); if (typeof got !== 'string') T = got; });
    // rows: header, Pd, Pd, Pd Total, Ni, Ni, Ni Total, Grand Total
    expect(s.value(3, 0)).toBe('Pd Total');
    // fold the Pd group with its button, and hide the first Ni row by hand
    const pd = outlineGroups(s, 'row').find((g) => g.level === 2 && g.from === 1)!;
    wb.edit('Hide Detail', () => setCollapsed(s, 'row', pd, true));
    wb.edit('Hide', () => s.setRowHidden(4, true));
    wb.edit('Remove All', () => removeSubtotals(s, T));
    // rows: header, Pd, Pd, Ni, Ni
    expect(s.value(3, 0)).toBe('Ni');
    expect(s.hiddenRows.has(1)).toBe(false);
    expect(s.hiddenRows.has(2)).toBe(false);
    expect(s.hiddenRows.has(3)).toBe(true);
    expect(s.hiddenRows.has(4)).toBe(false);
    expect(s.rowLevels.size).toBe(0);
  });
});

describe('PivotChart unions', () => {
  it('read every block when the sheet name has brackets or commas (F284)', () => {
    const wb = book({ A1: '1', A2: '2', A3: '99', A4: '4' });
    wb.edit('Rename', () => wb.sheet.rename('Pivot (2)'));
    expect(refValues(wb, "=('Pivot (2)'!$A$1:$A$2,'Pivot (2)'!$A$4:$A$4)", wb.sheet)).toEqual([1, 2, 4]);
    expect(unionParts("=('Runs, 2024'!$A$1:$A$2,'Runs, 2024'!$A$4)")).toEqual(["'Runs, 2024'!$A$1:$A$2", "'Runs, 2024'!$A$4"]);
    // a reference that isn't a union, and a formula in brackets, are not taken as one
    expect(unionParts('=Sheet1!$A$1:$A$2')).toBeNull();
    expect(unionParts('=(A1+A2)')).toBeNull();
    expect(unionParts('=(A1:A2)')).toBeNull();
  });

  it('a dashboard click on a union chart filters by every block', () => {
    const wb = book({ A1: 'Pd', A2: 'Total', A3: 'Ni', A4: 'Pd', B1: '1', B2: '2', B3: '3', B4: '4' });
    const chart = { id: 1, kind: 'column', series: [{ x: '=(Sheet1!$A$1:$A$1,Sheet1!$A$3:$A$4)', y: '=(Sheet1!$B$1:$B$1,Sheet1!$B$3:$B$4)' }], x: {}, y: {}, at: { row: 0, col: 0, dx: 0, dy: 0 }, w: 100, h: 100 };
    const d = { cols: 12, tiles: [{ id: 7, kind: 'chart', x: 0, y: 0, w: 4, h: 4, chart, pick: [{ level: 0, value: 'Pd' }] }] };
    const mask = chartPickMask(wb, d as never);
    // the Ni row, in the second block, is left out; the subtotal row between them isn't charted
    expect([...(mask.get(wb.sheet) ?? [])].sort()).toEqual([2]);
  });
});

describe('column sparklines with set axis limits', () => {
  const group = (over: Partial<SparklineGroup>): SparklineGroup => ({ id: 1, kind: 'column', items: [], ...SPARK_DEFAULTS, ...over });

  it('all below zero still hang from zero with Same for All Sparklines (F288)', () => {
    const g = group({ minAxis: 'group', maxAxis: 'group' });
    const lim = groupLimits(g, [-1, -5, -3]);
    expect(lim).toEqual({ min: -5, max: 0 });
    const sh = sparkShape(g, [-1, -5], 40, 20, sparkLimits(g, [-1, -5], lim));
    const [a, b] = sh.bars!;
    expect(b.h / a.h).toBeCloseTo(5, 6);
    // only the minimum set: the maximum, left to each sparkline, takes in zero
    const one = group({ minAxis: 'group' });
    expect(sparkLimits(one, [-1, -5], groupLimits(one, [-1, -5, -8]))).toEqual({ min: -8, max: 0 });
    // a number typed for the maximum is kept as typed
    const typed = group({ maxAxis: -1 });
    expect(sparkLimits(typed, [-1, -5], groupLimits(typed, [-1, -5]))).toEqual({ min: -5, max: -1 });
    // a line sparkline's axis doesn't take in zero
    const line = group({ kind: 'line', minAxis: 'group', maxAxis: 'group' });
    expect(groupLimits(line, [-1, -5])).toEqual({ min: -5, max: -1 });
  });
});

describe('conditional formatting of empty cells', () => {
  const host = (vals: Record<number, string | number>, formulaAt: CfHost['formulaAt'] = () => null): CfHost => ({ value: (row, col) => vals[keyOf(row, col)] ?? null, formulaAt });

  it('formula rules over a large range work out only the cells in use (F1084)', () => {
    const vals: Record<number, number> = {};
    for (let i = 0; i < 10; i++) vals[keyOf(i, 0)] = i;
    let calls = 0;
    const cf = newCondFormat([R('A1:Y8000')], { kind: 'formula', formula: '=$A1>5', look: { fill: '#ffc7ce' } });
    workOutLooks([cf], host(vals, () => { calls++; return true; }), 9, 0);
    expect(calls).toBe(10);
    // a small range is taken whole: its empty cells past the last one in use are worked out too
    calls = 0;
    const small = newCondFormat([R('A1:E20')], { kind: 'formula', formula: '=ISBLANK(A1)', look: { fill: '#ffc7ce' } });
    const looks = workOutLooks([small], host(vals, () => { calls++; return true; }), 9, 0);
    expect(calls).toBe(100);
    expect(looks.get(keyOf(19, 4))?.fill).toBe('#ffc7ce');
  });

  it('"does not contain" marks the empty cells past the last one in use', () => {
    const vals: Record<number, string> = { [keyOf(0, 0)]: 'Pd', [keyOf(1, 0)]: 'Ni' };
    const cf = newCondFormat([R('A1:B4')], { kind: 'text', op: 'notContains', text: 'Pd', look: { fill: '#c6efce' } });
    const looks = workOutLooks([cf], host(vals), 1, 0);
    expect(looks.has(keyOf(0, 0))).toBe(false);
    expect(looks.get(keyOf(1, 0))?.fill).toBe('#c6efce');
    expect(looks.get(keyOf(3, 1))?.fill).toBe('#c6efce');
  });
});

describe('query tables with a Total Row whose columns change (F285)', () => {
  const cols3 = ['Entry', 'Catalyst', 'Temp'];
  const t3: QTable = { cols: cols3, types: ['whole', 'text', 'whole'], rows: [[1, 'Pd(OAc)2', 80], [2, 'Pd2(dba)3', 100], [3, 'NiCl2', 80]] };
  const q: Query = { id: 1, name: 'Screen', source: { kind: 'text', file: 'screen.csv', delimiter: 'auto' }, steps: [], table: null, loaded: cols3 };

  function loaded() {
    const wb = new Workbook();
    const s = wb.sheet;
    const got = wb.edit('Load', () => writeResult(s, { row: 0, col: 0 }, t3, null, q));
    wb.edit('Totals', () => {
      s.setInput(4, 0, 'Total');
      s.setInput(4, 2, '=SUBTOTAL(109,C2:C4)');
      s.patchStyle(R('A5:C5'), { bold: true });
      s.setTables(s.tables.map((x) => (x.id === got.table.id ? { ...x, totals: true, range: { ...x.range, r2: 4 } } : x)));
    });
    return { wb, s, id: got.table.id };
  }
  const refresh = (wb: Workbook, id: number, t: QTable) => {
    const own = wb.sheet.tables.find((x) => x.id === id)!;
    return wb.edit('Refresh', () => writeResult(wb.sheet, { row: 0, col: 0 }, t, own, q));
  };

  it('the old totals row\'s look doesn\'t stay on the record that takes its place', () => {
    const { wb, s, id } = loaded();
    const t4: QTable = { ...t3, rows: [...t3.rows, [4, 'CuI', 60]] };
    refresh(wb, id, t4);
    expect(s.value(4, 1)).toBe('CuI');
    expect(s.styleAt(4, 1)?.bold).toBeFalsy();
    expect(s.value(5, 0)).toBe('Total');
    expect(s.styleAt(5, 2)?.bold).toBe(true);
    // 80 + 100 + 80 + 60
    expect(s.value(5, 2)).toBe(320);
  });

  it('the label stays in the first column and each total follows its column', () => {
    const { wb, s, id } = loaded();
    const moved: QTable = { cols: ['Catalyst', 'Entry', 'Temp'], types: ['text', 'whole', 'whole'], rows: t3.rows.map(([e, c, t]) => [c, e, t]) };
    refresh(wb, id, moved);
    expect(s.value(4, 0)).toBe('Total');
    expect(s.cell(4, 1)?.input).toBeUndefined();
    expect(s.cell(4, 2)?.input).toBe('=SUBTOTAL(109,C2:C4)');
    // Temp moved to the first column: its total goes with it, and the label with its own column
    const { wb: wb2, s: s2, id: id2 } = loaded();
    refresh(wb2, id2, { cols: ['Temp', 'Entry', 'Catalyst'], types: ['whole', 'whole', 'text'], rows: t3.rows.map(([e, c, t]) => [t, e, c]) });
    expect(s2.cell(4, 0)?.input).toBe('=SUBTOTAL(109,A2:A4)');
    expect(s2.value(4, 0)).toBe(260);
    expect(s2.value(4, 1)).toBe('Total');
  });

  it('a column the results no longer have takes its total with it', () => {
    const { wb, s, id } = loaded();
    refresh(wb, id, { cols: ['Entry', 'Catalyst'], types: ['whole', 'text'], rows: t3.rows.map(([e, c]) => [e, c]) });
    const t = s.tables.find((x) => x.id === id)!;
    expect(t.range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 1 });
    expect(s.value(4, 0)).toBe('Total');
    expect(s.cell(4, 2)?.input).toBeUndefined();
  });

  it('a column added by hand keeps its total, made to cover the new records', () => {
    const { wb, s, id } = loaded();
    wb.edit('Add column', () => {
      s.setInput(0, 3, 'Mass');
      ['10', '20', '30'].forEach((v, i) => s.setInput(1 + i, 3, v));
      s.setInput(4, 3, '=SUBTOTAL(109,D2:D4)');
      s.setTables(s.tables.map((x) => (x.id === id ? { ...x, range: { ...x.range, c2: 3 } } : x)));
    });
    expect(s.value(4, 3)).toBe(60);
    refresh(wb, id, { ...t3, rows: t3.rows.slice(0, 2) });
    expect(s.value(0, 3)).toBe('Mass');
    expect(s.cell(3, 3)?.input).toBe('=SUBTOTAL(109,D2:D3)');
    expect(s.value(3, 3)).toBe(30);
    expect(s.value(3, 2)).toBe(180);
  });
});

describe('Go To Special ▸ Precedents', () => {
  it('overlapping blocks are selected once (F1091)', () => {
    const wb = book({ A10: '1', C1: '=SUM(A1:A10)+A5+SUM(A3:A7)' });
    const got = goToSpecial(wb.sheet, R('C1'), { r: 0, c: 2 }, { kind: 'precedents' })!;
    expect(got.reduce((n, x) => n + rangeSize(x), 0)).toBe(10);
  });
});

describe('dashboards', () => {
  it('names the labels of a table without a header row by the table\'s own column name (F1087)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Table', () => {
      s.setInput(0, 0, 'Above');
      [['Pd', '80'], ['Ni', '60']].forEach((row, i) => row.forEach((v, j) => s.setInput(1 + i, j, v)));
      s.setTables([{ id: 1, name: 'Runs', range: { r1: 1, c1: 0, r2: 2, c2: 1 }, style: 'none', header: false, bandRows: false, columns: [{ name: 'Catalyst' }, { name: 'Yield' }] }]);
    });
    expect(labelsName(wb, '=Sheet1!$A$2:$A$3')).toBe('Catalyst');
    // labels under a header cell are named by it
    expect(labelsName(wb, '=Sheet1!$A$2:$A$2')).toBe('Catalyst');
    const plain = book({ A1: 'Solvent', A2: 'THF' });
    expect(labelsName(plain, '=Sheet1!$A$2:$A$2')).toBe('Solvent');
  });
});

describe('data validation lists from a whole column', () => {
  it('stop at the cells in use', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      ['Pd', 'Ni', 'Cu'].forEach((t, i) => s.setInput(i, 7, t));
      wb.setNames([...wb.names, { name: 'Catalysts', formula: '=Sheet1!$H:$H' }] as never);
    });
    const v = newValidation([R('B2:B20')], { kind: 'list', value1: '=Catalysts' });
    const spy = vi.spyOn(s, 'shownText');
    expect(listItems(v, s, wb.validationHost(s))).toEqual(['Pd', 'Ni', 'Cu']);
    expect(spy.mock.calls.length).toBeLessThan(100);
  });
});

describe('work done by the faster paths', () => {
  it('sparklineAt reads a group\'s sparklines once, not for every cell drawn (F1125)', () => {
    let reads = 0;
    const items = Array.from({ length: 200 }, (_, i) => ({ row: i, col: 5, data: `A${i + 1}:E${i + 1}` }));
    const counted = new Proxy(items, { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) reads++; return Reflect.get(t, k); } });
    const groups = [{ id: 1, kind: 'line', items: counted, ...SPARK_DEFAULTS } as SparklineGroup];
    for (let i = 0; i < 200; i++) expect(sparklineAt(groups, i, 5)?.item.row).toBe(i);
    // a pass over every sparkline for each of 200 cells reads about 20,000
    expect(reads).toBeLessThan(1000);
  });

  it('box groups put each row in its category once (F1083)', () => {
    const cats = Array.from({ length: 400 }, (_, i) => `C${i % 100}`);
    const ys = Array.from({ length: 400 }, (_, i) => i);
    const spy = vi.spyOn(Array.prototype, 'filter');
    const g = boxGroups([{ cats, ys }], true);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(g.cats.length).toBe(100);
    expect(g.stats[0].every((x) => x?.n === 4)).toBe(true);
    // one pass over the rows for each of 100 categories is 100 filters of the rows (and more)
    expect(calls).toBeLessThan(250);
  });

  it('Dependents for every level reads each formula\'s references once (F1092)', () => {
    const cells: Record<string, string> = { B1: '1' };
    for (let i = 2; i <= 300; i++) cells[`B${i}`] = `=B${i - 1}+1`;
    const wb = book(cells);
    const spy = vi.spyOn(Array.prototype, 'some');
    const got = goToSpecial(wb.sheet, R('B1'), { r: 0, c: 1 }, { kind: 'dependents', allLevels: true });
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(got).toEqual([R('B2:B300')]);
    // level by level over every formula is about 300 × 300 / 2 checks
    expect(calls).toBeLessThan(5000);
  });
});
