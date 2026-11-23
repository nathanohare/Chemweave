// Raise Charge Digits (F8a; Nate's answer to F2 Needs Nate "formula charges"): formula style lowers
// every number, as ChemDraw does, so Fe3+ shows as Fe₃⁺ and SO42- as SO₄₂⁻; text alone can't always
// tell a count from a charge. This command, run on selected text, raises the charge's digits before
// a final + or − sign the way chemists write the ion (Fe³⁺, SO₄²⁻), and the sign with them.
//
// How the digits right before a final sign are read (IUPAC Red Book 2005, IR-3.4 and IR-4.4.2.2:
// the charge goes after the formula as a right superscript, its number before its sign, and a
// count of 1 or a charge of 1 is not written; a charge's digit is never 0):
// - after a closing square bracket: all of them are the charge, the bracket closing the formula
//   ([Fe(CN)6]4- → [Fe(CN)₆]⁴⁻, [Co(NH3)6]3+, [M+10H]10+);
// - two or more digits after an element or a ")": the last one is the charge and the rest the
//   count before it (SO42- → SO₄²⁻, PO43-, Cr2O72-, S2O82-, Hg22+, B12H122-, Fe(CN)63-);
//   if that last digit is 0 it is all count and nothing is raised (C60-);
// - one digit after a formula of two or more elements, or after a ")": it is the count of what
//   comes before it and the charge is 1, so nothing is raised (NH4+, BF4-, PF6-, NO3-, ClO4-,
//   HSO4-, H2PO4-, MnO4-, CH3+, NBu4+);
// - one digit after a lone metal: the charge, a metal atom having no count in a simple ion
//   (Fe3+ → Fe³⁺, Ca2+, Al3+, Cu2+);
// - one digit after a lone non-metal: it can't tell (N3- is nitride N³⁻ or azide N₃⁻, O2- oxide
//   O²⁻ or superoxide O₂⁻, I3- triiodide I₃⁻), so it leaves it and says why (chargeNote).
// Nothing else in the text changes. A sign counts as final when no letter or digit follows it
// (Red-Al and the ranges of C8-12 are left alone).

import type { FixEdit } from './chemtext';
import { elementNumber } from '../chem/elements';

/** The non-metals (and metalloids that form anions), whose lone-digit ions are ambiguous. */
const NON_METALS = new Set(['H', 'He', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Si', 'P', 'S', 'Cl', 'Ar', 'As', 'Se', 'Br', 'Kr', 'Te', 'I', 'Xe', 'At', 'Rn']);

/** Why the last run left an ion as it was ('' when it left none): for the status bar. */
export const chargeNote = { text: '' };

/**
 * The changes Raise Charge Digits makes to `text` between `from` and `to`: each charge's digits and
 * sign raised, where `isUp(i)` says whether character i already sits raised (it is then left as it
 * is). Sets chargeNote to the reason when it leaves an ion it can't read.
 */
export function chargeDigitEdits(text: string, isUp: (i: number) => boolean, from = 0, to = text.length): FixEdit[] {
  const out: FixEdit[] = [];
  const unsure: string[] = [];
  chargeNote.text = '';
  const raise = (i: number) => { if (!isUp(i)) out.push({ start: i, end: i + 1, pos: 'sup' }); };
  for (const m of text.matchAll(/(\d+)([+\-−])(?![A-Za-z0-9])/g)) {
    const at = m.index!, digits = m[1];
    const sign = at + digits.length;
    if (sign < from || sign >= to) continue;
    const prev = text[at - 1];
    if (prev === undefined) continue;
    let n = 0;
    if (prev === ']') n = digits.length;
    else if (prev === ')' || /[A-Za-z]/.test(prev)) {
      // the formula before the digits: back to a space or the start of the text
      let s = at;
      while (s > 0 && /[A-Za-z0-9()[\]]/.test(text[s - 1])) s--;
      const formula = text.slice(s, at);
      const symbols = formula.match(/[A-Z][a-z]?/g) ?? [];
      if (!symbols.length || symbols.some((x) => elementNumber(x) === undefined && !/^(Me|Et|Pr|Bu|Ph|Ac|Bn|Bz|Ts|Ms|Tf|Cp|Py)$/.test(x))) continue;
      if (digits.length >= 2) n = 1;
      else if (prev === ')' || symbols.length > 1 || formula !== symbols[0]) n = 0;
      else if (NON_METALS.has(formula)) { unsure.push(formula + digits + m[2]); continue; }
      else n = 1;
    } else continue;
    if (n === 0 || /^0+$/.test(digits.slice(digits.length - n)) || digits[digits.length - n] === '0') continue;
    for (let i = sign - n; i < sign; i++) if (i >= from) raise(i);
    raise(sign);
  }
  if (unsure.length) chargeNote.text = `Left ${unsure.join(', ')} as typed: the digit could be a count or the charge. Raise it with Superscript if it is the charge.`;
  return out;
}
