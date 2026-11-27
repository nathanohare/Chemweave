// Code review batch 10, second round: a cover page with later page breaks, Word's kept paragraph
// settings on a style change, Outline's Promote on a hidden first paragraph, ABOVEBELOW in a
// header, citation styles and reference types from a damaged file, and more date forms.

import { describe, it, expect } from 'vitest';
import { newDocument, objectRun, paraFromStyle, runStyleOf, setParaStyle, clearFormatting, type DocObject, type DocText } from '../src/document/document';
import { COVER_END_MARK, COVER_FIRST_OFF_MARK, COVER_MARK, COVER_PAGES, coverParas, insertCover, removeCover } from '../src/document/quick-parts';
import { changeLevel, newOutline, outlineLevel } from '../src/document/doc-views';
import { DocLayouter } from '../src/document/doc-layout';
import { knownStyle } from '../src/document/cite-styles';
import { cleanRef } from '../src/document/references';
import { dateValue } from '../src/document/sort';
import { documentMeasure } from '../src/text/font-measure';
import { fitParas, paraCount } from '../src/text/paragraphs';
import * as rt from '../src/richtext';
import type { ParaStyle } from '../src/model';

const parasOf = (t: DocText) => fitParas(t.paras, paraCount(rt.plainText(t.runs)));
const field = (start: number) => { let id = start; return (code: string, format?: string) => ({ id: id++, o: { kind: 'field', code, ...(format ? { format } : {}) } as DocObject }); };

function plainDoc(texts: string[], paras?: ParaStyle[]): DocText {
  const d = newDocument();
  return { ...d, runs: [{ ...runStyleOf(d.styles.Normal), text: texts.join('\n') }], paras: paras ?? texts.map(() => paraFromStyle(d.styles.Normal, {})) };
}

/** The document with the cover's page break joined away (Backspace at the start of the text after it). */
function joined(c: DocText): DocText {
  const end = coverParas(c)!.end;
  return { ...c, paras: parasOf(c).map((p, i) => (i === end ? { ...p, pageBreak: undefined } : p)) };
}

describe('Remove Cover Page with a page break later in the text (F092)', () => {
  const body = () => plainDoc(['Body one', 'Body two', 'Compound 2', 'More'], [{}, {}, { pageBreak: true }, {}]);
  const design = COVER_PAGES.find((d) => d.id === 'plain')!;

  it('ends the cover at its own last line, not at a break further on', () => {
    const c = insertCover(body(), design, '#1f4e79', {}, field(100));
    expect(coverParas(c)!.end).toBe(design.paras('#000000').length);
    expect(rt.plainText(removeCover(c).runs)).toBe('Body one\nBody two\nCompound 2\nMore');
  });

  it('takes nothing once the break after the cover is joined away, though the text has another break', () => {
    const j = joined(insertCover(body(), design, '#1f4e79', {}, field(100)));
    expect(coverParas(j)).toBeNull();
    expect(rt.plainText(removeCover(j).runs)).toContain('Body two');
  });

  it('a new cover over one stuck that way keeps the first page\'s own setting, and one cover\'s marks', () => {
    const t = body();
    expect(t.hf.onFirst).toBe(true);
    const j = joined(insertCover(t, design, '#1f4e79', {}, field(100)));
    const again = insertCover(j, design, '#1f4e79', {}, field(200));
    const marked = parasOf(again).filter((p) => p.marks?.includes(COVER_MARK));
    expect(marked).toHaveLength(1);
    expect(marked[0].marks).not.toContain(COVER_FIRST_OFF_MARK);
    expect(parasOf(again).filter((p) => p.marks?.includes(COVER_END_MARK))).toHaveLength(1);
    expect(removeCover(again).hf.onFirst).toBe(true);
  });
});

describe('Word\'s kept paragraph settings on a style change (F086 follow-up)', () => {
  // ParaStyle.wpx: the paragraph's own w:pPr settings this program doesn't model, and (num, nk…)
  // which of the file's lists it is in (io/docx-read.ts)
  const wpx = JSON.stringify({ e: '<w:outlineLvl w:val="2"/>', ctx: '1', num: '4', nk: 'k', nl: 'null', ni: '36', nv: '0', nr: '0', nd: '' });

  it('drops the paragraph\'s own formatting and keeps which list it is in', () => {
    const t = plainDoc(['Item'], [{ list: 'number', wpx }]);
    const out = parasOf(setParaStyle(t, 0, 0, 'Heading1'))[0];
    const kept = JSON.parse(out.wpx!) as Record<string, string>;
    expect(kept.e).toBeUndefined();
    expect(kept.ctx).toBeUndefined();
    expect(kept).toMatchObject({ num: '4', nk: 'k', ni: '36' });
  });

  it('drops it all with Clear All Formatting (the list goes too)', () => {
    const t = plainDoc(['Item'], [{ list: 'number', wpx }]);
    expect(parasOf(clearFormatting(t, 0, 4, 0, 0))[0].wpx).toBeUndefined();
  });
});

describe('Outline: a hidden first paragraph (F085 follow-up)', () => {
  it('promoting from a hidden body paragraph leaves it body text', () => {
    const d = newDocument();
    const t: DocText = { ...d, runs: [{ text: 'Methods\nBody one\nSynthesis' }], paras: [paraFromStyle(d.styles.Heading1, {}), {}, paraFromStyle(d.styles.Heading2, {})] };
    const out = changeLevel(t, { ...newOutline(), level: 2 }, 1, 2, 'promote');
    expect(parasOf(out).map((p) => outlineLevel(out, p))).toEqual([1, 0, 1]);
  });
});

describe('ABOVEBELOW in a header (F503 follow-up)', () => {
  it('says above for a bookmark on an earlier page and below for one further on', () => {
    const d = newDocument();
    const t: DocText = {
      ...d, runs: [{ text: 'One\nTwo\nThree' }], paras: [{}, { pageBreak: true, marks: ['Mid'] }, { pageBreak: true }],
      objects: { 9: { kind: 'field', code: 'abovebelow', target: 'Mid' } as DocObject },
      hf: { ...d.hf, numbers: 'none', bodies: { header: { runs: [{ text: 'See ' }, objectRun(9, {})], paras: [{}] } } },
    };
    const lay = new DocLayouter({ measure: documentMeasure((s: string, size: number) => s.length * size * 0.5), drawingSize: () => ({ w: 1, h: 1 }) }).layout(t);
    const shown = (page: number) => lay.hfs.find((h) => h.page === page)!.texts.flatMap((x) => x.lines.flatMap((l) => l.pieces.map((g) => g.shown ?? g.text))).join('');
    expect(shown(0)).toContain('below');
    expect(shown(2)).toContain('above');
  });
});

describe('names from a damaged file (F492 follow-up)', () => {
  it('takes no inherited name as a citation style or a reference type', () => {
    expect(knownStyle('constructor')).toBe(false);
    expect(knownStyle('toString')).toBe(false);
    expect(knownStyle('acs')).toBe(true);
    expect(cleanRef({ type: 'constructor', title: 'X' }).type).toBe('article');
    expect(cleanRef({ type: 'book', title: 'X' }).type).toBe('book');
  });
});

describe('more date forms (F510 follow-up)', () => {
  it('reads a month and year, and a year-first date with slashes', () => {
    expect(dateValue('October 2026')).toBe(Date.UTC(2026, 9, 1));
    expect(dateValue('Oct 2026')).toBe(Date.UTC(2026, 9, 1));
    expect(dateValue('2026/10/22')).toBe(Date.UTC(2026, 9, 22));
    expect(dateValue('see note 2')).toBeNull();
  });
});
