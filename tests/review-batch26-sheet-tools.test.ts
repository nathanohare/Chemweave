// Regression tests for the spreadsheet tools fixed in the November 2026 code review (batch 26):
// sparklines, LINEST, data validation, histograms and box charts, conditional formatting,
// dashboards, trendlines, Solver, Flash Fill and PivotTable layout. The expected numbers are
// worked out by hand in the comments from the definitions named there, not by the code tested.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { makeSparklines, sparkShape, sparklineAt, SPARK_DEFAULTS, type SparklineGroup } from '../src/sheet/sparklines';
import { leastSquares } from '../src/sheet/stats';
import { newValidation, passes, listItems, invalidCells, readDate } from '../src/sheet/validation';
import { histogram, boxStats, boxGroups } from '../src/sheet/chart-stats';
import { autoBins } from '../src/sheet/analysis-tools';
import { workOutLooks, newCondFormat, type CfHost } from '../src/sheet/conditional';
import { resolveSource, chartOfColumns } from '../src/sheet/dashboard';
import { fitPoints } from '../src/sheet/fit';
import { modelNames, solve, type SolverModel, type Problem } from '../src/sheet/solver';
import { runSolver, keepAnswer, answerReport } from '../src/sheet/solver-sheet';
import { flashFill } from '../src/sheet/flash-fill';
import { layoutPivot, newPivotId, type PivotTable, type PivotSource } from '../src/sheet/pivot';
import { writePivot } from '../src/sheet/pivot-sheet';
import { keyOf } from '../src/sheet/refs';

const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });

afterEach(() => vi.restoreAllMocks());

describe('sparklines', () => {
  const group = (over: Partial<SparklineGroup>): SparklineGroup => ({ id: 1, kind: 'column', items: [], ...SPARK_DEFAULTS, ...over });

  it('columns all below zero hang from zero, the most negative the longest (F288)', () => {
    const sh = sparkShape(group({}), [-1, -5], 40, 20);
    const [a, b] = sh.bars!;
    expect(b.h).toBeGreaterThan(a.h);
    // -5 is five times as far from zero as -1
    expect(b.h / a.h).toBeCloseTo(5, 6);
    expect(a.y).toBe(b.y);
  });

  it('right to left marks the first point at the right (F1126)', () => {
    const g = group({ kind: 'line', rtl: true, first: true, last: true, firstColor: '#00ff00', lastColor: '#0000ff' });
    const sh = sparkShape(g, [1, 2, 3], 40, 20);
    const first = sh.dots!.find((d) => d.color === '#00ff00')!, last = sh.dots!.find((d) => d.color === '#0000ff')!;
    expect(first.x).toBeGreaterThan(last.x);
    // the first point is the value 1, the lowest, drawn lowest (the largest y)
    expect(first.y).toBeGreaterThan(last.y);
  });

  it('quotes a sheet named like a cell in the data reference (F1124)', () => {
    const g = makeSparklines('line', r(1, 1, 1, 5), r(1, 6), 'Q1');
    if (typeof g === 'string') throw new Error(g);
    expect(g.items[0].data).toBe("'Q1'!B2:F2");
    const plain = makeSparklines('line', r(1, 1, 1, 5), r(1, 6), 'Data');
    if (typeof plain === 'string') throw new Error(plain);
    expect(plain.items[0].data).toBe('Data!B2:F2');
  });

  it('finds the sparkline in a cell, and a new list of groups is read afresh (F1125)', () => {
    const g = group({ items: [{ row: 0, col: 5, data: 'A1:E1' }, { row: 1, col: 5, data: 'A2:E2' }] });
    const list = [g];
    expect(sparklineAt(list, 1, 5)?.item.data).toBe('A2:E2');
    expect(sparklineAt(list, 2, 5)).toBeNull();
    const moved = [{ ...g, items: [{ row: 2, col: 5, data: 'A3:E3' }] }];
    expect(sparklineAt(moved, 2, 5)?.item.data).toBe('A3:E3');
    expect(sparklineAt(moved, 1, 5)).toBeNull();
  });
});

