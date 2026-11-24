// Typing in the Live Preview: what an edit of the compiled document is (a change to a field's
// value, text of the person's own between the fields, or a change to text the program makes,
// which is refused), and the field's new stored value it makes.
//
// The text a field prints is its stored value, formatted: subscripts and superscripts, en
// dashes in ranges, markup taken out, words the program adds around it. The two are lined up
// character by character (a diff), so a change to the printed text is made at the same place in
// the stored value; a change that touches only what the program added is refused.

import { escapeMarkup } from './markup';
import { editableSrc, parseSrc, type SourceSpan } from './source-map';

/** What an edit of the preview's text at [start, end) is. */
export type EditKind =
  | { kind: 'field'; src: string }
  | { kind: 'custom'; at: number }
  | { kind: 'locked'; src: string }
  /** It runs over more than one source (a field and the text after it): refused. */
  | { kind: 'across' };

/** Sources whose stored value is the markup text format (escaped when typed into). */
export function markupSrc(src: string): boolean {
  const s = parseSrc(src);
  if (!s) return false;
  return s.path === '@text' || s.path.startsWith('values.') || (s.owner === 'c' && (s.field === 'nmr' || s.field === 'references' || s.field === 'name'));
}

/** Whether a source's value can hold more than one paragraph (a text kept in its own file). */
export const manyParagraphs = (src: string): boolean => parseSrc(src)?.path === '@text';

const CUSTOM = 'custom:';
/** Custom text (the person's own, typed between fields) is a source of its own: "custom:<item id>". */
export const customSrc = (id: string): string => CUSTOM + id;
export const isCustomSrc = (src: string): boolean => src.startsWith(CUSTOM);
export const customIdOf = (src: string): string => src.slice(CUSTOM.length);

/**
 * What an edit replacing [start, end) of the preview's text (`text`) with `typed` is. Typing at
 * the edge of a field goes into it (after the yield's "91" types more of the yield), except at a
 * field's start just after a space no field holds (the start of a sentence: a new sentence typed
 * there is the person's own); text typed outside every field is the person's own (custom text).
 */
export function editKind(spans: readonly SourceSpan[], start: number, end: number, typed: string, text = ''): EditKind {
  const writable = (src: string): boolean => editableSrc(src) || isCustomSrc(src);
  const lineOk = (src: string): boolean => !typed.includes('\n') || manyParagraphs(src) || isCustomSrc(src);
  if (end > start) {
    const over = spans.filter((s) => s.start < end && s.end > start);
    const srcs = [...new Set(over.map((s) => s.src))];
    if (!over.length) {
      // (a paragraph's end between two paragraphs of one field: joins them; else words Chemweave writes, a heading or the layout)
      const a = spans.find((x) => x.end === start), b = spans.find((x) => x.start === end);
      if (!typed && end === start + 1 && text[start] === '\n' && a && b && a.src === b.src && manyParagraphs(a.src) && editableSrc(a.src)) return { kind: 'field', src: a.src };
      return { kind: 'locked', src: '' };
    }
    if (srcs.length > 1) {
      const locked = over.find((s) => !writable(s.src));
      return locked ? { kind: 'locked', src: locked.src } : { kind: 'across' };
    }
    const src = srcs[0];
    // (part of it in a field and part outside every field: across)
    const inside = over.every((s) => s.start <= start && end <= s.end) || (start >= Math.min(...over.map((s) => s.start)) && end <= Math.max(...over.map((s) => s.end)) && !gapIn(spans, start, end));
    if (!inside) return writable(src) ? { kind: 'across' } : { kind: 'locked', src };
    if (!writable(src)) return { kind: 'locked', src };
    return lineOk(src) ? { kind: 'field', src } : { kind: 'locked', src };
  }
  const at = start;
  const within = spans.find((s) => s.start < at && at < s.end);
  if (within) {
    if (!writable(within.src)) return { kind: 'locked', src: within.src };
    return lineOk(within.src) ? { kind: 'field', src: within.src } : { kind: 'locked', src: within.src };
  }
  const before = spans.find((s) => s.end === at);
  const after = spans.find((s) => s.start === at);
  if (before && writable(before.src) && lineOk(before.src)) return { kind: 'field', src: before.src };
  const sentenceStart = !before && at > 0 && /\s/.test(text[at - 1] ?? '') && text[at - 1] !== '\n';
  if (after && !sentenceStart && writable(after.src) && lineOk(after.src)) return { kind: 'field', src: after.src };
  return { kind: 'custom', at };
}

