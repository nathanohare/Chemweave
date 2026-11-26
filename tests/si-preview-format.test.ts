// Formatting done in the SI Live Preview: kept in the field's own formatted text where it can be
// (so SI Assistant sees it), else in Chemweave's formatting file, found again after the text
// changes, and put back on each compile.

import { describe, expect, it } from 'vitest';
import { addFormat, applyPreviewFormats, blockSrc, clearFormats, docRanges, locateFormat, markupFormat, parsePreviewFormats, previewFormatsJson, type PreviewFormat } from '../src/si/preview-format';
import * as rt from '../src/richtext';
import type { DocText } from '../src/document/document';

const doc = (text: string): DocText => ({ runs: [{ text }], paras: [{}] } as unknown as DocText);

describe('markupFormat', () => {
  it('puts bold on the stored characters the printed ones line up with', () => {
    // printed "CH₂Cl₂ (5 mL)" from stored "CH_{2}Cl_{2} (5 mL)"
    const r = markupFormat('CH_{2}Cl_{2} (5 mL)', 'CH2Cl2 (5 mL)', 0, 6, { bold: true });
    expect(r.raw).toBe('**CH_{2}Cl_{2}** (5 mL)');
    expect(r.missed).toEqual([]);
  });

  it('takes a look off, and keeps the rest', () => {
    expect(markupFormat('**Stir** *overnight*', 'Stir overnight', 0, 4, { bold: false }).raw).toBe('Stir *overnight*');
    expect(markupFormat('**Stir** *overnight*', 'Stir overnight', 0, 14, 'clear').raw).toBe('Stir overnight');
  });

  it('sub and superscript take each other off', () => {
    expect(markupFormat('x^{2}', 'x2', 1, 2, { sub: true }).raw).toBe('x_{2}');
  });

  it('reports words the program adds, for the formatting file', () => {
    const r = markupFormat('Stir', 'Procedure: Stir', 0, 15, { italic: true });
    expect(r.raw).toBe('*Stir*');
    expect(r.missed).toEqual([[0, 10]]);
  });

  it('is null when nothing stored is selected', () => {
    expect(markupFormat('Stir', 'Procedure: Stir', 0, 9, { italic: true }).raw).toBeNull();
  });
});

describe('the formatting file', () => {
  it('reads back what it writes, and refuses what it can\'t read', () => {
    const items: PreviewFormat[] = [{ id: 'a', src: 'c:1|yield|mass', start: 0, end: 2, text: '91', look: { color: '#c00000', bold: true } }];
    expect(parsePreviewFormats(previewFormatsJson(items))).toEqual(items);
    expect(parsePreviewFormats('not json')).toBeNull();
  });

  it('finds the words again after the text changed, or drops them', () => {
    expect(locateFormat('yield 91%', { start: 6, end: 8, text: '91' })).toEqual([6, 8]);
    expect(locateFormat('the yield 91%', { start: 6, end: 8, text: '91' })).toEqual([10, 12]);
    expect(locateFormat('yield 88%', { start: 6, end: 8, text: '91' })).toBeNull();
  });

  it('a newer look on the same words replaces the older one', () => {
    let items = addFormat([], 's', 'hello world', 0, 5, { color: '#ff0000' });
    items = addFormat(items, 's', 'hello world', 0, 5, { color: '#0000ff' });
    expect(items.length).toBe(1);
    expect(items[0].look).toEqual({ color: '#0000ff' });
  });

  it('Clear All Formatting keeps the parts outside', () => {
    const items = addFormat([], 's', 'hello world', 0, 11, { font: 'Arial' });
    const left = clearFormats(items, 's', 'hello world', 3, 8);
    expect(left.map((f) => f.text)).toEqual(['hel', 'rld']);
  });

  it('maps a field\'s printed text across its pieces, and a page\'s own text by the page', () => {
    const text = 'Yield: 91 mg\nHRMS';
    const spans = [{ start: 7, end: 9, src: 'f' }];
    expect(docRanges(text, spans, 'f', 0, 2)).toEqual([[7, 9]]);
    const blocks = [{ start: 0, end: text.length, node: 'compound:1' }];
    expect(docRanges(text, spans, blockSrc('compound:1'), 0, 5, blocks)).toEqual([[0, 5]]);
  });

  it('is put back on the compiled document', () => {
    const d = doc('Yield: 91 mg');
    const spans = [{ start: 7, end: 9, src: 'f' }];
    const out = applyPreviewFormats(d, spans, [], [{ id: 'x', src: 'f', start: 0, end: 2, text: '91', look: { color: '#c00000' } }]);
    const run = out.runs.find((r) => r.text === '91');
    expect(run?.color).toBe('#c00000');
    expect(rt.plainText(out.runs)).toBe('Yield: 91 mg');
  });

  it('puts a paragraph look on every paragraph its words are in, and only those', () => {
    const d = { runs: [{ text: 'Intro\nStep one\nStep two' }], paras: [{}, {}, {}] } as unknown as DocText;
    const spans = [{ start: 6, end: 23, src: 'p' }];
    const out = applyPreviewFormats(d, spans, [], [{ id: 'x', src: 'p', start: 0, end: 17, text: 'Step one\nStep two', look: { align: 'center', indent: 36 } }]);
    expect(out.paras[0]).toEqual({});
    expect(out.paras[1]).toEqual({ align: 'center', indent: 36 });
    expect(out.paras[2]).toEqual({ align: 'center', indent: 36 });
    expect(rt.plainText(out.runs)).toBe('Intro\nStep one\nStep two');
  });

  it('takes a paragraph look off with no indent', () => {
    const d = { runs: [{ text: 'Step one' }], paras: [{ indent: 36 }] } as unknown as DocText;
    const out = applyPreviewFormats(d, [{ start: 0, end: 8, src: 'p' }], [], [{ id: 'x', src: 'p', start: 0, end: 8, text: 'Step one', look: { indent: 0 } }]);
    expect(out.paras[0].indent).toBeUndefined();
  });

  it('reads paragraph looks back, and drops the values it cannot use', () => {
    const items = parsePreviewFormats(JSON.stringify({ version: 2, items: [{ src: 'p', start: 0, end: 3, text: 'abc', look: { align: 'center', line: 1.5, indent: 'far', pageBreak: true } }, { src: 'p', start: 0, end: 3, text: 'abc', look: { align: 'sideways' } }] }));
    expect(items![0].look).toEqual({ align: 'center', line: 1.5, pageBreak: true });
    expect(items![1].look).toEqual({});
  });

  it('writes version 2 once a paragraph look is kept, so a Chemweave that reads only version 1 never writes it over', () => {
    const piece = { id: 'x', src: 'p', start: 0, end: 3, text: 'abc', look: { bold: true } };
    expect(JSON.parse(previewFormatsJson([piece])).version).toBe(1);
    expect(JSON.parse(previewFormatsJson([piece, { ...piece, look: { align: 'center' as const } }])).version).toBe(2);
  });
});

