// Right-to-left text (Hebrew, Arabic) in documents: which characters run right to left, a line's
// pieces put in the order they are seen (the Unicode Bidirectional Algorithm's rule L2, for the
// levels a paragraph's text usually has: its own direction, and runs of the other one inside it),
// and Arabic's joined letters for a PDF, whose fonts draw each character as it is given (the
// screen's canvas joins them itself).

/** A character written right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko and their presentation forms. */
export function isRtlChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefe) || (c >= 0x10800 && c <= 0x10fff) || (c >= 0x1e800 && c <= 0x1efff);
}

/** Whether a text has any right-to-left character. */
export function hasRtl(text: string): boolean {
  for (const ch of text) if (isRtlChar(ch)) return true;
  return false;
}

/** A character's direction: R (right to left), L (letters and digits written left to right) or N (spaces, punctuation: taking their neighbours'). */
export type Dir = 'R' | 'L' | 'N';
export function dirOf(ch: string): Dir {
  if (isRtlChar(ch)) return 'R';
  return /[\p{L}\p{N}]/u.test(ch) ? 'L' : 'N';
}

/**
 * A stretch of text cut where its direction changes: [start, end, right to left] for each part.
 * Spaces and punctuation between two parts of one direction go with them; between parts of
 * two directions (or at either end), they are a part of their own (null: taking the paragraph's).
 */
export function dirChunks(text: string): [number, number, boolean | null][] {
  const chars = [...text];
  const runs: { d: Dir; a: number; b: number }[] = [];
  let at = 0;
  for (const ch of chars) {
    const d = dirOf(ch), last = runs[runs.length - 1];
    if (last && last.d === d) last.b = at + ch.length; else runs.push({ d, a: at, b: at + ch.length });
    at += ch.length;
  }
  // neutrals between two runs of one direction join them
  const out: { d: Dir; a: number; b: number }[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i], prev = out[out.length - 1], next = runs[i + 1];
    if (r.d === 'N' && prev && next && prev.d === next.d) { prev.b = next.b; i++; continue; }
    if (prev && prev.d === r.d) { prev.b = r.b; continue; }
    out.push({ ...r });
  }
  return out.map((r) => [r.a, r.b, r.d === 'N' ? null : r.d === 'R']);
}

/**
 * The order a line's pieces are seen in, left to right, as indices into `dirs` (each piece's
 * direction, in the text's order; null where it has none of its own), for a paragraph running
 * right to left (`rtl`) or left to right. A piece with no direction takes its neighbours' where
 * they agree, else the paragraph's. In a right-to-left paragraph the pieces run from the right,
 * with each stretch of left-to-right pieces in its own order; in a left-to-right one, each stretch
 * of right-to-left pieces is turned round.
 */
export function visualOrder(dirs: readonly (boolean | null)[], rtl: boolean): number[] {
  const n = dirs.length;
  const resolved = dirs.map((d, i) => {
    if (d !== null) return d;
    let p: boolean | null = null, q: boolean | null = null;
    for (let k = i - 1; k >= 0 && p === null; k--) p = dirs[k];
    for (let k = i + 1; k < n && q === null; k++) q = dirs[k];
    return p !== null && p === q ? p : rtl;
  });
  // levels: the paragraph's (0 or 1), and one more for a stretch the other way
  const levels = resolved.map((r) => (rtl ? (r ? 1 : 2) : (r ? 1 : 0)));
  return byLevels(levels);
}

/** Rule L2: the order things are seen in, from their levels: from the highest down to 1, each stretch at or above it turned round. */
function byLevels(levels: readonly number[]): number[] {
  const n = levels.length;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let lv = Math.max(0, ...levels); lv >= 1; lv--) {
    for (let i = 0; i < n;) {
      if (levels[order[i]] < lv) { i++; continue; }
      let j = i;
      while (j < n && levels[order[j]] >= lv) j++;
      const seg = order.slice(i, j).reverse();
      for (let k = i; k < j; k++) order[k] = seg[k - i];
      i = j;
    }
  }
  return order;
}

// ------------------------------------------------------------------ Arabic letters, joined

/**
 * Arabic letters' forms, from Unicode's own presentation forms (U+FE70 to U+FEFC): a letter's forms
 * stand together there, isolated, final, initial and medial (a letter joining on both sides) or
 * isolated and final (one joining only to the letter before it), each decomposing (NFKC) to the
 * letter; the four lam-alef ligatures likewise, as two forms each.
 */
