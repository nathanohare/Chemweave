// @vitest-environment jsdom
//
// Three small faults from the full code review (batch 06): the figure's Label box, the spelling
// fallback and the Paste button for a picture, each done as the finding's steps say.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SiFigureEditor } from '../src/ui/si-figure';
import { SiPictures } from '../src/ui/si-picture';
import { checkSpelling } from '../src/ui/si-spell';
import { tick } from './review-batch06-helpers';

// (the speller's word lists could not be loaded)
vi.mock('../src/text/spelling', async (orig) => {
  const actual = await orig<typeof import('../src/text/spelling')>();
  return { ...actual, loadSpeller: vi.fn(async () => null) };
});

beforeEach(() => { document.body.innerHTML = ''; });

describe('Figure card', () => {
  it('a double-click in the Label box does not open the drawing tools (F226)', async () => {
    const editStructure = vi.fn();
    const host = { section: { data: {} }, project: {}, chosen: vi.fn(), editStructure, flash: vi.fn() };
    const fig = new SiFigureEditor(host as never, 'f-1', 'Figure S1');
    document.body.append(fig.el);
    const box = fig.el.querySelector('input.si-label-input')!;
    box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick(10);
    expect(editStructure).not.toHaveBeenCalled();
  });

  it('a double-click on the picture still opens the drawing tools (F226)', async () => {
    const editStructure = vi.fn();
    const host = { section: { data: {} }, project: {}, chosen: vi.fn(), editStructure, flash: vi.fn(), contentsOfCdxml: () => null, contentsOf: () => null };
    const fig = new SiFigureEditor(host as never, 'f-1', 'Figure S1');
    document.body.append(fig.el);
    fig.el.querySelector('.si-fig-pic')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick(10);
    expect(editStructure).toHaveBeenCalled();
  });
});

describe('Spelling when the speller cannot be loaded', () => {
  it('the browser’s own check is on for a box checked afterwards, and for the boxes already open (F989)', async () => {
    // (a browser that can draw highlights: Chemweave's own check turns the browser's off)
    const g = globalThis as unknown as Record<string, unknown>;
    g.CSS = { highlights: new Map() };
    g.Highlight = class { constructor(..._r: Range[]) {} };
    const a = document.createElement('div'); a.className = 'si-rich'; a.textContent = 'Some text';
    const b = document.createElement('div'); b.className = 'si-rich'; b.textContent = 'More text';
    document.body.append(a, b);
    checkSpelling(a);
    await tick(20);
    expect(a.spellcheck).toBe(true);
    // (a box checked after the speller failed: not turned off again)
    checkSpelling(b);
    expect(b.spellcheck).toBe(true);
  });
});

describe('Paste Picture', () => {
  it('says there is no picture when the clipboard holds only text (F990)', async () => {
    const flash = vi.fn();
    const pics = new SiPictures({ flash } as never);
    expect(await pics.fromRead({ kind: 'text', text: 'hello' })).toBeNull();
    expect(flash).toHaveBeenCalledTimes(1);
    expect(String(flash.mock.calls[0][0])).toMatch(/no picture or drawing/);
  });
});
