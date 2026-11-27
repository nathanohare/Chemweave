// Recognising an SI's general procedures and compounds for Import SI (Chem SI Assistant's
// core/si_import.py, SPEC §13u.3).
//
// `analyse(paras)` takes the paragraphs read by si-import-read.ts and returns an ImportPlan: the
// general procedures, the compounds with their values sorted into the program's fields, the other
// text, and warnings. Nothing is written here; the review window shows the plan and
// si-import-apply.ts writes what the user keeps.
//
// Everything is best effort, and nothing is dropped: a compound's text that is neither its
// procedure nor a recognized value is kept as `unrecognised` (stored in its private Notes), and
// text outside the compounds and procedures is kept as `other`. Values are kept as printed
// (significant figures, dashes) so that the SI prints them as before; only spacing is evened out.

import { parseMarkup, type Run } from './markup';
import { newId } from './ids';
import * as chem from './chem';
import { PURIFICATION_START, purificationTextOf } from './procedures';
import { boldShare, cleanSpace, mergeRuns, newPara, paraMarkup, paraText, R, runsMarkup, type DocObject, type Para } from './si-import-read';
import { outline } from './si-import-text';
import { finditer, fullmatch, isAlnum, isLower, isUpper, lstrip, match, matchingBlocks, rstrip, rx, search, split, strip, sub } from './py';
import { charBefore } from '../regex-behind';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Values = Record<string, any>;

export interface ImportedGP {
  key: string;            // an internal key ("gp1", …)
  name: string;           // "General Procedure A"
  title: string;          // "Reduction of aryl methyl ketones"
  text: string;           // its text (markup)
  label: string;          // "A", "1", … ("" when it has none)
  sentence: string;       // the compound sentence worked out from its compounds
  original: string;       // as printed (plain), for the review window
  keep: boolean;
  end: [number, number];  // PDF: [page, bottom in pt] where its text ends
}

export interface ImportedCompound {
  cid: string;            // the compound's ID as printed ("2a")
  name: string;           // its name (plain)
  procedure: string;      // its experimental procedure (markup)
  values: Values;         // field key -> value, as compound.json
  unrecognised: string[];
  original: string;       // its whole text as printed (markup), heading excluded
  page: number;
  gp_key: string;         // the general procedure it cites ("" if none)
  gp_values: Record<string, string>;
  gp_sentence: string;    // the sentence citing the GP, as printed (markup)
  cites: string[];        // citation numbers
  hrms_calcd: string;     // the calculated m/z as printed (checked, not stored)
  warnings: string[];
  keep: boolean;
  /** Its structure (SPEC §13u.7): a MOL block, how it was found, the ChemDraw picture (EMF) when the drawing shows just this structure. */
  structure: string;
  structure_note: string;
  structure_picture: Uint8Array | null;
  use_structure: boolean;
  /** From a PDF: [heading's page, heading's bottom, text's page, text's top] (pt), and the structure cut out of the page (a picture: `picture_ext`, ".pdf" when not given). */
  geometry: [number, number, number, number] | null;
  picture_pdf: Uint8Array | null;
  picture_ext?: string;
  end: [number, number];
}

export const newCompound = (cid: string, name: string, extra: Partial<ImportedCompound> = {}): ImportedCompound => ({
  cid, name, procedure: '', values: {}, unrecognised: [], original: '', page: 0, gp_key: '', gp_values: {}, gp_sentence: '', cites: [], hrms_calcd: '',
  warnings: [], keep: true, structure: '', structure_note: '', structure_picture: null, use_structure: true, geometry: null, picture_pdf: null, end: [0, 0], ...extra,
});

export type SeqItem = ['para', Para] | ['gp', ImportedGP] | ['compound', ImportedCompound];

export interface ImportPlan {
  gps: ImportedGP[];
  compounds: ImportedCompound[];
  other: Para[];
  section_name: string;   // the heading above the compounds ("Synthesis and …")
  warnings: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  spectra: any[];
  /** Everything in reading order. */
  sequence: SeqItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sections: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  references: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cover: any;
  body_size: number;
  headings: Para[];
  levels: Map<Para, number>;
  level_overrides: Map<Para, number>;
  /** The SI's embedded objects (Word), and each compound's own ones (in plan order), for structures and spectra. */
  objects: DocObject[];
  own_objects: DocObject[][];
}

export const newPlan = (): ImportPlan => ({
  gps: [], compounds: [], other: [], section_name: '', warnings: [], spectra: [], sequence: [], sections: [], references: [], cover: null,
  body_size: 0, headings: [], levels: new Map(), level_overrides: new Map(), objects: [], own_objects: [],
});

// ---------------------------------------------------------------------- headings

// A compound ID as printed: 2a, 3b′, 10aa, S12, SI-3, 3a-DA, int-4b (with an optional "rac-"/"(S)-"… before it, not part of the ID).
export const ID = "(?:[A-Z]{1,4}-?|[a-z]{2,4}-)?\\d{1,3}[a-z]{0,3}[′'″‴]*(?:-[A-Z][A-Za-z]{0,3})?";
export const STEREO = '(?:\\((?:[RSEZ](?:,\\s*[RSEZ])*|rac|ent|±|[+−-])\\)-|rac-|ent-|\\(±\\)-)?';
const HEAD = rx(`^(?P<name>.*?\\S)\\s*\\(\\s*(?P<stereo>${STEREO})(?P<id>${ID})\\s*\\)\\s*[.:]?\\s*$`);
const COMPOUND_WORD = rx(`^(?:Compound|Product)\\s+(?P<id>${ID})\\s*[.:]?\\s*$`, 'i');
const RUN_IN = rx(`^(?P<name>[^.]{3,250}?)\\s*\\(\\s*(?P<stereo>${STEREO})(?P<id>${ID})\\s*\\)\\s*[.:]\\s+(?P<rest>\\S.*)$`, 's');
// Words that make a heading a sentence rather than a compound's name.
const NOT_NAME = rx('\\b(?:was|were|is|are|the|to|from|with|by|using|according|following|prepared|obtained|afforded|gave|yield|synthesis|general|procedure|see|table|scheme|figure)\\b', 'i');
const GP = rx('^(?:(?:\\d+(?:\\.\\d+)*|S\\d+|[IVX]+)\\.?\\s+)?(?P<head>(?i:general|typical|representative)\\s+(?i:experimental\\s+)?(?i:procedures?)|GP)(?P<rest>.*)$', 's');
const GP_LABEL = rx('^\\s*[-–—]?\\s*\\(?(?P<label>[A-Z]{1,2}|\\d{1,2}|[IVX]{1,4})\\)?(?=[\\s:.,)–—-]|$)');
const GP_LABEL_INSIDE = rx('\\((?:GP|General\\s+Procedure)\\s*[-–]?\\s*(?P<label>[A-Z]{1,2}|\\d{1,2}|[IVX]{1,4})\\)', 'i');
const LEADERS = rx('(?:\\.\\s?){5,}|…{2,}');   // a table of contents' dot leaders
const CAPTION = rx('^(?:Scheme|Figure|Fig\\.|Table|Chart)\\s+S?\\d+[A-Za-z]?\\b');

/** A compound's name rather than a sentence or a heading. */
export function looksLikeName(text: string): boolean {
  return text.length > 2 && text.length <= 300 && [...text].some((c) => /\p{L}/u.test(c)) && !search(NOT_NAME, text) && !text.includes('. ');
}

/** [name, ID] of a paragraph that is a compound's heading ("1-Phenylethan-1-ol (2a)." → ["1-Phenylethan-1-ol", "2a"]; "Compound 3b" → ["", "3b"]). */
export function compoundHeading(textIn: string): [string, string] | null {
  const text = cleanSpace(textIn);
  let m = match(COMPOUND_WORD, text);
  if (m) return ['', m.group('id')!];
  m = match(HEAD, text);
  if (m && looksLikeName(m.group('name')!)) return [rstrip(m.group('name')!, ' ,:'), m.group('id')!];
  return null;
}

/** [label, title] of a general procedure's heading ("" when it has no label/title). */
export function gpHeading(textIn: string): [string, string] | null {
  const text = cleanSpace(textIn);
  const m = match(GP, text);
  if (!m) return null;
  let rest = m.group('rest') ?? '';
  let label = '';
  const lm = match(GP_LABEL, rest);
  if (lm && !match(rx('\\s*(?:for|of)\\b', 'i'), rest)) {
    label = lm.group('label')!;
    rest = rest.slice(lm.end);
  }
  const inside = search(GP_LABEL_INSIDE, rest);
  if (inside) {
    label = label || inside.group('label')!.toUpperCase();
    rest = rest.slice(0, inside.index) + rest.slice(inside.end);
  }
  let title = strip(rest, ' :.,–—-');
  title = sub(rx('^(?:for|of)\\s+(?:the\\s+)?', 'i'), '', title);
  if (title) title = title[0].toUpperCase() + title.slice(1);
  if (search(rx('\\b(?:was|were|is|are|followed|used)\\b', 'i'), title)) return null;   // a sentence about a GP
  return [label, title];
}

