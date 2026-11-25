/**
 * Word sampler: tables (W-TBL). Each item is a small table (or a cell of one) whose first cell holds
 * the item's id. ECMA-376 Part 1 §17.4 (tables); Word's Table Design and Layout tabs and Table
 * Properties.
 *
 * Tags from src/io/docx-read.ts textTable (:3038), readTableFloat (:296), readTableWidth, and
 * src/io/docx-table-styles.ts readTableStyle (:167): gridSpan and vMerge, table and cell borders,
 * cell fills (not white), tblW, tblHeader, floating tables, tblLook, cell margins, vAlign,
 * trHeight, tblInd (dxa), autofit and jc are read and written; per-cell widths follow the grid;
 * gridBefore becomes empty cells; textDirection, noWrap, cantSplit, cell spacing, table shading and
 * cell patterns are not read (no mention in the reader or writer).
 */
import { type Item, type Sampler, type View, itemList, at, kid, up, NS } from './kit';
import { wordFile, para, run, runOf, val, on } from './word';

const items: Item[] = [];
const it = itemList('W-TBL', items);
const body: string[] = [];
type T = 'supported' | 'kept' | 'loss';

const P = (t: string) => para(run(t));
/** A cell: its properties (tcPr contents in the schema's order) and paragraphs. */
const tc = (content: string, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${content || '<w:p/>'}</w:tc>`;
const tr = (cells: string, trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells}</w:tr>`;
const grid = (...w: number[]) => `<w:tblGrid>${w.map((x) => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>`;
const tbl = (tblPr: string, g: string, rows: string) => `<w:tbl><w:tblPr>${tblPr}</w:tblPr>${g}${rows}</w:tbl>`;
const LOOK = '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>';
/** A plain 2 × 2 table, with `id` in its first cell. */
const simple = (id: string, feature: string, o: { tblPr?: string; tail?: string; tcPr?: string; trPr?: string; cols?: number } = {}) => tbl(
  `<w:tblStyle w:val="TableGrid"/>${o.tblPr ?? '<w:tblW w:w="0" w:type="auto"/>'}${LOOK}${o.tail ?? ''}`, grid(o.cols ?? 4680, o.cols ?? 4680),
  tr(tc(P(`${id} ${feature}`), o.tcPr ?? '') + tc(P('b')), o.trPr ?? '') + tr(tc(P('c')) + tc(P('d'))));

/** The cell, row and table that hold `id`. */
const tcOf = (v: View, id: string) => up(runOf(v, id), 'w:tc');
const trOf = (v: View, id: string) => up(runOf(v, id), 'w:tr');
const tblOf = (v: View, id: string) => up(runOf(v, id), 'w:tbl');
const tblPr = (v: View, id: string) => kid(tblOf(v, id), 'w:tblPr');
const tcPr = (v: View, id: string) => kid(tcOf(v, id), 'w:tcPr');
const trPr = (v: View, id: string) => kid(trOf(v, id), 'w:trPr');
const rows = (t: Element | undefined) => Array.from(t?.children ?? []).filter((c) => c.namespaceURI === NS.w && c.localName === 'tr');
const cells = (r: Element | undefined) => Array.from(r?.children ?? []).filter((c) => c.namespaceURI === NS.w && c.localName === 'tc');

const item = (feature: string, tag: T, spec: string, xml: (id: string) => string, check: (v: View, id: string) => boolean, basis?: string) => {
  const id = it(feature, tag, spec, (v) => check(v, id), basis);
  body.push(xml(id), P(''));
};

// structure and styles
item('Table with Table Grid style', 'supported', '§17.4.38 tblStyle; Table Design ▸ Table Grid', (id) => simple(id, 'Table Grid'), (v, id) => {
  const s = val(tblPr(v, id), 'w:tblStyle');
  return !!s && v.all(/^word\/styles\.xml$/, 'w:style').some((x) => at(x, 'w:styleId') === s && val(x, 'w:name') === 'Table Grid');
});
item('Custom table style with header row and banding', 'supported', '§17.7.6 table styles, §17.7.6.6 tblStylePr', (id) => tbl(`<w:tblStyle w:val="SamplerTable"/><w:tblW w:w="5000" w:type="pct"/>${LOOK}`, grid(3120, 3120, 3120),
  tr(tc(P(`${id} Custom table style`)) + tc(P('Head 2')) + tc(P('Head 3'))) + tr(tc(P('1')) + tc(P('2')) + tc(P('3'))) + tr(tc(P('4')) + tc(P('5')) + tc(P('6')))), (v, id) => {
  const s = v.all(/^word\/styles\.xml$/, 'w:style').find((x) => at(x, 'w:styleId') === val(tblPr(v, id), 'w:tblStyle'));
  return val(s, 'w:name') === 'Sampler Table' && Array.from(s?.getElementsByTagNameNS(NS.w, 'tblStylePr') ?? []).some((p) => at(p, 'w:type') === 'firstRow');
}, 'docx-table-styles.ts:167 readTableStyle');
item('Table style options: first column off, banded columns on', 'supported', '§17.4.56 tblLook', (id) => tbl('<w:tblStyle w:val="SamplerTable"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="0020" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="0"/>', grid(4680, 4680),
  tr(tc(P(`${id} Table style options`)) + tc(P('b'))) + tr(tc(P('c')) + tc(P('d')))), (v, id) => {
  const l = kid(tblPr(v, id), 'w:tblLook');
  return at(l, 'w:firstColumn') === '0' && at(l, 'w:noVBand') === '0';
});

// merges
item('Merge cells across (gridSpan)', 'supported', '§17.4.17 gridSpan; Layout ▸ Merge Cells', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(3120, 3120, 3120),
  tr(tc(P(`${id} spans two columns`), '<w:gridSpan w:val="2"/>') + tc(P('c'))) + tr(tc(P('d')) + tc(P('e')) + tc(P('f')))), (v, id) => val(tcPr(v, id), 'w:gridSpan') === '2');
