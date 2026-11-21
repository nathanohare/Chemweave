// EMF+ records (GDI+ drawing kept inside EMF comments), for the pictures that have nothing else.
// Written from Microsoft's published [MS-EMFPLUS] specification. Most programs write "dual" files,
// where every EMF+ drawing is repeated as ordinary EMF records (read in emf-read.ts), so this is
// played only when those draw nothing: Word for Mac, for one, saves a pasted ChemDraw drawing as
// EMF+ alone (one bitmap drawn with DrawImage), which showed as an empty box before.
//
// Played: pictures (Object records of type Image, as raw pixels, compressed PNG/JPEG/GIF/BMP or a
// metafile inside, drawn by DrawImage and DrawImagePoints), the world and page transforms, Save and
// Restore, containers, rectangle clipping and Clear. Lines, shapes and text drawn in EMF+ are not
// played yet (no file met so far has them without ordinary records).

/** An affine map: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG's order). */
type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
/** Apply p, then q. */
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3],
  p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3],
  p[4] * q[0] + p[5] * q[2] + q[4], p[4] * q[1] + p[5] * q[3] + q[5],
];
const num = (v: number): string => String(Math.round(v * 1000) / 1000);

export interface EmfPlusHelpers {
  /** RGBA pixels (top row first) as a PNG file. */
  png(rgba: Uint8Array, w: number, h: number): Uint8Array;
  base64(bytes: Uint8Array): string;
  /** An EMF inside a picture, as SVG (null when it can't be drawn). */
  metafile(bytes: Uint8Array): { svg: string; w: number; h: number } | null;
}

export interface EmfPlusOut {
  /** SVG elements, in the device pixels the EMF's frame is measured in. */
  body: string[];
  defs: string[];
  /** How many pictures were drawn. */
  images: number;
}

/** One picture held by an Object record. */
type Img = { href: string; w: number; h: number };

/** The record type numbers played. */
const R = {
  Header: 0x4001, EndOfFile: 0x4002, Clear: 0x4009, ResetClip: 0x4023, Object: 0x4008,
  DrawImage: 0x401a, DrawImagePoints: 0x401b, Save: 0x4025, Restore: 0x4026,
  BeginContainer: 0x4027, BeginContainerNoParams: 0x4028, EndContainer: 0x4029,
  SetWorldTransform: 0x402a, ResetWorldTransform: 0x402b, MultiplyWorldTransform: 0x402c,
  TranslateWorldTransform: 0x402d, ScaleWorldTransform: 0x402e, RotateWorldTransform: 0x402f,
  SetPageTransform: 0x4030, SetClipRect: 0x4032,
};

/** Pixels per unit (GDI+'s UnitType), at the file's resolution. */
const perUnit = (unit: number, dpi: number): number =>
  unit === 3 ? dpi / 72 : unit === 4 ? dpi : unit === 5 ? dpi / 300 : unit === 6 ? dpi / 25.4 : 1;

/** The picture a compressed bitmap holds, by its first bytes. */
function fileMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

