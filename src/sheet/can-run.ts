// Why a Spreadsheet command cannot run where the selection is (S15, S85; retrospective audit G5-28),
// cheap enough to ask on every move of the selection however big the sheet: the table checks look
// only at the cells around the active one, and the one that needs the whole table (Properties…)
// is worked out only when asked for in full (a menu opening, the pointer resting on the button),
// and kept until the sheet or the selection changes.

import type { Sheet } from './workbook';
import { keyOf, inRange, colName, type Range } from './refs';
import { dataTableRef } from './what-if';

export interface SheetSelection { active: { r: number; c: number }; range: Range }

export const SHEET_REASONS = {
  'remove-duplicates': 'Click in a table (or select it) to remove its duplicate rows.',
  'custom-sort': 'Click in a table (or select its rows) to sort it.',
  'text-to-columns': 'Select one column of text to split (Text to Columns works on one column at a time).',
  'property-column': 'Click in a table with a column of structures (or SMILES) first. To start one, draw a structure in a cell (Chemistry ▸ Structure).',
} as const;
export type SheetCheck = keyof typeof SHEET_REASONS | 'data-table';
/** The commands that have a check (the others answer undefined). */
export const CAN_RUN_CHECKS: ReadonlySet<string> = new Set<string>([...Object.keys(SHEET_REASONS), 'data-table']);

/**
 * Is there a table where the selection is (what Sort and Remove Duplicates work on)? True for a
 * filtered range, a selection of more than one cell, or a cell that has a value or a filled
 * neighbor (the current region then has more than the one cell). Looks at nine cells at most.
 */
export function tableHere(s: Sheet, sel: SheetSelection): boolean {
  const { r, c } = sel.active;
  const R = sel.range;
  if (s.filter && inRange({ ...s.filter.range, r2: Math.max(s.filter.range.r2, s.lastDataRow) }, r, c)) return true;
  if (R.r1 !== R.r2 || R.c1 !== R.c2) return true;
  if (s.values.has(keyOf(r, c))) return true;
  for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
    if ((rr === r && cc === c) || rr < 0 || cc < 0) continue;
    if (s.values.has(keyOf(rr, cc)) || s.cell(rr, cc)?.structure) return true;
  }
  return false;
}

/** Columns holding structures or SMILES in a table (the first 200 rows of each column are looked at). */
export function structureColumns(s: Sheet, R: Range): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  for (let c = R.c1; c <= R.c2; c++) {
    let structures = 0, smiles = 0;
    for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 200); r++) {
      if (s.cell(r, c)?.structure) structures++;
      else {
        const v = s.values.get(keyOf(r, c));
        if (typeof v === 'string' && /^[A-Za-z0-9@+\-[\]()=#$%/\\.:*~]+$/.test(v) && /[a-z]|[A-Z].*[A-Z0-9(=]/.test(v) && v.length > 1) smiles++;
      }
    }
    if (structures || smiles > 1) {
      const head = s.values.get(keyOf(R.r1, c));
      out.push({ col: c, label: `Column ${colName(c)}${typeof head === 'string' && head ? ` (${head})` : ''}${structures ? '' : ' — SMILES'}` });
    }
  }
  return out;
}

/** The answers that need the whole table, kept per sheet, change count and active cell. */
export class SheetCanRun {
  private kept = new WeakMap<Sheet, { key: string; why: string | null }>();
  /** How often a whole table was looked at (for the tests). */
  worked = 0;

  /**
   * Why `cmd` cannot run (null: it can; undefined: no check). `edits` counts the workbook's
   * changes. With `lazy`, an answer that needs the whole table is given only when already known;
   * otherwise the command shows as available, and running it says why not if it cannot.
   */
  why(s: Sheet, sel: SheetSelection, cmd: string, edits: number, lazy = false): string | null | undefined {
    if (!CAN_RUN_CHECKS.has(cmd)) return undefined;
    if (s.dashboard) return null;
    switch (cmd as SheetCheck) {
      case 'remove-duplicates': case 'custom-sort': return tableHere(s, sel) ? null : SHEET_REASONS[cmd as 'custom-sort'];
      case 'text-to-columns': { const R = s.clip(sel.range) ?? sel.range; return R.c1 === R.c2 ? null : SHEET_REASONS['text-to-columns']; }
      case 'data-table': { const ref = dataTableRef(sel.range); return typeof ref === 'string' ? ref : null; }
      case 'property-column': {
        const key = `${edits}:${sel.active.r}:${sel.active.c}`;
        const had = this.kept.get(s);
        if (had?.key === key) return had.why;
        if (lazy) return null;
        // (an empty cell with nothing around it is no table: no need to look further)
        const why = tableHere(s, sel) && structureColumns(s, s.currentRegion(sel.active.r, sel.active.c)).length ? null : SHEET_REASONS['property-column'];
        this.worked++;
        this.kept.set(s, { key, why });
        return why;
      }
    }
  }
}