describe('LINEST', () => {
  it('keeps the linear term of a cubic in time over an hour (F289)', () => {
    // y = 1 + 2x + 0.003x² + 4e-7x³ exactly, x in seconds from 0 to 3600: the fit gives the
    // coefficients back
    const xs = [0, 600, 1200, 1800, 2400, 3000, 3600];
    const y = xs.map((x) => 1 + 2 * x + 3e-3 * x * x + 4e-7 * x ** 3);
    const fit = leastSquares(y, xs.map((x) => [x, x * x, x ** 3]), true)!;
    expect(fit.coef[0]).toBeCloseTo(2, 5);
    expect(fit.coef[1] / 3e-3).toBeCloseTo(1, 6);
    expect(fit.coef[2] / 4e-7).toBeCloseTo(1, 6);
    expect(fit.intercept).toBeCloseTo(1, 4);
  });

  it('still drops a column that is a multiple of another, and one that never changes', () => {
    const xs = [1, 2, 3, 4, 5];
    const fit = leastSquares(xs.map((x) => 3 * x + 1), xs.map((x) => [x, 2 * x]), true)!;
    expect(fit.coef[1]).toBe(0);
    expect(fit.coef[0]).toBeCloseTo(3, 9);
    const flat = leastSquares([1, 2, 3, 4, 5], xs.map((x) => [x, 0.1]), true)!;
    expect(flat.coef[1]).toBe(0);
  });
});

describe('data validation', () => {
  it('a list from a defined name has the name\'s cells as items (F291)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      ['Pd(OAc)2', 'NiCl2', 'CuI'].forEach((t, i) => s.setInput(1 + i, 7, t));
      s.setInput(1, 1, 'NiCl2');
      s.setInput(2, 1, 'FeCl3');
      wb.setNames([...wb.names, { name: 'Catalysts', formula: '=Sheet1!$H$2:$H$4' }] as never);
    });
    const v = newValidation([r(1, 1, 19, 1)], { kind: 'list', value1: '=Catalysts' });
    const host = wb.validationHost(s);
    expect(listItems(v, s, host)).toEqual(['Pd(OAc)2', 'NiCl2', 'CuI']);
    expect(passes(v, 'NiCl2', 'NiCl2', s, host, 1, 1)).toBe(true);
    expect(passes(v, 'FeCl3', 'FeCl3', s, host, 2, 1)).toBe(false);
    wb.edit('Rule', () => s.setValidations([v]));
    expect(invalidCells(s, host)).toEqual([{ row: 2, col: 1 }]);
  });

  it('Text length and List test the value, not its number format (F292)', () => {
    const wb = new Workbook();
    const s = wb.sheet, host = wb.validationHost(s);
    const list = newValidation([r(0, 0)], { kind: 'list', value1: '1,5,10' });
    // 5 in a cell formatted 0.00 shows 5.00
    expect(passes(list, 5, '5.00', s, host, 0, 0)).toBe(true);
    expect(passes(list, 6, '6.00', s, host, 0, 0)).toBe(false);
    const len = newValidation([r(0, 0)], { kind: 'length', op: 'lessThanOrEqual', value1: '6' });
    // 1234.5 is six characters; as currency it shows $1,234.50
    expect(passes(len, 1234.5, '$1,234.50', s, host, 0, 0)).toBe(true);
    expect(passes(len, 1234.56, '$1,234.56', s, host, 0, 0)).toBe(false);
  });

  it('Circle Invalid Data reads a list\'s cells once, not for every cell (F293)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      for (let i = 0; i < 40; i++) s.setInput(i, 7, `Item${i}`);
      for (let i = 0; i < 60; i++) s.setInput(i, 0, `Item${i}`);
    });
    const v = newValidation([r(0, 0, 99, 0)], { kind: 'list', value1: '=$H$1:$H$40' });
    wb.edit('Rule', () => s.setValidations([v]));
    const spy = vi.spyOn(s, 'shownText');
    const bad = invalidCells(s, wb.validationHost(s));
    expect(bad.length).toBe(20);
    // 40 items once, plus each of the 60 cells: far fewer than 60 × 40
    expect(spy.mock.calls.length).toBeLessThan(200);
  });

  it('a date the month doesn\'t have is not a limit (F1127)', () => {
    expect(readDate('2/31/2026')).toBeNull();
    expect(readDate('2026-02-30')).toBeNull();
    expect(readDate('2026-04-31')).toBeNull();
    // 2026-01-31 is day 46053 (as the notes tests read it); 2028 is a leap year, and
    // 2028-02-29 is 365 + 365 + 29 days later: 46812
    expect(readDate('2028-02-29')).toBe(46812);
  });

  it('a limit reading an empty cell counts it as 0, not as a failed limit (F1128)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => s.setInput(1, 3, '10'));
    const v = newValidation([r(1, 1)], { kind: 'whole', value1: '=$D$1', value2: '=$D$2' });
    const host = wb.validationHost(s);
    expect(passes(v, 5, '5', s, host, 1, 1)).toBe(true);
    expect(passes(v, 11, '11', s, host, 1, 1)).toBe(false);
    expect(passes(v, -1, '-1', s, host, 1, 1)).toBe(false);
  });
});

