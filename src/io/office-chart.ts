// Charts in Word and PowerPoint files, as those programs keep them (ECMA-376 part 1, 21.2): the
// chart part (written as for Excel, with a copy of every number) and the chart's data as an
// Excel workbook embedded beside it, which their Edit Data opens. Reading takes the chart and
// puts the numbers it cached back into cells.

import { Package, PackageReader, kids, NS, REL } from './ooxml';
import { applyColorMods } from './dml-color';
import { chartXml, readChartXml, CT_CHART, REL_CHART, CT_CHARTEX, REL_CHARTEX, CX_NS, addChartExStyle } from './xlsx-chart';
import { writeXlsx, type XlsxPictures } from './xlsx';
import { ChartBox, boxBook, boxData, boxFromCaches, PX_PER_PT } from '../sheet/chart-box';
import { newChartId, isChartEx, type Chart } from '../sheet/chart';
import { chartPrint, chartPrintXml } from './native-print';

export { CT_CHART, REL_CHART, CX_NS };
export const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const REL_PACKAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
const CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The data of a chart has no structures in it: nothing to draw. */
const NO_PICTURES: XlsxPictures = { box: () => ({ w: 0, h: 0 }), picture: async () => null };

/** A path from one part's folder to another part ("../charts/chart1.xml"). */
function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * Add a chart to a package being written: its part (in `dir`/charts) and its data as a workbook
 * (in `dir`/embeddings). Returns the relationship id from `from` to the chart, and the chart's
 * print (native-print.ts) to keep with our copy of it. Histograms and box charts go in the newer
 * chart part of Office 2016 (chartEx), which the caller wraps for older programs.
 */
export async function addChart(pkg: Package, from: string, dir: string, n: number, box: ChartBox, w: number, h: number): Promise<{ rid: string; print: string }> {
  const ex = isChartEx(box.chart.kind);
  const path = `${dir}/charts/${ex ? 'chartEx' : 'chart'}${n}.xml`;
  const book = `${dir}/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`;
  // (made afresh from the chart's data on every save: undated, so the same chart saves the same bytes)
  pkg.add(book, await writeXlsx(boxBook(box).wb, NO_PICTURES, { undated: true }));
  pkg.defaultType('xlsx', CT_XLSX);
  const rid = pkg.relate(path, REL_PACKAGE, relative(path, book));
  const sized = { ...box.chart, w: Math.round(w * PX_PER_PT), h: Math.round(h * PX_PER_PT) };
  const body = ex
    ? chartXml(sized, boxData(box)).replace('<cx:chartData>', `<cx:chartData><cx:externalData r:id="${rid}" cx:autoUpdate="0"/>`)
    : chartXml(sized, boxData(box)).replace(/<\/c:chartSpace>$/, `<c:externalData r:id="${rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`);
  pkg.add(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`, ex ? CT_CHARTEX : CT_CHART);
  if (ex) addChartExStyle(pkg, path, n);
  return { rid: pkg.relate(from, ex ? REL_CHARTEX : REL_CHART, relative(from, path)), print: chartPrintXml(body, sized.w, sized.h) };
}

/** The numbers and labels a chart part cached beside each of its references. */
function cachesOf(doc: Document): { ref: string; values: string[] }[] {
  const out: { ref: string; values: string[] }[] = [];
  // a newer chart: each block of data's numbers and labels, with their references
  for (const dim of Array.from(doc.getElementsByTagNameNS(CX_NS, 'numDim')).concat(Array.from(doc.getElementsByTagNameNS(CX_NS, 'strDim')))) {
    const f = kids(dim, 'f')[0]?.textContent?.trim();
    const lvl = kids(dim, 'lvl')[0];
    if (!f || !lvl) continue;
    const n = Number(lvl.getAttribute('ptCount') ?? 0);
    const values: string[] = Array(Math.max(0, Math.min(100000, n))).fill('');
    const text = dim.localName === 'strDim';
    for (const pt of kids(lvl, 'pt')) {
      const i = Number(pt.getAttribute('idx'));
      const v = pt.textContent ?? '';
      if (Number.isInteger(i) && i >= 0 && i < values.length) values[i] = text && v.trim() !== '' && Number.isFinite(Number(v)) ? `'${v}` : v;
    }
    out.push({ ref: f, values });
  }
  // a name given by reference
  for (const td of Array.from(doc.getElementsByTagNameNS(CX_NS, 'txData'))) {
    const f = kids(td, 'f')[0]?.textContent?.trim();
    if (f) out.push({ ref: f, values: [kids(td, 'v')[0]?.textContent ?? ''] });
  }
  for (const tag of ['numRef', 'strRef']) {
    for (const el of Array.from(doc.getElementsByTagNameNS(C_NS, tag))) {
      const f = kids(el, 'f')[0]?.textContent?.trim();
      const cache = kids(el, tag === 'numRef' ? 'numCache' : 'strCache')[0];
      if (!f || !cache) continue;
      const n = Number(kids(cache, 'ptCount')[0]?.getAttribute('val') ?? 0);
      const values: string[] = Array(Math.max(0, Math.min(100000, n))).fill('');
      for (const pt of kids(cache, 'pt')) {
        const i = Number(pt.getAttribute('idx'));
        const v = kids(pt, 'v')[0]?.textContent ?? '';
        // labels that read as numbers stay labels
        if (Number.isInteger(i) && i >= 0 && i < values.length) values[i] = tag === 'strRef' && v.trim() !== '' && Number.isFinite(Number(v)) ? `'${v}` : v;
      }
      out.push({ ref: f, values });
    }
  }
  return out;
}

