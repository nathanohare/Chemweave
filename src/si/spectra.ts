// The Spectra section of an SI project (SI Assistant's SPEC §13k.12, core/spectra.py): which
// spectra each compound prints, in which order, how each is set out (the section's defaults,
// then the file's own settings, then its page's), the line above it ("2 — ¹H NMR (400 MHz,
// CDCl3)"), the caption under its structure, and the sizes the journal style gives them.
// Kept in the folder exactly as SI Assistant keeps it, so either program can set them.
//
// No interface code here, so it can be tested directly.

import { NUCLEI, SPECTRUM_TYPES, partText } from './fields';
import { fieldKeys, valuesOf, type Json, type SiCompound, type SiSection } from './project';
import { parseMarkup } from './markup';
import { findSolvent } from './nmr';
import { fieldDef } from './fields';

export const PER_PAGE = [1, 2, 4] as const;
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type Corner = (typeof CORNERS)[number];

/** How spectra are set out. The defaults reproduce SI Assistant's: one per portrait page, the header line, the structure + ID on a white box top left. */
export interface SpectrumLayout {
  per_page: 1 | 2 | 4;
  orientation: 'portrait' | 'landscape';
  header_line: boolean;
  struct_box: boolean;
  corner: Corner;
  struct_frame: boolean;
  struct_frame_color: string;
  struct_frame_width: number;
  struct_bg: string;
  /** The ID's size in points; 0 = the style's text size. */
  id_size: number;
  id_bold: boolean;
  /** 1 = the structure's own size, no larger than 1.5 × 1.1 in. */
  struct_scale: number;
  spectrum_frame: boolean;
  spectrum_frame_color: string;
  spectrum_frame_width: number;
  auto_crop: boolean;
  caption: boolean;
  caption_size: number;
  nmr_links: boolean;
  link_style: 'plain' | 'blue' | 'blue_underline';
  link_back: boolean;
  hrms_reports: boolean;
  /** A dragged box's centre, as fractions of the spectrum shown (a page's own settings only). */
  x?: number;
  y?: number;
  /**
   * The ID and caption moved on their own (Alt-drag), in points from their place under the
   * structure: a page's own settings, Chemweave's only (SI Assistant keeps them in place).
   */
  label_dx?: number;
  label_dy?: number;
}

export const DEFAULTS: SpectrumLayout = {
  per_page: 1, orientation: 'portrait', header_line: true, struct_box: true, corner: 'top-left',
  struct_frame: false, struct_frame_color: '#000000', struct_frame_width: 0.5, struct_bg: '#ffffff',
  id_size: 0, id_bold: true, struct_scale: 1, spectrum_frame: false, spectrum_frame_color: '#000000',
  spectrum_frame_width: 0.5, auto_crop: false, caption: false, caption_size: 9,
  nmr_links: false, link_style: 'plain', link_back: false, hrms_reports: false,
};
/** Settings for the whole section, never one spectrum's (the links in the PDF, the HRMS reports). */
const SECTION_ONLY = new Set(['nmr_links', 'link_style', 'link_back', 'hrms_reports']);
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** A page's own place for its box (dragged) and for the ID and caption (Alt-dragged). */
export const POSITION_KEYS = ['x', 'y', 'label_dx', 'label_dy'] as const;
/** The structure size a box can be resized to (as SI Assistant's). */
export const SCALE_RANGE = [0.25, 4] as const;

