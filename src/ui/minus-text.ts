// A negative number as people read it: with the minus sign (U+2212), not a hyphen (ui-style S27).

/** `-60` as "−60" (a number or its text). */
export function minusText(n: number | string): string {
  return String(n).replace(/^-/, '−');
}
