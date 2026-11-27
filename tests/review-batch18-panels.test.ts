// @vitest-environment jsdom
// Code review 2026-11-26, batch 18: ribbons, menus, toolboxes and panels. The finding numbers are
// in the test names.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Doc } from '../src/model';
import { LayersPanel } from '../src/ui/layers-panel';
import { editPalettes, getPalettes, setPalettes } from '../src/ui/palette-ui';
import { popupMenu } from '../src/ui/popup-menu';
import { ToolboxEditor } from '../src/ui/toolbox-editor';
import { defaultToolboxes, type ToolboxState } from '../src/ui/toolboxes';
import { UpdateUI } from '../src/ui/update-ui';
import { withHiddenKept } from '../src/ui/ribbon-editor';
import { QuickBar } from '../src/ui/quick-bar';
import { askGridLayout } from '../src/ui/grid-picker';
import { NameDialog } from '../src/ui/name-dialog';
import { buildGuidesToolbox } from '../src/ui/guides-toolbox';
import { DEFAULT_GUIDES, type CanvasGuides } from '../src/editor/guides';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement;
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.show = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => { document.body.replaceChildren(); });

const tick = () => new Promise((r) => setTimeout(r, 0));
const pointer = (type: string, init: MouseEventInit = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

describe('F161: Selection Pane drag-to-reorder counts only the shapes\' rows', () => {
  function setup() {
    const doc = new Doc();
    // two text boxes (rows above the shapes in the Selection Pane) and three shapes, front to back: c, b, a
    doc.edit('s', () => {
      for (const t of ['one', 'two']) doc.addCaption({ x: 0, y: 0, runs: [{ text: t }], hidden: undefined } as never);
      for (const [name, z] of [['a', 1], ['b', 2], ['c', 3]] as const) doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, z, name } as never);
    });
    const section = document.createElement('section');
    document.body.append(section);
    const edits: string[] = [];
    const panel = new LayersPanel(section, {
      select: () => {}, selected: () => [], edit: (label, f) => { edits.push(label); doc.edit(label, f); },
      pick: () => {}, picked: () => ({ shapes: [], captions: [], atoms: [], arrows: [] }),
    });
    panel.show(doc, true);
    panel.refresh();
    // rows 20 high, one under the other, whatever kind they are
    [...section.querySelectorAll<HTMLElement>('.layer')].forEach((r, i) => {
      r.getBoundingClientRect = () => ({ top: i * 20, height: 20, bottom: i * 20 + 20, left: 0, right: 100, width: 100, x: 0, y: i * 20, toJSON() {} }) as DOMRect;
    });
    const gripOf = (name: string) => [...section.querySelectorAll<HTMLElement>('.layer[data-id]')].find((r) => r.textContent?.includes(name))!.querySelector<HTMLElement>('.layer-grip')!;
    return { doc, edits, gripOf, section };
  }
  const zOf = (doc: Doc, name: string) => [...doc.shapes.values()].find((s) => s.name === name)!.z;

  it('a small drag of the front shape changes nothing', () => {
    const { doc, edits, gripOf, section } = setup();
    expect(section.querySelectorAll('.layer')).toHaveLength(5);
    const grip = gripOf('c');
    grip.dispatchEvent(pointer('pointerdown', { button: 0, clientY: 50 }));
    window.dispatchEvent(pointer('pointermove', { clientY: 55 }));
    window.dispatchEvent(pointer('pointerup', { clientY: 55 }));
    expect(edits).toEqual([]);
    expect([zOf(doc, 'a'), zOf(doc, 'b'), zOf(doc, 'c')]).toEqual([1, 2, 3]);
  });
  it('dropping it just below the second shape puts it second, not at the very back', () => {
    const { doc, gripOf } = setup();
    gripOf('c').dispatchEvent(pointer('pointerdown', { button: 0, clientY: 50 }));
    // rows: 0 and 1 are the text boxes; c is 2 (40 to 60), b is 3 (60 to 80, middle 70), a is 4
    window.dispatchEvent(pointer('pointermove', { clientY: 75 }));
    window.dispatchEvent(pointer('pointerup', { clientY: 75 }));
    // front to back is now b, c, a
    expect([zOf(doc, 'b'), zOf(doc, 'c'), zOf(doc, 'a')]).toEqual([3, 2, 1]);
  });
});

