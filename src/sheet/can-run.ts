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
export type SheetCheck = keyof typeof SHEET_REASONS | 'data-table' | 'remove-embedded-objects';
/** The commands that have a check (the others answer undefined). */
export const CAN_RUN_CHECKS: ReadonlySet<string> = new Set<string>([...Object.keys(SHEET_REASONS), 'data-table', 'remove-embedded-objects']);

/**
 * Is there a table where the selection is (what Sort and Remove Duplicates work on)? True for a
 * filtered range, a selection of more than one cell, or a cell that has a value or a filled
 * neighbor (the current region then has more than the one cell). Looks at nine cells at most.
 */
export function tableHere(s: Sheet, sel: SheetSelection): boolean {
  const { r, c } = sel.active;
  const R = sel.range;
  if (s.filter && inRange({ ...s.filter.range, r2: s.filterRows()!.r2 }, r, c)) return true;
  if (R.r1 !== R.r2 || R.c1 !== R.c2) return true;
  if (s.values.has(keyOf(r, c))) return true;
  for (let rr = r - 1; rr <= r + 1; rr++) for (let cc = c - 1; cc <= c + 1; cc++) {
    if ((rr === r && cc === c) || rr < 0 || cc < 0) continue;
    if (s.values.has(keyOf(rr, cc)) || s.cell(rr, cc)?.structure) return true;
  }
  return false;
}

/**
 * Does text read as SMILES: only atoms SMILES can write without brackets (B C N O P S F Cl Br I,
 * and aromatic b c n o p s), atoms in brackets, bonds, branches and ring numbers, with the
 * branches and rings closed (Weininger, J. Chem. Inf. Comput. Sci. 1988, 28, 31; OpenSMILES)?
 * Aromatic atoms (lower case) only ever stand in rings, so text with one and no ring number
 * (Boc, Co, Cs, Sn, Pb) isn't SMILES. So CCO, c1ccccc1 and *CC do, and names such as Aspirin,
 * Ethanol, THF, DCM or Pd don't. (Short capital abbreviations made of atom letters, NBS or PCC,
 * can't be told from SMILES here: see looksLikeSmilesColumn.)
 */
export function readsAsSmiles(text: string): boolean {
  let depth = 0, atoms = 0, aromatic = false, ringNumbers = false;
  const rings = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') {
      const end = text.indexOf(']', i + 1);
      // [13CH4], [Na+], [nH]: an element (maybe after an isotope number) inside
      if (end < 0 || !/^\d*(?:[A-Z][a-z]?|[bcnops]|se|as)/.test(text.slice(i + 1, end))) return false;
      atoms++;
      i = end;
    } else if ((ch === 'C' && text[i + 1] === 'l') || (ch === 'B' && text[i + 1] === 'r')) { atoms++; i++; }
    else if ('BCNOPSFI*'.includes(ch)) atoms++;
    else if ('bcnops'.includes(ch)) { atoms++; aromatic = true; }
    else if (ch === '(') depth++;
    else if (ch === ')') { if (--depth < 0) return false; }
    else if (ch >= '0' && ch <= '9') { ringNumbers = true; if (!rings.delete(ch)) rings.add(ch); }
    else if (ch === '%' && /^\d\d$/.test(text.slice(i + 1, i + 3))) { ringNumbers = true; const n = text.slice(i, i + 3); if (!rings.delete(n)) rings.add(n); i += 2; }
    else if (!'-=#$:/\\.'.includes(ch)) return false;
  }
  return atoms > 0 && depth === 0 && rings.size === 0 && (!aromatic || ringNumbers);
}

/**
 * Does a column's text read as SMILES: two cells or more that do, at least one of them with
 * something only SMILES has (a bond, branch, ring number, bracket or aromatic atom) or longer
 * than an abbreviation (so NBS, NCS and PCC in a reagent column don't count).
 */
function looksLikeSmilesColumn(texts: string[]): boolean {
  const smiles = texts.filter((t) => t.length > 1 && readsAsSmiles(t));
  return smiles.length > 1 && smiles.some((t) => t.length > 3 || /[-=#$:/\\.()[\]%0-9bcnops*]/.test(t));
}

/** Columns holding structures or SMILES in a table (the first 200 rows of each column are looked at). */
export function structureColumns(s: Sheet, R: Range): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  for (let c = R.c1; c <= R.c2; c++) {
    let structures = 0;
    const texts: string[] = [];
    for (let r = R.r1; r <= Math.min(R.r2, R.r1 + 200); r++) {
      if (s.cell(r, c)?.structure) structures++;
      else {
        const v = s.values.get(keyOf(r, c));
        if (typeof v === 'string') texts.push(v);
      }
    }
    if (structures || looksLikeSmilesColumn(texts)) {
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
    if (s.dashboard && cmd !== 'remove-embedded-objects') return null;
    switch (cmd as SheetCheck) {
      case 'remove-duplicates': case 'custom-sort': return tableHere(s, sel) ? null : SHEET_REASONS[cmd as 'custom-sort'];
      case 'text-to-columns': { const R = s.clip(sel.range) ?? sel.range; return R.c1 === R.c2 ? null : SHEET_REASONS['text-to-columns']; }
      // the sheet's own answer: off on a sheet with no objects kept from Excel (review F2b-R04)
      case 'remove-embedded-objects': return s.removeOleBlocked;
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
