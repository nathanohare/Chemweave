// The dashboards of an SI project, as Chem SI Assistant has them (its core/dashboard.py, SPEC
// §6.3.4, §13d, §13k.3): a Data section's grid, one row per compound and one column per field,
// and the project's, with its progress by section, the required data still missing and the
// warnings by kind. Each cell has a state, shown with an icon and a color, and a short summary:
//
//   filled ✔ · empty ○ · missing ✖ (empty but required) · not used — (the compound has no such field)
//   plus ⚑ flagged by a person and ⚠ a warning of the automatic checks
//
// The view choices are kept where SI Assistant keeps them, so both programs show the same:
// section.json "dashboard" {columns, filter, compact, split_nuclei}; project.json
// "project_dashboard" (the same, for the project's grid) and "status_colors" (the colors that
// differ from the standard ones).

import { compoundName, compoundsOf, defaultFieldsOf, fieldsOf, flagsOf, valuesOf, type Json, type SiCompound, type SiProject, type SiSection } from './project';
import { CORE_FIELDS, LIBRARY_FIELDS, NUCLEI, SPECTRUM_TYPES, DEFAULT_NMR_NUCLEI, fieldDef, nucleusLabel, partText, requiredParts, type FieldDef, type FieldEntry } from './fields';
import { parseMarkup } from './markup';

export type CellState = 'filled' | 'empty' | 'missing' | 'not_used';
export type Status = CellState | 'flagged' | 'warning';
export const STATE_ICONS: Record<CellState, string> = { filled: '✔', empty: '○', missing: '✖', not_used: '—' };
export const STATE_LABELS: Record<CellState, string> = { filled: 'Filled', empty: 'Empty', missing: 'Empty but required', not_used: 'Field not used for this compound' };
export const STATUS_KEYS: readonly Status[] = ['filled', 'empty', 'missing', 'flagged', 'warning', 'not_used'];
export const STATUS_NAMES: Record<Status, string> = {
  filled: 'Filled', empty: 'Empty (not required)', missing: 'Missing (required but empty)',
  flagged: 'Flagged by a person', warning: 'Has a warning', not_used: 'Field not used for this compound',
};
export const DEFAULT_STATUS_COLORS: Record<Status, string> = { filled: '#27ae60', empty: '', missing: '#e74c3c', flagged: '#e67e22', warning: '#f1c40f', not_used: '#7f7f7f' };
/** How strongly each status tints its cell (of 255), so the text stays readable in light and dark. */
export const CELL_ALPHA: Record<Status, number> = { filled: 60, empty: 60, missing: 95, flagged: 120, warning: 110, not_used: 45 };
export const FILTERS = { all: 'All compounds', incomplete: 'Incomplete only', flagged: 'Flagged only', warnings: 'With warnings only' } as const;
export type Filter = keyof typeof FILTERS;

