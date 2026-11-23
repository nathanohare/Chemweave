// Raise Charge Digits (F8a; Nate's answer to F2 Needs Nate "formula charges"): formula style lowers
// every number, as ChemDraw does, so Fe3+ shows as Fe₃⁺ and SO42- as SO₄₂⁻; text alone can't tell a
// count from a charge. This command, run on selected text, raises the charge's digits before a
// final + or − sign the way chemists write the ion (Fe³⁺, SO₄²⁻), and the sign with them.
//
// Which digits are the charge's:
// - after a closing square bracket, all of them: the bracket closes the formula ([Fe(CN)₆]⁴⁻,
//   [M+10H]¹⁰⁺);
// - after an element, a group's ")" or anything else, the last digit only: a count may have
//   several digits but a charge on a formula written out is a single digit (SO₄²⁻, B₁₂H₁₂²⁻,
//   Cr₂O₇²⁻), and where it is ambiguous (Fe3+, N3-) the last digit is the one raised.
// Nothing else in the text changes. A sign counts as final when no letter or digit follows it
// (Red-Al and the ranges of C8-12 are left alone).

import type { FixEdit } from './chemtext';

/** Characters a formula's digits can follow: a letter, a closing bracket, or a prime. */
const FORMULA_BEFORE = /[A-Za-z)\]}′']/;

/**
 * The changes Raise Charge Digits makes to `text` between `from` and `to`: each charge's digits and
 * sign raised, where `isUp(i)` says whether character i already sits raised (it is then left as it is).
 */
export function chargeDigitEdits(text: string, isUp: (i: number) => boolean, from = 0, to = text.length): FixEdit[] {
  const out: FixEdit[] = [];
  const raise = (i: number) => { if (!isUp(i)) out.push({ start: i, end: i + 1, pos: 'sup' }); };
  for (const m of text.matchAll(/(\d+)([+\-−])(?![A-Za-z0-9])/g)) {
    const at = m.index!;
    const sign = at + m[1].length;
    if (sign < from || sign >= to) continue;
    const prev = text[at - 1];
    if (prev === undefined || !FORMULA_BEFORE.test(prev)) continue;
    const n = prev === ']' ? m[1].length : 1;
    for (let i = sign - n; i < sign; i++) if (i >= from) raise(i);
    raise(sign);
  }
  return out;
}
