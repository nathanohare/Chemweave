// Outline View shows every slide title in bold, as PowerPoint does (F3 Needs Nate 7, F8b item 7).
// Source: Microsoft Support, "Create and print a presentation in Outline view": "The first text you
// type will be a title, indicated by boldface type."
// https://support.microsoft.com/en-US/PowerPoint/create-and-print-a-presentation-in-outline-view
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Outline View titles', () => {
  it('are drawn bold whatever their characters\' own bold', () => {
    const css = readFileSync(join(__dirname, '../src/app.css'), 'utf8');
    const rule = /\n\.ol-title \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-weight:\s*(700|bold)/);
  });
});
