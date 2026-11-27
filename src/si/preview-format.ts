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
// A link (Insert ▸ Link in the Live Preview: a web page, a DOI, a place in the SI) is kept here
// too, as a look (`link`, with the link's blue and underline): SI Assistant's text format has no
// links of its own, only mentions and citations.
//
// Bold, italic, underline, subscript and superscript on a field kept as formatted text (a
// procedure, a note, an NMR report) go into the field itself instead (preview-edit.ts), so the SI
// page and SI Assistant show them too.

import type { DocText } from '../document/document';
import type { Justify, ParaStyle, TabStop, TextRun } from '../model';
import { fitParas, paraCount } from '../text/paragraphs';
import * as rt from '../richtext';
import { plainLook } from '../links';
import type { SiFolder } from './folder';
import { parseMarkup, writeMarkup, type Run as MarkupRun } from './markup';
import { lineUp, printedOf } from './preview-edit';
import type { SourceBlock, SourceSpan } from './source-map';

export const PREVIEW_FORMAT_FILE = 'chemweave-preview-format.json';

/** The looks a piece can set. `false` (or '', or 0 for character spacing) takes a look off that the text has from elsewhere. */
export type RunFormatLook = Partial<Pick<TextRun, 'bold' | 'italic' | 'underline' | 'strike' | 'sub' | 'sup' | 'smallCaps' | 'font' | 'size' | 'color' | 'highlight' | 'allCaps' | 'spacing' | 'noKern' | 'link'>>;
export type FormatLook = RunFormatLook & ParaLook;
/** The paragraph settings a piece can set (Home ▸ Paragraph, its Paragraph box, Bullets and Numbering, Tabs, the Ruler). */
type ParaKey = 'align' | 'indent' | 'spaceBefore' | 'spaceAfter' | 'line' | 'pageBreak' | 'firstLine' | 'indentRight' | 'linePt' | 'lineRule' | 'keepNext' | 'keepLines' | 'list' | 'level' | 'bullet' | 'scheme' | 'tabs';
/**
 * A paragraph's own look: on every paragraph the words are in. '', `false`, 0 or no tab stops
 * take the paragraph's own setting off, as in a document (text/paragraphs.ts cleanPara), so it
 * has the style's again (left alignment is set as 'left').
 */
export type ParaLook = { [K in ParaKey]?: ParaStyle[K] | '' };

/** A change of paragraph settings as Document mode makes it (undefined takes a setting off) as a look to keep. */
export function paraLookOf(patch: Partial<ParaStyle>): ParaLook {
  const out: Record<string, unknown> = {};
  for (const k of PARA_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    out[k] = v === undefined ? (k === 'tabs' ? [] : '') : Array.isArray(v) ? v.map((t) => ({ ...t })) : v;
  }
  return out as ParaLook;
}
export const PARA_KEYS: readonly (keyof ParaLook)[] = ['align', 'indent', 'spaceBefore', 'spaceAfter', 'line', 'pageBreak', 'firstLine', 'indentRight', 'linePt', 'lineRule', 'keepNext', 'keepLines', 'list', 'level', 'bullet', 'scheme', 'tabs'];
const ALIGNS: readonly Justify[] = ['left', 'center', 'right', 'justify'];

export const LOOK_KEYS: readonly (keyof RunFormatLook)[] = ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', 'smallCaps', 'font', 'size', 'color', 'highlight', 'allCaps', 'spacing', 'noKern', 'link'];
/** The keys a Chemweave reading only version 1 or 2 of the file doesn't know (links, All Caps, spacing, lists, tabs and Word's other paragraph settings) (it would drop them and write over the file). */
const V3_KEYS: readonly (keyof FormatLook)[] = ['link', 'allCaps', 'spacing', 'noKern', 'firstLine', 'indentRight', 'linePt', 'lineRule', 'keepNext', 'keepLines', 'list', 'level', 'bullet', 'scheme', 'tabs'];
const V2_KEYS: readonly (keyof FormatLook)[] = ['align', 'indent', 'spaceBefore', 'spaceAfter', 'line', 'pageBreak'];
const TAB_KINDS: readonly TabStop['kind'][] = ['left', 'center', 'right', 'decimal'];
const TAB_LEADERS: readonly NonNullable<TabStop['leader']>[] = ['dot', 'hyphen', 'underscore'];
const num = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** A paragraph setting read from the file as it can be used, or undefined (dropped). */
function paraValueOf(k: keyof ParaLook, v: unknown): unknown {
  if (v === '' && k !== 'tabs') return v;
  switch (k) {
    case 'align': return ALIGNS.includes(v as Justify) ? v : undefined;
    case 'pageBreak': case 'keepNext': case 'keepLines': return typeof v === 'boolean' ? v : undefined;
    // (an indent may go into the margin, a first line hang out to the left)
    case 'indent': case 'firstLine': case 'indentRight': return num(v, -1000, 1000) ? v : undefined;
    case 'linePt': return num(v, 0, 1584) ? v : undefined;
    case 'lineRule': return v === 'exact' || v === 'atLeast' || v === '' ? v : undefined;
    case 'list': return v === 'bullet' || v === 'number' || v === '' ? v : undefined;
    case 'level': return num(v, 0, 8) && Number.isInteger(v) ? v : undefined;
    case 'bullet': return typeof v === 'string' && v.length <= 4 ? v : undefined;
    case 'scheme': return typeof v === 'string' && v.length <= 400 ? v : undefined;
    case 'tabs': {
      if (!Array.isArray(v) || v.length > 64) return undefined;
      const out: TabStop[] = [];
      for (const t of v as Record<string, unknown>[]) {
        if (!t || !num(t.pos, 0, 2000) || !TAB_KINDS.includes(t.kind as TabStop['kind'])) continue;
        const stop: TabStop = { pos: t.pos as number, kind: t.kind as TabStop['kind'] };
        if (TAB_LEADERS.includes(t.leader as NonNullable<TabStop['leader']>)) stop.leader = t.leader as TabStop['leader'];
        out.push(stop);
      }
      return out;
    }
    default: return num(v, 0, 1000) ? v : undefined;
  }
}
/** The newest version of the file this Chemweave reads (2: paragraph looks; 3: links, All Caps, spacing, lists, tabs and the rest). */
const FORMAT_VERSION = 3;

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
  return (await readPreviewFormatsForCompile(folder)).items;
}

