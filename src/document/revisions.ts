// Tracked changes (Review > Track Changes, as in Word). While tracking is on, text typed or
// pasted is kept marked as inserted, and text deleted stays in place marked as deleted (shown
// struck through) until someone accepts or rejects the change. Each mark says who made the
// change and when. The marks are saved as Word's own (w:ins and w:del), so Word shows them as
// tracked changes too, and Word's come back here the same way.
//
// A mark is stored on the text run as a short string, "ins|Nate|2026-10-14T21:00:00Z", so runs
// with the same mark join up and compare simply.

import type { ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { cleanPara, editParas, fitParas, paraCount } from '../text/paragraphs';

export type RevKind = 'ins' | 'del';

export interface Revision {
  kind: RevKind;
  author: string;
  /** When, as an ISO date and time (Word's w:date). */
  date: string;
  /**
   * Text moved: the move's name (Word's w:name on its move ranges), the same on the deletion where
   * it was (moved from) and the insertion where it went (moved to), so Word shows them as one move.
   */
  move?: string;
}

/** The name put on changes made here (Edit > Settings, or asked the first time tracking is turned on). */
let author = '';
export const reviewAuthor = (): string => author;
export function setReviewAuthor(name: string): void {
  author = name.trim();
}

/** Whether formatting changes are tracked too (Review > Track Changes options; on, as in Word). */
let formatting = true;
export const trackingFormatting = (): boolean => formatting;
export function setTrackFormatting(on: boolean): void {
  formatting = on;
}

/** Now, as Word writes it on a change (to the second, in UTC). */
export const revisionDate = (d = new Date()): string => d.toISOString().replace(/\.\d+Z$/, 'Z');

/** A revision as stored on a run. */
export function revText(r: Revision): string {
  return `${r.kind}|${r.author.replace(/\|/g, '/')}|${r.date}${r.move ? `|${r.move.replace(/\|/g, '/')}` : ''}`;
}

/** A run's revision, or null. */
export function parseRev(s: string | undefined): Revision | null {
  if (!s) return null;
  const [kind, author = '', date = '', move] = s.split('|');
  return kind === 'ins' || kind === 'del' ? { kind, author, date, ...(move ? { move } : {}) } : null;
}

/** Something with text in runs and a style for each paragraph (a document, or a part of one). */
export interface Revisable { runs: TextRun[]; paras: ParaStyle[] }

/** Every change, in order: where it is, what kind, who and when, and its text. Neighbouring runs with the same mark are one change. */
export interface Change { kind: RevKind | 'fmt'; author: string; date: string; start: number; end: number; text: string }

/** What a change is, as a menu or message names it. */
export const changeName = (kind: Change['kind']): string => (kind === 'ins' ? 'Insertion' : kind === 'del' ? 'Deletion' : 'Formatting change');

export function changesIn(runs: TextRun[]): Change[] {
  const out: Change[] = [];
  let at = 0;
  for (const r of runs) {
    const f = parseFmt(r.fmt);
    const v: Omit<Change, 'start' | 'end' | 'text'> | null = parseRev(r.rev) ?? (f ? { kind: 'fmt', author: f.author, date: f.date } : null);
    const end = at + r.text.length;
    if (v) {
      const last = out[out.length - 1];
      if (last && last.end === at && last.kind === v.kind && last.author === v.author) { last.end = end; last.text += r.text; }
      else out.push({ ...v, start: at, end, text: r.text });
    }
    at = end;
  }
  return out;
}

/** Delete text between two places for real, keeping the paragraphs' styles in step. */
function cut<T extends Revisable>(t: T, start: number, end: number): T {
  if (end <= start) return t;
  const text = rt.plainText(t.runs);
  return { ...t, runs: rt.replaceRange(t.runs, start, end, []), paras: editParas(t.paras, text, start, end, '') };
}

/** Put runs in at a place for real. */
function put<T extends Revisable>(t: T, at: number, runs: TextRun[], paras?: ParaStyle[]): T {
  const text = rt.plainText(t.runs);
  return { ...t, runs: rt.replaceRange(t.runs, at, at, runs), paras: editParas(t.paras, text, at, at, rt.plainText(runs), paras) };
}

/** The pieces of the text between two places, each with its offset. */
function pieces(runs: TextRun[], start: number, end: number): { start: number; end: number; rev: Revision | null }[] {
  const out: { start: number; end: number; rev: Revision | null }[] = [];
  let at = 0;
  for (const r of runs) {
    const a = Math.max(start, at), b = Math.min(end, at + r.text.length);
    if (b > a) out.push({ start: a, end: b, rev: parseRev(r.rev) });
    at += r.text.length;
  }
  return out;
}

/**
 * An edit made while changes are tracked: the text between `start` and `end` is marked deleted
 * (text already inserted while tracking just goes, and text already deleted stays as it was),
 * and `runs` go in after it, marked inserted. Returns the new text, where the caret goes (after
 * what was put in), and how much of the range stayed (as deleted text).
 */
export function trackedReplace<T extends Revisable>(t: T, start: number, end: number, runs: TextRun[], paras: ParaStyle[] | undefined, who: { author: string; date: string }): { t: T; caret: number; kept: number } {
  t = { ...t, paras: fitParas(t.paras, paraCount(rt.plainText(t.runs))) };
  const ps = pieces(t.runs, start, end);
  // inserted text goes for real (from the end back, so earlier places stay put)
  for (const p of [...ps].reverse()) if (p.rev?.kind === 'ins') t = cut(t, p.start, p.end);
  const kept = ps.filter((p) => p.rev?.kind !== 'ins').reduce((a, p) => a + p.end - p.start, 0);
  // the rest is marked deleted, keeping the marks of text deleted before
  if (kept) {
    const del = revText({ kind: 'del', ...who });
    const n = rt.plainText(t.runs).length;
    const mid = rt.sliceRuns(t.runs, start, start + kept).map((r) => (parseRev(r.rev)?.kind === 'del' ? r : { ...r, rev: del }));
    t = { ...t, runs: rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, start), ...mid, ...rt.sliceRuns(t.runs, start + kept, n)]) };
  }
  const at = start + kept;
  const insert = runs.filter((r) => r.text).map((r) => ({ ...r, rev: revText({ kind: 'ins', ...who }) }));
  if (insert.length) t = put(t, at, insert, paras);
  return { t, caret: at + rt.plainText(insert).length, kept };
}

