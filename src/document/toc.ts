// A table of contents (References > Table of Contents, as in Word): the headings of the document
// (paragraphs in the Heading 1, 2 or 3 style, down to the level chosen), each with its page
// number at the right after a line of dots. It sits in the text as one character, like the
// bibliography, and is worked out again whenever the text changes, so it never needs updating
// by hand. Its page numbers come from laying the document out: see DocLayouter.layout.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { withStack, layoutText, type Glyphs, type LaidLine, type Measure } from '../text/layout';
import { fitParas, listInfo, paraCount, splitParagraphs } from '../text/paragraphs';
import { COMPOUND, fieldTexts, styleOf, type DocText, type NamedStyle, type TocLook } from './document';

export interface TocEntry {
  /** 1 for Heading 1, and so on. */
  level: number;
  text: string;
  /** The heading's paragraph. */
  para: number;
  /** Its number, when the heading is numbered (A., 2.1): shown before its text, as Word's contents do. */
  num?: string;
}

/** What the contents show when there are no headings yet (on screen and in the PDF only). */
export const EMPTY_TOC = 'Table of contents: no headings yet. Give paragraphs the Heading 1, 2 or 3 style and they appear here.';

/** The headings down to `levels` (1 to 3) deep, in order, as plain text. */
export function tocEntries(t: DocText, levels = 3): TocEntry[] {
  const runs = splitParagraphs(t.runs);
  const paras = fitParas(t.paras, paraCount(rt.plainText(t.runs)));
  const out: TocEntry[] = [];
  let lists: ReturnType<typeof listInfo> | null = null;
  paras.forEach((ps, p) => {
    const level = styleOf(t, ps).outline;
    if (!level || level > levels) return;
    // figures and fields in a heading are left out; a line break is a space
    const text = (runs[p] ?? []).filter((r) => r.obj === undefined).map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
    if (!text) return;
    // a numbered heading's number comes too
    const num = ps.list === 'number' ? (lists ??= listInfo(paras))[p]?.marker : null;
    out.push({ level, text, para: p, ...(num ? { num } : {}) });
  });
  return out;
}

/** How far each level of the contents is indented (Word's 0.15 in a level). */
export const TOC_INDENT = 11;

/**
 * The contents' lines, laid out `wrap` wide from the origin: each heading's text (wrapping short
 * of the page numbers), then dots and its page number at the right of its last line.
 */
export function tocLines(entries: TocEntry[], pageOf: (para: number) => string, st: NamedStyle, line: number | undefined, wrap: number, measure: Measure, empty = EMPTY_TOC, spaced = true, levelStyle?: (level: number) => NamedStyle | undefined): LaidLine[] {
  const base = { font: st.font, size: st.size };
  if (!entries.length) {
    return layoutText({ runs: [{ ...base, italic: true, color: '#8a8f98', text: empty }], paras: [{ line }], justify: 'left', wrap, boxes: true }, st.size, measure).lines;
  }
  // each level in the document's own style for it (Word's "toc 1" to "toc 9"), when it has one
  type Look = { font: string; size: number; bold?: boolean; italic?: boolean; color?: string; own: NamedStyle | null };
  const looks = entries.map((e): Look => {
    const ls = levelStyle?.(e.level);
    return ls ? { font: ls.font, size: ls.size, ...(ls.bold ? { bold: true } : {}), ...(ls.italic ? { italic: true } : {}), ...(ls.color ? { color: ls.color } : {}), own: ls } : { ...base, own: null };
  });
  // (as the layout writes a run's style for measuring)
  const styleKey = (i: number) => `${looks[i]?.italic ? 'italic ' : ''}${looks[i]?.bold ? 'bold ' : ''}`;
  const labels = entries.map((e) => pageOf(e.para));
  const numW = Math.max(0, ...labels.map((l, i) => measure(l, looks[i].size, withStack(looks[i].font), styleKey(i))));
  // room kept at the right for the dots and the number
  const keep = numW + 2 * st.size;
  const runs: TextRun[] = [];
  entries.forEach((e, i) => {
    const { own: _own, ...look } = looks[i];
    if (i) runs.push({ ...look, text: '\n' });
    runs.push({ ...look, text: e.num ? `${e.num}\t${e.text}` : e.text });
  });
  const paras: ParaStyle[] = entries.map((e, i) => {
    const own = looks[i].own;
    const before = own ? own.spaceBefore : spaced && e.level === 1 && entries.length > 1 ? 0.25 * st.size : 0;
    return { indent: (own ? own.indent : (e.level - 1) * TOC_INDENT), indentRight: keep, line, spaceBefore: i === 0 && own ? 0 : before };
  });
  const lay = layoutText({ runs, paras, justify: 'left', wrap, boxes: true }, st.size, measure);
  // (close dots, as Word's dot leader draws them)
  const unit = '.';
  const lines = lay.lines.map((l) => ({ ...l, pieces: [...l.pieces] }));
  for (const l of lines) {
    if (!l.last) continue;
    const look: Look = looks[l.para] ?? { ...base, own: null };
    const size = look.size, family = withStack(look.font), style = styleKey(l.para);
    const unitW = measure(unit, size, family, style);
    const label = labels[l.para] ?? '';
    const w = measure(label, size, family, style);
    const numX = wrap - w;
    const from = l.x + l.width + 0.4 * size;
    const to = numX - 0.3 * size;
    const n = unitW > 0 ? Math.floor((to - from) / unitW) : 0;
    const piece = (text: string, x: number, pw: number): Glyphs => ({ text, start: l.end, x, w: pw, dy: 0, size, family, style, decor: true, ...(look.color ? { color: look.color } : {}) });
    if (n > 0) {
      const dots = unit.repeat(n).trimEnd();
      const dw = measure(dots, size, family, style);
      l.pieces.push(piece(dots, to - dw, dw));
    }
    l.pieces.push(piece(label, numX, w));
    l.width = wrap - l.x;
  }
  return lines;
}

