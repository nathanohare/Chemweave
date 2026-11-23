// The first page of a PDF as a picture (an embedded PDF shows it, as Word shows one), drawn by
// PDF.js, which loads only when a PDF is first put in. Its "legacy" build, which brings the
// newest JavaScript it uses with it: the Mac and Linux app windows don't have all of it.

import type { ObjectPicture } from './object-picture';

/** The first page at twice its size (sharp when printed), with its size in points; null when the file can't be drawn. */
export async function pdfFirstPage(bytes: Uint8Array): Promise<ObjectPicture | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const own = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
    const px = { w: canvas.width, h: canvas.height };
    const src = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 0;   // (its memory freed now)
    return { src, w: own.width, h: own.height, px };
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

/** A PDF page drawn as a picture, with how many pages the whole PDF has. */
export interface PdfPagePicture extends ObjectPicture { of: number }

/**
 * Every page of a PDF as a picture (or only the first `most`), sharp enough to print (about 150
 * dpi, at most 2400 pixels on its longer side), with its size in points; null when the file can't
 * be read (damaged, password-protected, not a PDF). For spectra and PDF figures in a compiled SI.
 * Each page is drawn on a canvas that is emptied once its picture is taken, so a long PDF (or
 * hundreds of spectra) doesn't keep a canvas's memory for every page until it is collected.
 */
export async function pdfPages(bytes: Uint8Array, most?: number): Promise<PdfPagePicture[] | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const out: PdfPagePicture[] = [];
    const last = most && most > 0 ? Math.min(doc.numPages, most) : doc.numPages;
    for (let n = 1; n <= last; n++) {
      const page = await doc.getPage(n);
      const own = page.getViewport({ scale: 1 });
      const scale = Math.min(150 / 72, 2400 / Math.max(own.width, own.height));
      const view = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      const px = { w: canvas.width, h: canvas.height };
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
        out.push({ src: canvas.toDataURL('image/png'), w: own.width, h: own.height, px, of: doc.numPages });
      } finally {
        // (its memory freed now, not when the canvas is collected)
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return out;
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

/** PDFs drawn lately (by their bytes): the live preview draws the same ones again after each change. */
const drawnLately: { key: string; bytes: Uint8Array; most: number; pages: Promise<PdfPagePicture[] | null> }[] = [];
const LATELY = 40;

/** As pdfPages, the last few PDFs drawn kept (for the live preview, which compiles often). */
export function pdfPagesKept(bytes: Uint8Array, most = 1): Promise<PdfPagePicture[] | null> {
  const key = `${bytes.length}:${fingerprint(bytes)}`;
  const at = drawnLately.findIndex((d) => d.key === key && d.most === most && sameBytes(d.bytes, bytes));
  if (at >= 0) {
    const [hit] = drawnLately.splice(at, 1);
    drawnLately.push(hit);
    return hit.pages;
  }
  const pages = pdfPages(bytes, most);
  drawnLately.push({ key, bytes, most, pages });
  if (drawnLately.length > LATELY) drawnLately.shift();
  return pages;
}

/** A quick fingerprint of some bytes (FNV-1a), to tell files apart. */
export function fingerprint(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A PDF's text, page by page, a line for each row of words (pieces on the same baseline joined,
 * a wide gap kept as spaces so table columns stay apart), for reading numbers from an
 * instrument's report. Throws when the file can't be opened.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      type Piece = { x: number; y: number; w: number; h: number; s: string };
      const pieces: Piece[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str) continue;
        const t = it.transform as number[];
        pieces.push({ x: t[4], y: t[5], w: it.width, h: Math.abs(t[3]) || it.height || 10, s: it.str });
      }
      // rows top to bottom; a piece joins a row when its baseline is within a third of its height
      pieces.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows: Piece[][] = [];
      for (const pc of pieces) {
        const row = rows.find((r) => Math.abs(r[0].y - pc.y) <= Math.max(1, pc.h / 3));
        if (row) row.push(pc); else rows.push([pc]);
      }
      const lines = rows.map((r) => {
        r.sort((a, b) => a.x - b.x);
        let line = '', end: number | null = null;
        for (const pc of r) {
          if (end !== null) {
            const gap = pc.x - end;
            if (gap > pc.h * 1.5) line += '    ';
            else if (gap > pc.h * 0.15 && !line.endsWith(' ') && !pc.s.startsWith(' ')) line += ' ';
          }
          line += pc.s;
          end = pc.x + pc.w;
        }
        return line.trimEnd();
      });
      pages.push(lines.join('\n'));
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    void task.destroy();
  }
}

