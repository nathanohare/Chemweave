// @vitest-environment jsdom
//
// Chart and axis titles keep their looks (G3-05): italic k, bold compound numbers and a second
// line in an Excel, PowerPoint or Word chart's title are read with it, drawn, and written back
// (ECMA-376 Part 1, 21.2.2.214 title / c:tx / c:rich, DrawingML a:p, a:r and a:rPr b, i, u,
// baseline) when the chart is changed here and saved. A title retyped here is plain again.
// The fixture XML below is written by hand from the standard's element names, not taken from a
// file Office made.

import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { chartFromRange, chartData, retitle, titleIs, titleMarkup, titleRunsOf, titleWithLook, type Chart } from '../src/sheet/chart';
import { readChartXml, chartXml } from '../src/io/xlsx-chart';
import { drawChart, markupRuns, titleLines } from '../src/render/chart-draw';

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');

/** A chart of a first-order decay (time, ln([A]/[A]0)), with a title. */
function chart(): { wb: Workbook; c: Chart } {
  const wb = new Workbook();
  const rows = [['t (min)', 'ln'], [0, 0], [10, -0.43], [20, -0.85], [30, -1.27]];
  wb.edit('fill', () => rows.forEach((row, i) => row.forEach((v, j) => wb.sheet.setInput(i, j, String(v)))));
  const c = chartFromRange(wb.sheet, { r1: 0, c1: 0, r2: 4, c2: 1 }, 'scatter');
  return { wb, c: { ...c, title: 'Decay' } };
}

/** An Excel-style title: italic k, subscript obs, bold " 3a", and a second paragraph. */
const RICH_TITLE = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/>
  <a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US" i="1"/><a:t>k</a:t></a:r><a:r><a:rPr lang="en-US" baseline="-25000"/><a:t>obs</a:t></a:r><a:r><a:rPr lang="en-US" b="1"/><a:t> 3a</a:t></a:r></a:p>
  <a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>(25 °C)</a:t></a:r></a:p>