describe('histograms and box charts', () => {
  it('box outliers without a search of the whiskers for each point (F271)', () => {
    const xs = [...Array.from({ length: 20 }, (_, i) => i + 1), 100];
    const spy = vi.spyOn(Array.prototype, 'includes');
    const st = boxStats(xs)!;
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(st.outliers).toEqual([100]);
    expect(st.inside.length).toBe(20);
    expect(calls).toBeLessThan(xs.length);
  });

  it('box groups put each row in its category (F1083)', () => {
    const g = boxGroups([{ cats: ['Pd', 'Ni', 'Pd', 'Ni', 'Cu'], ys: [1, 10, 3, 20, 7] }], true);
    expect(g.cats).toEqual(['Pd', 'Ni', 'Cu']);
    expect(g.stats[0].map((x) => x?.n)).toEqual([2, 2, 1]);
    expect(g.stats[0][1]?.mean).toBe(15);
  });

  it('more than 1000 bins widens the bins instead of piling the rest into the last (F1082)', () => {
    const values = Array.from({ length: 5001 }, (_, i) => i);
    const h = histogram(values, { width: 1 });
    expect(h.counts.length).toBe(1000);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(5001);
    // 5000 / 1000 = 5 wide: no bin holds more than six values
    expect(h.width).toBeCloseTo(5, 9);
    expect(Math.max(...h.counts)).toBeLessThanOrEqual(6);
    expect(h.widened).toBe(true);
  });

  it('automatic bins end at the largest number (F1080)', () => {
    // ten values 0.1 … 1.0: k = round(√10) = 3 bins of 0.3 from 0.1; 0.1 + 3 × 0.3 rounds below 1.0
    const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const bins = autoBins(xs);
    expect(bins.length).toBe(4);
    expect(bins[3]).toBe(1.0);
  });
});