/** The file's pieces for a compile, and whether it was written by a newer Chemweave (so isn't used: said in the compile's notes). */
export async function readPreviewFormatsForCompile(folder: SiFolder): Promise<{ items: PreviewFormat[]; newer: boolean }> {
  const raw = await folder.readText(PREVIEW_FORMAT_FILE).catch(() => null);
  if (!raw) return { items: [], newer: false };
  return { items: parsePreviewFormats(raw) ?? [], newer: newerFile(raw, FORMAT_VERSION) };
}

/** Whether a side file's text says it is a version newer than `known`. */
export function newerFile(raw: string, known: number): boolean {
  try { const v = (JSON.parse(raw) as { version?: unknown })?.version; return typeof v === 'number' && v > known; } catch { return false; }
}

/** The file's pieces, to change and write back; throws when the file is there but can't be read (it is never written over). */
export async function readPreviewFormatsToChange(folder: SiFolder): Promise<PreviewFormat[]> {
  return (await readPreviewFormatFileToChange(folder)).items;
}

/**
 * The file's pieces and its version, to change and write back (previewFormatsJson with that
 * version, so a file a newer look made is never written back as an older version); throws when
 * the file is there but can't be read (it is never written over).
 */
export async function readPreviewFormatFileToChange(folder: SiFolder): Promise<{ items: PreviewFormat[]; version: number }> {
  // (a file that is there but can't be read now throws: it is never written over as if it weren't there)
  const raw = await folder.readText(PREVIEW_FORMAT_FILE);
  if (!raw || !raw.trim()) return { items: [], version: 1 };
  const got = parsePreviewFormats(raw);
  if (!got) throw new Error(`${PREVIEW_FORMAT_FILE} in the project folder can’t be read (half synced, or changed by hand), so it wasn’t saved over. Fix or remove it, then format again`);
  return { items: got, version: previewFormatVersion(raw) };
}

/** The version a formatting file says it is (1 when it doesn't say). */
export function previewFormatVersion(raw: string): number {
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
  } catch { return 1; }
}

/** The file's pieces; null when it can't be read (so it is never written over). */
export function parsePreviewFormats(raw: string): PreviewFormat[] | null {
  try {
    const j = JSON.parse(raw) as { items?: unknown; version?: unknown };
    if (!j || !Array.isArray(j.items)) return null;
    // (written by a newer Chemweave: read as far as it goes, but never written over)
    if (typeof j.version === 'number' && j.version > FORMAT_VERSION) return null;
    const out: PreviewFormat[] = [];
    for (const x of j.items as Record<string, unknown>[]) {
      if (!x || typeof x.src !== 'string' || typeof x.start !== 'number' || typeof x.end !== 'number' || typeof x.text !== 'string' || !x.look || typeof x.look !== 'object') continue;
      // (looks and keys a newer Chemweave added are kept as they are, so writing the file back keeps them)
      const look: FormatLook = {};
      for (const [k, v] of Object.entries(x.look as Record<string, unknown>)) if (!(LOOK_KEYS as readonly string[]).includes(k) && !(PARA_KEYS as readonly string[]).includes(k)) (look as Record<string, unknown>)[k] = v;
      for (const k of LOOK_KEYS) {
        const v = (x.look as Record<string, unknown>)[k];
        // (All Caps and kerning on or off; character spacing in points, as the Font box takes it; a link is where it goes, or '' to take one off)
        const ok = k === 'allCaps' || k === 'noKern' ? typeof v === 'boolean' : k === 'spacing' ? num(v, -20, 100) : k === 'link' ? typeof v === 'string' && v.length <= 4000 : typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number';
        if (ok) (look as Record<string, unknown>)[k] = v;
      }
      for (const k of PARA_KEYS) {
        const v = paraValueOf(k, (x.look as Record<string, unknown>)[k]);
        if (v !== undefined) (look as Record<string, unknown>)[k] = v;
      }
      const { id: _i, src: _s, start: _a, end: _b, text: _t, before: _bf, after: _af, look: _l, ...other } = x;
      const piece: PreviewFormat = { ...other, id: typeof x.id === 'string' ? x.id : newFormatId(), src: x.src, start: x.start, end: x.end, text: x.text, look };
      if (typeof x.before === 'string') piece.before = x.before;
      if (typeof x.after === 'string') piece.after = x.after;
      out.push(piece);
    }
    return out;
  } catch {
    return null;
  }
}

