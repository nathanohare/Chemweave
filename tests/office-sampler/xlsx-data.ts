/**
 * Excel sampler: data tools. Tables (X-TBL), filters and sorting (X-FLT) and data validation
 * (X-DV). Tables sit on the Tables sheet, each with its id in its first header cell (or first
 * cell, without a header row); a filter needs a sheet of its own, named by its id; validation
 * rules cover column B of their item's row on the Validation sheet.
 * ECMA-376 Part 1 §18.5 (tables: §18.5.1.2 table, §18.5.1.3 tableColumn, §18.5.1.5
 * tableStyleInfo), §18.3.2 (autoFilter: §18.3.2.2 filterColumn, filters, customFilters, top10,
 * dynamicFilter, colorFilter, iconFilter, dateGroupItem), §18.3.1.92 sortState, §18.3.1.32
 * dataValidation; Excel's Insert ▸ Table, Table Design, Data ▸ Filter / Sort, Data ▸ Data Validation.
 *
 * Tags from src/io/xlsx-format.ts readTable (:279) and tableXml (:108), src/io/xlsx.ts filters
 * (readFilterColumn :2287, filterColumnXml :1172) and src/io/xlsx-notes.ts validations (:255-361).
 */
import { type Item, type Sampler, type View, itemList, kid, esc } from './kit';
import { Book, type SheetB, X_MAIN, rowOf, cellOf, formulaOf, relsOf, xKids, covers, wsOf, wsPart, isOn, definedNames } from './xlsx';

const items: Item[] = [];
const book = new Book();
type Tag = 'supported' | 'kept' | 'loss';
const TABLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table';
const TABLE_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml';

// ---------------------------------------------------------------------------------------------
// Tables (X-TBL)

const tb = book.sheet('Tables');
tb.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/><col min="2" max="4" width="12" customWidth="1"/></cols>');
const tbl = itemList('X-TBL', items);
let tableNo = 0;
const tableParts = new Map<SheetB, string[]>();

/** The table part whose range covers the item's row (on any sheet). */
function tableOf(v: View, id: string): Element | undefined {
  const f = rowOf(v, id);
  if (!f) return undefined;
  for (const r of relsOf(v, f.sheet.path)) {
    if (r.type !== TABLE_REL) continue;
    const t = v.doc(r.target)?.documentElement;
    if (t && covers(t.getAttribute('ref'), `A${f.r + 1}`)) return t;
  }
  return undefined;
}
const info = (t: Element | undefined) => kid(t, 'x:tableStyleInfo');
const tcols = (t: Element | undefined) => xKids(kid(t, 'x:tableColumns'), 'tableColumn');

interface TableOpts {
  style?: string | null; stripes?: string; header?: boolean; totals?: { label?: string; fn?: string; formula?: string };
  calc?: string; autoFilter?: string; sortState?: string; colAttrs?: string[]; sheet?: SheetB;
}
/**
 * A table item: three columns (the id and feature, Amount, Qty) and three data rows from the
 * sheet's next row, with what `o` sets; checked on its table part.
 */
