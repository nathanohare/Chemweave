// Compound names printed with their conventional italics (SI Assistant's SPEC §13x). The golden
// file holds what SI Assistant itself prints for each name (core/chem_names.name_runs, run as a
// black box on these names), so both programs print a title alike.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nameRuns, typedItalics } from '../src/si/chem-names';

const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'si-names.golden.json'), 'utf8')) as [string, [string, boolean][]][];

describe('italic prefixes in compound names', () => {
  it.each(golden)('%s', (name, want) => {
    expect(nameRuns(name).map((r) => [r.text, !!r.italic])).toEqual(want);
  });

  it('keeps the title bold and tells typed italics apart', () => {
    expect(nameRuns('N-Boc', { bold: true })).toEqual([{ text: 'N', bold: true, italic: true }, { text: '-Boc', bold: true }].map((r) => expect.objectContaining(r)));
    expect(typedItalics('(R*,S*)-2,3-Dibromobutane')).toBe(false);
    expect(typedItalics('*N*-Boc')).toBe(true);
    expect(typedItalics('2\\*-Star')).toBe(false);
  });
});
