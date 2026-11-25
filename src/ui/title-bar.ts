// The window's title bar (desktop app only). By default the system's title bar is taken away and
// its buttons (minimise, maximise, close) sit at the right end of the menu bar, which also moves
// the window when dragged by an empty part and maximises it on a double-click, so the program
// gains a row of height. View > Window and Colours > Title Bar in Menu Row puts the system's title bar back.

import { isTauri } from '@tauri-apps/api/core';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { setModalTitleStrip, setOffScreen } from './modal-guard';

/** Where the window's title and buttons are: in the menu row ('app') or the system's own bar. */
export type TitleBarPlace = 'app' | 'system';

const svg = (body: string) => `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">${body}</svg>`;
const ICONS = {
  min: svg('<path d="M0 5.5h10"/>'),
  max: svg('<rect x="0.5" y="0.5" width="9" height="9"/>'),
  restore: svg('<rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/>'),
  close: svg('<path d="M0.5 0.5l9 9M9.5 0.5l-9 9"/>'),
};

let controls: HTMLElement | null = null;
let place: TitleBarPlace = 'system';

/** A set of the window's buttons: Minimize, Maximize (Restore Down when maximized) and Close. */
function makeWindowButtons(): { box: HTMLElement; showMax: () => Promise<void> } {
  const w = getCurrentWindow();
  const box = document.createElement('div');
  box.className = 'win-controls';
  const button = (cls: string, label: string, icon: string, act: () => Promise<unknown>) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `win-btn ${cls}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', () => { act().catch(() => {}); });
    box.append(b);
    return b;
  };
  button('win-min', 'Minimize', ICONS.min, () => w.minimize());
  const max = button('win-max', 'Maximize', ICONS.max, () => w.toggleMaximize().then(() => showMax()));
  // closing asks about unsaved work as the system's close button does (onCloseRequested)
  button('win-close', 'Close', ICONS.close, () => w.close());
  const showMax = async () => {
    const big = await w.isMaximized().catch(() => false);
    max.innerHTML = big ? ICONS.restore : ICONS.max;
    max.title = big ? 'Restore Down' : 'Maximize';
    max.setAttribute('aria-label', max.title);
  };
  void showMax();
  return { box, showMax };
}

/** The window buttons in the menu bar, made the first time they are needed. */
function windowButtons(header: HTMLElement): HTMLElement {
  if (controls) return controls;
  const { box, showMax } = makeWindowButtons();
  void getCurrentWindow().onResized(() => { void showMax(); });
  header.append(box);
  controls = box;
  return box;
}

/**
 * A modal window's copy of the title strip. A modal window makes the rest of the page inert, the
 * menu bar's buttons and the strip that moves the program with it, so each modal window carries
 * its own copy at the top of the program (src/ui/modal-guard.ts).
 */
function modalStrip(): HTMLElement {
  const strip = document.createElement('div');
  strip.setAttribute('data-tauri-drag-region', '');
  const { box } = makeWindowButtons();
  // (in the menu bar's own colors: a window sets its own colors for what is inside it)
  const header = document.querySelector('header');
  if (header) {
    const cs = getComputedStyle(header);
    box.style.backgroundColor = cs.backgroundColor;
    box.style.color = cs.color;
  }
  strip.append(box);
  return strip;
}

/** How tall the menu bar is, for the modal windows' title strip. */
function stripHeight(header: HTMLElement): number {
  const h = header.getBoundingClientRect().height;
  return h > 0 ? Math.min(h, 40) : 32;
}

/**
 * Tell the modal windows how much of the program is off the screen, so they open in the part that
 * is on it. Checked when the program is moved, resized or moved to a screen with another scale.
 */
let watchingScreen = false;
function watchScreen(): void {
  if (watchingScreen) return;
  watchingScreen = true;
  const w = getCurrentWindow();
  let timer = 0;
  const measure = async () => {
    try {
      const [pos, size, mon] = await Promise.all([w.innerPosition(), w.innerSize(), currentMonitor()]);
      if (!mon || !size.width || !size.height) { setOffScreen(null); return; }
      // (CSS pixels per physical pixel: the screen's scale and View > Interface Size both count)
      const k = window.innerWidth / size.width;
      const area = mon.workArea ?? { position: mon.position, size: mon.size };
      const ax = area.position.x, ay = area.position.y;
      setOffScreen({
        top: Math.max(0, ay - pos.y) * k,
        left: Math.max(0, ax - pos.x) * k,
        bottom: Math.max(0, pos.y + size.height - (ay + area.size.height)) * k,
        right: Math.max(0, pos.x + size.width - (ax + area.size.width)) * k,
      });
    } catch { setOffScreen(null); }
  };
  const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void measure(), 120); };
  void w.onMoved(soon).catch(() => {});
  void w.onResized(soon).catch(() => {});
  void w.onScaleChanged(soon).catch(() => {});
  void measure();
}

/** Put the title bar where it goes. Only the desktop app has one; the web page leaves it alone. */
export async function placeTitleBar(where: TitleBarPlace): Promise<void> {
  place = where;
  const header = document.querySelector('header');
  document.querySelector('[data-cmd="title-bar-in-menu"]')?.setAttribute('aria-checked', String(where === 'app'));
  if (!isTauri() || !header) return;
  const own = where === 'app';
  document.body.classList.toggle('own-title-bar', own);
  // the empty parts of the menu bar (and the program's name, and the tabs' row) move the window
  for (const el of [header, header.querySelector('h1.app-name'), document.querySelector('#tabs')]) {
    if (!el) continue;
    if (own) el.setAttribute('data-tauri-drag-region', '');
    else el.removeAttribute('data-tauri-drag-region');
  }
  windowButtons(header).hidden = !own;
  setModalTitleStrip(own ? modalStrip : null, own ? stripHeight(header) : 0);
  watchScreen();
  await getCurrentWindow().setDecorations(!own).catch(() => {});
}

export const titleBarPlace = (): TitleBarPlace => place;
