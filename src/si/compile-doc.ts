// An SI project compiled into a Chemweave document, laid out as Chem SI Assistant lays out its
// PDF (compile/document.py with the ACS style): a cover page, the table of contents, General
// Information, then every section in tree order (custom sections' text with its figures and
// tables; Data sections' general procedures and compound blocks), and the references cited.
// Page numbers are S1, S2…; figure, table and scheme labels are numbered as SI Assistant
// numbers them (core/labels.py). The document is ordinary text, so it can be edited, saved as
// .docx or printed to PDF; its structures are drawings, editable with the drawing tools.
//
// Each compound's title paragraph carries a bookmark (si_<compound id>), so a manuscript can
// point at the compound's block.

import { DocBuilder, headingId } from '../io/doc-build';
import { paraFromStyle, styleOf, type DocObject, type DocText, type NamedStyle } from '../document/document';
import { citeSuper, formatOf } from '../document/references';
import type { Reference, RefType } from '../document/references';
import type { Contents, Justify, ParaStyle, TableCell, TextRun } from '../model';
import type { RunStyle } from '../richtext';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { CITE, MENTION, parseMarkup, citationsOf, type Paragraph, type Run } from './markup';
import { fieldKeys, valuesOf, compoundName, type Json, type SiCompound, type SiProject, type SiScheme, type SiSection } from './project';
import { displayId, type IdReport } from './compound-ids';
import { fieldDef, partText } from './fields';
import { mentionKind } from './checks';
import type { MolFacts } from './chem';
import { R, formatChemistry, scriptCharacters, type Leave } from './format';
import { compoundBlock, gpSentence, inlineFigures } from './blocks';

/** What compiling needs from the app: drawings made from molfiles, their sizes, and the structures' facts. */
export interface CompileHost {
  /** A molfile as a drawing (null when it can't be read). */
  contentsOf(molfile: string): Contents | null;
  /** A drawing's own size in points, in the document's drawing style. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** Formula and pieces of each structure (for the HRMS and elemental analysis sentences). */
  facts(mols: string[]): Promise<(MolFacts | null)[]>;
}

export interface CompiledSi {
  doc: DocText;
  /** Things to know about the result (left out, missing, printed as "??"), in plain words. */
  notes: string[];
  /** What a manuscript can point at: each compound, table, figure and scheme, in the order printed. */
  targets: SiTarget[];
}

/**
 * Something in the compiled SI a manuscript can mention: a compound (its ID) or a table, figure or
 * scheme (its label). `mark` is the bookmark on its title or caption paragraph ('' when it isn't
 * printed, as schemes aren't yet), which gives the page it is on.
 */
export interface SiTarget { key: string; kind: 'compound' | 'table' | 'figure' | 'scheme'; label: string; caption: string; mark: string }

const PT = 72;
const TEXT_W = 6.5 * PT;
/** Structures under compound titles: at most this big (SI Assistant's 3.25 × 2.6 in). */
const STRUCTURE_MAX = { w: 3.25 * PT, h: 2.6 * PT };
const FIGURE_MAX_H = 7 * PT;
const ATTACHMENT_MAX_H = 8 * PT;

const TOC_DEPTHS = ['sections', 'subsections', 'procedures', 'compounds'];
const COVER_HEADINGS: Record<string, string> = { ACS: 'Supporting Information', Wiley: 'Supporting Information', RSC: 'Electronic Supplementary Information' };
const LABEL_KINDS = ['figure', 'table', 'scheme'] as const;
type LabelKind = (typeof LABEL_KINDS)[number];
const REF_TYPES = new Set<RefType>(['article', 'book', 'chapter', 'thesis', 'web', 'misc']);

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => partText(v);
const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');

/** A bookmark name for a compound's block (letters, digits and _ as Word wants, starting with a letter). */
export const compoundBookmark = (compoundId: string): string => siMark(compoundId);

