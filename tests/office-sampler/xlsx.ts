/**
 * Builds the Excel samplers' files (SpreadsheetML, ECMA-376 Part 1 §18) and finds their items
 * again: the workbook with its worksheets, styles (made from lists of number formats, fonts, fills,
 * borders and cell formats), shared strings and theme, plus whatever parts a sampler adds
 * (drawings, charts, tables, comments, metadata, links to other workbooks).
 *
 * The layout every sampler follows: each item is one row of a sheet; column A holds the item's id
 * and what it samples (a shared string, `X-NUM-07 Built-in format 14`), column B (and on) the
 * sampled cells. A sheet-level item (frozen panes, page setup, protection) has a sheet of its own
 * whose name starts with the id. Chemweave regenerates shared strings and style numbers on saving,
 * so the finders here resolve column A's text through the shared strings and a cell's look through
 * cellXfs to its font, fill, border and number format, never by index.
 */
import { Pkg, REL, CT, NS, XML_HEAD, addProps, esc, kid, at, type View } from './kit';
import { themeXml, THEME_COLORS } from './theme';

export const X_MAIN = NS.x;
export const X14AC = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac';
export const XR = 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision';
export const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
export const XDA = 'http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray';

/** The worksheet root's namespaces, as Excel writes them (its extensions ignorable). */
export const WS_NS = `xmlns="${X_MAIN}" xmlns:r="${NS.r}" xmlns:mc="${NS.mc}" xmlns:x14ac="${X14AC}" xmlns:xr="${XR}" mc:Ignorable="x14ac xr"`;

export const XCT = {
  threaded: 'application/vnd.ms-excel.threadedcomments+xml',
  persons: 'application/vnd.ms-excel.person+xml',
  metadata: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml',
  externalLink: 'application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml',
  chartStyle: 'application/vnd.ms-office.chartstyle+xml',
  chartColors: 'application/vnd.ms-office.chartcolorstyle+xml',
};
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const XREL = {
  threaded: 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment',
  persons: 'http://schemas.microsoft.com/office/2017/10/relationships/person',
  metadata: `${R}sheetMetadata`,
  externalLink: `${R}externalLink`,
  externalLinkPath: `${R}externalLinkPath`,
  comments: `${R}comments`,
};

// ---------------------------------------------------------------------------------------------
// Styles

/** Excel's built-in number formats (ECMA-376 Part 1 §18.8.30), by id: those the specification lists. */
export const BUILTIN_NUMFMT: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
  22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};

export const DEFAULT_FONT = '<sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/>';

export interface XfOpts {
  numFmtId?: number;
  /** A number format code of the file's own (given an id from 164). */
  code?: string;
  /** The font's contents (CT_Font children); the default font when not given. */
  font?: string;
  /** The fill's contents (a patternFill or gradientFill). */
  fill?: string;
  /** The border's contents (left, right, top, bottom, diagonal… in the schema's order) and its attributes. */
  border?: string;
  borderAttrs?: string;
  /** The alignment element's attributes. */
  align?: string;
  /** The protection element's attributes. */
  protection?: string;
  /** The named cell style (cellStyleXfs index) this format is based on. */
  xfId?: number;
}

/** styles.xml (§18.8.39), built from lists: each of fonts, fills, borders and formats added once. */
export class Styles {
  numFmts: [number, string][] = [];
  fonts = [`<font>${DEFAULT_FONT}</font>`];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  styleXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>'];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  cellStyles = ['<cellStyle name="Normal" xfId="0" builtinId="0"/>'];
  dxfs: string[] = [];
  tableStyles = '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>';
  /** colors (§18.8.11): an indexed palette of the file's own, or MRU colors. */
  colors = '';

  private index(list: string[], item: string): number {
    const i = list.indexOf(item);
    if (i >= 0) return i;
    list.push(item);
    return list.length - 1;
  }

  /** A number format code of the file's own; returns its id (from 164). */
  numFmt(code: string, id?: number): number {
    const had = this.numFmts.find(([, c]) => c === code);
    if (had && id === undefined) return had[0];
    const n = id ?? 164 + this.numFmts.filter(([i]) => i >= 164).length;
    this.numFmts.push([n, code]);
    return n;
  }

