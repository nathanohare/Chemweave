// The text of an imported SI around its compounds (Chem SI Assistant's core/si_import_text.py,
// SPEC §13u.9 and §13u.16): the cover page, the table of contents, the sections with their
// headings, text, figures and tables, and the reference list.
//
// outline(plan, bodySize) reads plan.sequence (the SI's paragraphs, general procedures and
// compounds in reading order) and fills in plan.cover, plan.sections and plan.references:
// * Cover page: everything before the table of contents (or before the first heading followed by
//   body text when the SI starts "Supporting Information"): title, authors, affiliations.
// * Table of contents: listed, not imported (the program makes its own).
// * Heading levels: Word's heading styles; else numbering; else font sizes; else all level 1.
// * Sections: each level-1 heading starts one (custom, General Information, references, spectra,
//   or Data sections with their compounds).
// * Figures and tables: Word pictures and embedded drawings, Word tables, with their captions; a
//   PDF's figures are cut out of their pages later (si-import-pdf.ts).

import { writeMarkup, type Run } from './markup';
import { boldShare, paraMarkup, paraText, type Para } from './si-import-read';
import { isSectionHeading, splitRuns, type ImportedCompound, type ImportedGP, type ImportPlan, type SeqItem } from './si-import';
import { readList } from './si-import-refs';
import { finditer, fullmatch, isUpper, lstrip, match, rx, rstrip, search, strip, sub } from './py';

export interface ImportedFigure {
  key: string;             // "fig1", "tab2", … (the placeholder in its section's text)
  /** "picture" (a Word picture), "object" (an embedded drawing's picture, EMF), "table" (a Word table), "cut" (to cut out of a PDF page). */
  kind: string;
  data: Uint8Array | null;
  ext: string;             // ".png", ".emf", ".pdf"…
  caption: string;         // markup, without its label
  label: string;           // as printed: "Figure S2", "Scheme 1", "Table S1"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;              // a table (tables.json form)
  page: number;            // PDF: the page, and the part of it to cut out (pt)
  top: number;
  bottom: number;
  is_table: boolean;       // (a PDF table: cut out below its caption)
  keep: boolean;
  width_cm: number | null; // its printed width in the SI (null: unknown)
  below: [number, number] | null;   // PDF: [top, bottom] under its caption, tried second,
  below_labels: string[];  // …the short lines there (its labels
  cut_below: boolean;      // if it was cut from there: then left out of the text)
}

export interface ImportedSection {
  key: string;             // "x1", …
  kind: 'general' | 'text' | 'data' | 'references' | 'spectra' | 'toc';
  name: string;            // its heading without numbering
  heading: string;         // as printed
  parent: string;          // the key of the section it sits in ("" = top level)
  text: string;            // markup; figures as "!figure{key} caption" lines
  figures: Map<string, ImportedFigure>;
  compounds: ImportedCompound[];
  gps: ImportedGP[];
  keep: boolean;
  note: string;            // what the review window says about it
}

export interface Author { name: string; affiliations: string[]; corresponding: boolean; email: string }

export interface ImportedCover {
  title: string;
  authors: Author[];
  affiliations: { marker: string; text: string }[];
  lines: string[];
  keep: boolean;
}

// ---------------------------------------------------------------------- patterns

const TOC = rx('^(?:table\\s+of\\s+)?contents\\.?:?$', 'i');
const SI_LINE = rx('^(?:electronic\\s+)?(?:supporting|supplementary|supplemental)\\s+(?:information|materials?|data|info)\\b.{0,40}$', 'i');
const LEADERS = rx('(?:\\.\\s?){5,}|…{2,}|_{5,}');
const PAGE_AT_END = rx('(?:\\s|\\.)(?:S|SI-?)?\\d{1,3}$');
const NUM = rx('^(?P<num>(?:S|SI-?)?\\d{1,2}(?:\\.\\d{1,2}){0,2}|[IVX]{1,5}|[A-H])(?P<dot>[.)]?)\\s+(?=\\S)');
const SUPPLEMENTARY = rx('^(?:supplementary|supporting)\\s+(?:note|discussion|methods?|figures?|tables?|text)\\b', 'i');
const GENERAL = rx('^(?:general(?:\\s+(?:information|remarks?|methods?|considerations|notes?|experimental(?:\\s+\\w+)?|procedures?\\s+and\\s+methods|materials\\s+and\\s+methods|aspects|details))?|(?:supplementary\\s+)?materials\\s+and\\s+methods|experimental\\s+(?:section|details|methods|procedures)?|methods)\\b', 'i');
const REFERENCES = rx('^(?:(?:supplementary|supplemental|supporting|SI)\\s+)?(?:references?(?:\\s+and\\s+notes)?|notes\\s+and\\s+references|bibliography|literature(?:\\s+cited)?|cited\\s+literature)\\s*:?$', 'i');
const SPECTRA = rx('\\b(?:spectra|traces|chromatograms|copies\\s+of)\\b|\\b\\d{1,3}\\s?[A-Z][a-z]?\\s?(?:\\{[^}]*\\})?\\s?NMR\\s*\\(', 'i');
// (a spectrum's own header: "6a ¹H NMR (600 MHz, CDCl3)")
export const CAPTION = rx('^(?P<label>(?:(?:Supplementary|Supporting)\\s+)?(?:Figure|Fig\\.|Scheme|Chart|Table|Graph)\\s+S?\\d+[A-Za-z]?)\\s*(?:[.:|—–-]\\s*)?(?P<rest>.*)$', 's');

