// Review batch 11 (spreadsheet engine), the editing findings: borders and formats on empty cells,
// Clear Formats, copy/move/fill keeping Compound cards, array formulas and rich text, filters
// leaving rows hidden by hand alone, merges over spilled arrays, names that use each other, and
// the speed of the dependency graph, banded tables and value-list filters.
// Expected behaviour is Excel's (Microsoft Support pages named beside each), never taken from
// running the code under test.

import { describe, it, expect, vi } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { CellError } from '../src/sheet/values';
import { MAX_ROWS } from '../src/sheet/refs';
import type { CompoundCard } from '../src/sheet/compound';

const A = (s: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(s)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1] as const;
};

function sheetWith(cells: Record<string, string>): Workbook {
  const wb = new Workbook();
  wb.edit('Type', () => {
    for (const [addr, v] of Object.entries(cells)) wb.sheet.setInput(...A(addr), v);
  });
  return wb;
}

const val = (wb: Workbook, addr: string) => {
  const v = wb.sheet.value(...A(addr));
  return v instanceof CellError ? v.code : v;
};

// PubChem CID 2244 (aspirin): molecular weight 180.16 g/mol
const card: CompoundCard = { cid: 2244, name: 'Aspirin', fields: { Name: 'Aspirin', Formula: 'C9H8O4', 'Molecular weight': 180.16 } };

describe('F294: borders on empty cells', () => {
  it('Outside Borders on an empty B2:D5 draws the whole box', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Borders', () => s.setBorders({ r1: 1, c1: 1, r2: 4, c2: 3 }, 'outside'));
    expect(s.styleAt(1, 1)?.borders?.top).toBeTruthy();
    expect(s.styleAt(1, 1)?.borders?.left).toBeTruthy();
    expect(s.styleAt(4, 3)?.borders?.bottom).toBeTruthy();
    expect(s.styleAt(4, 3)?.borders?.right).toBeTruthy();
    expect(s.styleAt(2, 3)?.borders?.right).toBeTruthy();
    expect(s.styleAt(4, 2)?.borders?.bottom).toBeTruthy();
    // the inside is untouched
    expect(s.styleAt(2, 2)?.borders).toBeFalsy();
    // one undo step takes it all away
    wb.undo();
    expect(s.styleAt(4, 3)?.borders).toBeFalsy();
  });

  it('All Borders reaches the empty row below a table', () => {
    const wb = sheetWith({ A1: '1', B1: '2' });
    const s = wb.sheet;
    wb.edit('Borders', () => s.setBorders({ r1: 0, c1: 0, r2: 1, c2: 1 }, 'all'));
    expect(s.styleAt(1, 1)?.borders?.bottom).toBeTruthy();
  });
});

describe('F1131: formatting a block of more than 10,000 cells', () => {
  it('keeps the format in its empty cells, so a number typed later shows in it', () => {
    const wb = sheetWith({ A1: '1' });
    const s = wb.sheet;
    // A1:Z500 is 13,000 cells
    wb.edit('Format', () => s.patchStyle({ r1: 0, c1: 0, r2: 499, c2: 25 }, { numFmt: '0.00' }));
    wb.edit('Type', () => s.setInput(299, 0, '3.14159'));
    expect(s.styleAt(299, 0)?.numFmt).toBe('0.00');
    expect(s.shownText(299, 0)).toBe('3.14');
  });
});

describe('F295: Clear Formats on whole columns', () => {
  it('clears a formatted empty column past the data', () => {
    const wb = sheetWith({ A1: '1', B1: '2', C1: '3' });
    const s = wb.sheet;
    const H = { r1: 0, c1: 7, r2: MAX_ROWS - 1, c2: 7 };
    wb.edit('Format', () => s.patchStyle(H, { numFmt: '0.000' }));
    expect(s.colStyles.get(7)?.numFmt).toBe('0.000');
    wb.edit('Clear Formats', () => s.clear(H, 'formats'));
    expect(s.colStyles.get(7)).toBeUndefined();
    wb.edit('Type', () => s.setInput(2, 7, '5'));
    expect(s.styleAt(2, 7)?.numFmt).toBeUndefined();
  });
});