/** Raw GDI+ pixels as RGBA, top row first; null for formats not read (48 and 64 bits a pixel). */
export function emfPlusPixels(fmt: number, w: number, h: number, stride: number, data: Uint8Array, palette: number[]): Uint8Array | null {
  const bpp = (fmt >>> 8) & 0xff;
  if (!(w > 0 && h > 0) || w * h > 50e6) return null;
  const rowBytes = Math.ceil((w * bpp) / 8);
  const step = Math.abs(stride) || ((rowBytes + 3) & ~3);
  if (step < rowBytes || step * (h - 1) + rowBytes > data.length) return null;
  const out = new Uint8Array(w * h * 4);
  const indexed = (fmt & 0x00010000) !== 0;
  const alpha = (fmt & 0x00040000) !== 0, pre = (fmt & 0x00080000) !== 0;
  for (let y = 0; y < h; y++) {
    // (a negative stride: the rows run from the bottom)
    const row = (stride < 0 ? h - 1 - y : y) * step;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      if (indexed) {
        const bit = x * bpp;
        const byte = data[row + (bit >> 3)];
        const i = bpp === 8 ? byte : bpp === 4 ? (byte >> (4 - (bit & 7))) & 0x0f : (byte >> (7 - (bit & 7))) & 1;
        const c = palette[i] ?? 0;
        a = (c >>> 24) & 0xff; r = (c >>> 16) & 0xff; g = (c >>> 8) & 0xff; b = c & 0xff;
        if (!palette.length) a = 255;
      } else if (bpp === 32 || bpp === 24) {
        const p = row + x * (bpp / 8);
        b = data[p]; g = data[p + 1]; r = data[p + 2];
        if (bpp === 32 && alpha) a = data[p + 3];
      } else if (bpp === 16) {
        const p = row + x * 2;
        const v = data[p] | (data[p + 1] << 8);
        if (fmt === 0x00101004) { r = g = b = v >> 8; }                                        // 16-bit gray
        else if (fmt === 0x00021006) { r = ((v >> 11) & 31) * 255 / 31; g = ((v >> 5) & 63) * 255 / 63; b = (v & 31) * 255 / 31; } // RGB565
        else { r = ((v >> 10) & 31) * 255 / 31; g = ((v >> 5) & 31) * 255 / 31; b = (v & 31) * 255 / 31; if (fmt === 0x00061007 && !(v & 0x8000)) a = 0; } // RGB555, ARGB1555
      } else return null;
      // premultiplied alpha (PARGB) back to plain colors
      if (pre && a > 0 && a < 255) { r = Math.min(255, (r * 255) / a); g = Math.min(255, (g * 255) / a); b = Math.min(255, (b * 255) / a); }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }
  return out;
}

/**
 * Play the EMF+ records (each comment's EMF+ data, in order). `frame` is the picture's area in
 * device pixels, for Clear.
 */