export function isSectionHeading(p: Para, bodySize: number): boolean {
  if (p.heading) return true;
  const text = paraText(p);
  if (!text || text.length > 120) return false;
  if (!/[A-Za-z]{3}/.test(text)) return false;      // (e.g. a scheme's labels "2e 3")
  if (p.size && p.size > bodySize + 0.9 && text.length < 120) return true;
  if (boldShare(p) < 0.9 || text.endsWith(',') || text.endsWith(';')) return false;
  // a value's label standing alone ("Enantiomeric Excess:", "HRMS (ESI):"): it belongs to the compound
  const own = itemSpans(text).slice(0, 1);
  return !(own.length && own[0][1] === 0 && rstrip(text).endsWith(':'));
}

/** [the bold runs at the start, the rest]. */
function boldPrefix(runs: Run[]): [Run[], Run[]] {
  const head: Run[] = [];
  let i = 0;
  while (i < runs.length && (runs[i].bold || !strip(runs[i].text))) { head.push(runs[i]); i++; }
  while (head.length && !strip(head[head.length - 1].text)) { i--; head.pop(); }   // (spaces after the bold part: the rest's)
  return [head, runs.slice(i)];
}

const plainOf = (runs: Run[]): string => cleanSpace(runs.map((r) => r.text).join(''));

function stripLeading(runs: Run[], chars: string): Run[] {
  const out = [...runs];
  while (out.length) {
    const t = lstrip(out[0].text, chars);
    if (t) { out[0] = R(t, !!out[0].bold, !!out[0].italic, out[0].valign ?? 'normal', !!out[0].underline); break; }
    out.shift();
  }
  return out;
}

// ---------------------------------------------------------------------- data values

// What a pattern may not follow (Python's lookbehinds), checked in code: old WebKit has none.
const notFollowing = (chars: RegExp) => (m: RegExpExecArray, t: string): boolean => m.index === 0 || !chars.test(charBefore(t, m.index));
// (\w as rx() reads it: Unicode letters and digits)
const WORD = /[\p{L}\p{N}_]/u, WORD_POINT = /[\p{L}\p{N}_.]/u;

export const NMR_HEAD = rx('(?:(?P<mass>\\d{1,3})\\s*(?P<el>[A-Z][a-z]?)|(?P<el2>[A-Z][a-z]?)-(?P<mass2>\\d{1,3}))(?:\\s*\\{\\s*\\d{1,3}\\s*[A-Z][a-z]?\\s*\\})?\\s*-?\\s*NMR\\b', '', notFollowing(/[\p{L}\p{N}_{]/u));
export const KEYS: [string, RegExp][] = [
  ['nmr', NMR_HEAD],
  ['hrms', rx('\\b(?:HRMS|HR-?MS|HR\\s?-?(?:ESI|EI|APCI|CI|FAB|MALDI)\\s?-?(?:TOF\\s?-?)?MS|(?:ESI|EI|APCI)-?HRMS)\\b')],
  ['ir', rx('\\b(?:FT-?)?IR\\b(?=\\s*[(:ν=]|\\s*\\(|\\s+\\d|\\s*ν)')],
  ['rf', rx('\\bR\\s?f\\b(?=\\s*[=:(]|\\s+\\d|\\s*\\()')],
  ['mp', rx('(?:m\\.\\s?p\\.|mp|Mp|M\\.p\\.|[Mm]elting\\s+point)(?=\\s*[=:(]|\\s+\\d|\\s*[–-])', '', notFollowing(WORD_POINT))],
  ['rotation', rx('\\[\\s*[αa]\\s*\\]')],
  ['ea', rx('\\b(?:Anal\\.|Elemental\\s+analysis|Anal\\s+[Cc]alcd)')],
  ['ee', rx('\\b[Ee]nantiomeric\\s+(?:[Ee]xcess|[Rr]atio)\\b|\\b(?:HPLC|SFC|chiral\\s+GC|GC)\\b(?=\\s*[(:]|\\s+analysis)|\\d+(?:\\.\\d+)?\\s*%\\s*ee\\b|\\b(?:ee|er|e\\.r\\.)\\s*[=:]', '',
    // (a percentage ee does not go on from a word or a point)
    (m, t) => !/^\d/.test(m[0]) || notFollowing(WORD_POINT)(m, t), false)],
  ['yield', rx('\\b(?:[Ii]solated\\s+)?[Yy]ield\\s*:')],
  ['dr', rx('(?:d\\.\\s?r\\.|dr)(?=\\s*[=:>]|\\s+\\d|\\s*\\()', '', notFollowing(WORD))],
  ['xray', rx('\\bCCDC\\b')],
  ['references', rx('(?:[Ss]pectr(?:al|oscopic)\\s+data|[Tt]he\\s+(?:NMR\\s+)?data|[Aa]nalytical\\s+data|[Dd]ata)\\s+(?:\\w+\\s+){0,4}?(?:matched|match|were\\s+(?:consistent|in\\s+(?:good\\s+)?agreement)|(?:are|is)\\s+(?:consistent|in\\s+agreement)|agree|corresponded|correspond)')],
];
const KEY = new Map(KEYS);
const STATE_WORDS = 'oil|solid|liquid|powder|crystals?|foam|gum|wax|syrup|semi-?solid|needles|plates|prisms|glass|film|amorphous\\s+solid|crystalline\\s+solid|resin';
const STATE = rx(`^(?P<state>(?:[A-Za-z][\\w-]*\\s+){0,4}?(?:${STATE_WORDS}))\\b\\s*(?:\\((?P<inside>[^()]*(?:\\([^()]*\\)[^()]*)*)\\))?\\s*[.;,]?\\s*`, 'i');
// "… as a white to off-white crystalline solid", "… as a pale yellow oil/crystal"
const STATE_IN_TEXT = rx(`\\bas\\s+(?:an?\\s+)?(?P<state>(?:[A-Za-z][\\w-]*\\s+){0,5}?(?:${STATE_WORDS})(?:/(?:${STATE_WORDS}|crystal))?)\\b\\s*(?:\\((?P<inside>[^()]*)\\))?`, 'i');
const YIELD_WORD = rx('^(?:Yield|Isolated\\s+yield)\\b\\s*[:=]?\\s*(?P<inside>[\\d(].*?)[.;]?\\s*$', 'i');
const MASS = rx('(?P<v>\\d+(?:\\.\\d+)?)\\s*(?P<u>mg|g|µg|μg|kg)\\b');
const PERCENT = rx('(?P<sign>[>≥]\\s*)?(?P<v>\\d+(?:\\.\\d+)?)\\s*%(?!\\s*(?:ee|de|e\\.e\\.))');
const LABEL_BEFORE = rx("(?:^|[.;]\\s+)(?P<label>[A-Za-z][A-Za-z ,'′-]{1,40}):\\s*$");
const unitOf = (u: string): string => (u === 'μg' ? 'µg' : u);

export function nucleusOf(report: string): string {
  const m = search(NMR_HEAD, report);
  if (!m) return '';
  return m.group('mass') ? `${m.group('mass')}${m.group('el')}` : `${m.group('mass2')}${m.group('el2')}`;
}

function cleanState(textIn: string): string {
  const text = cleanSpace(textIn);
  // "Colorless oil" → "colorless oil"; a word in capitals (e.g. "IR") stays.
  if (text && isUpper(text[0]) && (text.length < 2 || !isUpper(text[1]))) return text[0].toLowerCase() + text.slice(1);
  return text;
}

/** Mass and yield from what a state's parentheses hold: "57.4 mg, 94%", "94% yield", "57 mg, 0.47 mmol, 94%". */
function insideValues(inside: string): Values {
  const out: Values = {};
  const m = search(MASS, inside);
  if (m) { out.mass = m.group('v'); out.mass_unit = unitOf(m.group('u')!); }
  const p = search(PERCENT, inside);
  if (p) {
    out.percent = strip(p.group('sign') ?? '') + p.group('v');
    const note = strip(sub(rx('^\\s*(?:yield\\b)?[\\s,;]*', 'i'), '', inside.slice(p.end)), ' ,;');
    if (note && !search(rx('\\b(?:ee|er|dr|d\\.r\\.)\\b|\\d+\\s*:\\s*\\d+', 'i'), note)) out.note = note;       // "(57.4 mg, 94% over two steps)"
  } else if (search(rx('\\bquant(?:\\.|itative)', 'i'), inside)) out.percent = 'quant.';
  return out;
}

/** The text inside the parentheses that open at `start` (nested ones kept), and the index after the closing one; ["", start] if there are none. */
function paren(text: string, start: number): [string, number] {
  if (start >= text.length || text[start] !== '(') return ['', start];
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return [text.slice(start + 1, i), i + 1]; }
  }
  return [text.slice(start + 1), text.length];
}

export const ADDUCT = rx('\\[\\s*\\d*\\s*M\\s*(?:[+\\-−–]\\s*\\d*\\s*[A-Z][A-Za-z0-9]*\\s*)*\\]\\s*(?:\\d?\\s*[+\\-−–•·]\\s*)+|\\bM\\s*[+\\-−–]\\s*(?:H|Na|K|NH4|Li)\\b|\\bM\\s*[+•·]');

/** "[M + H]+" → "[M+H]+", "[M−H]−" kept, "M+Na" → "[M+Na]+". */
export function adductText(raw: string): string {
  let t = raw.replace(/\s+/g, '').replaceAll('–', '−').replaceAll('·', '•');
  if (!t.startsWith('[')) {
    if (fullmatch(rx('M[+•]'), t)) return t === 'M+' ? '[M]+' : '[M]+•';
    t = `[${t}]+`;
  }
  t = sub(rx('\\](.*)$'), (m) => ']' + m.group(1)!.replaceAll('-', '−'), t);
  const close = t.indexOf(']');
  const inner = t.slice(1, close).replaceAll('−', '-');
  return '[' + inner.replaceAll('-', '−') + t.slice(close);
}

