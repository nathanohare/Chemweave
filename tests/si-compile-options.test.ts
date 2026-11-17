// The compiled SI's options Lauren added to SI Assistant, rewritten from how they behave:
// heading numbers, cover spacing, pictures in table cells and italic prefixes in titles.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, coverSpacing } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import type { DocText } from '../src/document/document';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

function folder(): MemoryFolder {
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
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const put = (f: MemoryFolder, rel: string, v: unknown): void => { f.files.set(rel, new TextEncoder().encode(JSON.stringify(v))); };

async function compile(f: MemoryFolder): Promise<DocText> {
  const p = await SiProject.open(f);
  return (await compileSi(p, {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => null,
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  })).doc;
}

/** The text of each heading paragraph (Heading 1–3 and SI Heading 1–3). */
const headings = (t: DocText): string[] => plainText(t.runs).split('\n').filter((_, i) => /Heading/i.test(t.paras[i]?.style ?? '') && !/TocHeading/.test(t.paras[i]?.style ?? ''));

describe('heading numbers', () => {
  it('follows the journal style unless chosen', async () => {
    const f = folder();
    const acs = headings(await compile(f));
    expect(acs.some((h) => /^\d+\.\s/.test(h))).toBe(false);
    put(f, 'project.json', { ...json(f, 'project.json'), journal_style: 'Wiley' });
    const wiley = headings(await compile(f));
    expect(wiley).toContain('1. Reaction Optimization');
    expect(wiley).toContain('2. Synthesis and Characterization');
    // the General Information heading is not numbered by the style
    expect(wiley).toContain('General Information');
  });

  it('numbers as an outline or 1.1.1, with the headings typed in texts and General Information', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), heading_numbers: 'decimal' });
    const dec = headings(await compile(f));
    expect(dec).toContain('1. General Information');
    expect(dec).toContain('2. Reaction Optimization');
    put(f, 'project.json', { ...json(f, 'project.json'), heading_numbers: 'outline' });
    const out = headings(await compile(f));
    expect(out).toContain('2. Reaction Optimization');
    put(f, 'project.json', { ...json(f, 'project.json'), journal_style: 'RSC', heading_numbers: 'none' });
    expect(headings(await compile(f)).some((h) => /^\d+\.\s/.test(h))).toBe(false);
  });

  it('numbers in a format of Chemweave’s (Project Settings ▸ Headings)', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), heading_numbers: 'outline', heading_format: { levels: ['I', 'A', '1'], chain: false, end: ')', text: false } });
    const got = headings(await compile(f));
    expect(got).toContain('I) Reaction Optimization');
    expect(got).toContain('General Information');
  });
});

describe('page header and footer', () => {
  it('prints Project Settings ▸ Page: numbers as fields, in their style, none on the cover', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), page: { header: { left: '{title}', center: '', right: '' }, number_prefix: 'SI-', number_style: 'i' } });
    const doc = await compile(f);
    expect(doc.numFormat).toBe('lowerRoman');
    expect(doc.hf.prefix).toBe('SI-');
    expect(doc.hf.firstPage).toBe(true);
    const foot = doc.hf.bodies!.footer!.runs;
    expect(foot.map((r) => r.text).join('')).toBe('\tSI-￼\t');
    const field = foot.find((r) => r.obj !== undefined)!;
    expect(doc.objects[field.obj!]).toEqual({ kind: 'field', code: 'page' });
    expect(plainText(doc.hf.bodies!.header!.runs).length).toBeGreaterThan(2);
  });
});

describe('cover spacing', () => {
  it('multiplies the gaps between the cover’s parts', async () => {
    expect(coverSpacing({})).toBe(1);
    expect(coverSpacing({ cover: { spacing: 2 } })).toBe(2);
    expect(coverSpacing({ cover: { spacing: 40 } })).toBe(6);
    const f = folder();
    const normal = await compile(f);
    const pj = json(f, 'project.json');
    put(f, 'project.json', { ...pj, cover: { ...(pj.cover as Json ?? {}), spacing: 3 } });
    const more = await compile(f);
    expect(more.paras[0]?.spaceAfter).toBe((normal.paras[0]?.spaceAfter ?? 0) * 3);
    expect(more.paras[1]?.spaceAfter).toBe(42);
  });
});

describe('pictures in table cells', () => {
  it('prints a cell’s picture above its text, at the width typed for it', async () => {
    const f = folder();
    const rel = 'sections/s-c1aa3466_reaction-optimizatio/tables/t-1ece4eb2.json';
    const t = json(f, rel);
    const rows = t.rows as Json[][];
    rows[1][1] = { ...rows[1][1], image: 'images/scheme.svg', image_width: 5.08 };
    put(f, rel, t);
    f.files.set('sections/s-c1aa3466_reaction-optimizatio/images/scheme.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100"/></svg>'));
    const doc = await compile(f);
    const table = Object.values(doc.objects).find((o) => o.kind === 'table')!;
    if (table.kind !== 'table') throw new Error();
    const cell = table.table.rows[1][1];
    const pic = doc.objects[cell.runs[0].obj!];
    expect(pic).toMatchObject({ kind: 'picture', w: 144, h: 48 });
    expect(cell.runs[1].text).toBe('\n');
    expect(cell.runs.slice(2).map((r) => r.text).join('')).toContain('NaBH');
  });
});

describe('compound titles', () => {
  it('print the conventional italics of the name', async () => {
    const f = folder();
    const rel = 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan/compound.json';
    const c = json(f, rel);
    ((c.values as Json).name as Json).text = '(S)-1-Phenylethan-1-ol';
    put(f, rel, c);
    const doc = await compile(f);
    const i = doc.runs.findIndex((r, k) => r.text === 'S' && doc.runs[k + 1]?.text.startsWith(')-1-Phenylethan'));
    expect(i).toBeGreaterThan(0);
    expect(doc.runs[i]).toMatchObject({ italic: true, bold: true });
  });
});