/**
 * Accept (or reject) the changes between two places (all of them when not given): accepting
 * keeps inserted text and takes deleted text away; rejecting does the opposite. A change only
 * partly inside the range is decided for the part inside.
 */
export function decide<T extends Revisable>(t: T, accept: boolean, start = 0, end = Infinity): T {
  const text = rt.plainText(t.runs);
  const paras = fitParas(t.paras, paraCount(text));
  // formatting changes first (they don't move the text)
  const runs = decideFormatting(t.runs, accept, start, end);
  if (!runs.some((r) => r.rev)) return { ...t, runs, paras };
  // one walk over the runs: a change kept loses its mark, one decided against goes (deleted text
  // when accepting, inserted text when rejecting); a change only partly inside is cut at the edge
  const lo = Math.max(0, start), hi = Math.min(text.length, end);
  const out: TextRun[] = [];
  const gone: [number, number][] = [];
  let at = 0;
  for (const r of runs) {
    const len = r.text.length;
    const a = Math.max(lo, at), b = Math.min(hi, at + len);
    const rev = b > a ? parseRev(r.rev) : null;
    if (!rev) { out.push(r); at += len; continue; }
    if (a > at) out.push({ ...r, text: r.text.slice(0, a - at) });
    if ((rev.kind === 'del') === accept) gone.push([a, b]);
    else { const { rev: _r, ...rest } = r; out.push({ ...rest, text: r.text.slice(a - at, b - at) }); }
    if (at + len > b) out.push({ ...r, text: r.text.slice(b - at) });
    at += len;
  }
  return { ...t, runs: rt.normalizeRuns(out), paras: joinCutParas(paras, text, gone) };
}

