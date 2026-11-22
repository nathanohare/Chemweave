// Subscript and superscript digits and signs written as plain characters (CH₃ → CH3, NH₃⁺ → NH3+),
// so text typed on a keyboard finds names and table cells written with real subscripts.

const PLAIN: Record<string, string> = { '⁺': '+', '₊': '+', '⁻': '-', '₋': '-' };
'₀₁₂₃₄₅₆₇₈₉'.split('').forEach((c, i) => (PLAIN[c] = String(i)));
'⁰¹²³⁴⁵⁶⁷⁸⁹'.split('').forEach((c, i) => (PLAIN[c] = String(i)));

/** The text with sub- and superscript digits and signs as plain ones. */
export function plainScripts(text: string): string {
  return text.replace(/[₀-₉⁰¹²³⁴-⁹⁺₊⁻₋]/g, (c) => PLAIN[c]);
}
