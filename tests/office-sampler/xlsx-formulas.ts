/**
 * Excel sampler: formulas (X-FRM), their cached values (X-VAL), defined names (X-NAM), links to
 * other workbooks (X-EXT) and calculation settings (X-CLC). One row per item: the id in column A,
 * the formula in column B (dynamic arrays spill to the right, into C and D). The formulas read the
 * sheets Data, Data2 and 'Other Sheet'. Formulas are written as Excel writes them in the file
 * (§18.17: no leading =, newer functions with _xlfn./_xlfn._xlws., LET and LAMBDA parameters with
 * _xlpm.), each with the value Excel would have saved.
 * ECMA-376 Part 1 §18.3.1.40 f (CT_CellFormula), §18.17 formulas, §18.2.5 definedName,
 * §18.14 external links, §18.2.2 calcPr; MS-XLSX 2.3.2 (dynamic array metadata, XLDAPR);
 * Excel's Formulas tab (Name Manager, Calculation Options).
 *
 * Tags from src/io/xlsx.ts readXlsx (:1786-1815: shared formulas expanded, arrays, values kept
 * for unknown functions), writeBook (:771-845: dynamic arrays with cm and metadata.xml, legacy
 * arrays, prefixes by excelFunctionNames :201 and remembered ones notePrefixes :210, errors
 * outside FILE_ERRORS as #VALUE! :195), names (:1144), external links (:1620, kept parts), calcPr
 * (xlsx-view.ts:362 CALC_KEPT; calcId and fullCalcOnLoad written).
 */
import { type Item, type Sampler, type View, itemList, kid, esc } from './kit';
import { Book, type CellOpts, cellOf, formulaOf, definedNames, wbRoot, xKids, relsOf, wbPath, XCT, XREL, XDA, isOn, X_MAIN } from './xlsx';

const items: Item[] = [];
const book = new Book();
const sh = book.sheet('Formulas');
// the data the formulas read
const data = book.sheet('Data');
[1, 2, 3, 4, 5].forEach((n, k) => data.num(`${'ABCDE'[k]}1`, n));
[10, 20, 30, 40, 50].forEach((n, k) => data.num(`${'ABCDE'[k]}2`, n));
['a', 'b', 'a', 'c', 'b'].forEach((t, k) => data.text(`${'ABCDE'[k]}3`, t));
data.text('A4', 'apple'); data.num('B4', 1.5); data.text('A5', 'pear'); data.num('B5', 2.25);
const data2 = book.sheet('Data2');
data2.num('A1', 100);
const other = book.sheet('Other Sheet');
other.num('A1', 7);
type Tag = 'supported' | 'kept' | 'loss';

const vOf = (c: Element | undefined) => kid(c, 'x:v')?.textContent ?? null;
const fEl = (c: Element | undefined) => kid(c, 'x:f');
/** A formula's text in the file (as written: a space is the intersection operator). */
const norm = (s: string | null | undefined) => (s ?? '').trim();

// ---------------------------------------------------------------------------------------------
// Formulas (X-FRM)

const frm = itemList('X-FRM', items);
/**
 * A formula item: B holds `f` (as the file has it) with cached value `cell` (v and t). The check
 * reads the formula's text back (`want`, the same unless given) and the cell's value.
 */