/** The bookmark on a compound's title or a caption in the compiled SI (si_ and its key, as Word wants names). */
export const siMark = (key: string): string => `si_${key.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 40);

// ---------------------------------------------------------------- labels (core/labels.py)

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}
function alpha(n: number): string {
  let out = '';
  while (n > 0) { const rest = (n - 1) % 26; n = Math.floor((n - 1) / 26); out = String.fromCharCode(97 + rest) + out; }
  return out;
}
const formatNumber = (n: number, style: string): string => (style === 'I' ? roman(n) : style === 'i' ? roman(n).toLowerCase() : style === 'a' ? alpha(n) : String(n));

function labelRules(settings: Json): Record<LabelKind, { word: string; prefix: string; style: string }> {
  const journal = str(settings.journal_style) || 'ACS';
  const raw = dict(settings.labels);
  const out = {} as Record<LabelKind, { word: string; prefix: string; style: string }>;
  for (const kind of LABEL_KINDS) {
    const rule = { word: kind === 'figure' && journal === 'RSC' ? 'Fig.' : kind[0].toUpperCase() + kind.slice(1), prefix: 'S', style: '1' };
    const stored = dict(raw[kind]);
    if (typeof stored.word === 'string') rule.word = stored.word.trim();
    if (typeof stored.prefix === 'string') rule.prefix = stored.prefix.trim();
    if (['1', 'I', 'i', 'a'].includes(str(stored.style))) rule.style = str(stored.style);
    out[kind] = rule;
  }
  return out;
}

class Labels {
  private counters: Record<LabelKind, number> = { figure: 0, table: 0, scheme: 0 };
  readonly byId = new Map<string, string>();
  readonly byPlace = new Map<string, string>();
  constructor(private rules: ReturnType<typeof labelRules>) {}
  add(kind: LabelKind, id: string, owner: string, index: number, custom: string): void {
    const rule = this.rules[kind];
    const n = ++this.counters[kind];
    const number = rule.prefix + formatNumber(n, rule.style);
    const label = custom.trim() || (rule.word ? `${rule.word} ${number}` : number);
    if (id && !this.byId.has(id)) this.byId.set(id, label);
    this.byPlace.set(`${owner}#${index}`, label);
  }
  at(owner: string, index: number): string { return this.byPlace.get(`${owner}#${index}`) ?? ''; }
}

/** A text's figure and table paragraphs: (kind, id), in order. */
type TextObject = { kind: 'figure' | 'table'; id: string };
const textObjects = (text: string): TextObject[] =>
  parseMarkup(text).flatMap((p): TextObject[] => (p.table ? [{ kind: 'table', id: p.table }] : p.figure ? [{ kind: 'figure', id: p.figure }] : p.image ? [{ kind: 'figure', id: '' }] : []));

// ---------------------------------------------------------------- pictures

/** Dots per inch a PNG or JPEG says it was made at (null when it doesn't say). */
function pictureDpi(b: Uint8Array, mime: string): number | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (mime === 'image/png') {
    for (let i = 8; i + 12 <= b.length;) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type === 'pHYs' && len >= 9 && b[i + 16] === 1) return dv.getUint32(i + 8) * 0.0254;
      if (type === 'IDAT' || type === 'IEND') break;
      i += 12 + len;
    }
  }
  if (mime === 'image/jpeg' && b.length > 18 && String.fromCharCode(b[6], b[7], b[8], b[9]) === 'JFIF') {
    const unit = b[13], x = dv.getUint16(14);
    if (unit === 1 && x > 1) return x;
    if (unit === 2 && x > 1) return x * 2.54;
  }
  return null;
}

/** A picture file as a document picture, at its own size (its dpi, or 96), no bigger than the room; null when it isn't one. */
function pictureObject(name: string, bytes: Uint8Array, room: { w: number; h: number }, widthPt?: number): Extract<DocObject, { kind: 'picture' }> | null {
  const mime = pictureMime(name, bytes);
  if (!mime || !['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/bmp', 'image/webp'].includes(mime)) return null;
  const px = imageSize(bytes, mime);
  if (!px || px.w <= 0 || px.h <= 0) return null;
  const dpi = mime === 'image/svg+xml' ? 72 : pictureDpi(bytes, mime) ?? 96;
  let w = (px.w / dpi) * PT, h = (px.h / dpi) * PT;
  if (widthPt) { h *= widthPt / w; w = widthPt; }
  const k = Math.min(1, room.w / w, room.h / h);
  w *= k; h *= k;
  return { kind: 'picture', src: dataUrl(bytes, mime), w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, px: { w: px.w, h: px.h } };
}

// ---------------------------------------------------------------- the compiler

interface Owner { key: string; name: string; folder: string; figures: Json }

class Compiler {
  readonly b = new DocBuilder();
  readonly notes: string[] = [];
  readonly targets: SiTarget[] = [];
  private readonly styles: Record<string, NamedStyle>;
  private readonly report: IdReport;
  private readonly labels: Labels;
  private readonly rank: number;
  private readonly excluded: Set<string>;
  private readonly leave: Leave;
  private readonly helpers: boolean;
  private readonly knownRefs: Set<string>;
  private facts = new Map<string, MolFacts | null>();
  private texts = new Map<string, string>();
  private cited = false;
  /** Citations are raised, as the document's citation style (ACS) has them. */
  private readonly citeSup = citeSuper(formatOf({}));

