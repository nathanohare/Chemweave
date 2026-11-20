// @vitest-environment jsdom
//
// Regression tests from the review of the linked manuscript and the Manuscript Check: links kept
// per field in Word files, bold numbers that aren't compounds, a deleted first mention, Renumber
// SI's clashes, comparisons shared with the Manuscript Check, pasted compound numbers, and an
// open document added again.
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { checkAgainstSi, compoundNumbers, linkTypedIds, manuscriptIds, renumberClashes, renumberPlan, sameDr, sameEe, sameYield, validId, type SiView } from '../src/si/manuscript';
import * as C from '../src/si/ms-check';
import { DocBuilder } from '../src/io/doc-build';
import { fieldTexts, pastedObjects, promoteCompoundMentions, pruneObjects, type DocObject, type DocText } from '../src/document/document';
import { writeDocx } from '../src/io/docx-write';
import { readDocx } from '../src/io/docx-read';
import { MemoryFolder } from '../src/si/folder';
import { SiProject } from '../src/si/project';
import type { SiTarget } from '../src/si/compile-doc';

const tg = (key: string, label: string): SiTarget => ({ kind: 'compound', key, label, caption: `compound ${label}`, mark: '' }) as SiTarget;
const view: SiView = { title: 'SI', targets: [tg('kA', '1'), tg('kB', '2'), tg('kC', '3'), tg('k2a', '2a')], pages: new Map(), data: new Map([['kA', { yield: '92', dr: '10:1', ee: '99' }]]) };
const show = (t: DocText): string => { const s = fieldTexts(t); return t.runs.map((r) => (r.obj !== undefined ? s.get(r.obj) : r.text)).join(''); };
const bold = { bold: true };
const deps = { async picture() { return null; } };
const links = (t: DocText): [string, Record<string, string>][] => compoundNumbers(t).map((n) => [n.number, n.si]);

function three(): DocText {
  const b = new DocBuilder();
  b.text('Intro.', {}); b.endPara({});
  b.text('Ketone ', {}); b.text('1', bold); b.text(', ', {}); b.text('2', bold); b.text(' and ', {}); b.text('3', bold); b.text('.', {}); b.endPara({});
  return linkTypedIds(b.finish({}), view).t;
}

