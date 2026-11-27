// The manuscript check (SI Assistant SPEC §13o): does the manuscript agree with the SI? A port of
// Chem SI Assistant's core/manuscript.py.
//
// The person adds the manuscript (PDF, Word .docx, or a Chemweave document, which is saved as
// .docx) and its ChemDraw files (.cdxml) to the project's manuscript/ folder (never printed).
// They are read (ms-read.ts) into compound records, which are compared, by compound ID, with the
// SI (only the manuscript → SI direction: a compound only in the SI is not reported):
// * manuscript IDs with data that no SI compound has;
// * the structure (InChIKey of the ChemDraw structure vs the SI's; a different stereochemistry
//   or charge is said so; a salt is compared by its largest piece);
// * yield (the printed numbers must be identical), ee/er (er converted to ee) and dr; values in
//   running-text sentences only give notes;
// * names (ignoring spacing, capitals, kinds of hyphens and quotes);
// * conditions: what a compound's footnote says must be in its SI procedure, and an SI procedure
//   that differs from its general procedure needs a footnote in the manuscript.
//
// Every result is a Finding with a stable key and a fingerprint of its values: it can be dismissed
// (manuscript/dismissed.json, readable) and comes back when the values change. What was read is
// kept in manuscript/check.json, file by file, and read again when a file changes.

import { genericAtoms, mainSpecies, type MolFacts } from './chem';
import { eeWithUnit, partText } from './fields';
import { plainMarkup } from './markup';
import * as P from './ms-parse';
import { READER_VERSION, newSource, readFile, type Progress, type Source } from './ms-read';
import { autoValues, fillSentence } from './procedures';
import { dumpPyJson, parsePyJson } from './pyjson';
import { fp } from './pyrepr';
import { allBoxes } from './scheme-edit';
import { compoundName, compoundsOf, fieldKeys, valuesOf, type Json, type SiCompound, type SiProject } from './project';

export const MANUSCRIPT_DIR = 'manuscript';
export const CACHE_FILE = 'check.json';
export const DISMISSED_FILE = 'dismissed.json';
const DAMAGED_FILE = 'dismissed.damaged.json';
const OWN_FILES = [CACHE_FILE, DISMISSED_FILE, DAMAGED_FILE];
export const MANUSCRIPT_EXTENSIONS = ['.pdf', '.docx', '.doc'];
export const CHEMDRAW_EXTENSIONS = ['.cdxml', '.cdx'];
const CACHE_VERSION = 1;

export const PROBLEM = 'problem', NOTE = 'note', OK = 'ok', DISMISSED = 'dismissed';
export type Status = typeof PROBLEM | typeof NOTE | typeof OK | typeof DISMISSED;

/** What each kind of finding is called in the summary line ("2 yield differences"). */
export const KIND_SUMMARY: Record<string, [string, string]> = {
  missing_si: ['missing in the SI', 'missing in the SI'],
  structure: ['structure difference', 'structure differences'],
  yield: ['yield difference', 'yield differences'],
  ee: ['ee/er difference', 'ee/er differences'],
  dr: ['dr difference', 'dr differences'],
  name: ['name difference', 'name differences'],
  conditions: ['footnote not matched in the SI', 'footnotes not matched in the SI'],
  deviation: ['SI deviation without a footnote', 'SI deviations without a footnote'],
  internal: ['disagreement within the manuscript', 'disagreements within the manuscript'],
};
export const WHAT: Record<string, string> = {
  missing_si: 'ID', structure: 'Structure', yield: 'Yield', ee: 'ee / er', dr: 'dr', name: 'Name',
  conditions: 'Conditions', deviation: 'Conditions', internal: 'Manuscript', mention: 'ID',
};
/** The compound field to open for a finding ('' = the page's top). */
export const FIELD_OF: Record<string, string> = {
  structure: 'structure', yield: 'yield', ee: 'ee', dr: 'dr', name: 'name', conditions: 'procedure', deviation: 'procedure',
};

export interface Finding {
  kind: string;
  /** The compound ID as shown. */
  label: string;
  message: string;
  status: Status;
  /** The SI compound's internal id ('' if none). */
  compound_id: string;
  ms_value: string;
  si_value: string;
  where: string;
  key: string;
  fingerprint: string;
  /** Why it was dismissed (when it was). */
  reason: string;
}

export const findingWhat = (f: Finding): string => WHAT[f.kind] ?? f.kind.charAt(0).toUpperCase() + f.kind.slice(1);

export interface Result {
  findings: Finding[];
  /** SI compounds found in the manuscript. */
  checked: number;
  notes: string[];
  files: number;
}

export const problemsOf = (r: Result): Finding[] => r.findings.filter((f) => f.status === PROBLEM);

