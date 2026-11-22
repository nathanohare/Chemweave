// Review round 2 follow-ups in Document mode: Show/Hide ¶ (formatting marks), the Cover Page
// gallery of pictures (finding 5) and the ribbon meeting the page with no strip (finding 24).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { drawMarks } from '../src/text/draw';
import { layoutText } from '../src/text/layout';
import { COVER_PAGES } from '../src/document/quick-parts';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const measure = (t: string, size: number) => t.length * size * 0.5;

/** A canvas that only records the marks drawn on it. */
function recorder() {
  const texts: { t: string; x: number; y: number }[] = [];
  const dots: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  const ctx = {
    fillStyle: '', font: '', textAlign: 'left',
    save() {}, restore() {}, beginPath() {}, fill() { dots.push(at); },
    arc(x: number, y: number) { at = { x, y }; },
    fillText(t: string, x: number, y: number) { texts.push({ t, x, y }); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, dots };
}

describe('Show/Hide ¶', () => {
  it('draws a dot for each space, an arrow for each tab and ¶ at each paragraph end', () => {
    const lay = layoutText({ runs: [{ text: 'a b  c\nd\te\n' }], justify: 'left', wrap: 1000, boxes: true }, 10, measure);
    const r = recorder();
    drawMarks(r.ctx, lay, 0, 0);
    expect(r.dots.length).toBe(3);
    expect(r.texts.filter((x) => x.t === '→').length).toBe(1);
    // three paragraphs: two ended by a line break, and the empty last one
    expect(r.texts.filter((x) => x.t === '¶').length).toBe(3);
  });

  it('puts ¶ after the paragraph\'s text (and its trailing spaces), on its baseline', () => {
    const lay = layoutText({ runs: [{ text: 'abc ' }], justify: 'left', wrap: 1000, boxes: true }, 10, measure);
    const r = recorder();
    drawMarks(r.ctx, lay, 0, 0);
    const p = r.texts.find((x) => x.t === '¶')!;
    expect(p.x).toBeGreaterThanOrEqual(4 * 5);
    expect(p.y).toBeCloseTo(lay.lines[0].y, 5);
  });

  it('marks the end of a table cell\'s text with ¤', () => {
    const lay = layoutText({ runs: [{ text: 'cell' }], justify: 'left', wrap: 1000, boxes: true }, 10, measure);
    const r = recorder();
    drawMarks(r.ctx, lay, 0, 0, 0, lay.lines.length, true);
    expect(r.texts.map((x) => x.t)).toContain('¤');
  });

  it('is a pressed-state button on Home, beside Shrink Font', () => {
    expect(html).toMatch(/<button class="rb-sq" data-doc="show-marks" aria-pressed="false"[^>]*>¶<\/button>/);
  });
});

describe('Insert > Cover Page gallery', () => {
  it('lists every cover page design as a picture gallery, with Remove after them', () => {
    const sel = /<div class="rb-fly rb-selgal"[^>]*data-pic="cover" data-gal="grid"[^>]*><select id="doc-cover"[\s\S]*?<\/select>/.exec(html)?.[0] ?? '';
    expect(sel).not.toBe('');
    const values = [...sel.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter((v) => v);
    expect(values).toEqual([...COVER_PAGES.map((d) => d.id), 'remove']);
  });
});

describe('the ribbon meets the page', () => {
  it('has no margin (no strip of the chrome tone) round its panel, only a shadow', () => {
    const rule = /\.ribbon\.tabbed > \.rb-panel:not\(\[hidden\]\), \.doc-ribbon > \.rb-panel:not\(\[hidden\]\) \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/margin: 0;/);
    expect(rule).toMatch(/border-radius: 0;/);
    expect(rule).toMatch(/box-shadow: var\(--rb-shadow\)/);
  });
});
