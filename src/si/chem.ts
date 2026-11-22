// The chemistry SI checks need, worked out as Chem SI Assistant works it out (core/chem.py),
// so both give the same formulas, ions, isotope peaks and warnings:
//
// - element counts with isotope labels kept apart ([13C], D, T), Hill formulas;
// - adducts ([M+H]+, [2M+Na]+, [M+H-H2O]+, [M]+•…) and the m/z of an ion;
// - the ion's isotope peaks, one per isotopic composition (so a found value on the ⁸¹Br or
//   ¹³C peak is matched to it), and the ppm error;
// - the pieces of a salt, and which piece is "the compound" (not a common counter-ion);
// - symmetry-distinct carbons (≈ ¹³C signals) and ¹H counts (with NH/OH/SH apart).
//
// Masses and abundances: Chemweave's isotope table (chem/analysis.ts: NIST, masses from the 2016
// Atomic Mass Evaluation) for the natural isotopes; labelled isotopes ([14C], T, [18F]…) and
// elements with none in nature (Tc, Pm…) from isotope-masses.ts (NIST SRD 144, as SI Assistant
// has them through RDKit); the electron mass is CODATA 2018 (chem/hrms.ts).

import { ISOTOPES } from '../chem/analysis';
import { ELECTRON } from '../chem/hrms';
import { elementNumber, SYMBOLS } from '../chem/elements';
import { isotopeMassOf, mostCommonIsotope } from './isotope-masses';
import { DEEP_LIMIT, longestPathBound } from '../chem/engine-guard';

export class ChemError extends Error {}

/** Element counts: "C", "H", "D", "T", or "13C" style keys ("<mass number><symbol>") for labelled isotopes. */
export type Counts = Map<string, number>;

const isoKey = (sym: string, iso: number): string => (iso ? `${iso}${sym}` : sym);
/** [symbol, mass number (0: natural)] of a counts key. */
export function splitKey(key: string): [string, number] {
  const m = /^(\d+)(.+)$/.exec(key);
  return m ? [m[2], Number(m[1])] : [key, 0];
}

export interface MolInfo {
  /** Hill formula of the structure as drawn, e.g. C8H10O3. */
  formula: string;
  /** Average molecular weight (g/mol). */
  mw: number;
  /** Monoisotopic mass of the structure as drawn. */
  exact: number;
  /** Net formal charge as drawn. */
  charge: number;
  /** Element symbols present (D and T counted as H). */
  elements: Set<string>;
  /** Canonical SMILES ('' for a typed formula). */
  smiles: string;
  counts: Counts;
}

// ---------------------------------------------------------------- isotopes and masses

/** An element's natural isotopes: [mass number, mass, fraction], the most common first. An element with none in nature (Tc, Pm, Po…) has its most common isotope only, as SI Assistant takes it. */
export function naturalIsotopes(sym: string): [number, number, number][] {
  const list = (ISOTOPES[sym] ?? []).filter((x) => x[1] > 0);
  if (!list.length) {
    const common = sym === 'D' || sym === 'T' ? null : mostCommonIsotope(sym);
    if (!common) throw new ChemError(`There is no isotope data for “${sym}”.`);
    return [[common[0], common[1], 1]];
  }
  const top = list.reduce((a, b) => (b[1] > a[1] ? b : a));
  const all = list.map(([mass, pct]) => [Math.round(mass), mass, pct / 100] as [number, number, number]);
  return [...all.filter((x) => x[1] === top[0]), ...all.filter((x) => x[1] !== top[0])];
}

/** An isotope's mass: from the natural isotopes' table, else from the full table (isotope-masses.ts: [14C], [18F], T…). */
function isotopeMass(sym: string, massNumber: number): number | null {
  if (sym === 'H' && massNumber === 2) return ISOTOPES.D[0][0];
  const hit = (ISOTOPES[sym] ?? []).find(([m]) => Math.round(m) === massNumber);
  return hit ? hit[0] : isotopeMassOf(sym, massNumber);
}

function atomMass(sym: string, iso: number): number {
  if (sym === 'D') return ISOTOPES.D[0][0];
  if (sym === 'T') return isotopeMass('H', 3)!;
  if (iso) {
    const m = isotopeMass(sym, iso);
    if (m === null) throw new ChemError(`“${iso}${sym}” is not an isotope I know.`);
    return m;
  }
  return naturalIsotopes(sym)[0][1];
}

function averageWeight(sym: string): number {
  const list = ISOTOPES[sym === 'D' || sym === 'T' ? 'H' : sym] ?? [];
  const total = list.reduce((s, [, p]) => s + p, 0);
  return total ? list.reduce((s, [m, p]) => s + m * p, 0) / total : naturalIsotopes(sym)[0][1];
}

export function countsMass(counts: Counts): number {
  let m = 0;
  for (const [k, n] of counts) { const [s, i] = splitKey(k); m += atomMass(s, i) * n; }
  return m;
}

