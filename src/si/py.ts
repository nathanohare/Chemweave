// Small helpers for code ported from Chem SI Assistant's Python, so ported text rules behave
// the same: Python's regular expressions (Unicode \w and \b, named groups, case-insensitive
// groups), str.strip with characters, isalnum/isupper/islower, and difflib's matching blocks.

import { GuardedRegExp, reflag, type Guard } from '../regex-behind';

const W = '\\p{L}\\p{N}_';
// Python's \b and \B (Unicode words) need lookbehind. WebKit older than Safari 16.4 has none, and
// there JavaScript's own \b and \B stand in: the same except next to letters such as µ or α.
const BEHIND = '(?<';
const canLookBehind = ((): boolean => { try { new RegExp('(?<=a)'); return true; } /* old-webkit-ok: only tried */ catch { return false; } })();
const B = canLookBehind ? `(?:${BEHIND}=[${W}])(?![${W}])|${BEHIND}![${W}])(?=[${W}]))` : '\\b';
const NOT_B = canLookBehind ? `(?:${BEHIND}=[${W}])(?=[${W}])|${BEHIND}![${W}])(?![${W}]))` : '\\B';

/**
 * The text a pattern is run on. The same engines that lack lookbehind can crash on a Unicode pattern
 * with a lazy part and a character outside the basic plane (𝑛, an emoji), so there each such
 * character is stood in for by two plain ones (letters for a letter), keeping every position.
 */
export const safeText = (s: string, old = !canLookBehind): string =>
  (old ? s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, (c) => (/^\p{L}/u.test(c) ? 'ªª' : '☐☐')) : s);
const cache = new Map<string, RegExp>();

/** A Python pattern as a JS RegExp ('u' always; Python flags I, S, M as 'i', 's', 'm'). */
export function rx(src: string, flags = '', ok?: Guard, early = true): RegExp {
  // (`ok` stands for a Python lookbehind, which old WebKit can't read; a guarded one isn't kept)
  const key = flags + '\u0000' + src;
  let r = ok ? undefined : cache.get(key);
  if (!r) {
    r = new RegExp(convert(src), [...new Set(('u' + flags.replace(/[gy]/g, '')).split(''))].join(''));
    // (`early`: the guard reads only the position, and is asked before the pattern is tried there)
    if (ok) r = new GuardedRegExp(r.source, r.flags, ok, early);
    else cache.set(key, r);
  }
  return r;
}

const caseBoth = (ch: string): string => {
  const lo = ch.toLowerCase(), up = ch.toUpperCase();
  return lo !== up ? lo + up : ch;
};

function convert(src: string): string {
  let out = '';
  let inClass = false;
  // stack of open groups: whether each is a case-insensitive (?i:…) one
  const groups: boolean[] = [];
  const ci = (): boolean => groups.includes(true);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      const nx = src[i + 1] ?? '';
      i++;
      if (nx === 'w') out += inClass ? W : `[${W}]`;
      else if (nx === 'W') out += inClass ? '' : `[^${W}]`;
      else if (nx === 'b') out += inClass ? '\\x08' : B;
      else if (nx === 'B') out += NOT_B;
      else if (nx === 'Z') out += '$(?![\\s\\S])';
      else if (nx === 'A') out += '^';
      else if (/[dDsSnrtfv0-9]/.test(nx)) out += '\\' + nx;
      else if (nx === 'x' || nx === 'u') out += '\\' + nx;
      else if (/[\^$\\.*+?()[\]{}|/-]/.test(nx)) out += (nx === '-' && !inClass ? '-' : '\\' + nx);
      else if (ci() && !inClass && /\p{L}/u.test(nx)) out += `[${caseBoth(nx)}]`;
      else out += nx;          // (an escaped ordinary character: itself)
      continue;
    }
    if (inClass) {
      if (ch === ']' && !(out.endsWith('[') || out.endsWith('[^'))) { inClass = false; out += ch; continue; }
      if (ch === '[') { out += '\\['; continue; }
      if (ci() && /\p{L}/u.test(ch) && src[i + 1] !== '-' && src[i - 1] !== '-') { out += caseBoth(ch); continue; }
      out += ch === '/' ? '\\/' : ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      out += ch;
      if (src[i + 1] === '^') { out += '^'; i++; }
      if (src[i + 1] === ']') { out += '\\]'; i++; }
      continue;
    }
    if (ch === '(') {
      if (src.startsWith('(?P<', i)) { out += '(?<'; i += 3; groups.push(false); continue; }
      if (src.startsWith('(?P=', i)) {
        const end = src.indexOf(')', i);
        out += `\\k<${src.slice(i + 4, end)}>`;
        i = end;
        continue;
      }
      if (src.startsWith('(?i:', i)) { out += '(?:'; i += 3; groups.push(true); continue; }
      groups.push(false);
      out += ch;
      continue;
    }
    if (ch === ')') { groups.pop(); out += ch; continue; }
    if (ch === '{') {
      const q = /^\{\d*(?:,\d*)?\}/.exec(src.slice(i));
      if (q && q[0] !== '{}' && q[0] !== '{,}') { out += q[0]; i += q[0].length - 1; continue; }
      out += '\\{';
      continue;
    }
    if (ch === '}') { out += '\\}'; continue; }
    if (ch === '/') { out += '\\/'; continue; }
    if (ci() && /\p{L}/u.test(ch)) { out += `[${caseBoth(ch)}]`; continue; }
    out += ch;
  }
  return out;
}

