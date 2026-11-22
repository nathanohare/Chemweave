// Regression tests for the checks review (labelled isotopes, broken mentions and project warnings,
// fingerprints worked out lazily, the dashboard's missing list, slow inputs, the PubChem timeout).
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { molFacts, parseMFormulaAndCharge, infoFromCounts, ionMz, isotopePattern } from '../src/si/chem';
import { allWarnings, hrmsSpecies, isDismissed, StructureError } from '../src/si/checks';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
const mb = (smi: string): string => RDKit.get_mol(smi).get_molblock();

function folder(dir: string): MemoryFolder {
  const root = join(__dirname, 'fixtures', dir);
  const f = new MemoryFolder(dir);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}

describe('labelled isotopes and elements with no natural abundance', () => {
  it('works out 14C, T, 18F and 125I compounds as SI Assistant does (masses from RDKit, NIST SRD 144)', () => {
    // (Python: Chem.Descriptors / chem.mol_info → exact masses of the structures as drawn)
    const c14 = molFacts(RDKit, mb('[14CH3]C(=O)Oc1ccccc1'))!;
    // (G4-13: every labelled carbon right after C, as CAS Hill order keeps a nuclide with its element;
    // SI Assistant still writes C7H8[14C]O2, putting only [13C] after C)
    expect(c14.info!.formula).toBe('C7[14C]H8O2');
    expect(c14.info!.exact).toBeCloseTo(7 * 12 + 14.00324199 + 8 * 1.00782503223 + 2 * 15.99491461957, 6);
    const t = molFacts(RDKit, mb('[3H]C(=O)c1ccccc1'))!;
    expect(t.info!.formula).toBe('C7H5TO');
    expect(molFacts(RDKit, mb('[18F]CCOc1ccccc1'))!.info!.formula).toBe('C8H9[18F]O');
    expect(molFacts(RDKit, mb('[125I]c1ccccc1'))!.info!.exact).toBeCloseTo(6 * 12 + 5 * 1.00782503223 + 124.9046302, 6);
  });
  it('accepts labelled isotopes in a typed M formula', () => {
    const [counts] = parseMFormulaAndCharge('C7[14C]H8O2');
    expect(counts.get('14C')).toBe(1);
    const [tc] = parseMFormulaAndCharge('C7H5TO');
    expect(ionMz(infoFromCounts(tc), '[M+H]+').mz).toBeCloseTo(109.0574, 3);
  });
  it('takes the most common isotope of an element with none in nature (Tc, Po)', () => {
    const f = molFacts(RDKit, mb('[Tc]'))!;
    expect(f.info!.formula).toBe('Tc');
    expect(f.info!.exact).toBeCloseTo(96.906365, 5);
    const peaks = isotopePattern(infoFromCounts(new Map([['Po', 1], ['Cl', 2]])), '[M]+', 1, 12);
    expect(peaks[0].mono).toBe(true);
  });
  it('says so (not silently nothing) when a structure has no formula', () => {
    const f = { info: null, generic: [], pieces: [], uniqueCarbons: 0, hTotal: 0, hExch: 0, error: 'No formula.' };
    expect(() => hrmsSpecies(f, {})).toThrow(StructureError);
    // a typed formula still overrides it
    expect(hrmsSpecies(f, { formula: 'C6H6' })!.manual).toBe(true);
  });
});

describe('a typed M formula with long runs of spaces', () => {
  it('is read quickly, with the same charges as before', () => {
    const t = performance.now();
    for (const pad of [' '.repeat(5000), ' ( '.repeat(500)]) expect(() => parseMFormulaAndCharge('C10H12O2' + pad + 'x')).toThrow();
    expect(performance.now() - t).toBeLessThan(500);
    expect(parseMFormulaAndCharge('C10H8N2 2+')[1]).toBe(2);
    expect(parseMFormulaAndCharge('C10H8N2   2 +')[1]).toBe(2);
    expect(parseMFormulaAndCharge('C10H8N2 ++')[1]).toBe(2);
    expect(parseMFormulaAndCharge('C6H6 +•')[1]).toBe(1);
    expect(parseMFormulaAndCharge('C6H5O -')[1]).toBe(-1);
    expect(() => parseMFormulaAndCharge('C10H8N2 2++')).toThrow(/not both/);
  });
});

