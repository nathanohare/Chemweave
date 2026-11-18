// Reading a manuscript's files for the manuscript check (SI Assistant SPEC §13o): PDF, Word
// (.docx, which is also what Chemweave documents are saved as) and ChemDraw (.cdxml). A port of
// Chem SI Assistant's core/ms_read.py.
//
// Each reader gives a `Source`: the compound records found (ID with yield, ee/er, dr, footnote
// markers and the footnotes' text, a structure from ChemDraw), the body text's "name (ID)" pairs,
// every word of the text (to tell whether an ID appears at all) and plain notes about what could
// not be read. Readers never throw for a bad file: the Source's `error` says what went wrong.
//
// Text with positions:
// * PDF: pdf.js's text content (each piece with its matrix and font).
// * Word: the paragraphs and tables of word/document.xml, and the text of pasted ChemDraw figures
//   (Enhanced Metafiles, read with render/emf-read.ts).
// * ChemDraw .cdxml: the structures (read as Chemweave reads CDXML, then RDKit's SMILES) with the
//   text drawn under them.

import { unzipSync } from 'fflate';
import * as P from './ms-parse';
import type { Rec } from './ms-parse';

/** Raised whenever reading changes, so that what an older version read (manuscript/check.json) is read again. */
export const READER_VERSION = 4;

/** Called with a message; return false to stop. */
export type Progress = ((message: string) => boolean | void) | null;

export class Stopped extends Error { override name = 'Stopped'; }

/** What one manuscript file gave. */
export interface Source {
  file: string;
  /** "pdf", "docx", "cdxml" (or "other") */
  kind: string;
  records: Record<string, unknown>[];
  names: { name: string; id: string; where: string }[];
  /** IDs clearly named in the text. */
  mentioned: string[];
  /** Every word, as an ID key. */
  tokens: string[];
  notes: string[];
  error: string;
  /** Labels were found in the figures (PDF/Word). */
  figure_text: boolean;
  pages: number;
  /** Could not be opened just now (offline, locked). */
  transient: boolean;
}

export function newSource(file: string, kind: string, extra: Partial<Source> = {}): Source {
  return { file, kind, records: [], names: [], mentioned: [], tokens: [], notes: [], error: '', figure_text: true, pages: 0, transient: false, ...extra };
}

/** Options: a structure's SMILES (for the structures of a ChemDraw file; RDKit's canonical SMILES) and a progress callback. */
export interface ReadOptions {
  smiles?: (molblock: string) => Promise<string | null>;
  progress?: Progress;
}

const CAPTION = /^(Scheme|Table|Figure|Fig\.|Chart)\s*(S?\d+)\b/i;
const BOLD_FONT = /(bold|black|heavy|semibold|demi|-bd\b|,bold)/i;
const ITALIC_FONT = /(italic|oblique|-it\b|,italic|-bdit\b|-boldit)/i;

const suffix = (name: string): string => { const m = /\.[^./\\]*$/.exec(name); return m ? m[0].toLowerCase() : ''; };
export const errName = (e: unknown): string => (e instanceof Error ? (e.name && e.name !== 'Error' ? e.name : e.constructor?.name || 'Error') : 'Error');

/** Read one file of the manuscript folder (by its extension). `bytes` null: it could not be opened just now. */
export async function readFile(name: string, bytes: Uint8Array | null, opts: ReadOptions = {}): Promise<Source> {
  const ext = suffix(name);
  if (['.pdf', '.docx', '.cdxml'].includes(ext)) {
    if (bytes === null) {
      return newSource(name, ext.slice(1), { transient: true, error: `“${name}” could not be opened just now: it may be an online-only OneDrive file while you are offline, or open in another program. It will be read again at the next check.` });
    }
    try {
      if (ext === '.pdf') return await readPdf(name, bytes, opts.progress ?? null);
      if (ext === '.docx') return readDocx(name, bytes, opts.progress ?? null);
      return await readCdxml(name, bytes, opts.smiles);
    } catch (e) {
      if (e instanceof Stopped) throw e;
      return newSource(name, ext.slice(1), { error: `“${name}” could not be read (${errName(e)}). It may be damaged; try saving it again from the program that made it.` });
    }
  }
  if (ext === '.cdx') return newSource(name, 'other', { error: `“${name}” is a ChemDraw .cdx file, which this program can't read. In ChemDraw, use File ▸ Save As… and choose “CDXML” as the type, then add that file instead.` });
  if (ext === '.doc') return newSource(name, 'other', { error: `“${name}” is an old-style Word file (.doc). Open it in Word and save it as .docx (File ▸ Save As ▸ Word Document), then add that file instead.` });
  return newSource(name, 'other', { error: `“${name}” is not a PDF, Word .docx or ChemDraw .cdxml file, so it was not read.` });
}

function tick(progress: Progress, message: string): void {
  if (progress && progress(message) === false) throw new Stopped();
}

// ---------------------------------------------------------------- shared steps

function placeOf(caption: string, page: number | null, fallback: string): string {
  const parts = [caption, page ? `p. ${page}` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : fallback;
}

/** The caption of the scheme/table/figure a label at height y belongs to: the nearest one above it, else the nearest below. */
function nearestCaption(captions: [number, string][], y: number): string {
  const pick = (list: [number, string][]): string => list.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a))[1];
  const above = captions.filter(([cy]) => cy <= y).map(([cy, t]) => [y - cy, t] as [number, string]);
  if (above.length) return pick(above);
  const below = captions.filter(([cy]) => cy > y).map(([cy, t]) => [cy - y, t] as [number, string]);
  return below.length ? pick(below) : '';
}

