// Review batch 11 (spreadsheet engine), the formula and text findings: separators, references
// written after a delete, names over two-letter columns, and functions that disagreed with Excel.
// Expected values come from Excel's documented behaviour (Microsoft Support pages named beside
// each) or from plain arithmetic, never from running the code under test.

import { describe, it, expect } from 'vitest';
import { Workbook, type ChemHost, type Structure } from '../src/sheet/workbook';
import type { MolProps } from '../src/sheet/properties';
import type { Contents } from '../src/model';
import { CellError } from '../src/sheet/values';
import { detectSeparator, parseDelimited } from '../src/sheet/csv';
import { parseFormula, tokenize } from '../src/sheet/formula';
import { nameTarget } from '../src/sheet/names';
import { numberText } from '../src/sheet/values';
import { cellStylePatch } from '../src/sheet/cell-styles';
import { readsAsSmiles, structureColumns } from '../src/sheet/can-run';

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

describe('F272: semicolon files with decimal commas', () => {
  it('reads 1,5;2,5 as semicolon-separated numbers with decimal commas', () => {
    const text = '1,5;2,5;3,5;4,5\n6,5;7,5;8,5;9,5';
    expect(detectSeparator(text)).toBe(';');
    expect(parseDelimited(text)).toEqual([['1,5', '2,5', '3,5', '4,5'], ['6,5', '7,5', '8,5', '9,5']]);
  });

  it('still reads a comma file whose text has an odd semicolon as comma-separated', () => {
    expect(detectSeparator('name,notes\nA,x;y\nB,z')).toBe(',');
  });

  it('reads a comma file with one semicolon on every line as comma-separated', () => {
    expect(detectSeparator('1a,7.26 (m; 5H),88\n1b,7.30 (d; 2H),91')).toBe(',');
    expect(detectSeparator('Smith; John,1,2\nDoe; Jane,3,4')).toBe(',');
  });

  it('reads a single semicolon row with decimal commas', () => {
    expect(detectSeparator('1,5;2,5;3,5;4,5')).toBe(';');
    expect(detectSeparator('a;b;c')).toBe(';');
  });
});

describe('F276: a broken reference to another sheet reads back as #REF!', () => {
  it('tokenizes Sheet2!#REF! and \'My Sheet\'!#REF!', () => {
    expect(() => tokenize('Sheet2!#REF!*2')).not.toThrow();
    expect(() => parseFormula("='My Sheet'!#REF!+1")).not.toThrow();
  });

  it('shows #REF! (not #NAME?) after the row it read on another sheet is deleted', () => {
    const wb = new Workbook();
    wb.edit('Insert Sheet', () => wb.addSheet());
    const [s1, s2] = wb.sheets;
    expect(s2).toBeDefined();
    wb.edit('Type', () => {
      s2.setInput(4, 0, '7');
      s1.setInput(0, 0, `=${s2.name}!A5*2`);
    });
    expect(s1.value(0, 0)).toBe(14);
    wb.edit('Delete', () => s2.deleteRows(4));
    expect(s1.cell(0, 0)?.input).toBe(`=${s2.name}!#REF!*2`);
    // Excel shows #REF! for a reference to deleted cells (Microsoft Support, "How to correct a #REF! error")
    expect((s1.value(0, 0) as CellError).code).toBe('#REF!');
  });
});

describe('F277: nameTarget with two-letter columns', () => {
  it('reads AB5 and AA1:AD40 with no sheet and no $', () => {
    expect(nameTarget('AB5')).toEqual({ sheet: null, range: { r1: 4, c1: 27, r2: 4, c2: 27 } });
    expect(nameTarget('=AA1:AD40')).toEqual({ sheet: null, range: { r1: 0, c1: 26, r2: 39, c2: 29 } });
  });

  it('still reads sheets, quoted sheets and $ references', () => {
    expect(nameTarget('=Sheet1!$C$2:$C$40')).toEqual({ sheet: 'Sheet1', range: { r1: 1, c1: 2, r2: 39, c2: 2 } });
    expect(nameTarget("='It''s'!AB5")?.sheet).toBe("It's");
    expect(nameTarget('=Sheet1AB5')).toBeNull();
  });
});