/** Hill order: C (then its labelled isotopes, [13C], [14C], by mass number), then H (D, T, then [nH]), then the rest alphabetically; isotope labels in brackets. */
export function hillFormula(counts: Counts): string {
  const merged = new Map<string, number>();
  for (const [k, n] of counts) {
    if (!n) continue;
    const [s, i] = splitKey(k);
    const key = i ? `[${i}${s}]` : s;
    merged.set(key, (merged.get(key) ?? 0) + n);
  }
  const bare = (k: string): string => k.replace(/^\[\d+|\]$/g, '');
  const hasC = [...merged.keys()].some((k) => bare(k) === 'C');
  // (every labelled carbon right after C, and labelled hydrogen after H, by mass number)
  const massOf = (k: string): number => Number(/^\[(\d+)/.exec(k)?.[1] ?? 0);
  const labelled = (sym: string): string[] => [...merged.keys()].filter((k) => k.startsWith('[') && bare(k) === sym).sort((a, b) => massOf(a) - massOf(b));
  const order = (hasC ? ['C', ...labelled('C'), 'H', 'D', 'T', ...labelled('H')] : []).filter((k) => merged.has(k));
  const rest = [...merged.keys()].filter((k) => !order.includes(k)).sort((a, b) => cmp(bare(a), bare(b)) || cmp(a, b));
  return [...order, ...rest].map((k) => k + (merged.get(k)! > 1 ? merged.get(k) : '')).join('');
}
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function chargeText(charge: number): string {
  if (!charge) return '';
  return (Math.abs(charge) > 1 ? String(Math.abs(charge)) : '') + (charge > 0 ? '+' : '−');
}
export const speciesLabel = (info: MolInfo): string => info.formula + chargeText(info.charge);

/** Two compositions alike, D the same as [2H] (a typed "[2H]" is not a different M). */
export function sameFormula(a: Counts, b: Counts): boolean {
  const norm = (c: Counts): Map<string, number> => {
    const out = new Map<string, number>();
    for (const [k, n] of c) {
      const [s, i] = splitKey(k);
      const key = s === 'H' && (i === 2 || i === 3) ? (i === 2 ? 'D' : 'T') : k;
      out.set(key, (out.get(key) ?? 0) + n);
    }
    for (const [k, n] of out) if (n <= 0) out.delete(k);
    return out;
  };
  const x = norm(a), y = norm(b);
  return x.size === y.size && [...x].every(([k, n]) => y.get(k) === n);
}

/** A MolInfo for a formula without a structure (one typed for M). */
export function infoFromCounts(counts: Counts, charge = 0): MolInfo {
  let mw = 0;
  for (const [k, n] of counts) { const [s, i] = splitKey(k); mw += (i || s === 'D' || s === 'T' ? atomMass(s, i) : averageWeight(s)) * n; }
  return { formula: hillFormula(counts), mw, exact: countsMass(counts), charge, elements: new Set([...counts.keys()].map((k) => { const s = splitKey(k)[0]; return s === 'D' || s === 'T' ? 'H' : s; })), smiles: '', counts: new Map(counts) };
}

// ---------------------------------------------------------------- formulas typed

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superToPlain = (t: string): string => t.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String(SUPER.indexOf(c))).replace(/⁺/g, '+').replace(/⁻/g, '-');
const subToPlain = (t: string): string => t.replace(/[₀-₉]/g, (c) => String(c.charCodeAt(0) - 0x2080));

/** A simple formula like Na, NH4 or HCOO. */
export function parseFormula(text: string): Counts {
  if (!text || text.replace(/([A-Z][a-z]?)(\d*)/g, '')) throw new ChemError(`“${text}” is not a simple formula like Na, NH4 or HCOO.`);
  const counts: Counts = new Map();
  for (const m of text.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const sym = m[1];
    if (sym !== 'D' && sym !== 'T' && elementNumber(sym) === undefined) throw new ChemError(`Unknown element “${sym}” in “${text}”.`);
    counts.set(sym, (counts.get(sym) ?? 0) + (m[2] ? Number(m[2]) : 1));
  }
  return counts;
}

function isotopeKey(sym: string, massNumber: number): string {
  if (sym === 'D' || sym === 'T' || elementNumber(sym) === undefined || isotopeMass(sym, massNumber) === null) throw new ChemError(`“${massNumber}${sym}” is not an isotope I know.`);
  return isoKey(sym, massNumber);
}

/** Counts for a formula with isotopes in brackets, e.g. "C5[13C]H6Br". */
function labelledFormula(text: string): Counts {
  const counts: Counts = new Map();
  const re = /\[(\d+)([A-Z][a-z]?)\](\d*)/g;
  for (const m of text.matchAll(re)) {
    const k = isotopeKey(m[2], Number(m[1]));
    counts.set(k, (counts.get(k) ?? 0) + (m[3] ? Number(m[3]) : 1));
  }
  const rest = text.replace(re, '');
  if (rest) for (const [k, n] of parseFormula(rest)) counts.set(k, (counts.get(k) ?? 0) + n);
  return counts;
}

/**
 * Counts for a typed formula with groups: a group in parentheses or brackets with its count after
 * it (Fe(C5H5)2, Ca(OH)2, [Cu(NH3)4]SO4), and hydrate or solvate parts after a dot with their count
 * before them (CuSO4·5H2O, C6H12O6·H2O, also with . or *). Isotope labels stay as they are ([13C]).
 */
