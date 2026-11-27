// Home > Sort, as in Word: the paragraphs picked (or a table's rows) put in order by their text,
// by the first number in them, or by a date, up or down, with up to three keys (Sort by, Then
// by…). Paragraphs can be cut into fields at tabs or commas to sort by one of them; a table
// sorts by a column. A heading row stays at the top. The sort is stable, so rows that tie keep
// their order.

import type { ParaStyle, TableData, TextRun } from '../model';
import * as rt from '../richtext';
import { rowHeights } from '../table';
import { fitParas, paraCount } from '../text/paragraphs';
import { OBJECT_CHAR, type DocText } from './document';

export type SortType = 'text' | 'number' | 'date';

export interface SortKey {
  /** Which field (paragraphs cut at `sep`) or column (tables), from 0; the whole paragraph when left out. */
  field?: number;
  type: SortType;
  descending?: boolean;
}

export interface SortOptions {
  keys: SortKey[];
  /** The first row (or paragraph) is a heading and stays where it is. For a table, saying it isn't (false) sorts the table's heading rows too; left out, the table's own heading rows stay. */
  header?: boolean;
  /** What cuts a paragraph into fields (Word's Options > Separate fields at). */
  sep?: '\t' | ',' | string;
  /** Capitals before small letters when the letters are the same (Word's Case sensitive). */
  caseSensitive?: boolean;
}

/** The first number in some text (with its sign and decimals; thousands commas skipped), or null. */
export function firstNumber(s: string): number | null {
  const m = /[-−+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?|[-−+]?\.\d+/.exec(s);
  if (!m) return null;
  const v = Number(m[0].replace(/,/g, '').replace('−', '-'));
  return Number.isFinite(v) ? v : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A month's number (0 to 11) from its name or its first three letters (Sept too), or -1. */
function monthOf(name: string): number {
  const m = name.toLowerCase();
  const i = MONTHS.indexOf(m.slice(0, 3));
  if (i < 0) return -1;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return m.length === 3 || full.startsWith(m) || m === 'sept' ? i : -1;
}

/**
 * A date in some text (2026-10-22, 10/22/2026, 22 Oct 2026, October 22, 2026), as a time, or
 * null. Only these forms count (text that only looks a little like a date, "see note 2", is no
 * date), and every one is read as the same day wherever the computer is (UTC).
 */
export function dateValue(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t);
  if (us) { const y = +us[3] < 100 ? 2000 + +us[3] : +us[3]; return Date.UTC(y, +us[1] - 1, +us[2]); }
  // 22 Oct 2026, 22 October 2026, 22-Oct-2026
  const dmy = /\b(\d{1,2})[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})\b/.exec(t);
  if (dmy && monthOf(dmy[2]) >= 0 && +dmy[1] >= 1 && +dmy[1] <= 31) return Date.UTC(+dmy[3], monthOf(dmy[2]), +dmy[1]);
  // October 22, 2026, Oct. 22 2026
  const mdy = /\b([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})\b/.exec(t);
  if (mdy && monthOf(mdy[1]) >= 0 && +mdy[2] >= 1 && +mdy[2] <= 31) return Date.UTC(+mdy[3], monthOf(mdy[1]), +mdy[2]);
  return null;
}

/** A row's (or paragraph's) text for one key: its field, or all of it. */
function keyText(text: string, field: number | undefined, sep: string | undefined): string {
  if (field === undefined || !sep) return text;
  return text.split(sep)[field] ?? '';
}

/** The value a key sorts a text by (a number, a date as a time, or the text), or null for none. */
function keyValue(s: string, type: SortType): number | string | null {
  if (type === 'number') return firstNumber(s);
  if (type === 'date') return dateValue(s);
  const v = s.trim();
  return v ? v : null;
}

/** How texts compare: by their letters (capitals and accents aside), then, case sensitive, capitals before small letters. */
interface Collators { base: Intl.Collator; cased: Intl.Collator }
const collators = (): Collators => ({
  base: new Intl.Collator(undefined, { sensitivity: 'base', numeric: false }),
  cased: new Intl.Collator(undefined, { sensitivity: 'variant', caseFirst: 'upper', numeric: false }),
});

function compareValues(x: number | string | null, y: number | string | null, descending: boolean | undefined, caseSensitive: boolean, c: Collators): number {
  const sign = descending ? -1 : 1;
  if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1) * sign;
  if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
  const d = c.base.compare(String(x), String(y));
  if (d || !caseSensitive) return d * sign;
  // the same letters: capitals first
  return c.cased.compare(String(x), String(y)) * sign;
}

/**
 * Compare two texts as a key says. Empty texts (and, for numbers and dates, those with none) go
 * last going up and first going down, as in Word.
 */
