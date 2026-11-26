// What Chemweave adds to SI Assistant's flags (compound.json "flags": {field: {comment, by, at}}):
// replies, @mentions, resolving and flags on a section's heading, kept in a file of Chemweave's own
// in the project folder so SI Assistant's files stay as SI Assistant writes them:
//
//   chemweave-flags.json: {"version": 1,
//     "threads": {"c:<compound id>/<field>" | "s:<section id>/<flag id>":
//                   {"replies": [{"text", "by", "at"}], "resolved": {"by", "at", "flag": {comment, by, at}}}},
//     "sections": {"<section id>": {"<flag id>": {"comment", "by", "at"}}}}
//
// A resolved compound flag is taken out of compound.json (so SI Assistant's warnings clear too) and
// kept here with who resolved it; reopening puts it back. A section flag lives here only, as SI
// Assistant has none. Deleting a flag deletes its thread too.

export const FLAGS_FILE = 'chemweave-flags.json';
const VERSION = 1;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A flag as SI Assistant keeps it: what to check, who flagged it and when. */
export interface FlagRecord { comment: string; by: string; at: string }
export interface FlagNote { text: string; by: string; at: string }
export interface FlagThread {
  replies: FlagNote[];
  /** Resolved: who and when, and the flag as it was (put back on Reopen). */
  resolved?: { by: string; at: string; flag: FlagRecord };
}
export interface FlagFile {
  threads: Record<string, FlagThread>;
  sections: Record<string, Record<string, FlagRecord>>;
}

/** Where a flag is: a compound's field, or a flag on a section's heading. */
export const compoundAnchor = (compound: string, field: string): string => `c:${compound}/${field}`;
export const sectionAnchor = (section: string, flag: string): string => `s:${section}/${flag}`;
export function parseAnchor(a: string): { kind: 'compound'; id: string; field: string } | { kind: 'section'; id: string; flag: string } | null {
  const m = /^([cs]):([^/]+)\/(.+)$/.exec(a);
  if (!m) return null;
  return m[1] === 'c' ? { kind: 'compound', id: m[2], field: m[3] } : { kind: 'section', id: m[2], flag: m[3] };
}

export const emptyFlagFile = (): FlagFile => ({ threads: {}, sections: {} });

export function flagRecord(v: unknown): FlagRecord | null {
  if (!isObj(v)) return null;
  return { comment: str(v.comment), by: str(v.by), at: str(v.at) };
}

function note(v: unknown): FlagNote | null {
  if (!isObj(v) || !str(v.text).trim()) return null;
  return { text: str(v.text), by: str(v.by), at: str(v.at) };
}

/** The file as read; null when it is there but can't be read (it is then never written over). */
export function parseFlagFile(raw: string | null | undefined): FlagFile | null {
  if (raw === null || raw === undefined || !raw.trim()) return emptyFlagFile();
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!isObj(j)) return null;
  // (written by a newer Chemweave: shown as far as it goes, never written over)
  if (typeof j.version === 'number' && j.version > VERSION) return null;
  const out = emptyFlagFile();
  if (isObj(j.threads)) {
    for (const [a, t] of Object.entries(j.threads)) {
      if (!parseAnchor(a) || !isObj(t)) continue;
      const replies = Array.isArray(t.replies) ? t.replies.map(note).filter((n): n is FlagNote => !!n) : [];
      const r = isObj(t.resolved) ? t.resolved : null;
      const flag = r ? flagRecord(r.flag) : null;
      const thread: FlagThread = { replies };
      if (r && flag) thread.resolved = { by: str(r.by), at: str(r.at), flag };
      if (thread.replies.length || thread.resolved) out.threads[a] = thread;
    }
  }
  if (isObj(j.sections)) {
    for (const [s, flags] of Object.entries(j.sections)) {
      if (!isObj(flags)) continue;
      const kept: Record<string, FlagRecord> = {};
      for (const [id, f] of Object.entries(flags)) { const r = flagRecord(f); if (r) kept[id] = r; }
      if (Object.keys(kept).length) out.sections[s] = kept;
    }
  }
  return out;
}

export function flagFileJson(f: FlagFile): string {
  // (empty threads and sections aren't kept)
  const threads = Object.fromEntries(Object.entries(f.threads).filter(([, t]) => t.replies.length || t.resolved));
  const sections = Object.fromEntries(Object.entries(f.sections).filter(([, s]) => Object.keys(s).length));
  return JSON.stringify({ version: VERSION, threads, sections }, null, 2) + '\n';
}

let counter = 0;
export const newFlagId = (): string => `f-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The thread of a flag, made when missing. */
export function threadOf(f: FlagFile, anchor: string): FlagThread {
  return f.threads[anchor] ?? (f.threads[anchor] = { replies: [] });
}

/**
 * The people a text mentions: each "@" followed by one of `people`' names (the longest that
 * fits, so "@Alex Example" is Alex Example, not someone called Alex), in the order mentioned.
 */
export function mentionsIn(text: string, people: readonly string[]): string[] {
  const names = [...new Set(people.map((p) => p.trim()).filter(Boolean))];
  const out: string[] = [];
  for (const [a, b] of mentionRanges(text, names)) {
    const who = names.find((n) => n.toLowerCase() === text.slice(a + 1, b).toLowerCase());
    if (who && !out.includes(who)) out.push(who);
  }
  return out;
}

/** Where the mentions are in a text: [start, end) of each "@Name", for showing them. */
export function mentionRanges(text: string, people: readonly string[]): [number, number][] {
  const names = [...new Set(people.map((p) => p.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  const out: [number, number][] = [];
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (i > 0 && /[\w.]/.test(text[i - 1])) continue;
    const rest = text.slice(i + 1).toLowerCase();
    const who = names.find((n) => rest.startsWith(n.toLowerCase()) && !/[\p{L}\p{N}]/u.test(rest[n.length] ?? ''));
    if (who) out.push([i, i + 1 + who.length]);
  }
  return out;
}