describe('the PubChem name lookup', () => {
  it('gives up when the answer stalls after its headers (the time limit covers the body)', async () => {
    const { lookupName, TIMEOUT_MS } = await import('../src/si/pubchem-name');
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const stalled = (async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })) as unknown as typeof fetch;
      const got = lookupName('BSYNRYMUTXBXSQ-UHFFFAOYSA-N', 1, stalled);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 10);
      const r = await got;
      expect(r.status).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the solvent as a report writes it', () => {
  it('is found at the right place after a character outside the Basic Multilingual Plane', async () => {
    const { findSolvent } = await import('../src/si/nmr');
    const t = '𝛿 1H NMR (400 MHz, CDCl3) 7.26 (s, 1H)';
    const f = findSolvent(t)!;
    expect(f.written).toBe('CDCl3');
    expect(t.slice(f.start, f.end)).toBe('CDCl3');
    // a letter of another plane next to it still makes it part of a longer word
    expect(findSolvent('𝛿cdcl3 x')).toBeNull();
    expect(findSolvent('in CD₃OD, 25 °C')!.name).toBe('CD3OD');
  });
});

describe('fingerprints worked out only when they are needed', () => {
  it('are those of the data when the check ran, read later', async () => {
    const p = await SiProject.open(folder('si-checks'));
    const c = p.compounds.find((x) => x.id === 'c-26c39a99')!;
    const facts = molFacts(RDKit, await p.readStructure(c));
    const w = allWarnings(p, c, p.idReport(), facts).find((x) => x.key === 'hrms:ppm')!;
    (c.data.values as Record<string, Record<string, string>>).hrms.found = '145.0800';
    expect(w.fingerprint).toBe('98746b0a425d');
    // (kept when a warning is copied or saved)
    expect({ ...w }.fingerprint).toBe('98746b0a425d');
    expect(JSON.parse(JSON.stringify(w)).fingerprint).toBe('98746b0a425d');
    expect(isDismissed(c, w)).toBe(false);
  });
});