/** Put the footnotes' text into the record ("conditions": {marker: text}). */
export function resolveNotes(record: Rec, notes: Record<string, string>): void {
  const markers = [...new Set(record.footnotes ?? [])];
  if (markers.length) {
    record.footnotes = markers;
    record.conditions = Object.fromEntries(markers.filter((m) => notes[m]).map((m) => [m, notes[m]]));
  }
}

const CLEAN_KEYS = ['yield', 'yield_nmr', 'ee', 'er', 'dr', 'ee_from_er', 'conversion', 'alternative_results', 'footnotes', 'conditions', 'smiles', 'entry', 'repeated', 'yield_assumed'];

export function cleanRecord(rec: Rec, where: string, file: string, source: string, confidence: string): Record<string, unknown> {
  const out: Record<string, unknown> = { id: rec.ids[0], file, where, source, confidence, text: Array.from(String(rec.text ?? '')).slice(0, 300).join('') };
  for (const k of CLEAN_KEYS) {
    const v = rec[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

function bodyFeatures(src: Source, text: string, where: string): void {
  for (const [name, label] of P.namesWithIds(text)) src.names.push({ name, id: label, where });
  src.mentioned.push(...P.mentionedIds(text));
}

const HYPHEN_PREFIXES = new Set(['tert', 'sec', 'iso', 'neo', 'cis', 'trans', 'endo', 'exo', 'syn', 'anti', 'meso', 'rac', 'ent', 'rel', 'ortho', 'meta', 'para', 'ipso', 'gem', 'vic', 'erythro', 'threo', 'sn', 'tbu', 'ipr', 'nbu', 'boc', 'cbz', 'fmoc']);
const isUpper = (c: string): boolean => !!c && c !== c.toLowerCase() && c === c.toUpperCase();

/**
 * Join words broken at the end of a line: a chemical name's own hyphen is kept ("2-\nmethyl" →
 * "2-methyl", "tert-\nbutyl", "N-\nmethyl"), a word broken by the typesetter is joined
 * ("4-bromo-\nbenzoate" → "4-bromobenzoate"). What decides is the piece just before the break: a
 * locant (digits, brackets, one letter) or a prefix such as tert-/cis-/ortho- keeps its hyphen; a
 * longer plain syllable does not.
 */
export function dehyphenate(textIn: string): string {
  const text = textIn.replace(/\xad\s*\n\s*/g, '').replace(/\xad/g, '');
  const joined = text.replace(/([\p{L}\p{N}_])-\n(\S)/gu, (_m, before: string, after: string, offset: number) => {
    const word = /\S*$/.exec(text.slice(0, offset + before.length))![0];
    const piece = word.split('-').pop() ?? '';
    const keep = /[\d,()[\]']/.test(piece) || Array.from(piece).length <= 1 || HYPHEN_PREFIXES.has(piece.toLowerCase())
      || /^\d/.test(after) || '(['.includes(after[0]) || isUpper(after[0]);
    return before + (keep ? '-' : '') + after;
  });
  return joined.replace(/\s*\n\s*/g, ' ');
}

// ---------------------------------------------------------------- PDF

interface PdfPiece { str: string; transform: number[]; width: number; fontName?: string; hasEOL?: boolean }

/** A character's width in em, roughly. */
function charWidth(ch: string): number {
  if (" .,:;'|!il1jtfr()[]-".includes(ch)) return 0.3;
  if ('mwMW%@'.includes(ch)) return 0.85;
  if (isUpper(ch)) return 0.65;
  return 0.5;
}

/**
 * A page's text pieces with their boxes (y down), in frames: the upright text first, then text
 * turned by 90°, 180° or 270° (a sideways table, a rotated figure), each turned upright in a frame
 * of its own; its plain text; and how many pieces were set at an angle that could not be read.
 */
export function pdfSpans(items: PdfPiece[], top: number, fontOf: (id: string) => string): { frames: P.Span[][]; plain: string; slanted: number } {
  const frames = new Map<number, P.Span[]>([[0, []]]);
  let slanted = 0, plain = '';
  for (const it of items) {
    plain += it.str + (it.hasEOL ? '\n' : '');
    const text = it.str;
    if (!text || !text.trim()) continue;
    const [a, b, c, d, x, y] = it.transform;
    const det = a * d - b * c;
    const eff = Math.sqrt(Math.abs(det)) || 1;
    if (!(eff > 0.5 && eff < 200)) continue;
    const angle = (Math.atan2(b, a) * 180) / Math.PI;
    const turn = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
    if (Math.abs((((angle - turn + 180) % 360) + 360) % 360 - 180) > 3 || det <= 0) { slanted++; continue; }
    let px: number, py: number;
    if (turn === 0) { px = x; py = top - y; } else {
      const n1 = Math.hypot(a, b) || 1, n2 = Math.hypot(c, d) || 1;
      px = (x * a + y * b) / n1;
      py = -(x * c + y * d) / n2;
    }
    const base = it.fontName ? fontOf(it.fontName) : '';
    const bold = !!base && BOLD_FONT.test(base), italic = !!base && ITALIC_FONT.test(base);
    const part = text.replace(/�C/g, '°C');
    const stripped = part.trim();
    const w = it.width > 0 ? it.width * (stripped.length / Math.max(1, part.length)) : eff * Array.from(stripped).reduce((s, ch) => s + charWidth(ch), 0);
    const lead = part.length - part.trimStart().length;
    const x0 = px + (lead ? 0.25 * eff * lead : 0);
    if (!frames.has(turn)) frames.set(turn, []);
    frames.get(turn)!.push({ text: part, x0, y0: py - 0.75 * eff, x1: x0 + w, y1: py + 0.2 * eff, size: eff, bold, italic });
  }
  const out = [frames.get(0)!, ...[...frames.keys()].filter((k) => k && frames.get(k)!.length).sort((p, q) => p - q).map((k) => frames.get(k)!)];
  return { frames: out, plain: plain.replace(/�C/g, '°C'), slanted };
}

/** Where on the page a sentence's compound is: the bottom of the first line holding its ID (with its footnote marker, if it has one); 0 if none. */
function lineY(lines: P.Line[], rec: Rec): number {
  const label = rec.ids[0];
  const marks = (rec.footnotes ?? []).map((m) => `^${m}`);
  const hits = lines.filter((L) => P.findIds(P.splitFootnotes(L.text)[0]).includes(label));
  const best = hits.filter((L) => marks.some((m) => L.text.includes(m)));
  const pick = best.length ? best : hits;
  return pick.length ? pick[0].bbox[3] : 0;
}

export async function pdfjsLib() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  return pdfjs;
}

export async function readPdf(name: string, bytes: Uint8Array, progress: Progress = null): Promise<Source> {
  const src = newSource(name, 'pdf');
  const pdfjs = await pdfjsLib();
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, fontExtraProperties: true, password: '' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = await task.promise;
  } catch (e) {
    void task.destroy();
    src.error = `“${name}” could not be opened as a PDF (${errName(e)}). It may be damaged or password-protected; save it again from Word or the journal's site and add it again.`;
    return src;
  }
  try {
    src.pages = doc.numPages;
    const tokens = new Set<string>();
    let anyText = false, figureLabels = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      tick(progress, `Reading ${name}: page ${number} of ${doc.numPages}…`);
      let frames: P.Span[][], plain: string, slanted: number;
      try {
        const page = await doc.getPage(number);
        const content = await page.getTextContent();
        // (the fonts' own names, to tell bold IDs, come with the page's drawing operations)
        try { await page.getOperatorList(); } catch { /* names unknown: no bold */ }
        const fontOf = (id: string): string => { try { return String(page.commonObjs.get(id)?.name ?? ''); } catch { return ''; } };
        const items = (content.items as PdfPiece[]).filter((i) => 'str' in i);
        ({ frames, plain, slanted } = pdfSpans(items, page.view[3], fontOf));
        page.cleanup();
      } catch (e) {
        if (e instanceof Stopped) throw e;
        src.notes.push(`Page ${number} of “${name}” could not be read.`);
        continue;
      }
      if (plain.trim()) anyText = true;
      if (slanted) src.notes.push(`Some text on p. ${number} of “${name}” is set at a slant, so it was not read.`);
      let allLines: P.Line[] = [], allEntries: P.FootEntry[] = [];
      frames.forEach((spans, k) => {
        P.markScripts(spans);
        const lines = P.groupLines(spans);
        const captions: [number, string][] = lines.flatMap((L) => { const m = CAPTION.exec(L.text); return m ? [[L.bbox[1], m[0].replace(/[.:]+$/, '')] as [number, string]] : []; });
        const entries = P.footnoteEntries(lines);
        for (const table of P.findTables(lines)) {
          const where = placeOf(nearestCaption(captions, table.bbox[1]), number, `a table on p. ${number}`);
          const notes = P.footnotesFor(entries, table.bbox[3]);
          for (const rec of P.tableRecords(table)) {
            resolveNotes(rec, notes);
            src.records.push(cleanRecord(rec, where, name, 'table', 'high'));
          }
        }
        P.markBody(lines);
        for (const rec of P.labelRecords(lines)) {
          if (/^\d+$/.test(rec.ids[0]) && !P.hasValues(rec)) continue; // a page number, a heading's number…
          if (P.hasValues(rec)) figureLabels++;
          resolveNotes(rec, P.footnotesFor(entries, rec.bbox[3]));
          const where = placeOf(nearestCaption(captions, rec.bbox[1]), number, `p. ${number}`);
          src.records.push(cleanRecord(rec, where, name, 'figure', 'high'));
        }
        if (k === 0) { allLines = lines; allEntries = entries; }
      });
      const body = dehyphenate(plain);
      for (const t of P.allTokens(body)) tokens.add(t);
      bodyFeatures(src, body, `p. ${number}`);
      for (const rec of P.sentenceRecords(body)) {
        // the footnotes of the scheme or table under the sentence's line
        resolveNotes(rec, P.footnotesFor(allEntries, lineY(allLines, rec)));
        src.records.push(cleanRecord(rec, `text, p. ${number}`, name, 'text', 'medium'));
      }
    }
    src.tokens = [...tokens].sort();
    if (!anyText) {
      src.error = `“${name}” has no text that can be read (it is probably a scanned or picture-only PDF), so it could not be checked. Add the Word file or a PDF saved from Word instead.`;
      src.figure_text = false;
    } else if (figureLabels === 0) {
      src.figure_text = false;
      src.notes.push(`“${name}”: no compound labels with yields were found in the figures. Their text is probably outlined or part of a picture, so only the body text and tables could be checked. Add the ChemDraw files (.cdxml) of the schemes to check them.`);
    }
    return src;
  } finally {
    void task.destroy();
  }
}

// ---------------------------------------------------------------- Word (.docx)

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const V = 'urn:schemas-microsoft-com:vml';

const is = (el: Element, ns: string, local: string): boolean => el.namespaceURI === ns && el.localName === local;
const kids = (el: Element): Element[] => Array.from(el.children);
/** el itself and all its descendants, in document order (ElementTree's iter()). */
const iter = (el: Element): Element[] => [el, ...Array.from(el.getElementsByTagName('*'))];
const find = (el: Element | null, ns: string, local: string): Element | null => (el ? kids(el).find((c) => is(c, ns, local)) ?? null : null);
const wAttr = (el: Element, local: string): string | null => el.getAttributeNS(W, local);
const on = (el: Element | null): boolean => !!el && [null, '1', 'true', 'on'].includes(wAttr(el, 'val'));

/** (text with "^a" for superscript footnote letters, bold texts, image relationship IDs) of one w:p. */
function paragraph(p: Element): [string, string[], string[]] {
  const parts: string[] = [], bold: string[] = [], images: string[] = [];
  const all = iter(p);
  for (const el of all) {
    if (is(el, A, 'blip') && el.getAttributeNS(R, 'embed')) images.push(el.getAttributeNS(R, 'embed')!);
    else if (is(el, V, 'imagedata') && el.getAttributeNS(R, 'id')) images.push(el.getAttributeNS(R, 'id')!);
  }
  for (const r of all.filter((e) => is(e, W, 'r'))) {
    const rpr = find(r, W, 'rPr');
    const va = find(rpr, W, 'vertAlign');
    const sup = !!va && wAttr(va, 'val') === 'superscript';
    const isBold = !!rpr && on(find(rpr, W, 'b'));
    let text = '';
    for (const child of kids(r)) {
      if (is(child, W, 't')) text += child.textContent ?? '';
      else if (is(child, W, 'tab') || is(child, W, 'br') || is(child, W, 'cr')) text += ' ';
      else if (is(child, W, 'noBreakHyphen')) text += '-';
    }
    if (!text) continue;
    const letters = sup ? P.markerLetters(text) : [];
    parts.push(letters.length ? letters.map((x) => `^${x}`).join('') : text);
    if (isBold && text.trim()) bold.push(text.trim());
  }
  return [parts.join('').replace(/[ \t]+/g, ' ').trim(), bold, images];
}

const cellText = (tc: Element): string => iter(tc).filter((e) => is(e, W, 'p')).map((p) => paragraph(p)[0]).filter(Boolean).join(' ').trim();

/** Direct children with this tag, also those inside content controls. */
function children(parent: Element, local: string): Element[] {
  const out: Element[] = [];
  for (const child of kids(parent)) {
    if (is(child, W, local)) out.push(child);
    else if (is(child, W, 'sdt') || is(child, W, 'sdtContent') || is(child, W, 'customXml')) out.push(...children(child, local));
  }
  return out;
}

function gridSpan(tc: Element): number {
  const g = find(find(tc, W, 'tcPr'), W, 'gridSpan');
  if (!g) return 1;
  const n = Number(wAttr(g, 'val'));
  return Number.isInteger(n) ? Math.max(1, n) : 1;
}

/** Is this cell merged with the one above it (w:vMerge without "restart")? */
function mergedAbove(tc: Element): boolean {
  const v = find(find(tc, W, 'tcPr'), W, 'vMerge');
  return !!v && wAttr(v, 'val') !== 'restart';
}

/** A Word table's text on its grid of columns (a cell spanning columns gives its text to the first; one merged with the cell above repeats its text). */
function tableGrid(tbl: Element): string[][] {
  const grid: string[][] = [];
  for (const tr of children(tbl, 'tr')) {
    const row: string[] = [];
    for (const tc of children(tr, 'tc')) {
      const col = row.length;
      let text = cellText(tc);
      if (mergedAbove(tc) && grid.length && col < grid[grid.length - 1].length) text = grid[grid.length - 1][col];
      row.push(text);
      for (let k = 1; k < gridSpan(tc); k++) row.push('');
    }
    grid.push(row);
  }
  return grid;
}

/** The paragraphs of rows that are one cell across the table (where a table's own footnotes often are). */
function tableNoteCells(tbl: Element): string[][] {
  const out: string[][] = [];
  for (const tr of children(tbl, 'tr')) {
    const cells = children(tr, 'tc');
    const filled = cells.filter((tc) => cellText(tc));
    if (filled.length === 1 && (cells.length === 1 || gridSpan(filled[0]) > 1)) {
      out.push(iter(filled[0]).filter((e) => is(e, W, 'p')).map((p) => paragraph(p)[0]).filter(Boolean));
    }
  }
  return out;
}

/** A Word table as findTables() would give it: the first row with a results column (Entry / Yield / ee…) is the header; header rows above it are joined to its titles. */
export function wordTable(rows: string[][]): P.Table | null {
  for (let h = 0; h < Math.min(4, rows.length); h++) {
    const header = rows[h];
    const fields = header.map((c) => P.headerField(c));
    if (!(fields.some((f) => ['yield', 'ee', 'er', 'dr'].includes(f)) && fields.some((f) => ['product_id', 'entry', 'substrate_id'].includes(f)))) continue;
    const titles = [...header];
    for (const above of rows.slice(0, h)) {
      if (new Set(above.filter((c) => c.trim())).size < 2) continue; // a title row across the table
      for (let k = 0; k < Math.min(above.length, titles.length); k++) {
        const extra = above[k].trim();
        if (extra && !titles[k].includes(extra)) titles[k] = titles[k] ? `${titles[k]} ${extra}`.trim() : extra;
      }
    }
    const outRows: P.TableRow[] = [];
    for (const row of rows.slice(h + 1)) {
      if (!row.some((c) => c.trim())) continue;
      const cells: Record<string, string> = {};
      for (let k = 0; k < Math.min(titles.length, row.length); k++) if (row[k].trim() && titles[k].trim()) cells[titles[k]] = row[k];
      outRows.push({ cells, fields: P.rowFields(cells), bbox: [] as unknown as P.TableRow['bbox'] });
    }
    return { columns: titles, rows: outRows, bbox: [] as unknown as P.Table['bbox'] };
  }
  return null;
}

/** A Word paragraph as a "line" for the footnote reader. */
const fakeLine = (text: string): P.Line => ({ text, bbox: [0, 0, 1, 1], size: 10, bold_parts: [], starts_with_marker: text.startsWith('^') });

/** The zip name of a relationship target of word/document.xml: relative to word/ ("media/image1.emf") or absolute ("/word/media/image1.emf"). */
export function partName(targetIn: string): string {
  const target = targetIn.replace(/\\/g, '/');
  const name = target.startsWith('/') ? target.replace(/^\/+/, '') : `word/${target}`;
  const out: string[] = [];
  for (const part of name.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..'); } else out.push(part);
  }
  return out.join('/') || '.';
}

type WBlock = { kind: 'p'; text: string; bold: string[]; images: string[] } | { kind: 'tbl'; el: Element };

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) { const e = new Error('not well-formed'); e.name = 'ParseError'; throw e; }
  return doc;
}

