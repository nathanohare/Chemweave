// Synchronous Scrolling in the SI Live Preview: which page of the list the preview has been
// scrolled to (source-map.ts readingLine, pageToFollow). The blocks are made up here, as the
// compile makes them: a page's stretch of the compiled SI, a compound's inside its section's.
import { describe, it, expect } from 'vitest';
import { pageToFollow, readingLine, type SourceBlock } from '../src/si/source-map';

const blocks: SourceBlock[] = [
  { start: 0, end: 100, node: 'project' },
  { start: 100, end: 600, node: 'section:A' },
  { start: 110, end: 130, node: 'scheme:S' },
  { start: 130, end: 300, node: 'compound:X' },
  { start: 300, end: 450, node: 'compound:Y' },
  { start: 450, end: 600, node: 'compound:Z' },
];

describe('the page to follow', () => {
  it('stays on the page chosen while it is at the reading line', () => {
    expect(pageToFollow(blocks, 200, [150, 250], 'compound:X', null)).toBeNull();
  });
  it('follows a page clearly scrolled to', () => {
    expect(pageToFollow(blocks, 380, [320, 420], 'compound:X', 'compound:X')).toBe('compound:Y');
  });
  it('keeps the page it started on while that page is still at an edge of the band (no flicking at a border)', () => {
    expect(pageToFollow(blocks, 310, [280, 340], 'compound:X', 'compound:X')).toBeNull();
    expect(pageToFollow(blocks, 290, [260, 320], 'compound:Y', 'compound:Y')).toBeNull();
  });
  it('does not leave a short page chosen for the page below it after a little scroll', () => {
    // a scheme page chosen, put at the top: the reading line was in X already when scrolling began
    expect(pageToFollow(blocks, 160, [135, 190], 'scheme:S', 'compound:X')).toBeNull();
    // scrolled on into Y: followed, X passed by
    expect(pageToFollow(blocks, 400, [350, 440], 'scheme:S', 'compound:X')).toBe('compound:Y');
  });
  it('does not jump back to the page at the reading line after a click lower down and a little scroll', () => {
    // Z clicked low in the window; X was at the reading line then, and still is
    expect(pageToFollow(blocks, 250, [200, 290], 'compound:Z', 'compound:X')).toBeNull();
  });
  it('goes into a section’s compounds and back out to its own text', () => {
    expect(pageToFollow(blocks, 400, [340, 440], 'section:A', 'compound:X')).toBe('compound:Y');
    expect(pageToFollow(blocks, 50, [20, 80], 'compound:X', 'compound:X')).toBe('project');
  });
  it('takes text after the last page (the references) as the last page, so the end of the SI reaches it', () => {
    expect(pageToFollow(blocks, 900, [850, 950], 'compound:X', 'compound:X')).toBe('compound:Z');
    expect(pageToFollow(blocks, 900, [850, 950], 'compound:Z', 'compound:Y')).toBeNull();
  });
});

describe('the reading line', () => {
  it('is a third of the way down in the middle of the SI', () => {
    expect(readingLine(5000, 20000, 800)).toBe(0.3);
  });
  it('slides to the top at the start and to the bottom at the end, so short first and last pages can be reached', () => {
    expect(readingLine(0, 20000, 800)).toBe(0);
    expect(readingLine(120, 20000, 800)).toBeCloseTo(0.15, 9);
    expect(readingLine(20000, 20000, 800)).toBe(1);
    expect(readingLine(20000 - 400, 20000, 800)).toBeCloseTo(0.5, 9);
  });
  it('moves without jumps where the slides begin', () => {
    const at = (t: number) => readingLine(t, 20000, 800);
    expect(at(240 - 1e-6)).toBeCloseTo(at(240 + 1e-6), 5);
    expect(at(20000 - 560 - 1e-6)).toBeCloseTo(at(20000 - 560 + 1e-6), 5);
  });
  it('stays a third of the way down when nothing scrolls', () => {
    expect(readingLine(0, 0, 800)).toBe(0.3);
  });
});