const FIXED_KEYS = ['structure', 'name'];
const HIDDEN_KEYS = ['notes'];
const SPLIT_FIELDS = ['nmr', 'spectra'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Plain names of the checks (checks.ts), in the order they are listed. */
export const CHECK_LABELS: Record<string, string> = {
  id: 'Compound IDs', structure: 'Generic atoms in structures', hrms: 'HRMS', c13: '¹³C signal count',
  h1: '¹H integration', impurity: 'Solvent or impurity peaks', coupling: 'Large J values',
  yield: 'Yield vs mass', spectra: 'Spectra vs NMR reports', frequency: 'NMR frequencies',
  heteroatom: 'Missing heteroatom NMR', gp: 'General procedures', mention: 'Deleted mentions',
  citation: 'Missing references', reference: 'References that can’t be printed as typed', label: 'Duplicate labels',
  object: 'Missing figure or table files', gp_name: 'Duplicate procedure names', xray: 'X-ray structures that can’t be drawn',
};

// ---------------------------------------------------------------- colors

/** Every status's color ('#rrggbb', or '' for none): the project's own where it has a usable one, else the standard one. */
export function statusColors(settings: Json): Record<Status, string> {
  const stored = isObj(settings.status_colors) ? settings.status_colors : {};
  const out = { ...DEFAULT_STATUS_COLORS };
  for (const k of STATUS_KEYS) {
    const v = stored[k];
    if (typeof v === 'string' && (v === '' || HEX.test(v))) out[k] = v.toLowerCase();
  }
  return out;
}

/** Keep only the colors that differ from the standard ones (none: no key at all). */
export function storeStatusColors(settings: Json, colors: Partial<Record<Status, string>>): void {
  const own: Json = {};
  for (const k of STATUS_KEYS) {
    const v = colors[k];
    if (typeof v !== 'string' || !(v === '' || HEX.test(v))) continue;
    if (v.toLowerCase() !== DEFAULT_STATUS_COLORS[k]) own[k] = v.toLowerCase();
  }
  if (Object.keys(own).length) settings.status_colors = own; else delete settings.status_colors;
}

// ---------------------------------------------------------------- what a dashboard covers

/** A Data section, or the whole project (every Data section at once). */
export interface Scope {
  compounds: SiCompound[];
  /** The fields new compounds get, in order (a section's; the project's: every section's). */
  defaultFields: FieldEntry[];
  /** The view choices (section.json "dashboard", or project.json "project_dashboard"). */
  view: Json;
}

const viewOf = (v: unknown): Json => (isObj(v) ? v : {});

export function sectionScope(s: SiSection): Scope {
  return { compounds: compoundsOf(s), defaultFields: defaultFieldsOf(s), view: viewOf(s.data.dashboard) };
}

export function projectScope(p: SiProject): Scope {
  const seen = new Set<string>();
  const defaults: FieldEntry[] = [];
  for (const s of p.dataSections) for (const e of defaultFieldsOf(s)) if (!seen.has(e.key)) { seen.add(e.key); defaults.push(e); }
  return { compounds: p.compounds, defaultFields: defaults, view: viewOf(p.settings.project_dashboard) };
}

/** Every field key the defaults or any compound use, in a sensible order: defaults, then the library's order, then fields of one's own. */
export function availableColumns(scope: Scope): string[] {
  const keys: string[] = [];
  for (const e of scope.defaultFields) if (!keys.includes(e.key)) keys.push(e.key);
  const used = new Set(scope.compounds.flatMap((c) => fieldsOf(c).map((e) => e.key)));
  for (const d of [...CORE_FIELDS, ...LIBRARY_FIELDS]) if (used.has(d.key) && !keys.includes(d.key)) keys.push(d.key);
  keys.push(...[...used].filter((k) => !keys.includes(k)).sort());
  return keys.filter((k) => !FIXED_KEYS.includes(k) && !HIDDEN_KEYS.includes(k));
}

export const isSplit = (scope: Scope): boolean => !!scope.view.split_nuclei;
export const isCompact = (scope: Scope): boolean => !!scope.view.compact;
export function filterOf(scope: Scope): Filter { const f = scope.view.filter; return typeof f === 'string' && f in FILTERS ? (f as Filter) : 'all'; }

/** An NMR report's or a spectrum's own entries ([] for a hand-edited value that is not a list). */
function items(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObj) : [];
}

const nucleusOrder = (n: string): [number, string] => [(NUCLEI as readonly string[]).indexOf(n) >= 0 ? (NUCLEI as readonly string[]).indexOf(n) : NUCLEI.length, n];
const byOrder = (f: (x: string) => [number, string]) => (a: string, b: string): number => { const [x, y] = [f(a), f(b)]; return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0); };

export function nmrNuclei(scope: Scope): string[] {
  const found = new Set<string>(DEFAULT_NMR_NUCLEI);
  for (const c of scope.compounds) for (const r of items(valuesOf(c).nmr)) { const n = partText(r.nucleus); if (n) found.add(n); }
  return [...found].sort(byOrder(nucleusOrder));
}