/** [{ionization, adduct, found}, the calculated m/z as printed, the ion's formula as printed] from an HRMS sentence. */
export function parseHrms(text: string): [Values, string, string] {
  const value: Values = {};
  const head = search(KEY.get('hrms')!, text);
  const rest = head ? text.slice(head.end) : text;
  const m = match(rx('\\s*\\((?P<ion>[^()]{1,30})\\)'), rest);
  if (m) value.ionization = strip(m.group('ion')!);
  else if (head) {
    const inline = search(rx('(ESI|EI|APCI|CI|FAB|MALDI|DART|APPI)'), head[0]);
    if (inline) value.ionization = inline.group(1);
  }
  const a = search(ADDUCT, text);
  if (a) value.adduct = adductText(a[0]);
  const found = search(rx('\\b(?:found|obsd\\.?|observed|measured)\\b\\s*(?:m/z)?\\s*[:=]?\\s*(?P<v>\\d+\\.\\d+)', 'i'), text);
  if (found) value.found = found.group('v');
  let calcd = '', formula = '';
  // "calcd for C10H11BrNaO2", "calculated for [C12H12N]+:", "calcd for (C9H12NO)+"
  const c = search(rx('\\bcalc(?:ulate)?d\\.?\\s*(?:mass\\s*)?(?:for\\s*)?(?P<f>[\\[(]?[A-Z][A-Za-z0-9]*[\\])]?\\s*[+\\-−]?)?', 'i'), text);
  if (c) {
    const f = (c.group('f') ?? '').replace(/[[\]()\s]/g, '');
    if (fullmatch(rx('(?:[A-Z][a-z]?\\d*)+[+\\-−]?'), f) && /\d/.test(f)) formula = f;
    const num = search(rx('\\d+\\.\\d{3,}'), text.slice(c.end));
    if (num) calcd = num[0];
  }
  return [value, calcd, formula];
}

const positive = (c: chem.Counts): chem.Counts => new Map([...c].filter(([, n]) => n > 0));

/** The neutral M formula from the ion formula printed with "calcd for": the adduct taken off. "" when it can't be told. */
export function mFormula(ionFormula: string, adduct: string, calcd: string): string {
  if (!ionFormula || !adduct) return '';
  let counts: chem.Counts, add: chem.Adduct;
  try {
    counts = chem.parseFormula(rstrip(ionFormula, '+-−'));
    add = chem.parseAdduct(adduct);
  } catch { return ''; }
  const t = calcd ? Number(calcd) : NaN;
  const target = calcd && Number.isFinite(t) && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(calcd) ? t : null;
  const candidates: chem.Counts[] = [];
  const stripped = new Map(counts);
  let ok = true;
  for (const [el, n] of add.delta) {
    stripped.set(el, (stripped.get(el) ?? 0) - n);
    if (stripped.get(el)! < 0) ok = false;
  }
  // [2M+Na]⁺: what is left is two M, so each count is halved (a count that doesn't divide means
  // the printed formula isn't this ion's)
  if (ok && add.multimer > 1) {
    for (const [el, n] of stripped) {
      if (n % add.multimer) { ok = false; break; }
      stripped.set(el, n / add.multimer);
    }
  }
  if (ok) candidates.push(positive(stripped));
  candidates.push(positive(counts));     // the printed formula is M's already
  for (const cand of candidates) {
    let mzs: number[];
    try {
      const info = chem.infoFromCounts(cand);
      // (the printed value may be for an isotope peak, e.g. the ⁸¹Br one)
      mzs = [chem.ionMz(info, adduct).mz, ...chem.isotopePattern(info, adduct, 20.0).map((pk) => pk.mz)];
    } catch { continue; }
    if (target === null || mzs.some((mz) => Math.abs(mz - target) < 0.003)) return chem.hillFormula(cand);
  }
  return '';
}

export function parseIr(text: string): Values {
  const head = search(KEY.get('ir')!, text);
  let rest = head ? text.slice(head.end) : text;
  const value: Values = {};
  const [inside, end] = paren(lstrip(rest), 0);
  if (inside && inside.length < 25 && !/\d{3}/.test(inside)) {
    value.method = strip(inside);
    rest = lstrip(rest).slice(end);
  }
  rest = sub(rx('^\\s*[:=]?\\s*(?:ν|v|nu)?\\s*(?:_?\\{?max\\}?)?\\s*[:=]?\\s*'), '', rest);
  rest = sub(rx('\\s*\\(?\\s*cm\\s*[-−–]?\\s*[¹1]\\s*\\)?\\s*[.;,]?\\s*$'), '', rest);
  rest = strip(sub(rx('\\s*cm\\s*[-−–]\\s*1'), '', rest), ' .;:');
  if (/\d{3}/.test(rest)) value.bands = rest;
  return value;
}

const STAINS = rx('^(?:UV.*|KMnO.*|CAM|PMA|p-?anisaldehyde|anisaldehyde|vanillin|ninhydrin|I2|iodine|phosphomolybdic.*|ceric.*|Dragendorff.*|.*\\bstain)$', 'i');

export function parseRf(text: string): Values {
  const m = search(rx('R\\s?f\\s*(?:value)?\\s*[=:]?\\s*(?P<v>\\d?\\.\\d+|\\d(?:\\.\\d+)?)'), text);
  if (!m) return {};
  const value: Values = { value: m.group('v') };
  const after = lstrip(text.slice(m.end));
  const [inside, end] = paren(after, 0);
  let vis: string[] = [];
  if (inside) {
    const parts = split(rx(',\\s*'), inside).map((p) => strip(p));
    vis = parts.filter((p) => match(STAINS, p));
    const eluent = parts.filter((p) => !vis.includes(p));
    if (eluent.length) value.eluent = eluent.join(', ');
  }
  // the stains may follow the parentheses: "(100% Et2O), UV – 254 nm, KMnO4 stain"
  const tail = inside ? strip(after.slice(end), ' ,;.') : '';
  if (tail) {
    const more = split(rx(',\\s*'), tail).map((p) => strip(p));
    if (more.every((p) => match(STAINS, p))) vis = [...vis, ...more];
  }
  if (vis.length) value.visualization = vis.join(', ');
  return value;
}

const STEPS = rx('^\\s*(?:over|in|for)\\s+(?:\\w+|\\d+)\\s+steps?\\b', 'i');
const QUALIFIED = rx('\\b(?:ee|er|dr|d\\.r\\.)\\b|\\d+\\s*:\\s*\\d+', 'i');

/** What qualifies a yield (the Yield field's note): [note, start, end] in `text`; ["", 0, 0] if none. */
function yieldNote(text: string, percent: { index: number; end: number }): [string, number, number] {
  const open = text.slice(0, percent.index).lastIndexOf('(');
  const close = text.indexOf(')', percent.end);
  if (open >= 0 && close >= 0 && !text.slice(open, percent.index).includes(')')) {
    const inside = text.slice(percent.end, close);
    const note = strip(sub(rx('^\\s*(?:yield\\b)?[\\s,;]*', 'i'), '', inside), ' ,;');
    if (note && !search(QUALIFIED, note)) return [note, percent.end, close];
    const m = match(STEPS, text.slice(close + 1));
    if (m) return [strip(m[0]), close + 1, close + 1 + m.end];
  }
  const m = match(STEPS, text.slice(percent.end));
  if (m) return [strip(m[0]), percent.end, percent.end + m.end];
  return ['', 0, 0];
}

/** From "Isolated Yield: 1.25 g (64%) as a pale-yellow crystalline solid.": the Yield field's value, the physical state, and whether there is more. */
export function parseYield(text: string): [Values, string, boolean] {
  const body = sub(rx('^\\s*(?:[Ii]solated\\s+)?[Yy]ield\\s*:\\s*'), '', text);
  const value: Values = {};
  let rest = body;
  const m = search(MASS, body);
  if (m) {
    value.mass = m.group('v'); value.mass_unit = unitOf(m.group('u')!);
    rest = rest.replace(m[0], ' ');
  }
  const p = search(PERCENT, rest);
  if (p) {
    value.percent = strip(p.group('sign') ?? '') + p.group('v');
    const [note, start, end] = yieldNote(rest, p);
    if (note) {
      value.note = note;
      rest = rest.slice(0, start) + ' ' + rest.slice(end);
    }
    rest = rest.replace(p[0], ' ');
  } else if (search(rx('\\bquant(?:\\.|itative)', 'i'), rest)) value.percent = 'quant.';
  let state = '';
  const s = search(STATE_IN_TEXT, rest);
  if (s) {
    state = s.group('state')!;
    rest = rest.slice(0, s.index) + ' ' + rest.slice(s.index + 'as'.length + 1).replace(state, ' ');
  }
  rest = sub(rx('\\b(?:an?|as|yield)\\b'), ' ', rest);
  return [value, state, /[A-Za-z]{3}/.test(rest)];
}

export function parseMp(text: string): Values {
  const m = search(rx('(?P<v>\\d+(?:\\.\\d+)?(?:\\s*[-–—]\\s*\\d+(?:\\.\\d+)?)?)\\s*°?\\s*C?'), text);
  if (!m) return {};
  const value: Values = { value: sub(rx('\\s*[-—]\\s*'), '–', m.group('v')!).replaceAll(' – ', '–') };
  const [inside] = paren(lstrip(text.slice(m.end), ' .,;'), 0);
  if (inside && !/\d/.test(inside)) value.solvent = strip(inside);
  return value;
}

