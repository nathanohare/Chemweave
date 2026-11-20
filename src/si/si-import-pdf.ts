// Import SI, pictures cut out of a PDF SI (SPEC §13u.7, §13u.16; SI Assistant's si_import_pdf.py).
// A PDF holds no structure data, only the drawing, so each compound gets the drawing of its
// structure as a picture (trimmed to its ink), which the user can keep or leave out; the figures
// and tables of its sections are cut out the same way.
//
// Two layouts of a structure are recognized:
// * on its own between the compound's heading and its text (the gap between them, across the
//   text width);
// * in a scheme, with the compound's ID written under it ("5b"): the drawing above the label,
//   between the labels beside it, up to the body text above.
//
// The pictures are drawn by PDF.js at 300 dpi and kept as PNG (SI Assistant keeps a one-page PDF;
// Chemweave has no PDF writer for that). Without a canvas (tests), `cut` gives nothing unless
// replaced.

import { pdfjsLib, pdfSpans } from './ms-read';
import type { Span } from './ms-parse';
import { isIdLabel, STEREO, type ImportPlan } from './si-import';
import { linePlain, toLines } from './si-import-read';
import type { ImportedFigure, ImportedSection } from './si-import-text';

const MIN_GAP = 24;          // pt between a heading and its text that can hold a drawing
const MAX_TEXT_CHARS = 40;   // more text than this in a cut-out: it is not a drawing
const DPI = 300;
const MAX_PIXELS = 3000;     // (the longer side of a cut-out, at most)

/** left, top, right, bottom (pt, y down from the top of the page). */
export type Box = [number, number, number, number];

/** A picture cut out of a page: PNG bytes, and its size in points. */
export interface Cut { data: Uint8Array; ext: string; w: number; h: number }

/**
 * Where the ink is in an RGBA picture drawn on white: [left, top, right, bottom) in pixels; null
 * if it is blank. A few pixels along its edges are not counted (a cut can show a faint line there).
 */
