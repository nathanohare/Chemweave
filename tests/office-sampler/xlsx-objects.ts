/**
 * Excel sampler: objects on a sheet. Charts of several kinds (X-CHT) on the Charts sheet, each with
 * its id in its title; pictures, shapes, text boxes, lines and groups (X-DRW) on the Objects sheet,
 * each named by its id (Selection Pane name, cNvPr@name).
 * ECMA-376 Part 1 §20.5 (SpreadsheetML drawing: §20.5.2.33 twoCellAnchor, §20.5.2.25 pic,
 * §20.5.2.29 sp, §20.5.2.19 cxnSp, §20.5.2.17 grpSp, §20.5.2.16 graphicFrame), §21.2 (charts:
 * §21.2.2.16 barChart, lineChart, pieChart…), §20.1 DrawingML; MS-ODRAWXML chartEx (Excel 2016
 * charts); Excel's Insert ▸ Pictures, Shapes, Text Box, Charts.
 *
 * Tags from src/io/xlsx-print.ts readObjects (:284) and objectAnchorXml (:196): presets in PRESET
 * (:184) and KIND_OF (:240) are read with their solid fill, line, rotation, flips, name, descr and
 * text; other shapes, custom geometry and groups are left out (with a warning). Charts:
 * src/io/xlsx-chart.ts readChartXml (:602; scatter, line, bar, area, pie, doughnut, bubble, radar,
 * 3-D line/bar/pie/area), the part kept as written while unchanged (writeKeptChart; xlsx.ts:968);
 * stock, surface and bar-of-pie aren't read; chartEx histogram and box & whisker are read and
 * written again (readChartExXml :329), other chartEx kinds aren't.
 */
import { type Item, type Sampler, type View, itemList, esc, png, NS } from './kit';
import { Book, relsOf, sheetNamed, isOn } from './xlsx';

const items: Item[] = [];
const book = new Book();
type Tag = 'supported' | 'kept' | 'loss';
const DRAWING_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const DRAWING_CT = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const CHART_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const CHART_CT = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CHARTEX_REL = 'http://schemas.microsoft.com/office/2014/relationships/chartEx';
const CHARTEX_CT = 'application/vnd.ms-office.chartex+xml';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const A = NS.a;
const XDR = NS.xdr;
const C = NS.c;
const EMU = 9525;