export function parseRotation(text: string): Values {
  // (the temperature and line, "D20", "20D", "^{20}_{D}" or "D 20", then "=", ":", a space or the
  // sign before the value: "[α]D20 +12.3" is +12.3, not a temperature "D20 +12." and a value "3";
  // a temperature with decimals only before "=" or ":", "[α]D 22.5 = +10.2")
  const m = search(rx('\\[\\s*[αa]\\s*\\]\\s*(?P<a>[^=:\\s(]*)(?:\\s+(?P<b>[^=:\\s(+\\-−–\\d][^=:\\s(]*|\\d{1,3}(?:\\.\\d+)?(?=\\s*[=:])|\\d{1,3}(?![\\d.,])))?(?:\\s*[=:]\\s*|\\s+|(?=[+\\-−–]))(?P<v>[+\\-−–]?\\s*\\d+(?:\\.\\d+)?)'), text);
  if (!m) return {};
  const value: Values = { value: m.group('v')!.replaceAll(' ', '').replaceAll('−', '-').replaceAll('–', '-') };
  const temp = /\d+(?:\.\d+)?/.exec((m.group('a') ?? '') + (m.group('b') ?? ''));
  if (temp) value.temperature = temp[0];
  const [inside] = paren(lstrip(text.slice(m.end), ' ,'), 0);
  if (inside) {
    const cm = search(rx('\\bc\\s*[=:]?\\s*(?P<c>\\d+(?:\\.\\d+)?)'), inside);
    if (cm) value.c = cm.group('c');
    const parts = inside.split(',').map((p) => strip(p));
    const solvent = parts.filter((p) => p && !match(rx('c\\s*[=:]?\\s*\\d'), p) && !search(rx('g/(?:100\\s*)?mL'), p));
    if (solvent.length) value.solvent = solvent[solvent.length - 1];
  }
  return value;
}

export function parseEa(text: string): Values {
  const value: Values = {};
  const f = search(rx('calc(?:ulate)?d\\.?\\s*(?:for\\s*)?(?P<f>[A-Z][A-Za-z0-9·•.]*)\\s*[:;,]?', 'i'), text);
  if (f && /\d/.test(f.group('f')!)) value.formula = rstrip(f.group('f')!, ':;,.');
  const calcd = search(rx('calc(?:ulate)?d[^:]*?:?\\s*(?P<v>(?:[A-Z][a-z]?\\s*,?\\s*\\d+\\.\\d+\\s*[;,]?\\s*)+)', 'i'), text);
  const found = search(rx('found\\s*[:]?\\s*(?P<v>(?:[A-Z][a-z]?\\s*,?\\s*\\d+\\.\\d+\\s*[;,]?\\s*)+)', 'i'), text);
  if (calcd) value.calcd = strip(calcd.group('v')!, ' ;,.');
  if (found) value.found = strip(found.group('v')!, ' ;,.');
  return 'calcd' in value || 'found' in value ? value : {};
}

export function parseDr(text: string): Values {
  const m = search(rx('(?:d\\.\\s?r\\.|dr)\\s*[=:]?\\s*(?P<v>[>≥]?\\s*\\d+(?:\\.\\d+)?\\s*:\\s*\\d+(?:\\.\\d+)?)'), text);
  if (!m) return {};
  const value: Values = { value: m.group('v')!.replace(/\s+/g, '') };
  const [inside] = paren(lstrip(text.slice(m.end), ' ,'), 0);
  if (inside && !/\d+\s*:\s*\d+/.test(inside)) value.method = strip(inside);
  return value;
}

const COLUMN = rx('\\b(?:chiral(?:pak|cel)|lux|whelk|cyclobond|daicel|regis|phenomenex)[^,;.]*?(?:\\([^()]*\\))?(?=\\s*[,;.]\\s|\\s*$|\\s*,)', 'i');
const ELUENT = rx('\\d+(?:\\.\\d+)?\\s*%\\s*[A-Za-z][\\w-]*(?:\\s*(?:,|/|in)\\s*(?:\\d+(?:\\.\\d+)?\\s*%\\s*)?[nA-Za-z][\\w-]*)*');

/** ee or er with how it was measured. */
export function parseEe(text: string): Values {
  const value: Values = {};
  let m = search(rx('(?P<v>[>≥]?\\s*\\d+(?:\\.\\d+)?)\\s*%\\s*ee\\b'), text);
  if (m) value.value = m.group('v')!.replace(/\s+/g, '') + '% ee';
  else {
    m = search(rx('\\b(?:ee|er|e\\.r\\.)\\s*[=:]\\s*(?P<v>\\d+(?:\\.\\d+)?\\s*(?:%|:\\s*\\d+(?:\\.\\d+)?))'), text)
      ?? search(rx('enantiomeric\\s+(?:excess|ratio)\\b[^.;]*?(?:to\\s+be|=|:|of|was)\\s*(?P<v>[>≥]?\\s*\\d+(?:\\.\\d+)?\\s*(?:%|:\\s*\\d+(?:\\.\\d+)?))', 'i'), text);
    if (m) {
      const v = m.group('v')!.replace(/\s+/g, '');
      value.value = v.endsWith('%') ? `${v} ee` : `${v} er`;
    }
  }
  const method = search(rx('\\b(HPLC|SFC|GC)\\b'), text);
  if (method) value.method = method.group(1);
  const col = search(COLUMN, text);
  if (col) value.column = rstrip(cleanSpace(col[0]), ' ,;.');
  const elu = search(ELUENT, col ? text.slice(col.end) : text);
  if (elu && !fullmatch(rx('\\d+(?:\\.\\d+)?\\s*%\\s*ee'), elu[0])) value.eluent = strip(elu[0]);
  const flow = search(rx('(\\d+(?:\\.\\d+)?)\\s*mL\\s*/\\s*min'), text);
  if (flow) value.flow = flow.group(1);
  const nm = search(rx('(?:λ\\s*=?\\s*)?(\\d{3})\\s*nm\\b'), text);
  if (nm) value.wavelength = nm.group(1);
  const tmaj = search(rx('t\\s?_?\\{?R\\}?\\s*\\(?\\s*maj(?:or)?\\s*\\)?\\s*[=:]?\\s*(?P<v>\\d+(?:\\.\\d+)?)', 'i'), text)
    ?? search(rx('(?P<v>\\d+(?:\\.\\d+)?)\\s*min\\s*\\(\\s*maj', 'i'), text);
  const tmin = search(rx('t\\s?_?\\{?R\\}?\\s*\\(?\\s*min(?:or)?\\s*\\)?\\s*[=:]?\\s*(?P<v>\\d+(?:\\.\\d+)?)', 'i'), text)
    ?? search(rx('(?P<v>\\d+(?:\\.\\d+)?)\\s*min\\s*\\(\\s*min', 'i'), text);
  if (tmaj) value.t_major = tmaj.group('v');
  if (tmin) value.t_minor = tmin.group('v');
  return value.value || value.t_major ? value : {};
}

export function parseCcdc(text: string): Values {
  const m = search(rx('CCDC\\s*(?:No\\.?|number)?\\s*[:#]?\\s*(?P<v>\\d{6,8})'), text);
  return m ? { ccdc: m.group('v') } : {};
}

/** [the sentence without its citation numbers, the numbers]: "…literature.3,4" → ["…literature.", ["3", "4"]]. */
export function citations(textIn: string): [string, string[]] {
  let text = textIn;
  let cites: string[] = [];
  const numbers = (spec: string): string[] => {
    const out: string[] = [];
    for (const part of split(rx('\\s*,\\s*'), spec)) {
      const r = match(rx('(\\d+)\\s*[-–]\\s*(\\d+)$'), part);
      if (r && Number(r.group(2)) - Number(r.group(1)) < 50) for (let i = Number(r.group(1)); i <= Number(r.group(2)); i++) out.push(String(i));
      else if (/^\d+$/.test(part)) out.push(part);
    }
    return out;
  };
  const m = search(rx('(?:\\s*(?:\\[|\\()\\s*(?P<a>\\d+(?:\\s*[-–,]\\s*\\d+)*)\\s*(?:\\]|\\))|\\s?(?P<b>\\d+(?:\\s*[-–,]\\s*\\d+)*))\\s*\\.?\\s*$', '',
    (m, t) => m.groups!.b === undefined || /[a-z.)]$/.test(t.slice(0, m.index)), false), text);
  if (m) {
    cites = numbers(m.group('a') ?? m.group('b')!);
    text = rstrip(text.slice(0, m.index));
  }
  text = rstrip(text, ' ;,');
  if (text && !text.endsWith('.')) text += '.';
  return [text, cites];
}

// ---------------------------------------------------------------------- one compound