export function inkBox(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, edge = 3, white = 200): [number, number, number, number] | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = edge; y < h - edge; y++) {
    for (let x = edge; x < w - edge; x++) {
      const i = 4 * (y * w + x);
      const gray = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      if (gray >= white) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** A PDF's pages, for cutting pictures out of them: their text pieces, sizes, and parts drawn as pictures. */
export class PdfPages {
  private spansCache = new Map<number, Span[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected constructor(protected doc: any, private destroy: () => void, readonly count: number) {}

  /** The PDF opened (null when it can't be). */
  static async open(bytes: Uint8Array): Promise<PdfPages | null> {
    const pdfjs = await pdfjsLib();
    const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, fontExtraProperties: true, password: '' });
    try {
      const doc = await task.promise;
      return new this(doc, () => { void task.destroy(); }, doc.numPages);
    } catch {
      void task.destroy();
      return null;
    }
  }

  close(): void { this.destroy(); }

  /** The upright text pieces of page `n` (from 1). */
  async spans(n: number): Promise<Span[]> {
    if (!this.spansCache.has(n)) {
      const page = await this.doc.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as { str?: string }[]).filter((i) => 'str' in i) as Parameters<typeof pdfSpans>[0];
      this.spansCache.set(n, pdfSpans(items, page.view[3], () => '').frames[0] ?? []);
      try { page.cleanup(); } catch { /* (being drawn: freed after) */ }
    }
    return this.spansCache.get(n)!;
  }

  /** [width, height] of page `n` (pt). */
  async size(n: number): Promise<[number, number]> {
    const page = await this.doc.getPage(n);
    return [page.view[2] - page.view[0], page.view[3] - page.view[1]];
  }

  /** What is drawn in `box` of page `n`, trimmed to its ink, as a PNG; null if it is blank (or can't be drawn here). */
  async cut(n: number, box: Box): Promise<Cut | null> {
    if (typeof document === 'undefined') return null;
    const page = await this.doc.getPage(n);
    const [bw, bh] = [box[2] - box[0], box[3] - box[1]];
    if (bw <= 0 || bh <= 0) return null;
    const scale = Math.min(DPI / 72, MAX_PIXELS / Math.max(bw, bh));
    const view = page.getViewport({ scale, offsetX: (page.view[0] - box[0]) * scale, offsetY: -box[1] * scale });
    // (a page drawn at 300 dpi is tens of megabytes: the canvases and the page's own data are given back at once, not when the PDF is closed)
    const canvas = document.createElement('canvas');
    let out: HTMLCanvasElement | null = null;
    try {
      canvas.width = Math.max(1, Math.ceil(bw * scale));
      canvas.height = Math.max(1, Math.ceil(bh * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
      const ink = inkBox(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      if (!ink) return null;
      const pad = Math.round(scale * 1.5);
      const [x0, y0] = [Math.max(0, ink[0] - pad), Math.max(0, ink[1] - pad)];
      const [x1, y1] = [Math.min(canvas.width, ink[2] + pad), Math.min(canvas.height, ink[3] + pad)];
      if ((x1 - x0) / scale < 8 || (y1 - y0) / scale < 8) return null;
      out = document.createElement('canvas');
      out.width = x1 - x0;
      out.height = y1 - y0;
      out.getContext('2d')!.drawImage(canvas, -x0, -y0);
      const made = out;
      const blob = await new Promise<Blob | null>((resolve) => made.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return { data: new Uint8Array(await blob.arrayBuffer()), ext: '.png', w: made.width / scale, h: made.height / scale };
    } finally {
      canvas.width = canvas.height = 0;
      if (out) out.width = out.height = 0;
      try { page.cleanup(); } catch { /* (still being drawn elsewhere) */ }
    }
  }
}

function margins(spans: Span[]): [number, number] {
  if (!spans.length) return [72, 540];
  const xs0 = spans.map((s) => s.x0).sort((a, b) => a - b), xs1 = spans.map((s) => s.x1).sort((a, b) => a - b);
  return [xs0[Math.floor(0.05 * (xs0.length - 1))], xs1[Math.floor(0.95 * (xs1.length - 1))]];
}

const plainOf = (s: Span): string => s.text.trim().replace(/\.+$/, '');
/** A label's ID: without its stereo prefix ("(±)-3", "(S)-2a", "rac-5": not part of the ID). */
const STEREO_START = new RegExp('^' + STEREO);
const idOf = (s: Span): string => plainOf(s).replace(STEREO_START, '');

function textInside(spans: Span[], box: Box, skip = ''): number {
  const [x0, y0, x1, y1] = box;
  return spans.filter((s) => s.x0 >= x0 - 1 && s.x1 <= x1 + 1 && s.y0 >= y0 - 1 && s.y1 <= y1 + 1 && (!skip || idOf(s) !== skip)).reduce((n, s) => n + s.text.trim().length, 0);
}

function gapRegion(spans: Span[], headingBottom: number, textTop: number): Box | null {
  const [left, right] = margins(spans);
  if (textTop - headingBottom < MIN_GAP) return null;
  return [left - 2, headingBottom + 1, right + 2, textTop - 1];
}

/** The drawing above the compound's label in a scheme (see the top). */
function labelRegion(spans: Span[], cid: string): Box | null {
  const [left, right] = margins(spans);
  const width = right - left;
  const labels = spans.filter((s) => isIdLabel(plainOf(s)));
  const mid = (s: Span): number => (s.y0 + s.y1) / 2;
  const cx = (s: Span): number => (s.x0 + s.x1) / 2;
  for (const lab of labels.filter((s) => idOf(s) === cid)) {
    // a label, not the ID in running text: nothing else on its line but labels
    if (spans.some((s) => Math.abs(mid(s) - mid(lab)) < 3 && !labels.includes(s) && s.text.trim().length > 2)) continue;
    const row = labels.filter((s) => Math.abs(s.y0 - lab.y0) < 4).sort((a, b) => a.x0 - b.x0);
    const i = row.indexOf(lab);
    let x0 = i > 0 ? (cx(row[i - 1]) + cx(lab)) / 2 : left - 2;
    let x1 = i + 1 < row.length ? (cx(lab) + cx(row[i + 1])) / 2 : right + 2;
    // up to the nearest line of body text above (a line across most of the width)
    const lines = new Map<number, Span[]>();
    for (const s of spans) if (s.y1 < lab.y0 - 1) { const k = Math.round(s.y1); if (!lines.has(k)) lines.set(k, []); lines.get(k)!.push(s); }
    const body = [...lines].filter(([, ss]) => Math.max(...ss.map((s) => s.x1)) - Math.min(...ss.map((s) => s.x0)) > 0.6 * width).map(([y]) => y);
    const top = body.length ? Math.max(...body) + 2 : (spans.length ? Math.min(...spans.map((s) => s.y0)) : 36) - 2;
    const bottom = lab.y0 - 1;
    if (bottom - top < MIN_GAP) continue;
    // never cut through a text: one across an edge (a scheme's conditions) is left out
    for (const s of spans) {
      if (s.y1 < top || s.y0 > bottom || !s.text.trim()) continue;
      if (s.x0 < x0 && x0 < s.x1) x0 = s.x1 + 1;
      if (s.x0 < x1 && x1 < s.x1) x1 = s.x0 - 1;
    }
    if (x1 - x0 < MIN_GAP) continue;
    return [x0, top, x1, bottom];
  }
  return null;
}

/**
 * Cut each PDF compound's structure picture out of the PDF (the SI read for `plan`) into its
 * `picture_pdf` (with `picture_ext`); a compound with a structure already is left alone. Gives
 * how many were found.
 */
export async function addPictures(pdf: PdfPages, plan: ImportPlan, progress?: (done: number, total: number) => boolean | void): Promise<number> {
  let found = 0;
  for (let k = 0; k < plan.compounds.length; k++) {
    if (progress?.(k, plan.compounds.length) === false) return found;      // (stopped)
    const c = plan.compounds[k];
    if (c.structure || !c.geometry) continue;
    let [page] = c.geometry;
    const [, headBottom, textPage, textTop] = c.geometry;
    if (!page || page > pdf.count) continue;
    let picture: Cut | null = null, where = '';
    try {
      if (textPage === page && textTop) {
        const spans = await pdf.spans(page);
        const box = gapRegion(spans, headBottom, textTop);
        if (box && textInside(spans, box) <= MAX_TEXT_CHARS) [picture, where] = [await pdf.cut(page, box), 'between its heading and its text'];
      }
      if (!picture) {
        for (const n of [page, page - 1]) {
          if (n < 1) continue;
          const spans = await pdf.spans(n);
          const box = labelRegion(spans, c.cid);
          if (box && textInside(spans, box, c.cid) <= MAX_TEXT_CHARS) {
            picture = await pdf.cut(n, box);
            where = `above its label “${c.cid}” in a scheme`;
            page = n;
            if (picture) break;
          }
        }
      }
    } catch { picture = null; }      // (one odd page must not stop the others)
    if (picture) {
      c.picture_pdf = picture.data;
      c.picture_ext = picture.ext;
      c.structure_note = `a picture cut out of the PDF (page ${page}, ${where})`;
      found++;
    }
  }
  progress?.(plan.compounds.length, plan.compounds.length);
  return found;
}

/** Whether `box` holds a line of running text (60 characters or more): a figure's labels are shorter. */
function proseInside(spans: Span[], box: Box): boolean {
  const [x0, y0, x1, y1] = box;
  const inside = spans.filter((s) => s.x0 >= x0 - 1 && s.x1 <= x1 + 1 && s.y0 >= y0 - 1 && s.y1 <= y1 + 1);
  return toLines(inside).some((L) => linePlain(L).length >= 60);
}

/**
 * Cut the figures and tables of a PDF SI's sections (SPEC §13u.16) out of their pages: a figure
 * from the text above it to its caption (else below its caption), a table from its caption to its
 * last row, across the text width, trimmed to the ink. Gives how many were cut out; a figure that
 * can't be (nothing there) keeps no picture, and its caption is imported as text.
 */
export async function addFigures(pdf: PdfPages, plan: ImportPlan, goOn?: () => boolean): Promise<number> {
  let found = 0;
  for (const s of (plan.sections ?? []) as ImportedSection[]) {
    for (const fig of s.figures.values() as Iterable<ImportedFigure>) {
      if (fig.kind !== 'cut' || !fig.page || fig.page > pdf.count || fig.data) continue;
      if (goOn && !goOn()) return found;      // (stopped)
      let cut: Cut | null = null;
      try {
        const [, height] = await pdf.size(fig.page);
        const spans = await pdf.spans(fig.page);
        const [left, right] = margins(spans);
        const boxes: [number, number][] = [];
        if (fig.is_table) boxes.push([fig.top + 1, fig.bottom + 2]);
        else {
          boxes.push([fig.top ? fig.top : 0.1 * height, fig.bottom - 1]);
          if (fig.below && fig.below[1] >= 0) boxes.push([fig.below[0] + 1, fig.below[1] ? fig.below[1] - 1 : 0.92 * height]);   // (or below its caption)
        }
        for (let k = 0; k < boxes.length; k++) {
          const [top, bottom] = boxes[k];
          const box: Box = [left - 4, top, right + 4, bottom];
          if (bottom - top < 20 || (k === 1 && proseInside(spans, box))) continue;   // (under a caption, lines of text are no figure)
          cut = await pdf.cut(fig.page, box);
          if (cut) { fig.cut_below = k === 1; break; }
        }
      } catch { cut = null; }        // (one odd page must not stop the others)
      if (cut) {
        fig.data = cut.data;
        fig.ext = cut.ext;
        fig.width_cm = Math.round((cut.w / 72) * 2.54 * 100) / 100;   // (printed at the width it had on the page)
        found++;
      }
    }
  }
  return found;
}
