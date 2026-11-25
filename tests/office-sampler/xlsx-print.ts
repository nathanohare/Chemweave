/**
 * Excel sampler: page setup and printing (X-PRT), and sheet and workbook protection (X-PRO). Each
 * item is a sheet of its own (page setup and protection belong to a sheet), named by its id; the
 * workbook's protection is checked on the workbook.
 * ECMA-376 Part 1 §18.3.1.63 pageSetup (paperSize §18.18.? codes), §18.3.1.62 pageMargins,
 * §18.3.1.70 printOptions, §18.3.1.46 headerFooter (codes §18.3.1.36), §18.3.1.74 rowBreaks,
 * §18.3.1.14 colBreaks, §18.2.6 _xlnm.Print_Area / Print_Titles, §18.3.1.85 sheetProtection,
 * §18.3.1.71 protectedRanges, §18.2.29 workbookProtection, §18.2.12 fileSharing; Excel's Page
 * Layout ▸ Page Setup dialog, Review ▸ Protect Sheet / Protect Workbook / Allow Edit Ranges.
 *
 * Tags from src/io/xlsx-print.ts readPageSetup (:112) and pageSetupXml (:19): paper sizes in
 * SHEET_PAPERS (page-setup.ts:52) only; dpi, black and white, draft, comments, errors and copies
 * not kept; odd and first headers and footers kept with their codes as text, even ones not;
 * src/io/xlsx-view.ts readSheetKept (:320: sheetProtection with the attributes in SHEET_PROTECTION,
 * protectedRanges) and readBookKept (:384: workbookProtection and fileSharing, as written).
 */
import { type Item, type Sampler, type View, itemList, kid } from './kit';
import { Book, type SheetB, wsOf, sheetOf, definedNames, wbRoot, xKids, isOn } from './xlsx';

const items: Item[] = [];
const book = new Book();
type Tag = 'supported' | 'kept' | 'loss';

/** A sheet-level item: its own sheet (with some data to print), set up by `setup`; checked on its worksheet. */
function sheetItem(it: ReturnType<typeof itemList>, feature: string, short: string, tag: Tag, spec: string, setup: (s: SheetB, id: string) => void, check: (ws: Element | undefined, v: View, id: string) => boolean, basis?: string): string {
  const id = it(feature, tag, spec, (v) => check(wsOf(v, id), v, id), basis);
  const s = book.sheet(`${id} ${short}`.slice(0, 31));
  s.item(id, feature);
  for (let r = 2; r <= 40; r++) for (let c = 0; c < 6; c++) s.num(`${'ABCDEF'[c]}${r + 1}`, r * 10 + c);
  setup(s, id);
  return id;
}
const ps = (ws: Element | undefined) => kid(ws, 'x:pageSetup');
const hf = (ws: Element | undefined, part: string) => kid(kid(ws, 'x:headerFooter'), `x:${part}`)?.textContent ?? null;
const sheetIndex = (v: View, id: string) => sheetOf(v, id)?.index;
const nameFor = (v: View, id: string, name: string) => definedNames(v).find((d) => d.getAttribute('name') === name && d.getAttribute('localSheetId') === String(sheetIndex(v, id)))?.textContent?.replace(/\s/g, '') ?? null;

// ---------------------------------------------------------------------------------------------
// Page setup (X-PRT)

