// @vitest-environment jsdom
// The Spreadsheet's part of the shared Font group (retrospective audit G5-26): Strikethrough,
// Subscript and Superscript on whole cells, shown and kept in the .xlsx as Excel's own font
// settings (<strike/>, <vertAlign/>), and A⁺ A⁻ stepping the size.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Workbook } from '../src/sheet/workbook';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { stepSize } from '../src/text/format';
import { lookOver } from '../src/sheet/rich-text';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

/** A workbook file whose A1 is a struck-through cell and A2 a lowered one, each with one word Excel
 *  wrote without the cell's strike or vertAlign (the file is built here, from this app's own). */
async function mixedFile(): Promise<Uint8Array> {
  const wb = new Workbook();
  wb.edit('x', () => {
    wb.sheet.setInput(0, 0, 'struck plain');
    wb.sheet.setInput(1, 0, 'low base');
    wb.sheet.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { strike: true });
    wb.sheet.patchStyle({ r1: 1, c1: 0, r2: 1, c2: 0 }, { pos: 'sub' });
  });
  const files = unzipSync(await writeXlsx(wb, pictures));
  const pr = (extra: string) => `<rPr>${extra}<sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr>`;
  let sst = strFromU8(files['xl/sharedStrings.xml']);
  sst = sst.replace('<si><t>struck plain</t></si>', `<si><r>${pr('<strike/>')}<t xml:space="preserve">struck </t></r><r>${pr('')}<t>plain</t></r></si>`);
  sst = sst.replace('<si><t>low base</t></si>', `<si><r>${pr('<vertAlign val="subscript"/>')}<t xml:space="preserve">low </t></r><r>${pr('')}<t>base</t></r></si>`);
  expect(sst).toContain('<t>plain</t>');
  expect(sst).toContain('<t>base</t>');
  files['xl/sharedStrings.xml'] = strToU8(sst);
  return zipSync(files);
}

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
  it('a word Excel wrote without the cell\'s strikethrough or subscript stays plain, open and save (review R05)', async () => {
    const book = (await readXlsx(await mixedFile())).book;
    const a1 = book.sheet.cell(0, 0)!, a2 = book.sheet.cell(1, 0)!;
    expect(a1.style?.strike).toBe(true);
    expect(a1.runs?.find((r) => r.text === 'plain')?.strike).toBe(false);
    expect(a2.style?.pos).toBe('sub');
    expect(a2.runs?.find((r) => r.text === 'base')?.pos).toBe('base');
    // what shows: the word is neither struck through nor lowered
    expect(lookOver(a1.style, a1.runs!.find((r) => r.text === 'plain')).strike).toBe(false);
    expect(lookOver(a2.style, a2.runs!.find((r) => r.text === 'base')).pos).toBeUndefined();
    expect(lookOver(a2.style, a2.runs!.find((r) => r.text === 'low ')).pos).toBe('sub');
    // saved again: the plain word's run has no <strike/>, the base word's no vertAlign
    const sst = strFromU8(unzipSync(await writeXlsx(book, pictures))['xl/sharedStrings.xml']);
    const run = (word: string) => sst.match(new RegExp(`<r><rPr>((?:(?!</rPr>).)*)</rPr><t[^>]*>${word}</t></r>`))?.[1] ?? '';
    expect(run('plain')).not.toBe('');
    expect(run('plain')).not.toContain('<strike/>');
    expect(run('struck ')).toContain('<strike/>');
    expect(run('base')).not.toContain('vertAlign');
    expect(run('low ')).toContain('<vertAlign val="subscript"/>');
  });
  it('A⁺ and A⁻ step through the same sizes as the other modes', () => {
    expect(stepSize(11, 1)).toBe(12);
    expect(stepSize(11, -1)).toBe(10.5);
    expect(stepSize(72, 1)).toBe(80);
  });
});