  font(inner: string): number { return this.index(this.fonts, `<font>${inner}</font>`); }
  fill(inner: string): number { return this.index(this.fills, `<fill>${inner}</fill>`); }
  border(inner: string, attrs = ''): number { return this.index(this.borders, `<border${attrs}>${inner}</border>`); }
  dxf(inner: string): number { this.dxfs.push(`<dxf>${inner}</dxf>`); return this.dxfs.length - 1; }

  private xfXml(o: XfOpts, cellXf: boolean): string {
    const num = o.code !== undefined ? this.numFmt(o.code) : o.numFmtId ?? 0;
    const font = o.font !== undefined ? this.font(o.font) : 0;
    const fill = o.fill !== undefined ? this.fill(o.fill) : 0;
    const border = o.border !== undefined ? this.border(o.border, o.borderAttrs) : 0;
    const kids = (o.align !== undefined ? `<alignment${o.align ? ' ' + o.align : ''}/>` : '') + (o.protection !== undefined ? `<protection ${o.protection}/>` : '');
    const apply = `${num ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${o.align !== undefined ? ' applyAlignment="1"' : ''}${o.protection !== undefined ? ' applyProtection="1"' : ''}`;
    return `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${border}"${cellXf ? ` xfId="${o.xfId ?? 0}"` : ''}${apply}${kids ? `>${kids}</xf>` : '/>'}`;
  }

  /** A cell format (cellXfs); returns its index, the cell's s. */
  xf(o: XfOpts): number { return this.index(this.xfs, this.xfXml(o, true)); }

  /** A named cell style: its base format (cellStyleXfs) and its entry in cellStyles; returns the base format's index. */
  named(name: string, o: XfOpts, attrs = ''): number {
    this.styleXfs.push(this.xfXml(o, false));
    const id = this.styleXfs.length - 1;
    this.cellStyles.push(`<cellStyle name="${esc(name)}" xfId="${id}"${attrs ? ' ' + attrs : ''}/>`);
    return id;
  }

