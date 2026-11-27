// Code review batch 10 (document engine): cover pages, Quick Parts, tracked changes in notes,
// Sort, Word Count, table commands, BibTeX and RIS import, citation styles and Compare.

import { describe, it, expect } from 'vitest';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocObject, type DocText } from '../src/document/document';
import { COVER_PAGES, coverParas, insertCover, partFromSelection, parseQuickParts, removeCover } from '../src/document/quick-parts';
import { countChanges, decideEverywhere, revText } from '../src/document/revisions';
import { allowedEdit } from '../src/document/protect';
import { compareBy, dateValue, sortParagraphs } from '../src/document/sort';
import { countDocument } from '../src/document/word-count';
import { mergeBlock, splitTable, tableToText } from '../src/document/table-convert';
import { delatex, parseRis } from '../src/document/references';
import { citeFormat, cleanOptions, setPreferredStyle, preferredStyle, CITE_PRESETS } from '../src/document/cite-styles';
import { compareDocuments } from '../src/document/compare';
import { fitParas, paraCount } from '../src/text/paragraphs';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';
import type { SectionBreak } from '../src/document/document';

const field = (start: number) => { let id = start; return (code: string, format?: string) => ({ id: id++, o: { kind: 'field', code, ...(format ? { format } : {}) } as DocObject }); };
const lines = (t: DocText) => rt.plainText(t.runs).split('\n');
const parasOf = (t: DocText) => fitParas(t.paras, paraCount(rt.plainText(t.runs)));
const who = { author: 'A. Reviewer', date: '2026-11-27T10:00:00Z' };
const INS = revText({ kind: 'ins', ...who }), DEL = revText({ kind: 'del', ...who });

function plainDoc(texts: string[], extra: Partial<DocText> = {}): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal);
  return { ...d, runs: [{ ...n, text: texts.join('\n') }], paras: texts.map(() => paraFromStyle(d.styles.Normal, {})), ...extra };
}

describe('cover pages (F092, F506)', () => {
  it('Remove Cover Page never takes the whole document when the break after the cover is gone', () => {
    const t = plainDoc(['Body text', 'More body text']);
    const c = insertCover(t, COVER_PAGES.find((d) => d.id === 'plain')!, '#1f4e79', runStyleOf(t.styles.Normal), field(100));
    const end = coverParas(c)!.end;
    // Backspace at the start of the body joined it to the cover's last line, and its page break went
    const joined = { ...c, paras: parasOf(c).map((p, i) => (i === end ? { ...p, pageBreak: undefined } : p)) };
    const out = removeCover(joined);
    expect(rt.plainText(out.runs)).toContain('More body text');
    expect(coverParas(joined)).toBeNull();
  });

  it('puts back a first page with no header or number, as it was before the cover', () => {
    const t = plainDoc(['Body text']);
    t.hf = { ...t.hf, onFirst: false };
    const c = insertCover(t, COVER_PAGES.find((d) => d.id === 'plain')!, '#1f4e79', runStyleOf(t.styles.Normal), field(100));
    expect(c.hf.onFirst).toBe(false);
    expect(removeCover(c).hf.onFirst).toBe(false);
    // and one that had them, with them
    const shown = insertCover(plainDoc(['Body text']), COVER_PAGES.find((d) => d.id === 'plain')!, '#1f4e79', {}, field(100));
    expect(removeCover(shown).hf.onFirst).toBe(true);
  });
});

describe('Quick Parts (F505)', () => {
  it('saves the text as it reads: no deleted words, no tracked marks', () => {
    const t: DocText = { ...newDocument(), runs: [{ text: 'Dry over ' }, { text: 'MgSO4', rev: DEL }, { text: 'Na2SO4', rev: INS }, { text: ' and filter.', fmt: `${who.author}|${who.date}|{}` }], paras: [{}] };
    const part = partFromSelection(t, 0, rt.plainText(t.runs).length, 'Drying')!;
    expect(rt.plainText(part.runs)).toBe('Dry over Na2SO4 and filter.');
    expect(part.runs.some((r) => r.rev || r.fmt)).toBe(false);
    const read = parseQuickParts([{ name: 'Old', runs: [{ text: 'kept ' }, { text: 'gone', rev: DEL }, { text: 'x', fmt: 'a|b|{}' }] }])[0];
    expect(rt.plainText(read.runs)).toBe('kept x');
    expect(read.runs.some((r) => r.fmt)).toBe(false);
  });
});

