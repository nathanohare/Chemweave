// @vitest-environment jsdom
// The SI Live Preview's Word commands from Document mode (Home ▸ Paste options, the Font box's
// All Caps and character spacing, Bullets and Numbering, Tabs, the Ruler and the Paragraph box):
// each look is kept in Chemweave's formatting file, read back, put on the compiled document, and
// carried into the Word file the SI is saved as.
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { addFormat, applyPreviewFormats, locateFormat, paraLookOf, parsePreviewFormats, previewFormatVersion, previewFormatsJson, reanchorFormats, type PreviewFormat } from '../src/si/preview-format';
import { writeDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, type DocText } from '../src/document/document';
import { indentPatch, listPatch, numberedListRange } from '../src/text/paragraphs';
import { pastedLooks } from '../src/ui/si-paste-html';
import { wordPasteChoices } from '../src/ui/paste-options';
import { listPickerOptions } from '../src/ui/list-pickers';
import * as rt from '../src/richtext';

const piece = (look: PreviewFormat['look'], text = 'Step one', start = 0): PreviewFormat => ({ id: 'x', src: 'p', start, end: start + text.length, text, look });

describe('the formatting file keeps the new looks', () => {
  it('reads back lists, tab stops, Word paragraph settings, All Caps and character spacing, and drops what it cannot use', () => {
    const look = {
      list: 'number', level: 1, scheme: 'paren', bullet: '', firstLine: -18, indentRight: 36, linePt: 14, lineRule: 'exact', keepNext: true, keepLines: true, spaceAfter: 0,
      tabs: [{ pos: 72, kind: 'decimal', leader: 'dot' }, { pos: 'far', kind: 'left' }, { pos: 144, kind: 'sideways' }],
      allCaps: true, spacing: 1.5, noKern: true,
    };
    const items = parsePreviewFormats(JSON.stringify({ version: 3, items: [{ src: 'p', start: 0, end: 3, text: 'abc', look }, { src: 'p', start: 0, end: 3, text: 'abc', look: { list: 'star', level: 2.5, lineRule: 'often', keepLines: 'yes' } }] }));
    expect(items![0].look).toEqual({ ...look, tabs: [{ pos: 72, kind: 'decimal', leader: 'dot' }] });
    expect(items![1].look).toEqual({});
  });

  it('writes version 3 once a look a version-2 Chemweave would drop is kept, so it is never written over', () => {
    expect(JSON.parse(previewFormatsJson([piece({ align: 'center' })])).version).toBe(2);
    for (const look of [{ keepLines: true }, { tabs: [{ pos: 36, kind: 'left' as const }] }, { list: 'bullet' as const }, { allCaps: true }, { spacing: 2 }]) {
      expect(JSON.parse(previewFormatsJson([piece(look)])).version, JSON.stringify(look)).toBe(3);
    }
    expect(parsePreviewFormats('{"version":4,"items":[]}')).toBeNull();
  });

  it('a change as Document mode makes it (undefined takes a setting off) becomes a look that takes it off', () => {
    expect(paraLookOf({ indent: undefined, firstLine: 9, tabs: undefined, keepNext: true })).toEqual({ indent: '', firstLine: 9, tabs: [], keepNext: true });
    // (keys that aren't paragraph settings kept here are left out)
    expect(paraLookOf({ cont: undefined, list: 'bullet' })).toEqual({ list: 'bullet' });
  });
});

