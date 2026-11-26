// Two parts of a formula count only after certain characters: an i/n/s/t alkyl group (iPr, OtBu)
// and "pin" after boron (B2pin2). Old WebKit has no regex lookbehind, so before a formula pattern
// runs, those letters are swapped for marks of the same length (code points Unicode keeps for a program's own use, never in text), where they count.

export const ALKYL_MARKS = '\uFDD0-\uFDD3';
export const PIN_MARK = '\uFDD4';
export const MARKS = '\uFDD0-\uFDD4';

const ALKYL: Record<string, string> = { i: '\uFDD0', n: '\uFDD1', s: '\uFDD2', t: '\uFDD3' };

/**
 * `text` with those letters marked. An alkyl letter counts after anything but a letter, and i, n
 * and t also straight after O (with a hyphen after them there only if `hyphenAfterO`).
 */
export function markFormulaLetters(text: string, hyphenAfterO: boolean): string {
  return text.replace(/[inst](?=-?(?:Pr|Bu))|p(?=in)/g, (c: string, at: number) => {
    const prev = at ? text[at - 1] : '';
    if (c === 'p') return prev === 'B' || (/\d/.test(prev) && text[at - 2] === 'B') ? PIN_MARK : c;
    if (!/[A-Za-z]/.test(prev)) return ALKYL[c];
    return prev === 'O' && c !== 's' && (hyphenAfterO || text[at + 1] !== '-') ? ALKYL[c] : c;
  });
}