  constructor(readonly p: SiProject, readonly host: CompileHost, words: Set<string>) {
    this.styles = this.b.doc.styles;
    this.report = p.idReport();
    this.labels = new Labels(labelRules(p.settings));
    const toc = dict(p.settings.toc);
    const depth = typeof toc.depth === 'string' && TOC_DEPTHS.includes(toc.depth) ? toc.depth : p.settings.list_compounds_in_toc ? 'compounds' : 'procedures';
    this.rank = TOC_DEPTHS.indexOf(depth) + 1;
    this.excluded = new Set(list(p.settings.export_excluded).map(String));
    this.leave = { words };
    this.helpers = p.settings.format_text !== false;
    this.knownRefs = new Set(p.references.map((r) => str(r.id)));
  }

  private included(key: string): boolean { return !this.excluded.has(key) && !this.excluded.has('front'); }

  // -------------------------------------------------------------- reading first

  /** Every text with figures or tables, the structures' facts, and the labels, before anything is written. */
  async prepare(): Promise<void> {
    this.texts.set('general', (await this.p.folder.readText('front/general_information.txt')) ?? '');
    this.texts.set('cover', (await this.p.folder.readText('front/cover_text.txt')) ?? '');
    for (const s of this.p.sections) if (s.type === 'text') this.texts.set(s.id, await this.p.readSectionText(s));
    const compounds = this.p.compounds;
    const mols = await Promise.all(compounds.map((c) => (this.p.hasStructure(c) ? this.p.readStructure(c) : Promise.resolve(''))));
    const facts = await this.host.facts(mols.map((m) => m || ''));
    compounds.forEach((c, i) => this.facts.set(c.id, mols[i] ? facts[i] ?? null : null));
    // labels, in the order SI Assistant numbers them
    const ownerObjects = async (owner: Owner): Promise<void> => {
      const objs = textObjects(this.texts.get(owner.key) ?? '');
      for (let index = 0; index < objs.length; index++) {
        const o = objs[index];
        if (o.kind === 'table') {
          const t = dict(await this.readJson(joinPath(owner.folder, 'tables', `${o.id}.json`)));
          this.labels.add('table', o.id, owner.key, index, str(t.label));
        } else this.labels.add('figure', o.id, owner.key, index, str(dict(owner.figures[o.id]).label));
      }
    };
    await ownerObjects(await this.owner('general'));
    for (const s of this.p.sections) {
      if (s.type === 'text') await ownerObjects(await this.owner(s.id));
      else if (s.type === 'xray') this.xrayLabels(s);
      else if (s.type === 'data') {
        for (const item of s.items) {
          if (item.kind === 'scheme' && this.schemeShowsLabel(item)) this.labels.add('scheme', item.id, item.id, 0, str(item.data.label));
          for (const c of item.kind === 'scheme' ? item.children : [item]) {
            let index = 0;
            for (const def of fieldsOfCompound(c)) {
              if (def.kind !== 'attachments' || def.key === 'spectra') continue;
              for (const it of list(valuesOf(c)[def.key])) {
                const x = dict(it);
                if ((x.placement ?? 'inline') !== 'inline' || !str(x.file)) continue;
                this.labels.add('figure', str(x.id), c.id, index++, str(x.label));
              }
            }
            for (const x of this.p.anchored.get(c.id) ?? []) this.xrayLabels(x);
          }
        }
      }
    }
  }

  private xrayLabels(s: SiSection): void {
    if (!s.data.file) return;
    this.labels.add('figure', s.id, s.id, 0, str(s.data.label));
    if (s.data.table !== false) this.labels.add('table', s.id + '#table', s.id, 1, str(s.data.table_label));
  }

  private schemeShowsLabel(k: SiScheme): boolean {
    const layout = dict(dict(k.data.editor).layout);
    return layout.show_label !== false;
  }

  private async readJson(rel: string): Promise<unknown> {
    const t = await this.p.folder.readText(rel);
    if (t === null) return null;
    try { return JSON.parse(t); } catch { return null; }
  }

  private async owner(key: string): Promise<Owner> {
    if (key === 'general') return { key, name: 'General Information', folder: 'front', figures: dict(dict(await this.readJson('front/front.json')).figures) };
    const s = this.p.section(key);
    return { key, name: s.name, folder: s.folder, figures: dict(s.data.figures) };
  }

  // -------------------------------------------------------------- styles

  private headingStyle(level: number, listed: boolean): string {
    const lv = Math.max(1, Math.min(9, level));
    if (listed) return headingId(lv);
    const id = `SIHeading${lv}`;
    if (!this.styles[id]) {
      const s: NamedStyle = { ...this.styles[headingId(lv)], id, name: `SI Heading ${lv}`, custom: true };
      delete s.outline;
      this.styles[id] = s;
    }
    return id;
  }

