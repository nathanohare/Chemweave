/**
 * The kit the Office samplers are built with (tests/office-sampler/*-sampler*.ts): a package
 * builder of their own (so the files don't depend on the packaging code they test), pictures and a
 * sound made here in code, the item list every sampler keeps, and helpers that find a sampled item
 * again in a file by its id.
 *
 * Every sampled item has a stable id (W-CHR-07, P-FIL-03, X-NUM-12: W for Word, P for PowerPoint,
 * X for Excel, then the area, then a number) that appears in its text, its name or the cell beside
 * it, so any difference found in Office or in Chemweave maps back to one feature. Ids are never
 * reused or renumbered: a removed item leaves a gap.
 *
 * Each item is tagged from the code (src/io/docx-*.ts, pptx-*.ts, xlsx*.ts) as one of:
 *   supported  Chemweave reads it into its model and writes it back;
 *   kept       Chemweave doesn't model it, but keeps the original XML through a save;
 *   loss       Chemweave is expected to drop or change it on save (sampled to see whether it
 *              falls back cleanly).
 * A `check` reads the item back from a file. It must hold on the sampler as built (so the check
 * itself is right); tests/office-sampler/harness.ts then requires it to hold after Chemweave's open
 * and save for supported and kept items, and reports whether it does for loss items.
 */
import { zipSync, strToU8, strFromU8, unzipSync } from 'fflate';
import { deflateSync } from 'node:zlib';

export type Tag = 'supported' | 'kept' | 'loss';

export interface Item {
  /** Stable id, such as W-CHR-07; it appears in the item's text or name in the file. */
  id: string;
  /** What is sampled, in a few words (as Office's menus or the specification name it). */
  feature: string;
  tag: Tag;
  /** Where the feature is defined: an ECMA-376 Part 1 section (§17.3.2.40) or an Office menu path. */
  spec: string;
  /** Why it has this tag: the code that reads, keeps or drops it (file:line or function). */
  basis?: string;
  /** Reads the item back from a file: true when it is there as sampled. */
  check?: (v: View) => boolean;
}

/** A check that fails on what Chemweave does today: its finding id (F-W-001) and what happens. */
export interface Finding {
  finding: string;
  /** What Chemweave does, as seen in its saved file. */
  note: string;
  /**
   * For a whole-file check (second-save, schema-out, integrity): the problems this finding covers,
   * matched against each problem line (a part name first). Only those run as the expected
   * failure; any other problem in the file fails the check as usual.
   */
  scope?: RegExp;
}

export interface Sampler {
  /** The file name, such as docx-text.docx. */
  name: string;
  /** One area of the format (text, tables, sections…), so a crash in one doesn't hide the rest. */
  area: string;
  items: Item[];
  build(): Uint8Array;
}

/** Makes items with ids numbered in order: `const it = items('W-CHR')` then `it('bold', 'supported', '§17.3.2.1', check)`. */
export function itemList(prefix: string, list: Item[]) {
  let n = 0;
  return (feature: string, tag: Tag, spec: string, check?: (v: View) => boolean, basis?: string): string => {
    const id = `${prefix}-${String(++n).padStart(2, '0')}`;
    list.push({ id, feature, tag, spec, check, basis });
    return id;
  };
}

// ---------------------------------------------------------------------------------------------
// Namespaces and content types

export const NS: Record<string, string> = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  x: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w10: 'urn:schemas-microsoft-com:office:word',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  wpg: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  a14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  x14: 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main',
  xm: 'http://schemas.microsoft.com/office/excel/2006/main',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  cp: 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  ep: 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
};

/** xmlns declarations for these prefixes: `xmlns('w', 'r')`. */
export const xmlns = (...prefixes: string[]) => prefixes.map((p) => `xmlns:${p}="${NS[p]}"`).join(' ');

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const REL = {
  officeDocument: `${R}officeDocument`, styles: `${R}styles`, numbering: `${R}numbering`, settings: `${R}settings`,
  fontTable: `${R}fontTable`, theme: `${R}theme`, header: `${R}header`, footer: `${R}footer`, footnotes: `${R}footnotes`,
  endnotes: `${R}endnotes`, comments: `${R}comments`, image: `${R}image`, hyperlink: `${R}hyperlink`, oleObject: `${R}oleObject`,
  package: `${R}package`, chart: `${R}chart`, diagramData: `${R}diagramData`, diagramLayout: `${R}diagramLayout`,
  diagramQuickStyle: `${R}diagramQuickStyle`, diagramColors: `${R}diagramColors`,
  diagramDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
  slide: `${R}slide`, slideLayout: `${R}slideLayout`, slideMaster: `${R}slideMaster`, notesMaster: `${R}notesMaster`,
  notesSlide: `${R}notesSlide`, presProps: `${R}presProps`, viewProps: `${R}viewProps`, tableStyles: `${R}tableStyles`,
  commentAuthors: `${R}commentAuthors`, audio: `${R}audio`, video: `${R}video`,
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  worksheet: `${R}worksheet`, sharedStrings: `${R}sharedStrings`, drawing: `${R}drawing`, table: `${R}table`,
  vmlDrawing: `${R}vmlDrawing`, calcChain: `${R}calcChain`,
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProps: `${R}extended-properties`,
};

