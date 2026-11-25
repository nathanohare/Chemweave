// Right-to-left text (Hebrew, Arabic) in documents: which characters run right to left, a line's
// pieces put in the order they are seen (the Unicode Bidirectional Algorithm's rule L2, for the
// levels a paragraph's text usually has: its own direction, and runs of the other one inside it),
// and Arabic's joined letters for a PDF, whose fonts draw each character as it is given (the
// screen's canvas joins them itself).

/** A character written right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko and their presentation forms (not digits: Arabic-Indic digits read left to right). */
export function isRtlChar(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (/\p{Nd}/u.test(ch)) return false;
  return (c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefe) || (c >= 0x10800 && c <= 0x10fff) || (c >= 0x1e800 && c <= 0x1efff);
}

/** Whether a text has any right-to-left letter. */
export function hasRtl(text: string): boolean {
  for (const ch of text) if (isRtlChar(ch)) return true;
  return false;
}

/**
 * A character's direction: R (right to left), L (letters written left to right), EN (digits, which
 * read left to right but sit among right-to-left text) or N (spaces, punctuation: taking their
 * neighbours').
 */
export type Dir = 'R' | 'L' | 'EN' | 'N';
export function dirOf(ch: string): Dir {
  if (/\p{Nd}/u.test(ch)) return 'EN';
  if (isRtlChar(ch)) return 'R';
  return /\p{L}/u.test(ch) ? 'L' : 'N';
}

/** Separators inside a number (12.5, 1,000, 3:45) and signs that go with one (50 %, $5). */
const CS = /^[.,:\/ ]$/, ET = /^[%‰‱°+\-#$¢£¥€٪]$/;

/** Each character's direction, with a number's separators and signs taken into it (the algorithm's rules W4 and W5). */
function classes(chars: readonly string[]): Dir[] {
  const d = chars.map(dirOf);
  for (let i = 1; i + 1 < d.length; i++) if (d[i] === 'N' && CS.test(chars[i]) && d[i - 1] === 'EN' && d[i + 1] === 'EN') d[i] = 'EN';
  for (let i = 0; i < d.length; i++) {
    if (d[i] !== 'N' || !ET.test(chars[i])) continue;
    let j = i; while (j < d.length && d[j] === 'N' && ET.test(chars[j])) j++;
    let k = i; while (k >= 0 && d[k] === 'N' && ET.test(chars[k])) k--;
    if ((j < d.length && d[j] === 'EN') || (k >= 0 && d[k] === 'EN')) d[i] = 'EN';
  }
  return d;
}

/**
 * A stretch of text cut where its direction changes: [start, end, direction] for each part, its
 * direction R, L or EN, or null for spaces and punctuation between parts of two directions (or
 * at either end), taking their neighbours'. Between two parts of one direction they go with them.
 */
export function dirChunks(text: string): [number, number, Exclude<Dir, 'N'> | null][] {
  const chars = [...text];
  const cls = classes(chars);
  const runs: { d: Dir; a: number; b: number }[] = [];
  let at = 0;
  chars.forEach((ch, i) => {
    const d = cls[i], last = runs[runs.length - 1];
    if (last && last.d === d) last.b = at + ch.length; else runs.push({ d, a: at, b: at + ch.length });
    at += ch.length;
  });
  const out: { d: Dir; a: number; b: number }[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i], prev = out[out.length - 1], next = runs[i + 1];
    if (r.d === 'N' && prev && next && prev.d === next.d && prev.d !== 'EN') { prev.b = next.b; i++; continue; }
    if (prev && prev.d === r.d) { prev.b = r.b; continue; }
    out.push({ ...r });
  }
  return out.map((x) => [x.a, x.b, x.d === 'N' ? null : x.d]);
}

/**
 * Levels for things in a row (characters, or a line's pieces) of these directions ('B' a tab: the
 * paragraph's own direction, which ends a stretch), in a paragraph running right to left (\`rtl\`) or
 * left to right: the Unicode Bidirectional Algorithm's rules W7, N1, N2, I1 and I2 for one
 * paragraph level. Digits after left-to-right letters (or at the start of a left-to-right
 * paragraph) are left to right; spaces and punctuation between two of one side take that side,
 * else the paragraph's.
 */
