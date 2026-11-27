// Insert > Cover Page, Blank Page and Quick Parts, as in Word. A cover page is a first page of its
// own: the document's title, subtitle, author, institution and date (fields, so they follow the
// document's properties), set in one of a few looks, with a page break after it and no page number
// on it. A Quick Part is a piece of text saved to use again in any document (an affiliation, a
// standard experimental paragraph, a lab's address), kept with the person's settings.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { cleanPara, fitParas, paraCount, splitParagraphs } from '../text/paragraphs';
import type { FieldCode } from './fields';
import type { DocObject, DocText } from './document';
import { decide, parseRev } from './revisions';

/** The bookmark on a cover page's first paragraph, so it can be found and taken out again. */
export const COVER_MARK = '_Cover';
/** Beside COVER_MARK: the document's first page had no header or page number before the cover went in (Remove Cover Page keeps it so). */
export const COVER_FIRST_OFF_MARK = '_CoverFirstOff';
/** On a cover page's last paragraph: the cover ends there (the paragraph after it starts the document's own first page). */
export const COVER_END_MARK = '_CoverEnd';
/** The marks a cover page's paragraphs carry. */
const COVER_MARKS = [COVER_MARK, COVER_FIRST_OFF_MARK, COVER_END_MARK];

/** A saved piece of text (Insert > Quick Parts > Save Selection to Quick Part Gallery). */
export interface QuickPart {
  name: string;
  runs: TextRun[];
  paras: ParaStyle[];
}

/** Quick Parts read from the settings, keeping only what makes sense. */
export function parseQuickParts(v: unknown): QuickPart[] {
  if (!Array.isArray(v)) return [];
  const out: QuickPart[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name.trim() || !Array.isArray(o.runs)) continue;
    // (text a tracked change deleted is not part of it)
    const runs = (o.runs as unknown[]).filter((r): r is TextRun => !!r && typeof r === 'object' && typeof (r as TextRun).text === 'string' && parseRev((r as TextRun).rev)?.kind !== 'del').map((r) => {
      // figures and fields don't travel between documents: just their text
      const { obj: _o, rev: _r, cmt: _c, fmt: _f, hide: _h, ...rest } = r as TextRun;
      return rest;
    });
    const paras = Array.isArray(o.paras) ? (o.paras as unknown[]).filter((p): p is ParaStyle => !!p && typeof p === 'object') : [];
    out.push({ name: o.name.trim().slice(0, 80), runs, paras });
  }
  return out.slice(0, 200);
}

/**
 * The selected text as a Quick Part: its words and look, and the look of each of its paragraphs
 * (figures and fields left out, as they belong to the document they are in).
 */
export function partFromSelection(t: DocText, start: number, end: number, name: string): QuickPart | null {
  if (end <= start) return null;
  const text = rt.plainText(t.runs);
  const sliced = rt.sliceRuns(t.runs, start, end).filter((r) => r.obj === undefined);
  const paras = fitParas(t.paras, paraCount(text));
  let first = 0;
  for (let i = 0; i < start; i++) if (text[i] === '\n') first++;
  // the text as it will read: tracked changes accepted (deleted text out, new looks kept)
  const read = decide({ runs: sliced, paras: paras.slice(first, first + paraCount(rt.plainText(sliced))) }, true);
  const runs = read.runs.map((r) => {
    const { rev: _r, fmt: _f, hide: _h, cmt: _c, link: _l, ...rest } = r;
    return rest;
  });
  if (!runs.some((r) => r.text.trim())) return null;
  const ps = fitParas(read.paras, paraCount(rt.plainText(runs))).map((p) => {
    const { pageBreak: _a, colBreak: _b, section: _s, marks: _m, ...rest } = p;
    return rest;
  });
  return { name: name.trim() || 'Quick Part', runs: rt.normalizeRuns(runs), paras: ps };
}

// ---------------------------------------------------------------- cover pages

/** One paragraph of a cover page: its pieces (text, or a field) and its settings. */
export interface CoverPara { pieces: (string | { field: FieldCode; format?: string })[]; look: rt.RunStyle; ps: ParaStyle }

export interface CoverDesign { id: string; name: string; help: string; paras: (accent: string) => CoverPara[] }

const centred: ParaStyle = { align: 'center' };

