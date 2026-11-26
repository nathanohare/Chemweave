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
    expect(main).toEqual(['Home', 'Insert', 'Layout', 'References', 'Review', 'View']);
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
});
