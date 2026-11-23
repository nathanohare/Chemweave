// The front matter's layout choices that Chemweave gives more control over than SI Assistant's
// one-value settings (Nate's SI report 2026-11-23, item 3):
//
// - the cover page's spacing: SI Assistant keeps one factor (cover.spacing: 1, 2 or 3 times
//   the standard gaps); Chemweave also keeps each gap in points (cover.gaps), and writes the
//   nearest factor too, so SI Assistant still spaces the cover about the same way;
// - what the table of contents lists: SI Assistant keeps one depth (toc.depth: sections,
//   subsections, procedures or compounds, each level listing the ones before it too);
//   Chemweave also keeps a switch for each kind of heading (toc.lists), and writes the nearest
//   depth too.
//
// Keys SI Assistant doesn't know are kept by it as they are (project.json is read and written
// whole), as with heading_format and drawing_style. Each set of values also keeps the factor or
// depth written with it ("for"): when SI Assistant has changed that since, its choice wins and
// the values are not used.

import type { Json } from './project';

const dict = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

// ---------------------------------------------------------------- the cover page's gaps

/** The cover page's gaps, in points: above the heading, and after the heading, the title, the authors, the affiliations and the emails. */
export interface CoverGaps { above: number; heading: number; title: number; authors: number; affiliations: number; emails: number }
export const COVER_GAP_KEYS = ['above', 'heading', 'title', 'authors', 'affiliations', 'emails'] as const;
export const COVER_GAP_LABELS: Record<keyof CoverGaps, string> = { above: 'Above heading', heading: 'After heading', title: 'After title', authors: 'After authors', affiliations: 'After affiliations', emails: 'After emails' };
/** The standard gaps (spacing Normal, 1×): SI Assistant's. Nothing is added above the heading. */
export const STANDARD_COVER_GAPS: CoverGaps = { above: 0, heading: 14, title: 14, authors: 8, affiliations: 6, emails: 18 };
const MAX_GAP = 400;

/** The cover's spacing factor: 1 (Normal), 2 (More), 3 (Much more), or any number typed into project.json (0.5–6). */
export function coverSpacing(settings: Json): number {
  const v = Number(dict(settings.cover).spacing);
  return Number.isFinite(v) && v > 0 ? Math.min(6, Math.max(0.5, v)) : 1;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Each gap of the cover page in points: the ones set (cover.gaps), else the standard ones times the spacing factor. */
export function coverGaps(settings: Json): CoverGaps {
  const k = coverSpacing(settings);
  let set = dict(dict(settings.cover).gaps);
  // (the spacing changed in SI Assistant since the gaps were set: its spacing is used)
  if (set.for !== undefined && Number(set.for) !== k) set = {};
  const out = {} as CoverGaps;
  for (const g of COVER_GAP_KEYS) {
    const v = Number(set[g]);
    out[g] = set[g] !== undefined && set[g] !== null && set[g] !== '' && Number.isFinite(v) ? Math.min(MAX_GAP, Math.max(0, round1(v))) : round1(STANDARD_COVER_GAPS[g] * k);
  }
  return out;
}

/**
 * Keep the cover's gaps: as only a spacing factor when they are the standard ones times one
 * factor (and nothing above the heading), else each in cover.gaps with the nearest factor in
 * cover.spacing for SI Assistant (rounded to a quarter; left out at 1).
 */
export function storeCoverGaps(settings: Json, gaps: CoverGaps): void {
  const c = { ...dict(settings.cover) };
  const ratios = COVER_GAP_KEYS.filter((g) => STANDARD_COVER_GAPS[g] > 0).map((g) => gaps[g] / STANDARD_COVER_GAPS[g]);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const k = Math.min(6, Math.max(0.5, Math.round(mean * 4) / 4));
  const one = gaps.above === 0 && COVER_GAP_KEYS.every((g) => Math.abs(gaps[g] - round1(STANDARD_COVER_GAPS[g] * k)) < 0.05);
  if (one) delete c.gaps;
  else c.gaps = { ...Object.fromEntries(COVER_GAP_KEYS.map((g) => [g, Math.min(MAX_GAP, Math.max(0, round1(gaps[g])))])), for: k };
  if (k === 1) delete c.spacing; else c.spacing = k;
  if (Object.keys(c).length) settings.cover = c; else delete settings.cover;
}

// ---------------------------------------------------------------- what the contents list

/** The kinds of heading the table of contents can list, each on or off. */
export interface TocLists { sections: boolean; subsections: boolean; headings: boolean; general: boolean; procedures: boolean; compounds: boolean; spectra: boolean; hrms: boolean; references: boolean }
export const TOC_LIST_KEYS = ['sections', 'subsections', 'headings', 'general', 'procedures', 'compounds', 'spectra', 'hrms', 'references'] as const;
export const TOC_LIST_LABELS: Record<keyof TocLists, string> = {
  sections: 'Sections', subsections: 'Sub-sections', headings: 'Headings in section text', general: 'General Information',
  procedures: 'General procedures', compounds: 'Compounds', spectra: 'Spectra', hrms: 'HRMS reports', references: 'References',
};
/** SI Assistant's depths, each listing the ones before it too. */
export const TOC_DEPTHS = ['sections', 'subsections', 'procedures', 'compounds'] as const;

/** SI Assistant's depth: toc.depth, else (older projects) compounds when list_compounds_in_toc, else procedures. */
export function tocDepth(settings: Json): (typeof TOC_DEPTHS)[number] {
  const d = dict(settings.toc).depth;
  return typeof d === 'string' && (TOC_DEPTHS as readonly string[]).includes(d) ? (d as (typeof TOC_DEPTHS)[number]) : settings.list_compounds_in_toc ? 'compounds' : 'procedures';
}

/** What the contents list: the switches set (toc.lists), the others as SI Assistant's depth lists them. */
export function tocLists(settings: Json): TocLists {
  const rank = TOC_DEPTHS.indexOf(tocDepth(settings)) + 1;
  const byDepth: TocLists = {
    sections: true, general: true, spectra: true, references: true,
    subsections: rank >= 2, headings: rank >= 2, hrms: rank >= 2,
    procedures: rank >= 3, compounds: rank >= 4,
  };
  let set = dict(dict(settings.toc).lists);
  // (the depth changed in SI Assistant since the switches were set: its depth is used)
  if (set.for !== undefined && set.for !== tocDepth(settings)) set = {};
  const out = { ...byDepth };
  for (const k of TOC_LIST_KEYS) if (typeof set[k] === 'boolean') out[k] = set[k] as boolean;
  return out;
}

/** SI Assistant's depth nearest these switches: the deepest kind listed. */
export function nearestDepth(l: TocLists): (typeof TOC_DEPTHS)[number] {
  return l.compounds ? 'compounds' : l.procedures ? 'procedures' : l.subsections || l.headings || l.hrms ? 'subsections' : 'sections';
}

/**
 * Keep what the contents list: as only SI Assistant's depth when the switches are exactly what a
 * depth lists, else each switch in toc.lists, with the nearest depth in toc.depth for SI Assistant.
 */
export function storeTocLists(settings: Json, l: TocLists): void {
  const t = { ...dict(settings.toc) };
  const depth = nearestDepth(l);
  t.depth = depth;
  const plain = tocLists({ toc: { depth } });
  if (TOC_LIST_KEYS.every((k) => plain[k] === l[k])) delete t.lists;
  else t.lists = { ...Object.fromEntries(TOC_LIST_KEYS.map((k) => [k, l[k]])), for: depth };
  settings.toc = t;
}
