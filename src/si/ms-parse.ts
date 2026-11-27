// Reading compound labels and values out of manuscript text (SI Assistant SPEC §13o): a port of
// Chem SI Assistant's core/ms_parse.py, itself ported from Nathan O'Hare's chem-vision skill
// (scripts/annotations.py, MIT License).
//
// Papers print compound IDs with their yields, ee/er and dr under the structures of a scope
// scheme ("3a" and, on the line below, "92%, 95% ee"; or "3a, 92%, 95% ee" on one line), in
// scope tables (Entry / Product / Yield / ee columns) and in the body text. This turns text with
// positions (from a PDF, a Word file or a ChemDraw file, see ms-read.ts) into labeled values,
// and reads the reaction conditions (times, temperatures, equivalents…) of a footnote to check
// them against the SI.
//
// Coordinates everywhere: points, x to the right, y DOWN (top of the page = 0).

import { formulaMatches } from './chemtext';
import { pyFloat } from './pyjson';
import { after, guarded, guardedAt, notAfter } from '../regex-behind';

const NORM: Record<string, string> = {
  '−': '-', '–': '-', '—': '-', '‐': '-', '‑': '-', '：': ':', '∶': ':',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '′': "'", '’': "'", '‘': "'", 'º': '°', '˚': '°',
};
const NORM_RE = new RegExp(`[${Object.keys(NORM).join('')}]`, 'g');

export const normalize = (text: unknown): string => String(text ?? '').replace(NORM_RE, (c) => NORM[c]);

const NUM = String.raw`\d{1,3}(?:\.\d+)?`;
export const RATIO = String.raw`(?:[<>≥≤]\s*)?${NUM}\s*:\s*${NUM}`;

// Order matters: specific patterns first, then the generic bare percentage. Units that collide
// with compound labels (3h, 8g, 1d) need a space before the unit: "24 h" is a time, "3h" a compound.
const PATTERNS: [string, string, true?][] = [
  ['ee', String.raw`(?<v>[<>≥≤]?\s*${NUM})\s*%\s*ee\b`],
  ['ee', String.raw`\bee\s*(?:[=:]|of)?\s*(?<v>[<>≥≤]?\s*${NUM})\s*%`],
  ['ee', String.raw`enantiomeric\s+excess(?:\s+of)?\s*(?<v>[<>≥≤]?\s*${NUM})\s*%`],
  ['de', String.raw`(?<v>[<>≥≤]?\s*${NUM})\s*%\s*de\b`],
  ['er', String.raw`(?<v>${RATIO})\s*(?:e\.?r\.?|er)\b`],
  ['er', String.raw`\b(?:e\.?r\.?|er)\s*[=:]?\s*(?<v>${RATIO})`],
  ['dr', String.raw`(?<v>${RATIO})\s*(?:d\.?r\.?|dr)\b`],
  ['dr', String.raw`\b(?:d\.?r\.?|dr)\s*[=:]?\s*(?<v>${RATIO})`],
  ['rr', String.raw`(?<v>${RATIO})\s*(?:r\.?r\.?|rr)\b`],
  ['rr', String.raw`\b(?:r\.?r\.?|rr)\s*[=:]?\s*(?<v>${RATIO})`],
  ['ez', String.raw`(?<v>${RATIO})\s*(?:E\s*/\s*Z|Z\s*/\s*E)\b`],
  ['ez', String.raw`\b(?:E\s*/\s*Z|Z\s*/\s*E)\s*[=:]?\s*(?<v>${RATIO})`],
  ['conversion', String.raw`(?<v>${NUM})\s*%\s*conv(?:ersion|\.)?`],
  ['conversion', String.raw`\bconv(?:ersion|\.)?\s*(?:\(%\))?\s*[=:]?\s*(?<v>${NUM})\s*%`],
  ['yield_nmr', String.raw`(?<v>${NUM})\s*%\s*(?:\(\s*)?(?:NMR|1H NMR|GC|HPLC)\s*(?:yield)?\)?`],
  ['yield', String.raw`(?<v>[<>≥≤]?\s*${NUM})\s*%\s*(?:isolated\s+)?yield`],
  ['yield', String.raw`\byield\s*(?:[=:]|of)?\s*(?<v>${NUM})\s*%`],
  ['loading', String.raw`(?<v>\d+(?:\.\d+)?)\s*mol\s*%`],
  ['temperature', String.raw`(?<v>-?\d{1,3})\s*°\s*C\b`],
  // (no \b after the last "." of "r.t.": there is no word boundary between "." and a space)
  ['temperature', String.raw`\b(?<v>rt\b|r\.t\.(?!\w)|room temperature\b|reflux\b)`],
  ['time', String.raw`(?<v>\d+(?:\.\d+)?)\s*(?<u>min|hr|hrs)\b`, true],
  ['time', String.raw`(?<v>\d+(?:\.\d+)?)\s+(?<u>h|days?)\b`, true],
  ['scale', String.raw`(?<v>\d+(?:\.\d+)?)\s*(?<u>mmol|mg)\b`, true],
  ['scale', String.raw`(?<v>\d+(?:\.\d+)?)\s+(?<u>mol|g)\b(?!\s*%)`, true],
];
const CASE_SENSITIVE = new Set(['ez', 'time', 'scale', 'temperature']);
// (true: only where the number does not go on from a word, a point or a hyphen before it)
const COMPILED: [string, RegExp][] = PATTERNS.map(([k, p, own]) => {
  const re = new RegExp(p, CASE_SENSITIVE.has(k) ? 'g' : 'gi');
  return [k, own ? notAfter(re, /[\w.-]/) : re];
});
const PCT = () => new RegExp(String.raw`(?<v>[<>≥≤]?\s*${NUM})\s*%`, 'g');

// Footnote markers: "90%a", "8k[c]", "8k^c", "[a]" (a ring-fusion letter is not one: "benzo[b]thiophene")
const FOOT = () => guarded(/(?<f>[a-h])\b|\[(?<g>[a-h])\](?![A-Za-z])|\^(?<h>[a-h])(?![a-z])/g, (m, s) => m.groups!.f === undefined || s[m.index - 1] === '%');

// Compound labels: 3, 3a, 12b', S1, 4aa, (±)-5, ent-7, (R)-3b, (S,S)-3b, (1R,2S)-3b, cis-5a, trans-5h
const DESCRIPTOR = String.raw`\d*[RSEZ]\*?`;
export const ID_PREFIX = String.raw`(?:\((?:[±+-]|${DESCRIPTOR}(?:,\s*${DESCRIPTOR})*|rac|rel)\)-|ent-|rac-|rel-|cis-|trans-|meso-|syn-|anti-)`;
export const ID_RE = new RegExp(String.raw`^${ID_PREFIX}?(?:S|SI-)?\d{1,3}[a-z]{0,3}'*$`);
const NOT_ID_BEFORE = /(table|scheme|figure|fig\.?|entry|entries|ref\.?|refs\.?|eq\.?|equiv\.?|step|chart|page|ca\.?|n\s*=|section|sections)$/i;

const all = (re: RegExp, text: string): RegExpExecArray[] => { re.lastIndex = 0; const out: RegExpExecArray[] = []; let m; while ((m = re.exec(text))) { out.push(m); if (!m[0].length) re.lastIndex++; } return out; };
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** How compound IDs are compared: capitals, spaces and the kind of prime don't count ("3A" = "3a"); a stereo prefix does. */
export const idKey = (label: string): string => normalize(label).replace(/\s+/g, '').toLowerCase();

