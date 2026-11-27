// @vitest-environment jsdom
//
// Review batch 17: reading and writing Excel workbooks (.xlsx). The files are built here, part by
// part, as ECMA-376 (5th edition) Part 1 lays them out, or saved here and then changed the way
// Excel changes them; the section each rule comes from is named beside its test.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeXlsx, readXlsx, structurePictures, type XlsxPictures } from '../src/io/xlsx';
import { Package, REL } from '../src/io/ooxml';
import { Workbook, makeStructure } from '../src/sheet/workbook';
import type { Contents } from '../src/model';
import { chartFromRange } from '../src/sheet/chart';
import { newValidation } from '../src/sheet/validation';
import { DEFAULT_COL_W } from '../src/sheet/layout';
import { gridOf, readGridName, moveFilter } from '../src/io/xlsx-relocate';
import type { ModelSheet } from '../src/io/xlsx';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const u8 = (s: string) => Uint8Array.from(strToU8(s));
const part = (bytes: Uint8Array, name: string) => strFromU8(unzipSync(bytes)[name]);
/** A saved file with some of its parts changed (as Excel would change them). */
function edit(bytes: Uint8Array, change: Record<string, (xml: string) => string>): Uint8Array {
  const files = unzipSync(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[k] = change[k] ? u8(change[k](strFromU8(v))) : Uint8Array.from(v);
  return zipSync(out);
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const WS = `${R}/worksheet`;

/** A workbook made the way Excel writes it: sheets (name and body), and any other parts with their relationships. */
function excelBook(sheets: [string, string][], extra: {
  workbook?: (sheetsXml: string) => string;
  parts?: { path: string; xml: string; type?: string; from?: string; rel?: string; target?: string }[];
} = {}): Uint8Array {
  const pkg = new Package();
  pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
  const list = sheets.map(([name], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="${pkg.relate('xl/workbook.xml', WS, `worksheets/sheet${i + 1}.xml`)}"/>`).join('');
  sheets.forEach(([, body], i) => pkg.add(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${MAIN}" xmlns:r="${R}">${body}</worksheet>`));
  for (const p of extra.parts ?? []) {
    pkg.add(p.path, p.xml, p.type);
    if (p.rel) pkg.relate(p.from ?? 'xl/workbook.xml', p.rel, p.target ?? p.path.replace(/^xl\//, ''));
  }
  pkg.add('xl/workbook.xml', extra.workbook?.(list) ?? `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${list}</sheets></workbook>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  return pkg.build();
}

const DATA = '<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>4</v></c></row><row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>5</v></c></row></sheetData>';

/** A sheet of three points with a drawing holding `anchors` (SpreadsheetML Drawing, 20.5), and a chart part if given. */
function withDrawing(anchors: string, chart?: string): Uint8Array {
  return excelBook([['Sheet1', `${DATA}<drawing r:id="rId1"/>`]], {
    parts: [
      { path: 'xl/drawings/drawing1.xml', xml: `<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:r="${R}" xmlns:c="${C}">${anchors}</xdr:wsDr>`, type: 'application/vnd.openxmlformats-officedocument.drawing+xml', from: 'xl/worksheets/sheet1.xml', rel: `${R}/drawing`, target: '../drawings/drawing1.xml' },
      ...(chart ? [{ path: 'xl/charts/chart1.xml', xml: chart, type: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml', from: 'xl/drawings/drawing1.xml', rel: `${R}/chart`, target: '../charts/chart1.xml' }] : []),
    ],
  });
}

const FRAME = '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
  `<a:graphic><a:graphicData uri="${C}"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>`;
const TWO_CELL = (inner: string) => `<xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>${inner}<xdr:clientData/></xdr:twoCellAnchor>`;

/** A scatter chart part (21.2.2.161) of the sheet's points: `ser` goes inside the series, `axisTitle` on the value axis, `space` in the chartSpace. */
const scatterChart = (o: { ser?: string; axisTitle?: string; space?: string; style?: string } = {}) =>
  `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart><c:plotArea><c:scatterChart><c:scatterStyle val="${o.style ?? 'lineMarker'}"/>` +
  '<c:ser><c:idx val="0"/><c:order val="0"/><c:xVal><c:numRef><c:f>Sheet1!$A$1:$A$3</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>Sheet1!$B$1:$B$3</c:f></c:numRef></c:yVal>' +
  `${o.ser ?? ''}</c:ser><c:axId val="1"/><c:axId val="2"/></c:scatterChart>` +
  `<c:valAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx><c:valAx><c:axId val="2"/><c:axPos val="l"/>${o.axisTitle ?? ''}<c:crossAx val="1"/></c:valAx>` +
  `</c:plotArea></c:chart>${o.space ?? ''}</c:chartSpace>`;

describe('error bars read from Excel (F133)', () => {
  it('does not turn Standard Error bars into fixed bars of 1', async () => {
    const got = await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart({ ser: '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="stdErr"/><c:noEndCap val="0"/></c:errBars>' })));
    const s = got.book.sheets[0];
    expect(s.charts).toHaveLength(1);
    expect(s.charts[0].series[0].errors).toBeUndefined();
    expect(got.warnings.join(' ')).toMatch(/standard error bars/);
  });
  it('says a plus-only bar is drawn both ways', async () => {
    const got = await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart({ ser: '<c:errBars><c:errDir val="y"/><c:errBarType val="plus"/><c:errValType val="fixedVal"/><c:noEndCap val="0"/><c:val val="0.5"/></c:errBars>' })));
    expect(got.book.sheets[0].charts[0].series[0].errors).toEqual({ kind: 'fixed', value: 0.5 });
    expect(got.warnings.join(' ')).toMatch(/one-sided error bars/);
  });
});

describe('a scatter series with no line of its own (F608)', () => {
  it('has lines in a lineMarker chart, none in a marker chart', async () => {
    // 21.2.3.40 ST_ScatterStyle: lineMarker, "the points shall be connected with straight lines and markers"
    expect((await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart()))).book.sheets[0].charts[0].series[0].line).toBe(true);
    expect((await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart({ style: 'marker' })))).book.sheets[0].charts[0].series[0].line).toBeUndefined();
    // an explicit no line stays none
    const none = scatterChart({ ser: '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>' });
    expect((await readXlsx(withDrawing(TWO_CELL(FRAME), none))).book.sheets[0].charts[0].series[0].line).toBeUndefined();
  });
});

describe("a chart's text size (F609)", () => {
  it("is not taken from an axis title's", async () => {
    const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:r><a:t>Yield</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
    expect((await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart({ axisTitle: title })))).book.sheets[0].charts[0].fontSize).toBeUndefined();
  });
  it("is the chartSpace's own", async () => {
    // 18 pt is 24 px at 96 to the inch
    const space = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
    expect((await readXlsx(withDrawing(TWO_CELL(FRAME), scatterChart({ space })))).book.sheets[0].charts[0].fontSize).toBe(24);
  });
});

describe('a chart in an absoluteAnchor (F623)', () => {
  it('is read, at its place and size', async () => {
    // 20.5.2.1: pos and ext in EMUs, 9525 to the pixel: 4572000 × 2743200 is 480 × 288 px
    const abs = `<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="4572000" cy="2743200"/>${FRAME}<xdr:clientData/></xdr:absoluteAnchor>`;
    const got = await readXlsx(withDrawing(abs, scatterChart()));
    const ch = got.book.sheets[0].charts;
    expect(ch).toHaveLength(1);
    expect([ch[0].w, ch[0].h]).toEqual([480, 288]);
    expect(ch[0].at).toEqual({ row: 0, col: 0, dx: 0, dy: 0 });
    expect(got.warnings.join(' ')).not.toMatch(/picture/);
  });
});

describe("shape text in the shape style's color (F134)", () => {
  it('takes fontRef when the run has no fill', async () => {
    // Excel's Colored Outline shape style: light fill, text in dk1 (style/fontRef, 20.1.4.1.17), the run giving only lang and sz
    const sp = '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="3" name="Rectangle 2"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
      '<xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="lt1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="dk1"/></a:fontRef></xdr:style>' +
      '<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>Label</a:t></a:r></a:p></xdr:txBody></xdr:sp>';
    const o = (await readXlsx(withDrawing(TWO_CELL(sp)))).book.sheets[0].objects;
    expect(o).toHaveLength(1);
    expect(o[0].text).toBe('Label');
    // dk1 of Office's standard theme is black
    expect(o[0].color?.toLowerCase()).toBe('#000000');
  });
});

/** A workbook saved here with a chart of three points. */
async function ownChartBook(): Promise<{ wb: Workbook; bytes: Uint8Array }> {
  const wb = new Workbook(['Sheet1']);
  const s = wb.sheet;
  wb.edit('data', () => {
    [[1, 2], [2, 4], [3, 5]].forEach(([x, y], r) => { s.setCell(r, 0, { input: String(x) }); s.setCell(r, 1, { input: String(y) }); });
    s.setCharts([{ ...chartFromRange(s, { r1: 0, c1: 0, r2: 2, c2: 1 }, 'scatter'), at: { row: 1, col: 3, dx: 0, dy: 0 } }]);
  });
  return { wb, bytes: await writeXlsx(wb, pictures) };
}

describe('a chart resized in Excel (F136)', () => {
  it('opens at its new size', async () => {
    const { wb, bytes } = await ownChartBook();
    const was = wb.sheet.charts[0];
    const drawing = Object.keys(unzipSync(bytes)).find((k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    // dragged two columns wider in Excel: its anchor's "to" cell moves (20.5.2.32)
    const wider = edit(bytes, { [drawing]: (x) => x.replace(/(<xdr:to><xdr:col>)(\d+)(<\/xdr:col>)/, (_, a: string, n: string, b: string) => `${a}${Number(n) + 2}${b}`) });
    const back = (await readXlsx(wider)).book.sheets[0].charts[0];
    expect(back.w).toBeCloseTo(was.w + 2 * DEFAULT_COL_W, 0);
    expect(back.h).toBeCloseTo(was.h, 0);
  });
});

describe("objects named 'Structure ...' in a workbook saved here (F622)", () => {
  it('keeps a text box added in Excel', async () => {
    const { bytes } = await ownChartBook();
    const drawing = Object.keys(unzipSync(bytes)).find((k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k))!;
    const box = '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>8</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
      '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="9" name="Structure notes"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
      '<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>notes</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>';
    const added = edit(bytes, { [drawing]: (x) => x.replace('</xdr:wsDr>', `${box}</xdr:wsDr>`) });
    const objects = (await readXlsx(added)).book.sheets[0].objects;
    expect(objects.map((o) => o.text)).toContain('notes');
  });
});

describe('links on big ranges (F624)', () => {
  it('link every cell of A1:Z2000', async () => {
    const got = await readXlsx(excelBook([['Sheet1', `${DATA}<hyperlinks><hyperlink ref="A1:Z2000" location="Sheet1!A1" display="top"/></hyperlinks>`]]));
    const s = got.book.sheets[0];
    expect(s.cell(0, 0)?.link).toBe('#Sheet1!A1');
    expect(s.cell(1999, 25)?.link).toBe('#Sheet1!A1');
    expect(s.cell(1500, 0)?.link).toBe('#Sheet1!A1');
  });
});

describe("a sheet's own names with the hidden list sheet moved (F625)", () => {
  it('belong to the sheet localSheetId names', async () => {
    const wb = new Workbook(['A', 'B']);
    // a drop-down list longer than Excel's 255 characters goes on the hidden Lists sheet
    const items = Array.from({ length: 80 }, (_, i) => `Item ${i}`).join(', ');
    wb.edit('v', () => wb.sheets[1].setValidations([newValidation([{ r1: 0, c1: 0, r2: 4, c2: 0 }], { kind: 'list', value1: items })]));
    const bytes = await writeXlsx(wb, pictures);
    expect(part(bytes, 'xl/workbook.xml')).toMatch(/<sheet name="Lists"/);
    // moved before B in Excel, and a name made on B (localSheetId counts every sheet, 18.2.5)
    const moved = edit(bytes, {
      'xl/workbook.xml': (x) => {
        const lists = /<sheet name="Lists"[^>]*\/>/.exec(x)![0];
        const b = /<sheet name="B"[^>]*\/>/.exec(x)![0];
        let out = x.replace(lists, '').replace(b, lists + b);
        const name = '<definedName name="Rate" localSheetId="2">B!$C$1</definedName>';
        out = out.includes('<definedNames>') ? out.replace('<definedNames>', `<definedNames>${name}`) : out.replace('</sheets>', `</sheets><definedNames>${name}</definedNames>`);
        return out;
      },
    });
    const back = (await readXlsx(moved)).book;
    expect(back.sheets.map((s) => s.name)).toEqual(['A', 'B']);
    const rate = back.names.find((n) => n.name === 'Rate');
    expect(rate?.sheet?.name).toBe('B');
  });
});

describe('Contains filters with wildcard characters (F618)', () => {
  it('escapes * ? ~ for Excel and reads them back as Contains', async () => {
    const wb = new Workbook(['Sheet1']);
    const s = wb.sheet;
    wb.edit('f', () => {
      ['Name', 'What?', 'What!'].forEach((t, r) => s.setCell(r, 0, { input: t }));
      s.setFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 0 }, conditions: { 0: { kind: 'contains', text: 'What?' } } });
    });
    const bytes = await writeXlsx(wb, pictures);
    // ~ before a * or ? makes it the character itself (Excel's wildcard escape)
    expect(part(bytes, 'xl/worksheets/sheet1.xml')).toContain('val="*What~?*"');
    const back = (await readXlsx(bytes)).book.sheets[0];
    expect(back.filter?.conditions[0]).toEqual({ kind: 'contains', text: 'What?' });
  });
});

describe('date cells without a time zone (F620)', () => {
  it('give the day number of the date and time as written', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    try {
      // 18.17.4.1: 2024-03-01 is day 45352 (counted from 1900); 10:30 is 0.4375 of a day
      const got = await readXlsx(excelBook([['Sheet1', '<sheetData><row r="1"><c r="A1" t="d"><v>2024-03-01T10:30:00</v></c><c r="B1" t="d"><v>2024-03-01</v></c></row></sheetData>']]));
      const s = got.book.sheets[0];
      expect(Number(s.cell(0, 0)?.input)).toBeCloseTo(45352.4375, 9);
      expect(Number(s.cell(0, 1)?.input)).toBe(45352);
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});

describe('array blocks over the reader\'s row bands (F621)', () => {
  it('still knows the cells a legacy array fills', async () => {
    // rows 15-20 (crossing row 16, 0-based 15 is the first): the block's other cells hold only its values (18.3.1.40)
    const rows = Array.from({ length: 6 }, (_, i) => `<row r="${15 + i}"><c r="A${15 + i}">${i === 0 ? '<f t="array" ref="A15:A20">ROW(1:6)</f>' : ''}<v>${i + 1}</v></c></row>`).join('');
    const s = (await readXlsx(excelBook([['Sheet1', `<sheetData>${rows}</sheetData>`]]))).book.sheets[0];
    expect(s.cell(14, 0)?.input).toMatch(/^=/);
    for (let r = 15; r < 20; r++) expect(s.cell(r, 0)?.input).toBeUndefined();
  });
});

describe('whole-row formatting (F619)', () => {
  it('is named among what is not kept', async () => {
    const styles = `<styleSheet xmlns="${MAIN}"><fonts count="2"><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      '<borders count="1"><border/></borders><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="0" borderId="0" applyFont="1"/></cellXfs></styleSheet>';
    const got = await readXlsx(excelBook([['Sheet1', '<sheetData><row r="1" s="1" customFormat="1"><c r="A1" s="1"><v>1</v></c></row></sheetData>']], {
      parts: [{ path: 'xl/styles.xml', xml: styles, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml', from: 'xl/workbook.xml', rel: `${R}/styles` }],
    }));
    expect(got.warnings.join(' ')).toMatch(/formatting of whole rows/);
  });
});

describe('sparklines with no empty-cell setting (F614)', () => {
  it('show empty cells as zero, the schema default', async () => {
    const ext = '<extLst><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">' +
      '<x14:sparklineGroup><x14:colorSeries rgb="FF376092"/><x14:sparklines><x14:sparkline><xm:f>Sheet1!A1:B1</xm:f><xm:sqref>D1</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup>' +
      '</x14:sparklineGroups></ext></extLst>';
    const s = (await readXlsx(excelBook([['Sheet1', DATA + ext]]))).book.sheets[0];
    expect(s.sparklines).toHaveLength(1);
    expect(s.sparklines[0].empty).toBe('zero');
  });
});

describe("a custom view's active sheet (F615)", () => {
  it('is found by sheetId, not by place', async () => {
    // Sheet1 deleted in Excel: the two left have sheetId 2 and 3; the view was made on the second (18.2.4)
    const file = excelBook([['Second', DATA], ['Third', DATA]], {
      workbook: (list) => `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets>${list.replace(/sheetId="(\d+)"/g, (_, n: string) => `sheetId="${Number(n) + 1}"`)}</sheets>` +
        '<customWorkbookViews><customWorkbookView name="Mine" guid="{11111111-2222-3333-4444-555555555555}" windowWidth="800" windowHeight="600" activeSheetId="3"/></customWorkbookViews></workbook>',
    });
    const views = (await readXlsx(file)).book.customViews;
    expect(views.map((v) => v.activeSheet)).toEqual(['Third']);
  });
});

describe("the sheet view's own scroll position (F616)", () => {
  const file = () => excelBook([['Sheet1', `<sheetViews><sheetView topLeftCell="A500" workbookViewId="0"/></sheetViews>${DATA}`]]);
  it('is kept while the panes are the same', async () => {
    const saved = await writeXlsx((await readXlsx(file())).book, pictures);
    expect(part(saved, 'xl/worksheets/sheet1.xml')).toMatch(/<sheetView[^>]*topLeftCell="A500"/);
  });
  it('is not written once panes are frozen here', async () => {
    const wb = (await readXlsx(file())).book;
    wb.edit('freeze', () => wb.sheets[0].setFrozen(1, 0));
    const sheet = part(await writeXlsx(wb, pictures), 'xl/worksheets/sheet1.xml');
    expect(sheet).not.toContain('A500');
    expect(sheet).toContain('state="frozen"');
  });
});

describe("a filter's last row (F135)", () => {
  it('moves with rows taken out inside the filter in Excel', () => {
    // a table in A4:A23 with a filter; Excel deleted rows 10 to 12, so the filter is A4:A20
    const ms = { name: 'Data', cells: [], defs: [], chemCols: [], filter: { range: { r1: 3, c1: 0, r2: 22, c2: 0 }, conditions: {} } } as unknown as ModelSheet;
    const grid = gridOf(ms, 'Data')!;
    expect(grid.rows).toEqual([3, 22]);
    // the hidden name as Excel rewrote it: column A, row 4, and the last row now 20
    const mover = readGridName('Data!$A:$A,Data!$4:$4,Data!$20:$20', grid);
    expect(moveFilter(ms.filter!, mover)?.range).toEqual({ r1: 3, c1: 0, r2: 19, c2: 0 });
    // its last row taken out: Excel's own range stands
    expect(moveFilter(ms.filter!, readGridName('Data!$A:$A,Data!$4:$4,Data!#REF!', grid))).toBeNull();
  });
});

describe('a ChemDraw object in a hidden column (F617)', () => {
  it('is not written with a size below zero', async () => {
    // a stand-in for the ChemDraw writer: CDX's "VjCD0100" header and a few bytes of picture
    const cdx = new Uint8Array([0x56, 0x6a, 0x43, 0x44, 0x30, 0x31, 0x30, 0x30, 0x04, 0x03, 0x02, 0x01, 1, 1, 1, 1]);
    const asObjects: XlsxPictures = { ...pictures, chemdrawObjects: true, chemdraw: () => ({ cdx, emf: new Uint8Array([1, 0, 0, 0, 9, 9, 9]), w: 30, h: 20 }) };
    const mol: Contents = { atoms: [{ id: 1, x: 0, y: 0, z: 6, charge: 0, isotope: 0, label: 'CCO' } as never], bonds: [], captions: [], arrows: [], shapes: [] };
    const wb = new Workbook(['Sheet1']);
    wb.edit('s', () => { wb.sheet.setCell(1, 1, { structure: makeStructure(mol) }); wb.sheet.setColHidden(1, true); });
    const files = unzipSync(await writeXlsx(wb, asObjects));
    const all = Object.entries(files).filter(([n]) => /\.(xml|vml)$/.test(n)).map(([, b]) => strFromU8(b)).join('');
    expect(all).not.toMatch(/<oleObject /);
    expect(all).not.toMatch(/(?:cx|cy|colOff|rowOff)(?:="|>)-/);
    // and the same in a shown column is written as an object
    const shown = new Workbook(['Sheet1']);
    shown.edit('s', () => shown.sheet.setCell(1, 1, { structure: makeStructure(mol) }));
    expect(strFromU8(unzipSync(await writeXlsx(shown, asObjects))['xl/worksheets/sheet1.xml'])).toMatch(/<oleObject /);
  });
});

describe('an embedded object after a self-closing VML shape (F612)', () => {
  it('keeps its own VML shape', async () => {
    // VML (ECMA-376 Part 4, 19.1.2.19): a self-closing shape, then the object's own shape
    const vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<v:shape id="_x0000_s1025" type="#_x0000_t75" style="width:1pt"/>' +
      '<v:shape id="_x0000_s1026" type="#_x0000_t75" style="width:60pt;height:40pt"><v:fill o:detectmouseclick="t"/><x:ClientData ObjectType="Pict"><x:Anchor>1, 0, 1, 0, 3, 0, 4, 0</x:Anchor></x:ClientData></v:shape></xml>';
    const file = excelBook([['Sheet1', `${DATA}<legacyDrawing r:id="rId1"/><oleObjects><oleObject progId="Word.Document.12" shapeId="1026" r:id="rId2"/></oleObjects>`]], {
      parts: [
        { path: 'xl/drawings/vmlDrawing1.vml', xml: vml, type: 'application/vnd.openxmlformats-officedocument.vmlDrawing', from: 'xl/worksheets/sheet1.xml', rel: `${R}/vmlDrawing`, target: '../drawings/vmlDrawing1.vml' },
        { path: 'xl/embeddings/oleObject1.bin', xml: 'not a real object', type: 'application/vnd.openxmlformats-officedocument.oleObject', from: 'xl/worksheets/sheet1.xml', rel: `${R}/oleObject`, target: '../embeddings/oleObject1.bin' },
      ],
    });
    const ole = (await readXlsx(file)).book.sheets[0].ole ?? [];
    expect(ole).toHaveLength(1);
    expect(ole[0].vml?.shape).toContain('ObjectType="Pict"');
    expect(ole[0].vml?.shape).not.toContain('width:1pt');
  });
});

describe('error bars on our own chart, added in Excel (F133)', () => {
  it('are named on opening', async () => {
    const { bytes } = await ownChartBook();
    const chart = Object.keys(unzipSync(bytes)).find((k) => /^xl\/charts\/chart\d+\.xml$/.test(k))!;
    const bars = '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="stdErr"/><c:noEndCap val="0"/></c:errBars>';
    const withBars = edit(bytes, { [chart]: (x) => x.replace(/(<c:yVal>)/, `${bars}$1`) });
    expect((await readXlsx(withBars)).warnings.join(' ')).toMatch(/standard error bars/);
  });
});

describe('a structure picture in an absoluteAnchor (F623)', () => {
  it('is found over the cell at its place', () => {
    // pos in EMUs, 9525 to the pixel: 2 columns and 3 rows in
    const x = 2 * DEFAULT_COL_W * 9525 + 9525, y = 3 * 22 * 9525 + 9525;
    const xml = `<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:r="${R}"><xdr:absoluteAnchor><xdr:pos x="${x}" y="${y}"/><xdr:ext cx="95250" cy="95250"/>` +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Structure B2"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>';
    const dr = new DOMParser().parseFromString(xml, 'application/xml');
    expect(structurePictures(dr, () => DEFAULT_COL_W, () => 22).get('B2')).toEqual({ r: 3, c: 2 });
  });
});

describe('links saved for Excel (F624)', () => {
  it('write a block of linked cells as one hyperlink', async () => {
    // Excel holds at most 65,530 hyperlinks in a worksheet ("Excel specifications and limits"):
    // a range is one of them, however many cells it covers
    const got = await readXlsx(excelBook([['Sheet1', `${DATA}<hyperlinks><hyperlink ref="A1:Z2000" location="Sheet1!A1" display="top"/></hyperlinks>`]]));
    const sheet = part(await writeXlsx(got.book, pictures), 'xl/worksheets/sheet1.xml');
    expect(sheet.match(/<hyperlink /g)).toHaveLength(1);
    expect(sheet).toContain('<hyperlink ref="A1:Z2000" location="Sheet1!A1"');
  });
});
