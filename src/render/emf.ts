// Enhanced Metafile (EMF) pictures, the vector format Word and PowerPoint paste from the
// Windows clipboard. Written from Microsoft's published [MS-EMF] specification: a header,
// then records that set up the page, pens, brushes and fonts, draw paths and text, and end.
//
// Coordinates are kept in hundredths of a point, so the picture is exactly the drawing's size
// (ChemDraw's 14.4 pt bonds come out 14.4 pt long in Word).

import { deflateSync, inflateSync } from 'fflate';
import { Item, Seg, ImageItem, outlineOfPrevious, parseColor } from './vector';

const UNIT = 100; // logical units per point
const DEVICE_MM = 300; // reference device: 300 mm square at 0.1 mm per pixel
const DEVICE_PX = DEVICE_MM * 10;

// record types
const EMR = {
  HEADER: 1, POLYBEZIERTO: 5, SETWINDOWEXTEX: 9, SETWINDOWORGEX: 10, SETVIEWPORTEXTEX: 11, SETVIEWPORTORGEX: 12,
  EOF: 14, SETMAPMODE: 17, SETBKMODE: 18, SETPOLYFILLMODE: 19, SETTEXTALIGN: 22, SETTEXTCOLOR: 24, MOVETOEX: 27,
  SELECTOBJECT: 37, CREATEBRUSHINDIRECT: 39, DELETEOBJECT: 40, LINETO: 54, BEGINPATH: 59, ENDPATH: 60,
  CLOSEFIGURE: 61, FILLPATH: 62, STROKEPATH: 64, EXTCREATEFONTINDIRECTW: 82, EXTTEXTOUTW: 84, EXTCREATEPEN: 95,
  INTERSECTCLIPRECT: 30, EXTSELECTCLIPRGN: 75, ALPHABLEND: 114,
} as const;
const NULL_BRUSH = 0x80000005;
const NULL_PEN = 0x80000008;
const SYSTEM_FONT = 0x8000000d;

/** A growing little-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void { this.room(1); this.view.setUint8(this.length, v); this.length += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.length, v, true); this.length += 2; }
  u32(v: number): void { this.room(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; }
  i32(v: number): void { this.room(4); this.view.setInt32(this.length, Math.round(v), true); this.length += 4; }
  f32(v: number): void { this.room(4); this.view.setFloat32(this.length, v, true); this.length += 4; }
  setU32(at: number, v: number): void { this.view.setUint32(at, v >>> 0, true); }
  setI32(at: number, v: number): void { this.view.setInt32(at, Math.round(v), true); }
  /** UTF-16 text padded with zeros to `chars` characters. */
  utf16(s: string, chars: number): void { for (let i = 0; i < chars; i++) this.u16(i < s.length ? s.charCodeAt(i) : 0); }
  raw(b: Uint8Array): void { this.room(b.length); this.buf.set(b, this.length); this.length += b.length; }
  pad4(): void { while (this.length % 4) this.u8(0); }
  bytes(): Uint8Array { return this.buf.slice(0, this.length); }
}

export interface EmfBox { x1: number; y1: number; x2: number; y2: number }

/** A picture's pixels: red, green, blue and alpha (not premultiplied), top row first. */
export interface EmfPixels { w: number; h: number; rgba: Uint8Array | Uint8ClampedArray }

/**
 * Turn recorded drawing items into an EMF file. `box` is the picture area in points. Pictures
 * are drawn from `pictures` (their pixels, by their src); without it they are left out, for
 * the clipboard, where a PNG copy goes with the EMF.
 */
