// Fix phase F8a, item 5 (F2 Needs Nate "formula charges"): Raise Charge Digits. The ions are written
// as chemists write them (IUPAC Red Book, Nomenclature of Inorganic Chemistry 2005, IR-3.4.2: a
// charge is a right upper index, the number before the sign; Fe³⁺, SO₄²⁻, [Fe(CN)₆]⁴⁻, B₁₂H₁₂²⁻).

import { describe, it, expect } from 'vitest';
import { chargeDigitEdits, chargeNote } from '../src/text/charge-digits';
import { TextEditing } from '../src/text/editing';
import { applyFormat, formatWhole } from '../src/text/format';
import { formulaRunParts, type Part } from '../src/richtext';
import type { TextRun } from '../src/model';

/** How formula text shows, as the drawing does: each run's parts joined, sub as _x, sup as ^x. */
function shown(runs: TextRun[]): string {
  return runs.flatMap((r, k) => {
    const parts: Part[] = r.sub ? [{ text: r.text, pos: 'sub' }] : r.sup ? [{ text: r.text, pos: 'sup' }] : r.formula ? formulaRunParts(runs, k) : [{ text: r.text, pos: 'base' }];
    return parts.map((p) => (p.pos === 'base' ? p.text : [...p.text].map((c) => (p.pos === 'sub' ? '_' : '^') + c).join('')));
  }).join('');
}
const measure = (s: string) => s.length;
const raise = (text: string) => shown(formatWhole({ runs: [{ text, formula: true }] }, { kind: 'charges' }, {}, 10, measure).runs);

describe('Raise Charge Digits', () => {
  it('formula style alone lowers a charge\'s digit, as ChemDraw does (the case the command is for)', () => {
    expect(shown([{ text: 'Fe3+', formula: true }])).toBe('Fe_3^+');
  });
  it('raises the charge\'s digit with its sign', () => {
    expect(raise('Fe3+')).toBe('Fe^3^+');
    expect(raise('SO42-')).toBe('SO_4^2^-');
    expect(raise('PO43−')).toBe('PO_4^3^−');
    expect(raise('Cr2O72-')).toBe('Cr_2O_7^2^-');
    expect(raise('B12H122-')).toBe('B_1_2H_1_2^2^-');
  });
  it('after a closing square bracket, the whole number is the charge', () => {
    expect(raise('[Fe(CN)6]4-')).toBe('[Fe(CN)_6]^4^-');
    // (a mass spectrum's ion: both digits and the sign, nothing inside the brackets)
    expect(chargeDigitEdits('[M+10H]10+', () => false).map((e) => e.start)).toEqual([7, 8, 9]);
  });
  it('raises every ion in the text, and leaves hyphens, ranges and numbers that aren\'t charges', () => {
    expect(raise('Fe3+ and SO42-')).toBe('Fe^3^+ and SO_4^2^-');
    expect(raise('C8-12')).toBe(shown([{ text: 'C8-12', formula: true }]));
    expect(raise('Red-Al')).toBe('Red-Al');
    expect(chargeDigitEdits('pH 7-8', () => false)).toEqual([]);
    expect(chargeDigitEdits('2+', () => false)).toEqual([]);
  });
  // (review F8a-R03: a lone digit after a formula of two or more elements is its count, IUPAC Red Book IR-4.4.2.2)
  it('leaves a count as a count: NH4+, BF4-, NO3- and the like keep their digit lowered', () => {
    for (const ion of ['NH4+', 'BF4-', 'PF6-', 'NO3-', 'ClO4-', 'HSO4-', 'H2PO4-', 'MnO4-', 'AlH4-', 'NBu4+', 'CH3+']) {
      expect(raise(ion), ion).toBe(shown([{ text: ion, formula: true }]));
    }
    expect(raise('NH4+ and Fe3+')).toBe(shown([{ text: 'NH4+ and ', formula: true }]) + 'Fe^3^+');
  });
  it('raises the last of two or more digits, and never a 0', () => {
    expect(raise('Hg22+')).toBe('Hg_2^2^+');
    expect(raise('S2O82-')).toBe('S_2O_8^2^-');
    expect(raise('Fe(CN)63-')).toBe('Fe(CN)_6^3^-');
    expect(chargeDigitEdits('C60-', () => false)).toEqual([]);
    expect(raise('[Co(NH3)6]3+')).toBe('[Co(NH_3)_6]^3^+');
    expect(raise('Ca2+')).toBe('Ca^2^+');
    expect(raise('Al3+')).toBe('Al^3^+');
  });
  it('leaves a lone non-metal with one digit, which could be a count or the charge, and says why', () => {
    // (N3- is nitride N³⁻ or azide N₃⁻; I3- triiodide I₃⁻; O2- oxide or superoxide; VO2+ vanadyl VO²⁺ or VO₂⁺)
    for (const ion of ['N3-', 'I3-', 'O2-', 'VO2+', 'TiO2+']) {
      expect(chargeDigitEdits(ion, () => false), ion).toEqual([]);
      expect(chargeNote.text).toContain(ion);
    }
    chargeDigitEdits('Fe3+', () => false);
    expect(chargeNote.text).toBe('');
  });
  it('changes nothing with only a caret in the text (select the ions first)', () => {
    const ed = new TextEditing({ runs: [{ text: 'Fe3+', formula: true }] }, {}, measure, 10);
    ed.select(2, 2);
    applyFormat(ed, { kind: 'charges' });
    expect(shown(ed.t.runs)).toBe('Fe_3^+');
    expect(chargeNote.text).toMatch(/^Select/);
  });
  it('in plain text raises the sign too', () => {
    const r = formatWhole({ runs: [{ text: 'Cu2+' }] }, { kind: 'charges' }, {}, 10, measure).runs;
    expect(shown(r)).toBe('Cu^2^+');
  });
  it('acts on the selection only, and is one step of Undo', () => {
    const ed = new TextEditing({ runs: [{ text: 'Fe3+ Fe3+', formula: true }] }, {}, measure, 10);
    ed.select(5, 9);
    applyFormat(ed, { kind: 'charges' });
    expect(shown(ed.t.runs)).toBe('Fe_3^+ Fe^3^+');
    ed.undo();
    expect(shown(ed.t.runs)).toBe('Fe_3^+ Fe_3^+');
  });
  it('does nothing (and makes no Undo step) when there is no charge', () => {
    const ed = new TextEditing({ runs: [{ text: 'CH2Cl2', formula: true }] }, {}, measure, 10);
    ed.select(0, 6);
    applyFormat(ed, { kind: 'charges' });
    ed.undo();
    expect(ed.t.runs).toEqual([{ text: 'CH2Cl2', formula: true }]);
  });
});