describe('finding the words again safely', () => {
  it('tells alike words apart by the characters beside them', () => {
    // a red "H" in "(m, 1H)": the report gains text before it, and another "H" comes nearer
    const before = '7.39 (m, 4H), 7.30 (m, 1H)';
    const [piece] = addFormat([], 'nmr', before, 24, 25, { color: '#c00000' });
    const after = 'δ 7.39 (m, 4H), 7.30 (m, 1H)';
    expect(locateFormat(after, piece)).toEqual([26, 27]);
  });

  it('drops a short piece it can no longer tell apart', () => {
    const [piece] = addFormat([], 'x', 'a H b', 2, 3, { bold: true });
    expect(locateFormat('H H', piece)).toBeNull();
  });

  it('Bold put back in a field takes off an earlier Bold-off piece there, keeping its other looks', () => {
    const items = addFormat([], 's', 'Colorless oil', 0, 9, { bold: false, color: '#c00000' });
    const left = clearFormats(items, 's', 'Colorless oil', 0, 9, ['bold']);
    expect(left.map((f) => f.look)).toEqual([{ color: '#c00000' }]);
  });

  it('never writes over a file it could not read, or one from a newer version', async () => {
    const { readPreviewFormatsToChange } = await import('../src/si/preview-format');
    const busy = { readText: () => Promise.reject(new Error('EBUSY')) } as unknown as Parameters<typeof readPreviewFormatsToChange>[0];
    await expect(readPreviewFormatsToChange(busy)).rejects.toThrow();
    expect(parsePreviewFormats('{"version":4,"items":[]}')).toBeNull();
  });
});

describe('links (Insert ▸ Link in the Live Preview)', () => {
  it('puts a link back on the compiled document, as a real link with its blue and underline', () => {
    const d = doc('See the data deposit for details');
    const spans = [{ start: 0, end: 32, src: 'k:1' }];
    const out = applyPreviewFormats(d, spans, [], [{ id: 'x', src: 'k:1', start: 8, end: 20, text: 'data deposit', look: { link: 'https://doi.org/10.1000/xyz123', color: '#0563c1', underline: true } }]);
    const run = out.runs.find((r) => r.text === 'data deposit');
    expect(run?.link).toBe('https://doi.org/10.1000/xyz123');
    expect(run?.underline).toBe(true);
    expect(out.runs.find((r) => r.text === 'See the ')?.link).toBeUndefined();
  });

  it('keeps links in the file as version 3, and reads them back', () => {
    const items: PreviewFormat[] = [{ id: 'x', src: 'k:1', start: 0, end: 4, text: 'data', look: { link: 'https://example.org/', underline: true } }];
    const json = previewFormatsJson(items);
    expect(JSON.parse(json).version).toBe(3);
    expect(parsePreviewFormats(json)?.[0].look).toEqual({ link: 'https://example.org/', underline: true });
    // (a newer file is never read, so never written over)
    expect(parsePreviewFormats(JSON.stringify({ version: 4, items: [] }))).toBeNull();
    // (a link that isn't text is dropped)
    expect(parsePreviewFormats(JSON.stringify({ version: 3, items: [{ src: 'p', start: 0, end: 3, text: 'abc', look: { link: true } }] }))?.[0].look).toEqual({});
  });

  it('Remove Link takes off only the link, its blue and its underline', () => {
    const items: PreviewFormat[] = [{ id: 'x', src: 'p', start: 0, end: 4, text: 'data', look: { link: 'https://example.org/', color: '#0563c1', underline: true, bold: true } }];
    const out = clearFormats(items, 'p', 'data here', 0, 4, ['link', 'color', 'underline']);
    expect(out.map((f) => f.look)).toEqual([{ bold: true }]);
  });
});
