// @vitest-environment jsdom
//
// The pictures on the New Document and New Spreadsheet cards are drawn from the templates
// themselves (review round 2, findings 1 and 22).

import { describe, it, expect } from 'vitest';
import { DOC_TEMPLATES } from '../src/document/templates';
import { SHEET_TEMPLATES } from '../src/sheet/templates';
import { docPage, usedWidth } from '../src/ui/template-thumbs';

describe('template pictures', () => {
  it("a document's picture is its first page, sized by the card in the page's shape", () => {
    const box = docPage(DOC_TEMPLATES[0].make());
    const svg = box.querySelector('svg')!;
    expect(svg).toBeTruthy();
    // (no fixed size: the card shrinks the whole page, text and all)
    expect(svg.getAttribute('width')).toBeNull();
    const [, , w, h] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(h / w).toBeCloseTo(11 / 8.5, 1);
    expect(box.style.aspectRatio).toBeTruthy();
    expect(svg.innerHTML).toContain('<text');
  });

  it("a sheet's picture reaches its last column in use and its charts", () => {
    const kin = SHEET_TEMPLATES.find((t) => t.id === 'kinetics')!.make();
    const w = (c: number) => kin.sheets[0].colWidths.get(c) ?? 64;
    const chart = kin.sheets[0].charts[0];
    let left = 0;
    for (let c = 0; c < chart.at.col; c++) left += w(c);
    expect(usedWidth(kin, w)).toBe(left + chart.w);
    const rota = SHEET_TEMPLATES.find((t) => t.id === 'rota')!.make();
    expect(usedWidth(rota, () => 100)).toBe(800);
  });
});
