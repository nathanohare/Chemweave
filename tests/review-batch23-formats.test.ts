// Review batch 23 (PDF, EMF, EPS, TIFF and WMF): pictures, outlined text, see-through text,
// rounded corners and damaged files. Every file here is built in the test, record by record,
// from the published specifications cited beside each case.

import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import type { Item, ImageItem } from '../src/render/vector';
import { itemsToEmf, itemsToEmfWithPictures, placed, PICTURE_DPI, type EmfPixels } from '../src/render/emf';
import { emfToSvg, decodeDib } from '../src/render/emf-read';
import { itemsToEps } from '../src/render/eps';
import { writePdf, type PdfImage } from '../src/io/pdf';
import { lzw } from '../src/render/tiff';
import { emfInWmf } from '../src/render/wmf-read';

const BOX = { x1: 0, y1: 0, x2: 200, y2: 100 };
const SRC = 'data:image/png;base64,AAAA';

/** Each record of an EMF: its type and where it starts ([MS-EMF] 2.3: Type, then Size, in every record). */
function records(emf: Uint8Array): { type: number; at: number; size: number }[] {
  const dv = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
  const out: { type: number; at: number; size: number }[] = [];
  for (let at = 0; at + 8 <= emf.length;) {
    const type = dv.getUint32(at, true), size = dv.getUint32(at + 4, true);
    out.push({ type, at, size });
    if (size < 8) break;
    at += size;
  }
  return out;
}

/** The pixels (RGBA, top row first) of a PNG written without filters, as the EMF reader writes them. */
function pngPixels(href: string): { w: number; h: number; rgba: number[] } {
  const b = Uint8Array.from(atob(href.replace(/^data:image\/png;base64,/, '')), (c) => c.charCodeAt(0));
  const dv = new DataView(b.buffer);
  let at = 8, w = 0, h = 0;
  const idat: Uint8Array[] = [];
  while (at < b.length) {
    const len = dv.getUint32(at), type = String.fromCharCode(...b.subarray(at + 4, at + 8));
    if (type === 'IHDR') { w = dv.getUint32(at + 8); h = dv.getUint32(at + 12); }
    if (type === 'IDAT') idat.push(b.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = unzlibSync(idat.length === 1 ? idat[0] : new Uint8Array(idat.flatMap((p) => [...p])));
  const rgba: number[] = [];
  for (let y = 0; y < h; y++) rgba.push(...raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)));
  return { w, h, rgba };
}

// ---------------------------------------------------------------- an EMF built by hand