  /** A compound's title: 11 pt bold, kept with its structure; in the contents only when they go down to compounds. */
  private compoundStyle(level: number, listed: boolean): string {
    const id = listed ? `SICompound${level}` : 'SICompound';
    if (!this.styles[id]) {
      const s: NamedStyle = { ...this.styles.Normal, id, name: listed ? `SI Compound ${level}` : 'SI Compound', size: 11, bold: true, align: 'left', spaceBefore: 15, spaceAfter: 5, keepNext: true, next: 'Normal', custom: true };
      if (listed) s.outline = level;
      this.styles[id] = s;
    }
    return id;
  }

  private plainStyle(id: string, name: string, more: Partial<NamedStyle>): string {
    if (!this.styles[id]) this.styles[id] = { ...this.styles.Normal, id, name, next: 'Normal', custom: true, ...more };
    return id;
  }

  // -------------------------------------------------------------- text

  /** Mentions as text (compounds' IDs in bold, figures' and tables' labels); citations kept only for references there are. */
  private resolve(runs: Run[], where: string): Run[] {
    const out: Run[] = [];
    for (const r of runs) {
      if (r.ref?.startsWith(MENTION)) {
        const id = r.ref.slice(MENTION.length);
        const kind = mentionKind(id);
        let text: string | null;
        if (kind === 'compound') text = this.compoundExists(id) ? displayId(this.report, id) : null;
        else text = this.labels.byId.get(id) ?? null;
        if (text === null) {
          text = '??';
          this.notes.push(`${where}: a mention points to a ${kind} that no longer exists (printed as “??”).`);
        }
        out.push(R(text, { bold: kind === 'compound' || r.bold, italic: r.italic, underline: r.underline, valign: r.valign }));
      } else if (r.ref?.startsWith(CITE)) {
        const ids = citationsOf(r);
        const known = ids.filter((i) => this.knownRefs.has(i));
        if (known.length < ids.length) this.notes.push(`${where}: a citation points to a reference that is no longer in the References list; it was left out.`);
        if (known.length) out.push(R('', { ref: CITE + known.join(','), valign: r.valign }));
      } else if (r.ref) continue;   // (a small structure of a scheme's conditions)
      else out.push(r);
    }
    return scriptCharacters(out);
  }

  private compoundExists(id: string): boolean { return this.p.compounds.some((c) => c.id === id); }

  private chemistry(runs: Run[]): Run[] { return this.helpers ? formatChemistry(runs, this.leave) : runs; }

  /** Runs written into the document in the paragraph's look. */
  private put(runs: Run[], look: RunStyle): void {
    for (const r of runs) {
      const l: RunStyle = { ...look };
      if (r.bold) l.bold = true;
      if (r.italic) l.italic = true;
      if (r.underline) l.underline = true;
      if (r.valign === 'sub') l.sub = true;
      if (r.valign === 'super') l.sup = true;
      if (r.ref?.startsWith(CITE)) {
        this.b.object({ kind: 'cite', refs: citationsOf(r) }, { ...l, sup: this.citeSup || undefined, sub: undefined });
        this.cited = true;
      } else this.b.text(r.text, l);
    }
  }

  /** A paragraph: its runs (mentions resolved), in style `ps`, with `look` over the style's own. */
  private para(runs: Run[], ps: ParaStyle, where: string, look: RunStyle = {}): void {
    this.put(this.resolve(runs, where), { ...this.b.styleLook(ps), ...look });
    this.b.endPara(this.full(ps));
  }

  /** A paragraph's settings with its style's written in (as Word writes them), its own on top. */
  private full(ps: ParaStyle): ParaStyle {
    return { ...paraFromStyle(styleOf(this.b.doc, ps), ps), ...ps };
  }

  /** Runs for a table cell or a table's notes (paragraphs of the cell on lines of their own). */
  private cellRuns(text: string, where: string, look: RunStyle): TextRun[] {
    const out: TextRun[] = [];
    parseMarkup(text).filter((p) => p.runs.length).forEach((p, i) => {
      if (i) out.push({ ...look, text: '\n' });
      for (const r of this.resolve(this.chemistry(p.runs), where)) {
        if (r.ref?.startsWith(CITE)) continue;   // (citations in tables: the number is left out)
        const t: TextRun = { ...look, text: r.text };
        if (r.bold) t.bold = true;
        if (r.italic) t.italic = true;
        if (r.underline) t.underline = true;
        if (r.valign === 'sub') t.sub = true;
        if (r.valign === 'super') t.sup = true;
        out.push(t);
      }
    });
    return out.filter((r) => r.text);
  }

