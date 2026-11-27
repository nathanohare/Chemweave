// @vitest-environment jsdom
// Code review 2026-11-26, batch 18: small dialogs, pointer drags and lists. The finding numbers
// are in the test names.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/ask', () => ({ ask: vi.fn() }));
vi.mock('../src/ui/template-thumbs', () => ({ sheetCallouts: async (wb: unknown) => wb }));

import { ask } from '../src/ui/ask';
import { aiSettingsDialog } from '../src/ui/ai-settings';
import { fileTypesPage, type FileTypesHost } from '../src/ui/file-types-page';
import { sheetCategories, templateChem } from '../src/ui/file-templates';
import { SHEET_TEMPLATES } from '../src/sheet/templates';
import { makeCombo } from '../src/ui/combo';
import { CommandSearch } from '../src/ui/command-search';
import { SettingsWindow } from '../src/ui/settings-window';
import { ShapeMenu } from '../src/ui/shape-menu';
import { FloatBox } from '../src/ui/float-box';
import { ToolWindow } from '../src/ui/tool-window';
import { CanvasKeys } from '../src/ui/canvas-keys';
import { dragRow } from '../src/ui/row-drag';
import { Ruler, type RulerGeometry } from '../src/ui/ruler';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import type { Workbook } from '../src/sheet/workbook';

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement;
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.show = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.setPointerCapture ??= () => {};
  el.releasePointerCapture ??= () => {};
  el.scrollIntoView ??= () => {};
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
  (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => { document.body.replaceChildren(); vi.mocked(ask).mockReset(); });

const tick = () => new Promise((r) => setTimeout(r, 0));
const pointer = (type: string, init: MouseEventInit & { offsetX?: number; offsetY?: number } = {}) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  if (init.offsetX !== undefined) Object.defineProperty(e, 'offsetX', { value: init.offsetX });
  if (init.offsetY !== undefined) Object.defineProperty(e, 'offsetY', { value: init.offsetY });
  return e;
};

describe('F658: AI Model keeps a typed key when the Other server address is missing', () => {
  it('shows the window again with the key and the Remember choice filled in', async () => {
    const seen: { key?: string; remember?: string }[] = [];
    const first = { provider: 'compatible', key: 'sk-typed-key', model: '', base: '', localOnly: 'false', remember: 'true', look: 'bar', sendDocument: 'false', forget: 'false' };
    vi.mocked(ask).mockImplementation((async (_title: string, fields: { name: string; value?: string }[]) => {
      if (!fields.length) return true;
      seen.push({ key: fields.find((f) => f.name === 'key')?.value, remember: fields.find((f) => f.name === 'remember')?.value });
      return seen.length === 1 ? first : null;
    }) as never);
    await aiSettingsDialog({ provider: 'none', model: '', base: '', localOnly: false, assistant: false }, () => {});
    expect(seen).toHaveLength(2);
    expect(seen[0].key).toBe('');
    expect(seen[1].key).toBe('sk-typed-key');
    expect(seen[1].remember).toBe('true');
  });
});