/** The ID without a stereo prefix ("(±)-5" → "5", "(S,S)-3b" → "3b"): used only when no SI compound has the full ID. */
export const idBase = (label: string): string => idKey(label).replace(new RegExp(`^${ID_PREFIX}`, 'i'), '');

/** The ID key without a prefix that only says racemic or "the enantiomer": "(±)-5", "rac-5", "ent-5" → "5". */
export const idWithoutRac = (label: string): string => idKey(label).replace(/^(?:\((?:±|\+\/-|rac)\)-|rac-|ent-)/, '');

/** Remove footnote markers: [clean text, markers]. */
export function splitFootnotes(text: string): [string, string[]] {
  const notes: string[] = [];
  const clean = text.replace(FOOT(), (...a) => { const g = a[a.length - 1] as Record<string, string | undefined>; notes.push((g.f ?? g.g ?? g.h)!); return ''; });
  return [clean, notes];
}

/** A record of labeled values (and, for a label, its IDs and text). */
export interface Rec {
  ids: string[];
  text: string;
  footnotes?: string[];
  [k: string]: unknown;
}
export type Values = Record<string, unknown>;

/** A value as Python writes it (str() of it), for the numbers in values. */
function pyStr(v: unknown): string {
  if (typeof v === 'number') return pyFloat(v);
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return `[${v.map((x) => `'${String(x)}'`).join(', ')}]`;
  return String(v);
}

/**
 * Labelled values from a snippet like "3a, 92%, 95:5 er". A percentage with no qualifier is
 * taken as the yield (the usual convention in scope schemes) and flagged, but only in short
 * label-like snippets: in running text a bare % is too ambiguous.
 */
export function parseValues(text: string): Values {
  const t = normalize(text);
  const found: Values = {};
  const spans: [number, number][] = [];
  const taken = (a: number, b: number): boolean => spans.some(([x, y]) => a < y && b > x);
  // a bracketed second result ("97% (58%: Pd = 3 mol %)") is kept whole as an alternative
  for (const m of all(/\((?=[^()]*%)[^()]*\)/g, t)) {
    const inner = m[0].slice(1, -1);
    const before = t.slice(0, m.index);
    if (new RegExp(String.raw`^\s*${NUM}\s*%\s*$`).test(inner) && !PCT().test(before)) continue; // "(77%)" alone is the value itself
    if (onlySelectivity(inner)) continue; // "92% (95% ee)": the ee of this same result
    if (PCT().test(before)) {
      ((found.alternative_results ??= []) as string[]).push(inner.trim());
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  for (const [key, rx] of COMPILED) {
    for (const m of all(rx, t)) {
      if (taken(m.index, m.index + m[0].length)) continue;
      let v = m.groups!.v.replace(/\s+/g, '');
      if (m.groups!.u) v = `${v} ${m.groups!.u}`;
      else if (key === 'temperature' && /\d$/.test(v)) v = `${v} °C`;
      else if (key === 'loading') v = `${v} mol%`;
      if (!(key in found)) found[key] = v;
      spans.push([m.index, m.index + m[0].length]);
    }
  }
  const labelish = t.split(/\s+/).filter(Boolean).length <= 8;
  for (const m of all(PCT(), t)) {
    if (taken(m.index, m.index + m[0].length)) continue;
    const v = m.groups!.v.replace(/\s+/g, '');
    if (!('yield' in found) && labelish) { found.yield = v; found.yield_assumed = true; }
    else ((found.other_percent ??= []) as string[]).push(v);
    spans.push([m.index, m.index + m[0].length]);
  }
  if ('er' in found && !('ee' in found)) {
    const ee = erToEe(String(found.er));
    if (ee !== null) found.ee_from_er = ee;
  }
  return found;
}

const SELECTIVITY = COMPILED.filter(([k]) => ['ee', 'de', 'er', 'dr', 'rr', 'ez'].includes(k)).map(([, rx]) => rx);

/** Does a bracket hold only an ee/er/dr ("95% ee", "90% ee, 10:1 dr")? */
function onlySelectivity(inner: string): boolean {
  let rest = inner;
  for (const rx of SELECTIVITY) { rx.lastIndex = 0; rest = rest.replace(rx, ' '); }
  return rest !== inner && !/[\d%]/.test(rest);
}

/** "97:3" → 94.0 (the ee of the major enantiomer); null if it isn't a ratio. */
export function erToEe(ratio: string): number | null {
  const parts = normalize(ratio).replace(/[<>≥≤\s]/g, '').split(':');
  if (parts.length !== 2) return null;
  const [a, b] = parts.map((x) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(x) ? Number(x) : NaN));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a + b <= 0) return null;
  return Math.round((Math.abs(a - b) / (a + b)) * 1000) / 10;
}

/** Candidate compound labels in free text (tokens shaped like 3a, 12, S4). */
export function findIds(text: string): string[] {
  const out: string[] = [];
  // (commas inside a stereo prefix such as "(S,S)-3b" don't split it)
  const t = normalize(text).replace(new RegExp(String.raw`\(${DESCRIPTOR}(?:\s*,\s*${DESCRIPTOR})+\)-`, 'g'), (m) => m.replace(/\s*,\s*/g, '\x00'));
  const toks = t.split(/[\s,;/]+/).filter(Boolean).map((x) => x.replace(/\x00/g, ','));
  toks.forEach((raw, n) => {
    if (n && NOT_ID_BEFORE.test(toks[n - 1])) return;
    if (/^\(\d+\)$/.test(raw)) return; // "(4)": an equation number
    if (/^\d+\.$/.test(raw)) return; // "2. H2O": a numbered step
    let tok = raw.replace(/[.,;:]+$/, '');
    if (!(tok.startsWith('(') && tok.includes(')-'))) tok = tok.replace(/^[()[\]]+|[()[\]]+$/g, '');
    if (tok && ID_RE.test(tok) && !/^\d{4}$/.test(tok)) out.push(tok);
  });
  return out;
}

