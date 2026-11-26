// The automatic formatting of SI text, as Chem SI Assistant does it when it compiles
// (compile/text.py): subscripts in formulas and deuterated solvents, ¹H and ¹³C before "NMR",
// an italic J, en dashes in ranges, "400 MHz" spaced. It works on runs of the stored text
// format (markup.ts), splitting plain runs where a format starts.

import type { Run, VAlign } from './markup';
import { DEUTERATED, DEUTERATED_PREFIX, NUCLEUS, allMatches, formulaMatches, rangeMatches, type Found } from './chemtext';
import { after, notAfter } from '../regex-behind';

const vOf = (r: Run): VAlign => r.valign ?? 'normal';

/** A run with only the formatting that is set (as the stored format writes runs). */
export function R(text: string, look: { bold?: boolean; italic?: boolean; underline?: boolean; valign?: VAlign; ref?: string; link?: string; src?: string } = {}): Run {
  const r: Run = { text };
  if (look.bold) r.bold = true;
  if (look.italic) r.italic = true;
  if (look.underline) r.underline = true;
  if (look.valign && look.valign !== 'normal') r.valign = look.valign;
  if (look.ref) r.ref = look.ref;
  if (look.link) r.link = look.link;
  if (look.src) r.src = look.src;
  return r;
}

/** The same formatting (links never join, nor text from different places). */
export const sameFormat = (a: Run, b: Run): boolean => !a.ref && !b.ref && a.link === b.link && a.src === b.src && !!a.bold === !!b.bold && !!a.italic === !!b.italic && vOf(a) === vOf(b) && !!a.underline === !!b.underline;

/** A copy with some of it changed. */
export const but = (r: Run, change: Partial<Run>): Run => R(change.text ?? r.text, { bold: change.bold ?? r.bold, italic: change.italic ?? r.italic, underline: change.underline ?? r.underline, valign: change.valign ?? r.valign, ref: change.ref ?? r.ref, link: change.link ?? r.link, src: change.src ?? r.src });

export const plain = (runs: readonly Run[]): string => runs.map((r) => r.text).join('');

/** Runs next to each other with the same formatting joined. */
export function mergeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && sameFormat(last, r)) out[out.length - 1] = but(r, { text: last.text + r.text });
    else out.push(r);
  }
  return out;
}

/** Apply `make(match)` to every match `find` gives in the plain runs (not super/subscripts, not links). */
function split(runs: readonly Run[], find: (text: string) => Found[], make: (m: Found) => Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (vOf(run) !== 'normal' || run.ref) { out.push(run); continue; }
    const keep = { bold: run.bold, italic: run.italic, underline: run.underline, src: run.src };
    let pos = 0;
    for (const m of find(run.text)) {
      if (m.start > pos) out.push(R(run.text.slice(pos, m.start), keep));
      for (const piece of make(m)) out.push(R(piece.text, { bold: run.bold || piece.bold, italic: run.italic || piece.italic, valign: piece.valign, underline: run.underline || piece.underline, src: run.src }));
      pos = m.end;
    }
    if (pos < run.text.length) out.push(R(run.text.slice(pos), keep));
  }
  return out.filter((r) => r.text || r.ref);
}

const J = notAfter(/J(?=\s*(?:=|\d|[A-Z]?[A-Z]?\s*=))/g, /[A-Za-z]/);
const HZ = after(/(Hz|MHz)\b/g, /\d/);

/** Words to print as written (the project's dictionary.txt): formulas among them are not subscripted. */
export interface Leave { words: ReadonlySet<string> }
const NO_WORDS: Leave = { words: new Set() };

function formulaPieces(m: Found): Run[] {
  return (m.groups[0].match(/\d+|[^\d]+/g) ?? []).map((part) => R(part, { valign: /^\d+$/.test(part) ? 'sub' : 'normal' }));
}

