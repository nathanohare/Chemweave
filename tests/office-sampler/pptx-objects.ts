/**
 * PowerPoint sampler: objects (P-TBL tables, P-CHT charts, P-SMA SmartArt, P-PIC pictures,
 * P-MED sound, P-LNK hyperlinks and action buttons, P-OLE embedded objects: ChemDraw and an Excel
 * worksheet). ECMA-376 Part 1 §21.1.3 (tables), §21.2 (charts), §21.4 (diagrams),
 * §19.3.1.37 (pic), §20.1.8.13 (blip effects), §21.1.2.3.5 (hlinkClick), §19.3.1.32 (oleObj);
 * PowerPoint's Insert ▸ Table, Chart, SmartArt, Pictures, Audio, Link, Action, Object.
 *
 * Video is left out: there is no video encoder here to make one in code.
 *
 * Tags from src/io/pptx-read.ts table() (:2169, styles src/deck/table-styles.ts:47), chart()
 * (:1417, src/io/xlsx-chart.ts:608 types), smartArt() (:1318), pictureEl and
 * src/io/picture-xml.ts, hlinkOf() (:2410), chemdrawObject() (:1348) and frame() (:1286), and
 * src/io/pptx-write.ts keptChemdraw (:1336).
 */
import { type Item, type Sampler, type View, itemList, at, kid, NS, REL, CT, Pkg, XML_HEAD, esc, png, wav, xmlns } from './kit';
import {
  deckFile, sp, pic, frame, txBody, para, r, prst, solid, line, NOFILL, textBox,
  namedShape, shapeOf, spPrOf, partOf, partOfEl, relTarget, relsOf, runOf, boxOf, SLIDES, allNs, PNS, type SlideCtx, type SlideDef, type Box,
} from './pptx';
import { chemdrawObject } from '../../src/io/ole-object';
import { cdxmlToCdx } from '../../src/io/cdx';

const items: Item[] = [];
type Tag = 'supported' | 'kept' | 'loss';
const slides: SlideDef[] = [];

const C_NS = `xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"`;
const label = (s: SlideCtx, text: string, b: Box, size = 900) => textBox(s.id(), 'label', b, para(r(text, `sz="${size}"`)), '<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr>');

// ---------------------------------------------------------------- tables

