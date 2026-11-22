// Fixes from the review of compiling an SI project: citations in tables, portrait pages after
// the Spectra section, structure files read only for what prints, the HRMS reports' headings and
// page breaks, damaged reports, pasted-picture schemes, PDFs in table cells and the live preview.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { compileSi, objectLabels, objectLabelSets, type CompileHost, type PagePicture } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import type { DocText } from '../src/document/document';

const ROOT = join(__dirname, 'fixtures', 'si-example');
const TABLE = 'sections/s-c1aa3466_reaction-optimizatio/tables/t-1ece4eb2.json';
const DATA = 'sections/s-972b3c47_synthesis-and-charac/compounds';
const C2D = `${DATA}/c-1eebe878_1-4-chlorophen`;

function fixture(): MemoryFolder {
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(ROOT, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(ROOT);
  return f;
}
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const put = (f: MemoryFolder, rel: string, v: unknown): void => { f.files.set(rel, new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v, null, 2))); };
const host: CompileHost = { contentsOf: () => null, sizeOf: () => null, facts: async (m) => m.map(() => null) };
const drawingHost: CompileHost = { ...host, contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; } };
const lines = (d: DocText): string[] => plainText(d.runs).split('\n');
const pages = (n: number): PagePicture[] => Array.from({ length: n }, () => ({ src: 'data:image/png;base64,AAAA', w: 612, h: 792, of: n }));

/** The example project with 2d's reports set (and printed). */
function withReports(f: MemoryFolder, reports: string[]): void {
  const c = json(f, `${C2D}/compound.json`);
  const v = c.values as Json;
  v.hrms = { ...(v.hrms as Json), reports: reports.map((file) => ({ file, kind: 'file' })), print_reports: true };
  put(f, `${C2D}/compound.json`, c);
}

