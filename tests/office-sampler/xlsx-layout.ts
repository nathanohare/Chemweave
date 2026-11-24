/**
 * Excel sampler: sheet layout and views (X-LAY). Merged cells, column widths and row heights,
 * hidden and grouped (outlined) rows and columns on one sheet, one row per item; frozen and split
 * panes, zoom, gridlines, headings, right-to-left, views, hidden sheets and tab colors each on a
 * sheet of their own whose name starts with the item's id. ECMA-376 Part 1 §18.3.1 (worksheet:
 * §18.3.1.55 mergeCell, §18.3.1.13 col, §18.3.1.73 row, §18.3.1.66 pane, §18.3.1.87 sheetView,
 * §18.3.1.81 sheetFormatPr), §18.2.19 sheet (state), §18.3.1.93 tabColor; Excel's Home ▸ Format,
 * Data ▸ Group, View ▸ Freeze Panes / Split / Zoom / Show, and the sheet tab's menu.
 *
 * Tags from src/io/xlsx.ts readXlsx (:1700-1870) and writeBook (:620-1060), xlsx-view.ts
 * (readSheetViewOpts :43, VIEW_KEPT :356, readSheetKept :320): hidden and very hidden sheets are
 * shown (:1601, the writer has no sheet state); split panes are put at the nearest row and column
 * edges (:1862); a second sheetView is not read.
 */
import { type Item, type Sampler, type View, itemList, kid } from './kit';
import { Book, type SheetB, rowOf, wsOf, sheetOf, sheetList, xKids, colNumber, isOn, fontOf, lookOf, lookOfXf, onX, wbRoot, colorHex } from './xlsx';

const items: Item[] = [];
const it = itemList('X-LAY', items);
const book = new Book();
const sh = book.sheet('Layout');
type Tag = 'supported' | 'kept' | 'loss';

// ---------------------------------------------------------------------------------------------
// On the Layout sheet: one row per item