describe('tracked changes in footnotes and endnotes (F094)', () => {
  const noteDoc = (): DocText => ({
    ...newDocument(), track: true,
    runs: [{ text: 'Text' }, objectRun(1, {}), { text: '.' }], paras: [{}],
    objects: { 1: { kind: 'note', runs: [{ text: 'See ' }, { text: 'ref', rev: DEL }, { text: 'Ref. 2', rev: INS }], paras: [{}] } as DocObject },
  });

  it('counts them and Accept All decides them', () => {
    const t = noteDoc();
    expect(countChanges(t)).toBe(2);
    const done = decideEverywhere(t, true);
    const note = done.objects[1] as Extract<DocObject, { kind: 'note' }>;
    expect(rt.plainText(note.runs)).toBe('See Ref. 2');
    expect(note.runs.some((r) => r.rev)).toBe(false);
  });

  it('lets a tracked edit in a footnote through when protected for tracked changes', () => {
    const t = { ...noteDoc(), protect: { edit: 'trackedChanges' as const } };
    const note = t.objects[1] as Extract<DocObject, { kind: 'note' }>;
    const typed = { ...t, objects: { 1: { ...note, runs: [...note.runs, { text: ' more', rev: INS }] } } };
    expect(allowedEdit(t, typed)).toBe(true);
  });
});

describe('Sort (F096, F510, F512)', () => {
  it('leaves the text outside the sorted paragraphs, and its tracked marks, as they were', () => {
    // a tracked deletion ending the first paragraph, and a tracked inserted paragraph break after the second
    const runs: TextRun[] = [{ text: 'Keep ' }, { text: 'this', rev: DEL }, { text: '\nSplit' }, { text: '\n', rev: INS }, { text: 'here\ncherry\napple\nbanana' }];
    const t: DocText = { ...newDocument(), runs, paras: [{}, {}, {}, {}, {}, {}] };
    const out = sortParagraphs(t, 3, 5, { keys: [{ type: 'text' }] });
    expect(lines(out)).toEqual(['Keep this', 'Split', 'here', 'apple', 'banana', 'cherry']);
    // the break after the deleted word stays untracked; the inserted break stays inserted
    const at = (s: string) => { let o = 0; for (const r of out.runs) { const i = r.text.indexOf(s); if (i >= 0) return { r, o: o + i }; o += r.text.length; } return null; };
    const text = rt.plainText(out.runs);
    const runAt = (i: number) => { let o = 0; for (const r of out.runs) { if (i < o + r.text.length) return r; o += r.text.length; } return null; };
    expect(runAt(text.indexOf('\n'))?.rev).toBeUndefined();
    expect(runAt(text.indexOf('\n', text.indexOf('Split')))?.rev).toBe(INS);
    expect(at('this')?.r.rev).toBe(DEL);
  });

  it('reads only real dates (anything else sorts last), the same day the same wherever the computer is', () => {
    expect(dateValue('see note 2')).toBeNull();
    expect(dateValue('Entry 5')).toBeNull();
    expect(dateValue('TBD')).toBeNull();
    expect(dateValue('22 Oct 2026')).toBe(Date.UTC(2026, 9, 22));
    expect(dateValue('October 22, 2026')).toBe(Date.UTC(2026, 9, 22));
    expect(dateValue('2026-10-22')).toBe(dateValue('22 Oct 2026'));
  });

  it('case sensitive: capitals before small letters, as its label says', () => {
    expect(compareBy('Apple', 'apple', { type: 'text' }, true)).toBeLessThan(0);
    expect(compareBy('apple', 'Apple', { type: 'text' }, true)).toBeGreaterThan(0);
    expect(compareBy('apple', 'Apple', { type: 'text' }, false)).toBe(0);
    expect(compareBy('apple', 'banana', { type: 'text' }, true)).toBeLessThan(0);
  });
});

describe('Word Count (F097, F516)', () => {
  const tableDoc = (): DocText => {
    const tb: TableData = { cols: [80, 80], rows: [[{ runs: [{ text: 'A' }] }, { runs: [{ text: 'B' }] }], [{ runs: [{ text: 'C' }] }, { runs: [{ text: 'D' }] }]], head: 0 };
    return { ...newDocument(), runs: [{ text: 'Intro\n' }, objectRun(1, {}), { text: '\nEnd' }], paras: [{}, {}, {}], objects: { 1: { kind: 'table', table: tb } } };
  };

  it('counts each table cell as its own words and paragraphs', () => {
    const c = countDocument(tableDoc(), false);
    expect(c.words).toBe(6);
    expect(c.paras).toBe(6);
    expect(c.charsWithSpaces).toBe('IntroABCDEnd'.length);
  });

  it('leaves out a footnote whose number was deleted', () => {
    const t: DocText = { ...newDocument(), runs: [{ text: 'Two words' }], paras: [{}], objects: { 5: { kind: 'note', runs: [{ text: 'one two three four' }], paras: [{}] } as DocObject } };
    expect(countDocument(t, true).words).toBe(2);
    const kept = { ...t, runs: [{ text: 'Two words' }, objectRun(5, {})] };
    expect(countDocument(kept, true).words).toBe(6);
  });
});

