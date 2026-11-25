// @vitest-environment jsdom
// The Canvas ribbon's flyouts (Canvas ribbon cleanup): one large button that drops a list of
// commands, or a pane of pictures (Diagrams), under it. Nothing runs until one is picked; the keys
// move through the list or pane; Esc and Tab close it and give the button back the focus; a click
// outside closes it. Also: the Lab Calculator at the end of the tab row, and a tab that is no more
// (Arrange) opening Home.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CanvasRibbon, type CanvasRibbonHost } from '../src/ui/canvas-ribbon';
import { installRibbonFlyouts, moveIn } from '../src/ui/ribbon-flyout';
import { groupLayout, parseRibbons, type RibbonPlan } from '../src/ui/ribbon-custom';

let ran: string[] = [];
let menus: string[] = [];
let rb: CanvasRibbon;

const host = (): CanvasRibbonHost => ({
  command: (c, arg) => ran.push(arg ? `${c} ${arg}` : c),
  pickTool: (t) => ran.push(`tool:${t}`),
  hasTool: () => true,
  icon: () => '<svg viewBox="0 0 24 24"></svg>',
  textGroups: () => {},
  pasteMenu: () => {},
  itemMenu: (c) => menus.push(c),
  thumb: (it) => (it.arg === 'H2O' ? '<svg data-drawn-by-app=""></svg>' : undefined),
});

const fly = (slug: string) => rb.el.querySelector<HTMLElement>(`[data-cr-fly="${slug}"]`)!;
const open = (slug: string) => fly(slug).querySelector<HTMLButtonElement>(':scope > .rb-fly-btn')!.click();
const menuOf = (slug: string) => fly(slug).querySelector<HTMLElement>(':scope > .rb-fly-menu')!;
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

beforeAll(() => installRibbonFlyouts());
beforeEach(() => {
  document.body.innerHTML = '<div id="place"></div>';
  ran = [];
  menus = [];
  rb = new CanvasRibbon(host(), document.getElementById('place')!);
});