/** "1.2. Synthesis" → "Synthesis"; "IV. Experimental" → "Experimental" (the program numbers its sections itself). */
export function stripNumber(text: string): string {
  const m = match(NUM, text);
  if (m && (m.group('dot') || match(rx('(?:S|SI-?)?\\d'), m.group('num')!))) return strip(text.slice(m.end), ' .:');
  return strip(text, ' :');
}

export function numLevel(text: string): number {
  const m = match(NUM, text);
  if (!m) return 0;
  const num = m.group('num')!;
  if (fullmatch(rx('[A-H]'), num) && (!m.group('dot') || !isUpper(text.slice(m.end).slice(0, 1)))) return 0;   // ("A General Method", "E. coli")
  if (fullmatch(rx('[IVX]{1,5}'), num) && !m.group('dot')) return 0;
  return (num.match(/\./g) ?? []).length + 1;
}

export function norm(textIn: string): string {
  let text = sub(LEADERS, ' ', textIn);
  text = sub(PAGE_AT_END, '', strip(text));
  return strip(sub(rx('\\W+'), ' ', stripNumber(text))).toLowerCase();
}

/** Python's round() to a whole number: halves to the even neighbour. */
const roundEven = (x: number): number => {
  const f = Math.floor(x), d = x - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
};

// ---------------------------------------------------------------------- headings

/** {para: level 1–3} for the paragraphs that are headings. Captions and table cells are never headings. */
export function headingLevels(paras: Para[], bodySize: number): Map<Para, number> {
  const heads = paras.filter((p) => !p.table && !match(CAPTION, paraText(p)) && isSectionHeading(p, bodySize));
  const out = new Map<Para, number>();
  if (heads.some((p) => p.heading)) {
    let last = 0;
    for (const p of heads) {
      if (p.heading) { last = Math.min(3, p.heading); out.set(p, last); } else out.set(p, last ? Math.min(3, last + 1) : 1);
    }
    return out;
  }
  if (heads.filter((p) => numLevel(paraText(p)) === 1).length >= 2) {
    let last = 0;
    for (const p of heads) {
      const n = numLevel(paraText(p));
      if (n) { last = n; out.set(p, n); } else if (match(SUPPLEMENTARY, paraText(p))) { last = 1; out.set(p, 1); } else out.set(p, last ? Math.min(3, last + 1) : 1);
    }
    return out;
  }
  const sizes = [...new Set(heads.filter((p) => p.size).map((p) => roundEven(p.size)))].sort((a, b) => b - a);
  const rank = sizes.length >= 2 ? new Map(sizes.map((s, i) => [s, Math.min(3, i + 1)])) : null;
  for (const p of heads) out.set(p, rank ? rank.get(roundEven(p.size)) ?? 1 : 1);
  return out;
}

// ---------------------------------------------------------------------- cover and contents

/** [where the cover ends, where the table of contents ends] in `seq`. */
function front(seq: SeqItem[], levels: Map<Para, number>): [number, number] {
  let firstBlock = seq.findIndex(([k]) => k !== 'para');
  if (firstBlock < 0) firstBlock = seq.length;
  const paras = seq.slice(0, firstBlock).map(([k, o], i) => [i, k, o] as const).filter(([, k]) => k === 'para').map(([i, , o]) => [i, o as Para] as const);
  const toc = paras.slice(0, 80).find(([, p]) => match(TOC, strip(paraText(p))));
  if (toc) return [toc[0], tocEnd(seq, toc[0], firstBlock, levels)];
  if (!paras.slice(0, 4).some(([, p]) => match(SI_LINE, strip(paraText(p))))) return [0, 0];
  for (let k = 0; k < paras.length; k++) {
    const [i, p] = paras[k];
    if (p.page > 1) return [i, i];
    if (levels.has(p)) {
      const nxt = paras.slice(k + 1).map(([, q]) => q).find((q) => !levels.has(q) && paraText(q));
      if (nxt && paraText(nxt).length >= 150) return [i, i];
    }
  }
  return [firstBlock, firstBlock];
}