export interface Match {
  0: string;
  index: number;
  end: number;
  group(g?: number | string): string | null;
  start(g?: number | string): number;
  groups: Record<string, string | undefined>;
}

function wrap(m: RegExpExecArray, src: string): Match {
  const index = m.index;
  const r = m as unknown as Match & RegExpExecArray;
  // (matched on stand-ins: the groups are cut from the text as it is)
  if (m.input !== src) {
    const at = (m as unknown as { indices: (number[] | undefined)[] & { groups?: Record<string, number[] | undefined> } }).indices;
    const cut = (i: number[] | undefined) => (i ? src.slice(i[0], i[1]) : undefined);
    for (let g = 0; g < m.length; g++) m[g] = cut(at[g])!;
    for (const name of Object.keys(m.groups ?? {})) m.groups![name] = cut(at.groups?.[name])!;
  }
  const indices = (m as unknown as { indices?: (number[] | undefined)[] & { groups?: Record<string, number[] | undefined> } }).indices;
  return Object.assign(r, {
    index,
    end: index + m[0].length,
    group: (g: number | string = 0): string | null => {
      const v = typeof g === 'number' ? m[g] : m.groups?.[g];
      return v === undefined ? null : v;
    },
    start: (g: number | string = 0): number => {
      if (g === 0) return index;
      const at = typeof g === 'number' ? indices?.[g] : indices?.groups?.[g];
      return at ? at[0] : -1;
    },
    groups: m.groups ?? {},
    input: src,
  });
}

const guardedCopies = new WeakMap<RegExp, Map<string, RegExp>>();

const withFlags = (re: RegExp, add: string): RegExp => {
  const f = [...new Set((re.flags.replace(/[gy]/g, '') + add).split(''))].join('');
  if (re instanceof GuardedRegExp) {
    let g = guardedCopies.get(re)?.get(f);
    if (!g) { g = reflag(re, f); guardedCopies.set(re, (guardedCopies.get(re) ?? new Map()).set(f, g)); }
    return g;
  }
  const k = re.source + '\u0000' + f;
  let r = cache.get(k);
  if (!r) { r = new RegExp(re.source, f); cache.set(k, r); }
  return r;
};

/** re.match: at `pos` only. */
export function match(re: RegExp, s: string, pos = 0): Match | null {
  const r = withFlags(re, 'yd');
  r.lastIndex = pos;
  const m = r.exec(safeText(s));
  return m ? wrap(m, s) : null;
}

/** re.search from `pos`. */
export function search(re: RegExp, s: string, pos = 0): Match | null {
  const r = withFlags(re, 'gd');
  r.lastIndex = pos;
  const m = r.exec(safeText(s));
  return m ? wrap(m, s) : null;
}

/** re.fullmatch. */
export function fullmatch(re: RegExp, s: string): Match | null {
  // (a guarded pattern is only ever searched for)
  if (re instanceof GuardedRegExp) throw new Error('fullmatch of a guarded pattern');
  const k = '^(?:' + re.source + ')$(?![\\s\\S])';
  const f = [...new Set((re.flags.replace(/[gymd]/g, '') + 'd').split(''))].join('');
  let r = cache.get(k + '\u0000' + f);
  if (!r) { r = new RegExp(k, f); cache.set(k + '\u0000' + f, r); }
  const m = r.exec(safeText(s));
  return m ? wrap(m, s) : null;
}

