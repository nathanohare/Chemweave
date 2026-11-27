// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (charts): data labels and error bars on stacked charts sit
// on the end of their own piece of the stack (F198), names from cells are drawn as typed (F872),
// an axis set to the same minimum and maximum still has a range (F873), a scatter's line joins its
// points in the rows' order (F874), a very long bubble series draws (F875), a chart picture too big
// for the canvas is drawn smaller instead of as a blank pixel (F871), and Sankey charts and
// decomposition trees stay inside their area and keep the node expanded (F888, F889, F890).
// The numbers are made-up data for the drawing, not chemistry.

import { describe, it, expect, vi } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { chartFromRange, chartData, type SeriesData, type Chart } from '../src/sheet/chart';
import { drawChart, numAxis, type ClickPart, type ChartHits } from '../src/render/chart-draw';
import { VectorContext, type Item } from '../src/render/vector';
import { chartBoxPng } from '../src/render/chart-box-paint';
import { newChartBox } from '../src/sheet/chart-box';

const r = (r1: number, c1: number, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });

function sheetOf(rows: (string | number)[][]): Workbook {
  const wb = new Workbook();
  wb.edit('fill', () => rows.forEach((row, i) => row.forEach((v, j) => wb.sheet.setInput(i, j, String(v)))));
  return wb;
}

const texts = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'text' }> => i.kind === 'text');
const paths = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'path' }> => i.kind === 'path');
const ys = (p: Extract<Item, { kind: 'path' }>) => p.segs.filter((s) => s.k !== 'Z').map((s) => (s as { y: number }).y);
const xsOf = (p: Extract<Item, { kind: 'path' }>) => p.segs.filter((s) => s.k !== 'Z').map((s) => (s as { x: number }).x);

describe('stacked charts (F198)', () => {
  // one category: A = 10 under B = 17, so B's piece runs from 10 to 27
  const stacked = () => {
    const wb = sheetOf([['', 'A', 'B'], ['x', 10, 17]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 1, 2), 'column');
    c.stacked = true;
    c.legend = 'none';
    return { wb, c };
  };

  it('puts a data label at the top of its own piece of the stack', () => {
    const { wb, c } = stacked();
    c.series[1].labels = true;
    const data = chartData(wb, wb.sheet, c);
    const v = new VectorContext();
    drawChart(v, c, data, 360, 240);
    const bar = paths(v.items).find((p) => p.fill === data[1].color)!;
    const top = Math.min(...ys(bar));
    const label = texts(v.items).find((t) => t.text === '17')!;
    // drawn 6 px over the bar's end, not partway down it (at 17)
    expect(label.y).toBeCloseTo(top - 6, 5);
  });

  it('centres an error bar on the top of its own piece', () => {
    const { wb, c } = stacked();
    c.series[1].errors = { kind: 'fixed', value: 2 };
    const data = chartData(wb, wb.sheet, c);
    const v = new VectorContext();
    drawChart(v, c, data, 360, 240);
    const bar = paths(v.items).find((p) => p.fill === data[1].color)!;
    const top = Math.min(...ys(bar));
    const whisker = paths(v.items).find((p) => p.stroke?.color === '#404040')!;
    const span = ys(whisker);
    expect((Math.min(...span) + Math.max(...span)) / 2).toBeCloseTo(top, 5);
  });
});

describe('names from cells (F872)', () => {
  it('draws a series name and a category with underscores as typed', () => {
    const wb = sheetOf([['', 'run_1'], ['NJ_023', 5], ['NJ_024', 7]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 2, 1), 'column');
    c.legend = 'bottom';
    c.title = undefined;
    const v = new VectorContext();
    drawChart(v, c, chartData(wb, wb.sheet, c), 360, 240);
    const t = texts(v.items).map((i) => i.text);
    expect(t).toContain('run_1');
    expect(t).toContain('NJ_023');
    // no piece drawn as a subscript
    expect(t).not.toContain('run');
  });

  it('still reads markup in titles', () => {
    const wb = sheetOf([['', 'y'], ['a', 5]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 1, 1), 'column');
    c.title = 'k_{obs}';
    const v = new VectorContext();
    drawChart(v, c, chartData(wb, wb.sheet, c), 360, 240);
    const t = texts(v.items).map((i) => i.text);
    expect(t).toContain('k');
    expect(t).toContain('obs');
  });
});

describe('an axis set to the same minimum and maximum (F873)', () => {
  it('still has a range, so every value has a place', () => {
    const a = numAxis(0, 10, { min: 5, max: 5 }, 'auto');
    expect(a.max).toBeGreaterThan(a.min);
    expect(Number.isFinite(a.frac(7))).toBe(true);
    const log = numAxis(1, 100, { log: true, min: 10, max: 10 }, 'auto');
    expect(log.max).toBeGreaterThan(log.min);
    expect(Number.isFinite(log.frac(20))).toBe(true);
    // a range that was set right is kept as it was
    expect([numAxis(0, 10, { min: 2, max: 8 }, 'auto').min, numAxis(0, 10, { min: 2, max: 8 }, 'auto').max]).toEqual([2, 8]);
  });
});

describe('scatter lines (F874)', () => {
  it('joins the points in the order of the rows, so a loop stays a loop', () => {
    // x goes up, then back down (as a cyclic voltammogram does)
    const wb = sheetOf([['x', 'y'], [0, 0], [2, 1], [1, 2]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 3, 1), 'scatter');
    c.series[0].line = true;
    c.series[0].marker = 'none';
    const data = chartData(wb, wb.sheet, c);
    const v = new VectorContext();
    drawChart(v, c, data, 360, 240);
    const line = paths(v.items).find((p) => p.stroke?.color === data[0].color && p.segs.length >= 3)!;
    const xs = xsOf(line);
    expect(xs.length).toBe(3);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeLessThan(xs[1]);
  });
});

