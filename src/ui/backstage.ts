// The File tab (Office's Backstage view): with the menu bar off (View ▸ Window and Colors ▸ Menu
// Bar, off to start with in the web app), a File tab leads each ribbon's tabs. It opens a page over
// the ribbon and the work, with the menus' names down the left (File, Edit, View, Insert, Format,
// Chemistry, Help) and the chosen menu's commands on the right. The menus are the menu bar's own:
// main.ts moves the chosen menu into the page (`.bs-page`) while it shows and back after,
// so its commands, ticks, greying and keys are the menu bar's own. This file draws the page around it.

export interface BackstageHooks {
  /** The menus to list, in order (Developer only while Developer Tools are on). */
  menus(): { name: string }[];
  /** Show menu `i`'s commands as the page; `focus` puts the keys on its first command. */
  show(i: number, focus: boolean): void;
  /** The page has closed (put the menus back as they were). */
  closed(): void;
}

const BACK = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13 8H3.5M7.5 4 3.5 8l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export class Backstage {
  readonly el: HTMLElement;
  private nav: HTMLElement;
  /** Where the chosen menu shows (it scrolls when the menu is longer than the window). */
  readonly pane: HTMLElement;
  private cur = -1;
  /** The menu showing (-1 when closed). */
  get current(): number { return this.cur; }
  /** Where the keys were before it opened, to go back to. */
  private before: HTMLElement | null = null;

  constructor(private hooks: BackstageHooks) {
    this.el = document.createElement('div');
    this.el.id = 'backstage';
    this.el.hidden = true;
    this.nav = document.createElement('nav');
    this.nav.className = 'bs-nav';
    this.nav.setAttribute('aria-label', 'File');
    this.pane = document.createElement('div');
    this.pane.className = 'bs-pane';
    this.el.append(this.nav, this.pane);
    this.nav.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!b) return;
      if (b.classList.contains('bs-back')) this.close();
      else this.openAt(Number(b.dataset.i), false);
    });
    this.nav.addEventListener('keydown', (e) => {
      const items = [...this.nav.querySelectorAll<HTMLButtonElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        n.focus();
        if (n.dataset.i) this.openAt(Number(n.dataset.i), false, true);
      } else if (e.key === 'ArrowRight' && i > 0) {
        e.preventDefault();
        this.openAt(this.current, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    document.body.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open (or move to) menu `i`'s page. `focusPage` puts the keys on its first command; `keepNav` leaves them on the list. */
  openAt(i: number, focusPage: boolean, keepNav = false): void {
    if (!this.isOpen) {
      const a = document.activeElement as HTMLElement | null;
      this.before = a && a !== document.body && !this.el.contains(a) ? a : null;
      // the page starts under the title row, over the ribbon and the work, as Office's does
      const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
      document.documentElement.style.setProperty('--bs-top', `${Math.round(top)}px`);
      this.el.hidden = false;
      document.body.classList.add('backstage-open');
      for (const b of fileTabs()) b.setAttribute('aria-expanded', 'true');
    }
    const menus = this.hooks.menus();
    this.cur = Math.max(0, Math.min(i, menus.length - 1));
    this.drawNav(menus);
    this.hooks.show(this.current, focusPage);
    if (!focusPage && !keepNav) this.nav.querySelector<HTMLButtonElement>(`button[data-i="${this.current}"]`)?.focus();
  }

  /** Put the keys on the list of menus, at the menu showing. */
  focusNav(): void {
    this.nav.querySelector<HTMLButtonElement>(`button[data-i="${this.current}"]`)?.focus();
  }

  close(restore = true): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    document.body.classList.remove('backstage-open');
    for (const b of fileTabs()) b.setAttribute('aria-expanded', 'false');
    this.cur = -1;
    this.hooks.closed();
    const back = this.before;
    this.before = null;
    if (restore && back?.isConnected) back.focus();
  }

  private drawNav(menus: { name: string }[]): void {
    const back = `<button type="button" class="bs-back" title="Back (Esc)" aria-label="Back">${BACK}</button>`;
    const html = back + menus.map((m, i) => `<button type="button" data-i="${i}"${i === this.current ? ' aria-current="page"' : ''}>${esc(m.name)}</button>`).join('');
    if (this.nav.innerHTML !== html) this.nav.innerHTML = html;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The File tab at the start of every ribbon's tabs (made once for each ribbon). */
export function addFileTabs(open: () => void): void {
  for (const row of document.querySelectorAll<HTMLElement>('.ribbon > .rb-tabs')) {
    if (row.querySelector(':scope > .rb-file')) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rb-file';
    b.textContent = 'File';
    b.title = 'File: New, Open, Save, Export and Print, and every menu (Alt+F)';
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', open);
    row.prepend(b);
  }
}

export function fileTabs(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.ribbon > .rb-tabs > .rb-file')];
}