function tocEnd(seq: SeqItem[], toc: number, limit: number, levels: Map<Para, number>): number {
  const headsAfter: [number, string][] = [];
  seq.forEach(([k, o], j) => { if (j > toc && k === 'para' && levels.has(o as Para)) headsAfter.push([j, norm(paraText(o as Para))]); });
  // Where the first entry comes again as a heading, the SI's text starts.
  const first = seq.slice(toc + 1, limit).find(([k, o]) => k === 'para' && strip(paraText(o as Para)))?.[1] as Para | undefined;
  const target = first ? norm(paraText(first)) : '';
  if (target) {
    const again = headsAfter.find(([j, n]) => n === target && seq[j][1] !== first && j < limit);
    if (again) return again[0];
  }
  let i = toc + 1;
  while (i < limit) {
    const [kind, p] = seq[i];
    if (kind !== 'para') break;
    const t = strip(paraText(p as Para));
    if (!t || search(LEADERS, t) || (search(PAGE_AT_END, t) && t.length < 160)) { i++; continue; }
    const nm = norm(t);
    if (nm && headsAfter.some(([j, n]) => j > i && n === nm)) { i++; continue; }   // (an entry without a page number)
    break;
  }
  return i;
}

const isSuper = (r: Run): boolean => r.valign === 'super';

/** The cover page's title, authors and affiliations. */
export function readCover(paras: Para[], levels: Map<Para, number>): ImportedCover {
  const cover: ImportedCover = { title: '', authors: [], affiliations: [], lines: paras.map(paraText).filter(Boolean), keep: true };
  const rest = paras.filter((p) => paraText(p) && !match(SI_LINE, strip(paraText(p))));
  if (!rest.length) return cover;
  // the title: the first heading-like paragraph(s) — bold, larger, or styled
  let k = 0;
  while (k < rest.length && !titleLike(rest[k], levels) && k < 2) k++;
  if (k >= rest.length || !titleLike(rest[k], levels)) k = 0;
  const title = [paraText(rest[k])];
  k++;
  while (k < rest.length && titleLike(rest[k], levels) && !authorLine(rest[k]) && Math.abs((rest[k].size || 0) - (rest[k - 1].size || 0)) < 0.6) {
    title.push(paraText(rest[k]));
    k++;
  }
  cover.title = strip(title.join(' ').replace(/\s+/g, ' '));
  if (k < rest.length && authorLine(rest[k])) {
    const runs: Run[] = [...rest[k].runs];
    k++;
    while (k < rest.length && !affiliationLike(rest[k]) && !search(rx('@|e-?mail', 'i'), paraText(rest[k])) && paraText(rest[k]).length < 200
      && paraText(rest[k]).split(/\s+/).filter(Boolean).every((w) => fullmatch(rx("(?:[A-ZÀ-Þ][\\w.'’\\-]*|and|&)[*†‡§#+,]*"), w))) {
      runs.push({ text: ' ' }, ...rest[k].runs);     // (a list running over two lines)
      k++;
    }
    cover.authors = authorsOf(runs);
  }
  const emails: string[] = [];
  for (const p of rest.slice(k)) {
    const text = paraText(p);
    const found = [...finditer(rx('[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+'), text)].map((m) => m[0]);
    if (found.length || match(rx('^\\W*(?:e-?mail|corresponding|\\*)', 'i'), text)) { emails.push(...found); continue; }
    if (affiliationLike(p)) {
      const [marker, t] = markerAndText(p.runs);
      const lastAff = cover.affiliations[cover.affiliations.length - 1];
      if (!marker && lastAff && !lastAff.marker) lastAff.text += ', ' + t;   // (a second line)
      else cover.affiliations.push({ marker, text: t });
    }
  }
  // Each e-mail address to the corresponding author whose name is in it; the others in order.
  const corresponding = cover.authors.filter((a) => a.corresponding);
  const left: string[] = [];
  for (const mail of emails) {
    const local = mail.split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    const hit = corresponding.filter((a) => !a.email && (ascii(a.name).toLowerCase().match(/[a-z]+/g) ?? []).some((w) => w.length >= 3 && local.includes(w)));
    if (hit.length === 1) hit[0].email = mail;
    else left.push(mail);
  }
  corresponding.filter((a) => !a.email).forEach((a, i) => { if (i < left.length) a.email = left[i]; });
  return cover;
}

const ascii = (text: string): string => text.normalize('NFKD').replace(/[^\x00-\x7f]/g, '');
const titleLike = (p: Para, levels: Map<Para, number>): boolean => levels.has(p) || boldShare(p) >= 0.6 || !!p.heading;