function table(feature: string, tag: Tag, spec: string, o: TableOpts, check: (t: Element | undefined, v: View, id: string) => boolean, basis?: string): string {
  const id = tbl(feature, tag, spec, (v) => check(tableOf(v, id), v, id), basis);
  const n = ++tableNo;
  const name = `Sampler${n}`;
  if (o.calc) o.calc = o.calc.replace('{n}', String(n));
  const header = o.header !== false;
  const ts = o.sheet ?? tb;
  const r0 = ts.next;
  const first = `${id} ${feature}`;
  const names = header ? [first, 'Amount', 'Qty'] : ['Column1', 'Column2', 'Column3'];
  if (header) { ts.text(`A${r0 + 1}`, names[0]); ts.text(`B${r0 + 1}`, 'Amount'); ts.text(`C${r0 + 1}`, 'Qty'); if (o.calc) ts.text(`D${r0 + 1}`, 'Double'); }
  const d0 = header ? r0 + 1 : r0;
  [[10, 3], [25, 1], [5, 7]].forEach(([a, q], k) => {
    ts.text(`A${d0 + k + 1}`, k === 0 && !header ? first : `row ${k + 1}`);
    ts.num(`B${d0 + k + 1}`, a);
    ts.num(`C${d0 + k + 1}`, q);
    if (o.calc) ts.cell(`D${d0 + k + 1}`, { f: `<f>${esc(o.calc)}</f>`, v: a * 2 });
  });
  let last = d0 + 3;
  if (o.totals) {
    ts.text(`A${last + 1}`, o.totals.label ?? 'Total');
    if (o.totals.formula) ts.cell(`B${last + 1}`, { f: `<f>${esc(o.totals.formula)}</f>`, v: 40 });
    last++;
  }
  const lastCol = o.calc ? 'D' : 'C';
  const ref = `A${r0 + 1}:${lastCol}${last}`;
  const cols = [...names, ...(o.calc ? ['Double'] : [])].map((cn, k) => {
    const attrs = (o.colAttrs?.[k] ?? '') + (o.totals && k === 0 ? ` totalsRowLabel="${esc(o.totals.label ?? 'Total')}"` : '') + (o.totals?.fn && k === 1 ? ` totalsRowFunction="${o.totals.fn}"` : '');
    const inner = (o.calc && k === 3 ? `<calculatedColumnFormula>${esc(o.calc)}</calculatedColumnFormula>` : '') + (o.totals?.fn === 'custom' && k === 1 ? `<totalsRowFormula>${esc(o.totals.formula!)}</totalsRowFormula>` : '');
    return `<tableColumn id="${k + 1}" name="${esc(cn)}"${attrs}${inner ? `>${inner}</tableColumn>` : '/>'}`;
  }).join('');
  const dataEnd = o.totals ? last - 1 : last;
  const af = header ? (o.autoFilter ?? `<autoFilter ref="A${r0 + 1}:${lastCol}${dataEnd}"/>`).replace('{ref}', `A${r0 + 1}:${lastCol}${dataEnd}`) : '';
  const style = o.style === null ? '' : ` name="${o.style ?? 'TableStyleMedium2'}"`;
  book.part(`xl/tables/table${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="${X_MAIN}" id="${n}" name="${name}" displayName="${name}" ref="${ref}"`
    + `${header ? '' : ' headerRowCount="0"'}${o.totals ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}>${af}${o.sortState?.replace('{ref}', `A${r0 + 2}:${lastCol}${dataEnd}`).replace('{r}', String(r0 + 2)).replace('{e}', String(dataEnd)) ?? ''}`
    + `<tableColumns count="${names.length + (o.calc ? 1 : 0)}">${cols}</tableColumns>`
    + `<tableStyleInfo${style} ${o.stripes ?? 'showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"'}/></table>`, TABLE_CT);
  if (!tableParts.has(ts)) tableParts.set(ts, []);
  tableParts.get(ts)!.push(ts.rel(TABLE_REL, `../tables/table${n}.xml`));
  ts.next = last + 1;
  return id;
}
const T = '§18.5.1.2 table; Insert ▸ Table';
table('Table, style Medium 2, banded rows', 'supported', `${T}, §18.5.1.5 tableStyleInfo`, {},
  (t) => info(t)?.getAttribute('name') === 'TableStyleMedium2' && isOn(info(t)?.getAttribute('showRowStripes')), 'xlsx-format.ts:279 readTable, :134 tableStyleXml');
table('Table, style Light 9', 'supported', `${T}; Table Design ▸ Table Styles`, { style: 'TableStyleLight9' },
  (t) => info(t)?.getAttribute('name') === 'TableStyleLight9', 'xlsx-format.ts:279');
const firstLast = (t: Element | undefined) => isOn(info(t)?.getAttribute('showFirstColumn')) && isOn(info(t)?.getAttribute('showLastColumn'));
table('Table, first and last column emphasis', 'supported', `${T}; Table Design ▸ First Column, Last Column`, { style: 'TableStyleDark1', stripes: 'showFirstColumn="1" showLastColumn="1" showRowStripes="0" showColumnStripes="0"' },
  (t) => firstLast(t), 'xlsx-format.ts:300');
table('Table, banded columns only', 'supported', `${T}; Table Design ▸ Banded Columns`, { style: 'TableStyleMedium9', stripes: 'showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="1"' },
  (t) => isOn(info(t)?.getAttribute('showColumnStripes')) && !isOn(info(t)?.getAttribute('showRowStripes')), 'xlsx-format.ts:299');
