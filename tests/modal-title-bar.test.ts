// @vitest-environment jsdom
// Nate (2026-11-25): with the bottom half of the program off the screen, opening the Orbital window
// left no way to close it: the window covered the program's own title bar, so neither the Close
// button nor the strip that moves the program could be clicked, and the window's own buttons were
// below the screen's edge. A window opened with showModal() makes the rest of the page inert, the
// title bar in the menu row with it. Every modal window now carries its own title strip and is
// placed inside the part of the program that is on the screen (src/ui/modal-guard.ts).

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Guard = typeof import('../src/ui/modal-guard');
let g: Guard;

beforeAll(async () => {
  // jsdom has no showModal: a stand-in that opens the window as the browser's would
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
  g = await import('../src/ui/modal-guard');
  g.installModalGuard();
});

afterEach(() => {
  for (const d of document.querySelectorAll('dialog')) d.close();
  document.body.replaceChildren();
  g.setModalTitleStrip(null);
  g.setOffScreen(null);
});

function modal(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.innerHTML = '<h2>Orbital</h2><p class="ask-buttons"><button>Cancel</button><button>OK</button></p>';
  document.body.append(d);
  d.showModal();
  return d;
}

/** A title strip as title-bar.ts makes it: the window buttons in a strip that moves the program. */
function strip(): HTMLElement {
  const s = document.createElement('div');
  s.setAttribute('data-tauri-drag-region', '');
  s.innerHTML = '<div class="win-controls"><button class="win-close" aria-label="Close"></button></div>';
  return s;
}

describe('modal windows and the title bar', () => {
  it('a modal window carries its own title strip, so the Close button and drag strip still work', () => {
    g.setModalTitleStrip(strip, 32);
    const d = modal();
    const s = d.querySelector('.modal-title-strip');
    expect(s).not.toBeNull();
    expect(s!.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(s!.querySelector('[aria-label="Close"]')).not.toBeNull();
    d.close();
    expect(d.querySelector('.modal-title-strip')).toBeNull();
  });

  it('a window already open gets the strip when the title bar moves into the menu row', () => {
    const d = modal();
    expect(d.querySelector('.modal-title-strip')).toBeNull();
    g.setModalTitleStrip(strip, 32);
    expect(d.querySelectorAll('.modal-title-strip')).toHaveLength(1);
    g.setModalTitleStrip(null);
    expect(d.querySelector('.modal-title-strip')).toBeNull();
  });

  it('a window that is only shown (not modal) gets no strip: the page stays usable around it', () => {
    g.setModalTitleStrip(strip, 32);
    const d = document.createElement('dialog');
    document.body.append(d);
    d.setAttribute('open', '');
    expect(d.querySelector('.modal-title-strip')).toBeNull();
  });

  it('modal windows open below the title strip', () => {
    g.setModalTitleStrip(strip, 32);
    expect(g.dialogRoom().top).toBe(32);
    expect(document.documentElement.style.getPropertyValue('--dlg-top')).toBe('32px');
  });

  it('with the bottom of the program off the screen, a window fits in the part on the screen', () => {
    // (jsdom's window is 1024 × 768)
    const h = window.innerHeight;
    // (the window's own cap, as app.css gives windows: here a little less than the page)
    const style = document.createElement('style');
    style.textContent = `dialog { max-height: ${h - 100}px; }`;
    document.head.append(style);
    g.setModalTitleStrip(strip, 32);
    g.setOffScreen({ top: 0, right: 0, bottom: h / 2, left: 0 });
    const d = modal();
    expect(g.dialogRoom()).toMatchObject({ top: 32, bottom: h / 2 });
    expect(document.documentElement.style.getPropertyValue('--dlg-bottom')).toBe(`${h / 2}px`);
    const max = parseFloat(d.style.maxHeight);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(h - 32 - h / 2);
    // back on the screen: the window's height is its own again
    g.setOffScreen(null);
    expect(d.style.maxHeight).toBe('');
    style.remove();
  });

  it('a window that sets its own height keeps it', () => {
    const d = document.createElement('dialog');
    d.style.maxHeight = '200px';
    document.body.append(d);
    g.setOffScreen({ top: 0, right: 0, bottom: window.innerHeight / 2, left: 0 });
    d.showModal();
    expect(d.style.maxHeight).toBe('200px');
  });

  it('with nearly all of the program off the screen, a window still keeps a usable height, heading first', () => {
    const h = window.innerHeight;
    g.setModalTitleStrip(strip, 32);
    g.setOffScreen({ top: 0, right: 0, bottom: h - 50, left: 0 });
    const r = g.dialogRoom();
    expect(h - r.top - r.bottom).toBeGreaterThanOrEqual(160);
    expect(r.top).toBe(32);
  });

  it('the styles place every modal window in its room, and draw the strip at the top of the program', () => {
    const css = readFileSync(resolve('src/app.css'), 'utf8');
    expect(css).toMatch(/dialog:modal\s*\{[^}]*inset:\s*var\(--dlg-top/);
    expect(css).toMatch(/\.modal-title-strip\s*\{[^}]*position:\s*fixed;[^}]*top:\s*0/);
    // a window placed by its own rule must not go above the room's top either
    const own = [...css.matchAll(/^dialog[^{]*\{[^}]*\binset:[^;]*;/gm)].map((m) => m[0]);
    expect(own.length).toBeGreaterThan(0);
    for (const rule of own) expect(rule, rule.slice(0, 60)).toMatch(/var\(--dlg-top/);
  });

  it('the desktop title bar gives modal windows the strip, and the guard loads before anything else', () => {
    const tb = readFileSync(resolve('src/ui/title-bar.ts'), 'utf8');
    expect(tb).toMatch(/setModalTitleStrip\(own \? modalStrip/);
    expect(tb).toMatch(/function modalStrip[\s\S]*data-tauri-drag-region[\s\S]*makeWindowButtons\(\)/);
    expect(tb).toMatch(/setOffScreen\(/);
    const main = readFileSync(resolve('src/main.ts'), 'utf8');
    const first = main.match(/^import .*$/m)?.[0];
    expect(first).toBe("import './ui/modal-guard';");
  });
});
