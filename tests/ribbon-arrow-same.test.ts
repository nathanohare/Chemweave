// @vitest-environment jsdom
// The ▴ at the right of the ribbon tabs does the same in every mode (retrospective audit G5-36, S17):
// it collapses the ribbon to its tabs. Classic or Simplified for the Canvas ribbon moved to View ▸
// Ribbon ▸ Simplified Ribbon (and Settings ▸ Toolboxes and Ribbon, behind the Canvas ribbon's gear).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setRibbonCollapsed, ribbonCollapsed, watchRibbons } from '../src/ui/ribbon-fit';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('the ribbon arrow (G5-36)', () => {
  it('collapses and pins the ribbon, with the same tip on every ribbon', () => {
    document.body.innerHTML = '<div class="ribbon" id="canvas-ribbon"><div class="rb-tabs"></div></div><div class="ribbon" id="doc-ribbon"><div class="rb-tabs"></div></div>';
    try { watchRibbons(); } catch { /* (layout work jsdom can't do) */ }
    setRibbonCollapsed(false);
    const arrows = [...document.querySelectorAll<HTMLButtonElement>('.rb-collapse')];
    expect(arrows).toHaveLength(2);
    expect(new Set(arrows.map((a) => a.title)).size).toBe(1);
    expect(arrows[0].title).toContain('Collapse the ribbon to its tabs');
    arrows[0].click();
    expect(ribbonCollapsed()).toBe(true);
    expect(arrows.map((a) => a.textContent)).toEqual(['▾', '▾']);
    arrows[0].click();
    expect(ribbonCollapsed()).toBe(false);
  });
  it('the look switch is no longer on the arrow; View ▸ Ribbon has Simplified Ribbon in Canvas', () => {
    expect(src('src/ui/ribbon-fit.ts')).not.toContain('addLookToggle');
    expect(src('src/main.ts')).not.toContain('addLookToggle(');
    const html = src('index.html');
    expect(html).toContain('<button data-modes="drawing" role="menuitemcheckbox" aria-checked="false" data-cmd="ribbon-simplified"');
    expect(src('src/main.ts')).toContain("'ribbon-simplified': () => { setRibbonLook(ribbonLook === 'simple' ? 'classic' : 'simple'); storeSettings(); },");
  });
});
