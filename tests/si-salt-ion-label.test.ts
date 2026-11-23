// The HRMS ion as printed for a salt: [M]⁺ (M = the charged piece) or, for M = the whole salt,
// [M−Br]⁺ with its counter-ions taken off. The labels and the cases where it does not apply are
// SI Assistant's SPEC §13f.3 (Nate, 2026-11-16) and its tests/test_hrms_species.py; the counter-ion
// names are the usual ones (OTf triflate, BF4 tetrafluoroborate, CF3CO2 trifluoroacetate).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { molFacts, type MolFacts } from '../src/si/chem';
import { printedIonLabel, saltIonLabel, saltLabelStyle, ION_LABEL_KEY, SALT_LABEL_KEY } from '../src/si/checks';
import { chargeRuns } from '../src/si/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
const facts = (smiles: string): MolFacts => molFacts(RDKit, RDKit.get_mol(smiles).get_molblock())!;

const SALT = 'C(c1ccccc1)[n+]1ccccc1.[Br-]';   // N-benzylpyridinium bromide
const DIBROMIDE = 'C[n+]1ccc(cc1)-c1cc[n+](C)cc1.[Br-].[Br-]';   // methyl viologen dibromide

describe('saltIonLabel', () => {
  it.each([
    [SALT, '[M]+', '[M-Br]+'],
    [DIBROMIDE, '[M]2+', '[M-2Br]2+'],
    ['C[n+]1ccccc1.[O-]S(=O)(=O)C(F)(F)F', '[M]+', '[M-OTf]+'],
    ['C[n+]1ccccc1.F[B-](F)(F)F', '[M]+', '[M-BF4]+'],
    ['CCCCCCCCCCCC(=O)[O-].[Na+]', '[M]-', '[M-Na]-'],
    ['C[n+]1ccccc1.[O-]C(=O)C(F)(F)F', '[M]+', '[M-CF3CO2]+'],
    ['C(c1ccccc1)[n+]1ccccc1.CC(=O)[O-]', '[M]+', '[M-C2H3O2]+'],   // (not a named counter-ion: by its formula)
  ])('%s with %s is %s', (smiles, adduct, label) => {
    expect(saltIonLabel(facts(smiles), {}, adduct)).toBe(label);
  });

  it.each([
    ['CCO', {}, '[M+H]+'],                                   // one piece
    [SALT, {}, '[M+H]+'],                                    // the adduct adds atoms
    [SALT, { species: 'whole' }, '[M]+'],                    // the whole salt chosen as M
    [SALT, { formula: 'C12H12N+' }, '[M]+'],                 // a typed M formula
    [DIBROMIDE, {}, '[M]+'],                                 // a charge other than the piece's
    ['C[n+]1ccccc1.C[n+]1ccccc1.[O-]S(=O)(=O)[O-]', {}, '[M]+'],   // two copies of M
    ['C[n+]1ccccc1.[Br-].[Br-]', {}, '[M]+'],                // not a neutral salt as drawn
  ])('does not apply to %s %j with %s', (smiles, value, adduct) => {
    expect(saltIonLabel(facts(smiles), value, adduct)).toBeNull();
  });

  it('applies to no structure', () => {
    expect(saltIonLabel(null, {}, '[M]+')).toBeNull();
  });
});

describe('printedIonLabel', () => {
  it('follows the project setting and the compound’s typed label', () => {
    const f = facts(SALT);
    const value = { adduct: '[M]+' };
    expect(printedIonLabel({}, f, value)).toBe('[M]+');
    expect(printedIonLabel({ [SALT_LABEL_KEY]: 'piece' }, f, value)).toBe('[M]+');
    expect(printedIonLabel({ [SALT_LABEL_KEY]: 'whole' }, f, value)).toBe('[M-Br]+');
    expect(printedIonLabel({ [SALT_LABEL_KEY]: 'whole' }, facts('CCO'), { adduct: '[M+Na]+' })).toBe('[M+Na]+');
    expect(printedIonLabel({ [SALT_LABEL_KEY]: 'whole' }, f, { adduct: '[M+H]+' })).toBe('[M+H]+');
    const typed = { adduct: '[M]+', [ION_LABEL_KEY]: ' [M−Br]+ ' };
    expect(printedIonLabel({}, f, typed)).toBe('[M−Br]+');
    expect(printedIonLabel({ [SALT_LABEL_KEY]: 'whole' }, null, typed)).toBe('[M−Br]+');
  });

  it('reads an unknown setting as the default', () => {
    expect(saltLabelStyle({ [SALT_LABEL_KEY]: 'odd' })).toBe('piece');
    expect(saltLabelStyle(null)).toBe('piece');
  });
});

describe('chargeRuns', () => {
  const shown = (label: string): [string, string][] => chargeRuns(label).map((r) => [r.text, r.valign ?? 'normal']);
  it('subscripts atom counts but not numbers of molecules or pieces', () => {
    expect(shown('[M-BF4]+')).toEqual([['[M−BF', 'normal'], ['4', 'sub'], [']', 'normal'], ['+', 'super']]);
    expect(shown('[M+NH4]+')).toEqual([['[M+NH', 'normal'], ['4', 'sub'], [']', 'normal'], ['+', 'super']]);
    expect(shown('[M-2Br]2+')).toEqual([['[M−2Br]', 'normal'], ['2+', 'super']]);
    expect(shown('[2M+Na]+')).toEqual([['[2M+Na]', 'normal'], ['+', 'super']]);
    expect(shown('[M+H]+')).toEqual([['[M+H]', 'normal'], ['+', 'super']]);
  });
});
