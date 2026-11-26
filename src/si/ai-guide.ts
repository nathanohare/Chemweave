// The guide for AI assistants that import an SI (docs/guide/si-import-for-ai.md), and what is
// made from it, so there is one text to keep up to date:
//
// - the guide to copy or save for an AI (Help ▸ Copy Guide for AI Assistants, Save Guide for AI
//   Assistants…, and Insert ▸ Import with AI on the SI tab): the guide's starter prompt, told to
//   read the guide that follows it, then the guide itself;
// - the short note for AI assistants kept in a project (AGENTS.md, the name coding agents look
//   for): what the folder is, where the guide is, and the guide's Critical rules. It is written
//   into a new project, and into an open one by Import with AI. Its first line holds a
//   fingerprint of the rest, so a note someone changed (or wrote) is never replaced.

import type { SiProject } from './project';

export const AI_NOTES_FILE = 'AGENTS.md';
/** Where the guide is on the web (the page AI assistants are pointed at). */
export const AI_GUIDE_URL = 'https://raw.githubusercontent.com/nathanohare/Chemweave/main/docs/guide/si-import-for-ai.md';
/** How the first line of a note Chemweave wrote begins; the line ends with a fingerprint of the rest. */
export const AI_NOTES_MARK = '<!-- Written by Chemweave, which replaces this file while it is unchanged';
/** The name the guide is saved under. */
export const AI_GUIDE_FILE_NAME = 'Chemweave SI guide for AI assistants.md';

/** The guide's text (loaded the first time it is asked for). */
export const loadAiGuide = (): Promise<string> => import('../../docs/guide/si-import-for-ai.md?raw').then((m) => m.default);

/** The text under a "## " heading of the guide, up to the next one (trimmed); '' when there is none. */
export function guideSection(md: string, heading: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at < 0) return '';
  let end = lines.length;
  let fence = false;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) fence = !fence;
    if (!fence && /^## /.test(lines[i])) { end = i; break; }
  }
  return lines.slice(at + 1, end).join('\n').trim();
}

/** Links to a heading of the guide itself made plain text (they lead nowhere outside it). */
const plainAnchors = (t: string): string => t.replace(/\[([^\]]+)\]\(#[^)]*\)/g, '$1');

/** The paragraph a chemist pastes to their AI (the guide's quoted starter prompt). */
export function starterPrompt(md: string): string {
  return guideSection(md, 'Start your assistant').split('\n').filter((l) => l.startsWith('>')).map((l) => l.replace(/^>\s?/, '')).join('\n').trim();
}

/** The starter prompt and the whole guide after it, to paste or attach in one go. */
export function guideToCopy(md: string): string {
  const prompt = starterPrompt(md).replace(/First read \S+ in full and follow it\./, 'First read the guide below in full and follow it.');
  const text = md.replace(/\r\n/g, '\n');
  const start = guideSection(text, 'Start your assistant');
  const guide = start ? text.replace(`## Start your assistant\n\n${start}\n\n`, '') : text;
  return `${prompt}\n\n---\n\n${guide.trim()}\n`;
}

/** The note for AI assistants kept in a project (AGENTS.md). */
export function aiNotes(md: string): string {
  const rules = plainAnchors(guideSection(md, 'Critical rules')).split('\n').filter((l) => !/^Agent: /.test(l)).join('\n').trim();
  const body = [
    '# Notes for AI assistants',
    '',
    'This folder is a Chemweave SI project (a Supporting Information): `project.json`, `references.json`, `front/` and `sections/`. Chemweave keeps it zipped as one `.chemsi` file. Before you add data to it or change anything, read the whole guide for AI assistants and follow it:',
    '',
    `- ${AI_GUIDE_URL}`,
    '- or, in Chemweave, **Help ▸ Save Guide for AI Assistants…** saves it as a file.',
    '',
    '## Critical rules',
    '',
    rules,
    '',
  ].join('\n');
  return `${AI_NOTES_MARK} (${fingerprint(body)}). -->\n${body}`;
}

/** A short fingerprint of a text (FNV-1a, 32 bits), to tell a note Chemweave wrote from one changed since. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** What writing the note did: written new, updated (Chemweave's, now different), already the same, or kept (someone's own). */
export type AiNotesResult = 'written' | 'updated' | 'same' | 'kept';

/** What writing the note to a project with `existing` as its AGENTS.md (null: none) would do. */
export function aiNotesAction(existing: string | null, notes: string): AiNotesResult {
  if (existing === null) return 'written';
  const text = existing.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (text === notes) return 'same';
  // (Chemweave's, unchanged since it was written: its first line's fingerprint is the rest's)
  const nl = text.indexOf('\n');
  const first = nl < 0 ? text : text.slice(0, nl);
  const m = first.startsWith(AI_NOTES_MARK) ? / \(([0-9a-f]{8})\)\. -->$/.exec(first) : null;
  return m && m[1] === fingerprint(text.slice(nl + 1)) ? 'updated' : 'kept';
}

/** Write (or update) the note in a project; a note that isn't Chemweave's is left as it is. */
export async function writeAiNotes(p: SiProject, md: string): Promise<AiNotesResult> {
  const notes = aiNotes(md);
  const did = aiNotesAction(await p.folder.readText(AI_NOTES_FILE), notes);
  if (did === 'written' || did === 'updated') await p.folder.writeText(AI_NOTES_FILE, notes);
  return did;
}
