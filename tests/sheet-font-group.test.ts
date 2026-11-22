// @vitest-environment jsdom
// The Spreadsheet's part of the shared Font group (retrospective audit G5-26): Strikethrough,
// Subscript and Superscript on whole cells, shown and kept in the .xlsx as Excel's own font
// settings (<strike/>, <vertAlign/>), and A⁺ A⁻ stepping the size.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { stepSize } from '../src/text/format';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };
const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('Spreadsheet Font group (G5-26)', () => {
  it('writes struck-through, lowered and raised cells as Excel fonts, and reads them back', async () => {
    const wb = new Workbook();
    wb.edit('x', () => {
      wb.sheet.setInput(0, 0, 'struck');
      wb.sheet.setInput(1, 0, 'low');
      wb.sheet.setInput(2, 0, 'high');
      wb.sheet.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { strike: true });
      wb.sheet.patchStyle({ r1: 1, c1: 0, r2: 1, c2: 0 }, { pos: 'sub' });
      wb.sheet.patchStyle({ r1: 2, c1: 0, r2: 2, c2: 0 }, { pos: 'sup' });
    });
    const bytes = await writeXlsx(wb, pictures);
    const styles = strFromU8(unzipSync(bytes)['xl/styles.xml']);
    expect(styles).toContain('<strike/>');
    expect(styles).toContain('<vertAlign val="subscript"/>');
    expect(styles).toContain('<vertAlign val="superscript"/>');
    const back = (await readXlsx(bytes)).book.sheet;
    expect(back.styleAt(0, 0)?.strike).toBe(true);
    expect(back.styleAt(1, 0)?.pos).toBe('sub');
    expect(back.styleAt(2, 0)?.pos).toBe('sup');
  });
  it('A⁺ and A⁻ step through the same sizes as the other modes', () => {
    expect(stepSize(11, 1)).toBe(12);
    expect(stepSize(11, -1)).toBe(10.5);
    const sheet = src('src/ui/sheet-mode.ts');
    expect(sheet).toContain("case 'cell-strike': this.style('Strikethrough', { strike: !a.strike || undefined }); break;");
    expect(sheet).toContain("case 'font-bigger': case 'font-smaller': {");
    expect(src('src/ui/sheet-view.ts')).toContain('if (!looks && wholeLook) looks = looksOf(text, undefined);');
  });
});
