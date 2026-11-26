// Text typed in the Live Preview where no field is (a note between two sentences of a compound's
// data, a paragraph after a section's text): the person's own, kept in the project folder in a
// file of Chemweave's own (SI Assistant doesn't read it, and keeps the folder's other files as
// they are), and put back in its place each time the SI is compiled, so it is in the preview,
// in Compile ▸ Document and PDF, and in the snapshot .docx.
//
// Each piece is placed after the text of a field (`after`, a source of source-map.ts) in a page
// of the tree (`node`): when that field prints nothing any more it goes after the page's last
// text before it, then at the page's start; when the page is gone it goes at the end of the SI.
// Either way it is still there, flagged as text no field holds.
//
// A piece can hold equations (Insert ▸ Equation in the Live Preview): each is an object character
// (U+FFFC) in its text, with the equation's LaTeX at the same place in its `math` list, so the
// text stays plain and the equations stay where they were typed. Fields hold none: SI Assistant's
// text format has no equations, and this file is Chemweave's own.

import * as rt from '../richtext';
import type { TextRun } from '../model';
import { OBJECT_CHAR, equationRun, nextObjectId, type DocText } from '../document/document';
import type { SiFolder } from './folder';
import { customSrc } from './preview-edit';
import type { SourceBlock, SourceSpan } from './source-map';

export const CUSTOM_TEXT_FILE = 'chemweave-custom-text.json';

export interface CustomText {
  id: string;
  /** The page of the tree it is on ('compound:<id>', 'section:<id>', 'project'). */
  node: string;
  /** The source whose text it follows ('' = the page's start). */
  after: string;
  /** What is between that text and it, as it was when typed (a space, a citation): kept. */
  gap: string;
  /** Its text (plain; a paragraph's end as "\n"; an equation as U+FFFC). */
  text: string;
  /** The LaTeX of the equation at each U+FFFC of `text`, in order ('' for none). */
  math?: string[];
}

/** Where each piece went, and whether it is where it was put. */
export interface PlacedCustom { id: string; start: number; end: number; anchored: boolean }

export async function readCustomText(folder: SiFolder): Promise<CustomText[]> {
  return (await readCustomTextForCompile(folder)).items;
}

/** The custom text for a compile, and whether the file was written by a newer Chemweave (so isn't used: said in the compile's notes). */
export async function readCustomTextForCompile(folder: SiFolder): Promise<{ items: CustomText[]; newer: boolean }> {
  const raw = await folder.readText(CUSTOM_TEXT_FILE).catch(() => null);
  if (!raw) return { items: [], newer: false };
  let newer = false;
  try { const v = (JSON.parse(raw) as { version?: unknown })?.version; newer = typeof v === 'number' && v > CUSTOM_TEXT_VERSION; } catch { /* (not the file's format) */ }
  return { items: parseCustomText(raw) ?? [], newer };
}

/** The custom text to change and save: as readCustomText, but a file that can't be read is an error (saving over it would lose its text). */
export async function readCustomTextToChange(folder: SiFolder): Promise<CustomText[]> {
  // (a file that is there but can't be read now throws: it is never written over as if it weren't there)
  const raw = await folder.readText(CUSTOM_TEXT_FILE);
  if (!raw || !raw.trim()) return [];
  const got = parseCustomText(raw);
  if (!got) throw new Error(`${CUSTOM_TEXT_FILE} in the project folder can’t be read (half synced, or changed by hand), so it wasn’t saved over. Fix or remove it, then type again`);
  return got;
}

/** The items of the file's text (null: not the file's format). */
export function parseCustomText(raw: string): CustomText[] | null {
  try {
    const data = JSON.parse(raw) as { items?: unknown; version?: unknown };
    if (!data || !Array.isArray(data.items)) return null;
    // (written by a newer Chemweave: never written over)
    if (typeof data.version === 'number' && data.version > CUSTOM_TEXT_VERSION) return null;
    return data.items.filter((x): x is CustomText => !!x && typeof x === 'object' && typeof (x as CustomText).id === 'string' && typeof (x as CustomText).text === 'string')
      .map((x) => {
        // (keys a newer Chemweave added are kept as they are, so writing the file back keeps them)
        const { math: _m, ...rest } = x;
        const item: CustomText = { ...rest, id: x.id, node: String(x.node ?? ''), after: String(x.after ?? ''), gap: String(x.gap ?? ''), text: x.text };
        if (Array.isArray(x.math) && x.math.length) item.math = x.math.map((m) => (typeof m === 'string' ? m : ''));
        return item;
      });
  } catch {
    return null;
  }
}

