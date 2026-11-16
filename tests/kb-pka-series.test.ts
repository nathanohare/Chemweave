import { describe, expect, it } from 'vitest';
import { inlineGroups, type KbTable, type RowMatch } from '../src/kb/tables';
import { PKA_VALUES_TABLE, pkaSeries } from '../src/kb/pka';

describe('pKa Values series', () => {
  const row = (name: string, solvent = 'Water') => PKA_VALUES_TABLE.rows.find((r) => r.name === name && r.solvent === solvent)!;

  it('puts substituted compounds under their parent, by the hydrogen the value belongs to', () => {
    expect(pkaSeries(row('Benzoic acid'))).toBe('Benzoic acids in water');
    expect(pkaSeries(row('2-Nitrobenzoic acid'))).toBe('Benzoic acids in water');
    expect(pkaSeries(row('Chloroacetic acid'))).toBe('Haloacetic acids in water');
    expect(pkaSeries(row('Quinoline'))).toBe('Quinolines in water');
    expect(pkaSeries(row('4-Methylquinoline'))).toBe('Quinolines in water');
    expect(pkaSeries(row('Aniline'))).toBe('Anilines in water');
    // the value is the NH3+'s, so an aniline, not a benzoic acid
    expect(pkaSeries(row('Methyl 4-aminobenzoate'))).toBe('Anilines in water');
    expect(pkaSeries(row('Fluorene', 'DMSO'))).toBe('Fluorenes in DMSO');
    expect(pkaSeries(row('Guanosine'))).toBe('Purines and nucleosides in water');
    expect(PKA_VALUES_TABLE.rows.filter((r) => r.series).length).toBeGreaterThan(1500);
  });

  it('leaves out compounds in no series (they stand alone)', () => {
    expect(pkaSeries(row('Methane', 'DMSO'))).toBeNull();
  });

  it('gives a heading its parent drawing and its range', () => {
    const rows: RowMatch[] = PKA_VALUES_TABLE.rows.filter((r) => r.series === 'Benzoic acids in water').map((r) => ({ row: r }));
    const h = PKA_VALUES_TABLE.groupHeading!('Benzoic acids in water', rows);
    expect(h.picture?.atoms.length).toBe(9);
    expect(h.note).toMatch(/^pKa [\d.−]+ to [\d.]+$/);
  });
});

describe('group headings among the rows', () => {
  const t = { group: 'g' } as unknown as KbTable;
  const m = (n: string, g: string | null): RowMatch => ({ row: { n, g } });
  const rows = [m('a1', 'A'), m('x', null), m('b1', 'B'), m('a2', 'A'), m('y', null)];
  const shape = (items: ReturnType<typeof inlineGroups>) => items.map((it) => ('group' in it && !('row' in it) ? `[${it.group} ${it.rows.length}]` : String((it as RowMatch).row.n)));

  it('places each heading where its first row falls; loose rows stand alone', () => {
    expect(shape(inlineGroups(t, rows, () => true))).toEqual(['[A 2]', 'x', '[B 1]', 'y']);
    expect(shape(inlineGroups(t, rows, (g) => g === 'B'))).toEqual(['[A 2]', 'a1', 'a2', 'x', '[B 1]', 'y']);
  });
});