/**
 * The paragraphs' styles once the text in each of `gone` (in order, not overlapping) is taken
 * away, as cutting each from the end back does (text/paragraphs.ts editParas): paragraphs that a
 * cut joins take the style of the first, which also takes the index entries and marked citations
 * of the last.
 */
function joinCutParas(paras: ParaStyle[], text: string, gone: [number, number][]): ParaStyle[] {
  if (!gone.length) return paras;
  // each cut's first and last paragraph, in one walk over the line breaks
  const ends: [number, number][] = [];
  let para = 0, nl = text.indexOf('\n');
  const paraOf = (x: number) => { while (nl >= 0 && nl < x) { para++; nl = text.indexOf('\n', nl + 1); } return para; };
  for (const [a, b] of gone) { const pa = paraOf(a); ends.push([pa, paraOf(b)]); }
  const ps: (ParaStyle | null)[] = [...paras];
  for (let i = ends.length - 1; i >= 0; i--) {
    const [a, b] = ends[i];
    if (b <= a) continue;
    const base = ps[a]!, last = ps[b];
    ps[a] = last && (last.xe || last.ta) ? cleanPara({ ...base, xe: [...(base.xe ?? []), ...(last.xe ?? [])], ta: [...(base.ta ?? []), ...(last.ta ?? [])] }) : base;
    for (let q = a + 1; q <= b; q++) ps[q] = null;
  }
  return ps.filter((p): p is ParaStyle => p !== null);
}

/** Text inside a document's objects: text boxes and table cells. */
type InnerText = { runs: TextRun[]; paras?: ParaStyle[] };
type WithObjects = Revisable & { objects: Record<number, { kind: string; runs?: TextRun[]; paras?: ParaStyle[]; table?: { rows: InnerText[][] } }> };

/** Every piece of text in a document's objects: each text box's, footnote's and endnote's, and table cell's. */
function innerTexts(t: WithObjects): InnerText[] {
  const out: InnerText[] = [];
  for (const o of Object.values(t.objects)) {
    // (footnotes and endnotes are tracked like the text: editNote)
    if ((o.kind === 'textbox' || o.kind === 'note') && o.runs) out.push(o as InnerText);
    else if (o.kind === 'table' && o.table) for (const row of o.table.rows) out.push(...row);
  }
  return out;
}

/** How many changes the document has, with those in text boxes, notes and table cells. */
export function countChanges(t: WithObjects): number {
  return changesIn(t.runs).length + innerTexts(t).reduce((n, x) => n + changesIn(x.runs).length, 0);
}

/** Accept (or reject) every change in the document, in text boxes, notes and table cells too. */
export function decideEverywhere<T extends WithObjects>(t: T, accept: boolean): T {
  const inner = <X extends InnerText>(x: X): X => {
    if (!changesIn(x.runs).length) return x;
    const d = decide({ runs: x.runs, paras: x.paras ?? [] }, accept);
    return { ...x, runs: d.runs, ...(x.paras ? { paras: d.paras } : {}) };
  };
  const objects: WithObjects['objects'] = {};
  for (const [k, o] of Object.entries(t.objects)) {
    if ((o.kind === 'textbox' || o.kind === 'note') && o.runs) objects[+k] = inner(o as typeof o & InnerText);
    else if (o.kind === 'table' && o.table) objects[+k] = { ...o, table: { ...o.table, rows: o.table.rows.map((row) => row.map(inner)) } };
    else objects[+k] = o;
  }
  return decide({ ...t, objects }, accept);
}

/** The text with every change accepted (as it will read). */
export const accepted = <T extends Revisable>(t: T): T => decide(t, true);

/** Does the text have tracked changes? */
export const hasChanges = (runs: TextRun[]): boolean => runs.some((r) => r.rev || r.fmt);

