// @vitest-environment jsdom
//
// Faults in the Live Preview found by the review pilot of 2026-11-26, each with the behavior it
// should have: joining two paragraphs of a field, two edits far apart in one field, "#" typed at
// a paragraph's start, custom text at a page's top or after a field printed in two pieces, a
// one-line box holding a value of several lines, and the looks of many formatting pieces at once.

import { describe, expect, it } from 'vitest';
import { applyPrintedChange, applyToRaw, editKind, printedHunks, shiftSpans } from '../src/si/preview-edit';
import { parseMarkup } from '../src/si/markup';
import { placeCustomText } from '../src/si/custom-text';
import type { DocText } from '../src/document/document';
import type { SourceBlock, SourceSpan } from '../src/si/source-map';
import * as rt from '../src/richtext';
import { SiRichBox } from '../src/ui/si-rich';
import type { TextRun } from '../src/model';

const SRC = 's:sec|content|@text';
const OTHER = 'c:c1|yield';

describe('joining two paragraphs of a field', () => {
  // "One.\nTwo." printed as two stretches of one field: [0, 4) and [5, 9)
  const spans: SourceSpan[] = [{ start: 0, end: 4, src: SRC }, { start: 5, end: 9, src: SRC }];

  it('Backspace at the second paragraph’s start leaves the first paragraph’s stretch whole', () => {
    // the paragraph mark [4, 5) taken out
    const out = shiftSpans(spans, 4, 5, -1, SRC);
    expect(out).toEqual([{ start: 0, end: 4, src: SRC }, { start: 4, end: 8, src: SRC }]);
  });

  it('typing at a field’s end still goes into it', () => {
    const out = shiftSpans([{ start: 0, end: 4, src: SRC }, { start: 6, end: 8, src: OTHER }], 4, 4, 2, SRC);
    expect(out).toEqual([{ start: 0, end: 6, src: SRC }, { start: 8, end: 10, src: OTHER }]);
  });

  it('typing straight after the join goes into the field', () => {
    // after the join: [0, 4) and [4, 8), then a space typed at 4
    expect(shiftSpans([{ start: 0, end: 4, src: SRC }, { start: 4, end: 8, src: SRC }], 4, 4, 1, SRC)).toEqual([{ start: 0, end: 5, src: SRC }, { start: 5, end: 9, src: SRC }]);
  });

  it('a selection over the paragraph mark shortens both stretches', () => {
    // "On|e.\nTw|o." selected from 2 to 7 and taken out
    expect(shiftSpans(spans, 2, 7, -5, SRC)).toEqual([{ start: 0, end: 2, src: SRC }, { start: 2, end: 4, src: SRC }]);
  });

  it('a selection over the paragraph mark between them is an edit of the field', () => {
    expect(editKind(spans, 2, 7, '', 'One.\nTwo.')).toEqual({ kind: 'field', src: SRC });
  });

  it('the stored text loses only the paragraph mark', () => {
    // what the write works out from the stretches after the join: "One." + "Two." (no mark between)
    expect(applyPrintedChange('One.\nTwo.', 'One.\nTwo.', 'One.Two.', true)).toBe('One.Two.');
  });
});

describe('two edits far apart in one field, saved together', () => {
  it('are two changes: the subscripts between them stay', () => {
    expect(printedHunks('CH2Cl2 was added', 'xCH2Cl2 was addedy')).toEqual([
      { pa: 0, pb: 0, typed: 'x' },
      { pa: 16, pb: 16, typed: 'y' },
    ]);
    expect(applyPrintedChange('CH_{2}Cl_{2} was added', 'CH2Cl2 was added', 'xCH2Cl2 was addedy', true)).toBe('xCH_{2}Cl_{2} was addedy');
  });

  it('two changes a few letters apart keep the formatting between them', () => {
    expect(applyPrintedChange('H_{2}O is wet', 'H2O is wet', 'D2S is wet', true)).toBe('D_{2}S is wet');
  });

  it('a change that lands inside a mention is refused, not saved into its id', () => {
    expect(applyToRaw('foo @{c1} end', 'foo 1a end', 4, 10, '1a endX', true)).toBeNull();
  });

  it('a formula typed over keeps the looks of the letters that stay', () => {
    // "CH2Cl2" retyped as "CHCl3": the 3 takes the place (and subscript) of the second 2
    expect(applyPrintedChange('CH_{2}Cl_{2} was added', 'CH2Cl2 was added', 'CHCl3 was added', true)).toBe('CHCl_{3} was added');
    expect(applyPrintedChange('CH_{2}Cl_{2}', 'CH2Cl2', 'CH3Cl3', true)).toBe('CH_{3}Cl_{3}');
    expect(applyPrintedChange('C_{6}H_{5}', 'C6H5', 'C8H7', true)).toBe('C_{8}H_{7}');
  });

  it('many changes in one save each keep their looks', () => {
    const raw = [1, 2, 3, 4, 5, 6, 7].map((n) => `a_{${n}}`).join(' bbbb ');
    const printed = [1, 2, 3, 4, 5, 6, 7].map((n) => `a${n}`).join(' bbbb ');
    expect(applyPrintedChange(raw, printed, printed.replace(/\d/g, '9'), true)).toBe(raw.replace(/\d/g, '9'));
  });

  it('one edit is as before', () => {
    expect(applyPrintedChange('stirred for **2 h**', 'stirred for 2 h', 'stirred for 3 h', true)).toBe('stirred for **3 h**');
  });

  it('a change to words the program writes is still refused', () => {
    // "(91%)" printed around a stored "91"
    expect(applyPrintedChange('91', '(91%)', '(91!)', false)).toBeNull();
  });
});