export function spectrumTypes(scope: Scope): string[] {
  const order = SPECTRUM_TYPES as readonly string[];
  const found = new Set(nmrNuclei(scope).filter((n) => order.includes(n)));
  for (const c of scope.compounds) for (const i of items(valuesOf(c).spectra)) { const t = partText(i.type); if (t) found.add(t); }
  return [...found].sort(byOrder((t) => [order.includes(t) ? order.indexOf(t) : order.length, t]));
}

function splitKeys(scope: Scope, key: string): string[] {
  if (key === 'nmr') return nmrNuclei(scope).map((n) => `nmr:${n}`);
  if (key === 'spectra') return spectrumTypes(scope).map((t) => `spectra:${t}`);
  return [key];
}

/** The fields chosen with Columns (NMR and spectra count as one each). */
export function chosenColumns(scope: Scope): string[] {
  const available = availableColumns(scope);
  const saved = scope.view.columns;
  if (!Array.isArray(saved)) return available;
  return saved.filter((k): k is string => typeof k === 'string' && available.includes(k));
}

/** The grid's field columns (NMR and spectra one per nucleus when split). */
export function shownColumns(scope: Scope): string[] {
  const keys = chosenColumns(scope);
  return isSplit(scope) ? keys.flatMap((k) => splitKeys(scope, k)) : keys;
}

/**
 * The grid's own columns besides the fields: the structure, the section (the project's grid)
 * and how many required fields are done. Hidden ones are kept in the view as "hidden_columns"
 * (Chemweave's: SI Assistant shows them all). ID and Name are always shown.
 */
export const FIXED_COLUMNS = { structure: 'Structure', section: 'Section', done: 'Done' } as const;
export type FixedColumn = keyof typeof FIXED_COLUMNS;
export function hiddenFixed(scope: Scope): Set<FixedColumn> {
  const h = scope.view.hidden_columns;
  return new Set(Array.isArray(h) ? h.filter((k): k is FixedColumn => typeof k === 'string' && k in FIXED_COLUMNS) : []);
}

/** Each column's width in pixels as set by dragging its border (Chemweave's "widths": SI Assistant sizes its own). */
export function columnWidths(scope: Scope): Record<string, number> {
  const w = scope.view.widths;
  if (!isObj(w)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) if (typeof v === 'number' && Number.isFinite(v) && v >= 24) out[k] = Math.min(1200, Math.round(v));
  return out;
}

/** The fields chosen, with `key` moved to just before `before` (null: to the end). Keys are the fields' own (NMR and spectra count as one each). */
export function movedColumns(scope: Scope, key: string, before: string | null): string[] {
  const keys = chosenColumns(scope).filter((k) => k !== key);
  if (!chosenColumns(scope).includes(key)) return chosenColumns(scope);
  const at = before === null ? -1 : keys.indexOf(before);
  keys.splice(at < 0 ? keys.length : at, 0, key);
  return keys;
}

export function fieldLabel(scope: Scope, key: string): string {
  if (key.includes(':')) {
    const [base, sub] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    return base === 'nmr' ? `${nucleusLabel(sub)} NMR` : `${nucleusLabel(sub)} spectrum`;
  }
  const entry = scope.defaultFields.find((e) => e.key === key) ?? scope.compounds.flatMap((c) => fieldsOf(c)).find((e) => e.key === key) ?? { key };
  return fieldDef(entry)?.label ?? key;
}

// ---------------------------------------------------------------- cells and rows

export interface Cell {
  state: CellState;
  summary: string;
  flag: Json | null;
  warnings: string[];
}

