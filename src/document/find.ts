// Find and replace in a document's text. Finding works on the letters alone (CH2Cl2 is found
// however its 2s are formatted, and CH₂Cl₂ typed with subscript characters finds it too); a
// replacement can also change how the text looks, such as making every CH2Cl2 a formula.

import type { TextRun } from '../model';
import * as rt from '../richtext';
import { OBJECT_CHAR } from './document';
import { parseRev, revText, trackedReplace, type Revisable } from './revisions';
import { fitParas, paraCount } from '../text/paragraphs';

export interface FindOptions {
  /** Capitals and small letters must match. */
  matchCase?: boolean;
  /** Only whole words (or formulas): "Me" doesn't find the "me" in "method". */
  wholeWord?: boolean;
}

/** How replaced text looks. `plain` first takes off bold, italic, underline, subscript, superscript and formula. */
export interface ReplaceLook {
  plain?: boolean;
  formula?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sub?: boolean;
  sup?: boolean;
}

const SUBS = '₀₁₂₃₄₅₆₇₈₉', SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** What is looked for, with subscript and superscript characters as the plain ones the text keeps. */
export function plainQuery(q: string): string {
  return q.replace(/[₀-₉⁰¹²³⁴-⁹⁺⁻₊₋]/g, (c) => {
    const i = SUBS.indexOf(c), j = SUPS.indexOf(c);
    if (i >= 0) return String(i);
    if (j >= 0) return String(j);
    return c === '⁺' || c === '₊' ? '+' : '-';
  });
}

const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Every place the words are found, in order (never across a paragraph's end, a figure or a field). */
export function findAll(text: string, query: string, opts: FindOptions = {}): [number, number][] {
  const q = plainQuery(query);
  if (!q) return [];
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.matchCase ? 'gu' : 'giu');
  const out: [number, number][] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const a = m.index, b = a + m[0].length;
    // on to the next character (both halves of an emoji's or another astral character's pair: with
    // the 'u' flag a search from inside one starts at the same character, the same match for ever)
    re.lastIndex = a + ((text.codePointAt(a) ?? 0) > 0xffff ? 2 : 1);
    if (m[0].includes('\n') || m[0].includes(OBJECT_CHAR)) continue;
    if (opts.wholeWord && (wordChar(text[a - 1]) || wordChar(text[b]))) continue;
    if (out.length && a < out[out.length - 1][1]) continue;
    out.push([a, b]);
  }
  return out;
}

/** The change a look makes to a run's formatting (null: none). */
export function lookPatch(look: ReplaceLook): Partial<rt.RunStyle> | null {
  const p: Partial<rt.RunStyle> = {};
  if (look.plain) Object.assign(p, { bold: undefined, italic: undefined, underline: undefined, sub: undefined, sup: undefined, formula: undefined });
  if (look.bold) p.bold = true;
  if (look.italic) p.italic = true;
  if (look.underline) p.underline = true;
  // formula, subscript and superscript each set where characters sit, so the last one chosen wins
  if (look.formula) Object.assign(p, { formula: true, sub: undefined, sup: undefined });
  if (look.sub) Object.assign(p, { sub: true, sup: undefined, formula: undefined });
  if (look.sup) Object.assign(p, { sup: true, sub: undefined, formula: undefined });
  return Object.keys(p).length ? p : null;
}

/**
 * Put the replacement in place of each found range (from the last, so earlier offsets hold).
 * The new text takes the formatting of the first found character, then the look. With no
 * replacement text but a look, the found text stays and only its look changes; with neither,
 * the found text goes.
 */
export function replaceRanges(runs: TextRun[], hits: [number, number][], replacement: string, look: ReplaceLook = {}, fallback: rt.RunStyle = {}): TextRun[] {
  const patch = lookPatch(look);
  const keep = !replacement && patch !== null;
  const sorted = [...hits].sort((x, y) => x[0] - y[0]);
  if (keep) return rt.applyStyles(runs, sorted.map(([a, b]) => ({ start: a, end: b, patch: patch! })));
  if (!separate(sorted)) {
    // (places that overlap or are empty: one at a time, from the last)
    let out = runs;
    for (const [a, b] of [...sorted].reverse()) {
      const style = rt.typingStyle(out, a, b, fallback);
      out = rt.replaceRange(out, a, b, replacement ? [{ ...style, text: replacement }] : []);
      if (patch && replacement) out = rt.applyStyle(out, a, a + replacement.length, patch);
    }
    return out;
  }
  // one walk over the runs, the replacement put in at each place (the same runs as one at a time)
  const out: TextRun[] = [];
  walkHits(runs, sorted, (r, inside) => { if (!inside) out.push(r); }, (style) => {
    if (!replacement) return;
    const one = { ...style(fallback), text: replacement };
    out.push(patch ? { ...rt.cleanStyle({ ...rt.styleOf(one), ...patch }), text: replacement } : one);
  });
  return rt.normalizeRuns(out);
}

/** Places in order, none empty and none overlapping the next (they may touch: "a" found twice in "aa"). */
function separate(sorted: [number, number][]): boolean {
  return sorted.every(([a, b], i) => b > a && (i === 0 || sorted[i - 1][1] <= a));
}

