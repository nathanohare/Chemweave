// @vitest-environment jsdom
//
// The HTML put on the clipboard for Word, PowerPoint and Excel carries every look a run has and
// writes formula text as chemistry, on every copy path (audit G2-02, G2-16, G2-18, G3-07/G2-17):
// a table copied on its own (tableHtml), Document and caption text (richToHtml, with tables among
// the text), and spreadsheet cells (cellTextHtml).
//
// Chemistry in the expected values: water is H₂O and "2H2O" two of them, the 2 in front a
// coefficient on the line (IUPAC Red Book 2005, IR-3.4 / IR-4.4); sulfate is SO₄²⁻ (PubChem CID
// 1117, "Sulfate", formula O4S-2); dichloromethane CH₂Cl₂ (PubChem CID 6344) and potassium
// carbonate K₂CO₃ (PubChem CID 11430); n-butyllithium written n-BuLi with an italic n (IUPAC
// Blue Book 2013, P-29.6, prefixes n- in italics).

import { describe, it, expect } from 'vitest';
import { tableHtml, parseHtmlTable } from '../src/io/table-clip';
import { richToHtml } from '../src/text/html';
import { formulaParts } from '../src/richtext';
import { cellTextHtml } from '../src/sheet/cell-html';
import type { TableData, TextRun } from '../src/model';

/** The text an HTML fragment shows in its <sub> and <sup> parts, and on the line. */
function parts(html: string): { sub: string[]; sup: string[]; text: string } {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return {
    sub: [...doc.querySelectorAll('sub')].map((e) => e.textContent ?? ''),
    sup: [...doc.querySelectorAll('sup')].map((e) => e.textContent ?? ''),
    text: doc.body.textContent ?? '',
  };
}

const table = (rows: TableData['rows'], more: Partial<TableData> = {}): TableData => ({ cols: rows[0].map(() => 50), rows, head: 0, lines: 'none', ...more });

describe('a table copied to Word or Excel (G2-02)', () => {
  it('writes formula runs as chemistry, as the drawing shows them: a leading coefficient stays on the line, a charge is raised', () => {
    const p = parts(tableHtml(table([[{ runs: [{ text: '2H2O', formula: true }] }, { runs: [{ text: 'SO42-', formula: true }] }]])));
    expect(p.text.replace(/\s/g, '')).toBe('2H2OSO42-');
    // H₂O's 2 is lowered, the coefficient isn't; sulfate's 4 is lowered and its charge raised
    // (the digits next to the sign follow formula style's own rule, the same as the drawing's)
    expect(p.sub[0]).toBe('2');
    expect(p.sub[1].startsWith('4')).toBe(true);
    expect(p.sup.join('')).toContain('-');
    const drawn = formulaParts('SO42-');
    expect(p.sub.slice(1)).toEqual(drawn.filter((x) => x.pos === 'sub').map((x) => x.text));
    expect(p.sup).toEqual(drawn.filter((x) => x.pos === 'sup').map((x) => x.text));
  });

  it('keeps fill, merges down, strikethrough, highlight, size and paragraphs in a cell', () => {
    const html = tableHtml(table([
      [{ runs: [{ text: 'merged' }], rowSpan: 2, fill: '#ffeeaa' }, { runs: [{ text: 'gone', strike: true }, { text: ' lit', highlight: '#ffff00' }] }],
      [{ runs: [] }, { runs: [{ text: 'one\ntwo' }], paras: [{}, { align: 'right' }] }],
    ], { size: 9 }));
    expect(html).toContain('rowspan="2"');
    expect(html).toContain('background:#ffeeaa');
    expect(html).toContain('text-decoration:line-through');
    expect(html).toContain('background:#ffff00');
    expect(html).toContain('font-size:9pt');
    expect(html).toMatch(/<p style="margin:0">.*one.*<\/p><p style="margin:0;text-align:right">.*two.*<\/p>/);
    // the cell covered by the merge is not written again, and the table reads back with it in place
    const back = parseHtmlTable(html)!;
    expect(back[1].map((c) => c.runs.map((r) => r.text).join(''))).toEqual(['', 'one\ntwo']);
  });
});

