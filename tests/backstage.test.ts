// @vitest-environment jsdom
//
// The File tab (src/ui/backstage.ts): with the menu bar off, a File tab leads each ribbon's tabs and
// opens a page with the menus down the left; the chosen menu shows on the right, Esc closes it and
// the keys go back to where they were.
import { describe, expect, it, vi } from 'vitest';
import { Backstage, addFileTabs, fileTabs } from '../src/ui/backstage';

function ribbons(): void {
  document.body.innerHTML = `
    <header><button id="work">work</button></header>
    <div class="ribbon"><div class="rb-tabs"><div class="rb-tablist" role="tablist"><button role="tab">Home</button></div></div></div>
    <div class="ribbon"><div class="rb-tabs"><div class="rb-tablist" role="tablist"><button role="tab">Home</button></div></div></div>`;
}

describe('the File tab', () => {
  it('leads every ribbon\'s tabs once, outside the tab list', () => {
    ribbons();
    const open = vi.fn();
    addFileTabs(open);
    addFileTabs(open);
    const tabs = fileTabs();
    expect(tabs).toHaveLength(2);
    for (const b of tabs) {
      expect(b.textContent).toBe('File');
      expect(b.parentElement!.firstElementChild).toBe(b);
      expect(b.closest('[role="tablist"]')).toBeNull();
      expect(b.getAttribute('role')).toBeNull();
    }
    tabs[1].click();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens on a menu, moves between menus, and closes with Esc back to where the keys were', () => {
    ribbons();
    addFileTabs(() => {});
    const shown: number[] = [];
    const closed = vi.fn();
    const bs = new Backstage({ menus: () => [{ name: 'File' }, { name: 'Edit' }, { name: 'Help' }], show: (i) => shown.push(i), closed });
    const work = document.getElementById('work')!;
    work.focus();
    expect(bs.isOpen).toBe(false);
    bs.openAt(1, false);
    expect(bs.isOpen).toBe(true);
    expect(bs.current).toBe(1);
    expect(shown).toEqual([1]);
    expect(document.body.classList.contains('backstage-open')).toBe(true);
    for (const b of fileTabs()) expect(b.getAttribute('aria-expanded')).toBe('true');
    const nav = [...bs.el.querySelectorAll<HTMLButtonElement>('nav button[data-i]')];
    expect(nav.map((b) => b.textContent)).toEqual(['File', 'Edit', 'Help']);
    expect(nav[1].getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(nav[1]);
    // the arrow keys go down the list, showing each menu
    nav[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(bs.current).toBe(2);
    // a click on a name shows that menu
    bs.el.querySelector<HTMLButtonElement>('nav button[data-i="0"]')!.click();
    expect(bs.current).toBe(0);
    expect(shown).toEqual([1, 2, 0]);
    // Esc on the list closes the page, and the keys go back
    bs.el.querySelector<HTMLButtonElement>('nav button[data-i="0"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(bs.isOpen).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(work);
    expect(document.body.classList.contains('backstage-open')).toBe(false);
    for (const b of fileTabs()) expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes from its back button, and only once', () => {
    ribbons();
    const closed = vi.fn();
    const bs = new Backstage({ menus: () => [{ name: 'File' }], show: () => {}, closed });
    bs.openAt(0, false);
    bs.el.querySelector<HTMLButtonElement>('.bs-back')!.click();
    bs.close();
    expect(bs.isOpen).toBe(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('writes menu names as text', () => {
    ribbons();
    const bs = new Backstage({ menus: () => [{ name: '<img src=x onerror=alert(1)>' }], show: () => {}, closed: () => {} });
    bs.openAt(0, false);
    expect(bs.el.querySelector('img')).toBeNull();
  });
});

describe('the File tab\'s list of menus from the keyboard', () => {
  it('keeps the keys on the list as Down and Up move through it', () => {
    ribbons();
    const bs = new Backstage({ menus: () => [{ name: 'File' }, { name: 'Edit' }, { name: 'View' }], show: () => {}, closed: () => {} });
    bs.openAt(0, false);
    const at = () => (document.activeElement as HTMLElement).textContent;
    expect(at()).toBe('File');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(at()).toBe('Edit');
    expect(bs.current).toBe(1);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(at()).toBe('View');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(at()).toBe('Edit');
    expect(bs.el.querySelector('[aria-current="page"]')!.textContent).toBe('Edit');
  });

  it('puts what is under it out of the keys\' reach while it shows, and gives it back', () => {
    ribbons();
    const work = document.createElement('main');
    document.body.append(work);
    const bs = new Backstage({ menus: () => [{ name: 'File' }], show: () => {}, closed: () => {} });
    bs.openAt(0, false);
    expect(work.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('header')!.hasAttribute('inert')).toBe(false);
    expect(bs.el.getAttribute('role')).toBe('dialog');
    bs.close();
    expect(work.hasAttribute('inert')).toBe(false);
  });
});