export function summary(r: Result): string {
  if (!r.files) return 'No manuscript added yet.';
  const counts = new Map<string, number>();
  for (const f of problemsOf(r)) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const what = `${r.checked} compound${r.checked !== 1 ? 's' : ''} checked`;
  const gone = r.findings.filter((f) => f.status === DISMISSED).length;
  const tail = gone ? ` (${gone} dismissed)` : '';
  if (!counts.size) return `${what}: no differences found.${tail}`;
  const parts: string[] = [];
  for (const [kind, [one, many]] of Object.entries(KIND_SUMMARY)) {
    const n = counts.get(kind) ?? 0;
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  return `${what}: ${parts.join(', ')}.${tail}`;
}

const join = (...parts: string[]): string => parts.filter(Boolean).join('/');
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ---------------------------------------------------------------- the folder

const SYSTEM_FILES = new Set(['desktop.ini', 'thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db', 'icon\r']);
const damagedCopy = (name: string): boolean => /^dismissed\.damaged(-.+)?\.json$/i.test(name);
const conflictCopy = (name: string): boolean => /^(check|dismissed)-.+\.json$/i.test(name);

/** The program's own files (and OneDrive's conflict copies of them), temporary files and hidden or system files. */
export function hiddenFile(name: string): boolean {
  return OWN_FILES.includes(name) || name.startsWith('.') || name.startsWith('~$') || SYSTEM_FILES.has(name.toLowerCase()) || conflictCopy(name) || damagedCopy(name);
}

/** The manuscript files (not the program's own check.json and dismissed.json), by name. */
export async function manuscriptFiles(p: SiProject): Promise<string[]> {
  try {
    const entries = await p.folder.entries(MANUSCRIPT_DIR);
    return entries.filter((e) => !e.folder && !hiddenFile(e.name)).map((e) => e.name).sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  } catch {
    return [];
  }
}

const safeName = (name: string): string => {
  const n = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();
  return n || 'file';
};

/**
 * Copy a file into manuscript/ (a second file of the same name gets " (2)"). `replace`: a file of
 * that name already there is the same document as it was before (an open document added again):
 * it is moved to the project Trash (restorable) and this one takes its place, so the check does
 * not read both. The name it was stored under.
 */
export async function addManuscriptFile(p: SiProject, name: string, bytes: Uint8Array, replace = false): Promise<string> {
  if (p.readOnly) throw new Error('This SI project is open read-only.');
  let base = safeName(name);
  if (damagedCopy(base)) base = base.replace(/^dismissed\./i, 'dismissed_');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
  let pick = base;
  if (replace && !OWN_FILES.includes(pick) && (await p.folder.exists(join(MANUSCRIPT_DIR, pick)))) {
    await p.trashFiles([join(MANUSCRIPT_DIR, pick)], 'manuscript_file', pick, {});
  }
  for (let n = 2; OWN_FILES.includes(pick) || (await p.folder.exists(join(MANUSCRIPT_DIR, pick))); n++) pick = `${stem} (${n})${ext}`;
  await p.folder.writeBytes(join(MANUSCRIPT_DIR, pick), bytes);
  return pick;
}

/** Move a manuscript file to the project Trash (restorable). */
export async function removeManuscriptFile(p: SiProject, name: string): Promise<void> {
  if (p.readOnly) throw new Error('This SI project is open read-only.');
  await p.trashFiles([join(MANUSCRIPT_DIR, name)], 'manuscript_file', name, {});
}

// ---------------------------------------------------------------- reading (cached)

/** A file's stamp: its size and a hash of its bytes (the same file gives the same stamp). */
function stampOf(bytes: Uint8Array): [number, string] {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0; h2 = Math.imul(h2 + bytes[i], 0x5bd1e995) >>> 0; }
  return [bytes.length, `cw-${h1.toString(16)}${h2.toString(16)}`];
}
const sameStamp = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

interface Cached { stamps: Record<string, unknown>; sources: Source[] }
const memory = new WeakMap<SiProject, Cached>();

function wellFormed(s: Source): boolean {
  const strings = (x: unknown): boolean => Array.isArray(x) && x.every((v) => typeof v === 'string');
  return [s.file, s.kind, s.error].every((x) => typeof x === 'string') && Array.isArray(s.records) && Array.isArray(s.names)
    && s.records.every(isObj) && s.names.every((n) => isObj(n) && typeof n.name === 'string')
    && strings(s.mentioned) && strings(s.tokens) && strings(s.notes);
}

/** check.json: (the files' stamps, what they gave); null when there is none or it can't be used. */
async function stored(p: SiProject): Promise<Cached | null> {
  let data: unknown;
  try {
    const text = await p.folder.readText(join(MANUSCRIPT_DIR, CACHE_FILE));
    if (text === null) return null;
    data = parsePyJson(text);
  } catch { return null; }
  if (!isObj(data) || data.version !== CACHE_VERSION || data.reader !== READER_VERSION || !isObj(data.files)) return null;
  const sources: Source[] = [];
  for (const s of Array.isArray(data.sources) ? data.sources : []) {
    if (!isObj(s)) return null;
    const src = newSource(str(s.file), str(s.kind));
    for (const k of Object.keys(src) as (keyof Source)[]) if (k in s) (src as unknown as Json)[k] = s[k];
    if (!wellFormed(src)) return null;
    sources.push(src);
  }
  return { stamps: data.files, sources };
}

async function currentStamps(p: SiProject, names: string[]): Promise<{ stamps: Record<string, unknown>; bytes: Map<string, Uint8Array | null> }> {
  const stamps: Record<string, unknown> = {}, bytes = new Map<string, Uint8Array | null>();
  for (const n of names) {
    let b: Uint8Array | null = null;
    try { b = await p.folder.readBytes(join(MANUSCRIPT_DIR, n)); } catch { b = null; }
    bytes.set(n, b);
    if (b) stamps[n] = stampOf(b);
  }
  return { stamps, bytes };
}

/** What was read last time, if the files haven't changed since (else null). */
export async function cachedSources(p: SiProject): Promise<Source[] | null> {
  const names = await manuscriptFiles(p);
  const { stamps } = await currentStamps(p, names);
  const hit = memory.get(p);
  if (hit && sameStamp(hit.stamps, stamps)) return hit.sources;
  const st = await stored(p);
  if (!st || !sameStamp(st.stamps, stamps)) return null;
  memory.set(p, { stamps, sources: st.sources });
  return st.sources;
}

export interface ReadAllOptions { force?: boolean; progress?: Progress; smiles?: (molblock: string) => Promise<string | null> }

/**
 * Read the manuscript files: a file that hasn't changed since it was last read is not read
 * again, unless `force` ("Check again"). Throws Stopped if the progress callback says stop.
 */