export function compareBy(a: string, b: string, key: SortKey, caseSensitive = false): number {
  return compareValues(keyValue(a, key.type), keyValue(b, key.type), key.descending, caseSensitive, collators());
}

/** The order the rows go in (indexes), by the keys in turn, ties keeping their order. */
export function sortOrder(texts: string[], o: SortOptions): number[] {
  const idx = texts.map((_, i) => i);
  const keys = o.keys.length ? o.keys : [{ type: 'text' as const }];
  // each row's value for each key worked out once, and one way of comparing text for the whole sort
  const values = keys.map((k) => texts.map((x) => keyValue(keyText(x, k.field, o.sep), k.type)));
  const c = collators();
  const cs = !!o.caseSensitive;
  return idx.sort((i, j) => {
    for (let n = 0; n < keys.length; n++) {
      const d = compareValues(values[n][i], values[n][j], keys[n].descending, cs, c);
      if (d) return d;
    }
    return i - j;
  });
}

/** A paragraph's text as sorted on: what it reads (a figure counts for nothing). */
const sortText = (runs: TextRun[]) => rt.plainText(runs).split(OBJECT_CHAR).join('');

/**
 * Paragraphs `first` to `last` of a document put in order, each with its own formatting and
 * paragraph settings. Bookmarks, page breaks and section breaks stay where they were (with the
 * place, not the text), as Word keeps a section's start where it is.
 */
export function sortParagraphs(t: DocText, first: number, last: number, o: SortOptions): DocText {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  // each paragraph's runs and the line break that ends it (the last has none), as they are
  const bodies: TextRun[][] = [[]];
  const breaks: TextRun[] = [];
  for (const r of t.runs) {
    r.text.split('\n').forEach((piece, i) => {
      if (i > 0) { breaks.push({ ...r, text: '\n' }); bodies.push([]); }
      if (piece) bodies[bodies.length - 1].push({ ...r, text: piece });
    });
  }
  const from = Math.max(0, first + (o.header ? 1 : 0)), to = Math.min(n - 1, last);
  if (to <= from) return t;
  const span = Array.from({ length: to - from + 1 }, (_, k) => from + k);
  // empty paragraphs (none to sort on) stay out of the way at the end, as Word drops them to the bottom
  const order = sortOrder(span.map((p) => sortText(bodies[p] ?? [])), o).map((k) => span[k]);
  const kept = (p: ParaStyle): Partial<ParaStyle> => ({ pageBreak: p.pageBreak, colBreak: p.colBreak, section: p.section, marks: p.marks });
  const moved = (p: ParaStyle): ParaStyle => { const { pageBreak: _a, colBreak: _b, section: _c, marks: _d, ...rest } = p; return rest; };
  const newParas = paras.slice();
  const place = Array.from({ length: n }, (_, p) => p);
  order.forEach((src, k) => {
    const at = span[k];
    newParas[at] = { ...moved(paras[src]), ...Object.fromEntries(Object.entries(kept(paras[at])).filter(([, v]) => v !== undefined)) };
    place[at] = src;
  });
  // each paragraph moves with its own line break (its look, and any tracked change on it); only
  // the paragraphs sorted change, and the text outside them stays exactly as it was
  const runs: TextRun[] = [];
  for (let at = 0; at < n; at++) {
    const src = place[at];
    const rs = bodies[src] ?? [];
    runs.push(...rs);
    if (at === n - 1) break;
    if (breaks[src]) { runs.push(breaks[src]); continue; }
    // (the document's last paragraph, moved up, had none: the look of the text before it)
    const look = rs.length ? rt.styleOf(rs[rs.length - 1]) : {};
    const { obj: _o, rev: _r, fmt: _f, cmt: _c, link: _l, ...plain } = look;
    runs.push({ ...plain, text: '\n' });
  }
  return { ...t, runs: rt.normalizeRuns(runs), paras: newParas };
}

/** A table's rows in order by their cells (a key's field is its column); the heading rows stay at the top. */
export function sortTableRows(tb: TableData, o: SortOptions): TableData {
  // (the choice made wins: the table's heading rows stay unless it was said they aren't one)
  const head = o.header === false ? 0 : Math.max(o.header ? 1 : 0, tb.head ?? 0);
  // rows with cells merged down can't be moved apart
  if (tb.rows.some((row) => row.some((c) => (c.rowSpan ?? 1) > 1))) return tb;
  const body = tb.rows.slice(head);
  const texts = body.map((row) => row.map((c) => sortText(c.runs)).join('\u0001'));
  const order = sortOrder(texts, { ...o, sep: '\u0001' });
  // (each row keeps its height)
  return { ...tb, ...(o.header === false && tb.head ? { head: 0 } : {}), rows: [...tb.rows.slice(0, head), ...order.map((i) => body[i])], ...rowHeights(tb, (h) => h.splice(head, h.length - head, ...order.map((i) => h[head + i]))) };
}