table('Table without a header row', 'supported', `${T}@headerRowCount; Table Design ▸ Header Row off`, { header: false },
  (t) => t?.getAttribute('headerRowCount') === '0', 'xlsx-format.ts:293');
table('Table with no style', 'supported', `${T}; Table Design ▸ Table Styles ▸ None`, { style: null },
  (t) => !!t && !info(t)?.getAttribute('name'), 'xlsx-format.ts:290');
table('Total row with a label', 'supported', `${T}@totalsRowCount, §18.5.1.3 totalsRowLabel; Table Design ▸ Total Row`, { totals: { label: 'Sum' } },
  (t) => t?.getAttribute('totalsRowCount') === '1' && tcols(t)[0]?.getAttribute('totalsRowLabel') === 'Sum', 'xlsx-format.ts:124');
table('Total row SUM function', 'loss', `${T}, §18.5.1.3 totalsRowFunction sum`, { totals: { fn: 'sum', formula: 'SUBTOTAL(109,[Amount])' } },
  (t) => tcols(t)[1]?.getAttribute('totalsRowFunction') === 'sum', 'xlsx-format.ts:126 (written as custom with a totalsRowFormula)');
table('Total row SUM shows (any form)', 'supported', `${T}, §18.5.1.3`, { totals: { fn: 'sum', formula: 'SUBTOTAL(109,[Amount])' } },
  (t) => ['sum', 'custom'].includes(tcols(t)[1]?.getAttribute('totalsRowFunction') ?? '') && t?.getAttribute('totalsRowCount') === '1', 'xlsx-format.ts:126');
table('Calculated column', 'kept', `${T}, §18.5.1.1 calculatedColumnFormula`, { calc: 'Sampler{n}[[#This Row],[Amount]]*2' },
  (t) => !!kid(tcols(t)[3], 'x:calculatedColumnFormula')?.textContent, 'xlsx-format.ts:314 (kept as written)');
// (a table alone on its sheet: a sheet's one filter here is the table's)
const tb2 = book.sheet('Table filter');
table('Table filter with a condition (the sheet\'s only table)', 'supported', `${T}, §18.3.2.1 autoFilter in a table`, { sheet: tb2, autoFilter: '<autoFilter ref="{ref}"><filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="6"/></customFilters></filterColumn></autoFilter>' },
  (t) => kid(kid(t, 'x:autoFilter'), 'x:filterColumn')?.getAttribute('colId') === '1', 'xlsx.ts:1886 (table filter), :930');
const buttons = tbl('Filter buttons on every table of a sheet', 'supported', `${T}, §18.3.2.1 autoFilter (each table's own)`, (v) => {
  const f = rowOf(v, buttons);
  const parts = f ? relsOf(v, f.sheet.path).filter((r) => r.type === TABLE_REL).map((r) => v.doc(r.target)?.documentElement) : [];
  return parts.length > 1 && parts.every((t) => !t || t.getAttribute('headerRowCount') === '0' || !!kid(t, 'x:autoFilter'));
}, 'xlsx.ts:918 filterTable (the one table overlapping the sheet\'s filter)');
tb.item(buttons, 'Filter buttons on every table of a sheet (the Tables sheet\'s tables with a header row)');
table('Table sorted (sortState)', 'kept', `${T}, §18.3.1.92 sortState`, { sortState: '<sortState ref="{ref}"><sortCondition descending="1" ref="B{r}:B{e}"/></sortState>' },
  (t) => !!kid(t, 'x:sortState'), 'xlsx-format.ts:306 (sortState kept)');
table('Column number format (dataDxfId)', 'loss', `${T}, §18.5.1.3 dataDxfId`, { colAttrs: ['', ` dataDxfId="${book.styles.dxf('<numFmt numFmtId="164" formatCode="0.0%"/>')}"`] },
  (t) => !!tcols(t)[1]?.getAttribute('dataDxfId'), 'xlsx-format.ts:108 (per-column formats not written)');
