// @vitest-environment jsdom
// Import SI, structures from the ChemDraw drawings in a Word SI: SI Assistant's own tests of it
// (tests/test_si_import_structures.py), on the same made-up Word files (recorded while its tests
// ran: a scheme labelling 5a (phenol) and 5b (methanol), then 5a, 5b and 5c, with 5c's own
// unlabelled drawing of phenol; the files differ in 5a's HRMS).

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as Rd from '../src/si/si-import-read';
import * as I from '../src/si/si-import';
import { assignStructures, type StructureTools } from '../src/si/si-import-structures';
import { molFacts } from '../src/si/chem';
import { readCdxml } from '../src/io/cdxml';
import { toMolfile } from '../src/chem/molfile';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type Json } from '../src/si/project';
import { applyPlan } from '../src/si/si-import-apply';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const tools: StructureTools = {
  facts: async (ms) => ms.map((m) => molFacts(RDKit, m)),
  molfileOf: (cdxml) => {
    const { doc } = readCdxml(cdxml);
    if (!doc.atoms.size) return null;
    const m = toMolfile(doc, doc.atoms.keys());
    return m.unknownLabels.length ? null : m.molblock;
  },
};
const smiles = (mol: string): string => { const m = RDKit.get_mol(mol); try { return m.get_smiles(); } finally { m.delete(); } };

const DIR = join(__dirname, 'fixtures', 'si-import', 'files');
/** The recorded Word files with ChemDraw drawings, by 5a's HRMS formula. */
const files = new Map<string, Rd.ReadResult>();
for (const f of readdirSync(DIR)) {
  const read = Rd.readSiDocx('si.docx', new Uint8Array(readFileSync(join(DIR, f))));
  if (!read.paras.some((p) => p.objects.some((o) => o.kind === 'chemdraw'))) continue;
  const plan = I.analyse(read.paras);
  const a = plan.compounds.find((c) => c.cid === '5a');
  files.set(String((a?.values.hrms as Json | undefined)?.formula ?? ''), read);
}
const planFor = async (formula: string): Promise<I.ImportPlan> => {
  const read = files.get(formula);
  expect(read, `the file where 5a's HRMS is ${formula}`).toBeTruthy();
  const plan = I.analyse(read!.paras);
  await assignStructures(plan, tools);
  return plan;
};

describe('Import SI: structures from ChemDraw drawings in Word', () => {
  it('reads the drawings in the recorded files', () => {
    expect([...files.keys()].sort()).toEqual(['C6H6O', 'C7H8O', 'CH4O']);
  });

  it('takes each compound’s structure by its label, or its own drawing', async () => {
    const plan = await planFor('C6H6O');
    const by = new Map(plan.compounds.map((c) => [c.cid, c]));
    // by its label in the scheme (no picture: the drawing is a scheme)
    expect(smiles(by.get('5a')!.structure)).toBe('Oc1ccccc1');
    expect(by.get('5a')!.structure_picture).toBeNull();
    expect(by.get('5a')!.structure_note).toContain('labelled “5a”');
    expect(smiles(by.get('5b')!.structure)).toBe('CO');
    // unlabelled, next to its own text, alone in its drawing
    expect(smiles(by.get('5c')!.structure)).toBe('Oc1ccccc1');
    expect(by.get('5c')!.structure_note).toContain('next to its text');
    expect(plan.compounds.flatMap((c) => c.warnings).filter((w) => w.includes('structure'))).toEqual([]);
  });

  it('reports a structure that does not fit the HRMS', async () => {
    const a = (await planFor('C7H8O')).compounds.find((c) => c.cid === '5a')!;
    expect(smiles(a.structure)).toBe('Oc1ccccc1');
    expect(a.warnings.some((w) => w.includes('does not fit the formula of its HRMS'))).toBe(true);
  });

  it('finds a mislabelled structure by its formula', async () => {
    const a = (await planFor('CH4O')).compounds.find((c) => c.cid === '5a')!;
    expect(smiles(a.structure)).toBe('CO');
    expect(a.warnings.some((w) => w.includes('was taken instead'))).toBe(true);
  });

  it('stores the imported structures (the HRMS formula they now give dropped)', async () => {
    const plan = await planFor('C6H6O');
    plan.compounds[1].use_structure = false;              // (unticked: not stored)
    const p = await SiProject.create(new MemoryFolder('P'), 'P');
    const result = await applyPlan(p, plan, 'si.docx', { factsOf: async (m) => molFacts(RDKit, m) });
    const comps = result.created.map((id) => p.compound(id));
    expect(p.hasStructure(comps[0])).toBe(true);
    expect(p.hasStructure(comps[1])).toBe(false);
    expect((valuesOf(comps[0]).hrms as Json).formula).toBe('');
  });
});