/** [kind, start, end] of every value in a data paragraph, in order. */
export function itemSpans(text: string): [string, number, number][] {
  const starts: [number, string][] = [];
  for (const [kind, pattern] of KEYS) for (const m of finditer(pattern, text)) starts.push([m.index, kind]);
  starts.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  // How deep in parentheses each character is: a value inside parentheses belongs to what they follow.
  let depth = 0;
  const depths: number[] = [];
  for (const ch of text) {      // (one entry per UTF-16 unit, as JS indexes strings)
    if (ch === '(') depth++;
    for (let k = 0; k < ch.length; k++) depths.push(depth);
    if (ch === ')' && depth > 0) depth--;
  }
  // one start per place; an "ee" start inside an HPLC description belongs to it
  const merged: [number, string][] = [];
  for (const [pos, kind] of starts) {
    if (depths[pos] > 0) continue;
    if (merged.length && pos - merged[merged.length - 1][0] < 3) continue;
    if (merged.length && kind === 'ee' && merged[merged.length - 1][1] === 'ee') continue;
    merged.push([pos, kind]);
  }
  return merged.map(([pos, kind], i) => [kind, pos, i + 1 < merged.length ? merged[i + 1][0] : text.length]);
}

const LABEL_START = rx("^[A-Z][A-Za-z ,'′-]{1,40}:\\s*");

/** Whether a paragraph is (mostly) characterisation data. */
export function isData(text: string): boolean {
  const own = itemSpans(text).slice(0, 1);
  if (own.length && own[0][1] === 0) return true;     // it starts with a value
  const body = sub(LABEL_START, '', text);              // "Major isomer: …"
  if ((match(STATE, body) && body.length < 400) || match(YIELD_WORD, body)) return true;
  const spans = itemSpans(body);
  if (!spans.length) return false;
  if (spans[0][1] <= 3) return true;
  const covered = spans.reduce((s, [, a, b]) => s + (b - a), 0);
  return covered > 0.6 * body.length;
}

/** Sort one data paragraph's values into the compound's fields (as printed); what is not recognized goes into `into.unrecognised`. */
export function parseData(textIn: string, into: ImportedCompound): void {
  const values = into.values;
  // (spaces a PDF puts inside parentheses: "7.47 ( d, J = 8.5 Hz, 2H )")
  const text = sub(rx('\\(\\s+'), '(', sub(rx('\\s+\\)'), ')', cleanSpace(textIn)));
  const spans = itemSpans(text);
  const prefix = spans.length ? text.slice(0, spans[0][1]) : text;
  let labelNext = '';
  // The text before the first value: a physical state with mass and yield, a label.
  let rest = strip(prefix);
  if (rest) {
    let lm = match(rx("^(?P<label>[A-Z][A-Za-z ,'′-]{1,40}):\\s*(?P<rest>.*)$"), rest);
    if (lm && !match(STATE, rest)) { labelNext = lm.group('label')!; rest = strip(lm.group('rest')!); }
    const sm = match(STATE, rest);
    const ym = match(YIELD_WORD, rest);
    if (sm) {
      setState(values, sm.group('state')!, sm.group('inside') ?? '');
      rest = strip(rest.slice(sm.end));
    } else if (ym) {
      const got = insideValues(ym.group('inside')!);
      if (Object.keys(got).length) {
        const y = (values.yield ??= {});
        for (const [k, v] of Object.entries(got)) if (!(k in y)) y[k] = v;
        rest = '';
      }
    }
    if (rest) {
      lm = search(LABEL_BEFORE, rest);
      if (lm && spans.length) { labelNext = lm.group('label')!; rest = strip(rest.slice(0, lm.index)); }
    }
    if (strip(rest, ' .;,')) into.unrecognised.push(strip(rest));
  }
  for (const [kind, start, end] of spans) {
    let piece = strip(text.slice(start, end));
    // A label for the next value written at the end of this one ("…; minor isomer:")
    let nextLabel = '';
    const lm = search(LABEL_BEFORE, piece);
    if (lm && kind !== 'references') { nextLabel = lm.group('label')!; piece = rstrip(piece.slice(0, lm.index)); }
    piece = rstrip(piece, ' ;,');
    if (!parseItem(kind, piece, into, labelNext)) into.unrecognised.push(piece);
    labelNext = nextLabel;
  }
}

function setState(values: Values, state: string, inside: string): void {
  if (!('physical_state' in values)) values.physical_state = { text: cleanState(state) };
  const got = insideValues(inside);
  if (Object.keys(got).length) {
    const y = (values.yield ??= {});
    for (const [k, v] of Object.entries(got)) if (!(k in y)) y[k] = v;
  }
  const ee = search(rx('(\\d+(?:\\.\\d+)?)\\s*%\\s*ee'), inside);
  if (ee && !('ee' in values)) values.ee = { value: `${ee.group(1)}% ee` };
  const dr = search(rx('(?:d\\.\\s?r\\.|dr)\\s*[=:]?\\s*([>≥]?\\s*\\d+(?:\\.\\d+)?\\s*:\\s*\\d+(?:\\.\\d+)?)'), inside);
  if (dr && !('dr' in values)) values.dr = { value: dr.group(1)!.replace(/\s+/g, '') };
}

const PARSERS: Record<string, (t: string) => Values> = { ir: parseIr, rf: parseRf, mp: parseMp, rotation: parseRotation, ea: parseEa, ee: parseEe, dr: parseDr, xray: parseCcdc };

function parseItem(kind: string, pieceIn: string, into: ImportedCompound, labelIn: string): boolean {
  let piece = pieceIn;
  const values = into.values;
  if (kind === 'yield') {
    const [got, state, more] = parseYield(piece);
    if (!Object.keys(got).length && !state) return false;
    if (Object.keys(got).length) {
      const y = (values.yield ??= {});
      for (const [k, v] of Object.entries(got)) if (!(k in y)) y[k] = v;
    }
    if (state && !('physical_state' in values)) values.physical_state = { text: cleanState(state) };
    if (more) into.unrecognised.push(piece.endsWith('.') ? piece : piece + '.');   // (kept, to print by hand)
    return true;
  }
  if (kind === 'nmr') {
    // "1H NMR: (500 MHz, …)" → "1H NMR (500 MHz, …)"
    piece = sub(rx('^(.{0,25}?NMR)\\s*:\\s*'), '\\1 ', piece);
    let report = piece.endsWith('.') ? piece : piece + '.';
    if (report.slice(-2, -1) === '.') report = report.slice(0, -1);
    let label = strip(labelIn);
    // A label is printed in the report's conditions: a short description only; a sentence is kept as text.
    if (label && (label.length > 30 || search(rx('\\b(?:is|are|was|were|be|been)\\b'), label))) {
      into.unrecognised.push(label + ':');
      label = '';
    } else if (label && isUpper(label[0]) && isLower(label.slice(1, 2))) label = label[0].toLowerCase() + label.slice(1);
    (values.nmr ??= []).push({ id: newId('r'), nucleus: nucleusOf(piece), label, text: report });
    return true;
  }
  if (kind === 'hrms') {
    const [value, calcd, formula] = parseHrms(piece);
    if (!value.found && !calcd) return false;
    if ('hrms' in values) return false;          // (a second HRMS: kept as text)
    let f: string;
    if (!value.adduct && formula && '+-−'.includes(formula.slice(-1))) {
      // Only the ion's formula, no adduct: a salt's cation is [M]+ with M charged; anything else was protonated (or took Na).
      const sign = '-−'.includes(formula.slice(-1)) ? '−' : '+';
      if (search(rx('ium\\b|\\bsalt\\b|\\bate\\b', 'i'), into.name)) {
        value.adduct = `[M]${sign}`;
        const g = mFormula(formula, value.adduct, calcd);
        if (g) value.formula = g + (sign === '+' ? '+' : '-');
      } else {
        const tries = sign === '+' ? ['[M+H]+', '[M+Na]+', '[M+K]+', '[M]+'] : ['[M−H]−', '[M+Cl]−', '[M+HCOO]−', '[M]−'];
        const bare = rstrip(formula, '+-−');
        for (const adduct of tries) {
          const g = mFormula(bare, adduct, calcd);
          if (g && (adduct.startsWith('[M]') || chem.hillFormula(chem.parseFormula(bare)) !== g)) { value.adduct = adduct; value.formula = g; break; }
        }
      }
      f = value.formula ?? '';
    } else f = mFormula(formula, value.adduct ?? '', calcd);
    if (f) value.formula = f;
    else if (formula && calcd && value.adduct) {
      into.warnings.push(`HRMS: the formula printed (${formula}) does not give the calculated m/z printed (${calcd}) for ${value.adduct}; check which is wrong. No formula was taken from it.`);
    }
    into.hrms_calcd = calcd;
    values.hrms = value;
    return true;
  }
  if (kind in PARSERS) {
    const value = PARSERS[kind](piece);
    if (!Object.keys(value).length || kind in values) return false;
    values[kind] = value;
    return true;
  }
  if (kind === 'references') {
    const [sentence, cites] = citations(piece);
    if ('references' in values) return false;
    values.references = { text: sentence, refs: [] };
    into.cites = cites;
    return true;
  }
  return false;
}

const SENTENCE_START = rx('\\s+(?=[A-Z0-9(\\[])', '', (m, t) => m.index > 0 && /[.;]/.test(t[m.index - 1]));

/** Where the data begin in a paragraph that starts with the procedure; 0 if it starts with data or has none. */
export function dataStart(text: string): number {
  const startsWithData = (t: string): boolean => {
    const own = itemSpans(t).slice(0, 1);
    if (own.length && own[0][1] === 0) return true;
    // (a label may come first: "Both rotamers are described together: ¹H NMR …")
    const unlabeled = sub(LABEL_START, '', t);
    const first = itemSpans(unlabeled).slice(0, 1);
    return !!(match(STATE, unlabeled) || (first.length && first[0][1] <= 3));
  };
  if (startsWithData(text)) return 0;      // (the whole paragraph is data)
  for (const m of finditer(SENTENCE_START, text)) {
    const rest = text.slice(m.end);
    if ((startsWithData(rest) || match(YIELD_WORD, rest.split('. ')[0])) && isData(rest)) return m.end;
  }
  return 0;
}