/** The newest version of the file this Chemweave reads (2: pieces can hold equations). */
const CUSTOM_TEXT_VERSION = 2;

export function customTextJson(items: readonly CustomText[]): string {
  // (version 2 only with an equation: a Chemweave that checks the version and reads only version 1
  // leaves the file alone instead of dropping it; Chemweave from before the version was checked
  // can still write over it)
  const version = items.some((x) => x.math?.some(Boolean)) ? 2 : 1;
  return JSON.stringify({ about: 'Text typed in Chemweave’s Live Preview where no field is. Chemweave puts it back in its place when the SI is compiled.', version, items }, null, 2) + '\n';
}

/**
 * A piece's text and equations as they are in a document now: the text of its stretches
 * [start, end) of `t`, and the LaTeX of each equation in it (each at an object character).
 */
export function customPiece(t: Pick<DocText, 'runs' | 'objects'>, ranges: readonly [number, number][]): { text: string; math?: string[] } {
  let text = '';
  const math: string[] = [];
  for (const [a, b] of ranges) {
    for (const r of rt.sliceRuns(t.runs, a, b)) {
      text += r.text;
      // (an entry for every object character, '' for one that is no equation, such as one pasted as a letter: left out on compiling)
      const o = r.obj !== undefined ? t.objects[r.obj] : undefined;
      for (let i = 0; i < r.text.length; i++) if (r.text[i] === OBJECT_CHAR) math.push(o?.kind === 'math' ? o.tex : '');
    }
  }
  return math.some(Boolean) ? { text, math } : { text };
}

/** A piece's text as words to show (a warning's line): each equation as its LaTeX. */
export function customShown(item: Pick<CustomText, 'text' | 'math'>): string {
  let k = 0;
  return [...item.text].map((ch) => (ch === OBJECT_CHAR ? (item.math?.[k++] ? `[${item.math[k - 1]}]` : '') : ch)).join('');
}

export const newCustomId = (): string => `k-${Date.now().toString(16).slice(-6)}${Math.random().toString(16).slice(2, 6)}`;

/** A place for new text typed at `at`: the page it is on, the field text before it there, and what is between. */
export function customAnchor(text: string, spans: readonly SourceSpan[], blocks: readonly SourceBlock[], at: number): Omit<CustomText, 'id' | 'text'> {
  let block: SourceBlock | null = null;
  for (const b of blocks) if (b.start <= at && at <= b.end && (!block || b.end - b.start <= block.end - block.start)) block = b;
  const from = block?.start ?? 0;
  let before: SourceSpan | null = null;
  for (const s of spans) if (s.end <= at && s.start >= from && (!before || s.end > before.end)) before = s;
  return { node: block?.node ?? 'project', after: before?.src ?? '', gap: text.slice(before?.end ?? from, at) };
}

/**
 * The document with the custom text put in (runs in the look of the text before each place),
 * its sources and blocks moved to match, each piece a source of its own.
 */
