// @vitest-environment jsdom
//
// With View ▸ Window and Colors ▸ Title Bar in Menu Bar on, the empty parts of the menu bar move
// the window. On a Mac (2026-11-26) most gaps did nothing: a bare data-tauri-drag-region works
// only where that element itself is clicked, and the gaps belong to the groups inside the row (the
// menus, the Quick Access Toolbar, the open files' strip). The rows now use "deep", and the menus
// that drop down from the bar opt out.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const invoked: [string, unknown][] = [];
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async (cmd: string, args: unknown) => { invoked.push([cmd, args]); } }));
vi.mock('@tauri-apps/api/window', () => {
  const none = async () => () => {};
  const w = {
    setDecorations: async () => {}, isMaximized: async () => false, onResized: none, onMoved: none, onScaleChanged: none,
    innerPosition: async () => ({ x: 0, y: 0 }), innerSize: async () => ({ width: 0, height: 0 }),
    minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {},
  };
  return { getCurrentWindow: () => w, availableMonitors: async () => [] };
});

/**
 * Tauri's own test (copied as it is there, including its list of interactive roles, which is what
 * keeps a background file tab, a div with role="tab" and tabindex -1, clickable) of whether a mousedown moves the window: isDragRegion in
 * crates/tauri/src/window/scripts/drag.js at tag tauri-v2.12.3 (the version in Cargo.lock),
 * https://github.com/tauri-apps/tauri/blob/tauri-v2.12.3/crates/tauri/src/window/scripts/drag.js
 */
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);
function isClickable(el: HTMLElement): boolean {
  return CLICKABLE_TAGS.has(el.tagName)
    || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
    || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
    || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '');
}
function movesWindow(target: Element): boolean {
  const path: Element[] = [];
  for (let e: Element | null = target; e; e = e.parentElement) path.push(e);
  for (const el of path) {
    if (!(el instanceof HTMLElement)) continue;
    const attr = el.getAttribute('data-tauri-drag-region');
    if (isClickable(el) && attr === null) return false;
    if (attr === null) continue;
    if (attr === 'false') return false;
    if (attr === 'deep') return true;
    if (attr === '' || attr === 'true') return el === path[0];
  }
  return false;
}

let header: HTMLElement;
beforeAll(async () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<header'), html.indexOf('</header>') + '</header>'.length);
  header = document.querySelector('header')!;
  // the open files' strip, as main.ts fills #tabs: a strip holding tabs, then its buttons
  document.querySelector('#tabs')!.innerHTML = '<div class="tab-strip"><div class="tab" role="tab" tabindex="-1"><span class="tab-name">A</span><span class="tab-close">×</span></div></div><button class="tab-add">+</button>';
  document.querySelector('#quick-bar')!.innerHTML = '<button>Save</button>';
  const { placeTitleBar } = await import('../src/ui/title-bar');
  await placeTitleBar('app');
});

describe('Title Bar in Menu Bar: what moves the window', () => {
  it('the gaps between the menus, the Quick Access Toolbar and the open files move it', () => {
    for (const sel of ['.sep', '.menu-wrap', '#quick-bar', '#tabs', '.tab-strip', 'h1.app-name']) {
      expect(movesWindow(header.querySelector(sel)!), sel).toBe(true);
    }
    expect(movesWindow(header)).toBe(true);
  });

  it('controls do not: menu names, toolbar buttons, the tabs and their close marks, the window buttons', () => {
    for (const sel of ['#btn-file', '#quick-bar button', '.tab', '.tab-close', '.tab-add', '#btn-search', '.win-controls button']) {
      const el = header.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(movesWindow(el!), sel).toBe(false);
    }
  });

  it('nor do the gaps and lines inside a menu that drops down from the bar', () => {
    const menu = header.querySelector('#file-menu')!;
    expect(movesWindow(menu)).toBe(false);
    expect(movesWindow(menu.querySelector('hr') ?? menu.querySelector('.submenu')!)).toBe(false);
  });

  it('turning it off takes all of it away', async () => {
    const { placeTitleBar } = await import('../src/ui/title-bar');
    await placeTitleBar('system');
    expect(header.querySelectorAll('[data-tauri-drag-region]').length).toBe(0);
    await placeTitleBar('app');
  });
});

describe('Title Bar in Menu Bar on a Mac', () => {
  it("keeps the Mac's own buttons at the left: no drawn buttons, room at the left, the system's title bar styled over the page", async () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const { placeTitleBar } = await import('../src/ui/title-bar');
      invoked.length = 0;
      await placeTitleBar('app');
      expect(document.body.classList.contains('mac-lights')).toBe(true);
      expect(header.classList.contains('lights-row')).toBe(true);
      expect((header.querySelector('.win-controls') as HTMLElement).hidden).toBe(true);
      expect(invoked).toContainEqual(['mac_title_bar', { own: true }]);
      // the gaps still move the window
      expect(movesWindow(header.querySelector('.sep')!)).toBe(true);
      await placeTitleBar('system');
      expect(document.body.classList.contains('mac-lights')).toBe(false);
      expect(header.classList.contains('lights-row')).toBe(false);
      expect(invoked).toContainEqual(['mac_title_bar', { own: false }]);
    } finally {
      delete (navigator as { platform?: string }).platform;
      if (platform) Object.defineProperty(Navigator.prototype, 'platform', platform);
    }
  });
});