  private alignOf(p: Paragraph, object: boolean): Justify | undefined {
    const a = p.align;
    if (a === 'left' || a === 'center' || a === 'right' || (!object && a === 'justify')) return a;
    return undefined;
  }

  /** A stored text: headings `offset` levels down (in the contents up to `listedLevels`), with its figures and tables. */
  private async richText(text: string, where: string, owner: Owner | null, offset: number, listedLevels: number, keepAlign = true): Promise<void> {
    let index = 0;
    for (const p of parseMarkup(text)) {
      if (p.table || p.figure || p.image) {
        const label = owner ? this.labels.at(owner.key, index) : '';
        const key = p.table || p.figure || (owner ? `${owner.key}#${index}` : '');
        index++;
        if (p.table) await this.table(owner, p.table, label, p.runs, where, keepAlign ? this.alignOf(p, true) : undefined);
        else await this.figure(owner, p, label, where, keepAlign ? this.alignOf(p, true) : undefined, key);
        continue;
      }
      if (!p.runs.length) continue;
      const runs = this.chemistry(p.runs);
      if (p.heading) {
        const level = p.heading + offset;
        this.para(runs, { style: this.headingStyle(level, level <= listedLevels) }, where);
      } else {
        const align = keepAlign ? this.alignOf(p, false) : undefined;
        this.para(runs, align ? { align } : {}, where);
      }
    }
  }

  /** A label and its caption; with `target`, bookmarked and listed for manuscripts to point at. */
  private caption(label: string, runs: Run[], where: string, ps: ParaStyle, target?: { key: string; kind: 'table' | 'figure' }): void {
    const body = this.chemistry(runs);
    const mark = target?.key ? siMark(target.key) : '';
    if (target?.key && label) this.targets.push({ key: target.key, kind: target.kind, label, caption: plainOf(body), mark });
    this.para([R(`${label || 'Figure'}.`, { bold: true }), ...(body.length ? [R(' '), ...body] : [])], { style: 'Caption', ...ps, ...(mark ? { marks: [mark] } : {}) }, where);
  }

  private async figure(owner: Owner | null, p: Paragraph, label: string, where: string, align?: Justify, key = ''): Promise<void> {
    let file = '', widthCm = 0;
    if (p.figure && owner) {
      const entry = dict(owner.figures[p.figure]);
      file = str(entry.file);
      widthCm = Number(entry.width ?? entry.width_cm ?? 0) || 0;
      if (!file) { this.notes.push(`${where}: a figure's picture is no longer in the project; left out.`); return; }
    } else if (p.image && owner) file = p.image;
    if (!file || !owner) return;
    await this.pictureBlock(joinPath(owner.folder, file), { w: TEXT_W, h: FIGURE_MAX_H }, where, widthCm ? Math.min(TEXT_W, (widthCm / 2.54) * PT) : undefined, align);
    this.caption(label || 'Figure', p.runs, where, { align: align ?? 'center' }, { key, kind: 'figure' });
  }

  /** A picture in a paragraph of its own; false when it couldn't be used (said in the notes). */
  private async pictureBlock(rel: string, room: { w: number; h: number }, where: string, widthPt?: number, align?: Justify): Promise<boolean> {
    const bytes = await this.p.folder.readBytes(rel);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (!bytes) { this.notes.push(`${where}: ${name} is no longer in the project; left out.`); return false; }
    const pic = pictureObject(name, bytes, room, widthPt);
    if (!pic) {
      this.notes.push(/\.pdf$/i.test(name) ? `${where}: ${name} is a PDF; PDF pictures are not placed in the document yet (left out).` : `${where}: ${name} could not be read as a picture; left out.`);
      return false;
    }
    this.b.object(pic);
    this.b.endPara(this.full({ align: align ?? 'center', keepNext: true, spaceAfter: 4 }));
    return true;
  }

