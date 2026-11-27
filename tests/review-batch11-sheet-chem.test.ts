// Review batch 11 (spreadsheet engine), the chemistry answers kept for a workbook: more answers
// than the cache holds must settle instead of asking again for ever (F286), and a substructure
// search the engine could not do is not a "no match" (F287). The engine here is a stand-in that
// answers by counting, so no chemistry values are needed.

import { describe, it, expect } from 'vitest';
import { SheetChem, type ChemEngine } from '../src/sheet/sheet-chem';
import { Workbook, makeStructure } from '../src/sheet/workbook';
import type { MolProps } from '../src/sheet/properties';
import type { Contents } from '../src/model';

const props = (smiles: string): MolProps => ({ formula: 'C', mw: smiles.length, exact: smiles.length, charge: 0, smiles, inchikey: smiles, clogp: 0, tpsa: 0, hbd: 0, hba: 0, rotb: 0 });

function engine(sub?: (query: string, mols: string[]) => { results: (boolean | null)[]; error?: string }): ChemEngine & { asked: number } {
  const e = {
    ready: true,
    asked: 0,
    async props(mols: string[]) { e.asked += mols.length; return mols.map(props); },
    async substructure(query: string, mols: string[]) { e.asked += mols.length; return sub ? sub(query, mols) : { results: mols.map((m) => m.includes(query)) }; },
  };
  return e;
}

const drawn = (smiles: string): Contents => ({ atoms: [], bonds: [], arrows: [], shapes: [], captions: [{ id: 1, x: 0, y: 0, runs: [{ text: smiles }] } as never] });
const molfileOf = (c: Contents) => {
  const t = (c.captions[0] as unknown as { runs: { text: string }[] } | undefined)?.runs[0].text;
  return t ? { molblock: t } : { molblock: null, problem: 'There is no structure in this cell' };
};

describe('F286: more answers than are kept', () => {
  it('settles, keeping every answer the sheets still use', async () => {
    const eng = engine();
    const chem = new SheetChem(eng, molfileOf);
    const wb = new Workbook();
    wb.chem = chem;
    let rounds = 0;
    chem.onAnswers = () => { rounds++; wb.recalc(); };
    const n = 20500;
    wb.edit('Type', () => {
      for (let r = 0; r < n; r++) {
        wb.sheet.setInput(r, 0, `C${'C'.repeat(r % 50)}N${r}`);
        wb.sheet.setInput(r, 1, `=MW(A${r + 1})`);
      }
    });
    const settled = await Promise.race([chem.settled().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 20000))]);
    expect(settled).toBe(true);
    // each SMILES asked once, in a round or two, not again and again
    expect(eng.asked).toBe(n);
    expect(rounds).toBeLessThanOrEqual(2);
    expect(wb.sheet.value(0, 1)).toBe('CN0'.length);
    expect(wb.sheet.value(n - 1, 1)).toBe(`C${'C'.repeat((n - 1) % 50)}N${n - 1}`.length);
  }, 60000);
});

describe('F287: a substructure search the engine could not do', () => {
  it('is neither a match nor a miss, and says why', async () => {
    const chem = new SheetChem(engine(() => ({ results: [null, null], error: 'The query is too complicated' })), molfileOf);
    const q = drawn('c1ccccc1');
    const a = makeStructure(drawn('Cc1ccccc1')), b = makeStructure(drawn('C1CCCCC1'));
    chem.substructure(a, q);
    chem.substructure(b, q);
    await chem.settled();
    expect(chem.substructure(a, q)).toBeNull();
    expect(chem.substructure(b, q)).toBeNull();
    expect(chem.substructureError(q)).toBe('The query is too complicated');
  });

  it('leaves the rows showing in a filter (not hidden as misses)', async () => {
    const chem = new SheetChem(engine(() => ({ results: [null], error: 'The query is too complicated' })), molfileOf);
    const wb = new Workbook();
    wb.chem = chem;
    const s = wb.sheet;
    const q = drawn('c1ccccc1');
    wb.edit('Type', () => { s.setInput(0, 0, 'Structure'); s.setStructure(1, 0, drawn('Cc1ccccc1')); });
    s.passes(1, 0, { kind: 'substructure', query: q });
    await chem.settled();
    wb.edit('Filter', () => s.setFilter({ range: { r1: 0, c1: 0, r2: 1, c2: 0 }, conditions: { 0: { kind: 'substructure', query: q } } }));
    expect(s.hiddenRows.has(1)).toBe(false);
  });

  it('a failed engine is reported too', async () => {
    const eng: ChemEngine = { ready: true, props: async () => [], substructure: async () => { throw new Error('worker stopped'); } };
    const chem = new SheetChem(eng, molfileOf);
    const q = drawn('CC');
    const a = makeStructure(drawn('CCC'));
    chem.substructure(a, q);
    await chem.settled();
    expect(chem.substructure(a, q)).toBeNull();
    expect(chem.substructureError(q)).toMatch(/worker stopped/);
  });

  it('still answers true and false when it can', async () => {
    const chem = new SheetChem(engine(), molfileOf);
    const q = drawn('c1ccccc1');
    const a = makeStructure(drawn('Cc1ccccc1')), b = makeStructure(drawn('C1CCCCC1'));
    chem.substructure(a, q);
    chem.substructure(b, q);
    await chem.settled();
    expect(chem.substructure(a, q)).toBe(true);
    expect(chem.substructure(b, q)).toBe(false);
    expect(chem.substructureError(q)).toBeUndefined();
  });
});