const isPySpace = (ch: string): boolean => /^\s$/u.test(ch) && ch !== '\ufeff';

/** The runs cut at character `index` of their plain (spaces evened) text. */
export function splitRuns(runs: Run[], index: number): [Run[], Run[]] {
  const raw = runs.map((r) => r.text).join('');
  const lead = raw.length - lstrip(raw).length;
  let cleaned = 0, rawCut = raw.length, prevSpace = true;
  const body = lstrip(raw);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (cleaned >= index && !isPySpace(ch)) { rawCut = i + lead; break; }
    if (isPySpace(ch) || '\u00a0\u2009\u202f'.includes(ch)) {
      if (!prevSpace) cleaned++;
      prevSpace = true;
    } else { cleaned++; prevSpace = false; }
  }
  const before: Run[] = [], after: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.text.length;
    if (end <= rawCut) before.push(r);
    else if (pos >= rawCut) after.push(r);
    else {
      const k = rawCut - pos;
      // (both halves keep the run's look, its underline too)
      before.push(R(r.text.slice(0, k), !!r.bold, !!r.italic, r.valign ?? 'normal', !!r.underline));
      after.push(R(r.text.slice(k), !!r.bold, !!r.italic, r.valign ?? 'normal', !!r.underline));
    }
    pos = end;
  }
  return [mergeRuns(before), mergeRuns(after)];
}

const WARN_TWICE = 'The procedure text gives the physical state or yield, which were put in their fields. Printed from the fields, they would appear twice: remove them from the procedure text, or print this compound exactly as imported.';

/** One compound's block (its paragraphs after the heading) into an ImportedCompound. */
export function parseCompound(cid: string, name: string, paras: Para[]): ImportedCompound {
  const c = newCompound(cid, name, { page: paras.length ? paras[0].page : 0 });
  c.original = paras.map(paraMarkup).join('\n');
  let dataSeen = false;
  const procedure: string[] = [];
  for (const p of paras) {
    const text = paraText(p);
    if (!text) continue;
    if (!dataSeen) {
      const cut = dataStart(text);
      if (cut) {     // the procedure, then the data, in one paragraph
        procedure.push(runsMarkup(splitRuns(p.runs, cut)[0]));
        dataSeen = true;
        parseData(text.slice(cut), c);
        continue;
      }
    }
    if (isData(text)) { dataSeen = true; parseData(text, c); } else if (!dataSeen) procedure.push(paraMarkup(p));
    else c.unrecognised.push(text);
  }
  c.procedure = procedure.join('\n');
  // The state, mass and yield written in the procedure when the data don't give them.
  if (!('physical_state' in c.values) || !('yield' in c.values)) {
    const plain = cleanSpace(procedure.filter((line) => strip(line)).map((line) => plainOf(parseMarkup(line)[0]?.runs ?? [])).join(' '));
    const m = search(STATE_IN_TEXT, plain);
    if (m) {
      const before = Object.keys(c.values).length;
      setState(c.values, m.group('state')!, m.group('inside') ?? '');
      if (Object.keys(c.values).length !== before) c.warnings.push(WARN_TWICE);
    }
  }
  if ('hrms' in c.values && (c.values.hrms.found === undefined || c.values.hrms.found === null)) c.warnings.push('HRMS: no found m/z was recognized.');
  return c;
}

// ---------------------------------------------------------------------- the whole SI

interface Block {
  kind: 'gp' | 'compound' | 'other';
  head: string[];        // gp: [label, title]; compound: [name, id]; other: []
  headingPara: Para | null;
  paras: Para[];
  objects: DocObject[];
}

const ONLY_ID = rx(`${STEREO}(?P<id>${ID})\\s*[.:]`);

/** A paragraph that starts a block: [kind, head, heading runs, the rest as a paragraph or null]; ["", [], [], null] if it starts none. */
export function splitRunIn(p: Para): [string, string[], Run[], Para | null] {
  const text = paraText(p);
  const wholeGp = text.length <= 200 && !rstrip(text, '.').includes('. ') ? gpHeading(text) : null;
  const [headRuns, restRuns] = boldPrefix(p.runs);
  const headText = plainOf(headRuns);
  let restPara: Para | null = null;
  if (headRuns.length && restRuns.length && plainOf(restRuns)) restPara = newPara(mergeRuns(stripLeading(restRuns, ' .:–—-')), { page: p.page, size: p.size });
  // a compound heading on its own, or run in (bold, or "Name (2a). Text…")
  let h = compoundHeading(text);
  if (h) return ['compound', h, p.runs, null];
  if (headRuns.length && restPara) {
    h = compoundHeading(headText);
    if (h) return ['compound', h, headRuns, restPara];
    // only the ID, in bold, starting the text: "**SI-01.** Acetone (56 mL, …"
    const onlyId = fullmatch(ONLY_ID, headText);
    if (onlyId) return ['compound', ['', onlyId.group('id')!], headRuns, restPara];
  }
  let m = match(RUN_IN, text);
  if (m && looksLikeName(m.group('name')!) && m.group('name')!.length < 200) {
    const cut = text.indexOf(m.group('rest')!);
    return ['compound', [m.group('name')!, m.group('id')!], [], newPara(splitRuns(p.runs, cut)[1], { page: p.page, size: p.size })];
  }
  // a general procedure's heading
  if (wholeGp) return ['gp', wholeGp, p.runs, null];
  if (headRuns.length && restPara) {
    const g = gpHeading(headText);
    if (g) return ['gp', g, headRuns, restPara];
  }
  m = match(GP, text);
  if (m) {
    const colon = match(rx('^(.{0,80}?):\\s+(?P<rest>\\S.*)$', 's'), text);
    if (colon) {
      const g = gpHeading(colon.group(1)!);
      if (g) {
        const cut = text.indexOf(colon.group('rest')!, colon.index + colon.group(1)!.length);
        return ['gp', g, [], newPara(splitRuns(p.runs, cut)[1], { page: p.page, size: p.size })];
      }
    }
  }
  return ['', [], [], null];
}

/** [page, bottom] of a PDF block's last paragraph; [0, 0] from Word. */
function endOf(blk: Block): [number, number] {
  const last = blk.paras.length ? blk.paras[blk.paras.length - 1] : blk.headingPara;
  return last && last.page ? [last.page, last.bottom] : [0, 0];
}

/** The SI's general procedures, compounds and other text. Structures, spectra and the outline come after (see their modules). */
export function analyse(paras: Para[]): ImportPlan {
  const plan = newPlan();
  const sizes = paras.filter((p) => p.size).map((p) => p.size).sort((a, b) => a - b);
  const bodySize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const blocks: Block[] = [{ kind: 'other', head: [], headingPara: null, paras: [], objects: [] }];
  const last = (): Block => blocks[blocks.length - 1];
  let lastHeading = '', sectionForCompounds = '', compoundSeen = false;
  const allObjects: DocObject[] = [];
  for (const p of paras) {
    allObjects.push(...p.objects);
    const text = paraText(p);
    if (p.table || (text && search(LEADERS, text))) {     // (a table, a contents line)
      if (last().kind === 'other') last().paras.push(p);
      else blocks.push({ kind: 'other', head: [], headingPara: null, paras: [p], objects: [] });
      last().objects.push(...p.objects);
      continue;
    }
    if (!text) {
      last().objects.push(...p.objects);      // (a paragraph with only a drawing)
      if (last().kind === 'other' && p.objects.length) last().paras.push(p);   // (in the text: a figure)
      continue;
    }
    if (match(CAPTION, text)) {
      // A figure's caption ends a compound's block; the short pieces of text just before it are the figure's own.
      const blk = last();
      const moved: Para[] = [];
      while (blk.kind !== 'other' && blk.paras.length && paraText(blk.paras[blk.paras.length - 1]).length < 90
        && !isData(paraText(blk.paras[blk.paras.length - 1])) && blk.paras[blk.paras.length - 1].page === p.page && blk.paras.length > 1) {
        moved.unshift(blk.paras.pop()!);
      }
      blocks.push({ kind: 'other', head: [], headingPara: null, paras: [...moved, p], objects: [] });
      continue;
    }
    const [kind, head, , rest] = splitRunIn(p);
    if (kind) {
      // The Data section's name: the heading above the first compound (or above the first GP).
      if (kind === 'compound' && !compoundSeen) {
        compoundSeen = true;
        sectionForCompounds = lastHeading || sectionForCompounds;
      } else if (!sectionForCompounds) sectionForCompounds = lastHeading;
      if (kind === 'compound') lastHeading = '';
      const blk: Block = { kind: kind as Block['kind'], head, headingPara: p, paras: [], objects: [...p.objects] };
      if (rest) blk.paras.push(rest);
      blocks.push(blk);
      continue;
    }
    if (isSectionHeading(p, bodySize)) {
      lastHeading = text;
      blocks.push({ kind: 'other', head: [], headingPara: p, paras: [], objects: [...p.objects] });
      continue;
    }
    last().paras.push(p);
    last().objects.push(...p.objects);
  }
  plan.section_name = sectionForCompounds;
  const seenIds = new Map<string, number>();
  let gpCount = 0;
  for (const blk of blocks) {
    if (blk.kind === 'other') {
      const own = [...(blk.headingPara ? [blk.headingPara] : []), ...blk.paras];
      plan.other.push(...own.filter((p) => paraText(p)));
      for (const p of own) plan.sequence.push(['para', p]);
    } else if (blk.kind === 'gp') {
      gpCount++;
      const [label, title] = blk.head;
      const gp: ImportedGP = {
        key: `gp${gpCount}`, name: label ? `General Procedure ${label}` : 'General Procedure', title, text: blk.paras.map(paraMarkup).join('\n'), label,
        sentence: '', original: [blk.headingPara, ...blk.paras].filter((p): p is Para => !!p).map(paraText).join('\n'), keep: true, end: endOf(blk),
      };
      plan.gps.push(gp);
      plan.sequence.push(['gp', gp]);
    } else {
      const [name, cid] = blk.head;
      const c = parseCompound(cid, name, blk.paras);
      if (!blk.paras.length) c.warnings.push('No text was found for this compound.');
      if (seenIds.has(cid)) {
        c.warnings.push(`The ID ${cid} is used by another compound of this SI too.`);
        c.keep = false;
      }
      seenIds.set(cid, plan.compounds.length);
      if (blk.headingPara && !c.page) c.page = blk.headingPara.page;
      const head = blk.headingPara;
      if (head && head.page) {
        const first = blk.paras[0] ?? null;
        c.geometry = [head.page, head.bottom, first ? first.page : 0, first ? first.top : 0];
      }
      c.end = endOf(blk);
      plan.compounds.push(c);
      plan.sequence.push(['compound', c]);
      plan.own_objects.push(blk.objects);
    }
  }
  plan.objects = allObjects;
  nameUnlabeledGps(plan);
  linkGeneralProcedures(plan);
  for (const c of plan.compounds) purificationFromText(c);
  plan.body_size = bodySize;
  outline(plan, bodySize);
  if (!plan.compounds.length) {
    plan.warnings.push('No compounds were recognized. Compound headings are expected as a name followed by the ID in parentheses, e.g. “1-Phenylethan-1-ol (2a).”');
  }
  return plan;
}

