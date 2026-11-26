// The flags put on a compound's fields on the SI page (Flag for Checking: who, when, what to
// check), as Word comments on the text each field prints in the compiled SI: always in the Word
// snapshot kept in the project folder, and in Compile to Document and PDF when asked for. A flag
// on a field that prints nothing (a private note, the spectra) goes on the compound's heading.

import type { DocText } from '../document/document';
import { markComment, nextCommentId, type CommentThread } from '../document/comments';
import * as rt from '../richtext';
import { fieldDef } from './fields';
import { parseAnchor } from './flag-threads';
import type { SiProject } from './project';
import { compoundSrc, fieldOfSrc, type SourceBlock, type SourceSpan } from './source-map';


/** What a flag's comment says: the field's name and what to check. */
export function flagCommentText(fieldKey: string, comment: string): string {
  const label = fieldDef({ key: fieldKey })?.label ?? fieldKey;
  return `Flagged for checking (${label}): ${comment.trim() || 'no comment given'}`;
}

/** Who wrote a note, and when, as a comment has them. */
const noteOf = (by: string, at: string, text: string): { author: string; date: string; text: string } =>
  ({ author: by || 'SI flag', date: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(), text });

/**
 * The document with the flags as comments (with their replies): a compound's on the text its field
 * prints, a section's on its heading. Resolved flags only with `withResolved`, marked done. Each
 * comment's anchor (flag-threads.ts) is in `anchors`, by comment id, when given.
 */
export function addFlagComments(doc: DocText, sources: readonly SourceSpan[], blocks: readonly SourceBlock[], p: SiProject, opts: { withResolved?: boolean; anchors?: Map<number, string> } = {}): DocText {
  const text = rt.plainText(doc.runs);
  let runs = doc.runs;
  const comments: Record<number, CommentThread> = { ...(doc.comments ?? {}) };
  let id = nextCommentId(comments);
  for (const fl of p.allFlags()) {
    if (fl.resolved && !opts.withResolved) continue;
    const at = parseAnchor(fl.anchor);
    if (!at) continue;
    let range: { start: number; end: number } | null = null;
    let label = '';
    if (at.kind === 'section') {
      // (on the section's heading: the first line of its text)
      const block = blocks.find((b) => b.node === `section:${at.id}`);
      if (!block || block.end <= block.start) continue;
      const nl = text.indexOf('\n', block.start);
      range = { start: block.start, end: nl >= block.start && nl < block.end ? Math.max(nl, block.start + 1) : block.end };
      label = fl.isFlag ? 'Flagged for checking: ' : '';
    } else {
      const block = blocks.find((b) => b.node === `compound:${at.id}`);
      if (!block) continue;
      const inside = (s: SourceSpan): boolean => s.start >= block.start && s.end <= block.end;
      const field = compoundSrc(at.id, at.field);
      const mine = sources.filter((s) => inside(s) && fieldOfSrc(s.src) === field).sort((a, b) => a.start - b.start);
      if (mine.length) {
        // (its first paragraph's text: a field printed in two places, as a yield in the procedure and in the data, is commented where it prints first)
        const first = mine[0];
        const para = mine.filter((s) => !text.slice(first.start, s.start).includes('\n'));
        range = { start: first.start, end: Math.max(...para.map((s) => s.end)) };
      } else {
        // (a field that prints nothing: on the compound's name in its heading, else the start of its text)
        const name = sources.find((s) => inside(s) && s.src === compoundSrc(at.id, 'name', 'text'));
        range = name ? { start: name.start, end: name.end } : block.end > block.start ? { start: block.start, end: Math.min(block.end, block.start + 1) } : null;
      }
    }
    if (!range || range.end <= range.start) continue;
    const words = at.kind === 'section' ? label + (fl.flag.comment.trim() || 'no comment given') : fl.isFlag ? flagCommentText(at.field, fl.flag.comment) : fl.flag.comment;
    const main = noteOf(fl.flag.by, fl.flag.at, words);
    const replies = fl.thread.replies.map((r) => noteOf(r.by, r.at, r.text));
    comments[id] = { ...main, ...(replies.length ? { replies } : {}), ...(fl.resolved ? { done: true } : {}) };
    opts.anchors?.set(id, fl.anchor);
    runs = markComment(runs, range.start, range.end, id);
    id++;
  }
  return id === nextCommentId(doc.comments) ? doc : { ...doc, runs, comments };
}