describe('conditional formatting', () => {
  const host = (vals: Record<number, number>): CfHost => ({ value: (row, col) => vals[keyOf(row, col)] ?? null, formulaAt: () => null });

  it('an earlier data bar without Show Bar Only doesn\'t undo a later Show Icon Only (F1085)', () => {
    const vals: Record<number, number> = {};
    for (let i = 0; i < 5; i++) vals[keyOf(i, 0)] = i + 1;
    const bar = newCondFormat([r(0, 0, 4, 0)], { kind: 'bar', color: '#638ec6' });
    const icons = newCondFormat([r(0, 0, 4, 0)], { kind: 'icons', set: '3Arrows', iconOnly: true } as never);
    const looks = workOutLooks([bar, icons], host(vals), 4, 0);
    const a1 = looks.get(keyOf(0, 0))!;
    expect(a1.bar).toBeDefined();
    expect(a1.icon).toBeDefined();
    expect(a1.hideValue).toBe(true);
  });

  it('Blanks shades the empty cells past the last one in use (F1084)', () => {
    const vals: Record<number, number> = {};
    for (let rr = 0; rr < 5; rr++) for (let c = 0; c < 3; c++) vals[keyOf(rr, c)] = 1;
    const blanks = newCondFormat([r(0, 0, 9, 4)], { kind: 'blank', look: { fill: '#ffc7ce' } });
    const looks = workOutLooks([blanks], host(vals), 4, 2);
    expect(looks.get(keyOf(0, 3))?.fill).toBe('#ffc7ce');
    expect(looks.get(keyOf(9, 4))?.fill).toBe('#ffc7ce');
    expect(looks.has(keyOf(0, 0))).toBe(false);
    // whole columns still stop at the cells in use
    const whole = newCondFormat([r(0, 0, 1048575, 0)], { kind: 'blank', look: { fill: '#ffc7ce' } });
    expect(workOutLooks([whole], host(vals), 4, 2).size).toBe(0);
  });
});

describe('dashboards', () => {
  it('a table without a header row keeps its first record (F1087)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Table', () => {
      [['Pd', '80'], ['Ni', '60'], ['Cu', '50']].forEach((row, i) => row.forEach((v, j) => s.setInput(i, j, v)));
      s.setTables([{ id: 1, name: 'Runs', range: r(0, 0, 2, 1), style: 'none', header: false, bandRows: false, columns: [{ name: 'Catalyst' }, { name: 'Yield' }] }]);
    });
    const res = resolveSource(wb, { table: 'Runs' })!;
    expect(res.names).toEqual(['Catalyst', 'Yield']);
    expect(res.rows).toEqual([0, 1, 2]);
    const chart = chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 1);
    expect(chart.series[0]).toEqual({ name: 'Yield', x: '=Sheet1!$A$1:$A$3', y: '=Sheet1!$B$1:$B$3' });
  });
});

describe('trendlines', () => {
  it('every x the same non-integer value has no fit (F1106)', () => {
    expect(fitPoints('linear', [0.1, 0.1, 0.1], [1, 2, 3])).toBeNull();
    expect(fitPoints('linear', [2.5, 2.5, 2.5, 2.5], [1, 2, 3, 4])).toBeNull();
    expect(fitPoints('poly2', [0.1, 0.1, 0.2, 0.2], [1, 2, 3, 4])).toBeNull();
    expect(fitPoints('linear', [0.1, 0.2, 0.3], [1, 2, 3])?.coef[1]).toBeCloseTo(10, 9);
  });

  it('a fixed intercept other than 0 takes R² about the mean (F1107)', () => {
    // through (0, 5): slope = Σx(y−5)/Σx² = (5 + 11 + 13.5 + 20)/30 = 1.65; residuals 3.35, 2.2,
    // −0.45, −1.6 (squares 18.825); about the mean 10, SST = 0.5: R² = 1 − 18.825/0.5 = −36.65
    const f = fitPoints('linear', [1, 2, 3, 4], [10, 10.5, 9.5, 10], 5)!;
    expect(f.coef[1]).toBeCloseTo(1.65, 12);
    expect(f.r2).toBeCloseTo(-36.65, 9);
    // through the origin it is still taken about zero (as LINEST with no constant)
    const o = fitPoints('linear', [1, 2, 3], [2, 4, 6.5], 0)!;
    // slope = (2 + 8 + 19.5)/14 = 29.5/14; SSres = Σ(y − bx)², SST = Σy² = 62.25
    const b = 29.5 / 14;
    const ssRes = (2 - b) ** 2 + (4 - 2 * b) ** 2 + (6.5 - 3 * b) ** 2;
    expect(o.r2).toBeCloseTo(1 - ssRes / 62.25, 12);
  });

  it('first-order decay with y₀ fixed at 1 takes R² about the mean of ln y (F1109)', () => {
    // ln y = 0, ln 0.6, ln 0.25 at t = 0, 1, 2; through ln y₀ = 0 the slope is Σt·ln y / Σt²;
    // R² = 1 − SSres / Σ(ln y − mean)² = 0.97294902… (worked out from that definition)
    const f = fitPoints('order1', [0, 1, 2], [1, 0.6, 0.25], 1)!;
    expect(f.coef[0]).toBe(1);
    expect(f.r2).toBeCloseTo(0.9729490201, 8);
  });
});

