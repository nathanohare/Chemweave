// @vitest-environment jsdom
// Code review 2026-11-26, batch 05 (SI builder): Import SI. Every input is made up here: text,
// a Word file's XML (as ECMA-376 Part 1 defines it) and CDXML drawings (as ChemDraw's CDXML
// format, written by hand). No chemistry values are checked.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import * as Rd from '../src/si/si-import-read';
import * as I from '../src/si/si-import';
import type { ImportedSection } from '../src/si/si-import-text';
import { linkCitations, splitEntries } from '../src/si/si-import-refs';
import { isDigit, rx } from '../src/si/py';
import { assignStructures, drawingLabels, drawingStructures } from '../src/si/si-import-structures';
import { cdxmlToCdx } from '../src/io/cdx';
import { parseMarkup } from '../src/si/markup';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, valuesOf, type Json } from '../src/si/project';
import * as A from '../src/si/si-import-apply';

const para = (markup: string, extra: Partial<Rd.Para> = {}): Rd.Para => Rd.newPara(Rd.mergeRuns(parseMarkup(markup)[0]?.runs ?? []), extra);

describe('F216: plain-numbered reference lists', () => {
  it('do not split an entry at a year that starts with the next number', () => {
    const got = splitEntries(['1 Smith, J. J. Am. Chem. Soc. 2010, 132, 100.', '2 Jones, K. Org. Lett. 2011, 13, 5.', '3 Lee, M. Nature 2012, 1, 1.']);
    expect(got).toEqual([
      ['1', 'Smith, J. J. Am. Chem. Soc. 2010, 132, 100.'],
      ['2', 'Jones, K. Org. Lett. 2011, 13, 5.'],
      ['3', 'Lee, M. Nature 2012, 1, 1.'],
    ]);
  });
});

describe('F217: bracketed locants in names are not citations', () => {
  const refs = new Map([['1', ['r-1']], ['2', ['r-2']], ['3', ['r-3']], ['5', ['r-5']], ['7', ['r-7']]]);
  it('keeps benzo[d][1,3]dioxole, [3,3]-sigmatropic, [5]helicene and cucurbit[7]uril', () => {
    for (const t of ['benzo[d][1,3]dioxole-5-carbaldehyde', 'a [3,3]-sigmatropic rearrangement', 'the [5]helicene', 'cucurbit[7]uril']) expect(linkCitations(t, refs)).toBe(t);
  });
  it('still links a citation', () => {
    expect(linkCitations('as reported [1,3].', refs)).toBe('as reported@cite{r-1,r-3}.');
  });
});

describe('F222: an optical rotation without "="', () => {
  // (the forms of the ACS Guide to Scholarly Communication: "[α]D20 +12.3 (c 1.0, CHCl3)")
  it('reads the whole value', () => {
    expect(I.parseRotation('[α]D20 +12.3 (c 1.0, CHCl3)')).toMatchObject({ value: '+12.3', temperature: '20', c: '1.0', solvent: 'CHCl3' });
    expect(I.parseRotation('[α]D25 −5.0')).toMatchObject({ value: '-5.0', temperature: '25' });
    expect(I.parseRotation('[α]20D −10.2 (c 1.0)')).toMatchObject({ value: '-10.2', temperature: '20' });
    expect(I.parseRotation('[α]D20 12.3 (c 1.0, CHCl3)')).toMatchObject({ value: '12.3', temperature: '20' });
  });
  it('still reads the forms with "="', () => {
    expect(I.parseRotation('[α]D25 = −12.4 (c 1.00, CHCl3).')).toEqual({ value: '-12.4', temperature: '25', c: '1.00', solvent: 'CHCl3' });
    expect(I.parseRotation('[α]D 20 = +3.1')).toMatchObject({ value: '+3.1', temperature: '20' });
  });
});

describe('F944 and F945: Python patterns and digits', () => {
  it('a class ending in an escaped "[" closes, so \\w after it is a class of its own', () => {
    const re = rx('[^\\[]\\w+');
    expect(re.exec('(abc')?.[0]).toBe('(abc');
    expect(re.test('a_')).toBe(true);
    expect(re.exec('[[')).toBeNull();
  });
  it('superscript i is not a digit (Python: "ⁱ".isdigit() is False; "⁴".isdigit() is True)', () => {
    expect(isDigit('ⁱ')).toBe(false);
    expect(isDigit('⁰⁴⁹¹²³')).toBe(true);
  });
});