describe('putting them on the compiled document', () => {
  const two = (): DocText => ({ runs: [{ text: 'Intro\nStep one' }], paras: [{}, { spaceAfter: 6, firstLine: 18, tabs: [{ pos: 9, kind: 'left' }] }] } as unknown as DocText);
  const spans = [{ start: 6, end: 14, src: 'p' }];

  it('puts a list, tab stops and Word paragraph settings on the paragraph, and only it', () => {
    const out = applyPreviewFormats(two(), spans, [], [piece({ list: 'bullet', bullet: '■', level: 1, tabs: [{ pos: 72, kind: 'right' }], keepNext: true, keepLines: true, indentRight: 18, linePt: 16, lineRule: 'atLeast' })]);
    expect(out.paras[0]).toEqual({});
    expect(out.paras[1]).toEqual({ spaceAfter: 6, firstLine: 18, list: 'bullet', bullet: '■', level: 1, tabs: [{ pos: 72, kind: 'right' }], keepNext: true, keepLines: true, indentRight: 18, linePt: 16, lineRule: 'atLeast' });
  });

  it('0, no tab stops, no list and false take the paragraph\'s own settings off (it has the style\'s again, as in a document)', () => {
    const out = applyPreviewFormats(two(), spans, [], [piece({ spaceAfter: 0, firstLine: 0, tabs: [], list: '', keepNext: false })]);
    expect(out.paras[1]).toEqual({});
  });

  it('puts All Caps and character spacing on the words, and 0 spacing takes it off', () => {
    const d = { runs: [{ text: 'Yield: 91 mg', spacing: 2 }], paras: [{}] } as unknown as DocText;
    const out = applyPreviewFormats(d, [{ start: 7, end: 9, src: 'f' }], [], [{ id: 'x', src: 'f', start: 0, end: 2, text: '91', look: { allCaps: true, spacing: 0, noKern: true } }]);
    const run = out.runs.find((r) => r.text === '91')!;
    expect([run.allCaps, run.spacing, run.noKern]).toEqual([true, undefined, true]);
    expect(rt.plainText(out.runs)).toBe('Yield: 91 mg');
  });

  it('carries them into the Word file', async () => {
    const d: DocText = { ...newDocument(), runs: [{ text: 'Intro\nStep one' }], paras: [{}, {}] };
    const out = applyPreviewFormats(d, spans, [], [
      piece({ list: 'number', keepNext: true, keepLines: true, tabs: [{ pos: 72, kind: 'decimal', leader: 'dot' }], firstLine: -18, indentRight: 36, linePt: 14, lineRule: 'exact' }),
      { id: 'y', src: 'p', start: 0, end: 4, text: 'Step', look: { allCaps: true, spacing: 1 } },
    ]);
    const deps: DocxDeps = { async picture() { return null; } };
    const xml = strFromU8(unzipSync(await writeDocx(out, deps))['word/document.xml']);
    const para = xml.slice(xml.indexOf('Intro'));
    expect(para).toContain('<w:numPr>');
    expect(para).toContain('<w:keepNext/>');
    expect(para).toContain('<w:keepLines/>');
    expect(para).toContain('<w:tab w:val="decimal" w:leader="dot" w:pos="1440"/>');
    expect(para).toContain('w:line="280" w:lineRule="exact"');
    expect(para).toContain('w:right="720"');
    expect(xml).toContain('<w:caps/>');
    expect(xml).toMatch(/<w:spacing w:val="20"\/>/);
  });
});

describe('Change Case keeps the formatting file\'s pieces on the same letters', () => {
  it('finds a piece again after its words changed case', () => {
    const before = 'Step one of two', after = 'STEP ONE OF TWO';
    const items = addFormat([], 'p', before, 0, 8, { color: '#c00000' });
    // (finding words is case-sensitive: left as it was, the piece would be lost)
    expect(locateFormat(after, items[0])).toBeNull();
    const moved = reanchorFormats(items, 'p', before, after);
    expect(moved[0]).toMatchObject({ id: items[0].id, text: 'STEP ONE', after: ' OF TWO', look: { color: '#c00000' } });
    expect(locateFormat(after, moved[0])).toEqual([0, 8]);
    // (another field's pieces are left as they are)
    const other = addFormat([], 'q', before, 0, 4, { bold: true });
    expect(reanchorFormats(other, 'p', before, after)).toEqual(other);
  });
  it('leaves the micro sign alone (µL is not ΜL), in Document mode too', () => {
    const runs = [{ text: 'added 50 µL of water' }];
    expect(rt.plainText(rt.changeCase(runs, 0, 20, 'upper'))).toBe('ADDED 50 µL OF WATER');
    expect(rt.plainText(rt.changeCase(runs, 0, 20, 'toggle'))).toBe('ADDED 50 µl OF WATER');
  });
});

