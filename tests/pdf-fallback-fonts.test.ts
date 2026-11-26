// Characters a PDF's own fonts haven't got (Chinese, Japanese, Hebrew, Arabic, symbols and
// Wingdings) drawn with the Noto Sans fonts that come with the app, not as "?" (office sampler
// F-V-01: W-CHR-81, W-CHR-83 to 85, W-LST-02 to 05).

import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { writePdf, symbolFontText } from '../src/io/pdf';
import { woffToSfnt } from '../src/io/font-embed';
import { FALLBACK_PACKAGES, fallbackFamily, fallbackPicks, parseRanges, type PdfFallbackSource } from '../src/io/pdf-fallback';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const families = FALLBACK_PACKAGES.map((pkg) => fallbackFamily(pkg, JSON.parse(readFileSync(`node_modules/@fontsource/${pkg}/unicode.json`, 'utf8'))));
const woff = (path: string) => woffToSfnt(new Uint8Array(readFileSync(path)));
/** As the app's pdfFallbackFonts, from the files in node_modules; the files read, in order, in `read`. */
const read: string[] = [];
const fallback: PdfFallbackSource = async (ch, text) => fallbackPicks(families, [ch], text).map(({ pkg, subset }) => ({
  key: `${pkg}/${subset}`,
  load: async () => { read.push(`${pkg}/${subset}`); return woff(`node_modules/@fontsource/${pkg}/files/${pkg}-${subset}-400-normal.woff`); },
}));
const arimo = async () => [woff('node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff')];

/** Every stream's text, unpacked where it is packed. */
function streams(pdf: Uint8Array): string[] {
  const s = latin1(pdf);
  const out: string[] = [];
  for (let i = s.indexOf('stream\n'); i >= 0; i = s.indexOf('stream\n', i + 7)) {
    const end = s.indexOf('\nendstream', i);
    const raw = Uint8Array.from(s.slice(i + 7, end), (c) => c.charCodeAt(0));
    try { out.push(latin1(unzlibSync(raw))); } catch { out.push(latin1(raw)); }
    i = end;
  }
  return out;
}
const hex = (ch: string) => ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

