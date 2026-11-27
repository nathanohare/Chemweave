// Tables on the clipboard: cells copied from Excel, Word, a web page or a sheet here (as an
// HTML table or as tab-separated text) become a table when pasted on a drawing or slide; and a
// table copied from a drawing goes out the same two ways, so Excel and Word get its cells.

import type { TableData, TextRun } from '../model';
import { htmlToRich, runsHtml } from '../text/html';
import { splitParagraphs } from '../text/paragraphs';
import { parseDelimited, toDelimited } from '../sheet/csv';

/** A pasted cell: its text (with bold, italic, subscripts and so on) and how many columns it spans. */
export interface PastedCell { runs: TextRun[]; span?: number }

/** Rows of pasted cells. */
export type PastedRows = PastedCell[][];

/** The cells of the first table in some HTML, or null when there is none. */
export function parseHtmlTable(html: string): PastedRows | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const table = dom.querySelector('table');
  if (!table) return null;
  const rows: PastedRows = [];
  // cells a cell above reaches down into (rowspan), by row and column
  const below = new Map<string, true>();
  for (const tr of table.querySelectorAll('tr')) {
    if (tr.closest('table') !== table) continue;
    // (counted among this table's own rows only, not a table's inside a cell; review F603)
    const r = rows.length;
    const row: PastedCell[] = [];
    let c = 0;
    for (const td of [...tr.children].filter((el) => el.tagName === 'TD' || el.tagName === 'TH')) {
      while (below.has(`${r},${c}`)) { row.push({ runs: [] }); c++; }
      const span = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      const down = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      // line breaks inside a cell stay; the text is read with its styles
      const rich = htmlToRich(td.innerHTML) ?? { runs: [] };
      const runs = plainRuns(rich.runs);
      row.push(span > 1 ? { runs, span } : { runs });
      for (let k = 1; k < span; k++) row.push({ runs: [] });
      for (let d = 1; d < down; d++) for (let k = 0; k < span; k++) below.set(`${r + d},${c + k}`, true);
      c += span;
    }
    rows.push(row);
  }
  // Excel ends some rows early; rows of nothing at the end are dropped
  while (rows.length && rows[rows.length - 1].every((x) => !x.runs.some((t) => t.text.trim()))) rows.pop();
  return rows.length ? rows : null;
}

/** Tab-separated text (as Excel copies cells) as rows of cells, or null for text without tabs. */
export function parseTextTable(text: string): PastedRows | null {
  if (!text.includes('\t')) return null;
  const rows = parseDelimited(text.replace(/\r?\n$/, ''), '\t');
  if (!rows.length) return null;
  return rows.map((r) => r.map((t) => ({ runs: t ? [{ text: t }] : [] })));
}

/** Runs as a table cell keeps them: their bold, italic, sub- and superscripts and colour, but the table's own size and font. */
function plainRuns(runs: TextRun[]): TextRun[] {
  return runs.filter((r) => r.text).map((r) => {
    const { size: _s, font: _f, ...rest } = r;
    return rest;
  });
}

/**
 * A table as HTML, for Word and Excel: its title above, the cells, and its footnotes below. Runs
 * go through the same writer as other copied text (text/html.ts runsHtml: every look, and formula
 * runs with their digits lowered and charges raised); cells keep their fill, merges across and down,
 * alignment (each paragraph's own) and the table's text size.
 */
export function tableHtml(t: TableData): string {
  const rule = '0.75pt solid #000';
  const look = { font: null, defaultSize: t.size ?? null };
  const out: string[] = [];
  if (t.title?.length) out.push(`<p>${runsHtml(t.title, look)}</p>`);
  out.push('<table border="0" cellspacing="0" cellpadding="4" style="border-collapse:collapse">');
  // cells a cell above is merged down over, by row and column
  const below = new Set<string>();
  t.rows.forEach((row, r) => {
    const tds: string[] = [];
    let skip = 0;
    row.forEach((cell, c) => {
      if (skip > 0) { skip--; return; }
      const span = Math.max(1, Math.min(cell.span ?? 1, t.cols.length - c));
      skip = span - 1;
      if (below.has(`${r},${c}`)) return;
      const down = Math.max(1, Math.min(cell.rowSpan ?? 1, t.rows.length - r));
      for (let d = 1; d < down; d++) for (let k = 0; k < span; k++) below.add(`${r + d},${c + k}`);
      const align = cell.align ?? t.align?.[c] ?? (c === 0 ? 'left' : 'center');
      const css: string[] = [`text-align:${align}`];
      if (t.lines === 'grid') css.push(`border:${rule}`);
      else if (t.lines === 'acs') {
        if (r === 0) css.push(`border-top:${rule}`);
        if (r + down - 1 === t.head - 1 || r + down - 1 === t.rows.length - 1) css.push(`border-bottom:${rule}`);
      }
      if (cell.fill) css.push(`background:${cell.fill}`);
      if (cell.valign) css.push(`vertical-align:${cell.valign === 'center' ? 'middle' : 'bottom'}`);
      if (t.size) css.push(`font-size:${t.size}pt`);
      // a cell of several paragraphs: one <p> each, with its own alignment
      const paras = splitParagraphs(cell.runs.filter((x) => x.obj === undefined));
      const body = paras.length > 1
        ? paras.map((runs, i) => {
          const a = cell.paras?.[i]?.align;
          return `<p style="margin:0${a && a !== align ? `;text-align:${a}` : ''}">${runsHtml(runs, look) || '&nbsp;'}</p>`;
        }).join('')
        : runsHtml(paras[0] ?? [], look);
      const tag = r < t.head ? 'th' : 'td';
      tds.push(`<${tag}${span > 1 ? ` colspan="${span}"` : ''}${down > 1 ? ` rowspan="${down}"` : ''} style="${css.join(';')};font-weight:normal">${body}</${tag}>`);
    });
    out.push(`<tr>${tds.join('')}</tr>`);
  });
  out.push('</table>');
  if (t.notes?.length) out.push(`<p style="font-size:smaller">${runsHtml(t.notes, look)}</p>`);
  return out.join('');
}

/** A table as tab-separated text, as Excel copies cells (a cell with a line break is quoted). */
export function tableTsv(t: TableData): string {
  return toDelimited(t.rows.map((row) => row.map((c) => c.runs.map((r) => r.text).join(''))), '\t');
}

/** A table from what's on the clipboard: an HTML table if there is one, else tab-separated text; null for a single cell or none. */
export function pastedTable(html: string | null | undefined, text: string | null | undefined): PastedRows | null {
  const rows = (html ? parseHtmlTable(html) : null) ?? (text ? parseTextTable(text) : null);
  if (!rows) return null;
  const cells = rows.reduce((n, r) => n + r.length, 0);
  return cells >= 2 ? rows : null;
}
