// The Spectrum window's view: which ppm range shows and how tall the peaks are drawn. Pure
// functions, so the zooming, panning and intensity steps can be tested without a window.

/** A ppm range, high to low (the spectrum is drawn high ppm on the left). */
export interface PpmRange { hi: number; lo: number }

/** A drag shorter than this (px) is a click, not a range. */
export const CLICK_PX = 4;
/** Zooming in puts the tallest peak in the range at this fraction of the plot's height. */
export const PEAK_FRACTION = 0.75;
/** The intensity can be zoomed this far out and in (1 = tallest peak at 3/4 of the height). */
export const Y_ZOOM_MIN = 0.05, Y_ZOOM_MAX = 2000;

/** The ppm under a pixel column (0 is the left edge of a plot `w` px wide). */
export function ppmAt(x: number, w: number, r: PpmRange): number {
  return r.hi - (x / Math.max(1, w)) * (r.hi - r.lo);
}

/** The range a drag from x0 to x1 (px) selects, or null for a click (shorter than CLICK_PX). Never
 *  narrower than `minSpan` ppm (widened about its middle). */
export function rangeFromDrag(x0: number, x1: number, w: number, view: PpmRange, minSpan: number): PpmRange | null {
  if (Math.abs(x1 - x0) < CLICK_PX) return null;
  const a = ppmAt(Math.max(0, Math.min(w, x0)), w, view), b = ppmAt(Math.max(0, Math.min(w, x1)), w, view);
  let hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; hi = c + minSpan / 2; lo = c - minSpan / 2; }
  return { hi, lo };
}

/** A range kept inside the full spectrum, its width unchanged (moved back in from an end); null
 *  when it is as wide as the whole spectrum or wider (the full view). */
export function clampRange(r: PpmRange, full: PpmRange): PpmRange | null {
  const span = r.hi - r.lo;
  if (!(span > 0) || span >= full.hi - full.lo - 1e-9) return null;
  let hi = Math.min(full.hi, r.hi);
  if (hi - span < full.lo) hi = full.lo + span;
  return { hi, lo: hi - span };
}

/** The range moved by `dx` px (positive: dragged right, so lower-ppm content moves right and higher
 *  ppm comes into view), kept inside the full spectrum. */
export function panRange(r: PpmRange, dx: number, w: number, full: PpmRange): PpmRange | null {
  const shift = (dx / Math.max(1, w)) * (r.hi - r.lo);
  return clampRange({ hi: r.hi + shift, lo: r.lo + shift }, full);
}

/** The intensity drawn at the full height of the plot, so the tallest peak reaches PEAK_FRACTION of
 *  it, times the intensity zoom (2 draws every peak twice as tall). */
export function fullHeight(tallest: number, yZoom = 1): number {
  return tallest > 0 ? tallest / (PEAK_FRACTION * clampYZoom(yZoom)) : 1;
}

export function clampYZoom(y: number): number {
  return Number.isFinite(y) ? Math.max(Y_ZOOM_MIN, Math.min(Y_ZOOM_MAX, y)) : 1;
}

/** The intensity zoom after one wheel event: up (negative deltaY) makes the peaks taller. `deltaMode`
 *  is the event's (0 pixels, 1 lines, 2 pages); `pinch` is a trackpad pinch (ctrl+wheel, small steps). */
export function wheelZoom(y: number, deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  // one mouse-wheel notch (100 px) is about ×1.2; a pinch's small steps are scaled up to match
  const k = Math.exp(-Math.max(-300, Math.min(300, px)) * (pinch ? 0.01 : 0.0018));
  return clampYZoom(y * k);
}

/** One press of + or − (or Up and Down): ×1.25 or ÷1.25. */
export function stepZoom(y: number, dir: 1 | -1): number {
  return clampYZoom(y * (dir > 0 ? 1.25 : 0.8));
}

/** The intensity zoom while dragging up (negative dy) or down on the left edge, from where the drag started. */
export function dragZoom(y0: number, dy: number): number {
  return clampYZoom(y0 * Math.exp(-dy * 0.01));
}
