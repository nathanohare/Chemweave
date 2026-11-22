// Document ribbon fixes from Nate's review round 2: the Margins pictures show even margins
// (finding 6), the Borders button is a real split button (finding 2), and the Styles group's
// corner button opens the Styles pane, not the Style box (finding 4).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { marginGuide } from '../src/ui/select-gallery';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** The dotted guide's box in a margins picture. */
function guide(tb: number, lr: number): { x: number; y: number; w: number; h: number } {
  const m = /<rect class="gal-guide" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(marginGuide(tb, lr))!;
  const [x, y, w, h] = m.slice(1).map(Number);
  return { x, y, w, h };
}

describe('Layout > Margins pictures', () => {
  for (const [name, tb, lr] of [['Normal', 1, 1], ['Narrow', 0.5, 0.5], ['Moderate', 1, 0.75], ['Wide', 1, 2]] as const) {
    it(`${name}: the text area is as far in from the right and bottom as from the left and top`, () => {
      const g = guide(tb, lr);
      expect(36 - (g.x + g.w)).toBeCloseTo(g.x, 0);
      expect(46 - (g.y + g.h)).toBeCloseTo(g.y, 0);
      expect(g.x).toBeGreaterThan(1.5);
      expect(g.y).toBeGreaterThan(1.5);
    });
  }
  it('Narrow has the same margin on all four sides, and a smaller one than Normal', () => {
    const n = guide(0.5, 0.5), N = guide(1, 1);
    expect(n.x).toBeCloseTo(n.y, 1);
    expect(n.x).toBeLessThan(N.x);
  });
  it('Moderate has narrower sides than top and bottom; Wide has wider sides', () => {
    const m = guide(1, 0.75), w = guide(1, 2);
    expect(m.x).toBeLessThan(m.y);
    expect(w.x).toBeGreaterThan(w.y);
  });
});

describe('Home > Paragraph > Borders', () => {
  it('is a split button: a main half that applies the last border and an arrow for the menu', () => {
    const split = /<span class="rb-split">\s*<button[^>]*data-doc="para-border-last"[^>]*>[^<]*<\/button>\s*<button[^>]*class="rb-sq rb-drop"[^>]*data-doc="para-borders"/.exec(html);
    expect(split).not.toBeNull();
  });
});

describe('Home > Styles corner button', () => {
  it('opens the Styles pane, not the Style box', () => {
    const styles = html.slice(html.indexOf('data-doc="style-normal"'), html.indexOf('data-doc="find"'));
    expect(styles).toContain('class="rb-launch" data-doc="styles-launcher"');
    expect(styles).not.toContain('data-doc="box-style"');
  });
});