  private async table(owner: Owner | null, id: string, label: string, caption: Run[], where: string, align?: Justify): Promise<void> {
    const data = owner ? dict(await this.readJson(joinPath(owner.folder, 'tables', `${id}.json`))) : {};
    const rows = list(data.rows).filter(Array.isArray) as unknown[][];
    const nCols = Math.max(0, ...rows.map((r) => r.length));
    if (!rows.length || !nCols) { this.notes.push(`${where}: a table could not be found or is empty (tables/${id}.json); left out.`); return; }
    const look: RunStyle = { ...this.b.styleLook({}), size: 10 };
    const cols = list(data.columns).map(String);
    const cells: TableCell[][] = rows.map((row) => Array.from({ length: nCols }, (_, k) => {
      const c = row[k];
      if (c === null || c === undefined) return { runs: [] };
      const cd = typeof c === 'string' ? { text: c } : dict(c);
      if (str(cd.image)) this.notes.push(`${where}: a picture in a table cell is not placed yet (left out).`);
      const cell: TableCell = { runs: this.cellRuns(str(cd.text), where, look) };
      const span = Math.round(Number(cd.colspan) || 1), rowSpan = Math.round(Number(cd.rowspan) || 1);
      if (span > 1) cell.span = span;
      if (rowSpan > 1) cell.rowSpan = rowSpan;
      const a = str(cd.align);
      if (a === 'left' || a === 'center' || a === 'right') cell.align = a;
      return cell;
    }));
    const head = Math.max(0, Math.min(rows.length, Math.round(Number(data.header_rows ?? 1)) || 0));
    // the label and caption above, kept with the table
    this.caption(label || 'Table', caption, where, { align: align ?? 'center', keepNext: true, spaceAfter: 4 }, { key: id, kind: 'table' });
    const table: Extract<DocObject, { kind: 'table' }> = {
      kind: 'table',
      table: {
        cols: Array.from({ length: nCols }, () => Math.round((TEXT_W / nCols) * 100) / 100),
        rows: cells, head, lines: 'acs', size: 10, width: 'auto', autofit: true,
        align: Array.from({ length: nCols }, (_, k) => (['left', 'center', 'right'].includes(cols[k]) ? cols[k] : 'center') as Justify),
      },
    };
    this.b.table(table, this.full({ align: align ?? 'center' }));
    const notes = list(data.footnotes).map(str).filter((n) => n.trim());
    notes.forEach((n, i) => {
      const ps: ParaStyle = { align: 'left', spaceAfter: i === notes.length - 1 ? 12 : 0, ...(i < notes.length - 1 ? { keepNext: true } : {}) };
      const nl: RunStyle = { ...this.b.styleLook(ps), size: 9 };
      for (const r of this.cellRuns(n, where, nl)) this.b.text(r.text, r);
      this.b.endPara(this.full(ps));
    });
  }

  // -------------------------------------------------------------- the parts

  private async cover(): Promise<void> {
    const s = this.p.settings;
    const cover = dict(s.cover);
    const heading = str(cover.heading).trim() || COVER_HEADINGS[str(s.journal_style)] || 'Supporting Information';
    this.para([R(heading)], { align: 'center', spaceAfter: 14 }, 'Cover page', { size: 16, bold: true });
    this.para(this.chemistry([R(str(s.title))]), { align: 'center', spaceAfter: 14 }, 'Cover page', { size: 14, bold: true });
    const authors = list(s.authors).map(dict);
    const names: Run[][] = authors.map((a) => {
      const marks = list(a.affiliations).map(String).join(',') + (a.corresponding ? '*' : '');
      return [R(str(a.name)), ...(marks ? [R(marks, { valign: 'super' })] : [])];
    });
    const line: Run[] = [];
    names.forEach((n, i) => {
      if (i) line.push(R(i === names.length - 1 ? (names.length > 2 ? ', and ' : ' and ') : ', '));
      line.push(...n);
    });
    if (line.length) this.para(line, { align: 'center', spaceAfter: 8 }, 'Cover page');
    const affs = list(s.affiliations).map(dict);
    affs.forEach((a, i) => this.para([R(str(a.marker), { valign: 'super' }), R(str(a.text))], { align: 'center', spaceAfter: i === affs.length - 1 ? 6 : 0 }, 'Cover page', { size: 10 }));
    const emails = authors.filter((a) => a.corresponding && str(a.email)).map((a) => str(a.email));
    if (emails.length) this.para([R('*Email: ' + emails.join('; '))], { align: 'center', spaceAfter: 18 }, 'Cover page', { size: 10 });
    const extra = this.texts.get('cover') ?? '';
    if (extra.trim()) await this.richText(extra, 'Cover page', null, 1, 0);
  }

  private toc(): void {
    const toc = dict(this.p.settings.toc);
    const title = typeof toc.title === 'string' ? toc.title : 'Table of Contents';
    const style = this.plainStyle('SITocHeading', 'Contents Heading', { size: 13, bold: true, align: 'left', spaceBefore: 0, spaceAfter: 10, keepNext: true });
    this.b.pendingBreak = true;
    if (title.trim()) this.para([R(title)], { style }, 'Table of contents');
    this.b.object({ kind: 'toc', levels: 3 });
    this.b.endPara(this.full({}));
  }

