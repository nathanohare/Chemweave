// Fixes for code scanning (CodeQL) alerts #39, #41, #43, #44, #45 and #53: each behaves as before on ordinary
// input and safely on the input the alert is about.
import { describe, expect, it } from 'vitest';
import { typedFormulaRuns } from '../src/si/blocks';
import { readBytes } from '../src/si/ms-reports';
import { keptFontTable } from '../src/io/docx-write';
// @ts-expect-error: a plain JavaScript script without type declarations
import { tsStrings, checkText } from '../scripts/lint-ui-text.mjs';
// @ts-expect-error: a plain JavaScript script without type declarations
import { headingText } from '../scripts/build-wiki.mjs';

const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('');

describe('code scanning fixes', () => {
  it('reads typed formulas as before, and fails fast on a long bad one (#39)', () => {
    expect(text(typedFormulaRuns('C12H15NO·0.25H2O'))).toBe('C12H15NO·0.25H2O');
    expect(typedFormulaRuns('C12H15NO').some((r) => (r as { valign?: string }).valign === 'sub')).toBe(true);
    const start = performance.now();
    const runs = typedFormulaRuns('C' + '1'.repeat(40) + '!');
    expect(performance.now() - start).toBeLessThan(200);
    expect(text(runs)).toBe('C' + '1'.repeat(40) + '!');
  });

  it('still finds an unclosed mzML file (#41)', () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><mzML><run>');
    expect(() => readBytes(bytes, 'cut.mzML')).toThrow(/not closed/);
  });

  it('decodes a font name in one pass (#43)', () => {
    const xml = '<w:fonts><w:font w:name="A&amp;quot;B"/><w:font w:name="C&amp;D"/></w:fonts>';
    const tree = { from: 'main' as const, type: 'fontTable', path: 'word/fontTable.xml', parts: [{ path: 'word/fontTable.xml', xml }], rels: [] };
    // "A&amp;quot;B" is the name A&quot;B, not A"B: dropping A"B leaves it alone
    expect(keptFontTable(tree, new Set(['a"b']))!.xml).toContain('A&amp;quot;B');
    expect(keptFontTable(tree, new Set(['a&quot;b']))!.xml).not.toContain('A&amp;quot;B');
    expect(keptFontTable(tree, new Set(['c&d']))!.xml).not.toContain('C&amp;D');
  });

  it('skips class-name lists as before, and fails fast on a long near-miss (#53)', () => {
    const texts = (src: string) => (tsStrings(src) as { text: string }[]).map((x) => x.text);
    expect(texts("const a = 'tool-button is-active'; const b = 'Open the file';")).toEqual(['Open the file']);
    const start = performance.now();
    texts(`const c = '${'a-a'.repeat(30)}!';`);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('decodes entities in UI text once (#44)', () => {
    // "&amp;lt;" is the text "&lt;", so it must not turn into "<" and back into markup
    expect(checkText('Use Paste &amp;lt;Special&amp;gt;')).toEqual(checkText('Use Paste &lt;Special&gt;'.replace(/&/g, '&amp;')));
    expect(checkText('Fish &amp; Chips')).toEqual(checkText('Fish & Chips'));
  });

  it('takes every tag out of a heading (#45)', () => {
    expect(headingText('Edit <b>Paste</b>')).toBe('Edit Paste');
    expect(headingText('A <sc<b>ript>x <i>y</i>')).not.toMatch(/<[^>]+>/);
  });
});
