/**
 * Excel samplers: number formats (X-NUM) in a workbook counting dates from 1900, and dates in one
 * counting from 1904 (X-D04, its own file). One row per item: the id in column A, a value in
 * column B formatted with the item's number format. ECMA-376 Part 1 §18.8.30 numFmt (the built-in
 * ids), §18.8.31 numFmts, §18.17.4.1 (1900 and 1904 date systems); Excel's Format Cells ▸ Number.
 *
 * Tags from src/io/xlsx.ts: BUILTIN_FORMATS (:166) are the built-in ids read and written back as
 * themselves; other built-in ids aren't known (shown as General, written as 0); codes of the file's
 * own are kept (renumbered from 164, Styles.numFmt :346); a code of the file's own that is a
 * built-in's stays its own (readStyles :1428); date1904 shifts dates on reading and back on writing
 * (writeBook :797, readXlsx :1823).
 */
import { type Item, type Sampler, itemList, kid } from './kit';
import { Book, lookAt, cellOf, wbRoot, BUILTIN_NUMFMT, sameCode, type CellOpts, type Look } from './xlsx';

// ---------------------------------------------------------------------------------------------
// 1900 workbook

const items: Item[] = [];
const it = itemList('X-NUM', items);
const book = new Book();
const sh = book.sheet('Number formats');
sh.set('cols', '<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/></cols>');

const vOf = (c: Element | undefined) => kid(c, 'x:v')?.textContent ?? null;
type Tag = 'supported' | 'kept' | 'loss';

/** One item: a cell holding `value` in a format of `numFmtId` or `code`, checked on its look and value. */
function add(feature: string, tag: Tag, spec: string, f: { numFmtId?: number; code?: string }, value: number | CellOpts, check: (l: Look, v: string | null) => boolean, basis?: string): string {
  const id = it(feature, tag, spec, (v) => check(lookAt(v, id), vOf(cellOf(v, id))), basis);
  const s = book.styles.xf(f);
  sh.item(id, feature, typeof value === 'number' ? { v: value } : value, s);
  return id;
}

const SAMPLE = 1234.5678;
const DATE = 45678.75; // 2025-01-22 18:00
const sampleFor = (n: number) => ((n >= 14 && n <= 22) || (n >= 45 && n <= 47) ? DATE : SAMPLE);

// every built-in id the specification lists (§18.8.30), with no numFmt of the file's own
const KNOWN = new Set([0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 37, 38, 39, 40, 45, 46, 47, 48, 49]);
for (const n of Object.keys(BUILTIN_NUMFMT).map(Number)) {
  const code = BUILTIN_NUMFMT[n];
  const value = n === 49 ? { t: 's' as const, v: book.sst.s('text 0042') } : sampleFor(n);
  add(`Built-in format ${n} (${code})`, KNOWN.has(n) ? 'supported' : 'loss', '§18.8.30 numFmt (built-in ids); Format Cells ▸ Number',
    { numFmtId: n }, value, (l) => l.numFmtId === n, 'xlsx.ts:166 BUILTIN_FORMATS');
}
// built-in ids Excel uses that the specification doesn't list: currency (5-8), accounting (41-44), East Asian dates (27-36, 50-58)
for (const [n, what] of [[5, 'currency'], [6, 'currency red negatives'], [7, 'currency with decimals'], [8, 'currency decimals red'],
  [41, 'accounting no symbol'], [42, 'accounting'], [43, 'accounting decimals no symbol'],
  [27, 'East Asian date'], [30, 'East Asian date'], [36, 'East Asian date'], [50, 'East Asian date'], [57, 'East Asian date']] as [number, string][]) {
  add(`Built-in format ${n} (${what}, implied by Excel's locale)`, 'loss', '§18.8.30 numFmt (ids reserved, locale dependent); Format Cells ▸ Number ▸ Currency/Accounting/Date',
    { numFmtId: n }, n >= 27 && n <= 58 && n !== 41 && n !== 42 && n !== 43 && n !== 44 ? DATE : SAMPLE, (l) => l.numFmtId === n, 'xlsx.ts:166 (id not in BUILTIN_FORMATS: shown and written as General)');
}

