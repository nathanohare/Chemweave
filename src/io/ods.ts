// OpenDocument spreadsheets (.ods: LibreOffice Calc, Google Sheets, Numbers' exports), read
// from the zip's content.xml as the OpenDocument 1.3 standard (OASIS) lays it out. Cells,
// values, formulas (OpenFormula, turned into Excel's way of writing them), merged cells, column
// widths, row heights, and bold, italic, colours and alignment are read. Files are only read:
// saving writes .xlsx.

import { strFromU8 } from 'fflate';
import { Workbook, CellStyle } from '../sheet/workbook';
import { quoteSheet, Range, MAX_COLS, MAX_ROWS } from '../sheet/refs';
import { normalizeFormula } from '../sheet/formula';
import { dateSerial } from '../sheet/dates';
import { kids, kid, unzipPackage, ZipTooBigError } from './ooxml';
import { textInput } from './xlsx';
import { safeSheetName } from './sheet-files';

const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';

export { isOds } from './sheet-sniff';

/** A length in an OpenDocument file ("2.258cm", "0.1665in", "12pt") in pixels (96 to the inch). */
export function lengthPx(v: string | null): number | null {
  const m = /^([\d.]+)(cm|mm|in|pt|pc|px)$/.exec(v ?? '');
  if (!m) return null;
  const n = Number(m[1]);
  const perInch = { cm: 2.54, mm: 25.4, in: 1, pt: 72, pc: 6, px: 96 }[m[2] as 'cm']!;
  return Math.round((n / perInch) * 96);
}

/**
 * An OpenFormula ("of:=SUM([.A1:.B3]; [Sheet2.$C$1])") as Excel writes it
 * ("=SUM(A1:B3,Sheet2!$C$1)"): references out of their brackets, ; between arguments.
 */
export function excelFromOpenFormula(f: string): string {
  let text = f.replace(/^(of|oooc|msoxl):/i, '');
  if (!text.startsWith('=')) text = '=' + text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // text in quotes is copied as it is ("" is a quote inside)
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '[') {
      const end = text.indexOf(']', i);
      if (end < 0) { out += text.slice(i); break; }
      out += refFromOpen(text.slice(i + 1, end));
      i = end;
    } else if (ch === ';') out += ',';
    else out += ch;
  }
  // functions under another program's name, and names LibreOffice gives Excel's newer ones
  out = out.replace(/\b(?:COM\.MICROSOFT|ORG\.OPENOFFICE|ORG\.LIBREOFFICE|_xlfn)\.([A-Z][A-Z0-9.]*)\s*\(/gi, '$1(');
  // OpenFormula writes TRUE and FALSE as functions
  return outsideQuotes(out, (t) => t.replace(/\b(TRUE|FALSE)\(\)/gi, (_, b: string) => b.toUpperCase()));
}

/** A formula with `fn` applied to the parts outside text in quotes. */
function outsideQuotes(f: string, fn: (t: string) => string): string {
  return f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : fn(part))).join('');
}

/** One bracketed reference ("$Sheet2.$A$1:.B3", ".A1", "'My data'.C4") as Excel's ("Sheet2!$A$1:B3"). */
function refFromOpen(ref: string): string {
  const parts = splitRef(ref);
  let sheet = '';
  const cells = parts.map((p) => {
    const dot = lastDot(p);
    const s = dot > 0 ? p.slice(0, dot).replace(/^\$/, '') : '';
    if (s && !sheet) sheet = s.startsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
    return p.slice(dot + 1);
  });
  return (sheet ? `${quoteSheet(sheet)}!` : '') + cells.join(':');
}

/** The parts of a range either side of its colon (not one inside a quoted sheet name). */
function splitRef(ref: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (const ch of ref) {
    if (ch === "'") q = !q;
    if (ch === ':' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Where a reference's sheet name ends (the dot outside quotes), or -1. */
function lastDot(p: string): number {
  let q = false, at = -1;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "'") q = !q;
    else if (p[i] === '.' && !q) at = i;
  }
  return at;
}

/** A date or date and time ("2024-03-01", "2024-03-01T13:30:00") as a day number. */
function dateValue(v: string): number | null {
  const m = /^(-?\d{4,})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d):(\d\d(?:\.\d+)?))?/.exec(v);
  if (!m) return null;
  const day = dateSerial(Number(m[1]), Number(m[2]), Number(m[3]));
  if (day === null) return null;
  return day + (m[4] ? (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6])) / 86400 : 0);
}

/** A duration ("PT13H30M00S") as a fraction of a day. */
function timeValue(v: string): number | null {
  const m = /^-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1] ?? 0) + (Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)) / 86400;
  return v.startsWith('-') ? -n : n;
}

