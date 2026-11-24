// Where each piece of the compiled SI came from, for the Live Preview: hovering a field on the SI
// page lights up the text it makes, the text lights up its field, and text typed in the preview
// goes back into the field it came from.
//
// A run's `src` (markup.ts Run.src, set while compiling, never stored) names its source:
//
//   c:<compound id>|<field>|<path>   a compound's field; <path> into its stored value:
//                                    "text", "mass", "#0.text" (the first NMR report's text),
//                                    "values.ketone" (a general procedure's typed value), or
//                                    "@text" for a text field kept in its own file (procedure)
//   s:<section id>|content|@text     a Text section's text
//   f:|general|@text, f:|cover|@text the General Information and the cover page's text
//   f:|settings|title                the project's title
//   g:<section id>/<gp id>|text|@text a general procedure's text
//
// Without a <path> the text is the field's but made by the program (the "calcd for" of HRMS, a
// sentence's own words): it can't be typed into, and clicking it goes to the field.

import type { Run } from './markup';
import type { Json, SiCompound, SiProject, SiSection } from './project';
import { valuesOf } from './project';
import { partText } from './fields';

/** A stretch of the compiled document (character offsets, end not included) and where it came from. */
export interface SourceSpan { start: number; end: number; src: string }

/** A page of the project's tree as it prints: 'project' (the front pages), 'section:<id>', 'scheme:<id>', 'compound:<id>', 'spectra:<compound id>'. */
export interface SourceBlock { start: number; end: number; node: string }

export const compoundSrc = (id: string, field: string, path = ''): string => `c:${id}|${field}${path ? `|${path}` : ''}`;
export const sectionSrc = (id: string): string => `s:${id}|content|@text`;
export const frontSrc = (which: 'general' | 'cover'): string => `f:|${which}|@text`;
export const TITLE_SRC = 'f:|settings|title';
export const gpSrc = (sectionId: string, gpId: string): string => `g:${sectionId}/${gpId}|text|@text`;

export interface ParsedSrc { owner: 'c' | 's' | 'f' | 'g'; id: string; field: string; path: string }

export function parseSrc(src: string): ParsedSrc | null {
  const m = /^([csfg]):([^|]*)\|([^|]+)(?:\|(.*))?$/.exec(src);
  return m ? { owner: m[1] as ParsedSrc['owner'], id: m[2], field: m[3], path: m[4] ?? '' } : null;
}

/** The field a source belongs to, without its part ("c:x|yield|mass" → "c:x|yield"). */
export function fieldOfSrc(src: string): string {
  const p = parseSrc(src);
  return p ? `${p.owner}:${p.id}|${p.field}` : src;
}

/** Text that can be typed into: it is a stored value's text, not made by the program. */
export const editableSrc = (src: string): boolean => !!parseSrc(src)?.path;

/** Runs given `src` where they have none of their own yet. */
export function tag(runs: Run[], src: string): Run[] {
  return runs.map((r) => (r.src || r.ref ? r : { ...r, src }));
}

