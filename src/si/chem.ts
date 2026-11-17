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
// Atomic Mass Evaluation); the electron mass is CODATA 2018 (chem/hrms.ts).

import { ISOTOPES } from '../chem/analysis';
import { ELECTRON } from '../chem/hrms';
import { elementNumber, SYMBOLS } from '../chem/elements';

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

/** An element's natural isotopes: [mass number, mass, fraction], the most common first. */
export function naturalIsotopes(sym: string): [number, number, number][] {
  const list = ISOTOPES[sym];
  if (!list?.length) throw new ChemError(`There is no isotope data for “${sym}”.`);
  const top = list.reduce((a, b) => (b[1] > a[1] ? b : a));
  const all = list.filter((x) => x[1] > 0).map(([mass, pct]) => [Math.round(mass), mass, pct / 100] as [number, number, number]);
  return [...all.filter((x) => x[1] === top[0]), ...all.filter((x) => x[1] !== top[0])];
}

function isotopeMass(sym: string, massNumber: number): number | null {
  if (sym === 'H' && massNumber === 2) return ISOTOPES.D[0][0];
  const hit = (ISOTOPES[sym] ?? []).find(([m]) => Math.round(m) === massNumber);
  return hit ? hit[0] : null;
}

function atomMass(sym: string, iso: number): number {
  if (sym === 'D') return ISOTOPES.D[0][0];
  if (sym === 'T') throw new ChemError('Tritium (T) has no mass in the isotope table.');
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
  return total ? list.reduce((s, [m, p]) => s + m * p, 0) / total : 0;
}

export function countsMass(counts: Counts): number {
  let m = 0;
  for (const [k, n] of counts) { const [s, i] = splitKey(k); m += atomMass(s, i) * n; }
  return m;
}

/** Hill order: C, then H (D, T), then the rest alphabetically; isotope labels in brackets: [13C]. */
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
  const order = (hasC ? ['C', '[13C]', 'H', 'D', 'T'] : []).filter((k) => merged.has(k));
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

const SIGNS = '+\\-−–⁺⁻';
const DIGITS = `0-9${SUPER}`;
const RADICAL = '•·.';
const TYPED_CHARGE = new RegExp(`(?<n>[${SUPER}]*)(?<signs>[+\\-−–⁺⁻]+)(?<n2>[${SUPER}]*)$`);
const EXPLICIT_CHARGE = [
  new RegExp(`\\(\\s*(?<n>[${DIGITS}]*)\\s*(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)\\s*\\)$`),
  new RegExp(`\\^\\s*(?<n>[${DIGITS}]*)\\s*(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)$`),
  new RegExp(`\\s+(?<n>[${DIGITS}]*)\\s*(?<signs>[${SIGNS}]+)\\s*(?<n2>[${DIGITS}]*)$`),
  new RegExp(`(?<n>)(?<signs>[${SIGNS}])(?<n2>[0-9]+)$`),
];
const BRACKETED_ION = new RegExp(`^\\[(?<f>[A-Z].*)\\][${RADICAL}]?(?<n>[${DIGITS}]*)(?<signs>[${SIGNS}]+)(?<n2>[${DIGITS}]*)$`);
const CHARGE_HINT = 'Write a charge at the end of the formula, as in C₁₀H₈N₂²⁺, C10H8N2++, C10H8N2 2+ or C6H6+•.';