/** Colours for each person's changes (Word's order: the first person red, then blue, green…). */
export const REVIEW_COLOURS = ['#c00000', '#1f5fbf', '#2e7d32', '#8e24aa', '#ef6c00', '#00838f', '#ad1457', '#5d4037'];

/** Each author's colour, in the order they first appear in the text. */
export function authorColours(runs: TextRun[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of runs) {
    for (const who of [parseRev(r.rev)?.author, parseFmt(r.fmt)?.author]) {
      if (who !== undefined && !out.has(who)) out.set(who, REVIEW_COLOURS[out.size % REVIEW_COLOURS.length]);
    }
  }
  return out;
}

/** The runs as shown with changes marked: inserted text underlined, deleted text struck through, each in its author's colour. */
export function markedRuns(runs: TextRun[], colours = authorColours(runs)): TextRun[] {
  return runs.map((r) => {
    const v = parseRev(r.rev);
    if (!v) {
      // a formatting change: the text in its author's colour
      const f = parseFmt(r.fmt);
      return f && r.obj === undefined ? { ...r, color: colours.get(f.author) ?? REVIEW_COLOURS[0] } : r;
    }
    const color = colours.get(v.author) ?? REVIEW_COLOURS[0];
    // a figure keeps its own look; its line still shows the change
    if (r.obj !== undefined) return r;
    return v.kind === 'ins' ? { ...r, color, underline: true } : { ...r, color, strike: true };
  });
}

// ------------------------------------------------------------------ formatting changes

/** A formatting change: who made it, when, and how the text looked before (its run style). */
export interface FormatChange { author: string; date: string; old: rt.RunStyle }

/** The style keys a formatting change records (the look, not the text's marks: changes, comments, links, figures). */
const lookOf = (s: rt.RunStyle): rt.RunStyle => {
  const { rev: _r, fmt: _f, cmt: _c, link: _l, obj: _o, hide: _h, ...rest } = s;
  return rt.cleanStyle(rest);
};

export function fmtText(f: FormatChange): string {
  return `${f.author.replace(/\|/g, '/')}|${f.date}|${JSON.stringify(lookOf(f.old))}`;
}

export function parseFmt(s: string | undefined): FormatChange | null {
  if (!s) return null;
  const a = s.indexOf('|'), b = s.indexOf('|', a + 1);
  if (a < 0 || b < 0) return null;
  let old: rt.RunStyle = {};
  try { old = JSON.parse(s.slice(b + 1)) as rt.RunStyle; } catch { /* an unreadable mark: no look before */ }
  return { author: s.slice(0, a), date: s.slice(a + 1, b), old };
}

/**
 * Formatting changed while changes are tracked: the text between `start` and `end` of `after`
 * whose look differs from `before` is marked with who changed it and how it looked (the look
 * before the first change, when it was changed again; no mark when it is back as it was). Text
 * inserted while tracking needs no mark (rejecting takes it away anyway).
 */
export function trackFormatting(before: TextRun[], after: TextRun[], start: number, end: number, who: { author: string; date: string }): TextRun[] {
  const cuts = new Set<number>([start, end]);
  let at = 0;
  for (const r of before) { at += r.text.length; cuts.add(at); }
  at = 0;
  for (const r of after) { at += r.text.length; cuts.add(at); }
  const marks = [...cuts].filter((x) => x >= start && x <= end).sort((x, y) => x - y);
  const mid: TextRun[] = [];
  // each stretch between two cuts lies in one run of each: walk both lists once
  let bi = 0, bAt = 0, ai = 0, aAt = 0;
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    while (bi < before.length && bAt + before[bi].text.length <= a) bAt += before[bi++].text.length;
    while (ai < after.length && aAt + after[ai].text.length <= a) aAt += after[ai++].text.length;
    const was = bi < before.length ? before[bi] : undefined;
    const here = ai < after.length ? [{ ...after[ai], text: after[ai].text.slice(a - aAt, b - aAt) }] : [];
    for (const r of here) {
      if (!was || r.obj !== undefined || parseRev(r.rev)?.kind === 'ins') { mid.push(r); continue; }
      const first = parseFmt(was.fmt)?.old ?? lookOf(rt.styleOf(was));
      const same = rt.sameStyle(first, lookOf(rt.styleOf(r)));
      const { fmt: _f, ...rest } = r;
      mid.push(same ? rest : { ...rest, fmt: fmtText({ ...who, old: first }) });
    }
  }
  const n = rt.plainText(after).length;
  return rt.normalizeRuns([...rt.sliceRuns(after, 0, start), ...mid, ...rt.sliceRuns(after, end, n)]);
}

