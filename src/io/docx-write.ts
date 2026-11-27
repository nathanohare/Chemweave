// Saving a document as a Word file (.docx). Paragraphs keep their named styles (Normal,
// Heading 1…, defined in the file's styles part, so changing a style in Word changes the
// document there too) and carry only the formatting that differs from their style. Lists are
// Word lists, tables Word tables, captions SEQ fields and cross-references REF fields to
// bookmarks round the caption's label and number, as Word's own Insert Caption and
// Cross-reference make them. Page numbers are PAGE fields in the footer or header.
// Citations are ADDIN fields (as reference managers write them) whose result is the numbers
// in superscript, which Word shows and leaves alone; the bibliography is ordinary paragraphs
// inside a hidden bookmark. Our own part keeps the references, so they come back here live.
// For a document whose citations belong to Zotero, Mendeley or EndNote, citations and the
// bibliography are that program's own fields instead, so it goes on managing them (live-cites.ts).
// Footnotes and endnotes are Word's own (footnotes.xml and endnotes.xml), and a table of figures
// is Word's TOC field for a caption label (\c "Figure").

import { allHf, hfFieldText, numbersFor, zonesFor } from '../document/hf-bodies';
import type { CellBorders, Contents, Justify, ParaStyle, PictureFx, TableData, TextRun } from '../model';
import { bakedPart } from '../render/picture-fx';
import { blipEffectsXml, imgPropsXml, pictureGeomXml } from './picture-xml';
import { DEFAULT_MARGINS, builtInStyle } from '../document/table-styles';
import { PLAIN_LOOK, borderXml, bordersXml, lookXml as tableLookXml, marginsXml, rowHeightXml, tableFloatXml, tableStyleXml, tableWidthXml } from './docx-table-styles';
import { BORDER_SPACE, cleanBorders } from '../document/para-borders';
import { fieldInstr } from '../document/fields';
import type { DocStyle } from '../style';
import * as rt from '../richtext';
import { Package, REL, NS, xml, xmlAttr, hex6, emu, MediaFiles, bytesHash, structureAltText } from './ooxml';
import { fragment, wordTablePrint } from './native-print';
import { contentsAlt } from '../accessibility';
import { THEMES, THEME_COLORS, THEME_FONTS, type DocDesign } from '../document/themes';
import { DEFAULT_THEME, type WorkbookTheme } from '../sheet/themes';
import { themeXml } from './xlsx-view';
import { facesToEmbed, newGuid, obfuscate, type FontSource } from './font-embed';
import { fromDataUrl } from '../render/images';
import { chemdrawProg, chemdrawObject, embeddedPart, OLE_REL, OLE_TYPE } from './ole-object';
import { BULLETS, fitParas, listInfo, paraCount, samePara, schemeOf, splitParagraphs, type ListInfo } from '../text/paragraphs';
import { BOX_PAD, COL_GAP, COMPOUND, compoundSeqs, END_FORMAT, FOOT_FORMAT, columnsOf, contentsPrint, OBJECT_CHAR, SHADOWS, charStylesOf, watermarkPlace, fieldTexts, floatOf, floatGaps, lookExtent, lookOf, noteStyle, objectsInText, pruneObjects, EMPTY_FORM, styleOf, runStyleOf, type CharStyle, type DocObject, type DocText, type Embedded, type FigureFrame, type FigureLook, type HeaderFooter, type HfBody, type HfKey, type NamedStyle, type PageBorder, type PageSetup, type TocLook, type Watermark, type WordPane } from '../document/document';
import { ACS_LINE, GRID_LINE, bibHang, docCellAlign, shownSize } from '../document/doc-layout';
import { hasTitlePg, sectionsOf, type Section } from '../document/sections';
import { bibliography, piecesText, type Reference } from '../document/references';
import { preferredStyle } from '../document/cite-styles';
import { bibInstr, newZoteroPrefs, splitPrefs, writeCite } from '../document/live-cites';
import { TOC_INDENT, tocEntries, tocMark, tofEntries } from '../document/toc';
import { INDEX_INDENT, authorities, indexInstr, indexItems, taInstr, toaInstr, toaItems, xeInstr, type ListItem } from '../document/index-toa';
import { ALG_SIDS, type Protection } from '../document/protect';
import { parseFmt, parseRev } from '../document/revisions';
import { officeTarget } from '../links';
import { cleanNoteRuns, cmtIds, initials, noteRuns, placedComments, sliceNoteRuns, type CommentNote, type CommentThread, type NoteRun } from '../document/comments';
import { toOmml } from '../document/math';
import { documentMeasure } from '../text/font-measure';
import { arialWidth } from '../text-metrics';
import { PAD_X, PAD_Y, cellAlign, coveringCell, isCovered, rowSpanOf, spanOf } from '../table';
import { connectorSpPr, geoGeomXml, geoSpPr, xfrm } from './pptx-write';
import { geoDef } from '../design/geo';
import { shapeOrder } from '../objects';
import { addChart, C_NS } from './office-chart';
import { CX_NS, CX1_NS } from './xlsx-chart';
import { isChartEx } from '../sheet/chart';
import type { ChartBox } from '../sheet/chart-box';
import { appPropsXml, corePropsXml, relativeTarget, writeKeptParts, writeTree, type ContentControl, type KeptTree } from './kept-parts';
import { settingsChildren } from './docx-settings';
import { cmlGuid, contentsSig, writeCml } from './cml';
import {
  BIB_MARK, CHART_NAME, CITE_FIELD, SI_FIELD, CONT_MARK, HEAD_MARK, DOCX_CT, W14_FX, W14_NS, W15_NS, W16CID_NS, W16CEX_NS, w14Look, w14Parts, DOCX_REL, DRAWING_NAME, FORMULA_STYLE, MODEL_NS, MC_NS, M_NS, PIC_NS, TABLE_MARK, W_NS, WORD_HIGHLIGHTS, WP_NS, WPS_NS, WPG_NS, twips, toWordDate, type DocxModel,
} from './docx-base';
import { minOf, maxOf } from './min-max';
import { stackOrder } from '../document/arrange';

export interface DocxDeps {
  /** A drawing's picture for Word: PNG bytes, an SVG Word shows instead when it can, and its own size in points. */
  /** A drawing's picture: just round what is drawn, or a figure's whole area (`frame`, never cut short of what is drawn). */
  picture(contents: Contents, style: DocStyle, frame?: FigureFrame): Promise<{ png: Uint8Array; svg?: string; w: number; h: number; x?: number; y?: number; /** The same picture as an EMF, for a ChemDraw object to show until it is opened. */ emf?: Uint8Array } | null>;
  /** A PNG of an SVG picture, for Word versions that can't show SVG (w × h pixels). */
  svgToPng?(svg: string, w: number, h: number): Promise<Uint8Array>;
  /** A picture Word can't hold (WebP) as PNG; null when it can't be read. Without it such pictures are left out. */
  pictureToPng?(bytes: Uint8Array, mime: string): Promise<Uint8Array | null>;
  /**
   * A picture with its sharpening and Remove Background worked in, as PNG (Word keeps those
   * worked in, with the original beside it). Without it they are left off.
   */
  bakePicture?(p: { src: string; fx?: PictureFx; crop?: { l: number; t: number; r: number; b: number }; px?: { w: number; h: number } }): Promise<Uint8Array | null>;
  /** A drawing's structures as SMILES, for the picture's alt text (null when there are none, or no chemistry engine). */
  smiles?(contents: Contents, style: DocStyle): Promise<string | null>;
  /** The free fonts that come with the app, to put inside the file when the document uses them. */
  fonts?: FontSource;
  /** Each paragraph's page number as laid out here, for the contents (without it Word works them out when the file opens). */
  pages?(t: DocText): string[] | undefined;
  /** A drawing as CDX, ChemDraw's own format, for a ChemDraw object (null when it can't be written). */
  cdx?(contents: Contents, style: DocStyle): Uint8Array | null;
  /**
   * Structures and schemes saved as ChemDraw objects (a double-click in Word opens them in
   * ChemDraw); otherwise as pictures. One that came from a ChemDraw object goes back as one either way.
   */
  chemdrawObjects?: boolean;
}

/** The namespaces of a part of the text (body, header, footer, notes). Word 2010's text effects (w14)
 * and Word 2013's content control settings (w15) are marked ignorable, as Word marks them, so a
 * program that doesn't know them (Word 2007, others) skips them rather than refusing the file. */
const PART_NS = `xmlns:w="${W_NS}" xmlns:r="${NS.r}" xmlns:wp="${WP_NS}" xmlns:a="${NS.a}" xmlns:pic="${PIC_NS}" xmlns:wps="${WPS_NS}" xmlns:wpg="${WPG_NS}" xmlns:mc="${MC_NS}" xmlns:m="${M_NS}" xmlns:w14="${W14_NS}" xmlns:w15="${W15_NS}" mc:Ignorable="w14 w15"`;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-emf': 'emf', 'image/x-wmf': 'wmf',
  'image/svg+xml': 'svg', 'image/tiff': 'tiff',
};
/** Picture types Word can't show, saved as PNG instead (ECMA-376 lists no WebP; never the bytes relabelled). */
const AS_PNG = new Set(['image/webp']);
const EXT_TYPE: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', emf: 'image/x-emf', wmf: 'image/x-wmf', svg: 'image/svg+xml', tiff: 'image/tiff',
};
/** Word's names for its built-in styles (so Word treats ours as its own: the Navigation Pane, Insert Caption…). */
const WORD_NAMES: Record<string, string> = {
  Normal: 'Normal', Title: 'Title', Caption: 'caption',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Heading${n}`, `heading ${n}`])),
};
/**
 * Names of Word's built-in styles, as Word writes them in w:name (ECMA-376 part 1, 17.7.4.9: a
 * style with one of them is Word's own, not marked w:customStyle). These are the names Word lists
 * in its own files' w:latentStyles (17.7.4.5); a file read also brings its own list.
 */
const range = (stem: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${stem} ${from + i}`);
const ACCENTS = ['', ...[1, 2, 3, 4, 5, 6].map((n) => ` Accent ${n}`)];
const GRID_KINDS = ['Light', '', '', '', '', 'Dark', 'Colorful', 'Colorful'];
export const WORD_BUILT_IN_NAMES: readonly string[] = [
  'Normal', ...range('heading', 1, 9), ...range('index', 1, 9), ...range('toc', 1, 9), 'Normal Indent', 'footnote text', 'annotation text', 'header', 'footer',
  'index heading', 'caption', 'table of figures', 'envelope address', 'envelope return', 'footnote reference', 'annotation reference', 'line number', 'page number',
  'endnote reference', 'endnote text', 'table of authorities', 'macro', 'toa heading', 'List', 'List Bullet', 'List Number', ...range('List', 2, 5),
  ...range('List Bullet', 2, 5), ...range('List Number', 2, 5), 'Title', 'Closing', 'Signature', 'Default Paragraph Font', 'Body Text', 'Body Text Indent',
  'List Continue', ...range('List Continue', 2, 5), 'Message Header', 'Subtitle', 'Salutation', 'Date', 'Body Text First Indent', 'Body Text First Indent 2',
  'Note Heading', 'Body Text 2', 'Body Text 3', 'Body Text Indent 2', 'Body Text Indent 3', 'Block Text', 'Hyperlink', 'FollowedHyperlink', 'Strong', 'Emphasis',
  'Document Map', 'Plain Text', 'E-mail Signature', 'HTML Top of Form', 'HTML Bottom of Form', 'Normal (Web)', 'HTML Acronym', 'HTML Address', 'HTML Cite',
  'HTML Code', 'HTML Definition', 'HTML Keyboard', 'HTML Preformatted', 'HTML Sample', 'HTML Typewriter', 'HTML Variable', 'Normal Table', 'annotation subject',
  'No List', 'Outline List 1', 'Outline List 2', 'Outline List 3', 'Balloon Text', 'Table Grid', 'Table Theme', 'Placeholder Text', 'No Spacing', 'Revision',
  'List Paragraph', 'Quote', 'Intense Quote', 'Subtle Emphasis', 'Intense Emphasis', 'Subtle Reference', 'Intense Reference', 'Book Title', 'Bibliography',
  'TOC Heading', 'Table Grid Light', ...range('Plain Table', 1, 5), 'Mention', 'Smart Hyperlink', 'Hashtag', 'Unresolved Mention', 'Smart Link',
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => ACCENTS.flatMap((a) => [`Grid Table ${n}${GRID_KINDS[n] ? ` ${GRID_KINDS[n]}` : ''}${a}`, `List Table ${n}${GRID_KINDS[n] ? ` ${GRID_KINDS[n]}` : ''}${a}`])),
];
const BUILT_IN_BY_LOWER = new Map(WORD_BUILT_IN_NAMES.map((n) => [n.toLowerCase(), n]));

/** A style name as Word writes it when it is one of Word's built-in styles (`more` adds a file's own list); null for anyone else's. */
export function wordBuiltInName(name: string, more?: ReadonlyMap<string, string>): string | null {
  const k = name.trim().toLowerCase();
  return BUILT_IN_BY_LOWER.get(k) ?? more?.get(k) ?? null;
}

