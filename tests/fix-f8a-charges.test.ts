// Fix phase F8a, item 5 (F2 Needs Nate "formula charges"): Raise Charge Digits. The ions are written
// as chemists write them (IUPAC Red Book, Nomenclature of Inorganic Chemistry 2005, IR-3.4.2: a
// charge is a right upper index, the number before the sign; Fe³⁺, SO₄²⁻, [Fe(CN)₆]⁴⁻, B₁₂H₁₂²⁻).

import { describe, it, expect } from 'vitest';
import { chargeDigitEdits } from '../src/text/charge-digits';
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
