// @vitest-environment jsdom
//
// The shape of the menu bar in each mode (S42, S85; review of F5, F5b-R01): no menu is so long
// that it scrolls at 1024 × 700 (about 21 rows), long ones are grouped into submenus named after
// the Office ribbon group, no submenu is named after a mode, none holds a single item, and no
// command shows twice in one menu.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSERT_MENU, renderMenu } from '../src/commands/registry';

const MODES = ['drawing', 'slides', 'sheet', 'document', 'design'];
/** The most rows a menu can have and still fit under the menu bar at 1024 × 700 (measured: 21 rows and four lines are 670 px). */
const MOST_ROWS = 21;

function menuBar(): Document {
  const page = new DOMParser().parseFromString(readFileSync(join(__dirname, '../index.html'), 'utf8'), 'text/html');
  renderMenu(page.getElementById('insert-menu')!, INSERT_MENU);
  return page;
}

/** What a mode shows of one menu's items, as tickMenuModes leaves them. */
function shown(menu: Element, mode: string): HTMLElement[] {
  return [...menu.children].filter((c): c is HTMLElement => {
    if (!(c instanceof HTMLElement) || c.tagName === 'HR' || c.hidden) return false;
    if (!c.matches('button, .submenu')) return false;
    const modes = c.dataset.modes ?? c.closest<HTMLElement>('[data-item-modes]')?.dataset.itemModes;
    if (modes && !modes.split(' ').includes(mode)) return false;
    return !c.classList.contains('submenu') || shown(c.querySelector(':scope > .menu')!, mode).length > 0;
  });
}

const page = menuBar();
const tops = [...page.querySelectorAll<HTMLElement>('header > .menu-wrap')]
  .filter((w) => !w.hidden)
  .map((w) => ({ name: w.querySelector(':scope > button')!.textContent!.trim(), list: w.querySelector(':scope > .menu')! }));

describe('menu bar shape in every mode (F5b-R01)', () => {
  it('has the seven menus', () => {
    expect(tops.map((t) => t.name)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Chemistry', 'Help']);
  });

  for (const mode of MODES) {
    it(`${mode}: every menu and submenu fits at 1024 × 700, with no single-item submenu`, () => {
      for (const t of tops) {
        const rows = shown(t.list, mode);
        expect(rows.length, `${mode} ${t.name}`).toBeLessThanOrEqual(MOST_ROWS);
        for (const s of t.list.querySelectorAll<HTMLElement>('.submenu')) {
          if (!shown(s.parentElement!, mode).includes(s)) continue;
          const head = s.querySelector(':scope > button')!.textContent!.trim();
          const n = shown(s.querySelector(':scope > .menu')!, mode).length;
          expect(n, `${mode} ${t.name} ▸ ${head}`).toBeLessThanOrEqual(MOST_ROWS);
          // (two older ones: Paste Special, which Show Clipboard Formats joins with Developer Tools on, and Look Up beside a sheet or document)
          if (!(head === 'Paste Special' || ((mode === 'sheet' || mode === 'document') && head === 'Look Up'))) expect(n, `${mode} ${t.name} ▸ ${head} has one item`).toBeGreaterThan(1);
        }
      }
    });

    it(`${mode}: no command twice in one menu`, () => {
      for (const t of tops) {
        const ids: string[] = [];
        const walk = (list: Element) => { for (const c of shown(list, mode)) c.classList.contains('submenu') ? walk(c.querySelector(':scope > .menu')!) : c.dataset.cmd && ids.push(c.dataset.cmd); };
        walk(t.list);
        // (Flash Fill is in Fill and in Data Tools, as in Excel; New Canvas is also File ▸ New ▸ Blank canvas)
        const twice = ids.filter((id, i) => ids.indexOf(id) !== i && !['flash-fill', 'new'].includes(id));
        expect(twice, `${mode} ${t.name}`).toEqual([]);
      }
    });
  }

  it('names no submenu after a mode', () => {
    const heads = [...page.querySelectorAll('header .submenu > button.has-sub')].map((b) => b.textContent!.trim());
    for (const m of ['Canvas', 'Presentation', 'Spreadsheet', 'Document', 'Design']) expect(heads, m).not.toContain(m);
  });

  it('groups the long menus as the Office ribbon does', () => {
    const path = (cmd: string) => {
      const b = page.querySelector<HTMLElement>(`header .menu [data-cmd="${cmd}"]`)!;
      const parts = [b.textContent!.trim()];
      for (let s = b.closest('.submenu'); s; s = s.parentElement!.closest('.submenu')) parts.unshift(s.querySelector(':scope > button')!.textContent!.trim());
      parts.unshift(b.closest('.menu-wrap')!.querySelector(':scope > button')!.textContent!.trim());
      return parts.join(' ▸ ');
    };
    expect(path('new-canvas-slide')).toBe('Insert ▸ Slides ▸ New Canvas Slide');
    expect(path('add-keyframe')).toBe('Insert ▸ Keyframes ▸ Add Keyframe');
    expect(path('insert-video')).toBe('Insert ▸ Media ▸ Video…');
    expect(path('slide-references')).toBe('Insert ▸ References ▸ References on Slide…');
    expect(path('insert-bookmark')).toBe('Insert ▸ Bookmark…');
    expect(path('breaks-nextPage')).toBe('Insert ▸ Breaks ▸ Section Break (Next Page)');
    expect(path('chart-scatter')).toBe('Insert ▸ Charts ▸ Scatter Chart');
    expect(path('copy-slides')).toBe('Edit ▸ Slides ▸ Copy Slides');
    expect(path('go-to')).toBe('Edit ▸ Find & Select ▸ Go To…');
    expect(path('solver')).toBe('Edit ▸ Data Tools ▸ Solver…');
    expect(path('save-format-favorite')).toBe('Format ▸ Favorites ▸ Save Format as Favorite…');
  });
});