const tb = itemList('P-TBL', items);
const tblOf = (v: View, id: string) => v.all(SLIDES, 'a:tbl').find((t) => (t.textContent ?? '').includes(id));
const cellOf = (v: View, id: string) => v.all(SLIDES, 'a:tc').find((t) => (t.textContent ?? '').includes(id));
const tcPr = (v: View, id: string) => kid(cellOf(v, id), 'a:tcPr');
const cell = (text: string, pr = '', attrs = '', rPr = '') => `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${text ? r(text, `sz="1000"${rPr}`) : '<a:endParaRPr lang="en-US" sz="1000"/>'}</a:p></a:txBody><a:tcPr${pr ? `>${pr}</a:tcPr>` : '/>'}</a:tc>`;
const lnSide = (side: string, w: number, color: string, dash = '') => `<a:${side} w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="${dash || 'solid'}"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/></a:${side}>`;
const table = (s: SlideCtx, name: string, b: Box, tblPr: string, cols: number[], rows: { h: number; cells: string }[]) => frame({
  id: s.id(), name, box: b, uri: 'http://schemas.openxmlformats.org/drawingml/2006/table', locks: '<a:graphicFrameLocks noGrp="1"/>',
  data: `<a:tbl>${tblPr}<a:tblGrid>${cols.map((w) => `<a:gridCol w="${w * 12700}"/>`).join('')}</a:tblGrid>${rows.map((rw) => `<a:tr h="${rw.h * 12700}">${rw.cells}</a:tr>`).join('')}</a:tbl>`,
});
const STYLE = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
{
  const t1 = tb('Table 3 columns × 4 rows with text', 'supported', '§21.1.3.13 tbl; Insert ▸ Table', (v) => { const t = tblOf(v, t1); return !!t && t.getElementsByTagNameNS(NS.a, 'tr').length === 4 && t.getElementsByTagNameNS(NS.a, 'gridCol').length === 3; }, 'pptx-read.ts:2169 table()');
  const sty = tb('Table style Medium Style 2 - Accent 1', 'supported', '§21.1.3.14 tableStyleId; Table Design ▸ Table Styles', (v) => kid(kid(tblOf(v, t1), 'a:tblPr'), 'a:tableStyleId')?.textContent === STYLE, 'table-styles.ts:47 PPT_STYLE_IDS');
  const hdr = tb('Header Row and Banded Rows', 'supported', '§21.1.3.15 tblPr@firstRow/@bandRow; Table Design ▸ Table Style Options', (v) => { const p = kid(tblOf(v, t1), 'a:tblPr'); return at(p ?? null, 'firstRow') === '1' && at(p ?? null, 'bandRow') === '1'; }, 'inventory: tblPr flags');
  const opts = tb('First Column, Total Row and Banded Columns', 'supported', '§21.1.3.15 tblPr@firstCol/@lastRow/@bandCol', (v) => { const p = kid(tblOf(v, t1), 'a:tblPr'); return at(p ?? null, 'firstCol') === '1' && at(p ?? null, 'lastRow') === '1' && at(p ?? null, 'bandCol') === '1'; }, 'inventory');
  const cols = tb('Column widths 100, 160, 80 pt', 'supported', '§21.1.3.9 gridCol@w', (v) => { const w = Array.from(tblOf(v, t1)?.getElementsByTagNameNS(NS.a, 'gridCol') ?? []).map((g) => Math.round(Number(at(g, 'w')) / 12700)); return w.join() === '100,160,80'; }, 'pptx-read.ts table column widths');
  const rowH = tb('Row height 40 pt (taller than its text)', 'loss', '§21.1.3.18 tr@h; Table Layout ▸ Height', (v) => { const t = tblOf(v, t1); return Array.from(t?.getElementsByTagNameNS(NS.a, 'tr') ?? []).some((x) => at(x, 'h') === String(40 * 12700)); }, 'inventory: row heights lost');
  const bold = tb('Cell text bold', 'supported', '§21.1.2.3.9 rPr@b in a cell', (v) => at(kid(runOf(v, bold), 'a:rPr') ?? null, 'b') === '1');
  slides.push({ body: (s) => label(s, `${t1} ${sty} ${hdr} ${opts} ${cols} ${rowH} — a styled table`, [30, 10, 800, 16]) + table(s, `${t1} table`, [30, 30, 340, 130],
    `<a:tblPr firstRow="1" firstCol="1" lastRow="1" bandRow="1" bandCol="1"><a:tableStyleId>${STYLE}</a:tableStyleId></a:tblPr>`, [100, 160, 80], [
      { h: 22, cells: cell(`${t1} Head A`) + cell('Head B') + cell('Head C') },
      { h: 40, cells: cell('a2') + cell(`${bold} bold`, '', '', ' b="1"') + cell('c2') },
      { h: 22, cells: cell('a3') + cell('b3') + cell('c3') },
      { h: 22, cells: cell('Total') + cell('b4') + cell('c4') },
    ]) });
  void [sty, hdr, opts, cols, rowH];
  // merges, fills, borders, margins, anchors
  const across = tb('Merged cells across (gridSpan)', 'supported', '§21.1.3.16 tc@gridSpan, @hMerge; Table Layout ▸ Merge Cells', (v) => at(cellOf(v, across) ?? null, 'gridSpan') === '2', 'inventory: gridSpan/rowSpan');
  const down = tb('Merged cells down (rowSpan)', 'supported', '§21.1.3.16 tc@rowSpan, @vMerge', (v) => at(cellOf(v, down) ?? null, 'rowSpan') === '2', 'inventory');
  const fill = tb('Cell fill solid', 'supported', '§21.1.3.17 tcPr solidFill; Table Design ▸ Shading', (v) => at(kid(tcPr(v, fill), 'a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'F2A541', 'inventory: cell solidFill');
  const grad = tb('Cell fill gradient', 'loss', '§21.1.3.17 tcPr gradFill', (v) => !!kid(tcPr(v, grad), 'a:gradFill'), 'inventory: cell gradient lost');
  const bdr = tb('Cell borders 2 pt', 'supported', '§21.1.3.5 lnL, lnR, lnT, lnB; Table Design ▸ Borders', (v) => at(kid(tcPr(v, bdr), 'a:lnB') ?? null, 'w') === '25400', 'inventory: border width');
  const bclr = tb('Cell border colors different on each side', 'loss', '§21.1.3.5 lnL/lnR colors', (v) => { const p = tcPr(v, bclr); return at(kid(p, 'a:lnL/a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === 'C8553D' && at(kid(p, 'a:lnR/a:solidFill/a:srgbClr') ?? null, 'val')?.toUpperCase() === '3A86FF'; }, 'inventory: per-cell colors collapse');
  const bdash = tb('Cell border dashed', 'loss', '§20.1.8.48 prstDash in lnB', (v) => at(kid(tcPr(v, bdash), 'a:lnB/a:prstDash') ?? null, 'val') === 'dash', 'not read');
  const diag = tb('Cell diagonal border (lnTlToBr)', 'loss', '§21.1.3.6 lnTlToBr; Borders ▸ Diagonal Down Border', (v) => !!kid(tcPr(v, diag), 'a:lnTlToBr'), 'not read');
  const mar = tb('Cell margins 0.2 in', 'loss', '§21.1.3.17 tcPr@marL/@marT; Table Layout ▸ Cell Margins', (v) => at(tcPr(v, mar) ?? null, 'marL') === '182880', 'inventory: margins lost');
  const anc = tb('Cell text centered vertically', 'loss', '§21.1.3.17 tcPr@anchor ctr; Table Layout ▸ Center Vertically', (v) => at(tcPr(v, anc) ?? null, 'anchor') === 'ctr', 'inventory: anchor lost');
  const vert = tb('Cell text direction rotated 270°', 'loss', '§21.1.3.17 tcPr@vert vert270; Table Layout ▸ Text Direction', (v) => at(tcPr(v, vert) ?? null, 'vert') === 'vert270', 'not read');
  const noStyle = tb('Table with no style (tableStyleId {2D5ABB26…} No Style, No Grid)', 'loss', '§21.1.3.14 tableStyleId not in PPT_STYLE_IDS', (v) => kid(kid(tblOf(v, noStyle), 'a:tblPr'), 'a:tableStyleId')?.textContent === '{2D5ABB26-0587-4C30-8999-92F81FD0307C}', 'table-styles.ts:47 (other styles baked into cell fills)');
  const B = lnSide('lnL', 12700, '1F3A4D') + lnSide('lnR', 12700, '1F3A4D') + lnSide('lnT', 12700, '1F3A4D') + lnSide('lnB', 12700, '1F3A4D');
  slides.push({ body: (s) => label(s, `${across} ${down} ${noStyle} — merges, fills, borders`, [30, 10, 800, 16]) + table(s, `${across} table 2`, [30, 30, 600, 260],
    `<a:tblPr firstRow="1"><a:tableStyleId>{2D5ABB26-0587-4C30-8999-92F81FD0307C}</a:tableStyleId></a:tblPr>`, [150, 150, 150, 150], [
      { h: 40, cells: cell(`${across} merged across`, B, ' gridSpan="2"') + cell('', B, ' hMerge="1"') + cell(`${down} merged down`, B, ' rowSpan="2"') + cell(`${noStyle} d1`, B) },
      { h: 40, cells: cell(`${fill} filled`, B + solid('F2A541')) + cell(`${grad} gradient`, B + '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="8AB17D"/></a:gs></a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>') + cell('', B, ' vMerge="1"') + cell(`${bdr} 2 pt borders`, lnSide('lnL', 25400, '1F3A4D') + lnSide('lnR', 25400, '1F3A4D') + lnSide('lnT', 25400, '1F3A4D') + lnSide('lnB', 25400, '1F3A4D')) },
      { h: 40, cells: cell(`${bclr} colored sides`, lnSide('lnL', 25400, 'C8553D') + lnSide('lnR', 25400, '3A86FF') + lnSide('lnT', 25400, '8AB17D') + lnSide('lnB', 25400, '6A4C93')) + cell(`${bdash} dashed`, lnSide('lnL', 12700, '1F3A4D') + lnSide('lnR', 12700, '1F3A4D') + lnSide('lnT', 12700, '1F3A4D') + lnSide('lnB', 19050, '1F3A4D', 'dash')) + cell(`${diag} diagonal`, B + lnSide('lnTlToBr', 12700, 'C8553D')) + cell(`${mar} margins`, B, '').replace('<a:tcPr>', '<a:tcPr marL="182880" marR="182880" marT="91440" marB="91440">') },
      { h: 60, cells: cell(`${anc} middle`, B).replace('<a:tcPr>', '<a:tcPr anchor="ctr">') + cell(`${vert} turned`, B).replace('<a:tcPr>', '<a:tcPr vert="vert270">') + cell('c4', B) + cell('d4', B) },
    ]) });
}

// ---------------------------------------------------------------- charts

const ch = itemList('P-CHT', items);
/** A small workbook (xlsx) made here: the chart's data, as PowerPoint embeds it. */
function workbook(cells: [string, string | number][]): Uint8Array {
  const p = new Pkg();
  p.rel('', REL.officeDocument, 'xl/workbook.xml');
  p.add('xl/workbook.xml', `${XML_HEAD}<workbook ${xmlns('r')} xmlns="${NS.x}"><sheets><sheet name="Sheet1" sheetId="1" r:id="${p.rel('xl/workbook.xml', REL.worksheet, 'worksheets/sheet1.xml')}"/></sheets></workbook>`, CT.workbook);
  const rows = new Map<number, string[]>();
  for (const [ref, v] of cells) {
    const n = Number(/\d+/.exec(ref)![0]);
    rows.set(n, [...(rows.get(n) ?? []), typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`]);
  }
  p.add('xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="${NS.x}"><sheetData>${[...rows.entries()].sort((a, b) => a[0] - b[0]).map(([n, cs]) => `<row r="${n}">${cs.join('')}</row>`).join('')}</sheetData></worksheet>`, CT.worksheet);
  return p.build();
}
const CATS = ['Mon', 'Tue', 'Wed', 'Thu'];
const strRef = (f: string, vals: string[]) => `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>${vals.map((x, i) => `<c:pt idx="${i}"><c:v>${esc(x)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (f: string, vals: number[]) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((x, i) => `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
interface Ser { name: string; vals: number[]; spPr?: string; dLbls?: string }
const ser = (k: number, s: Ser, kind: string) => {
  const col = 'BCDEFG'[k];
  const head = `<c:idx val="${k}"/><c:order val="${k}"/><c:tx>${strRef(`Sheet1!$${col}$1`, [s.name])}</c:tx>${s.spPr ?? ''}`;
  const cat = `<c:cat>${strRef('Sheet1!$A$2:$A$5', CATS)}</c:cat><c:val>${numRef(`Sheet1!$${col}$2:$${col}$5`, s.vals)}</c:val>`;
  if (kind === 'bar') return `<c:ser>${head}<c:invertIfNegative val="0"/>${s.dLbls ?? ''}${cat}</c:ser>`;
  if (kind === 'line') return `<c:ser>${head}<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>${s.dLbls ?? ''}${cat}<c:smooth val="0"/></c:ser>`;
  if (kind === 'scatter') return `<c:ser>${head}<c:marker><c:symbol val="diamond"/><c:size val="7"/></c:marker><c:xVal>${numRef('Sheet1!$A$2:$A$5', [1, 2, 3, 4])}</c:xVal><c:yVal>${numRef(`Sheet1!$${col}$2:$${col}$5`, s.vals)}</c:yVal><c:smooth val="0"/></c:ser>`;
  return `<c:ser>${head}${s.dLbls ?? ''}${cat}</c:ser>`; // pie, doughnut, area, radar
};
const AX = '<c:axId val="111"/><c:axId val="222"/>';
const AXES = '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
  + '<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
const VALAXES = AXES.replace('<c:catAx><c:axId val="111"/>', '<c:valAx><c:axId val="111"/>').replace('<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>', '<c:crossBetween val="midCat"/></c:valAx>');
const SERS: Ser[] = [{ name: 'Yield', vals: [12, 18, 9, 22] }, { name: 'Purity', vals: [8, 11, 15, 10] }];
const plots: Record<string, (ss: Ser[]) => string> = {
  col: (ss) => `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'bar')).join('')}<c:gapWidth val="150"/>${AX}</c:barChart>${AXES}`,
  bar: (ss) => `<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'bar')).join('')}<c:gapWidth val="150"/>${AX}</c:barChart>${AXES.replace('<c:axPos val="b"/>', '<c:axPos val="l"/>').replace('<c:axPos val="l"/><c:majorGridlines/>', '<c:axPos val="b"/><c:majorGridlines/>')}`,
  stacked: (ss) => `<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'bar')).join('')}<c:gapWidth val="150"/><c:overlap val="100"/>${AX}</c:barChart>${AXES}`,
  line: (ss) => `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'line')).join('')}<c:marker val="1"/>${AX}</c:lineChart>${AXES}`,
  pie: (ss) => `<c:pieChart><c:varyColors val="1"/>${ser(0, ss[0], 'pie')}<c:firstSliceAng val="0"/></c:pieChart>`,
  doughnut: (ss) => `<c:doughnutChart><c:varyColors val="1"/>${ser(0, ss[0], 'pie')}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`,
  scatter: (ss) => `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'scatter')).join('')}${AX}</c:scatterChart>${VALAXES}`,
  area: (ss) => `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'area')).join('')}${AX}</c:areaChart>${AXES}`,
  radar: (ss) => `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'area')).join('')}${AX}</c:radarChart>${AXES.replace('<c:majorGridlines/>', '<c:majorGridlines/>')}`,
  combo: (ss) => `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser(0, ss[0], 'bar')}<c:gapWidth val="150"/>${AX}</c:barChart><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser(1, ss[1], 'line')}<c:marker val="1"/>${AX}</c:lineChart>${AXES}`,
  bar3d: (ss) => `<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ss.map((x, k) => ser(k, x, 'bar')).join('')}<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="111"/><c:axId val="222"/><c:axId val="0"/></c:bar3DChart>${AXES}`,
};
const chartXml = (title: string, plot: string, extra: { legend?: string; view3D?: boolean; rid: string }) => `${XML_HEAD}<c:chartSpace ${C_NS}><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>`
  + `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="1400"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
  + `${extra.view3D ? '<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:rAngAx val="1"/></c:view3D>' : ''}<c:plotArea><c:layout/>${plot}</c:plotArea>`
  + `<c:legend><c:legendPos val="${extra.legend ?? 'r'}"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
  + `<c:externalData r:id="${extra.rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