describe('F1099: STEYX of a perfect straight line', () => {
  it('is 0, not #NUM!', () => {
    // y = 0.7x exactly: no scatter about the line, so the standard error is 0 (Microsoft Support,
    // STEYX function); in floating point the sum under the root comes out just below zero
    const wb = sheetWith({ A1: '1', A2: '2', A3: '3', A4: '4', B1: '0.7', B2: '1.4', B3: '2.1', B4: '2.8', C1: '=STEYX(B1:B4,A1:A4)' });
    const v = val(wb, 'C1');
    expect(typeof v).toBe('number');
    expect(v as number).toBeCloseTo(0, 10);
  });
});

describe('F1100: LOG with base 10', () => {
  it('gives exactly 3 for 1000', () => {
    // log10(1000) = 3; Excel: =INT(LOG(1000)) is 3 and =MOD(LOG(1000),1) is 0
    const wb = sheetWith({ A1: '=INT(LOG(1000))', A2: '=MOD(LOG(1000),1)', A3: '=INT(LOG(1000,10))' });
    expect(val(wb, 'A1')).toBe(3);
    expect(val(wb, 'A2')).toBe(0);
    expect(val(wb, 'A3')).toBe(3);
  });
});

describe('F1101: a LET name holding a block on another sheet', () => {
  it('OFFSET and ROWS read the sheet the block came from', () => {
    const wb = new Workbook();
    wb.edit('Insert Sheet', () => wb.addSheet());
    const [s1, s2] = wb.sheets;
    wb.edit('Type', () => {
      for (let r = 0; r < 5; r++) s2.setInput(r, 0, String((r + 1) * 10));
      for (let r = 0; r < 5; r++) s1.setInput(r, 0, String(r + 1));
      s1.setInput(0, 2, `=LET(r,${s2.name}!A1:A5,OFFSET(r,1,0,1,1))`);
    });
    // OFFSET(r,1,0,1,1) is the cell one row below the top of r: Sheet2!A2, which holds 20
    expect(s1.value(0, 2)).toBe(20);
  });
});

describe('F1102: COUNT of a single cell', () => {
  it('skips TRUE and number-like text in a referenced cell, as a range does', () => {
    // Excel: "Logical values and text representations of numbers in a reference are not counted" (Microsoft Support, COUNT function)
    const wb = sheetWith({ A1: 'TRUE', A2: "'5", A3: '7', B1: '=COUNT(A1)', B2: '=COUNT(A1:A1)', B3: '=COUNT(A2)', B4: '=COUNT(A1,A2,A3)' });
    expect(val(wb, 'B1')).toBe(0);
    expect(val(wb, 'B2')).toBe(0);
    expect(val(wb, 'B3')).toBe(0);
    expect(val(wb, 'B4')).toBe(1);
  });
});

describe('F1104: DUPLICATE with the range on its own sheet named', () => {
  it('does not report the cell itself', () => {
    const wb = new Workbook();
    // a stand-in for the chemistry: each drawing's one atom label is its InChIKey
    const props = (key: string): MolProps => ({ formula: 'C', mw: 12, exact: 12, charge: 0, smiles: key, inchikey: key, clogp: 0, tpsa: 0, hbd: 0, hba: 0, rotb: 0 });
    const host: ChemHost = { structure: (st: Structure) => props((st.contents.atoms[0] as unknown as { label: string }).label), smiles: (t: string) => props(t) };
    wb.chem = host;
    const s = wb.sheet;
    const drawing = (label: string): Contents => ({ atoms: [{ id: 1, x: 0, y: 0, z: 6, charge: 0, isotope: 0, label } as never], bonds: [], captions: [], arrows: [], shapes: [] });
    wb.edit('Type', () => {
      s.setStructure(1, 1, drawing('KEY-A'));
      s.setStructure(2, 1, drawing('KEY-B'));
      s.setStructure(3, 1, drawing('KEY-A'));
      s.setInput(1, 2, `=DUPLICATE(B2,${s.name}!B:B)`);
      s.setInput(2, 2, `=DUPLICATE(B3,${s.name}!B:B)`);
      s.setInput(1, 3, '=DUPLICATE(B2,B:B)');
    });
    expect(s.value(1, 2)).toBe('B4');
    expect(s.value(2, 2)).toBe('');
    expect(s.value(1, 3)).toBe('B4');
  });
});

