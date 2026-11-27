// Code review batch 10 (document engine): applying a style or Clear All Formatting keeps what a
// paragraph or run is (not how it looks), Outline's Promote leaves hidden body text alone, and
// Select Text with Similar Formatting joins only stretches that touch.

import { describe, it, expect } from 'vitest';
import { clearFormatting, deleteStyle, newDocument, paraFromStyle, runStyleOf, setParaStyle, type DocText } from '../src/document/document';
import { changeLevel, hiddenParas, newOutline, outlineLevel } from '../src/document/doc-views';
import { similarRanges } from '../src/document/goto';
import { fitParas, paraCount } from '../src/text/paragraphs';
import * as rt from '../src/richtext';
import type { ParaStyle, TextRun } from '../src/model';

function docOf(paras: [string, string, Partial<ParaStyle>?][]): DocText {
  const d = newDocument();
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  paras.forEach(([style, text, extra], i) => {
    const s = d.styles[style];
    runs.push({ ...runStyleOf(s), text: text + (i < paras.length - 1 ? '\n' : '') });
    ps.push({ ...paraFromStyle(s, {}), ...extra });
  });
  return { ...d, runs, paras: ps };
}

const parasOf = (t: DocText) => fitParas(t.paras, paraCount(rt.plainText(t.runs)));

const OWN: Partial<ParaStyle> = {
  xe: [{ main: 'Aldol reaction' } as never],
  ta: [{ long: 'Smith v. Jones', short: 'Smith', cat: 1 } as never],
  cc: 'control-1',
  soft: true,
  startAt: 4,
  numType: 'lowerRoman',
  noHyphen: true,
};

describe('a style applied keeps what the paragraph holds (F086)', () => {
  it('keeps index entries, authority marks, its content control, a Shift+Enter line and Set Numbering Value', () => {
    const t = docOf([['Normal', 'First'], ['Normal', 'Second', { list: 'number', ...OWN }]]);
    const out = setParaStyle(t, 1, 1, 'Heading1');
    const p = parasOf(out)[1];
    expect(p.style).toBe('Heading1');
    expect(p).toMatchObject({ list: 'number', ...OWN });
  });

  it('keeps them when a style is deleted (its paragraphs go back to Normal)', () => {
    let t = docOf([['Normal', 'One'], ['Normal', 'Two'], ['Normal', 'Three']]);
    t = { ...t, styles: { ...t.styles, Exp: { ...t.styles.Normal, id: 'Exp', name: 'Experimental', custom: true, size: 9 } } };
    t = setParaStyle(t, 0, 2, 'Exp');
    t = { ...t, paras: parasOf(t).map((p, i) => (i === 1 ? { ...p, list: 'number' as const, ...OWN } : p)) };
    const out = deleteStyle(t, 'Exp');
    expect(out.styles.Exp).toBeUndefined();
    expect(parasOf(out).every((p) => p.style === undefined)).toBe(true);
    expect(parasOf(out)[1]).toMatchObject(OWN);
    // the text took Normal's size back, everywhere it had the deleted style's
    expect(out.runs.every((r) => r.size === t.styles.Normal.size)).toBe(true);
  });

  it('Clear All Formatting keeps index entries and the content control', () => {
    const t = docOf([['Heading1', 'Title', { xe: OWN.xe, cc: 'control-1' }]]);
    const p = parasOf(clearFormatting(t, 0, 5, 0, 0))[0];
    expect(p.style).toBeUndefined();
    expect(p).toMatchObject({ xe: OWN.xe, cc: 'control-1' });
  });
});

describe('Clear All Formatting keeps what the text is (F087)', () => {
  it('keeps a run\'s content control, language and tracked format change', () => {
    const t: DocText = { ...newDocument(), runs: [{ text: 'Benzene', bold: true, cc: 'c4w-1', lang: 'de-DE', fmt: 'A. Reviewer|2026-11-27T10:00:00Z|{}' }], paras: [{}] };
    const r = clearFormatting(t, 0, 7, 0, 0).runs[0];
    expect(r.bold).toBeUndefined();
    expect(r).toMatchObject({ cc: 'c4w-1', lang: 'de-DE', fmt: 'A. Reviewer|2026-11-27T10:00:00Z|{}' });
  });
});

describe('Outline: Promote leaves hidden body text alone (F085)', () => {
  // Heading 1, its body text, Heading 2, its body text
  const t = docOf([['Heading1', 'Methods'], ['Normal', 'Body one'], ['Heading2', 'Synthesis'], ['Normal', 'Body two']]);

  it('with Show Level 2, promoting the two headings shown changes no body text between them', () => {
    const o = { ...newOutline(), level: 2 };
    expect([...hiddenParas(t, o)]).toEqual([1, 3]);
    const out = changeLevel(t, o, 0, 2, 'promote');
    const ps = parasOf(out);
    expect(ps.map((p) => outlineLevel(out, p))).toEqual([1, 0, 1, 0]);
  });

  it('Promote to Heading 1 over a folded heading leaves the text folded under it as body text', () => {
    const o = { ...newOutline(), collapsed: [0] };
    const out = changeLevel(t, o, 0, 2, 'heading1');
    // (the folded Heading 2 stays as it is too: only what is shown is made Heading 1)
    expect(parasOf(out).map((p) => outlineLevel(out, p))).toEqual([1, 0, 2, 0]);
  });

  it('still promotes body text that is shown', () => {
    const out = changeLevel(t, newOutline(), 1, 1, 'promote');
    expect(parasOf(out).map((p) => outlineLevel(out, p))).toEqual([1, 1, 2, 0]);
  });
});

describe('Select Text with Similar Formatting (F089)', () => {
  it('does not join two bold words across one plain character', () => {
    const runs: TextRun[] = [{ text: 'Bold', bold: true }, { text: '-' }, { text: 'Bold', bold: true }];
    expect(similarRanges(runs, 1, () => ({}))).toEqual([[0, 4], [5, 9]]);
  });

  it('does not join two lines across a paragraph break', () => {
    const runs: TextRun[] = [{ text: 'One\nTwo', italic: true }];
    expect(similarRanges(runs, 1, () => ({}))).toEqual([[0, 3], [4, 7]]);
  });
});