function groupedFormula(text: string): Counts {
  const out: Counts = new Map();
  const addTo = (c: Counts, k: number): void => { for (const [key, n] of c) out.set(key, (out.get(key) ?? 0) + n * k); };
  for (const part of text.split(/[·•.*](?=\d*[A-Z([])/)) {
    const m = /^(\d*)(.*)$/.exec(part)!;
    if (!m[2]) throw new ChemError(`“${text}” has an empty part after a dot.`);
    addTo(groupBody(m[2], text), m[1] ? Number(m[1]) : 1);
  }
  return out;
}

/** One part of a grouped formula: groups in ( ) or [ ] (not an isotope label like [13C]) multiplied out. */
function groupBody(t: string, whole: string): Counts {
  const out: Counts = new Map();
  let flat = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const opens = c === '(' || (c === '[' && /[A-Z([]/.test(t[i + 1] ?? ''));
    if (!opens) {
      if (c === ')' || c === ']') { if (c === ']' && flat.lastIndexOf('[') > flat.lastIndexOf(']')) { flat += c; continue; } throw new ChemError(`“${whole}” has a closing bracket without its opening one.`); }
      flat += c;
      continue;
    }
    const close = c === '(' ? ')' : ']';
    let depth = 0, j = i;
    for (; j < t.length; j++) {
      if (t[j] === c) depth++;
      else if (t[j] === close && --depth === 0) break;
    }
    if (j >= t.length) throw new ChemError(`“${whole}” has a bracket that isn't closed.`);
    const digits = /^\d*/.exec(t.slice(j + 1))![0];
    const inner = groupBody(t.slice(i + 1, j), whole);
    for (const [k, n] of inner) out.set(k, (out.get(k) ?? 0) + n * (digits ? Number(digits) : 1));
    i = j + digits.length;
  }
  if (flat) for (const [k, n] of labelledFormula(flat)) out.set(k, (out.get(k) ?? 0) + n);
  return out;
}

const SIGNS = '+\\-−–⁺⁻';
const DIGITS = `0-9${SUPER}`;
const RADICAL = '•·.';
const TYPED_CHARGE = new RegExp(`(?<n>[${SUPER}]*)(?<signs>[+\\-−–⁺⁻]+)(?<n2>[${SUPER}]*)$`);
const EXPLICIT_CHARGE = [
  new RegExp(`\\(\\s*(?<n>[${DIGITS}]*)\\s*(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)\\s*\\)$`),
  new RegExp(`\\^\\s*(?<n>[${DIGITS}]*)\\s*(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)$`),
  // (starting only where a run of spaces starts, and no two space runs side by side: a long run
  // of spaces is read in one go, not tried at each of its spaces)
  new RegExp(`(?<!\\s)\\s+(?:(?<n>[${DIGITS}]+)\\s*)?(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)$`),
  new RegExp(`(?<n>)(?<signs>[${SIGNS}])(?<n2>[0-9]+)$`),
];
const BRACKETED_ION = new RegExp(`^\\[(?<f>[A-Z].*)\\][${RADICAL}]?(?<n>[${DIGITS}]*)(?<signs>[${SIGNS}]+)(?<n2>[${DIGITS}]*)$`);
const CHARGE_HINT = 'Write a charge at the end of the formula, as in C₁₀H₈N₂²⁺, C10H8N2++, C10H8N2 2+ or C6H6+•.';

function chargeFrom(g: Record<string, string>, text: string): number {
  const signs = g.signs.replace(/[−–]/g, '-').replace(/⁺/g, '+').replace(/⁻/g, '-');
  if (new Set(signs).size === 2) throw new ChemError(`The charge at the end of “${text.trim()}” has both + and −.`);
  const n = g.n ?? '', n2 = g.n2 ?? '';
  const digits = superToPlain(n + n2);
  if (digits && (signs.length > 1 || (n && n2))) throw new ChemError(`The charge at the end of “${text.trim()}” can't be read: write it as ²⁺ or ++, not both.`);
  const size = digits ? Number(digits) : signs.length;
  if (size === 0) throw new ChemError(`The charge at the end of “${text.trim()}” is zero. ${CHARGE_HINT}`);
  return signs[0] === '+' ? size : -size;
}

const stripEnd = (t: string, chars: string): string => { let e = t.length; while (e > 0 && chars.includes(t[e - 1])) e--; return t.slice(0, e); };

/** (counts, charge) of a formula typed for M: "C6H8N2+", "C10H8N2²⁺", "[C10H8N2]2+", "C5[13C]H6Br"… */
export function parseMFormulaAndCharge(text: string): [Counts, number] {
  let cleaned = stripEnd(subToPlain(text ?? '').trim(), RADICAL + ' \t');
  let charge = 0;
  const b = BRACKETED_ION.exec(cleaned.replace(/ /g, ''));
  if (b) {
    charge = chargeFrom(b.groups!, text);
    cleaned = b.groups!.f;
  } else {
    let m: RegExpExecArray | null = null;
    for (const rx of EXPLICIT_CHARGE) if ((m = rx.exec(cleaned))) break;
    if (!m) { cleaned = cleaned.replace(/ /g, ''); m = TYPED_CHARGE.exec(cleaned); }
    if (m) { charge = chargeFrom(m.groups!, text); cleaned = cleaned.slice(0, m.index); }
  }
  cleaned = stripEnd(cleaned.replace(/ /g, ''), RADICAL);
  if (!cleaned) throw new ChemError('The formula is empty.');
  try {
    // (a plain formula as before; one with groups or a hydrate dot multiplied out first)
    return [/[()[\]·•.*]/.test(cleaned.replace(/\[\d+[A-Z][a-z]?\]/g, '')) ? groupedFormula(cleaned) : labelledFormula(cleaned), charge];
  } catch (e) {
    if (e instanceof ChemError && /[+\-−–⁺⁻()^]/.test(text ?? '')) throw new ChemError(`${e.message} ${CHARGE_HINT}`);
    throw e;
  }
}

// ---------------------------------------------------------------- adducts and ions

export interface Adduct {
  label: string;
  /** 2 for [2M+Na]+. */
  multimer: number;
  /** Atoms added (negative: taken away). */
  delta: Counts;
  /** Signed charge of the ion. */
  charge: number;
  radical: boolean;
}

const ADDUCT = /^\[(\d*)M((?:[+\-−][^+\-−\]]+)*)\](\d*)([+\-−])([•·.]?)$/;
const MOD = new RegExp(`([+\\-−])(\\d*)([A-Za-z0-9${SUPER}]+)`, 'y');

/** Read an adduct such as [M+H]+, [M+Na]⁺, [2M+Na]+, [M+H–H₂O]+, [M+2H]2+, [M]+•. */
export function parseAdduct(label: string): Adduct {
  let text = subToPlain(label.trim()).replace(/[−–‐‑]/g, '-').replace(/ /g, '');
  const close = text.lastIndexOf(']') + 1;
  text = text.slice(0, close) + superToPlain(text.slice(close));
  const m = ADDUCT.exec(text);
  if (!m) throw new ChemError(`“${label}” is not an adduct I can read. Use the form [M+H]+, [M+Na]+, [M-H]-, [2M+Na]+, [M+H-H2O]+ or [M+2H]2+.`);
  const mods = m[2];
  const pieces: RegExpExecArray[] = [];
  let pos = 0;
  for (;;) {
    MOD.lastIndex = pos;
    const p = MOD.exec(mods);
    if (!p) break;
    pieces.push(p);
    pos = p.index + p[0].length;
  }
  if (pos !== mods.length) throw new ChemError(`In “${label}”, I can't read “${mods.slice(pos)}”. Use plain formulas such as +Na, +NH4 or -H2O.`);
  const multimer = m[1] ? Number(m[1]) : 1;
  if (multimer === 0) throw new ChemError(`“${label}”: the number of M can't be 0 (use [M+H]+ or [2M+Na]+).`);
  const delta: Counts = new Map();
  for (const p of pieces) {
    const n = (p[2] ? Number(p[2]) : 1) * (p[1] === '+' ? 1 : -1);
    const formula = p[3].replace(new RegExp(`([${SUPER}]+)([A-Z][a-z]?)`, 'g'), (all, mass: string, sym: string) => {
      try {
        isotopeKey(sym, Number(superToPlain(mass)));
      } catch {
        throw new ChemError(`In “${label}”, “${all}” is not an isotope I know. A superscript number before an element is read as its mass number (as in ⁷Li); write a count as H2O or H₂O.`);
      }
      return `[${superToPlain(mass)}${sym}]`;
    });
    for (const [k, c] of labelledFormula(formula)) delta.set(k, (delta.get(k) ?? 0) + n * c);
  }
  const z = (m[3] ? Number(m[3]) : 1) * (m[4] === '+' ? 1 : -1);
  if (z === 0) throw new ChemError(`“${label}”: the ion's charge can't be 0. Use e.g. [M+H]+, [M-H]- or [M+2H]2+.`);
  return { label, multimer, delta, charge: z, radical: !!m[5] };
}

/** "[M+NH4]+" → "[M+NH4]⁺" (the charge as superscript, minus signs as −). */
export function adductDisplay(label: string): string {
  const m = /^(\[.*\])(\d*[+\-−][•·.]?)$/.exec(label.trim());
  if (!m) return label;
  const charge = m[2].replace(/−/g, '-').replace(/[.·]/g, '•');
  return m[1].replace(/-/g, '−') + charge.replace(/[0-9+-]/g, (c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻'['0123456789+-'.indexOf(c)]);
}

function ionCounts(info: MolInfo, a: Adduct): Counts {
  const out: Counts = new Map();
  for (const [k, n] of info.counts) out.set(k, (out.get(k) ?? 0) + n * a.multimer);
  for (const [k, n] of a.delta) out.set(k, (out.get(k) ?? 0) + n);
  if ([...out.values()].some((n) => n < 0)) throw new ChemError(`${a.label} removes atoms the structure does not have.`);
  for (const [k, n] of out) if (!n) out.delete(k);
  return out;
}

/** The calculated m/z of M with an adduct. */
export function ionMz(info: MolInfo, adductLabel: string): { adduct: Adduct; formula: string; mz: number } {
  const adduct = parseAdduct(adductLabel);
  const counts = ionCounts(info, adduct);
  return { adduct, formula: hillFormula(counts), mz: (countsMass(counts) - adduct.charge * ELECTRON) / Math.abs(adduct.charge) };
}

export const ppmError = (found: number, calc: number): number => ((found - calc) / calc) * 1e6;

export interface Peak {
  mz: number;
  /** % of the most intense peak. */
  abundance: number;
  /** Isotopes other than the most common labelled, e.g. C6H6[81Br]. */
  formula: string;
  /** Made only of the most common isotopes. */
  mono: boolean;
}

const PRUNE = 1e-7;
const patterns = new Map<string, Peak[]>();

/** The ion's main isotope peaks, most intense first: one per isotopic composition (⁸¹Br, one ¹³C…). */
export function isotopePattern(info: MolInfo, adductLabel: string, minPercent = 5, maxPeaks = 6): Peak[] {
  const key = [...info.counts].sort((a, b) => cmp(a[0], b[0])).map(([k, n]) => k + ':' + n).join(',') + `|${adductLabel}|${minPercent}|${maxPeaks}`;
  let got = patterns.get(key);
  if (!got) {
    got = computePattern(info, adductLabel, minPercent, maxPeaks);
    if (patterns.size > 3000) patterns.clear();
    patterns.set(key, got);
  }
  return got.map((p) => ({ ...p }));
}

/** A composition of the ion so far: its mass and probability, and the element spread that made it (only read for the peaks kept). */
interface PatternState { mass: number; p: number; heavy: boolean; prev: PatternState | null; sym: string; comp: number[] | null }

function computePattern(info: MolInfo, adductLabel: string, minPercent: number, maxPeaks: number): Peak[] {
  const adduct = parseAdduct(adductLabel);
  const counts = ionCounts(info, adduct);
  let fixedMass = 0;
  const fixed: Counts = new Map();
  // Every isotopic composition, element by element, pruned below PRUNE of the most likely one.
  // (The same sums in the same order as SI Assistant's, so the same numbers; compositions are
  // kept as counts, and written out as formulas only for the peaks kept, so heavy-metal ions
  // with many isotopes, e.g. Sn₆Br₆, are quick.)
  let states: PatternState[] = [{ mass: 0, p: 1, heavy: false, prev: null, sym: '', comp: null }];
  const entries = [...counts].map(([k, n]) => [splitKey(k), n] as [[string, number], number]).sort((a, b) => cmp(a[0][0], b[0][0]) || a[0][1] - b[0][1]);
  for (const [[sym, iso], n] of entries) {
    if (iso || sym === 'D' || sym === 'T') {
      fixed.set(isoKey(sym, iso), (fixed.get(isoKey(sym, iso)) ?? 0) + n);
      fixedMass += atomMass(sym, iso) * n;
      continue;
    }
    const isotopes = naturalIsotopes(sym);
    // the n atoms over the isotopes, atom by atom; a composition's key is its counts as one
    // number (base n + 1), or as text when that number would be too big to be exact
    const K = isotopes.length, R = n + 1;
    const numeric = Math.pow(R, K) < Number.MAX_SAFE_INTEGER;
    const step = isotopes.map((_, k) => Math.pow(R, k));
    type Comp = { c: number[]; p: number; key: number | string };
    let element: Comp[] = [{ c: isotopes.map(() => 0), p: 1, key: 0 }];
    for (let a = 0; a < n; a++) {
      const next = new Map<number | string, Comp>();
      for (const { c, p, key } of element) {
        isotopes.forEach(([, , frac], k) => {
          let kk: number | string;
          if (numeric) kk = (key as number) + step[k];
          else { c[k]++; kk = c.join(','); c[k]--; }
          const got = next.get(kk);
          if (got) got.p += p * frac;
          else { const cc = c.slice(); cc[k]++; next.set(kk, { c: cc, p: 0 + p * frac, key: kk }); }
        });
      }
      let top = 0;
      for (const x of next.values()) if (x.p > top) top = x.p;
      element = [...next.values()].filter((x) => x.p >= top * PRUNE);
    }
    const masses = element.map(({ c }) => c.reduce((s, x, k) => s + x * isotopes[k][1], 0));
    const heavies = element.map(({ c }) => c.some((x, k) => k > 0 && x > 0));
    const combined: PatternState[] = [];
    for (const st of states) {
      element.forEach(({ c, p: q }, j) => {
        combined.push({ mass: st.mass + masses[j], p: st.p * q, heavy: st.heavy || heavies[j], prev: st, sym, comp: c });
      });
    }
    let top = 0;
    for (const x of combined) if (x.p > top) top = x.p;
    states = combined.filter((x) => x.p >= top * PRUNE);
  }
  let top = 0;
  for (const x of states) if (x.p > top) top = x.p;
  const kept: { mz: number; abundance: number; st: PatternState }[] = [];
  for (const st of states) {
    const percent = (st.p / top) * 100;
    if (percent < minPercent) continue;
    kept.push({ mz: (st.mass + fixedMass - adduct.charge * ELECTRON) / Math.abs(adduct.charge), abundance: percent, st });
  }
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
  kept.sort((a, b) => r6(b.abundance) - r6(a.abundance) || a.mz - b.mz);
  return kept.slice(0, maxPeaks).map(({ mz, abundance, st }) => {
    const fc: Counts = new Map(fixed);
    for (const [k, n] of counts) { const [s, i] = splitKey(k); if (!i && s !== 'D' && s !== 'T') fc.set(k, (fc.get(k) ?? 0) + n); }
    const chain: PatternState[] = [];
    for (let x: PatternState | null = st; x && x.comp; x = x.prev) chain.unshift(x);
    for (const x of chain) {
      const isotopes = naturalIsotopes(x.sym);
      x.comp!.forEach((n, k) => {
        if (!k || !n) return;
        fc.set(x.sym, (fc.get(x.sym) ?? 0) - n);
        fc.set(isoKey(x.sym, isotopes[k][0]), (fc.get(isoKey(x.sym, isotopes[k][0])) ?? 0) + n);
      });
    }
    return { mz, abundance, formula: hillFormula(fc), mono: !st.heavy };
  });
}

export const nearestPeak = (peaks: Peak[], found: number): Peak => peaks.reduce((a, b) => (Math.abs(b.mz - found) < Math.abs(a.mz - found) ? b : a));

const logFactorial = (n: number): number => { let s = 0; for (let k = 2; k <= n; k++) s += Math.log(k); return s; };

/** The all-most-common-isotope peak, its abundance worked out directly (a big pattern of many Br/Sn may not list it). */
export function monoisotopicPeak(info: MolInfo, adductLabel: string): Peak {
  const ion = ionMz(info, adductLabel);
  let logRatio = 0;
  for (const [k, n] of ionCounts(info, ion.adduct)) {
    const [s, i] = splitKey(k);
    if (i || s === 'D' || s === 'T') continue;
    const fr = naturalIsotopes(s).map((x) => x[2]);
    if (fr.length > 1) logRatio += n * Math.log(fr[0]) - logMostLikely(fr, n);
  }
  return { mz: ion.mz, abundance: 100 * Math.exp(logRatio), formula: ion.formula, mono: true };
}

/** ln of the probability of the most likely spread of n atoms over the isotopes (the multinomial's mode). */
function logMostLikely(fr: number[], n: number): number {
  const counts = fr.map(() => 0);
  for (let a = 0; a < n; a++) {
    let best = 0, gain = -1;
    fr.forEach((f, k) => { const g = f / (counts[k] + 1); if (g > gain) { gain = g; best = k; } });
    counts[best]++;
  }
  return logFactorial(n) + counts.reduce((s, x, k) => s + (x ? x * Math.log(fr[k]) - logFactorial(x) : 0), 0);
}

// ---------------------------------------------------------------- a structure's facts (RDKit)

/** One piece of a structure (a cation, an anion…), the largest first. */
export interface Piece { smiles: string; info: MolInfo; counterIon: boolean }

export interface MolFacts {
  /** Null for a structure with a generic atom (R, X, *): no formula or masses. */
  info: MolInfo | null;
  /** Labels of its generic atoms (R, R1, X, A…). */
  generic: string[];
  pieces: Piece[];
  /** Symmetry-distinct carbons (≈ ¹³C signals). */
  uniqueCarbons: number;
  /** ¹H hydrogens, and those on N, O or S (exchangeable). */
  hTotal: number;
  hExch: number;
  /** The standard InChIKey of the whole structure ('' when one can't be made), for the PubChem name lookup. */
  inchikey?: string;
  /** Why there is no formula or masses for a structure without a generic atom (it couldn't be read, or an atom has no mass data): said where the formula would show. */
  error?: string;
}

/** What the checks have for a structure that can't be read at all. */
export const UNREADABLE_STRUCTURE = 'This structure could not be read (check its valences and charges), so no formula or masses can be calculated. Fix the structure, or type the M formula in the HRMS field (✎) if you need the calculated m/z.';
export const unreadableFacts = (error = UNREADABLE_STRUCTURE): MolFacts => ({ info: null, generic: [], pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0, error });

/** Common counter-ions (left out of a salt's automatic HRMS M), and acids drawn with them. */
export const COUNTER_ION_SMILES = [
  '[F-]', '[Cl-]', '[Br-]', '[I-]', 'Cl', 'Br',
  'F[B-](F)(F)F', 'F[P-](F)(F)(F)(F)F', 'F[Sb-](F)(F)(F)(F)F', 'F[As-](F)(F)(F)(F)F',
  '[O-]Cl(=O)(=O)=O', '[O-][N+](=O)[O-]', 'OS(=O)(=O)[O-]',
  '[O-]S(=O)(=O)[O-]', 'OS(=O)(=O)O', '[O-]C([O-])=O', 'OC(=O)[O-]', '[OH-]', '[H+]',
  'COS(=O)(=O)[O-]', '[O-]S(=O)(=O)C(F)(F)F', 'OS(=O)(=O)C(F)(F)F',
  'O=S(=O)([N-]S(=O)(=O)C(F)(F)F)C(F)(F)F', '[O-]C(=O)C(F)(F)F', 'OC(=O)C(F)(F)F',
  'CS(=O)(=O)[O-]', 'CS(=O)(=O)O', 'Cc1ccc(S(=O)(=O)[O-])cc1', 'Cc1ccc(S(=O)(=O)O)cc1',
  'FC(F)(F)c1cc(cc(c1)C(F)(F)F)[B-](c1cc(cc(c1)C(F)(F)F)C(F)(F)F)(c1cc(cc(c1)C(F)(F)F)C(F)(F)F)c1cc(cc(c1)C(F)(F)F)C(F)(F)F',
  'Fc1c(F)c(F)c([B-](c2c(F)c(F)c(F)c(F)c2F)(c2c(F)c(F)c(F)c(F)c2F)c2c(F)c(F)c(F)c(F)c2F)c(F)c1F',
  'c1ccc([B-](c2ccccc2)(c2ccccc2)c2ccccc2)cc1',
  '[Li+]', '[Na+]', '[K+]', '[Rb+]', '[Cs+]', '[NH4+]',
  'C[N+](C)(C)C', 'CC[N+](CC)(CC)CC', 'CCCC[N+](CCCC)(CCCC)CCCC', 'CC[NH+](CC)CC', 'CC[NH+](C(C)C)C(C)C',
  'c1ccc(cc1)P(c1ccccc1)(c1ccccc1)=[N+]=P(c1ccccc1)(c1ccccc1)c1ccccc1',
  'c1ccc(cc1)[P+](c1ccccc1)(c1ccccc1)N=P(c1ccccc1)(c1ccccc1)c1ccccc1',
  'c1ccc(cc1)[P+](c1ccccc1)(c1ccccc1)[N-][P+](c1ccccc1)(c1ccccc1)c1ccccc1',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
const PLAIN = JSON.stringify({ isomericSmiles: false });
const counterKeys = new WeakMap<object, Set<string>>();
function counterIonKeys(RDKit: any): Set<string> {
  let keys = counterKeys.get(RDKit);
  if (keys) return keys;
  keys = new Set();
  for (const smi of COUNTER_ION_SMILES) {
    const m = RDKit.get_mol(smi);
    if (m?.is_valid()) keys.add(m.get_smiles(PLAIN));
    m?.delete?.();
  }
  counterKeys.set(RDKit, keys);
  return keys;
}

interface JAtom { z: number; isotope: number; impHs: number; chg: number }

function readJson(json: string): { atoms: JAtom[]; bonds: [number, number, number][]; cip: Set<number> } {
  const j = JSON.parse(json);
  const da = j.defaults?.atom ?? {}, db = j.defaults?.bond ?? {};
  const mol = j.molecules[0];
  const ext = (mol.extensions ?? []).find((e: any) => e.name === 'rdkitRepresentation') ?? {};
  const aromatic = new Set<number>(ext.aromaticBonds ?? []);
  const atoms: JAtom[] = mol.atoms.map((a: any) => ({ z: a.z ?? da.z ?? 6, isotope: a.isotope ?? da.isotope ?? 0, impHs: a.impHs ?? da.impHs ?? 0, chg: a.chg ?? da.chg ?? 0 }));
  const bonds: [number, number, number][] = (mol.bonds ?? []).map((b: any, i: number) => [b.atoms[0], b.atoms[1], aromatic.has(i) ? 1.5 : b.bo ?? db.bo ?? 1]);
  // (the atoms RDKit labelled R or S, from the drawing's wedges)
  const cip = new Set<number>((ext.cipCodes ?? []).map((c: [number, string]) => c[0]));
  return { atoms, bonds, cip };
}

function countsOf(atoms: JAtom[]): Counts {
  const c: Counts = new Map();
  const bump = (k: string, n: number): void => { c.set(k, (c.get(k) ?? 0) + n); };
  for (const a of atoms) {
    if (a.impHs) bump('H', a.impHs);
    if (a.z === 1 && (a.isotope === 2 || a.isotope === 3)) bump(a.isotope === 2 ? 'D' : 'T', 1);
    else bump(isoKey(SYMBOLS[a.z], a.isotope), 1);
  }
  return c;
}

function infoOf(atoms: JAtom[], mw: number, smiles: string): MolInfo {
  const counts = countsOf(atoms);
  return {
    formula: hillFormula(counts), mw, exact: countsMass(counts), charge: atoms.reduce((s, a) => s + a.chg, 0),
    elements: new Set([...counts.keys()].map((k) => { const s = splitKey(k)[0]; return s === 'D' || s === 'T' ? 'H' : s; })), smiles, counts,
  };
}

/** Sort signatures and number them: each atom's class (a Map, so a big structure is quick: G4-08). */
function relabel(sigs: string[]): number[] {
  const index = new Map([...new Set(sigs)].sort().map((x, i) => [x, i]));
  return sigs.map((x) => index.get(x)!);
}
const classCount = (cls: number[]): number => new Set(cls).size;

/** Refine classes with the neighbours' classes and bond orders until no class splits any more. */
function refine(nb: [number, number][][], start: string[]): number[] {
  let cls = relabel(start);
  for (;;) {
    const next = relabel(cls.map((c, i) => c + '|' + nb[i].map(([j, o]) => `${o}:${cls[j]}`).sort().join(';')));
    if (classCount(next) === classCount(cls)) return next;
    cls = next;
  }
}

/**
 * Symmetry classes (≈ NMR-distinct atoms): (element, isotope, charge, degree, H) refined with the
 * neighbours' classes and bond orders, and then diastereotopic atoms told apart.
 *
 * Two alike atoms on the same tetrahedral atom X whose other two ligands differ (the CH₃ pair of
 * an isopropyl group on menthol's ring, camphor's gem-dimethyl pair, the C2/C6 pair of a
 * cyclohexyl ring on a stereocentre) are diastereotopic when the structure has a stereocentre
 * besides X: swapping either for a test group gives diastereomers, so they give two signals
 * (Mislow & Raban, Top. Stereochem. 1967, 1, 1; Eliel & Wilen, Stereochemistry of Organic
 * Compounds, 1994, ch. 8). Each pair is split and the classes refined again, so the atoms beyond
 * them split too. A stereocentre is one RDKit gave R or S (`cip`, from wedges) or an atom with four
 * different ligands whether drawn with wedges or not (a structure drawn flat is still chiral).
 * Not caught: a pair on a mirror plane of a meso structure (it is enantiotopic, so one signal),
 * which is counted as two.
 */
export function symmetryClasses(atoms: JAtom[], bonds: [number, number, number][], cip: Set<number> = new Set()): number[] {
  const nb: [number, number][][] = atoms.map(() => []);
  for (const [a, b, o] of bonds) { nb[a].push([b, o]); nb[b].push([a, o]); }
  const start = atoms.map((a, i) => [a.z, a.isotope, a.chg, nb[i].length, a.impHs].join(','));
  let cls = refine(nb, start);
  // the structure's pieces (a stereocentre in a counter-ion doesn't make the cation's pairs differ)
  const piece = new Int32Array(atoms.length).fill(-1);
  atoms.forEach((_, s) => {
    if (piece[s] >= 0) return;
    const todo = [s];
    piece[s] = s;
    while (todo.length) { const v = todo.pop()!; for (const [w] of nb[v]) if (piece[w] < 0) { piece[w] = s; todo.push(w); } }
  });
  // (four ligands: the atoms bonded, and its hydrogens counted as one more kind)
  const tetrahedral = (i: number): boolean => nb[i].length + atoms[i].impHs === 4 && atoms[i].impHs <= 1;
  const stereocentre = (i: number): boolean => cip.has(i) || (tetrahedral(i) && new Set(nb[i].map(([j]) => cls[j])).size === nb[i].length);
  // Every such pair found is split at once (one of each marked), then the classes refined again:
  // pairs related by the structure's own symmetry stay alike (a C₂-symmetric structure's two
  // isopropyl groups give two CH₃ signals, not four). Splits can make new pairs, so again until none.
  for (let round = 0; round < 20; round++) {
    const centre = atoms.map((_, i) => stereocentre(i));
    const centresIn = new Map<number, number>();
    centre.forEach((c, i) => { if (c) centresIn.set(piece[i], (centresIn.get(piece[i]) ?? 0) + 1); });
    if (!centresIn.size) return cls;
    const marked = new Set<number>();
    for (let x = 0; x < atoms.length; x++) {
      // (X must not be a stereocentre itself, and its piece must have one)
      if (!tetrahedral(x) || centre[x] || !centresIn.get(piece[x])) continue;
      // a pair alike, and the other two ligands different (one may be X's hydrogen)
      const byClass = new Map<number, number[]>();
      for (const [j] of nb[x]) byClass.set(cls[j], [...(byClass.get(cls[j]) ?? []), j]);
      const pair = [...byClass.values()].find((l) => l.length === 2);
      if (pair && byClass.size === nb[x].length - 1) marked.add(pair[1]);
    }
    if (!marked.size) return cls;
    cls = refine(nb, cls.map((c, i) => `${c}${marked.has(i) ? ',d' : ''}`));
  }
  return cls;
}

/** The atoms of each piece (bonded together), in atom order. */
function graphPieces(atoms: JAtom[], bonds: [number, number, number][]): number[][] {
  const nb: number[][] = atoms.map(() => []);
  for (const [a, b] of bonds) { nb[a].push(b); nb[b].push(a); }
  const seen = new Uint8Array(atoms.length);
  const out: number[][] = [];
  atoms.forEach((_, s) => {
    if (seen[s]) return;
    const part: number[] = [];
    const todo = [s];
    seen[s] = 1;
    while (todo.length) { const v = todo.pop()!; part.push(v); for (const w of nb[v]) if (!seen[w]) { seen[w] = 1; todo.push(w); } }
    out.push(part.sort((x, y) => x - y));
  });
  return out;
}

/** Whether a structure (or piece) may have a run of atoms too long for the engine's SMILES writer (engine-guard.ts). */
const tooDeepGraph = (atoms: JAtom[], bonds: [number, number, number][]): boolean =>
  atoms.length > DEEP_LIMIT && longestPathBound({ n: atoms.length, edges: bonds.map(([a, b]) => [a, b]) }) > DEEP_LIMIT;

/** What the checks need of a structure (a molfile), from RDKit; null when RDKit can't read it. */
export function molFacts(RDKit: any, molblock: string): MolFacts | null {
  const generic = genericAtoms(molblock);
  const mol = RDKit.get_mol(molblock);
  if (!mol?.is_valid()) { mol?.delete?.(); return generic.length ? { info: null, generic, pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0 } : null; }
  try {
    const { atoms, bonds, cip } = readJson(mol.get_json());
    const nb: number[][] = atoms.map(() => []);
    for (const [a, b] of bonds) { nb[a].push(b); nb[b].push(a); }
    let hTotal = 0, hExch = 0;
    const nos = (z: number): boolean => z === 7 || z === 8 || z === 16;
    atoms.forEach((a, i) => {
      if (a.z === 1) {
        if (a.isotope === 2 || a.isotope === 3) return;
        hTotal++;
        if (nb[i].some((j) => nos(atoms[j].z))) hExch++;
      } else {
        hTotal += a.impHs;
        if (nos(a.z)) hExch += a.impHs;
      }
    });
    const cls = symmetryClasses(atoms, bonds, cip);
    const uniqueCarbons = new Set(atoms.flatMap((a, i) => (a.z === 6 ? [cls[i]] : []))).size;
    if (generic.length || atoms.some((a) => a.z === 0)) return { info: null, generic: generic.length ? generic : ['R'], pieces: [], uniqueCarbons, hTotal, hExch };
    const mw = JSON.parse(mol.get_descriptors()).amw as number;
    let info: MolInfo;
    try {
      // (a run of atoms too long for the engine's SMILES writer: no SMILES, see engine-guard.ts)
      info = infoOf(atoms, mw, tooDeepGraph(atoms, bonds) ? '' : mol.get_smiles());
    } catch (e) {
      if (!(e instanceof ChemError)) throw e;
      return { info: null, generic: [], pieces: [], uniqueCarbons, hTotal, hExch, error: `No formula or masses can be calculated for this structure: ${e.message} Type the M formula in the HRMS field (✎) if you need the calculated m/z.` };
    }
    // the pieces (a salt's cation and anion), each once, the largest first; a structure with a run
    // of atoms too long for the engine is split here from its graph, as RDKit's get_frags (and its
    // SMILES) hang or break on it (a 600-atom fused ring system hangs get_frags: engine-guard.ts)
    const deep = tooDeepGraph(atoms, bonds);
    const seen = new Map<string, { heavy: number; piece: Piece }>();
    if (deep) {
      graphPieces(atoms, bonds).forEach((part, k) => {
        const sub = part.map((i) => atoms[i]);
        seen.set(`#${k}`, { heavy: sub.filter((a) => a.z > 1).length, piece: { smiles: '', info: infoFromCounts(countsOf(sub), sub.reduce((t, a) => t + a.chg, 0)), counterIon: false } });
      });
    } else {
      const keys = counterIonKeys(RDKit);
      const frags = mol.get_frags();
      try {
        for (let k = 0; k < frags.molList.size(); k++) {
          const f = frags.molList.at(k);
          try {
            const smi = f.get_smiles();
            if (seen.has(smi)) continue;
            const fj = readJson(f.get_json());
            const fmw = JSON.parse(f.get_descriptors()).amw as number;
            seen.set(smi, { heavy: fj.atoms.filter((a) => a.z > 1).length, piece: { smiles: smi, info: infoOf(fj.atoms, fmw, smi), counterIon: keys.has(f.get_smiles(PLAIN)) } });
          } finally {
            f.delete();
          }
        }
      } finally {
        frags.molList.delete?.();
      }
    }
    const pieces = [...seen.values()].map((x, i) => ({ ...x, i })).sort((a, b) => b.heavy - a.heavy || a.i - b.i).map((x) => x.piece);
    let inchikey = '';
    // (no InChI for a run of atoms that long: InChI hangs on a big fused ring system, and caps at 1,024 atoms anyway)
    if (!deep) try {
      const inchi = mol.get_inchi();
      if (inchi) inchikey = RDKit.get_inchikey_for_inchi(inchi);
    } catch { inchikey = ''; }
    return { info, generic: [], pieces, uniqueCarbons, hTotal, hExch, inchikey };
  } finally {
    mol.delete();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Generic atoms of a V2000 molfile, as drawn: R1, R2 (R# with its number), R, X, A, Q, M… */
export function genericAtoms(molblock: string): string[] {
  const lines = molblock.split(/\r?\n/);
  const counts = lines[3] ?? '';
  const n = Number(counts.slice(0, 3));
  if (!Number.isFinite(n) || /V3000/.test(counts)) return [];
  const rgp = new Map<number, number>();
  for (const l of lines) {
    if (!l.startsWith('M  RGP')) continue;
    const f = l.slice(6).trim().split(/\s+/).map(Number);
    for (let k = 1; k + 1 < f.length; k += 2) rgp.set(f[k], f[k + 1]);
  }
  const out = new Set<string>();
  for (let i = 0; i < n; i++) {
    const sym = (lines[4 + i] ?? '').slice(31, 34).trim();
    if (sym === 'R#') out.add(rgp.has(i + 1) ? `R${rgp.get(i + 1)}` : 'R');
    else if (sym === 'R' || sym === '*') out.add('R');
    else if (['A', 'Q', 'X', 'M', 'L', 'AH', 'QH', 'XH', 'MH'].includes(sym)) out.add(sym);
  }
  return [...out].sort();
}

/** Index of the automatic M of a salt: the largest piece that isn't a common counter-ion (else the largest). */
export const mainSpecies = (pieces: Piece[]): number => Math.max(0, pieces.findIndex((p) => !p.counterIon));