/** Builds an EMF a record at a time, with a header for a 1000 × 500 pixel picture on a 100 px/mm device ([MS-EMF] 2.3.4.2). */
class Emf {
  private recs: Uint8Array[] = [];
  rec(type: number, ...ints: number[]): this {
    const b = new DataView(new ArrayBuffer(8 + ints.length * 4));
    b.setUint32(0, type, true); b.setUint32(4, b.byteLength, true);
    ints.forEach((v, i) => b.setInt32(8 + i * 4, v | 0, true));
    this.recs.push(new Uint8Array(b.buffer));
    return this;
  }
  /** A record whose body (after Type and Size) is given as bytes. */
  raw(type: number, body: Uint8Array): this {
    const out = new Uint8Array(8 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, type, true); dv.setUint32(4, out.length, true);
    out.set(body, 8);
    this.recs.push(out);
    return this;
  }
  bytes(): Uint8Array {
    const header = new DataView(new ArrayBuffer(108));
    [1, 108, 0, 0, 999, 499, 0, 0, 1000, 500, 0x464d4520, 0x10000, 0, 0, 0, 0, 0, 0, 10000, 10000, 100, 100, 0, 0, 0, 100000, 100000].forEach((v, i) => header.setInt32(i * 4, v | 0, true));
    const eof = new Uint8Array(20);
    new DataView(eof.buffer).setUint32(0, 14, true); new DataView(eof.buffer).setUint32(4, 20, true);
    const parts = [new Uint8Array(header.buffer), ...this.recs, eof];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
}

/** A BITMAPINFOHEADER ([MS-WMF] BitmapInfoHeader): 40 bytes, BI_RGB. */
function bmiHeader(w: number, h: number, bpp: number): Uint8Array {
  const b = new DataView(new ArrayBuffer(40));
  b.setUint32(0, 40, true); b.setInt32(4, w, true); b.setInt32(8, h, true); b.setUint16(12, 1, true); b.setUint16(14, bpp, true);
  return new Uint8Array(b.buffer);
}

/**
 * An EMR_STRETCHDIBITS record body ([MS-EMF] 2.3.1.7): Bounds, xDest, yDest, xSrc, ySrc, cxSrc,
 * cySrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, UsageSrc, BitBltRasterOperation (SRCCOPY
 * 0x00CC0020), cxDest, cyDest, then the header and the bits.
 */
function stretchDibits(bmi: Uint8Array, bits: Uint8Array, src: [number, number, number, number], dest: [number, number, number, number]): Uint8Array {
  const fixed = 80;
  const out = new Uint8Array(fixed - 8 + bmi.length + bits.length);
  const dv = new DataView(out.buffer);
  const ints = [0, 0, 1000, 500, dest[0], dest[1], ...src, fixed, bmi.length, fixed + bmi.length, bits.length, 0, 0x00cc0020, dest[2], dest[3]];
  ints.forEach((v, i) => dv.setInt32(i * 4, v | 0, true));
  out.set(bmi, fixed - 8);
  out.set(bits, fixed - 8 + bmi.length);
  return out;
}

/**
 * An EMR_ALPHABLEND record body ([MS-EMF] 2.3.1.1): Bounds, xDest, yDest, cxDest, cyDest,
 * BLENDFUNCTION (BlendOperation, BlendFlags, SrcConstantAlpha, AlphaFormat), xSrc, ySrc,
 * XformSrc, BkColorSrc, UsageSrc, offBmiSrc, cbBmiSrc, offBitsSrc, cbBitsSrc, cxSrc, cySrc.
 */
function alphaBlend(bmi: Uint8Array, bits: Uint8Array, w: number, h: number, constant: number, format: number): Uint8Array {
  const fixed = 108;
  const out = new Uint8Array(fixed - 8 + bmi.length + bits.length);
  const dv = new DataView(out.buffer);
  [0, 0, 1000, 500, 0, 0, 1000, 500].forEach((v, i) => dv.setInt32(i * 4, v, true));
  out.set([0, 0, constant, format], 32);
  dv.setInt32(36, 0, true); dv.setInt32(40, 0, true);
  [1, 0, 0, 1, 0, 0].forEach((v, i) => dv.setFloat32(44 + i * 4, v, true));
  [0, 0, fixed, bmi.length, fixed + bmi.length, bits.length, w, h].forEach((v, i) => dv.setInt32(68 + i * 4, v, true));
  out.set(bmi, fixed - 8);
  out.set(bits, fixed - 8 + bmi.length);
  return out;
}

const hrefs = (svg: string) => [...svg.matchAll(/href="(data:image\/png;base64,[^"]+)"/g)].map((m) => m[1]);

// ---------------------------------------------------------------- writing EMF

describe('EMF export keeps pictures (F199)', () => {
  // a 2 × 1 picture: opaque red, then half see-through blue
  const px: EmfPixels = { w: 2, h: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) };
  const pic: ImageItem = { kind: 'image', src: SRC, x: 10, y: 20, w: 40, h: 20 };

  it('draws a picture as an EMR_ALPHABLEND bitmap when its pixels are given', () => {
    const emf = itemsToEmf([pic], BOX, (it) => placed(it, px));
    const r = records(emf).find((x) => x.type === 114)!;
    expect(r).toBeTruthy();
    const dv = new DataView(emf.buffer, emf.byteOffset + r.at);
    // destination in hundredths of a point (the file's logical unit)
    expect([24, 28, 32, 36].map((o) => dv.getInt32(o, true))).toEqual([1000, 2000, 4000, 2000]);
    // BLENDFUNCTION: AC_SRC_OVER, no flags, SrcConstantAlpha 255, AC_SRC_ALPHA
    expect([40, 41, 42, 43].map((o) => dv.getUint8(o))).toEqual([0, 0, 255, 1]);
    expect([dv.getInt32(100, true), dv.getInt32(104, true)]).toEqual([2, 1]);
    const bmi = dv.getUint32(84, true), bits = dv.getUint32(92, true);
    expect([dv.getUint32(bmi, true), dv.getInt32(bmi + 4, true), dv.getInt32(bmi + 8, true), dv.getUint16(bmi + 14, true), dv.getUint32(bmi + 16, true)]).toEqual([40, 2, 1, 32, 0]);
    // blue, green, red, alpha, premultiplied by alpha (the AC_SRC_ALPHA blend equations)
    expect(Array.from(new Uint8Array(emf.buffer, emf.byteOffset + r.at + bits, 8))).toEqual([0, 0, 255, 255, 128, 0, 0, 128]);
  });

  it('leaves a picture out when it has no pixels for it', () => {
    expect(records(itemsToEmf([pic], BOX)).some((x) => x.type === 114)).toBe(false);
  });

  it('reads the pictures\' pixels first for a saved file, and shows them flipped as they are', async () => {
    const emf = await itemsToEmfWithPictures([{ ...pic, flipH: true }], BOX, async () => px);
    const shown = emfToSvg(emf)!;
    const [href] = hrefs(shown.svg);
    expect(href).toBeTruthy();
    const got = pngPixels(href);
    // mirrored: the see-through blue on the left, the red on the right
    const left = got.rgba.slice(0, 4), right = got.rgba.slice((got.w - 1) * 4, got.w * 4);
    expect(left[2]).toBeGreaterThan(200);
    expect(left[3]).toBeLessThan(200);
    expect(right).toEqual([255, 0, 0, 255]);
  });
});