function formula(feature: string, tag: Tag, spec: string, f: string, cell: CellOpts, opts: { want?: string; alt?: string[]; value?: boolean; extra?: (v: View, id: string) => boolean; basis?: string; fAttrs?: string; cAttrs?: string; spill?: CellOpts[] } = {}): string {
  const rowNo = sh.next + 1;
  const sub = (s: string) => s.replace(/{r}/g, String(rowNo)).replace(/{seq}/g, String(seqRow));
  f = sub(f);
  const want = sub(opts.want ?? f);
  const id = frm(feature, tag, spec, (v) => {
    const c = cellOf(v, id);
    if (![want, ...(opts.alt ?? [])].some((w) => norm(formulaOf(c)) === norm(sub(w)))) return false;
    if (opts.value !== false && cell.v !== undefined && vOf(c) !== String(cell.v)) return false;
    return opts.extra ? opts.extra(v, id) : true;
  }, opts.basis);
  const r = sh.item(id, feature, { ...cell, f: `<f${opts.fAttrs ? ' ' + sub(opts.fAttrs) : ''}>${esc(f)}</f>`, ...(opts.cAttrs ? { attrs: opts.cAttrs } : {}) });
  (opts.spill ?? []).forEach((s, k) => sh.cell(`${'CDEFG'[k]}${r + 1}`, s));
  return id;
}
const FS = '§18.3.1.40 f, §18.17 formulas';
/** The row (from 1) of the SEQUENCE item, which the spill reference reads. */
let seqRow = 0;
formula('Arithmetic and precedence', 'supported', `${FS}, §18.17.2.2 operators`, '1+2*3^2-4/2', { v: 17 });
formula('Relative references (another sheet)', 'supported', `${FS}, §18.17.2.3 cell references`, 'Data!A1+Data!B1', { v: 3 });
formula('Absolute reference', 'supported', `${FS}, §18.17.2.3`, 'Data!$A$1*2', { v: 2 });
formula('Mixed references', 'supported', `${FS}, §18.17.2.3`, 'Data!$A1+Data!A$2', { v: 11 });
formula('Range in a function (SUM)', 'supported', FS, 'SUM(Data!A1:E1)', { v: 15 });
formula('Whole column reference', 'supported', `${FS}, §18.17.2.3`, 'SUM(Data!A:A)', { v: 11 });
formula('Whole row reference', 'supported', `${FS}, §18.17.2.3`, 'SUM(Data!1:1)', { v: 15 });
formula('Quoted sheet name with a space', 'supported', `${FS}, §18.17.2.3 sheet names`, "'Other Sheet'!A1*3", { v: 21 });
formula('3-D reference across sheets', 'supported', `${FS}, §18.17.2.3 (3-D reference)`, 'SUM(Data:Data2!A1)', { v: 101 }, { basis: 'formula.ts (3-D refs)' });
formula('Intersection operator (space)', 'supported', `${FS}, §18.17.2.2 intersection`, 'SUM(Data!A1:C2 Data!B1:B5)', { v: 22 }, { want: 'SUM(Data!A1:C2 Data!B1:B5)' });
formula('Union operator (comma in brackets)', 'supported', `${FS}, §18.17.2.2 union`, 'SUM((Data!A1,Data!C1))', { v: 4 });
formula('Percent and concatenation operators', 'supported', `${FS}, §18.17.2.2`, 'Data!B2*10%&" units"', { t: 'str', v: '2 units' });
formula('Comparison giving TRUE', 'supported', FS, 'Data!E1>=5', { t: 'b', v: 1 });
formula('Text with doubled quotes', 'supported', `${FS}, §18.17.2.1 strings`, '"He said ""hi"""', { t: 'str', v: 'He said "hi"' });
formula('Nested IF with AND', 'supported', FS, 'IF(AND(Data!A1>0,Data!B1<5),"yes","no")', { t: 'str', v: 'yes' });
formula('VLOOKUP exact match', 'supported', FS, 'VLOOKUP("pear",Data!A4:B5,2,FALSE)', { v: 2.25 });
formula('INDEX and MATCH', 'supported', FS, 'INDEX(Data!A2:E2,MATCH(3,Data!A1:E1,0))', { v: 30 });
formula('ROUND and SQRT', 'supported', FS, 'ROUND(SQRT(2),4)', { v: 1.4142 });
formula('OFFSET (volatile reference)', 'supported', FS, 'SUM(OFFSET(Data!A1,1,0,1,3))', { v: 60 });
formula('INDIRECT', 'supported', FS, 'INDIRECT("Data!C2")', { v: 30 });
// newer functions, as Excel writes them
formula('XLOOKUP', 'supported', `${FS}; MS-XLSX 2.2.2 (_xlfn. future functions)`, '_xlfn.XLOOKUP(3,Data!A1:E1,Data!A2:E2)', { v: 30 }, { basis: 'xlsx.ts:177 XLFN' });
formula('XMATCH', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.XMATCH(4,Data!A1:E1)', { v: 4 });
formula('TEXTJOIN', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.TEXTJOIN("-",TRUE,Data!A3:E3)', { t: 'str', v: 'a-b-a-c-b' });
formula('CONCAT', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.CONCAT(Data!A3:C3)', { t: 'str', v: 'aba' });
formula('IFS', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.IFS(Data!A1>3,"big",Data!A1>0,"small")', { t: 'str', v: 'small' });
formula('SWITCH', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.SWITCH(Data!B1,1,"one",2,"two","other")', { t: 'str', v: 'two' });
formula('MAXIFS', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.MAXIFS(Data!A2:E2,Data!A3:E3,"a")', { v: 30 });
formula('LET with _xlpm. names', 'supported', `${FS}; MS-XLSX 2.2.2 _xlpm.`, '_xlfn.LET(_xlpm.x,Data!A2,_xlpm.y,Data!B2,_xlpm.x+_xlpm.y)', { v: 30 }, { basis: 'array-formulas.ts:115 fileFormula (_xlpm.)' });
formula('LAMBDA called in place', 'supported', `${FS}; MS-XLSX _xlfn.LAMBDA`, '_xlfn.LAMBDA(_xlpm.n,_xlpm.n*3)(Data!B1)', { v: 6 });
formula('STDEV.S (Excel 2010 function)', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.STDEV.S(Data!A1:E1)', { v: 1.5811388300841898 }, { value: false });
formula('Function this program doesn\'t know keeps its prefix (_xlfn.REGEXTEST)', 'supported', `${FS}; MS-XLSX _xlfn.`, '_xlfn.REGEXTEST("chemistry","mist")', { t: 'b', v: 1 }, { basis: 'xlsx.ts:210 notePrefixes, cached value kept (xlsx-cached.ts)' });
formula('Function from an add-in (unknown, no prefix)', 'supported', FS, 'SAMPLERADDIN(1)', { t: 'e', v: '#NAME?' }, { basis: 'xlsx.ts:224 usesUnknownFunction (value kept)' });
// arrays
formula('Array formula (Ctrl+Shift+Enter), one cell', 'supported', `${FS}, §18.3.1.40 f@t array`, 'SUM(Data!A1:E1*Data!A2:E2)', { v: 550 },
  { fAttrs: 't="array" ref="B{r}"', extra: (v, id) => fEl(cellOf(v, id))?.getAttribute('t') === 'array', basis: 'xlsx.ts:1797 legacyArray' });
formula('Array formula over three cells (B:D)', 'supported', `${FS}, §18.3.1.40 f@ref`, 'Data!A1:C1*10', { v: 10 },
  { fAttrs: 't="array" ref="B{r}:D{r}"', spill: [{ v: 20 }, { v: 30 }], extra: (v, id) => fEl(cellOf(v, id))?.getAttribute('t') === 'array' && /^B\d+:D\d+$/.test(fEl(cellOf(v, id))?.getAttribute('ref') ?? '') && vOf(cellOf(v, id, 'D')) === '30' });
const dyn = (extraCheck?: (v: View, id: string) => boolean) => (v: View, id: string) => {
  const c = cellOf(v, id);
  const md = relsOf(v, wbPath(v)).find((r) => r.type === XREL.metadata)?.target;
  const mdRoot = md ? v.doc(md)?.documentElement : undefined;
  const types = xKids(kid(mdRoot, 'x:metadataTypes'), 'metadataType').map((t) => t.getAttribute('name'));
  return fEl(c)?.getAttribute('t') === 'array' && c?.getAttribute('cm') === '1' && types.includes('XLDAPR') && (extraCheck ? extraCheck(v, id) : true);
};
seqRow = sh.next + 1;
formula('Dynamic array SEQUENCE spilling right', 'supported', `${FS}; MS-XLSX 2.3.2 dynamic arrays (cm, metadata XLDAPR)`, '_xlfn.SEQUENCE(1,3)', { v: 1 },
  { fAttrs: 't="array" ref="B{r}:D{r}"', cAttrs: 'cm="1"', spill: [{ v: 2 }, { v: 3 }], extra: dyn((v, id) => vOf(cellOf(v, id, 'D')) === '3'), basis: 'xlsx.ts:785 (cm="1", metadata regenerated)' });
formula('Dynamic array FILTER', 'supported', `${FS}; MS-XLSX _xlfn._xlws.FILTER`, '_xlfn._xlws.FILTER(Data!A1:E1,Data!A1:E1>2)', { v: 3 },
  { fAttrs: 't="array" ref="B{r}:D{r}"', cAttrs: 'cm="1"', spill: [{ v: 4 }, { v: 5 }], extra: dyn(), basis: 'xlsx.ts:188 XLWS' });
formula('Dynamic array SORT descending by column', 'supported', `${FS}; MS-XLSX _xlfn._xlws.SORT`, '_xlfn._xlws.SORT(Data!A1:C1,1,-1,TRUE)', { v: 3 },
  { fAttrs: 't="array" ref="B{r}:D{r}"', cAttrs: 'cm="1"', spill: [{ v: 2 }, { v: 1 }], extra: dyn() });
formula('Dynamic array UNIQUE by column', 'supported', `${FS}; MS-XLSX _xlfn.UNIQUE`, '_xlfn.UNIQUE(Data!A3:E3,TRUE)', { t: 'str', v: 'a' },
  { fAttrs: 't="array" ref="B{r}:D{r}"', cAttrs: 'cm="1"', spill: [{ t: 'str', v: 'b' }, { t: 'str', v: 'c' }], extra: dyn() });
formula('Spill reference (B#) as ANCHORARRAY', 'supported', `${FS}; MS-XLSX _xlfn.ANCHORARRAY`, 'SUM(_xlfn.ANCHORARRAY(B{seq}))', { v: 6 },
  { cAttrs: 'cm="1"', fAttrs: 't="array" ref="B{r}"', basis: 'array-formulas.ts:115 (A1# as ANCHORARRAY)' });
// (an old-style formula intersects implicitly: =Data!A1:A2 there is Excel's =@Data!A1:A2)
formula('Implicit intersection @ as SINGLE', 'supported', `${FS}; MS-XLSX _xlfn.SINGLE`, '_xlfn.SINGLE(Data!A1:A2)', { v: 1 },
  { cAttrs: 'cm="1"', fAttrs: 't="array" ref="B{r}"', alt: ['(Data!A1:A2)', 'Data!A1:A2'], basis: 'array-formulas.ts:115, :155 (@ as SINGLE in a dynamic formula; left out in an old-style one)' });
formula('SINGLE inside a dynamic array formula (FILTER by @)', 'supported', `${FS}; MS-XLSX _xlfn.SINGLE`, '_xlfn._xlws.FILTER(Data!A1:E1,Data!A2:E2>_xlfn.SINGLE(Data!B2:B2))', { v: 3 },
  { cAttrs: 'cm="1"', fAttrs: 't="array" ref="B{r}:D{r}"', spill: [{ v: 4 }, { v: 5 }], basis: 'array-formulas.ts:155 readFileFormula (SINGLE( read as @( )' });
// shared formulas: B holds the master, C and D the cells sharing it. (Excel refuses a file whose
// shared formula refers to another sheet, and never writes one, so the reference is on this sheet.)
const shared = formula('Shared formula, master cell', 'loss', `${FS}, §18.3.1.40 f@t shared, @si`, 'COLUMN(A1)*2', { v: 2 },
  { fAttrs: 't="shared" ref="B{r}:D{r}" si="0"', spill: [{ f: '<f t="shared" si="0"/>', v: 4 }, { f: '<f t="shared" si="0"/>', v: 6 }],
    extra: (v, id) => fEl(cellOf(v, id))?.getAttribute('t') === 'shared', basis: 'xlsx.ts:1789 (expanded into each cell)' });
const sharedC = frm('Shared formula, a sharing cell works out its own formula', 'supported', `${FS}, §18.3.1.40 f@si`, (v) => {
  const c = cellOf(v, shared, 'D');
  return norm(formulaOf(c)) === 'COLUMN(C1)*2' || (fEl(c)?.getAttribute('t') === 'shared' && vOf(c) === '6');
}, 'xlsx.ts:1789 shiftFormula');
sh.item(sharedC, 'Shared formula, a sharing cell works out its own formula (column D of the master row)');
// cached values of each type (X-VAL): the value Excel saved with the formula
const val = itemList('X-VAL', items);
const cached = (feature: string, tag: Tag, f: string, cell: CellOpts, basis?: string, blockC = false, dynamic = false) => {
  const id = val(feature, tag, '§18.3.1.96 v, §18.18.11 ST_CellType', (v) => {
    const c = cellOf(v, id);
    return (c?.getAttribute('t') ?? 'n') === (cell.t ?? 'n') && vOf(c) === String(cell.v);
  }, basis);
  const r = sh.item(id, feature, { ...cell, f: `<f${dynamic ? ` t="array" ref="B${sh.next + 1}"` : ''}>${esc(f)}</f>`, ...(dynamic ? { attrs: 'cm="1"' } : {}) });
  if (blockC) sh.text(`C${r + 1}`, 'in the way');
};
cached('Number', 'supported', 'Data!A2/4', { v: 2.5 });
cached('Text (t="str")', 'supported', '"a"&"b"', { t: 'str', v: 'ab' });
cached('Boolean FALSE (t="b")', 'supported', 'Data!A1>2', { t: 'b', v: 0 });
cached('Empty text', 'supported', 'IF(TRUE,"","x")', { t: 'str', v: '' });
for (const [err, f] of [['#DIV/0!', 'Data!A1/0'], ['#N/A', 'NA()'], ['#NUM!', 'SQRT(-1)'], ['#VALUE!', '"a"+1'], ['#REF!', '#REF!+1'], ['#NAME?', 'SAMPLERNOSUCHNAME+1'], ['#NULL!', 'SUM(Data!A1:A2 Data!C1:C2)']]) {
  cached(`Error ${err}`, 'supported', f, { t: 'e', v: err }, 'xlsx.ts:195 FILE_ERRORS');
}
// #CALC! and #SPILL! are not file error values (§18.18.11): Excel stores them as #VALUE! with rich
// value data saying which; Excel refuses a file holding them as plain values. Sampled as Excel's #VALUE!.
cached('Error #CALC! (empty FILTER), stored as #VALUE!', 'supported', '_xlfn._xlws.FILTER(Data!A1:E1,Data!A1:E1>100)', { t: 'e', v: '#VALUE!' }, 'xlsx.ts:195 (newer errors written as #VALUE!)', false, true);
cached('Error #SPILL! (blocked spill), stored as #VALUE!', 'supported', '_xlfn.SEQUENCE(1,2)', { t: 'e', v: '#VALUE!' }, 'xlsx.ts:195', true, true);

// ---------------------------------------------------------------------------------------------
// Defined names (X-NAM): Formulas ▸ Name Manager

const nam = itemList('X-NAM', items);
const nameEl = (v: View, name: string, local?: number) => definedNames(v).find((d) => d.getAttribute('name') === name && (local === undefined ? !d.hasAttribute('localSheetId') : d.getAttribute('localSheetId') === String(local)));
const N = '§18.2.5 definedName; Formulas ▸ Name Manager';
const nameItem = (feature: string, tag: Tag, check: (v: View) => boolean, basis = 'xlsx.ts:1144 names') => { const id = nam(feature, tag, N, check, basis); sh.item(id, feature); return id; };
book.name('SamplerRate', 'Data!$A$2');
nameItem('Global name for a cell (SamplerRate)', 'supported', (v) => norm(nameEl(v, 'SamplerRate')?.textContent) === 'Data!$A$2');
book.name('SamplerBlock', 'Data!$A$1:$E$2');
nameItem('Global name for a range (SamplerBlock)', 'supported', (v) => norm(nameEl(v, 'SamplerBlock')?.textContent) === 'Data!$A$1:$E$2');
book.name('SamplerConst', '0.25');
nameItem('Name for a constant (SamplerConst = 0.25)', 'supported', (v) => norm(nameEl(v, 'SamplerConst')?.textContent) === '0.25');
book.name('SamplerArray', '{1,2,3}');
nameItem('Name for an array constant ({1,2,3})', 'supported', (v) => norm(nameEl(v, 'SamplerArray')?.textContent) === '{1,2,3}');
book.name('SamplerLocal', 'Formulas!$B$2', 'localSheetId="0"');
nameItem('Name local to a sheet (localSheetId)', 'supported', (v) => norm(nameEl(v, 'SamplerLocal', 0)?.textContent) === 'Formulas!$B$2');
book.name('SamplerLocal', 'Data!$A$1', 'localSheetId="1"');
nameItem('Same name local to another sheet', 'supported', (v) => norm(nameEl(v, 'SamplerLocal', 1)?.textContent) === 'Data!$A$1');
book.name('SamplerHidden', 'Data!$E$2', 'hidden="1"');
nameItem('Hidden name', 'supported', (v) => isOn(nameEl(v, 'SamplerHidden')?.getAttribute('hidden')));
book.name('SamplerNoted', 'Data!$B$2', 'comment="X-NAM note: a comment on a name"');
nameItem('Name with a comment', 'supported', (v) => nameEl(v, 'SamplerNoted')?.getAttribute('comment') === 'X-NAM note: a comment on a name');
book.name('SamplerDouble', '_xlfn.LAMBDA(_xlpm.n,_xlpm.n*2)');
nameItem('LAMBDA name (custom function)', 'supported', (v) => norm(nameEl(v, 'SamplerDouble')?.textContent) === '_xlfn.LAMBDA(_xlpm.n,_xlpm.n*2)');
book.name('SamplerDynamic', 'OFFSET(Data!$A$1,0,0,1,COUNTA(Data!$1:$1))');
nameItem('Dynamic range name (OFFSET, COUNTA)', 'supported', (v) => norm(nameEl(v, 'SamplerDynamic')?.textContent) === 'OFFSET(Data!$A$1,0,0,1,COUNTA(Data!$1:$1))');
book.name('_xlnm.Criteria', 'Data!$A$3:$B$4', 'localSheetId="1"');
nameItem('Advanced filter criteria (_xlnm.Criteria)', 'loss', (v) => !!nameEl(v, '_xlnm.Criteria', 1), 'xlsx.ts:1144 (other _xlnm names not kept)');
book.name('_xlnm.Extract', 'Data!$G$1:$H$1', 'localSheetId="1"');
nameItem('Advanced filter extract (_xlnm.Extract)', 'loss', (v) => !!nameEl(v, '_xlnm.Extract', 1), 'xlsx.ts:1144');
book.name('SamplerMacroFn', 'Data!$A$1', 'function="1" vbProcedure="1"');
nameItem('Name flagged as a macro function', 'loss', (v) => isOn(nameEl(v, 'SamplerMacroFn')?.getAttribute('function')), 'xlsx.ts:1144 (function/vbProcedure not written)');
book.name('SamplerDescribed', 'Data!$C$2', 'description="described" shortcutKey="q"');
nameItem('Name with description and shortcut key', 'loss', (v) => nameEl(v, 'SamplerDescribed')?.getAttribute('description') === 'described', 'xlsx.ts:1144');
// names used in formulas
formula('Formula using a name', 'supported', `${FS}, §18.17.2.5 defined names`, 'SamplerRate*SamplerConst', { v: 2.5 });
formula('Formula calling a LAMBDA name', 'supported', `${FS}; MS-XLSX (LAMBDA names)`, 'SamplerDouble(4)', { v: 8 }, { basis: 'xlsx.ts:671 lambdaNames (written as a dynamic array formula)' });
formula('Formula using a local name', 'supported', `${FS}, §18.2.5 localSheetId`, 'SamplerLocal+1', { v: 4 });

// ---------------------------------------------------------------------------------------------
// A link to another workbook (X-EXT): §18.14 externalLink

const ext = itemList('X-EXT', items);
const linkRid = book.wbPart('externalLinks/externalLink1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><externalLink xmlns="${X_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
  + '<externalBook r:id="rId1"><sheetNames><sheetName val="Prices"/></sheetNames><definedNames><definedName name="LinkedRate" refersTo="=Prices!$B$2"/></definedNames>'
  + '<sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1"><v>42</v></cell></row><row r="2"><cell r="B2"><v>0.5</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>',
XCT.externalLink, XREL.externalLink);
book.pkg.rel('xl/externalLinks/externalLink1.xml', XREL.externalLinkPath, 'Sampler%20Prices.xlsx', true);
book.wb.externalReferences = `<externalReferences><externalReference r:id="${linkRid}"/></externalReferences>`;
const linkPart = (v: View) => relsOf(v, wbPath(v)).find((r) => r.type === XREL.externalLink)?.target;
const e1 = ext('External link part (externalLink, cached sheet data)', 'kept', '§18.14.7 externalLink, §18.14.8 externalReference; Data ▸ Edit Links', (v) => {
  const p = linkPart(v);
  const root = p ? v.doc(p)?.documentElement : undefined;
  return !!root && root.getElementsByTagNameNS(X_MAIN, 'sheetName')[0]?.getAttribute('val') === 'Prices' && xKids(kid(wbRoot(v), 'x:externalReferences'), 'externalReference').length === 1;
}, 'xlsx.ts:1620 externalLinks (kept verbatim)');
sh.item(e1, 'External link part (externalLink, cached sheet data)');
const e2 = ext('External link target file', 'kept', '§18.14 externalLinkPath relationship', (v) => {
  const p = linkPart(v);
  return !!p && relsOf(v, p).some((r) => r.external && /Sampler%20Prices\.xlsx|Sampler Prices\.xlsx/.test(r.target));
}, 'xlsx.ts:1620');
sh.item(e2, 'External link target file');
formula('Formula reading another workbook ([1]Prices!A1)', 'kept', `${FS}, §18.17.2.3 (external references)`, '[1]Prices!$A$1*2', { v: 84 }, { basis: 'xlsx.ts:237 readsOtherWorkbook (formula and value kept)' });
formula('Formula using another workbook\'s name ([1]!LinkedRate)', 'kept', `${FS}, §18.17.2.5`, '[1]!LinkedRate*10', { v: 5 });

// ---------------------------------------------------------------------------------------------
// Calculation settings (X-CLC): Formulas ▸ Calculation Options, File ▸ Options ▸ Formulas

const clc = itemList('X-CLC', items);
book.wb.calcPr = '<calcPr calcId="191029" calcMode="manual" iterate="1" iterateCount="50" iterateDelta="0.0001" fullPrecision="0" calcOnSave="0"/>';
const calc = (v: View) => kid(wbRoot(v), 'x:calcPr');
const calcItem = (feature: string, tag: Tag, spec: string, check: (c: Element | undefined) => boolean, basis = 'xlsx-view.ts:362 CALC_KEPT') => { const id = clc(feature, tag, spec, (v) => check(calc(v)), basis); sh.item(id, feature); };
calcItem('Manual calculation', 'kept', '§18.2.2 calcPr@calcMode; Formulas ▸ Calculation Options ▸ Manual', (c) => c?.getAttribute('calcMode') === 'manual');
calcItem('Iterative calculation, 50 times, 0.0001', 'kept', '§18.2.2 calcPr@iterate, @iterateCount, @iterateDelta; File ▸ Options ▸ Formulas', (c) => isOn(c?.getAttribute('iterate')) && c?.getAttribute('iterateCount') === '50' && Number(c?.getAttribute('iterateDelta')) === 0.0001);
calcItem('Precision as displayed', 'kept', '§18.2.2 calcPr@fullPrecision', (c) => c?.getAttribute('fullPrecision') === '0');
calcItem('Recalculate before saving off', 'kept', '§18.2.2 calcPr@calcOnSave', (c) => c?.getAttribute('calcOnSave') === '0');
book.wb.workbookPr = '<workbookPr filterPrivacy="1" codeName="ThisWorkbook" defaultThemeVersion="166925"/>';
const wbpr = clc('Workbook option filterPrivacy (remove personal information)', 'loss', '§18.2.28 workbookPr@filterPrivacy; File ▸ Options ▸ Trust Center ▸ Privacy', (v) => isOn(kid(wbRoot(v), 'x:workbookPr')?.getAttribute('filterPrivacy')), 'xlsx.ts:1128 (only date1904 and codeName written)');
sh.item(wbpr, 'Workbook option filterPrivacy (remove personal information)');
const code = clc('Workbook code name (ThisWorkbook) without macros', 'loss', '§18.2.28 workbookPr@codeName', (v) => kid(wbRoot(v), 'x:workbookPr')?.getAttribute('codeName') === 'ThisWorkbook', 'xlsx.ts:1128 (codeName only with macros)');
sh.item(code, 'Workbook code name (ThisWorkbook) without macros');

let bytes: Uint8Array | undefined;
export const xlsxFormulas: Sampler = {
  name: 'xlsx-formulas.xlsx', area: 'Excel formulas, cached values, defined names, external links, calculation settings', items,
  build: () => {
    if (bytes) return bytes;
    // the metadata a dynamic array formula's cm points at (MS-XLSX 2.3.2), as Excel writes it
    book.wbPart('metadata.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><metadata xmlns="${X_MAIN}" xmlns:xda="${XDA}">`
      + '<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>'
      + '<futureMetadata name="XLDAPR" count="1"><bk><extLst><ext uri="{bdbb8cdc-fa1e-496e-a857-3c3f30c029c3}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext></extLst></bk></futureMetadata>'
      + '<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>', XCT.metadata, XREL.metadata);
    return (bytes = book.build('Excel sampler: formulas and names'));
  },
};
