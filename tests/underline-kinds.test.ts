// @vitest-environment jsdom
//
// The underline's kind and a double strikethrough are kept (audit G2-07): Excel's double and
// accounting underlines (ECMA-376 part 1, 18.18.85) on a cell and on part of its text, PowerPoint's
// u kinds read by Word's names (20.1.10.82, 17.18.99) so they go between documents and slides,
// and copied HTML that draws them. The workbook is built here as Excel writes one.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { Package, REL } from '../src/io/ooxml';
import { runsHtml } from '../src/text/html';
import { cellTextHtml } from '../src/sheet/cell-html';
import { pptUnderline, wordUnderline } from '../src/io/pptx-keep';

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
    '<font><u val="singleAccounting"/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>' +
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

describe('Excel underline kinds (G2-07)', () => {
  it('keeps double and accounting underlines on cells and on part of a cell\'s text', async () => {
    const { book: wb } = await readXlsx(book());
    const sh = wb.sheets[0];
    expect(sh.cell(0, 0)?.style?.excel?.u).toBe('double');
    expect(sh.cell(0, 1)?.style?.excel?.u).toBe('singleAccounting');
    const out = unzipSync(await writeXlsx(wb, pictures));
    const styles = strFromU8(out['xl/styles.xml']);
    expect(styles).toContain('<u val="double"/>');
    expect(styles).toContain('<u val="singleAccounting"/>');
    const strings = strFromU8(out['xl/sharedStrings.xml']);
    expect(strings).toMatch(/<r><rPr><u val="doubleAccounting"\/>[\s\S]*?<t>sum<\/t><\/r>/);
    // and a second time
    const again = await readXlsx(await writeXlsx(wb, pictures));
    expect(again.book.sheets[0].cell(0, 0)?.style?.excel?.u).toBe('double');
  });

  it('copies a double underline as one', () => {
    const html = cellTextHtml('sum', { underline: true, excel: { u: 'double' } }, [{ text: 'sum' }], false)!;
    expect(html).toContain('text-decoration:underline;text-decoration-style:double');
  });
});

describe('underline kinds between documents and slides (G2-07)', () => {
  it('names PowerPoint\'s kinds by Word\'s and back', () => {
    for (const u of ['dbl', 'heavy', 'wavy', 'wavyDbl', 'dotted', 'dashLongHeavy', 'dotDotDashHeavy', 'words']) expect(pptUnderline(wordUnderline(u))).toBe(u);
    expect(wordUnderline('dbl')).toBe('double');
    expect(wordUnderline('sng')).toBeUndefined();
    expect(pptUnderline(undefined)).toBe('sng');
    // Excel's double accounting underline pasted onto a slide is a double one
    expect(pptUnderline('doubleAccounting')).toBe('dbl');
  });

  it('draws the kinds in copied HTML, two lines of different kinds on two spans', () => {
    expect(runsHtml([{ text: 'w', underline: true, ukind: 'wave' }])).toContain('text-decoration:underline;text-decoration-style:wavy');
    expect(runsHtml([{ text: 's', strike: true, dstrike: true }])).toContain('text-decoration:line-through;text-decoration-style:double');
    const both = runsHtml([{ text: 'b', underline: true, ukind: 'double', strike: true }]);
    expect(both).toMatch(/<span style="[^"]*text-decoration:underline;text-decoration-style:double[^"]*"><span style="text-decoration:line-through">b<\/span><\/span>/);
    expect(runsHtml([{ text: 'c', underline: true, ucolor: '#ff0000' }])).toContain('text-decoration-color:#ff0000');
  });
});
