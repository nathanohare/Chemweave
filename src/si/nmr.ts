// Reading NMR peak reports (as pasted from MestReNova) for the checks, the ways a report writes
// its solvent, and the solvent and impurity peaks a reported peak may be. The same rules as Chem
// SI Assistant (core/nmr_parse.py, solvents.py, impurities.py), so both give the same warnings.
//
//   "1H NMR (400 MHz, CDCl3) δ 7.36 – 7.29 (m, 5H), 6.52 (d, J = 7.9 Hz, 1H), 2.08 (s, 3H)"
//   "13C NMR (101 MHz, CDCl3) δ 171.2, 138.6, 128.9 (2C), 162.3 (d, J = 247 Hz)"
//
// Best-effort readings: anything unexpected is simply not counted, and the checks that use
// them say they are approximate.
//
// Solvent and impurity shifts: G. R. Fulmer et al., "NMR Chemical Shifts of Trace Impurities:
// Common Laboratory Solvents, Organics, and Gases in Deuterated Solvents Relevant to the
// Organometallic Chemist", Organometallics 2010, 29, 2176–2179. Only ¹H singlets are listed (a
// reported singlet at exactly one of these shifts is suspicious) and only distinctive ¹³C peaks.

// ---------------------------------------------------------------- solvents
import { markFloat } from './pyjson';

/** Each solvent's usual name, with the ways a report may write it (compared after `plainSolvent`). */
export const SOLVENT_NAMES: Record<string, string[]> = {
  CDCl3: ['cdcl3', 'chloroform-d', 'chloroform-d1', 'deuterochloroform', 'd-chloroform', 'cdcl3-d'],
  'DMSO-d6': ['dmso-d6', 'd6-dmso', '(cd3)2so', 'cd3socd3', 'dimethylsulfoxide-d6', 'dimethylsulphoxide-d6', 'dmso'],
  CD3OD: ['cd3od', 'methanol-d4', 'methanol-d', 'd4-methanol', 'meod', 'meod-d4', 'd4-meoh', 'meoh-d4', 'd4-meod', 'cd3od-d4'],
  'acetone-d6': ['acetone-d6', 'd6-acetone', '(cd3)2co', 'cd3cocd3'],
  C6D6: ['c6d6', 'benzene-d6', 'd6-benzene'],
  CD2Cl2: ['cd2cl2', 'dichloromethane-d2', 'd2-dichloromethane', 'methylenechloride-d2', 'dcm-d2', 'd2-dcm'],
  CD3CN: ['cd3cn', 'acetonitrile-d3', 'd3-acetonitrile', 'mecn-d3', 'd3-mecn'],
  D2O: ['d2o', 'deuteriumoxide'],
  'THF-d8': ['thf-d8', 'd8-thf', 'tetrahydrofuran-d8', 'c4d8o'],
  'toluene-d8': ['toluene-d8', 'd8-toluene', 'c7d8', 'c6d5cd3'],
  CD3NO2: ['cd3no2', 'nitromethane-d3'],
  'pyridine-d5': ['pyridine-d5', 'd5-pyridine', 'c5d5n'],
};
/** Every spelling → its solvent's usual name ("meod" → "CD3OD"). */
const ALIASES = new Map<string, string>(Object.entries(SOLVENT_NAMES).flatMap(([name, list]) => list.map((a) => [a, name] as [string, string])));

/** Subscript digits made plain and any dash made "-". */
const plainChars = (t: string): string => t.replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080)).replace(/[‐‑‒–—−]/g, '-');
/** How spellings are compared: "CD₃ OD" → "cd3od". */
export const plainSolvent = (t: string): string => plainChars(t).toLowerCase().replace(/\s+/g, '');

const ALNUM = /[\p{L}\p{N}]/u;