describe('copied text for Word and PowerPoint (G2-16)', () => {
  it('carries strikethrough, highlight, small and all capitals, spacing and raised or lowered text', () => {
    const html = richToHtml({
      runs: [{ text: 'a', strike: true }, { text: 'b', highlight: '#00ff00' }, { text: 'c', smallCaps: true }, { text: 'd', allCaps: true },
        { text: 'e', spacing: 1.5 }, { text: 'f', raise: 3 }, { text: 'g', raise: -2 }, { text: 'h', underline: true, strike: true }],
      paras: [{}],
    });
    expect(html).toContain('text-decoration:line-through');
    expect(html).toContain('background:#00ff00');
    expect(html).toContain('font-variant:small-caps');
    expect(html).toContain('text-transform:uppercase');
    expect(html).toContain('letter-spacing:1.5pt');
    // as Word's own HTML writes raised and lowered text
    expect(html).toContain('position:relative;top:-3pt;mso-text-raise:3pt');
    expect(html).toContain('position:relative;top:2pt;mso-text-raise:-2pt');
    expect(html).toContain('text-decoration:underline line-through');
  });
});

describe('Document text with a table among it (G2-18)', () => {
  it('writes the table as a table between the paragraphs', () => {
    const t = table([[{ runs: [{ text: 'Entry' }] }, { runs: [{ text: 'K2CO3', formula: true }] }]]);
    const runs: TextRun[] = [{ text: 'Before\n' }, { text: '￼', obj: 7 }, { text: '\nAfter' }];
    const html = richToHtml({ runs, paras: [{}, {}, {}] }, { objectHtml: (r) => (r.obj === 7 ? tableHtml(t) : null) });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('table').length).toBe(1);
    const blocks = [...doc.querySelector('[data-chem-illustrator-text]')!.children].map((e) => `${e.tagName}:${e.textContent}`);
    expect(blocks[0]).toBe('P:Before');
    expect(blocks[1]).toMatch(/^TABLE:Entry/);
    expect(blocks[2]).toBe('P:After');
    // K₂CO₃: both counts lowered
    expect(parts(doc.querySelector('table')!.outerHTML).sub).toEqual(['2', '3']);
    // our own copy for pasting back here is as before (the table comes from the document's own clipboard)
    const own = JSON.parse(doc.querySelector('[data-chem-illustrator-text]')!.getAttribute('data-chem-illustrator-text')!);
    expect(own.runs[1]).toEqual({ text: '' });
  });
});

describe('spreadsheet cells copied as HTML (G3-07)', () => {
  it('writes formatting on part of the text', () => {
    const html = cellTextHtml('n-BuLi in THF', undefined, [{ text: 'n', italic: true }, { text: '-BuLi in THF' }], false)!;
    expect(html).toMatch(/^<span style="font-style:italic">n<\/span>-BuLi in THF$/);
  });

  it('writes the chemistry look the grid shows', () => {
    expect(parts(cellTextHtml('CH2Cl2', undefined, undefined, true)!).sub).toEqual(['2', '2']);
    expect(parts(cellTextHtml('K2CO3', undefined, undefined, true)!).sub).toEqual(['2', '3']);
    // and nothing extra for plain text, whose look is on the cell
    expect(cellTextHtml('THF', undefined, undefined, true)).toBeNull();
  });

  it('turns the cell\'s bold off for a word left plain, and carries strike and a whole cell raised', () => {
    const html = cellTextHtml('bold plain', { bold: true }, [{ text: 'bold ' }, { text: 'plain', bold: false }], false)!;
    expect(html).toContain('<span style="font-weight:normal">plain</span>');
    const sup = cellTextHtml('a', { excel: { vertAlign: 'superscript', strike: true } }, undefined, false)!;
    expect(sup).toBe('<sup><span style="text-decoration:line-through">a</span></sup>');
  });
});
