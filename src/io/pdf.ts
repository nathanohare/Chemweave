// PDF files from recorded drawings (the same shapes and text as the EMF and SVG pictures), one
// page per slide or one page for a drawing. Lines and text stay sharp at any zoom. Text is
// written in fonts kept inside the file when a font source is given (see pdf-fonts.ts), so it
// looks the same everywhere; characters none of those have, or every character when there is no
// source, use the fonts every PDF reader has (Helvetica, Times, Courier and Symbol).
// Written from the published PDF 1.7 specification (ISO 32000-1).

import { zlibSync } from 'fflate';
import { Item, Seg, ClipBox, parseColor } from '../render/vector';
import { EmbeddedFont, TrueType, subsetTag, type PdfFontSource } from './pdf-fonts';
import { hasKana, type FallbackFile, type PdfFallbackSource } from './pdf-fallback';
import { visualText } from '../text/bidi';

export interface PdfPage {
  /** Page size in points. */
  w: number;
  h: number;
  /** What is drawn, in points from the top left corner of the page. */
  items: Item[];
  /** Where the page's top left corner is in the items' coordinates (0, 0 when left out). */
  origin?: { x: number; y: number };
  /** Places on the page a click follows (in the items' coordinates). */
  links?: PdfLink[];
  /** Headings that start on this page, for the file's bookmarks (its outline, as PDF readers list it). */
  outline?: PdfHeading[];
}

/** A link on a page: a web page or e-mail address (`uri`), or a place in the file (`to`: a page, and points down from its top). */
export interface PdfLink { x: number; y: number; w: number; h: number; uri?: string; to?: { page: number; y: number } }

/** A heading for the file's outline: its text, its level (1 at the top), and where it is on its page (points down from the top). */
export interface PdfHeading { title: string; level: number; y: number }

/** A picture's pixels, ready for a PDF: a JPEG as it is, or red-green-blue bytes and an alpha channel. */
export type PdfImage =
  | { kind: 'jpeg'; bytes: Uint8Array; w: number; h: number; components: 1 | 3 | 4 }
  | { kind: 'raw'; w: number; h: number; rgb: Uint8Array; alpha: Uint8Array | null };

export interface PdfOptions {
  title?: string;
  /** The pixels of a picture (data URL), or null when it can't be shown (it is drawn as a grey box). */
  image(src: string): Promise<PdfImage | null>;
  /** The font files to keep inside the file for a face (left out: the reader's standard fonts). */
  fonts?: PdfFontSource;
  /** Font files for characters neither a face's files nor the standard fonts can draw (Chinese, Hebrew, symbols: pdf-fallback.ts). */
  fallback?: PdfFallbackSource;
  /** How far along the writing is (before each page); a rejection stops it. */
  progress?(done: number, total: number): Promise<void>;
}

// ---------------------------------------------------------------- text encodings

/** Windows' Western character set (PDF's WinAnsiEncoding) beyond Latin-1. */
const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Characters the Symbol font has (Greek letters, arrows, maths), by their place in it. */
const SYMBOL: Record<string, number> = {};
{
  const greek = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
  const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ';
  for (let i = 0; i < 26; i++) {
    SYMBOL[greek[i]] = latin.charCodeAt(i);
    SYMBOL[lower[i]] = latin.toLowerCase().charCodeAt(i);
  }
  Object.assign(SYMBOL, {
    'ς': 0x56, '∆': 0x44, 'Ω': 0x57, '−': 0x2d, '′': 0xa2, '″': 0xb2, '≤': 0xa3, '≥': 0xb3, '∞': 0xa5, '↔': 0xab, '←': 0xac,
    '↑': 0xad, '→': 0xae, '↓': 0xaf, '∝': 0xb5, '∂': 0xb6, '∙': 0xb7, '≠': 0xb9, '≡': 0xba, '≈': 0xbb, '⇔': 0xdb, '⇐': 0xdc,
    '⇑': 0xdd, '⇒': 0xde, '⇓': 0xdf, '√': 0xd6, '⋅': 0xd7, '∑': 0xe5, '∫': 0xf2, '∠': 0xd0, '∇': 0xd1, '∏': 0xd5, '⊕': 0xc5,
    '⊗': 0xc4, '∈': 0xce, '∀': 0x22, '∃': 0x24, '♦': 0xa8, '♥': 0xa9, '♠': 0xaa, '♣': 0xa7, '•': 0xb7, 'µ': 0x6d,
  });
}

