// Reading an SI to import it (Chem SI Assistant's core/si_import_read.py, SPEC §13u.2): Word
// (.docx) or PDF, into paragraphs of formatted text in reading order.
//
// * Word: the paragraphs of word/document.xml (also inside content controls and table cells,
//   the latter marked as such), with bold, italic, superscript and subscript, and the heading
//   level of a paragraph styled as a heading. A line break inside a paragraph starts a new one.
// * PDF: the text pieces with their fonts, sizes and positions (as the manuscript check reads
//   them) are put together into lines (a smaller piece set higher or lower is a superscript or a
//   subscript) and the lines into paragraphs. Page headers and footers are left out, and pages
//   that are mostly a spectrum's axis and peak labels are set aside (`spectrumPages`).
//
// The file is only read, never changed. Readers never throw for a bad file: the result's `error`
// says what went wrong in plain words.

import { unzipSync } from 'fflate';
import { writeMarkup, type Run, type VAlign } from './markup';
import { errName, parseXml, pdfjsLib, pdfSpans } from './ms-read';
import type { Span } from './ms-parse';
import { cfbStreams } from '../io/cfb';
import { isAlnum, isLower, median, rx, search, match, strip, rstrip, lstrip, sub } from './py';

/** progress(done, total): false stops reading (the result then says it was stopped). */
export type Progress = ((done: number, total: number) => boolean | void) | null;

/** An object anchored in a Word paragraph: a ChemDraw drawing, a MestReNova spectrum, a picture… */
export interface DocObject {
  kind: 'chemdraw' | 'mnova' | 'other' | 'picture';
  prog: string;
  name: string;
  picture: Uint8Array | null;
  picture_name: string;
  group: number;
  width_in: number | null;
  /** ChemDraw: the drawing's CDX data. */
  cdx?: Uint8Array;
}

/** One paragraph of the SI. */
export interface Para {
  runs: Run[];
  /** PDF: the page (1, 2, …); Word: 0. */
  page: number;
  /** Word: the level of a paragraph styled as a heading (1–3). */
  heading: number;
  /** PDF: the main font size of its text (pt). */
  size: number;
  /** Word: from a table's cell. */
  table: boolean;
  /** PDF: where its first line is on the page (pt from the top), and where its last line ends. */
  top: number;
  bottom: number;
  objects: DocObject[];
  /** Word, in a table: [table number, row, column, columns spanned, "restart" / "continue" / ""]. */
  cell: [number, number, number, number, string] | null;
  /** PDF: its left and right ends (pt); whether it is a table's row (wide gaps). */
  left: number;
  right: number;
  columnar: boolean;
}

export const newPara = (runs: Run[], extra: Partial<Para> = {}): Para => ({
  runs, page: 0, heading: 0, size: 0, table: false, top: 0, bottom: 0, objects: [], cell: null, left: 0, right: 0, columnar: false, ...extra,
});

/** The plain text, spaces evened out. */
export const paraText = (p: Para): string => cleanSpace(p.runs.map((r) => r.text).join(''));
/** The text in the program's stored form (bold, subscripts… kept). */
export const paraMarkup = (p: Para): string => runsMarkup(p.runs);
export const runsMarkup = (runs: Run[]): string => writeMarkup([{ runs: mergeRuns(runs) }]).trim();

/** How much of its letters and digits are bold (0–1). */
export function boldShare(p: Para): number {
  let total = 0, bold = 0;
  for (const r of p.runs) {
    const n = [...r.text].filter(isAlnum).length;
    total += n;
    if (r.bold) bold += n;
  }
  return total ? bold / total : 0;
}

export interface ReadResult {
  file_name: string;
  kind: string;
  paras: Para[];
  pages: number;
  spectrum_pages: number[];
  notes: string[];
  error: string;
  stopped: boolean;
  /** The file's bytes (for cutting pictures out of a PDF later). */
  data?: Uint8Array;
}

const newResult = (name: string, kind: string): ReadResult => ({ file_name: name, kind, paras: [], pages: 0, spectrum_pages: [], notes: [], error: '', stopped: false });

export function cleanSpace(text: string): string {
  return strip(sub(rx('\\s+'), ' ', text.replaceAll(' ', ' ').replaceAll(' ', ' ').replaceAll(' ', ' ')));
}

export const R = (text: string, bold = false, italic = false, valign: VAlign = 'normal', underline = false): Run =>
  ({ text, bold, italic, valign, ...(underline ? { underline } : {}) });
const va = (r: Run): VAlign => r.valign ?? 'normal';
const same = (a: Run, b: Run): boolean => !a.ref && !b.ref && !!a.bold === !!b.bold && !!a.italic === !!b.italic && va(a) === va(b) && !!a.underline === !!b.underline;
const withText = (r: Run, text: string): Run => R(text, !!r.bold, !!r.italic, va(r), !!r.underline);