describe('F1132: Clear Formats keeps what a cell is', () => {
  it('a Compound cell stays a Compound', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Compound', () => {
      s.setCompound(0, 0, card);
      s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
      s.setInput(0, 1, '=FIELDVALUE(A1,"Molecular weight")');
    });
    wb.edit('Clear Formats', () => s.clear({ r1: 0, c1: 0, r2: 0, c2: 0 }, 'formats'));
    expect(s.cell(0, 0)?.compound?.cid).toBe(2244);
    expect(s.cell(0, 0)?.style?.bold).toBeFalsy();
    expect(s.value(0, 1)).toBe(180.16);
  });
});

describe('F297: Copy, Cut and Fill keep Compound cards and array formulas', () => {
  it('Cut and paste moves the card with the name', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Compound', () => s.setCompound(1, 0, card));
    wb.edit('Move', () => s.move({ r1: 1, c1: 0, r2: 1, c2: 0 }, { row: 4, col: 0 }));
    expect(s.cell(4, 0)?.compound?.cid).toBe(2244);
    expect(s.cell(1, 0)).toBeUndefined();
    wb.edit('Type', () => s.setInput(4, 1, '=FIELDVALUE(A5,"Molecular weight")'));
    expect(s.value(4, 1)).toBe(180.16);
  });

  it('Copy and Paste keeps the card; Fill Down copies it too', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Compound', () => s.setCompound(0, 0, card));
    const block = s.copy({ r1: 0, c1: 0, r2: 0, c2: 0 });
    wb.edit('Paste', () => s.paste({ row: 0, col: 2 }, block));
    expect(s.cell(0, 2)?.compound?.cid).toBe(2244);
    wb.edit('Fill Down', () => s.fill({ r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }));
    expect(s.cell(2, 0)?.compound?.cid).toBe(2244);
  });

  it('a moved legacy array formula is still one', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Array', () => {
      s.setInput(0, 0, '1');
      s.setInput(1, 0, '2');
      s.setInput(2, 0, '3');
      s.setCell(0, 2, { input: '=A1:A3*2', array: { rows: 3, cols: 1 } });
    });
    wb.edit('Move', () => s.move({ r1: 0, c1: 2, r2: 0, c2: 2 }, { row: 0, col: 4 }));
    expect(s.cell(0, 4)?.array).toEqual({ rows: 3, cols: 1 });
  });
});

describe('F1133: Fill keeps rich text', () => {
  it('a bold word stays bold when filled down', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => s.setRichInput(0, 0, 'Note: draft', [{ text: 'Note', bold: true }, { text: ': draft' }] as never));
    const runs = s.cell(0, 0)?.runs;
    expect(runs).toBeTruthy();
    wb.edit('Fill Down', () => s.fill({ r1: 0, c1: 0, r2: 0, c2: 0 }, { r1: 0, c1: 0, r2: 2, c2: 0 }));
    expect(s.cell(2, 0)?.runs).toEqual(runs);
  });
});

describe('F296: copying whole columns', () => {
  it('reads only the rows in use, and pastes the column formatting', () => {
    const wb = sheetWith({ A1: '1', A2: '2' });
    const s = wb.sheet;
    const colA = { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: 0 };
    wb.edit('Format', () => s.patchStyle(colA, { numFmt: '0.0' }));
    const t0 = performance.now();
    const block = s.copy(colA);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(block.rows).toBe(MAX_ROWS);
    expect(block.cells.length).toBeLessThan(10);
    wb.edit('Paste Formatting', () => s.paste({ row: 0, col: 3 }, block, 'formats'));
    expect(s.colStyles.get(3)?.numFmt).toBe('0.0');
    expect(s.styleAt(500, 3)?.numFmt).toBe('0.0');
  });
});