/** re.finditer (empty matches stepped over as Python does). */
export function* finditer(re: RegExp, s: string): Generator<Match> {
  const r = withFlags(re, 'gd');
  r.lastIndex = 0;
  let m: RegExpExecArray | null;
  const t = safeText(s);
  while ((m = r.exec(t))) {
    // (past the whole character: a Unicode pattern asked for the middle of one starts before it,
    // and an empty match there would be found for ever)
    if (m[0] === '') r.lastIndex += (r.lastIndex < t.length && t.codePointAt(r.lastIndex)! > 0xffff) ? 2 : 1;
    yield wrap(m, s);
  }
}

export const findall = (re: RegExp, s: string): string[] => [...finditer(re, s)].map((m) => m.group(1) ?? m[0]);

/** re.sub; `repl` a function or a Python template (\1, \g<1>, \g<name>). */
export function sub(re: RegExp, repl: string | ((m: Match) => string), s: string, count = 0): string {
  let out = '', last = 0, n = 0;
  for (const m of finditer(re, s)) {
    if (count && n >= count) break;
    out += s.slice(last, m.index) + (typeof repl === 'function' ? repl(m) : expand(repl, m));
    last = m.end;
    n++;
  }
  return out + s.slice(last);
}

function expand(t: string, m: Match): string {
  return t.replace(/\\(?:g<([^>]+)>|(\d{1,2})|(.))/g, (_x, g: string | undefined, d: string | undefined, c: string | undefined) => {
    if (g !== undefined) return m.group(/^\d+$/.test(g) ? Number(g) : g) ?? '';
    if (d !== undefined) return m.group(Number(d)) ?? '';
    return ({ n: '\n', t: '\t', '\\': '\\' } as Record<string, string>)[c!] ?? '\\' + c;
  });
}

/** re.split (no groups in the patterns used). */
export function split(re: RegExp, s: string): string[] {
  const out: string[] = [];
  let last = 0;
  for (const m of finditer(re, s)) {
    if (m[0] === '' && m.index === last && m.index !== 0) continue;
    out.push(s.slice(last, m.index));
    last = m.end;
  }
  out.push(s.slice(last));
  return out;
}

const WS = ' \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\xa0                　';
export const isSpace = (ch: string): boolean => ch !== '' && [...ch].every((c) => WS.includes(c));

/** str.strip / lstrip / rstrip (whitespace when `chars` is not given). */
export function strip(s: string, chars?: string): string { return rstrip(lstrip(s, chars), chars); }
export function lstrip(s: string, chars?: string): string {
  let i = 0;
  const set = chars ?? WS;
  while (i < s.length && set.includes(s[i])) i++;
  return s.slice(i);
}
export function rstrip(s: string, chars?: string): string {
  let i = s.length;
  const set = chars ?? WS;
  while (i > 0 && set.includes(s[i - 1])) i--;
  return s.slice(0, i);
}

export const isAlpha = (s: string): boolean => s !== '' && /^\p{L}+$/u.test(s);
export const isAlnum = (s: string): boolean => s !== '' && /^[\p{L}\p{N}]+$/u.test(s);
export const isDigit = (s: string): boolean => s !== '' && /^[\p{Nd}²³¹⁰-⁹₀-₉]+$/u.test(s);
const cased = (c: string): boolean => c.toLowerCase() !== c.toUpperCase();
export const isLower = (s: string): boolean => [...s].some(cased) && [...s].every((c) => !cased(c) || c === c.toLowerCase());
export const isUpper = (s: string): boolean => [...s].some(cased) && [...s].every((c) => !cased(c) || c === c.toUpperCase());

/** difflib.SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks(). */
export function matchingBlocks<T>(a: readonly T[], b: readonly T[]): [number, number, number][] {
  const b2j = new Map<T, number[]>();
  b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]); });
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  const blocks: [number, number, number][] = [];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const x = longest(alo, ahi, blo, bhi);
    const [i, j, k] = x;
    if (k) {
      blocks.push(x);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  let i1 = 0, j1 = 0, k1 = 0;
  const out: [number, number, number][] = [];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
    else { if (k1) out.push([i1, j1, k1]); i1 = i2; j1 = j2; k1 = k2; }
  }
  if (k1) out.push([i1, j1, k1]);
  out.push([a.length, b.length, 0]);
  return out;
}

/** The median (Python's statistics.median). */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Python's round(x, n) for display values (banker's rounding is not needed here). */
export const pyRound = (x: number, n: number): number => Math.round(x * 10 ** n) / 10 ** n;
