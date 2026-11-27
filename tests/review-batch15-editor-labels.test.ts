// @vitest-environment jsdom
//
// Review batch 15 (F355, F364, F367, F369): the label of an editing step is shown as "Undo <label>"
// in the Edit menu and on the Quick Access Toolbar, so it is a Title Case command name (ui-style
// S70), and one action has one name. These drive the real editor and read the step it recorded.

import { describe, it, expect, afterEach } from 'vitest';
import { Doc } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { Editor } from '../src/editor/editor';

window.requestAnimationFrame = () => 0;
const noop = () => undefined;
const ctx: unknown = new Proxy({}, {
  get: (_t, k) => (k === 'measureText' ? (t: string) => ({ width: t.length * 50, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 20 })
    : k === 'getTransform' ? () => new DOMMatrix()
    : k === 'createLinearGradient' || k === 'createPattern' || k === 'createRadialGradient' ? () => ({ addColorStop: noop })
    : noop),
  set: () => true,
});
(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ctx;

let last: Editor | null = null;
afterEach(() => { if (last) last.paused = true; });

function setup() {
  document.body.innerHTML = '';
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas');
  const host = document.createElement('div');
  host.append(scene, overlay);
  document.body.append(host);
  const doc = new Doc();
  const ed = new Editor(doc, new Renderer(scene, overlay), host);
  last = ed;
  ed.setTool('select');
  return { doc, ed };
}

/** Ethanol-like chain: C–C–O, so there are atoms, bonds and something to flip. */
function chain(doc: Doc): number[] {
  const L = doc.style.bondLength;
  return doc.edit('build', () => {
    const a = doc.addAtom(100, 100).id, b = doc.addAtom(100 + L, 100).id, c = doc.addAtom(100 + 2 * L, 100 + L / 2, 8).id;
    doc.addBond(a, b, 1); doc.addBond(b, c, 1);
    return [a, b, c];
  });
}

describe('Undo step names are Title Case command names', () => {
  it('Flip Horizontal and Flip Vertical (F364)', () => {
    const { doc, ed } = setup();
    chain(doc);
    ed.selectAll();
    ed.flip('h');
    expect(doc.undoLabel).toBe('Flip Horizontal');
    ed.flip('v');
    expect(doc.undoLabel).toBe('Flip Vertical');
    ed.flip('h', true);
    expect(doc.undoLabel).toBe('Flip Horizontal, Keeping Configuration');
  });

  it('Add Frame (F364)', () => {
    const { doc, ed } = setup();
    chain(doc);
    ed.selectAll();
    expect(ed.addFrame()).toBe(true);
    expect(doc.undoLabel).toBe('Add Frame');
  });

  it('a sprout key names what it did, and a bond key what it changed (F367)', () => {
    const { doc, ed } = setup();
    const [a, b] = chain(doc);
    expect(ed.atomKey(a, 'bond')).toBe(true);
    expect(doc.undoLabel).toBe('Add Bond');
    expect(ed.atomKey(b, 'phenyl')).toBe(true);
    expect(doc.undoLabel).toBe('Add Group');
    const bond = doc.bondBetween(a, b)!;
    expect(ed.bondKey(bond.id, 'double')).toBe(true);
    expect(doc.undoLabel).toBe('Change Bond');
  });

  it('the atom-key commands are Title Case (F367)', () => {
    const { doc, ed } = setup();
    const [a] = chain(doc);
    ed.atomKey(a, 'number');
    expect(doc.undoLabel).toBe('Atom Number');
    ed.atomKey(a, 'attach');
    expect(doc.undoLabel).toBe('Attachment Point');
  });

  it('text guides: on, off, and back to as-usual each say which (F369)', () => {
    const { doc, ed } = setup();
    chain(doc);
    const id = doc.edit('arrow', () => doc.addArrow({ tail: { x: 0, y: 0 }, head: { x: 100, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 } as never)).id;
    ed.setArrowGuides([id], true);
    expect(doc.undoLabel).toBe('Show Text Guides');
    ed.setArrowGuides([id], false);
    expect(doc.undoLabel).toBe('Hide Text Guides');
    // back to "as usual" (null) is not "Show": on a plain arrow it hides them
    ed.setArrowGuides([id], null);
    expect(doc.undoLabel).toBe('Reset Text Guides');
  });
});