export interface Row {
  compound: SiCompound;
  id: string;
  name: string;
  /** Warnings about its ID (and its structure's), shown on the ID cell. */
  idWarnings: string[];
  filled: number;
  total: number;
  missing: string[];
  cells: Map<string, Cell>;
  /** Its active warnings by check. */
  checks: Map<string, number>;
  flags: number;
  warnings: number;
}

/** A cell's color: a warning wins over a flag, which wins over the cell's own state. */
export const cellStatus = (c: Cell): Status => (c.warnings.length ? 'warning' : c.flag ? 'flagged' : c.state);

export function cellIcons(c: Cell): string {
  return STATE_ICONS[c.state] + (c.flag ? ' ⚑' : '') + (c.warnings.length ? ' ⚠' : '');
}

export function cellTip(c: Cell): string {
  const lines = [STATE_LABELS[c.state]];
  if (c.flag) lines.push(`⚑ Flagged: ${partText(c.flag.comment) || '(no comment)'}${partText(c.flag.by) ? ` (${partText(c.flag.by)})` : ''}`);
  for (const w of c.warnings) lines.push(`⚠ ${w}`);
  return lines.join('\n');
}

/** What the dashboard needs from the rest of the SI tab. */
export interface DashboardFacts {
  /** A compound's ID as shown ("2a", "ID?"). */
  idOf(c: SiCompound): string;
  /** Its active (not dismissed) warnings. */
  warnings(c: SiCompound): { check: string; field: string; message: string }[];
  /** How a mention or citation shows in text. */
  label(ref: string): string;
  /** The formula of its structure ('' when not known yet); `generic` lists its generic atoms (R, X). */
  formula(c: SiCompound): { formula: string; generic: string[] } | null;
  /** The HRMS found value's error, in ppm (null when there is none). */
  hrmsPpm(c: SiCompound): number | null;
}

const shorten = (t: string, n: number): string => { const s = t.trim().replace(/\s+/g, ' '); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; };

function plainText(text: string, f: DashboardFacts, n = 40): string {
  return shorten(parseMarkup(text).map((p) => p.runs.map((r) => (r.ref ? f.label(r.ref) : r.text)).join('')).join(' '), n);
}

/** A cell's short summary ("92% · 28.4 mg", "¹H ¹³C (empty: ¹⁹F)", "155.0701 (Δ −1.3 ppm)"). */
export function fieldSummary(p: SiProject, c: SiCompound, def: FieldDef, f: DashboardFacts): string {
  const value = valuesOf(c)[def.key];
  if (def.key === 'procedure') {
    const own = plainText(p.compoundText(c, def.key), f, 200);
    const gp = p.compoundGp(c);
    const gpName = gp ? partText(gp.name) : '';
    return shorten(gpName && own ? `${gpName} · ${own}` : gpName || own, 40);
  }
  if (def.kind === 'richtext') return plainText(p.compoundText(c, def.key), f);
  if (def.kind === 'citations') {
    const refs = isObj(value) && Array.isArray(value.refs) ? value.refs : [];
    return refs.length ? `${refs.length} reference${refs.length === 1 ? '' : 's'}` : '';
  }
  if (def.kind === 'structure') {
    const got = f.formula(c);
    if (!got) return '';
    return got.formula || (got.generic.length ? `no formula (${got.generic.join(', ')})` : '');
  }
  if (def.kind === 'nmr') {
    const reports = items(value);
    const done = reports.filter((r) => partText(r.text).trim()).map((r) => nucleusLabel(partText(r.nucleus)));
    const todo = reports.filter((r) => !partText(r.text).trim()).map((r) => nucleusLabel(partText(r.nucleus)));
    return (done.join(' ') + (todo.length ? ` (empty: ${todo.join(' ')})` : '')).trim();
  }
  if (def.kind === 'private') { const n = items(value).length || (Array.isArray(value) ? value.length : 0); return n ? `${n} item${n === 1 ? '' : 's'}` : ''; }
  if (def.kind === 'attachments') {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) return '';
    if (def.key === 'spectra') return items(list).map((i) => nucleusLabel(partText(i.type))).join(', ');
    return `${list.length} file${list.length === 1 ? '' : 's'}`;
  }
  if (def.kind === 'parts') {
    const v = isObj(value) ? value : {};
    if (def.key === 'hrms') {
      const found = partText(v.found).trim();
      if (!found) return '';
      const ppm = f.hrmsPpm(c);
      return ppm === null ? found : `${found} (Δ ${ppm >= 0 ? '+' : '−'}${Math.abs(ppm).toFixed(1)} ppm)`;
    }
    const need = requiredParts(def);
    const pieces: string[] = [];
    let before = false; // (a unit goes with the value just before it, and only when that one is there)
    for (const part of def.parts ?? []) {
      const t = partText(v[part.key]).trim();
      if (part.key.endsWith('unit')) { if (before && t) pieces[pieces.length - 1] += ` ${t}`; before = false; continue; }
      before = false;
      if (!t || (part.default && t === part.default && !need.includes(part.key))) continue;
      before = true;
      pieces.push(t + (part.suffix === '%' || part.suffix === '°C' ? part.suffix : part.suffix ? ` ${part.suffix}` : ''));
    }
    return pieces.join(' · ').replace(/\s+/g, ' ');
  }
  return '';
}

