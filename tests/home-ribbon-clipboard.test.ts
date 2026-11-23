// @vitest-environment jsdom
//
// Every mode's Home tab starts with Office's Clipboard group, Paste with its ▾ (Word, PowerPoint
// and Excel all have the Paste split button), and has Format Favorites just right of its Paragraph
// group (Nate, F8b item 3). The Spreadsheet has no Paragraph group (Excel's is Alignment), so its
// Favorites follow Alignment; Design's Font and Paragraph groups are copied in at its text slot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS_TABS } from '../src/ui/canvas-ribbon';

const page = new DOMParser().parseFromString(readFileSync(join(__dirname, '../index.html'), 'utf8'), 'text/html');

/** A Home panel's groups as their labels (the Design text slot as "Font+Paragraph"). */
function groups(panel: string): string[] {
  const p = page.querySelector(panel)!;
  return [...p.children].map((g) => (g.hasAttribute('data-tx-slot') ? 'Font+Paragraph' : g.hasAttribute('data-font-group') ? 'Font' : g.querySelector(':scope > .rb-label')?.textContent?.trim() ?? '?'));
}

describe('Home ▸ Clipboard and Format Favorites in every mode', () => {
  const homes: [string, string, string][] = [
    ['Document', '[data-doc-panel="home"]', 'Paragraph'],
    ['Presentation', '[data-sl-panel="home"]', 'Paragraph'],
    ['Design', '[data-dz-panel="home"]', 'Font+Paragraph'],
    ['Spreadsheet', '[data-sh-panel="home"]', 'Alignment'],
  ];
  for (const [mode, panel, before] of homes) {
    it(`${mode}: Paste has its ▾, and Format Favorites follows ${before}`, () => {
      const g = groups(panel);
      expect(g[0]).toBe('Clipboard');
      const clip = page.querySelector(panel)!.firstElementChild!;
      expect(clip.querySelector('.rb-paste .rb-paste-more')?.getAttribute('aria-label')).toBe('Paste options');
      expect(g.filter((x) => x === 'Format Favorites')).toHaveLength(1);
      expect(g[g.indexOf('Format Favorites') - 1]).toBe(before);
    });
  }
  it('Canvas: Clipboard (Paste ▾ is built in) first, Format Favorites right after Paragraph', () => {
    const g = CANVAS_TABS.find((t) => t.id === 'home')!.groups.map((x) => x.name);
    expect(g[0]).toBe('Clipboard');
    expect(g[g.indexOf('Format Favorites') - 1]).toBe('Paragraph');
  });
});
