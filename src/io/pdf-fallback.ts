// Fonts a PDF falls back on for characters that a text's own fonts haven't got: Chinese and
// Japanese, Hebrew, Arabic and symbols (bullets, check marks, circled numbers), from the free
// Noto Sans fonts that come with the app (SIL Open Font License, packaged by Fontsource). Each
// comes cut into files by Unicode range (Chinese and Japanese in about a hundred), so a PDF
// takes only the files that hold the characters it needs. (Hebrew and Arabic come out letter by
// letter, left to right: their order and Arabic's joined letters are F-V-02's.)

/** A font file to fall back on, by a key that names it, read when it is needed. */
export interface FallbackFile {
  key: string;
  load(): Promise<Uint8Array>;
}

/** The fallback files for characters (`chars`) that a text (`text`, the whole run) can't draw with its own fonts. */
export type PdfFallbackSource = (chars: string[], text: string) => FallbackFile[];

/** One fallback font: its Fontsource package and the files it is cut into, each with the characters it holds. */
export interface FallbackFamily {
  pkg: string;
  subsets: { name: string; ranges: [number, number][] }[];
}

/** The fallback fonts, in the order they are tried (Chinese before Japanese, unless the text has kana: see fallbackPicks). */
export const FALLBACK_PACKAGES = ['noto-sans-hebrew', 'noto-sans-arabic', 'noto-sans-symbols-2', 'noto-sans-symbols', 'noto-sans-sc', 'noto-sans-jp'];

/** A CSS unicode-range ("U+0590-05FF,U+200C-2010,U+20AA") as [first, last] pairs. */
export function parseRanges(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of s.split(',')) {
    const m = /^\s*U\+([0-9a-f]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (m) out.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
  }
  return out;
}

/**
 * The files of each fallback font that are its own script's (the others, its Latin and the like, are
 * only there to go with it): all of Chinese's and Japanese's numbered files.
 */
const OWN_SUBSETS: Record<string, RegExp> = {
  'noto-sans-hebrew': /^hebrew$/,
  'noto-sans-arabic': /^arabic$/,
  'noto-sans-symbols-2': /^(symbols|math)$/,
  'noto-sans-symbols': /^symbols$/,
  'noto-sans-sc': /^\d+$/,
  'noto-sans-jp': /^\d+$/,
};

/**
 * Fontsource's unicode.json for a package (subset → range) as a fallback font, its own script's
 * files only; the numbered subsets ("[12]") lose their brackets, as in the file names.
 */
export function fallbackFamily(pkg: string, unicode: Record<string, string>): FallbackFamily {
  const own = OWN_SUBSETS[pkg] ?? /./;
  return { pkg, subsets: Object.entries(unicode).map(([k, v]) => ({ name: k.replace(/^\[(\d+)\]$/, '$1'), ranges: parseRanges(v) })).filter((x) => own.test(x.name)) };
}

/**
 * The files to fall back on for these characters, each once: for each character every file whose
 * range takes it in, in `families`' order (a range is the script's, not the font's own: a file
 * may still lack the character, and the first one read that has it draws it). Japanese text (any
 * kana in `text`) tries the Japanese font before the Chinese one, so its kanji take Japanese shapes.
 */
export function fallbackPicks(families: FallbackFamily[], chars: string[], text: string): { pkg: string; subset: string }[] {
  const kana = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/.test(text);
  const order = kana ? [...families].sort((a, b) => (a.pkg === 'noto-sans-jp' ? -1 : b.pkg === 'noto-sans-jp' ? 1 : 0)) : families;
  const out: { pkg: string; subset: string }[] = [];
  const seen = new Set<string>();
  for (const ch of chars) {
    const c = ch.codePointAt(0)!;
    for (const f of order) {
      const s = f.subsets.find((x) => x.ranges.some(([a, b]) => c >= a && c <= b));
      if (!s) continue;
      const key = `${f.pkg}/${s.name}`;
      if (!seen.has(key)) { seen.add(key); out.push({ pkg: f.pkg, subset: s.name }); }
    }
  }
  // (in the fonts' order, so a font is tried before the ones after it whichever character asked for it)
  const rank = (pkg: string) => order.findIndex((f) => f.pkg === pkg);
  return out.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.pkg) - rank(b.p.pkg) || a.i - b.i).map((x) => x.p);
}
