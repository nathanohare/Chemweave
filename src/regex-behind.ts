// Regular expressions that look at the text before a match, without regex lookbehind. WebKit older
// than Safari 16.4 (every app on macOS 12, and old iPads and school computers) can't read lookbehind:
// one literal anywhere in a script stops the whole script from loading. So the pattern is written
// without it, and a "guard" function checks the text before each match instead.
// scripts/check-old-webkit.mjs and tests/old-webkit.test.ts fail on a new lookbehind.

/** Whether a match counts, given the whole text it was found in. */
export type Guard = (m: RegExpExecArray, text: string) => boolean;

/**
 * A RegExp whose matches must also pass `ok`. A refused match moves the search on by one character,
 * as a failed lookbehind would. test, exec, match, matchAll, replace and split all follow it.
 * Its `source` does not hold the guard: copy one with reflag(), never with new RegExp(re.source).
 */
export class GuardedRegExp extends RegExp {
  readonly ok: Guard;
  /** The guard needs only the match's index, and is asked before the pattern is tried there. */
  readonly early: boolean;
  /** The plain searching copies, by flags: shared with the copies matchAll and split make, so each is built once. */
  private readonly finders: Map<string, RegExp>;

  constructor(pattern: RegExp | string, flags?: string, ok?: Guard, early?: boolean) {
    super(pattern, flags);
    // (matchAll and split make their own copy of a pattern: the guard goes with it)
    const from = pattern instanceof GuardedRegExp ? pattern : null;
    this.ok = ok ?? from?.ok ?? (() => true);
    this.early = early ?? from?.early ?? false;
    this.finders = from && from.source === this.source ? from.finders : new Map();
  }

  /** The first match from `at` that the guard accepts, and where the search goes on after it. */
  private find(s: string, at: number): { m: RegExpExecArray; end: number } | null {
    // (a copy of this pattern that searches on from lastIndex, run without the guard)
    const flags = this.early && !this.sticky ? `${this.flags}y` : this.sticky || this.global ? this.flags : `${this.flags}g`;
    let finder = this.finders.get(flags);
    if (!finder) { finder = new GuardedRegExp(this, flags); this.finders.set(flags, finder); }
    let m: RegExpExecArray | null;
    if (this.early) {
      const here = { index: at } as RegExpExecArray;
      for (; here.index <= s.length; here.index++) {
        // (a sticky search looks at the one place only)
        if (!this.ok(here, s)) { if (this.sticky) break; continue; }
        finder.lastIndex = here.index;
        m = RegExp.prototype.exec.call(finder, s) as RegExpExecArray | null;
        // (a Unicode search asked for the middle of a character starts before it: not a match here)
        if (m && m.index === here.index) return { m, end: finder.lastIndex };
        if (this.sticky) break;
      }
      return null;
    }
    finder.lastIndex = at;
    while ((m = RegExp.prototype.exec.call(finder, s) as RegExpExecArray | null)) {
      const end = finder.lastIndex;
      if (this.ok(m, s)) return { m, end };
      if (this.sticky) break;
      finder.lastIndex = m.index + (this.unicode && (s.codePointAt(m.index) ?? 0) > 0xffff ? 2 : 1);
    }
    return null;
  }

  override exec(text: string): RegExpExecArray | null {
    const from = this.global || this.sticky;
    const found = this.find(String(text), from ? this.lastIndex : 0);
    if (from) this.lastIndex = found?.end ?? 0;
    return found?.m ?? null;
  }

  /** matchAll without making a copy of the pattern first (long texts are searched at every key). */
  override [Symbol.matchAll](text: string): ReturnType<RegExp[typeof Symbol.matchAll]> {
    const s = String(text);
    let at = this.lastIndex;
    function* all(re: GuardedRegExp) {
      for (let found = re.find(s, at); found; found = re.find(s, at)) {
        // (an empty match: move on past it)
        at = found.m[0] ? found.end : found.end + (re.unicode && (s.codePointAt(found.end) ?? 0) > 0xffff ? 2 : 1);
        yield found.m;
        if (!re.global || at > s.length) return;
      }
    }
    return all(this) as unknown as ReturnType<RegExp[typeof Symbol.matchAll]>;
  }
}

export const guarded = (re: RegExp, ok: Guard): GuardedRegExp => new GuardedRegExp(re.source, re.flags, ok);

/** `re` with other flags, keeping its guard if it has one. */
export const reflag = (re: RegExp, flags: string, source = re.source): RegExp =>
  re instanceof GuardedRegExp ? new GuardedRegExp(source, flags, re.ok, re.early) : new RegExp(source, flags);

/**
 * A guard on the position alone, asked before the pattern is tried there, as a lookbehind at its
 * start is: a pattern that begins with a run (\s+, \d+) is then not tried from inside every run.
 */
export const guardedAt = (re: RegExp, ok: (at: number, text: string) => boolean): GuardedRegExp =>
  new GuardedRegExp(re.source, re.flags, (m, s) => ok(m.index, s), costlyFromInside(re.source));

/**
 * Whether a pattern is costly to try from inside text it would be refused in: it begins with a
 * repeat that can run on, or with a lookahead. Only such a pattern has its guard asked first;
 * the others are searched natively, which is quicker.
 */
const costlyFromInside = (source: string): boolean =>
  /^(?:\((?:\?:|\?<\w+>)?)*(?:\(\?=|(?:\\[sdwSDW]|\[(?:\\.|[^\]\\])*\]|\.)(?:[+*]|\{\d+,\}))/.test(source);

/** The character (a whole code point) just before `at`, or '' at the start. */
export function charBefore(text: string, at: number): string {
  if (at <= 0) return '';
  const low = text.charCodeAt(at - 1);
  if (at > 1 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(at - 2, at);
  }
  return text[at - 1];
}

/** Only where the character before is one of `chars` (never at the start). */
export const after = (re: RegExp, chars: RegExp): GuardedRegExp =>
  guardedAt(re, (at, s) => at > 0 && chars.test(charBefore(s, at)));

/** Only where the character before is not one of `chars` (the start passes). */
export const notAfter = (re: RegExp, chars: RegExp): GuardedRegExp =>
  guardedAt(re, (at, s) => at === 0 || !chars.test(charBefore(s, at)));