/** Where a character can be written: the font's own encoding, or Symbol. */
function winAnsi(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return c;
  return WIN_ANSI_EXTRA[ch] ?? null;
}

/**
 * Wingdings' characters that have one in Unicode, by their code in the font (Word keeps them at
 * U+F020 to U+F0FF; a run in Wingdings may also have them as plain letters): the ones in common use
 * (hands, faces, zodiac signs, circled numbers, bullets, stars, arrows, check boxes). Others are left
 * as they are.
 */
const WINGDINGS: Record<number, number> = {
  0x20: 0x0020, 0x21: 0x270f, 0x22: 0x2702, 0x23: 0x2701, 0x28: 0x260e, 0x29: 0x2706, 0x2a: 0x2709, 0x36: 0x231b, 0x37: 0x2328,
  0x41: 0x270c, 0x45: 0x261c, 0x46: 0x261e, 0x47: 0x261d, 0x48: 0x261f, 0x49: 0x270b, 0x4a: 0x263a, 0x4c: 0x2639,
  0x4e: 0x2620, 0x4f: 0x2690, 0x51: 0x2708, 0x52: 0x263c, 0x54: 0x2744, 0x56: 0x271e, 0x58: 0x2720, 0x59: 0x2721,
  0x5a: 0x262a, 0x5b: 0x262f, 0x5c: 0x0950, 0x5d: 0x2638, 0x6c: 0x25cf, 0x6d: 0x274d, 0x6e: 0x25a0, 0x6f: 0x25a1,
  0x71: 0x2751, 0x72: 0x2752, 0x73: 0x2b27, 0x74: 0x29eb, 0x75: 0x25c6, 0x76: 0x2756, 0x77: 0x2b25, 0x78: 0x2327,
  0x7a: 0x2318, 0x7b: 0x2740, 0x7c: 0x273f, 0x7d: 0x275d, 0x7e: 0x275e, 0x80: 0x24ea, 0x8b: 0x24ff, 0x9e: 0x00b7,
  0x9f: 0x2022, 0xa0: 0x25aa, 0xa1: 0x25cb, 0xa4: 0x25c9, 0xa5: 0x25ce, 0xa7: 0x25aa, 0xa8: 0x25fb, 0xaa: 0x2726,
  0xab: 0x2605, 0xac: 0x2736, 0xad: 0x2734, 0xae: 0x2739, 0xaf: 0x2735, 0xb1: 0x2316, 0xb2: 0x27e1, 0xb3: 0x2311,
  0xd5: 0x232b, 0xd6: 0x2326, 0xd8: 0x27a2, 0xe8: 0x2794, 0xef: 0x21e6, 0xf0: 0x21e8, 0xf1: 0x21e7, 0xf2: 0x21e9,
  0xfb: 0x2717, 0xfc: 0x2713, 0xfd: 0x2612, 0xfe: 0x2611,
};
// (the zodiac signs, ① to ⑩ and ❶ to ❿ in a row)
for (let i = 0; i < 12; i++) WINGDINGS[0x5e + i] = 0x2648 + i;
for (let i = 0; i < 10; i++) { WINGDINGS[0x81 + i] = 0x2460 + i; WINGDINGS[0x8c + i] = 0x2776 + i; }