let chartN = 0;
/** A chart frame: its own chart part and embedded workbook; `id` in its title and alt text. */
const chart = (s: SlideCtx, id: string, b: Box, kind: string, opts: { sers?: Ser[]; legend?: string; title?: string } = {}) => {
  const n = ++chartN;
  const ss = opts.sers ?? SERS;
  const path = `ppt/charts/chart${n}.xml`;
  s.pkg.add(`ppt/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`, workbook([['A1', ''], ...CATS.map((c, i) => [`A${i + 2}`, c] as [string, string]), ...ss.flatMap((x, k) => [[`${'BC'[k]}1`, x.name] as [string, string], ...x.vals.map((y, i) => [`${'BC'[k]}${i + 2}`, y] as [string, number])])]));
  const rid = s.pkg.rel(path, REL.package, `../embeddings/Microsoft_Excel_Worksheet${n}.xlsx`);
  const cr = s.part(`charts/chart${n}.xml`, chartXml(opts.title ?? `${id} ${kind} chart`, plots[kind](ss), { legend: opts.legend, view3D: kind === 'bar3d', rid }), CT.chart, REL.chart);
  return frame({ id: s.id(), name: `${id} chart`, descr: `${id} chart alt text`, box: b, uri: NS.c, data: `<c:chart xmlns:c="${NS.c}" r:id="${cr}"/>` });
};
/** The chart part of the chart frame whose alt text or name holds `id`. */
const chartOf = (v: View, id: string): Document | undefined => {
  const f = v.all(SLIDES, 'p:graphicFrame').find((g) => { const c = kid(kid(g, 'p:nvGraphicFramePr'), 'p:cNvPr'); return ((at(c ?? null, 'descr') ?? '') + (at(c ?? null, 'name') ?? '')).includes(id); });
  const ref = f?.getElementsByTagNameNS(NS.c, 'chart')[0];
  const part = f ? partOfEl(v, f) : undefined;
  const t = part && ref ? relTarget(v, part, at(ref, 'r:id') ?? '') : undefined;
  return t ? v.doc(t) : undefined;
};
const plotKids = (d: Document | undefined) => Array.from(d?.getElementsByTagNameNS(NS.c, 'plotArea')[0]?.children ?? []).map((e) => e.localName);
const cval = (d: Document | undefined, name: string) => at(d?.getElementsByTagNameNS(NS.c, name)[0] ?? null, 'val');
{
  const k1 = ch('Clustered Column chart', 'supported', '§21.2.2.16 barChart barDir col; Insert ▸ Chart ▸ Column', (v) => plotKids(chartOf(v, k1)).includes('barChart') && cval(chartOf(v, k1), 'barDir') === 'col', 'xlsx-chart.ts:608');
  const title = ch('Chart title text', 'supported', '§21.2.2.210 title; Chart Elements ▸ Chart Title', (v) => (chartOf(v, title)?.getElementsByTagNameNS(NS.c, 'title')[0]?.textContent ?? '').includes(title), 'chart box title');
  const vals = ch('Series values (cached)', 'supported', '§21.2.2.130 numCache', (v) => Array.from(chartOf(v, vals)?.getElementsByTagNameNS(NS.c, 'numCache')[0]?.getElementsByTagNameNS(NS.c, 'v') ?? []).map((x) => x.textContent).join() === '12,18,9,22', 'chart cached data');
  const cats = ch('Category names', 'supported', '§21.2.2.24 cat strCache', (v) => (chartOf(v, cats)?.getElementsByTagNameNS(NS.c, 'cat')[0]?.textContent ?? '').includes('Wed'), 'chart cached data');
  const sname = ch('Series names', 'supported', '§21.2.2.215 tx in ser', (v) => { const t = Array.from(chartOf(v, sname)?.getElementsByTagNameNS(NS.c, 'ser') ?? []).map((x) => kid(x, 'c:tx')?.textContent ?? ''); return t.some((x) => x.includes('Yield')) && t.some((x) => x.includes('Purity')); });
  const wb = ch('Chart data workbook embedded', 'supported', '§21.2.2.63 externalData; Chart Design ▸ Edit Data', (v) => { const f = v.all(SLIDES, 'p:graphicFrame').find((g) => (at(kid(kid(g, 'p:nvGraphicFramePr'), 'p:cNvPr') ?? null, 'descr') ?? '').includes(wb)); const ref = f?.getElementsByTagNameNS(NS.c, 'chart')[0]; const part = f ? partOfEl(v, f) : undefined; const t = part && ref ? relTarget(v, part, at(ref, 'r:id') ?? '') : undefined; return !!t && relsOf(v, t).some((x) => /package|oleObject/.test(x.type)); }, 'inventory: re-emitted with an embedded xlsx');
  const alt = ch('Chart alt text', 'supported', '§19.3.1.12 cNvPr@descr on a chart', (v) => v.all(SLIDES, 'p:cNvPr').some((c) => /chart alt text$/.test(at(c, 'descr') ?? '') && (at(c, 'descr') ?? '').includes(alt)), 'pptx-read.ts:1435');
  const legend = ch('Legend at the bottom', 'loss', '§21.2.2.101 legendPos b; Chart Elements ▸ Legend ▸ Bottom', (v) => cval(chartOf(v, legend), 'legendPos') === 'b', 'inventory: chart formatting lost');
  const name = ch('Chart name (Selection Pane)', 'loss', '§19.3.1.12 cNvPr@name on a chart', (v) => v.all(SLIDES, 'p:cNvPr').some((c) => (at(c, 'name') ?? '') === `${name} chart`), 'pptx-write.ts:1366 (named Chart N)');
  const sfill = ch('Series fill color', 'loss', '§21.2.2.197 spPr in ser', (v) => Array.from(chartOf(v, sfill)?.getElementsByTagNameNS(NS.c, 'ser') ?? []).some((x) => at(kid(x, 'c:spPr')?.getElementsByTagNameNS(NS.a, 'srgbClr')[0] ?? null, 'val')?.toUpperCase() === 'C8553D'), 'inventory: formatting lost');
  const dl = ch('Data labels showing values', 'loss', '§21.2.2.49 dLbls showVal', (v) => Array.from(chartOf(v, dl)?.getElementsByTagNameNS(NS.c, 'showVal') ?? []).some((x) => at(x, 'val') === '1'), 'inventory');
  const kinds: [string, string, Tag, string][] = [
    ['bar', 'Clustered Bar chart (horizontal)', 'supported', '§21.2.2.16 barDir bar'], ['stacked', 'Stacked Column chart', 'supported', '§21.2.2.77 grouping stacked'],
    ['line', 'Line with Markers chart', 'supported', '§21.2.2.97 lineChart'], ['pie', 'Pie chart', 'supported', '§21.2.2.141 pieChart'],
    ['doughnut', 'Doughnut chart', 'loss', '§21.2.2.50 doughnutChart'], ['scatter', 'Scatter chart', 'supported', '§21.2.2.161 scatterChart'],
    ['area', 'Area chart', 'supported', '§21.2.2.5 areaChart'], ['radar', 'Radar chart', 'supported', '§21.2.2.153 radarChart'],
    ['combo', 'Combo chart: columns and a line', 'loss', '§21.2.2.145 plotArea with two chart groups; Change Chart Type ▸ Combo'], ['bar3d', '3-D Clustered Column chart', 'loss', '§21.2.2.15 bar3DChart'],
  ];
  const kindIds = kinds.map(([kind, feature, tag, spec]) => {
    const el = { bar: 'barChart', stacked: 'barChart', line: 'lineChart', pie: 'pieChart', doughnut: 'doughnutChart', scatter: 'scatterChart', area: 'areaChart', radar: 'radarChart', combo: 'lineChart', bar3d: 'bar3DChart' }[kind]!;
    const id = ch(feature, tag, `${spec}; Insert ▸ Chart`, (v) => { const d = chartOf(v, id); const k = plotKids(d); return k.includes(el) && (kind !== 'bar' || cval(d, 'barDir') === 'bar') && (kind !== 'stacked' || cval(d, 'grouping') === 'stacked') && (kind !== 'combo' || k.includes('barChart')); }, kind === 'doughnut' ? 'xlsx-chart.ts:608 (doughnut read as pie)' : kind === 'combo' ? 'pptx-read.ts:1434 (mixed types show as one)' : kind === 'bar3d' ? 'xlsx-chart.ts:608 (3-D read as 2-D)' : 'xlsx-chart.ts:608');
    return [kind, id] as const;
  });
  slides.push({ body: (s) => { s.grid(4, 4, 200); return chart(s, k1, [20, 20, 300, 160], 'col', { title: `${k1} ${title} column chart` }).replace(`${k1} chart alt text`, `${k1} ${title} ${vals} ${cats} ${sname} ${wb} ${alt} chart alt text`)
    + chart(s, legend, [330, 20, 300, 160], 'col', { legend: 'b', sers: [{ ...SERS[0], spPr: '<c:spPr><a:solidFill><a:srgbClr val="C8553D"/></a:solidFill></c:spPr>', dLbls: '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>' }, SERS[1]] }).replace(`${legend} chart alt text`, `${legend} ${name} ${sfill} ${dl} chart alt text`).replace(`name="${legend} chart"`, `name="${name} chart"`)
    + kindIds.map(([kind, id]) => chart(s, id, s.cell(), kind)).join(''); } });
}

