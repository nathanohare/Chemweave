// Flags' replies, @mentions, resolving and section flags (Chemweave's chemweave-flags.json), with
// SI Assistant's own compound.json flags kept as SI Assistant writes them.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryFolder } from '../src/si/folder';
import { SiProject, type Json } from '../src/si/project';
import { compoundAnchor, FLAGS_FILE, mentionRanges, mentionsIn, parseFlagFile } from '../src/si/flag-threads';

function folder(): MemoryFolder {
  const root = join(__dirname, 'fixtures', 'si-example');
  const f = new MemoryFolder('si-example');
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name !== 'README.md') f.files.set(relative(root, p).split('\\').join('/'), new Uint8Array(readFileSync(p)));
    }
  };
  walk(root);
  return f;
}
const read = (f: MemoryFolder, rel: string): Json => JSON.parse(new TextDecoder().decode(f.files.get(rel)));
const compoundFile = (p: SiProject, id: string): string => `${p.compound(id).folder}/compound.json`;

describe('mentions', () => {
  const people = ['Alex Example', 'Alex', 'Blair Sample'];
  it('finds @Name (the longest name that fits), not e-mail addresses or part of a word', () => {
    expect(mentionsIn('@Alex Example please check, cc @blair sample', people)).toEqual(['Alex Example', 'Blair Sample']);
    expect(mentionsIn('@Alex, see this', people)).toEqual(['Alex']);
    expect(mentionsIn('mail alex@example.com or @Alexander', people)).toEqual([]);
    expect(mentionRanges('Hi @Alex Example!', people)).toEqual([[3, 16]]);
  });
});

describe('the flag file', () => {
  it('reads safely: missing is empty, broken or newer is null (never written over)', () => {
    expect(parseFlagFile(null)).toEqual({ threads: {}, sections: {} });
    expect(parseFlagFile('{oops')).toBeNull();
    expect(parseFlagFile(JSON.stringify({ version: 9, threads: {} }))).toBeNull();
    const got = parseFlagFile(JSON.stringify({ version: 1, threads: { 'c:x/yield': { replies: [{ text: 'ok', by: 'A', at: '1' }, { text: '' }, 5] }, bad: {} }, sections: { s1: { f1: { comment: 'look', by: 'B' }, f2: 'x' } } }));
    expect(got).toEqual({ threads: { 'c:x/yield': { replies: [{ text: 'ok', by: 'A', at: '1' }] } }, sections: { s1: { f1: { comment: 'look', by: 'B', at: '' } } } });
  });
});

describe('flag threads in a project', () => {
  it('replies, resolves (taking the flag out of compound.json), reopens and deletes', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const c = p.compounds[0];
    await p.setFlag(c, 'yield', true, 'check the mass');
    const a = compoundAnchor(c.id, 'yield');
    await p.replyToFlag(a, '@Alex Example measured again: 95%');
    expect(p.allFlags().map((x) => [x.anchor, x.resolved, x.thread.replies.length])).toEqual([[a, false, 1]]);
    // resolved: gone from compound.json (SI Assistant's warnings clear), kept in Chemweave's file
    await p.resolveFlag(a, true);
    expect((read(f, compoundFile(p, c.id)).flags as Json).yield).toBeUndefined();
    expect(parseFlagFile(new TextDecoder().decode(f.files.get(FLAGS_FILE)))!.threads[a].resolved?.flag.comment).toBe('check the mass');
    expect(p.allFlags()[0].resolved).toBe(true);
    expect(p.openFlag(a)).toBeNull();
    // reopened as it was
    await p.resolveFlag(a, false);
    expect(((read(f, compoundFile(p, c.id)).flags as Json).yield as Json).comment).toBe('check the mass');
    expect(p.allFlags()[0].resolved).toBe(false);
    expect(p.allFlags()[0].thread.replies).toHaveLength(1);
    // read again from the folder: the same
    const again = await SiProject.open(f);
    expect(again.allFlags().map((x) => [x.anchor, x.resolved, x.thread.replies[0]?.text])).toEqual([[a, false, '@Alex Example measured again: 95%']]);
    // deleted: the flag and its replies
    await p.deleteFlag(a);
    expect(p.allFlags()).toEqual([]);
    expect((read(f, compoundFile(p, c.id)).flags as Json).yield).toBeUndefined();
  });

  it('a flag on a section heading lives in Chemweave\u2019s file, and resolves and deletes the same way', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const s = p.top[0];
    const a = await p.addSectionFlag(s.id, 'Table S1 needs a footnote');
    expect(p.openFlag(a)?.comment).toBe('Table S1 needs a footnote');
    await p.editFlagNote(a, null, 'Table S1 needs footnote c');
    await p.resolveFlag(a, true);
    expect(p.openFlag(a)).toBeNull();
    expect(p.allFlags()[0]).toMatchObject({ anchor: a, resolved: true, flag: { comment: 'Table S1 needs footnote c' } });
    await p.resolveFlag(a, false);
    expect(p.openFlag(a)?.comment).toBe('Table S1 needs footnote c');
    await p.deleteFlag(a);
    expect(p.allFlags()).toEqual([]);
  });

  it('a flag file that can\u2019t be read is never written over', async () => {
    const f = folder();
    f.files.set(FLAGS_FILE, new TextEncoder().encode('{half synced'));
    const p = await SiProject.open(f);
    expect(p.flagFileUnread).toBe(true);
    await expect(p.replyToFlag(compoundAnchor(p.compounds[0].id, 'yield'), 'x')).rejects.toThrow(/can’t be read/);
    expect(new TextDecoder().decode(f.files.get(FLAGS_FILE))).toBe('{half synced');
  });

  it('taking a flag off (the SI page\u2019s flag button) deletes its replies too', async () => {
    const f = folder();
    const p = await SiProject.open(f);
    const c = p.compounds[0];
    await p.setFlag(c, 'rf', true, 'eluent?');
    await p.replyToFlag(compoundAnchor(c.id, 'rf'), 'hexanes/EtOAc 4:1');
    await p.setFlag(c, 'rf', false);
    expect(p.flagFile.threads[compoundAnchor(c.id, 'rf')]).toBeUndefined();
  });
});
