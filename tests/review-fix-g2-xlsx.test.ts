// @vitest-environment jsdom
//
// Review fix (group g2), F013: a chemistry formula whose result is one of the newer errors
// (#FIELD!, #SPILL!, ...), which the file format has no code for and which is saved as #VALUE!,
// comes back as the formula when the file is opened again here.

import { describe, it, expect } from 'vitest';
import { writeXlsx, readXlsx, type XlsxPictures } from '../src/io/xlsx';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';

const pictures: XlsxPictures = { box: () => ({ w: 60, h: 40 }), picture: async () => null };

describe('F013: chemistry formulas showing a newer error survive save and reopen', () => {
  it('restores =FIELDVALUE(...) showing #FIELD! without saying it was changed elsewhere', async () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(1, 0, 'not a compound');
      s.setInput(1, 1, '=FIELDVALUE(A2,"Molecular weight")');
    });
    wb.recalc();
    // (#FIELD!: the cell isn't a compound; the file format has no code for it)
    expect((s.value(1, 1) as CellError).code).toBe('#FIELD!');
    const { book, warnings } = await readXlsx(await writeXlsx(wb, pictures));
    expect(warnings.join(' ')).not.toMatch(/changed in another program/);
    expect(book.sheet.cell(1, 1)?.input).toBe('=FIELDVALUE(A2,"Molecular weight")');
  });
});