const prt = itemList('X-PRT', items);
const P = '§18.3.1.63 pageSetup; Page Layout ▸ Page Setup';
const page = (attrs: string) => (s: SheetB) => s.set('pageSetup', `<pageSetup ${attrs}/>`);
for (const [code, name, tag] of [[9, 'A4', 'supported'], [5, 'Legal', 'supported'], [8, 'A3', 'supported'], [11, 'A5', 'supported'], [3, 'Tabloid', 'supported'], [13, 'B5 (JIS)', 'loss'], [20, 'Envelope #10', 'loss']] as [number, string, Tag][]) {
  sheetItem(prt, `Paper size ${name} (${code})`, `Paper ${name}`, tag, `${P}@paperSize; Page Setup ▸ Paper size`, page(`paperSize="${code}" orientation="portrait"`),
    (ws) => ps(ws)?.getAttribute('paperSize') === String(code), tag === 'loss' ? 'page-setup.ts:52 SHEET_PAPERS (other sizes not read)' : 'xlsx-print.ts:132');
}
sheetItem(prt, 'Landscape', 'Landscape', 'supported', `${P}@orientation; Page Layout ▸ Orientation`, page('paperSize="1" orientation="landscape"'), (ws) => ps(ws)?.getAttribute('orientation') === 'landscape');
sheetItem(prt, 'Scale 75%', 'Scale 75', 'supported', `${P}@scale; Page Setup ▸ Adjust to`, page('scale="75" orientation="portrait"'), (ws) => ps(ws)?.getAttribute('scale') === '75');
sheetItem(prt, 'Fit to 1 page wide by any tall', 'Fit wide', 'supported', `${P}@fitToWidth, @fitToHeight, §18.3.1.65 pageSetUpPr@fitToPage; Page Setup ▸ Fit to`,
  (s) => { s.set('sheetPr', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'); s.set('pageSetup', '<pageSetup fitToWidth="1" fitToHeight="0" orientation="portrait"/>'); },
  (ws) => isOn(kid(ws, 'x:sheetPr/x:pageSetUpPr')?.getAttribute('fitToPage')) && (ps(ws)?.getAttribute('fitToWidth') ?? '1') === '1' && ps(ws)?.getAttribute('fitToHeight') === '0');
sheetItem(prt, 'Fit to 2 by 3 pages', 'Fit 2x3', 'supported', `${P}@fitToWidth, @fitToHeight`,
  (s) => { s.set('sheetPr', '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'); s.set('pageSetup', '<pageSetup fitToWidth="2" fitToHeight="3" orientation="portrait"/>'); },
  (ws) => ps(ws)?.getAttribute('fitToWidth') === '2' && ps(ws)?.getAttribute('fitToHeight') === '3');
sheetItem(prt, 'Page order over, then down', 'Over then down', 'supported', `${P}@pageOrder; Page Setup ▸ Sheet ▸ Page order`, page('pageOrder="overThenDown" orientation="portrait"'), (ws) => ps(ws)?.getAttribute('pageOrder') === 'overThenDown');
sheetItem(prt, 'First page number 5', 'First page 5', 'supported', `${P}@firstPageNumber, @useFirstPageNumber`, page('firstPageNumber="5" orientation="portrait" useFirstPageNumber="1"'),
  (ws) => ps(ws)?.getAttribute('firstPageNumber') === '5' && isOn(ps(ws)?.getAttribute('useFirstPageNumber')));
sheetItem(prt, 'Margins wide (1 in) with header and footer 0.5 in', 'Margins', 'supported', '§18.3.1.62 pageMargins; Page Layout ▸ Margins ▸ Wide',
  (s) => s.set('pageMargins', '<pageMargins left="1" right="1" top="1" bottom="1" header="0.5" footer="0.5"/>'),
  (ws) => { const m = kid(ws, 'x:pageMargins'); return ['left', 'right', 'top', 'bottom'].every((a) => Number(m?.getAttribute(a)) === 1) && Number(m?.getAttribute('header')) === 0.5 && Number(m?.getAttribute('footer')) === 0.5; });
sheetItem(prt, 'Margins custom and uneven', 'Margins uneven', 'supported', '§18.3.1.62 pageMargins; Page Setup ▸ Margins',
  (s) => s.set('pageMargins', '<pageMargins left="0.25" right="1.5" top="0.4" bottom="2" header="0.1" footer="0.9"/>'),
  (ws) => { const m = kid(ws, 'x:pageMargins'); return Number(m?.getAttribute('left')) === 0.25 && Number(m?.getAttribute('bottom')) === 2 && Number(m?.getAttribute('footer')) === 0.9; });
sheetItem(prt, 'Center on page horizontally and vertically', 'Centered', 'supported', '§18.3.1.70 printOptions@horizontalCentered, @verticalCentered; Page Setup ▸ Margins ▸ Center on page',
  (s) => s.set('printOptions', '<printOptions horizontalCentered="1" verticalCentered="1"/>'),
  (ws) => isOn(kid(ws, 'x:printOptions')?.getAttribute('horizontalCentered')) && isOn(kid(ws, 'x:printOptions')?.getAttribute('verticalCentered')));
sheetItem(prt, 'Print gridlines and headings', 'Gridlines', 'supported', '§18.3.1.70 printOptions@gridLines, @headings; Page Layout ▸ Sheet Options ▸ Print',
  (s) => s.set('printOptions', '<printOptions headings="1" gridLines="1"/>'),
  (ws) => isOn(kid(ws, 'x:printOptions')?.getAttribute('gridLines')) && isOn(kid(ws, 'x:printOptions')?.getAttribute('headings')));
for (const [attr, value, what] of [['blackAndWhite', '1', 'Black and white'], ['draft', '1', 'Draft quality'], ['cellComments', 'atEnd', 'Comments at end of sheet'], ['errors', 'blank', 'Cell errors as blank'], ['copies', '2', 'Two copies'], ['horizontalDpi', '300', 'Print quality 300 dpi']] as [string, string, string][]) {
  sheetItem(prt, what, what, 'loss', `${P}@${attr}; Page Setup ▸ Sheet / Page`, page(`orientation="landscape" ${attr}="${value}"`), (ws) => ps(ws)?.getAttribute(attr) === value, 'xlsx-print.ts:24 (not written)');
}
// headers and footers: Excel's codes (§18.3.1.36): &L &C &R sections, &P page, &N pages, &D date, &T time, &F file, &A sheet, &Z path, &"font,style", &nn size, &K color, &B &I &U
const H = '§18.3.1.46 headerFooter, §18.3.1.36 (codes); Page Setup ▸ Header/Footer';
const HEAD = '&L&"Arial,Bold"&14Left title&C&P of &N&R&D &T';
sheetItem(prt, 'Header with sections, font, size, page number, date and time', 'Header codes', 'supported', H, (s) => s.set('headerFooter', `<headerFooter><oddHeader>${HEAD.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}</oddHeader></headerFooter>`),
  (ws) => hf(ws, 'oddHeader') === HEAD, 'xlsx-print.ts:155 readHeaderFooter, page-setup.ts:279');
const FOOT = '&L&F&C&A&R&KC8553D&B&IConfidential&B&I';
sheetItem(prt, 'Footer with file, sheet, color and bold italic', 'Footer codes', 'supported', H, (s) => s.set('headerFooter', `<headerFooter><oddFooter>${FOOT.replace(/&/g, '&amp;')}</oddFooter></headerFooter>`),
  (ws) => hf(ws, 'oddFooter') === FOOT);
sheetItem(prt, 'Footer with the file path (&Z&F) and underline', 'Footer path', 'supported', H, (s) => s.set('headerFooter', '<headerFooter><oddFooter>&amp;C&amp;Z&amp;F &amp;Udone</oddFooter></headerFooter>'),
  (ws) => hf(ws, 'oddFooter') === '&C&Z&F &Udone');
sheetItem(prt, 'Different first page header and footer', 'First page', 'supported', `${H}@differentFirst`,
  (s) => s.set('headerFooter', '<headerFooter differentFirst="1"><oddHeader>&amp;CEvery page</oddHeader><firstHeader>&amp;CFirst page only</firstHeader><firstFooter>&amp;RPage &amp;P</firstFooter></headerFooter>'),
  (ws) => isOn(kid(ws, 'x:headerFooter')?.getAttribute('differentFirst')) && hf(ws, 'firstHeader') === '&CFirst page only' && hf(ws, 'firstFooter') === '&RPage &P');
sheetItem(prt, 'Different odd and even pages', 'Odd even', 'loss', `${H}@differentOddEven`,
  (s) => s.set('headerFooter', '<headerFooter differentOddEven="1"><oddHeader>&amp;ROdd page</oddHeader><evenHeader>&amp;LEven page</evenHeader></headerFooter>'),
  (ws) => isOn(kid(ws, 'x:headerFooter')?.getAttribute('differentOddEven')) && hf(ws, 'evenHeader') === '&LEven page', 'xlsx-print.ts:37 (even header not written)');
sheetItem(prt, 'Header not scaled with the document, not aligned to margins', 'HF scale', 'loss', `${H}@scaleWithDoc, @alignWithMargins`,
  (s) => s.set('headerFooter', '<headerFooter scaleWithDoc="0" alignWithMargins="0"><oddHeader>&amp;CFixed header</oddHeader></headerFooter>'),
  (ws) => kid(ws, 'x:headerFooter')?.getAttribute('scaleWithDoc') === '0' && kid(ws, 'x:headerFooter')?.getAttribute('alignWithMargins') === '0', 'xlsx-print.ts:37');
sheetItem(prt, 'Header with an ampersand (&&)', 'Ampersand', 'supported', H, (s) => s.set('headerFooter', '<headerFooter><oddHeader>&amp;CSmith &amp;&amp; Jones</oddHeader></headerFooter>'),
  (ws) => hf(ws, 'oddHeader') === '&CSmith && Jones');
// print area and titles
const N = '§18.2.6 built-in names _xlnm.Print_Area, _xlnm.Print_Titles; Page Layout ▸ Print Area / Print Titles';
sheetItem(prt, 'Print area', 'Print area', 'supported', N, (s) => book.name('_xlnm.Print_Area', `'${s.name}'!$A$1:$D$20`, `localSheetId="${s.index}"`),
  (_, v, id) => (nameFor(v, id, '_xlnm.Print_Area') ?? '').endsWith('!$A$1:$D$20'), 'xlsx-print.ts:166, :56 printNames');
sheetItem(prt, 'Print area of two ranges', 'Print area 2', 'supported', N, (s) => book.name('_xlnm.Print_Area', `'${s.name}'!$A$1:$B$10,'${s.name}'!$D$12:$E$20`, `localSheetId="${s.index}"`),
  (_, v, id) => (nameFor(v, id, '_xlnm.Print_Area') ?? '').split(',').length === 2);
sheetItem(prt, 'Rows to repeat at top', 'Title rows', 'supported', N, (s) => book.name('_xlnm.Print_Titles', `'${s.name}'!$1:$2`, `localSheetId="${s.index}"`),
  (_, v, id) => (nameFor(v, id, '_xlnm.Print_Titles') ?? '').endsWith('!$1:$2'));
sheetItem(prt, 'Columns to repeat at left and rows at top', 'Title rows cols', 'supported', N, (s) => book.name('_xlnm.Print_Titles', `'${s.name}'!$A:$A,'${s.name}'!$1:$1`, `localSheetId="${s.index}"`),
  (_, v, id) => { const t = nameFor(v, id, '_xlnm.Print_Titles') ?? ''; return /!\$A:\$A/.test(t) && /!\$1:\$1$/.test(t); });
// page breaks
sheetItem(prt, 'Manual page break after row 20', 'Row break', 'supported', '§18.3.1.74 rowBreaks, §18.3.1.3 brk; Page Layout ▸ Breaks ▸ Insert Page Break',
  (s) => s.set('rowBreaks', '<rowBreaks count="1" manualBreakCount="1"><brk id="20" max="16383" man="1"/></rowBreaks>'),
  (ws) => xKids(kid(ws, 'x:rowBreaks'), 'brk').some((b) => b.getAttribute('id') === '20' && isOn(b.getAttribute('man'))), 'xlsx-print.ts:168');
sheetItem(prt, 'Manual page break after column C', 'Column break', 'supported', '§18.3.1.14 colBreaks',
  (s) => s.set('colBreaks', '<colBreaks count="1" manualBreakCount="1"><brk id="3" max="1048575" man="1"/></colBreaks>'),
  (ws) => xKids(kid(ws, 'x:colBreaks'), 'brk').some((b) => b.getAttribute('id') === '3'));

// ---------------------------------------------------------------------------------------------
// Protection (X-PRO): Review ▸ Protect

const pro = itemList('X-PRO', items);
const sp = (ws: Element | undefined) => kid(ws, 'x:sheetProtection');
const HASH = 'algorithmName="SHA-512" hashValue="kU7fW4VZqKJ3m5Vwq3xVY0g3m2l8wR8Zr3pG+Q7xk5w1nS0d6bH6e8q2JvQx1y4d1p9c6sYkVh3n2m5Q9t8u1A==" saltValue="m3F6kq1rY8x2VZb4c7d9eA==" spinCount="100000"';
sheetItem(pro, 'Protect sheet with a password (SHA-512)', 'Protected', 'kept', '§18.3.1.85 sheetProtection; Review ▸ Protect Sheet',
  (s) => s.set('sheetProtection', `<sheetProtection ${HASH} sheet="1" objects="1" scenarios="1"/>`),
  (ws) => isOn(sp(ws)?.getAttribute('sheet')) && sp(ws)?.getAttribute('algorithmName') === 'SHA-512' && !!sp(ws)?.getAttribute('hashValue') && sp(ws)?.getAttribute('spinCount') === '100000', 'xlsx-view.ts:358 SHEET_PROTECTION');
sheetItem(pro, 'Protect sheet, legacy password', 'Protected legacy', 'kept', '§18.3.1.85 sheetProtection@password', (s) => s.set('sheetProtection', '<sheetProtection password="CC1A" sheet="1"/>'),
  (ws) => sp(ws)?.getAttribute('password') === 'CC1A');
sheetItem(pro, 'Protected sheet allowing formatting, sorting and filtering', 'Protected allow', 'kept', '§18.3.1.85 sheetProtection@formatCells… (Allow all users of this worksheet to)',
  (s) => s.set('sheetProtection', '<sheetProtection sheet="1" formatCells="0" formatColumns="0" formatRows="0" insertRows="0" sort="0" autoFilter="0" selectLockedCells="1"/>'),
  (ws) => ['formatCells', 'formatColumns', 'formatRows', 'insertRows', 'sort', 'autoFilter'].every((a) => sp(ws)?.getAttribute(a) === '0') && isOn(sp(ws)?.getAttribute('selectLockedCells')));
sheetItem(pro, 'Allow edit ranges (protectedRanges)', 'Edit ranges', 'kept', '§18.3.1.71 protectedRanges, §18.3.1.70 protectedRange; Review ▸ Allow Edit Ranges',
  (s) => { s.set('sheetProtection', '<sheetProtection sheet="1"/>'); s.set('protectedRanges', '<protectedRanges><protectedRange sqref="B3:C10" name="SamplerRange"/></protectedRanges>'); },
  (ws) => xKids(kid(ws, 'x:protectedRanges'), 'protectedRange').some((r) => r.getAttribute('name') === 'SamplerRange' && r.getAttribute('sqref') === 'B3:C10'), 'xlsx-view.ts:328');
book.wb.workbookProtection = `<workbookProtection workbookAlgorithmName="SHA-512" workbookHashValue="kU7fW4VZqKJ3m5Vwq3xVY0g3m2l8wR8Zr3pG+Q7xk5w1nS0d6bH6e8q2JvQx1y4d1p9c6sYkVh3n2m5Q9t8u1A==" workbookSaltValue="m3F6kq1rY8x2VZb4c7d9eA==" workbookSpinCount="100000" lockStructure="1" lockWindows="1"/>`;
book.wb.fileSharing = '<fileSharing readOnlyRecommended="1" userName="Sampler"/>';
const wbItem = (feature: string, tag: Tag, spec: string, check: (wb: Element | undefined) => boolean, basis = 'xlsx-view.ts:384 readBookKept') => {
  const id = pro(feature, tag, spec, (v) => check(wbRoot(v)), basis);
  const s = book.sheets.find((x) => x.name.startsWith('X-PRO-01'))!;
  s.item(id, feature);
};
wbItem('Protect workbook structure (password)', 'kept', '§18.2.29 workbookProtection@lockStructure; Review ▸ Protect Workbook', (wb) => isOn(kid(wb, 'x:workbookProtection')?.getAttribute('lockStructure')) && !!kid(wb, 'x:workbookProtection')?.getAttribute('workbookHashValue'));
wbItem('Protect workbook windows', 'kept', '§18.2.29 workbookProtection@lockWindows', (wb) => isOn(kid(wb, 'x:workbookProtection')?.getAttribute('lockWindows')));
wbItem('Read-only recommended (fileSharing)', 'kept', '§18.2.12 fileSharing@readOnlyRecommended; Save As ▸ Tools ▸ General Options', (wb) => isOn(kid(wb, 'x:fileSharing')?.getAttribute('readOnlyRecommended')));

let bytes: Uint8Array | undefined;
export const xlsxPrint: Sampler = {
  name: 'xlsx-print.xlsx', area: 'Excel page setup and printing, sheet and workbook protection', items,
  build: () => (bytes ??= book.build('Excel sampler: printing and protection')),
};