/** The rows of a dashboard: every compound of the scope, with a cell for every field. */
export function buildRows(p: SiProject, scope: Scope, f: DashboardFacts): Row[] {
  const columns = [...availableColumns(scope), ...FIXED_KEYS];
  const split = SPLIT_FIELDS.flatMap((k) => splitKeys(scope, k));
  const requiredOf = new Map<string, Set<string>>();
  return scope.compounds.map((c) => {
    let required = requiredOf.get(c.sectionId);
    if (!required) {
      required = new Set(defaultFieldsOf(p.section(c.sectionId)).filter((e) => e.required).map((e) => e.key));
      requiredOf.set(c.sectionId, required);
    }
    const active = f.warnings(c);
    const byField = new Map<string, string[]>();
    for (const w of active) byField.set(w.field, [...(byField.get(w.field) ?? []), w.message]);
    const defs = new Map(fieldsOf(c).map((e) => fieldDef(e)).filter((d): d is FieldDef => !!d).map((d) => [d.key, d]));
    const flags = flagsOf(c);
    // (with the flags left in the Live Preview on a field: the first one shows when SI Assistant's has none)
    const byPlace = p.openFlagsByPlace();
    const flagOf = (key: string): Json | null => {
      if (isObj(flags[key])) return flags[key];
      const x = (byPlace.get(`${c.id}/${key}`) ?? []).find((e) => e.isFlag);
      return x ? { comment: x.flag.comment, by: x.flag.by, at: x.flag.at } : null;
    };
    const cells = new Map<string, Cell>();
    for (const key of columns) {
      const def = defs.get(key);
      if (!def) { cells.set(key, { state: 'not_used', summary: '', flag: null, warnings: [] }); continue; }
      const state: CellState = p.fieldFilled(c, def) ? 'filled' : required.has(key) ? 'missing' : 'empty';
      cells.set(key, { state, summary: fieldSummary(p, c, def, f), flag: flagOf(key), warnings: byField.get(key) ?? [] });
    }
    for (const key of split) cells.set(key, splitCell(c, key, defs, required, cells));
    const k = p.completion(c);
    const checks = new Map<string, number>();
    for (const w of active) checks.set(w.check, (checks.get(w.check) ?? 0) + 1);
    const structureWarnings = cells.get('structure')?.warnings ?? [];
    return {
      compound: c, id: f.idOf(c), name: compoundName(c), idWarnings: [...(byField.get('id') ?? []), ...structureWarnings],
      filled: k.filled, total: k.total, missing: k.missing, cells, checks,
      flags: Object.keys(flags).length + [...byPlace].filter(([k]) => k.startsWith(`${c.id}/`)).reduce((n, [, v]) => n + v.filter((x) => x.isFlag && !x.anchor.startsWith('c:')).length, 0), warnings: active.length,
    };
  });
}