/**
 * Walk the runs once over places in order (separate): `text` gets each piece of a run outside
 * them (`inside` true for a piece inside one), and `at` is called after each place's pieces with
 * the style typing over it takes (that of its first character).
 */
function walkHits(runs: TextRun[], sorted: [number, number][], text: (r: TextRun, inside: boolean) => void, at: (style: (fallback: rt.RunStyle) => rt.RunStyle, hit: number) => void): void {
  let pos = 0, h = 0, first: TextRun | null = null;
  const close = () => {
    const r = first;
    at((fb) => (r ? rt.typingStyle([r], 0, 1, fb) : fb), h);
    first = null;
    h++;
  };
  for (const r of runs) {
    const len = r.text.length;
    let a = 0;
    while (a < len) {
      // past the place now open: closed
      while (h < sorted.length && sorted[h][1] <= pos + a) close();
      const hit = sorted[h];
      if (!hit || hit[0] >= pos + len) { text({ ...r, text: r.text.slice(a) }, false); a = len; break; }
      if (hit[0] > pos + a) { text({ ...r, text: r.text.slice(a, hit[0] - pos) }, false); a = hit[0] - pos; continue; }
      // inside the place
      const b = Math.min(len, hit[1] - pos);
      const piece = { ...r, text: r.text.slice(a, b) };
      first ??= piece;
      text(piece, true);
      a = b;
    }
    pos += len;
  }
  // places reaching the end of the text (or past it)
  while (h < sorted.length) close();
}

/**
 * Replace the found places while changes are tracked: each one is marked deleted, with the
 * replacement after it marked inserted. Returns the text and where the caret goes after the
 * last place replaced (the first in the text).
 */
export function trackedReplaceRanges<T extends Revisable>(t: T, hits: [number, number][], replacement: string, look: ReplaceLook, fallback: rt.RunStyle, who: { author: string; date: string }): { t: T; caret: number } {
  const patch = lookPatch(look);
  const sorted = [...hits].sort((x, y) => x[0] - y[0]);
  const text = rt.plainText(t.runs);
  if (!separate(sorted) || replacement.includes('\n') || sorted.some(([a, b]) => { const nl = text.indexOf('\n', a); return nl >= 0 && nl < b; })) {
    // (places that overlap, or line breaks: one at a time, from the last)
    let caret = 0;
    for (const [a, b] of [...sorted].reverse()) {
      const style = rt.typingStyle(t.runs, a, b, fallback);
      const got = trackedReplace(t, a, b, replacement ? [{ ...style, text: replacement }] : [], undefined, who);
      t = got.t;
      caret = got.caret;
      if (patch && replacement) t = { ...t, runs: rt.applyStyle(t.runs, got.caret - replacement.length, got.caret, patch) };
    }
    return { t, caret };
  }
  // one walk over the runs, as trackedReplace at each place (the places hold no line break, so
  // the paragraphs stay as they are): text inserted while tracking goes for real, the rest is
  // marked deleted (keeping earlier deletions' marks), and the replacement follows, marked inserted
  const del = revText({ kind: 'del', ...who }), ins = revText({ kind: 'ins', ...who });
  const out: TextRun[] = [];
  let caret = 0, kept = 0;
  walkHits(t.runs, sorted, (r, inside) => {
    if (!inside) { out.push(r); return; }
    const kind = parseRev(r.rev)?.kind;
    if (kind === 'ins') return;
    kept += r.text.length;
    out.push(kind === 'del' ? r : { ...r, rev: del });
  }, (style, h) => {
    const a = sorted[h][0];
    let added = 0;
    if (replacement) {
      const one: TextRun = { ...style(fallback), text: replacement, rev: ins };
      out.push(patch ? { ...rt.cleanStyle({ ...rt.styleOf(one), ...patch }), text: replacement } as TextRun : one);
      added = replacement.length;
    }
    if (h === 0) caret = a + kept + added;
    kept = 0;
  });
  return { t: { ...t, runs: rt.normalizeRuns(out), paras: fitParas(t.paras, paraCount(text)) }, caret };
}

/** Leave out places in text deleted while tracking changes (still there, struck through, but gone from what the text says). */
export function withoutDeleted(runs: TextRun[], hits: [number, number][]): [number, number][] {
  const del: [number, number][] = [];
  let at = 0;
  for (const r of runs) {
    if (parseRev(r.rev)?.kind === 'del') del.push([at, at + r.text.length]);
    at += r.text.length;
  }
  if (!del.length) return hits;
  // (both in text order: the deletions before each place are passed once)
  let k = 0, last = -Infinity;
  return hits.filter(([a, b]) => {
    if (a < last) k = 0;
    last = a;
    while (k < del.length && del[k][1] <= a) k++;
    // (the first deletion ending after the place's start: it overlaps unless it starts after its end)
    return !(k < del.length && del[k][0] < b);
  });
}

/** Where a found range ends up after the ranges before it were replaced (for keeping the selection on the next one). */
export function shiftAfter(hits: [number, number][], replacement: string, keep: boolean, at: number): number {
  if (keep) return at;
  let d = 0;
  for (const [a, b] of hits) if (b <= at) d += replacement.length - (b - a);
  return at + d;
}