describe('Solver', () => {
  const model = (over: Partial<SolverModel>): SolverModel => ({ objective: '', goal: 'max', vars: '', constraints: [], nonNegative: true, engine: 'simplex', ...over });
  function sheet(cells: Record<string, string>) {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.edit('set', () => {
      for (const [ref, v] of Object.entries(cells)) {
        const m = /^([A-Z])(\d+)$/.exec(ref)!;
        s.setInput(Number(m[2]) - 1, m[1].charCodeAt(0) - 65, v);
      }
    });
    return { wb, s };
  }

  it('an empty objective or variable cells writes no name (F1121)', () => {
    const wb = new Workbook();
    const names = modelNames(model({ objective: '=$B$3', vars: '' }), wb.sheet).map((n) => n.name);
    expect(names).toContain('solver_opt');
    expect(names).not.toContain('solver_adj');
    const other = modelNames(model({ objective: '', vars: '=$B$1' }), wb.sheet);
    expect(other.map((n) => n.name)).not.toContain('solver_opt');
    expect(other.every((n) => n.formula !== '=')).toBe(true);
  });

  it('the Answer Report works out a formula limit and gives the solve\'s own time (F1119, F1120)', () => {
    // max A1 with A1 ≤ D1·2, D1 = 2: A1 = 4, and the limit holds exactly
    const { wb, s } = sheet({ A1: '0', A2: '=A1', D1: '2' });
    const m = model({ objective: '=$A$2', vars: '=$A$1', constraints: [{ lhs: '=$A$2', rel: '<=', rhs: '=$D$1*2' }] });
    const run = runSolver(wb, s, m);
    if (typeof run === 'string') throw new Error(run);
    expect(run.result.x[0]).toBeCloseTo(4, 8);
    expect(typeof run.ms).toBe('number');
    wb.edit('Solver', () => keepAnswer(s, run));
    const rep = answerReport(s, m, { ...run, ms: 1500 }, new Date());
    const row = rep.find((x) => x[1] === '$A$2' && x[4] === '$A$2<=$D$1*2')!;
    expect(row[5]).toBe('Binding');
    expect(row[6]).toBeCloseTo(0, 8);
    expect(rep.some((x) => typeof x[0] === 'string' && x[0].startsWith('Solution Time: 1.500 Seconds'))).toBe(true);
  });

  const problem = (over: Partial<Problem>): Problem => ({
    n: 1, x0: [0], lower: [0], upper: [10], integer: [false], allDifferent: [], limits: [], evaluate: () => ({ f: 0, g: [] }),
    precision: 1e-6, intTolerance: 0, convergence: 1e-4, deadline: Date.now() + 30000, maxEvaluations: 200000, population: 100, seed: 1, ...over,
  });

  it('a whole-number answer reports its own objective and limits (F1122)', () => {
    // max x (f = −x) with x − 2.9999995 ≤ 0 and x whole: the relaxed answer is 2.9999995, kept
    // as 3; at 3 the objective is −3 and the limit's g is 3 − 2.9999995 = 5e-7
    const res = solve(problem({ integer: [true], limits: [{ rel: '<=' }], evaluate: (x) => ({ f: -x[0], g: [x[0] - 2.9999995] }) }), 'grg');
    expect(res.x[0]).toBe(3);
    expect(res.f).toBe(-3);
    expect(res.g[0]).toBeCloseTo(5e-7, 12);
  });

  it('the Evolutionary engine stops making its start population at the time limit (F1123)', () => {
    let calls = 0;
    const res = solve(problem({ deadline: Date.now() - 1, population: 200, evaluate: (x) => { calls++; return { f: (x[0] - 3) ** 2, g: [] }; } }), 'evolutionary');
    expect(res.status).toBe('limit');
    expect(calls).toBeLessThan(10);
  });
});