/** Is any character of [start, end) outside every span? */
function gapIn(spans: readonly SourceSpan[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (!spans.some((s) => s.start <= i && i < s.end)) return true;
  return false;
}

/**
 * A diff of `a` and `b` (Myers, O((n+m)·d)): for each character of `b`, the character of `a` it
 * is (-1 for one only in `b`). A run of characters taken out of `a` next to a run put in `b` is
 * read as those characters changed one for one (a hyphen printed as an en dash, a lower-case
 * letter capitalized), so they still line up.
 */
export function lineUp(a: string, b: string): number[] {
  const out = new Array<number>(b.length).fill(-1);
  // (what is the same at both ends lines up as it is: the diff is of the middle)
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) { out[pre] = pre; pre++; }
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) { out[b.length - 1 - suf] = a.length - 1 - suf; suf++; }
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length;
  if (!n || !m) return out;
  const max = n + m, off = max + 1;
  const V = new Int32Array(2 * max + 3);
  V[off + 1] = 0;
  // each round's values before it (only the diagonals it can reach), to walk back
  const trace: { lo: number; v: Int32Array }[] = [];
  let D = -1;
  for (let d = 0; d <= max && D < 0; d++) {
    trace.push({ lo: -d - 1, v: V.slice(off - d - 1, off + d + 2) });
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      V[off + k] = x;
      if (x >= n && y >= m) { D = d; break; }
    }
  }
  type Step = 0 | 1 | 2; // same, taken out of A, put in B
  const steps: Step[] = [];
  let x = n, y = m;
  for (let d = D; d >= 0; d--) {
    const t = trace[d];
    const get = (k: number): number => t.v[k - t.lo];
    const k = x - y;
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = d === 0 ? 0 : get(pk), py = d === 0 ? 0 : px - pk;
    while (x > px && y > py) { steps.push(0); x--; y--; }
    if (d > 0) { steps.push(down ? 2 : 1); if (down) y--; else x--; }
  }
  steps.reverse();
  let i = 0, j = 0, s = 0;
  while (s < steps.length) {
    if (steps[s] === 0) { out[pre + j] = pre + i; i++; j++; s++; continue; }
    // a block of taken-out and put-in characters: changed characters, paired in order
    const dels: number[] = [], ins: number[] = [];
    while (s < steps.length && steps[s] !== 0) { if (steps[s] === 1) dels.push(i++); else ins.push(j++); s++; }
    for (let q = 0; q < ins.length && q < dels.length; q++) out[pre + ins[q]] = pre + dels[q];
  }
  return out;
}

/** The printed text of a source: its spans' text in order, a paragraph's end between spans of different paragraphs. */
export function printedOf(text: string, spans: readonly SourceSpan[], src: string): { printed: string; at: (docPos: number) => number } {
  const mine = spans.filter((s) => s.src === src).sort((a, b) => a.start - b.start);
  let printed = '';
  const starts: { doc: number; at: number; end: number }[] = [];
  mine.forEach((s, i) => {
    if (i) printed += text.slice(mine[i - 1].end, s.start).includes('\n') ? '\n' : '';
    starts.push({ doc: s.start, at: printed.length, end: s.end });
    printed += text.slice(s.start, s.end);
  });
  const at = (docPos: number): number => {
    let best = starts[0];
    for (const x of starts) if (x.doc <= docPos) best = x;
    return best ? best.at + Math.min(docPos, best.end) - best.doc : 0;
  };
  return { printed, at };
}

/**
 * The stored value after the printed text [pa, pb) of a field (whose stored value is `raw` and
 * printed text is `printed`) is replaced with `typed`; null when the change is to characters the
 * program added (they aren't in the stored value).
 */
