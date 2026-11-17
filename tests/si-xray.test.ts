// X-ray structure sections in the compiled SI (SPEC §13v): the live crystal structure, its
// automatic or typed caption, the crystal data table (typed values, rows left out), among the
// sections with a heading or under a compound without one.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, type CompiledSi } from '../src/si/compile-doc';
import { xrayAutoCaption, xrayBlock, xrayDrawing, xrayTableRows } from '../src/si/xray';
import { defaultView } from '../src/design/xray';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { plainText } from '../src/richtext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });

const ROOT = join(__dirname, 'fixtures', 'si-example');
const CIF = readFileSync(join(__dirname, 'crystal', 'test-acid.cif'), 'utf8');
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
const enc = (s: string) => new TextEncoder().encode(s);
const json = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));

/** The example project with an X-ray structure section (among the sections, or under compound 2e). */
function withXray(more: Json = {}): MemoryFolder {
  const f = folder();
  const dir = 'sections/s-0a1b2c3d_x-ray-structure';
  f.files.set(`${dir}/section.json`, enc(JSON.stringify({ id: 's-0a1b2c3d', type: 'xray', name: 'X-ray Structure of 2e', file: 'acid.cif', block: '', view: {}, compound: 'c-ad564675', caption: '', table: true, ...more })));
  f.files.set(`${dir}/acid.cif`, enc(CIF));
  if (!more.anchored) {
    const p = json(f, 'project.json');
    (p.section_tree as Json[]).splice(2, 0, { id: 's-0a1b2c3d' });
    f.files.set('project.json', enc(JSON.stringify(p)));
  }
  return f;
}

async function compile(f: MemoryFolder): Promise<CompiledSi> {
  const p = await SiProject.open(f);
  return compileSi(p, {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => null,
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  });
}
const lines = (c: CompiledSi) => plainText(c.doc.runs).split('\n');
const crystals = (c: CompiledSi) => Object.values(c.doc.objects).flatMap((o) => (o.kind === 'drawing' && o.contents.shapes.some((s) => s.plate?.kind === 'crystal') ? [o] : []));

describe('X-ray structures in the compiled SI', () => {
  it('prints a section’s structure as a live crystal structure, its caption and its table', async () => {
    const got = await compile(withXray());
    const [x] = crystals(got);
    expect(x).toBeTruthy();
    const shape = x.contents.shapes[0];
    expect(shape.kind).toBe('picture');
    expect(shape.plate?.crystal?.atoms.length).toBeGreaterThan(5);
    expect(shape.x2 - shape.x1).toBeCloseTo(340, 0);
    const ls = lines(got);
    expect(ls).toContain('X-ray Structure of 2e');
    expect(ls.some((l) => /^Figure S\d+\. Molecular structure of 2e \(thermal ellipsoids at 50% probability\)\.$/.test(l))).toBe(true);
    expect(ls.some((l) => /^Table S\d+\. Crystal data and structure refinement for 2e\.$/.test(l))).toBe(true);
    const tables = Object.values(got.doc.objects).flatMap((o) => (o.kind === 'table' ? [o.table] : []));
    const t = tables.find((tb) => tb.rows.some((r) => plainText(r[0].runs) === 'Empirical formula'))!;
    expect(t).toBeTruthy();
    expect(t.head).toBe(0);
    // the CIF's formula, with subscripts
    const formula = t.rows.find((r) => plainText(r[0].runs) === 'Empirical formula')![1];
    expect(plainText(formula.runs)).toBe('C7H5BrO2');
    expect(formula.runs.some((r) => r.sub)).toBe(true);
    expect(got.notes.some((n) => /X-ray/.test(n))).toBe(false);
  });

  it('follows the section: a typed CCDC number, rows left out, no table, a typed caption', async () => {
    let got = await compile(withXray({ table_values: { ccdc: '2345678' }, table_hidden: ['weight'] }));
    expect(lines(got).some((l) => /CCDC 2345678\.$/.test(l))).toBe(true);
    const t = Object.values(got.doc.objects).flatMap((o) => (o.kind === 'table' ? [o.table] : [])).find((tb) => tb.rows.some((r) => plainText(r[0].runs) === 'Empirical formula'))!;
    expect(t.rows.some((r) => plainText(r[0].runs) === 'Formula weight')).toBe(false);
    expect(t.rows.some((r) => plainText(r[1].runs) === '2345678')).toBe(true);
    got = await compile(withXray({ table: false, caption: 'The acid @{c-ad564675}, seen from above.' }));
    expect(lines(got).some((l) => /^Figure S\d+\. The acid 2e, seen from above\.$/.test(l))).toBe(true);
    expect(lines(got).some((l) => /Crystal data and structure refinement/.test(l))).toBe(false);
  });

  it('prints a structure under its compound right after the compound, without a heading', async () => {
    const got = await compile(withXray({ anchored: true }));
    const ls = lines(got);
    expect(ls).not.toContain('X-ray Structure of 2e');
    const c = ls.findIndex((l) => /\(2e\)\.$/.test(l));
    const fig = ls.findIndex((l) => /^Figure S\d+\. Molecular structure of 2e/.test(l));
    expect(c).toBeGreaterThan(-1);
    expect(fig).toBeGreaterThan(c);
    const next = ls.findIndex((l, i) => i > c && /^1-.*\(\w+\)\.$/.test(l));
    if (next > -1) expect(fig).toBeLessThan(next);
  });

  it('says what it leaves out', async () => {
    const f = withXray({ file: '' });
    expect((await compile(f)).notes.some((n) => /no CIF file has been chosen yet/.test(n))).toBe(true);
    const g = withXray({ file: 'gone.cif' });
    expect((await compile(g)).notes.some((n) => /gone\.cif is no longer in the project/.test(n))).toBe(true);
  });
});

