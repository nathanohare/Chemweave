// The wiki is built from docs/ by scripts/build-wiki.mjs. These check the heading ids it works out
// match GitHub's, and that every link on every page it makes leads to a page and heading that exist.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { slug, headingText, buildWiki, PAGES } from '../scripts/build-wiki.mjs';

/** Ids of the headings in a page's Markdown, the way GitHub numbers them. */
function ids(md: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) out.add(slug(m[2], seen));
  }
  return out;
}

describe('heading ids', () => {
  it('match the ids GitHub gives', () => {
    expect(slug('Insert ▸ Symbol (every mode)')).toBe('insert--symbol-every-mode');
    expect(slug('3-D model')).toBe('3-d-model');
    expect(slug('Analysis: PivotTables, What-If and the Analysis ToolPak')).toBe('analysis-pivottables-what-if-and-the-analysis-toolpak');
    expect(slug('Opening files from Explorer or Finder (desktop app)')).toBe('opening-files-from-explorer-or-finder-desktop-app');
    expect(slug('**Bold** and `code` and [a link](x.md)')).toBe('bold-and-code-and-a-link');
    expect(slug('Ångström and β-lactams')).toBe('ångström-and-β-lactams');
  });

  it('number repeated headings -1, -2 like GitHub', () => {
    const seen = new Map();
    expect(['Notes', 'Notes', 'Notes', 'Notes-1'].map((t) => slug(t, seen))).toEqual(['notes', 'notes-1', 'notes-2', 'notes-1-1']);
  });

  it('show heading text without Markdown marks', () => {
    expect(headingText('Edit ▸ **Settings**')).toBe('Edit ▸ Settings');
  });
});

describe('the wiki made from docs/', () => {
  const { files, warnings } = buildWiki();

  it('builds with every link and picture in docs/ found', () => {
    expect(warnings).toEqual([]);
  });

  it('has every page in the sidebar', () => {
    const pages = Object.keys(files).filter((n) => !n.startsWith('_') && n !== 'Home');
    for (const p of pages) expect(files._Sidebar, p).toContain(`](${p})`);
  });

  it('links only to pages and headings that exist', () => {
    const idsOf = new Map(Object.entries(files as Record<string, string>).map(([n, md]) => [n, ids(md)]));
    const bad: string[] = [];
    for (const [name, md] of Object.entries(files as Record<string, string>)) {
      for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
        const url = m[1];
        if (/^[a-z]+:/i.test(url)) continue;
        const [page, id] = url.split('#');
        const target = page || name;
        if (!idsOf.has(target)) bad.push(`${name}: ${url} (no page ${target})`);
        else if (id !== undefined && id !== '' && !idsOf.get(target)!.has(id)) bad.push(`${name}: ${url} (no heading #${id})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('points pictures at docs/images on GitHub', () => {
    expect(files.Home).toContain('https://raw.githubusercontent.com/nathanohare/Chemweave/main/docs/images/drawing.png');
    expect(Object.values(files).join('\n')).not.toMatch(/\]\(\.\.\/images\//);
  });
});

describe('building from other files', () => {
  it('reports a link to a heading that is not there, and keeps a section no page lists', () => {
    const root = mkdtempSync(join(tmpdir(), 'wiki-test-'));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'docs/a.md'), '# A\n\nSee [b](b.md#nowhere) and [c](#two).\n\n## One\n\ntext\n\n## Two\n\nmore\n\n## Three\n\nnew section\n');
      writeFileSync(join(root, 'docs/b.md'), '# B\n\n## Here\n');
      const pages = [
        { name: 'A', src: 'docs/a.md', label: 'A', group: 'G', split: [{ name: 'A-One', label: 'One', sections: ['One'] }, { name: 'A-Two', label: 'Two', sections: ['Two'] }] },
        { name: 'B', src: 'docs/b.md', label: 'B', group: 'G' },
      ];
      const { files, warnings } = buildWiki(root, pages);
      expect(warnings.some((w: string) => w.includes('#nowhere'))).toBe(true);
      expect(warnings.some((w: string) => w.includes('## Three'))).toBe(true);
      expect(files.A).toContain('new section');
      expect(files.A).toContain('[c](A-Two#two)');
      expect(files['A-One']).toContain('[A](A)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists the real guide pages', () => {
    expect(PAGES.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['Canvas', 'Presentation', 'Spreadsheet', 'Document', 'Design']));
  });
});