describe('pictures made again for the EMF (F199, round 2)', () => {
  const rgbaAt = (p: EmfPixels, x: number, y: number) => Array.from(p.rgba.slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 4));
  const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], WHITE = [255, 255, 255, 255];

  it('turns a picture clockwise: its left edge goes to the top', () => {
    // red on the left, blue on the right, 40 × 20 points, turned 90 degrees
    const got = placed({ kind: 'image', src: SRC, x: 0, y: 0, w: 40, h: 20, rot: 90 }, { w: 2, h: 1, rgba: new Uint8Array([...RED, ...BLUE]) })!;
    expect([got.pixels.w, got.pixels.h]).toEqual([1, 2]);
    expect(rgbaAt(got.pixels, 0, 0)).toEqual(RED);
    expect(rgbaAt(got.pixels, 0, 1)).toEqual(BLUE);
    // its box turned about its middle (20, 10): 20 wide and 40 high
    expect([got.x, got.y, got.w, got.h].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, -10, 20, 40]);
  });

  it('keeps only the part a cropped picture shows', () => {
    // red, green, blue, white; a quarter cut off each side: green and blue show
    const got = placed({ kind: 'image', src: SRC, x: 0, y: 0, w: 20, h: 10, crop: { l: 0.25, t: 0, r: 0.25, b: 0 } }, { w: 4, h: 1, rgba: new Uint8Array([...RED, ...GREEN, ...BLUE, ...WHITE]) })!;
    expect([got.pixels.w, got.pixels.h]).toEqual([2, 1]);
    expect(rgbaAt(got.pixels, 0, 0)).toEqual(GREEN);
    expect(rgbaAt(got.pixels, 1, 0)).toEqual(BLUE);
  });

  it('makes the corners of a rounded picture see-through', () => {
    // a 10-point square with corners of radius 5: a circle
    const got = placed({ kind: 'image', src: SRC, x: 0, y: 0, w: 10, h: 10, radius: 5 }, { w: 10, h: 10, rgba: new Uint8Array(400).fill(255) })!;
    expect(rgbaAt(got.pixels, 0, 0)[3]).toBe(0);
    expect(rgbaAt(got.pixels, 5, 5)).toEqual(WHITE);
  });

  it('keeps no more than 300 pixels an inch of where the picture is drawn', () => {
    // 1200 × 1200 pixels drawn one inch (72 points) square: 300 × 300 kept, the colour kept
    const big = { w: 1200, h: 1200, rgba: new Uint8Array(1200 * 1200 * 4).fill(255) };
    for (let i = 0; i < big.rgba.length; i += 4) big.rgba[i] = 0;
    const got = placed({ kind: 'image', src: SRC, x: 0, y: 0, w: 72, h: 72 }, big)!;
    expect(PICTURE_DPI).toBe(300);
    expect([got.pixels.w, got.pixels.h]).toEqual([300, 300]);
    expect(rgbaAt(got.pixels, 150, 150)).toEqual([0, 255, 255, 255]);
    // a small picture keeps its own pixels
    const small = { w: 2, h: 1, rgba: new Uint8Array([...RED, ...BLUE]) };
    expect(placed({ kind: 'image', src: SRC, x: 0, y: 0, w: 72, h: 36 }, small)!.pixels).toBe(small);
  });
});

