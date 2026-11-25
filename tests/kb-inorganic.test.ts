// The inorganic Knowledge Base tables: Hard and Soft Acids and Bases (Pearson's classes and
// absolute hardness) and Electronegativity (Pauling's early values, Allen's scale). Every row names
// its source; spot values are typed in here from the published tables, with the reference beside
// each.

import { CO_STRETCH_TABLE, describe, expect, it } from 'vitest';
import { CO_STRETCH_TABLE, ELECTRONEGATIVITY_TABLE, HSAB_TABLE } from '../src/kb/inorganic';
import { BUILT_IN_TABLES } from '../src/kb/data';
import { findRows, tableTsv } from '../src/kb/tables';
import { glossaryTip } from '../src/kb/glossary';

const num = (v: unknown) => Number(String(v).replace('−', '-'));

describe('Hard and Soft Acids and Bases', () => {
  const cls = HSAB_TABLE.rows.filter((r) => r.part === 'class');
  const hard = HSAB_TABLE.rows.filter((r) => r.part === 'hardness');
  const find = (species: string, kind?: string) => cls.find((r) => r.species === species && (!kind || r.kind === kind));

  it('gives every row a source, and every part its rows', () => {
    expect(cls).toHaveLength(90);
    expect(hard).toHaveLength(14);
    for (const r of HSAB_TABLE.rows) expect(String(r.source ?? ''), String(r.species)).toMatch(/Pearson (1968|1988), via Miessler, Fischer and Tarr, Table 6\.1[456]/);
    for (const r of HSAB_TABLE.rows) expect(HSAB_TABLE.links!(r)[0].url).toMatch(/^https:\/\/doi\.org\/10\.1021\/(ed045p581|ic00277a030)$/);
  });

  it('classes species as Pearson did', () => {
    // Pearson, J. Chem. Educ. 1968, 45, 581, as tabulated in Miessler, Fischer and Tarr,
    // Inorganic Chemistry, 5th ed. (2014), Tables 6.14 and 6.15
    expect(find('Fe³⁺')?.cls).toBe('Hard');
    expect(find('Fe²⁺')?.cls).toBe('Borderline');
    expect(find('Hg²⁺')?.cls).toBe('Soft');
    expect(find('BF₃')?.cls).toBe('Hard');
    expect(find('B(CH₃)₃')?.cls).toBe('Borderline');
    expect(find('BH₃')?.cls).toBe('Soft');
    expect(find('F⁻')?.cls).toBe('Hard');
    expect(find('Br⁻')?.cls).toBe('Borderline');
    expect(find('I⁻')?.cls).toBe('Soft');
    expect(find('C₅H₅N')?.cls).toBe('Borderline');
    expect(find('CO', 'Base')?.cls).toBe('Soft');
    // each species once
    expect(new Set(cls.map((r) => `${r.kind} ${r.species}`)).size).toBe(cls.length);
  });

  it('holds the hardness values as published, and they keep Pearson\'s definitions', () => {
    // Pearson, Inorg. Chem. 1988, 27, 734 (Miessler, Fischer and Tarr, Table 6.16): Al³⁺ η 45.77, I⁻ η 3.70 eV
    const al = hard.find((r) => r.species === 'Al³⁺')!;
    expect([al.ie, al.ea, al.chi, al.eta]).toEqual(['119.99', '28.45', '74.22', '45.77']);
    expect(hard.find((r) => r.species === 'I⁻')?.eta).toBe('3.70');
    expect(hard.find((r) => r.species === 'H₂O')?.ea).toBe('−6.4');
    // χ = (I + A)/2 and η = (I − A)/2 (Parr and Pearson, J. Am. Chem. Soc. 1983, 105, 7512)
    for (const r of hard) {
      const i = num(r.ie), a = num(r.ea);
      const tol = String(r.eta).split('.')[1].length === 1 ? 0.06 : 0.006;
      expect(Math.abs((i + a) / 2 - num(r.chi)), `${r.species} χ`).toBeLessThan(tol);
      expect(Math.abs((i - a) / 2 - num(r.eta)), `${r.species} η`).toBeLessThan(tol);
    }
  });

  it('filters by class, searches flat formulas, and copies each part under its title', () => {
    expect(findRows(HSAB_TABLE, '', { cls: 'Soft', kind: 'Base' }).every((m) => m.row.cls === 'Soft' && m.row.kind === 'Base')).toBe(true);
    expect(findRows(HSAB_TABLE, 'Fe2+').map((m) => m.row.species)).toEqual(['Fe²⁺']);
    const tsv = tableTsv(HSAB_TABLE, findRows(HSAB_TABLE, '')).split('\n');
    expect(tsv[0]).toBe('Classification');
    expect(tsv).toContain('Absolute hardness (eV)');
  });

  it('explains its rated columns and abbreviations', () => {
    for (const k of ['cls', 'eta', 'chi', 'ie', 'ea']) expect(HSAB_TABLE.columns.find((c) => c.key === k)?.info, k).toMatch(/Source: Pearson/);
    expect(glossaryTip('eV')).toMatch(/^eV: Electronvolt/);
    expect(glossaryTip('HSAB')).toMatch(/^HSAB: Hard and soft acids and bases/);
  });
});