describe('compound numbers’ links in Word files', () => {
  it('stay with their own number when a number is added in Word before them', async () => {
    const t = three();
    const z = unzipSync(await writeDocx(t, deps));
    let xml = strFromU8(z['word/document.xml']);
    const m = /<w:p[ >](?:(?!<\/w:p>).)*SEQ Compound(?:(?!<\/w:p>).)*<\/w:p>/s.exec(xml)!;
    const added = '<w:p><w:r><w:t xml:space="preserve">New ketone </w:t></w:r><w:fldSimple w:instr=" SEQ Compound \\* ARABIC "><w:r><w:rPr><w:b/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p>';
    xml = xml.slice(0, m.index) + added + xml.slice(m.index);
    z['word/document.xml'] = strToU8(xml);
    const { doc: back } = await readDocx(zipSync(z));
    // the new compound is 1 and linked to nothing; the others moved up with their links
    expect(links(back)).toEqual([['1', {}], ['2', { '': 'kA' }], ['3', { '': 'kB' }], ['4', { '': 'kC' }]]);
    // (the new 1 has the ID of the SI's 1, which is 2 here now: said by the check, not renumbered blindly)
    expect(renumberPlan(back, view).map((x) => `${x.from}→${x.to}`)).toEqual(['2→3', '3→4']);
    expect(checkAgainstSi(back, view).some((f) => f.what === 'id' && f.key === 'kA' && f.manuscript === '1, 2')).toBe(true);
  });

  it('stay when a number is deleted in Word', async () => {
    const z = unzipSync(await writeDocx(three(), deps));
    let xml = strFromU8(z['word/document.xml']);
    // the first compound number (its bookmark and field) taken out
    const a = xml.indexOf('<w:bookmarkStart', xml.indexOf('Ketone '));
    const b = xml.indexOf('<w:bookmarkEnd', a);
    xml = xml.slice(0, a) + xml.slice(xml.indexOf('/>', b) + 2);
    z['word/document.xml'] = strToU8(xml);
    const { doc: back } = await readDocx(zipSync(z));
    expect(links(back)).toEqual([['1', { '': 'kB' }], ['2', { '': 'kC' }]]);
  });

  it('round-trip unchanged, also for a number first mentioned in a table', async () => {
    const b = new DocBuilder();
    const cell = (text: string, look = {}) => ({ runs: text ? [{ text, ...look }] : [] });
    b.text('Table 1', {}); b.endPara({});
    b.table({ kind: 'table', table: { cols: [60, 60], head: 1, rows: [[cell('cpd'), cell('yield')], [cell('3', bold), cell('90')]] } }, {});
    b.endPara({});
    b.text('Then ', {}); b.text('2a', bold); b.text(' and ', {}); b.text('1', bold); b.text('.', {}); b.endPara({});
    const t = linkTypedIds(b.finish({}), view).t;
    const { doc: back } = await readDocx(await writeDocx(t, deps));
    expect(links(back)).toEqual(links(t));
    expect(links(back)).toEqual([['1', { '': 'kC' }], ['2', { a: 'k2a' }], ['3', { '': 'kA' }]]);
  });

  it('are dropped, not given to other compounds, in a file saved by position whose numbers changed', async () => {
    const t = three();
    const edit = async (siNumbers: unknown[]): Promise<DocText> => {
      const z = unzipSync(await writeDocx(t, deps));
      // the links as files were saved before: a list in the order of the numbers
      const part = Object.keys(z).find((k) => strFromU8(z[k]).includes('siLinks&quot;'))!;
      const text = strFromU8(z[part]);
      const was = /&quot;siLinks&quot;:\{.*?\}\}/.exec(text)!;
      z[part] = strToU8(text.replace(was[0], `&quot;siNumbers&quot;:${JSON.stringify(siNumbers).replace(/"/g, '&quot;')}`));
      return (await readDocx(zipSync(z))).doc;
    };
    // as many as the numbers: used
    expect(links(await edit([{ '': 'kA' }, { '': 'kB' }, { '': 'kC' }]))).toEqual([['1', { '': 'kA' }], ['2', { '': 'kB' }], ['3', { '': 'kC' }]]);
    // one fewer than the numbers (a number was added since): none is linked
    expect(links(await edit([{ '': 'kA' }, { '': 'kB' }]))).toEqual([['1', {}], ['2', {}], ['3', {}]]);
  });
});

describe('bold numbers that are not compounds', () => {
  it('are left as typed: decimals, amounts, headings, the reference list', () => {
    const b = new DocBuilder();
    b.text('2.1 Synthesis of ketones', bold); b.endPara({});
    b.text('2. Results', bold); b.endPara({});
    b.text('Ketone ', {}); b.text('3', bold); b.text(' and ', {}); b.text('1', bold); b.text(' (', {}); b.text('1.5 equiv', bold); b.text(', ', {}); b.text('3 h', bold); b.text(', ', {}); b.text('80 °C', bold); b.text(', ', {}); b.text('5 mol%', bold); b.text(') gave ', {}); b.text('2a', bold); b.text('.', {}); b.endPara({});
    b.text('References', bold); b.endPara({});
    b.text('J. Org. Chem., 2015, ', {}); b.text('80', bold); b.text(', 1234.', {}); b.endPara({});
    const r = linkTypedIds(b.finish({}), view);
    expect(r.typed).toEqual(['3', '1', '2a']);
    expect(show(r.t)).toBe('2.1 Synthesis of ketones\n2. Results\nKetone 1 and 2 (1.5 equiv, 3 h, 80 °C, 5 mol%) gave 3a.\nReferences\nJ. Org. Chem., 2015, 80, 1234.\n'.slice(0, show(r.t).length));
    expect(show(r.t)).toContain('J. Org. Chem., 2015, 80, 1234.');
    expect(r.changed).toEqual([{ from: '3', to: '1' }, { from: '1', to: '2' }, { from: '2', to: '3' }]);
  });

  it('are left alone in heading styles, while compounds in the text are still found', () => {
    const b = new DocBuilder();
    b.text('Synthesis of 4', bold); b.endPara({ style: 'Heading2' });
    b.text('Ketone ', {}); b.text('2', bold); b.text(' gave ', {}); b.text('3', bold); b.text('.', {}); b.endPara({});
    const r = linkTypedIds(b.finish({}), view);
    expect(r.typed).toEqual(['2', '3']);
  });
});

