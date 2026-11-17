// A manuscript (a Chemweave document) linked to its SI project. The manuscript's compound numbers
// lead (Nate, 2026-11-17): they are Compound Number fields, numbered in order of first mention,
// with a letter typed after the number for a series (2a, 2b), and each number knows which SI
// compound each of its letters is (seq.si). renumberPlan gives the SI IDs to change so the SI
// matches, which the app writes into the SI as Manual IDs (Renumber SI). Labels and pages of the
// SI ("Table S1", "S6") are SI fields (document.ts, kind 'si') that follow the SI
// (updateSiFields). Compound numbers typed as bold text (a manuscript from Word) can be made
// Compound Number fields (linkTypedIds). checkAgainstSi compares the manuscript with the SI, as
// SI Assistant's Manuscript check does for the direction that matters (manuscript → SI):
// compounds mentioned that the SI doesn't have, IDs that differ, and yields, ee and dr in the
// manuscript's tables and sentences that differ from the SI's.

import { bookmarksOf } from '../document/bookmarks';
import { COMPOUND, OBJECT_CHAR, fieldTexts, nextObjectId, type DocObject, type DocText, type SiFieldWhat } from '../document/document';
import type { TableCell, TextRun } from '../model';
import type { SiTarget } from './compile-doc';
import { valuesOf, compoundName, type SiProject } from './project';
import { partText } from './fields';

/** What the manuscript needs from the SI: its targets (compounds and labels) and the page each is on. */
export interface SiView {
  title: string;
  targets: SiTarget[];
  /** Each target's SI page ("S6"), by its key. */
  pages: Map<string, string>;
  /** Each compound's yield, ee and dr as the SI gives them (by compound id), for the check. */
  data: Map<string, SiData>;
}

/** A compound's values in the SI, as typed there. */
export interface SiData { yield?: string; ee?: string; dr?: string; name?: string }

type SiObj = Extract<DocObject, { kind: 'si' }>;

/** Each target's SI page from the compiled SI laid out: `paraPage[i]` is paragraph i's page ("S6"). */
export function siPages(compiled: Pick<DocText, 'paras'>, targets: SiTarget[], paraPage: readonly string[]): Map<string, string> {
  const byMark = new Map(bookmarksOf(compiled).map((b) => [b.name, b.para]));
  const out = new Map<string, string>();
  for (const t of targets) {
    const para = t.mark ? byMark.get(t.mark) : undefined;
    const page = para === undefined ? '' : paraPage[para] ?? '';
    if (page) out.set(t.key, page);
  }
  return out;
}

/** What an SI field shows now (null when the SI no longer has what it points at). */
export function siFieldText(o: Pick<SiObj, 'what' | 'key'>, view: SiView): string | null {
  const t = view.targets.find((x) => x.key === o.key);
  if (!t) return null;
  if (o.what === 'page') return view.pages.get(o.key) ?? null;
  return t.label || null;
}

export interface SiUpdate {
  /** The document with its SI fields brought up to date (the same object when nothing changed). */
  t: DocText;
  changed: number;
  /** Fields whose compound or label is no longer in the SI (they keep their last text). */
  missing: number[];
}

/** Every SI label and page of the document (in the text, its tables and notes) as the SI now has it (compound IDs are the manuscript's own). */
export function updateSiFields(t: DocText, view: SiView): SiUpdate {
  const objects = { ...t.objects };
  let changed = 0;
  const missing: number[] = [];
  for (const [k, o] of Object.entries(t.objects)) {
    if (o.kind !== 'si' || o.what === 'id') continue;
    const text = siFieldText(o, view);
    if (text === null) { missing.push(Number(k)); continue; }
    if (text !== o.text) { objects[Number(k)] = { ...o, text }; changed++; }
  }
  return { t: changed ? { ...t, objects } : t, changed, missing };
}

// ---------------------------------------------------------------- compound numbers

