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

import { dictionaryWords } from './dictionary';
import { DocBuilder, headingId } from '../io/doc-build';
import { OBJECT_CHAR, paraFromStyle, styleOf, type DocObject, type DocText, type NamedStyle } from '../document/document';
import { citeSuper, formatOf } from '../document/references';
import type { Reference, RefType } from '../document/references';
import type { Contents, Justify, ParaFramePlace, ParaStyle, TableCell, TextRun } from '../model';
import type { RunStyle } from '../richtext';
import { LINK_COLOUR } from '../links';
import { bookmarksOf } from '../document/bookmarks';
import { dataUrl, imageSize, pictureMime } from '../render/images';
import { CITE, MENTION, parseMarkup, citationsOf, type Paragraph, type Run } from './markup';
import { fieldKeys, valuesOf, compoundName, compoundsOf, type Json, type SiCompound, type SiProject, type SiScheme, type SiSection } from './project';
import { displayId, type IdReport } from './compound-ids';
import { fieldDef, partText } from './fields';
import { hrmsCalc, hrmsSpecies, hrmsTolerance, mentionKind } from './checks';
import { formatMz, listingFailed, peaksNear, reportListing, summary, type ReportData } from './ms-reports';
import { readReportFile } from './report-files';
import type { MolFacts } from './chem';
import { R, formatChemistry, formatNmr, scriptCharacters, type Leave } from './format';
import { compoundBlock, gpSentence, inlineFigures } from './blocks';
import { attachmentDir, autoPlace, boxSpot, cropInk, roomBeside, PLACE_GAP, captionText, effective, nmrNucleus, idSizeOf, structureBoxAt, structureBoxSize, GUTTERS, headerParts, HEADER_PT, printKind, printsReports, reportItems, sectionDefaults, shownSize, slotSize, spectrumItems, structureSize, BOX_PAD as SI_BOX_PAD, type Crop, type InkMap, type SpectrumLayout } from './spectra';
import type { Float, PageSetup, SectionBreak } from '../document/document';
import { xrayAutoCaption, xrayBlock, xrayCompound, xrayDrawing, xrayTableCaption, xrayTableRows } from './xray';
import { crystalTable } from '../chem/crystal';
import { newPlate, putPlate } from '../design/plates';
import { POINTS } from '../editor/arrange';
import { Doc } from '../model';
import { drawScheme, schemeLayout, type DrawBox, type DrawStep, type SchemeLayout } from './scheme-draw';
import { inlineIds, inlineMol } from './scheme-edit';
import { headerFooter, pageLookOn, pageOf } from './page-setup';
import { siDrawingStyle } from './drawing-style';
import { countText, headingFormat, headingNumber, type CountStyle } from './heading-format';
import { coverGaps, tocLists, type TocLists } from './front-layout';
import { TITLE_SRC, frontSrc, gpSrc, sectionSrc, tag, type SourceBlock, type SourceSpan } from './source-map';
import { CUSTOM_TEXT_FILE, placeCustomText, readCustomTextForCompile, type PlacedCustom } from './custom-text';
import { addFlagComments } from './flag-comments';
import { applyPreviewFormats, PREVIEW_FORMAT_FILE, readPreviewFormatsForCompile } from './preview-format';
import { siTableData } from './table-format';
import { applyStyleLooks, readStyleLooks, SI_COMPOUND_LOOK, SI_TOC_HEADING_LOOK, type StyleLooks } from './si-styles';
import { figureFrame, figureKey, floatOf as placedFloat, placementOf, structureKey, type Placement } from './placement';

/** What compiling needs from the app: drawings made from molfiles, their sizes, and the structures' facts. */
export interface CompileHost {
  /** A molfile as a drawing (null when it can't be read). */
  contentsOf(molfile: string): Contents | null;
  /** A drawing's own size in points, in the document's drawing style. */
  sizeOf(c: Contents): { w: number; h: number } | null;
  /** Formula and pieces of each structure (for the HRMS and elemental analysis sentences). */
  facts(mols: string[]): Promise<(MolFacts | null)[]>;
  /** Each page of a PDF (or only its first `most`) as a picture, with its size in points (null when it can't be read). Without it, PDFs are left out. */
  pdfPages?(bytes: Uint8Array, most?: number): Promise<PagePicture[] | null>;
  /** Where the content of a picture is, for auto-crop (null: nothing to cut, or it can't be measured). */
  contentBox?(src: string): Promise<Crop | null>;
  /** Where a picture has ink, for a structure box placed on blank paper (auto placement); without it, such a box goes above the spectrum. */
  inkMap?(src: string): Promise<InkMap | null>;
  /** How far along the compile is (Compile's progress window): `done` of `total` compounds, then spectra. A rejection stops the compile. */
  progress?(done: number, total: number, text: string): Promise<void>;
}

/** A page of a PDF drawn as a picture: its data URL, its size in points and in pixels, and how many pages the PDF has. */
export interface PagePicture { src: string; w: number; h: number; px?: { w: number; h: number }; of?: number }

export interface CompiledSi {
  doc: DocText;
  /** Where each stretch of the document's text came from (source-map.ts), for the Live Preview. */
  sources: SourceSpan[];
  /** Where each page of the project's tree (the front pages, a section, a scheme page, a compound) is in the document. */
  blocks: SourceBlock[];
  /** Where the text typed in the Live Preview where no field is went (custom-text.ts). */
  custom: PlacedCustom[];
  /** Things to know about the result (left out, missing, printed as "??"), in plain words. */
  notes: string[];
  /** What a manuscript can point at: each compound, table, figure and scheme, in the order printed. */
  targets: SiTarget[];
  /** Each compound's structure in the document (its object), for the Live Preview to pick it and change where it goes. */
  structures: SiStructureRef[];
}

/** A compound's structure in the compiled SI: the document's object showing it. */
export interface SiStructureRef {
  obj: number;
  /** Its key among the own choices of placement/Wrap Text (si/placement.ts: c: a compound's structure, f: a figure). */
  key: string;
  /** The compound, for a compound's structure. */
  compound?: string;
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

export const COVER_HEADINGS: Record<string, string> = { ACS: 'Supporting Information', Wiley: 'Supporting Information', RSC: 'Electronic Supplementary Information' };
const LABEL_KINDS = ['figure', 'table', 'scheme'] as const;
type LabelKind = (typeof LABEL_KINDS)[number];
const REF_TYPES = new Set<RefType>(['article', 'book', 'chapter', 'thesis', 'web', 'misc']);

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => partText(v);
const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');

/** A bookmark name for a compound's block (letters, digits and _ as Word wants, starting with a letter). */
export const compoundBookmark = (compoundId: string): string => siMark(compoundId);

/** The bookmark a peak report's "¹H NMR" links to: on the page with the compound's first spectrum of that nucleus. */
export const spectrumMark = (compoundId: string, nucleus: string): string => siMark(`nmr_${nucleus}_${compoundId}`);

/** The bookmark on a compound's title or a caption in the compiled SI (si_ and its key, as Word wants names). */
export const siMark = (key: string): string => `si_${key.replace(/[^A-Za-z0-9]/g, '_')}`.slice(0, 40);

// ---------------------------------------------------------------- labels (core/labels.py)

const formatNumber = (n: number, style: string): string => countText(n, (['I', 'i', 'a', 'A'].includes(style) ? style : '1') as CountStyle);

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
  /** The numbered label each object would get without a typed one ("Table S3"). */
  readonly autoById = new Map<string, string>();
  readonly byPlace = new Map<string, string>();
  constructor(private rules: ReturnType<typeof labelRules>) {}
  add(kind: LabelKind, id: string, owner: string, index: number, custom: string): void {
    const rule = this.rules[kind];
    const n = ++this.counters[kind];
    const number = rule.prefix + formatNumber(n, rule.style);
    const auto = rule.word ? `${rule.word} ${number}` : number;
    const label = custom.trim() || auto;
    if (id && !this.byId.has(id)) { this.byId.set(id, label); this.autoById.set(id, auto); }
    this.byPlace.set(`${owner}#${index}`, label);
  }
  at(owner: string, index: number): string { return this.byPlace.get(`${owner}#${index}`) ?? ''; }
}

/** A text's figure and table paragraphs: (kind, id), in order. */
type TextObject = { kind: 'figure' | 'table'; id: string };
const objectsOfText = new Map<string, TextObject[]>();
/** (Worked out once for each text: labels are worked out each time a page is shown.) */
function textObjects(text: string): TextObject[] {
  let got = objectsOfText.get(text);
  if (!got) {
    got = parseMarkup(text).flatMap((p): TextObject[] => (p.table ? [{ kind: 'table', id: p.table }] : p.figure ? [{ kind: 'figure', id: p.figure }] : p.image ? [{ kind: 'figure', id: '' }] : []));
    if (objectsOfText.size >= 200) objectsOfText.delete(objectsOfText.keys().next().value!);
    objectsOfText.set(text, got);
  }
  return got;
}

// ---------------------------------------------------------------- pictures

