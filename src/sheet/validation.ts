// Data validation, as in Excel (Data > Data Validation): a rule on some cells saying what may be
// typed in them (a number within limits, a date, a length of text, one of a list, or anything a
// formula allows), with a message shown when one of the cells is selected and an alert when
// something else is typed. A list rule gives the cells a drop-down to pick from.
//
// The rule is kept as Excel's dialog shows it: the limits as typed ("10", "=B1", "2026-01-31"),
// and a list as its items ("Pd(OAc)2,PdCl2") or a reference to cells holding them ("=$H$2:$H$9").

import type { Sheet } from './workbook';
import { Range, inRange, parseRange, rangeName } from './refs';
import { Value, isError, readTyped, toText } from './values';
import type { Arg } from './args';
import { formatValue } from './numfmt';

export type ValidationKind = 'any' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'length' | 'custom';
export type ValidationOp = 'between' | 'notBetween' | 'equal' | 'notEqual' | 'greaterThan' | 'lessThan' | 'greaterThanOrEqual' | 'lessThanOrEqual';
export type AlertStyle = 'stop' | 'warning' | 'information';

export interface Validation {
  id: number;
  /** The cells the rule is on. Formulas in it are written for the first cell of the first range. */
  ranges: Range[];
  kind: ValidationKind;
  /** How the value compares with the limits (between, when unset). */
  op?: ValidationOp;
  /** The first limit, the list, or the formula, as typed in the dialog. */
  value1?: string;
  /** The second limit (between and not between). */
  value2?: string;
  /** Empty cells pass (Excel's "Ignore blank", on unless turned off). */
  noBlank?: boolean;
  /** A list rule without the drop-down in its cells. */
  noDropDown?: boolean;
  /** The message shown beside a selected cell. */
  promptTitle?: string;
  prompt?: string;
  /** Keep the message without showing it (Excel's "Show input message" turned off). */
  hidePrompt?: boolean;
  /** The alert when something else is typed. */
  alertStyle?: AlertStyle;
  alertTitle?: string;
  alert?: string;
  /** Let anything be typed without an alert (the rule still circles what breaks it). */
  noAlert?: boolean;
}

let nextId = 1;
export function newValidation(ranges: Range[], rule: Omit<Validation, 'id' | 'ranges'>): Validation {
  return { id: nextId++, ranges: ranges.map((r) => ({ ...r })), ...rule };
}
/** Ids read from a file are kept, so new rules don't reuse them. */
export function seenValidationId(id: number): void {
  if (id >= nextId) nextId = id + 1;
}

/** The rule on a cell (the first, if rules overlap, as Excel keeps only one per cell). */
export function validationAt(list: Validation[], row: number, col: number): Validation | undefined {
  return list.find((v) => v.ranges.some((r) => inRange(r, row, col)));
}

export const KIND_NAMES: Record<ValidationKind, string> = {
  any: 'Any value', whole: 'Whole number', decimal: 'Decimal', list: 'List', date: 'Date', time: 'Time', length: 'Text length', custom: 'Custom',
};

export const OP_NAMES: Record<ValidationOp, string> = {
  between: 'between', notBetween: 'not between', equal: 'equal to', notEqual: 'not equal to',
  greaterThan: 'greater than', lessThan: 'less than', greaterThanOrEqual: 'greater than or equal to', lessThanOrEqual: 'less than or equal to',
};

/** Does the rule compare with two limits? */
export const twoLimits = (v: Pick<Validation, 'op'>): boolean => (v.op ?? 'between') === 'between' || v.op === 'notBetween';

// ---------------------------------------------------------------- dates and times typed as limits