describe('F728: the Layers list waits while something is dragged on the page', () => {
  it('does not rebuild its rows during the drag, and does once at the drop', () => {
    const doc = new Doc();
    doc.edit('s', () => { doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 10, y2: 10, z: 1 } as never); });
    const section = document.createElement('section');
    document.body.append(section);
    let dragging = false;
    const panel = new LayersPanel(section, { select: () => {}, selected: () => [], edit: (_l, f) => doc.edit('x', f), dragging: () => dragging });
    panel.show(doc, false);
    panel.refresh();
    const row = section.querySelector('.layer')!;
    dragging = true;
    doc.edit('move', () => doc.updateShape([...doc.shapes.keys()][0], { x1: 5 }));
    panel.refresh();
    expect(section.querySelector('.layer')).toBe(row);
    dragging = false;
    panel.refresh();
    expect(section.querySelector('.layer')).not.toBe(row);
  });
});

describe('F170: renaming a palette sticks when the next edit is made to that row', () => {
  it('keeps the new name after a color is taken out, and after one is added by its code', () => {
    setPalettes([{ name: 'My colors', colors: ['#ff0000', '#00ff00', '#0000ff'] }]);
    editPalettes();
    const d = () => document.querySelector<HTMLDialogElement>('dialog.palette-dialog')!;
    const name = d().querySelector<HTMLInputElement>('input[aria-label="Palette name"]')!;
    name.value = 'Journal';
    name.dispatchEvent(new Event('change'));
    expect(getPalettes()[0].name).toBe('Journal');
    d().querySelector<HTMLButtonElement>('.palette-x')!.click();
    expect(getPalettes()[0]).toEqual({ name: 'Journal', colors: ['#00ff00', '#0000ff'] });
    expect(d().querySelector<HTMLInputElement>('input[aria-label="Palette name"]')!.value).toBe('Journal');
    // a color added by typing its code (the row was drawn again, so this is the new row's closure; rename again first)
    const name2 = d().querySelector<HTMLInputElement>('input[aria-label="Palette name"]')!;
    name2.value = 'Group';
    name2.dispatchEvent(new Event('change'));
    const hex = d().querySelector<HTMLInputElement>('.palette-hex')!;
    hex.value = '#123456';
    hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(getPalettes()[0]).toEqual({ name: 'Group', colors: ['#00ff00', '#0000ff', '#123456'] });
  });
  it('keeps a rename made after the row was drawn when a swatch color is changed', () => {
    setPalettes([{ name: 'A', colors: ['#ff0000'] }]);
    editPalettes();
    const d = document.querySelector<HTMLDialogElement>('dialog.palette-dialog')!;
    const name = d.querySelector<HTMLInputElement>('input[aria-label="Palette name"]')!;
    name.value = 'B';
    name.dispatchEvent(new Event('change'));
    const swatch = d.querySelector<HTMLInputElement>('.palette-swatch input[type=color]')!;
    swatch.value = '#00ff00';
    swatch.dispatchEvent(new Event('change'));
    expect(getPalettes()[0]).toEqual({ name: 'B', colors: ['#00ff00'] });
  });
});