describe('an X-ray structure’s parts', () => {
  const { block } = xrayBlock(CIF, '');

  it('reads the stored view: a stored zoom sets the size, never wider than the text', () => {
    const fresh = xrayDrawing(block!, {}, 1000);
    if ('error' in fresh) throw new Error(fresh.error);
    expect(fresh.w).toBeCloseTo(340, 0);
    const rot = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const small = xrayDrawing(block!, { rotation: rot, zoom: 0.5, labels: false, style: 'ball', hydrogens: 'hide', probability: 30 }, 1000);
    const big = xrayDrawing(block!, { rotation: rot, zoom: 1, labels: false, style: 'ball', hydrogens: 'hide', probability: 30 }, 1000);
    if ('error' in small || 'error' in big) throw new Error('no drawing');
    expect(small.w - 2).toBeCloseTo((big.w - 2) / 2, 0);
    expect(small.spec.view.style).toBe('ball');
    expect(small.spec.view.hydrogens).toBe(false);
    expect(small.spec.view.probability).toBe(30);
    const capped = xrayDrawing(block!, { rotation: rot, zoom: 20 }, 300);
    if ('error' in capped) throw new Error(capped.error);
    expect(capped.w).toBe(300);
  });

  it('writes the automatic caption from how it is drawn', () => {
    const v = { ...defaultView(), hydrogens: false, hiddenMolecules: [2] };
    expect(xrayAutoCaption({}, v, '@{c-1}', '123')).toBe('Molecular structure of @{c-1} (thermal ellipsoids at 50% probability; hydrogen atoms omitted for clarity; solvent molecules omitted for clarity). CCDC 123.');
    expect(xrayAutoCaption({}, { ...defaultView(), style: 'ball' }, '', '')).toBe('Molecular structure (ball-and-stick model).');
  });

  it('lists the table’s rows: typed over, left out, empty ones dropped', () => {
    const rows = xrayTableRows({ table_values: { ccdc: '99' }, table_hidden: ['code'] }, block!);
    expect(rows.find(([k]) => k === 'ccdc')?.[2]).toBe('99');
    expect(rows.some(([k]) => k === 'code')).toBe(false);
    expect(rows.every(([, , v]) => v.trim())).toBe(true);
  });
});
