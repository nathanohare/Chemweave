// Code review 2026-11-26, batch 05 (SI builder): the compiled SI and its Live Preview, on the
// example project (made by hand for the tests, tests/fixtures/si-example). No chemistry values.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder, type FolderEntry } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, spectraPagesBefore, type CompileHost } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import type { DocText } from '../src/document/document';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

/** The example project, with each file's size and a time of change (as a folder on disk gives them); readBytes counted. */
class DiskLike extends MemoryFolder {
  reads: string[] = [];
  override async entries(rel: string): Promise<FolderEntry[]> {
    return (await super.entries(rel)).map((e) => (e.folder ? e : { ...e, size: this.files.get(`${rel}/${e.name}`)?.length ?? 0, modified: 1 }));
  }
  override async readBytes(rel: string): Promise<Uint8Array | null> {
    this.reads.push(rel);
    return super.readBytes(rel);
  }
}

function folder(make: (name: string) => MemoryFolder = (n) => new MemoryFolder(n)): MemoryFolder {
  const root = join(__dirname, 'fixtures', 'si-example');
  const f = make('si-example');
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
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const put = (f: MemoryFolder, rel: string, v: unknown): void => { f.files.set(rel, new TextEncoder().encode(JSON.stringify(v))); };

const host = (): CompileHost => ({
  contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
  sizeOf: () => ({ w: 108, h: 79.2 }),
  facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  pdfPages: async () => [{ src: 'data:image/png;base64,AAAA', w: 792, h: 612 }],
});

const OPT = 'sections/s-c1aa3466_reaction-optimizatio/section.json';
const SYNTH_ID = 's-972b3c47';
const C2A = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan';
const lines = (t: DocText): string[] => plainText(t.runs).split('\n');

describe('F212: a landscape section previewed on its own', () => {
  it('turns the preview’s first page, not only the pages after it', async () => {
    const f = folder();
    put(f, OPT, { ...json(f, OPT), orientation: 'landscape' });
    const p = await SiProject.open(f);
    const { doc } = await compileSi(p, host(), { kind: 'section', id: 's-c1aa3466' });
    expect(doc.page.w).toBeGreaterThan(doc.page.h);
    expect(doc.paras[0]?.section).toBeUndefined();
  });
});

describe('F920: the Live Preview of one section numbers its heading as Compile does', () => {
  it('the second top-level section is “2.”, not “1.”', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), journal_style: 'Wiley' });
    const p = await SiProject.open(f);
    // (the whole SI, compiled, numbers it 2. as tests/si-compile-options.test.ts shows)
    const { doc } = await compileSi(p, host(), { kind: 'section', id: SYNTH_ID });
    expect(lines(doc)).toContain('2. Synthesis and Characterization');
  });

  it('a sub-section is previewed at its own level, numbered under its section', async () => {
    const f = folder();
    const proj = json(f, 'project.json');
    put(f, 'project.json', { ...proj, journal_style: 'Wiley', section_tree: [{ id: 's-wide0001', children: [{ id: 's-inner001' }] }, ...(proj.section_tree as Json[])] });
    put(f, 'sections/s-wide0001_wide/section.json', { id: 's-wide0001', type: 'text', name: 'Wide' });
    f.files.set('sections/s-wide0001_wide/content.txt', new TextEncoder().encode('Wide text.'));
    put(f, 'sections/s-inner001_inner/section.json', { id: 's-inner001', type: 'text', name: 'Inner' });
    f.files.set('sections/s-inner001_inner/content.txt', new TextEncoder().encode('Inner text.'));
    const p = await SiProject.open(f);
    const { doc } = await compileSi(p, host(), { kind: 'section', id: 's-inner001' });
    const at = lines(doc).findIndex((l) => l.endsWith('Inner'));
    expect(lines(doc)[at]).toBe('1.1. Inner');
    expect(doc.paras[at]?.style ?? '').toMatch(/2$/);
  });

  it('counts the headings typed in its section’s text before it, as the whole SI does', async () => {
    const f = folder();
    const proj = json(f, 'project.json');
    put(f, 'project.json', { ...proj, heading_format: { levels: ['1'], chain: true, end: '.', text: true }, section_tree: [{ id: 's-wide0001', children: [{ id: 's-inner001' }] }, ...(proj.section_tree as Json[])] });
    put(f, 'sections/s-wide0001_wide/section.json', { id: 's-wide0001', type: 'text', name: 'Wide' });
    f.files.set('sections/s-wide0001_wide/content.txt', new TextEncoder().encode('Wide text.\n# Typed\nMore text.'));
    put(f, 'sections/s-inner001_inner/section.json', { id: 's-inner001', type: 'text', name: 'Inner' });
    f.files.set('sections/s-inner001_inner/content.txt', new TextEncoder().encode('Inner text.'));
    const p = await SiProject.open(f);
    const whole = lines((await compileSi(p, host())).doc);
    const typed = whole.find((l) => l.endsWith('Typed'))!;
    const inner = whole.find((l) => l.endsWith('Inner'))!;
    // (the typed heading is the first under Wide, so Inner is the second)
    expect(typed).toMatch(/^\d+\.1\. Typed$/);
    expect(inner).toMatch(/^\d+\.2\. Inner$/);
    const preview = lines((await compileSi(p, host(), { kind: 'section', id: 's-inner001' })).doc);
    expect(preview).toContain(inner);
  });

  it('a Spectra section is previewed with its number in the SI', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), journal_style: 'Wiley' });
    // (a spectrum file, so the Spectra section, the third top section, prints)
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    const p = await SiProject.open(f);
    const whole = lines((await compileSi(p, host())).doc).find((l) => l.endsWith('Spectra'));
    expect(whole).toBe('3. Spectra');
    const preview = lines((await compileSi(p, host(), { kind: 'section', id: 's-d79a6040' })).doc);
    expect(preview).toContain(whole);
  });
});

describe('F213 and F919: counting the spectra pages before a compound’s', () => {
  it('reads each spectrum file once while it is unchanged', async () => {
    const f = folder((n) => new DiskLike(n)) as DiskLike;
    f.files.set(`${C2A}/spectra/2a_1H.pdf`, new Uint8Array([37, 80, 68, 70]));
    f.files.set(`${C2A}/spectra/2a_13C.pdf`, new Uint8Array([37, 80, 68, 70]));
    const p = await SiProject.open(f);
    const pdfReads = (): number => f.reads.filter((r) => r.endsWith('.pdf')).length;
    // (two PDFs of three pages each, one to a page: six pages before 2b's)
    expect(await spectraPagesBefore(p, host(), 'c-cf3f4417', async () => 3)).toBe(6);
    const first = pdfReads();
    expect(first).toBe(2);
    expect(await spectraPagesBefore(p, host(), 'c-cf3f4417', async () => 3)).toBe(6);
    expect(pdfReads()).toBe(first);
  });

  it('a picture that cannot be placed (a TIFF) is no page', async () => {
    const f = folder();
    const cj = json(f, `${C2A}/compound.json`);
    (cj.values as Json).spectra = [{ file: '2a_1H.tif', type: '1H', title: '', struct_caption: '' }];
    put(f, `${C2A}/compound.json`, cj);
    // (a TIFF's header, "II*\0": TIFF 6.0 specification, section 2)
    f.files.set(`${C2A}/spectra/2a_1H.tif`, new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]));
    const p = await SiProject.open(f);
    expect(await spectraPagesBefore(p, host(), 'c-cf3f4417', async () => 3)).toBe(0);
  });
});