export async function readAll(p: SiProject, opts: ReadAllOptions = {}): Promise<Source[]> {
  const names = await manuscriptFiles(p);
  const { stamps: now, bytes } = await currentStamps(p, names);
  const hit = memory.get(p) ?? (await stored(p));
  if (!opts.force && hit && sameStamp(hit.stamps, now) && !hit.sources.some((s) => s.transient)) {
    memory.set(p, { stamps: now, sources: hit.sources });
    return hit.sources;
  }
  const before = new Map<string, Source>();
  if (!opts.force && hit) for (const s of hit.sources) if (!s.transient) before.set(s.file, s);
  const { prepareReaders } = await import('./ms-read');
  await prepareReaders();
  const sources: Source[] = [];
  for (const n of names) {
    const old = before.get(n);
    if (old && now[n] && hit && sameStamp(hit.stamps[n], now[n])) sources.push(old); // unchanged since it was read
    else sources.push(await readFile(n, bytes.get(n) ?? null, { progress: opts.progress, smiles: opts.smiles }));
  }
  memory.set(p, { stamps: now, sources });
  // a file that could not be opened just now is not written down: read again next time
  const later = new Set(sources.filter((s) => s.transient).map((s) => s.file));
  const kept = Object.fromEntries(Object.entries(now).filter(([n]) => !later.has(n)));
  if (!p.readOnly && Object.keys(kept).length) {
    const at = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    try {
      await p.folder.writeText(join(MANUSCRIPT_DIR, CACHE_FILE), dumpPyJson({
        version: CACHE_VERSION, reader: READER_VERSION, files: kept,
        checked_at: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`,
        note: 'What the Manuscript check read from the files beside this one. Made by Chemweave; safe to delete.',
        sources: sources.filter((s) => !s.transient),
      }));
    } catch { /* only a cache */ }
  }
  return sources;
}

export function forget(p: SiProject): void { memory.delete(p); }

// ---------------------------------------------------------------- dismissals

/** dismissed.json: {} if there is none, null if it is there but doesn't hold JSON. */
async function loadDismissed(p: SiProject): Promise<Json | null> {
  const text = await p.folder.readText(join(MANUSCRIPT_DIR, DISMISSED_FILE));
  if (text === null) return {};
  try {
    const v = parsePyJson(text.replace(/^﻿/, ''));
    return isObj(v) ? v : null;
  } catch { return null; }
}

export async function dismissedOf(p: SiProject): Promise<Json> {
  try { return (await loadDismissed(p)) ?? {}; } catch { return {}; }
}

function localIso(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function dismissFinding(p: SiProject, f: Finding, reason = '', by = ''): Promise<void> {
  if (p.readOnly) throw new Error('This SI project is open read-only.');
  let data = await loadDismissed(p);
  if (data === null) {
    // don't lose what it held: keep a dated copy, never written over
    const old = await p.folder.readBytes(join(MANUSCRIPT_DIR, DISMISSED_FILE));
    const at = localIso(new Date()).replace('T', '_').replace(/:/g, '').replace(/-(\d\d)_/, '-$1_');
    let pick = `dismissed.damaged-${at}.json`;
    for (let n = 2; await p.folder.exists(join(MANUSCRIPT_DIR, pick)); n++) pick = `dismissed.damaged-${at} (${n}).json`;
    if (old) await p.folder.writeBytes(join(MANUSCRIPT_DIR, pick), old);
    data = {};
  }
  data[f.key] = { fingerprint: f.fingerprint, message: f.message, reason: reason.trim(), by, at: localIso(new Date()) };
  await p.folder.writeText(join(MANUSCRIPT_DIR, DISMISSED_FILE), dumpPyJson(data));
}

export async function restoreFinding(p: SiProject, key: string): Promise<void> {
  if (p.readOnly) throw new Error('This SI project is open read-only.');
  const data = (await loadDismissed(p)) ?? {};
  if (key in data) {
    delete data[key];
    await p.folder.writeText(join(MANUSCRIPT_DIR, DISMISSED_FILE), dumpPyJson(data));
  }
}

// ---------------------------------------------------------------- the SI side

const plain = (text: string): string => plainMarkup(text ?? '');

interface SiEntry { compound: SiCompound; label: string; section: string }

/** ({ID key: the SI compound}, {ID key: label} of labels on scheme boxes not linked to a compound). */
export function siCompounds(p: SiProject): [Map<string, SiEntry>, Map<string, string>] {
  const report = p.idReport();
  const out = new Map<string, SiEntry>();
  for (const s of p.dataSections) {
    for (const c of compoundsOf(s)) {
      const label = report.ids.get(c.id);
      if (label && !out.has(P.idKey(label))) out.set(P.idKey(label), { compound: c, label, section: s.name });
    }
  }
  const extra = new Map<string, string>();
  try {
    for (const k of p.schemes) {
      for (const [box] of allBoxes(k)) {
        if (box.compound) continue;
        const label = plain(str(box.label)).trim();
        if (label && !out.has(P.idKey(label))) extra.set(P.idKey(label), label);
      }
    }
  } catch { /* scheme pages are an extra; never stop the check */ }
  return [out, extra];
}

/**
 * Which SI ID a manuscript ID stands for: the same full ID if the SI has it; else the same ID
 * without a stereo prefix that only says racemic or "the enantiomer" ("(±)-5", "rac-5", "ent-5"
 * → 5); else the ID without any stereo prefix, if exactly one SI ID is so. Otherwise the
 * manuscript ID itself (not in the SI).
 */
export function resolver(keysIn: Iterable<string>): (label: string) => string {
  const keys = new Set(keysIn);
  const byBase = new Map<string, Set<string>>();
  for (const k of keys) {
    const b = P.idBase(k);
    if (!byBase.has(b)) byBase.set(b, new Set());
    byBase.get(b)!.add(k);
  }
  return (label) => {
    const key = P.idKey(label);
    if (keys.has(key)) return key;
    const noRac = P.idWithoutRac(label);
    if (keys.has(noRac)) return noRac;
    const found = byBase.get(P.idBase(label)) ?? new Set();
    return found.size === 1 ? [...found][0] : key;
  };
}

/** (the compound's own procedure text and typed placeholder values, its general procedure's sentence filled in, the general procedure's text) as plain text. */
export async function siProcedureText(p: SiProject, c: SiCompound, gpTexts?: Map<string, string>): Promise<[string, string, string]> {
  const keys = fieldKeys(c);
  const own: string[] = [];
  for (const key of ['procedure', 'si_text']) if (keys.includes(key)) own.push(plain(p.compoundText(c, key)));
  const gp = p.compoundGp(c);
  let sentence = '', gpText = '';
  if (gp) {
    const choice = valuesOf(c).procedure;
    const typed = isObj(choice) && isObj(choice.values) ? choice.values : {};
    for (const v of Object.values(typed)) if (str(v).trim()) own.push(plain(str(v)));
    try {
      sentence = fillSentence(partText(gp.sentence), typed, autoValues(c, gp)).map((r) => r.text).join('');
    } catch {
      sentence = partText(gp.sentence);
    }
    const id = str(gp.id);
    const known = gpTexts?.get(id);
    if (known !== undefined) gpText = known;
    else {
      const where = p.generalProcedure(id);
      try { gpText = where ? plain(await p.readGpText(where.section, id)) : ''; } catch { gpText = ''; }
      gpTexts?.set(id, gpText);
    }
  }
  const scale = valuesOf(c).scale;
  if (keys.includes('scale') && isObj(scale) && str(scale.value).trim()) own.push(`${str(scale.value).trim()} ${str(scale.unit) || 'mmol'}`);
  return [own.filter(Boolean).join('\n'), sentence, gpText];
}

function siYield(c: SiCompound): string {
  if (!fieldKeys(c).includes('yield')) return '';
  const y = valuesOf(c).yield;
  return isObj(y) ? str(y.percent).trim() : '';
}

function siPart(c: SiCompound, key: string): string {
  if (!fieldKeys(c).includes(key)) return '';
  const v = valuesOf(c)[key];
  return isObj(v) ? str(v.value).trim() : '';
}

// ---------------------------------------------------------------- values

const NUMBER = /([<>≥≤]?)\s*(\d+(?:[.,]\d+)?)/;

function numberOf(text: string): [string, number] | null {
  const m = NUMBER.exec(P.normalize(str(text)));
  return m ? [m[1], parseFloat(m[2].replace(',', '.'))] : null;
}

function ratioOf(text: string): [string, number, number] | null {
  const m = /([<>≥≤]?)\s*(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/.exec(P.normalize(str(text)));
  return m ? [m[1], parseFloat(m[2].replace(',', '.')), parseFloat(m[3].replace(',', '.'))] : null;
}

const sameTuple = (a: unknown[] | null, b: unknown[] | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Two yields agree when their numbers do; "quant." agrees with "quant." and with 99, >99 or 100%. */
export function sameYield(a: string, b: string): boolean {
  if (P.isQuant(a) || P.isQuant(b)) {
    const other = P.isQuant(a) ? b : a;
    const n = numberOf(other);
    return P.isQuant(other) || (n !== null && ['', '>', '≥'].includes(n[0]) && n[1] >= 99);
  }
  return sameTuple(numberOf(a), numberOf(b));
}

/** A yield as it is shown: "92%", but "quant." without a % sign. */
const pct = (value: string): string => (/\d/.test(String(value)) ? `${value}%` : String(value));

/** (sign, ee, converted) from "94% ee", "94", ">99% ee" or "97:3 er" (converted); "rac" is 0% ee. */
export function eeValue(text: string): [string, number, boolean] | null {
  if (P.isRacemic(text)) return ['', 0, false];
  const r = ratioOf(text);
  if (r) {
    const [sign, a, b] = r;
    if (a + b <= 0) return null;
    return [sign, Math.round((Math.abs(a - b) / (a + b)) * 1000) / 10, true];
  }
  const n = numberOf(text);
  return n ? [n[0], n[1], false] : null;
}

export function sameEe(a: [string, number, boolean], b: [string, number, boolean]): boolean {
  if (a[2] || b[2]) return Math.abs(a[1] - b[1]) <= 0.5; // an er converted: equal to the precision printed
  return a[0] === b[0] && a[1] === b[1];
}

/** The range of major:minor ratios a printed dr stands for, at the precision printed. */
function drRange(text: string): [number, number] {
  const m = /(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/.exec(P.normalize(text))!;
  const as = m[1].replace(',', '.'), bs = m[2].replace(',', '.');
  const half = (s: string): number => 0.5 * 10 ** -(s.includes('.') ? s.split('.')[1].length : 0);
  const a = parseFloat(as), b = parseFloat(bs), ha = half(as), hb = half(bs);
  if (b === 1) return [a - ha, a + ha];
  return [(a - ha) / (b + hb), (a + ha) / Math.max(b - hb, 1e-9)];
}

/** Two dr values agree when written the same; written two ways they agree within 2 %, or at the precision printed. */
export function sameDr(a: string, b: string): boolean {
  const ra = ratioOf(a), rb = ratioOf(b);
  if (!ra || !rb) return P.normalize(a).replace(/ /g, '') === P.normalize(b).replace(/ /g, '');
  if (ra[0] !== rb[0] || ra[2] === 0 || rb[2] === 0) return sameTuple(ra, rb);
  if (ra[1] === rb[1] && ra[2] === rb[2]) return true;
  if ((ra[2] === 1) === (rb[2] === 1)) return false; // the same format: must be the same numbers
  const x = ra[1] / ra[2], y = rb[1] / rb[2];
  if (Math.abs(x - y) <= 0.02 * Math.max(x, y)) return true;
  const [loA, hiA] = drRange(a), [loB, hiB] = drRange(b);
  return loA <= hiB && loB <= hiA;
}

/** Names are compared ignoring spacing, capitals, kinds of hyphens and quotes and a final full stop. */
export function nameKey(name: string): string {
  const text = P.normalize(name).replace(/`/g, "'").replace(/″/g, "''").replace(/"/g, "''");
  return text.replace(/\s+/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/\.+$/, '');
}

/** Names agree as nameKey() says, or once hyphens are left out too. */
export function sameName(a: string, b: string): boolean {
  const ka = nameKey(a), kb = nameKey(b);
  return ka === kb || ka.replace(/-/g, '') === kb.replace(/-/g, '');
}

function msEeText(rec: Json): string {
  if (P.isRacemic(rec.ee)) return P.RACEMIC;
  if (rec.ee) return `${str(rec.ee)}% ee`;
  if (rec.er) return `${str(rec.er)} er`;
  return '';
}

// ---------------------------------------------------------------- structures

type Keys = [string, string, boolean, string];

/** What the comparison of structures needs: the facts of molfiles or SMILES (RDKit, see chem.molFacts). */
export type FactsOf = (mols: string[]) => Promise<(MolFacts | null)[]>;

const formulaOf = (info: { formula: string; charge: number }): string => info.formula + (info.charge ? (Math.abs(info.charge) > 1 ? String(Math.abs(info.charge)) : '') + (info.charge > 0 ? '+' : '-') : '');

const keysMemo = new Map<string, Keys | null>();

/** (InChIKey, InChIKey of the main piece (counter-ions left out), more than one piece, formula of the main piece); null when it can't be read. */
async function keysOf(facts: FactsOf, mol: string): Promise<Keys | null> {
  if (keysMemo.has(mol)) return keysMemo.get(mol)!;
  let out: Keys | null = null;
  try {
    const [f] = await facts([mol]);
    if (f?.info && f.inchikey) {
      if (f.pieces.length < 2) out = [f.inchikey, f.inchikey, false, formulaOf(f.info)];
      else {
        const main = f.pieces[mainSpecies(f.pieces)];
        const [m] = await facts([main.smiles]);
        out = [f.inchikey, m?.inchikey ?? '', true, formulaOf(main.info)];
      }
    }
  } catch {
    // (the chemistry engine failed, not the structure: asked again next time, once it may work)
    return null;
  }
  if (keysMemo.size > 4000) keysMemo.clear();
  keysMemo.set(mol, out);
  return out;
}

/**
 * (status, fingerprint, manuscript formula, SI formula): status "same", "salt" (the same once
 * counter-ions are left out), "stereo", "charge", "different" or "" (not comparable).
 */
export async function compareStructures(facts: FactsOf | undefined, msSmiles: string, siMolblock: string): Promise<[string, string, string, string]> {
  if (!siMolblock || !facts) return ['', '', '', ''];
  const a = await keysOf(facts, msSmiles), b = await keysOf(facts, siMolblock);
  if (!a || !b) return ['', '', '', ''];
  const [aWhole, aMain, aSalt, aF] = a, [bWhole, bMain, bSalt, bF] = b;
  if (!aWhole || !bWhole) return ['', '', '', ''];
  const f = fp(aWhole, bWhole);
  if (aWhole === bWhole) return ['same', f, aF, bF];
  if (aMain === bMain && (aSalt || bSalt)) return ['salt', f, aF, bF];
  if (aMain.slice(0, 14) === bMain.slice(0, 14)) return [aMain.slice(15, 23) === bMain.slice(15, 23) ? 'charge' : 'stereo', f, aF, bF];
  return ['different', f, aF, bF];
}

// ---------------------------------------------------------------- merging

const FILE_TYPE: Record<string, string> = { pdf: 'PDF', docx: 'Word' };

/** A place in the manuscript with its file type: "Table 1, p. 1 (PDF)", "Word file, paragraph 4"; a ChemDraw place is its file name. */
export function place(where: string, kind: string): string {
  if (!where) return '';
  if (kind === 'docx' && where.startsWith('paragraph')) return `Word file, ${where}`;
  if (kind in FILE_TYPE) return `${where} (${FILE_TYPE[kind]})`;
  return where;
}

const filled = (v: unknown): boolean => !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));

/** Everything the manuscript says about one compound ID. */
class MsCompound {
  records: Json[] = [];
  names: Json[] = [];
  mentioned = false;
  constructor(readonly label: string) {}

  /** A record that gives this compound's own values: not a repeated row of an optimization table, not running text. */
  static own(r: Json): boolean { return !r.repeated && r.source !== 'text'; }

  get where(): string {
    const places = [...this.records.map((r) => str(r.place)), ...this.names.map((n) => str(n.place))];
    return [...new Set(places)].filter(Boolean).join('; ');
  }

  values(key: string): [string, string][] {
    return this.records.filter((r) => MsCompound.own(r) && filled(r[key])).map((r) => [str(r[key]), str(r.place)]);
  }

  /** Does the manuscript give values for it (a yield, ee/er or dr in a scheme or table)? */
  get hasData(): boolean {
    return this.records.some((r) => MsCompound.own(r) && ['yield', 'ee', 'er', 'dr'].some((k) => r[k]));
  }

  get textRecords(): Json[] {
    return this.records.filter((r) => r.source === 'text' && ['yield', 'ee', 'er', 'dr'].some((k) => r[k]));
  }

  /** (marker, footnote text, place) of the footnotes on this compound (not those of an optimization table's repeated rows). */
  get markers(): [string, string, string][] {
    const out: [string, string, string][] = [];
    const seen = new Set<string>();
    for (const r of this.records) {
      if (r.repeated) continue;
      for (const m of Array.isArray(r.footnotes) ? r.footnotes.map(str) : []) {
        const text = isObj(r.conditions) ? str(r.conditions[m]) : '';
        const k = JSON.stringify([m, text]);
        if (!seen.has(k)) { seen.add(k); out.push([m, text, str(r.place)]); }
      }
    }
    return out;
  }
}

/** The manuscript's compounds by ID key (as `resolve` gives it: the SI ID it stands for). */
function merge(sources: Source[], resolve: (label: string) => string = P.idKey): Map<string, MsCompound> {
  const out = new Map<string, MsCompound>();
  const at = (key: string, label: string): MsCompound => {
    if (!out.has(key)) out.set(key, new MsCompound(label));
    return out.get(key)!;
  };
  for (const src of sources) {
    for (const recIn of src.records) {
      const label = str(recIn.id).trim();
      if (!label) continue;
      at(resolve(label), label).records.push({ ...recIn, place: place(str(recIn.where), src.kind) });
    }
    for (const n of src.names) {
      const label = str(n.id);
      if (label) at(resolve(label), label).names.push({ ...n, place: place(str(n.where), src.kind) });
    }
    for (const label of src.mentioned) at(resolve(label), label).mentioned = true;
  }
  return out;
}

// ---------------------------------------------------------------- the comparison

export interface CheckOptions {
  facts?: FactsOf;
  /** How many manuscript files there are (for the summary); read from the folder when left out. */
  files?: number;
}

const finding = (kind: string, label: string, message: string, status: Status, extra: Partial<Finding> = {}): Finding => ({
  kind, label, message, status, compound_id: '', ms_value: '', si_value: '', where: '', key: '', fingerprint: '', reason: '', ...extra,
});

/**
 * Compare what the manuscript says with the SI (quick: nothing is read from the manuscript files
 * here). Only the manuscript → SI direction: an SI compound the manuscript doesn't show is not reported.
 */
export async function checkManuscript(p: SiProject, sources: Source[] | null, opts: CheckOptions = {}): Promise<Result> {
  const result: Result = { findings: [], checked: 0, notes: [], files: opts.files ?? (await manuscriptFiles(p)).length };
  if (!sources?.length) return result;
  for (const src of sources) {
    if (src.error) result.notes.push(src.error);
    result.notes.push(...src.notes);
  }
  const [si, extra] = siCompounds(p);
  const ms = merge(sources, resolver([...si.keys(), ...extra.keys()]));
  const out: Finding[] = [];
  const gpTexts = new Map<string, string>();
  for (const [key, mc] of ms) {
    const sc = si.get(key);
    if (!sc) {
      if (extra.has(key) && !mc.hasData) continue; // a starting material labeled on a scheme: known, no data
      if (mc.hasData) {
        const data = dataText(mc);
        out.push(finding('missing_si', mc.label, `${mc.label}: the manuscript gives data for it (${data}) but no compound in the SI has this ID.`, PROBLEM, { ms_value: data, si_value: 'no compound with this ID', where: mc.where }));
      } else {
        const what = mc.records.some((r) => r.smiles) ? 'a labeled structure' : mc.textRecords.length ? 'a value in the text' : 'mentioned';
        // (its fingerprint from SI Assistant's wording, "labelled", so a note dismissed there or before the
        // American spelling of G5-09 stays dismissed)
        const print = fp(what.replace('labeled', 'labelled'), 'no compound with this ID', '');
        out.push(finding('mention', mc.label, `${mc.label} is in the manuscript (${what}) but no compound in the SI has this ID. That is fine for a known compound, a starting material or a reagent.`, NOTE, { fingerprint: print, ms_value: what, si_value: 'no compound with this ID', where: mc.where }));
      }
      continue;
    }
    result.checked++;
    out.push(...(await compareOne(p, mc, sc, gpTexts, opts.facts)));
  }
  for (const f of out) {
    if (!f.key) f.key = `${f.kind}:${P.idKey(f.label)}`;
    if (!f.fingerprint) f.fingerprint = fp(f.ms_value, f.si_value, ['conditions', 'deviation'].includes(f.kind) ? f.message : '');
  }
  // Two findings can share a key: those get their fingerprint in the key, so each can be dismissed on its own.
  const prints = new Map<string, Set<string>>();
  for (const f of out) { if (!prints.has(f.key)) prints.set(f.key, new Set()); prints.get(f.key)!.add(f.fingerprint); }
  const gone = await dismissedOf(p);
  for (const f of out) {
    const base = f.key, own = `${f.key}:${f.fingerprint}`;
    if (prints.get(base)!.size > 1) f.key = own;
    if (f.status !== PROBLEM) continue;
    for (const k of [...new Set([f.key, base, own])]) {
      const d = gone[k];
      if (isObj(d) && d.fingerprint === f.fingerprint) {
        f.key = k; // so that Restore removes this very entry
        f.status = DISMISSED;
        f.reason = str(d.reason);
        break;
      }
    }
  }
  const order: Record<string, number> = { [PROBLEM]: 0, [NOTE]: 1, [DISMISSED]: 2, [OK]: 3 };
  const decorated = out.map((f, i) => ({ f, i, s: idSort(f.label) }));
  decorated.sort((x, y) => (order[x.f.status] ?? 9) - (order[y.f.status] ?? 9) || cmpSort(x.s, y.s) || (x.f.kind < y.f.kind ? -1 : x.f.kind > y.f.kind ? 1 : 0) || x.i - y.i);
  result.findings = decorated.map((d) => d.f);
  return result;
}

function idSort(label: string): [number, string] {
  const m = /^\D*(\d+)([\s\S]*)/.exec(label);
  return m ? [parseInt(m[1], 10), m[2]] : [1e6, label];
}
const cmpSort = (a: [number, string], b: [number, string]): number => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);

function dataText(mc: MsCompound): string {
  const parts: string[] = [];
  const y = mc.values('yield');
  if (y.length) parts.push(`${pct(y[0][0])} yield`);
  const ee = mc.records.filter((r) => msEeText(r) && MsCompound.own(r));
  if (ee.length) parts.push(msEeText(ee[0]));
  const d = mc.values('dr');
  if (d.length) parts.push(`${d[0][0]} dr`);
  if (mc.records.some((r) => r.smiles)) parts.push('a structure');
  return parts.join(', ');
}

const pyG = (x: number): string => {
  if (Number.isInteger(x)) return String(x);
  return String(Number(x.toPrecision(6)));
};

async function compareOne(p: SiProject, mc: MsCompound, sc: SiEntry, gpTexts: Map<string, string>, facts: FactsOf | undefined): Promise<Finding[]> {
  const c = sc.compound, label = sc.label;
  const out: Finding[] = [];
  const add = (kind: string, message: string, status: Status = PROBLEM, msValue = '', siValue = '', where = '', key = '', fingerprint = ''): void => {
    out.push(finding(kind, label, message, status, { compound_id: c.id, ms_value: msValue, si_value: siValue, where: where || mc.where, key, fingerprint }));
  };

  // --- structure
  const structures: [string, string][] = mc.records.filter((r) => r.smiles).map((r) => [str(r.smiles), str(r.place)]);
  if (structures.length) {
    let molblock = '';
    try { molblock = await p.readStructure(c); } catch { molblock = ''; }
    const generic = molblock ? genericAtoms(molblock) : [];
    if (molblock && generic.length) {
      add('structure', `${label}: the SI structure has a generic atom (${generic.join(', ')}), so it was not compared with the ChemDraw file.`, NOTE, 'structure', 'generic structure', structures[0][1]);
    } else if (!molblock) {
      add('structure', `${label}: the ChemDraw file has a structure but the SI compound has none yet.`, NOTE, 'structure', '—', structures[0][1]);
    } else {
      for (const [smiles, where] of structures.slice(0, 3)) {
        const [status, f, aF, bF] = await compareStructures(facts, smiles, molblock);
        const key = `structure:${P.idKey(label)}:${where}`;
        if (status === 'same') add('structure', `${label}: the structure agrees (${bF}).`, OK, aF, bF, where);
        else if (status === 'salt') add('structure', `${label}: the structure agrees once the counter-ion is left out (compared by the largest piece, ${bF}).`, OK, aF, bF, where);
        else if (status === 'stereo') add('structure', `${label}: ${where} and the SI have the same compound with different stereochemistry (wedges, E/Z or R/S).`, PROBLEM, `${aF}, other stereo`, bF, where, key, f);
        else if (status === 'charge') add('structure', `${label}: ${where} and the SI have the same compound with a different charge or protonation.`, PROBLEM, aF, bF, where, key, f);
        else if (status === 'different') add('structure', `${label}: the structure in ${where} (${aF}) is not the SI structure (${bF}).`, PROBLEM, aF, bF, where, key, f);
      }
    }
  }

  // --- yield
  const yields = mc.values('yield');
  const siY = siYield(c);
  if (yields.length) {
    out.push(...internal(label, c.id, 'yield', yields, pct, sameYield));
    const printed = [...new Set(yields.map(([v]) => v))].map(pct).join(', ');
    if (!siY) add('yield', `${label}: the manuscript gives ${printed} yield; the SI's Yield field is empty.`, PROBLEM, printed, '—', yields[0][1]);
    else if (yields.some(([v]) => sameYield(v, siY))) add('yield', `${label}: the yield agrees (${pct(siY)}).`, OK, printed, pct(siY));
    else add('yield', `${label}: the manuscript gives ${printed} yield, the SI ${pct(siY)}.`, PROBLEM, printed, pct(siY), yields[0][1]);
  }
  const nmr = mc.values('yield_nmr');
  if (nmr.length && !yields.length) {
    add('yield', `${label}: the manuscript gives only an NMR/GC yield (${nmr[0][0]}%); it is not compared with the SI's isolated yield.`, NOTE, `${nmr[0][0]}% (NMR)`, siY ? `${siY}%` : '—', nmr[0][1]);
  }

  // --- ee / er
  const eeRecs = mc.records.filter((r) => msEeText(r) && MsCompound.own(r)).map((r): [Json, string] => [r, msEeText(r)]);
  const siEeText = siPart(c, 'ee');
  if (eeRecs.length) {
    const vals: [string, string][] = eeRecs.map(([r, t]) => [t, str(r.place)]);
    out.push(...internal(label, c.id, 'ee', vals, (v) => v, sameEeText));
    const printed = [...new Set(vals.map(([t]) => t))].join(', ');
    if (!siEeText) {
      // (a racemic product with no ee in the SI is as expected)
      if (!vals.every(([t]) => t === P.RACEMIC)) add('ee', `${label}: the manuscript gives ${printed}; the SI has no ee/er.`, PROBLEM, printed, '—', vals[0][1]);
    } else {
      const siEe = eeValue(siEeText);
      const match = siEe !== null && vals.some(([t]) => { const m = eeValue(t); return m !== null && sameEe(m, siEe); });
      if (match) add('ee', `${label}: the ee/er agrees (${siEeText}).`, OK, printed, siEeText);
      else {
        const conv: string[] = [];
        for (const [t] of vals) { const m = eeValue(t); if (m && m[2]) conv.push(`${t} = ${pyG(m[1])}% ee`); }
        if (siEe && siEe[2]) conv.push(`SI ${siEeText} = ${pyG(siEe[1])}% ee`);
        const more = conv.length ? `; ${conv.join('; ')}` : '';
        add('ee', `${label}: the manuscript gives ${printed}, the SI ${eeWithUnit(siEeText)}${more}.`, PROBLEM, printed, siEeText, vals[0][1]);
      }
    }
  }

  // --- dr
  const drs = mc.values('dr');
  const siDr = siPart(c, 'dr');
  if (drs.length) {
    out.push(...internal(label, c.id, 'dr', drs, (v) => `${v} dr`, sameDr));
    const printed = [...new Set(drs.map(([v]) => v))].join(', ');
    if (!siDr) add('dr', `${label}: the manuscript gives ${printed} dr; the SI has no dr.`, PROBLEM, printed, '—', drs[0][1]);
    else if (drs.some(([v]) => sameDr(v, siDr))) add('dr', `${label}: the dr agrees (${siDr}).`, OK, printed, siDr);
    else add('dr', `${label}: the manuscript gives ${printed} dr, the SI ${siDr}.`, PROBLEM, printed, siDr, drs[0][1]);
  }

  // --- values in running text: notes only
  out.push(...textNotes(label, c, mc));

  // --- names
  if (mc.names.length) {
    const siName = compoundName(c);
    const msNames = [...new Set(mc.names.map((n) => str(n.name)))];
    const distinct: string[] = [];
    for (const n of msNames) if (!distinct.some((d) => sameName(n, d))) distinct.push(n);
    if (distinct.length > 1) {
      add('internal', `${label}: the manuscript names it in different ways: ${distinct.map((n) => `“${n}”`).join('; ')}.`, PROBLEM, distinct.join(' / '), '', str(mc.names[0].place), `internal:name:${P.idKey(label)}`);
    }
    if (siName) {
      if (msNames.some((n) => sameName(n, siName))) add('name', `${label}: the name agrees.`, OK, msNames[0], siName);
      else add('name', `${label}: the manuscript calls it “${msNames[0]}”; the SI name is “${siName}”.`, PROBLEM, msNames[0], siName, str(mc.names[0].place));
    }
  }

  // --- conditions
  const [own, sentence, gpText] = await siProcedureText(p, c, gpTexts);
  const siQ = P.quantities([own, sentence, gpText].join('\n'));
  const markers = mc.markers;
  for (const [marker, text, where] of markers) {
    const key = `conditions:${P.idKey(label)}:${marker}`;
    if (!text) {
      add('conditions', `${label}: footnote ${marker} was not found in the manuscript, so its conditions could not be checked.`, NOTE, `footnote ${marker}`, '', where, key);
      continue;
    }
    const wanted = P.quantities(text);
    if (!wanted.length) continue;
    const missing = wanted.filter((q) => !siQ.some((s) => P.sameQuantity(q, s)));
    if (!missing.length) add('conditions', `${label}: footnote ${marker} (“${text}”) agrees with its SI procedure.`, OK, text, 'found', where, key);
    else {
      const listed = [...new Set(missing.map((q) => q.text))].join(', ');
      add('conditions', `${label}: footnote ${marker} of the manuscript (“${text}”) mentions ${listed}, which ${missing.length === 1 ? 'is' : 'are'} not in its SI procedure: its own text and its general procedure.`, PROBLEM, text, `not in the SI: ${listed}`, where, key);
    }
  }
  const gp = p.compoundGp(c);
  if (!markers.length && gp) out.push(...deviations(label, c, mc, own, `${gpText}\n${partText(gp.sentence)}`, partText(gp.name) || 'its general procedure'));
  return out;
}

// What the check of an SI procedure against its general procedure compares (not the scale, which is expected to differ).
const DEVIATION_KINDS: [string, string][] = [['time', 'time'], ['temperature', 'temperature'], ['loading', 'catalyst loading'], ['equiv', 'equivalents'], ['solvent', 'solvent']];

/** The time, temperature, loading, equivalents and solvent of the reaction itself (the work-up's sentences left out). */
function reactionQuantities(text: string): P.Quantity[] {
  const part = P.reactionPart(text);
  const out = P.quantities(part, false).filter((q) => ['time', 'temperature', 'loading', 'equiv'].includes(q.kind));
  out.push(...P.reagents(part).filter((q) => P.SOLVENTS.has(String(q.value))).map((q) => ({ kind: 'solvent', value: q.value, text: q.text })));
  return out;
}

/** An SI procedure whose reaction uses another time, temperature, loading, equivalents or solvent than its general procedure, while the manuscript has no footnote saying so. */
function deviations(label: string, c: SiCompound, mc: MsCompound, own: string, gpText: string, gpName: string): Finding[] {
  const out: Finding[] = [];
  const gpQ = reactionQuantities(gpText), ownQ = reactionQuantities(own);
  for (const [kind, word] of DEVIATION_KINDS) {
    const mine = ownQ.filter((q) => q.kind === kind), theirs = gpQ.filter((q) => q.kind === kind);
    if (!mine.length || !theirs.length) continue;
    const fresh = mine.filter((q) => !theirs.some((t) => P.sameQuantity(q, t)));
    if (fresh.length) {
      const ownText = [...new Set(fresh.map((q) => q.text))].join(', ');
      const gpVals = [...new Set(theirs.map((q) => q.text))].join(', ');
      out.push(finding('deviation', label, `${label}: its SI procedure uses ${ownText}, where ${gpName} has ${gpVals}, but the manuscript has no footnote on ${label} saying so.`, PROBLEM, {
        compound_id: c.id, ms_value: 'no footnote', si_value: `${word}: ${ownText}`, where: mc.where, key: `deviation:${P.idKey(label)}:${kind}`,
      }));
    }
  }
  return out;
}

/** Yields, ee and dr stated in running-text sentences: compared with the SI but only ever notes, quoting the sentence. */
function textNotes(label: string, c: SiCompound, mc: MsCompound): Finding[] {
  const out: Finding[] = [];
  const si: Record<string, string> = { yield: siYield(c), ee: siPart(c, 'ee'), dr: siPart(c, 'dr') };
  mc.textRecords.forEach((r, n) => {
    let quote = str(r.text).trim();
    if (Array.from(quote).length > 220) quote = Array.from(quote).slice(0, 217).join('').trimEnd() + '…';
    for (const kind of ['yield', 'ee', 'dr']) {
      let msText: string;
      if (kind === 'ee') msText = msEeText(r);
      else {
        msText = str(r[kind]);
        msText = kind === 'yield' && msText ? pct(msText) : msText ? (kind === 'dr' ? `${msText} dr` : msText) : '';
      }
      if (!msText) continue;
      const siText = si[kind];
      let agrees: boolean, siShown: string;
      if (kind === 'yield') { agrees = !!siText && sameYield(str(r.yield), siText); siShown = siText ? pct(siText) : ''; } else if (kind === 'ee') {
        const a = eeValue(msText), b = siText ? eeValue(siText) : null;
        agrees = a !== null && b !== null && sameEe(a, b);
        siShown = siText;
      } else { agrees = !!siText && sameDr(str(r.dr), siText); siShown = siText; }
      const what = { yield: 'yield', ee: 'ee/er', dr: 'dr' }[kind as 'yield' | 'ee' | 'dr'];
      let msg: string;
      if (agrees) msg = `${label}: the ${what} in the text agrees (${msText}): “${quote}”`;
      else if (siShown) msg = `${label}: the text says “${quote}”, giving ${msText}; the SI has ${siShown}. Running text is only noted: check whether this sentence is about the same experiment.`;
      else msg = `${label}: the text says “${quote}”, giving ${msText}; the SI has no ${what} for it. Running text is only noted.`;
      out.push(finding(kind, label, msg, agrees ? OK : NOTE, { compound_id: c.id, ms_value: `${msText} (in the text)`, si_value: siShown || '—', where: str(r.place), key: `text:${kind}:${P.idKey(label)}:${n}` }));
    }
  });
  return out;
}

function sameEeText(a: string, b: string): boolean {
  const x = eeValue(a), y = eeValue(b);
  return x !== null && y !== null && sameEe(x, y);
}

/** A finding if the manuscript itself gives different values of one kind. */
function internal(label: string, compoundId: string, kind: string, vals: [string, string][], show: (v: string) => string, same: (a: string, b: string) => boolean): Finding[] {
  const distinct: [string, string][] = [];
  for (const [v, w] of vals) if (!distinct.some(([d]) => same(v, d))) distinct.push([v, w]);
  if (distinct.length < 2) return [];
  const listed = distinct.map(([v, w]) => (w ? `${show(v)} in ${w}` : show(v))).join(' and ');
  const word = { yield: 'yields', ee: 'ee/er values', dr: 'dr values' }[kind as 'yield' | 'ee' | 'dr'];
  return [finding('internal', label, `${label}: the manuscript gives different ${word}: ${listed}.`, PROBLEM, {
    compound_id: compoundId, ms_value: distinct.map(([v]) => show(v)).join(' / '), where: distinct[0][1], key: `internal:${kind}:${P.idKey(label)}`,
  })];
}

/** The comparison made with what was read last time (no file is read): for the Warnings list. Null if nothing was read yet or the files changed since. */
export async function cachedResult(p: SiProject, opts: CheckOptions = {}): Promise<Result | null> {
  try {
    const names = await manuscriptFiles(p);
    if (!names.length) return null;
    const sources = await cachedSources(p);
    return sources ? await checkManuscript(p, sources, { ...opts, files: names.length }) : null;
  } catch {
    return null;
  }
}
