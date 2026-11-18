// @vitest-environment node
// Import SI reading a PDF: the example SI that Chem SI Assistant compiles from its example project
// (tests/fixtures/si-import-pdf/example-si.pdf) is read back into the same compounds (as SI
// Assistant's own test_the_example_si_pdf_is_read_back checks).

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSiPdf, paraText, type ReadResult } from '../src/si/si-import-read';
import { analyse, type ImportPlan } from '../src/si/si-import';
import type { ImportedSection } from '../src/si/si-import-text';
import type { ImportedReference } from '../src/si/si-import-refs';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, compoundName, compoundsOf, valuesOf, type Json } from '../src/si/project';
import { displayId } from '../src/si/compound-ids';
import { PdfPages, addFigures, addPictures, type Box, type Cut } from '../src/si/si-import-pdf';
import { pdfSpectra } from '../src/si/si-import-spectra';
import { applyPlan } from '../src/si/si-import-apply';

function exampleFolder(): MemoryFolder {
  const root = join(__dirname, 'fixtures', 'si-example');
  const f = new MemoryFolder('si-example');
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

let read: ReadResult, plan: ImportPlan;
beforeAll(async () => {
  read = await readSiPdf('Example SI.pdf', new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'si-import-pdf', 'example-si.pdf'))));
  plan = analyse(read.paras);
}, 60_000);

describe('Import SI: reading a PDF', () => {
  it('reads the example SI back', async () => {
    expect(read.error).toBe('');
    expect(read.spectrum_pages.length).toBe(15);                  // set aside (spectra)
    expect(read.paras.some((p) => /^(?:page\s*)?S?\s?-?\d{1,4}(?:\s*(?:of|\/)\s*\d+)?$/i.test(paraText(p)))).toBe(false);   // no "S4" footers
    expect(plan.section_name).toBe('Synthesis and Characterization');
    expect(plan.compounds.map((c) => c.cid)).toEqual(['2a', '2b', '2c', '2d', '2e', '2f', '3']);
    expect(plan.compounds.filter((c) => c.unrecognised.length).map((c) => [c.cid, c.unrecognised])).toEqual([]);
    const gp = plan.gps[0];
    expect([gp.name, gp.title]).toEqual(['General Procedure A', 'Reduction of aryl methyl ketones with NaBH4']);
    expect(gp.sentence).toBe('Prepared according to {GP} from {starting material} (**{starting material ID}**, {mass} mg, {scale}).');
    // Each compound as in the project the example was made from.
    const shipped = await SiProject.open(exampleFolder());
    const report = shipped.idReport();
    const byId = new Map(shipped.sections.flatMap((s) => compoundsOf(s)).map((c) => [displayId(report, c.id), c]));
    for (const c of plan.compounds) {
      const orig = byId.get(c.cid)!;
      const ov = valuesOf(orig) as Json;
      expect(c.name).toBe(compoundName(orig));
      for (const key of ['yield', 'physical_state', 'rf']) {
        if (!(key in ov)) continue;
        const nonEmpty = (v: Json = {}): Json => Object.fromEntries(Object.entries(v).filter(([, x]) => x));
        expect([c.cid, key, nonEmpty(c.values[key])]).toEqual([c.cid, key, nonEmpty(ov[key])]);
      }
      expect([c.cid, c.values.nmr.map((r: Json) => r.text)]).toEqual([c.cid, (ov.nmr as Json[]).map((r) => r.text)]);
      expect(c.values.hrms.found).toBe(ov.hrms.found);
      expect(c.values.hrms.adduct).toBe(ov.hrms.adduct);
    }
  });

  it('reads its outline: cover, contents, sections, a table and the references', () => {
    const sections = plan.sections as ImportedSection[];
    const byKey = new Map(sections.map((s) => [s.key, s]));
    expect(sections.map((s) => [s.kind, s.name, s.parent ? byKey.get(s.parent)!.name : '', s.keep])).toEqual([
      ['toc', 'Table of Contents', '', false],
      ['general', 'General Information', '', true],
      ['text', 'Reaction Optimization', '', true],
      ['text', 'Synthesis and Characterization', '', true],
      ['data', 'Compounds', 'Synthesis and Characterization', true],
      ['references', 'References', '', true]]);
    const general = sections[1].text;
    expect(general.startsWith('**About this example.**')).toBe(true);
    expect(general).toContain('\n# *General methods*\n');
    expect(general).toContain('\n# *Abbreviations*\n');
    expect(plan.cover.title.startsWith('Sodium Borohydride Reduction of Aryl Methyl Ketones')).toBe(true);
    expect(plan.cover.authors.map((a: { name: string }) => a.name)).toEqual(['Alex Example', 'Blair Sample']);
    const refs = plan.references as ImportedReference[];
    expect(refs.length).toBe(7);
    expect(refs.every((r) => r.ref.doi)).toBe(true);
    // a table's rows are not run into its caption
    const table = sections.flatMap((s) => [...s.figures.values()]).find((f) => f.label === 'Table S1')!;
    expect(table.caption).toBe('Optimization of the reduction of 4′-bromoacetophenone');
    expect(table.is_table).toBe(true);
    expect(table.bottom).toBeGreaterThan(table.top + 100);
  });
});

