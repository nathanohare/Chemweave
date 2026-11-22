// The New items (Nate's C9, 2026-11-22; retrospective audit G5-32): File ▸ New, the + by the file
// tabs and the start view list the same five, worded as Office words them, with no parentheses.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NEW_ITEMS } from '../src/ui/new-items';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('New items', () => {
  it('are Nate\'s five, in his order and wording', () => {
    expect(NEW_ITEMS.map((n) => n.label)).toEqual(['Blank canvas', 'Blank document', 'Blank presentation', 'Blank spreadsheet', 'Blank design']);
    expect(NEW_ITEMS.map((n) => n.cmd)).toEqual(['new', 'new-document', 'new-slides', 'new-sheet', 'new-design']);
    for (const n of NEW_ITEMS) expect(`${n.label} ${n.blurb}`).not.toMatch(/[()]/);
  });
  it('File ▸ New lists the same items, with what each holds in the tooltip', () => {
    const got = [...html.matchAll(/<button role="menuitem" data-cmd="([a-z-]+)" data-new-item title="([^"]*)">([^<]*)<\/button>/g)].map((m) => ({ cmd: m[1], blurb: m[2], label: m[3] }));
    expect(got).toEqual(NEW_ITEMS.map((n) => ({ cmd: n.cmd, blurb: n.blurb, label: n.label })));
    // the old names are gone
    expect(html).not.toMatch(/Presentation \(Slide Show\)|Document \(Text Document\)|Design \(Posters/);
  });
  it('the start view has a tile for each, Blank canvas first (it starts drawing on the canvas open)', () => {
    const view = html.slice(html.indexOf('<section id="start-view"'), html.indexOf('</section>', html.indexOf('<section id="start-view"')));
    const tiles = [...view.matchAll(/data-start="([a-z-]+)" data-mode="([a-z]+)"><span class="sv-icon"><\/span><span>([^<]*)<\/span><small>([^<]*)<\/small>/g)].map((m) => ({ mode: m[2], label: m[3], blurb: m[4] }));
    expect(tiles).toEqual(NEW_ITEMS.map((n) => ({ mode: n.mode, label: n.label, blurb: n.blurb })));
    expect(view).toContain('data-start="draw" data-mode="drawing"');
    // the old "Start drawing" button it replaces is gone
    expect(view).not.toContain('Start drawing');
  });
  it('the + menu is built from the same list', () => {
    expect(main).toContain('showContextMenu(x, y, NEW_ITEMS.map((n) => ({ cmd: n.cmd, label: n.label, title: n.blurb })),');
    expect(main).not.toContain("'Presentation (Slideshow)'");
  });
});
