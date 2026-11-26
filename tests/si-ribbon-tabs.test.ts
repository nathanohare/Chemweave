// The SI tab's ribbon has Document mode's main tabs (Home, Insert, Layout, References, Review,
// View), and every one of its buttons is run by SiMode: a button added to the ribbon without a
// command behind it does nothing when clicked, which no other check would notice.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const siSrc = readFileSync(join(__dirname, '..', 'src/ui/si-mode.ts'), 'utf8');
const start = siSrc.indexOf('const RIBBON = `') + 16;
const RIBBON = siSrc.slice(start, siSrc.indexOf('`;', start));

describe('SI ribbon tabs', () => {
  it("has Document mode's main tabs, in Word's order", () => {
    const main = [...RIBBON.matchAll(/<button role="tab" data-si-tab="([a-z]+)" aria-selected="(?:true|false)">([^<]+)<\/button>/g)].map((m) => m[2]);
    expect(main).toEqual(['Home', 'Project', 'Insert', 'Layout', 'References', 'Review', 'View']);
  });
  it('has a panel for every tab', () => {
    const tabs = [...RIBBON.matchAll(/data-si-tab="([a-z]+)"/g)].map((m) => m[1]);
    const panels = new Set([...RIBBON.matchAll(/data-si-panel="([a-z]+)"/g)].map((m) => m[1]));
    for (const t of tabs) expect(panels.has(t), t).toBe(true);
  });
  it('runs every data-si button it has', () => {
    const cmds = new Set([...RIBBON.matchAll(/data-si="([a-z0-9-]+)"/g)].map((m) => m[1]));
    const handled = new Set([...siSrc.matchAll(/case '([a-z0-9-]+)'/g)].map((m) => m[1]));
    const missing = [...cmds].filter((c) => !handled.has(c));
    expect(missing).toEqual([]);
  });
  it('has each command once, and none that only repeats a click or double-click', () => {
    // a structure, figure, crystal structure or scheme box is edited by clicking or double-clicking it,
    // a reference or a check result by double-clicking it; Header, Footer and Page Number were only
    // Page Setup again, and Bibliography only Manage References again
    for (const gone of ['data-si="edit-structure"', 'data-si-place="edit"', 'data-si-fig="draw-structure"', 'data-si-xray="edit"', 'data-si-scheme="draw"', 'data-si="ref-edit"', 'data-si-ms="ms-open"', 'data-si="header"', 'data-si="footer"', 'data-si="page-number"', 'data-si="bibliography"']) expect(RIBBON, gone).not.toContain(gone);
    const all = [...RIBBON.matchAll(/data-si="([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(all.filter((c, i) => all.indexOf(c) !== i)).toEqual([]);
  });
});
