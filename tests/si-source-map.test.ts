// The compiled SI's source map (where each stretch of text came from), for the Live Preview: the
// example project's values (tests/fixtures/si-example, read from its files here) found where they
// print, and a change made in the printed text written back into the stored value.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompiledSi } from '../src/si/compile-doc';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import { blockAt, compoundSrc, editableSrc, sourceAccess, spanAt } from '../src/si/source-map';
import { applyToRaw, lineUp, markupSrc, printedOf } from '../src/si/preview-edit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const ROOT = join(__dirname, 'fixtures', 'si-example');
function folder(): MemoryFolder {
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

/** Compound 2a's stored values, read from the fixture's file. */
const A = 'c-26c39a99';
const stored = JSON.parse(readFileSync(join(ROOT, 'sections/s-972b3c47_synthesis-and-charac/compounds/c-26c39a99_1-phenylethan/compound.json'), 'utf8')).values;

const compile = (p: SiProject): Promise<CompiledSi> => compileSi(p, {
  contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
  sizeOf: () => null,
  facts: async (ms) => ms.map((m) => (m ? molFacts(RDKit, m) : null)),
}, { kind: 'whole' });

const textOf = (got: CompiledSi, src: string): string => {
  const t = plainText(got.doc.runs);
  return got.sources.filter((s) => s.src === src).map((s) => t.slice(s.start, s.end)).join('');
};

describe('the source map of the whole compiled SI', () => {
  it('finds each typed value where it prints', async () => {
    const got = await compile(await SiProject.open(folder()));
    expect(textOf(got, compoundSrc(A, 'name', 'text'))).toBe(stored.name.text);
    expect(textOf(got, compoundSrc(A, 'yield', 'percent'))).toBe(stored.yield.percent);
    expect(textOf(got, compoundSrc(A, 'yield', 'mass'))).toBe(stored.yield.mass);
    expect(textOf(got, compoundSrc(A, 'rf', 'value'))).toBe(stored.rf.value);
    expect(textOf(got, compoundSrc(A, 'hrms', 'found'))).toBe(stored.hrms.found);
    expect(textOf(got, compoundSrc(A, 'procedure', 'values.ketone'))).toBe(stored.procedure.values.ketone);
    // the stored state is lower case; it prints with a capital
    expect(textOf(got, compoundSrc(A, 'physical_state', 'text'))).toBe('Colorless oil');
  });

  it('lines up every text a person typed with its stored value', async () => {
    const p = await SiProject.open(folder());
    const got = await compile(p);
    const text = plainText(got.doc.runs);
    const srcs = [...new Set(got.sources.map((s) => s.src))].filter(editableSrc);
    expect(srcs.length).toBeGreaterThan(50);
    for (const src of srcs) {
      const raw = await sourceAccess(p, src)?.read();
      expect(raw, src).toBeTypeOf('string');
      const { printed } = printedOf(text, got.sources, src);
      const map = lineUp(raw!, printed);
      // most printed characters are the stored ones (a few are the program's: spaces, dashes)
      const paired = map.filter((x) => x >= 0).length;
      expect(paired / Math.max(1, printed.length), src).toBeGreaterThan(0.6);
    }
  });

  it('marks the words the program adds as the field\'s but not typed', async () => {
    const got = await compile(await SiProject.open(folder()));
    const t = plainText(got.doc.runs);
    const calcd = t.indexOf('calcd for C8H10NaO');
    expect(calcd).toBeGreaterThan(0);
    expect(spanAt(got.sources, calcd + 2)?.src).toBe(compoundSrc(A, 'hrms'));
    expect(editableSrc(compoundSrc(A, 'hrms'))).toBe(false);
  });

  it('knows which page of the tree each part is', async () => {
    const got = await compile(await SiProject.open(folder()));
    const t = plainText(got.doc.runs);
    const title = t.indexOf(`${stored.name.text} (2a).`);
    expect(blockAt(got.blocks, title)?.node).toBe(`compound:${A}`);
    expect(blockAt(got.blocks, 0)?.node).toBe('project');
    // the compound is inside its section
    const sec = got.blocks.find((b) => b.node === 'section:s-972b3c47')!;
    expect(sec.start).toBeLessThanOrEqual(title);
    expect(sec.end).toBeGreaterThan(title);
  });

  it('leaves the Spectra section out of the whole SI', async () => {
    const got = await compile(await SiProject.open(folder()));
    expect(got.blocks.some((b) => b.node.startsWith('section:s-d79a6040'))).toBe(false);
  });
});

describe('a change made in the printed text', () => {
  it('is written into the stored value and prints', async () => {
    const p = await SiProject.open(folder());
    const before = await compile(p);
    const text = plainText(before.doc.runs);
    const src = compoundSrc(A, 'yield', 'percent');
    const { printed, at } = printedOf(text, before.sources, src);
    const span = before.sources.find((s) => s.src === src)!;
    const access = sourceAccess(p, src)!;
    // "94" → "95": the second character
    const next = applyToRaw((await access.read())!, printed, at(span.start + 1), at(span.start + 2), '5', markupSrc(src));
    expect(next).toBe('95');
    await access.write(next!);
    const after = await compile(p);
    expect(plainText(after.doc.runs)).toContain(`(${stored.yield.mass} ${stored.yield.mass_unit}, 95%)`);
  });

  it('writes a peak report\'s text where it is stored', async () => {
    const p = await SiProject.open(folder());
    const got = await compile(p);
    const text = plainText(got.doc.runs);
    const src = compoundSrc(A, 'nmr', '#0.text');
    const { printed, at } = printedOf(text, got.sources, src);
    const span = got.sources.find((s) => s.src === src)!;
    const where = text.indexOf('(m, 4H)', span.start);
    const access = sourceAccess(p, src)!;
    // "4H" → "5H"
    const next = applyToRaw((await access.read())!, printed, at(where + 4), at(where + 5), '5', markupSrc(src));
    expect(next).toBe(stored.nmr[0].text.replace('(m, 4H)', '(m, 5H)'));
    await access.write(next!);
    expect(p.compounds.find((c) => c.id === A)!.data.values).toMatchObject({ nmr: [{ text: next }, { text: stored.nmr[1].text }] });
  });
});
