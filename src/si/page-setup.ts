// An SI project's page header, footer and page numbers (SI Assistant's Project settings ▸ Page,
// its SPEC §13k.2a), read from project.json "page" as SI Assistant reads it:
//
//   "page": {"header": {"left", "center", "right"}, "footer": {…} (absent: the journal style's),
//            "number_prefix": "S", "number_style": "1" | "i" | "I", "number_size": 0 (the text's),
//            "number_bold": false, "number_on_cover": false,
//            "paper": "letter" | "a4" (Chemweave's; absent: Letter), "margins": {"top", "bottom", "left",
//            "right"} in inches (Chemweave's; absent: 1 inch each)}
//
// Texts may hold {page}, {pages}, {title}, {authors} and {date}; {page} and {pages} become page
// fields of the compiled document, the others are filled in when it is compiled.

import type { TextRun } from '../model';
import { A4, LETTER, type HeaderFooter, type PageNumFormat, type PageSetup } from '../document/document';
import type { Json } from './project';

export interface PageSettings {
  header: [string, string, string];
  footer: [string, string, string];
  /** The footer is the journal style's own (none stored). */
  footerIsStyle: boolean;
  number_prefix: string;
  number_style: '1' | 'i' | 'I';
  number_size: number;
  number_bold: boolean;
  number_on_cover: boolean;
  paper: 'letter' | 'a4';
  /** Inches. */
  margins: { top: number; bottom: number; left: number; right: number };
}

export const PAPER_SIZES: Record<PageSettings['paper'], string> = { letter: 'Letter (8.5 × 11 in)', a4: 'A4 (210 × 297 mm)' };
const MARGIN_SIDES = ['top', 'bottom', 'left', 'right'] as const;
/** A margin as read: from half an inch (the header and footer sit half an inch from the edge) to three inches (else the 1 inch default). */
export const MARGIN_MIN = 0.5, MARGIN_MAX = 3;
const margin = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n >= MARGIN_MIN && n <= MARGIN_MAX ? n : 1; };