  xml(): string {
    return `${XML_HEAD}<styleSheet xmlns="${X_MAIN}" xmlns:mc="${NS.mc}" xmlns:x14ac="${X14AC}" mc:Ignorable="x14ac">`
      + (this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map(([i, c]) => `<numFmt numFmtId="${i}" formatCode="${esc(c)}"/>`).join('')}</numFmts>` : '')
      + `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>`
      + `<fills count="${this.fills.length}">${this.fills.join('')}</fills>`
      + `<borders count="${this.borders.length}">${this.borders.join('')}</borders>`
      + `<cellStyleXfs count="${this.styleXfs.length}">${this.styleXfs.join('')}</cellStyleXfs>`
      + `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>`
      + `<cellStyles count="${this.cellStyles.length}">${this.cellStyles.join('')}</cellStyles>`
      + `<dxfs count="${this.dxfs.length}">${this.dxfs.join('')}</dxfs>`
      + this.tableStyles + this.colors + '</styleSheet>';
  }
}

/** sharedStrings.xml (§18.4.9): each text once. */
export class Sst {
  items: string[] = [];
  private count = 0;
  /** A plain text; returns its index. */
  s(text: string): number { return this.add(`<t>${esc(text)}</t>`); }
  /** A rich text of runs (CT_RElt: <r><rPr>…</rPr><t>…</t></r>, phonetic runs after); returns its index. */
  rich(inner: string): number { return this.add(inner); }
  private add(si: string): number {
    this.count++;
    const i = this.items.indexOf(si);
    if (i >= 0) return i;
    this.items.push(si);
    return this.items.length - 1;
  }
  xml(): string {
    return `${XML_HEAD}<sst xmlns="${X_MAIN}" count="${this.count}" uniqueCount="${this.items.length}">${this.items.map((x) => `<si>${x}</si>`).join('')}</sst>`;
  }
}

// ---------------------------------------------------------------------------------------------
// Cell references

export const colName = (c: number): string => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const colNumber = (name: string): number => { let c = 0; for (const ch of name.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
/** A1-style reference of row r and column c (both from 0). */
export const ref = (r: number, c: number) => `${colName(c)}${r + 1}`;
export const parseRef = (s: string): { r: number; c: number } | null => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(s.trim());
  return m ? { r: Number(m[2]) - 1, c: colNumber(m[1]) } : null;
};
/** Whether the space-separated list of ranges `sqref` covers cell `cell` (A1). */
export function covers(sqref: string | null | undefined, cell: string): boolean {
  const p = parseRef(cell);
  if (!sqref || !p) return false;
  return sqref.trim().split(/\s+/).some((part) => {
    const [a, b] = part.split(':');
    const x = parseRef(a), y = parseRef(b ?? a);
    return !!x && !!y && p.r >= Math.min(x.r, y.r) && p.r <= Math.max(x.r, y.r) && p.c >= Math.min(x.c, y.c) && p.c <= Math.max(x.c, y.c);
  });
}

// ---------------------------------------------------------------------------------------------
// Worksheets and the workbook

/** CT_Worksheet's children in the schema's order (§18.3.1.99). */
export const WS_ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection',
  'protectedRanges', 'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr',
  'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks',
  'colBreaks', 'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF',
  'drawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'] as const;
export type WsPart = typeof WS_ORDER[number];

/** A cell: its value (v), type (t), style (s), formula (f, the whole <f> element) or inline string. */
export interface CellOpts { v?: string | number; t?: 's' | 'str' | 'n' | 'b' | 'e' | 'inlineStr' | 'd'; s?: number; f?: string; is?: string; attrs?: string }

export class SheetB {
  readonly path: string;
  private rows = new Map<number, Map<number, string>>();
  private rowAttrs = new Map<number, string>();
  private partsXml = new Map<WsPart, string>();
  /** The next free row (from 0) for `item`. */
  next = 0;

  constructor(readonly book: Book, readonly name: string, readonly index: number, readonly state?: 'hidden' | 'veryHidden') {
    this.path = `xl/worksheets/sheet${index + 1}.xml`;
  }

  /** Set a worksheet part (the whole element), replacing what was there. */
  set(part: WsPart, xml: string): this { this.partsXml.set(part, xml); return this; }
  /** Add to a worksheet part (conditionalFormatting elements follow one another). */
  add(part: WsPart, xml: string): this { this.partsXml.set(part, (this.partsXml.get(part) ?? '') + xml); return this; }
  get(part: WsPart): string | undefined { return this.partsXml.get(part); }

  /** Put a cell at A1-style `at`. */
  cell(atRef: string, o: CellOpts): this {
    const p = parseRef(atRef)!;
    let row = this.rows.get(p.r);
    if (!row) this.rows.set(p.r, (row = new Map()));
    const t = o.t && o.t !== 'n' ? ` t="${o.t}"` : '';
    const body = (o.f ?? '') + (o.is !== undefined ? `<is>${o.is}</is>` : o.v !== undefined ? `<v>${typeof o.v === 'string' ? esc(o.v) : o.v}</v>` : '');
    row.set(p.c, `<c r="${atRef}"${o.s ? ` s="${o.s}"` : ''}${t}${o.attrs ? ' ' + o.attrs : ''}${body ? `>${body}</c>` : '/>'}`);
    if (p.r >= this.next) this.next = p.r + 1;
    return this;
  }
  /** A shared string cell. */
  text(atRef: string, text: string, s?: number): this { return this.cell(atRef, { t: 's', v: this.book.sst.s(text), s }); }
  num(atRef: string, v: number, s?: number): this { return this.cell(atRef, { v, s }); }
  /** A row's attributes (ht, customHeight, hidden, outlineLevel…), row from 0. */
  row(r: number, attrs: string): this { this.rowAttrs.set(r, attrs); if (r >= this.next) this.next = r + 1; return this; }

  /**
   * An item's row: its id and feature in column A, and `b` in column B (text, a number, or a
   * cell). Returns the row (from 0).
   */
  item(id: string, feature: string, b?: string | number | CellOpts, s?: number): number {
    const r = this.next;
    this.text(ref(r, 0), `${id} ${feature}`);
    if (typeof b === 'string') this.text(ref(r, 1), b, s);
    else if (typeof b === 'number') this.num(ref(r, 1), b, s);
    else if (b) this.cell(ref(r, 1), { ...b, ...(s !== undefined ? { s } : {}) });
    this.next = r + 1;
    return r;
  }

  /** Relate the worksheet to `target` (relative to xl/worksheets/); returns the id. */
  rel(type: string, target: string, external = false): string { return this.book.pkg.rel(this.path, type, target, external); }

  xml(): string {
    let last = { r: 0, c: 0 };
    const rowNos = [...new Set([...this.rows.keys(), ...this.rowAttrs.keys()])].sort((a, b) => a - b);
    const data = rowNos.map((r) => {
      const cells = [...(this.rows.get(r) ?? new Map<number, string>()).entries()].sort((a, b) => a[0] - b[0]);
      for (const [c] of cells) last = { r: Math.max(last.r, r), c: Math.max(last.c, c) };
      const attrs = this.rowAttrs.get(r);
      return `<row r="${r + 1}"${attrs ? ' ' + attrs : ''}${cells.length ? `>${cells.map(([, x]) => x).join('')}</row>` : '/>'}`;
    }).join('');
    const parts = new Map(this.partsXml);
    if (!parts.has('dimension')) parts.set('dimension', `<dimension ref="A1:${ref(last.r, last.c)}"/>`);
    if (!parts.has('sheetViews')) parts.set('sheetViews', `<sheetViews><sheetView${this.index === 0 ? ' tabSelected="1"' : ''} workbookViewId="0"/></sheetViews>`);
    if (!parts.has('sheetFormatPr')) parts.set('sheetFormatPr', '<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>');
    parts.set('sheetData', `<sheetData>${data}</sheetData>`);
    if (!parts.has('pageMargins')) parts.set('pageMargins', '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    return `${XML_HEAD}<worksheet ${WS_NS}>${WS_ORDER.map((p) => parts.get(p) ?? '').join('')}</worksheet>`;
  }
}

/** A workbook being built: its styles, shared strings and sheets, and workbook.xml's settings. */
export class Book {
  readonly pkg = new Pkg();
  readonly styles = new Styles();
  readonly sst = new Sst();
  readonly sheets: SheetB[] = [];
  /** workbook.xml's parts (whole elements), in the schema's order where they go. */
  wb: { fileSharing?: string; workbookPr?: string; workbookProtection?: string; bookViews?: string; externalReferences?: string; calcPr?: string; extLst?: string } = {};
  readonly names: string[] = [];
  /** More of the workbook's relationships, made when it is built (metadata, persons, external links). */
  private wbRels: { type: string; target: string; ct?: string; xml?: string | Uint8Array; path?: string }[] = [];

  sheet(name: string, state?: 'hidden' | 'veryHidden'): SheetB {
    const s = new SheetB(this, name, this.sheets.length, state);
    this.sheets.push(s);
    return s;
  }

  /** A defined name (§18.2.5): `<definedName name=… attrs>formula</definedName>`. */
  name(name: string, formula: string, attrs = ''): void {
    this.names.push(`<definedName name="${esc(name)}"${attrs ? ' ' + attrs : ''}>${esc(formula)}</definedName>`);
  }

  /** Add a part under xl/ related to the workbook; returns the relationship id. */
  wbPart(path: string, xml: string | Uint8Array, ct: string | undefined, relType: string): string {
    this.pkg.add(`xl/${path}`, xml, ct);
    return this.pkg.rel('xl/workbook.xml', relType, path);
  }

  /** Add a part (full path) with its content type. */
  part(path: string, xml: string | Uint8Array, ct?: string): void { this.pkg.add(path, xml, ct); }

  build(title: string): Uint8Array {
    const pkg = this.pkg;
    pkg.rel('', REL.officeDocument, 'xl/workbook.xml');
    addProps(pkg, title, 'Microsoft Excel');
    const sheetsXml = this.sheets.map((s) => {
      pkg.add(s.path, s.xml(), CT.worksheet);
      const rid = pkg.rel('xl/workbook.xml', REL.worksheet, `worksheets/sheet${s.index + 1}.xml`);
      return `<sheet name="${esc(s.name)}" sheetId="${s.index + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="${rid}"/>`;
    }).join('');
    this.wbPart('theme/theme1.xml', themeXml('Sampler'), CT.theme, REL.theme);
    this.wbPart('styles.xml', this.styles.xml(), CT.sheetStyles, REL.styles);
    this.wbPart('sharedStrings.xml', this.sst.xml(), CT.sharedStrings, REL.sharedStrings);
    for (const r of this.wbRels) if (r.xml !== undefined) pkg.add(r.path!, r.xml, r.ct);
    const w = this.wb;
    pkg.add('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="${X_MAIN}" xmlns:r="${NS.r}" xmlns:mc="${NS.mc}" xmlns:x15="${X15}" mc:Ignorable="x15">`
      + '<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/>'
      + (w.fileSharing ?? '') + (w.workbookPr ?? '<workbookPr defaultThemeVersion="166925"/>') + (w.workbookProtection ?? '')
      + (w.bookViews ?? '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>')
      + `<sheets>${sheetsXml}</sheets>` + (w.externalReferences ?? '')
      + (this.names.length ? `<definedNames>${this.names.join('')}</definedNames>` : '')
      + (w.calcPr ?? '<calcPr calcId="191029"/>') + (w.extLst ?? '') + '</workbook>', CT.workbook);
    return pkg.build();
  }
}