// ---------------------------------------------------------------- SmartArt

const sm = itemList('P-SMA', items);
/** The slides and SmartArt drawings (the text is in the drawing as built, on the slide once flattened). */
const SLIDE_OR_DRAWING = /^ppt\/(slides\/slide|diagrams\/drawing)\d+\.xml$/;
{
  const frameId = sm('SmartArt graphic (Basic Block List) stays a SmartArt', 'loss', '§21.4 diagrams; Insert ▸ SmartArt', (v) => v.all(SLIDES, 'a:graphicData').some((g) => /diagram$/.test(at(g, 'uri') ?? '')), 'pptx-read.ts:1337 (SmartArt came in as shapes and text)');
  const nodes = sm('SmartArt node text shown (as shapes and text)', 'supported', '§21.4.3.8 pt t; dsp drawing', (v) => ['first', 'second', 'third'].every((w) => v.all(SLIDE_OR_DRAWING, 'a:t').some((t) => (t.textContent ?? '').includes(`${nodes} ${w}`))), 'pptx-read.ts:1318 smartArt()');
  const words = ['first', 'second', 'third'];
  const G = (k: number) => `{0B1C2D3E-4F50-4612-8A9B-0C1D2E3F40${k.toString().padStart(2, '0')}}`;
  const DGM = `xmlns:dgm="${NS.dgm}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"`;
  slides.push({ body: (s) => {
    const drawing = `${XML_HEAD}<dsp:drawing xmlns:dgm="${NS.dgm}" xmlns:dsp="${PNS.dsp}" xmlns:a="${NS.a}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>`
      + words.map((w, k) => `<dsp:sp modelId="${G(k + 1)}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="${k * 2286000}" y="0"/><a:ext cx="2032000" cy="1219200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="1B7F79"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></dsp:spPr><dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="64008" tIns="64008" rIns="64008" bIns="64008" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${nodes} ${w}</a:t></a:r></a:p></dsp:txBody><dsp:txXfrm><a:off x="${k * 2286000}" y="0"/><a:ext cx="2032000" cy="1219200"/></dsp:txXfrm></dsp:sp>`).join('')
      + '</dsp:spTree></dsp:drawing>';
    const drawRid = s.part('diagrams/drawing1.xml', drawing, CT.dgmDrawing, REL.diagramDrawing);
    const pts = `<dgm:pt modelId="${G(0)}" type="doc"><dgm:prSet loTypeId="urn:microsoft.com/office/officeart/2005/8/layout/default" loCatId="list" qsTypeId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1" qsCatId="simple" csTypeId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2" csCatId="accent1" phldr="1"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></dgm:t></dgm:pt>`
      + words.map((w, k) => `<dgm:pt modelId="${G(k + 1)}"><dgm:prSet phldrT="[Text]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${nodes} ${w}</a:t></a:r></a:p></dgm:t></dgm:pt>`).join('');
    const cxns = words.map((_w, k) => `<dgm:cxn modelId="${G(20 + k)}" srcId="${G(0)}" destId="${G(k + 1)}" srcOrd="${k}" destOrd="0"/>`).join('');
    const dm = s.part('diagrams/data1.xml', `${XML_HEAD}<dgm:dataModel ${DGM}><dgm:ptLst>${pts}</dgm:ptLst><dgm:cxnLst>${cxns}</dgm:cxnLst><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="${PNS.dsp}" relId="${drawRid}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>`, CT.dgmData, REL.diagramData);
    const lo = s.part('diagrams/layout1.xml', `${XML_HEAD}<dgm:layoutDef ${DGM} uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/default"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="list" pri="400"/></dgm:catLst><dgm:layoutNode name="diagram"><dgm:alg type="snake"/><dgm:shape><dgm:adjLst/></dgm:shape><dgm:forEach name="Name0" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:alg type="tx"/><dgm:shape type="rect"><dgm:adjLst/></dgm:shape></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`, CT.dgmLayout, REL.diagramLayout);
    const qs = s.part('diagrams/quickStyle1.xml', `${XML_HEAD}<dgm:styleDef ${DGM} uniqueId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:styleLbl name="node1"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dgm:style></dgm:styleLbl></dgm:styleDef>`, CT.dgmStyle, REL.diagramQuickStyle);
    const cs = s.part('diagrams/colors1.xml', `${XML_HEAD}<dgm:colorsDef ${DGM} uniqueId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst><dgm:styleLbl name="node1"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:txFillClrLst><dgm:txEffectClrLst/></dgm:styleLbl></dgm:colorsDef>`, CT.dgmColors, REL.diagramColors);
    return label(s, `${frameId} ${nodes} SmartArt below`, [30, 10, 800, 16]) + frame({ id: s.id(), name: `${frameId} SmartArt`, box: [60, 60, 540, 96], uri: NS.dgm, data: `<dgm:relIds xmlns:dgm="${NS.dgm}" r:dm="${dm}" r:lo="${lo}" r:qs="${qs}" r:cs="${cs}"/>` });
  } });
}

// ---------------------------------------------------------------- pictures