/** Subscripts in formulas (CDCl3 → CDCl₃, Na2SO4, Et3N) and deuterated solvents (DMSO-d6 → DMSO-d₆). */
export function formatChemistry(runs: readonly Run[], leave: Leave = NO_WORDS): Run[] {
  let out = split(runs, (t) => allMatches(DEUTERATED, t).filter((m) => !leave.words.has(m.groups[0].toLowerCase())),
    (m) => [R(`${m.groups[1]}-`), R('d', { italic: true }), R(m.groups[2], { valign: 'sub' })]);
  out = split(out, (t) => allMatches(DEUTERATED_PREFIX, t), (m) => [R('d', { italic: true }), R(m.groups[1], { valign: 'sub' }), R('-')]);
  return split(out, (t) => formulaMatches(t, leave.words), formulaPieces);
}

/** For NMR text: ¹H/¹³C superscripts, italic J, en dashes in ranges, "400MHz" spaced, and the chemistry formatting. */
export function formatNmr(runs: readonly Run[], leave: Leave = NO_WORDS): Run[] {
  let out = split(runs, (t) => allMatches(NUCLEUS, t), (m) => [R(m.groups[1], { valign: 'super' }), R(m.groups[2])]);
  out = split(out, (t) => allMatches(J, t), () => [R('J', { italic: true })]);
  out = split(out, rangeMatches, () => [R('–')]);
  out = split(out, (t) => allMatches(HZ, t), (m) => [R(' ' + m.groups[1])]);
  return formatChemistry(out, leave);
}

/** A Hill formula as runs: digits subscripted, isotope labels ([13C]) superscripted. */
export function formulaRuns(formula: string): Run[] {
  const out: Run[] = [];
  for (const m of formula.matchAll(/\[(\d+)([A-Z][a-z]?)\]|([A-Z][a-z]?)|(\d+)/g)) {
    if (m[1]) out.push(R(m[1], { valign: 'super' }), R(m[2]));
    else if (m[4]) out.push(R(m[4], { valign: 'sub' }));
    else out.push(R(m[3]));
  }
  return mergeRuns(out);
}

/**
 * An adduct like "[M+H]+" or "[M]+." with the charge as superscript (the radical as •). Atom counts
 * in the brackets are subscripted ([M+NH4]⁺ → NH₄, [M−BF4]⁺ → BF₄); a number of molecules or pieces
 * is not ([2M+Na]⁺, [M+2H]²⁺, [M−2Br]²⁺), as SI Assistant's charge_runs.
 */
export function chargeRuns(display: string): Run[] {
  const m = /^(\[.*\])(\d*[+\-−][•·.]?)$/.exec(display.trim());
  if (!m) return [R(display)];
  const charge = m[2].replace(/-/g, '−').replace(/\./g, '•').replace(/·/g, '•');
  const body = m[1].replace(/-/g, '−').split(after(/(\d+)/, /[A-Za-z)]/)).flatMap((part, i) => (part ? [i % 2 ? R(part, { valign: 'sub' }) : R(part)] : []));
  return [...body, R(charge, { valign: 'super' })];
}

const SUB_CHARS = '₀₁₂₃₄₅₆₇₈₉₊₋';
const SUP_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻';
const PLAIN = '0123456789+−';

/**
 * Subscript and superscript characters typed as such (SiO₂, ¹H) as plain digits in subscript or
 * superscript runs, so they print in any font (a document's fonts often lack ₂ and ¹).
 */
export function scriptCharacters(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (r.ref || !/[₀-₉₊₋⁰¹²³⁴-⁹⁺⁻]/.test(r.text)) { out.push(r); continue; }
    let buf = '', kind: VAlign = vOf(r);
    const flush = (): void => { if (buf) out.push(but(r, { text: buf, valign: kind })); buf = ''; };
    for (const ch of r.text) {
      const sub = SUB_CHARS.indexOf(ch), sup = SUP_CHARS.indexOf(ch);
      const k: VAlign = sub >= 0 ? 'sub' : sup >= 0 ? 'super' : vOf(r);
      if (k !== kind) { flush(); kind = k; }
      buf += sub >= 0 ? PLAIN[sub] : sup >= 0 ? PLAIN[sup] : ch;
    }
    flush();
  }
  return out;
}