/** Accept (keep the new look) or reject (put back the old look) the formatting changes between two places. */
export function decideFormatting(runs: TextRun[], accept: boolean, start = 0, end = Infinity): TextRun[] {
  if (!runs.some((r) => r.fmt)) return runs;
  const n = rt.plainText(runs).length;
  const a = Math.max(0, start), b = Math.min(n, end);
  const mid = rt.sliceRuns(runs, a, b).map((r) => {
    const f = parseFmt(r.fmt);
    if (!f) return r;
    const { fmt: _f, ...rest } = r;
    if (accept) return rest;
    // the marks stay (changes, comments, links); the look goes back
    const keep: rt.RunStyle = { rev: r.rev, cmt: r.cmt, link: r.link, obj: r.obj };
    return { ...rt.cleanStyle({ ...keep, ...f.old }), text: r.text } as TextRun;
  });
  return rt.normalizeRuns([...rt.sliceRuns(runs, 0, a), ...mid, ...rt.sliceRuns(runs, b, n)]);
}

// ------------------------------------------------------------------ markup views

/**
 * How tracked changes show (Review > Display for Review, as in Word): All Markup marks every
 * change in its author's colour; Simple Markup shows the text as it will read with a bar in the
 * margin by each changed line; No Markup shows it as it will read; Original shows it as it was.
 * Reviewers can be hidden: their changes show as in Simple Markup.
 */
export type MarkupView = 'all' | 'simple' | 'none' | 'original';

export interface ReviewView {
  mode: MarkupView;
  /** Reviewers whose changes aren't marked. */
  hidden?: string[];
  /** Show insertions and deletions, and formatting changes (Show Markup). */
  insDel?: boolean;
  formatting?: boolean;
}

export const ALL_MARKUP: ReviewView = { mode: 'all' };

/** The runs as a markup view shows them: changes marked, hidden (laid out with no width) or plain. */
export function showChanges(runs: TextRun[], view: ReviewView = ALL_MARKUP, colours = authorColours(runs)): TextRun[] {
  if (view.mode === 'all' && !view.hidden?.length && view.insDel !== false && view.formatting !== false) return markedRuns(runs, colours);
  return runs.map((r) => {
    const v = parseRev(r.rev);
    const f = parseFmt(r.fmt);
    if (!v && !f) return r;
    let out: TextRun = r;
    if (view.mode === 'original' && f) out = { ...rt.cleanStyle({ ...f.old, rev: r.rev, cmt: r.cmt, link: r.link, obj: r.obj }), text: r.text } as TextRun;
    if (v) {
      const marked = view.mode === 'all' && view.insDel !== false && !view.hidden?.includes(v.author);
      // the text as it will read (deleted text hidden), or as it was (inserted text hidden)
      const gone = view.mode === 'original' ? v.kind === 'ins' : v.kind === 'del';
      if (marked) out = markedRuns([out], colours)[0];
      else if (gone && out.obj === undefined) out = { ...out, hide: true };
    }
    if (f && view.mode === 'all' && view.formatting !== false && !view.hidden?.includes(f.author) && !out.hide) out = { ...out, color: colours.get(f.author) ?? REVIEW_COLOURS[0] };
    return out;
  });
}

/** Every reviewer with changes in the runs, in the order they first appear. */
export const reviewers = (runs: TextRun[]): string[] => [...authorColours(runs).keys()];
