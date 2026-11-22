// @vitest-environment jsdom
//
// An Excel font with more than is shown here (an outline, a shadow, its family and character set,
// a theme colour; ECMA-376 part 1, 18.8.22 and 18.8.3) is saved as the file had it while the
// cell's font looks as it did (audit G2-19). The workbook is built here as Excel writes one.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { Package, REL } from '../src/io/ooxml';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function book(): Uint8Array {
  const pkg = new Package();
  pkg.relate('', REL.officeDocument, 'xl/workbook.xml');
  const sid = pkg.relate('xl/workbook.xml', `${R}/worksheet`, 'worksheets/sheet1.xml');
  const stid = pkg.relate('xl/workbook.xml', `${R}/styles`, 'styles.xml');
  const ssid = pkg.relate('xl/workbook.xml', `${R}/sharedStrings`, 'sharedStrings.xml');
  void stid; void ssid;
  pkg.add('xl/workbook.xml', `<workbook xmlns="${MAIN}" xmlns:r="${R}"><sheets><sheet name="Yields" sheetId="1" r:id="${sid}"/></sheets></workbook>`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
  pkg.add('xl/styles.xml', `<styleSheet xmlns="${MAIN}"><fonts count="3">` +
    '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><u val="double"/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
    '<font><b/><outline/><shadow/><sz val="12"/><color theme="4" tint="-0.249977111117893"/><name val="Times New Roman"/><family val="1"/><charset val="0"/></font>' +
    '</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml');
  pkg.add('xl/sharedStrings.xml', `<sst xmlns="${MAIN}" count="3" uniqueCount="3"><si><t>Total</t></si><si><t>Yield</t></si>` +
    '<si><r><rPr><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t xml:space="preserve">net </t></r>' +
    '<r><rPr><u val="doubleAccounting"/><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t>sum</t></r></si></sst>',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml');
  pkg.add('xl/worksheets/sheet1.xml', `<worksheet xmlns="${MAIN}"><sheetData><row r="1">` +
    '<c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="2" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row></sheetData></worksheet>',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');
  return pkg.build();
}

describe('Excel fonts kept (G2-19)', () => {
  it('keeps outline, shadow, family, character set and theme colour while the font is unchanged', async () => {
    const { book: wb } = await readXlsx(book());
    const styles = strFromU8(unzipSync(await writeXlsx(wb, pictures))['xl/styles.xml']);
    expect(styles).toContain('<font><b/><outline/><shadow/><sz val="12"/><color theme="4" tint="-0.249977111117893"/><name val="Times New Roman"/><family val="1"/><charset val="0"/></font>');
    // the double underline's font, which has nothing more, is made from its look as before
    expect(styles).toContain('<u val="double"/>');
  });

  it('writes the font from its look once it is changed here', async () => {
    const { book: wb } = await readXlsx(book());
    const c = wb.sheets[0].cell(0, 1)!;
    c.style = { ...c.style, italic: true };
    const styles = strFromU8(unzipSync(await writeXlsx(wb, pictures))['xl/styles.xml']);
    expect(styles).not.toContain('<outline/>');
    expect(styles).toMatch(/<font><b\/><i\/>[^]*?<name val="Times New Roman"\/>/);
  });
});
