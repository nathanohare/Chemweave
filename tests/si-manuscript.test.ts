// @vitest-environment jsdom
//
// A manuscript linked to its SI: SI fields brought up to date from the SI, bold compound numbers
// made SI fields, the check against the SI, the SI pages, and SI fields kept in Word files.
import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import { molFacts } from '../src/si/chem';
import { compileSi, siMark, type CompiledSi } from '../src/si/compile-doc';
import { checkAgainstSi, compoundNumbers, linkTypedIds, mentionCounts, numberKey, renumberPlan, sameDr, sameEe, sameYield, siDataOf, siField, siPages, updateSiFields, useSiValue, type SiView } from '../src/si/manuscript';
import { DocBuilder } from '../src/io/doc-build';
import { fieldTexts, type DocText } from '../src/document/document';
import { plainText } from '../src/richtext';
import { readScene, sceneToDoc } from '../src/io/chem-formats';
import { ACS_1996 } from '../src/style';
import { writeDocx } from '../src/io/docx-write';
import { readDocx } from '../src/io/docx-read';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
let project: SiProject;
let compiled: CompiledSi;
let view: SiView;

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

beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
  project = await SiProject.open(folder('si-example'));
  compiled = await compileSi(project, {
    contentsOf: (mol) => { const s = readScene('mol', mol); return s ? sceneToDoc(s, ACS_1996).doc.contents() : null; },
    sizeOf: () => null,
    facts: async (mols) => mols.map((m) => (m ? molFacts(RDKit, m) : null)),
  });
  // pages made up for the test: each paragraph's page is S + (its number / 20 + 1)
  const paraPage = compiled.doc.paras.map((_, i) => `S${Math.floor(i / 20) + 1}`);
  view = { title: project.title, targets: compiled.targets, pages: siPages(compiled.doc, compiled.targets, paraPage), data: siDataOf(project) };
});

/** A small manuscript: a sentence with bold compound numbers, and a scope table. */
function manuscript(yieldOf2c = '96'): DocText {
  const b = new DocBuilder();
  const bold = { bold: true };
  b.text('Reduction of acetophenone (', {}); b.text('1a', bold); b.text(') gave ', {}); b.text('2a', bold);
  b.text(' in 90% yield (Table 1, entry 1). Acetylation of ', {}); b.text('2e', bold); b.text(' gave ', {}); b.text('3', bold); b.text('.', {});
  b.endPara({});
  b.text('Table 1. Scope', {}); b.text('', {});
  b.endPara({});
  const cell = (text: string, look = {}) => ({ runs: text ? [{ text, ...look }] : [] });
  b.table({
    kind: 'table',
    table: {
      cols: [60, 60, 60], head: 1,
      rows: [
        [cell('entry'), cell('alcohol'), cell('yield (%)')],
        [cell('1'), cell('2a', bold), cell('94')],
        [cell('2'), cell('2c', bold), cell(yieldOf2c)],
        [cell('3'), cell('2g', bold), cell('85')],
      ],
    },
  }, {});
  return b.finish({});
}