export function applyToRaw(raw: string, printed: string, pa: number, pb: number, typed: string, markup: boolean): string | null {
  const map = lineUp(raw, printed);
  // every printed character changed must be one of the stored value's
  for (let i = pa; i < pb; i++) if (map[i] < 0) return null;
  let ra: number;
  if (pb > pa) ra = map[pa];
  else {
    // typing at a place: after the stored character before it, or before the one after it
    let i = pa - 1;
    while (i >= 0 && map[i] < 0) i--;
    if (i >= 0) ra = map[i] + 1;
    else {
      let k = pa;
      while (k < printed.length && map[k] < 0) k++;
      ra = k < printed.length ? map[k] : raw.length;
    }
  }
  let rb = pb > pa ? map[pb - 1] + 1 : ra;
  const put = markup ? escapeMarkup(typed) : typed;
  if (!markup || rb <= ra) return raw.slice(0, ra) + put + raw.slice(rb);
  // (an escaped character starts with its backslash)
  if (ra > 0 && raw[ra - 1] === '\\' && !escapedAt(raw, ra - 1)) ra--;
  if (rb - 1 > ra && raw[rb - 1] === '\\' && !escapedAt(raw, rb - 1)) rb--;
  // the markers in what is taken out stay (a selection from inside a subscript to after it
  // leaves the subscript closed); the typed text goes before them, in the look of the first
  // character taken out; formatting left empty goes
  const kept = markersIn(raw.slice(ra, rb));
  let out = raw.slice(0, ra) + put + kept + raw.slice(rb);
  const lo = Math.max(0, ra - 3);
  let hi = ra + put.length + kept.length + 3;
  for (let again = true; again;) {
    again = false;
    for (const e of EMPTY) {
      const i = out.indexOf(e, lo);
      if (i >= 0 && i + e.length <= hi && !escapedAt(out, i)) { out = out.slice(0, i) + out.slice(i + e.length); hi -= e.length; again = true; }
    }
  }
  return out;
}

/** Formatting with nothing in it, taken out after an edit. */
const EMPTY = ['^{}', '_{}', '****', '____'];

/** Is the character at `i` escaped (an odd number of backslashes before it)? */
function escapedAt(s: string, i: number): boolean {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === '\\') n++;
  return n % 2 === 1;
}

/** The formatting markers of a stretch of markup text, in order (its characters left out). */
export function markersIn(s: string): string {
  let out = '';
  for (let i = 0; i < s.length;) {
    if (s[i] === '\\') { i += 2; continue; }
    const two = s.slice(i, i + 2);
    if (two === '**' || two === '__' || two === '^{' || two === '_{') { out += two; i += 2; continue; }
    if (s[i] === '*' || s[i] === '}') { out += s[i]; i++; continue; }
    i++;
  }
  return out;
}

/**
 * Where an edit of the text is, from the text before and after it and the selection before it:
 * the stretch [start, end) of `before` replaced, and what by. A change can often be put in more
 * than one place (a space typed before a space); the one at the selection is taken.
 */
export function locateEdit(before: string, after: string, selStart: number, selEnd: number): { start: number; end: number; typed: string } {
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  let suf = 0;
  while (suf < before.length - pre && suf < after.length - pre && before[before.length - 1 - suf] === after[after.length - 1 - suf]) suf++;
  const removed = before.length - pre - suf, added = after.length - pre - suf;
  // the leftmost place the same change could be
  let suf2 = 0;
  while (suf2 < before.length && suf2 < after.length && before[before.length - 1 - suf2] === after[after.length - 1 - suf2]) suf2++;
  let pre2 = 0;
  while (pre2 < before.length - suf2 && pre2 < after.length - suf2 && before[pre2] === after[pre2]) pre2++;
  const fits = (s: number): boolean => before.slice(0, s) === after.slice(0, s) && before.slice(s + removed) === after.slice(s + added);
  const at = (s: number) => ({ start: s, end: s + removed, typed: after.slice(s, s + added) });
  const lo = Math.min(pre2, pre);
  if (lo < pre) {
    const collapsed = selStart === selEnd;
    const wants: ((s: number) => boolean)[] = [
      (s) => s === selStart && (!collapsed || removed === 0),
      (s) => collapsed && s + removed === selStart,
      (s) => collapsed && s === selStart,
    ];
    for (const w of wants) for (let s = lo; s <= pre; s++) if (w(s) && fits(s)) return at(s);
  }
  return at(pre);
}
