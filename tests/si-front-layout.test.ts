// The cover page's gaps in points and the table of contents' switches (Nate's SI report
// 2026-11-23, item 3), and the dashboard's columns (item 6): kept beside SI Assistant's one spacing and one depth, which are written
// as the nearest value; SI Assistant's own later change wins over values set before it.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi } from '../src/si/compile-doc';
import { STANDARD_COVER_GAPS, coverGaps, nearestDepth, storeCoverGaps, storeTocLists, tocLists, type TocLists } from '../src/si/front-layout';
import { columnWidths, hiddenFixed, movedColumns, chosenColumns, type Scope } from '../src/si/dashboard';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import type { DocText } from '../src/document/document';

describe('cover gaps', () => {
  it('are the standard gaps times the spacing when none are set', () => {
    expect(coverGaps({})).toEqual(STANDARD_COVER_GAPS);
    expect(coverGaps({ cover: { spacing: 2 } })).toEqual({ above: 0, heading: 28, title: 28, authors: 16, affiliations: 12, emails: 36 });
  });

  it('are kept as a spacing alone when they are the standard ones times one factor', () => {
    const s: Json = {};
    storeCoverGaps(s, { above: 0, heading: 28, title: 28, authors: 16, affiliations: 12, emails: 36 });
    expect(s).toEqual({ cover: { spacing: 2 } });
    storeCoverGaps(s, { ...STANDARD_COVER_GAPS });
    expect(s).toEqual({});
  });

  it('are kept each in points, with the nearest spacing for SI Assistant', () => {
    const s: Json = { cover: { heading: 'SI' } };
    storeCoverGaps(s, { ...STANDARD_COVER_GAPS, above: 72, title: 40 });
    const cover = s.cover as Json;
    expect(cover.heading).toBe('SI');
    expect(cover.spacing).toBe(1.25);
    expect(cover.gaps).toEqual({ above: 72, heading: 14, title: 40, authors: 8, affiliations: 6, emails: 18, for: 1.25 });
    expect(coverGaps(s)).toEqual({ above: 72, heading: 14, title: 40, authors: 8, affiliations: 6, emails: 18 });
  });

  it('give way to a spacing changed in SI Assistant since', () => {
    const s: Json = {};
    storeCoverGaps(s, { ...STANDARD_COVER_GAPS, above: 30 });
    (s.cover as Json).spacing = 3;
    expect(coverGaps(s)).toEqual({ above: 0, heading: 42, title: 42, authors: 24, affiliations: 18, emails: 54 });
  });

  it('never go below 0 or above 400 points', () => {
    expect(coverGaps({ cover: { gaps: { above: -5, title: 9999 } } })).toMatchObject({ above: 0, title: 400, heading: 14 });
  });
});

describe('what the contents list', () => {
  const all = (on: boolean): TocLists => ({ sections: on, subsections: on, headings: on, general: on, procedures: on, compounds: on, spectra: on, hrms: on, references: on });

  it('follows SI Assistant’s depth when no switch is set', () => {
    expect(tocLists({ toc: { depth: 'sections' } })).toMatchObject({ sections: true, subsections: false, procedures: false, compounds: false, general: true, references: true });
    expect(tocLists({ toc: { depth: 'compounds' } })).toEqual(all(true));
    // (older projects: compounds when list_compounds_in_toc, else down to general procedures)
    expect(tocLists({})).toMatchObject({ procedures: true, compounds: false });
    expect(tocLists({ list_compounds_in_toc: true })).toMatchObject({ compounds: true });
  });

  it('are kept as a depth alone when they are what a depth lists', () => {
    const s: Json = { toc: { title: 'Contents' } };
    storeTocLists(s, { ...all(true), compounds: false });
    expect(s.toc).toEqual({ title: 'Contents', depth: 'procedures' });
  });

  it('are kept each, with the nearest depth for SI Assistant', () => {
    const s: Json = {};
    const l = { ...all(true), procedures: false, references: false };
    storeTocLists(s, l);
    expect(s.toc).toEqual({ depth: 'compounds', lists: { ...l, for: 'compounds' } });
    expect(tocLists(s)).toEqual(l);
    expect(nearestDepth({ ...all(false), headings: true })).toBe('subsections');
    expect(nearestDepth(all(false))).toBe('sections');
  });

  it('give way to a depth changed in SI Assistant since', () => {
    const s: Json = {};
    storeTocLists(s, { ...all(true), references: false });
    (s.toc as Json).depth = 'sections';
    expect(tocLists(s)).toMatchObject({ subsections: false, compounds: false, references: true });
  });
});