describe('mentions of figures, tables and schemes, and warnings about the project as a whole', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
  const OPT = 'sections/s-c1aa3466_reaction-optimizatio';

  it('numbers labels as SI Assistant does', async () => {
    const { computeLabels } = await import('../src/si/labels');
    const p = await SiProject.open(folder('si-example'));
    const labels = await computeLabels(p);
    expect(labels.items.map((i) => [i.kind, i.id, i.label, i.where, i.place])).toEqual([
      ['table', 't-1ece4eb2', 'Table S1', 'Reaction Optimization', ['section', 's-c1aa3466']],
      ['scheme', 'k-730d7f01', 'Scheme S1', 'Synthesis and Characterization ▸ Reduction of aryl methyl ketones 1a–1f (R = aryl)', ['scheme', 'k-730d7f01']],
      ['scheme', 'k-95c635ac', 'Scheme S2', 'Synthesis and Characterization ▸ Acetylation of 1-(4-bromophenyl)ethan-1-ol', ['scheme', 'k-95c635ac']],
    ]);
    expect(labels.duplicates.size).toBe(0);
  });

  it('gives the same compound warnings as before when the labels are passed', async () => {
    const { computeLabels } = await import('../src/si/labels');
    for (const dir of ['si-example', 'si-checks']) {
      const p = await SiProject.open(folder(dir));
      const labels = await computeLabels(p);
      for (const c of p.compounds) {
        const facts = molFacts(RDKit, await p.readStructure(c));
        const plain = allWarnings(p, c, p.idReport(), facts).map((w) => [w.key, w.fingerprint, w.message]);
        expect(allWarnings(p, c, p.idReport(), facts, null, labels).map((w) => [w.key, w.fingerprint, w.message]), c.id).toEqual(plain);
      }
    }
  });

  it('warns about a compound text that mentions a deleted figure or table, or a scheme printed without its label', async () => {
    const { computeLabels } = await import('../src/si/labels');
    const p = await SiProject.open(folder('si-example'));
    const k = p.scheme('k-95c635ac');
    ((k.data.editor as Record<string, Record<string, unknown>>).layout).show_label = false;
    const c = p.compounds[1];
    await p.writeCompoundText(c, 'procedure', 'As in @{t-deadbeef} and @{f-deadbeef}, with @{c-deadbeef} (@{k-95c635ac}, @{t-1ece4eb2}).');
    const labels = await computeLabels(p);
    const got = allWarnings(p, c, p.idReport(), null, null, labels).filter((w) => w.check === 'mention');
    expect(got.map((w) => [w.key, w.fingerprint, w.message])).toEqual([
      // (fingerprints: Python's sha1(repr((id,))), first 12 digits)
      ['mention:procedure:t-deadbeef', 'e8eda30c5fa4', 'This text mentions a table that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.'],
      ['mention:procedure:f-deadbeef', 'b4e08581e842', 'This text mentions a figure that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.'],
      ['mention:procedure:c-deadbeef', '20e84f1b2344', 'This text mentions a compound that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.'],
      ['mention:procedure:k-95c635ac', 'd1c676816053', 'This text mentions scheme “Acetylation of 1-(4-bromophenyl)ethan-1-ol”, which is printed without a label (printed as “??”). Check “Label and caption” in the scheme\'s Layout…, or remove the mention.'],
    ]);
    // (without the labels, only the compound is known to be gone)
    expect(allWarnings(p, c, p.idReport(), null).filter((w) => w.check === 'mention').map((w) => w.key)).toEqual(['mention:procedure:c-deadbeef']);
  });

  it('lists duplicate labels, broken mentions, missing files, duplicate procedure names and author lines', async () => {
    const { projectWarnings } = await import('../src/si/project-warnings');
    const f = folder('si-example');
    const text = new TextDecoder().decode(f.files.get(`${OPT}/content.txt`)!);
    f.files.set(`${OPT}/content.txt`, enc(text + '\nSee @{t-deadbeef} and @cite{r-gone}.\n!table{t-2} A second table\n!table{t-3} A table with no file'));
    f.files.set(`${OPT}/tables/t-2.json`, enc(JSON.stringify({ id: 't-2', label: 'table  s1', rows: [['@{f-gone}', '']], footnotes: [] })));
    const general = new TextDecoder().decode(f.files.get('front/general_information.txt')!);
    f.files.set('front/general_information.txt', enc(general + '\n!figure{f-nopic} A figure'));
    const p = await SiProject.open(f);
    const s = p.dataSections[0];
    (s.data.general_procedures as Record<string, unknown>[]).push({ id: 'gp-2', name: 'general procedure  a', sentence: 'Made by {GP} as in @{t-deadbeef}.' });
    p.references.push({ id: 'r-x', type: 'article', authors: ['Smith, A.; Jones, B.'], year: '2010' });
    const got = await projectWarnings(p);
    const opt: [string, string] = ['section', 's-c1aa3466'];
    expect(got).toEqual([
      { check: 'label', message: '“Table S1” (Reaction Optimization) has the same label as Reaction Optimization. Give one of them its own label, or let both be numbered automatically.', place: opt, field: '' },
      { check: 'label', message: '“table  s1” (Reaction Optimization) has the same label as Reaction Optimization. Give one of them its own label, or let both be numbered automatically.', place: opt, field: '' },
      { check: 'mention', message: 'Reaction Optimization: mentions a table that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.', place: opt, field: '' },
      { check: 'citation', message: 'Reaction Optimization: cites a reference that is no longer in the References list; it will be left out of the SI.', place: opt, field: '' },
      { check: 'mention', message: 'Reaction Optimization ▸ table: mentions a figure that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.', place: opt, field: '' },
      { check: 'mention', message: 'Synthesis and Characterization ▸ general procedure  a (compound sentence): mentions a table that has been deleted (printed as “??”). Restore it from the Trash, or remove the mention.', place: ['section', s.id], field: '' },
      { check: 'object', message: 'General Information: a figure\'s picture is missing, so the figure is left out of the SI. Restore it from the Trash if it was removed, or replace the picture (right-click it).', place: ['front', 'general'], field: '' },
      { check: 'object', message: 'Reaction Optimization: a table\'s file is missing, so the table is left out of the SI. Restore it from the Trash if it was removed.', place: opt, field: '' },
      { check: 'gp_name', message: 'General procedure “General Procedure A” (in “Synthesis and Characterization”) has the same name as “general procedure  a” in “Synthesis and Characterization”. Rename one of them (Data section ▸ General procedures).', place: ['section', s.id], field: '' },
      { check: 'gp_name', message: 'General procedure “general procedure  a” (in “Synthesis and Characterization”) has the same name as “General Procedure A” in “Synthesis and Characterization”. Rename one of them (Data section ▸ General procedures).', place: ['section', s.id], field: '' },
      { check: 'reference', message: 'Reference “Smith 2010”: the author line “Smith, A.; Jones, B.” looks like several authors; put one author per line. Edit it on the References page.', place: ['references', 'references'], field: '' },
    ]);
  });

  it('says why an X-ray structure cannot be drawn', async () => {
    const { xrayError } = await import('../src/si/project-warnings');
    const p = await SiProject.open(folder('si-example'));
    const s = { id: 's-x', type: 'xray', name: 'X', folder: 'sections/s-x', data: {}, items: [], children: [], parentId: null };
    expect(await xrayError(p, s)).toBe('No CIF file has been chosen yet.');
    s.data = { file: 'crystal.cif' };
    expect(await xrayError(p, s)).toBe('The CIF file crystal.cif is missing from the section\'s folder.');
    (p.folder as MemoryFolder).files.set('sections/s-x/crystal.cif', enc('data_x\n_cell_length_a 5\n'));
    expect(await xrayError(p, s)).toBe('crystal.cif holds no structure (no _atom_site_ table).');
  });
});