item('Merge cells down (vMerge)', 'supported', '§17.4.85 vMerge', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(4680, 4680),
  tr(tc(P(`${id} spans two rows`), '<w:vMerge w:val="restart"/>') + tc(P('b'))) + tr(tc('<w:p/>', '<w:vMerge/>') + tc(P('d'))) + tr(tc(P('e')) + tc(P('f')))), (v, id) => {
  const r = trOf(v, id);
  const next = r?.nextElementSibling ?? undefined;
  return val(tcPr(v, id), 'w:vMerge') === 'restart' && !!kid(kid(cells(next)[0], 'w:tcPr'), 'w:vMerge');
});
item('Merge a block across and down', 'supported', '§17.4.17 gridSpan with §17.4.85 vMerge', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(3120, 3120, 3120),
  tr(tc(P(`${id} two by two`), '<w:gridSpan w:val="2"/><w:vMerge w:val="restart"/>') + tc(P('c'))) + tr(tc('<w:p/>', '<w:gridSpan w:val="2"/><w:vMerge/>') + tc(P('f'))) + tr(tc(P('g')) + tc(P('h')) + tc(P('i')))),
(v, id) => val(tcPr(v, id), 'w:gridSpan') === '2' && val(tcPr(v, id), 'w:vMerge') === 'restart');
item('Row starting after a skipped grid column (gridBefore)', 'loss', '§17.4.15 gridBefore', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(3120, 3120, 3120),
  tr(tc(P('a')) + tc(P('b')) + tc(P('c'))) + tr(tc(P(`${id} after one skipped column`)) + tc(P('f')), '<w:gridBefore w:val="1"/><w:wBefore w:w="3120" w:type="dxa"/>')),
(v, id) => val(trPr(v, id), 'w:gridBefore') === '1', 'docx-read.ts (gridBefore becomes empty cells)');

