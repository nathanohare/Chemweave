// @vitest-environment jsdom
// Import SI, writing into a project: SI Assistant's own tests of it (tests/test_si_import.py and
// test_si_import_text.py, "writing"), on the same made-up inputs.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { JournalFolder } from '../src/si/journal';
import { SiProject, compoundName, compoundsOf, fieldKeys, idTableOf, valuesOf, type Json, type SiSection } from '../src/si/project';
import { parseMarkup } from '../src/si/markup';
import * as Rd from '../src/si/si-import-read';
import * as I from '../src/si/si-import';
import * as A from '../src/si/si-import-apply';
import type { ImportedSection } from '../src/si/si-import-text';

const para = (markup: string): Rd.Para => Rd.newPara(Rd.mergeRuns(parseMarkup(markup)[0].runs));

function threeCompounds(): Rd.Para[] {
  const out = [para('**General Procedure B: Methylation of phenols**'),
    para('To a solution of the phenol (0.50 mmol, 1.0 equiv) in acetone (2.0 mL) were added K_{2}CO_{3} (138 mg, 1.00 mmol) and MeI (47 µL, 0.75 mmol).')];
  const data: [string, string, string, number, string, number, number][] = [
    ['5a', '1-Methoxy-4-methylbenzene', '4-methylphenol', 54.1, 'colorless oil', 49.5, 81],
    ['5b', '1-Bromo-4-methoxybenzene', '4-bromophenol', 86.5, 'colorless oil', 79.6, 85],
    ['5c', '4-Methoxybenzonitrile', '4-hydroxybenzonitrile', 59.6, 'white solid', 58.9, 88]];
  for (const [cid, name, sm, mass, state, got, pct] of data) {
    const sid = cid.replace('5', '4');
    out.push(para(`**${name} (${cid}).** Prepared according to General Procedure B from ${sm} (${sid}, ${mass} mg, 0.50 mmol). The crude product was purified `
      + `by flash column chromatography (SiO_{2}, 5% EtOAc/hexanes). ${state[0].toUpperCase() + state.slice(1)} (${got} mg, ${pct}%). Rf = 0.55 (10% `
      + 'EtOAc/hexanes). ^{1}H NMR (400 MHz, CDCl_{3}) δ 7.10 (d, *J* = 8.4 Hz, 2H), 3.78 (s, 3H).'));
  }
  return out;
}

async function newProject(name = 'P'): Promise<{ p: SiProject; j: JournalFolder }> {
  const j = new JournalFolder(new MemoryFolder(name));
  const p = await SiProject.create(j, name);
  return { p, j };
}

/** SI Assistant's Spectra section, as a new project of its has it. */
async function addSpectraSection(p: SiProject): Promise<void> {
  const s: SiSection = { id: 's-spectra1', type: 'spectra', name: 'Spectra', folder: 'sections/s-spectra1_spectra', data: { id: 's-spectra1', type: 'spectra', name: 'Spectra' }, items: [], children: [], parentId: null };
  await p.saveSection(s);
  p.top.push(s);
  await p.saveSettings();
  await p.reload();
}

const shownIds = (p: SiProject): Map<string, string> => {
  const r = p.idReport();
  return new Map(p.compounds.map((c) => [r.ids.get(c.id) ?? '', c.id]));
};
const tree = (ss: SiSection[]): unknown[] => ss.map((x) => [x.name, x.type, tree(x.children)]);