book.styles.numFmt('0.0%');
book.styles.tableStyles = `<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"><tableStyle name="SamplerTableStyle" pivot="0" count="2"><tableStyleElement type="wholeTable" dxfId="${book.styles.dxf(`<font><b/></font><border><left style="thin"><color rgb="FF1B7F79"/></left><right style="thin"><color rgb="FF1B7F79"/></right><top style="thin"><color rgb="FF1B7F79"/></top><bottom style="thin"><color rgb="FF1B7F79"/></bottom></border>`)}"/><tableStyleElement type="headerRow" dxfId="${book.styles.dxf('<fill><patternFill patternType="solid"><bgColor rgb="FFC8553D"/></patternFill></fill>')}"/></tableStyle></tableStyles>`;
table('Custom table style (Table Design ▸ New Table Style)', 'loss', `${T}, §18.8.40 tableStyle, §18.8.41 tableStyleElement`, { style: 'SamplerTableStyle' },
  (t, v) => info(t)?.getAttribute('name') === 'SamplerTableStyle' && xKids(kid(v.doc('xl/styles.xml')?.documentElement, 'x:tableStyles'), 'tableStyle').some((s) => s.getAttribute('name') === 'SamplerTableStyle'), 'xlsx.ts:477 (tableStyles count="0" written)');
table('Table name (displayName)', 'supported', `${T}@displayName; Table Design ▸ Table Name`, {},
  (t) => /^Sampler\d+$/.test(t?.getAttribute('displayName') ?? ''), 'xlsx-format.ts:286');
// a formula reading a table by its name and column
const sref = tbl('Formula with a structured reference (Sampler1[Amount])', 'supported', '§18.17.2.4 (structured references); type =SUM(Table[Column])',
  (v) => (formulaOf(cellOf(v, sref)) ?? '').replace(/\s/g, '') === 'SUM(Sampler1[Amount])' && kid(cellOf(v, sref), 'x:v')?.textContent === '40', 'xlsx.ts:224 usesUnknownFunction (table references: formula and value kept)');
tb.item(sref, 'Formula with a structured reference (Sampler1[Amount])', { f: '<f>SUM(Sampler1[Amount])</f>', v: 40 });

// ---------------------------------------------------------------------------------------------
// Filters and sorting (X-FLT): Data ▸ Filter, Data ▸ Sort; one sheet each

const flt = itemList('X-FLT', items);
/** A filter item: a sheet of its own, its header row the item's (A id, B Number, C Text), six rows, the filter `cols` on A1:C7. */
function filter(feature: string, short: string, tag: Tag, spec: string, cols: string, check: (af: Element | undefined, ws: Element | undefined) => boolean, basis?: string, extra?: (s: SheetB) => void): string {
  const id = flt(feature, tag, spec, (v) => check(wsPart(v, id, 'autoFilter'), wsOf(v, id)), basis);
  const s = book.sheet(`${id} ${short}`.slice(0, 31));
  s.text('A1', `${id} ${feature}`); s.text('B1', 'Number'); s.text('C1', 'Text');
  const texts = ['alpha', 'beta', 'gamma', '', 'alphabet', 'delta'];
  for (let k = 0; k < 6; k++) { s.text(`A${k + 2}`, `row ${k + 1}`); s.num(`B${k + 2}`, (k + 1) * 3); if (texts[k]) s.text(`C${k + 2}`, texts[k]); }
  s.set('autoFilter', `<autoFilter ref="A1:C7">${cols}</autoFilter>`);
  book.name('_xlnm._FilterDatabase', `'${s.name}'!$A$1:$C$7`, `localSheetId="${s.index}" hidden="1"`);
  extra?.(s);
  return id;
}
const fc = (af: Element | undefined, colId: number) => xKids(af, 'filterColumn').find((c) => c.getAttribute('colId') === String(colId));
const F = '§18.3.2.1 autoFilter, §18.3.2.2 filterColumn; Data ▸ Filter';
filter('Filter buttons, no condition', 'Buttons', 'supported', F, '', (af) => af?.getAttribute('ref')?.startsWith('A1:C') ?? false, 'xlsx.ts:1867');
filter('Value list filter (alpha, gamma)', 'Values', 'supported', `${F}, §18.3.2.6 filters`, '<filterColumn colId="2"><filters><filter val="alpha"/><filter val="gamma"/></filters></filterColumn>',
  (af) => xKids(kid(fc(af, 2), 'x:filters'), 'filter').map((f) => f.getAttribute('val')).sort().join() === 'alpha,gamma', 'xlsx.ts:2288, :1175',
  (s) => { for (const r of [3, 5, 6, 7]) s.row(r - 1, 'hidden="1"'); });