describe('F298: filters leave rows hidden by hand alone', () => {
  it('turning Filter on and off keeps rows hidden above the table hidden', () => {
    const wb = sheetWith({ A4: 'Name', A5: 'a', A6: 'b', A7: 'c' });
    const s = wb.sheet;
    wb.edit('Hide', () => { s.setRowHidden(0, true); s.setRowHidden(1, true); });
    const table = { r1: 3, c1: 0, r2: 6, c2: 0 };
    // Excel: turning AutoFilter on changes no row
    wb.edit('Filter', () => s.setFilter({ range: table, conditions: {} }));
    expect(s.hiddenRows.has(0)).toBe(true);
    expect(s.hiddenRows.has(1)).toBe(true);
    wb.edit('Filter', () => s.setCondition(0, { kind: 'values', allowed: ['a'] }));
    expect(s.hiddenRows.has(5)).toBe(true);
    expect(s.hiddenRows.has(0)).toBe(true);
    wb.edit('Filter off', () => s.setFilter(null));
    expect(s.hiddenRows.has(5)).toBe(false);
    expect(s.hiddenRows.has(6)).toBe(false);
    expect(s.hiddenRows.has(0)).toBe(true);
    expect(s.hiddenRows.has(1)).toBe(true);
  });

  it('taking the last condition away shows the rows it hid', () => {
    const wb = sheetWith({ A1: 'Name', A2: 'a', A3: 'b' });
    const s = wb.sheet;
    wb.edit('Filter', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 2, c2: 0 }, conditions: { 0: { kind: 'values', allowed: ['a'] } } }));
    expect(s.hiddenRows.has(2)).toBe(true);
    wb.edit('Clear', () => s.setCondition(0, null));
    expect(s.hiddenRows.has(2)).toBe(false);
  });
});

describe('F1134: value-list filters', () => {
  it('look each row up in a set, not the whole list', () => {
    const cells: Record<string, string> = { A1: 'Name' };
    for (let r = 2; r <= 400; r++) cells[`A${r}`] = `n${r}`;
    const wb = sheetWith(cells);
    const s = wb.sheet;
    const allowed = Array.from({ length: 398 }, (_, i) => `n${i + 2}`);
    const includes = vi.spyOn(allowed, 'includes');
    wb.edit('Filter', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 399, c2: 0 }, conditions: { 0: { kind: 'values', allowed } } }));
    expect(includes).not.toHaveBeenCalled();
    expect(s.hiddenRows.has(399)).toBe(true);
    expect(s.hiddenRows.has(398)).toBe(false);
  });
});

describe('F1135: merging over a spilled array', () => {
  it('turns the array into #SPILL!, and unmerging lets it spill again', () => {
    const wb = sheetWith({ A1: '=SEQUENCE(3)' });
    const s = wb.sheet;
    expect(val(wb, 'A2')).toBe(2);
    // Excel: a merged cell in the spill range gives #SPILL! (Microsoft Support, "How to correct a #SPILL! error")
    wb.edit('Merge', () => s.merge({ r1: 1, c1: 0, r2: 2, c2: 1 }));
    expect(val(wb, 'A1')).toBe('#SPILL!');
    wb.edit('Unmerge', () => s.unmerge({ r1: 1, c1: 0, r2: 2, c2: 1 }));
    expect(val(wb, 'A3')).toBe(3);
  });
});

describe('F1130: conditional formats that read another sheet', () => {
  it('follow a typed value there', () => {
    const wb = new Workbook();
    wb.edit('Insert Sheet', () => wb.addSheet());
    const [s1, s2] = wb.sheets;
    wb.edit('Type', () => {
      s1.setInput(0, 0, '1');
      s2.setInput(1, 1, 'x');
      s2.setCondFormats([{ id: 1, ranges: [{ r1: 1, c1: 1, r2: 9, c2: 1 }], rule: { kind: 'formula', formula: `=${s1.name}!$A$1>5`, look: { fill: '#ff0000' } } }]);
    });
    expect(s2.condLook(1, 1)?.fill).toBeUndefined();
    wb.edit('Type', () => s1.setInput(0, 0, '10'));
    expect(s2.condLook(1, 1)?.fill).toBe('#ff0000');
  });
});

describe('F299: names that use each other', () => {
  it('do not overflow the stack; the cells show an error', () => {
    const wb = new Workbook();
    wb.edit('Names', () => {
      wb.setNames([{ name: 'Rate', formula: '=Base*2' }, { name: 'Base', formula: '=Rate+1' }] as never);
      wb.sheet.setInput(0, 0, '=Rate');
      wb.sheet.setInput(0, 1, '5');
    });
    expect(wb.sheet.value(0, 0)).toBeInstanceOf(CellError);
    expect(wb.sheet.value(0, 1)).toBe(5);
  });
});