describe('a compound whose first mention is deleted', () => {
  const made = (): { t: DocText; cut: DocText } => {
    const b = new DocBuilder();
    b.text('Ketone ', {}); b.text('2a', bold); b.text(' and ', {}); b.text('3', bold); b.text(' then again ', {}); b.text('2a', bold); b.text(' and ', {}); b.text('2a', bold); b.text('.', {}); b.endPara({});
    const t = linkTypedIds(b.finish({}), view).t;
    // the first mention (the number and its letter) deleted, as Backspace does: objects are pruned only on saving
    const i = t.runs.findIndex((x) => x.obj !== undefined);
    return { t, cut: { ...t, runs: t.runs.filter((_, k) => k !== i && k !== i + 1) } };
  };

  it('keeps its number and its link on the next mention', () => {
    const { cut } = made();
    // 3 is now first mentioned, so it is 1; the other is 2a, wherever it is mentioned
    expect(show(cut)).toBe('Ketone  and 1 then again 2a and 2a.\n'.slice(0, show(cut).length));
    expect(show(cut)).not.toContain('Error');
    expect([...manuscriptIds(cut, view)].map(([k, v]) => [k, [...v]])).toEqual([['kC', ['1']], ['k2a', ['2a']]]);
    expect(renumberPlan(cut, view)).toEqual([{ key: 'kC', from: '3', to: '1' }]);
    expect(links(cut)).toEqual([['1', { '': 'kC' }], ['2', { a: 'k2a' }]]);
  });

  it('is saved with the next mention as the number', async () => {
    const { cut } = made();
    const real = pruneObjects(cut);
    expect(Object.values(real.objects).filter((o) => o.kind === 'seq')).toHaveLength(2);
    expect(show(real)).toBe(show(cut));
    expect(links(real)).toEqual(links(cut));
    expect(promoteCompoundMentions(real)).toBe(real);
    const { doc: back } = await readDocx(await writeDocx(cut, deps));
    expect(show(back)).toBe(show(cut));
    expect(links(back)).toEqual(links(cut));
  });

  it('is not listed once every mention is gone, and no ID that isn’t one is ever planned', () => {
    const { t } = made();
    const none: DocText = { ...t, runs: [{ text: 'Nothing.\n' }] };
    expect(compoundNumbers(none)).toEqual([]);
    expect(validId('2a')).toBe(true);
    expect(validId('3b′')).toBe(true);
    expect(validId('Error! Reference source not found.a')).toBe(false);
    expect(validId('')).toBe(false);
    // a mention showing an error (its number is gone from the objects too) is never an SI ID
    const i = t.runs.findIndex((x) => x.obj !== undefined);
    const seq = t.runs[i].obj!;
    const objects: Record<number, DocObject> = { ...t.objects, [seq]: { kind: 'seq', name: 'Figure' } };
    for (const x of renumberPlan({ ...t, objects }, view)) expect(validId(x.to)).toBe(true);
  });
});

describe('Renumber SI', () => {
  it('says which IDs two SI compounds would share', () => {
    const b = new DocBuilder();
    b.text('Ketone ', {}); b.text('3', bold); b.text('.', {}); b.endPara({});
    const t = linkTypedIds(b.finish({}), view).t;
    const plan = renumberPlan(t, view);
    expect(plan).toEqual([{ key: 'kC', from: '3', to: '1' }]);
    const clashes = renumberClashes(plan, view);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].id).toBe('1');
    expect(clashes[0].compounds.map((c) => [c.key, c.renumbered])).toEqual([['kA', false], ['kC', true]]);
  });

  it('finds no clash when the compounds swap', () => {
    expect(renumberClashes([{ key: 'kA', to: '2' }, { key: 'kB', to: '1' }], view)).toEqual([]);
  });
});

