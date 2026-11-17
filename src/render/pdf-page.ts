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
    return { src: canvas.toDataURL('image/png'), w: own.width, h: own.height, px: { w: canvas.width, h: canvas.height } };
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

/**
 * Every page of a PDF as a picture, sharp enough to print (about 150 dpi, at most 2400 pixels
 * on its longer side), with its size in points; null when the file can't be read (damaged,
 * password-protected, not a PDF). For spectra and PDF figures in a compiled SI.
 */
export async function pdfPages(bytes: Uint8Array): Promise<ObjectPicture[] | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const out: ObjectPicture[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const own = page.getViewport({ scale: 1 });
      const scale = Math.min(150 / 72, 2400 / Math.max(own.width, own.height));
      const view = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(view.width);
      canvas.height = Math.ceil(view.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
      out.push({ src: canvas.toDataURL('image/png'), w: own.width, h: own.height, px: { w: canvas.width, h: canvas.height } });
      page.cleanup();
    }
    return out;
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

/** Where a picture's content is (auto-crop of a spectrum): left, top, right, bottom fractions; null for nothing to cut. */
export async function pictureContentBox(src: string): Promise<[number, number, number, number] | null> {
  const { contentBox } = await import('../si/spectra');
  const img = new Image();
  img.src = src;
  await img.decode();
  // measured at no more than 1000 pixels a side (SI Assistant measures at 100 dpi)
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
  return contentBox(ctx.getImageData(0, 0, w, h).data, w, h);
}
