// @vitest-environment jsdom
//
// Review batch 17: OpenDocument spreadsheets. The files are built here, laid out as the
// OpenDocument 1.3 standard (OASIS, Part 3) describes: table:number-rows-repeated (9.1.3),
// style:row-height and table:visibility (17.17, 19.751), and style:parent-style-name (19.510),
// the parent's properties applying where the child sets none (16.2).
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readOds } from '../src/io/ods';

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';

function ods(rows: string, autoStyles = '', namedStyles = ''): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}><office:automatic-styles>${autoStyles}</office:automatic-styles><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-column/>${rows}</table:table></office:spreadsheet></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:styles>${namedStyles}</office:styles></office:document-styles>`;
  return zipSync({ mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'), 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

describe('repeated rows (F120, F577)', () => {
  it('keeps a value in every copy of a row repeated 2000 times', () => {
    const book = readOds(ods('<table:table-row table:number-rows-repeated="2000"><table:table-cell office:value-type="string"><text:p>x</text:p></table:table-cell></table:table-row>')).book;
    const s = book.sheets[0];
    expect(s.cell(0, 0)?.input).toBe('x');
    expect(s.cell(999, 0)?.input).toBe('x');
    expect(s.cell(1000, 0)?.input).toBe('x');
    expect(s.cell(1999, 0)?.input).toBe('x');
    expect(s.cell(2000, 0)).toBeUndefined();
  });
});

describe('repeated empty rows keep their height and hiding (F579)', () => {
  it('sets the height and hides each row of the run', () => {
    const auto = '<style:style style:name="ro2" style:family="table-row"><style:table-row-properties style:row-height="40pt" style:use-optimal-row-height="false"/></style:style>';
    const rows = '<table:table-row><table:table-cell office:value-type="string"><text:p>head</text:p></table:table-cell></table:table-row>'
      + '<table:table-row table:style-name="ro2" table:number-rows-repeated="40"><table:table-cell/></table:table-row>'
      + '<table:table-row table:visibility="collapse" table:number-rows-repeated="3"><table:table-cell/></table:table-row>';
    const s = readOds(ods(rows, auto)).book.sheets[0];
    // 40 pt is 40/72 inch, 53.3 px at 96 to the inch
    expect(s.rowHeights.get(1)).toBe(53);
    expect(s.rowHeights.get(40)).toBe(53);
    expect(s.rowHeights.has(41)).toBe(false);
    expect([41, 42, 43].map((r) => s.hiddenRows.has(r))).toEqual([true, true, true]);
    expect(s.hiddenRows.has(44)).toBe(false);
  });
});

describe('cell styles take their parent style\'s look (F578)', () => {
  it('reads bold, fill and centering from the named parent', () => {
    const named = '<style:style style:name="Heading_20_1" style:family="table-cell"><style:table-cell-properties fo:background-color="#dddddd"/><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-weight="bold"/></style:style>';
    const auto = '<style:style style:name="ce1" style:family="table-cell" style:parent-style-name="Heading_20_1"><style:text-properties fo:font-style="italic"/></style:style>'
      + '<style:style style:name="ce2" style:family="table-cell" style:parent-style-name="Heading_20_1"><style:text-properties fo:font-weight="normal"/></style:style>';
    const rows = '<table:table-row><table:table-cell table:style-name="ce1" office:value-type="string"><text:p>A</text:p></table:table-cell><table:table-cell table:style-name="ce2" office:value-type="string"><text:p>B</text:p></table:table-cell></table:table-row>';
    const s = readOds(ods(rows, auto, named)).book.sheets[0];
    expect(s.cell(0, 0)?.style).toMatchObject({ bold: true, italic: true, fill: '#dddddd', align: 'center' });
    // the child's own normal weight wins over the parent's bold
    expect(s.cell(0, 1)?.style?.bold).toBeUndefined();
    expect(s.cell(0, 1)?.style?.fill).toBe('#dddddd');
  });
});
