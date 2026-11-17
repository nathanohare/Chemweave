// An SI project compiled into a document: the parts in SI Assistant's order, its compound text,
// labels, citations, page numbers and the bookmarks a manuscript will point at.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, compoundBookmark, type CompiledSi } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import { styleOf, type DocText } from '../src/document/document';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

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

async function compile(dir: string): Promise<CompiledSi> {
  const p = await SiProject.open(folder(dir));
  return compileSi(p, {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => null,
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  });
}

/** Each paragraph's text and style id. */
function paragraphs(t: DocText): { text: string; style: string; marks?: string[]; pageBreak?: boolean }[] {
  const lines = plainText(t.runs).split('\n');
  return lines.map((text, i) => ({ text, style: styleOf(t, t.paras[i]).id, marks: t.paras[i]?.marks, pageBreak: t.paras[i]?.pageBreak }));
}

describe('compiling an SI project into a document', () => {
  it('lays out the example project as SI Assistant does', async () => {
    const { doc, notes } = await compile('si-example');
    const ps = paragraphs(doc);
    const texts = ps.map((x) => x.text);
    expect(texts[0]).toBe('Supporting Information');
    expect(texts[1]).toMatch(/^Sodium Borohydride Reduction/);
    expect(texts[2]).toBe('Alex Examplea and Blair Samplea*');
    expect(texts).toContain('*Email: blair.sample@example.com');
    const toc = ps.findIndex((x) => x.text === 'Table of Contents');
    expect(ps[toc].pageBreak).toBe(true);
    expect(Object.values(doc.objects).some((o) => o.kind === 'toc')).toBe(true);
    // the headings in order: General Information, the sections, the GP, then the compounds
    const heads = ps.filter((x) => /^Heading|^SICompound/.test(x.style)).map((x) => x.text);
    expect(heads.slice(0, 5)).toEqual(['General Information', 'Reaction Optimization', 'Synthesis and Characterization', 'General Procedure A: Reduction of aryl methyl ketones with NaBH4', '1-Phenylethan-1-ol (2a).']);
    expect(heads[heads.length - 1]).toBe('References');
    // the table's label and its mention in the text
    expect(texts).toContain('Table S1. Optimization of the reduction of 4′-bromoacetophenone');
    expect(texts.some((x) => x.includes('which gives alcohol 2e (Table S1)'))).toBe(true);
    // a compound: its bookmark, structure and the text SI Assistant writes
    const a = ps.findIndex((x) => x.text === '1-Phenylethan-1-ol (2a).');
    expect(ps[a].marks).toEqual([compoundBookmark('c-26c39a99')]);
    expect(ps[a + 2].text).toBe('Prepared according to General Procedure A from acetophenone (1a, 60.1 mg, 0.50 mmol). The crude product was purified by flash column chromatography (SiO2, n-hexane/EtOAc 4:1).');
    expect(ps[a + 3].text).toMatch(/^Colorless oil \(57\.4 mg, 94%\)\. Rf = 0\.23 .* calcd for C8H10NaO 145\.0624; found 145\.0625\. Spectral data matched those reported in the literature\.￼$/);
    const drawings = Object.values(doc.objects).filter((o) => o.kind === 'drawing');
    expect(drawings.length).toBe(7);
    // citations and the references they point to
    const cited = Object.values(doc.objects).flatMap((o) => (o.kind === 'cite' ? o.refs : []));
    expect(cited).toContain('r-30ec8485');
    expect(doc.references?.length).toBe(7);
    expect(Object.values(doc.objects).some((o) => o.kind === 'bib')).toBe(true);
    // S1, S2… with no number on the cover
    expect(doc.hf.prefix).toBe('S');
    expect(doc.hf.onFirst).toBe(false);
    // what isn't compiled yet is said
    expect(notes.some((n) => /spectra pages/.test(n))).toBe(true);
    expect(notes.some((n) => /schemes are not drawn/.test(n))).toBe(true);
  });

  it('formats chemistry and keeps run formatting', async () => {
    const { doc } = await compile('si-example');
    const subs = doc.runs.filter((r) => r.sub).map((r) => r.text);
    expect(subs).toContain('3');   // CDCl3, Na2SO4…
    const sups = doc.runs.filter((r) => r.sup).map((r) => r.text);
    expect(sups).toContain('13');   // ¹³C NMR
    expect(doc.runs.some((r) => r.italic && r.text === 'J')).toBe(true);
    // SiO₂ as typed prints as SiO with a subscript 2 (fonts often lack ₂)
    expect(plainText(doc.runs)).not.toContain('₂');
    const i = doc.runs.findIndex((r) => r.text.endsWith('(SiO'));
    expect(doc.runs[i + 1]).toMatchObject({ text: '2', sub: true });
  });

  it('lists compounds in the contents only when the project says so', async () => {
    const f = folder('si-example');
    const p = await SiProject.open(f);
    p.settings.toc = { depth: 'sections' };
    const { doc } = await compileSi(p, { contentsOf: () => null, sizeOf: () => null, facts: async (m) => m.map(() => null) });
    const ps = paragraphs(doc);
    const gp = ps.find((x) => x.text.startsWith('General Procedure A'))!;
    expect(styleOf(doc, { style: gp.style }).outline).toBeUndefined();
    const c = ps.find((x) => x.text === '1-Phenylethan-1-ol (2a).')!;
    expect(c.style).toBe('SICompound');
    expect(styleOf(doc, { style: c.style }).outline).toBeUndefined();
  });
});