/** A compound number as typed: 2a, 12, 3b′, 4a''. */
const ID_TOKEN = /(?<![\p{L}\p{N}′'″-])(\d{1,3})([a-z]{0,2}[′'″]{0,2})(?![\p{L}\p{N}′'″])/gu;
/** The letters typed after a compound number field (2 + "a"). */
const LETTERS = /^[a-z]{1,2}[′'″]{0,2}(?![\p{L}\p{N}])/u;
/** Words a bold number after them is a label or an entry, not a compound. */
const NOT_COMPOUND = /\b(?:table|figure|fig\.|scheme|chart|equation|eq\.|entry|entries|step|ref\.?|page|section)\s*$/i;

const normId = (s: string): string => s.replace(/\s+/g, '').replace(/['″]/g, (m) => (m === '″' ? '′′' : '′')).toLowerCase();

/** The SI's compounds by their ID as printed (compared as SI Assistant does: no spaces or capitals, any prime). */
function idIndex(view: SiView): Map<string, SiTarget> {
  const m = new Map<string, SiTarget>();
  for (const t of view.targets) if (t.kind === 'compound' && t.label && t.label !== 'ID?') m.set(normId(t.label), t);
  return m;
}

/** What reading mentions needs: the objects, what the numbers show, and the SI's compounds. */
interface Ctx { objects: Record<number, DocObject>; shown: Map<number, string>; ids: Map<string, SiTarget>; keys: Set<string> }

function ctxOf(t: DocText, view: SiView): Ctx {
  return { objects: t.objects, shown: fieldTexts(t), ids: idIndex(view), keys: new Set(view.targets.filter((x) => x.kind === 'compound').map((x) => x.key)) };
}

/** The compound number field a run is (a Compound seq, or a reference to one): the seq's id. */
function numberSeq(r: TextRun, objects: Record<number, DocObject>): number | null {
  if (r.obj === undefined) return null;
  const o = objects[r.obj];
  if (o?.kind === 'seq' && o.name === COMPOUND) return r.obj;
  if (o?.kind === 'ref') { const s = objects[o.target]; return s?.kind === 'seq' && s.name === COMPOUND ? o.target : null; }
  return null;
}

/** Bold runs' compound numbers: each match with where it is in its run list. */
function typedIds(runs: readonly TextRun[]): { run: number; start: number; end: number; num: string; letters: string }[] {
  const out: { run: number; start: number; end: number; num: string; letters: string }[] = [];
  runs.forEach((r, i) => {
    if (!r.bold || r.obj !== undefined || r.sup || r.sub) return;
    // a letter right after a compound number field is that number's (2 + "a"), not a number of its own
    const before = (k: number): string => {
      let s = r.text.slice(0, k);
      for (let j = i - 1; j >= 0 && s.length < 24; j--) s = (runs[j].obj !== undefined ? ' ' : runs[j].text) + s;
      return s;
    };
    for (const m of r.text.matchAll(ID_TOKEN)) {
      if (NOT_COMPOUND.test(before(m.index!))) continue;
      out.push({ run: i, start: m.index!, end: m.index! + m[0].length, num: m[1], letters: m[2] });
    }
  });
  return out;
}

/** A compound mention: its ID as printed here, and the SI compound it is ('' when none). */
interface Mention { key: string; id: string; inSi: boolean; /** The compound number field it is (its seq), when it is one. */ seq?: number; letters?: string }

/** The compound mentions in some runs: compound number fields (with the letters after them), SI ID fields, and bold numbers typed. */
function mentionsIn(runs: readonly TextRun[], c: Ctx): Mention[] {
  const out: Mention[] = [];
  runs.forEach((r, i) => {
    const seq = numberSeq(r, c.objects);
    if (seq !== null) {
      const next = runs[i + 1];
      const letters = next && next.obj === undefined ? LETTERS.exec(next.text)?.[0] ?? '' : '';
      const id = (c.shown.get(r.obj!) ?? '') + letters;
      const o = c.objects[seq];
      const linked = o?.kind === 'seq' ? o.si?.[letters] : undefined;
      if (linked) out.push({ key: linked, id, inSi: c.keys.has(linked), seq, letters });
      else {
        // not linked: the SI compound with this ID, if there is one
        const t = c.ids.get(normId(id));
        out.push({ key: t?.key ?? '', id, inSi: !!t, seq, letters });
      }
      return;
    }
    const o = r.obj !== undefined ? c.objects[r.obj] : undefined;
    if (o?.kind === 'si' && o.what === 'id') out.push({ key: o.key, id: o.text, inSi: c.keys.has(o.key) });
  });
  for (const x of typedIds(runs)) {
    // the letters after a compound number field are part of it
    if (!x.num) continue;
    const id = x.num + x.letters;
    const t = c.ids.get(normId(id));
    out.push(t ? { key: t.key, id, inSi: true } : { key: '', id, inSi: false });
  }
  return out;
}

/** Every run list of the document that holds mentions: the text, each table cell, each note. */
function allRuns(t: DocText): TextRun[][] {
  const out: TextRun[][] = [t.runs];
  for (const o of Object.values(t.objects)) {
    if (o.kind === 'table') for (const row of o.table.rows) for (const c of row) out.push(c.runs);
    if (o.kind === 'note') out.push(o.runs);
  }
  return out;
}

/** Each SI compound's IDs in the manuscript (more than one is a problem). */
export function manuscriptIds(t: DocText, view: SiView): Map<string, Set<string>> {
  const c = ctxOf(t, view);
  const out = new Map<string, Set<string>>();
  for (const runs of allRuns(t)) for (const m of mentionsIn(runs, c)) if (m.inSi) { const s = out.get(m.key) ?? new Set(); s.add(m.id); out.set(m.key, s); }
  return out;
}

/** The SI IDs to change so the SI matches the manuscript: each SI compound the manuscript gives one ID to, where the SI's differs. */
export function renumberPlan(t: DocText, view: SiView): { key: string; from: string; to: string }[] {
  const out: { key: string; from: string; to: string }[] = [];
  for (const [key, ids] of manuscriptIds(t, view)) {
    if (ids.size !== 1) continue;
    const to = [...ids][0];
    const from = view.targets.find((x) => x.key === key)?.label ?? '';
    if (to && normId(to) !== normId(from)) out.push({ key, from, to });
  }
  return out;
}

/**
 * Compound numbers typed in bold (in the text and in tables) made Compound Number fields: the
 * first mention of each number becomes the number, later ones refer to it, letters stay typed
 * after it, and each number learns which SI compound each of its letters is. From then on the
 * numbers follow first mention, so a number typed out of order changes: `changed` lists those.
 * Numbers after "Table", "Figure", "entry"… are left alone.
 */
export function linkTypedIds(t: DocText, view: SiView): { t: DocText; made: number; changed: { from: string; to: string }[] } {
  const ids = idIndex(view);
  const objects: Record<number, DocObject> = { ...t.objects };
  let nextId = nextObjectId(t) - 1;
  const seqOf = new Map<string, number>();
  // compound numbers already in the document keep theirs (by what they show)
  const shown = fieldTexts(t);
  for (const [k, o] of Object.entries(t.objects)) if (o.kind === 'seq' && o.name === COMPOUND) seqOf.set(shown.get(Number(k)) ?? '', Number(k));
  let made = 0;
  const typedAs = new Map<number, string>();
  const link = (seq: number, letters: string): void => {
    const o = objects[seq];
    if (o?.kind !== 'seq') return;
    if (o.si?.[letters]) return;
    const target = ids.get(normId((typedAs.get(seq) ?? shown.get(seq) ?? '') + letters));
    if (target) objects[seq] = { ...o, si: { ...(o.si ?? {}), [letters]: target.key } };
  };
  const convert = (runs: TextRun[]): TextRun[] => {
    const found = typedIds(runs);
    const out: TextRun[] = [];
    runs.forEach((r, i) => {
      if (r.obj !== undefined && objects[r.obj]?.kind === 'table') {
        // a table's cells, in their place in the order of mentions
        const o = objects[r.obj] as Extract<DocObject, { kind: 'table' }>;
        let any = false;
        const rows = o.table.rows.map((row) => row.map((cell): TableCell => {
          const runs2 = convert(cell.runs);
          if (runs2 !== cell.runs) any = true;
          return runs2 === cell.runs ? cell : { ...cell, runs: runs2 };
        }));
        if (any) objects[r.obj] = { ...o, table: { ...o.table, rows } };
        out.push(r);
        return;
      }
      const here = found.filter((x) => x.run === i);
      if (!here.length) { out.push(r); return; }
      let pos = 0;
      for (const x of here) {
        if (x.start > pos) out.push({ ...r, text: r.text.slice(pos, x.start) });
        let seq = seqOf.get(x.num);
        const id = ++nextId;
        if (seq === undefined) {
          seq = id;
          seqOf.set(x.num, seq);
          typedAs.set(seq, x.num);
          objects[id] = { kind: 'seq', name: COMPOUND };
        } else objects[id] = { kind: 'ref', target: seq };
        link(seq, x.letters);
        out.push({ ...r, text: OBJECT_CHAR, obj: id });
        if (x.letters) out.push({ ...r, text: x.letters });
        made++;
        pos = x.end;
      }
      if (pos < r.text.length) out.push({ ...r, text: r.text.slice(pos) });
    });
    return made ? out : runs;
  };
  const runs = convert(t.runs);
  if (!made) return { t, made: 0, changed: [] };
  const next: DocText = { ...t, runs, objects };
  const now = fieldTexts(next);
  const changed = [...typedAs].filter(([seq, was]) => now.get(seq) !== was).map(([seq, was]) => ({ from: was, to: now.get(seq) ?? '' }));
  return { t: next, made, changed };
}

/**
 * A compound number for an SI compound at the caret: a new number, or a mention of a number
 * already in the manuscript (with `letters` after it, linking that letter to the compound).
 */
export function linkNumber(t: DocText, seq: number, letters: string, key: string): DocText {
  const o = t.objects[seq];
  if (o?.kind !== 'seq') return t;
  return { ...t, objects: { ...t.objects, [seq]: { ...o, si: { ...(o.si ?? {}), [letters]: key } } } };
}

/** The manuscript's compound numbers: each number's seq, what it shows, and its letters linked to SI compounds. */
export function compoundNumbers(t: DocText): { seq: number; number: string; si: Record<string, string> }[] {
  const shown = fieldTexts(t);
  const out: { seq: number; number: string; si: Record<string, string> }[] = [];
  for (const [k, o] of Object.entries(t.objects)) if (o.kind === 'seq' && o.name === COMPOUND) out.push({ seq: Number(k), number: shown.get(Number(k)) ?? '', si: o.si ?? {} });
  return out.sort((a, b) => Number(a.number) - Number(b.number));
}

/** The next free letter of a compound number (a, b, … after those linked or mentioned). */
export function nextLetter(t: DocText, seq: number, view: SiView): string {
  const used = new Set<string>();
  const o = t.objects[seq];
  if (o?.kind === 'seq') for (const l of Object.keys(o.si ?? {})) used.add(l);
  const c = ctxOf(t, view);
  for (const runs of allRuns(t)) for (const m of mentionsIn(runs, c)) if (m.seq === seq && m.letters) used.add(m.letters);
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(97 + i); if (!used.has(l)) return l; }
  return 'aa';
}

// ---------------------------------------------------------------- the check

/** One thing the check found. `level` problem: should be fixed; note: worth a look. */
export interface SiFinding {
  level: 'problem' | 'note';
  /** The SI compound (its id in the project), or '' for a compound the SI doesn't have. */
  key: string;
  /** The compound's ID as printed. */
  id: string;
  what: 'compound' | 'id' | 'yield' | 'ee' | 'dr' | 'field';
  manuscript: string;
  si: string;
  where: string;
  message: string;
  /** Where the manuscript's value is, to put the SI's in its place: a table cell's text, or the main text's. */
  at?: { table?: number; row?: number; col?: number; start: number; end: number };
}

/** Runs' text as printed (fields as they show). */
const textOf = (runs: readonly TextRun[], c: Pick<Ctx, 'objects' | 'shown'>): string =>
  runs.map((r) => (r.obj !== undefined ? c.shown.get(r.obj) ?? OBJECT_CHAR : r.text)).join('');

/** Numbers in a yield, as printed ("92", "92.0", ">99", "quant."). */
function yieldValues(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/(quant\.?)|([<>≥≤]?\s*\d+(?:\.\d+)?)/gi)) out.push(m[1] ? 'quant.' : m[2].replace(/\s+/g, ''));
  return out;
}

/** The same printed yield: 92 = 92.0, ">99" ≠ "99", "quant." = 99, >99 or 100. */
export function sameYield(a: string, b: string): boolean {
  const n = (s: string): { op: string; v: number } | 'q' => (s === 'quant.' ? 'q' : { op: /^[<>≥≤]/.test(s) ? s[0] : '', v: Number(s.replace(/^[<>≥≤]/, '')) });
  const x = n(a), y = n(b);
  if (x === 'q' && y === 'q') return true;
  if (x === 'q' || y === 'q') { const o = (x === 'q' ? y : x) as { op: string; v: number }; return (o.op === '' && (o.v === 99 || o.v === 100)) || (o.op === '>' && o.v === 99); }
  return x.op === y.op && x.v === y.v;
}

/** An ee as a number: "94% ee", "94", or an er converted ("97:3 er" = 94). */
export function eeOf(s: string): { ee: number; er: boolean } | null {
  const er = /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(s);
  if (er) { const a = Number(er[1]), b = Number(er[2]); return a + b > 0 ? { ee: (Math.abs(a - b) / (a + b)) * 100, er: true } : null; }
  if (/\brac(?:emic)?\b/i.test(s)) return { ee: 0, er: false };
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? { ee: Number(m[1]), er: false } : null;
}

/** The same ee: exactly, or within 0.5 when an er is involved (the printed precision). */
export function sameEe(a: string, b: string): boolean {
  const x = eeOf(a), y = eeOf(b);
  if (!x || !y) return true;
  return x.er || y.er ? Math.abs(x.ee - y.ee) <= 0.5 : x.ee === y.ee;
}

/** A dr as a fraction of the major isomer ("5:1" = 0.833, "83:17" = 0.83, ">20:1"). */
function drOf(s: string): { major: number; op: string; text: string } | null {
  const m = /([<>≥≤]?)\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  const a = Number(m[2]), b = Number(m[3]);
  return a + b > 0 ? { major: Math.max(a, b) / (a + b), op: m[1], text: `${a}:${b}` } : null;
}

/** The same dr: written the same way, or within 2%. */
export function sameDr(a: string, b: string): boolean {
  const x = drOf(a), y = drOf(b);
  if (!x || !y) return true;
  if (x.op !== y.op) return false;
  return x.text === y.text || Math.abs(x.major - y.major) <= 0.02;
}

type Col = 'yield' | 'ee' | 'dr';
const COLS: [Col, RegExp][] = [['yield', /yield/i], ['ee', /\bee\b|\ber\b|e\.e\.|e\.r\./i], ['dr', /\bdr\b|d\.r\./i]];

/** A table's label ("Table 1"), from the caption paragraph just before or after it. */
function tableName(t: DocText, para: number, n: number, c: Ctx): string {
  const paraText = (p: number): string => {
    const lines = textOf(t.runs, c).split('\n');
    return lines[p] ?? '';
  };
  for (const p of [para - 1, para - 2, para + 1]) {
    const m = /^\s*(Table\s+[A-Z]?\d+[a-z]?)/.exec(paraText(p));
    if (m) return m[1];
  }
  return `table ${n}`;
}

/** The paragraph each object is in (top-level text only). */
function objectParas(runs: readonly TextRun[]): Map<number, number> {
  const out = new Map<number, number>();
  let para = 0;
  for (const r of runs) {
    if (r.obj !== undefined) out.set(r.obj, para);
    for (const ch of r.text) if (ch === '\n') para++;
  }
  return out;
}

/**
 * The manuscript compared with the SI: compounds the manuscript gives values for that the SI
 * doesn't have (problems) or only mentions (notes), SI fields whose compound is gone, and yields,
 * ee and dr in tables that differ from the SI's (problems) or in sentences (notes).
 */
export function checkAgainstSi(t: DocText, view: SiView): SiFinding[] {
  const c = ctxOf(t, view);
  const keys = c.keys;
  const out: SiFinding[] = [];
  // IDs: the manuscript's must be the SI's (Renumber SI makes them so)
  for (const [key, ids] of manuscriptIds(t, view)) {
    const si = view.targets.find((x) => x.key === key)?.label ?? '';
    const list = [...ids];
    if (list.length > 1) out.push({ level: 'problem', key, id: list.join(', '), what: 'id', manuscript: list.join(', '), si, where: '', message: `One SI compound (${si}) is ${list.join(' and ')} in the manuscript.` });
    else if (normId(list[0]) !== normId(si)) out.push({ level: 'problem', key, id: list[0], what: 'id', manuscript: list[0], si, where: '', message: `${list[0]} here is ${si} in the SI.` });
  }
  const seenMissing = new Set<string>();
  const gone = (o: SiObj): void => {
    if (keys.has(o.key) || o.what !== 'id' || seenMissing.has('gone:' + o.key)) return;
    seenMissing.add('gone:' + o.key);
    out.push({ level: 'problem', key: o.key, id: o.text, what: 'field', manuscript: o.text, si: 'no longer in the SI', where: '', message: `${o.text} points at a compound that is no longer in the SI.` });
  };
  for (const o of Object.values(t.objects)) if (o.kind === 'si') gone(o);

  // tables: a row with one SI compound and a yield, ee or dr column
  const paraOf = objectParas(t.runs);
  let tableNo = 0;
  const tableIds = Object.entries(t.objects).filter(([, o]) => o.kind === 'table').map(([k]) => Number(k)).sort((a, b) => (paraOf.get(a) ?? 1e9) - (paraOf.get(b) ?? 1e9));
  const inTables = new Set<string>();
  for (const tid of tableIds) {
    const o = t.objects[tid];
    if (o.kind !== 'table') continue;
    tableNo++;
    const rows = o.table.rows;
    const headRows = Math.max(1, o.table.head ?? 1);
    const cols = new Map<number, Col>();
    for (let r = 0; r < Math.min(headRows, rows.length); r++) {
      rows[r].forEach((cell, k) => {
        const s = textOf(cell.runs, c);
        for (const [col, re] of COLS) if (re.test(s) && !cols.has(k)) cols.set(k, col);
      });
    }
    const name = tableName(t, paraOf.get(tid) ?? 0, tableNo, c);
    for (let r = headRows; r < rows.length; r++) {
      const row = rows[r];
      const ms = row.flatMap((cell) => mentionsIn(cell.runs, c));
      const entry = textOf(row[0]?.runs ?? [], c).trim();
      const where = `${name}, ${/^\d+[a-z]?$/.test(entry) ? `entry ${entry}` : `row ${r - headRows + 1}`}`;
      const hasValues = [...cols.keys()].some((k) => textOf(row[k]?.runs ?? [], c).trim());
      for (const m of ms) {
        if (m.inSi) { inTables.add(m.key); continue; }
        if (m.key || seenMissing.has(normId(m.id))) continue;
        seenMissing.add(normId(m.id));
        out.push(hasValues
          ? { level: 'problem', key: '', id: m.id, what: 'compound', manuscript: 'with values', si: 'not in the SI', where, message: `${m.id} has values in ${where} but is not in the SI.` }
          : { level: 'note', key: '', id: m.id, what: 'compound', manuscript: 'mentioned', si: 'not in the SI', where, message: `${m.id} is mentioned in ${where} but is not in the SI.` });
      }
      const withData = [...new Set(ms.filter((m) => m.inSi).map((m) => m.key))].filter((k) => view.data.has(k));
      if (withData.length !== 1) continue;
      const key = withData[0];
      const si = view.data.get(key)!;
      const id = ms.find((m) => m.key === key)?.id ?? '';
      for (const [k, col] of cols) {
        const cell = row[k];
        if (!cell) continue;
        const text = textOf(cell.runs, c).trim();
        if (!text) continue;
        const mine = si[col]?.trim() ?? '';
        const at = valueAt(cell, c, col, tid, r, k);
        if (!mine) { out.push({ level: 'problem', key, id, what: col, manuscript: text, si: 'empty', where, message: `${id}: ${where} gives ${label(col)} ${text}, but the SI's ${label(col)} is empty.` }); continue; }
        const agree = col === 'yield' ? agreeYield(text, mine) : col === 'ee' ? sameEe(text, mine) : sameDr(text, mine);
        if (!agree) out.push({ level: 'problem', key, id, what: col, manuscript: text, si: mine, where, message: `${id}: ${label(col)} ${withPct(text, col)} here, ${withPct(mine, col)} in the SI.`, ...(at ? { at } : {}) });
      }
    }
  }

  // sentences: "2a … 94% yield", notes only (and compounds with no SI data at all, in the text)
  const lines = splitParas(t.runs);
  lines.forEach((runs, p) => {
    const ms = mentionsIn(runs, c);
    for (const m of ms) {
      if (m.inSi || m.key || seenMissing.has(normId(m.id))) continue;
      seenMissing.add(normId(m.id));
      out.push({ level: 'note', key: '', id: m.id, what: 'compound', manuscript: 'mentioned', si: 'not in the SI', where: `paragraph ${p + 1}`, message: `${m.id} is mentioned in paragraph ${p + 1} but is not in the SI.` });
    }
    for (const s of sentences(runs, c)) {
      const sm = mentionsIn(s.runs, c).filter((m) => m.inSi && view.data.has(m.key));
      const said = new Set<string>();
      for (const { m, value } of sentenceYields(s.text, sm)) {
        const si = view.data.get(m.key)!;
        if (said.has(m.key) || !si.yield || agreeYield(value, si.yield)) continue;
        said.add(m.key);
        out.push({ level: 'note', key: m.key, id: m.id, what: 'yield', manuscript: `${value}%`, si: si.yield, where: `paragraph ${p + 1}`, message: `${m.id}: yield ${value}% in the text, ${withPct(si.yield, 'yield')} in the SI.` });
      }
    }
  });
  return out;
}

/**
 * The yields a sentence gives its compounds: "2a in 94% yield", "(2c, 92%)", "2b (91%)", or the
 * one yield of a sentence about one compound ("… gave 2a. The yield was 94%" is not caught). A
 * percentage followed by ee, de, er or conversion is not a yield.
 */
function sentenceYields(text: string, ms: Mention[]): { m: Mention; value: string }[] {
  const out: { m: Mention; value: string }[] = [];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ids = [...new Set(ms.map((m) => m.id))].sort((a, b) => b.length - a.length);
  if (!ids.length) return out;
  const anyId = new RegExp(`(?<![\\w-])(?:${ids.map(esc).join('|')})(?![\\w-])`, 'g');
  const at: { id: string; start: number; end: number }[] = [];
  for (const x of text.matchAll(anyId)) at.push({ id: x[0], start: x.index!, end: x.index! + x[0].length });
  at.forEach((a, i) => {
    const m = ms.find((x) => x.id === a.id);
    if (!m) return;
    const after = text.slice(a.end, Math.min(i + 1 < at.length ? at[i + 1].start : text.length, a.end + 40));
    // "2a in 94% yield", "2c, 92%", "2b (91%)"
    const near = /^\s*(?:\)?\s*(?:,|\(|in|was\s+obtained\s+in|was\s+isolated\s+in))\s*(?:(\d+(?:\.\d+)?)\s*%(?!\s*(?:ee|de|er|dr|conv))|(quant\.?))/i.exec(after);
    if (near) out.push({ m, value: near[1] ?? near[2] });
  });
  if (!out.length && new Set(ms.map((m) => m.key)).size === 1) {
    const y = /(\d+(?:\.\d+)?|quant\.?)\s*%?\s*yield/i.exec(text) ?? /yield\s+of\s+(\d+(?:\.\d+)?)\s*%/i.exec(text);
    if (y) out.push({ m: ms[0], value: y[1] });
  }
  return out;
}

/** A yield as printed, with a % sign when it is a bare number. */
const withPct = (v: string, col: string): string => (col === 'yield' && /^\s*[<>≥≤]?\s*\d+(\.\d+)?\s*$/.test(v) ? `${v.trim()}%` : v);

const label = (c: Col): string => (c === 'yield' ? 'yield' : c);

function agreeYield(manuscript: string, si: string): boolean {
  const mine = yieldValues(si);
  const theirs = yieldValues(manuscript);
  if (!mine.length || !theirs.length) return true;
  return theirs.some((x) => mine.some((y) => sameYield(x, y)));
}

/** Where a cell's value is, when it is a single number (so the SI's can replace it). */
function valueAt(cell: TableCell, c: Ctx, col: Col, table: number, row: number, column: number): SiFinding['at'] | undefined {
  if (col !== 'yield' || cell.runs.some((r) => r.obj !== undefined)) return undefined;
  const text = textOf(cell.runs, c);
  const m = /\d+(?:\.\d+)?/.exec(text);
  if (!m || /\d/.test(text.slice(m.index + m[0].length))) return undefined;
  return { table, row, col: column, start: m.index, end: m.index + m[0].length };
}

/** The runs of each paragraph. */
function splitParas(runs: readonly TextRun[]): TextRun[][] {
  const out: TextRun[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((x, i) => {
      if (i) out.push([]);
      if (x || r.obj !== undefined) out[out.length - 1].push({ ...r, text: r.obj !== undefined ? r.text : x });
    });
  }
  return out;
}

/** A paragraph's sentences (split after ". " before a capital), each with its runs. */
function sentences(runs: TextRun[], c: Ctx): { text: string; runs: TextRun[] }[] {
  const out: { text: string; runs: TextRun[] }[] = [];
  let cur: TextRun[] = [];
  const flush = (): void => { if (cur.length) out.push({ text: textOf(cur, c), runs: cur }); cur = []; };
  for (const r of runs) {
    if (r.obj !== undefined) { cur.push(r); continue; }
    let pos = 0;
    for (const m of r.text.matchAll(/[.!?]\s+(?=[A-Z(])/g)) {
      cur.push({ ...r, text: r.text.slice(pos, m.index! + 1) });
      flush();
      pos = m.index! + m[0].length;
    }
    if (pos < r.text.length) cur.push({ ...r, text: r.text.slice(pos) });
  }
  flush();
  return out;
}

/** The manuscript with a finding's value replaced by the SI's (a table cell's number). */
export function useSiValue(t: DocText, f: SiFinding): DocText | null {
  const at = f.at;
  if (!at || at.table === undefined || at.row === undefined || at.col === undefined) return null;
  const o = t.objects[at.table];
  if (o?.kind !== 'table') return null;
  const cell = o.table.rows[at.row]?.[at.col];
  if (!cell) return null;
  const value = yieldValues(f.si)[0];
  if (!value) return null;
  let pos = 0;
  const runs = cell.runs.map((r) => {
    const s = pos, e = pos + r.text.length;
    pos = e;
    if (at.end <= s || at.start >= e) return r;
    const a = Math.max(at.start, s) - s, b = Math.min(at.end, e) - s;
    return { ...r, text: r.text.slice(0, a) + (at.start >= s ? value : '') + r.text.slice(b) };
  }).filter((r) => r.text);
  const rows = o.table.rows.map((row, i) => (i === at.row ? row.map((c, k) => (k === at.col ? { ...c, runs } : c)) : row));
  return { ...t, objects: { ...t.objects, [at.table]: { ...o, table: { ...o.table, rows } } } };
}

/** A new SI field. */
export function siField(what: SiFieldWhat, target: SiTarget, view: SiView): SiObj {
  return { kind: 'si', what, key: target.key, text: (what === 'page' ? view.pages.get(target.key) : target.label) ?? '??' };
}

/** How often each SI compound is mentioned in the manuscript (SI fields and typed bold numbers). */
export function mentionCounts(t: DocText, view: SiView): Map<string, number> {
  const c = ctxOf(t, view);
  const counts = new Map<string, number>();
  for (const runs of allRuns(t)) for (const m of mentionsIn(runs, c)) if (m.inSi) counts.set(m.key, (counts.get(m.key) ?? 0) + 1);
  return counts;
}

/** Each compound's yield, ee, dr and name as typed in the SI (for the check). */
export function siDataOf(p: SiProject): Map<string, SiData> {
  const out = new Map<string, SiData>();
  const part = (v: unknown, k: string): string => (v && typeof v === 'object' && !Array.isArray(v) ? partText((v as Record<string, unknown>)[k]).trim() : '');
  for (const c of p.compounds) {
    const v = valuesOf(c);
    const d: SiData = {};
    const y = part(v.yield, 'percent');
    if (y) d.yield = y;
    const ee = part(v.ee, 'value');
    if (ee) d.ee = ee;
    const dr = part(v.dr, 'value');
    if (dr) d.dr = dr;
    const name = compoundName(c);
    if (name) d.name = name;
    out.set(c.id, d);
  }
  return out;
}

/** The SI compound a compound number in the text is (by the letters typed after it), with the ID it shows; null when it isn't linked. */
export function numberKey(t: DocText, obj: number): { key: string; id: string } | null {
  const i = t.runs.findIndex((r) => r.obj === obj);
  if (i < 0) return null;
  const seq = numberSeq(t.runs[i], t.objects);
  if (seq === null) return null;
  const next = t.runs[i + 1];
  const letters = next && next.obj === undefined ? LETTERS.exec(next.text)?.[0] ?? '' : '';
  const o = t.objects[seq];
  const key = o?.kind === 'seq' ? o.si?.[letters] : undefined;
  return key ? { key, id: (fieldTexts(t).get(obj) ?? '') + letters } : null;
}

/** A compound number field (a Compound seq, or a reference to one). */
export const isCompoundNumber = (t: Pick<DocText, 'objects'>, obj: number): boolean => numberSeq({ text: OBJECT_CHAR, obj }, t.objects) !== null;