function splitCell(c: SiCompound, key: string, defs: Map<string, FieldDef>, required: Set<string>, cells: Map<string, Cell>): Cell {
  const base = key.slice(0, key.indexOf(':')), sub = key.slice(key.indexOf(':') + 1);
  const parent = cells.get(base);
  if (!defs.has(base) || !parent) return { state: 'not_used', summary: '', flag: null, warnings: [] };
  const { flag, warnings } = parent;
  const reports = defs.has('nmr') ? items(valuesOf(c).nmr).filter((r) => partText(r.nucleus) === sub) : [];
  if (base === 'nmr') {
    if (!reports.length) return { state: 'not_used', summary: '', flag, warnings };
    const done = reports.filter((r) => partText(r.text).trim());
    if (done.length) {
      const labels = done.map((r) => partText(r.label)).filter(Boolean);
      return { state: 'filled', summary: labels.length ? labels.join(', ') : done.length > 1 ? `${done.length} reports` : '', flag, warnings };
    }
    return { state: required.has('nmr') ? 'missing' : 'empty', summary: '', flag, warnings };
  }
  const files = items(valuesOf(c).spectra).filter((i) => partText(i.type) === sub);
  if (files.length) return { state: 'filled', summary: files.length > 1 ? `${files.length} files` : '', flag, warnings };
  // (an NMR report for this nucleus: a spectrum is expected)
  if (reports.length) return { state: required.has('spectra') ? 'missing' : 'empty', summary: '', flag, warnings };
  return { state: 'not_used', summary: '', flag, warnings };
}

