// @vitest-environment jsdom
// Chemistry typography in UI text (S27; retrospective audit G5-17..20): NMR solvents with real
// subscripts, nuclei with raised mass numbers, counter-ions with subscripts and charges, and Rf
// with a subscript f. Expected forms are the solvents' and ions' formulas as IUPAC writes them
// (IUPAC Red Book 2005, IR-3.3 isotopically modified compounds: CDCl₃, CD₃OD, C₆D₆, D₂O; the
// "-d₆" suffix as in Fulmer et al., Organometallics 2010, 29, 2176, Table 1) and nuclide symbols
// with a superscript mass number (IUPAC Green Book, 3rd ed., 2007, section 1.6: ¹H, ¹³C).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NMR_SOLVENTS, NMR_SOLVENT_LABEL, solventLabel, nucLabel } from '../src/ui/nmr-panel';
import { fieldLabelNodes } from '../src/ui/field-label';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('NMR solvents', () => {
  it('are shown with subscripts, keeping the saved ids', () => {
    expect(NMR_SOLVENT_LABEL).toEqual({
      CDCl3: 'CDCl₃', 'DMSO-d6': 'DMSO-d₆', CD3OD: 'CD₃OD', C6D6: 'C₆D₆', 'acetone-d6': 'acetone-d₆', CD2Cl2: 'CD₂Cl₂', CD3CN: 'CD₃CN', D2O: 'D₂O',
    });
    for (const s of NMR_SOLVENTS) expect(solventLabel(s)).not.toMatch(/\d/);
    expect(solventLabel('THF-d8')).toBe('THF-d8'); // unknown: as it is
  });
  it('every place that lists them uses the label', () => {
    const main = src('src/main.ts');
    expect(main).toContain('options: NMR_SOLVENTS.map((x) => ({ value: x, label: solventLabel(x) }))');
    expect(main).toContain('${solventLabel(x)}`, () => nmrRibbon({ solvent: x })]');
    expect(src('src/ui/nmr-panel.ts')).toContain('>${solventLabel(s)}</option>');
  });
});

describe('nuclei', () => {
  it('raise the mass number', () => {
    expect(nucLabel('1H')).toBe('¹H');
    expect(nucLabel('13C')).toBe('¹³C');
    expect(nucLabel('19F')).toBe('¹⁹F');
    expect(nucLabel('31P')).toBe('³¹P');
  });
  it('labels and notes write ¹H and ¹³C', () => {
    const main = src('src/main.ts');
    for (const l of ["'¹H spectrum from'", "'¹H spectrum to'", "'¹³C spectrum from'", "'¹³C spectrum to'"]) expect(main).toContain(l);
    expect(main).not.toMatch(/label: '1H spectrum|label: '13C spectrum/);
    expect(src('src/ui/nmr-panel.ts')).toContain("'Paste a ¹H or ¹³C peak or multiplet report'");
    expect(src('src/ui/knowledge-base.ts')).toContain('0.05 ppm in ¹H, 0.5 in ¹³C');
  });
});

describe('formulas and ions in tooltips', () => {
  it('counter-ions have subscripts and charges', () => {
    expect(src('src/ui/si-mode.ts')).toContain('BF₄⁻, PF₆⁻, OTf⁻, NTf₂⁻, TFA⁻, BArF⁻, Na⁺, K⁺, NBu₄⁺');
  });
  it('Check Balance, Isotope Pattern and the ion box describe with real formulas', () => {
    const html = src('index.html');
    expect(html).toContain('(e.g. H₂O or HCl)');
    expect(html).toContain('([M+H]⁺, [M+Na]⁺…)');
    expect(src('src/ui/property-dialog.ts')).toContain('[M+H]⁺, [M+Na]⁺, [M−H]⁻, [M+2H]²⁺, [2M+Na]⁺');
  });
  it('the NMR impurities help writes the solvents with subscripts', () => {
    expect(src('src/ui/si-settings.ts')).toContain('(CD₃OD, MeOD or methanol-d₄; DMSO-d₆ or (CD₃)₂SO; CDCl₃ or chloroform-d)');
  });
});

describe('Rf', () => {
  it('shows R with a subscript f', () => {
    const box = document.createElement('div');
    box.append(...fieldLabelNodes('Rf'));
    expect(box.innerHTML).toBe('R<sub>f</sub>');
    box.replaceChildren(...fieldLabelNodes('Rf (TLC)'));
    expect(box.innerHTML).toBe('R<sub>f</sub> (TLC)');
    box.replaceChildren(...fieldLabelNodes('Melting point'));
    expect(box.innerHTML).toBe('Melting point');
    box.replaceChildren(...fieldLabelNodes('Rfx'));
    expect(box.innerHTML).toBe('Rfx');
  });
});