// codes of the file's own (Format Cells ▸ Number ▸ Custom)
const CUSTOM: [string, string, number | CellOpts][] = [
  ['Three decimals', '0.000', SAMPLE],
  ['Thousands separator with minus section', '#,##0;-#,##0', SAMPLE],
  ['Literal unit text', '#,##0.00 "kg"', SAMPLE],
  ['Percent one decimal', '0.0%', 0.4567],
  ['Color section [Red]', '[Red]0.00', SAMPLE],
  ['Four sections with colors', '[Blue]#,##0.00;[Red]-#,##0.00;[Green]0;[Magenta]@', -SAMPLE],
  ['Indexed color [Color10]', '[Color10]0.00', SAMPLE],
  ['Condition [>=1000] thousands', '[>=1000]#,##0,"K";0', 123456],
  ['Conditions on both sections', '[<0]"negative";[>0]"positive";"zero"', -3],
  ['Fraction in eighths', '# ?/8', 3.375],
  ['Fraction up to three digits', '# ???/???', 3.14159],
  ['Scientific three decimals', '0.000E+00', 0.000123456],
  ['Engineering notation', '##0.00E+0', 123456789],
  ['Text section only', '@" (text)"', { t: 's', v: 'sampled' } as CellOpts],
  ['Elapsed minutes', '[mm]:ss', 0.0625],
  ['Elapsed seconds with hundredths', '[ss].00', 0.00123],
  ['Elapsed hours past a day', '[h]:mm', 1.75],
  ['ISO date', 'yyyy-mm-dd', DATE],
  ['Long date with weekday', 'dddd, mmmm d, yyyy', DATE],
  ['Date and time with milliseconds', 'yyyy-mm-dd hh:mm:ss.000', 45678.123456],
  ['Time with A/P', 'h:mm A/P', 0.75],
  ['Locale date [$-409]', '[$-409]mmmm d, yyyy;@', DATE],
  ['System long date [$-F800]', '[$-F800]dddd, mmmm dd, yyyy', DATE],
  ['Currency symbol with locale [$€-1809]', '[$€-1809]#,##0.00', SAMPLE],
  ['Accounting with fill and padding', '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)', SAMPLE],
  ['Leading zeros (zip code)', '00000', 2134],
  ['Phone number pattern', '[<=9999999]###-####;(###) ###-####', 5551234567],
  ['Scaled to millions', '0.0,,"M"', 123456789],
  ['Escaped dollar sign', '\\$0.00', 12.5],
  ['Hidden (;;;)', ';;;', 42],
  ['General with red negatives', 'General;[Red]-General', -7.25],
  ['Chinese numerals [DBNum1]', '[DBNum1][$-804]General', 1234],
  ['Repeat fill character', '0.00* ', 9.5],
  ['Question-mark alignment', '??0.0??', 3.5],
];
for (const [what, code, value] of CUSTOM) {
  add(`Custom format: ${what}`, 'supported', '§18.8.30 numFmt@formatCode, §18.8.31 numFmts; Format Cells ▸ Number ▸ Custom',
    { code }, typeof value === 'number' ? value : { ...value, v: value.t === 's' ? book.sst.s(String(value.v)) : value.v }, (l) => sameCode(l.code, code), 'xlsx.ts:346 Styles.numFmt (renumbered from 164)');
}
const ACCOUNTING = '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)';
book.styles.numFmt(ACCOUNTING, 44);
add('Accounting format id 44 defined in the file', 'supported', '§18.8.30 numFmt (id 44 with its code, as Excel writes it)', { numFmtId: 44 },
  SAMPLE, (l) => sameCode(l.code, ACCOUNTING), 'xlsx.ts:1428 (code kept, renumbered)');