filter('Value list with blanks', 'Blanks', 'supported', `${F}, §18.3.2.6 filters@blank`, '<filterColumn colId="2"><filters blank="1"><filter val="beta"/></filters></filterColumn>',
  (af) => isOn(kid(fc(af, 2), 'x:filters')?.getAttribute('blank')), 'xlsx.ts:2291');
filter('Number filter greater than 6', 'Greater', 'supported', `${F}, §18.3.2.3 customFilter`, '<filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="6"/></customFilters></filterColumn>',
  (af) => { const c = kid(kid(fc(af, 1), 'x:customFilters'), 'x:customFilter'); return c?.getAttribute('operator') === 'greaterThan' && c?.getAttribute('val') === '6'; });
filter('Two conditions with And', 'And', 'supported', `${F}, §18.3.2.4 customFilters@and`, '<filterColumn colId="1"><customFilters and="1"><customFilter operator="greaterThanOrEqual" val="3"/><customFilter operator="lessThanOrEqual" val="12"/></customFilters></filterColumn>',
  (af) => isOn(kid(fc(af, 1), 'x:customFilters')?.getAttribute('and')) && xKids(kid(fc(af, 1), 'x:customFilters'), 'customFilter').length === 2);
filter('Two conditions with Or', 'Or', 'supported', `${F}, §18.3.2.4 customFilters`, '<filterColumn colId="1"><customFilters><customFilter operator="lessThan" val="6"/><customFilter operator="greaterThan" val="15"/></customFilters></filterColumn>',
  (af) => !isOn(kid(fc(af, 1), 'x:customFilters')?.getAttribute('and')) && xKids(kid(fc(af, 1), 'x:customFilters'), 'customFilter').length === 2);
filter('Text filter contains (*pha*)', 'Contains', 'supported', `${F}, §18.3.2.3 customFilter (wildcards)`, '<filterColumn colId="2"><customFilters><customFilter val="*pha*"/></customFilters></filterColumn>',
  (af) => kid(kid(fc(af, 2), 'x:customFilters'), 'x:customFilter')?.getAttribute('val') === '*pha*');
filter('Text filter begins with (al*)', 'Begins', 'supported', `${F}, §18.3.2.3 customFilter`, '<filterColumn colId="2"><customFilters><customFilter val="al*"/></customFilters></filterColumn>',
  (af) => kid(kid(fc(af, 2), 'x:customFilters'), 'x:customFilter')?.getAttribute('val') === 'al*');
filter('Top 10 filter (top 2 items)', 'Top 10', 'loss', `${F}, §18.3.2.10 top10`, '<filterColumn colId="1"><top10 val="2" filterVal="15"/></filterColumn>',
  (af) => kid(fc(af, 1), 'x:top10')?.getAttribute('val') === '2', 'xlsx.ts:2312 (not read; warning)');
filter('Dynamic filter above average', 'Above average', 'loss', `${F}, §18.3.2.5 dynamicFilter`, '<filterColumn colId="1"><dynamicFilter type="aboveAverage" val="10.5"/></filterColumn>',
  (af) => kid(fc(af, 1), 'x:dynamicFilter')?.getAttribute('type') === 'aboveAverage', 'xlsx.ts:2312');
filter('Filter by cell color', 'Color', 'loss', `${F}, §18.3.2.1 colorFilter`, `<filterColumn colId="1"><colorFilter dxfId="${book.styles.dxf('<fill><patternFill patternType="solid"><bgColor rgb="FFF2A541"/></patternFill></fill>')}"/></filterColumn>`,
  (af) => !!kid(fc(af, 1), 'x:colorFilter'), 'xlsx.ts:2312');
filter('Filter by icon', 'Icon', 'loss', `${F}, §18.3.2.7 iconFilter`, '<filterColumn colId="1"><iconFilter iconSet="3Arrows" iconId="0"/></filterColumn>',
  (af) => kid(fc(af, 1), 'x:iconFilter')?.getAttribute('iconSet') === '3Arrows', 'xlsx.ts:2312');
