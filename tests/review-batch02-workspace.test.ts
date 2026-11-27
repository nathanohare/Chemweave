// @vitest-environment jsdom
//
// Code review 2026-11-26, batch 02, F032: the workspace tells the keeper when each write it let go
// has ended, written or not, so the disk checks wait only while the app is writing the file.

import { describe, it, expect, vi } from 'vitest';

const disk = new Map<string, { data: Uint8Array; modified: number }>();
const fail = vi.hoisted(() => ({ write: false }));
let clock = 1_000_000;
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: unknown, opts?: { headers: Record<string, string> }) => {
    const a = args as Record<string, string>;
    const put = (path: string, data: Uint8Array) => { if (fail.write) throw new Error('the disk is full'); disk.set(path, { data, modified: ++clock }); };
    if (cmd === 'write_text_file') { put(a.path, new TextEncoder().encode(a.contents)); return; }
    if (cmd === 'write_binary_file') { put(decodeURIComponent(opts!.headers.path), args as Uint8Array); return; }
    if (cmd === 'read_binary_file') { const b = disk.get(a.path); if (!b) throw new Error('not found'); return b.data.slice().buffer; }
    if (cmd === 'path_exists') return disk.has(a.path);
    if (cmd === 'file_stamp') { const f = disk.get(a.path); return f ? { modified: f.modified, size: f.data.length } : null; }
    throw new Error('unexpected ' + cmd);
  },
}));
vi.mock('../src/io/files', async (orig) => ({ ...(await orig<typeof import('../src/io/files')>()), showError: async () => {} }));

import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks } from '../src/workspace';
import { writeCdxml } from '../src/io/cdxml-write';

const measure = (t: string, s: number) => t.length * s * 0.5;

describe('F032: written() after every write beforeWrite let go', () => {
  it('is called when the write works, when it fails, and not when beforeWrite stopped it', async () => {
    const order: string[] = [];
    let answer: 'go' | 'stop' = 'go';
    const host = new Doc();
    const hooks: WorkspaceHooks = {
      leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
      pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
      measure,
      sheets: { read: async () => { throw new Error('no sheets'); }, write: async () => '' },
      documents: { read: async () => { throw new Error('no documents'); }, write: async () => new Uint8Array() },
      beforeWrite: async () => { order.push('before'); return answer; },
      saved: (_t, _d, how) => order.push(`saved ${how}`),
      autoSaveFailed: () => order.push('failed'),
      written: () => order.push('written'),
    };
    const ws = new Workspace(host, hooks);
    const d = new Doc();
    d.bulk(() => { d.addAtom(0, 0, 6); });
    disk.set('/w/a.cdxml', { data: new TextEncoder().encode(writeCdxml(d, { name: 'a.cdxml', textMeasure: measure })), modified: 10 });
    await ws.openBytes(disk.get('/w/a.cdxml')!.data, 'a.cdxml', { kind: 'path', path: '/w/a.cdxml' });
    const tab = ws.active;
    const edit = () => { host.edit('add', () => host.addAtom(40, 0, 6)); ws.noteChange(); };
    edit();
    expect(await ws.save(tab, 'autosaved')).toBe(true);
    expect(order).toEqual(['before', 'saved autosaved', 'written']);
    order.length = 0;
    edit();
    fail.write = true;
    expect(await ws.save(tab, 'autosaved')).toBe(false);
    expect(order).toEqual(['before', 'failed', 'written']);
    order.length = 0;
    expect(await ws.save(tab)).toBe(false);
    expect(order).toEqual(['before', 'written']);
    fail.write = false;
    order.length = 0;
    answer = 'stop';
    expect(await ws.save(tab)).toBe(false);
    expect(order).toEqual(['before']);
  });
});
