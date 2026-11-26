// The compiled SI's paragraph styles as changed in Project Settings ▸ Styles (Word's Modify
// Style): kept in the project folder in a file of Chemweave's own (SI Assistant doesn't read it),
// and put on the styles each time the SI is compiled (preview, Compile ▸ Document and PDF, the
// Word snapshot). A style left as it was isn't stored, so it keeps following Chemweave's defaults.

import { defaultStyles, type NamedStyle } from '../document/document';
import type { Justify } from '../model';
import type { SiFolder } from './folder';

export const SI_STYLES_FILE = 'chemweave-styles.json';

/** What can be changed in a style. */
export type StyleLook = Partial<Pick<NamedStyle, 'font' | 'size' | 'bold' | 'italic' | 'color' | 'align' | 'spaceBefore' | 'spaceAfter' | 'line'>>;
export type StyleLooks = Record<string, StyleLook>;

/** The styles the page lists (the compiled SI's own, by Word's style id), in the order shown. */
export const SI_STYLE_LIST: readonly { id: string; name: string }[] = [
  { id: 'Normal', name: 'Normal' },
  { id: 'Heading1', name: 'Heading 1' },
  { id: 'Heading2', name: 'Heading 2' },
  { id: 'Heading3', name: 'Heading 3' },
  { id: 'SICompound', name: 'Compound Title' },
  { id: 'Caption', name: 'Caption' },
  { id: 'SITocHeading', name: 'Contents Heading' },
];

/** The SI's own styles, made from Normal as the SI is compiled (compile-doc.ts). */
export const SI_COMPOUND_LOOK = { size: 11, bold: true, align: 'left', spaceBefore: 15, spaceAfter: 5 } as const satisfies StyleLook;
export const SI_TOC_HEADING_LOOK = { size: 13, bold: true, align: 'left', spaceBefore: 0, spaceAfter: 10 } as const satisfies StyleLook;

/** A listed style as it is before any change of its own (what the Styles page starts from, and what isn't stored); `normal`: Normal's changes. */
export function styleDefault(id: string, normal: StyleLook = {}): NamedStyle {
  const all = defaultStyles();
  // (the SI's own styles are made from Normal as it is then: its changes show through)
  if (id === 'SICompound') return { ...all.Normal, ...normal, ...SI_COMPOUND_LOOK, id, name: 'Compound Title' };
  if (id === 'SITocHeading') return { ...all.Normal, ...normal, ...SI_TOC_HEADING_LOOK, id, name: 'Contents Heading' };
  return all[id] ?? { ...all.Normal, id, name: id };
}

const ALIGNS: readonly Justify[] = ['left', 'center', 'right', 'justify'];
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

/** One style's changes as read (anything out of range left out). */
export function cleanLook(x: unknown): StyleLook {
  if (!x || typeof x !== 'object') return {};
  const o = x as Record<string, unknown>;
  const out: StyleLook = {};
  if (typeof o.font === 'string' && o.font.trim()) out.font = o.font.trim();
  const size = num(o.size, 1, 400); if (size !== undefined) out.size = size;
  if (typeof o.bold === 'boolean') out.bold = o.bold;
  if (typeof o.italic === 'boolean') out.italic = o.italic;
  if (typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color)) out.color = o.color.toLowerCase();
  if (typeof o.align === 'string' && (ALIGNS as readonly string[]).includes(o.align)) out.align = o.align as Justify;
  const before = num(o.spaceBefore, 0, 200); if (before !== undefined) out.spaceBefore = before;
  const after = num(o.spaceAfter, 0, 200); if (after !== undefined) out.spaceAfter = after;
  const line = num(o.line, 0.5, 5); if (line !== undefined) out.line = line;
  return out;
}

/** The file's styles; null when it can't be read (so it is never written over). */
export function parseStyleLooks(raw: string): StyleLooks | null {
  try {
    const j = JSON.parse(raw) as { styles?: unknown; version?: unknown };
    if (!j || !j.styles || typeof j.styles !== 'object' || Array.isArray(j.styles)) return null;
    if (typeof j.version === 'number' && j.version > 1) return null;
    const out: StyleLooks = {};
    for (const [id, x] of Object.entries(j.styles as Record<string, unknown>)) {
      const look = cleanLook(x);
      if (Object.keys(look).length) out[id] = look;
    }
    return out;
  } catch {
    return null;
  }
}

export function styleLooksJson(looks: StyleLooks): string {
  const styles = Object.fromEntries(Object.entries(looks).filter(([, l]) => Object.keys(l).length));
  return JSON.stringify({ version: 1, styles }, null, 1) + '\n';
}

export async function readStyleLooks(folder: SiFolder): Promise<StyleLooks> {
  const raw = await folder.readText(SI_STYLES_FILE).catch(() => null);
  return (raw && parseStyleLooks(raw)) || {};
}

/** The styles to change and write back; throws when the file is there but can't be read. */
export async function readStyleLooksToChange(folder: SiFolder): Promise<StyleLooks> {
  // (a file that is there but can't be read now throws: it is never written over as if it weren't there)
  const raw = await folder.readText(SI_STYLES_FILE);
  if (!raw || !raw.trim()) return {};
  const got = parseStyleLooks(raw);
  if (!got) throw new Error(`${SI_STYLES_FILE} in the project folder can’t be read (half synced, or changed by hand), so it wasn’t saved over. Fix or remove it, then save again`);
  return got;
}

const NEW_PROJECT_KEY = 'si.newProjectStyles';

/** The styles a new SI project starts with (Use for New SI Projects; kept on this computer). */
export function newProjectStyleLooks(): StyleLooks {
  try {
    const raw = globalThis.localStorage?.getItem(NEW_PROJECT_KEY);
    return (raw && parseStyleLooks(raw)) || {};
  } catch {
    return {};
  }
}

export function setNewProjectStyleLooks(looks: StyleLooks): boolean {
  try { globalThis.localStorage?.setItem(NEW_PROJECT_KEY, styleLooksJson(looks)); return true; } catch { return false; }
}

/** The listed style a compiled style follows: the numbered Compound Title and SI Heading styles follow theirs. */
export function listedStyleOf(id: string): string {
  if (id.startsWith('SICompound')) return 'SICompound';
  const h = /^SIHeading(\d)$/.exec(id);
  return h ? `Heading${h[1]}` : id;
}

/** Put the changes on the document's styles (in place). */
export function applyStyleLooks(styles: Record<string, NamedStyle>, looks: StyleLooks): void {
  if (!Object.keys(looks).length) return;
  for (const [id, s] of Object.entries(styles)) {
    const look = looks[listedStyleOf(id)];
    if (look) styles[id] = { ...s, ...look };
  }
}