describe('table commands (F513, F514, F515)', () => {
  const section: SectionBreak = { page: { ...newDocument().page, w: 792, h: 612 } } as SectionBreak;
  const withTable = (own: Partial<ParaStyle>): DocText => {
    const tb: TableData = { cols: [80], rows: [[{ runs: [{ text: 'h' }] }], [{ runs: [{ text: '1' }] }], [{ runs: [{ text: '2' }] }]], head: 0 };
    return { ...newDocument(), runs: [{ text: 'Before\n' }, objectRun(1, {}), { text: '\nAfter' }], paras: [{}, own, {}], objects: { 1: { kind: 'table', table: tb } } };
  };

  it('Convert to Text keeps the section break, page break and bookmarks of the table\'s paragraph', () => {
    const got = tableToText(withTable({ section, pageBreak: true, marks: ['Data'] }), 1, 'tab')!;
    const p = parasOf(got.t)[1];
    expect(p).toMatchObject({ section, pageBreak: true, marks: ['Data'] });
    expect(parasOf(got.t).filter((x) => x.section || x.pageBreak || x.marks)).toHaveLength(1);
  });

  it('Split Table gives the new table no page break, section break or bookmarks of its own', () => {
    const got = splitTable(withTable({ section, pageBreak: true, marks: ['Data'], align: 'center' }), 1, 2)!;
    const ps = parasOf(got.t);
    expect(ps[1]).toMatchObject({ section, pageBreak: true, marks: ['Data'] });
    const under = ps[3];
    expect(under.section).toBeUndefined();
    expect(under.pageBreak).toBeUndefined();
    expect(under.marks).toBeUndefined();
    expect(under.align).toBe('center');
  });

  it('Merge Cells with an empty top left cell starts with the text, not an empty paragraph', () => {
    const tb: TableData = { cols: [80, 80], rows: [[{ runs: [] }, { runs: [{ text: 'Yield' }] }]], head: 0 };
    const merged = mergeBlock(tb, { r0: 0, c0: 0, r1: 0, c1: 1 });
    expect(rt.plainText(merged.rows[0][0].runs)).toBe('Yield');
  });
});

describe('BibTeX and RIS (F507, F508, F509)', () => {
  // LaTeX: \u, \v, \c, \H, \k and \r are accents only before a brace or a space (Lamport,
  // LaTeX: A Document Preparation System, 2nd ed., 1994, section 3.2.1)
  it('reads \\url, \\ce and \\underline as commands, not accents', () => {
    expect(delatex('\\url{https://example.org}')).toBe('https://example.org');
    expect(delatex('Reduction of \\ce{CO2}')).toBe('Reduction of CO2');
    expect(delatex('\\underline{Total} synthesis')).toBe('Total synthesis');
    // the accents themselves still read
    expect(delatex('Ho\\v{r}ej\\v s')).toBe('Hořejš');
    expect(delatex('Fran\\c{c}ois')).toBe('François');
    expect(delatex('Erd\\H{o}s')).toBe('Erdős');
    expect(delatex('Schr\\"odinger')).toBe('Schrödinger');
  });

  it('gives an end page alone without a dash, and keeps a record that has no ER line', () => {
    const ris = ['TY  - JOUR', 'TI  - First', 'EP  - 123', 'TY  - JOUR', 'TI  - Second', 'SP  - 10', 'EP  - 12', 'ER  - '].join('\n');
    const refs = parseRis(ris);
    expect(refs.map((r) => r.title)).toEqual(['First', 'Second']);
    expect(refs[0].pages).toBe('123');
    expect(refs[1].pages).toBe('10–12');
  });
});

describe('citation styles from a damaged file (F492)', () => {
  it('takes no inherited names as a style or an option', () => {
    const was = preferredStyle();
    try {
      expect(() => setPreferredStyle('constructor')).not.toThrow();
      expect(preferredStyle().style).toBe('acs');
      expect(citeFormat('toString')).toEqual(citeFormat(undefined));
      expect(cleanOptions({ constructor: 'x', valueOf: 1, ranges: true })).toEqual({ ranges: true });
      expect(Object.hasOwn(CITE_PRESETS, 'acs')).toBe(true);
    } finally {
      setPreferredStyle(was.style, was.options);
    }
  });
});

describe('Compare keeps a character outside the first plane whole (F493)', () => {
  it('marks U+1D6FC replaced by U+1D6FD as one deletion and one insertion of whole characters', () => {
    // U+1D6FC MATHEMATICAL ITALIC SMALL ALPHA and U+1D6FD ... BETA (Unicode 15, Mathematical Alphanumeric Symbols)
    const alpha = String.fromCodePoint(0x1d6fc), beta = String.fromCodePoint(0x1d6fd);
    for (const level of ['word', 'char'] as const) {
      const out = compareDocuments(plainDoc([`x ${alpha} y`]), plainDoc([`x ${beta} y`]), { author: who.author, date: who.date, level });
      for (const r of out.doc.runs) {
        // no run starts with a low surrogate or ends with a high one
        expect(/^[\uDC00-\uDFFF]/.test(r.text)).toBe(false);
        expect(/[\uD800-\uDBFF]$/.test(r.text)).toBe(false);
      }
    }
  });
});