/** The cover pages offered: plain shapes made of paragraph spacing, rules and shading, so Word keeps them exactly. */
export const COVER_PAGES: CoverDesign[] = [
  {
    id: 'plain', name: 'Plain', help: 'The title in the middle of the page, the author and date under it',
    paras: () => [
      { pieces: [{ field: 'title' }], look: { size: 28, bold: true }, ps: { ...centred, spaceBefore: 220, spaceAfter: 12 } },
      { pieces: [{ field: 'subject' }], look: { size: 16 }, ps: { ...centred, spaceAfter: 120 } },
      { pieces: [{ field: 'author' }], look: { size: 13 }, ps: { ...centred, spaceAfter: 4 } },
      { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { ...centred, spaceAfter: 4 } },
      { pieces: [{ field: 'date', format: 'MMMM d, yyyy' }], look: { size: 12 }, ps: { ...centred } },
    ],
  },
  {
    id: 'banded', name: 'Banded', help: 'The title in white on a band of the accent color',
    paras: (accent) => [
      { pieces: [''], look: { size: 12 }, ps: { spaceBefore: 160, shade: accent } },
      { pieces: [{ field: 'title' }], look: { size: 30, bold: true, color: '#ffffff' }, ps: { indent: 18, shade: accent, spaceAfter: 0 } },
      { pieces: [{ field: 'subject' }], look: { size: 15, color: '#ffffff' }, ps: { indent: 18, shade: accent, spaceAfter: 0 } },
      { pieces: [''], look: { size: 12 }, ps: { shade: accent, spaceAfter: 200 } },
      { pieces: [{ field: 'author' }], look: { size: 13, bold: true }, ps: { indent: 18, spaceAfter: 2 } },
      { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { indent: 18, spaceAfter: 2 } },
      { pieces: [{ field: 'date', format: 'MMMM d, yyyy' }], look: { size: 12 }, ps: { indent: 18 } },
    ],
  },
  {
    id: 'ruled', name: 'Ruled', help: 'The title between two heavy rules, to the left',
    paras: (accent) => {
      const rule = { style: 'single' as const, w: 3, color: accent };
      return [
        { pieces: [{ field: 'title' }], look: { size: 28, bold: true }, ps: { spaceBefore: 180, border: { top: rule }, spaceAfter: 6 } },
        { pieces: [{ field: 'subject' }], look: { size: 15, italic: true }, ps: { border: { bottom: rule }, spaceAfter: 160 } },
        { pieces: [{ field: 'author' }], look: { size: 13 }, ps: { spaceAfter: 2 } },
        { pieces: [{ field: 'company' }], look: { size: 12 }, ps: { spaceAfter: 2 } },
        { pieces: [{ field: 'date', format: 'd MMMM yyyy' }], look: { size: 12 }, ps: {} },
      ];
    },
  },
  {
    id: 'report', name: 'Lab Report', help: 'A report\'s front page: what, who, where and when, down a line in the margin',
    paras: (accent) => {
      const bar = { style: 'single' as const, w: 4.5, color: accent };
      const row = (label: string, field: FieldCode, format?: string): CoverPara => ({ pieces: [`${label}\t`, format ? { field, format } : { field }], look: { size: 12 }, ps: { border: { left: bar }, indent: 10, spaceAfter: 6, tabs: [{ pos: 110, kind: 'left' }] } });
      return [
        { pieces: ['Report'], look: { size: 14, color: accent, bold: true }, ps: { spaceBefore: 120, border: { left: bar }, indent: 10, spaceAfter: 2 } },
        { pieces: [{ field: 'title' }], look: { size: 26, bold: true }, ps: { border: { left: bar }, indent: 10, spaceAfter: 30 } },
        row('Subject', 'subject'), row('Author', 'author'), row('Group', 'company'), row('Date', 'date', 'MMMM d, yyyy'),
      ];
    },
  },
  {
    id: 'si', name: 'Supporting Information', help: 'A journal\'s Supporting Information front page: the heading, the paper\'s title, its authors and institution',
    paras: () => [
      { pieces: ['Supporting Information'], look: { size: 18, bold: true }, ps: { ...centred, spaceBefore: 60, spaceAfter: 18 } },
      { pieces: [{ field: 'title' }], look: { size: 14, bold: true }, ps: { ...centred, spaceAfter: 12 } },
      { pieces: [{ field: 'author' }], look: { size: 12 }, ps: { ...centred, spaceAfter: 6 } },
      { pieces: [{ field: 'company' }], look: { size: 11, italic: true }, ps: { ...centred, spaceAfter: 24 } },
    ],
  },
];

/**
 * A cover page put in front of the document: its paragraphs (each piece a run, each field an object
 * made by `field`), then the document's first paragraph starting a new page. A cover page already
 * there is replaced. The first page shows no page number (as a title page doesn't).
 */