function authorLine(p: Para): boolean {
  const text = paraText(p);
  if (text.length > 400 || search(rx('@|\\bUniversity\\b|\\bDepartment\\b|\\bInstitute\\b'), text)) return false;
  const names = text.replace(/[*†‡§#+]/g, '').split(rx(',|\\band\\b|&|;')).filter((n) => strip(n));
  const capital = names.filter((n) => fullmatch(rx("\\s*(?:[A-Z][\\w.'’\\-]*\\s+){0,4}[A-Z][\\w'’\\-]+\\s*[\\w,*†‡]{0,4}\\s*"), n)).length;
  const sup = p.runs.some(isSuper);
  return names.length >= 1 && capital >= Math.max(1, 0.7 * names.length) && (names.length >= 2 || sup);
}

function affiliationLike(p: Para): boolean {
  const first = p.runs.find((r) => strip(r.text));
  return (!!first && isSuper(first)) || !!search(rx('\\b(?:Universit\\w*|Department|Dept\\.|Institut\\w*|Laborator\\w*|School|College|Cent(?:er|re)|Faculty|Hospital|Academy|Inc\\.|Ltd|GmbH|Street|Road|Avenue|Building|\\d{5})\\b'), paraText(p));
}

function markerAndText(runsIn: Run[]): [string, string] {
  const runs = runsIn.filter((r) => r.text);
  if (runs.length && isSuper(runs[0])) return [strip(runs[0].text, ' ,'), strip(runs.slice(1).map((r) => r.text).join(''), ' ,;')];
  const text = runs.map((r) => r.text).join('');
  const m = match(rx('^\\s*(?:([a-z]|\\d{1,2})\\s+|([*†‡§]{1,2})\\s*)(?=[A-Z])'), text);
  if (m) return [m.group(1) ?? m.group(2)!, strip(text.slice(m.end), ' ,;')];
  return ['', strip(text, ' ,;')];
}

/** "Alex Example^{a} and Blair Sample^{a,*}" → author rows (project.json form). */
function authorsOf(runs: Run[]): Author[] {
  const out: Author[] = [];
  let name = '', marks: string[] = [], star = false;
  const close = (): void => {
    const n = strip(name.replace(/\s+/g, ' '), ' ,;');
    if (n && /[A-Za-z]/.test(n)) out.push({ name: n, affiliations: marks.filter(Boolean), corresponding: star, email: '' });
    name = ''; marks = []; star = false;
  };
  for (const r of runs) {
    if (isSuper(r)) {
      for (let m of r.text.split(/[,\s]+/)) {
        if (!m) continue;
        if (m.includes('*')) star = true;
        m = m.replace(/[*†‡§#+]/g, '');
        if (m) marks.push(m);
      }
      continue;
    }
    for (const piece of r.text.split(rx('(,|\\band\\b|&|;)'))) {
      if (piece === undefined) continue;
      if ([',', 'and', '&', ';'].includes(piece)) close();
      else {
        if (piece.includes('*')) star = true;
        name += piece.replace(/[*†‡§#+]/g, '');
      }
    }
  }
  close();
  return out;
}

// ---------------------------------------------------------------------- the sections

const NOTE_TOC = 'The program makes its own table of contents, so this one is not imported.';
const NOTE_SPECTRA = 'The program prints the spectra in its own Spectra section, so this section is not imported (tick it to import its text anyway).';

/** Fill in plan.cover, plan.sections and plan.references. */
export function outline(plan: ImportPlan, bodySize: number): void {
  const seq = plan.sequence;
  const paras = seq.filter(([k]) => k === 'para').map(([, o]) => o as Para);
  const first = headingLevels(paras, bodySize);
  const [coverEnd, tocEndAt] = front(seq, first);
  // (worked out again after a heading's level changed: the cover page as changed in the review window stays, the same object)
  const oldCover = plan.cover as ImportedCover | null;
  plan.cover = null;
  if (coverEnd) {
    const cover = readCover(seq.slice(0, coverEnd).filter(([k]) => k === 'para').map(([, o]) => o as Para), first);
    if (cover.title || cover.authors.length) plan.cover = oldCover ?? cover;
  }
  // (the levels again without the cover and contents: their large type would count)
  const after = seq.slice(tocEndAt);
  const levels = headingLevels(after.filter(([k]) => k === 'para').map(([, o]) => o as Para), bodySize);
  for (const [k, o] of after) if (k === 'para' && levels.has(o as Para) && match(REFERENCES, stripNumber(paraText(o as Para)))) levels.set(o as Para, 1);   // (always a section)
  const overrides = plan.level_overrides;
  plan.headings = after.filter(([k, o]) => k === 'para' && (levels.has(o as Para) || overrides.has(o as Para))).map(([, o]) => o as Para);
  for (const [key, level] of overrides) { if (level) levels.set(key, level); else levels.delete(key); }   // (changed in the review window)
  plan.levels = levels;
  const oldSections = new Map<string, ImportedSection>();
  for (const s of plan.sections as ImportedSection[]) oldSections.set(identity(s, plan.sections as ImportedSection[]), s);
  const oldFigures = new Map<string, ImportedFigure[]>();
  for (const s of plan.sections as ImportedSection[]) for (const f of s.figures.values()) { const k = figureIdentity(f); oldFigures.set(k, [...(oldFigures.get(k) ?? []), f]); }
  const oldRefs = new Map<string, ReturnType<typeof readList>[number]>();
  for (const r of plan.references as ReturnType<typeof readList>) oldRefs.set(`${r.number}\u0000${r.text}`, r);
  const sections: ImportedSection[] = [];
  let counter = 0;
  const make = (kind: ImportedSection['kind'], name: string, kw: Partial<ImportedSection> = {}): ImportedSection => {
    counter++;
    const s: ImportedSection = { key: `x${counter}`, kind, name, heading: '', parent: '', text: '', figures: new Map(), compounds: [], gps: [], keep: true, note: '', ...kw };
    sections.push(s);
    return s;
  };
  if (tocEndAt > coverEnd) {
    const toc = seq.slice(coverEnd, tocEndAt).filter(([k]) => k === 'para').map(([, o]) => o as Para);
    make('toc', stripNumber(paraText(toc[0])) || 'Table of Contents', { heading: paraText(toc[0]), text: toc.slice(1).map(paraMarkup).join('\n'), keep: false, note: NOTE_TOC });
  }
  const chapters: [Para | null, SeqItem[]][] = [];
  let head: Para | null = null, items: SeqItem[] = [];
  for (const item of after) {
    if (item[0] === 'para' && levels.get(item[1]) === 1) {
      if (head || items.length) chapters.push([head, items]);
      head = item[1];
      items = [];
    } else items.push(item);
  }
  if (head || items.length) chapters.push([head, items]);
  const builder = new Builder(levels, make, plan);
  let generalDone = false;
  chapters.forEach(([h, its], n) => {
    const name = h ? stripNumber(paraText(h)) : '';
    const hasData = its.some(([k]) => k === 'compound' || k === 'gp');
    const texts = its.filter(([k]) => k === 'para').map(([, o]) => o as Para);
    if (!hasData && h && match(REFERENCES, name)) {
      plan.references = readList(texts.filter((p) => paraText(p) && !levels.has(p)).map(paraText)).map((r) => oldRefs.get(`${r.number}\u0000${r.text}`) ?? r);
      make('references', name, { heading: paraText(h), note: `${plan.references.length} reference(s), listed under References.` });
      return;
    }
    if (!hasData && h && search(SPECTRA, name)) {
      const s = make('spectra', name, { heading: paraText(h), keep: false, note: NOTE_SPECTRA });
      [s.text, s.figures] = builder.text(its, 1, true);
      return;
    }
    if (!hasData) {
      if (!h && !texts.some((p) => paraText(p) || p.objects.length)) return;
      const general = !generalDone && !!h && n <= 3 && !!match(GENERAL, name);
      generalDone = generalDone || general;
      const s = make(general ? 'general' : 'text', name || 'Other text', { heading: h ? paraText(h) : '', note: general ? "Goes to the front matter's General Information page." : '' });
      [s.text, s.figures] = builder.text(its, 1);
      return;
    }
    builder.dataChapter(h, name, its);
  });
  for (const s of sections) {       // (names and ticks changed in the review window are kept)
    const old = oldSections.get(identity(s, sections));
    if (old) { s.name = old.name; s.keep = old.keep; }
  }
  // (so are the figures' and tables' ticks and labels; a PDF figure cut out of the same part of its page keeps its picture)
  for (const s of sections) {
    for (const f of s.figures.values()) {
      const old = oldFigures.get(figureIdentity(f))?.shift();
      if (!old) continue;
      f.keep = old.keep;
      f.label = old.label;
      if (f.kind === 'cut' && old.data && f.top === old.top && f.bottom === old.bottom && String(f.below) === String(old.below)) {
        f.data = old.data; f.ext = old.ext; f.width_cm = old.width_cm; f.cut_below = old.cut_below;
      }
    }
  }
  plan.sections = sections;
}

/** What a section is, whatever its key: its kind, heading and the heading above it. */
function identity(s: ImportedSection, sections: ImportedSection[]): string {
  const parent = sections.find((p) => p.key === s.parent);
  return [s.kind, s.heading, parent ? parent.heading : '', !s.heading ? s.name : ''].join('\u0000');
}

/** What a figure or table is, whatever its key and its label (which can be changed): its kind, page, caption and picture. Those alike are told apart by their order. */
const pictureIds = new WeakMap<Uint8Array, number>();
let pictureCount = 0;
function figureIdentity(f: ImportedFigure): string {
  let pic = 0;
  if (f.kind !== 'cut' && f.data) { pic = pictureIds.get(f.data) ?? ++pictureCount; pictureIds.set(f.data, pic); }
  return [f.kind, f.page, f.caption, pic, f.kind === 'table' ? JSON.stringify(f.table?.rows ?? null) : ''].join('\u0000');
}

const captionMarker = (label: string, caption: string): string => `\u0000${label}\u0000${caption}`;
export const isTableLabel = (label: string): boolean => !!search(rx('\\bTable\\b'), label);

export function captionText(line: string): string {
  if (!line.startsWith('\u0000')) return line;
  const [, label, ...rest] = line.split('\u0000');
  return strip(`**${label}.** ${rest.join('\u0000')}`);
}

const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Text, figures and Data sections from a run of the SI's items. */
class Builder {
  nFig = 0;
  constructor(readonly levels: Map<Para, number>, readonly make: (kind: ImportedSection['kind'], name: string, kw?: Partial<ImportedSection>) => ImportedSection, readonly plan: ImportPlan) {}

  /** [markup, figures] of the paragraphs among `items`: headings below level `base` as "# "/"## " lines, pictures and tables as figure/table lines. */
  text(items: SeqItem[], base: number, spectra = false): [string, Map<string, ImportedFigure>] {
    const lines: string[] = [];
    const figures = new Map<string, ImportedFigure>();
    const paras = items.filter(([k]) => k === 'para').map(([, o]) => o as Para);
    const where = new Map<Para, number>();
    items.forEach(([k, o], i) => { if (k === 'para') where.set(o as Para, i); });
    let pending: [string, string] | null = null;      // [label, caption] waiting for a figure
    let i = 0;
    while (i < paras.length) {
      const p = paras[i];
      if (p.cell) {                    // a Word table
        const cells: Para[] = [];
        while (i < paras.length && paras[i].cell && paras[i].cell![0] === p.cell[0]) { cells.push(paras[i]); i++; }
        const fig = this.figure('table', figures, { table: tableOf(cells) });
        if (pending && isTableLabel(pending[0])) {   // (its caption, above it)
          [fig.label, fig.caption] = pending;
          const marker = captionMarker(...pending);
          const at = lines.indexOf(marker);
          if (at >= 0) lines.splice(at, 1);
          pending = null;
        }
        const notes: string[] = [];
        while (i < paras.length && footnote(paras[i])) { notes.push(paraMarkup(paras[i])); i++; }
        if (fig.table) fig.table.footnotes = notes;
        lines.push(rstrip(`!table{${fig.key}} ${fig.caption}`));
        continue;
      }
      i++;
      const text = paraText(p);
      const m = text ? match(CAPTION, text) : null;
      if (m) {
        const label = m.group('label')!;
        const caption = restMarkup(p, m.group('rest') ?? '');
        if (p.page) {                  // a PDF: cut out of the page later
          const fig = this.figure('cut', figures, { page: p.page, label, caption, is_table: isTableLabel(label) });
          if (fig.is_table) {
            fig.top = p.bottom;
            fig.bottom = p.bottom;
            while (i < paras.length && tableRow(paras[i], this.levels) && paras[i].page === p.page) { fig.bottom = paras[i].bottom; i++; }
          } else {
            fig.bottom = p.top;
            const [top, labels] = topAbove(items, where.get(p)!, this.levels);
            fig.top = top;
            while (lines.length && labels.has(lines[lines.length - 1])) lines.pop();   // (drawn in the figure)
            const [below, belowLabels] = topBelow(items, where.get(p)!, this.levels);
            fig.below_labels = belowLabels;
            fig.below = [p.bottom, below];
          }
          lines.push(rstrip(`!figure{${fig.key}} ${caption}`));
          continue;
        }
        const last = lines.length ? lines[lines.length - 1] : '';
        const target = match(rx('!(figure|table)\\{(\\w+)\\}$'), strip(last));
        if (target && !isTableLabel(label) && target.group(1) === 'figure') {
          const fig = figures.get(target.group(2)!)!;
          fig.label = label;
          fig.caption = caption;
          lines[lines.length - 1] = rstrip(`!figure{${fig.key}} ${caption}`);
          continue;
        }
        pending = [label, caption];
        lines.push(captionMarker(label, caption));
        continue;
      }
      const level = this.levels.get(p);
      if (level) {
        let runs = p.runs;
        const number = text.length - lstrip(stripNumber(text)).length;
        if (number && stripNumber(text) !== strip(text, ' :')) {   // ("1.1 Solvents" → "Solvents")
          const after = splitRuns(runs, number)[1];
          runs = after.length ? after : runs;
        }
        const plain: Run[] = runs.filter((r) => r.text).map((r) => ({ ...r, bold: false }));   // (a heading prints in its own style)
        if (plain.length) {
          const lastRun = plain[plain.length - 1];
          plain[plain.length - 1] = { ...lastRun, text: rstrip(rstrip(rstrip(lastRun.text), ':')), bold: false };
        }
        lines.push('#'.repeat(Math.max(1, Math.min(2, level - base))) + ' ' + writeMarkup([{ runs: plain.filter((r) => r.text) }]).trim());
      } else if (text) lines.push(paraMarkup(p));
      for (const o of p.objects) {
        if (o.kind === 'mnova' || !o.picture || !o.picture.length) continue;   // (spectra are imported on their own)
        if (spectra && o.kind !== 'picture') continue;
        const ext = pictureExt(o.picture_name, o.picture);
        const fig = this.figure(o.kind === 'picture' && ext !== '.emf' && ext !== '.wmf' ? 'picture' : 'object', figures, { data: o.picture, ext });
        if (o.width_in) fig.width_cm = r2(o.width_in * 2.54);
        if (pending && !isTableLabel(pending[0])) {
          [fig.label, fig.caption] = pending;
          pending = null;
          // (the caption came first: its line becomes the figure's)
          for (let k = lines.length - 1; k >= 0; k--) if (lines[k] === captionMarker(fig.label, fig.caption)) { lines.splice(k, 1); break; }
        }
        lines.push(rstrip(`!figure{${fig.key}} ${fig.caption}`));
      }
    }
    // captions that found no figure stay as text
    return [strip(lines.map(captionText).join('\n'), '\n'), figures];
  }

  private figure(kind: string, figures: Map<string, ImportedFigure>, kw: Partial<ImportedFigure>): ImportedFigure {
    this.nFig++;
    const key = `${kind === 'table' ? 'tab' : 'fig'}${this.nFig}`;
    const fig: ImportedFigure = {
      key, kind, data: null, ext: '', caption: '', label: '', table: null, page: 0, top: 0, bottom: 0, is_table: false, keep: true,
      width_cm: null, below: null, below_labels: [], cut_below: false, ...kw,
    };
    figures.set(key, fig);
    return fig;
  }

  /** A level-1 section with compounds. */
  dataChapter(head: Para | null, nameIn: string, items: SeqItem[]): void {
    let parts: [Para | null, SeqItem[]][] = [[null, []]];
    for (const item of items) {
      if (item[0] === 'para' && this.levels.get(item[1]) === 2) parts.push([item[1], []]);
      else parts[parts.length - 1][1].push(item);
    }
    if (!parts[0][1].length) parts = parts.slice(1);
    const texty = parts.some(([, part]) => hasText(part, this.levels)) || parts.length > 1;
    const name = nameIn || this.plan.section_name || 'Synthesis and Characterization';
    const heading = head ? paraText(head) : '';
    if (!texty) { this.data(name, items, '', heading); return; }
    const parent = this.make('text', name, { heading });
    // General procedures in a part without compounds go with the next part's (or, at the end, the last part's) compounds.
    let gpsWaiting: SeqItem[] = [];
    parts = parts.map(([h, part]) => {
      if (!part.some(([k]) => k === 'compound')) {
        gpsWaiting.push(...part.filter(([k]) => k === 'gp'));
        return [h, part.filter(([k]) => k !== 'gp')];
      }
      if (gpsWaiting.length) { const out: [Para | null, SeqItem[]] = [h, [...gpsWaiting, ...part]]; gpsWaiting = []; return out; }
      return [h, part];
    });
    let onlyGps: SeqItem[] = [];
    if (gpsWaiting.length) {
      let k = parts.length - 1;
      for (; k >= 0; k--) {
        if (parts[k][1].some(([kind]) => kind === 'compound')) { parts[k] = [parts[k][0], [...parts[k][1], ...gpsWaiting]]; break; }
      }
      if (k < 0) onlyGps = gpsWaiting;      // (procedures, no compounds: a section of them)
    }
    for (const [h, part] of parts) {
      const data = part.some(([k]) => k === 'compound' || k === 'gp');
      if (!h) {
        [parent.text, parent.figures] = this.text(part, 1);
        if (data) this.data('Compounds', part, parent.key);
        continue;
      }
      const subName = stripNumber(paraText(h));
      if (!data) {
        const s = this.make('text', subName, { heading: paraText(h), parent: parent.key });
        [s.text, s.figures] = this.text(part, 2);
      } else if (hasText(part, this.levels)) {
        const s = this.make('text', subName, { heading: paraText(h), parent: parent.key });
        [s.text, s.figures] = this.text(part, 2);
        this.data('Compounds', part, s.key);
      } else this.data(subName, part, parent.key, paraText(h));
    }
    if (onlyGps.length) this.data('General Procedures', onlyGps, parent.key);
  }

  private data(name: string, items: SeqItem[], parent: string, heading = ''): ImportedSection {
    const s = this.make('data', name, { heading, parent });
    s.compounds = items.filter(([k]) => k === 'compound').map(([, o]) => o as ImportedCompound);
    s.gps = items.filter(([k]) => k === 'gp').map(([, o]) => o as ImportedGP);
    return s;
  }
}

/** [where a PDF figure above its caption items[k] starts, the figure's own labels]. */
function topAbove(items: SeqItem[], k: number, levels: Map<Para, number>): [number, Set<string>] {
  const cap = items[k][1] as Para;
  const labels = new Set<string>();
  for (let j = k - 1; j >= 0; j--) {
    const [kind, q] = items[j];
    if (kind !== 'para') {
      const [page, bottom] = (q as ImportedCompound | ImportedGP).end ?? [0, 0];
      if (page === cap.page && bottom) return [bottom + 4, labels];
      if (page && page !== cap.page) break;
      continue;
    }
    if (q.page !== cap.page) break;
    if (levels.get(q) || paraText(q).length >= 90 || match(CAPTION, paraText(q))) return [q.bottom + 4, labels];
    labels.add(paraMarkup(q));
  }
  return [0, labels];                  // (from the top of the page's text)
}

/** [where the next text under a PDF caption items[k] starts on its page — 0: none; -1: unknown —, the short lines between]. */
function topBelow(items: SeqItem[], k: number, levels: Map<Para, number>): [number, string[]] {
  const cap = items[k][1] as Para;
  const labels: string[] = [];
  for (const [kind, q] of items.slice(k + 1)) {
    if (kind === 'para') {
      if (q.page !== cap.page) return [0, labels];
      if (levels.get(q) || paraText(q).length >= 90 || match(CAPTION, paraText(q))) return [q.top, labels];
      labels.push(paraMarkup(q));
      continue;
    }
    const geometry = kind === 'compound' ? q.geometry : null;    // (a compound: above its heading)
    if (geometry && geometry[0] === cap.page) return [Math.max(cap.bottom, geometry[1] - 16), labels];
    return [(q.end ?? [0, 0])[0] === cap.page ? -1 : 0, labels];
  }
  return [0, labels];
}

function hasText(items: SeqItem[], _levels: Map<Para, number>): boolean {
  return items.some(([k, o]) => k === 'para' && (paraText(o) || o.objects.some((x) => x.kind !== 'mnova' && x.picture && x.picture.length) || o.cell !== null));
}

function restMarkup(p: Para, rest: string): string {
  const cut = paraText(p).length - rest.length;
  const after = splitRuns(p.runs, cut)[1];
  return after.length ? writeMarkup([{ runs: after }]).trim() : '';
}

function footnote(p: Para): boolean {
  const first = p.runs.find((r) => strip(r.text));
  const text = paraText(p);
  return (!!first && isSuper(first) && text.length < 400) || (!!match(rx('^[a-h]\\s[A-Z]'), text) && text.length < 300);
}

/** A PDF paragraph that is part of a table under its caption: not a heading, not a caption, not prose. */
function tableRow(p: Para, levels: Map<Para, number>): boolean {
  const text = paraText(p);
  if (levels.get(p) || match(CAPTION, text)) return false;
  if (footnote(p) || p.columnar) return true;
  const words = text.split(/\s+/).filter(Boolean);
  const letters = words.filter((w) => fullmatch(rx('[A-Za-z][a-z]+[,.;:]?'), w)).length;
  const prose = text.length >= 150 && rstrip(text).endsWith('.') && letters >= 0.6 * Math.max(1, words.length);
  return !prose;
}

export function pictureExt(name: string, data: Uint8Array): string {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  if (ext === '.jpeg') return '.jpg';
  if (ext) return ext;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return '.png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return '.jpg';
  if (data[40] === 0x20 && data[41] === 0x45 && data[42] === 0x4d && data[43] === 0x46) return '.emf';
  return '.png';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cell = { text: string; colspan?: number; rowspan?: number } | null;

/** A Word table's cells (paragraphs with .cell) as a table (tables.json form). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tableOf(cells: Para[]): any {
  const byPos = new Map<string, { r: number; c: number; texts: string[]; span: number; merge: string; bold: boolean }>();
  for (const p of cells) {
    const [, r, c, span, merge] = p.cell!;
    const key = `${r},${c}`;
    let cell = byPos.get(key);
    if (!cell) { cell = { r, c, texts: [], span, merge, bold: true }; byPos.set(key, cell); }
    if (paraText(p)) {
      cell.texts.push(paraMarkup(p));
      cell.bold = cell.bold && boldShare(p) > 0.9;
    }
  }
  if (!byPos.size) return {};
  const all = [...byPos.values()];
  const nRows = Math.max(...all.map((v) => v.r)) + 1;
  const nCols = Math.max(...all.map((v) => v.c + v.span));
  const rows: Cell[][] = Array.from({ length: nRows }, () => Array.from({ length: nCols }, () => ({ text: '' })));
  for (const v of all.sort((a, b) => a.r - b.r || a.c - b.c)) {
    const { r, c } = v;
    if (v.merge === 'continue') {
      rows[r][c] = null;
      let k = r - 1;                 // (the cell this one is merged into)
      while (k >= 0 && rows[k][c] === null) k--;
      if (k >= 0 && rows[k][c]) rows[k][c]!.rowspan = (rows[k][c]!.rowspan ?? 1) + 1;
    } else {
      rows[r][c] = { text: v.texts.join(' ') };
      if (v.span > 1) rows[r][c]!.colspan = v.span;
    }
    for (let extra = 1; extra < v.span; extra++) if (c + extra < nCols) rows[r][c + extra] = null;
  }
  const header = nRows > 1 && all.filter((v) => v.r === 0).every((v) => v.bold && v.texts.length) ? 1 : 0;
  return { header_rows: header, columns: Array(nCols).fill('center'), rows, footnotes: [] };
}