/** A value checked for its setting, or undefined when it can't be used (it is then ignored, so a file edited by hand never stops a compile). */
function cleanValue(key: string, value: unknown): unknown {
  const def = (DEFAULTS as unknown as Record<string, unknown>)[key];
  const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (key === 'x' || key === 'y') return Number.isFinite(num) ? clamp(num, 0, 1) : undefined;
  if (key === 'label_dx' || key === 'label_dy') return Number.isFinite(num) && typeof value === 'number' ? clamp(num, -500, 500) : undefined;
  if (key === 'per_page') return PER_PAGE.includes(Math.trunc(num) as 1) && Number.isInteger(num) ? num : undefined;
  if (key === 'orientation') return value === 'portrait' || value === 'landscape' ? value : undefined;
  if (key === 'corner') return CORNERS.includes(value as Corner) ? value : undefined;
  if (key === 'link_style') return value === 'plain' || value === 'blue' || value === 'blue_underline' ? value : undefined;
  if (typeof def === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (key.endsWith('_color') || key === 'struct_bg') return typeof value === 'string' && COLOUR.test(value) ? value.toLowerCase() : undefined;
  if (!Number.isFinite(num) || typeof value === 'boolean') return undefined;
  if (key === 'struct_scale') return clamp(num, 0.25, 4);
  if (key === 'id_size') return num <= 0 ? 0 : clamp(num, 5, 24);
  if (key === 'caption_size') return clamp(num, 5, 18);
  if (key.endsWith('_width')) return clamp(num, 0.1, 5);
  return undefined;
}

/** Only the known settings with usable values. `positions`: also "x"/"y"; `spectrum`: no section-wide ones. */
export function clean(values: unknown, positions = false, spectrum = false): Partial<SpectrumLayout> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const v = values as Json;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(DEFAULTS).filter((k) => !((spectrum || positions) && SECTION_ONLY.has(k)));
  if (positions) keys.push(...POSITION_KEYS);
  for (const k of keys) {
    if (!(k in v)) continue;
    const got = cleanValue(k, v[k]);
    if (got !== undefined) out[k] = got;
  }
  return out as Partial<SpectrumLayout>;
}

/** The defaults in force: SI Assistant's, then the older project settings (no Spectra section), then the section's own. */
export function sectionDefaults(section: SiSection | null, settings: Json = {}): SpectrumLayout {
  const out = { ...DEFAULTS };
  if (!section) Object.assign(out, clean({ ...(settings.spectra_per_page !== undefined ? { per_page: settings.spectra_per_page } : {}), ...(settings.structure_corner !== undefined ? { corner: settings.structure_corner } : {}) }));
  else Object.assign(out, clean((section.data as Json).defaults));
  return out;
}

/** One page of a spectrum file: the defaults, the file's own settings, then the page's (with a dragged place). */
export function effective(defaults: SpectrumLayout, item: Json, page: string): SpectrumLayout {
  const out: SpectrumLayout = { ...defaults, ...clean(item.layout, false, true) };
  const pages = item.pages;
  if (pages && typeof pages === 'object' && !Array.isArray(pages)) Object.assign(out, clean((pages as Json)[page], true));
  return out;
}

const listValue = (c: SiCompound, key: string): unknown[] => {
  const v = valuesOf(c)[key];
  return Array.isArray(v) ? v : [];
};

/** The order of a compound's spectrum files set by hand ([field key, file name]), or [] for the automatic order. */
export function manualOrder(c: SiCompound): [string, string][] {
  const raw = c.data.spectra_order;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is unknown[] => Array.isArray(e) && e.length === 2).map((e) => [String(e[0]), String(e[1])]);
}

/** [field key, item] of everything a compound prints in the Spectra section, in order (core/spectra.spectrum_items). */
export function spectrumItems(c: SiCompound, automatic = false): [string, Json][] {
  const order = new Map<string, number>(SPECTRUM_TYPES.map((t, i) => [t, i]));
  const keys = fieldKeys(c);
  const items: [string, Json][] = keys.includes('spectra')
    ? listValue(c, 'spectra').filter((i): i is Json => !!i && typeof i === 'object' && !Array.isArray(i)).map((i) => ['spectra', i])
    : [];
  items.sort((a, b) => (order.get(String(a[1].type ?? '')) ?? order.size) - (order.get(String(b[1].type ?? '')) ?? order.size));
  const fields = Array.isArray(c.data.fields) ? (c.data.fields as Json[]) : [];
  for (const e of fields) {
    const def = fieldDef(e);
    if (!def || def.kind !== 'attachments' || def.key === 'spectra') continue;
    for (const i of listValue(c, def.key)) if (i && typeof i === 'object' && !Array.isArray(i) && (i as Json).placement === 'appendix') items.push([def.key, i as Json]);
  }
  const manual = automatic ? new Map<string, number>() : new Map(manualOrder(c).map(([k, n], i) => [`${k}\u0000${n}`, i]));
  if (manual.size) {
    const at = (t: [string, Json]) => manual.get(`${t[0]}\u0000${partText(t[1].file)}`) ?? manual.size;
    items.sort((a, b) => at(a) - at(b));
  }
  return items;
}

