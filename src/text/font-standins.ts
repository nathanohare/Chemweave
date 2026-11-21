// The free font that stands in for a font this computer (or a PDF reader) may not have. Each
// stand-in has the same letter widths as the font it replaces, so lines break in the same places
// with or without the real font: Carlito for Calibri, Caladea for Cambria, Arimo for Arial,
// Tinos for Times New Roman, Cousine for Courier New (all under the SIL Open Font License).
//
// Other fonts get the stand-in of their kind (serif, sans or monospace). The kind comes from the
// font's name, or from what a Word file's font table says about the font (`w:family`), which is
// how Word itself picks a substitute for a font that isn't installed.

export type FontClass = 'serif' | 'sans' | 'mono';

/** What Word files' font tables said, by lower-case font name. */
const hints = new Map<string, FontClass>();
const stacks = new Map<string, string[]>();

const key = (name: string) => name.trim().replace(/^['"]|['"]$/g, '').toLowerCase();

/** Note the kind of a font, as a Word file's font table gives it (roman, swiss, modern...). */
export function hintFontClass(name: string, cls: FontClass): void {
  const k = key(name);
  if (!k || hints.get(k) === cls) return;
  hints.set(k, cls);
  stacks.clear();
}

/** Fonts embedded in open documents, by lower-case name: the name each is loaded under. */
const embedded = new Map<string, string>();

/**
 * A font embedded in a document is loaded under `alias`: it comes after the font itself, so it is
 * used only where the font isn't installed, before any stand-in.
 */
export function useEmbeddedFont(name: string, alias: string): void {
  const k = key(name);
  if (!k || embedded.get(k) === alias) return;
  embedded.set(k, alias);
  stacks.clear();
}

/** The kind of font from Word's font family (w:family): null for 'auto' and the rest. */
export function wordFontClass(family: string | null | undefined): FontClass | null {
  switch ((family ?? '').toLowerCase()) {
    case 'roman': return 'serif';
    case 'swiss': return 'sans';
    case 'modern': return 'mono';
    default: return null;
  }
}

/** Serif, sans or monospace: from a font table's hint, otherwise from the font's name. */
export function fontClass(family: string): FontClass {
  const f = key(family);
  const h = hints.get(f);
  if (h) return h;
  if (/courier|consolas|mono/.test(f)) return 'mono';
  if (/times|georgia|cambria|garamond|book antiqua|palatino|serif$/.test(f) && !/sans/.test(f)) return 'serif';
  return 'sans';
}

/** The free font with the same letter widths, used in PDFs and on screen when the font is missing. */
export function standInFont(family: string): string {
  const f = key(family);
  if (f === 'calibri') return 'Carlito';
  if (f === 'cambria') return 'Caladea';
  const c = fontClass(family);
  return c === 'mono' ? 'Cousine' : c === 'serif' ? 'Tinos' : 'Arimo';
}

/**
 * Fonts to try after this one on screen, before the usual Arial ones: its stand-in, and for a
 * serif or monospace font the common font of that kind first (Times New Roman, Courier New).
 */
export function fallbackFonts(family: string): string[] {
  const f = key(family);
  let s = stacks.get(f);
  if (s) return s;
  const c = fontClass(family);
  const stand = standInFont(family);
  const list = stand === 'Carlito' || stand === 'Caladea' ? [stand]
    : c === 'serif' ? ['Times New Roman', 'Tinos']
      : c === 'mono' ? ['Courier New', 'Cousine']
        : [];
  const own = embedded.get(f);
  s = [...(own ? [own] : []), ...list.filter((x) => x.toLowerCase() !== f)];
  stacks.set(f, s);
  return s;
}

/** The stand-in fonts, which the screen loads only when a missing font needs one. */
export const STAND_IN_FONTS = ['Carlito', 'Caladea', 'Arimo', 'Tinos', 'Cousine'];

/**
 * Word's single line spacing for a font, as a multiple of the size: the font's own line height
 * (its ascent, descent and line gap). Calibri's is 1.22 (14.65 pt at 12 pt), Courier New's 1.13;
 * Times New Roman's and Arial's, and any font not listed, 1.15. The heights are those of the
 * stand-ins (Carlito, Cousine, Tinos, Arimo), which match the fonts they stand in for. `family`
 * may be a CSS font stack: its first font counts.
 */
export function lineFactor(family: string): number {
  const first = key(family.split(',')[0] ?? '');
  return LINE_FACTORS[first] ?? 1.15;
}
const LINE_FACTORS: Record<string, number> = { calibri: 2500 / 2048, carlito: 2500 / 2048, 'courier new': 2320 / 2048, cousine: 2320 / 2048, 'liberation mono': 2320 / 2048 };