/** An anchor from (col, row) to (col2, row2), with `body` (pic, sp, cxnSp, grpSp or graphicFrame). */
const anchor = (c1: number, r1: number, c2: number, r2: number, body: string, editAs = '') => `<xdr:twoCellAnchor${editAs ? ` editAs="${editAs}"` : ''}>`
  + `<xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
  + `<xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${body}<xdr:clientData/></xdr:twoCellAnchor>`;
const xfrm = (c1: number, r1: number, w: number, h: number, attrs = '') => `<a:xfrm${attrs}><a:off x="${c1 * 64 * EMU}" y="${r1 * 20 * EMU}"/><a:ext cx="${w * 64 * EMU}" cy="${h * 20 * EMU}"/></a:xfrm>`;

// ---------------------------------------------------------------------------------------------
// Charts (X-CHT): Insert ▸ Charts

const charts = book.sheet('Charts');
charts.text('A1', 'Series'); ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q, k) => charts.text(`${'BCDE'[k]}1`, q));
charts.text('A2', 'North'); [12, 18, 9, 22].forEach((n, k) => charts.num(`${'BCDE'[k]}2`, n));
charts.text('A3', 'South'); [8, 14, 16, 11].forEach((n, k) => charts.num(`${'BCDE'[k]}3`, n));
charts.text('A4', 'Size'); [3, 6, 2, 8].forEach((n, k) => charts.num(`${'BCDE'[k]}4`, n));
charts.text('A5', 'Close'); [10, 12, 11, 13].forEach((n, k) => charts.num(`${'BCDE'[k]}5`, n));
for (let k = 0; k < 12; k++) charts.num(`G${k + 1}`, [3, 5, 5, 6, 7, 7, 7, 8, 9, 12, 13, 15][k]);
charts.next = 7;
const cht = itemList('X-CHT', items);
const chartAnchors: string[] = [];
let chartNo = 0;
let frameId = 2;

/** The chart parts (c: or cx:) whose title text holds `id`. */
function chartsHolding(v: View, id: string): Element[] {
  return v.partsLike(/^xl\/charts\/chart(Ex)?\d+\.xml$/).map((p) => v.doc(p)!.documentElement).filter((root) => (root.textContent ?? '').includes(id));
}
const strRef = (f: string, vals: string[]) => `<c:strRef><c:f>${f}</c:f><c:strCache><c:ptCount val="${vals.length}"/>${vals.map((x, i) => `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`;
const numRef = (f: string, vals: number[]) => `<c:numRef><c:f>${f}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((x, i) => `<c:pt idx="${i}"><c:v>${x}</c:v></c:pt>`).join('')}</c:numCache></c:numRef>`;
const Q = ['Q1', 'Q2', 'Q3', 'Q4'];
const ROW = (r: number) => [[12, 18, 9, 22], [8, 14, 16, 11], [3, 6, 2, 8], [10, 12, 11, 13]][r - 2];
const tx = (r: number) => `<c:tx>${strRef(`Charts!$A$${r}`, [['North', 'South', 'Size', 'Close'][r - 2]])}</c:tx>`;
const cat = `<c:cat>${strRef('Charts!$B$1:$E$1', Q)}</c:cat>`;
const valOf = (r: number) => `<c:val>${numRef(`Charts!$B$${r}:$E$${r}`, ROW(r))}</c:val>`;
const xValOf = (r: number) => `<c:xVal>${numRef(`Charts!$B$${r}:$E$${r}`, ROW(r))}</c:xVal>`;
const yValOf = (r: number) => `<c:yVal>${numRef(`Charts!$B$${r}:$E$${r}`, ROW(r))}</c:yVal>`;
const catAx = (id: number, cross: number, pos = 'b', del = false) => `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${del ? 1 : 0}"/><c:axPos val="${pos}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
const valAx = (id: number, cross: number, pos = 'l', extra = '') => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${extra}</c:scaling><c:delete val="0"/><c:axPos val="${pos}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
const serAx = (id: number, cross: number) => `<c:serAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:serAx>`;
const AXES = catAx(100, 200) + valAx(200, 100);
const title = (text: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
const legend = '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend>';

/** A chart item: a chart part with `plot` (the plot area's chart groups and axes), title holding the id. */
function chart(feature: string, tag: Tag, spec: string, plot: string, check: (roots: Element[]) => boolean, o: { basis?: string; view3D?: string; chartSpace?: string; legend?: string } = {}): string {
  const id = cht(feature, tag, spec, (v) => check(chartsHolding(v, id)), o.basis ?? 'xlsx-chart.ts:602 readChartXml; kept part while unchanged (xlsx.ts:968)');
  const n = ++chartNo;
  const r = charts.item(id, feature);
  book.part(`xl/charts/chart${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${NS.r}">`
    + `<c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${title(`${id} ${feature}`)}<c:autoTitleDeleted val="0"/>${o.view3D ?? ''}<c:plotArea><c:layout/>${plot}</c:plotArea>${o.legend ?? legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>`
    + `${o.chartSpace ?? ''}<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`, CHART_CT);
  const rid = book.pkg.rel('xl/drawings/drawing1.xml', CHART_REL, `../charts/chart${n}.xml`);
  chartAnchors.push(anchor(8, r * 15, 15, r * 15 + 14, `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${frameId++}" name="Chart ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame>`));
  return id;
}
const groupIn = (roots: Element[], local: string) => roots.flatMap((r) => Array.from(r.getElementsByTagNameNS(C, local)));
const v = (el: Element | undefined, local: string) => (el ? Array.from(el.children).find((k) => k.namespaceURI === C && k.localName === local)?.getAttribute('val') : undefined);
const bar = (dir: string, grouping: string, extra = '') => `<c:barChart><c:barDir val="${dir}"/><c:grouping val="${grouping}"/><c:varyColors val="0"/>`
  + [2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}<c:invertIfNegative val="0"/>${cat}${valOf(r)}</c:ser>`).join('')
  + `<c:gapWidth val="150"/>${grouping === 'clustered' ? '' : '<c:overlap val="100"/>'}${extra}<c:axId val="100"/><c:axId val="200"/></c:barChart>${dir === 'bar' ? catAx(100, 200, 'l') + valAx(200, 100, 'b') : AXES}`;
const CH = '§21.2 DrawingML charts; Insert ▸ Charts';
chart('Clustered column', 'supported', `${CH}, §21.2.2.16 barChart`, bar('col', 'clustered'), (rs) => groupIn(rs, 'barChart').some((g) => v(g, 'barDir') === 'col' && v(g, 'grouping') === 'clustered'));
chart('Stacked bar (horizontal)', 'supported', `${CH}, barChart barDir bar, grouping stacked`, bar('bar', 'stacked'), (rs) => groupIn(rs, 'barChart').some((g) => v(g, 'barDir') === 'bar' && v(g, 'grouping') === 'stacked'));
chart('100% stacked column', 'supported', `${CH}, grouping percentStacked`, bar('col', 'percentStacked'), (rs) => groupIn(rs, 'barChart').some((g) => v(g, 'grouping') === 'percentStacked'));
chart('Line with markers', 'supported', `${CH}, §21.2.2.97 lineChart`, '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
  + [2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${cat}${valOf(r)}<c:smooth val="0"/></c:ser>`).join('')
  + `<c:marker val="1"/><c:axId val="100"/><c:axId val="200"/></c:lineChart>${AXES}`, (rs) => groupIn(rs, 'lineChart').length > 0 && groupIn(rs, 'symbol').some((s) => s.getAttribute('val') === 'circle'));
chart('Pie with data labels', 'supported', `${CH}, §21.2.2.141 pieChart`, `<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>${cat}${valOf(2)}</c:ser><c:firstSliceAng val="0"/></c:pieChart>`,
  (rs) => groupIn(rs, 'pieChart').length > 0 && groupIn(rs, 'showPercent').some((s) => s.getAttribute('val') === '1'));
chart('Doughnut', 'supported', `${CH}, §21.2.2.50 doughnutChart`, `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}${cat}${valOf(2)}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`,
  (rs) => groupIn(rs, 'doughnutChart').length > 0 && groupIn(rs, 'holeSize').some((s) => s.getAttribute('val') === '50'));
