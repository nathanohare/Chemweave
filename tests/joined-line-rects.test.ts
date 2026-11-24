// A paragraph's lines meet when lit up or hovered (the SI Live Preview: moving the pointer from
// one line of a lit paragraph to the next must not find a gap between them and flicker).
import { describe, it, expect } from 'vitest';
import { layoutText, offsetAt, selectionRects, joinedBand, type TextFrame } from '../src/text/layout';
import { arialWidth } from '../src/text-metrics';

const measure = (t: string, s: number, _f: string, style: string) => arialWidth(t, s, /bold/.test(style));
const words = 'The quick brown fox jumps over the lazy dog and keeps on running';
// (double spacing: a clear gap between the ink of one line and the next)
const frame = (text: string): TextFrame => ({ runs: [{ text }], justify: 'left', wrap: 80, lineSpacing: 2 });

describe('joined line rectangles', () => {
  const lay = layoutText(frame(words), 10, measure);
  it('lays the paragraph out on several lines with gaps between their ink', () => {
    expect(lay.lines.length).toBeGreaterThan(2);
    const a = lay.lines[0], b = lay.lines[1];
    expect(b.y - b.ascent).toBeGreaterThan(a.y + a.descent);
  });
  it('leaves the ink boxes as they were without `joined`', () => {
    const rs = selectionRects(lay, 0, words.length);
    expect(rs[0].y2).toBeLessThan(rs[1].y1);
  });
  it('makes the lines of a paragraph meet with `joined`', () => {
    const rs = selectionRects(lay, 0, words.length, true);
    expect(rs.length).toBe(lay.lines.length);
    for (let i = 0; i + 1 < rs.length; i++) expect(rs[i].y2).toBeCloseTo(rs[i + 1].y1, 9);
    // the first line's top and the last line's bottom stay at the ink
    expect(rs[0].y1).toBeCloseTo(lay.lines[0].y - lay.lines[0].ascent, 9);
    const last = lay.lines[lay.lines.length - 1];
    expect(rs[rs.length - 1].y2).toBeCloseTo(last.y + last.descent, 9);
  });
  it('splits each gap where a click changes lines', () => {
    for (let i = 0; i + 1 < lay.lines.length; i++) {
      const y = joinedBand(lay.lines, i).y2;
      const x = lay.lines[i].x + 5;
      // just above the split: the line above; just below: the line below
      const up = offsetAt(lay, x, y - 0.01), down = offsetAt(lay, x, y + 0.01);
      expect(up).toBeGreaterThanOrEqual(lay.lines[i].start);
      expect(up).toBeLessThan(lay.lines[i].end);
      expect(down).toBeGreaterThanOrEqual(lay.lines[i + 1].start);
    }
  });
  it('does not join lines of different paragraphs', () => {
    const two = layoutText(frame('First paragraph here\nSecond one'), 10, measure);
    const i = two.lines.findIndex((l) => l.last);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(joinedBand(two.lines, i).y2).toBeCloseTo(two.lines[i].y + two.lines[i].descent, 9);
    expect(joinedBand(two.lines, i + 1).y1).toBeCloseTo(two.lines[i + 1].y - two.lines[i + 1].ascent, 9);
  });
});