/** The plan's sections, after analysing these paragraphs. */
const sections = (paras: Rd.Para[]): ImportedSection[] => I.analyse(paras).sections as ImportedSection[];

describe('F221: a numbered sub-heading ending in ":" or "."', () => {
  it('keeps its first letters', () => {
    const s = sections([
      para('Experimental', { heading: 1 }),
      para('2.1 Solvents:', { heading: 2 }),
      para('All solvents were dried before use.'),
      para('2.2. General Methods.', { heading: 2 }),
      para('Reactions were run under nitrogen.'),
    ]);
    const text = s.map((x) => x.text).join('\n');
    expect(text).toContain('# Solvents');
    expect(text).toContain('# General Methods');
  });
});

describe('F220: pictures in a Word table', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const pic = (name: string): Rd.DocObject => ({ kind: 'picture', prog: '', name, picture: png, picture_name: name, group: 0, width_in: 2 });
  it('are imported as figures', () => {
    const s = sections([
      para('Figures', { heading: 1 }),
      para('Two pictures side by side.'),
      Rd.newPara([], { table: true, cell: [1, 0, 0, 1, ''], objects: [pic('a.png')] }),
      Rd.newPara([], { table: true, cell: [1, 0, 1, 1, ''], objects: [pic('b.png')] }),
      para('After the table.'),
    ]);
    const figs = s.flatMap((x) => [...x.figures.values()]);
    expect(figs.filter((f) => f.data).length).toBe(2);
    // (and no empty table for them)
    expect(figs.filter((f) => f.kind === 'table')).toEqual([]);
  });
  it('beside text in a table are kept too', () => {
    const s = sections([
      para('Figures', { heading: 1 }),
      Rd.newPara(Rd.mergeRuns(parseMarkup('Structure')[0].runs), { table: true, cell: [1, 0, 0, 1, ''] }),
      Rd.newPara([], { table: true, cell: [1, 0, 1, 1, ''], objects: [pic('c.png')] }),
    ]);
    const figs = s.flatMap((x) => [...x.figures.values()]);
    expect(figs.filter((f) => f.kind === 'table').length).toBe(1);
    expect(figs.filter((f) => f.data).length).toBe(1);
  });
});

/** A Word file with this body (ECMA-376 Part 1, §17.2: w:document, w:body, w:p, w:tbl). */
function docx(body: string): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}
const p = (text: string, ppr = ''): string => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tbl = (...cells: string[]): string => `<w:tbl><w:tr>${cells.map((c) => `<w:tc>${c}</w:tc>`).join('')}</w:tr></w:tbl>`;

describe('F951: Word outline level 9 is body text', () => {
  it('is no heading; levels 0 to 8 are', () => {
    const read = Rd.readSiDocx('si.docx', docx(p('Body text', '<w:outlineLvl w:val="9"/>') + p('A heading', '<w:outlineLvl w:val="0"/>')));
    expect(read.paras.map((x) => x.heading)).toEqual([0, 1]);
  });
});

describe('F952: a table three levels deep', () => {
  it('has its text read once', () => {
    const read = Rd.readSiDocx('si.docx', docx(tbl(p('outer') + tbl(p('middle') + tbl(p('inner'))))));
    const texts = read.paras.map(Rd.paraText).filter(Boolean);
    expect(texts.filter((t) => t === 'inner')).toHaveLength(1);
    expect(texts.filter((t) => t === 'middle')).toHaveLength(1);
  });
});

describe('F956: splitting runs keeps underline', () => {
  it('both halves of a cut run stay underlined', () => {
    const [a, b] = I.splitRuns([Rd.R('Hello world', false, false, 'normal', true)], 5);
    expect(a.every((r) => r.underline)).toBe(true);
    expect(b.every((r) => r.underline)).toBe(true);
    expect([a.map((r) => r.text).join(''), b.map((r) => r.text).join('')]).toEqual(['Hello', 'world']);
  });
});

// ---------------------------------------------------------------- drawings (CDXML by hand)