export function readDocx(name: string, bytes: Uint8Array, progress: Progress = null): Source {
  const src = newSource(name, 'docx');
  let z: Record<string, Uint8Array>;
  let doc: Document;
  const dec = new TextDecoder();
  try {
    try { z = unzipSync(bytes); } catch { const e = new Error('not a zip file'); e.name = 'BadZipFile'; throw e; }
    if (!z['word/document.xml']) { const e = new Error('word/document.xml'); e.name = 'KeyError'; throw e; }
    doc = parseXml(dec.decode(z['word/document.xml']));
  } catch (e) {
    src.error = `“${name}” could not be opened as a Word document (${errName(e)}). It may be damaged; save it again from Word.`;
    return src;
  }
  const rels = new Map<string, string>();
  try {
    const relXml = z['word/_rels/document.xml.rels'];
    if (relXml) for (const r of kids(parseXml(dec.decode(relXml)).documentElement)) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  } catch { /* no relationships */ }
  const body = find(doc.documentElement, W, 'body');
  if (!body) { src.error = `“${name}” has no text.`; return src; }
  // The document in order: paragraphs and tables.
  const blocks: WBlock[] = [];
  const walk = (parent: Element): void => {
    for (const child of kids(parent)) {
      if (is(child, W, 'p')) { const [text, bold, images] = paragraph(child); blocks.push({ kind: 'p', text, bold, images }); } else if (is(child, W, 'tbl')) blocks.push({ kind: 'tbl', el: child });
      else if (is(child, W, 'sdt') || is(child, W, 'sdtContent') || is(child, W, 'customXml')) walk(child);
    }
  };
  walk(body);
  // Footnotes (paragraphs starting with a marker, and a table's own last rows), in document order.
  // A plain letter ("a Isolated yield.") only counts right after a table, a figure, a caption or
  // another footnote: body text can start "a Lewis acid…".
  const footAt: [number, string, string][] = [];
  const noteBlocks = new Set<number>();
  blocks.forEach((b, i) => {
    if (b.kind === 'tbl') {
      for (const paras of tableNoteCells(b.el)) for (const text of paras) for (const [marker, note] of Object.entries(P.footnoteLines([fakeLine(text)], true))) footAt.push([i, marker, note]);
    } else if (b.text) {
      let j: number | null = null;
      for (let k = i - 1; k >= 0; k--) { const x = blocks[k]; if (x.kind === 'tbl' || x.text || x.images.length) { j = k; break; } }
      const prev = j !== null ? blocks[j] : null;
      const plain = prev !== null && (prev.kind === 'tbl' || prev.images.length > 0 || CAPTION.test(prev.text) || noteBlocks.has(j!));
      const found = P.footnoteLines([fakeLine(b.text)], plain);
      for (const [marker, text] of Object.entries(found)) footAt.push([i, marker, text]);
      if (Object.keys(found).length) noteBlocks.add(i);
    }
  });
  /** Footnotes that apply at block `index`: the first of each marker after it, else the nearest before. */
  const notesFor = (index: number): Record<string, string> => {
    const out: Record<string, string> = {};
    const sorted = [...footAt].sort((a, b) => Number(a[0] < index) - Number(b[0] < index) || Math.abs(a[0] - index) - Math.abs(b[0] - index));
    for (const [, marker, text] of sorted) if (!(marker in out)) out[marker] = text;
    return out;
  };
  const captionNear = (index: number, kind = ''): string => {
    const order: number[] = [];
    for (let j = index - 1; j > Math.max(-1, index - 4); j--) order.push(j);
    for (let j = index + 1; j < Math.min(blocks.length, index + 4); j++) order.push(j);
    for (const j of order) {
      const b = blocks[j];
      if (b.kind !== 'p') continue;
      const m = CAPTION.exec(b.text);
      if (m && (!kind || m[1].toLowerCase().startsWith(kind))) return m[0];
    }
    return '';
  };
  const tokens = new Set<string>();
  let figures = 0, emfFigures = 0, emfWithLabels = 0, tableNo = 0, paragraphNo = 0;
  blocks.forEach((b, i) => {
    if (b.kind === 'tbl') {
      tableNo++;
      const rows = tableGrid(b.el);
      for (const row of rows) for (const t of P.allTokens(row.join(' '))) tokens.add(t);
      const table = wordTable(rows);
      if (!table) return;
      const where = captionNear(i, 'table') || `table ${tableNo}`;
      for (const rec of P.tableRecords(table)) {
        resolveNotes(rec, notesFor(i));
        src.records.push(cleanRecord(rec, where, name, 'table', 'high'));
      }
      return;
    }
    if (b.text) {
      paragraphNo++;
      for (const t of P.allTokens(b.text)) tokens.add(t);
      if (!noteBlocks.has(i)) {
        const where = `paragraph ${paragraphNo}`;
        bodyFeatures(src, b.text, where);
        for (const rec of P.sentenceRecords(b.text)) {
          resolveNotes(rec, notesFor(i));
          src.records.push(cleanRecord(rec, where, name, 'text', 'medium'));
        }
      }
    }
    for (const rid of b.images) {
      const target = rels.get(rid) ?? '';
      if (!target) continue;
      figures++;
      tick(progress, `Reading ${name}: figure ${figures}…`);
      const part = partName(target);
      const where = captionNear(i) || `figure ${figures}`;
      if (suffix(target.split('/').pop() ?? '') !== '.emf') continue;
      emfFigures++;
      const data = z[part];
      if (!data) continue;
      const spans = emfSpans(data);
      for (const t of P.allTokens(spans.map((s) => s.text).join(' '))) tokens.add(t);
      P.markScripts(spans);
      const lines = P.groupLines(spans);
      const entries = P.footnoteEntries(lines);
      let found = 0;
      for (const rec of P.labelRecords(lines)) {
        if (/^\d+$/.test(rec.ids[0]) && !P.hasValues(rec)) continue;
        resolveNotes(rec, { ...notesFor(i), ...P.footnotesFor(entries, rec.bbox[3]) });
        src.records.push(cleanRecord(rec, where, name, 'figure', 'high'));
        found += Number(P.hasValues(rec));
      }
      if (found > 0) emfWithLabels++;
    }
  });
  src.tokens = [...tokens].sort();
  if (figures && !emfWithLabels) {
    src.figure_text = false;
    src.notes.push(`“${name}”: no compound labels with yields were found in its figures ${emfFigures ? '(pasted figures whose text could not be read)' : '(they are pictures, whose text can\'t be read)'}, so only the text and tables could be checked. Add the ChemDraw files (.cdxml) of the schemes to check them.`);
  }
  return src;
}