describe('the file\'s version', () => {
  it('is never written lower than the file was', () => {
    const old = piece({ bold: true });
    expect(JSON.parse(previewFormatsJson([old], 3)).version).toBe(3);
    expect(previewFormatVersion('{"version":3,"items":[]}')).toBe(3);
    expect(previewFormatVersion('{"items":[]}')).toBe(1);
  });
  it('drops All Caps, kerning and character spacing it cannot use', () => {
    const items = parsePreviewFormats(JSON.stringify({ version: 3, items: [{ src: 'p', start: 0, end: 3, text: 'abc', look: { allCaps: 'yes', noKern: 1, spacing: 500 } }, { src: 'p', start: 0, end: 3, text: 'abc', look: { allCaps: false, noKern: true, spacing: -2.5 } }] }));
    expect(items!.map((x) => x.look)).toEqual([{}, { allCaps: false, noKern: true, spacing: -2.5 }]);
  });
});

describe('Document mode\'s list and indent steps, shared', () => {
  it('a number format reaches the numbered items next to those selected', () => {
    const paras = [{}, { list: 'number' as const }, { list: 'number' as const }, { list: 'number' as const }, {}];
    expect(numberedListRange(paras, 2, 2)).toEqual([1, 3]);
    expect(numberedListRange(paras, 0, 0)).toEqual([0, 0]);
  });
  it('Bullets on paragraphs that all have them takes them off; on any other, puts them on', () => {
    expect(listPatch([{ list: 'bullet' }, { list: 'bullet' }], 'bullet')).toEqual({ list: undefined, level: undefined, cont: undefined });
    expect(listPatch([{ list: 'bullet' }, {}], 'bullet')).toEqual({ list: 'bullet', cont: undefined });
    expect(listPatch([{ list: 'bullet' }], 'number')).toEqual({ list: 'number', cont: undefined });
  });
  it('Increase Indent: a list item a level in, any other paragraph by the step', () => {
    expect(indentPatch({ list: 'number', level: 8 }, 1, 36)).toEqual({ level: 8 });
    expect(indentPatch({ list: 'number' }, -1, 36)).toEqual({ level: 0 });
    expect(indentPatch({ indent: 36 }, -1, 36)).toEqual({ indent: 0 });
    expect(indentPatch({ indent: -10 }, -1, 36)).toEqual({ indent: -10 });
  });
});

describe('Paste options and the list pickers', () => {
  it('Keep Source Formatting keeps the copied bold, italics, underline, sub- and superscripts as stretches of the text', () => {
    const got = pastedLooks('<p>CH<sub>2</sub>Cl<sub>2</sub>, <b>91%</b> <i><b>yield</b></i></p><p>next</p>');
    expect(got.text).toBe('CH2Cl2, 91% yield\nnext');
    expect(got.looks).toEqual([
      { a: 2, b: 3, look: { sub: true } }, { a: 5, b: 6, look: { sub: true } }, { a: 8, b: 11, look: { bold: true } }, { a: 12, b: 17, look: { bold: true, italic: true } },
    ]);
  });
  it('keeps a table\'s cells apart by tabs and its rows and paragraphs by line breaks, with no stray spaces', () => {
    expect(pastedLooks('<table><tr><td>1.23</td><td><b>4.56</b></td></tr>\n<tr><td>7.8</td><td>9</td></tr></table>')).toEqual({ text: '1.23\t4.56\n7.8\t9', looks: [{ a: 5, b: 9, look: { bold: true } }] });
    expect(pastedLooks('<p>one</p>\n<p><i>two</i></p>').text).toBe('one\ntwo');
  });
  it('the SI\'s Paste ▾ has Word\'s choices, as Document mode\'s does', () => {
    expect(wordPasteChoices('si').map((c) => c && [c.label, c.enabled])).toEqual([['Keep Source Formatting', true], ['Keep Text Only (Ctrl+Shift+V)', true], null, ['Paste as Picture', true]]);
    expect(wordPasteChoices('document', { object: false }).map((c) => c?.label ?? null)).toEqual(['Keep Source Formatting', 'Keep Text Only (Ctrl+Shift+V)', null, 'Paste as Object', 'Paste SMILES']);
  });
  it('Bullets ▾ and Numbering ▾ offer the bullet library and the number formats', () => {
    expect(listPickerOptions('bullets')).toContainEqual(['5', '✓  Check Mark']);
    expect(listPickerOptions('multilevel').slice(0, 2)).toEqual([['default', '1. a. i.'], ['outline', '1. 1.1. 1.1.1.']]);
  });
});
