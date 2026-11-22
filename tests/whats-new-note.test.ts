// @vitest-environment jsdom
// What's New is never shown over the canvas (S86): after an update a note waits in the status bar,
// and the notes open from it or from Help ▸ What's New.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UpdateUI } from '../src/ui/update-ui';
import { RELEASES_PAGE } from '../src/updates';

const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const host = (opened: string[] = []) => ({ unsaved: () => [], skipped: () => null, skip: () => {}, channel: () => 'stable' as const, openPage: (u: string) => { opened.push(u); }, closing: async () => {} });

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("What's New (S86)", () => {
  it('puts a note in the status bar instead of a card, and the card opens from the note', async () => {
    document.body.innerHTML = '<footer id="status"><span id="hint"></span><button id="status-side"></button></footer>';
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => [{ tag_name: 'v1.4.0', draft: false, body: 'Faster loading\nMerge pull request #1 from x' }, { tag_name: 'v1.3.0', draft: false, body: 'Older' }] }));
    const ui = new UpdateUI(host());
    await ui.whatsNewNote('1.3.0', '1.4.0');
    expect(document.querySelector('.update-box')).toBeNull();
    const note = document.getElementById('status-whats-new')!;
    expect(note.textContent).toBe('Updated to 1.4.0: What’s New');
    expect(note.nextElementSibling!.id).toBe('status-side');
    note.click();
    expect(document.getElementById('status-whats-new')).toBeNull();
    const card = document.querySelector('.update-box.whats-new')!;
    expect(card.textContent).toContain('Faster loading');
    expect(card.textContent).not.toContain('Merge pull request');
    expect(card.textContent).not.toContain('Older');
  });
  it('no note when GitHub cannot be reached', async () => {
    document.body.innerHTML = '<footer id="status"><button id="status-side"></button></footer>';
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    await new UpdateUI(host()).whatsNewNote('1.3.0', '1.4.0');
    expect(document.getElementById('status-whats-new')).toBeNull();
  });
  it('Help ▸ What\'s New in the web version opens the release notes page', async () => {
    const opened: string[] = [];
    await new UpdateUI(host(opened)).whatsNew();
    expect(opened).toEqual([RELEASES_PAGE]);
  });
  it('the start-up path uses the note, and Help has the command', () => {
    const main = src('src/main.ts');
    expect(main).toContain('setTimeout(() => void updates.whatsNewNote(before, now), 2500);');
    expect(main).toContain("'whats-new': () => void updates.whatsNew(),");
    expect(src('index.html')).toContain('data-cmd="whats-new"');
  });
});