describe('Canvas ribbon flyouts', () => {
  it('drop their list under the button, run nothing until a command is picked, then close', () => {
    rb.pick('home');
    const menu = menuOf('align');
    expect(menu.hidden).toBe(true);
    open('align');
    expect(menu.hidden).toBe(false);
    expect(ran).toEqual([]);
    expect(fly('align').querySelector('.rb-fly-btn')!.getAttribute('aria-expanded')).toBe('true');
    // the list: picture and name, one column
    const names = [...menu.querySelectorAll('button')].map((b) => b.textContent!.replace('▸', '').trim());
    expect(names).toEqual(['Align Left', 'Align Center', 'Align Right', 'Align Top', 'Align Middle', 'Align Bottom', 'Distribute Horizontally', 'Distribute Vertically', 'Arrange in a Row', 'Arrange in a Column', 'Arrange in a Grid…']);
    expect([...menu.querySelectorAll('button')].every((b) => b.getAttribute('role') === 'menuitem' && b.querySelector('.rb-icon svg'))).toBe(true);
    menu.querySelector<HTMLButtonElement>('[data-cmd="align-top"]')!.click();
    expect(ran).toEqual(['align-top']);
    expect(menu.hidden).toBe(true);
  });

  it('keeps Distribute\'s ▾ (its spacing choice) inside the list', () => {
    open('align');
    menuOf('align').querySelector<HTMLElement>('[data-cmd="distribute-h"] .cr-drop')!.click();
    expect(menus).toEqual(['distribute-h']);
    expect(ran).toEqual([]);
  });

  it('close on a click outside, and on a second click of the button', () => {
    open('order');
    expect(menuOf('order').hidden).toBe(false);
    document.body.click();
    expect(menuOf('order').hidden).toBe(true);
    open('order');
    open('order');
    expect(menuOf('order').hidden).toBe(true);
  });

  it('take the keys: arrows move, Esc closes and gives the button back the focus, so does Tab', () => {
    open('rotate');
    const items = [...menuOf('rotate').querySelectorAll<HTMLButtonElement>('button')];
    expect(document.activeElement).toBe(items[0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key('ArrowUp');
    key('ArrowUp');
    expect(document.activeElement).toBe(items.at(-1));
    key('Home');
    expect(document.activeElement).toBe(items[0]);
    key('Escape');
    expect(menuOf('rotate').hidden).toBe(true);
    expect(document.activeElement).toBe(fly('rotate').querySelector('.rb-fly-btn'));
    open('rotate');
    key('Tab');
    expect(menuOf('rotate').hidden).toBe(true);
    expect(document.activeElement).toBe(fly('rotate').querySelector('.rb-fly-btn'));
  });

  it('move through a pane of pictures along the reading order, and to the next row', () => {
    const at = (x: number, y: number) => ({ getBoundingClientRect: () => ({ left: x, right: x + 90, top: y, bottom: y + 80, width: 90, height: 80 }) }) as unknown as HTMLElement;
    // two rows: three, then two
    const tiles = [at(0, 0), at(100, 0), at(200, 0), at(0, 100), at(100, 100)];
    expect(moveIn(tiles, 0, 'ArrowRight', true)).toBe(1);
    expect(moveIn(tiles, 0, 'ArrowLeft', true)).toBe(4);
    expect(moveIn(tiles, 1, 'ArrowDown', true)).toBe(4);
    expect(moveIn(tiles, 4, 'ArrowUp', true)).toBe(1);
    expect(moveIn(tiles, 2, 'ArrowDown', true)).toBe(4);
    expect(moveIn(tiles, 3, 'End', true)).toBe(4);
    // a list ignores left and right
    expect(moveIn(tiles, 1, 'ArrowRight', false)).toBeNull();
  });

  it('Diagrams is a pane of labeled pictures; the drawing code draws what it can when it first opens; a pick inserts', () => {
    rb.pick('insert');
    const pane = menuOf('diagrams');
    expect(pane.classList.contains('cr-tpl-pane')).toBe(true);
    expect(pane.hasAttribute('data-grid')).toBe(true);
    const tiles = [...pane.querySelectorAll<HTMLButtonElement>('button.cr-tpl')];
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['Energy Diagram', 'Transition State Brackets', 'Torsional Energy Chart', 'Newman Projection', 'Diagram', 'MO Diagram', 'MO Diagram: H₂O', 'MO Diagram: NH₃', 'd-Orbital Splitting', 'Orbital']);
    // every one has a picture and a tooltip saying what it is
    for (const b of tiles) {
      expect(b.querySelector('.cr-tpl-pic svg'), b.title).not.toBeNull();
      expect(b.title.length).toBeGreaterThan(b.getAttribute('aria-label')!.length);
    }
    expect(pane.querySelector('[data-arg="H2O"] [data-drawn-by-app]')).toBeNull();
    open('diagrams');
    expect(pane.querySelector('[data-arg="H2O"] [data-drawn-by-app]')).not.toBeNull();
    // nothing went on the page by opening it
    expect(ran).toEqual([]);
    pane.querySelector<HTMLButtonElement>('[data-arg="H2O"]')!.click();
    pane.querySelector<HTMLButtonElement>('[data-cmd="energy-diagram"]')!.click();
    expect(ran).toEqual(['mo-diagram H2O', 'energy-diagram']);
  });

  it('Structure From… and Schemes hold their commands; Predict NMR its four', () => {
    const cmds = (slug: string) => [...menuOf(slug).querySelectorAll<HTMLElement>('button')].map((b) => b.dataset.cmd);
    expect(cmds('structure-from')).toEqual(['name-to-structure', 'import-picture', 'sequence-to-structure']);
    expect(fly('structure-from').querySelector('.rb-fly-btn')!.textContent).toContain('Structure From…');
    expect(cmds('schemes')).toEqual(['smart-scheme', 'convert-smart-scheme', 'show-roles', 'stoichiometry-table', 'check-balance', 'map-atoms']);
    expect(cmds('nmr')).toEqual(['nmr-1h', 'nmr-13c', 'nmr-marks', 'nmr-window']);
  });

  it('works the same in the Simplified look', () => {
    rb.setLook('simple');
    open('focal');
    expect(menuOf('focal').hidden).toBe(false);
    menuOf('focal').querySelector<HTMLButtonElement>('[data-cmd="match-focal-points"]')!.click();
    expect(ran).toEqual(['match-focal-points']);
  });
});

describe('the Canvas ribbon around the flyouts', () => {
  it('has the Lab Calculator at the end of the tab row, left of whatever follows it (the warnings)', () => {
    const calc = rb.tabEnd.querySelector<HTMLButtonElement>('button.cr-calc')!;
    expect(calc).not.toBeNull();
    expect(calc.getAttribute('aria-label')).toBe('Lab Calculator');
    expect(calc.title).toMatch(/^Lab Calculator/);
    const warnings = document.createElement('button');
    rb.tabEnd.append(warnings);
    expect(calc.compareDocumentPosition(warnings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    calc.click();
    expect(ran).toEqual(['lab-calculator']);
    // on every tab: it is not in a panel
    expect(calc.closest('.rb-panel')).toBeNull();
  });

  it('opens Home for a tab there is no more (Arrange)', () => {
    rb.pick('view');
    expect(rb.tab).toBe('view');
    rb.pick('arrange');
    expect(rb.tab).toBe('home');
    expect(rb.el.querySelector('[data-cr-tab="arrange"]')).toBeNull();
  });

  it('a customization naming the Arrange tab or its groups falls back: nothing is lost or placed twice', () => {
    // (the Canvas ribbon keeps no customizations of its own: parseRibbons drops them)
    expect(parseRibbons({ canvas: { hiddenTabs: ['arrange'], groups: { arrange: ['g:align'] } } })).toEqual({});
    // and a ribbon's saved layout that names a tab or group that has gone lays the rest out as it comes
    const plan: RibbonPlan = { tabs: [{ key: 'home', groups: ['g:clipboard', 'g:arrange'] }, { key: 'view', groups: ['g:zoom', 'g:3-d'] }] };
    const out = groupLayout(plan, { groups: { arrange: ['g:align', 'g:3-d'], view: ['g:distribute', 'g:zoom'] } });
    expect(out).toEqual({ home: ['g:clipboard', 'g:arrange'], view: ['g:zoom', 'g:3-d'] });
  });
});