/** A CDXML page with these objects (ChemDraw's CDXML: <fragment> of <n> nodes with p="x y", <t> text with <s>). */
const cdxml = (inner: string): string => `<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1">${inner}</page></CDXML>`;
let nid = 100;
/** One fragment of `atoms` carbon atoms in a row at (x, y), its first atom with `charge`. */
function fragment(x: number, y: number, atoms: number, charge = 0): string {
  const ids = Array.from({ length: atoms }, () => ++nid);
  const nodes = ids.map((id, i) => `<n id="${id}" p="${x + 15 * i} ${y}"${i === 0 && charge ? ` Charge="${charge}"` : ''}/>`).join('');
  const bonds = ids.slice(1).map((id, i) => `<b id="${++nid}" B="${ids[i]}" E="${id}"/>`).join('');
  return `<fragment id="${++nid}">${nodes}${bonds}</fragment>`;
}
const label = (x: number, y: number, text: string): string => `<t id="${++nid}" p="${x} ${y}" BoundingBox="${x} ${y - 8} ${x + 30} ${y}"><s>${text}</s></t>`;
/** A stand-in molfile: which fragments of the drawing (their first node ids), so the tests can tell them apart. */
const tools = { facts: async (ms: string[]) => ms.map(() => null), molfileOf: (x: string) => `mol:${[...x.matchAll(/<fragment id="(\d+)"/g)].map((m) => m[1]).join(',')}` };

describe('F219: a drawing label with a stereo prefix', () => {
  it('names the bare compound ID', () => {
    const d = cdxml(fragment(100, 100, 3) + label(110, 130, '(S)-3a'));
    expect(drawingStructures(d, tools).map((s) => s.label)).toEqual(['3a']);
    expect(drawingLabels(cdxml(label(10, 10, 'rac-2') + label(10, 40, '(±)-5')))).toEqual(['2', '5']);
  });
});

describe('F954: an unlabeled drawing of a salt', () => {
  it('gives the compound its structure: the larger ion with its counter-ion', async () => {
    nid = 500;
    const d = cdxml(fragment(100, 100, 8, 1) + fragment(250, 100, 1, -1));
    const obj: Rd.DocObject = { kind: 'chemdraw', prog: 'ChemDraw.Document.6.0', name: '', picture: null, picture_name: '', group: 0, width_in: null, cdx: cdxmlToCdx(d) };
    const plan = I.analyse([para('**1-Butyl-3-methylimidazolium tetrafluoroborate (3a).** Colorless oil (10 mg, 50%).')]);
    plan.objects = [obj];
    plan.own_objects = plan.compounds.map(() => [obj]);
    await assignStructures(plan, tools);
    const c = plan.compounds.find((x) => x.cid === '3a')!;
    // (both fragments, joined)
    expect(c.structure.split(',')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- writing into a project

const threeGps = (): Rd.Para[] => [
  para('**General Procedure A: Methylation**'),
  para('To a solution of the phenol (0.50 mmol) in acetone (2.0 mL) was added MeI (0.75 mmol).'),
  para('**General Procedure A: Methylation**'),
  para('To a solution of the amine (0.50 mmol) in acetone (2.0 mL) was added MeI (0.75 mmol).'),
];

describe('F949: two general procedures of the same name in one import', () => {
  it('says so, not that the project has one elsewhere', async () => {
    const proj = await SiProject.create(new MemoryFolder('P'), 'P');
    const plan = I.analyse(threeGps());
    expect(plan.gps.length).toBe(2);
    const result = await A.applyPlan(proj, plan, 'si.docx');
    expect(result.notes.some((n) => n.includes('in another section'))).toBe(false);
    expect(result.notes.some((n) => n.includes('two general procedures named'))).toBe(true);
  });
});

describe('F950: merging an import keeps values of fields taken off the page', () => {
  it('a removed Yield keeps its typed value', async () => {
    const proj = await SiProject.create(new MemoryFolder('P'), 'P');
    const first = await A.applyPlan(proj, I.analyse([para('**Anisole (2a).** Colorless oil (10 mg, 80%).')]), 'a.docx');
    const c = proj.compound(first.created[0]);
    expect((valuesOf(c).yield as Json).percent).toBe('80');
    await proj.removeField(c, 'yield');
    const plan = I.analyse([para('**Anisole (2a).** Colorless oil (9 mg, 75%).')]);
    await A.applyPlan(proj, plan, 'b.docx', { sectionId: first.section_id });
    expect((valuesOf(proj.compound(first.created[0])).yield as Json).percent).toBe('80');
  });
});
