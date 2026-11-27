// @vitest-environment jsdom
//
// Old Word documents (.doc): a small Word 97 file made here by the published layout ([MS-DOC]),
// opened with its text, formatting, headings, a table, a link and a footnote.

import { describe, it, expect } from 'vitest';
import { writeCfb } from '../src/io/cfb';
import { makeDoc, sprm, type TestStyle } from './doc-binary-maker';
import { hyperlinkOf, isDoc, readDoc } from '../src/io/doc-binary';
import * as rt from '../src/richtext';

describe('.doc (Word 97-2003)', () => {
  it('opens the text with its formatting and headings', () => {
    // the footnote mark's place in the text
    const at = 'Results\r'.length + 'The ee was 98% (\x13 HYPERLINK "https://example.org" \x14SI\x15).'.length;
    const fixed = makeDoc([
      { text: 'Results\r', istd: 1, runs: [[0, 7, [...sprm(0x0835, 1), ...sprm(0x4a43, 28, 0)]]] },
      { text: 'The ee was 98% (\x13 HYPERLINK "https://example.org" \x14SI\x15).\x02\r', pap: [...sprm(0x2461, 3)], runs: [[4, 6, sprm(0x0836, 1)], [12, 14, sprm(0x6870, 0xc0, 0, 0, 0)]] },
    ], [{ at, text: 'Freshly made.' }]);
    expect(isDoc(fixed)).toBe(true);
    const { doc } = readDoc(fixed);
    expect(rt.plainText(doc.runs)).toBe('Results\nThe ee was 98% (SI).￼');
    expect(doc.paras[0].style).toBe('Heading1');
    expect(doc.runs[0]).toMatchObject({ bold: true, size: 14, font: 'Times New Roman' });
    expect(doc.runs.find((r) => r.text === 'ee')?.italic).toBe(true);
    expect(doc.runs.find((r) => r.text === 'SI')?.link).toBe('https://example.org');
    expect(doc.paras[1].align).toBe('justify');
    const note = Object.values(doc.objects).find((o) => o.kind === 'note');
    expect(note?.kind === 'note' && rt.plainText(note.runs)).toBe('Freshly made.');
  });

  it('gives text the look of its styles (as Word saves them), with the footnote mark and links as Word shows them', () => {
    // 0 Normal: 11 pt; 1 heading 1: bold, 16 pt, blue, on Normal; 2 Hyperlink (characters): blue, underlined;
    // 3 footnote reference (characters): superscript
    const styles: TestStyle[] = [
      { sti: 0, chpx: sprm(0x4a43, 22, 0) },
      { sti: 1, base: 0, chpx: [...sprm(0x0835, 1), ...sprm(0x4a43, 32, 0), ...sprm(0x6870, 0x2f, 0x54, 0x96, 0)] },
      { sti: 85, stk: 2, chpx: [...sprm(0x6870, 0x05, 0x63, 0xc1, 0), ...sprm(0x2a3e, 1)] },
      { sti: 38, stk: 2, chpx: sprm(0x2a48, 1) },
    ];
    const link = '\x13 HYPERLINK "https://example.org/si" \\o "Supporting information" \x14SI\x15';
    const body = `See the ${link} and go high\x02.\r`;
    const at = 'Results\r'.length + body.indexOf('\x02');
    const start = body.indexOf('\x14SI') + 1;
    const fixed = makeDoc([
      { text: 'Results\r', istd: 1 },
      { text: body, runs: [[start, start + 2, sprm(0x4a30, 2, 0)], [body.indexOf('\x02'), body.indexOf('\x02') + 1, sprm(0x4a30, 3, 0)]] },
    ], [{ at, text: 'Freshly made.' }], styles);
    const { doc } = readDoc(fixed);
    expect(doc.paras[0].style).toBe('Heading1');
    // the heading's look from its style, and the default font (Arial) from the stylesheet
    expect(doc.runs[0]).toMatchObject({ bold: true, size: 16, color: '#2f5496', font: 'Arial' });
    expect(doc.runs.find((r) => r.text.startsWith('See'))).toMatchObject({ size: 11, font: 'Arial' });
    expect(doc.runs.find((r) => r.text.startsWith('See'))?.bold).toBeUndefined();
    expect(doc.runs.find((r) => r.text === 'SI')).toMatchObject({ link: 'https://example.org/si', color: '#0563c1', underline: true, size: 11 });
    const mark = doc.runs.find((r) => r.obj !== undefined);
    expect(mark?.sup).toBe(true);
    expect(rt.plainText(doc.runs)).toBe('Results\nSee the SI and go high￼.');
  });

  it('reads where a HYPERLINK field goes, whatever its switches', () => {
    expect(hyperlinkOf(' HYPERLINK "https://example.org/a b" ')).toBe('https://example.org/a b');
    expect(hyperlinkOf(' HYPERLINK "https://example.org" \\o "A tip" \\t "_blank" ')).toBe('https://example.org');
    expect(hyperlinkOf(' HYPERLINK \\o "A tip" "https://example.org" ')).toBe('https://example.org');
    expect(hyperlinkOf(' HYPERLINK https://example.org ')).toBe('https://example.org');
    expect(hyperlinkOf(' HYPERLINK \\l "_Results" ')).toBe('#_Results');
    expect(hyperlinkOf(' HYPERLINK \\h https://example.org ')).toBe('https://example.org');
    expect(hyperlinkOf(' PAGEREF _Toc1 \\h ')).toBeUndefined();
  });

  it('opens tables', () => {
    const inTable = sprm(0x2416, 1);
    const rowEnd = [...sprm(0x2416, 1), ...sprm(0x2417, 1), ...sprm(0xd608, 8, 0, 2, 0, 0, 0x08, 0x07, 0x10, 0x0e)];
    const { doc } = readDoc(makeDoc([
      { text: 'Before\r' },
      { text: 'Entry\x07', pap: inTable }, { text: 'Yield\x07', pap: inTable }, { text: '\x07', pap: rowEnd },
      { text: '1\x07', pap: inTable }, { text: '85%\x07', pap: inTable }, { text: '\x07', pap: rowEnd },
      { text: 'After\r' },
    ]));
    const tb = Object.values(doc.objects).find((o) => o.kind === 'table');
    expect(tb?.kind === 'table' && tb.table.rows.map((r) => r.map((c) => rt.plainText(c.runs)))).toEqual([['Entry', 'Yield'], ['1', '85%']]);
    expect(tb?.kind === 'table' && tb.table.cols).toEqual([90, 90]);
    expect(rt.plainText(doc.runs)).toBe('Before\n￼\nAfter');
  });

  it('says so when a file is not a Word document', () => {
    expect(() => readDoc(writeCfb([['Workbook', new Uint8Array(600)]]))).toThrow(/Word 97-2003/);
  });
});