const pc = itemList('P-PIC', items);
{
  const P = png(64, 48);
  const picEl = (v: View, id: string) => namedShape(v, id, SLIDES, ['pic']);
  const blipOf = (v: View, id: string) => kid(kid(picEl(v, id), 'p:blipFill'), 'a:blip');
  const list: [string, Tag, string, (s: SlideCtx, id: string, b: Box) => string, (v: View, id: string) => boolean, string?][] = [];
  const add = (feature: string, tag: Tag, spec: string, make: (s: SlideCtx, id: string, b: Box) => string, check: (v: View, id: string) => boolean, basis?: string) => list.push([feature, tag, spec, make, check, basis]);
  const P1 = (blip = '', extra: Partial<Parameters<typeof pic>[0]> = {}) => (s: SlideCtx, id: string, b: Box) => pic({ id: s.id(), name: `${id} picture`, rid: s.media(`${id}.png`, P), box: b, blip, ...extra });
  add('Picture (PNG)', 'supported', '§19.3.1.37 pic, §20.1.8.13 blip; Insert ▸ Pictures', P1(), (v, id) => { const b = blipOf(v, id); const p = picEl(v, id); return !!b && !!p && !!relTarget(v, partOfEl(v, p)!, at(b, 'r:embed') ?? ''); }, 'pptx-read.ts pictureEl');
  add('Picture keeps its position and size', 'supported', '§20.1.7.6 xfrm on a picture', P1(), (v, id) => { const b = boxOf(picEl(v, id)); return !!b && b[2] > 50 && b[3] > 30; });
  add('Crop (srcRect 10% left, 20% top)', 'supported', '§20.1.8.55 srcRect; Picture Format ▸ Crop', P1('', { srcRect: '<a:srcRect l="10000" t="20000"/>' }), (v, id) => { const s = kid(kid(picEl(v, id), 'p:blipFill'), 'a:srcRect'); return at(s ?? null, 'l') === '10000' && at(s ?? null, 't') === '20000'; }, 'picture-xml.ts:96 crop');
  add('Negative crop (picture inset in its frame)', 'supported', '§20.1.8.55 srcRect negative values', P1('', { srcRect: '<a:srcRect l="-10000" r="-10000"/>' }), (v, id) => { const s = kid(kid(picEl(v, id), 'p:blipFill'), 'a:srcRect'); const box = boxOf(picEl(v, id)); return at(s ?? null, 'l') === '-10000' || (!!box && Math.abs(box[2] - 0) > 0); }, 'inventory: negative = inset');
  add('Crop to Shape: Oval', 'supported', '§20.1.9.18 prstGeom ellipse on a picture; Crop ▸ Crop to Shape', P1('', { geom: prst('ellipse') }), (v, id) => at(kid(spPrOf(picEl(v, id)), 'a:prstGeom') ?? null, 'prst') === 'ellipse', 'picture-xml.ts crop shapes');
  add('Crop to Shape: Rounded Rectangle', 'supported', '§20.1.9.18 prstGeom roundRect on a picture', P1('', { geom: prst('roundRect') }), (v, id) => at(kid(spPrOf(picEl(v, id)), 'a:prstGeom') ?? null, 'prst') === 'roundRect', 'picture-xml.ts');
  add('Picture border 3 pt', 'supported', '§20.1.2.2.24 ln on a picture; Picture Border', P1('', { fmt: line(3, solid('C8553D')) }), (v, id) => at(kid(spPrOf(picEl(v, id)), 'a:ln') ?? null, 'w') === '38100', 'picture-xml.ts border');
  add('Picture shadow', 'supported', '§20.1.8.49 outerShdw on a picture; Picture Effects ▸ Shadow', P1('', { fmt: '<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>' }), (v, id) => !!kid(kid(spPrOf(picEl(v, id)), 'a:effectLst'), 'a:outerShdw'), 'picture-xml.ts shadow');
  add('Picture glow', 'loss', '§20.1.8.32 glow on a picture', P1('', { fmt: '<a:effectLst><a:glow rad="101600"><a:srgbClr val="F2A541"><a:alpha val="60000"/></a:srgbClr></a:glow></a:effectLst>' }), (v, id) => !!kid(kid(spPrOf(picEl(v, id)), 'a:effectLst'), 'a:glow'), 'picture-xml.ts (border and shadow only)');
  add('Color ▸ Grayscale', 'supported', '§20.1.8.34 grayscl; Picture Format ▸ Color ▸ Recolor', P1('<a:grayscl/>'), (v, id) => !!kid(blipOf(v, id), 'a:grayscl'), 'picture-xml.ts');
  add('Color ▸ Duotone recolor (Accent 2 dark)', 'supported', '§20.1.8.23 duotone', P1('<a:duotone><a:prstClr val="black"/><a:srgbClr val="C8553D"><a:tint val="45000"/><a:satMod val="400000"/></a:srgbClr></a:duotone>'), (v, id) => !!kid(blipOf(v, id), 'a:duotone'), 'picture-xml.ts');
  add('Color ▸ Black and White 50%', 'supported', '§20.1.8.11 biLevel', P1('<a:biLevel thresh="50000"/>'), (v, id) => at(kid(blipOf(v, id), 'a:biLevel') ?? null, 'thresh') === '50000', 'picture-xml.ts');
  add('Corrections ▸ Brightness +20% Contrast -20%', 'supported', '§20.1.8.42 lum', P1('<a:lum bright="20000" contrast="-20000"/>'), (v, id) => { const l = kid(blipOf(v, id), 'a:lum'); return at(l ?? null, 'bright') === '20000' && at(l ?? null, 'contrast') === '-20000'; }, 'picture-xml.ts');
  add('Color ▸ Set Transparent Color', 'supported', '§20.1.8.16 clrChange', P1('<a:clrChange><a:clrFrom><a:srgbClr val="F0C828"/></a:clrFrom><a:clrTo><a:srgbClr val="F0C828"><a:alpha val="0"/></a:srgbClr></a:clrTo></a:clrChange>'), (v, id) => !!kid(blipOf(v, id), 'a:clrChange'), 'picture-xml.ts');
  add('Transparency 30%', 'supported', '§20.1.8.4 alphaModFix; Picture Format ▸ Transparency', P1('<a:alphaModFix amt="70000"/>'), (v, id) => at(kid(blipOf(v, id), 'a:alphaModFix') ?? null, 'amt') === '70000', 'picture-xml.ts');
  add('Color ▸ Saturation 200% (hsl)', 'loss', '§20.1.8.39 hsl', P1('<a:hsl hue="0" sat="100000" lum="0"/>'), (v, id) => !!kid(blipOf(v, id), 'a:hsl'), 'inventory: hsl lost');
  add('Tint (tint effect)', 'loss', '§20.1.8.60 tint', P1('<a:tint hue="3600000" amt="50000"/>'), (v, id) => !!kid(blipOf(v, id), 'a:tint'), 'inventory');
  add('Blur', 'loss', '§20.1.8.15 blur in blip', P1('<a:blur rad="25400"/>'), (v, id) => !!kid(blipOf(v, id), 'a:blur'), 'inventory');
  add('Color replace (clrRepl)', 'loss', '§20.1.8.18 clrRepl', P1('<a:clrRepl><a:srgbClr val="3A86FF"/></a:clrRepl>'), (v, id) => !!kid(blipOf(v, id), 'a:clrRepl'), 'inventory');
  add('Alt text', 'supported', '§19.3.1.12 cNvPr@descr; Picture Format ▸ Alt Text', (s, id, b) => pic({ id: s.id(), name: `${id} picture`, descr: `${id} a chart of colors`, rid: s.media(`${id}.png`, P), box: b }), (v, id) => (at(kid(kid(picEl(v, id), 'p:nvPicPr'), 'p:cNvPr') ?? null, 'descr') ?? '').includes('a chart of colors'), 'pptx-read.ts:1559');
  add('Picture name (Selection Pane)', 'supported', '§19.3.1.12 cNvPr@name on a picture', P1(), (v, id) => !!picEl(v, id), 'pptx-write.ts:2066 nameAttrs');
  add('Scalable Vector Graphics picture (svgBlip with PNG fallback)', 'supported', 'Office 2016 asvg:svgBlip; Insert ▸ Pictures (SVG)', (s, id, b) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48"><rect width="64" height="48" fill="#1B7F79"/><circle cx="32" cy="24" r="16" fill="#F2A541"/><text x="4" y="44" font-size="8">${id}</text></svg>`;
    s.pkg.add(`ppt/media/${id}.svg`, svg, 'image/svg+xml');
    const sr = s.rel(REL.image, `../media/${id}.svg`);
    return pic({ id: s.id(), name: `${id} picture`, rid: s.media(`${id}.png`, P), box: b, blipExt: `<a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${sr}"/></a:ext>` });
  }, (v, id) => !!blipOf(v, id)?.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2016/SVG/main', 'svgBlip')[0], 'picture-xml.ts svgBlip');
  add('Linked picture (Insert and Link)', 'loss', '§20.1.8.13 blip@r:link; Insert ▸ Pictures ▸ Insert and Link', (s, id, b) => pic({ id: s.id(), name: `${id} linked picture`, rid: s.rel(REL.image, 'file:///C:/Samples/linked-picture.png', true), embedAttr: 'link', box: b }), (v, id) => !!at(blipOf(v, id) ?? null, 'r:link'), 'pptx-read.ts:1454 (linked pictures left out)');
  const picItems = list.map(([feature, tag, spec, make, check, basis]) => { const id: string = pc(feature, tag, spec, (v) => check(v, id), basis); return { id, feature, make }; });
  slides.push({ body: (s) => { s.grid(6, 4); return picItems.map(({ id, feature, make }) => { const b = s.cell(); return make(s, id, [b[0], b[1], b[2], b[3] - 14]) + label(s, `${id} ${feature}`, [b[0], b[1] + b[3] - 13, b[2], 13], 700); }).join(''); } });
}

