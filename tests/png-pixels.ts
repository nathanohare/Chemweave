// A small PNG reader for tests: 8-bit grey, grey + alpha, RGB or RGBA, not interlaced (what the
// app and most programs write), as RGBA pixels.

import { unzlibSync } from 'fflate';
import type { Pixels } from '../src/recognise/picture';

export function readPng(bytes: Uint8Array): Pixels {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8, width = 0, height = 0, type = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const len = dv.getUint32(at), name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') {
      width = dv.getUint32(at + 8); height = dv.getUint32(at + 12); type = body[9];
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit, not interlaced');
    } else if (name === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const all = new Uint8Array(idat.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of idat) { all.set(b, o); o += b.length; }
  const raw = unzlibSync(all);
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!ch) throw new Error(`PNG colour type ${type} not read`);
  const stride = width * ch, rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? rows[y * stride + x - ch] : 0, b = y ? rows[(y - 1) * stride + x] : 0, c = x >= ch && y ? rows[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      rows[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = rows.subarray(i * ch, i * ch + ch);
    if (ch === 1) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = s[0]; data[i * 4 + 3] = 255; }
    else if (ch === 2) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = s[0]; data[i * 4 + 3] = s[1]; }
    else { data[i * 4] = s[0]; data[i * 4 + 1] = s[1]; data[i * 4 + 2] = s[2]; data[i * 4 + 3] = ch === 4 ? s[3] : 255; }
  }
  return { width, height, data };
}