/** The folder a compound's attachment field keeps its files in. */
export function attachmentDir(c: SiCompound, key: string): string {
  const fields = Array.isArray(c.data.fields) ? (c.data.fields as Json[]) : [];
  const def = fields.map((e) => fieldDef(e)).find((d) => d?.key === key);
  return def?.subdir ?? (key === 'spectra' ? 'spectra' : 'files');
}

const isNucleus = (t: string): boolean => (NUCLEI as readonly string[]).includes(t) || /^\d+[A-Z][a-z]?$/.test(t);

/** The nucleus of an NMR spectrum ("1H"), or null for anything else (HPLC, IR, 2D NMR…). */
export function nmrNucleus(item: Json, c?: SiCompound): string | null {
  const kind = String(item.type ?? '');
  if (isNucleus(kind)) return kind;
  if (kind !== 'Other NMR') return null;
  const own = new Set<string>(SPECTRUM_TYPES);
  const others = (NUCLEI as readonly string[]).filter((n) => !own.has(n));
  const file = String(item.file ?? '');
  const stem = file.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  for (const n of [...others].sort((a, b) => b.length - a.length)) if (new RegExp(`(?<![0-9A-Za-z])${n}(?![a-z])`).test(stem)) return n;
  if (c) {
    const found = [...new Set(listValue(c, 'nmr').map((r) => (r && typeof r === 'object' ? String((r as Json).nucleus ?? '') : '')))].filter((n) => n && !own.has(n) && isNucleus(n)).sort();
    if (found.length === 1) return found[0];
  }
  return null;
}

/** [frequency "400 MHz", solvent as the report writes it] from the compound's NMR report for this nucleus. */
export function nmrConditions(c: SiCompound, nucleus: string): [string, string] {
  for (const r of listValue(c, 'nmr')) {
    if (!r || typeof r !== 'object' || (r as Json).nucleus !== nucleus) continue;
    const text = parseMarkup(String((r as Json).text ?? '')).map((p) => p.runs.map((x) => x.text).join('')).join(' ');
    const freq = /(\d{2,4}(?:\.\d+)?)\s*MHz/.exec(text);
    const solvent = findSolvent(text);
    return [freq ? `${freq[1]} MHz` : '', solvent ? solvent.written.replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)) : ''];
  }
  return ['', ''];
}

/** The line above a spectrum, in pieces: "2 — 1H NMR", " (400 MHz, CDCl3)", or the header typed for it; later pages add " (continued)". */
export function headerParts(c: SiCompound, item: Json, displayId: string, pageNo: number): string[] {
  const custom = String(item.title ?? '').trim();
  let parts: string[];
  if (custom) parts = [custom];
  else {
    const kind = String(item.type || item.caption || item.file || '');
    const nucleus = nmrNucleus(item, c) ?? (isNucleus(kind) ? kind : null);
    if (nucleus) {
      parts = [`${displayId} — ${nucleus} NMR`];
      const [freq, solvent] = nmrConditions(c, nucleus);
      const cond = [freq, solvent].filter(Boolean).join(', ');
      if (cond) parts.push(` (${cond})`);
    } else parts = [`${displayId} — ${kind}`];
  }
  if (pageNo > 1) parts.push(' (continued)');
  return parts;
}