/** 2026-01-31, 1/31/2026 or 31 Jan 2026 as Excel's day number; null when it isn't a date. */
export function readDate(text: string): number | null {
  const s = text.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (hit) [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else if ((hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [m, d, y] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  else {
    const t = Date.parse(s + ' UTC');
    if (!/[a-z]/i.test(s) || isNaN(t)) return null;
    const dt = new Date(t);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  // a day the month doesn't have (2/31/2026) is not a date, rather than rolling into the next month
  const dt = new Date(t);
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return (t - Date.UTC(1899, 11, 30)) / 86400000;
}

/** 13:30 or 1:30 PM as a fraction of a day; null when it isn't a time. */
export function readTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[4]) h = (h % 12) + (/pm/i.test(m[4]) ? 12 : 0);
  if (h > 23 || Number(m[2]) > 59) return null;
  return (h * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
}

/** A limit as a number, as typed for a rule of this kind (null when it doesn't read). */
export function limitNumber(kind: ValidationKind, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (kind === 'date') { const d = readDate(t); if (d !== null) return d; }
  if (kind === 'time') { const d = readTime(t); if (d !== null) return d; }
  const v = readTyped(t).value;
  return typeof v === 'number' ? v : null;
}

/** A number from a file shown as the dialog would have it typed (a date as 2026-01-31). */
export function limitText(kind: ValidationKind, n: number): string {
  if (kind === 'date' && Number.isInteger(n)) return formatValue(n, 'yyyy-mm-dd').text;
  if (kind === 'time' && n >= 0 && n < 1) return formatValue(n, 'hh:mm').text;
  return String(n);
}

// ---------------------------------------------------------------- checking a value

/** What the rule needs from the workbook: a formula worked out for a cell, and a sheet by name. */
export interface ValidationHost {
  formulaAt(formula: string, home: { row: number; col: number }, row: number, col: number): Value;
  sheetNamed(name: string): Sheet | undefined;
  /** A list's source that isn't a plain reference (a defined name, =OFFSET(…)) worked out with its block kept whole. */
  formulaArg?(formula: string, home: { row: number; col: number }): Arg;
}

const homeOf = (v: Validation) => ({ row: v.ranges[0]?.r1 ?? 0, col: v.ranges[0]?.c1 ?? 0 });

/**
 * A limit worked out for a cell (a formula moves with the cell, as in a copied formula). A
 * formula that reads an empty cell counts it as 0, as a formula does, rather than turning every
 * value away while the cell is empty.
 */
function limit(v: Validation, text: string | undefined, host: ValidationHost, row: number, col: number): number | null {
  if (text === undefined) return null;
  if (text.trim().startsWith('=')) {
    const got = host.formulaAt(text.trim(), homeOf(v), row, col);
    if (got === null || got === '') return 0;
    return typeof got === 'number' ? got : typeof got === 'boolean' ? Number(got) : null;
  }
  return limitNumber(v.kind, text);
}

/** Does x pass a rule's limits? */
function withinLimits(v: Validation, op: ValidationOp, x: number, host: ValidationHost, row: number, col: number): boolean {
  return compare(op, x, limit(v, v.value1, host, row, col), twoLimits(v) ? limit(v, v.value2, host, row, col) : null);
}

function compare(op: ValidationOp, x: number, a: number | null, b: number | null): boolean {
  if (a === null) return false;
  switch (op) {
    case 'between': return b !== null && x >= Math.min(a, b) && x <= Math.max(a, b);
    case 'notBetween': return b !== null && (x < Math.min(a, b) || x > Math.max(a, b));
    case 'equal': return x === a;
    case 'notEqual': return x !== a;
    case 'greaterThan': return x > a;
    case 'lessThan': return x < a;
    case 'greaterThanOrEqual': return x >= a;
    default: return x <= a;
  }
}

/** A sheet-qualified reference ("Sheet2!$A$1:$A$5" or "'Reagent list'!A:A"), split. */
function splitRef(text: string): { sheet?: string; range: Range } | null {
  const t = text.trim().replace(/^=/, '');
  const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(t);
  const sheet = m ? (m[1] ?? m[2]).replace(/''/g, "'") : undefined;
  const ref = m ? m[3] : t;
  // whole columns ($H:$H) reach to the end of what's in use
  const col = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref);
  const range = col ? parseRange(`${col[1]}1:${col[2]}1048576`) : parseRange(ref);
  return range ? { sheet, range } : null;
}

/** The items of a list rule, as the drop-down shows them (cells' items as they show). */
export function listItems(v: Validation, sheet: Sheet, host: ValidationHost): string[] {
  return readList(v, sheet, host) ?? [];
}

/**
 * The items of a list rule, or null when its source can't be worked out here (a formula this
 * program can't follow): such a rule lets values through rather than turning every one away.
 */
function readList(v: Validation, sheet: Sheet, host: ValidationHost): string[] | null {
  const src = (v.value1 ?? '').trim();
  if (!src) return [];
  if (!src.startsWith('=')) return src.split(',').map((x) => x.trim()).filter((x) => x !== '');
  const ref = splitRef(src);
  if (!ref) return formulaList(src, v, sheet, host);
  const s = ref.sheet ? host.sheetNamed(ref.sheet) : sheet;
  if (!s) return [];
  const out: string[] = [];
  const R = ref.range;
  for (let r = R.r1; r <= Math.min(R.r2, s.lastRow); r++) {
    for (let c = R.c1; c <= Math.min(R.c2, s.lastCol); c++) {
      const t = s.shownText(r, c);
      if (t !== '') out.push(t);
    }
  }
  return out;
}

/** A list whose source is a defined name (=Catalysts, the usual way in Excel) or a formula (=OFFSET(…)): the cells it names, as they show. */
function formulaList(src: string, v: Validation, sheet: Sheet, host: ValidationHost): string[] | null {
  if (!host.formulaArg) return null;
  const got = host.formulaArg(src, homeOf(v));
  if (got !== null && typeof got === 'object' && 'block' in got) {
    const s = got.sheet ? host.sheetNamed(got.sheet) : sheet;
    const out: string[] = [];
    for (let i = 0; i < got.h; i++) {
      for (let j = 0; j < got.w; j++) {
        const t = got.at && s ? s.shownText(got.at.r + i, got.at.c + j) : plainText(got.block[i]?.[j] ?? null);
        if (t !== '') out.push(t);
      }
    }
    return out;
  }
  if (isError(got)) return null;
  const t = plainText(got);
  return t === '' ? [] : [t];
}

/** A value's own text, without its cell's number format (5, not 5.00). */
function plainText(v: Value): string {
  const t = toText(v);
  return typeof t === 'string' ? t : '';
}

/** Is a value one of a list's items? Capitals don't matter; a number matches an item that reads as the same number. */
function inList(items: readonly string[], value: Value, shown: string): boolean {
  const want = shown.trim().toLowerCase(), own = plainText(value).trim().toLowerCase();
  return items.some((x) => {
    const item = x.trim().toLowerCase();
    if (item === want || item === own) return true;
    if (typeof value !== 'number') return false;
    const n = readTyped(x.trim()).value;
    return typeof n === 'number' && n === value;
  });
}

/**
 * Does a cell's value pass the rule? (`shown` is the value as the cell shows it.) `lists` keeps
 * each list rule's items while many cells are checked at once.
 */
export function passes(v: Validation, value: Value, shown: string, sheet: Sheet, host: ValidationHost, row: number, col: number, lists?: Map<Validation, string[] | null>): boolean {
  if (v.kind === 'any') return true;
  if (value === null || value === '') return !v.noBlank;
  if (isError(value)) return false;
  const op = v.op ?? 'between';
  switch (v.kind) {
    case 'whole':
      return typeof value === 'number' && Number.isInteger(value) && withinLimits(v, op, value, host, row, col);
    case 'decimal': case 'date':
      return typeof value === 'number' && withinLimits(v, op, value, host, row, col);
    case 'time':
      // a time compares by its time of day
      return typeof value === 'number' && withinLimits(v, op, value - Math.floor(value), host, row, col);
    case 'length':
      // the length of the value itself, not of how its number format shows it ($1,234.50 is 1234.5)
      return withinLimits(v, op, plainText(value).length, host, row, col);
    case 'list': {
      // Excel matches list items without minding capitals
      let items = lists?.get(v);
      if (items === undefined) { items = readList(v, sheet, host); lists?.set(v, items); }
      return items === null || inList(items, value, shown);
    }
    case 'custom': {
      if (!v.value1?.trim()) return true;
      const got = host.formulaAt(v.value1.trim().startsWith('=') ? v.value1.trim() : '=' + v.value1.trim(), homeOf(v), row, col);
      return got === true || (typeof got === 'number' && got !== 0);
    }
    // a kind from a newer version of the program: let the value through
    default:
      return true;
  }
}

/** "a whole number between 1 and 10", for alerts and the panel. */
export function describeValidation(v: Validation): string {
  const op = v.op ?? 'between';
  const lim = twoLimits(v) ? `${OP_NAMES[op]} ${v.value1 ?? ''} and ${v.value2 ?? ''}` : `${OP_NAMES[op]} ${v.value1 ?? ''}`;
  switch (v.kind) {
    case 'any': return 'any value';
    case 'whole': return `a whole number ${lim}`;
    case 'decimal': return `a number ${lim}`;
    case 'date': return `a date ${lim}`;
    case 'time': return `a time ${lim}`;
    case 'length': return `text with a length ${lim}`;
    case 'list': {
      const src = (v.value1 ?? '').trim();
      return src.startsWith('=') ? `one of the items in ${src.slice(1)}` : `one of: ${src.split(',').map((x) => x.trim()).filter(Boolean).join(', ')}`;
    }
    case 'custom': return `a value for which ${v.value1 ?? ''} is TRUE`;
  }
}

/** The rule's ranges as text ("B2:B20, D2"). */
export const validationRangesText = (v: Validation): string => v.ranges.map(rangeName).join(', ');

/** Every cell in use that breaks a rule (for Circle Invalid Data). */
export function invalidCells(sheet: Sheet, host: ValidationHost): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  // each list rule's items read once for every cell it covers, not again for each cell
  const lists = new Map<Validation, string[] | null>();
  for (const v of sheet.validations) {
    if (v.kind === 'any') continue;
    for (const R of v.ranges) {
      for (let r = R.r1; r <= Math.min(R.r2, sheet.lastRow); r++) {
        for (let c = R.c1; c <= Math.min(R.c2, sheet.lastCol); c++) {
          if (validationAt(sheet.validations, r, c) !== v) continue;
          const val = sheet.value(r, c);
          // empty cells aren't circled, even where blanks aren't allowed (as in Excel)
          if (val === null || val === '') continue;
          if (!passes(v, val, sheet.shownText(r, c), sheet, host, r, c, lists)) out.push({ row: r, col: c });
        }
      }
    }
  }
  return out;
}