interface Forms { isol: string; fina: string; init?: string; medi?: string }
let FORMS: Map<string, Forms> | null = null;
function forms(): Map<string, Forms> {
  if (FORMS) return FORMS;
  FORMS = new Map();
  let c = 0xfe80;
  while (c <= 0xfefc) {
    const base = String.fromCharCode(c).normalize('NFKC');
    let k = 1;
    while (c + k <= 0xfefc && String.fromCharCode(c + k).normalize('NFKC') === base) k++;
    const f = (i: number) => String.fromCharCode(c + i);
    if (k >= 4) FORMS.set(base, { isol: f(0), fina: f(1), init: f(2), medi: f(3) });
    else if (k >= 2) FORMS.set(base, { isol: f(0), fina: f(1) });
    c += k;
  }
  return FORMS;
}

/** Marks drawn over or under a letter (harakat, shadda, superscript alef): seen through when joining. */
const TRANSPARENT = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/;
const TATWEEL = 'ـ';

/**
 * Arabic text with each letter in the form it takes beside its neighbours (initial, medial, final or
 * isolated) and lam followed by alef as one ligature; `widths` (each character's) go with them, a
 * ligature's being its two letters'. Other characters are left as they are.
 */
export function shapeArabic(chars: string[], widths: number[]): { chars: string[]; widths: number[] } {
  const fm = forms();
  const joinsAfter = (ch: string | undefined) => ch === TATWEEL || !!fm.get(ch ?? '')?.init;
  const joins = (ch: string | undefined) => ch === TATWEEL || fm.has(ch ?? '');
  const out: string[] = [], ws: number[] = [];
  const neighbour = (i: number, step: number) => {
    for (let k = i + step; k >= 0 && k < chars.length; k += step) if (!TRANSPARENT.test(chars[k])) return chars[k];
    return undefined;
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], f = fm.get(ch);
    if (!f) { out.push(ch); ws.push(widths[i] ?? 0); continue; }
    const before = neighbour(i, -1);
    const fromBefore = joinsAfter(before);
    // lam and an alef after it: one ligature
    if (ch === 'ل') {
      let j = i + 1;
      while (j < chars.length && TRANSPARENT.test(chars[j])) j++;
      const lig = fm.get(ch + (chars[j] ?? ''));
      if (lig && j < chars.length) {
        out.push(fromBefore ? lig.fina : lig.isol);
        ws.push((widths[i] ?? 0) + (widths[j] ?? 0));
        for (let k = i + 1; k < j; k++) { out.push(chars[k]); ws.push(widths[k] ?? 0); }
        i = j;
        continue;
      }
    }
    const toAfter = !!f.init && joins(neighbour(i, 1));
    out.push(fromBefore && toAfter ? f.medi! : fromBefore ? f.fina : toAfter ? f.init! : f.isol);
    ws.push(widths[i] ?? 0);
  }
  return { chars: out, widths: ws };
}

/** Brackets and the like, which turn round in right-to-left text. */
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };

/**
 * A piece of text in the order its characters are seen, left to right, as a canvas draws it with
 * its own direction left to right (the Unicode Bidirectional Algorithm at that one level): right-to-
 * left letters turned round, digits after them kept as they read, the spaces and punctuation between
 * them going with them, brackets among them turned; Arabic letters joined. For a PDF, which writes
 * characters in the order given. `widths` go with the characters.
 */
export function visualText(text: string, widths: number[]): { text: string; widths: number[] } {
  if (!hasRtl(text)) return { text, widths };
  const shaped = shapeArabic([...text], widths);
  const chars = shaped.chars, ws = shaped.widths;
  // each character's level: right-to-left letters 1; digits 2 after them (else 0, as Latin letters);
  // spaces and punctuation between two of the right-to-left side 1, else 0
  const levels: number[] = [];
  let lastStrong: Dir = 'L';
  for (const ch of chars) {
    const d = dirOf(ch);
    if (d === 'R') { levels.push(1); lastStrong = 'R'; }
    else if (d === 'L' && /\p{N}/u.test(ch)) levels.push(lastStrong === 'R' ? 2 : 0);
    else if (d === 'L') { levels.push(0); lastStrong = 'L'; }
    else levels.push(-1);
  }
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] !== -1) continue;
    let p = i - 1, q = i + 1;
    while (p >= 0 && levels[p] === -1) p--;
    while (q < levels.length && levels[q] === -1) q++;
    const rtlSide = (k: number) => k >= 0 && k < levels.length && levels[k] >= 1;
    levels[i] = rtlSide(p) && rtlSide(q) ? 1 : 0;
  }
  const order = byLevels(levels);
  return {
    text: order.map((i) => (levels[i] % 2 === 1 ? MIRROR[chars[i]] ?? chars[i] : chars[i])).join(''),
    widths: order.map((i) => ws[i]),
  };
}