/** The first NMR solvent a text names (the longest spelling where two start at the same place). */
export function findSolvent(text: string): { name: string; written: string; start: number; end: number } | null {
  const low = [...plainChars(text)].map((c) => c.toLowerCase().slice(0, 1) || c).join('');
  const chars: string[] = [], where: number[] = [];
  for (let i = 0; i < low.length; i++) if (!/\s/.test(low[i])) { chars.push(low[i]); where.push(i); }
  const squeezed = chars.join('');
  let best: [number, number, string] | null = null;
  for (const alias of ALIASES.keys()) {
    let i = squeezed.indexOf(alias);
    while (i !== -1) {
      const begin = where[i], end = where[i + alias.length - 1] + 1;
      const before = begin > 0 ? low[begin - 1] : '', after = end < low.length ? low[end] : '';
      if (!(ALNUM.test(before) || ALNUM.test(after))) {
        const key: [number, number, string] = [i, -alias.length, alias];
        if (!best || key[0] < best[0] || (key[0] === best[0] && (key[1] < best[1] || (key[1] === best[1] && key[2] < best[2])))) best = key;
        break;
      }
      i = squeezed.indexOf(alias, i + 1);
    }
  }
  if (!best) return null;
  const [start, negLen, alias] = best;
  const begin = where[start], end = where[start - negLen - 1] + 1;
  return { name: ALIASES.get(alias)!, written: plainChars(text.slice(begin, end)).replace(/\s+/g, ' ').trim(), start: begin, end };
}

/** The usual name of a solvent typed on its own ("cdcl3" → "CDCl3"); the text (trimmed) if it isn't one. */
export const canonicalSolvent = (t: string): string => ALIASES.get(plainSolvent(t)) ?? t.trim();

/** "CDCl3" → "CDCl₃" for messages. */
export const prettySolvent = (name: string): string => name.replace(/(?<=[A-Za-z])(\d+)/g, (d) => [...d].map((c) => String.fromCharCode(0x2080 + Number(c))).join(''));

// ---------------------------------------------------------------- peak reports

export interface Peak {
  /** δ, or the start of a range. */
  shift: number;
  /** The end of a range ("7.36 – 7.29"), else null. */
  end: number | null;
  /** What was in the brackets: "m, 5H" / "d, J = 8.3 Hz, 1H" / "2C". */
  details: string;
}
export const multiplicity = (p: Peak): string => (p.details ? p.details.split(',')[0].trim().toLowerCase() : '');
export function integration(p: Peak): number | null {
  const m = /(\d+(?:\.\d+)?)\s*H\b/.exec(p.details);
  return m ? Number(m[1]) : null;
}

const num = (t: string): number => Number(t.replace('−', '-'));

/** The spectrometer frequency a report gives ("400 MHz"), or null. */
export function frequency(text: string): number | null {
  const m = /(\d{2,4}(?:\.\d+)?)\s*MHz/.exec(text);
  return m ? Number(m[1]) : null;
}

/** The usual name of the first NMR solvent a report names, or ''. */
export const solventOf = (text: string): string => findSolvent(text)?.name ?? '';

/** The peak list: everything after "δ" (or after the "(400 MHz, CDCl3)" header). */
export function dataPart(text: string): string {
  const d = text.indexOf('δ');
  if (d >= 0) return text.slice(d + 1);
  const m = /^[^()]*NMR\s*\([^)]*\)\s*:?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

const NUMBER = '[−-]?\\d+(?:\\.\\d+)?';

/** Every peak in a report, with the bracketed details after it (which may hold brackets of their own). */
export function peaks(text: string): Peak[] {
  const data = dataPart(text);
  const out: Peak[] = [];
  const pattern = new RegExp(`(${NUMBER})(?:\\s*[–—-]\\s*(${NUMBER}))?\\s*`, 'g');
  let pos = 0;
  for (;;) {
    pattern.lastIndex = pos;
    const m = pattern.exec(data);
    if (!m) break;
    const mEnd = m.index + m[0].length;
    pos = mEnd;
    // numbers inside brackets (J values, "2C") are part of the details
    const before = data.slice(0, m.index);
    if (before.split('(').length - 1 > before.split(')').length - 1) continue;
    let details = '';
    if (data.startsWith('(', mEnd)) {
      let depth = 0;
      for (let i = mEnd; i < data.length; i++) {
        if (data[i] === '(') depth++;
        else if (data[i] === ')') {
          depth--;
          if (depth === 0) { details = data.slice(mEnd + 1, i).trim(); pos = i + 1; break; }
        }
      }
    }
    out.push({ shift: num(m[1]), end: m[2] ? num(m[2]) : null, details });
  }
  return out;
}