// dates and times in the 1900 date system: the value is the serial number
const DATES: [string, string, number | CellOpts, Tag][] = [
  ['Date serial 1 (1900-01-01)', 'yyyy-mm-dd', 1, 'supported'],
  ['Date serial 60 (1900-02-29, Lotus leap year)', 'yyyy-mm-dd', 60, 'supported'],
  ['Date serial 61 (1900-03-01)', 'yyyy-mm-dd', 61, 'supported'],
  ['Date and time', 'yyyy-mm-dd hh:mm', DATE, 'supported'],
  ['Time only (noon)', 'hh:mm:ss', 0.5, 'supported'],
  ['Date 9999-12-31 (the last)', 'yyyy-mm-dd', 2958465, 'supported'],
];
for (const [what, code, value, tag] of DATES) {
  const want = typeof value === 'number' ? String(value) : String(value.v);
  add(what, tag, typeof value === 'number' ? '§18.17.4.1 date system 1900; §18.3.1.96 v' : '§18.17.6.6 ST_CellType d; §18.17.4 dates',
    { code }, value, (l, v) => sameCode(l.code, code) && v === want, typeof value === 'number' ? 'xlsx.ts:797 (value written as read)' : 'xlsx.ts:1769 (t="d" read as a number)');
}
const id1900 = it('Workbook uses the 1900 date system (no date1904)', 'supported', '§18.2.28 workbookPr@date1904',
  (v) => { const p = kid(wbRoot(v), 'x:workbookPr'); const d = p?.getAttribute('date1904'); return !d || d === '0' || d === 'false'; });
sh.item(id1900, 'Workbook uses the 1900 date system (no date1904)');

let bytes: Uint8Array | undefined;
export const xlsxNumbers: Sampler = {
  name: 'xlsx-numbers.xlsx', area: 'Excel number formats and dates (1900 date system)', items,
  build: () => (bytes ??= book.build('Excel sampler: number formats')),
};

// ---------------------------------------------------------------------------------------------
// 1904 workbook

const items04: Item[] = [];
const it04 = itemList('X-D04', items04);
const book04 = new Book();
book04.wb.workbookPr = '<workbookPr date1904="1" defaultThemeVersion="166925"/>';
const sh04 = book04.sheet('Dates 1904');
const flag = it04('Workbook uses the 1904 date system', 'supported', '§18.2.28 workbookPr@date1904; File ▸ Options ▸ Advanced ▸ Use 1904 date system',
  (v) => { const d = kid(wbRoot(v), 'x:workbookPr')?.getAttribute('date1904'); return d === '1' || d === 'true'; }, 'xlsx.ts:1547, :1135');
sh04.item(flag, 'Workbook uses the 1904 date system');
const DATES04: [string, string, number, Tag][] = [
  ['Date serial 0 (1904-01-01)', 'yyyy-mm-dd', 0, 'supported'],
  ['Date serial 1 (1904-01-02)', 'yyyy-mm-dd', 1, 'supported'],
  ['Date and time', 'yyyy-mm-dd hh:mm', DATE - 1462, 'supported'],
  ['Long date', 'dddd, mmmm d, yyyy', 40000, 'supported'],
  ['Time only (6 pm)', 'h:mm', 0.75, 'supported'],
  ['Elapsed time over a day', '[h]:mm:ss', 2.5, 'supported'],
  ['Plain number (not a date)', '0.00', 1462, 'supported'],
  ['Built-in short date (id 14)', '', 30000, 'supported'],
];
for (const [what, code, value, tag] of DATES04) {
  const id = it04(what, tag, '§18.17.4.1 date system 1904; §18.3.1.96 v', (v) => {
    const c = cellOf(v, id);
    const l = lookAt(v, id);
    return vOf(c) === String(value) && (code ? sameCode(l.code, code) : l.numFmtId === 14);
  }, 'xlsx.ts:797 writeBook (dates shifted back by 1462)');
  sh04.item(id, what, { v: value }, book04.styles.xf(code ? { code } : { numFmtId: 14 }));
}

let bytes04: Uint8Array | undefined;
export const xlsxDates1904: Sampler = {
  name: 'xlsx-dates1904.xlsx', area: 'Excel dates in the 1904 date system', items: items04,
  build: () => (bytes04 ??= book04.build('Excel sampler: 1904 dates')),
};

// a code of the file's own equal to a built-in one, here where no cell uses the built-in id (a
// file's own code stands for every cell with that code: it would turn built-in 2 into it)
const own = it04('Custom code equal to a built-in one (0.00 as id 164)', 'supported', '§18.8.31 numFmts (a file\'s own code that is also a built-in)', (v) => {
  const l = lookAt(v, own);
  return sameCode(l.code, '0.00') && l.numFmtId >= 164;
}, 'xlsx.ts:1428 readStyles kept.numFmts (ownCodes)');
sh04.item(own, 'Custom code equal to a built-in one (0.00 as id 164)', { v: 1234.5678 }, book04.styles.xf({ code: '0.00' }));
