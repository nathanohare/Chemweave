// @vitest-environment jsdom
//
// Review F7b-R08: Redo right after Add Caption (nothing to redo) stopped typing and left the new,
// empty text box in the file; Add Caption, Undo, Redo brought the box back empty and closed,
// where nobody sees it. Now Redo with nothing to redo leaves typing alone (src/main.ts redo), and
// a text box Redo brings back empty is open for typing again (Editor.reopenRedone), going with its
// step if it is left empty again, as after Add Caption. The steps are those src/main.ts takes.

import { describe, it, expect, afterEach } from 'vitest';
import { Doc } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { Editor } from '../src/editor/editor';

window.requestAnimationFrame = () => 0;
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
  doc.edit('Atom', () => doc.addAtom(0, 0));
  // Add Caption: an empty text box in one step, open for typing
  const id = doc.edit('Add caption', () => doc.addCaption({ x: 50, y: 50, runs: [], justify: 'left' })).id;
  ed.typeInto(id);
  return { doc, ed, id };
}

// as src/main.ts undo() and redo() do outside a presentation
const undo = (doc: Doc, ed: Editor) => { ed.finishTypingForUndo(); ed.undo(); };
const redo = (doc: Doc, ed: Editor) => { if (!doc.canRedo()) return; ed.finishTypingForUndo(); ed.redo(); };

describe('Redo after Add Caption (review F7b-R08)', () => {
  it('with nothing to redo, leaves the new text box open for typing', () => {
    const { doc, ed, id } = setup();
    redo(doc, ed);
    expect(ed.typingCaption).not.toBeNull();
    expect(doc.captions.has(id)).toBe(true);
    expect(doc.undoLabel).toBe('Add caption');
  });
  it('after Undo, brings the text box back open for typing, and left empty it goes with its step', () => {
    const { doc, ed, id } = setup();
    undo(doc, ed);
    expect(doc.captions.has(id)).toBe(false);
    expect(doc.undoLabel).toBe('Atom');
    redo(doc, ed);
    expect(doc.captions.has(id)).toBe(true);
    expect(ed.typingCaption).not.toBeNull();
    // Esc with nothing typed: as after Add Caption, the box and its step are gone
    ed.closeCaption();
    expect(doc.captions.has(id)).toBe(false);
    expect(doc.undoLabel).toBe('Atom');
    expect(doc.canRedo()).toBe(false);
  });
});