// A coupling constant: "J = 8.3 Hz", "J = 8.3, 2.0 Hz", "2J = 14.0 Hz", "JH–F = 47.6 Hz",
// "J(H,F) = 47.6 Hz", decimal commas. A number followed by "H" is an integration, not a J.
const J_VALUE = '\\d+(?:[.,]\\d+)?(?!\\d|\\s*H(?![a-z]))';
const COUPLING = new RegExp(`(?<![A-Za-z])J([^=;\\n]{0,15}?)\\s*=\\s*(${J_VALUE}(?:\\s*Hz)?(?:\\s*(?:,|and|&)\\s*${J_VALUE}(?:\\s*Hz)?)*)`, 'g');

export interface Coupling {
  /** Hz. */
  value: number;
  /** As in the report: "8.3" or "8,3". */
  written: string;
  /** What names the coupling: "" / "H–F" / "(H,F)" / "1". */
  which: string;
}

/** Every coupling constant in a report, in order. */
export function couplings(text: string): Coupling[] {
  const out: Coupling[] = [];
  for (const m of text.matchAll(COUPLING)) {
    const which = m[1].trim();
    if (which.length > 12 || /[A-Za-z]{4,}/.test(which)) continue;
    for (const v of m[2].matchAll(new RegExp(J_VALUE, 'g'))) out.push({ value: Number(v[0].replace(',', '.')), written: v[0], which });
  }
  return out;
}

/** Listed ¹³C signals (a "(2C)" note still counts as one). */
export const carbonSignalCount = (text: string): number => peaks(text).length;
/** Sum of the integrations: "(m, 5H)" + "(d, 1H)" = 6. */
export const protonCount = (text: string): number => peaks(text).reduce((n, p) => n + (integration(p) ?? 0), 0);

// ---------------------------------------------------------------- solvent and impurity peaks