filter('Date filter by year (dateGroupItem)', 'Dates', 'loss', `${F}, §18.3.2.4 dateGroupItem`, '<filterColumn colId="1"><filters><dateGroupItem year="2025" dateTimeGrouping="year"/></filters></filterColumn>',
  (af) => !!kid(kid(fc(af, 1), 'x:filters'), 'x:dateGroupItem'), 'xlsx.ts:2292');
filter('Rows hidden by the filter', 'Hidden rows', 'supported', `${F}; §18.3.1.73 row@hidden`, '<filterColumn colId="1"><customFilters><customFilter operator="greaterThan" val="9"/></customFilters></filterColumn>',
  (_, ws) => { const rows = xKids(kid(ws, 'x:sheetData'), 'row'); return ['2', '3', '4'].every((n) => isOn(rows.find((r) => r.getAttribute('r') === n)?.getAttribute('hidden'))); }, 'xlsx.ts:1736',
  (s) => { for (const r of [2, 3, 4]) s.row(r - 1, 'hidden="1"'); });
filter('Sort by a column, descending (sortState)', 'Sort', 'kept', '§18.3.1.92 sortState, §18.3.1.91 sortCondition; Data ▸ Sort', '',
  (_, ws) => kid(kid(ws, 'x:sortState'), 'x:sortCondition')?.getAttribute('descending') === '1', 'xlsx-view.ts:338 sortState',
  (s) => s.set('sortState', '<sortState ref="A2:C7"><sortCondition descending="1" ref="B2:B7"/></sortState>'));
filter('Sort by cell color', 'Sort color', 'kept', '§18.3.1.91 sortCondition@sortBy cellColor', '',
  (_, ws) => kid(kid(ws, 'x:sortState'), 'x:sortCondition')?.getAttribute('sortBy') === 'cellColor', 'xlsx-view.ts:338',
  (s) => s.set('sortState', `<sortState ref="A2:C7"><sortCondition sortBy="cellColor" ref="B2:B7" dxfId="${book.styles.dxf('<fill><patternFill patternType="solid"><bgColor rgb="FF8AB17D"/></patternFill></fill>')}"/></sortState>`));
const fdb = flt('Filter range name (_xlnm._FilterDatabase)', 'supported', '§18.2.5 definedName _xlnm._FilterDatabase (§18.2.6 built-in names)',
  (v) => definedNames(v).some((d) => d.getAttribute('name') === '_xlnm._FilterDatabase' && /Values/.test(d.textContent ?? '')), 'xlsx.ts:924 (regenerated)');
tb.item(fdb, 'Filter range name (_xlnm._FilterDatabase) of the Values filter sheet');

// ---------------------------------------------------------------------------------------------
// Data validation (X-DV): Data ▸ Data Validation; each rule on column B of its row

const val = book.sheet('Validation');
val.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/></cols>');
['red', 'green', 'blue'].forEach((c, k) => val.text(`H${k + 1}`, c));
const dv = itemList('X-DV', items);
const rules: string[] = [];
const x14rules: string[] = [];
/** The validation covering the item's B cell (standard or x14). */
function dvOf(v: View, id: string): Element | undefined {
  const f = rowOf(v, id);
  if (!f) return undefined;
  const cell = `B${f.r + 1}`;
  const std = xKids(kid(f.sheet.root, 'x:dataValidations'), 'dataValidation').find((d) => covers(d.getAttribute('sqref'), cell));
  if (std) return std;
  return Array.from(f.sheet.root?.getElementsByTagNameNS('http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', 'dataValidation') ?? [])
    .find((d) => covers(d.getElementsByTagNameNS('http://schemas.microsoft.com/office/excel/2006/main', 'sqref')[0]?.textContent, cell));
}
const f1 = (d: Element | undefined) => (kid(d, 'x:formula1')?.textContent ?? d?.getElementsByTagNameNS('http://schemas.microsoft.com/office/excel/2006/main', 'f')[0]?.textContent ?? '').replace(/\s/g, '');
const f2 = (d: Element | undefined) => (kid(d, 'x:formula2')?.textContent ?? '').replace(/\s/g, '');
const D = '§18.3.1.32 dataValidation; Data ▸ Data Validation';
/** A validation item: `attrs` and formulas on B of the item's row. */
function rule(feature: string, tag: Tag, spec: string, attrs: string, formulas: string, check: (d: Element | undefined) => boolean, value?: string | number, basis = 'xlsx-notes.ts:348 readValidations, :273 validationsXml', extraSq?: string): string {
  const id = dv(feature, tag, spec, (v) => check(dvOf(v, id)), basis);
  const r = val.item(id, feature, value);
  rules.push(`<dataValidation ${attrs} sqref="B${r + 1}${extraSq ? ' ' + extraSq : ''}">${formulas.replace(/\{r\}/g, String(r + 1))}</dataValidation>`);
  return id;
}
rule('List typed in (red,green,blue)', 'supported', `${D}, §18.18.21 ST_DataValidationType list`, 'type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>"red,green,blue"</formula1>',
  (d) => d?.getAttribute('type') === 'list' && f1(d) === '"red,green,blue"', 'green');
