import { describe, it, expect } from 'vitest';
import { compareVersions, notesSince, newestNotes } from '../src/updates';

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
