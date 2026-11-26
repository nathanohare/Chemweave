// Text typed in the Live Preview where no field is (a note between two sentences of a compound's
// data, a paragraph after a section's text): the person's own, kept in the project folder in a
// file of Chemweave's own (SI Assistant doesn't read it, and keeps the folder's other files as
// they are), and put back in its place each time the SI is compiled, so it is in the preview,
// in Compile ▸ Document and PDF, and in the snapshot .docx.
//
// Each piece is placed after the text of a field (`after`, a source of source-map.ts) in a page
// of the tree (`node`): when that field prints nothing any more it goes at the page's start;
// when the page is gone it goes at the end of the SI.
// Either way it is still there, flagged as text no field holds.

import * as rt from '../richtext';
import type { TextRun } from '../model';
import type { DocText } from '../document/document';
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
  /** Its text (plain; a paragraph's end as "\n"). */
  text: string;
}

/** Where each piece went, and whether it is where it was put. */
export interface PlacedCustom { id: string; start: number; end: number; anchored: boolean }

export async function readCustomText(folder: SiFolder): Promise<CustomText[]> {
  const raw = await folder.readText(CUSTOM_TEXT_FILE).catch(() => null);
  return (raw && parseCustomText(raw)) || [];
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
    const data = JSON.parse(raw) as { items?: unknown };
    if (!data || !Array.isArray(data.items)) return null;
    return data.items.filter((x): x is CustomText => !!x && typeof x === 'object' && typeof (x as CustomText).id === 'string' && typeof (x as CustomText).text === 'string')
      .map((x) => ({ id: x.id, node: String(x.node ?? ''), after: String(x.after ?? ''), gap: String(x.gap ?? ''), text: x.text }));
  } catch {
    return null;
  }
}

export function customTextJson(items: readonly CustomText[]): string {
  return JSON.stringify({ about: 'Text typed in Chemweave’s Live Preview where no field is. Chemweave puts it back in its place when the SI is compiled.', version: 1, items }, null, 2) + '\n';
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
  // (the document's text, kept up to date here rather than read again for each piece)
  let text = rt.plainText(t.runs);
  for (const item of items) {
    if (!item.text) continue;
    const block = blks.find((b) => b.node === item.node) ?? null;
    let at: number;
    let anchored = true;
    if (!block) { at = text.length; anchored = false; }
    else {
      const inside = (s: SourceSpan): boolean => s.start >= block.start && s.end <= block.end;
      // (a field printed in more than one piece on the page: the piece the text was typed after,
      // the one followed by what was between them, else the last)
      const pieces = item.after ? srcs.filter((s) => s.src === item.after && inside(s)) : [];
      const after = (item.gap ? pieces.find((s) => text.startsWith(item.gap, s.end)) : undefined) ?? pieces.pop();
      if (item.after && !after) anchored = false;
      at = after ? after.end : block.start;
      // (what was between, kept: the space after a sentence, a citation)
      if (item.gap && text.startsWith(item.gap, at)) at += item.gap.length;
      else if (item.gap && after) at = Math.min(block.end, at);
      // (the end of the page's text, not past the paragraph's end that closes it)
      if (at > block.end) at = block.end;
    }
    const len = item.text.length;
    t = insertText(t, at, item.text, text);
    text = text.slice(0, at) + item.text + text.slice(at);
    // the stretches after it move along; one it is inside grows
    srcs = srcs.map((s) => (s.start >= at ? { ...s, start: s.start + len, end: s.end + len } : s.end > at ? { ...s, end: s.end + len } : s));
    // the page it is on grows, and the pages around that one; a page ending where it goes (the
    // page before) stays as it is, and the pages after it move along
    const holds = block ? blks.filter((b) => b.start <= block.start && block.end <= b.end) : [];
    for (const b of blks) {
      if (holds.includes(b) || (b.start < at && at < b.end)) b.end += len;
      else if (b.start >= at) { b.start += len; b.end += len; }
    }
    for (const p of placed) if (p.start >= at) { p.start += len; p.end += len; }
    srcs.push({ start: at, end: at + len, src: customSrc(item.id) });
    placed.push({ id: item.id, start: at, end: at + len, anchored });
  }
  srcs.sort((a, b) => a.start - b.start || a.end - b.end);
  return { doc: t, sources: srcs, blocks: blks, placed };
}

/** `text` put into a document at `at`, in the look of the character before it; each "\n" a new paragraph like the one it is in. */
export function insertText(t: DocText, at: number, text: string, plain = rt.plainText(t.runs)): DocText {
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
