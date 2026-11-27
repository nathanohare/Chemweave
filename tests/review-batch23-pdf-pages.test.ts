// @vitest-environment jsdom
//
// Review batch 23: PDF pages drawn as pictures (spectra in an SI, embedded PDFs). PDF.js is
// replaced by a stand-in here, so each case controls which page draws and which fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** What the stand-in PDF does: its pages' sizes in points, and the pages whose drawing fails. */
const pdf = { pages: [] as { w: number; h: number }[], broken: new Set<number>(), cleaned: [] as number[], loadFails: false };
const scales: number[] = [];

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: 'stand-in' },
  getDocument: () => ({
    promise: pdf.loadFails ? Promise.reject(new Error('damaged')) : Promise.resolve({
      numPages: pdf.pages.length,
      getPage: async (n: number) => ({
        getViewport: ({ scale }: { scale: number }) => { scales.push(scale); return { width: pdf.pages[n - 1].w * scale, height: pdf.pages[n - 1].h * scale }; },
        render: () => ({ promise: pdf.broken.has(n) ? Promise.reject(new Error('bad content stream')) : Promise.resolve() }),
        cleanup: () => { pdf.cleaned.push(n); },
      }),
    }),
    destroy: async () => undefined,
  }),
}));

const made: HTMLCanvasElement[] = [];
beforeEach(() => {
  pdf.pages = []; pdf.broken = new Set(); pdf.cleaned = []; pdf.loadFails = false;
  scales.length = 0; made.length = 0;
  // a canvas that "draws" (jsdom has none): a 2D context that does nothing, and pictures of it
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = create(tag);
    if (tag === 'canvas') {
      const c = el as HTMLCanvasElement;
      made.push(c);
      c.getContext = (() => ({ fillRect: () => undefined, fillStyle: '' })) as never;
      c.toDataURL = () => 'data:image/png;base64,AAAA';
      c.toBlob = (ok: BlobCallback) => ok(new Blob(['png']));
    }
    return el;
  }) as typeof document.createElement);
});
afterEach(() => { vi.restoreAllMocks(); });

const A4 = { w: 595, h: 842 };

describe('every page of a PDF (F894)', () => {
  it('keeps the pages that drew when one page fails, the failed one marked in its place', async () => {
    const { pdfPages } = await import('../src/render/pdf-page');
    pdf.pages = [A4, A4, A4];
    pdf.broken = new Set([2]);
    const got = await pdfPages(new Uint8Array([1, 2, 3]));
    expect(got).not.toBeNull();
    // page 3 is still the third: its number, and the settings kept for it, stay its own
    expect(got!.map((p) => !!p.failed)).toEqual([false, true, false]);
    expect(got!.every((p) => p.of === 3)).toBe(true);
    expect(decodeURIComponent(got![1].src)).toContain('Page 2 could not be drawn');
    expect([got![1].w, got![1].h]).toEqual([595, 842]);
    // every page's memory let go, the failed one's too
    expect(pdf.cleaned.sort()).toEqual([1, 2, 3]);
  });

  it('is null when the file itself can\'t be opened', async () => {
    const { pdfPages } = await import('../src/render/pdf-page');
    pdf.loadFails = true;
    expect(await pdfPages(new Uint8Array([1]))).toBeNull();
  });
});

describe('a PDF opened page by page (F897)', () => {
  it('empties each page\'s canvas and lets the page go, also when drawing it fails', async () => {
    const { openPdf } = await import('../src/render/pdf-page');
    pdf.pages = [A4, A4];
    pdf.broken = new Set([2]);
    const r = (await openPdf(new Uint8Array([1])))!;
    expect(await r.picture(1)).not.toBeNull();
    expect(await r.picture(2)).toBeNull();
    expect(pdf.cleaned).toEqual([1, 2]);
    expect(made.map((c) => [c.width, c.height])).toEqual([[0, 0], [0, 0]]);
  });
});

describe('the first page of an embedded PDF (F893)', () => {
  it('draws a poster page no bigger than 2400 pixels on its longer side', async () => {
    const { pdfFirstPage } = await import('../src/render/pdf-page');
    // ISO 216 A0: 841 × 1189 mm, 2384 × 3370 pt
    pdf.pages = [{ w: 2384, h: 3370 }];
    const got = (await pdfFirstPage(new Uint8Array([1])))!;
    expect(Math.max(got.px!.w, got.px!.h)).toBeLessThanOrEqual(2400);
    expect(got.w).toBe(2384);
    // an ordinary page still at twice its size
    pdf.pages = [A4];
    expect((await pdfFirstPage(new Uint8Array([1])))!.px).toEqual({ w: 2 * 595, h: 2 * 842 });
  });
});

describe('PDFs kept for the live preview (F202, F895)', () => {
  it('keeps more than 40 PDFs drawn in turn, so a second pass draws none again', async () => {
    const { pdfPagesKept } = await import('../src/render/pdf-page');
    let drawn = 0;
    const draw = async () => { drawn++; return [{ src: 'data:image/png;base64,AAAA', w: 10, h: 10, of: 1 }]; };
    // (each compile reads every file afresh: new arrays with the same bytes)
    const file = (i: number) => new Uint8Array([i, 7, 7, 7]);
    for (let i = 0; i < 60; i++) await pdfPagesKept(file(i), 1, draw);
    expect(drawn).toBe(60);
    for (let i = 0; i < 60; i++) await pdfPagesKept(file(i), 1, draw);
    expect(drawn).toBe(60);
    // a different file of the same length is drawn
    await pdfPagesKept(new Uint8Array([0, 7, 7, 8]), 1, draw);
    expect(drawn).toBe(61);
  });

  it('draws a PDF again when one of its pages could not be drawn last time', async () => {
    const { pdfPagesKept, failedPage } = await import('../src/render/pdf-page');
    let drawn = 0;
    const draw = async () => { drawn++; return [failedPage(1, A4, 1)]; };
    await pdfPagesKept(new Uint8Array([90, 91]), 1, draw);
    await new Promise((ok) => setTimeout(ok, 0));
    await pdfPagesKept(new Uint8Array([90, 91]), 1, draw);
    expect(drawn).toBe(2);
  });

  it('tries a PDF again after drawing it failed', async () => {
    const { pdfPagesKept } = await import('../src/render/pdf-page');
    let calls = 0;
    const draw = () => { calls++; return calls === 1 ? Promise.reject(new Error('chunk failed to load')) : Promise.resolve([]); };
    const bytes = new Uint8Array([200, 201, 202]);
    await expect(pdfPagesKept(bytes, 1, draw)).rejects.toThrow('chunk');
    await expect(pdfPagesKept(bytes, 1, draw)).resolves.toEqual([]);
    expect(calls).toBe(2);
  });
});

describe('a picture\'s pixels read once (F896)', () => {
  it('reads them again after a failed read', async () => {
    const { pixelsOnceFor } = await import('../src/render/pdf-page');
    let reads = 0;
    const read = () => { reads++; return reads === 1 ? Promise.reject(new Error('decode failed')) : Promise.resolve({ data: new Uint8ClampedArray(4), w: 1, h: 1 }); };
    await expect(pixelsOnceFor('data:image/png;base64,BBBB', read)).rejects.toThrow('decode');
    await Promise.resolve();
    await expect(pixelsOnceFor('data:image/png;base64,BBBB', read)).resolves.toMatchObject({ w: 1 });
    expect(reads).toBe(2);
  });
});