/** A cell format's font contents: `extra` (b, i, u…) and the size, color and name given or the defaults. */
export function fontOf(extra: string, o: { sz?: number; color?: string; name?: string } = {}): string {
  return `${extra}<sz val="${o.sz ?? 11}"/>${o.color ?? '<color theme="1"/>'}<name val="${esc(o.name ?? 'Calibri')}"/><family val="2"/>${o.name ? '' : '<scheme val="minor"/>'}`;
}
/** A solid fill of rgb (AARRGGBB or RRGGBB). */
export const solidFill = (rgb: string) => `<patternFill patternType="solid"><fgColor rgb="${rgb.length === 6 ? 'FF' + rgb : rgb}"/><bgColor indexed="64"/></patternFill>`;

// ---------------------------------------------------------------------------------------------
// Finding items again

const childrenNamed = (el: Element | undefined | null, local: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === X_MAIN && c.localName === local) : [];

/** The target of a relationship, as a path in the package. */
function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '').split('/').filter(Boolean);
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
}

/** The relationships of part `from`: id, type, target as a package path (or the URL when external). */
export function relsOf(v: View, from: string): { id: string; type: string; target: string; external: boolean }[] {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const d = v.doc(`${dir}_rels/${from.slice(dir.length)}.rels`);
  if (!d) return [];
  return Array.from(d.getElementsByTagNameNS(NS.rels, 'Relationship')).map((r) => {
    const external = r.getAttribute('TargetMode') === 'External';
    const t = r.getAttribute('Target') ?? '';
    return { id: r.getAttribute('Id') ?? '', type: r.getAttribute('Type') ?? '', target: external ? t : resolve(from, t), external };
  });
}