describe('F704: a failed read of the Open With list is not saved as an empty selection', () => {
  function host(set: FileTypesHost['set']): FileTypesHost {
    return {
      platform: 'windows', get: async () => { throw new Error('registry unreadable'); }, set, openDefaults: async () => {},
      objects: { get: async () => false, set: async () => {} }, figures: { get: () => false, set: () => {} }, flash: () => {},
    };
  }
  it('leaves the file type boxes alone and never calls set', async () => {
    const set = vi.fn(async () => {});
    await fileTypesPage(host(set));
    const d = document.querySelector<HTMLDialogElement>('dialog.file-types')!;
    const boxes = [...d.querySelectorAll<HTMLInputElement>('.ask-check input')].slice(0, 13);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(d.querySelector('[role=alert]')?.textContent).toMatch(/Could not read/);
    boxes[9].checked = true;
    d.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await tick();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('F703: the sample workbook is made again once the chemistry engine can draw', () => {
  it('does not keep the structure-less one for good', async () => {
    const cards = (await Promise.all(sheetCategories(() => {}).map((c) => c.cards()))).flat();
    const zoom = cards.find((c) => c.id === SHEET_TEMPLATES[0].id)!.zoom as unknown as () => Promise<Workbook>;
    templateChem.toStructure = null;
    const early = await zoom();
    templateChem.toStructure = async () => null;
    const later = await zoom();
    templateChem.toStructure = null;
    expect(later).not.toBe(early);
  });
});

describe('combo lists', () => {
  function combo(): HTMLInputElement {
    const list = document.createElement('datalist');
    list.id = 'fonts-b18';
    for (const f of ['Arial', 'Calibri', 'Courier New', 'Times New Roman']) list.append(new Option(f));
    const input = document.createElement('input');
    input.setAttribute('list', 'fonts-b18');
    document.body.append(list, input);
    makeCombo(input);
    return input;
  }
  const items = () => [...document.querySelectorAll('.combo-item')].map((x) => x.textContent);
  it('F686: the first key after the list was closed already narrows it', async () => {
    const input = combo();
    input.focus();
    await tick();
    expect(items()).toHaveLength(4);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.combo-list')).toBeNull();
    input.value = 'Ca';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(items()).toEqual(['Calibri']);
  });
  it('F685: a press on the list itself (its scrollbar, a heading) does not take the focus from the box', async () => {
    const input = combo();
    input.focus();
    await tick();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    document.querySelector('.combo-list')!.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });
});

describe('F687: Search Commands reopens on its first row', () => {
  it('runs the first row on Enter after an earlier choice further down', () => {
    const ran: string[] = [];
    const items = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5'].map((id) => ({ id, label: id.toUpperCase(), place: 'Home tab', run: () => { ran.push(id); } }));
    const search = new CommandSearch(() => items);
    const key = (k: string) => document.querySelector('dialog.command-search')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    search.open();
    for (let i = 0; i < 4; i++) key('ArrowDown');
    key('Enter');
    expect(ran).toEqual(['i4']);
    // the one used last comes first when nothing is typed: Enter without moving runs it
    search.open();
    key('Enter');
    expect(ran).toEqual(['i4', 'i4']);
  });
});

describe('F788: Esc in the "Apply your changes?" question is left to that question', () => {
  it('the Settings window does not close itself over it', async () => {
    const win = new SettingsWindow([{ id: 'p', title: 'Page', words: '', open: () => {} }]);
    win.open();
    const d = document.querySelector<HTMLDialogElement>('dialog.settings-window')!;
    const question = document.createElement('dialog');
    question.className = 'ask sw-unapplied';
    question.innerHTML = '<button type="button">Keep Editing</button>';
    d.append(question);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    question.querySelector('button')!.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(false);
    // and still closes from elsewhere in the window
    const other = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    d.querySelector('.sw-search')!.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(true);
  });
});

describe('F789: clicking Shapes again closes the open menu', () => {
  it('stays open for the press on its button, so the click that follows closes it', async () => {
    const menu = new ShapeMenu();
    const button = document.createElement('button');
    document.body.append(button);
    const open = () => menu.show(button, 'Pick one', () => {});
    open();
    await tick();
    expect(menu.shown).toBe(true);
    // a press on the same button, then its click handler (which is what the ribbon does)
    button.dispatchEvent(pointer('pointerdown'));
    open();
    expect(menu.shown).toBe(false);
    // a press elsewhere still closes it
    open();
    await tick();
    document.body.dispatchEvent(pointer('pointerdown'));
    expect(menu.shown).toBe(false);
  });
});

describe('a drag the system cancels lets go of everything', () => {
  it('F707: a floating box stops following the pointer', () => {
    const box = new FloatBox('Paragraph', () => {});
    box.show();
    const head = box.el.querySelector<HTMLElement>('.fb-head')!;
    head.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
    head.dispatchEvent(pointer('pointermove', { clientX: 140, clientY: 130 }));
    const left = box.el.style.left;
    expect(left).not.toBe('');
    head.dispatchEvent(pointer('pointercancel'));
    head.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 300 }));
    expect(box.el.style.left).toBe(left);
  });
  it('F814: a tool window stops following the pointer, and a right-click on its title does not carry it', () => {
    const tw = new ToolWindow('Chart');
    const d = (tw as unknown as { d: HTMLDialogElement }).d;
    document.body.append(d);
    const title = d.querySelector('h2')!;
    title.dispatchEvent(pointer('pointerdown', { button: 2, clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
    expect(d.style.left).toBe('');
    title.dispatchEvent(pointer('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 60 }));
    const left = d.style.left;
    expect(left).not.toBe('');
    window.dispatchEvent(pointer('pointercancel'));
    window.dispatchEvent(pointer('pointermove', { clientX: 400, clientY: 400 }));
    expect(d.style.left).toBe(left);
  });
  it('F784: a row drag the browser cancels does not move the row', () => {
    const rows = [0, 1, 2].map((i) => {
      const r = document.createElement('div');
      r.getBoundingClientRect = () => ({ top: i * 20, height: 20, bottom: i * 20 + 20, left: 0, right: 10, width: 10, x: 0, y: i * 20, toJSON() {} }) as DOMRect;
      document.body.append(r);
      return r;
    });
    const drop = vi.fn();
    const down = { button: 0, clientY: 10, pointerId: 1, currentTarget: null, preventDefault() {} } as unknown as PointerEvent;
    dragRow(down, rows[0], () => rows, drop);
    window.dispatchEvent(pointer('pointermove', { clientY: 55 }));
    window.dispatchEvent(pointer('pointercancel'));
    expect(drop).not.toHaveBeenCalled();
    expect(rows[0].classList.contains('row-dragging')).toBe(false);
    // and a drag that is let go still moves it
    dragRow(down, rows[0], () => rows, drop);
    window.dispatchEvent(pointer('pointermove', { clientY: 55 }));
    window.dispatchEvent(pointer('pointerup', { clientY: 55 }));
    expect(drop).toHaveBeenCalledWith(0, 3);
  });
});

describe('canvas keyframes', () => {
  function setup() {
    const host = new Doc();
    const deck = Deck.blank(host);
    deck.attach();
    deck.addCanvasSlide();
    const overlay = document.createElement('div');
    document.body.append(overlay);
    let at = { x: 5, y: 5 };
    const keys = new CanvasKeys(overlay, {
      deck: () => deck, view: () => ({ scale: 1 }) as never, pointAt: () => ({ p: at, taken: false }), repaint: () => {}, begin: () => {}, picked: () => {},
    });
    return { deck, overlay, keys, move: (x: number, y: number) => { at = { x, y }; } };
  }
  it('F677: a cancelled pointer ends the drag and changes nothing', () => {
    const { deck, overlay, keys, move } = setup();
    const before = JSON.stringify(deck.current!.canvas);
    overlay.dispatchEvent(pointer('pointerdown', { button: 0 }));
    move(105, 85);
    window.dispatchEvent(pointer('pointermove'));
    expect((keys as unknown as { live: unknown }).live).not.toBeNull();
    window.dispatchEvent(pointer('pointercancel'));
    // (not drawn dragged any more, and nothing changed)
    expect((keys as unknown as { live: unknown }).live).toBeNull();
    expect(JSON.stringify(deck.current!.canvas)).toBe(before);
    // (the old move listener is gone: another drag is not fought by it)
    move(5, 5);
    overlay.dispatchEvent(pointer('pointerdown', { button: 0 }));
    move(25, 25);
    window.dispatchEvent(pointer('pointermove'));
    window.dispatchEvent(pointer('pointerup'));
    expect(deck.current!.canvas!.keys[0].x).toBeCloseTo(20, 0);
  });
  it('F676: a drag does not write back keyframes from before an Undo pressed during it', () => {
    const { deck, overlay, move } = setup();
    overlay.dispatchEvent(pointer('pointerdown', { button: 0 }));
    move(105, 85);
    window.dispatchEvent(pointer('pointermove'));
    // the canvas is replaced, as Undo does (here: a keyframe moved elsewhere)
    const slide = deck.current!;
    const replaced = { ...slide.canvas!, keys: slide.canvas!.keys.map((k) => ({ ...k, x: 300, y: 200 })) };
    slide.canvas = replaced;
    window.dispatchEvent(pointer('pointerup'));
    expect(deck.current!.canvas).toBe(replaced);
    expect(deck.current!.canvas!.keys[0]).toMatchObject({ x: 300, y: 200 });
  });
});

describe('the document ruler', () => {
  const geometry = (tabs: { pos: number; kind: 'left' }[]): RulerGeometry => ({ colLeft: 100, colRight: 700, pageLeft: 50, pageRight: 750, zoom: 1, para: { tabs } as never });
  function setup(tabs: { pos: number; kind: 'left' }[]) {
    const el = document.createElement('div');
    document.body.append(el);
    const setParas = vi.fn();
    const ruler = new Ruler(el, { geometry: () => geometry(tabs.map((t) => ({ ...t }))), setParas, focus: () => {} });
    const canvas = el.querySelector('canvas')!;
    return { ruler, canvas, setParas };
  }
  it('F787: a plain click on a tab stop that is off the grid leaves it, with no undo step', () => {
    // 1.03 in is 74.16 pt: not on a sixteenth of an inch
    const { canvas, setParas } = setup([{ pos: 74.16, kind: 'left' }]);
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, offsetX: 174, offsetY: 20 }));
    canvas.dispatchEvent(pointer('pointerup', { button: 0, offsetX: 174, offsetY: 20 }));
    expect(setParas).not.toHaveBeenCalled();
  });
  it('still puts a new tab stop where an empty part of the ruler is clicked', () => {
    const { canvas, setParas } = setup([]);
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, offsetX: 300, offsetY: 20 }));
    canvas.dispatchEvent(pointer('pointerup', { button: 0, offsetX: 300, offsetY: 20 }));
    expect(setParas).toHaveBeenCalledOnce();
    expect(setParas.mock.calls[0][1]).toBe('tabs');
  });
  it('F786: a cancelled press does not leave the new tab stop in the ruler', () => {
    const { ruler, canvas, setParas } = setup([]);
    canvas.dispatchEvent(pointer('pointerdown', { button: 0, offsetX: 300, offsetY: 20 }));
    expect((ruler as unknown as { geo: RulerGeometry }).geo.para.tabs).toHaveLength(1);
    canvas.dispatchEvent(pointer('pointercancel'));
    expect((ruler as unknown as { geo: RulerGeometry }).geo.para.tabs).toHaveLength(0);
    expect(setParas).not.toHaveBeenCalled();
  });
});
