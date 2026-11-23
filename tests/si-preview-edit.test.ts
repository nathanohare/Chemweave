// Typing in the SI Live Preview: which edits go to a field, which are the person's own text, which
// are refused, and the stored value a field edit makes. The strings here are written by hand (a
// stored value and how it prints), not made by the code under test.
import { describe, expect, it } from 'vitest';
import { applyToRaw, customSrc, editKind, lineUp, markupSrc, printedOf } from '../src/si/preview-edit';
import type { SourceSpan } from '../src/si/source-map';

describe('lining up a stored value with its printed text', () => {
  it('lines up equal text one for one', () => {
    expect(lineUp('abc', 'abc')).toEqual([0, 1, 2]);
  });
  it('pairs a changed character (a hyphen printed as an en dash)', () => {
    expect(lineUp('7.39-7.30', '7.39–7.30')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('leaves a character the program added unpaired', () => {
    // "400MHz" printed "400 MHz": the space is the program's
    expect(lineUp('400MHz', '400 MHz')).toEqual([0, 1, 2, -1, 3, 4, 5]);
  });
  it('skips markup in the stored value', () => {
    // "*J* = 6" prints "J = 6"
    expect(lineUp('*J* = 6', 'J = 6')).toEqual([1, 3, 4, 5, 6]);
  });
  it('lines up a long text with a few changes', () => {
    const raw = 'Prepared from 1a (60 mg). The crude product was purified by chromatography (SiO2).';
    const printed = 'Prepared from 1a (60 mg). The crude product was purified by chromatography (SiO2).';
    expect(lineUp(raw, printed).every((v, i) => v === i)).toBe(true);
  });
});

describe('a change to the printed text, made in the stored value', () => {
  it('changes a number', () => {
    expect(applyToRaw('91', '91', 0, 2, '89', false)).toBe('89');
  });
  it('changes text after a character printed differently', () => {
    // "(m, 2H)" → "(m, 3H)" where the range's hyphen prints as an en dash
    expect(applyToRaw('7.39-7.30 (m, 2H)', '7.39–7.30 (m, 2H)', 14, 15, '3', true)).toBe('7.39-7.30 (m, 3H)');
  });
  it('types inside italic markup after the italic letter', () => {
    expect(applyToRaw('*J* = 6', 'J = 6', 1, 1, 'x', true)).toBe('*Jx* = 6');
  });
  it('refuses to take out a character the program added', () => {
    expect(applyToRaw('400MHz', '400 MHz', 3, 4, '', false)).toBeNull();
  });
  it('escapes markers typed into a markup value', () => {
    expect(applyToRaw('a b', 'a b', 1, 1, '*', true)).toBe('a\\* b');
  });
  it('does not escape a plain value', () => {
    expect(applyToRaw('a b', 'a b', 1, 1, '*', false)).toBe('a* b');
  });
  it('types at the very start', () => {
    expect(applyToRaw('oil', 'oil', 0, 0, 'pale ', false)).toBe('pale oil');
  });
  it('changes a capitalized first letter in the stored lower-case one', () => {
    // "colorless oil" prints "Colorless oil": deleting the C deletes the c
    expect(applyToRaw('colorless oil', 'Colorless oil', 0, 1, 'D', false)).toBe('Dolorless oil');
  });
});

describe('what an edit of the preview is', () => {
  // "Colorless oil (69.2 mg, 91%). Rf = 0.10." as spans
  const spans: SourceSpan[] = [
    { start: 0, end: 13, src: 'c:x|physical_state|text' },
    { start: 13, end: 15, src: 'c:x|yield' },
    { start: 15, end: 19, src: 'c:x|yield|mass' },
    { start: 19, end: 20, src: 'c:x|yield' },
    { start: 20, end: 22, src: 'c:x|yield|mass_unit' },
    { start: 22, end: 24, src: 'c:x|yield' },
    { start: 24, end: 26, src: 'c:x|yield|percent' },
    { start: 26, end: 29, src: 'c:x|yield' },
    // (a space between the sentences, the program's but no field's)
    { start: 30, end: 35, src: 'c:x|rf' },
    { start: 35, end: 39, src: 'c:x|rf|value' },
    { start: 39, end: 40, src: 'c:x|rf' },
  ];
  it('types into a field', () => {
    expect(editKind(spans, 25, 25, '5')).toEqual({ kind: 'field', src: 'c:x|yield|percent' });
  });
  it('types at a field\'s end into the field', () => {
    expect(editKind(spans, 26, 26, '.5')).toEqual({ kind: 'field', src: 'c:x|yield|percent' });
  });
  it('refuses typing into the program\'s words', () => {
    expect(editKind(spans, 31, 31, 'x')).toEqual({ kind: 'locked', src: 'c:x|rf' });
  });
  it('takes typing between sentences as the person\'s own text', () => {
    expect(editKind(spans, 29, 29, ' The ee was not determined.')).toEqual({ kind: 'custom', at: 29 });
  });
  it('refuses a selection running from a field into the program\'s words', () => {
    expect(editKind(spans, 24, 28, '')).toEqual({ kind: 'locked', src: 'c:x|yield' });
  });
  it('refuses a paragraph break in a one-line field', () => {
    expect(editKind(spans, 25, 25, '\n')).toEqual({ kind: 'locked', src: 'c:x|yield|percent' });
  });
  it('types into the person\'s own text', () => {
    const own = [...spans, { start: 29, end: 40, src: customSrc('k1') }].filter((s) => s.start !== 30 && s.start !== 35 && s.start !== 39);
    expect(editKind(own, 33, 33, 'x')).toEqual({ kind: 'field', src: customSrc('k1') });
  });
});

describe('a field\'s printed text', () => {
  it('joins a field\'s spans, a paragraph end between paragraphs', () => {
    const text = 'One.\nTwo.';
    const spans: SourceSpan[] = [{ start: 0, end: 4, src: 's' }, { start: 5, end: 9, src: 's' }];
    const p = printedOf(text, spans, 's');
    expect(p.printed).toBe('One.\nTwo.');
    expect(p.at(6)).toBe(6);
  });
  it('knows which sources are stored as markup', () => {
    expect(markupSrc('c:x|procedure|@text')).toBe(true);
    expect(markupSrc('c:x|yield|percent')).toBe(false);
    expect(markupSrc('c:x|nmr|#0.text')).toBe(true);
  });
});