describe('F300: running totals over a column of formulas', () => {
  it('links far fewer than n² dependencies, with the same answers', () => {
    const n = 3000;
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      for (let r = 0; r < n; r++) {
        s.setInput(r, 0, String(r + 1));
        s.setInput(r, 1, `=A${r + 1}*2`);
        s.setInput(r, 2, `=SUM(B$1:B${r + 1})`);
      }
    });
    // the sum of 2k for k = 1..n is n(n+1)
    expect(s.value(n - 1, 2)).toBe(n * (n + 1));
    expect(s.value(99, 2)).toBe(100 * 101);
    const g = (wb as unknown as { graph: { dependents: number[][] } }).graph;
    const edges = g.dependents.reduce((t, d) => t + d.length, 0);
    // n²/2 is 4.5 million; with links through runs of the column it is a small multiple of n
    expect(edges).toBeLessThan(200 * n);
    // a typed value still reaches every total below it
    wb.edit('Type', () => s.setInput(0, 0, '11'));
    expect(s.value(n - 1, 2)).toBe(n * (n + 1) + 20);
    // a total inside the block it reads is still a loop
    wb.edit('Type', () => s.setInput(0, 3, `=SUM(D1:D${n})`));
    expect((s.value(0, 3) as CellError).code).toBe('#CIRC!');
  }, 30000);

  it('keeps a formula reading a long block of formulas below the ones it reads', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('Type', () => {
      for (let r = 0; r < 200; r++) s.setInput(r, 1, `=${r}+1`);
      s.setInput(0, 3, '=SUM(B1:B200)');
      s.setInput(1, 3, '=D1+1');
    });
    expect(s.value(0, 3)).toBe(200 * 201 / 2);
    expect(s.value(1, 3)).toBe(200 * 201 / 2 + 1);
  });
});

describe('F301: filtering asks once whether any formula uses SUBTOTAL', () => {
  it('not once per row hidden', () => {
    const cells: Record<string, string> = { A1: 'Name', B1: 'Twice' };
    for (let r = 2; r <= 600; r++) { cells[`A${r}`] = r % 2 ? 'odd' : 'even'; cells[`B${r}`] = `=ROW()*2`; }
    const wb = sheetWith(cells);
    const s = wb.sheet;
    const spy = vi.spyOn(wb as unknown as { usesSubtotal: () => boolean }, 'usesSubtotal');
    wb.edit('Filter', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 599, c2: 1 }, conditions: { 0: { kind: 'values', allowed: ['odd'] } } }));
    expect(s.hiddenRows.size).toBe(300);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    spy.mockClear();
    wb.undo();
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('F290: banded rows in a long table', () => {
  it('count the rows showing without walking from the top for every cell', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    const n = 5000;
    wb.edit('Table', () => {
      s.setInput(0, 0, 'Name');
      for (let r = 1; r <= n; r++) s.setInput(r, 0, `x${r}`);
      s.setTables([{ id: 1, name: 'Table1', range: { r1: 0, c1: 0, r2: n, c2: 0 }, style: 'TableStyleMedium2', header: true, bandRows: true }]);
      s.setRowHidden(3, true);
    });
    const has = vi.spyOn(s.hiddenRows, 'has');
    const a = s.shownStyleAt(n - 1, 0)?.fill, b = s.shownStyleAt(n, 0)?.fill;
    expect(has.mock.calls.length).toBeLessThan(50);
    has.mockRestore();
    // the stripes alternate over the rows showing: rows 1, 2, (3 hidden), 4 … so neighbours still differ
    expect(a).not.toBe(b);
    // row 4 follows row 2 in the stripes, as row 3 is hidden
    expect(s.shownStyleAt(4, 0)?.fill).toBe(s.shownStyleAt(1, 0)?.fill);
    expect(s.shownStyleAt(4, 0)?.fill).not.toBe(s.shownStyleAt(2, 0)?.fill);
  });
});
