// A small menu at a point (a sheet's or document's right-click menus, a gallery card's menu).

import { popupHost } from './popup-host';

/** Takes the menu showing now away, with everything it listens to. */
let dismissShown: (() => void) | null = null;

/** Takes the pop-up menu showing now away, with the keys and resizes it listens to (for a gallery that opens in its place). */
export function dismissPopupMenu(): void {
  dismissShown?.();
  document.querySelector('.popup-menu')?.remove();
}

/** A small menu at a point: [label, action, enabled?] items, null for a line. */
export function popupMenu(x: number, y: number, items: ([string, () => void, boolean?, string?] | null)[]): HTMLDivElement {
  dismissPopupMenu();
  // where the keys went before (a document's caret, a sheet's cell): Escape goes back there
  const back = document.activeElement;
  const m = document.createElement('div');
  m.className = 'menu popup-menu';
  m.setAttribute('role', 'menu');
  for (const it of items) {
    if (!it) { m.append(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = it[0];
    if (it[3]) { const ic = document.createElement('span'); ic.className = 'pm-ic'; ic.innerHTML = it[3]; b.prepend(ic); }
    b.disabled = it[2] === false;
    b.addEventListener('click', () => { dismiss(); it[1](); });
    m.append(b);
  }
  // inside a window open over the page (the top layer), so it shows over that window
  popupHost().append(m);
  // kept inside the window, now and when the window changes size (Interface Size zooms it)
  const place = () => {
    if (!m.isConnected) { removeEventListener('resize', place); return; }
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  };
  place();
  addEventListener('resize', place);
  // (however the menu goes away, it stops listening: a later Escape belongs to whatever the item opened)
  function dismiss(): void {
    m.remove();
    document.removeEventListener('pointerdown', close, true);
    document.removeEventListener('keydown', close, true);
    removeEventListener('resize', place);
    if (dismissShown === dismiss) dismissShown = null;
  }
  dismissShown = dismiss;
  function close(e: Event): void {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    if (e instanceof PointerEvent && m.contains(e.target as Node)) return;
    dismiss();
    if (e instanceof KeyboardEvent) {
      // Escape only closes the menu: it doesn't also reach the page underneath
      e.preventDefault();
      e.stopPropagation();
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    }
  }
  setTimeout(() => {
    if (!m.isConnected) return;
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close, true);
  });
  m.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  m.addEventListener('keydown', (e) => {
    const list = [...m.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  });
  return m;
}