/** The workbook part's path. */
export const wbPath = (v: View) => relsOf(v, '').find((r) => r.type === REL.officeDocument)?.target ?? 'xl/workbook.xml';
export const wbRoot = (v: View) => v.doc(wbPath(v))?.documentElement;

export interface SheetInfo { name: string; path: string; state: string | null; index: number; el: Element; root?: Element }

const cache = new WeakMap<View, Map<string, unknown>>();
function memo<T>(v: View, key: string, make: () => T): T {
  let m = cache.get(v);
  if (!m) cache.set(v, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}

/** The workbook's sheets, in order. */
export function sheetList(v: View): SheetInfo[] {
  return memo(v, 'sheets', () => {
    const wp = wbPath(v);
    const rels = relsOf(v, wp);
    return childrenNamed(kid(wbRoot(v), 'x:sheets'), 'sheet').map((el, index) => {
      const path = rels.find((r) => r.id === at(el, 'r:id'))?.target ?? '';
      return { name: el.getAttribute('name') ?? '', path, state: el.getAttribute('state'), index, el, root: v.doc(path)?.documentElement };
    });
  });
}

/** The sheet whose name is `id` or starts with `id ` (a sheet-level item's own sheet). */
export const sheetOf = (v: View, id: string): SheetInfo | undefined => sheetList(v).find((s) => s.name === id || s.name.startsWith(id + ' '));
/** A sheet by its name. */
export const sheetNamed = (v: View, name: string): SheetInfo | undefined => sheetList(v).find((s) => s.name === name);

/** The shared strings' texts (runs joined, phonetic runs left out). */
export function sharedStrings(v: View): string[] {
  return memo(v, 'sst', () => {
    const p = relsOf(v, wbPath(v)).find((r) => r.type === REL.sharedStrings)?.target;
    const root = p ? v.doc(p)?.documentElement : undefined;
    return childrenNamed(root, 'si').map(siText);
  });
}
/** A string item's text (CT_Rst: its t, or its runs' t). */
export const siText = (si: Element): string => {
  const t = kid(si, 'x:t');
  if (t) return t.textContent ?? '';
  return childrenNamed(si, 'r').map((r) => kid(r, 'x:t')?.textContent ?? '').join('');
};

/** A cell's text as shown (shared, inline or formula string), or its value. */
export function cellText(v: View, c: Element | undefined): string {
  if (!c) return '';
  const t = c.getAttribute('t');
  const val = kid(c, 'x:v')?.textContent ?? '';
  if (t === 's') return sharedStrings(v)[Number(val)] ?? '';
  if (t === 'inlineStr') { const is = kid(c, 'x:is'); return is ? siText(is) : ''; }
  return val;
}
/** A shared string cell's string item element. */
export function cellSi(v: View, c: Element | undefined): Element | undefined {
  if (!c) return undefined;
  if (c.getAttribute('t') === 'inlineStr') return kid(c, 'x:is');
  if (c.getAttribute('t') !== 's') return undefined;
  const p = relsOf(v, wbPath(v)).find((r) => r.type === REL.sharedStrings)?.target;
  return childrenNamed(p ? v.doc(p)?.documentElement : undefined, 'si')[Number(kid(c, 'x:v')?.textContent ?? -1)];
}

export interface Found { sheet: SheetInfo; row: Element; r: number }

/** The row whose column A holds `id` (its text is the id, or starts with it and a space). */
export function rowOf(v: View, id: string): Found | undefined {
  return memo(v, `row:${id}`, () => {
    for (const sheet of sheetList(v)) {
      for (const row of childrenNamed(kid(sheet.root, 'x:sheetData'), 'row')) {
        const a = childrenNamed(row, 'c').find((c) => /^A\d+$/.test(c.getAttribute('r') ?? ''));
        const t = cellText(v, a);
        if (t === id || t.startsWith(id + ' ')) return { sheet, row, r: Number(row.getAttribute('r')) - 1 };
      }
    }
    return undefined;
  });
}
/** The cell in column `col` of the item's row. */
export function cellOf(v: View, id: string, col = 'B'): Element | undefined {
  const f = rowOf(v, id);
  if (!f) return undefined;
  return childrenNamed(f.row, 'c').find((c) => c.getAttribute('r') === `${col}${f.r + 1}`);
}
/** The A1 reference of column `col` in the item's row (e.g. B7). */
export const refOf = (v: View, id: string, col = 'B'): string | undefined => { const f = rowOf(v, id); return f ? `${col}${f.r + 1}` : undefined; };

/** The styles part's root. */
export function stylesRoot(v: View): Element | undefined {
  const p = relsOf(v, wbPath(v)).find((r) => r.type === REL.styles)?.target;
  return p ? v.doc(p)?.documentElement : undefined;
}

/**
 * Whether two number format codes mean the same (§18.8.31): Excel writes literal characters
 * escaped (yyyy\-mm\-dd for yyyy-mm-dd, #\ ?/8 for # ?/8), so a backslash before a character that
 * is always literal (- space ( ) / : $ +) is left out, and before a comma too in a date or time code
 * (where a comma can only be literal). Quoted text is kept as it is.
 */
export function sameCode(a: string | undefined, b: string | undefined): boolean {
  const key = (c: string | undefined) => {
    if (c === undefined) return undefined;
    // date or time tokens outside quotes, [brackets] and escaped characters
    const isDate = /[ymdhs]/i.test(c.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
    const k = c.replace(/\\([-\s()/:$+])/g, '$1');
    return isDate ? k.replace(/\\,/g, ',') : k;
  };
  return key(a) === key(b);
}

export interface Look {
  xf?: Element; font?: Element; fill?: Element; border?: Element; alignment?: Element; protection?: Element;
  numFmtId: number; code: string | undefined; styleXf?: Element; styleName?: string; cellStyle?: Element;
}

/** A cell's format (its cellXfs entry), with its font, fill, border, number format and named style. */
export const lookOf = (v: View, c: Element | undefined): Look => lookOfXf(v, c?.getAttribute('s'));
/** The look of cell format number `s` (cellXfs). */
export function lookOfXf(v: View, s: string | number | null | undefined): Look {
  const st = stylesRoot(v);
  const xf = childrenNamed(kid(st, 'x:cellXfs'), 'xf')[Number(s ?? 0)];
  const pick = (list: string, item: string, attr: string) => childrenNamed(kid(st, `x:${list}`), item)[Number(xf?.getAttribute(attr) ?? 0)];
  const numFmtId = Number(xf?.getAttribute('numFmtId') ?? 0);
  const own = childrenNamed(kid(st, 'x:numFmts'), 'numFmt').find((n) => Number(n.getAttribute('numFmtId')) === numFmtId);
  const xfId = Number(xf?.getAttribute('xfId') ?? 0);
  const cellStyle = childrenNamed(kid(st, 'x:cellStyles'), 'cellStyle').find((cs) => Number(cs.getAttribute('xfId')) === xfId);
  return {
    xf, font: pick('fonts', 'font', 'fontId'), fill: pick('fills', 'fill', 'fillId'), border: pick('borders', 'border', 'borderId'),
    alignment: kid(xf, 'x:alignment'), protection: kid(xf, 'x:protection'), numFmtId,
    code: own?.getAttribute('formatCode') ?? BUILTIN_NUMFMT[numFmtId], styleXf: childrenNamed(kid(st, 'x:cellStyleXfs'), 'xf')[xfId],
    styleName: cellStyle?.getAttribute('name') ?? undefined, cellStyle,
  };
}
/** The look of the item's cell in column `col`. */
export const lookAt = (v: View, id: string, col = 'B') => lookOf(v, cellOf(v, id, col));

/** The theme's colors in SpreadsheetML's numbering (§18.8.3: lt1, dk1, lt2, dk2, accents, hlink, folHlink). */
export const THEME_INDEX = [THEME_COLORS.lt1, THEME_COLORS.dk1, THEME_COLORS.lt2, THEME_COLORS.dk2, THEME_COLORS.accent1, THEME_COLORS.accent2,
  THEME_COLORS.accent3, THEME_COLORS.accent4, THEME_COLORS.accent5, THEME_COLORS.accent6, THEME_COLORS.hlink, THEME_COLORS.folHlink];
/** The legacy indexed palette's first colors (§18.8.27). */
export const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF'];

/** Apply a tint (§18.8.19 CT_Color tint) to an RRGGBB color, in HLS as Excel does. */
export function tinted(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  let rgb: number[];
  if (s === 0) rgb = [l2, l2, l2];
  else { const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s, p = 2 * l2 - q; rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)]; }
  return rgb.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A color element's RRGGBB (rgb, theme with tint, or indexed), or undefined (auto or none). */
export function colorHex(el: Element | undefined | null): string | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  if (el.getAttribute('rgb')) hex = el.getAttribute('rgb')!.slice(-6).toUpperCase();
  else if (el.hasAttribute('theme')) hex = THEME_INDEX[Number(el.getAttribute('theme'))];
  else if (el.hasAttribute('indexed')) hex = INDEXED[Number(el.getAttribute('indexed'))];
  if (!hex) return undefined;
  const t = Number(el.getAttribute('tint') ?? 0);
  return t ? tinted(hex, t) : hex.toUpperCase();
}
/** Two colors within a step of each other (a tint worked out a little differently). */
export const near = (a: string | undefined, b: string): boolean => !!a && [0, 2, 4].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 2);