describe('Import SI: writing into a project (as SI Assistant writes it)', () => {
  it('imports into a new section as one undo step', async () => {
    const { p, j } = await newProject();
    const plan = I.analyse([...threeCompounds(), para('**Phenol (9).** Oil (1 mg, 1%). LRMS m/z 94.')]);
    const result = await A.applyPlan(p, plan, 'si.docx');
    const section = p.section(result.section_id);
    expect(section.name).toBe('Synthesis and Characterization');
    expect(idTableOf(section)).toEqual(['5a', '5b', '5c', '9']);
    expect(result.created.length).toBe(4);
    expect(result.gps.length).toBe(1);
    const gp = p.generalProcedures(section)[0];
    expect(String(gp.sentence)).toMatch(/^Prepared according to \{GP\} from/);
    expect(await p.readGpText(section, String(gp.id))).toMatch(/^To a solution of the phenol/);
    const c = p.compound(result.created[0]);
    expect(compoundName(c)).toBe('1-Methoxy-4-methylbenzene');
    expect(valuesOf(c).procedure).toEqual({ gp: gp.id, values: { 'starting material': '4-methylphenol', 'starting material ID': '4a', mass: '54.1' } });
    expect((valuesOf(c).purification as Json).method).toBe('flash column chromatography');
    expect(fieldKeys(c).slice(0, 4)).toEqual(['structure', 'name', 'procedure', 'scale']);
    expect(p.idReport().ids.get(c.id)).toBe('5a');
    const phenol = p.compound(result.created[3]);
    expect(p.compoundText(phenol, 'notes')).toContain('LRMS m/z 94.');
    expect(p.compoundText(phenol, 'notes')).toContain('Imported from si.docx, not recognized:');
    expect(await j.undo()).toBe('Import SI from si.docx');
    await p.reload();
    expect(p.dataSections.map((s) => s.id)).not.toContain(result.section_id);
  });

  it('fills only the empty fields of a compound already in an existing section', async () => {
    const { p } = await newProject();
    const data = await p.addSection('data', 'Products');
    await p.setIdTable(data.id, ['5a', '7', '8']);           // 7 and 8: IDs no page has yet
    const mine = await p.addCompound(data.id, undefined, 'My name');
    valuesOf(mine).yield = { percent: '90', mass: '55.0', mass_unit: 'mg' };
    await p.addField(mine, { key: 'yield' });
    const result = await A.applyPlan(p, I.analyse(threeCompounds()), 'si.pdf', { sectionId: data.id });
    expect(result.merged['5a']).toContain('Yield');
    expect((valuesOf(mine).yield as Json).percent).toBe('90');       // typed: kept
    expect(compoundName(mine)).toBe('My name');
    expect((valuesOf(mine).rf as Json).value).toBe('0.55');          // empty: filled
    const r = p.idReport();
    expect(compoundsOf(p.section(data.id)).map((c) => r.ids.get(c.id))).toEqual(['5a', '5b', '5c']);
    expect(idTableOf(p.section(data.id)).slice(3)).toEqual(['7', '8']);   // the unused IDs moved down
  });

  it('prints exactly as imported', async () => {
    const { p } = await newProject();
    const result = await A.applyPlan(p, I.analyse(threeCompounds()), 'si.pdf', { mode: A.PRINT_AS_IMPORTED });
    const c = p.compound(result.created[1]);
    expect(fieldKeys(c)).toContain('si_text');
    expect(p.compoundText(c, 'si_text')).toMatch(/^Prepared according to General Procedure B from 4-bromophenol/);
  });

  it('leaves out what was unticked', async () => {
    const { p } = await newProject();
    const plan = I.analyse(threeCompounds());
    plan.gps[0].keep = false;
    plan.compounds[1].keep = false;
    const result = await A.applyPlan(p, plan, 'si.pdf');
    expect(result.created.length).toBe(2);
    expect(result.gps).toEqual([]);
    const c = p.compound(result.created[0]);
    // Its general procedure was left out: the sentence stays in its own text.
    expect((valuesOf(c).procedure as Json | undefined)?.gp).toBeUndefined();
    expect(p.compoundText(c, 'procedure')).toMatch(/^Prepared according to General Procedure B from 4-methylphenol/);
  });
});

// The made-up Word SI of SI Assistant's tests ("Invented SI.docx").
const WORD = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'si-import', 'files', '758d213204.docx')));
const wordPlan = (): I.ImportPlan => {
  const read = Rd.readSiDocx('Invented SI.docx', WORD);
  expect(read.error).toBeFalsy();
  return I.analyse(read.paras);
};

