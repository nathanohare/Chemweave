// Structure to Name in an SI project writes the name with its first word capitalized.
import { describe, expect, it } from 'vitest';
import { capitalizeName } from '../src/si/chem-names';

describe('capitalizing a systematic name', () => {
  it('capitalizes the first word, past locants, stereodescriptors and italic prefixes', () => {
    expect(capitalizeName('1-(4-chlorophenyl)ethan-1-ol')).toBe('1-(4-Chlorophenyl)ethan-1-ol');
    expect(capitalizeName('(R)-1-phenylethan-1-ol')).toBe('(R)-1-Phenylethan-1-ol');
    expect(capitalizeName('(2R,3S)-butane-2,3-diol')).toBe('(2R,3S)-Butane-2,3-diol');
    expect(capitalizeName('tert-butyl acetate')).toBe('tert-Butyl acetate');
    expect(capitalizeName('N,N-dimethylformamide')).toBe('N,N-Dimethylformamide');
    expect(capitalizeName('1H-indole')).toBe('1H-Indole');
    expect(capitalizeName('Benzene')).toBe('Benzene');
  });
});