const L = sh;
L.set('sheetViews', '<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
const mergesOf = (_v: View, sheetRoot?: Element) => xKids(kid(sheetRoot, 'x:mergeCells'), 'mergeCell').map((m) => m.getAttribute('ref'));
const layoutRoot = (v: View) => sheetList(v).find((s) => s.name === 'Layout')?.root;
/** An item on the Layout sheet, checked on its row (the row element and its number from 1). */
function rowItem(feature: string, tag: Tag, spec: string, check: (v: View, row: Element, n: number) => boolean, basis?: string): string {
  const id = it(feature, tag, spec, (v) => { const f = rowOf(v, id); return !!f && check(v, f.row, f.r + 1); }, basis);
  return id;
}

let id = rowItem('Merge across (B:D)', 'supported', '§18.3.1.55 mergeCell; Home ▸ Merge & Center ▸ Merge Across', (v, _, n) => mergesOf(v, layoutRoot(v)).includes(`B${n}:D${n}`), 'xlsx.ts:1840');
const merges: string[] = [];
let r = L.item(id, 'Merge across (B:D)', 'merged text');
merges.push(`B${r + 1}:D${r + 1}`);
id = rowItem('Merge a 2×2 block (B:C, two rows)', 'supported', '§18.3.1.55 mergeCell; Home ▸ Merge Cells', (v, _, n) => mergesOf(v, layoutRoot(v)).includes(`B${n}:C${n + 1}`));
r = L.item(id, 'Merge a 2×2 block (B:C, two rows)', 'block');
merges.push(`B${r + 1}:C${r + 2}`);
L.next++;
id = rowItem('Merge & Center', 'supported', '§18.3.1.55 mergeCell, §18.8.1 alignment center; Home ▸ Merge & Center', (v, row, n) => {
  const c = xKids(row, 'c').find((x) => x.getAttribute('r') === `B${n}`);
  return mergesOf(v, layoutRoot(v)).includes(`B${n}:E${n}`) && lookOf(v, c).alignment?.getAttribute('horizontal') === 'center';
});
r = L.item(id, 'Merge & Center', 'centered', book.styles.xf({ align: 'horizontal="center"' }));
merges.push(`B${r + 1}:E${r + 1}`);
L.set('mergeCells', `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);

// rows
const rowAttr = (row: Element, a: string) => row.getAttribute(a);
id = rowItem('Row height 30 pt', 'supported', '§18.3.1.73 row@ht, @customHeight; Home ▸ Format ▸ Row Height', (_, row) => Number(rowAttr(row, 'ht')) === 30 && isOn(rowAttr(row, 'customHeight')));
r = L.item(id, 'Row height 30 pt'); L.row(r, 'ht="30" customHeight="1"');
id = rowItem('Row height 8.25 pt (small)', 'supported', '§18.3.1.73 row@ht', (_, row) => Math.abs(Number(rowAttr(row, 'ht')) - 8.25) < 0.01 && isOn(rowAttr(row, 'customHeight')));
r = L.item(id, 'Row height 8.25 pt (small)'); L.row(r, 'ht="8.25" customHeight="1"');
id = rowItem('Row height fitted by Excel (no customHeight)', 'supported', '§18.3.1.73 row@ht without customHeight (AutoFit)', (_, row) => Number(rowAttr(row, 'ht')) === 45, 'xlsx.ts:1748 fitted rows, :876');
r = L.item(id, 'Row height fitted by Excel (no customHeight)', 'three\nlines\nof text', book.styles.xf({ align: 'wrapText="1"' })); L.row(r, 'ht="45"');
id = rowItem('Hidden row', 'supported', '§18.3.1.73 row@hidden; Home ▸ Format ▸ Hide Rows', (_, row) => isOn(rowAttr(row, 'hidden')));
r = L.item(id, 'Hidden row'); L.row(r, 'hidden="1"');
id = rowItem('Row outline level 1 (grouped)', 'supported', '§18.3.1.73 row@outlineLevel; Data ▸ Group ▸ Rows', (_, row) => rowAttr(row, 'outlineLevel') === '1');
r = L.item(id, 'Row outline level 1 (grouped)'); L.row(r, 'outlineLevel="1"');
id = rowItem('Row outline level 2 (nested group)', 'supported', '§18.3.1.73 row@outlineLevel', (_, row) => rowAttr(row, 'outlineLevel') === '2');
r = L.item(id, 'Row outline level 2 (nested group)'); L.row(r, 'outlineLevel="2"');
L.row(L.next++, 'outlineLevel="1"');
// a collapsed group: two hidden detail rows, then the summary row (the item) marked collapsed
L.row(L.next++, 'outlineLevel="1" hidden="1"');
L.row(L.next++, 'outlineLevel="1" hidden="1"');
id = rowItem('Collapsed row group (summary below)', 'supported', '§18.3.1.73 row@collapsed; Data ▸ Hide Detail', (v, row, n) => {
  const rows = xKids(kid(layoutRoot(v), 'x:sheetData'), 'row');
  const at2 = (k: number) => rows.find((x) => x.getAttribute('r') === String(k));
  return isOn(rowAttr(row, 'collapsed')) && [n - 1, n - 2].every((k) => isOn(at2(k)?.getAttribute('hidden')) && at2(k)?.getAttribute('outlineLevel') === '1');
}, 'xlsx-view.ts:77 outlineAttrs (collapsed recomputed)');
L.item(id, 'Collapsed row group (summary below)'); L.row(L.next - 1, 'collapsed="1"');
id = rowItem('Row format (whole row styled: s, customFormat)', 'loss', '§18.3.1.73 row@s, @customFormat; select a row ▸ Format Cells', (v, row) => isOn(rowAttr(row, 'customFormat')) && onX(lookOf(v, row).font, 'b'), 'xlsx.ts:877 (row s not written)');
r = L.item(id, 'Row format (whole row styled: s, customFormat)'); L.row(r, `s="${book.styles.xf({ font: fontOf('<b/>') })}" customFormat="1"`);
id = rowItem('Thick bottom border flag (thickBot)', 'loss', '§18.3.1.73 row@thickBot', (_, row) => isOn(rowAttr(row, 'thickBot')), 'xlsx.ts:877 (not written)');
r = L.item(id, 'Thick bottom border flag (thickBot)'); L.row(r, 'thickBot="1"');

// columns: E onwards, each checked on the col element that covers it
const colEl = (v: View, letter: string) => {
  const c = colNumber(letter) + 1;
  return xKids(kid(layoutRoot(v), 'x:cols'), 'col').find((x) => Number(x.getAttribute('min')) <= c && Number(x.getAttribute('max')) >= c);
};
const colItem = (feature: string, tag: Tag, spec: string, letter: string, check: (col: Element | undefined, v: View) => boolean, basis?: string) => {
  const i = it(`${feature} (column ${letter})`, tag, spec, (v) => check(colEl(v, letter), v), basis);
  L.item(i, `${feature} (column ${letter})`);
};
colItem('Column width 25', 'supported', '§18.3.1.13 col@width, @customWidth; Home ▸ Format ▸ Column Width', 'F', (c) => Math.abs(Number(c?.getAttribute('width')) - 25) < 0.05 && isOn(c?.getAttribute('customWidth')), 'xlsx.ts:1706, :153 widthFromPx');
colItem('Column width 3.5 (narrow)', 'supported', '§18.3.1.13 col@width', 'G', (c) => Math.abs(Number(c?.getAttribute('width')) - 3.5) < 0.1);
colItem('Hidden column', 'supported', '§18.3.1.13 col@hidden; Home ▸ Format ▸ Hide Columns', 'H', (c) => isOn(c?.getAttribute('hidden')));
colItem('Column outline level 1', 'supported', '§18.3.1.13 col@outlineLevel; Data ▸ Group ▸ Columns', 'I', (c) => c?.getAttribute('outlineLevel') === '1');
colItem('Column outline level 2', 'supported', '§18.3.1.13 col@outlineLevel', 'J', (c) => c?.getAttribute('outlineLevel') === '2');
colItem('Collapsed column group (summary right)', 'supported', '§18.3.1.13 col@collapsed', 'N', (c, v) => isOn(c?.getAttribute('collapsed')) && ['L', 'M'].every((x) => isOn(colEl(v, x)?.getAttribute('hidden')) && colEl(v, x)?.getAttribute('outlineLevel') === '1'), 'xlsx-view.ts:77');
colItem('Column best fit flag', 'loss', '§18.3.1.13 col@bestFit (AutoFit Column Width)', 'O', (c) => isOn(c?.getAttribute('bestFit')), 'xlsx.ts:897 (not written)');
colItem('Column format (whole column bold)', 'supported', '§18.3.1.13 col@style', 'P', (c, v) => onX(lookOfXf(v, c?.getAttribute('style')).font, 'b'), 'xlsx.ts:1714 setColStyle');
L.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/><col min="6" max="6" width="25" customWidth="1"/><col min="7" max="7" width="3.5" customWidth="1"/>'
  + '<col min="8" max="8" width="9.140625" hidden="1"/><col min="9" max="9" width="9.140625" outlineLevel="1"/><col min="10" max="10" width="9.140625" outlineLevel="2"/>'
  + '<col min="11" max="11" width="9.140625" outlineLevel="1"/><col min="12" max="13" width="9.140625" hidden="1" outlineLevel="1"/><col min="14" max="14" width="9.140625" collapsed="1"/>'
  + `<col min="15" max="15" width="12.7109375" bestFit="1" customWidth="1"/><col min="16" max="16" width="9.140625" style="${book.styles.xf({ font: fontOf('<b/>') })}"/></cols>`);
L.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="15" outlineLevelRow="2" outlineLevelCol="2" x14ac:dyDescent="0.25"/>');
const lvl = it('Outline levels on the sheet (outlineLevelRow/Col)', 'supported', '§18.3.1.81 sheetFormatPr@outlineLevelRow, @outlineLevelCol', (v) => {
  const f = kid(layoutRoot(v), 'x:sheetFormatPr');
  return f?.getAttribute('outlineLevelRow') === '2' && f?.getAttribute('outlineLevelCol') === '2';
}, 'xlsx-view.ts:69 outlineLevelAttrs');
L.item(lvl, 'Outline levels on the sheet (outlineLevelRow/Col)');

// ---------------------------------------------------------------------------------------------
// Sheet-level items: each on a sheet of its own

/** A sheet-level item: a sheet named `<id> <short>`, set up by `setup`, checked on the item's worksheet. */
function sheetItem(feature: string, short: string, tag: Tag, spec: string, setup: (s: SheetB) => void, check: (ws: Element | undefined, v: View, id: string) => boolean, basis?: string, state?: 'hidden' | 'veryHidden'): string {
  const i = it(feature, tag, spec, (v) => check(wsOf(v, i), v, i), basis);
  const s = book.sheet(`${i} ${short}`.slice(0, 31), state);
  s.item(i, feature);
  for (let k = 0; k < 30; k++) s.num(`B${k + 3}`, k + 1);
  setup(s);
  return i;
}
const view = (s: SheetB, attrs: string, inner = '') => s.set('sheetViews', `<sheetViews><sheetView ${attrs} workbookViewId="0"${inner ? `>${inner}</sheetView>` : '/>'}</sheetViews>`);
const sv = (ws: Element | undefined) => kid(ws, 'x:sheetViews/x:sheetView');
const pane = (ws: Element | undefined) => kid(sv(ws), 'x:pane');

sheetItem('Freeze top row', 'Freeze row', 'supported', '§18.3.1.66 pane@state frozen; View ▸ Freeze Panes ▸ Freeze Top Row',
  (s) => view(s, '', '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'),
  (ws) => pane(ws)?.getAttribute('state') === 'frozen' && pane(ws)?.getAttribute('ySplit') === '1' && !pane(ws)?.getAttribute('xSplit'), 'xlsx.ts:1859');
sheetItem('Freeze first column', 'Freeze column', 'supported', '§18.3.1.66 pane; View ▸ Freeze Panes ▸ Freeze First Column',
  (s) => view(s, '', '<pane xSplit="1" topLeftCell="B1" activePane="topRight" state="frozen"/><selection pane="topRight" activeCell="B1" sqref="B1"/>'),
  (ws) => pane(ws)?.getAttribute('state') === 'frozen' && pane(ws)?.getAttribute('xSplit') === '1' && !pane(ws)?.getAttribute('ySplit'));
sheetItem('Freeze panes at C3 (rows and columns)', 'Freeze C3', 'supported', '§18.3.1.66 pane; View ▸ Freeze Panes',
  (s) => view(s, '', '<pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"/><selection pane="topRight" activeCell="C1" sqref="C1"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/><selection pane="bottomRight" activeCell="C3" sqref="C3"/>'),
  (ws) => pane(ws)?.getAttribute('state') === 'frozen' && pane(ws)?.getAttribute('xSplit') === '2' && pane(ws)?.getAttribute('ySplit') === '2');
sheetItem('Frozen pane scrolled (topLeftCell C10)', 'Frozen scrolled', 'kept', '§18.3.1.66 pane@topLeftCell',
  (s) => view(s, '', '<pane ySplit="2" topLeftCell="A10" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B12" sqref="B12"/>'),
  (ws) => pane(ws)?.getAttribute('topLeftCell') === 'A10', 'xlsx-view.ts:376 keptPanes');
sheetItem('Split panes (not frozen)', 'Split', 'loss', '§18.3.1.66 pane xSplit/ySplit in twips; View ▸ Split',
  (s) => view(s, '', '<pane xSplit="2340" ySplit="1200" topLeftCell="C5" activePane="bottomRight"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="C5" sqref="C5"/>'),
  (ws) => !pane(ws)?.getAttribute('state') && pane(ws)?.getAttribute('xSplit') === '2340' && pane(ws)?.getAttribute('ySplit') === '1200', 'xlsx.ts:1862 (put at the nearest row and column edges), :913');
sheetItem('Split panes stay split', 'Split kept', 'supported', '§18.3.1.66 pane (split); View ▸ Split',
  (s) => view(s, '', '<pane xSplit="2340" ySplit="1200" topLeftCell="C5" activePane="bottomRight"/><selection pane="bottomRight" activeCell="C5" sqref="C5"/>'),
  (ws) => !!pane(ws) && !pane(ws)?.getAttribute('state') && Number(pane(ws)?.getAttribute('xSplit')) > 0 && Number(pane(ws)?.getAttribute('ySplit')) > 0, 'xlsx.ts:1862 setSplit, :913');
for (const z of [150, 50, 400]) {
  sheetItem(`Zoom ${z}%`, `Zoom ${z}`, 'supported', '§18.3.1.87 sheetView@zoomScale; View ▸ Zoom', (s) => view(s, `zoomScale="${z}" zoomScaleNormal="${z}"`),
    (ws) => sv(ws)?.getAttribute('zoomScale') === String(z), 'xlsx-view.ts:51');
}
sheetItem('Gridlines hidden', 'No gridlines', 'supported', '§18.3.1.87 sheetView@showGridLines; View ▸ Show ▸ Gridlines', (s) => view(s, 'showGridLines="0"'), (ws) => sv(ws)?.getAttribute('showGridLines') === '0');
sheetItem('Headings hidden', 'No headings', 'supported', '§18.3.1.87 sheetView@showRowColHeaders; View ▸ Show ▸ Headings', (s) => view(s, 'showRowColHeaders="0"'), (ws) => sv(ws)?.getAttribute('showRowColHeaders') === '0');
sheetItem('Zero values hidden', 'No zeros', 'supported', '§18.3.1.87 sheetView@showZeros; File ▸ Options ▸ Advanced ▸ Show a zero', (s) => { view(s, 'showZeros="0"'); s.num('C3', 0); }, (ws) => sv(ws)?.getAttribute('showZeros') === '0');
sheetItem('Outline symbols hidden', 'No outline symbols', 'supported', '§18.3.1.87 sheetView@showOutlineSymbols', (s) => view(s, 'showOutlineSymbols="0"'), (ws) => sv(ws)?.getAttribute('showOutlineSymbols') === '0');
sheetItem('Sheet right-to-left', 'Right to left', 'kept', '§18.3.1.87 sheetView@rightToLeft; Page Layout ▸ Sheet Right-to-Left', (s) => view(s, 'rightToLeft="1"'), (ws) => isOn(sv(ws)?.getAttribute('rightToLeft')), 'xlsx-view.ts:356 VIEW_KEPT');
sheetItem('Show formulas', 'Show formulas', 'kept', '§18.3.1.87 sheetView@showFormulas; Formulas ▸ Show Formulas', (s) => view(s, 'showFormulas="1"'), (ws) => isOn(sv(ws)?.getAttribute('showFormulas')), 'VIEW_KEPT');
sheetItem('Gridline color (colorId 10)', 'Grid color', 'kept', '§18.3.1.87 sheetView@defaultGridColor, @colorId; File ▸ Options ▸ Advanced ▸ Gridline color', (s) => view(s, 'defaultGridColor="0" colorId="10"'),
  (ws) => sv(ws)?.getAttribute('defaultGridColor') === '0' && sv(ws)?.getAttribute('colorId') === '10', 'VIEW_KEPT');
sheetItem('Window protection flag', 'Window protect', 'kept', '§18.3.1.87 sheetView@windowProtection', (s) => view(s, 'windowProtection="1"'), (ws) => isOn(sv(ws)?.getAttribute('windowProtection')), 'VIEW_KEPT');
sheetItem('Scrolled to row 20 (topLeftCell)', 'Scrolled', 'kept', '§18.3.1.87 sheetView@topLeftCell', (s) => view(s, 'topLeftCell="A20"', '<selection activeCell="B25" sqref="B25"/>'),
  (ws) => sv(ws)?.getAttribute('topLeftCell') === 'A20', 'VIEW_KEPT');
sheetItem('Selection and active cell (B5:D9, C7)', 'Selection', 'kept', '§18.3.1.78 selection', (s) => view(s, '', '<selection activeCell="C7" sqref="B5:D9"/>'),
  (ws) => { const sel = kid(sv(ws), 'x:selection'); return sel?.getAttribute('activeCell') === 'C7' && sel?.getAttribute('sqref') === 'B5:D9'; }, 'xlsx-view.ts:333 panes.selection');
sheetItem('Page Layout view', 'Page Layout', 'supported', '§18.3.1.87 sheetView@view pageLayout; View ▸ Page Layout', (s) => view(s, 'view="pageLayout"'), (ws) => sv(ws)?.getAttribute('view') === 'pageLayout', 'xlsx-view.ts:46');
sheetItem('Page Layout view without ruler', 'No ruler', 'kept', '§18.3.1.87 sheetView@showRuler; View ▸ Show ▸ Ruler', (s) => view(s, 'showRuler="0" view="pageLayout"'), (ws) => sv(ws)?.getAttribute('showRuler') === '0', 'VIEW_KEPT');
sheetItem('Page Break Preview', 'Break Preview', 'supported', '§18.3.1.87 sheetView@view pageBreakPreview; View ▸ Page Break Preview', (s) => view(s, 'view="pageBreakPreview" zoomScaleNormal="100"'), (ws) => sv(ws)?.getAttribute('view') === 'pageBreakPreview');
sheetItem('Second window on the sheet (two sheetViews)', 'Two views', 'loss', '§18.3.1.88 sheetViews (one per workbook window); View ▸ New Window',
  (s) => { s.set('sheetViews', '<sheetViews><sheetView workbookViewId="0"/><sheetView zoomScale="80" zoomScaleNormal="80" workbookViewId="1"/></sheetViews>'); book.wb.bookViews = '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="14400" windowHeight="12300"/><workbookView xWindow="14400" yWindow="0" windowWidth="14400" windowHeight="12300" activeTab="0"/></bookViews>'; },
  (ws) => xKids(kid(ws, 'x:sheetViews'), 'sheetView').length === 2, 'xlsx.ts:1036 (one sheetView written)');
sheetItem('Outline summary rows above detail', 'Summary above', 'supported', '§18.3.1.61 outlinePr@summaryBelow; Data ▸ Outline settings',
  (s) => { s.set('sheetPr', '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>'); s.row(4, 'outlineLevel="1"'); s.row(5, 'outlineLevel="1"'); s.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="15" outlineLevelRow="1" x14ac:dyDescent="0.25"/>'); },
  (ws) => kid(ws, 'x:sheetPr/x:outlinePr')?.getAttribute('summaryBelow') === '0', 'xlsx.ts:1700, xlsx-view.ts:62');
sheetItem('Outline summary columns left of detail', 'Summary left', 'supported', '§18.3.1.61 outlinePr@summaryRight',
  (s) => { s.set('sheetPr', '<sheetPr><outlinePr summaryRight="0"/></sheetPr>'); s.set('cols', '<cols><col min="3" max="4" width="9.140625" outlineLevel="1"/></cols>'); s.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="15" outlineLevelCol="1" x14ac:dyDescent="0.25"/>'); },
  (ws) => kid(ws, 'x:sheetPr/x:outlinePr')?.getAttribute('summaryRight') === '0');
sheetItem('Default row height 20 pt (custom)', 'Default height', 'kept', '§18.3.1.81 sheetFormatPr@defaultRowHeight, @customHeight; Home ▸ Format ▸ Default Height',
  (s) => s.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="20" customHeight="1" x14ac:dyDescent="0.25"/>'),
  (ws) => kid(ws, 'x:sheetFormatPr')?.getAttribute('defaultRowHeight') === '20' && isOn(kid(ws, 'x:sheetFormatPr')?.getAttribute('customHeight')), 'xlsx.ts:1722 fileRowHeight');
sheetItem('Rows hidden by default (zeroHeight)', 'Zero height', 'kept', '§18.3.1.81 sheetFormatPr@zeroHeight; select all ▸ Hide rows, unhide some',
  (s) => s.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="15" zeroHeight="1" x14ac:dyDescent="0.25"/>'),
  (ws) => isOn(kid(ws, 'x:sheetFormatPr')?.getAttribute('zeroHeight')), 'xlsx.ts:1722');
sheetItem('Default column width 15 (sheet)', 'Default width', 'loss', '§18.3.1.81 sheetFormatPr@defaultColWidth; Home ▸ Format ▸ Default Width',
  (s) => s.set('sheetFormatPr', '<sheetFormatPr defaultColWidth="15.7109375" defaultRowHeight="15" x14ac:dyDescent="0.25"/>'),
  (ws) => !!kid(ws, 'x:sheetFormatPr')?.getAttribute('defaultColWidth'), 'xlsx.ts:1727 (written as each column\'s width)');
sheetItem('Default column width shows (columns as wide)', 'Default width shows', 'supported', '§18.3.1.81 sheetFormatPr@defaultColWidth',
  (s) => s.set('sheetFormatPr', '<sheetFormatPr defaultColWidth="15.7109375" defaultRowHeight="15" x14ac:dyDescent="0.25"/>'),
  (ws) => {
    const w = kid(ws, 'x:sheetFormatPr')?.getAttribute('defaultColWidth');
    if (w) return Math.abs(Number(w) - 15.71) < 0.05;
    const c = xKids(kid(ws, 'x:cols'), 'col').find((x) => Number(x.getAttribute('min')) <= 2 && Number(x.getAttribute('max')) >= 2);
    return Math.abs(Number(c?.getAttribute('width')) - 15.71) < 0.05;
  }, 'xlsx.ts:1727, :1823');
sheetItem('Tab color RGB', 'Tab RGB', 'kept', '§18.3.1.93 tabColor; sheet tab ▸ Tab Color', (s) => s.set('sheetPr', '<sheetPr><tabColor rgb="FFC8553D"/></sheetPr>'),
  (ws) => colorHex(kid(ws, 'x:sheetPr/x:tabColor')) === 'C8553D', 'xlsx-view.ts:330 tabColor');
sheetItem('Tab color theme (Accent 1)', 'Tab theme', 'kept', '§18.3.1.93 tabColor@theme', (s) => s.set('sheetPr', '<sheetPr><tabColor theme="4" tint="-0.249977111117893"/></sheetPr>'),
  (ws) => kid(ws, 'x:sheetPr/x:tabColor')?.getAttribute('theme') === '4', 'xlsx-view.ts:330');
sheetItem('Hidden sheet', 'Hidden', 'loss', '§18.2.19 sheet@state hidden; sheet tab ▸ Hide', () => {}, (_, v, i) => sheetOf(v, i)?.state === 'hidden', 'xlsx.ts:1601 (shown, with a warning)', 'hidden');
sheetItem('Very hidden sheet', 'Very hidden', 'loss', '§18.2.19 sheet@state veryHidden (VBA only)', () => {}, (_, v, i) => sheetOf(v, i)?.state === 'veryHidden', 'xlsx.ts:1601', 'veryHidden');
sheetItem('Hidden sheet\'s cells are kept', 'Hidden cells', 'supported', '§18.2.19 sheet@state hidden', (s) => s.text('C3', 'kept text'),
  (ws) => !!ws && xKids(kid(ws, 'x:sheetData'), 'row').some((row) => xKids(row, 'c').some((c) => c.getAttribute('r') === 'C3')), 'xlsx.ts:1660', 'hidden');
sheetItem('Sheet name with apostrophe, & and unicode', "O'Brien & Ünïcødé", 'supported', '§18.2.19 sheet@name; sheet tab ▸ Rename', () => {},
  (ws, v, i) => !!ws && sheetOf(v, i)!.name === `${i} O'Brien & Ünïcødé`.slice(0, 31));

// the workbook: the active sheet, the first tab shown, and the order of sheets
const order = it('Sheets keep their order', 'supported', '§18.2.20 sheets; drag a sheet tab', (v) => {
  const names = sheetList(v).map((s) => s.name);
  const want = book.sheets.map((s) => s.name);
  return want.every((n, k) => names[k] === n);
}, 'xlsx.ts:1586 names');
L.item(order, 'Sheets keep their order');
const active = it('Active sheet (activeTab)', 'supported', '§18.2.30 workbookView@activeTab; click a sheet tab', (v) => {
  const a = Number(kid(wbRoot(v), 'x:bookViews/x:workbookView')?.getAttribute('activeTab') ?? 0);
  return (sheetList(v)[a]?.name ?? '').includes('Zoom 150');
}, 'xlsx.ts:1594 activeTab, :1129');
L.item(active, 'Active sheet (activeTab): the Zoom 150% sheet');
const first = it('First tab shown in the tab bar (firstSheet)', 'loss', '§18.2.30 workbookView@firstSheet', (v) => kid(wbRoot(v), 'x:bookViews/x:workbookView')?.getAttribute('firstSheet') === '2', 'xlsx.ts:1129 (only activeTab written)');
L.item(first, 'First tab shown in the tab bar (firstSheet)');
const tabRatio = it('Tab bar width (tabRatio)', 'loss', '§18.2.30 workbookView@tabRatio', (v) => kid(wbRoot(v), 'x:bookViews/x:workbookView')?.getAttribute('tabRatio') === '750', 'xlsx.ts:1129');
L.item(tabRatio, 'Tab bar width (tabRatio)');

let bytes: Uint8Array | undefined;
export const xlsxLayout: Sampler = {
  name: 'xlsx-layout.xlsx', area: 'Excel sheet layout and views: merges, sizes, outlines, panes, zoom, hidden sheets, tabs', items,
  build: () => {
    if (bytes) return bytes;
    const zoom = book.sheets.findIndex((s) => s.name.includes('Zoom 150'));
    // the sheet with two windows set the workbook's views; the active tab goes on the first
    book.wb.bookViews = (book.wb.bookViews ?? '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>')
      .replace('<workbookView ', `<workbookView firstSheet="2" activeTab="${zoom}" tabRatio="750" `);
    for (const s of book.sheets) if (s.index === zoom) s.set('sheetViews', (s.get('sheetViews') ?? '').replace('<sheetView ', '<sheetView tabSelected="1" '));
    return (bytes = book.build('Excel sampler: layout and views'));
  },
};