export const CT = {
  docMain: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  styles: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
  numbering: 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml',
  settings: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
  fontTable: 'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
  header: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
  footer: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
  footnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  endnotes: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
  comments: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  dgmData: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml',
  dgmLayout: 'application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml',
  dgmStyle: 'application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml',
  dgmColors: 'application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml',
  dgmDrawing: 'application/vnd.ms-office.drawingml.diagramDrawing+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  commentAuthors: 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml',
  pptComments: 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml',
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  sheetStyles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  sharedStrings: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  table: 'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml',
  sheetComments: 'application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml',
  vml: 'application/vnd.openxmlformats-officedocument.vmlDrawing',
  oleObject: 'application/vnd.openxmlformats-officedocument.oleObject',
  xlsxPackage: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Content types by extension for the binary parts the samplers use. */
const DEFAULTS: Record<string, string> = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml', xml: 'application/xml', png: 'image/png',
  jpeg: 'image/jpeg', emf: 'image/x-emf', bin: CT.oleObject, wav: 'audio/wav', xlsx: CT.xlsxPackage, vml: CT.vml,
};

// ---------------------------------------------------------------------------------------------
// A package (zip) builder

/** Every file gets this time, so a sampler is the same bytes each time it is built. */
const MTIME = new Date('2026-01-01T00:00:00Z');

export class Pkg {
  private parts = new Map<string, Uint8Array>();
  private types = new Map<string, string>();
  private rels = new Map<string, { id: string; type: string; target: string; external: boolean }[]>();

  /** Add a part (with its content type when its extension doesn't give it). */
  add(path: string, data: string | Uint8Array, type?: string): this {
    // two parts of one name would silently become one (and Office refuses the file)
    if (this.parts.has(path)) throw new Error(`the sampler adds ${path} twice`);
    this.parts.set(path, typeof data === 'string' ? strToU8(data) : data);
    if (type) this.types.set(path, type);
    return this;
  }

  /** Relate `from` (a part, or '' for the package) to `target` (relative to `from`'s folder); returns the id. */
  rel(from: string, type: string, target: string, external = false): string {
    const list = this.rels.get(from) ?? [];
    this.rels.set(from, list);
    const id = `rId${list.length + 1}`;
    list.push({ id, type, target, external });
    return id;
  }

  build(): Uint8Array {
    const files: Record<string, [Uint8Array, { mtime: Date; level: 0 | 6 }]> = {};
    const put = (name: string, data: Uint8Array) => { files[name] = [data, { mtime: MTIME, level: /\.(png|jpeg|wav|xlsx)$/.test(name) ? 0 : 6 }]; };
    const used = new Set(['rels', 'xml']);
    for (const p of this.parts.keys()) if (!this.types.has(p)) used.add(/\.([^./]+)$/.exec(p)?.[1] ?? '');
    const ct = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${NS.ct}">`];
    for (const ext of [...used].sort()) {
      if (!DEFAULTS[ext]) throw new Error(`no content type for .${ext}: give one when adding the part`);
      ct.push(`<Default Extension="${ext}" ContentType="${DEFAULTS[ext]}"/>`);
    }
    for (const [p, t] of this.types) ct.push(`<Override PartName="/${p}" ContentType="${t}"/>`);
    ct.push('</Types>');
    put('[Content_Types].xml', strToU8(ct.join('')));
    for (const [from, list] of this.rels) {
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
      const name = from ? `${dir}_rels/${from.slice(dir.length)}.rels` : '_rels/.rels';
      put(name, strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.rels}">`
        + list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')
        + '</Relationships>'));
    }
    for (const [p, d] of this.parts) put(p, d);
    return zipSync(files);
  }
}

/** Document properties (title and creator), which every Office file has. */
export function addProps(pkg: Pkg, title: string, app: string): void {
  pkg.add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties ${xmlns('cp', 'dc', 'dcterms')} xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(title)}</dc:title><dc:creator>Chemweave sampler</dc:creator>`
    + '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>', CT.core);
  pkg.add('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="${NS.ep}"><Application>${esc(app)}</Application></Properties>`, CT.app);
  pkg.rel('', REL.coreProps, 'docProps/core.xml');
  pkg.rel('', REL.extendedProps, 'docProps/app.xml');
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// ---------------------------------------------------------------------------------------------
// Pictures and a sound, made here

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(type: string, data: Uint8Array): number[] {
  const td = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
  return [...be32(data.length), ...td, ...be32(crc32(td))];
}

