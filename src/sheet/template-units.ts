// Number formats for the columns of the spreadsheet templates, from the unit in each heading
// ("Temp (°C)", "Time (h)", "mass (mg)", or a heading that is itself a unit, "equiv"). Two ways,
// set in Settings ▸ Preferences ▸ New Files:
//  - 'header': the unit stays in the heading and the cells are plain numbers, each column with a
//    fixed number of decimal places (as journal tables are set: "Temp (°C)" over "−78").
//  - 'cell': the unit moves out of the heading into every cell's format ("Temp" over "−78 °C").
// Either way the cell holds just the number, so it still sorts, filters and works in formulas,
// and the format is an ordinary Excel one that Excel shows the same way. Any cell's format can
// be changed afterwards (Home ▸ Number), as with any other.

import type { Sheet } from './workbook';

export type UnitPlace = 'header' | 'cell';

/** The choice in Settings ▸ Preferences (set by the program when settings load or change). */
export const unitPrefs: { place: UnitPlace } = { place: 'cell' };

/**
 * The units the templates' headings use, with the decimal places a column of them gets (chosen
 * by Nate, 2026-11-21: whole hours, one place for M and mL, two for g/mL). The value itself is
 * always kept in full; only what shows is rounded, and Home ▸ Number adds places to any column.
 */
export const UNIT_DECIMALS: Record<string, number> = {
  '°C': 0,
  'h': 0,
  'min': 0,
  'mol %': 1,
  'mol%': 1,
  'equiv': 2,
  'M': 1,
  'mM': 2,
  '%': 0,
  'g/mol': 2,
  'mg': 1,
  'g': 2,
  'mmol': 2,
  'g/mL': 2,
  'mL': 1,
  'µL': 0,
  'L': 1,
  'psi': 0,
  'ppm': 0,
  'atm': 0,
};

/** Units written straight after the number ("85%"); the others have a space ("−78 °C"). */
const TIGHT = new Set(['%']);

/** A heading's unit: in brackets at its end ("Temp (°C)"), or the whole heading ("equiv"). Null when it has none we know. */
export function headingUnit(heading: string): { label: string; unit: string } | null {
  const h = heading.trim();
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(h);
  if (m && m[2] in UNIT_DECIMALS) return { label: m[1], unit: m[2] };
  if (h in UNIT_DECIMALS) return { label: h, unit: h };
  return null;
}

/** The heading as shown with units in the cells: without its bracketed unit (a heading that is only a unit stays). */
export function headingFor(heading: string, place: UnitPlace): string {
  if (place === 'header') return heading;
  const u = headingUnit(heading);
  return u && u.label ? u.label : heading;
}

/** A plain number format with `decimals` places ("0", "0.00"). */
const plain = (decimals: number) => (decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0');

/**
 * The number format for a column of `unit`: plain numbers (place 'header') or with the unit
 * after each (place 'cell'), negative numbers with a true minus sign. `own` is a format the
 * template already gave the column (more decimals for a worked-out value): its number part is
 * kept. A format that isn't a plain number (a date, a currency) is returned as it is.
 */
export function unitColumnFormat(unit: string, place: UnitPlace, own?: string): string {
  let num = plain(UNIT_DECIMALS[unit] ?? 2);
  if (own && own.toLowerCase() !== 'general') {
    if (!/^[0#?.,]+$/.test(own)) return own;
    num = own;
  }
  const lit = place === 'cell' ? `"${TIGHT.has(unit) ? '' : ' '}${unit}"` : '';
  return `${num}${lit};"−"${num}${lit}`;
}

/** The format a cell has of its own (or from its column), if any. */
function ownFormat(sh: Sheet, r: number, c: number): string | undefined {
  return sh.styleAt(r, c)?.numFmt;
}

/**
 * Give the cells under a heading (rows r1 to r2 of column `col`) the format for the heading's
 * unit, keeping the number part of any format they already have. A property column (worked out
 * from a formula down the column) has its own format changed too. Does nothing for a heading
 * without a unit we know.
 */
export function formatUnitColumn(sh: Sheet, heading: string, col: number, r1: number, r2: number, place: UnitPlace): void {
  const u = headingUnit(heading);
  if (!u) return;
  const def = sh.colDefs.get(col);
  if (def) sh.setColDef(col, { ...def, style: { ...def.style, numFmt: unitColumnFormat(u.unit, place, def.style?.numFmt) } });
  // runs of rows with the same format now, each changed in one go
  let start = r1;
  for (let r = r1; r <= r2 + 1; r++) {
    if (r <= r2 && ownFormat(sh, r, col) === ownFormat(sh, start, col)) continue;
    const own = ownFormat(sh, start, col);
    const fmt = unitColumnFormat(u.unit, place, own);
    if (fmt !== own) sh.patchStyle({ r1: start, c1: col, r2: r - 1, c2: col }, { numFmt: fmt });
    start = r;
  }
}

/** The format for a whole column (a table that grows down without end, such as the reagent table), its heading cell keeping its own. */
export function formatUnitWholeColumn(sh: Sheet, heading: string, col: number, place: UnitPlace): void {
  const u = headingUnit(heading);
  if (!u) return;
  const def = sh.colDefs.get(col);
  if (def) { sh.setColDef(col, { ...def, style: { ...def.style, numFmt: unitColumnFormat(u.unit, place, def.style?.numFmt) } }); return; }
  sh.setColStyle(col, { ...sh.colStyles.get(col), numFmt: unitColumnFormat(u.unit, place, sh.colStyles.get(col)?.numFmt) });
}
