// @vitest-environment jsdom
//
// Code review of 2026-11-26, batch 21 (pictures): Remove Background on a picture with a
// see-through background keeps its black ink (F204); an SVG's size is read from its width and
// height in their units (F887); dots and hatching on a big shape spread out instead of vanishing
// (F884); the picture of an embedded workbook draws merged cells as one (F891) and cuts text off
// at the first filled cell (F892); and PowerPoint's Glow Variations are 60% see-through (F913).

import { describe, it, expect } from 'vitest';
import { strFromU8 } from 'fflate';
import { removeBackground } from '../src/render/picture-fx';
import { imageSize, fromDataUrl } from '../src/render/images';
import { dotCentres, hatchLines } from '../src/render/fills';
import { cellsPicture } from '../src/render/object-picture';
import { GLOW_TRANSPARENCY } from '../src/render/shape-fx';
import { Workbook } from '../src/sheet/workbook';

describe('Remove Background on a see-through picture (F204)', () => {
  it('takes away only the see-through surround, not the black ink it touches', () => {
    // 12 × 12, see-through (stored as 0, 0, 0, 0, as PNGs usually are) with a black 6 × 6 square in the middle
    const w = 12, h = 12, d = new Uint8ClampedArray(w * h * 4);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) d[(y * w + x) * 4 + 3] = 255;
    removeBackground(d, w, h, {});
    // the middle of the ink is untouched, and its edge only softened
    expect(d[(5 * w + 5) * 4 + 3]).toBe(255);
    expect(d[(3 * w + 3) * 4 + 3]).toBeGreaterThan(0);
  });

  it('still takes away an opaque background the ink sits on', () => {
    const w = 12, h = 12, d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; }
    removeBackground(d, w, h, {});
    expect(d[3]).toBe(0);
    expect(d[(5 * w + 5) * 4 + 3]).toBe(255);
  });
});

describe('the size of an SVG picture (F887)', () => {
  const svg = (attrs: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="1" height="1"/></svg>`);
  // CSS Values and Units: 96 px to the inch, 25.4 mm to the inch, 72 pt to the inch
  it('reads the width and height in their units', () => {
    const a4 = imageSize(svg('width="210mm" height="297mm" viewBox="0 0 210 297"'), 'image/svg+xml')!;
    expect(a4.w).toBeCloseTo(210 * 96 / 25.4, 6);
    expect(a4.h).toBeCloseTo(297 * 96 / 25.4, 6);
    const pt = imageSize(svg('width="100pt" height="50pt" viewBox="0 0 1000 500"'), 'image/svg+xml')!;
    expect(pt.w).toBeCloseTo(100 * 96 / 72, 6);
  });

  it('takes the shape from the viewBox where only one side is given, and the size where none (or a percentage) is', () => {
    const one = imageSize(svg('width="200" viewBox="0 0 1000 500"'), 'image/svg+xml')!;
    expect([one.w, one.h]).toEqual([200, 100]);
    expect(imageSize(svg('width="100%" height="100%" viewBox="0 0 30 20"'), 'image/svg+xml')).toEqual({ w: 30, h: 20 });
    expect(imageSize(svg('width="40" height="25"'), 'image/svg+xml')).toEqual({ w: 40, h: 25 });
  });
});

describe('patterns on big shapes (F884)', () => {
  const square = (s: number) => [[{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }]];
  it('spreads the dots out on a very big shape rather than drawing none', () => {
    const dots = dotCentres(square(700), 1.5);
    expect(dots.length).toBeGreaterThan(100_000);
    expect(dots.length).toBeLessThanOrEqual(201_000);
  });

  it('spreads very close lines out rather than drawing none', () => {
    const lines = hatchLines(square(500), 45, 0.1);
    expect(lines.length).toBeGreaterThan(1000);
    expect(lines.length).toBeLessThanOrEqual(4001);
  });
});

describe('the picture of an embedded workbook (F891, F892)', () => {
  const svgOf = (wb: Workbook) => strFromU8(fromDataUrl(cellsPicture(wb)!.src).bytes);

  it('draws a merged block as one cell, its fill and text across it and no gridlines inside', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 0, 'Title');
      s.setInput(1, 4, 'e');
      s.merge({ r1: 0, c1: 0, r2: 0, c2: 4 });
      s.patchStyle({ r1: 0, c1: 0, r2: 0, c2: 0 }, { fill: '#ffeeaa', align: 'center' });
    });
    const svg = svgOf(wb);
    // five columns of 64 px
    expect(svg).toContain('<rect x="0" y="0" width="320" height="20" fill="#ffeeaa"/>');
    expect(svg).toMatch(/<text x="160" [^>]*text-anchor="middle"[^>]*>Title</);
    // no line down between A1 and B1
    expect(svg).not.toContain('M64.5 0V20');
    expect(svg).toContain('M64.5 20V40');
  });

  it('runs text over empty cells only up to the first filled one', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.edit('fill', () => {
      s.setInput(0, 0, 'A long label that runs on');
      s.setInput(0, 2, 'x');
    });
    const svg = svgOf(wb);
    // cut at C1's left edge: across A1 and B1
    expect(svg).toContain('<clipPath id="k0_0"><rect x="0" y="0" width="128" height="20"/></clipPath>');
    expect(svg).toMatch(/clip-path="url\(#k0_0\)">A long label/);
  });
});

describe('Glow Variations (F913)', () => {
  // PowerPoint writes its Glow Variations with <a:alpha val="40000"/> on the glow's colour (40% opaque,
  // shown as 60% Transparency in its Format Shape pane); a:alpha is ECMA-376 Part 1, 20.1.2.3.1
  it('are 60% see-through, as PowerPoint writes them', () => {
    expect(GLOW_TRANSPARENCY).toBe(0.6);
  });
});