describe('values compared as the Manuscript Check compares them', () => {
  it('dr', () => {
    for (const [a, b] of [['5:1', '6:1'], ['10:1', '12:1'], ['15:1', '20:1'], ['10:1', '>20:1'], ['20:1', '>20:1'], ['5:1', '83:17'], ['19:1', '95:5'], ['5:1', '5:1']]) expect(sameDr(a, b), `${a} / ${b}`).toBe(C.sameDr(a, b));
    expect(sameDr('10:1', '12:1')).toBe(false);
    expect(sameDr('15:1', '20:1')).toBe(false);
    expect(sameDr('10:1', '>20:1')).toBe(false);
    expect(sameDr('5:1', '83:17')).toBe(true);
    expect(sameDr('n.d.', '5:1')).toBe(true);
  });
  it('ee and er', () => {
    expect(sameEe('>99', '99')).toBe(false);
    expect(sameEe('99', '99.0')).toBe(true);
    expect(sameEe('95:5 er', '90% ee')).toBe(true);
    expect(sameEe('95:5 er', '92% ee')).toBe(false);
    expect(sameEe('rac', '0')).toBe(true);
    expect(sameEe('n.d.', '94')).toBe(true);
  });
  it('yields', () => {
    expect(sameYield('92', '92.0')).toBe(true);
    expect(sameYield('>99', '99')).toBe(false);
    expect(sameYield('≥99', 'quant.')).toBe(true);
    expect(sameYield('quant.', '100')).toBe(true);
    expect(sameYield('quant.', '95')).toBe(false);
  });
  it('in a table: a value in brackets is not the yield, and a comma is a decimal point', () => {
    const table = (y: string, dr: string): DocText => {
      const b = new DocBuilder();
      const cell = (text: string, look = {}) => ({ runs: text ? [{ text, ...look }] : [] });
      b.text('Table 1', {}); b.endPara({});
      b.table({ kind: 'table', table: { cols: [60, 60, 60], head: 1, rows: [[cell('cpd'), cell('yield (%)'), cell('dr')], [cell('1', bold), cell(y), cell(dr)]] } }, {});
      b.endPara({});
      return b.finish({});
    };
    const kinds = (t: DocText): string[] => checkAgainstSi(t, view).filter((f) => f.level === 'problem').map((f) => f.what);
    expect(kinds(table('92', '10:1'))).toEqual([]);
    expect(kinds(table('92.0', '10:1'))).toEqual([]);
    expect(kinds(table('85 (92 brsm)', '10:1'))).toEqual(['yield']);
    expect(kinds(table('92 (85)', '12:1'))).toEqual(['dr']);
    expect(kinds(table('92,5', '10:1'))).toEqual(['yield']);
    expect(kinds(table('n.d.', '10:1'))).toEqual([]);
  });
});

describe('a compound number pasted', () => {
  const t = three();
  const seq = t.runs.find((r) => r.obj !== undefined)!.obj!;
  const copy = { [seq]: t.objects[seq] };

  it('into the document it was copied from is another mention of the same number', () => {
    const { ids, objects } = pastedObjects(t, copy, true);
    const id = ids.get(seq)!;
    expect(id).not.toBe(seq);
    expect(objects[id]).toEqual({ kind: 'ref', target: seq });
    const pasted: DocText = { ...t, objects, runs: [...t.runs, { text: '￼', obj: id, bold: true }] };
    expect(links(pasted)).toEqual(links(t));
    expect(show(pasted).endsWith('1')).toBe(true);
  });

  it('after its number was cut out is that number again', () => {
    const cut: DocText = { ...t, runs: t.runs.filter((r) => r.obj !== seq) };
    const { ids, objects } = pastedObjects(cut, copy, true);
    expect(ids.get(seq)).toBe(seq);
    expect(objects[seq]).toEqual(t.objects[seq]);
  });

  it('into another document is a new number', () => {
    const { ids, objects } = pastedObjects(t, copy, false);
    expect(objects[ids.get(seq)!]).toEqual(t.objects[seq]);
    expect(ids.get(seq)).not.toBe(seq);
  });
});

describe('an open document added to the Manuscript Check again', () => {
  it('replaces its earlier copy, which goes to the Trash', async () => {
    const folder = new MemoryFolder('p');
    await folder.writeText('project.json', JSON.stringify({ format_version: 1, title: 'P', sections: [] }));
    let p: SiProject;
    p = await SiProject.open(folder);
    const one = await C.addManuscriptFile(p, 'Paper.docx', new Uint8Array([1]), true);
    const two = await C.addManuscriptFile(p, 'Paper.docx', new Uint8Array([2]), true);
    expect([one, two]).toEqual(['Paper.docx', 'Paper.docx']);
    expect(await C.manuscriptFiles(p)).toEqual(['Paper.docx']);
    expect([...(await folder.readBytes('manuscript/Paper.docx'))!]).toEqual([2]);
    // added as a file (not an open document): kept beside the first, as before
    expect(await C.addManuscriptFile(p, 'Paper.docx', new Uint8Array([3]))).toBe('Paper (2).docx');
    expect((await folder.entries('trash')).length).toBeGreaterThan(0);
  });
});