/** ¹H singlets, by solvent. */
const PROTON_SINGLETS: Record<string, [number, string][]> = {
  CDCl3: [[7.26, 'residual CHCl₃'], [1.56, 'water'], [2.17, 'acetone'], [2.10, 'acetonitrile or acetic acid'], [7.36, 'benzene'], [5.30, 'CH₂Cl₂'], [2.62, 'DMSO'], [3.71, '1,4-dioxane'], [2.05, 'ethyl acetate'], [3.49, 'methanol'], [2.36, 'toluene (CH₃)'], [8.02, 'DMF'], [2.96, 'DMF'], [2.88, 'DMF'], [0.07, 'silicone grease'], [1.28, 'tert-butanol'], [4.33, 'nitromethane']],
  'DMSO-d6': [[2.50, 'residual DMSO'], [3.33, 'water'], [2.09, 'acetone'], [2.07, 'acetonitrile'], [7.37, 'benzene'], [5.76, 'CH₂Cl₂'], [8.32, 'chloroform'], [1.99, 'ethyl acetate'], [3.16, 'methanol'], [2.30, 'toluene (CH₃)'], [7.95, 'DMF'], [2.89, 'DMF'], [2.73, 'DMF'], [3.57, '1,4-dioxane']],
  CD3OD: [[3.31, 'residual CHD₂OD'], [4.87, 'water'], [2.15, 'acetone'], [2.03, 'acetonitrile'], [5.49, 'CH₂Cl₂'], [7.88, 'chloroform'], [2.01, 'ethyl acetate'], [3.34, 'methanol'], [2.32, 'toluene (CH₃)']],
  'acetone-d6': [[2.05, 'residual acetone-d₅'], [2.84, 'water'], [5.63, 'CH₂Cl₂'], [8.02, 'chloroform'], [1.97, 'ethyl acetate'], [3.31, 'methanol'], [2.32, 'toluene (CH₃)'], [2.52, 'DMSO']],
  C6D6: [[7.16, 'residual C₆HD₅'], [0.40, 'water'], [1.55, 'acetone'], [4.27, 'CH₂Cl₂'], [6.15, 'chloroform'], [1.65, 'ethyl acetate'], [3.07, 'methanol'], [2.11, 'toluene (CH₃)']],
  CD2Cl2: [[5.32, 'residual CHDCl₂'], [1.52, 'water'], [2.12, 'acetone'], [7.32, 'chloroform'], [2.00, 'ethyl acetate'], [3.42, 'methanol']],
  CD3CN: [[1.94, 'residual CHD₂CN'], [2.13, 'water'], [2.08, 'acetone'], [5.44, 'CH₂Cl₂'], [7.58, 'chloroform'], [1.97, 'ethyl acetate'], [3.28, 'methanol']],
  D2O: [[4.79, 'residual HDO'], [2.22, 'acetone'], [2.06, 'acetonitrile'], [3.34, 'methanol'], [2.71, 'DMSO']],
};
/** Distinctive ¹³C peaks, by solvent. */
const CARBON_PEAKS: Record<string, [number, string][]> = {
  CDCl3: [[77.16, 'CDCl₃ (solvent)'], [207.07, 'acetone'], [30.92, 'acetone'], [53.52, 'CH₂Cl₂'], [40.76, 'DMSO'], [50.41, 'methanol'], [116.43, 'acetonitrile'], [1.89, 'acetonitrile'], [128.37, 'benzene'], [67.14, '1,4-dioxane']],
  'DMSO-d6': [[39.52, 'DMSO-d₆ (solvent)'], [206.31, 'acetone'], [54.84, 'CH₂Cl₂'], [79.16, 'chloroform'], [48.59, 'methanol'], [117.91, 'acetonitrile']],
  CD3OD: [[49.00, 'CD₃OD (solvent)'], [209.67, 'acetone'], [54.78, 'CH₂Cl₂'], [79.44, 'chloroform']],
  'acetone-d6': [[29.84, 'acetone-d₆ (solvent)'], [206.26, 'acetone-d₆ (solvent)'], [54.95, 'CH₂Cl₂'], [79.19, 'chloroform'], [49.77, 'methanol']],
  C6D6: [[128.06, 'C₆D₆ (solvent)'], [204.43, 'acetone'], [53.46, 'CH₂Cl₂'], [77.79, 'chloroform'], [49.97, 'methanol']],
  CD2Cl2: [[53.84, 'CD₂Cl₂ (solvent)'], [206.78, 'acetone'], [77.99, 'chloroform'], [50.45, 'methanol']],
  CD3CN: [[1.32, 'CD₃CN (solvent)'], [118.26, 'CD₃CN (solvent)'], [207.43, 'acetone'], [54.24, 'CH₂Cl₂'], [79.17, 'chloroform']],
};

export interface ImpurityRow { solvent: string; nucleus: string; shift: number | string; what: string; on: boolean }

/** The built-in table as rows. */
export function defaultImpurityTable(): ImpurityRow[] {
  const rows: ImpurityRow[] = [];
  for (const [nucleus, table] of [['1H', PROTON_SINGLETS], ['13C', CARBON_PEAKS]] as const) {
    for (const [solvent, list] of Object.entries(table)) for (const [shift, what] of list) rows.push({ solvent, nucleus, shift, what, on: true });
  }
  return rows;
}

/** The project's own table if it was edited (Project settings ▸ NMR impurities in SI Assistant), else the built-in one. */
export function projectImpurityTable(settings: Record<string, unknown>): ImpurityRow[] {
  const t = settings.impurity_table;
  if (!Array.isArray(t)) return defaultImpurityTable();
  return t.filter((r): r is ImpurityRow => !!r && typeof r === 'object' && !Array.isArray(r));
}

const PROTON_TOLERANCE = 0.010, CARBON_TOLERANCE = 0.050;
const OLD_DEFAULTS = [0.005, 0.03];
const nonNeg = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** (¹H, ¹³C) match tolerances in ppm: the project's own, else the defaults. */
export function impurityTolerances(settings: Record<string, unknown>): [number, number] {
  const keys = ['impurity_tolerance_1H_ppm', 'impurity_tolerance_13C_ppm'], old = ['impurity_tolerance_1H', 'impurity_tolerance_13C'];
  const defaults = [PROTON_TOLERANCE, CARBON_TOLERANCE];
  const out = keys.map((k, i) => {
    let v = nonNeg(settings[k]);
    if (v === null) {
      v = nonNeg(settings[old[i]]);
      if (v !== null && Math.abs(v - OLD_DEFAULTS[i]) < 1e-9) v = null;
    }
    return v ?? defaults[i];
  });
  return [out[0], out[1]];
}