describe('a manuscript linked to its SI', () => {
  it('lists what the SI has, with bookmarks for its pages', () => {
    const c2a = compiled.targets.find((t) => t.kind === 'compound' && t.label === '2a')!;
    expect(c2a.key).toBe('c-26c39a99');
    expect(c2a.mark).toBe(siMark('c-26c39a99'));
    const t1 = compiled.targets.find((t) => t.kind === 'table')!;
    expect(t1.label).toBe('Table S1');
    expect(compiled.doc.paras.some((p) => p?.marks?.includes(t1.mark))).toBe(true);
    expect(view.pages.get(c2a.key)).toMatch(/^S\d+$/);
  });

  it('makes bold compound numbers Compound Numbers, linked to the SI’s compounds', () => {
    const { t, made, changed } = linkTypedIds(manuscript(), view);
    expect(made).toBe(7);   // 1a, 2a, 2e, 3 in the text; 2a, 2c, 2g in the table
    expect(changed).toEqual([]);
    const nums = compoundNumbers(t);
    expect(nums.map((n) => n.number)).toEqual(['1', '2', '3']);
    expect(nums[0].si).toEqual({});
    expect(nums[1].si).toEqual({ a: 'c-26c39a99', e: 'c-ad564675', c: 'c-e2e36085' });
    expect(nums[2].si).toEqual({ '': 'c-6c300e43' });
    // the text still reads the same
    const shown = fieldTexts(t);
    const text = t.runs.map((r) => (r.obj !== undefined ? shown.get(r.obj) : r.text)).join('');
    expect(text).toContain('Reduction of acetophenone (1a) gave 2a in 90% yield (Table 1, entry 1). Acetylation of 2e gave 3.');
    // the IDs already match the SI's: nothing to renumber, nothing differs
    expect(renumberPlan(t, view)).toEqual([]);
    expect(checkAgainstSi(t, view).filter((f) => f.what === 'id')).toEqual([]);
    // a compound number links to its compound for Ctrl+click
    const first2 = t.runs.find((r) => r.obj !== undefined && shown.get(r.obj) === '2')!;
    expect(numberKey(t, first2.obj!)).toEqual({ key: 'c-26c39a99', id: '2a' });
  });

  it('numbers by first mention, and the SI follows the manuscript', () => {
    // 3 typed before 2: they swap, and the SI is told the new IDs
    const b = new DocBuilder();
    b.text('Acetate ', {}); b.text('3', { bold: true }); b.text(' was made from ', {}); b.text('2e', { bold: true }); b.text('.', {});
    b.endPara({});
    const { t, changed } = linkTypedIds(b.finish({}), view);
    expect(changed).toEqual([{ from: '3', to: '1' }, { from: '2', to: '2' }].filter((x) => x.from !== x.to));
    const plan = renumberPlan(t, view);
    expect(plan).toEqual([{ key: 'c-6c300e43', from: '3', to: '1' }]);
    const found = checkAgainstSi(t, view).find((f) => f.what === 'id')!;
    expect(found).toMatchObject({ level: 'problem', manuscript: '1', si: '3' });
    // once the SI has the manuscript's IDs, they agree
    const renumbered: SiView = { ...view, targets: view.targets.map((x) => (x.key === 'c-6c300e43' ? { ...x, label: '1' } : x)) };
    expect(renumberPlan(t, renumbered)).toEqual([]);
  });

  it('keeps SI labels and pages up to date', () => {
    const t1 = view.targets.find((x) => x.kind === 'table')!;
    const b = new DocBuilder();
    b.text('See ', {});
    b.object(siField('label', t1, view));
    b.text(' on page ', {});
    b.object(siField('page', t1, view));
    b.endPara({});
    const t = b.finish({});
    const moved: SiView = { ...view, targets: view.targets.map((x) => (x.key === t1.key ? { ...x, label: 'Table S2' } : x)), pages: new Map([...view.pages, [t1.key, 'S9']]) };
    const up = updateSiFields(t, moved);
    expect(up.changed).toBe(2);
    expect(Object.values(up.t.objects).map((o) => (o.kind === 'si' ? o.text : '')).sort()).toEqual(['S9', 'Table S2']);
    const gone: SiView = { ...view, targets: view.targets.filter((x) => x.key !== t1.key) };
    expect(updateSiFields(t, gone).missing.length).toBe(2);
  });

  it('checks the manuscript against the SI', () => {
    const t = manuscript('92');
    const found = checkAgainstSi(t, view);
    const y = found.find((f) => f.what === 'yield' && f.level === 'problem')!;
    expect(y).toMatchObject({ id: '2c', manuscript: '92', si: '96', where: 'Table 1, entry 2' });
    const miss = found.find((f) => f.id === '2g')!;
    expect(miss).toMatchObject({ level: 'problem', si: 'not in the SI' });
    // 1a, mentioned in the text only: a note
    expect(found.find((f) => f.id === '1a')).toMatchObject({ level: 'note' });
    // the sentence's 90% for 2a (94% in the SI): a note
    expect(found.find((f) => f.id === '2a' && f.what === 'yield')).toMatchObject({ level: 'note', manuscript: '90%' });
    // putting the SI's value in the table
    const fixed = useSiValue(t, y)!;
    expect(checkAgainstSi(fixed, view).some((f) => f.what === 'yield' && f.level === 'problem')).toBe(false);
  });

  it('reads yields given beside a compound number in a sentence', () => {
    const b = new DocBuilder();
    const bold = { bold: true };
    b.text('The 4-fluoro (', {}); b.text('2c', bold); b.text(', 92%) and 4-bromo (', {}); b.text('2e', bold); b.text(', 95%) alcohols; ', {});
    b.text('2a', bold); b.text(' in 90% ee.', {});
    b.endPara({});
    const t = linkTypedIds(b.finish({}), view).t;
    const found = checkAgainstSi(t, view).filter((f) => f.what === 'yield');
    expect(found).toHaveLength(1);
    // (the manuscript numbers by first mention, so 2c is 1c here)
    expect(found[0]).toMatchObject({ level: 'note', id: '1c', key: 'c-e2e36085', manuscript: '92%', si: '96' });
  });

  it('counts mentions', () => {
    const counts = mentionCounts(manuscript(), view);
    expect(counts.get('c-26c39a99')).toBe(2);
    expect(counts.get('c-e2e36085')).toBe(1);
    expect(counts.get('c-1eebe878')).toBeUndefined();
  });

  it('compares values as SI Assistant does', () => {
    expect(sameYield('92', '92.0')).toBe(true);
    expect(sameYield('>99', '99')).toBe(false);
    expect(sameYield('quant.', '99')).toBe(true);
    expect(sameEe('94% ee', '97:3 er')).toBe(true);
    expect(sameEe('93', '97:3 er')).toBe(false);
    expect(sameDr('5:1', '83:17')).toBe(true);
    expect(sameDr('5:1', '10:1')).toBe(false);
  });

  it('keeps linked compound numbers, SI fields and the link in Word files', async () => {
    const t0 = linkTypedIds(manuscript(), view).t;
    const t1 = view.targets.find((x) => x.kind === 'table')!;
    const id = Math.max(...Object.keys(t0.objects).map(Number)) + 1;
    const t: DocText = { ...t0, runs: [...t0.runs, { text: ' (' }, { text: '\uFFFC', obj: id }, { text: ')' }], objects: { ...t0.objects, [id]: siField('label', t1, view) } };
    const linked: DocText = { ...t, siLink: { path: 'C:/Projects/NaBH4 SI', title: 'NaBH4 SI' } };
    const bytes = await writeDocx(linked, { async picture() { return null; } });
    const { doc: back } = await readDocx(bytes);
    expect(back.siLink).toEqual({ path: 'C:/Projects/NaBH4 SI', title: 'NaBH4 SI' });
    expect(compoundNumbers(back).map((n) => [n.number, n.si])).toEqual(compoundNumbers(t).map((n) => [n.number, n.si]));
    expect(renumberPlan(back, view)).toEqual([]);
    expect(Object.values(back.objects).filter((o) => o.kind === 'si').map((o) => (o.kind === 'si' ? `${o.what}:${o.key}=${o.text}` : ''))).toEqual([`label:${t1.key}=Table S1`]);
  });
});