/** Neighbouring runs with the same format joined, spaces evened out, ends trimmed. */
export function mergeRuns(runs: Run[]): Run[] {
  let out: Run[] = [];
  for (const r of runs) {
    const text = r.text.replace(/[ \t   ]+/g, ' ');
    if (!text) continue;
    if (out.length && same(out[out.length - 1], r)) out[out.length - 1] = withText(r, out[out.length - 1].text + text);
    else out.push(withText(r, text));
  }
  // no doubled spaces where two runs meet, no spaces at the ends
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1].text.endsWith(' ') && out[i].text.startsWith(' ')) out[i] = withText(out[i], out[i].text.slice(1));
  }
  // A subscript never follows a space ("CDCl _{3}" from a PDF's estimated widths).
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    if (va(out[i]) === 'sub' && prev.text.endsWith(' ') && isAlnum(rstrip(prev.text).slice(-1))) out[i - 1] = withText(prev, rstrip(prev.text));
  }
  out = out.filter((r) => r.text);
  if (out.length) {
    out[0] = withText(out[0], lstrip(out[0].text));
    const k = out.length - 1;
    out[k] = withText(out[k], rstrip(out[k].text));
  }
  return out.filter((r) => r.text);
}

const suffixOf = (name: string): string => { const m = /\.[^./\\]*$/.exec(name); return m ? m[0].toLowerCase() : ''; };

/** Read a .docx or .pdf SI (by its extension). */
export async function readSiFile(name: string, bytes: Uint8Array, progress: Progress = null): Promise<ReadResult> {
  const suffix = suffixOf(name);
  if (suffix === '.docx') return readSiDocxSteps(name, bytes, progress);
  if (suffix === '.pdf') return readSiPdf(name, bytes, progress);
  const res = newResult(name, suffix.replace(/^\./, ''));
  res.error = `“${name}” is not a Word (.docx) or PDF file. Older Word files (.doc) can be saved as .docx from Word (File ▸ Save As).`;
  return res;
}

// ---------------------------------------------------------------------- Word (.docx)

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const O_NS = 'urn:schemas-microsoft-com:office:office';
const V_NS = 'urn:schemas-microsoft-com:vml';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

/** Characters of the Symbol font (Word's "Insert ▸ Symbol"), by their code's low byte. */
const SYMBOL: Record<number, string> = {
  0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x44: 'Δ', 0x65: 'ε', 0x66: 'φ', 0x67: 'γ', 0x47: 'Γ', 0x68: 'η', 0x6b: 'κ', 0x6c: 'λ', 0x6d: 'μ', 0x6e: 'ν',
  0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x53: 'Σ', 0x74: 'τ', 0x77: 'ω', 0x57: 'Ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ', 0xa2: '′', 0xb2: '″', 0xa3: '≤',
  0xb3: '≥', 0xb0: '°', 0xb1: '±', 0xb4: '×', 0xae: '→', 0xac: '←', 0xab: '↔', 0xb7: '•', 0x2d: '−', 0xbb: '≈',
};

const is = (el: Element, ns: string, local: string): boolean => el.namespaceURI === ns && el.localName === local;
const kids = (el: Element): Element[] => Array.from(el.children);
const find = (el: Element | null, ns: string, local: string): Element | null => (el ? kids(el).find((c) => is(c, ns, local)) ?? null : null);
/** Every descendant with this name, in document order (ElementTree's iter, the element itself included). */
const iterOf = (el: Element, ns: string, local: string): Element[] => [...(is(el, ns, local) ? [el] : []), ...Array.from(el.getElementsByTagNameNS(ns, local))];
const wAttr = (el: Element, local: string): string | null => el.getAttributeNS(W, local);
const on = (el: Element | null): boolean => !!el && [null, '1', 'true', 'on'].includes(wAttr(el, 'val'));

/** Bold, italic, underline and raised or lowered, as a style or a run sets them (unset: not said). */
interface Look { bold?: boolean; italic?: boolean; underline?: boolean; valign?: VAlign }

/** The styles of word/styles.xml: each one's heading level (0 for none) and look, its basedOn chain followed. */
interface Styles { level: Map<string, number>; look: Map<string, Look>; defaultPara: string }

