// Drawing a chart of Document and Slides modes (a chart with its own data) into a box on the
// page or slide. The chart is laid out at the box's size, so resizing it reflows the chart (its
// text stays the same size) as in Word and PowerPoint, rather than stretching a picture.

import type { SeriesData } from '../sheet/chart';
import { ChartBox, boxData, PX_PER_PT } from '../sheet/chart-box';
import { drawChart, chartCanvas } from './chart-draw';

const data = new WeakMap<ChartBox, SeriesData[]>();

/** The box's series (worked out once: boxes are never changed in place). */
export function chartBoxData(b: ChartBox): SeriesData[] {
  let d = data.get(b);
  if (!d) { d = boxData(b); data.set(b, d); }
  return d;
}

/** Draw the chart into the box x, y, w × h (in the context's units, points). */
export function paintChartBox(ctx: CanvasRenderingContext2D, b: ChartBox, x: number, y: number, w: number, h: number): void {
  const cw = Math.max(1, Math.abs(w) * PX_PER_PT), ch = Math.max(1, Math.abs(h) * PX_PER_PT);
  ctx.save();
  ctx.translate(Math.min(x, x + w), Math.min(y, y + h));
  ctx.scale(1 / PX_PER_PT, 1 / PX_PER_PT);
  try {
    drawChart(ctx, { ...b.chart, w: cw, h: ch }, chartBoxData(b), cw, ch);
  } finally {
    ctx.restore();
  }
}

/** A 1 × 1 picture, where there is no canvas to draw on (tests, and readers run without a page). */
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBApH3oiYAAAAASUVORK5CYII=';

/** Can a 2D canvas be made here at all? */
function canvasAvailable(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
}

/**
 * The chart as a PNG data URL `w` × `h` points, at `scale` pixels per pixel (for the picture other
 * programs see). A canvas too big for the browser (it gives an empty picture, "data:,") or a drawing
 * that fails is tried again at 1 pixel per pixel. If both fail, the picture is a grey box saying so (the
 * chart itself is still saved with its data); only where there is no canvas at all is it a blank pixel.
 */
export function chartBoxPng(b: ChartBox, w: number, h: number, scale = 3): string {
  if (!canvasAvailable()) return BLANK_PNG;
  const cw = Math.max(1, Math.round(w * PX_PER_PT)), ch = Math.max(1, Math.round(h * PX_PER_PT));
  let failure: unknown = null;
  for (const k of scale > 1 ? [scale, 1] : [scale]) {
    try {
      const url = chartCanvas({ ...b.chart, w: cw, h: ch }, chartBoxData(b), k).toDataURL('image/png');
      if (url.startsWith('data:image/png')) return url;
      failure = new Error(`The chart's ${Math.round(cw * k)} × ${Math.round(ch * k)} pixel picture was refused`);
    } catch (e) {
      failure = e;
    }
  }
  console.error('Chart picture not drawn:', failure);
  return warningPng(cw, ch) ?? BLANK_PNG;
}

/** A plain grey box saying the chart's picture couldn't be made, shaped as the chart, for other programs to show in its place. */
function warningPng(cw: number, ch: number): string | null {
  try {
    const k = Math.min(1, 800 / Math.max(cw, ch));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(cw * k));
    c.height = Math.max(1, Math.round(ch * k));
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#bfbfbf';
    g.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
    g.fillStyle = '#595959';
    g.font = `${Math.max(8, Math.min(14, c.height / 6))}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.fillText(CHART_PICTURE_FAILED, c.width / 2, c.height / 2);
    const url = c.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}

/** What the picture other programs show says when the chart couldn't be drawn into it. */
export const CHART_PICTURE_FAILED = 'The chart could not be drawn here. Open it in Chemweave to see it.';
