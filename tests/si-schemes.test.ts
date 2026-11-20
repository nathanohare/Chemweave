// Scheme pages drawn in the compiled SI (SPEC §13n.4): one editable drawing per scheme, laid out
// by its Layout (arrow length from the conditions, IDs and yields under the structures, rows),
// its caption only when the Layout shows it, and its compounds' blocks without their structures.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompiledSi } from '../src/si/compile-doc';
import { drawScheme, schemeLayout, SCHEME_DEFAULTS, type DrawBox } from '../src/si/scheme-draw';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';
import type { Contents } from '../src/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const ROOT = join(__dirname, 'fixtures', 'si-example');
const SCHEME = 'sections/s-972b3c47_synthesis-and-charac/compounds/k-730d7f01_reduction-of-a';
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
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const put = (f: MemoryFolder, rel: string, v: unknown): void => { f.files.set(rel, new TextEncoder().encode(JSON.stringify(v))); };
const contentsOf = (mol: string): Contents | null => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; };

async function compile(f: MemoryFolder): Promise<CompiledSi> {
  const p = await SiProject.open(f);
  return compileSi(p, { contentsOf, sizeOf: () => null, facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)) });
}

/** The drawings of a compiled SI that have arrows: its schemes. */
const schemes = (c: CompiledSi) => Object.values(c.doc.objects).flatMap((o) => (o.kind === 'drawing' && o.contents.arrows.length ? [o] : []));
const texts = (c: Contents): string[] => c.captions.map((x) => plainText(x.runs));
const box = (c: Contents, text: string) => {
  const cap = c.captions.find((x) => plainText(x.runs) === text)!;
  return cap;
};

describe('scheme pages in the compiled SI', () => {
  it('draws each scheme with its conditions, IDs and yields, and its caption', async () => {
    const got = await compile(folder());
    const [first, second] = schemes(got);
    expect(first && second).toBeTruthy();
    expect(texts(first.contents)).toEqual(expect.arrayContaining(['1a–f', '2a–f', '89–96%', 'NaBH4 (1.5 equiv)', 'MeOH, 0 °C, 30 min']));
    // the subscript of NaBH4, and the IDs in bold
    expect(box(first.contents, 'NaBH4 (1.5 equiv)').runs.some((r) => r.sub && r.text === '4')).toBe(true);
    expect(box(first.contents, '1a–f').runs.every((r) => r.bold)).toBe(true);
    // a mentioned compound's ID as a starting material's label; a product that is a compound: its ID and its yield field
    expect(texts(second.contents)).toEqual(expect.arrayContaining(['2e', '3']));
    const lines = plainText(got.doc.runs).split('\n');
    expect(lines).toContain('Scheme S1. Reduction of aryl methyl ketones 1a–1f (R = aryl)');
    expect(lines).toContain('Scheme S2. Acetylation of 1-(4-bromophenyl)ethan-1-ol');
    expect(got.targets.find((t) => t.kind === 'scheme' && t.label === 'Scheme S1')?.mark).toBeTruthy();
    expect(got.notes.some((n) => /scheme/i.test(n))).toBe(false);
  });

  it('puts the arrow on the structures’ middle line, the top text over it and the IDs under the structures', async () => {
    const [s] = schemes(await compile(folder()));
    const arrow = s.contents.arrows[0];
    expect(arrow.tail.y).toBeCloseTo(arrow.head.y, 6);
    const ys = s.contents.atoms.map((a) => a.y);
    // structures centred on the arrow's line (within a bond's length: labels count in the box)
    expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - arrow.tail.y)).toBeLessThan(14.4);
    expect(box(s.contents, 'NaBH4 (1.5 equiv)').y).toBeLessThan(arrow.tail.y);
    expect(box(s.contents, 'MeOH, 0 °C, 30 min').y).toBeGreaterThan(arrow.tail.y);
    // both IDs on one line (line up IDs), the yield under the product's
    expect(box(s.contents, '1a–f').y).toBeCloseTo(box(s.contents, '2a–f').y, 3);
    expect(box(s.contents, '89–96%').y).toBeGreaterThan(box(s.contents, '2a–f').y);
    // the arrow at least the shortest (12 mm) and longer than its text
    expect(arrow.head.x - arrow.tail.x).toBeGreaterThanOrEqual(12 * 72 / 25.4 - 1e-6);
  });

  it('prints a scheme’s compounds without their own structures', async () => {
    const got = await compile(folder());
    // compound 3 (in scheme S2): its block, but its structure only in the scheme
    const at = got.doc.runs.findIndex((r) => r.text.includes('(3).'));
    expect(at).toBeGreaterThan(-1);
    const drawings = Object.values(got.doc.objects).filter((o) => o.kind === 'drawing' && !o.contents.arrows.length);
    expect(drawings.length).toBe(6);
  });

  it('follows the Layout: no caption, yields under the conditions or not at all, a longer arrow', async () => {
    const f = folder();
    const rel = `${SCHEME}/scheme.json`;
    const k = json(f, rel);
    (k.editor as Json).layout = { show_label: false, yields: 'conditions', arrow_min_mm: 40 };
    put(f, rel, k);
    const got = await compile(f);
    const [s] = schemes(got);
    expect(plainText(got.doc.runs)).not.toContain('Scheme S1. Reduction');
    expect(texts(s.contents)).toContain('MeOH, 0 °C, 30 min\n89–96%');
    const a = s.contents.arrows[0];
    expect(a.head.x - a.tail.x).toBeCloseTo(40 * 72 / 25.4, 3);
    // the other scheme is now Scheme S1
    expect(plainText(got.doc.runs)).toContain('Scheme S1. Acetylation');
    // the project's own default, under the scheme's
    const p = json(f, 'project.json');
    put(f, 'project.json', { ...p, schemes: { yields: 'none' } });
    (k.editor as Json).layout = {};
    put(f, rel, k);
    const [s2] = schemes(await compile(f));
    expect(texts(s2.contents)).not.toContain('89–96%');
  });

  it('says what it leaves out: empty boxes and pictures in the conditions', async () => {
    const f = folder();
    const rel = `${SCHEME}/scheme.json`;
    const k = json(f, rel);
    const ed = k.editor as Json;
    (ed.starting as Json[]).push({ id: 'b-empty' });
    (ed.steps as Json[])[0].top = 'NaBH_{4} @struct{s-1234abcd}';
    put(f, rel, k);
    const got = await compile(f);
    expect(got.notes.some((n) => /an empty box was left out/.test(n))).toBe(true);
    // (a structure in the conditions with no structure file: a picture pasted in SI Assistant)
    expect(got.notes.some((n) => /a structure in the conditions is only a picture/.test(n))).toBe(true);
  });

  it('draws the structures in the conditions from their files', async () => {
    const f = folder();
    const rel = `${SCHEME}/scheme.json`;
    const k = json(f, rel);
    const ed = k.editor as Json;
    (ed.steps as Json[])[0].top = '@struct{s-1234abcd} NaBH_{4}';
    ed.inline = { 's-1234abcd': { structure: 'editor/s-1234abcd.mol' } };
    put(f, rel, k);
    f.files.set(`${SCHEME}/editor/s-1234abcd.mol`, f.files.get(`${SCHEME}/editor/b-730228e5.mol`)!);
    const before = schemes(await compile(folder()))[0].contents.atoms.length;
    const got = await compile(f);
    expect(got.notes.some((n) => /in the conditions/.test(n))).toBe(false);
    const drawn = schemes(got)[0].contents;
    expect(drawn.atoms.length).toBeGreaterThan(before);
    expect(drawn.atoms.some((a) => Math.abs((a.s ?? 1) - 0.7) < 1e-9)).toBe(true);
  });
});