const PRIORITY: Record<string, number> = { Normal: 0, Title: 10, Caption: 35, ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Heading${n}`, 9])) };
/** Word's own character styles, by id: their names, and where Word lists them. */
const WORD_CHAR: Record<string, [string, number]> = { Emphasis: ['Emphasis', 20], Strong: ['Strong', 22], SubtleEmphasis: ['Subtle Emphasis', 19], IntenseEmphasis: ['Intense Emphasis', 21], Hyperlink: ['Hyperlink', 99], FollowedHyperlink: ['FollowedHyperlink', 99] };
/** Word's link styles: not in its Quick Styles gallery, shown in its lists once used (as Word writes them). */
const WORD_LINK_CHAR: Record<string, string> = { Hyperlink: '<w:unhideWhenUsed/>', FollowedHyperlink: '<w:semiHidden/><w:unhideWhenUsed/>' };
const JC: Record<Justify, string> = { left: 'left', center: 'center', right: 'right', justify: 'both' };

/**
 * What a paragraph looks like apart from what is only its own (its line, page or column break
 * above, bookmarks, index entries).
 */
const lineless = (p: ParaStyle): ParaStyle => ({ ...p, soft: undefined, cont: undefined, marks: undefined, xe: undefined, ta: undefined, pageBreak: undefined, colBreak: undefined });
/**
 * Whether a paragraph carrying on the one before it after a line break (Shift+Enter), or a page or
 * column break inside the paragraph (Ctrl+Enter mid-line), goes in that Word paragraph: they look the same.
 */
const joins = (prev: ParaStyle | undefined, ps: ParaStyle): boolean =>
  !!ps.soft && !!prev && !ps.section && samePara(lineless(prev), lineless(ps));
/**
 * What starts the paragraph after it below the figures floating beside it (ParaStyle.clear): a
 * paragraph exactly 1 point high holding a text wrapping break that clears them (ECMA-376 part 1
 * §17.3.3.1, w:clear="all"), so the next one starts at the left margin below them. Read back as
 * the next paragraph's `clear` (docx-read.ts isClearPara).
 */
export const CLEAR_PARA = '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr><w:br w:type="textWrapping" w:clear="all"/></w:r></w:p>';
/**
 * A page or column break with nothing after it in its paragraph: written as an empty paragraph
 * with the break before it, as before, since a Word paragraph ending in a page break keeps its mark
 * on the break's page (Word 2013 on) and the empty line, or a second break, would be lost (review).
 */
const emptyBreak = (ps: ParaStyle, runs: TextRun[]): boolean => !!(ps.pageBreak || ps.colBreak) && !runs.some((r) => r.text || r.obj !== undefined);
/** A Word paragraph with another's runs added after a line break (or the page or column break `ps` starts with). */
const joinTo = (para: string, body: string, ps?: ParaStyle): string =>
  `${para.slice(0, -'</w:p>'.length)}<w:r><w:br${ps?.pageBreak ? ' w:type="page"' : ps?.colBreak ? ' w:type="column"' : ''}/></w:r>${body}</w:p>`;

/** Save a document as a Word file. */
const THEME_CT = 'application/vnd.openxmlformats-officedocument.theme+xml';

/**
 * A document's Design theme as an Office theme: its heading and body fonts (major and minor) and
 * its colours (text, headings as Text 2, the six accents); null when no theme, fonts or colours were chosen.
 */
export function wordTheme(d: DocDesign | undefined): WorkbookTheme | null {
  if (!d || (!d.theme && !d.fonts && !d.colors)) return null;
  const th = THEMES.find((x) => x.name === d.theme);
  const f = THEME_FONTS.find((x) => x.name === (d.fonts ?? th?.fonts));
  const c = THEME_COLORS.find((x) => x.name === (d.colors ?? th?.colors));
  if (!f && !c) return null;
  const office = DEFAULT_THEME;
  const colors = c
    ? [c.text ?? '#000000', '#ffffff', c.heading, '#e7e6e6', ...c.accents.slice(0, 6), '#0563c1', '#954f72']
    : office.colors;
  return { name: d.theme ?? f?.name ?? c?.name ?? 'Chemweave', major: f?.heading ?? office.major, minor: f?.body ?? office.minor, colors };
}

export async function writeDocx(t: DocText, deps: DocxDeps, title = ''): Promise<Uint8Array> {
  return new DocxWriter(pruneObjects(t), deps, deps.pages?.(t)).write(title);
}

class DocxWriter {
  private pkg = new Package();
  private docPr = 1;
  /**
   * Each floating drawing's place in Word's stack (wp:anchor's relativeHeight), from the back: the
   * text's floats as they are drawn here (arrange's stackOrder: by z, else in the order of the text)
   * above those of headers, footers and the like (`others`, numbered in the order written, as the
   * reader reads them first and Word draws them under the text). So each has its own place, and a
   * stack in the text's order reads back with none of its own (no z) and is numbered the same again.
   */
  private stackAt: Map<object, number> | null = null;
  /** The floats not in the text's stack written so far. */
  private others = 0;
  private bookmarkId = 0;
  /** Content controls' ids (Mendeley Cite's citations). */
  private sdtId = 1;
  /** Form fields' names (each is a bookmark in Word, so each must differ). */
  private formNames = new Map<string, number>();
  private shown: Map<number, string>;
  /** The headings and captions a contents or table of figures lists: each gets the hidden bookmark its line links to (tocMark). */
  private tocTargets = new Set<number>();
  /** Bookmark names of the captions that references point to, by the caption's number field. */
  private bookmarks = new Map<number, string>();
  private model: DocxModel;
  private textW: number;
  private fullW: number;
  /** The comments to write (those on some text), by their ids here: each one's Word id, and its replies'. */
  private cmts = new Map<number, { c: CommentThread; wid: number; replies: number[] }>();
  /** How much of each comment's text is still to be written (its range closes when none is left). */
  private cmtLeft = new Map<number, number>();
  private cmtOpen = new Set<number>();
  /** Word's ids of the footnotes and endnotes, by our object id (each kind from 1, in order). */
  private noteIds = new Map<number, number>();
  private charStyles: Record<string, CharStyle>;
  /** Word's lists (numbering.xml): the levels of each kind of list (abstractNum), and each list using them (num, by numId from 1). */
  private abstractNums = new Map<string, number>();
  /** Each list's levels (abs), whether it counts from 1 (restart), and a level it starts again at a number of its own (at). */
  private nums: { abs: number; restart: boolean; at?: { level: number; value: number }; kept?: string }[] = [];
  /** Each list's kind (its key), by numId − 1. */
  private numKeys: string[] = [];
  /**
   * Word lists kept from the file read: their ids there to the ids written (see numbering()). The
   * file's lists are written first, under ids 1 on (their levels under 0 on), and those made here
   * after them, so no id is used twice however many there are.
   */
  private keptNumIds = new Map<string, string>();
  /** The kept levels (abstractNum, its id in the file) each kept list uses, by the id it is written with. */
  private keptAbsOf = new Map<string, string>();
  /** For each kept list (its id in the file), the list its items carry on in: itself, or one made on its levels starting again (G2-13). */
  private keptRun = new Map<string, string>();
  /** Word's count at each level of each kept set of levels, as Word will number the items written so far (ECMA-376 part 1 §17.9). */
  private wordCounts = new Map<string, { c: (number | undefined)[]; pend: (number | undefined)[] }>();
  private wordUsed = new Set<string>();
  /** The number shown here on the list item being written (a body paragraph's; unset elsewhere). */
  private shownN: number | undefined;
  private get keptNumCount(): number { return this.t.kept?.numbering?.nums.length ?? 0; }
  private get keptAbsCount(): number { return this.t.kept?.numbering?.abs.length ?? 0; }
  /** The one list each kind of bulleted list (and each numbered list in table cells) shares. */
  private sharedNums = new Map<string, number>();

  /** A Word list of a kind ('b' and its bullet, or 'n' and its scheme): its numId. */
  private addNum(key: string, restart: boolean, at?: { level: number; value: number }): number {
    let abs = this.abstractNums.get(key);
    if (abs === undefined) { abs = this.abstractNums.size; this.abstractNums.set(key, abs); }
    this.nums.push({ abs, restart, ...(at ? { at } : {}) });
    this.numKeys.push(key);
    return this.nums.length;
  }

  /** A new numbered list, counting from 1 (or from its first item's own number). */
  private newList(key: string, start?: number): number {
    return this.addNum(key, true, start !== undefined ? { level: 0, value: start } : undefined);
  }

  private sharedNum(key: string): number {
    let id = this.sharedNums.get(key);
    if (id === undefined) { id = this.addNum(key, false); this.sharedNums.set(key, id); }
    return id;
  }

  private keptLevelsMemo = new Map<string, { start: number[]; restart: (number | undefined)[] }>();
  /** A kept set of levels' start values and restarts (w:start, w:lvlRestart), from its XML (read once). */
  private keptLevels(abs: string): { start: number[]; restart: (number | undefined)[] } {
    const known = this.keptLevelsMemo.get(abs);
    if (known) return known;
    const lv = this.readKeptLevels(abs);
    this.keptLevelsMemo.set(abs, lv);
    return lv;
  }
  private readKeptLevels(abs: string): { start: number[]; restart: (number | undefined)[] } {
    const x = this.t.kept?.numbering?.abs.find((a) => a.id === abs)?.xml ?? '';
    const start: number[] = [], restart: (number | undefined)[] = [];
    for (const m of x.matchAll(/<w:lvl\b[^>]*?w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const i = Number(m[1]);
      start[i] = Number(/<w:start w:val="(-?\d+)"/.exec(m[2])?.[1] ?? 0);
      const r = /<w:lvlRestart w:val="(\d+)"/.exec(m[2]);
      if (r) restart[i] = Number(r[1]);
    }
    return { start, restart };
  }

  /** The start overrides of a written list (w:lvlOverride/w:startOverride): a kept one's from its XML, one made here from its own. */
  private startsOf(id: string): Map<number, number> {
    const out = new Map<number, number>();
    const n = Number(id);
    if (n <= this.keptNumCount) {
      const x = this.t.kept?.numbering?.nums[n - 1]?.xml ?? '';
      for (const m of x.matchAll(/<w:lvlOverride w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvlOverride>/g)) {
        const v = /<w:startOverride w:val="(-?\d+)"/.exec(m[2]);
        if (v) out.set(Number(m[1]), Number(v[1]));
      }
    } else {
      const e = this.nums[n - this.keptNumCount - 1];
      if (e?.at) out.set(e.at.level, e.at.value);
    }
    return out;
  }

  /**
   * The number Word gives the next item of written list `id` (on kept levels `abs`) at level `L`,
   * counted as the file reader counts (docx-read.ts listNumbers); `commit` counts the item.
   */
  private wordNext(id: string, abs: string, L: number, commit: boolean): number {
    const lv = this.keptLevels(abs);
    const was = this.wordCounts.get(abs) ?? { c: [], pend: [] };
    const st = commit ? was : { c: [...was.c], pend: [...was.pend] };
    if (commit) this.wordCounts.set(abs, st);
    if (!this.wordUsed.has(id)) {
      for (const [l, v] of this.startsOf(id)) st.pend[l] = v;
      if (commit) this.wordUsed.add(id);
    }
    if (st.pend[L] !== undefined) { st.c[L] = st.pend[L]; st.pend[L] = undefined; } else st.c[L] = st.c[L] === undefined ? lv.start[L] ?? 0 : st.c[L]! + 1;
    for (let m = L + 1; m < 9; m++) {
      const r = lv.restart[m];
      const after = r === undefined || r > m ? m : r;
      if (after > 0 && L < after) st.c[m] = undefined;
    }
    return st.c[L]!;
  }

  /**
   * The Word list for an item of a list kept from the file (its id there), at level `L`: the list its
   * items have been written in while Word's number for it is the one shown here, else a new list on
   * the same kept levels that starts that level again at the shown number. Undefined: not a kept
   * list item (or no number known), so it takes a list made here.
   */
  private keptListId(fileId: string, L: number, numbered: boolean): string | undefined {
    const kept = this.keptNumIds.get(fileId);
    if (!kept) return undefined;
    const abs = this.keptAbsOf.get(kept)!;
    if (!numbered) { this.wordNext(kept, abs, L, true); return kept; }
    const shown = this.shownN;
    if (shown === undefined) return undefined;
    let id = this.keptRun.get(fileId) ?? kept;
    if (this.wordNext(id, abs, L, false) !== shown) {
      this.nums.push({ abs: -1, kept: abs, restart: false, at: { level: L, value: shown } });
      this.numKeys.push('');
      id = String(this.nums.length + this.keptNumCount);
      this.keptRun.set(fileId, id);
      this.keptAbsOf.set(id, abs);
    }
    this.wordNext(id, abs, L, true);
    return id;
  }

  constructor(private t: DocText, private deps: DocxDeps, private pages?: string[]) {
    // the file's own lists, under ids of their own past ours (their definitions are written back whole)
    t.kept?.numbering?.nums.forEach((n, i) => { this.keptNumIds.set(n.id, String(i + 1)); this.keptAbsOf.set(String(i + 1), n.abs); });
    this.shown = fieldTexts(t, pages ? (p) => pages[p] ?? '' : undefined, pages ? Math.max(1, ...pages.map((x) => Number(x) || 0)) : undefined);
    this.charStyles = charStylesOf(t);
    for (const o of Object.values(t.objects)) {
      if (o.kind === 'toc' && !o.noLinks) for (const e of tocEntries(t, o.levels)) this.tocTargets.add(e.para);
      if (o.kind === 'tof') for (const e of tofEntries(t, o.name, this.shown)) this.tocTargets.add(e.para);
    }
    let foot = 0, end = 0;
    for (const id of objectsInText(t.runs)) {
      const o = t.objects[id];
      if (o?.kind === 'note' && !this.noteIds.has(id)) this.noteIds.set(id, o.end ? ++end : ++foot);
    }
    for (const o of Object.values(t.objects)) {
      if (o.kind === 'ref' && t.objects[o.target]?.kind === 'seq') this.bookmarks.set(o.target, `_Ref${100000000 + o.target}`);
    }
    this.model = { app: 'Chem Illustrator', version: 1, drawingStyle: t.drawingStyle, drawings: {}, tables: {} };
    // (kept even when empty while citations are in the text, so they open again as citations)
    if (t.references?.length || Object.values(t.objects).some((o) => o.kind === 'cite' || o.kind === 'bib')) this.model.references = t.references ?? [];
    if (t.citeStyle) this.model.citeStyle = t.citeStyle;
    if (t.design) this.model.design = t.design;
    if (t.noFigureOffer) this.model.noFigureOffer = true;
    if (t.siLink) this.model.siLink = { path: t.siLink.path, title: t.siLink.title };
    // each linked compound number's SI compounds, by the bookmark round its own field: the link
    // stays with its number when numbers are added, deleted, moved or copied in Word
    for (const id of compoundSeqs(t)) {
      const o = t.objects[id];
      if (o?.kind !== 'seq' || !o.si || !Object.keys(o.si).length) continue;
      const name = this.bookmarks.get(id) ?? `_Ref${100000000 + id}`;
      this.bookmarks.set(id, name);
      (this.model.siLinks ??= {})[name] = o.si;
    }
    if (t.citeOptions && Object.keys(t.citeOptions).length) this.model.citeOptions = t.citeOptions;
    if (t.citeManager) this.model.citeManager = t.citeManager;
    this.fullW = Math.max(36, t.page.w - t.page.left - t.page.right);
    // figures are made to fit a column's width
    this.textW = columnsOf(t.page, this.fullW).w;
    // comments: replies are comments of their own in Word; all numbered in the order of the
    // text, each comment's replies right after it, as Word numbers them
    const placed = placedComments(t.runs, t.comments);
    let next = 0;
    for (const p of placed) this.cmts.set(p.id, { c: p.c, wid: next++, replies: (p.c.replies ?? []).map(() => next++) });
    for (const r of t.runs) {
      const n = r.text.replace(/\n/g, '').length;
      for (const id of cmtIds(r.cmt)) if (this.cmts.has(id)) this.cmtLeft.set(id, (this.cmtLeft.get(id) ?? 0) + n);
    }
  }

  async write(title: string): Promise<Uint8Array> {
    const pkg = this.pkg;
    for (const [ext, type] of Object.entries(EXT_TYPE)) pkg.defaultType(ext, type);
    const main = 'word/document.xml';
    const body = await this.body(main);
    const secs = sectionsOf(this.t);
    const sect = await this.section(main, secs[secs.length - 1], secs);
    // Design > Page Color: Word's background (shown once settings say so)
    const bg = this.t.pageColor ? `<w:background w:color="${hex6(this.t.pageColor)}"/>` : '';
    pkg.add(main, `${HEAD}<w:document ${PART_NS}>${bg}<w:body>${body}${sect}</w:body></w:document>`, DOCX_CT.document);
    pkg.relate(main, DOCX_REL.styles, 'styles.xml');
    pkg.add('word/styles.xml', this.styles(), DOCX_CT.styles);
    // Design's theme as Word's own, so Word's Design tab shows it and new text and shapes take its
    // fonts and colours; else the document's own theme as it came
    const theme = wordTheme(this.t.design);
    const keptTheme = theme ? null : this.t.kept?.theme?.xml;
    if (theme || keptTheme) {
      pkg.relate(main, DOCX_REL.theme, 'theme/theme1.xml');
      pkg.add('word/theme/theme1.xml', theme ? themeXml(theme) : keptTheme!, THEME_CT);
    }
    if (this.cmts.size) this.commentParts(main);
    const notes = this.noteParts(main);
    pkg.relate(main, DOCX_REL.numbering, 'numbering.xml');
    pkg.add('word/numbering.xml', this.numbering(), DOCX_CT.numbering);
    pkg.relate(main, DOCX_REL.settings, 'settings.xml');
    // Word's ids for the document, kept from the file or made afresh: without them Word 365 shows
    // a comment's replies as comments of their own (laptop check 57)
    const docIds = `<w14:docId w14:val="${this.t.kept?.docIds?.w14 ?? newDocId()}"/><w15:docId w15:val="${this.t.kept?.docIds?.w15 ?? newDocGuid()}"/>`;
    // this program's settings, with those of the file's it doesn't set kept among them (docx-settings.ts)
    const settings = (embed: boolean) => `${HEAD}<w:settings xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:w14="${W14_NS}" xmlns:w15="${W15_NS}" mc:Ignorable="w14 w15">` + settingsChildren([
      ['zoom', '<w:zoom w:percent="100"/>'],
      ['displayBackgroundShape', this.t.pageColor ? '<w:displayBackgroundShape/>' : ''],
      ['embedTrueTypeFonts', embed ? '<w:embedTrueTypeFonts/>' : ''],
      ['saveSubsetFonts', embed ? '<w:saveSubsetFonts/>' : ''],
      ['trackRevisions', this.t.track ? '<w:trackRevisions/>' : ''],
      ['documentProtection', protectionXml(this.t.protect)],
      ['defaultTabStop', '<w:defaultTabStop w:val="720"/>'],
      ['autoHyphenation', hyphenXml(this.t.hyphen)],
      ['evenAndOddHeaders', allHf(this.t).some((h) => h.oddEven) ? '<w:evenAndOddHeaders/>' : ''],
      ['characterSpacingControl', '<w:characterSpacingControl w:val="doNotCompress"/>'],
      ['footnotePr', notes],
      // (the mode this program lays text out for, with the file's other options)
      ['compat', `<w:compat>${(this.t.kept?.settings?.compat ?? '').replace(/^((?:<w:(?!compatSetting)[^>]*\/>)*)/, '$1<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>')}</w:compat>`],
      ['docVars', this.t.kept?.vars ?? ''],
    ], this.t.kept?.settings, docIds) + '</w:settings>';
    pkg.add('word/settings.xml', settings(false), DOCX_CT.settings);
    // our own part: each structure's drawing, and each table as made here
    pkg.relate(main, DOCX_REL.customXml, '../customXml/item1.xml');
    pkg.add('customXml/item1.xml', `${HEAD}<chemIllustrator xmlns="${MODEL_NS}" version="1">${xml(JSON.stringify(this.model, shortNumbers))}</chemIllustrator>`);
    pkg.relate('customXml/item1.xml', DOCX_REL.customXmlProps, 'itemProps1.xml');
    pkg.add('customXml/itemProps1.xml', `${HEAD}<ds:datastoreItem ds:itemID="{3B7E2C41-8F0A-4D6B-A9C2-5E1D7F3A2B90}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${MODEL_NS}"/></ds:schemaRefs></ds:datastoreItem>`, DOCX_CT.itemProps);
    pkg.relate('', REL.officeDocument, main);
    pkg.relate('', REL.coreProps, 'docProps/core.xml');
    pkg.relate('', REL.extendedProps, 'docProps/app.xml');
    // the document's properties (File > Properties), which fields and Word show: the ones edited
    // here as they are now, the rest (comments, category, status...) as the file had them
    const pr = this.t.props ?? {};
    const kept = this.t.kept?.docProps;
    pkg.add('docProps/core.xml', corePropsXml(kept, { set: { title: pr.title || title || null, subject: pr.subject ?? null, creator: pr.author ?? null, keywords: pr.keywords ?? null, created: pr.created } }), DOCX_CT.core);
    pkg.add('docProps/app.xml', appPropsXml(kept, '', { Company: pr.company ?? null }), DOCX_CT.app);
    // Zotero's document preferences (its style and settings) as custom document properties, with
    // other programs' data kept from the file read: custom XML (Chem4Word's structures written
    // afresh where they were changed here), custom properties and add-ins' settings
    const ownProps: [string, string][] = this.t.citeManager === 'zotero'
      ? splitPrefs(this.t.zoteroPrefs ?? newZoteroPrefs(this.t.citeStyle ?? preferredStyle().style)).map((v, i) => [`ZOTERO_PREF_${i + 1}`, v])
      : [];
    // (the file's own font table is written below, with the fonts embedded here added to it)
    const keptFonts = this.t.kept?.trees?.find((tr) => tr.type === DOCX_REL.fontTable && tr.from === 'main');
    const keptParts = keptFonts ? { ...this.t.kept, trees: this.t.kept!.trees!.filter((tr) => tr !== keptFonts) } : this.t.kept;
    writeKeptParts(pkg, keptParts, { main, firstItem: 2, ownProps, replaceXml: changedCml(this.t) });
    // the free fonts the document uses go inside it, so it looks the same where they aren't installed
    const embed = await facesToEmbed(pkg.xmlTexts(), this.deps.fonts);
    if (embed.length || keptFonts) {
      // the file's own table as it was (Word's hints for substitutes, fonts embedded in it), less
      // the entries for fonts embedded afresh here
      const own = keptFonts ? keptFontTable(keptFonts, new Set(embed.map((e) => e.family.toLowerCase()))) : null;
      const FT = own?.tree.path ?? 'word/fontTable.xml';
      if (!(own && writeTree(pkg, own.tree, main))) pkg.relate(main, DOCX_REL.fontTable, relativeTarget(main, FT));
      let n = 0;
      const fonts = embed.map(({ family, faces }) => {
        const parts = faces.map((f) => {
          const key = newGuid();
          while (pkg.has(`word/fonts/font${++n}.odttf`));
          const name = `fonts/font${n}.odttf`;
          pkg.add(`word/${name}`, obfuscate(f.data, key), DOCX_CT.font);
          const id = pkg.relate(FT, DOCX_REL.font, name);
          const tag = f.bold ? (f.italic ? 'embedBoldItalic' : 'embedBold') : f.italic ? 'embedItalic' : 'embedRegular';
          return { tag, xml: `<w:${tag} r:id="${id}" w:fontKey="${key}"/>` };
        });
        const order = ['embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic'];
        parts.sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag));
        return `<w:font w:name="${xml(family)}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${parts.map((p) => p.xml).join('')}</w:font>`;
      });
      const table = own
        ? own.xml.replace(/<\/w:fonts>\s*$/, `${fonts.join('')}</w:fonts>`)
        : `${HEAD}<w:fonts xmlns:w="${W_NS}" xmlns:r="${NS.r}">${fonts.join('')}</w:fonts>`;
      pkg.add(FT, table, DOCX_CT.fontTable);
      if (embed.length || own?.embeds) pkg.add('word/settings.xml', settings(true), DOCX_CT.settings);
    }
    return pkg.build();
  }

  // ---------------------------------------------------------------- the text

  private async body(main: string): Promise<string> {
    const t = this.t;
    const n = paraCount(rt.plainText(t.runs));
    const fitted = fitParas(t.paras, n);
    const runsOf = this.splitParas(t.runs);
    const lists = listInfo(fitted);
    // (a list whose levels are written in different schemes goes to Word as one list)
    const paras = oneWordList(fitted, lists);
    // tracked changes on the paragraph marks (a line break typed or deleted while tracking)
    const markRev: (string | undefined)[] = [];
    // (and each paragraph mark's look: the run its line break is in)
    const markRuns: TextRun[] = [];
    for (const r of t.runs) for (const ch of r.text) if (ch === '\n') { markRev.push(r.rev); markRuns.push(r); }
    this.markRev = markRev;
    this.markRuns = markRuns;
    const out: string[] = [];
    let lastWasTable = false, lastFloats = false;
    let listNum = 0;
    // the last plain paragraph written, and where: a line after a line break (Shift+Enter) joins it
    let plain: { p: number; at: number } | null = null;
    // each section but the last ends with its section properties in its last paragraph (Word's way)
    const secs = sectionsOf({ ...t, paras });
    const endsSection = new Map<number, Section>();
    for (const s of secs.slice(0, -1)) endsSection.set(s.end - 1, s);
    // other programs' content controls round whole paragraphs (kept from the file read), opened and closed as they change
    let block: string | undefined;
    const blockTo = (cc: string | undefined) => {
      const want = cc && t.controls?.[cc] ? cc : undefined;
      if (want === block) return;
      if (block !== undefined) out.push(`</w:sdtContent></w:sdt>`);
      block = want;
      if (want !== undefined) out.push(this.sdtStart(t.controls![want]));
    };
    for (let p = 0; p < n; p++) {
      const runs = runsOf[p] ?? [];
      const ps = paras[p];
      blockTo(ps.cc);
      const ending = endsSection.get(p);
      const sectXml = ending ? await this.section(main, ending, secs) : '';
      // a section ending with a table, contents or bibliography: an empty paragraph after it holds the section's properties
      const before = out.length;
      const close = () => { if (sectXml && out.length > before) out.push(`<w:p><w:pPr>${sectXml}</w:pPr></w:p>`); if (sectXml) lastWasTable = false; };
      // a paragraph holding just a table: Word's own table
      const only = runs.length === 1 && runs[0].obj !== undefined && runs[0].text === OBJECT_CHAR ? t.objects[runs[0].obj] : undefined;
      if (only?.kind === 'table') {
        // Word joins two tables with nothing between them into one: an empty paragraph keeps them
        // apart. Two floating tables are placed apart and stay two tables, as Word writes them (a label sheet's).
        if (lastWasTable && !(lastFloats && only.table.float)) out.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
        out.push(this.cmtRound(runs[0], await this.docTable(main, only.table, ps.align ?? styleOf(t, ps).align)));
        lastWasTable = true;
        lastFloats = !!only.table.float;
        close();
        continue;
      }
      const table = only?.kind === 'drawing' ? soleTable(only.contents) : null;
      if (table) {
        if (lastWasTable) out.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
        out.push(this.table(runs[0].obj!, table, ps.align ?? styleOf(t, ps).align));
        lastWasTable = true;
        lastFloats = false;
        close();
        continue;
      }
      // a paragraph that starts below the figures floating beside it: a 1-point paragraph before it
      // holding Word's clearing break (docx-read.ts isClearPara; not before a table, which Word can't clear so)
      if (ps.clear && p > 0) { out.push(CLEAR_PARA); lastWasTable = false; plain = null; }
      // numbered lists: a new Word list where our numbers start again
      if (ps.list === 'number' && lists[p].start) listNum = this.newList(`n${ps.scheme ?? ''}`, ps.startAt);
      // an item further in with its own number: the list carries on in a Word list of the same levels that starts that level again from it
      else if (ps.list === 'number' && !ps.cont && ps.startAt !== undefined && lists[p].n === ps.startAt && listNum > 0 && this.numKeys[listNum - 1] === `n${ps.scheme ?? ''}`) {
        listNum = this.addNum(`n${ps.scheme ?? ''}`, false, { level: Math.max(0, Math.min(8, ps.level ?? 0)), value: ps.startAt });
      }
      // the number shown here, which an item of a list kept from the file must get from Word too (G2-13)
      this.shownN = ps.list === 'number' && !ps.cont ? lists[p]?.n : undefined;
      // a bibliography: its entries as paragraphs of their own, with any text round it in paragraphs before and after
      const isBib = (r: TextRun) => r.obj !== undefined && ['bib', 'toc', 'tof', 'index', 'toa'].includes(t.objects[r.obj]?.kind ?? '');
      if (runs.some(isBib)) {
        let part: TextRun[] = [];
        // the paragraph's index entries and marked citations go with its first part
        let own = ps;
        const partPara = async () => { const x = await this.paragraph(main, own, part, listNum); own = { ...ps, xe: undefined, ta: undefined, ...(ps.list ? { cont: true } : {}) }; return x; };
        for (const r of runs) {
          if (!isBib(r)) { part.push(r); continue; }
          if (part.some((x) => x.text)) out.push(await partPara());
          part = [];
          const o = t.objects[r.obj!];
          out.push(o?.kind === 'toc' ? this.contents(o.levels, ps, o.look, !o.noLinks) : o?.kind === 'tof' ? this.figureList(o.name, ps)
            : o?.kind === 'index' ? this.indexField(o, ps) : o?.kind === 'toa' ? this.toaField(o, ps) : this.bibliography(r.obj!, ps));
        }
        if (part.some((x) => x.text) || own.xe || own.ta) out.push(await partPara());
        close();
        plain = null;
      } else if (plain?.p === p - 1 && plain.at === out.length - 1 && !sectXml && !endsSection.has(p - 1) && !markRev[p - 1] && !markRev[p] && joins(paras[p - 1], ps) && !emptyBreak(ps, runs)) {
        out[plain.at] = joinTo(out[plain.at], await this.paragraph(main, ps, runs, listNum, p, '', true), ps);
        plain = { p, at: plain.at };
      } else {
        out.push(await this.paragraph(main, ps, runs, listNum, p, sectXml));
        plain = sectXml ? null : { p, at: out.length - 1 };
      }
      lastWasTable = false;
    }
    blockTo(undefined);
    // comments still open (on a table, say) close in a paragraph of their own
    const left = [...this.cmtOpen].map((id) => this.cmtEnd(id)).join('');
    if (left) { out.push(`<w:p>${left}</w:p>`); lastWasTable = false; }
    // Word ends the text with a paragraph
    if (lastWasTable || !out.length) out.push('<w:p/>');
    this.shownN = undefined;
    return out.join('');
  }

  /** A style's numbering as written (w:numPr), where its list is in the file. */
  private styleNum(s: NamedStyle): string {
    const id = s.wnum && typeof s.wnum.num === 'string' ? this.keptNumIds.get(s.wnum.num) : undefined;
    if (!id) return '';
    const lv = s.wnum!.ilvl;
    return `<w:numPr>${typeof lv === 'number' && lv >= 0 && lv <= 8 ? `<w:ilvl w:val="${Math.round(lv)}"/>` : ''}<w:numId w:val="${id}"/></w:numPr>`;
  }

  /** Each paragraph mark's tracked change, if any. */
  private markRev: (string | undefined)[] = [];
  /** Each paragraph mark's run (how the mark looks: Word's w:pPr/w:rPr). */
  private markRuns: TextRun[] = [];
  /** A paragraph mark's look as Word's w:pPr/w:rPr has it: direct formatting only, kerning left to the text. */
  private markProps(r: TextRun, st: NamedStyle): string {
    return this.runProps({ ...r, text: '', rev: undefined, fmt: undefined, cmt: undefined, link: undefined, obj: undefined, cstyle: undefined, noKern: undefined }, st, {});
  }
  // tracked changes count apart from the bookmarks (Word wants each id used once)
  private revId = 10001;

  /** Where moved text's ranges start and end (Word pairs a move's two ends by its ranges' name): the markers before and after a run. */
  private moveEdges = new WeakMap<TextRun, { before?: string; after?: string }>();
  /** Moved text inside its ranges (written as Word's moveFrom and moveTo; elsewhere as a deletion or insertion). */
  private moved = new WeakSet<TextRun>();

  /** Text split into paragraphs, with the ranges round each stretch of moved text (which may run over paragraphs) worked out. */
  private splitParas(runs: TextRun[]): TextRun[][] {
    const out = splitParagraphs(runs);
    const all = out.flat();
    const keyOf = (r: TextRun | undefined) => { const v = parseRev(r?.rev); return v?.move ? `${v.kind}|${v.move}` : ''; };
    let id = 0;
    all.forEach((r, i) => {
      const key = keyOf(r);
      if (!key) return;
      const v = parseRev(r.rev)!;
      const tag = v.kind === 'del' ? 'moveFrom' : 'moveTo';
      this.moved.add(r);
      const edge: { before?: string; after?: string } = {};
      if (keyOf(all[i - 1]) !== key) {
        id = this.revId++;
        edge.before = `<w:${tag}RangeStart w:id="${id}" w:name="${xml(v.move!)}" w:author="${xml(v.author || 'Author')}"${v.date ? ` w:date="${xml(v.date)}"` : ''}/>`;
      }
      if (keyOf(all[i + 1]) !== key) edge.after = `<w:${tag}RangeEnd w:id="${id}"/>`;
      if (edge.before || edge.after) this.moveEdges.set(r, edge);
    });
    return out;
  }

  /** A tracked change's attributes for Word. */
  private revAttrs(rev: string): string {
    const v = parseRev(rev)!;
    return `w:id="${this.revId++}" w:author="${xml(v.author || 'Author')}"${v.date ? ` w:date="${xml(v.date)}"` : ''}`;
  }

  /** A run's Word XML inside its tracked change (deleted text is Word's w:delText). */
  private tracked(rev: string | undefined, body: string, run?: TextRun): string {
    const v = parseRev(rev);
    if (!v || !body) return body;
    // moved text: Word's moveTo and moveFrom (whose text stays w:t)
    if (v.move && run && this.moved.has(run)) return `<w:${v.kind === 'del' ? 'moveFrom' : 'moveTo'} ${this.revAttrs(rev!)}>${body}</w:${v.kind === 'del' ? 'moveFrom' : 'moveTo'}>`;
    if (v.kind === 'ins') return `<w:ins ${this.revAttrs(rev!)}>${body}</w:ins>`;
    const del = body.replace(/<w:t( [^>]*)?>/g, '<w:delText$1>').replace(/<\/w:t>/g, '</w:delText>')
      .replace(/<w:instrText( [^>]*)?>/g, '<w:delInstrText$1>').replace(/<\/w:instrText>/g, '</w:delInstrText>');
    return `<w:del ${this.revAttrs(rev!)}>${del}</w:del>`;
  }

  // ---------------------------------------------------------------- comments

  /** Where comments begin at a run: Word's comment range starts (the replies' with their comment's). */
  private cmtBefore(r: TextRun): string {
    let out = '';
    for (const id of cmtIds(r.cmt)) {
      const w = this.cmts.get(id);
      if (!w || this.cmtOpen.has(id) || (this.cmtLeft.get(id) ?? 0) <= 0) continue;
      this.cmtOpen.add(id);
      for (const x of [w.wid, ...w.replies]) out += `<w:commentRangeStart w:id="${x}"/>`;
    }
    return out;
  }

  /** After a run: the ends of the comments whose last text it was, each with its mark in the text. */
  private cmtAfter(r: TextRun): string {
    let out = '';
    const n = r.text.replace(/\n/g, '').length;
    for (const id of cmtIds(r.cmt)) {
      if (!this.cmts.has(id)) continue;
      const left = (this.cmtLeft.get(id) ?? 0) - n;
      this.cmtLeft.set(id, left);
      if (left <= 0 && this.cmtOpen.has(id)) out += this.cmtEnd(id);
    }
    return out;
  }

  /** A table's Word XML with the comments on the whole table round its text: from its first paragraph to its last. */
  private cmtRound(r: TextRun, tbl: string): string {
    const start = this.cmtBefore(r), end = this.cmtAfter(r);
    if (!start && !end) return tbl;
    const first = /<w:p(?=[ >])[^>]*>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?/.exec(tbl);
    const last = tbl.lastIndexOf('</w:p>');
    if (!first || last < 0) return tbl;
    const at = first.index + first[0].length;
    return tbl.slice(0, at) + start + tbl.slice(at, last) + end + tbl.slice(last);
  }

  private cmtEnd(id: number): string {
    this.cmtOpen.delete(id);
    const w = this.cmts.get(id)!;
    return [w.wid, ...w.replies].map((x) => `<w:commentRangeEnd w:id="${x}"/><w:r><w:commentReference w:id="${x}"/></w:r>`).join('');
  }

  /**
   * Word's comments part, with the parts Word 365 writes beside it ([MS-DOCX] 2.1): Word 2013's
   * linking replies to their comment and marking the resolved ones (commentsExtended), and each
   * comment's lasting id (commentsIds) and that id's time in UTC (commentsExtensible), all by the
   * paragraph id (w14:paraId) of each comment's last paragraph.
   */
  private commentParts(main: string): void {
    const part = 'word/comments.xml';
    let para = 0x10000000;
    const notes: string[] = [], ex: string[] = [], cids: string[] = [], cex: string[] = [];
    // lasting ids: those the comments came with, and new ones (unique, as Word's are) for the rest
    const kept = new Set<string>();
    for (const { c } of this.cmts.values()) for (const n of [c, ...(c.replies ?? [])]) if (n.word?.id && /^[0-9A-F]{8}$/i.test(n.word.id)) kept.add(n.word.id.toUpperCase());
    let durable = 0x20000000;
    const newId = (): string => {
      let id = (durable++).toString(16).toUpperCase();
      while (kept.has(id)) id = (durable++).toString(16).toUpperCase();
      kept.add(id);
      return id;
    };
    const note = (id: number, c: CommentNote, parent: string | null, done: boolean): string => {
      // a comment from a Word file whose text wasn't changed here: its paragraphs as Word wrote
      // them (with their formatting), its links related to the comments part afresh
      // (changed here: the paragraphs still as they were as Word wrote them, the others plain)
      const links = c.word?.links ?? [];
      const pieces = commentPieces(c);
      const ids = pieces.map(() => (para++).toString(16).toUpperCase());
      const ps = pieces.map((p, i) => (typeof p === 'number'
        ? (i ? noAnnotationRef(c.word!.paras![p]) : withAnnotationRef(c.word!.paras![p])).replace(/^<w:p\b/, `<w:p w14:paraId="${ids[i]}" w14:textId="77777777"`)
          .replace(/ r:id="link:(\d+)"/g, (_, k: string) => ` r:id="${this.pkg.relate(part, REL.hyperlink, links[Number(k)] ?? '', true)}"`)
        : `<w:p w14:paraId="${ids[i]}" w14:textId="77777777">${i === 0 ? '<w:r><w:annotationRef/></w:r>' : ''}${commentLine(c, p.line, p.at)}</w:p>`));
      const last = ids[ids.length - 1];
      const date = c.date ? ` w:date="${xml(toWordDate(c.date))}"` : '';
      // (the initials the comment came with, else made from the name as Word makes them)
      notes.push(`<w:comment w:id="${id}" w:author="${xml(c.author || 'Author')}"${date} w:initials="${xml(c.word?.initials || initials(c.author) || 'A')}">${ps.join('')}</w:comment>`);
      ex.push(`<w15:commentEx w15:paraId="${last}"${parent ? ` w15:paraIdParent="${parent}"` : ''} w15:done="${done ? 1 : 0}"/>`);
      // Word 365's lasting id for the comment, and its time in UTC
      const did = c.word?.id && /^[0-9A-F]{8}$/i.test(c.word.id) ? c.word.id.toUpperCase() : newId();
      const utc = new Date(c.date);
      cids.push(`<w16cid:commentId w16cid:paraId="${last}" w16cid:durableId="${did}"/>`);
      if (!isNaN(utc.getTime())) cex.push(`<w16cex:commentExtensible w16cex:durableId="${did}" w16cex:dateUtc="${utc.toISOString().replace(/\.\d+Z$/, 'Z')}"/>`);
      return last;
    };
    for (const { c, wid, replies } of this.cmts.values()) {
      const top = note(wid, c, null, !!c.done);
      (c.replies ?? []).forEach((r, i) => note(replies[i], r, top, !!c.done));
    }
    // (Word 2010's and 2013's markup marked as ones to skip, so Word 2007 and strict readers take the parts)
    const ns = `xmlns:w="${W_NS}" xmlns:r="${NS.r}" xmlns:mc="${MC_NS}" xmlns:w14="${W14_NS}" xmlns:w15="${W15_NS}" xmlns:w16cid="${W16CID_NS}" xmlns:w16cex="${W16CEX_NS}"`;
    this.pkg.relate(main, DOCX_REL.comments, 'comments.xml');
    this.pkg.add(part, `${HEAD}<w:comments ${ns} mc:Ignorable="w14 w15 w16cid w16cex">${notes.join('')}</w:comments>`, DOCX_CT.comments);
    this.pkg.relate(main, DOCX_REL.commentsExtended, 'commentsExtended.xml');
    this.pkg.add('word/commentsExtended.xml', `${HEAD}<w15:commentsEx ${ns} mc:Ignorable="w14 w15 w16cid w16cex">${ex.join('')}</w15:commentsEx>`, DOCX_CT.commentsExtended);
    this.pkg.relate(main, DOCX_REL.commentsIds, 'commentsIds.xml');
    this.pkg.add('word/commentsIds.xml', `${HEAD}<w16cid:commentsIds ${ns} mc:Ignorable="w14 w15 w16cid w16cex">${cids.join('')}</w16cid:commentsIds>`, DOCX_CT.commentsIds);
    if (cex.length) {
      this.pkg.relate(main, DOCX_REL.commentsExtensible, 'commentsExtensible.xml');
      this.pkg.add('word/commentsExtensible.xml', `${HEAD}<w16cex:commentsExtensible ${ns} mc:Ignorable="w14 w15 w16cid w16cex">${cex.join('')}</w16cex:commentsExtensible>`, DOCX_CT.commentsExtensible);
    }
  }

  private async paragraph(main: string, ps: ParaStyle, runs: TextRun[], listNum: number, index = -1, sectXml = '', bodyOnly = false): Promise<string> {
    const t = this.t;
    // a heading the contents lists: the bookmark its line links to, round it (as Word's _Toc ones)
    if (index >= 0 && !bodyOnly && this.tocTargets.has(index) && !ps.marks?.includes(tocMark(index))) ps = { ...ps, marks: [...(ps.marks ?? []), tocMark(index)] };
    const st = styleOf(t, ps);
    const pPr: string[] = [];
    if (st.id !== 'Normal') pPr.push(`<w:pStyle w:val="${xml(st.id)}"/>`);
    if (!!ps.keepNext !== st.keepNext) pPr.push(ps.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
    if (!!ps.keepLines !== !!st.keepLines) pPr.push(ps.keepLines ? '<w:keepLines/>' : '<w:keepLines w:val="0"/>');
    if (ps.pageBreak) pPr.push('<w:pageBreakBefore/>');
    if (ps.frame) pPr.push(framePrXml(ps.frame));
    // paragraph properties not modelled here, each in its place (docx-read.ts KEPT_PPR)
    const raw = keptPPr(ps);
    pPr.push(raw.a ?? '');
    if (!!ps.noWidow !== !!st.noWidow) pPr.push(ps.noWidow ? '<w:widowControl w:val="0"/>' : '<w:widowControl/>');
    // Word has no "start a new column" for a paragraph: a column break begins it
    const colBreak = ps.colBreak ? '<w:r><w:br w:type="column"/></w:r>' : '';
    const em = runs.find((r) => r.obj === undefined)?.size ?? st.size;
    let kept: string | undefined;
    let contMark = '';
    if (ps.list && !ps.cont) {
      const key = ps.list === 'bullet' ? `b${ps.bullet ?? ''}` : `n${ps.scheme ?? ''}`;
      // the file's own list while the item's list is of the kind it was read as (and its number's look),
      // decided along the run of items so Word numbers each as it is numbered here (G2-13)
      const level = Math.max(0, Math.min(8, ps.level ?? 0));
      kept = raw.num !== undefined && raw.nk === key && raw.nl === JSON.stringify(ps.numLook ?? null) ? this.keptListId(raw.num, level, ps.list === 'number') : undefined;
      // a numbered list's own Word list (so it counts from 1), else the one its kind shares
      const id = kept ?? String((ps.list === 'number' && listNum > 0 && this.numKeys[listNum - 1] === key ? listNum : this.sharedNum(key)) + this.keptNumCount);
      pPr.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, ps.level ?? 0))}"/><w:numId w:val="${id}"/></w:numPr>`);
    } else if (ps.list && ps.cont) {
      // carrying on the item above (Shift+Enter): Word's "no numbering" (list 0), on the item's level and
      // indented to its text, with a hidden bookmark saying so beside that indent (CONT_MARK, read back by docx-read.ts)
      pPr.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(8, ps.level ?? 0))}"/><w:numId w:val="0"/></w:numPr>`);
      if (!bodyOnly) { const id = this.bookmarkId++; contMark = `<w:bookmarkStart w:id="${id}" w:name="${CONT_MARK}${twips(listIndent(ps, em).left)}_${id}"/><w:bookmarkEnd w:id="${id}"/>`; }
    } else if (this.styleNum(st)) {
      // (in a style with numbering, not a list here: Word's "no numbering")
      pPr.push('<w:numPr><w:numId w:val="0"/></w:numPr>');
    }
    if (ps.noLineNumbers) pPr.push('<w:suppressLineNumbers/>');
    pPr.push(paraBorderXml(ps, st));
    // (with the bar tabs Word had, which aren't tab stops here)
    if (ps.tabs?.length || raw.bar) pPr.push(`<w:tabs>${raw.bar ?? ''}${(ps.tabs ?? []).map((x) => `<w:tab w:val="${x.kind}"${x.leader ? ` w:leader="${x.leader}"` : ''} w:pos="${twips(x.pos)}"/>`).join('')}</w:tabs>`);
    if (ps.noHyphen) pPr.push('<w:suppressAutoHyphens/>');
    pPr.push(bidiXml(raw.c ?? '', !!ps.rtl, !!st.rtl));
    const sp: string[] = [];
    // (the spacing Word had where "don't add space between paragraphs of the same style" shows
    // it as none; automatic spacing, shown as 14 pt, as automatic)
    const before = raw.ctxB !== undefined && !ps.spaceBefore ? Number(raw.ctxB) : ps.spaceBefore ?? 0;
    const after = raw.ctxA !== undefined && !ps.spaceAfter ? Number(raw.ctxA) : ps.spaceAfter ?? 0;
    const line = ps.line ?? 1;
    if (raw.asb && before === 14) sp.push(`w:before="${twips(before)}" w:beforeAutospacing="1"`);
    else if (before !== st.spaceBefore) sp.push(`w:before="${twips(before)}"`);
    if (raw.asa && after === 14) sp.push(`w:after="${twips(after)}" w:afterAutospacing="1"`);
    else if (after !== st.spaceAfter) sp.push(`w:after="${twips(after)}"`);
    if (ps.linePt && ps.linePt > 0) sp.push(`w:line="${twips(ps.linePt)}" w:lineRule="${ps.lineRule === 'exact' ? 'exact' : 'atLeast'}"`);
    else if (line !== st.line) sp.push(`w:line="${Math.round(240 * line)}" w:lineRule="auto"`);
    if (sp.length) pPr.push(`<w:spacing ${sp.join(' ')}/>`);
    // indents: list items hang their bullet or number, as laid out here
    const indent = ps.indent ?? 0;
    const right = ps.indentRight ? ` w:right="${twips(ps.indentRight)}"` : '';
    if (kept && raw.ni === String(indent) && raw.nv === String(ps.level ?? 0) && raw.nr === String(ps.indentRight ?? 0)) {
      // an item of a kept list, its indents as read: the paragraph's own w:ind as Word had it (none: the list level's)
      pPr.push(raw.nd ?? '');
    } else if (ps.list) {
      const { left, hang } = listIndent(ps, em);
      pPr.push(`<w:ind w:left="${twips(left)}"${right} ${ps.cont ? 'w:firstLine="0"' : `w:hanging="${twips(hang)}"`}/>`);
    } else {
      const first = ps.firstLine ?? 0;
      if (indent !== st.indent || first !== st.firstLine || right) pPr.push(`<w:ind w:left="${twips(indent)}"${right} ${first < 0 ? `w:hanging="${twips(-first)}"` : `w:firstLine="${twips(first)}"`}/>`);
    }
    if (raw.ctx) pPr.push('<w:contextualSpacing/>');
    pPr.push(raw.d ?? '');
    const align = ps.align ?? 'left';
    // (an alignment Word has that shows here as another, while it still does: distribute)
    if (raw.jc && align === 'justify') pPr.push(`<w:jc w:val="${xml(raw.jc)}"/>`);
    else if (align !== st.align) pPr.push(`<w:jc w:val="${JC[align]}"/>`);
    pPr.push(raw.e ?? '');
    // the paragraph mark itself inserted or deleted while tracking
    const mr = parseRev(index >= 0 ? this.markRev[index] : undefined);
    // (and a list number's own bold or italic, which Word takes from the mark)
    const nl = ps.list === 'number' ? ps.numLook : undefined;
    const markLook = `${nl?.bold !== undefined ? (nl.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>') : ''}${nl?.italic !== undefined ? (nl.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>') : ''}`;
    // (else the mark's own look, where it isn't the paragraph style's)
    // (not a list item's: Word draws its number or bullet in the mark's look, which isn't drawn here)
    const mk = index >= 0 && !ps.list ? this.markRuns[index] : undefined;
    const markOwn = mk ? this.markProps(mk, st) : '';
    if (mr || markLook || markOwn) pPr.push(`<w:rPr>${mr ? `<w:${mr.kind} ${this.revAttrs(this.markRev[index]!)}/>` : ''}${markLook}${markOwn}</w:rPr>`);
    // the section ending with this paragraph
    if (sectXml) pPr.push(sectXml);

    // a caption that references point to: a bookmark round its label and number; a compound
    // number's bookmark is round just the number
    const isCompound = (id: number) => { const o = this.t.objects[id]; return o?.kind === 'seq' && o.name === COMPOUND; };
    const seqs = runs.filter((r) => r.obj !== undefined && this.bookmarks.has(r.obj) && !isCompound(r.obj)).map((r) => r.obj!);
    const out: string[] = contMark ? [contMark] : [];
    // the end of a move's range, put after the run it ends with
    const moveEnds: string[] = [];
    let open: { id: number; seq: number } | null = null;
    if (seqs.length) {
      open = { id: this.bookmarkId++, seq: seqs[0] };
      out.push(`<w:bookmarkStart w:id="${open.id}" w:name="${this.bookmarks.get(seqs[0])}"/>`);
    }
    // the paragraph's bookmarks (Insert > Document > Bookmark), round the whole paragraph
    // (not one a legacy form field in it writes round itself, under the same name, as Word has it: that
    // bookmark comes back on the paragraph when the file is read, and is written once, round the field)
    const formMarks = new Set(runs.flatMap((r) => { const o = r.obj !== undefined ? this.t.objects[r.obj] : undefined; return o?.kind === 'form' ? [formName(o)] : []; }).filter((n) => n && !this.formNames.has(n)));
    const marks = (ps.marks ?? []).filter((name) => !formMarks.has(name)).map((name) => ({ name, id: this.bookmarkId++ }));
    for (const m of marks) out.push(`<w:bookmarkStart w:id="${m.id}" w:name="${xml(m.name)}"/>`);
    // index entries and marked citations (Word's XE and TA fields, hidden text with no result)
    for (const m of ps.xe ?? []) out.push(markField(xeInstr(m)));
    for (const m of ps.ta ?? []) out.push(markField(taInstr(m)));
    // links: each stretch of text with one link is a Word link round its runs
    let linked: string | undefined;
    const linkTo = (l: string | undefined) => {
      if (l === linked) return;
      if (linked !== undefined) out.push('</w:hyperlink>');
      linked = l;
      if (l !== undefined) out.push(this.hyperlinkStart(main, l));
    };
    // an equation on its own in its paragraph is a display equation (Word's equation paragraph)
    const shownRuns = runs.filter((r) => r.obj !== undefined || r.text.trim());
    const display = shownRuns.length === 1 && shownRuns[0].obj !== undefined && this.t.objects[shownRuns[0].obj]?.kind === 'math';
    // other programs' content controls round runs (Chem4Word's structures, a form's fields): links go inside them
    let control: string | undefined;
    const controlTo = (cc: string | undefined) => {
      const want = cc && this.t.controls?.[cc] && cc !== ps.cc ? cc : undefined;
      if (want === control) return;
      linkTo(undefined);
      if (control !== undefined) out.push(`</w:sdtContent></w:sdt>`);
      control = want;
      if (want !== undefined) out.push(this.sdtStart(this.t.controls![want]));
    };
    this.noteWordGroups(runs);
    for (const r of runs) {
      controlTo(r.cc);
      linkTo(r.link);
      const move = this.moveEdges.get(r);
      if (move?.before) out.push(move.before);
      if (move?.after) moveEnds.push(move.after);
      out.push(this.cmtBefore(r));
      if (r.obj === undefined) { out.push(this.tracked(r.rev, this.textRuns(r, st, runs), r), this.cmtAfter(r), ...moveEnds.splice(0)); continue; }
      const o = this.t.objects[r.obj];
      if (o?.kind === 'math') {
        const m = `<m:oMath>${toOmml(o.tex)}</m:oMath>`;
        out.push(display ? `<m:oMathPara>${m}</m:oMathPara>` : m, this.cmtAfter(r), ...moveEnds.splice(0));
        continue;
      }
      const mark = this.bookmarks.has(r.obj) && isCompound(r.obj) ? this.bookmarkId++ : null;
      if (mark !== null) out.push(`<w:bookmarkStart w:id="${mark}" w:name="${this.bookmarks.get(r.obj)}"/>`);
      out.push(this.tracked(r.rev, await this.objectRun(main, r, st), r));
      if (mark !== null) out.push(`<w:bookmarkEnd w:id="${mark}"/>`);
      if (open && r.obj === open.seq) { out.push(`<w:bookmarkEnd w:id="${open.id}"/>`); open = null; }
      out.push(this.cmtAfter(r), ...moveEnds.splice(0));
    }
    controlTo(undefined);
    linkTo(undefined);
    for (const m of marks) out.push(`<w:bookmarkEnd w:id="${m.id}"/>`);
    // a line after a line break: just its runs, to go in the paragraph before it
    if (bodyOnly) return out.join('');
    return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${colBreak}${out.join('')}</w:p>`;
  }

  /** The start of a content control kept from the file read: its properties as they were, with a fresh id. */
  private sdtStart(c: ContentControl): string {
    return `<w:sdt><w:sdtPr>${c.head}<w:id w:val="${this.sdtId++}"/>${c.rest}</w:sdtPr>${c.end ? `<w:sdtEndPr>${c.end}</w:sdtEndPr>` : ''}<w:sdtContent>`;
  }

  /** The start of a Word link: to a bookmark here (w:anchor), or through a relationship of the part it is in. */
  private hyperlinkStart(part: string, link: string): string {
    if (link.startsWith('#')) return `<w:hyperlink w:anchor="${xml(link.slice(1))}" w:history="1">`;
    const id = this.pkg.relate(part, REL.hyperlink, officeTarget(link), true);
    return `<w:hyperlink r:id="${id}" w:history="1">`;
  }

  /** Runs written one by one, with Word links round the ones that link somewhere. */
  private linkedRuns(part: string, runs: TextRun[], write: (r: TextRun) => string): string {
    let out = '', linked: string | undefined;
    for (const r of runs) {
      if (r.link !== linked) {
        if (linked !== undefined) out += '</w:hyperlink>';
        linked = r.link;
        if (linked !== undefined) out += this.hyperlinkStart(part, linked);
      }
      out += write(r);
    }
    return linked !== undefined ? `${out}</w:hyperlink>` : out;
  }

  /**
   * A bibliography as Word paragraphs: each entry's number hanging out before a tab, its text
   * in italics and bold as the style prints it, all inside a hidden bookmark so it is found
   * again when the file is opened here.
   */
  private bibliography(id: number, ps: ParaStyle): string {
    const t = this.t;
    const st = styleOf(t, undefined);
    const entries = bibliography(t);
    const measure = documentMeasure((s, size, _f, style) => arialWidth(s, size, /bold/.test(style)));
    const hang = bibHang(entries.map((e) => e.label), st.size, st.font, measure);
    const base = runStyleOf(st);
    const mark = this.bookmarkId++;
    const name = `${BIB_MARK}${id}`;
    const pPr = `<w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:left="${twips(hang)}" w:hanging="${twips(hang)}"/><w:jc w:val="left"/></w:pPr>`;
    // (a manager's entries kept from Word may also be underlined, raised, lowered or linked)
    const paras = entries.map((e) => run(this.runProps({ ...base, text: '' }, st, {}), `${e.label}\t`) +
      this.linkedRuns('word/document.xml', e.pieces.map((p): TextRun => ({ ...rt.cleanStyle({ ...base, italic: p.italic, bold: p.bold, underline: p.underline, sup: p.sup, sub: p.sub, link: p.link }), text: p.text })),
        (r) => run(this.runProps(r, st, {}), r.text)));
    if (!paras.length) paras.push('');
    const app = t.citeManager;
    if (app && app !== 'mendeley-cite') {
      // a reference manager's bibliography field round the entries (worked out again here when opened)
      const o = t.objects[id];
      paras[0] = fieldStart('', bibInstr(app, o?.kind === 'bib' ? o.live : undefined).instr) + paras[0];
      paras[paras.length - 1] += '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    } else if (!app) {
      paras[0] = `<w:bookmarkStart w:id="${mark}" w:name="${name}"/>${paras[0]}`;
      paras[paras.length - 1] += `<w:bookmarkEnd w:id="${mark}"/>`;
      this.model.bibliographies ??= {};
      this.model.bibliographies[id] = { text: entries.map((e) => `${e.label}\t${piecesText(e.pieces)}`).join('\n'), ps };
    }
    const out = paras.map((x) => `<w:p>${entries.length ? pPr : '<w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>'}${x}</w:p>`).join('');
    return app === 'mendeley-cite' ? `<w:sdt><w:sdtPr><w:tag w:val="${bibInstr(app).tag}"/><w:id w:val="${this.sdtId++}"/></w:sdtPr><w:sdtContent>${out}</w:sdtContent></w:sdt>` : out;
  }

  /**
   * A table of contents as Word's own TOC field: Word shows the headings and page numbers as
   * written here, and works them out again with Update Field. Without page numbers from the
   * layout here, the field is marked for Word to update when the file is opened.
   */
  private contents(levels: number, ps: ParaStyle, look?: (TocLook | null)[], links = true): string {
    const t = this.t;
    const entries = tocEntries(t, levels);
    const pages = this.pages;
    const st = styleOf(t, undefined);
    const textW = Math.max(36, t.page.w - t.page.left - t.page.right);
    const dirty = pages ? '' : ' w:dirty="true"';
    const begin = `<w:r><w:fldChar w:fldCharType="begin"${dirty}/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-${levels}"${links ? ' \\h' : ''} \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const line = ps.line && ps.line !== 1 ? ` w:line="${Math.round(240 * ps.line)}" w:lineRule="auto"` : '';
    const paras = entries.map((e, i) => {
      const pPr = `<w:pPr><w:pStyle w:val="TOC${e.level}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${twips(textW)}"/></w:tabs>` +
        `<w:spacing w:before="${e.level === 1 && i > 0 ? twips(0.25 * st.size) : 0}" w:after="0"${line}/><w:ind w:left="${twips((e.level - 1) * TOC_INDENT)}"/></w:pPr>`;
      // (the look Word gave the entries, kept as their own formatting, as Word wrote them)
      const l = look?.[e.level - 1];
      const rPr = l ? `${l.font ? fontsXml(l.font) : ''}${l.bold !== undefined ? (l.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>') : ''}${l.italic !== undefined ? (l.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>') : ''}${l.size ? `<w:sz w:val="${Math.round(2 * l.size)}"/><w:szCs w:val="${Math.round(2 * l.size)}"/>` : ''}` : '';
      // (each line a link to its heading, as Word writes the contents with \h)
      const shown = `${run(rPr, e.num ? `${e.num}\t${e.text}` : e.text)}${run(rPr, `\t${pages?.[e.para] ?? ''}`)}`;
      return `<w:p>${pPr}${i === 0 ? begin : ''}${links ? `<w:hyperlink w:anchor="${tocMark(e.para)}" w:history="1">${shown}</w:hyperlink>` : shown}${i === entries.length - 1 ? end : ''}</w:p>`;
    });
    // no headings yet: the field with nothing in it, for Word to fill in
    if (!paras.length) paras.push(`<w:p>${begin}${end}</w:p>`);
    return paras.join('');
  }

  /**
   * A table of figures as Word's TOC field for the captions of one label (\c "Scheme"), or, for
   * every caption, for the paragraphs in the Caption style; its lines as written here, each
   * caption with its page number after a line of dots, in Word's "table of figures" style.
   */
  private figureList(name: string, ps: ParaStyle): string {
    const t = this.t;
    const entries = tofEntries(t, name, this.shown);
    const pages = this.pages;
    const textW = Math.max(36, t.page.w - t.page.left - t.page.right);
    const dirty = pages ? '' : ' w:dirty="true"';
    const instr = name ? ` TOC \\h \\z \\c "${xml(name)}" ` : ' TOC \\h \\z \\t "Caption,1" ';
    const begin = `<w:r><w:fldChar w:fldCharType="begin"${dirty}/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const line = ps.line && ps.line !== 1 ? ` w:line="${Math.round(240 * ps.line)}" w:lineRule="auto"` : '';
    const paras = entries.map((e, i) => {
      const pPr = `<w:pPr><w:pStyle w:val="TableofFigures"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${twips(textW)}"/></w:tabs><w:spacing w:before="0" w:after="0"${line}/></w:pPr>`;
      return `<w:p>${pPr}${i === 0 ? begin : ''}<w:hyperlink w:anchor="${tocMark(e.para)}" w:history="1">${run('', e.text)}${run('', `\t${pages?.[e.para] ?? ''}`)}</w:hyperlink>${i === entries.length - 1 ? end : ''}</w:p>`;
    });
    if (!paras.length) paras.push(`<w:p>${begin}${end}</w:p>`);
    return paras.join('');
  }

  /**
   * An index as Word's INDEX field: its lines as worked out here (Index 1 and Index 2 paragraphs,
   * letter headings in Index Heading), which Word works out again with Update Field. Columns are
   * the index's own section's (Insert Index puts it in one).
   */
  private indexField(o: Extract<DocObject, { kind: 'index' }>, ps: ParaStyle): string {
    const pages = this.pages;
    const items = indexItems(this.t, (p) => pages?.[p] ?? '', o.letters);
    return this.listField(indexInstr(o), items, ps, !!o.right, (it) => (it.level === 0 ? 'IndexHeading' : it.level === 1 ? 'Index1' : 'Index2'));
  }

  /** A table of authorities as Word's TOA fields: one for each category listed (Word's way), each with its heading. */
  private toaField(o: Extract<DocObject, { kind: 'toa' }>, ps: ParaStyle): string {
    const pages = this.pages;
    const cats = o.cat ? [o.cat] : [...new Set(authorities(this.t).map((a) => a.cat))].sort((a, b) => a - b);
    if (!cats.length) cats.push(1);
    return cats.map((c) => this.listField(toaInstr(c, o.passim), toaItems(this.t, c, (p) => pages?.[p] ?? '', o.passim), ps, true, (it) => (it.level === 0 ? 'TOAHeading' : 'TableofAuthorities'))).join('');
  }

  /** A field whose result is lines of paragraphs (an index, a table of authorities), each in its style, the pages after a comma or a tab. */
  private listField(instr: string, items: ListItem[], ps: ParaStyle, right: boolean, style: (it: ListItem) => string): string {
    const t = this.t;
    const textW = Math.max(36, t.page.w - t.page.left - t.page.right);
    const dirty = this.pages ? '' : ' w:dirty="true"';
    const begin = `<w:r><w:fldChar w:fldCharType="begin"${dirty}/></w:r><w:r><w:instrText xml:space="preserve">${xml(instr)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const line = ps.line && ps.line !== 1 ? ` w:line="${Math.round(240 * ps.line)}" w:lineRule="auto"` : '';
    const paras = items.map((it, i) => {
      const tabs = right && it.level ? `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${twips(textW)}"/></w:tabs>` : '';
      const pPr = `<w:pPr><w:pStyle w:val="${style(it)}"/>${tabs}<w:spacing w:before="0" w:after="0"${line}/></w:pPr>`;
      let body = it.level === 0 ? run('<w:b/>', it.text) : run('', it.text);
      if (it.level) {
        it.pages.forEach((pg, k) => { body += run('', k === 0 ? (right ? '\t' : ', ') : ', ') + run(`${pg.bold ? '<w:b/>' : ''}${pg.italic ? '<w:i/>' : ''}`, pg.label); });
        if (it.see) body += run('', it.pages.length || !right ? '. ' : '\t') + run('<w:i/>', it.see.split(/\s+/)[0]) + run('', it.see.slice(it.see.split(/\s+/)[0].length));
      }
      return `<w:p>${pPr}${i === 0 ? begin : ''}${body}${i === items.length - 1 ? end : ''}</w:p>`;
    });
    if (!paras.length) paras.push(`<w:p>${begin}${end}</w:p>`);
    return paras.join('');
  }

  /**
   * Word's footnotes and endnotes parts: the lines Word draws above the notes (its separators),
   * then each note's paragraphs in the Footnote Text (or Endnote Text) style, its number first.
   * Gives the settings that name the separators (empty when there are no notes).
   */
  private noteParts(main: string): string {
    const t = this.t;
    const st = noteStyle(t);
    let settings = '';
    for (const end of [false, true]) {
      const tag = end ? 'endnote' : 'footnote';
      const mine = [...this.noteIds].filter(([id]) => { const o = t.objects[id]; return o?.kind === 'note' && !!o.end === end; });
      if (!mine.length) continue;
      const style = end ? 'EndnoteText' : 'FootnoteText', ref = end ? 'EndnoteReference' : 'FootnoteReference';
      const sepPara = (kind: string) => `<w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:${kind}/></w:r></w:p>`;
      const out = [`<w:${tag} w:type="separator" w:id="-1">${sepPara('separator')}</w:${tag}>`, `<w:${tag} w:type="continuationSeparator" w:id="0">${sepPara('continuationSeparator')}</w:${tag}>`];
      for (const [id, n] of mine) {
        const o = t.objects[id];
        if (o?.kind !== 'note') continue;
        const runsOf = this.splitParas(o.runs);
        const paras = fitParas(o.paras, paraCount(rt.plainText(o.runs)));
        const ps = paras.map((p, i) => {
          const pPr: string[] = [`<w:pStyle w:val="${style}"/>`];
          // (a note style with numbering: not on the notes, as here)
          if (this.styleNum(t.styles[style] ?? st)) pPr.push('<w:numPr><w:numId w:val="0"/></w:numPr>');
          const align = p.align ?? 'left';
          if (align !== st.align) pPr.push(`<w:jc w:val="${JC[align]}"/>`);
          // the note's number, and the space after it (or what the note had there in Word)
          const mark = i === 0 ? `<w:r><w:rPr><w:rStyle w:val="${ref}"/></w:rPr><w:${tag}Ref/></w:r>${run('', o.lead ?? ' ')}` : '';
          // its text, and its citations (note styles put them in footnotes)
          const cite = (r: TextRun) => { const c = r.obj !== undefined ? t.objects[r.obj] : undefined; return c?.kind === 'cite' ? c : null; };
          const body = this.linkedRuns(`word/${tag}s.xml`, (runsOf[i] ?? []).filter((r) => r.obj === undefined || cite(r)), (r) => {
            const c = cite(r);
            return c ? this.citeXml(c, this.runProps(r, st, { cs: this.charStyleOf(r) }), this.shown.get(r.obj!) ?? '') : this.tracked(r.rev, this.textRuns(r, st, runsOf[i]));
          });
          return { para: `<w:p><w:pPr>${pPr.join('')}</w:pPr>${mark}${body}</w:p>`, body };
        });
        // a line after a line break (Shift+Enter) goes in the paragraph before it
        const xmls: string[] = [];
        ps.forEach((x, i) => { if (i > 0 && joins(paras[i - 1], paras[i])) xmls[xmls.length - 1] = joinTo(xmls[xmls.length - 1], x.body, paras[i]); else xmls.push(x.para); });
        out.push(`<w:${tag} w:id="${n}">${xmls.join('')}</w:${tag}>`);
      }
      const name = `${tag}s.xml`;
      this.pkg.relate(main, end ? DOCX_REL.endnotes : DOCX_REL.footnotes, name);
      this.pkg.add(`word/${name}`, `${HEAD}<w:${tag}s ${PART_NS}>${out.join('')}</w:${tag}s>`, end ? DOCX_CT.endnotes : DOCX_CT.footnotes);
      settings += `<w:${tag}Pr><w:${tag} w:id="-1"/><w:${tag} w:id="0"/></w:${tag}Pr>`;
    }
    return settings;
  }

  /** Runs of text, a formula's parts each with its own position (read across `para`, the runs of its paragraph). */
  private textRuns(r: TextRun, st: NamedStyle, para?: readonly TextRun[]): string {
    if (!r.text) return '';
    if (r.formula && !r.sub && !r.sup) {
      return rt.formulaPartsIn(para, r).map((part) => run(this.runProps(r, st, { formula: true, pos: part.pos }) + this.fmtChange(r, st), part.text)).join('');
    }
    return run(this.runProps(r, st, { cs: this.charStyleOf(r) }) + this.fmtChange(r, st), r.text);
  }

  /** A tracked formatting change on a run (Word's w:rPrChange, last in its w:rPr): who, when, and its look before. */
  private fmtChange(r: TextRun, st: NamedStyle): string {
    const f = parseFmt(r.fmt);
    if (!f) return '';
    const old = { ...f.old, text: '' } as TextRun;
    const before = old.formula && !old.sub && !old.sup ? this.runProps(old, st, { formula: true }) : this.runProps(old, st, { cs: this.charStyleOf(old) });
    return `<w:rPrChange w:id="${this.revId++}" w:author="${xml(f.author || 'Author')}"${f.date ? ` w:date="${xml(f.date)}"` : ''}><w:rPr>${before}</w:rPr></w:rPrChange>`;
  }

  /** The character style a run is in, if the document has it. */
  private charStyleOf(r: TextRun): CharStyle | undefined {
    return r.cstyle ? this.charStyles[r.cstyle] : undefined;
  }

  /** A citation: its numbers, which Word shows as they are (an ADDIN field is never worked out again by Word). */
  private citeXml(o: Extract<DocObject, { kind: 'cite' }>, rPr: string, shown: string): string {
    // for Zotero, Mendeley or EndNote: in their own form, so they go on managing it
    const refs = o.refs.map((r) => this.t.references?.find((x) => x.id === r)).filter((r): r is Reference => !!r);
    const app = this.t.citeManager;
    if (app && refs.length) {
      const out = writeCite(app, refs, o.live, shown);
      if (out.tag) return `<w:sdt><w:sdtPr><w:tag w:val="${xml(out.tag)}"/><w:id w:val="${this.sdtId++}"/></w:sdtPr><w:sdtContent>${run(rPr, shown)}</w:sdtContent></w:sdt>`;
      return field(rPr, xml(out.instr), shown, out.data);
    }
    return field(rPr, ` ${CITE_FIELD} ${o.refs.map(xml).join(' ')} `, shown);
  }

  private async objectRun(main: string, r: TextRun, st: NamedStyle): Promise<string> {
    const id = r.obj!;
    const o = this.t.objects[id];
    if (!o) return '';
    const rPr = this.runProps(r, st, { cs: this.charStyleOf(r) });
    const shown = this.shown.get(id) ?? '';
    if (o.kind === 'seq') {
      const name = /\s/.test(o.name) ? `"${o.name}"` : o.name;
      return field(rPr, ` SEQ ${xml(name)} \\* ARABIC \\* CHARFORMAT `, shown);
    }
    // hidden text kept from a Word file, as it was; a field kept from Word with the result it showed (none: no result)
    if (o.kind === 'field' && o.code === 'hidden') return run(this.runProps(r, st, { cs: this.charStyleOf(r), vanish: true }), o.text ?? '');
    if (o.kind === 'field' && o.code === 'word' && !shown) return markField(fieldInstr(o), rPr);
    if (o.kind === 'field') return field(rPr, xml(fieldInstr(o)), shown);
    if (o.kind === 'ref') {
      const bm = this.bookmarks.get(o.target);
      return bm ? field(rPr, ` REF ${bm} \\h \\* CHARFORMAT `, shown) : run(rPr, shown);
    }
    if (o.kind === 'cite') return this.citeXml(o, rPr, shown);
    // something of the linked SI: Word shows its last text and leaves it alone
    if (o.kind === 'si') return field(rPr, ` ${SI_FIELD} ${o.what} ${xml(o.key)} `, shown);
    // a footnote's or endnote's number: Word's own reference to it (Word numbers it)
    if (o.kind === 'note') {
      const n = this.noteIds.get(id);
      const tag = o.end ? 'endnote' : 'footnote';
      return n === undefined ? '' : `<w:r><w:rPr><w:rStyle w:val="${o.end ? 'EndnoteReference' : 'FootnoteReference'}"/>${this.runProps({ ...r, sup: undefined }, st, {})}</w:rPr><w:${tag}Reference w:id="${n}"/></w:r>`;
    }
    if (o.kind === 'form') return formField(o, rPr, this.formNames, this.bookmarkId++);
    if (o.kind === 'bib' || o.kind === 'toc' || o.kind === 'tof' || o.kind === 'index' || o.kind === 'toa' || o.kind === 'math') return '';
    if (o.kind === 'textbox') return this.textBox(main, id, o, rPr);
    // a group of pictures: written once, as Word's group, by its first picture
    const group = this.wordGroups.get(id);
    if (group && group[0] !== id) return '';
    if (group) {
      const got = await this.pictureGroup(main, group, rPr);
      if (got) return got;
      for (const g of group) this.wordGroups.delete(g);
    }
    return this.picture(main, id, o, rPr);
  }

  /**
   * A drawing's frame in the text: in the line (wp:inline), or placed on the page with the text
   * wrapping round it (wp:anchor), its place measured from the margin, page or paragraph.
   */
  private placed(o: DocObject, cx: number, cy: number, inner: string): string {
    const fl = floatOf(o);
    // (with the room Word's own effects took round a figure from a Word file)
    const fx = fl?.effect;
    const [el, et, er, eb] = lookExtent(lookOf(o)).map((v, i) => emu(v + (fx ? [fx.l, fx.t, fx.r, fx.b][i] : 0)));
    const ext = `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="${el}" t="${et}" r="${er}" b="${eb}"/>`;
    // (one in line with text in Word, still where it was put: in line again)
    const asRead = !!fl?.inline && fl.wrap === 'topBottom' && !fl.x && !fl.y && !fl.hidden && !fl.name && fl.group === undefined && !fl.align && !fl.xFrom && !fl.yFrom &&
      fl.gap === undefined && fl.gapTop === undefined && fl.gapBottom === undefined && fl.gapRight === undefined;
    // hidden in the Selection Pane (Word's own mark); its group and name kept with our data, by its id
    // (a figure in the line: its own, on the object)
    const pane: (WordPane & { group?: number }) | undefined = fl ?? (o.kind === 'picture' || o.kind === 'drawing' ? o.wordPr : undefined);
    const pr = /<wp:docPr id="(\d+)"/.exec(inner);
    if (pane?.hidden) inner = inner.replace(/<wp:docPr ([^>]*?)(\/?)>/, '<wp:docPr $1 hidden="1"$2>');
    // a name from the Selection Pane goes on wp:docPr, where Word's Selection Pane reads it (laptop bench)
    // (our own names, "Picture 4" and the like, have nothing to escape)
    const name = pane?.name;
    const was = name ? /<wp:docPr [^>]*?name="([^"]*)"/.exec(inner)?.[1] : undefined;
    if (name && was !== undefined) inner = inner.replace(/(<wp:docPr [^>]*?name=")[^"]*"/, (_, a: string) => `${a}${xmlAttr(name)}"`);
    if (pr && pane && (pane.group !== undefined || name)) (this.model.floats ??= {})[Number(pr[1])] = { ...(pane.group !== undefined ? { group: pane.group } : {}), ...(name ? { name } : {}), ...(was !== undefined ? { was } : {}) };
    if (!fl || asRead) return `<wp:inline distT="0" distB="0" distL="0" distR="0">${ext}${inner}</wp:inline>`;
    const [l, t] = lookExtent(lookOf(o));
    return this.anchor(fl, emu(fl.x + l), emu(fl.y + t), ext, inner);
  }

  /** wp:anchor (ECMA-376 part 1 §20.4.2.3): a frame placed at x, y (EMU) as `fl` places it, with the text wrapping round it as `fl` says. */
  private anchor(fl: NonNullable<ReturnType<typeof floatOf>>, x: number, y: number, ext: string, inner: string): string {
    const gap = floatGaps(fl);
    if (!this.stackAt) {
      const order = stackOrder(this.t), inText = new Set(order);
      const outside = Object.entries(this.t.objects).filter(([id, o]) => floatOf(o) && !inText.has(Number(id))).length;
      // (a group written as one Word group is one drawing there, at the place of its member furthest back;
      // the paragraphs' runs, to tell which groups are, as each paragraph is written)
      const oneAnchor = new Set<number>();
      let para: TextRun[] = [];
      const flush = () => { for (const id of this.groupsIn(para).keys()) oneAnchor.add(id); para = []; };
      for (const r of this.t.runs) {
        if (r.obj !== undefined) para.push(r);
        if (r.text.includes('\n')) flush();
      }
      flush();
      this.stackAt = new Map();
      const groups = new Map<number, number>();
      let at = outside;
      for (const id of order) {
        const fl = floatOf(this.t.objects[id])!;
        if (fl.group === undefined || !oneAnchor.has(id)) { this.stackAt.set(fl, at++); continue; }
        if (!groups.has(fl.group)) groups.set(fl.group, at++);
        this.stackAt.set(fl, groups.get(fl.group)!);
      }
    }
    // (one outside the text's stack written twice, as a chart and its picture, at one place)
    let at = this.stackAt.get(fl);
    if (at === undefined) this.stackAt.set(fl, (at = this.others++));
    const h = fl.xFrom === 'page' ? 'page' : 'margin';
    const v = fl.yFrom === 'page' ? 'page' : fl.yFrom === 'margin' ? 'margin' : 'paragraph';
    const wrap = fl.wrap === 'square' ? `<wp:wrapSquare wrapText="${fl.side ?? 'largest'}"/>` : fl.wrap === 'topBottom' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapNone/>';
    return `<wp:anchor distT="${emu(gap.t)}" distB="${emu(gap.b)}" distL="${emu(gap.l)}" distR="${emu(gap.r)}" simplePos="0" relativeHeight="${251659264 + (at + 1) * 1024}" behindDoc="${fl.wrap === 'behind' ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${h}">${fl.align ? `<wp:align>${fl.align}</wp:align>` : `<wp:posOffset>${x}</wp:posOffset>`}</wp:positionH>` +
      `<wp:positionV relativeFrom="${v}"><wp:posOffset>${y}</wp:posOffset></wp:positionV>${ext}${wrap}${inner}</wp:anchor>`;
  }

  /**
   * Pictures grouped here that came from (or make) a Word group: all of the group's figures are
   * pictures floating from this paragraph, placed the same way. Each picture's id to the group's,
   * in the order of the text (the first one writes the group).
   */
  private wordGroups = new Map<number, number[]>();
  private noteWordGroups(runs: TextRun[]): void {
    for (const [id, ids] of this.groupsIn(runs)) this.wordGroups.set(id, ids);
  }

  /** The groups written as one Word group from a paragraph with these runs (see wordGroups): each picture's id to the group's. */
  private groupsIn(runs: TextRun[]): Map<number, number[]> {
    const out = new Map<number, number[]>();
    const by = new Map<number, number[]>();
    for (const r of runs) {
      if (r.obj === undefined || r.rev) continue;
      const o = this.t.objects[r.obj];
      const fl = floatOf(o);
      if (o?.kind !== 'picture' || o.chart || o.embed || fl?.group === undefined) continue;
      const list = by.get(fl.group);
      if (list) list.push(r.obj); else by.set(fl.group, [r.obj]);
    }
    for (const [g, ids] of by) {
      if (ids.length < 2) continue;
      const all = Object.values(this.t.objects).filter((o) => floatOf(o)?.group === g);
      const fls = ids.map((id) => floatOf(this.t.objects[id])!);
      const same = fls.every((f) => !f.hidden && f.wrap === fls[0].wrap && f.side === fls[0].side && (f.xFrom ?? 'margin') === (fls[0].xFrom ?? 'margin') && (f.yFrom ?? 'para') === (fls[0].yFrom ?? 'para'));
      if (all.length === ids.length && same) for (const id of ids) out.set(id, ids);
    }
    return out;
  }

  /**
   * A group of pictures as Word writes one (Arrange > Group): one wp:anchor holding a wpg:wgp
   * (Word 2010's group, [MS-ODRAWXML] 2.4) with each picture where it is, inside an
   * mc:AlternateContent (ECMA-376 part 3 §10.2) whose fallback is the VML v:group older Words read.
   * Null when a picture can't go in it (they are then saved one by one).
   */
  private async pictureGroup(main: string, ids: number[], rPr: string): Promise<string | null> {
    const items: { pic: string; blip: string; id: number; x: number; y: number; cx: number; cy: number; e: number[] }[] = [];
    for (const id of ids) {
      const o = this.t.objects[id];
      const fl = floatOf(o);
      if (!o || !fl) return null;
      // (each picture in the group without a name or hidden mark of its own: the group has them)
      const one = await this.picture(main, id, { ...o, float: undefined, wordPr: undefined } as DocObject, '');
      const ext = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(one);
      const docPr = /<wp:docPr id="(\d+)"[^>]*?(?: descr="([^"]*)")?\/>/.exec(one);
      const blip = /<a:blip r:embed="([^"]+)"/.exec(one);
      let pic = /<pic:pic>[\s\S]*<\/pic:pic>/.exec(one)?.[0];
      if (!ext || !docPr || !blip || !pic) return null;
      const [l, t] = lookExtent(lookOf(o));
      const fx = fl.effect;
      const e = lookExtent(lookOf(o)).map((v, i) => emu(v + (fx ? [fx.l, fx.t, fx.r, fx.b][i] : 0)));
      // its id and alt text on the picture itself, where Word looks for them inside a group
      pic = pic.replace(/<pic:cNvPr id="0" name="([^"]*)"\/>/, (_, n: string) => `<pic:cNvPr id="${docPr[1]}" name="${n}"${docPr[2] !== undefined ? ` descr="${docPr[2]}"` : ''}/>`);
      items.push({ pic, blip: blip[1], id, x: emu(fl.x + l), y: emu(fl.y + t), cx: Number(ext[1]), cy: Number(ext[2]), e });
    }
    const x0 = minOf(items.map((i) => i.x)), y0 = minOf(items.map((i) => i.y));
    const W = maxOf(items.map((i) => i.x + i.cx)) - x0, H = maxOf(items.map((i) => i.y + i.cy)) - y0;
    // the room the pictures' effects take beyond the group's frame
    const el = Math.max(0, ...items.map((i) => i.e[0] - (i.x - x0))), et = Math.max(0, ...items.map((i) => i.e[1] - (i.y - y0)));
    const er = Math.max(0, ...items.map((i) => i.x + i.cx + i.e[2] - (x0 + W))), eb = Math.max(0, ...items.map((i) => i.y + i.cy + i.e[3] - (y0 + H)));
    const kids = items.map((i) => i.pic.replace(/(<pic:spPr><a:xfrm[^>]*>)<a:off x="0" y="0"\/>/, `$1<a:off x="${i.x - x0}" y="${i.y - y0}"/>`)).join('');
    const n = this.docPr++;
    const fl = floatOf(this.t.objects[ids[0]])!;
    const drawing = '<w:drawing>' + this.anchor(fl, x0, y0, `<wp:extent cx="${W}" cy="${H}"/><wp:effectExtent l="${el}" t="${et}" r="${er}" b="${eb}"/>`,
      `<wp:docPr id="${n}" name="Group ${n}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${WPG_NS}"><wpg:wgp><wpg:cNvGrpSpPr/>` +
      `<wpg:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${H}"/><a:chOff x="0" y="0"/><a:chExt cx="${W}" cy="${H}"/></a:xfrm></wpg:grpSpPr>${kids}</wpg:wgp></a:graphicData></a:graphic>`) + '</w:drawing>';
    // VML for older Words: the group in its own units (EMU here), each picture a shape in it
    const pt = (v: number) => Math.round((v / 12700) * 100) / 100;
    const hRel = fl.xFrom === 'page' ? 'page' : 'margin', vRel = fl.yFrom === 'page' ? 'page' : fl.yFrom === 'margin' ? 'margin' : 'text';
    const wrap = fl.wrap === 'square' ? `<w10:wrap type="square"${fl.side ? ` side="${fl.side === 'bothSides' ? 'both' : fl.side}"` : ''}/>` : fl.wrap === 'topBottom' ? '<w10:wrap type="topAndBottom"/>' : '';
    const z = fl.wrap === 'behind' ? -251658240 + n : 251659264 + n;
    // (shape ids from one count, clear of the watermark's 2049 on; the picture shape type once in each part, as Word writes it)
    const type = this.oleTypes.has(main) ? '' : T75;
    this.oleTypes.add(main);
    const shapes = items.map((i) => `<v:shape id="Picture ${i.id}" o:spid="_x0000_s${this.vmlNo++}" type="#_x0000_t75" style="position:absolute;left:${i.x - x0};top:${i.y - y0};width:${i.cx};height:${i.cy}"><v:imagedata r:id="${i.blip}" o:title=""/></v:shape>`).join('');
    const vml = `<w:pict xmlns:v="${V_NS}" xmlns:o="${O_NS}" xmlns:w10="${W10_NS}">${type}<v:group id="Group ${n}" o:spid="_x0000_s${this.vmlNo++}" style="position:absolute;margin-left:${pt(x0)}pt;margin-top:${pt(y0)}pt;width:${pt(W)}pt;height:${pt(H)}pt;z-index:${z};mso-position-horizontal-relative:${hRel};mso-position-vertical-relative:${vRel}" coordsize="${W},${H}">${shapes}${wrap}</v:group></w:pict>`;
    const r = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
    return `<w:r>${r}<mc:AlternateContent><mc:Choice Requires="wpg">${drawing}</mc:Choice><mc:Fallback>${vml}</mc:Fallback></mc:AlternateContent></w:r>`;
  }

  /** A text box: Word's text box shape, with its paragraphs inside it (Word fits its height to them). */
  private async textBox(main: string, id: number, o: Extract<DocObject, { kind: 'textbox' }>, rPr: string): Promise<string> {
    const n = paraCount(rt.plainText(o.runs));
    const paras = fitParas(o.paras, n);
    const runsOf = this.splitParas(o.runs);
    const ps: string[] = [];
    for (let p = 0; p < n; p++) {
      if (p > 0 && joins(paras[p - 1], paras[p])) ps[ps.length - 1] = joinTo(ps[ps.length - 1], await this.paragraph(main, paras[p], runsOf[p] ?? [], 0, -1, '', true), paras[p]);
      else ps.push(await this.paragraph(main, paras[p], runsOf[p] ?? [], 0));
    }
    const N = styleOf(this.t, {});
    const lines = o.runs.reduce((a, r) => a + (r.text.match(/\n/g)?.length ?? 0), 1);
    // a shape keeps its own height (its text in the middle); a text box grows to fit its text
    const h = o.geo && o.h ? o.h : Math.max(o.h ?? 0, lines * N.size * 1.25 + 2 * BOX_PAD.y);
    const cx = emu(o.w), cy = emu(h);
    const k = this.docPr++;
    const look = lookOf(o);
    // (Word's gradient as the file had it, while its first colour is still the fill here)
    const grad = o.wfill && gradientOk(o.wfill) && (gradFirst(o.wfill) ?? null) === (o.fill ? `#${hex6(o.fill).toLowerCase()}` : null) ? o.wfill : null;
    const fill = grad ?? (o.fill ? `<a:solidFill><a:srgbClr val="${hex6(o.fill)}"/></a:solidFill>` : '<a:noFill/>');
    // the look's own white fill (under a shadow) gives way to the box's fill
    const lookRest = lookXml(look).replace(/^<a:solidFill>.*?<\/a:solidFill>/, '');
    const line = look?.frame ? '' : '<a:ln><a:noFill/></a:ln>';
    // a shape (Insert > Shapes): Word's shape with its outline (and which of ours it is, for the ones Word has no preset for)
    const geom = o.geo ? geoGeomXml(o.geo, o.w, h) : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
    if (o.geo) (this.model.geos ??= {})[id] = o.geo;
    const shape = `<wp:docPr id="${k}" name="${o.geo ? 'Shape' : 'Text Box'} ${id}"/><wp:cNvGraphicFramePr/>` +
      `<a:graphic><a:graphicData uri="${WPS_NS}"><wps:wsp><wps:cNvSpPr${o.geo ? '' : ' txBox="1"'}/>` +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>${geom}${fill}${line}${lookRest}</wps:spPr>` +
      `<wps:txbx><w:txbxContent>${ps.join('') || '<w:p/>'}</w:txbxContent></wps:txbx>` +
      `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${emu(BOX_PAD.x)}" tIns="${emu(BOX_PAD.y)}" rIns="${emu(BOX_PAD.x)}" bIns="${emu(BOX_PAD.y)}" anchor="${o.geo ? 'ctr' : 't'}" anchorCtr="0">${o.geo ? '<a:noAutofit/>' : '<a:spAutoFit/>'}</wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${this.placed(o, cx, cy, shape)}</w:drawing></mc:Choice><mc:Fallback/></mc:AlternateContent></w:r>`;
  }

  // ---------------------------------------------------------------- figures and pictures

  /** A chart: Word's own chart (with its data as a workbook inside, for Edit Data), kept here too in our part. */
  private chartNo = 0;
  private async chart(main: string, id: number, o: Extract<DocObject, { kind: 'picture' }>, box: ChartBox, rPr: string): Promise<string> {
    const size = shownSize({ w: o.w, h: o.h }, o.scale ?? 1, this.textW);
    const { rid, print } = await addChart(this.pkg, main, 'word', ++this.chartNo, box, size.w, size.h);
    // (under its number in the file, not the id it has while open: the reader gives it a new one, and the
    // same file saved again writes the same)
    (this.model.charts ??= {})[id] = { ...box, chart: { ...box.chart, id: this.chartNo } };
    if (print) (this.model.chartPrints ??= {})[id] = print;
    const n = this.docPr++;
    const ex = isChartEx(box.chart.kind);
    const uri = ex ? CX_NS : C_NS;
    const tag = ex ? 'cx' : 'c';
    const chart = '<w:drawing>' + this.placed(o, emu(size.w), emu(size.h),
      `<wp:docPr id="${n}" name="${CHART_NAME} ${id}"${o.alt?.trim() ? ` descr="${xmlAttr(o.alt.trim())}"` : ''}/><wp:cNvGraphicFramePr/>` +
      `<a:graphic><a:graphicData uri="${uri}"><${tag}:chart xmlns:${tag}="${uri}" r:id="${rid}"/></a:graphicData></a:graphic>`) + '</w:drawing>';
    const r = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
    if (!ex) return `<w:r>${r}${chart}</w:r>`;
    // Word 2016's newer chart, with a picture of it for older programs
    let fallback = '';
    try {
      const { mime, bytes } = await this.wordPicture(fromDataUrl(o.src));
      const ext = MIME_EXT[mime];
      if (ext && ext !== 'svg') {
        const blip = this.media(main, bytes, ext);
        const cx = emu(size.w), cy = emu(size.h), m = this.docPr++;
        fallback = '<w:drawing>' + this.placed(o, cx, cy,
          `<wp:docPr id="${m}" name="${CHART_NAME} ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
          `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Chart"/><pic:cNvPicPr/></pic:nvPicPr>` +
          `<pic:blipFill><a:blip r:embed="${blip}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
          `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`) + '</w:drawing>';
      }
    } catch { /* no picture: older programs show nothing */ }
    return `<w:r>${r}<mc:AlternateContent><mc:Choice xmlns:cx1="${CX1_NS}" Requires="cx1">${chart}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent></w:r>`;
  }

  /**
   * An embedded object, as Word writes one: its picture in a VML shape and the object's part
   * (an OLE compound file, or an Office file of its own) named by its program, so Word opens it
   * in that program on a double-click. Always in line with the text.
   */
  private async embedded(main: string, o: Extract<DocObject, { kind: 'picture' }>, e: Embedded, rPr: string): Promise<string> {
    let mime: string, bytes: Uint8Array;
    try {
      ({ mime, bytes } = await this.wordPicture(fromDataUrl(o.src)));
    } catch {
      return '';
    }
    const size = shownSize({ w: o.w, h: o.h }, o.scale ?? 1, this.textW);
    let ext = MIME_EXT[mime];
    if (!ext || ext === 'svg') {
      if (mime !== 'image/svg+xml' || !this.deps.svgToPng) return '';
      const k = 300 / 72;
      bytes = await this.deps.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round(size.w * k)), Math.max(1, Math.round(size.h * k)));
      ext = 'png';
    }
    let part: ReturnType<typeof embeddedPart>;
    try {
      part = embeddedPart(e);
    } catch {
      return '';
    }
    const img = this.media(main, bytes, ext);
    return this.objectXml(main, { bytes: part.bytes, type: part.type, rel: part.rel, path: `${part.base}{n}.${part.ext}` }, e.prog, img, { w: o.w, h: o.h }, size, rPr, !!e.icon, o.alt?.trim());
  }

  /**
   * An object's part and its picture (`img`, a relationship id) as Word writes them: a VML shape
   * `size` big (its own size `own`), and the OLEObject naming the program that opens the part.
   */
  private objectXml(main: string, part: { bytes: Uint8Array; type: string; rel: string; path: string }, prog: string, img: string, own: { w: number; h: number }, size: { w: number; h: number }, rPr: string, icon: boolean, alt?: string): string {
    const n = ++this.oleCount;
    const path = `embeddings/${part.path.replace('{n}', String(n))}`;
    this.pkg.add(`word/${path}`, part.bytes, part.type);
    const rel = this.pkg.relate(main, part.rel, path);
    const shape = `_x0000_i${1024 + n}`;
    // the picture frame's shape type, once in each part (the standard one, from the VML part of Office Open XML)
    const type = this.oleTypes.has(main) ? '' : T75;
    this.oleTypes.add(main);
    const pt = (v: number) => Math.round(v * 100) / 100;
    const r = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
    return `<w:r>${r}<w:object xmlns:v="${V_NS}" xmlns:o="${O_NS}" w:dxaOrig="${twips(own.w)}" w:dyaOrig="${twips(own.h)}">${type}` +
      `<v:shape id="${shape}" type="#_x0000_t75"${alt ? ` alt="${xmlAttr(alt)}"` : ''} style="width:${pt(size.w)}pt;height:${pt(size.h)}pt" o:ole=""><v:imagedata r:id="${img}" o:title=""/></v:shape>` +
      `<o:OLEObject Type="Embed" ProgID="${xml(prog)}" ShapeID="${shape}" DrawAspect="${icon ? 'Icon' : 'Content'}" ObjectID="_${1800000000 + n}" r:id="${rel}"/></w:object></w:r>`;
  }

  /**
   * A structure as a ChemDraw object (Word's w:object holding the drawing as CDX): a double-click
   * in Word opens it in ChemDraw, and until then Word shows the picture made here. The drawing
   * goes in our part too, with a fingerprint of the CDX, to be used while the object still holds
   * it. Null when it can't be one (no CDX), to be saved as a picture instead.
   */
  private async chemdrawDrawing(main: string, id: number, o: Extract<DocObject, { kind: 'drawing' }>, prog: string, rPr: string): Promise<string | null> {
    const t = this.t;
    let cdx: Uint8Array | null = null;
    try {
      cdx = this.deps.cdx?.(o.contents, t.drawingStyle) ?? null;
    } catch {
      cdx = null;
    }
    if (!cdx) return null;
    const pic = await this.deps.picture(o.contents, t.drawingStyle, o.frame);
    if (!pic) return null;
    const smiles = await this.deps.smiles?.(o.contents, t.drawingStyle).catch(() => null) ?? null;
    const alt = o.alt?.trim() || contentsAlt(o.contents) || structureAltText(smiles) || '';
    this.model.drawings[id] = { contents: o.contents, w: pic.w, h: pic.h, png: bytesHash(pic.png), cdx: bytesHash(cdx), alt, ...(o.ole ? { ole: o.ole } : {}), ...(o.fromPicture ? { fromPicture: o.fromPicture } : {}) };
    const size = shownSize({ w: pic.w, h: pic.h }, o.scale ?? 1, this.textW);
    const img = this.media(main, pic.png, 'png');
    return this.objectXml(main, { bytes: chemdrawObject(cdx, prog, pic.emf ? { emf: pic.emf, w: pic.w, h: pic.h } : null), type: OLE_TYPE, rel: OLE_REL, path: 'oleObject{n}.bin' }, prog, img, { w: pic.w, h: pic.h }, size, rPr, false, alt);
  }

  private oleCount = 0;
  /**
   * Whether the theme written is the one read (not one made from a Design choice here): only then do
   * runs and styles keep their links to its colours and fonts (review F2-R03).
   */
  private get themeKept(): boolean { return !wordTheme(this.t.design); }
  private runProps(r: TextRun, st: NamedStyle, x: Parameters<typeof runProps>[2]): string {
    return runProps(r, st, { ...x, themes: this.themeKept });
  }
  /** The next VML shape number for a picture group's fallback. */
  private vmlNo = 8193;
  private oleTypes = new Set<string>();

  /** A picture's bytes as Word can hold them: a WebP one as PNG (its type unknown, so left out, when it can't be made one). */
  private async wordPicture(p: { mime: string; bytes: Uint8Array }): Promise<{ mime: string; bytes: Uint8Array }> {
    if (!AS_PNG.has(p.mime)) return p;
    const png = this.deps.pictureToPng ? await this.deps.pictureToPng(p.bytes, p.mime).catch(() => null) : null;
    return png ? { mime: 'image/png', bytes: png } : { mime: '', bytes: p.bytes };
  }

  private async picture(main: string, id: number, o: DocObject, rPr: string): Promise<string> {
    if (o.kind === 'picture' && o.chart) return this.chart(main, id, o, o.chart, rPr);
    if (o.kind === 'picture' && o.embed) return this.embedded(main, o, o.embed, rPr);
    // a structure saved as a ChemDraw object: one that came from a ChemDraw object, or any when
    // structures are saved as ChemDraw objects (in the line only, and not turned: as Word keeps objects)
    if (o.kind === 'drawing' && !floatOf(o) && !o.rot && !o.flipH && !o.flipV && !o.frame && !lookOf(o)) {
      const prog = o.ole ?? (this.deps.chemdrawObjects && o.contents.atoms.length ? chemdrawProg() : undefined);
      const got = prog ? await this.chemdrawDrawing(main, id, o, prog, rPr) : null;
      if (got) return got;
    }
    const t = this.t;
    let blip: string, svgId: string | null = null, size: { w: number; h: number }, name: string, smiles: string | null = null;
    // a picture's Picture Format settings, its cropping, and its original when the blip has effects worked in
    let fx: PictureFx | undefined, crop: { l: number; t: number; r: number; b: number } | undefined, layer: string | null = null;
    // a diagram in the document's own text: Word gets its shapes as a group (the picture for older Words)
    let group: ((docPr: string) => string) | null = null;
    if (o.kind === 'drawing') {
      const pic = await this.deps.picture(o.contents, t.drawingStyle, o.frame);
      if (!pic) return '';
      if (main === 'word/document.xml' && pic.x !== undefined && pic.y !== undefined) {
        const kids = diagramShapesXml(o.contents, t.drawingStyle);
        const at = { x: pic.x, y: pic.y, w: pic.w, h: pic.h };
        if (kids) group = (docPr) => `${docPr}<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${WPG_NS}"><wpg:wgp><wpg:cNvGrpSpPr/>` +
          `<wpg:grpSpPr><a:xfrm${turnAttrs(o)}><a:off x="0" y="0"/><a:ext cx="${emu(size.w)}" cy="${emu(size.h)}"/><a:chOff x="${emu(at.x)}" y="${emu(at.y)}"/><a:chExt cx="${emu(at.w)}" cy="${emu(at.h)}"/></a:xfrm></wpg:grpSpPr>` +
          `${kids}</wpg:wgp></a:graphicData></a:graphic>`;
      }
      const svg = pic.svg ? new TextEncoder().encode(pic.svg) : null;
      this.model.drawings[id] = { contents: o.contents, w: pic.w, h: pic.h, png: bytesHash(pic.png), ...(svg ? { svg: bytesHash(svg) } : {}), ...(o.frame ? { frame: o.frame } : {}), ...(o.ole ? { ole: o.ole } : {}), ...(o.fromPicture ? { fromPicture: o.fromPicture } : {}) };
      blip = this.media(main, pic.png, 'png');
      if (svg) svgId = this.media(main, svg, 'svg');
      size = shownSize({ w: pic.w, h: pic.h }, o.scale ?? 1, this.textW);
      // cropping and color changes Word made, while the structure (and so its picture) is as it was
      const wl = o.wordLook;
      if (wl && Math.abs(wl.w - pic.w) < 0.01 && Math.abs(wl.h - pic.h) < 0.01 && wl.print === contentsPrint(o.contents)) {
        fx = wl.fx;
        crop = wl.crop;
        if (crop) size = { w: size.w * (1 - crop.l - crop.r), h: size.h * (1 - crop.t - crop.b) };
      }
      name = `${DRAWING_NAME} ${id}`;
      smiles = await this.deps.smiles?.(o.contents, t.drawingStyle).catch(() => null) ?? null;
    } else if (o.kind === 'picture') {
      let mime: string, bytes: Uint8Array;
      try {
        ({ mime, bytes } = await this.wordPicture(fromDataUrl(o.src)));
      } catch {
        return '';
      }
      const ext = MIME_EXT[mime];
      if (!ext) return '';
      size = shownSize({ w: o.w, h: o.h }, o.scale ?? 1, this.textW);
      // what Word can't show live goes in worked in, with the original as the picture's layer
      const baked = bakedPart(o.fx) && this.deps.bakePicture ? await this.deps.bakePicture(o).catch(() => null) : null;
      if (ext === 'svg') {
        // Word shows the SVG; older versions the PNG beside it
        if (!this.deps.svgToPng) return '';
        const k = 300 / 72;
        const png = await this.deps.svgToPng(new TextDecoder().decode(bytes), Math.max(1, Math.round(size.w * k)), Math.max(1, Math.round(size.h * k)));
        blip = this.media(main, png, 'png');
        if (!baked) svgId = this.media(main, bytes, 'svg');
      } else blip = this.media(main, bytes, ext);
      if (baked) { layer = blip; blip = this.media(main, baked, 'png'); }
      fx = o.fx;
      crop = o.crop;
      if (fx?.bg?.tol !== undefined) (this.model.pictureTol ??= {})[id] = fx.bg.tol;
      name = `Picture ${id}`;
    } else return '';
    const cx = emu(size.w), cy = emu(size.h);
    const n = this.docPr++;
    const exts = (svgId ? `<a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="${NS_SVG}" r:embed="${svgId}"/></a:ext>` : '') + (layer ? imgPropsXml(fx, layer, crop) : '');
    const ext = blipEffectsXml(fx) + (exts ? `<a:extLst>${exts}</a:extLst>` : '');
    const srcRect = crop && (crop.l || crop.t || crop.r || crop.b)
      ? `<a:srcRect l="${Math.round(crop.l * 100000)}" t="${Math.round(crop.t * 100000)}" r="${Math.round(crop.r * 100000)}" b="${Math.round(crop.b * 100000)}"/>` : '';
    const alt = o.kind === 'drawing' ? o.alt?.trim() || contentsAlt(o.contents) || structureAltText(smiles) : o.kind === 'picture' ? o.alt?.trim() : '';
    const descr = alt ? ` descr="${xmlAttr(alt)}"` : '';
    if (o.kind === 'drawing' && this.model.drawings[id]) this.model.drawings[id].alt = alt ?? '';
    const look = lookOf(o);
    const docPr = `<wp:docPr id="${n}" name="${xml(name)}"${descr}/>`;
    const picture = `<w:drawing>` + this.placed(o, cx, cy,
      `${docPr}<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${blip}">${ext}</a:blip>${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm${turnAttrs(o)}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>${pictureGeomXml(fx, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>')}${lookXml(look)}</pic:spPr></pic:pic></a:graphicData></a:graphic>`) + '</w:drawing>';
    const r = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
    if (group) return `<w:r>${r}<mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>${this.placed(o, cx, cy, group(docPr))}</w:drawing></mc:Choice><mc:Fallback>${picture}</mc:Fallback></mc:AlternateContent></w:r>`;
    return `<w:r>${r}${picture}</w:r>`;
  }

  private mediaCount = 0;
  private mediaFiles = new MediaFiles();
  private media(from: string, bytes: Uint8Array, ext: string): string {
    let name = this.mediaFiles.find(bytes, ext);
    if (!name) {
      name = `media/image${++this.mediaCount}.${ext}`;
      this.pkg.add(`word/${name}`, bytes);
      this.mediaFiles.note(bytes, ext, name);
    }
    return this.pkg.relate(from, DOCX_REL.image, name);
  }

  // ---------------------------------------------------------------- tables

  /** A table as Word's own: its columns, heading rows, ACS rules (or a grid), text and alignment. */
  private table(id: number, tab: TableData, align: Justify): string {
    const style = this.t.drawingStyle;
    const size = tab.size ?? style.captionSize;
    const font = style.captionFont || 'Arial';
    const entry: DocxModel['tables'][number] = { table: tab, text: tableText(tab) };
    this.model.tables[id] = entry;
    const lw = Math.max(2, Math.min(96, Math.round(style.lineWidth * 8)));
    const line = `w:val="single" w:sz="${lw}" w:space="0" w:color="000000"`;
    const none = 'w:val="nil"';
    const borders = tab.lines === 'grid'
      ? `<w:top ${line}/><w:left ${line}/><w:bottom ${line}/><w:right ${line}/><w:insideH ${line}/><w:insideV ${line}/>`
      : tab.lines === 'acs' ? `<w:top ${line}/><w:left ${none}/><w:bottom ${line}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`
        : `<w:top ${none}/><w:left ${none}/><w:bottom ${none}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`;
    const width = tab.cols.reduce((a, b) => a + b, 0);
    const padX = twips(PAD_X * size), padY = twips(PAD_Y * size);
    const title = tab.title?.length ? rt.plainText(tab.title).replace(/\s+/g, ' ').trim() : '';
    // which of ours it is: a hidden bookmark at the start of its first cell
    const markId = this.bookmarkId++;
    let mark = `<w:bookmarkStart w:id="${markId}" w:name="${TABLE_MARK}${id}"/><w:bookmarkEnd w:id="${markId}"/>`;
    const tblPr = `<w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:jc w:val="${align === 'right' ? 'right' : align === 'left' ? 'left' : 'center'}"/>` +
      `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/>` +
      `<w:tblCellMar><w:top w:w="${padY}" w:type="dxa"/><w:left w:w="${padX}" w:type="dxa"/><w:bottom w:w="${padY}" w:type="dxa"/><w:right w:w="${padX}" w:type="dxa"/></w:tblCellMar>` +
      `<w:tblLook w:val="0600" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>` +
      // its alt-text title: the table's own title (which of ours it is goes in a hidden bookmark)
      `${title ? `<w:tblCaption w:val="${xmlAttr(title)}"/>` : ''}</w:tblPr>`;
    const grid = `<w:tblGrid>${tab.cols.map((w) => `<w:gridCol w:w="${twips(w)}"/>`).join('')}</w:tblGrid>`;
    const cellPara = (runs: TextRun[], paras: ParaStyle[] | undefined, jc: Justify, k = 1): string => {
      const n = paraCount(rt.plainText(runs));
      const ps = fitParas(paras, n);
      return splitParagraphs(runs).map((rs, i) => {
        const ppr = `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="${JC[ps[i]?.align ?? jc]}"/></w:pPr>`;
        return `<w:p>${ppr}${rs.map((r) => tableRun(r, font, size * k, rs)).join('')}</w:p>`;
      }).join('') || `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>`;
    };
    const rows: string[] = [];
    tab.rows.forEach((row, r) => {
      const cells: string[] = [];
      const lastHead = tab.head > 0 && r === tab.head - 1;
      for (let c = 0; c < tab.cols.length; c++) {
        if (isCovered(tab, r, c)) continue;
        const span = spanOf(tab, r, c);
        const w = tab.cols.slice(c, c + span).reduce((a, b) => a + b, 0);
        const cell = row[c] ?? { runs: [] };
        const tcBorders = tab.lines === 'acs' && lastHead && r < tab.rows.length - 1 ? `<w:tcBorders><w:bottom ${line}/></w:tcBorders>` : '';
        const text = cellPara(cell.runs, cell.paras, cellAlign(tab, r, c)).replace('</w:pPr>', `</w:pPr>${mark}`);
        mark = '';
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips(w)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${tcBorders}</w:tcPr>${text}</w:tc>`);
      }
      rows.push(`<w:tr>${r < tab.head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`);
    });
    const titlePara = tab.title?.length ? cellPara(tab.title, undefined, 'left') : '';
    const notesPara = tab.notes?.length ? cellPara(tab.notes, undefined, 'left', 0.8) : '';
    const tbl = `<w:tbl>${tblPr}${grid}${rows.join('')}</w:tbl>`;
    // with a print of how its text looks as written, to tell whether Word changed it (native-print.ts)
    const el = fragment(tbl);
    if (el) entry.pr = wordTablePrint(el);
    return `${titlePara}${tbl}${notesPara}`;
  }

  /**
   * A table typed into in the text, as a Word table: its cells' paragraphs written as the
   * text's are (structures and pictures in them too), its lines, shading and cell alignment.
   */
  private async docTable(main: string, tab: TableData, align: Justify): Promise<string> {
    const grid = `w:val="single" w:sz="${Math.round(GRID_LINE * 8)}" w:space="0" w:color="000000"`;
    const rule = `w:val="single" w:sz="${Math.round(ACS_LINE * 8)}" w:space="0" w:color="000000"`;
    const none = 'w:val="nil"';
    const borders = tab.lines === 'grid'
      ? `<w:top ${grid}/><w:left ${grid}/><w:bottom ${grid}/><w:right ${grid}/><w:insideH ${grid}/><w:insideV ${grid}/>`
      : tab.lines === 'acs' ? `<w:top ${rule}/><w:left ${none}/><w:bottom ${rule}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`
        : `<w:top ${none}/><w:left ${none}/><w:bottom ${none}/><w:right ${none}/><w:insideH ${none}/><w:insideV ${none}/>`;
    // a table style: Word's own (written in styles.xml), with the parts it picks out; else the lines themselves
    const styled = !!tab.style && !!(this.t.tableStyles?.[tab.style] ?? builtInStyle(tab.style));
    // (a floating table, its width, indent and AutoFit as Word had them; a table made here has fixed columns)
    const tblPr = `<w:tblPr>${styled ? `<w:tblStyle w:val="${tab.style}"/>` : ''}${tableFloatXml(tab.float)}${tableWidthXml(tab)}<w:jc w:val="${align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'}"/>` +
      `${tab.indent ? `<w:tblInd w:w="${twips(tab.indent)}" w:type="dxa"/>` : ''}${styled ? '' : `<w:tblBorders>${borders}</w:tblBorders>`}${tab.autofit ? '' : '<w:tblLayout w:type="fixed"/>'}` +
      marginsXml('tblCellMar', tab.pad ?? DEFAULT_MARGINS) +
      // (its Table Style Options, kept with a table that has no style for when it gets one)
      `${styled || tab.look ? tableLookXml(tab) : PLAIN_LOOK}</w:tblPr>`;
    const gridXml = `<w:tblGrid>${tab.cols.map((w) => `<w:gridCol w:w="${twips(w)}"/>`).join('')}</w:tblGrid>`;
    const rows: string[] = [];
    for (let r = 0; r < tab.rows.length; r++) {
      const row = tab.rows[r];
      const cells: string[] = [];
      const lastHead = tab.head > 0 && r === tab.head - 1 && r < tab.rows.length - 1;
      for (let c = 0; c < tab.cols.length; c++) {
        const own = coveringCell(tab, r, c);
        // a cell under one merged down from above: Word's continuing cell, as wide as the merged one
        const under = own.r < r;
        if (own.c !== c || (!under && isCovered(tab, r, c))) continue;
        const span = spanOf(tab, own.r, own.c);
        const w = tab.cols.slice(c, c + span).reduce((a, b) => a + b, 0);
        const cell = tab.rows[own.r]?.[own.c] ?? row[c] ?? { runs: [] };
        const tcPr = [`<w:tcW w:w="${twips(w)}" w:type="dxa"/>`];
        if (span > 1) tcPr.push(`<w:gridSpan w:val="${span}"/>`);
        if (under) tcPr.push('<w:vMerge/>');
        else if (rowSpanOf(tab, r, c) > 1) tcPr.push('<w:vMerge w:val="restart"/>');
        // the cell's own lines (with the ACS rule under the headings, when the table has no style)
        const lines: CellBorders = { ...(!styled && tab.lines === 'acs' && lastHead ? { bottom: { style: 'single', w: GRID_LINE, color: '#000000' } } : {}), ...cell.borders };
        // a cell merged down: its top line on its first row, its bottom line on its last
        const down = rowSpanOf(tab, own.r, own.c);
        if (under) delete lines.top;
        if (own.r + down - 1 > r) delete lines.bottom;
        tcPr.push(bordersXml('tcBorders', lines));
        if (cell.fill) tcPr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex6(cell.fill)}"/>`);
        if (cell.pad) tcPr.push(marginsXml('tcMar', cell.pad));
        if (cell.valign) tcPr.push(`<w:vAlign w:val="${cell.valign}"/>`);
        if (under) { cells.push(`<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr><w:p/></w:tc>`); continue; }
        // the cell's paragraphs, set as the text is, lined up as the cell is; a table in the cell as Word's table in it
        const n = paraCount(rt.plainText(cell.runs));
        const ps = fitParas(cell.paras, n);
        const ca = docCellAlign(tab, r, c);
        const parts = this.splitParas(cell.runs);
        const paras: string[] = [];
        let lastTable = false;
        // the numbers shown in the cell, which its items of a list kept from the file get from Word
        // too: Word counts them with the lists round the table, in order (F2b-R05)
        const shownHere = listInfo(ps);
        const outer = this.shownN;
        // a cell's numbered lists made here, as the text's: a new Word list where the number starts
        // again (at its start number), one on the same levels for an item with its own (review F2c-R03)
        let cellList = 0;
        for (let i = 0; i < n; i++) {
          const pr = parts[i] ?? [];
          const inner = pr.length === 1 && pr[0].obj !== undefined && pr[0].text === OBJECT_CHAR ? this.t.objects[pr[0].obj] : undefined;
          if (inner?.kind === 'table') {
            if (lastTable) paras.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
            paras.push(await this.docTable(main, inner.table, ps[i]?.align ?? ca));
            lastTable = true;
            continue;
          }
          const cps = { ...ps[i], align: ps[i]?.align ?? ca };
          const key = `n${cps.scheme ?? ''}`;
          if (cps.list === 'number' && shownHere[i]?.start) cellList = this.newList(key, cps.startAt);
          else if (cps.list === 'number' && !cps.cont && cps.startAt !== undefined && shownHere[i]?.n === cps.startAt && cellList > 0 && this.numKeys[cellList - 1] === key) {
            cellList = this.addNum(key, false, { level: Math.max(0, Math.min(8, cps.level ?? 0)), value: cps.startAt });
          }
          this.shownN = cps.list === 'number' && !cps.cont ? shownHere[i]?.n : undefined;
          if (i > 0 && !lastTable && paras.length && joins({ ...ps[i - 1], align: ps[i - 1]?.align ?? ca }, cps)) paras[paras.length - 1] = joinTo(paras[paras.length - 1], await this.paragraph(main, cps, pr, cellList, -1, '', true), cps);
          else paras.push(await this.paragraph(main, cps, pr, cellList));
          lastTable = false;
        }
        this.shownN = outer;
        // (Word's cells end with a paragraph, after any table in them)
        if (lastTable || !paras.length) paras.push('<w:p/>');
        // a heading row that doesn't repeat, where neither a style nor a rule under it says it is one:
        // a hidden bookmark at the start of its first cell (HEAD_MARK, read back by docx-read.ts)
        if (r < tab.head && !cells.length && tab.noRepeat && !styled && tab.lines !== 'acs') {
          const id = this.bookmarkId++;
          paras.unshift(`<w:bookmarkStart w:id="${id}" w:name="${HEAD_MARK}${id}"/><w:bookmarkEnd w:id="${id}"/>`);
        }
        cells.push(`<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paras.join('')}</w:tc>`);
      }
      // its height, and whether it repeats at the top of each page as a heading row
      const trPr = rowHeightXml(tab.rowH?.[r]) + (r < tab.head && !tab.noRepeat ? '<w:tblHeader/>' : '');
      rows.push(`<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells.join('')}</w:tr>`);
    }
    return `<w:tbl>${tblPr}${gridXml}${rows.join('')}</w:tbl>`;
  }

  // ---------------------------------------------------------------- page, header and footer

  /** Header and footer parts written so far (each section with its own gets its own). */
  private hfParts = { header: 0, footer: 0 };
  /** Watermarks written so far (each shape needs its own id). */
  private watermarks = 0;

  /**
   * A section's properties: how it starts, its paper, margins, columns, page numbering and line
   * numbers, and its own header and footer (a section linked to the one before has none, and
   * Word shows the one before's).
   */
  private async section(main: string, sec: Section, secs: Section[]): Promise<string> {
    const t = this.t;
    const pg = sec.page;
    const hf = sec.hf;
    const fullW = Math.max(36, pg.w - pg.left - pg.right);
    const refs: string[] = [];
    const add = async (kind: 'header' | 'footer', type: 'default' | 'first' | 'even', numbered: boolean) => {
      if (sec.linked) return;
      const key: HfKey = type === 'default' ? kind : `${type}${kind === 'header' ? 'Header' : 'Footer'}`;
      const name = `${kind}${this.hfParts[kind] + 1}.xml`;
      const body = hf.bodies?.[key];
      const xmlText = body ? await this.hfBodyXml(`word/${name}`, kind, body, pg)
        : this.headerFooter(kind, numbered, hf, fullW, pg, zonesFor(hf, key), numbersFor(hf, key));
      if (!xmlText) return;
      this.hfParts[kind]++;
      this.pkg.add(`word/${name}`, xmlText, kind === 'header' ? DOCX_CT.header : DOCX_CT.footer);
      const rid = this.pkg.relate(main, kind === 'header' ? DOCX_REL.header : DOCX_REL.footer, name);
      refs.push(`<w:${kind}Reference w:type="${type}" r:id="${rid}"/>`);
    };
    await add('header', 'default', true);
    await add('footer', 'default', true);
    // a first page of its own (Different First Page), or one without its number (the header and footer text stay)
    const titlePg = hasTitlePg(hf);
    // (a section linked to this one with a first page of its own shows this one's first page header and footer)
    let linkedFirst = false;
    for (let i = sec.index + 1; i < secs.length && secs[i].linked; i++) linkedFirst ||= hasTitlePg(secs[i].hf);
    // (and a first page header or footer kept without Different First Page, as Word keeps them)
    if (titlePg || linkedFirst || hf.first || hf.bodies?.firstHeader || hf.bodies?.firstFooter) { await add('header', 'first', !!hf.firstPage && hf.onFirst); await add('footer', 'first', !!hf.firstPage && hf.onFirst); }
    if (hf.oddEven) { await add('header', 'even', true); await add('footer', 'even', true); }
    // header references come before footer references
    refs.sort((a, b) => Number(b.startsWith('<w:header')) - Number(a.startsWith('<w:header')));
    const land = pg.w > pg.h;
    // the notes' numbering, where it isn't Word's own (1, 2, 3 and i, ii, iii)
    const fmt = (tag: string, v: string | undefined, def: string) => (v && v !== def ? `<w:${tag}Pr><w:numFmt w:val="${v}"/></w:${tag}Pr>` : '');
    refs.push(fmt('footnote', t.notes?.foot, FOOT_FORMAT), fmt('endnote', t.notes?.end, END_FORMAT));
    // how it starts (the first section starts the document)
    if (sec.index > 0 && sec.kind !== 'nextPage') refs.push(`<w:type w:val="${sec.kind}"/>`);
    // Word counts line numbers' start from 0 (start="4" numbers from 5)
    const L = sec.lines;
    const lines = L ? `<w:lnNumType w:countBy="${Math.max(1, Math.round(L.countBy))}"${L.start !== 1 ? ` w:start="${Math.max(0, Math.round(L.start) - 1)}"` : ''}${L.distance !== undefined ? ` w:distance="${twips(L.distance)}"` : ''} w:restart="${L.restart === 'page' ? 'newPage' : L.restart === 'section' ? 'newSection' : 'continuous'}"/>` : '';
    const numFmt = sec.format !== 'decimal' ? ` w:fmt="${sec.format}"` : '';
    // (the first section's numbers start at 1 without saying so: a start there would restart them if the document is put inside another)
    const start = sec.restart !== undefined && !(sec.index === 0 && Math.round(sec.restart) === 1) ? ` w:start="${Math.round(sec.restart)}"` : '';
    return `<w:sectPr>${refs.join('')}<w:pgSz w:w="${twips(pg.w)}" w:h="${twips(pg.h)}"${land ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${twips(pg.top)}" w:right="${twips(pg.right)}" w:bottom="${twips(pg.bottom)}" w:left="${twips(pg.left)}" w:header="${twips(pg.header)}" w:footer="${twips(pg.footer)}" w:gutter="0"/>` +
      `${sec.border ? pageBordersXml(sec.border) : ''}${lines}${numFmt || start ? `<w:pgNumType${numFmt}${start}/>` : ''}${colsXml(pg)}${titlePg ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`;
  }

  /** A header or footer part: its left, centre and right text on one line (with tab stops), and the page number. Null when empty. */
  private headerFooter(kind: 'header' | 'footer', numbered: boolean, hf: HeaderFooter, fullW: number, pg: PageSetup, zones = hf[kind], numbers = hf.numbers): string | null {
    const t = this.t;
    const place = numbers === 'none' || !numbered ? null : numbers;
    const at = place && place.startsWith(kind) ? ['left', 'center', 'right'].indexOf(place.split('-')[1]) : -1;
    // a watermark is Word's: a shape in the header, behind the text
    const wm = kind === 'header' && t.watermark?.text ? watermarkXml(t.watermark, pg, this.watermarks++) : '';
    if (!zones.some((z) => z) && at < 0 && !wm) return null;
    const normal = styleOf(t, undefined);
    const size = Math.min(10, normal.size);
    const rPr = `<w:rFonts w:ascii="${xml(normal.font)}" w:hAnsi="${xml(normal.font)}" w:cs="${xml(normal.font)}"/><w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/>`;
    const parts: string[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) parts.push(`<w:r><w:rPr>${rPr}</w:rPr><w:tab/></w:r>`);
      const text = zones[i] ?? '';
      if (text) parts.push(run(rPr, text));
      if (i === at) {
        const lead = (text ? ' ' : '') + hf.prefix;
        if (lead) parts.push(run(rPr, lead));
        parts.push(field(rPr, ' PAGE \\* CHARFORMAT ', String(hf.start ?? 1)));
      }
    }
    // drop the tabs after the last zone with something in it
    while (parts.length && parts[parts.length - 1].includes('<w:tab/>')) parts.pop();
    // in Word's Header or Footer style when the file read had it (its look is written on the paragraph itself as well)
    // (with the style's own tab stops cleared where they aren't these, so the three places stay where they are)
    const hfStyle = t.kept?.styles?.find((k) => k.type === 'paragraph' && new RegExp(`<w:name w:val="${kind}"/>`, 'i').test(k.xml));
    const tabsAt = [twips(fullW / 2), twips(fullW)].map(String);
    const clear = hfStyle ? [...hfStyle.xml.matchAll(/<w:tab w:val="(?!clear)[^"]*" w:pos="(-?\d+)"/g)].map((m) => m[1]).filter((x) => !tabsAt.includes(x)).map((x) => `<w:tab w:val="clear" w:pos="${x}"/>`).join('') : '';
    const pPr = `<w:pPr>${hfStyle ? `<w:pStyle w:val="${xml(hfStyle.id)}"/>` : ''}<w:tabs>${clear}<w:tab w:val="center" w:pos="${tabsAt[0]}"/><w:tab w:val="right" w:pos="${tabsAt[1]}"/></w:tabs>` +
      `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>`;
    const vml = wm ? ` xmlns:v="${V_NS}" xmlns:o="${O_NS}" xmlns:w10="${W10_NS}"` : '';
    return `${HEAD}<w:${kind === 'header' ? 'hdr' : 'ftr'} ${PART_NS}${vml}><w:p>${pPr}${wm}${parts.join('')}</w:p></w:${kind === 'header' ? 'hdr' : 'ftr'}>`;
  }

  /** A header or footer with pictures, tables or formatted text: its paragraphs as Word's (its pictures related from its own part), with the watermark. */
  private async hfBodyXml(part: string, kind: 'header' | 'footer', body: HfBody, pg: PageSetup): Promise<string> {
    const t = this.t;
    const runsOf = this.splitParas(body.runs);
    const ps = fitParas(body.paras, runsOf.length);
    const out: string[] = [];
    for (let p = 0; p < runsOf.length; p++) {
      const runs = runsOf[p];
      // what its fields show when saved (Word works them out again on each page)
      for (const r of runs) {
        const o = r.obj !== undefined ? t.objects[r.obj] : undefined;
        if (o?.kind === 'field' && !this.shown.has(r.obj!)) this.shown.set(r.obj!, hfFieldText(o, t, String(t.hf.start ?? 1), 1));
      }
      const solo = runs.filter((r) => r.obj !== undefined || r.text);
      const tbo = solo.length === 1 && solo[0].obj !== undefined ? t.objects[solo[0].obj] : undefined;
      if (tbo?.kind === 'table') {
        out.push(await this.docTable(part, tbo.table, ps[p].align ?? 'left'));
        // Word ends a header with a paragraph
        if (p === runsOf.length - 1) out.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>');
        continue;
      }
      const joined = p > 0 && out.length && joins(ps[p - 1], ps[p]) && out[out.length - 1].endsWith('</w:p>');
      if (joined) out[out.length - 1] = joinTo(out[out.length - 1], await this.paragraph(part, ps[p], runs, 0, -1, '', true), ps[p]);
      else out.push(await this.paragraph(part, ps[p], runs, 0));
    }
    const wm = kind === 'header' && t.watermark?.text ? watermarkXml(t.watermark, pg, this.watermarks++) : '';
    // the watermark goes in the first paragraph, behind the text
    if (wm) {
      const first = out[0] ?? '';
      if (!first.startsWith('<w:p')) out.unshift(`<w:p>${wm}</w:p>`);
      else out[0] = first.includes('</w:pPr>') ? first.replace('</w:pPr>', `</w:pPr>${wm}`) : first.replace(/^<w:p( [^>]*)?>/, (m) => m + wm);
    }
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    const vml = wm ? ` xmlns:v="${V_NS}" xmlns:o="${O_NS}" xmlns:w10="${W10_NS}"` : '';
    return `${HEAD}<w:${tag} ${PART_NS}${vml}>${out.join('')}</w:${tag}>`;
  }

  // ---------------------------------------------------------------- styles and lists

  private styles(): string {
    const t = this.t;
    const normal = styleOf(t, undefined);
    const out: string[] = [HEAD, `<w:styles xmlns:w="${W_NS}">`];
    // Word's built-in style names: ours, and those the file read lists in its latent styles
    const latent = new Map([...(t.kept?.latentStyles ?? '').matchAll(/<w:lsdException\b[^>]*\bw:name="([^"]+)"/g)].map((m) => { const n = unxml(m[1]); return [n.toLowerCase(), n]; }));
    const builtIn = (name: string) => wordBuiltInName(name, latent);
    // (a style based on Normal that hasn't Normal's lines or shading: nil sides and no fill, as Word writes it)
    const unNormal = (x: string) => unNormalXml(x, normal);
    out.push(`<w:docDefaults><w:rPrDefault><w:rPr>${fontsXml(normal.font)}<w:kern w:val="2"/><w:sz w:val="${half(normal.size)}"/><w:szCs w:val="${half(normal.size)}"/><w:lang w:val="${xml(t.lang ?? 'en-US')}" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`);
    // (ECMA-376 part 1, 17.7.4.18: latent styles come after the defaults, before the styles)
    if (t.kept?.latentStyles) out.push(t.kept.latentStyles);
    const ids = Object.keys(t.styles);
    // (the character styles the file will have, for the paragraph styles linked to one)
    const chars = new Set((t.kept?.styles ?? []).filter((k) => k.type === 'character' && !this.charStyles[k.id]).map((k) => k.id));
    // (the paragraph styles a style can be based on)
    // (only ours: one kept as the file had it would give the style its settings that aren't written here)
    const paras = new Set(ids);
    // (none based, through others, on itself)
    for (const id of ids) { const seen = new Set([id]); for (let b = t.styles[id]?.basedOn; b && t.styles[b]; b = t.styles[b].basedOn) { if (seen.has(b)) { paras.delete(b); break; } seen.add(b); } }
    for (const id of ['Normal', ...ids.filter((k) => k !== 'Normal')]) {
      const s = t.styles[id];
      if (s) out.push(styleXml(s, ids, builtIn, this.themeKept, normal, chars, paras, t.styles, this.styleNum(s)));
    }
    // Word's own styles for the lines of the contents ("toc 1" to "toc 3", which Update Field uses), the
    // table of figures, the index and the table of authorities, where the document has none of its own
    const own = (kind: string, ids: string[]) => {
      if (Object.values(t.objects).some((o) => o.kind === kind)) for (const id of ids) if (!t.styles[id]) out.push(ownStyleXml(id, normal)!);
    };
    own('toc', ['TOC1', 'TOC2', 'TOC3']);
    own('tof', ['TableofFigures']);
    own('index', ['Index1', 'Index2', 'IndexHeading']);
    own('toa', ['TableofAuthorities', 'TOAHeading']);
    // footnotes and endnotes: Word's own styles for their text and their numbers
    if (Object.values(t.objects).some((o) => o.kind === 'note')) {
      const ns = noteStyle(t);
      for (const [sid, nm] of [['FootnoteText', 'footnote text'], ['EndnoteText', 'endnote text']]) {
        if (t.styles[sid]) continue;
        out.push(styleXml({ ...ns, id: sid, name: nm }, ids, wordBuiltInName, this.themeKept, normal).replace(' w:customStyle="1"', ''));
      }
      for (const [sid, nm] of [['FootnoteReference', 'footnote reference'], ['EndnoteReference', 'endnote reference']]) {
        out.push(`<w:style w:type="character" w:styleId="${sid}"><w:name w:val="${nm}"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`);
      }
    }
    // comments: Word's own styles for their text and marks, and for the links in comments kept as Word wrote them
    if (this.cmts.size) {
      const has = (id: string) => !!t.styles[id] || !!this.charStyles[id];
      if (!has('CommentText')) out.push(unNormal(`<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`));
      if (!has('CommentReference')) out.push(`<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>`);
      const linked = [...this.cmts.values()].some(({ c }) => [c, ...(c.replies ?? [])].some((n) => n.word?.paras?.some((x) => x.includes('<w:rStyle w:val="Hyperlink"/>'))));
      if (linked && !has('Hyperlink')) out.push(`<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`);
    }
    out.push(`<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`);
    // the character styles (Emphasis, Strong, Compound Number and the person's own)
    for (const cs of Object.values(this.charStyles)) out.push(charStyleXml(cs, builtIn, this.themeKept, this.charStyles));
    // formulas look like any other text in Word: the style only marks them, so they stay formulas when opened here
    out.push(`<w:style w:type="character" w:customStyle="1" w:styleId="${FORMULA_STYLE}"><w:name w:val="Chemical Formula"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="1"/></w:style>`);
    // the table styles the tables use, as Word's own (so Word draws them as they are drawn here)
    const tstyles = new Set<string>();
    for (const o of Object.values(t.objects)) if (o.kind === 'table' && o.table.style) tstyles.add(o.table.style);
    for (const id of tstyles) {
      const def = t.tableStyles?.[id] ?? builtInStyle(id);
      if (def) out.push(tableStyleXml(def));
    }
    out.push(`<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>` +
      `<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`);
    out.push(`<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`);
    // the file's styles that aren't styles here (a journal template's unused ones, character and
    // table styles nothing uses), as Word had them, unless one of the same kind and id is written above
    const written = new Set([...out.join('').matchAll(/<w:style\b[^>]*?\bw:type="([^"]+)"[^>]*?\bw:styleId="([^"]+)"/g)].map((m) => `${m[1]}:${unxml(m[2])}`));
    const paraIds = new Set([...written].filter((k) => k.startsWith('paragraph:')).map((k) => k.slice(10)));
    for (const k of t.kept?.styles ?? []) if (k.type === 'paragraph' && !written.has(`paragraph:${k.id}`)) paraIds.add(k.id);
    for (const k of t.kept?.styles ?? []) {
      if (written.has(`${k.type}:${k.id}`)) continue;
      const lk = k.type === 'character' ? /<w:link w:val="([^"]*)"\/>/.exec(k.xml) : null;
      const x = lk && !paraIds.has(unxml(lk[1])) ? { ...k, xml: k.xml.replace(lk[0], '') } : k;
      out.push(keptStyleXml(x, this.keptNumIds));
    }
    out.push('</w:styles>');
    return out.join('');
  }

  /**
   * Bullets and numbers at nine levels: each kind of list (a bullet of the library, a multilevel
   * scheme) Word's list levels of its own, and each numbered list its own Word list, so each starts at 1.
   */
  private numbering(): string {
    const normal = styleOf(this.t, undefined);
    const em = normal.size;
    const lvls = (key: string) => Array.from({ length: 9 }, (_, i) => {
      const bullet = key.startsWith('b');
      const { left, hang } = listIndent({ list: bullet ? 'bullet' : 'number', level: i }, em);
      // (a list of mixed levels: each level's own scheme)
      const sc = key.startsWith('n*') ? schemeOf(key.slice(2).split('|')[i]) : schemeOf(key.slice(1));
      const fmt = bullet ? 'bullet' : sc.levels[i].fmt;
      const text = bullet ? key.slice(1) || BULLETS[i % BULLETS.length] : sc.levels[i].text;
      // bullets that ordinary fonts may lack come from a symbol font; bullets are plain, numbers
      // take the paragraph's bold and italic (its style's, or its mark's: ParaStyle.numLook)
      const font = bullet && /[✓➢★◆]/.test(text) ? 'Segoe UI Symbol' : normal.font;
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${xml(text)}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${twips(left)}" w:hanging="${twips(hang)}"/></w:pPr><w:rPr>${fontsXml(font)}${bullet ? '<w:b w:val="0"/><w:i w:val="0"/>' : ''}</w:rPr></w:lvl>`;
    }).join('');
    // the file's own lists (CT_Numbering, 17.9.16: every abstractNum before every num), their ids moved past ours;
    // Word 2013 and later's attributes in them (w15:restartNumberingAfterBreak, w16cid:durableId) ignorable for older Words
    const kept = this.t.kept?.numbering;
    const keptAbs = new Map((kept?.abs ?? []).map((a, i) => [a.id, String(i)]));
    const A = this.keptAbsCount, K = this.keptNumCount;
    const out = [HEAD, kept ? `<w:numbering xmlns:w="${W_NS}" xmlns:mc="${MC_NS}" xmlns:w14="${W14_NS}" xmlns:w15="${W15_NS}" xmlns:w16cid="${W16CID_NS}" xmlns:w16se="${W16SE_NS}" mc:Ignorable="w14 w15 w16cid w16se">` : `<w:numbering xmlns:w="${W_NS}">`];
    for (const [key, abs] of this.abstractNums) out.push(`<w:abstractNum w:abstractNumId="${abs + A}"><w:multiLevelType w:val="${key === 'b' || key === 'n' ? 'hybridMultilevel' : 'multilevel'}"/>${lvls(key)}</w:abstractNum>`);
    for (const a of kept?.abs ?? []) out.push(a.xml.replace(/(<w:abstractNum\b[^>]*?w:abstractNumId=")[^"]*"/, `$1${keptAbs.get(a.id)}"`));
    this.nums.forEach((n, k) => {
      const over = (i: number, v: number) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${v}"/></w:lvlOverride>`;
      const restart = n.restart ? Array.from({ length: 9 }, (_, i) => over(i, n.at?.level === i ? n.at.value : 1)).join('') : n.at ? over(n.at.level, n.at.value) : '';
      out.push(`<w:num w:numId="${k + 1 + K}"><w:abstractNumId w:val="${n.kept !== undefined ? keptAbs.get(n.kept) : n.abs + A}"/>${restart}</w:num>`);
    });
    for (const n of kept?.nums ?? []) {
      const abs = keptAbs.get(n.abs), id = this.keptNumIds.get(n.id);
      if (abs && id) out.push(n.xml.replace(/(<w:num\b[^>]*?w:numId=")[^"]*"/, `$1${id}"`).replace(/(<w:abstractNumId w:val=")[^"]*"/, `$1${abs}"`));
    }
    out.push('</w:numbering>');
    return out.join('');
  }
}

// ---------------------------------------------------------------- pieces

/**
 * Numbered items of one list whose levels are written in different schemes (a Word list
 * numbered 1. at its first level and a) at its second): all given one scheme id that names
 * each level's ('*' and the levels' ids joined by |), so they are saved as one Word list, whose
 * deeper levels start again under each item and keep their own start numbers as Word's do.
 * A list runs from where its numbers start again to the next paragraph that is in no list.
 */
function oneWordList(paras: ParaStyle[], lists: ListInfo[]): ParaStyle[] {
  const out = [...paras];
  const numbered = (ps: ParaStyle | undefined) => ps?.list === 'number' && !ps.cont;
  let from = 0;
  const close = (to: number) => {
    const levels: (string | undefined)[] = [];
    for (let p = from; p < to; p++) if (numbered(paras[p])) levels[Math.max(0, Math.min(8, paras[p].level ?? 0))] ??= paras[p].scheme ?? '';
    const used = levels.filter((x) => x !== undefined);
    if (new Set(used).size < 2) return;
    const id = '*' + Array.from({ length: 9 }, (_, i) => levels[i] ?? used[0]).join('|');
    for (let p = from; p < to; p++) if (paras[p].list === 'number') out[p] = { ...paras[p], scheme: id };
  };
  for (let p = 0; p <= paras.length; p++) {
    if (p < paras.length && paras[p].list && !(numbered(paras[p]) && lists[p].start)) continue;
    close(p);
    from = p;
  }
  return out;
}

/** A table drawing's table, when the drawing is just one table. */
export function soleTable(c: Contents): TableData | null {
  if (c.atoms.length || c.bonds.length || c.captions.length || c.arrows.length || c.shapes.length !== 1) return null;
  const s = c.shapes[0];
  return s.kind === 'table' && s.table ? s.table : null;
}

/** A table's text, cell by cell (to tell whether Word changed it). */
export function tableText(t: TableData): string {
  return t.rows.map((row) => row.map((c) => rt.plainText(c.runs)).join('\t')).join('\n');
}

/** Where a list item's text starts, and how far its bullet or number hangs out, as laid out here. */
export function listIndent(ps: ParaStyle, em: number): { left: number; hang: number } {
  const level = Math.max(0, Math.min(8, ps.level ?? 0));
  const markLeft = (ps.indent ?? 0) + level * 1.6 * em;
  const hang = (ps.list === 'number' ? 1.6 : 1.1) * em;
  return { left: markLeft + hang, hang };
}

const half = (pt: number): number => Math.max(2, Math.round(pt * 2));

/**
 * A font for a run or style (17.3.2.26 rFonts), as Word's Font box sets a Latin font: its
 * ascii, hAnsi and complex script fonts. The East Asian font only for an East Asian font, so
 * Chinese, Japanese or Korean text keeps the document's own (SimSun is not made Arial).
 */
function fontsXml(font: string, th?: Theme): string {
  // the theme's font, while it is the font (Design > Fonts in Word then reaches the text)
  if (th?.f && th.fv === font) return `<w:rFonts${th.f}/>`;
  const f = xml(font);
  return `<w:rFonts w:ascii="${f}"${eastAsianFont(font) ? ` w:eastAsia="${f}"` : ''} w:hAnsi="${f}" w:cs="${f}"/>`;
}

/** Word's theme colour and font kept for a run or style (thc/thf as written, with what they gave). */
interface Theme { c?: string; cv?: string; f?: string; fv?: string }
function themeOf(json: string | undefined): Theme | undefined {
  if (!json) return undefined;
  try {
    const k = JSON.parse(json) as Record<string, string>;
    return { c: k.c ?? k.thc, cv: k.cv ?? k.thcv, f: k.f ?? k.thf, fv: k.fv ?? k.thfv };
  } catch { return undefined; }
}

/** A colour (17.3.2.6): with its theme colour while it is the colour the theme gave. */
function colorXml(color: string | undefined, th?: Theme): string {
  const v = color ? hex6(color) : 'auto';
  return `<w:color w:val="${v}"${th?.c && color && th.cv === color ? th.c : ''}/>`;
}

/** An East Asian font, by its name (Windows' and macOS's Chinese, Japanese and Korean fonts, or a name in their scripts). */
const eastAsianFont = (font: string) => /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(font) ||
  /^(MS (P)?(Mincho|Gothic)|Meiryo|Yu (Gothic|Mincho)|(N)?SimSun|SimHei|SimKai|KaiTi|FangSong|DengXian|Microsoft (YaHei|JhengHei)|(P)?MingLiU|DFKai-SB|Malgun Gothic|Batang|Gulim|Dotum|Gungsuh|Hiragino .*|PingFang .*|Songti .*|Heiti .*|STSong|STHeiti|STKaiti|Apple ?SD Gothic Neo|AppleGothic|Noto (Sans|Serif) (CJK|JP|SC|TC|KR).*|Source Han .*)$/i.test(font.trim());

/** The page's columns, as Word's section sets them. */
export function colsXml(pg: PageSetup): string {
  const n = Math.max(1, Math.min(4, Math.round(pg.cols ?? 1)));
  return n > 1 ? `<w:cols w:num="${n}" w:space="${twips(pg.colGap ?? COL_GAP)}"/>` : '<w:cols w:space="720"/>';
}

/** A figure's frame and shadow as a picture's shape properties (fill, line, effects, in that order). */
export function lookXml(look: FigureLook | undefined): string {
  if (!look) return '';
  let out = '';
  // a shadow is a box's, so the figure sits on white
  if (look.shadow) out += '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>';
  if (look.frame) out += `<a:ln w="${emu(look.frame)}"><a:solidFill><a:srgbClr val="${hex6(look.frameColor ?? '#000000')}"/></a:solidFill></a:ln>`;
  if (look.shadow) {
    const sh = SHADOWS[look.shadow];
    // down and to the right: 45° is 2,700,000 in sixty-thousandths of a degree
    out += `<a:effectLst><a:outerShdw blurRad="${emu(sh.blur)}" dist="${emu(sh.off * Math.SQRT2)}" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="${Math.round(sh.alpha * 100000)}"/></a:srgbClr></a:outerShdw></a:effectLst>`;
  }
  return out;
}

/** Word's name for a highlighter colour, when it is one of Word's (others are written as shading). */
export function highlightName(color: string): string | null {
  const c = '#' + hex6(color).toLowerCase();
  for (const [name, v] of Object.entries(WORD_HIGHLIGHTS)) if (v === c) return name;
  return null;
}

/**
 * A run's formatting where it differs from its paragraph's style (and its character style, when
 * it is in one: Word then gives it that style, so changing the style in Word changes it too).
 */
function runProps(r: TextRun, st: NamedStyle, x: { formula?: boolean; pos?: 'base' | 'sub' | 'sup'; cs?: CharStyle; vanish?: boolean; themes?: boolean }): string {
  const out: string[] = [];
  // (a run has one character style in Word: a formula's mark wins)
  const cs = x.formula ? undefined : x.cs;
  if (x.formula) out.push(`<w:rStyle w:val="${FORMULA_STYLE}"/>`);
  else if (cs) out.push(`<w:rStyle w:val="${xml(cs.id)}"/>`);
  if (cs) st = { ...st, font: cs.font ?? st.font, size: cs.size ?? st.size, bold: cs.bold ?? st.bold, italic: cs.italic ?? st.italic, color: cs.color ?? st.color };
  const font = r.font ?? st.font;
  const th = x.themes === false ? undefined : themeOf(r.wrx);
  if (font !== st.font) out.push(fontsXml(font, th));
  if (!!r.bold !== st.bold) out.push(r.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (!!r.italic !== st.italic) out.push(r.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  // capitals and strikethrough (on, or off where the character style has them)
  if (!!r.allCaps !== !!cs?.allCaps) out.push(r.allCaps ? '<w:caps/>' : '<w:caps w:val="0"/>');
  if (!!r.smallCaps !== !!cs?.smallCaps) out.push(r.smallCaps ? '<w:smallCaps/>' : '<w:smallCaps w:val="0"/>');
  if (!!r.strike !== !!cs?.strike || (r.strike && r.dstrike)) out.push(r.strike ? strikeXml(r) : '<w:strike w:val="0"/>');
  // run properties not modelled here, each in its place (docx-read.ts KEPT_RPR)
  const raw = keptRPr(r);
  out.push(raw.a ?? '');
  if (r.noProof) out.push('<w:noProof/>');
  out.push(raw.b ?? '');
  if (x.vanish) out.push('<w:vanish/>');
  out.push(raw.c ?? '');
  // raised or lowered from the line, in half-points
  if (r.raise) out.push(`<w:position w:val="${Math.round(r.raise * 2)}"/>`);
  const color = r.color ?? st.color;
  if ((color ?? '') !== (st.color ?? '')) out.push(colorXml(color, th));
  // character spacing (twentieths of a point) and kerning taken off
  if (r.spacing) out.push(`<w:spacing w:val="${Math.round(r.spacing * 20)}"/>`);
  out.push(raw.d ?? '');
  // (Word's kerning size as the file had it, while the text is still kerned, or not, as it says at its size)
  const size = r.size ?? st.size;
  // (Word's sizes go up to 1638 pt)
  if (r.kernAt !== undefined && r.kernAt > 0 && r.kernAt <= 1638 && !r.noKern === size >= r.kernAt) out.push(`<w:kern w:val="${Math.round(r.kernAt * 2)}"/>`);
  else if (r.noKern) out.push('<w:kern w:val="0"/>');
  if (size !== st.size) out.push(`<w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/>`);
  const hl = r.highlight && !(raw.shd && raw.shdFill === r.highlight) ? highlightName(r.highlight) : null;
  if (hl) out.push(`<w:highlight w:val="${hl}"/>`);
  if (!!r.underline !== !!cs?.underline || (r.underline && (r.ukind || r.ucolor))) out.push(r.underline ? underlineXml(r) : '<w:u w:val="none"/>');
  out.push(raw.e ?? '');
  // any other colour behind the text goes as shading (a patterned one as Word had it, while it
  // is still the colour behind the text)
  if (r.highlight && !hl) out.push(raw.shd && raw.shdFill === r.highlight ? raw.shd : `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(r.highlight)}"/>`);
  out.push(raw.f ?? '');
  const pos = x.pos ?? (r.sub ? 'sub' : r.sup ? 'sup' : 'base');
  if (pos !== 'base') out.push(`<w:vertAlign w:val="${pos === 'sub' ? 'subscript' : 'superscript'}"/>`);
  out.push(raw.g ?? '');
  if (r.lang) out.push(`<w:lang w:val="${xml(r.lang)}"/>`);
  out.push(raw.h ?? '');
  out.push(textEffects(r, color));
  return out.join('');
}

/** A paragraph's properties kept from Word, by their place (docx-read.ts KEPT_PPR). */
function keptPPr(ps: ParaStyle): Record<string, string> {
  if (!ps.wpx) return {};
  try { return JSON.parse(ps.wpx) as Record<string, string>; } catch { return {}; }
}

/**
 * A run's properties kept from Word, by their place (docx-read.ts KEPT_RPR): Word 97's shadow
 * only while the run still has a shadow.
 */
function keptRPr(r: TextRun): Record<string, string> {
  if (!r.wrx) return {};
  let k: Record<string, string>;
  try { k = JSON.parse(r.wrx) as Record<string, string>; } catch { return {}; }
  if (!r.shadow && k.a) k.a = k.a.replace(/<w:shadow\b[^>]*\/>/g, '');
  return k;
}

/** Word 97's shadow kept on a run: it stands for the shadow here, in place of Word 2010's. */
const legacyShadow = (r: TextRun) => !!r.shadow && /<w:shadow\b(?![^>]*w:val="(0|false)")/.test(keptRPr(r).a ?? '');

/** A run's underline: its kind (single when not given) and its own colour (17.3.2.40). */
function underlineXml(r: TextRun): string {
  const kind = r.ukind && /^[A-Za-z]+$/.test(r.ukind) ? EXCEL_U[r.ukind] ?? r.ukind : 'single';
  return `<w:u w:val="${kind}"${r.ucolor ? ` w:color="${hex6(r.ucolor)}"` : ''}/>`;
}
/** Excel's underline kinds Word has no name for (text pasted from a sheet): the plain ones. */
const EXCEL_U: Record<string, string> = { singleAccounting: 'single', doubleAccounting: 'double' };

/** A run's strikethrough, single or double (17.3.2.37, 17.3.2.9). */
const strikeXml = (r: TextRun) => (r.dstrike ? '<w:dstrike/>' : '<w:strike/>');

/**
 * The Font box's text effects as Word 2010's own (w14, last in a run's properties, in Word's
 * order): a shadow, an outline round the letters, and the letters' fill (none, or see-through).
 */
function textEffects(r: TextRun, color: string | undefined): string {
  if (!r.shadow && !r.outline && !r.noFill && !r.transparency && !r.wfx) return '';
  const ns = ` xmlns:w14="${W14_NS}"`;
  // the effects as a Word file had them: each written back as it was (the shadow, outline and
  // fill while the run's own still say what they did), else made from the run's own
  const kept = w14Parts(r.wfx ?? ''), was = w14Look(r.wfx ?? '');
  const made: Partial<Record<(typeof W14_FX)[number], string>> = {};
  if (r.shadow && !legacyShadow(r)) made.shadow = `<w14:shadow${ns} w14:blurRad="38100" w14:dist="38100" w14:dir="2700000" w14:sx="100000" w14:sy="100000" w14:kx="0" w14:ky="0" w14:algn="tl"><w14:srgbClr w14:val="000000"><w14:alpha w14:val="60000"/></w14:srgbClr></w14:shadow>`;
  if (r.outline) made.textOutline = `<w14:textOutline${ns} w14:w="${Math.round((r.outlineW ?? 0.75) * 12700)}" w14:cap="flat" w14:cmpd="sng" w14:algn="ctr"><w14:solidFill><w14:srgbClr w14:val="${hex6(r.outline)}"/></w14:solidFill><w14:prstDash w14:val="solid"/><w14:round/></w14:textOutline>`;
  // (w14's alpha is how see-through, not how solid)
  if (r.noFill) made.textFill = `<w14:textFill${ns}><w14:noFill/></w14:textFill>`;
  else if (r.transparency) made.textFill = `<w14:textFill${ns}><w14:solidFill><w14:srgbClr w14:val="${hex6(color ?? '#000000')}"><w14:alpha w14:val="${Math.round(r.transparency * 100000)}"/></w14:srgbClr></w14:solidFill></w14:textFill>`;
  const same: Partial<Record<(typeof W14_FX)[number], boolean>> = {
    shadow: !!r.shadow === !!was.shadow,
    textOutline: (r.outline ?? '').toLowerCase() === (was.outline ?? '') && r.outlineW === was.outlineW,
    textFill: !!r.noFill === !!was.noFill && (r.transparency || 0) === (was.transparency || 0),
  };
  return W14_FX.map((k) => (kept.has(k) && same[k] !== false ? kept.get(k)! : made[k] ?? '')).join('');
}

/** A picture's or drawing's turn and flips, as DrawingML's a:xfrm has them (rot in 60000ths of a degree). */
function turnAttrs(o: DocObject): string {
  if (o.kind !== 'picture' && o.kind !== 'drawing') return '';
  return `${o.rot ? ` rot="${Math.round(o.rot * 60000)}"` : ''}${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}`;
}

/**
 * Numbers in our part to nine significant figures (a structure's coordinates are worked out to
 * sixteen, 39.42107070546791): a millionth of a point and finer is never seen, and the part is
 * a good deal smaller.
 */
function shortNumbers(_key: string, v: unknown): unknown {
  return typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v) ? Number(v.toPrecision(9)) : v;
}

/** A table cell's run: its font and size always given (tables are set in the drawing's font); `para` its paragraph's runs. */
function tableRun(r: TextRun, font: string, size: number, para?: readonly TextRun[]): string {
  const parts: string[] = [fontsXml(r.font ?? font)];
  if (r.bold) parts.push('<w:b/><w:bCs/>');
  if (r.italic) parts.push('<w:i/><w:iCs/>');
  if (r.strike) parts.push(strikeXml(r));
  if (r.color) parts.push(`<w:color w:val="${hex6(r.color)}"/>`);
  const s = r.size ?? size;
  parts.push(`<w:sz w:val="${half(s)}"/><w:szCs w:val="${half(s)}"/>`);
  if (r.underline) parts.push(underlineXml(r));
  if (r.formula && !r.sub && !r.sup) {
    return rt.formulaPartsIn(para, r).map((p) => run(`<w:rStyle w:val="${FORMULA_STYLE}"/>${parts.join('')}${p.pos !== 'base' ? `<w:vertAlign w:val="${p.pos === 'sub' ? 'subscript' : 'superscript'}"/>` : ''}`, p.text)).join('');
  }
  if (r.sub || r.sup) parts.push(`<w:vertAlign w:val="${r.sub ? 'subscript' : 'superscript'}"/>`);
  return run(parts.join(''), r.text);
}

/**
 * A field (caption number, reference or page number) in Word's long form, its code in the same
 * font as its result: when Word updates it (F9, or printing) the result keeps that formatting
 * (CHARFORMAT), so a bold caption number stays bold and a reference doesn't take on the caption's bold.
 */
function field(rPr: string, instr: string, result: string, data?: string): string {
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  return fieldStart(rPr, instr, data) + `${run(rPr, result)}<w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
}

/**
 * A field's start: its instruction (escaped already) up to its result. With `data` (EndNote's
 * citation, in base64) the data rides on the field, and on a field inside the instruction as
 * EndNote writes it (EN.CITE.DATA).
 */
function fieldStart(rPr: string, instr: string, data?: string): string {
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  const begin = data ? `<w:fldChar w:fldCharType="begin"><w:fldData xml:space="preserve">${data}</w:fldData></w:fldChar>` : '<w:fldChar w:fldCharType="begin"/>';
  const inner = data ? `<w:r>${pr}${begin}</w:r><w:r>${pr}<w:instrText xml:space="preserve"> ADDIN EN.CITE.DATA </w:instrText></w:r><w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>` : '';
  // a long instruction (a reference manager's) in pieces, as Word splits one (never inside an escape)
  const pieces = instr.match(/(?:&[a-z#0-9]+;|[^&]){1,255}/gi) ?? [instr];
  const text = pieces.map((p) => `<w:r>${pr}<w:instrText xml:space="preserve">${p}</w:instrText></w:r>`).join('');
  return `<w:r>${pr}${begin}</w:r>${text}${inner}<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r>`;
}

/** A gradient fill (a:gradFill) made only of DrawingML's gradient and colour elements, well formed, with no text: one to write back as it is. */
const GRAD_TAG = /^<(\/?)a:(gradFill|gsLst|gs|srgbClr|schemeClr|prstClr|sysClr|lin|path|fillToRect|tileRect|lumMod|lumOff|alpha|alphaMod|alphaOff|tint|shade|satMod|satOff|hueMod|hueOff|gamma|invGamma)((?:\s+[A-Za-z]+="[^"<>&]*")*)\s*(\/?)>$/;
export function gradientOk(xml: unknown): xml is string {
  if (typeof xml !== 'string' || !/^<a:gradFill[\s>]/.test(xml) || !xml.endsWith('</a:gradFill>') || xml.length > 20000) return false;
  const open: string[] = [];
  let ended = false;
  for (const p of xml.split(/(<[^<>]*>)/)) {
    if (p === '') continue;
    if (!p.startsWith('<')) { if (p.trim()) return false; continue; }
    const m = GRAD_TAG.exec(p);
    // (one gradFill, with none inside it)
    if (!m || ended || (m[2] === 'gradFill' && !m[1] && open.length)) return false;
    const [, close, name, attrs, self] = m;
    if (close && open.length === 1) ended = true;
    if (close) { if (attrs.trim() || self || open.pop() !== name) return false; continue; }
    // (each attribute once)
    const names = [...attrs.matchAll(/([A-Za-z]+)=/g)].map((x) => x[1]);
    if (new Set(names).size !== names.length) return false;
    if (!self) open.push(name);
  }
  return open.length === 0;
}

/** The colour a gradient is shown in here: its first stop's, unless that stop shows through (or isn't a plain colour). */
export function gradFirst(xml: string): string | undefined {
  const gs = /<a:gs\b[^>]*>([\s\S]*?)<\/a:gs>/.exec(xml)?.[1] ?? '';
  const c = /^\s*<a:srgbClr val="([0-9A-Fa-f]{6})"\s*(\/>|>([\s\S]*?)<\/a:srgbClr>)/.exec(gs);
  if (!c || /<a:alpha(Mod|Off)?\b/.test(c[3] ?? '')) return undefined;
  return `#${c[1].toLowerCase()}`;
}

/** A paragraph's borders (w:pBdr, Word's spacing from the text) and shading (w:shd). */
/**
 * A paragraph's kept settings of the group w:bidi is in (kinsoku to snapToGrid: `kept`, as the file
 * had them) with its direction as it is now (`rtl`): left as they are where they already say so, or
 * where they say nothing and the paragraph's style (`styleRtl`) does; else w:bidi put in, in its
 * place before adjustRightInd and snapToGrid, or turned off.
 */
export function bidiXml(kept: string, rtl: boolean, styleRtl: boolean): string {
  const m = /<w:bidi(?:\s+w:val="([^"]*)")?\s*\/>/.exec(kept);
  const says = m ? !/^(0|false|off)$/.test(m[1] ?? '') : styleRtl;
  if (says === rtl) return kept;
  const rest = kept.replace(/<w:bidi(?:\s+w:val="[^"]*")?\s*\/>/, '');
  const el = rtl === styleRtl ? '' : rtl ? '<w:bidi/>' : '<w:bidi w:val="0"/>';
  const at = rest.search(/<w:(adjustRightInd|snapToGrid)\b/);
  return at < 0 ? rest + el : rest.slice(0, at) + el + rest.slice(at);
}

export function paraBorderXml(ps: ParaStyle, st?: Pick<NamedStyle, 'border' | 'shade'>): string {
  let out = '';
  const b = cleanBorders(ps.border);
  // (the paragraph's style's: nothing where the paragraph has the same, a side or shading taken away where it hasn't)
  const sb = cleanBorders(st?.border);
  const sameLines = !!st && JSON.stringify(b ?? null) === JSON.stringify(sb ?? null) && !keptPPr(ps).bsp;
  const sameShade = !!st && (ps.shade ?? '').toLowerCase() === (st.shade ?? '').toLowerCase();
  const off = (name: 'top' | 'left' | 'bottom' | 'right' | 'between') => (sb?.[name] && !b?.[name] ? `<w:${name} w:val="nil"/>` : '');
  let keptSpace: Record<string, string> = {};
  try { keptSpace = JSON.parse(keptPPr(ps).bsp ?? '{}') as Record<string, string>; } catch { keptSpace = {}; }
  if (sameLines) { /* the style's */ } else if (b) {
    const side = (name: 'top' | 'left' | 'bottom' | 'right' | 'between') => {
      const l = b[name];
      if (!l) return off(name);
      // (each side's own distance as Word had it, else the one used here)
      const space = keptSpace[name] ?? (name === 'left' || name === 'right' ? BORDER_SPACE.x : BORDER_SPACE.y);
      return borderXml(name, l).replace('w:space="0"', `w:space="${space}"`);
    };
    out += `<w:pBdr>${side('top')}${side('left')}${side('bottom')}${side('right')}${side('between')}</w:pBdr>`;
  } else if (sb) out += `<w:pBdr>${off('top')}${off('left')}${off('bottom')}${off('right')}${off('between')}</w:pBdr>`;
  if (sameShade) { /* the style's */ } else if (ps.shade) out += `<w:shd w:val="clear" w:color="auto" w:fill="${hex6(ps.shade)}"/>`;
  else if (st?.shade) out += '<w:shd w:val="clear" w:color="auto" w:fill="auto"/>';
  return out;
}

/** A field with no result (an index entry, a marked citation): Word keeps it as hidden text. */
function markField(instr: string, rPr = ''): string {
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  return `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${pr}<w:instrText xml:space="preserve">${xml(instr)}</w:instrText></w:r><w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`;
}

/**
 * Restrict Editing as Word's w:documentProtection: what can be changed, enforced, and the
 * password's hash in the attributes Word writes (its hash algorithm by number: 14 is SHA-512).
 */
function protectionXml(p: Protection | undefined): string {
  if (!p) return '';
  const pw = p.hash && p.salt
    ? ` w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="${ALG_SIDS[p.alg ?? 'SHA-512'] ?? 14}" w:cryptSpinCount="${p.spin ?? 100000}" w:hash="${xml(p.hash)}" w:salt="${xml(p.salt)}"`
    : '';
  return `<w:documentProtection w:edit="${p.edit}" w:enforcement="1"${pw}/>`;
}

/** A style based on Normal that hasn't Normal's lines or shading (`normal`): with nil sides and no fill, as Word writes it. */
export function unNormalXml(x: string, normal: Pick<NamedStyle, 'border' | 'shade'>): string {
  const reset = paraBorderXml({}, normal);
  return !reset ? x
    : x.includes('<w:pPr>') ? x.replace(/<w:pPr>(<w:keepNext\/>)?/, (m) => m + reset)
    : x.replace(/(<w:rPr>|<\/w:style>)/, (m) => `<w:pPr>${reset}</w:pPr>${m}`);
}

/** ownStyleBare as written: saying where it hasn't Normal's (`normal`) lines or shading. */
export function ownStyleXml(id: string, normal: Pick<NamedStyle, 'size' | 'border' | 'shade'>): string | null {
  const x = ownStyleBare(id, normal.size);
  return x === null ? null : unNormalXml(x, normal);
}

/**
 * Word's own styles for the lines of the contents ("toc 1" to "toc 3"), the table of figures, the
 * index ("index 1", "index 2", "index heading") and the table of authorities ("table of authorities",
 * "toa heading") as this program writes them for a document with none of its own (`normalSize`: the
 * Normal style's size, in points); null for any other id. The reader leaves a style exactly so out of
 * the document's styles, so a file saved again writes it once, the same.
 */
function ownStyleBare(id: string, normalSize: number): string | null {
  const toc = /^TOC([1-3])$/.exec(id);
  if (toc) { const n = Number(toc[1]); return `<w:style w:type="paragraph" w:styleId="TOC${n}"><w:name w:val="toc ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/><w:ind w:left="${twips((n - 1) * TOC_INDENT)}"/><w:jc w:val="left"/></w:pPr></w:style>`; }
  const index = /^Index([12])$/.exec(id);
  if (index) { const n = Number(index[1]); return `<w:style w:type="paragraph" w:styleId="Index${n}"><w:name w:val="index ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:autoRedefine/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/><w:ind w:left="${twips(n * INDEX_INDENT)}" w:hanging="${twips(INDEX_INDENT)}"/><w:jc w:val="left"/></w:pPr></w:style>`; }
  switch (id) {
    case 'TableofFigures': return `<w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/><w:jc w:val="left"/></w:pPr></w:style>`;
    case 'IndexHeading': return `<w:style w:type="paragraph" w:styleId="IndexHeading"><w:name w:val="index heading"/><w:basedOn w:val="Normal"/><w:next w:val="Index1"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:keepNext/><w:spacing w:before="${twips(normalSize)}" w:after="${twips(normalSize / 4)}"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>`;
    case 'TableofAuthorities': return `<w:style w:type="paragraph" w:styleId="TableofAuthorities"><w:name w:val="table of authorities"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0"/><w:ind w:left="${twips(INDEX_INDENT)}" w:hanging="${twips(INDEX_INDENT)}"/><w:jc w:val="left"/></w:pPr></w:style>`;
    case 'TOAHeading': return `<w:style w:type="paragraph" w:styleId="TOAHeading"><w:name w:val="toa heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:keepNext/><w:spacing w:before="${twips(normalSize)}" w:after="${twips(normalSize / 4)}"/><w:jc w:val="left"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style>`;
    default: return null;
  }
}

/** A form field's name as written (Word's: letters, digits and _, up to 20), before it is told apart from the others'. */
function formName(o: Extract<DocObject, { kind: 'form' }>): string {
  return (o.name ?? '').replace(/[^\w]/g, '').slice(0, 20);
}

/**
 * A form field as Word's legacy form field: its settings (w:ffData) on the field's start, its
 * name, and a text field's entry or a drop-down's choice as the result.
 */
function formField(o: Extract<DocObject, { kind: 'form' }>, rPr: string, names: Map<string, number>, mark: number): string {
  const base = o.type === 'check' ? 'Check' : o.type === 'drop' ? 'Dropdown' : 'Text';
  let name = formName(o);
  if (!name || names.has(name)) { let n = names.size + 1; while (names.has(`${base}${n}`)) n++; name = `${base}${n}`; }
  names.set(name, 1);
  const help = o.help ? `<w:helpText w:type="text" w:val="${xml(o.help.slice(0, 255))}"/><w:statusText w:type="text" w:val="${xml(o.help.slice(0, 138))}"/>` : '';
  let kindXml: string, instr: string, result = '';
  if (o.type === 'check') {
    kindXml = `<w:checkBox><w:sizeAuto/><w:default w:val="0"/>${o.checked ? '<w:checked/>' : ''}</w:checkBox>`;
    instr = ' FORMCHECKBOX ';
  } else if (o.type === 'drop') {
    const items = (o.items ?? []).slice(0, 25);
    const at = Math.max(0, items.indexOf(o.value ?? ''));
    kindXml = `<w:ddList>${at ? `<w:result w:val="${at}"/>` : ''}${items.map((x) => `<w:listEntry w:val="${xml(x)}"/>`).join('')}</w:ddList>`;
    instr = ' FORMDROPDOWN ';
  } else {
    kindXml = '<w:textInput/>';
    instr = ' FORMTEXT ';
    result = o.value || EMPTY_FORM;
  }
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  const ff = `<w:ffData><w:name w:val="${xml(name)}"/><w:enabled/><w:calcOnExit w:val="0"/>${help}${kindXml}</w:ffData>`;
  return `<w:bookmarkStart w:id="${mark}" w:name="${xml(name)}"/><w:r>${pr}<w:fldChar w:fldCharType="begin">${ff}</w:fldChar></w:r><w:r>${pr}<w:instrText xml:space="preserve">${instr}</w:instrText></w:r>` +
    `${result ? `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r>${run(rPr, result)}` : ''}<w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="${mark}"/>`;
}

/** A run of text (tabs as Word's tabs, optional hyphens as its soft hyphens). */
/**
 * A comment's paragraphs to write: the number of one of the paragraphs Word wrote (kept as it
 * was), or a line of text (from `at` in the comment's text) to write with its words' looks.
 * Unchanged, all of Word's; changed here, Word's for each paragraph whose text and looks are still
 * there in its place, in order, and the rest written afresh.
 */
export function commentPieces(c: CommentNote): (number | { line: string; at: number })[] {
  const w = c.word;
  const t = c.text;
  const mine = noteRuns(c), theirs = w?.runs ?? null;
  // (looks are compared only where the note's are known: set on its card here, or read with it)
  const known = c.runs !== undefined && (!c.runs.length || mine !== null);
  const looks = (runs: NoteRun[] | null, text: string, from: number, to: number) => JSON.stringify(cleanNoteRuns(sliceNoteRuns(runs ?? [{ text }], from, to)));
  const sameLooks = (a: number, b: number, wa: number, wb: number) => !known || looks(mine, t, a, b) === looks(theirs, wt, wa, wb);
  const wt = w?.text ?? '';
  if (w?.paras?.length && wt === t && sameLooks(0, t.length, 0, wt.length)) return w.paras.map((_, i) => i);
  const plain = () => { let at = 0; return t.split('\n').map((line) => { const p = { line, at }; at += line.length + 1; return p; }); };
  if (!w?.paras?.length || w.texts?.length !== w.paras.length) return plain();
  const texts: string[] = w.texts;
  // where each of Word's paragraphs starts in the text Word's comment had
  const starts: number[] = [];
  texts.reduce((at, x) => { starts.push(at); return at + x.length + 1; }, 0);
  const out: (number | { line: string; at: number })[] = [];
  let at = 0, next = 0;
  for (;;) {
    // a paragraph of Word's (from those after the last one used) whose whole text comes next, with the same looks
    let k = -1;
    for (let j = next; j < texts.length && k < 0; j++) {
      const end = at + texts[j].length;
      if (t.startsWith(texts[j], at) && (end === t.length || t[end] === '\n') && sameLooks(at, end, starts[j], starts[j] + texts[j].length)) k = j;
    }
    let end: number;
    if (k >= 0) { out.push(k); next = k + 1; end = at + texts[k].length; }
    else { const nl = t.indexOf('\n', at); end = nl < 0 ? t.length : nl; out.push({ line: t.slice(at, end), at }); }
    if (end >= t.length) break;
    at = end + 1;
  }
  return out;
}

/** A line of a comment written afresh: its pieces, each with its look (bold, italic, strikethrough, underline, position). */
function commentLine(c: CommentNote, line: string, at: number): string {
  const runs = noteRuns(c);
  if (!runs) return run('', line);
  return sliceNoteRuns(runs, at, at + line.length).map((r) =>
    run(`${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}${r.strike ? '<w:strike/>' : ''}${r.underline ? '<w:u w:val="single"/>' : ''}${r.sub ? '<w:vertAlign w:val="subscript"/>' : r.sup ? '<w:vertAlign w:val="superscript"/>' : ''}`, r.text)).join('');
}

/** The first paragraph of a comment with its comment mark (one of Word's later paragraphs, come first, has none). */
function withAnnotationRef(p: string): string {
  if (p.includes('<w:annotationRef/>')) return p;
  const mark = '<w:r><w:annotationRef/></w:r>';
  const at = p.indexOf('</w:pPr>');
  if (at >= 0) return p.slice(0, at + 8) + mark + p.slice(at + 8);
  const open = /^<w:p\b[^>]*?(\/?)>/.exec(p);
  if (!open) return p;
  return open[1] ? `${open[0].slice(0, -2)}>${mark}</w:p>` : open[0] + mark + p.slice(open[0].length);
}

/** A paragraph of a comment without its comment mark (w:annotationRef, which goes in the first only). */
const noAnnotationRef = (p: string) => p.replace(/<w:r\b(?:(?!<\/w:r>)[\s\S])*?<w:annotationRef\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/, '');

/** Characters Word writes as elements of their own in a run: a tab, a soft hyphen and a non-breaking hyphen (§17.3.3.18, :29, :23). */
const RUN_MARKS = new Map([['\t', '<w:tab/>'], ['\u00ad', '<w:softHyphen/>'], ['\u2011', '<w:noBreakHyphen/>']]);

function run(rPr: string, text: string): string {
  if (!text) return '';
  const body = text.split(/([\t\u00ad\u2011])/).map((s) => RUN_MARKS.get(s) ?? (s ? `<w:t xml:space="preserve">${xml(s)}</w:t>` : '')).join('');
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${body}</w:r>`;
}

const V_NS = 'urn:schemas-microsoft-com:vml';
/** Word 2015's symbol extensions namespace (w16se), which list definitions can use. */
const W16SE_NS = 'http://schemas.microsoft.com/office/word/2015/wordml/symex';
/** VML's picture frame shape type (number 75), which embedded objects' pictures use. */
const T75 = '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas>' +
  ['if lineDrawn pixelLineWidth 0', 'sum @0 1 0', 'sum 0 0 @1', 'prod @2 1 2', 'prod @3 21600 pixelWidth', 'prod @3 21600 pixelHeight', 'sum @0 0 1', 'prod @6 1 2', 'prod @7 21600 pixelWidth', 'sum @8 21600 0', 'prod @7 21600 pixelHeight', 'sum @10 21600 0']
    .map((f) => `<v:f eqn="${f}"/>`).join('') +
  '</v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
const O_NS = 'urn:schemas-microsoft-com:office:office';
const W10_NS = 'urn:schemas-microsoft-com:office:word';
/** The prefix Word's own watermarks' shapes are named with (Design > Watermark finds them by it). */
export const WATERMARK_SHAPE = 'PowerPlusWaterMarkObject';
const WM_MEASURE = documentMeasure((s, size, _f, style) => arialWidth(s, size, /bold/.test(style)));

/**
 * A text watermark as Word makes one: a WordArt shape (VML's text path) in the header, in the
 * middle of the margins, behind the text, turned 315° when diagonal, filled half see-through.
 */
export function watermarkXml(w: Watermark, pg: PageSetup, n: number): string {
  const at = watermarkPlace(w, { x: 0, top: 0, w: pg.w, h: pg.h, setup: pg }, WM_MEASURE);
  const r = (v: number) => Math.round(v * 100) / 100;
  const style = `position:absolute;margin-left:0;margin-top:0;width:${r(at.width)}pt;height:${r(at.size)}pt;${at.angle ? 'rotation:315;' : ''}z-index:-251654144;` +
    'mso-wrap-edited:f;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin';
  const shapetype = n === 0 ? '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas>' +
    ['sum #0 0 10800', 'prod #0 2 1', 'sum 21600 0 @1', 'sum 0 0 @2', 'sum 21600 0 @3', 'if @0 @3 0', 'if @0 21600 @1', 'if @0 0 @2', 'if @0 @4 21600', 'mid @5 @6', 'mid @8 @5', 'mid @7 @8', 'mid @6 @7', 'sum @6 0 @5'].map((e) => `<v:f eqn="${e}"/>`).join('') +
    '</v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>' : '';
  return `<w:r><w:rPr><w:noProof/></w:rPr><w:pict>${shapetype}<v:shape id="${WATERMARK_SHAPE}${100000001 + n}" o:spid="_x0000_s${2049 + n}" type="#_x0000_t136" style="${style}" o:allowincell="f" fillcolor="#${hex6(w.color)}" stroked="f">` +
    `${w.faded ? '<v:fill opacity=".5"/>' : ''}<v:textpath style="font-family:&quot;${xml(w.font)}&quot;;font-size:1pt;font-weight:bold" string="${xml(w.text)}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r>`;
}

/** Word's page border (a box, the same on every side), in a section's properties. */
function pageBordersXml(b: PageBorder): string {
  const val = b.style === 'thick' ? 'thickThinSmallGap' : b.style;
  // widths in eighths of a point (2 to 96); the distance in points (0 to 31)
  const sz = Math.max(2, Math.min(96, Math.round(b.width * 8)));
  const side = (s: string) => `<w:${s} w:val="${val}" w:sz="${sz}" w:space="${Math.max(0, Math.min(31, Math.round(b.space)))}" w:color="${hex6(b.color)}"/>`;
  return `<w:pgBorders w:offsetFrom="${b.from}">${['top', 'left', 'bottom', 'right'].map(side).join('')}</w:pgBorders>`;
}

/** Text of an XML attribute value back as text. */
const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * A style kept from the file read, as Word had it; its list (w:numPr) only while that list is
 * written as the file had it (`numIds`: the file's list ids to those written), else left out, so
 * it never names a list that isn't there.
 */
function keptStyleXml(k: { xml: string }, numIds: ReadonlyMap<string, string>): string {
  return k.xml.replace(/<w:numPr\b[^>]*?(?:\/>|>[\s\S]*?<\/w:numPr>)/g, (m) => {
    const id = /<w:numId w:val="([^"]+)"/.exec(m)?.[1];
    // (Word's "no numbering", which a style says over the one it is based on, and a level alone, on
    // the list of the one it is based on: as they are)
    if (id === '0' || id === undefined) return m;
    const to = numIds.get(id);
    return to ? m.replace(/(<w:numId w:val=")[^"]+"/, `$1${to}"`) : '';
  // (and paragraph settings left empty by that written as the file's own empty ones read back: the
  // same on a second save; kept, as a tracked change's old settings need one)
  }).replace(/<w:pPr><\/w:pPr>/g, '<w:pPr/>');
}

/** A character style: only what it sets. */
function charStyleXml(s: CharStyle, builtIn: (name: string) => string | null = wordBuiltInName, themes = true, ours: Record<string, CharStyle> = {}): string {
  // based on another style here (not on itself through others): what the ones it is based on set comes
  // from them where it leaves it unset, so it says "off" where it has a property off that they have on,
  // and isn't based on them where it leaves unset a font, size, bold, italic or colour they set
  const has = (id: string | undefined): id is string => !!id && Object.hasOwn(ours, id);
  let chained = has(s.basedOn) && s.basedOn !== s.id;
  const up: Partial<Record<'font' | 'size' | 'bold' | 'italic' | 'color' | 'allCaps' | 'smallCaps' | 'strike' | 'underline', boolean>> = {};
  for (let b = s.basedOn, seen = new Set([s.id]); chained && has(b); b = ours[b].basedOn) {
    if (seen.has(b)) { chained = false; break; }
    seen.add(b);
    const a = ours[b];
    for (const k of ['font', 'size', 'bold', 'italic', 'color'] as const) if (a[k] !== undefined) up[k] = true;
    for (const k of ['allCaps', 'smallCaps', 'strike', 'underline'] as const) if (a[k]) up[k] = true;
  }
  if (chained && (['font', 'size', 'bold', 'italic', 'color'] as const).some((k) => up[k] && s[k] === undefined)) chained = false;
  const off = (k: 'allCaps' | 'smallCaps' | 'strike' | 'underline') => chained && !!up[k];
  const own = WORD_CHAR[s.id];
  // (Word's own by its name too: Book Title, Subtle Reference...)
  const word = own ? null : builtIn(s.name);
  const rPr: string[] = [];
  const th = themes ? themeOf(s.wth) : undefined;
  if (s.font) rPr.push(fontsXml(s.font, th));
  if (s.bold !== undefined) rPr.push(s.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (s.italic !== undefined) rPr.push(s.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
  if (s.allCaps) rPr.push('<w:caps/>'); else if (off('allCaps')) rPr.push('<w:caps w:val="0"/>');
  if (s.smallCaps) rPr.push('<w:smallCaps/>'); else if (off('smallCaps')) rPr.push('<w:smallCaps w:val="0"/>');
  if (s.strike) rPr.push('<w:strike/>'); else if (off('strike')) rPr.push('<w:strike w:val="0"/>');
  if (s.color) rPr.push(colorXml(s.color, th));
  if (s.size) rPr.push(`<w:sz w:val="${half(s.size)}"/><w:szCs w:val="${half(s.size)}"/>`);
  // (its underline's kind, as a run's)
  if (s.underline) rPr.push(underlineXml({ text: '', underline: true, ukind: s.ukind })); else if (off('underline')) rPr.push('<w:u w:val="none"/>');
  return `<w:style w:type="character"${own || word ? '' : ' w:customStyle="1"'} w:styleId="${xml(s.id)}"><w:name w:val="${xml(own?.[0] ?? word ?? s.name)}"/><w:basedOn w:val="${chained ? xml(s.basedOn!) : 'DefaultParagraphFont'}"/>` +
    `<w:uiPriority w:val="${own?.[1] ?? 29}"/>${WORD_LINK_CHAR[s.id] ?? '<w:qFormat/>'}${rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''}</w:style>`;
}

/** A named style, with all its settings written out. */
function styleXml(s: NamedStyle, ids: string[], builtIn: (name: string) => string | null = wordBuiltInName, themes = true, normal?: NamedStyle, chars?: ReadonlySet<string>, paras?: ReadonlySet<string>, styles?: Readonly<Record<string, NamedStyle>>, numPr = ''): string {
  const id = s.id;
  // a style with one of Word's built-in names (header, No Spacing, toc 1...) is Word's own: not marked custom
  const word = WORD_NAMES[id] ?? builtIn(s.name);
  const name = word ?? s.name;
  // (based on a style other than Normal: what it leaves unset would come from that one, so it says)
  const chained = !!s.basedOn && s.basedOn !== id && s.basedOn !== 'Normal' && !!paras?.has(s.basedOn);
  const head = id === 'Normal'
    ? `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>${s.link && chars?.has(s.link) ? `<w:link w:val="${xml(s.link)}"/>` : ''}<w:qFormat/>`
    : `<w:style w:type="paragraph"${word ? '' : ' w:customStyle="1"'} w:styleId="${xml(id)}"><w:name w:val="${xml(name)}"/><w:basedOn w:val="${xml(chained ? s.basedOn! : 'Normal')}"/>` +
      `${s.next && ids.includes(s.next) ? `<w:next w:val="${xml(s.next)}"/>` : ''}${s.link && chars?.has(s.link) ? `<w:link w:val="${xml(s.link)}"/>` : ''}<w:uiPriority w:val="${PRIORITY[id] ?? 29}"/><w:qFormat/>`;
  const pPr: string[] = [];
  pPr.push(s.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
  // (widow and orphan control is on for every style, from the document's defaults, unless a style turns it off)
  if (s.keepLines) pPr.push('<w:keepLines/>'); else if (chained) pPr.push('<w:keepLines w:val="0"/>');
  if (s.noWidow) pPr.push('<w:widowControl w:val="0"/>'); else if (chained) pPr.push('<w:widowControl/>');
  // (its numbering, in its place after widow control)
  if (numPr) pPr.push(numPr);
  // (its lines and shading, in their place before the spacing; a style says where it hasn't those of the
  // style it is based on: Normal, or the one in Word it stays based on)
  pPr.push(paraBorderXml({ border: s.border, shade: s.shade }, id === 'Normal' ? undefined : chained ? styles?.[s.basedOn!] : normal));
  // (right to left: its own, or where the style it is based on is and it isn't)
  const baseRtl = id === 'Normal' ? false : chained ? !!styles?.[s.basedOn!]?.rtl : !!normal?.rtl;
  if (!!s.rtl !== baseRtl) pPr.push(s.rtl ? '<w:bidi/>' : '<w:bidi w:val="0"/>');
  pPr.push(`<w:spacing w:before="${twips(s.spaceBefore)}" w:after="${twips(s.spaceAfter)}" w:line="${Math.round(240 * s.line)}" w:lineRule="auto"/>`);
  pPr.push(`<w:ind w:left="${twips(s.indent)}" ${s.firstLine < 0 ? `w:hanging="${twips(-s.firstLine)}"` : `w:firstLine="${twips(s.firstLine)}"`}/>`);
  pPr.push(`<w:jc w:val="${JC[s.align]}"/>`);
  if (s.outline) pPr.push(`<w:outlineLvl w:val="${s.outline - 1}"/>`); else if (chained) pPr.push('<w:outlineLvl w:val="9"/>');
  const th = themes ? themeOf(s.wth) : undefined;
  const rPr = `${fontsXml(s.font, th)}${s.bold ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>'}${s.italic ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>'}` +
    `${colorXml(s.color, th)}<w:sz w:val="${half(s.size)}"/><w:szCs w:val="${half(s.size)}"/>`;
  return `${head}<w:pPr>${pPr.join('')}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
}

/**
 * A drawing that is just a diagram (and nothing else) as Word shapes for a group: each shape with
 * its text, and the connectors, in the drawing's own points. Null for any other drawing.
 */
export function diagramShapesXml(c: Contents, style: DocStyle): string | null {
  if (c.atoms.length || c.captions.length) return null;
  const frame = c.shapes.find((s) => s.diagram && s.frame);
  if (!frame || c.shapes.filter((s) => s.diagram).length !== 1) return null;
  const members = new Set(frame.frame!.shapes), links = new Set(frame.frame!.arrows);
  if (c.shapes.some((s) => s !== frame && (!members.has(s.id) || s.kind !== 'geo')) || c.arrows.some((a) => !links.has(a.id))) return null;
  const font = style.captionFont || 'Arial';
  const out: string[] = [];
  let k = 1;
  for (const s of shapeOrder(c.shapes.filter((x) => x !== frame))) {
    const g = geoSpPr(s, style.lineWidth);
    const def = geoDef(s.geo);
    const ins = def.prst ? 3.6 : 0;
    const anchor = s.textValign === 'top' ? 't' : s.textValign === 'bottom' ? 'b' : 'ctr';
    const body = s.text?.runs.some((r) => r.text) ? `<wps:txbx><w:txbxContent>${shapeParagraphs(s.text.runs, s.text.paras, s.textAlign ?? 'center', font, style.captionSize)}</w:txbxContent></wps:txbx>` : '';
    out.push(`<wps:wsp><wps:cNvPr id="${k++}" name="${xml(s.name ?? def.name)}"/><wps:cNvSpPr/><wps:spPr>${xfrm(g.box)}${g.geom}${g.fill}${g.ln}${g.shadow}</wps:spPr>${body}` +
      `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${emu(ins)}" tIns="${emu(ins)}" rIns="${emu(ins)}" bIns="${emu(ins)}" anchor="${anchor}" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>`);
  }
  for (const r of c.arrows) {
    const g = connectorSpPr(r, style.lineWidth);
    out.push(`<wps:wsp><wps:cNvPr id="${k++}" name="Connector ${k - 1}"/>${g.curved ? '<wps:cNvSpPr/>' : '<wps:cNvCnPr/>'}<wps:spPr>${g.frame}${g.geom}${g.ln}</wps:spPr><wps:bodyPr/></wps:wsp>`);
  }
  return out.join('');
}

/** A shape's text as Word paragraphs (bullets written out, as Word's lists need numbering of their own). */
function shapeParagraphs(runs: TextRun[], paras: ParaStyle[] | undefined, align: Justify, font: string, size: number): string {
  const byPara = splitParagraphs(runs);
  const ps = fitParas(paras, byPara.length);
  return byPara.map((rs, i) => {
    const p = ps[i] ?? {};
    const jc = JC[p.align ?? align];
    const lvl = p.level ?? 0;
    const ind = p.list ? `<w:ind w:left="${twips(12 + 12 * lvl)}" w:hanging="${twips(9)}"/>` : '';
    const bullet = p.list ? tableRun({ text: '• ', size: rs[0]?.size, color: rs[0]?.color }, font, size) : '';
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${ind}<w:jc w:val="${jc}"/></w:pPr>${bullet}${rs.filter((r) => r.text).map((r) => tableRun(r, font, size, rs)).join('')}</w:p>`;
  }).join('') || '<w:p/>';
}

/** Word's hyphenation settings (settings.xml), in its order. */
export function hyphenXml(h: DocText['hyphen']): string {
  if (!h) return '';
  let out = h.auto ? '<w:autoHyphenation/>' : '';
  if (h.limit) out += `<w:consecutiveHyphenLimit w:val="${Math.round(h.limit)}"/>`;
  if (h.zone !== undefined) out += `<w:hyphenationZone w:val="${twips(h.zone)}"/>`;
  if (h.caps === false) out += '<w:doNotHyphenateCaps/>';
  return out;
}

/**
 * Chem4Word's CML parts to write afresh, by their place among the kept custom XML parts: those
 * whose structure was changed here (its drawing no longer matches the fingerprint taken when the
 * file was read). Unchanged structures keep their CML exactly as Chem4Word wrote it.
 */
function changedCml(t: DocText): Map<number, string> {
  const out = new Map<number, string>();
  const parts = t.kept?.xml ?? [];
  if (!parts.length) return out;
  const index = new Map<string, number>();
  parts.forEach((x, i) => { const g = cmlGuid(x.xml); if (g) index.set(g, i); });
  for (const o of Object.values(t.objects)) {
    if (o?.kind !== 'drawing' || !o.c4w) continue;
    const i = index.get(o.c4w.guid);
    if (i === undefined || out.has(i) || contentsSig(o.contents) === o.c4w.sig) continue;
    out.set(i, writeCml(o.contents, o.c4w.guid, parts[i].xml));
  }
  return out;
}

/** A new id for a Word document (settings' w14:docId): eight hex digits, below 80000000 as Word's are. */
function newDocId(): string {
  return (1 + Math.floor(Math.random() * 0x7ffffffe)).toString(16).toUpperCase().padStart(8, '0');
}
/** A new GUID for a Word document (settings' w15:docId), in braces as Word writes it. */
function newDocGuid(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  return `{${hex(8)}-${hex(4)}-4${hex(3)}-${'89AB'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}}`;
}

/**
 * A Word file's own font table, kept to save back: its entries (with Word's hints for substitutes
 * and the fonts embedded in the file), less those for the fonts in `drop`, which are embedded
 * afresh. `embeds` tells whether any embedded font is left.
 */
export function keptFontTable(tree: KeptTree, drop: Set<string>): { tree: KeptTree; xml: string; embeds: boolean } | null {
  const top = tree.parts.find((p) => p.path === tree.path);
  if (!top?.xml || !/<\/w:fonts>\s*$/.test(top.xml)) return null;
  const gone = new Set<string>();
  let text = top.xml.replace(/<w:font\b[^>]*?\bw:name="([^"]*)"[^>]*?(?:\/>|>[\s\S]*?<\/w:font>)/g, (el, name: string) => {
    if (!drop.has(name.replace(/&(amp|quot);/g, (_, e: string) => (e === 'amp' ? '&' : '"')).toLowerCase())) return el;
    for (const m of el.matchAll(/\br:id="([^"]*)"/g)) gone.add(m[1]);
    return '';
  });
  // (the fonts embedded here refer to their files by r:id)
  if (!/<w:fonts\b[^>]*\bxmlns:r=/.test(text)) text = text.replace(/<w:fonts\b/, `<w:fonts xmlns:r="${NS.r}"`);
  const rels = tree.rels.filter((r) => !(r.from === tree.path && r.id && gone.has(r.id)));
  // the parts still reached from the table
  const reach = new Set([tree.path]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rels) {
      if (r.external || !reach.has(r.from)) continue;
      if (!reach.has(r.target)) { reach.add(r.target); grew = true; }
    }
  }
  const parts = tree.parts.map((p) => (p.path === tree.path ? { ...p, xml: text } : p)).filter((p) => reach.has(p.path));
  const embeds = rels.some((r) => r.from === tree.path && r.type === DOCX_REL.font);
  return { tree: { ...tree, parts, rels: rels.filter((r) => reach.has(r.from)) }, xml: text, embeds };
}


/**
 * A frame of paragraphs (ParaStyle.frame) as Word's text frame (w:framePr, ECMA-376 part 1,
 * 17.3.1.11): its width, at the left, center or right of the margins, its top at the paragraph,
 * the text round it (around) or above and below it (notBeside). Paragraphs after it with the same
 * frame properties are in the same frame.
 */
export function framePrXml(f: NonNullable<ParaStyle['frame']>): string {
  return `<w:framePr w:w="${twips(f.w)}" w:hSpace="${twips(Math.max(0, f.gap))}" w:wrap="${f.wrap === 'square' ? 'around' : 'notBeside'}" w:vAnchor="text" w:hAnchor="margin" w:xAlign="${f.align}"/>`;
}