export function itemsToEmf(items: Item[], box: EmfBox, pictures?: ReadonlyMap<string, EmfPixels | null>): Uint8Array {
  const out = new Bytes();
  const W = Math.max(1, box.x2 - box.x1), H = Math.max(1, box.y2 - box.y1);
  const X = (x: number) => (x - box.x1) * UNIT;
  const Y = (y: number) => (y - box.y1) * UNIT;
  let records = 0;
  let start = 0;
  const begin = (type: number) => { start = out.length; out.u32(type); out.u32(0); records++; };
  const end = () => { out.pad4(); out.setU32(start + 4, out.length - start); };
  const rec = (type: number, ...vals: number[]) => { begin(type); for (const v of vals) out.i32(v); end(); };

  // ---- header (filled in at the end with the size and record count)
  const mmW = (W * 25.4) / 72, mmH = (H * 25.4) / 72;
  begin(EMR.HEADER);
  out.i32(0); out.i32(0); out.i32(Math.ceil(mmW * 10) - 1); out.i32(Math.ceil(mmH * 10) - 1); // bounds, device pixels
  out.i32(0); out.i32(0); out.i32(Math.round(mmW * 100)); out.i32(Math.round(mmH * 100)); // frame, 0.01 mm
  out.u32(0x464d4520); // " EMF"
  out.u32(0x00010000);
  const bytesAt = out.length; out.u32(0);
  const recordsAt = out.length; out.u32(0);
  out.u16(7); // handles: 0 plus two pens, two brushes, two fonts
  out.u16(0);
  out.u32(0); out.u32(0); // no description
  out.u32(0); // no palette
  out.i32(DEVICE_PX); out.i32(DEVICE_PX); // reference device in pixels
  out.i32(DEVICE_MM); out.i32(DEVICE_MM); // and in millimetres
  out.u32(0); out.u32(0); out.u32(0); // no pixel format, not OpenGL
  out.i32(DEVICE_MM * 1000); out.i32(DEVICE_MM * 1000); // device size in micrometres
  end();

  // ---- page: hundredths of a point mapped onto the picture's real size
  rec(EMR.SETMAPMODE, 8); // MM_ANISOTROPIC
  rec(EMR.SETWINDOWORGEX, 0, 0);
  rec(EMR.SETWINDOWEXTEX, Math.round(W * UNIT), Math.round(H * UNIT));
  rec(EMR.SETVIEWPORTORGEX, 0, 0);
  rec(EMR.SETVIEWPORTEXTEX, Math.round(mmW * 10), Math.round(mmH * 10));
  rec(EMR.SETBKMODE, 1); // transparent text background
  rec(EMR.SETPOLYFILLMODE, 2); // non-zero winding, as on screen
  rec(EMR.SETTEXTALIGN, 24); // x, y is the start of the baseline

  // ---- pens, brushes and fonts, each created when it changes (two slots so the old one can be deleted)
  const slots = { pen: [1, 2], brush: [3, 4], font: [5, 6] };
  const cur: Record<'pen' | 'brush' | 'font', { key: string; slot: number } | null> = { pen: null, brush: null, font: null };
  const use = (kind: 'pen' | 'brush' | 'font', key: string, create: (slot: number) => void) => {
    const c = cur[kind];
    if (c && c.key === key) return;
    const slot = c && c.slot === slots[kind][0] ? slots[kind][1] : slots[kind][0];
    create(slot);
    rec(EMR.SELECTOBJECT, slot);
    if (c && c.slot > 0) rec(EMR.DELETEOBJECT, c.slot);
    cur[kind] = { key, slot };
  };
  const stock = (kind: 'pen' | 'brush', obj: number) => {
    const c = cur[kind];
    if (c && c.key === 'none') return;
    begin(EMR.SELECTOBJECT); out.u32(obj); end();
    if (c && c.slot > 0) rec(EMR.DELETEOBJECT, c.slot);
    cur[kind] = { key: 'none', slot: -1 };
  };
  let textColor = -1;

  const path = (segs: Seg[]) => {
    rec(EMR.BEGINPATH);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.k === 'M') rec(EMR.MOVETOEX, X(s.x), Y(s.y));
      else if (s.k === 'L') rec(EMR.LINETO, X(s.x), Y(s.y));
      else if (s.k === 'Z') rec(EMR.CLOSEFIGURE);
      else {
        // runs of curves go in one record
        const run: Extract<Seg, { k: 'C' }>[] = [];
        while (i < segs.length && segs[i].k === 'C') run.push(segs[i++] as Extract<Seg, { k: 'C' }>);
        i--;
        begin(EMR.POLYBEZIERTO);
        const pts = run.flatMap((c) => [[X(c.x1), Y(c.y1)], [X(c.x2), Y(c.y2)], [X(c.x), Y(c.y)]]);
        out.i32(Math.min(...pts.map((p) => p[0]))); out.i32(Math.min(...pts.map((p) => p[1])));
        out.i32(Math.max(...pts.map((p) => p[0]))); out.i32(Math.max(...pts.map((p) => p[1])));
        out.u32(pts.length);
        for (const [x, y] of pts) { out.i32(x); out.i32(y); }
        end();
      }
    }
    rec(EMR.ENDPATH);
  };
  const bounds = () => { out.i32(0); out.i32(0); out.i32(Math.round(W * UNIT)); out.i32(Math.round(H * UNIT)); };

  // what is drawn is cut off by its item's rectangle (a table row of exact height): the clip is
  // set back to none (an empty region, RGN_COPY), then cut to the rectangle, whenever it changes
  let clipKey = '';
  const clipTo = (c: Item['clip']) => {
    const key = c ? `${c.x1},${c.y1},${c.x2},${c.y2}` : '';
    if (key === clipKey) return;
    if (clipKey) rec(EMR.EXTSELECTCLIPRGN, 0, 5);
    if (c) rec(EMR.INTERSECTCLIPRECT, X(c.x1), Y(c.y1), X(c.x2), Y(c.y2));
    clipKey = key;
  };

  const pen = (c: number, w: number, cap: number, join: number) => use('pen', `p${c}/${w}/${cap}/${join}`, (slot) => {
    begin(EMR.EXTCREATEPEN);
    out.u32(slot); out.u32(0); out.u32(0); out.u32(0); out.u32(0); // no bitmap
    out.u32(0x00010000 | cap | join); // geometric solid pen
    out.u32(w);
    out.u32(0); out.u32(c); out.u32(0); // solid brush of this colour
    out.u32(0); // no dash pattern (dashes are already cut into pieces)
    end();
  });

  // a picture as a 32-bit bitmap with its see-through parts, drawn by EMR_ALPHABLEND ([MS-EMF]
  // 2.3.1.1: AlphaFormat AC_SRC_ALPHA, so the colours are premultiplied by their alpha)
  const image = (it: ImageItem, px: EmfPixels) => {
    const pic = placed(it, px);
    if (!pic) return;
    const { w, h, rgba } = pic.pixels;
    const bmiSize = 40, bitsSize = w * h * 4, fixed = 108;
    const dx = X(pic.x), dy = Y(pic.y), dw = Math.max(1, Math.round(pic.w * UNIT)), dh = Math.max(1, Math.round(pic.h * UNIT));
    begin(EMR.ALPHABLEND);
    out.i32(dx); out.i32(dy); out.i32(dx + dw); out.i32(dy + dh); // bounds
    out.i32(dx); out.i32(dy); out.i32(dw); out.i32(dh); // destination
    out.u8(0); out.u8(0); out.u8(255); out.u8(1); // BLENDFUNCTION: AC_SRC_OVER, no flags, opaque as a whole, AC_SRC_ALPHA
    out.i32(0); out.i32(0); // source corner
    out.f32(1); out.f32(0); out.f32(0); out.f32(1); out.f32(0); out.f32(0); // source transform: none
    out.u32(0); // background colour
    out.u32(0); // DIB_RGB_COLORS
    out.u32(fixed); out.u32(bmiSize); out.u32(fixed + bmiSize); out.u32(bitsSize);
    out.i32(w); out.i32(h); // source size
    // BITMAPINFOHEADER: bottom row first (a positive height), 32 bits a pixel, BI_RGB
    out.u32(40); out.i32(w); out.i32(h); out.u16(1); out.u16(32); out.u32(0); out.u32(bitsSize); out.i32(0); out.i32(0); out.u32(0); out.u32(0);
    const bits = new Uint8Array(bitsSize);
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        const o = ((h - 1 - y) * w + x) * 4, a = rgba[o + 3];
        bits[p] = Math.round((rgba[o + 2] * a) / 255); bits[p + 1] = Math.round((rgba[o + 1] * a) / 255); bits[p + 2] = Math.round((rgba[o] * a) / 255); bits[p + 3] = a;
      }
    }
    out.raw(bits);
    end();
  };

  for (const [idx, it] of items.entries()) {
    if (it.kind === 'image') {
      // (the clipboard's copy: the pictures go with the PNG copy beside it)
      const px = pictures?.get(it.src);
      if (!px) continue;
      clipTo(it.clip);
      image(it, px);
      continue;
    }
    clipTo(it.clip);
    if (it.kind === 'path') {
      if (!it.segs.some((s) => s.k !== 'M')) continue;
      if (it.fill) {
        const c = colorRef(it.fill);
        if (c === null) continue;
        use('brush', 'b' + c, (slot) => { begin(EMR.CREATEBRUSHINDIRECT); out.u32(slot); out.u32(0); out.u32(c); out.u32(0); end(); });
        stock('pen', NULL_PEN);
        path(it.segs);
        begin(EMR.FILLPATH); bounds(); end();
      } else if (it.stroke) {
        const c = colorRef(it.stroke.color);
        if (c === null) continue;
        const w = Math.max(1, Math.round(it.stroke.width * UNIT));
        const cap = it.stroke.cap === 'round' ? 0 : it.stroke.cap === 'square' ? 0x100 : 0x200;
        const join = it.stroke.join === 'round' ? 0 : it.stroke.join === 'bevel' ? 0x1000 : 0x2000;
        pen(c, w, cap, join);
        stock('brush', NULL_BRUSH);
        path(it.segs);
        begin(EMR.STROKEPATH); bounds(); end();
      }
    } else {
      const c = colorRef(it.color);
      // (an outline drawn over its own letters: EMF's text has none, so the letters alone)
      if (c === null || !it.text || outlineOfPrevious(items, idx)) continue;
      // letters with only an outline (No fill): their outlines made a path and stroked, as GDI
      // does with text drawn inside a path bracket (BeginPath lists ExtTextOut among the
      // drawing functions that add to the path)
      const hollow = !!it.stroke;
      const height = Math.round(it.size * UNIT);
      use('font', `${it.family}/${height}/${it.bold}/${it.italic}/${it.angle ?? 0}`, (slot) => {
        begin(EMR.EXTCREATEFONTINDIRECTW);
        out.u32(slot);
        // LOGFONTW
        out.i32(-height); out.i32(0); out.i32(Math.round((it.angle ?? 0) * 10)); out.i32(Math.round((it.angle ?? 0) * 10)); // height, width, escapement, orientation
        out.i32(it.bold ? 700 : 400);
        out.u8(it.italic ? 1 : 0); out.u8(0); out.u8(0);
        out.u8(1); // DEFAULT_CHARSET
        out.u8(4); // OUT_TT_PRECIS
        out.u8(0); out.u8(0); // default clipping and quality
        out.u8(0x22); // variable pitch, Swiss family
        out.utf16(fontName(it.family), 32);
        // the rest of LogFontPanose: full name, style, version fields and PANOSE, all unset
        out.utf16('', 64); out.utf16('', 32);
        for (let i = 0; i < 6; i++) out.u32(0);
        for (let i = 0; i < 12; i++) out.u8(0);
        end();
      });
      if (!hollow && c !== textColor) { rec(EMR.SETTEXTCOLOR, c); textColor = c; }
      const chars = [...it.text];
      const units: string[] = [];
      const dx: number[] = [];
      chars.forEach((ch, i) => {
        // characters beyond the basic plane take two UTF-16 units; the advance goes on the first
        for (let k = 0; k < ch.length; k++) { units.push(ch[k]); dx.push(k === 0 ? it.widths[i] ?? 0 : 0); }
      });
      // advances are rounded so they add up to the full width without drift
      let acc = 0, prev = 0;
      const dxUnits = dx.map((w) => { acc += w * UNIT; const r = Math.round(acc) - prev; prev += r; return r; });
      if (hollow) rec(EMR.BEGINPATH);
      begin(EMR.EXTTEXTOUTW);
      const x = X(it.x), y = Y(it.y), tw = dx.reduce((a, b) => a + b, 0) * UNIT;
      out.i32(x); out.i32(y - it.size * UNIT); out.i32(x + tw); out.i32(y + it.size * 0.3 * UNIT); // bounds
      out.u32(1); // GM_COMPATIBLE
      out.f32((25.4 / 72 / UNIT) * 100); out.f32((25.4 / 72 / UNIT) * 100); // page units to 0.01 mm
      out.i32(x); out.i32(y); // reference point
      out.u32(units.length);
      const offString = 76;
      const offDx = offString + Math.ceil((units.length * 2) / 4) * 4;
      out.u32(offString);
      out.u32(0); // no options
      out.i32(0); out.i32(0); out.i32(-1); out.i32(-1); // no clipping rectangle
      out.u32(offDx);
      out.utf16(units.join(''), units.length);
      out.pad4();
      for (const d of dxUnits) out.i32(d);
      end();
      if (hollow) {
        rec(EMR.ENDPATH);
        pen(c, Math.max(1, Math.round((it.stroke ?? 0) * UNIT)), 0, 0); // round caps and joins, as the screen's outline
        stock('brush', NULL_BRUSH);
        begin(EMR.STROKEPATH); bounds(); end();
      }
    }
  }

  // put the stock pen, brush and font back before deleting ours
  const stocks = { pen: NULL_PEN, brush: NULL_BRUSH, font: SYSTEM_FONT };
  for (const kind of ['pen', 'brush', 'font'] as const) {
    const c = cur[kind];
    if (!c || c.slot < 0) continue;
    begin(EMR.SELECTOBJECT); out.u32(stocks[kind]); end();
    rec(EMR.DELETEOBJECT, c.slot);
  }
  begin(EMR.EOF); out.u32(0); out.u32(16); out.u32(20); end();

  out.setU32(bytesAt, out.length);
  out.setU32(recordsAt, records);
  return out.bytes();
}