describe('F1111: SORT and SORTBY keep blanks last when descending', () => {
  it('SORT(A1:A3,1,-1) gives 3, 1, blank', () => {
    const wb = sheetWith({ A1: '3', A3: '1', C1: '=SORT(A1:A3,1,-1)' });
    expect(val(wb, 'C1')).toBe(3);
    expect(val(wb, 'C2')).toBe(1);
    // the blank comes last; a spilled empty cell shows 0, as Excel spills it (Microsoft Support, "Dynamic array formulas")
    expect(val(wb, 'C3')).toBe(0);
  });

  it('SORTBY(A1:A3,A1:A3,-1) gives 3, 1, blank', () => {
    const wb = sheetWith({ A1: '3', A3: '1', C1: '=SORTBY(A1:A3,A1:A3,-1)' });
    expect(val(wb, 'C1')).toBe(3);
    expect(val(wb, 'C2')).toBe(1);
  });
});

describe('F1112: SUMIF over a LET name', () => {
  it('sizes the sum range like the range the name holds', () => {
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 10; r++) { cells[`A${r}`] = '1'; cells[`B${r}`] = '2'; }
    const wb = sheetWith({ ...cells, D1: '=LET(r,A1:A10,SUMIF(r,">0",B1))' });
    // ten matches of 2, as SUMIF(A1:A10,">0",B1) (Microsoft Support, SUMIF function)
    expect(val(wb, 'D1')).toBe(20);
  });
});

describe('F1113: COUNTIF, SUMIF and AVERAGEIF on one cell', () => {
  it('accept a single-cell range', () => {
    // Excel accepts any cell reference as the range (Microsoft Support, COUNTIF function)
    const wb = sheetWith({ A1: 'Pd', C1: '4', B1: '=COUNTIF(A1,"Pd")', B2: '=SUMIF(A1,"Pd",C1)', B3: '=AVERAGEIF(A1,"Pd",C1)' });
    expect(val(wb, 'B1')).toBe(1);
    expect(val(wb, 'B2')).toBe(4);
    expect(val(wb, 'B3')).toBe(4);
  });
});

describe('F1112: SUMIF with a smaller sum range', () => {
  it('sizes the sum range like the tested range from its top-left cell', () => {
    // Microsoft Support, SUMIF function: "the sum_range ... uses the top-left cell ... and then
    // includes cells that correspond in size and shape to the range"
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 10; r++) { cells[`A${r}`] = '1'; cells[`B${r}`] = '2'; }
    const wb = sheetWith({ ...cells, D1: '=SUMIF(A1:A10,">0",B1)', D2: '=SUMIF(A1:A10,">0",B1:B5)', D3: '=AVERAGEIF(A1:A10,">0",B1)' });
    expect(val(wb, 'D1')).toBe(20);
    expect(val(wb, 'D2')).toBe(20);
    expect(val(wb, 'D3')).toBe(2);
  });

  it('works the sum out again when a cell past the written sum range changes', () => {
    const cells: Record<string, string> = {};
    for (let r = 1; r <= 10; r++) { cells[`A${r}`] = '1'; cells[`B${r}`] = '2'; }
    const wb = sheetWith({ ...cells, D1: '=SUMIF(A1:A10,">0",B1)' });
    wb.edit('Type', () => wb.sheet.setInput(...A('B9'), '12'));
    expect(val(wb, 'D1')).toBe(30);
  });
});

describe('F1114: WORKDAY with a huge day count', () => {
  it('gives #NUM! at once instead of running for ever', () => {
    const wb = sheetWith({ A1: '=WORKDAY(45000,1E12)', A2: '=WORKDAY(45000,-1E12)' });
    // past 31 December 9999, the last date Excel holds (Microsoft Support, WORKDAY function: #NUM! for an invalid date)
    expect(val(wb, 'A1')).toBe('#NUM!');
    expect(val(wb, 'A2')).toBe('#NUM!');
  }, 5000);
});

