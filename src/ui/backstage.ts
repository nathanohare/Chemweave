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
  /**
   * The desktop app's window buttons and the strip that moves the window, for the top of the page
   * while there is no title row to show them (title-bar.ts), or null.
   */
  titleStrip?(): HTMLElement | null;
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
  /** What it made inert while it shows, to give back. */
  private inerted: HTMLElement[] = [];
  /** Where the keys were before it opened, to go back to. */
  private before: HTMLElement | null = null;

  constructor(private hooks: BackstageHooks) {
    this.el = document.createElement('div');
    this.el.id = 'backstage';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'File');
    this.el.setAttribute('aria-modal', 'true');
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
        if (n.dataset.i) this.openAt(Number(n.dataset.i), false, true);
        // (by its place: the list may have been drawn again)
        this.nav.querySelectorAll<HTMLButtonElement>('button')[items.indexOf(n)]?.focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const n = e.key === 'Home' ? 1 : items.length - 1;
        this.openAt(Number(items[n].dataset.i), false);
      } else if (e.key === 'ArrowRight' && i > 0) {
        e.preventDefault();
        this.openAt(this.current, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    // the page follows the title row if its height changes (the window narrower, the interface larger)
    addEventListener('resize', () => { if (this.isOpen) this.place(); });
    // a part of the window, beside the title row (not a pop-up: it never opens over a window)
    const header = document.querySelector('header');
    if (header) header.after(this.el); else document.querySelector('main, #app')?.before(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Open (or move to) menu `i`'s page. `focusPage` puts the keys on its first command; `keepNav` leaves them on the list. */
  openAt(i: number, focusPage: boolean, keepNav = false): void {
    if (!this.isOpen) {
      const a = document.activeElement as HTMLElement | null;
      this.before = a && a !== document.body && !this.el.contains(a) ? a : null;
      this.place();
      // (no title row showing: the desktop app's window buttons come with the page, as with a modal window)
      const strip = this.hooks.titleStrip?.() ?? null;
      if (strip) { strip.classList.add('modal-title-strip', 'bs-strip'); this.el.prepend(strip); }
      this.el.classList.toggle('has-strip', !!strip);
      this.el.hidden = false;
      // what is under the page is out of the keys' reach (Tab stays in the page and the title row)
      this.inerted = [...document.body.children].filter((c): c is HTMLElement =>
        c instanceof HTMLElement && c !== this.el && c.tagName !== 'HEADER' && c.tagName !== 'DIALOG' && c.tagName !== 'SCRIPT' && !c.hasAttribute('inert') && !c.matches('.menu, .context-menu, .popup-menu, #flash, [role="status"], [aria-live]'));
      for (const c of this.inerted) c.setAttribute('inert', '');
      document.body.classList.add('backstage-open');
      for (const b of fileTabs()) b.setAttribute('aria-expanded', 'true');
    }
    const menus = this.hooks.menus();
    this.cur = Math.max(0, Math.min(i, menus.length - 1));
    this.drawNav(menus);
    this.hooks.show(this.current, focusPage);
    if (!focusPage && !keepNav) this.nav.querySelector<HTMLButtonElement>(`button[data-i="${this.current}"]`)?.focus();
  }

  /** The page starts under the title row, over the ribbon and the work, as Office's does (at the top of the window when there is no title row). */
  private place(): void {
    const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    document.documentElement.style.setProperty('--bs-top', `${Math.round(top)}px`);
  }

  /** Put the keys on the list of menus, at the menu showing. */
  focusNav(): void {
    this.nav.querySelector<HTMLButtonElement>(`button[data-i="${this.current}"]`)?.focus();
  }

  close(restore = true): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.el.querySelector(':scope > .bs-strip')?.remove();
    this.el.classList.remove('has-strip');
    for (const c of this.inerted) c.removeAttribute('inert');
    this.inerted = [];
    document.body.classList.remove('backstage-open');
    for (const b of fileTabs()) b.setAttribute('aria-expanded', 'false');
    this.cur = -1;
    this.hooks.closed();
    const back = this.before;
    this.before = null;
    if (restore && back?.isConnected) back.focus();
  }

  private drawNav(menus: { name: string }[]): void {
    // the names are written only when they change (Developer comes and goes), so the focus stays on its button
    const names = menus.map((m) => m.name).join('\n');
    if (this.nav.dataset.names !== names) {
      this.nav.dataset.names = names;
      const back = `<button type="button" class="bs-back" title="Back (Esc)" aria-label="Back">${BACK}</button>`;
      this.nav.innerHTML = back + menus.map((m, i) => `<button type="button" data-i="${i}">${esc(m.name)}</button>`).join('');
    }
    for (const b of this.nav.querySelectorAll<HTMLButtonElement>('button[data-i]')) {
      if (Number(b.dataset.i) === this.cur) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
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