describe('fallback fonts in PDFs', () => {
  it('reads a font\'s Unicode ranges and picks the file that holds each character, each file once', () => {
    expect(parseRanges('U+0590-05FF, U+20AA,u+fb1d-fb4f')).toEqual([[0x590, 0x5ff], [0x20aa, 0x20aa], [0xfb1d, 0xfb4f]]);
    const picks = fallbackPicks(families, ['ש', 'ל', 'ك', '✓', '化', '学'], 'שלום كيمياء ✓ 化学');
    // (each script's own file of each font, in the fonts' order; every font whose range takes a character in)
    expect(picks.slice(0, 3)).toEqual([{ pkg: 'noto-sans-hebrew', subset: 'hebrew' }, { pkg: 'noto-sans-arabic', subset: 'arabic' }, { pkg: 'noto-sans-symbols-2', subset: 'symbols' }]);
    const pkgs = picks.map((p) => p.pkg);
    expect(pkgs.indexOf('noto-sans-sc')).toBeLessThan(pkgs.indexOf('noto-sans-jp'));
    expect(new Set(picks.map((p) => `${p.pkg}/${p.subset}`)).size).toBe(picks.length);
    expect(picks.some((p) => /latin/.test(p.subset))).toBe(false);
    // Japanese text (with kana) takes its kanji from the Japanese font
    expect(fallbackPicks(families, ['化'], '化学 かがく')[0].pkg).toBe('noto-sans-jp');
    expect(fallbackPicks(families, ['化'], '化学')[0].pkg).toBe('noto-sans-sc');
  });

  it('turns Wingdings\' characters into the Unicode ones they show, one for one', () => {
    // Word keeps Wingdings characters at U+F020 to U+F0FF: J is the smiling face, ü the check mark
    expect(symbolFontText('   ', 'Wingdings')).toBe('☺ ✓ ▪ ①');
    expect(symbolFontText('J', 'wingdings')).toBe('☺');
    expect(symbolFontText('\uf020', 'Wingdings')).toBe(' ');
    expect(symbolFontText('J ', 'Arial')).toBe('J ');
    expect([...symbolFontText('', 'Wingdings')]).toEqual(['♈', '♓']);
  });

  it('draws Chinese, Japanese, Hebrew, Arabic, symbols and Wingdings with the fallback fonts, not as "?"', async () => {
    const line = (text: string, family = 'Arial') => ({ kind: 'text' as const, text, x: 10, y: 50, size: 12, family, bold: false, italic: false, color: '#000000', widths: Array([...text].length).fill(10) });
    const pdf = await writePdf([{ w: 400, h: 200, items: [
      line('Yield: 化学 化學 かがく'), line('כימיה كيمياء'), line('○ ■ ✓ ➢ ◆'), line('', 'Wingdings'),
    ] }], { image: async () => null, fonts: arimo, fallback });
    const all = streams(pdf);
    const page = all.find((t) => t.includes(' Tf '))!;
    // nothing written in a standard font's "?"
    expect(page).not.toMatch(/\(\?+\)/);
    const maps = all.filter((t) => t.includes('beginbfchar')).join('\n');
    for (const ch of ['化', '學', 'か', 'כ', 'ك', '○', '■', '✓', '➢', '◆', '☺', '♈', '①']) expect(maps, ch).toContain(`<${hex(ch)}>`);
    // only the files that were used go in, each once
    const s = latin1(pdf);
    const embedded = (s.match(/\/FontFile2/g) ?? []).length;
    expect(embedded).toBeGreaterThanOrEqual(5);
    expect(embedded).toBeLessThan(12);
  });

  it('leaves a PDF with nothing its fonts lack as it was (no fallback font read)', async () => {
    let asked = 0;
    const pdf = await writePdf([{ w: 200, h: 100, items: [{ kind: 'text', text: 'Yield 80% • β', x: 10, y: 50, size: 12, family: 'Arial', bold: false, italic: false, color: '#000000', widths: Array(13).fill(6) }] }],
      { image: async () => null, fonts: arimo, fallback: async (c, t) => { asked++; return fallback(c, t); } });
    expect(asked).toBe(0);
    expect(latin1(pdf)).not.toContain('Noto');
  });

  const line = (text: string, family = 'Arial') => ({ kind: 'text' as const, text, x: 10, y: 50, size: 12, family, bold: false, italic: false, color: '#000000', widths: Array([...text].length).fill(10) });

  it('draws with a fallback font only the characters it was read for: Symbol text stays Symbol (review)', async () => {
    // (in the Symbol font, a b c are α β χ: the standard Symbol font draws them, and only the check mark falls back)
    const pdf = await writePdf([{ w: 400, h: 200, items: [line('abc ✓ 123', 'Symbol')] }], { image: async () => null, fonts: async () => [], fallback });
    const page = streams(pdf).find((t) => t.includes(' Tf '))!;
    expect(page).toMatch(/\(abc \) Tj/);
    const maps = streams(pdf).filter((t) => t.includes('beginbfchar')).join('\n');
    expect(maps).toContain('<2713>');
    expect(maps).not.toContain('<0061>');
  });

  it('reads the Japanese files only for Japanese text, and nothing for what draws nothing (review)', async () => {
    read.length = 0;
    await writePdf([{ w: 400, h: 200, items: [line('化学 ✓\ufe0f')] }], { image: async () => null, fonts: arimo, fallback });
    expect(read.some((x) => x.startsWith('noto-sans-jp'))).toBe(false);
    expect(read.some((x) => x.startsWith('noto-sans-sc'))).toBe(true);
    // (the check mark found in Symbols 2, so no file after it is read for it)
    expect(read.filter((x) => x.startsWith('noto-sans-symbols/'))).toEqual([]);
  });

  it('asks for a character\'s fallback once in a PDF, and draws nothing for zero-width marks', async () => {
    let asked = 0;
    const counted: PdfFallbackSource = async (c, t) => { asked++; return fallback(c, t); };
    const pdf = await writePdf([{ w: 400, h: 200, items: [line('化学'), line('化学'), line('a\u200db\u200fc')] }], { image: async () => null, fonts: arimo, fallback: counted });
    expect(asked).toBe(2);
    expect(streams(pdf).find((t) => t.includes(' Tf '))).not.toContain('?');
  });

  it('writes the PDF anyway when a fallback font can\'t be had', async () => {
    const pdf = await writePdf([{ w: 400, h: 200, items: [line('化学')] }], { image: async () => null, fonts: arimo, fallback: async () => { throw new Error('offline'); } });
    expect(streams(pdf).find((t) => t.includes(' Tf '))).toContain('(??)');
  });
});