  private async general(): Promise<boolean> {
    const text = this.texts.get('general') ?? '';
    if (!text.trim()) return false;
    const info = dict(this.p.settings.general_information);
    const title = info.heading === undefined ? 'General Information' : str(info.heading).trim();
    if (title) this.para([R(title)], { style: headingId(1) }, 'General Information');
    await this.richText(text, title || 'General Information', await this.owner('general'), 1, this.rank >= 2 ? 2 : 0);
    return true;
  }

  private sectionHeading(level: number, name: string): void {
    this.para([R(name)], { style: this.headingStyle(level, level === 1 || this.rank >= 2) }, name);
  }

  private async section(s: SiSection, level: number): Promise<void> {
    if (this.excluded.has(s.id)) return;
    if (s.type === 'spectra') {
      if (!this.excluded.has('spectra')) this.notes.push(`“${s.name}”: the spectra pages are not compiled into the document yet; left out for now.`);
      return;
    }
    if (s.type === 'text') {
      this.sectionHeading(level, s.name);
      await this.richText(this.texts.get(s.id) ?? '', s.name, await this.owner(s.id), level, this.rank >= 2 ? level + 1 : 0);
    } else if (s.type === 'file') await this.fileSection(s, level);
    else if (s.type === 'xray') {
      this.sectionHeading(level, s.name);
      this.notes.push(`X-ray structure “${s.name}”: X-ray structures are not compiled into the document yet; left out for now.`);
    } else if (s.type === 'data') await this.dataSection(s, level);
    for (const child of s.children) await this.section(child, level + 1);
  }

  private async fileSection(s: SiSection, level: number): Promise<void> {
    const heading = str(s.data.heading).trim();
    if (heading) this.sectionHeading(level, heading);
    const file = str(s.data.file);
    if (!file) { this.notes.push(`Attachment section “${s.name}” has no file attached.`); return; }
    const ok = await this.pictureBlock(joinPath(s.folder, file), { w: TEXT_W, h: ATTACHMENT_MAX_H }, `Attachment section “${s.name}”`);
    const caption = str(s.data.caption).trim();
    if (ok && caption) this.para([R(caption)], { align: 'center' }, s.name, { size: 10 });
  }

  private async dataSection(s: SiSection, level: number): Promise<void> {
    this.sectionHeading(level, s.name);
    for (const gp of this.p.generalProcedures(s)) {
      const name = str(gp.name).trim() || 'General Procedure';
      const title = str(gp.title).trim();
      this.para(this.chemistry([R(name + (title ? `: ${title}` : ''))]), { style: this.headingStyle(level + 1, this.rank >= 3) }, `${s.name} ▸ ${name}`);
      const text = await this.p.readGpText(s, str(gp.id));
      if (!text.trim()) this.notes.push(`“${name}” in “${s.name}” has no text yet.`);
      await this.richText(text, `${s.name} ▸ ${name}`, null, level + 1, 0, false);
    }
    for (const item of s.items) {
      if (item.kind === 'scheme') {
        this.notes.push(`${s.name} ▸ scheme “${str(item.data.name) || 'Scheme'}”: schemes are not drawn in the document yet; its compounds are printed with their own structures.`);
        const label = this.labels.byId.get(item.id);
        if (label) this.targets.push({ key: item.id, kind: 'scheme', label, caption: str(item.data.name), mark: '' });
        for (const c of item.children) await this.compound(c, level + 1);
      } else await this.compound(item, level + 1);
      for (const x of item.kind === 'compound' ? this.p.anchored.get(item.id) ?? [] : []) {
        if (!this.excluded.has(x.id)) this.notes.push(`X-ray structure “${x.name}”: X-ray structures are not compiled into the document yet; left out for now.`);
      }
    }
  }