describe('compiling an SI project (review fixes)', () => {
  it('prints citations typed in a table’s cells and footnotes, numbered and listed', async () => {
    const f = fixture();
    const t = json(f, TABLE);
    t.footnotes = ['^{a} Conditions as reported before.@cite{r-deadbeef}'];
    (t.rows as Json[][])[1][2] = { text: 'MeOH@cite{r-feedface}' };
    put(f, TABLE, t);
    const refs = json(f, 'references.json') as unknown as Json[];
    for (const id of ['r-deadbeef', 'r-feedface']) refs.push({ id, type: 'article', authors: ['Doe, J.'], title: 'Cited in a table', journal: 'J. Test', year: '2020', volume: '1', issue: '', pages: '1', doi: '', url: '', publisher: '', note: '' });
    put(f, 'references.json', refs);
    const { doc, notes } = await compileSi(await SiProject.open(f), host);
    // the footnote's citation is in the text; the cell's in the table
    const top = doc.runs.filter((r) => r.obj !== undefined).map((r) => doc.objects[r.obj!]).flatMap((o) => (o?.kind === 'cite' ? o.refs : []));
    expect(top).toContain('r-deadbeef');
    const table = Object.values(doc.objects).find((o) => o.kind === 'table')!;
    const inCells = table.kind === 'table' ? table.table.rows.flat().flatMap((c) => c.runs).filter((r) => r.obj !== undefined).map((r) => doc.objects[r.obj!]) : [];
    expect(inCells.some((o) => o?.kind === 'cite' && o.refs.includes('r-feedface'))).toBe(true);
    expect(lines(doc)).toContain('a Conditions as reported before.￼');
    expect(notes.filter((n) => /citation/i.test(n))).toEqual([]);
    expect(Object.values(doc.objects).some((o) => o.kind === 'bib')).toBe(true);
  });

  it('turns the pages back to portrait for a section after a landscape Spectra section', async () => {
    const f = fixture();
    for (const k of [...f.files.keys()].filter((x) => x.endsWith('compound.json'))) {
      const c = json(f, k);
      for (const s of (c.values as { spectra?: { file: string }[] }).spectra ?? []) f.files.set(k.replace('compound.json', `spectra/${s.file}`), new Uint8Array([37, 80, 68, 70]));
    }
    put(f, 'sections/s-0000aaaa_crystal/section.json', { id: 's-0000aaaa', type: 'text', name: 'Crystallographic Details' });
    put(f, 'sections/s-0000aaaa_crystal/content.txt', 'Crystals were grown from hexane.');
    const pj = json(f, 'project.json');
    (pj.section_tree as unknown[]).push({ id: 's-0000aaaa' });
    put(f, 'project.json', pj);
    const { doc } = await compileSi(await SiProject.open(f), { ...host, pdfPages: async () => pages(1) });
    const ls = lines(doc);
    const at = ls.indexOf('Crystallographic Details');
    expect(at).toBeGreaterThan(0);
    let page = doc.page, landscapeSeen = false;
    for (let i = 0; i <= at; i++) {
      const pg = doc.paras[i]?.section?.page;
      if (pg) { page = pg; if (pg.w > pg.h) landscapeSeen = true; }
    }
    expect(landscapeSeen).toBe(true);
    expect(page.w < page.h).toBe(true);
  });

  it('gives each table its own automatic label beside a typed one', async () => {
    const f = fixture();
    const rel = 'sections/s-c1aa3466_reaction-optimizatio/tables/t-1ece4eb2.json';
    const t = JSON.parse(new TextDecoder().decode(f.files.get(rel)!));
    f.files.set(rel, new TextEncoder().encode(JSON.stringify({ ...t, label: 'Table A' })));
    const { labels, auto } = await objectLabelSets(await SiProject.open(f));
    expect(labels.get('t-1ece4eb2')).toBe('Table A');
    expect(auto.get('t-1ece4eb2')).toBe('Table S1');
  });

  it('reads structure files only for the compounds that print', async () => {
    const f = fixture();
    const p = await SiProject.open(f);
    const reads: string[] = [];
    const orig = f.readText.bind(f);
    f.readText = async (rel: string) => { reads.push(rel); return orig(rel); };
    const facts: string[][] = [];
    const counting: CompileHost = { ...host, facts: async (m) => { facts.push(m); return m.map(() => null); } };
    // the labels (worked out each time a page is shown) need no structures at all
    const labels = await objectLabels(p);
    expect(labels.get('t-1ece4eb2')).toBe('Table S1');
    expect(reads.filter((r) => r.endsWith('structure.mol'))).toEqual([]);
    // the live preview of one compound reads its own structure (for its facts and its drawing)
    const c = p.compounds.find((x) => !x.schemeId)!;
    reads.length = 0;
    await compileSi(p, counting, { kind: 'compound', id: c.id });
    expect(new Set(reads.filter((r) => r.endsWith('structure.mol')))).toEqual(new Set([`${c.folder}/structure.mol`]));
    expect(facts.at(-1)?.length).toBe(1);
    // the whole SI: every compound that prints, but not those of a section left out
    const sid = p.dataSections[0].id;
    p.settings.export_excluded = [sid];
    facts.length = 0;
    await compileSi(p, counting);
    expect(facts.flat().length).toBe(0);
  });

  it('prints a scheme page made as one pasted picture as SI Assistant does', async () => {
    const f = fixture();
    const rel = `${DATA}/k-95c635ac_acetylation-of/scheme.json`;
    put(f, rel, { id: 'k-95c635ac', name: 'Acetylation (pasted)', children: ['c-6c300e43'], image: 'scheme.png', labels: [] });
    const p = await SiProject.open(f);
    const before = (await compileSi(p, drawingHost)).doc;
    const drawings = Object.values(before.objects).filter((o) => o.kind === 'drawing' && o.alt === 'Acetylation (pasted)');
    expect(drawings.length).toBe(1);
    const { notes } = await compileSi(p, drawingHost);
    expect(notes.some((n) => /pasted picture, which isn’t printed/.test(n))).toBe(true);
    // nothing written: the upgrade is only for printing
    expect(json(f, rel).mode).toBeUndefined();
  });

  it('prints the HRMS reports heading only when a report prints', async () => {
    const f = fixture();
    withReports(f, ['gone.csv']);
    const { doc, notes } = await compileSi(await SiProject.open(f), host);
    expect(lines(doc)).not.toContain('HRMS reports');
    expect(notes.some((n) => /gone\.csv is missing/.test(n))).toBe(true);
  });

  it('says a damaged HRMS data file in the notes, without stopping the compile', async () => {
    const f = fixture();
    withReports(f, ['broken.mzML']);
    put(f, `${C2D}/hrms/broken.mzML`, '<?xml version="1.0"?><mzML><run><spectrumList count="1">');
    const { doc, notes } = await compileSi(await SiProject.open(f), host);
    expect(lines(doc)).toContain('HRMS reports');
    expect(notes.some((n) => /broken\.mzML could not be read/.test(n))).toBe(true);
  });

  it('puts the first page of the first HRMS report under the heading', async () => {
    const f = fixture();
    withReports(f, ['report.pdf']);
    f.files.set(`${C2D}/hrms/report.pdf`, new Uint8Array([37, 80, 68, 70]));
    const { doc } = await compileSi(await SiProject.open(f), { ...host, pdfPages: async () => pages(2) });
    const ls = lines(doc);
    const one = ls.findIndex((l) => /HRMS report: report\.pdf \(page 1 of 2\)/.test(l));
    const two = ls.findIndex((l) => /HRMS report: report\.pdf \(page 2 of 2\)/.test(l));
    expect(ls[one - 1]).toBe('HRMS reports');
    expect(doc.paras[one].pageBreak).toBeFalsy();
    expect(doc.paras[two].pageBreak).toBe(true);
  });

  it('draws only the first page of a PDF in a table cell; the live preview places PDFs and says what it leaves out', async () => {
    const f = fixture();
    const t = json(f, TABLE);
    (t.rows as Json[][])[1][1] = { text: 'NaBH_{4}', image: 'images/trace.pdf' };
    put(f, TABLE, t);
    f.files.set('sections/s-c1aa3466_reaction-optimizatio/images/trace.pdf', new Uint8Array([37, 80, 68, 70]));
    const asked: (number | undefined)[] = [];
    const pdfHost: CompileHost = { ...host, pdfPages: async (_b, most) => { asked.push(most); return pages(most ?? 5); } };
    const p = await SiProject.open(f);
    await compileSi(p, pdfHost);
    expect(asked).toEqual([1]);
    // the preview of the section: the picture is placed (no “desktop app” note), its other pages said
    const { doc, notes } = await compileSi(p, { ...host, pdfPages: async (_b, most) => pages(5).slice(0, most ?? 5).map((x) => ({ ...x, of: 5 })) }, { kind: 'section', id: 's-c1aa3466' });
    expect(Object.values(doc.objects).some((o) => o.kind === 'table')).toBe(true);
    expect(notes.some((n) => /desktop app/.test(n))).toBe(false);
    expect(notes.some((n) => /live preview shows the first page of trace\.pdf \(it has 5\)/.test(n))).toBe(true);
  });
});