describe('"#" typed at the start of a paragraph', () => {
  it('stays text, not a heading', () => {
    const raw = applyToRaw('First.\nSecond.', 'First.\nSecond.', 7, 7, '# 3 was used. ', true)!;
    expect(raw).toBe('First.\n\\# 3 was used. Second.');
    const ps = parseMarkup(raw);
    expect(ps[1].heading).toBeFalsy();
    expect(ps[1].runs.map((r) => r.text).join('')).toBe('# 3 was used. Second.');
  });

  it('a "#" left at the start by taking out what was before it stays text', () => {
    expect(applyPrintedChange('a# b', 'a# b', '# b', true)).toBe('\\# b');
  });

  it('a paragraph mark typed before a "#" keeps the new paragraph text', () => {
    expect(applyPrintedChange('abc # def', 'abc # def', 'abc \n# def', true)).toBe('abc \n\\# def');
  });

  it('"!" typed before "image{" at a paragraph’s start stays text', () => {
    expect(applyToRaw('image{x} y', 'image{x} y', 0, 0, '!', true)).toBe('\\!image{x} y');
  });

  it('Enter at a heading’s start leaves it a heading', () => {
    expect(applyPrintedChange('intro\n# Heading\nbody', 'intro\nHeading\nbody', 'intro\n\nHeading\nbody', true)).toBe('intro\n\n# Heading\nbody');
  });

  it('typing before an escaped character goes before its backslash', () => {
    expect(applyToRaw('\\*x', '*x', 0, 0, 'z', true)).toBe('z\\*x');
    expect(applyToRaw('\\# x', '# x', 0, 0, '\n', true)).toBe('\n\\# x');
  });

  it('a heading that becomes first when the empty line above it goes stays a heading', () => {
    expect(applyPrintedChange('\n# def', '\ndef', 'def', true)).toBe('# def');
  });

  it('a heading after a paragraph taken out whole stays a heading', () => {
    expect(applyPrintedChange('ab\ncd\n# Real', 'ab\ncd\nReal', 'ab\nReal', true)).toBe('ab\n# Real');
  });

  it('a figure after a bold word taken out at a paragraph’s end stays a figure', () => {
    expect(applyToRaw('a**b**\n!image{x}', 'ab\n!image{x}', 1, 2, '', true)).toBe('a\n!image{x}');
  });

  it('inside a paragraph it needs no escape', () => {
    expect(applyToRaw('Compound 3 was used.', 'Compound 3 was used.', 9, 9, '#', true)).toBe('Compound #3 was used.');
  });
});

