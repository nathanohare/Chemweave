import { describe, it, expect } from 'vitest';
import { compareVersions, notesSince, newestNotes, cleanNotes, shortNotes, noteLine } from '../src/updates';

describe("What's New", () => {
  it('orders versions by number, not as text', () => {
    expect(compareVersions('0.1.9', '0.1.10')).toBe(-1);
    expect(compareVersions('v0.1.131', '0.1.131')).toBe(0);
    expect(compareVersions('0.2.0', '0.1.300')).toBe(1);
  });

  it('lists what changed after the last version run, up to this one, newest first', () => {
    const rel = [
      { tag_name: 'v0.1.140', body: 'Merge pull request #220 from nathanohare/staging\n\nCheckpoint: menus in one column' },
      { tag_name: 'v0.1.139', body: 'Lasso select' },
      { tag_name: 'v0.1.138', body: 'Older' },
      { tag_name: 'v0.1.141', body: 'Not installed yet' },
      { tag_name: 'stable', body: 'the stable pointer' },
      { tag_name: 'v0.1.139b', body: '', draft: true },
    ];
    expect(notesSince(rel, '0.1.138', '0.1.140')).toEqual([
      { version: '0.1.140', notes: 'Checkpoint: menus in one column' },
      { version: '0.1.139', notes: 'Lasso select' },
    ]);
  });
});

describe("Help ▸ What's New (review of F5, R16)", () => {
  it('shows the newest three versions up to this one, not every release', () => {
    const rel = Array.from({ length: 12 }, (_, i) => ({ tag_name: `v0.1.${100 + i}`, body: `Change ${i}` }));
    expect(newestNotes(rel, '0.1.110').map((r) => r.version)).toEqual(['0.1.110', '0.1.109', '0.1.108']);
    expect(newestNotes(rel, '0.1.101', 5).map((r) => r.version)).toEqual(['0.1.101', '0.1.100']);
  });
});

describe("What's New from change files", () => {
  const body = '### Added\n\n- Slides: a new tool. (#740)\n\n### Fixed\n\n- Undo works. Fixes [#12](https://github.com/nathanohare/Chemweave/issues/12). (#741)\n\nEvery version: [CHANGELOG.md](https://github.com/nathanohare/Chemweave/blob/main/CHANGELOG.md)';
  it('keeps the kinds of change and the changes, as plain text', () => {
    expect(cleanNotes(body)).toBe('### Added\n- Slides: a new tool. (#740)\n### Fixed\n- Undo works. Fixes #12. (#741)');
    expect(cleanNotes(body).split('\n').map(noteLine)).toEqual([
      { heading: 'Added' }, { text: 'Slides: a new tool. (#740)' }, { heading: 'Fixed' }, { text: 'Undo works. Fixes #12. (#741)' },
    ]);
  });
  it('the update notice shows the changes without the headings', () => {
    expect(shortNotes(body, 1)).toBe('Slides: a new tool. (#740)\n…');
  });
  it("leaves out an older release's empty pull request template", () => {
    const old = 'Staging (#716)\n\n## What this changes\n\n<!-- A few lines in plain words.\n-->\n\n## Checklist\n\n- **Real-program check**: queued';
    expect(cleanNotes(old)).toBe('Staging (#716)');
  });
});