chart('Area, stacked', 'supported', `${CH}, §21.2.2.5 areaChart`, `<c:areaChart><c:grouping val="stacked"/><c:varyColors val="0"/>${[2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}${cat}${valOf(r)}</c:ser>`).join('')}<c:axId val="100"/><c:axId val="200"/></c:areaChart>${AXES}`,
  (rs) => groupIn(rs, 'areaChart').some((g) => v(g, 'grouping') === 'stacked'));
chart('Scatter with straight lines', 'supported', `${CH}, §21.2.2.161 scatterChart`, `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(3)}<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="C8553D"/></a:solidFill></a:ln></c:spPr>${xValOf(2)}${yValOf(3)}<c:smooth val="0"/></c:ser><c:axId val="100"/><c:axId val="200"/></c:scatterChart>${valAx(100, 200, 'b')}${valAx(200, 100, 'l')}`,
  (rs) => groupIn(rs, 'scatterChart').length > 0 && rs.some((r) => Array.from(r.getElementsByTagNameNS(A, 'srgbClr')).some((c) => c.getAttribute('val') === 'C8553D')));
chart('Bubble', 'supported', `${CH}, §21.2.2.20 bubbleChart`, `<c:bubbleChart><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}<c:invertIfNegative val="0"/>${xValOf(2)}${yValOf(3)}<c:bubbleSize>${numRef('Charts!$B$4:$E$4', ROW(4))}</c:bubbleSize><c:bubble3D val="0"/></c:ser><c:bubbleScale val="100"/><c:showNegBubbles val="0"/><c:axId val="100"/><c:axId val="200"/></c:bubbleChart>${valAx(100, 200, 'b')}${valAx(200, 100, 'l')}`,
  (rs) => groupIn(rs, 'bubbleChart').length > 0);
chart('Filled radar', 'supported', `${CH}, §21.2.2.153 radarChart`, `<c:radarChart><c:radarStyle val="filled"/><c:varyColors val="0"/>${[2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}${cat}${valOf(r)}</c:ser>`).join('')}<c:axId val="100"/><c:axId val="200"/></c:radarChart>${AXES}`,
  (rs) => groupIn(rs, 'radarChart').some((g) => v(g, 'radarStyle') === 'filled'));
chart('3-D clustered column', 'supported', `${CH}, §21.2.2.15 bar3DChart, §21.2.2.228 view3D`, `<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${[2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}<c:invertIfNegative val="0"/>${cat}${valOf(r)}</c:ser>`).join('')}<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="100"/><c:axId val="200"/><c:axId val="0"/></c:bar3DChart>${AXES}`,
  (rs) => groupIn(rs, 'bar3DChart').length > 0 && groupIn(rs, 'rotX').some((r) => r.getAttribute('val') === '15'), { view3D: '<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:rAngAx val="1"/></c:view3D>' });
chart('3-D pie', 'supported', `${CH}, §21.2.2.140 pie3DChart`, `<c:pie3DChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}${cat}${valOf(2)}</c:ser></c:pie3DChart>`,
  (rs) => groupIn(rs, 'pie3DChart').length > 0, { view3D: '<c:view3D><c:rotX val="30"/><c:rotY val="0"/><c:rAngAx val="0"/></c:view3D>' });
chart('Combo: columns and a line on a secondary axis', 'supported', `${CH}; Insert ▸ Combo Chart`, `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}<c:invertIfNegative val="0"/>${cat}${valOf(2)}</c:ser><c:gapWidth val="150"/><c:axId val="100"/><c:axId val="200"/></c:barChart>`
  + `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="1"/><c:order val="1"/>${tx(3)}<c:marker><c:symbol val="none"/></c:marker>${cat}${valOf(3)}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="300"/><c:axId val="400"/></c:lineChart>`
  + `${AXES}${catAx(300, 400, 'b', true)}${valAx(400, 300, 'r').replace('<c:crosses val="autoZero"/>', '<c:crosses val="max"/>').replace('<c:majorGridlines/>', '')}`,
  (rs) => groupIn(rs, 'barChart').length > 0 && groupIn(rs, 'lineChart').length > 0);
chart('Trendline and error bars', 'supported', `${CH}, §21.2.2.211 trendline, §21.2.2.55 errBars`, `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}<c:spPr><a:ln w="25400"><a:noFill/></a:ln></c:spPr><c:trendline><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline><c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="percentage"/><c:noEndCap val="0"/><c:val val="10"/></c:errBars>${xValOf(3)}${yValOf(2)}<c:smooth val="0"/></c:ser><c:axId val="100"/><c:axId val="200"/></c:scatterChart>${valAx(100, 200, 'b')}${valAx(200, 100, 'l')}`,
  (rs) => groupIn(rs, 'trendlineType').some((t) => t.getAttribute('val') === 'linear') && groupIn(rs, 'errBars').length > 0);
chart('Axis titles, fixed bounds and number format', 'supported', `${CH}, §21.2.2.226 valAx, scaling min/max`, bar('col', 'clustered').replace('<c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>', '<c:orientation val="minMax"/><c:max val="30"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>'),
  (rs) => groupIn(rs, 'max').some((m) => m.getAttribute('val') === '30'));
chart('Chart without a legend, transparent background', 'supported', `${CH}, §21.2.2.93 legend; Format Chart Area ▸ No fill`, bar('col', 'clustered'),
  (rs) => groupIn(rs, 'legend').length === 0 && rs.some((r) => !!Array.from(r.children).find((k) => k.localName === 'spPr')?.getElementsByTagNameNS(A, 'noFill').length), { legend: '', chartSpace: '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' });
chart('Stock (high-low-close)', 'loss', `${CH}, §21.2.2.198 stockChart`, `<c:stockChart>${[2, 3, 5].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}${valOf(r)}<c:smooth val="0"/></c:ser>`).join('')}<c:hiLowLines/><c:axId val="100"/><c:axId val="200"/></c:stockChart>${AXES}`,
  (rs) => groupIn(rs, 'stockChart').length > 0, { basis: 'xlsx-chart.ts:607 (not a kind read: left out, with a warning)' });
