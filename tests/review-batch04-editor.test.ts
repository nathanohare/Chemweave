// @vitest-environment jsdom
//
// Fixes from the code review of 2026-11-26 (batch 04, canvas drawing and editing) in the editor:
// a pinch that starts during a reshape, the Partial Bond tool on a bond, Arrange with nothing
// picked, typing in a shape after a text box, the right-click menu after a right-button pan,
// a mouse's side buttons, the double-click label shortcut after an Undo, a one-atom chain, Select
// All, a turn while the drawing changes, Delete after a join was pressed, the selection's box,
// Scale, Esc during a drag, and Align Center with labels and text picked. (Only geometry and undo
// steps are checked: no chemistry values.)

import { describe, it, expect, afterEach } from 'vitest';
import { Doc, PARTIAL, type Arrow } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { Editor } from '../src/editor/editor';
import { makeSmart, smartFrameOf } from '../src/chem/smart-scheme';
import { plainMeasure } from '../src/chem/reaction';

window.requestAnimationFrame = () => 0;
// (a canvas that measures text: 5 px a character)
const noop = () => undefined;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 5, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
    : k === 'getTransform' ? () => new DOMMatrix()
    : k === 'createLinearGradient' || k === 'createPattern' || k === 'createRadialGradient' ? () => ({ addColorStop: noop })
    : noop),
  set: () => true,
});
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

let last: Editor | null = null;
afterEach(() => { if (last) last.paused = true; });

function setup(doc = new Doc()) {
  document.body.innerHTML = '';
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas');
  const host = document.createElement('div');
  host.append(scene, overlay);
  document.body.append(host);
  const r = new Renderer(scene, overlay);
  overlay.setPointerCapture = () => {};
  const ed = new Editor(doc, r, host);
  last = ed;
  ed.setTool('select');
  const ev = (type: string, p: { x: number; y: number }, o: PointerEventInit = {}) => {
    const s = r.toScreen(p);
    overlay.dispatchEvent(new PointerEvent(type, { clientX: s.x, clientY: s.y, bubbles: true, pointerType: 'mouse', ...o }));
  };
  const click = (p: { x: number; y: number }, button = 0) => {
    ev('pointermove', p);
    ev('pointerdown', p, { button, buttons: button === 0 ? 1 : 1 << button });
    ev('pointerup', p, { button });
  };
  return { doc, ed, r, overlay, ev, click };
}

const L = new Doc().style.bondLength;

/** A zigzag chain of n atoms. */
function chain(doc: Doc, n: number, x0 = 100, y0 = 100) {
  const ids: number[] = [];
  doc.edit('Chain', () => {
    for (let i = 0; i < n; i++) ids.push(doc.addAtom(x0 + i * L * 0.87, y0 + (i % 2 ? L / 2 : 0)).id);
    for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
  });
  return ids;
}

const priv = (ed: Editor) => ed as unknown as { drag: unknown; activeHandle: Editor['activeHandle'] };

describe('F036: a second finger during a reshape drag', () => {
  it('puts the arrow back and leaves Undo working', () => {
    const { doc, ed } = setup();
    let id = 0;
    doc.edit('Arrow', () => { id = doc.addArrow({ tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 4, headWidth: 1.5 } as Omit<Arrow, 'id'>).id; });
    // what onMove does for a reshape drag that has moved
    priv(ed).drag = { mode: 'reshape', moved: true, start: { x: 30, y: 0 }, startScreen: { x: 0, y: 0 }, last: { x: 30, y: 10 }, button: 0 };
    doc.begin('Bend arrow');
    doc.updateArrow(id, { sweep: 1 });
    ed.abandonPress();
    expect(doc.editing).toBe(false);
    expect(doc.arrows.get(id)!.sweep).toBe(0);
    expect(doc.undo()).toBe(true);
    expect(doc.arrows.size).toBe(0);
  });
});

describe('F037: the Partial Bond tool clicked on a bond', () => {
  it('makes it a partial bond', () => {
    const { doc, ed, click } = setup();
    const ids = chain(doc, 2);
    ed.setTool('bond-partial');
    const a = doc.atoms.get(ids[0])!, b = doc.atoms.get(ids[1])!;
    click({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const bond = [...doc.bonds.values()][0];
    expect(bond.order).toBe(PARTIAL);
    expect(bond.display).toBe('dash');
  });
});

describe('F038: Arrange in a Row with nothing picked', () => {
  it('leaves hidden and locked things out', () => {
    const { doc, ed } = setup();
    chain(doc, 3, 100, 100);
    chain(doc, 3, 300, 100);
    doc.edit('more', () => {
      doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 500, y2: 300, locked: true } as never);
      doc.addCaption({ x: 50, y: 250, runs: [{ text: 'hidden box' }], justify: 'left', hidden: true } as never);
    });
    ed.clearSelection();
    expect(ed.gridCount()).toBe(2);
  });
});