</c:rich></c:tx><c:overlay val="0"/></c:title>`;

/** Our own chart's XML with its title element swapped for `title`. */
function withTitle(c: Chart, wb: Workbook, title: string): Document {
  const x = chartXml(c, chartData(wb, wb.sheet, c));
  return parse(x.replace(/<c:title>[\s\S]*?<\/c:title>/, title));
}

const titleOf = (d: Document) => d.getElementsByTagNameNS(C, 'chart')[0].getElementsByTagNameNS(C, 'title')[0];

describe('chart titles with looks', () => {
  it('reads italic, bold, sub- and superscript runs and paragraphs', () => {
    const { wb, c } = chart();
    const got = readChartXml(withTitle(c, wb, RICH_TITLE), c.at, c.w, c.h, 1)!.chart;
    expect(got.title).toBe('k_{obs} 3a (25 °C)');
    expect(got.titleRuns).toEqual([
      { text: 'k', italic: true }, { text: 'obs', sub: true }, { text: ' 3a', bold: true }, { text: '\n' }, { text: '(25 °C)' },
    ]);
    expect(titleRunsOf(got.title, got.titleRuns)).toBe(got.titleRuns);
  });

  it('writes them back when the chart is saved (italic, bold, the second paragraph)', () => {
    const { wb, c } = chart();
    const got = readChartXml(withTitle(c, wb, RICH_TITLE), c.at, c.w, c.h, 1)!.chart;
    const again = parse(chartXml({ ...got, legend: 'bottom' }, chartData(wb, wb.sheet, got)));
    const t = titleOf(again);
    const paras = t.getElementsByTagNameNS(A, 'p');
    expect(paras).toHaveLength(2);
    const runs = [...paras[0].getElementsByTagNameNS(A, 'r')].map((r) => ({ t: r.textContent, pr: r.getElementsByTagNameNS(A, 'rPr')[0] }));
    expect(runs.map((r) => r.t)).toEqual(['k', 'obs', ' 3a']);
    expect(runs[0].pr.getAttribute('i')).toBe('1');
    expect(runs[1].pr.getAttribute('baseline')).toBe('-25000');
    expect(runs[2].pr.getAttribute('b')).toBe('1');
    expect(paras[1].textContent).toBe('(25 °C)');
    // and read the same again
    expect(readChartXml(again, c.at, c.w, c.h, 1)!.chart.titleRuns).toEqual(got.titleRuns);
  });

  it('a bold title as the paragraph sets it (a:defRPr b="1") stays bold', () => {
    const { wb, c } = chart();
    const t = `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr b="1"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>Rate</a:t></a:r></a:p></c:rich></c:tx></c:title>`;
    const got = readChartXml(withTitle(c, wb, t), c.at, c.w, c.h, 1)!.chart;
    expect(got.titleRuns).toEqual([{ text: 'Rate', bold: true }]);
    const again = parse(chartXml(got, chartData(wb, wb.sheet, got)));
    expect(titleOf(again).getElementsByTagNameNS(A, 'rPr')[0].getAttribute('b')).toBe('1');
  });

  it('axis titles keep theirs too', () => {
    const { wb, c } = chart();
    const x = chartXml({ ...c, y: { ...c.y, title: 'ln' } }, chartData(wb, wb.sheet, c))
      .replace(/<c:title><c:tx><c:rich><a:bodyPr\/><a:lstStyle\/><a:p><a:pPr><a:defRPr sz="1000" b="0"\/><\/a:pPr><a:r><a:rPr lang="en-US" sz="1000" b="0"\/><a:t>ln<\/a:t><\/a:r><\/a:p><\/c:rich><\/c:tx>/,
        '<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>ln([A]/[A]</a:t></a:r><a:r><a:rPr baseline="-25000"/><a:t>0</a:t></a:r><a:r><a:rPr/><a:t>) vs </a:t></a:r><a:r><a:rPr i="1"/><a:t>t</a:t></a:r></a:p></c:rich></c:tx>');
    const got = readChartXml(parse(x), c.at, c.w, c.h, 1)!.chart;
    const axis = [got.x, got.y].find((a) => a.title?.startsWith('ln'))!;
    expect(axis.title).toBe('ln([A]/[A]_{0}) vs t');
    expect(axis.titleRuns?.find((r) => r.text === 't')).toEqual({ text: 't', italic: true });
    expect(chartXml(got, chartData(wb, wb.sheet, got))).toContain('i="1"/><a:t>t</a:t>');
  });

  it('a title retyped here is written as typed, its old looks left out', () => {
    const { wb, c } = chart();
    const got = readChartXml(withTitle(c, wb, RICH_TITLE), c.at, c.w, c.h, 1)!.chart;
    const retyped = { ...got, title: 'k_{obs} for 3b' };
    expect(titleRunsOf(retyped.title, retyped.titleRuns)).toBeNull();
    const t = titleOf(parse(chartXml(retyped, chartData(wb, wb.sheet, retyped))));
    expect(t.getElementsByTagNameNS(A, 'p')).toHaveLength(1);
    expect(t.outerHTML ?? new XMLSerializer().serializeToString(t)).not.toContain('i="1"');
  });

  it('the markup of runs is the title read from them (escapes as the reader writes them)', () => {
    expect(titleMarkup([{ text: 'a_b' }, { text: '2', sup: true }, { text: '\n' }, { text: 'c' }])).toBe('a\\_b^{2} c');
  });

  it('is drawn with its italic and bold pieces', () => {
    const { wb, c } = chart();
    const got = readChartXml(withTitle(c, wb, RICH_TITLE), c.at, c.w, c.h, 1)!.chart;
    const fonts: string[] = [];
    const texts: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (o, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 5 }) : k === 'fillText' ? (s: string) => { texts.push(s); fonts.push(String(o.font)); } : k in o ? o[k as string] : () => undefined),
      set: (o, k, v) => { o[k as string] = v; return true; },
    });
    drawChart(ctx as unknown as CanvasRenderingContext2D, got, chartData(wb, wb.sheet, got), 400, 300);
    expect(fonts[texts.indexOf('k')]).toMatch(/^italic /);
    expect(fonts[texts.indexOf(' 3a')]).toMatch(/bold/);
  });
});

describe('the Titles window keeps a title\'s looks only while its words are the same (F3-R06)', () => {
  it('confirmed unchanged (spaces at the ends aside): the title and its looks as they were', () => {
    const runs = [{ text: ' ' }, { text: 'k', italic: true }, { text: 'obs ' }];
    expect(retitle({ title: ' kobs ', titleRuns: runs }, 'kobs')).toEqual({ title: ' kobs ', titleRuns: runs });
    // retyped: plain, the old looks dropped (so typing the old words again later doesn't bring them back)
    const edited = retitle({ title: ' kobs ', titleRuns: runs }, 'kobs (s^{-1})');
    expect(edited).toEqual({ title: 'kobs (s^{-1})', titleRuns: undefined });
    expect(retitle(edited, 'kobs')).toEqual({ title: 'kobs', titleRuns: undefined });
    // emptied: no title
    expect(retitle({ title: 'Decay' }, '  ')).toEqual({ title: undefined, titleRuns: undefined });
  });
});

/** A canvas stand-in that keeps what is written where, and the lines stroked. */
function recorder() {
  const texts: { s: string; x: number; y: number; font: string }[] = [];
  const lines: number[][] = [];
  let at: number[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (o, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 5 })
      : k === 'fillText' ? (s: string, x: number, y: number) => { texts.push({ s, x, y, font: String(o.font) }); }
      : k === 'moveTo' ? (x: number, y: number) => { at = [x, y]; }
      : k === 'lineTo' ? (x: number, y: number) => { lines.push([...at, x, y]); at = [x, y]; }
      : k in o ? o[k as string] : () => undefined),
    set: (o, k, v) => { o[k as string] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, lines };
}

describe('chart titles made here (F3 Needs Nate 4, F8b)', () => {
  it('Bold and Italic in the Chart Titles window apply to the whole title, and come off again', () => {
    const bold = titleWithLook({ title: 'k_{obs}' }, { bold: true, italic: false }, markupRuns);
    expect(bold).toEqual({ title: 'k_{obs}', titleRuns: [{ text: 'k', bold: true }, { text: 'obs', sub: true, bold: true }] });
    expect(titleIs(bold, 'bold')).toBe(true);
    expect(titleIs(bold, 'italic')).toBe(false);
    expect(titleWithLook(bold, { bold: false, italic: false }, markupRuns)).toEqual({ title: 'k_{obs}', titleRuns: undefined });
    // left as it was: unchanged, a file's mixed looks kept
    const mixed = { title: 'k 3a', titleRuns: [{ text: 'k', italic: true }, { text: ' 3a', bold: true }] };
    expect(titleWithLook(mixed, { bold: false, italic: false }, markupRuns)).toBe(mixed);
  });

  it('draws an underlined title with a line under it, and a second paragraph on a line of its own', () => {
    const { wb, c } = chart();
    const title = { title: 'Decay (25 °C)', titleRuns: [{ text: 'Decay', underline: true }, { text: '\n' }, { text: '(25 °C)' }] };
    expect(titleMarkup(title.titleRuns)).toBe(title.title);
    expect(titleLines(title.titleRuns)).toHaveLength(2);
    const r = recorder();
    drawChart(r.ctx, { ...c, ...title }, chartData(wb, wb.sheet, c), 400, 300);
    const first = r.texts.find((t) => t.s === 'Decay')!, second = r.texts.find((t) => t.s === '(25 °C)')!;
    expect(second.y).toBeGreaterThan(first.y + 10);
    expect(Math.abs(second.x + 7 * 5 / 2 - 200)).toBeLessThan(1);
    // the underline: a level line under "Decay", as wide as it
    expect(r.lines.some(([x1, y1, x2, y2]) => y1 === y2 && y1 > first.y && Math.abs(x1 - first.x) < 1e-6 && Math.abs(x2 - x1 - 25) < 1e-6)).toBe(true);
  });
});