  private async compound(c: SiCompound, level: number): Promise<void> {
    const id = displayId(this.report, c.id);
    const name = compoundName(c);
    const where = name ? `${id} (${name})` : id;
    const facts = this.facts.get(c.id) ?? null;
    const block = compoundBlock(this.p, c, id, { facts, helpers: this.helpers, leave: this.leave });
    this.para(block.title, { style: this.compoundStyle(level, this.rank >= 4), marks: [compoundBookmark(c.id)] }, where);
    this.targets.push({ key: c.id, kind: 'compound', label: id, caption: name, mark: compoundBookmark(c.id) });
    await this.structure(c, where);
    if (!block.customText) {
      const problems: string[] = [];
      gpSentence(this.p, c, problems);
      for (const x of problems) this.notes.push(`${where}: general procedure sentence has ${x}; printed in [brackets].`);
      const choice = dict(valuesOf(c).procedure);
      if (str(choice.gp) && fieldKeys(c).includes('procedure') && !this.p.compoundGp(c)) this.notes.push(`${where}: its general procedure no longer exists; the “Prepared according to…” sentence was left out.`);
    }
    for (const x of block.paragraphs) {
      if (x.heading) this.para(x.runs, { style: this.headingStyle(x.heading + level, false) }, where);
      else this.para(x.runs, {}, where);
    }
    const figures = inlineFigures(c);
    for (let i = 0; i < figures.length; i++) {
      const f = figures[i];
      const def = fieldsOfCompound(c).find((d) => d.key === f.field);
      const ok = await this.pictureBlock(joinPath(c.folder, def?.subdir ?? 'files', f.file), { w: TEXT_W, h: 4 * PT }, where);
      if (ok) this.caption(this.labels.at(c.id, i) || 'Figure', [R(f.caption)], where, { align: 'center' }, { key: `${c.id}#${i}`, kind: 'figure' });
    }
    if (id === 'ID?') this.notes.push(`“${name || 'A compound'}” has no ID (printed as “ID?”).`);
  }

  private async structure(c: SiCompound, where: string): Promise<void> {
    const mol = this.p.hasStructure(c) ? await this.p.readStructure(c) : '';
    const contents = mol ? this.host.contentsOf(mol) : null;
    if (contents) {
      const size = this.host.sizeOf(contents);
      const scale = size && size.w > 0 && size.h > 0 ? Math.min(1, STRUCTURE_MAX.w / size.w, STRUCTURE_MAX.h / size.h) : 1;
      this.b.object({ kind: 'drawing', contents, ...(scale < 1 ? { scale: Math.round(scale * 1000) / 1000 } : {}) });
      this.b.endPara(this.full({ align: 'center', keepNext: true, spaceBefore: 2, spaceAfter: 8 }));
      return;
    }
    const picture = str(dict(valuesOf(c).structure).image_override);
    if (picture) await this.pictureBlock(joinPath(c.folder, picture), STRUCTURE_MAX, where);
    else if (mol) this.notes.push(`${where}: its structure could not be drawn; left out.`);
  }

  private references(): void {
    if (!this.cited) return;
    this.para([R('References')], { style: headingId(1), pageBreak: true }, 'References');
    this.b.object({ kind: 'bib' });
    this.b.endPara(this.full({}));
  }

  // -------------------------------------------------------------- the whole

  async build(): Promise<DocText> {
    await this.prepare();
    if (this.included('cover')) await this.cover();
    if (this.included('toc')) this.toc();
    let started = false;
    const startPage = (): void => { if (!started && (this.included('cover') || this.included('toc'))) this.b.pendingBreak = true; started = true; };
    if (this.included('general') && (this.texts.get('general') ?? '').trim()) { startPage(); await this.general(); }
    for (const s of this.p.top) { if (!this.excluded.has(s.id)) startPage(); await this.section(s, 1); }
    this.references();
    const title = str(this.p.settings.title);
    return this.b.finish({
      styles: this.styles,
      hf: { ...this.b.doc.hf, prefix: 'S', onFirst: false },
      references: this.p.references.map(toReference),
      props: { title: title || this.p.title },
      noFigureOffer: true,
    });
  }
}

const plainOf = (runs: Run[]): string => runs.map((r) => r.text).join('').trim();

const fieldsOfCompound = (c: SiCompound) => (Array.isArray(c.data.fields) ? (c.data.fields as Json[]) : []).map((e) => fieldDef(e)).filter((d): d is NonNullable<typeof d> => d !== null);

/** An SI reference (references.json) as the document's. */
function toReference(r: Json): Reference {
  const type = str(r.type) as RefType;
  return {
    id: str(r.id), type: REF_TYPES.has(type) ? type : 'article',
    authors: list(r.authors).map(String).filter(Boolean),
    title: str(r.title), journal: str(r.journal), year: str(r.year), volume: str(r.volume), issue: str(r.issue),
    pages: str(r.pages), doi: str(r.doi), url: str(r.url), publisher: str(r.publisher), note: str(r.note),
  };
}

/** The project's own words to print as written (dictionary.txt), lower case. */
async function dictionaryWords(p: SiProject): Promise<Set<string>> {
  const t = (await p.folder.readText('dictionary.txt')) ?? '';
  return new Set(t.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#')));
}

/** Compile an SI project into a document. */
export async function compileSi(p: SiProject, host: CompileHost): Promise<CompiledSi> {
  const c = new Compiler(p, host, await dictionaryWords(p));
  const doc = await c.build();
  return { doc, notes: [...new Set(c.notes)], targets: c.targets };
}