describe('F040: typing in a shape after typing in a text box', () => {
  it('does not take the text box as the one being typed in', () => {
    const { doc, ed } = setup();
    let cap = 0, shape = 0;
    doc.edit('draw', () => {
      cap = doc.addCaption({ x: 0, y: 0, runs: [{ text: 'box' }], justify: 'left' }).id;
      shape = doc.addShape({ kind: 'geo', geo: 'rect', x1: 100, y1: 100, x2: 200, y2: 160 } as never).id;
    });
    ed.typeInto(cap);
    ed.closeCaption();
    ed.editGeoText(shape);
    // the ribbon's Text Direction, Columns and AutoFit have no text box to show or change
    expect(ed.textBoxLook()).toBeNull();
    ed.closeCaption();
  });
});

describe('F353: the menu after a right-button pan', () => {
  it('opens for a long press or the Menu key', () => {
    const { ed, overlay, ev } = setup();
    let menus = 0;
    ed.onContextMenu = () => { menus++; };
    // a right-button drag pans (Windows sends its contextmenu after the button comes up)
    ev('pointerdown', { x: 100, y: 100 }, { button: 2, buttons: 2 });
    for (let i = 1; i <= 5; i++) ev('pointermove', { x: 100 + 10 * i, y: 100 }, { buttons: 2 });
    ev('pointerup', { x: 150, y: 100 }, { button: 2 });
    overlay.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    expect(menus).toBe(0);
    // later, a menu asked for without a right click (a long press, the Menu key)
    overlay.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus).toBe(1);
  });
});

describe('F354: a mouse\'s Back and Forward buttons', () => {
  it('draw nothing', () => {
    const { doc, ed, click } = setup();
    ed.setTool('bond-single');
    click({ x: 100, y: 100 }, 3);
    click({ x: 200, y: 100 }, 4);
    expect(doc.atoms.size).toBe(0);
  });
});

describe('F356: a quick second click on the atom after an Undo', () => {
  it('does not undo an earlier step', () => {
    const { doc, ed, click } = setup();
    let a = 0;
    doc.edit('Atom', () => { a = doc.addAtom(100, 100).id; });
    ed.setTool('bond-single');
    const at = doc.atoms.get(a)!;
    click(at);
    expect(doc.bonds.size).toBe(1);
    ed.undo();
    expect(doc.bonds.size).toBe(0);
    click(at);
    expect(doc.atoms.has(a)).toBe(true);
  });
});

describe('F359: a chain of one atom in empty space', () => {
  it('is one atom', () => {
    const { doc, ed } = setup();
    ed.drawChain(null, { x: 100, y: 100 }, 1);
    expect(doc.atoms.size).toBe(1);
    expect(doc.bonds.size).toBe(0);
  });
});

describe('F360: Select All', () => {
  it('leaves out hidden text, and structures while they are locked', () => {
    const { doc, ed } = setup();
    chain(doc, 3);
    let hidden = 0;
    doc.edit('Text', () => { hidden = doc.addCaption({ x: 0, y: 0, runs: [{ text: 'hidden' }], justify: 'left', hidden: true } as never).id; });
    ed.selectAll();
    expect(ed.sel.captions.has(hidden)).toBe(false);
    expect(ed.sel.atoms.size).toBe(3);
    ed.structuresLocked = true;
    ed.selectAll();
    expect(ed.sel.atoms.size).toBe(0);
    expect(ed.sel.bonds.size).toBe(0);
  });
});

describe('F361: Rotate in Perspective while the structure changes', () => {
  it('turns the structure as it is once it is ready', async () => {
    const { doc, ed } = setup();
    const ids = chain(doc, 3);
    ed.selectAll();
    const done = ed.turnSelectionBy(0, 0, 90, false);
    // an atom added to the structure before the turn is ready
    let added = 0;
    doc.edit('Bond', () => { const n = doc.addAtom(300, 300); doc.addBond(ids[2], n.id); added = n.id; });
    expect(await done).toBe(true);
    // 90° in the page about the middle: the new atom moved too
    const n = doc.atoms.get(added)!;
    expect(Math.hypot(n.x - 300, n.y - 300)).toBeGreaterThan(1);
  });
});