describe('Import SI: a Word SI with sections, figures, tables and references', () => {
  it('goes into a new project', async () => {
    const plan = wordPlan();
    const { p, j } = await newProject();
    await addSpectraSection(p);
    const res = await A.applyPlan(p, plan, 'Invented SI.docx');
    expect([res.general, res.references, res.figures, res.tables]).toEqual([true, 3, 1, 1]);
    expect(res.cover).toEqual(['title', 'authors', 'affiliations']);
    const s = p.settings;
    expect(s.title).toBe('Invented Esters: A Test SI');
    const authors = s.authors as Json[];
    expect(authors.map((a) => a.name)).toEqual(['Ada Lovelace', 'Charles Babbage', 'Grace Hopper']);
    expect(authors[2].email).toBe('grace.hopper@example.org');
    expect(tree(p.top)).toEqual([
      ['Optimization', 'text', []],
      ['Synthesis', 'text', [['Starting Materials', 'text', [['Compounds', 'data', []]]], ['Products', 'data', []]]],
      ['Spectra', 'spectra', []]]);                 // (new sections before the spectra)
    const ids = p.references.map((x) => String(x.id));
    expect(await p.readFrontText('general')).toBe(`Solvents were dried as reported.@cite{${ids[0]}} Reactions were monitored by TLC@cite{${ids[2]}}.\n# Solvents\nTHF was distilled from sodium.`);
    const optimization = p.top[0];
    const text = await p.readSectionText(optimization);
    const figs = await p.ownerFigures(optimization);
    const figureId = Object.keys(figs)[0];
    const entry = figs[figureId] as Json;
    expect(entry.label).toBe('Figure S1');
    expect(entry.width).toBeCloseTo(7.62, 2);
    expect(String(entry.file)).toMatch(/^images\/figure\.(png|jpe?g)$/);
    const tableId = text.split('!table{')[1].split('}')[0];
    const table = (await p.readTable(optimization, tableId))!;
    expect(table.label).toBe('Table S1');
    expect(table.footnotes).toEqual(['^{a} Isolated yield.']);
    expect(text).toContain(`!figure{${figureId}} The reaction setup.`);
    const byId = shownIds(p);
    expect((valuesOf(p.compound(byId.get('1a')!)).references as Json).refs).toEqual([ids[1]]);
    expect((valuesOf(p.compound(byId.get('2a')!)).procedure as Json).gp).toBeTruthy();   // (linked to its procedure)
    await j.undo();                                  // (one step)
    await p.reload();
    expect(p.top.map((x) => x.name)).toEqual(['Spectra']);
    expect(p.references).toEqual([]);
    expect(await p.readFrontText('general')).toBe('');
  });

  it('goes into the open project: its own General Information, references and cover kept', async () => {
    const plan = wordPlan();
    const { p } = await newProject();
    await p.writeFrontText('general', 'Our own text.');
    const have = await p.addReference({ type: 'article', title: 'Ours', doi: '10.1021/jo0000001' });
    p.settings.authors = [{ name: 'Someone Else', affiliations: [], corresponding: true, email: '' }];
    await p.saveSettings();
    const section = await p.addSection('data', 'Our compounds');
    const res = await A.applyPlan(p, plan, 'Invented SI.docx', { sectionId: section.id });
    expect([res.references, res.references_known]).toEqual([2, 1]);
    expect(await p.readFrontText('general')).toMatch(new RegExp(`^Our own text\\.\\n\\nSolvents were dried as reported\\.@cite\\{${have}\\}`));
    expect((p.settings.authors as Json[]).map((a) => a.name)).toEqual(['Someone Else']);
    expect(res.cover).not.toContain('authors');
    // all the compounds go into the chosen section; the other sections are added
    expect(compoundsOf(p.section(section.id)).length).toBe(3);
    expect(p.top.map((x) => x.name)).toEqual(['Our compounds', 'Optimization', 'Synthesis']);
  });

  it('leaves out unticked sections, figures and references', async () => {
    const plan = wordPlan();
    const sections = new Map((plan.sections as ImportedSection[]).map((s) => [s.name, s]));
    sections.get('Optimization')!.keep = false;
    sections.get('Synthesis')!.keep = false;           // (its sub-sections move up)
    sections.get('NMR Spectra')!.keep = true;          // (ticked by hand: imported)
    plan.references[1].keep = false;
    plan.cover.keep = false;
    const { p } = await newProject();
    const res = await A.applyPlan(p, plan, 'Invented SI.docx');
    expect(p.top.map((x) => x.name)).toEqual(['Starting Materials', 'Products', 'NMR Spectra']);
    expect(res.references).toBe(2);
    expect(res.cover).toEqual([]);
    const byId = shownIds(p);
    expect(((valuesOf(p.compound(byId.get('1a')!)).references as Json).refs as unknown[] | undefined) ?? []).toEqual([]);   // (its reference left out)
  });
});