describe('F171: after a pop-up menu item is chosen, the next Escape is not swallowed', () => {
  it('lets Escape reach the page once the menu has gone', async () => {
    const chosen = vi.fn();
    const m = popupMenu(10, 10, [['Open Window', chosen], ['Other', () => {}]]);
    await tick();
    m.querySelector<HTMLButtonElement>('button')!.click();
    expect(chosen).toHaveBeenCalledOnce();
    // a key that is not Escape (the old listener stayed on for it too)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    let reached = false;
    window.addEventListener('keydown', () => { reached = true; }, { once: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
    expect(reached).toBe(true);
  });
  it('still closes with Escape while it is open, and only that once', async () => {
    const m = popupMenu(10, 10, [['Open Window', () => {}]]);
    await tick();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(m.isConnected).toBe(false);
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });
});

describe('Customize Toolboxes: F178 resizing a toolbox that was never stored, F815 the delete message', () => {
  const given = 'abcdefghijklmnop'.split('').map((c) => `cmd:${c}`);
  function setUp() {
    let st: ToolboxState = defaultToolboxes();
    const ed = new ToolboxEditor({
      get: () => st, set: (s) => { st = s; }, catalogue: () => [], describe: (key) => ({ key, label: key.slice(4).toUpperCase() }),
      title: (id) => id, given: (id) => (id === 'structure' ? given : []), palette: () => null, flyGrid: () => ({ cols: 1, rows: 1, cells: [null] }), newPlace: () => ({ x: 0, y: 0 }),
    });
    return { ed, state: () => st };
  }
  const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(`.tbe ${s}`)!;
  const question = () => [...document.querySelectorAll<HTMLDialogElement>('dialog.keep-choose')].find((d) => d.open);

  it('Take Them Out makes the smaller grid for a toolbox laid out from its list', async () => {
    const { ed, state } = setUp();
    ed.open('structure');
    expect(state().grids?.structure).toBeUndefined();
    const rows = Number(q<HTMLInputElement>('[data-act=rows]').value);
    const cols = q<HTMLInputElement>('[data-act=cols]');
    const was = Number(cols.value);
    expect(was * rows).toBeGreaterThanOrEqual(16);
    q<HTMLInputElement>('[data-act=rows]').value = String(rows);
    cols.value = String(was - 1);
    cols.dispatchEvent(new Event('change'));
    await tick();
    const ask = question();
    expect(ask?.textContent).toMatch(/too few/);
    [...ask!.querySelectorAll('button')].find((b) => /Take/.test(b.textContent ?? ''))!.click();
    await tick();
    const g = state().grids?.structure;
    expect(g?.cols).toBe(was - 1);
    expect(g?.rows).toBe(rows);
  });
  it('a deleted toolbox of your own is not said to come back with Restore Deleted Toolboxes', () => {
    const { ed } = setUp();
    ed.open('main');
    q<HTMLButtonElement>('[data-act=new]').click();
    q<HTMLButtonElement>('[data-act=delete]').click();
    const said = q('.tbe-say').textContent ?? '';
    expect(said).toMatch(/^Deleted Toolbox \d+\. Undo brings it back\./);
    expect(said).not.toContain('Restore Deleted Toolboxes');
  });
  it('a deleted toolbox that comes with the app is said to', () => {
    const { ed } = setUp();
    ed.open('arrange');
    q<HTMLButtonElement>('[data-act=delete]').click();
    expect(q('.tbe-say').textContent).toContain('Restore Deleted Toolboxes');
  });
});

describe('F179: Help > What\'s New after the update notice was dismissed', () => {
  const host = { unkept: () => [], skipped: () => null, skip: () => {}, channel: () => 'stable' as const, openPage: () => {}, closing: async () => {} };
  const found = [{ version: '0.1.9', notes: 'Fixed: Something.' }];
  const call = (ui: UpdateUI, name: string, ...a: unknown[]) => (ui as unknown as Record<string, (...x: unknown[]) => void>)[name](...a);
  for (const label of ['Later', 'Skip This Version']) {
    it(`opens the card after ${label}`, () => {
      const ui = new UpdateUI(host);
      call(ui, 'offer', { version: '0.2.0', notes: 'Added: Something.', install: async () => {} });
      [...document.querySelectorAll<HTMLButtonElement>('.update-box button')].find((b) => b.textContent === label)!.click();
      expect(document.querySelector('.update-box')).toBeNull();
      call(ui, 'showWhatsNew', found, '0.1.9');
      expect(document.querySelector('.update-box.whats-new')).not.toBeNull();
    });
  }
});

describe('F781: hidden groups keep their places when the visible groups are reordered', () => {
  it('leaves a hidden group between the ones it was between', () => {
    // groups [A, H, B, C] with H hidden: C dragged to the front
    expect(withHiddenKept(['A', 'H', 'B', 'C'], ['C', 'A', 'B'], new Set(['H']))).toEqual(['C', 'A', 'H', 'B']);
  });
  it('keeps one that began the tab at the start, and runs of them together', () => {
    expect(withHiddenKept(['H1', 'A', 'H2', 'H3', 'B'], ['B', 'A'], new Set(['H1', 'H2', 'H3']))).toEqual(['H1', 'B', 'A', 'H2', 'H3']);
  });
  it('is the order given when nothing is hidden, and shows a hidden group dragged in where it was dropped', () => {
    expect(withHiddenKept(['A', 'B'], ['B', 'A'], new Set())).toEqual(['B', 'A']);
    expect(withHiddenKept(['A', 'H', 'B'], ['A', 'H', 'B'], new Set(['H']))).toEqual(['A', 'H', 'B']);
  });
});

describe('F771: Add puts a command that is on the bar already after the selected button', () => {
  it('moves the first of [a, b, c, d] to just after c', () => {
    let saved: string[] | null = ['a', 'b', 'c', 'd'];
    new QuickBar(document.body.appendChild(document.createElement('div')), {
      get: () => saved, set: (l) => { saved = l; }, run: () => {}, label: (c) => c, key: () => undefined, icon: () => undefined,
      state: () => ({ enabled: true, on: null }), all: () => [{ name: 'Menu', items: ['a', 'b', 'c', 'd'].map((cmd) => ({ cmd, label: cmd })) }],
    }).edit();
    const bar = document.querySelector<HTMLSelectElement>('.qe-bar')!;
    bar.selectedIndex = 2;
    const all = document.querySelector<HTMLSelectElement>('.qe-all')!;
    all.value = 'a';
    document.querySelector<HTMLButtonElement>('.qe-add')!.click();
    expect(saved).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('F711: the Rows box shows the rows the columns really make', () => {
  it('writes 3 back when 4 rows of 6 items make 2 columns', async () => {
    const got = askGridLayout(6, { cols: 3, rowGap: 10, colGap: 10 }, () => '');
    const rows = document.querySelector<HTMLInputElement>('input[name=rows]')!;
    rows.value = '4';
    rows.dispatchEvent(new Event('input'));
    expect(document.querySelector<HTMLInputElement>('input[name=cols]')!.value).toBe('2');
    // (typing doesn't interrupt: the box is only corrected when it is left)
    expect(rows.value).toBe('4');
    rows.dispatchEvent(new Event('change'));
    expect(rows.value).toBe('3');
    document.querySelector<HTMLFormElement>('.grid-picker form')!.requestSubmit();
    expect((await got)?.cols).toBe(2);
  });
});

describe('F739: Cancel while the name is being read stops the insert', () => {
  it('tells the converter the window was closed', async () => {
    let release!: () => void;
    const inserted = vi.fn();
    const seen: unknown[] = [];
    const dlg = new NameDialog(async (_name, closed) => {
      await new Promise<void>((r) => { release = r; });
      seen.push(typeof closed === 'function' ? closed() : 'not told');
      if (typeof closed === 'function' && closed()) return null;
      inserted();
      return null;
    }, () => false);
    dlg.open('caffeine');
    const d = document.querySelector<HTMLDialogElement>('dialog.name-dialog')!;
    d.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick();
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    release();
    await tick();
    expect(seen).toEqual([true]);
    expect(inserted).not.toHaveBeenCalled();
  });
  it('still inserts when the window is left open', async () => {
    const inserted = vi.fn();
    const dlg = new NameDialog(async (_name, closed) => { if (!closed()) inserted(); return null; }, () => false);
    dlg.open('caffeine');
    document.querySelector<HTMLFormElement>('dialog.name-dialog form')!.requestSubmit();
    await tick();
    expect(inserted).toHaveBeenCalledOnce();
  });
});

describe('F716: the tick boxes go back to the spacing in use on Escape or a bad value', () => {
  function toolbox() {
    let g: CanvasGuides | null = null;
    const body = document.createElement('div');
    document.body.append(body);
    buildGuidesToolbox(body, false, { get: () => g, set: (x) => { g = x; }, centre: () => ({ x: 0, y: 0 }), units: () => 'in' });
    return { box: () => body.querySelector<HTMLInputElement>('input[aria-label="Major tick spacing"]')!, guides: () => g };
  }
  it('Escape puts the old text back while the box still has the keyboard', () => {
    const { box } = toolbox();
    const was = box().value;
    box().focus();
    box().value = '2 cm';
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(box().value).toBe(was);
  });
  it('Enter with a value that is not a length puts the old text back and keeps the spacing', () => {
    const { box, guides } = toolbox();
    const was = box().value;
    box().focus();
    box().value = 'abc';
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(box().value).toBe(was);
    expect(guides()).toBeNull();
    expect(DEFAULT_GUIDES.major).toBeGreaterThan(0);
  });
});