/** What a w:rPr sets (17.3.2.28): b, i, u, vertAlign, and w:position as raised or lowered. */
function lookOf(rpr: Element | null): Look {
  const out: Look = {};
  if (!rpr) return out;
  const b = find(rpr, W, 'b'), i = find(rpr, W, 'i'), u = find(rpr, W, 'u');
  if (b) out.bold = on(b);
  if (i) out.italic = on(i);
  if (u) out.underline = (wAttr(u, 'val') ?? 'single') !== 'none';
  const v = find(rpr, W, 'vertAlign'), pos = find(rpr, W, 'position');
  if (v) out.valign = ({ superscript: 'super', subscript: 'sub' } as Record<string, VAlign>)[wAttr(v, 'val') ?? ''] ?? 'normal';
  else if (pos) { const n = Number(wAttr(pos, 'val') ?? 0); out.valign = n > 0 ? 'super' : n < 0 ? 'sub' : 'normal'; }
  return out;
}

const over = (a: Look, b: Look): Look => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
};

/** The styles of word/styles.xml: heading levels, and each style's look over those it is based on. */
function styleInfo(z: Record<string, Uint8Array>): Styles {
  const out: Styles = { level: new Map(), look: new Map(), defaultPara: '' };
  let root: Element;
  try {
    if (!z['word/styles.xml']) return out;
    root = parseXml(new TextDecoder().decode(z['word/styles.xml'])).documentElement;
  } catch { return out; }
  const own = new Map<string, { look: Look; base: string }>();
  for (const st of iterOf(root, W, 'style')) {
    const sid = wAttr(st, 'styleId') ?? '';
    const nameEl = find(st, W, 'name');
    const name = ((nameEl ? wAttr(nameEl, 'val') : sid) || '').toLowerCase();
    let level = 0;
    const m = /^heading\s*(\d)/.exec(name);
    if (m) level = Number(m[1]);
    else if (name === 'title') level = 1;
    out.level.set(sid, level);
    const based = find(st, W, 'basedOn');
    own.set(sid, { look: lookOf(find(st, W, 'rPr')), base: based ? wAttr(based, 'val') ?? '' : '' });
    if (wAttr(st, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(wAttr(st, 'default') ?? '')) out.defaultPara = sid;
  }
  const resolve = (id: string, seen: Set<string>): Look => {
    const hit = out.look.get(id);
    if (hit) return hit;
    const s = own.get(id);
    if (!s || seen.has(id)) return {};
    seen.add(id);
    const look = over(s.base ? resolve(s.base, seen) : {}, s.look);
    out.look.set(id, look);
    return look;
  };
  for (const id of own.keys()) resolve(id, new Set());
  return out;
}

/** A run's look: its paragraph style's, its character style's, then its own. */
function runFormat(rpr: Element | null, para: Look, styles: Styles): [boolean, boolean, VAlign, boolean] {
  const rs = rpr ? find(rpr, W, 'rStyle') : null;
  const l = over(over(para, rs ? styles.look.get(wAttr(rs, 'val') ?? '') ?? {} : {}), lookOf(rpr));
  return [!!l.bold, !!l.italic, l.valign ?? 'normal', !!l.underline];
}

/** A file of the .docx named by a relationship's target (relative to word/). */
function member(z: Record<string, Uint8Array>, name: string): Uint8Array | null {
  if (!name || name.includes('://')) return null;
  let n = name.replace(/^\/+/, '');
  if (n.startsWith('word/')) n = n.slice(5);
  return z['word/' + n] ?? null;
}

/** A VML shape's width on the page in inches ("width:123.4pt" in its style). */
function vmlWidth(shape: Element | null): number | null {
  if (!shape) return null;
  const m = /(?:^|;)\s*width\s*:\s*([\d.]+)\s*(pt|in|cm|mm|px)?/.exec(shape.getAttribute('style') ?? '');
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  return value / ({ pt: 72, in: 1, cm: 2.54, mm: 25.4, px: 96 } as Record<string, number>)[m[2] ?? 'pt'];
}

class DocxReader {
  groups = 0;
  constructor(readonly z: Record<string, Uint8Array>, readonly rels: Map<string, string>) {}

  /** The embedded objects in a paragraph (SPEC §13u.7), then the paragraph's own pictures. */
  objects(p: Element): DocObject[] {
    const out: DocObject[] = [];
    for (const obj of Array.from(p.getElementsByTagNameNS(W, 'object'))) {
      // One object can be a group of several (a spectrum with its structure…): each
      // OLEObject names its shape, which holds its picture.
      this.groups++;
      const shapes = new Map<string | null, Element>();
      for (const s of Array.from(obj.getElementsByTagNameNS(V_NS, 'shape'))) shapes.set(s.getAttribute('id'), s);
      for (const ole of Array.from(obj.getElementsByTagNameNS(O_NS, 'OLEObject'))) {
        const entry = this.one(ole, shapes, obj);
        entry.group = this.groups;
        out.push(entry);
      }
    }
    out.push(...this.pictures(p));
    return out;
  }

  private pictures(p: Element): DocObject[] {
    const out: DocObject[] = [];
    const add = (rid: string | null, width: number | null): void => {
      const name = this.rels.get(rid ?? '') ?? '';
      const data = member(this.z, name);
      if (data && data.length) {
        this.groups++;
        out.push({ kind: 'picture', prog: '', name: '', picture: data, picture_name: name, group: this.groups, width_in: width });
      }
    };
    const walk = (el: Element): void => {
      for (const child of kids(el)) {
        if (is(child, MC_NS, 'Fallback') || is(child, W, 'object')) continue;
        if (is(child, W, 'drawing')) {
          const extent = child.getElementsByTagNameNS(WP_NS, 'extent')[0];
          const cx = extent ? Number(extent.getAttribute('cx')) : NaN;
          const width = extent && extent.getAttribute('cx') !== null && Number.isInteger(cx) ? cx / 914400 : null;
          for (const blip of Array.from(child.getElementsByTagNameNS(A_NS, 'blip'))) add(blip.getAttributeNS(R_NS, 'embed'), width);
        } else if (is(child, W, 'pict')) {
          const shape = child.getElementsByTagNameNS(V_NS, 'shape')[0] ?? null;
          for (const img of Array.from(child.getElementsByTagNameNS(V_NS, 'imagedata'))) add(img.getAttributeNS(R_NS, 'id'), vmlWidth(shape));
        } else walk(child);
      }
    };
    walk(p);
    return out;
  }

  private one(ole: Element, shapes: Map<string | null, Element>, obj: Element): DocObject {
    const prog = ole.getAttribute('ProgID') ?? '';
    const target = this.rels.get(ole.getAttributeNS(R_NS, 'id') ?? '') ?? '';
    const shape = shapes.get(ole.getAttribute('ShapeID') ?? '') ?? null;
    const img = (shape ?? obj).getElementsByTagNameNS(V_NS, 'imagedata')[0] ?? null;
    const pictureName = img ? this.rels.get(img.getAttributeNS(R_NS, 'id') ?? '') ?? '' : '';
    const entry: DocObject = {
      kind: 'other', prog, name: target, picture: member(this.z, pictureName), picture_name: pictureName, group: 0,
      width_in: vmlWidth(shape ?? obj.getElementsByTagNameNS(V_NS, 'shape')[0] ?? null),
    };
    if (prog.toLowerCase().startsWith('chemdraw')) {
      const data = member(this.z, target);
      let cdx: Uint8Array | undefined;
      try { cdx = data ? cfbStreams(data).get('CONTENTS') : undefined; } catch { cdx = undefined; }
      if (cdx) { entry.kind = 'chemdraw'; entry.cdx = cdx; }
    } else if (prog.toLowerCase().includes('mestrenova')) entry.kind = 'mnova';
    return entry;
  }
}

const SKIP = new Set(['del', 'moveFrom', 'pPr', 'rPr', 'fldChar', 'instrText', 'txbxContent', 'drawing', 'pict', 'object', 'footnoteReference', 'endnoteReference']);

/** A w:p as one or more [runs, heading level]: split at its line and page breaks. */
function docxParagraph(p: Element, styles: Styles): [Run[], number][] {
  const ppr = find(p, W, 'pPr');
  let level = 0;
  const ps = ppr ? find(ppr, W, 'pStyle') : null;
  const pid = ps ? wAttr(ps, 'val') ?? '' : styles.defaultPara;
  const para = styles.look.get(pid) ?? {};
  if (ppr) {
    if (ps) level = styles.level.get(pid) ?? 0;
    const ol = find(ppr, W, 'outlineLvl');
    if (ol && !level) {
      const v = wAttr(ol, 'val') || '9';
      if (/^\s*[-+]?\d+\s*$/.test(v)) level = Math.min(3, parseInt(v, 10) + 1);
    }
  }
  const pieces: Run[][] = [[]];
  const run = (r: Element): void => {
    const [bold, italic, valign, underline] = runFormat(find(r, W, 'rPr'), para, styles);
    for (const child of kids(r)) {
      if (child.namespaceURI !== W) continue;
      let text: string;
      switch (child.localName) {
        case 't': text = child.textContent ?? ''; break;
        case 'tab': text = ' '; break;
        case 'br': case 'cr': pieces.push([]); continue;
        case 'noBreakHyphen': text = '-'; break;
        case 'sym': {
          const code = wAttr(child, 'char') || '0';
          if (!/^\s*[0-9a-fA-F]+\s*$/.test(code)) continue;
          text = SYMBOL[parseInt(code, 16) & 0xff] ?? '';
          break;
        }
        default: continue;
      }
      if (text) pieces[pieces.length - 1].push(R(text, bold, italic, valign, underline));
    }
  };
  const walk = (el: Element): void => {
    for (const child of kids(el)) {
      if (child.namespaceURI === W && SKIP.has(child.localName)) continue;
      if (is(child, W, 'r')) run(child);
      else walk(child);
    }
  };
  walk(p);
  return pieces.map((runs) => mergeRuns(runs)).filter((runs) => runs.length).map((runs) => [runs, level]);
}

/** `el`'s children with `local`, also inside content controls (not in nested tables). */
function* own(el: Element, local: string): Generator<Element> {
  for (const child of kids(el)) {
    if (is(child, W, local)) yield child;
    else if (is(child, W, 'sdt') || is(child, W, 'sdtContent') || is(child, W, 'customXml')) yield* own(child, local);
  }
}

/** A .docx opened: the result so far (with its `error` when it can't be read), the parts of its body, and what reads one of them. */
function openDocx(name: string, bytes: Uint8Array): { res: ReadResult; parts: Element[]; take: (child: Element) => void } {
  const res = newResult(name, 'docx');
  const none = { res, parts: [], take: (): void => {} };
  let z: Record<string, Uint8Array>;
  let doc: Document;
  try {
    try { z = unzipSync(bytes); } catch { const e = new Error('not a zip file'); e.name = 'BadZipFile'; throw e; }
    if (!z['word/document.xml']) { const e = new Error('word/document.xml'); e.name = 'KeyError'; throw e; }
    doc = parseXml(new TextDecoder().decode(z['word/document.xml']));
  } catch (e) {
    res.error = `“${name}” could not be opened as a Word document (${errName(e)}). It may be damaged, or still open and locked: save it again from Word.`;
    return none;
  }
  const styles = styleInfo(z);
  const body = find(doc.documentElement, W, 'body');
  if (!body) { res.error = `“${name}” has no text.`; return none; }
  const rels = new Map<string, string>();
  try {
    const relXml = z['word/_rels/document.xml.rels'];
    if (relXml) for (const r of kids(parseXml(new TextDecoder().decode(relXml)).documentElement)) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  } catch { /* no relationships */ }
  const reader = new DocxReader(z, rels);
  let tables = 0;
  const take = (child: Element, cell: Para['cell'] = null): void => {
    if (is(child, W, 'p')) {
      const objects = reader.objects(child);
      let pieces = docxParagraph(child, styles);
      if (!pieces.length && (objects.length || cell)) pieces = [[[], 0]];   // (only a drawing; or an empty table cell)
      pieces.forEach(([runs, level], i) => {
        res.paras.push(newPara(runs, { heading: level, table: !!cell, objects: i === 0 ? objects : [], cell }));
      });
    } else if (is(child, W, 'tbl')) {
      if (cell) {          // (a table in a table: its cells' text only)
        for (const tc of Array.from(child.getElementsByTagNameNS(W, 'tc'))) walk(tc, cell);
        return;
      }
      tables++;
      let r = 0;
      for (const tr of own(child, 'tr')) {
        let col = 0;
        for (const tc of own(tr, 'tc')) {
          let span = 1, merge = '';
          const tcpr = find(tc, W, 'tcPr');
          if (tcpr) {
            const gs = find(tcpr, W, 'gridSpan');
            const v = gs ? wAttr(gs, 'val') || '1' : '1';
            span = /^\s*[-+]?\d+\s*$/.test(v) ? Math.max(1, parseInt(v, 10)) : 1;
            const vm = find(tcpr, W, 'vMerge');
            if (vm) merge = wAttr(vm, 'val') === 'restart' ? 'restart' : 'continue';
          }
          walk(tc, [tables, r, col, span, merge]);
          col += span;
        }
        r++;
      }
    } else if (['sdt', 'sdtContent', 'customXml', 'ins', 'smartTag'].some((t) => is(child, W, t))) walk(child, cell);
  };
  const walk = (parent: Element, cell: Para['cell']): void => { for (const child of kids(parent)) take(child, cell); };
  return { res, parts: kids(body), take: (child) => take(child) };
}

export function readSiDocx(name: string, bytes: Uint8Array, progress: Progress = null): ReadResult {
  const { res, parts, take } = openDocx(name, bytes);
  if (res.error) return res;
  for (const child of parts) take(child);
  progress?.(1, 1);
  if (!res.paras.length) res.error = `No text was found in “${name}”.`;
  return res;
}

/**
 * readSiDocx in pieces, for a window that must stay alive: after every 40 ms of reading the
 * progress is told (false stops the reading) and the window gets its turn.
 */
export async function readSiDocxSteps(name: string, bytes: Uint8Array, progress: Progress = null): Promise<ReadResult> {
  const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  if (progress && progress(0, 1) === false) { const r = newResult(name, 'docx'); r.stopped = true; return r; }
  await turn();        // (what the caller shows first is drawn before the file is unpacked)
  const { res, parts, take } = openDocx(name, bytes);
  if (res.error) return res;
  let last = Date.now();
  for (let k = 0; k < parts.length; k++) {
    take(parts[k]);
    if (Date.now() - last < 40) continue;
    if (progress && progress(k + 1, parts.length) === false) {
      res.stopped = true;
      res.notes.push('Reading was stopped before the end of the file.');
      break;
    }
    await turn();
    last = Date.now();
  }
  if (!res.stopped) progress?.(parts.length || 1, parts.length || 1);
  if (!res.paras.length && !res.stopped) res.error = `No text was found in “${name}”.`;
  return res;
}

// ---------------------------------------------------------------------- PDF

export interface Line { spans: Span[]; base: number; size: number }

const lx0 = (L: Line): number => Math.min(...L.spans.map((s) => s.x0));
const lx1 = (L: Line): number => Math.max(...L.spans.map((s) => s.x1));

function lineRuns(L: Line): Run[] {
  const out: Run[] = [];
  let prev: Span | null = null;
  for (const s of [...L.spans].sort((a, b) => a.x0 - b.x0)) {
    let valign: VAlign = 'normal';
    if (s.size < 0.85 * L.size) {
      const shift = (s.y1 - 0.2 * s.size) - L.base;      // its baseline vs the line's
      if (shift < -0.08 * L.size) valign = 'super';
      else if (shift > 0.05 * L.size) valign = 'sub';
    }
    let text = s.text.replaceAll('­', '');
    if (valign !== 'normal') text = strip(text);
    if (prev) {
      const gap = s.x0 - prev.x1;
      const joined = prev.text.endsWith(' ') || text.startsWith(' ');
      // (Widths are estimates: next to a sub- or superscript only a clear gap is a space.)
      const scripts = valign !== 'normal' || (out.length > 0 && va(out[out.length - 1]) !== 'normal');
      const need = scripts ? 0.45 * L.size : 0.15 * Math.min(L.size, Math.max(s.size, 1.0));
      if (!joined && gap > need) out.push(R(' '));
    }
    out.push(R(text, !!s.bold, !!s.italic, valign));
    prev = s;
  }
  return out;
}

export const linePlain = (L: Line): string => cleanSpace(lineRuns(L).map((r) => r.text).join(''));
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** The most common key (the first seen on a tie, as Counter.most_common). */
function mostCommon<K>(counts: Map<K, number>): K | undefined {
  let best: K | undefined, n = -Infinity;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

/** Text pieces into lines: pieces whose baselines are within about half a line of each other make one line. */
export function toLines(spans: Span[]): Line[] {
  const lines: Line[] = [];
  const sorted = [...spans].sort((a, b) => (a.y1 - 0.2 * a.size) - (b.y1 - 0.2 * b.size) || a.x0 - b.x0);
  for (const s of sorted) {
    const base = s.y1 - 0.2 * s.size;
    let line: Line | null = null;
    for (const cand of lines.slice(-4).reverse()) {
      if (Math.abs(base - cand.base) < 0.55 * Math.max(cand.size, s.size)) { line = cand; break; }
    }
    if (!line) { lines.push({ spans: [s], base, size: s.size }); continue; }
    line.spans.push(s);
    if (s.size > 1.15 * line.size) { line.base = base; line.size = s.size; }  // a superscript started the line
  }
  for (const line of lines) {   // the main size: the size most of its characters have
    const sizes = new Map<number, number>();
    for (const s of line.spans) sizes.set(r1(s.size), (sizes.get(r1(s.size)) ?? 0) + strip(s.text).length);
    const main = mostCommon(sizes) ?? line.size;
    const mains = line.spans.filter((s) => Math.abs(s.size - main) < 0.3);
    if (mains.length) {
      line.size = main;
      line.base = median(mains.map((s) => s.y1 - 0.2 * s.size));
    }
  }
  lines.sort((a, b) => a.base - b.base);
  return lines;
}

const PAGE_NUMBER = rx('^(?:page\\s*)?S?\\s?-?\\d{1,4}(?:\\s*(?:of|/)\\s*\\d+)?$', 'i');
export const TOP_BAND = 0.12;     // running heads are in the top 12% of a page (bottom: 8%)
const NUMBERISH = /^[-−–+]?\d+(?:[.,]\d+)?$/;
const stripDigits = (text: string): string => text.toLowerCase().replace(/\d+/g, '#');

/** Mostly numbers (an axis and peak labels), with a ppm axis or an NMR header; or hardly any text besides a spectrum's header. */
function isSpectrumPage(lines: Line[]): boolean {
  const words = lines.flatMap((L) => linePlain(L).split(/\s+/).filter(Boolean));
  if (!words.length) return false;
  const numbers = words.filter((w) => NUMBERISH.test(strip(w, '()[],;'))).length;
  const text = lines.map(linePlain).join(' ');
  // (a page with lines of body text is text, whatever it mentions)
  const bodyLines = lines.filter((L) => linePlain(L).length > 90).length;
  const header = search(rx('\\bNMR\\b|\\bHPLC\\b|\\bSFC\\b|chromatogram|\\bIR\\s+spectr|\\bCOSY\\b|\\bHSQC\\b|\\bHMBC\\b|\\bNOESY\\b', 'i'), text);
  if (numbers >= 0.5 * words.length && words.length >= 12 && bodyLines <= 1 && (header || search(rx('\\bppm\\b|\\bf1\\b'), text))) return true;
  return lines.length <= 8 && !!header && bodyLines === 0;
}

export async function readSiPdf(name: string, bytes: Uint8Array, progress: Progress = null): Promise<ReadResult> {
  const res = newResult(name, 'pdf');
  res.data = bytes;
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, fontExtraProperties: true, password: '' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    res.error = errName(e) === 'PasswordException'
      ? `“${name}” is password-protected. Save a copy without a password (e.g. print it to PDF) and import that.`
      : `“${name}” could not be opened as a PDF (${errName(e)}). It may be damaged.`;
    return res;
  }
  const pageLines: [number, number, Line[]][] = [];
  try {
    res.pages = doc.numPages;
    for (let n = 1; n <= doc.numPages; n++) {
      if (progress && progress(n - 1, doc.numPages) === false) {
        res.stopped = true;
        res.notes.push(`Reading was stopped at page ${n} of ${doc.numPages}.`);
        break;
      }
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        try { await page.getOperatorList(); } catch { /* font names unknown: no bold */ }
        const fontOf = (id: string): string => { try { return String(page.commonObjs.get(id)?.name ?? ''); } catch { return ''; } };
        const items = (content.items as { str?: string }[]).filter((i) => 'str' in i) as Parameters<typeof pdfSpans>[0];
        const { frames } = pdfSpans(items, page.view[3], fontOf);
        const height = page.view[3] - page.view[1];
        page.cleanup();
        pageLines.push([n, height, toLines(frames[0] ?? [])]);
      } catch {
        res.notes.push(`Page ${n} could not be read and was left out.`);
      }
    }
    if (progress && !res.stopped) progress(doc.numPages, doc.numPages);
  } finally {
    void task.destroy();
  }
  // Headers and footers: in the top 12% or bottom 8% of a page, a page number or a text (digits
  // aside) that is on at least a quarter of the pages there.
  const edge = new Map<string, number>();
  for (const [, height, lines] of pageLines) {
    for (const L of lines) {
      if (L.base < TOP_BAND * height || L.base > 0.92 * height) { const t = stripDigits(linePlain(L)); edge.set(t, (edge.get(t) ?? 0) + 1); }
    }
  }
  const repeated = new Set([...edge].filter(([, k]) => k >= Math.max(3, pageLines.length / 4)).map(([t]) => t));
  const sizes = new Map<number, number>();
  for (const [, , lines] of pageLines) for (const L of lines) sizes.set(r1(L.size), (sizes.get(r1(L.size)) ?? 0) + linePlain(L).length);
  const bodySize = mostCommon(sizes) ?? 10.0;
  for (const [n, height, lines] of pageLines) {
    const kept: Line[] = [];
    for (const L of lines) {
      const text = linePlain(L);
      if (!text) continue;
      const atEdge = L.base < TOP_BAND * height || L.base > 0.92 * height;
      // (a page number only in the outer 10%: a heading "1." can sit in the band)
      const number = !!search(PAGE_NUMBER, text) && (L.base < 0.1 * height || L.base > 0.92 * height);
      if (atEdge && (number || repeated.has(stripDigits(text)))) continue;
      kept.push(L);
    }
    if (isSpectrumPage(kept)) { res.spectrum_pages.push(n); continue; }
    res.paras.push(...paragraphs(kept, n, bodySize));
  }
  res.paras = joinAcrossPages(res.paras);
  if (!res.paras.length && !res.error) res.error = `No text could be read from “${name}”. If it is a scan (pictures of pages), its text can't be imported.`;
  return res;
}