/** The caption under the structure: the one typed for this spectrum, else "1H NMR (CDCl3, 500 MHz)" for NMR spectra. */
export function captionText(c: SiCompound, item: Json): string {
  const typed = String(item.struct_caption ?? '').trim();
  if (typed) return typed;
  const nucleus = nmrNucleus(item, c);
  if (!nucleus) return '';
  const [freq, solvent] = nmrConditions(c, nucleus);
  const inside = [solvent, freq].filter(Boolean).join(', ');
  return `${nucleus} NMR${inside ? ` (${inside})` : ''}`;
}

// ---------------------------------------------------------------- printed sizes (points)

export const IN = 72;
/** Between slots: across, down (0.6 cm, 0.8 cm). */
export const GUTTERS = [(0.6 / 2.54) * IN, (0.8 / 2.54) * IN] as const;
/** The box's distance from the spectrum's corner (0.4 cm). */
export const CORNER_INSET = (0.4 / 2.54) * IN;
/** The structure's largest size at 100 % (1.5 × 1.1 in). */
export const STRUCTURE_BOX = { w: 1.5 * IN, h: 1.1 * IN };
export const BOX_PAD = 3;
export const HEADER_PT = 11;

/** [columns, rows] of the slots on a spectra page. */
export function grid(perPage: number, landscape: boolean): [number, number] {
  if (perPage === 4) return [2, 2];
  if (perPage === 2) return landscape ? [2, 1] : [1, 2];
  return [1, 1];
}

/** One slot's size in a body of `bw` × `bh` points. */
export function slotSize(bw: number, bh: number, perPage: number, landscape: boolean): { w: number; h: number } {
  const [cols, rows] = grid(perPage, landscape);
  return { w: (bw - GUTTERS[0] * (cols - 1)) / cols, h: (bh - GUTTERS[1] * (rows - 1)) / rows };
}

/** The size the part of a spectrum shown prints at: as large as fits its room, keeping its shape (`aspect` = the page's height / width). */
export function shownSize(room: { w: number; h: number }, aspect: number, crop: Crop | null): { w: number; h: number } {
  if (!(aspect > 0)) return room;
  const [l, t, r, b] = crop ?? [0, 0, 1, 1];
  const shape = (aspect * (b - t)) / (r - l);
  const w = Math.min(room.w, room.h / shape);
  return { w, h: w * shape };
}

/** The structure's printed size on a spectrum: its own size, no larger than STRUCTURE_BOX, times `scale`. */
export function structureSize(own: { w: number; h: number } | null, scale: number): { w: number; h: number } {
  if (!own || !(own.w > 0) || !(own.h > 0)) return { w: STRUCTURE_BOX.w * scale, h: STRUCTURE_BOX.h * scale };
  const fit = Math.min(1, STRUCTURE_BOX.w / own.w, STRUCTURE_BOX.h / own.h) * scale;
  return { w: own.w * fit, h: own.h * fit };
}

/** The structure box's size: the structure, and the ID (and caption) under it, with room round them. */
export function structureBoxSize(structure: { w: number; h: number }, id: string, idSize: number, caption: string, captionSize: number): { w: number; h: number } {
  const textW = Math.max(id.length * idSize * 0.6, caption.length * captionSize * 0.5);
  return {
    w: Math.max(structure.w, textW) + 2 * BOX_PAD + 2 * 7.2,
    h: structure.h + idSize * 1.2 + (caption ? captionSize * 1.2 : 0) + 2 * BOX_PAD + 2 * 3.6,
  };
}

/** Where the box's top left goes on a spectrum shown at `spec`: where it was dragged (its centre), or in its corner. */
export function structureBoxAt(eff: SpectrumLayout, spec: { x: number; y: number; w: number; h: number }, box: { w: number; h: number }): { x: number; y: number } {
  if (eff.x !== undefined && eff.y !== undefined) return { x: spec.x + eff.x * spec.w - box.w / 2, y: spec.y + eff.y * spec.h - box.h / 2 };
  return {
    x: eff.corner.endsWith('right') ? spec.x + spec.w - CORNER_INSET - box.w : spec.x + CORNER_INSET,
    y: eff.corner.startsWith('bottom') ? spec.y + spec.h - CORNER_INSET - box.h : spec.y + CORNER_INSET,
  };
}