chart('Surface (3-D)', 'loss', `${CH}, §21.2.2.203 surface3DChart`, `<c:surface3DChart><c:wireframe val="0"/>${[2, 3].map((r, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(r)}${cat}${valOf(r)}</c:ser>`).join('')}<c:axId val="100"/><c:axId val="200"/><c:axId val="300"/></c:surface3DChart>${AXES}${serAx(300, 200)}`,
  (rs) => groupIn(rs, 'surface3DChart').length > 0, { basis: 'xlsx-chart.ts:607', view3D: '<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:rAngAx val="0"/><c:perspective val="30"/></c:view3D>' });
chart('Bar of pie', 'loss', `${CH}, §21.2.2.126 ofPieChart`, `<c:ofPieChart><c:ofPieType val="bar"/><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${tx(2)}${cat}${valOf(2)}</c:ser><c:gapWidth val="100"/><c:secondPieSize val="75"/><c:serLines/></c:ofPieChart>`,
  (rs) => groupIn(rs, 'ofPieChart').length > 0, { basis: 'xlsx-chart.ts:607' });

/** The entries of a chart style part, in the order MS-ODRAWXML 2.3.4.2 gives them. */
const STYLE_ENTRIES = ['axisTitle', 'categoryAxis', 'chartArea', 'dataLabel', 'dataPoint', 'dataPoint3D', 'dataPointLine', 'dataPointMarker',
  'dataPointWireframe', 'dataTable', 'downBar', 'dropLine', 'errorBar', 'floor', 'gridlineMajor', 'gridlineMinor', 'hiLoLine', 'leaderLine',
  'legend', 'plotArea', 'plotArea3D', 'seriesAxis', 'seriesLine', 'title', 'trendline', 'trendlineLabel', 'upBar', 'valueAxis', 'wall'];

/** A chartEx item (Excel 2016 charts): the part and an AlternateContent frame as Excel writes it. */
function chartEx(feature: string, tag: Tag, layout: string, data: string, check: (roots: Element[]) => boolean, basis: string): string {
  const id = cht(feature, tag, 'MS-ODRAWXML chartEx (cx:chartSpace); Insert ▸ Statistic / Hierarchy Chart', (vw) => check(chartsHolding(vw, id).concat(vw.partsLike(/^xl\/charts\/chartEx\d+\.xml$/).map((p) => vw.doc(p)!.documentElement).filter((r) => tag === 'supported' && r.getElementsByTagNameNS(CX, 'series')[0]?.getAttribute('layoutId') === layout))), basis);
  const n = ++chartNo;
  const r = charts.item(id, feature);
  book.part(`xl/charts/chartEx${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:a="${A}" xmlns:r="${NS.r}" xmlns:cx="${CX}">`
    + `<cx:chartData>${data}</cx:chartData><cx:chart><cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>${esc(`${id} ${feature}`)}</cx:v></cx:txData></cx:tx></cx:title>`
    + `<cx:plotArea><cx:plotAreaRegion><cx:series layoutId="${layout}" uniqueId="{${String(n).padStart(8, '0')}-0000-4000-8000-000000000000}"><cx:tx><cx:txData><cx:f>Charts!$G$1</cx:f><cx:v>${esc(`${id} series`)}</cx:v></cx:txData></cx:tx><cx:dataId val="0"/>${layout === 'clusteredColumn' ? '<cx:layoutPr><cx:binning intervalClosed="r"><cx:binCount val="4"/></cx:binning></cx:layoutPr>' : '<cx:layoutPr><cx:parentLabelLayout val="overlapping"/></cx:layoutPr>'}</cx:series></cx:plotAreaRegion>`
    + `${layout === 'clusteredColumn' ? '<cx:axis id="0"><cx:catScaling gapWidth="0"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' : ''}</cx:plotArea></cx:chart></cx:chartSpace>`, CHARTEX_CT);
  // Office writes a style and a colors part with every chartEx and refuses one without them
  // (MS-ODRAWXML 2.3.4.2 chartStyle, 2.3.4.3 colorStyle): plain ones, written here
  const CS = 'http://schemas.microsoft.com/office/drawing/2012/chartStyle';
  const entry = (t: string) => `<cs:${t}><cs:lnRef idx="0"/><cs:fillRef idx="0"/><cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef></cs:${t}>`;
  book.part(`xl/charts/style${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cs:chartStyle xmlns:cs="${CS}" xmlns:a="${A}" id="395">${STYLE_ENTRIES.map(entry).join('')}</cs:chartStyle>`, 'application/vnd.ms-office.chartstyle+xml');
  book.part(`xl/charts/colors${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cs:colorStyle xmlns:cs="${CS}" xmlns:a="${A}" meth="cycle" id="10">${[1, 2, 3, 4, 5, 6].map((i) => `<a:schemeClr val="accent${i}"/>`).join('')}</cs:colorStyle>`, 'application/vnd.ms-office.chartcolorstyle+xml');
  book.pkg.rel(`xl/charts/chartEx${n}.xml`, 'http://schemas.microsoft.com/office/2011/relationships/chartStyle', `style${n}.xml`);
  book.pkg.rel(`xl/charts/chartEx${n}.xml`, 'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle', `colors${n}.xml`);
  const rid = book.pkg.rel('xl/drawings/drawing1.xml', CHARTEX_REL, `../charts/chartEx${n}.xml`);
  chartAnchors.push(anchor(8, r * 15, 15, r * 15 + 14, `<mc:AlternateContent xmlns:mc="${NS.mc}"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${frameId++}" name="Chart ${n}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart xmlns:cx="${CX}" r:id="${rid}"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>`
    + `<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${frameId++}" name="Chart ${n} fallback"/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr><xdr:spPr>${xfrm(8, r * 15, 7, 14)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>`
    + '<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>This chart isn\'t available in your version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent>'));
  return id;
}
const histData = `<cx:data id="0"><cx:numDim type="val"><cx:f>Charts!$G$1:$G$12</cx:f><cx:lvl ptCount="12" formatCode="General">${[3, 5, 5, 6, 7, 7, 7, 8, 9, 12, 13, 15].map((x, i) => `<cx:pt idx="${i}">${x}</cx:pt>`).join('')}</cx:lvl></cx:numDim></cx:data>`;
chartEx('Histogram (4 bins)', 'supported', 'clusteredColumn', histData, (rs) => rs.some((r) => r.getElementsByTagNameNS(CX, 'binning').length > 0), 'xlsx-chart.ts:329 readChartExXml, :286 chartExXml (written again)');
chartEx('Treemap', 'loss', 'treemap', `<cx:data id="0"><cx:strDim type="cat"><cx:f>Charts!$B$1:$E$1</cx:f><cx:lvl ptCount="4">${Q.map((q, i) => `<cx:pt idx="${i}">${q}</cx:pt>`).join('')}</cx:lvl></cx:strDim><cx:numDim type="size"><cx:f>Charts!$B$2:$E$2</cx:f><cx:lvl ptCount="4" formatCode="General">${ROW(2).map((x, i) => `<cx:pt idx="${i}">${x}</cx:pt>`).join('')}</cx:lvl></cx:numDim></cx:data>`,
  (rs) => rs.some((r) => r.getElementsByTagNameNS(CX, 'series')[0]?.getAttribute('layoutId') === 'treemap'), 'xlsx-chart.ts:339 (only histogram and box & whisker read)');