export function previewFormatsJson(items: readonly PreviewFormat[], atLeast = 1): string {
  // (version 2: paragraph looks, which a Chemweave reading only version 1 would drop and write over;
  // version 3: All Caps, character spacing, lists, tab stops and Word's other paragraph settings, which one reading version 2 would)
  const has = (keys: readonly (keyof FormatLook)[]): boolean => items.some((f) => keys.some((k) => f.look[k] !== undefined));
  // (and never lower than the file was: what a newer Chemweave would read it as stays so)
  const version = Math.max(atLeast, has(V3_KEYS) ? 3 : has(V2_KEYS) ? 2 : 1);
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
    p[k] = v === false || v === '' || (k === 'spacing' && v === 0) ? undefined : v;
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
  for (const k of keys) {
    const v = look[k];
    p[k] = Array.isArray(v) ? (v.length ? v.map((t) => ({ ...t })) : undefined) : v || undefined;
  }
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
  // (the looks put on all at once at the end: one pass over the runs, not one for each piece)
  const edits: { start: number; end: number; patch: Partial<rt.RunStyle> }[] = [];
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
      if (Object.keys(patch).length) edits.push({ start: a, end: b, patch });
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
  if (edits.length) runs = rt.applyStyles(runs, edits);
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
    out.push({ ...f, ...pieceAt(src, printed, fa, fb, f.look, f.id) });
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
    if (fb <= a || fa >= b) { out.push({ ...f, ...pieceAt(src, printed, fa, fb, f.look, f.id) }); continue; }
    // (Clear All Formatting leaves a link, with the blue and underline it came with, as Word does)
    if (!keys && f.look.link) {
      const lo = Math.max(fa, a), hi = Math.min(fb, b);
      out.push(pieceAt(src, printed, lo, hi, linkLook(f.look)));
    } else if (keys) {
      const rest: FormatLook = { ...f.look };
      for (const k of keys) delete rest[k];
      if (Object.keys(rest).length === Object.keys(f.look).length) { out.push({ ...f, ...pieceAt(src, printed, fa, fb, f.look, f.id) }); continue; }
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

/** The link of a look, with the blue and underline that came with it. */
function linkLook(look: FormatLook): FormatLook {
  const out: FormatLook = { link: look.link };
  if (look.color !== undefined) out.color = look.color;
  if (look.underline !== undefined) out.underline = look.underline;
  return out;
}

/** Whether a piece with a link is on the printed text [a, b) of `src`. */
export function linkPieceOn(items: readonly PreviewFormat[], src: string, printed: string, a: number, b: number): boolean {
  return items.some((f) => { if (f.src !== src || !f.look.link) return false; const at = locateFormat(printed, f); return !!at && at[0] < b && at[1] > a; });
}

/**
 * The pieces after Remove Link on the printed text [a, b) of `src`: the pieces that carry a link
 * lose it there, and the link's blue and underline with it (Document mode's rule, links.ts
 * plainLook: a color other than the link blue stays); other pieces are left as they are.
 */
export function removeLinks(items: readonly PreviewFormat[], src: string, printed: string, a: number, b: number): PreviewFormat[] {
  const out: PreviewFormat[] = [];
  for (const f of items) {
    if (f.src !== src || !f.look.link) { out.push(f); continue; }
    const at = locateFormat(printed, f);
    if (!at) continue;
    const [fa, fb] = at;
    if (fb <= a || fa >= b) { out.push({ ...f, ...pieceAt(src, printed, fa, fb, f.look, f.id) }); continue; }
    const rest = plainLook(f.look as Partial<TextRun>) as FormatLook;
    const lo = Math.max(fa, a), hi = Math.min(fb, b);
    if (Object.keys(rest).length) out.push(pieceAt(src, printed, lo, hi, rest));
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

/**
 * The pieces after the words of `src` changed case (Change Case: the same length, the same
 * places): each piece found in the printed text before is kept on the same characters, with
 * the words and the characters either side as they are now (locating is case-sensitive).
 */
export function reanchorFormats(items: readonly PreviewFormat[], src: string, before: string, after: string): PreviewFormat[] {
  if (before.length !== after.length) return [...items];
  return items.map((f) => {
    if (f.src !== src) return f;
    const at = locateFormat(before, f);
    return at ? pieceAt(src, after, at[0], at[1], f.look, f.id) : f;
  });
}
