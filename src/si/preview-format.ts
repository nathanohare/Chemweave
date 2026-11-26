// Formatting done in the Live Preview that the SI page's fields can't hold (a font, a size, a
// color, a highlight, small capitals, a line through; any formatting on words the program writes,
// such as a compound's heading or "calcd for"): kept in the project folder in a file of
// Chemweave's own (SI Assistant doesn't read it, and keeps the folder's other files as they are),
// and put back each time the SI is compiled, so it is in the preview, in Compile ▸ Document and
// PDF, and in the Word snapshot.
//
// Each piece names the stretch it formats by its source (source-map.ts: a field, a stretch of
// words the program writes, or text typed where no field is; text that has no source, such as a
// heading, by its page of the tree, "b:<node>") and where in that source's printed text it is, with the words themselves: when the text has changed since (typed into on the SI
// page), the same words nearest to where they were are formatted; when they are gone, so is the
// formatting (nothing else is formatted by mistake).
//
// Bold, italic, underline, subscript and superscript on a field kept as formatted text (a
// procedure, a note, an NMR report) go into the field itself instead (preview-edit.ts), so the SI
// page and SI Assistant show them too.

import type { DocText } from '../document/document';
import type { Justify, ParaStyle, TextRun } from '../model';
import { fitParas, paraCount } from '../text/paragraphs';
import * as rt from '../richtext';
import type { SiFolder } from './folder';
import { parseMarkup, writeMarkup, type Run as MarkupRun } from './markup';
import { lineUp, printedOf } from './preview-edit';
import type { SourceBlock, SourceSpan } from './source-map';

export const PREVIEW_FORMAT_FILE = 'chemweave-preview-format.json';

/** The looks a piece can set. `false` (or '') takes a look off that the text has from elsewhere. */
export type RunFormatLook = Partial<Pick<TextRun, 'bold' | 'italic' | 'underline' | 'strike' | 'sub' | 'sup' | 'smallCaps' | 'font' | 'size' | 'color' | 'highlight'>>;
export type FormatLook = RunFormatLook & ParaLook;
/** A paragraph's own look (Home ▸ Paragraph): on every paragraph the words are in. */
export type ParaLook = Partial<Pick<ParaStyle, 'align' | 'indent' | 'spaceBefore' | 'spaceAfter' | 'line' | 'pageBreak'>>;
export const PARA_KEYS: readonly (keyof ParaLook)[] = ['align', 'indent', 'spaceBefore', 'spaceAfter', 'line', 'pageBreak'];
const ALIGNS: readonly Justify[] = ['left', 'center', 'right', 'justify'];

export const LOOK_KEYS: readonly (keyof RunFormatLook)[] = ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'smallCaps', 'font', 'size', 'color', 'highlight'];

export interface PreviewFormat {
  id: string;
  /** The source whose printed text it formats. */
  src: string;
  /** Where in that printed text: [start, end). */
  start: number;
  end: number;
  /** The words formatted, as they were then. */
  text: string;
  /** A few characters either side of them then, to find the same words again among others alike. */
  before?: string;
  after?: string;
  look: FormatLook;
}

/** How many characters of context either side are kept. */
const CONTEXT = 12;
/** A piece made for the printed text [a, b) of `printed`. */
const pieceAt = (src: string, printed: string, a: number, b: number, look: FormatLook, id = newFormatId()): PreviewFormat =>
  ({ id, src, start: a, end: b, text: printed.slice(a, b), before: printed.slice(Math.max(0, a - CONTEXT), a), after: printed.slice(b, b + CONTEXT), look });