const POSITIONS = ['left', 'center', 'right'] as const;
const STYLE_FOOTERS: Record<string, [string, string, string]> = { ACS: ['', '{page}', ''], Wiley: ['', '', '{page}'], RSC: ['', '{page}', ''] };
export const NUMBER_STYLES: Record<string, string> = { '1': '1, 2, 3', i: 'i, ii, iii', I: 'I, II, III' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const line = (raw: unknown): [string, string, string] | null => (isObj(raw) ? (POSITIONS.map((p) => String(raw[p] ?? '')) as [string, string, string]) : null);

export function styleFooter(journal: string): [string, string, string] { return [...(STYLE_FOOTERS[journal] ?? STYLE_FOOTERS.ACS)] as [string, string, string]; }

/** The page settings in effect, the defaults filled in. */
export function pageSettings(settings: Json): PageSettings {
  const raw = isObj(settings.page) ? settings.page : {};
  const def = styleFooter(String(settings.journal_style ?? 'ACS'));
  const stored = line(raw.footer);
  const style = String(raw.number_style ?? '1');
  const size = Number(raw.number_size ?? 0);
  return {
    header: line(raw.header) ?? ['', '', ''],
    footer: stored ?? def,
    footerIsStyle: !stored || stored.join('\u0000') === def.join('\u0000'),
    number_prefix: String(raw.number_prefix ?? 'S'),
    number_style: style === 'i' || style === 'I' ? style : '1',
    number_size: Number.isFinite(size) && size > 0 ? size : 0,
    number_bold: !!raw.number_bold,
    number_on_cover: !!raw.number_on_cover,
    paper: raw.paper === 'a4' ? 'a4' : 'letter',
    margins: Object.fromEntries(MARGIN_SIDES.map((k) => [k, margin(isObj(raw.margins) ? raw.margins[k] : undefined)])) as PageSettings['margins'],
  };
}

/** The compiled SI's page: its paper and margins, the header and footer half an inch from the edge (as the default page). */
export function pageOf(settings: Json, base: PageSetup): PageSetup {
  const v = pageSettings(settings);
  const size = v.paper === 'a4' ? A4 : LETTER;
  const inch = 72;
  return { ...base, w: size.w, h: size.h, top: v.margins.top * inch, bottom: v.margins.bottom * inch, left: v.margins.left * inch, right: v.margins.right * inch };
}

/** Keep page settings as SI Assistant keeps them (a footer equal to the journal style's isn't stored, so it follows the style). */
export function storePageSettings(settings: Json, v: Omit<PageSettings, 'footerIsStyle' | 'paper' | 'margins'> & Partial<Pick<PageSettings, 'paper' | 'margins'>>): void {
  const was = pageSettings(settings);
  const paper = v.paper ?? was.paper, margins = v.margins ?? was.margins;
  const page: Json = {
    header: Object.fromEntries(POSITIONS.map((p, i) => [p, v.header[i]])),
    number_prefix: v.number_prefix, number_style: v.number_style, number_size: v.number_size, number_bold: v.number_bold, number_on_cover: v.number_on_cover,
  };
  // (the defaults aren't stored: a project made before keeps reading as it did)
  if (paper !== 'letter') page.paper = paper;
  if (MARGIN_SIDES.some((k) => margins[k] !== 1)) page.margins = { ...margins };
  if (v.footer.join('\u0000') !== styleFooter(String(settings.journal_style ?? 'ACS')).join('\u0000')) page.footer = Object.fromEntries(POSITIONS.map((p, i) => [p, v.footer[i]]));
  settings.page = page;
}

export function dateText(d = new Date()): string { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

/** What a page number looks like in a style: S1, Sii, SIV. */
export const numFormatOf = (style: string): PageNumFormat => (style === 'i' ? 'lowerRoman' : style === 'I' ? 'upperRoman' : 'decimal');

/**
 * The compiled document's header and footer: each line as one paragraph with its left, centre and
 * right text at tab stops, {page} and {pages} as fields (`field` keeps a field object and gives its
 * id), the numbers in their size and bold. Without a number on the cover (`onCover`, the setting
 * when left out), the first page has no header or footer, as in SI Assistant.
 */
export function headerFooter(settings: Json, fill: { title: string; authors: string }, field: (code: 'page' | 'numpages') => number, width: number, onCover?: boolean): { hf: HeaderFooter; format: PageNumFormat } {
  const v = pageSettings(settings);
  const cover = onCover ?? v.number_on_cover;
  const look: Partial<TextRun> = {};
  const numLook: Partial<TextRun> = { ...look, ...(v.number_size ? { size: v.number_size } : {}), ...(v.number_bold ? { bold: true } : {}) };
  const body = (zones: [string, string, string]): { runs: TextRun[]; paras: { spaceBefore: number; spaceAfter: number; tabs: { pos: number; kind: 'center' | 'right' }[] }[] } | null => {
    if (!zones.some((z) => z.trim())) return null;
    const runs: TextRun[] = [];
    zones.forEach((z, i) => {
      if (i) runs.push({ ...look, text: '\t' });
      for (const part of z.split(/(\{(?:page|pages|title|authors|date)\})/)) {
        if (!part) continue;
        if (part === '{page}' || part === '{pages}') {
          // (both written as page numbers are: S1 of S24)
          if (v.number_prefix) runs.push({ ...numLook, text: v.number_prefix });
          runs.push({ ...numLook, obj: field(part === '{page}' ? 'page' : 'numpages'), text: '￼' });
        }
        else runs.push({ ...look, text: part === '{title}' ? fill.title : part === '{authors}' ? fill.authors : part === '{date}' ? dateText() : part });
      }
    });
    return { runs, paras: [{ spaceBefore: 0, spaceAfter: 0, tabs: [{ pos: width / 2, kind: 'center' }, { pos: width, kind: 'right' }] }] };
  };
  const header = body(v.header), footer = body(v.footer);
  const hf: HeaderFooter = {
    header: ['', '', ''], footer: ['', '', ''], numbers: 'none', prefix: v.number_prefix, start: 1, onFirst: cover,
    ...(cover ? {} : { firstPage: true, first: { header: ['', '', ''], footer: ['', '', ''] } }),
  };
  // the header's and footer's text and fields, in place of the plain zones
  if (header || footer) hf.bodies = { ...(header ? { header } : {}), ...(footer ? { footer } : {}) };
  return { hf, format: numFormatOf(v.number_style) };
}