describe('outline-only text in EMF (F200)', () => {
  const hollow: Item = { kind: 'text', text: 'Hi', x: 10, y: 50, size: 12, family: 'Arial', bold: false, italic: false, color: '#ff0000', widths: [8, 3], stroke: 0.5 };

  it('writes the letters inside a path bracket and strokes it, not as filled text', () => {
    const types = records(itemsToEmf([hollow], BOX)).map((r) => r.type);
    // EMR_BEGINPATH 59, EMR_EXTTEXTOUTW 84, EMR_ENDPATH 60, EMR_STROKEPATH 64 ([MS-EMF] 2.1.1);
    // GDI's BeginPath takes ExtTextOut among the functions that add to the path
    const at = types.indexOf(84);
    expect(types[at - 1]).toBe(59);
    expect(types[at + 1]).toBe(60);
    expect(types.indexOf(64)).toBeGreaterThan(at);
    // no text colour set: the letters aren't filled
    expect(types).not.toContain(24);
  });

  it('is read back as outlined letters', () => {
    const svg = emfToSvg(itemsToEmf([hollow], BOX))!.svg;
    expect(svg).toMatch(/<text[^>]*fill="none" stroke="#ff0000"[^>]*>Hi<\/text>/);
  });
});

// ---------------------------------------------------------------- EPS

describe('EPS pictures and outlined text (F201, F883)', () => {
  const image = async (): Promise<PdfImage> => ({ kind: 'raw', w: 1, h: 1, rgb: new Uint8Array([255, 0, 0]), alpha: null });

  it('turns and flips a picture about its middle before cutting it to its box', async () => {
    const eps = await itemsToEps([{ kind: 'image', src: SRC, x: 20, y: 10, w: 40, h: 20, rot: 30, flipH: true }], BOX, image);
    // PostScript Language Reference: translate, rotate and scale change the user space
    // that the rectclip and the image after them are drawn in
    expect(eps).toContain('gsave 40 20 translate 30 rotate -1 1 scale -40 -20 translate 20 10 40 20 rectclip');
  });

  it('rounds the cut of a picture with rounded corners', async () => {
    const eps = await itemsToEps([{ kind: 'image', src: SRC, x: 20, y: 10, w: 40, h: 20, radius: 5 }], BOX, image);
    expect(eps).not.toContain('rectclip');
    expect(eps).toMatch(/gsave np 25 10 m .* c .* clip np/);
  });

  it('draws outline-only letters by their outline (charpath, then stroke)', async () => {
    const eps = await itemsToEps([{ kind: 'text', text: 'Hi', x: 10, y: 50, size: 12, family: 'Arial', bold: false, italic: false, color: '#ff0000', widths: [8, 3], stroke: 0.5 }], BOX, image);
    expect(eps).toContain('(Hi) false charpath');
    expect(eps).toContain('0.5 w 1 J 1 j S');
    expect(eps).not.toContain('(Hi) show');
  });
});

// ---------------------------------------------------------------- PDF

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const pageContent = (pdf: Uint8Array): string => {
  const s = latin1(pdf);
  return [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => {
    try { return latin1(unzlibSync(Uint8Array.from(m[1], (c) => c.charCodeAt(0)))); } catch { return ''; }
  }).find((c) => c.startsWith('1 0 0 -1 0 ')) ?? '';
};
const noImage = async () => null;

describe('PDF export (F583, F584, F585)', () => {
  it('writes a link whose address holds half a character pair, rather than failing', async () => {
    const pdf = await writePdf([{ w: 200, h: 100, items: [], links: [{ x: 0, y: 0, w: 10, h: 10, uri: 'https://example.org/a\ud800b' }] }], { image: noImage });
    // RFC 3986 §2.5: characters as UTF-8, percent-encoded; U+FFFD is EF BF BD
    expect(latin1(pdf)).toContain('/URI (https://example.org/a%EF%BF%BDb)');
  });

  it('keeps the see-through of text drawn in a see-through color', async () => {
    const text: Item = { kind: 'text', text: 'Faint', x: 10, y: 50, size: 12, family: 'Arial', bold: false, italic: false, color: 'rgba(0,0,0,0.3)', widths: [6, 6, 3, 6, 4] };
    const pdf = await writePdf([{ w: 200, h: 100, items: [text] }], { image: noImage });
    // ISO 32000-1 §8.4.5: /ca and /CA in a graphics state dictionary, set with gs
    expect(pageContent(pdf)).toMatch(/\/G\d+ gs\n0 0 0 rg/);
    expect(latin1(pdf)).toContain('/ca 0.3 /CA 0.3');
  });

  it('cuts a picture with rounded corners to a rounded rectangle', async () => {
    const pdf = await writePdf([{ w: 200, h: 100, items: [{ kind: 'image', src: SRC, x: 20, y: 10, w: 40, h: 20, radius: 5 }] }], { image: noImage });
    const c = pageContent(pdf);
    expect(c).not.toContain('20 10 40 20 re W n');
    // ISO 32000-1 §8.5.2: m, l and c build the path; §8.5.4: W n makes it the clip
    expect(c).toMatch(/25 10 m\n55 10 l\n[^\n]+ c\n[\s\S]*h W n/);
  });
});