/** A picture's pixels, drawn on white at no more than 1000 pixels a side (SI Assistant measures at 100 dpi). */
async function picturePixels(src: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  canvas.width = canvas.height = 0;   // (its memory freed now)
  return { data, w, h };
}

/**
 * The pixels read once for a picture asked about twice in a row (its content box, then its ink
 * map), and each answer kept for the pictures seen lately: every relayout of the live preview,
 * and each spectrum shown again on its page, asks again.
 */
let lastPixels: { src: string; got: Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> } | null = null;
function pixelsOnce(src: string): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  if (lastPixels?.src !== src) lastPixels = { src, got: picturePixels(src) };
  return lastPixels.got;
}
const KEPT_ANSWERS = 64;
function kept<T>(memo: Map<string, Promise<T>>, src: string, work: () => Promise<T>): Promise<T> {
  const hit = memo.get(src);
  if (hit) { memo.delete(src); memo.set(src, hit); return hit; }   // (the most lately used last)
  const got = work();
  memo.set(src, got);
  got.catch(() => memo.delete(src));   // (a failure is tried again next time)
  while (memo.size > KEPT_ANSWERS) memo.delete(memo.keys().next().value as string);
  return got;
}
const contentBoxes = new Map<string, Promise<[number, number, number, number] | null>>();
const inkMaps = new Map<string, Promise<import('../si/spectra').InkMap | null>>();

/** Where a picture's content is (auto-crop of a spectrum): left, top, right, bottom fractions; null for nothing to cut. */
export function pictureContentBox(src: string): Promise<[number, number, number, number] | null> {
  return kept(contentBoxes, src, async () => {
    const { contentBox } = await import('../si/spectra');
    const px = await pixelsOnce(src);
    return px ? contentBox(px.data, px.w, px.h) : null;
  });
}

/** Where a picture has ink, for placing a structure box on blank paper (auto placement): looked at no more than 1000 pixels a side. */
export function pictureInkMap(src: string): Promise<import('../si/spectra').InkMap | null> {
  return kept(inkMaps, src, async () => {
    const { inkMapOf } = await import('../si/spectra');
    const px = await pixelsOnce(src);
    return px ? inkMapOf(px.data, px.w, px.h) : null;
  });
}

/** A PDF opened to draw its pages one at a time, each when it is needed (a long PDF shown on screen); close() frees it. */
export interface PdfPageReader {
  count: number;
  /** A page's size in points (1-based). */
  size(n: number): Promise<{ w: number; h: number }>;
  /** A page as a PNG picture, as sharp as pdfPages draws it; null when it can't be drawn. */
  picture(n: number): Promise<Blob | null>;
  close(): void;
}

/** The PDF opened for drawing its pages one at a time; null when the file can't be read. */
export async function openPdf(bytes: Uint8Array): Promise<PdfPageReader | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let doc: Awaited<typeof task.promise>;
  try { doc = await task.promise; } catch { void task.destroy(); return null; }
  return {
    count: doc.numPages,
    async size(n) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); return { w: v.width, h: v.height }; },
    async picture(n) {
      try {
        const page = await doc.getPage(n);
        const own = page.getViewport({ scale: 1 });
        const view = page.getViewport({ scale: Math.min(150 / 72, 2400 / Math.max(own.width, own.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
        page.cleanup();
        return await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      } catch {
        return null;
      }
    },
    close() { void task.destroy(); },
  };
}
