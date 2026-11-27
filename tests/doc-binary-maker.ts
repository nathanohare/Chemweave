// A small Word 97 file (.doc) made by the published layout ([MS-DOC]): its FIB, piece table,
// CHPX and PAPX pages, stylesheet, font table and footnotes, for the .doc reader's tests.

import { writeCfb } from '../src/io/cfb';

/** Bytes with little-endian numbers written into them. */
export class Buf {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  u32(v: number) { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
  at(n: number) { while (this.b.length < n) this.b.push(0); return this; }
  bytes(xs: number[]) { this.b.push(...xs); return this; }
  get length() { return this.b.length; }
}

export const sprm = (code: number, ...op: number[]) => [code & 0xff, code >> 8, ...op];

/**
 * A .doc of paragraphs (each its text, character runs and paragraph sprms). Text is stored as
 * cp1252 from offset 0x400 of WordDocument; the CHPX and PAPX pages follow.
 */
/** A style for the stylesheet: its built-in id (sti), kind (1 paragraph, 2 character), the style it is based on, and its character sprms. */
export interface TestStyle { sti: number; stk?: 1 | 2; base?: number; chpx?: number[] }

export function makeDoc(paras: { text: string; runs?: [number, number, number[]][]; pap?: number[]; istd?: number }[], notes: { at: number; text: string }[] = [], styles?: TestStyle[], damage: { ccpText?: number; pieceEnd?: number; pieceAt?: number } = {}): Uint8Array {
  let main = paras.map((p) => p.text).join('');
  const ftn = notes.map((n) => `\x02 ${n.text}\r`).join('');
  const all = main + ftn + (ftn ? '\r' : '');
  const TEXT = 0x400;
  const fcOf = (cp: number) => TEXT + cp;
  // character runs: the default (none), then the given ones
  const chpRuns: [number, number, number[]][] = [];
  let at = 0;
  for (const p of paras) {
    for (const [a, b, g] of p.runs ?? []) chpRuns.push([at + a, at + b, g]);
    at += p.text.length;
  }
  chpRuns.sort((x, y) => x[0] - y[0]);
  const runs: [number, number, number[]][] = [];
  let cur = 0;
  for (const r of chpRuns) { if (r[0] > cur) runs.push([cur, r[0], []]); runs.push(r); cur = r[1]; }
  if (cur < all.length) runs.push([cur, all.length, []]);
  const chpPage = Math.ceil((TEXT + all.length) / 512);
  const papPage = chpPage + 1;
  const wd = new Buf();
  // FibBase, csw 14, rgW, cslw 22, rgLw, cbRgFcLcb 93, then the fc/lcb pairs
  wd.u16(0xa5ec).u16(0xc1).at(0x0a).u16(0x0200).at(32);
  wd.u16(14).at(34 + 28).u16(22);
  const lw = wd.length;
  wd.at(lw + 88).u16(93);
  const fcl = wd.length;
  wd.at(fcl + 93 * 8);
  const put = (off: number, v: number) => { wd.b[off] = v & 0xff; wd.b[off + 1] = (v >> 8) & 0xff; wd.b[off + 2] = (v >> 16) & 0xff; wd.b[off + 3] = (v >>> 24) & 0xff; };
  put(lw + 12, damage.ccpText ?? main.length);
  put(lw + 16, ftn ? ftn.length + 1 : 0);
  wd.at(TEXT);
  for (const ch of all) wd.u8(ch.charCodeAt(0));
  // CHPX page
  wd.at(chpPage * 512);
  const cp0 = chpPage * 512;
  runs.forEach(([a], i) => { wd.b[cp0 + 4 * i] = 0; put(cp0 + 4 * i, fcOf(a)); });
  put(cp0 + 4 * runs.length, fcOf(all.length));
  let free = 511;
  runs.forEach(([, , g], i) => {
    if (!g.length) { wd.b[cp0 + 4 * (runs.length + 1) + i] = 0; return; }
    free -= g.length + 1;
    free -= free % 2;
    wd.b[cp0 + free] = g.length;
    g.forEach((v, k) => { wd.b[cp0 + free + 1 + k] = v; });
    wd.b[cp0 + 4 * (runs.length + 1) + i] = free / 2;
  });
  wd.b[cp0 + 511] = runs.length;
  // PAPX page
  wd.at(papPage * 512 + 512);
  const pp = papPage * 512;
  let pcp = 0;
  const pr: [number, number, number[]][] = [];
  for (const p of paras) { pr.push([pcp, pcp + p.text.length, [(p.istd ?? 0) & 0xff, (p.istd ?? 0) >> 8, ...(p.pap ?? [])]]); pcp += p.text.length; }
  if (pcp < all.length) pr.push([pcp, all.length, [0, 0]]);
  pr.forEach(([a], i) => put(pp + 4 * i, fcOf(a)));
  put(pp + 4 * pr.length, fcOf(all.length));
  free = 511;
  pr.forEach(([, , g], i) => {
    const body = g.length % 2 ? g : [...g, 0];
    free -= body.length + 2;
    free -= free % 2;
    // cb = 0, then the size in words
    wd.b[pp + free] = 0;
    wd.b[pp + free + 1] = body.length / 2;
    body.forEach((v, k) => { wd.b[pp + free + 2 + k] = v; });
    wd.b[pp + 4 * (pr.length + 1) + 13 * i] = free / 2;
  });
  wd.b[pp + 511] = pr.length;
  // the table stream: Clx, bin tables, styles, fonts, footnotes
  const tb = new Buf();
  const pair = (k: number, fc: number, lcb: number) => { put(fcl + 8 * k, fc); put(fcl + 8 * k + 4, lcb); };
  const clx = tb.length;
  tb.u8(2).u32(4 + 4 + 8).u32(0).u32(damage.pieceEnd ?? all.length).u16(0).u32(((damage.pieceAt ?? TEXT) * 2) | 0x40000000).u16(0);
  pair(33, clx, tb.length - clx);
  const bc = tb.length;
  tb.u32(fcOf(0)).u32(fcOf(all.length)).u32(chpPage);
  pair(12, bc, 12);
  const bp = tb.length;
  tb.u32(fcOf(0)).u32(fcOf(all.length)).u32(papPage);
  pair(13, bp, 12);
  // styles: 0 Normal (sti 0), 1 heading 1 (sti 1)
  const st = tb.length;
  if (!styles) {
    tb.u16(18).u16(2).u16(10).at(st + 2 + 18);
    for (const sti of [0, 1]) { tb.u16(10).u16(sti).bytes([0, 0, 0, 0, 0, 0, 0, 0]); }
  } else {
    // the stylesheet's header: cstd, the STD's fixed size (10), and the default font (index 1) at rgftcStandardChpStsh
    tb.u16(18).u16(styles.length).u16(10).at(st + 2 + 12).u16(1).at(st + 2 + 18);
    for (const sty of styles) {
      const stk = sty.stk ?? 1, base = sty.base ?? 0x0fff;
      const std = new Buf();
      // StdfBase: sti; stk and istdBase; cupx; bchUpe; grfstd
      std.u16(sty.sti).u16(stk | (base << 4)).u16(stk === 1 ? 2 : 1).u16(0).u16(0);
      // no name: its length (0) and the 0 after it
      std.u16(0).u16(0);
      const chpx = sty.chpx ?? [];
      if (stk === 1) std.u16(2).u16(0);
      std.u16(chpx.length).bytes(chpx);
      if (chpx.length % 2) std.u8(0);
      tb.u16(std.length).bytes(std.b);
    }
  }
  pair(1, st, tb.length - st);
  // fonts: Times New Roman, Arial
  const ff = tb.length;
  tb.u16(2).u16(0);
  for (const name of ['Times New Roman', 'Arial']) {
    const data = [...new Array(39).fill(0)];
    for (const ch of name) data.push(ch.charCodeAt(0), 0);
    data.push(0, 0);
    tb.u8(data.length).bytes(data);
  }
  pair(15, ff, tb.length - ff);
  if (notes.length) {
    const fr = tb.length;
    for (const n of notes) tb.u32(n.at);
    tb.u32(main.length);
    for (let i = 0; i < notes.length; i++) tb.u16(1);
    pair(2, fr, tb.length - fr);
    const ft = tb.length;
    let c = 0;
    for (const n of notes) { tb.u32(c); c += n.text.length + 3; }
    tb.u32(c).u32(c + 1);
    pair(3, ft, tb.length - ft);
  }
  return writeCfb([['WordDocument', new Uint8Array(wd.b)], ['1Table', new Uint8Array(tb.b)]]);
}