function chargeFrom(g: Record<string, string>, text: string): number {
  const signs = g.signs.replace(/[−–]/g, '-').replace(/⁺/g, '+').replace(/⁻/g, '-');
  if (new Set(signs).size === 2) throw new ChemError(`The charge at the end of “${text.trim()}” has both + and −.`);
  const digits = superToPlain(g.n + g.n2);
  if (digits && (signs.length > 1 || (g.n && g.n2))) throw new ChemError(`The charge at the end of “${text.trim()}” can't be read: write it as ²⁺ or ++, not both.`);
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
    return [labelledFormula(cleaned), charge];
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

function computePattern(info: MolInfo, adductLabel: string, minPercent: number, maxPeaks: number): Peak[] {
  const adduct = parseAdduct(adductLabel);
  const counts = ionCounts(info, adduct);
  let fixedMass = 0;
  const fixed: Counts = new Map();
  // {heavy-isotope composition: [mass, probability]}, the composition as "sym:iso:n;…"
  let states = new Map<string, [number, number]>([['', [0, 1]]]);
  const entries = [...counts].map(([k, n]) => [splitKey(k), n] as [[string, number], number]).sort((a, b) => cmp(a[0][0], b[0][0]) || a[0][1] - b[0][1]);
  for (const [[sym, iso], n] of entries) {
    if (iso || sym === 'D' || sym === 'T') {
      fixed.set(isoKey(sym, iso), (fixed.get(isoKey(sym, iso)) ?? 0) + n);
      fixedMass += atomMass(sym, iso) * n;
      continue;
    }
    const isotopes = naturalIsotopes(sym);
    // the n atoms over the isotopes, atom by atom
    let element = new Map<string, number>([[isotopes.map(() => 0).join(','), 1]]);
    for (let a = 0; a < n; a++) {
      const next = new Map<string, number>();
      for (const [comp, p] of element) {
        const c = comp.split(',').map(Number);
        isotopes.forEach(([, , frac], k) => {
          c[k]++;
          const kk = c.join(',');
          next.set(kk, (next.get(kk) ?? 0) + p * frac);
          c[k]--;
        });
      }
      let top = 0;
      for (const p of next.values()) if (p > top) top = p;
      element = new Map([...next].filter(([, p]) => p >= top * PRUNE));
    }
    const combined = new Map<string, [number, number]>();
    for (const [key, [mass, p]] of states) {
      for (const [comp, q] of element) {
        const c = comp.split(',').map(Number);
        const heavy = c.map((x, k) => (k && x ? `${sym}:${isotopes[k][0]}:${x}` : '')).filter(Boolean).join(';');
        const m = mass + c.reduce((s, x, k) => s + x * isotopes[k][1], 0);
        combined.set(key && heavy ? `${key};${heavy}` : key || heavy, [m, p * q]);
      }
    }
    let top = 0;
    for (const [, p] of combined.values()) if (p > top) top = p;
    states = new Map([...combined].filter(([, v]) => v[1] >= top * PRUNE));
  }
  let top = 0;
  for (const [, p] of states.values()) if (p > top) top = p;
  const out: Peak[] = [];
  for (const [heavy, [mass, p]] of states) {
    const percent = (p / top) * 100;
    if (percent < minPercent) continue;
    const fc: Counts = new Map(fixed);
    for (const [k, n] of counts) { const [s, i] = splitKey(k); if (!i && s !== 'D' && s !== 'T') fc.set(k, (fc.get(k) ?? 0) + n); }
    if (heavy) {
      for (const part of heavy.split(';')) {
        const [s, i, c] = part.split(':');
        fc.set(s, (fc.get(s) ?? 0) - Number(c));
        fc.set(isoKey(s, Number(i)), (fc.get(isoKey(s, Number(i))) ?? 0) + Number(c));
      }
    }
    out.push({ mz: (mass + fixedMass - adduct.charge * ELECTRON) / Math.abs(adduct.charge), abundance: percent, formula: hillFormula(fc), mono: !heavy });
  }
  const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
  out.sort((a, b) => r6(b.abundance) - r6(a.abundance) || a.mz - b.mz);
  return out.slice(0, maxPeaks);
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
}

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

function readJson(json: string): { atoms: JAtom[]; bonds: [number, number, number][] } {
  const j = JSON.parse(json);
  const da = j.defaults?.atom ?? {}, db = j.defaults?.bond ?? {};
  const mol = j.molecules[0];
  const ext = (mol.extensions ?? []).find((e: any) => e.name === 'rdkitRepresentation') ?? {};
  const aromatic = new Set<number>(ext.aromaticBonds ?? []);
  const atoms: JAtom[] = mol.atoms.map((a: any) => ({ z: a.z ?? da.z ?? 6, isotope: a.isotope ?? da.isotope ?? 0, impHs: a.impHs ?? da.impHs ?? 0, chg: a.chg ?? da.chg ?? 0 }));
  const bonds: [number, number, number][] = (mol.bonds ?? []).map((b: any, i: number) => [b.atoms[0], b.atoms[1], aromatic.has(i) ? 1.5 : b.bo ?? db.bo ?? 1]);
  return { atoms, bonds };
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

/** Symmetry classes by refining (element, isotope, charge, degree, H) with the neighbours' classes and bond orders; stereo ignored. */
export function symmetryClasses(atoms: JAtom[], bonds: [number, number, number][]): number[] {
  const nb: [number, number][][] = atoms.map(() => []);
  for (const [a, b, o] of bonds) { nb[a].push([b, o]); nb[b].push([a, o]); }
  const relabel = (sigs: string[]): number[] => { const u = [...new Set(sigs)].sort(); return sigs.map((s) => u.indexOf(s)); };
  let cls = relabel(atoms.map((a, i) => [a.z, a.isotope, a.chg, nb[i].length, a.impHs].join(',')));
  for (;;) {
    const next = relabel(cls.map((c, i) => c + '|' + nb[i].map(([j, o]) => `${o}:${cls[j]}`).sort().join(';')));
    if (new Set(next).size === new Set(cls).size) return next;
    cls = next;
  }
}

/** What the checks need of a structure (a molfile), from RDKit; null when RDKit can't read it. */
export function molFacts(RDKit: any, molblock: string): MolFacts | null {
  const generic = genericAtoms(molblock);
  const mol = RDKit.get_mol(molblock);
  if (!mol?.is_valid()) { mol?.delete?.(); return generic.length ? { info: null, generic, pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0 } : null; }
  try {
    const { atoms, bonds } = readJson(mol.get_json());
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
    const cls = symmetryClasses(atoms, bonds);
    const uniqueCarbons = new Set(atoms.flatMap((a, i) => (a.z === 6 ? [cls[i]] : []))).size;
    if (generic.length || atoms.some((a) => a.z === 0)) return { info: null, generic: generic.length ? generic : ['R'], pieces: [], uniqueCarbons, hTotal, hExch };
    const mw = JSON.parse(mol.get_descriptors()).amw as number;
    const info = infoOf(atoms, mw, mol.get_smiles());
    // the pieces (a salt's cation and anion), each once, the largest first
    const keys = counterIonKeys(RDKit);
    const seen = new Map<string, { heavy: number; piece: Piece }>();
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
    const pieces = [...seen.values()].map((x, i) => ({ ...x, i })).sort((a, b) => b.heavy - a.heavy || a.i - b.i).map((x) => x.piece);
    return { info, generic: [], pieces, uniqueCarbons, hTotal, hExch };
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
