// The Knowledge Base's Key pKa Values: a short table of the values an organic chemist uses most,
// water and DMSO side by side, grouped by the kind of acid, every value with its paper and every
// structure drawn with the hydrogen that comes off.

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { KEY_PKA_GROUPS, KEY_PKA_ROWS, KEY_PKA_TABLE, keyPkaHydrogen, keyPkaPicture } from '../src/kb/pka-key';
import { LATER_TABLES } from '../src/kb/data';
import { findRows, groupRows, sortRows, type RowMatch } from '../src/kb/tables';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const row = (name: string) => KEY_PKA_ROWS.find((r) => r.name === name)!;

describe('the Key pKa Values table', () => {
  it('is loaded with the Knowledge Base', async () => {
    const tables = await Promise.all(LATER_TABLES.map((t) => t()));
    expect(tables.map((t) => t.id)).toContain('pka-key');
  });

  it('holds about a hundred and more key compounds, each once', () => {
    expect(KEY_PKA_ROWS.length).toBeGreaterThan(100);
    expect(KEY_PKA_ROWS.length).toBeLessThanOrEqual(150);
    expect(new Set(KEY_PKA_ROWS.map((r) => r.name)).size).toBe(KEY_PKA_ROWS.length);
    expect(KEY_PKA_TABLE.about).toContain(String(KEY_PKA_ROWS.length));
  });

  it('gives every value its paper, and no row without a value', () => {
    for (const r of KEY_PKA_ROWS) {
      expect(r.water !== null || r.dmso !== null, String(r.name)).toBe(true);
      const refs = String(r.refs);
      expect(refs.length, String(r.name)).toBeGreaterThan(0);
      // with both values, each says which solvent its papers are for
      if (r.water && r.dmso) { expect(refs, String(r.name)).toMatch(/Water: /); expect(refs, String(r.name)).toMatch(/DMSO: /); }
      for (const v of [r.water, r.dmso]) if (v !== null) expect(String(v), String(r.name)).toMatch(/^~?-?\d/);
    }
  });

  it('has the values from the compilations and the original papers', () => {
    expect([row('Acetic acid').water, row('Acetic acid').dmso]).toEqual(['4.76', '12.6']);
    expect([row('Ethyl acetate').water, row('Ethyl acetate').dmso]).toEqual(['25.6', '29.5']);
    expect(String(row('Ethyl acetate').refs)).toContain('Amyes and Richard, J. Am. Chem. Soc. 1996');
    expect(row('Acetonitrile').water).toBe('28.9');
    expect(row('Water').water).toBe('14.0');
    expect(row('Pyridinium').water).toBe('5.14');
    expect(row('Pyridinium').notes).toBe('At 20 °C');
    expect(row('Methane').dmso).toBe('~56');
  });

  it('draws every structure with its acidic hydrogen as an atom of its own', () => {
    for (const r of KEY_PKA_ROWS) {
      const pic = keyPkaPicture(r)!;
      expect(pic, String(r.name)).not.toBeNull();
      const h = keyPkaHydrogen(String(r.name))!;
      expect(pic.atoms[h.atom][2], String(r.name)).toBe('H');
      const [a, b] = pic.bonds[h.bond];
      expect([a, b], String(r.name)).toContain(h.atom);
      const on = pic.atoms[a === h.atom ? b : a][2];
      expect(String(r.site), String(r.name)).toBe(`${on}–H`);
    }
    expect(row('Acetone').site).toBe('C–H');
    expect(row('Ammonium').site).toBe('N–H');
  });

  it('keeps each compound\'s SMILES in RDKit\'s canonical form, so a drawn search finds it', () => {
    for (const r of KEY_PKA_ROWS) {
      const m = RDKit.get_mol(String(r.smiles));
      expect(m, String(r.name)).toBeTruthy();
      expect(m.get_smiles(), String(r.name)).toBe(r.smiles);
      m.delete();
    }
    expect(findRows(KEY_PKA_TABLE, 'acetophenone').map((m) => m.row.name)).toContain('Acetophenone');
  });

  it('shows its rows in groups, in the groups\' order, sorted within each', () => {
    const all: RowMatch[] = KEY_PKA_ROWS.map((r) => ({ row: r }));
    const groups = groupRows(KEY_PKA_TABLE, all);
    expect(groups.map((g) => g.name)).toEqual(KEY_PKA_GROUPS.filter((g) => KEY_PKA_ROWS.some((r) => r.group === g)));
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(KEY_PKA_ROWS.length);
    const water = KEY_PKA_TABLE.columns.find((c) => c.key === 'water')!;
    const carboxylic = groupRows(KEY_PKA_TABLE, sortRows(all, water, false)).find((g) => g.name === 'Carboxylic acids')!;
    const v = carboxylic.rows.map((m) => Number(String(m.row.water).split(',')[0])).filter((n) => !Number.isNaN(n));
    expect(v).toEqual([...v].sort((a, b) => a - b));
    // a table without groups is one group of everything
    expect(groupRows({ ...KEY_PKA_TABLE, group: undefined }, all)).toHaveLength(1);
  });

  it('links each row to PubChem and to its papers with a DOI', () => {
    const links = KEY_PKA_TABLE.links!(row('Ethyl acetate'));
    expect(links.some((l) => l.url === 'https://doi.org/10.1021/ja953664v')).toBe(true);
    expect(links[0].label).toBe('PubChem');
  });
});