// ---------------------------------------------------------------------- pictures cut out of the pages

/** The example's pages, each cut "drawn" as a picture the size of its box (no canvas here to draw on). */
class BoxPages extends PdfPages {
  cuts: [number, Box][] = [];
  async cut(n: number, box: Box): Promise<Cut | null> {
    this.cuts.push([n, box]);
    return { data: new Uint8Array([137, 80, 78, 71]), ext: '.png', w: box[2] - box[0], h: box[3] - box[1] };
  }
}
const pages = async (): Promise<BoxPages> => (await BoxPages.open(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'si-import-pdf', 'example-si.pdf')))))! as BoxPages;

describe('Import SI: pictures cut out of a PDF', () => {
  it('cuts each compound’s structure out of its page', async () => {
    const pdf = await pages();
    const p = analyse(read.paras);
    expect(await addPictures(pdf, p)).toBe(7);
    expect(p.compounds[0].picture_ext).toBe('.png');
    expect(p.compounds[0].structure_note).toContain('between its heading and its text');
    pdf.close();
  });

  it('cuts the figures and tables out of their pages', async () => {
    const pdf = await pages();
    const p = analyse(read.paras);
    expect(await addFigures(pdf, p)).toBe(3);
    const figures = new Map((p.sections as ImportedSection[]).flatMap((s) => [...s.figures.values()]).filter((f) => f.data).map((f) => [f.label, f]));
    expect([...figures.keys()].sort()).toEqual(['Scheme S1', 'Scheme S2', 'Table S1']);
    for (const f of figures.values()) expect(f.width_cm! > 5 && f.width_cm! < 17).toBe(true);
    // the scheme's picture starts below the general procedure above it on its page
    const gp = p.gps[0], scheme = figures.get('Scheme S1')!;
    expect(gp.end[0]).toBe(scheme.page);
    expect(scheme.top).toBeGreaterThan(gp.end[1]);
    pdf.close();
  });

  it('cuts the spectrum pages at their headers, each with its compound', async () => {
    const pdf = await pages();
    const p = analyse(read.paras);
    const spectra = await pdfSpectra(pdf, p, read.spectrum_pages);
    expect(spectra.length).toBe(15);
    expect(spectra.every((s) => s.cid)).toBe(true);
    expect(spectra.slice(0, 3).map((s) => [s.cid, s.type])).toEqual([['2a', '1H'], ['2a', '13C'], ['2b', '1H']]);
    expect(spectra[0].title).toBe('2a — 1H NMR (500 MHz, CDCl3)');
    expect(spectra.map((s) => `${s.cid} ${s.type}`)).toContain('2c 19F');
    expect(spectra.every((s) => s.shows_structure)).toBe(true);
    // stored without a second structure (the page shows it)
    p.spectra = spectra;
    const project = await SiProject.create(new MemoryFolder('P'), 'P');
    const result = await applyPlan(project, p, 'Example SI.pdf');
    expect(result.spectra).toBe(15);
    const items = valuesOf(project.compound(result.created[0])).spectra as Json[];
    expect(items.map((i) => i.type)).toEqual(['1H', '13C']);
    expect(items.every((i) => String(i.file).endsWith('.png'))).toBe(true);
    expect(items.every((i) => (i.layout as Json | undefined)?.struct_box === false)).toBe(true);
    pdf.close();
  });
});