/** The tree page a source's text is on ("compound:<id>", "section:<id>", "project"). */
export function nodeOfSrc(src: string): string | null {
  const p = parseSrc(src);
  if (!p) return null;
  if (p.owner === 'c') return `compound:${p.id}`;
  if (p.owner === 's') return `section:${p.id}`;
  if (p.owner === 'g') return `section:${p.id.split('/')[0]}`;
  return 'project';
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** The path's steps: names, and "#n" for the nth item of a list. */
const steps = (path: string): (string | number)[] => path.split('.').filter(Boolean).map((s) => (/^#\d+$/.test(s) ? Number(s.slice(1)) : s));

function getAt(v: unknown, path: string): unknown {
  let at = v;
  for (const s of steps(path)) {
    if (typeof s === 'number') at = Array.isArray(at) ? at[s] : undefined;
    else at = isObj(at) ? at[s] : undefined;
  }
  return at;
}

/** A copy of `v` with the text at `path` set (the lists and objects on the way copied). */
function setAt(v: unknown, path: string[] | (string | number)[], text: string): unknown {
  if (!path.length) {
    // (a value kept as {text} or a plain string stays as it is kept)
    if (isObj(v) && 'text' in v && typeof v.text !== 'object') return { ...v, text };
    return text;
  }
  const [s, ...rest] = path;
  if (typeof s === 'number') {
    const list = Array.isArray(v) ? [...v] : [];
    list[s] = setAt(list[s], rest, text);
    return list;
  }
  const o: Json = isObj(v) ? { ...v } : {};
  o[s] = setAt(o[s], rest, text) as Json[string];
  return o;
}

/** How a source is read and written in its project. */
export interface SourceAccess {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

/** Reading and writing the stored text a source names (null: it names nothing that can be written, or it is gone). */
export function sourceAccess(p: SiProject, src: string): SourceAccess | null {
  const s = parseSrc(src);
  if (!s || !s.path) return null;
  if (s.owner === 'c') {
    const c: SiCompound | undefined = p.compounds.find((x) => x.id === s.id);
    if (!c) return null;
    if (s.path === '@text') return { read: async () => p.compoundText(c, s.field), write: (t) => p.writeCompoundText(c, s.field, t) };
    return {
      read: async () => {
        const v = getAt(valuesOf(c)[s.field], s.path);
        return v === undefined ? null : partText(v as Json[string]);
      },
      write: async (t) => {
        const v = setAt(valuesOf(c)[s.field], steps(s.path), t);
        await p.setValue(c, s.field, v);
      },
    };
  }
  if (s.owner === 's') {
    const sec: SiSection | undefined = p.sections.find((x) => x.id === s.id);
    if (!sec || sec.type !== 'text') return null;
    return { read: () => p.readSectionText(sec), write: (t) => p.writeSectionText(sec, t) };
  }
  if (s.owner === 'f') {
    if (s.field === 'general' || s.field === 'cover') {
      const which = s.field;
      return { read: () => p.readFrontText(which), write: (t) => p.writeFrontText(which, t) };
    }
    if (s.field === 'settings' && s.path === 'title') {
      return { read: async () => partText(p.settings.title as Json[string]), write: async (t) => { p.settings.title = t; await p.saveSettings(); } };
    }
    return null;
  }
  if (s.owner === 'g') {
    const [sid, gpId] = s.id.split('/');
    const sec = p.sections.find((x) => x.id === sid);
    if (!sec) return null;
    return { read: () => p.readGpText(sec, gpId), write: (t) => p.writeGpText(gpId, t) };
  }
  return null;
}

/** The spans of one source, in order. */
export const spansOf = (spans: readonly SourceSpan[], src: string): SourceSpan[] => spans.filter((x) => x.src === src);

/** The innermost span at a character (the one starting there when two meet), or null. */
export function spanAt(spans: readonly SourceSpan[], at: number): SourceSpan | null {
  let best: SourceSpan | null = null;
  for (const s of spans) if (s.start <= at && at < s.end && (!best || s.end - s.start < best.end - best.start)) best = s;
  return best;
}

/** The innermost block holding a character (a compound inside its section). */
export function blockAt(blocks: readonly SourceBlock[], at: number): SourceBlock | null {
  let best: SourceBlock | null = null;
  for (const b of blocks) if (b.start <= at && at < b.end && (!best || b.end - b.start <= best.end - best.start)) best = b;
  return best;
}

/**
 * Synchronous Scrolling: how far down the window the page being read is taken to be (0 its top, 1
 * its bottom), the preview scrolled to `top` of `max` in a window `height` high. A third of the way
 * down, but near either end of the SI the line slides to that end, so the first and last pages can
 * be reached however short they are.
 */
export function readingLine(top: number, max: number, height: number, at = 0.3): number {
  if (height <= 0 || max <= 0) return at;
  const k = Math.max(Math.min(at, top / height), 1 - (max - top) / height);
  return Math.max(0, Math.min(1, k));
}

/**
 * Synchronous Scrolling: the page of the list to choose, the preview scrolled so that `mid` (a
 * character) is at the reading line and `edges` are the characters a little above and below it;
 * null to stay. `focus` is the page chosen now, `from` the page at the reading line when the
 * person started scrolling since it was chosen. A page is followed only once the scrolling has
 * clearly left where it started: not while the page it started on is still at the line or at
 * either edge (so a border between two pages doesn't flick back and forth, and a little scroll
 * after choosing a page never leaves it).
 */
export function pageToFollow(blocks: readonly SourceBlock[], mid: number, edges: readonly number[], focus: string | null, from: string | null): string | null {
  const next = pageAt(blocks, mid);
  if (!next || next === focus || next === from) return null;
  const start = from ?? focus;
  if (start && edges.some((o) => pageAt(blocks, o) === start)) return null;
  return next;
}

/** The page a character is on, or (text no page of the list holds, as the references at the end) the last page before it. */
function pageAt(blocks: readonly SourceBlock[], at: number): string | null {
  const own = blockAt(blocks, at);
  if (own) return own.node;
  let best: SourceBlock | null = null;
  for (const b of blocks) if (b.end <= at && (!best || b.end > best.end || (b.end === best.end && b.end - b.start < best.end - best.start))) best = b;
  return best?.node ?? null;
}
