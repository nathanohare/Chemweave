/**
 * The Scale window's answer: how much to scale the selection by, from its Size box (a percentage)
 * and its "or bond length" box (in points; shown filled with the selected bonds' length `L`).
 * The bond length is used only when it was changed to a number above zero; a box left as it was,
 * or cleared, leaves the Size box in charge. NaN or a size at or below zero means "not a size".
 */
export function scaleFactor(pct: string, len: string | undefined, shown: string, L: number | null): number {
  const typed = len?.trim() ?? '';
  const v = parseFloat(typed);
  if (L && typed !== '' && typed !== shown && Number.isFinite(v) && v > 0) return v / L;
  // a bond length typed that isn't a length above zero: not a size, rather than the Size box quietly used
  if (L && typed !== '' && typed !== shown) return NaN;
  return parseFloat(pct) / 100;
}