/**
 * A chart from a Word or PowerPoint file (shown `w` × `h` points), with its data and its print (to
 * tell whether it is still the chart saved here); null when it has nothing this can show.
 */
export function readChart(pkg: PackageReader, path: string, w: number, h: number, theme?: Record<string, string> | null): { box: ChartBox; partial: boolean; print: string } | null {
  let doc: Document | null;
  try {
    doc = pkg.xml(path);
  } catch {
    return null;
  }
  if (!doc) return null;
  const got = readChartXml(doc, { row: 0, col: 0, dx: 0, dy: 0 }, w * PX_PER_PT, h * PX_PER_PT, newChartId());
  if (!got) return null;
  // (the print is of what the file says: the theme's colours below are only for showing it)
  const print = chartPrint(got.chart);
  if (theme) themeLook(got.chart, theme);
  return { box: boxFromCaches(got.chart, cachesOf(doc)), partial: got.partial, print };
}

/** A theme colour's name as a chart uses it (text and background) to the theme's own (dark 1, light 1…). */
const CHART_CLR_MAP: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

/**
 * A chart from a Word or PowerPoint file shown in that file's theme (`theme`: its colours, hex
 * without #; text and background as tx1 and bg1 on dark 1 and light 1, not a master's own
 * mapping): series without a colour of their own take its accents, as Office gives them, and a
 * series in a theme colour (accent2 made darker) shows that colour (office sampler F-V-05). Those
 * are saved as the theme's colours (schemeClr), so the file still follows its theme.
 */
export function themeLook(chart: Chart, theme: Record<string, string>): void {
  const accents = [1, 2, 3, 4, 5, 6].map((i) => theme[`accent${i}`]).filter((c): c is string => !!c && /^[0-9a-f]{6}$/i.test(c));
  if (accents.length === 6) chart.themePalette = accents.map((c) => `#${c.toLowerCase()}`);
  // (an automatic series of the first six: the accent Office gives it, saved as that accent; not a pie's, whose slices take them)
  if (chart.themePalette && chart.kind !== 'pie') chart.series.forEach((s, i) => { if (!s.color && !s.scheme && i < 6) s.scheme = `<a:schemeClr val="accent${i + 1}"/>`; });
  for (const s of chart.series) {
    if (s.color || !s.scheme) continue;
    const name = /^<a:schemeClr val="([^"]+)"/.exec(s.scheme)?.[1];
    const hex = name ? theme[CHART_CLR_MAP[name] ?? name] : undefined;
    if (!hex) continue;
    // (its changes, as written: <a:lumMod val="75000"/>…)
    const mods = [...s.scheme.slice(s.scheme.indexOf('>') + 1).matchAll(/<a:(\w+)(?: val="([^"]*)")?\/>/g)]
      .map((m) => ({ localName: m[1], getAttribute: (a: string) => (a === 'val' ? m[2] ?? null : null) }));
    s.themeColor = applyColorMods(hex, mods).toLowerCase();
  }
}

/**
 * A chart kept as saved here, read back into a file whose theme may have changed (or copied into
 * another): its theme colours worked out again from `theme`, if it had any (a chart made here,
 * in its own palette, is left as it is).
 */
export function rethemed(chart: Chart, theme: Record<string, string> | null | undefined): void {
  if (!chart.themePalette && !chart.series.some((s) => s.themeColor)) return;
  delete chart.themePalette;
  for (const s of chart.series) delete s.themeColor;
  if (theme) themeLook(chart, theme);
}

/** A Word or PowerPoint file's theme colours (accent1…, dk1…, hex without #), from the theme part `from` relates to; null without one. */
export function themeColorsOf(pkg: PackageReader, from: string): Record<string, string> | null {
  const path = pkg.relOfType(from, REL.theme);
  const doc = path ? pkg.xml(path) : null;
  const scheme = doc ? Array.from(doc.getElementsByTagNameNS(NS.a, 'clrScheme'))[0] : undefined;
  if (!scheme) return null;
  const out: Record<string, string> = {};
  for (const c of kids(scheme)) {
    const v = kids(c)[0];
    if (!v) continue;
    const hex = v.localName === 'sysClr' ? v.getAttribute('lastClr') : v.localName === 'srgbClr' ? v.getAttribute('val') : null;
    if (hex && /^[0-9a-f]{6}$/i.test(hex)) out[c.localName] = hex;
  }
  return out;
}