/** The value of a (CT_BooleanProperty-like) child `local` of el: present and not val 0/false. */
export const onX = (el: Element | undefined, local: string): boolean => {
  const k = kid(el, `x:${local}`);
  if (!k) return false;
  const val = k.getAttribute('val');
  return val === null || val === '1' || val === 'true';
};
/** The val attribute of child `local` of el. */
export const valX = (el: Element | undefined, local: string, attr = 'val'): string | null => kid(el, `x:${local}`)?.getAttribute(attr) ?? null;
/** Whether an attribute is on (1 or true). */
export const isOn = (s: string | null | undefined) => s === '1' || s === 'true';

/** The worksheet root of an item's own sheet. */
export const wsOf = (v: View, id: string) => sheetOf(v, id)?.root;
/** The first child element `local` (main namespace) of a sheet-level item's worksheet. */
export const wsPart = (v: View, id: string, path: string) => kid(wsOf(v, id), path.split('/').map((p) => `x:${p}`).join('/'));
/** Children of `el` named `local` (main namespace). */
export const xKids = childrenNamed;
/** The defined names. */
export const definedNames = (v: View) => childrenNamed(kid(wbRoot(v), 'x:definedNames'), 'definedName');
/** The formula (<f>) text of a cell. */
export const formulaOf = (c: Element | undefined) => kid(c, 'x:f')?.textContent ?? undefined;