/**
 * A PNG picture, w × h pixels: four colored quarters with a dark diagonal, so cropping, flipping and
 * turning show which way round it is. `rgb` gives the top-left quarter's color.
 */
export function png(w = 64, h = 48, rgb: [number, number, number] = [220, 60, 60]): Uint8Array {
  const quarters: [number, number, number][] = [rgb, [60, 160, 60], [60, 90, 220], [240, 200, 40]];
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const q = quarters[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)];
      const onLine = Math.abs(x / w - y / h) < 0.03;
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = onLine ? 20 : q[0]; raw[o + 1] = onLine ? 20 : q[1]; raw[o + 2] = onLine ? 20 : q[2];
    }
  }
  const ihdr = new Uint8Array([...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', ihdr), ...chunk('IDAT', new Uint8Array(deflateSync(raw))), ...chunk('IEND', new Uint8Array())]);
}

/** A WAV sound: a 440 Hz tone, `ms` long, 8 kHz mono 8-bit. */
export function wav(ms = 400): Uint8Array {
  const rate = 8000, n = Math.round((rate * ms) / 1000);
  const b = new Uint8Array(44 + n), d = new DataView(b.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  s(0, 'RIFF'); d.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true);
  s(36, 'data'); d.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 440 * i) / rate));
  return b;
}

// ---------------------------------------------------------------------------------------------
// Reading a file back

/** A file's XML parts, parsed when asked for, with helpers to find a sampled item by its id. */
export class View {
  readonly parts: Record<string, string>;
  readonly binary: Record<string, Uint8Array>;
  private docs = new Map<string, Document>();

  constructor(bytes: Uint8Array) {
    const files = unzipSync(bytes);
    this.parts = {};
    this.binary = {};
    for (const [n, b] of Object.entries(files)) {
      if (/\.(xml|rels|vml)$/i.test(n)) this.parts[n] = strFromU8(b);
      else this.binary[n] = b;
    }
  }

  doc(part: string): Document | undefined {
    if (!(part in this.parts)) return undefined;
    let d = this.docs.get(part);
    if (!d) { d = new DOMParser().parseFromString(this.parts[part], 'application/xml'); this.docs.set(part, d); }
    return d;
  }

  /** The parts whose name matches. */
  partsLike(re: RegExp): string[] {
    return Object.keys(this.parts).filter((p) => re.test(p)).sort();
  }

  /** Every element named `qname` (prefix:local) in the parts matching `part`. */
  all(part: RegExp, qname: string): Element[] {
    const [p, l] = qname.split(':');
    return this.partsLike(part).flatMap((n) => Array.from(this.doc(n)!.getElementsByTagNameNS(NS[p], l)));
  }

  /** Every element named `qname` (prefix:local) in the one part named exactly `part`. */
  inPart(part: string, qname: string): Element[] {
    const [p, l] = qname.split(':');
    const d = this.parts[part] === undefined ? null : this.doc(part);
    return d ? Array.from(d.getElementsByTagNameNS(NS[p], l)) : [];
  }

  /** The first element named `qname` in the parts matching `part` whose text holds `id`. */
  holding(part: RegExp, qname: string, id: string): Element | undefined {
    return this.all(part, qname).find((e) => (e.textContent ?? '').includes(id));
  }

  /** The target of relationship `rid` from `part`. */
  target(part: string, rid: string): string | undefined {
    const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '';
    const rels = this.doc(`${dir}_rels/${part.slice(dir.length)}.rels`);
    if (!rels) return undefined;
    return Array.from(rels.getElementsByTagNameNS(NS.rels, 'Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') ?? undefined;
  }
}

/** The first child of `el` named `qname`, following a path such as 'w:rPr/w:u'. */
export function kid(el: Element | undefined | null, path: string): Element | undefined {
  let cur: Element | undefined = el ?? undefined;
  for (const q of path.split('/')) {
    if (!cur) return undefined;
    const [p, l] = q.split(':');
    cur = Array.from(cur.children).find((c) => c.namespaceURI === NS[p] && c.localName === l);
  }
  return cur;
}

/** The attribute `qname` (prefix:local, or a bare name) of `el`. */
export function at(el: Element | undefined | null, qname: string): string | null {
  if (!el) return null;
  if (!qname.includes(':')) return el.getAttribute(qname);
  const [p, l] = qname.split(':');
  return el.getAttributeNS(NS[p], l);
}

/** The first descendant of `el` named `qname`. */
export function find(el: Element | undefined | null, qname: string): Element | undefined {
  if (!el) return undefined;
  const [p, l] = qname.split(':');
  return el.getElementsByTagNameNS(NS[p], l)[0] ?? undefined;
}

/** The nearest ancestor of `el` (or `el` itself) named `qname`. */
export function up(el: Element | undefined | null, qname: string): Element | undefined {
  const [p, l] = qname.split(':');
  for (let e = el ?? null; e; e = e.parentElement) if (e.namespaceURI === NS[p] && e.localName === l) return e;
  return undefined;
}