export function playEmfPlus(chunks: Uint8Array[], frame: [number, number, number, number], help: EmfPlusHelpers, clipIdStart = 0): EmfPlusOut {
  const body: string[] = [], defs: string[] = [];
  let images = 0, clipIds = clipIdStart;
  let dpi = 96;
  let world: M = IDENTITY;
  let unit = 2, scale = 1;
  let clip: string | null = null;
  const stack = new Map<number, { world: M; unit: number; scale: number; clip: string | null }>();
  const pictures = new Map<number, Img>();
  // an object split over several records (each holding part of it)
  let part: { id: number; type: number; total: number; got: Uint8Array[]; size: number } | null = null;
  let pixels = 0;

  const T = (): M => { const k = scale * perUnit(unit, dpi); return mul(world, [k, 0, 0, k, 0, 0]); };
  const deviceRect = (x: number, y: number, w: number, h: number, m: M) => {
    const pt = (px: number, py: number) => `${num(m[0] * px + m[2] * py + m[4])} ${num(m[1] * px + m[3] * py + m[5])}`;
    return `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + h)}L${pt(x, y + h)}Z`;
  };

  const image = (d: Uint8Array): Img | null => {
    if (d.length < 8) return null;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const type = dv.getUint32(4, true);
    if (type === 1 && d.length >= 28) {
      const w = dv.getInt32(8, true), h = dv.getInt32(12, true), stride = dv.getInt32(16, true);
      const fmt = dv.getUint32(20, true), kind = dv.getUint32(24, true);
      const rest = d.subarray(28);
      if (kind === 1) {
        const mime = fileMime(rest);
        return mime && w > 0 && h > 0 ? { href: `data:${mime};base64,${help.base64(rest)}`, w, h } : null;
      }
      if ((pixels += Math.max(0, w) * Math.max(0, h)) > 50e6) return null;
      let at = 0;
      const palette: number[] = [];
      if (fmt & 0x00010000) {
        // the colors (EmfPlusPalette: flags, count, ARGB each)
        if (rest.length < 8) return null;
        const rdv = new DataView(rest.buffer, rest.byteOffset, rest.byteLength);
        const n = Math.min(256, rdv.getUint32(4, true));
        for (let i = 0; i < n && 12 + i * 4 <= rest.length; i++) palette.push(rdv.getUint32(8 + i * 4, true));
        at = 8 + n * 4;
      }
      const rgba = emfPlusPixels(fmt, w, h, stride, rest.subarray(at), palette);
      return rgba ? { href: `data:image/png;base64,${help.base64(help.png(rgba, w, h))}`, w, h } : null;
    }
    if (type === 2 && d.length >= 16) {
      // a metafile inside (EMF, EMF+ only or dual; WMF isn't drawn here)
      const mtype = dv.getUint32(8, true), size = dv.getUint32(12, true);
      if (mtype < 3 || 16 + size > d.length) return null;
      const got = help.metafile(d.subarray(16, 16 + size));
      return got ? { href: `data:image/svg+xml;base64,${help.base64(new TextEncoder().encode(got.svg))}`, w: got.w, h: got.h } : null;
    }
    return null;
  };

  const object = (id: number, type: number, d: Uint8Array) => {
    if (type === 5) { const img = image(d); if (img) pictures.set(id, img); else pictures.delete(id); }
    else pictures.delete(id);
  };

  /** Draw picture `id`'s part `src` (in its pixels) onto the parallelogram p0 (top left), p1 (top right), p2 (bottom left). */
  const draw = (id: number, src: [number, number, number, number], p0: [number, number], p1: [number, number], p2: [number, number]) => {
    const img = pictures.get(id);
    if (!img) return;
    let [sx, sy, sw, sh] = src;
    if (!(sw > 0 && sh > 0)) { sx = 0; sy = 0; sw = img.w; sh = img.h; }
    // the picture's part to the unit square, the unit square to the place, then to the page
    const toUnit: M = [1 / sw, 0, 0, 1 / sh, -sx / sw, -sy / sh];
    const place: M = [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];
    const m = mul(mul(toUnit, place), T());
    const whole = sx <= 0 && sy <= 0 && sx + sw >= img.w && sy + sh >= img.h;
    let crop = '';
    if (!whole) {
      const cid = `emfclip${++clipIds}`;
      defs.push(`<clipPath id="${cid}"><rect x="${num(sx)}" y="${num(sy)}" width="${num(sw)}" height="${num(sh)}"/></clipPath>`);
      crop = ` clip-path="url(#${cid})"`;
    }
    const el = `<g transform="matrix(${m.map(num).join(' ')})"${crop}><image width="${num(img.w)}" height="${num(img.h)}" preserveAspectRatio="none" href="${img.href}"/></g>`;
    body.push(clip ? `<g clip-path="url(#${clip})">${el}</g>` : el);
    images++;
  };

  for (const c of chunks) {
    const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
    const f32 = (o: number) => dv.getFloat32(o, true);
    for (let off = 0; off + 12 <= c.length;) {
      const type = dv.getUint16(off, true), flags = dv.getUint16(off + 2, true);
      const size = dv.getUint32(off + 4, true), dataSize = dv.getUint32(off + 8, true);
      if (size < 12 || off + size > c.length || 12 + dataSize > size) break;
      const o = off + 12;
      const d = c.subarray(o, o + dataSize);
      off += size;
      switch (type) {
        case R.Header: if (dataSize >= 16) dpi = dv.getUint32(o + 8, true) || 96; break;
        case R.EndOfFile: return { body, defs, images };
        case R.Object: {
          const id = flags & 0xff, otype = (flags >> 8) & 0x7f;
          if (flags & 0x8000) {
            // one part of an object too big for one record: the total size, then this part
            if (dataSize < 4) break;
            if (!part || part.id !== id) part = { id, type: otype, total: dv.getUint32(o, true), got: [], size: 0 };
            part.got.push(d.subarray(4)); part.size += dataSize - 4;
          } else if (part && part.id === id) {
            part.got.push(d); part.size += dataSize;
          } else { object(id, otype, d); break; }
          if (part && (part.size >= part.total || !(flags & 0x8000))) {
            const all = new Uint8Array(part.size);
            let at = 0;
            for (const g of part.got) { all.set(g, at); at += g.length; }
            object(part.id, part.type, all.subarray(0, part.total || all.length));
            part = null;
          }
          break;
        }
        case R.Clear: {
          // (ARGB; a clear one, which is what programs write, does nothing on a white page)
          const argb = dv.getUint32(o, true), a = argb >>> 24;
          if (a > 0) {
            const hex = '#' + (argb & 0xffffff).toString(16).padStart(6, '0');
            body.push(`<rect x="${num(frame[0])}" y="${num(frame[1])}" width="${num(frame[2])}" height="${num(frame[3])}" fill="${hex}"${a < 255 ? ` fill-opacity="${num(a / 255)}"` : ''}/>`);
          }
          break;
        }
        case R.DrawImage: {
          if (dataSize < 24) break;
          const src: [number, number, number, number] = [f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)];
          const short = (flags & 0x4000) !== 0;
          if (dataSize < (short ? 32 : 40)) break;
          const [x, y, w, h] = short
            ? [dv.getInt16(o + 24, true), dv.getInt16(o + 26, true), dv.getInt16(o + 28, true), dv.getInt16(o + 30, true)]
            : [f32(o + 24), f32(o + 28), f32(o + 32), f32(o + 36)];
          draw(flags & 0xff, src, [x, y], [x + w, y], [x, y + h]);
          break;
        }
        case R.DrawImagePoints: {
          // (points given relative to each other aren't read)
          if (dataSize < 28 || flags & 0x0800) break;
          const src: [number, number, number, number] = [f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)];
          const short = (flags & 0x4000) !== 0;
          if (dv.getUint32(o + 24, true) !== 3 || dataSize < 28 + (short ? 12 : 24)) break;
          const pt = (i: number): [number, number] => short
            ? [dv.getInt16(o + 28 + i * 4, true), dv.getInt16(o + 30 + i * 4, true)]
            : [f32(o + 28 + i * 8), f32(o + 32 + i * 8)];
          draw(flags & 0xff, src, pt(0), pt(1), pt(2));
          break;
        }
        case R.Save: case R.BeginContainerNoParams: stack.set(dv.getUint32(o, true), { world, unit, scale, clip }); break;
        case R.BeginContainer: {
          // a new space: the source rectangle mapped onto the destination one
          if (dataSize < 36) break;
          stack.set(dv.getUint32(o + 32, true), { world, unit, scale, clip });
          const [dx, dy, dw, dh] = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)];
          const [sx, sy, sw, sh] = [f32(o + 16), f32(o + 20), f32(o + 24), f32(o + 28)];
          if (sw && sh) world = mul([dw / sw, 0, 0, dh / sh, dx - (sx * dw) / sw, dy - (sy * dh) / sh], world);
          break;
        }
        case R.Restore: case R.EndContainer: {
          const got = stack.get(dv.getUint32(o, true));
          if (got) ({ world, unit, scale, clip } = got);
          break;
        }
        case R.SetWorldTransform: if (dataSize >= 24) world = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)]; break;
        case R.ResetWorldTransform: world = IDENTITY; break;
        case R.MultiplyWorldTransform: case R.TranslateWorldTransform: case R.ScaleWorldTransform: case R.RotateWorldTransform: {
          let m: M;
          if (type === R.MultiplyWorldTransform) { if (dataSize < 24) break; m = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)]; }
          else if (type === R.TranslateWorldTransform) m = [1, 0, 0, 1, f32(o), f32(o + 4)];
          else if (type === R.ScaleWorldTransform) m = [f32(o), 0, 0, f32(o + 4), 0, 0];
          else { const a = (f32(o) * Math.PI) / 180; m = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]; }
          // (flag A: after the present transform; otherwise before it)
          world = flags & 0x2000 ? mul(world, m) : mul(m, world);
          break;
        }
        case R.SetPageTransform: unit = flags & 0xff; scale = f32(o) || 1; break;
        case R.ResetClip: clip = null; break;
        case R.SetClipRect: {
          if (dataSize < 16) break;
          const mode = (flags >> 8) & 0x0f;
          const d2 = deviceRect(f32(o), f32(o + 4), f32(o + 8), f32(o + 12), T());
          // replace, or intersect with the clip there is (the other combinations keep it as it is)
          if (mode !== 0 && mode !== 1) break;
          const cid = `emfclip${++clipIds}`;
          const from = mode === 1 ? clip : null;
          defs.push(`<clipPath id="${cid}"${from ? ` clip-path="url(#${from})"` : ''}><path d="${d2}"/></clipPath>`);
          clip = cid;
          break;
        }
        default: break;
      }
    }
  }
  return { body, defs, images };
}