/**
 * A paragraph cut in two is joined again: by a page break when the first part does not end a
 * sentence and the next page's text goes on in lower case or with a number; on the same page too
 * when the first part plainly stops in the middle (a comma, an opening parenthesis, "J =", a dash).
 */
export function joinAcrossPages(paras: Para[]): Para[] {
  const out: Para[] = [];
  for (const p of paras) {
    if (out.length) {
      const prev = out[out.length - 1];
      const text = paraText(p), prevText = paraText(prev);
      const c0 = text.slice(0, 1);
      const goesOn = isLower(c0) || (c0 !== '' && '0123456789(=,–-'.includes(c0) && !match(rx('\\d+\\.\\s+[A-Z]'), text));
      // (never onto a heading: headings are bold, and may start with a digit)
      const plainText = boldShare(prev) < 0.5 && boldShare(p) < 0.5 && !(prev.columnar || p.columnar);
      const cutShort = !!search(rx('(?:[,(–=-]|\\bJ\\s?=?)$'), prevText) && plainText;
      const across = p.page > prev.page && goesOn && plainText
        && !search(rx('[.!?:;\\]]$'), prevText)
        && !(prevText.endsWith(')') && !isLower(c0) && !(prevText.endsWith('H)') || prevText.endsWith('Hz)')));
      const samePage = p.page === prev.page && cutShort && (goesOn || ['Hz', 'J ', 'J='].includes(text.slice(0, 2)));
      if ((across || samePage || (p.page > prev.page && cutShort)) && Math.abs((prev.size || 0) - (p.size || 0)) < 0.9) {
        const hyphen = prevText.endsWith('-') && isAlnum(prevText.slice(-2, -1));
        const runs = [...prev.runs, ...(hyphen ? [] : [R(' ')]), ...p.runs];
        out[out.length - 1] = newPara(mergeRuns(runs), { page: prev.page, size: prev.size, top: prev.top, bottom: p.bottom, left: prev.left, right: Math.max(prev.right, p.right) });
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** A row of a table: at least three gaps wider than 0.9 em between its pieces. */
function columnar(L: Line): boolean {
  const spans = [...L.spans].sort((a, b) => a.x0 - b.x0);
  const em = L.size;
  const gap = (a: Span, b: Span): number => {
    const lead = (b.text.length - lstrip(b.text).length) * 0.25 * em;
    const trail = (a.text.length - rstrip(a.text).length) * 0.25 * em;
    return (b.x0 + lead) - (a.x1 - trail);
  };
  let wide = 0;
  for (let i = 0; i + 1 < spans.length; i++) if (gap(spans[i], spans[i + 1]) > 0.9 * em) wide++;
  return wide >= 3;
}

function allBold(L: Line): boolean {
  const n = (t: string): number => [...t].filter(isAlnum).length;
  const letters = L.spans.reduce((s, x) => s + n(x.text), 0);
  const bold = L.spans.filter((x) => x.bold).reduce((s, x) => s + n(x.text), 0);
  return letters > 0 && bold >= 0.9 * letters;
}

/**
 * Lines into paragraphs: a new one after a larger gap than usual, at an indented line, after a
 * line that ends well before the right margin, where the text turns bold or stops being bold
 * and where the size changes.
 */
function paragraphs(lines: Line[], page: number, bodySize: number): Para[] {
  if (!lines.length) return [];
  const left = Math.min(...lines.map(lx0));
  const ends = lines.map(lx1).sort((a, b) => a - b);
  const right = ends[Math.trunc(0.75 * (ends.length - 1))];
  const short = left + 0.72 * (right - left);
  const gaps: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) if (lines[i + 1].base > lines[i].base) gaps.push(lines[i + 1].base - lines[i].base);
  const usual = gaps.length ? median(gaps) : 1.2 * bodySize;
  const out: Para[] = [];
  const current: Line[] = [];
  const flush = (): void => {
    if (!current.length) return;
    const runs: Run[] = [];
    current.forEach((L, i) => {
      const lr = lineRuns(L);
      if (i && runs.length) {
        const prev = rstrip(runs[runs.length - 1].text);
        // A line ending in a hyphen (a chemical name broken at its hyphen) is joined without a space.
        if (!(prev.endsWith('-') && prev.length > 1 && isAlnum(prev[prev.length - 2]))) runs.push(R(' '));
      }
      runs.push(...lr);
    });
    out.push(newPara(mergeRuns(runs), {
      page, size: median(current.map((L) => L.size)),
      top: current[0].base - current[0].size, bottom: current[current.length - 1].base + 0.25 * current[current.length - 1].size,
      left: Math.min(...current.map(lx0)), right: Math.max(...current.map(lx1)), columnar: current.every(columnar),
    }));
    current.length = 0;
  };
  for (const L of lines) {
    if (current.length) {
      const prev = current[current.length - 1];
      const gap = L.base - prev.base;
      const fresh = gap > Math.max(1.45 * usual, 1.6 * prev.size)
        || (lx0(L) > left + 1.2 * L.size && lx0(L) > lx0(prev) + 0.8 * L.size)
        || lx1(prev) < short
        || allBold(prev) !== allBold(L)
        || Math.abs(L.size - prev.size) > 0.9
        || columnar(prev) || columnar(L);      // (each table row on its own)
      if (fresh) flush();
    }
    current.push(L);
  }
  flush();
  return out;
}
