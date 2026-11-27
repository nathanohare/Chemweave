// Review batch 08, F378 and F379: a saved descriptor line without its decimal places keeps the
// line's own default, and vapor pressures from 99.5 up are written as whole numbers.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ANALYSIS, parseAnalysisPrefs, pressureText } from '../src/chem/analysis-prefs';

describe('analysis settings', () => {
  it('a saved m/z line with no decimal places takes the m/z default', () => {
    const p = parseAnalysisPrefs({ descriptors: [{ key: 'mz', on: true, label: 'm/z:' }, { key: 'mw', on: true, label: 'MW:' }] });
    const want = (k: string) => DEFAULT_ANALYSIS.descriptors.find((d) => d.key === k)!.dp;
    expect(p.descriptors.find((d) => d.key === 'mz')!.dp).toBe(want('mz'));
    expect(p.descriptors.find((d) => d.key === 'mw')!.dp).toBe(want('mw'));
    // a saved value still wins
    expect(parseAnalysisPrefs({ descriptors: [{ key: 'mz', on: true, label: '', dp: 1 }] }).descriptors.find((d) => d.key === 'mz')!.dp).toBe(1);
  });

  it('writes 99.5 to 100 as a whole number, not 1.0e+2', () => {
    // 1 mmHg = 0.133322 kPa (NIST SP 811, Appendix B.8), so 13.3 kPa is 99.76 mmHg
    expect(pressureText(13.3, 'mmHg')).toBe('100 mmHg');
    expect(pressureText(99.7, 'kPa')).toBe('100 kPa');
    expect(pressureText(99.4, 'kPa')).toBe('99 kPa');
    expect(pressureText(12.3, 'kPa')).toBe('12 kPa');
  });
});
