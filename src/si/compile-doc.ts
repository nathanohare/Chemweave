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
import { OBJECT_CHAR, paraFromStyle, styleOf, type DocObject, type DocText, type NamedStyle } from '../document/document';
import { citeSuper, formatOf } from '../document/references';
import type { Reference, RefType } from '../document/references';
import type { Contents, Justify, ParaStyle, TableCell, TextRun } from '../model';
import type { RunStyle } from '../richtext';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { CITE, MENTION, parseMarkup, citationsOf, type Paragraph, type Run } from './markup';
import { fieldKeys, valuesOf, compoundName, compoundsOf, type Json, type SiCompound, type SiProject, type SiScheme, type SiSection } from './project';
import { displayId, type IdReport } from './compound-ids';
import { fieldDef, partText } from './fields';
import { mentionKind } from './checks';
import type { MolFacts } from './chem';
import { R, formatChemistry, formatNmr, scriptCharacters, type Leave } from './format';
import { compoundBlock, gpSentence, inlineFigures } from './blocks';
import { attachmentDir, captionText, CORNER_INSET, effective, GUTTERS, headerParts, HEADER_PT, listingLines, printKind, printsReports, reportItems, sectionDefaults, shownSize, slotSize, spectrumItems, structureSize, BOX_PAD as SI_BOX_PAD, type Crop, type SpectrumLayout } from './spectra';
import type { Float, PageSetup, SectionBreak } from '../document/document';
import { drawScheme, schemeLayout, type DrawBox, type DrawStep, type SchemeLayout } from './scheme-draw';

/** What compiling needs from the app: drawings made from molfiles, their sizes, and the structures' facts. */
export interface CompileHost {
  /** A molfile as a drawing (null when it can't be read). */
  contentsOf(molfile: string): Contents | null;
  /** A drawing's own size in points, in the document's drawing style. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** Formula and pieces of each structure (for the HRMS and elemental analysis sentences). */
  facts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** Each page of a PDF as a picture, with its size in points (null when it can't be read). Without it, PDFs are left out. */
  pdfPages?(bytes: Uint8Array): Promise<PagePicture[] | null>;
  /** Where the content of a picture is, for auto-crop (null: nothing to cut, or it can't be measured). */
  contentBox?(src: string): Promise<Crop | null>;
}

/** A page of a PDF drawn as a picture: its data URL, its size in points and in pixels. */
export interface PagePicture { src: string; w: number; h: number; px?: { w: number; h: number } }

export interface CompiledSi {
  doc: DocText;
  /** Things to know about the result (left out, missing, printed as "??"), in plain words. */
  notes: string[];
  /** What a manuscript can point at: each compound, table, figure and scheme, in the order printed. */
  targets: SiTarget[];
}

/**
 * Something in the compiled SI a manuscript can mention: a compound (its ID) or a table, figure or
 * scheme (its label). `mark` is the bookmark on its title or caption paragraph, which gives the
 * page it is on.
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
    // a section break waiting for the next paragraph (spectra pages turned landscape, and back)
    const end = this.b.endPara.bind(this.b);
    this.b.endPara = (ps: ParaStyle) => {
      const sec = this.pendingSection;
      this.pendingSection = null;
      end(sec ? { ...ps, section: sec } : ps);
    };
  }

  private pendingSection: SectionBreak | null = null;
  private landscape = false;
  private spectraDone = false;

  /** Turn the pages that follow (a section break before the next paragraph), when they aren't already. */
  private orient(o: 'portrait' | 'landscape'): void {
    if ((o === 'landscape') === this.landscape) return;
    this.landscape = o === 'landscape';
    const p = this.b.doc.page;
    // (its own header and footer, as the document's but numbered on its first page too: only the cover goes without)
    this.pendingSection = { kind: 'nextPage', page: this.landscape ? { ...p, w: p.h, h: p.w } : { ...p }, hf: { ...this.b.doc.hf, prefix: 'S', onFirst: true } };
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
    return this.schemeLayoutOf(k).show_label;
  }

