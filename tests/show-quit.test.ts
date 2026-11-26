// @vitest-environment jsdom
//
// A slide show takes every key, but not the Mac's own ⌘Q and ⌘H: a key the page takes never
// reaches the app menu, so ⌘Q during a full-screen show did nothing (found on macOS 12). And
// ending a show for a quit waits for what it asks as it ends, before the question about unsaved
// work.

import { describe, it, expect } from 'vitest';
import { Presenter, systemShortcut } from '../src/ui/present';
import { PresenterView } from '../src/ui/presenter-view';

const key = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}, code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '') =>
  ({ key, code, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('keys a slide show lets through', () => {
  it('lets ⌘Q and ⌘H through', () => {
    expect(systemShortcut(key('q', { metaKey: true }))).toBe(true);
    expect(systemShortcut(key('Q', { metaKey: true }))).toBe(true);
    expect(systemShortcut(key('h', { metaKey: true }))).toBe(true);
    // a Russian layout: the Q key types й, and the Mac's menu still quits
    expect(systemShortcut(key('й', { metaKey: true }, 'KeyQ'))).toBe(true);
  });

  it("keeps the show's own keys, and Ctrl+Q", () => {
    for (const k of ['q', 'h', 'n', 'p', 'b', 'Escape', ' ']) expect(systemShortcut(key(k)), k).toBe(false);
    expect(systemShortcut(key('q', { ctrlKey: true }))).toBe(false);
    expect(systemShortcut(key('q', { metaKey: true, ctrlKey: true }))).toBe(false);
    // ⌥⌘H (Hide Others) is not the app's own
    expect(systemShortcut(key('h', { metaKey: true, altKey: true }))).toBe(false);
    // a layout where the Q key types another Latin letter (AZERTY: A): that letter counts, not the place
    expect(systemShortcut(key('a', { metaKey: true }, 'KeyQ'))).toBe(false);
  });
});

describe('ending a show before quitting', () => {
  it('finishes at once when no show is running', async () => {
    // (jsdom has no ResizeObserver; the presenter view makes one for its slide)
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    await expect(new Presenter().finish()).resolves.toBeUndefined();
    await expect(new PresenterView().finish()).resolves.toBeUndefined();
  });
});