/**
 * The text in an Enhanced Metafile (a figure pasted from ChemDraw into Word) with positions, in
 * points, y down: read through the program's EMF reader, whose SVG keeps each piece of text with
 * its place.
 */
export function emfSpans(data: Uint8Array): P.Span[] {
  // (loaded lazily: the EMF reader is only needed for Word files with pasted figures)
  const conv = emfReader?.(data);
  if (!conv) return [];
  const svg = conv.svg;
  const head = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
  const width = parseFloat(/\bwidth="([\d.]+)pt"/.exec(head)?.[1] ?? '');
  const vb = (/\bviewBox="([^"]+)"/.exec(head)?.[1] ?? '').split(/\s+/).map(Number);
  const pt = width > 0 && vb[2] > 0 ? width / vb[2] : 1;
  const spans: P.Span[] = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if (!text.trim()) continue;
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
    const tr = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)/.exec(attrs.transform ?? '');
    if (tr) { e = Number(tr[1]); f = Number(tr[2]); }
    const rot = /rotate\(([-\d.e]+)\)/.exec(attrs.transform ?? '');
    if (rot) { const t = (Number(rot[1]) * Math.PI) / 180; a = Math.cos(t); b = Math.sin(t); c = -Math.sin(t); d = Math.cos(t); }
    const xs = (attrs.x ?? '0').trim().split(/\s+/).map(Number);
    const y = Number(attrs.y ?? '0'), em = Number(attrs['font-size'] ?? '10');
    if (xs.some((v) => !Number.isFinite(v)) || !Number.isFinite(y) || !Number.isFinite(em)) continue;
    const x0 = a * xs[0] + c * y + e, y0 = b * xs[0] + d * y + f;
    const last = xs.length > 1 ? xs[xs.length - 1] + 0.55 * em : xs[0] + 0.55 * em * Array.from(text).length;
    const x1 = a * last + c * y + e;
    const size = em * pt;
    spans.push({ text, x0: x0 * pt, y0: y0 * pt - 0.75 * size, x1: x1 * pt, y1: y0 * pt + 0.2 * size, size, bold: attrs['font-weight'] === 'bold' });
  }
  return spans;
}