describe('Flash Fill', () => {
  it('works out each way\'s cost once, not at each comparison of the sort (F275)', () => {
    const rows = [
      ['Pd(OAc)2 in THF at 80 C', 'run 12 of 40', 'Smith A. B.'],
      ['NiCl2 in DMF at 100 C', 'run 13 of 40', 'Jones C. D.'],
      ['CuI in MeCN at 60 C', 'run 14 of 40', 'Brown E. F.'],
    ];
    const spy = vi.spyOn(Array.prototype, 'reduce');
    const got = flashFill([{ row: rows[0], out: 'Pd(OAc)2 THF 80 run 12 Smith' }], rows.slice(1));
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(got?.values).toEqual(['NiCl2 DMF 100 run 13 Jones', 'CuI MeCN 60 run 14 Brown']);
    expect(calls).toBeLessThan(200000);
  });
});

describe('PivotTable layout', () => {
  it('finds each row line\'s records once, not for every column (F283)', () => {
    // 300 records: 100 catalysts × 3 solvents; each record read through a counter
    let reads = 0;
    const plain: (string | number)[][] = [];
    for (let i = 0; i < 100; i++) for (const sv of ['THF', 'DMF', 'MeCN']) plain.push([`Cat${String(i).padStart(3, '0')}`, sv, i]);
    const records = plain.map((rec) => new Proxy(rec, { get(t, k) { if (k === '0' || k === '1') reads++; return Reflect.get(t, k); } }));
    const src: PivotSource = { fields: ['Catalyst', 'Solvent', 'Yield'], records };
    const pt: PivotTable = {
      id: newPivotId(), name: 'P', source: '=A1:C301', at: { row: 0, col: 5 }, rows: ['Catalyst'], cols: ['Solvent'], values: [{ field: 'Yield', fn: 'sum' }],
      filters: [], hidden: {}, layout: 'compact', subtotals: true, grandRows: true, grandCols: true,
    };
    const rep = layoutPivot(pt, src);
    if (typeof rep === 'string') throw new Error(rep);
    // Cat007 in DMF summed 7
    const i = rep.rowLines.findIndex((l) => l.path[0] === 'Cat007'), j = rep.colLines.findIndex((l) => l.path[0] === 'DMF');
    expect(rep.cells[rep.body.row + i][rep.body.col + j]).toBe(7);
    // 101 row lines × 4 column lines would read every record again for each pair (over 100,000)
    expect(reads).toBeLessThan(30000);
  });

  it('writes a large report with number formats without searching the styles for each cell (F282)', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      s.setInput(0, 0, 'Catalyst'); s.setInput(0, 1, 'Yield');
      for (let i = 1; i <= 400; i++) { s.setInput(i, 0, `Cat${String(i).padStart(3, '0')}`); s.setInput(i, 1, String(i)); }
    });
    const pt: PivotTable = {
      id: newPivotId(), name: 'P', source: '=Sheet1!$A$1:$B$401', at: { row: 0, col: 4 }, rows: ['Catalyst'], cols: [], values: [{ field: 'Yield', fn: 'sum', numFmt: '0.0' }],
      filters: [], hidden: {}, layout: 'compact', subtotals: true, grandRows: true, grandCols: true,
    };
    const spy = vi.spyOn(Array.prototype, 'find');
    let kept: PivotTable | string = '';
    wb.edit('Pivot', () => { kept = writePivot(s, pt); });
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(typeof kept).not.toBe('string');
    expect(s.value(1, 5)).toBe(1);
    // one search for each of the report's 800 or so cells is what made it slow
    expect(calls).toBeLessThan(700);
  });
});