/** A picture's pixels async-read first, then the EMF with them (File ▸ Export ▸ Export Picture). */
export async function itemsToEmfWithPictures(items: Item[], box: EmfBox, pixels: (src: string) => Promise<EmfPixels | null>): Promise<Uint8Array> {
  const got = new Map<string, EmfPixels | null>();
  for (const it of items) if (it.kind === 'image' && !got.has(it.src)) got.set(it.src, await pixels(it.src).catch(() => null));
  return itemsToEmf(items, box, got);
}

/** At most this many pixels in a picture made for the EMF (a turned, flipped or rounded one). */
const MOST_PIXELS = 16e6;

/**
 * The pixels to draw for a picture, and where (in points): as they are when the picture shows
 * them whole, else made again for its box (cropped, flipped, rounded and turned as the screen
 * shows it, see-through outside), so every EMF reader draws it the same with a plain bitmap.
 */
export function placed(it: ImageItem, px: EmfPixels): { pixels: EmfPixels; x: number; y: number; w: number; h: number } | null {
  if (!(px.w > 0 && px.h > 0) || px.rgba.length < px.w * px.h * 4) return null;
  const c = it.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const plain = !(c.l || c.t || c.r || c.b) && !it.rot && !it.flipH && !it.flipV && !it.radius;
  if (plain) return { pixels: px, x: it.x, y: it.y, w: it.w, h: it.h };
  const fw = Math.max(0.01, 1 - c.l - c.r), fh = Math.max(0.01, 1 - c.t - c.b);
  // the turned box, and pixels as close together as the picture's own
  const a = ((it.rot ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const bw = Math.abs(it.w * cos) + Math.abs(it.h * sin), bh = Math.abs(it.w * sin) + Math.abs(it.h * cos);
  let k = Math.max((px.w * fw) / Math.max(1e-6, it.w), (px.h * fh) / Math.max(1e-6, it.h));
  k = Math.min(k, Math.sqrt(MOST_PIXELS / Math.max(1e-6, bw * bh)));
  const W = Math.max(1, Math.round(bw * k)), H = Math.max(1, Math.round(bh * k));
  const rgba = new Uint8Array(W * H * 4);
  const r = Math.min(it.radius ?? 0, it.w / 2, it.h / 2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // this pixel's middle, from the picture's middle, turned back and flipped back
      const ox = (x + 0.5) / k - bw / 2, oy = (y + 0.5) / k - bh / 2;
      let lx = ox * cos + oy * sin, ly = -ox * sin + oy * cos;
      if (it.flipH) lx = -lx;
      if (it.flipV) ly = -ly;
      const u = lx + it.w / 2, v = ly + it.h / 2;
      if (u < 0 || v < 0 || u >= it.w || v >= it.h) continue;
      if (r > 0) {
        // outside a rounded corner
        const qx = Math.max(0, Math.abs(lx) - (it.w / 2 - r)), qy = Math.max(0, Math.abs(ly) - (it.h / 2 - r));
        if (qx * qx + qy * qy > r * r) continue;
      }
      const sx = Math.min(px.w - 1, Math.floor((c.l + (u / it.w) * fw) * px.w)), sy = Math.min(px.h - 1, Math.floor((c.t + (v / it.h) * fh) * px.h));
      const from = (sy * px.w + sx) * 4, to = (y * W + x) * 4;
      rgba[to] = px.rgba[from]; rgba[to + 1] = px.rgba[from + 1]; rgba[to + 2] = px.rgba[from + 2]; rgba[to + 3] = px.rgba[from + 3];
    }
  }
  return { pixels: { w: W, h: H, rgba }, x: it.x + it.w / 2 - bw / 2, y: it.y + it.h / 2 - bh / 2, w: bw, h: bh };
}

/** Windows colour (0x00BBGGRR); null for fully transparent. Partly transparent colours are mixed with white. */
function colorRef(css: string): number | null {
  const { r, g, b, a } = parseColor(css);
  if (a <= 0.01) return null;
  const mix = (v: number) => Math.round(v * a + 255 * (1 - a));
  return mix(r) | (mix(g) << 8) | (mix(b) << 16);
}

/** The font Office should use: the first named family, with generic names mapped to Arial. */
function fontName(family: string): string {
  const f = family.trim();
  return !f || /^(sans-serif|system-ui|helvetica)$/i.test(f) ? 'Arial' : f.slice(0, 31);
}

// ---------------------------------------------------------------- the drawing inside the picture

const EMR_COMMENT = 70;
/** Starts our comment record's data; then a format number, the packed text's length and the packed text. */
const DRAWING_MARK = new TextEncoder().encode('ChemIllustrator CDXML');

/**
 * The picture with the drawing it shows tucked inside, as a private comment record ([MS-EMF]
 * 2.3.3.1: programs that show the picture skip it). Word and PowerPoint keep the picture as it
 * was pasted, so the structure can come back when the picture is copied out of them again.
 */
export function withDrawing(emf: Uint8Array, cdxml: string): Uint8Array {
  const v = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
  if (emf.length < 88 || v.getUint32(0, true) !== 1 || v.getUint32(40, true) !== 0x464d4520) return emf;
  const packed = deflateSync(new TextEncoder().encode(cdxml), { level: 9 });
  const dataSize = DRAWING_MARK.length + 8 + packed.length;
  const size = 12 + Math.ceil(dataSize / 4) * 4;
  const headerSize = v.getUint32(4, true);
  const out = new Uint8Array(emf.length + size);
  const o = new DataView(out.buffer);
  out.set(emf.subarray(0, headerSize), 0);
  o.setUint32(headerSize, EMR_COMMENT, true);
  o.setUint32(headerSize + 4, size, true);
  o.setUint32(headerSize + 8, dataSize, true);
  out.set(DRAWING_MARK, headerSize + 12);
  o.setUint32(headerSize + 12 + DRAWING_MARK.length, 1, true);
  o.setUint32(headerSize + 16 + DRAWING_MARK.length, packed.length, true);
  out.set(packed, headerSize + 20 + DRAWING_MARK.length);
  out.set(emf.subarray(headerSize), headerSize + size);
  // the header's file size and record count
  o.setUint32(48, out.length, true);
  o.setUint32(52, v.getUint32(52, true) + 1, true);
  return out;
}

/** The drawing tucked inside a picture by withDrawing (as CDXML text), or null when there is none. */
export function drawingInEmf(emf: Uint8Array): string | null {
  try {
    const v = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
    if (emf.length < 88 || v.getUint32(0, true) !== 1 || v.getUint32(40, true) !== 0x464d4520) return null;
    for (let at = 0; at + 12 <= emf.length;) {
      const type = v.getUint32(at, true), size = v.getUint32(at + 4, true);
      if (size < 8 || at + size > emf.length || type === 14) return null;
      if (type === EMR_COMMENT) {
        const data = emf.subarray(at + 12, at + 12 + Math.min(v.getUint32(at + 8, true), size - 12));
        if (data.length > DRAWING_MARK.length + 8 && DRAWING_MARK.every((b, i) => data[i] === b)) {
          const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
          const n = d.getUint32(DRAWING_MARK.length + 4, true);
          const packed = data.subarray(DRAWING_MARK.length + 8, DRAWING_MARK.length + 8 + n);
          return new TextDecoder().decode(inflateSync(packed));
        }
      }
      at += size;
    }
  } catch {
    // damaged or cut short: just a picture
  }
  return null;
}