  private schemeLayoutOf(k: SiScheme): SchemeLayout {
    return schemeLayout(dict(this.p.settings.schemes), dict(dict(k.data.editor).layout));
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
  private async richText(text: string, where: string, owner: Owner | null, offset: number, listedLevels: number, keepAlign = true, numberHeadings = false): Promise<void> {
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
        const num = numberHeadings ? this.numbered(level, true) : '';
        this.para(num ? [R(num), ...runs] : runs, { style: this.headingStyle(level, level <= listedLevels) }, where);
      } else {
        const align = keepAlign ? this.alignOf(p, false) : undefined;
        this.para(runs, align ? { align } : {}, where);
      }
    }
  }

  /** A label and its caption; with `target`, bookmarked and listed for manuscripts to point at. */
  private caption(label: string, runs: Run[], where: string, ps: ParaStyle, target?: { key: string; kind: 'table' | 'figure' | 'scheme' }): void {
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
    const pics = /\.pdf$/i.test(name) ? await this.pdfPictures(bytes, name, where, room, widthPt) : [pictureObject(name, bytes, room, widthPt)];
    if (!pics.length || !pics[0]) {
      if (!/\.pdf$/i.test(name)) this.notes.push(`${where}: ${name} could not be read as a picture${/\.tiff?$/i.test(name) ? ' (TIFF pictures are not placed in the document yet)' : ''}; left out.`);
      return false;
    }
    for (const pic of pics) {
      if (!pic) continue;
      this.b.object(pic);
      this.b.endPara(this.full({ align: align ?? 'center', keepNext: true, spaceAfter: 4 }));
    }
    return true;
  }

  /** A PDF's pages as pictures fitted to `room` (none when it can't be read, said in the notes). */
  private async pdfPictures(bytes: Uint8Array, name: string, where: string, room: { w: number; h: number }, widthPt?: number): Promise<Extract<DocObject, { kind: 'picture' }>[]> {
    const pages = this.host.pdfPages ? await this.host.pdfPages(bytes).catch(() => null) : null;
    if (!this.host.pdfPages) { this.notes.push(`${where}: ${name} is a PDF; PDFs are placed only in the desktop app and the web app (left out).`); return []; }
    if (!pages?.length) { this.notes.push(`${where}: ${unreadablePdf(name)}`); return []; }
    return pages.map((pg) => {
      let w = pg.w, h = pg.h;
      if (widthPt) { h *= widthPt / w; w = widthPt; }
      const k = Math.min(1, room.w / w, room.h / h);
      return { kind: 'picture' as const, src: pg.src, w: round2(w * k), h: round2(h * k), ...(pg.px ? { px: pg.px } : {}) };
    });
  }

  private async table(owner: Owner | null, id: string, label: string, caption: Run[], where: string, align?: Justify): Promise<void> {
    const data = owner ? dict(await this.readJson(joinPath(owner.folder, 'tables', `${id}.json`))) : {};
    const rows = list(data.rows).filter(Array.isArray) as unknown[][];
    const nCols = Math.max(0, ...rows.map((r) => r.length));
    if (!rows.length || !nCols) { this.notes.push(`${where}: a table could not be found or is empty (tables/${id}.json); left out.`); return; }
    const look: RunStyle = { ...this.b.styleLook({}), size: 10 };
    const cols = list(data.columns).map(String);
    // a cell's picture (Lauren's pictures in table cells, rewritten): above its text, at its own
    // size or the width typed for it (image_width, cm), never wider than the text
    const pictures = new Map<string, number>();
    for (const [r, row] of rows.entries()) for (const [k, c] of row.entries()) {
      const cd = c && typeof c === 'object' ? dict(c) : {};
      const image = str(cd.image);
      if (!image || !owner) continue;
      const bytes = await this.p.folder.readBytes(joinPath(owner.folder, image));
      const name = image.slice(image.lastIndexOf('/') + 1);
      if (!bytes) { this.notes.push(`${where}: the picture ${name} in a table cell is no longer in the project; left out.`); continue; }
      const widthCm = Number(cd.image_width) || 0;
      const pic = /\.pdf$/i.test(name) ? (await this.pdfPictures(bytes, name, where, { w: TEXT_W, h: FIGURE_MAX_H }, widthCm ? (widthCm / 2.54) * PT : undefined))[0] : pictureObject(name, bytes, { w: TEXT_W, h: FIGURE_MAX_H }, widthCm ? Math.min(TEXT_W, (widthCm / 2.54) * PT) : undefined);
      if (!pic) { if (!/\.pdf$/i.test(name)) this.notes.push(`${where}: the picture ${name} in a table cell could not be read; left out.`); continue; }
      pictures.set(`${r}:${k}`, this.b.reserve(pic));
    }
    const cells: TableCell[][] = rows.map((row, r) => Array.from({ length: nCols }, (_, k) => {
      const c = row[k];
      if (c === null || c === undefined) return { runs: [] };
      const cd = typeof c === 'string' ? { text: c } : dict(c);
      const text = this.cellRuns(str(cd.text), where, look);
      const picId = pictures.get(`${r}:${k}`);
      const cell: TableCell = { runs: picId !== undefined ? [{ ...look, obj: picId, text: OBJECT_CHAR }, ...(text.length ? [{ ...look, text: '\n' }, ...text] : [])] : text };
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
    // Cover page ▸ Spacing: Normal (1), More (2) or Much more (3) times the gaps between the parts
    const k = coverSpacing(s);
    const gap = (pt: number): number => Math.round(pt * k * 10) / 10;
    this.para([R(heading)], { align: 'center', spaceAfter: gap(14) }, 'Cover page', { size: 16, bold: true });
    this.para(this.chemistry([R(str(s.title))]), { align: 'center', spaceAfter: gap(14) }, 'Cover page', { size: 14, bold: true });
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
    if (line.length) this.para(line, { align: 'center', spaceAfter: gap(8) }, 'Cover page');
    const affs = list(s.affiliations).map(dict);
    affs.forEach((a, i) => this.para([R(str(a.marker), { valign: 'super' }), R(str(a.text))], { align: 'center', spaceAfter: i === affs.length - 1 ? gap(6) : 0 }, 'Cover page', { size: 10 }));
    const emails = authors.filter((a) => a.corresponding && str(a.email)).map((a) => str(a.email));
    if (emails.length) this.para([R('*Email: ' + emails.join('; '))], { align: 'center', spaceAfter: gap(18) }, 'Cover page', { size: 10 });
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
    if (title) this.para([R(this.numbered(1, true) + title)], { style: headingId(1) }, 'General Information');
    await this.richText(text, title || 'General Information', await this.owner('general'), 1, this.rank >= 2 ? 2 : 0, true, true);
    return true;
  }

  private sectionHeading(level: number, name: string, ps: ParaStyle = {}): void {
    this.para([R(this.numbered(level) + name)], { style: this.headingStyle(level, level === 1 || this.rank >= 2), ...ps }, name);
  }

  // ---------------------------------------------------------- heading numbers (Lauren's, rewritten)
  // Project settings ▸ Heading numbers: as the journal style does (Wiley and RSC number section
  // headings 1, 1.1, 1.1.1; ACS none), an outline (1, A, a, i), numbers (1, 1.1, 1.1.1) or none.
  // With an outline or numbers chosen, headings typed in a section's or General Information's
  // text and the General Information heading are numbered too. General procedure headings,
  // compound titles and headings in a compound's text never are. The numbers are written into
  // the headings, so the contents show them.

  private counters: number[] = [];
  private headingNumbers(): { kind: 'none' | 'decimal' | 'outline'; text: boolean } {
    const chosen = str(this.p.settings.heading_numbers);
    if (chosen === 'outline' || chosen === 'decimal') return { kind: chosen, text: true };
    if (chosen === 'none') return { kind: 'none', text: false };
    return { kind: ['Wiley', 'RSC'].includes(str(this.p.settings.journal_style)) ? 'decimal' : 'none', text: false };
  }

  /** The number for the next heading at `level` ("1.2. "), or '' when headings aren't numbered. `text`: a heading typed in a text (or General Information's). */
  private numbered(level: number, text = false): string {
    const hn = this.headingNumbers();
    if (hn.kind === 'none' || (text && !hn.text)) return '';
    const lv = Math.max(1, Math.min(9, level));
    while (this.counters.length < lv) this.counters.push(0);
    this.counters.length = lv;
    this.counters[lv - 1]++;
    if (hn.kind === 'decimal') return this.counters.join('.') + '. ';
    const n = this.counters[lv - 1];
    const own = [String(n), alpha(n).toUpperCase(), alpha(n), roman(n).toLowerCase()][Math.min(3, lv - 1)];
    return own + '. ';
  }

  private async section(s: SiSection, level: number): Promise<void> {
    if (this.excluded.has(s.id)) return;
    if (s.type === 'spectra') {
      if (this.excluded.has('spectra')) return;
      if (this.spectraDone) { this.notes.push(`“${s.name}”: a project has only one Spectra section; this one was left out.`); return; }
      this.spectraDone = true;
      await this.spectraSection(s, level);
      return;
    }
    if (s.type === 'text') {
      this.sectionHeading(level, s.name);
      await this.richText(this.texts.get(s.id) ?? '', s.name, await this.owner(s.id), level, this.rank >= 2 ? level + 1 : 0, true, true);
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
        const drawn = await this.scheme(item, s);
        for (const c of item.children) await this.compound(c, level + 1, drawn.has(c.id));
      } else await this.compound(item, level + 1);
      for (const x of item.kind === 'compound' ? this.p.anchored.get(item.id) ?? [] : []) {
        if (!this.excluded.has(x.id)) this.notes.push(`X-ray structure “${x.name}”: X-ray structures are not compiled into the document yet; left out for now.`);
      }
    }
  }

  private async compound(c: SiCompound, level: number, inScheme = false): Promise<void> {
    const id = displayId(this.report, c.id);
    const name = compoundName(c);
    const where = name ? `${id} (${name})` : id;
    const facts = this.facts.get(c.id) ?? null;
    const block = compoundBlock(this.p, c, id, { facts, helpers: this.helpers, leave: this.leave });
    this.para(block.title, { style: this.compoundStyle(level, this.rank >= 4), marks: [compoundBookmark(c.id)] }, where);
    this.targets.push({ key: c.id, kind: 'compound', label: id, caption: name, mark: compoundBookmark(c.id) });
    if (!inScheme) await this.structure(c, where);
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

  /**
   * A scheme page's scheme, drawn (SPEC §13n.4) as one editable drawing with its caption when its
   * Layout shows one; the compounds its boxes show, whose structures it prints, are returned.
   */
  private async scheme(k: SiScheme, s: SiSection): Promise<Set<string>> {
    const drawn = new Set<string>();
    const name = str(k.data.name) || 'Scheme';
    const where = `${s.name} ▸ scheme “${name}”`;
    const editor = dict(k.data.editor);
    if (k.data.mode !== 'editor' || !Object.keys(editor).length) {
      this.notes.push(`${where}: made from a pasted picture, which isn’t drawn here; open it in Chem SI Assistant’s scheme editor. Its compounds are printed with their own structures.`);
      return drawn;
    }
    const lay = this.schemeLayoutOf(k);
    let inline = false;
    const conditions = (t: unknown): TextRun[] => {
      const text = str(t);
      if (text.includes('@struct{')) inline = true;
      return this.cellRuns(text, where, {});
    };
    const box = async (b: Json): Promise<DrawBox | null> => {
      const cid = str(b.compound);
      const linked = cid ? k.children.find((c) => c.id === cid) : undefined;
      if (cid && !linked) this.notes.push(`${where}: a box shows a compound that is no longer on the scheme page; its own copy of the structure is drawn.`);
      let mol = '';
      if (linked && this.p.hasStructure(linked)) mol = await this.p.readStructure(linked);
      else if (str(b.structure)) mol = (await this.p.folder.readText(joinPath(k.folder, str(b.structure)))) ?? '';
      const contents = mol ? this.host.contentsOf(mol) : null;
      if (!contents) {
        if (str(b.picture) || (linked && str(dict(valuesOf(linked).structure).image_override))) this.notes.push(`${where}: a structure that is only a picture (no structure file) isn’t drawn in the scheme yet; left out.`);
        else if (mol) this.notes.push(`${where}: a structure could not be drawn; left out.`);
        else this.notes.push(`${where}: an empty box was left out.`);
        return null;
      }
      if (linked) drawn.add(linked.id);
      let label = this.cellRuns(str(b.label), where, { bold: true });
      if (!label.length && linked) label = [{ text: displayId(this.report, linked.id), bold: true }];
      let yieldText = '';
      if ('yield' in b) yieldText = str(b.yield).trim();
      else if (linked && fieldKeys(linked).includes('yield')) {
        const pct = partText(dict(valuesOf(linked).yield).percent).trim();
        if (pct) yieldText = `${pct}%`;
      }
      return { contents, label, yieldText, dx: Number(b.label_dx) || 0, dy: Number(b.label_dy) || 0 };
    };
    const starting: DrawBox[] = [];
    for (const b of list(editor.starting)) { const x = await box(dict(b)); if (x) starting.push(x); }
    const steps: DrawStep[] = [];
    for (const raw of list(editor.steps)) {
      const st = dict(raw);
      const products: DrawBox[] = [];
      for (const b of list(st.products)) { const x = await box(dict(b)); if (x) products.push(x); }
      if (!list(st.products).length) this.notes.push(`${where}: a step has no products.`);
      const align = (v: unknown) => (v === 'left' || v === 'center' || v === 'right' ? v : undefined);
      steps.push({ top: conditions(st.top), bottom: conditions(st.bottom), topAlign: align(st.top_align), bottomAlign: align(st.bottom_align), products });
    }
    if (inline) this.notes.push(`${where}: structures pasted into the conditions aren’t drawn in the scheme yet; left out.`);
    const got = drawScheme(starting, steps, lay, TEXT_W);
    if (!got) {
      this.notes.push(`${where}: it has no structures to draw; left out. Its compounds are printed with their own structures.`);
      drawn.clear();
      return drawn;
    }
    if (got.textPt < 6) this.notes.push(`${where}: its conditions print at only ${got.textPt.toFixed(1)} pt; make the scheme narrower or its text larger (Layout in Chem SI Assistant).`);
    const scale = Math.round(got.scale * 1000) / 1000;
    this.b.object({ kind: 'drawing', contents: got.contents, ...(scale !== 1 ? { scale } : {}), alt: name });
    const label = lay.show_label ? this.labels.byId.get(k.id) ?? '' : '';
    this.b.endPara(this.full({ align: 'center', keepNext: !!label, spaceBefore: 6, spaceAfter: label ? 2 : 10 }));
    if (label) this.caption(label, [R(name)], where, { align: 'center', spaceAfter: 10 }, { key: k.id, kind: 'scheme' });
    return drawn;
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

  // -------------------------------------------------------------- spectra (SPEC §13k.12)

  /** The compounds of the Data sections in `sections` (and below) that are printed, in tree order. */
  private includedCompounds(sections: readonly SiSection[]): SiCompound[] {
    const out: SiCompound[] = [];
    for (const s of sections) {
      if (this.excluded.has(s.id)) continue;
      if (s.type === 'data') out.push(...compoundsOf(s));
      out.push(...this.includedCompounds(s.children));
    }
    return out;
  }

  /**
   * The Spectra section: each compound's spectra, page by page, set out as the section's defaults
   * and each spectrum's own settings say (1, 2 or 4 to a page, portrait or landscape), each with
   * its header line and the compound's structure + ID on a box over it; then the HRMS reports.
   * Everything on a spectra page floats at its place, so it can be moved and stays editable.
   */
  private async spectraSection(s: SiSection | null, level: number): Promise<void> {
    const defaults = sectionDefaults(s, this.p.settings);
    const compounds = this.includedCompounds(this.p.top);
    const name = s?.name ?? 'Spectra';
    type Entry = { c: SiCompound; item: Json; page: PagePicture; pageNo: number; eff: SpectrumLayout };
    const entries: Entry[] = [];
    for (const c of compounds) {
      for (const [key, item] of spectrumItems(c)) {
        const file = partText(item.file);
        if (!file) continue;
        const where = `${displayId(this.report, c.id)} ▸ ${key === 'spectra' ? 'Spectra' : 'Additional files'}`;
        const bytes = await this.p.folder.readBytes(joinPath(c.folder, attachmentDir(c, key), file));
        if (!bytes) { this.notes.push(`${where}: ${file} is no longer in the project; left out.`); continue; }
        let pages: PagePicture[] = [];
        if (/\.pdf$/i.test(file)) {
          if (!this.host.pdfPages) { this.notes.push(`${where}: ${file} is a PDF; PDFs are placed only in the desktop app and the web app (left out).`); continue; }
          pages = (await this.host.pdfPages(bytes).catch(() => null)) ?? [];
          if (!pages.length) { this.notes.push(`${where}: ${unreadablePdf(file)}`); continue; }
        } else {
          const pic = pictureObject(file, bytes, { w: 1e6, h: 1e6 });
          if (!pic) { this.notes.push(`${where}: ${file} could not be read as a picture${/\.tiff?$/i.test(file) ? ' (TIFF pictures are not placed in the document yet)' : ''}; left out.`); continue; }
          pages = [{ src: pic.src, w: pic.w, h: pic.h, ...(pic.px ? { px: pic.px } : {}) }];
        }
        pages.forEach((page, i) => entries.push({ c, item, page, pageNo: i + 1, eff: effective(defaults, item, String(i + 1)) }));
      }
    }
    // pages: a spectrum that needs another layout (number to a page, orientation) starts a new page
    const pages: { orientation: SpectrumLayout['orientation']; per: number; slots: Entry[] }[] = [];
    for (const e of entries) {
      const last = pages[pages.length - 1];
      if (!last || last.orientation !== e.eff.orientation || last.per !== e.eff.per_page || last.slots.length >= last.per) pages.push({ orientation: e.eff.orientation, per: e.eff.per_page, slots: [] });
      pages[pages.length - 1].slots.push(e);
    }
    const hrms = this.excluded.has('hrms_reports') ? [] : compounds.filter((c) => printsReports(c, defaults));
    if (!pages.length && !hrms.length) return;
    let headed = false;
    for (const pg of pages) {
      this.orient(pg.orientation);
      const page = this.landscape ? { ...this.b.doc.page, w: this.b.doc.page.h, h: this.b.doc.page.w } : this.b.doc.page;
      let top = 0;
      if (!headed) {
        this.sectionHeading(level, name, { pageBreak: true });
        headed = true;
        top = HEADING_ROOM;
      } else this.b.pendingBreak = true;
      await this.spectraPage(pg.slots, pg.per, page, top);
    }
    if (hrms.length) await this.hrmsReports(hrms, level + 1, name, !headed, level);
  }

  /** One page of spectra: an empty paragraph that anchors them, and each slot floating at its place. */
  private async spectraPage(slots: { c: SiCompound; item: Json; page: PagePicture; pageNo: number; eff: SpectrumLayout }[], per: number, page: PageSetup, top: number): Promise<void> {
    const bw = page.w - page.left - page.right, bh = page.h - page.top - page.bottom - top - 2;
    const slot = slotSize(bw, bh, per, this.landscape);
    const [cols] = per === 4 ? [2] : per === 2 && this.landscape ? [2] : [1];
    const floats: DocObject[] = [];
    let z = 1;
    for (let i = 0; i < slots.length; i++) {
      const { c, item, page: pic, pageNo, eff } = slots[i];
      const col = i % cols, row = Math.floor(i / cols);
      const sx = col * (slot.w + GUTTERS[0]), sy = row * (slot.h + GUTTERS[1]);
      const id = displayId(this.report, c.id);
      let headH = 0;
      if (eff.header_line) {
        const runs = this.helpers ? formatNmr(headerParts(c, item, id, pageNo).map((t) => R(t)), this.leave) : headerParts(c, item, id, pageNo).map((t) => R(t));
        headH = HEADER_PT * 1.25 + 2 * 3.6 + 3;
        floats.push({ kind: 'textbox', runs: textRuns(runs, { bold: true, size: HEADER_PT }), paras: [{ align: 'center' }], w: slot.w, float: this.at(sx, sy, z++, `Header ${id}`) });
      }
      const crop = eff.auto_crop && this.host.contentBox ? await this.host.contentBox(pic.src).catch(() => null) : null;
      const shown = shownSize({ w: slot.w, h: Math.max(10, slot.h - headH) }, pic.h / pic.w, crop);
      const px = sx + (slot.w - shown.w) / 2, py = sy + headH;
      floats.push({
        kind: 'picture', src: pic.src, w: round2(shown.w), h: round2(shown.h), ...(pic.px ? { px: pic.px } : {}),
        ...(crop ? { crop: { l: crop[0], t: crop[1], r: 1 - crop[2], b: 1 - crop[3] } } : {}),
        ...(eff.spectrum_frame ? { look: { frame: eff.spectrum_frame_width, frameColor: eff.spectrum_frame_color } } : {}),
        alt: headerParts(c, item, id, pageNo).join(''), float: this.at(px, py, z++, `Spectrum ${id}`),
      });
      if (eff.struct_box) floats.push(...(await this.structureBox(c, item, eff, { x: px, y: py, w: shown.w, h: shown.h }, () => z++)));
    }
    // the anchor: an empty paragraph as tall as the page's body, so the next page starts after it
    for (const f of floats) this.b.object(f);
    this.b.endPara(this.full({ spaceAfter: 0, spaceBefore: 0, linePt: Math.max(12, Math.floor(bh - 6)), lineRule: 'exact' }));
  }

  /** A float at (x, y) from the margin and the anchor paragraph, in front of the text. */
  private at(x: number, y: number, z: number, name: string): Float {
    return { wrap: 'front', x: round2(x), y: round2(y), xFrom: 'margin', yFrom: 'para', gap: 0, z, name };
  }

  /** The compound's structure, ID and caption on a box over a spectrum (in its corner, or where it was dragged). */
  private async structureBox(c: SiCompound, item: Json, eff: SpectrumLayout, spec: { x: number; y: number; w: number; h: number }, z: () => number): Promise<DocObject[]> {
    const mol = this.p.hasStructure(c) ? await this.p.readStructure(c) : '';
    const contents = mol ? this.host.contentsOf(mol) : null;
    const own = contents ? this.host.sizeOf(contents) : null;
    const size = contents ? structureSize(own, eff.struct_scale) : { w: 0, h: 0 };
    const id = displayId(this.report, c.id);
    const idSize = eff.id_size > 0 ? eff.id_size : 11;
    const caption = eff.caption ? captionText(c, item) : '';
    const capRuns = caption ? (this.helpers ? formatNmr([R(caption)], this.leave) : [R(caption)]) : [];
    const textW = Math.max(id.length * idSize * 0.6, caption.length * eff.caption_size * 0.5);
    const w = Math.max(size.w, textW) + 2 * SI_BOX_PAD + 2 * 7.2;
    const h = size.h + idSize * 1.2 + (caption ? eff.caption_size * 1.2 : 0) + 2 * SI_BOX_PAD + 2 * 3.6;
    let bx: number, by: number;
    if (eff.x !== undefined && eff.y !== undefined) { bx = spec.x + eff.x * spec.w - w / 2; by = spec.y + eff.y * spec.h - h / 2; }
    else {
      bx = eff.corner.endsWith('right') ? spec.x + spec.w - CORNER_INSET - w : spec.x + CORNER_INSET;
      by = eff.corner.startsWith('bottom') ? spec.y + spec.h - CORNER_INSET - h : spec.y + CORNER_INSET;
    }
    // the box (its background and frame), the structure on it, and the ID and caption under the structure
    const out: DocObject[] = [{
      kind: 'textbox', runs: [], w: round2(w), h: round2(h), fill: eff.struct_bg,
      ...(eff.struct_frame ? { look: { frame: eff.struct_frame_width, frameColor: eff.struct_frame_color } } : {}),
      float: this.at(bx, by, z(), `Structure box ${id}`),
    }];
    const runs: TextRun[] = [...textRuns([R(id)], { bold: eff.id_bold || undefined, size: idSize })];
    const paras: ParaStyle[] = [{ align: 'center', spaceBefore: 0, spaceAfter: 0 }];
    if (caption) { runs.push({ text: '\n' }, ...textRuns(capRuns, { size: eff.caption_size })); paras.push({ align: 'center', spaceAfter: 0 }); }
    out.push({ kind: 'textbox', runs, paras, w: round2(w), float: this.at(bx, by + SI_BOX_PAD + size.h, z(), `Compound ID ${id}`) });
    if (contents) {
      const scale = own && own.w > 0 ? size.w / own.w : 1;
      out.push({ kind: 'drawing', contents, ...(Math.abs(scale - 1) > 1e-3 ? { scale: Math.round(scale * 1000) / 1000 } : {}), float: this.at(bx + (w - size.w) / 2, by + SI_BOX_PAD, z(), `Structure ${id}`) });
    } else if (mol) this.notes.push(`${id}: its structure could not be drawn on its spectra; left out.`);
    return out;
  }

  /** The HRMS reports sub-section (§13n.3): each compound's report files, compound by compound. */
  private async hrmsReports(compounds: SiCompound[], level: number, sectionName: string, withSection: boolean, sectionLevel: number): Promise<void> {
    this.orient('portrait');
    if (withSection) this.sectionHeading(sectionLevel, sectionName, { pageBreak: true });
    this.para([R(this.numbered(level) + 'HRMS reports')], { style: this.headingStyle(level, this.rank >= 2), ...(withSection ? {} : { pageBreak: true }) }, 'HRMS reports');
    const room = { w: TEXT_W, h: 7.4 * PT };
    for (const c of compounds) {
      const id = displayId(this.report, c.id);
      for (const r of reportItems(c)) {
        const file = String(r.file);
        const where = `${id} ▸ HRMS`;
        const kind = printKind(file);
        if (kind === 'none') { this.notes.push(`${where}: the HRMS report ${file} can't be printed (raw data or a kind of file that can't be shown); left out.`); continue; }
        const bytes = await this.p.folder.readBytes(joinPath(c.folder, 'hrms', file));
        if (!bytes) { this.notes.push(`${where}: the HRMS report ${file} is missing; left out.`); continue; }
        const title = (more = ''): void => this.para([R(id, { bold: true }), R(` — HRMS report: ${file}${more}`)], { keepNext: true, spaceBefore: 14, spaceAfter: 6 }, where);
        if (kind === 'peaks') { title(); this.para([R('The peaks of this data file are not listed in the document yet; the file is kept in the project folder.', { italic: true })], {}, where, { size: 9 }); this.notes.push(`${where}: ${file} is a data file; its table of peaks is not made in the document yet.`); continue; }
        if (kind === 'pdf') {
          const pics = await this.pdfPictures(bytes, file, where, room);
          pics.forEach((pic, i) => {
            if (i > 0 || pics.length > 1) this.b.pendingBreak = true;
            title(pics.length > 1 ? ` (page ${i + 1} of ${pics.length})` : '');
            this.b.object(pic);
            this.b.endPara(this.full({ align: 'center' }));
          });
          continue;
        }
        if (kind === 'picture') {
          const pic = pictureObject(file, bytes, room);
          if (!pic) { this.notes.push(`${where}: ${file} could not be read as a picture; left out.`); continue; }
          title();
          this.b.object(pic);
          this.b.endPara(this.full({ align: 'center' }));
          continue;
        }
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        const [lines, left] = listingLines(text);
        title();
        lines.forEach((l) => { this.b.text(l || ' ', { font: 'Courier New', size: 7 }); this.b.endPara(this.full({ spaceAfter: 0, keepNext: false })); });
        if (left) this.para([R(`… ${left} more line${left === 1 ? '' : 's'} not printed (the whole file is kept in the project folder).`, { italic: true })], {}, where, { size: 8 });
      }
    }
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
    // a project without a Spectra section (opened read-only, older) prints its spectra at the end
    if (!this.spectraDone && !this.excluded.has('spectra') && !this.p.sections.some((s) => s.type === 'spectra')) { this.spectraDone = true; await this.spectraSection(null, 1); }
    this.orient('portrait');
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

/** The cover page's spacing: Normal 1, More 2, Much more 3, or a number typed into project.json (0.5–6). */
export const COVER_SPACINGS: Record<string, number> = { Normal: 1, More: 2, 'Much more': 3 };
export function coverSpacing(settings: Json): number {
  const v = Number(dict(settings.cover).spacing);
  return Number.isFinite(v) && v > 0 ? Math.min(6, Math.max(0.5, v)) : 1;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The room the Spectra section's heading takes at the top of its first page (points). */
const HEADING_ROOM = 34;

/** What is said when a PDF can't be opened (SI Assistant's words). */
const unreadablePdf = (name: string): string => `${name} could not be opened as a PDF (it may be damaged, password-protected or not really a PDF). Export it again and replace it on the compound page; left out.`;

/** Runs as a text box's text, in `look`. */
function textRuns(runs: Run[], look: RunStyle): TextRun[] {
  return runs.map((r) => {
    const l: TextRun = { text: r.text, ...look };
    if (r.bold) l.bold = true;
    if (r.italic) l.italic = true;
    if (r.underline) l.underline = true;
    if (r.valign === 'sub') l.sub = true;
    if (r.valign === 'super') l.sup = true;
    for (const k of Object.keys(l) as (keyof TextRun)[]) if (l[k] === undefined) delete l[k];
    return l;
  });
}

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