/** The EMF → SVG converter (set by loadEmfReader before a Word file is read). */
let emfReader: ((data: Uint8Array) => { svg: string } | null) | null = null;
export async function loadEmfReader(): Promise<void> {
  if (emfReader) return;
  const { emfToSvg } = await import('../render/emf-read');
  emfReader = emfToSvg;
}

// ---------------------------------------------------------------- ChemDraw (.cdxml)

// Files nested this deeply (damaged, or made so on purpose) are not read for structures.
export const MAX_CDXML_DEPTH = 400;
export const MAX_CDXML_BYTES = 50_000_000;

type Box = [number, number, number, number];
interface CdBlock extends P.Block { rows: string[]; bold: string[]; footnote?: boolean }

export async function readCdxml(name: string, bytes: Uint8Array, toSmiles?: (molblock: string) => Promise<string | null>): Promise<Source> {
  const src = newSource(name, 'cdxml');
  let root: Element;
  const text = new TextDecoder().decode(bytes);
  try {
    root = parseXml(text.replace(/<!DOCTYPE[^>]*>/i, '')).documentElement;
  } catch (e) {
    src.error = `“${name}” could not be read as a ChemDraw .cdxml file (${errName(e)}). Save it again from ChemDraw (File ▸ Save As ▸ CDXML).`;
    return src;
  }
  const all = iter(root);
  const bbox = (el: Element): Box | null => {
    const v = (el.getAttribute('BoundingBox') ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
    if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) return null;
    return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
  };
  const insideNode = (el: Element): boolean => { for (let q = el.parentElement; q; q = q.parentElement) if (q.tagName === 'n') return true; return false; };
  const frags: { id: string; box: Box; el: Element }[] = [];
  for (const f of all.filter((e) => e.tagName === 'fragment')) {
    if (insideNode(f)) continue; // an abbreviation's expansion (Bn, Ts…) inside an atom
    let b = bbox(f);
    const nodes = kids(f).filter((c) => c.tagName === 'n');
    if (!b) {
      const pts = nodes.map((n) => (n.getAttribute('p') ?? '').trim().split(/\s+/).slice(0, 2).map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (pts.length) b = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    }
    if (b && nodes.length) frags.push({ id: String(f.getAttribute('id')), box: b, el: f });
  }
  const blocks: CdBlock[] = [];
  const linesAll: (P.Line & { block: CdBlock })[] = [];
  for (const t of all.filter((e) => e.tagName === 't')) {
    if (insideNode(t)) continue; // atom labels (N, Me, OMe…)
    const b = bbox(t);
    if (!b) continue;
    const [txt, bold] = cdxmlText(t);
    const rows = txt.split('\n').map((r) => r.trim()).filter(Boolean);
    if (!rows.length) continue;
    const blk: CdBlock = { text: rows.join(' / '), rows, bbox: b, bold };
    const h = (b[3] - b[1]) / rows.length;
    rows.forEach((row, k) => linesAll.push({ text: row, bbox: [b[0], b[1] + k * h, b[2], b[1] + (k + 1) * h], size: Math.max(h, 1), bold_parts: [], starts_with_marker: row.startsWith('^'), block: blk }));
    blocks.push(blk);
  }
  const entries = P.footnoteEntries(linesAll, true); // (a scheme file has no body text)
  for (const line of linesAll) if (line.footnote) line.block.footnote = true;
  const labelBlocks = blocks.filter((b) => !b.footnote);
  const tokens = new Set<string>();
  for (const blk of blocks) for (const t of P.allTokens(blk.text)) tokens.add(t);
  const smiles = await cdxmlSmiles(name, bytes.length, src, root, frags, toSmiles);
  const assigned = P.assignToStructures(frags.map((f) => f.box), labelBlocks, cdxmlArrows(all, bbox)) as CdBlock[][];
  const used = new Set<CdBlock>();
  frags.forEach((f, i) => {
    const blks = assigned[i];
    if (!blks.length) return;
    const rows = blks.flatMap((b) => b.rows);
    const under = blks.filter((b) => !b.fallback);
    const bold = (under.length ? under : blks).flatMap((b) => b.bold.flatMap((p) => P.findIds(p)));
    const rec = P.mergeBlocks(rows, bold);
    for (const b of blks) used.add(b);
    if (!rec.ids.length) return;
    if (smiles.has(f.id)) rec.smiles = smiles.get(f.id);
    // the footnotes of this scheme: the nearest of each marker below the label
    const bottom = Math.max(...blks.map((b) => b.bbox[3]), f.box[3]);
    resolveNotes(rec, P.footnotesFor(entries, bottom));
    src.records.push(cleanRecord(rec, name, name, 'cdxml', 'exact'));
  });
  // Labels with values that sit under no structure (drawn as a picture, or far away).
  for (const blk of labelBlocks) {
    if (used.has(blk)) continue;
    const rec = P.mergeBlocks(blk.rows, blk.bold.flatMap((p) => P.findIds(p)));
    if (rec.ids.length && P.hasValues(rec) && blk.text.split(/\s+/).filter(Boolean).length <= 10) {
      resolveNotes(rec, P.footnotesFor(entries, blk.bbox[3]));
      src.records.push(cleanRecord(rec, name, name, 'cdxml', 'high'));
    }
  }
  src.tokens = [...tokens].sort();
  if (!frags.length) src.notes.push(`“${name}”: no structures were found in this ChemDraw file.`);
  return src;
}

/**
 * A text object's text, with superscript footnote letters as "^a", and its bold runs. (ChemDraw
 * "face": 1 bold, 0x20 subscript, 0x40 superscript, 0x60 formula.) ChemDraw's LineStarts count
 * characters of the text as stored, so the line breaks are placed before any letter becomes "^a".
 */
export function cdxmlText(t: Element): [string, string[]] {
  const runs: [string, string | null][] = [];
  const bold: string[] = [];
  for (const s of iter(t).filter((e) => e.tagName === 's')) {
    const text = s.textContent ?? '';
    const face = Number(s.getAttribute('face') || 0) || 0;
    const sup = (face & 0x60) === 0x40;
    const letters = sup ? P.markerLetters(text) : [];
    runs.push([text, letters.length ? letters.map((x) => `^${x}`).join('') : null]);
    if (face & 1 && text.trim()) bold.push(text.trim());
  }
  const raw = runs.map((r) => r[0]).join('');
  let cuts: number[] = [];
  const starts = t.getAttribute('LineStarts');
  if (starts && !raw.includes('\n') && !raw.includes('\r')) {
    const vals = starts.trim().split(/\s+/).map(Number);
    cuts = vals.every(Number.isInteger) ? [...new Set(vals.filter((v) => v > 0 && v < raw.length))].sort((a, b) => a - b) : [];
  }
  const parts: string[] = [];
  let offset = 0;
  for (const [text, marker] of runs) {
    const inside = cuts.filter((c) => offset <= c && c < offset + text.length).map((c) => c - offset);
    if (marker !== null) parts.push((inside.length ? '\n' : '') + marker);
    else {
      let last = 0;
      for (const c of inside) { parts.push(text.slice(last, c) + '\n'); last = c; }
      parts.push(text.slice(last));
    }
    offset += text.length;
  }
  return [parts.join('').replace(/\r/g, '\n'), bold];
}

/** The reaction arrows' lines [x0, y0, x1, y1]: <arrow> objects (Tail3D → Head3D, else their box) and older arrow-headed <graphic> lines. */
function cdxmlArrows(all: Element[], bbox: (el: Element) => Box | null): number[][] {
  const out: number[][] = [];
  for (const el of all) {
    if (el.tagName === 'arrow') {
      const head = (el.getAttribute('Head3D') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(Number);
      const tail = (el.getAttribute('Tail3D') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(Number);
      if (head.length === 2 && tail.length === 2 && [...head, ...tail].every(Number.isFinite)) { out.push([...tail, ...head]); continue; }
    } else if (!(el.tagName === 'graphic' && el.getAttribute('GraphicType') === 'Line' && !['', 'NoHead'].includes(el.getAttribute('ArrowType') ?? ''))) continue;
    const b = bbox(el);
    if (b) out.push(b);
  }
  return out;
}

function depthOf(root: Element): number {
  let deepest = 0;
  const stack: [Element, number][] = [[root, 1]];
  while (stack.length) {
    const [el, d] = stack.pop()!;
    deepest = Math.max(deepest, d);
    for (const c of kids(el)) stack.push([c, d + 1]);
  }
  return deepest;
}

/** Each fragment's structure, read as Chemweave reads CDXML: {fragment id: SMILES} (RDKit's canonical SMILES). */
async function cdxmlSmiles(name: string, size: number, src: Source, root: Element, frags: { id: string; el: Element }[], toSmiles?: (molblock: string) => Promise<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const depth = depthOf(root);
  if (depth > MAX_CDXML_DEPTH || size > MAX_CDXML_BYTES) {
    src.notes.push(`“${name}”: the structures were not read, because the file is ${depth > MAX_CDXML_DEPTH ? 'nested unusually deeply' : 'unusually large'} (labels and values were still read). Save it again from ChemDraw if it should hold structures.`);
    return out;
  }
  if (!toSmiles || !cdxmlMol) return out;
  const ser = new XMLSerializer();
  for (const f of frags) {
    try {
      const molblock = cdxmlMol(`<?xml version="1.0" encoding="UTF-8" ?><CDXML><page id="1">${ser.serializeToString(f.el)}</page></CDXML>`);
      if (!molblock) continue;
      const smi = await toSmiles(molblock);
      if (smi) out.set(f.id, smi);
    } catch { /* this structure can't be read: labels and values still are */ }
  }
  return out;
}

/** CDXML (one fragment) → molfile, with Chemweave's own CDXML reader (set by loadCdxmlReader). */
let cdxmlMol: ((cdxml: string) => string | null) | null = null;
export async function loadCdxmlReader(): Promise<void> {
  if (cdxmlMol) return;
  const [{ readCdxml: read }, { toMolfile }] = await Promise.all([import('../io/cdxml'), import('../chem/molfile')]);
  cdxmlMol = (cdxml) => {
    const { doc } = read(cdxml);
    if (!doc.atoms.size) return null;
    const m = toMolfile(doc, doc.atoms.keys());
    return m.unknownLabels.length ? null : m.molblock;
  };
}

/** CDXML → molfile (null when it holds no structure, or an atom label that isn't an element); after loadCdxmlReader. */
export function cdxmlMolfile(cdxml: string): string | null {
  try { return cdxmlMol ? cdxmlMol(cdxml) : null; } catch { return null; }
}

/** Load what the readers need (the EMF and CDXML readers) before reading. */
export async function prepareReaders(): Promise<void> {
  await Promise.all([loadEmfReader(), loadCdxmlReader()]);
}