describe('a very long bubble series (F875)', () => {
  it('draws without running out of stack', () => {
    const n = 400_000;
    // (points with no y are not drawn, so only the sizes are looked through)
    const wb = sheetOf([['x', 'y', 's'], [1, 1, 1], [2, 2, 2]]);
    const c = chartFromRange(wb.sheet, r(0, 0, 2, 2), 'bubble');
    const big: SeriesData = { name: 'big', xs: Array.from({ length: n }, (_, i) => i), ys: Array.from({ length: n }, (_, i) => (i < 3 ? i : NaN)), sizes: Array.from({ length: n }, (_, i) => 1 + (i % 5)), cats: [], color: '#4472c4', index: 0 };
    const chart: Chart = { ...c, series: [c.series[0]] };
    expect(() => drawChart(new VectorContext(), chart, [big], 360, 240)).not.toThrow();
  });
});

describe('the picture of a Document or Slides chart (F871)', () => {
  it('is drawn at one pixel per pixel when the canvas refuses the bigger one', () => {
    // a canvas that draws nothing, and gives an empty picture past 1,000 pixels across (as a browser does past its limit)
    const ctx: Record<string | symbol, unknown> = new Proxy({}, { get: (t: Record<string | symbol, unknown>, k) => (k in t ? t[k] : (t[k] = () => ({ width: 0 }))) });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (this: HTMLCanvasElement) {
      return this.width > 1000 ? 'data:,' : `data:image/png;base64,W${this.width}`;
    });
    try {
      const box = newChartBox('column');
      // 360 × 216 pt: 480 px across, 1,440 at three times
      const url = chartBoxPng(box, 360, 216, 3);
      expect(url).toBe('data:image/png;base64,W480');
    } finally { getContext.mockRestore(); toDataURL.mockRestore(); }
  });
});

const rects = (hits: ChartHits) => (hits.parts ?? []).filter((p): p is Extract<ClickPart, { shape: 'rect' }> => p.shape === 'rect');
function levels(weights: number[], ...cols: string[][]): SeriesData[] {
  return cols.map((cats, i) => ({ name: `Level ${i}`, cats, xs: cats.map((_, j) => j + 1), ys: i === 0 ? weights : [], color: '#4472c4', index: i }));
}
const chartOf = (kind: 'sankey' | 'decomp', n: number): Chart => {
  const wb = sheetOf([['a', 'b', 'w'], ['x', 'y', 1]]);
  const c = chartFromRange(wb.sheet, r(0, 0, 1, 2), kind);
  return { ...c, series: Array.from({ length: n }, (_, i) => ({ ...c.series[0], name: `Level ${i}` })), legend: 'none', title: undefined };
};

describe('a crowded Sankey column (F888)', () => {
  it('keeps every node inside the chart', () => {
    const n = 250;
    const cats = Array.from({ length: n }, (_, i) => `c${i}`);
    const data = levels(cats.map(() => 1), cats, cats.map(() => 'all'));
    const c = chartOf('sankey', 2);
    const h = 300;
    const hits = drawChart(new VectorContext(), c, data, 400, h);
    const nodes = rects(hits);
    expect(nodes.length).toBeGreaterThan(n);
    for (const p of nodes) expect(p.y + p.h).toBeLessThanOrEqual(hits.plot.y + hits.plot.h + 1e-6);
  });
});

describe('a decomposition tree (F889, F890)', () => {
  const cats = Array.from({ length: 12 }, (_, i) => `k${String(i).padStart(2, '0')}`);
  // twelve categories, the 9th (k08) with children; k11 with none
  const tree = () => {
    const rows = cats.flatMap((k) => (k === 'k11' ? [[k, '']] : [[k, `${k}-a`], [k, `${k}-b`]]));
    return levels(rows.map((_, i) => 100 - i), rows.map((x) => x[0]), rows.map((x) => x[1]));
  };

  it('keeps the node expanded among those shown when its column is cut short', () => {
    const c = { ...chartOf('decomp', 2), path: ['k08'] };
    // tall enough for about six rows
    const hits = drawChart(new VectorContext(), c, tree(), 560, 230);
    const open = rects(hits).find((p) => p.pick.length === 1 && p.pick[0].value === 'k08');
    expect(open).toBeDefined();
    // and clicking it closes it up again
    expect(open!.drill).toEqual([]);
  });

  it('keeps the first node below the column titles when only one row fits', () => {
    const c = chartOf('decomp', 2);
    const hits = drawChart(new VectorContext(), c, tree(), 560, 70);
    const top = hits.plot.y + 12 * 0.92 * 1.8;
    for (const p of rects(hits)) expect(p.y).toBeGreaterThanOrEqual(top - 1e-6);
  });

  it('does not expand a node with nothing under it', () => {
    const c = chartOf('decomp', 2);
    const hits = drawChart(new VectorContext(), c, tree(), 560, 900);
    const leaf = rects(hits).find((p) => p.pick.length === 1 && p.pick[0].value === 'k11')!;
    expect(leaf.drill).toBeUndefined();
    const other = rects(hits).find((p) => p.pick.length === 1 && p.pick[0].value === 'k01')!;
    expect(other.drill).toEqual(['k01']);
  });
});