// ---------------------------------------------------------------------------------------------
// Pictures, shapes, text boxes, lines and groups (X-DRW): Insert ▸ Illustrations

const obj = book.sheet('Objects');
obj.set('cols', '<cols><col min="1" max="1" width="50" customWidth="1"/></cols>');
const drw = itemList('X-DRW', items);
const objAnchors: string[] = [];
let objId = 2;
let pics = 0;

/** The drawing element (pic, sp, cxnSp, grpSp) whose cNvPr name starts with `id`, on the Objects sheet. */
function shapeOf(vw: View, id: string): Element | undefined {
  const s = sheetNamed(vw, 'Objects');
  const p = s ? relsOf(vw, s.path).find((r) => r.type === DRAWING_REL)?.target : undefined;
  const d = p ? vw.doc(p) : undefined;
  if (!d) return undefined;
  const nv = Array.from(d.getElementsByTagNameNS(XDR, 'cNvPr')).find((c) => (c.getAttribute('name') ?? '').startsWith(id));
  return nv?.parentElement?.parentElement ?? undefined;
}
const spPr = (el: Element | undefined) => (el ? Array.from(el.children).find((k) => k.localName === 'spPr') : undefined);
const aKid = (el: Element | undefined, local: string) => (el ? Array.from(el.children).find((k) => k.namespaceURI === A && k.localName === local) : undefined);
const aAll = (el: Element | undefined, local: string) => (el ? Array.from(el.getElementsByTagNameNS(A, local)) : []);
const prst = (el: Element | undefined) => aKid(spPr(el), 'prstGeom')?.getAttribute('prst');
const fillHex = (el: Element | undefined) => aKid(aKid(spPr(el), 'solidFill'), 'srgbClr')?.getAttribute('val')?.toUpperCase();

