// Split screen: where a tab dragged down into the window lands, what the split becomes, and how
// far the divider goes (src/ui/split-screen.ts).

import { describe, it, expect } from 'vitest';
import { bothLive, clampShare, dropSide, fitPicture, insertLabel, MIN_SHARE, shareAt, splitAfterDrop, besideIn } from '../src/ui/split-screen';

const work = { left: 100, top: 80, right: 1100, bottom: 780 };

describe('drop zones', () => {
  it('puts the tab on the half of the working area the pointer is over', () => {
    expect(dropSide(300, 400, work)).toBe('left');
    expect(dropSide(900, 400, work)).toBe('right');
    // at the current split's divider, not the middle
    expect(dropSide(400, 400, work, 0.25)).toBe('right');
    expect(dropSide(320, 400, work, 0.25)).toBe('left');
  });

  it('shows no ghost outside the working area (the tab row, the ribbon, the side panel)', () => {
    expect(dropSide(500, 40, work)).toBeNull();
    expect(dropSide(50, 400, work)).toBeNull();
    expect(dropSide(1200, 400, work)).toBeNull();
    expect(dropSide(500, 800, work)).toBeNull();
    expect(dropSide(Number.NaN, 400, work)).toBeNull();
  });
});

describe('the split a drop makes', () => {
  it('puts the dragged tab on its side and the tab showing on the other', () => {
    expect(splitAfterDrop('B', 'right', 'A', null)).toEqual({ left: 'A', right: 'B' });
    expect(splitAfterDrop('B', 'left', 'A', null)).toEqual({ left: 'B', right: 'A' });
  });

  it('never puts a tab beside itself', () => {
    expect(splitAfterDrop('A', 'right', 'A', null)).toBeNull();
  });

  it('lets a third tab take the place of the tab on the side it is dropped on', () => {
    const sp = { left: 'A', right: 'B' };
    expect(splitAfterDrop('C', 'left', 'A', sp)).toEqual({ left: 'C', right: 'B' });
    expect(splitAfterDrop('C', 'right', 'A', sp)).toEqual({ left: 'A', right: 'C' });
  });

  it('swaps the two when a tab of the split is dropped on the other side, and does nothing on its own side', () => {
    const sp = { left: 'A', right: 'B' };
    expect(splitAfterDrop('B', 'left', 'A', sp)).toEqual({ left: 'B', right: 'A' });
    expect(splitAfterDrop('A', 'right', 'A', sp)).toEqual({ left: 'B', right: 'A' });
    expect(splitAfterDrop('B', 'right', 'A', sp)).toBeNull();
    expect(splitAfterDrop('A', 'left', 'A', sp)).toBeNull();
  });

  it('starts a new split when the tab showing is not in the old one', () => {
    expect(splitAfterDrop('C', 'left', 'D', { left: 'A', right: 'B' })).toEqual({ left: 'C', right: 'D' });
  });

  it('finds the tab beside another', () => {
    const sp = { left: 'A', right: 'B' };
    expect(besideIn(sp, 'A')).toBe('B');
    expect(besideIn(sp, 'B')).toBe('A');
    expect(besideIn(sp, 'C')).toBeNull();
    expect(besideIn(null, 'A')).toBeNull();
  });
});

describe('the divider', () => {
  it('keeps each side at least a fifth of the width', () => {
    expect(MIN_SHARE).toBe(0.2);
    expect(clampShare(0.05)).toBe(0.2);
    expect(clampShare(0.95)).toBe(0.8);
    expect(clampShare(0.5)).toBe(0.5);
    expect(clampShare(Number.NaN)).toBe(0.5);
  });

  it('gives the right side the width right of the pointer', () => {
    expect(shareAt(600, work)).toBeCloseTo(0.5);
    expect(shareAt(800, work)).toBeCloseTo(0.3);
    expect(shareAt(100, work)).toBe(0.8);
    expect(shareAt(1100, work)).toBe(0.2);
    expect(shareAt(500, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(0.5);
  });
});

describe('pairs', () => {
  it('keeps a canvas beside a document or spreadsheet live on both sides, nothing else', () => {
    expect(bothLive('drawing', 'document')).toBe(true);
    expect(bothLive('sheet', 'drawing')).toBe(true);
    expect(bothLive('drawing', 'drawing')).toBe(false);
    expect(bothLive('drawing', 'slides')).toBe(false);
    expect(bothLive('document', 'sheet')).toBe(false);
  });

  it('names Insert for what the canvas puts its structures into', () => {
    expect(insertLabel('document')).toBe('Insert into Document');
    expect(insertLabel('sheet')).toBe('Insert into Cell');
    expect(insertLabel('slides')).toBe('Insert into Slide');
    expect(insertLabel('design')).toBe('Insert into Design');
    expect(insertLabel('si')).toBeNull();
    expect(insertLabel('drawing')).toBeNull();
  });

  it('fits a picture of the other side at most at actual size, centered across and from the top', () => {
    expect(fitPicture(400, 300, 800, 600)).toEqual({ x: 200, y: 0, w: 400, h: 300 });
    expect(fitPicture(800, 600, 400, 600)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(fitPicture(0, 300, 400, 600)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
