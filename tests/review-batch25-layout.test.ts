// Code review batch 25 (text drawing and layout): the shadow of every word of an outlined text
// (F1139), a hyphen-broken word's rest (F1147), Word's effects in right-to-left text (F1148),
// soft hyphens in caret positions (F1149), digits in a hyphenated word (F1146) and a glow in a
// theme color (F1158).
import { describe, it, expect } from 'vitest';
import { withFx } from '../src/text/fx';
import { layoutText, pieceX, caretPos } from '../src/text/layout';
import { wordLook } from '../src/text/word-look';
import type { TextRun } from '../src/model';

// five points a character, soft hyphens and all (as the published-width fonts give U+00AD a width)
const measure = (t: string, size: number) => t.length * size * 0.5;
const SHY = '­';

describe('an outline and a shadow on many words (F1139)', () => {
  it('draws every put piece with the shadow, not only the first', () => {
    const drawn: string[] = [];
    const ctx = {
      shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0, fillStyle: '#000', strokeStyle: '', lineWidth: 1, lineJoin: '', globalAlpha: 1,
      getTransform: () => ({ a: 1, b: 0 }),
      fillText(t: string) { drawn.push(`${t}:${this.shadowColor}`); },
      strokeText() { /* the outline */ },
    };
    const put = withFx(ctx as unknown as CanvasRenderingContext2D, { shadow: true, outline: '#ff0000' }, 10);
    put('one', 0, 0);
    put('two', 20, 0);
    put('three', 40, 0);
    // each fill is drawn with the shadow's color on (the stroke between them turns it off for itself only)
    expect(new Set(drawn.map((d) => d.split(':')[1]))).toEqual(new Set(['rgba(0, 0, 0, 0.4)']));
    expect(drawn).toHaveLength(3);
  });
});

describe('the rest of a broken word (F1147)', () => {
  const piece = 'xxxx';
  const word = Array.from({ length: 8 }, () => piece).join(SHY);
  it('is broken again at the soft hyphens, until each part fits the line', () => {
    const text = `ab ${word}`;
    const lay = layoutText({ runs: [{ text }], justify: 'left', wrap: 50 }, 10, measure);
    expect(lay.lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lay.lines) expect(l.width).toBeLessThanOrEqual(50 + 1e-6);
  });
});

describe('Word\'s character effects in right-to-left text (F1148)', () => {
  // w:outline (hollow letters), ECMA-376 Part 1, 17.3.2.23
  const wrx = JSON.stringify({ rPr: '<w:outline/>' });
  const looks = (paras: { rtl?: boolean }[], text: string) => layoutText({ runs: [{ text, wrx } as TextRun], paras, justify: 'left' }, 10, measure).lines.flatMap((l) => l.pieces).filter((g) => g.text.trim());
  it('keeps them for Latin text in a right-to-left paragraph', () => {
    const got = looks([{ rtl: true }], 'abc');
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((g) => g.look?.hollow)).toBe(true);
  });
  it('keeps them for Hebrew letters, and as before in left-to-right text', () => {
    expect(looks([{}], 'שלום').every((g) => g.look?.hollow)).toBe(true);
    expect(looks([{}], 'abc').every((g) => g.look?.hollow)).toBe(true);
  });
});

describe('soft hyphens in a piece (F1149)', () => {
  it('measure a place after one without its width, as the piece itself does', () => {
    const text = `extra${SHY}ordinary`;
    const lay = layoutText({ runs: [{ text }], justify: 'left' }, 10, measure);
    const g = lay.lines[0].pieces[0];
    // 13 letters at 5 points; the soft hyphen has none
    expect(g.w).toBeCloseTo(65);
    expect(pieceX(lay, g, 5)).toBeCloseTo(25);
    expect(pieceX(lay, g, 7)).toBeCloseTo(30);
    expect(pieceX(lay, g, text.length - 1)).toBeCloseTo(60);
    expect(caretPos(lay, text.length).x).toBeCloseTo(65);
    expect(caretPos(lay, 7).x).toBeCloseTo(30);
  });
});

describe('a word with digits in a document is not hyphenated (F1146)', () => {
  const hyphenate = { points: () => [8], zone: 0, limit: 0, caps: false };
  const shown = (text: string) => layoutText({ runs: [{ text, font: 'Times New Roman', size: 12 }], justify: 'left', boxes: true, wrap: 100, hyphenate }, 12, measure).lines.map((l) => text.slice(l.start, l.end).trim());
  it('does not break triethylamine-d15 inside its letters (only after its own hyphen, as any hyphen)', () => {
    expect(shown('aaaa triethylamine-d15')).toEqual(['aaaa', 'triethylamine-', 'd15']);
  });
  it('still hyphenates a word without digits', () => {
    expect(shown('aaaa triethylamine-d')[0]).toBe('aaaa triethyl');
  });
});

describe('a glow in a theme color (F1158)', () => {
  // w14:schemeClr with a theme color's name, as Word writes its glow presets (ECMA-376 Part 1, 20.1.10.54 for the names)
  const glow = (color: string) => `<w14:glow w14:rad="63500">${color}</w14:glow>`;
  it('is drawn in the theme\'s color', () => {
    const got = wordLook({ wfx: glow('<w14:schemeClr w14:val="accent1"><w14:alpha w14:val="60000"/></w14:schemeClr>') })!.glow!;
    expect(got.color).toBe('#4472c4');
    expect(got.r).toBeCloseTo(5);
    expect(got.alpha).toBeCloseTo(0.4);
  });
  it('still reads a color given in hex, and leaves a name it does not know', () => {
    expect(wordLook({ wfx: glow('<w14:srgbClr w14:val="FF0000"/>') })!.glow!.color).toBe('#ff0000');
    expect(wordLook({ wfx: glow('<w14:schemeClr w14:val="nonsense"/>') })).toBeUndefined();
  });
});