/** An object item: `body(name, id, r)` makes the element (named by the id); anchored right of its label row. */
function object(feature: string, tag: Tag, spec: string, body: (name: string, nid: number, r: number) => string, check: (el: Element | undefined, vw: View) => boolean, basis = 'xlsx-print.ts:284 readObjects, :196 objectAnchorXml', editAs = ''): string {
  const id = drw(feature, tag, spec, (vw) => check(shapeOf(vw, id), vw), basis);
  const r = obj.item(id, feature);
  obj.row(r, 'ht="45" customHeight="1"');
  objAnchors.push(anchor(2, r, 5, r + 1, body(esc(`${id} ${feature}`), objId++, r), editAs));
  return id;
}
const shape = (geom: string, extra = '', text = '', cNvSpPr = '<xdr:cNvSpPr/>', xattrs = '') => (name: string, nid: number, r: number) => `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${nid}" name="${name}"/>${cNvSpPr}</xdr:nvSpPr>`
  + `<xdr:spPr>${xfrm(2, r, 3, 2, xattrs)}${geom}${extra}</xdr:spPr>${text ? `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/>${text}</xdr:txBody>` : ''}</xdr:sp>`;
const geom = (p: string) => `<a:prstGeom prst="${p}"><a:avLst/></a:prstGeom>`;
const solidF = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const D = '§20.5.2.29 sp, §20.1.9.18 prstGeom; Insert ▸ Shapes';

// pictures
const picture = (extraSpPr = '', blipExtra = '', descr = '', srcRect = '', xattrs = '') => (name: string, nid: number, r: number) => {
  const n = ++pics;
  book.part(`xl/media/image${n}.png`, png(48, 32, [220, 60 + n * 10, 60]));
  const rid = book.pkg.rel('xl/drawings/drawing2.xml', IMAGE_REL, `../media/image${n}.png`);
  return `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${nid}" name="${name}"${descr ? ` descr="${esc(descr)}"` : ''}/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
    + `<xdr:blipFill><a:blip xmlns:r="${NS.r}" r:embed="${rid}"${blipExtra ? `>${blipExtra}</a:blip>` : '/>'}${srcRect}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
    + `<xdr:spPr>${xfrm(2, r, 3, 2, xattrs)}${geom('rect')}${extraSpPr}</xdr:spPr></xdr:pic>`;
};
const P = '§20.5.2.25 pic; Insert ▸ Pictures';
object('Picture (PNG)', 'supported', P, picture(), (el, vw) => {
  const blip = aAll(el, 'blip')[0];
  const rid = blip?.getAttributeNS(NS.r, 'embed');
  const s = sheetNamed(vw, 'Objects');
  const dp = s ? relsOf(vw, s.path).find((r) => r.type === DRAWING_REL)?.target : undefined;
  const target = dp && rid ? relsOf(vw, dp).find((r) => r.id === rid)?.target : undefined;
  return el?.localName === 'pic' && !!target && !!vw.binary[target];
}, 'xlsx-print.ts:336, xlsx.ts:996', 'oneCell');
object('Picture alt text (descr)', 'supported', `${P}, cNvPr@descr; Format Picture ▸ Alt Text`, picture('', '', 'X-DRW alt text: a test picture'), (el) => !!el && Array.from(el.getElementsByTagNameNS(XDR, 'cNvPr'))[0]?.getAttribute('descr') === 'X-DRW alt text: a test picture', undefined, 'oneCell');
object('Picture cropped (srcRect)', 'loss', `${P}, §20.1.8.55 srcRect; Picture Format ▸ Crop`, picture('', '', '', '<a:srcRect l="10000" t="5000" r="20000" b="0"/>'), (el) => aAll(el, 'srcRect')[0]?.getAttribute('l') === '10000', 'xlsx-print.ts:336 (crop not read)', 'oneCell');
object('Picture with a border', 'supported', `${P}, §20.1.2.2.24 ln`, picture(`<a:ln w="28575">${solidF('1B7F79')}</a:ln>`), (el) => aKid(aKid(aKid(spPr(el), 'ln'), 'solidFill'), 'srgbClr')?.getAttribute('val')?.toUpperCase() === '1B7F79', 'xlsx-print.ts:340', 'oneCell');
object('Picture rotated 15°', 'supported', `${P}, §20.1.7.6 xfrm@rot`, picture('', '', '', '', ' rot="900000"'), (el) => aKid(spPr(el), 'xfrm')?.getAttribute('rot') === '900000', 'xlsx-print.ts:322', 'oneCell');
object('Picture moves and sizes with cells (twoCell)', 'supported', `${P}, §20.5.2.33 twoCellAnchor@editAs; Format Picture ▸ Properties`, picture(), (el) => el?.parentElement?.getAttribute('editAs') === 'twoCell' || (el?.parentElement?.localName === 'twoCellAnchor' && !el?.parentElement?.getAttribute('editAs')), 'xlsx-print.ts:326 placement', 'twoCell');
object('Picture recolored (grayscale)', 'loss', `${P}, §20.1.8.33 grayscl; Picture Format ▸ Color`, picture('', '<a:grayscl/>'), (el) => aAll(el, 'grayscl').length > 0, 'xlsx-print.ts:336 (picture effects not read)', 'oneCell');
// shapes
for (const p of ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star5', 'rightArrow', 'upArrow']) {
  object(`Shape ${p}`, 'supported', `${D}, §20.1.10.56 ST_ShapeType`, shape(geom(p), `${solidF('8AB17D')}<a:ln w="12700">${solidF('1F3A4D')}</a:ln>`),
    (el) => prst(el) === p && fillHex(el) === '8AB17D', 'xlsx-print.ts:184 PRESET');
}
for (const p of ['heart', 'cloud', 'flowChartMagneticDisk']) {
  object(`Shape ${p} (preset not drawn here)`, 'loss', `${D}, §20.1.10.56 ST_ShapeType`, shape(geom(p), solidF('F2A541')), (el) => prst(el) === p, 'xlsx-print.ts:362 (preset not in KIND_OF: left out)');
}
object('Shape from a flowchart preset drawn as a rectangle (flowChartProcess)', 'loss', `${D}`, shape(geom('flowChartProcess'), solidF('F2A541')), (el) => prst(el) === 'flowChartProcess', 'xlsx-print.ts:243 KIND_OF (read as rect)');
object('Freeform (custom geometry)', 'loss', '§20.1.9.8 custGeom; Insert ▸ Shapes ▸ Freeform', shape('<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100" h="100"><a:moveTo><a:pt x="0" y="100"/></a:moveTo><a:lnTo><a:pt x="50" y="0"/></a:lnTo><a:lnTo><a:pt x="100" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>', solidF('6A4C93')),
  (el) => aAll(el, 'custGeom').length > 0, 'xlsx-print.ts:361 (custGeom: left out)');
