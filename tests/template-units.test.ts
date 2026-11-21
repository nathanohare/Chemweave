// @vitest-environment jsdom
//
// Spreadsheet templates' columns take the number format of the unit in their heading (review
// round 2, finding 23): the unit in the heading over plain numbers, or in every cell.

import { describe, it, expect } from 'vitest';
import { SHEET_TEMPLATES } from '../src/sheet/templates';
import { headingUnit, headingFor, unitColumnFormat } from '../src/sheet/template-units';
import { formatValue } from '../src/sheet/numfmt';
import { Workbook } from '../src/sheet/workbook';
import { fillReagentTable } from '../src/sheet/reagents';
import { writeXlsx, readXlsx } from '../src/io/xlsx';

const make = (id: string, units: 'header' | 'cell' = 'header') => SHEET_TEMPLATES.find((t) => t.id === id)!.make(units);
const shown = (fmt: string | undefined, v: number) => formatValue(v, fmt).text;

describe('units in headings', () => {
  it('finds a bracketed unit or a heading that is a unit, and nothing else', () => {
    expect(headingUnit('Temp (°C)')).toEqual({ label: 'Temp', unit: '°C' });
    expect(headingUnit('Loading (mol %)')).toEqual({ label: 'Loading', unit: 'mol %' });
    expect(headingUnit('equiv')).toEqual({ label: 'equiv', unit: 'equiv' });
    expect(headingUnit('er (first:second)')).toBeNull();
    expect(headingUnit('Notes')).toBeNull();
    expect(headingFor('Time (h)', 'cell')).toBe('Time');
    expect(headingFor('Time (h)', 'header')).toBe('Time (h)');
    expect(headingFor('mmol', 'cell')).toBe('mmol');
  });

  it('formats keep the number part a column already has, and leave dates and currency alone', () => {
    expect(unitColumnFormat('°C', 'header')).toBe('0;"−"0');
    expect(unitColumnFormat('°C', 'cell')).toBe('0" °C";"−"0" °C"');
    expect(unitColumnFormat('%', 'cell')).toBe('0"%";"−"0"%"');
    expect(unitColumnFormat('mmol', 'cell', '0.0000')).toBe('0.0000" mmol";"−"0.0000" mmol"');
    expect(unitColumnFormat('mg', 'cell', 'yyyy-mm-dd')).toBe('yyyy-mm-dd');
    expect(unitColumnFormat('mg', 'header', 'General')).toBe('0.0;"−"0.0');
  });

  it('shows the numbers chemists type without rounding them away', () => {
    expect(shown(unitColumnFormat('°C', 'cell'), -78)).toBe('−78 °C');
    expect(shown(unitColumnFormat('h', 'cell'), 0.5)).toBe('0.5 h');
    expect(shown(unitColumnFormat('mol %', 'cell'), 2.5)).toBe('2.5 mol %');
    expect(shown(unitColumnFormat('equiv', 'header'), 1.05)).toBe('1.05');
    expect(shown(unitColumnFormat('g/mL', 'header'), 0.789)).toBe('0.789');
    expect(shown(unitColumnFormat('%', 'cell'), 85)).toBe('85%');
  });
});

describe('templates', () => {
  it('the reaction table: no column with a unit is General, in either place', () => {
    for (const units of ['header', 'cell'] as const) {
      const sh = make('reaction-table', units).sheets[0];
      const col = (name: string) => [...Array(15).keys()].find((c) => sh.cell(0, c)?.input === headingFor(name, units))!;
      for (const h of ['Loading (mol %)', 'Conc. (M)', 'Temp (°C)', 'Time (h)', 'Conv. (%)', 'Yield (%)', 'ee (%)']) {
        const c = col(h);
        expect(c, h).toBeGreaterThanOrEqual(0);
        for (const r of [1, 12]) expect(sh.styleAt(r, c)?.numFmt, `${h} row ${r}`).toBeTruthy();
      }
      const temp = sh.styleAt(1, col('Temp (°C)'))?.numFmt;
      expect(shown(temp, -78)).toBe(units === 'cell' ? '−78 °C' : '−78');
      // the headings keep their bold and line
      expect(sh.styleAt(0, col('Temp (°C)'))?.bold).toBe(true);
      // columns without a unit stay as they were
      expect(sh.styleAt(1, col('Solvent'))?.numFmt).toBeUndefined();
    }
  });

  it('every template: each heading or label with a known unit has a non-General format below or beside it', () => {
    for (const t of SHEET_TEMPLATES) {
      const wb = t.make('header');
      for (const sh of wb.sheets) {
        const used = sh.usedRange();
        if (!used) continue;
        for (let r = 0; r <= used.r2; r++) {
          for (let c = 0; c <= used.c2; c++) {
            const text = sh.cell(r, c)?.input ?? '';
            if (!headingUnit(text) || text.startsWith('=')) continue;
            const bold = sh.styleAt(r, c)?.bold;
            // a heading row (bold over a line) formats the cell below; a label in A formats B beside it
            const target = c === 0 && !sh.styleAt(r, c)?.borders?.bottom ? { r, c: 1 } : { r: r + 1, c };
            const fmt = sh.styleAt(target.r, target.c)?.numFmt;
            expect(fmt && fmt.toLowerCase() !== 'general', `${t.id} ${sh.name} "${text}" (bold ${bold})`).toBeTruthy();
          }
        }
      }
    }
  });

  it('kinetics keeps its sample concentrations to three places', () => {
    const sh = make('kinetics').sheets[0];
    expect(shown(sh.styleAt(3, 1)?.numFmt, 0.335)).toBe('0.335');
  });

  it('a template with units in the cells still saves to Excel and back with them', async () => {
    const wb = make('reaction-table', 'cell');
    const { book } = await readXlsx(await writeXlsx(wb, { structurePng: async () => null } as never));
    const sh = book.sheets[0];
    const c = [...Array(15).keys()].find((i) => sh.cell(0, i)?.input === 'Temp')!;
    expect(shown(sh.styleAt(1, c)?.numFmt, -78)).toBe('−78 °C');
  });
});

describe('reagent table', () => {
  it('every column with a unit has its format all the way down, the headings their own', () => {
    for (const units of ['header', 'cell'] as const) {
      const wb = new Workbook(['R']);
      const sh = wb.sheets[0];
      wb.build(() => fillReagentTable(sh, units));
      // equiv, mmol, density and concentration typed in a new row far down
      for (const [c, v, header, cell] of [[3, 1.2, '1.20', '1.20 equiv'], [6, 0.789, '0.789', '0.789 g/mL'], [7, 0.5, '0.50', '0.50 M'], [2, 245.3, '245.30', '245.30 g/mol']] as const) {
        expect(shown(sh.styleAt(40, c)?.numFmt, v)).toBe(units === 'cell' ? cell : header);
      }
      expect(sh.styleAt(0, 3)?.numFmt).toBeUndefined();
      expect(sh.cell(0, 5)?.input).toBe(units === 'cell' ? 'mass' : 'mass (mg)');
    }
  });
});