// ---------------------------------------------------------------- reading EMF

describe('reading EMF pictures (F877 to F882)', () => {
  it('keeps the see-through parts of an AlphaBlend bitmap with per-pixel alpha (F877)', () => {
    // a 2 × 1 32-bit bitmap, bottom row first: clear (0, 0, 0, 0), then half see-through white premultiplied (128, 128, 128, 128)
    const bits = new Uint8Array([0, 0, 0, 0, 128, 128, 128, 128]);
    const d = decodeDib(bmiHeader(2, 1, 32), bits, true)!;
    expect(d.kind === 'rgba' && Array.from(d.rgba)).toEqual([0, 0, 0, 0, 255, 255, 255, 128]);
    const svg = emfToSvg(new Emf().raw(114, alphaBlend(bmiHeader(2, 1, 32), bits, 2, 1, 255, 1)).bytes())!.svg;
    expect(pngPixels(hrefs(svg)[0]).rgba.slice(0, 4)).toEqual([0, 0, 0, 0]);
    // SrcConstantAlpha alone (AlphaFormat 0): the whole bitmap that see-through
    const faint = emfToSvg(new Emf().raw(114, alphaBlend(bmiHeader(2, 1, 32), bits, 2, 1, 51, 0)).bytes())!.svg;
    expect(faint).toContain('opacity="0.2"');
  });

  it('draws nothing for a source rectangle that starts past the bitmap\'s right edge (F878)', () => {
    const bits = new Uint8Array([0, 0, 255, 255, 0, 0]); // 2 × 1, 24-bit: red, blue, padded to 8 bytes below
    const padded = new Uint8Array(8); padded.set(bits);
    const svg = emfToSvg(new Emf().rec(43, 0, 0, 10, 10).raw(81, stretchDibits(bmiHeader(2, 1, 24), padded, [2, 0, 1, 1], [0, 0, 100, 100])).bytes())!.svg;
    expect(hrefs(svg)).toEqual([]);
  });

  it('reads the source rectangle of a top-down bitmap from the top (F879)', () => {
    // 1 × 2, 24-bit, top row first (negative height): red on top, blue below (rows padded to 4 bytes)
    const bits = new Uint8Array([0, 0, 255, 0, 255, 0, 0, 0]);
    const svg = emfToSvg(new Emf().raw(81, stretchDibits(bmiHeader(1, -2, 24), bits, [0, 0, 1, 1], [0, 0, 100, 100])).bytes())!.svg;
    expect(pngPixels(hrefs(svg)[0]).rgba).toEqual([255, 0, 0, 255]);
  });

  it('places centered text without advances once (F880)', () => {
    // EMR_SETTEXTALIGN TA_CENTER (6) | TA_BASELINE (24); EMR_EXTTEXTOUTW ([MS-EMF] 2.3.5.8, EmrText 2.2.5) with offDx 0
    const text = new Uint8Array(68 + 4);
    const dv = new DataView(text.buffer);
    [0, 0, 100, 100, 1, 0, 0].forEach((v, i) => dv.setInt32(i * 4, v, true)); // bounds, GM_COMPATIBLE, scales
    [500, 250, 2, 76, 0, 0, 0, -1, -1, 0].forEach((v, i) => dv.setInt32(28 + i * 4, v, true)); // reference, chars, offString, options, rectangle, offDx
    dv.setUint16(68, 0x48, true); dv.setUint16(70, 0x69, true); // "Hi"
    const svg = emfToSvg(new Emf().rec(22, 6 | 24).raw(84, text).bytes())!.svg;
    expect(svg).toMatch(/<text [^>]*x="0"[^>]*text-anchor="middle"/);
  });

  it('combines clip regions by their mode (F881)', () => {
    // RegionData ([MS-EMF] 2.2.24): a 32-byte header (dwSize, iType 1, nCount, nRgnSize, rcBound), then the rectangles
    const region = (rects: [number, number, number, number][]) => {
      const b = new DataView(new ArrayBuffer(32 + rects.length * 16));
      [32, 1, rects.length, rects.length * 16, 0, 0, 1000, 500].forEach((v, i) => b.setInt32(i * 4, v, true));
      rects.flat().forEach((v, i) => b.setInt32(32 + i * 4, v, true));
      return new Uint8Array(b.buffer);
    };
    const select = (mode: number, rects: [number, number, number, number][]) => {
      const r = region(rects);
      const body = new Uint8Array(8 + r.length);
      new DataView(body.buffer).setUint32(0, r.length, true); new DataView(body.buffer).setUint32(4, mode, true);
      body.set(r, 8);
      return body;
    };
    // a clip, then RGN_OR (2) with a second rectangle: a clipPath of two children (their union)
    const or = emfToSvg(new Emf().rec(30, 0, 0, 100, 100).raw(75, select(2, [[200, 0, 300, 100]])).rec(43, 0, 0, 400, 100).bytes())!.svg;
    expect(or).toMatch(/<clipPath id="(emfclip\d+)"><path d="[^"]+" clip-path="url\(#emfclip\d+\)"\/><path d="M200 0L300 0L300 100L200 100Z" clip-rule="nonzero"\/><\/clipPath>/);
    // RGN_DIFF (4): the old clip, less the rectangle (even-odd with a rectangle bigger than the picture)
    const diff = emfToSvg(new Emf().rec(30, 0, 0, 100, 100).raw(75, select(4, [[20, 20, 40, 40]])).rec(43, 0, 0, 400, 100).bytes())!.svg;
    expect(diff).toMatch(/<clipPath id="emfclip\d+" clip-path="url\(#emfclip\d+\)"><path d="M-100000 -100000[^"]*M20 20L40 20L40 40L20 40Z" clip-rule="evenodd"\/>/);
    // RGN_COPY with no region: the default clip, nothing cut off ([MS-EMF] 2.3.2.2)
    const reset = emfToSvg(new Emf().rec(30, 0, 0, 100, 100).rec(75, 0, 5).rec(43, 0, 0, 400, 100).bytes())!.svg;
    expect(reset).toContain('<path d="M0 0L400 0L400 100L0 100Z"');
    expect(reset).not.toContain('<g clip-path');
  });

  it('draws no line for a geometric null pen (F882)', () => {
    // EMR_EXTCREATEPEN: ihPen, offBmi, cbBmi, offBits, cbBits, then LogPenEx ([MS-EMF] 2.2.20): PenStyle
    // PS_GEOMETRIC | PS_NULL (0x00010000 | 0x0005, [MS-EMF] 2.1.25), Width, BrushStyle BS_SOLID (0), ColorRef, BrushHatch, no dashes
    const svg = emfToSvg(new Emf().rec(95, 1, 0, 0, 0, 0, 0x00010005, 100, 0, 0x000000, 0, 0).rec(37, 1).rec(43, 0, 0, 100, 100).bytes())!.svg;
    expect(svg).not.toContain('stroke="#000000"');
  });
});

/** An EMR_EXTTEXTOUTW record body ([MS-EMF] 2.3.5.8, EmrText 2.2.5): "Hi" at (500, 250), no advances. */
function hiText(): Uint8Array {
  const text = new Uint8Array(68 + 4);
  const dv = new DataView(text.buffer);
  [0, 0, 100, 100, 1, 0, 0].forEach((v, i) => dv.setInt32(i * 4, v, true));
  [500, 250, 2, 76, 0, 0, 0, -1, -1, 0].forEach((v, i) => dv.setInt32(28 + i * 4, v, true));
  dv.setUint16(68, 0x48, true); dv.setUint16(70, 0x69, true);
  return text;
}

describe('reading EMF pictures, round 2', () => {
  it('shows nothing through a clip region that is there but holds no rectangles (F881)', () => {
    // RegionData ([MS-EMF] 2.2.24) with nCount 0, copied in (RGN_COPY): an empty clip, unlike a
    // record with no region data at all, which sets the default clip ([MS-EMF] 2.3.2.2)
    const r = new DataView(new ArrayBuffer(8 + 32));
    r.setUint32(0, 32, true); r.setUint32(4, 5, true);
    [32, 1, 0, 0, 0, 0, 0, 0].forEach((v, i) => r.setInt32(8 + i * 4, v, true));
    const svg = emfToSvg(new Emf().raw(75, new Uint8Array(r.buffer)).rec(43, 0, 0, 400, 100).bytes())!.svg;
    const id = /<clipPath id="(emfclip\d+)"\/>/.exec(svg)?.[1];
    expect(id).toBeTruthy();
    expect(svg).toContain(`<g clip-path="url(#${id})"><path d="M0 0L400 0L400 100L0 100Z"`);
  });

  it('keeps letters that were made a clip path, rather than losing them', () => {
    // BeginPath, the text, EndPath, SelectClipPath (RGN_COPY): text outlines as a clip (picture-filled text)
    const svg = emfToSvg(new Emf().rec(24, 0x0000ff).rec(59).raw(84, hiText()).rec(60).rec(67, 5).bytes())!.svg;
    expect(svg).toMatch(/<text [^>]*fill="#ff0000"[^>]*>Hi<\/text>/);
  });

  it('draws outlined letters cut by the clip they were written under', () => {
    // a clip, the text in a path bracket, the clip reset (RGN_COPY, no region), then StrokePath
    const svg = emfToSvg(new Emf().rec(30, 0, 0, 100, 100).rec(59).raw(84, hiText()).rec(60).rec(75, 0, 5).rec(64).bytes())!.svg;
    expect(svg).toMatch(/<g clip-path="url\(#emfclip\d+\)">(<rect [^>]*>)?<text [^>]*fill="none" stroke=[^>]*>Hi<\/text><\/g><\/svg>$/);
  });

  it('quotes the font name, so one with an apostrophe stays one name (F914)', () => {
    // EMR_EXTCREATEFONTINDIRECTW: ihFont, then LogFont ([MS-EMF] 2.2.13): height, width, escapement,
    // orientation, weight, italic/underline/strike-out/charset, precisions, quality, pitch, FaceName
    const font = new Uint8Array(4 + 92);
    const dv = new DataView(font.buffer);
    dv.setUint32(0, 1, true); dv.setInt32(4, -20, true); dv.setInt32(20, 400, true);
    [..."O'Brien Sans"].forEach((ch, i) => dv.setUint16(32 + i * 2, ch.charCodeAt(0), true));
    const svg = emfToSvg(new Emf().raw(82, font).rec(37, 1).raw(84, hiText()).bytes())!.svg;
    expect(svg).toContain(`font-family="'O\\'Brien Sans', 'Arial', 'Helvetica', sans-serif"`);
  });
});

// ---------------------------------------------------------------- EMF+ record numbers

/** An EMF+ record ([MS-EMFPLUS] 2.3): Type, Flags, Size, DataSize, then its data. */
function plusRec(type: number, flags: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, type, true); dv.setUint16(2, flags, true); dv.setUint32(4, out.length, true); dv.setUint32(8, data.length, true);
  out.set(data, 12);
  return out;
}
const le = (...vals: [('u32' | 'i32' | 'f32'), number][]) => {
  const b = new DataView(new ArrayBuffer(vals.length * 4));
  vals.forEach(([k, v], i) => (k === 'f32' ? b.setFloat32(i * 4, v, true) : k === 'i32' ? b.setInt32(i * 4, v, true) : b.setUint32(i * 4, v, true)));
  return new Uint8Array(b.buffer);
};
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