// ---------------------------------------------------------------- sound

const md = itemList('P-MED', items);
{
  const snd = md('Embedded sound (WAV)', 'supported', '§20.1.3.2 audioFile, p14:media; Insert ▸ Audio ▸ Audio on My PC', (v) => { const p = namedShape(v, snd, SLIDES, ['pic']); return !!p && !!findAudio(p); }, 'inventory: p14:media audio');
  const trim = md('Trim Audio (start 0.1 s, end 0.3 s)', 'supported', 'p14:trim; Playback ▸ Trim Audio', (v) => { const t = namedShape(v, trim, SLIDES, ['pic'])?.getElementsByTagNameNS(NS.p14, 'trim')[0]; return at(t ?? null, 'st') === '100' && at(t ?? null, 'end') === '300'; }, 'inventory: trim');
  const fade = md('Fade In 0.25 s', 'supported', 'p14:fade; Playback ▸ Fade Duration', (v) => at(namedShape(v, fade, SLIDES, ['pic'])?.getElementsByTagNameNS(NS.p14, 'fade')[0] ?? null, 'in') === '250', 'inventory: fade');
  const vol = md('Volume Medium (50%)', 'supported', '§19.5.20 cMediaNode@vol; Playback ▸ Volume', (v) => { const p = partOf(v, vol); return !!p && v.all(new RegExp(`^${p.replace('.', '\\.')}$`), 'p:cMediaNode').some((n) => at(n, 'vol') === '50000'); }, 'animation.ts:966 readMediaTiming');
  const across = md('Play Across Slides', 'supported', '§19.5.20 cMediaNode@numSld; Playback ▸ Play Across Slides', (v) => { const p = partOf(v, across); return !!p && v.all(new RegExp(`^${p.replace('.', '\\.')}$`), 'p:cMediaNode').some((n) => at(n, 'numSld') === '999'); }, 'animation.ts:966');
  const hide = md('Hide During Show', 'supported', '§19.5.20 cMediaNode@showWhenStopped; Playback ▸ Hide During Show', (v) => { const p = partOf(v, hide); return !!p && v.all(new RegExp(`^${p.replace('.', '\\.')}$`), 'p:cMediaNode').some((n) => at(n, 'showWhenStopped') === '0'); }, 'animation.ts:966');
  const loop = md('Loop until Stopped', 'supported', '§19.5.33 cTn@repeatCount indefinite', (v) => { const p = partOf(v, loop); return !!p && v.all(new RegExp(`^${p.replace('.', '\\.')}$`), 'p:cMediaNode').some((n) => at(kid(n, 'p:cTn') ?? null, 'repeatCount') === 'indefinite'); }, 'animation.ts:966');
  const auto = md('Start Automatically', 'supported', '§19.5.21 cmd playFrom in the main sequence; Playback ▸ Start', (v) => { const p = partOf(v, auto); return !!p && v.all(new RegExp(`^${p.replace('.', '\\.')}$`), 'p:cmd').some((c) => /^playFrom/.test(at(c, 'cmd') ?? '')); }, 'animation.ts:966');
  slides.push({
    body: (s) => {
      const media = s.media('sound.wav', wav(400), REL.media);
      const audio = s.rel(REL.audio, '../media/sound.wav');
      return label(s, `${snd} ${trim} ${fade} ${vol} ${across} ${hide} ${loop} ${auto} sound settings`, [30, 10, 800, 16])
        + pic({ id: s.id('sound'), name: `${snd} ${trim} ${fade} sound`, links: '<a:hlinkClick r:id="" action="ppaction://media"/>', rid: s.media('sound-icon.png', png(32, 32, [27, 127, 121])), box: [100, 100, 48, 48],
          nvPr: `<a:audioFile r:link="${audio}"/><p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="${NS.p14}" r:embed="${media}"><p14:trim st="100" end="300"/><p14:fade in="250"/></p14:media></p:ext></p:extLst>` });
    },
    timing: (s) => {
      const id = s.spid('sound');
      return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>`
        + `<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>`
        + `<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
        + `<p:cmd type="call" cmd="playFrom(0.0)"><p:cBhvr><p:cTn id="6" dur="400" fill="hold"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:cmd></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>`
        + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
        + `<p:audio><p:cMediaNode vol="50000" numSld="999" showWhenStopped="0"><p:cTn id="7" repeatCount="indefinite" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cMediaNode></p:audio>`
        + '</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>';
    },
  });
}
function findAudio(p: Element): boolean {
  return !!p.getElementsByTagNameNS(NS.a, 'audioFile')[0] || !!p.getElementsByTagNameNS(NS.p14, 'media')[0];
}

// ---------------------------------------------------------------- hyperlinks and action buttons

