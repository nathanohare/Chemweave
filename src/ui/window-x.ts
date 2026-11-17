// One way to close every window: an × at the top right of its title row, and Esc. (UI audit
// 2026-11-16, U12: some windows had an ×, some only a Close button in the bottom row.)

/** Add the × to a window's title row; Esc closes the window too, whether or not it is modal. */
export function addCloseX(d: HTMLDialogElement, head: HTMLElement, close: () => void = () => d.close()): HTMLButtonElement {
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'win-x';
  x.title = 'Close (Esc)';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '×';
  x.addEventListener('click', () => close());
  head.append(x);
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // (a list or tip the window opened closes first; a modal window's own Esc is the browser's)
    if ((e.target as Element | null)?.closest?.('.menu, .info-pop')) return;
    e.preventDefault();
    close();
  });
  return x;
}
