// The changelog (scripts/changelog.mjs, changes/README.md): change files are read and checked, a
// pull request that changes the app needs one, and the notes and CHANGELOG.md come out in order.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error a plain JavaScript script
import { parseChangeFile, renderEntries, needsEntry, changeFiles, prOf, sortTags, renderChangelog, issuesIn, isRollUp, TYPES } from '../scripts/changelog.mjs';

describe('change files', () => {
  it('reads one change per line, with its type', () => {
    const { entries, errors } = parseChangeFile('Added: Slides: Summary Zoom jumps to its section.\n\nfixed: Canvas: undo removes a pasted object in one step. Fixes #123.\n<!-- Removed: a note -->\n');
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { type: 'Added', text: 'Slides: Summary Zoom jumps to its section.' },
      { type: 'Fixed', text: 'Canvas: undo removes a pasted object in one step. Fixes #123.' },
    ]);
  });
  it('takes a pull request number written at the end', () => {
    expect(parseChangeFile('Changed: Interface: clicking outside a window closes it. (#733)').entries).toEqual([{ type: 'Changed', text: 'Interface: clicking outside a window closes it.', pr: 733 }]);
  });
  it('says what is wrong with a badly written file', () => {
    expect(parseChangeFile('Improved: things').errors[0]).toMatch(/start the line with one of/);
    expect(parseChangeFile('Fixed: x').errors[0]).toMatch(/in a sentence/);
    expect(parseChangeFile('Fixed: ' + 'a'.repeat(401)).errors[0]).toMatch(/one or two sentences/);
    expect(parseChangeFile('Added: TODO write this later').errors[0]).toMatch(/finish/);
    expect(parseChangeFile('<!-- Added: only a comment -->').errors[0]).toMatch(/no entries/);
  });
  it('every change file in the repository is written right', () => {
    const files = changeFiles(readdirSync('changes').map((f) => `changes/${f}`));
    const errors = files.flatMap((f: string) => parseChangeFile(readFileSync(f, 'utf8'), f).errors);
    expect(errors).toEqual([]);
  });
  it('the README and history are not change files', () => {
    expect(changeFiles(['changes/README.md', 'changes/fix-undo.md', 'changes/history/milestones.md', 'src/a.md'])).toEqual(['changes/fix-undo.md']);
  });
  it('finds the issues an entry names, but not a pull request link', () => {
    expect(issuesIn('Fixes #12 and #340; see https://x/pull/9 or a/#7')).toEqual([12, 340]);
  });
});

describe('which pull requests need a change file', () => {
  it('a change to the app does; tests, checks and docs alone do not', () => {
    expect(needsEntry(['src/main.ts'])).toBe(true);
    expect(needsEntry(['index.html'])).toBe(true);
    expect(needsEntry(['src-tauri/src/lib.rs'])).toBe(true);
    expect(needsEntry(['tests/a.test.ts', 'docs/guide/x.md', '.github/workflows/ci.yml', 'scripts/smoke.mjs', 'README.md'])).toBe(false);
  });
});

describe('notes and CHANGELOG.md', () => {
  it('lists the kinds of change in a fixed order, with the pull request and issue linked', () => {
    const md = renderEntries([
      { type: 'Fixed', text: 'Undo works. Fixes #12.', pr: 40 },
      { type: 'Added', text: 'A new tool.', pr: 41 },
      { type: 'Under the hood', text: 'Faster tests.' },
    ], { links: true });
    expect(md.split('\n').filter((l: string) => l.startsWith('###'))).toEqual(['### Added', '### Fixed', '### Under the hood']);
    expect(md).toContain('- Undo works. Fixes [#12](https://github.com/nathanohare/Chemweave/issues/12). ([#40](https://github.com/nathanohare/Chemweave/pull/40))');
    expect(md).toContain('- Faster tests.');
    expect(TYPES).toEqual(['Added', 'Changed', 'Fixed', 'Removed', 'Under the hood']);
  });
  it('release notes leave the links to GitHub', () => {
    expect(renderEntries([{ type: 'Fixed', text: 'Undo works. Fixes #12.', pr: 40 }])).toBe('### Fixed\n\n- Undo works. Fixes #12. (#40)');
  });
  it('reads the pull request from a squash merge or a merge commit', () => {
    expect(prOf('Fix a thing (#123)')).toBe(123);
    expect(prOf('Merge pull request #45 from nathanohare/x')).toBe(45);
    expect(prOf('Changelog for 0.1.300')).toBeUndefined();
  });
  it('knows a staging roll-up from the pull request that wrote a change file', () => {
    expect(isRollUp('Staging (#726)')).toBe(true);
    expect(isRollUp('Checkpoint: NMR prediction (#532)')).toBe(true);
    expect(isRollUp('Merge pull request #261 from nathanohare/staging')).toBe(true);
    expect(isRollUp('Merge pull request #260 from nathanohare/claude/project-thread-6tis11')).toBe(false);
    expect(isRollUp('Staging area for reagents (#900)')).toBe(true); // a title starting "Staging" loses its number: rare, and only the link is lost
    expect(isRollUp('Fix undo (#740)')).toBe(false);
  });
  it('orders versions by number', () => {
    expect(sortTags(['v0.1.10', 'stable', 'v0.1.9', 'v0.2.0'])).toEqual(['v0.1.9', 'v0.1.10', 'v0.2.0']);
  });
  it('puts milestones first, then the versions, then the history, and counts them', () => {
    const md = renderChangelog({
      versions: [{ version: '0.1.300', date: '2026-12-01', entries: [{ type: 'Added', text: 'A tool.', pr: 800 }] }],
      history: '## 0.1.200 (2026-11-01)\n\n### Fixed\n\n- Old fix. ([#5](https://github.com/nathanohare/Chemweave/pull/5))',
      milestones: '- **2026-10-12**: the start',
    });
    expect(md.indexOf('## Milestones')).toBeLessThan(md.indexOf('## 0.1.300'));
    expect(md.indexOf('## 0.1.300')).toBeLessThan(md.indexOf('## 0.1.200'));
    expect(md).toContain('2 versions and 2 pull requests so far');
  });
});

describe('the changelog is part of releases and pull requests', () => {
  const wf = (f: string) => readFileSync(`.github/workflows/${f}`, 'utf8');
  it('the release notes come from change files, not the merge commit', () => {
    expect(wf('desktop.yml')).toContain('node scripts/changelog.mjs notes');
    expect(wf('desktop.yml')).not.toContain('head_commit.message');
    expect(wf('desktop.yml')).toContain('node scripts/retry.mjs -- node scripts/changelog.mjs push');
  });
  it('every pull request is checked, and a label change runs it again', () => {
    expect(wf('changelog.yml')).toContain('node scripts/changelog.mjs check');
    expect(wf('changelog.yml')).toMatch(/types: \[.*labeled, unlabeled\]/);
  });
  it('the template and the agents\' notes ask for one', () => {
    expect(readFileSync('.github/pull_request_template.md', 'utf8')).toContain('changes/');
    expect(readFileSync('AGENTS.md', 'utf8')).toContain('changes/');
  });
});