describe('the project dashboard', () => {
  it('lists required NMR data and spectra still missing by nucleus, in field order, and counts the project warnings', async () => {
    const { buildRows, fieldLabel, projectScope, sectionScope, summarize } = await import('../src/si/dashboard');
    const { valuesOf } = await import('../src/si/project');
    const p = await SiProject.open(folder('si-example'));
    const a = p.compound('c-26c39a99');
    const v = valuesOf(a) as Record<string, unknown>;
    v.nmr = (v.nmr as Record<string, unknown>[]).map((r) => (r.nucleus === '13C' ? { ...r, text: '' } : r));
    v.spectra = (v.spectra as Record<string, unknown>[]).filter((i) => i.type !== '13C');
    const b = p.compounds.find((c) => c.id !== a.id && c.sectionId === a.sectionId)!;
    (valuesOf(b) as Record<string, unknown>).yield = {};
    const warn = new Map([[a.id, [{ check: 'hrms', field: 'hrms', message: '' }, { check: 'id', field: 'id', message: '' }]], [b.id, [{ check: 'hrms', field: 'hrms', message: '' }]]]);
    const f = { idOf: () => '', warnings: (c: { id: string }) => warn.get(c.id) ?? [], label: (r: string) => r, formula: () => null, hrmsPpm: () => null };
    const rows = buildRows(p, projectScope(p), f);
    const s = p.section(a.sectionId);
    const sum = summarize(p, p.dataSections.map((x) => [x, rows.filter((r) => r.compound.sectionId === x.id)]), [{ check: 'xray' }, { check: 'label' }]);
    expect(sum.missing).toEqual([[fieldLabel(sectionScope(s), 'yield'), 1], ['¹³C NMR', 1], ['¹³C spectrum', 1]]);
    expect(sum.warnings).toEqual([['Compound IDs', 1], ['HRMS', 2], ['Duplicate labels', 1], ['X-ray structures that can’t be drawn', 1]]);
  });
});

describe('isotope patterns of heavy-metal ions', () => {
  it('are worked out quickly (Sn₆Br₆, a Mo/W cluster), most intense first', () => {
    const t = performance.now();
    const sn = isotopePattern(infoFromCounts(new Map([['C', 10], ['H', 10], ['Sn', 6], ['Br', 6]])), '[M+H]+', 1, 12);
    isotopePattern(infoFromCounts(new Map([['C', 20], ['H', 20], ['Mo', 4], ['W', 2], ['Cl', 4]])), '[M+Na]+', 1, 12);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(sn.length).toBe(12);
    for (let i = 1; i < sn.length; i++) expect(sn[i].abundance).toBeLessThanOrEqual(sn[i - 1].abundance + 1e-9);
    expect(sn[0].abundance).toBeCloseTo(100, 9);
    // (each peak's formula has the ion's atoms: 6 Sn and 6 Br in all)
    for (const pk of sn) {
      const n = (re: RegExp): number => [...pk.formula.matchAll(re)].reduce((s, m) => s + Number(m[1] || 1), 0);
      expect(n(/(?:\[\d+Sn\]|Sn)(\d*)/g)).toBe(6);
      expect(n(/(?:\[\d+Br\]|Br)(\d*)/g)).toBe(6);
    }
  });
});