export function insertCover(t: DocText, design: CoverDesign, accent: string, base: rt.RunStyle, field: (code: FieldCode, format?: string) => { id: number; o: DocObject }): DocText {
  let doc = removeCover(t);
  // (whether the first page showed its header and number, for Remove Cover Page to put back; a
  // cover that can no longer be told from the text, its page break joined away, says what it was
  // before it, and its marks go: they would mark two covers)
  const was = fitParas(doc.paras, paraCount(rt.plainText(doc.runs)));
  const stuck = !!was[0]?.marks?.includes(COVER_MARK);
  const firstOn = stuck ? !was[0].marks!.includes(COVER_FIRST_OFF_MARK) : doc.hf.onFirst;
  if (stuck) doc = { ...doc, paras: was.map((p) => (p.marks?.some((m) => COVER_MARKS.includes(m)) ? cleanPara({ ...p, marks: p.marks.filter((m) => !COVER_MARKS.includes(m)) }) : p)) };
  const firstMarks = firstOn ? [COVER_MARK] : [COVER_MARK, COVER_FIRST_OFF_MARK];
  const objects = { ...doc.objects };
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  const lines = design.paras(accent);
  lines.forEach((cp, i) => {
    const look = rt.cleanStyle({ ...base, ...cp.look });
    if (i > 0) runs.push({ ...look, text: '\n' });
    for (const piece of cp.pieces) {
      if (typeof piece === 'string') { if (piece) runs.push({ ...look, text: piece }); continue; }
      const f = field(piece.field, piece.format);
      objects[f.id] = f.o;
      runs.push({ ...look, obj: f.id, text: '￼' });
    }
    const marks = [...(i === 0 ? firstMarks : []), ...(i === lines.length - 1 ? [COVER_END_MARK] : [])];
    paras.push({ ...cp.ps, ...(marks.length ? { marks } : {}) });
  });
  const n = paraCount(rt.plainText(doc.runs));
  const old = fitParas(doc.paras, n);
  const first = old[0] ?? {};
  // the document's own first paragraph starts on the page after the cover
  const rest = [{ ...first, pageBreak: true }, ...old.slice(1)];
  // (the break after the last line takes its look, not its field)
  const { obj: _o, ...lastLook } = runs.length ? rt.styleOf(runs[runs.length - 1]) : base;
  doc = {
    ...doc,
    objects,
    runs: rt.normalizeRuns([...runs, { ...lastLook, text: '\n' }, ...doc.runs]),
    paras: [...paras, ...rest],
    hf: { ...doc.hf, onFirst: false },
  };
  return doc;
}

/** The paragraphs a cover page takes up (from the first, up to the paragraph starting the page after it), or null when there is none. */
export function coverParas(t: DocText): { first: number; end: number } | null {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  if (!paras[0]?.marks?.includes(COVER_MARK)) return null;
  // the cover ends at its last line's mark, and only while the paragraph after it starts a new
  // page: when that break was joined away (Backspace at the start of the text after the cover),
  // there is no telling where the cover ends, so none is taken (taking up to a later break would
  // take the document's own text with it)
  const last = paras.findIndex((p) => p.marks?.includes(COVER_END_MARK));
  const starts = (i: number) => i > 0 && i < n && !!(paras[i].pageBreak || paras[i].section);
  if (last >= 0) return starts(last + 1) ? { first: 0, end: last + 1 } : null;
  // (a cover made before covers marked their end: its break within as many lines as a cover has)
  for (let i = 1; i < n && i <= MOST_COVER_LINES; i++) if (starts(i)) return { first: 0, end: i };
  return null;
}

/** The most paragraphs a cover page has. */
const MOST_COVER_LINES = Math.max(...COVER_PAGES.map((d) => d.paras('#000000').length));

/** The document without its cover page (its first page then shows its number again). */
export function removeCover(t: DocText): DocText {
  const c = coverParas(t);
  if (!c) return t;
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  const parts = splitParagraphs(t.runs);
  const runs: TextRun[] = [];
  const keep = parts.slice(c.end);
  keep.forEach((rs, i) => {
    if (i > 0) { const prev = keep[i - 1]; const { obj: _o, ...look } = prev.length ? rt.styleOf(prev[prev.length - 1]) : {}; runs.push({ ...look, text: '\n' }); }
    runs.push(...rs);
  });
  const rest = paras.slice(c.end);
  if (rest[0]) { const { pageBreak: _p, ...r0 } = rest[0]; rest[0] = r0; }
  const onFirst = !paras[0]?.marks?.includes(COVER_FIRST_OFF_MARK);
  return { ...t, runs: rt.normalizeRuns(runs), paras: rest.length ? rest : [{}], hf: { ...t.hf, onFirst } };
}
