// Compound IDs in an SI project (Chem SI Assistant's rules, core/compound_ids.py):
// - each Data section has an ID table: rows 1, 2, 3… are "3a", "3b", "3c"…;
// - a compound's ID is the table's entry at its place in the section, so moving compounds
//   renumbers them;
// - a Manual ID replaces the compound's ID, but the compound still uses up its row, so the
//   compounds after it keep their table IDs;
// - missing IDs, and IDs used twice (in a table, or by two compounds anywhere in the
//   project), are warnings. IDs are compared ignoring capitals and spaces around them.

export type IdPattern = 'letters' | 'numbers';

/** 0 → "a", 25 → "z", 26 → "aa", 701 → "zz", 702 → "aaa". */
export function lettersFor(index: number): string {
  if (index < 0 || !Number.isInteger(index)) throw new RangeError('index must be a whole number ≥ 0');
  let n = index + 1, out = '';
  while (n) {
    const rem = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    out = String.fromCharCode(97 + rem) + out;
  }
  return out;
}

/** "a" → 0, "aa" → 26 (the other way from lettersFor). */
export function indexForLetters(letters: string): number {
  const t = letters.trim().toLowerCase();
  if (!/^[a-z]+$/.test(t)) throw new Error(`Not a letter sequence: “${letters}”`);
  let n = 0;
  for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 96);
  return n - 1;
}

/** IDs for Fill from Pattern: ("3", letters, "a", 3) → 3a, 3b, 3c. */
export function patternIds(prefix: string, style: IdPattern, start: string, count: number): string[] {
  if (count < 0) throw new RangeError('count must be ≥ 0');
  if (style === 'letters') {
    const first = indexForLetters(start || 'a');
    return Array.from({ length: count }, (_, i) => `${prefix}${lettersFor(first + i)}`);
  }
  const s = (start || '1').trim();
  if (!/^-?\d+$/.test(s)) throw new Error(`Not a whole number: “${start}”`);
  const first = Number(s);
  return Array.from({ length: count }, (_, i) => `${prefix}${first + i}`);
}

/** An ID as text (a hand-edited section.json may hold numbers or nulls). */
const idText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** The ID table as text; anything that isn't a list counts as empty. */
export const tableOf = (table: unknown): string[] => (Array.isArray(table) ? table.map(idText) : []);

/** An ID as compared: trimmed, capitals ignored. */
export const normalizeId = (id: unknown): string => idText(id).trim().toLowerCase();

/** The IDs of one section's compounds, in order (null: no ID: the table is too short, or the row is empty). */
export function assignIds(overrides: readonly (string | null | undefined)[], table: unknown): (string | null)[] {
  const t = tableOf(table);
  return overrides.map((o, i) => {
    const own = idText(o).trim();
    if (own) return own;
    const cell = i < t.length ? t[i].trim() : '';
    return cell || null;
  });
}

export interface SectionIds {
  sectionId: string;
  sectionName: string;
  table: unknown;
  /** Internal ids, in order. */
  compoundIds: string[];
  overrides: (string | null | undefined)[];
  compoundNames?: string[];
}

export interface IdReport {
  /** Compound internal id → its ID (null: none). */
  ids: Map<string, string | null>;
  /** Compound internal id → warnings. */
  compoundWarnings: Map<string, string[]>;
  /** "section id:row" → the warning for that ID-table cell. */
  tableWarnings: Map<string, string>;
}

/** A compound's ID as shown: "ID?" when it has none. */
export const displayId = (r: IdReport, compoundId: string): string => r.ids.get(compoundId) || 'ID?';

export const cellKey = (sectionId: string, row: number): string => `${sectionId}:${row}`;

/** The other compounds with an ID: named when one or two, otherwise only counted (a page with many is kept short). */
export function othersText(others: readonly string[]): string {
  return others.length <= 2 ? others.join('; ') : `${others.length} other compounds`;
}

export function checkIds(sections: readonly SectionIds[]): IdReport {
  const report: IdReport = { ids: new Map(), compoundWarnings: new Map(), tableWarnings: new Map() };
  const warn = (cid: string, msg: string): void => {
    const list = report.compoundWarnings.get(cid);
    if (list) list.push(msg); else report.compoundWarnings.set(cid, [msg]);
  };
  // normalized ID → [compound id, where]
  const used = new Map<string, [string, string][]>();
  const tables = sections.map((s) => tableOf(s.table));
  sections.forEach((s, si) => {
    const table = tables[si];
    const assigned = assignIds(s.overrides, table);
    s.compoundIds.forEach((cid, pos) => {
      const id = assigned[pos] ?? null;
      report.ids.set(cid, id);
      if (id === null) {
        const why = pos >= table.length ? `the ID table has no entry for position ${pos + 1}` : `row ${pos + 1} of the ID table is empty`;
        warn(cid, `No ID: ${why} in “${s.sectionName}”. Fill the section's ID table (Fill from Pattern, or type the IDs), or type a Manual ID on this page.`);
      } else {
        const name = s.compoundNames?.[pos] || 'unnamed';
        const k = normalizeId(id);
        const places = used.get(k) ?? [];
        places.push([cid, `${id} (${name}, “${s.sectionName}”)`]);
        used.set(k, places);
      }
    });
    // the same ID twice in the table, even in rows no compound has yet
    const rows = new Map<string, number[]>();
    table.forEach((v, row) => {
      if (!v.trim()) return;
      const k = normalizeId(v);
      rows.set(k, [...(rows.get(k) ?? []), row]);
    });
    for (const list of rows.values()) {
      if (list.length < 2) continue;
      for (const row of list) {
        const others = list.filter((r) => r !== row).map((r) => r + 1).join(', ');
        report.tableWarnings.set(cellKey(s.sectionId, row), `Duplicate: “${table[row].trim()}” is also in row(s) ${others}.`);
      }
    }
  });
  // one ID on two compounds anywhere in the project
  for (const places of used.values()) {
    if (places.length < 2) continue;
    for (const [cid] of places) warn(cid, `Duplicate ID “${report.ids.get(cid)}”: also used by ${othersText(places.filter(([c]) => c !== cid).map(([, w]) => w))}.`);
  }
  // table cells that clash with another section's compound or a Manual ID
  sections.forEach((s, si) => {
    tables[si].forEach((v, row) => {
      const k = normalizeId(v);
      if (!k || report.tableWarnings.has(cellKey(s.sectionId, row))) return;
      const clashes = (used.get(k) ?? []).filter(([cid]) => !(row < s.compoundIds.length && s.compoundIds[row] === cid)).map(([, w]) => w);
      if (clashes.length) report.tableWarnings.set(cellKey(s.sectionId, row), `“${v.trim()}” is already used by ${othersText(clashes)}.`);
    });
  });
  return report;
}