describe('Electronegativity', () => {
  const row = (s: string) => ELECTRONEGATIVITY_TABLE.rows.find((r) => r.symbol === s)!;

  it('gives every value a source', () => {
    expect(ELECTRONEGATIVITY_TABLE.rows).toHaveLength(45);
    for (const r of ELECTRONEGATIVITY_TABLE.rows) {
      expect(String(r.source), String(r.symbol)).toMatch(/Allen: Mann/);
      if (r.pauling !== null) expect(String(r.source), String(r.symbol)).toMatch(/Pauling: Pauling 1960/);
    }
    expect(ELECTRONEGATIVITY_TABLE.rows.filter((r) => r.pauling !== null)).toHaveLength(13);
  });

  it('holds the published values', () => {
    // Pauling, The Nature of the Chemical Bond, 3rd ed. (1960), as in Miessler, Fischer and Tarr, Table 3.3
    expect([row('F').pauling, row('O').pauling, row('C').pauling, row('H').pauling]).toEqual(['4.0', '3.5', '2.5', '2.1']);
    // Mann, Meek and Allen, J. Am. Chem. Soc. 2000, 122, 2780 (Miessler, Fischer and Tarr, Table 3.5)
    expect([row('F').allen, row('Ne').allen, row('Li').allen]).toEqual(['4.193', '4.787', '0.912']);
    // Mann, Meek, Knight, Capitani and Allen, J. Am. Chem. Soc. 2000, 122, 5132: zinc 1.588
    expect(row('Zn').allen).toBe('1.588');
    // Table 3.5 again: iodine 2.359, cesium 0.659; radon 2.60 is printed in parentheses
    expect([row('I').allen, row('Cs').allen, row('Rn').allen]).toEqual(['2.359', '0.659', '2.60']);
    expect(String(row('Rn').source)).toMatch(/parentheses/);
    expect(ELECTRONEGATIVITY_TABLE.links!(row('Zn'))[0].url).toBe('https://doi.org/10.1021/ja9928677');
    expect(ELECTRONEGATIVITY_TABLE.links!(row('Cl'))[0].url).toBe('https://doi.org/10.1021/ja992866e');
  });

  it('sits in the window before Abbreviations', () => {
    const ids = BUILT_IN_TABLES.map((t) => t.id);
    expect(ids.slice(-4)).toEqual(['hsab', 'electronegativity', 'co-stretch', 'glossary']);
  });
});

describe('Carbonyl Stretching Bands', () => {
  it('holds the textbook ranges, each with its source', () => {
    // Miessler, Fischer and Tarr, Inorganic Chemistry, 5th ed. (Pearson, 2014), Table 13.2:
    // free CO 2143 cm⁻¹; terminal 1850–2120; symmetric μ2 1700–1860; symmetric μ3 1600–1700
    expect(CO_STRETCH_TABLE.rows.map((r) => r.range).slice(0, 4)).toEqual(['2143', '1850–2120', '1700–1860', '1600–1700']);
    for (const r of CO_STRETCH_TABLE.rows) expect(String(r.source)).toMatch(/Table 13\.2/);
  });
});