rule('List from a range ($H$1:$H$3)', 'supported', `${D} list`, 'type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>$H$1:$H$3</formula1>',
  (d) => d?.getAttribute('type') === 'list' && f1(d) === '$H$1:$H$3', 'blue');
rule('List without the in-cell drop-down', 'supported', `${D}@showDropDown`, 'type="list" allowBlank="1" showDropDown="1" showInputMessage="1" showErrorMessage="1"', '<formula1>"yes,no"</formula1>',
  (d) => isOn(d?.getAttribute('showDropDown')));
rule('Whole number between 1 and 10', 'supported', `${D}, ST_DataValidationType whole, ST_DataValidationOperator between`, 'type="whole" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>1</formula1><formula2>10</formula2>',
  (d) => d?.getAttribute('type') === 'whole' && (d?.getAttribute('operator') ?? 'between') === 'between' && f1(d) === '1' && f2(d) === '10', 5);
rule('Whole number greater than 0', 'supported', `${D} operator greaterThan`, 'type="whole" operator="greaterThan" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1>',
  (d) => d?.getAttribute('operator') === 'greaterThan' && f1(d) === '0', 3);
rule('Decimal not between 0.5 and 1.5', 'supported', `${D} decimal, notBetween`, 'type="decimal" operator="notBetween" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0.5</formula1><formula2>1.5</formula2>',
  (d) => d?.getAttribute('type') === 'decimal' && d?.getAttribute('operator') === 'notBetween' && f1(d) === '0.5' && f2(d) === '1.5', 2.5);
rule('Date between 2025-01-01 and 2025-12-31', 'supported', `${D} date`, 'type="date" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>45658</formula1><formula2>46022</formula2>',
  (d) => d?.getAttribute('type') === 'date' && f1(d) === '45658' && f2(d) === '46022');
rule('Time before noon', 'supported', `${D} time, lessThan`, 'type="time" operator="lessThan" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0.5</formula1>',
  (d) => d?.getAttribute('type') === 'time' && d?.getAttribute('operator') === 'lessThan' && Number(f1(d)) === 0.5);
rule('Text length at most 5', 'supported', `${D} textLength, lessThanOrEqual`, 'type="textLength" operator="lessThanOrEqual" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>5</formula1>',
  (d) => d?.getAttribute('type') === 'textLength' && d?.getAttribute('operator') === 'lessThanOrEqual' && f1(d) === '5', 'abc');
rule('Custom formula (=ISNUMBER(B…))', 'supported', `${D} custom`, 'type="custom" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>ISNUMBER(B{r})</formula1>',
  (d) => d?.getAttribute('type') === 'custom' && /^ISNUMBER\(B\d+\)$/.test(f1(d)));
rule('Input message only (any value)', 'supported', `${D}@prompt, @promptTitle; Data Validation ▸ Input Message`, 'allowBlank="1" showInputMessage="1" promptTitle="X-DV tip" prompt="Type anything here"', '',
  (d) => d?.getAttribute('promptTitle') === 'X-DV tip' && d?.getAttribute('prompt') === 'Type anything here');
rule('Error alert Stop with title and message', 'supported', `${D}@errorTitle, @error; Data Validation ▸ Error Alert`, 'type="whole" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Wrong" error="Whole numbers only"', '<formula1>0</formula1><formula2>100</formula2>',
  (d) => d?.getAttribute('errorTitle') === 'Wrong' && d?.getAttribute('error') === 'Whole numbers only' && (d?.getAttribute('errorStyle') ?? 'stop') === 'stop');