/** Text in a symbol font (Wingdings) as the Unicode characters it shows, one for one; other fonts' text as it is. */
export function symbolFontText(text: string, family: string): string {
  if (!/^wingdings$/i.test(family.trim())) return text;
  return [...text].map((ch) => {
    const c = ch.codePointAt(0)!;
    const u = WINGDINGS[c >= 0xf020 && c <= 0xf0ff ? c - 0xf000 : c];
    return u ? String.fromCodePoint(u) : ch;
  }).join('');
}

/**
 * What draws nothing: a soft hyphen (the hyphen at a line break is a glyph of its own), the
 * zero-width space, joiners and direction marks (U+200B to U+200F, U+2060), and the variation
 * selectors (U+FE00 to U+FE0F, text or emoji style).
 */
const INVISIBLE = /^[\u00ad\u200b-\u200f\u2060\ufe00-\ufe0f]$/;

/** Text cut into pieces that one font can write, with each piece's position along the line. */
export function textPieces(text: string, widths: number[]): { symbol: boolean; codes: number[]; dx: number }[] {
  const out: { symbol: boolean; codes: number[]; dx: number }[] = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    // a soft hyphen draws nothing (the hyphen at a line break is a glyph of its own)
    if (INVISIBLE.test(ch)) { x += widths[i] ?? 0; return; }
    let code = winAnsi(ch), symbol = false;
    if (code === null && SYMBOL[ch] !== undefined) { code = SYMBOL[ch]; symbol = true; }
    // a narrow no-break space and other spaces count as spaces; anything else unknown shows as "?"
    if (code === null) code = /\s/.test(ch) ? 0x20 : 0x3f;
    const last = out[out.length - 1];
    if (last && last.symbol === symbol) last.codes.push(code);
    else out.push({ symbol, codes: [code], dx: x });
    x += widths[i] ?? 0;
  });
  return out;
}

/** Text cut into runs that one kept font can draw (the first that has each character), and runs that none can. */
export function keptPieces(text: string, widths: number[], fonts: EmbeddedFont[], fallback?: ReadonlyMap<string, EmbeddedFont>): { font: EmbeddedFont | null; text: string; widths: number[]; dx: number }[] {
  const out: { font: EmbeddedFont | null; text: string; widths: number[]; dx: number }[] = [];
  let x = 0;
  [...text].forEach((ch, i) => {
    // a soft hyphen draws nothing (the hyphen at a line break is a glyph of its own)
    if (INVISIBLE.test(ch)) { x += widths[i] ?? 0; return; }
    const c = ch.codePointAt(0)!;
    // (a fallback font only for the characters it was read for: a text's own fonts and the standard ones draw the rest)
    const font = fonts.find((f) => f.font.glyph(c) !== 0) ?? fallback?.get(ch) ?? null;
    const last = out[out.length - 1];
    if (last && last.font === font) { last.text += ch; last.widths.push(widths[i] ?? 0); }
    else out.push({ font, text: ch, widths: [widths[i] ?? 0], dx: x });
    x += widths[i] ?? 0;
  });
  return out;
}

const SERIF = /times|georgia|cambria|garamond|serif$|book antiqua|palatino/i;
const MONO = /courier|consolas|mono/i;

/** The standard PDF font that looks most like a font family. */
export function standardFont(family: string, bold: boolean, italic: boolean): string {
  if (/^symbol$/i.test(family)) return 'Symbol';
  const style = (base: string, b: string, i: string, bi: string) => (bold && italic ? bi : bold ? b : italic ? i : base);
  if (MONO.test(family)) return style('Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique');
  if (SERIF.test(family) && !/sans/i.test(family)) return style('Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic');
  return style('Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique');
}

/** A JPEG's size and number of colour channels, from its frame header. */
export function jpegInfo(b: Uint8Array): { w: number; h: number; components: 1 | 3 | 4 } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const n = b[i + 9];
      return n === 1 || n === 3 || n === 4 ? { h: v.getUint16(i + 5), w: v.getUint16(i + 7), components: n } : null;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + v.getUint16(i + 2);
  }
  return null;
}