/** A cell's text: its paragraphs on lines of their own, spaces and tabs as written. */
function cellText(cell: Element): string {
  return kids(cell, 'p').map(paraText).join('\n');
}

function paraText(el: Element): string {
  let s = '';
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) s += n.nodeValue ?? '';
    else if (n.nodeType === 1) {
      const e = n as Element;
      if (e.localName === 's') s += ' '.repeat(Number(e.getAttributeNS(e.namespaceURI, 'c') ?? e.getAttribute('text:c') ?? 1) || 1);
      else if (e.localName === 'tab') s += '\t';
      else if (e.localName === 'line-break') s += '\n';
      else if (e.localName !== 'annotation') s += paraText(e);
    }
  }
  return s;
}

interface Styles {
  cells: Map<string, CellStyle>;
  colWidths: Map<string, number>;
  rowHeights: Map<string, number>;
}

/**
 * The automatic styles a content.xml (and styles.xml) defines: cell looks, column widths, row heights.
 * A cell style is laid over its parent's (style:parent-style-name, OpenDocument 1.3 Part 3, 16.2:
 * LibreOffice saves ce1, ce2... with only what differs from a named style such as Heading 1 or Accent).
 */
function readStyles(docs: (Document | null)[]): Styles {
  const out: Styles = { cells: new Map(), colWidths: new Map(), rowHeights: new Map() };
  // each cell style's own settings (false or null: set off here, over the parent's) and its parent
  const own = new Map<string, { s: Record<string, unknown>; parent: string | null }>();
  for (const doc of docs) {
    if (!doc) continue;
    for (const st of Array.from(doc.getElementsByTagNameNS(STYLE, 'style'))) {
      const name = st.getAttributeNS(STYLE, 'name');
      if (!name) continue;
      const family = st.getAttributeNS(STYLE, 'family');
      if (family === 'table-column') {
        const w = lengthPx(kid(st, 'table-column-properties')?.getAttributeNS(STYLE, 'column-width') ?? null);
        if (w !== null) out.colWidths.set(name, w);
      } else if (family === 'table-row') {
        const p = kid(st, 'table-row-properties');
        const h = lengthPx(p?.getAttributeNS(STYLE, 'row-height') ?? null);
        if (h !== null && p?.getAttributeNS(STYLE, 'use-optimal-row-height') === 'false') out.rowHeights.set(name, h);
      } else if (family === 'table-cell') {
        const s: Record<string, unknown> = {};
        const t = kid(st, 'text-properties');
        const fw = t?.getAttributeNS(FO, 'font-weight');
        if (fw === 'bold') s.bold = true; else if (fw === 'normal') s.bold = false;
        const fs = t?.getAttributeNS(FO, 'font-style');
        if (fs === 'italic') s.italic = true; else if (fs === 'normal') s.italic = false;
        const ul = t?.getAttributeNS(STYLE, 'text-underline-style');
        if (ul) s.underline = ul !== 'none';
        const col = t?.getAttributeNS(FO, 'color');
        if (col && /^#[0-9a-f]{6}$/i.test(col)) s.color = col.toLowerCase() !== '#000000' ? col.toLowerCase() : null;
        const c = kid(st, 'table-cell-properties');
        const bg = c?.getAttributeNS(FO, 'background-color');
        if (bg && /^#[0-9a-f]{6}$/i.test(bg)) s.fill = bg.toLowerCase(); else if (bg === 'transparent') s.fill = null;
        const wo = c?.getAttributeNS(FO, 'wrap-option');
        if (wo === 'wrap') s.wrap = true; else if (wo === 'no-wrap') s.wrap = false;
        const va = c?.getAttributeNS(STYLE, 'vertical-align');
        if (va === 'top' || va === 'bottom') s.valign = va; else if (va === 'middle') s.valign = 'middle';
        const al = kid(st, 'paragraph-properties')?.getAttributeNS(FO, 'text-align');
        if (al === 'center') s.align = 'center'; else if (al === 'end' || al === 'right') s.align = 'right'; else if (al === 'start' || al === 'left') s.align = 'left';
        own.set(name, { s, parent: st.getAttributeNS(STYLE, 'parent-style-name') || null });
      }
    }
  }
  // the parent's settings first, then the style's own (a loop of parents is cut where it repeats)
  const resolved = (name: string, seen: Set<string>): Record<string, unknown> => {
    const o = own.get(name);
    if (!o || seen.has(name)) return {};
    seen.add(name);
    return { ...(o.parent ? resolved(o.parent, seen) : {}), ...o.s };
  };
  for (const name of own.keys()) {
    const all = resolved(name, new Set());
    const s: CellStyle = {};
    for (const [k, v] of Object.entries(all)) if (v !== false && v !== null) (s as Record<string, unknown>)[k] = v;
    out.cells.set(name, s);
  }
  return out;
}

/** The rows of a table, inside groups and header rows as well. */
function rowsOf(table: Element): Element[] {
  const out: Element[] = [];
  for (const k of kids(table)) {
    if (k.localName === 'table-row') out.push(k);
    else if (k.localName === 'table-header-rows' || k.localName === 'table-row-group' || k.localName === 'table-rows') for (const r of rowsOf(k)) out.push(r);
  }
  return out;
}

function columnsOf(table: Element): Element[] {
  const out: Element[] = [];
  for (const k of kids(table)) {
    if (k.localName === 'table-column') out.push(k);
    else if (k.localName === 'table-header-columns' || k.localName === 'table-column-group' || k.localName === 'table-columns') for (const c of columnsOf(k)) out.push(c);
  }
  return out;
}

const tAttr = (el: Element, name: string) => el.getAttributeNS(TABLE, name);
const oAttr = (el: Element, name: string) => el.getAttributeNS(OFFICE, name);

/** Open an OpenDocument spreadsheet. */
export function readOds(bytes: Uint8Array): { book: Workbook; warnings: string[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipPackage(bytes);
  } catch (e) {
    throw e instanceof ZipTooBigError ? e : new Error('This is not an OpenDocument spreadsheet (or it is damaged).');
  }
  if (files['META-INF/manifest.xml'] && /encryption-data/.test(strFromU8(files['META-INF/manifest.xml']))) {
    throw new Error('This spreadsheet is protected with a password. Open it in LibreOffice, take the password off, and save it again.');
  }
  const parse = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null);
  const content = parse('content.xml');
  const sheet = content?.getElementsByTagNameNS(OFFICE, 'spreadsheet')[0];
  if (!content || !sheet) throw new Error('This is not an OpenDocument spreadsheet.');
  const styles = readStyles([parse('styles.xml'), content]);
  const tables = kids(sheet, 'table');
  if (!tables.length) throw new Error('This spreadsheet has no sheets.');
  const names: string[] = [];
  for (const [i, t] of tables.entries()) names.push(safeSheetName(tAttr(t, 'name') || `Sheet${i + 1}`, names));
  const book = new Workbook(names);
  // another program's text is shown as it wrote it (Q1 stays Q1, not Q₁)
  book.autoChem = false;
  const warnings: string[] = [];
  let pictures = 0, hiddenSheets = 0, cutRows = 0;
  book.build(() => {
    tables.forEach((t, si) => {
      const s = book.sheets[si];
      if (/^(collapse|hidden|false)$/.test(tAttr(t, 'display') ?? '') || tAttr(t, 'visibility') === 'collapse') hiddenSheets++;
      pictures += t.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', 'frame').length;
      // columns: widths, hiding, and the look of their cells
      const colStyle: (string | null)[] = [];
      let c = 0;
      for (const col of columnsOf(t)) {
        const n = Math.min(Number(tAttr(col, 'number-columns-repeated') ?? 1) || 1, MAX_COLS - c);
        const w = styles.colWidths.get(tAttr(col, 'style-name') ?? '');
        const hidden = tAttr(col, 'visibility') === 'collapse';
        if (n <= 1024) {
          for (let k = 0; k < n; k++) {
            if (w !== undefined) s.setColWidth(c + k, w);
            if (hidden) s.setColHidden(c + k, true);
            colStyle[c + k] = tAttr(col, 'default-cell-style-name');
          }
        }
        c += n;
      }
      const merges: Range[] = [];
      let r = 0;
      const rowEls = rowsOf(t);
      for (const row of rowEls) {
        const rn = Math.min(Number(tAttr(row, 'number-rows-repeated') ?? 1) || 1, MAX_ROWS - r);
        const cells = kids(row).filter((k) => k.localName === 'table-cell' || k.localName === 'covered-table-cell');
        // each cell read once for all the row's copies: its columns, what it holds and its look
        let col = 0;
        const read = cells.map((cell) => {
          const at = col;
          const cn = Math.min(Number(tAttr(cell, 'number-columns-repeated') ?? 1) || 1, MAX_COLS - col);
          col += cn;
          const input = cell.localName === 'covered-table-cell' ? undefined : cellInput(cell);
          const style = styles.cells.get(tAttr(cell, 'style-name') ?? colStyle[at] ?? '');
          const shown = style && Object.keys(style).length ? style : undefined;
          return { cell, at, cn, input, shown };
        });
        const h = styles.rowHeights.get(tAttr(row, 'style-name') ?? '');
        const hidden = tAttr(row, 'visibility') === 'collapse';
        // values and formulas go in every copy, up to about 250,000 cells for the run (a row repeated
        // to the foot of the sheet is cut there, and said); a look on cells that hold nothing in the first 1000
        const holds = read.some((x) => x.input !== undefined);
        const looks = read.some((x) => x.shown && x.input === undefined && x.cn <= 256);
        const perRow = read.reduce((n, x) => n + (x.input !== undefined ? x.cn : 0), 0);
        const most = Math.max(1000, Math.floor(250000 / Math.max(1, perRow)));
        const copies = holds ? Math.min(rn, most) : looks ? Math.min(rn, 1000) : 0;
        if (holds && rn > copies) cutRows += rn - copies;
        // the run's height and hiding: for each copy of it, but for empty rows that run on to the
        // foot of the sheet (LibreOffice ends a sheet with a million of them): hidden ones are held as
        // the sheet's own setting, rows not listed being hidden (Excel's zeroHeight, ECMA-376 Part 1,
        // 18.3.1.81), and a height goes on the first 1000 only
        if (h !== undefined || hidden) {
          const tail = !holds && rn > 1000 && (r + rn >= MAX_ROWS || row === rowEls[rowEls.length - 1]);
          if (tail && hidden) s.fileRowHeight = { pt: 15, zero: true };
          const n = holds ? copies : tail ? Math.min(rn, 1000) : rn;
          for (let k = 0; k < n; k++) {
            if (h !== undefined) s.setRowHeight(r + k, h);
            if (hidden && !tail) s.setRowHidden(r + k, true);
          }
        }
        for (let k = 0; k < copies; k++) {
          for (const { input, shown, at, cn } of read) {
            if (input === undefined && (!shown || cn > 256 || k >= 1000)) continue;
            const fmt = input?.numFmt;
            const st = fmt ? { ...shown, numFmt: fmt } : shown;
            for (let j = 0; j < (input !== undefined ? cn : Math.min(cn, 256)); j++) s.setCell(r + k, at + j, { input: input?.text || undefined, style: st });
          }
        }
        for (const { cell, at } of read) {
          const cs = Number(tAttr(cell, 'number-columns-spanned') ?? 1), rs = Number(tAttr(cell, 'number-rows-spanned') ?? 1);
          if (cell.localName === 'table-cell' && (cs > 1 || rs > 1)) merges.push({ r1: r, c1: at, r2: r + rs - 1, c2: at + cs - 1 });
        }
        r += rn;
      }
      if (merges.length) s.setMerges(merges);
    });
  });
  if (hiddenSheets) warnings.push(`${hiddenSheets} hidden sheet${hiddenSheets > 1 ? 's show' : ' shows'} here.`);
  if (pictures) warnings.push(`${pictures} picture${pictures > 1 ? 's' : ''}, chart${pictures > 1 ? 's' : ''} or shape${pictures > 1 ? 's were' : ' was'} left out.`);
  if (cutRows) warnings.push(`${cutRows.toLocaleString('en-US')} repeated row${cutRows > 1 ? 's' : ''} at the foot of a sheet ${cutRows > 1 ? 'were' : 'was'} left out (a row with values is repeated down to about 250,000 cells).`);
  warnings.push('.ods files open here but save as .xlsx.');
  return { book, warnings };
}

/** What to type into the cell for an OpenDocument cell, and the number format its value needs. */
function cellInput(cell: Element): { text: string; numFmt?: string } | undefined {
  const f = tAttr(cell, 'formula');
  const type = oAttr(cell, 'value-type');
  if (f) return { text: normalizeFormula(excelFromOpenFormula(f)), numFmt: type === 'date' ? 'yyyy-mm-dd' : type === 'percentage' ? '0%' : undefined };
  switch (type) {
    case 'float': case 'currency': {
      const v = oAttr(cell, 'value');
      return v !== null ? { text: String(Number(v)), ...(type === 'currency' ? { numFmt: '#,##0.00' } : {}) } : undefined;
    }
    case 'percentage': {
      const v = Number(oAttr(cell, 'value'));
      return { text: String(v), numFmt: Number.isInteger(+(v * 100).toFixed(9)) ? '0%' : '0.00%' };
    }
    case 'date': {
      const raw = oAttr(cell, 'date-value') ?? '';
      const v = dateValue(raw);
      if (v === null) return { text: textInput(cellText(cell)) };
      return { text: String(v), numFmt: raw.includes('T') && v % 1 ? 'yyyy-mm-dd h:mm' : 'yyyy-mm-dd' };
    }
    case 'time': {
      const v = timeValue(oAttr(cell, 'time-value') ?? '');
      return v === null ? { text: textInput(cellText(cell)) } : { text: String(v), numFmt: 'h:mm:ss' };
    }
    case 'boolean': return { text: oAttr(cell, 'boolean-value') === 'true' ? 'TRUE' : 'FALSE' };
    case 'string': return { text: textInput(cellText(cell)) };
    default: {
      const text = cellText(cell);
      return text ? { text: textInput(text) } : undefined;
    }
  }
}