function nameUnlabeledGps(plan: ImportPlan): void {
  const unlabeled = plan.gps.filter((g) => !g.label);
  if (plan.gps.length > 1 && unlabeled.length) {
    const used = new Set(plan.gps.filter((g) => g.label).map((g) => g.label));
    // (A–Z, then 1, 2, 3…, as a new general procedure is named in a project)
    const marks = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...Array.from({ length: unlabeled.length }, (_x, i) => String(i + 1))].filter((ch) => !used.has(ch));
    unlabeled.forEach((g, i) => { g.label = marks[i]; g.name = `General Procedure ${g.label}`; });
  }
}

// ---------------------------------------------------------------------- general procedures

const SENTENCE_END = rx('\\.\\s+(?=[A-Z0-9(*])');
// A full stop after these is not a sentence's end ("ca. 5 mL", "e.g. THF", "Fig. 2").
const ABBREVIATIONS = new Set(['ca', 'vs', 'eq', 'equiv', 'approx', 'ref', 'refs', 'e.g', 'i.e', 'cf', 'fig', 'no', 'vol', 'al', 'resp', 'conc', 'sat', 'aq', 'anhyd', 'temp']);
const LAST_WORD = rx('([\\w.]+)$');

/** A procedure's text (markup) cut into sentences (not inside parentheses). */
export function sentences(markup: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0, i = 0;
  while (i < markup.length) {
    const ch = markup[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === '\n' && depth === 0) { out.push(markup.slice(start, i + 1)); start = i + 1; } else if (ch === '.' && depth === 0) {
      const m = match(SENTENCE_END, markup, i);
      const word = search(LAST_WORD, markup.slice(start, i));
      if (m && !(word && ABBREVIATIONS.has(strip(word.group(1)!.toLowerCase(), '.')))) {
        out.push(markup.slice(start, m.end));
        start = m.end;
        i = m.end;
        continue;
      }
    }
    i++;
  }
  if (start < markup.length) out.push(markup.slice(start));
  return out.filter((s) => strip(s));
}

export function citesGp(sentence: string, gp: ImportedGP, onlyOne: boolean): boolean {
  const plain = sentence.replace(/[*^_{}\\]/g, '');
  for (const m of finditer(rx('\\b(?:general\\s+(?:experimental\\s+)?procedure|GP)\\s*[-–]?\\s*\\(?(?P<label>[A-Z]{1,2}\\b|\\d{1,2}\\b|[IVX]{1,4}\\b)?', 'i'), plain)) {
    const label = m.group('label') ?? '';
    if (gp.label && label.toUpperCase() === gp.label.toUpperCase()) return true;
    if (onlyOne && (!label || ['a', 'an', 'the'].includes(label.toLowerCase()))) return true;
  }
  return false;
}