/** Most label-like first: bold, then letter-suffixed (3c), then bare. */
export function rankIds(ids: string[], bold: readonly string[] = []): string[] {
  const u = uniq(ids);
  const score = (i: string): number[] => [bold.includes(i) ? 0 : 1, /\d[a-z]/.test(i) ? 0 : 1, u.indexOf(i)];
  return [...u].sort((a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
}

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** {text, ids, values…, footnotes} for one snippet. */
export function annotateText(text: string): Rec {
  const [clean, notes] = splitFootnotes(normalize(text));
  const vals = parseValues(clean);
  let idText = clean;
  if ('alternative_results' in vals) idText = clean.replace(/\((?=[^()]*%)[^()]*\)/g, ' '); // IDs inside "(40% recovered 8c)" aren't the label
  let ids = findIds(idText);
  // drop tokens that are really numbers inside values ("95" of "95:5 er")
  const valueNums = new Set(Object.entries(vals).filter(([k]) => k !== 'yield_assumed').map(([, v]) => pyStr(v)).join(' ').match(/\d+(?:\.\d+)?/g) ?? []);
  ids = ids.filter((i) => !valueNums.has(i));
  if (words(clean).length > 8) ids = ids.filter((i) => !/^\d+$/.test(i)); // running text: bare numbers are rarely labels
  const rec: Rec = { text, ids: rankIds(ids), ...vals };
  if (notes.length) rec.footnotes = notes;
  return rec;
}

/** The one compound label of a label line that also holds other numbers ("3a, n = 2", "3a (from 1b)"); '' if it can't be told. */
export function singleLabel(text: string, ids: string[]): string {
  const clean = splitFootnotes(normalize(text))[0];
  const outside = findIds(clean.replace(/\([^()]*\)/g, ' ')).filter((i) => ids.includes(i));
  for (const pool of [outside, ids]) {
    const lettered = uniq(pool).filter((i) => /\d[a-z]/.test(i));
    if (lettered.length === 1) return lettered[0];
  }
  return '';
}

export const VALUE_KEYS = ['yield', 'yield_nmr', 'ee', 'er', 'dr', 'conversion', 'de', 'rr', 'ez'];
export const hasValues = (rec: Values): boolean => VALUE_KEYS.some((k) => k in rec);

// ---------------------------------------------------------------- spans and lines

/** A piece of text with its box (y down). */
export interface Span { text: string; x0: number; y0: number; x1: number; y1: number; size: number; bold?: boolean; script?: boolean; italic?: boolean }

/** A line of text: its words, box and size, what was bold, and how it was marked (in a table, a footnote, body text). */
export interface Line {
  text: string;
  bbox: [number, number, number, number];
  size: number;
  bold_parts: string[];
  starts_with_marker: boolean;
  in_table?: boolean;
  footnote?: boolean;
  body?: boolean;
  [k: string]: unknown;
}

const MARKER_TEXT = /^\[?([a-h](?:\s*,\s*[a-h])*)\]?$/;

/** "b" → ["b"], "a,b" → ["a", "b"], "[c]" → ["c"]; [] for anything else. */
export function markerLetters(text: string): string[] {
  const m = MARKER_TEXT.exec(text.trim());
  return m ? m[1].match(/[a-h]/g) ?? [] : [];
}

/** Flag spans set smaller than the text beside them as scripts (superscript footnote letters, subscript digits). */
export function markScripts(spans: Span[]): Span[] {
  const buckets = new Map<number, Span[]>();
  const cyOf = (s: Span): number => (s.y0 + s.y1) / 2;
  for (const s of spans) { const k = Math.floor(cyOf(s) / 4); buckets.set(k, [...(buckets.get(k) ?? []), s]); }
  for (const s of spans) {
    const cy = cyOf(s), b = Math.floor(cy / 4);
    let big = s.size;
    for (let k = b - 2; k <= b + 2; k++) {
      for (const o of buckets.get(k) ?? []) {
        if (o === s || Math.abs(cyOf(o) - cy) >= 0.7 * Math.max(o.size, s.size)) continue;
        if (Math.min(Math.abs(o.x0 - s.x1), Math.abs(s.x0 - o.x1)) < 1.5 * Math.max(o.size, s.size)) big = Math.max(big, o.size);
      }
    }
    if (s.size < 0.8 * big) s.script = true;
  }
  return spans;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Merge spans on the same baseline into lines (ChemDraw text often arrives as one span per run).
 * Sub/superscripts join the text they belong to without a space (BF3K, 90%^a); a superscript
 * footnote letter becomes "^a". A gap wider than about one character height starts a new line,
 * so table columns and labels side by side stay apart.
 */
export function groupLines(spansIn: Span[], ygap = 2.5): Line[] {
  const spans = spansIn.filter((s) => s.text.trim());
  if (!spans.length) return [];
  type G = { spans: Span[]; bbox: [number, number, number, number]; size: number };
  const groups: G[] = [];
  const plain = spans.filter((s) => !s.script).sort((a, b) => round1(a.y1) - round1(b.y1) || a.x0 - b.x0);
  for (const s of plain) {
    let home: G | null = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i], b = g.bbox, last = g.spans[g.spans.length - 1];
      if (Math.abs(b[3] - s.y1) < ygap && s.x0 - b[2] < 1.0 * Math.max(s.size, g.size) && (s.x0 - b[2] >= -1.5 || s.x0 >= last.x0 + 0.6 * (last.x1 - last.x0))) { home = g; break; }
      if (b[3] < s.y1 - 3 * Math.max(s.size, 1)) break;
    }
    if (!home) groups.push({ spans: [s], bbox: [s.x0, s.y0, s.x1, s.y1], size: s.size });
    else {
      const b = home.bbox;
      home.spans.push(s);
      b[2] = Math.max(b[2], s.x1);
      b[1] = Math.min(b[1], s.y0); b[3] = Math.max(b[3], s.y1);
    }
  }
  for (const s of spans.filter((x) => x.script)) {
    const mid = (s.y0 + s.y1) / 2;
    let best: G | null = null;
    for (const g of groups) {
      const b = g.bbox;
      if (b[1] - 1.5 <= mid && mid <= b[3] + 1.5 && b[0] - g.size <= s.x0 && s.x0 <= b[2] + 0.6 * g.size) {
        if (!best || b[0] > best.bbox[0]) best = g;
      }
    }
    if (!best) groups.push({ spans: [s], bbox: [s.x0, s.y0, s.x1, s.y1], size: s.size });
    else { best.spans.push(s); best.bbox[0] = Math.min(best.bbox[0], s.x0); best.bbox[2] = Math.max(best.bbox[2], s.x1); }
  }
  const lines: Line[] = [];
  for (const g of groups) {
    let text = '', first = true, prev: Span | null = null, startsMarker = false;
    const bold: string[] = [];
    for (const s of [...g.spans].sort((a, b) => a.x0 - b.x0)) {
      let piece = s.text.trim();
      const letters = s.script ? markerLetters(piece) : [];
      if (letters.length) piece = letters.map((x) => `^${x}`).join('');
      if (first) { startsMarker = letters.length > 0; text = piece; }
      else {
        const gap = s.x0 - prev!.x1;
        let glue = s.script || /[(\-/^]$/.test(text) || (gap < 0.12 * s.size && !/^\s/.test(s.text)) || /^[,.;:)%]/.test(piece) ? '' : ' ';
        if (prev!.script && !s.script && /^[\p{L}\p{N}]/u.test(piece) && !(prev!.text.trim() && markerLetters(prev!.text).length)) glue = '';
        text += glue + piece;
      }
      if (s.bold && !s.script) bold.push(s.text.trim());
      first = false;
      prev = s;
    }
    lines.push({ text: text.replace(/\s+/g, ' ').trim(), bbox: [...g.bbox], size: g.size, bold_parts: bold, starts_with_marker: startsMarker });
  }
  lines.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return lines;
}

// ---------------------------------------------------------------- tables

const HEADER_KW = /^(entry|run|yield|ee|er|dr|d\.r\.|e\.r\.|conv|time|t\s*\(|temp|solvent|catalyst|cat\.|ligand|base|additive|substrate|product|selectivity|ratio|aryl|alkyne|alkene|amine|ketone|aldehyde|.*\(%\)|.*mol\s*%|[A-Z]?\d?\s*\/\s*\d)/i;
const FIELD: [string, RegExp][] = [
  ['entry', /^(entry|run)/i], ['product_id', /^product/i],
  ['substrate_id', /^(aryl|substrate|starting|alkyne|alkene|amine|ketone|aldehyde|reactant|sm\b)/i],
  ['yield', /yield/i], ['ee', /^ee[a-h]?\b|\bee[a-h]?\s*\(|e\.e\./i],
  ['er', /^er[a-h]?\b|\ber[a-h]?\s*\(|e\.r\./i],
  ['dr', /^dr[a-h]?\b|\bdr[a-h]?\s*\(|d\.r\./i],
  ['conversion', /conv/i], ['time', /^time|^t\s*\((h|min)/i],
  ['temperature', /^temp|^T\s*\(°/i], ['loading', /mol\s*%/i],
];

export function headerField(h0: string): string {
  let h = splitFootnotes(h0.trim())[0];
  h = h.trim().replace(/([)%])[a-h]$/, '$1');
  for (const [name, rx] of FIELD) if (rx.test(h)) return name;
  return h;
}

type Row = { cy: number; lines: Line[] };
function rowsByY(lines: Line[], tol = 3.0): Row[] {
  const rows: Row[] = [];
  for (const L of [...lines].sort((a, b) => a.bbox[1] - b.bbox[1])) {
    const cy = (L.bbox[1] + L.bbox[3]) / 2;
    if (rows.length && Math.abs(cy - rows[rows.length - 1].cy) < tol) rows[rows.length - 1].lines.push(L);
    else rows.push({ cy, lines: [L] });
  }
  return rows;
}

export interface TableRow { cells: Record<string, string>; fields: Values; bbox: [number, number, number, number] }
export interface Table { columns: string[]; rows: TableRow[]; bbox: [number, number, number, number] }

/**
 * Text-layer tables: a header row with at least three column titles, at least two of them
 * results/condition keywords, then body rows anchored on the first column (usually Entry).
 * Marks the lines used (in_table).
 */
export function findTables(lines: Line[]): Table[] {
  const tables: Table[] = [];
  const ys = rowsByY(lines);
  const usedRows = new Set<number>();
  ys.forEach((hdr, i) => {
    if (usedRows.has(i)) return;
    const cells = hdr.lines.filter((L) => !markerLetters(L.text).length).sort((a, b) => a.bbox[0] - b.bbox[0]);
    if (cells.length < 3 || cells.filter((c) => HEADER_KW.test(splitFootnotes(c.text)[0])).length < 2) return;
    if (!cells.some((c) => ['yield', 'ee', 'er', 'dr', 'conversion', 'entry'].includes(headerField(c.text)))) return;
    const xStarts = cells.map((c) => c.bbox[0]);
    const xEnd = Math.max(...cells.map((c) => c.bbox[2])) + 40;
    const names = cells.map((c) => c.text);
    const colOf = (L: Line): number => { const ks = xStarts.map((x, k) => (x <= L.bbox[0] + 4 ? k : -1)).filter((k) => k >= 0); return ks.length ? Math.max(...ks) : 0; };
    const body: [number, Row][] = [];
    let lastY = hdr.cy;
    for (let j = i + 1; j < ys.length; j++) {
      const row = ys[j];
      if (row.cy - lastY > 45) break;
      const wide = row.lines.filter((L) => L.bbox[2] - L.bbox[0] > 0.6 * (xEnd - xStarts[0]));
      if (wide.length || row.lines.some((L) => /^(table|scheme|figure)\b/i.test(L.text))) break;
      if (row.lines.filter((c) => HEADER_KW.test(c.text)).length >= 3) break; // the next table's header
      body.push([j, row]);
      lastY = row.cy;
    }
    const entryCol = headerField(names[0]) === 'entry';
    const kept: [number, Row][] = [];
    for (const [j, row] of body) {
      const first = row.lines.filter((L) => colOf(L) === 0 && xStarts[0] - 10 <= L.bbox[0]);
      if (entryCol && first.length && !/^\d{1,3}[a-h]?$/.test(splitFootnotes(first[0].text.trim())[0].trim())) break; // a footnote or body text ends the table
      kept.push([j, row]);
    }
    const cellsIn = kept.flatMap(([, row]) => row.lines).filter((L) => xStarts[0] - 10 <= L.bbox[0] && L.bbox[0] <= xEnd);
    const anchors = cellsIn.filter((L) => colOf(L) === 0).sort((a, b) => a.bbox[1] - b.bbox[1]);
    const outRows = anchors.map((L) => ({ cells: { [names[0]]: L.text } as Record<string, string>, bbox: [...L.bbox] as [number, number, number, number], cy: (L.bbox[1] + L.bbox[3]) / 2, fields: {} as Values }));
    for (const L of [...cellsIn].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])) {
      const j = colOf(L);
      if (j === 0 || !outRows.length) continue;
      const cy = (L.bbox[1] + L.bbox[3]) / 2;
      const r = outRows.reduce((m, x) => (Math.abs(x.cy - cy) < Math.abs(m.cy - cy) ? x : m));
      const key = names[j];
      r.cells[key] = key in r.cells ? `${r.cells[key]} ${L.text}` : L.text;
      r.bbox = [Math.min(r.bbox[0], L.bbox[0]), Math.min(r.bbox[1], L.bbox[1]), Math.max(r.bbox[2], L.bbox[2]), Math.max(r.bbox[3], L.bbox[3])];
    }
    const rows: TableRow[] = outRows.map((r) => ({ cells: r.cells, bbox: r.bbox, fields: rowFields(r.cells) }));
    if (rows.length) {
      for (const c of hdr.lines) c.in_table = true;
      for (const L of cellsIn) L.in_table = true;
      for (const [j] of kept) usedRows.add(j);
      const bottom = Math.max(...rows.map((r) => r.bbox[3]));
      tables.push({ columns: names, rows, bbox: [xStarts[0], Math.min(...cells.map((c) => c.bbox[1])), xEnd, bottom] });
    }
  });
  return tables;
}

/** A table row's cells by meaning: {entry, product_id, yield, ee, …, footnotes}. */
export function rowFields(cells: Record<string, string>): Values {
  const parsed: Values = {};
  for (const [k, v] of Object.entries(cells)) {
    const f = headerField(k);
    const [clean, notes] = splitFootnotes(normalize(v));
    let vv = clean.trim();
    if (['yield', 'ee', 'conversion'].includes(f)) { const m = /[<>≥≤]?\s*\d+(?:\.\d+)?/.exec(vv); vv = m ? m[0].replace(/\s+/g, '') : vv; }
    if (['er', 'dr'].includes(f)) { const m = new RegExp(RATIO).exec(vv); vv = m ? m[0].replace(/\s+/g, '') : vv; }
    if (['product_id', 'substrate_id'].includes(f)) { const ids = rankIds(findIds(vv)); vv = ids.length ? ids[0] : vv; }
    parsed[f] = vv;
    if (notes.length) ((parsed.footnotes ??= []) as string[]).push(...notes);
  }
  return parsed;
}

export const QUANT = 'quant.';
export const RACEMIC = 'rac';
export const isQuant = (text: unknown): boolean => /^quant(?:\.|itative)?$/i.test(normalize(String(text ?? '')).trim());
export const isRacemic = (text: unknown): boolean => /^rac(?:\.|emic)?$/i.test(normalize(String(text ?? '')).trim());

/** A yield/ee/er/dr/conversion cell as a value ('' for a cell with none: "–", "n.d.", "trace"). */
function cellValue(kind: string, text0: unknown): string {
  const text = String(text0 ?? '').trim();
  if (/\d/.test(text)) return text;
  if ((kind === 'yield' || kind === 'conversion') && isQuant(text)) return QUANT;
  if ((kind === 'ee' || kind === 'er') && isRacemic(text)) return RACEMIC;
  return '';
}

/** One record per row with a product ID; rows whose product ID is repeated in the table (an optimization table) only count as mentions. */
export function tableRecords(table: Table): Rec[] {
  const rows = table.rows.map((r) => r.fields);
  const ids = rows.map((f) => String(f.product_id ?? ''));
  const out: Rec[] = [];
  for (const f of rows) {
    const pid = String(f.product_id ?? '');
    if (!pid || !ID_RE.test(pid)) continue;
    const rec: Rec = { ids: [pid], text: Object.entries(f).filter(([k]) => k !== 'footnotes').map(([k, v]) => `${k}: ${String(v)}`).join(' | '), entry: f.entry ?? '' };
    if (ids.filter((x) => x === pid).length === 1) {
      for (const k of ['yield', 'ee', 'er', 'dr', 'conversion']) {
        const v = cellValue(k, f[k]);
        if (v === RACEMIC && k === 'er') { if (!('ee' in rec)) rec.ee = v; }
        else if (v) rec[k] = v;
      }
      if (rec.er && !rec.ee) { const ee = erToEe(String(rec.er)); if (ee !== null) rec.ee_from_er = ee; }
    } else rec.repeated = true;
    if (Array.isArray(f.footnotes) && f.footnotes.length) rec.footnotes = uniq(f.footnotes as string[]);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------- labels under structures

type Box = readonly number[];
const overlapX = (a: Box, b: Box): number => Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
const centreInside = (inner: Box, outer: Box, slack = 0): boolean => { const cx = (inner[0] + inner[2]) / 2; return outer[0] - slack <= cx && cx <= outer[2] + slack; };
const CAPTION_START = /^(scheme|table|figure|fig\.|chart)\s*S?\d/i;

/** Mark the lines of body-text paragraphs (body) so that they are not taken for figure labels. */
export function markBody(lines: Line[]): void {
  const cy = (L: Line): number => (L.bbox[1] + L.bbox[3]) / 2;
  const skip = (L: Line): boolean => !!L.footnote || !!L.in_table || CAPTION_START.test(L.text);
  const nextRow = (L: Line, B: Line): boolean => { const size = Math.max(B.size ?? 10, 1); const d = Math.abs(cy(L) - cy(B)); return 0.5 * size <= d && d <= 2.0 * size && overlapX(L.bbox, B.bbox) > 0; };
  const sameRow = (L: Line, B: Line): boolean => { const size = Math.max(B.size ?? 10, 1); return Math.abs(cy(L) - cy(B)) < 0.5 * size && Math.min(Math.abs(L.bbox[0] - B.bbox[2]), Math.abs(B.bbox[0] - L.bbox[2])) < 2 * size; };
  const free = lines.filter((L) => !skip(L));
  const todo = free.filter((L) => words(L.text).length >= 9);
  const wordy = free.filter((L) => words(L.text).length >= 4);
  const seen = new Set<Line>();
  for (const L of wordy) {
    if (seen.has(L)) continue;
    const group: Line[] = [], stack = [L];
    seen.add(L);
    while (stack.length) {
      const A = stack.pop()!;
      group.push(A);
      for (const B of wordy) if (!seen.has(B) && nextRow(B, A)) { seen.add(B); stack.push(B); }
    }
    if (group.length >= 3) todo.push(...group);
  }
  for (const L of todo) L.body = true;
  while (todo.length) {
    const B = todo.pop()!;
    for (const L of free) if (!L.body && (sameRow(L, B) || nextRow(L, B))) { L.body = true; todo.push(L); }
  }
}

/** Merge a value line's values into a label's record (the first of each kind; footnotes added). */
function mergeInto(rec: Rec, a: Rec, skip: string[]): void {
  for (const [k, v] of Object.entries(a)) {
    if (skip.includes(k)) continue;
    if (k === 'footnotes') (rec.footnotes ??= []).push(...(v as string[]));
    else if (!(k in rec)) rec[k] = v;
  }
}

/**
 * Figure labels without structure boxes (a PDF page, a Word figure): an ID line and the value
 * lines straight under it, which overlap it left to right and follow within about two line
 * heights. A value line goes to the nearest such line above it, never past another label.
 */
export function labelRecords(lines: Line[]): (Rec & { bbox: number[] })[] {
  type C = Rec & { bbox: number[]; size: number; bold_ids: string[] };
  const cands: C[] = [];
  for (const L of lines) {
    if (L.in_table || L.footnote || L.body || words(L.text).length > 10) continue;
    const a = annotateText(L.text) as C;
    const boldIds = (L.bold_parts ?? []).flatMap((p) => findIds(splitFootnotes(p)[0]));
    if (boldIds.length) a.ids = rankIds([...a.ids, ...boldIds], boldIds);
    else if (a.ids.length > 1) { const one = singleLabel(L.text, a.ids); if (one) a.ids = [one]; }
    if (!a.ids.length && !hasValues(a)) continue;
    a.bbox = [...L.bbox];
    a.size = L.size ?? 10;
    a.bold_ids = boldIds;
    cands.push(a);
  }
  cands.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  type A = Rec & { bbox: number[]; lines: string[] };
  const anchors: A[] = [];
  const attached: [number[], A][] = [];
  for (const a of cands) {
    if (a.ids.length && (a.ids.length === 1 || a.bold_ids.length) && (words(a.text).length <= 8 || hasValues(a))) {
      const rec = Object.fromEntries(Object.entries(a).filter(([k]) => !['bbox', 'size', 'bold_ids'].includes(k))) as A;
      rec.ids = rec.ids.slice(0, 1);
      rec.bbox = [...a.bbox];
      rec.lines = [a.text];
      anchors.push(rec);
      attached.push([a.bbox, rec]);
      continue;
    }
    if (a.ids.length || !hasValues(a)) continue;
    let best: A | null = null, bestGap: number | null = null;
    for (const [box, rec] of attached) {
      const gap = a.bbox[1] - box[3];
      if (gap < -0.5 * a.size || gap > 1.6 * a.size) continue;
      if (overlapX(box, a.bbox) <= 0 && !centreInside(box, a.bbox)) continue;
      if (bestGap === null || gap < bestGap) { best = rec; bestGap = gap; }
    }
    if (!best) continue;
    mergeInto(best, a, ['text', 'ids', 'bbox', 'size', 'bold_ids']);
    best.lines.push(a.text);
    best.bbox[3] = Math.max(best.bbox[3], a.bbox[3]);
    attached.push([a.bbox, best]);
  }
  return anchors.map((rec) => { const { lines: ls, ...rest } = rec; return { ...rest, text: ls.join(' / ') } as Rec & { bbox: number[] }; });
}

/** Is a text box written along a reaction arrow (above or below it, within its length)? */
function alongArrow(bb: Box, arrow: Box): boolean {
  const ax0 = Math.min(arrow[0], arrow[2]), ay0 = Math.min(arrow[1], arrow[3]), ax1 = Math.max(arrow[0], arrow[2]), ay1 = Math.max(arrow[1], arrow[3]);
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  if (ax1 - ax0 >= ay1 - ay0) return ax0 - 10 <= cx && cx <= ax1 + 10 && ay0 - 45 <= cy && cy <= ay1 + 45;
  return ay0 - 10 <= cy && cy <= ay1 + 10 && ax0 - 60 <= cx && cx <= ax1 + 60;
}

export interface Block { text: string; bbox: number[]; fallback?: boolean; bold_ids?: string[] }

/**
 * Tie text blocks to structures (boxes), as ChemDraw scope schemes are drawn: the label and
 * values sit UNDER a structure, between its bottom edge and the next structure below. A block
 * under no structure goes to the nearest one if it is close and looks like a label, but not if it
 * is written along a reaction arrow or only gives conditions (marked fallback). Per structure,
 * its blocks top to bottom.
 */
export function assignToStructures(boxes: Box[], blocks: Block[], arrows: Box[] = []): Block[][] {
  const out: Block[][] = boxes.map(() => []);
  if (!boxes.length) return out;
  for (const blk of blocks) {
    const bb = blk.bbox;
    let best: number | null = null, bestGap: number | null = null;
    boxes.forEach((b, j) => {
      if (bb[1] < b[3] - 0.25 * (b[3] - b[1])) return; // not below this structure
      const width = bb[2] - bb[0];
      const ov = overlapX(b, bb);
      if (ov < 0.3 * Math.min(width, b[2] - b[0]) && !centreInside(bb, b, 4)) return;
      const gap = bb[1] - b[3];
      const blocked = boxes.some((o, k) => k !== j && overlapX(o, bb) > 0 && b[3] <= o[1] && o[1] <= bb[1]);
      if (blocked) return;
      if (bestGap === null || gap < bestGap) { best = j; bestGap = gap; }
    });
    if (best !== null && bestGap !== null && bestGap <= Math.max(60, 1.2 * (boxes[best][3] - boxes[best][1]))) { out[best].push(blk); continue; }
    const a = annotateText(blk.text);
    if (!(a.ids.length || hasValues(a))) continue;
    if (arrows.some((arrow) => alongArrow(bb, arrow))) continue;
    if (!hasValues(a) && quantities(blk.text, false).length) continue;
    blk.fallback = true;
    const dists = boxes.map((b) => dist(b, bb));
    let j = 0;
    dists.forEach((d, k) => { if (d < dists[j]) j = k; });
    const h = boxes[j][3] - boxes[j][1];
    if (dists[j] <= 0.6 * h + 12) out[j].push(blk);
  }
  for (const bs of out) bs.sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback) || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  return out;
}

function dist(box: Box, bb: Box): number {
  const [x0, y0, x1, y1] = box;
  const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
  const dx = x0 <= cx && cx <= x1 ? 0 : Math.min(Math.abs(cx - x0), Math.abs(cx - x1));
  let dy = y0 <= cy && cy <= y1 ? 0 : Math.min(Math.abs(cy - y0), Math.abs(cy - y1));
  if (cy < y0) dy *= 1.6;
  return Math.hypot(dx, dy);
}

/** One structure's label from its text lines, top to bottom: the ID from the first line that has one (bold IDs first), values from all of them. */
export function mergeBlocks(texts: string[], boldIds: readonly string[] = []): Rec {
  const rec: Rec = { ids: [], text: texts.join(' / ') };
  for (const text of texts) {
    const a = annotateText(text);
    if (a.ids.length && !rec.ids.length) rec.ids = boldIds.length ? rankIds([...a.ids, ...boldIds], boldIds).slice(0, 1) : [singleLabel(text, a.ids) || a.ids[0]];
    mergeInto(rec, a, ['text', 'ids']);
  }
  return rec;
}

// ---------------------------------------------------------------- footnotes

const FOOTNOTE_START = /^(?:\^([a-h])|\[([a-h])\]|\(([a-h])\)|([a-h])(?=\s*[A-Z0-9]))\s*/;

export type FootEntry = [string, string, number];

/**
 * Footnotes printed under a table or scheme: lines starting with a marker ("^a Isolated
 * yield.", "[b] 48 h.", "(b) …" or "b Reaction run at 60 °C."). A plain letter only starts a
 * footnote when `plain` is true, or (`plain` null: a page) when the line sits right under a
 * scheme's or table's text or another footnote. [[marker, text, y], …]; marks the lines used.
 */
export function footnoteEntries(lines: Line[], plain: boolean | null = null): FootEntry[] {
  const entries: FootEntry[] = [];
  const ordered = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  let current: FootEntry | null = null, last: Line | null = null;
  ordered.forEach((L, n) => {
    const text = L.text;
    const m = FOOTNOTE_START.exec(text);
    let starts: boolean = m !== null && !!(L.starts_with_marker || m[1] || m[2] || m[3]);
    if (m !== null && !starts && plainFootnote(text)) starts = plain !== null ? plain : underFigure(L, ordered.slice(0, n));
    if (starts) {
      for (const [marker, body] of splitInline(text)) { current = [marker, body, L.bbox[1]]; entries.push(current); }
      L.footnote = true;
      last = L;
      return;
    }
    if (current && last) {
      const prevLine: Line = last;
      const gap = L.bbox[1] - prevLine.bbox[3];
      if (gap >= 0 && gap < 0.8 * (L.size ?? 10) && Math.abs(L.bbox[0] - prevLine.bbox[0]) < 3 && words(text).length > 2) {
        current[1] = joinWrapped(current[1], text);
        L.footnote = true;
        last = L;
        return;
      }
    }
    current = null;
  });
  return entries;
}

/** {marker: text} of the footnotes among `lines` (the first of each marker). */
export function footnoteLines(lines: Line[], plain: boolean | null = null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [marker, text] of footnoteEntries(lines, plain)) if (!(marker in out)) out[marker] = text;
  return out;
}

/** The footnotes that apply to a label at height y: for each marker the nearest one below it, else the nearest above. */
export function footnotesFor(entries: FootEntry[], y: number): Record<string, string> {
  const out: Record<string, string> = {};
  const sorted = [...entries].sort((a, b) => Number(a[2] < y) - Number(b[2] < y) || Math.abs(a[2] - y) - Math.abs(b[2] - y));
  for (const [marker, text] of sorted) if (!(marker in out)) out[marker] = text;
  return out;
}

function underFigure(L: Line, above: Line[]): boolean {
  const size = Math.max(L.size ?? 10, 1);
  const near = above.filter((o) => o !== L && overlapX(o.bbox, L.bbox) > 0 && -0.3 * size <= L.bbox[1] - o.bbox[3] && L.bbox[1] - o.bbox[3] <= 3 * size);
  if (!near.length) return false;
  const o = near.reduce((m, x) => (x.bbox[3] > m.bbox[3] ? x : m));
  if (o.footnote || o.in_table || CAPTION_START.test(o.text)) return true;
  if (words(o.text).length > 10) return false;
  const a = annotateText(o.text);
  return !!(a.ids.length || hasValues(a));
}

const plainFootnote = (text: string): boolean => /^[a-h]\s+[A-Z][a-z]/.test(text) || /^[a-h][A-Z][a-z]/.test(text);

function splitInline(text: string): [string, string][] {
  const marks = all(guardedAt(/(?:\^([a-h])|\[([a-h])\])\s*/g, (at, s) => at === 0 || /[\s.;)]/.test(s[at - 1])), text);
  if (marks.length && marks[0].index === 0) {
    return marks.map((m, i) => [m[1] ?? m[2], text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : text.length).trim()]);
  }
  const m = FOOTNOTE_START.exec(text);
  if (m) return [[(m[1] ?? m[2] ?? m[3] ?? m[4])!, text.slice(m[0].length).trim()]];
  return [];
}

const joinWrapped = (a: string, b: string): string => (a.endsWith('-') && !a.endsWith(' -') ? a + b : `${a} ${b}`);

// ---------------------------------------------------------------- body text

const NAME_WORDS = new Set(['methyl', 'ethyl', 'propyl', 'isopropyl', 'butyl', 'tert-butyl', 't-butyl', 'benzyl', 'phenyl', 'allyl', 'vinyl', 'cyclohexyl', 'pentyl', 'hexyl', 'octyl', 'dimethyl', 'diethyl', 'dibenzyl', 'di-tert-butyl', 'trimethylsilyl']);
const NAME_TAILS = new Set(['acid', 'ester', 'oxide', 'chloride', 'bromide', 'iodide', 'fluoride', 'anhydride', 'amide', 'hydrochloride', 'salt', 'acetate', 'triflate', 'carbonate', 'sulfate', 'ether']);
const CHEM_SUFFIX = /(ane|ene|yne|ol|one|al|ate|ide|ine|amine|oate|ile|ium|ole|ane|ose|yl|ate|ite|one|oic|ic)$/i;
const NOT_NAME = new Set(['compound', 'compounds', 'product', 'products', 'substrate', 'substrates', 'adduct', 'derivative', 'ester', 'alcohol', 'amine', 'ketone', 'aldehyde', 'alkene', 'alkyne', 'table', 'scheme', 'figure', 'entry', 'the', 'and', 'of', 'to', 'in', 'from', 'with', 'intermediate', 'analogue', 'analog']);
const NOT_A_NAME = /(?:yl|ic)$|\belectron-|-(?:poor|rich|substituted|based|derived|containing|bearing|type|like|protected|free|deficient|donating|withdrawing|functionali[sz]ed)$/i;

const stripChars = (s: string, chars: string): string => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };

/** [name, ID] for every "name (ID)" in running text that looks like a chemical name. */
export function namesWithIds(text: string): [string, string][] {
  const t = normalize(text);
  const out: [string, string][] = [];
  for (const m of all(/\(\s*([^()\s,;]{1,14})\s*\)/g, t)) {
    const label = m[1];
    if (!ID_RE.test(label) || (/^\d+$/.test(label) && label.length > 2)) continue;
    const before = t.slice(0, m.index).trimEnd();
    const ws = before.split(' ');
    if (!ws.length || !ws[ws.length - 1]) continue;
    const core = ws[ws.length - 1];
    if (NOT_NAME.has(stripChars(core.toLowerCase(), ',.;:')) || !/[A-Za-z]{3}/.test(core)) continue;
    const nameWords = [core];
    let i = ws.length - 2;
    if (NAME_TAILS.has(core.toLowerCase()) && i >= 0) { nameWords.unshift(ws[i]); i--; }
    while (i >= 0 && NAME_WORDS.has(ws[i].toLowerCase())) { nameWords.unshift(ws[i]); i--; }
    let name = stripChars(nameWords.join(' '), ',.;: ');
    name = name.replace(/^[([]+(?![^()]*\))/, '');
    if (NOT_A_NAME.test(name)) continue;
    const chemLike = /[-,\d[\]]/.test(name) || (CHEM_SUFFIX.test(name) && name.length >= 8);
    if (chemLike && name.length >= 5) out.push([name, label]);
  }
  return out;
}

const NOT_SCOPE_SENTENCE = /\b(?:without|controls?|scale[ds]?|scale-up|mmol|grams?|gram-scale|entry|entries)\b|\d\s*g\s+scale/i;

/** Yields, ee and dr stated in running text: a sentence with exactly one letter-suffixed ID and an explicit "92% yield", "95% ee"… */
export function sentenceRecords(text: string): Rec[] {
  const out: Rec[] = [];
  const t = normalize(text);
  for (const sentence of t.split(after(/\s+(?=[A-Z(])/, /[.;]/))) {
    if (NOT_SCOPE_SENTENCE.test(sentence)) continue;
    const [clean, notes] = splitFootnotes(sentence);
    const ids = new Set(findIds(clean).filter((i) => /\d[a-z]/.test(i)));
    if (ids.size !== 1) continue;
    const vals = parseValues(clean);
    delete vals.yield_assumed;
    if (!['yield', 'ee', 'er', 'dr'].some((k) => k in vals)) continue;
    const rec: Rec = { ids: [[...ids][0]], text: sentence.trim().slice(0, 300) };
    for (const [k, v] of Object.entries(vals)) if (['yield', 'ee', 'er', 'dr', 'ee_from_er'].includes(k)) rec[k] = v;
    if (notes.length) rec.footnotes = notes;
    out.push(rec);
  }
  return out;
}

/** IDs mentioned in running text in a way that is clearly a compound: "(3a)", "compound 3h", "products 3a–3f" (the first). */
export function mentionedIds(text: string): Set<string> {
  return new Set(all(/(?:\b[Cc]ompounds?\s+|\b[Pp]roducts?\s+|\()((?:S|SI-)?\d{1,3}[a-z]{1,3}'*)(?=[\s),;.:]|$)/g, normalize(text)).map((m) => m[1]));
}

/** Every word of a text as an ID key (for "is this ID anywhere in the manuscript?"). */
export function allTokens(text: string): Set<string> {
  return new Set(normalize(text).split(/[\s,;/–]+/).filter(Boolean).map((w) => idKey(stripChars(w, '()[].,;:'))));
}

// ---------------------------------------------------------------- conditions

/** A condition written in a text: a number (°C, minutes, equiv, mol%, mmol, M) or a word ("rt", "reflux", a name). */
export interface Quantity { kind: string; value: number | string; text: string }

// What a word stands for, as a range (°C; minutes).
const RANGES: Record<string, [number, number]> = { 'temperature:rt': [20, 25], 'time:overnight': [720, 1080] };

/** Equal, counting wordings that mean the same: "rt" = 20–25 °C, "overnight" = 12–18 h. */
export function sameQuantity(a: Quantity, b: Quantity): boolean {
  if (a.kind !== b.kind) return false;
  const x = a.value, y = b.value;
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x));
  if (typeof x === 'number' || typeof y === 'number') {
    const [word, number] = typeof x === 'number' ? [y, x] : [x, y as number];
    const r = RANGES[`${a.kind}:${String(word)}`];
    return !!r && r[0] <= number && number <= r[1];
  }
  return String(x) === String(y);
}

// Reaction solvents and common reagents, with the other ways they are written (lower case).
export const REAGENT_SYNONYMS: Record<string, string[]> = {
  THF: ['thf', 'tetrahydrofuran'], '2-MeTHF': ['2-methf', '2-methyltetrahydrofuran'],
  DCM: ['dcm', 'ch2cl2', 'dichloromethane', 'methylene chloride'],
  DCE: ['dce', '1,2-dichloroethane', 'dichloroethane', '(ch2cl)2'],
  MeCN: ['mecn', 'ch3cn', 'acetonitrile'], toluene: ['toluene', 'phme', 'phch3'],
  benzene: ['benzene', 'c6h6'], DMF: ['dmf', 'n,n-dimethylformamide', 'dimethylformamide'],
  DMA: ['dma', 'dmac', 'n,n-dimethylacetamide', 'dimethylacetamide'],
  DMSO: ['dmso', 'dimethyl sulfoxide', 'dimethylsulfoxide'], NMP: ['nmp'],
  dioxane: ['dioxane', '1,4-dioxane'], Et2O: ['et2o', 'diethyl ether', 'ether'],
  MTBE: ['mtbe', 'tbme'], CPME: ['cpme'], MeOH: ['meoh', 'methanol'],
  EtOH: ['etoh', 'ethanol'], iPrOH: ['iproh', 'i-proh', 'ipa', '2-propanol', 'isopropanol', 'isopropyl alcohol'],
  tBuOH: ['tbuoh', 't-buoh', 'tert-butanol', 'tert-butyl alcohol'],
  HFIP: ['hfip', 'hexafluoroisopropanol', '1,1,1,3,3,3-hexafluoro-2-propanol'],
  TFE: ['tfe', '2,2,2-trifluoroethanol', 'trifluoroethanol'], AcOH: ['acoh', 'acetic acid'],
  TFA: ['tfa', 'trifluoroacetic acid'], EtOAc: ['etoac', 'ethyl acetate'],
  hexane: ['hexane', 'hexanes', 'n-hexane'], pentane: ['pentane', 'n-pentane'],
  heptane: ['heptane', 'n-heptane'], xylene: ['xylene', 'xylenes', 'o-xylene', 'p-xylene', 'm-xylene'],
  mesitylene: ['mesitylene'], PhCl: ['phcl', 'chlorobenzene'],
  PhCF3: ['phcf3', 'trifluorotoluene', 'benzotrifluoride'], water: ['water', 'h2o'],
  acetone: ['acetone'], CHCl3: ['chcl3', 'chloroform'], CCl4: ['ccl4'],
  MeNO2: ['meno2', 'ch3no2', 'nitromethane'], pyridine: ['pyridine'],
  DBU: ['dbu'], DIPEA: ['dipea', "hünig's base", 'ipr2net', 'i-pr2net'],
  Et3N: ['et3n', 'triethylamine', 'net3'], DMAP: ['dmap'], NBS: ['nbs'],
  NIS: ['nis'], NCS: ['ncs'], TBAF: ['tbaf'], LDA: ['lda'],
  LiHMDS: ['lihmds'], NaHMDS: ['nahmds'], KHMDS: ['khmds'],
  'DIBAL-H': ['dibal-h', 'dibal'], mCPBA: ['mcpba', 'm-cpba'], TEMPO: ['tempo'],
  DDQ: ['ddq'], AIBN: ['aibn'], Xantphos: ['xantphos'], BINAP: ['binap'],
  XPhos: ['xphos'], SPhos: ['sphos'], RuPhos: ['ruphos'], dppf: ['dppf'],
  'Pd/C': ['pd/c'], TMSCl: ['tmscl'], TMSCN: ['tmscn'], HBpin: ['hbpin'],
  B2pin2: ['b2pin2'], TsOH: ['tsoh', 'p-tsoh'], CSA: ['csa'],
  // atmospheres ("Ar" alone is too often the aryl group: see ATMOSPHERE)
  N2: ['n2', 'nitrogen'], Ar: ['argon'], O2: ['o2', 'oxygen', 'air'],
};
/** The solvents among them (for the check of SI procedures against their general procedure). */
export const SOLVENTS = new Set(['THF', '2-MeTHF', 'DCM', 'DCE', 'MeCN', 'toluene', 'benzene', 'DMF', 'DMA', 'DMSO', 'NMP', 'dioxane', 'Et2O', 'MTBE', 'CPME', 'MeOH', 'EtOH', 'iPrOH', 'tBuOH', 'HFIP', 'TFE', 'AcOH', 'EtOAc', 'hexane', 'pentane', 'heptane', 'xylene', 'mesitylene', 'PhCl', 'PhCF3', 'water', 'acetone', 'CHCl3', 'CCl4', 'MeNO2', 'pyridine']);
const ATMOSPHERE = /\b(?:under|an?|of|with|in)\s+(?:an?\s+|dry\s+)?(Ar)\b|\b(Ar)\s+(?:atmosphere|balloon|gas|\(1\s*atm\))/g;
const REAGENT_ALIASES = new Map<string, string>(Object.entries(REAGENT_SYNONYMS).flatMap(([name, aliases]) => aliases.map((a): [string, string] => [a, name])));
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const REAGENT_RE = notAfter(new RegExp(`(${[...REAGENT_ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\w-])`, 'gi'), /[\w-]/);

const TEMP = notAfter(/(-?\d{1,3}(?:\.\d+)?)\s*°\s*C\b|(-?\d{1,3})\s*(?:o|º)C\b/g, /[\w.]/);
const TEMP_WORD = /\b(rt\b|r\.\s?t\.(?!\w)|room temperature\b|ambient temperature\b|reflux(?:ing)?\b)/gi;
const TIME = notAfter(/(\d+(?:\.\d+)?)\s*(min|mins|minutes?|hrs?|hours?|days?|d|h)\b(?!\s*%)/g, /[\w.-]/);
const EQUIV = notAfter(/(\d+(?:\.\d+)?)\s*(?:equiv\.?|eq\.?|equivalents?)(?![\w])/gi, /[\w.-]/);
const LOADING = notAfter(/(\d+(?:\.\d+)?)\s*mol\s*%/gi, /[\w.-]/);
const SCALE = notAfter(/(\d+(?:\.\d+)?)\s*(mmol|µmol|μmol|umol)\b/g, /[\w.-]/);
const CONC = notAfter(/(\d+(?:\.\d+)?)\s*M\b(?!\s*%)/g, /[\w.-]/);
const TIME_TO_MIN: Record<string, number> = { min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440 };

/** The reaction conditions written in a text: temperatures, times ("3 h" but not "3h"), equivalents, mol%, scale, concentrations and named solvents/reagents. */
export function quantities(text: string, reagentsToo = true): Quantity[] {
  const t = normalize(text).replace(/�C/g, '°C');
  const out: Quantity[] = [];
  for (const m of all(TEMP, t)) out.push({ kind: 'temperature', value: Number(m[1] ?? m[2]), text: m[0].trim() });
  for (const m of all(TEMP_WORD, t)) {
    const word = m[1].toLowerCase().replace(/ /g, '');
    out.push({ kind: 'temperature', value: word.startsWith('reflux') ? 'reflux' : 'rt', text: m[0] });
  }
  for (const m of all(TIME, t)) {
    const unit = m[2].toLowerCase();
    if ((unit === 'h' || unit === 'd') && !/^\d+(?:\.\d+)?\s+[hd]\b/.test(m[0])) continue; // "3h", "4d": compound IDs
    out.push({ kind: 'time', value: Number(m[1]) * TIME_TO_MIN[unit], text: m[0] });
  }
  for (const m of all(/\bovernight\b/gi, t)) out.push({ kind: 'time', value: 'overnight', text: m[0] });
  for (const m of all(EQUIV, t)) out.push({ kind: 'equiv', value: Number(m[1]), text: m[0] });
  for (const m of all(LOADING, t)) out.push({ kind: 'loading', value: Number(m[1]), text: m[0] });
  for (const m of all(SCALE, t)) out.push({ kind: 'scale', value: Number(m[1]) * (m[2] === 'mmol' ? 1 : 0.001), text: m[0] });
  for (const m of all(CONC, t)) out.push({ kind: 'conc', value: Number(m[1]), text: m[0] });
  if (reagentsToo) out.push(...reagents(t));
  return out;
}

/** Named solvents and reagents in a text (THF = tetrahydrofuran, CH2Cl2 = DCM…) and any other chemical formula (K3PO4, Pd(OAc)2). */
export function reagents(text: string): Quantity[] {
  const t = normalize(text);
  const out: Quantity[] = [];
  const seen = new Set<string>();
  for (const m of all(REAGENT_RE, t)) {
    const name = REAGENT_ALIASES.get(m[1].toLowerCase())!;
    if (!seen.has(name)) { seen.add(name); out.push({ kind: 'reagent', value: name, text: m[1] }); }
  }
  for (const m of all(ATMOSPHERE, t)) {
    if (!seen.has('Ar')) { seen.add('Ar'); out.push({ kind: 'reagent', value: 'Ar', text: m[1] ?? m[2] }); }
  }
  for (const f of formulaMatches(t)) {
    const word = t.slice(f.start, f.end);
    const name = REAGENT_ALIASES.get(word.toLowerCase()) ?? word;
    if (!seen.has(name)) { seen.add(name); out.push({ kind: 'reagent', value: name, text: word }); }
  }
  return out;
}

const WORKUP = /\b(?:cool(?:ed|ing)?|quench(?:ed|ing)?|extract(?:ed|ion|ions)?|wash(?:ed|ing)?|dried|drying|concentrat(?:ed|ion)|evaporat(?:ed|ion)|purif(?:ied|ication|y)|chromatograph\w*|column|filter(?:ed|ing)?|filtration|dilut(?:ed|ion)|work-?up|poured|recrystalli[sz]\w*|separated|brine|TLC|Rf|eluent|eluting|silica)\b/i;

/** The sentences of a procedure that describe the reaction itself, without the work-up. */
export function reactionPart(text: string): string {
  return normalize(text).replace(/([.;])\s+/g, '$1\u0000').split(/\u0000|\n+/).filter((s) => s.trim() && !WORKUP.test(s)).join(' ');
}
