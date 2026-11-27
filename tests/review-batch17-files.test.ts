// Review batch 17: text and SD files (F600 to F602) and the dashboard stand-in Excel is given
// (F610, F611). UTF-16's byte-order marks are FE FF (big-endian) and FF FE (little-endian), the
// Unicode Standard, section 23.8; the SD file layout is BIOVIA's CTfile Formats (V2000 molfile,
// "> <name>" data items). The catalyst screen below is made up for the tests.
import { describe, it, expect } from 'vitest';
import { decodeText, readSdf, parseSdf, sdfText } from '../src/io/sheet-files';
import { Workbook } from '../src/sheet/workbook';
import { newTable } from '../src/sheet/table-styles';
import { Dashboard, ChartTile, TableTile, newDashboard, resolveSource, chartOfColumns } from '../src/sheet/dashboard';
import { dashboardStandIn } from '../src/io/xlsx-dashboard';
import { parseRange } from '../src/sheet/refs';

describe('UTF-16 big-endian text (F600)', () => {
  it('is read with its byte-order mark', () => {
    // "Né" in UTF-16BE: FE FF, then 00 4E, 00 E9
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x4e, 0x00, 0xe9]))).toBe('Né');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x4e, 0x00, 0xe9, 0x00]))).toBe('Né');
  });
});

/** A V2000 molfile of ethanol (C-C-O). */
const ETHANOL = ['ethanol', '  test', '', '  3  2  0  0  0  0  0  0  0  0999 V2000',
  '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
  '    2.5980    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
  '  1  2  1  0', '  2  3  1  0', 'M  END'].join('\n');

describe('SD files saved from a sheet (F601, F602)', () => {
  const sheet = () => {
    const { book } = readSdf(`${ETHANOL}\n> <Yield>\n85\n\n$$$$\n`, 'compounds');
    return book;
  };
  it('take the header from above a blank row', () => {
    const book = sheet();
    // a blank spacer row put in between the header and the first structure
    book.edit('row', () => book.sheet.insertRows(1));
    const back = parseSdf(sdfText(book.sheet, book.drawingStyle));
    expect(back[0].title).toBe('ethanol');
    expect(back[0].data).toEqual([['Yield', '85']]);
  });
  it('keep a second column with the title column\'s header', () => {
    const book = sheet();
    const s = book.sheet;
    book.edit('col', () => { s.setInput(0, 3, 'Name'); s.setInput(1, 3, 'EtOH'); });
    const back = parseSdf(sdfText(s, book.drawingStyle));
    expect(back[0].title).toBe('ethanol');
    expect(back[0].data).toEqual([['Yield', '85'], ['Name', 'EtOH']]);
  });
});

/** A catalyst screen: catalyst and yield (%) for 30 runs, made a table. */
function screen(): Workbook {
  const wb = new Workbook(['Screen']);
  const s = wb.sheet;
  wb.edit('fill', () => {
    s.setInput(0, 0, 'Catalyst'); s.setInput(0, 1, 'Yield');
    for (let i = 1; i <= 30; i++) { s.setInput(i, 0, `Cat ${i}`); s.setInput(i, 1, String(40 + i)); }
    s.setTables([{ ...newTable({ r1: 0, c1: 0, r2: 30, c2: 1 }, []), name: 'Screen1' }]);
  });
  return wb;
}
const dash = (...tiles: Dashboard['tiles']): Dashboard => ({ ...newDashboard(), tiles });

describe('the dashboard stand-in for Excel (F610, F611)', () => {
  it("puts a chart's numbers where no other tile's cells are", () => {
    const wb = screen();
    const res = resolveSource(wb, { table: 'Screen1' })!;
    // a short chart of 30 catalysts, with a table tile right under it
    const chart: ChartTile = { id: 140, kind: 'chart', x: 0, y: 0, w: 6, h: 2, chart: chartOfColumns(res, 'column', 'Catalyst', ['Yield'], 141) };
    const table: TableTile = { id: 142, kind: 'table', x: 0, y: 2, w: 6, h: 4, source: { table: 'Screen1' }, columns: ['Catalyst', 'Yield'] };
    const dsh = wb.edit('d', () => { const x = wb.addSheet('Dash'); x.setDashboard(dash(chart, table)); return x; });
    const { sheet } = dashboardStandIn(wb, dsh);
    const ser = sheet.charts[0].series[0];
    const R = parseRange(ser.y!.replace(/^=Dash!/, ''))!;
    // every cell the chart reads holds its own number: 41 to 70
    const ys = Array.from({ length: R.r2 - R.r1 + 1 }, (_, i) => sheet.value(R.r1 + i, R.c1));
    expect(ys).toEqual(Array.from({ length: 30 }, (_, i) => 41 + i));
  });
  it('writes no data row past a two-row table tile', () => {
    const wb = screen();
    // two grid rows tall: the title and the header fill it
    const table: TableTile = { id: 150, kind: 'table', x: 0, y: 0, w: 6, h: 1, source: { table: 'Screen1' }, columns: ['Catalyst', 'Yield'] };
    const dsh = wb.edit('d', () => { const x = wb.addSheet('Dash'); x.setDashboard(dash(table)); return x; });
    const { sheet } = dashboardStandIn(wb, dsh);
    expect(sheet.shownText(1, 0)).toBe('Catalyst');
    expect(sheet.shownText(2, 0)).toBe('');
  });
});