export function placeCustomText(doc: DocText, sources: SourceSpan[], blocks: SourceBlock[], items: readonly CustomText[]): { doc: DocText; sources: SourceSpan[]; blocks: SourceBlock[]; placed: PlacedCustom[] } {
  let t = doc;
  let srcs = sources.map((s) => ({ ...s }));
  const blks = blocks.map((b) => ({ ...b }));
  const placed: PlacedCustom[] = [];
  for (const item of items) {
    if (!item.text) continue;
    const text = rt.plainText(t.runs);
    const block = blks.find((b) => b.node === item.node) ?? null;
    let at: number;
    let anchored = true;
    if (!block) { at = text.length; anchored = false; }
    else {
      const inside = (s: SourceSpan): boolean => s.start >= block.start && s.end <= block.end;
      const after = item.after ? srcs.filter((s) => s.src === item.after && inside(s)).pop() : undefined;
      if (item.after && !after) anchored = false;
      at = after ? after.end : block.start;
      // (what was between, kept: the space after a sentence, a citation)
      if (item.gap && text.startsWith(item.gap, at)) at += item.gap.length;
      else if (item.gap && after) at = Math.min(block.end, at);
      // (the end of the page's text, not past the paragraph's end that closes it)
      if (at > block.end) at = block.end;
    }
    // (an object character with no equation is left out)
    let k = 0;
    const eqs: string[] = [];
    const shown = [...item.text].filter((ch) => { if (ch !== OBJECT_CHAR) return true; const m = item.math?.[k++] ?? ''; if (m) eqs.push(m); return !!m; }).join('');
    if (!shown) continue;
    const len = shown.length;
    t = insertText(t, at, shown);
    if (eqs.length) t = putEquations(t, at, shown, eqs);
    // the stretches after it move along; one it is inside grows
    srcs = srcs.map((s) => (s.start >= at ? { ...s, start: s.start + len, end: s.end + len } : s.end > at ? { ...s, end: s.end + len } : s));
    for (const b of blks) { if (b.start > at) b.start += len; if (b.end >= at) b.end += len; }
    for (const p of placed) if (p.start >= at) { p.start += len; p.end += len; }
    srcs.push({ start: at, end: at + len, src: customSrc(item.id) });
    placed.push({ id: item.id, start: at, end: at + len, anchored });
  }
  srcs.sort((a, b) => a.start - b.start || a.end - b.end);
  return { doc: t, sources: srcs, blocks: blks, placed };
}

/** The object characters of `text`, put in at `at`, made the equations `eqs` (in order), in the look of the text there. */
function putEquations(t: DocText, at: number, text: string, eqs: readonly string[]): DocText {
  let runs = t.runs;
  const objects = { ...t.objects };
  let k = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== OBJECT_CHAR) continue;
    const id = nextObjectId({ objects });
    objects[id] = { kind: 'math', tex: eqs[k++] };
    // (the look of the text put in, which has no link, field or object of its own: styleAt)
    runs = rt.replaceRange(runs, at + i, at + i + 1, [equationRun(id, rt.styleOf(rt.sliceRuns(runs, at + i, at + i + 1)[0] ?? { text: '' }))]);
  }
  return { ...t, runs, objects };
}

/** `text` put into a document at `at`, in the look of the character before it; each "\n" a new paragraph like the one it is in. */
export function insertText(t: DocText, at: number, text: string): DocText {
  const plain = rt.plainText(t.runs);
  const look = styleAt(t.runs, at);
  const runs = rt.replaceRange(t.runs, at, at, [{ ...look, text } as TextRun]);
  const breaks = text.split('\n').length - 1;
  if (!breaks) return { ...t, runs };
  const para = plain.slice(0, at).split('\n').length - 1;
  const paras = [...t.paras];
  const like = paras[para] ?? {};
  paras.splice(para + 1, 0, ...Array.from({ length: breaks }, () => ({ ...like, pageBreak: undefined, marks: undefined })));
  return { ...t, runs, paras };
}

/** The look of the text just before `at` (or after it, at the start): never a link, a field or an object. */
function styleAt(runs: readonly TextRun[], at: number): rt.RunStyle {
  let pos = 0;
  let found: TextRun | null = null;
  for (const r of runs) {
    if (pos < at && at <= pos + r.text.length && r.text !== '\n') found = r;
    else if (!found && pos >= at) { found = r; break; }
    pos += r.text.length;
  }
  if (!found) return {};
  const s = { ...rt.styleOf(found) } as Record<string, unknown>;
  for (const k of ['link', 'obj', 'field', 'sub', 'sup']) delete s[k];
  return s as rt.RunStyle;
}
