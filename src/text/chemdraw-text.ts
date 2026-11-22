// Saving text that ChemDraw can't format itself. ChemDraw's captions have no lists, paragraph
// spacing or per-paragraph alignment, so a caption with any of these is saved the way ChemDraw
// can show it (each bullet or number written as text in front of its paragraph), and its
// paragraph formatting goes in a hidden object tag beside the text. Reading the file back, the
// tag puts everything back as it was, provided the text still matches it; if the text was
// changed in ChemDraw, the tag no longer fits and the text is read just as ChemDraw shows it.
// Links (Insert > Link) go in the same tag, ChemDraw having none: they show there as their text.

import type { ParaStyle, TextRun } from '../model';
import { applyStyle, normalizeRuns, plainText, replaceRange, styleOf, symbolFontShown } from '../richtext';
import { linkSpans } from '../links';
import { fitParas, listMarkers, paraCount, paraRange, splitParagraphs, storedParas } from './paragraphs';

/** Name of the hidden object tag that carries the paragraph formatting. */
export const TEXT_TAG = 'Chem Illustrator text';

export interface TextTag {
  v: 1;
  paras?: ParaStyle[];
  lineSpacing?: number;
  /** Links, as [start, end, link] in the text as saved. */
  links?: [number, number, string][];
  /** Looks ChemDraw's text has no place for (LOOK_FIELDS), as [start, end, look] in the text as saved. */
  looks?: [number, number, Partial<TextRun>][];
  /** Checksum of the text as saved, so a text edited elsewhere is recognised. */
  sum: string;
}

/**
 * A run's looks that ChemDraw's text has no place for (it has bold, italic, underline, sizes,
 * fonts and colours): strikethrough, character spacing and the Font box's text effects, and which
 * font a sign was in. They ride in the tag, by where they are in the text.
 */
export const LOOK_FIELDS = ['strike', 'dstrike', 'spacing', 'outline', 'outlineW', 'shadow', 'noFill', 'noKern', 'transparency', 'symbolFont'] as const;

/** The looks of a run that go in the tag, or null (not which font a sign is in when ChemDraw's fonts say so). */
function lookOf(r: TextRun): Partial<TextRun> | null {
  const o: Record<string, unknown> = {};
  for (const k of LOOK_FIELDS) if (r[k] !== undefined && (k === 'symbolFont' || r[k] !== false)) o[k] = r[k];
  if (r.symbolFont !== undefined && symbolFontShown(r.text, r.symbolFont)) delete o.symbolFont;
  return Object.keys(o).length ? o as Partial<TextRun> : null;
}

/** Each look checked against the type it has here (a damaged or hand-edited file can't put a wrong one on the text). */
function tidyLook(v: unknown): Partial<TextRun> | null {
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>, o: Partial<TextRun> = {};
  const n = (k: string) => typeof x[k] === 'number' && Number.isFinite(x[k]);
  for (const k of ['strike', 'dstrike', 'shadow', 'noFill', 'noKern'] as const) if (x[k] === true) o[k] = true;
  if (typeof x.symbolFont === 'boolean') o.symbolFont = x.symbolFont;
  if (n('spacing')) o.spacing = x.spacing as number;
  if (typeof x.outline === 'string') o.outline = x.outline;
  if (n('outlineW') && (x.outlineW as number) > 0) o.outlineW = x.outlineW as number;
  if (n('transparency')) o.transparency = Math.max(0, Math.min(1, x.transparency as number));
  return Object.keys(o).length ? o : null;
}

/** A short checksum of a text (FNV-1a, 32 bits). */
export function textSum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** What goes in front of a paragraph in ChemDraw: tabs for the level, then the bullet or number. */
export function markerPrefix(p: ParaStyle, marker: string | null): string {
  if (!p.list) return '';
  const level = Math.max(0, Math.min(8, p.level ?? 0));
  return marker ? `${'\t'.repeat(level)}${marker}\t` : '\t'.repeat(level + 1);
}