rule('Error alert Warning', 'supported', `${D}@errorStyle warning`, 'type="whole" errorStyle="warning" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1><formula2>100</formula2>',
  (d) => d?.getAttribute('errorStyle') === 'warning');
rule('Error alert Information', 'supported', `${D}@errorStyle information`, 'type="whole" errorStyle="information" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1><formula2>100</formula2>',
  (d) => d?.getAttribute('errorStyle') === 'information');
rule('Ignore blank off', 'supported', `${D}@allowBlank`, 'type="whole" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1><formula2>9</formula2>',
  (d) => !!d && !isOn(d.getAttribute('allowBlank')));
rule('No error alert shown', 'supported', `${D}@showErrorMessage`, 'type="whole" allowBlank="1" showInputMessage="1"', '<formula1>0</formula1><formula2>9</formula2>',
  (d) => !!d && !isOn(d.getAttribute('showErrorMessage')));
rule('IME mode (Japanese input on)', 'loss', `${D}@imeMode`, 'type="textLength" allowBlank="1" imeMode="hiragana" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1><formula2>20</formula2>',
  (d) => d?.getAttribute('imeMode') === 'hiragana', undefined, 'xlsx-notes.ts:273 (imeMode not written)');
rule('Same rule over several ranges', 'supported', `${D}@sqref (several ranges)`, 'type="whole" allowBlank="1" showInputMessage="1" showErrorMessage="1"', '<formula1>0</formula1><formula2>9</formula2>',
  (d) => (d?.getAttribute('sqref') ?? '').trim().split(/\s+/).length === 2, undefined, undefined, 'D1:D2');
const longItems = Array.from({ length: 60 }, (_, k) => `item${k + 1}`).join(',');
rule('List over 255 characters', 'loss', `${D} list (Excel takes 255 characters typed)`, 'type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"', `<formula1>"${longItems}"</formula1>`,
  (d) => f1(d) === `"${longItems}"`, undefined, 'xlsx-notes.ts:266 MAX_TYPED_LIST (moved to a hidden Lists sheet)');
// an Excel 2010 rule (x14) reading another sheet
const x14id = dv('List from another sheet (x14:dataValidation)', 'loss', `${D}; MS-XLSX 2.6.27 x14:dataValidation`, (v) => {
  const d = dvOf(v, x14id);
  return d?.namespaceURI === 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
}, 'xlsx-notes.ts:355 (read and written as a standard rule)');
const x14r = val.item(x14id, 'List from another sheet (x14:dataValidation)', 'b');
const x14shows = dv('List from another sheet works (any form)', 'supported', `${D}; MS-XLSX x14:dataValidation`, (v) => {
  const d = dvOf(v, x14shows);
  return d?.getAttribute('type') === 'list' && /Tables!\$B\$2:\$B\$4/.test(f1(d));
}, 'xlsx-notes.ts:355');
const x14r2 = val.item(x14shows, 'List from another sheet works (any form)', 'b');
x14rules.push(`<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>Tables!$B$2:$B$4</xm:f></x14:formula1><xm:sqref>B${x14r + 1}</xm:sqref></x14:dataValidation>`);
x14rules.push(`<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>Tables!$B$2:$B$4</xm:f></x14:formula1><xm:sqref>B${x14r2 + 1}</xm:sqref></x14:dataValidation>`);

let bytes: Uint8Array | undefined;
export const xlsxData: Sampler = {
  name: 'xlsx-data.xlsx', area: 'Excel tables, filters and sorting, data validation', items,
  build: () => {
    if (bytes) return bytes;
    for (const [s, list] of tableParts) s.set('tableParts', `<tableParts count="${list.length}">${list.map((r) => `<tablePart r:id="${r}"/>`).join('')}</tableParts>`);
    val.set('dataValidations', `<dataValidations count="${rules.length}">${rules.join('')}</dataValidations>`);
    val.set('extLst', `<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations count="${x14rules.length}" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">${x14rules.join('')}</x14:dataValidations></ext></extLst>`);
    return (bytes = book.build('Excel sampler: tables, filters, validation'));
  },
};
