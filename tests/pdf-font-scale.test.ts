// Text measured with a font the PDF can't have (Georgia, a font missing on this computer) and
// drawn with a stand-in: its letters scaled to the widths the text was laid out with, not spaced
// out letter by letter (office sampler F-V-04: W-CHR-57, W-CHR-58, W-STY-01 to 04).

import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { writePdf } from '../src/io/pdf';
import { TrueType } from '../src/io/pdf-fonts';
import { woffToSfnt } from '../src/io/font-embed';

const arimo = woffToSfnt(new Uint8Array(readFileSync('node_modules/@fontsource/arimo/files/arimo-latin-400-normal.woff')));
const tt = new TrueType(arimo);
/** Arimo's own width of each character, in points at `size`, times `k`. */
const own = (text: string, size: number, k = 1) => [...text].map((ch) => (tt.width(tt.glyph(ch.codePointAt(0)!)) * size * k) / 1000);
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
function page(pdf: Uint8Array): string {
  const s = latin1(pdf);
  for (let i = s.indexOf('stream\n'); i >= 0; i = s.indexOf('stream\n', i + 7)) {
    const end = s.indexOf('\nendstream', i);
    try {
      const t = latin1(unzlibSync(Uint8Array.from(s.slice(i + 7, end), (c) => c.charCodeAt(0))));
      if (t.includes(' Tf ')) return t;
    } catch { /* not packed */ }
    i = end;
  }
  return '';
}
const pdfOf = (items: { text: string; widths: number[]; family?: string }[]) => writePdf([{ w: 300, h: 100, items: items.map((it, n) => ({
  kind: 'text' as const, text: it.text, x: 10, y: 20 + n * 20, size: 12, family: it.family ?? 'Georgia', bold: false, italic: false, color: '#000000', widths: it.widths,
})) }], { image: async () => null, fonts: async () => [arimo] });

describe('a stand-in font in a PDF', () => {
  it('scales the letters to the widths the text was laid out with, not spacing them out', async () => {
    // (laid out 15 % wider than Arimo draws it: Georgia's widths, drawn with a stand-in)
    const c = page(await pdfOf([{ text: 'Heading', widths: own('Heading', 12, 1.15) }]));
    expect(c).toContain('115 Tz');
    // (each letter at its scaled width: no moves between them)
    expect(c).toMatch(/Tm <[0-9A-F]+> Tj/);
  });

  it('leaves text measured with the font itself as it was, kerning and a justified line\'s spaces moved as before', async () => {
    const c = page(await pdfOf([{ text: 'Same', widths: own('Same', 12), family: 'Arial' }]));
    expect(c).not.toContain('Tz');
    // (wide spaces, letters as the font has them: still no scaling)
    const w = own('a b c', 12).map((x, i) => (i % 2 ? x * 3 : x));
    const j = page(await pdfOf([{ text: 'a b c', widths: w, family: 'Arial' }]));
    expect(j).not.toContain('Tz');
    expect(j).toMatch(/TJ/);
  });

  it('puts the scaling back for the next text', async () => {
    const c = page(await pdfOf([{ text: 'Wide', widths: own('Wide', 12, 1.2) }, { text: 'Plain', widths: own('Plain', 12), family: 'Arial' }]));
    expect(c).toContain('120 Tz');
    // (each item in its own q … Q, which puts Tz back: the second starts unscaled, and says nothing of it)
    expect(c.split('Tz').length - 1).toBe(1);
  });
});