/** The contents as plain text, a line each ("Synthesis\t4"): for Word files and finding text. */
export function tocText(entries: TocEntry[], pageOf: (para: number) => string): string {
  return entries.map((e) => `${e.num ? `${e.num}\t` : ''}${e.text}\t${pageOf(e.para)}`).join('\n');
}

/** Is this run the contents? */
export const isToc = (t: Pick<DocText, 'objects'>, r: { obj?: number }): boolean => r.obj !== undefined && t.objects[r.obj]?.kind === 'toc';


// ---------------------------------------------------------------- table of figures

/** What a table of figures shows when there are no captions of its kind yet (on screen and in the PDF only). */
export function emptyTof(name: string): string {
  return `Table of figures: no ${name ? `${name} ` : ''}captions yet. Add them with References ▸ Insert Caption and they appear here with their page numbers.`;
}

/** The labels a table of figures can list, as References > Insert Table of Figures offers them ('' is every caption). */
export const TOF_NAMES = ['Figure', 'Scheme', 'Table', 'Chart', ''] as const;

/**
 * A table of figures' entries (References > Insert Table of Figures, as in Word): each caption
 * of the label `name` (every caption when '') in the order they come, as its whole caption
 * paragraph ("Figure 2. Synthesis of 3."), with the paragraph it is in for its page number.
 * Captions inside table cells are left out, as are compound numbers.
 */
export function tofEntries(t: DocText, name: string, shown: Map<number, string> = fieldTexts(t)): TocEntry[] {
  const runs = splitParagraphs(t.runs);
  const out: TocEntry[] = [];
  runs.forEach((pr, p) => {
    const seq = pr.find((r) => {
      const o = r.obj !== undefined ? t.objects[r.obj] : undefined;
      return o?.kind === 'seq' && o.name !== COMPOUND && (!name || o.name === name);
    });
    if (!seq) return;
    // fields show what they show in the text; figures in the paragraph are left out
    const text = pr.map((r) => (r.obj === undefined ? r.text : (shown.get(r.obj!) ?? '').repeat(r.text.length))).join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ level: 1, text, para: p });
  });
  return out;
}

/** Is this run a table of figures? */
export const isTof = (t: Pick<DocText, 'objects'>, r: { obj?: number }): boolean => r.obj !== undefined && t.objects[r.obj]?.kind === 'tof';

/**
 * The look of one level of the contents: the document's TOC style for it ("toc 1"...), with the
 * look Word gave the entries over it when the table came from a Word file and keeps it.
 */
export function tocLevelStyle(t: Pick<DocText, 'styles'>, o: { look?: (TocLook | null)[] }, level: number): NamedStyle | undefined {
  const own = t.styles[`TOC${level}`];
  const look = o.look?.[level - 1];
  if (!look) return own;
  if (own) return { ...own, ...look };
  // (no TOC style: the usual indent and spacing of the level)
  const n = t.styles.Normal;
  return n ? { ...n, ...look, indent: (level - 1) * TOC_INDENT, spaceBefore: level === 1 ? 0.25 * n.size : 0 } : undefined;
}