function levelsOf(dirs: readonly (Dir | 'B' | null)[], rtl: boolean): number[] {
  const n = dirs.length;
  const d: (Dir | 'B')[] = dirs.map((x) => x ?? 'N');
  // W7: digits after left-to-right letters (or the paragraph's start when it runs left to right) are L
  let strong: 'L' | 'R' = rtl ? 'R' : 'L';
  for (let i = 0; i < n; i++) {
    if (d[i] === 'L' || d[i] === 'R') strong = d[i] as 'L' | 'R';
    else if (d[i] === 'B') strong = rtl ? 'R' : 'L';
    else if (d[i] === 'EN' && strong === 'L') d[i] = 'L';
  }
  // N1 and N2: neutrals take their sides' direction where both agree (digits counting as right to left), else the paragraph's
  const side = (x: Dir | 'B'): 'L' | 'R' | null => (x === 'L' ? 'L' : x === 'R' || x === 'EN' ? 'R' : x === 'B' ? (rtl ? 'R' : 'L') : null);
  const res: ('L' | 'R' | 'EN')[] = d.map((x, i) => {
    if (x === 'B') return rtl ? 'R' : 'L';
    if (x !== 'N') return x as 'L' | 'R' | 'EN';
    let p: 'L' | 'R' | null = null, q: 'L' | 'R' | null = null;
    for (let k = i - 1; k >= 0 && p === null; k--) p = side(d[k]);
    for (let k = i + 1; k < n && q === null; k++) q = side(d[k]);
    p ??= rtl ? 'R' : 'L'; q ??= rtl ? 'R' : 'L';
    return p === q ? p : rtl ? 'R' : 'L';
  });
  // I1 and I2
  return res.map((x) => (rtl ? (x === 'R' ? 1 : 2) : (x === 'R' ? 1 : x === 'EN' ? 2 : 0)));
}

/**
 * The order a line's pieces are seen in, left to right, as indices into \`dirs\` (each piece's
 * direction, in the text's order: R, L, EN, a tab 'B', or null for none of its own), for a
 * paragraph running right to left (\`rtl\`) or left to right; and each piece's level (odd: right to
 * left, as its letters are drawn).
 */
export function visualOrder(dirs: readonly (Dir | 'B' | null)[], rtl: boolean): { order: number[]; levels: number[] } {
  const levels = levelsOf(dirs, rtl);
  return { order: byLevels(levels), levels };
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
  scanForms(0xfe80, 0xfefc);
  // (Persian and Urdu letters: peh, tcheh, jeh, keheh, gaf, farsi yeh..., in Presentation Forms-A)
  scanForms(0xfb50, 0xfbb1);
  scanForms(0xfbd3, 0xfbe9);
  scanForms(0xfbfc, 0xfbff);
  return FORMS;
}
function scanForms(from: number, to: number): void {
  const FM = FORMS!;
  let c = from;
  while (c <= to) {
    const base = String.fromCharCode(c).normalize('NFKC');
    let k = 1;
    while (c + k <= to && String.fromCharCode(c + k).normalize('NFKC') === base) k++;
    const f = (i: number) => String.fromCharCode(c + i);
    if (!FM.has(base)) {
      if (k >= 4) FM.set(base, { isol: f(0), fina: f(1), init: f(2), medi: f(3) });
      else if (k >= 2) FM.set(base, { isol: f(0), fina: f(1) });
    }
    c += k;
  }
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
 * A piece of text in the order its characters are seen, left to right, as a canvas draws it with the
 * piece's direction (\`rtl\`: right to left), by the Unicode Bidirectional Algorithm at one level:
 * right-to-left letters turned round, numbers kept as they read, brackets among right-to-left
 * text turned, Arabic letters joined. For a PDF, which writes characters in the order given.
 * \`widths\` go with the characters.
 */
export function visualText(text: string, widths: number[], rtl = false): { text: string; widths: number[] } {
  if (!rtl && !hasRtl(text)) return { text, widths };
  const shaped = shapeArabic([...text], widths);
  const chars = shaped.chars, ws = shaped.widths;
  const levels = levelsOf(classes(chars), rtl);
  const order = byLevels(levels);
  return {
    text: order.map((i) => (levels[i] % 2 === 1 ? MIRROR[chars[i]] ?? chars[i] : chars[i])).join(''),
    widths: order.map((i) => ws[i]),
  };
}