/**
 * The runs to save for ChemDraw and the tag to save with them (null when the text has nothing
 * ChemDraw can't hold).
 */
export function runsForChemDraw(c: { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number }): { runs: TextRun[]; tag: TextTag | null } {
  const text = plainText(c.runs);
  const paras = fitParas(c.paras, paraCount(text));
  const stored = storedParas(paras);
  const spacing = c.lineSpacing && c.lineSpacing !== 1 ? c.lineSpacing : undefined;
  const linked = c.runs.some((r) => r.link);
  const looked = c.runs.some((r) => lookOf(r));
  if (!stored && !spacing && !linked && !looked) return { runs: c.runs, tag: null };
  const markers = listMarkers(paras);
  const out: TextRun[] = [];
  splitParagraphs(c.runs).forEach((pr, i) => {
    if (i > 0) out.push({ ...(out[out.length - 1] ? styleOf(out[out.length - 1]) : {}), text: '\n' });
    const prefix = markerPrefix(paras[i], markers[i]);
    if (prefix) {
      // the bullet or number in the paragraph's own size, font and colour
      const first = pr[0];
      out.push({ text: prefix, ...(first?.size !== undefined ? { size: first.size } : {}), ...(first?.font ? { font: first.font } : {}), ...(first?.color ? { color: first.color } : {}) });
    }
    out.push(...pr.map((r) => ({ ...r })));
  });
  const all = normalizeRuns(out);
  const links = linkSpans(all).map((l): [number, number, string] => [l.start, l.end, l.link]);
  const runs = linked ? normalizeRuns(all.map((r) => { if (!r.link) return r; const { link: _l, ...rest } = r; return rest; })) : all;
  const tag: TextTag = { v: 1, sum: textSum(plainText(runs)) };
  if (stored) tag.paras = stored;
  if (spacing) tag.lineSpacing = spacing;
  if (links.length) tag.links = links;
  const looks: [number, number, Partial<TextRun>][] = [];
  let at = 0;
  for (const r of runs) {
    const l = lookOf(r);
    if (l) looks.push([at, at + r.text.length, l]);
    at += r.text.length;
  }
  if (looks.length) tag.looks = looks;
  return { runs, tag };
}

/** Read a tag's value; null if it isn't one of ours. */
export function parseTextTag(value: string | null): TextTag | null {
  if (!value) return null;
  try {
    const t = JSON.parse(value) as TextTag;
    return t && t.v === 1 && typeof t.sum === 'string' ? t : null;
  } catch {
    return null;
  }
}

/** Undo runsForChemDraw: take the bullets and numbers off again, if the text still fits the tag. */
export function runsFromChemDraw(runs: TextRun[], tag: TextTag | null): { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number } {
  if (!tag || textSum(plainText(runs)) !== tag.sum) return { runs };
  let text = plainText(runs);
  const paras = fitParas(tag.paras, paraCount(text));
  const markers = listMarkers(paras);
  let out = runs;
  for (const [a, b, link] of tag.links ?? []) if (typeof link === 'string' && a >= 0 && b > a && b <= text.length) out = applyStyle(out, a, b, { link });
  for (const [a, b, look] of Array.isArray(tag.looks) ? tag.looks : []) {
    const l = tidyLook(look);
    if (l && typeof a === 'number' && typeof b === 'number' && a >= 0 && b > a && b <= text.length) out = applyStyle(out, a, b, l);
  }
  for (let i = paras.length - 1; i >= 0; i--) {
    const prefix = markerPrefix(paras[i], markers[i]);
    if (!prefix) continue;
    const { start } = paraRange(text, i);
    if (text.slice(start, start + prefix.length) !== prefix) continue;
    out = replaceRange(out, start, start + prefix.length, []);
    text = text.slice(0, start) + text.slice(start + prefix.length);
  }
  const res: { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number } = { runs: out };
  const stored = storedParas(paras);
  if (stored) res.paras = stored;
  if (tag.lineSpacing) res.lineSpacing = tag.lineSpacing;
  return res;
}