describe('F362: Delete after a curved arrow\'s join was pressed, then Select All', () => {
  it('deletes everything selected', () => {
    const { doc, ed } = setup();
    chain(doc, 3);
    let id = 0;
    doc.edit('Arrow', () => {
      id = doc.addArrow({ tail: { x: 0, y: 0 }, head: { x: 90, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 4, headWidth: 1.5,
        bez: [{ x: 15, y: -20 }, { x: 30, y: -20 }, { x: 45, y: 0 }, { x: 60, y: 20 }, { x: 75, y: 20 }] } as Omit<Arrow, 'id'>).id;
    });
    ed.selectOnly({ kind: 'arrow', id });
    priv(ed).activeHandle = { id, which: 'b2' };
    ed.selectAll();
    ed.deleteSelection();
    expect(doc.atoms.size).toBe(0);
    expect(doc.arrows.size).toBe(0);
  });
});

describe('F363: the selection\'s box', () => {
  it('is that of the atoms picked now, not of others with the same count and id sum', () => {
    const { doc, ed } = setup();
    const ids: number[] = [];
    doc.edit('draw', () => { for (const [x, y] of [[0, 0], [100, 0], [200, 0], [300, 300]]) ids.push(doc.addAtom(x, y).id); });
    const pick = (a: number[]) => { ed.sel = { atoms: new Set(a), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }; };
    pick([ids[1], ids[2]]);
    const b1 = ed.selBox()!;
    pick([ids[0], ids[3]]);
    const b2 = ed.selBox()!;
    expect(b2.x1).not.toBeCloseTo(b1.x1, 3);
    expect(b2.y2).toBeGreaterThan(b1.y2 + 100);
  });
});

describe('F365: Scale', () => {
  it('grows an arrow\'s own line width and shaft spacing, and a shape\'s line width', () => {
    const { doc, ed } = setup();
    let a = 0, s = 0;
    doc.edit('draw', () => {
      a = doc.addArrow({ tail: { x: 0, y: 0 }, head: { x: 60, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 4, headWidth: 1.5, lineWidth: 1, shaftSpacing: 3 } as Omit<Arrow, 'id'>).id;
      s = doc.addShape({ kind: 'rect', x1: 0, y1: 20, x2: 60, y2: 50, lineWidth: 0.5 } as never).id;
    });
    ed.selectAll();
    expect(ed.scaleSelection(2)).toBe(true);
    expect(doc.arrows.get(a)!.lineWidth).toBeCloseTo(2, 9);
    expect(doc.arrows.get(a)!.shaftSpacing).toBeCloseTo(6, 9);
    expect(doc.shapes.get(s)!.lineWidth).toBeCloseTo(1, 9);
  });
});

describe('F366: Esc during a drag', () => {
  it('puts what was dragged back, with nothing to undo', () => {
    const { doc, ed, ev } = setup();
    const ids = chain(doc, 3);
    ed.selectAll();
    const a = doc.atoms.get(ids[0])!, x0 = a.x, y0 = a.y;
    ev('pointermove', a);
    ev('pointerdown', a, { button: 0, buttons: 1 });
    for (let i = 1; i <= 5; i++) ev('pointermove', { x: x0 + 8 * i, y: y0 }, { buttons: 1 });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    ev('pointermove', { x: x0 + 60, y: y0 }, { buttons: 1 });
    ev('pointerup', { x: x0 + 60, y: y0 }, { button: 0 });
    expect(doc.atoms.get(ids[0])!.x).toBeCloseTo(x0, 6);
    expect(doc.editing).toBe(false);
    expect(doc.undoLabel).toBe('Chain');
  });
});

describe('F368: Align Center with a label and a caption picked', () => {
  it('is one undo step', () => {
    const { doc, ed } = setup();
    let o = 0, cap = 0;
    doc.edit('draw', () => {
      const c = doc.addAtom(100, 100);
      o = doc.addAtom(100 + L, 100, 8, { label: 'OH' } as never).id;
      doc.addBond(c.id, o);
      cap = doc.addCaption({ x: 80, y: 140, runs: [{ text: 'compound 1' }], justify: 'left' }).id;
    });
    const before = { atom: JSON.stringify(doc.atoms.get(o)), cap: doc.captions.get(cap)!.justify };
    ed.selectAll();
    ed.formatText({ kind: 'align', j: 'center' });
    expect(doc.captions.get(cap)!.justify).toBe('center');
    expect(doc.undo()).toBe(true);
    expect(doc.captions.get(cap)!.justify).toBe(before.cap);
    expect(JSON.stringify(doc.atoms.get(o))).toBe(before.atom);
  });
});

describe('F038: Arrange in a Row with nothing picked, structures locked', () => {
  it('leaves the locked structures where they are', () => {
    const { doc, ed } = setup();
    chain(doc, 3, 100, 100);
    chain(doc, 3, 300, 160);
    doc.edit('more', () => { doc.addCaption({ x: 50, y: 250, runs: [{ text: 'one' }], justify: 'left' }); doc.addCaption({ x: 250, y: 300, runs: [{ text: 'two' }], justify: 'left' }); });
    ed.structuresLocked = true;
    ed.clearSelection();
    // only the two text boxes: the structures can't be picked or moved
    expect(ed.gridCount()).toBe(2);
  });
});

describe('F366 and F353: the right-click menu and a right-button pan', () => {
  const pan = (ev: ReturnType<typeof setup>['ev'], escape: boolean) => {
    ev('pointerdown', { x: 100, y: 100 }, { button: 2, buttons: 2 });
    for (let i = 1; i <= 5; i++) ev('pointermove', { x: 100 + 10 * i, y: 100 }, { buttons: 2 });
    if (escape) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    ev('pointerup', { x: 150, y: 100 }, { button: 2 });
  };

  it('Esc during the pan: the menu event its release brings (Windows) opens no menu', () => {
    const { ed, overlay, ev } = setup();
    let menus = 0;
    ed.onContextMenu = () => { menus++; };
    pan(ev, true);
    overlay.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    expect(menus).toBe(0);
  });

  it('the menu event while the button is down (macOS): Shift+F10 afterwards opens the menu', () => {
    const { ed, overlay, ev } = setup();
    let menus = 0;
    ed.onContextMenu = () => { menus++; };
    ev('pointerdown', { x: 100, y: 100 }, { button: 2, buttons: 2 });
    overlay.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    for (let i = 1; i <= 5; i++) ev('pointermove', { x: 100 + 10 * i, y: 100 }, { buttons: 2 });
    ev('pointerup', { x: 150, y: 100 }, { button: 2 });
    // the pan's own menu event doesn't open the menu
    expect(menus).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', code: 'F10', shiftKey: true, bubbles: true }));
    overlay.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(menus).toBe(1);
  });
});

/** A → B → C with structures for species, as a Smart Scheme. */
function smartLine(doc: Doc) {
  const species: number[][] = [];
  const sel = { atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
  doc.edit('draw', () => {
    for (let k = 0; k < 3; k++) {
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) ids.push(doc.addAtom(k * 150 + i * L * 0.87, 100 + (i % 2 ? L / 2 : 0)).id);
      for (let i = 1; i < 5; i++) doc.addBond(ids[i - 1], ids[i]);
      species.push(ids);
      ids.forEach((id) => sel.atoms.add(id));
    }
    for (let k = 0; k < 2; k++) {
      const r = doc.addArrow({ tail: { x: k * 150 + 75, y: 100 }, head: { x: k * 150 + 140, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 4, headWidth: 1.5,
        step: { reactants: ['a' + species[k][0]], products: ['a' + species[k + 1][0]], above: [], below: [], manual: true } } as Omit<Arrow, 'id'>);
      sel.arrows.add(r.id);
    }
  });
  let frame = 0;
  doc.edit('smart', () => { frame = makeSmart(doc, plainMeasure(doc), sel)!; });
  return { species, frame };
}

describe('F358: the branch marks of a Smart Scheme', () => {
  it('follow every atom picked, past the fourth', () => {
    const doc = new Doc();
    const { species, frame } = smartLine(doc);
    const { ed } = setup(doc);
    const spots = (ed as unknown as { smartSpots(id: number): unknown; smartSpotsCache: { slot: number } });
    ed.sel = { atoms: new Set(species[2].slice(0, 4)), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
    spots.smartSpots(frame);
    expect(spots.smartSpotsCache.slot).toBe(2);
    // a fifth atom, of the first species: that species is the one picked now
    ed.sel.atoms.add(species[0][0]);
    spots.smartSpots(frame);
    expect(spots.smartSpotsCache.slot).toBe(0);
  });
});

describe('F357: the Smart Scheme a picked thing is in', () => {
  it('is the one each thing belongs to, as looking through every scheme finds', () => {
    const doc = new Doc();
    const { frame } = smartLine(doc);
    doc.edit('more', () => { doc.addAtom(900, 900); doc.addCaption({ x: 900, y: 0, runs: [{ text: 'loose' }], justify: 'left' }); });
    const { ed } = setup(doc);
    const one = (kind: 'atoms' | 'captions' | 'arrows' | 'shapes', id: number) => {
      ed.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
      ed.sel[kind].add(id);
    };
    const kinds = { atoms: 'atom', captions: 'caption', arrows: 'arrow', shapes: 'shape' } as const;
    let checked = 0;
    for (const [k, map] of [['atoms', doc.atoms], ['captions', doc.captions], ['arrows', doc.arrows], ['shapes', doc.shapes]] as const) {
      for (const id of map.keys()) {
        one(k, id);
        expect(ed.selectedSmart()).toBe(smartFrameOf(doc, kinds[k], id));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
    one('atoms', [...doc.atoms.keys()][0]);
    expect(ed.selectedSmart()).toBe(frame);
  });
});
