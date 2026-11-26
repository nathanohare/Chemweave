import { describe, expect, it } from 'vitest';
import { gridPath } from '../src/ui/page-grid-view';
import type { PageSetup } from '../src/model';

/** The lines a path draws, as "x=…" (up and down) or "y=…" (across). */
function lines(box: { x1: number; y1: number; x2: number; y2: number }, skip?: { x1: number; y1: number; x2: number; y2: number }): string[] {
  const out: string[] = [];
  let from: { x: number; y: number } | null = null;
  const ctx = {
    beginPath() { /* nothing */ },
    moveTo(x: number, y: number) { from = { x, y }; },
    lineTo(x: number, y: number) { out.push(from!.x === x ? `x=${x}` : `y=${y}`); },
  };
  gridPath(ctx, { w: 100, h: 200 } as PageSetup, box, skip);
  return out;
}

describe('page grid lines', () => {
  it('draws every page boundary in the box', () => {
    expect(lines({ x1: 0, y1: 0, x2: 200, y2: 200 })).toEqual(['x=0', 'x=100', 'x=200', 'y=0', 'y=200']);
  });
  it('leaves out the lines on the top and left fixed edges, where the view stops', () => {
    expect(lines({ x1: 0, y1: 0, x2: 200, y2: 200 }, { x1: 0, y1: 0, x2: Infinity, y2: Infinity })).toEqual(['x=100', 'x=200', 'y=200']);
  });
  it('keeps the lines where the grid can still grow (no fixed edge)', () => {
    expect(lines({ x1: 0, y1: 0, x2: 200, y2: 200 }, { x1: -Infinity, y1: -Infinity, x2: Infinity, y2: Infinity })).toEqual(['x=0', 'x=100', 'x=200', 'y=0', 'y=200']);
  });
});
