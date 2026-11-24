// The flags put on a compound's fields on the SI page (Flag for Checking: who, when, what to
// check), as Word comments on the text each field prints in the compiled SI: always in the Word
// snapshot kept in the project folder, and in Compile to Document and PDF when asked for. A flag
// on a field that prints nothing (a private note, the spectra) goes on the compound's heading.

import type { DocText } from '../document/document';
import { markComment, nextCommentId, type CommentThread } from '../document/comments';
import * as rt from '../richtext';
import { fieldDef } from './fields';
import type { Json, SiProject } from './project';
import { compoundSrc, fieldOfSrc, type SourceBlock, type SourceSpan } from './source-map';

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What a flag's comment says: the field's name and what to check. */
export function flagCommentText(fieldKey: string, comment: string): string {
  const label = fieldDef({ key: fieldKey })?.label ?? fieldKey;
  return `Flagged for checking (${label}): ${comment.trim() || 'no comment given'}`;
}

/** The document with each compound's flags as comments on the text their fields print (`sources` say where). */
export function addFlagComments(doc: DocText, sources: readonly SourceSpan[], blocks: readonly SourceBlock[], p: SiProject): DocText {
  const text = rt.plainText(doc.runs);
  let runs = doc.runs;
  const comments: Record<number, CommentThread> = { ...(doc.comments ?? {}) };
  let id = nextCommentId(comments);
  for (const c of p.compounds) {
    const flags = c.data.flags;
    if (!isObj(flags)) continue;
    const block = blocks.find((b) => b.node === `compound:${c.id}`);
    if (!block) continue;
    const inside = (s: SourceSpan): boolean => s.start >= block.start && s.end <= block.end;
    for (const [key, f] of Object.entries(flags)) {
      if (!isObj(f)) continue;
      const field = compoundSrc(c.id, key);
      const mine = sources.filter((s) => inside(s) && fieldOfSrc(s.src) === field).sort((a, b) => a.start - b.start);
      let range: { start: number; end: number } | null = null;
      if (mine.length) {
        // (its first paragraph's text: a field printed in two places, as a yield in the procedure and in the data, is commented where it prints first)
        const first = mine[0];
        const para = mine.filter((s) => !text.slice(first.start, s.start).includes('\n'));
        range = { start: first.start, end: Math.max(...para.map((s) => s.end)) };
      } else {
        // (a field that prints nothing: on the compound's name in its heading, else the start of its text)
        const name = sources.find((s) => inside(s) && s.src === compoundSrc(c.id, 'name', 'text'));
        range = name ? { start: name.start, end: name.end } : block.end > block.start ? { start: block.start, end: Math.min(block.end, block.start + 1) } : null;
      }
      if (!range || range.end <= range.start) continue;
      const at = str(f.at);
      comments[id] = { author: str(f.by) || 'SI flag', date: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString(), text: flagCommentText(key, str(f.comment)) };
      runs = markComment(runs, range.start, range.end, id);
      id++;
    }
  }
  return id === nextCommentId(doc.comments) ? doc : { ...doc, runs, comments };
}