// ---------------------------------------------------------------- compiled

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

/** The text of each paragraph whose style puts it in the contents (an outline level). */
const listed = (t: DocText): string[] => plainText(t.runs).split('\n').filter((_, i) => t.styles[t.paras[i]?.style ?? '']?.outline !== undefined);

describe('compiled', () => {
  it('spaces the cover as set, above the heading too', async () => {
    const f = folder();
    put(f, 'project.json', { ...json(f, 'project.json'), cover: { gaps: { above: 90, heading: 20, title: 30 } } });
    const doc = await compile(f);
    expect(doc.paras[0]).toMatchObject({ spaceBefore: 90, spaceAfter: 20 });
    expect(doc.paras[1]?.spaceAfter).toBe(30);
  });

  it('lists in the contents only the kinds switched on', async () => {
    const f = folder();
    const pj = json(f, 'project.json');
    put(f, 'project.json', { ...pj, toc: { depth: 'compounds' } });
    const every = listed(await compile(f));
    expect(every).toContain('Synthesis and Characterization');
    expect(every).toContain('References');
    expect(every.some((h) => h.startsWith('1-Phenylethan-1-ol'))).toBe(true);
    const lists = { sections: true, subsections: true, headings: true, general: true, procedures: true, compounds: true, spectra: true, hrms: true, references: false };
    put(f, 'project.json', { ...pj, toc: { depth: 'compounds', lists: { ...lists, compounds: true, procedures: false, for: 'compounds' } } });
    const some = listed(await compile(f));
    expect(some).not.toContain('References');
    expect(some.some((h) => /^General Procedure/.test(h))).toBe(false);
    expect(some.some((h) => h.startsWith('1-Phenylethan-1-ol'))).toBe(true);
    expect(every.some((h) => /^General Procedure/.test(h))).toBe(true);
  });
});

// ---------------------------------------------------------------- the dashboard's columns (item 6)


describe('dashboard columns', () => {
  const scope = (view: Json): Scope => ({ compounds: [], defaultFields: ['yield', 'physical_state', 'rf', 'hrms'].map((key) => ({ key, required: false })) as Scope['defaultFields'], view });

  it('move a field before another, or to the end, keeping the others in order', () => {
    expect(chosenColumns(scope({}))).toEqual(['yield', 'physical_state', 'rf', 'hrms']);
    expect(movedColumns(scope({}), 'hrms', 'yield')).toEqual(['hrms', 'yield', 'physical_state', 'rf']);
    expect(movedColumns(scope({}), 'yield', null)).toEqual(['physical_state', 'rf', 'hrms', 'yield']);
    // (a hidden field stays hidden)
    expect(movedColumns(scope({ columns: ['rf', 'yield'] }), 'yield', 'rf')).toEqual(['yield', 'rf']);
  });

  it('keep only readable widths and hidden columns', () => {
    expect(columnWidths(scope({ widths: { name: 250.4, yield: 'wide', rf: 3, hrms: 5000 } }))).toEqual({ name: 250, hrms: 1200 });
    expect([...hiddenFixed(scope({ hidden_columns: ['section', 'name', 7] }))]).toEqual(['section']);
  });
});