const lk = itemList('P-LNK', items);
{
  const linkOf = (v: View, id: string) => kid(kid(runOf(v, id), 'a:rPr'), 'a:hlinkClick');
  const relOfLink = (v: View, id: string, el: Element | undefined) => { const p = partOf(v, id); return p && el ? relsOf(v, p).find((x) => x.id === at(el, 'r:id')) : undefined; };
  const shapeLink = (v: View, id: string) => kid(kid(kid(namedShape(v, id), 'p:nvSpPr') ?? kid(namedShape(v, id), 'p:nvPicPr'), 'p:cNvPr'), 'a:hlinkClick');
  type L = { feature: string; tag: Tag; spec: string; link: (s: SlideCtx) => string; check: (v: View, id: string) => boolean; basis?: string };
  const textLinks: L[] = [
    { feature: 'Link to a web page', tag: 'supported', spec: '§21.1.2.3.5 hlinkClick, external relationship; Insert ▸ Link', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/chemweave-sampler', true)}"/>`, check: (v, id) => relOfLink(v, id, linkOf(v, id))?.target === 'https://example.com/chemweave-sampler', basis: 'pptx-read.ts:2425' },
    { feature: 'Link ScreenTip', tag: 'loss', spec: '§21.1.2.3.5 hlinkClick@tooltip; Insert ▸ Link ▸ ScreenTip', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/tip', true)}" tooltip="Sampler tip"/>`, check: (v, id) => at(linkOf(v, id) ?? null, 'tooltip') === 'Sampler tip', basis: 'not read' },
    { feature: 'E-mail link (mailto)', tag: 'supported', spec: '§21.1.2.3.5 hlinkClick mailto; Insert ▸ Link ▸ E-mail Address', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'mailto:sampler@example.com?subject=Sampler', true)}"/>`, check: (v, id) => (relOfLink(v, id, linkOf(v, id))?.target ?? '').startsWith('mailto:sampler@example.com'), basis: 'pptx-read.ts:2425' },
    { feature: 'Link to a slide in this presentation', tag: 'supported', spec: 'ppaction://hlinksldjump; Insert ▸ Link ▸ Place in This Document', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.slide, 'slide1.xml')}" action="ppaction://hlinksldjump"/>`, check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinksldjump' && /slide\d+\.xml$/.test(relOfLink(v, id, linkOf(v, id))?.target ?? ''), basis: 'pptx-read.ts:2416' },
    { feature: 'Link to Next Slide', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=nextslide', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=nextslide', basis: 'pptx-read.ts:2412' },
    { feature: 'Link to Previous Slide', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=previousslide', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=previousslide"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=previousslide' },
    { feature: 'Link to First Slide', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=firstslide', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=firstslide"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=firstslide' },
    { feature: 'Link to Last Slide', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=lastslide', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=lastslide"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=lastslide' },
    { feature: 'Link to Last Slide Viewed', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=lastslideviewed', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=lastslideviewed"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=lastslideviewed' },
    { feature: 'Link to End Show', tag: 'supported', spec: 'ppaction://hlinkshowjump?jump=endshow', link: () => '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=endshow"/>', check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://hlinkshowjump?jump=endshow' },
    { feature: 'Link to a file', tag: 'supported', spec: '§21.1.2.3.5 hlinkClick to a file; Insert ▸ Link ▸ Existing File', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'file:///C:/Samples/notes.txt', true)}"/>`, check: (v, id) => (relOfLink(v, id, linkOf(v, id))?.target ?? '').includes('notes.txt'), basis: 'pptx-read.ts:2425' },
    // (a link to another presentation, ppaction://hlinkpres, is left out: PowerPoint refuses to open a file
    // linking to a .pptx that isn't there, so the sample would only show that; seen 2026-11-24, Microsoft 365)
    { feature: 'Link to a custom show', tag: 'loss', spec: 'ppaction://customshow?id=0', link: () => '<a:hlinkClick r:id="" action="ppaction://customshow?id=0&amp;return=true"/>', check: (v, id) => (at(linkOf(v, id) ?? null, 'action') ?? '').startsWith('ppaction://customshow'), basis: 'pptx-read.ts:2420' },
    { feature: 'Run program', tag: 'loss', spec: 'ppaction://program; Insert ▸ Action ▸ Run program', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'file:///C:/Windows/notepad.exe', true)}" action="ppaction://program"/>`, check: (v, id) => at(linkOf(v, id) ?? null, 'action') === 'ppaction://program', basis: 'pptx-read.ts:2420' },
    { feature: 'Run macro', tag: 'loss', spec: 'ppaction://macro?name=Sampler; Insert ▸ Action ▸ Run macro', link: () => '<a:hlinkClick r:id="" action="ppaction://macro?name=SamplerMacro"/>', check: (v, id) => (at(linkOf(v, id) ?? null, 'action') ?? '').startsWith('ppaction://macro'), basis: 'pptx-read.ts:2420' },
    { feature: 'Highlight click and visited history off', tag: 'loss', spec: '§21.1.2.3.5 hlinkClick@highlightClick/@history', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/history', true)}" history="0" highlightClick="1"/>`, check: (v, id) => at(linkOf(v, id) ?? null, 'history') === '0', basis: 'not read' },
    { feature: 'Link with click sound', tag: 'loss', spec: '§21.1.2.3.5 hlinkClick snd; Insert ▸ Action ▸ Play sound', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/sound', true)}"><a:snd r:embed="${s.media('click.wav', wav(150), REL.audio)}" name="click.wav"/></a:hlinkClick>`, check: (v, id) => !!kid(linkOf(v, id), 'a:snd'), basis: 'inventory: click sounds lost' },
    { feature: 'Mouse Over link (hlinkMouseOver)', tag: 'loss', spec: '§21.1.2.3.6 hlinkMouseOver; Insert ▸ Action ▸ Mouse Over', link: (s) => `<a:hlinkMouseOver r:id="${s.rel(REL.hyperlink, 'https://example.com/hover', true)}"/>`, check: (v, id) => !!kid(kid(runOf(v, id), 'a:rPr'), 'a:hlinkMouseOver'), basis: 'inventory: hlinkMouseOver lost' },
  ];
  const shapeLinks: L[] = [
    { feature: 'Link on a whole shape', tag: 'supported', spec: '§19.3.1.12 cNvPr hlinkClick; select shape ▸ Insert ▸ Link', link: (s) => `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/shape', true)}"/>`, check: (v, id) => !!shapeLink(v, id), basis: 'pptx-read.ts:2028 native() link' },
    { feature: 'Mouse Over action on a shape (hlinkHover)', tag: 'loss', spec: '§19.3.1.12 cNvPr hlinkHover', link: (s) => `<a:hlinkHover r:id="${s.rel(REL.hyperlink, 'https://example.com/hover-shape', true)}" action="ppaction://hlinkfile"/>`, check: (v, id) => !!kid(kid(kid(namedShape(v, id), 'p:nvSpPr'), 'p:cNvPr'), 'a:hlinkHover'), basis: 'inventory: hlinkHover lost' },
  ];
  const buttons = ['actionButtonForwardNext', 'actionButtonBackPrevious', 'actionButtonBeginning', 'actionButtonEnd', 'actionButtonHome', 'actionButtonReturn', 'actionButtonHelp', 'actionButtonInformation', 'actionButtonDocument', 'actionButtonSound', 'actionButtonMovie', 'actionButtonBlank'];
  const jumps: Record<string, string> = { actionButtonForwardNext: 'nextslide', actionButtonBackPrevious: 'previousslide', actionButtonBeginning: 'firstslide', actionButtonEnd: 'lastslide', actionButtonHome: 'firstslide', actionButtonReturn: 'lastslideviewed' };
  const tIds = textLinks.map((L) => { const id: string = lk(L.feature, L.tag, L.spec, (v) => L.check(v, id), L.basis); return id; });
  const sIds = shapeLinks.map((L) => { const id: string = lk(L.feature, L.tag, L.spec, (v) => L.check(v, id), L.basis); return id; });
  const picLink: string = lk('Link on a picture', 'supported', '§19.3.1.12 cNvPr hlinkClick on p:pic', (v) => !!kid(kid(kid(namedShape(v, picLink, SLIDES, ['pic']), 'p:nvPicPr'), 'p:cNvPr'), 'a:hlinkClick'), 'pptx-read.ts:1554');
  const bIds = buttons.map((b) => { const id: string = lk(`Action button ${b.replace('actionButton', '')}`, 'loss', `§20.1.10.56 ${b}; Insert ▸ Shapes ▸ Action Buttons`, (v) => at(kid(spPrOf(shapeOf(v, id)), 'a:prstGeom') ?? null, 'prst') === b, 'design/geo.ts GEOS has no action buttons (comes in as a box)'); return id; });
  const abLink: string = lk('Action button Next keeps its Next Slide action', 'supported', 'ppaction://hlinkshowjump?jump=nextslide on an action button', (v) => { const e = v.all(SLIDES, 'p:sp').find((x) => (kid(x, 'p:txBody')?.textContent ?? '').includes(`${abLink} `)); return at(kid(kid(kid(e, 'p:nvSpPr'), 'p:cNvPr'), 'a:hlinkClick') ?? null, 'action') === 'ppaction://hlinkshowjump?jump=nextslide'; }, 'pptx-read.ts:2028 native() link (but the box path?)');
  slides.push({ body: (s) => {
    s.grid(4, 8, 20);
    const t = textLinks.map((L, k) => { const id = tIds[k]; return textBox(s.id(), `${id} link`, s.cell(), para(r(`${id} ${L.feature}`, 'sz="1000"', L.link(s)))); }).join('');
    const sh = shapeLinks.map((L, k) => { const id = sIds[k]; return sp({ id: s.id(), name: `${id} linked shape`, links: L.link(s), box: s.cell(), geom: prst('roundRect'), fmt: solid('8AB17D'), body: txBody(para(r(`${id} ${L.feature}`, 'sz="900"'), 'algn="ctr"'), '<a:bodyPr anchor="ctr"/>') }); }).join('');
    const pl = pic({ id: s.id(), name: `${picLink} linked picture`, links: `<a:hlinkClick r:id="${s.rel(REL.hyperlink, 'https://example.com/picture', true)}"/>`, rid: s.media('linked.png', png(32, 24)), box: s.cell() });
    s.grid(6, 8, 20);
    for (let k = 0; k < 30; k++) s.cell();
    const ab = buttons.map((b, k) => {
      const id = bIds[k];
      const jump = jumps[b];
      return sp({ id: s.id(), name: `${id} ${b}`, links: jump ? `<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=${jump}" highlightClick="1"/>` : '<a:hlinkClick r:id="" action="ppaction://noaction" highlightClick="1"/>', box: s.cell(), geom: prst(b), fmt: solid('1B7F79') + line(1, solid('1F3A4D')), body: txBody(para(r(id, 'sz="700"'), 'algn="ctr"'), '<a:bodyPr anchor="b"/>') });
    }).join('');
    const abn = sp({ id: s.id(), name: `${abLink} next button`, links: '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide" highlightClick="1"/>', box: s.cell(), geom: prst('actionButtonForwardNext'), fmt: solid('C8553D'), body: txBody(para(r(`${abLink} next`, 'sz="700"'), 'algn="ctr"'), '<a:bodyPr anchor="b"/>') });
    return t + sh + pl + ab + abn;
  } });
}

// ---------------------------------------------------------------- embedded objects

const ob = itemList('P-OLE', items);
/** A ChemDraw drawing written here by hand: ethanol's three heavy atoms and two bonds. */
const CDXML = `<?xml version="1.0" encoding="UTF-8" ?><!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" ><CDXML BondLength="14.40" LabelFont="3" LabelSize="10"><fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 540 720"><fragment id="2"><n id="3" p="100 100"/><n id="4" p="112.47 107.2"/><n id="5" p="124.94 100" Element="8" NumHydrogens="1"><t p="121.6 103.6"><s font="3" size="10" face="96">OH</s></t></n><b id="6" B="3" E="4"/><b id="7" B="4" E="5"/></fragment></page></CDXML>`;
let OLE_BIN: Uint8Array | null = null;
const oleBin = () => (OLE_BIN ??= chemdrawObject(cdxmlToCdx(CDXML), 'ChemDraw.Document.6.0'));
const PREVIEW = png(60, 30, [255, 255, 255]);
const binHash = (b: Uint8Array) => { let h = 2166136261; for (const x of b) h = Math.imul(h ^ x, 16777619) >>> 0; return `${b.length}:${h}`; };
const oleFrame = (v: View, id: string) => v.all(SLIDES, 'p:graphicFrame').find((g) => { const c = kid(kid(g, 'p:nvGraphicFramePr'), 'p:cNvPr'); return ((at(c ?? null, 'name') ?? '') + (at(c ?? null, 'descr') ?? '')).includes(id); });
const oleObj = (v: View, id: string) => oleFrame(v, id)?.getElementsByTagNameNS(NS.p, 'oleObj')[0];
{
  const cd = ob('ChemDraw object (embedded, ChemDraw.Document.6.0)', 'supported', '§19.3.1.32 oleObj progId; Insert ▸ Object ▸ ChemDraw Document', (v) => /^ChemDraw/.test(at(oleObj(v, cd) ?? null, 'progId') ?? ''), 'pptx-read.ts:1304 chemdrawObject');
  const bin = ob('ChemDraw object data kept byte for byte', 'kept', '§19.3.1.32 oleObj r:id ▸ oleObject .bin', (v) => { const o = oleObj(v, bin); const p = o ? partOfEl(v, o) : undefined; const t = p ? relTarget(v, p, at(o!, 'r:id') ?? '') : undefined; return !!t && !!v.binary[t] && binHash(v.binary[t]) === binHash(oleBin()); }, 'pptx-write.ts:1336 keptChemdraw');
  const prev = ob('ChemDraw object picture (preview) kept', 'kept', '§19.3.1.37 pic inside oleObj', (v) => { const o = oleObj(v, prev); const b = o?.getElementsByTagNameNS(NS.a, 'blip')[0]; const p = o ? partOfEl(v, o) : undefined; const t = p && b ? relTarget(v, p, at(b, 'r:embed') ?? '') : undefined; return !!t && !!v.binary[t] && binHash(v.binary[t]) === binHash(PREVIEW); }, 'pptx-write.ts:1343');
  const size = ob('ChemDraw object image size (imgW, imgH) and name', 'kept', '§19.3.1.32 oleObj@imgW/@imgH/@name', (v) => { const o = oleObj(v, size); return at(o ?? null, 'imgW') === '1524000' && at(o ?? null, 'imgH') === '762000' && at(o ?? null, 'name') === 'ChemDraw Sampler Object'; }, 'pptx-write.ts:1349');
  const nm = ob('ChemDraw object frame name and alt text', 'kept', '§19.3.1.12 cNvPr@name/@descr on the frame', (v) => { const f = oleFrame(v, nm); const c = kid(kid(f, 'p:nvGraphicFramePr'), 'p:cNvPr'); return (at(c ?? null, 'name') ?? '').includes(nm) && (at(c ?? null, 'descr') ?? '').includes('ethanol'); }, 'pptx-write.ts:1346');
  const pos = ob('ChemDraw object position and size', 'supported', '§19.3.1.21 graphicFrame xfrm', (v) => { const b = boxOf(oleFrame(v, pos)); return !!b && Math.abs(b[0] - 60) < 0.5 && Math.abs(b[1] - 80) < 0.5 && Math.abs(b[2] - 120) < 0.5 && Math.abs(b[3] - 60) < 0.5; }, 'pptx-write.ts:1347');
  const xl = ob('Excel worksheet object (Excel.Sheet.12, embedded package)', 'loss', '§19.3.1.32 oleObj progId Excel.Sheet.12 with a package; Insert ▸ Object ▸ Microsoft Excel Worksheet', (v) => at(oleObj(v, xl) ?? null, 'progId') === 'Excel.Sheet.12', 'pptx-read.ts:1305 (other objects come in as their picture)');
  const xlPic = ob('Excel worksheet object shown as its picture', 'supported', '§19.3.1.37 pic in oleObj (as a picture)', (v) => !!oleFrame(v, xlPic) || v.all(SLIDES, 'p:pic').some((p) => (at(kid(kid(p, 'p:nvPicPr'), 'p:cNvPr') ?? null, 'name') ?? '').includes(xlPic)), 'pptx-read.ts:1311');
  const icon = ob('Object displayed as icon', 'loss', '§19.3.1.32 oleObj@showAsIcon; Insert ▸ Object ▸ Display as icon', (v) => at(oleObj(v, icon) ?? null, 'showAsIcon') === '1', 'pptx-read.ts:1305');
  const linked = ob('Linked object (p:link)', 'loss', '§19.3.1.31 link in oleObj; Insert ▸ Object ▸ Link', (v) => !!oleObj(v, linked)?.getElementsByTagNameNS(NS.p, 'link')[0], 'pptx-read.ts:1305');
  slides.push({ body: (s) => {
    const cdRid = s.part('embeddings/oleObject1.bin', oleBin(), undefined, REL.oleObject);
    const pv = s.media('chemdraw-preview.png', PREVIEW);
    const xlsx = workbook([['A1', `${xl} sheet`], ['B1', 42], ['A2', 'yield'], ['B2', 0.87]]);
    const xRid = s.part('embeddings/Sampler_Object_Worksheet1.xlsx', xlsx, undefined, REL.package);
    const xPic = s.media('excel-preview.png', png(80, 40, [138, 177, 125]));
    const iRid = s.part('embeddings/Sampler_Object_Worksheet2.xlsx', xlsx, undefined, REL.package);
    const iPic = s.media('icon-preview.png', png(32, 32, [58, 134, 255]));
    const lRid = s.rel(REL.oleObject, 'file:///C:/Samples/linked.xlsx', true);
    const lPic = s.media('linked-preview.png', png(80, 40, [242, 165, 65]));
    const of = (id: number, name: string, descr: string, b: Box, obj: string) => frame({ id, name, descr, box: b, uri: 'http://schemas.openxmlformats.org/presentationml/2006/ole', locks: '<a:graphicFrameLocks noChangeAspect="1"/>', data: obj });
    const inner = (rid: string, b: Box) => pic({ id: 0, name: '', rid, box: b });
    return label(s, `${cd} ${bin} ${prev} ${size} ${nm} ${pos} ChemDraw object; ${xl} ${xlPic} ${icon} ${linked} other objects`, [30, 10, 800, 30])
      + of(s.id(), `${nm} ChemDraw object`, `${nm} ${cd} ${bin} ${prev} ${size} ${pos} ethanol drawn in ChemDraw`, [60, 80, 120, 60], `<p:oleObj name="ChemDraw Sampler Object" r:id="${cdRid}" imgW="1524000" imgH="762000" progId="ChemDraw.Document.6.0"><p:embed/>${inner(pv, [60, 80, 120, 60])}</p:oleObj>`)
      + of(s.id(), `${xl} ${xlPic} Excel object`, `${xl} worksheet`, [260, 80, 160, 80], `<p:oleObj name="Worksheet" r:id="${xRid}" imgW="2032000" imgH="1016000" progId="Excel.Sheet.12"><p:embed/>${inner(xPic, [260, 80, 160, 80])}</p:oleObj>`)
      + of(s.id(), `${icon} icon object`, `${icon} worksheet as icon`, [460, 80, 64, 64], `<p:oleObj showAsIcon="1" name="Worksheet" r:id="${iRid}" imgW="812800" imgH="812800" progId="Excel.Sheet.12"><p:embed/>${inner(iPic, [460, 80, 64, 64])}</p:oleObj>`)
      + of(s.id(), `${linked} linked object`, `${linked} linked worksheet`, [560, 80, 160, 80], `<p:oleObj name="Linked Worksheet" r:id="${lRid}" imgW="2032000" imgH="1016000" progId="Excel.Sheet.12"><p:link updateAutomatic="1"/>${inner(lPic, [560, 80, 160, 80])}</p:oleObj>`);
  } });
}
void [allNs, NOFILL, CT];

export const pptxObjects: Sampler = {
  name: 'pptx-objects.pptx', area: 'PowerPoint objects: tables, charts, SmartArt, pictures, sound, links and action buttons, embedded objects (ChemDraw, Excel)', items,
  // a custom show for the custom show link (P-LNK) to go to: PowerPoint refuses a link to a show that isn't there
  build: () => deckFile({ title: 'PowerPoint sampler: objects', slides, custShows: (rids) => `<p:custShowLst><p:custShow name="Sampler links show" id="0"><p:sldLst><p:sld r:id="${rids[0]}"/></p:sldLst></p:custShow></p:custShowLst>` }),
};