object('Shape rotated 30° and flipped', 'supported', `${D}, §20.1.7.6 xfrm@rot, @flipH`, shape(geom('rightArrow'), solidF('3A86FF'), '', '<xdr:cNvSpPr/>', ' rot="1800000" flipH="1"'),
  (el) => aKid(spPr(el), 'xfrm')?.getAttribute('rot') === '1800000' && isOn(aKid(spPr(el), 'xfrm')?.getAttribute('flipH')));
object('Shape with text', 'supported', `${D}, §20.5.2.36 txBody; type in a shape`, shape(geom('roundRect'), solidF('EEF2E6'), '<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>X-DRW text in a shape</a:t></a:r></a:p>'),
  (el) => aAll(el, 't').some((t) => t.textContent === 'X-DRW text in a shape'));
object('Shape gradient fill', 'loss', `${D}, §20.1.8.33 gradFill; Shape Format ▸ Shape Fill ▸ Gradient`, shape(geom('rect'), '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="1B7F79"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>'),
  (el) => aAll(el, 'gradFill').length > 0, 'xlsx-print.ts:263 fillOf (solid only)');
object('Shape dashed outline', 'loss', `${D}, §20.1.8.48 prstDash; Shape Outline ▸ Dashes`, shape(geom('rect'), `${solidF('FFFFFF')}<a:ln w="19050">${solidF('C8553D')}<a:prstDash val="dash"/></a:ln>`),
  (el) => aAll(el, 'prstDash').some((d) => d.getAttribute('val') === 'dash'), 'xlsx-print.ts:213 (line color and width only)');
object('Shape shadow', 'loss', `${D}, §20.1.8.49 outerShdw; Shape Effects ▸ Shadow`, shape(geom('ellipse'), `${solidF('F2A541')}<a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a:prstClr val="black"><a:alpha val="40000"/></a:prstClr></a:outerShdw></a:effectLst>`),
  (el) => aAll(el, 'outerShdw').length > 0, 'xlsx-print.ts:196 (effects not written)');
object('Shape theme fill (Accent 2 via style)', 'supported', `${D}, §20.1.4.2.10 fillRef; Shape Styles`, (name, nid, r) => shape(geom('rect'))(name, nid, r).replace('</xdr:spPr>', '</xdr:spPr><xdr:style><a:lnRef idx="2"><a:schemeClr val="accent2"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent2"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style>'),
  (el) => fillHex(el) === 'C8553D' || aAll(Array.from(el?.children ?? []).find((k) => k.localName === 'style'), 'schemeClr').some((c) => c.getAttribute('val') === 'accent2'), 'xlsx-print.ts:350 (style fillRef read as its color)');
object('Shape link (hlinkClick)', 'loss', `${D}, §20.1.2.2.23 hlinkClick; Insert ▸ Link on a shape`, (name, nid, r) => {
  const rid = book.pkg.rel('xl/drawings/drawing2.xml', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'https://example.com/shape', true);
  return shape(geom('rect'), solidF('3A86FF'))(name, nid, r).replace(`name="${name}"/>`, `name="${name}"><a:hlinkClick xmlns:r="${NS.r}" r:id="${rid}"/></xdr:cNvPr>`);
}, (el) => aAll(el, 'hlinkClick').length > 0, 'xlsx-print.ts:196 (not written)');
// text boxes
const T = '§20.5.2.29 sp with cNvSpPr@txBox; Insert ▸ Text Box';
const tb = (text: string) => shape(geom('rect'), '<a:noFill/><a:ln><a:noFill/></a:ln>', text, '<xdr:cNvSpPr txBox="1"/>');
object('Text box', 'supported', T, tb('<a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>X-DRW a text box</a:t></a:r></a:p>'),
  (el) => isOn(Array.from(el?.getElementsByTagNameNS(XDR, 'cNvSpPr') ?? [])[0]?.getAttribute('txBox')) && aAll(el, 't').some((t) => t.textContent === 'X-DRW a text box'));
