import { describe, expect, it } from 'vitest';
import { stoichiometryBook } from '../src/chem/stoichiometry';

describe('stoichiometry table', () => {
  it('works out millimoles, masses and volumes from the first starting material', () => {
    const wb = stoichiometryBook([
      { role: 'Starting material', name: 'C7H6O', formula: 'C7H6O', mw: 106.12 },
      { role: 'Reagent', name: 'NaBH4', formula: 'BH4Na', mw: 37.83 },
      { role: 'Conditions', name: 'MeOH, 0 °C' },
      { role: 'Product', name: 'C7H8O', formula: 'C7H8O', mw: 108.14 },
    ], 2);
    const sh = wb.sheets[0];
    wb.edit('Equiv', () => { sh.setInput(2, 4, '1.5'); sh.setInput(2, 8, '1.0'); });
    const v = (r: number, c: number) => Number(sh.value(r, c));
    expect(sh.value(0, 5)).toBe('mmol');
    expect(v(1, 5)).toBe(2);
    expect(v(1, 6)).toBeCloseTo(212.24, 2);
    expect(v(2, 5)).toBeCloseTo(3, 6);
    expect(v(2, 6)).toBeCloseTo(113.49, 2);
    expect(v(2, 10)).toBeCloseTo(113.49, 2);
    expect(sh.value(3, 5) ?? null).toBeNull();
    expect(v(4, 6)).toBeCloseTo(216.28, 2);
  });
});

describe('purity and solutions (G4-15)', () => {
  it('weighs out more of an impure reagent, and measures a solution by its concentration', () => {
    const wb = stoichiometryBook([
      { role: 'Starting material', name: 'C7H6O', formula: 'C7H6O', mw: 106.12 },
      { role: 'Reagent', name: 'n-BuLi', formula: 'C4H9Li', mw: 64.06 },
      { role: 'Reagent', name: 'NaBH4', formula: 'BH4Na', mw: 37.83 },
    ], 2);
    const sh = wb.sheets[0];
    const v = (r: number, c: number) => Number(sh.value(r, c));
    expect(sh.value(0, 7)).toBe('Purity (%)');
    expect(sh.value(0, 9)).toBe('Conc. (M)');
    // 1.1 equiv of n-BuLi as a 2.5 M solution: 2.2 mmol ÷ 2.5 mol/L = 0.88 mL = 880 µL
    // (n = c·V; Harris, Quantitative Chemical Analysis, ch. 1); a density typed too doesn't change it
    wb.edit('BuLi', () => { sh.setInput(2, 4, '1.1'); sh.setInput(2, 9, '2.5'); sh.setInput(2, 8, '0.68'); });
    expect(v(2, 10)).toBeCloseTo(880, 6);
    // NaBH4 98 %: 2 mmol × 37.83 mg/mmol ÷ 0.98 = 77.20 mg weighed out
    wb.edit('NaBH4', () => { sh.setInput(3, 7, '98'); });
    expect(v(3, 6)).toBeCloseTo((2 * 37.83) / 0.98, 6);
    // a neat liquid of 95 % purity: the mass weighed out over its density
    wb.edit('Liquid', () => { sh.setInput(1, 7, '95'); sh.setInput(1, 8, '1.044'); });
    expect(v(1, 6)).toBeCloseTo((2 * 106.12) / 0.95, 6);
    expect(v(1, 10)).toBeCloseTo((2 * 106.12) / 0.95 / 1.044, 6);
    // the values filled in are formulas in cells: any of them can be typed over
    wb.edit('Override', () => { sh.setInput(1, 10, '200'); });
    expect(v(1, 10)).toBe(200);
  });
});

describe('green metrics', () => {
  it('works out yield, E-factor and PMI from the table, with no atom economy', async () => {
    const { greenRows } = await import('../src/chem/stoichiometry');
    const wb = stoichiometryBook([
      { role: 'Starting material', name: 'benzaldehyde', formula: 'C7H6O', mw: 106.12 },
      { role: 'Reagent', name: 'NaBH4', formula: 'BH4Na', mw: 37.83 },
      { role: 'Product', name: 'benzyl alcohol', formula: 'C7H8O', mw: 108.14 },
    ], 2);
    const sh = wb.sheets[0];
    const g = greenRows(3);
    const v = (r: number) => Number(sh.value(r, 3));
    // no atom economy row or "In atom economy" column (Nate, 2026-11-03)
    for (let r = 0; r <= g.note; r++) for (let c = 0; c < 12; c++) expect(String(sh.value(r, c) ?? ''), `${r},${c}`).not.toMatch(/atom economy/i);
    expect(sh.value(0, 11) ?? '').toBe('');
    expect(sh.value(g.title + 1, 0)).toBe('Product isolated (mg)');
    expect(sh.value(g.eFactor, 3)).toBe('');
    // 190 mg of product were isolated
    wb.edit('Mass', () => { sh.setInput(g.isolated, 3, '190'); });
    const inMass = 2 * 106.12 + 2 * 37.83;
    expect(v(g.yield)).toBeCloseTo((100 * 190) / (2 * 108.14), 3);
    expect(v(g.eFactor)).toBeCloseTo((inMass - 190) / 190, 4);
    expect(v(g.pmi)).toBeCloseTo(inMass / 190, 4);
  });
});

describe('purity typed in any of the usual ways (review F4-R01, F4-R10)', () => {
  const book = () => stoichiometryBook([
    { role: 'Starting material', name: 'C7H6O', formula: 'C7H6O', mw: 106.12 },
    { role: 'Product', name: 'C7H8O', formula: 'C7H8O', mw: 108.14 },
  ], 2);
  it('reads 98, 98% and 0.98 as 98%, and shows each as 98.0%', () => {
    // 2 mmol × 106.12 g/mol = 212.24 mg of pure compound; at 98% purity 212.24 ÷ 0.98 = 216.57 mg
    for (const typed of ['98', '98%', '0.98']) {
      const wb = book();
      const sh = wb.sheets[0];
      wb.edit('purity', () => sh.setInput(1, 7, typed));
      expect(Number(sh.value(1, 6)), typed).toBeCloseTo(216.57, 2);
      expect(sh.shownText(1, 7), typed).toBe('98.0%');
    }
  });
  it('takes an empty, zero or text purity as pure, not as an error', () => {
    for (const typed of ['', '0', 'n/a']) {
      const wb = book();
      const sh = wb.sheets[0];
      wb.edit('purity', () => sh.setInput(1, 7, typed));
      expect(Number(sh.value(1, 6)), typed).toBeCloseTo(212.24, 2);
    }
  });
  it('works the yield out from the product itself, whatever purity is typed on its row', () => {
    const wb = book();
    const sh = wb.sheets[0];
    const rows = sh.usedRange()!.r2 + 1;
    const yieldRow = [...Array(rows).keys()].find((r) => sh.value(r, 0) === 'Yield (%)')!;
    const isolated = [...Array(rows).keys()].find((r) => sh.value(r, 0) === 'Product isolated (mg)')!;
    // 2 mmol of C7H8O is 216.28 mg; 194.65 mg isolated is 90.0%
    wb.edit('iso', () => { sh.setInput(isolated, 3, '194.65'); sh.setInput(2, 7, '90'); });
    expect(Number(sh.value(yieldRow, 3))).toBeCloseTo(90.0, 1);
  });
});
