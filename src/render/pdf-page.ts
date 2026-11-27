// The first page of a PDF as a picture (an embedded PDF shows it, as Word shows one), drawn by
// PDF.js, which loads only when a PDF is first put in. Its "legacy" build, which brings the
// newest JavaScript it uses with it: the Mac and Linux app windows don't have all of it.

import type { ObjectPicture } from './object-picture';

/**
 * The first page at twice its size (sharp when printed), at most 2400 pixels on its longer side as
 * pdfPages draws pages (a poster or banner PDF would make a canvas too big to draw), with its size
 * in points; null when the file can't be drawn.
 */
export async function pdfFirstPage(bytes: Uint8Array): Promise<ObjectPicture | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('../pdf-worker?worker&url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const own = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale: Math.min(2, 2400 / Math.max(own.width, own.height)) });
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

/**
 * A PDF page drawn as a picture, with how many pages the whole PDF has. `failed`: the page could
 * not be drawn, and the picture only says so (it keeps the page's place and size).
 */
export interface PdfPagePicture extends ObjectPicture { of: number; failed?: true }

/** A stand-in for page `n` that could not be drawn: a pale box that says so, the page's size (A4 when that isn't known either). */
export function failedPage(n: number, size: { w: number; h: number } | null, of: number): PdfPagePicture {
  const { w, h } = size && size.w > 0 && size.h > 0 ? size : { w: 595, h: 842 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f4f4f4" stroke="#999"/>` +
    `<text x="${w / 2}" y="${h / 2}" font-family="Arial, sans-serif" font-size="${Math.max(8, Math.min(w, h) / 30)}" fill="#666" text-anchor="middle">Page ${n} could not be drawn</text></svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, w, h, px: { w: Math.round(w), h: Math.round(h) }, of, failed: true };
}

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
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('../pdf-worker?worker&url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const out: PdfPagePicture[] = [];
    const last = most && most > 0 ? Math.min(doc.numPages, most) : doc.numPages;
    for (let n = 1; n <= last; n++) {
      // (a page that can't be drawn, a broken one in a long PDF, keeps its place as a marked
      // stand-in, so the pages after it keep their numbers; the others are kept)
      let page: Awaited<ReturnType<typeof doc.getPage>>;
      try { page = await doc.getPage(n); } catch { out.push(failedPage(n, null, doc.numPages)); continue; }
      const own = page.getViewport({ scale: 1 });
      const scale = Math.min(150 / 72, 2400 / Math.max(own.width, own.height));
      const view = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      const px = { w: canvas.width, h: canvas.height };
      let drawn = false;
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
        out.push({ src: canvas.toDataURL('image/png'), w: own.width, h: own.height, px, of: doc.numPages });
        drawn = true;
      } catch {
        // (this page only)
      } finally {
        // (its memory freed now, not when the canvas is collected)
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        if (!drawn) out.push(failedPage(n, { w: own.width, h: own.height }, doc.numPages));
      }
    }
    // (no page at all could be drawn: as a file that can't be read)
    return !last || out.some((p) => !p.failed) ? out : null;
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

/**
 * PDFs drawn lately (by their bytes): the live preview draws the same ones again after each
 * change, every PDF of the project in turn, so the pictures are kept by how much memory they
 * take, not by how many there are (an SI with hundreds of spectra keeps them all while they
 * fit). `cost`: the file's bytes and its pictures' (once drawn).
 */
const drawnLately: { key: string; most: number; pages: Promise<PdfPagePicture[] | null>; cost: number }[] = [];
/** At most this much kept, in characters of the pages' pictures, and never more than this many PDFs. */
const LATELY_BYTES = 200e6;
const LATELY_MOST = 2000;

/**
 * As pdfPages, the PDFs drawn lately kept (for the live preview, which compiles often). A PDF is
 * known by its length and a 64-bit fingerprint of its bytes, worked out in one pass (the preview
 * reads each file afresh at every compile, so nothing about the bytes themselves can be kept).
 */
export function pdfPagesKept(bytes: Uint8Array, most = 1, draw: (bytes: Uint8Array, most?: number) => Promise<PdfPagePicture[] | null> = pdfPages): Promise<PdfPagePicture[] | null> {
  const key = `${bytes.length}:${fingerprint64(bytes)}`;
  const at = drawnLately.findIndex((d) => d.key === key && d.most === most);
  if (at >= 0) {
    const [hit] = drawnLately.splice(at, 1);
    drawnLately.push(hit);
    return hit.pages;
  }
  const pages = draw(bytes, most);
  const entry = { key, most, pages, cost: 0 };
  drawnLately.push(entry);
  const forget = () => { const i = drawnLately.indexOf(entry); if (i >= 0) drawnLately.splice(i, 1); };
  // (a failure, the PDF reader not loading for one, is tried again next time)
  // (as is a PDF with a page that could not be drawn)
  pages.then((got) => { if (got?.some((p) => p.failed)) { forget(); return; } entry.cost += (got ?? []).reduce((n, p) => n + p.src.length, 0); trim(); }, forget);
  trim();
  return pages;
}

/** The PDFs used longest ago forgotten until what is kept fits. */
function trim(): void {
  let total = drawnLately.reduce((n, d) => n + d.cost, 0);
  while (drawnLately.length > 1 && (total > LATELY_BYTES || drawnLately.length > LATELY_MOST)) total -= drawnLately.shift()!.cost;
}

/** A quick fingerprint of some bytes (FNV-1a), to tell files apart. */
export function fingerprint(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

/**
 * A 64-bit fingerprint of some bytes in one pass: FNV-1a and a second 32-bit FNV-1a run with
 * another start and each byte's position mixed in, side by side (so two different files of the
 * same length are very unlikely to share it).
 */
export function fingerprint64(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i] ^ (i & 0xff), 0x01000193) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * A PDF's text, page by page, a line for each row of words (pieces on the same baseline joined,
 * a wide gap kept as spaces so table columns stay apart), for reading numbers from an
 * instrument's report. Throws when the file can't be opened.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('../pdf-worker?worker&url')).default;
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
function pixelsOnce(src: string, read: typeof picturePixels = picturePixels): Promise<{ data: Uint8ClampedArray; w: number; h: number } | null> {
  if (lastPixels?.src !== src) {
    const got = read(src);
    lastPixels = { src, got };
    // (a failure isn't kept: kept() tries again, and so must this)
    got.catch(() => { if (lastPixels?.got === got) lastPixels = null; });
  }
  return lastPixels.got;
}
/** For tests: pixelsOnce with its own reader. */
export const pixelsOnceFor = (src: string, read: (src: string) => Promise<{ data: Uint8ClampedArray; w: number; h: number } | null>) => pixelsOnce(src, read);
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
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('../pdf-worker?worker&url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  let doc: Awaited<typeof task.promise>;
  try { doc = await task.promise; } catch { void task.destroy(); return null; }
  return {
    count: doc.numPages,
    async size(n) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); return { w: v.width, h: v.height }; },
    async picture(n) {
      let page: Awaited<ReturnType<typeof doc.getPage>>;
      try { page = await doc.getPage(n); } catch { return null; }
      const canvas = document.createElement('canvas');
      try {
        const own = page.getViewport({ scale: 1 });
        const view = page.getViewport({ scale: Math.min(150 / 72, 2400 / Math.max(own.width, own.height)) });
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
        return await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
      } catch {
        return null;
      } finally {
        // (its memory freed now, as pdfPages does, and the page's whether or not it drew)
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    },
    close() { void task.destroy(); },
  };
}