object('Text box: bold 14 pt colored Georgia', 'supported', `${T}; Home ▸ Font`, tb(`<a:p><a:r><a:rPr lang="en-US" sz="1400" b="1">${solidF('C8553D')}<a:latin typeface="Georgia"/></a:rPr><a:t>X-DRW styled text</a:t></a:r></a:p>`),
  (el) => { const r = aAll(el, 'rPr')[0]; return r?.getAttribute('sz') === '1400' && isOn(r?.getAttribute('b')) && aKid(r, 'latin')?.getAttribute('typeface') === 'Georgia' && aKid(aKid(r, 'solidFill'), 'srgbClr')?.getAttribute('val')?.toUpperCase() === 'C8553D'; });
object('Text box: two paragraphs, centered', 'supported', `${T}; Home ▸ Alignment`, tb('<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>X-DRW line one</a:t></a:r></a:p><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US"/><a:t>line two</a:t></a:r></a:p>'),
  (el) => aAll(el, 'p').length === 2 && aAll(el, 'pPr')[0]?.getAttribute('algn') === 'ctr');
object('Text box: text anchored at the bottom', 'supported', `${T}, §20.1.2.1.1 bodyPr@anchor`, (name, nid, r) => tb('<a:p><a:r><a:rPr lang="en-US"/><a:t>X-DRW bottom</a:t></a:r></a:p>')(name, nid, r).replace('anchor="t"', 'anchor="b"'),
  (el) => aAll(el, 'bodyPr')[0]?.getAttribute('anchor') === 'b');
object('Text box: mixed formatting in one paragraph', 'loss', `${T}; select part of the text ▸ Font`, tb('<a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>X-DRW bold </a:t></a:r><a:r><a:rPr lang="en-US" i="1"/><a:t>then italic</a:t></a:r></a:p>'),
  (el) => aAll(el, 'rPr').some((r) => isOn(r.getAttribute('i'))) && aAll(el, 'rPr').some((r) => isOn(r.getAttribute('b'))), 'xlsx-print.ts:369 (the first run\'s look only)');
// lines and connectors
const CX_ = '§20.5.2.19 cxnSp; Insert ▸ Shapes ▸ Lines';
const line = (head = '', tail = '') => (name: string, nid: number, r: number) => `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${nid}" name="${name}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>`
  + `<xdr:spPr>${xfrm(2, r, 3, 1)}${geom('straightConnector1')}<a:ln w="19050">${solidF('1F3A4D')}${head}${tail}</a:ln></xdr:spPr></xdr:cxnSp>`;
object('Straight line', 'supported', CX_, line(), (el) => el?.localName === 'cxnSp' || prst(el) === 'line');
object('Arrow (line with an arrowhead)', 'supported', `${CX_}, §20.1.8.57 tailEnd`, line('', '<a:tailEnd type="triangle"/>'), (el) => aAll(el, 'tailEnd').some((t) => t.getAttribute('type') === 'triangle'));
object('Line color and width (3 pt, accent)', 'supported', `${CX_}, §20.1.2.2.24 ln@w`, line(), (el) => aKid(spPr(el), 'ln')?.getAttribute('w') === '19050' && aKid(aKid(aKid(spPr(el), 'ln'), 'solidFill'), 'srgbClr')?.getAttribute('val')?.toUpperCase() === '1F3A4D');
object('Arrow with an oval head at the start', 'loss', `${CX_}, §20.1.8.38 headEnd`, line('<a:headEnd type="oval"/>', '<a:tailEnd type="triangle"/>'), (el) => aAll(el, 'headEnd').some((t) => t.getAttribute('type') === 'oval'), 'xlsx-print.ts:213 (tail arrow only)');
// a group
object('Group of two shapes', 'loss', '§20.5.2.17 grpSp; select shapes ▸ Group', (name, nid, r) => `<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="${nid}" name="${name}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr>`
  + `<xdr:grpSpPr><a:xfrm><a:off x="${2 * 64 * EMU}" y="${r * 20 * EMU}"/><a:ext cx="${3 * 64 * EMU}" cy="${2 * 20 * EMU}"/><a:chOff x="${2 * 64 * EMU}" y="${r * 20 * EMU}"/><a:chExt cx="${3 * 64 * EMU}" cy="${2 * 20 * EMU}"/></a:xfrm></xdr:grpSpPr>`
  + shape(geom('ellipse'), solidF('F2A541'))(`${name} part 1`, objId++, r) + shape(geom('rect'), solidF('3A86FF'))(`${name} part 2`, objId++, r) + '</xdr:grpSp>',
(el) => el?.localName === 'grpSp', 'xlsx-print.ts:300 (groups left out, with a warning)');

let bytes: Uint8Array | undefined;
const wsDr = (anchors: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:r="${NS.r}">${anchors.join('')}</xdr:wsDr>`;
export const xlsxObjects: Sampler = {
  name: 'xlsx-objects.xlsx', area: 'Excel charts, pictures, shapes, text boxes, lines and groups', items,
  build: () => {
    if (bytes) return bytes;
    book.part('xl/drawings/drawing1.xml', wsDr(chartAnchors), DRAWING_CT);
    charts.set('drawing', `<drawing r:id="${charts.rel(DRAWING_REL, '../drawings/drawing1.xml')}"/>`);
    book.part('xl/drawings/drawing2.xml', wsDr(objAnchors), DRAWING_CT);
    obj.set('drawing', `<drawing r:id="${obj.rel(DRAWING_REL, '../drawings/drawing2.xml')}"/>`);
    return (bytes = book.build('Excel sampler: charts and objects'));
  },
};