/** The ID's size in points (0 in the settings: the text's, 11 pt). */
export const idSizeOf = (eff: SpectrumLayout): number => (eff.id_size > 0 ? eff.id_size : 11);

// ---------------------------------------------------------------- auto-crop

/** The part of a page shown: left, top, right, bottom as fractions. */
export type Crop = [number, number, number, number];

/**
 * Where the content of a picture is (12.8): everything darker than near-white (245 of 255), with
 * a small margin (1 % of the picture, at least 4 pixels), as fractions. Null when the picture is
 * blank or nothing would be cut. `rgba` is the picture's pixels, 4 bytes each.
 */
export function contentBox(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, white = 245): Crop | null {
  if (!w || !h) return null;
  let top = -1, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y++) {
    let rowInk = false;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = rgba[i + 3] / 255;
      // (a see-through pixel shows the white page behind it)
      const g = Math.round((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a + 255 * (1 - a));
      if (g < white) {
        rowInk = true;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    if (rowInk) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) return null;
  const mx = Math.max(4, Math.round(w * 0.01)), my = Math.max(4, Math.round(h * 0.01));
  const box: Crop = [Math.max(0, left - mx) / w, Math.max(0, top - my) / h, Math.min(w, right + 1 + mx) / w, Math.min(h, bottom + 1 + my) / h];
  if (box[0] === 0 && box[1] === 0 && box[2] === 1 && box[3] === 1) return null;
  return box.map((v) => Math.round(v * 10000) / 10000) as Crop;
}

// ---------------------------------------------------------------- HRMS reports (§13n.3)

const PICTURES = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.gif', '.svg'];
const TEXTS = ['.csv', '.tsv', '.txt', '.tab', '.asc', '.xy', '.dat', '.prn', '.text', '.jdx', '.dx', '.jcamp', '.jcm', '.mgf'];
const PEAKS = ['.mzml', '.mzxml', '.mzdata', '.cdf', '.nc'];

/** The compound's HRMS report entries (hrms.reports), with plain file names only. */
export function reportItems(c: SiCompound): Json[] {
  const v = valuesOf(c).hrms;
  const items = v && typeof v === 'object' && !Array.isArray(v) ? (v as Json).reports : null;
  if (!Array.isArray(items)) return [];
  return items.filter((i): i is Json => !!i && typeof i === 'object' && !Array.isArray(i) && typeof (i as Json).file === 'string' && /^[^/\\]+$/.test((i as Json).file as string) && !/^\.\.?$/.test((i as Json).file as string));
}

/** Whether a compound's HRMS reports are printed: its own choice (hrms.print_reports), else the section's "Print HRMS reports". */
export function printsReports(c: SiCompound, defaults: SpectrumLayout): boolean {
  if (!fieldKeys(c).includes('hrms') || !reportItems(c).length) return false;
  const v = valuesOf(c).hrms as Json | undefined;
  const own = v && typeof v === 'object' ? v.print_reports : undefined;
  return typeof own === 'boolean' ? own : defaults.hrms_reports;
}

/** How a report is printed: a PDF page by page, a picture, a text listing, a table of peaks (not yet here), or not at all. */
export function printKind(name: string): 'pdf' | 'picture' | 'listing' | 'peaks' | 'none' {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (ext === '.pdf') return 'pdf';
  if (PICTURES.includes(ext)) return 'picture';
  if (PEAKS.includes(ext) || lower.endsWith('.mzdata.xml')) return 'peaks';
  if (TEXTS.includes(ext)) return 'listing';
  return 'none';
}

/** A text report as lines to print (tabs to spaces, long lines cut), at most `most`: [lines, how many were left out]. */
export function listingLines(text: string, most = 200, width = 110): [string[], number] {
  const all = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n').map((l) => {
    let out = '';
    for (const ch of l) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
    return out.length > width ? out.slice(0, width - 1) + '…' : out;
  });
  return [all.slice(0, most), Math.max(0, all.length - most)];
}