describe('F1129: numbers joined to text use two-digit exponents', () => {
  it('writes 1E-07 and 5E-08, as Excel does', () => {
    expect(numberText(1e-7)).toBe('1E-07');
    expect(numberText(5e-8)).toBe('5E-08');
    expect(numberText(1e21)).toBe('1E+21');
    const wb = sheetWith({ A1: '=1E-7&""' });
    expect(val(wb, 'A1')).toBe('1E-07');
  });
});

describe('F270: a cell style keeps the number format', () => {
  it('Good leaves m/d/yyyy alone; Normal puts back General', () => {
    // Excel's Good, Bad and Neutral and heading styles don't include a number format; Normal does (General)
    const wb = sheetWith({ A1: '10/22/2026', A2: '45%' });
    const s = wb.sheet;
    const before1 = s.styleAt(0, 0)?.numFmt, before2 = s.styleAt(1, 0)?.numFmt;
    expect(before1).toBeTruthy();
    expect(before2).toBe('0%');
    wb.edit('Good', () => s.patchStyle({ r1: 0, c1: 0, r2: 1, c2: 0 }, cellStylePatch('Good', null)));
    expect(s.styleAt(0, 0)?.numFmt).toBe(before1);
    expect(s.styleAt(1, 0)?.numFmt).toBe('0%');
    wb.edit('Heading 1', () => s.patchStyle({ r1: 1, c1: 0, r2: 1, c2: 0 }, cellStylePatch('Heading 1', null)));
    expect(s.styleAt(1, 0)?.numFmt).toBe('0%');
    wb.edit('Normal', () => s.patchStyle({ r1: 0, c1: 0, r2: 1, c2: 0 }, cellStylePatch('Normal', null)));
    expect(s.styleAt(0, 0)?.numFmt).toBeUndefined();
  });
});

describe('F1081: which text counts as SMILES', () => {
  it('reads SMILES but not names', () => {
    // SMILES grammar: Weininger, J. Chem. Inf. Comput. Sci. 1988, 28, 31
    for (const s of ['CCO', 'c1ccccc1', 'CC(=O)Oc1ccccc1C(=O)O', '[Na+].[Cl-]', 'ClCCl', 'C1CC%10CC1%10']) expect(readsAsSmiles(s)).toBe(true);
    for (const s of ['Aspirin', 'Ethanol', 'Benzene', 'THF', 'DCM', 'Pd', 'C1CC', 'CC(C', '12']) expect(readsAsSmiles(s)).toBe(false);
    // aromatic (lower-case) atoms stand only in rings, so element symbols and Boc are not SMILES
    for (const s of ['Boc', 'Co', 'Cs', 'Os', 'Sn', 'Pb', 'Sb', 'No']) expect(readsAsSmiles(s)).toBe(false);
    // * is an attachment point (OpenSMILES)
    expect(readsAsSmiles('*CC')).toBe(true);
  });

  it('does not list a column of names as a SMILES column', () => {
    const wb = sheetWith({ A1: 'Name', B1: 'Mass', A2: 'Aspirin', A3: 'Ethanol', A4: 'Benzene', B2: '180.16', B3: '46.07', B4: '78.11' });
    expect(structureColumns(wb.sheet, { r1: 0, c1: 0, r2: 3, c2: 1 })).toEqual([]);
    // a reagent column of abbreviations made of atom letters
    const reagents = sheetWith({ A1: 'Reagent', A2: 'NBS', A3: 'NCS', A4: 'PCC', A5: 'NIS' });
    expect(structureColumns(reagents.sheet, { r1: 0, c1: 0, r2: 4, c2: 0 })).toEqual([]);
    const wb2 = sheetWith({ A1: 'SMILES', A2: 'CCO', A3: 'c1ccccc1' });
    expect(structureColumns(wb2.sheet, { r1: 0, c1: 0, r2: 2, c2: 0 }).map((c) => c.col)).toEqual([0]);
  });
});