describe('custom text placed at compile', () => {
  const doc = (text: string): DocText => ({ runs: [{ text }], paras: text.split('\n').map(() => ({})) }) as unknown as DocText;

  it('at the top of a page is on that page, not the one before it too', () => {
    // page A [0, 5) "AAAA\n", page B [5, 10) "BBBB\n"
    const blocks: SourceBlock[] = [{ start: 0, end: 5, node: 'compound:a' }, { start: 5, end: 10, node: 'section:b' }];
    const got = placeCustomText(doc('AAAA\nBBBB\n'), [], blocks, [{ id: 'k1', node: 'section:b', after: '', gap: '', text: 'Note. ' }]);
    expect(got.blocks).toEqual([{ start: 0, end: 5, node: 'compound:a' }, { start: 5, end: 16, node: 'section:b' }]);
    expect(got.placed[0]).toMatchObject({ start: 5, end: 11, anchored: true });
  });

  it('at the top of a page that starts its section grows the section too', () => {
    const blocks: SourceBlock[] = [{ start: 0, end: 10, node: 'section:s' }, { start: 0, end: 5, node: 'compound:a' }, { start: 5, end: 10, node: 'compound:b' }];
    const got = placeCustomText(doc('AAAA\nBBBB\n'), [], blocks, [{ id: 'k1', node: 'compound:a', after: '', gap: '', text: 'N ' }]);
    expect(got.blocks).toEqual([{ start: 0, end: 12, node: 'section:s' }, { start: 0, end: 7, node: 'compound:a' }, { start: 7, end: 12, node: 'compound:b' }]);
  });

  it('after a field printed in two pieces goes after the piece it was typed after', () => {
    // "Name: X. Data: Y." with the field F printed as "X." [6, 8) and "Y." [15, 17)
    const text = 'Name: X. Data: Y.';
    const sources: SourceSpan[] = [{ start: 6, end: 8, src: 'c:c1|f' }, { start: 15, end: 17, src: 'c:c1|f' }];
    const blocks: SourceBlock[] = [{ start: 0, end: 17, node: 'compound:c1' }];
    const got = placeCustomText(doc(text), sources, blocks, [{ id: 'k1', node: 'compound:c1', after: 'c:c1|f', gap: ' D', text: 'Mine. ' }]);
    expect(rt.plainText(got.doc.runs)).toBe('Name: X. DMine. ata: Y.');
  });

  it('after a field of several paragraphs goes after the last one followed by the gap', () => {
    // a procedure "Para one.\nPara two.\n" printed as two pieces, then words the program writes
    const text = 'Para one.\nPara two.\n1H NMR data';
    const sources: SourceSpan[] = [{ start: 0, end: 9, src: 'c:c1|p' }, { start: 10, end: 19, src: 'c:c1|p' }];
    const blocks: SourceBlock[] = [{ start: 0, end: text.length, node: 'compound:c1' }];
    const got = placeCustomText(doc(text), sources, blocks, [{ id: 'k1', node: 'compound:c1', after: 'c:c1|p', gap: '\n', text: 'Note. ' }]);
    expect(rt.plainText(got.doc.runs)).toBe('Para one.\nPara two.\nNote. 1H NMR data');
  });

  it('with no page of its own goes at the end, in the last page', () => {
    const blocks: SourceBlock[] = [{ start: 0, end: 5, node: 'compound:a' }];
    const got = placeCustomText(doc('AAAA\n'), [], blocks, [{ id: 'k1', node: 'compound:gone', after: '', gap: '', text: 'End.' }]);
    expect(got.blocks).toEqual([{ start: 0, end: 9, node: 'compound:a' }]);
    expect(got.placed[0]).toMatchObject({ start: 5, end: 9, anchored: false });
  });
});

describe('a one-line box holding a value of several lines', () => {
  it('keeps the lines after the first when the first is changed', () => {
    let saved: string | null = null;
    const box = new SiRichBox('First line\nSecond line', { label: (r) => r, changed: (v) => { saved = v; } }, false);
    expect(box.text).toBe('First line\nSecond line');
    box.el.firstElementChild!.textContent = 'First line!';
    box.el.dispatchEvent(new Event('blur'));
    expect(saved).toBe('First line!\nSecond line');
  });

  it('keeps the lines after the first when the first is emptied', () => {
    let saved: string | null = null;
    const box = new SiRichBox('First line\nSecond line', { label: (r) => r, changed: (v) => { saved = v; } }, false);
    box.el.firstElementChild!.textContent = '';
    box.el.dispatchEvent(new Event('blur'));
    expect(saved).toBe('\nSecond line');
  });

  it('stays locked when its text can’t be read', async () => {
    const box = new SiRichBox('', { label: (r) => r, changed: () => {} }, true);
    box.load(Promise.reject(new Error('unreadable')));
    await Promise.resolve(); await Promise.resolve();
    expect(box.el.contentEditable).toBe('false');
  });

  it('can’t be typed into while its text is being read', async () => {
    let done: (t: string) => void = () => {};
    const box = new SiRichBox('', { label: (r) => r, changed: () => {} }, true);
    box.load(new Promise<string>((r) => { done = r; }));
    expect(box.el.contentEditable).toBe('false');
    done('Stored text');
    await Promise.resolve(); await Promise.resolve();
    expect(box.el.contentEditable).toBe('true');
    expect(box.text).toBe('Stored text');
  });
});

describe('many looks put on at once', () => {
  it('are the runs of putting them on one at a time', () => {
    const runs: TextRun[] = [{ text: 'abcdef' }, { text: 'ghij', bold: true } as TextRun, { text: 'klmnop' }];
    const edits = [
      { start: 1, end: 4, patch: { italic: true } },
      { start: 3, end: 9, patch: { underline: true } },
      { start: 0, end: 16, patch: { bold: undefined } },
      { start: 8, end: 12, patch: { sub: true } },
      { start: 5, end: 5, patch: { italic: true } },
    ];
    let one = runs;
    for (const e of edits) if (e.end > e.start) one = rt.applyStyle(one, e.start, e.end, e.patch);
    expect(rt.applyStyles(runs, edits)).toEqual(one);
  });
});
