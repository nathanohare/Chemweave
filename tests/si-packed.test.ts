// SI projects kept as one file (.chemsi): the parts that run in the page (src/si/packed.ts). The
// packing itself is the desktop app's (src-tauri/src/si_file.rs, with its own cargo tests).

import { describe, expect, it } from 'vitest';
import { MemoryFolder } from '../src/si/folder';
import { JournalFolder } from '../src/si/journal';
import { SiProject } from '../src/si/project';
import { ChangeCounter, SiFiles, asSiFile, counterOf, isSiFile, joinPath, packSkips, siFileStem, unsavedChange } from '../src/si/packed';

describe('SI project file names', () => {
  it('knows project files and zips from folders', () => {
    expect(isSiFile('C:\\Users\\me\\NaBH4 SI.chemsi')).toBe(true);
    expect(isSiFile('/home/me/NaBH4 SI.CHEMSI')).toBe(true);
    expect(isSiFile('/home/me/snapshot.zip')).toBe(true);
    expect(isSiFile('/home/me/NaBH4 SI')).toBe(false);
    expect(isSiFile('/home/me/v1.2/NaBH4 SI')).toBe(false);
  });
  it('saves a zip as a .chemsi beside it', () => {
    expect(asSiFile('/a/b/snap.zip')).toBe('/a/b/snap.chemsi');
    expect(asSiFile('/a/b/x.chemsi')).toBe('/a/b/x.chemsi');
    expect(asSiFile('/a/b/x')).toBe('/a/b/x.chemsi');
    expect(siFileStem('C:\\a\\Quinoline C4.chemsi')).toBe('Quinoline C4');
    expect(joinPath('C:\\data\\si-working\\1', 'source.json')).toBe('C:\\data\\si-working\\1\\source.json');
    expect(joinPath('/data/si-working/1/', 'source.json')).toBe('/data/si-working/1/source.json');
  });
});

describe('unsaved changes', () => {
  it('leaves out the lock, build/, the check cache and the Word snapshot', () => {
    expect(unsavedChange('.lock')).toBe(false);
    expect(unsavedChange('build/chemweave-undo/x')).toBe(false);
    expect(unsavedChange('manuscript/check.json')).toBe(false);
    expect(unsavedChange('NaBH4 SI (Snapshot).docx')).toBe(false);
    expect(unsavedChange('project.json')).toBe(true);
    expect(unsavedChange('sections/01_x/section.json')).toBe(true);
    expect(unsavedChange('trash/2026/entry.json')).toBe(true);
    expect(packSkips(['project.json', 'NaBH4 SI (Snapshot).docx', 'sections'])).toEqual(['NaBH4 SI (Snapshot).docx']);
  });

  it('counts each change to the project, and none to its own working files', async () => {
    const inner = new MemoryFolder('w');
    const c = new ChangeCounter(inner);
    let told = 0;
    c.onChange = () => { told++; };
    expect(c.dirty).toBe(false);
    await c.writeText('.lock', 'me');
    await c.writeText('build/x.txt', 'x');
    expect(c.dirty).toBe(false);
    await c.writeText('project.json', '{}');
    await c.writeBytes('sections/a/s.pdf', new Uint8Array([1]));
    await c.move('sections/a/s.pdf', 'trash/1/s.pdf');
    await c.removeTrash('trash/1');
    expect(c.changes).toBe(4);
    expect(told).toBe(4);
    expect(c.dirty).toBe(true);
    c.saved = c.changes;
    expect(c.dirty).toBe(false);
    // a change that fails still counts (part of it may have been made)
    await expect(c.move('missing', 'trash/2')).rejects.toThrow();
    expect(c.dirty).toBe(true);
  });

  it('is found under the Undo history, and a project opened on it guards writes as before', async () => {
    const inner = new MemoryFolder('Example SI');
    const c = new ChangeCounter(inner);
    const j = new JournalFolder(c);
    expect(counterOf(j)).toBe(c);
    expect(counterOf(inner)).toBe(null);
    const p = await SiProject.create(j, 'Example SI');
    expect(c.dirty).toBe(true);
    // the guard the project sets reaches the folder at the bottom
    expect(typeof inner.beforeChange).toBe('function');
    p.readOnly = true;
    await expect(j.writeText('project.json', '{}')).rejects.toThrow();
  });
});

describe('the desktop app’s side', () => {
  it('reads what source.json says, and is safe with what it does not', async () => {
    const written = new Map<string, string>();
    const files = new SiFiles(async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      if (cmd === 'write_text_file') { written.set(String(args!.path), String(args!.contents)); return undefined as T; }
      if (cmd === 'read_text_file') {
        const got = written.get(String(args!.path));
        if (got === undefined) throw new Error('no such file (os error 2)');
        return got as T;
      }
      throw new Error(cmd);
    });
    const w = { working: '/data/si-working/1', root: '/data/si-working/1/NaBH4 SI' };
    await files.note(w, { file: '/me/NaBH4 SI.chemsi', title: 'NaBH4 SI', opened: '2026-11-24T22:00:00Z', unsaved: true, stamp: { modified: 5, size: 7 }, root: w.root });
    expect(await files.source(w.working)).toEqual({ file: '/me/NaBH4 SI.chemsi', title: 'NaBH4 SI', opened: '2026-11-24T22:00:00Z', unsaved: true, stamp: { modified: 5, size: 7 }, root: w.root });
    expect(await files.source('/data/si-working/2')).toBe(null);
    written.set('/data/si-working/3/source.json', '{"file": 4, "unsaved": "yes", "stamp": {"modified": "x"}}');
    expect(await files.source('/data/si-working/3')).toEqual({ file: null, title: '', opened: '', unsaved: false, stamp: null, root: '' });
  });
});