/** Dots per inch a PNG or JPEG says it was made at (null when it doesn't say). */
export function pictureDpi(b: Uint8Array, mime: string): number | null {
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
  /** Project Settings ▸ Styles ▸ Caption: its alignment and space after win over the captions' own (a figure's own alignment still wins). */
  private captionLook: StyleLooks[string] = {};
  /** The width and height of the text on an upright page (the page's less its margins). */
  private readonly uprightW: number = TEXT_W;
  private readonly uprightH: number = 9 * PT;
  /** The width of the text (the page's less its margins, on its side on a landscape page): what pictures, tables and schemes fit in. */
  private get textW(): number { return this.landscape ? this.sidewaysW : this.uprightW; }
  /** The height of the text: no picture is made taller than fits (its caption below it still needs room). */
  private get textH(): number { return this.landscape ? this.sidewaysH : this.uprightH; }
  private get sidewaysW(): number { const p = this.b.doc.page; return Math.max(2 * PT, p.h - p.left - p.right); }
  private get sidewaysH(): number { const p = this.b.doc.page; return Math.max(2 * PT, p.w - p.top - p.bottom); }
  private tallest(h: number): number { return Math.max(PT, Math.min(h, this.textH - 0.6 * PT)); }
  readonly sources: SourceSpan[] = [];
  readonly blocks: SourceBlock[] = [];
  readonly notes: string[] = [];
  readonly targets: SiTarget[] = [];
  private readonly styles: Record<string, NamedStyle>;
  private readonly report: IdReport;
  readonly labels: Labels;
  /** The kinds of heading the table of contents lists (Table of contents ▸ Lists). */
  private readonly lists: TocLists;
  private readonly excluded: Set<string>;
  private readonly leave: Leave;
  private readonly helpers: boolean;
  private readonly knownRefs: Set<string>;
  private facts = new Map<string, MolFacts | null>();
  private texts = new Map<string, string>();
  private cited = false;
  /** Citations are raised, as the document's citation style (ACS) has them. */
  private readonly citeSup = citeSuper(formatOf({}));

  constructor(readonly p: SiProject, readonly host: CompileHost, words: Set<string>, styleLooks: StyleLooks = {}) {
    // Project Settings ▸ Page: the paper and margins
    this.b.doc.page = pageOf(p.settings, this.b.doc.page);
    // Layout ▸ Watermark and Hyphenation
    pageLookOn(this.b.doc, p.settings);
    // Project Settings ▸ Styles, before the SI's own styles are made from Normal and the headings (and again after: si-styles.ts)
    applyStyleLooks(this.b.doc.styles, styleLooks);
    this.captionLook = styleLooks.Caption ?? {};
    this.uprightW = Math.max(2 * PT, this.b.doc.page.w - this.b.doc.page.left - this.b.doc.page.right);
    this.uprightH = Math.max(2 * PT, this.b.doc.page.h - this.b.doc.page.top - this.b.doc.page.bottom);
    this.styles = this.b.doc.styles;
    this.report = p.idReport();
    this.labels = new Labels(labelRules(p.settings));
    this.lists = tocLists(p.settings);
    this.excluded = new Set(list(p.settings.export_excluded).map(String));
    this.leave = { words };
    this.helpers = p.settings.format_text !== false;
    // links from the peak reports to the spectra and back (SPEC §13l.7): the Spectra section's
    // settings (a project without one has none), in the look it asks for
    const spectra = p.sections.find((s) => s.type === 'spectra');
    const links = spectra ? sectionDefaults(spectra, p.settings) : null;
    this.nmrLinks = !!links?.nmr_links;
    // (each kind on its own: Chemweave lets the header lines link back without the peak reports' links)
    this.linkBack = !!links?.link_back;
    const color = links?.link_color || LINK_COLOUR;
    this.linkLook = links?.link_style === 'blue' ? { color } : links?.link_style === 'blue_underline' ? { color, underline: true } : {};
    this.knownRefs = new Set(p.references.map((r) => str(r.id)));
    // a section break waiting for the next paragraph (spectra pages turned landscape, and back)
    const end = this.b.endPara.bind(this.b);
    this.b.endPara = (ps: ParaStyle) => {
      const sec = this.pendingSection;
      this.pendingSection = null;
      end(sec ? { ...ps, section: sec } : ps);
    };
  }

  private nmrLinks = false;
  /** The spectra's bookmarks put in so far (each only once). */
  private placedMarks = new Set<string>();
  private linkBack = false;
  /** How the links look (Spectra section ▸ Link look): like the text, blue, or blue and underlined. */
  private linkLook: RunStyle = {};

  private pendingSection: SectionBreak | null = null;
  /** A compound's structure floating from the next paragraph (its first line below the title), put there with its text. */
  private pendingFloat: { o: DocObject; compound: string } | null = null;
  /** The next paragraph starts below the structure floating beside the text before it. */
  private clearNext = false;
  /** A figure floats with its caption above: the next heading, figure or table starts below it. */
  private clearAtBlock = false;
  /** How many pages the last PDF read for a picture has. */
  private pdfPageCount: number | null = null;
  readonly structures: SiStructureRef[] = [];
  /** Groups of floating figures made so far (each spectrum's structure box is one). */
  private groups = 0;
  private landscape = false;
  private spectraDone = false;
  /** Compiling one page for the live preview (PDFs show their first page). */
  private preview = false;
  /** Compiling the whole SI for the live preview (every page of a PDF, as Compile prints it). */
  private whole = false;

  /** Turn the pages that follow (a section break before the next paragraph), when they aren't already. */
  private orient(o: 'portrait' | 'landscape'): void {
    if ((o === 'landscape') === this.landscape) return;
    this.landscape = o === 'landscape';
    // (turned and turned back with no paragraph between: no break at all)
    if (this.pendingSection) { this.pendingSection = null; return; }
    const p = this.b.doc.page;
    const page = this.landscape ? { ...p, w: p.h, h: p.w } : { ...p };
    // (its own header and footer, as the document's but on its first page too: only the cover goes without)
    const { hf, format } = this.pageLines(page.w - page.left - page.right, true);
    this.pendingSection = { kind: 'nextPage', page, hf, format };
  }

  /**
   * The header and footer of Project settings ▸ Page for a text this wide, and how its numbers
   * are written. With no cover printed, the first page is numbered like any other.
   */
  private pageLines(width: number, onCover?: boolean): ReturnType<typeof headerFooter> {
    const s = this.p.settings;
    const authors = list(s.authors).map(dict).map((a) => str(a.name).trim()).filter(Boolean).join(', ');
    const cover = onCover ?? (!this.included('cover') || undefined);
    return headerFooter(s, { title: str(s.title), authors }, (code) => this.b.reserve({ kind: 'field', code }), width, cover);
  }

  private included(key: string): boolean { return !this.excluded.has(key) && !this.excluded.has('front'); }

  // -------------------------------------------------------------- reading first

  /**
   * Every text with figures or tables, the structures' facts of the compounds `printed` (only
   * theirs: a structure file is read only for a compound that prints), and the labels, before
   * anything is written.
   */
  async prepare(printed: SiCompound[] = []): Promise<void> {
    this.texts.set('general', (await this.p.folder.readText('front/general_information.txt')) ?? '');
    this.texts.set('cover', (await this.p.folder.readText('front/cover_text.txt')) ?? '');
    for (const s of this.p.sections) if (s.type === 'text') this.texts.set(s.id, await this.p.readSectionText(s));
    const compounds = [...new Set(printed)];
    const mols = await Promise.all(compounds.map((c) => (this.p.hasStructure(c) ? this.p.readStructure(c) : Promise.resolve(''))));
    const facts = compounds.length ? await this.host.facts(mols.map((m) => m || '')) : [];
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
      delete s.basedOn;
      delete s.wnum;
      this.styles[id] = s;
    }
    return id;
  }

  /** A compound's title: 11 pt bold, kept with its structure; in the contents only when they go down to compounds. */
  private compoundStyle(level: number, listed: boolean): string {
    const id = listed ? `SICompound${level}` : 'SICompound';
    if (!this.styles[id]) {
      const s: NamedStyle = { ...this.styles.Normal, id, name: listed ? `SI Compound ${level}` : 'SI Compound', ...SI_COMPOUND_LOOK, keepNext: true, next: 'Normal', custom: true };
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
        out.push(R(text, { bold: kind === 'compound' || r.bold, italic: r.italic, underline: r.underline, valign: r.valign, src: r.src }));
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
      const from = this.b.length;
      this.putRun(r, look);
      if (r.src && this.b.length > from) this.source(from, this.b.length, r.src);
    }
  }

  /** Text from `start` to `end` came from `src` (joined to the stretch before when that is the same source's and touches it). */
  private source(start: number, end: number, src: string): void {
    const last = this.sources[this.sources.length - 1];
    if (last && last.src === src && last.end === start) last.end = end;
    else this.sources.push({ start, end, src });
  }

  /** The text `f` puts in, as the page `node` of the project's tree. */
  private async block<T>(node: string, f: () => Promise<T>): Promise<T> {
    const start = this.b.length;
    const out = await f();
    if (this.b.length > start) this.blocks.push({ start, end: this.b.length, node });
    return out;
  }

  private putRun(r: Run, look: RunStyle): void {
    const l: RunStyle = { ...look };
    if (r.bold) l.bold = true;
    if (r.italic) l.italic = true;
    if (r.underline) l.underline = true;
    if (r.valign === 'sub') l.sub = true;
    if (r.valign === 'super') l.sup = true;
    if (r.link) Object.assign(l, this.linkLook, { link: r.link });
    if (r.ref?.startsWith(CITE)) {
      this.b.object({ kind: 'cite', refs: citationsOf(r) }, { ...l, sup: this.citeSup || undefined, sub: undefined });
      this.cited = true;
    } else this.b.text(r.text, l);
  }

  /** A paragraph: its runs (mentions resolved), in style `ps`, with `look` over the style's own. */
  private para(runs: Run[], ps: ParaStyle, where: string, look: RunStyle = {}): void {
    this.putFloat();
    this.put(this.resolve(runs, where), { ...this.b.styleLook(ps), ...look });
    this.b.endPara(this.full(ps));
  }

  /** A paragraph's settings with its style's written in (as Word writes them), its own on top; the first after a floating structure starts below it. */
  private full(ps: ParaStyle, block = false): ParaStyle {
    if (this.clearAtBlock && (block || /Heading ?\d$/.test(ps.style ?? ''))) { this.clearAtBlock = false; this.clearNext = true; }
    const clear = this.clearNext;
    this.clearNext = false;
    return { ...paraFromStyle(styleOf(this.b.doc, ps), ps), ...ps, ...(clear ? { clear } : {}) };
  }

  /** The structure waiting to float from the paragraph starting now, at its start. */
  private putFloat(): void {
    const f = this.pendingFloat;
    if (!f) return;
    this.pendingFloat = null;
    this.structures.push({ obj: this.b.object(f.o), key: structureKey(f.compound), compound: f.compound });
  }

  /**
   * Runs for a table cell or a table's notes (paragraphs of the cell on lines of their own). With
   * `cites`, citations are kept as citation objects (numbered with the rest of the document, as
   * SI Assistant prints them); without (a scheme's conditions, drawn text), they are left out.
   */
  private cellRuns(text: string, where: string, look: RunStyle, cites = false): TextRun[] {
    const out: TextRun[] = [];
    parseMarkup(text).filter((p) => p.runs.length).forEach((p, i) => {
      if (i) out.push({ ...look, text: '\n' });
      for (const r of this.resolve(this.chemistry(p.runs), where)) {
        if (r.ref?.startsWith(CITE)) {
          if (!cites) continue;
          const obj = this.b.reserve({ kind: 'cite', refs: citationsOf(r) });
          out.push({ ...look, obj, text: OBJECT_CHAR, ...(this.citeSup ? { sup: true } : {}), sub: undefined });
          this.cited = true;
          continue;
        }
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
  private async richText(text: string, where: string, owner: Owner | null, offset: number, listedLevels: number, keepAlign = true, numberHeadings = false, src = ''): Promise<void> {
    let index = 0;
    for (const p0 of parseMarkup(text)) {
      const p = src ? { ...p0, runs: tag(p0.runs, src) } : p0;
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
    const look = this.captionLook;
    const own: ParaStyle = { ...ps, align: ps.align ?? look.align ?? 'center' };
    if (look.spaceAfter !== undefined) delete own.spaceAfter;
    if (look.spaceBefore !== undefined) delete own.spaceBefore;
    this.para([R(`${label || 'Figure'}.`, { bold: true }), ...(body.length ? [R(' '), ...body] : [])], { style: 'Caption', ...own, ...(mark ? { marks: [mark] } : {}) }, where);
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
    // (floating with its caption, at the place chosen for it: Picture Format ▸ Position)
    const place = key ? placementOf(this.p.settings, figureKey(key)) : null;
    const got = await this.pictureBlock(joinPath(owner.folder, file), { w: this.textW, h: this.tallest(FIGURE_MAX_H) }, where, widthCm ? Math.min(this.textW, (widthCm / 2.54) * PT) : undefined, align, place && key ? { place, key } : undefined);
    const frame = got && typeof got === 'object' ? got.frame : undefined;
    this.caption(label || 'Figure', p.runs, where, { align, ...(frame ? { frame } : {}) }, { key, kind: 'figure' });
    if (frame) this.clearAtBlock = true;
  }

  /**
   * A picture in a paragraph of its own; false when it couldn't be used (said in the notes). A
   * figure placed out of the line (`figure`) floats in a frame, the frame given back for its
   * caption to be in; a PDF of more than one page stays in the line.
   */
  private async pictureBlock(rel: string, room: { w: number; h: number }, where: string, widthPt?: number, align?: Justify, figure?: { place: Placement; key: string }, structure?: { key: string; compound: string }): Promise<boolean | { frame?: ParaFramePlace }> {
    const bytes = await this.p.folder.readBytes(rel);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (!bytes) { this.notes.push(`${where}: ${name} is no longer in the project; left out.`); return false; }
    this.pdfPageCount = null;
    const pics = /\.pdf$/i.test(name) ? await this.pdfPictures(bytes, name, where, room, widthPt) : [pictureObject(name, bytes, room, widthPt)];
    if (!pics.length || !pics[0]) {
      if (!/\.pdf$/i.test(name)) this.notes.push(`${where}: ${name} could not be read as a picture${/\.tiff?$/i.test(name) ? ' (TIFF pictures are not placed in the document yet)' : ''}; left out.`);
      return false;
    }
    const of = /\.pdf$/i.test(name) ? this.pdfPageCount ?? pics.length : 1;
    const frame = figure && pics.length === 1 && of === 1 && pics[0] ? figureFrame(figure.place, pics[0].w, this.textW) : undefined;
    if (figure && figure.place.position !== 'inline' && !frame) this.notes.push(`${where}: ${name} has more than one page; printed in the line.`);
    for (const pic of pics) {
      if (!pic) continue;
      const obj = this.b.object(pic);
      if (figure) this.structures.push({ obj, key: figureKey(figure.key) });
      else if (structure) this.structures.push({ obj, ...structure });
      this.b.endPara(this.full({ align: frame ? 'center' : align ?? 'center', keepNext: true, spaceAfter: 4, ...(frame ? { frame } : {}) }, true));
    }
    return figure ? { frame } : true;
  }

  /**
   * A PDF's pages as pictures fitted to `room` (none when it can't be read, said in the notes);
   * with `most`, only that many (a table cell shows the first). The live preview shows the first
   * page only, and says so.
   */
  private async pdfPictures(bytes: Uint8Array, name: string, where: string, room: { w: number; h: number }, widthPt?: number, most?: number): Promise<Extract<DocObject, { kind: 'picture' }>[]> {
    if (this.preview && !this.whole) most = 1;
    const pages = this.host.pdfPages ? await this.host.pdfPages(bytes, most).catch(() => null) : null;
    if (!this.host.pdfPages) { this.notes.push(`${where}: ${name} is a PDF; PDFs are placed only in the desktop app and the web app (left out).`); return []; }
    if (!pages?.length) { this.notes.push(`${where}: ${unreadablePdf(name)}`); return []; }
    if (most && pages.length > most) pages.length = most;
    const of = pages[0].of ?? pages.length;
    this.pdfPageCount = of;
    if (this.preview && of > pages.length) this.notes.push(`${where}: the live preview shows the first page of ${name} (it has ${of}); Compile prints them all.`);
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
    // the table as the SI tab's commands see it: its cells' spans, alignment and own look, its
    // header rows, the ACS rules, the columns' widths and the cell margins (table-format.ts)
    data.rows = rows;
    if (Array.isArray(data.columns)) data.columns = data.columns.slice(0, nCols);
    const shape = siTableData(data, this.textW);
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
      const pic = /\.pdf$/i.test(name) ? (await this.pdfPictures(bytes, name, where, { w: this.textW, h: this.tallest(FIGURE_MAX_H) }, widthCm ? (widthCm / 2.54) * PT : undefined, 1))[0] : pictureObject(name, bytes, { w: this.textW, h: this.tallest(FIGURE_MAX_H) }, widthCm ? Math.min(this.textW, (widthCm / 2.54) * PT) : undefined);
      if (!pic) { if (!/\.pdf$/i.test(name)) this.notes.push(`${where}: the picture ${name} in a table cell could not be read; left out.`); continue; }
      pictures.set(`${r}:${k}`, this.b.reserve(pic));
    }
    // each cell: its text (and picture) into its place in the shape
    const cells: TableCell[][] = shape.rows.map((row, r) => row.map((cell, k) => {
      const c = rows[r]?.[k];
      if (c === null || c === undefined) return cell;
      const cd = typeof c === 'string' ? { text: c } : dict(c);
      const text = this.cellRuns(str(cd.text), where, look, true);
      const picId = pictures.get(`${r}:${k}`);
      return { ...cell, runs: picId !== undefined ? [{ ...look, obj: picId, text: OBJECT_CHAR }, ...(text.length ? [{ ...look, text: '\n' }, ...text] : [])] : text };
    }));
    // (below a figure floating above it)
    if (this.clearAtBlock) { this.clearAtBlock = false; this.clearNext = true; }
    // the label and caption above, kept with the table
    this.caption(label || 'Table', caption, where, { align, keepNext: true, spaceAfter: 4 }, { key: id, kind: 'table' });
    const table: Extract<DocObject, { kind: 'table' }> = {
      kind: 'table',
      table: { ...shape, rows: cells, size: 10 },
    };
    this.b.table(table, this.full({ align: align ?? 'center' }));
    const notes = list(data.footnotes).map(str).filter((n) => n.trim());
    notes.forEach((n, i) => {
      const ps: ParaStyle = { align: 'left', spaceAfter: i === notes.length - 1 ? 12 : 0, ...(i < notes.length - 1 ? { keepNext: true } : {}) };
      const nl: RunStyle = { ...this.b.styleLook(ps), size: 9 };
      for (const r of this.cellRuns(n, where, nl, true)) {
        // (a citation: its object put in the text, where it is numbered with the others)
        if (r.obj !== undefined) { const { obj, text: _t, ...l } = r; this.b.object(this.b.objects[obj], l); } else this.b.text(r.text, r);
      }
      this.b.endPara(this.full(ps));
    });
  }

  // -------------------------------------------------------------- the parts

  private async cover(): Promise<void> {
    const s = this.p.settings;
    const cover = dict(s.cover);
    const heading = str(cover.heading).trim() || COVER_HEADINGS[str(s.journal_style)] || 'Supporting Information';
    // Cover page ▸ Spacing: the space above the heading and after each part, in points
    const gap = coverGaps(s);
    this.para([R(heading)], { align: 'center', spaceAfter: gap.heading, ...(gap.above ? { spaceBefore: gap.above } : {}) }, 'Cover page', { size: 16, bold: true });
    this.para(this.chemistry([R(str(s.title), { src: TITLE_SRC })]), { align: 'center', spaceAfter: gap.title }, 'Cover page', { size: 14, bold: true });
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
    if (line.length) this.para(line, { align: 'center', spaceAfter: gap.authors }, 'Cover page');
    const affs = list(s.affiliations).map(dict);
    affs.forEach((a, i) => this.para([R(str(a.marker), { valign: 'super' }), R(str(a.text))], { align: 'center', spaceAfter: i === affs.length - 1 ? gap.affiliations : 0 }, 'Cover page', { size: 10 }));
    const emails = authors.filter((a) => a.corresponding && str(a.email)).map((a) => str(a.email));
    if (emails.length) this.para([R('*Email: ' + emails.join('; '))], { align: 'center', spaceAfter: gap.emails }, 'Cover page', { size: 10 });
    const extra = this.texts.get('cover') ?? '';
    if (extra.trim()) await this.richText(extra, 'Cover page', null, 1, 0, true, false, frontSrc('cover'));
  }

  private toc(): void {
    const toc = dict(this.p.settings.toc);
    const title = typeof toc.title === 'string' ? toc.title : 'Table of Contents';
    const style = this.plainStyle('SITocHeading', 'Contents Heading', { ...SI_TOC_HEADING_LOOK, keepNext: true });
    this.b.pendingBreak = true;
    if (title.trim()) this.para([R(title)], { style }, 'Table of contents');
    // (every level: what is listed is chosen heading by heading, Table of contents ▸ Lists)
    this.b.object({ kind: 'toc', levels: 9, ...(toc.links === false ? { noLinks: true } : {}) });
    this.b.endPara(this.full({}));
  }

  private async general(): Promise<boolean> {
    const text = this.texts.get('general') ?? '';
    if (!text.trim()) return false;
    const info = dict(this.p.settings.general_information);
    const title = info.heading === undefined ? 'General Information' : str(info.heading).trim();
    if (title) this.para([R(this.numbered(1, true) + title)], { style: this.headingStyle(1, this.lists.general) }, 'General Information');
    await this.richText(text, title || 'General Information', await this.owner('general'), 1, this.lists.headings ? 2 : 0, true, true, frontSrc('general'));
    return true;
  }

  /** A section's heading: in the contents when sections (a top one) or sub-sections are listed; the Spectra section's when spectra are. */
  private sectionHeading(level: number, name: string, ps: ParaStyle = {}, spectra = false): void {
    const listed = spectra ? this.lists.spectra : level === 1 ? this.lists.sections : this.lists.subsections;
    this.para([R(this.numbered(level) + name)], { style: this.headingStyle(level, listed), ...ps }, name);
  }

  // ---------------------------------------------------------- heading numbers (Lauren's, rewritten)
  // Project Settings ▸ Headings (si/heading-format.ts): as the journal style does (Wiley 1., 1.1.;
  // RSC 1, 1.1; ACS none), SI Assistant's outline (1, A, a, i) or numbers (1, 1.1, 1.1.1), or any
  // format of Chemweave's. Chosen formats can number headings typed in a section's or General
  // Information's text and the General Information heading too. General procedure headings,
  // compound titles and headings in a compound's text never are. The numbers are written into
  // the headings, so the contents show them.

  private counters: number[] = [];
  private headingFmtNow: ReturnType<typeof headingFormat> | undefined;
  private get headingFmt(): ReturnType<typeof headingFormat> { return this.headingFmtNow === undefined ? (this.headingFmtNow = headingFormat(this.p.settings)) : this.headingFmtNow; }

  /** The number for the next heading at `level` ("1.2. "), or '' when headings aren't numbered. `text`: a heading typed in a text (or General Information's). */
  private numbered(level: number, text = false): string {
    const f = this.headingFmt;
    if (!f || (text && !f.text)) return '';
    const lv = Math.max(1, Math.min(9, level));
    while (this.counters.length < lv) this.counters.push(0);
    this.counters.length = lv;
    this.counters[lv - 1]++;
    return headingNumber(f, this.counters);
  }

  private async section(s: SiSection, level: number): Promise<void> {
    if (this.excluded.has(s.id)) return;
    if (s.type !== 'spectra') return this.block(`section:${s.id}`, () => this.sectionNow(s, level));
    return this.sectionNow(s, level);
  }

  private async sectionNow(s: SiSection, level: number): Promise<void> {
    if (s.type === 'spectra') {
      if (this.excluded.has('spectra')) return;
      if (this.spectraDone) { this.notes.push(`“${s.name}”: a project has only one Spectra section; this one was left out.`); return; }
      this.spectraDone = true;
      await this.spectraSection(s, level);
      return;
    }
    // Layout ▸ Orientation (Chemweave's) turns the section's pages, and Breaks ▸ Next Page (SI
    // Assistant's page_flow.new_page) starts it on a new page; the pages after it turn back
    const was = this.landscape;
    // (a sub-section without its own orientation follows its section's)
    const landscape = ownOrientation(s) ? ownOrientation(s) === 'landscape' : was;
    if (landscape !== was) this.orient(landscape ? 'landscape' : 'portrait');
    else if (startsNewPage(s.data) && (!this.preview || this.whole)) this.b.pendingBreak = true;
    await this.sectionBody(s, level, landscape);
    if (this.landscape !== was) this.orient(was ? 'landscape' : 'portrait');
  }

  private async sectionBody(s: SiSection, level: number, landscape: boolean): Promise<void> {
    if (s.type === 'text') {
      this.sectionHeading(level, s.name);
      await this.richText(this.texts.get(s.id) ?? '', s.name, await this.owner(s.id), level, this.lists.headings ? level + 1 : 0, true, true, sectionSrc(s.id));
    } else if (s.type === 'file') await this.fileSection(s, level);
    else if (s.type === 'xray') await this.xray(s, level, true); else if (s.type === 'data') await this.dataSection(s, level);
    for (const child of s.children) {
      // (this section's pages again after a sub-section that turned them: the Spectra section ends upright)
      if (this.landscape !== landscape) this.orient(landscape ? 'landscape' : 'portrait');
      await this.section(child, level + 1);
    }
  }

  private async fileSection(s: SiSection, level: number): Promise<void> {
    const heading = str(s.data.heading).trim();
    if (heading) this.sectionHeading(level, heading);
    const file = str(s.data.file);
    if (!file) { this.notes.push(`Attachment section “${s.name}” has no file attached.`); return; }
    const ok = await this.pictureBlock(joinPath(s.folder, file), { w: this.textW, h: this.tallest(ATTACHMENT_MAX_H) }, `Attachment section “${s.name}”`);
    const caption = str(s.data.caption).trim();
    if (ok && caption) this.para([R(caption)], { align: 'center' }, s.name, { size: 10 });
  }

  private async dataSection(s: SiSection, level: number): Promise<void> {
    this.sectionHeading(level, s.name);
    for (const gp of this.p.generalProcedures(s)) {
      const name = str(gp.name).trim() || 'General Procedure';
      const title = str(gp.title).trim();
      this.para(this.chemistry([R(name + (title ? `: ${title}` : ''))]), { style: this.headingStyle(level + 1, this.lists.procedures) }, `${s.name} ▸ ${name}`);
      const text = await this.p.readGpText(s, str(gp.id));
      if (!text.trim()) this.notes.push(`“${name}” in “${s.name}” has no text yet.`);
      await this.richText(text, `${s.name} ▸ ${name}`, null, level + 1, 0, false, false, gpSrc(s.id, str(gp.id)));
    }
    for (const item of s.items) {
      if (item.kind === 'scheme') {
        await this.block(`scheme:${item.id}`, async () => {
          const drawn = await this.scheme(item, s);
          for (const c of item.children) await this.compound(c, level + 1, drawn.has(c.id));
        });
      } else await this.compound(item, level + 1);
    }
  }

  /** Compounds set out so far, of how many (Compile's progress). */
  private progressDone = 0;
  private progressTotal = 0;

  private async compound(c: SiCompound, level: number, inScheme = false): Promise<void> {
    return this.block(`compound:${c.id}`, () => this.compoundNow(c, level, inScheme));
  }

  private async compoundNow(c: SiCompound, level: number, inScheme: boolean): Promise<void> {
    // Breaks ▸ Next Page (SI Assistant's page_flow.new_page); not for one compound's page in the Live Preview
    if (startsNewPage(c.data) && (!this.preview || this.whole)) this.b.pendingBreak = true;
    const id = displayId(this.report, c.id);
    const name = compoundName(c);
    if (this.host.progress && !this.preview) await this.host.progress(++this.progressDone, this.progressTotal, `Compounds: ${Math.min(this.progressDone, this.progressTotal)} of ${this.progressTotal}`);
    const where = name ? `${id} (${name})` : id;
    const facts = this.facts.get(c.id) ?? null;
    const nuclei = this.nmrLinks ? new Set(spectrumItems(c).map(([, i]) => nmrNucleus(i, c))) : null;
    const nmrLink = nuclei ? (n: string): string | null => (nuclei.has(n) ? `#${spectrumMark(c.id, n)}` : null) : undefined;
    const block = compoundBlock(this.p, c, id, { facts, helpers: this.helpers, leave: this.leave, ...(nmrLink ? { nmrLink } : {}) });
    // the structure: in a paragraph of its own under the title, or floating from the title or the line below it (placement.ts)
    const got = inScheme ? null : await this.structure(c, where);
    const st = got && 'o' in got ? got : null;
    const placed = st && st.float ? st : null;
    if (placed?.top === 'title') this.pendingFloat = { o: placed.o, compound: c.id };
    this.para(block.title, { style: this.compoundStyle(level, this.lists.compounds), marks: [compoundBookmark(c.id)] }, where);
    this.targets.push({ key: c.id, kind: 'compound', label: id, caption: name, mark: compoundBookmark(c.id) });
    if (placed?.top === 'below') this.pendingFloat = { o: placed.o, compound: c.id };
    else if (st && !placed) {
      this.structures.push({ obj: this.b.object(st.o), key: structureKey(c.id), compound: c.id });
      this.b.endPara(this.full({ align: 'center', keepNext: true, spaceBefore: 2, spaceAfter: 8 }));
    } else if (got && 'file' in got) await this.pictureBlock(got.file, STRUCTURE_MAX, where, undefined, undefined, undefined, { key: structureKey(c.id), compound: c.id });
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
    // (no text under the title: the structure floats from an empty line of its own)
    if (this.pendingFloat) { this.putFloat(); this.b.endPara(this.full({ spaceBefore: 0, spaceAfter: 0 })); }
    // what follows the compound's text (its figures, the next compound) starts below its structure
    if (placed) this.clearNext = true;
    const figures = inlineFigures(c);
    for (let i = 0; i < figures.length; i++) {
      const f = figures[i];
      const def = fieldsOfCompound(c).find((d) => d.key === f.field);
      const ok = await this.pictureBlock(joinPath(c.folder, def?.subdir ?? 'files', f.file), { w: this.textW, h: 4 * PT }, where);
      if (ok) this.caption(this.labels.at(c.id, i) || 'Figure', [R(f.caption)], where, {}, { key: `${c.id}#${i}`, kind: 'figure' });
    }
    if (id === 'ID?') this.notes.push(`“${name || 'A compound'}” has no ID (printed as “ID?”).`);
    // its X-ray structures, right after it and without a heading
    for (const x of this.p.anchored.get(c.id) ?? []) if (!this.excluded.has(x.id)) await this.xray(x, level, false);
  }

  /**
   * An X-ray structure (SPEC §13v): its drawing as a live crystal structure (double-click it in
   * the document to turn it or change its look), the figure caption (typed, or made from how it
   * is drawn), then the crystal data table when the section prints it. Among the sections it has
   * its name as heading; under a compound, none.
   */
  private async xray(s: SiSection, level: number, heading: boolean): Promise<void> {
    if (heading) this.sectionHeading(level, s.name);
    const where = `X-ray structure “${s.name}”`;
    const file = str(s.data.file);
    if (!file) { this.notes.push(`${where}: no CIF file has been chosen yet; left out.`); return; }
    const cif = await this.p.folder.readText(joinPath(s.folder, file));
    if (cif === null) { this.notes.push(`${where}: ${file} is no longer in the project; left out.`); return; }
    const { block, error } = xrayBlock(cif, str(s.data.block));
    if (!block) { this.notes.push(`${where}: ${error}; left out.`); return; }
    const got = xrayDrawing(block, dict(s.data.view), this.textW);
    if ('error' in got) { this.notes.push(`${where}: ${got.error}; left out.`); return; }
    const doc = new Doc();
    doc.edit('Crystal Structure', () => {
      putPlate(doc, POINTS, { ...newPlate('crystal', doc.style.bondLength), w: got.w, h: got.h, crystal: { ...got.spec, table: crystalTable(block).map(([, l, v]) => [l, v]) } }, { x: 0, y: 0 });
    });
    this.b.object({ kind: 'drawing', contents: doc.contents(), alt: `Crystal structure ${s.name}` });
    this.b.endPara(this.full({ align: 'center', keepNext: true, spaceBefore: 6, spaceAfter: 2 }));
    const ref = xrayCompound(s.data, (id) => this.compoundExists(id));
    const rows = xrayTableRows(s.data, block);
    const ccdc = rows.find(([k]) => k === 'ccdc')?.[2] ?? '';
    const caption = str(s.data.caption).trim() || xrayAutoCaption(got.spec.view, ref, ccdc);
    this.caption(this.labels.at(s.id, 0) || 'Figure', parseMarkup(caption).flatMap((p) => p.runs), where, { spaceAfter: 10 }, { key: s.id, kind: 'figure' });
    if (s.data.table === false) return;
    if (!rows.length) { this.notes.push(`${where}: its crystal data table has no values; left out.`); return; }
    const look: RunStyle = { ...this.b.styleLook({}), size: 10 };
    // its width: as its contents need (the default), or a share of the text's width
    const tableW = Math.max(0, Math.min(100, Number(s.data.table_width) || 0));
    const share = tableW ? Math.max(0.2, tableW / 100) : 1;
    const cells: TableCell[][] = rows.map(([, label, value]) => [
      { runs: this.cellRuns(label, where, look), align: 'left' },
      { runs: this.cellRuns(value, where, look), align: 'left' },
    ]);
    this.caption(this.labels.at(s.id, 1) || 'Table', parseMarkup(xrayTableCaption(s.data, ref)).flatMap((p) => p.runs), where, { keepNext: true, spaceAfter: 4 }, { key: s.id + '#table', kind: 'table' });
    this.b.table({
      kind: 'table',
      table: { cols: [this.textW * 0.45, this.textW * 0.55].map((w) => Math.round(w * share * 100) / 100), rows: cells, head: 0, lines: 'acs', size: 10, width: tableW ? { pct: Math.round(share * 100) } : 'auto', autofit: !tableW, align: ['left', 'left'] },
    }, this.full({ align: 'center', spaceAfter: 12 }));
  }

  /**
   * A scheme page's scheme, drawn (SPEC §13n.4) as one editable drawing with its caption when its
   * Layout shows one; the compounds its boxes show, whose structures it prints, are returned.
   */
  private async scheme(k: SiScheme, s: SiSection): Promise<Set<string>> {
    const drawn = new Set<string>();
    const name = str(k.data.name) || 'Scheme';
    const where = `${s.name} ▸ scheme “${name}”`;
    let editor = dict(k.data.editor);
    if (k.data.mode !== 'editor') {
      // A scheme page made as one pasted picture (before the scheme editor) prints as SI Assistant
      // prints it (scheme_editor.upgrade_old_scheme, in memory only): the boxes and steps it already
      // has, or else its compounds as the products of one step. Its picture isn't printed.
      if (!list(editor.starting).length && !list(editor.steps).length) editor = { ...editor, starting: [], steps: [{ products: k.children.map((c) => ({ compound: c.id })) }] };
      this.notes.push(`${where}: it was made from a pasted picture, which isn’t printed; its compounds are drawn as the products of one step. Open its scheme page to set it out as you want it.`);
    }
    const lay = this.schemeLayoutOf(k);
    const conditions = (t: unknown): TextRun[] => this.cellRuns(str(t), where, {});
    // structures in the conditions (@struct{s-…}): drawn from their structure files
    const structures = async (t: unknown): Promise<Contents[]> => {
      const out: Contents[] = [];
      for (const sid of inlineIds(str(t))) {
        const mol = await inlineMol(this.p, k, sid);
        const c = mol ? this.host.contentsOf(mol) : null;
        if (c) out.push(c);
        else this.notes.push(`${where}: a structure in the conditions ${mol ? 'could not be drawn' : 'is only a picture (no structure file), which isn’t drawn in the scheme yet'}; left out.`);
      }
      return out;
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
      steps.push({ top: conditions(st.top), bottom: conditions(st.bottom), topAlign: align(st.top_align), bottomAlign: align(st.bottom_align), products, topStructures: await structures(st.top), bottomStructures: await structures(st.bottom) });
    }
    const got = drawScheme(starting, steps, lay, this.textW, siDrawingStyle(this.p.settings));
    if (!got) {
      this.notes.push(`${where}: it has no structures to draw; left out. Its compounds are printed with their own structures.`);
      drawn.clear();
      return drawn;
    }
    if (got.textPt < 6) this.notes.push(`${where}: its conditions print at only ${got.textPt.toFixed(1)} pt; make the scheme narrower or its text larger (Scheme ▸ Layout on its page).`);
    const scale = Math.round(got.scale * 1000) / 1000;
    this.b.object({ kind: 'drawing', contents: got.contents, ...(scale !== 1 ? { scale } : {}), alt: name });
    const label = lay.show_label ? this.labels.byId.get(k.id) ?? '' : '';
    this.b.endPara(this.full({ align: 'center', keepNext: !!label, spaceBefore: 6, spaceAfter: label ? 2 : 10 }));
    if (label) this.caption(label, [R(name)], where, { spaceAfter: 10 }, { key: k.id, kind: 'scheme' });
    return drawn;
  }

  /**
   * A compound's structure as a figure (not put in yet): to go centered in a paragraph of its own
   * under the title (in the line), or, placed beside the text (placement.ts), to float from the
   * title or the line below it (`float`). Null when it has none.
   */
  private async structure(c: SiCompound, where: string): Promise<{ o: DocObject; float: boolean; top: 'title' | 'below' } | { file: string } | null> {
    const mol = this.p.hasStructure(c) ? await this.p.readStructure(c) : '';
    const contents = mol ? this.host.contentsOf(mol) : null;
    const pl = placementOf(this.p.settings, structureKey(c.id));
    let o: DocObject | null = null, w = 0;
    if (contents) {
      const size = this.host.sizeOf(contents);
      const scale = size && size.w > 0 && size.h > 0 ? Math.min(1, STRUCTURE_MAX.w / size.w, STRUCTURE_MAX.h / size.h) : 1;
      o = { kind: 'drawing', contents, ...(scale < 1 ? { scale: Math.round(scale * 1000) / 1000 } : {}) };
      w = (size?.w ?? 0) * scale;
    } else {
      const picture = str(dict(valuesOf(c).structure).image_override);
      // (a picture in the line prints as before, every page of a PDF; floating, its first page)
      if (picture && pl.position === 'inline') return { file: joinPath(c.folder, picture) };
      if (picture) {
        const pic = await this.firstPicture(joinPath(c.folder, picture), STRUCTURE_MAX, where);
        if (pic) { o = pic; w = pic.w; }
      } else if (mol) this.notes.push(`${where}: its structure could not be drawn; left out.`);
    }
    if (!o) return null;
    const fl = placedFloat(pl, w, this.textW);
    if (!fl) return { o, float: false, top: pl.top };
    return { o: { ...o, float: { ...fl, name: `Compound structure ${displayId(this.report, c.id)}` } } as DocObject, float: true, top: pl.top };
  }

  /** A picture file's first picture (a PDF's first page) fitted to `room`; null when it can't be used (said in the notes). */
  private async firstPicture(rel: string, room: { w: number; h: number }, where: string): Promise<Extract<DocObject, { kind: 'picture' }> | null> {
    const bytes = await this.p.folder.readBytes(rel);
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    if (!bytes) { this.notes.push(`${where}: ${name} is no longer in the project; left out.`); return null; }
    this.pdfPageCount = null;
    const pic = /\.pdf$/i.test(name) ? (await this.pdfPictures(bytes, name, where, room, undefined, 1))[0] ?? null : pictureObject(name, bytes, room);
    if (!pic && !/\.pdf$/i.test(name)) this.notes.push(`${where}: ${name} could not be read as a picture${/\.tiff?$/i.test(name) ? ' (TIFF pictures are not placed in the document yet)' : ''}; left out.`);
    if (pic && (this.pdfPageCount ?? 1) > 1) this.notes.push(`${where}: ${name} has ${this.pdfPageCount} pages; only the first floats beside the text (In Line with Text prints them all).`);
    return pic;
  }

  // -------------------------------------------------------------- spectra (SPEC §13k.12)

  /**
   * How many pages the Spectra section prints before a compound's first spectra page (for the
   * live preview of one compound's spectra to number its pages as the SI does): its spectra put on
   * pages as spectraSection puts them, each file's pages counted by `pagesOf` (null: left out).
   */
  async spectraPagesBefore(id: string, pagesOf: (file: string, bytes: Uint8Array) => Promise<number | null>): Promise<number> {
    const s = this.p.sections.find((x) => x.type === 'spectra') ?? null;
    const defaults = sectionDefaults(s, this.p.settings);
    let pages = 0;
    let last: { orientation: SpectrumLayout['orientation']; per: number; n: number } | null = null;
    for (const c of this.includedCompounds(this.p.top)) {
      if (c.id === id) return pages;
      for (const [key, item] of spectrumItems(c)) {
        const file = partText(item.file);
        if (!file) continue;
        const bytes = await this.p.folder.readBytes(joinPath(c.folder, attachmentDir(c, key), file));
        if (!bytes) continue;
        const n = /\.pdf$/i.test(file) ? await pagesOf(file, bytes).catch(() => null) : 1;
        for (let i = 0; i < (n ?? 0); i++) {
          const eff = effective(defaults, item, String(i + 1));
          if (!last || last.orientation !== eff.orientation || last.per !== eff.per_page || last.n >= last.per) { last = { orientation: eff.orientation, per: eff.per_page, n: 0 }; pages++; }
          last.n++;
        }
      }
    }
    return pages;
  }


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
  private async spectraSection(s: SiSection | null, level: number, only?: SiCompound[]): Promise<void> {
    const defaults = sectionDefaults(s, this.p.settings);
    const compounds = only ?? this.includedCompounds(this.p.top);
    const name = s?.name ?? 'Spectra';
    type Entry = { c: SiCompound; item: Json; page: PagePicture; pageNo: number; eff: SpectrumLayout };
    const entries: Entry[] = [];
    const files = this.host.progress && !this.preview ? compounds.reduce((n, c) => n + spectrumItems(c).filter(([, i]) => partText(i.file)).length, 0) : 0;
    let read = 0;
    // (the live preview of the whole section: its first spectra only, each read and measured again at every change)
    const cap = this.preview && !only ? PREVIEW_SPECTRA : Infinity;
    let skipped = false;
    for (const c of compounds) {
      for (const [key, item] of spectrumItems(c)) {
        const file = partText(item.file);
        if (!file) continue;
        if (entries.length >= cap) { skipped = true; continue; }
        if (files) await this.host.progress!(read++, files, `Spectra: ${read} of ${files}`);
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
    if (skipped) this.notes.push(`${name}: the live preview shows the first ${entries.length} spectra; Compile prints them all.`);
    // pages: a spectrum that needs another layout (number to a page, orientation) starts a new page
    const pages: { orientation: SpectrumLayout['orientation']; per: number; slots: Entry[] }[] = [];
    for (const e of entries) {
      const last = pages[pages.length - 1];
      if (!last || last.orientation !== e.eff.orientation || last.per !== e.eff.per_page || last.slots.length >= last.per) pages.push({ orientation: e.eff.orientation, per: e.eff.per_page, slots: [] });
      pages[pages.length - 1].slots.push(e);
    }
    const hrms = this.excluded.has('hrms_reports') ? [] : compounds.filter((c) => printsReports(c, defaults));
    if (!pages.length && !hrms.length) return;
    // (one compound's pages alone, for the live preview: without the section's heading)
    let headed = !!only;
    for (const pg of pages) {
      this.orient(pg.orientation);
      const page = this.landscape ? { ...this.b.doc.page, w: this.b.doc.page.h, h: this.b.doc.page.w } : this.b.doc.page;
      let top = 0;
      if (!headed) {
        this.sectionHeading(level, name, { pageBreak: true }, true);
        headed = true;
        top = HEADING_ROOM;
      } else if (pg !== pages[0] || !only) this.b.pendingBreak = true;
      await this.spectraPage(pg.slots, pg.per, page, top);
    }
    if (hrms.length) await this.hrmsReports(hrms, level + 1, name, !headed, level);
    // the pages after it are portrait again (the sections after the Spectra section)
    this.orient('portrait');
  }

  /** One page of spectra: an empty paragraph that anchors them, and each slot floating at its place. */
  private async spectraPage(slots: { c: SiCompound; item: Json; page: PagePicture; pageNo: number; eff: SpectrumLayout }[], per: number, page: PageSetup, top: number): Promise<void> {
    const bw = page.w - page.left - page.right, bh = page.h - page.top - page.bottom - top - 2;
    const slot = slotSize(bw, bh, per, this.landscape);
    const [cols] = per === 4 ? [2] : per === 2 && this.landscape ? [2] : [1];
    const floats: DocObject[] = [];
    const marks: string[] = [];
    let z = 1;
    for (let i = 0; i < slots.length; i++) {
      const { c, item, page: pic, pageNo, eff } = slots[i];
      const col = i % cols, row = Math.floor(i / cols);
      const sx = col * (slot.w + GUTTERS[0]), sy = row * (slot.h + GUTTERS[1]);
      const id = displayId(this.report, c.id);
      let headH = 0;
      if (eff.header_line) {
        let runs = this.helpers ? formatNmr(headerParts(c, item, id, pageNo).map((t) => R(t)), this.leave) : headerParts(c, item, id, pageNo).map((t) => R(t));
        // the header line goes back to the compound's data (SPEC §13l.7)
        if (this.linkBack) runs = runs.map((r) => ({ ...r, link: `#${compoundBookmark(c.id)}` }));
        headH = HEADER_PT * 1.25 + 2 * 3.6 + 3;
        floats.push({ kind: 'textbox', runs: textRuns(runs, { bold: true, size: HEADER_PT, ...(this.linkBack ? this.linkLook : {}) }), paras: [{ align: 'center' }], w: slot.w, float: this.at(sx, sy, z++, `Header ${id}`) });
      }
      // the peak reports' "¹H NMR" go to the page with the compound's first spectrum of that nucleus
      const nucleus = this.nmrLinks ? nmrNucleus(item, c) : null;
      if (nucleus && !this.placedMarks.has(spectrumMark(c.id, nucleus))) { this.placedMarks.add(spectrumMark(c.id, nucleus)); marks.push(spectrumMark(c.id, nucleus)); }
      const crop = eff.auto_crop && this.host.contentBox ? await this.host.contentBox(pic.src).catch(() => null) : null;
      // the structure box: on the spectrum (its corner, where it was dragged, or blank paper for
      // auto), or above or beside it with room of its own (SI Assistant's issue #1)
      const parts = eff.struct_box ? await this.boxParts(c, item, eff) : null;
      let use = eff;
      let spot = parts ? boxSpot(eff) : 'on';
      const room = { w: slot.w, h: Math.max(10, slot.h - headH) };
      if (parts && eff.struct_place === 'auto' && (eff.x === undefined || eff.y === undefined)) {
        const at = shownSize(room, pic.h / pic.w, crop);
        const ink = this.host.inkMap ? await this.host.inkMap(pic.src).catch(() => null) : null;
        const got = ink ? autoPlace(cropInk(ink, crop), at, (sc) => this.boxSize(parts, { ...eff, struct_scale: sc }), eff.struct_scale, eff.corner, eff.auto_shrink, eff.auto_min_scale) : null;
        if (got) use = { ...eff, x: got.x, y: got.y, struct_scale: got.scale };
        else {
          spot = 'above';
          const where = `${id} ▸ Spectra ▸ ${partText(item.file) || 'a spectrum'}${pageNo > 1 ? `, page ${pageNo}` : ''}`;
          this.notes.push(ink ? `${where}: the structure fits no blank space on the spectrum${eff.auto_shrink ? ' even made smaller' : ''}; it was put above the spectrum.`
            : `${where}: the spectrum’s blank space could not be read; the structure was put above the spectrum.`);
        }
      }
      const box = parts ? this.boxSize(parts, use) : { w: 0, h: 0 };
      const shown = shownSize(roomBeside(room, spot, box), pic.h / pic.w, crop);
      // the spectrum and a box beside it are centred together; a box above is centred over it
      const groupW = spot === 'beside' ? shown.w + PLACE_GAP + box.w : shown.w;
      const px = sx + (slot.w - groupW) / 2, py = sy + headH + (spot === 'above' ? box.h + PLACE_GAP : 0);
      floats.push({
        kind: 'picture', src: pic.src, w: round2(shown.w), h: round2(shown.h), ...(pic.px ? { px: pic.px } : {}),
        ...(crop ? { crop: { l: crop[0], t: crop[1], r: 1 - crop[2], b: 1 - crop[3] } } : {}),
        ...(eff.spectrum_frame ? { look: { frame: eff.spectrum_frame_width, frameColor: eff.spectrum_frame_color } } : {}),
        alt: headerParts(c, item, id, pageNo).join(''), float: this.at(px, py, z++, `Spectrum ${id}`),
      });
      if (parts) {
        const boxAt = spot === 'above' ? { x: sx + (slot.w - box.w) / 2, y: sy + headH } : spot === 'beside' ? { x: px + shown.w + PLACE_GAP, y: py } : undefined;
        floats.push(...(await this.structureBox(parts, use, { x: px, y: py, w: shown.w, h: shown.h }, () => z++, boxAt)));
      }
    }
    // the anchor: an empty paragraph as tall as the page's body, so the next page starts after it
    for (const f of floats) this.b.object(f);
    this.b.endPara(this.full({ spaceAfter: 0, spaceBefore: 0, linePt: Math.max(12, Math.floor(bh - 6)), lineRule: 'exact', ...(marks.length ? { marks } : {}) }));
  }

  /** A float at (x, y) from the margin and the anchor paragraph, in front of the text. */
  private at(x: number, y: number, z: number, name: string): Float {
    return { wrap: 'front', x: round2(x), y: round2(y), xFrom: 'margin', yFrom: 'para', gap: 0, z, name };
  }

  /** What goes on a spectrum's structure box: the compound's drawing (and its own size), its ID and the caption. */
  private async boxParts(c: SiCompound, item: Json, eff: SpectrumLayout): Promise<BoxParts> {
    const mol = this.p.hasStructure(c) ? await this.p.readStructure(c) : '';
    const contents = mol ? this.host.contentsOf(mol) : null;
    const own = contents ? this.host.sizeOf(contents) : null;
    const caption = eff.caption ? captionText(c, item) : '';
    return { mol, contents, own, id: displayId(this.report, c.id), caption };
  }

  /** The box's size with the structure at `eff`'s size. */
  private boxSize(b: BoxParts, eff: SpectrumLayout): { w: number; h: number } {
    const size = b.contents ? structureSize(b.own, eff.struct_scale) : { w: 0, h: 0 };
    return structureBoxSize(size, b.id, idSizeOf(eff), b.caption, eff.caption_size);
  }

  /** The compound's structure, ID and caption on a box over a spectrum (in its corner, where it was dragged or placed), or at `place` (above or beside it). */
  private async structureBox(b: BoxParts, eff: SpectrumLayout, spec: { x: number; y: number; w: number; h: number }, z: () => number, place?: { x: number; y: number }): Promise<DocObject[]> {
    const { mol, contents, own, id, caption } = b;
    const size = contents ? structureSize(own, eff.struct_scale) : { w: 0, h: 0 };
    const idSize = idSizeOf(eff);
    const capRuns = caption ? (this.helpers ? formatNmr([R(caption)], this.leave) : [R(caption)]) : [];
    const { w, h } = structureBoxSize(size, id, idSize, caption, eff.caption_size);
    const { x: bx, y: by } = place ?? structureBoxAt(eff, spec, { w, h });
    // the box (its background and frame), the structure on it, and the ID and caption under the
    // structure: grouped, so they move together (Alt-drag moves one on its own)
    const group = ++this.groups;
    const at = (x: number, y: number, name: string): Float => ({ ...this.at(x, y, z(), name), group });
    const out: DocObject[] = [{
      kind: 'textbox', runs: [], w: round2(w), h: round2(h), fill: eff.struct_bg,
      ...(eff.struct_frame ? { look: { frame: eff.struct_frame_width, frameColor: eff.struct_frame_color } } : {}),
      float: at(bx, by, `Structure box ${id}`),
    }];
    const runs: TextRun[] = [...textRuns([R(id)], { bold: eff.id_bold || undefined, size: idSize })];
    const paras: ParaStyle[] = [{ align: 'center', spaceBefore: 0, spaceAfter: 0 }];
    if (caption) { runs.push({ text: '\n' }, ...textRuns(capRuns, { size: eff.caption_size })); paras.push({ align: 'center', spaceAfter: 0 }); }
    out.push({ kind: 'textbox', runs, paras, w: round2(w), float: at(bx + (eff.label_dx ?? 0), by + SI_BOX_PAD + size.h + (eff.label_dy ?? 0), `Compound ID ${id}`) });
    if (contents) {
      const scale = own && own.w > 0 ? size.w / own.w : 1;
      out.push({ kind: 'drawing', contents, ...(Math.abs(scale - 1) > 1e-3 ? { scale: Math.round(scale * 1000) / 1000 } : {}), float: at(bx + (w - size.w) / 2, by + SI_BOX_PAD, `Structure ${id}`) });
    } else if (mol) this.notes.push(`${id}: its structure could not be drawn on its spectra; left out.`);
    return out;
  }

  /**
   * The HRMS reports sub-section (§13n.3): each compound's report files, compound by compound.
   * Its heading (and the Spectra section's, when `withSection`) is printed only once a report
   * prints something; a report that can't be read is said in the notes, never stops the compile.
   */
  private async hrmsReports(compounds: SiCompound[], level: number, sectionName: string, withSection: boolean, sectionLevel: number): Promise<void> {
    let started = false;
    /** The headings, before the first report printed (which then goes under them, not on a page of its own). */
    const start = (): boolean => {
      if (started) return false;
      started = true;
      this.orient('portrait');
      if (withSection) this.sectionHeading(sectionLevel, sectionName, { pageBreak: true }, true);
      this.para([R(this.numbered(level) + 'HRMS reports')], { style: this.headingStyle(level, this.lists.hrms), ...(withSection ? {} : { pageBreak: true }) }, 'HRMS reports');
      return true;
    };
    // (the reports are on upright pages, even after landscape spectra pages)
    const room = { w: this.uprightW, h: Math.max(PT, Math.min(7.4 * PT, this.uprightH - 0.6 * PT)) };
    for (const c of compounds) {
      const id = displayId(this.report, c.id);
      for (const r of reportItems(c)) {
        const file = String(r.file);
        const where = `${id} ▸ HRMS`;
        try {
          await this.hrmsReport(c, file, where, room, start);
        } catch (e) {
          this.notes.push(`${where}: the HRMS report ${file} could not be printed (${e instanceof Error ? e.message : String(e)}); left out.`);
        }
      }
    }
  }

  /** One HRMS report file; `start` puts the headings in first (true for the first report printed). */
  private async hrmsReport(c: SiCompound, file: string, where: string, room: { w: number; h: number }, start: () => boolean): Promise<void> {
    const id = displayId(this.report, c.id);
    const kind = printKind(file);
    if (kind === 'none') { this.notes.push(`${where}: the HRMS report ${file} can't be printed (raw data or a kind of file that can't be shown); left out.`); return; }
    const title = (more = ''): void => this.para([R(id, { bold: true }), R(` — HRMS report: ${file}${more}`)], { keepNext: true, spaceBefore: 14, spaceAfter: 6 }, where);
    if (kind === 'peaks') {
      // (read through the shared cache, off the UI thread: the compound page has usually read it already)
      const data = await readReportFile(this.p.folder, joinPath(c.folder, 'hrms'), file);
      if (data.kind === 'missing') { this.notes.push(`${where}: the HRMS report ${file} is missing; left out.`); return; }
      start(); title(); this.peaksTable(c, file, data, where); return;
    }
    const bytes = await this.p.folder.readBytes(joinPath(c.folder, 'hrms', file));
    if (!bytes) { this.notes.push(`${where}: the HRMS report ${file} is missing; left out.`); return; }
    if (kind === 'pdf') {
      const pics = await this.pdfPictures(bytes, file, where, room);
      pics.forEach((pic, i) => {
        // each page of a report of several on a page of its own (the first under the headings, when it is the first report)
        const first = start();
        if (i > 0 || (pics.length > 1 && !first)) this.b.pendingBreak = true;
        title(pics.length > 1 ? ` (page ${i + 1} of ${pics.length})` : '');
        this.b.object(pic);
        this.b.endPara(this.full({ align: 'center' }));
      });
      return;
    }
    if (kind === 'picture') {
      const pic = pictureObject(file, bytes, room);
      if (!pic) { this.notes.push(`${where}: ${file} could not be read as a picture; left out.`); return; }
      start();
      title();
      this.b.object(pic);
      this.b.endPara(this.full({ align: 'center' }));
      return;
    }
    const [lines, left] = reportListing(bytes, file);
    if (listingFailed(lines)) this.notes.push(`${where}: the HRMS report ${file} could not be read (it may be damaged); only a note is printed for it.`);
    start();
    title();
    lines.forEach((l) => { this.b.text(l || ' ', { font: 'Courier New', size: 7 }); this.b.endPara(this.full({ spaceAfter: 0, keepNext: false })); });
    if (left) this.para([R(`… ${left} more line${left === 1 ? '' : 's'} not printed (the whole file is kept in the project folder).`, { italic: true })], {}, where, { size: 8 });
  }

  /** A data file (mzML, mzXML, mzData, netCDF): its largest peaks near the expected m/z (the chosen ion's monoisotopic m/z), the one used as found marked. */
  private peaksTable(c: SiCompound, file: string, data: ReportData, where: string): void {
    // (a damaged file gives a message, printed under its title and said in the notes)
    if (!data.readable) this.notes.push(`${where}: the HRMS report ${file} could not be read (it may be damaged); only a note is printed for it.`);
    const v = dict(valuesOf(c).hrms);
    let centre: number | null = null;
    try {
      const sp = hrmsSpecies(this.facts.get(c.id) ?? null, v);
      if (sp) { const peaks = hrmsCalc(sp.info, str(v.adduct), '', hrmsTolerance(this.p.settings)).peaks; centre = (peaks.find((x) => x.mono) ?? peaks[0])?.mz ?? null; }
    } catch { centre = null; }
    const rows = peaksNear(data, centre);
    if (!rows.length) { this.para([R(!data.readable ? data.message : 'No peaks were found near the expected m/z in this file.')], {}, where, { size: 9 }); return; }
    const found = str(v.found).trim();
    const near = centre !== null ? ` The largest peaks near m/z ${centre.toFixed(4)}:` : ' The largest peaks:';
    this.para([R(summary(data) + near)], { keepNext: true, spaceAfter: 4 }, where, { size: 9 });
    const cell = (text: string, align: 'left' | 'right', o: { italic?: boolean } = {}): TableCell => ({ runs: [{ text, size: 9, ...o }] as TextRun[], align });
    const head: TableCell[] = [{ runs: [{ text: 'm/z', size: 9, italic: true }] as TextRun[], align: 'right' }, cell('Intensity (%)', 'right'), cell('', 'left')];
    const body = rows.map(([mz, rel]): TableCell[] => [cell(mz.toFixed(4), 'right'), cell(rel.toFixed(1), 'right'), cell(formatMz(mz) === found ? 'found m/z' : '', 'left')]);
    this.b.table({ kind: 'table', table: { cols: [70, 80, 70], rows: [head, ...body], head: 1, lines: 'acs', size: 9, width: 'auto', autofit: true, align: ['right', 'right', 'left'] } }, this.full({ align: 'center', spaceAfter: 12 }));
  }

  private references(): void {
    if (!this.cited) return;
    this.para([R('References')], { style: this.headingStyle(1, this.lists.references), pageBreak: true }, 'References');
    this.b.object({ kind: 'bib' });
    this.b.endPara(this.full({}));
  }

  // -------------------------------------------------------------- the whole

  /** One page of the project alone (the live preview), without spectra or the references list; page numbers are placeholders. */
  private async buildOnly(only: SiPreviewTarget): Promise<void> {
    const p = this.p;
    if (only.kind === 'whole') {
      // the whole SI but its Spectra section (the live preview shows that as a document of its own)
      this.whole = true;
      this.excluded.add('spectra');
      this.spectraDone = true;
      await this.buildAll();
    } else if (only.kind === 'front') {
      if (this.included('cover')) await this.cover();
      if ((this.texts.get('general') ?? '').trim()) { if (this.included('cover')) this.b.pendingBreak = true; await this.general(); }
    } else if (only.kind === 'compound') {
      const c = p.compounds.find((x) => x.id === only.id);
      if (c) await this.compound(c, 2);
    } else if (only.kind === 'scheme') {
      const k = p.schemes.find((x) => x.id === only.id);
      const s = k ? p.sections.find((x) => x.id === k.sectionId) : undefined;
      if (k && s) { const drawn = await this.scheme(k, s); for (const c of k.children) await this.compound(c, 2, drawn.has(c.id)); }
    } else if (only.kind === 'spectra') {
      // a compound's spectra pages, as they print in the Spectra section (without its heading)
      const c = p.compounds.find((x) => x.id === only.id);
      if (c) { this.spectraDone = true; await this.spectraSection(p.sections.find((x) => x.type === 'spectra') ?? null, 1, [c]); }
    } else {
      const s = p.sections.find((x) => x.id === only.id);
      if (s?.type === 'spectra') { this.excluded.delete(s.id); this.excluded.delete('spectra'); this.spectraDone = true; await this.spectraSection(s, 1); }
      // (a section's spectra are left out: Compile shows them)
      else if (s) { this.excluded.delete(s.id); this.spectraDone = true; await this.section(s, 1); }
    }
  }

  /** The compounds the document (or the preview's page) prints. */
  private printedCompounds(only?: SiPreviewTarget): SiCompound[] {
    if (!only || only.kind === 'whole') return this.includedCompounds(this.p.top);
    if (only.kind === 'compound') return this.p.compounds.filter((c) => c.id === only.id);
    if (only.kind === 'scheme') return this.p.schemes.find((k) => k.id === only.id)?.children ?? [];
    if (only.kind === 'spectra') return this.p.compounds.filter((c) => c.id === only.id);
    if (only.kind === 'section') {
      const s = this.p.sections.find((x) => x.id === only.id);
      if (s?.type === 'spectra') return this.includedCompounds(this.p.top);
      return s ? [...(s.type === 'data' ? compoundsOf(s) : []), ...this.includedCompounds(s.children)] : [];
    }
    return [];
  }

  async build(only?: SiPreviewTarget): Promise<DocText> {
    this.preview = !!only;
    this.progressTotal = this.printedCompounds(only).length;
    await this.prepare(this.printedCompounds(only));
    if (only) await this.buildOnly(only);
    else await this.buildAll();
    const title = str(this.p.settings.title);
    const p = this.b.doc.page;
    const { hf, format } = this.pageLines(p.w - p.left - p.right);
    // (the live preview keeps the links to pages it leaves out, so it shows them as they print)
    const finish = this.preview ? (t: DocText): DocText => t : (t: DocText): DocText => dropDeadLinks(t, this.linkLook);
    return finish(this.b.finish({
      styles: this.styles,
      hf,
      ...(format !== 'decimal' ? { numFormat: format } : {}),
      references: this.p.references.map(toReference),
      props: { title: title || this.p.title },
      noFigureOffer: true,
    }));
  }

  private async buildAll(): Promise<void> {
    let started = false;
    const startPage = (): void => { if (!started && (this.included('cover') || this.included('toc'))) this.b.pendingBreak = true; started = true; };
    await this.block('project', async () => {
      if (this.included('cover')) await this.cover();
      if (this.included('toc')) this.toc();
      if (this.included('general') && (this.texts.get('general') ?? '').trim()) { startPage(); await this.general(); }
    });
    for (const s of this.p.top) { if (!this.excluded.has(s.id)) startPage(); await this.section(s, 1); }
    // a project without a Spectra section (opened read-only, older) prints its spectra at the end
    if (!this.spectraDone && !this.excluded.has('spectra') && !this.p.sections.some((s) => s.type === 'spectra')) { this.spectraDone = true; await this.spectraSection(null, 1); }
    this.orient('portrait');
    this.references();
  }
}

const plainOf = (runs: Run[]): string => runs.map((r) => r.text).join('').trim();

export { coverSpacing } from './front-layout';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** What a spectrum's structure box holds (see Compiler.boxParts). */
interface BoxParts { mol: string; contents: Contents | null; own: { w: number; h: number } | null; id: string; caption: string }

/** The room the Spectra section's heading takes at the top of its first page (points). */
const HEADING_ROOM = 34;
/** The spectra the live preview of the whole Spectra section shows (Compile prints them all). */
export const PREVIEW_SPECTRA = 12;

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
    if (r.link) l.link = r.link;
    for (const k of Object.keys(l) as (keyof TextRun)[]) if (l[k] === undefined) delete l[k];
    return l;
  });
}

/**
 * Links to places the compiled SI doesn't have taken off (a compound's spectra left out of it, a
 * compound not printed): the text stays, in the look of the text round it.
 */
function dropDeadLinks(t: DocText, look: RunStyle): DocText {
  const marks = new Set(bookmarksOf(t).map((b) => b.name));
  const fix = (runs: TextRun[]): TextRun[] => runs.map((r) => {
    if (!r.link?.startsWith('#si_') || marks.has(r.link.slice(1))) return r;
    const { link: _l, ...rest } = r;
    if (look.color && rest.color === look.color) delete rest.color;
    if (look.underline && rest.underline) delete rest.underline;
    return rest;
  });
  const objects = Object.fromEntries(Object.entries(t.objects).map(([k, o]) => [k, o.kind === 'textbox' ? { ...o, runs: fix(o.runs) } : o]));
  return { ...t, runs: fix(t.runs), objects };
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
    ...(str(r.typed).trim() ? { typed: str(r.typed) } : {}),
  };
}

/** The project's own words to print as written (dictionary.txt), lower case. */
async function leaveWords(p: SiProject): Promise<Set<string>> {
  return new Set((await dictionaryWords(p.folder)).map((w) => w.toLowerCase()));
}

/**
 * The labels the compiled SI gives its tables, figures and schemes ("Table S1"), by their ids, as
 * a mention of one shows them in the SI tab. Only the files are read (no structures are worked
 * out), so it is quick.
 */
export async function objectLabels(p: SiProject): Promise<Map<string, string>> {
  return (await objectLabelSets(p)).labels;
}

/** Every table's, figure's and scheme's label (`labels`: as it prints, a typed one included; `auto`: the numbered one it gets without a typed one). */
export async function objectLabelSets(p: SiProject): Promise<{ labels: Map<string, string>; auto: Map<string, string> }> {
  const c = new Compiler(p, { contentsOf: () => null, sizeOf: () => null, facts: async (m) => m.map(() => null) }, new Set());
  await c.prepare();
  return { labels: c.labels.byId, auto: c.labels.autoById };
}

/** Compile an SI project into a document. */
/** What the live preview shows: the front matter (cover and General Information), a section, a scheme page or a compound. */
/** What the live preview shows: the front pages, a section, a scheme page, a compound, or a compound's spectra pages ('spectra', by the compound's id). */
export type SiPreviewTarget = { kind: 'front' } | { kind: 'whole' } | { kind: 'section' | 'scheme' | 'compound' | 'spectra'; id: string };

/** How many pages the Spectra section prints before compound `id`'s spectra (see Compiler.spectraPagesBefore). */
export async function spectraPagesBefore(p: SiProject, host: CompileHost, id: string, pagesOf: (file: string, bytes: Uint8Array) => Promise<number | null>): Promise<number> {
  return new Compiler(p, host, new Set()).spectraPagesBefore(id, pagesOf);
}

/** How the SI is compiled beyond what is in it: `flagComments`, the flags on the SI page as Word comments on the text of their fields. */
export interface CompileOptions { flagComments?: boolean }

/** Compile the project (or, with `only`, one page of it for the live preview) into a document. */
export async function compileSi(p: SiProject, host: CompileHost, only?: SiPreviewTarget, options: CompileOptions = {}): Promise<CompiledSi> {
  const styleLooks = await readStyleLooks(p.folder);
  const c = new Compiler(p, host, await leaveWords(p), styleLooks);
  const doc = await c.build(only);
  applyStyleLooks(doc.styles, styleLooks);
  // the text typed in the Live Preview where no field is, back in its places (custom-text.ts)
  const whole = !only || only.kind === 'whole';
  const own = only?.kind === 'spectra' ? { items: [], newer: false } : await readCustomTextForCompile(p.folder);
  // (a file a newer Chemweave wrote isn't used, and is never written over: said, so the text isn't thought lost)
  if (own.newer) c.notes.push(`The custom text typed in the Live Preview (${CUSTOM_TEXT_FILE}) was saved by a newer Chemweave and isn’t shown. Update Chemweave to see it.`);
  const items = own.items.filter((x) => whole || c.blocks.some((b) => b.node === x.node));
  const put = items.length ? placeCustomText(doc, c.sources, c.blocks, items) : { doc, sources: c.sources, blocks: c.blocks, placed: [] };
  // the formatting done in the Live Preview that the fields can't hold, put back (preview-format.ts)
  const fmt = only?.kind === 'spectra' ? { items: [], newer: false } : await readPreviewFormatsForCompile(p.folder);
  if (fmt.newer) c.notes.push(`Your formatting and links from the Live Preview (${PREVIEW_FORMAT_FILE}) were saved by a newer Chemweave and aren’t shown. Update Chemweave to see them.`);
  const looks = fmt.items;
  const formatted = looks.length ? applyPreviewFormats(put.doc, put.sources, put.blocks, looks) : put.doc;
  const done = options.flagComments ? addFlagComments(formatted, put.sources, put.blocks, p) : formatted;
  return { doc: done, notes: [...new Set(c.notes)], targets: c.targets, sources: put.sources, blocks: put.blocks, custom: put.placed, structures: c.structures };
}


/** A section or compound starts on a new page (SI Assistant's "page_flow": {"new_page": true}). */
export function startsNewPage(data: Json): boolean {
  // (read as SI Assistant reads it: Python's bool())
  const v = dict(data.page_flow).new_page;
  return Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v;
}

/** A section's own orientation (Chemweave's "orientation"), or null: it follows its section's (upright at the top). The Spectra section sets its own pages. */
export function ownOrientation(s: SiSection): 'landscape' | 'portrait' | null {
  if (s.type === 'spectra') return null;
  return s.data.orientation === 'landscape' || s.data.orientation === 'portrait' ? s.data.orientation : null;
}

/** A section's pages are on their side: its own orientation, else its section's (`parentOf` finds that). */
export function sectionLandscape(s: SiSection, parentOf: (s: SiSection) => SiSection | null): boolean {
  if (s.type === 'spectra') return false;
  for (let at: SiSection | null = s; at; at = parentOf(at)) { const o = ownOrientation(at); if (o) return o === 'landscape'; }
  return false;
}

/** Start a section or compound on a new page, or not (SI Assistant's "page_flow", its other keys kept). */
export function setNewPage(data: Json, on: boolean): void {
  const flow: Json = { ...dict(data.page_flow) };
  if (on) flow.new_page = true; else delete flow.new_page;
  if (Object.keys(flow).length) data.page_flow = flow; else delete data.page_flow;
}
