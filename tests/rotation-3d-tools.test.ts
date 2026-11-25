// @vitest-environment jsdom
//
// Turning structures in 3-D, made easier to find and to use: the 3-D Rotation window turns the
// selection live as its angles change (Cancel puts it back, Rotate keeps it as one undo step), the
// selection box has tilt handles (with a Perspective tool) that tip or swing the selection, and the
// Perspective tools are on the ribbon's View tab and in the toolboxes.

import { describe, it, expect, afterEach } from 'vitest';
import { Doc } from '../src/model';
import { Renderer } from '../src/render/renderer';
import { Editor } from '../src/editor/editor';
import { wrapAngle } from '../src/ui/turn3d-dialog';
import { CANVAS_TABS } from '../src/ui/canvas-ribbon';

window.requestAnimationFrame = () => 0;

let last: Editor | null = null;
afterEach(() => { if (last) last.paused = true; });

function setup() {
  document.body.innerHTML = '';
  const scene = document.createElement('canvas'), overlay = document.createElement('canvas');
  const host = document.createElement('div');
  host.append(scene, overlay);
  document.body.append(host);
  const doc = new Doc();
  const r = new Renderer(scene, overlay);
  overlay.setPointerCapture = () => {};
  const ed = new Editor(doc, r, host);
  last = ed;
  ed.setTool('select');
  return { doc, ed, r, overlay };
}

/** A zigzag chain of n atoms, all selected. */
function chain(doc: Doc, ed: Editor, n = 5): number[] {
  const L = doc.style.bondLength;
  const ids: number[] = [];
  doc.edit('Chain', () => {
    for (let i = 0; i < n; i++) ids.push(doc.addAtom(100 + i * L * 0.87, 100 + (i % 2 ? L / 2 : 0)).id);
    for (let i = 1; i < n; i++) doc.addBond(ids[i - 1], ids[i], 1);
  });
  ed.sel.atoms = new Set(ids);
  ed.sel.bonds = new Set(doc.bonds.keys());
  return ids;
}

const where = (doc: Doc) => [...doc.atoms.values()].map((a) => [a.x, a.y, a.depth ?? 0]);
const width = (doc: Doc) => { const xs = [...doc.atoms.values()].map((a) => a.x); return Math.max(...xs) - Math.min(...xs); };

describe('3-D Rotation window: a live preview', () => {
  it('turns the selection as the angles change, and Cancel puts it back with nothing to undo', async () => {
    const { doc, ed } = setup();
    chain(doc, ed);
    const before = where(doc), w = width(doc), undos = doc.undoStack.length;
    const p = (await ed.previewTurn(false))!;
    expect(p).not.toBeNull();
    p.set(0, 60, 0);
    // turned 60° about the up–down axis: half as wide
    expect(width(doc)).toBeCloseTo(w / 2, 1);
    p.set(0, 0, 0);
    expect(width(doc)).toBeCloseTo(w, 6);
    p.set(20, 30, 10);
    p.cancel();
    expect(where(doc)).toEqual(before);
    expect(doc.undoStack.length).toBe(undos);
  });

  it('turns from where the structure is, and Rotate keeps the turn as one undo step', async () => {
    const { doc, ed } = setup();
    chain(doc, ed);
    const before = where(doc), w = width(doc), undos = doc.undoStack.length;
    const p = (await ed.previewTurn(false))!;
    p.set(0, 30, 0);
    p.set(0, 60, 0);
    p.keep();
    expect(width(doc)).toBeCloseTo(w / 2, 1);
    expect(doc.undoStack.length).toBe(undos + 1);
    expect(doc.undoStack.at(-1)!.label).toBe('Rotate in Perspective');
    // a second window starts from the turned drawing
    const q = (await ed.previewTurn(false))!;
    q.set(0, 0, 0);
    expect(width(doc)).toBeCloseTo(w / 2, 1);
    q.cancel();
    doc.undo();
    where(doc).forEach((p, i) => { expect(p[0]).toBeCloseTo(before[i][0], 6); expect(p[1]).toBeCloseTo(before[i][1], 6); });
  });

  it('has nothing to preview with nothing selected', async () => {
    const { ed } = setup();
    expect(await ed.previewTurn(false)).toBeNull();
  });

  it('shows slider angles within −180…180', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(190)).toBe(-170);
    expect(wrapAngle(-190)).toBe(170);
    expect(wrapAngle(180)).toBe(180);
    expect(wrapAngle(-180)).toBe(-180);
    expect(wrapAngle(720 + 45)).toBe(45);
    expect(wrapAngle(NaN)).toBe(0);
  });
});

