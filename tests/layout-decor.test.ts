// Every slide template on every built-in layout, with and without the title slide's colors
// (Edit Layouts > "Title slide colors and background"): the template's shapes stay where the
// layout's placeholders are, and the title can be read against whatever is behind it.
// Review round 2, finding 19: Steel Band's Title and Content with title slide colors drew the
// title slide's band across the middle of the slide and left the white title on white.

import { describe, it, expect } from 'vitest';
import { WIDE, STANDARD, LAYOUTS, defaultMaster, decorShapes, layoutDef, slideColours, builtinLayout, type Master, type LayoutId, type DecorShape } from '../src/deck/deck';
import { SLIDE_TEMPLATES, applyTemplate } from '../src/deck/templates';
import { contrastRatio } from '../src/accessibility';

/** The deck's master with this template, and every built-in layout given (or not) the title slide's colors. */
function masterWith(t: (typeof SLIDE_TEMPLATES)[number], titleLook: boolean): Master {
  const m = applyTemplate(defaultMaster(), t);
  return { ...m, layouts: LAYOUTS.map((l) => ({ ...builtinLayout(l.id), titleLook: l.id === 'title' ? true : titleLook })) };
}

/** The color drawn at (x, y) in points: the topmost filled shape there, else the slide's background. */
function colorAt(shapes: DecorShape[], x: number, y: number, background: string): string {
  let c = background;
  for (const s of shapes) if (s.kind === 'rect' && x >= s.x1 && x <= s.x2 && y >= s.y1 && y <= s.y2) c = s.color;
  return c;
}

const cases = SLIDE_TEMPLATES.flatMap((t) => [false, true].flatMap((look) => LAYOUTS.map((l) => ({ t, look, layout: l.id as LayoutId }))));

describe('slide templates on every layout', () => {
  it('draws the same shapes on a layout with text boxes or a title at the top whether or not it has the title slide colors', () => {
    for (const t of SLIDE_TEMPLATES) {
      for (const layout of ['title-content', 'two-content', 'title-only'] as const) {
        expect(decorShapes(WIDE, masterWith(t, true), layout), `${t.name}, ${layout}`).toEqual(decorShapes(WIDE, masterWith(t, false), layout));
      }
    }
  });

  it('keeps every band and rule clear of the text boxes (except strips, frames and corner shapes at the edges)', () => {
    for (const { t, look, layout } of cases) {
      for (const size of [WIDE, STANDARD]) {
        const m = masterWith(t, look);
        const bodies = layoutDef(m, layout).boxes.filter((b) => b.ph === 'body');
        for (const s of decorShapes(size, m, layout)) {
          if (s.kind !== 'rect' && s.kind !== 'line') continue;
          // strips down a side, a frame round the slide, bands along the very bottom: at the edges, not across the text
          const fullHeight = s.y1 <= 0.001 && s.y2 >= size.h - 0.001;
          if (fullHeight || s.y1 >= 0.9 * size.h) continue;
          for (const b of bodies) {
            const bx1 = b.x * size.w, by1 = b.y * size.h, bx2 = (b.x + b.w) * size.w, by2 = (b.y + b.h) * size.h;
            const yIn = Math.min(s.y1, s.y2) < by2 - 0.02 * size.h && Math.max(s.y1, s.y2) > by1 + 0.02 * size.h;
            const xIn = Math.min(s.x1, s.x2) < bx2 && Math.max(s.x1, s.x2) > bx1;
            expect(yIn && xIn, `${t.name}, ${layout}${look ? ' with title slide colors' : ''}: a ${s.kind} crosses a text box`).toBe(false);
          }
        }
      }
    }
  });

  it('puts the band behind the title on any layout with a title', () => {
    for (const t of SLIDE_TEMPLATES.filter((x) => x.decor === 'title-band')) {
      for (const look of [false, true]) {
        for (const layout of ['title', 'title-content', 'two-content', 'title-only'] as const) {
          const m = masterWith(t, look);
          const tb = layoutDef(m, layout).boxes.find((b) => b.ph === 'title')!;
          const [band] = decorShapes(WIDE, m, layout) as Extract<DecorShape, { kind: 'rect' }>[];
          expect(band.y1, `${t.name}, ${layout}`).toBeLessThanOrEqual(tb.y * WIDE.h);
          expect(band.y2, `${t.name}, ${layout}`).toBeGreaterThanOrEqual((tb.y + tb.h) * WIDE.h);
        }
      }
    }
  });

  it('gives every title readable contrast with what is behind it', () => {
    const bad: string[] = [];
    for (const { t, look, layout } of cases) {
      const m = masterWith(t, look);
      const tb = layoutDef(m, layout).boxes.find((b) => b.ph === 'title');
      if (!tb) continue;
      const c = slideColours(m, layout);
      const shapes = decorShapes(WIDE, m, layout);
      // the middle of the title's first line, and the middle of the box
      for (const fy of [0.3, 0.5]) {
        const behind = colorAt(shapes, (tb.x + tb.w / 2) * WIDE.w, (tb.y + fy * tb.h) * WIDE.h, c.background);
        // 3:1 is WCAG's floor for large text, which titles are
        if (contrastRatio(c.titleColor, behind) < 3) bad.push(`${t.name}, ${layout}${look ? ' with title slide colors' : ''}: ${c.titleColor} on ${behind}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('follows the title when it is moved in Edit Layouts', () => {
    const m0 = applyTemplate(defaultMaster(), SLIDE_TEMPLATES.find((t) => t.id === 'steel-band')!);
    const moved = builtinLayout('title');
    moved.boxes[0] = { ...moved.boxes[0], y: 0.2 };
    const [band] = decorShapes(WIDE, { ...m0, layouts: [moved] }, 'title') as Extract<DecorShape, { kind: 'rect' }>[];
    expect(band.y1).toBeLessThanOrEqual(0.2 * WIDE.h);
    expect(band.y2).toBeGreaterThanOrEqual((0.2 + moved.boxes[0].h) * WIDE.h);
  });

  it('keeps the title slide shapes where they were for the built-in Title Slide', () => {
    const m = { ...defaultMaster(), decor: 'title-rule' as const };
    const [rule] = decorShapes(WIDE, m, 'title') as Extract<DecorShape, { kind: 'line' }>[];
    expect(rule.x1).toBeCloseTo(0.3 * WIDE.w);
    expect(rule.x2).toBeCloseTo(0.7 * WIDE.w);
    expect(rule.y1).toBeCloseTo(0.5 * WIDE.h);
    const [band] = decorShapes(WIDE, { ...m, decor: 'title-band' }, 'title') as Extract<DecorShape, { kind: 'rect' }>[];
    expect(band.y1).toBeCloseTo(0.345 * WIDE.h);
    expect(band.y2).toBeCloseTo(0.49 * WIDE.h);
  });
});
