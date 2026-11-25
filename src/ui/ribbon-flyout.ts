// Ribbon buttons that drop a short list of commands below them, as Office's do: a dropdown
// (Media ▾ holding Picture, Video and Audio) or a split button (New Slide, whose arrow picks the
// new slide's layout). The commands in the list are the ribbon's own buttons, kept inside the
// ribbon, so a click on one runs it exactly as it ran before it moved into the list.
//
//   <div class="rb-fly">
//     <button class="rb-big rb-fly-btn" data-ic="media-menu">…Media ▾</button>   (or, for a split
//     <div class="rb-fly-menu" role="menu" hidden>…the ribbon's buttons…</div>      button, the main
//   </div>                                                                          button, then a
//                                                                                   .rb-fly-btn arrow)

let openMenu: HTMLElement | null = null;

function close(): void {
  if (!openMenu) return;
  openMenu.hidden = true;
  openMenu.parentElement?.querySelector(':scope > .rb-fly-btn')?.setAttribute('aria-expanded', 'false');
  openMenu = null;
}

function show(menu: HTMLElement, by: HTMLElement): void {
  close();
  const r = (by.closest('.rb-fly') ?? by).getBoundingClientRect();
  menu.dispatchEvent(new CustomEvent('rb-fly-open')); // a gallery fills itself with the choices as they are now
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${r.bottom + 2}px`;
  by.setAttribute('aria-expanded', 'true');
  openMenu = menu;
  menu.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
}

/**
 * Where an arrow key goes in a list or a pane of pictures (`grid`): in a list, up and down, round
 * from the ends; in a grid, left and right along the reading order, and up and down to the picture
 * nearest above or below. Home and End go to the first and last. Null: the key does nothing here.
 */
export function moveIn(items: HTMLElement[], at: number, key: string, grid: boolean): number | null {
  const n = items.length;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (at < 0) return key === 'ArrowUp' || key === 'ArrowLeft' ? n - 1 : 0;
  if (!grid) {
    if (key === 'ArrowDown') return (at + 1) % n;
    if (key === 'ArrowUp') return (at + n - 1) % n;
    return null;
  }
  if (key === 'ArrowRight') return (at + 1) % n;
  if (key === 'ArrowLeft') return (at + n - 1) % n;
  // the nearest picture in the next row up or down (by where each sits on the screen)
  const here = items[at].getBoundingClientRect();
  const cx = here.left + here.width / 2;
  const down = key === 'ArrowDown';
  let best: number | null = null, score = Infinity;
  items.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    const dy = down ? r.top - here.bottom : here.top - r.bottom;
    if (i === at || dy < -1) return;
    const s = dy * 1000 + Math.abs(r.left + r.width / 2 - cx);
    if (s < score) { score = s; best = i; }
  });
  return best ?? (down ? 0 : n - 1);
}

/** Wire every ribbon dropdown and split button (once, for the whole page). */
export function installRibbonFlyouts(): void {
  for (const b of document.querySelectorAll<HTMLElement>('.rb-fly-btn')) {
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('.rb-fly-btn');
    if (btn) {
      const menu = btn.parentElement?.querySelector<HTMLElement>(':scope > .rb-fly-menu');
      if (menu) {
        e.stopPropagation();
        if (menu === openMenu) close();
        else show(menu, btn);
      }
      return;
    }
    // a command in the list has run (the ribbon heard the click first): the list closes
    if (openMenu && (t.closest('.rb-fly-menu') === openMenu ? t.closest('button') : true)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!openMenu) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      const by = openMenu.parentElement?.querySelector<HTMLElement>(':scope > .rb-fly-btn');
      close();
      by?.focus();
      e.stopPropagation();
      // (Tab: back to the button, as Esc, rather than lost with the closed list)
      e.preventDefault();
    } else if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const items = [...openMenu.querySelectorAll<HTMLElement>('button:not([disabled])')];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = moveIn(items, at, e.key, openMenu.hasAttribute('data-grid'));
      if (next === null) return;
      items[next]?.focus();
      e.preventDefault();
    }
  }, true);
  addEventListener('resize', close);
}