// borders and shading
const B = (side: string, v: string, sz = 4, color = 'auto') => `<w:${side} w:val="${v}" w:sz="${sz}" w:space="0" w:color="${color}"/>`;
item('Table borders double outside, dotted inside', 'supported', '§17.4.39 tblBorders', (id) => tbl(`<w:tblW w:w="0" w:type="auto"/><w:tblBorders>${B('top', 'double', 4, '1B7F79')}${B('left', 'double', 4, '1B7F79')}${B('bottom', 'double', 4, '1B7F79')}${B('right', 'double', 4, '1B7F79')}${B('insideH', 'dotted')}${B('insideV', 'dotted')}</w:tblBorders>${LOOK}`, grid(4680, 4680),
  tr(tc(P(`${id} double and dotted`)) + tc(P('b'))) + tr(tc(P('c')) + tc(P('d')))), (v, id) => {
  // as shown: the first cell's own borders where it has them (they override the table's, §17.4.67), else the table's
  const tb = kid(tblPr(v, id), 'w:tblBorders'), cb = kid(tcPr(v, id), 'w:tcBorders');
  const top = val(cb, 'w:top') ?? val(tb, 'w:top');
  const inside = val(cb, 'w:bottom') ?? val(tb, 'w:insideH');
  return top === 'double' && inside === 'dotted';
});
item('No borders', 'supported', '§17.4.39 tblBorders none', (id) => tbl(`<w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="nil"/>`).join('')}</w:tblBorders>${LOOK}`, grid(4680, 4680),
  tr(tc(P(`${id} no borders`)) + tc(P('b'))) + tr(tc(P('c')) + tc(P('d')))), (v, id) => {
  const tb = kid(tblPr(v, id), 'w:tblBorders'), cb = kid(tcPr(v, id), 'w:tcBorders');
  const none = (x: string | null) => x === null || x === 'nil' || x === 'none';
  return none(val(cb, 'w:top') ?? val(tb, 'w:top')) && none(val(cb, 'w:right') ?? val(tb, 'w:insideV'));
});
item('One cell with its own thick red borders', 'supported', '§17.4.67 tcBorders', (id) => simple(id, 'cell borders', { tcPr: `<w:tcBorders>${B('top', 'thick', 18, 'C8553D')}${B('left', 'thick', 18, 'C8553D')}${B('bottom', 'thick', 18, 'C8553D')}${B('right', 'thick', 18, 'C8553D')}</w:tcBorders>` }),
(v, id) => { const t = kid(kid(tcPr(v, id), 'w:tcBorders'), 'w:top'); return !!t && at(t, 'w:color')?.toUpperCase() === 'C8553D' && Number(at(t, 'w:sz')) >= 18; });
item('Diagonal border in a cell', 'loss', '§17.4.74 tl2br', (id) => simple(id, 'diagonal', { tcPr: `<w:tcBorders>${B('tl2br', 'single', 4, '6A4C93')}</w:tcBorders>` }), (v, id) => !!kid(kid(tcPr(v, id), 'w:tcBorders'), 'w:tl2br'), 'docx-read.ts (diagonal borders not read)');
item('Cell shading fill', 'supported', '§17.4.33 shd (cell)', (id) => simple(id, 'cell fill', { tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="F2A541"/>' }), (v, id) => at(kid(tcPr(v, id), 'w:shd'), 'w:fill')?.toUpperCase() === 'F2A541');
item('Cell shading white', 'loss', '§17.4.33 shd fill FFFFFF', (id) => simple(id, 'white fill', { tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>' }), (v, id) => at(kid(tcPr(v, id), 'w:shd'), 'w:fill')?.toUpperCase() === 'FFFFFF', 'docx-read.ts textTable (white fills dropped)');
item('Cell shading pattern 25%', 'loss', '§17.4.33 shd pct25', (id) => simple(id, 'pattern', { tcPr: '<w:shd w:val="pct25" w:color="1B7F79" w:fill="FFFFFF"/>' }), (v, id) => val(tcPr(v, id), 'w:shd') === 'pct25', 'docx-read.ts textTable (patterns not read)');
item('Cell shading theme color', 'loss', '§17.4.33 shd@themeFill', (id) => simple(id, 'theme fill', { tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="1B7F79" w:themeFill="accent1"/>' }), (v, id) => at(kid(tcPr(v, id), 'w:shd'), 'w:themeFill') === 'accent1', 'docx-read.ts textTable');
item('Table shading', 'loss', '§17.4.32 shd (table)', (id) => simple(id, 'table shading', { tblPr: '<w:tblW w:w="0" w:type="auto"/><w:shd w:val="clear" w:color="auto" w:fill="EEF2E6"/>' }), (v, id) => at(kid(tblPr(v, id), 'w:shd'), 'w:fill')?.toUpperCase() === 'EEF2E6', 'docx-read.ts textTable (table-level shading not read)');

// sizes and layout
item('Preferred width 100%', 'supported', '§17.4.64 tblW pct', (id) => simple(id, 'width 100%', { tblPr: '<w:tblW w:w="5000" w:type="pct"/>' }), (v, id) => { const w = kid(tblPr(v, id), 'w:tblW'); return at(w, 'w:type') === 'pct' && (at(w, 'w:w') === '5000' || at(w, 'w:w') === '100%'); });
item('Preferred width 4 inches', 'supported', '§17.4.64 tblW dxa', (id) => simple(id, 'width 4 in', { tblPr: '<w:tblW w:w="5760" w:type="dxa"/>', cols: 2880 }), (v, id) => { const w = kid(tblPr(v, id), 'w:tblW'); return at(w, 'w:type') === 'dxa' && at(w, 'w:w') === '5760'; });
item('Unequal column widths', 'supported', '§17.4.16 gridCol', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(1440, 5760, 2160),
  tr(tc(P(`${id} narrow`), '<w:tcW w:w="1440" w:type="dxa"/>') + tc(P('wide'), '<w:tcW w:w="5760" w:type="dxa"/>') + tc(P('middle'), '<w:tcW w:w="2160" w:type="dxa"/>'))), (v, id) => {
  const g = Array.from(kid(tblOf(v, id), 'w:tblGrid')?.children ?? []).map((c) => Number(at(c, 'w:w')));
  return g.length === 3 && g[1] > g[2] && g[2] > g[0];
});
item('Fixed column width layout', 'supported', '§17.4.53 tblLayout fixed; Table Properties ▸ Options ▸ Automatically resize off', (id) => simple(id, 'fixed layout', { tblPr: '<w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/>' }), (v, id) => at(kid(tblPr(v, id), 'w:tblLayout'), 'w:type') === 'fixed');
item('Table centered', 'supported', '§17.4.29 jc (table)', (id) => simple(id, 'centered', { tblPr: '<w:tblW w:w="4320" w:type="dxa"/><w:jc w:val="center"/>', cols: 2160 }), (v, id) => val(tblPr(v, id), 'w:jc') === 'center');
item('Table indent 0.5 in', 'supported', '§17.4.51 tblInd', (id) => simple(id, 'indented', { tblPr: '<w:tblW w:w="0" w:type="auto"/><w:tblInd w:w="720" w:type="dxa"/>' }), (v, id) => at(kid(tblPr(v, id), 'w:tblInd'), 'w:w') === '720');
item('Cell spacing 0.05 in', 'loss', '§17.4.45 tblCellSpacing', (id) => simple(id, 'cell spacing', { tblPr: '<w:tblW w:w="0" w:type="auto"/><w:tblCellSpacing w:w="72" w:type="dxa"/>' }), (v, id) => !!kid(tblPr(v, id), 'w:tblCellSpacing'), 'not read (no mention in docx-read.ts)');
item('Default cell margins', 'supported', '§17.4.43 tblCellMar', (id) => simple(id, 'cell margins', { tblPr: '<w:tblW w:w="0" w:type="auto"/><w:tblCellMar><w:top w:w="144" w:type="dxa"/><w:left w:w="216" w:type="dxa"/><w:bottom w:w="144" w:type="dxa"/><w:right w:w="216" w:type="dxa"/></w:tblCellMar>' }),
(v, id) => at(kid(kid(tblPr(v, id), 'w:tblCellMar'), 'w:left'), 'w:w') === '216' || at(kid(kid(tcPr(v, id), 'w:tcMar'), 'w:left'), 'w:w') === '216');
item('One cell\'s own margins', 'supported', '§17.4.42 tcMar', (id) => simple(id, 'cell margin', { tcPr: '<w:tcMar><w:top w:w="288" w:type="dxa"/></w:tcMar>' }), (v, id) => at(kid(kid(tcPr(v, id), 'w:tcMar'), 'w:top'), 'w:w') === '288');
item('Row height exactly 0.5 in', 'supported', '§17.4.80 trHeight exact', (id) => simple(id, 'exact row height', { trPr: '<w:trHeight w:val="720" w:hRule="exact"/>' }), (v, id) => { const h = kid(trPr(v, id), 'w:trHeight'); return at(h, 'w:val') === '720' && at(h, 'w:hRule') === 'exact'; });
item('Row height at least 0.75 in', 'supported', '§17.4.80 trHeight atLeast', (id) => simple(id, 'minimum row height', { trPr: '<w:trHeight w:val="1080"/>' }), (v, id) => { const h = kid(trPr(v, id), 'w:trHeight'); return at(h, 'w:val') === '1080' && (at(h, 'w:hRule') ?? 'atLeast') === 'atLeast'; });
item('Repeat as header row', 'supported', '§17.4.49 tblHeader; Layout ▸ Repeat Header Rows', (id) => simple(id, 'header row', { trPr: '<w:tblHeader/>' }), (v, id) => on(trPr(v, id), 'w:tblHeader'));
item("Don't allow row to break across pages", 'loss', '§17.4.6 cantSplit', (id) => simple(id, 'cannot split', { trPr: '<w:cantSplit/>' }), (v, id) => on(trPr(v, id), 'w:cantSplit'), 'not read (no mention in docx-read.ts)');
item('Cell vertical alignment center', 'supported', '§17.4.84 vAlign', (id) => simple(id, 'centered vertically', { tcPr: '<w:vAlign w:val="center"/>', trPr: '<w:trHeight w:val="1080"/>' }), (v, id) => val(tcPr(v, id), 'w:vAlign') === 'center');
item('Cell vertical alignment bottom', 'supported', '§17.4.84 vAlign', (id) => simple(id, 'bottom', { tcPr: '<w:vAlign w:val="bottom"/>', trPr: '<w:trHeight w:val="1080"/>' }), (v, id) => val(tcPr(v, id), 'w:vAlign') === 'bottom');
item('Text direction rotated (bottom to top)', 'loss', '§17.4.72 textDirection btLr', (id) => simple(id, 'turned text', { tcPr: '<w:textDirection w:val="btLr"/>', trPr: '<w:trHeight w:val="2160"/>' }), (v, id) => val(tcPr(v, id), 'w:textDirection') === 'btLr', 'not read for cells (docx-read.ts)');
item("Don't wrap text in a cell", 'loss', '§17.4.30 noWrap', (id) => simple(id, 'no wrap', { tcPr: '<w:noWrap/>' }), (v, id) => on(tcPr(v, id), 'w:noWrap'), 'not read (no mention in docx-read.ts)');
item('Fit text in a cell', 'loss', '§17.4.68 tcFitText', (id) => simple(id, 'fit text', { tcPr: '<w:tcFitText/>' }), (v, id) => on(tcPr(v, id), 'w:tcFitText'), 'not read');
item('Right-to-left table', 'loss', '§17.4.1 bidiVisual', (id) => simple(id, 'right to left', { tblPr: '<w:bidiVisual/><w:tblW w:w="0" w:type="auto"/>' }), (v, id) => on(tblPr(v, id), 'w:bidiVisual'), 'not read');
item('Alt text title and description', 'loss', '§17.4.37 tblCaption, §17.4.46 tblDescription; Table Properties ▸ Alt Text', (id) => simple(id, 'alt text', { tail: '<w:tblCaption w:val="Sampler table title"/><w:tblDescription w:val="Sampler table description"/>' }),
(v, id) => val(tblPr(v, id), 'w:tblCaption') === 'Sampler table title' && val(tblPr(v, id), 'w:tblDescription') === 'Sampler table description', 'docx-read.ts (tblCaption/tblDescription not kept)');

// floating and nested
item('Floating table (text wrapping around)', 'supported', '§17.4.58 tblpPr; Table Properties ▸ Text wrapping Around', (id) => simple(id, 'floating', { tblPr: '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="200"/><w:tblW w:w="3600" w:type="dxa"/>' }), (v, id) => !!kid(tblPr(v, id), 'w:tblpPr'), 'docx-read.ts:296 readTableFloat');
item('Floating table may not overlap', 'supported', '§17.4.57 tblOverlap', (id) => simple(id, 'no overlap', { tblPr: '<w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" w:horzAnchor="page" w:tblpX="7200" w:tblpY="200"/><w:tblOverlap w:val="never"/><w:tblW w:w="3600" w:type="dxa"/>' }), (v, id) => val(tblPr(v, id), 'w:tblOverlap') === 'never', 'docx-read.ts:296');
item('Nested table', 'supported', '§17.4.37 tbl inside tc', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(4680, 4680),
  tr(tc(P(`${id} outer cell`) + simple('inner', 'table') + '<w:p/>') + tc(P('b')))), (v, id) => (tcOf(v, id)?.getElementsByTagNameNS(NS.w, 'tbl').length ?? 0) > 0, 'docx-read.ts textTable (cells read via boxText)');

// content in cells
item('Several paragraphs and a list in a cell', 'supported', '§17.4.66 tc', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(4680, 4680),
  tr(tc(P(`${id} first paragraph`) + P('second paragraph') + para(run('bold third'), '<w:jc w:val="right"/>')) + tc(P('b')))), (v, id) => cells(trOf(v, id))[0]?.getElementsByTagNameNS(NS.w, 'p').length === 3);
item('Formatted text in a cell', 'supported', '§17.4.66 tc', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(4680, 4680),
  tr(tc(para(run(`${id} `) + run('italic red', '<w:i/><w:color w:val="C8553D"/>'))) + tc(P('b')))), (v, id) => Array.from(tcOf(v, id)?.getElementsByTagNameNS(NS.w, 'r') ?? []).some((r) => on(kid(r, 'w:rPr'), 'w:i') && val(kid(r, 'w:rPr'), 'w:color')?.toUpperCase() === 'C8553D'));
item('A table of 12 rows', 'supported', '§17.4.79 tr', (id) => tbl(`<w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>${LOOK}`, grid(3120, 3120, 3120),
  Array.from({ length: 12 }, (_, i) => tr(tc(P(i ? String(i) : `${id} twelve rows`)) + tc(P(`r${i}`)) + tc(P(String(i * i))))).join('')), (v, id) => rows(tblOf(v, id)).length === 12);

const TABLE_STYLE = '<w:style w:type="table" w:customStyle="1" w:styleId="SamplerTable"><w:name w:val="Sampler Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="40"/>'
  + '<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="1B7F79"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="1B7F79"/></w:tblBorders></w:tblPr>'
  + '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1B7F79"/></w:tcPr></w:tblStylePr>'
  + '<w:tblStylePr w:type="band1Horz"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EEF2E6"/></w:tcPr></w:tblStylePr>'
  + '<w:tblStylePr w:type="band1Vert"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F7E3DE"/></w:tcPr></w:tblStylePr></w:style>';

export const docxTables: Sampler = {
  name: 'docx-tables.docx', area: 'Word tables: styles, merges, borders, shading, widths, rows, floating and nested tables', items,
  build: () => wordFile({ title: 'Word sampler: tables', styles: TABLE_STYLE, body: () => body.join('') }),
};