describe('EMF+ clipping records (F876)', () => {
  it('keeps the clip through SetCompositingMode (0x4023) and lets it go at ResetClip (0x4031)', () => {
    // [MS-EMFPLUS] 2.1.1.1: EmfPlusSetCompositingMode 0x4023, EmfPlusResetClip 0x4031, EmfPlusSetClipRect 0x4032
    const image = cat(le(['u32', 0xdbc01002], ['u32', 1], ['i32', 1], ['i32', 1], ['i32', 4], ['u32', 0x0026200a], ['u32', 0]), new Uint8Array([0, 0, 255, 255]));
    const draw = plusRec(0x401a, 1, le(['u32', 0], ['i32', 2], ['f32', 0], ['f32', 0], ['f32', 1], ['f32', 1], ['f32', 0], ['f32', 0], ['f32', 100], ['f32', 100]));
    const plus = cat(
      plusRec(0x4001, 1, le(['u32', 0xdbc01002], ['u32', 1], ['u32', 96], ['u32', 96])),
      plusRec(0x4030, 2, le(['f32', 1])),
      plusRec(0x4008, 0x0500 | 1, image),
      plusRec(0x4032, 0, le(['f32', 0], ['f32', 0], ['f32', 50], ['f32', 50])),
      plusRec(0x4023, 0, new Uint8Array(0)),
      draw,
      plusRec(0x4031, 0, new Uint8Array(0)),
      draw,
      plusRec(0x4002, 0, new Uint8Array(0)),
    );
    const comment = cat(le(['u32', 70], ['u32', 16 + plus.length], ['u32', 4 + plus.length], ['u32', 0x2b464d45]), plus);
    const svg = emfToSvg(new Emf().raw(70, comment.subarray(8)).bytes())!.svg;
    const images = svg.split('<image').length - 1;
    expect(images).toBe(2);
    // the first drawn inside the clip, the second not
    const first = svg.indexOf('<image'), second = svg.indexOf('<image', first + 1);
    expect(svg.slice(0, first)).toMatch(/<g clip-path="url\(#emfclip\d+\)"><g transform/);
    expect(svg.slice(first, second)).toMatch(/<\/g><\/g><g transform/);
  });
});