describe('laying out a scheme', () => {
  const mol = readFileSync(join(ROOT, SCHEME, 'editor', 'b-730228e5.mol'), 'utf8');
  const b = (label: string): DrawBox => ({ contents: contentsOf(mol)!, label: [{ text: label, bold: true }], yieldText: '' });
  const step = (top: string) => ({ top: [{ text: top }], bottom: [], products: [b('P')] });

  it('reads the layout: the scheme’s over the project’s over the built-in, sensible values only', () => {
    expect(schemeLayout(null, null)).toEqual(SCHEME_DEFAULTS);
    const l = schemeLayout({ cond_size_pt: 10, fit: 'shrink' }, { cond_size_pt: 99, fit: 'odd', gap_mm: Number.NaN, align_ids: false });
    expect(l.cond_size_pt).toBe(20);
    expect(l.fit).toBe('shrink');
    expect(l.gap_mm).toBe(2);
    expect(l.align_ids).toBe(false);
  });

  it('makes an arrow as long as its text and starts a new row at an arrow when too wide', () => {
    const long = 'a very long line of conditions text for this step';
    const one = drawScheme([b('S')], [step(long)], SCHEME_DEFAULTS, 1000)!;
    const a = one.contents.arrows[0];
    expect(a.head.x - a.tail.x).toBeGreaterThan(12 * 72 / 25.4 + 50);
    const steps = [step('A'), step('B'), step('C'), step('D'), step('E')];
    const wrapped = drawScheme([b('S')], steps, SCHEME_DEFAULTS, 300)!;
    expect(wrapped.rows).toBeGreaterThan(1);
    expect(wrapped.scale).toBe(1);
    // a later row starts with an arrow at the left edge
    const lefts = wrapped.contents.arrows.map((r) => r.tail.x);
    expect(Math.min(...lefts)).toBeCloseTo(0, 6);
    const shrunk = drawScheme([b('S')], steps, { ...SCHEME_DEFAULTS, fit: 'shrink' }, 300)!;
    expect(shrunk.rows).toBe(1);
    expect(shrunk.scale).toBeLessThan(1);
    expect(shrunk.textPt).toBeLessThan(9);
    const half = drawScheme([b('S')], [step('A')], { ...SCHEME_DEFAULTS, scale_pct: 50 }, 1000)!;
    expect(half.scale).toBe(0.5);
  });

  it('draws nothing for a scheme with no structures', () => {
    expect(drawScheme([], [{ top: [], bottom: [], products: [] }], SCHEME_DEFAULTS, 400)).toBeNull();
  });
});
