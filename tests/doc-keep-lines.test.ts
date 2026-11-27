// Word's Keep lines together (Paragraph ▸ Line and Page Breaks): a paragraph that won't fit in
// what is left of the page goes to the next page whole, unless it is taller than a page.
import { describe, it, expect } from 'vitest';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { documentMeasure } from '../src/text/font-measure';
import type { ParaStyle, TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const LONG = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');

/** `filler` one-line paragraphs, then a long paragraph with `extra`. */
function docOf(filler: number, extra: Partial<ParaStyle>, text = LONG): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  for (let i = 0; i < filler; i++) { runs.push({ ...runStyleOf(s), text: `line ${i}\n` }); paras.push(paraFromStyle(s, {})); }
  runs.push({ ...runStyleOf(s), text });
  paras.push({ ...paraFromStyle(s, {}), ...extra });
  return { ...d, runs, paras };
}

/** The pages the last paragraph's lines are on. */
function pagesOfLast(t: DocText): number[] {
  const lay = layouter().layout(t);
  const last = t.paras.length - 1;
  const out = new Set<number>();
  lay.text.lines.forEach((l, i) => { if (l.para === last) out.add(lay.pages.findIndex((p) => i >= p.first && i < p.end)); });
  return [...out];
}

describe('Keep lines together', () => {
  it('moves a paragraph that would be split across pages to the next page whole', () => {
    // (enough lines before it that, left alone, it starts on page 1 and runs onto page 2)
    let filler = 1;
    while (filler < 200 && pagesOfLast(docOf(filler, {})).length < 2) filler++;
    expect(pagesOfLast(docOf(filler, {}))).toEqual([0, 1]);
    expect(pagesOfLast(docOf(filler, { keepLines: true }))).toEqual([1]);
  });

  it('still splits a paragraph taller than a page', () => {
    const huge = Array.from({ length: 40 }, () => LONG).join(' ');
    expect(pagesOfLast(docOf(3, { keepLines: true }, huge)).length).toBeGreaterThan(1);
  });
});