// ---------------------------------------------------------------- TIFF LZW

/**
 * A strict TIFF LZW reader (TIFF 6.0 section 13, its LZWDecode outline): reads codes until the
 * end-of-information code, widening from 9 bits when the table reaches 511, 1023 and 2047 entries
 * ("early change"), and fails on any code it has no entry for.
 */
function unlzw(b: Uint8Array): Uint8Array {
  let pos = 0, width = 9;
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++, pos++) {
      if (pos >= b.length * 8) throw new Error('ran out of data before the end code');
      v = (v << 1) | ((b[pos >> 3] >> (7 - (pos & 7))) & 1);
    }
    return v;
  };
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => { table = Array.from({ length: 258 }, (_, i) => [i]); width = 9; };
  reset();
  let old: number[] | null = null;
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); old = null; continue; }
    let s: number[];
    if (code < table.length) s = table[code];
    else if (code === table.length && old) s = [...old, old[0]];
    else throw new Error(`code ${code} not in a table of ${table.length}`);
    out.push(...s);
    if (old) table.push([...old, s[0]]);
    old = s;
    if (table.length === 511) width = 10;
    else if (table.length === 1023) width = 11;
    else if (table.length === 2047) width = 12;
  }
  return new Uint8Array(out);
}

describe('TIFF LZW (F915)', () => {
  // Bytes in which no two neighbours ever come twice: block k runs j·(2k + 1) mod 256 for j = 0 to
  // 255, so each pair's difference names its block, and the joins between blocks differ too. The
  // writer then misses on every byte and adds one table entry each, so after n bytes the table
  // ends at 257 + n entries: n = 254, 766, 1790 and 3836 put the end code just where the reader
  // widens its codes (511, 1023 and 2047 entries) or the writer must start a new table (4094).
  const data = Uint8Array.from({ length: 4200 }, (_, i) => ((i & 255) * (2 * (i >> 8) + 1)) & 255);
  const lengths = [1, 2, 3, 100, 4100, 4200, ...[254, 766, 1790, 3836].flatMap((n) => [n - 2, n - 1, n, n + 1, n + 2])];

  it('ends every strip with an end code a strict reader reads, where the code width changes', () => {
    for (const n of lengths) {
      const part = data.subarray(0, n);
      const back = unlzw(lzw(part));
      expect(back.length, `${n} bytes`).toBe(n);
      expect(back.every((v, i) => v === part[i]), `${n} bytes`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- WMF

describe('the EMF inside a damaged WMF (F916)', () => {
  /** A WMF ([MS-WMF]: an 18-byte META_HEADER, then one META_ESCAPE record holding a META_ESCAPE_ENHANCED_METAFILE piece). */
  const wmf = (piece: number, total: number, data: Uint8Array) => {
    const head = new Uint8Array(18);
    new DataView(head.buffer).setUint16(2, 9, true);
    const size = 44 + data.length + (data.length & 1);
    const rec = new Uint8Array(size);
    const v = new DataView(rec.buffer);
    v.setUint32(0, size / 2, true); v.setUint16(4, 0x0626, true); v.setUint16(6, 0x000f, true); v.setUint16(8, size - 10, true);
    v.setUint32(10, 0x43464d57, true); v.setUint32(14, 1, true); v.setUint32(18, 0x00010000, true);
    v.setUint32(32, piece, true); v.setUint32(40, total, true);
    rec.set(data, 44);
    const end = new Uint8Array([3, 0, 0, 0, 0, 0]);
    return cat(head, rec, end);
  };

  it('is none, not an error, when the EMF size claimed is bigger than the WMF', () => {
    expect(() => emfInWmf(wmf(4, 0xffffffff, new Uint8Array(4)))).not.toThrow();
    expect(emfInWmf(wmf(4, 0xffffffff, new Uint8Array(4)))).toBeNull();
  });

  it('is none when a piece runs past its own record into the next', () => {
    // the piece says 10 bytes; the record holds 4 (the next record's 6 bytes would be taken)
    expect(emfInWmf(wmf(10, 10, new Uint8Array(4)))).toBeNull();
    // a sound one
    expect(Array.from(emfInWmf(wmf(4, 4, new Uint8Array([1, 2, 3, 4])))!)).toEqual([1, 2, 3, 4]);
  });
});