export function filterRows(rows: Row[], mode: Filter): Row[] {
  if (mode === 'incomplete') return rows.filter((r) => r.missing.length);
  if (mode === 'flagged') return rows.filter((r) => r.flags);
  if (mode === 'warnings') return rows.filter((r) => r.warnings);
  return rows;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "18 / 24 compounds complete · 5 flags · 7 warnings" */
export function summaryText(rows: Row[]): string {
  const complete = rows.filter((r) => !r.missing.length).length;
  return `${complete} / ${rows.length} compounds complete · ${plural(rows.reduce((n, r) => n + r.flags, 0), 'flag')} · ${plural(rows.reduce((n, r) => n + r.warnings, 0), 'warning')}`;
}

// ---------------------------------------------------------------- the project's progress

/** A progress percentage rounded down, so 100% shows only when nothing is left (0 of 0 is 100%). */
export function percent(done: number, total: number): number {
  return total <= 0 ? 100 : Math.min(100, Math.max(0, Math.floor((100 * done) / total)));
}

export interface SectionProgress { section: SiSection; path: string; compounds: number; complete: number; filled: number; required: number }

export interface ProjectSummary {
  sections: SectionProgress[];
  compounds: number;
  complete: number;
  filled: number;
  required: number;
  /** Required data still missing, by field (NMR and spectra by nucleus: "¹³C NMR"), in the order of the sections' fields: how many compounds miss each. */
  missing: [string, number][];
  /** Active warnings by check (plain names), in the order of CHECK_LABELS. */
  warnings: [string, number][];
  flags: number;
}

/**
 * The required data a compound is missing, by field, as SI Assistant counts it. NMR and spectra
 * are counted per nucleus ("¹³C NMR", "¹³C spectrum": a report left empty, or a report with no
 * spectrum), so they are listed for a compound whose NMR field as a whole counts as filled.
 */
export function missingFields(s: SiSection, row: Row): string[] {
  const scope = sectionScope(s);
  const out: string[] = [];
  for (const key of defaultFieldsOf(s).filter((e) => e.required).map((e) => e.key)) {
    const cell = row.cells.get(key);
    if (!cell || cell.state === 'not_used') continue;
    const subs = SPLIT_FIELDS.includes(key) ? [...row.cells].filter(([k, c]) => k.startsWith(key + ':') && c.state === 'missing').map(([k]) => k) : [];
    if (subs.length) out.push(...subs.map((k) => fieldLabel(scope, k)));
    else if (cell.state === 'missing') out.push(fieldLabel(scope, key));
  }
  return out;
}

/**
 * The project at a glance: progress overall and by Data section, what is missing and the warnings
 * by kind. `projectWarnings` (project-warnings.ts) are counted with the compounds' warnings.
 */
export function summarize(p: SiProject, rowsBySection: [SiSection, Row[]][], projectWarnings: readonly { check: string }[] = []): ProjectSummary {
  const sections: SectionProgress[] = [];
  const missing = new Map<string, number>();
  const checks = new Map<string, number>();
  let flags = 0;
  for (const [s, rows] of rowsBySection) {
    sections.push({
      section: s, path: sectionPath(p, s), compounds: rows.length,
      complete: rows.filter((r) => !r.missing.length).length,
      filled: rows.reduce((n, r) => n + r.filled, 0), required: rows.reduce((n, r) => n + r.total, 0),
    });
    for (const r of rows) {
      for (const m of missingFields(s, r)) missing.set(m, (missing.get(m) ?? 0) + 1);
      for (const [k, n] of r.checks) checks.set(k, (checks.get(k) ?? 0) + n);
      flags += r.flags;
    }
  }
  for (const w of projectWarnings) checks.set(w.check, (checks.get(w.check) ?? 0) + 1);
  // Fields in the order they come in the sections' defaults (so a list keeps its order as it shrinks).
  // (each label's first place in the list; one not there goes after as many places as labels: SI Assistant's order)
  const rank = new Map<string, number>();
  let i = 0;
  for (const [s] of rowsBySection) {
    const scope = sectionScope(s);
    for (const e of defaultFieldsOf(s)) for (const k of [e.key, ...(SPLIT_FIELDS.includes(e.key) ? splitKeys(scope, e.key) : [])]) {
      const label = fieldLabel(scope, k);
      if (!rank.has(label)) rank.set(label, i);
      i++;
    }
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const known = Object.keys(CHECK_LABELS);
  const place = (k: string): number => (known.includes(k) ? known.indexOf(k) : known.length);
  const warnings = [...checks].filter(([, n]) => n > 0).sort((a, b) => place(a[0]) - place(b[0]) || cmp(a[0], b[0])).map(([k, n]): [string, number] => [CHECK_LABELS[k] ?? k, n]);
  const at = (label: string): number => rank.get(label) ?? rank.size;
  return {
    sections, compounds: sections.reduce((n, s) => n + s.compounds, 0), complete: sections.reduce((n, s) => n + s.complete, 0),
    filled: sections.reduce((n, s) => n + s.filled, 0), required: sections.reduce((n, s) => n + s.required, 0),
    missing: [...missing].sort((a, b) => at(a[0]) - at(b[0]) || cmp(a[0], b[0])), warnings, flags,
  };
}

/** A section's name with the sections it is inside ("Synthesis › Ketones"). */
export function sectionPath(p: SiProject, s: SiSection): string {
  const names: string[] = [s.name];
  let parent = s.parentId;
  for (let n = 0; parent && n < 10; n++) {
    const up = p.sections.find((x) => x.id === parent);
    if (!up) break;
    names.unshift(up.name);
    parent = up.parentId;
  }
  return names.join(' › ');
}

/** Change a view choice of a section's (or the project's) dashboard. */
export function setView(holder: Json, key: string, value: unknown, viewKey = 'dashboard'): void {
  const v = isObj(holder[viewKey]) ? (holder[viewKey] as Json) : (holder[viewKey] = {});
  v[key] = value;
}