let counter = 0;
export const newFormatId = (): string => `pf-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function readPreviewFormats(folder: SiFolder): Promise<PreviewFormat[]> {
  const raw = await folder.readText(PREVIEW_FORMAT_FILE).catch(() => null);
  return (raw && parsePreviewFormats(raw)) || [];
}

/** The file's pieces, to change and write back; throws when the file is there but can't be read (it is never written over). */
export async function readPreviewFormatsToChange(folder: SiFolder): Promise<PreviewFormat[]> {
  // (a file that is there but can't be read now throws: it is never written over as if it weren't there)
  const raw = await folder.readText(PREVIEW_FORMAT_FILE);
  if (!raw || !raw.trim()) return [];
  const got = parsePreviewFormats(raw);
  if (!got) throw new Error(`${PREVIEW_FORMAT_FILE} in the project folder can’t be read (half synced, or changed by hand), so it wasn’t saved over. Fix or remove it, then format again`);
  return got;
}

/** The file's pieces; null when it can't be read (so it is never written over). */
export function parsePreviewFormats(raw: string): PreviewFormat[] | null {
  try {
    const j = JSON.parse(raw) as { items?: unknown; version?: unknown };
    if (!j || !Array.isArray(j.items)) return null;
    // (written by a newer Chemweave: read as far as it goes, but never written over)
    if (typeof j.version === 'number' && j.version > 2) return null;
    const out: PreviewFormat[] = [];
    for (const x of j.items as Record<string, unknown>[]) {
      if (!x || typeof x.src !== 'string' || typeof x.start !== 'number' || typeof x.end !== 'number' || typeof x.text !== 'string' || !x.look || typeof x.look !== 'object') continue;
      const look: FormatLook = {};
      for (const k of LOOK_KEYS) {
        const v = (x.look as Record<string, unknown>)[k];
        if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') (look as Record<string, unknown>)[k] = v;
      }
      for (const k of PARA_KEYS) {
        const v = (x.look as Record<string, unknown>)[k];
        if (k === 'align' ? ALIGNS.includes(v as Justify) : k === 'pageBreak' ? typeof v === 'boolean' : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000) (look as Record<string, unknown>)[k] = v;
      }
      const piece: PreviewFormat = { id: typeof x.id === 'string' ? x.id : newFormatId(), src: x.src, start: x.start, end: x.end, text: x.text, look };
      if (typeof x.before === 'string') piece.before = x.before;
      if (typeof x.after === 'string') piece.after = x.after;
      out.push(piece);
    }
    return out;
  } catch {
    return null;
  }
}

export function previewFormatsJson(items: readonly PreviewFormat[]): string {
  // (version 2: paragraph looks, which a Chemweave reading only version 1 would drop and write over)
  const version = items.some((f) => PARA_KEYS.some((k) => f.look[k] !== undefined)) ? 2 : 1;
  return JSON.stringify({ version, items }, null, 1) + '\n';
}

/**
 * Where a piece is in its source's printed text now: where it was, when the words there are the
 * same; else, among the places with the same words, the one whose characters either side match
 * those kept best (the nearest of equals); null when they are gone, or when short words are found
 * in more than one place and nothing tells them apart (nothing else is formatted by mistake).
 */
export function locateFormat(printed: string, f: Pick<PreviewFormat, 'start' | 'end' | 'text' | 'before' | 'after'>): [number, number] | null {
  if (!f.text) return null;
  const n = f.text.length;
  const fits = (i: number): number => {
    let k = 0;
    const bf = f.before ?? '', af = f.after ?? '';
    while (k < bf.length && i - 1 - k >= 0 && printed[i - 1 - k] === bf[bf.length - 1 - k]) k++;
    let m = 0;
    while (m < af.length && i + n + m < printed.length && printed[i + n + m] === af[m]) m++;
    return k + m;
  };
  const found: number[] = [];
  for (let i = printed.indexOf(f.text); i >= 0; i = printed.indexOf(f.text, i + 1)) found.push(i);
  if (!found.length) return null;
  if (printed.slice(f.start, f.end) === f.text) {
    // still where it was: keep it, unless the same words elsewhere fit the characters either side as well
    if (f.before === undefined || (!f.before && !f.after)) return [f.start, f.end];
    const here = fits(f.start);
    if (here > 0 && found.every((i) => i === f.start || fits(i) < here)) return [f.start, f.end];
  }
  if (found.length === 1) return n >= 4 || f.before === undefined || fits(found[0]) > 0 ? [found[0], found[0] + n] : null;
  // more than one: the best fit of the characters either side (and it must be told apart)
  const scored = found.map((i) => ({ i, s: fits(i) })).sort((x, y) => y.s - x.s || Math.abs(x.i - f.start) - Math.abs(y.i - f.start));
  if (f.before === undefined) return [scored[0].i, scored[0].i + n];
  if (scored[0].s < 3 || scored[0].s === scored[1].s) return null;
  return [scored[0].i, scored[0].i + n];
}

/** The source naming a page of the tree's own text (text with no source of its own: a heading). */
export const blockSrc = (node: string): string => `b:${node}`;
const blockOf = (src: string, blocks: readonly SourceBlock[]): SourceBlock | undefined =>
  src.startsWith('b:') ? blocks.find((x) => x.node === src.slice(2)) : undefined;

/** The printed text of `src`: a field's text (as preview-edit.ts printedOf), or a page's whole text. */
export function printedFor(text: string, spans: readonly SourceSpan[], blocks: readonly SourceBlock[], src: string): string {
  if (src.startsWith('b:')) { const b = blockOf(src, blocks); return b ? text.slice(b.start, b.end) : ''; }
  return printedOf(text, spans, src).printed;
}

/** The document's stretches [from, to) that the printed text [a, b) of `src` is. */
export function docRanges(text: string, spans: readonly SourceSpan[], src: string, a: number, b: number, blocks: readonly SourceBlock[] = []): [number, number][] {
  if (src.startsWith('b:')) {
    const k = blockOf(src, blocks);
    if (!k) return [];
    const lo = k.start + Math.max(0, a), hi = Math.min(k.end, k.start + b);
    return hi > lo ? [[lo, hi]] : [];
  }
  const mine = spans.filter((s) => s.src === src).sort((x, y) => x.start - y.start);
  const out: [number, number][] = [];
  let at = 0;
  mine.forEach((s, i) => {
    if (i && text.slice(mine[i - 1].end, s.start).includes('\n')) at += 1;
    const lo = Math.max(a, at), hi = Math.min(b, at + s.end - s.start);
    if (hi > lo) out.push([s.start + lo - at, s.start + hi - at]);
    at += s.end - s.start;
  });
  return out;
}

/** A look as a run style patch (sub and superscript take each other off). */
function patchOf(look: FormatLook): Partial<TextRun> {
  const p: Record<string, unknown> = {};
  for (const k of LOOK_KEYS) {
    const v = look[k];
    if (v === undefined) continue;
    p[k] = v === false || v === '' ? undefined : v;
  }
  if (look.sub) p.sup = undefined;
  if (look.sup) p.sub = undefined;
  if (look.sub || look.sup) p.formula = undefined;
  return p as Partial<TextRun>;
}

/** The paragraph (from 0) the character at `at` is in, by the text's line breaks `nls` (in order). */
function paraOf(nls: readonly number[], at: number): number {
  let lo = 0, hi = nls.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (nls[mid] < at) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A look's paragraph settings (left alignment, no indent, no space: the paragraph's own taken off), or null. */
function paraPatchOf(look: FormatLook): Partial<ParaStyle> | null {
  const keys = PARA_KEYS.filter((k) => look[k] !== undefined);
  if (!keys.length) return null;
  const p: Record<string, unknown> = {};
  for (const k of keys) p[k] = k === 'align' ? look.align : look[k] || undefined;
  return p as Partial<ParaStyle>;
}

/** The document with each piece's look on the text it formats (pieces later in the list win). */
export function applyPreviewFormats(doc: DocText, sources: readonly SourceSpan[], blocks: readonly SourceBlock[], items: readonly PreviewFormat[]): DocText {
  if (!items.length) return doc;
  const text = rt.plainText(doc.runs);
  let runs = doc.runs;
  let paras: ParaStyle[] | null = null;
  let nls: number[] | null = null;
  // (each source's own stretches, found once: a piece whose source isn't in this compile is passed over)
  const bySrc = new Map<string, SourceSpan[]>();
  for (const sp of sources) { const l = bySrc.get(sp.src); if (l) l.push(sp); else bySrc.set(sp.src, [sp]); }
  const printedBySrc = new Map<string, string>();
  for (const f of items) {
    const mine = bySrc.get(f.src) ?? [];
    if (!mine.length && !(f.src.startsWith('b:') && blocks.some((x) => x.node === f.src.slice(2)))) continue;
    let printed = printedBySrc.get(f.src);
    if (printed === undefined) { printed = printedFor(text, mine, blocks, f.src); printedBySrc.set(f.src, printed); }
    const at = locateFormat(printed, f);
    if (!at) continue;
    const patch = patchOf(f.look);
    const para = paraPatchOf(f.look);
    for (const [a, b] of docRanges(text, mine, f.src, at[0], at[1], blocks)) {
      if (Object.keys(patch).length) runs = rt.applyStyle(runs, a, b, patch);
      if (para) {
        paras ??= fitParas(doc.paras, paraCount(text));
        nls ??= [...text.matchAll(/\n/g)].map((m) => m.index!);
        for (let i = paraOf(nls, a), last = paraOf(nls, Math.max(a, b - 1)); i <= last; i++) {
          const next: Record<string, unknown> = { ...paras[i] };
          for (const [k, v] of Object.entries(para)) { if (v === undefined) delete next[k]; else next[k] = v; }
          paras[i] = next as ParaStyle;
        }
      }
    }
  }
  return runs === doc.runs && !paras ? doc : { ...doc, runs, ...(paras ? { paras } : {}) };
}

/**
 * The pieces after a look is put on the printed text [a, b) of `src` (whose printed text is
 * `printed`): a new piece, and the parts of older pieces on the same words that set the same
 * looks taken off (so the file doesn't grow with each click).
 */
export function addFormat(items: readonly PreviewFormat[], src: string, printed: string, a: number, b: number, look: FormatLook): PreviewFormat[] {
  if (b <= a) return [...items];
  const keys = Object.keys(look) as (keyof FormatLook)[];
  const out: PreviewFormat[] = [];
  for (const f of items) {
    if (f.src !== src) { out.push(f); continue; }
    const at = locateFormat(printed, f);
    if (!at) continue; // (its words are gone: it does nothing any more)
    const [fa, fb] = at;
    const covered = fa >= a && fb <= b;
    const rest: FormatLook = { ...f.look };
    for (const k of keys) delete rest[k];
    const restEmpty = !Object.keys(rest).length;
    if (covered && restEmpty) continue;
    if (covered) { out.push(pieceAt(src, printed, fa, fb, rest, f.id)); continue; }
    // (overlapping only in part: kept as it is; the new piece comes after it and wins)
    out.push(pieceAt(src, printed, fa, fb, f.look, f.id));
  }
  out.push(pieceAt(src, printed, a, b, { ...look }));
  return out;
}

/**
 * The pieces after Clear All Formatting on the printed text [a, b) of `src`: what they set there
 * taken off (with `keys`, only those looks: Bold put back in the field takes off a Bold-off piece).
 */
export function clearFormats(items: readonly PreviewFormat[], src: string, printed: string, a: number, b: number, keys?: readonly (keyof FormatLook)[]): PreviewFormat[] {
  const out: PreviewFormat[] = [];
  for (const f of items) {
    if (f.src !== src) { out.push(f); continue; }
    const at = locateFormat(printed, f);
    if (!at) continue;
    const [fa, fb] = at;
    if (fb <= a || fa >= b) { out.push(pieceAt(src, printed, fa, fb, f.look, f.id)); continue; }
    if (keys) {
      const rest: FormatLook = { ...f.look };
      for (const k of keys) delete rest[k];
      if (Object.keys(rest).length === Object.keys(f.look).length) { out.push(pieceAt(src, printed, fa, fb, f.look, f.id)); continue; }
      // (inside [a, b) only the other looks stay)
      const lo = Math.max(fa, a), hi = Math.min(fb, b);
      if (Object.keys(rest).length) out.push(pieceAt(src, printed, lo, hi, rest));
    }
    // the parts of it outside [a, b) stay
    if (fa < a) out.push(pieceAt(src, printed, fa, a, f.look));
    if (fb > b) out.push(pieceAt(src, printed, b, fb, f.look));
  }
  return out;
}

/** The looks a field kept as formatted text (markup.ts) holds itself. */
export type MarkupLook = Partial<Record<'bold' | 'italic' | 'underline' | 'sub' | 'sup', boolean>>;
export const MARKUP_KEYS: readonly (keyof MarkupLook)[] = ['bold', 'italic', 'underline', 'sub', 'sup'];

/** Whether a look is only ones a field's formatted text can hold. */
export const markupOnly = (look: FormatLook): look is MarkupLook =>
  Object.keys(look).length > 0 && Object.entries(look).every(([k, v]) => (MARKUP_KEYS as readonly string[]).includes(k) && typeof v === 'boolean');

/**
 * A field's stored formatted text (`raw`, markup.ts) after a look is put on its printed text
 * [a, b) (`printed`, lined up with the stored text as typing is, preview-edit.ts), or, with
 * `clear`, those looks taken off. `missed`: the printed stretches the stored text doesn't hold
 * (words the program adds), for the formatting file instead. `raw` is null when nothing stored
 * was in [a, b).
 */
export function markupFormat(raw: string, printed: string, a: number, b: number, look: MarkupLook | 'clear'): { raw: string | null; missed: [number, number][] } {
  const paras = parseMarkup(raw);
  // the stored text's characters, each with where it is (a link counts as one character that lines up with nothing)
  const where: { p: number; r: number; o: number }[] = [];
  let plain = '';
  paras.forEach((para, pi) => {
    if (pi) { plain += '\n'; where.push({ p: -1, r: -1, o: -1 }); }
    para.runs.forEach((run, ri) => {
      if (run.ref) { plain += '\uFFFC'; where.push({ p: -1, r: -1, o: -1 }); return; }
      for (let o = 0; o < run.text.length; o++) { plain += run.text[o]; where.push({ p: pi, r: ri, o }); }
    });
  });
  const map = lineUp(plain, printed);
  const hit = new Set<string>();
  const missed: [number, number][] = [];
  for (let i = Math.max(0, a); i < Math.min(b, printed.length); i++) {
    const j = map[i];
    const w = j >= 0 ? where[j] : undefined;
    if (w && w.p >= 0) { hit.add(`${w.p}/${w.r}/${w.o}`); continue; }
    if (/\s/.test(printed[i])) continue;
    const last = missed[missed.length - 1];
    if (last && last[1] === i) last[1] = i + 1; else missed.push([i, i + 1]);
  }
  if (!hit.size) return { raw: null, missed };
  const set = (r: MarkupRun): MarkupRun => {
    const x: MarkupRun = { ...r };
    if (look === 'clear') { delete x.bold; delete x.italic; delete x.underline; delete x.valign; return x; }
    if (look.bold !== undefined) x.bold = look.bold || undefined;
    if (look.italic !== undefined) x.italic = look.italic || undefined;
    if (look.underline !== undefined) x.underline = look.underline || undefined;
    if (look.sub !== undefined) x.valign = look.sub ? 'sub' : x.valign === 'sub' ? undefined : x.valign;
    if (look.sup !== undefined) x.valign = look.sup ? 'super' : x.valign === 'super' ? undefined : x.valign;
    return x;
  };
  const next = paras.map((para, pi) => ({
    ...para,
    runs: para.runs.flatMap((run, ri): MarkupRun[] => {
      if (run.ref) return [run];
      // each character on its own (writeMarkup puts the ones that look the same back together)
      return Array.from({ length: run.text.length }, (_, o) => run.text[o]).map((ch, o) => (hit.has(`${pi}/${ri}/${o}`) ? set({ ...run, text: ch }) : { ...run, text: ch }));
    }),
  }));
  return { raw: writeMarkup(next), missed };
}
