// View > Outline View: each slide's title and the lines of its body text (or a title slide's
// subtitle), as an outline. Reading a slide into it and writing an edited outline back; a
// line's level is how far in it is (tabs at its start in the outline's text).

import type { Caption, Doc, ParaStyle, TextRun } from '../model';
import { normalizeRuns, plainText, retextRuns, styleOf } from '../richtext';

export interface OutlineLine { text: string; level: number }
export interface SlideOutline {
  /** The title (null: the slide has no title placeholder). */
  title: string | null;
  /** The body's lines (null: no body or subtitle placeholder). */
  body: OutlineLine[] | null;
}

const plain = (c: Caption) => c.runs.map((r) => r.text).join('');
const titleOf = (doc: Doc) => [...doc.captions.values()].find((c) => c.ph === 'title');
/** The body placeholder, or the subtitle on a title slide; the first, top left first, when there are two. */
const bodyOf = (doc: Doc) => [...doc.captions.values()].filter((c) => c.ph === 'body' || c.ph === 'subtitle').sort((a, b) => a.x - b.x || a.y - b.y)[0];

/** A slide's title and body lines. */
export function slideOutline(doc: Doc): SlideOutline {
  const t = titleOf(doc), b = bodyOf(doc);
  const body = b ? plain(b).split('\n').map((text, i) => ({ text, level: b.paras?.[i]?.level ?? 0 })) : null;
  // an empty body is no lines (not one empty line)
  return { title: t ? plain(t).replace(/\n/g, ' ') : null, body: body && body.length === 1 && !body[0].text ? [] : body };
}

/** Body lines as the outline's text: one a line, a tab in for each level. */
export const outlineText = (lines: OutlineLine[]): string => lines.map((l) => '\t'.repeat(l.level) + l.text).join('\n');

/** The outline's text back into lines (tabs, or four spaces, at a line's start are its level; at most eight levels). */
export function parseOutline(text: string): OutlineLine[] {
  if (!text) return [];
  return text.split('\n').map((line) => {
    const m = /^((?:\t| {4})*)/.exec(line)![1];
    const level = Math.min(8, (m.match(/\t/g)?.length ?? 0) + (m.match(/ {4}/g)?.length ?? 0));
    return { text: line.slice(m.length), level };
  });
}

/** The looks Outline View shows and sets on characters (Ctrl+B, Ctrl+I, Ctrl+U), as PowerPoint's outline does. */
export interface OutlineLook { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; sub?: boolean; sup?: boolean }
const LOOK_KEYS = ['bold', 'italic', 'underline', 'strike', 'sub', 'sup'] as const;

/** Each character's look in some runs. */
function charLooks(runs: TextRun[]): OutlineLook[] {
  const out: OutlineLook[] = [];
  for (const r of runs) {
    const l: OutlineLook = {};
    for (const k of LOOK_KEYS) if (r[k]) l[k] = true;
    for (let i = 0; i < r.text.length; i++) out.push(l);
  }
  return out;
}

/** The look of each character of a slide's title, and of each body line (as slideOutline gives them). */
export function outlineLooks(doc: Doc): { title: OutlineLook[] | null; body: OutlineLook[][] | null } {
  const t = titleOf(doc), b = bodyOf(doc);
  let body: OutlineLook[][] | null = null;
  if (b) {
    const all = charLooks(b.runs);
    let at = 0;
    body = plain(b).split('\n').map((line) => { const l = all.slice(at, at + line.length); at += line.length + 1; return l; });
    if (body.length === 1 && !body[0].length) body = [];
  }
  return { title: t ? charLooks(t.runs) : null, body };
}

/** Runs with these looks on their characters (the rest of each character's look as it is). */
function withLooks(runs: TextRun[], looks: (OutlineLook | undefined)[]): TextRun[] {
  const text = plainText(runs);
  const out: TextRun[] = [];
  let at = 0;
  for (const r of runs) {
    for (let i = 0; i < r.text.length; i++, at++) {
      const l = looks[at];
      const c: TextRun = { ...r, text: text[at] };
      if (l) for (const k of LOOK_KEYS) { if (l[k]) c[k] = true; else delete c[k]; }
      // (a character is lowered or raised, never both)
      if (c.sub && c.sup) delete c.sup;
      if ((c.sub || c.sup) && c.formula) delete c.formula;
      out.push(c);
    }
  }
  return normalizeRuns(out);
}

const sameRuns = (a: TextRun[], b: TextRun[]) => JSON.stringify(normalizeRuns(a)) === JSON.stringify(normalizeRuns(b));

/**
 * Write a title and body lines into a slide's placeholders (inside an edit of `doc`). Only what
 * changed is written, so a placeholder's own formatting stays when its text did not change.
 * `looks` (from Outline View) gives each character's bold, italic, underline and position, by
 * the title's characters and by each body line's. Returns whether anything changed.
 */
export function applyOutline(doc: Doc, title: string | null, body: OutlineLine[] | null, looks?: { title?: OutlineLook[]; body?: OutlineLook[][] }): boolean {
  const was = slideOutline(doc);
  let changed = false;
  const t = titleOf(doc);
  if (t && title !== null) {
    // (the characters that stayed keep their own look: an italic word in a title stays italic)
    let runs = title !== was.title ? (title ? retextRuns(t.runs, title, t.runs[0] ? styleOf(t.runs[0]) : {}) : []) : t.runs;
    if (looks?.title) runs = withLooks(runs, looks.title);
    if (!sameRuns(runs, t.runs)) { doc.updateCaption(t.id, { runs }); changed = true; }
  }
  const b = bodyOf(doc);
  if (b && body !== null) {
    const style = b.runs[0] ? { ...b.runs[0] } : {};
    const text = body.map((l) => l.text).join('\n');
    const retexted = outlineText(body) !== outlineText(was.body ?? []);
    let runs = !retexted ? b.runs : text ? (b.runs.length ? retextRuns(b.runs, text, style) : [{ ...style, text }]) : [];
    if (looks?.body) runs = withLooks(runs, looks.body.flatMap((l, i) => [...l, ...(i < looks.body!.length - 1 ? [undefined] : [])]));
    if (retexted) {
      // each line keeps its old paragraph's look (a bullet, for body text), at its new level
      const paras: ParaStyle[] = body.map((l, i) => {
        const old = b.paras?.[i] ?? b.paras?.[b.paras.length - 1] ?? (b.ph === 'body' ? { list: 'bullet' as const } : {});
        const p: ParaStyle = { ...old };
        if (l.level) p.level = l.level; else delete p.level;
        return p;
      });
      doc.updateCaption(b.id, { runs, paras: paras.length ? paras : b.ph === 'body' ? [{ list: 'bullet' }] : undefined });
      changed = true;
    } else if (!sameRuns(runs, b.runs)) { doc.updateCaption(b.id, { runs }); changed = true; }
  }
  return changed;
}
