// The Slide Master ribbon's Title, References and Title Slide Colors checkboxes (data-cmd
// layout-has-title, layout-has-refs, layout-title-look) share the `layout-` prefix of the slide
// layout picks (layout-<id>). command() sent every `layout-` name to setLayout() before looking in
// COMMANDS, so those checkboxes put a layout called "has-title" on the slide instead of changing the
// layout, and the ribbon's layout-pick marking set aria-checked on them. main.ts runs the whole app
// when imported, so its helper is read from the source and its use checked there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const main = readFileSync(join(__dirname, '..', 'src/main.ts'), 'utf8');

function layoutPickId(): (name: string) => string | null {
  const at = main.indexOf('function layoutPickId(');
  expect(at).toBeGreaterThan(-1);
  const body = main.slice(at, main.indexOf('\n}\n', at) + 2);
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(`${js}; return layoutPickId;`)() as (name: string) => string | null;
}

/** The names of COMMANDS that start with `layout-`. */
function layoutCommands(): string[] {
  const at = main.indexOf('const COMMANDS: Record<string, () => unknown> = {');
  const body = main.slice(at, main.indexOf('\n};', at));
  return [...body.matchAll(/^\s+'(layout-[a-z0-9-]+)': /gm)].map((m) => m[1]);
}

describe('layout- commands', () => {
  it('reads a layout pick, and none of the commands of that prefix as one', () => {
    const pick = layoutPickId();
    expect(pick('layout-title-only')).toBe('title-only');
    expect(pick('layout-two-content')).toBe('two-content');
    expect(pick('new-slide')).toBeNull();
    const own = layoutCommands();
    expect(own).toEqual(expect.arrayContaining(['layout-has-title', 'layout-has-refs', 'layout-title-look']));
    for (const name of own) expect(pick(name), name).toBeNull();
  });

  it('command() and the ribbon marking test for a layout pick with it, not with the bare prefix', () => {
    const fn = main.slice(main.indexOf('function command(name: string)'), main.indexOf('const run = COMMANDS[name];'));
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).not.toMatch(/name\.startsWith\('layout-'\) && ws\.active\.mode === 'slides'/);
    expect(fn).toMatch(/layoutPickId\(name\)[\s\S]*setLayout\(pick\)/);
    const mark = main.split('\n').find((l) => l.includes(`'[data-cmd^="layout-"]'`) && l.includes('aria-checked'));
    expect(mark).toContain('layoutPickId(');
  });
});