/** What an observed peak may be ('' when it matches no known impurity). ¹H peaks match only as singlets. */
export function impurityMatch(solvent: string, nucleus: string, shift: number, singlet: boolean, table: ImpurityRow[], tolH = PROTON_TOLERANCE, tolC = CARBON_TOLERANCE): string {
  let tol: number;
  if (nucleus === '1H') { if (!singlet) return ''; tol = tolH; } else if (nucleus === '13C') tol = tolC;
  else return '';
  const hits: string[] = [];
  for (const row of table) {
    if (!(row.on === undefined ? true : row.on) || row.nucleus !== nucleus) continue;
    if (canonicalSolvent(String(row.solvent ?? '')) !== solvent) continue;
    const v = typeof row.shift === 'number' ? row.shift : Number(row.shift);
    if (typeof row.shift === 'string' ? !row.shift.trim() : typeof row.shift !== 'number' || !Number.isFinite(v)) continue;
    if (Math.abs(v - shift) <= tol + 1e-9) hits.push(String(row.what ?? '') || 'a listed impurity');
  }
  return [...new Set(hits)].join(' / ');
}

// ---------------------------------------------------------------- editing the table (Project Settings ▸ NMR Impurities)

export const DEFAULT_TOLERANCES: readonly [number, number] = [PROTON_TOLERANCE, CARBON_TOLERANCE];
const NUCLEUS_NAMES: Record<string, string> = { '1h': '1H', '¹h': '1H', h: '1H', '13c': '13C', '¹³c': '13C', c: '13C' };

/** A row as typed in the table: the solvent by its usual name, the nucleus as 1H or 13C, the shift a number (null when it isn't one: the row is left out). */
export function impurityRowFrom(on: boolean, solvent: string, nucleus: string, shift: string, what: string): ImpurityRow | null {
  const v = Number(shift.trim().replace('−', '-'));
  if (!shift.trim() || !Number.isFinite(v)) return null;
  const n = nucleus.trim();
  return { solvent: canonicalSolvent(solvent) || solvent.trim(), nucleus: NUCLEUS_NAMES[n.toLowerCase().replace(/\s/g, '')] ?? n, shift: v, what, on };
}

const sameRow = (a: ImpurityRow, b: ImpurityRow): boolean =>
  a.solvent === b.solvent && a.nucleus === b.nucleus && Number(a.shift) === Number(b.shift) && a.what === b.what && !!a.on === !!b.on;

/** Keep the table in the project's settings, as SI Assistant does: an unedited table is not stored, so the project follows the built-in one. */
export function storeImpurityTable(settings: Record<string, unknown>, rows: ImpurityRow[]): void {
  const def = defaultImpurityTable();
  if (rows.length === def.length && rows.every((r, i) => sameRow(r, def[i]))) { delete settings.impurity_table; return; }
  settings.impurity_table = rows.map((r) => {
    const out = { solvent: r.solvent, nucleus: r.nucleus, shift: Number(r.shift), what: r.what, on: !!r.on };
    markFloat(out, 'shift');
    return out;
  });
}

/** Keep the match tolerances: a value equal to the default is not stored (the project then follows the default); the older keys go. */
export function storeImpurityTolerances(settings: Record<string, unknown>, proton: number, carbon: number): void {
  const keys = ['impurity_tolerance_1H_ppm', 'impurity_tolerance_13C_ppm'], old = ['impurity_tolerance_1H', 'impurity_tolerance_13C'];
  [proton, carbon].forEach((v, i) => {
    delete settings[old[i]];
    if (Math.abs(v - DEFAULT_TOLERANCES[i]) < 1e-9) delete settings[keys[i]];
    else { settings[keys[i]] = v; markFloat(settings, keys[i]); }
  });
}
