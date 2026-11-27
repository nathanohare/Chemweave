// The conventional italics of a compound's name, for its printed title (SI Assistant's SPEC
// §13x, rewritten here from how it behaves): heteroatom locants before a hyphen (N-, N,N-, N′-,
// O-, S-, P-), tert-, sec-, cis-/trans-, o-/m-/p- before a hyphen, and the letters of
// stereodescriptors in brackets ((E)-, (2E,4Z)-, (1R,2S)-, (R*)-). Only the printed title
// changes; the stored name stays as typed. The rules look at the characters round each prefix,
// so "Transfer", "SNAr", "1H-indole" and "N1-benzyl" stay upright.
//
// A name with an asterisk of its own (not the * of a relative configuration, (R*,S*)) is printed
// as typed instead, *…* in italics as in other texts, and nothing is made italic by itself; \*
// is a plain asterisk.

import { R } from './format';
import type { Run } from './markup';
import { after, guardedAt } from '../regex-behind';

/** Where a prefix may start: the start of the name, or after a space, bracket or hyphen. */
const startsPrefix = (at: number, s: string): boolean => at === 0 || /[\s(\[{\-–]/.test(s[at - 1]);
/** Primes after a locant (N′, N″), not an apostrophe. */
const PRIMES = '[′″]*';
const LOCANT = `[NOSP]${PRIMES}`;
const RULES: RegExp[] = [
  // N-, N,N-, N,O-, N′-: each letter of the list (the list must end in a hyphen)
  guardedAt(new RegExp(`${LOCANT}(?:,${LOCANT})*(?=-)`, 'g'), startsPrefix),
  // tert-, sec-, cis-, trans-, o-, m-, p- (in lower case)
  guardedAt(/(?:tert|sec|cis|trans|o|m|p)(?=-)/g, startsPrefix),
];
/** Brackets of stereodescriptors only: (E), (2E,4Z), (1R,2S), (R*,S*), (S,E), and locants with a letter or primes: (3aR,7aS), (1′R,2S). */
const STEREO = /\(((?:\d+[a-z]?[′″']*)?[RSEZ]\*?(?:,(?:\d+[a-z]?[′″']*)?[RSEZ]\*?)*)\)/g;

/** The parts of a name to print in italics, as [start, end) character ranges. */
export function italicSpans(name: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const rule of RULES) {
    for (const m of name.matchAll(rule)) {
      const start = m.index!;
      if (rule === RULES[0]) {
        // only the letters of the list, not its commas and primes
        for (const x of m[0].matchAll(/[NOSP]/g)) spans.push([start + x.index!, start + x.index! + 1]);
      } else spans.push([start, start + m[0].length]);
    }
  }
  for (const m of name.matchAll(STEREO)) {
    const inner = m.index! + 1;
    for (const x of m[1].matchAll(/[RSEZ]/g)) spans.push([inner + x.index!, inner + x.index! + 1]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  return spans;
}

/** Whether a name chooses its italics by hand: an asterisk that isn't escaped or a relative configuration's (R*). */
export function typedItalics(name: string): boolean {
  const plain = name.replace(/\\\*/g, '').replace(after(/\*(?=[,)])/g, /[RS]/), '');
  return plain.includes('*');
}

/** A name as runs with its italics (automatic, or typed as *…*), in `look` (e.g. bold for a title). */
export function nameRuns(name: string, look: { bold?: boolean } = {}): Run[] {
  const out: Run[] = [];
  const push = (text: string, italic: boolean): void => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && !!last.italic === italic) last.text += text;
    else out.push(R(text, { ...look, ...(italic ? { italic: true } : {}) }));
  };
  if (typedItalics(name)) {
    let italic = false, buf = '';
    for (let i = 0; i < name.length; i++) {
      if (name[i] === '\\' && name[i + 1] === '*') { buf += '*'; i++; continue; }
      if (name[i] === '*') { push(buf, italic); buf = ''; italic = !italic; continue; }
      buf += name[i];
    }
    push(buf, italic);
    return out;
  }
  const text = name.replace(/\\\*/g, '*');
  const spans = italicSpans(text);
  let at = 0;
  for (const [a, b] of spans) {
    if (a < at) continue;
    push(text.slice(at, a), false);
    push(text.slice(a, b), true);
    at = b;
  }
  push(text.slice(at), false);
  return out;
}

/**
 * A systematic name with its first word capitalized, as a compound's title is written:
 * "1-(4-chlorophenyl)ethan-1-ol" → "1-(4-Chlorophenyl)ethan-1-ol", "tert-butyl…" →
 * "tert-Butyl…", "(R)-1-phenyl…" → "(R)-1-Phenyl…". Locants, stereodescriptors and italic
 * prefixes stay as they are.
 */
export function capitalizeName(name: string): string {
  const skip = italicSpans(name);
  for (let i = 0; i < name.length - 1; i++) {
    if (!/[a-z]/.test(name[i]) || !/[a-z]/.test(name[i + 1])) continue;
    if (skip.some(([a, b]) => i >= a && i < b)) continue;
    // (the start of a word, not the middle of one)
    if (i > 0 && /[A-Za-z]/.test(name[i - 1])) continue;
    return name.slice(0, i) + name[i].toUpperCase() + name.slice(i + 1);
  }
  return name;
}