describe('tilt handles on the selection box', () => {
  it('come with a selected structure and a Perspective tool only', () => {
    const { doc, ed } = setup();
    const ids = chain(doc, ed);
    // the selection tool: a selected structure shows only its rotate handle (review round 2, #14)
    expect(ed.rotateHandle()).not.toBeNull();
    expect(ed.tiltHandles()).toBeNull();
    ed.setTool('perspective');
    expect(ed.tiltHandles()).not.toBeNull();
    ed.setTool('perspective-3d');
    expect(ed.tiltHandles()).not.toBeNull();
    ed.setTool('perspective');
    ed.sel.atoms = new Set([ids[0]]);
    ed.sel.bonds = new Set();
    expect(ed.tiltHandles()).toBeNull();
    ed.sel.atoms = new Set(ids);
    ed.setTool('bond-single');
    expect(ed.tiltHandles()).toBeNull();
  });

  it('never show for a text box, with any tool', () => {
    // a stand-in for measuring text (jsdom has no canvas)
    const ctx = { font: '', measureText(t: string) { return { width: [...t].length * 60 }; } };
    HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const { doc, ed } = setup();
    let id = 0;
    doc.edit('Text', () => { id = doc.addCaption({ x: 100, y: 100, runs: [{ text: 'Title' }], justify: 'left' }).id; });
    ed.sel.captions = new Set([id]);
    expect(ed.rotateHandle()).not.toBeNull();
    expect(ed.tiltHandles()).toBeNull();
    ed.setTool('perspective');
    expect(ed.tiltHandles()).toBeNull();
  });

  it('tip the selection about the left–right axis, or swing it about the up–down one, in one undo step', async () => {
    const { doc, ed, r, overlay } = setup();
    chain(doc, ed);
    ed.setTool('perspective');
    const w = width(doc);
    const ys = () => [...doc.atoms.values()].map((a) => a.y);
    const h0 = Math.max(...ys()) - Math.min(...ys());
    const undos = doc.undoStack.length;
    const drag = async (at: { x: number; y: number }, dx: number, dy: number) => {
      const a = r.toScreen(at);
      overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: a.x, clientY: a.y, bubbles: true }));
      overlay.dispatchEvent(new PointerEvent('pointerdown', { clientX: a.x, clientY: a.y, button: 0, buttons: 1, bubbles: true }));
      // (the turn is got ready while the pointer is down)
      await new Promise((res) => setTimeout(res, 0));
      for (let i = 1; i <= 5; i++) overlay.dispatchEvent(new PointerEvent('pointermove', { clientX: a.x + dx * i / 5, clientY: a.y + dy * i / 5, buttons: 1, bubbles: true }));
      overlay.dispatchEvent(new PointerEvent('pointerup', { clientX: a.x + dx, clientY: a.y + dy, button: 0, bubbles: true }));
    };
    // the tip handle, dragged down 100 px (60°) and a little across: only the drag down counts
    await drag(ed.tiltHandles()!.x, 30, 100);
    expect(width(doc)).toBeCloseTo(w, 6);
    expect(Math.max(...ys()) - Math.min(...ys())).toBeCloseTo(h0 / 2, 1);
    expect(doc.undoStack.length).toBe(undos + 1);
    // the swing handle, dragged across 100 px (60°): half as wide
    await drag(ed.tiltHandles()!.y, 100, 30);
    expect(width(doc)).toBeCloseTo(w / 2, 1);
    expect(doc.undoStack.length).toBe(undos + 2);
    expect([...doc.atoms.values()].every((a) => a.depth !== undefined)).toBe(true);
  });
});

describe('where the Perspective tools are', () => {
  it('has a 3-D group on the ribbon\'s View tab with both drag tools and 3-D Rotation…', () => {
    const view = CANVAS_TABS.find((t) => t.id === 'view')!;
    const g = view.groups.find((x) => x.name === '3-D')!;
    expect(g).toBeTruthy();
    const names = g.items.map((it) => ('tool' in it ? `tool:${it.tool}` : 'cmd' in it ? `cmd:${it.cmd}` : ''));
    expect(names).toEqual(expect.arrayContaining(['tool:perspective', 'tool:perspective-3d', 'cmd:turn-3d', 'cmd:flatten-3d']));
    // (the Arrange tab is gone: Home's Arrange group has Align, Rotate, Order and Focal Point as flyouts)
    expect(CANVAS_TABS.some((t) => t.id === 'arrange')).toBe(false);
  });
});
