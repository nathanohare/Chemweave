// The status bar's zoom slider in Presentation mode, as PowerPoint's: 100% in the middle, 10% at
// the left end and 400% at the right, each half even (so the left half is finer than the right).

export const ZOOM_MIN = 10;
export const ZOOM_MAX = 400;

/** The zoom (in percent) for a slider position from 0 to 100. */
export function sliderToPct(v: number): number {
  const t = Math.min(100, Math.max(0, v));
  return t <= 50 ? ZOOM_MIN + (t / 50) * (100 - ZOOM_MIN) : 100 + ((t - 50) / 50) * (ZOOM_MAX - 100);
}

/** The slider position (0 to 100) for a zoom in percent; zooms past either end sit at that end. */
export function pctToSlider(pct: number): number {
  const p = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pct));
  return p <= 100 ? ((p - ZOOM_MIN) / (100 - ZOOM_MIN)) * 50 : 50 + ((p - 100) / (ZOOM_MAX - 100)) * 50;
}
