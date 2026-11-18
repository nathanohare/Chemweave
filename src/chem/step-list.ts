// Numbered lists of steps in the text over a reaction arrow ("1. n-BuLi; 2. PhCHO"): found so the
// text can line up on the left, and split so each step has a line of its own.

/** A step number: 1. 1) (1) i) (ii) a) (b). */
export const STEP_MARK = String.raw`\(?(?:\d{1,2}|i{1,3}|iv|vi{0,3}|ix|x|[a-h])[.)]`;
const MARK_AT_START = new RegExp(`^${STEP_MARK}(?=\\s|$)`, 'i');
const MARK_IN_LINE = new RegExp(`(?:^|[;,]\\s*)${STEP_MARK}(?=\\s)`, 'gi');

/**
 * Is this text a numbered list of steps? Two or more lines that start with a step number (the
 * first line among them), or one line with two or more ("1. n-BuLi; 2. PhCHO").
 */
export function isNumberedList(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !MARK_AT_START.test(lines[0])) return false;
  if (lines.filter((l) => MARK_AT_START.test(l)).length >= 2) return true;
  return lines.length === 1 && (lines[0].match(MARK_IN_LINE)?.length ?? 0) >= 2;
}
