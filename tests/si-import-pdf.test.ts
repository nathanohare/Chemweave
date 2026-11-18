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