// ---------------------------------------------------------------- writing the file

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function pdfString(codes: number[]): string {
  let s = '(';
  for (const c of codes) {
    if (c === 0x28 || c === 0x29 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c < 0x20 || c > 0x7e) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}

/** Text that can go in the document's information (title), in PDF's Unicode form when needed. */
function infoString(t: string): string {
  if ([...t].every((ch) => winAnsi(ch) !== null && ch.charCodeAt(0) < 0x80)) return pdfString([...t].map((ch) => ch.charCodeAt(0)));
  let hex = 'FEFF';
  for (let i = 0; i < t.length; i++) hex += t.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

function pathOps(segs: Seg[]): string {
  return segs.map((s) => {
    switch (s.k) {
      case 'M': return `${num(s.x)} ${num(s.y)} m`;
      case 'L': return `${num(s.x)} ${num(s.y)} l`;
      case 'C': return `${num(s.x1)} ${num(s.y1)} ${num(s.x2)} ${num(s.y2)} ${num(s.x)} ${num(s.y)} c`;
      case 'Z': return 'h';
    }
  }).join('\n');
}

const CAP: Record<CanvasLineCap, number> = { butt: 0, round: 1, square: 2 };
const JOIN: Record<CanvasLineJoin, number> = { miter: 0, round: 1, bevel: 2 };

/** Collects the numbered objects of a PDF file. */
class Objects {
  private parts: (string | Uint8Array)[] = [];
  private offsets: number[] = [];
  private length = 0;
  private enc = new TextEncoder();

  constructor() {
    // the header, and a comment with high bytes so programs treat the file as binary
    this.push('%PDF-1.7\n%âãÏÓ\n');
  }

  private push(p: string | Uint8Array): void {
    const b = typeof p === 'string' ? latin1(p) : p;
    this.parts.push(b);
    this.length += b.length;
  }

  /** Reserve an object number (to refer to it before it is written). */
  reserve(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }

  /** Write object `n` (or a new one). Returns its number. */
  put(body: string, n = this.reserve()): number {
    this.offsets[n - 1] = this.length;
    this.push(`${n} 0 obj\n${body}\nendobj\n`);
    return n;
  }

  /** A stream object, compressed unless it already is. */
  stream(dict: string, data: Uint8Array, compress = true, n = this.reserve()): number {
    const bytes = compress ? zlibSync(data, { level: 6 }) : data;
    const filter = compress ? '/Filter /FlateDecode ' : '';
    this.offsets[n - 1] = this.length;
    this.push(`${n} 0 obj\n<< ${filter}${dict} /Length ${bytes.length} >>\nstream\n`);
    this.push(bytes);
    this.push('\nendstream\nendobj\n');
    return n;
  }

  text(s: string): Uint8Array {
    return this.enc.encode(s);
  }

  finish(root: number, info: number): Uint8Array {
    const xref = this.length;
    let x = `xref\n0 ${this.offsets.length + 1}\n0000000000 65535 f \n`;
    for (const o of this.offsets) x += `${String(Math.max(0, o)).padStart(10, '0')} 00000 n \n`;
    x += `trailer\n<< /Size ${this.offsets.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.push(x);
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) { out.set(p as Uint8Array, at); at += (p as Uint8Array).length; }
    return out;
  }
}

/** Characters 0–255 as single bytes (the file's own text is plain ASCII apart from the header comment). */
function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

// ---------------------------------------------------------------- links and the outline

/** A link's address as a PDF string: 7-bit ASCII (anything else percent-encoded, as URIs are written). */
function uriString(uri: string): string {
  // (u: a character outside the first plane is one character, not two halves encodeURIComponent can't take)
  const ascii = uri.replace(/[^\x20-\x7e]/gu, (ch) => encodeURIComponent(ch));
  return pdfString([...ascii].map((ch) => ch.charCodeAt(0)));
}

/** Where a place in the file is, as a destination: the page, scrolled to `y` points down from its top (ISO 32000-1 §12.3.2.2, /XYZ). */
function destination(pages: PdfPage[], pageIds: number[], to: { page: number; y: number }): string | null {
  const target = pages[to.page];
  if (!target) return null;
  return `[${pageIds[to.page]} 0 R /XYZ null ${num(Math.max(0, Math.min(target.h, target.h - to.y)))} null]`;
}

/** A page's links as link annotations (§12.5.6.5), with no border drawn: their numbers. */
function linkAnnots(o: Objects, page: PdfPage, pages: PdfPage[], pageIds: number[]): number[] {
  const out: number[] = [];
  const ox = page.origin?.x ?? 0, oy = page.origin?.y ?? 0;
  for (const l of page.links ?? []) {
    if (!(l.w > 0) || !(l.h > 0)) continue;
    let action: string | null = null;
    if (l.to) { const d = destination(pages, pageIds, l.to); if (d) action = `/Dest ${d}`; }
    else if (l.uri) action = `/A << /S /URI /URI ${uriString(l.uri)} >>`;
    if (!action) continue;
    const x1 = l.x - ox, x2 = x1 + l.w, y2 = page.h - (l.y - oy), y1 = y2 - l.h;
    out.push(o.put(`<< /Type /Annot /Subtype /Link /Rect [${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)}] /Border [0 0 0] ${action} >>`));
  }
  return out;
}

/** The file's outline (§12.3.3) from the pages' headings, nested by level: its number, or 0 when there are none. */
function outlineOf(o: Objects, pages: PdfPage[], pageIds: number[]): number {
  type Node = { title: string; level: number; dest: string; id: number; kids: Node[]; parent: Node | null };
  const root: Node = { title: '', level: 0, dest: '', id: 0, kids: [], parent: null };
  let last = root;
  pages.forEach((p, i) => {
    for (const h of p.outline ?? []) {
      const dest = destination(pages, pageIds, { page: i, y: h.y });
      if (!dest || !h.title.trim()) continue;
      let parent = last;
      while (parent !== root && parent.level >= h.level) parent = parent.parent!;
      const node: Node = { title: h.title.trim(), level: h.level, dest, id: o.reserve(), kids: [], parent };
      parent.kids.push(node);
      last = node;
    }
  });
  if (!root.kids.length) return 0;
  root.id = o.reserve();
  // (each heading's own headings start closed, so the outline opens as its top level)
  const count = (n: Node): number => n.kids.reduce((a, k) => a + 1 + count(k), 0);
  const write = (n: Node): void => {
    n.kids.forEach((k, i) => {
      const prev = n.kids[i - 1], next = n.kids[i + 1];
      const kids = k.kids.length ? ` /First ${k.kids[0].id} 0 R /Last ${k.kids[k.kids.length - 1].id} 0 R /Count -${count(k)}` : '';
      o.put(`<< /Title ${infoString(k.title)} /Parent ${n.id} 0 R${prev ? ` /Prev ${prev.id} 0 R` : ''}${next ? ` /Next ${next.id} 0 R` : ''}${kids} /Dest ${k.dest} >>`, k.id);
      write(k);
    });
  };
  write(root);
  o.put(`<< /Type /Outlines /First ${root.kids[0].id} 0 R /Last ${root.kids[root.kids.length - 1].id} 0 R /Count ${root.kids.length} >>`, root.id);
  return root.id;
}

/** A PDF file with these pages. */
export async function writePdf(pages: PdfPage[], opts: PdfOptions): Promise<Uint8Array> {
  const o = new Objects();
  const catalog = o.reserve(), pagesId = o.reserve();
  const fonts = new Map<string, number>();
  const fontRef = (name: string) => {
    let n = fonts.get(name);
    if (!n) {
      const enc = name === 'Symbol' ? '' : ' /Encoding /WinAnsiEncoding';
      n = o.put(`<< /Type /Font /Subtype /Type1 /BaseFont /${name}${enc} >>`);
      fonts.set(name, n);
    }
    return `F${n}`;
  };
  // fonts kept in the file: each face's files, read once
  const faces = new Map<string, Promise<EmbeddedFont[]>>();
  const kept: EmbeddedFont[] = [];
  const faceFonts = (family: string, bold: boolean, italic: boolean): Promise<EmbeddedFont[]> => {
    if (!opts.fonts) return Promise.resolve([]);
    const key = `${family.toLowerCase()}|${bold}|${italic}`;
    let f = faces.get(key);
    if (!f) {
      f = opts.fonts(family, bold, italic).catch(() => [] as Uint8Array[]).then((files) => files.flatMap((data) => {
        try {
          const tt = new TrueType(data);
          if (!tt.embeddable) return [];
          const e = new EmbeddedFont(tt, o.reserve(), subsetTag(kept.length));
          kept.push(e);
          return [e];
        } catch { return []; }
      }));
      faces.set(key, f);
    }
    return f;
  };
  // fonts for what a face can't draw (pdf-fallback.ts): each file read once, in the order asked for,
  // so a file's place in the PDF is the same every time
  const fallbacks = new Map<string, Promise<EmbeddedFont | null>>();
  const fallbackFile = (file: FallbackFile): Promise<EmbeddedFont | null> => {
    let f = fallbacks.get(file.key);
    if (!f) {
      f = file.load().then((data) => {
        const tt = new TrueType(data);
        if (!tt.embeddable) return null;
        const e = new EmbeddedFont(tt, o.reserve(), subsetTag(kept.length));
        kept.push(e);
        return e;
      }).catch(() => null);
      fallbacks.set(file.key, f);
    }
    return f;
  };
  // (each character's, looked for once in the PDF: by itself, and in Japanese text)
  const fallbackOf = new Map<string, Promise<EmbeddedFont | null>>();
  /** For each character neither a face's files nor the standard fonts (Symbol among them) can draw, the first fallback font that has it. */
  const fallbackFonts = async (text: string, fonts: EmbeddedFont[]): Promise<Map<string, EmbeddedFont>> => {
    const out = new Map<string, EmbeddedFont>();
    if (!opts.fallback) return out;
    const kana = hasKana(text);
    const missing = [...new Set(text)].filter((ch) => !/\s/.test(ch) && !INVISIBLE.test(ch) && winAnsi(ch) === null && SYMBOL[ch] === undefined && !fonts.some((f) => f.font.glyph(ch.codePointAt(0)!) !== 0));
    for (const ch of missing) {
      const key = `${ch}|${kana}`;
      let found = fallbackOf.get(key);
      if (!found) {
        found = (async () => {
          const files = await Promise.resolve().then(() => opts.fallback!(ch, text)).catch(() => [] as FallbackFile[]);
          for (const file of files) {
            const e = await fallbackFile(file);
            if (e && e.font.glyph(ch.codePointAt(0)!) !== 0) return e;
          }
          return null;
        })();
        fallbackOf.set(key, found);
      }
      const e = await found;
      if (e) out.set(ch, e);
    }
    return out;
  };
  // each picture is stored once, however many times it shows
  const images = new Map<string, number | null>();
  const imageRef = async (src: string): Promise<number | null> => {
    if (images.has(src)) return images.get(src)!;
    let n: number | null = null;
    const img = await opts.image(src).catch(() => null);
    if (img?.kind === 'jpeg') {
      const cs = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      // CMYK JPEGs from Adobe programs store their ink amounts inverted
      const decode = img.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      n = o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace ${cs} /BitsPerComponent 8${decode} /Filter /DCTDecode`, img.bytes, false);
    } else if (img?.kind === 'raw') {
      const mask = img.alpha ? o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha) : 0;
      n = o.stream(`/Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8${mask ? ` /SMask ${mask} 0 R` : ''}`, img.rgb);
    }
    images.set(src, n);
    return n;
  };
  // see-through colours need a graphics state each
  const alphas = new Map<string, number>();
  const alphaRef = (fill: number, stroke: number) => {
    const key = `${num(fill)}/${num(stroke)}`;
    let n = alphas.get(key);
    if (!n) { n = o.put(`<< /Type /ExtGState /ca ${num(fill)} /CA ${num(stroke)} >>`); alphas.set(key, n); }
    return `G${n}`;
  };

  const kids: number[] = [];
  // (each page's number known before it is written: a link can go to a later page)
  const pageIds = pages.map(() => o.reserve());
  for (const [pageNo, page] of pages.entries()) {
    if (opts.progress) await opts.progress(kids.length, pages.length);
    const ops: string[] = [];
    const usedFonts = new Set<string>(), usedImages = new Set<number>(), usedStates = new Set<string>();
    // points from the top left, as recorded: flip the page's y axis
    ops.push(`1 0 0 -1 0 ${num(page.h)} cm`);
    if (page.origin) ops.push(`1 0 0 1 ${num(-page.origin.x)} ${num(-page.origin.y)} cm`);
    const rgb = (c: string) => {
      const k = parseColor(c);
      return { v: `${num(k.r / 255)} ${num(k.g / 255)} ${num(k.b / 255)}`, a: k.a };
    };
    // what an item is cut off by (a table row of exact height), inside its own q … Q
    const clipOps = (c: ClipBox | undefined) => { if (c) ops.push(`${num(c.x1)} ${num(c.y1)} ${num(c.x2 - c.x1)} ${num(c.y2 - c.y1)} re W n`); };
    for (const it of page.items) {
      if (it.kind === 'path') {
        if (!it.segs.some((s) => s.k !== 'M')) continue;
        const paint = it.fill ? rgb(it.fill) : rgb(it.stroke!.color);
        if (paint.a <= 0) continue;
        ops.push('q');
        clipOps(it.clip);
        if (paint.a < 1) {
          const g = it.fill ? alphaRef(paint.a, 1) : alphaRef(1, paint.a);
          usedStates.add(g);
          ops.push(`/${g} gs`);
        }
        if (it.fill) ops.push(`${paint.v} rg`, pathOps(it.segs), 'f');
        else {
          const st = it.stroke!;
          ops.push(`${paint.v} RG`, `${num(st.width)} w ${CAP[st.cap] ?? 0} J ${JOIN[st.join] ?? 0} j`, pathOps(it.segs), 'S');
        }
        ops.push('Q');
      } else if (it.kind === 'text') {
        const paint = rgb(it.color);
        if (paint.a <= 0 || !it.text) continue;
        ops.push('q');
        clipOps(it.clip);
        ops.push(`${paint.v} rg`);
        // turned text (degrees anticlockwise): along the line, and up from it, on the page
        const a = ((it.angle ?? 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        const own = await faceFonts(it.family, it.bold, it.italic);
        // (right-to-left text: its letters in the order they are seen, Arabic's joined, as the screen shows them)
        const seenText = visualText(symbolFontText(it.text, it.family), it.widths, !!it.rtl);
        const text = seenText.text;
        const extra = await fallbackFonts(text, own);
        const show = (f: string, dx: number, s: string) => {
          usedFonts.add(f);
          // the text matrix turns the letters the right way up again
          const m = `${num(cos)} ${num(-sin)} ${num(-sin)} ${num(-cos)} ${num(it.x + dx * cos)} ${num(it.y - dx * sin)}`;
          ops.push(`BT /${f} ${num(it.size)} Tf ${m} Tm ${s} ${s.startsWith('[') ? 'TJ' : 'Tj'} ET`);
        };
        for (const piece of keptPieces(text, seenText.widths, own, extra)) {
          if (piece.font) show(`F${piece.font.id}`, piece.dx, piece.font.show(piece.text, piece.widths, it.size));
          else for (const p of textPieces(piece.text, piece.widths)) show(fontRef(p.symbol ? 'Symbol' : standardFont(it.family, it.bold, it.italic)), piece.dx + p.dx, pdfString(p.codes));
        }
        ops.push('Q');
      } else {
        const n = await imageRef(it.src);
        const c = it.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const W = it.w / Math.max(0.01, 1 - c.l - c.r), H = it.h / Math.max(0.01, 1 - c.t - c.b);
        ops.push('q');
        clipOps(it.clip);
        if (it.rot) {
          // turned about its middle (in the page's points from the top left, as recorded)
          const a = (it.rot * Math.PI) / 180, cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          ops.push(`1 0 0 1 ${num(cx)} ${num(cy)} cm ${num(Math.cos(a))} ${num(Math.sin(a))} ${num(-Math.sin(a))} ${num(Math.cos(a))} 0 0 cm 1 0 0 1 ${num(-cx)} ${num(-cy)} cm`);
        }
        if (it.flipH || it.flipV) {
          const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
          ops.push(`1 0 0 1 ${num(cx)} ${num(cy)} cm ${it.flipH ? -1 : 1} 0 0 ${it.flipV ? -1 : 1} 0 0 cm 1 0 0 1 ${num(-cx)} ${num(-cy)} cm`);
        }
        ops.push(`${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re W n`);
        if (n) {
          usedImages.add(n);
          // the picture's top row goes at the top
          ops.push(`${num(W)} 0 0 ${num(-H)} ${num(it.x - c.l * W)} ${num(it.y - c.t * H + H)} cm /I${n} Do`);
        } else ops.push(`0.85 0.85 0.85 rg ${num(it.x)} ${num(it.y)} ${num(it.w)} ${num(it.h)} re f`);
        ops.push('Q');
      }
    }
    const content = o.stream('', o.text(ops.join('\n')));
    const res = [
      usedFonts.size ? `/Font << ${[...usedFonts].map((f) => `/${f} ${f.slice(1)} 0 R`).join(' ')} >>` : '',
      usedImages.size ? `/XObject << ${[...usedImages].map((n) => `/I${n} ${n} 0 R`).join(' ')} >>` : '',
      usedStates.size ? `/ExtGState << ${[...usedStates].map((g) => `/${g} ${g.slice(1)} 0 R`).join(' ')} >>` : '',
    ].filter(Boolean).join(' ');
    const annots = linkAnnots(o, page, pages, pageIds);
    kids.push(o.put(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.w)} ${num(page.h)}] /Resources << ${res} >> /Contents ${content} 0 R${annots.length ? ` /Annots [${annots.map((n) => `${n} 0 R`).join(' ')}]` : ''} >>`, pageIds[pageNo]));
  }
  for (const e of kept) {
    if (!e.used.size) { o.put('null', e.id); continue; }
    const fontFile = o.stream(`/Length1 ${e.font.data.length}`, e.font.data);
    const descriptor = o.reserve(), cidFont = o.reserve(), toUnicode = o.reserve();
    const parts = e.objects({ fontFile, cidFont, descriptor, toUnicode });
    o.put(parts.descriptor, descriptor);
    o.put(parts.cidFont, cidFont);
    o.stream('', o.text(parts.toUnicode), true, toUnicode);
    o.put(parts.type0, e.id);
  }
  o.put(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`, pagesId);
  const outline = outlineOf(o, pages, pageIds);
  o.put(`<< /Type /Catalog /Pages ${pagesId} 0 R${outline ? ` /Outlines ${outline} 0 R` : ''} >>`, catalog);
  const info = o.put(`<< /Producer (Chemweave)${opts.title ? ` /Title ${infoString(opts.title)}` : ''} >>`);
  return o.finish(catalog, info);
}