// Words (with their digits and hyphens: "4-methylphenol", "4a", "CH2Cl2" are one each), numbers ("54.1", "88%"), markup marks, spaces, single characters.
const TOKEN = /\*\*|\^\{|_\{|\}|[\p{L}\p{N}_′'-]*[\p{L}\p{Nl}\p{No}][\p{L}\p{N}_′'-]*|\p{Nd}+(?:\.\p{Nd}+)?%?|\s+|./gu;

export const tokens = (text: string): string[] => text.match(TOKEN) ?? [];

/** Positions in `seq` of the tokens of `common`, in order (a longest-common-subsequence alignment); null if `common` is not a subsequence of `seq`. */
function lcsAlign(common: string[], seq: string[]): number[] | null {
  const n = common.length, m = seq.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = common[i] === seq[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  if (dp[0][0] !== n) return null;
  const out: number[] = [];
  let i = 0, j = 0;
  while (i < n) {
    if (common[i] === seq[j] && dp[i][j] === dp[i + 1][j + 1] + 1) { out.push(j); i++; }
    j++;
  }
  return out;
}

const reversed = (s: string): string => [...s].reverse().join('');

/**
 * What a general procedure's sentences in several compounds share: [the template's pieces —
 * literal text and null for a blank alternately —, the blanks' values per sentence]. null if they
 * share too little to be one sentence with blanks.
 */
export function induceTemplate(texts: string[]): [(string | null)[], string[][]] | null {
  const seqs = texts.map(tokens);
  let common = seqs[0];
  for (const s of seqs.slice(1)) common = matchingBlocks(common, s).flatMap(([a, , size]) => common.slice(a, a + size));
  const alignments: number[][] = [];
  for (const s of seqs) {
    const al = lcsAlign(common, s);
    if (!al) return null;
    alignments.push(al);
  }
  // gaps: before common[0], between common[k] and common[k+1], after the last
  const n = common.length;
  const gapValues = seqs.map((s, i) => {
    const bounds = [-1, ...alignments[i], s.length];
    return Array.from({ length: n + 1 }, (_x, k) => s.slice(bounds[k] + 1, bounds[k + 1]).join(''));
  });
  const pieces: (string | null)[] = [];
  const values: string[][] = seqs.map(() => []);
  let literal = '';
  for (let k = 0; k <= n; k++) {
    if (gapValues.some((g) => g[k])) {
      pieces.push(pieces.length || literal ? literal : '');
      pieces.push(null);
      gapValues.forEach((g, i) => values[i].push(g[k]));
      literal = '';
    }
    if (k < n) literal += common[k];
  }
  pieces.push(literal);
  // Merge blanks separated only by a space, a hyphen or a slash (one value, cut up).
  const mergedPieces: (string | null)[] = [pieces[0]];
  const mergedValues: string[][] = seqs.map(() => []);
  let blankIndex = 0;
  let i = 1;
  while (i < pieces.length) {
    if (pieces[i] === null) {
      let vals = values.map((v) => v[blankIndex]);
      blankIndex++;
      while (i + 2 < pieces.length && pieces[i + 2] === null && fullmatch(rx('\\s*[-–/]?\\s*'), pieces[i + 1]!)) {
        const sep = pieces[i + 1]!;
        vals = vals.map((a, j) => a + sep + values[j][blankIndex]);
        blankIndex++;
        i += 2;
      }
      mergedPieces.push(null);
      vals.forEach((v, j) => mergedValues[j].push(v));
    } else mergedPieces.push(pieces[i]);
    i++;
  }
  // What every value of a blank starts or ends with is part of the sentence.
  let blank = 0;
  mergedPieces.forEach((piece, k) => {
    if (piece !== null) return;
    const vals = mergedValues.map((v) => v[blank]);
    const prefix = commonPrefix(vals);
    const suffix = reversed(commonPrefix(vals.map((v) => reversed(v.slice(prefix.length)))));
    if (prefix || suffix) {
      mergedPieces[k - 1] = (mergedPieces[k - 1] || '') + prefix;
      if (k + 1 < mergedPieces.length) mergedPieces[k + 1] = suffix + (mergedPieces[k + 1] || '');
      for (const v of mergedValues) v[blank] = v[blank].slice(prefix.length, v[blank].length - suffix.length);
    }
    blank++;
  });
  const literalLen = mergedPieces.reduce((s, p) => s + (p ? p.length : 0), 0);
  const avg = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  const blanks = mergedPieces.filter((p) => p === null).length;
  if (blanks > 8 || literalLen < 0.4 * avg) return null;
  return [mergedPieces, mergedValues];
}

/** The longest start all of them share, ended at a whole word. */
export function commonPrefix(values: string[]): string {
  if (!values.length) return '';
  const first = values[0];
  let n = 0;
  while (values.every((v) => v.length > n && v[n] === first[n])) n++;
  if (n === Math.min(...values.map((v) => v.length))) return first.slice(0, n);   // (a whole value: it may end anywhere)
  // never inside a word ("4-methylphenol", "4-bromophenol" share no "4-")
  while (n && (isAlnum(first[n - 1]) || "-′'".includes(first[n - 1]))) n--;
  return first.slice(0, n);
}

/** A name for a blank of the template, and whether it is one the program fills. */
function blankName(before: string, after: string, vals: string[], comps: ImportedCompound[], used: Set<string>): [string, boolean] {
  const stripped = vals.map((v) => strip(v.replace(/\*\*/g, '')));
  if (stripped.every((s, i) => s === comps[i].cid)) return ['product', true];
  const yields = comps.map((c) => String(c.values.yield?.percent ?? ''));
  if ((stripped.every((s, i) => yields[i] && (s === `${yields[i]}%` || s === yields[i])) && stripped.every((s) => s.endsWith('%')))
    || (stripped.every((s, i) => yields[i] && s === yields[i]) && after.startsWith('%'))) return ['yield', true];
  if (stripped.every((s) => fullmatch(rx('\\d+(?:\\.\\d+)?\\s*(?:mmol|µmol|μmol|mol)'), s))) return ['scale', true];
  let base = 'value';
  if (stripped.every((s) => fullmatch(rx(ID), s)) && (stripped.some((s) => /[a-z]/.test(s)) || search(rx('(?:\\(|\\*\\*)\\s*$'), before))) {
    base = used.has('starting material') ? 'starting material ID' : 'ID';
  } else if (search(rx('\\bfrom\\s*\\(?\\s*$'), before)) base = 'starting material';
  else if (match(rx('\\s*(?:mg|g)\\b'), after)) base = 'mass';
  let name = base, n = 2;
  while (used.has(name)) { name = `${base} ${n}`; n++; }
  return [name, false];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TOO_DIFFERENT = (name: string): string => `The compounds made by ${name} cite it in sentences too different to share one compound sentence: they keep their own text and are not linked to it.`;

/** Find each compound's sentence citing a general procedure, work out the GP's compound sentence from them, and link the compounds whose sentence fits it. */
export function linkGeneralProcedures(plan: ImportPlan): void {
  const onlyOne = plan.gps.length === 1;
  for (const gp of plan.gps) {
    const users: [ImportedCompound, string][] = [];
    for (const c of plan.compounds) {
      if (c.gp_key) continue;
      for (const s of sentences(c.procedure)) if (citesGp(s, gp, onlyOne)) { users.push([c, s]); break; }
    }
    if (!users.length) continue;
    const texts = users.map(([, s]) => strip(s));
    const comps = users.map(([c]) => c);
    if (users.length === 1) {
      let sentence = texts[0];
      const cid = comps[0].cid;
      for (const form of [`**${cid}**`, cid]) {
        const pat = form.startsWith('*') ? rx(escapeRe(form)) : rx(`${escapeRe(form)}(?![\\w′'])`, '', notFollowing(WORD_POINT));
        if (search(pat, sentence)) { sentence = sub(pat, () => '{product}', sentence, 1); break; }
      }
      gp.sentence = gpPlaceholder(sentence, gp);
      link(comps[0], gp, texts[0], {});
      continue;
    }
    const induced = induceTemplate(texts);
    if (!induced) { plan.warnings.push(TOO_DIFFERENT(gp.name)); continue; }
    const [templ, values] = induced;
    const pieces = [...templ];
    const names: string[] = [];
    const used = new Set<string>();
    let out = '';
    let blank = 0;
    for (let k = 0; k < pieces.length; k++) {
      const piece = pieces[k];
      if (piece === null) {
        const before = k ? pieces[k - 1] || '' : '';
        const after = k + 1 < pieces.length ? pieces[k + 1] || '' : '';
        const vals = values.map((v) => v[blank]);
        const [name] = blankName(before, after, vals, comps, used);
        if (name === 'yield' && after.startsWith('%')) pieces[k + 1] = after.slice(1);   // ({yield} gives "88%")
        used.add(name);
        names.push(name);
        out += '{' + name + '}';
        blank++;
      } else out += piece;
    }
    // Blanks the program can't name make a sentence nobody can read: with more than three, no link.
    if (names.filter((x) => x.startsWith('value')).length > 3) { plan.warnings.push(TOO_DIFFERENT(gp.name)); continue; }
    // The same amount in every compound's sentence is the reaction scale: {scale}, with each compound's Reaction scale field filled.
    let commonScale: [string, string] | null = null;
    if (!names.includes('scale')) {
      const amounts = [...finditer(rx('(\\d+(?:\\.\\d+)?)\\s*(mmol|µmol|μmol)\\b', '', notFollowing(/[\p{L}\p{N}_.{]/u)), out)];
      if (amounts.length === 1) {
        commonScale = [amounts[0].group(1)!, amounts[0].group(2)!];
        out = sub(rx('\\d+(?:\\.\\d+)?\\s*(?:mmol|µmol|μmol)\\b', '', notFollowing(/[\p{L}\p{N}_.{]/u)), () => '{scale}', out, 1);
      }
    }
    gp.sentence = gpPlaceholder(out, gp);
    for (const c of comps) if (commonScale && !('scale' in c.values)) c.values.scale = { value: commonScale[0], unit: commonScale[1].replaceAll('μ', 'µ') };
    comps.forEach((c, i) => {
      const own: Record<string, string> = {};
      names.forEach((name, j) => {
        const v = values[i][j];
        if (name === 'product' || name === 'yield') return;
        if (name === 'scale') {
          const sm = fullmatch(rx('(\\d+(?:\\.\\d+)?)\\s*(\\S+)'), strip(v));
          if (sm && !('scale' in c.values)) c.values.scale = { value: sm.group(1), unit: sm.group(2)!.replaceAll('μ', 'µ') };
          return;
        }
        own[name] = strip(v);
      });
      link(c, gp, texts[i], own);
    });
  }
}

const PURIFIED = rx('^The crude product was purified by (?P<method>[^()]+?)(?:\\s*\\((?P<inside>[^()]*(?:\\([^()]*\\)[^()]*)*)\\))?\\.$');
const PHASE = rx('^(?:SiO2|SiO₂|silica(?:\\s+gel)?|Al2O3|Al₂O₃|(?:neutral|basic|acidic)?\\s*alumina|C18|florisil|Celite)$', 'i');

/** The procedure's last sentence, when it is word for word the Purification field's automatic sentence, becomes that field. */
export function purificationFromText(c: ImportedCompound): void {
  if ('purification' in c.values) return;
  const parts = sentences(c.procedure);
  if (!parts.length) return;
  const last = strip(parts[parts.length - 1]);
  const plain = last.includes('\n') ? '' : cleanSpace(plainOf(parseMarkup(last)[0]?.runs ?? []));
  const m = match(PURIFIED, plain);
  if (!m) return;
  const value: Values = { method: strip(m.group('method')!), phase: '', eluent: '', sentence: '' };
  const inside = strip(m.group('inside') ?? '');
  if (inside) {
    const at = inside.indexOf(', ');
    const [first, rest] = at >= 0 ? [inside.slice(0, at), inside.slice(at + 2)] : [inside, ''];
    if (match(PHASE, strip(first))) { value.phase = strip(first); value.eluent = strip(rest); } else value.eluent = inside;
  }
  const t = purificationTextOf(value as Record<string, string>);
  if ((t ? `${PURIFICATION_START}${t}.` : '') !== plain) return;
  c.values.purification = value;
  c.procedure = rstrip(c.procedure.slice(0, c.procedure.lastIndexOf(parts[parts.length - 1])));
}

/** The GP's own name in its compound sentence becomes {GP}. */
function gpPlaceholder(sentence: string, gp: ImportedGP): string {
  if (!gp.label) return sentence;
  const pattern = rx(`\\b(?:general\\s+(?:experimental\\s+)?procedure|GP)\\s*[-–]?\\s*(?:\\*\\*)?\\(?${escapeRe(gp.label)}\\)?(?:\\*\\*)?(?![\\w])`, 'i');
  return sub(pattern, () => '{GP}', sentence, 1);
}

function link(c: ImportedCompound, gp: ImportedGP, sentence: string, values: Record<string, string>): void {
  c.gp_key = gp.key;
  c.gp_values = values;
  c.gp_sentence = sentence;
  let rest = c.procedure;
  const idx = rest.indexOf(sentence);
  if (idx >= 0) rest = rest.slice(0, idx) + rest.slice(idx + sentence.length);
  c.procedure = strip(rest.replace(/[ \t]+\n/g, '\n'));
}

/** A structure label: a compound ID (with its stereo prefix). */
export const isIdLabel = (text: string): boolean => !!fullmatch(rx(STEREO + ID), strip(text));

/** A structure label's compound ID without its stereo prefix ("(S)-3a" → "3a"), as a compound heading's ID is. */
export const bareId = (text: string): string => {
  const m = fullmatch(rx(STEREO + '(?P<id>' + ID + ')'), strip(text));
  return m ? m.group('id')! : strip(text);
};

